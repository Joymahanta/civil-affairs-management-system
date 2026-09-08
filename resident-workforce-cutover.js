const express = require('express');
const { getDb } = require('./firebase/firestore');

const now = () => new Date().toISOString();
const digits = value => String(value || '').replace(/\D/g, '');
const phone10 = value => { const d = digits(value); return d.startsWith('91') && d.length === 12 ? d.slice(2) : d; };
const email = value => String(value || '').trim().toLowerCase();
const required = value => String(value ?? '').trim().length > 0;
const residentSession = req => req.session?.user?.role === 'Resident';
const adminSession = req => ['Administrator','Sub-administrator'].includes(req.session?.user?.role);
const administrator = req => req.session?.user?.role === 'Administrator';

async function rows(name) {
  const snap = await getDb().collection(name).get();
  return snap.docs.map(doc => ({ ...doc.data(), id: Number(doc.get('id') ?? doc.id) }));
}
async function nextId(name) {
  const data = await rows(name);
  return data.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0) + 1;
}
function employeeIdFor(staff) {
  return String(staff.employee_id || staff.employeeId || staff.staff_id || staff.staffId || `STPS-EMP-${String(staff.id).padStart(3,'0')}`).trim();
}
async function findStaff(identifier) {
  const wanted = String(identifier || '').trim();
  const p = phone10(wanted);
  const em = email(wanted);
  const data = await rows('staff');
  return data.find(staff => {
    const staffPhone = phone10(staff.phone);
    const staffEmail = email(staff.email);
    return (p.length >= 10 && staffPhone.length >= 10 && p === staffPhone) || (em && staffEmail && em === staffEmail);
  }) || null;
}
async function findStaffByEmployeeId(value) {
  const wanted = String(value || '').trim().toUpperCase();
  if (!wanted) return null;
  const data = await rows('staff');
  return data.find(staff => {
    const aliases = [staff.employee_id, staff.employeeId, staff.staff_id, staff.staffId, `STPS-EMP-${String(staff.id).padStart(3,'0')}`, String(staff.id)];
    return aliases.some(x => String(x || '').trim().toUpperCase() === wanted);
  }) || null;
}
function publicStaff(staff) {
  return {
    id: staff.id,
    name: staff.name,
    phone: staff.phone || '',
    email: staff.email || '',
    employeeId: employeeIdFor(staff),
    department: staff.department || '',
    designation: staff.designation || '',
    attendance: staff.attendance || ''
  };
}
function requireResident(req,res,next){ return residentSession(req) ? next() : res.status(401).json({error:'Please sign in to the resident portal.'}); }
function requireAdmin(req,res,next){ return adminSession(req) ? next() : res.status(403).json({error:'Administrator access is required.'}); }
function requireAdministrator(req,res,next){ return administrator(req) ? next() : res.status(403).json({error:'Administrator access is required for this action.'}); }

