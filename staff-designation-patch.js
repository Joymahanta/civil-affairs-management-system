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
  const staff = db.prepare(`SELECT s.id, s.department, s.designation_id, d.name AS designation_name
    FROM staff s LEFT JOIN designations d ON d.id=s.designation_id`).all();

  db.transaction(() => {
    for (const person of staff) {
      const department = String(person.department || '').trim().toLowerCase();
      const designation = String(person.designation_name || '').trim().toLowerCase();
      const needsRepair = !person.designation_id || !designation || designation === 'unassigned';
      if (!department || !needsRepair) continue;
      const match = mappings.find(([aliases]) => aliases.some(alias => department.includes(alias)));
      if (!match) continue;
      const target = findDesignation.get(match[1]);
      if (target) update.run(target.id, person.id);
    }
  })();
}

function repairDesignationDepartments() {
  const mappings = [
    ['Civil Office Administrator', 'Administration'],
    ['Assistant Administrator', 'Administration'],
    ['Office Assistant', 'Administration'],
    ['Data Entry Operator', 'Administration'],
    ['Junior Engineer', 'Engineering'],
    ['Senior Engineer', 'Engineering'],
    ['Sanitation Officer', 'Sanitation'],
    ['Electrical Supervisor', 'Electrical'],
    ['Waterworks Supervisor', 'Waterworks'],
    ['Field Inspector', 'Inspection']
  ];

  const findDepartment = db.prepare('SELECT id FROM departments WHERE lower(name)=lower(?)');
  const update = db.prepare('UPDATE designations SET department_id=?, updated_at=? WHERE lower(name)=lower(?)');
  const stamp = new Date().toISOString();

  db.transaction(() => {
    for (const [designation, department] of mappings) {
      const row = findDepartment.get(department);
      if (row) update.run(row.id, stamp, designation);
    }
  })();
}

function installStaffDesignationRepair() {
  try {
    repairDesignationDepartments();
    repairLegacyDesignations();
  } catch (error) { console.error('[staff-designation] repair skipped:', error.message || error); }
}

module.exports = { installStaffDesignationRepair };
