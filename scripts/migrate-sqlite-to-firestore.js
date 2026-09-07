const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDb } = require('../firebase/firestore');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'civil-affairs.db');
const db = new Database(dbPath, { readonly: true });
const firestore = getDb();

const excludedTables = new Set(['sqlite_sequence']);
const batchLimit = 450;

function documentId(row) {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.reference) return String(row.reference);
  if (row.application_no) return String(row.application_no);
  if (row.tender_no) return String(row.tender_no);
  if (row.asset_code) return String(row.asset_code);
  return undefined;
}

async function migrateTable(table) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  const collection = firestore.collection(table);
  let migrated = 0;

  for (let start = 0; start < rows.length; start += batchLimit) {
    const batch = firestore.batch();
    const chunk = rows.slice(start, start + batchLimit);

    for (const row of chunk) {
      const id = documentId(row);
      const ref = id ? collection.doc(id) : collection.doc();
      batch.set(ref, {
        ...row,
        _source: 'sqlite',
        _source_table: table,
        _migrated_at: new Date().toISOString()
      }, { merge: true });
      migrated += 1;
    }

    await batch.commit();
  }

  return migrated;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(row => row.name)
    .filter(name => !excludedTables.has(name));

  console.log(`Migrating ${tables.length} SQLite tables from ${dbPath}`);

  let total = 0;
  for (const table of tables) {
    const count = await migrateTable(table);
    total += count;
    console.log(`  ${table}: ${count} document(s)`);
  }

  console.log(`Migration complete: ${total} document(s) written to Firestore.`);
  console.log('SQLite remains untouched. This command is an upsert migration and can be safely rerun.');
}

main()
  .catch(error => {
    console.error('Firestore migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
