/** Dev/test hooks are ignored in packaged builds unless DURBAR_DEV=1: `npm run test:devhooks` (spec 010 FR-017..FR-020). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { devEnv, devWarning, hooksEnabled } from '../src/main/devhooks';

const env = { DURBAR_SIM: '15', DURBAR_DRIVER: '/tmp/x.js', DURBAR_LOG: '/tmp/l', DURBAR_OPEN: '/a', DURBAR_PERM: 'allow', DURBAR_PICK: '/f', DURBAR_USER_DATA: '/u', DURBAR_SHOT: '/s.png', DURBAR_NEW_HOOK: 'x', HOME: '/h' } as NodeJS.ProcessEnv;
const HOOKS = ['DURBAR_SIM', 'DURBAR_DRIVER', 'DURBAR_LOG', 'DURBAR_OPEN', 'DURBAR_PERM', 'DURBAR_PICK', 'DURBAR_USER_DATA', 'DURBAR_SHOT', 'DURBAR_NEW_HOOK'];

// not packaged: every DURBAR_* hook is available, nothing else leaks through
let d = devEnv(env, false);
for (const k of HOOKS) assert.strictEqual(d[k], env[k], k);
assert.strictEqual(d.HOME, undefined);
assert.strictEqual(devWarning(env, false), undefined);

// packaged: all ignored, including hooks added in the future
d = devEnv(env, true);
for (const k of HOOKS) assert.strictEqual(d[k], undefined, `${k} must be ignored in a packaged build`);
assert.strictEqual(devWarning(env, true), undefined);

// packaged + explicit opt-in: exactly "1"
for (const v of [undefined, '', '0', 'true', 'yes', '11', ' 1']) {
  assert.strictEqual(hooksEnabled({ ...env, DURBAR_DEV: v } as NodeJS.ProcessEnv, true), false, `DURBAR_DEV=${v}`);
  assert.deepStrictEqual(devEnv({ ...env, DURBAR_DEV: v } as NodeJS.ProcessEnv, true), {});
}
const on = { ...env, DURBAR_DEV: '1' } as NodeJS.ProcessEnv;
assert.ok(hooksEnabled(on, true));
d = devEnv(on, true);
for (const k of HOOKS) assert.strictEqual(d[k], env[k], k);
assert.ok(/ACTIVE/.test(devWarning(on, true) ?? ''), 'packaged + opt-in warns');
assert.strictEqual(devWarning(on, false), undefined);

// regression guard: main-process code reads hooks only through devhooks.ts
const root = path.join(__dirname, '..', '..');
const srcRoot = fs.existsSync(path.join(root, 'src')) ? root : path.join(__dirname, '..');
const offenders: string[] = [];
for (const dir of ['src/main', 'src/adapters', 'src/shared', 'src/preload']) {
  const full = path.join(srcRoot, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith('.ts') || f === 'devhooks.ts') continue;
    const text = fs.readFileSync(path.join(full, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/process\.env\.DURBAR_|process\.env\[/.test(text)) offenders.push(`${dir}/${f}`);
  }
}
assert.deepStrictEqual(offenders, [], 'read hooks from devEnv(), not process.env: ' + offenders.join(', '));
console.log('devhooks: all checks passed');
