const { spawn } = require('child_process');
const assert = require('assert');

const port = 3127;
const base = `http://127.0.0.1:${port}`;
let cookie = '';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
function expectStatus(result, status, label) { assert.strictEqual(result.response.status, status, `${label}: ${JSON.stringify(result.body)}`); }
async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const result = await fetch(`${base}/api/health`); if (result.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Server did not become ready.');
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), SESSION_SECRET: 'test-session-secret-only' }, stdio: 'pipe' });
  try {
    await waitForServer();
    let result = await request('/api/health'); expectStatus(result, 200, 'Health check'); assert.equal(result.body.database, 'connected');
    result = await request('/api/summary'); expectStatus(result, 401, 'Unauthenticated admin API protection');
    result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@civilaffairs.local', password: 'wrong-password' }) }); expectStatus(result, 401, 'Incorrect login rejection');
    result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@civilaffairs.local', password: 'CivilAffairs2026!' }) }); expectStatus(result, 200, 'Administrator login'); assert.ok(cookie);
    result = await request('/api/auth/session'); expectStatus(result, 200, 'Session check'); assert.equal(result.body.authenticated, true);
    result = await request('/api/summary'); expectStatus(result, 200, 'Authenticated summary');
    result = await request('/api/complaints'); expectStatus(result, 200, 'Complaint listing'); assert.ok(result.body.length >= 1); const originalComplaint = result.body[0];
    result = await request('/api/complaints', { method: 'POST', body: JSON.stringify({ type: 'Public issue', category: 'Pothole / road issue', location: 'Automated test lane', reporterName: 'Test Resident', reporterPhone: '9876509999', reporterEmail: 'test@example.local', description: 'Automated test complaint for workflow verification.' }) }); expectStatus(result, 201, 'Complaint creation'); const created = result.body;
    cookie = ''; result = await request(`/api/complaints/${created.reference}`); expectStatus(result, 401, 'Tracking phone protection');
    result = await request(`/api/complaints/${created.reference}?phone=9876509999`); expectStatus(result, 200, 'Resident tracking'); assert.equal(result.body.reference, created.reference); assert.equal(result.body.reporter_phone, undefined);
    result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@civilaffairs.local', password: 'CivilAffairs2026!' }) }); expectStatus(result, 200, 'Administrator re-login');
    result = await request(`/api/complaints/${created.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Assigned', priority: 'High', assignedTo: 'R. Kumar' }) }); expectStatus(result, 200, 'Complaint assignment'); assert.equal(result.body.status, 'Assigned');
    result = await request('/api/staff'); expectStatus(result, 200, 'Staff listing'); const staff = result.body[0];
    result = await request(`/api/staff/${staff.id}`, { method: 'PATCH', body: JSON.stringify({ attendance: 'Present', currentTask: 'Automated verification task' }) }); expectStatus(result, 200, 'Staff task update');
    result = await request('/api/staff/sms', { method: 'POST', body: JSON.stringify({ message: 'Automated test SMS record.' }) }); expectStatus(result, 200, 'SMS dispatch record'); assert.ok(result.body.sent >= 1);
    result = await request('/api/equipment'); expectStatus(result, 200, 'Equipment listing'); const equipment = result.body.find(row => row.status === 'Available') || result.body[0];
    result = await request(`/api/equipment/${equipment.id}`, { method: 'PATCH', body: JSON.stringify({ holder: equipment.holder || 'Test store', expectedReturn: equipment.expected_return || '2026-09-30', condition: equipment.condition, status: equipment.status }) }); expectStatus(result, 200, 'Equipment update');
    result = await request('/api/tenders'); expectStatus(result, 200, 'Tender listing');
    result = await request('/api/tenders', { method: 'POST', body: JSON.stringify({ scope: 'Automated verification tender', closingDate: '2026-12-31' }) }); expectStatus(result, 201, 'Tender creation'); const tender = result.body;
    result = await request(`/api/tenders/${tender.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Open', bids: 2 }) }); expectStatus(result, 200, 'Tender update'); assert.equal(result.body.status, 'Open');
    result = await request('/api/insights'); expectStatus(result, 200, 'AI insights'); assert.ok(Array.isArray(result.body.guardrails));
    result = await request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'AnotherSafePassword1!' }) }); expectStatus(result, 401, 'Password verification');
    result = await request('/api/auth/logout', { method: 'POST' }); expectStatus(result, 200, 'Logout');
    result = await request('/api/summary'); expectStatus(result, 401, 'Session invalidation');
    console.log('API workflow tests passed.');
  } finally { server.kill(); }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
