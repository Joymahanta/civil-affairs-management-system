const { getAuth } = require('firebase-admin/auth');
const { requireFirebaseApp } = require('./admin');

async function verifyIdToken(idToken, checkRevoked = false) {
  if (!idToken) {
    const error = new Error('Firebase ID token is required.');
    error.code = 'AUTH_TOKEN_MISSING';
    error.status = 401;
    throw error;
  }
  return getAuth(requireFirebaseApp()).verifyIdToken(idToken, checkRevoked);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

async function requireFirebaseAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Firebase authentication is required.' });
    req.firebaseUser = await verifyIdToken(token);
    next();
  } catch (error) {
    const status = error.code === 'FIREBASE_NOT_CONFIGURED' ? 503 : 401;
    res.status(status).json({ error: status === 503 ? 'Firebase authentication is not configured.' : 'Your Firebase sign-in is invalid or expired.' });
  }
}

module.exports = { verifyIdToken, bearerToken, requireFirebaseAuth };
