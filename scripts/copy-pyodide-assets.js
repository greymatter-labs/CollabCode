const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'node_modules', 'pyodide');
const targetDir = path.join(__dirname, 'pyodide');
const assets = [
  'pyodide.js',
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json'
];

fs.mkdirSync(targetDir, { recursive: true });

for (const asset of assets) {
  fs.copyFileSync(path.join(sourceDir, asset), path.join(targetDir, asset));
}

console.log(`Copied ${assets.length} Pyodide assets to ${path.relative(process.cwd(), targetDir)}`);
