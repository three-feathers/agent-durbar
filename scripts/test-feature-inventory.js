/*
 * Spec 025 FR-021 (`npm run test:featureinventory`): scripts/feature-inventory.js on throwaway copies of the real inputs.
 * The real file must pass; each mutation must fail with its own message (bad state, unknown spec, dead proof tag, unknown
 * registry moment, built spec left out, shippable world without a built Helpers row).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check } = require('./feature-inventory.js');

process.exitCode = 1;
const ROOT = path.join(__dirname, '..');
const dirs = [];
function copy(mut) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-fi-'));
  dirs.push(d);
  const put = (f, fn) => {
    const t = path.join(d, ...f.split('/'));
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, fn(fs.readFileSync(path.join(ROOT, ...f.split('/')), 'utf8')));
  };
  const same = (x) => x;
  put('package.json', same);
  put('docs/feature-inventory.md', mut.md || same);
  put('docs/experience/world-moments.json', mut.reg || same);
  for (const s of fs.readdirSync(path.join(ROOT, 'specs')).filter((x) => /^\d{3}-/.test(x))) put(`specs/${s}/spec.md`, same);
  return d;
}
const fails = (mut, re) => assert.ok(check(copy(mut)).some((m) => re.test(m)), `expected a problem matching ${re}`);
try {
  assert.deepStrictEqual(check(ROOT), [], 'the real inventory passes');
  fails({ md: (t) => t.replace('| Desk: name, role, status word, task | works', '| Desk: name, role, status word, task | kinda') }, /must start with one of/);
  fails({ md: (t) => t.replace('| 001 034 097 |', '| 001 034 999 |') }, /spec 999 has no folder/);
  fails({ md: (t) => t.replace('test:mood driver:shots-097-realoffice', 'test:nonesuch') }, /no npm script test:nonesuch/);
  fails({ md: (t) => t.replace('mock+planned (desk-card)', 'mock+planned (no-such-moment)') }, /no moment/);
  fails({ md: (t) => t.replace('mock+planned (desk-card)', 'built (desk-card)') }, /code: present/);
  fails({ md: (t) => t.replace(/\| OS sandbox[^\n]*\n/, '') }, /087-.* built but in no row/);
  fails({ md: (t) => t.replace('in PR 097-p2-screens', 'in PR') }, /must name the branch/);
  fails({ md: (t) => t.replace('Exempt: 002 ', 'Exempt: ') }, /002-.* built but in no row/);
  fails({ md: (t) => t.replace(/\| Helpers[^\n]*\n/, '') , reg: (t) => t.replace('"shippable": false', '"shippable": true') }, /shippable: true/);
  fails({ reg: (t) => t.replace('"shippable": false', '"shippable": true') }, /shippable: true/);
  process.exitCode = 0;
  console.log('test-feature-inventory: ok');
} finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
