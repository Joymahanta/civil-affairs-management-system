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
function requireAdministrator(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  if (req.session.user.role !== 'Administrator') return res.status(403).json({ error: 'Administrator access is required for this action.' });
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
  CREATE TABLE IF NOT EXISTS designations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    designation_id INTEGER,
    department TEXT NOT NULL,
    phone TEXT NOT NULL,
    attendance TEXT NOT NULL DEFAULT 'Present',
    current_task TEXT,
    last_sms_at TEXT,
    FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE SET NULL
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

const staffColumns = db.prepare('PRAGMA table_info(staff)').all();
if (!staffColumns.some(column => column.name === 'designation_id')) {
  db.exec('ALTER TABLE staff ADD COLUMN designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL');
}

const designationDefaults = [
  ['Civil Office Administrator', 'Leads Civil Office administration and operations.'],
  ['Assistant Administrator', 'Supports Civil Office administration and daily operations.'],
  ['Junior Engineer', 'Handles engineering inspections and field works.'],
  ['Senior Engineer', 'Supervises engineering works and technical review.'],
  ['Sanitation Officer', 'Supervises sanitation and waste-management operations.'],
  ['Electrical Supervisor', 'Supervises electrical maintenance and repairs.'],
  ['Waterworks Supervisor', 'Supervises water-supply and waterworks operations.'],
  ['Field Inspector', 'Conducts field inspections and reports findings.'],
  ['Office Assistant', 'Supports office administration and resident service.'],
  ['Data Entry Operator', 'Maintains digital records and data-entry workflows.']
];
const addDesignation = db.prepare('INSERT OR IGNORE INTO designations (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)');
designationDefaults.forEach(([name, description]) => addDesignation.run(name, description, now(), now()));

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
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ error: 'Could not save your secure session.' });
      logActivity('security', `${user.name} signed in to the Civil Office console`);
      return res.json({ authenticated: true, user: req.session.user });
    });
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
  const completion = 82;
  const priority = db.prepare("SELECT * FROM complaints WHERE status != 'Resolved' ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, created_at DESC LIMIT 5").all();
  const activity = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT 5').all();
  res.json({ open, receivedToday, staffOnDuty, staffTotal, equipmentInUse, equipmentTotal, completion, priority, activity });
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
  if (!complaint) return res.status(404).json({ error: 'No complaint was found with that reference number.' });
  if (!isAdmin && (!phone || phone !== String(complaint.reporter_phone).replace(/[^0-9]/g, ''))) return res.status(401).json({ error: 'Enter the mobile number used when the complaint was registered.' });
  if (!isAdmin) return res.json({ reference: complaint.reference, status: complaint.status, assigned_to: complaint.assigned_to, updated_at: complaint.updated_at, category: complaint.category, location: complaint.location });
  res.json(complaint);
});

