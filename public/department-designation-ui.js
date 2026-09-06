(() => {
  if (window.__civilWorkforceManagerLoaded) return;
  window.__civilWorkforceManagerLoaded = true;

  const esc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const api = async (url, options = {}) => { const r=await fetch(url,{cache:'no-store',headers:{'Content-Type':'application/json'},...options}); const p=await r.json().catch(()=>({})); if(!r.ok) throw new Error(p.error||'Request failed.'); return p; };
  const get = id => document.getElementById(id);
  const close = id => get(id)?.classList.remove('show');
  const open = id => get(id)?.classList.add('show');
  let departmentsCache=[];
  let designationsCache=[];

  function removeOldManagers(){ ['department-manager-modal','designation-manager-modal','department-maker-modal','designation-maker-modal'].forEach(id=>get(id)?.remove()); }
  function shell(id,title,subtitle,body){ const wrap=document.createElement('div'); wrap.className='modal-backdrop'; wrap.id=id; wrap.innerHTML=`<div class="modal" style="max-width:760px"><button type="button" class="close" data-close>×</button><h2>${title}</h2><p class="sub">${subtitle}</p>${body}</div>`; document.body.appendChild(wrap); wrap.addEventListener('click',e=>{if(e.target===wrap||e.target.closest('[data-close]'))close(id);}); return wrap; }
  function errorText(form,message=''){ const el=form.querySelector('.error'); if(!el)return; el.textContent=message; el.classList.toggle('hidden',!message); }

  function createManagers(){
    removeOldManagers();
    shell('department-manager-modal','Manage departments','Add, update or delete workforce departments.',`<form id="department-editor"><input type="hidden" name="id"><div class="field"><label>Department name</label><input name="name" required placeholder="e.g. Electrical"></div><div class="field"><label>Description</label><textarea name="description"></textarea></div><p class="error hidden"></p><div style="display:flex;gap:8px"><button class="button" type="submit">Add department</button><button class="button secondary hidden" id="department-cancel-edit" type="button">Cancel edit</button></div></form><div class="card" style="margin-top:18px"><b>Departments</b><div id="department-list" style="margin-top:10px"></div></div>`);
    shell('designation-manager-modal','Manage designations','Add, update or delete designations under a department.',`<form id="designation-editor"><input type="hidden" name="id"><div class="field"><label>Department</label><select name="departmentId" required></select></div><div class="field"><label>Designation name</label><input name="name" required placeholder="e.g. Electrical Engineer"></div><div class="field"><label>Description</label><textarea name="description"></textarea></div><p class="error hidden"></p><div style="display:flex;gap:8px"><button class="button" type="submit">Add designation</button><button class="button secondary hidden" id="designation-cancel-edit" type="button">Cancel edit</button></div></form><div class="card" style="margin-top:18px"><b>Designations</b><div id="designation-list" style="margin-top:10px"></div></div>`);
  }

  async function load(){ [departmentsCache,designationsCache]=await Promise.all([api('/api/departments'),api('/api/designations')]); }
  function departmentOptions(selected=''){ const html='<option value="">Select department</option>'+departmentsCache.map(d=>`<option value="${d.id}" ${String(d.id)===String(selected)?'selected':''}>${esc(d.name)}</option>`).join(''); document.querySelectorAll('#designation-editor [name="departmentId"]').forEach(s=>s.innerHTML=html); }
  function renderDepartments(){ const list=get('department-list'); if(!list)return; list.innerHTML=departmentsCache.map(d=>`<div class="activity" style="display:flex;align-items:center;gap:10px"><p style="flex:1"><b>${esc(d.name)}</b><br><span class="sub">${esc(d.description||'')} · ${Number(d.designation_count||0)} designation(s)</span></p><button type="button" class="button secondary" data-edit-department="${d.id}">Edit</button><button type="button" class="button secondary" data-delete-department="${d.id}">Delete</button></div>`).join('')||'<p class="empty">No departments.</p>'; }
  function renderDesignations(){ const list=get('designation-list'); if(!list)return; list.innerHTML=designationsCache.map(d=>`<div class="activity" style="display:flex;align-items:center;gap:10px"><p style="flex:1"><b>${esc(d.name)}</b><br><span class="sub">${esc(d.department||'Unassigned')} · ${Number(d.staff_count||0)} staff</span></p><button type="button" class="button secondary" data-edit-designation="${d.id}">Edit</button><button type="button" class="button secondary" data-delete-designation="${d.id}">Delete</button></div>`).join('')||'<p class="empty">No designations.</p>'; }
  async function refresh(){ await load(); departmentOptions(); renderDepartments(); renderDesignations(); }

  function resetDepartment(){ const f=get('department-editor'); f.reset(); f.id.value=''; f.querySelector('[type="submit"]').textContent='Add department'; get('department-cancel-edit').classList.add('hidden'); errorText(f); }
  function resetDesignation(){ const f=get('designation-editor'); f.reset(); f.id.value=''; f.querySelector('[type="submit"]').textContent='Add designation'; get('designation-cancel-edit').classList.add('hidden'); errorText(f); departmentOptions(); }

  function bind(){
    const depBtn=get('make-department'), desBtn=get('make-designation');
    if(depBtn){depBtn.textContent='Manage departments'; depBtn.onclick=async()=>{await refresh();resetDepartment();open('department-manager-modal');};}
    if(desBtn){desBtn.textContent='Manage designations'; desBtn.onclick=async()=>{await refresh();resetDesignation();open('designation-manager-modal');};}

    get('department-editor').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,id=f.id.value,p={name:f.name.value,description:f.description.value};try{await api(id?`/api/departments/${id}`:'/api/departments',{method:id?'PATCH':'POST',body:JSON.stringify(p)});resetDepartment();await refresh();}catch(x){errorText(f,x.message);}});
    get('designation-editor').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,id=f.id.value,p={name:f.name.value,description:f.description.value,departmentId:f.departmentId.value};try{await api(id?`/api/designations/${id}`:'/api/designations',{method:id?'PATCH':'POST',body:JSON.stringify(p)});resetDesignation();await refresh();}catch(x){errorText(f,x.message);}});
    get('department-cancel-edit').onclick=resetDepartment; get('designation-cancel-edit').onclick=resetDesignation;

    document.addEventListener('click',async e=>{
      let b=e.target.closest('[data-edit-department]'); if(b){const d=departmentsCache.find(x=>Number(x.id)===Number(b.dataset.editDepartment)),f=get('department-editor');if(d){f.id.value=d.id;f.name.value=d.name;f.description.value=d.description||'';f.querySelector('[type="submit"]').textContent='Update department';get('department-cancel-edit').classList.remove('hidden');}return;}
      b=e.target.closest('[data-delete-department]'); if(b){const d=departmentsCache.find(x=>Number(x.id)===Number(b.dataset.deleteDepartment));if(d&&confirm(`Delete ${d.name}?`)){try{await api(`/api/departments/${d.id}`,{method:'DELETE'});await refresh();}catch(x){alert(x.message);}}return;}
      b=e.target.closest('[data-edit-designation]'); if(b){const d=designationsCache.find(x=>Number(x.id)===Number(b.dataset.editDesignation)),f=get('designation-editor');if(d){f.id.value=d.id;departmentOptions(d.department_id);f.name.value=d.name;f.description.value=d.description||'';f.querySelector('[type="submit"]').textContent='Update designation';get('designation-cancel-edit').classList.remove('hidden');}return;}
      b=e.target.closest('[data-delete-designation]'); if(b){const d=designationsCache.find(x=>Number(x.id)===Number(b.dataset.deleteDesignation));if(d&&confirm(`Delete ${d.name}?`)){try{await api(`/api/designations/${d.id}`,{method:'DELETE'});await refresh();}catch(x){alert(x.message);}}}
    });
  }

  async function init(){ createManagers(); bind(); }
  if(document.body.dataset.page==='admin'){ if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true}); else init(); }
})();
