const crypto = require('crypto');

function installQrRoutes(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS township_qr (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);

  const now = () => new Date().toISOString();
  const makeCode = type => {
    const prefix = String(type || 'location').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'LOC';
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  };
  const cleanData = body => {
    const allowed = ['quarterNumber','renterName','renterPhone','renterEmail','shopNumber','ownerName','ownerPhone','dustbinId','gateName','gateType','openingTime','closingTime','gatekeeperName','rules','busStopName','routes','location','sector','description','details','category'];
    const out = {};
    allowed.forEach(key => { if (body && body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') out[key] = body[key]; });
    if (Array.isArray(out.rules)) out.rules = out.rules.map(String).map(x => x.trim()).filter(Boolean);
    if (Array.isArray(out.routes)) out.routes = out.routes.map(String).map(x => x.trim()).filter(Boolean);
    return out;
  };

  app.get('/api/qr', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to manage township QR codes.' });
    const rows = db.prepare('SELECT id,code,type,title,data_json,active,created_at,updated_at FROM township_qr ORDER BY id DESC').all();
    res.json(rows.map(row => ({ ...row, data: JSON.parse(row.data_json) })));
  });

  app.post('/api/qr', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to manage township QR codes.' });
    const type = String(req.body?.type || 'location').trim().toLowerCase();
    const title = String(req.body?.title || '').trim();
    const data = cleanData(req.body?.data || req.body || {});
    if (!title) return res.status(400).json({ error: 'Enter a QR title.' });
    const allowedTypes = ['quarter','shop','dustbin','gate','bus-stop','location'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Unsupported QR type.' });
    let code = makeCode(type);
    while (db.prepare('SELECT 1 FROM township_qr WHERE code=?').get(code)) code = makeCode(type);
    const timestamp = now();
    const result = db.prepare('INSERT INTO township_qr (code,type,title,data_json,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)');
    result.run(code, type, title, JSON.stringify(data), timestamp, timestamp);
    res.json({ ok: true, id: result.run.lastInsertRowid, code, type, title, data, url: `${req.protocol}://${req.get('host')}/qr/${encodeURIComponent(code)}` });
  });

  app.put('/api/qr/:id', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to manage township QR codes.' });
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM township_qr WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'QR code not found.' });
    const type = String(req.body?.type || existing.type).trim().toLowerCase();
    const title = String(req.body?.title || existing.title).trim();
    const data = cleanData(req.body?.data || req.body || {});
    db.prepare('UPDATE township_qr SET type=?,title=?,data_json=?,updated_at=? WHERE id=?').run(type, title, JSON.stringify(data), now(), id);
    res.json({ ok: true, id, code: existing.code, type, title, data, url: `${req.protocol}://${req.get('host')}/qr/${encodeURIComponent(existing.code)}` });
  });

  app.delete('/api/qr/:id', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to manage township QR codes.' });
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM township_qr WHERE id=?').run(id);
    if (!result.changes) return res.status(404).json({ error: 'QR code not found.' });
    res.json({ ok: true });
  });

  app.get('/api/qr/resolve/:code', (req, res) => {
    const row = db.prepare('SELECT id,code,type,title,data_json,active,created_at,updated_at FROM township_qr WHERE code=? AND active=1').get(String(req.params.code || '').trim().toUpperCase());
    if (!row) return res.status(404).json({ error: 'This township QR code is not registered or is inactive.' });
    res.json({ id: row.id, code: row.code, type: row.type, title: row.title, data: JSON.parse(row.data_json), url: `${req.protocol}://${req.get('host')}/qr/${encodeURIComponent(row.code)}` });
  });

  app.get('/qr/:code', (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const row = db.prepare('SELECT code,type,title FROM township_qr WHERE code=? AND active=1').get(code);
    if (!row) return res.status(404).send('<h1>QR code not found</h1><p>This township QR code is not registered.</p>');
    const target = `/?qr=${encodeURIComponent(row.code)}`;
    res.redirect(302, target);
  });
}

module.exports = { installQrRoutes };
