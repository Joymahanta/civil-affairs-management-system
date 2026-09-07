const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');
const { getDb } = require('./firebase/firestore');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const sqlitePath = path.join(dataDir, 'civil-affairs.db');

function publicQrUrl(req, code, type, data, title) {
  const params = new URLSearchParams({ type, code, title: title || '' });
  ['quarterNumber', 'shopNumber', 'dustbinId', 'gateName', 'gateType', 'openingTime', 'closingTime', 'gatekeeperName', 'busStopName', 'location', 'category', 'description', 'details'].forEach(key => {
    if (data?.[key]) params.set(key, String(data[key]));
  });
  if (Array.isArray(data?.routes) && data.routes.length) params.set('details', `Routes: ${data.routes.join(', ')}`);
  if (Array.isArray(data?.rules) && data.rules.length) params.set('rules', data.rules.join('|'));
  return `${req.protocol}://${req.get('host')}/?${params.toString()}`;
}

function cleanData(body = {}) {
  const allowed = [
    'quarterNumber', 'renterName', 'renterPhone', 'renterEmail',
    'shopNumber', 'ownerName', 'ownerPhone', 'dustbinId', 'gateName',
    'gateType', 'openingTime', 'closingTime', 'gatekeeperName', 'rules',
    'busStopName', 'routes', 'location', 'sector', 'description', 'details', 'category'
  ];
  const out = {};
  allowed.forEach(key => {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') out[key] = body[key];
  });
  if (Array.isArray(out.rules)) out.rules = out.rules.map(String).map(x => x.trim()).filter(Boolean);
  if (Array.isArray(out.routes)) out.routes = out.routes.map(String).map(x => x.trim()).filter(Boolean);
  return out;
}

