// Admin Problem Library and Builder
(function() {
  const state = {
    initialized: false,
    problems: [],
    selectedProblem: null,
    builder: null,
    activeFileId: null,
    selectedFolderPath: null,
    editor: null,
    loadingEditor: false
  };

  const languageModes = {
    javascript: 'ace/mode/javascript',
    typescript: 'ace/mode/typescript',
    python: 'ace/mode/python',
    json: 'ace/mode/json',
    markdown: 'ace/mode/markdown',
    html: 'ace/mode/html',
    css: 'ace/mode/css',
    yaml: 'ace/mode/yaml',
    text: 'ace/mode/text'
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  function fileIdFromPath(path) {
    return String(path || 'file')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 70) || `file_${Date.now().toString(36)}`;
  }

  function inferLanguage(path, fallback) {
    if (fallback) return fallback;
    const extension = String(path || '').split('.').pop().toLowerCase();
    const map = {
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      ts: 'typescript',
      py: 'python',
      json: 'json',
      md: 'markdown',
      html: 'html',
      css: 'css',
      yaml: 'yaml',
      yml: 'yaml'
    };
    return map[extension] || 'text';
  }

  function inferRole(path, visibility) {
    if (visibility === 'hidden') {
      return /(^|\/)(test|tests|spec|specs)(\/|$)|\.(test|spec)\./i.test(path) ? 'test' : 'hidden';
    }
    if (visibility === 'readonly') return 'support';
    return 'starter';
  }

  function visibilityLabel(visibility) {
    if (visibility === 'hidden') return 'hidden';
    if (visibility === 'readonly') return 'visible';
    return 'editable';
  }

  function visibilityClass(visibility) {
    if (visibility === 'hidden') return 'hidden';
    if (visibility === 'readonly') return 'readonly';
    return 'editable';
  }

  function defaultFileContent(path, language, role) {
    if (role === 'test') {
      if (language === 'python') {
        return 'from main import solve\n\n\ndef test_sample():\n    assert solve(\"hello\") == \"hello\"\n\n\nif __name__ == \"__main__\":\n    test_sample()\n    print(\"ok\")\n';
      }
      return 'const assert = require("assert");\nconst { solve } = require("../src/main");\n\nassert.strictEqual(solve("hello"), "hello");\nconsole.log("ok");\n';
    }

    if (language === 'python') {
      return 'def solve(value):\n    return value\n\n\nif __name__ == "__main__":\n    print(solve("hello"))\n';
    }

    if (language === 'typescript') {
      return 'export function solve(value: string): string {\n  return value;\n}\n\nconsole.log(solve("hello"));\n';
    }

    if (/package\.json$/.test(path)) {
      return JSON.stringify({
        scripts: { test: 'node tests/run.js' },
        collabcode: { run: 'node src/main.js' }
      }, null, 2) + '\n';
    }

    return 'function solve(value) {\n  return value;\n}\n\nmodule.exports = { solve };\n\nif (require.main === module) {\n  console.log(solve("hello"));\n}\n';
  }

  function defaultProblem() {
    return {
      id: null,
      status: 'draft',
      latestVersionId: null,
      runtime: {},
      draft: {
        title: 'Untitled Problem',
        difficulty: 'medium',
        tags: [],
        languages: ['javascript'],
        defaultLanguage: 'javascript',
        prompt: '',
        entryPath: 'main.js',
        starterCommand: '',
        testCommand: '',
        folders: [],
        files: [
          {
            id: 'main_js',
            path: 'main.js',
            language: 'javascript',
            visibility: 'editable',
            role: 'starter',
            content: defaultFileContent('main.js', 'javascript', 'starter')
          }
        ]
      }
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...Auth.getAuthHeaders()
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  function getDraft() {
    return state.builder?.draft || null;
  }

  function getActiveFile() {
    const draft = getDraft();
    return draft?.files?.find(file => file.id === state.activeFileId) || draft?.files?.[0] || null;
  }

  function setModalVisible(id, visible) {
    const modal = byId(id);
    if (modal) modal.style.display = visible ? 'flex' : 'none';
  }

  function setRuntimeOutput(text, type) {
    const output = byId('problemRuntimeOutput');
    if (!output) return;
    output.textContent = text || '';
    output.dataset.type = type || '';
  }

  function setBusy(buttonId, busy, label) {
    const button = byId(buttonId);
    if (!button) return () => {};
    const previous = button.textContent;
    button.disabled = busy;
    if (label) button.textContent = label;
    return () => {
      button.disabled = false;
      button.textContent = previous;
    };
  }

  function summarizeResult(data) {
    const result = data?.result || data || {};
    const pieces = [
      `success: ${result.success === true}`,
      result.command ? `command: ${result.command}` : '',
      result.sandboxName ? `sandbox: ${result.sandboxName}` : '',
      result.executionTime ? `time: ${result.executionTime}ms` : '',
      '',
      result.output || result.error || '(No output)'
    ];
    return pieces.filter(piece => piece !== '').join('\n');
  }

  function hydrateBuilder(problem) {
    if (!problem) return defaultProblem();
    const draft = problem.draft || problem;
    return {
      id: problem.id || null,
      status: problem.status || 'draft',
      latestVersionId: problem.latestVersionId || null,
      runtime: problem.runtime || {},
      versions: problem.versions || {},
      draft: {
        title: draft.title || problem.title || 'Untitled Problem',
        difficulty: draft.difficulty || problem.difficulty || '',
        tags: draft.tags || problem.tags || [],
        languages: draft.languages || problem.languages || [],
        defaultLanguage: draft.defaultLanguage || problem.defaultLanguage || 'javascript',
        prompt: draft.prompt || problem.prompt || '',
        entryPath: draft.entryPath || problem.entryPath || '',
        entryFileId: draft.entryFileId || problem.entryFileId || '',
        starterCommand: draft.starterCommand || problem.starterCommand || '',
        testCommand: draft.testCommand || problem.testCommand || '',
        folders: Array.isArray(draft.folders) ? draft.folders.slice() : [],
        files: Array.isArray(draft.files) ? draft.files.map(file => ({ ...file })) : []
      }
    };
  }

  function updateSelectedProblemCard() {
    const title = byId('selectedProblemTitle');
    const version = byId('selectedProblemVersion');
    const clear = byId('clearProblemSelectionBtn');

    if (!title || !version) return;
    if (!state.selectedProblem) {
      title.textContent = 'Blank workspace';
      version.textContent = 'No frozen problem selected';
      if (clear) clear.disabled = true;
      return;
    }

    title.textContent = state.selectedProblem.title || 'Selected problem';
    version.textContent = `${state.selectedProblem.versionId} frozen copy`;
    if (clear) clear.disabled = false;
  }

  function selectProblem(summary) {
    if (!summary?.latestVersionId) {
      alert('Publish this problem before creating sessions from it.');
      return;
    }
    state.selectedProblem = {
      id: summary.id,
      title: summary.title,
      versionId: summary.latestVersionId
    };
    updateSelectedProblemCard();
    setModalVisible('problemLibraryModal', false);
  }

  function clearSelectedProblem() {
    state.selectedProblem = null;
    updateSelectedProblemCard();
  }

  function renderProblemList() {
    const list = byId('problemList');
    const empty = byId('problemListEmpty');
    if (!list) return;

    const query = String(byId('problemSearchInput')?.value || '').trim().toLowerCase();
    const status = byId('problemStatusFilter')?.value || 'all';
    const filtered = state.problems.filter(problem => {
      const matchesStatus = status === 'all' || problem.status === status;
      const haystack = `${problem.title || ''} ${(problem.tags || []).join(' ')} ${(problem.languages || []).join(' ')}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });

    list.innerHTML = filtered.map(problem => {
      const tags = (problem.tags || []).slice(0, 4).map(tag => `<span class="problem-badge">${escapeHtml(tag)}</span>`).join('');
      const runtime = problem.latestVersionId ? problem.runtime?.[problem.latestVersionId]?.status : '';
      return `
        <div class="problem-row" data-problem-id="${escapeHtml(problem.id)}">
          <div>
            <h3>${escapeHtml(problem.title)}</h3>
            <div class="problem-row-meta">
              <span class="problem-badge ${escapeHtml(problem.status || 'draft')}">${escapeHtml(problem.status || 'draft')}</span>
              ${problem.latestVersionId ? `<span>${escapeHtml(problem.latestVersionId)}</span>` : '<span>No published version</span>'}
              ${problem.difficulty ? `<span>${escapeHtml(problem.difficulty)}</span>` : ''}
              ${runtime ? `<span>runtime ${escapeHtml(runtime)}</span>` : ''}
              ${tags}
            </div>
          </div>
          <div class="problem-row-actions">
            <button class="problem-secondary-btn" data-action="edit" type="button">Edit</button>
            <button class="problem-primary-btn" data-action="use" type="button" ${problem.latestVersionId ? '' : 'disabled'}>Use</button>
          </div>
        </div>
      `;
    }).join('');

    if (empty) empty.style.display = filtered.length ? 'none' : 'block';
  }

  async function loadProblems() {
    if (!Auth.isAdmin()) return;
    const data = await api('/api/problems/list');
    state.problems = data.problems || [];
    renderProblemList();
  }

  async function openLibrary() {
    try {
      await loadProblems();
      setModalVisible('problemLibraryModal', true);
    } catch (error) {
      alert(error.message || 'Failed to load problems.');
    }
  }

  function syncActiveFileFromEditor() {
    const file = getActiveFile();
    if (!file) return;
    if (state.editor && !state.loadingEditor) {
      file.content = state.editor.getValue();
    }
    file.path = normalizePath(byId('problemFilePathInput')?.value || file.path) || file.path;
    file.visibility = byId('problemFileVisibilityInput')?.value || file.visibility || 'editable';
    file.role = inferRole(file.path, file.visibility);
    file.language = inferLanguage(file.path);
  }

  function setEditorMode(language) {
    if (!state.editor) return;
    state.editor.session.setMode(languageModes[language] || languageModes.text);
  }

  function ensureProblemEditor() {
    if (state.editor || !window.ace || !byId('problemFileEditor')) return;
    state.editor = ace.edit('problemFileEditor');
    state.editor.setTheme('ace/theme/monokai');
    state.editor.setOptions({
      fontSize: '14px',
      showPrintMargin: false,
      wrap: true,
      useWorker: false
    });
    state.editor.on('change', function() {
      if (state.loadingEditor) return;
      const file = getActiveFile();
      if (file) file.content = state.editor.getValue();
    });
  }

  function selectFile(fileId) {
    syncActiveFileFromEditor();
    state.activeFileId = fileId;
    state.selectedFolderPath = null;
    renderFileList();
    renderActiveFile();
  }

  function selectFolder(path) {
    syncActiveFileFromEditor();
    state.selectedFolderPath = path;
    state.activeFileId = null;
    renderFileList();
    renderActiveFile();
  }

  function renderFileList() {
    const draft = getDraft();
    const list = byId('problemFileList');
    if (!draft || !list) return;

    const folders = (draft.folders || []).map(folder => `
      <button class="problem-file-row ${state.selectedFolderPath === folder.path ? 'active' : ''}" data-folder-path="${escapeHtml(folder.path)}" type="button">
        <strong>${escapeHtml(folder.path)}/</strong>
        <span>folder</span>
      </button>
    `).join('');

    const files = (draft.files || []).map(file => {
      const badges = [
        visibilityLabel(file.visibility),
        file.path === draft.entryPath ? 'entry' : '',
        file.role === 'test' ? 'test' : ''
      ].filter(Boolean).join(' · ');
      return `
        <button class="problem-file-row ${visibilityClass(file.visibility)} ${file.id === state.activeFileId ? 'active' : ''}" data-file-id="${escapeHtml(file.id)}" type="button">
          <strong>${escapeHtml(file.path)}</strong>
          <span>${escapeHtml(badges)}</span>
        </button>
      `;
    }).join('');

    list.innerHTML = folders + files;
  }

  function renderActiveFile() {
    ensureProblemEditor();
    const file = getActiveFile();
    const title = byId('problemActiveFileTitle');
    const pathInput = byId('problemFilePathInput');
    const visibilityInput = byId('problemFileVisibilityInput');

    if (!file) {
      if (title) title.textContent = state.selectedFolderPath ? `${state.selectedFolderPath}/` : 'No file selected';
      if (pathInput) pathInput.value = '';
      if (visibilityInput) visibilityInput.value = 'editable';
      if (state.editor) state.editor.setValue('', -1);
      return;
    }

    if (title) title.textContent = file.path;
    if (pathInput) pathInput.value = file.path;
    if (visibilityInput) visibilityInput.value = file.visibility || 'editable';
    if (state.editor) {
      state.loadingEditor = true;
      state.editor.setValue(file.content || '', -1);
      setEditorMode(file.language || inferLanguage(file.path));
      state.loadingEditor = false;
      setTimeout(() => state.editor?.resize(), 0);
    }
  }

  function renderBuilder() {
    const draft = getDraft();
    if (!draft) return;

    byId('problemBuilderTitle').textContent = state.builder.id ? draft.title || 'Problem Builder' : 'New Problem';
    byId('problemBuilderStatus').textContent = state.builder.latestVersionId
      ? `Published ${state.builder.latestVersionId} · draft editable`
      : 'Draft only';
    byId('problemTitleInput').value = draft.title || '';
    byId('problemDifficultyInput').value = draft.difficulty || '';
    byId('problemLanguageInput').value = draft.defaultLanguage || 'javascript';
    byId('problemTagsInput').value = (draft.tags || []).join(', ');
    byId('problemPromptInput').value = draft.prompt || '';
    byId('problemEntryPathInput').value = draft.entryPath || '';
    byId('problemStarterCommandInput').value = draft.starterCommand || '';
    byId('problemTestCommandInput').value = draft.testCommand || '';

    const runtimeStatus = state.builder.latestVersionId
      ? state.builder.runtime?.[state.builder.latestVersionId]?.status || 'Not prepared'
      : 'Publish before preparing';
    byId('problemRuntimeStatus').textContent = runtimeStatus;
    byId('createFromProblemBtn').disabled = !state.builder.latestVersionId;
    byId('prepareRuntimeBtn').disabled = !state.builder.latestVersionId;
    byId('resetRuntimeBtn').disabled = !state.builder.latestVersionId;
    byId('runTestsBtn').disabled = !draft.testCommand;

    if (!state.activeFileId && draft.files?.length) state.activeFileId = draft.files[0].id;
    renderFileList();
    renderActiveFile();
  }

  function collectProblem() {
    syncActiveFileFromEditor();
    const draft = getDraft();
    if (!draft) throw new Error('No problem is open');

    draft.title = byId('problemTitleInput')?.value.trim() || 'Untitled Problem';
    draft.difficulty = byId('problemDifficultyInput')?.value || '';
    draft.defaultLanguage = byId('problemLanguageInput')?.value || 'javascript';
    draft.languages = [draft.defaultLanguage];
    draft.tags = String(byId('problemTagsInput')?.value || '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
    draft.prompt = byId('problemPromptInput')?.value || '';
    draft.entryPath = normalizePath(byId('problemEntryPathInput')?.value || draft.files?.[0]?.path);
    draft.starterCommand = byId('problemStarterCommandInput')?.value.trim() || '';
    draft.testCommand = byId('problemTestCommandInput')?.value.trim() || '';

    return {
      id: state.builder.id,
      title: draft.title,
      difficulty: draft.difficulty,
      tags: draft.tags,
      languages: draft.languages,
      defaultLanguage: draft.defaultLanguage,
      prompt: draft.prompt,
      entryPath: draft.entryPath,
      starterCommand: draft.starterCommand,
      testCommand: draft.testCommand,
      folders: draft.folders || [],
      files: draft.files || []
    };
  }

  async function openBuilder(problemId) {
    try {
      if (problemId) {
        const data = await api(`/api/problems/get?problemId=${encodeURIComponent(problemId)}`);
        state.builder = hydrateBuilder(data.problem);
      } else {
        state.builder = defaultProblem();
      }
      state.activeFileId = state.builder.draft.files?.[0]?.id || null;
      state.selectedFolderPath = null;
      setRuntimeOutput('', '');
      setModalVisible('problemBuilderModal', true);
      renderBuilder();
    } catch (error) {
      alert(error.message || 'Failed to open problem.');
    }
  }

  async function saveDraft(silent) {
    const payload = collectProblem();
    const release = setBusy('saveProblemDraftBtn', true, 'Saving...');
    try {
      const previousActiveFileId = state.activeFileId;
      const data = await api('/api/problems/save', { method: 'POST', body: payload });
      state.builder = hydrateBuilder(data.problem);
      const activeStillExists = state.builder.draft.files?.some(file => file.id === previousActiveFileId);
      state.activeFileId = activeStillExists ? previousActiveFileId : state.builder.draft.files?.[0]?.id || null;
      renderBuilder();
      await loadProblems();
      if (!silent) setRuntimeOutput('Draft saved.', 'success');
      return data.problem;
    } finally {
      release();
    }
  }

  async function publishProblem() {
    const release = setBusy('publishProblemBtn', true, 'Publishing...');
    try {
      const saved = await saveDraft(true);
      const data = await api('/api/problems/publish', {
        method: 'POST',
        body: { problemId: saved.id }
      });
      state.builder = hydrateBuilder(data.problem);
      state.selectedProblem = {
        id: data.summary.id,
        title: data.summary.title,
        versionId: data.summary.latestVersionId
      };
      updateSelectedProblemCard();
      renderBuilder();
      await loadProblems();
      setRuntimeOutput(`Published ${data.summary.latestVersionId}.`, 'success');
    } catch (error) {
      alert(error.message || 'Failed to publish problem.');
    } finally {
      release();
    }
  }

  async function validateMode(mode, buttonId) {
    const release = setBusy(buttonId, true, 'Running...');
    try {
      const saved = await saveDraft(true);
      setRuntimeOutput(`Running ${mode}...`, 'info');
      const data = await api('/api/problems/validate', {
        method: 'POST',
        body: {
          problemId: saved.id,
          versionId: 'draft',
          useDraft: true,
          mode,
          timeoutSec: 90
        }
      });
      setRuntimeOutput(summarizeResult(data), data.success ? 'success' : 'error');
    } catch (error) {
      setRuntimeOutput(error.message || `Failed to run ${mode}.`, 'error');
    } finally {
      release();
    }
  }

  async function updateRuntime(action) {
    if (!state.builder?.id || !state.builder?.latestVersionId) {
      alert('Publish a frozen version before managing runtime.');
      return;
    }

    const buttonId = action === 'reset' ? 'resetRuntimeBtn' : 'prepareRuntimeBtn';
    const release = setBusy(buttonId, true, action === 'reset' ? 'Resetting...' : 'Preparing...');
    try {
      setRuntimeOutput(`${action === 'reset' ? 'Resetting' : 'Preparing'} runtime...`, 'info');
      const data = await api('/api/problems/runtime', {
        method: 'POST',
        body: {
          problemId: state.builder.id,
          versionId: state.builder.latestVersionId,
          action,
          mode: state.builder.draft.testCommand ? 'tests' : 'starter',
          timeoutSec: 120
        }
      });
      setRuntimeOutput(summarizeResult(data), data.success ? 'success' : 'error');
      const refreshed = await api(`/api/problems/get?problemId=${encodeURIComponent(state.builder.id)}`);
      state.builder = hydrateBuilder(refreshed.problem);
      renderBuilder();
      await loadProblems();
    } catch (error) {
      setRuntimeOutput(error.message || 'Runtime action failed.', 'error');
    } finally {
      release();
    }
  }

  function addFile() {
    const draft = getDraft();
    if (!draft) return;
    const requested = prompt('File path', 'src/helper.js');
    const path = normalizePath(requested);
    if (!path) return;
    if (draft.files.some(file => file.path === path)) {
      alert('A file already exists at that path.');
      return;
    }
    const language = inferLanguage(path, draft.defaultLanguage);
    const file = {
      id: fileIdFromPath(path),
      path,
      language,
      visibility: 'editable',
      role: inferRole(path, 'editable'),
      content: defaultFileContent(path, language, 'starter')
    };
    draft.files.push(file);
    selectFile(file.id);
  }

  function ensureParentFolders(path) {
    const draft = getDraft();
    if (!draft) return;
    draft.folders = draft.folders || [];
    const parts = normalizePath(path).split('/').filter(Boolean);
    parts.pop();
    let current = '';
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      if (!draft.folders.some(folder => folder.path === current)) {
        draft.folders.push({ id: fileIdFromPath(current), path: current });
      }
    });
  }

  async function importFiles(fileList, visibility) {
    const draft = getDraft();
    if (!draft || !fileList?.length) return;
    syncActiveFileFromEditor();

    const incoming = Array.from(fileList).slice(0, 100);
    let imported = 0;
    let skipped = 0;

    for (const browserFile of incoming) {
      const rawPath = browserFile.webkitRelativePath || browserFile.name;
      const path = normalizePath(rawPath);
      if (!path || browserFile.size > 250000) {
        skipped += 1;
        continue;
      }

      let content = '';
      try {
        content = await browserFile.text();
      } catch {
        skipped += 1;
        continue;
      }

      const language = inferLanguage(path, draft.defaultLanguage);
      const file = {
        id: fileIdFromPath(path),
        path,
        content,
        language,
        visibility,
        role: inferRole(path, visibility)
      };
      const existingIndex = draft.files.findIndex(candidate => candidate.path === path);
      if (existingIndex >= 0) {
        draft.files[existingIndex] = { ...draft.files[existingIndex], ...file };
      } else {
        draft.files.push(file);
      }
      ensureParentFolders(path);
      imported += 1;
    }

    if (!draft.entryPath && draft.files.length) {
      const firstEditable = draft.files.find(file => file.visibility !== 'hidden') || draft.files[0];
      draft.entryPath = firstEditable.path;
    }

    state.activeFileId = draft.files.find(file => file.visibility !== 'hidden')?.id || draft.files[0]?.id || null;
    renderBuilder();
    setRuntimeOutput(`Imported ${imported} file${imported === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`, skipped ? 'info' : 'success');
  }

  function addFolder() {
    const draft = getDraft();
    if (!draft) return;
    const requested = prompt('Folder path', 'src/utils');
    const path = normalizePath(requested);
    if (!path) return;
    if ((draft.folders || []).some(folder => folder.path === path)) {
      alert('That folder already exists.');
      return;
    }
    draft.folders = draft.folders || [];
    draft.folders.push({ id: fileIdFromPath(path), path });
    selectFolder(path);
  }

  function deleteSelectedItem() {
    const draft = getDraft();
    if (!draft) return;
    if (state.selectedFolderPath) {
      const hasChildren = draft.files.some(file => file.path.startsWith(`${state.selectedFolderPath}/`));
      if (hasChildren) {
        alert('Delete or move files inside this folder first.');
        return;
      }
      draft.folders = (draft.folders || []).filter(folder => folder.path !== state.selectedFolderPath);
      state.selectedFolderPath = null;
      renderFileList();
      renderActiveFile();
      return;
    }

    const active = getActiveFile();
    if (!active || draft.files.length <= 1) return;
    if (!confirm(`Delete ${active.path}?`)) return;
    draft.files = draft.files.filter(file => file.id !== active.id);
    if (draft.entryPath === active.path) draft.entryPath = draft.files[0]?.path || '';
    state.activeFileId = draft.files[0]?.id || null;
    renderBuilder();
  }

  function updateActiveFileControls() {
    const file = getActiveFile();
    if (!file) return;
    const previousPath = file.path;
    syncActiveFileFromEditor();
    const draft = getDraft();
    if (draft.entryPath === previousPath) draft.entryPath = file.path;
    byId('problemEntryPathInput').value = draft.entryPath;
    renderFileList();
    renderActiveFile();
  }

  function createSessionFromSelectedProblem() {
    if (!state.builder?.latestVersionId) {
      alert('Publish this problem before creating a session from it.');
      return;
    }

    state.selectedProblem = {
      id: state.builder.id,
      title: state.builder.draft.title,
      versionId: state.builder.latestVersionId
    };
    updateSelectedProblemCard();
    setModalVisible('problemBuilderModal', false);
    setModalVisible('problemLibraryModal', false);
    byId('createSessionBtn')?.click();
  }

  function bindEvents() {
    byId('problemLibraryBtn')?.addEventListener('click', openLibrary);
    byId('chooseProblemBtn')?.addEventListener('click', openLibrary);
    byId('clearProblemSelectionBtn')?.addEventListener('click', clearSelectedProblem);
    byId('closeProblemLibraryBtn')?.addEventListener('click', () => setModalVisible('problemLibraryModal', false));
    byId('closeProblemBuilderBtn')?.addEventListener('click', () => setModalVisible('problemBuilderModal', false));
    byId('newProblemBtn')?.addEventListener('click', () => openBuilder());
    byId('refreshProblemsBtn')?.addEventListener('click', () => loadProblems().catch(error => alert(error.message)));
    byId('problemSearchInput')?.addEventListener('input', renderProblemList);
    byId('problemStatusFilter')?.addEventListener('change', renderProblemList);
    byId('problemTestCommandInput')?.addEventListener('input', function() {
      const runTestsBtn = byId('runTestsBtn');
      if (runTestsBtn) runTestsBtn.disabled = !this.value.trim();
    });
    byId('saveProblemDraftBtn')?.addEventListener('click', () => saveDraft(false).catch(error => alert(error.message)));
    byId('publishProblemBtn')?.addEventListener('click', publishProblem);
    byId('createFromProblemBtn')?.addEventListener('click', createSessionFromSelectedProblem);
    byId('uploadProblemFilesBtn')?.addEventListener('click', () => byId('problemFilesUploadInput')?.click());
    byId('uploadProblemFolderBtn')?.addEventListener('click', () => byId('problemFolderUploadInput')?.click());
    byId('uploadHiddenTestsBtn')?.addEventListener('click', () => byId('problemHiddenTestsUploadInput')?.click());
    byId('problemFilesUploadInput')?.addEventListener('change', (event) => {
      importFiles(event.target.files, 'editable');
      event.target.value = '';
    });
    byId('problemFolderUploadInput')?.addEventListener('change', (event) => {
      importFiles(event.target.files, 'editable');
      event.target.value = '';
    });
    byId('problemHiddenTestsUploadInput')?.addEventListener('change', (event) => {
      importFiles(event.target.files, 'hidden');
      event.target.value = '';
    });
    byId('addProblemFileBtn')?.addEventListener('click', addFile);
    byId('addProblemFolderBtn')?.addEventListener('click', addFolder);
    byId('deleteProblemFileBtn')?.addEventListener('click', deleteSelectedItem);
    byId('problemFilePathInput')?.addEventListener('change', updateActiveFileControls);
    byId('problemFileVisibilityInput')?.addEventListener('change', updateActiveFileControls);
    byId('runStarterBtn')?.addEventListener('click', () => validateMode('starter', 'runStarterBtn'));
    byId('runTestsBtn')?.addEventListener('click', () => validateMode('tests', 'runTestsBtn'));
    byId('prepareRuntimeBtn')?.addEventListener('click', () => updateRuntime('prepare'));
    byId('resetRuntimeBtn')?.addEventListener('click', () => updateRuntime('reset'));

    byId('problemList')?.addEventListener('click', function(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const row = button.closest('.problem-row');
      const problemId = row?.getAttribute('data-problem-id');
      const problem = state.problems.find(candidate => candidate.id === problemId);
      if (!problem) return;
      if (button.dataset.action === 'use') selectProblem(problem);
      if (button.dataset.action === 'edit') openBuilder(problem.id);
    });

    byId('problemFileList')?.addEventListener('click', function(event) {
      const fileRow = event.target.closest('[data-file-id]');
      const folderRow = event.target.closest('[data-folder-path]');
      if (fileRow) selectFile(fileRow.getAttribute('data-file-id'));
      if (folderRow) selectFolder(folderRow.getAttribute('data-folder-path'));
    });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    bindEvents();
    updateSelectedProblemCard();
  }

  function getSessionPayload() {
    if (!state.selectedProblem) return {};
    return {
      problemId: state.selectedProblem.id,
      versionId: state.selectedProblem.versionId
    };
  }

  window.ProblemLibrary = {
    init,
    loadProblems,
    openLibrary,
    openBuilder,
    getSessionPayload,
    clearSelectedProblem
  };
})();
