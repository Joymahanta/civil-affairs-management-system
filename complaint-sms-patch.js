const fs = require('fs');
const path = require('path');
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

  const body = { recipients: [recipient], message };
  if (process.env.TEXTBEE_DEVICE_ID) body.deviceId = process.env.TEXTBEE_DEVICE_ID;
  if (process.env.TEXTBEE_SIM_SUBSCRIPTION_ID) {
    const simId = Number(process.env.TEXTBEE_SIM_SUBSCRIPTION_ID);
    if (Number.isFinite(simId)) body.simSubscriptionId = simId;
  }

  const response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || payload?.message || `TextBee returned HTTP ${response.status}.`);

  const data = payload?.data || {};
  if (data.success === false || Number(data.failureCount || 0) > 0) {
    throw new Error(data.message || 'TextBee could not queue the SMS for delivery.');
  }
  return data;
}

function ensureSmsTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS sms_jobs (
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
  );`);
}

function createSmsJob(recipient, message, staffId, createdBy) {
  ensureSmsTable();
  const stamp = new Date().toISOString();
  const result = db.prepare(`INSERT INTO sms_jobs (recipient,message,staff_id,created_by,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(recipient, message, staffId || null, createdBy || null, 'sending', stamp, stamp);
  return { id: result.lastInsertRowid, stamp };
}

async function sendAndRecord(recipient, message, staffId, createdBy) {
  const job = createSmsJob(recipient, message, staffId, createdBy);
  try {
    const data = await sendTextBeeSms(recipient, message);
    const stamp = new Date().toISOString();
    const gatewayMessageId = data.smsBatchId || data._id || data.id || null;
    const status = gatewayMessageId ? 'accepted' : (Number(data.successCount || 0) > 0 ? 'sent' : 'accepted');
    db.prepare(`UPDATE sms_jobs SET status=?, sent_at=?, error=NULL, gateway_message_id=?, updated_at=? WHERE id=?`).run(status, stamp, gatewayMessageId, stamp, job.id);
    return { accepted: true, gatewayMessageId };
  } catch (error) {
    const stamp = new Date().toISOString();
    db.prepare(`UPDATE sms_jobs SET status='failed', error=?, updated_at=? WHERE id=?`).run(String(error.message || error).slice(0, 500), stamp, job.id);
    console.error('[sms] send failed:', error.message || error);
    return { accepted: false, error: error.message || String(error) };
  }
}

function assignmentRule(complaint) {
  const type = String(complaint?.type || '').toLowerCase();
  const category = String(complaint?.category || '').toLowerCase();
  if (category.includes('water')) return { departments: ['Waterworks'], designationNames: ['Waterworks Supervisor'] };
  if (category.includes('electrical') || category.includes('electric')) return { departments: ['Electrical'], designationNames: ['Electrical Supervisor'] };
  if (category.includes('garbage') || category.includes('sanitation')) return { departments: ['Sanitation'], designationNames: ['Sanitation Officer'] };
  if (category.includes('pothole') || category.includes('road')) return { departments: ['Roads'], designationNames: ['Junior Engineer', 'Senior Engineer'] };
  if (type === 'garbage / sanitation') return { departments: ['Sanitation'], designationNames: ['Sanitation Officer'] };
  if (type === 'shop operation') return { departments: ['Inspection'], designationNames: ['Field Inspector'] };
  if (type === 'public issue') return { departments: ['Roads', 'Inspection', 'Horticulture'], designationNames: ['Junior Engineer', 'Senior Engineer', 'Field Inspector'] };
  if (type === 'quarter maintenance') return { departments: ['Waterworks', 'Electrical', 'Inspection'], designationNames: ['Waterworks Supervisor', 'Electrical Supervisor', 'Field Inspector'] };
  return null;
}

function autoAssignComplaint(complaint) {
  if (!complaint?.id || complaint.assigned_to) return complaint;
  const rule = assignmentRule(complaint);
  if (!rule) return complaint;
  const departmentPlaceholders = rule.departments.map(() => '?').join(',');
  const designationPlaceholders = rule.designationNames.map(() => '?').join(',');
  const staff = db.prepare(`
    SELECT s.id, s.name, s.phone, d.name AS designation, s.department,
      (SELECT COUNT(*) FROM complaints c WHERE lower(c.assigned_to)=lower(s.name) AND c.status <> 'Resolved') AS open_count
    FROM staff s
    LEFT JOIN designations d ON d.id=s.designation_id
    WHERE s.attendance='Present'
      AND s.department IN (${departmentPlaceholders})
      AND (d.name IN (${designationPlaceholders}) OR d.name IS NULL)
    ORDER BY open_count ASC, s.id ASC
    LIMIT 1
  `).get(...rule.departments, ...rule.designationNames);
  if (!staff) return complaint;
  const stamp = new Date().toISOString();
  db.prepare("UPDATE complaints SET assigned_to=?, status='Assigned', updated_at=? WHERE id=? AND assigned_to IS NULL").run(staff.name, stamp, complaint.id);
  db.prepare('INSERT INTO activity (kind, message, created_at) VALUES (?, ?, ?)').run('assignment', `${complaint.reference} automatically assigned to ${staff.name} — ${staff.designation || staff.department}`, stamp);
  return db.prepare('SELECT * FROM complaints WHERE id=?').get(complaint.id);
}

