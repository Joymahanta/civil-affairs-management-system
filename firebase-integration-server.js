const express = require('express');
const { firebaseConfigured, requireFirebaseApp } = require('./firebase/admin');
const { verifyIdToken } = require('./firebase/auth');

function install(app) {
  app.get('/api/firebase/status', (_req, res) => {
    res.json({
      configured: firebaseConfigured(),
      services: {
        authentication: firebaseConfigured(),
        firestore: firebaseConfigured(),
        messaging: firebaseConfigured()
      }
    });
  });

  app.get('/api/firebase/config', (_req, res) => {
    const config = {
      apiKey: process.env.FIREBASE_WEB_API_KEY || '',
      authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_WEB_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
      storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_WEB_APP_ID || '',
      measurementId: process.env.FIREBASE_WEB_MEASUREMENT_ID || ''
    };
    const configured = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'].every(key => config[key]);
    if (!configured) return res.status(503).json({ configured: false, error: 'Firebase web configuration is not configured yet.' });
    res.json({ configured: true, config });
  });

  app.get('/api/firebase/me', async (req, res) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Firebase ID token is required.' });
    try {
      const decoded = await verifyIdToken(token);
      res.json({ authenticated: true, user: { uid: decoded.uid, email: decoded.email || null, phoneNumber: decoded.phone_number || null } });
    } catch (error) {
      const status = error.code === 'FIREBASE_NOT_CONFIGURED' ? 503 : 401;
      res.status(status).json({ error: status === 503 ? 'Firebase authentication is not configured.' : 'Your Firebase sign-in is invalid or expired.' });
    }
  });

  // Touch the Admin app only when a caller actually needs Firebase.
  app.get('/api/firebase/health', (_req, res) => {
    try {
      requireFirebaseApp();
      res.json({ ok: true, adminSdk: 'initialized' });
    } catch (error) {
      res.status(error.status || 503).json({ ok: false, error: error.message });
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  install(this);
  return originalListen.apply(this, args);
};
