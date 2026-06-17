const crypto = require('crypto');
const { SandboxInstance } = require('@blaxel/core');

const PROJECT_ROOT = '/workspace/project';
const META_PATH = '/workspace/.collabcode-meta.json';
const DEFAULT_IMAGE = 'blaxel/base-image:latest';
const DEFAULT_PYTHON_IMAGE = 'blaxel/py-app:latest';
const DEFAULT_REGION = 'us-pdx-1';
const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_TTL = '2h';
const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 500000;
const MAX_RUNTIME_FILES = 30;
const MAX_RUNTIME_BYTES = 200000;

function secondsToMs(value, fallbackSeconds) {
  const seconds = Number(value || fallbackSeconds);
  return Math.max(1, seconds) * 1000;
}

function normalizeSessionId(sessionId) {
  return String(sessionId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39);
}

function getSandboxName(sessionId) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) throw new Error('A sessionId is required for Blaxel execution');
  return `collabcode-${normalized}`;
}

function normalizePath(value) {
  const raw = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  const parts = [];
  for (const part of raw.split('/')) {
    const segment = part.trim();
    if (!segment || segment === '.') continue;
    if (segment === '..') return '';
    if (/[\x00-\x1f]/.test(segment)) return '';
    parts.push(segment);
  }
  return parts.join('/');
}

function normalizeLanguage(language, entryPath) {
  const selected = String(language || '').toLowerCase();
  if (selected) return selected;
  if (/\.tsx?$/i.test(entryPath)) return 'typescript';
  if (/\.py$/i.test(entryPath)) return 'python';
  return 'javascript';
}

