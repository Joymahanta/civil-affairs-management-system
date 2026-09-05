const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new BetterSqlite3(path.join(dataDir, 'civil-affairs.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const now = () => new Date().toISOString();
let initialized = false;
function ensureHistoryTable() {
  if (initialized) return;
  db.exec(`CREATE TABLE IF NOT EXISTS complaint_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    old_assigned_to TEXT,
    new_assigned_to TEXT,
    old_priority TEXT,
    new_priority TEXT,
    note TEXT,
    changed_by INTEGER,
    changed_at TEXT NOT NULL,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_complaint_history_complaint ON complaint_history(complaint_id, changed_at DESC);`);
  const missing = db.prepare(`SELECT c.* FROM complaints c WHERE NOT EXISTS (SELECT 1 FROM complaint_history h WHERE h.complaint_id=c.id) ORDER BY c.id`).all();
  const insert = db.prepare(`INSERT INTO complaint_history (complaint_id,event_type,old_status,new_status,old_assigned_to,new_assigned_to,old_priority,new_priority,note,changed_by,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(rows => rows.forEach(c => insert.run(c.id,'registered',null,c.status,null,c.assigned_to,null,c.priority,'Initial complaint record',null,c.created_at || now())))(missing);
  initialized = true;
}
function installComplaintHistoryHooks() {
  if (express.application.__complaintHistoryHooksInstalled) return;
  express.application.__complaintHistoryHooksInstalled = true;
  const originalPost = express.application.post;
  express.application.post = function historyPost(pathname, ...handlers) {
    if (pathname !== '/api/complaints' || !handlers.length) return originalPost.call(this, pathname, ...handlers);
    const wrapped = handlers.slice();
    const originalHandler = wrapped[wrapped.length - 1];
    wrapped[wrapped.length - 1] = function(req,res,next) {
      const originalJson = res.json.bind(res);
      res.json = function(payload) {
        const result = originalJson(payload);
        if (res.statusCode >= 200 && res.statusCode < 300 && payload?.reference) setImmediate(() => { try { ensureHistoryTable(); const c=db.prepare('SELECT * FROM complaints WHERE reference=?').get(payload.reference); if(c) db.prepare(`INSERT INTO complaint_history (complaint_id,event_type,new_status,new_assigned_to,new_priority,note,changed_by,changed_at) VALUES (?,?,?,?,?,?,?,?)`).run(c.id,'registered',c.status,c.assigned_to,c.priority,'Complaint registered',req.session?.user?.id||null,c.created_at||now()); } catch(e){ console.error('[complaint-history]',e.message||e); } });
        return result;
      };
      return originalHandler(req,res,next);
    };
    return originalPost.call(this, pathname, ...wrapped);
  };
  const originalPatch = express.application.patch;
  express.application.patch = function historyPatch(pathname, ...handlers) {
    if (pathname !== '/api/complaints/:id' || !handlers.length) return originalPatch.call(this, pathname, ...handlers);
    const wrapped=handlers.slice(); const originalHandler=wrapped[wrapped.length-1];
    wrapped[wrapped.length-1]=function(req,res,next){
      ensureHistoryTable();
      const before=db.prepare('SELECT * FROM complaints WHERE id=?').get(Number(req.params.id));
      const originalJson=res.json.bind(res);
      res.json=function(payload){
        const result=originalJson(payload);
        if(res.statusCode>=200&&res.statusCode<300&&before)setImmediate(()=>{try{const after=db.prepare('SELECT * FROM complaints WHERE id=?').get(before.id);if(!after)return;const changes=[];if(before.status!==after.status)changes.push('status');if((before.assigned_to||'')!==(after.assigned_to||''))changes.push('assignment');if(before.priority!==after.priority)changes.push('priority');if(!changes.length)return;db.prepare(`INSERT INTO complaint_history (complaint_id,event_type,old_status,new_status,old_assigned_to,new_assigned_to,old_priority,new_priority,note,changed_by,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(after.id,changes.length===1?changes[0]+'-changed':'updated',before.status,after.status,before.assigned_to,after.assigned_to,before.priority,after.priority,req.body?.note?String(req.body.note).trim().slice(0,500):null,req.session?.user?.id||null,now());}catch(e){console.error('[complaint-history]',e.message||e);}});
        return result;
      }; return originalHandler(req,res,next);
    };
    return originalPatch.call(this,pathname,...wrapped);
  };
  const originalGet=express.application.get;
  express.application.get=function historyGet(pathname,...handlers){
    if(pathname==='/api/complaints/:id/history'){
      const wrapped=handlers.slice(); const originalHandler=wrapped[wrapped.length-1];
      wrapped[wrapped.length-1]=function(req,res,next){if(!req.session?.user)return res.status(401).json({error:'Please sign in to view complaint history.'});try{ensureHistoryTable();const rows=db.prepare(`SELECT h.*,u.name AS changed_by_name,u.role AS changed_by_role FROM complaint_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.complaint_id=? ORDER BY h.id DESC LIMIT 100`).all(Number(req.params.id));res.json(rows);}catch(e){next(e);}};
      return originalGet.call(this,pathname,...wrapped);
    }
    return originalGet.call(this,pathname,...handlers);
  };
}
module.exports={installComplaintHistoryHooks};
