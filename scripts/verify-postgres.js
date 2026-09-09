'use strict';

require('dotenv').config();
const { query, pool } = require('../db/postgres');

const expected = {
  departments: 8,
  designations: 11,
  users: 1,
  staff: 6,
  complaints: 6,
  equipment: 4,
  tenders: 3,
  activity: 8,
  quarter_applications: 0,
  shop_applications: 0,
  township_civilians: 10
};

async function main() {
  const health = await query('SELECT NOW() AS now, current_database() AS database, current_user AS user');
  console.log(`PostgreSQL: ${health.rows[0].database} as ${health.rows[0].user}`);
  console.log(`Server time: ${health.rows[0].now.toISOString()}`);

  const tables = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`Schema tables: ${tables.rows.length}`);

  let failures = 0;
  for (const [table, expectedCount] of Object.entries(expected)) {
    const exists = tables.rows.some(row => row.table_name === table);
    if (!exists) {
      console.log(`FAIL  ${table}: table is missing`);
      failures += 1;
      continue;
    }
    const result = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    const count = result.rows[0].count;
    const ok = count === expectedCount;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${table}: ${count} row(s)${ok ? '' : ` (expected ${expectedCount})`}`);
    if (!ok) failures += 1;
  }

  const civilianFields = await query(`
    SELECT name, phone, email, details->>'resident' AS legacy_resident,
           details->>'quarter' AS legacy_quarter
    FROM township_civilians
    ORDER BY id
    LIMIT 3
  `);
  console.log('Township civilian mapping sample:');
  civilianFields.rows.forEach(row => console.log(JSON.stringify(row)));

  const fkCheck = await query(`
    SELECT COUNT(*)::int AS orphan_staff
    FROM staff s
    LEFT JOIN designations d ON d.id = s.designation_id
    WHERE s.designation_id IS NOT NULL AND d.id IS NULL
  `);
  const orphanStaff = fkCheck.rows[0].orphan_staff;
  console.log(`${orphanStaff === 0 ? 'PASS' : 'FAIL'} staff designation references: ${orphanStaff} orphan(s)`);
  if (orphanStaff !== 0) failures += 1;

  if (failures) throw new Error(`PostgreSQL verification failed with ${failures} issue(s).`);
  console.log('PostgreSQL verification complete: migrated data is present and core references are valid.');
}

main()
  .catch(error => {
    console.error(`PostgreSQL verification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
