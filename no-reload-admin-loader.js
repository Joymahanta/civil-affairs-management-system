const express = require('express');
const fs = require('fs');

const SCRIPT = '<script src="/admin-live-state.js?v=1" defer></script>';
const inject = body => {
  if (typeof body !== 'string' || !body.includes('access-management.js')) return body;
  if (body.includes('/admin-live-state.js')) return body;
  return body.replace('<script src="/access-management.js"></script>', `${SCRIPT}<script src="/access-management.js"></script>`);
};

const send = express.response.send;
express.response.send = function(body) {
  if (this.req?.path === '/admin.html') body = inject(body);
  return send.call(this, body);
};

const sendFile = express.response.sendFile;
express.response.sendFile = function(filePath, options, callback) {
  const req = this.req;
  if (!(req?.path === '/admin.html')) return sendFile.call(this, filePath, options, callback);
  const cb = typeof options === 'function' ? options : callback;
  fs.readFile(filePath, 'utf8', (err, body) => {
    if (err) {
      if (cb) cb(err);
      else this.status(500).end();
      return;
    }
    this.type('html');
    send.call(this, inject(body));
    if (cb) cb();
  });
  return this;
};
