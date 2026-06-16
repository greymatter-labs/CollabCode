/**
 * Vercel Serverless Function - Get Problem
 * /api/problems/get?problemId=...
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');

module.exports = async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireAdmin(req);
    const problemId = String(req.query?.problemId || '').trim();
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const admin = getFirebaseAdmin();
    const snapshot = await admin.database().ref(`problems/${problemId}`).once('value');
    const problem = snapshot.val();
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    res.status(200).json({ success: true, problem });
  } catch (error) {
    sendApiError(res, error, 'Failed to load problem');
  }
};