function makeCode(type) {
  return `${String(type || 'location').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'LOC'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function signedIn(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to manage township QR codes.' });
  next();
}

function installQrRoutes(app) {
  const router = express.Router();

  router.get('/api/qr', signedIn, async (req, res) => {
    try {
      const snapshot = await getDb().collection('township_qr').get();
      const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: Number(doc.get('id') ?? doc.id) }));
      rows.sort((a, b) => Number(b.id) - Number(a.id));
      res.json(rows.map(row => ({ ...row, url: publicQrUrl(req, row.code, row.type, row.data || {}, row.title) })));
    } catch (error) {
      console.error('[firestore qr GET]', error);
      res.status(500).json({ error: error.message || 'Could not load QR codes.' });
    }
  });

  router.post('/api/qr', signedIn, async (req, res) => {
    try {
      const type = String(req.body?.type || 'location').trim().toLowerCase();
      const title = String(req.body?.title || '').trim();
      const data = cleanData(req.body?.data || {});
      if (!title) return res.status(400).json({ error: 'Enter a QR title.' });
      if (!['quarter', 'shop', 'dustbin', 'gate', 'bus-stop', 'location'].includes(type)) return res.status(400).json({ error: 'Unsupported QR type.' });

      const db = getDb();
      let code = makeCode(type);
      while (!(await db.collection('township_qr').where('code', '==', code).limit(1).get())).code = makeCode(type);
      const existing = await db.collection('township_qr').where('code', '==', code).limit(1).get();
      while (!existing.empty) {
        code = makeCode(type);
        const retry = await db.collection('township_qr').where('code', '==', code).limit(1).get();
        if (retry.empty) break;
      }
      const idSnapshot = await db.collection('township_qr').orderBy('id', 'desc').limit(1).get();
      const id = idSnapshot.empty ? 1 : Number(idSnapshot.docs[0].get('id')) + 1;
      const timestamp = new Date().toISOString();
      const row = { id, code, type, title, data, active: 1, created_at: timestamp, updated_at: timestamp };
      await db.collection('township_qr').doc(String(id)).set(row);
      res.json({ ok: true, ...row, url: publicQrUrl(req, code, type, data, title) });
    } catch (error) {
      console.error('[firestore qr POST]', error);
      res.status(500).json({ error: error.message || 'Could not create QR code.' });
    }
  });

  router.put('/api/qr/:id', signedIn, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ref = getDb().collection('township_qr').doc(String(id));
      const snapshot = await ref.get();
      if (!snapshot.exists) return res.status(404).json({ error: 'QR code not found.' });
      const existing = snapshot.data();
      const type = String(req.body?.type || existing.type || 'location').trim().toLowerCase();
      const title = String(req.body?.title ?? existing.title ?? '').trim();
      const data = req.body?.data === undefined ? (existing.data || {}) : cleanData(req.body.data || {});
      if (!title) return res.status(400).json({ error: 'Enter a QR title.' });
      if (!['quarter', 'shop', 'dustbin', 'gate', 'bus-stop', 'location'].includes(type)) return res.status(400).json({ error: 'Unsupported QR type.' });
      const updated_at = new Date().toISOString();
      await ref.update({ type, title, data, updated_at });
      const row = { ...existing, id, type, title, data, updated_at };
      res.json({ ok: true, ...row, url: publicQrUrl(req, row.code, type, data, title) });
    } catch (error) {
      console.error('[firestore qr PUT]', error);
      res.status(500).json({ error: error.message || 'Could not update QR code.' });
    }
  });

  router.delete('/api/qr/:id', signedIn, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ref = getDb().collection('township_qr').doc(String(id));
      const snapshot = await ref.get();
      if (!snapshot.exists) return res.status(404).json({ error: 'QR code not found.' });
      await ref.delete();
      res.json({ ok: true });
    } catch (error) {
      console.error('[firestore qr DELETE]', error);
      res.status(500).json({ error: error.message || 'Could not delete QR code.' });
    }
  });

  router.get('/api/qr/resolve/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      const snapshot = await getDb().collection('township_qr').where('code', '==', code).where('active', '==', 1).limit(1).get();
      if (snapshot.empty) return res.status(404).json({ error: 'This township QR code is not registered or is inactive.' });
      const data = snapshot.docs[0].data();
      res.json({ id: Number(data.id ?? snapshot.docs[0].id), code: data.code, type: data.type, title: data.title, data: data.data || {}, url: publicQrUrl(req, data.code, data.type, data.data || {}, data.title) });
    } catch (error) {
      console.error('[firestore qr resolve]', error);
      res.status(500).json({ error: error.message || 'Could not resolve QR code.' });
    }
  });

  router.get('/qr/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      const snapshot = await getDb().collection('township_qr').where('code', '==', code).where('active', '==', 1).limit(1).get();
      if (snapshot.empty) return res.status(404).send('<h1>QR code not found</h1><p>This township QR code is not registered.</p>');
      const data = snapshot.docs[0].data();
      res.redirect(302, publicQrUrl(req, data.code, data.type, data.data || {}, data.title));
    } catch (error) {
      console.error('[firestore public qr]', error);
      res.status(500).send('<h1>QR code unavailable</h1>');
    }
  });

  const stack = app._router?.stack;
  if (!stack) return;
  const firstRoute = stack.findIndex(layer => layer.route);
  const insertAt = firstRoute >= 0 ? firstRoute : stack.length;
  stack.splice(insertAt, 0, ...router.stack);
}

async function migrateExistingQrToFirestore() {
  if (!fs.existsSync(sqlitePath)) return;
  const sqlite = new BetterSqlite3(sqlitePath, { readonly: true });
  try {
    const table = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='township_qr'").get();
    if (!table) return;
    const records = sqlite.prepare('SELECT id, code, type, title, data_json, active, created_at, updated_at FROM township_qr ORDER BY id ASC').all();
    if (!records.length) return;
    const collection = getDb().collection('township_qr');
    for (const record of records) {
      const ref = collection.doc(String(record.id));
      const existing = await ref.get();
      if (existing.exists) continue;
      let data = {};
      try { data = JSON.parse(record.data_json || '{}'); } catch (_) { data = {}; }
      await ref.set({
        id: Number(record.id),
        code: String(record.code),
        type: String(record.type),
        title: String(record.title || ''),
        data,
        active: Number(record.active) ? 1 : 0,
        created_at: record.created_at || new Date().toISOString(),
        updated_at: record.updated_at || record.created_at || new Date().toISOString(),
        _source: 'sqlite',
        _source_table: 'township_qr',
        _migrated_at: new Date().toISOString()
      });
      console.log(`[firestore qr migration] imported ${record.code}`);
    }
  } finally {
    sqlite.close();
  }
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  installQrRoutes(this);
  const server = originalListen.apply(this, args);
  setImmediate(() => migrateExistingQrToFirestore().catch(error => console.error('[firestore qr migration]', error)));
  return server;
};
