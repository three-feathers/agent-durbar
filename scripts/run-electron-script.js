/* Starts an Electron script from `npm run`: `node scripts/run-electron-script.js <script.js> [args]`. On Linux Electron's SUID sandbox helper
   aborts (CI, containers) unless `--no-sandbox` is on the command line before Chromium starts, which a switch set inside the script is too late
   for; `world-matrix.js` passes it the same way. Elsewhere no flag is added. Used by `check:world-distinct` and `world:contact-sheet`
   (dev-side scripts that load only data: pages), never for the app. */
'use strict';
const { spawnSync } = require('child_process');

/** The arguments after the Electron binary: the script and its arguments, with `--no-sandbox` first on Linux only. */
function electronArgs(platform, script, args = []) {
  return [...(platform === 'linux' ? ['--no-sandbox'] : []), script, ...args];
}

module.exports = { electronArgs };

if (require.main === module) {
  const [script, ...args] = process.argv.slice(2);
  if (!script) { console.error('usage: node scripts/run-electron-script.js <script.js> [args]'); process.exit(2); }
  const r = spawnSync(require('electron'), electronArgs(process.platform, script, args), { stdio: 'inherit', shell: false, windowsHide: true });
  if (r.error) { console.error(r.error.message); process.exit(2); }
  process.exit(r.status === null ? 1 : r.status);
}
