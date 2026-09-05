const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new BetterSqlite3(path.join(dataDir, 'civil-affairs.db'));
db.pragma('journal_mode = WAL');

function normalizeIndianPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

async function sendTextBeeSms(recipient, message) {
  const apiKey = String(process.env.TEXTBEE_API_KEY || '').trim();
  if (!apiKey) throw new Error('TextBee API key is not configured.');

  const body = {
    recipients: [recipient],
    message
  };
  if (process.env.TEXTBEE_DEVICE_ID) body.deviceId = process.env.TEXTBEE_DEVICE_ID;
  if (process.env.TEXTBEE_SIM_SUBSCRIPTION_ID) body.simSubscriptionId = Number(process.env.TEXTBEE_SIM_SUBSCRIPTION_ID);

  const response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `TextBee returned HTTP ${response.status}.`);
  }
  return payload?.data || {};
}

function ensureSmsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      message TEXT NOT NULL,
      staff_id INTEGER,
      created_by INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      sent_at TEXT,
      error TEXT,
      gateway_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function createSmsJob(recipient, message, complaint, trigger) {
  ensureSmsTable();
  const stamp = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO sms_jobs
      (recipient, message, staff_id, created_by, status, created_at, updated_at)
    VALUES (?, ?, NULL, NULL, 'sending', ?, ?)
  `).run(recipient, message, stamp, stamp);
  return { id: result.lastInsertRowid, stamp };
}

async function notifyComplaint(complaint, trigger) {
  if (!complaint || !complaint.reference) return;
  const recipient = normalizeIndianPhone(complaint.reporter_phone);
  if (!recipient) {
    console.warn(`[complaint-sms] Skipped ${complaint.reference}: invalid reporter phone.`);
    return;
  }

  const assigned = complaint.assigned_to ? ` Assigned officer: ${complaint.assigned_to}.` : '';
  let message;
  if (trigger === 'registered') {
    message = `Civil Affairs: Your complaint ${complaint.reference} has been registered successfully. Current status: New. Please keep this reference number for tracking.`;
  } else {
    const previous = complaint.previous_status ? ` from ${complaint.previous_status}` : '';
    message = `Civil Affairs update: Complaint ${complaint.reference} status changed${previous} to ${complaint.status}.${assigned} We will keep you informed of further updates.`;
  }

  const job = createSmsJob(recipient, message, complaint, trigger);
  try {
    const data = await sendTextBeeSms(recipient, message);
    const stamp = new Date().toISOString();
    const gatewayMessageId = data.smsBatchId || data._id || data.id || null;
    db.prepare(`
      UPDATE sms_jobs
      SET status='accepted', sent_at=?, error=NULL, gateway_message_id=?, updated_at=?
      WHERE id=?
    `).run(stamp, gatewayMessageId, stamp, job.id);
    console.log(`[complaint-sms] ${trigger} SMS accepted for ${complaint.reference}`);
  } catch (error) {
    const stamp = new Date().toISOString();
    db.prepare(`
      UPDATE sms_jobs
      SET status='failed', error=?, updated_at=?
      WHERE id=?
    `).run(String(error.message || error).slice(0, 500), stamp, job.id);
    console.error(`[complaint-sms] ${trigger} SMS failed for ${complaint.reference}:`, error.message || error);
  }
}

function installComplaintSmsHooks() {
  const originalPost = express.application.post;
  if (express.application.__complaintSmsHooksInstalled) return;
  express.application.__complaintSmsHooksInstalled = true;

  express.application.post = function complaintSmsPost(pathname, ...handlers) {
    if (pathname !== '/api/complaints' || handlers.length === 0) {
      return originalPost.call(this, pathname, ...handlers);
    }

    const wrappedHandlers = handlers.slice();
    const lastIndex = wrappedHandlers.length - 1;
    const originalHandler = wrappedHandlers[lastIndex];

    wrappedHandlers[lastIndex] = function wrappedComplaintCreate(req, res, next) {
      const originalJson = res.json.bind(res);
      res.json = function complaintCreateJson(payload) {
        const result = originalJson(payload);
        if (res.statusCode >= 200 && res.statusCode < 300 && payload?.reference) {
          setImmediate(() => {
            try {
              notifyComplaint({
                ...req.body,
                reference: payload.reference,
                status: payload.status || 'New',
                reporter_phone: req.body?.reporterPhone
              }, 'registered');
            } catch (error) {
              console.error('[complaint-sms] Registration notification error:', error.message || error);
            }
          });
        }
        return result;
      };
      return originalHandler(req, res, next);
    };

    return originalPost.call(this, pathname, ...wrappedHandlers);
  };

  const originalPatch = express.application.patch;
  express.application.patch = function complaintSmsPatch(pathname, ...handlers) {
    if (pathname !== '/api/complaints/:id' || handlers.length === 0) {
      return originalPatch.call(this, pathname, ...handlers);
    }

    const wrappedHandlers = handlers.slice();
    const lastIndex = wrappedHandlers.length - 1;
    const originalHandler = wrappedHandlers[lastIndex];

    wrappedHandlers[lastIndex] = function wrappedComplaintUpdate(req, res, next) {
      let previous = null;
      try {
        ensureSmsTable();
        previous = db.prepare('SELECT * FROM complaints WHERE id=?').get(Number(req.params.id));
      } catch (error) {
        console.error('[complaint-sms] Could not read complaint before update:', error.message || error);
      }

      const originalJson = res.json.bind(res);
      res.json = function complaintUpdateJson(payload) {
        const result = originalJson(payload);
        const requestedStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status') ? String(req.body.status || '').trim() : '';
        const changed = Boolean(previous && requestedStatus && requestedStatus !== previous.status);
        if (res.statusCode >= 200 && res.statusCode < 300 && changed && payload?.reference) {
          setImmediate(() => {
            try {
              notifyComplaint({
                reference: payload.reference,
                reporter_phone: payload.reporter_phone || previous.reporter_phone,
                status: payload.status || requestedStatus,
                previous_status: previous.status,
                assigned_to: payload.assigned_to || previous.assigned_to
              }, 'status-changed');
            } catch (error) {
              console.error('[complaint-sms] Status notification error:', error.message || error);
            }
          });
        }
        return result;
      };
      return originalHandler(req, res, next);
    };

    return originalPatch.call(this, pathname, ...wrappedHandlers);
  };
}

module.exports = { installComplaintSmsHooks };
