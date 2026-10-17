// Copies the static renderer assets (HTML, CSS, plain-JS app and demo data) into dist/renderer.
// The TypeScript renderer scripts (renderer.ts, sim.ts) are compiled there by tsc.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'renderer');
const outDir = path.join(root, 'dist', 'renderer');
fs.mkdirSync(outDir, { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'demo.js', 'markdown.js', 'dialog.js', 'roomsummary.js', 'usagetotals.js', 'modelswitch.js', 'places.js', 'toolstats.js', 'screens.js', 'screens.css']) {
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
}
// Markdown parser and sanitiser, bundled from node_modules (no CDN); exact versions are pinned in package.json.
const vendor = path.join(outDir, 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'), path.join(vendor, 'marked.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), path.join(vendor, 'purify.min.js'));
console.log('copied renderer assets -> dist/renderer');
