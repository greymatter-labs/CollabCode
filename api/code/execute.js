const getFirebaseAdmin = require('../../lib/firebase-admin');
const { runProject } = require('../../lib/blaxel-runner');

const SESSION_ID_PATTERN = /^[A-Z0-9]{8}$/;
const RUN_LOCK_MS = 2 * 60 * 1000;

function normalizeSessionId(sessionId) {
  return String(sessionId || '').trim().toUpperCase();
}

function getRunnerName(body) {
  return String(body?.runByName || body?.runnerName || 'Interviewer').slice(0, 120);
}

function buildRunRecord(status, body, details = {}) {
  return {
    status,
    provider: 'blaxel',
    language: details.language || body?.language || null,
    entryPath: details.entryPath || body?.entryPath || null,
    output: details.output || '',
    error: details.error || '',
    runtimeFileCount: details.runtimeFileCount || 0,
    executionTime: details.executionTime || null,
    command: details.command || null,
    sandboxName: details.sandboxName || null,
    runById: body?.runById || null,
    runByName: getRunnerName(body),
    updatedAt: Date.now()
  };
}

async function acquireRunLock(sessionRef, runId, body) {
  const lockRef = sessionRef.child('runLock');
  const now = Date.now();
  const result = await lockRef.transaction((current) => {
    if (current?.expiresAt && current.expiresAt > now) return;
    return {
      runId,
      runById: body?.runById || null,
      runByName: getRunnerName(body),
      startedAt: now,
      expiresAt: now + RUN_LOCK_MS
    };
  });

  if (!result.committed) {
    const current = result.snapshot.val() || {};
    const runner = current.runByName ? ` by ${current.runByName}` : '';
    const error = new Error(`Another run is already in progress${runner}.`);
    error.statusCode = 409;
    throw error;
  }

  return async function releaseRunLock() {
    await lockRef.transaction((current) => {
      if (current?.runId === runId) return null;
      return current;
    });
  };
}

module.exports = async function handler(req, res) {
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

  const sessionId = normalizeSessionId(req.body?.sessionId);
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return res.status(400).json({ error: 'A valid sessionId is required for shared Blaxel execution' });
  }

  const admin = getFirebaseAdmin();
  const sessionRef = admin.database().ref(`sessions/${sessionId}`);
  const sessionSnapshot = await sessionRef.once('value');
  const sessionData = sessionSnapshot.val();
  if (!sessionData || sessionData.status === 'ended') {
    return res.status(404).json({ error: 'Session not found or already ended' });
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let releaseLock = null;

  try {
    releaseLock = await acquireRunLock(sessionRef, runId, req.body);
    await sessionRef.child('lastRun').set(buildRunRecord('running', req.body, {
      output: 'Running in Blaxel...'
    }));

    const result = await runProject({
      sessionId,
      language: req.body?.language,
      code: req.body?.code,
      files: req.body?.files,
      entryPath: req.body?.entryPath,
      stdin: req.body?.stdin,
      timeoutSec: req.body?.timeoutSec
    });

    const output = result.success
      ? result.output || '(No output)'
      : result.error || result.output || 'Execution failed';
    const record = buildRunRecord(result.success ? 'success' : 'error', req.body, {
      language: req.body?.language,
      entryPath: req.body?.entryPath,
      output,
      error: result.success ? '' : output,
      runtimeFileCount: Array.isArray(result.runtimeFiles) ? result.runtimeFiles.length : 0,
      executionTime: result.executionTime,
      command: result.command,
      sandboxName: result.sandboxName
    });
    await sessionRef.child('lastRun').set(record);

    return res.status(200).json({
      success: result.success,
      provider: 'blaxel',
      output,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.success ? '' : output,
      code: result.exitCode,
      status: result.status,
      executionTime: result.executionTime,
      runtimeFiles: result.runtimeFiles,
      command: result.command,
      sandboxName: result.sandboxName
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Execution failed';
    await sessionRef.child('lastRun').set(buildRunRecord('error', req.body, {
      output: message,
      error: message
    }));
    return res.status(statusCode).json({
      success: false,
      provider: 'blaxel',
      error: message,
      details: message
    });
  } finally {
    if (releaseLock) {
      await releaseLock().catch((error) => console.warn('Could not release run lock:', error));
    }
  }
};
