function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

function normalizeFolderPath(value) {
  return normalizePath(String(value || '').replace(/\/+$/, ''));
}

function inferLanguage(path) {
  const extension = String(path || '').split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'c_cpp',
    cc: 'c_cpp',
    cxx: 'c_cpp',
    c: 'c_cpp',
    h: 'c_cpp',
    hpp: 'c_cpp',
    cs: 'csharp',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css'
  };
  return map[extension] || 'text';
}

function normalizeProblemTemplate(template, timestamp) {
  const files = Array.isArray(template?.files) ? template.files : [];
  const folders = Array.isArray(template?.folders) ? template.folders : [];
  const workspaceFiles = {};
  const workspaceFolders = {};
  const fileSnapshots = {};
  let totalCharacters = 0;
  let entryFileId = null;

  files.slice(0, 80).forEach((rawFile, index) => {
    const path = normalizePath(rawFile?.path || rawFile?.name);
    if (!path) return;

    const content = String(rawFile?.content || '');
    totalCharacters += content.length;
    if (totalCharacters > 300000) return;

    const id = String(rawFile?.id || (index === 0 ? 'main' : `file_${index}`))
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80);
    const language = String(rawFile?.language || inferLanguage(path));
    const role = String(rawFile?.role || 'solution');

    if (!entryFileId || rawFile?.entry === true || rawFile?.id === template?.entryFileId || path === template?.entryPath) {
      entryFileId = id;
    }

    workspaceFiles[id] = {
      id,
      path,
      language,
      role,
      readonly: rawFile?.readonly === true,
      mutable: rawFile?.mutable !== false,
      origin: 'problem-template-copy',
      padPath: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    fileSnapshots[id] = {
      path,
      language,
      role,
      content,
      updatedAt: timestamp
    };
  });

  folders.slice(0, 80).forEach((rawFolder, index) => {
    const path = normalizeFolderPath(typeof rawFolder === 'string' ? rawFolder : rawFolder?.path || rawFolder?.name);
    if (!path) return;
    if (Object.values(workspaceFiles).some(file => file.path === path)) return;

    const id = String(rawFolder?.id || `folder_${index}`)
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80);
    workspaceFolders[id] = {
      id,
      path,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });

  const fileIds = Object.keys(workspaceFiles);
  if (!fileIds.length) return null;

  entryFileId = workspaceFiles[entryFileId] ? entryFileId : fileIds[0];
  return {
    workspace: {
      version: 1,
      source: {
        type: 'problem-template',
        problemId: template?.problemId || null,
        problemTitle: template?.problemTitle || template?.title || null,
        problemVersionId: template?.problemVersionId || null,
        copiedAt: timestamp
      },
      activeFileId: entryFileId,
      entryFileId,
      files: workspaceFiles,
      folders: workspaceFolders
    },
    fileSnapshots
  };
}

function removeRuntimeWorkspaceFiles(session, timestamp) {
  const workspace = session?.workspace || {};
  const files = { ...(workspace.files || {}) };
  const snapshots = { ...(session?.fileSnapshots || {}) };
  const removedIds = [];

  Object.entries(files).forEach(([fileId, file]) => {
    if (file?.role === 'runtime' || file?.origin === 'runtime') {
      removedIds.push(fileId);
      delete files[fileId];
      delete snapshots[fileId];
    }
  });

  return {
    removedIds,
    workspace: {
      ...workspace,
      files,
      updatedAt: timestamp
    },
    fileSnapshots: snapshots
  };
}

module.exports = {
  inferLanguage,
  normalizeProblemTemplate,
  normalizePath,
  removeRuntimeWorkspaceFiles
};
