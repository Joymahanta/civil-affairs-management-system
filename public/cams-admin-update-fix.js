(() => {
  if (window.__camsAdminUpdateFix) return;
  window.__camsAdminUpdateFix = true;
  const $ = (s, r = document) => r.querySelector(s);
  const api = async (url, options = {}) => { const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }); const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p.error || 'Request failed.'); return p; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function openUpdate(id) {
    return api('/api/complaints').then(async rows => {
      const item = rows.find(x => Number(x.id) === Number(id)); if (!item) throw new Error('Complaint not found.');
      const form = $('#complaint-edit-form'); if (!form) return;
      form.elements.id.value = item.id; form.elements.status.value = item.status || 'New'; form.elements.priority.value = item.priority || 'Medium';
      $('#edit-reference').textContent = `${item.reference} · ${item.location} · ${item.type}${item.category ? ` · ${item.category}` : ''}`;
      const old = form.elements.assignedTo;
      const select = document.createElement('select'); select.name = 'assignedTo'; select.innerHTML = '<option value="">Unassigned</option>';
      try { const staff = await api('/api/staff'); staff.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = `${s.name} · ${s.designation || s.department || ''}`; if (s.name === item.assigned_to) o.selected = true; select.appendChild(o); }); } catch (_) {}
      old?.replaceWith(select);
      $('#complaint-edit-modal')?.classList.add('show');
    });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-complaint]');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    openUpdate(Number(button.dataset.editComplaint)).catch(e => alert(e.message));
  }, true);
})();
