// Copies the static renderer assets (HTML, CSS, plain-JS app and demo data) into dist/renderer.
// The TypeScript renderer scripts (renderer.ts, sim.ts) are compiled there by tsc.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'renderer');
const outDir = path.join(root, 'dist', 'renderer');
fs.mkdirSync(outDir, { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'demo.js']) {
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
}
console.log('copied renderer assets -> dist/renderer');
