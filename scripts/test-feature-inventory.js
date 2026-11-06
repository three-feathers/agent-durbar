/*
 * Spec 025 FR-021 (`npm run test:featureinventory`): scripts/feature-inventory.js on throwaway copies of the real inputs.
 * The real file must pass; each mutation must fail with its own message (bad state, unknown spec, dead proof tag, unknown
 * registry moment, built spec left out, shippable world without a built Helpers row); parity (spec 021 FR-078): a decision waives
 * only its own cell, a malformed marker fails, a `works` note with a limiting word is a gap, an unreadable crew.js is reported.
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
  put('src/renderer/crew.js', mut.crew || same);
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
  fails({ md: (t) => t.replace('missing (#1148)', 'in PR') }, /must name the branch/);
  fails({ md: (t) => t.replace('Exempt: 002 ', 'Exempt: ') }, /002-.* built but in no row/);
  fails({ md: (t) => t.replace(/\| Helpers[^\n]*\n/, '') , reg: (t) => t.replace('"shippable": false', '"shippable": true') }, /shippable: true/);
  fails({ reg: (t) => t.replace('"shippable": false', '"shippable": true') }, /shippable: true/);
  // parity (spec 021 FR-078)
  fails({ md: (t) => t.replace('missing (#1148)', 'missing') }, /Real office cell "missing" is not plain works/);
  fails({ md: (t) => t.replace('Helpers (sub-agents): card, tree, own chat, needs you | works | missing, only `+N` and 3 dots; planned as small figures beside the desk (#1139)', 'Helpers (sub-agents): card, tree, own chat, needs you | works | in PR 097-helpers') }, /Real office cell "in PR 097-helpers" is not plain works/);
  fails({ crew: (t) => t.replace('retro: false', 'retro: true') }, /world\(s\) retro offered, but Worlds "none" is not built and carries no owner decision of its own/);
  assert.ok(!check(copy({ md: (t) => t.replace('missing (#1148)', 'missing (owner decision, 2026-11-04)') })).some((m) => /Real office cell/.test(m)), 'a marker accepts a Real office gap');
  fails({ crew: (t) => t.replace('cave: false', 'cave: true') }, /world\(s\) cave offered, but Worlds "none" is not built/);
  // a decision waives only its own cell
  const HALO = 'row "Waiting desk halo (a still glow behind the screen)"';
  /* the fixture: the halo row with Flat `works` (Flat lost the halo too on 2026-11-05, spec 001 FR-230, so the real row no longer has the case) */
  const flatHalo = (t) => t.replace('| missing, the screen\'s tint replaces it (owner decision, 2026-11-05) | missing, the screen\'s tint', '| works | missing, the screen\'s tint');
  const retro = { crew: (t) => t.replace('retro: false', 'retro: true'), md: flatHalo };
  assert.ok(check(copy(retro)).some((m) => m.startsWith(HALO + ': world(s) retro offered')), 'a Real office decision does not waive the Worlds cell');
  const own = (md) => ({ crew: retro.crew, md: (t) => md(flatHalo(t)) });
  const haloWorld = (t) => t.replace('(owner decision, 2026-11-05) | none | 001 | driver:check-001-lights', '(owner decision, 2026-11-05) | none (owner decision, 2026-11-05) | 001 | driver:check-001-lights');
  assert.ok(!check(copy(own(haloWorld))).some((m) => m.startsWith(HALO) && !/: no scripts\//.test(m)), 'a decision in the Worlds cell waives the Worlds gap');
  const deskWorld = (t) => t.replace('| missing (#1148) | none |', '| missing | none (owner decision, 2026-11-04) |');
  assert.ok(check(copy({ md: deskWorld })).some((m) => /Real office cell "missing" is not plain works/.test(m)), 'a Worlds decision does not waive the Real office cell');
  // the marker's form (escape every regex metacharacter, backslash included; CodeQL js/incomplete-sanitization)
  const reEsc = (x) => x.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  for (const bad of ['(owner decision, x)', '(owner decision, 2026-02-30)', '(owner decision, 2026-11-4)', '(owner decision, #0)', '(owner decision 2026-11-04)', '(Owner decision, #12'])
    fails({ md: (t) => t.replace('missing (#1148)', 'missing ' + bad) }, new RegExp('marker "' + reEsc(bad) + '\\)?" must be exactly'));
  assert.ok(check(copy({ md: (t) => t.replace('missing (#1148)', 'missing (owner decision, 2026-02-30)') })).some((m) => /Real office cell "missing \(owner decision, 2026-02-30\)" is not plain works/.test(m)), 'a marker with no real date does not waive the gap');
  assert.ok(!check(copy({ md: (t) => t.replace('missing (#1148)', 'missing (owner decision, #1148)') })).some((m) => /marker|Real office cell/.test(m)), 'an issue marker is accepted');
  // a works note with a limiting word is not parity
  for (const w of ['works pose, dots and lights only', 'works, partly', 'works, partial', 'works, partially drawn', 'works, no pencil', 'works, not the lounge', 'works, missing drag', 'works without drag', 'works except drag'])
    fails({ md: (t) => t.replace('works pose, dots and lights only; heavy, monster and siren missing (#1171)', w) }, new RegExp('Real office cell "' + reEsc(w) + '" is not plain works'));
  // the offered worlds cannot be read
  fails({ crew: () => 'throw new Error("no worlds here");' }, /cannot read the offered worlds from src\/renderer\/crew.js: no worlds here/);
  process.exitCode = 0;
  console.log('test-feature-inventory: ok');
} finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
