#!/usr/bin/env node
// Spec 102 FR-303, T265b: tests of scripts/build-character-groups.py and of the group pictures it made (src/renderer/realoffice/groups/).
// Offline, no AI credits, only the shipped set pictures. Without python3 + Pillow the committed pictures are still checked (one per set, a WebP,
// at most 64 KB); the rebuild comparison, the script's own selftest and the mutants need Pillow, like test-realoffice-assets.ts's build checks.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');
const SCRIPT = path.join(__dirname, 'build-character-groups.py');
const MAX = 64 * 1024; // FR-303

const sets = fs.readdirSync(path.join(RO, 'sets')).filter((d) => fs.existsSync(path.join(RO, 'sets', d, 'set.json'))).sort();
assert.ok(sets.length >= 9, 'the sets are found');
const groups = fs.readdirSync(path.join(RO, 'groups')).filter((f) => f.endsWith('.webp')).sort();
assert.deepStrictEqual(groups, sets.map((s) => `${s}.webp`), 'one group picture per character set, none without a set');
for (const f of fs.readdirSync(path.join(RO, 'groups'))) assert.ok(f.endsWith('.webp') || f === 'ASSETS.md', `only pictures and ASSETS.md in groups/: ${f}`);
for (const g of groups) {
  const b = fs.readFileSync(path.join(RO, 'groups', g));
  assert.ok(b.length <= MAX, `${g}: ${b.length} bytes is over 64 KB (FR-303)`);
  assert.ok(b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', `${g} is a WebP`);
  for (const chunk of ['EXIF', 'XMP ', 'ICCP']) assert.ok(!b.includes(chunk), `${g} has no ${chunk.trim()} chunk`);
}
const asset = fs.readFileSync(path.join(RO, 'groups', 'ASSETS.md'), 'utf8');
for (const g of groups) assert.ok(asset.includes('`' + g + '`'), `groups/ASSETS.md names ${g}`);
console.log(`${groups.length} group pictures, largest ${Math.max(...groups.map((g) => fs.statSync(path.join(RO, 'groups', g)).size))} bytes of ${MAX}`);

// the script's FACE_U is the app's (realoffice-layout.ts): one number for "a face's share of the body"
const ts = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'realoffice-layout.ts'), 'utf8');
const py = fs.readFileSync(SCRIPT, 'utf8');
assert.strictEqual(py.match(/^FACE_U = ([\d.]+)/m)[1], ts.match(/export const FACE_U = ([\d.]+)/)[1], 'FACE_U matches realoffice-layout.ts');

const run = (args, env = {}) => spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const have = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
if (have.error || have.status !== 0) console.log('group rebuild, selftest and mutants skipped: need python3 with Pillow (the committed pictures are checked above)');
else {
  let r = run(['--selftest']);
  assert.strictEqual(r.status, 0, 'build-character-groups.py --selftest: ' + r.stdout + r.stderr);
  r = run(['--check']);
  assert.strictEqual(r.status, 0, 'the committed pictures are what the set pictures give (npm run groups:build): ' + r.stdout + r.stderr);
  r = run(['--bogus']);
  assert.notStrictEqual(r.status, 0, 'an unknown flag is refused');
  // mutants: each change to the script must fail its selftest
  for (const m of ['unsorted', 'uncentred', 'unclamped', 'nobudget']) {
    r = run(['--selftest'], { CG_MUTANT: m });
    assert.notStrictEqual(r.status, 0, `mutant ${m} must fail the selftest`);
  }
  console.log('selftest, rebuild comparison and 4 mutants ok');
}
console.log('character-groups: ok');
