const express = require('express');

function isTarget(path) {
  return typeof path === 'string' && (
    path === '/api/equipment' || path === '/api/tenders' || path === '/api/complaints' ||
    path === '/api/summary' || path === '/api/insights' || path === '/api/staff' ||
    path === '/api/users' || path === '/api/auth/login' || path === '/api/auth/change-password' ||
    path === '/api/resident/session' || path === '/api/resident/login' ||
    path === '/api/resident/quarter-applications' || path === '/api/shop-applications' ||
    path === '/api/admin/quarter-applications' || path === '/api/admin/shop-applications' ||
    path === '/api/township/civilians' || path === '/api/township/shops' || path === '/api/qr' ||
    path === '/api/qr/resolve/:code' || path === '/qr/:code' ||
    path.startsWith('/api/equipment/') || path.startsWith('/api/tenders/') ||
    path.startsWith('/api/complaints/') || path.startsWith('/api/staff/') ||
    path.startsWith('/api/users/') || path.startsWith('/api/resident/') ||
    path.startsWith('/api/township/civilians/') || path.startsWith('/api/township/shops/') ||
    path.startsWith('/api/qr/')
  );
}

function prioritize(app) {
  const stack = app._router?.stack;
  if (!stack) return;

  // The original implementation ran before the later CAMS Firestore cutovers were
  // registered, so the older SQLite/Firebase handlers remained ahead of the new ones.
  // At this point all preload modules have registered their routes. Keep only the
  // newest handler for each method+path and move those handlers ahead of older copies.
  const selected = new Map();
  stack.forEach((layer, index) => {
    const route = layer?.route;
    if (!route || !isTarget(route.path)) return;
    for (const method of Object.keys(route.methods || {})) {
      selected.set(`${method.toUpperCase()} ${route.path}`, { layer, index });
    }
  });
  if (!selected.size) return;

  const chosen = [...selected.values()].sort((a, b) => a.index - b.index).map(x => x.layer);
  const chosenSet = new Set(chosen);
  const remaining = stack.filter(layer => !chosenSet.has(layer));
  const firstRoute = remaining.findIndex(layer => layer.route);
  remaining.splice(firstRoute >= 0 ? firstRoute : remaining.length, 0, ...chosen);
  stack.splice(0, stack.length, ...remaining);
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  const result = originalListen.apply(this, args);
  const app = this;
  const reorder = () => { try { prioritize(app); } catch (error) { console.error('[firebase-route-priority]', error); } };
  reorder();
  setImmediate(reorder);
  setTimeout(reorder, 100);
  setTimeout(reorder, 500);
  setTimeout(reorder, 1500);
  return result;
};
