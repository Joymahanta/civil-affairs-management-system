require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { query, close } = require('../db/postgres');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await query(schema);

  const result = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  console.log(`PostgreSQL schema initialized. ${result.rows.length} tables are available.`);
  console.log(result.rows.map(row => `- ${row.table_name}`).join('\n'));
}

main()
  .catch(error => {
    console.error('PostgreSQL initialization failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
