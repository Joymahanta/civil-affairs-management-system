(() => {
  if (window.__camsAdminComplaintCurrentUser) return;
  window.__camsAdminComplaintCurrentUser = true;

  const form = document.getElementById('admin-complaint-form');
  if (!form) return;

  const fields = {
    name: form.querySelector('[name="reporterName"]'),
    phone: form.querySelector('[name="reporterPhone"]'),
    email: form.querySelector('[name="reporterEmail"]')
  };
  const identityFields = Object.values(fields).filter(Boolean);

  identityFields.forEach(input => {
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
    input.title = 'Automatically taken from the administrator account signed in on this device';
    input.style.background = '#f4f7f5';
    input.style.cursor = 'not-allowed';
  });

  let loading = null;

  async function loadCurrentUser() {
    if (loading) return loading;
    loading = fetch('/api/admin/current-user', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not load the signed-in administrator.');
        if (fields.name) fields.name.value = payload.name || '';
        if (fields.phone) fields.phone.value = payload.phone || '';
        if (fields.email) fields.email.value = payload.email || '';
        form.dataset.currentAdminId = payload.user_id ?? '';
        form.dataset.currentAdminStaffId = payload.staff_id ?? '';
      })
      .finally(() => { loading = null; });
    return loading;
  }

  // app.js opens the modal from these buttons. Resolve identity after opening it.
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-admin-complaint]')) setTimeout(loadCurrentUser, 0);
  });

  // Also handle the modal being opened by another script.
  const observer = new MutationObserver(() => {
    const modal = document.getElementById('admin-complaint-modal');
    if (modal?.classList.contains('show')) loadCurrentUser().catch(() => {});
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  loadCurrentUser().catch(() => {});
})();
