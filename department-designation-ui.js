(() => {
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const api = async (url, options = {}) => {
    const r = await fetch(url, {headers:{'Content-Type':'application/json'}, ...options});
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p.error || 'Request failed.');
    return p;
  };
  const modal = id => document.getElementById(id);
  function addModal(id, html) {
    if (modal(id)) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop'; wrap.id = id; wrap.innerHTML = html;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close-modal]')) wrap.classList.remove('show'); });
  }
  async function departments() { return api('/api/departments'); }
  async function designations() { return api('/api/designations'); }
  function makeModals() {
    addModal('department-manager-modal', `<form class="modal" id="department-manager-form"><button type="button" class="close" data-close-modal>×</button><h2>Make department</h2><p class="sub">Create a department for the township workforce.</p><div class="field"><label>Department name</label><input name="name" required placeholder="e.g. Electrical"></div><div class="field"><label>Description</label><textarea name="description" placeholder="Department responsibility"></textarea></div><p class="error hidden"></p><button class="button" style="width:100%" type="submit">Create department</button><div class="card" style="margin-top:16px"><b>Existing departments</b><div id="department-list" class="sub" style="margin-top:8px"></div></div></form>`);
    addModal('designation-manager-modal', `<form class="modal" id="designation-manager-form"><button type="button" class="close" data-close-modal>×</button><h2>Make designation</h2><p class="sub">Create a designation under a specific department.</p><div class="field"><label>Department</label><select name="departmentId" id="designation-department" required><option value="">Select department</option></select></div><div class="field"><label>Designation name</label><input name="name" required placeholder="e.g. Electrical Engineer"></div><div class="field"><label>Description</label><textarea name="description" placeholder="Role responsibility"></textarea></div><p class="error hidden"></p><button class="button" style="width:100%" type="submit">Create designation</button><div class="card" style="margin-top:16px"><b>Existing designations</b><div id="designation-list" class="sub" style="margin-top:8px"></div></div></form>`);
  }
  async function refreshDepartmentDialog() {
    const rows = await departments();
    const select = document.getElementById('designation-department');
    if (select) select.innerHTML = '<option value="">Select department</option>' + rows.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    const list = document.getElementById('department-list');
    if (list) list.innerHTML = rows.map(d => `<div>${esc(d.name)} <span>(${d.designation_count || 0} designations)</span></div>`).join('') || 'No departments yet.';
  }
  async function refreshDesignationList() {
    const rows = await designations();
    const list = document.getElementById('designation-list');
    if (list) list.innerHTML = rows.map(d => `<div><b>${esc(d.name)}</b> — ${esc(d.department || 'Unassigned')}</div>`).join('') || 'No designations yet.';
  }
  function open(id) { modal(id)?.classList.add('show'); }
  async function init() {
    makeModals();
    document.getElementById('make-department')?.addEventListener('click', async () => { open('department-manager-modal'); try { await refreshDepartmentDialog(); } catch(e) { console.error(e); } });
    document.getElementById('make-designation')?.addEventListener('click', async () => { open('designation-manager-modal'); try { await refreshDepartmentDialog(); await refreshDesignationList(); } catch(e) { console.error(e); } });
    document.getElementById('department-manager-form')?.addEventListener('submit', async e => {
      e.preventDefault(); const form=e.currentTarget; const err=form.querySelector('.error'); err.classList.add('hidden');
      try { await api('/api/departments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))}); form.reset(); await refreshDepartmentDialog(); alert('Department created successfully.'); }
      catch(x){err.textContent=x.message;err.classList.remove('hidden');}
    });
    document.getElementById('designation-manager-form')?.addEventListener('submit', async e => {
      e.preventDefault(); const form=e.currentTarget; const err=form.querySelector('.error'); err.classList.add('hidden');
      try { await api('/api/designations',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))}); const selected=form.departmentId.value; form.reset(); form.departmentId.value=selected; await refreshDepartmentDialog(); await refreshDesignationList(); alert('Designation created successfully.'); }
      catch(x){err.textContent=x.message;err.classList.remove('hidden');}
    });
    // Starter structure for a practical township workforce.
    try {
      const ds = await departments();
      const wanted = {
        Electrical:['Electrical Engineer','Electrical Apprentice','Electrical Supervisor'],
        Waterworks:['Waterworks Engineer','Waterworks Apprentice','Waterworks Supervisor'],
        Sanitation:['Sanitation Officer','Sanitation Worker','Sanitation Supervisor'],
        Engineering:['Junior Engineer','Senior Engineer','Engineering Apprentice'],
        Roads:['Road Engineer','Road Worker','Road Inspector'],
        Inspection:['Field Inspector','Senior Field Inspector'],
        Horticulture:['Horticulture Supervisor','Gardener'],
        Administration:['Civil Office Administrator','Assistant Administrator','Office Assistant','Data Entry Operator']
      };
      for (const d of ds) {
        for (const name of (wanted[d.name] || [])) {
          const existing = await designations();
          if (!existing.some(x => x.name.toLowerCase() === name.toLowerCase() && Number(x.department_id) === Number(d.id))) {
            try { await api('/api/designations',{method:'POST',body:JSON.stringify({name,description:`${name} — ${d.name} department`,departmentId:d.id})}); } catch(e) { if (!String(e.message).includes('already exists')) console.warn(e.message); }
          }
        }
      }
    } catch(e) { console.warn('[department-designation-ui]', e.message); }
  }
  if (document.body.dataset.page === 'admin') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
