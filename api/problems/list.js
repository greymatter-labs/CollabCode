/**
 * Vercel Serverless Function - List Problems
 * /api/problems/list
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildProblemSummary } = require('../../lib/problems');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireAdmin(req);
    const admin = getFirebaseAdmin();
    const snapshot = await admin.database().ref('problems').once('value');
    const problems = Object.values(snapshot.val() || {})
      .map(buildProblemSummary)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    res.status(200).json({ success: true, problems });
  } catch (error) {
    sendApiError(res, error, 'Failed to list problems');
  }
};
