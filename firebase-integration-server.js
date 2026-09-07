const express = require('express');
const { firebaseConfigured, requireFirebaseApp } = require('./firebase/admin');
const { getDb } = require('./firebase/firestore');
const { verifyIdToken } = require('./firebase/auth');

function requireAdministrator(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  if (req.session.user.role !== 'Administrator') return res.status(403).json({ error: 'Administrator access is required for this action.' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  next();
}

function stamp() {
  return new Date().toISOString();
}

async function nextNumericId(collectionName) {
  const snapshot = await getDb().collection(collectionName).orderBy('id', 'desc').limit(1).get();
  if (snapshot.empty) return 1;
  const value = Number(snapshot.docs[0].get('id'));
  return Number.isFinite(value) ? value + 1 : 1;
}

async function findNameMatch(collectionName, name, excludeId = null) {
  const wanted = String(name || '').trim().toLowerCase();
  const snapshot = await getDb().collection(collectionName).get();
  return snapshot.docs.find(doc => {
    if (excludeId !== null && doc.id === String(excludeId)) return false;
    return String(doc.get('name') || '').trim().toLowerCase() === wanted;
  }) || null;
}

async function loadDepartment(db, departmentName) {
  const wanted = String(departmentName || '').trim().toLowerCase();
  if (!wanted) return null;
  const snapshot = await db.collection('departments').get();
  return snapshot.docs.find(doc => String(doc.get('name') || '').trim().toLowerCase() === wanted) || null;
}

async function loadDesignation(db, designationId) {
  const id = Number(designationId);
  if (!Number.isInteger(id) || id < 1) return null;
  const ref = db.collection('designations').doc(String(id));
  const snapshot = await ref.get();
  return snapshot.exists ? snapshot : null;
}

async function readStaffRows() {
  const db = getDb();
  const [staffSnapshot, designationSnapshot, departmentSnapshot] = await Promise.all([
    db.collection('staff').get(),
    db.collection('designations').get(),
    db.collection('departments').get()
  ]);
  const designations = new Map();
  designationSnapshot.forEach(doc => {
    const data = doc.data();
    designations.set(Number(data.id ?? doc.id), data);
  });
  const departments = new Map();
  departmentSnapshot.forEach(doc => {
    const data = doc.data();
    departments.set(Number(data.id ?? doc.id), data.name || '');
  });

  const rows = staffSnapshot.docs.map(doc => {
    const data = doc.data();
    const id = Number(data.id ?? doc.id);
    const designationId = Number(data.designation_id);
    const designation = designations.get(designationId);
    const departmentId = designation ? Number(designation.department_id) : NaN;
    return {
      ...data,
      id,
      designation_id: Number.isFinite(designationId) ? designationId : null,
      designation: designation?.name || data.designation || 'Unassigned',
      department_id: Number.isFinite(departmentId) ? departmentId : null,
      department: data.department || departments.get(departmentId) || ''
    };
  });
  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return rows;
}

function installWorkforceRoutes(app) {
  const router = express.Router();

  router.get('/api/departments', requireAdministrator, async (_req, res) => {
    try {
      const db = getDb();
      const [departmentSnapshot, designationSnapshot] = await Promise.all([
        db.collection('departments').get(),
        db.collection('designations').get()
      ]);
      const counts = new Map();
      designationSnapshot.forEach(doc => {
        const departmentId = Number(doc.get('department_id'));
        if (Number.isFinite(departmentId)) counts.set(departmentId, (counts.get(departmentId) || 0) + 1);
      });
      const rows = departmentSnapshot.docs.map(doc => {
        const data = doc.data();
        const id = Number(data.id ?? doc.id);
        return { ...data, id, designation_count: counts.get(id) || 0 };
      });
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      res.json(rows);
    } catch (error) {
      console.error('[firestore departments GET]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not load departments.' });
    }
  });

  router.post('/api/departments', requireAdministrator, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      if (!name) return res.status(400).json({ error: 'Department name is required.' });
      const db = getDb();
      if (await findNameMatch('departments', name)) return res.status(409).json({ error: 'A department with this name already exists.' });
      const id = await nextNumericId('departments');
      const createdAt = stamp();
      const row = { id, name, description, name_lower: name.toLowerCase(), created_at: createdAt, updated_at: createdAt };
      await db.collection('departments').doc(String(id)).set(row);
      res.status(201).json(row);
    } catch (error) {
      console.error('[firestore departments POST]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not create department.' });
    }
  });

  router.put('/api/departments/:id', requireAdministrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid department ID.' });
      const db = getDb();
      const ref = db.collection('departments').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Department not found.' });
      const updates = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Department name is required.' });
        if (await findNameMatch('departments', name, id)) return res.status(409).json({ error: 'A department with this name already exists.' });
        updates.name = name;
        updates.name_lower = name.toLowerCase();
      }
      if (req.body?.description !== undefined) updates.description = String(req.body.description || '').trim();
      updates.updated_at = stamp();
      await ref.update(updates);
      res.json({ id, ...current.data(), ...updates });
    } catch (error) {
      console.error('[firestore departments PUT]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not update department.' });
    }
  });

  router.delete('/api/departments/:id', requireAdministrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid department ID.' });
      const db = getDb();
      const ref = db.collection('departments').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Department not found.' });
      const linked = await db.collection('designations').where('department_id', '==', id).limit(1).get();
      if (!linked.empty) return res.status(409).json({ error: 'Cannot delete a department that has designations assigned to it.' });
      await ref.delete();
      res.json({ deleted: true, id });
    } catch (error) {
      console.error('[firestore departments DELETE]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not delete department.' });
    }
  });

  router.get('/api/designations', requireAdministrator, async (_req, res) => {
    try {
      const db = getDb();
      const [designationSnapshot, departmentSnapshot] = await Promise.all([
        db.collection('designations').get(),
        db.collection('departments').get()
      ]);
      const departments = new Map();
      departmentSnapshot.forEach(doc => {
        const data = doc.data();
        departments.set(Number(data.id ?? doc.id), data.name || 'Unassigned');
      });
      const rows = designationSnapshot.docs.map(doc => {
        const data = doc.data();
        const id = Number(data.id ?? doc.id);
        const departmentId = Number(data.department_id);
        return {
          ...data,
          id,
          department_id: Number.isFinite(departmentId) ? departmentId : null,
          department: departments.get(departmentId) || data.department || 'Unassigned'
        };
      });
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      res.json(rows);
    } catch (error) {
      console.error('[firestore designations GET]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not load designations.' });
    }
  });

  router.post('/api/designations', requireAdministrator, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      const departmentId = Number(req.body?.departmentId);
      if (!name || !Number.isInteger(departmentId) || departmentId < 1) return res.status(400).json({ error: 'Designation name and department are required.' });
      const db = getDb();
      const department = await db.collection('departments').doc(String(departmentId)).get();
      if (!department.exists) return res.status(400).json({ error: 'Selected department does not exist.' });
      if (await findNameMatch('designations', name)) return res.status(409).json({ error: 'A designation with this name already exists.' });
      const id = await nextNumericId('designations');
      const createdAt = stamp();
      const row = { id, name, description, department_id: departmentId, name_lower: name.toLowerCase(), created_at: createdAt, updated_at: createdAt };
      await db.collection('designations').doc(String(id)).set(row);
      res.status(201).json(row);
    } catch (error) {
      console.error('[firestore designations POST]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not create designation.' });
    }
  });

  router.put('/api/designations/:id', requireAdministrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid designation ID.' });
      const db = getDb();
      const ref = db.collection('designations').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Designation not found.' });
      const updates = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Designation name is required.' });
        if (await findNameMatch('designations', name, id)) return res.status(409).json({ error: 'A designation with this name already exists.' });
        updates.name = name;
        updates.name_lower = name.toLowerCase();
      }
      if (req.body?.description !== undefined) updates.description = String(req.body.description || '').trim();
      if (req.body?.departmentId !== undefined) {
        const departmentId = Number(req.body.departmentId);
        if (!Number.isInteger(departmentId) || departmentId < 1) return res.status(400).json({ error: 'Selected department does not exist.' });
        const department = await db.collection('departments').doc(String(departmentId)).get();
        if (!department.exists) return res.status(400).json({ error: 'Selected department does not exist.' });
        updates.department_id = departmentId;
      }
      updates.updated_at = stamp();
      await ref.update(updates);
      res.json({ id, ...current.data(), ...updates });
    } catch (error) {
      console.error('[firestore designations PUT]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not update designation.' });
    }
  });

  router.delete('/api/designations/:id', requireAdministrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid designation ID.' });
      const db = getDb();
      const ref = db.collection('designations').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Designation not found.' });
      const linked = await db.collection('staff').where('designation_id', '==', id).limit(1).get();
      if (!linked.empty) return res.status(409).json({ error: 'Cannot delete a designation that is assigned to staff.' });
      await ref.delete();
      res.json({ deleted: true, id });
    } catch (error) {
      console.error('[firestore designations DELETE]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not delete designation.' });
    }
  });

  router.get('/api/staff', requireAuth, async (_req, res) => {
    try {
      res.json(await readStaffRows());
    } catch (error) {
      console.error('[firestore staff GET]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not load staff.' });
    }
  });

  router.post('/api/staff', requireAuth, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const departmentName = String(req.body?.department || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const attendance = String(req.body?.attendance || 'Present').trim() || 'Present';
      const currentTask = req.body?.currentTask == null ? null : String(req.body.currentTask).trim() || null;
      const email = req.body?.email == null ? null : String(req.body.email).trim() || null;
      const designationId = Number(req.body?.designationId);
      if (!name || !departmentName || !phone || !Number.isInteger(designationId) || designationId < 1) {
        return res.status(400).json({ error: 'Name, department, designation, and phone are required.' });
      }
      const db = getDb();
      const department = await loadDepartment(db, departmentName);
      if (!department) return res.status(400).json({ error: 'Selected department does not exist.' });
      const designation = await loadDesignation(db, designationId);
      if (!designation) return res.status(400).json({ error: 'Selected designation does not exist.' });
      const designationDepartmentId = Number(designation.get('department_id'));
      const departmentId = Number(department.get('id') ?? department.id);
      if (Number.isFinite(designationDepartmentId) && Number.isFinite(departmentId) && designationDepartmentId !== departmentId) {
        return res.status(400).json({ error: 'Selected designation does not belong to the selected department.' });
      }
      const id = await nextNumericId('staff');
      const row = {
        id,
        name,
        designation_id: designationId,
        department: departmentName,
        phone,
        attendance,
        current_task: currentTask,
        last_sms_at: null,
        email
      };
      await db.collection('staff').doc(String(id)).set(row);
      res.status(201).json({ ...row, designation: designation.get('name') || 'Unassigned' });
    } catch (error) {
      console.error('[firestore staff POST]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not create staff member.' });
    }
  });

  router.patch('/api/staff/:id', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid staff ID.' });
      const db = getDb();
      const ref = db.collection('staff').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Staff member not found.' });
      const updates = {};
      const body = req.body || {};

      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Staff name is required.' });
        updates.name = name;
      }
      if (body.phone !== undefined) {
        const phone = String(body.phone || '').trim();
        if (!phone) return res.status(400).json({ error: 'Staff phone is required.' });
        updates.phone = phone;
      }
      if (body.email !== undefined) updates.email = String(body.email || '').trim() || null;
      if (body.attendance !== undefined) updates.attendance = String(body.attendance || '').trim() || 'Present';
      if (body.currentTask !== undefined) updates.current_task = String(body.currentTask || '').trim() || null;

      let departmentName = body.department !== undefined ? String(body.department || '').trim() : String(current.get('department') || '').trim();
      let designationId = body.designationId !== undefined ? Number(body.designationId) : Number(current.get('designation_id'));
      if (!departmentName || !Number.isInteger(designationId) || designationId < 1) {
        return res.status(400).json({ error: 'Department and designation are required.' });
      }
      if (body.department !== undefined || body.designationId !== undefined) {
        const department = await loadDepartment(db, departmentName);
        if (!department) return res.status(400).json({ error: 'Selected department does not exist.' });
        const designation = await loadDesignation(db, designationId);
        if (!designation) return res.status(400).json({ error: 'Selected designation does not exist.' });
        const designationDepartmentId = Number(designation.get('department_id'));
        const departmentId = Number(department.get('id') ?? department.id);
        if (Number.isFinite(designationDepartmentId) && Number.isFinite(departmentId) && designationDepartmentId !== departmentId) {
          return res.status(400).json({ error: 'Selected designation does not belong to the selected department.' });
        }
        updates.department = departmentName;
        updates.designation_id = designationId;
      }

      if (!Object.keys(updates).length) return res.json({ id, ...current.data() });
      await ref.update(updates);
      res.json({ id, ...current.data(), ...updates });
    } catch (error) {
      console.error('[firestore staff PATCH]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not update staff member.' });
    }
  });

  router.delete('/api/staff/:id', requireAdministrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid staff ID.' });
      const ref = getDb().collection('staff').doc(String(id));
      const current = await ref.get();
      if (!current.exists) return res.status(404).json({ error: 'Staff member not found.' });
      await ref.delete();
      res.json({ deleted: true, id });
    } catch (error) {
      console.error('[firestore staff DELETE]', error);
      res.status(error.status || 500).json({ error: error.message || 'Could not delete staff member.' });
    }
  });

  const stack = app._router?.stack;
  if (!stack) return;
  const firstRoute = stack.findIndex(layer => layer.route);
  const insertAt = firstRoute >= 0 ? firstRoute : stack.length;
  stack.splice(insertAt, 0, ...router.stack);
}

