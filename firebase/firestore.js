const { getFirestore } = require('firebase-admin/firestore');
const { requireFirebaseApp } = require('./admin');

function getDb() {
  return getFirestore(requireFirebaseApp());
}

function collection(name) {
  return getDb().collection(name);
}

module.exports = { getDb, collection };
