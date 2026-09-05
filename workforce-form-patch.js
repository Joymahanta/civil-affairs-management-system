(() => {
  const departments = ['Waterworks', 'Electrical', 'Sanitation', 'Inspection', 'Roads', 'Horticulture'];

  function fillSelect(select, values, selected = '') {
    if (!select) return;
    select.innerHTML = '<option value="">Select department</option>' + values.map(value => `<option value="${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')}">${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`).join('');
    select.value = selected || '';
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

  async function loadDesignations(select, selected = '') {
    try {
      const response = await fetch('/api/designations', { headers: { 'Content-Type': 'application/json' } });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Could not load designations.');
      select.innerHTML = '<option value="">Select designation</option>' + rows.map(item => `<option value="${item.id}">${String(item.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')}</option>`).join('');
      select.value = selected ? String(selected) : '';
    } catch (error) {
      select.innerHTML = '<option value="">Unable to load designations</option>';
      console.error('[workforce] designation load failed:', error);
    }
  }

  function prepareEditForm() {
    const form = document.getElementById('staff-form');
    if (!form) return;
    const attendance = form.querySelector('[name="attendance"]');
    if (!attendance) return;

    let designation = form.querySelector('[name="designationId"]');
    if (!designation) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label>Designation</label><select name="designationId" required></select>';
      form.insertBefore(field, attendance.closest('.field'));
      designation = field.querySelector('select');
    }

    let department = form.querySelector('[name="department"]');
    if (!department) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label>Department</label><select name="department" required></select>';
      form.insertBefore(field, attendance.closest('.field'));
      department = field.querySelector('select');
      fillSelect(department, departments);
    } else if (department.tagName !== 'SELECT') {
      const select = document.createElement('select');
      select.name = 'department';
      select.required = true;
      fillSelect(select, departments, department.value);
      department.replaceWith(select);
      department = select;
    }
    loadDesignations(designation);
  }

  async function populateEditStaff(id) {
    prepareEditForm();
    const form = document.getElementById('staff-form');
    if (!form) return;
    try {
      const response = await fetch('/api/staff', { headers: { 'Content-Type': 'application/json' } });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Could not load staff record.');
      const item = rows.find(row => Number(row.id) === Number(id));
      if (!item) return;
      const designation = form.querySelector('[name="designationId"]');
      const department = form.querySelector('[name="department"]');
      fillSelect(department, departments, item.department);
      await loadDesignations(designation, item.designation_id);
      const title = document.getElementById('staff-name');
      if (title) title.textContent = `${item.name} · ${item.department || 'No department'}`;
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
      const id = Number(button.dataset.editStaff);
      setTimeout(() => populateEditStaff(id), 0);
    });
    document.getElementById('open-add-staff')?.addEventListener('click', () => {
      setTimeout(() => replaceAddDepartment(), 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