function install(app) {
  app.get('/api/firebase/status', (_req, res) => {
    res.json({
      configured: firebaseConfigured(),
      services: {
        authentication: firebaseConfigured(),
        firestore: firebaseConfigured(),
        messaging: firebaseConfigured()
      }
    });
  });

  app.get('/api/firebase/config', (_req, res) => {
    const config = {
      apiKey: process.env.FIREBASE_WEB_API_KEY || '',
      authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_WEB_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
      storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_WEB_APP_ID || '',
      measurementId: process.env.FIREBASE_WEB_MEASUREMENT_ID || ''
    };
    const configured = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'].every(key => config[key]);
    if (!configured) return res.status(503).json({ configured: false, error: 'Firebase web configuration is not configured yet.' });
    res.json({ configured: true, config });
  });

  app.get('/api/firebase/me', async (req, res) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Firebase ID token is required.' });
    try {
      const decoded = await verifyIdToken(token);
      res.json({ authenticated: true, user: { uid: decoded.uid, email: decoded.email || null, phoneNumber: decoded.phone_number || null } });
    } catch (error) {
      const status = error.code === 'FIREBASE_NOT_CONFIGURED' ? 503 : 401;
      res.status(status).json({ error: status === 503 ? 'Firebase authentication is not configured.' : 'Your Firebase sign-in is invalid or expired.' });
    }
  });

  app.get('/api/firebase/health', (_req, res) => {
    try {
      requireFirebaseApp();
      res.json({ ok: true, adminSdk: 'initialized' });
    } catch (error) {
      res.status(error.status || 503).json({ ok: false, error: error.message });
    }
  });

  installWorkforceRoutes(app);
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  install(this);
  return originalListen.apply(this, args);
};
