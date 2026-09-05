const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const toast = message => { const node = $('#toast'); if (!node) return; node.textContent = message; node.classList.add('show'); clearTimeout(window.toastTimeout); window.toastTimeout = setTimeout(() => node.classList.remove('show'), 4400); };
const openModal = id => $(`#${id}`)?.classList.add('show');
const closeModal = id => $(`#${id}`)?.classList.remove('show');
const formatDate = value => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const badge = value => `<span class="tag ${String(value).toLowerCase().replaceAll(' ', '-')}">${escapeHtml(value)}</span>`;
const setError = (form, message = '') => { const error = $('.error', form); if (!error) return; error.textContent = message; error.classList.toggle('hidden', !message); };

$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal-backdrop.show').forEach(modal => closeModal(modal.id)); });

if (document.body.dataset.page === 'resident') initResident();
if (document.body.dataset.page === 'admin') initAdmin();
if (document.body.dataset.page === 'login') initLogin();

function initResident() {
  let locationData = { latitude: null, longitude: null };
  const reportForm = $('#report-form');
  const typeSelect = $('#report-type');
  const photo = $('#report-photo');
  const photoBox = $('.upload-box');
  $$('[data-report-type]').forEach(button => button.addEventListener('click', () => {
    typeSelect.value = button.dataset.reportType;
    setReportCategory(button.dataset.reportType);
    openModal('report-modal');
  }));
  $('[data-scroll="how"]')?.addEventListener('click', () => $('#how').scrollIntoView({ behavior: 'smooth' }));
  $('.lang-select')?.addEventListener('change', event => toast(event.target.value === 'हिंदी' ? 'हिंदी interface is planned for the next release.' : 'English selected.'));
  photo?.addEventListener('change', () => { photoBox.textContent = photo.files[0] ? `✓ ${photo.files[0].name} selected` : '⌁ Choose a photo · report time and available location will be attached'; });
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => { locationData = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; }, () => { }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
  reportForm.addEventListener('submit', async event => {
    event.preventDefault(); setError(reportForm);
    const button = $('button[type="submit"]', reportForm); button.disabled = true; button.textContent = 'Submitting…';
    const form = new FormData(reportForm);
    const payload = Object.fromEntries(['type', 'category', 'location', 'reporterName', 'reporterPhone', 'reporterEmail', 'description'].map(key => [key, form.get(key)]));
    payload.photoName = photo.files[0]?.name || ''; Object.assign(payload, locationData);
    try { const created = await api('/api/complaints', { method: 'POST', body: JSON.stringify(payload) }); $('#success-reference').textContent = created.reference; $('#report-fields').classList.add('hidden'); $('#report-success').classList.remove('hidden'); reportForm.reset(); photoBox.textContent = '⌁ Choose a photo · report time and available location will be attached'; }
    catch (error) { setError(reportForm, error.message); } finally { button.disabled = false; button.textContent = 'Submit service request'; }
  });
  $('#track-button').addEventListener('click', async () => {
    const ref = $('#tracking-reference').value.trim().toUpperCase(); const phone = $('#tracking-phone').value.trim(); const output = $('#track-result'); output.classList.remove('hidden');
    if (!ref || !phone) { output.textContent = 'Enter both the complaint ID and the mobile number used when registering.'; return; }
    output.textContent = 'Looking up your request…';
    try { const item = await api(`/api/complaints/${encodeURIComponent(ref)}?phone=${encodeURIComponent(phone)}`); output.innerHTML = `<b>${escapeHtml(item.reference)}</b> · ${escapeHtml(item.status)}${item.assigned_to ? ` · assigned to ${escapeHtml(item.assigned_to)}` : ''}. Last updated ${formatDate(item.updated_at)}.`; }
    catch (error) { output.textContent = error.message; }
  });
  $$('#tracking-reference, #tracking-phone').forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') $('#track-button').click(); }));
  function setReportCategory(type) { const map = { 'Quarter maintenance': 'Maintenance request', 'Garbage / sanitation': 'Garbage / sanitation', 'Shop operation': 'Shop operation', 'Public issue': 'Pothole / road issue' }; $('#report-category').value = map[type] || 'Other'; }
}

