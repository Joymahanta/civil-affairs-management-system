const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');
const expressSession = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(expressSession);
const { installComplaintSmsHooks } = require('./complaint-sms-patch');
const { installComplaintHistoryHooks } = require('./complaint-history-patch');
const { installStaffDesignationRepair } = require('./staff-designation-patch');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const sessionDb = new BetterSqlite3(path.join(dataDir, 'civil-affairs.db'));
sessionDb.pragma('journal_mode = WAL');

const originalSend = express.response.send;
express.response.send = function sendWithoutAuthCaching(body) {
  const req = this.req;
  const isAuthApi = req && req.originalUrl && req.originalUrl.startsWith('/api/auth/');
  const isAdminHtml = req && req.path === '/admin.html';
  if (isAuthApi) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    this.set('Pragma', 'no-cache');
    this.set('Expires', '0');
  }
  if (isAdminHtml && typeof body === 'string' && !body.includes('/complaint-history.js')) {
    body = body.replace('</body>', '<script src="/complaint-history.js" defer></script><script src="/workforce-form-patch.js"></script></body>');
    this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
  return originalSend.call(this, body);
};

function patchedSession(options = {}) {
  if (options.store) return expressSession(options);
  return expressSession({ ...options, store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }) });
}

sessionDb.exec(`CREATE TABLE IF NOT EXISTS sms_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, message TEXT NOT NULL, staff_id INTEGER, created_by INTEGER, status TEXT NOT NULL DEFAULT 'queued', sent_at TEXT, error TEXT, gateway_message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);

function normalizeIndianPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]\d{9}$/.test(digits.slice(2))) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

async function textbeeRequest(endpoint, options = {}) {
  const apiKey = String(process.env.TEXTBEE_API_KEY || '').trim();
  if (!apiKey) { const error = new Error('TextBee is not configured. Add TEXTBEE_API_KEY to the Render service environment.'); error.status = 503; throw error; }
  const response = await fetch(`https://api.textbee.dev/api/v1/gateway${endpoint}`, { ...options, headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload?.error || payload?.message || `TextBee returned HTTP ${response.status}.`); error.status = response.status === 429 ? 429 : 502; error.details = payload; throw error; }
  return payload;
}

