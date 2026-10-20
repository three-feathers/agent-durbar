/** App name and profile folder (spec 008 FR-033..FR-035, T037). `npm run test:profiledir`. Runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { profileDir } from '../src/main/profiledir';
import { MENU_APP_NAME } from '../src/main/appmenu';
import { aboutPanelOptions } from '../src/shared/about';

const ROOT = path.join(__dirname, '..', '..');
const SAMPLES: Array<[string, string, string, string]> = [
  ['win32', 'C:\\Users\\Ana\\AppData\\Roaming', 'C:\\Users\\Ana\\AppData\\Roaming\\agent-durbar', 'C:\\Users\\Ana\\AppData\\Roaming\\agent-durbar-dev'],
  ['darwin', '/Users/ana/Library/Application Support', '/Users/ana/Library/Application Support/agent-durbar', '/Users/ana/Library/Application Support/agent-durbar-dev'],
  ['linux', '/home/ana/.config', '/home/ana/.config/agent-durbar', '/home/ana/.config/agent-durbar-dev'],
];
for (const [platform, appData, installed, dev] of SAMPLES) {
  const base = { platform, appData };
  assert.strictEqual(profileDir({ ...base, packaged: true, env: {} }), installed, `${platform} packaged`);
  assert.strictEqual(profileDir({ ...base, packaged: false, env: {} }), dev, `${platform} dev`);
  assert.notStrictEqual(installed, dev);
  // DURBAR_USER_DATA wins in dev, and in a packaged build only with DURBAR_DEV=1
  assert.strictEqual(profileDir({ ...base, packaged: false, env: { DURBAR_USER_DATA: '/tmp/x' } }), '/tmp/x');
  assert.strictEqual(profileDir({ ...base, packaged: true, env: { DURBAR_USER_DATA: '/tmp/x', DURBAR_DEV: '1' } }), '/tmp/x');
  assert.strictEqual(profileDir({ ...base, packaged: true, env: { DURBAR_USER_DATA: '/tmp/x' } }), installed, 'ignored when packaged without the opt-in');
  assert.strictEqual(profileDir({ ...base, packaged: true, env: { DURBAR_USER_DATA: '/tmp/x', DURBAR_DEV: 'true' } }), installed);
  assert.strictEqual(profileDir({ ...base, packaged: false, env: { DURBAR_USER_DATA: '' } }), dev, 'empty override is ignored');
}
assert.ok(profileDir({ platform: 'win32', appData: 'C:\\A', packaged: true, env: {} }).includes('\\'), 'Windows paths use backslashes');
assert.ok(!profileDir({ platform: 'win32', appData: 'C:\\A', packaged: false, env: {} }).includes('/'));

// one name everywhere
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.strictEqual(MENU_APP_NAME, 'Agent Durbar');
assert.strictEqual(MENU_APP_NAME, pkg.build.productName);
assert.strictEqual(MENU_APP_NAME, aboutPanelOptions('x').applicationName);
assert.strictEqual(pkg.name, 'agent-durbar');
assert.strictEqual(pkg.productName, undefined, 'a top-level productName would move the profile folder');

// main.ts order (D2): the folder is set before anything reads it and before whenReady; no setName at all
const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
const setPath = main.indexOf("app.setPath('userData', profileDir(");
const firstGet = main.indexOf("getPath('userData')");
const ready = main.indexOf('app.whenReady()');
assert.ok(setPath > 0 && setPath < firstGet && firstGet < ready, 'setPath(userData, profileDir) before the first getPath(userData) and whenReady');
assert.ok(!/app\.setPath\('userData', dev\.DURBAR_USER_DATA\)/.test(main), 'the old bare DURBAR_USER_DATA line is gone');
// no setName: the identity (app.getName() = agent-durbar) keeps the Keychain item "agent-durbar Safe Storage", libsecret and WM_CLASS (D2)
assert.ok(!/app\.setName\(/.test(main), 'main.ts must not call app.setName');
console.log('profiledir ok');
