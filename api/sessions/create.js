/**
 * Vercel Serverless Function - Create Session
 * /api/sessions/create
 */

const jwt = require('jsonwebtoken');
const getFirebaseAdmin = require('../../lib/firebase-admin');

const JWT_SECRET = process.env.JWT_SECRET;

// Ensure required environment variables are set
if (
  !JWT_SECRET ||
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY
) {
  console.error('Missing required environment variables');
}

// Generate secure session ID
function generateSecureSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

module.exports = async (req, res) => {
  // Enable CORS
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

  // Verify JWT token
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Create session
    const admin = getFirebaseAdmin();
    const sessionId = generateSecureSessionId();
    const timestamp = Date.now();
    
    // Save to Firebase
    await admin.database().ref(`sessions/${sessionId}`).set({
      created: timestamp,
      createdBy: decoded.email,
      creatorId: decoded.userId,
      status: 'active'
    });

    res.status(200).json({
      success: true,
      sessionId: sessionId,
      created: timestamp
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
};
