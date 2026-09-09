'use strict';

// Non-destructive CAMS migration: SQLite -> PostgreSQL.
// The SQLite database is opened read-only and is never modified.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { query, transaction, pool } = require('../db/postgres');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'civil-affairs.db');

// Parent tables first, then dependent/history tables.
const migrationOrder = [
  'departments',
  'designations',
  'users',
  'staff',
  'complaints',
  'complaint_history',
  'equipment',
  'tenders',
  'tender_bidders',
  'tender_history',
  'activity',
  'resident_users',
  'quarter_applications',
  'shop_applications',
  'township_civilians',
  'township_shops',
  'qr_codes',
  'notification_history'
];

const aliasMap = {
  name: ['full_name', 'civilian_name', 'person_name', 'applicant_name', 'owner_name'],
  phone: ['mobile', 'mobile_no', 'phone_number', 'contact_phone'],
  email: ['email_address', 'mail'],
  address: ['residential_address', 'home_address', 'full_address'],
  shop_name: ['name', 'business_name'],
  owner_name: ['owner', 'proprietor', 'proprietor_name'],
  shop_code: ['code', 'shop_id', 'asset_code'],
  location: ['address', 'shop_location'],
  description: ['details', 'remarks', 'notes']
};

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function parseJson(value) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return { value: String(value) }; }
}

function firstValue(row, column) {
  if (row[column] !== undefined && row[column] !== null && String(row[column]).trim() !== '') {
    return row[column];
  }
  for (const alias of aliasMap[column] || []) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') {
      return row[alias];
    }
  }
  return undefined;
}

function normalizeValue(table, column, value) {
  if (value === undefined) return null;

  const jsonColumns = new Set(['details', 'payload', 'provider_response']);
  if (jsonColumns.has(column)) return parseJson(value);

  if (table === 'qr_codes' && column === 'active') return Boolean(value);

  return value;
}

function buildRow(table, postgresColumns, sqliteRow) {
  const result = {};
  for (const column of postgresColumns) {
    let value = firstValue(sqliteRow, column);

    // Preserve legacy/source-only fields when the PostgreSQL table has a JSONB
    // details/payload column. This prevents data loss when old SQLite schemas
    // used different column names.
    if ((column === 'details' || column === 'payload') && value === undefined) {
      const reserved = new Set(['id', 'created_at', 'updated_at']);
      const extras = {};
      for (const [key, extraValue] of Object.entries(sqliteRow)) {
        if (!reserved.has(key) && !(key in result) && extraValue !== undefined) extras[key] = extraValue;
      }
      value = extras;
    }

    // Current PostgreSQL schema requires township civilian/shop names. Legacy
    // SQLite data may use another label or contain an empty value. Keep the
    // row migratable without inventing a person's name.
    if (table === 'township_civilians' && column === 'name' && (value === undefined || value === null || String(value).trim() === '')) {
      value = 'Unnamed civilian';
    }
    if (table === 'township_shops' && column === 'name' && (value === undefined || value === null || String(value).trim() === '')) {
      value = 'Unnamed shop';
    }

    result[column] = normalizeValue(table, column, value);
  }
  return result;
}

async function getPostgresColumns(table) {
  const rows = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  return rows.rows.map(row => row.column_name);
}

function getSqliteTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(row => row.name);
}

async function migrateTable(db, table) {
  const postgresColumns = await getPostgresColumns(table);
  if (!postgresColumns.length) return { sourceRows: 0, written: 0, skipped: true };

  const sqliteColumns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => row.name);
  const columns = postgresColumns.filter(column => sqliteColumns.includes(column) || aliasMap[column]?.some(alias => sqliteColumns.includes(alias)) || ['details', 'payload'].includes(column));
  if (!columns.length) return { sourceRows: 0, written: 0, skipped: true };

  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  if (!rows.length) return { sourceRows: 0, written: 0, skipped: false };

  const hasId = columns.includes('id');
  const columnSql = columns.map(quoteIdentifier).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updateColumns = columns.filter(column => column !== 'id');

  let written = 0;
  await transaction(async client => {
    for (const sqliteRow of rows) {
      const mapped = buildRow(table, columns, sqliteRow);
      const values = columns.map(column => mapped[column]);
      let sql;

      if (hasId) {
        sql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})
          ON CONFLICT (id) DO UPDATE SET ${updateColumns.map(column => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`;
      } else {
        sql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`;
      }

      await client.query(sql, values);
      written += 1;
    }
  });

  if (hasId) {
    await query(`
      SELECT setval(
        pg_get_serial_sequence($1, 'id'),
        COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 1),
        COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 0) > 0
      )
    `, [table]);
  }

  return { sourceRows: rows.length, written, skipped: false };
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const sqliteTables = new Set(getSqliteTables(db));
    const available = migrationOrder.filter(table => sqliteTables.has(table));
    const missing = migrationOrder.filter(table => !sqliteTables.has(table));

    console.log(`SQLite source: ${dbPath}`);
    console.log(`PostgreSQL target: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'civil_affairs'}`);
    console.log(`Found ${sqliteTables.size} SQLite table(s). Migrating ${available.length} CAMS table(s).`);

    let total = 0;
    for (const table of available) {
      const result = await migrateTable(db, table);
      total += result.written;
      console.log(`  ${table}: ${result.written}/${result.sourceRows} row(s) copied`);
    }

    if (missing.length) console.log(`  Not present in SQLite (skipped): ${missing.join(', ')}`);
    console.log(`Migration complete: ${total} row(s) written to PostgreSQL.`);
    console.log('SQLite was opened read-only and remains untouched. The migration is safe to rerun.');
  } finally {
    db.close();
  }
}

main()
  .catch(error => {
    console.error('SQLite -> PostgreSQL migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
