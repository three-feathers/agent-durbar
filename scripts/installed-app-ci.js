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
// Spec 008 FR-042/FR-045: the names a user sees, from package.json (never literals). Asserted only here, in CI.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const productName = pkg.build.productName;
const appId = pkg.build.appId;
const desktopId = pkg.desktopName.replace(/\.desktop$/, '');
// Name checks are collected, not thrown: the facts, the launch and the uninstall still happen, and the run fails at the end with every message.
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(`names check failed: ${msg}`); return !!cond; };

/** Windows: System.AppUserModel.ID of a .lnk. A fixed PowerShell script (written to a temp file); the only input is the shortcut path, passed as an argument, no shell. */
const AUMID_PS1 = `
param([string]$Path)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct PropKey { public Guid fmtid; public uint pid; }
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  void GetCount(out uint c);
  void GetAt(uint i, out PropKey k);
  void GetValue(ref PropKey k, IntPtr pv);
  void SetValue(ref PropKey k, IntPtr pv);
  void Commit();
}
public static class Aumid {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
  public static string Read(string path) {
    Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
    IPropertyStore ps;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0, ref iid, out ps));
    PropKey key = new PropKey(); key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); key.pid = 5;
    IntPtr pv = Marshal.AllocCoTaskMem(32);
    try {
      for (int i = 0; i < 32; i++) Marshal.WriteByte(pv, i, 0);
      ps.GetValue(ref key, pv);
      return Marshal.ReadInt16(pv) == 31 ? Marshal.PtrToStringUni(Marshal.ReadIntPtr(pv, 8)) : "";
    } finally { Marshal.FreeCoTaskMem(pv); }
  }
}
'@
[Console]::Out.WriteLine([Aumid]::Read($Path))
`;
function shortcutAumid(lnk) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-aumid-'));
  try {
    const ps1 = path.join(tmp, 'aumid.ps1');
    fs.writeFileSync(ps1, AUMID_PS1);
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, lnk]);
    if (!check(r.status === 0, `reading the AppUserModelId of ${lnk} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-400)}`)) return '(unreadable)';
    return (r.stdout || '').trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
/** Windows: the shell's Desktop folder (NSIS writes to $DESKTOP, which OneDrive may redirect). Fixed command, no user text. */
function desktopFolder() {
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"]);
  return (r.stdout || '').trim();
}

