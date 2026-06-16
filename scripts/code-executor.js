// Code Execution Module
const CodeExecutor = (function() {
  
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

  function executeJavaScriptLocally(code, input = '') {
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
            const result = new Function('stdin', 'input', event.data.code).call(self, self.stdin, self.input);
            Promise.resolve(result).then(function(value) {
              if (value !== undefined) logs.push(formatValue(value));
              self.postMessage({ success: true, output: logs.join('\\n'), code: 0 });
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

      worker.postMessage({ code, input });
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
    getRuntimes,
    isSupported: (language) => languageMap.hasOwnProperty(language)
  };
})();
