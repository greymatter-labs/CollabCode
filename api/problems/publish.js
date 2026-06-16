/**
 * Vercel Serverless Function - Publish Problem
 * /api/problems/publish
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildProblemSummary, publishDraft } = require('../../lib/problems');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const decoded = requireAdmin(req);
    const problemId = String(req.body?.problemId || req.body?.id || '').trim();
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const admin = getFirebaseAdmin();
    const ref = admin.database().ref(`problems/${problemId}`);
    const snapshot = await ref.once('value');
    const existing = snapshot.val();
    if (!existing) return res.status(404).json({ error: 'Problem not found' });

    const problem = publishDraft(existing, decoded.email);
    await ref.set(problem);

    res.status(200).json({
      success: true,
      problem,
      summary: buildProblemSummary(problem),
      version: problem.versions[problem.latestVersionId]
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to publish problem');
  }
};
