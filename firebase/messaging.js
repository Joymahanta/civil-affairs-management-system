const { getMessaging } = require('firebase-admin/messaging');
const { requireFirebaseApp } = require('./admin');

async function sendToToken(token, notification, data = {}) {
  if (!token) throw new Error('FCM registration token is required.');
  return getMessaging(requireFirebaseApp()).send({
    token,
    notification,
    data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))
  });
}

async function sendToTokens(tokens, notification, data = {}) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!uniqueTokens.length) return { successCount: 0, failureCount: 0, responses: [] };
  return getMessaging(requireFirebaseApp()).sendEachForMulticast({
    tokens: uniqueTokens,
    notification,
    data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))
  });
}

module.exports = { sendToToken, sendToTokens };
