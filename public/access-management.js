(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
    return payload;
  };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const toast = msg => { const n = $('#toast'); if (n) { n.textContent = msg; n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 4200); } };
  const modal = (id, show) => { const n = document.getElementById(id); if (n) n.classList.toggle('show', show); };
  const field = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
  let user = null, designations = [];

  function buildModal(id, title, body, submitText = 'Save') {
    if (document.getElementById(id)) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="${id}"><form class="modal" data-access-form="${id}"><button type="button" class="close" data-access-close="${id}">×</button><h2>${title}</h2>${body}<p class="error hidden"></p><button class="button" style="width:100%" type="submit">${submitText}</button></form></div>`);
    $(`[data-access-close="${id}"]`).addEventListener('click', () => modal(id, false));
    document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) modal(id, false); });
  }

  async function start() {
    const session = await api('/api/auth/session');
    if (!session.authenticated) return;
    user = session.user;
    const workforce = $('#workforce');
    if (!workforce) return;
    const titleRow = $('.title-row', workforce);
    const actions = $('.action-line', workforce) || titleRow;
    if (!$('#access-add-staff')) actions.insertAdjacentHTML('beforeend', '<button class="button" id="access-add-staff">＋ Add staff</button>');
    if (!$('#access-designations')) actions.insertAdjacentHTML('beforeend', '<button class="button secondary" id="access-designations">Manage designations</button>');
    buildModal('access-staff-modal', 'Add staff member', `${field('Full name','<input name="name" required>')}${field('Designation','<select name="designationId" id="access-designation-select" required></select>')}${field('Department','<input name="department" required>')}${field('Phone','<input name="phone" required>')}${field('Attendance','<select name="attendance"><option>Present</option><option>Absent</option></select>')}${field('Current task (optional)','<input name="currentTask">')}`, 'Add staff member');
    buildModal('access-designation-modal', 'Create designation', `${field('Name','<input name="name" required>')}${field('Description (optional)','<textarea name="description"></textarea>')}`, 'Save designation');
    buildModal('access-designations-modal', 'Manage designations', '<div class="table-wrap"><table class="data-table"><thead><tr><th>Designation</th><th>Description</th><th>Staff</th><th></th></tr></thead><tbody id="access-designations-body"></tbody></table></div><button type="button" class="button" id="access-new-designation" style="width:100%;margin-top:16px">＋ Create designation</button>', '');
    $('#access-designations-modal [type="submit"]')?.remove();
    $('#access-add-staff').addEventListener('click', async () => { await loadDesignations(); $('#access-staff-modal form').reset(); populateSelect('#access-designation-select'); modal('access-staff-modal', true); });
    $('#access-designations').addEventListener('click', async () => { await loadDesignations(); renderDesignations(); modal('access-designations-modal', true); });
    $('#access-new-designation').addEventListener('click', () => { modal('access-designations-modal', false); const f=$('[data-access-form="access-designation-modal"]'); f.reset(); delete f.dataset.id; modal('access-designation-modal', true); });
    $('[data-access-form="access-staff-modal"]').addEventListener('submit', createStaff);
    $('[data-access-form="access-designation-modal"]').addEventListener('submit', saveDesignation);
    await loadDesignations();
    if (user.role === 'Administrator') addUserManagement();
  }

  async function loadDesignations() { designations = await api('/api/designations'); populateSelect('#access-designation-select'); }
  function populateSelect(selector) { const s = $(selector); if (s) s.innerHTML = '<option value="">Unassigned</option>' + designations.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join(''); }
  function renderDesignations() {
    $('#access-designations-body').innerHTML = designations.map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.description || '—')}</td><td>${d.staff_count}</td><td><button type="button" class="button secondary small" data-access-edit="${d.id}">Edit</button> <button type="button" class="button secondary small" data-access-delete="${d.id}">Delete</button></td></tr>`).join('');
    document.querySelectorAll('[data-access-edit]').forEach(b => b.addEventListener('click', () => editDesignation(+b.dataset.accessEdit)));
    document.querySelectorAll('[data-access-delete]').forEach(b => b.addEventListener('click', () => deleteDesignation(+b.dataset.accessDelete)));
  }
  function editDesignation(id) { const d = designations.find(x => x.id === id); if (!d) return; const f = $('[data-access-form="access-designation-modal"]'); f.dataset.id = id; f.name.value = d.name; f.description.value = d.description || ''; modal('access-designations-modal', false); modal('access-designation-modal', true); }
  async function saveDesignation(e) { e.preventDefault(); const f=e.currentTarget, data=Object.fromEntries(new FormData(f)), id=f.dataset.id; try { await api(id ? `/api/designations/${id}` : '/api/designations', { method:id?'PATCH':'POST', body:JSON.stringify(data) }); delete f.dataset.id; modal('access-designation-modal',false); await loadDesignations(); renderDesignations(); modal('access-designations-modal',true); toast(id?'Designation updated.':'Designation created.'); } catch(err) { const n=$('.error',f); n.textContent=err.message; n.classList.remove('hidden'); } }
  async function deleteDesignation(id) { const d=designations.find(x=>x.id===id); if(!d || !confirm(`Delete designation “${d.name}”?`)) return; try { await api(`/api/designations/${id}`,{method:'DELETE'}); await loadDesignations(); renderDesignations(); toast('Designation deleted.'); } catch(err){toast(err.message);} }
  async function createStaff(e) { e.preventDefault(); const f=e.currentTarget, data=Object.fromEntries(new FormData(f)); try { await api('/api/staff',{method:'POST',body:JSON.stringify(data)}); modal('access-staff-modal',false); f.reset(); toast('Staff member added.'); window.location.reload(); } catch(err){ const n=$('.error',f); n.textContent=err.message; n.classList.remove('hidden'); } }

  function addUserManagement() {
    const settings=$('#settings'); if(!settings || $('#access-user-card')) return;
    const grid=$('.grid-2',settings); if(!grid) return;
    grid.insertAdjacentHTML('afterbegin', `<div class="card" id="access-user-card"><div class="card-head"><h2>User & access</h2><button class="button secondary small" id="access-add-user">＋ Add user</button></div><p class="sub">Administrator and Sub-administrator accounts. Sub-administrators can perform normal Civil Office operations but cannot manage users or roles.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody id="access-users-body"></tbody></table></div></div>`);
    buildModal('access-user-modal','Add user',`${field('Name','<input name="name" required>')}${field('Email','<input name="email" type="email" required>')}${field('Role','<select name="role"><option>Sub-administrator</option><option>Administrator</option></select>')}${field('Password','<input name="password" type="password" minlength="12"><small class="sub">At least 12 characters for new users; optional when editing.</small>')}`,'Save user');
    $('#access-add-user').addEventListener('click',()=>openUser());
    $('[data-access-form="access-user-modal"]').addEventListener('submit',saveUser);
    loadUsers();
  }
  async function loadUsers(){ try { const users=await api('/api/users'); $('#access-users-body').innerHTML=users.map(u=>`<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td><button type="button" class="button secondary small" data-user-edit="${u.id}">Edit</button>${u.id!==user.id&&u.role!=='Administrator'?` <button type="button" class="button secondary small" data-user-delete="${u.id}">Delete</button>`:''}</td></tr>`).join(''); document.querySelectorAll('[data-user-edit]').forEach(b=>b.addEventListener('click',()=>openUser(users.find(u=>u.id===+b.dataset.userEdit)))); document.querySelectorAll('[data-user-delete]').forEach(b=>b.addEventListener('click',()=>deleteUser(+b.dataset.userDelete))); } catch(err){ toast(err.message); } }
  function openUser(u=null){ const f=$('[data-access-form="access-user-modal"]'); f.reset(); f.dataset.id=u?.id||''; f.name.value=u?.name||''; f.email.value=u?.email||''; f.role.value=u?.role||'Sub-administrator'; f.password.required=!u; modal('access-user-modal',true); }
  async function saveUser(e){ e.preventDefault(); const f=e.currentTarget,d=Object.fromEntries(new FormData(f)),id=f.dataset.id; try { await api(id?`/api/users/${id}`:'/api/users',{method:id?'PATCH':'POST',body:JSON.stringify(d)}); modal('access-user-modal',false); await loadUsers(); toast(id?'User updated.':'User created.'); } catch(err){const n=$('.error',f);n.textContent=err.message;n.classList.remove('hidden');} }
  async function deleteUser(id){ if(!confirm('Delete this Sub-administrator account?'))return; try{await api(`/api/users/${id}`,{method:'DELETE'});await loadUsers();toast('User deleted.');}catch(err){toast(err.message);} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start().catch(() => {})); else start().catch(() => {});
})();
