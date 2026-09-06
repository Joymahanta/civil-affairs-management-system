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

  function improveQuickActionIcons() {
    if (document.getElementById('resident-quick-icon-fix')) return;
    const style = document.createElement('style');
    style.id = 'resident-quick-icon-fix';
    style.textContent = `
      .quick-actions .quick-action { display:flex; flex-direction:column; align-items:flex-start; justify-content:center; min-height:108px; }
      .quick-actions .quick-icon {
        display:grid !important;
        place-items:center;
        width:42px !important;
        height:42px !important;
        min-width:42px;
        margin-bottom:10px;
        border-radius:11px;
        background:#e5f5ee;
        color:#147a5d;
        font-size:25px !important;
        line-height:1;
        font-weight:700;
      }
      .quick-actions .quick-action:nth-child(2) .quick-icon { background:#e8f2fc; color:#2f6fae; }
      .quick-actions .quick-action:nth-child(3) .quick-icon { background:#fff3de; color:#b87116; }
      .quick-actions .quick-action:nth-child(4) .quick-icon { background:#fee9e7; color:#bd453e; }
      .quick-actions .quick-action strong { margin:0 0 4px; }
      .quick-actions .quick-action span:not(.quick-icon) { margin:0; }
      @media (max-width:760px) {
        .quick-actions .card { grid-template-columns:1fr 1fr; }
        .quick-actions .quick-action { min-height:116px; }
      }
    `;
    document.head.appendChild(style);
  }

  function bind() {
    improveQuickActionIcons();
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
