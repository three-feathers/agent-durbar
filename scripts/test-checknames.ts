/** check-names.js and the Windows AUMID (spec 008 FR-043, FR-045, T039). `npm run test:checknames`. Runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { APP_USER_MODEL_ID, aumidToSet } from '../src/main/aumid';

const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cn = require(path.join(root, 'scripts', 'check-names.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exp = cn.expectedOf(pkg);
assert.deepStrictEqual(exp, { name: 'agent-durbar', version: pkg.version, productName: 'Agent Durbar', appId: pkg.build.appId, desktopId: 'agent-durbar' });

// asar package.json: the real one passes; each deviation fails
const asarOk = { name: pkg.name, desktopName: pkg.desktopName, version: pkg.version };
assert.deepStrictEqual(cn.compareAsarPackage(asarOk, exp), []);
assert.strictEqual(cn.compareAsarPackage({ ...asarOk, productName: 'Agent Durbar' }, exp).length, 1, 'a top-level productName fails');
assert.strictEqual(cn.compareAsarPackage({ ...asarOk, name: 'agent-durbar2' }, exp).length, 1, 'a changed name fails');
assert.strictEqual(cn.compareAsarPackage({ ...asarOk, desktopName: 'other.desktop' }, exp).length, 1, 'a changed desktopName fails');

// .desktop of the AppImage (the text electron-builder writes, FR-040/FR-041)
const desktop = (o: Record<string, string> = {}) => {
  const f = { Name: 'Agent Durbar', Exec: 'AppRun %U', Terminal: 'false', Type: 'Application', Icon: 'agent-durbar', StartupWMClass: 'agent-durbar', Comment: 'Name=decoy', ...o };
  return '[Desktop Entry]\n' + Object.entries(f).map(([k, v]) => `${k}=${v}`).join('\n') + '\n[Desktop Action x]\nName=Other\nExec=other\n';
};
assert.deepStrictEqual(cn.compareDesktop(desktop(), exp), []);
assert.strictEqual(cn.compareDesktop(desktop({ Name: 'agent-durbar' }), exp).length, 1, 'productName changed');
assert.strictEqual(cn.compareDesktop(desktop({ StartupWMClass: 'durbar' }), exp).length, 1, 'desktopName changed');
assert.strictEqual(cn.compareDesktop(desktop({ Icon: 'x' }), exp).length, 1);
assert.strictEqual(cn.compareDesktop(desktop({ Exec: 'AppRun --no-sandbox %U' }), exp).length, 1, 'forced --no-sandbox fails');
assert.strictEqual(cn.compareDesktop('[Desktop Action x]\nName=Agent Durbar\n', exp).length, 4, 'fields of other sections do not count');

// changed copy of the config: expected values move with package.json, the packed values then differ
const changed = (f: (p: any) => void) => { const c = JSON.parse(JSON.stringify(pkg)); f(c); return cn.expectedOf(c); };
assert.ok(cn.compareDesktop(desktop(), changed((c) => { c.build.productName = 'Durbar'; })).length > 0, 'changed productName fails');
assert.ok(cn.compareDesktop(desktop(), changed((c) => { c.desktopName = 'durbar.desktop'; })).length > 0, 'changed desktopName fails');
assert.ok(cn.compareAsarPackage(asarOk, changed((c) => { c.desktopName = 'durbar.desktop'; })).length > 0);
assert.ok(cn.compareAsarPackage({ ...asarOk, productName: 'Agent Durbar' }, exp).length > 0, 'added top-level productName fails');

// Windows version resource and macOS Info.plist
assert.deepStrictEqual(cn.compareVersionStrings({ ProductName: 'Agent Durbar', FileDescription: 'Agent Durbar', CompanyName: 'Three Feathers' }, exp), []);
assert.strictEqual(cn.compareVersionStrings({ ProductName: 'Agent Durbar', FileDescription: 'agent-durbar' }, exp).length, 1);
assert.strictEqual(cn.compareVersionStrings({}, exp).length, 2);
const plist = { CFBundleName: 'Agent Durbar', CFBundleDisplayName: 'Agent Durbar', CFBundleExecutable: 'Agent Durbar', CFBundleIdentifier: pkg.build.appId };
assert.deepStrictEqual(cn.comparePlist(plist, exp), []);
for (const k of Object.keys(plist)) assert.strictEqual(cn.comparePlist({ ...plist, [k]: 'agent-durbar' }, exp).length, 1, `${k} differs`);

// a fake release/ tree: missing pieces are reported, and an empty tree checks nothing
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-names-'));
try {
  const r0 = cn.checkRelease('linux', fake, exp);
  assert.ok(r0.problems.length >= 2, 'no packed Linux app: problems reported');
  assert.ok(cn.checkRelease('freebsd', fake, exp).problems.length === 1);
  assert.ok(cn.checkRelease('darwin', fake, exp).problems.length === 1);
} finally {
  fs.rmSync(fake, { recursive: true, force: true });
}

// FR-043: one AUMID, equal to build.appId, packaged Windows only
assert.strictEqual(APP_USER_MODEL_ID, pkg.build.appId);
assert.strictEqual(aumidToSet('win32', true), pkg.build.appId);
assert.strictEqual(aumidToSet('win32', false), null, 'dev run on Windows: no call (D1)');
for (const p of ['linux', 'darwin'] as NodeJS.Platform[]) for (const packaged of [true, false]) assert.strictEqual(aumidToSet(p, packaged), null, `${p} never`);

/** Source text without comments (TypeScript scanner), so a decoy comment cannot satisfy or break the checks below. */
function stripComments(src: string): string {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
  let out = '';
  for (let t = sc.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = sc.scan()) {
    if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) out += ' ';
    else out += sc.getTokenText();
  }
  return out;
}
assert.ok(!stripComments('a // app.setAppUserModelId(x)\n b').includes('setAppUserModelId'));
const main = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8'));
const compute = main.indexOf('aumidToSet(process.platform, app.isPackaged)');
const call = main.indexOf('app.setAppUserModelId(aumid)');
const ready = main.indexOf('app.whenReady()');
const firstWindow = main.indexOf('new BrowserWindow(');
assert.ok(compute > 0 && call > compute, 'main.ts decides with aumidToSet(process.platform, app.isPackaged), then calls setAppUserModelId');
assert.ok(call < ready && call < firstWindow, 'setAppUserModelId comes before whenReady and any window');
assert.strictEqual(main.split('setAppUserModelId(').length - 1, 1, 'exactly one setAppUserModelId call');
assert.ok(/if\s*\(\s*aumid\s*\)\s*app\.setAppUserModelId\(aumid\)/.test(main), 'the call is guarded by the decision');
assert.ok(!/app\.setName\(/.test(main), 'main.ts must not call app.setName');

// package.json: the build scripts run the check, AppImage has no forced --no-sandbox
for (const s of ['pack:dir', 'dist', 'dist:mac:arm64', 'dist:mac:x64', 'dist:win', 'dist:linux']) {
  assert.ok(/check-fuses\.js && node scripts\/check-names\.js$/.test(pkg.scripts[s]), `${s} runs check-names.js after check-fuses.js`);
}
assert.deepStrictEqual(pkg.build.appImage.executableArgs, [], 'FR-041: no forced --no-sandbox in the desktop entry');
assert.ok(pkg.scripts['test:serial'].includes('npm run test:checknames'));
console.log('checknames ok');