async function notifyResident(complaint, trigger, changedBy, changes = []) {
  if (!complaint?.reference) return;
  const recipient = normalizeIndianPhone(complaint.reporter_phone);
  if (!recipient) {
    console.warn(`[sms] Skipped resident SMS for ${complaint.reference}: invalid reporter phone.`);
    return;
  }

  const assigned = complaint.assigned_to ? ` Assigned officer: ${complaint.assigned_to}.` : '';
  let message;

  if (trigger === 'registered') {
    message = `Civil Affairs: Your complaint ${complaint.reference} has been registered successfully. Current status: ${complaint.status || 'New'}.${assigned} Please keep this reference number for tracking.`;
  } else {
    const details = changes.length ? ` Changes: ${changes.join(' ')}` : '';
    message = `Civil Affairs update: Complaint ${complaint.reference} has been updated. Current status: ${complaint.status || 'New'}.${assigned}${details} We will keep you informed of further updates.`;
  }

  const result = await sendAndRecord(recipient, message, null, changedBy);
  if (!result.accepted) console.error(`[sms] Resident notification failed for ${complaint.reference}: ${result.error}`);
}

async function notifyAssignedStaff(complaint, staff, changedBy) {
  if (!complaint?.reference || !staff) return;
  const recipient = normalizeIndianPhone(staff.phone);
  if (!recipient) { console.warn(`[sms] Skipped staff ${staff.name}: invalid phone.`); return; }
  const message = `Civil Affairs: Complaint ${complaint.reference} has been assigned to you. ${complaint.type || 'Service request'} at ${complaint.location || 'the reported location'}. Priority: ${complaint.priority || 'Medium'}. Current status: ${complaint.status || 'Assigned'}. Please review and act.`;
  const result = await sendAndRecord(recipient, message, staff.id, changedBy);
  if (result.accepted) db.prepare('UPDATE staff SET last_sms_at=? WHERE id=?').run(new Date().toISOString(), staff.id);
}

async function notifyStaffTask(staff, previousTask, changedBy) {
  if (!staff?.id || !staff.phone) return;
  const recipient = normalizeIndianPhone(staff.phone);
  if (!recipient) { console.warn(`[sms] Skipped task SMS for ${staff.name}: invalid phone.`); return; }
  const task = String(staff.current_task || '').trim();
  const message = task
    ? `Civil Affairs: New field task for ${staff.name}. Task: ${task}. Please report progress through the Civil Office.`
    : `Civil Affairs: Your field task has been cleared by the Civil Office. Previous task: ${String(previousTask || 'None')}.`;
  const result = await sendAndRecord(recipient, message, staff.id, changedBy);
  if (result.accepted) db.prepare('UPDATE staff SET last_sms_at=? WHERE id=?').run(new Date().toISOString(), staff.id);
}

