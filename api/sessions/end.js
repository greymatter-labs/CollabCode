/**
 * Vercel Serverless Function - End Session
 * /api/sessions/end
 */

const jwt = require('jsonwebtoken');
const getFirebaseAdmin = require('../../lib/firebase-admin');

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_ID_PATTERN = /^[A-Z0-9]{8}$/;

if (
  !JWT_SECRET ||
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY
) {
  console.error('Missing required environment variables');
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function normalizeSessionId(sessionId) {
  return String(sessionId || '').trim().toUpperCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const sessionId = normalizeSessionId(req.body?.sessionId);
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const admin = getFirebaseAdmin();
    const sessionRef = admin.database().ref(`sessions/${sessionId}`);
    const snapshot = await sessionRef.once('value');
    const sessionData = snapshot.val();

    if (!sessionData) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const users = sessionData.users || {};
    const preservedParticipants = {};
    Object.entries(users).forEach(([userId, user]) => {
      preservedParticipants[userId] = {
        name: user?.name || 'Unknown',
        joinedAt: user?.timestamp || Date.now()
      };
    });

    const finalCode = String(req.body?.finalCode || '');
    const language = String(req.body?.language || sessionData.settings?.language || 'javascript');

    await sessionRef.update({
      finalCode: {
        content: finalCode,
        language,
        savedAt: admin.database.ServerValue.TIMESTAMP,
        lineCount: finalCode ? finalCode.split('\n').length : 0,
        characterCount: finalCode.length,
        savedBy: decoded.email
      },
      preservedParticipants,
      status: 'ended',
      terminated: {
        terminated: true,
        terminatedBy: decoded.email,
        terminatedAt: admin.database.ServerValue.TIMESTAMP
      }
    });

    return res.status(200).json({
      success: true,
      sessionId
    });
  } catch (error) {
    console.error('End session error:', error);
    return res.status(500).json({ error: 'Failed to end session' });
  }
};
