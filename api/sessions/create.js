/**
 * Vercel Serverless Function - Create Session
 * /api/sessions/create
 */

const getFirebaseAdmin = require('../../lib/firebase-admin');
const { requireAdmin, sendApiError, setCorsHeaders } = require('../../lib/api-auth');
const { buildSessionTemplateFromVersion, buildValidationProject, getProblemVersion, versionNeedsPrewarm } = require('../../lib/problems');
const { normalizeProblemTemplate } = require('../../lib/session-template');
const { runProject } = require('../../lib/blaxel-runner');

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

module.exports = async (req, res) => {
  // Enable CORS
  setCorsHeaders(res, 'POST, OPTIONS');

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
    const decoded = requireAdmin(req);

    // Create session
    const admin = getFirebaseAdmin();
    const sessionId = generateSecureSessionId();
    const timestamp = Date.now();

    let selectedProblem = null;
    let selectedVersion = null;
    let sessionTemplate = req.body?.problemTemplate || req.body?.workspaceTemplate;

    if (req.body?.problemId) {
      const problemSnapshot = await admin.database().ref(`problems/${req.body.problemId}`).once('value');
      selectedProblem = problemSnapshot.val();
      if (!selectedProblem) {
        return res.status(404).json({ error: 'Problem not found' });
      }
      selectedVersion = getProblemVersion(selectedProblem, req.body.versionId);
      sessionTemplate = buildSessionTemplateFromVersion(selectedProblem, selectedVersion);
    }

    const problemCopy = normalizeProblemTemplate(sessionTemplate, timestamp);
    const sessionPayload = {
      created: timestamp,
      createdBy: decoded.email,
      creatorId: decoded.userId,
      status: 'active'
    };

    if (problemCopy) {
      sessionPayload.workspace = problemCopy.workspace;
      sessionPayload.fileSnapshots = problemCopy.fileSnapshots;
      if (selectedProblem && selectedVersion) {
        sessionPayload.problem = {
          problemId: selectedProblem.id,
          title: selectedProblem.title,
          versionId: selectedVersion.versionId,
          copiedAt: timestamp
        };

        if (versionNeedsPrewarm(selectedVersion)) {
          const prewarmProject = buildValidationProject(selectedProblem, selectedVersion, 'command', {
            command: 'true',
            includeHidden: true
          });
          const prewarm = await runProject({
            ...prewarmProject,
            sessionId,
            timeoutSec: Number(process.env.BL_SETUP_TIMEOUT_SEC || 180)
          });
          if (!prewarm.success) {
            return res.status(400).json({
              error: prewarm.error || prewarm.output || 'Problem setup failed while preparing the session sandbox'
            });
          }
          sessionPayload.problem.setupPrewarmedAt = Date.now();
          sessionPayload.problem.setupSandboxName = prewarm.sandboxName;
        }
      }
    }

    // Save to Firebase
    await admin.database().ref(`sessions/${sessionId}`).set(sessionPayload);

    res.status(200).json({
      success: true,
      sessionId: sessionId,
      created: timestamp
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to create session');
  }
};