function installComplaintSmsHooks() {
  if (express.application.__complaintSmsHooksInstalled) return;
  express.application.__complaintSmsHooksInstalled = true;

  const originalPost = express.application.post;
  express.application.post = function complaintSmsPost(pathname, ...handlers) {
    if (handlers.length === 0) return originalPost.call(this, pathname, ...handlers);
    const wrappedHandlers = handlers.slice();
    const originalHandler = wrappedHandlers[wrappedHandlers.length - 1];

    if (pathname === '/api/complaints') {
      wrappedHandlers[wrappedHandlers.length - 1] = function wrappedComplaintCreate(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = function complaintCreateJson(payload) {
          if (res.statusCode >= 200 && res.statusCode < 300 && payload?.reference) {
            const before = db.prepare('SELECT * FROM complaints WHERE reference=?').get(payload.reference);
            const complaint = autoAssignComplaint(before);
            if (complaint) payload = { ...payload, status: complaint.status, assigned_to: complaint.assigned_to };
            const result = originalJson(payload);
            if (complaint) {
              setImmediate(() => {
                Promise.resolve()
                  .then(async () => {
                    await notifyResident(complaint, 'registered', req.session?.user?.id);
                    if (complaint.assigned_to) {
                      const staff = db.prepare('SELECT id,name,phone FROM staff WHERE lower(name)=lower(?) LIMIT 1').get(complaint.assigned_to);
                      if (staff) await notifyAssignedStaff(complaint, staff, req.session?.user?.id);
                    }
                  })
                  .catch(error => console.error('[sms] registration notification error:', error.message || error));
              });
            }
            return result;
          }
          return originalJson(payload);
        };
        return originalHandler(req, res, next);
      };
    } else if (pathname === '/api/staff') {
      wrappedHandlers[wrappedHandlers.length - 1] = function wrappedStaffCreate(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = function staffCreateJson(payload) {
          if (res.statusCode >= 200 && res.statusCode < 300 && payload?.id) {
            const designationId = req.body?.designationId ? Number(req.body.designationId) : null;
            const department = String(req.body?.department || '').trim();
            const phone = String(req.body?.phone || '').trim();
            const email = String(req.body?.email || '').trim();
            const updates = [];
            const values = [];
            if (designationId) { updates.push('designation_id=?'); values.push(designationId); }
            if (department) { updates.push('department=?'); values.push(department); }
            if (phone) { updates.push('phone=?'); values.push(phone); }
            if (email) { updates.push('email=?'); values.push(email); }
            if (updates.length) db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id=?`).run(...values, Number(payload.id));
            payload = db.prepare('SELECT * FROM staff WHERE id=?').get(Number(payload.id));
          }
          return originalJson(payload);
        };
        return originalHandler(req, res, next);
      };
    }
    return originalPost.call(this, pathname, ...wrappedHandlers);
  };

  const originalPatch = express.application.patch;
  express.application.patch = function complaintSmsPatch(pathname, ...handlers) {
    if (handlers.length === 0) return originalPatch.call(this, pathname, ...handlers);
    const wrappedHandlers = handlers.slice();
    const originalHandler = wrappedHandlers[wrappedHandlers.length - 1];

    if (pathname === '/api/complaints/:id') {
      wrappedHandlers[wrappedHandlers.length - 1] = function wrappedComplaintUpdate(req, res, next) {
        const previous = db.prepare('SELECT * FROM complaints WHERE id=?').get(Number(req.params.id));
        const originalJson = res.json.bind(res);
        res.json = function complaintUpdateJson(payload) {
          if (res.statusCode >= 200 && res.statusCode < 300 && previous) {
            const result = originalJson(payload);
            setImmediate(() => {
              Promise.resolve()
                .then(async () => {
                  const after = db.prepare('SELECT * FROM complaints WHERE id=?').get(previous.id);
                  if (!after) return;

                  const changes = [];
                  if (previous.status !== after.status) changes.push(`Status: ${previous.status || 'New'} → ${after.status || 'New'}.`);
                  if ((previous.assigned_to || '') !== (after.assigned_to || '')) changes.push(`Assignment: ${previous.assigned_to || 'Unassigned'} → ${after.assigned_to || 'Unassigned'}.`);
                  if (previous.priority !== after.priority) changes.push(`Priority: ${previous.priority || 'Medium'} → ${after.priority || 'Medium'}.`);
                  if (previous.category !== after.category) changes.push(`Category changed to ${after.category || 'Other'}.`);
                  if (previous.location !== after.location) changes.push(`Location changed to ${after.location || 'updated location'}.`);
                  if (previous.description !== after.description) changes.push('Complaint details were updated.');

                  if (changes.length) {
                    await notifyResident(after, 'updated', req.session?.user?.id, changes);
                  }

                  if ((previous.assigned_to || '') !== (after.assigned_to || '') && after.assigned_to) {
                    const staff = db.prepare('SELECT id,name,phone FROM staff WHERE lower(name)=lower(?) LIMIT 1').get(after.assigned_to);
                    if (staff) await notifyAssignedStaff(after, staff, req.session?.user?.id);
                  }
                })
                .catch(error => console.error('[sms] complaint update notification error:', error.message || error));
            });
            return result;
          }
          return originalJson(payload);
        };
        return originalHandler(req, res, next);
      };
    } else if (pathname === '/api/staff/:id') {
      wrappedHandlers[wrappedHandlers.length - 1] = function wrappedStaffUpdate(req, res, next) {
        const previous = db.prepare('SELECT * FROM staff WHERE id=?').get(Number(req.params.id));
        const originalJson = res.json.bind(res);
        res.json = function staffUpdateJson(payload) {
          if (res.statusCode >= 200 && res.statusCode < 300 && previous) {
            const updates = [];
            const values = [];
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) { updates.push('phone=?'); values.push(String(req.body.phone || '').trim()); }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'department')) { updates.push('department=?'); values.push(String(req.body.department || '').trim()); }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'designationId')) { updates.push('designation_id=?'); values.push(req.body.designationId ? Number(req.body.designationId) : null); }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) { updates.push('email=?'); values.push(String(req.body.email || '').trim() || null); }
            if (updates.length) db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id=?`).run(...values, previous.id);
            const after = db.prepare('SELECT * FROM staff WHERE id=?').get(previous.id);
            const result = originalJson(after || payload);
            if (after && String(previous.current_task || '') !== String(after.current_task || '')) {
              setImmediate(() => notifyStaffTask(after, previous.current_task, req.session?.user?.id).catch(error => console.error('[sms] staff task notification error:', error.message || error)));
            }
            return result;
          }
          return originalJson(payload);
        };
        return originalHandler(req, res, next);
      };
    }
    return originalPatch.call(this, pathname, ...wrappedHandlers);
  };
}

module.exports = { installComplaintSmsHooks };
