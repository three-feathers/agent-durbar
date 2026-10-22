/*
 * Make sure the Electron binary is installed, once, before a runner starts several jobs that need it (spec 008 FR-114).
 *
 * Electron 44 has no postinstall: the first `require('electron')` downloads and unpacks the binary into node_modules/electron/dist.
 * Several jobs doing that at the same time race: one reads a half-written binary ("Could not find sentinel", Windows, #424) or
 * runs it while another job still writes it ("Text file busy", exit 126, Linux, PR #546). So `npm test` (run-tests.js),
 * `check:parallel` (check-parallel.js) and `ui-suite.js` call this first. Electron's own check makes it a no-op when the binary
 * is already there, so it is safe to call every time. A child `node` process (no shell) does the require, so the runner itself
 * never caches a failed require, and the download's progress lines go to the runner's own output.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** True when the Electron binary is installed (fetched now if it was missing). `spawn` is for tests. */
function ensureElectron({ spawn = spawnSync, cwd = ROOT } = {}) {
  const r = spawn(process.execPath, ['-e', "require('electron')"], { cwd, stdio: 'inherit', shell: false, windowsHide: true });
  return !!r && r.status === 0;
}

module.exports = { ensureElectron };
