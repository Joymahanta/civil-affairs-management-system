const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');
const expressSession = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(expressSession);

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const sessionDb = new BetterSqlite3(path.join(dataDir, 'civil-affairs.db'));
sessionDb.pragma('journal_mode = WAL');

// Authentication/session responses must never be converted into HTTP 304 responses.
const originalSend = express.response.send;
express.response.send = function sendWithoutAuthCaching(body) {
  const req = this.req;
  const isAuthApi = req && req.originalUrl && req.originalUrl.startsWith('/api/auth/');
  if (isAuthApi) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    this.set('Pragma', 'no-cache');
    this.set('Expires', '0');
  }
  return originalSend.call(this, body);
};

function patchedSession(options = {}) {
  if (options.store) return expressSession(options);
  return expressSession({
    ...options,
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 }
    })
  });
}

// SMS history used by the Civil Affairs console. Actual SMS delivery is handled by
// TextBee using the administrator's registered Android device and SIM.
sessionDb.exec(`
  CREATE TABLE IF NOT EXISTS sms_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    staff_id INTEGER,
    created_by INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    claimed_at TEXT,
    sent_at TEXT,
    error TEXT,
    gateway_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function normalizeIndianPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

async function textbeeRequest(endpoint, options = {}) {
  const apiKey = String(process.env.TEXTBEE_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('TextBee is not configured. Add TEXTBEE_API_KEY to the Render service environment.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`https://api.textbee.dev/api/v1/gateway${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || `TextBee returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

function installSmsRoutes(app) {
  const stack = app._router?.stack;
  if (!stack) return;
  const healthIndex = stack.findIndex(layer => layer.route?.path === '/api/health');
  if (healthIndex < 0) return;
  const router = express.Router();

  router.get('/api/staff/sms/status', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to view SMS status.' });
    if (!process.env.TEXTBEE_API_KEY) return res.json({ configured: false, message: 'TextBee API key is not configured.' });
    try {
      const [devices, stats] = await Promise.all([
        textbeeRequest('/devices'),
        textbeeRequest('/stats')
      ]);
      const rows = Array.isArray(devices?.data) ? devices.data : [];
      const device = rows.find(item => item.isDefault) || rows.find(item => item.enabled) || rows[0] || null;
      res.json({
        configured: true,
        connected: Boolean(device?.enabled),
        device: device ? {
          id: device._id,
          name: device.name || `${device.manufacturer || device.brand || ''} ${device.model || ''}`.trim(),
          enabled: device.enabled,
          isDefault: device.isDefault
        } : null,
        totals: stats?.data ? {
          sent: stats.data.totalSentSMSCount,
          received: stats.data.totalReceivedSMSCount,
          devices: stats.data.totalDeviceCount
        } : null
      });
    } catch (error) {
      res.status(error.status || 502).json({ configured: true, connected: false, error: error.message });
    }
  });

  router.post('/api/staff/sms', async (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to send SMS updates.' });
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Enter an SMS message.' });
    if (message.length > 1000) return res.status(400).json({ error: 'SMS message is too long.' });
    if (!process.env.TEXTBEE_API_KEY) return res.status(503).json({ error: 'TextBee is not configured yet. Add TEXTBEE_API_KEY in the Render service environment.' });

    const staff = sessionDb.prepare("SELECT id, name, phone FROM staff WHERE attendance='Present' AND phone IS NOT NULL AND trim(phone) != '' ORDER BY id").all();
    const recipients = staff.map(person => ({ ...person, recipient: normalizeIndianPhone(person.phone) }));
    const invalid = recipients.filter(person => !person.recipient);
    const eligible = recipients.filter(person => person.recipient);
    if (!eligible.length) return res.status(400).json({ error: 'No on-duty staff have a valid mobile number.' });

    const stamp = new Date().toISOString();
    const insert = sessionDb.prepare('INSERT INTO sms_jobs (recipient, message, staff_id, created_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let ids = [];
    try {
      ids = sessionDb.transaction(() => eligible.map(person => insert.run(person.recipient, message, person.id, req.session.user.id, 'sending', stamp, stamp).lastInsertRowid))();

      const result = await textbeeRequest('/send-sms', {
        method: 'POST',
        body: JSON.stringify({
          recipients: eligible.map(person => person.recipient),
          message
        })
      });

      const batch = result?.data?.smsBatchId || null;
      const successCount = Number(result?.data?.successCount ?? result?.data?.recipientCount ?? eligible.length);
      const failureCount = Number(result?.data?.failureCount ?? 0);
      const accepted = Math.max(0, successCount - failureCount);
      const finalStatus = accepted > 0 ? 'accepted' : 'failed';
      const finalError = accepted > 0 ? null : String(result?.data?.message || 'TextBee could not accept the SMS.').slice(0, 500);
      const update = sessionDb.prepare('UPDATE sms_jobs SET status=?, sent_at=?, error=?, gateway_message_id=?, updated_at=? WHERE id=?');
      sessionDb.transaction(() => ids.forEach(id => update.run(finalStatus, accepted > 0 ? stamp : null, finalError, batch, new Date().toISOString(), id)))();

      const log = sessionDb.prepare('INSERT INTO activity (kind, message, created_at) VALUES (?, ?, ?)');
      log.run('sms', `${accepted} staff SMS update accepted by TextBee, sent by ${req.session.user.name}${invalid.length ? `; ${invalid.length} staff number(s) skipped` : ''}`, stamp);

      res.json({
        ok: accepted > 0,
        sent: accepted,
        accepted,
        failed: Math.max(0, eligible.length - accepted) + invalid.length,
        skipped: invalid.length,
        batchId: batch
      });
    } catch (error) {
      if (ids.length) {
        sessionDb.prepare("UPDATE sms_jobs SET status='failed', error=?, updated_at=? WHERE id IN (" + ids.map(() => '?').join(',') + ")").run(String(error.message).slice(0, 500), new Date().toISOString(), ...ids);
      }
      next(error);
    }
  });

  router.get('/api/staff/sms/history', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to view SMS history.' });
    const rows = sessionDb.prepare(`
      SELECT s.id, s.recipient, s.message, s.status, s.sent_at, s.error, s.gateway_message_id,
             s.created_at, st.name AS staff_name
      FROM sms_jobs s
      LEFT JOIN staff st ON st.id = s.staff_id
      ORDER BY s.id DESC
      LIMIT 100
    `).all();
    res.json(rows);
  });

  stack.splice(healthIndex, 0, ...router._router.stack);
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installSmsRoutes(this);
  return originalListen.apply(this, args);
};

require.cache[require.resolve('express-session')].exports = patchedSession;
require('./server.js');

// Optional emergency administrator password reset. This runs after server.js has
// initialized the users table, avoiding the fresh-database startup failure.
if (process.env.ADMIN_RESET_PASSWORD) {
  require('./admin-password-reset.js');
}
