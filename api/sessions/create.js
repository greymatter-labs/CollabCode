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

function normalizeFolderPath(value) {
  return normalizePath(String(value || '').replace(/\/+$/, ''));
}

function inferLanguage(path) {
  const extension = String(path || '').split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'c_cpp',
    cc: 'c_cpp',
    cxx: 'c_cpp',
    c: 'c_cpp',
    h: 'c_cpp',
    hpp: 'c_cpp',
    cs: 'csharp',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css'
  };
  return map[extension] || 'text';
}

function normalizeProblemTemplate(template, timestamp) {
  const files = Array.isArray(template?.files) ? template.files : [];
  const folders = Array.isArray(template?.folders) ? template.folders : [];
  const workspaceFiles = {};
  const workspaceFolders = {};
  const fileSnapshots = {};
  let totalCharacters = 0;
  let entryFileId = null;

  files.slice(0, 80).forEach((rawFile, index) => {
    const path = normalizePath(rawFile?.path || rawFile?.name);
    if (!path) return;

    const content = String(rawFile?.content || '');
    totalCharacters += content.length;
    if (totalCharacters > 300000) return;

    const id = String(rawFile?.id || (index === 0 ? 'main' : `file_${index}`))
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80);
    const language = String(rawFile?.language || inferLanguage(path));
    const role = String(rawFile?.role || 'solution');

    if (!entryFileId || rawFile?.entry === true || rawFile?.id === template?.entryFileId || path === template?.entryPath) {
      entryFileId = id;
    }

    workspaceFiles[id] = {
      id,
      path,
      language,
      role,
      readonly: rawFile?.readonly === true,
      mutable: rawFile?.mutable !== false,
      origin: 'problem-template-copy',
      padPath: rawFile?.readonly === true ? null : `filePads/${id}/firepad`,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    fileSnapshots[id] = {
      path,
      language,
      role,
      content,
      updatedAt: timestamp
    };
  });

  folders.slice(0, 80).forEach((rawFolder, index) => {
    const path = normalizeFolderPath(typeof rawFolder === 'string' ? rawFolder : rawFolder?.path || rawFolder?.name);
    if (!path) return;
    if (Object.values(workspaceFiles).some(file => file.path === path)) return;

    const id = String(rawFolder?.id || `folder_${index}`)
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80);
    workspaceFolders[id] = {
      id,
      path,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });

  const fileIds = Object.keys(workspaceFiles);
  if (!fileIds.length) return null;

  entryFileId = workspaceFiles[entryFileId] ? entryFileId : fileIds[0];
  return {
    workspace: {
      version: 1,
      source: {
        type: 'problem-template',
        problemId: template?.problemId || null,
        problemTitle: template?.title || null,
        copiedAt: timestamp
      },
      activeFileId: entryFileId,
      entryFileId,
      files: workspaceFiles,
      folders: workspaceFolders
    },
    fileSnapshots
  };
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
    
    const problemCopy = normalizeProblemTemplate(req.body?.problemTemplate || req.body?.workspaceTemplate, timestamp);
    const sessionPayload = {
      created: timestamp,
      createdBy: decoded.email,
      creatorId: decoded.userId,
      status: 'active'
    };

    if (problemCopy) {
      sessionPayload.workspace = problemCopy.workspace;
      sessionPayload.fileSnapshots = problemCopy.fileSnapshots;
    }

    // Save to Firebase
    await admin.database().ref(`sessions/${sessionId}`).set(sessionPayload);

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
