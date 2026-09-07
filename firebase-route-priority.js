const express = require('express');

function prioritize(app) {
  const stack = app._router?.stack;
  if (!stack) return;
  const targetPaths = new Set([
    '/api/equipment','/api/tenders','/api/complaints','/api/summary','/api/insights','/api/staff','/api/users','/api/auth/login','/api/auth/change-password',
    '/api/resident/session','/api/resident/login','/api/resident/quarter-applications','/api/shop-applications','/api/admin/quarter-applications','/api/admin/shop-applications',
    '/api/township/civilians','/api/township/shops','/api/qr','/api/qr/resolve/:code','/qr/:code'
  ]);
  const ours = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    const path = layer?.route?.path;
    if (typeof path === 'string' && (targetPaths.has(path) || path.startsWith('/api/equipment/') || path.startsWith('/api/tenders/') || path.startsWith('/api/complaints/') || path.startsWith('/api/staff/') || path.startsWith('/api/users/') || path.startsWith('/api/resident/') || path.startsWith('/api/township/civilians/') || path.startsWith('/api/township/shops/') || path.startsWith('/api/qr/'))) ours.unshift(stack.splice(i, 1)[0]);
  }
  if (!ours.length) return;
  const firstRoute = stack.findIndex(layer => layer.route);
  stack.splice(firstRoute >= 0 ? firstRoute : stack.length, 0, ...ours);
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  const result = originalListen.apply(this, args);
  const app = this;
  const reorder = () => prioritize(app);
  reorder();
  setImmediate(reorder);
  setTimeout(reorder, 100);
  setTimeout(reorder, 500);
  setTimeout(reorder, 1500);
  return result;
};
