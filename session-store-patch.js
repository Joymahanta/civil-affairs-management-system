const path = require('path');
const BetterSqlite3 = require('better-sqlite3');
const expressSession = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(expressSession);

const sessionDb = new BetterSqlite3(path.join(__dirname, 'data', 'civil-affairs.db'));

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
