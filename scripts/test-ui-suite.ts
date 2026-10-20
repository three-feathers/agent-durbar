/** Unit test (spec 008 FR-091): the ui-suite driver list is not stale, and the runner never uses a shell. No Electron is started. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'scripts', 'ui-suite.js');
const names = execFileSync(process.execPath, [SUITE, '--list'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
assert.ok(names.length >= 15, `ui-suite lists ${names.length} drivers`);
for (const n of names) {
  const file = n.split(' ')[0];
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', file + '.js')), `listed driver exists: ${file}`);
}
const src = fs.readFileSync(SUITE, 'utf8');
assert.ok(/shell: false/.test(src) && !/shell: true/.test(src) && !/execSync\(|exec\(/.test(src), 'the runner spawns without a shell');
assert.ok(/require\('electron'\)/.test(src), 'it starts the Electron binary directly');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
assert.ok(/app\.exit\(failed \? 1 : 0\)/.test(main), 'a failing driver exits 1 (FR-090)');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ui-platforms.yml'), 'utf8');
for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(wf.includes(os), `the workflow runs on ${os}`);
for (const step of ['check-theme-geometry.js', 'check-office-overlap.js', 'check-mac-titlebar.js', 'ui-suite.js']) assert.ok(wf.includes(step), `the workflow runs ${step}`);
console.log(`ui-suite: ${names.length} drivers listed and present; no shell; driver failures exit 1; workflow covers 3 OSes`);
