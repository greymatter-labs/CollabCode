/**
 * Vercel Serverless Function - Reset Session Workspace
 * /api/sessions/reset
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildSessionTemplateFromVersion, getProblemVersion } = require('../../lib/problems');
const { normalizeProblemTemplate } = require('../../lib/session-template');
const { deleteSessionSandbox } = require('../../lib/blaxel-runner');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const decoded = requireAdmin(req);
    const sessionId = String(req.body?.sessionId || '').trim().toUpperCase();
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const admin = getFirebaseAdmin();
    const sessionRef = admin.database().ref(`sessions/${sessionId}`);
    const snapshot = await sessionRef.once('value');
    const session = snapshot.val();
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const timestamp = Date.now();
    const problemId = session?.problem?.problemId || session?.workspace?.source?.problemId;
    const versionId = session?.problem?.versionId || session?.workspace?.source?.problemVersionId;
    if (!problemId || !versionId) {
      return res.status(400).json({ error: 'Workspace reset requires a problem-backed session' });
    }

    const problemSnapshot = await admin.database().ref(`problems/${problemId}`).once('value');
    const problem = problemSnapshot.val();
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    const version = getProblemVersion(problem, versionId);
    const template = buildSessionTemplateFromVersion(problem, version);
    const problemCopy = normalizeProblemTemplate(template, timestamp);
    if (!problemCopy) return res.status(400).json({ error: 'Problem workspace is empty' });

    await sessionRef.update({
      workspace: problemCopy.workspace,
      fileSnapshots: problemCopy.fileSnapshots,
      filePads: null,
      lastResetAt: timestamp,
      lastResetBy: decoded.email || null,
      lastResetMode: 'workspace'
    });
    let cleanup = null;
    try {
      cleanup = await deleteSessionSandbox(sessionId);
    } catch (cleanupError) {
      cleanup = {
        deleted: false,
        warning: cleanupError.message || 'Sandbox cleanup failed'
      };
      console.warn('Session workspace reset succeeded, but sandbox cleanup failed:', cleanupError);
    }

    res.status(200).json({ success: true, mode: 'workspace', problemId, versionId, cleanup });
  } catch (error) {
    sendApiError(res, error, 'Failed to reset session');
  }
};
