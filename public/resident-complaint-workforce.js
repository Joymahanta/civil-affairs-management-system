(() => {
  if (window.__camsResidentComplaintWorkforce) return;
  window.__camsResidentComplaintWorkforce = true;

  const form = document.getElementById('report-form');
  if (!form) return;

  const fields = {
    name: document.getElementById('report-name'),
    phone: document.getElementById('report-phone'),
    email: document.getElementById('report-email')
  };

  const identityFields = Object.values(fields).filter(Boolean);
  identityFields.forEach(input => {
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
    input.title = 'Taken from your signed-in Workforce record';
    input.classList.add('workforce-identity-field');
  });

  let loaded = false;
  let loading = null;

  async function loadIdentity() {
    if (loading) return loading;
    loading = fetch('/api/resident/session', { credentials: 'same-origin' })
      .then(response => response.json())
      .then(payload => {
        if (!payload.authenticated || !payload.user) {
          loaded = false;
          return false;
        }
        const user = payload.user;
        if (fields.name) fields.name.value = user.name || '';
        if (fields.phone) fields.phone.value = user.phone || '';
        if (fields.email) fields.email.value = user.email || '';
        loaded = true;
        return true;
      })
      .catch(() => false)
      .finally(() => { loading = null; });
    return loading;
  }

  // The complaint buttons open the modal from app.js. Refresh the Workforce identity
  // whenever the modal opens so stale profile data is never displayed.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-report-type]');
    if (button) setTimeout(loadIdentity, 0);
  });

  const observer = new MutationObserver(() => {
    const modal = document.getElementById('report-modal');
    if (modal?.classList.contains('show') && !loaded) loadIdentity();
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // readonly controls remain part of FormData. If another script attempts to alter
  // them, reload the authoritative Workforce identity before submission.
  form.addEventListener('submit', async event => {
    if (!loaded) {
      event.preventDefault();
      const ok = await loadIdentity();
      if (!ok) {
        alert('Please sign in to the resident portal before lodging a complaint.');
        return;
      }
      form.requestSubmit();
    } else {
      // Keep the UI values synchronized with the server-side session.
      loadIdentity();
    }
  }, true);
})();
