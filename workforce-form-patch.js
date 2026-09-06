(() => {
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[char]));
  let departments = [];
  let designations = [];
  let loadingDepartments = null;
  let loadingDesignations = null;

  async function getJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not load the workforce settings.');
    return payload;
  }

  async function loadDepartments(force = false) {
    if (loadingDepartments && !force) return loadingDepartments;
    loadingDepartments = getJson('/api/departments').then(rows => {
      departments = Array.isArray(rows) ? rows : [];
      return departments;
    }).finally(() => { loadingDepartments = null; });
    return loadingDepartments;
  }

  async function loadDesignations(force = false) {
    if (loadingDesignations && !force) return loadingDesignations;
    loadingDesignations = getJson('/api/designations').then(rows => {
      designations = Array.isArray(rows) ? rows : [];
      return designations;
    }).finally(() => { loadingDesignations = null; });
    return loadingDesignations;
  }

  function setOptions(select, rows, placeholder, valueKey = 'id', labelKey = 'name', selected = '') {
    if (!select) return;
    select.innerHTML = `<option value="">${esc(placeholder)}</option>` + rows.map(row => `<option value="${esc(row[valueKey])}">${esc(row[labelKey])}</option>`).join('');
    if (selected !== '' && selected != null) select.value = String(selected);
  }

  function makeDepartmentSelect(control) {
    if (!control) return null;
    if (control.tagName !== 'SELECT') {
      const select = document.createElement('select');
      select.name = control.name;
      select.id = control.id;
      select.required = control.required;
      control.replaceWith(select);
      control = select;
    }
    return control;
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

  async function populateDepartmentSelect(select, selected = '') {
    if (!select) return;
    makeDepartmentSelect(select);
    await loadDepartments();
    setOptions(select, departments, 'Select department', 'name', 'name', selected);
    select.dataset.departmentReady = '1';
  }

  async function populateDesignationSelect(select, departmentName = '', selected = '') {
    if (!select) return;
    await loadDesignations();
    const department = String(departmentName || '').trim();
    const rows = department ? designations.filter(item => String(item.department || '').trim() === department) : [];
    setOptions(select, rows, department ? 'Select designation' : 'Select department first', 'id', 'name', selected);
    select.disabled = !department;
    select.dataset.designationsReady = '1';
  }

  function bindStaffDropdowns(form) {
    if (!form || form.dataset.departmentDesignationBound === '1') return;
    const department = makeDepartmentSelect(form.querySelector('[name="department"]'));
    const designation = form.querySelector('[name="designationId"]');
    if (!department || !designation) return;
    form.dataset.departmentDesignationBound = '1';
    department.addEventListener('change', () => {
      populateDesignationSelect(designation, department.value).catch(error => console.error('[workforce-form]', error));
    });
    populateDepartmentSelect(department).then(() => {
      if (department.value) return populateDesignationSelect(designation, department.value, designation.value);
      designation.disabled = true;
      designation.innerHTML = '<option value="">Select department first</option>';
    }).catch(error => console.error('[workforce-form]', error));
  }

  async function repairAddForm() {
    const form = document.getElementById('add-staff-form');
    if (!form) return;
    bindStaffDropdowns(form);
    await loadDepartments();
    await loadDesignations();
    await populateDepartmentSelect(form.querySelector('[name="department"]'), form.querySelector('[name="department"]')?.value || '');
    const designation = form.querySelector('[name="designationId"]');
    await populateDesignationSelect(designation, form.querySelector('[name="department"]')?.value || '', designation?.value || '');
  }

  function repairEditForm() {
    const form = document.getElementById('staff-form');
    if (!form) return;
    ensureEditField(form, 'designationId', 'Designation', '<select name="designationId" required></select>');
    ensureEditField(form, 'department', 'Department', '<select name="department" required></select>');
    ensureEditField(form, 'phone', 'Phone', '<input name="phone" inputmode="numeric" required>');
    bindStaffDropdowns(form);
  }

  async function populateEdit(id) {
    try {
      const rows = await getJson('/api/staff');
      const item = rows.find(row => Number(row.id) === Number(id));
      if (!item) return;
      const form = document.getElementById('staff-form');
      repairEditForm();
      const department = form.querySelector('[name="department"]');
      const designation = form.querySelector('[name="designationId"]');
      await populateDepartmentSelect(department, item.department || '');
      await populateDesignationSelect(designation, item.department || '', item.designation_id || '');
      form.querySelector('[name="phone"]').value = item.phone || '';
      const title = document.getElementById('staff-name');
      if (title) title.textContent = `${item.name} · ${item.designation || item.department || ''}`;
    } catch (error) { console.error('[workforce-form]', error); }
  }

  function modalShell(id, title, subtitle, bodyHtml) {
    let backdrop = document.getElementById(id);
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = id;
    backdrop.innerHTML = `<form class="modal" id="${id}-form"><button type="button" class="close" data-local-close>×</button><h2>${esc(title)}</h2><p class="sub">${esc(subtitle)}</p>${bodyHtml}</form>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', event => { if (event.target === backdrop || event.target.closest('[data-local-close]')) backdrop.classList.remove('show'); });
    return backdrop;
  }

  function openLocalModal(id) { document.getElementById(id)?.classList.add('show'); }

  async function openDepartmentModal() {
    const body = `<div class="field"><label>Department name</label><input name="name" required placeholder="e.g. Electrical"></div><div class="field"><label>Description</label><textarea name="description" placeholder="What this department handles"></textarea></div><p class="error hidden"></p><button class="button" type="submit" style="width:100%">Create department</button><div id="department-list" class="insight-list" style="margin-top:16px"></div>`;
    const modal = modalShell('department-maker-modal', 'Make department', 'Create the departments that will appear in staff and designation dropdowns.', body);
    const form = modal.querySelector('form');
    if (form.dataset.bound !== '1') {
      form.dataset.bound = '1';
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const error = form.querySelector('.error'); error.classList.add('hidden'); error.textContent = '';
        try {
          const values = Object.fromEntries(new FormData(form));
          await getJson('/api/departments', { method: 'POST', body: JSON.stringify(values) });
          form.reset();
          await loadDepartments(true);
          await loadDesignations(true);
          await refreshStaffDropdowns();
          renderDepartmentList();
          toastMessage('Department created.');
        } catch (errorValue) { error.textContent = errorValue.message; error.classList.remove('hidden'); }
      });
    }
    await loadDepartments(true);
    renderDepartmentList();
    openLocalModal('department-maker-modal');
  }

  function renderDepartmentList() {
    const list = document.getElementById('department-list');
    if (!list) return;
    list.innerHTML = departments.map(item => `<div class="activity"><span class="activity-dot">▦</span><p><b>${esc(item.name)}</b><br><span class="sub">${Number(item.designation_count || 0)} designation${Number(item.designation_count || 0) === 1 ? '' : 's'}</span></p></div>`).join('') || '<p class="empty">No departments yet.</p>';
  }

  async function openDesignationModal() {
    const body = `<div class="field"><label>Department</label><select name="departmentId" required></select></div><div class="field"><label>Designation name</label><input name="name" required placeholder="e.g. Electrical Engineer"></div><div class="field"><label>Description</label><textarea name="description" placeholder="Responsibilities or role description"></textarea></div><p class="error hidden"></p><button class="button" type="submit" style="width:100%">Create designation</button><div id="designation-list" class="insight-list" style="margin-top:16px"></div>`;
    const modal = modalShell('designation-maker-modal', 'Make designation', 'Create a designation under a specific department. Example: Electrical → Electrical Engineer, Electrical Apprentice.', body);
    const form = modal.querySelector('form');
    const department = form.querySelector('[name="departmentId"]');
    await loadDepartments(true);
    setOptions(department, departments, 'Select department', 'id', 'name');
    if (form.dataset.bound !== '1') {
      form.dataset.bound = '1';
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const error = form.querySelector('.error'); error.classList.add('hidden'); error.textContent = '';
        try {
          const values = Object.fromEntries(new FormData(form));
          await getJson('/api/designations', { method: 'POST', body: JSON.stringify(values) });
          form.reset();
          await loadDesignations(true);
          await loadDepartments(true);
          await refreshStaffDropdowns();
          renderDesignationList();
          toastMessage('Designation created.');
        } catch (errorValue) { error.textContent = errorValue.message; error.classList.remove('hidden'); }
      });
    }
    await loadDesignations(true);
    renderDesignationList();
    openLocalModal('designation-maker-modal');
  }

  function renderDesignationList() {
    const list = document.getElementById('designation-list');
    if (!list) return;
    const groups = departments.map(department => ({ department, rows: designations.filter(item => Number(item.department_id) === Number(department.id)) })).filter(group => group.rows.length);
    list.innerHTML = groups.map(group => `<div class="card" style="padding:12px;margin-bottom:10px"><b>${esc(group.department.name)}</b>${group.rows.map(item => `<div class="activity" style="padding:8px 0"><span class="activity-dot">♧</span><p><b>${esc(item.name)}</b><br><span class="sub">${Number(item.staff_count || 0)} staff</span></p></div>`).join('')}</div>`).join('') || '<p class="empty">No designations yet.</p>';
  }

  async function refreshStaffDropdowns() {
    await Promise.all([loadDepartments(true), loadDesignations(true)]);
    const add = document.getElementById('add-staff-form');
    if (add) {
      const department = add.querySelector('[name="department"]');
      const designation = add.querySelector('[name="designationId"]');
      const selectedDepartment = department?.value || '';
      const selectedDesignation = designation?.value || '';
      await populateDepartmentSelect(department, selectedDepartment);
      await populateDesignationSelect(designation, selectedDepartment, selectedDesignation);
    }
  }

  function toastMessage(message) {
    if (typeof window.toast === 'function') window.toast(message);
    else console.info(message);
  }

  function bindMakerButtons() {
    const departmentButton = document.getElementById('make-department');
    const designationButton = document.getElementById('make-designation');
    if (departmentButton && departmentButton.dataset.makerBound !== '1') {
      departmentButton.textContent = 'Make department';
      departmentButton.dataset.makerBound = '1';
      departmentButton.addEventListener('click', () => openDepartmentModal().catch(error => toastMessage(error.message)));
    }
    if (designationButton && designationButton.dataset.makerBound !== '1') {
      designationButton.textContent = 'Make designation';
      designationButton.dataset.makerBound = '1';
      designationButton.addEventListener('click', () => openDesignationModal().catch(error => toastMessage(error.message)));
    }
  }

  function repair() {
    bindMakerButtons();
    repairEditForm();
    const add = document.getElementById('add-staff-form');
    if (add && add.dataset.departmentDesignationReady !== '1') {
      add.dataset.departmentDesignationReady = '1';
      repairAddForm().catch(error => console.error('[workforce-form]', error));
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-staff]');
    if (button) setTimeout(() => populateEdit(button.dataset.editStaff), 0);
  }, true);

  repair();
  const observer = new MutationObserver(() => repair());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