app.post('/api/complaints', (req, res) => {
  const { type, category, location, reporterName, reporterPhone, reporterEmail = '', description, photoName = '', latitude = null, longitude = null } = req.body;
  if (![type, category, location, reporterName, reporterPhone, description].every(required)) return res.status(400).json({ error: 'Please complete all required complaint details.' });
  if (!/^[0-9+\-\s]{8,16}$/.test(reporterPhone.trim())) return res.status(400).json({ error: 'Enter a valid mobile number.' });
  const urgencyWords = /(no water|live wire|fire|flood|danger|emergency)/i;
  const priority = urgencyWords.test(description) ? 'Urgent' : 'Medium';
  const stamp = now();
  const referenceNo = reference();
  db.prepare(`INSERT INTO complaints (reference,type,category,location,reporter_name,reporter_phone,reporter_email,description,photo_name,latitude,longitude,priority,status,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(referenceNo, type, category, location, reporterName.trim(), reporterPhone.trim(), reporterEmail.trim(), description.trim(), photoName, latitude, longitude, priority, 'New', null, stamp, stamp);
  logActivity('complaint', `${referenceNo} received — ${category}`);
  res.status(201).json({ reference: referenceNo, priority, status: 'New' });
});

app.patch('/api/complaints/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM complaints WHERE id=?').get(id);
  if (!current) return res.status(404).json({ error: 'Complaint not found.' });
  const allowed = ['priority', 'status', 'assigned_to', 'category', 'location', 'description'];
  const updates = []; const values = [];
  allowed.forEach(field => { if (Object.prototype.hasOwnProperty.call(req.body, field)) { updates.push(`${field}=?`); values.push(req.body[field]); } });
  if (!updates.length) return res.status(400).json({ error: 'No complaint changes were provided.' });
  updates.push('updated_at=?'); values.push(now(), id);
  db.prepare(`UPDATE complaints SET ${updates.join(', ')} WHERE id=?`).run(...values);
  logActivity('complaint', `${current.reference} updated by ${req.session.user.name}`);
  res.json(db.prepare('SELECT * FROM complaints WHERE id=?').get(id));
});

app.get('/api/staff', requireAuth, (_, res) => {
  res.json(db.prepare(`SELECT s.*, d.name AS designation FROM staff s LEFT JOIN designations d ON d.id = s.designation_id ORDER BY s.id`).all());
});
app.post('/api/staff', requireAuth, (req, res) => {
  const { name, designationId = null, department, phone, attendance = 'Present', currentTask = '' } = req.body;
  if (![name, department, phone].every(required)) return res.status(400).json({ error: 'Name, department, and phone are required.' });
  const designation = designationId ? db.prepare('SELECT id FROM designations WHERE id=?').get(Number(designationId)) : null;
  if (designationId && !designation) return res.status(400).json({ error: 'Selected designation does not exist.' });
  const result = db.prepare('INSERT INTO staff (name, designation_id, department, phone, attendance, current_task) VALUES (?, ?, ?, ?, ?, ?)').run(name.trim(), designation?.id || null, department.trim(), phone.trim(), attendance, currentTask.trim());
  logActivity('staff', `${name.trim()} added to the workforce`);
  res.status(201).json(db.prepare(`SELECT s.*, d.name AS designation FROM staff s LEFT JOIN designations d ON d.id=s.designation_id WHERE s.id=?`).get(result.lastInsertRowid));
});
app.patch('/api/staff/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM staff WHERE id=?').get(id);
  if (!current) return res.status(404).json({ error: 'Staff member not found.' });
  const map = { name: 'name', designationId: 'designation_id', department: 'department', phone: 'phone', attendance: 'attendance', currentTask: 'current_task' };
  const updates = []; const values = [];
  Object.entries(map).forEach(([input, column]) => {
    if (Object.prototype.hasOwnProperty.call(req.body, input)) {
      if (input === 'designationId') {
        const value = req.body[input] === '' || req.body[input] === null ? null : Number(req.body[input]);
        if (value !== null && !db.prepare('SELECT id FROM designations WHERE id=?').get(value)) return;
        updates.push(`${column}=?`); values.push(value);
      } else {
        updates.push(`${column}=?`); values.push(typeof req.body[input] === 'string' ? req.body[input].trim() : req.body[input]);
      }
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'No staff changes were provided.' });
  values.push(id);
  db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id=?`).run(...values);
  res.json(db.prepare(`SELECT s.*, d.name AS designation FROM staff s LEFT JOIN designations d ON d.id=s.designation_id WHERE s.id=?`).get(id));
});

app.get('/api/designations', requireAuth, (_, res) => {
  res.json(db.prepare('SELECT d.*, COUNT(s.id) AS staff_count FROM designations d LEFT JOIN staff s ON s.designation_id=d.id GROUP BY d.id ORDER BY d.name').all());
});
app.post('/api/designations', requireAuth, (req, res) => {
  const { name, description = '' } = req.body;
  if (!required(name)) return res.status(400).json({ error: 'Designation name is required.' });
  try {
    const stamp = now();
    const result = db.prepare('INSERT INTO designations (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name.trim(), description.trim(), stamp, stamp);
    res.status(201).json(db.prepare('SELECT d.*, 0 AS staff_count FROM designations d WHERE id=?').get(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That designation already exists.' });
    throw error;
  }
});
app.patch('/api/designations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM designations WHERE id=?').get(id);
  if (!current) return res.status(404).json({ error: 'Designation not found.' });
  const name = required(req.body.name) ? req.body.name.trim() : current.name;
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : current.description || '';
  try {
    db.prepare('UPDATE designations SET name=?, description=?, updated_at=? WHERE id=?').run(name, description, now(), id);
    res.json(db.prepare('SELECT d.*, (SELECT COUNT(*) FROM staff WHERE designation_id=d.id) AS staff_count FROM designations d WHERE d.id=?').get(id));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That designation already exists.' });
    throw error;
  }
});
app.delete('/api/designations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const count = db.prepare('SELECT COUNT(*) AS count FROM staff WHERE designation_id=?').get(id).count;
  if (count > 0) return res.status(409).json({ error: 'This designation is assigned to staff and cannot be deleted.' });
  const result = db.prepare('DELETE FROM designations WHERE id=?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Designation not found.' });
  res.json({ ok: true });
});