function normalizeProjectFiles(inputFiles, code, entryPath, language) {
  const rawFiles = Array.isArray(inputFiles) && inputFiles.length
    ? inputFiles
    : [{ id: 'main', path: entryPath || 'main.js', content: code || '', language }];

  const files = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const [index, rawFile] of rawFiles.slice(0, MAX_FILES).entries()) {
    const path = normalizePath(rawFile?.path || rawFile?.name || `file-${index}.txt`);
    if (!path || seen.has(path)) continue;

    const content = String(rawFile?.content || '');
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Project is too large for one run (max ${MAX_TOTAL_BYTES} bytes)`);
    }

    seen.add(path);
    files.push({
      id: String(rawFile?.id || path.replace(/[^A-Za-z0-9_-]/g, '_')).slice(0, 120),
      path,
      content,
      language: String(rawFile?.language || normalizeLanguage(language, path)),
      role: String(rawFile?.role || 'solution'),
      readonly: rawFile?.readonly === true
    });
  }

  return files;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function hashForFiles(files, names) {
  const hash = crypto.createHash('sha256');
  names.forEach((name) => {
    const file = files.find(candidate => candidate.path === name);
    if (!file) return;
    hash.update(name);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  });
  return hash.digest('hex');
}

function getDependencyFiles(files) {
  const names = [
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'requirements.txt',
    'pyproject.toml'
  ];
  return names.filter(name => files.some(file => file.path === name));
}

function getCustomConfig(files) {
  const configFile = files.find(file => file.path === '.collabcode/run.json');
  if (!configFile) return {};
  const config = readJson(configFile.content, {});
  return config && typeof config === 'object' ? config : {};
}

function getRunCommand(language, entryPath, files, customConfig) {
  if (customConfig.command) return String(customConfig.command);

  const packageJson = files.find(file => file.path === 'package.json');
  if (packageJson) {
    const parsed = readJson(packageJson.content, null);
    const collabCommand = parsed?.collabcode?.run;
    if (typeof collabCommand === 'string' && collabCommand.trim()) return collabCommand.trim();
  }

  if (language === 'python' || /\.py$/i.test(entryPath)) {
    return `python3 ${shellQuote(entryPath)}`;
  }

  if (language === 'typescript' || /\.tsx?$/i.test(entryPath)) {
    return `npx --yes tsx ${shellQuote(entryPath)}`;
  }

  if (language === 'javascript' || /\.m?js$/i.test(entryPath) || /\.cjs$/i.test(entryPath)) {
    return `node ${shellQuote(entryPath)}`;
  }

  throw new Error(`Language '${language}' does not have a Blaxel runner yet. Add .collabcode/run.json with a command.`);
}

function getInstallCommands(files, customConfig) {
  if (Array.isArray(customConfig.setup)) return customConfig.setup.map(String).filter(Boolean);
  if (typeof customConfig.setup === 'string' && customConfig.setup.trim()) return [customConfig.setup.trim()];

  const paths = new Set(files.map(file => file.path));
  const commands = [];

  if (paths.has('package.json')) {
    if (paths.has('pnpm-lock.yaml')) {
      commands.push('corepack enable && pnpm install --store-dir /workspace/.pnpm-store --prefer-offline');
    } else if (paths.has('yarn.lock')) {
      commands.push('corepack enable && yarn install --cache-folder /workspace/.yarn-cache');
    } else if (paths.has('package-lock.json') || paths.has('npm-shrinkwrap.json')) {
      commands.push('npm ci --cache /workspace/.npm-cache --prefer-offline --no-audit --fund=false');
    } else {
      commands.push('npm install --cache /workspace/.npm-cache --prefer-offline --no-audit --fund=false');
    }
  }

  if (paths.has('requirements.txt')) {
    commands.push('python3 -m pip install --user --cache-dir /workspace/.pip-cache -r requirements.txt');
  } else if (paths.has('pyproject.toml')) {
    commands.push('python3 -m pip install --user --cache-dir /workspace/.pip-cache .');
  }

  return commands;
}

async function ignoreNotFound(promise) {
  try {
    return await promise;
  } catch (error) {
    if (/not found|no such file|404/i.test(error.message)) return null;
    return null;
  }
}

function getSandboxImage(customConfig, language, entryPath) {
  if (customConfig.image) return String(customConfig.image);
  if (process.env.BL_SANDBOX_IMAGE) return String(process.env.BL_SANDBOX_IMAGE);
  if (language === 'python' || /\.py$/i.test(entryPath)) return DEFAULT_PYTHON_IMAGE;
  return DEFAULT_IMAGE;
}

async function ensureSandbox(sessionId, customConfig, language, entryPath) {
  if (!process.env.BL_WORKSPACE || !process.env.BL_API_KEY) {
    throw new Error('Blaxel is not configured. Set BL_WORKSPACE and BL_API_KEY.');
  }

  return SandboxInstance.createIfNotExists({
    name: getSandboxName(sessionId),
    image: getSandboxImage(customConfig, language, entryPath),
    memory: Number(customConfig.memoryMb || process.env.BL_SANDBOX_MEMORY_MB || DEFAULT_MEMORY_MB),
    region: String(customConfig.region || process.env.BL_REGION || DEFAULT_REGION),
    ttl: String(customConfig.ttl || process.env.BL_SANDBOX_TTL || DEFAULT_TTL),
    envs: [
      { name: 'SANDBOX_DISABLE_PROCESS_LOGGING', value: 'true' }
    ],
    labels: {
      app: 'collabcode',
      session: normalizeSessionId(sessionId)
    }
  });
}

async function readMetadata(sandbox) {
  const content = await ignoreNotFound(sandbox.fs.read(META_PATH));
  return content ? readJson(content, {}) : {};
}

async function writeMetadata(sandbox, metadata) {
  await sandbox.fs.write(META_PATH, JSON.stringify(metadata, null, 2));
}

async function execChecked(sandbox, options) {
  const started = Date.now();
  const result = await sandbox.process.exec({
    waitForCompletion: true,
    timeout: secondsToMs(60, 60),
    ...options
  });

  if (result.exitCode !== 0) {
    const output = [result.stdout, result.stderr, result.logs].filter(Boolean).join('\n').trim();
    const message = output || `Command failed with exit code ${result.exitCode}`;
    const error = new Error(message);
    error.result = result;
    throw error;
  }

  return {
    ...result,
    executionTime: Date.now() - started
  };
}

async function syncProjectFiles(sandbox, files, metadata) {
  await execChecked(sandbox, {
    name: 'prepare-workspace',
    command: `mkdir -p ${shellQuote(PROJECT_ROOT)} /workspace/.npm-cache /workspace/.pip-cache /workspace/.pnpm-store /workspace/.yarn-cache`,
    timeout: secondsToMs(30, 30)
  });

  const nextPaths = new Set(files.map(file => file.path));
  const previousPaths = Array.isArray(metadata.paths) ? metadata.paths : [];
  for (const oldPath of previousPaths) {
    if (!nextPaths.has(oldPath)) {
      await ignoreNotFound(sandbox.fs.rm(`${PROJECT_ROOT}/${oldPath}`, false));
    }
  }

  await sandbox.fs.writeTree(
    files.map(file => ({ path: file.path, content: file.content })),
    PROJECT_ROOT
  );
}

async function maybeInstallDependencies(sandbox, files, metadata, customConfig) {
  const dependencyFiles = getDependencyFiles(files);
  const setupCommands = getInstallCommands(files, customConfig);
  if (!dependencyFiles.length && !setupCommands.length) {
    return { dependencySignature: '', installed: false, output: '' };
  }

  const dependencySignature = hashForFiles(files, dependencyFiles.concat(['.collabcode/run.json']));
  if (metadata.dependencySignature === dependencySignature) {
    return { dependencySignature, installed: false, output: 'Dependencies already up to date.' };
  }

  const outputs = [];
  for (const [index, command] of setupCommands.entries()) {
    const result = await execChecked(sandbox, {
      name: `setup-${Date.now()}-${index}`,
      command,
      workingDir: PROJECT_ROOT,
      timeout: secondsToMs(customConfig.setupTimeoutSec || process.env.BL_SETUP_TIMEOUT_SEC, 90)
    });
    outputs.push([result.stdout, result.stderr].filter(Boolean).join('\n').trim());
  }

  return {
    dependencySignature,
    installed: true,
    output: outputs.filter(Boolean).join('\n')
  };
}

async function writeRunFiles(sandbox, stdin, runCommand) {
  const script = [
    '#!/bin/sh',
    'export PATH="$HOME/.local/bin:$PATH"',
    'export PYTHONPATH="$PWD:${PYTHONPATH:-}"',
    runCommand + ' < .collabcode-stdin.txt'
  ].join('\n');

  await sandbox.fs.write(`${PROJECT_ROOT}/.collabcode-stdin.txt`, String(stdin || ''));
  await sandbox.fs.write(`${PROJECT_ROOT}/.collabcode-run.sh`, script);
}

async function collectRuntimeFiles(sandbox, sourcePaths) {
  const current = new Set(sourcePaths);
  const response = await sandbox.fs.find(PROJECT_ROOT, {
    type: 'file',
    maxResults: 300,
    excludeDirs: ['node_modules', '.git', '__pycache__', '.venv', '.next', 'dist', 'build', 'target']
  });

  const runtimeFiles = [];
  let totalBytes = 0;
  for (const match of response.matches || []) {
    const absolutePath = String(match.path || '');
    const relativePath = normalizePath(absolutePath.replace(PROJECT_ROOT, ''));
    if (!relativePath || current.has(relativePath)) continue;
    if (relativePath.startsWith('.collabcode-')) continue;
    if (relativePath === '.collabcode/run.json') continue;

    let content;
    try {
      content = await sandbox.fs.read(`${PROJECT_ROOT}/${relativePath}`);
    } catch {
      continue;
    }

    if (content.includes('\u0000')) continue;
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > 50000 || totalBytes + byteLength > MAX_RUNTIME_BYTES) continue;

    totalBytes += byteLength;
    runtimeFiles.push({
      id: `runtime_${relativePath.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70)}`,
      path: relativePath,
      content,
      role: 'runtime'
    });

    if (runtimeFiles.length >= MAX_RUNTIME_FILES) break;
  }
  return runtimeFiles;
}

async function collectChangedSourceFiles(sandbox, files) {
  const changedFiles = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || path === '.collabcode/run.json') continue;

    let content;
    try {
      content = await sandbox.fs.read(`${PROJECT_ROOT}/${path}`);
    } catch {
      continue;
    }

    if (String(content) === String(file.content || '')) continue;
    if (String(content).includes('\u0000')) continue;

    changedFiles.push({
      id: file.id,
      path,
      content: String(content),
      language: file.language,
      role: file.role
    });
  }
  return changedFiles;
}

async function runProject(options) {
  const files = normalizeProjectFiles(options.files, options.code, options.entryPath, options.language);
  if (!files.length) throw new Error('No files were provided for execution');

  const entryPath = normalizePath(options.entryPath) || files[0].path;
  if (!files.some(file => file.path === entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const language = normalizeLanguage(options.language, entryPath);
  const customConfig = getCustomConfig(files);
  const sandbox = await ensureSandbox(options.sessionId, customConfig, language, entryPath);
  const metadata = await readMetadata(sandbox);

  await syncProjectFiles(sandbox, files, metadata);
  const setup = await maybeInstallDependencies(sandbox, files, metadata, customConfig);
  const runCommand = getRunCommand(language, entryPath, files, customConfig);
  await writeRunFiles(sandbox, options.stdin, runCommand);

  const started = Date.now();
  const run = await sandbox.process.exec({
    name: `run-${Date.now()}`,
    command: 'sh .collabcode-run.sh',
    workingDir: PROJECT_ROOT,
    waitForCompletion: true,
    timeout: secondsToMs(customConfig.timeoutSec || options.timeoutSec || process.env.BL_RUN_TIMEOUT_SEC, 45)
  });
  const executionTime = Date.now() - started;
  const runtimeFiles = await collectRuntimeFiles(sandbox, files.map(file => file.path));
  const changedFiles = options.collectChangedFiles
    ? await collectChangedSourceFiles(sandbox, files)
    : [];

  await writeMetadata(sandbox, {
    paths: files.map(file => file.path),
    dependencySignature: setup.dependencySignature,
    updatedAt: Date.now()
  });

  const stdout = String(run.stdout || '');
  const stderr = String(run.stderr || '');
  const logs = String(run.logs || '');
  const output = [setup.installed ? setup.output : '', stdout, stderr && run.exitCode === 0 ? stderr : '']
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    success: run.exitCode === 0,
    output: output || (run.exitCode === 0 ? '' : stderr || logs),
    stdout,
    stderr,
    logs,
    error: run.exitCode === 0 ? '' : (stderr || stdout || logs || `Command failed with exit code ${run.exitCode}`),
    exitCode: run.exitCode,
    status: run.status,
    executionTime,
    runtimeFiles,
    changedFiles,
    provider: 'blaxel',
    sandboxName: getSandboxName(options.sessionId),
    command: runCommand,
    setupInstalled: setup.installed
  };
}

async function deleteSessionSandbox(sessionId) {
  const sandboxName = getSandboxName(sessionId);
  try {
    await SandboxInstance.delete(sandboxName);
    return { deleted: true, sandboxName };
  } catch (error) {
    if (/not found|404/i.test(error.message)) {
      return { deleted: false, sandboxName, reason: 'not-found' };
    }
    throw error;
  }
}

module.exports = {
  runProject,
  deleteSessionSandbox,
  getSandboxName,
  normalizePath,
  normalizeProjectFiles
};
