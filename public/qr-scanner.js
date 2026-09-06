(() => {
  const LIBRARY_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  const esc = value => String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[ch]));
  let scanner = null;
  let scanBusy = false;

  function loadLibrary() {
    if (window.Html5Qrcode) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-qr-library]');
      if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
      const script = document.createElement('script');
      script.src = LIBRARY_URL;
      script.async = true;
      script.dataset.qrLibrary = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('QR scanner library could not be loaded. Check the internet connection and try again.'));
      document.head.appendChild(script);
    });
  }

  function addStyles() {
    if (document.getElementById('qr-scanner-styles')) return;
    const style = document.createElement('style');
    style.id = 'qr-scanner-styles';
    style.textContent = `
      .qr-launch{display:inline-flex;align-items:center;gap:7px}
      .qr-launch .qr-symbol{font-size:17px;line-height:1}
      .qr-modal-backdrop{display:none;position:fixed;inset:0;z-index:120;background:rgba(9,34,26,.62);align-items:center;justify-content:center;padding:18px}
      .qr-modal-backdrop.show{display:flex}
      .qr-modal{width:min(620px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 25px 80px rgba(0,0,0,.28);padding:24px}
      .qr-modal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
      .qr-modal h2{font:700 21px Manrope,Arial,sans-serif;margin:0}
      .qr-modal p{color:var(--muted,#697871);font-size:12px;line-height:1.5;margin:5px 0 0}
      .qr-close{border:0;background:none;color:var(--muted,#697871);font-size:27px;line-height:1;padding:0 3px}
      .qr-reader{width:100%;min-height:260px;border:1px dashed #bfd6cb;border-radius:13px;overflow:hidden;background:#f3f8f5}
      .qr-reader video{border-radius:12px}
      .qr-status{margin:11px 0 0;padding:10px 12px;border-radius:9px;background:#f2f7f4;color:#456258;font-size:11px;line-height:1.45}
      .qr-status.error{background:#fee9e7;color:#9b3933}
      .qr-result{display:none;margin-top:15px;padding:15px;border:1px solid #d8e7df;border-radius:12px;background:#fbfdfc}
      .qr-result.show{display:block}
      .qr-result-title{font:700 16px Manrope,Arial,sans-serif;margin-bottom:9px}
      .qr-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 15px}
      .qr-result-item{font-size:11px;color:#63736c;line-height:1.45}
      .qr-result-item b{display:block;color:#19352c;font-size:11px;margin-bottom:2px}
      .qr-rules{margin:10px 0 0;padding-left:17px;color:#53655e;font-size:11px;line-height:1.55}
      .qr-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:15px;flex-wrap:wrap}
      .qr-help{margin-top:10px;font-size:10px;color:#73837d}
      @media(max-width:640px){.qr-result-grid{grid-template-columns:1fr}.qr-modal{padding:18px}.qr-reader{min-height:230px}}
    `;
    document.head.appendChild(style);
  }

  function parsePayload(raw) {
    const text = String(raw || '').trim();
    let value = text;
    try { value = JSON.parse(text); } catch (_) {}
    if (typeof value === 'object' && value !== null) return normalize(value, text);

    try {
      const url = new URL(text, window.location.origin);
      const encoded = url.searchParams.get('qr') || url.searchParams.get('data') || url.searchParams.get('payload');
      if (encoded) {
        try { return normalize(JSON.parse(decodeURIComponent(encoded)), text); } catch (_) {}
      }
      const params = Object.fromEntries(url.searchParams.entries());
      if (Object.keys(params).length) return normalize({ ...params, type: params.type || params.qrType || 'location' }, text);
    } catch (_) {}

    return normalize({ type: 'location', title: text, location: text, raw: text }, text);
  }

  function normalize(data, raw) {
    const type = String(data.type || data.qrType || data.entityType || data.kind || 'location').toLowerCase();
    const normalized = {
      type,
      id: data.id || data.code || data.reference || '',
      title: data.title || data.name || data.label || '',
      location: data.location || data.address || data.place || '',
      category: data.category || '',
      description: data.description || data.issue || '',
      reporterName: data.reporterName || data.renterName || data.tenantName || data.residentName || '',
      reporterPhone: data.reporterPhone || data.phone || data.mobile || '',
      reporterEmail: data.reporterEmail || data.email || '',
      quarterNumber: data.quarterNumber || data.quarter || '',
      shopNumber: data.shopNumber || data.shop || '',
      dustbinId: data.dustbinId || data.binNumber || data.bin || '',
      gateName: data.gateName || data.gate || '',
      openingTime: data.openingTime || data.open || '',
      closingTime: data.closingTime || data.closing || '',
      rules: Array.isArray(data.rules) ? data.rules : String(data.rules || '').split(/\n|\|/).map(x => x.trim()).filter(Boolean),
      gatekeeperName: data.gatekeeperName || data.gatekeeper || '',
      details: data.details || '',
      raw
    };
    if (normalized.type.includes('quarter')) normalized.category ||= 'Maintenance request';
    if (normalized.type.includes('shop')) normalized.category ||= 'Shop operation';
    if (normalized.type.includes('dustbin') || normalized.type.includes('garbage') || normalized.type.includes('bin')) normalized.category ||= 'Garbage / sanitation';
    if (normalized.type.includes('gate')) normalized.category ||= 'Public issue';
    return normalized;
  }

  function isComplaintResource(data) {
    return ['quarter','shop','dustbin','garbage','bin','location','complaint','public','area'].some(key => data.type.includes(key));
  }

  function labelFor(data) {
    if (data.type.includes('quarter')) return data.quarterNumber ? `Quarter ${data.quarterNumber}` : 'Township quarter';
    if (data.type.includes('shop')) return data.shopNumber ? `Shop ${data.shopNumber}` : 'Township shop';
    if (data.type.includes('dustbin') || data.type.includes('garbage') || data.type.includes('bin')) return data.dustbinId ? `Dustbin ${data.dustbinId}` : 'Dustbin / collection point';
    if (data.type.includes('gate')) return data.gateName || 'Township gate';
    if (data.type.includes('complaint')) return 'Township complaint point';
    return data.title || data.location || 'Township QR location';
  }

  function renderResult(data) {
    const result = document.getElementById('qr-result');
    if (!result) return;
    const rows = [];
    if (data.quarterNumber) rows.push(['Quarter', data.quarterNumber]);
    if (data.shopNumber) rows.push(['Shop', data.shopNumber]);
    if (data.dustbinId) rows.push(['Dustbin', data.dustbinId]);
    if (data.location) rows.push(['Location', data.location]);
    if (data.reporterName) rows.push(['Resident / renter', data.reporterName]);
    if (data.reporterPhone) rows.push(['Mobile', data.reporterPhone]);
    if (data.gatekeeperName) rows.push(['Gatekeeper', data.gatekeeperName]);
    if (data.openingTime || data.closingTime) rows.push(['Opening hours', `${data.openingTime || '—'} – ${data.closingTime || '—'}`]);
    if (data.category) rows.push(['Category', data.category]);
    result.innerHTML = `
      <div class="qr-result-title">${esc(labelFor(data))}</div>
      ${rows.length ? `<div class="qr-result-grid">${rows.map(row => `<div class="qr-result-item"><b>${esc(row[0])}</b>${esc(row[1])}</div>`).join('')}</div>` : ''}
      ${data.details ? `<p style="margin-top:10px">${esc(data.details)}</p>` : ''}
      ${data.rules.length ? `<div style="margin-top:10px"><b style="font-size:11px">Rules</b><ul class="qr-rules">${data.rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ul></div>` : ''}
      <div class="qr-actions">
        ${isComplaintResource(data) ? '<button type="button" class="button" id="qr-report">Report an issue here</button>' : ''}
        <button type="button" class="button secondary" id="qr-scan-again">Scan another</button>
      </div>
    `;
    result.classList.add('show');
    document.getElementById('qr-report')?.addEventListener('click', () => applyToComplaint(data));
    document.getElementById('qr-scan-again')?.addEventListener('click', () => startScanner());
  }

  function openScanner() {
    const backdrop = document.getElementById('qr-modal');
    if (!backdrop) return;
    backdrop.classList.add('show');
    startScanner();
  }

  async function startScanner() {
    const reader = document.getElementById('qr-reader');
    const status = document.getElementById('qr-status');
    const result = document.getElementById('qr-result');
    if (!reader || !status) return;
    result?.classList.remove('show');
    scanBusy = false;
    try {
      await loadLibrary();
      if (scanner) { try { await scanner.stop(); } catch (_) {} }
      reader.innerHTML = '';
      scanner = new Html5Qrcode('qr-reader');
      status.className = 'qr-status';
      status.textContent = 'Point your camera at a township QR code. Keep the code inside the frame.';
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, decoded => {
        if (scanBusy) return;
        scanBusy = true;
        const data = parsePayload(decoded);
        renderResult(data);
        status.textContent = `QR code read successfully (${data.type}).`;
        try { scanner.stop(); } catch (_) {}
      }, () => {});
    } catch (error) {
      status.className = 'qr-status error';
      status.textContent = error?.message || 'Camera could not be started. Check browser camera permission.';
    }
  }

  function closeScanner() {
    document.getElementById('qr-modal')?.classList.remove('show');
    if (scanner) { try { scanner.stop(); } catch (_) {} }
    scanner = null;
  }

  function fill(form, name, value) {
    if (!value) return;
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.value = value;
  }

  function applyToComplaint(data) {
    closeScanner();
    const form = document.getElementById('report-form') || document.getElementById('admin-complaint-form');
    if (!form) return;
    const isResident = form.id === 'report-form';
    if (isResident) {
      form.reset();
      fill(form, 'type', data.type.includes('shop') ? 'Shop operation' : data.type.includes('dustbin') || data.type.includes('garbage') || data.type.includes('bin') ? 'Garbage / sanitation' : data.type.includes('quarter') ? 'Quarter maintenance' : 'Public issue');
      fill(form, 'category', data.category || 'Other');
      fill(form, 'location', data.location || data.quarterNumber || data.shopNumber || data.dustbinId || data.gateName || data.title);
      fill(form, 'reporterName', data.reporterName);
      fill(form, 'reporterPhone', data.reporterPhone);
      fill(form, 'reporterEmail', data.reporterEmail);
      if (data.description) fill(form, 'description', data.description);
      document.getElementById('report-modal')?.classList.add('show');
      window.setTimeout(() => document.getElementById('report-location')?.focus(), 100);
      return;
    }
    form.reset();
    fill(form, 'type', data.type.includes('shop') ? 'Shop operation' : data.type.includes('dustbin') || data.type.includes('garbage') || data.type.includes('bin') ? 'Garbage / sanitation' : data.type.includes('quarter') ? 'Quarter maintenance' : 'Public issue');
    fill(form, 'category', data.category || 'Other');
    fill(form, 'location', data.location || data.quarterNumber || data.shopNumber || data.dustbinId || data.gateName || data.title);
    fill(form, 'reporterName', data.reporterName || '');
    fill(form, 'reporterPhone', data.reporterPhone || '');
    fill(form, 'reporterEmail', data.reporterEmail || '');
    if (data.description) fill(form, 'description', data.description);
    document.getElementById('admin-complaint-modal')?.classList.add('show');
  }

  function buildModal() {
    if (document.getElementById('qr-modal')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'qr-modal-backdrop';
    wrapper.id = 'qr-modal';
    wrapper.innerHTML = `
      <div class="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <div class="qr-modal-head">
          <div><h2 id="qr-title">Scan township QR</h2><p>Read a quarter, shop, dustbin, gate or general complaint QR code.</p></div>
          <button type="button" class="qr-close" id="qr-close" aria-label="Close">×</button>
        </div>
        <div class="qr-reader" id="qr-reader"></div>
        <div class="qr-status" id="qr-status">Starting camera…</div>
        <div class="qr-result" id="qr-result"></div>
        <div class="qr-help">Camera access is used only while scanning. QR data is interpreted in the browser; complaint details are filled into the existing complaint form.</div>
      </div>
    `;
    document.body.appendChild(wrapper);
    document.getElementById('qr-close').addEventListener('click', closeScanner);
    wrapper.addEventListener('click', event => { if (event.target === wrapper) closeScanner(); });
  }

  function addLaunchButton() {
    addStyles();
    buildModal();
    if (document.body.dataset.page === 'resident') {
      const navRight = document.querySelector('.resident-nav .nav-right');
      if (navRight && !document.getElementById('open-qr-scanner')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'open-qr-scanner';
        button.className = 'button secondary small qr-launch';
        button.innerHTML = '<span class="qr-symbol">▦</span> Scan QR';
        button.addEventListener('click', openScanner);
        navRight.insertBefore(button, navRight.firstChild);
      }
    } else if (document.body.dataset.page === 'admin') {
      const actions = document.querySelector('.admin-top-actions');
      if (actions && !document.getElementById('open-qr-scanner')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'open-qr-scanner';
        button.className = 'button secondary small qr-launch';
        button.innerHTML = '<span class="qr-symbol">▦</span> Scan QR';
        button.addEventListener('click', openScanner);
        const search = document.getElementById('admin-search');
        actions.insertBefore(button, search || actions.firstChild);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLaunchButton, { once: true });
  else addLaunchButton();
})();
