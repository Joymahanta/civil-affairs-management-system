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
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
    pos => { locationData = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; },
    () => { }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
  );
  reportForm.addEventListener('submit', async event => {
    event.preventDefault(); setError(reportForm);
    const button = $('button[type="submit"]', reportForm); button.disabled = true; button.textContent = 'Submitting…';
    const form = new FormData(reportForm);
    const payload = Object.fromEntries(['type', 'category', 'location', 'reporterName', 'reporterPhone', 'reporterEmail', 'description'].map(key => [key, form.get(key)]));
    payload.photoName = photo.files[0]?.name || '';
    Object.assign(payload, locationData);
    try {
      const created = await api('/api/complaints', { method: 'POST', body: JSON.stringify(payload) });
      $('#success-reference').textContent = created.reference;
      $('#report-fields').classList.add('hidden'); $('#report-success').classList.remove('hidden');
      reportForm.reset(); photoBox.textContent = '⌁ Choose a photo · report time and available location will be attached';
    } catch (error) { setError(reportForm, error.message); } finally { button.disabled = false; button.textContent = 'Submit service request'; }
  });
  $('#track-button').addEventListener('click', async () => {
    const ref = $('#tracking-reference').value.trim().toUpperCase(); const phone = $('#tracking-phone').value.trim(); const output = $('#track-result');
    output.classList.remove('hidden');
    if (!ref || !phone) { output.textContent = 'Enter both the complaint ID and the mobile number used when registering.'; return; }
    output.textContent = 'Looking up your request…';
    try { const item = await api(`/api/complaints/${encodeURIComponent(ref)}?phone=${encodeURIComponent(phone)}`); output.innerHTML = `<b>${escapeHtml(item.reference)}</b> · ${escapeHtml(item.status)}${item.assigned_to ? ` · assigned to ${escapeHtml(item.assigned_to)}` : ''}. Last updated ${formatDate(item.updated_at)}.`; }
    catch (error) { output.textContent = error.message; }
  });
  $$('#tracking-reference, #tracking-phone').forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') $('#track-button').click(); }));
  function setReportCategory(type) {
    const map = { 'Quarter maintenance': 'Maintenance request', 'Garbage / sanitation': 'Garbage / sanitation', 'Shop operation': 'Shop operation', 'Public issue': 'Pothole / road issue' };
    $('#report-category').value = map[type] || 'Other';
  }
}

function initAdmin() {
  api('/api/auth/session').then(session => {
    if (!session.authenticated) { window.location.replace('/login.html'); return; }
    initAdminConsole();
  }).catch(() => window.location.replace('/login.html'));
}

function initAdminConsole() {
  const state = { summary: null, complaints: [], staff: [], equipment: [], tenders: [], insights: null };
  const titles = { overview: 'Overview', complaints: 'Complaints', workforce: 'Workforce', equipment: 'Equipment', tenders: 'Tenders', insights: 'AI insights', settings: 'Settings' };

  $$('[data-admin-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.adminPage)));
  $$('[data-open-admin-complaint]').forEach(button => button.addEventListener('click', () => openModal('admin-complaint-modal')));
  $('#open-sms').addEventListener('click', () => openModal('sms-modal'));
  $('#open-equipment').addEventListener('click', () => { const form = $('#equipment-form'); form.reset(); $('[name="id"]', form).value = ''; $('#equipment-name').textContent = 'Select an item in the register to edit an existing allocation.'; openModal('equipment-modal'); toast('Choose an equipment row to update an existing item.'); });
  $('#open-tender').addEventListener('click', () => openModal('tender-modal'));
  $('#refresh-insights').addEventListener('click', async () => { await loadInsights(); toast('AI daily brief refreshed from current complaint records.'); });
  $('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); window.location.replace('/login.html'); } catch (error) { toast(error.message); } });
  $('#password-form').addEventListener('submit', changePassword);
  $('#complaint-status').addEventListener('change', loadComplaints);
  $('#complaint-type').addEventListener('change', loadComplaints);
  $('#export-complaints').addEventListener('click', exportComplaints);
  $('#admin-search').addEventListener('input', debounce(async event => {
    const query = event.target.value.trim();
    if (!query) return;
    showPage('complaints');
    await loadComplaints(query);
  }, 300));

  $('#admin-complaint-form').addEventListener('submit', event => createComplaint(event, 'admin-complaint-modal'));
  $('#complaint-edit-form').addEventListener('submit', saveComplaint);
  $('#staff-form').addEventListener('submit', saveStaff);
  $('#sms-form').addEventListener('submit', sendSms);
  $('#equipment-form').addEventListener('submit', saveEquipment);
  $('#tender-form').addEventListener('submit', createTender);
  $('#tender-edit-form').addEventListener('submit', saveTender);

  Promise.all([loadSummary(), loadComplaints(), loadStaff(), loadEquipment(), loadTenders(), loadInsights()]).catch(error => toast(error.message));

  function showPage(id) {
    $$('.admin-page').forEach(page => page.classList.toggle('active', page.id === id));
    $$('[data-admin-page]').forEach(button => button.classList.toggle('active', button.dataset.adminPage === id));
    $('#crumb').textContent = titles[id];
    if (id === 'complaints') loadComplaints();
    if (id === 'workforce') loadStaff();
    if (id === 'equipment') loadEquipment();
    if (id === 'tenders') loadTenders();
    if (id === 'insights') loadInsights();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function loadSummary() {
    state.summary = await api('/api/summary'); const s = state.summary;
    $('#summary-cards').innerHTML = [
      ['Open complaints', s.open, `${s.receivedToday} received today`, ''], ['Work completion', `${s.completion}%`, '6% from last week', ''],
      ['Staff on duty', `${s.staffOnDuty} / ${s.staffTotal}`, `${s.staffTotal - s.staffOnDuty} pending attendance`, 'warning'], ['Equipment in use', `${s.equipmentInUse} / ${s.equipmentTotal}`, 'Current operational allocation', '']
    ].map(x => `<div class="summary"><label>${x[0]}</label><strong>${x[1]}</strong><span class="note ${x[3]}">${x[2]}</span></div>`).join('');
    $('#priority-body').innerHTML = s.priority.map(item => `<tr><td class="case">${escapeHtml(item.reference)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.assigned_to || '—')}</td><td>${badge(item.status === 'New' && item.priority === 'Urgent' ? 'Urgent' : item.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No active complaints.</td></tr>';
    $('#activity-list').innerHTML = s.activity.map(item => `<div class="activity"><span class="activity-dot">${activityIcon(item.kind)}</span><p>${escapeHtml(item.message)}<br><time>${formatDate(item.created_at)}</time></p></div>`).join('') || '<p class="empty">No operational activity yet.</p>';
    const health = [['Water supply', 91, ''], ['Electrical works', 78, 'var(--blue)'], ['Sanitation', 84, 'var(--amber)'], ['Public works', 69, 'var(--red)']];
    $('#service-health').innerHTML = health.map(row => `<div class="bar-row"><div class="bar-info"><span>${row[0]}</span><b>${row[1]}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${row[1]}%;${row[2] ? `background:${row[2]}` : ''}"></div></div></div>`).join('');
  }
  async function loadComplaints(search = '') {
    const params = new URLSearchParams(); const status = $('#complaint-status').value; const type = $('#complaint-type').value;
    if (status !== 'All') params.set('status', status); if (type !== 'All') params.set('type', type); if (search) params.set('q', search);
    state.complaints = await api(`/api/complaints?${params}`);
    $('#complaint-body').innerHTML = state.complaints.map(item => `<tr><td class="case">${escapeHtml(item.reference)}</td><td>${escapeHtml(item.reporter_name)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.category)}</td><td>${badge(item.priority)}</td><td>${badge(item.status)}</td><td class="actions-cell"><button class="button secondary small" data-edit-complaint="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No complaints match these filters.</td></tr>';
    $$('[data-edit-complaint]').forEach(button => button.addEventListener('click', () => editComplaint(Number(button.dataset.editComplaint))));
  }
  async function loadStaff() {
    state.staff = await api('/api/staff'); const present = state.staff.filter(x => x.attendance === 'Present').length;
    $('#workforce-summary').innerHTML = [['Present today', present, `${Math.round(present / state.staff.length * 100)}% attendance`, ''], ['On field tasks', state.staff.filter(x => x.current_task).length, 'Active work allocations', ''], ['SMS-ready staff', present, 'On-duty contacts available', ''], ['Unassigned staff', state.staff.filter(x => x.attendance === 'Present' && !x.current_task).length, 'Available for allocation', 'warning']].map(x => `<div class="summary"><label>${x[0]}</label><strong>${x[1]}</strong><span class="note ${x[3]}">${x[2]}</span></div>`).join('');
    $('#staff-body').innerHTML = state.staff.map(item => `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.designation || 'Unassigned')}</td><td>${escapeHtml(item.department)}</td><td>${escapeHtml(item.phone)}</td><td>${badge(item.attendance === 'Present' ? 'Available' : 'Review')}</td><td>${escapeHtml(item.current_task || '—')}</td><td><button class="button secondary small" data-edit-staff="${item.id}">Update</button></td></tr>`).join('');
    $$('[data-edit-staff]').forEach(button => button.addEventListener('click', () => editStaff(Number(button.dataset.editStaff))));
  }
  async function loadEquipment() {
    state.equipment = await api('/api/equipment');
    $('#equipment-body').innerHTML = state.equipment.map(item => `<tr><td class="case">${escapeHtml(item.asset_code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.holder || 'Store')}</td><td>${formatDate(item.expected_return)}</td><td>${escapeHtml(item.condition)}</td><td>${badge(item.status)}</td><td><button class="button secondary small" data-edit-equipment="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No equipment records.</td></tr>';
    $$('[data-edit-equipment]').forEach(button => button.addEventListener('click', () => editEquipment(Number(button.dataset.editEquipment))));
  }
  async function loadTenders() {
    state.tenders = await api('/api/tenders');
    $('#tender-body').innerHTML = state.tenders.map(item => `<tr><td class="case">${escapeHtml(item.tender_no)}</td><td>${escapeHtml(item.scope)}</td><td>${formatDate(item.closing_date)}</td><td>${item.bids}</td><td>${badge(item.status)}</td><td><button class="button secondary small" data-edit-tender="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tenders created.</td></tr>';
    $('#tender-timeline').innerHTML = [['1', 'Draft & technical review', 'Scope, estimate and approval note'], ['2', 'Publish & receive bids', 'Secure submission record'], ['3', 'Evaluate & award', 'Comparative statement and audit']].map(item => `<div class="activity"><span class="activity-dot">${item[0]}</span><p><b>${item[1]}</b><br><span class="sub">${item[2]}</span></p></div>`).join('');
    $$('[data-edit-tender]').forEach(button => button.addEventListener('click', () => editTender(Number(button.dataset.editTender))));
  }
  async function loadInsights() {
    state.insights = await api('/api/insights'); const info = state.insights;
    $('#focus-insight').innerHTML = `<span>✦</span><div><b>Recommended focus: ${escapeHtml(info.focus?.category || 'No active issue')} at ${escapeHtml(info.focus?.location || 'the township')}</b>${info.focus ? `${info.focus.count} open report${info.focus.count === 1 ? '' : 's'} point to this issue. Consider a preventive inspection.` : 'Create complaints to generate a focused recommendation.'}</div>`;
    $('#pattern-list').innerHTML = info.trend.map((item, index) => { const width = Math.min(100, 36 + item.count * 14); const color = index === 1 ? 'var(--amber)' : index === 2 ? 'var(--blue)' : ''; return `<div class="bar-row"><div class="bar-info"><span>${escapeHtml(item.category)}</span><b>${item.change > 0 ? '+' : ''}${item.change}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${width}%;${color ? `background:${color}` : ''}"></div></div></div>`; }).join('') || '<p class="empty">No active complaint patterns yet.</p>';
    $('#guardrail-list').innerHTML = info.guardrails.map((item, index) => `<div class="insight"><b>${['Least necessary access', 'Human approval', 'Auditability'][index]}</b><p>${escapeHtml(item)}</p></div>`).join('');
  }
  async function createComplaint(event, modalId) {
    event.preventDefault(); const form = event.currentTarget; setError(form); const button = $('button[type="submit"]', form) || $('button:not([type])', form);
if (button) button.disabled = true;
    try { const payload = Object.fromEntries(new FormData(form)); const data = await api('/api/complaints', { method: 'POST', body: JSON.stringify(payload) }); closeModal(modalId); form.reset(); toast(`${data.reference} created successfully.`); await Promise.all([loadSummary(), loadComplaints(), loadInsights()]); }
    catch (error) { setError(form, error.message); }finally { if (button) button.disabled = false; }
  }
  function editComplaint(id) { const item = state.complaints.find(x => x.id === id); if (!item) return; const form = $('#complaint-edit-form'); $('[name="id"]', form).value = item.id; $('[name="status"]', form).value = item.status; $('[name="priority"]', form).value = item.priority; $('[name="assignedTo"]', form).value = item.assigned_to || ''; $('#edit-reference').textContent = `${item.reference} · ${item.location}`; setError(form); openModal('complaint-edit-modal'); }
  async function saveComplaint(event) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); setError(form); try { await api(`/api/complaints/${data.id}`, { method: 'PATCH', body: JSON.stringify(data) }); closeModal('complaint-edit-modal'); toast('Complaint updated.'); await Promise.all([loadSummary(), loadComplaints(), loadInsights()]); } catch (error) { setError(form, error.message); } }
  function editStaff(id) { const item = state.staff.find(x => x.id === id); if (!item) return; const form = $('#staff-form'); $('[name="id"]', form).value = item.id; $('[name="attendance"]', form).value = item.attendance; $('[name="currentTask"]', form).value = item.current_task || ''; $('#staff-name').textContent = `${item.name} · ${item.department}`; setError(form); openModal('staff-modal'); }
  async function saveStaff(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { await api(`/api/staff/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('staff-modal'); toast('Staff record updated.'); await Promise.all([loadStaff(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  async function sendSms(event) { event.preventDefault(); const form = event.currentTarget; setError(form); try { const data = await api('/api/staff/sms', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); closeModal('sms-modal'); form.reset(); toast(`${data.sent} on-duty staff recorded for SMS dispatch.`); await Promise.all([loadStaff(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function editEquipment(id) { const item = state.equipment.find(x => x.id === id); if (!item) return; const form = $('#equipment-form'); $('[name="id"]', form).value = item.id; $('[name="holder"]', form).value = item.holder || ''; $('[name="expectedReturn"]', form).value = item.expected_return || ''; $('[name="condition"]', form).value = item.condition; $('[name="status"]', form).value = item.status; $('#equipment-name').textContent = `${item.asset_code} · ${item.name}`; setError(form); openModal('equipment-modal'); }
  async function saveEquipment(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); if (!values.id) { setError(form, 'Choose an equipment row in the register before saving.'); return; } setError(form); try { await api(`/api/equipment/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('equipment-modal'); toast('Equipment record updated.'); await Promise.all([loadEquipment(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  async function createTender(event) { event.preventDefault(); const form = event.currentTarget; setError(form); try { const data = await api('/api/tenders', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); closeModal('tender-modal'); form.reset(); toast(`${data.tender_no} created as a draft.`); await Promise.all([loadTenders(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function editTender(id) { const item = state.tenders.find(x => x.id === id); if (!item) return; const form = $('#tender-edit-form'); $('[name="id"]', form).value = item.id; $('[name="status"]', form).value = item.status; $('[name="bids"]', form).value = item.bids; $('#tender-no').textContent = `${item.tender_no} · ${item.scope}`; setError(form); openModal('tender-edit-modal'); }
  async function saveTender(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { await api(`/api/tenders/${values.id}`, { method: 'PATCH', body: JSON.stringify(values) }); closeModal('tender-edit-modal'); toast('Tender record updated.'); await Promise.all([loadTenders(), loadSummary()]); } catch (error) { setError(form, error.message); } }
  function exportComplaints() { const rows = state.complaints; if (!rows.length) { toast('There are no complaint records to export.'); return; } const headers = ['Reference', 'Type', 'Category', 'Location', 'Reporter', 'Phone', 'Priority', 'Status', 'Assigned to', 'Created']; const csv = [headers, ...rows.map(row => [row.reference, row.type, row.category, row.location, row.reporter_name, row.reporter_phone, row.priority, row.status, row.assigned_to || '', row.created_at])].map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'civil-affairs-complaints.csv'; anchor.click(); URL.revokeObjectURL(url); toast('Complaint register exported as CSV.'); }
  async function changePassword(event) { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setError(form); try { const data = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(values) }); form.reset(); toast(data.message); } catch (error) { setError(form, error.message); } }
}
function initLogin() {
  api('/api/auth/session').then(session => { if (session.authenticated) window.location.replace('/admin.html'); }).catch(() => { });
  const form = $('#login-form');
  form.addEventListener('submit', async event => { event.preventDefault(); setError(form); const button = $('button[type="submit"]', form); button.disabled = true; button.textContent = 'Signing in…'; try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); window.location.replace('/admin.html'); } catch (error) { setError(form, error.message); } finally { button.disabled = false; button.textContent = 'Sign in securely'; } });
}
function activityIcon(kind) { return ({ resolved: '✓', assignment: '♧', equipment: '▣', complaint: '◉', update: '↻', staff: '♧', sms: '✉', tender: '▤' }[kind] || '•'); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
