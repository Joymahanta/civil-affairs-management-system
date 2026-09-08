(() => {
  if (window.__camsLiveStateInstalled) return;
  window.__camsLiveStateInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const mutation = /^(POST|PATCH|PUT|DELETE)$/i;
  const apiPath = value => {
    try { return new URL(value, window.location.origin).pathname; } catch (_) { return String(value || '').split('?')[0]; }
  };

  // Never allow a normal HTML form submission to navigate/reload the admin console.
  // Existing page-specific handlers still receive the submit event and persist data.
  document.addEventListener('submit', event => {
    if (document.body?.dataset.page === 'admin') event.preventDefault();
  }, true);

  window.fetch = async function(input, init = {}) {
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const path = apiPath(typeof input === 'string' ? input : input?.url);
    const result = await originalFetch(input, init);

    if (document.body?.dataset.page === 'admin' && mutation.test(method) && path.startsWith('/api/')) {
      const cloned = result.clone();
      const ok = result.ok;
      // Refresh only the currently visible register after a successful mutation.
      // This updates the table/cards in place and never changes the URL or session.
      if (ok) {
        Promise.resolve().then(async () => {
          try {
            const active = document.querySelector('.admin-page.active');
            if (!active) return;
            const id = active.id;
            if (id === 'overview') {
              document.dispatchEvent(new CustomEvent('cams:refresh', { detail: { page: id, path } }));
              return;
            }
            const button = document.querySelector(`[data-admin-page="${CSS.escape(id)}"]`);
            if (button) {
              button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
            }
            document.dispatchEvent(new CustomEvent('cams:data-saved', { detail: { page: id, path } }));
          } catch (_) {}
        });
      } else {
        // Keep the response untouched; this clone is intentionally consumed only
        // to avoid changing the original response stream while diagnosing failures.
        cloned.body?.cancel?.().catch?.(() => {});
      }
    }
    return result;
  };
})();
