// Code Execution Module
var CodeExecutor = window.CodeExecutor = (function() {
  
  // Use our secure API proxy instead of calling external APIs directly
  // This provides security, rate limiting, and hides external endpoints
  
  // Language mappings for Piston
  const languageMap = {
    javascript: { language: 'javascript', version: '18.15.0' },
    python: { language: 'python', version: '3.10.0' },
    java: { language: 'java', version: '15.0.2' },
    c_cpp: { language: 'c++', version: '10.2.0' },
    csharp: { language: 'csharp', version: '6.12.0' },
    php: { language: 'php', version: '8.2.3' },
    ruby: { language: 'ruby', version: '3.0.1' },
    go: { language: 'go', version: '1.16.2' },
    rust: { language: 'rust', version: '1.68.2' },
    typescript: { language: 'typescript', version: '5.0.3' },
    swift: { language: 'swift', version: '5.3.3' },
    kotlin: { language: 'kotlin', version: '1.8.20' },
    sql: { language: 'sqlite3', version: '3.36.0' }
  };

  // Get available runtimes (not used currently, but kept for future use)
  async function getRuntimes() {
    // Runtimes are handled server-side now
    return [];
  }

  function normalizeProjectFiles(files) {
    if (!Array.isArray(files)) return [];

    return files
      .map((file, index) => {
        const path = String(file.path || file.name || `file-${index}.js`)
          .replace(/\\/g, '/')
          .replace(/^\/+/, '')
          .replace(/\/+/g, '/');
        return {
          id: file.id || `file-${index}`,
          path: path || `file-${index}.js`,
          content: String(file.content || ''),
          language: file.language || null,
          role: file.role || 'solution'
        };
      })
      .filter(file => file.path && file.content.length <= 100000);
  }

  function isTypeScriptFile(file) {
    return file.language === 'typescript' || /\.tsx?$/i.test(file.path);
  }

  function prepareJavaScriptRuntimeFiles(files) {
    return normalizeProjectFiles(files).map((file) => {
      if (!isTypeScriptFile(file)) return file;

      if (!window.CollabTypeScriptTransform?.transform) {
        throw new Error('TypeScript support is still loading. Please try Run again in a moment.');
      }

      return {
        ...file,
        content: window.CollabTypeScriptTransform.transform(file.content, file.path)
      };
    });
  }

  function executeJavaScriptLocally(code, input = '') {
    return executeJavaScriptProjectLocally([
      { id: 'main', path: 'main.js', content: code, language: 'javascript' }
    ], 'main.js', input);
  }

  function executeTypeScriptLocally(code, input = '') {
    return executeJavaScriptProjectLocally([
      { id: 'main', path: 'main.ts', content: code, language: 'typescript' }
    ], 'main.ts', input);
  }

  function executeJavaScriptProjectLocally(files, entryPath, input = '') {
    let projectFiles;
    try {
      projectFiles = prepareJavaScriptRuntimeFiles(files);
    } catch (error) {
      return Promise.resolve({
        success: false,
        output: '',
        error: error.message,
        exitCode: 1
      });
    }
    return new Promise((resolve) => {
      const workerSource = `
        function formatValue(value) {
          if (typeof value === 'string') return value;
          if (value === undefined) return 'undefined';
          try {
            return JSON.stringify(value);
          } catch (error) {
            return String(value);
          }
        }

        function normalizePath(value) {
          var raw = String(value || '').replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/\\/+/g, '/');
          var parts = [];
          raw.split('/').forEach(function(part) {
            if (!part || part === '.') return;
            if (part === '..') {
              parts.pop();
              return;
            }
            parts.push(part);
          });
          return parts.join('/');
        }

        function dirname(path) {
          var parts = normalizePath(path).split('/').filter(Boolean);
          parts.pop();
          return parts.join('/');
        }

        function basename(path) {
          var parts = normalizePath(path).split('/').filter(Boolean);
          return parts[parts.length - 1] || '';
        }

        function joinPath() {
          return normalizePath(Array.from(arguments).join('/'));
        }

        function createRuntimeId(path) {
          return 'runtime_' + normalizePath(path).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70);
        }

        self.onmessage = function(event) {
          const logs = [];
          const originalConsole = self.console || {};
          self.stdin = event.data.input || '';
          self.input = self.stdin;
          self.console = {
            log: function() { logs.push(Array.from(arguments).map(formatValue).join(' ')); },
            warn: function() { logs.push(Array.from(arguments).map(formatValue).join(' ')); },
            error: function() { logs.push(Array.from(arguments).map(formatValue).join(' ')); }
          };

          try {
            var fileMap = {};
            var initialPaths = {};
            var moduleCache = {};
            var runtimeFiles = {};
            var files = Array.isArray(event.data.files) ? event.data.files : [];
            files.forEach(function(file) {
              var path = normalizePath(file.path || file.name || 'main.js');
              if (!path) return;
              fileMap[path] = String(file.content || '');
              initialPaths[path] = true;
            });

            var entryPath = normalizePath(event.data.entryPath || (files[0] && files[0].path) || 'main.js');
            if (!fileMap[entryPath]) {
              throw new Error('Entry file not found: ' + entryPath);
            }

            function writeRuntimeFile(path, content) {
              var normalized = normalizePath(path);
              if (!normalized) throw new Error('Invalid file path');
              fileMap[normalized] = String(content == null ? '' : content);
              if (!initialPaths[normalized]) {
                runtimeFiles[normalized] = fileMap[normalized];
              }
            }

            var fsModule = {
              readFileSync: function(path, encoding) {
                var normalized = normalizePath(path);
                if (!Object.prototype.hasOwnProperty.call(fileMap, normalized)) {
                  throw new Error('ENOENT: no such file, open ' + normalized);
                }
                return fileMap[normalized];
              },
              writeFileSync: function(path, content) {
                writeRuntimeFile(path, content);
              },
              appendFileSync: function(path, content) {
                var normalized = normalizePath(path);
                writeRuntimeFile(normalized, (fileMap[normalized] || '') + String(content == null ? '' : content));
              },
              existsSync: function(path) {
                return Object.prototype.hasOwnProperty.call(fileMap, normalizePath(path));
              },
              mkdirSync: function() {},
              readdirSync: function(path) {
                var directory = normalizePath(path || '');
                var prefix = directory ? directory + '/' : '';
                var children = {};
                Object.keys(fileMap).forEach(function(filePath) {
                  if (prefix && !filePath.startsWith(prefix)) return;
                  var remainder = prefix ? filePath.slice(prefix.length) : filePath;
                  var first = remainder.split('/')[0];
                  if (first) children[first] = true;
                });
                return Object.keys(children);
              },
              unlinkSync: function(path) {
                var normalized = normalizePath(path);
                delete fileMap[normalized];
                if (!initialPaths[normalized]) {
                  runtimeFiles[normalized] = '';
                }
              }
            };

            var pathModule = {
              basename: basename,
              dirname: dirname,
              join: joinPath,
              resolve: function() {
                return joinPath.apply(null, arguments);
              },
              normalize: normalizePath,
              extname: function(path) {
                var name = basename(path);
                var index = name.lastIndexOf('.');
                return index >= 0 ? name.slice(index) : '';
              }
            };

            function resolveModulePath(fromPath, request) {
              if (request === 'fs' || request === 'node:fs') return request;
              if (request === 'path' || request === 'node:path') return request;
              if (!request.startsWith('.') && !request.startsWith('/')) {
                throw new Error('Only relative imports are available in this session filesystem: ' + request);
              }

              var base = request.startsWith('/')
                ? normalizePath(request)
                : joinPath(dirname(fromPath), request);
              var candidates = [base];
              if (!/\\.[A-Za-z0-9]+$/.test(base)) {
                candidates.push(base + '.js', base + '.ts', base + '.tsx', base + '.jsx', base + '.json', base + '/index.js', base + '/index.ts');
              }

              for (var index = 0; index < candidates.length; index += 1) {
                if (Object.prototype.hasOwnProperty.call(fileMap, candidates[index])) {
                  return candidates[index];
                }
              }
              throw new Error('Cannot find module ' + request + ' from ' + fromPath);
            }

            function runModule(path) {
              var resolved = normalizePath(path);
              if (!Object.prototype.hasOwnProperty.call(fileMap, resolved)) {
                resolved = resolveModulePath('', path);
              }
              if (moduleCache[resolved]) return moduleCache[resolved].exports;
              if (/\\.json$/i.test(resolved)) {
                moduleCache[resolved] = { exports: JSON.parse(fileMap[resolved]) };
                return moduleCache[resolved].exports;
              }

              var module = { exports: {} };
              moduleCache[resolved] = module;
              var localRequire = function(request) {
                var target = resolveModulePath(resolved, request);
                if (target === 'fs' || target === 'node:fs') return fsModule;
                if (target === 'path' || target === 'node:path') return pathModule;
                return runModule(target);
              };
              var source = String(fileMap[resolved] || '') + '\\n//# sourceURL=' + resolved;
              var fn = new Function('require', 'module', 'exports', 'stdin', 'input', '__filename', '__dirname', source);
              var returnValue = fn.call(self, localRequire, module, module.exports, self.stdin, self.input, resolved, dirname(resolved));
              return returnValue === undefined ? module.exports : returnValue;
            }

            const result = runModule(entryPath);
            Promise.resolve(result).then(function(value) {
              if (value !== undefined && !(typeof value === 'object' && value != null && Object.keys(value).length === 0)) {
                logs.push(formatValue(value));
              }
              self.postMessage({
                success: true,
                output: logs.join('\\n'),
                runtimeFiles: Object.keys(runtimeFiles).map(function(path) {
                  return { id: createRuntimeId(path), path: path, content: runtimeFiles[path] };
                }),
                code: 0
              });
            }).catch(function(error) {
              self.postMessage({
                success: false,
                output: logs.join('\\n'),
                error: error && error.stack ? error.stack : String(error),
                code: 1
              });
            });
          } catch (error) {
            self.console = originalConsole;
            self.postMessage({
              success: false,
              output: logs.join('\\n'),
              error: error && error.stack ? error.stack : String(error),
              code: 1
            });
          }
        };
      `;
      const blob = new Blob([workerSource], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      const timeout = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: false,
          output: '',
          error: 'Execution timed out after 3 seconds',
          exitCode: 1
        });
      }, 3000);

      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: event.data.success,
          output: event.data.output || '',
          error: event.data.error || '',
          runtimeFiles: event.data.runtimeFiles || [],
          exitCode: event.data.code || 0,
          executionTime: 0
        });
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: false,
          output: '',
          error: error.message || 'JavaScript execution failed',
          exitCode: 1
        });
      };

      worker.postMessage({ files: projectFiles, entryPath, input });
    });
  }

  function executePythonLocally(code, input = '') {
    return executePythonProjectLocally([
      { id: 'main', path: 'main.py', content: code, language: 'python' }
    ], 'main.py', input);
  }

  function executePythonProjectLocally(files, entryPath, input = '') {
    const projectFiles = normalizeProjectFiles(files);
    const pyodideBaseUrl = new URL('scripts/pyodide/', window.location.href).href;

    return new Promise((resolve) => {
      const workerSource = `
        function normalizePath(value) {
          var raw = String(value || '').replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/\\/+/g, '/');
          var parts = [];
          raw.split('/').forEach(function(part) {
            if (!part || part === '.') return;
            if (part === '..') {
              parts.pop();
              return;
            }
            parts.push(part);
          });
          return parts.join('/');
        }

        function dirname(path) {
          var parts = normalizePath(path).split('/').filter(Boolean);
          parts.pop();
          return parts.join('/');
        }

        function createRuntimeId(path) {
          return 'runtime_' + normalizePath(path).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70);
        }

        function ensureDirectory(pyodide, directory) {
          var parts = normalizePath(directory).split('/').filter(Boolean);
          var current = '/home/pyodide/session';
          parts.forEach(function(part) {
            current += '/' + part;
            try {
              pyodide.FS.mkdir(current);
            } catch (error) {
              if (!String(error && error.message || error).includes('File exists')) throw error;
            }
          });
        }

        function collectRuntimeFiles(pyodide, initialPaths) {
          var runtimeFiles = [];

          function walk(absDirectory, relDirectory) {
            pyodide.FS.readdir(absDirectory).forEach(function(name) {
              if (name === '.' || name === '..' || name === '__pycache__') return;
              var absPath = absDirectory + '/' + name;
              var relPath = relDirectory ? relDirectory + '/' + name : name;
              var stat = pyodide.FS.stat(absPath);
              if (pyodide.FS.isDir(stat.mode)) {
                walk(absPath, relPath);
                return;
              }
              if (initialPaths[relPath]) return;
              try {
                runtimeFiles.push({
                  id: createRuntimeId(relPath),
                  path: relPath,
                  content: pyodide.FS.readFile(absPath, { encoding: 'utf8' })
                });
              } catch (error) {
                // Binary outputs are intentionally not surfaced in the editor.
              }
            });
          }

          walk('/home/pyodide/session', '');
          return runtimeFiles;
        }

        self.onmessage = async function(event) {
          var files = Array.isArray(event.data.files) ? event.data.files : [];
          var initialPaths = {};
          var entryPath = normalizePath(event.data.entryPath || (files[0] && files[0].path) || 'main.py');

          try {
            var pyodideModule = await import(event.data.pyodideBaseUrl + 'pyodide.mjs');
            var pyodide = await pyodideModule.loadPyodide({ indexURL: event.data.pyodideBaseUrl });

            try {
              pyodide.FS.mkdir('/home/pyodide/session');
            } catch (error) {}
            pyodide.FS.chdir('/home/pyodide/session');

            files.forEach(function(file) {
              var filePath = normalizePath(file.path || file.name || 'main.py');
              if (!filePath) return;
              ensureDirectory(pyodide, dirname(filePath));
              pyodide.FS.writeFile('/home/pyodide/session/' + filePath, String(file.content || ''));
              initialPaths[filePath] = true;
            });

            if (!initialPaths[entryPath]) {
              throw new Error('Entry file not found: ' + entryPath);
            }

            pyodide.globals.set('__collab_entry', entryPath);
            pyodide.globals.set('__collab_stdin', String(event.data.input || ''));

            var resultJson = await pyodide.runPythonAsync(\`
import contextlib
import io
import json
import os
import runpy
import sys
import traceback

os.chdir('/home/pyodide/session')
if os.getcwd() not in sys.path:
    sys.path.insert(0, os.getcwd())

_stdout = io.StringIO()
_stderr = io.StringIO()
_success = True
_error = ''
sys.stdin = io.StringIO(__collab_stdin)

try:
    with contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stderr):
        runpy.run_path(__collab_entry, run_name='__main__')
except SystemExit as exc:
    if exc.code not in (None, 0):
        _success = False
        _error = 'SystemExit: ' + str(exc.code)
except BaseException:
    _success = False
    _error = traceback.format_exc()

json.dumps({
    'success': _success,
    'output': _stdout.getvalue(),
    'error': _stderr.getvalue() + _error,
})
\`);
            var result = JSON.parse(resultJson);
            self.postMessage({
              success: result.success,
              output: result.output || '',
              error: result.error || '',
              runtimeFiles: collectRuntimeFiles(pyodide, initialPaths),
              code: result.success ? 0 : 1
            });
          } catch (error) {
            self.postMessage({
              success: false,
              output: '',
              error: error && error.stack ? error.stack : String(error),
              runtimeFiles: [],
              code: 1
            });
          }
        };
      `;
      const blob = new Blob([workerSource], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl, { type: 'module' });
      const timeout = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: false,
          output: '',
          error: 'Python execution timed out after 20 seconds',
          exitCode: 1
        });
      }, 20000);

      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: event.data.success,
          output: event.data.output || '',
          error: event.data.error || '',
          runtimeFiles: event.data.runtimeFiles || [],
          exitCode: event.data.code || 0,
          executionTime: 0
        });
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: false,
          output: '',
          error: error.message || 'Python execution failed',
          exitCode: 1
        });
      };

      worker.postMessage({
        files: projectFiles,
        entryPath: entryPath || projectFiles[0]?.path || 'main.py',
        input,
        pyodideBaseUrl
      });
    });
  }

  // Execute code
  async function execute(language, code, input = '') {
    const langConfig = languageMap[language];
    
    if (!langConfig) {
      return {
        success: false,
        error: `Language ${language} is not supported for execution`,
        output: ''
      };
    }

    if (language === 'javascript') {
      return executeJavaScriptLocally(code, input);
    }

    if (language === 'typescript') {
      return executeTypeScriptLocally(code, input);
    }

    if (language === 'python') {
      return executePythonLocally(code, input);
    }

    try {
      // Use our secure API proxy instead of calling Piston directly
      const response = await fetch('/api/code/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language: language,
          code: code,
          stdin: input
        })
      });

      const result = await response.json();
      
      if (result.success) {
        return {
          success: true,
          output: result.output || result.stdout || '',
          error: result.stderr || '',
          exitCode: result.code || 0,
          executionTime: 0
        };
      } else {
        return {
          success: false,
          output: '',
          error: result.details || result.error || 'Execution failed',
          exitCode: result.code || -1
        };
      }
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Execution error: ${error.message}`,
        exitCode: -1
      };
    }
  }

  async function executeProject(language, files, entryPath, input = '') {
    const projectFiles = normalizeProjectFiles(files);

    if (!projectFiles.length) {
      return {
        success: false,
        error: 'No files were provided for execution',
        output: ''
      };
    }

    const langConfig = languageMap[language];
    if (!langConfig) {
      return {
        success: false,
        error: `Language ${language} is not supported for execution`,
        output: ''
      };
    }

    if (language === 'javascript' || language === 'typescript') {
      return executeJavaScriptProjectLocally(projectFiles, entryPath || projectFiles[0].path, input);
    }

    if (language === 'python') {
      return executePythonProjectLocally(projectFiles, entryPath || projectFiles[0].path, input);
    }

    try {
      const response = await fetch('/api/code/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language,
          files: projectFiles,
          entryPath: entryPath || projectFiles[0].path,
          stdin: input
        })
      });

      const result = await response.json();

      if (result.success) {
        return {
          success: true,
          output: result.output || result.stdout || '',
          error: result.stderr || '',
          exitCode: result.code || 0,
          executionTime: 0
        };
      }

      return {
        success: false,
        output: '',
        error: result.details || result.error || 'Execution failed',
        exitCode: result.code || -1
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Execution error: ${error.message}`,
        exitCode: -1
      };
    }
  }

  // Get file extension for language
  function getFileExtension(language) {
    const extensions = {
      javascript: 'js',
      python: 'py',
      java: 'java',
      c_cpp: 'cpp',
      csharp: 'cs',
      php: 'php',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      typescript: 'ts',
      swift: 'swift',
      kotlin: 'kt',
      sql: 'sql'
    };
    return extensions[language] || 'txt';
  }

  // Public API
  return {
    execute,
    executeProject,
    getRuntimes,
    isSupported: (language) => languageMap.hasOwnProperty(language)
  };
})();
