(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  let departments = [];
  let designations = [];

  async function loadData() {
    const [departmentResponse, designationResponse] = await Promise.all([
      fetch('/api/departments', { cache: 'no-store' }),
      fetch('/api/designations', { cache: 'no-store' })
    ]);
    const departmentData = await departmentResponse.json().catch(() => []);
    const designationData = await designationResponse.json().catch(() => []);
    if (!departmentResponse.ok) throw new Error(departmentData.error || 'Could not load departments.');
    if (!designationResponse.ok) throw new Error(designationData.error || 'Could not load designations.');
    departments = Array.isArray(departmentData) ? departmentData : [];
    designations = Array.isArray(designationData) ? designationData : [];
  }

  function setOptions(select, rows, placeholder, selected = '') {
    if (!select) return;
    select.innerHTML = `<option value="">${esc(placeholder)}</option>` + rows.map(row => `<option value="${esc(row.value)}">${esc(row.label)}</option>`).join('');
    if (selected !== '' && selected != null) select.value = String(selected);
  }

  function selectField(name, id, label) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label><select name="${name}" id="${id}"></select>`;
    return { field, select: field.querySelector('select') };
  }

  function prepareAddForm() {
    const form = document.querySelector('#add-staff-form');
    const input = form?.querySelector('[name="department"]');
    if (!form || !input || input.tagName === 'SELECT') return;
    const field = input.closest('.field');
    const replacement = selectField('department', 'staff-department', 'Department');
    setOptions(replacement.select, departments.map(d => ({ value: d.name, label: d.name })), 'Select department', input.value);
    field.replaceWith(replacement.field);
  }

  function prepareEditForm() {
    const form = document.querySelector('#staff-form');
    if (!form || form.dataset.designationEditorReady) return;
    form.dataset.designationEditorReady = 'true';
    const designation = selectField('designationId', 'edit-staff-designation', 'Designation');
    const department = selectField('department', 'edit-staff-department', 'Department');
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.append(designation.field, department.field);
    const attendanceField = form.querySelector('[name="attendance"]')?.closest('.field');
    form.insertBefore(grid, attendanceField || form.querySelector('.error'));

    document.addEventListener('click', event => {
      const button = event.target.closest('[data-edit-staff]');
      if (!button) return;
      setTimeout(async () => {
        try {
          await loadData();
          const response = await fetch('/api/staff', { cache: 'no-store' });
          const staffRows = await response.json();
          if (!response.ok) throw new Error(staffRows.error || 'Could not load staff.');
          const item = (Array.isArray(staffRows) ? staffRows : []).find(row => Number(row.id) === Number(button.dataset.editStaff));
          if (!item) return;
          setOptions(department.select, departments.map(d => ({ value: d.name, label: d.name })), 'Select department', item.department || '');
          setOptions(designation.select, designations.map(d => ({ value: d.id, label: d.name })), 'Select designation', item.designation_id || '');
          designation.select.disabled = false;
          const title = document.getElementById('staff-name');
          if (title) title.textContent = `${item.name} · ${item.department || ''}`;
        } catch (error) {
          console.error('[staff-designation-ui]', error);
        }
      }, 75);
    }, true);
  }

  async function init() {
    try { await loadData(); } catch (error) { console.error('[staff-designation-ui] initial load', error); }
    prepareAddForm();
    prepareEditForm();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
