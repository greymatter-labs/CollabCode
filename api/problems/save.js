/**
 * Vercel Serverless Function - Save Problem Draft
 * /api/problems/save
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildProblemSummary, normalizeDraft } = require('../../lib/problems');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const decoded = requireAdmin(req);
    const admin = getFirebaseAdmin();
    const requestedId = String(req.body?.id || '').trim();
    const existingSnapshot = requestedId
      ? await admin.database().ref(`problems/${requestedId}`).once('value')
      : null;
    const existing = existingSnapshot?.val() || null;
    const problem = normalizeDraft(req.body || {}, existing, decoded.email);

    await admin.database().ref(`problems/${problem.id}`).set(problem);

    res.status(200).json({
      success: true,
      problem,
      summary: buildProblemSummary(problem)
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to save problem');
  }
};
