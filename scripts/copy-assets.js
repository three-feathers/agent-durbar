// Copies the office-view prototype into dist/renderer and injects the compiled renderer script.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'renderer');
fs.mkdirSync(outDir, { recursive: true });
let html = fs.readFileSync(path.join(root, 'prototype', 'index.html'), 'utf8');
const tag = '<script src="renderer.js"></script>';
html = html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + '\n' + tag;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log('copied prototype/index.html -> dist/renderer/index.html');
