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

// SMS gateway queue. The Android companion polls this queue and sends messages
// through the phone's SIM. No SMS provider or per-message API is required.
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

function smsGatewayToken(req) {
  return String(req.get('x-gateway-token') || req.query.token || '');
}
function smsGatewayAuthorized(req) {
  const expected = String(process.env.SMS_GATEWAY_TOKEN || '');
  return Boolean(expected && smsGatewayToken(req) && smsGatewayToken(req) === expected);
}
function installSmsGatewayRoutes(app) {
  const stack = app._router?.stack;
  if (!stack) return;
  const healthIndex = stack.findIndex(layer => layer.route?.path === '/api/health');
  if (healthIndex < 0) return;
  const router = express.Router();

  router.post('/api/staff/sms', (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to send SMS updates.' });
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Enter an SMS message.' });
    if (message.length > 1000) return res.status(400).json({ error: 'SMS message is too long.' });
    const staff = sessionDb.prepare("SELECT id, name, phone FROM staff WHERE attendance='Present' AND phone IS NOT NULL AND trim(phone) != '' ORDER BY id").all();
    if (!staff.length) return res.status(400).json({ error: 'No on-duty staff have a mobile number.' });
    if (!process.env.SMS_GATEWAY_TOKEN) return res.status(503).json({ error: 'SMS gateway is not configured yet. Set SMS_GATEWAY_TOKEN in the service environment.' });
    try {
      const stamp = new Date().toISOString();
      const insert = sessionDb.prepare('INSERT INTO sms_jobs (recipient, message, staff_id, created_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const create = sessionDb.transaction(() => staff.map(person => insert.run(person.phone, message, person.id, req.session.user.id, 'queued', stamp, stamp).lastInsertRowid));
      const ids = create();
      const log = sessionDb.prepare('INSERT INTO activity (kind, message, created_at) VALUES (?, ?, ?)');
      log.run('sms', `${ids.length} staff SMS update queued by ${req.session.user.name}` , stamp);
      res.json({ ok: true, queued: ids.length, sent: ids.length });
    } catch (error) { next(error); }
  });

  router.get('/api/sms/gateway/jobs', (req, res) => {
    if (!smsGatewayAuthorized(req)) return res.status(401).json({ error: 'Invalid SMS gateway token.' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
    const stamp = new Date().toISOString();
    sessionDb.prepare("UPDATE sms_jobs SET status='queued', claimed_at=NULL, updated_at=? WHERE status='sending' AND claimed_at < datetime(?, '-5 minutes')").run(stamp, stamp);
    const claim = sessionDb.transaction(() => {
      const rows = sessionDb.prepare("SELECT id, recipient, message FROM sms_jobs WHERE status='queued' ORDER BY id LIMIT ?").all(limit);
      if (!rows.length) return [];
      const update = sessionDb.prepare("UPDATE sms_jobs SET status='sending', claimed_at=?, updated_at=? WHERE id=? AND status='queued'");
      return rows.filter(row => update.run(stamp, stamp, row.id).changes).map(row => ({ ...row, status: 'sending' }));
    });
    res.json({ jobs: claim() });
  });

  router.post('/api/sms/gateway/result', (req, res) => {
    if (!smsGatewayAuthorized(req)) return res.status(401).json({ error: 'Invalid SMS gateway token.' });
    const id = Number(req.body?.id);
    if (!id) return res.status(400).json({ error: 'Job id is required.' });
    const status = req.body?.success ? 'sent' : 'failed';
    const error = String(req.body?.error || '').slice(0, 500) || null;
    const messageId = String(req.body?.messageId || '').slice(0, 200) || null;
    const stamp = new Date().toISOString();
    const result = sessionDb.prepare('UPDATE sms_jobs SET status=?, sent_at=?, error=?, gateway_message_id=?, updated_at=? WHERE id=?').run(status, status === 'sent' ? stamp : null, error, messageId, stamp, id);
    if (!result.changes) return res.status(404).json({ error: 'SMS job not found.' });
    if (status === 'sent') {
      const staffId = sessionDb.prepare('SELECT staff_id FROM sms_jobs WHERE id=?').get(id)?.staff_id;
      if (staffId) sessionDb.prepare('UPDATE staff SET last_sms_at=? WHERE id=?').run(stamp, staffId);
    }
    res.json({ ok: true });
  });

  router.get('/api/sms/gateway/health', (req, res) => {
    if (!smsGatewayAuthorized(req)) return res.status(401).json({ error: 'Invalid SMS gateway token.' });
    const queued = sessionDb.prepare("SELECT COUNT(*) AS count FROM sms_jobs WHERE status IN ('queued','sending')").get().count;
    res.json({ ok: true, queued });
  });

  stack.splice(healthIndex, 0, ...router._router.stack);
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installSmsGatewayRoutes(this);
  return originalListen.apply(this, args);
};

require.cache[require.resolve('express-session')].exports = patchedSession;
require('./server.js');

// Optional emergency administrator password reset. This runs after server.js has
// initialized the users table, avoiding the fresh-database startup failure.
if (process.env.ADMIN_RESET_PASSWORD) {
  require('./admin-password-reset.js');
}
