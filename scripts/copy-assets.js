// Copies the static renderer assets (HTML, CSS, plain-JS app and demo data) into dist/renderer.
// The TypeScript renderer scripts (renderer.ts, sim.ts) are compiled there by tsc.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'renderer');
const outDir = path.join(root, 'dist', 'renderer');
fs.mkdirSync(outDir, { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'harnesses.js', 'demo.js', 'markdown.js', 'dialog.js', 'roomsummary.js', 'sessionsearch.js', 'usagetotals.js', 'costtable.js', 'modelswitch.js', 'schedtemplates.js', 'places.js', 'place-icons.js', 'mood.js', 'attention.js', 'toolstats.js', 'theme.js', 'themes.css', 'scenekits.js', 'screens.js', 'screens.css']) {
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
}
// Markdown parser and sanitiser, bundled from node_modules (no CDN); exact versions are pinned in package.json.
const vendor = path.join(outDir, 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'), path.join(vendor, 'marked.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js'), path.join(vendor, 'purify.min.js'));
// spec 008 FR-025: the window icon on Linux (the packaged app reads it from app.asar)
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'dist', 'icon.png'));
console.log('copied renderer assets -> dist/renderer, icon -> dist/icon.png');
