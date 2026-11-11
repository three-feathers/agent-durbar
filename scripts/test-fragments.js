/*
 * Spec 021 FR-086 item 5 / T068 (`npm run test:fragments`, part of `npm test`): scripts/fragments.js keeps the `test:*` scripts of
 * package.json in one block in code-unit order. Fixtures: a sorted block passes; an unsorted key, a key outside the block and a
 * case/underscore pair (code-unit, not locale, order) each fail and the message names the first offending key and the fix
 * command; `--fix` makes every fixture pass and changes no key or value; the CLI exits 1 on a planted package.json copy.
 * Mutants (each must be caught by its own case): a check that skips the order, one that skips contiguity, a locale sort.
 * The real package.json is checked by `node scripts/fragments.js --check`, the suite's second step.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.exitCode = 1; // set to 0 only after the last assert

const SRC = path.join(__dirname, 'fragments.js');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-frag-')); made.push(d); return d; };

// every case of the suite, run against one implementation; throws on the first case that fails
function cases(impl) {
  const { checkOrder, sortScripts } = impl;
  const ok = { build: 'x', 'test:a': '1', 'test:b': '2', 'test:c': '3', lint: 'y' };
  assert.strictEqual(checkOrder(ok), null, 'sorted block passes');
  assert.strictEqual(checkOrder({ build: 'x' }), null, 'no test scripts passes');

  const unsorted = { build: 'x', 'test:a': '1', 'test:c': '3', 'test:b': '2' };
  const m1 = checkOrder(unsorted);
  assert.ok(m1 && m1.includes('"test:b"') && m1.includes('"test:c"') && m1.includes('npm run fragments:fix'), `unsorted: ${m1}`);

  const gap = { 'test:a': '1', lint: 'y', 'test:b': '2' };
  const m2 = checkOrder(gap);
  assert.ok(m2 && m2.includes('"test:b"') && m2.includes('npm run fragments:fix'), `gap: ${m2}`);

  // code units: "test:B" < "test:a" < "test:a-b" < "test:a_b" < "test:ab"; a locale sort would put "test:a-b" and "test:a_b" elsewhere
  const units = ['test:B', 'test:a', 'test:a-b', 'test:a_b', 'test:ab'];
  assert.strictEqual(checkOrder(Object.fromEntries(units.map((k) => [k, k]))), null, 'code-unit order passes');
  const m3 = checkOrder(Object.fromEntries(['test:a', 'test:B'].map((k) => [k, k])));
  assert.ok(m3 && m3.includes('"test:B"'), `case order: ${m3}`);

  for (const bad of [unsorted, gap]) {
    const fixed = sortScripts(bad);
    assert.strictEqual(checkOrder(fixed), null, 'fix makes it pass');
    assert.deepStrictEqual({ ...fixed }, { ...bad }, 'fix changes no key or value');
    assert.deepStrictEqual(Object.keys(fixed).filter((k) => !k.startsWith('test:')), Object.keys(bad).filter((k) => !k.startsWith('test:')), 'other scripts keep their order');
  }
  assert.deepStrictEqual(Object.keys(sortScripts(gap)), ['test:a', 'test:b', 'lint']);
}

function mutant(from, to) {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(src.includes(from), `mutant anchor missing: ${from}`);
  const dir = tmp();
  const file = path.join(dir, 'fragments.js');
  fs.writeFileSync(file, src.replace(from, to));
  return require(file);
}

try {
  cases(require(SRC));

  // mutants: each must fail the case list
  const MUTANTS = {
    'order skipped': ['if (byCodeUnit(tests[i - 1], tests[i]) > 0) {', 'if (false) {'],
    'contiguity skipped': ['if (keys[first + i] !== tests[i]) {', 'if (false) {'],
    'locale sort': ['const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);', 'const byCodeUnit = (a, b) => a.localeCompare(b);'],
    'first key not named': ['"${tests[i]}" must sort before', '"x" must sort before'],
  };
  for (const [name, [from, to]] of Object.entries(MUTANTS)) {
    assert.throws(() => cases(mutant(from, to)), `mutant "${name}" must fail the test`);
  }

  // the CLI on a planted copy: scripts/fragments.js reads ../package.json relative to itself
  const root = tmp();
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(SRC, path.join(root, 'scripts', 'fragments.js'));
  const plant = (scripts) => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts }, null, 2) + '\n');
  const run = (arg) => spawnSync(process.execPath, [path.join(root, 'scripts', 'fragments.js'), arg], { encoding: 'utf8' });
  plant({ 'test:b': '2', 'test:a': '1' });
  const bad = run('--check');
  assert.strictEqual(bad.status, 1);
  assert.ok(bad.stderr.includes('"test:a"') && bad.stderr.includes('npm run fragments:fix'), bad.stderr);
  assert.strictEqual(run('--fix').status, 0);
  const fixed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(fixed.scripts), ['test:a', 'test:b']);
  assert.strictEqual(run('--check').status, 0);
  assert.strictEqual(run('--nope').status, 2);

  process.exitCode = 0;
  console.log('test-fragments: ok');
} finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}
