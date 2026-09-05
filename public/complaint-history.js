(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const date = v => v ? new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(v)) : '—';
  const api = async (url, options = {}) => { const r = await fetch(url, { headers:{'Content-Type':'application/json'}, ...options }); const p = await r.json().catch(()=>({})); if(!r.ok) throw new Error(p.error || 'Request failed'); return p; };

  function ensureHistoryModal() {
    if ($('#complaint-history-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="complaint-history-modal"><div class="modal"><button type="button" class="close" data-history-close>×</button><h2>Complaint history</h2><p class="sub" id="history-heading"></p><div id="history-body" class="insight-list"><p class="empty">Loading history…</p></div></div></div>`);
    $('[data-history-close]').addEventListener('click', () => $('#complaint-history-modal').classList.remove('show'));
    $('#complaint-history-modal').addEventListener('click', e => { if(e.target.id === 'complaint-history-modal') e.currentTarget.classList.remove('show'); });
  }

  async function showHistory(id, reference) {
    ensureHistoryModal();
    const modal = $('#complaint-history-modal');
    modal.classList.add('show');
    $('#history-heading').textContent = reference || `Complaint #${id}`;
    $('#history-body').innerHTML = '<p class="empty">Loading history…</p>';
    try {
      const rows = await api(`/api/complaints/${id}/history`);
      $('#history-body').innerHTML = rows.length ? rows.map(row => {
        const changes = [];
        if (row.old_status !== row.new_status && row.new_status) changes.push(`Status: ${row.old_status || '—'} → ${row.new_status}`);
        if ((row.old_assigned_to || '') !== (row.new_assigned_to || '')) changes.push(`Assignment: ${row.old_assigned_to || 'Unassigned'} → ${row.new_assigned_to || 'Unassigned'}`);
        if (row.old_priority !== row.new_priority && row.new_priority) changes.push(`Priority: ${row.old_priority || '—'} → ${row.new_priority}`);
        return `<div class="activity"><span class="activity-dot">•</span><p><b>${esc(String(row.event_type || 'updated').replaceAll('-', ' '))}</b>${changes.length ? `<br>${esc(changes.join(' · '))}` : ''}${row.note ? `<br>${esc(row.note)}` : ''}<br><time>${esc(date(row.changed_at))}${row.changed_by_name ? ` · ${esc(row.changed_by_name)}` : ''}</time></p></div>`;
      }).join('') : '<p class="empty">No history recorded yet.</p>';
    } catch (error) { $('#history-body').innerHTML = `<p class="error">${esc(error.message)}</p>`; }
  }

  function enhanceComplaintRows() {
    $$('#complaint-body [data-edit-complaint]').forEach(button => {
      if (button.parentElement.querySelector('[data-history-complaint]')) return;
      const history = document.createElement('button');
      history.type = 'button'; history.className = 'button secondary small'; history.dataset.historyComplaint = button.dataset.editComplaint; history.textContent = 'History';
      history.addEventListener('click', () => {
        const row = button.closest('tr');
        showHistory(Number(button.dataset.editComplaint), row?.querySelector('.case')?.textContent.trim());
      });
      button.parentElement.appendChild(history);
    });
  }

  function addEditNoteField() {
    const form = $('#complaint-edit-form');
    if (!form || $('[name="note"]', form)) return;
    const field = document.createElement('div'); field.className = 'field';
    field.innerHTML = '<label>Update note</label><textarea name="note" placeholder="Optional reason or field note for the audit trail"></textarea>';
    const error = $('.error', form); if (error) form.insertBefore(field, error); else form.appendChild(field);
  }

  async function refreshWorkload() {
    if (!document.body.dataset.page || document.body.dataset.page !== 'admin') return;
    const overview = $('#overview');
    if (!overview || $('#department-workload')) return;
    try {
      const [complaints, staff] = await Promise.all([api('/api/complaints'), api('/api/staff')]);
      const departments = {};
      complaints.filter(c => c.status !== 'Resolved' && c.assigned_to).forEach(c => {
        const person = staff.find(s => String(s.name).toLowerCase() === String(c.assigned_to).toLowerCase());
        const dept = person?.department || 'Unassigned';
        departments[dept] = (departments[dept] || 0) + 1;
      });
      const rows = Object.entries(departments).sort((a,b)=>b[1]-a[1]);
      const card = document.createElement('div'); card.className='card'; card.id='department-workload'; card.style.marginTop='18px';
      card.innerHTML = `<div class="card-head"><h2>Department workload</h2><span class="sub">Open assigned complaints</span></div><div id="department-workload-body">${rows.length ? rows.map(([d,n])=>`<div class="bar-row"><div class="bar-info"><span>${esc(d)}</span><b>${n}</b></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.max(8,n*20))}%"></div></div></div>`).join('') : '<p class="empty">No assigned open complaints.</p>'}</div>`;
      overview.appendChild(card);
    } catch (_) {}
  }

  async function syncSms() {
    try { await api('/api/staff/sms/sync', { method:'POST' }); } catch (_) {}
  }

  const observer = new MutationObserver(() => { enhanceComplaintRows(); addEditNoteField(); });
  observer.observe(document.body, { childList:true, subtree:true });
  window.addEventListener('load', () => { setTimeout(() => { enhanceComplaintRows(); addEditNoteField(); refreshWorkload(); syncSms(); }, 800); });
  setInterval(syncSms, 30000);
})();
