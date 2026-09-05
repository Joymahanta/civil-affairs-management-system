const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'civil-affairs.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'civil-affairs.sid',
  secret: process.env.SESSION_SECRET || 'replace-this-development-session-secret-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

function now() { return new Date().toISOString(); }
function reference() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) AS count FROM complaints').get();
  return `CA-${year}-${String(1800 + row.count + 1).padStart(4, '0')}`;
}
function logActivity(kind, message) {
  db.prepare('INSERT INTO activity (kind, message, created_at) VALUES (?, ?, ?)').run(kind, message, now());
}
function required(value) { return typeof value === 'string' && value.trim().length > 0; }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  next();
}
const loginAttempts = new Map();
function loginAllowed(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt || Date.now() > attempt.resetAt) return true;
  return attempt.count < 5;
}
function recordFailedLogin(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt || Date.now() > attempt.resetAt) loginAttempts.set(ip, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
  else attempt.count += 1;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    reporter_name TEXT NOT NULL,
    reporter_phone TEXT NOT NULL,
    reporter_email TEXT,
    description TEXT NOT NULL,
    photo_name TEXT,
    latitude REAL,
    longitude REAL,
    priority TEXT NOT NULL DEFAULT 'Medium',
    status TEXT NOT NULL DEFAULT 'New',
    assigned_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    phone TEXT NOT NULL,
    attendance TEXT NOT NULL DEFAULT 'Present',
    current_task TEXT,
    last_sms_at TEXT
  );
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    holder TEXT,
    issued_on TEXT,
    expected_return TEXT,
    condition TEXT NOT NULL DEFAULT 'Good',
    status TEXT NOT NULL DEFAULT 'Available'
  );
  CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tender_no TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    closing_date TEXT,
    bids INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Draft',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;

if (process.env.RESET_ADMIN_PASSWORD === 'true' && required(initialAdminPassword)) {
  const admin = db.prepare(
    'SELECT id FROM users WHERE lower(email) = lower(?)'
  ).get('admin@civilaffairs.local');

  if (admin) {
    db.prepare(
      'UPDATE users SET password_hash=?, updated_at=? WHERE id=?'
    ).run(passwordHash(initialAdminPassword), now(), admin.id);

    console.log('Admin password reset from INITIAL_ADMIN_PASSWORD.');
  } else {
    const stamp = now();

    db.prepare(
      'INSERT INTO users (email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      'admin@civilaffairs.local',
      passwordHash(initialAdminPassword),
      'Civil Office Administrator',
      'Administrator',
      stamp,
      stamp
    );

    console.log('Initial administrator account created.');
  }
} else if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) {
  const password = initialAdminPassword || 'CivilAffairs2026!';
  const stamp = now();

  db.prepare(
    'INSERT INTO users (email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    'admin@civilaffairs.local',
    passwordHash(password),
    'Civil Office Administrator',
    'Administrator',
    stamp,
    stamp
  );
}

if (db.prepare('SELECT COUNT(*) AS count FROM staff').get().count === 0) {
  const addStaff = db.prepare('INSERT INTO staff (name, department, phone, attendance, current_task) VALUES (?, ?, ?, ?, ?)');
  [
    ['R. Kumar', 'Waterworks', '9876500101', 'Present', 'Investigating F/12, Sector 4'],
    ['A. Singh', 'Electrical', '9876500102', 'Present', 'Electrical repair at G/08'],
    ['S. Verma', 'Inspection', '9876500103', 'Present', 'Inspection at Market SM58'],
    ['M. Prasad', 'Sanitation', '9876500104', 'Present', 'Collection route, Sector 2'],
    ['J. Khan', 'Roads', '9876500105', 'Absent', null],
    ['P. Devi', 'Horticulture', '9876500106', 'Present', 'Bush trimming, Sector 5']
  ].forEach(row => addStaff.run(...row));

  const addEquipment = db.prepare('INSERT INTO equipment (asset_code, name, holder, issued_on, expected_return, condition, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  [
    ['EQ-0017', 'Water pump, 5HP', 'R. Kumar', '2026-09-04', '2026-09-04', 'Good', 'In use'],
    ['EQ-0034', 'Portable generator', 'Electric team', '2026-09-04', '2026-09-05', 'Good', 'In use'],
    ['EQ-0021', 'Garbage compactor', 'Sanitation unit', '2026-09-02', '2026-09-05', 'Service due', 'Review'],
    ['EQ-0046', 'Road cutter', null, null, null, 'Good', 'Available']
  ].forEach(row => addEquipment.run(...row));

  const addTender = db.prepare('INSERT INTO tenders (tender_no, scope, closing_date, bids, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['STPS/T/26/041', 'Quarter plumbing renewal', '2026-09-15', 4, 'Open'],
    ['STPS/T/26/038', 'Road patchwork, Sector 2', '2026-09-08', 6, 'Evaluation'],
    ['STPS/T/26/034', 'Park landscaping', '2026-08-28', 3, 'Awarded']
  ].forEach(row => addTender.run(...row, now()));
}

