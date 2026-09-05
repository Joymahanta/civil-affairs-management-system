const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');
const express = require('express');
const expressSession = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(expressSession);

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const sessionDb = new BetterSqlite3(path.join(dataDir, 'civil-affairs.db'));
sessionDb.pragma('journal_mode = WAL');

// Authentication/session responses must never be converted into HTTP 304 responses.
// The frontend expects a JSON body from /api/auth/session; a body-less 304 is treated
// as an auth failure and can cause the login <-> admin redirect loop.
const originalSend = express.response.send;
express.response.send = function sendWithoutAuthCaching(body) {
  const req = this.req;
  const isAuthApi = req && req.originalUrl && req.originalUrl.startsWith('/api/auth/');

  if (isAuthApi) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    this.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    this.set('Pragma', 'no-cache');
    this.set('Expires', '0');
  }

  return originalSend.call(this, body);
};

function patchedSession(options = {}) {
  if (options.store) return expressSession(options);
  return expressSession({
    ...options,
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 }
    })
  });
}

require.cache[require.resolve('express-session')].exports = patchedSession;
require('./server.js');
