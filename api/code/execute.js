// Secure API endpoint for code execution.
// Non-JavaScript languages require a private Piston-compatible API configured
// with PISTON_API_URL. JavaScript is executed client-side in a Web Worker.

module.exports = async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { language, code, stdin } = req.body;

    // Validate input
    if (!language || !code) {
      return res.status(400).json({ error: 'Language and code are required' });
    }

    // Security: Limit code size (100KB)
    if (code.length > 100000) {
      return res.status(400).json({ error: 'Code too large (max 100KB)' });
    }

    // Language mappings for Piston
    const languageMap = {
      'javascript': 'javascript',
      'python': 'python',
      'java': 'java',
      'c_cpp': 'cpp',
      'go': 'go',
      'rust': 'rust',
      'ruby': 'ruby',
      'php': 'php',
      'csharp': 'csharp',
      'swift': 'swift',
      'kotlin': 'kotlin',
      'typescript': 'typescript',
      'r': 'r',
      'perl': 'perl',
      'scala': 'scala',
      'haskell': 'haskell',
      'lua': 'lua',
      'elixir': 'elixir',
      'dart': 'dart',
      'sql': 'sql'
    };

    const pistonLanguage = languageMap[language] || language;
    const PISTON_API = process.env.PISTON_API_URL;

    if (!PISTON_API) {
      return res.status(503).json({
        error: 'Execution provider not configured',
        details: `Execution for ${language} requires a private Piston-compatible API in PISTON_API_URL. JavaScript runs in the browser.`
      });
    }

    // Execute code via Piston API
    const response = await fetch(`${PISTON_API}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        language: pistonLanguage,
        version: '*', // Use latest version
        files: [{
          content: code
        }],
        stdin: stdin || '',
        args: [],
        compile_timeout: 10000,
        run_timeout: 3000,
        compile_memory_limit: -1,
        run_memory_limit: -1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Piston API error:', error);
      return res.status(response.status).json({ 
        error: 'Code execution failed',
        details: error 
      });
    }

    const result = await response.json();

    const runCode = result.run?.code ?? 0;
    const compileCode = result.compile?.code ?? 0;

    // Return execution result
    return res.status(200).json({
      success: runCode === 0 && compileCode === 0 && !result.run?.signal,
      output: result.run?.output || '',
      stdout: result.run?.stdout || '',
      stderr: result.run?.stderr || '',
      code: result.run?.code,
      signal: result.run?.signal,
      compile_output: result.compile?.output || ''
    });

  } catch (error) {
    console.error('Error executing code:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
};