if (db.prepare('SELECT COUNT(*) AS count FROM complaints').get().count === 0) {
  const addComplaint = db.prepare(`INSERT INTO complaints
    (reference,type,category,location,reporter_name,reporter_phone,reporter_email,description,priority,status,assigned_to,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rows = [
    ['CA-2026-1842', 'Quarter maintenance', 'Water supply', 'F/12, Sector 4', 'F/12 tenant', '9876501001', '', 'No water supply since morning.', 'Urgent', 'Assigned', 'R. Kumar'],
    ['CA-2026-1839', 'Shop operation', 'Shop operation', 'Market SM58', 'Rakesh S.', '9876501002', '', 'Unapproved late-night operation reported.', 'Medium', 'In progress', 'S. Verma'],
    ['CA-2026-1836', 'Garbage / sanitation', 'Garbage / sanitation', 'Park Road, Sector 2', 'Anonymous', '0000000000', '', 'Garbage collection has not happened.', 'Medium', 'New', null],
    ['CA-2026-1832', 'Quarter maintenance', 'Electrical', 'G/08, Sector 3', 'G/08 tenant', '9876501003', '', 'Fluctuating supply in living room.', 'High', 'In progress', 'A. Singh'],
    ['CA-2026-1829', 'Public issue', 'Pothole / road issue', 'Community Hall', 'Meena D.', '9876501004', '', 'Large pothole on approach road.', 'Low', 'Resolved', 'J. Khan']
  ];
  rows.forEach((r, i) => { const stamp = new Date(Date.now() - (i + 1) * 3600000).toISOString(); addComplaint.run(...r, stamp, stamp); });
  logActivity('resolved', 'CA-2026-1817 resolved — Streetlight repair at Sector 1 Gate');
  logActivity('assignment', 'Waterworks crew assigned to F/12, Sector 4');
  logActivity('equipment', 'Portable generator returned in good condition');
}

app.get('/api/health', (_, res) => res.json({ ok: true, database: 'connected' }));
app.get('/api/auth/session', (req, res) => {
  if (!req.session?.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!loginAllowed(ip)) return res.status(429).json({ error: 'Too many attempts. Please wait 10 minutes before trying again.' });
  const { email, password } = req.body;
  if (!required(email) || !required(password)) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim());
  if (!user || !passwordMatches(password, user.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Email or password is not correct.' });
  }
  loginAttempts.delete(ip);
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not create a secure session.' });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    logActivity('security', `${user.name} signed in to the Civil Office console`);
    return res.json({ authenticated: true, user: req.session.user });
  });
});
app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: 'Could not end this session.' });
    res.clearCookie('civil-affairs.sid');
    res.json({ ok: true });
  });
});
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!required(currentPassword) || !required(newPassword)) return res.status(400).json({ error: 'Both password fields are required.' });
  if (newPassword.length < 12) return res.status(400).json({ error: 'Use at least 12 characters for the new password.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!user || !passwordMatches(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Your current password is incorrect.' });
  db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(passwordHash(newPassword), now(), user.id);
  logActivity('security', `${user.name} changed the Civil Office password`);
  res.json({ ok: true, message: 'Password changed successfully.' });
});

app.get('/api/summary', requireAuth, (_, res) => {
  const open = db.prepare("SELECT COUNT(*) AS count FROM complaints WHERE status != 'Resolved'").get().count;
  const today = new Date().toISOString().slice(0, 10);
  const receivedToday = db.prepare('SELECT COUNT(*) AS count FROM complaints WHERE substr(created_at,1,10) = ?').get(today).count;
  const staffOnDuty = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE attendance = 'Present'").get().count;
  const staffTotal = db.prepare('SELECT COUNT(*) AS count FROM staff').get().count;
  const equipmentInUse = db.prepare("SELECT COUNT(*) AS count FROM equipment WHERE status = 'In use'").get().count;
  const equipmentTotal = db.prepare('SELECT COUNT(*) AS count FROM equipment').get().count;
  const priority = db.prepare("SELECT * FROM complaints WHERE status != 'Resolved' ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, created_at DESC LIMIT 5").all();
  const activity = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT 5').all();
  res.json({ open, receivedToday, staffOnDuty, staffTotal, equipmentInUse, equipmentTotal, completion: 82, priority, activity });
});

app.get('/api/complaints', requireAuth, (req, res) => {
  const { status, type, q } = req.query;
  const conditions = []; const values = [];
  if (status && status !== 'All') { conditions.push('status = ?'); values.push(status); }
  if (type && type !== 'All') { conditions.push('type = ?'); values.push(type); }
  if (q) { conditions.push('(reference LIKE ? OR location LIKE ? OR reporter_name LIKE ?)'); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT * FROM complaints ${where} ORDER BY created_at DESC`).all(...values));
});

