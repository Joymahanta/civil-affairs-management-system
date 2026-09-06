(() => {
  if (window.__civilDepartmentDesignationManagerLoaded) return;
  window.__civilDepartmentDesignationManagerLoaded = true;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  };

  const get = id => document.getElementById(id);
  let departments = [];
  let designations = [];

  function closeModal(id) {
    get(id)?.classList.remove('show');
  }

  function openModal(id) {
    get(id)?.classList.add('show');
  }

  function makeModal(id, title, subtitle, body) {
    const old = get(id);
    if (old) old.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = id;
    backdrop.innerHTML = `
      <div class="modal" style="max-width:820px">
        <button type="button" class="close" data-close>×</button>
        <h2>${esc(title)}</h2>
        <p class="sub">${esc(subtitle)}</p>
        ${body}
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-close]')) {
        closeModal(id);
      }
    });

    return backdrop;
  }

  function error(form, message = '') {
    const element = form?.querySelector('.error');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  async function loadAll() {
    [departments, designations] = await Promise.all([
      api('/api/departments'),
      api('/api/designations')
    ]);
    departments = Array.isArray(departments) ? departments : [];
    designations = Array.isArray(designations) ? designations : [];
  }

  function departmentOptions(selected = '') {
    return '<option value="">Select department</option>' +
      departments.map(d =>
        `<option value="${esc(d.id)}" ${String(d.id) === String(selected) ? 'selected' : ''}>${esc(d.name)}</option>`
      ).join('');
  }

  function notifyWorkforce() {
    document.dispatchEvent(new CustomEvent('workforce-settings-changed'));
  }

  function resetDepartmentForm() {
    const form = get('department-editor');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    form.querySelector('[type="submit"]').textContent = 'Add department';
    get('department-cancel-edit')?.classList.add('hidden');
    error(form);
  }

  function resetDesignationForm() {
    const form = get('designation-editor');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    form.querySelector('[type="submit"]').textContent = 'Add designation';
    get('designation-cancel-edit')?.classList.add('hidden');
    form.elements.departmentId.innerHTML = departmentOptions();
    error(form);
  }

  function renderDepartments() {
    const list = get('department-list');
    if (!list) return;

    list.innerHTML = departments.map(d => `
      <div class="activity" style="display:flex;align-items:center;gap:10px">
        <p style="flex:1">
          <b>${esc(d.name)}</b><br>
          <span class="sub">${esc(d.description || '')} · ${Number(d.designation_count || 0)} designation(s)</span>
        </p>
        <button type="button" class="button secondary" data-edit-department="${d.id}">Edit</button>
        <button type="button" class="button secondary" data-delete-department="${d.id}">Delete</button>
      </div>
    `).join('') || '<p class="empty">No departments.</p>';
  }

  function renderDesignations() {
    const list = get('designation-list');
    if (!list) return;

    list.innerHTML = designations.map(d => `
      <div class="activity" style="display:flex;align-items:center;gap:10px">
        <p style="flex:1">
          <b>${esc(d.name)}</b><br>
          <span class="sub">${esc(d.department || 'Unassigned')} · ${Number(d.staff_count || 0)} staff</span>
        </p>
        <button type="button" class="button secondary" data-edit-designation="${d.id}">Edit</button>
        <button type="button" class="button secondary" data-delete-designation="${d.id}">Delete</button>
      </div>
    `).join('') || '<p class="empty">No designations.</p>';
  }

  async function refresh() {
    await loadAll();

    const designationForm = get('designation-editor');
    if (designationForm) {
      const currentDepartment = designationForm.elements.departmentId.value;
      designationForm.elements.departmentId.innerHTML = departmentOptions(currentDepartment);
    }

    renderDepartments();
    renderDesignations();
  }

  function createManagerModals() {
    makeModal(
      'department-manager-modal',
      'Manage departments',
      'Add, update or delete workforce departments.',
      `
        <form id="department-editor">
          <input type="hidden" name="id">
          <div class="field">
            <label>Department name</label>
            <input name="name" required placeholder="e.g. Electrical">
          </div>
          <div class="field">
            <label>Description</label>
            <textarea name="description"></textarea>
          </div>
          <p class="error hidden"></p>
          <div style="display:flex;gap:8px">
            <button class="button" type="submit">Add department</button>
            <button class="button secondary hidden" id="department-cancel-edit" type="button">Cancel edit</button>
          </div>
        </form>
        <div class="card" style="margin-top:18px">
          <b>Departments</b>
          <div id="department-list" style="margin-top:10px"></div>
        </div>
      `
    );

    makeModal(
      'designation-manager-modal',
      'Manage designations',
      'Add, update or delete designations under a department.',
      `
        <form id="designation-editor">
          <input type="hidden" name="id">
          <div class="field">
            <label>Department</label>
            <select name="departmentId" required></select>
          </div>
          <div class="field">
            <label>Designation name</label>
            <input name="name" required placeholder="e.g. Electrical Engineer">
          </div>
          <div class="field">
            <label>Description</label>
            <textarea name="description"></textarea>
          </div>
          <p class="error hidden"></p>
          <div style="display:flex;gap:8px">
            <button class="button" type="submit">Add designation</button>
            <button class="button secondary hidden" id="designation-cancel-edit" type="button">Cancel edit</button>
          </div>
        </form>
        <div class="card" style="margin-top:18px">
          <b>Designations</b>
          <div id="designation-list" style="margin-top:10px"></div>
        </div>
      `
    );
  }

  function bindForms() {
    const departmentForm = get('department-editor');
    const designationForm = get('designation-editor');

    departmentForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value.trim();
      const body = {
        name: form.elements.name.value.trim(),
        description: form.elements.description.value.trim()
      };

      try {
        await api(id ? `/api/departments/${id}` : '/api/departments', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        });
        resetDepartmentForm();
        await refresh();
        notifyWorkforce();
      } catch (e) {
        error(form, e.message);
      }
    });

    designationForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value.trim();
      const body = {
        name: form.elements.name.value.trim(),
        description: form.elements.description.value.trim(),
        departmentId: form.elements.departmentId.value
      };

      try {
        await api(id ? `/api/designations/${id}` : '/api/designations', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        });
        resetDesignationForm();
        await refresh();
        notifyWorkforce();
      } catch (e) {
        error(form, e.message);
      }
    });

    get('department-cancel-edit')?.addEventListener('click', resetDepartmentForm);
    get('designation-cancel-edit')?.addEventListener('click', resetDesignationForm);

    document.addEventListener('click', async event => {
      const editDepartment = event.target.closest('[data-edit-department]');
      if (editDepartment) {
        const item = departments.find(d => Number(d.id) === Number(editDepartment.dataset.editDepartment));
        if (!item) return;
        const form = get('department-editor');
        form.elements.id.value = item.id;
        form.elements.name.value = item.name;
        form.elements.description.value = item.description || '';
        form.querySelector('[type="submit"]').textContent = 'Update department';
        get('department-cancel-edit')?.classList.remove('hidden');
        return;
      }

      const deleteDepartment = event.target.closest('[data-delete-department]');
      if (deleteDepartment) {
        const item = departments.find(d => Number(d.id) === Number(deleteDepartment.dataset.deleteDepartment));
        if (!item || !confirm(`Delete ${item.name}?`)) return;

        try {
          await api(`/api/departments/${item.id}`, { method: 'DELETE' });
          resetDepartmentForm();
          await refresh();
          notifyWorkforce();
        } catch (e) {
          alert(e.message);
        }
        return;
      }

      const editDesignation = event.target.closest('[data-edit-designation]');
      if (editDesignation) {
        const item = designations.find(d => Number(d.id) === Number(editDesignation.dataset.editDesignation));
        if (!item) return;
        const form = get('designation-editor');
        form.elements.id.value = item.id;
        form.elements.departmentId.innerHTML = departmentOptions(item.department_id);
        form.elements.name.value = item.name;
        form.elements.description.value = item.description || '';
        form.querySelector('[type="submit"]').textContent = 'Update designation';
        get('designation-cancel-edit')?.classList.remove('hidden');
        return;
      }

      const deleteDesignation = event.target.closest('[data-delete-designation]');
      if (deleteDesignation) {
        const item = designations.find(d => Number(d.id) === Number(deleteDesignation.dataset.deleteDesignation));
        if (!item || !confirm(`Delete ${item.name}?`)) return;

        try {
          await api(`/api/designations/${item.id}`, { method: 'DELETE' });
          resetDesignationForm();
          await refresh();
          notifyWorkforce();
        } catch (e) {
          alert(e.message);
        }
      }
    });
  }

  function bindButtons() {
    const departmentButton = get('make-department');
    const designationButton = get('make-designation');

    if (departmentButton && departmentButton.dataset.managerBound !== '1') {
      departmentButton.textContent = 'Manage departments';
      departmentButton.dataset.managerBound = '1';
      departmentButton.addEventListener('click', async event => {
        event.preventDefault();
        try {
          await refresh();
          resetDepartmentForm();
          openModal('department-manager-modal');
        } catch (e) {
          alert(e.message);
        }
      });
    }

    if (designationButton && designationButton.dataset.managerBound !== '1') {
      designationButton.textContent = 'Manage designations';
      designationButton.dataset.managerBound = '1';
      designationButton.addEventListener('click', async event => {
        event.preventDefault();
        try {
          await refresh();
          resetDesignationForm();
          openModal('designation-manager-modal');
        } catch (e) {
          alert(e.message);
        }
      });
    }
  }

  function init() {
    createManagerModals();
    bindForms();
    bindButtons();
  }

  if (document.body?.dataset.page === 'admin') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
})();
