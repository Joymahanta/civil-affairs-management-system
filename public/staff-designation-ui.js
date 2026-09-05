(() => {
  const departments = ['Waterworks', 'Electrical', 'Sanitation', 'Inspection', 'Roads', 'Horticulture'];
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[char]));
  let designations = [];
  let staff = [];

  async function loadData() {
    try {
      const [designationResponse, staffResponse] = await Promise.all([
        fetch('/api/designations'),
        fetch('/api/staff')
      ]);
      if (designationResponse.ok) designations = await designationResponse.json();
      if (staffResponse.ok) staff = await staffResponse.json();
    } catch (_) {}
  }

  function selectField(name, id, label, options, value = '') {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label><select name="${name}" id="${id}">${options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select>`;
    const select = field.querySelector('select');
    select.value = value == null ? '' : String(value);
    return { field, select };
  }

  function prepareAddForm() {
    const form = document.querySelector('#add-staff-form');
    const input = form?.querySelector('[name="department"]');
    if (!form || !input || input.tagName === 'SELECT') return;
    const field = input.closest('.field');
    const replacement = selectField('department', 'staff-department', 'Department', departments.map(d => ({ value: d, label: d })), input.value);
    field.replaceWith(replacement.field);
  }

  function prepareEditForm() {
    const form = document.querySelector('#staff-form');
    if (!form || form.dataset.designationEditorReady) return;
    form.dataset.designationEditorReady = 'true';

    const designation = selectField('designationId', 'edit-staff-designation', 'Designation', [
      { value: '', label: 'Unassigned' },
      ...designations.map(d => ({ value: d.id, label: d.name }))
    ]);
    const department = selectField('department', 'edit-staff-department', 'Department', departments.map(d => ({ value: d, label: d })));
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.append(designation.field, department.field);
    const attendanceField = form.querySelector('[name="attendance"]')?.closest('.field');
    form.insertBefore(grid, attendanceField || form.querySelector('.error'));

    document.addEventListener('click', event => {
      const button = event.target.closest('[data-edit-staff]');
      if (!button) return;
      const item = staff.find(row => Number(row.id) === Number(button.dataset.editStaff));
      if (!item) return;
      designation.select.value = item.designation_id ? String(item.designation_id) : '';
      if (!designation.select.value && item.designation) {
        const match = designations.find(d => String(d.name).toLowerCase() === String(item.designation).toLowerCase());
        if (match) designation.select.value = String(match.id);
      }
      department.select.value = item.department || '';
    }, true);

    form.addEventListener('submit', event => {
      const item = window.__civilEditingStaff;
      if (!item) return;
      designation.select.value = item.designation_id ? String(item.designation_id) : designation.select.value;
      department.select.value = item.department || department.select.value;
    }, true);
  }

  async function init() {
    await loadData();
    prepareAddForm();
    prepareEditForm();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
