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

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

function normalizeFinalFiles(input) {
  if (!Array.isArray(input)) return [];

  const files = [];
  let totalCharacters = 0;
  const seenPaths = new Set();

  for (const rawFile of input.slice(0, 100)) {
    const path = normalizePath(rawFile?.path || rawFile?.name);
    if (!path || seenPaths.has(path)) continue;

    const content = String(rawFile?.content || '');
    totalCharacters += content.length;
    if (totalCharacters > 300000) break;

    seenPaths.add(path);
    files.push({
      id: String(rawFile?.id || path.replace(/[^A-Za-z0-9_-]/g, '_')).slice(0, 120),
      path,
      language: String(rawFile?.language || 'text').slice(0, 40),
      role: String(rawFile?.role || 'solution').slice(0, 40),
      readonly: rawFile?.readonly === true,
      content,
      lineCount: content ? content.split('\n').length : 0,
      characterCount: content.length
    });
  }

  return files;
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

    const finalFiles = normalizeFinalFiles(req.body?.finalFiles);
    const requestedEntryFileId = String(req.body?.entryFileId || '');
    const requestedEntryPath = normalizePath(req.body?.entryPath);
    const entryFile = finalFiles.find(file => file.id === requestedEntryFileId)
      || finalFiles.find(file => file.path === requestedEntryPath)
      || finalFiles[0]
      || null;
    const finalCode = String(req.body?.finalCode || entryFile?.content || '');
    const language = String(req.body?.language || sessionData.settings?.language || 'javascript');
    const totalCharacterCount = finalFiles.reduce((sum, file) => sum + file.characterCount, 0);

    const updates = {
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
    };

    if (finalFiles.length) {
      updates.finalFiles = {
        files: finalFiles,
        entryFileId: entryFile?.id || null,
        entryPath: entryFile?.path || null,
        workspaceSource: req.body?.workspaceSource || sessionData.workspace?.source || null,
        savedAt: admin.database.ServerValue.TIMESTAMP,
        savedBy: decoded.email,
        fileCount: finalFiles.length,
        characterCount: totalCharacterCount
      };
    }

    await sessionRef.update(updates);

    return res.status(200).json({
      success: true,
      sessionId
    });
  } catch (error) {
    console.error('End session error:', error);
    return res.status(500).json({ error: 'Failed to end session' });
  }
};
