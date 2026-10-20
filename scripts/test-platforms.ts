/** Unit test (spec 062 FR-004): one list of supported CI platforms, used by every OS-matrix workflow that real-checks the app. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const list = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'platforms.json'), 'utf8')) as unknown;
assert.ok(Array.isArray(list) && list.length >= 3 && list.every((x) => typeof x === 'string' && /^[a-z0-9.-]+$/.test(x)), 'platforms.json: a list of runner labels');
for (const os of ['ubuntu', 'macos', 'windows']) assert.ok((list as string[]).some((x) => x.startsWith(os)), `platforms.json covers ${os}`);
for (const wf of ['e2e-real.yml', 'install-check.yml']) {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf), 'utf8');
  assert.ok(y.includes('.github/platforms.json') && y.includes('fromJSON(needs.platforms.outputs.list)'), `${wf} takes its matrix from platforms.json`);
  assert.ok(!/os:\s*\[\s*ubuntu/.test(y), `${wf} has no hard-coded OS list`);
}
// the real-account workflow never runs PR code with the secrets
const e2e = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-real.yml'), 'utf8');
assert.ok(!/^\s*pull_request(_target)?\s*:/m.test(e2e), 'e2e-real.yml does not run on pull_request');
assert.strictEqual((e2e.match(/\$\{\{\s*secrets\./g) ?? []).length, 3, 'secrets are used in one step only (three names)');
console.log(`platforms: ${(list as string[]).join(', ')}; e2e-real and install-check use the list; no pull_request with secrets`);