async function install(app) {
  const db = getDb();

  app.post('/api/resident/login', async (req,res) => {
    try {
      const identifier = String(req.body?.identifier || req.body?.phone || req.body?.email || '').trim();
      if (!identifier) return res.status(400).json({error:'Mobile number or email is required.'});
      const staff = await findStaff(identifier);
      if (!staff) return res.status(401).json({error:'This mobile number or email is not registered in the workforce/staff register.'});
      const employeeId = employeeIdFor(staff);
      const user = { id: staff.id, staffId: staff.id, civilianId: null, name: staff.name, role:'Resident', phone:staff.phone || '', email:staff.email || '', employeeId, department:staff.department || '', designation:staff.designation || '' };
      await new Promise((resolve,reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
      req.session.user = user;
      await new Promise((resolve,reject) => req.session.save(err => err ? reject(err) : resolve()));
      res.json({authenticated:true,user});
    } catch (e) { console.error('[resident workforce login]',e); res.status(500).json({error:'Could not create a secure resident session.'}); }
  });

  app.get('/api/resident/session', async (req,res) => {
    try {
      if (!residentSession(req)) return res.json({authenticated:false});
      const staff = await rows('staff').then(data => data.find(x => Number(x.id) === Number(req.session.user.staffId ?? req.session.user.id)));
      if (!staff) { req.session.destroy(() => {}); return res.json({authenticated:false}); }
      const user = { id:staff.id, staffId:staff.id, civilianId:null, name:staff.name, role:'Resident', phone:staff.phone || '', email:staff.email || '', employeeId:employeeIdFor(staff), department:staff.department || '', designation:staff.designation || '' };
      req.session.user = user;
      res.json({authenticated:true,user});
    } catch (e) { res.status(500).json({error:e.message || 'Could not load resident session.'}); }
  });

  app.post('/api/resident/quarter-applications', requireResident, async (req,res) => {
    try {
      const employeeId = String(req.body?.employeeId || '').trim();
      if (!employeeId) return res.status(400).json({error:'Employee ID is required for a quarter application.'});
      const staff = await findStaffByEmployeeId(employeeId);
      if (!staff || Number(staff.id) !== Number(req.session.user.staffId)) return res.status(400).json({error:'Employee ID must match your workforce/staff record.'});
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({error:'Please provide a reason for the quarter application.'});
      const family = Math.max(1, Number(req.body?.familySize) || 1);
      const requested = String(req.body?.requestedQuarter || '').trim();
      const stamp = now();
      const existing = await rows('quarter_applications');
      const id = await nextId('quarter_applications');
      const no = `QTR-${new Date().getFullYear()}-${String(1 + existing.length).padStart(4,'0')}`;
      const row = { id, application_no:no, staff_id:staff.id, employee_id:employeeIdFor(staff), applicant_name:staff.name, applicant_phone:staff.phone || '', applicant_email:staff.email || '', department:staff.department || '', designation:staff.designation || '', requested_quarter:requested, family_size:family, reason, status:'Pending', created_at:stamp, updated_at:stamp };
      await db.collection('quarter_applications').doc(String(id)).set(row);
      res.status(201).json({ok:true,applicationNo:no,status:'Pending'});
    } catch (e) { console.error('[quarter application]',e); res.status(500).json({error:e.message || 'Could not submit the quarter application.'}); }
  });

  app.get('/api/admin/quarter-applications', requireAdmin, async (_req,res) => {
    try {
      const applications = await rows('quarter_applications');
      const staff = await rows('staff');
      const byId = new Map(staff.map(x => [Number(x.id),x]));
      const out = applications.map(x => {
        const s = byId.get(Number(x.staff_id));
        const employee = s ? employeeIdFor(s) : (x.employee_id || '');
        return {...x, employee_id:employee, resident:x.applicant_name || s?.name || x.resident || '', phone:x.applicant_phone || s?.phone || x.phone || '', email:x.applicant_email || s?.email || x.email || '', department:x.department || s?.department || '', designation:x.designation || s?.designation || ''};
      });
      out.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      res.json(out);
    } catch(e){res.status(500).json({error:e.message || 'Could not load quarter applications.'});}
  });

  app.patch('/api/admin/quarter-applications/:id', requireAdministrator, async (req,res) => {
    try {
      const id = Number(req.params.id);
      const ref = db.collection('quarter_applications').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({error:'Quarter application not found.'});
      const current = snap.data();
      const status = String(req.body?.status || '').trim();
      if (!['Pending','Approved','Rejected'].includes(status)) return res.status(400).json({error:'Status must be Pending, Approved, or Rejected.'});
      const assignedQuarter = String(req.body?.assignedQuarter || req.body?.requestedQuarter || '').trim();
      const updates = {status, updated_at:now()};
      if (assignedQuarter) updates.assigned_quarter = assignedQuarter;
      await ref.update(updates);
      if (status === 'Approved' && assignedQuarter) {
        const staff = await findStaffByEmployeeId(current.employee_id);
        if (staff) {
          const civilians = await rows('township_civilians');
          const existing = civilians.find(x => String(x.quarter||'').trim().toUpperCase() === assignedQuarter.toUpperCase());
          const stamp = now();
          const civilian = { quarter:assignedQuarter, resident:staff.name || current.applicant_name || '', family_size:Number(current.family_size)||1, occupation:staff.designation || current.designation || '', phone:staff.phone || current.applicant_phone || '', email:staff.email || current.applicant_email || '', status:'Occupied', sector:current.sector || '', employee_id:employeeIdFor(staff), staff_id:staff.id, created_at:existing?.created_at || stamp, updated_at:stamp };
          if (existing) await db.collection('township_civilians').doc(String(existing.id)).set({...existing,...civilian,id:existing.id});
          else { const cid=await nextId('township_civilians'); await db.collection('township_civilians').doc(String(cid)).set({id:cid,...civilian}); }
        }
      }
      res.json({ok:true,id,status,assigned_quarter:assignedQuarter || current.assigned_quarter || ''});
    } catch(e){res.status(500).json({error:e.message || 'Could not update the quarter application.'});}
  });

  app.patch('/api/admin/shop-applications/:id', requireAdministrator, async (req,res) => {
    try {
      const id=Number(req.params.id), ref=db.collection('shop_applications').doc(String(id)), snap=await ref.get();
      if(!snap.exists)return res.status(404).json({error:'Shop application not found.'});
      const status=String(req.body?.status||'').trim();
      if(!['Pending','Approved','Rejected'].includes(status))return res.status(400).json({error:'Status must be Pending, Approved, or Rejected.'});
      await ref.update({status,updated_at:now()}); res.json({ok:true,id,status});
    }catch(e){res.status(500).json({error:e.message || 'Could not update the shop application.'});}
  });

  app.get('/api/admin/workforce-residents', requireAdmin, async (_req,res) => { try { res.json((await rows('staff')).map(publicStaff)); } catch(e){res.status(500).json({error:e.message});} });
}

const originalListen = express.application.listen;
express.application.listen = function(...args) { install(this).catch(e=>console.error('[resident-workforce-cutover]',e)); return originalListen.apply(this,args); };
