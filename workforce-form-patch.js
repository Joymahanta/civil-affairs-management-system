(() => {
  const departments = ['Waterworks', 'Electrical', 'Sanitation', 'Inspection', 'Roads', 'Horticulture'];
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c]));

  function fillSelect(select, values, selected = '') {
    if (!select) return;
    select.innerHTML = '<option value="">Select department</option>' + values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    select.value = selected || '';
  }

  async function loadDesignations(select, selected = '') {
    if (!select) return;
    try {
      const response = await fetch('/api/designations', { headers: { 'Content-Type': 'application/json' } });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Could not load designations.');
      select.innerHTML = '<option value="">Select designation</option>' + rows.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
      select.value = selected ? String(selected) : '';
    } catch (error) {
      console.error('[workforce] designation load failed:', error);
      select.innerHTML = '<option value="">Unable to load designations</option>';
    }
  }

  function replaceAddDepartment() {
    const form = document.getElementById('add-staff-form');
    const old = form?.querySelector('[name="department"]');
    if (!old || old.tagName === 'SELECT') return;
    const select = document.createElement('select');
    select.name = 'department';
    select.required = true;
    select.setAttribute('aria-label', 'Staff department');
    fillSelect(select, departments);
    old.replaceWith(select);
  }

  function ensureEditField(form, name, label, type = 'input') {
    let control = form.querySelector(`[name="${name}"]`);
    if (control) return control;
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label>${type === 'select' ? `<select name="${name}" required></select>` : `<input name="${name}" ${name === 'phone' ? 'inputmode="numeric"' : ''}>`}`;
    const anchor = form.querySelector('[name="attendance"]')?.closest('.field');
    form.insertBefore(field, anchor || null);
    return field.querySelector(`[name="${name}"]`);
  }

  function prepareEditForm() {
    const form = document.getElementById('staff-form');
    if (!form) return null;
    const designation = ensureEditField(form, 'designationId', 'Designation', 'select');
    const department = ensureEditField(form, 'department', 'Department', 'select');
    const phone = ensureEditField(form, 'phone', 'Phone');
    fillSelect(department, departments);
    loadDesignations(designation);
    return { form, designation, department, phone };
  }

  async function populateEditStaff(id) {
    const controls = prepareEditForm();
    if (!controls) return;
    try {
      const response = await fetch('/api/staff', { headers: { 'Content-Type': 'application/json' } });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Could not load staff record.');
      const item = rows.find(row => Number(row.id) === Number(id));
      if (!item) return;
      fillSelect(controls.department, departments, item.department);
      await loadDesignations(controls.designation, item.designation_id);
      controls.phone.value = item.phone || '';
      const title = document.getElementById('staff-name');
      if (title) title.textContent = `${item.name} · ${item.designation || item.department || 'No department'}`;
    } catch (error) {
      console.error('[workforce] staff editor load failed:', error);
    }
  }

  function bind() {
    replaceAddDepartment();
    prepareEditForm();
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-edit-staff]');
      if (!button) return;
      setTimeout(() => populateEditStaff(Number(button.dataset.editStaff)), 0);
    });
    document.getElementById('open-add-staff')?.addEventListener('click', () => setTimeout(replaceAddDepartment, 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
