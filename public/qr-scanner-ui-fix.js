(() => {
  const style = document.createElement('style');
  style.id = 'qr-scanner-ui-fix';
  style.textContent = `
    .qr-reader.qr-complete { display:none; }
    .qr-modal:has(.qr-result.show) .qr-status { margin-top:12px; }
    .qr-modal:has(.qr-result.show) .qr-help { margin-top:12px; }
    .qr-result.show { margin-top:12px; }
  `;
  document.head.appendChild(style);

  const sync = () => {
    const reader = document.getElementById('qr-reader');
    const result = document.getElementById('qr-result');
    if (!reader || !result) return;
    reader.classList.toggle('qr-complete', result.classList.contains('show'));
  };

  const observe = () => {
    const result = document.getElementById('qr-result');
    if (!result) return false;
    new MutationObserver(sync).observe(result, { attributes:true, attributeFilter:['class'] });
    sync();
    return true;
  };

  if (!observe()) {
    const timer = setInterval(() => { if (observe()) clearInterval(timer); }, 100);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();
