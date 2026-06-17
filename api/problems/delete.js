/**
 * Vercel Serverless Function - Delete Problem
 * /api/problems/delete
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildPreparedRuntimeId } = require('../../lib/problems');
const { deleteSessionSandbox } = require('../../lib/blaxel-runner');

function isValidProblemId(value) {
  return !!value && !/[.#$/\[\]]/.test(value);
}

async function cleanupPreparedRuntimes(problem) {
  const versionIds = new Set([
    ...Object.keys(problem?.versions || {}),
    ...Object.keys(problem?.runtime || {})
  ]);
  const results = [];

  for (const versionId of versionIds) {
    try {
      const runtimeId = buildPreparedRuntimeId(problem.id, versionId);
      const result = await deleteSessionSandbox(runtimeId);
      results.push({ versionId, ...result });
    } catch (error) {
      console.warn(`Failed to delete prepared runtime for ${problem.id}:${versionId}`, error);
      results.push({ versionId, deleted: false, error: error.message || 'Runtime cleanup failed' });
    }
  }

  return results;
}

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    requireAdmin(req);
    const problemId = String(req.body?.problemId || req.body?.id || req.query?.problemId || '').trim();
    if (!isValidProblemId(problemId)) return res.status(400).json({ error: 'A valid problemId is required' });

    const admin = getFirebaseAdmin();
    const ref = admin.database().ref(`problems/${problemId}`);
    const snapshot = await ref.once('value');
    const problem = snapshot.val();
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    const runtimeCleanup = await cleanupPreparedRuntimes({ ...problem, id: problem.id || problemId });
    await ref.remove();

    res.status(200).json({
      success: true,
      problemId,
      runtimeCleanup
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to delete problem');
  }
};
