(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[char]));
  let designations = [];
  let loading = false;

  async function loadDesignations() {
    if (designations.length || loading) return;
    loading = true;
    try {
      const response = await fetch('/api/designations', { headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) return;
      designations = await response.json();
    } finally { loading = false; }
  }

  async function ensureControl() {
    const form = document.querySelector('#staff-form');
    if (!form) return;
    await loadDesignations();
    let control = form.querySelector('[name="designationId"]');
    if (!control) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label>Designation</label><select name="designationId" required></select>';
      const attendance = form.querySelector('[name="attendance"]')?.closest('.field');
      if (attendance?.parentElement?.classList.contains('form-grid')) attendance.parentElement.insertBefore(field, attendance);
      else form.insertBefore(field, form.querySelector('.error'));
      control = field.querySelector('select');
    }
    const currentStaff = window.__civilEditingStaff;
    const currentId = currentStaff?.designation_id == null ? '' : String(currentStaff.designation_id);
    const options = ['<option value="">Unassigned</option>'].concat(designations.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`));
    control.innerHTML = options.join('');
    control.value = currentId;
    control.required = false;
  }

  function watchModal() {
    const modal = document.querySelector('#staff-modal');
    if (!modal) return;
    const observer = new MutationObserver(() => {
      if (modal.classList.contains('show')) ensureControl();
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('DOMContentLoaded', () => {
    watchModal();
    const form = document.querySelector('#staff-form');
    if (form) form.addEventListener('submit', () => {
      const control = form.querySelector('[name="designationId"]');
      if (control && window.__civilEditingStaff) control.value = String(window.__civilEditingStaff.designation_id ?? '');
    }, true);
    const body = document.querySelector('#staff-body');
    if (body) body.addEventListener('click', async event => {
      const button = event.target.closest('[data-edit-staff]');
      if (!button) return;
      const id = Number(button.dataset.editStaff);
      try {
        const response = await fetch('/api/staff');
        const staff = await response.json();
        window.__civilEditingStaff = staff.find(item => item.id === id) || null;
      } catch (_) { window.__civilEditingStaff = null; }
      setTimeout(ensureControl, 0);
    });
  });
})();
