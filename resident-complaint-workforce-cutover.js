const express = require('express');
const { getDb } = require('./firebase/firestore');
const fs = require('fs');

const now = () => new Date().toISOString();
const required = value => String(value ?? '').trim().length > 0;
const digits = value => String(value || '').replace(/\D/g, '');
const cleanPhone = value => {
  const d = digits(value);
  if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]\d{9}$/.test(d.slice(2))) return `+${d}`;
  return d.length >= 10 ? `+${d}` : '';
};
const residentSession = req => req.session?.user?.role === 'Resident';
const adminSession = req => ['Administrator', 'Sub-administrator'].includes(req.session?.user?.role);

async function rows(name) {
  const snap = await getDb().collection(name).get();
  return snap.docs.map(doc => ({ ...doc.data(), id: Number(doc.get('id') ?? doc.id) }));
}
async function nextId(name) {
  const data = await rows(name);
  return data.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}
async function staffForResident(req) {
  const wantedId = Number(req.session.user.staffId ?? req.session.user.id);
  if (!Number.isInteger(wantedId)) return null;
  const staff = await rows('staff');
  return staff.find(row => Number(row.id) === wantedId) || null;
}
function employeeIdFor(staff) {
  return String(staff.employee_id || staff.employeeId || staff.staff_id || staff.staffId || `STPS-EMP-${String(staff.id).padStart(3, '0')}`).trim();
}
async function activity(kind, message) {
  const id = await nextId('activity');
  await getDb().collection('activity').doc(String(id)).set({ id, kind, message, created_at: now() });
}

function install(app) {
  const db = getDb();
  app.post('/api/complaints', async (req, res, next) => {
    // This route is intentionally first. It enforces the signed-in Workforce identity
    // before the older complaint handler can see a resident-created complaint.
    if (!residentSession(req) && !adminSession(req)) return next();
    try {
      const b = req.body || {};
      if (!required(b.type) || !required(b.category) || !required(b.location) || !required(b.description)) {
        return res.status(400).json({ error: 'Please complete all required complaint details.' });
      }

      let identity = {
        name: String(b.reporterName || '').trim(),
        phone: cleanPhone(b.reporterPhone),
        email: String(b.reporterEmail || '').trim(),
        staffId: null,
        employeeId: '',
        department: '',
        designation: ''
      };

      if (residentSession(req)) {
        const staff = await staffForResident(req);
        if (!staff) return res.status(401).json({ error: 'Your Workforce record could not be found. Please sign in again.' });
        identity = {
          name: String(staff.name || '').trim(),
          phone: cleanPhone(staff.phone),
          email: String(staff.email || '').trim(),
          staffId: Number(staff.id),
          employeeId: employeeIdFor(staff),
          department: String(staff.department || '').trim(),
          designation: String(staff.designation || '').trim()
        };
        if (!identity.name || !identity.phone) return res.status(400).json({ error: 'Your Workforce record is missing a name or valid mobile number. Please contact the Civil Office.' });
      } else if (!identity.phone) {
        return res.status(400).json({ error: 'Enter a valid mobile number.' });
      }

      const existing = await rows('complaints');
      const id = await nextId('complaints');
      const reference = `CA-${new Date().getFullYear()}-${String(1800 + existing.length + 1).padStart(4, '0')}`;
      const stamp = now();
      const priority = /(no water|live wire|fire|flood|danger|emergency)/i.test(String(b.description)) ? 'Urgent' : 'Medium';
      const row = {
        id,
        reference,
        type: String(b.type).trim(),
        category: String(b.category).trim(),
        location: String(b.location).trim(),
        reporter_name: identity.name,
        reporter_phone: identity.phone,
        reporter_email: identity.email,
        description: String(b.description).trim(),
        photo_name: String(b.photoName || '').trim(),
        latitude: b.latitude ?? null,
        longitude: b.longitude ?? null,
        priority,
        status: 'New',
        assigned_to: null,
        staff_id: identity.staffId,
        employee_id: identity.employeeId,
        reporter_department: identity.department,
        reporter_designation: identity.designation,
        created_at: stamp,
        updated_at: stamp
      };
      await db.collection('complaints').doc(String(id)).set(row);
      await activity('complaint', `${reference} received — ${row.category}`);
      const hid = await nextId('complaint_history');
      await db.collection('complaint_history').doc(String(hid)).set({
        id: hid,
        complaint_id: id,
        complaint_reference: reference,
        event_type: 'created',
        action: 'created',
        message: residentSession(req) ? `Complaint created by ${identity.name} (${identity.employeeId})` : `Complaint created by ${req.session.user.name || req.session.user.role}`,
        details: row.description,
        created_at: stamp,
        changed_by_name: req.session.user.name || identity.name,
        staff_id: identity.staffId,
        employee_id: identity.employeeId
      });
      return res.status(201).json({ reference, priority, status: 'New', ...row });
    } catch (error) {
      console.error('[resident complaint workforce cutover]', error);
      return res.status(500).json({ error: error.message || 'Could not create complaint.' });
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  try { install(this); } catch (error) { console.error('[resident complaint workforce cutover] install', error); }
  return originalListen.apply(this, args);
};

// Load the resident identity helper without requiring a manual index.html edit.
const originalSendFile = express.response.sendFile;
express.response.sendFile = function (filePath, options, callback) {
  const req = this.req;
  if (!(req && req.path === '/' && typeof filePath === 'string' && /(?:^|[\\/])index\.html$/.test(filePath))) {
    return originalSendFile.call(this, filePath, options, callback);
  }
  const cb = typeof options === 'function' ? options : callback;
  fs.readFile(filePath, 'utf8', (error, body) => {
    if (error) {
      if (typeof cb === 'function') cb(error); else this.status(500).end();
      return;
    }
    if (!body.includes('/resident-complaint-workforce.js')) {
      body = body.replace('</body>', '<script src="/resident-complaint-workforce.js?v=1" defer></script></body>');
    }
    this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    this.type('html');
    this.send(body);
    if (typeof cb === 'function') cb();
  });
  return this;
};