function initAdmin() {
  api('/api/auth/session').then(session => {
    if (!session.authenticated) { window.location.replace('/login.html'); return; }
    if (!['Administrator', 'Sub-administrator'].includes(session.user?.role)) { window.location.replace('/login.html'); return; }
    initAdminConsole(session.user);
  }).catch(() => window.location.replace('/login.html'));
}

function initAdminConsole(currentUser) {
  const state = { summary: null, complaints: [], staff: [], designations: [], users: [], equipment: [], tenders: [], insights: null, user: currentUser };
  const titles = { overview: 'Overview', complaints: 'Complaints', workforce: 'Workforce', equipment: 'Equipment', tenders: 'Tenders', insights: 'AI insights', settings: 'Settings' };

  injectManagementUi();
  updateIdentity();
  $$('[data-admin-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.adminPage)));
  $$('[data-open-admin-complaint]').forEach(button => button.addEventListener('click', () => openModal('admin-complaint-modal')));
  $('#open-sms').addEventListener('click', () => openModal('sms-modal'));
  $('#open-equipment').addEventListener('click', () => { const form = $('#equipment-form'); form.reset(); $('[name="id"]', form).value = ''; $('#equipment-name').textContent = 'Select an item in the register to edit an existing allocation.'; openModal('equipment-modal'); toast('Choose an equipment row to update an existing item.'); });
  $('#open-tender').addEventListener('click', () => openModal('tender-modal'));
  $('#refresh-insights').addEventListener('click', async () => { await loadInsights(); toast('AI daily brief refreshed from current complaint records.'); });
  $('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); window.location.replace('/login.html'); } catch (error) { toast(error.message); } });
  $('#password-form').addEventListener('submit', changePassword);
  $('#complaint-status').addEventListener('change', loadComplaints); $('#complaint-type').addEventListener('change', loadComplaints); $('#export-complaints').addEventListener('click', exportComplaints);
  $('#admin-search').addEventListener('input', debounce(async event => { const query = event.target.value.trim(); if (!query) return; showPage('complaints'); await loadComplaints(query); }, 300));
  $('#admin-complaint-form').addEventListener('submit', event => createComplaint(event, 'admin-complaint-modal'));
  $('#complaint-edit-form').addEventListener('submit', saveComplaint); $('#staff-form').addEventListener('submit', saveStaff); $('#sms-form').addEventListener('submit', sendSms); $('#equipment-form').addEventListener('submit', saveEquipment); $('#tender-form').addEventListener('submit', createTender); $('#tender-edit-form').addEventListener('submit', saveTender);
  $('#staff-add-button').addEventListener('click', openNewStaff); $('#designation-add-button').addEventListener('click', openNewDesignation); $('#staff-manage-designations').addEventListener('click', () => { showPage('workforce'); $('#designation-list-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#staff-create-form').addEventListener('submit', createStaff); $('#designation-form').addEventListener('submit', saveDesignation); $('#user-create-form').addEventListener('submit', createUser); $('#user-edit-form').addEventListener('submit', saveUser);

  Promise.all([loadSummary(), loadComplaints(), loadStaff(), loadDesignations(), loadEquipment(), loadTenders(), loadInsights()]).then(() => { if (currentUser.role === 'Administrator') loadUsers(); }).catch(error => toast(error.message));

  function injectManagementUi() {
    const workforce = $('#workforce');
    const workforceTitle = workforce?.querySelector('.title-row');
    if (workforceTitle && !$('#staff-add-button')) {
      const actions = workforceTitle.querySelector('.title-row > div') ? workforceTitle : workforceTitle;
      const buttonWrap = document.createElement('div'); buttonWrap.className = 'action-line';
      buttonWrap.innerHTML = '<button class="button secondary" id="staff-manage-designations">Manage designations</button><button class="button" id="staff-add-button">＋ Add staff</button><button class="button secondary" id="open-sms">Send SMS update</button>';
      const old = $('#open-sms'); if (old) old.replaceWith(buttonWrap); else workforceTitle.appendChild(buttonWrap);
    }
    const registerCard = workforce?.querySelector('.card');
    if (registerCard && !$('#designation-list-card')) {
      const card = document.createElement('div'); card.className = 'card'; card.id = 'designation-list-card'; card.style.marginTop = '18px';
      card.innerHTML = '<div class="card-head"><h2>Designation register</h2><button class="button secondary small" id="designation-add-button">＋ Create designation</button></div><div id="designation-body" class="insight-list"></div>';
      registerCard.after(card);
    }
    if (workforce && !$('#staff-create-modal')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-backdrop" id="staff-create-modal"><form class="modal" id="staff-create-form"><button type="button" class="close" data-close="staff-create-modal">×</button><h2 id="staff-form-title">Add staff member</h2><p class="sub">Create or update a staff record used by the Civil Office workforce register.</p><input type="hidden" name="id"><div class="form-grid"><div class="field"><label>Full name</label><input name="name" required placeholder="Full name"></div><div class="field"><label>Designation</label><select name="designationId" id="staff-designation" required></select></div></div><div class="form-grid"><div class="field"><label>Department</label><input name="department" required placeholder="Department"></div><div class="field"><label>Phone</label><input name="phone" required placeholder="10-digit mobile number"></div></div><div class="form-grid"><div class="field"><label>Attendance</label><select name="attendance"><option>Present</option><option>Absent</option></select></div><div class="field"><label>Current task</label><input name="currentTask" placeholder="Optional field task"></div></div><p class="error hidden"></p><button class="button" style="width:100%" type="submit">Save staff member</button></form></div>
        <div class="modal-backdrop" id="designation-modal"><form class="modal" id="designation-form"><button type="button" class="close" data-close="designation-modal">×</button><h2 id="designation-form-title">Create designation</h2><p class="sub">Designation names are shared by the staff register.</p><input type="hidden" name="id"><div class="field"><label>Designation name</label><input name="name" required placeholder="e.g. Junior Engineer"></div><div class="field"><label>Description</label><textarea name="description" placeholder="What this designation handles"></textarea></div><p class="error hidden"></p><button class="button" style="width:100%" type="submit">Save designation</button></form></div>
      `);
    }
    if (currentUser.role === 'Administrator') injectAccessUi();
  }
  function injectAccessUi() {
    const settings = $('#settings'); if (!settings || $('#access-card')) return;
    const grid = settings.querySelector('.grid-2'); if (!grid) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'access-card'; card.style.marginTop = '18px';
    card.innerHTML = '<div class="card-head"><div><h2>User & access management</h2><span class="sub">Only Administrators can create accounts or change roles.</span></div><button class="button small" id="user-add-button">＋ Add user</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody id="user-body"></tbody></table></div>';
    grid.appendChild(card);
    document.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop" id="user-create-modal"><form class="modal" id="user-create-form"><button type="button" class="close" data-close="user-create-modal">×</button><h2 id="user-form-title">Add user</h2><p class="sub">Create an account for an Administrator or Sub-administrator.</p><input type="hidden" name="id"><div class="form-grid"><div class="field"><label>Name</label><input name="name" required placeholder="Staff member name"></div><div class="field"><label>Email</label><input name="email" type="email" required placeholder="name@civiloffice.local"></div></div><div class="form-grid"><div class="field"><label>Role</label><select name="role"><option>Sub-administrator</option><option>Administrator</option></select></div><div class="field"><label>Temporary password</label><input name="password" type="password" minlength="12" placeholder="At least 12 characters"></div></div><p class="sub">For a new user, the temporary password is required. Leave it blank when editing if the password should remain unchanged.</p><p class="error hidden"></p><button class="button" style="width:100%" type="submit">Save user</button></form></div>');
    $('#user-add-button').addEventListener('click', openNewUser); $('#user-body').addEventListener('click', handleUserAction);
  }
  function updateIdentity() {
    $$('.side-footer .details').forEach(node => node.innerHTML = `<b>${escapeHtml(state.user.name || 'Civil Office')}</b><br>${escapeHtml(state.user.role)}`);
    const profile = $('.profile'); if (profile) profile.innerHTML = `<span class="avatar">CO</span><div>Civil Office<br><b>${escapeHtml(state.user.role === 'Sub-administrator' ? 'Sub-admin' : 'Admin')}</b></div>`;
  }
  function showPage(id) {
    $$('.admin-page').forEach(page => page.classList.toggle('active', page.id === id)); $$('[data-admin-page]').forEach(button => button.classList.toggle('active', button.dataset.adminPage === id)); $('#crumb').textContent = titles[id];
    if (id === 'complaints') loadComplaints(); if (id === 'workforce') { loadStaff(); loadDesignations(); } if (id === 'equipment') loadEquipment(); if (id === 'tenders') loadTenders(); if (id === 'insights') loadInsights(); if (id === 'settings' && state.user.role === 'Administrator') loadUsers(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function loadSummary() {
    state.summary = await api('/api/summary'); const s = state.summary;
    $('#summary-cards').innerHTML = [['Open complaints', s.open, `${s.receivedToday} received today`, ''], ['Work completion', `${s.completion}%`, '6% from last week', ''], ['Staff on duty', `${s.staffOnDuty} / ${s.staffTotal}`, `${s.staffTotal - s.staffOnDuty} pending attendance`, 'warning'], ['Equipment in use', `${s.equipmentInUse} / ${s.equipmentTotal}`, 'Current operational allocation', '']].map(x => `<div class="summary"><label>${x[0]}</label><strong>${x[1]}</strong><span class="note ${x[3]}">${x[2]}</span></div>`).join('');
    $('#priority-body').innerHTML = s.priority.map(item => `<tr><td class="case">${escapeHtml(item.reference)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.assigned_to || '—')}</td><td>${badge(item.status === 'New' && item.priority === 'Urgent' ? 'Urgent' : item.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No active complaints.</td></tr>';
    $('#activity-list').innerHTML = s.activity.map(item => `<div class="activity"><span class="activity-dot">${activityIcon(item.kind)}</span><p>${escapeHtml(item.message)}<br><time>${formatDate(item.created_at)}</time></p></div>`).join('') || '<p class="empty">No operational activity yet.</p>';
    const health = [['Water supply', 91, ''], ['Electrical works', 78, 'var(--blue)'], ['Sanitation', 84, 'var(--amber)'], ['Public works', 69, 'var(--red)']]; $('#service-health').innerHTML = health.map(row => `<div class="bar-row"><div class="bar-info"><span>${row[0]}</span><b>${row[1]}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${row[1]}%;${row[2] ? `background:${row[2]}` : ''}"></div></div></div>`).join('');
  }
  async function loadComplaints(search = '') {
    const params = new URLSearchParams(); const status = $('#complaint-status').value; const type = $('#complaint-type').value; if (status !== 'All') params.set('status', status); if (type !== 'All') params.set('type', type); if (search) params.set('q', search);
    state.complaints = await api(`/api/complaints?${params}`); $('#complaint-body').innerHTML = state.complaints.map(item => `<tr><td class="case">${escapeHtml(item.reference)}</td><td>${escapeHtml(item.reporter_name)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.category)}</td><td>${badge(item.priority)}</td><td>${badge(item.status)}</td><td class="actions-cell"><button class="button secondary small" data-edit-complaint="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No complaints match these filters.</td></tr>';
    $$('[data-edit-complaint]').forEach(button => button.addEventListener('click', () => editComplaint(Number(button.dataset.editComplaint))));
  }
  async function loadStaff() {
    state.staff = await api('/api/staff'); const present = state.staff.filter(x => x.attendance === 'Present').length; const pct = state.staff.length ? Math.round(present / state.staff.length * 100) : 0;
    $('#workforce-summary').innerHTML = [['Present today', present, `${pct}% attendance`, ''], ['On field tasks', state.staff.filter(x => x.current_task).length, 'Active work allocations', ''], ['SMS-ready staff', present, 'On-duty contacts available', ''], ['Unassigned staff', state.staff.filter(x => x.attendance === 'Present' && !x.current_task).length, 'Available for allocation', 'warning']].map(x => `<div class="summary"><label>${x[0]}</label><strong>${x[1]}</strong><span class="note ${x[3]}">${x[2]}</span></div>`).join('');
    $('#staff-body').innerHTML = state.staff.map(item => `<tr><td><b>${escapeHtml(item.name)}</b><br><span class="sub">${escapeHtml(item.designation || 'Unassigned')}</span></td><td>${escapeHtml(item.department)}</td><td>${badge(item.attendance === 'Present' ? 'Available' : 'Review')}</td><td>${escapeHtml(item.current_task || '—')}</td><td>${item.last_sms_at ? formatDate(item.last_sms_at) : '—'}</td><td><button class="button secondary small" data-edit-staff="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No staff records.</td></tr>';
    $$('[data-edit-staff]').forEach(button => button.addEventListener('click', () => editStaff(Number(button.dataset.editStaff))));
  }
  async function loadDesignations() {
    state.designations = await api('/api/designations');
    const select = $('#staff-designation'); if (select) select.innerHTML = state.designations.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#designation-body').innerHTML = state.designations.map(item => `<div class="insight"><div class="card-head"><div><b>${escapeHtml(item.name)}</b><p class="sub">${escapeHtml(item.description || 'No description')}</p></div><span class="tag">${item.staff_count} staff</span></div><div class="action-line"><button class="button secondary small" data-edit-designation="${item.id}">Edit</button>${item.staff_count === 0 ? `<button class="button secondary small" data-delete-designation="${item.id}">Delete</button>` : ''}</div></div>`).join('') || '<p class="empty">No designations yet.</p>';
    $$('[data-edit-designation]').forEach(button => button.addEventListener('click', () => editDesignation(Number(button.dataset.editDesignation)))); $$('[data-delete-designation]').forEach(button => button.addEventListener('click', () => deleteDesignation(Number(button.dataset.deleteDesignation))));
  }
  async function loadUsers() {
    if (state.user.role !== 'Administrator') return; state.users = await api('/api/users');
    $('#user-body').innerHTML = state.users.map(item => `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.email)}</td><td>${badge(item.role)}</td><td>${formatDate(item.created_at)}</td><td><button class="button secondary small" data-edit-user="${item.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No user accounts.</td></tr>';
  }
  async function loadEquipment() { state.equipment = await api('/api/equipment'); $('#equipment-body').innerHTML = state.equipment.map(item => `<tr><td class="case">${escapeHtml(item.asset_code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.holder || 'Store')}</td><td>${formatDate(item.expected_return)}</td><td>${escapeHtml(item.condition)}</td><td>${badge(item.status)}</td><td><button class="button secondary small" data-edit-equipment="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No equipment records.</td></tr>'; $$('[data-edit-equipment]').forEach(button => button.addEventListener('click', () => editEquipment(Number(button.dataset.editEquipment)))); }
  async function loadTenders() { state.tenders = await api('/api/tenders'); $('#tender-body').innerHTML = state.tenders.map(item => `<tr><td class="case">${escapeHtml(item.tender_no)}</td><td>${escapeHtml(item.scope)}</td><td>${formatDate(item.closing_date)}</td><td>${item.bids}</td><td>${badge(item.status)}</td><td><button class="button secondary small" data-edit-tender="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tenders created.</td></tr>'; $('#tender-timeline').innerHTML = [['1', 'Draft & technical review', 'Scope, estimate and approval note'], ['2', 'Publish & receive bids', 'Secure submission record'], ['3', 'Evaluate & award', 'Comparative statement and audit']].map(item => `<div class="activity"><span class="activity-dot">${item[0]}</span><p><b>${item[1]}</b><br><span class="sub">${item[2]}</span></p></div>`).join(''); $$('[data-edit-tender]').forEach(button => button.addEventListener('click', () => editTender(Number(button.dataset.editTender)))); }
  async function loadInsights() { state.insights = await api('/api/insights'); const info = state.insights; $('#focus-insight').innerHTML = `<span>✦</span><div><b>Recommended focus: ${escapeHtml(info.focus?.category || 'No active issue')} at ${escapeHtml(info.focus?.location || 'the township')}</b>${info.focus ? `${info.focus.count} open report${info.focus.count === 1 ? '' : 's'} point to this issue. Consider a preventive inspection.` : 'Create complaints to generate a focused recommendation.'}</div>`; $('#pattern-list').innerHTML = info.trend.map((item, index) => { const width = Math.min(100, 36 + item.count * 14); const color = index === 1 ? 'var(--amber)' : index === 2 ? 'var(--blue)' : ''; return `<div class="bar-row"><div class="bar-info"><span>${escapeHtml(item.category)}</span><b>${item.change > 0 ? '+' : ''}${item.change}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${width}%;${color ? `background:${color}` : ''}"></div></div></div>`; }).join('') || '<p class="empty">No active complaint patterns yet.</p>'; $('#guardrail-list').innerHTML = info.guardrails.map((item, index) => `<div class="insight"><b>${['Least necessary access', 'Human approval', 'Auditability'][index]}</b><p>${escapeHtml(item)}</p></div>`).join(''); }
  async function createComplaint(event, modalId) { event.preventDefault(); const form = event.currentTarget; setError(form); const button = $('button[type="submit"]', form) || $('button:not([type])', form); if (button) button.disabled = true; try { const payload = Object.fromEntries(new FormData(form)); const data = await api('/api/complaints', { method: 'POST', body: JSON.stringify(payload) }); closeModal(modalId); form.reset(); toast(`${data.reference} created successfully.`); await Promise.all([loadSummary(), loadComplaints(), loadInsights()]); } catch (error) { setError(form, error.message); } finally { if (button) button.disabled = false; } }
  function editComplaint(id) { const item = state.complaints.find(x => x.id === id); if (!item) return; const form = $('#complaint-edit-form'); $('[name="id"]', form).value = item.id; $('[name="status"]', form).value = item.status; $('[name="priority"]', form).value = item.priority; $('[name="assignedTo"]', form).value = item.assigned_to || ''; $('#edit-reference').textContent = `${item.reference} · ${item.location}`; setError(form); openModal('complaint-edit-modal'); }
  async function saveComplaint(event) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); setError(form); try { await api(`/api/complaints/${data.id}`, { method: 'PATCH', body: JSON.stringify(data) }); closeModal('complaint-edit-modal'); toast('Complaint updated.'); await Promise.all([loadSummary(), loadComplaints(), loadInsights()]); } catch (error) { setError(form, error.message); } }
  function openNewStaff() { const form = $('#staff-create-form'); form.reset(); $('[name="id"]', form).value = ''; $('#staff-form-title').textContent = 'Add staff member'; setError(form); if (state.designations.length) $('#staff-designation').value = state.designations.find(x => x.name === 'Unassigned')?.id || state.designations[0].id; openModal('staff-create-modal'); }
  function editStaff(id) { const item = state.staff.find(x => x.id === id); if (!item) return; const form = $('#staff-create-form'); $('[name="id"]', form).value = item.id; $('[name="name"]', form).value = item.name; $('[name="designationId"]', form).value = item.designation_id || ''; $('[name="department"]', form).value = item.department; $('[name="phone"]', form).value = item.phone; $('[name="attendance"]', form).value = item.attendance; $('[name="currentTask"]', form).value = item.current_task || ''; $('#staff-form-title').textContent = 'Update staff member'; setError(form); openModal('staff-create-modal'); }
  async function createStaff(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const editing = Boolean(values.id); const url = editing ? `/api/staff/${values.id}` : '/api/staff'; await api(url, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(values) }); closeModal('staff-create-modal'); form.reset(); toast(editing ? 'Staff record updated.' : 'Staff member added.'); await Promise.all([loadStaff(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function openNewDesignation() { const form = $('#designation-form'); form.reset(); $('[name="id"]', form).value = ''; $('#designation-form-title').textContent = 'Create designation'; setError(form); openModal('designation-modal'); }
  function editDesignation(id) { const item = state.designations.find(x => x.id === id); if (!item) return; const form = $('#designation-form'); $('[name="id"]', form).value = item.id; $('[name="name"]', form).value = item.name; $('[name="description"]', form).value = item.description || ''; $('#designation-form-title').textContent = 'Edit designation'; setError(form); openModal('designation-modal'); }
  async function saveDesignation(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const editing = Boolean(values.id); await api(editing ? `/api/designations/${values.id}` : '/api/designations', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(values) }); closeModal('designation-modal'); form.reset(); toast(editing ? 'Designation updated.' : 'Designation created.'); await Promise.all([loadDesignations(), loadStaff()]); } catch (error) { setError(form, error.message); } }
  async function deleteDesignation(id) { const item = state.designations.find(x => x.id === id); if (!item || !confirm(`Delete designation “${item.name}”?`)) return; try { await api(`/api/designations/${id}`, { method: 'DELETE' }); toast('Designation deleted.'); await loadDesignations(); } catch (error) { toast(error.message); } }
  function openNewUser() { const form = $('#user-create-form'); form.reset(); $('[name="id"]', form).value = ''; $('[name="role"]', form).value = 'Sub-administrator'; $('[name="password"]', form).required = true; $('#user-form-title').textContent = 'Add user'; setError(form); openModal('user-create-modal'); }
  function editUser(id) { const item = state.users.find(x => x.id === id); if (!item) return; const form = $('#user-create-form'); $('[name="id"]', form).value = item.id; $('[name="name"]', form).value = item.name; $('[name="email"]', form).value = item.email; $('[name="role"]', form).value = item.role; $('[name="password"]', form).value = ''; $('[name="password"]', form).required = false; $('#user-form-title').textContent = 'Edit user'; setError(form); openModal('user-create-modal'); }
  async function createUser(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const data = await api('/api/users', { method: 'POST', body: JSON.stringify(values) }); closeModal('user-create-modal'); form.reset(); toast(`${data.email} created as ${data.role}.`); await loadUsers(); } catch (error) { setError(form, error.message); } }
  async function saveUser(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const data = await api(`/api/users/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('user-create-modal'); form.reset(); toast(`${data.email} updated.`); await loadUsers(); } catch (error) { setError(form, error.message); } }
  function handleUserAction(event) { const button = event.target.closest('[data-edit-user]'); if (button) editUser(Number(button.dataset.editUser)); }
  function editEquipment(id) { const item = state.equipment.find(x => x.id === id); if (!item) return; const form = $('#equipment-form'); $('[name="id"]', form).value = item.id; $('[name="holder"]', form).value = item.holder || ''; $('[name="expectedReturn"]', form).value = item.expected_return || ''; $('[name="condition"]', form).value = item.condition; $('[name="status"]', form).value = item.status; $('#equipment-name').textContent = `${item.asset_code} · ${item.name}`; setError(form); openModal('equipment-modal'); }
  async function saveEquipment(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); if (!values.id) { setError(form, 'Choose an equipment row in the register before saving.'); return; } setError(form); try { await api(`/api/equipment/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('equipment-modal'); toast('Equipment record updated.'); await Promise.all([loadEquipment(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  async function sendSms(event) { event.preventDefault(); const form = event.currentTarget; setError(form); try { const data = await api('/api/staff/sms', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); closeModal('sms-modal'); form.reset(); toast(`${data.sent} on-duty staff recorded for SMS dispatch.`); await Promise.all([loadStaff(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  async function createTender(event) { event.preventDefault(); const form = event.currentTarget; setError(form); try { const data = await api('/api/tenders', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); closeModal('tender-modal'); form.reset(); toast(`${data.tender_no} created as a draft.`); await Promise.all([loadTenders(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function editTender(id) { const item = state.tenders.find(x => x.id === id); if (!item) return; const form = $('#tender-edit-form'); $('[name="id"]', form).value = item.id; $('[name="status"]', form).value = item.status; $('[name="bids"]', form).value = item.bids; $('#tender-no').textContent = `${item.tender_no} · ${item.scope}`; setError(form); openModal('tender-edit-modal'); }
  async function saveTender(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { await api(`/api/tenders/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('tender-edit-modal'); toast('Tender record updated.'); await Promise.all([loadTenders(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function exportComplaints() { const rows = state.complaints; if (!rows.length) { toast('There are no complaint records to export.'); return; } const headers = ['Reference', 'Type', 'Category', 'Location', 'Reporter', 'Phone', 'Priority', 'Status', 'Assigned to', 'Created']; const csv = [headers, ...rows.map(row => [row.reference, row.type, row.category, row.location, row.reporter_name, row.reporter_phone, row.priority, row.status, row.assigned_to || '', row.created_at])].map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'civil-affairs-complaints.csv'; anchor.click(); URL.revokeObjectURL(url); toast('Complaint register exported as CSV.'); }
  async function changePassword(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const data = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(values) }); form.reset(); toast(data.message); } catch (error) { setError(form, error.message); } }
}
function initLogin() {
  api('/api/auth/session').then(session => { if (session.authenticated) window.location.replace('/admin.html'); }).catch(() => { });
  const form = $('#login-form'); form.addEventListener('submit', async event => { event.preventDefault(); setError(form); const button = $('button[type="submit"]', form); button.disabled = true; button.textContent = 'Signing in…'; try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); window.location.replace('/admin.html'); } catch (error) { setError(form, error.message); } finally { button.disabled = false; button.textContent = 'Sign in securely'; } });
}
function activityIcon(kind) { return ({ resolved: '✓', assignment: '♧', equipment: '▣', complaint: '◉', update: '↻', staff: '♧', sms: '✉', tender: '▤', security: '◉' }[kind] || '•'); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }