(() => {
  if (window.__camsCompleteAdmin) return;
  window.__camsCompleteAdmin = true;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (url, options = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p.error || 'Request failed.');
    return p;
  };
  const toast = message => { const n = $('#toast'); if (!n) return; n.textContent = message; n.classList.add('show'); clearTimeout(window.__camsToast); window.__camsToast = setTimeout(() => n.classList.remove('show'), 4200); };
  const show = id => $(`#${id}`)?.classList.add('show');
  const hide = id => $(`#${id}`)?.classList.remove('show');
  const error = (form, message) => { const n = $('.error', form); if (n) { n.textContent = message || ''; n.classList.toggle('hidden', !message); } };

  function modal(id, html) {
    let node = $(`#${id}`);
    if (!node) { node = document.createElement('div'); node.id = id; node.className = 'modal-backdrop'; document.body.appendChild(node); }
    node.innerHTML = html;
    node.classList.add('show');
    node.addEventListener('click', e => { if (e.target === node || e.target.closest('[data-cams-close]')) node.classList.remove('show'); }, { once: true });
    return node;
  }

  async function loadCurrentAdmin() {
    const form = $('#admin-complaint-form'); if (!form) return;
    try {
      const user = await api('/api/admin/current-user', { cache: 'no-store' });
      for (const [name, value] of [['reporterName', user.name], ['reporterPhone', user.phone], ['reporterEmail', user.email]]) {
        const input = form.elements[name];
        if (!input) continue;
        input.value = value || '';
        input.readOnly = true;
        input.required = name !== 'reporterEmail';
        input.title = 'Automatically loaded from the administrator signed in on this device';
        input.style.background = '#f4f7f5';
      }
    } catch (_) {}
  }

  function fixNavigation() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-admin-page]');
      if (!button || button.dataset.adminPage === 'overview' || button.dataset.adminPage === 'complaints' || button.dataset.adminPage === 'workforce' || button.dataset.adminPage === 'equipment' || button.dataset.adminPage === 'tenders' || button.dataset.adminPage === 'insights' || button.dataset.adminPage === 'settings') return;
      event.preventDefault(); event.stopImmediatePropagation();
      const id = button.dataset.adminPage;
      $$('.admin-page').forEach(p => p.classList.toggle('active', p.id === id));
      $$('[data-admin-page]').forEach(b => b.classList.toggle('active', b.dataset.adminPage === id));
      const title = button.textContent.trim(); if ($('#crumb')) $('#crumb').textContent = title;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, true);
  }

  function fixComplaintFilters() {
    document.addEventListener('change', async event => {
      if (!['complaint-status', 'complaint-type'].includes(event.target.id)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        const params = new URLSearchParams();
        const status = $('#complaint-status')?.value, type = $('#complaint-type')?.value;
        if (status && status !== 'All') params.set('status', status);
        if (type && type !== 'All') params.set('type', type);
        const rows = await api(`/api/complaints?${params}`);
        renderComplaintRows(rows);
      } catch (e) { toast(e.message); }
    }, true);
  }

  function renderComplaintRows(rows) {
    const body = $('#complaint-body'); if (!body) return;
    const badge = v => `<span class="tag ${String(v || '').toLowerCase().replaceAll(' ', '-')}">${esc(v || '—')}</span>`;
    body.innerHTML = rows.map(x => `<tr><td class="case">${esc(x.reference)}</td><td>${esc(x.reporter_name)}</td><td>${esc(x.location)}</td><td>${esc(x.category)}</td><td>${badge(x.priority)}</td><td>${badge(x.status)}</td><td class="actions-cell"><button type="button" class="button secondary small" data-cams-history="${x.id}">History</button> <button type="button" class="button secondary small" data-edit-complaint="${x.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No complaints match these filters.</td></tr>';
    body.querySelectorAll('[data-cams-history]').forEach(b => b.onclick = () => showComplaintHistory(Number(b.dataset.camsHistory)));
    body.querySelectorAll('[data-edit-complaint]').forEach(b => b.onclick = () => document.querySelector(`[data-edit-complaint="${b.dataset.editComplaint}"]`)?.click());
  }

  async function showComplaintHistory(id) {
    const m = modal('cams-history-modal', '<div class="modal"><button type="button" class="close" data-cams-close>×</button><h2>Complaint history</h2><p class="sub">Loading persistent Firestore history…</p></div>');
    try {
      const rows = await api(`/api/complaints/${id}/history`);
      $('.modal', m).insertAdjacentHTML('beforeend', rows.length ? `<div class="insight-list">${rows.map(x => `<div class="activity"><span class="activity-dot">↻</span><p><b>${esc(x.event_type || x.action || 'Update')}</b><br>${esc(x.message || x.details || '')}<br><time>${esc(x.created_at || x.timestamp || '')}</time></p></div>`).join('')}</div>` : '<p class="empty">No history recorded.</p>');
      $('.sub', m).textContent = `${rows.length} persistent history event${rows.length === 1 ? '' : 's'}.`;
    } catch (e) { $('.sub', m).textContent = e.message; }
  }

  async function prepareEquipmentForm(form, existing = null) {
    const ensure = (name, label, html) => {
      if (form.elements[name]) return form.elements[name];
      const wrap = document.createElement('div'); wrap.className = 'field'; wrap.innerHTML = `<label>${label}</label>${html}`;
      form.querySelector('.form-grid')?.prepend(wrap); return form.elements[name];
    };
    const asset = ensure('assetCode', 'Asset ID', '<input name="assetCode" required placeholder="EQ-001">');
    const name = ensure('name', 'Equipment name', '<input name="name" required placeholder="Water pump">');
    ensure('category', 'Category', '<input name="category" placeholder="Electrical / Roads / Waterworks">');
    let holder = form.elements.holder;
    if (!holder || holder.tagName !== 'SELECT') {
      const old = holder; const select = document.createElement('select'); select.name = 'holder'; select.innerHTML = '<option value="">Unassigned</option>'; old?.replaceWith(select); holder = select;
    }
    try {
      const staff = await api('/api/staff');
      holder.innerHTML = '<option value="">Unassigned</option>' + staff.map(s => `<option value="${esc(s.name)}">${esc(s.name)}${s.department ? ` · ${esc(s.department)}` : ''}</option>`).join('');
    } catch (_) {}
    if (existing) {
      form.elements.id.value = existing.id;
      asset.value = existing.asset_code || existing.assetCode || '';
      name.value = existing.name || '';
      form.elements.category.value = existing.category || '';
      holder.value = existing.holder || existing.assigned_to || '';
      if (form.elements.expectedReturn) form.elements.expectedReturn.value = existing.expected_return || existing.expectedReturn || '';
      if (form.elements.condition) form.elements.condition.value = existing.condition || 'Good';
      if (form.elements.status) form.elements.status.value = existing.status || 'Available';
    }
  }

  function fixEquipment() {
    document.addEventListener('click', async event => {
      if (event.target.closest('#open-equipment')) {
        event.preventDefault(); event.stopImmediatePropagation();
        const form = $('#equipment-form'); if (!form) return; form.reset(); form.elements.id.value = '';
        await prepareEquipmentForm(form); $('#equipment-name').textContent = 'Create a new persistent equipment record in Firestore.'; show('equipment-modal');
      }
      const edit = event.target.closest('[data-edit-equipment]');
      if (edit) {
        event.preventDefault(); event.stopImmediatePropagation();
        const rows = await api('/api/equipment'); const item = rows.find(x => Number(x.id) === Number(edit.dataset.editEquipment));
        if (!item) return; const form = $('#equipment-form'); form.reset(); await prepareEquipmentForm(form, item); $('#equipment-name').textContent = `${item.asset_code || item.assetCode} · ${item.name}`; show('equipment-modal');
      }
    }, true);
    document.addEventListener('submit', async event => {
      const form = event.target.closest('#equipment-form'); if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const data = Object.fromEntries(new FormData(form));
      try { const id = data.id; await api(id ? `/api/equipment/${id}` : '/api/equipment', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); hide('equipment-modal'); toast(id ? 'Equipment updated and saved to Firestore.' : 'Equipment added and saved to Firestore.'); window.dispatchEvent(new Event('cams:refresh')); } catch (e) { error(form, e.message); }
    }, true);
  }

  async function prepareSms() {
    const form = $('#sms-form'); if (!form || form.elements.staffIds) return;
    const wrap = document.createElement('div'); wrap.className = 'field'; wrap.innerHTML = '<label>Staff recipients</label><select name="staffIds" multiple size="7" required></select><small class="sub">Select one or more staff. Indian numbers with or without +91/spaces are accepted.</small>';
    form.querySelector('.field')?.before(wrap);
    const select = form.elements.staffIds;
    try { const staff = await api('/api/staff'); select.innerHTML = staff.map(s => `<option value="${s.id}" ${s.phone ? '' : 'disabled'}>${esc(s.name)} · ${esc(s.phone || 'No phone')}</option>`).join(''); } catch (e) { select.innerHTML = `<option disabled>${esc(e.message)}</option>`; }
  }

  function fixSms() {
    document.addEventListener('click', event => { if (event.target.closest('#open-sms')) setTimeout(() => prepareSms(), 0); }, true);
    document.addEventListener('submit', async event => {
      const form = event.target.closest('#sms-form'); if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const data = Object.fromEntries(new FormData(form)); data.staffIds = [...form.elements.staffIds.selectedOptions].map(x => Number(x.value));
      try { const result = await api('/api/staff/sms', { method: 'POST', body: JSON.stringify(data) }); hide('sms-modal'); form.reset(); toast(`TextBee accepted ${result.sent || result.accepted || 0} SMS for delivery.`); } catch (e) { error(form, e.message); }
    }, true);
  }

  function tenderFields(form) {
    if (form.dataset.camsExpanded) return;
    form.dataset.camsExpanded = '1';
    const grid = document.createElement('div'); grid.className = 'form-grid';
    grid.innerHTML = '<div class="field"><label>Department</label><input name="department"></div><div class="field"><label>Estimated value</label><input name="estimatedValue" type="number" step="0.01"></div><div class="field"><label>Procurement method</label><select name="procurementMethod"><option>Open tender</option><option>Limited tender</option><option>Single source</option></select></div><div class="field"><label>Eligibility</label><input name="eligibility"></div><div class="field"><label>EMD</label><input name="emd"></div><div class="field"><label>Performance security</label><input name="performanceSecurity"></div></div><div class="field"><label>Notes</label><textarea name="notes"></textarea></div>';
    form.querySelector('[name="closingDate"]')?.closest('.field')?.after(grid);
  }

  async function showTender(id) {
    const m = modal('cams-tender-modal', '<div class="modal"><button type="button" class="close" data-cams-close>×</button><h2>Tender details</h2><p class="sub">Loading…</p></div>');
    try {
      const t = await api(`/api/tenders/${id}/details`), bidders = t.bidders || [], history = t.history || [];
      $('.modal', m).innerHTML = `<button type="button" class="close" data-cams-close>×</button><h2>${esc(t.tender_no)} — Tender details</h2><p class="sub">${esc(t.scope)}</p><div class="form-grid"><div class="field"><label>Department</label><input id="td-dept" value="${esc(t.department || '')}"></div><div class="field"><label>Estimated value</label><input id="td-value" value="${esc(t.estimated_value || '')}"></div><div class="field"><label>Procurement method</label><input id="td-method" value="${esc(t.procurement_method || '')}"></div><div class="field"><label>Eligibility</label><input id="td-elig" value="${esc(t.eligibility || '')}"></div></div><div class="field"><label>Notes</label><textarea id="td-notes">${esc(t.notes || '')}</textarea></div><h3>Bidders (${bidders.length})</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Bidder</th><th>Contact</th><th>Amount</th><th>Technical</th><th>Financial</th><th>Status</th></tr></thead><tbody>${bidders.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.contact || b.email || '—')}</td><td>${esc(b.bid_amount || '—')}</td><td>${esc(b.technical_score || '—')}</td><td>${esc(b.financial_score || '—')}</td><td>${esc(b.status || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No bids recorded.</td></tr>'}</tbody></table></div><div class="form-grid"><div class="field"><label>New bidder</label><input id="new-bidder-name"></div><div class="field"><label>Contact</label><input id="new-bidder-contact"></div><div class="field"><label>Bid amount</label><input id="new-bidder-amount" type="number" step="0.01"></div><div class="field"><label>Status</label><select id="new-bidder-status"><option>Received</option><option>Technically qualified</option><option>Disqualified</option><option>Selected</option></select></div></div><div class="action-line"><button class="button" type="button" id="td-save">Save tender details</button><button class="button secondary" type="button" id="td-bid">Add bidder</button></div><h3>Bidding / approval history</h3><div class="insight-list">${history.map(h => `<div class="activity"><span class="activity-dot">•</span><p><b>${esc(h.event_type || 'Update')}</b><br>${esc(h.message || '')}<br><time>${esc(h.created_at || '')}</time></p></div>`).join('') || '<p class="empty">No history yet.</p>'}</div>`;
      $('#td-save', m).onclick = async () => { try { await api(`/api/tenders/${id}`, { method: 'PATCH', body: JSON.stringify({ department: $('#td-dept', m).value, estimatedValue: $('#td-value', m).value, procurementMethod: $('#td-method', m).value, eligibility: $('#td-elig', m).value, notes: $('#td-notes', m).value }) }); toast('Tender details saved to Firestore.'); await showTender(id); } catch (e) { toast(e.message); } };
      $('#td-bid', m).onclick = async () => { const name = $('#new-bidder-name', m).value.trim(); if (!name) return toast('Enter the bidder name.'); try { await api(`/api/tenders/${id}/bidders`, { method: 'POST', body: JSON.stringify({ name, contact: $('#new-bidder-contact', m).value, bidAmount: $('#new-bidder-amount', m).value, status: $('#new-bidder-status', m).value }) }); toast('Bidder saved to Firestore.'); await showTender(id); } catch (e) { toast(e.message); } };
    } catch (e) { $('.sub', m).textContent = e.message; }
  }

  function fixTenders() {
    document.addEventListener('click', event => {
      if (event.target.closest('#open-tender')) { setTimeout(() => tenderFields($('#tender-form')), 0); }
      const button = event.target.closest('[data-edit-tender]'); if (button) { const id = Number(button.dataset.editTender); const existing = document.querySelector(`[data-cams-tender-detail="${id}"]`); if (!existing) { const b = document.createElement('button'); b.type = 'button'; b.className = 'button secondary small'; b.dataset.camsTenderDetail = id; b.textContent = 'Bids & history'; button.parentElement.appendChild(b); b.onclick = () => showTender(id); } }
      const detail = event.target.closest('[data-cams-tender-detail]'); if (detail) { event.preventDefault(); event.stopImmediatePropagation(); showTender(Number(detail.dataset.camsTenderDetail)); }
    }, true);
    document.addEventListener('submit', async event => {
      const form = event.target.closest('#tender-form'); if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation(); tenderFields(form);
      try { const data = await api('/api/tenders', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); hide('tender-modal'); form.reset(); toast(`${data.tender_no} created and saved to Firestore.`); } catch (e) { error(form, e.message); }
    }, true);
  }

  async function renderInsights() {
    try {
      const info = await api('/api/insights');
      if ($('#focus-insight')) $('#focus-insight').innerHTML = `<span>✦</span><div><b>${esc(info.brief || info.summary || 'Daily operational brief')}</b></div>`;
      if ($('#pattern-list')) $('#pattern-list').innerHTML = (info.trend || []).map(x => `<div class="bar-row"><div class="bar-info"><span>${esc(x.category)}</span><b>${x.count} open · ${x.change >= 0 ? '+' : ''}${x.change}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(8, 30 + x.count * 12))}%"></div></div></div>`).join('') || '<p class="empty">No active complaint patterns.</p>';
      if ($('#guardrail-list')) $('#guardrail-list').innerHTML = (info.guardrails || []).map((x, i) => `<div class="insight"><b>${['Least necessary access','Human approval','Auditability'][i] || 'Guardrail'}</b><p>${esc(x)}</p></div>`).join('');
    } catch (e) { toast(e.message); }
  }

  function fixInsights() {
    document.addEventListener('click', event => { if (event.target.closest('#refresh-insights')) { event.preventDefault(); event.stopImmediatePropagation(); renderInsights().then(() => toast('AI daily brief generated from current Firestore records.')); } }, true);
  }

  function boot() {
    if (document.body.dataset.page !== 'admin') return;
    fixNavigation(); fixComplaintFilters(); fixEquipment(); fixSms(); fixTenders(); fixInsights();
    loadCurrentAdmin();
    const observer = new MutationObserver(() => { loadCurrentAdmin(); });
    const form = $('#admin-complaint-form'); if (form) observer.observe(form, { subtree: true, childList: true });
    setTimeout(() => { $$('#tender-body [data-edit-tender]').forEach(b => { const id = Number(b.dataset.editTender); if (!b.parentElement.querySelector(`[data-cams-tender-detail="${id}"]`)) { const d = document.createElement('button'); d.type='button'; d.className='button secondary small'; d.dataset.camsTenderDetail=id; d.textContent='Bids & history'; d.onclick=()=>showTender(id); b.parentElement.appendChild(d); } }); }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