function installSmsRoutes(app) {
  app.get('/api/staff/sms/status', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to view SMS status.' });
    if (!process.env.TEXTBEE_API_KEY) return res.json({ configured: false, message: 'TextBee API key is not configured.' });
    try {
      const [devices, stats] = await Promise.all([textbeeRequest('/devices'), textbeeRequest('/stats')]);
      const rows = Array.isArray(devices?.data) ? devices.data : [];
      const device = rows.find(item => item.isDefault) || rows.find(item => item.enabled) || rows[0] || null;
      res.json({ configured: true, connected: Boolean(device?.enabled), device: device ? { id: device._id, name: device.name || `${device.manufacturer || device.brand || ''} ${device.model || ''}`.trim(), enabled: device.enabled, isDefault: device.isDefault } : null, totals: stats?.data ? { sent: stats.data.totalSentSMSCount, received: stats.data.totalReceivedSMSCount, devices: stats.data.totalDeviceCount } : null });
    } catch (error) { res.status(error.status || 502).json({ configured: true, connected: false, error: error.message }); }
  });
  app.post('/api/staff/sms', async (req, res, next) => {
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
      const body = { recipients: eligible.map(person => person.recipient), message };
      if (process.env.TEXTBEE_DEVICE_ID) body.deviceId = process.env.TEXTBEE_DEVICE_ID;
      if (process.env.TEXTBEE_SIM_SUBSCRIPTION_ID) body.simSubscriptionId = Number(process.env.TEXTBEE_SIM_SUBSCRIPTION_ID);
      const result = await textbeeRequest('/send-sms', { method: 'POST', body: JSON.stringify(body) });
      const data = result?.data || {};
      const batch = data.smsBatchId || null;
      const successCount = Number(data.successCount ?? data.recipientCount ?? (data.success ? eligible.length : 0));
      const failureCount = Number(data.failureCount ?? 0);
      const accepted = Math.max(0, Math.min(eligible.length, successCount - failureCount));
      const finalStatus = accepted > 0 ? 'accepted' : 'failed';
      const finalError = accepted > 0 ? null : String(data.message || 'TextBee could not accept the SMS.').slice(0, 500);
      const update = sessionDb.prepare('UPDATE sms_jobs SET status=?, sent_at=?, error=?, gateway_message_id=?, updated_at=? WHERE id=?');
      sessionDb.transaction(() => ids.forEach(id => update.run(finalStatus, accepted > 0 ? stamp : null, finalError, batch, new Date().toISOString(), id)))();
      if (accepted > 0) { const updateStaff = sessionDb.prepare('UPDATE staff SET last_sms_at=? WHERE id=?'); eligible.slice(0, accepted).forEach(person => updateStaff.run(stamp, person.id)); }
      sessionDb.prepare('INSERT INTO activity (kind, message, created_at) VALUES (?, ?, ?)').run('sms', `${accepted} staff SMS update accepted by TextBee, sent by ${req.session.user.name}${invalid.length ? `; ${invalid.length} staff number(s) skipped` : ''}`, stamp);
      res.json({ ok: accepted > 0, sent: accepted, accepted, failed: Math.max(0, eligible.length - accepted) + invalid.length, skipped: invalid.length, batchId: batch });
    } catch (error) {
      if (ids.length) sessionDb.prepare("UPDATE sms_jobs SET status='failed', error=?, updated_at=? WHERE id IN (" + ids.map(() => '?').join(',') + ")").run(String(error.message).slice(0, 500), new Date().toISOString(), ...ids);
      next(error);
    }
  });
  app.get('/api/staff/sms/history', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to view SMS history.' });
    res.json(sessionDb.prepare('SELECT s.id, s.recipient, s.message, s.status, s.sent_at, s.error, s.gateway_message_id, s.created_at, st.name AS staff_name FROM sms_jobs s LEFT JOIN staff st ON st.id=s.staff_id ORDER BY s.id DESC LIMIT 100').all());
  });
  app.post('/api/staff/sms/sync', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to sync SMS delivery status.' });
    const pending = sessionDb.prepare("SELECT DISTINCT gateway_message_id FROM sms_jobs WHERE gateway_message_id IS NOT NULL AND status IN ('accepted','pending','sending') LIMIT 50").all();
    if (!pending.length) return res.json({ updated: 0 });
    const updates = sessionDb.prepare('UPDATE sms_jobs SET status=?, error=?, updated_at=? WHERE gateway_message_id=?');
    let updated = 0;
    for (const row of pending) {
      try {
        const query = new URLSearchParams({ smsBatchId: row.gateway_message_id, direction: 'sent', limit: '100' });
        const payload = await textbeeRequest(`/messages?${query.toString()}`);
        const messages = Array.isArray(payload?.data) ? payload.data : [];
        for (const message of messages) {
          const status = String(message.status || '').toLowerCase();
          if (!status) continue;
          const mapped = ['pending','dispatched','sent','delivered','failed','unknown'].includes(status) ? status : 'unknown';
          updated += updates.run(mapped, mapped === 'failed' ? String(message.error || 'Delivery failed').slice(0,500) : null, new Date().toISOString(), row.gateway_message_id).changes;
        }
      } catch (error) { console.error('[sms] delivery sync error:', error.message || error); }
    }
    res.json({ updated });
  });
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) { installSmsRoutes(this); return originalListen.apply(this, args); };

require.cache[require.resolve('express-session')].exports = patchedSession;
require('./server.js');
installStaffDesignationRepair();
installComplaintSmsHooks();
installComplaintHistoryHooks();

if (process.env.ADMIN_RESET_PASSWORD) require('./admin-password-reset.js');
