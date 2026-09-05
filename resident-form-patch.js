(() => {
  function resetComposer() {
    const form = document.getElementById('report-form');
    const fields = document.getElementById('report-fields');
    const success = document.getElementById('report-success');
    const error = document.getElementById('report-error');
    const photo = document.getElementById('report-photo');
    const photoBox = document.querySelector('.upload-box');
    if (!form || !fields || !success) return;
    form.reset();
    fields.classList.remove('hidden');
    success.classList.add('hidden');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }
    if (photo) photo.value = '';
    if (photoBox) photoBox.textContent = '⌁ Choose a photo · report time and available location will be attached';
  }

  function bind() {
    document.querySelectorAll('[data-report-type]').forEach(button => {
      button.addEventListener('click', resetComposer, true);
    });
    document.querySelectorAll('#report-success [data-close="report-modal"]').forEach(button => {
      button.addEventListener('click', resetComposer);
    });
    document.getElementById('report-modal')?.addEventListener('click', event => {
      if (event.target.id === 'report-modal') resetComposer();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
