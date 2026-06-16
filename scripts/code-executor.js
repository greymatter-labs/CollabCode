// Blaxel-backed Code Execution Module.
var CodeExecutor = window.CodeExecutor = (function() {
  const supportedLanguages = {
    javascript: true,
    typescript: true,
    python: true
  };

  function normalizePath(value) {
    const raw = String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/');

    const parts = [];
    raw.split('/').forEach(function(part) {
      const segment = part.trim();
      if (!segment || segment === '.') return;
      if (segment === '..') return;
      parts.push(segment);
    });
    return parts.join('/');
  }

  function normalizeProjectFiles(files, fallbackCode, fallbackLanguage) {
    const rawFiles = Array.isArray(files) && files.length
      ? files
      : [{ id: 'main', path: `main.${getFileExtension(fallbackLanguage)}`, content: fallbackCode || '', language: fallbackLanguage }];

    return rawFiles
      .map(function(file, index) {
        const path = normalizePath(file.path || file.name || `file-${index}.txt`);
        return {
          id: file.id || `file-${index}`,
          path: path || `file-${index}.txt`,
          content: String(file.content || ''),
          language: file.language || fallbackLanguage || null,
          role: file.role || 'solution',
          readonly: file.readonly === true
        };
      })
      .filter(function(file) {
        return file.path && file.content.length <= 100000;
      });
  }

  async function postExecution(payload) {
    const response = await fetch('/api/code/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(function() {
      return {};
    });

    if (!response.ok) {
      return {
        success: false,
        output: '',
        error: result.details || result.error || `Execution failed with HTTP ${response.status}`,
        exitCode: result.code || -1,
        provider: 'blaxel'
      };
    }

    return {
      success: result.success === true,
      output: result.output || result.stdout || '',
      error: result.error || result.stderr || '',
      exitCode: typeof result.code === 'number' ? result.code : (result.success ? 0 : -1),
      executionTime: result.executionTime || null,
      runtimeFiles: Array.isArray(result.runtimeFiles) ? result.runtimeFiles : [],
      provider: result.provider || 'blaxel',
      command: result.command || null,
      sandboxName: result.sandboxName || null
    };
  }

  async function execute(language, code, input = '', context = {}) {
    return executeProject(
      language,
      normalizeProjectFiles(null, code, language),
      context.entryPath || `main.${getFileExtension(language)}`,
      input,
      context
    );
  }

  async function executeProject(language, files, entryPath, input = '', context = {}) {
    const projectFiles = normalizeProjectFiles(files, '', language);
    if (!projectFiles.length) {
      return {
        success: false,
        error: 'No files were provided for execution',
        output: '',
        provider: 'blaxel'
      };
    }

    if (!isSupported(language)) {
      return {
        success: false,
        error: `Language ${language} is not supported for execution`,
        output: '',
        provider: 'blaxel'
      };
    }

    return postExecution({
      sessionId: context.sessionId,
      language,
      files: projectFiles,
      entryPath: normalizePath(entryPath) || projectFiles[0].path,
      stdin: input || '',
      runById: context.runById || null,
      runByName: context.runByName || null,
      timeoutSec: context.timeoutSec || null
    });
  }

  function getRuntimes() {
    return Promise.resolve([]);
  }

  function getFileExtension(language) {
    const extensions = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py'
    };
    return extensions[language] || 'txt';
  }

  function isSupported(language) {
    return supportedLanguages.hasOwnProperty(language);
  }

  return {
    execute,
    executeProject,
    getRuntimes,
    isSupported
  };
})();
