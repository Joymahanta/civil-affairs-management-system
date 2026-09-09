'use strict';

// Read-only diagnostic helper for the SQLite -> PostgreSQL migration.
// This never modifies the SQLite database.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'civil-affairs.db');

if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
try {
  for (const table of ['township_civilians', 'township_shops', 'qr_codes', 'notification_history']) {
    const exists = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(table).count;
    if (!exists) {
      console.log(`\n${table}: table not present`);
      continue;
    }

    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    console.log(`\n${table} columns:`);
    console.log(columns.map(column => `- ${column.name} (${column.type || 'TEXT'})`).join('\n'));

    const rows = db.prepare(`SELECT * FROM "${table}" LIMIT 10`).all();
    console.log(`${table} sample rows (${rows.length}):`);
    rows.forEach((row, index) => console.log(`  ${index + 1}. ${JSON.stringify(row)}`));
  }
} finally {
  db.close();
}
