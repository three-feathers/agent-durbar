/*
 * Spec 021 FR-063 (`npm run test:rules`, part of `npm test`): the rule-file word budgets of scripts/rules-check.js, checked on
 * throwaway folders: within budget passes, one word over fails and names the file, a missing file fails, the CLI exits 1 on a
 * planted over-budget file. The real repository is checked by `node scripts/rules-check.js`, the suite's second step.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const rc = require('./rules-check.js');

process.exitCode = 1; // set to 0 only after the last assert (a hang or an early exit must not pass)

const text = (n) => Array.from({ length: n }, (_, i) => (i % 7 === 6 ? `w${i}\n` : `w${i} `)).join('');

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rules-'));
  for (const [f, n] of Object.entries(files)) {
    const p = path.join(dir, ...f.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text(n));
  }
  return dir;
}

// counting is wc -w: whitespace runs, tabs and CRLF included
assert.strictEqual(rc.countWords(''), 0);
assert.strictEqual(rc.countWords('  a\tb\r\nc  \n\n d '), 4);
assert.strictEqual(rc.countWords(text(123)), 123);

// every budget names a real file and a positive whole number; AGENTS.md keeps its hard max of 3000
for (const [f, b] of Object.entries(rc.BUDGETS)) {
  assert.ok(Number.isInteger(b) && b > 0, `${f}: budget ${b}`);
  assert.ok(!f.includes('\\'), `${f}: forward slashes only`);
}
assert.ok(rc.BUDGETS['AGENTS.md'] <= 3000, 'AGENTS.md budget above its hard max of 3000 words');

const budgets = { 'A.md': 10, 'docs/b.md': 5 };
{ // exactly at the budget passes
  const r = rc.check(repo({ 'A.md': 10, 'docs/b.md': 5 }), budgets);
  assert.deepStrictEqual(r.problems, []);
  assert.ok(r.rows.every((x) => x.ok));
}
{ // one word over fails, and only that file
  const r = rc.check(repo({ 'A.md': 10, 'docs/b.md': 6 }), budgets);
  assert.strictEqual(r.problems.length, 1);
  assert.match(r.problems[0], /^docs\/b\.md: 6 words, budget 5/);
}
{ // a missing file fails (a rename must not silently drop the budget)
  const r = rc.check(repo({ 'A.md': 3 }), budgets);
  assert.strictEqual(r.problems.length, 1);
  assert.match(r.problems[0], /^docs\/b\.md: missing/);
}
{ // the CLI on a planted over-budget AGENTS.md exits 1 and names it; within budget exits 0
  const sizes = Object.fromEntries(Object.entries(rc.BUDGETS).map(([f, b]) => [f, b]));
  const ok = repo(sizes);
  execFileSync(process.execPath, [path.join(__dirname, 'rules-check.js'), '--root', ok], { stdio: 'pipe' });
  const over = repo({ ...sizes, 'AGENTS.md': rc.BUDGETS['AGENTS.md'] + 1 });
  let failed = null;
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'rules-check.js'), '--root', over], { stdio: 'pipe' });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, 'rules-check.js passed an over-budget AGENTS.md');
  assert.strictEqual(failed.status, 1);
  assert.match(String(failed.stderr), /AGENTS\.md: \d+ words, budget 3000/);
}

console.log('test-rules-check: all tests passed');
process.exitCode = 0;
