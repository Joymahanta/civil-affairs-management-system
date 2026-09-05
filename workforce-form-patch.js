(() => {
  const DEPARTMENTS = ['Waterworks', 'Electrical', 'Sanitation', 'Inspection', 'Roads', 'Horticulture'];
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[char]));

  function makeDepartmentSelect(control) {
    if (!control) return null;
    if (control.tagName !== 'SELECT') {
      const select = document.createElement('select');
      select.name = control.name;
      select.required = control.required;
      control.replaceWith(select);
      control = select;
    }
    if (control.dataset.departmentReady === '1') return control;
    const current = control.value || '';
    control.innerHTML = '<option value="">Select department</option>' + DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if (current) control.value = current;
    control.dataset.departmentReady = '1';
    return control;
  }

  async function loadDesignations(select, selected) {
    if (!select || select.dataset.designationsLoading === '1') return;
    select.dataset.designationsLoading = '1';
    try {
      const response = await fetch('/api/designations', { cache: 'no-store' });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Could not load designations');
      select.innerHTML = '<option value="">Select designation</option>' + rows.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
      if (selected != null && selected !== '') select.value = String(selected);
      select.dataset.designationsReady = '1';
    } catch (error) { console.error('[workforce-form]', error); }
    finally { select.dataset.designationsLoading = '0'; }
  }

  function ensureEditField(form, name, label, html) {
    let control = form.querySelector(`[name="${name}"]`);
    if (control) return control;
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label>${html}`;
    const anchor = form.querySelector('[name="attendance"]')?.closest('.field');
    form.insertBefore(field, anchor || null);
    return field.querySelector(`[name="${name}"]`);
  }

  function repairAddForm() {
    const form = document.getElementById('add-staff-form');
    if (!form) return;
    makeDepartmentSelect(form.querySelector('[name="department"]'));
    const designation = form.querySelector('[name="designationId"]');
    if (designation && !designation.options.length && !designation.dataset.designationsLoading) loadDesignations(designation);
  }

  function repairEditForm() {
    const form = document.getElementById('staff-form');
    if (!form) return;
    ensureEditField(form, 'designationId', 'Designation', '<select name="designationId" required></select>');
    ensureEditField(form, 'department', 'Department', '<select name="department" required></select>');
    ensureEditField(form, 'phone', 'Phone', '<input name="phone" inputmode="numeric" required>');
    makeDepartmentSelect(form.querySelector('[name="department"]'));
    const designation = form.querySelector('[name="designationId"]');
    if (designation && !designation.options.length && !designation.dataset.designationsLoading) loadDesignations(designation);
  }

  async function populateEdit(id) {
    try {
      const response = await fetch('/api/staff', { cache: 'no-store' });
      const rows = await response.json();
      const item = rows.find(row => Number(row.id) === Number(id));
      if (!item) return;
      repairEditForm();
      const form = document.getElementById('staff-form');
      makeDepartmentSelect(form.querySelector('[name="department"]')).value = item.department || '';
      form.querySelector('[name="phone"]').value = item.phone || '';
      await loadDesignations(form.querySelector('[name="designationId"]'), item.designation_id);
      const title = document.getElementById('staff-name');
      if (title) title.textContent = `${item.name} · ${item.designation || item.department || ''}`;
    } catch (error) { console.error('[workforce-form]', error); }
  }

  function repair() { repairAddForm(); repairEditForm(); }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-staff]');
    if (button) setTimeout(() => populateEdit(button.dataset.editStaff), 0);
  }, true);

  repair();
  const observer = new MutationObserver(() => repair());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
