const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'civil-affairs.db'));
db.pragma('foreign_keys = ON');

function repairLegacyDesignations() {
  const mappings = [
    [['waterworks', 'water', 'water supply'], 'Waterworks Supervisor'],
    [['electrical', 'electric', 'electrician'], 'Electrical Supervisor'],
    [['sanitation', 'garbage', 'waste'], 'Sanitation Officer'],
    [['inspection', 'inspector'], 'Field Inspector'],
    [['roads', 'road'], 'Junior Engineer'],
    [['horticulture', 'parks', 'landscaping'], 'Field Inspector']
  ];

  const update = db.prepare('UPDATE staff SET designation_id=? WHERE id=?');
  const findDesignation = db.prepare('SELECT id FROM designations WHERE lower(name)=lower(?)');
  const staff = db.prepare('SELECT id, department, designation_id FROM staff').all();

  db.transaction(() => {
    for (const person of staff) {
      const department = String(person.department || '').trim().toLowerCase();
      if (!department || !['', 'unassigned'].includes(department) && person.designation_id) continue;
      const match = mappings.find(([aliases]) => aliases.some(alias => department.includes(alias)));
      if (!match) continue;
      const designation = findDesignation.get(match[1]);
      if (designation) update.run(designation.id, person.id);
    }
  })();
}

function installStaffDesignationRepair() {
  try {
    repairLegacyDesignations();
  } catch (error) {
    console.error('[staff-designation] repair skipped:', error.message || error);
  }
}

module.exports = { installStaffDesignationRepair };
