const crypto = require('crypto');

const MAX_PROBLEM_FILES = 100;
const MAX_FILE_BYTES = 250000;
const MAX_TOTAL_BYTES = 800000;
const VISIBILITIES = new Set(['editable', 'readonly', 'hidden']);

function now() {
  return Date.now();
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
    if (segment === '..' || /[\x00-\x1f]/.test(segment)) return '';
    parts.push(segment);
  }
  return parts.join('/');
}

function normalizeFolderPath(value) {
  return normalizePath(String(value || '').replace(/\/+$/, ''));
}

function inferLanguage(path, fallback) {
  const requested = String(fallback || '').trim().toLowerCase();
  if (requested) return requested;

  const extension = String(path || '').split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css',
    txt: 'text'
  };
  return map[extension] || 'text';
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `problem-${Date.now()}`;
}

function makeProblemId(title) {
  return `${slugify(title)}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeVisibility(rawFile) {
  if (rawFile?.hidden === true) return 'hidden';
  if (rawFile?.readonly === true || rawFile?.readOnly === true) return 'readonly';
  const value = String(rawFile?.visibility || '').trim().toLowerCase();
  return VISIBILITIES.has(value) ? value : 'editable';
}

function normalizeRole(rawFile, visibility) {
  const role = String(rawFile?.role || '').trim().toLowerCase();
  if (role) return role.slice(0, 40);
  if (visibility === 'hidden') return 'hidden-test';
  if (visibility === 'readonly') return 'support';
  return 'starter';
}

function safeFileId(value, path, index) {
  const raw = String(value || path || `file_${index}`)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return raw || `file_${index}`;
}

function normalizeFiles(inputFiles, defaultLanguage) {
  const rawFiles = Array.isArray(inputFiles) ? inputFiles : [];
  const files = [];
  const seenPaths = new Set();
  const seenIds = new Set();
  let totalBytes = 0;

  rawFiles.slice(0, MAX_PROBLEM_FILES).forEach((rawFile, index) => {
    const path = normalizePath(rawFile?.path || rawFile?.name);
    if (!path || seenPaths.has(path)) return;

    const content = String(rawFile?.content || '');
    const fileBytes = Buffer.byteLength(content, 'utf8');
    if (fileBytes > MAX_FILE_BYTES) return;
    totalBytes += fileBytes;
    if (totalBytes > MAX_TOTAL_BYTES) return;

    const visibility = normalizeVisibility(rawFile);
    let id = safeFileId(rawFile?.id, path, index);
    if (seenIds.has(id)) id = `${id}_${index}`;

    seenPaths.add(path);
    seenIds.add(id);
    files.push({
      id,
      path,
      content,
      language: inferLanguage(path, rawFile?.language || defaultLanguage),
      visibility,
      role: normalizeRole(rawFile, visibility)
    });
  });

  if (!files.length) {
    files.push({
      id: 'main',
      path: defaultLanguage === 'python' ? 'main.py' : defaultLanguage === 'typescript' ? 'main.ts' : 'main.js',
      content: '',
      language: defaultLanguage || 'javascript',
      visibility: 'editable',
      role: 'starter'
    });
  }

  return files;
}

function normalizeFolders(inputFolders, files) {
  const folders = Array.isArray(inputFolders) ? inputFolders : [];
  const filePaths = new Set(files.map(file => file.path));
  const seen = new Set();

  return folders
    .map((rawFolder, index) => {
      const path = normalizeFolderPath(typeof rawFolder === 'string' ? rawFolder : rawFolder?.path || rawFolder?.name);
      if (!path || filePaths.has(path) || seen.has(path)) return null;
      seen.add(path);
      return {
        id: safeFileId(typeof rawFolder === 'object' ? rawFolder?.id : '', path, index),
        path
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PROBLEM_FILES);
}

function selectEntry(files, requestedPath, requestedId) {
  const byPath = normalizePath(requestedPath);
  const found = files.find(file => file.id === requestedId || file.path === byPath);
  const visible = files.find(file => file.visibility !== 'hidden');
  return found || visible || files[0];
}

function normalizeDraft(input, existing, actorEmail) {
  const timestamp = now();
  const title = String(input?.title || existing?.title || 'Untitled Problem').trim().slice(0, 120) || 'Untitled Problem';
  const defaultLanguage = inferLanguage('', input?.defaultLanguage || existing?.defaultLanguage || 'javascript');
  const files = normalizeFiles(input?.files || input?.draft?.files, defaultLanguage);
  const folders = normalizeFolders(input?.folders || input?.draft?.folders, files);
  const entry = selectEntry(files, input?.entryPath || input?.draft?.entryPath, input?.entryFileId || input?.draft?.entryFileId);
  const prompt = String(input?.prompt || input?.description || input?.draft?.prompt || '').slice(0, 30000);
  const starterCommand = String(input?.starterCommand || input?.runCommand || input?.draft?.starterCommand || '').trim().slice(0, 1000);
  const testCommand = String(input?.testCommand || input?.draft?.testCommand || '').trim().slice(0, 1000);
  const id = String(input?.id || existing?.id || makeProblemId(title))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return {
    id,
    slug: existing?.slug || slugify(title),
    title,
    status: existing?.status || 'draft',
    difficulty: String(input?.difficulty || existing?.difficulty || '').trim().slice(0, 40),
    tags: normalizeTags(input?.tags || existing?.tags),
    languages: normalizeTags(input?.languages || defaultLanguage),
    defaultLanguage,
    prompt,
    entryPath: entry.path,
    entryFileId: entry.id,
    starterCommand,
    testCommand,
    createdAt: existing?.createdAt || timestamp,
    createdBy: existing?.createdBy || actorEmail || null,
    updatedAt: timestamp,
    updatedBy: actorEmail || null,
    latestVersionId: existing?.latestVersionId || null,
    versions: existing?.versions || {},
    runtime: existing?.runtime || {},
    draft: {
      title,
      difficulty: String(input?.difficulty || existing?.difficulty || '').trim().slice(0, 40),
      tags: normalizeTags(input?.tags || existing?.tags),
      languages: normalizeTags(input?.languages || defaultLanguage),
      defaultLanguage,
      prompt,
      entryPath: entry.path,
      entryFileId: entry.id,
      starterCommand,
      testCommand,
      folders,
      files,
      validation: existing?.draft?.validation || {},
      updatedAt: timestamp,
      updatedBy: actorEmail || null
    }
  };
}

function makeVersionId(record) {
  const count = Object.keys(record?.versions || {}).length + 1;
  return `v${String(count).padStart(3, '0')}`;
}

function publishDraft(record, actorEmail) {
  if (!record?.draft) {
    const error = new Error('No draft is available to publish');
    error.statusCode = 400;
    throw error;
  }

  const timestamp = now();
  const versionId = makeVersionId(record);
  const version = {
    ...record.draft,
    versionId,
    frozen: true,
    publishedAt: timestamp,
    publishedBy: actorEmail || null
  };

  return {
    ...record,
    status: 'published',
    latestVersionId: versionId,
    updatedAt: timestamp,
    updatedBy: actorEmail || null,
    versions: {
      ...(record.versions || {}),
      [versionId]: version
    }
  };
}

function getProblemVersion(record, versionId) {
  const id = versionId || record?.latestVersionId;
  const version = id ? record?.versions?.[id] : null;
  if (!version) {
    const error = new Error('Published problem version not found');
    error.statusCode = 404;
    throw error;
  }
  return version;
}

function buildProblemSummary(record) {
  const latest = record?.latestVersionId ? record?.versions?.[record.latestVersionId] : null;
  const draft = record?.draft || {};
  return {
    id: record?.id,
    title: record?.title || draft.title || 'Untitled Problem',
    status: record?.status || 'draft',
    difficulty: record?.difficulty || draft.difficulty || '',
    tags: record?.tags || draft.tags || [],
    languages: record?.languages || draft.languages || [],
    entryPath: record?.entryPath || draft.entryPath || '',
    latestVersionId: record?.latestVersionId || null,
    latestPublishedAt: latest?.publishedAt || null,
    updatedAt: record?.updatedAt || draft.updatedAt || 0,
    runtime: record?.runtime || {}
  };
}

function buildSessionTemplateFromVersion(record, version) {
  const visibleFiles = (version?.files || []).filter(file => file.visibility !== 'hidden');
  if (!visibleFiles.length) {
    const error = new Error('Problem has no candidate-visible files');
    error.statusCode = 400;
    throw error;
  }

  const visibleEntry = visibleFiles.find(file => file.id === version.entryFileId || file.path === version.entryPath) || visibleFiles[0];
  const visibleFolderPaths = new Set();
  visibleFiles.forEach((file) => {
    const parts = String(file.path || '').split('/').filter(Boolean);
    parts.pop();
    let current = '';
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      visibleFolderPaths.add(current);
    });
  });

  return {
    problemId: record.id,
    problemTitle: record.title || version.title,
    problemVersionId: version.versionId,
    title: record.title || version.title,
    prompt: version.prompt || '',
    entryFileId: visibleEntry.id,
    entryPath: visibleEntry.path,
    folders: (version.folders || []).filter(folder => visibleFolderPaths.has(normalizeFolderPath(folder?.path || folder?.name || folder))),
    files: visibleFiles.map(file => ({
      id: file.id,
      path: file.path,
      content: file.content || '',
      language: file.language || inferLanguage(file.path, version.defaultLanguage),
      role: file.role || 'starter',
      readonly: file.visibility === 'readonly',
      mutable: file.visibility === 'editable',
      entry: file.id === visibleEntry.id
    }))
  };
}

function addRunConfig(files, command) {
  if (!command) return files;
  const withoutConfig = files.filter(file => file.path !== '.collabcode/run.json');
  return withoutConfig.concat({
    id: 'collabcode_run_config',
    path: '.collabcode/run.json',
    content: JSON.stringify({ command }, null, 2),
    language: 'json',
    role: 'config',
    visibility: 'hidden'
  });
}

function buildValidationProject(record, source, mode) {
  const selectedMode = String(mode || 'starter').toLowerCase();
  const includeHidden = selectedMode !== 'starter';
  const files = (source?.files || [])
    .filter(file => includeHidden || file.visibility !== 'hidden')
    .map(file => ({
      id: file.id,
      path: file.path,
      content: file.content || '',
      language: file.language || inferLanguage(file.path, source.defaultLanguage),
      role: file.role || 'starter',
      readonly: file.visibility !== 'editable'
    }));

  if (selectedMode === 'tests' && !source?.testCommand) {
    const error = new Error('Add a hidden test command before running hidden tests');
    error.statusCode = 400;
    throw error;
  }

  const command = selectedMode === 'tests' ? source?.testCommand : source?.starterCommand;
  const finalFiles = addRunConfig(files, command);
  const entryFile = finalFiles.find(file => file.path === source?.entryPath) || finalFiles[0];

  if (!entryFile) {
    const error = new Error('No files are available to run');
    error.statusCode = 400;
    throw error;
  }

  return {
    files: finalFiles,
    entryPath: entryFile.path,
    language: inferLanguage(entryFile.path, source?.defaultLanguage),
    sessionId: buildProblemRunId(record.id, source?.versionId || 'draft', selectedMode),
    mode: selectedMode
  };
}

function buildProblemRunId(problemId, versionId, mode) {
  const hash = crypto
    .createHash('sha1')
    .update(`${problemId}:${versionId || 'draft'}:${mode || 'run'}`)
    .digest('hex')
    .slice(0, 10);
  return `pv-${slugify(problemId).slice(0, 12)}-${hash}-${String(mode || 'run').slice(0, 8)}`;
}

function buildPreparedRuntimeId(problemId, versionId) {
  const hash = crypto
    .createHash('sha1')
    .update(`${problemId}:${versionId || 'draft'}`)
    .digest('hex')
    .slice(0, 10);
  const slug = slugify(problemId).slice(0, 12);
  return `pr-${slug}-${String(versionId || 'draft').slice(0, 8)}-${hash}`;
}

module.exports = {
  buildPreparedRuntimeId,
  buildProblemSummary,
  buildSessionTemplateFromVersion,
  buildValidationProject,
  getProblemVersion,
  inferLanguage,
  normalizeDraft,
  normalizePath,
  publishDraft
};