app.get('/api/equipment', requireAuth, (_, res) => res.json(db.prepare('SELECT * FROM equipment ORDER BY id').all()));
app.patch('/api/equipment/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const fields = ['holder', 'issued_on', 'expected_return', 'condition', 'status'];
  const updates = []; const values = [];
  fields.forEach(field => { if (Object.prototype.hasOwnProperty.call(req.body, field)) { updates.push(`${field}=?`); values.push(req.body[field]); } });
  if (!updates.length) return res.status(400).json({ error: 'No equipment changes were provided.' });
  values.push(id);
  db.prepare(`UPDATE equipment SET ${updates.join(', ')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM equipment WHERE id=?').get(id));
});

app.get('/api/tenders', requireAuth, (_, res) => res.json(db.prepare('SELECT * FROM tenders ORDER BY id DESC').all()));
app.patch('/api/tenders/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const fields = ['closing_date', 'bids', 'status', 'scope'];
  const updates = []; const values = [];
  fields.forEach(field => { if (Object.prototype.hasOwnProperty.call(req.body, field)) { updates.push(`${field}=?`); values.push(req.body[field]); } });
  if (!updates.length) return res.status(400).json({ error: 'No tender changes were provided.' });
  values.push(id);
  db.prepare(`UPDATE tenders SET ${updates.join(', ')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM tenders WHERE id=?').get(id));
});

app.get('/api/users', requireAdministrator, (_, res) => {
  res.json(db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY lower(name), id').all());
});
app.post('/api/users', requireAdministrator, (req, res) => {
  const { email, name, password, role = 'Sub-administrator' } = req.body;
  if (![email, name, password].every(required)) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 12) return res.status(400).json({ error: 'Use at least 12 characters for the password.' });
  if (!['Administrator', 'Sub-administrator'].includes(role)) return res.status(400).json({ error: 'Invalid user role.' });
  try {
    const stamp = now();
    const result = db.prepare('INSERT INTO users (email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(email.trim(), passwordHash(password), name.trim(), role, stamp, stamp);
    logActivity('security', `${name.trim()} created as ${role}`);
    res.status(201).json(db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users WHERE id=?').get(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'A user with that email already exists.' });
    throw error;
  }
});
app.patch('/api/users/:id', requireAdministrator, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (req.body.role && !['Administrator', 'Sub-administrator'].includes(req.body.role)) return res.status(400).json({ error: 'Invalid user role.' });
  if (req.body.role && id === req.session.user.id && req.body.role !== req.session.user.role) return res.status(403).json({ error: 'You cannot change your own role.' });
  if (target.role === 'Administrator' && req.body.role === 'Sub-administrator') return res.status(403).json({ error: 'Administrator accounts cannot be demoted here.' });
  const fields = []; const values = [];
  if (required(req.body.name)) { fields.push('name=?'); values.push(req.body.name.trim()); }
  if (required(req.body.email)) { fields.push('email=?'); values.push(req.body.email.trim()); }
  if (req.body.role) { fields.push('role=?'); values.push(req.body.role); }
  if (required(req.body.password)) {
    if (req.body.password.length < 12) return res.status(400).json({ error: 'Use at least 12 characters for the password.' });
    fields.push('password_hash=?'); values.push(passwordHash(req.body.password));
  }
  if (!fields.length) return res.status(400).json({ error: 'No user changes were provided.' });
  fields.push('updated_at=?'); values.push(now(), id);
  try {
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...values);
    res.json(db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users WHERE id=?').get(id));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'A user with that email already exists.' });
    throw error;
  }
});
app.delete('/api/users/:id', requireAdministrator, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(403).json({ error: 'You cannot delete your own account.' });
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'Administrator') return res.status(403).json({ error: 'Administrator accounts cannot be deleted here.' });
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='Administrator'").get().count;
  if (target.role === 'Administrator' && adminCount <= 1) return res.status(403).json({ error: 'The last Administrator cannot be deleted.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

app.get('/api/insights', requireAuth, (_, res) => {
  const byCategory = db.prepare('SELECT category, COUNT(*) AS count FROM complaints GROUP BY category ORDER BY count DESC').all();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM complaints GROUP BY status ORDER BY count DESC').all();
  res.json({ byCategory, byStatus });
});

app.use(express.static(path.join(__dirname, 'public')));

function renderAdminPage(fileName) {
  const filePath = path.join(__dirname, 'public', fileName);
  let html = fs.readFileSync(filePath, 'utf8');
  const accessScript = '<script src="/access-management.js"></script>';
  if (!html.includes('/access-management.js')) html = html.replace('</body>', `${accessScript}</body>`);
  return html;
}

app.get('/admin.html', requireAuth, (req, res) => {
  res.type('html').send(renderAdminPage('admin.html'));
});
app.get('/admin', requireAuth, (req, res) => {
  res.type('html').send(renderAdminPage('admin.html'));
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const target = req.path === '/' ? 'index.html' : req.path.slice(1);
  const safeTarget = path.normalize(target).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safeTarget);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return res.sendFile(filePath);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => console.log(`Civil Affairs server listening on ${PORT}`));
