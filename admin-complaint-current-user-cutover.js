const express = require('express');
const { getDb } = require('./firebase/firestore');
const fs = require('fs');

const isAdmin = req => ['Administrator', 'Sub-administrator'].includes(req.session?.user?.role);
const now = () => new Date().toISOString();

async function rows(name) {
  const snap = await getDb().collection(name).get();
  return snap.docs.map(doc => ({ ...doc.data(), id: Number(doc.get('id') ?? doc.id) }));
}

async function currentAdmin(req) {
  if (!isAdmin(req)) return null;
  const user = req.session.user;
  const staff = (await rows('staff')).find(row => Number(row.user_id) === Number(user.id))
    || (await rows('staff')).find(row => String(row.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase());
  return {
    user_id: user.id,
    role: user.role,
    name: staff?.name || user.name || '',
    phone: staff?.phone || user.phone || '',
    email: staff?.email || user.email || '',
    staff_id: staff?.id ?? null,
    employee_id: staff?.employee_id || staff?.employeeId || (staff ? `STPS-EMP-${String(staff.id).padStart(3, '0')}` : '')
  };
}

function install(app) {
  app.get('/api/admin/current-user', async (req, res) => {
    try {
      const user = await currentAdmin(req);
      if (!user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
      res.json(user);
    } catch (e) {
      console.error('[admin current user]', e);
      res.status(500).json({ error: 'Could not load the current signed-in user.' });
    }
  });

  // The complaint creation route below this middleware keeps all existing complaint
  // creation/history/notification logic, but cannot trust identity fields supplied by
  // the browser. Each request is resolved from its own session cookie, so simultaneous
  // administrators on different devices never share a global identity.
  app.use('/api/complaints', async (req, res, next) => {
    if (req.method !== 'POST' || !isAdmin(req)) return next();
    try {
      const user = await currentAdmin(req);
      if (!user) return res.status(401).json({ error: 'Please sign in to the Civil Office console.' });
      req.body = {
        ...(req.body || {}),
        reporterName: user.name,
        reporterPhone: user.phone,
        reporterEmail: user.email,
        reporter_user_id: user.user_id,
        reporter_role: user.role,
        reporter_staff_id: user.staff_id,
        reporter_employee_id: user.employee_id
      };
      next();
    } catch (e) {
      console.error('[admin complaint identity]', e);
      res.status(500).json({ error: 'Could not resolve the signed-in administrator identity.' });
    }
  });

  const originalSend = express.response.send;
  express.response.send = function(body) {
    const req = this.req;
    if (req?.path === '/admin.html' && typeof body === 'string' && !body.includes('/admin-complaint-current-user.js')) {
      body = body.replace('</body>', '<script src="/admin-complaint-current-user.js?v=1"></script></body>');
    }
    return originalSend.call(this, body);
  };

  const originalSendFile = express.response.sendFile;
  express.response.sendFile = function(filePath, options, callback) {
    const req = this.req;
    if (!(req?.path === '/admin.html' && typeof filePath === 'string' && /(?:^|[\\/])admin\.html$/.test(filePath))) {
      return originalSendFile.call(this, filePath, options, callback);
    }
    const cb = typeof options === 'function' ? options : callback;
    fs.readFile(filePath, 'utf8', (error, body) => {
      if (error) {
        if (typeof cb === 'function') cb(error); else this.status(500).end();
        return;
      }
      if (!body.includes('/admin-complaint-current-user.js')) {
        body = body.replace('</body>', '<script src="/admin-complaint-current-user.js?v=1"></script></body>');
      }
      this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      this.type('html');
      originalSend.call(this, body);
      if (typeof cb === 'function') cb();
    });
    return this;
  };
}

const originalListen = express.application.listen;
express.application.listen = function(...args) {
  try { install(this); } catch (e) { console.error('[admin complaint current user] install', e); }
  return originalListen.apply(this, args);
};
