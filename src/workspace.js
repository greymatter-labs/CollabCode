import { FileTree } from '@pierre/trees';

(function() {
  const WORKSPACE_VERSION = 1;
  const DEFAULT_FILE_ID = 'main';
  const MAX_FILES = 80;

  const extensionLanguage = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    py: 'python',
    java: 'java',
    c: 'c_cpp',
    cc: 'c_cpp',
    cpp: 'c_cpp',
    cxx: 'c_cpp',
    h: 'c_cpp',
    hpp: 'c_cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    r: 'r',
    pl: 'perl',
    lua: 'lua',
    hs: 'haskell',
    ex: 'elixir',
    exs: 'elixir',
    dart: 'dart',
    html: 'html',
    css: 'css',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    markdown: 'markdown'
  };

  const defaultPathByLanguage = {
    javascript: 'src/main.js',
    typescript: 'src/main.ts',
    python: 'main.py',
    java: 'Main.java',
    c_cpp: 'main.cpp',
    csharp: 'Program.cs',
    php: 'index.php',
    ruby: 'main.rb',
    go: 'main.go',
    rust: 'src/main.rs',
    swift: 'main.swift',
    kotlin: 'Main.kt',
    scala: 'Main.scala',
    r: 'main.r',
    perl: 'main.pl',
    lua: 'main.lua',
    haskell: 'Main.hs',
    elixir: 'main.exs',
    dart: 'main.dart',
    html: 'index.html',
    css: 'styles.css',
    sql: 'query.sql',
    json: 'data.json',
    yaml: 'config.yaml',
    xml: 'document.xml',
    markdown: 'README.md'
  };

  const state = {
    initialized: false,
    sessionRef: null,
    workspaceRef: null,
    snapshotsRef: null,
    options: {},
    workspace: null,
    snapshots: {},
    hiddenFiles: [],
    hiddenFilesKey: '',
    activeHiddenFileId: null,
    selectedPath: null,
    tree: null,
    treePathSignature: '',
    pendingInlineRenamePath: null,
    pendingActiveFileId: null,
    toolbarBound: false,
    treeActivationBound: false
  };

  function serverTimestamp() {
    return window.firebase?.database?.ServerValue?.TIMESTAMP || Date.now();
  }

  function basename(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function dirname(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  function getExtension(path) {
    const name = basename(path);
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
  }

  function getLanguageForPath(path, fallback = 'javascript') {
    return extensionLanguage[getExtension(path)] || fallback;
  }

  function getDefaultPath(language) {
    return defaultPathByLanguage[language] || `main.${language || 'txt'}`;
  }

  function normalizePath(value) {
    const raw = String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/');

    if (!raw) return '';

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

  function normalizeFolderPath(value) {
    return normalizePath(String(value || '').replace(/\/+$/, ''));
  }

  function toFolderTreePath(path) {
    const normalized = normalizeFolderPath(path);
    return normalized ? `${normalized}/` : '';
  }

  function fromTreePath(path) {
    const raw = String(path || '');
    return {
      isFolder: raw.endsWith('/'),
      path: normalizePath(raw)
    };
  }

  function createFileId(prefix = 'file') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitizeFileId(id, fallbackPrefix = 'file') {
    const clean = String(id || '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 80);
    return clean || createFileId(fallbackPrefix);
  }

  function getInitialLanguage() {
    return state.options.getCurrentLanguage?.() || 'javascript';
  }

  function defaultContentForNewFile(path, language) {
    if (language === 'json') return '{}\n';
    if (language === 'markdown') return `# ${basename(path).replace(/\.[^.]+$/, '')}\n`;
    if (language === 'html') return '<!doctype html>\n<html>\n  <body>\n  </body>\n</html>\n';
    if (language === 'css') return `/* ${path} */\n`;
    if (language === 'javascript' || language === 'typescript') return `// ${path}\n\n`;
    return '';
  }

  function getDefaultMainContent(language) {
    return state.options.getDefaultCode?.(language) || '// Welcome to Collaborative Code Editor!\n// Start coding here...';
  }

  function normalizeFileMetadata(raw, id) {
    const normalizedPath = normalizePath(raw?.path);
    if (!normalizedPath) return null;

    const fallbackLanguage = getLanguageForPath(normalizedPath, getInitialLanguage());
    return {
      id,
      path: normalizedPath,
      language: String(raw?.language || fallbackLanguage),
      role: String(raw?.role || 'solution'),
      readonly: raw?.readonly === true,
      mutable: raw?.mutable !== false,
      origin: String(raw?.origin || 'session'),
      padPath: null,
      createdAt: raw?.createdAt || null,
      updatedAt: raw?.updatedAt || null,
      updatedBy: raw?.updatedBy || null
    };
  }

  function normalizeHiddenFileMetadata(raw, index) {
    const normalizedPath = normalizePath(raw?.path || raw?.name);
    if (!normalizedPath) return null;

    const fallbackLanguage = getLanguageForPath(normalizedPath, getInitialLanguage());
    return {
      id: `hidden_${sanitizeFileId(raw?.id || normalizedPath || `file_${index}`)}`,
      path: normalizedPath,
      language: String(raw?.language || fallbackLanguage),
      role: 'hidden-test',
      readonly: true,
      mutable: false,
      origin: 'problem-hidden',
      visibility: 'hidden',
      hidden: true,
      candidateVisible: false,
      padPath: null,
      content: String(raw?.content || ''),
      updatedAt: raw?.updatedAt || null
    };
  }

  function normalizeFolderMetadata(raw, id) {
    const normalizedPath = normalizeFolderPath(raw?.path);
    if (!normalizedPath) return null;

    return {
      id,
      path: normalizedPath,
      createdAt: raw?.createdAt || null,
      updatedAt: raw?.updatedAt || null,
      updatedBy: raw?.updatedBy || null
    };
  }

  function normalizeWorkspace(raw) {
    const files = {};
    Object.entries(raw?.files || {}).forEach(([rawId, rawFile]) => {
      const id = sanitizeFileId(rawFile?.id || rawId);
      const file = normalizeFileMetadata(rawFile, id);
      if (file) files[id] = file;
    });

    const folders = {};
    Object.entries(raw?.folders || {}).forEach(([rawId, rawFolder]) => {
      const id = sanitizeFileId(rawFolder?.id || rawId, 'folder');
      const folder = normalizeFolderMetadata(rawFolder, id);
      if (folder) folders[id] = folder;
    });

    const fileIds = Object.keys(files);
    const firstFileId = fileIds[0] || null;
    const activeFileId = files[raw?.activeFileId] ? raw.activeFileId : firstFileId;
    const entryFileId = files[raw?.entryFileId] ? raw.entryFileId : activeFileId;

    return {
      version: raw?.version || WORKSPACE_VERSION,
      source: raw?.source || { type: 'adhoc' },
      activeFileId,
      entryFileId,
      files,
      folders
    };
  }

  function getFileList() {
    const files = state.workspace?.files || {};
    return Object.values(files).sort((left, right) => left.path.localeCompare(right.path));
  }

  function getHiddenFileList() {
    return state.options.currentUser?.isAdmin === true
      ? state.hiddenFiles.slice().sort((left, right) => left.path.localeCompare(right.path))
      : [];
  }

  function getHiddenFileByPath(path) {
    const normalized = normalizePath(path);
    return getHiddenFileList().find(file => file.path === normalized) || null;
  }

  function getHiddenFolderPaths() {
    const paths = new Set();
    getHiddenFileList().forEach(file => {
      const segments = file.path.split('/');
      segments.pop();
      let cursor = '';
      segments.forEach(segment => {
        cursor = cursor ? `${cursor}/${segment}` : segment;
        if (cursor) paths.add(cursor);
      });
    });
    return paths;
  }

  function hiddenFolderExists(path) {
    const normalized = normalizeFolderPath(path);
    return !!normalized && getHiddenFolderPaths().has(normalized);
  }

  function getActiveHiddenFile() {
    if (!state.activeHiddenFileId) return null;
    return getHiddenFileList().find(file => file.id === state.activeHiddenFileId) || null;
  }

  function getDisplayedFile() {
    return getActiveHiddenFile() || getActiveFile();
  }

  function getActiveFile() {
    if (!state.workspace?.activeFileId) return null;
    return state.workspace.files[state.workspace.activeFileId] || null;
  }

  function getEntryFile() {
    if (!state.workspace?.entryFileId) return getActiveFile();
    return state.workspace.files[state.workspace.entryFileId] || getActiveFile();
  }

  function getFileByPath(path) {
    const normalized = normalizePath(path);
    return getFileList().find(file => file.path === normalized) || null;
  }

  function getFolderList() {
    const folders = state.workspace?.folders || {};
    return Object.values(folders).sort((left, right) => left.path.localeCompare(right.path));
  }

  function getFolderByPath(path) {
    const normalized = normalizeFolderPath(path);
    return getFolderList().find(folder => folder.path === normalized) || null;
  }

  function hasFolderChildren(path) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return false;

    const prefix = `${normalized}/`;
    return getFileList().some(file => file.path.startsWith(prefix))
      || getFolderList().some(folder => folder.path !== normalized && folder.path.startsWith(prefix));
  }

  function folderExists(path) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return false;
    return !!getFolderByPath(normalized) || hasFolderChildren(normalized);
  }

  function getSnapshot(fileId) {
    return state.snapshots?.[fileId] || null;
  }

  function focusEditorSoon() {
    const focus = () => {
      if (typeof state.options.focusEditor === 'function') {
        state.options.focusEditor();
        return;
      }
      state.options.editor?.focus?.();
    };

    focus();
    setTimeout(focus, 80);
    setTimeout(focus, 300);
  }

  function getFileContent(file) {
    const snapshot = getSnapshot(file.id);
    if (typeof snapshot?.content === 'string') return snapshot.content;
    if (file.role === 'runtime') return '';
    return getDefaultMainContent(file.language);
  }

  function buildProjectSnapshot(activeContent) {
    const activeFile = getActiveFile();
    const entryFile = getEntryFile();
    const viewingHiddenFile = !!getActiveHiddenFile();

    const files = getFileList().map(file => {
      const content = !viewingHiddenFile && activeFile && activeFile.id === file.id && typeof activeContent === 'string'
        ? activeContent
        : getFileContent(file);
      return {
        id: file.id,
        path: file.path,
        language: file.language,
        role: file.role,
        readonly: file.readonly,
        content
      };
    });

    return {
      source: state.workspace?.source || { type: 'adhoc' },
      activeFileId: activeFile?.id || null,
      entryFileId: entryFile?.id || null,
      entryPath: entryFile?.path || activeFile?.path || null,
      entryLanguage: entryFile?.language || activeFile?.language || getInitialLanguage(),
      files
    };
  }

  async function ensureWorkspace(isNew) {
    const snapshot = await state.sessionRef.once('value');
    const sessionData = snapshot.val() || {};
    if (sessionData.workspace?.files && Object.keys(sessionData.workspace.files).length) {
      if (!sessionData.workspace.source) {
        await state.sessionRef.child('workspace/source').set({ type: 'adhoc' });
      }
      return;
    }

    const language = getInitialLanguage();
    const path = getDefaultPath(language);
    const createdAt = serverTimestamp();

    await state.sessionRef.update({
      [`workspace/version`]: WORKSPACE_VERSION,
      [`workspace/source`]: {
        type: 'adhoc',
        copiedAt: createdAt
      },
      [`workspace/activeFileId`]: DEFAULT_FILE_ID,
      [`workspace/entryFileId`]: DEFAULT_FILE_ID,
      [`workspace/files/${DEFAULT_FILE_ID}`]: {
        id: DEFAULT_FILE_ID,
        path,
        language,
        role: 'solution',
        readonly: false,
        mutable: true,
        origin: 'session',
        padPath: null,
        createdAt,
        updatedAt: createdAt
      },
      [`fileSnapshots/${DEFAULT_FILE_ID}`]: {
        path,
        language,
        role: 'solution',
        content: getDefaultMainContent(language),
        updatedAt: createdAt
      }
    });
  }

  function bindToolbar() {
    if (state.toolbarBound) return;
    state.toolbarBound = true;

    const newButton = document.getElementById('workspace-new-file');
    const newFolderButton = document.getElementById('workspace-new-folder');
    const renameButton = document.getElementById('workspace-rename-file');
    const deleteButton = document.getElementById('workspace-delete-file');
    const entryButton = document.getElementById('workspace-set-entry');

    newButton?.addEventListener('click', () => createFileInline());
    newFolderButton?.addEventListener('click', () => createFolderInline());
    renameButton?.addEventListener('click', () => {
      const selection = getSelectedTreeTarget();
      if (isReadOnlyTreeTarget(selection)) {
        alert('Hidden problem files are read-only in sessions. Edit them in the Problem Library.');
        renderTree(true);
        return;
      }

      if (!startInlineRenameForTarget(selection)) {
        alert('Select a file or folder to rename.');
      }
    });
    deleteButton?.addEventListener('click', deleteSelectedPath);
    entryButton?.addEventListener('click', setActiveAsEntry);
  }

  function getUniquePath(basePath) {
    const normalized = normalizePath(basePath);
    if (!treePathExists(normalized)) return normalized;

    const extension = getExtension(normalized);
    const withoutExtension = extension ? normalized.slice(0, -(extension.length + 1)) : normalized;
    for (let index = 2; index < 100; index += 1) {
      const candidate = extension ? `${withoutExtension}-${index}.${extension}` : `${withoutExtension}-${index}`;
      if (!treePathExists(candidate)) return candidate;
    }
    return createFileId('untitled');
  }

  function getUniqueFolderPath(basePath) {
    const normalized = normalizeFolderPath(basePath);
    if (!treePathExists(normalized)) return normalized;

    for (let index = 2; index < 100; index += 1) {
      const candidate = `${normalized}-${index}`;
      if (!treePathExists(candidate)) return candidate;
    }
    return createFileId('folder');
  }

  function isKnownTreePath(path) {
    const { isFolder, path: normalized } = fromTreePath(path);
    if (!normalized) return false;
    return isFolder
      ? folderExists(normalized) || hiddenFolderExists(normalized)
      : !!getFileByPath(normalized) || !!getHiddenFileByPath(normalized);
  }

  function getSelectedTreeTarget() {
    const selectedPath = state.selectedPath;
    if (selectedPath && isKnownTreePath(selectedPath)) {
      return fromTreePath(selectedPath);
    }

    const active = getActiveFile();
    if (active) {
      return { isFolder: false, path: active.path };
    }

    const folder = getFolderList()[0];
    if (folder) {
      return { isFolder: true, path: folder.path };
    }

    return { isFolder: false, path: '' };
  }

  function treePathExists(path) {
    const normalized = normalizePath(path);
    return !!normalized
      && (
        !!getFileByPath(normalized)
        || !!getHiddenFileByPath(normalized)
        || folderExists(normalized)
        || hiddenFolderExists(normalized)
      );
  }

  function getTargetTreePath(target) {
    const normalized = normalizePath(target?.path);
    if (!normalized) return '';
    return target?.isFolder ? toFolderTreePath(normalized) : normalized;
  }

  function getContextMenuTarget(item) {
    const target = fromTreePath(item?.path);
    return {
      isFolder: item?.kind === 'directory' || target.isFolder,
      path: target.path
    };
  }

  function isReadOnlyTreeTarget(target) {
    return !!getHiddenFileByPath(target.path)
      || (target.isFolder && hiddenFolderExists(target.path) && !folderExists(target.path));
  }

  function getBaseDirectoryForTarget(target = getSelectedTreeTarget()) {
    if (target?.isFolder) return target.path;
    if (target?.path) return dirname(target.path);

    const active = getActiveFile();
    return active ? dirname(active.path) : 'src';
  }

  function getDefaultFileNameForTarget(target = getSelectedTreeTarget()) {
    const referenceFile = !target?.isFolder
      ? getFileByPath(target.path) || getHiddenFileByPath(target.path)
      : getActiveFile();
    const referenceLanguage = referenceFile?.language || getInitialLanguage();
    const extension = getExtension(referenceFile?.path || getDefaultPath(referenceLanguage)) || 'txt';
    return `untitled.${extension}`;
  }

  function startInlineRename(path) {
    const treePath = String(path || '');
    if (!treePath || !state.tree || !isKnownTreePath(treePath)) return false;

    state.selectedPath = treePath;
    state.tree.getItem(treePath)?.select?.();
    state.tree.scrollToPath?.(treePath, { offset: 'nearest' });
    return state.tree.startRenaming?.(treePath) === true;
  }

  function startInlineRenameForTarget(target) {
    const treePath = getTargetTreePath(target);
    return startInlineRename(treePath);
  }

  function queueInlineRename(path) {
    const treePath = String(path || '');
    if (!treePath) return;
    state.pendingInlineRenamePath = treePath;
    window.setTimeout(flushPendingInlineRename, 0);
  }

  function flushPendingInlineRename() {
    const treePath = state.pendingInlineRenamePath;
    if (!treePath || !state.tree || !isKnownTreePath(treePath)) return;

    window.requestAnimationFrame(() => {
      if (state.pendingInlineRenamePath !== treePath) return;
      if (startInlineRename(treePath)) {
        state.pendingInlineRenamePath = null;
      }
    });
  }

  async function createFileInline(target = getSelectedTreeTarget()) {
    if (!state.sessionRef || getFileList().length >= MAX_FILES) {
      alert(`This session can have up to ${MAX_FILES} files.`);
      return;
    }

    const active = getActiveFile();
    const baseDirectory = getBaseDirectoryForTarget(target);
    const defaultFileName = getDefaultFileNameForTarget(target);
    const requestedPath = getUniquePath(`${baseDirectory ? `${baseDirectory}/` : ''}${defaultFileName}`);
    if (!requestedPath) return;

    if (treePathExists(requestedPath)) {
      alert('A file or folder already exists at that path.');
      return;
    }

    const id = createFileId();
    const language = getLanguageForPath(requestedPath, active?.language || getInitialLanguage());
    const createdAt = serverTimestamp();

    await state.options.beforeActiveFileChange?.();
    await state.sessionRef.update({
      [`workspace/files/${id}`]: {
        id,
        path: requestedPath,
        language,
        role: 'solution',
        readonly: false,
        mutable: true,
        origin: 'session',
        padPath: null,
        createdAt,
        updatedAt: createdAt
      },
      [`fileSnapshots/${id}`]: {
        path: requestedPath,
        language,
        role: 'solution',
        content: defaultContentForNewFile(requestedPath, language),
        updatedAt: createdAt
      },
      [`workspace/activeFileId`]: id
    });

    state.selectedPath = requestedPath;
    queueInlineRename(requestedPath);
  }

  async function createFolderInline(target = getSelectedTreeTarget()) {
    if (!state.sessionRef) return;

    const baseDirectory = getBaseDirectoryForTarget(target);
    const defaultPath = getUniqueFolderPath(`${baseDirectory ? `${baseDirectory}/` : ''}new-folder`);
    const requestedPath = normalizeFolderPath(defaultPath);
    if (!requestedPath) return;

    if (treePathExists(requestedPath)) {
      alert('A file or folder already exists at that path.');
      return;
    }

    const id = createFileId('folder');
    const createdAt = serverTimestamp();
    state.selectedPath = toFolderTreePath(requestedPath);

    await state.sessionRef.update({
      [`workspace/folders/${id}`]: {
        id,
        path: requestedPath,
        createdAt,
        updatedAt: createdAt
      }
    });

    queueInlineRename(toFolderTreePath(requestedPath));
  }

  async function renamePath(sourcePath, destinationPath) {
    const file = getFileByPath(sourcePath);
    const nextPath = normalizePath(destinationPath);
    if (!file || !nextPath || nextPath === file.path) return;

    const existing = getFileByPath(nextPath);
    if (existing && existing.id !== file.id) {
      alert('A file already exists at that path.');
      renderTree(true);
      return;
    }
    if (getHiddenFileByPath(nextPath)) {
      alert('A hidden problem file already exists at that path.');
      renderTree(true);
      return;
    }
    if (folderExists(nextPath) || hiddenFolderExists(nextPath)) {
      alert('A folder already exists at that path.');
      renderTree(true);
      return;
    }

    const language = getLanguageForPath(nextPath, file.language);
    const updatedAt = serverTimestamp();
    await state.options.beforeActiveFileChange?.();
    state.selectedPath = nextPath;
    await state.sessionRef.update({
      [`workspace/files/${file.id}/path`]: nextPath,
      [`workspace/files/${file.id}/language`]: language,
      [`workspace/files/${file.id}/updatedAt`]: updatedAt,
      [`fileSnapshots/${file.id}/path`]: nextPath,
      [`fileSnapshots/${file.id}/language`]: language,
      [`fileSnapshots/${file.id}/updatedAt`]: updatedAt
    });
  }

  async function renameFolderPath(sourcePath, destinationPath) {
    const source = normalizeFolderPath(sourcePath);
    const destination = normalizeFolderPath(destinationPath);
    if (!source || !destination || source === destination) return;

    if (destination.startsWith(`${source}/`)) {
      alert('A folder cannot be moved inside itself.');
      renderTree(true);
      return;
    }

    const sourceFolder = getFolderByPath(source);
    if (!sourceFolder && !hasFolderChildren(source)) {
      renderTree(true);
      return;
    }

    if (getFileByPath(destination) || getHiddenFileByPath(destination)) {
      alert('A file already exists at that path.');
      renderTree(true);
      return;
    }

    const existingFolder = getFolderByPath(destination);
    if ((existingFolder && existingFolder.id !== sourceFolder?.id) || hiddenFolderExists(destination)) {
      alert('A folder already exists at that path.');
      renderTree(true);
      return;
    }

    const sourcePrefix = `${source}/`;
    const destinationPrefix = `${destination}/`;
    const collidesWithFile = getFileList().some(file => {
      if (file.path.startsWith(sourcePrefix)) return false;
      return file.path === destination || file.path.startsWith(destinationPrefix);
    });
    const collidesWithFolder = getFolderList().some(folder => {
      if (folder.path === source || folder.path.startsWith(sourcePrefix)) return false;
      return folder.path === destination || folder.path.startsWith(destinationPrefix);
    });

    if (collidesWithFile || collidesWithFolder) {
      alert('A file or folder already exists inside that destination.');
      renderTree(true);
      return;
    }

    const updatedAt = serverTimestamp();
    const updates = {};

    getFileList().forEach(file => {
      if (!file.path.startsWith(sourcePrefix)) return;
      const nextPath = `${destinationPrefix}${file.path.slice(sourcePrefix.length)}`;
      const language = getLanguageForPath(nextPath, file.language);
      updates[`workspace/files/${file.id}/path`] = nextPath;
      updates[`workspace/files/${file.id}/language`] = language;
      updates[`workspace/files/${file.id}/updatedAt`] = updatedAt;
      updates[`fileSnapshots/${file.id}/path`] = nextPath;
      updates[`fileSnapshots/${file.id}/language`] = language;
      updates[`fileSnapshots/${file.id}/updatedAt`] = updatedAt;
    });

    getFolderList().forEach(folder => {
      if (folder.path !== source && !folder.path.startsWith(sourcePrefix)) return;
      const nextPath = folder.path === source
        ? destination
        : `${destinationPrefix}${folder.path.slice(sourcePrefix.length)}`;
      updates[`workspace/folders/${folder.id}/path`] = nextPath;
      updates[`workspace/folders/${folder.id}/updatedAt`] = updatedAt;
    });

    state.selectedPath = toFolderTreePath(destination);
    await state.options.beforeActiveFileChange?.();
    await state.sessionRef.update(updates);
  }

  async function moveFileToDirectory(sourcePath, targetDirectory) {
    const file = getFileByPath(sourcePath);
    if (!file) return;

    const directory = normalizePath(targetDirectory || '');
    const nextPath = normalizePath(`${directory ? `${directory}/` : ''}${basename(file.path)}`);
    if (!nextPath || nextPath === file.path) return;
    await renamePath(file.path, getUniquePath(nextPath));
  }

  async function deleteSelectedPath() {
    await deleteTreeTarget(getSelectedTreeTarget());
  }

  async function deleteTreeTarget(target) {
    const selection = target || getSelectedTreeTarget();
    if (isReadOnlyTreeTarget(selection)) {
      alert('Hidden problem files are read-only in sessions. Edit them in the Problem Library.');
      return;
    }
    if (selection.isFolder) {
      await deleteFolder(selection.path);
      return;
    }
    await deleteFile(getFileByPath(selection.path) || getActiveFile());
  }

  async function deleteFile(file) {
    if (!file) return;

    const files = getFileList();
    if (files.length <= 1) {
      alert('A session needs at least one file.');
      return;
    }

    if (!confirm(`Delete ${file.path} from this session?`)) return;

    const nextActive = files.find(candidate => candidate.id !== file.id);
    const updates = {
      [`workspace/files/${file.id}`]: null,
      [`fileSnapshots/${file.id}`]: null,
      [`workspace/activeFileId`]: nextActive.id
    };

    if (state.workspace.entryFileId === file.id) {
      updates[`workspace/entryFileId`] = nextActive.id;
    }

    state.selectedPath = nextActive.path;
    await state.sessionRef.update(updates);
  }

  async function deleteFolder(path) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return;

    const folder = getFolderByPath(normalized);
    if (!folder) return;

    if (hasFolderChildren(normalized)) {
      alert('This folder is not empty. Move or delete its files first.');
      return;
    }

    if (!confirm(`Delete empty folder ${normalized}?`)) return;

    state.selectedPath = getActiveFile()?.path || null;
    await state.sessionRef.child('workspace/folders').child(folder.id).remove();
  }

  async function setActiveAsEntry() {
    if (getActiveHiddenFile()) {
      alert('Hidden problem files are not candidate entry files.');
      return;
    }
    const active = getActiveFile();
    await setFileAsEntry(active);
  }

  async function setFileAsEntry(file) {
    if (!file || file.role === 'runtime') return;
    await state.sessionRef.child('workspace/entryFileId').set(file.id);
  }

  async function setActiveFile(fileId) {
    const file = state.workspace?.files?.[fileId];
    if (!file || state.pendingActiveFileId === fileId) return;
    if (fileId === state.workspace.activeFileId && !state.activeHiddenFileId) return;

    state.pendingActiveFileId = fileId;
    try {
      await state.options.beforeActiveFileChange?.();
      state.activeHiddenFileId = null;
      if (fileId === state.workspace.activeFileId) {
        state.options.onActiveFileChange?.(file, getSnapshot(file.id));
        renderTree();
      } else {
        await state.sessionRef.child('workspace/activeFileId').set(fileId);
      }
      focusEditorSoon();
    } finally {
      state.pendingActiveFileId = null;
    }
  }

  async function setActiveHiddenFile(file) {
    if (!file || state.activeHiddenFileId === file.id) return;

    await state.options.beforeActiveFileChange?.();
    state.activeHiddenFileId = file.id;
    state.selectedPath = file.path;
    state.options.onActiveFileChange?.(file, {
      path: file.path,
      language: file.language,
      role: file.role,
      content: file.content || ''
    });
    renderTree();
  }

  async function updateActiveFileLanguage(language) {
    if (getActiveHiddenFile()) return;
    const active = getActiveFile();
    if (!active) return;

    const updatedAt = serverTimestamp();
    await state.sessionRef.update({
      [`workspace/files/${active.id}/language`]: language,
      [`workspace/files/${active.id}/updatedAt`]: updatedAt,
      [`fileSnapshots/${active.id}/language`]: language,
      [`fileSnapshots/${active.id}/updatedAt`]: updatedAt
    });
  }

  async function saveActiveSnapshot(content) {
    if (getActiveHiddenFile()) return;
    const active = getActiveFile();
    if (!active || active.readonly || active.role === 'runtime') return;

    const updatedAt = serverTimestamp();
    await state.sessionRef.update({
      [`fileSnapshots/${active.id}`]: {
        path: active.path,
        language: active.language,
        role: active.role,
        content: String(content || ''),
        updatedAt,
        updatedBy: state.options.currentUser?.name || null
      },
      [`workspace/files/${active.id}/updatedAt`]: updatedAt,
      [`workspace/files/${active.id}/updatedBy`]: state.options.currentUser?.name || null
    });
  }

  async function saveRuntimeFiles(runtimeFiles) {
    if (!Array.isArray(runtimeFiles) || !runtimeFiles.length) return;

    const existingPaths = new Set(getFileList().map(file => file.path));
    const updates = {};
    const createdAt = serverTimestamp();
    let activeFileId = null;

    runtimeFiles.slice(0, MAX_FILES).forEach(runtimeFile => {
      const path = normalizePath(runtimeFile.path);
      if (!path || existingPaths.has(path)) return;

      const id = sanitizeFileId(runtimeFile.id, 'runtime');
      const language = getLanguageForPath(path, 'markdown');
      existingPaths.add(path);
      activeFileId = activeFileId || id;

      updates[`workspace/files/${id}`] = {
        id,
        path,
        language,
        role: 'runtime',
        readonly: true,
        mutable: false,
        origin: 'runtime',
        padPath: null,
        createdAt,
        updatedAt: createdAt
      };
      updates[`fileSnapshots/${id}`] = {
        path,
        language,
        role: 'runtime',
        content: String(runtimeFile.content || ''),
        updatedAt: createdAt
      };
    });

    if (Object.keys(updates).length) {
      await state.sessionRef.update(updates);
    }
  }

  function updateWorkspaceChrome() {
    const active = getDisplayedFile();
    const entry = getEntryFile();
    const activePath = document.getElementById('active-file-path');
    const entryBadge = document.getElementById('entry-file-badge');
    const entryPath = document.getElementById('entry-file-path');
    const languageSelector = document.getElementById('language-selector');
    const hiddenActive = active?.hidden === true;

    if (activePath) activePath.textContent = active?.path || 'No file';
    if (entryBadge) entryBadge.style.display = !hiddenActive && active && entry && active.id === entry.id ? 'inline-flex' : 'none';
    if (entryPath) entryPath.textContent = hiddenActive ? 'Hidden from candidate' : entry ? `Entry: ${entry.path}` : '';
    if (languageSelector && active?.language && languageSelector.value !== active.language) {
      languageSelector.value = active.language;
    }

    state.options.onWorkspaceChange?.(buildProjectSnapshot());
  }

  function getTreePaths() {
    const paths = new Set();
    getFolderList().forEach(folder => {
      const treePath = toFolderTreePath(folder.path);
      if (treePath) paths.add(treePath);
    });
    getFileList().forEach(file => paths.add(file.path));
    getHiddenFolderPaths().forEach(path => {
      const treePath = toFolderTreePath(path);
      if (treePath) paths.add(treePath);
    });
    getHiddenFileList().forEach(file => {
      if (!getFileByPath(file.path)) paths.add(file.path);
    });
    return Array.from(paths).sort((left, right) => left.localeCompare(right));
  }

  function getCurrentTreeSelectionPath() {
    if (state.selectedPath && isKnownTreePath(state.selectedPath)) {
      return state.selectedPath;
    }

    const active = getActiveFile();
    return active?.path || getTreePaths()[0] || null;
  }

  function getInitialExpandedPaths(paths) {
    const expanded = new Set();
    paths.forEach(path => {
      const segments = path.split('/');
      segments.pop();
      let cursor = '';
      segments.forEach(segment => {
        cursor = cursor ? `${cursor}/${segment}` : segment;
        expanded.add(`${cursor}/`);
      });
    });
    return Array.from(expanded);
  }

  function clearHiddenFiles() {
    state.hiddenFiles = [];
    state.hiddenFilesKey = '';
    state.activeHiddenFileId = null;
  }

  async function refreshHiddenFilesForWorkspace() {
    const source = state.workspace?.source || {};
    const problemId = source.problemId;
    const versionId = source.problemVersionId || source.versionId;
    const key = problemId && versionId ? `${problemId}:${versionId}` : '';

    if (state.options.currentUser?.isAdmin !== true || typeof state.options.loadHiddenFiles !== 'function' || !key) {
      if (state.hiddenFiles.length || state.hiddenFilesKey || state.activeHiddenFileId) {
        clearHiddenFiles();
        renderTree(true);
      }
      return;
    }

    if (key === state.hiddenFilesKey) return;
    state.hiddenFilesKey = key;

    try {
      const hiddenFiles = await state.options.loadHiddenFiles(source);
      if (state.hiddenFilesKey !== key) return;

      state.hiddenFiles = (Array.isArray(hiddenFiles) ? hiddenFiles : [])
        .map((file, index) => normalizeHiddenFileMetadata(file, index))
        .filter(Boolean)
        .filter(file => !getFileByPath(file.path));

      if (state.activeHiddenFileId && !getActiveHiddenFile()) {
        state.activeHiddenFileId = null;
      }
      renderTree(true);
    } catch (error) {
      console.warn('Could not load admin hidden problem files:', error);
      if (state.hiddenFilesKey === key) {
        state.hiddenFiles = [];
        state.activeHiddenFileId = null;
        renderTree(true);
      }
    }
  }

  function handleTreeSelection(selectedPaths) {
    const selectedPath = selectedPaths.find(isKnownTreePath) || null;
    if (!selectedPath) return;

    state.selectedPath = selectedPath;
    const { isFolder, path } = fromTreePath(selectedPath);
    if (isFolder) {
      updateWorkspaceChrome();
      return;
    }

    const selectedFile = getFileByPath(path);
    if (selectedFile) {
      setActiveFile(selectedFile.id).catch(error => console.error('Failed to switch file:', error));
      return;
    }

    const hiddenFile = getHiddenFileByPath(path);
    if (hiddenFile) {
      setActiveHiddenFile(hiddenFile).catch(error => console.error('Failed to open hidden file:', error));
    }
  }

  function getTreeRowPathFromEvent(event) {
    const path = event.composedPath?.() || [];
    const row = path.find(node => node?.getAttribute?.('data-item-path'));
    return row?.getAttribute?.('data-item-path') || null;
  }

  function bindTreeActivation(mount) {
    if (state.treeActivationBound || !mount) return;
    state.treeActivationBound = true;

    mount.addEventListener('click', event => {
      const rowPath = getTreeRowPathFromEvent(event);
      if (!rowPath) return;

      state.selectedPath = rowPath;
      const { isFolder, path } = fromTreePath(rowPath);
      if (isFolder) return;

      const file = getFileByPath(path);
      if (file) {
        setActiveFile(file.id).catch(error => console.error('Failed to switch file:', error));
        return;
      }

      const hiddenFile = getHiddenFileByPath(path);
      if (hiddenFile) {
        setActiveHiddenFile(hiddenFile).catch(error => console.error('Failed to open hidden file:', error));
      }
    }, true);

    mount.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const rowPath = getTreeRowPathFromEvent(event);
      if (!rowPath) return;

      state.selectedPath = rowPath;
      const { isFolder, path } = fromTreePath(rowPath);
      if (isFolder) return;

      const file = getFileByPath(path);
      if (file) {
        setActiveFile(file.id).catch(error => console.error('Failed to switch file:', error));
        return;
      }

      const hiddenFile = getHiddenFileByPath(path);
      if (hiddenFile) {
        setActiveHiddenFile(hiddenFile).catch(error => console.error('Failed to open hidden file:', error));
      }
    }, true);
  }

  function getTreeCss() {
    return `
      :host {
        display: block;
        height: 100%;
        color: #d4d4d4;
        background: #181818;
        color-scheme: dark;
        --trees-bg-override: #181818;
        --trees-bg-muted-override: #24262a;
        --trees-input-bg-override: #0f1011;
        --trees-search-bg-override: #0f1011;
        --trees-search-fg-override: #e6e8eb;
        --trees-fg-override: #d4d4d4;
        --trees-fg-muted-override: #8a8f98;
        --trees-border-color-override: rgba(255, 255, 255, 0.08);
        --trees-selected-fg-override: #ffffff;
        --trees-selected-bg-override: rgba(94, 106, 210, 0.24);
        --trees-selected-focused-border-color-override: rgba(94, 106, 210, 0.68);
        --trees-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .file-tree-root,
      [data-file-tree-virtualized-wrapper],
      [data-file-tree-virtualized-root],
      [data-file-tree-virtualized-scroll] {
        height: 100%;
        background: #181818 !important;
      }
      [data-file-tree-search-container] {
        background: #181818 !important;
        border-color: rgba(255, 255, 255, 0.08) !important;
      }
      [data-file-tree-search-input] {
        background: #0f1011 !important;
        color: #e6e8eb !important;
        border-color: rgba(255, 255, 255, 0.08) !important;
        caret-color: #e6e8eb;
        padding-inline: 34px 10px !important;
      }
      [data-file-tree-search-input]::placeholder {
        color: #7b818a;
      }
      [role="treeitem"] {
        color: #d4d4d4;
      }
      [role="treeitem"][aria-selected="true"] {
        background: rgba(0, 122, 204, 0.28);
        color: #ffffff;
      }
    `;
  }

  function createContextMenuButton(label, { danger = false, disabled = false, title = '', onSelect } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = danger ? 'workspace-context-menu__item danger' : 'workspace-context-menu__item';
    button.textContent = label;
    button.setAttribute('role', 'menuitem');
    if (title) button.title = title;

    if (disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      return button;
    }

    button.addEventListener('mousedown', event => {
      event.preventDefault();
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(onSelect?.()).catch(error => {
        console.error(`File tree action failed: ${label}`, error);
        alert('Could not complete that file action.');
        renderTree(true);
      });
    });

    return button;
  }

  function renderWorkspaceContextMenu(item, context) {
    const target = getContextMenuTarget(item);
    const treePath = getTargetTreePath(target);
    const file = target.isFolder ? null : getFileByPath(target.path);
    const hiddenFile = target.isFolder ? null : getHiddenFileByPath(target.path);
    const readOnlyTarget = isReadOnlyTreeTarget(target);
    const canRenameTarget = !!treePath && !readOnlyTarget && (target.isFolder ? folderExists(target.path) : !!file);
    const canDeleteTarget = !readOnlyTarget && (target.isFolder ? !!getFolderByPath(target.path) : !!file);
    const canSetEntry = !!file && file.role !== 'runtime' && !hiddenFile;

    const menu = document.createElement('div');
    menu.className = 'workspace-context-menu';
    menu.dataset.fileTreeContextMenuRoot = 'true';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Actions for ${item?.name || target.path || 'file'}`);
    const menuWidth = 188;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, context.anchorRect.right - menuWidth));
    const top = Math.max(8, Math.min(window.innerHeight - 228, context.anchorRect.bottom + 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const runAction = action => () => {
      if (treePath) {
        state.selectedPath = treePath;
        state.tree?.getItem?.(treePath)?.select?.();
      }
      context.close({ restoreFocus: false });
      return action();
    };

    menu.append(
      createContextMenuButton('New File', {
        onSelect: runAction(() => createFileInline(target))
      }),
      createContextMenuButton('New Folder', {
        onSelect: runAction(() => createFolderInline(target))
      }),
      document.createElement('hr'),
      createContextMenuButton('Rename', {
        disabled: !canRenameTarget,
        title: readOnlyTarget ? 'Hidden problem files are read-only in sessions.' : '',
        onSelect: runAction(() => {
          if (!startInlineRename(treePath)) renderTree(true);
        })
      }),
      createContextMenuButton('Set as Entry', {
        disabled: !canSetEntry,
        title: target.isFolder ? 'Folders cannot be entry files.' : '',
        onSelect: runAction(() => setFileAsEntry(file))
      }),
      document.createElement('hr'),
      createContextMenuButton('Delete', {
        danger: true,
        disabled: !canDeleteTarget,
        title: readOnlyTarget ? 'Hidden problem files are read-only in sessions.' : '',
        onSelect: runAction(() => deleteTreeTarget(target))
      })
    );

    return menu;
  }

  function renderTree(force = false) {
    const mount = document.getElementById('workspace-tree');
    if (!mount) return;

    bindTreeActivation(mount);

    const paths = getTreePaths();
    const selectedPath = getCurrentTreeSelectionPath();
    const pathSignature = paths.join('\n');
    const initialExpandedPaths = getInitialExpandedPaths(paths);

    if (!state.tree || force || state.treePathSignature !== pathSignature) {
      state.tree?.cleanUp?.();
      mount.innerHTML = '';
      state.tree = new FileTree({
        paths,
        initialExpansion: 'open',
        initialExpandedPaths,
        initialSelectedPaths: selectedPath ? [selectedPath] : [],
        search: true,
        density: 'compact',
        unsafeCSS: getTreeCss(),
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'right-click',
            render: renderWorkspaceContextMenu
          }
        },
        onSelectionChange: handleTreeSelection,
        renderRowDecoration({ item }) {
          const file = getFileByPath(item.path);
          const hiddenFile = getHiddenFileByPath(item.path);
          if (hiddenFile) return { text: 'hidden', title: 'Hidden from candidate' };
          if (!file) return null;
          if (file.id === state.workspace?.entryFileId) return { text: 'entry', title: 'Entry file' };
          if (file.role === 'runtime') return { text: 'run', title: 'Generated during this session' };
          return null;
        },
        renaming: {
          canRename(item) {
            if (getHiddenFileByPath(item.path)) return false;
            if (item.isFolder && hiddenFolderExists(item.path) && !folderExists(item.path)) return false;
            return item.isFolder ? folderExists(item.path) : !!getFileByPath(item.path);
          },
          onRename(event) {
            const rename = event.isFolder
              ? renameFolderPath(event.sourcePath, event.destinationPath)
              : renamePath(event.sourcePath, event.destinationPath);
            rename.catch(error => {
              console.error('Rename failed:', error);
              alert('Could not rename that file.');
              renderTree(true);
            });
          }
        },
        dragAndDrop: {
          canDrag(pathsToDrag) {
            return pathsToDrag.every(path => !!getFileByPath(path) && !getHiddenFileByPath(path));
          },
          canDrop() {
            return true;
          },
          onDropComplete(event) {
            const targetDirectory = event.target.kind === 'directory'
              ? event.target.directoryPath || event.target.hoveredPath || ''
              : '';
            event.draggedPaths.forEach(path => {
              moveFileToDirectory(path, targetDirectory).catch(error => {
                console.error('Move failed:', error);
                renderTree(true);
              });
            });
          }
        }
      });
      state.tree.render({ containerWrapper: mount });
      state.treePathSignature = pathSignature;
    }

    if (selectedPath) {
      const item = state.tree.getItem(selectedPath);
      item?.select?.();
      state.tree.scrollToPath?.(selectedPath, { offset: 'nearest' });
    }

    updateWorkspaceChrome();
    flushPendingInlineRename();
  }

  function handleWorkspaceSnapshot(snapshot) {
    const previousActiveFileId = state.workspace?.activeFileId || null;
    state.workspace = normalizeWorkspace(snapshot.val() || {});
    if (!state.selectedPath || !isKnownTreePath(state.selectedPath)) {
      state.selectedPath = getActiveFile()?.path || getTreePaths()[0] || null;
    }
    renderTree();
    refreshHiddenFilesForWorkspace();

    const active = getActiveFile();
    if (!getActiveHiddenFile() && active && (active.id !== previousActiveFileId || !state.initialized)) {
      state.options.onActiveFileChange?.(active, getSnapshot(active.id));
    }
    state.initialized = true;
  }

  function handleSnapshotsSnapshot(snapshot) {
    state.snapshots = snapshot.val() || {};
    const active = getActiveFile();
    const activeSnapshot = active ? getSnapshot(active.id) : null;
    const updatedByCurrentUser = activeSnapshot?.updatedBy
      && activeSnapshot.updatedBy === state.options.currentUser?.name;
    if (!getActiveHiddenFile() && active && activeSnapshot && !updatedByCurrentUser) {
      state.options.onActiveFileChange?.(active, activeSnapshot);
    }
    updateWorkspaceChrome();
  }

  async function init(options) {
    destroy();

    state.options = options || {};
    state.sessionRef = options.sessionRef;
    state.workspaceRef = state.sessionRef.child('workspace');
    state.snapshotsRef = state.sessionRef.child('fileSnapshots');

    bindToolbar();
    await ensureWorkspace(options.isNew);

    const snapshots = await state.snapshotsRef.once('value');
    state.snapshots = snapshots.val() || {};

    state.workspaceRef.on('value', handleWorkspaceSnapshot);
    state.snapshotsRef.on('value', handleSnapshotsSnapshot);
  }

  function destroy() {
    if (state.workspaceRef) state.workspaceRef.off();
    if (state.snapshotsRef) state.snapshotsRef.off();
    state.tree?.cleanUp?.();
    state.initialized = false;
    state.sessionRef = null;
    state.workspaceRef = null;
    state.snapshotsRef = null;
    state.options = {};
    state.workspace = null;
    state.snapshots = {};
    state.hiddenFiles = [];
    state.hiddenFilesKey = '';
    state.activeHiddenFileId = null;
    state.selectedPath = null;
    state.tree = null;
    state.treePathSignature = '';
    state.pendingInlineRenamePath = null;
    state.pendingActiveFileId = null;
  }

  function getPadRef(file) {
    return null;
  }

  window.CollabWorkspace = {
    init,
    destroy,
    isEnabled() {
      return !!state.workspace;
    },
    getActiveFile,
    getEntryFile,
    getFiles: getFileList,
    getSnapshot,
    getPadRef,
    getCurrentProjectSnapshot(activeContent) {
      return buildProjectSnapshot(activeContent);
    },
    saveActiveSnapshot,
    saveRuntimeFiles,
    updateActiveFileLanguage,
    getLanguageForPath,
    getDefaultPath,
    normalizePath
  };
})();
