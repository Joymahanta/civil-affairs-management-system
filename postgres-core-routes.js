'use strict';

const express = require('express');
const crypto = require('crypto');
const { query } = require('./db/postgres');

const required = value => typeof value === 'string' && value.trim().length > 0;
const now = () => new Date().toISOString();

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

function auth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  next();
}

function admin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  if (!['Administrator', 'Sub-administrator'].includes(req.session.user.role)) return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function administrator(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
  if (req.session.user.role !== 'Administrator') return res.status(403).json({ error: 'Administrator access is required for this action.' });
  next();
}

async function rows(table, orderBy = 'id') {
  const result = await query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  return result.rows;
}

async function findById(table, id) {
  const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [Number(id)]);
  return result.rows[0] || null;
}

async function activity(kind, message) {
  try { await query('INSERT INTO activity (kind, message, created_at) VALUES ($1, $2, $3)', [kind, message, now()]); }
  catch (error) { console.error('[postgres activity]', error.message); }
}

function install(app) {
  const router = express.Router();

  router.get('/api/health', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true, database: 'postgresql' }); }
    catch (error) { res.status(503).json({ ok: false, database: 'postgresql', error: error.message }); }
  });

  router.get('/api/auth/session', (req, res) => {
    if (!req.session?.user) return res.json({ authenticated: false });
    res.json({ authenticated: true, user: req.session.user });
  });

  router.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      const password = String(req.body?.password || '');
      if (!required(email) || !required(password)) return res.status(400).json({ error: 'Email and password are required.' });
      const result = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
      const user = result.rows[0];
      if (!user || user.status === 'Disabled' || !passwordMatches(password, user.password_hash)) {
        return res.status(401).json({ error: user?.status === 'Disabled' ? 'This account has been disabled. Contact a Civil Office Administrator.' : 'Email or password is not correct.' });
      }
      const sessionUser = { id: user.id, name: user.name, email: user.email, role: user.role };
      req.session.regenerate(error => {
        if (error) return res.status(500).json({ error: 'Could not create a secure session.' });
        req.session.user = sessionUser;
        req.session.save(saveError => {
          if (saveError) return res.status(500).json({ error: 'Could not save your secure session.' });
          activity('security', `${user.name} signed in to the Civil Office console`);
          res.json({ authenticated: true, user: sessionUser });
        });
      });
    } catch (error) { res.status(500).json({ error: error.message || 'Could not sign in.' }); }
  });

  router.post('/api/auth/logout', auth, (req, res) => {
    req.session.destroy(error => {
      if (error) return res.status(500).json({ error: 'Could not end this session.' });
      res.clearCookie('civil-affairs.sid');
      res.json({ ok: true });
    });
  });

  router.post('/api/auth/change-password', auth, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!required(currentPassword) || !required(newPassword)) return res.status(400).json({ error: 'Both password fields are required.' });
      if (newPassword.length < 12) return res.status(400).json({ error: 'Use at least 12 characters for the new password.' });
      const user = await findById('users', req.session.user.id);
      if (!user || !passwordMatches(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Your current password is incorrect.' });
      await query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [passwordHash(newPassword), now(), user.id]);
      await activity('security', `${user.name} changed the Civil Office password`);
      res.json({ ok: true, message: 'Password changed successfully.' });
    } catch (error) { res.status(500).json({ error: error.message || 'Could not change the password.' }); }
  });

  router.get('/api/departments', administrator, async (_req, res) => {
    try {
      const result = await query(`
        SELECT d.*, COUNT(g.id)::int AS designation_count
        FROM departments d LEFT JOIN designations g ON g.department_id = d.id
        GROUP BY d.id ORDER BY d.name
      `);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/api/departments', administrator, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      if (!name) return res.status(400).json({ error: 'Department name is required.' });
      const duplicate = await query('SELECT id FROM departments WHERE lower(name) = lower($1)', [name]);
      if (duplicate.rowCount) return res.status(409).json({ error: 'A department with this name already exists.' });
      const result = await query('INSERT INTO departments (name, description, created_at, updated_at) VALUES ($1,$2,$3,$3) RETURNING *', [name, description, now()]);
      res.status(201).json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/api/departments/:id', administrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const current = await findById('departments', id);
      if (!current) return res.status(404).json({ error: 'Department not found.' });
      const name = req.body?.name === undefined ? current.name : String(req.body.name || '').trim();
      const description = req.body?.description === undefined ? current.description : String(req.body.description || '').trim();
      if (!name) return res.status(400).json({ error: 'Department name is required.' });
      const duplicate = await query('SELECT id FROM departments WHERE lower(name)=lower($1) AND id<>$2', [name, id]);
      if (duplicate.rowCount) return res.status(409).json({ error: 'A department with this name already exists.' });
      const result = await query('UPDATE departments SET name=$1, description=$2, updated_at=$3 WHERE id=$4 RETURNING *', [name, description, now(), id]);
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.delete('/api/departments/:id', administrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!(await findById('departments', id))) return res.status(404).json({ error: 'Department not found.' });
      const linked = await query('SELECT 1 FROM designations WHERE department_id=$1 LIMIT 1', [id]);
      if (linked.rowCount) return res.status(409).json({ error: 'Cannot delete a department that has designations assigned to it.' });
      await query('DELETE FROM departments WHERE id=$1', [id]);
      res.json({ deleted: true, id });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/api/designations', administrator, async (_req, res) => {
    try {
      const result = await query(`SELECT g.*, d.name AS department FROM designations g LEFT JOIN departments d ON d.id=g.department_id ORDER BY g.name`);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/api/designations', administrator, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      const departmentId = Number(req.body?.departmentId);
      if (!name || !Number.isInteger(departmentId) || departmentId < 1) return res.status(400).json({ error: 'Designation name and department are required.' });
      if (!(await findById('departments', departmentId))) return res.status(400).json({ error: 'Selected department does not exist.' });
      if ((await query('SELECT id FROM designations WHERE lower(name)=lower($1)', [name])).rowCount) return res.status(409).json({ error: 'A designation with this name already exists.' });
      const result = await query('INSERT INTO designations (name,description,department_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *', [name, description, departmentId, now()]);
      res.status(201).json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/api/designations/:id', administrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const current = await findById('designations', id);
      if (!current) return res.status(404).json({ error: 'Designation not found.' });
      const name = req.body?.name === undefined ? current.name : String(req.body.name || '').trim();
      const description = req.body?.description === undefined ? current.description : String(req.body.description || '').trim();
      const departmentId = req.body?.departmentId === undefined ? current.department_id : Number(req.body.departmentId);
      if (!name || !Number.isInteger(departmentId) || departmentId < 1) return res.status(400).json({ error: 'Designation name and department are required.' });
      if (!(await findById('departments', departmentId))) return res.status(400).json({ error: 'Selected department does not exist.' });
      if ((await query('SELECT id FROM designations WHERE lower(name)=lower($1) AND id<>$2', [name, id])).rowCount) return res.status(409).json({ error: 'A designation with this name already exists.' });
      const result = await query('UPDATE designations SET name=$1,description=$2,department_id=$3,updated_at=$4 WHERE id=$5 RETURNING *', [name, description, departmentId, now(), id]);
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.delete('/api/designations/:id', administrator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!(await findById('designations', id))) return res.status(404).json({ error: 'Designation not found.' });
      if ((await query('SELECT 1 FROM staff WHERE designation_id=$1 LIMIT 1', [id])).rowCount) return res.status(409).json({ error: 'Cannot delete a designation that is assigned to staff.' });
      await query('DELETE FROM designations WHERE id=$1', [id]);
      res.json({ deleted: true, id });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/api/staff', auth, async (_req, res) => {
    try {
      const result = await query(`SELECT s.*, d.name AS designation, d.department_id FROM staff s LEFT JOIN designations d ON d.id=s.designation_id ORDER BY s.id`);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/api/staff', auth, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const department = String(req.body?.department || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const designationId = Number(req.body?.designationId);
      const attendance = String(req.body?.attendance || 'Present').trim();
      const currentTask = req.body?.currentTask == null ? null : String(req.body.currentTask).trim() || null;
      const email = req.body?.email == null ? null : String(req.body.email).trim() || null;
      if (!name || !department || !phone || !Number.isInteger(designationId) || designationId < 1) return res.status(400).json({ error: 'Name, department, designation, and phone are required.' });
      if (!['Present', 'Absent'].includes(attendance)) return res.status(400).json({ error: 'Invalid attendance value.' });
      const designation = await query('SELECT g.id,g.name,d.name AS department FROM designations g JOIN departments d ON d.id=g.department_id WHERE g.id=$1', [designationId]);
      if (!designation.rowCount) return res.status(400).json({ error: 'Selected designation does not exist.' });
      if (designation.rows[0].department !== department) return res.status(400).json({ error: 'Select a designation from the selected department.' });
      const result = await query(`INSERT INTO staff (name,designation_id,department,phone,attendance,current_task,email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [name, designationId, department, phone, attendance, currentTask, email]);
      await activity('staff', `${name} added to the workforce`);
      res.status(201).json({ ...result.rows[0], designation: designation.rows[0].name });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.patch('/api/staff/:id', auth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const current = await findById('staff', id);
      if (!current) return res.status(404).json({ error: 'Staff member not found.' });
      const fields = [];
      const values = [];
      const map = { name:'name', designationId:'designation_id', department:'department', phone:'phone', attendance:'attendance', currentTask:'current_task', email:'email' };
      for (const [input, column] of Object.entries(map)) if (Object.prototype.hasOwnProperty.call(req.body || {}, input)) { fields.push(`${column}=$${values.length+1}`); values.push(input === 'designationId' ? Number(req.body[input]) : (req.body[input] === '' ? null : req.body[input])); }
      if (!fields.length) return res.json(current);
      fields.push(`id=id`);
      values.push(id);
      const result = await query(`UPDATE staff SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`, values);
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.delete('/api/staff/:id', administrator, async (req, res) => {
    try { const id=Number(req.params.id); if (!(await findById('staff',id))) return res.status(404).json({error:'Staff member not found.'}); await query('DELETE FROM staff WHERE id=$1',[id]); res.json({deleted:true,id}); }
    catch(error){res.status(500).json({error:error.message});}
  });

  router.get('/api/complaints', admin, async (req, res) => {
    try {
      const conditions=[]; const values=[];
      if(req.query.status && req.query.status!=='All'){conditions.push(`status=$${values.length+1}`);values.push(req.query.status);}
      if(req.query.type && req.query.type!=='All'){conditions.push(`type=$${values.length+1}`);values.push(req.query.type);}
      if(req.query.q){conditions.push(`(reference ILIKE $${values.length+1} OR location ILIKE $${values.length+1} OR reporter_name ILIKE $${values.length+1})`);values.push(`%${req.query.q}%`);}
      const result=await query(`SELECT * FROM complaints ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY created_at DESC`,values);
      res.json(result.rows);
    } catch(error){res.status(500).json({error:error.message});}
  });

  router.get('/api/complaints/:id/history', admin, async (req,res)=>{
    try{const complaint=await findById('complaints',Number(req.params.id));if(!complaint)return res.status(404).json({error:'Complaint not found.'});const result=await query(`SELECT id,kind,message,created_at FROM activity WHERE message ILIKE $1 ORDER BY created_at DESC,id DESC`,[`%${complaint.reference}%`]);res.json(result.rows.map(row=>({id:row.id,action:row.kind||'activity',kind:row.kind||'activity',message:row.message,details:row.message,created_at:row.created_at,timestamp:row.created_at})));}
    catch(error){res.status(500).json({error:error.message});}
  });

  router.get('/api/complaints/:reference', async (req,res)=>{
    try{const result=await query('SELECT * FROM complaints WHERE upper(reference)=upper($1)',[req.params.reference]);const complaint=result.rows[0];if(!complaint)return res.status(404).json({error:'No complaint was found with that reference number.'});if(!req.session?.user){const phone=String(req.query.phone||'').replace(/\D/g,'');if(!phone||phone!==String(complaint.reporter_phone||'').replace(/\D/g,''))return res.status(401).json({error:'Enter the mobile number used when the complaint was registered.'});return res.json({reference:complaint.reference,status:complaint.status,assigned_to:complaint.assigned_to,updated_at:complaint.updated_at,category:complaint.category,location:complaint.location});}res.json(complaint);}
    catch(error){res.status(500).json({error:error.message});}
  });

  router.post('/api/complaints', async (req,res)=>{
    try{
      const b=req.body||{}; if(![b.type,b.category,b.location,b.reporterName,b.reporterPhone,b.description].every(required))return res.status(400).json({error:'Please complete all required complaint details.'});
      const count=await query('SELECT COUNT(*)::int AS count FROM complaints'); const reference=`CA-${new Date().getFullYear()}-${String(1800+count.rows[0].count+1).padStart(4,'0')}`; const priority=/(no water|live wire|fire|flood|danger|emergency)/i.test(b.description)?'Urgent':'Medium'; const stamp=now();
      const result=await query(`INSERT INTO complaints (reference,type,category,location,reporter_name,reporter_phone,reporter_email,description,photo_name,latitude,longitude,priority,status,assigned_to,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'New',NULL,$13,$13) RETURNING *`,[reference,b.type,b.category,b.location,String(b.reporterName).trim(),String(b.reporterPhone).trim(),String(b.reporterEmail||'').trim(),String(b.description).trim(),String(b.photoName||''),b.latitude??null,b.longitude??null,priority,stamp]);
      await activity('complaint',`${reference} received — ${b.category}`);res.status(201).json({reference:result.rows[0].reference,priority,status:'New'});
    }catch(error){res.status(500).json({error:error.message});}
  });

  router.patch('/api/complaints/:id', auth, async(req,res)=>{
    try{const id=Number(req.params.id),current=await findById('complaints',id);if(!current)return res.status(404).json({error:'Complaint not found.'});const body=req.body||{};const allowed={priority:'priority',status:'status',assignedTo:'assigned_to',assigned_to:'assigned_to',category:'category',location:'location',description:'description'};const fields=[],values=[];for(const [input,column] of Object.entries(allowed))if(Object.prototype.hasOwnProperty.call(body,input)){fields.push(`${column}=$${values.length+1}`);values.push(body[input]);}if(!fields.length)return res.status(400).json({error:'No complaint changes were provided.'});fields.push(`updated_at=$${values.length+1}`);values.push(now());values.push(id);const result=await query(`UPDATE complaints SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`,values);await activity('complaint',`${current.reference} updated by ${req.session.user.name}`);res.json(result.rows[0]);}
    catch(error){res.status(500).json({error:error.message});}
  });

  router.get('/api/summary', auth, async (_req,res)=>{try{const [c,s,e,a]=await Promise.all([query("SELECT * FROM complaints WHERE status!='Resolved' ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,created_at DESC LIMIT 5"),query('SELECT * FROM staff'),query('SELECT * FROM equipment'),query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 5')]);const totals=await Promise.all([query("SELECT COUNT(*)::int count FROM complaints WHERE status!='Resolved'"),query("SELECT COUNT(*)::int count FROM complaints WHERE created_at::date=CURRENT_DATE"),query("SELECT COUNT(*)::int count FROM staff WHERE attendance='Present'"),query('SELECT COUNT(*)::int count FROM staff'),query("SELECT COUNT(*)::int count FROM equipment WHERE status='In use'"),query('SELECT COUNT(*)::int count FROM equipment')]);res.json({open:totals[0].rows[0].count,receivedToday:totals[1].rows[0].count,staffOnDuty:totals[2].rows[0].count,staffTotal:totals[3].rows[0].count,equipmentInUse:totals[4].rows[0].count,equipmentTotal:totals[5].rows[0].count,completion:82,priority:c.rows,activity:a.rows});}catch(error){res.status(500).json({error:error.message});}});

  router.get('/api/insights', auth, async (_req,res)=>{try{const [cat,status]=await Promise.all([query('SELECT category,COUNT(*)::int AS count FROM complaints GROUP BY category ORDER BY count DESC'),query('SELECT status,COUNT(*)::int AS count FROM complaints GROUP BY status ORDER BY count DESC')]);res.json({byCategory:cat.rows,byStatus:status.rows});}catch(error){res.status(500).json({error:error.message});}});

  router.get('/api/activity', auth, async (_req,res)=>{try{res.json(await rows('activity','created_at DESC'));}catch(error){res.status(500).json({error:error.message});}});

  router.get('/api/equipment', admin, async (_req,res)=>{try{res.json(await rows('equipment'));}catch(error){res.status(500).json({error:error.message});}});
  router.post('/api/equipment', administrator, async(req,res)=>{try{const b=req.body||{},code=String(b.assetCode??b.asset_code??'').trim(),name=String(b.name||'').trim();if(!code||!name)return res.status(400).json({error:'Asset code and equipment name are required.'});if((await query('SELECT 1 FROM equipment WHERE asset_code=$1',[code])).rowCount)return res.status(409).json({error:'That asset code already exists.'});const result=await query(`INSERT INTO equipment (asset_code,name,holder,issued_on,expected_return,condition,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[code,name,b.holder||null,b.issuedOn||b.issued_on||null,b.expectedReturn||b.expected_return||null,b.condition||'Good',b.status||'Available']);await activity('equipment',`${code} equipment added`);res.status(201).json(result.rows[0]);}catch(error){res.status(500).json({error:error.message});}});
  router.patch('/api/equipment/:id', administrator, async(req,res)=>{try{const id=Number(req.params.id),current=await findById('equipment',id);if(!current)return res.status(404).json({error:'Equipment not found.'});const map={assetCode:'asset_code',asset_code:'asset_code',name:'name',holder:'holder',issuedOn:'issued_on',issued_on:'issued_on',expectedReturn:'expected_return',expected_return:'expected_return',condition:'condition',status:'status'};const fields=[],values=[];for(const [input,column] of Object.entries(map))if(Object.prototype.hasOwnProperty.call(req.body||{},input)){fields.push(`${column}=$${values.length+1}`);values.push(req.body[input]);}if(!fields.length)return res.status(400).json({error:'No equipment changes were provided.'});values.push(id);const result=await query(`UPDATE equipment SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`,values);res.json(result.rows[0]);}catch(error){res.status(500).json({error:error.message});}});
  router.delete('/api/equipment/:id', administrator, async(req,res)=>{try{const id=Number(req.params.id);if(!(await findById('equipment',id)))return res.status(404).json({error:'Equipment not found.'});await query('DELETE FROM equipment WHERE id=$1',[id]);res.json({ok:true,id});}catch(error){res.status(500).json({error:error.message});}});

  router.get('/api/tenders', admin, async(_req,res)=>{try{res.json(await rows('tenders','id DESC'));}catch(error){res.status(500).json({error:error.message});}});
  router.post('/api/tenders', administrator, async(req,res)=>{try{const scope=String(req.body?.scope||'').trim(),closing=String(req.body?.closingDate||req.body?.closing_date||'').trim();if(!scope||!closing)return res.status(400).json({error:'Scope and closing date are required.'});const count=await query('SELECT COUNT(*)::int count FROM tenders');const no=`STPS/T/${String(new Date().getFullYear()).slice(-2)}/${String(35+count.rows[0].count).padStart(3,'0')}`;const result=await query('INSERT INTO tenders (tender_no,scope,closing_date,bids,status,created_at) VALUES ($1,$2,$3,0,$4,$5) RETURNING *',[no,scope,closing,'Draft',now()]);res.status(201).json(result.rows[0]);}catch(error){res.status(500).json({error:error.message});}});
  router.patch('/api/tenders/:id', administrator, async(req,res)=>{try{const id=Number(req.params.id),current=await findById('tenders',id);if(!current)return res.status(404).json({error:'Tender not found.'});const map={scope:'scope',closingDate:'closing_date',closing_date:'closing_date',bids:'bids',status:'status'},fields=[],values=[];for(const [input,column] of Object.entries(map))if(Object.prototype.hasOwnProperty.call(req.body||{},input)){fields.push(`${column}=$${values.length+1}`);values.push(req.body[input]);}if(!fields.length)return res.status(400).json({error:'No tender changes were provided.'});values.push(id);const result=await query(`UPDATE tenders SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`,values);res.json(result.rows[0]);}catch(error){res.status(500).json({error:error.message});}});
  router.delete('/api/tenders/:id', administrator, async(req,res)=>{try{const id=Number(req.params.id);if(!(await findById('tenders',id)))return res.status(404).json({error:'Tender not found.'});await query('DELETE FROM tenders WHERE id=$1',[id]);res.json({ok:true,id});}catch(error){res.status(500).json({error:error.message});}});

  const stack = app._router?.stack;
  if (!stack) return;
  const firstRoute = stack.findIndex(layer => layer.route);
  const insertAt = firstRoute >= 0 ? firstRoute : stack.length;
  stack.splice(insertAt, 0, ...router.stack);
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  install(this);
  return originalListen.apply(this, args);
};
