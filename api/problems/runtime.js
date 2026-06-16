/**
 * Vercel Serverless Function - Prepare or Reset Problem Runtime
 * /api/problems/runtime
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildPreparedRuntimeId, buildValidationProject, getProblemVersion } = require('../../lib/problems');
const { deleteSessionSandbox, runProject } = require('../../lib/blaxel-runner');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const decoded = requireAdmin(req);
    const action = String(req.body?.action || 'prepare').toLowerCase();
    const problemId = String(req.body?.problemId || '').trim();
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const admin = getFirebaseAdmin();
    const ref = admin.database().ref(`problems/${problemId}`);
    const snapshot = await ref.once('value');
    const record = snapshot.val();
    if (!record) return res.status(404).json({ error: 'Problem not found' });

    const version = getProblemVersion(record, req.body?.versionId);
    const runtimeId = buildPreparedRuntimeId(record.id, version.versionId);
    const timestamp = Date.now();

    if (action === 'reset') {
      const deleted = await deleteSessionSandbox(runtimeId);
      await ref.child(`runtime/${version.versionId}`).set({
        status: 'reset',
        sandboxName: deleted.sandboxName,
        resetAt: timestamp,
        resetBy: decoded.email || null
      });
      return res.status(200).json({ success: true, action, runtimeId, result: deleted });
    }

    const project = buildValidationProject(record, version, req.body?.mode || 'tests');
    const result = await runProject({
      ...project,
      sessionId: runtimeId,
      stdin: req.body?.stdin || '',
      timeoutSec: Number(req.body?.timeoutSec || 90)
    });

    await ref.child(`runtime/${version.versionId}`).set({
      status: result.success ? 'prepared' : 'failed',
      sandboxName: result.sandboxName,
      command: result.command,
      exitCode: result.exitCode,
      preparedAt: timestamp,
      preparedBy: decoded.email || null,
      executionTime: result.executionTime
    });

    res.status(200).json({ success: result.success, action: 'prepare', runtimeId, result });
  } catch (error) {
    sendApiError(res, error, 'Failed to update problem runtime');
  }
};
