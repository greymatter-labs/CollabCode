/**
 * Vercel Serverless Function - Validate Problem Runtime
 * /api/problems/validate
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildValidationProject, getProblemVersion, normalizeDraft } = require('../../lib/problems');
const { runProject } = require('../../lib/blaxel-runner');

function selectSource(record, body, actorEmail) {
  if (body?.problem) {
    const normalized = normalizeDraft(body.problem, record, actorEmail);
    return { record: normalized, source: normalized.draft };
  }

  if (String(body?.versionId || '').toLowerCase() === 'draft' || body?.useDraft === true) {
    return { record, source: record.draft };
  }

  const version = getProblemVersion(record, body?.versionId);
  return { record, source: version };
}

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const decoded = requireAdmin(req);
    const admin = getFirebaseAdmin();
    const problemId = String(req.body?.problemId || req.body?.problem?.id || '').trim();
    let record = null;

    if (problemId) {
      const snapshot = await admin.database().ref(`problems/${problemId}`).once('value');
      record = snapshot.val();
      if (!record && !req.body?.problem) return res.status(404).json({ error: 'Problem not found' });
    }

    const selected = selectSource(record, req.body || {}, decoded.email);
    const command = req.body?.command || req.body?.customCommand || '';
    const project = buildValidationProject(selected.record, selected.source, req.body?.mode || 'starter', {
      command,
      includeHidden: req.body?.includeHidden === true
    });
    const result = await runProject({
      ...project,
      stdin: req.body?.stdin || '',
      timeoutSec: Number(req.body?.timeoutSec || 60),
      collectChangedFiles: req.body?.collectChangedFiles === true
    });

    if (selected.record?.id) {
      const timestamp = Date.now();
      const validationPath = selected.source?.versionId
        ? `problems/${selected.record.id}/versions/${selected.source.versionId}/validation/${project.mode}`
        : `problems/${selected.record.id}/draft/validation/${project.mode}`;
      await admin.database().ref(validationPath).set({
        success: result.success,
        exitCode: result.exitCode,
        command: result.command,
        provider: result.provider,
        sandboxName: result.sandboxName,
        executionTime: result.executionTime,
        validatedAt: timestamp,
        validatedBy: decoded.email || null
      });
    }

    res.status(200).json({ success: result.success, mode: project.mode, result });
  } catch (error) {
    sendApiError(res, error, 'Failed to validate problem');
  }
};
