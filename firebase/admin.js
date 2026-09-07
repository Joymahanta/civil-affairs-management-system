const { getApps, initializeApp, applicationDefault, cert } = require('firebase-admin/app');

function serviceAccountFromEnv() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
}

function firebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_CONFIG ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT
  );
}

function getFirebaseApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  if (!firebaseConfigured()) return null;

  const serviceAccount = serviceAccountFromEnv();
  if (serviceAccount) {
    return initializeApp({ credential: cert(serviceAccount) });
  }

  return initializeApp({ credential: applicationDefault() });
}

function requireFirebaseApp() {
  const app = getFirebaseApp();
  if (!app) {
    const error = new Error('Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or Google Application Default Credentials.');
    error.code = 'FIREBASE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return app;
}

module.exports = { getFirebaseApp, requireFirebaseApp, firebaseConfigured };