app.get('/api/complaints/:reference', (req, res) => {
  const isAdmin = Boolean(req.session?.user);
  const phone = String(req.query.phone || '').replace(/[^0-9]/g, '');
  const complaint = db.prepare('SELECT * FROM complaints WHERE reference = ?').get(req.params.reference.toUpperCase());
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  if (!isAdmin && complaint.reporter_phone.replace(/[^0-9]/g, '') !== phone) return res.status(403).json({ error: 'The reference and phone number do not match.' });
  res.json(complaint);
});

app.post('/api/complaints', requireAuth, (req, res) => {
  const { type, category, location, reporterName, reporterPhone, reporterEmail = '', description, priority = 'Medium' } = req.body;
  if (![type, category, location, reporterName, reporterPhone, description].every(required)) return res.status(400).json({ error: 'Please complete all required complaint fields.' });
  if (!['Low', 'Medium', 'High', 'Urgent'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  const stamp = now();
  const ref = reference();
  db.prepare(`INSERT INTO complaints (reference,type,category,location,reporter_name,reporter_phone,reporter_email,description,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'New',?,?)`).run(ref, type.trim(), category.trim(), location.trim(), reporterName.trim(), reporterPhone.trim(), reporterEmail.trim(), description.trim(), priority, stamp, stamp);
  logActivity('complaint', `${ref} registered — ${category.trim()}`);
  res.status(201).json(db.prepare('SELECT * FROM complaints WHERE reference=?').get(ref));
});

app.patch('/api/complaints/:id', requireAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM complaints WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Complaint not found.' });
  const { status = current.status, priority = current.priority, assignedTo = current.assigned_to } = req.body;
  if (!['New', 'Assigned', 'In progress', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (!['Low', 'Medium', 'High', 'Urgent'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  db.prepare('UPDATE complaints SET status=?, priority=?, assigned_to=?, updated_at=? WHERE id=?').run(status, priority, assignedTo || null, now(), current.id);
  logActivity('complaint', `${current.reference} updated — ${status}${assignedTo ? ` / assigned to ${assignedTo}` : ''}`);
  res.json(db.prepare('SELECT * FROM complaints WHERE id=?').get(current.id));
});

app.get('/api/staff', requireAuth, (_, res) => res.json(db.prepare('SELECT * FROM staff ORDER BY name').all()));
app.post('/api/staff', requireAuth, (req, res) => {
  const { name, department, phone, attendance = 'Present', currentTask = '' } = req.body;
  if (![name, department, phone].every(required)) return res.status(400).json({ error: 'Name, department and phone are required.' });
  if (!['Present', 'Absent'].includes(attendance)) return res.status(400).json({ error: 'Invalid attendance value.' });
  const result = db.prepare('INSERT INTO staff (name, department, phone, attendance, current_task) VALUES (?, ?, ?, ?, ?)').run(
    name.trim(), department.trim(), phone.trim(), attendance, String(currentTask).trim() || null
  );
  logActivity('staff', `Staff member added — ${name.trim()}`);
  res.status(201).json(db.prepare('SELECT * FROM staff WHERE id=?').get(result.lastInsertRowid));
});
app.patch('/api/staff/:id', requireAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Staff member not found.' });
  const { attendance = current.attendance, currentTask = current.current_task } = req.body;
  if (!['Present', 'Absent'].includes(attendance)) return res.status(400).json({ error: 'Invalid attendance value.' });
  db.prepare('UPDATE staff SET attendance=?, current_task=? WHERE id=?').run(attendance, currentTask || null, current.id);
  logActivity('staff', `${current.name} marked ${attendance}${currentTask ? ` — task: ${currentTask}` : ''}`);
  res.json(db.prepare('SELECT * FROM staff WHERE id=?').get(current.id));
});
app.post('/api/staff/sms', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!required(message)) return res.status(400).json({ error: 'Message is required.' });
  const stamp = now();
  db.prepare("UPDATE staff SET last_sms_at=? WHERE attendance='Present'").run(stamp);
  logActivity('staff', `SMS task update recorded for on-duty staff — ${message.trim()}`);
  res.json({ ok: true, message: 'SMS dispatch recorded.', sentAt: stamp });
});

app.get('/api/equipment', requireAuth, (_, res) => res.json(db.prepare('SELECT * FROM equipment ORDER BY asset_code').all()));
app.patch('/api/equipment/:id', requireAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Equipment not found.' });
  const { holder = current.holder, expectedReturn = current.expected_return, condition = current.condition, status = current.status } = req.body;
  if (!['Good', 'Service due', 'Needs repair'].includes(condition)) return res.status(400).json({ error: 'Invalid condition.' });
  if (!['Available', 'In use', 'Review', 'Repair'].includes(status)) return res.status(400).json({ error: 'Invalid equipment status.' });
  db.prepare('UPDATE equipment SET holder=?, expected_return=?, condition=?, status=? WHERE id=?').run(holder || null, expectedReturn || null, condition, status, current.id);
  logActivity('equipment', `${current.asset_code} updated — ${status}`);
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(current.id));
});

