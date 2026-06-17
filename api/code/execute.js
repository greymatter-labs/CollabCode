const getFirebaseAdmin = require('../../lib/firebase-admin');
const { runProject } = require('../../lib/blaxel-runner');
const { getProblemVersion, inferLanguage, normalizePath } = require('../../lib/problems');

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
    hiddenTests: details.hiddenTests === true,
    runById: body?.runById || null,
    runByName: getRunnerName(body),
    updatedAt: Date.now()
  };
}

function getDisplayOutput(result) {
  const output = String(result?.output || '').trim();
  if (output) return output;

  const stdout = String(result?.stdout || '').trim();
  const stderr = String(result?.stderr || '').trim();
  return [stdout, stderr].filter(Boolean).join('\n');
}

function buildProblemRunProject(body, sessionData, problemVersion) {
  const requestFiles = Array.isArray(body?.files) ? body.files : [];
  const filesByPath = new Map();

  requestFiles.forEach((file, index) => {
    const path = normalizePath(file?.path || file?.name || `file-${index}.txt`);
    if (!path) return;
    filesByPath.set(path, {
      id: String(file?.id || path.replace(/[^A-Za-z0-9_-]/g, '_')).slice(0, 100),
      path,
      content: String(file?.content || ''),
      language: String(file?.language || inferLanguage(path, problemVersion.defaultLanguage)),
      role: String(file?.role || 'candidate'),
      readonly: file?.readonly === true
    });
  });

  (problemVersion?.files || [])
    .filter(file => file.visibility === 'hidden')
    .forEach((file) => {
      const path = normalizePath(file.path);
      if (!path || filesByPath.has(path)) return;
      filesByPath.set(path, {
        id: String(file.id || path.replace(/[^A-Za-z0-9_-]/g, '_')).slice(0, 100),
        path,
        content: String(file.content || ''),
        language: String(file.language || inferLanguage(path, problemVersion.defaultLanguage)),
        role: String(file.role || 'hidden-test'),
        readonly: true
      });
    });

  const command = problemVersion?.testCommand || problemVersion?.starterCommand || '';
  const setup = Array.isArray(problemVersion?.setupCommands)
    ? problemVersion.setupCommands.map(String).filter(Boolean)
    : [];
  if (command || setup.length) {
    filesByPath.set('.collabcode/run.json', {
      id: 'collabcode_run_config',
      path: '.collabcode/run.json',
      content: JSON.stringify({ command, setup }, null, 2),
      language: 'json',
      role: 'config',
      readonly: true
    });
  }

  const files = Array.from(filesByPath.values());
  const entryPath = normalizePath(body?.entryPath || problemVersion?.entryPath) || files[0]?.path || 'main.js';
  return {
    files,
    entryPath,
    language: inferLanguage(entryPath, body?.language || problemVersion?.defaultLanguage),
    command,
    hiddenTests: !!problemVersion?.testCommand
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

    let runInput = {
      sessionId,
      language: req.body?.language,
      code: req.body?.code,
      files: req.body?.files,
      entryPath: req.body?.entryPath,
      stdin: req.body?.stdin,
      timeoutSec: req.body?.timeoutSec
    };

    let hiddenTests = false;
    const problemId = sessionData?.problem?.problemId;
    const versionId = sessionData?.problem?.versionId;
    if (problemId && versionId) {
      const problemSnapshot = await admin.database().ref(`problems/${problemId}`).once('value');
      const problem = problemSnapshot.val();
      if (problem) {
        const version = getProblemVersion(problem, versionId);
        const project = buildProblemRunProject(req.body, sessionData, version);
        hiddenTests = project.hiddenTests;
        runInput = {
          ...runInput,
          language: project.language,
          files: project.files,
          entryPath: project.entryPath
        };
      }
    }

    const result = await runProject(runInput);

    const rawOutput = getDisplayOutput(result);
    const output = result.success
      ? rawOutput
      : rawOutput || result.error || 'Execution failed';
    const record = buildRunRecord(result.success ? 'success' : 'error', req.body, {
      language: req.body?.language,
      entryPath: req.body?.entryPath,
      output,
      error: result.success ? '' : output,
      runtimeFileCount: Array.isArray(result.runtimeFiles) ? result.runtimeFiles.length : 0,
      executionTime: result.executionTime,
      command: result.command,
      sandboxName: result.sandboxName,
      hiddenTests
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
      sandboxName: result.sandboxName,
      hiddenTests
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
