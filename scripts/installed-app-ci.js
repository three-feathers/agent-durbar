/**
 * Spec 008 T021 (CI: `.github/workflows/installed-app.yml`): install the release package the way a user does on the OS it runs on,
 * start the INSTALLED app with `scripts/installed-app-check.js` (simulator, no account, no credits), and record what a user sees:
 *   Windows: NSIS installer `/S` (per user), Start menu shortcut, installed exe, then the uninstaller `/S`;
 *   macOS:   the .dmg mounted, `Agent Durbar.app` copied to ~/Applications, Info.plist names, then the app;
 *   Linux:   the AppImage made executable, its .desktop `Name=`, then the AppImage itself (--appimage-extract-and-run).
 * Fixed argument lists only, no shell. Writes a Markdown table (stdout) and JSON (argv[2]); exits 1 when a check fails.
 *   npm run dist:<os> && node scripts/installed-app-ci.js <out.json> <shot.png>
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const [outFile, shotFile] = process.argv.slice(2);
assert.ok(outFile && shotFile, 'usage: installed-app-ci.js <out.json> <shot.png>');
const rel = path.join(__dirname, '..', 'release');
const files = fs.existsSync(rel) ? fs.readdirSync(rel) : [];
const run = (file, args, opts = {}) => spawnSync(file, args, { encoding: 'utf8', timeout: 300000, ...opts });
const facts = { os: process.platform };

function launch(exe, extraArgs = []) {
  const res = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-inst-')), 'result.json');
  const env = { ...process.env, DURBAR_DEV: '1', DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1', DURBAR_DRIVER: path.join(__dirname, 'installed-app-check.js'), DURBAR_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-inst-ud-')), INSTALLED_OUT: res, INSTALLED_SHOT: shotFile };
  const args = [...extraArgs, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
  const [file, argv] = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', exe, ...args]] : [exe, args];
  const r = run(file, argv, { env, timeout: 180000 });
  assert.ok(fs.existsSync(res), `the installed app wrote no result (exit ${r.status}): ${(r.stderr || '').slice(-600)}`);
  return JSON.parse(fs.readFileSync(res, 'utf8'));
}

if (process.platform === 'win32') {
  const setup = files.find((f) => /^Agent-Durbar-Setup-.*\.exe$/.test(f));
  assert.ok(setup, 'no NSIS installer in release/');
  facts.package = setup;
  const r = run(path.join(rel, setup), ['/S']);
  facts.installerExit = r.status;
  const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
  const dir = fs.readdirSync(programs).map((d) => path.join(programs, d)).find((d) => fs.existsSync(path.join(d, 'Agent Durbar.exe')));
  assert.ok(dir, `installed exe not found under ${programs}`);
  facts.installedTo = dir.replace(process.env.LOCALAPPDATA, '%LOCALAPPDATA%');
  const menu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  facts.startMenu = fs.readdirSync(menu).filter((f) => /durbar/i.test(f));
  facts.result = launch(path.join(dir, 'Agent Durbar.exe'));
  const un = fs.readdirSync(dir).find((f) => /^Uninstall .*\.exe$/.test(f));
  if (un) { facts.uninstaller = un; facts.uninstallExit = run(path.join(dir, un), ['/S']).status; }
} else if (process.platform === 'darwin') {
  const dmg = files.find((f) => f.endsWith('.dmg'));
  assert.ok(dmg, 'no .dmg in release/');
  facts.package = dmg;
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-dmg-'));
  assert.strictEqual(run('hdiutil', ['attach', '-nobrowse', '-mountpoint', mnt, path.join(rel, dmg)]).status, 0, 'hdiutil attach');
  const apps = path.join(os.homedir(), 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  const target = path.join(apps, 'Agent Durbar.app');
  fs.rmSync(target, { recursive: true, force: true });
  assert.strictEqual(run('cp', ['-R', path.join(mnt, 'Agent Durbar.app'), apps]).status, 0, 'copy the app to ~/Applications');
  run('hdiutil', ['detach', mnt]);
  const plist = path.join(target, 'Contents', 'Info.plist');
  for (const k of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleIdentifier', 'CFBundleExecutable']) facts[k] = (run('plutil', ['-extract', k, 'raw', plist]).stdout || '').trim();
  facts.result = launch(path.join(target, 'Contents', 'MacOS', facts.CFBundleExecutable || 'Agent Durbar'));
} else {
  const img = files.find((f) => f.endsWith('.AppImage'));
  assert.ok(img, 'no AppImage in release/');
  facts.package = img;
  const p = path.join(rel, img);
  fs.chmodSync(p, 0o755);
  const ex = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-appimage-'));
  run(p, ['--appimage-extract', '*.desktop'], { cwd: ex });
  const root = path.join(ex, 'squashfs-root');
  const desk = fs.existsSync(root) ? fs.readdirSync(root).find((f) => f.endsWith('.desktop')) : undefined;
  if (desk) {
    const t = fs.readFileSync(path.join(root, desk), 'utf8');
    facts.desktopFile = desk;
    facts.desktopName = (t.match(/^Name=(.*)$/m) || [])[1];
    facts.desktopWmClass = (t.match(/^StartupWMClass=(.*)$/m) || [])[1];
  }
  facts.result = launch(p, ['--appimage-extract-and-run']);
}

fs.writeFileSync(outFile, JSON.stringify(facts, null, 2));
const r = facts.result || {};
console.log(`\n### Installed app on ${process.platform}\n\n| Fact | Value |\n|---|---|`);
for (const [k, v] of Object.entries({ ...facts, result: undefined, ...Object.fromEntries(Object.entries(r).map(([k2, v2]) => ['app.' + k2, v2])) })) if (v !== undefined) console.log(`| ${k} | ${String(Array.isArray(v) ? v.join(', ') : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`);
assert.strictEqual(r.packaged, true, 'the installed app runs packaged');
assert.strictEqual(r.office, true, 'the office rendered');
assert.ok(r.desks >= 15, 'all 15 simulated agents are on screen');
console.log('\ninstalled-app check passed on', process.platform);
