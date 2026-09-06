(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not complete the SMS request.');
    return payload;
  };
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[char]));

  async function loadRecipients() {
    const form = document.getElementById('sms-form');
    if (!form || form.dataset.recipientPickerReady === '1') return;
    form.dataset.recipientPickerReady = '1';

    const messageField = form.querySelector('[name="message"]')?.closest('.field');
    if (!messageField) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    wrapper.innerHTML = `
      <label>Send to</label>
      <div class="consent" style="margin-bottom:10px">
        <input type="checkbox" id="sms-select-all">
        <span><b>Select all</b></span>
      </div>
      <div id="sms-recipient-list" style="display:grid;gap:8px;max-height:220px;overflow:auto;padding:4px 2px"></div>
      <small class="sub" id="sms-recipient-count">Loading staff…</small>
    `;
    form.insertBefore(wrapper, messageField);

    try {
      const staff = await api('/api/staff');
      const eligible = staff.filter(item => String(item.phone || '').trim());
      const list = document.getElementById('sms-recipient-list');
      if (!eligible.length) {
        list.innerHTML = '<span class="sub">No staff members have a phone number.</span>';
        document.getElementById('sms-select-all').disabled = true;
        document.getElementById('sms-recipient-count').textContent = '0 recipients available';
        return;
      }

      list.innerHTML = eligible.map(item => `
        <label class="consent" style="justify-content:flex-start;gap:10px">
          <input type="checkbox" name="smsRecipient" value="${esc(item.id)}">
          <span><b>${esc(item.name)}</b> · ${esc(item.department || 'Staff')} · ${esc(item.phone)}</span>
        </label>
      `).join('');

      const selectAll = document.getElementById('sms-select-all');
      const boxes = () => [...list.querySelectorAll('input[name="smsRecipient"]')];
      const updateState = () => {
        const checked = boxes().filter(box => box.checked).length;
        selectAll.checked = checked === boxes().length && boxes().length > 0;
        selectAll.indeterminate = checked > 0 && checked < boxes().length;
        document.getElementById('sms-recipient-count').textContent = `${checked} of ${boxes().length} staff selected`;
      };
      selectAll.addEventListener('change', () => {
        boxes().forEach(box => { box.checked = selectAll.checked; });
        updateState();
      });
      boxes().forEach(box => box.addEventListener('change', updateState));
      updateState();
    } catch (error) {
      document.getElementById('sms-recipient-list').innerHTML = `<span class="sub">${esc(error.message)}</span>`;
      document.getElementById('sms-recipient-count').textContent = 'Could not load staff recipients';
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#open-sms')) setTimeout(loadRecipients, 0);
  }, true);

  document.addEventListener('submit', async event => {
    const form = event.target.closest('#sms-form');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const selected = [...form.querySelectorAll('input[name="smsRecipient"]:checked')].map(input => Number(input.value)).filter(Number.isInteger);
    const error = form.querySelector('.error');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }
    if (!selected.length) {
      if (error) { error.textContent = 'Select at least one staff member.'; error.classList.remove('hidden'); }
      return;
    }

    const button = form.querySelector('button[type="submit"]') || form.querySelector('button:not([type])');
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      const message = String(new FormData(form).get('message') || '').trim();
      const data = await api('/api/staff/sms', {
        method: 'POST',
        body: JSON.stringify({ message, staffIds: selected })
      });
      document.getElementById('sms-modal')?.classList.remove('show');
      form.reset();
      document.querySelectorAll('input[name="smsRecipient"]').forEach(input => { input.checked = false; });
      const selectAll = document.getElementById('sms-select-all');
      if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
      const count = document.getElementById('sms-recipient-count');
      if (count) count.textContent = `${selected.length} staff selected`;
      const toastNode = document.getElementById('toast');
      if (toastNode) {
        toastNode.textContent = `SMS accepted for ${data.sent || selected.length} selected staff member${(data.sent || selected.length) === 1 ? '' : 's'}.`;
        toastNode.classList.add('show');
        clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => toastNode.classList.remove('show'), 4400);
      }
    } catch (error) {
      if (error) {
        const target = form.querySelector('.error');
        if (target) { target.textContent = error.message; target.classList.remove('hidden'); }
      }
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Send SMS update'; }
    }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(loadRecipients, 0));
  else setTimeout(loadRecipients, 0);
})();
