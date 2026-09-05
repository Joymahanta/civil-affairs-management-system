const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const newPassword = process.env.ADMIN_RESET_PASSWORD;
if (!newPassword) return;
if (newPassword.length < 12) throw new Error('ADMIN_RESET_PASSWORD must contain at least 12 characters.');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'civil-affairs.db'));

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

const admin = db.prepare("SELECT id, name FROM users WHERE role='Administrator' ORDER BY id LIMIT 1").get();
if (!admin) throw new Error('No Administrator account exists to reset.');

db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(
  passwordHash(newPassword),
  new Date().toISOString(),
  admin.id
);

console.log(`Administrator password reset completed for ${admin.name}. Remove ADMIN_RESET_PASSWORD from the service environment now.`);

// Prevent the password from remaining in this Node process after the reset.
delete process.env.ADMIN_RESET_PASSWORD;
db.close();
