'use strict';

require('dotenv').config();

const { query, pool } = require('../db/postgres');

const expectedTables = [
  'departments',
  'designations',
  'users',
  'staff',
  'complaints',
  'equipment',
  'tenders',
  'activity',
  'quarter_applications',
  'shop_applications',
  'township_civilians',
  'township_shops',
  'qr_codes',
  'notification_history',
  'complaint_history',
  'tender_bidders',
  'tender_history',
  'resident_users'
];

async function main() {
  const tableResult = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = tableResult.rows.map(row => row.table_name);

  const missing = expectedTables.filter(table => !tables.includes(table));
  if (missing.length) {
    throw new Error(`Missing PostgreSQL table(s): ${missing.join(', ')}`);
  }

  const counts = {};
  for (const table of expectedTables) {
    const result = await query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
    counts[table] = Number(result.rows[0].count);
  }

  const requiredNonEmpty = [
    'departments',
    'designations',
    'users',
    'staff',
    'complaints',
    'equipment',
    'tenders',
    'activity',
    'township_civilians'
  ];
  const emptyRequired = requiredNonEmpty.filter(table => counts[table] === 0);
  if (emptyRequired.length) {
    throw new Error(`Required migrated table(s) are empty: ${emptyRequired.join(', ')}`);
  }

  const orphanStaff = await query(`
    SELECT COUNT(*)::bigint AS count
    FROM staff s
    LEFT JOIN designations d ON d.id = s.designation_id
    WHERE s.designation_id IS NOT NULL AND d.id IS NULL
  `);

  const orphanComplaints = await query(`
    SELECT COUNT(*)::bigint AS count
    FROM complaints
    WHERE reference IS NULL OR trim(reference) = ''
  `);

  const civilianData = await query(`
    SELECT id, name, phone, email, details
    FROM township_civilians
    ORDER BY id
    LIMIT 3
  `);

  console.log('PostgreSQL migration verification passed.');
  console.log(`Tables checked: ${expectedTables.length}`);
  console.log(`Total rows checked: ${Object.values(counts).reduce((sum, count) => sum + count, 0)}`);
  console.log('Row counts:');
  for (const table of expectedTables) console.log(`  ${table}: ${counts[table]}`);
  console.log(`Staff with broken designation references: ${orphanStaff.rows[0].count}`);
  console.log(`Complaints with missing references: ${orphanComplaints.rows[0].count}`);
  console.log('Township civilian sample:');
  for (const row of civilianData.rows) {
    console.log(`  ${row.id}: ${row.name} | ${row.phone || ''} | ${row.email || ''}`);
  }
}

main()
  .catch(error => {
    console.error('PostgreSQL migration verification failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