function launch(exe, extraArgs = []) {
  const resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-inst-'));
  const udDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-inst-ud-'));
  const res = path.join(resDir, 'result.json');
  const env = { ...process.env, DURBAR_DEV: '1', DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1', DURBAR_DRIVER: path.join(__dirname, 'installed-app-check.js'), DURBAR_USER_DATA: udDir, INSTALLED_OUT: res, INSTALLED_SHOT: shotFile };
  // The AppImage is started without --no-sandbox so its AppRun probe (`unshare -Ur true`) decides, as for a user (spec 008 FR-041); `app.noSandbox` records what it did.
  const args = [...extraArgs];
  const [file, argv] = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', exe, ...args]] : [exe, args];
  const r = run(file, argv, { env, timeout: 180000 });
  try {
    assert.ok(fs.existsSync(res), `the installed app wrote no result (exit ${r.status}): ${(r.stderr || '').slice(-600)}`);
    return JSON.parse(fs.readFileSync(res, 'utf8'));
  } finally {
    fs.rmSync(resDir, { recursive: true, force: true });
    fs.rmSync(udDir, { recursive: true, force: true });
  }
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
  // FR-042: shortcut names, uninstall DisplayName and the shortcut's AppUserModelId (fixed arguments, fixed PowerShell script, no user text)
  const lnkName = `${productName}.lnk`;
  const startLnk = path.join(menu, lnkName);
  check(fs.existsSync(startLnk), `Start menu shortcut "${lnkName}" not found (found: ${facts.startMenu.join(', ') || 'none'})`);
  const desktop = desktopFolder();
  const deskLnk = path.join(desktop, lnkName);
  facts.desktopShortcut = desktop && fs.existsSync(deskLnk) ? lnkName : '(none)';
  check(!!desktop, 'could not read the Desktop folder from Windows');
  if (desktop) check(fs.existsSync(deskLnk), `desktop shortcut "${lnkName}" not found at ${deskLnk}`);
  const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
  const reg = run('reg', ['query', uninstallKey, '/s', '/v', 'DisplayName']);
  const shown = (reg.stdout || '').split(/\r?\n/).map((l) => (l.match(/^\s+DisplayName\s+REG_SZ\s+(.*?)\s*$/) || [])[1]).filter(Boolean);
  facts.displayName = shown.filter((n) => n.startsWith(productName)).join(', ');
  check(shown.includes(`${productName} ${pkg.version}`), `uninstall DisplayName "${productName} ${pkg.version}" not in the registry (found: ${shown.filter((n) => /durbar/i.test(n)).join(', ') || 'none'})`);
  facts.shortcutAumid = shortcutAumid(startLnk);
  check(facts.shortcutAumid === appId, `Start menu shortcut AppUserModelId is "${facts.shortcutAumid}", expected "${appId}"`);
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
  // FR-042/FR-044: the bundle names a user sees (Finder, Dock, Cmd-Tab)
  for (const [k, v] of Object.entries({ CFBundleName: productName, CFBundleDisplayName: productName, CFBundleExecutable: productName, CFBundleIdentifier: appId })) check(facts[k] === v, `Info.plist ${k} is "${facts[k]}", expected "${v}"`);
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
  let t = '';
  if (desk) {
    t = fs.readFileSync(path.join(root, desk), 'utf8');
    facts.desktopFile = desk;
    facts.desktopName = (t.match(/^Name=(.*)$/m) || [])[1];
    facts.desktopWmClass = (t.match(/^StartupWMClass=(.*)$/m) || [])[1];
    facts.desktopExec = (t.match(/^Exec=(.*)$/m) || [])[1];
    facts.desktopIcon = (t.match(/^Icon=(.*)$/m) || [])[1];
  }
  fs.rmSync(ex, { recursive: true, force: true });
  // FR-040/FR-041: the launcher entry; no forced --no-sandbox in Exec
  check(desk, 'no .desktop file in the AppImage');
  check(desk === `${desktopId}.desktop`, `.desktop file is "${desk}", expected "${desktopId}.desktop"`);
  for (const [k, v] of Object.entries({ desktopName: productName, desktopWmClass: desktopId, desktopIcon: desktopId, desktopExec: 'AppRun %U' })) check(facts[k] === v, `.desktop ${k.replace('desktop', '')} is "${facts[k]}", expected "${v}"`);
  // AppRun adds --no-sandbox only when `unshare -Ur true` fails; run the same probe here and compare with what the app saw in its argv.
  facts.usernsAvailable = run('unshare', ['-Ur', 'true']).status === 0;
  facts.result = launch(p, ['--appimage-extract-and-run']);
  check(facts.result.noSandbox === !facts.usernsAvailable, `AppRun ${facts.result.noSandbox ? 'added' : 'did not add'} --no-sandbox but unprivileged user namespaces are ${facts.usernsAvailable ? 'available' : 'not available'}`);
}

facts.nameFailures = failures;
fs.writeFileSync(outFile, JSON.stringify(facts, null, 2));
const r = facts.result || {};
console.log(`\n### Installed app on ${process.platform}\n\n| Fact | Value |\n|---|---|`);
for (const [k, v] of Object.entries({ ...facts, result: undefined, ...Object.fromEntries(Object.entries(r).map(([k2, v2]) => ['app.' + k2, v2])) })) if (v !== undefined) console.log(`| ${k} | ${String(Array.isArray(v) ? v.join(', ') : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`);
assert.strictEqual(failures.length, 0, `${failures.length} name check(s) failed:\n - ${failures.join('\n - ')}`);
assert.strictEqual(r.packaged, true, 'the installed app runs packaged');
assert.strictEqual(r.office, true, 'the office rendered');
assert.ok(r.desks >= 15, 'all 15 simulated agents are on screen');
console.log('\ninstalled-app check passed on', process.platform);
