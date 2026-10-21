/**
 * spec 012 T044: the packaged-build check on the OS it runs on (CI: `.github/workflows/packaged-check.yml`, macOS, Windows, Linux).
 *   npm run pack:dir && node scripts/pack-esm-ci.js
 * Starts the unpacked app from `release/` with the developer opt-in and `scripts/pack-esm-check.js` as the driver, then checks
 * what it found inside `app.asar`: the ESM import works from the CommonJS main process, a missing Claude Agent SDK is
 * "not available" without an error, both offered harnesses are registered, and the SDK transport falls back to the CLI.
 * No SDK, no claude, no codex run, no credits. Exits 1 on any mismatch.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const rel = path.join(root, 'release');

function findApp() {
  const dirs = fs.existsSync(rel) ? fs.readdirSync(rel) : [];
  if (process.platform === 'win32') {
    const d = dirs.find((x) => /^win.*unpacked$/.test(x));
    return d && path.join(rel, d, 'Agent Durbar.exe');
  }
  if (process.platform === 'darwin') {
    const d = dirs.find((x) => /^mac/.test(x) && fs.existsSync(path.join(rel, x, 'Agent Durbar.app')));
    return d && path.join(rel, d, 'Agent Durbar.app', 'Contents', 'MacOS', 'Agent Durbar');
  }
  const d = dirs.find((x) => /^linux.*unpacked$/.test(x));
  return d && path.join(rel, d, 'agent-durbar');
}

const app = findApp();
assert.ok(app && fs.existsSync(app), `no unpacked app in ${rel}: run npm run pack:dir first`);
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pack-')), 'result.json');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pack-ud-'));
const env = {
  ...process.env,
  DURBAR_DEV: '1',
  DURBAR_CLAUDE_TRANSPORT: 'sdk',
  DURBAR_DRIVER: path.join(__dirname, 'pack-esm-check.js'),
  DURBAR_USER_DATA: userData,
  PACK_ESM_OUT: out,
};
const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
// Linux without a display: wrap in xvfb-run. No shell: fixed arguments only.
const [file, argv] = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', app, ...args]] : [app, args];
const r = spawnSync(file, argv, { env, encoding: 'utf8', timeout: 120000 });
process.stdout.write((r.stdout || '').split('\n').filter((l) => l.includes('[pack-esm]') || l.includes('DRIVER FAILED')).join('\n') + '\n');
assert.ok(fs.existsSync(out), `the driver wrote no result (exit ${r.status}, signal ${r.signal}): ${(r.stderr || '').slice(-800)}`);
const got = JSON.parse(fs.readFileSync(out, 'utf8'));
console.log(process.platform, JSON.stringify(got));
assert.strictEqual(got.packaged, true, 'runs as a packaged app');
assert.strictEqual(got.esmBuiltin, true, 'import() of a builtin from the CommonJS main process');
assert.strictEqual(got.esmFromAsar, true, 'import() of a file inside app.asar');
assert.strictEqual(got.loadSdk, 'undefined', 'a missing SDK is "not available", not an error');
assert.deepStrictEqual([...got.registered].sort(), ['claude', 'codex'], 'both offered harnesses are registered');
assert.strictEqual(got.transport, 'cli', 'the SDK transport falls back to the CLI');
fs.rmSync(path.dirname(out), { recursive: true, force: true });
fs.rmSync(userData, { recursive: true, force: true });
console.log('packaged check passed on', process.platform);