app.get('/api/tenders', requireAuth, (_, res) => res.json(db.prepare('SELECT * FROM tenders ORDER BY closing_date DESC, id DESC').all()));
app.post('/api/tenders', requireAuth, (req, res) => {
  const { scope, closingDate } = req.body;
  if (!required(scope) || !required(closingDate)) return res.status(400).json({ error: 'Scope and closing date are required.' });
  const next = db.prepare('SELECT COUNT(*) AS count FROM tenders').get().count + 35;
  const tenderNo = `STPS/T/${String(new Date().getFullYear()).slice(-2)}/${String(next).padStart(3, '0')}`;
  db.prepare('INSERT INTO tenders (tender_no, scope, closing_date, bids, status, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(tenderNo, scope.trim(), closingDate, 'Draft', now());
  logActivity('tender', `${tenderNo} created — ${scope.trim()}`);
  res.status(201).json(db.prepare('SELECT * FROM tenders WHERE tender_no=?').get(tenderNo));
});
app.patch('/api/tenders/:id', requireAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM tenders WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Tender not found.' });
  const { bids = current.bids, status = current.status } = req.body;
  if (!Number.isInteger(Number(bids)) || Number(bids) < 0) return res.status(400).json({ error: 'Invalid bid count.' });
  if (!['Draft', 'Open', 'Evaluation', 'Awarded', 'Closed'].includes(status)) return res.status(400).json({ error: 'Invalid tender status.' });
  db.prepare('UPDATE tenders SET bids=?, status=? WHERE id=?').run(Number(bids), status, current.id);
  logActivity('tender', `${current.tender_no} updated — ${status}`);
  res.json(db.prepare('SELECT * FROM tenders WHERE id=?').get(current.id));
});

app.get('/api/insights', requireAuth, (_, res) => {
  const byCategory = db.prepare("SELECT category, COUNT(*) AS count FROM complaints WHERE status != 'Resolved' GROUP BY category ORDER BY count DESC").all();
  const urgent = db.prepare("SELECT COUNT(*) AS count FROM complaints WHERE priority IN ('Urgent','High') AND status != 'Resolved'").get().count;
  const absent = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE attendance='Absent'").get().count;
  const repair = db.prepare("SELECT COUNT(*) AS count FROM equipment WHERE status='Repair' OR condition='Needs repair'").get().count;
  res.json({ focus: urgent ? `${urgent} high-priority complaint${urgent === 1 ? '' : 's'} need attention.` : 'No urgent complaints are currently open.', patterns: byCategory, guardrails: [`${absent} staff member${absent === 1 ? '' : 's'} marked absent`, `${repair} equipment item${repair === 1 ? '' : 's'} marked for repair`, 'AI suggestions remain review-only and do not auto-change records.'] });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', requireAuth, (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Civil Affairs server running on port ${PORT}`));
