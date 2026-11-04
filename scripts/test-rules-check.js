/*
 * Spec 021 FR-063 (`npm run test:rules`, part of `npm test`): the rule-file word budgets of scripts/rules-check.js, checked on
 * throwaway folders: within budget passes, one word over fails and names the file, a missing file fails, the CLI exits 1 on a
 * planted over-budget file. FR-081: a docs/rules file with no budget, not linked from AGENTS.md or without the rule-text header
 * fails, and AGENTS.md plus docs/rules over TOTAL_CAP fails. The real repository is checked by `node scripts/rules-check.js`, the suite's second step.
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

const made = [];
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rules-'));
  made.push(dir);
  for (const [f, n] of Object.entries(files)) {
    const p = path.join(dir, ...f.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text(n));
  }
  return dir;
}

try {
  // counting is wc -w: whitespace runs, tabs and CRLF included
  assert.strictEqual(rc.countWords(''), 0);
  assert.strictEqual(rc.countWords('  a\tb\r\nc  \n\n d '), 4);
  assert.strictEqual(rc.countWords(text(123)), 123);

  // the agreed table (spec 021, 2026-10-29 delta): the file set and every budget are pinned, so dropping a file or raising a
  // budget fails here and needs a spec change; AGENTS.md is the core (FR-081, 2026-11-04) with a hard max of 2000
  const AGREED = {
    'AGENTS.md': 2000,
    'docs/rules/incident-triage.md': 240,
    'docs/rules/merge-mechanics.md': 290,
    'docs/rules/review-rounds.md': 680,
    'docs/rules/chat-and-decisions.md': 180,
    'docs/rules/docs-sync.md': 290,
    'CLAUDE.md': 150,
    '.github/copilot-instructions.md': 100,
    'docs/collaboration.md': 1150,
    'docs/agent-notes.md': 4600,
    'docs/review-checklist.md': 2450,
    'docs/agent-apps.md': 9000,
  };
  assert.deepStrictEqual(Object.keys(rc.BUDGETS).sort(), Object.keys(AGREED).sort(), 'the rule-file set changed: update spec 021 first');
  for (const [f, b] of Object.entries(AGREED)) assert.strictEqual(rc.BUDGETS[f], b, `${f}: budget ${rc.BUDGETS[f]}, agreed ${b}`);
  assert.ok(rc.BUDGETS['AGENTS.md'] <= 2000, 'AGENTS.md budget above its core hard max of 2000 words (FR-081)');
  assert.strictEqual(rc.TOTAL_CAP, 3500, 'AGENTS.md + docs/rules cap changed: update spec 021 first');
  assert.strictEqual(rc.RULES_DIR, 'docs/rules');

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
  // FR-081 fixtures: AGENTS.md links each rules file, each rules file carries the header
  const R = (n) => `docs/rules/${n}.md`;
  const core = (names, n = 20) => `${names.map((x) => `- read [x](${R(x)}).`).join('\n')}\n${text(n)}`;
  const rule = (n = 10) => `# T\n\n${rc.RULE_HEADER}: read it before a task.\n${text(n)}`;
  function rulesRepo(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rules-'));
    made.push(dir);
    for (const [f, t] of Object.entries(files)) {
      const p = path.join(dir, ...f.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, t);
    }
    return dir;
  }
  const rb = { 'AGENTS.md': 200, [R('a')]: 50, [R('b')]: 50 };
  { // linked, headed and budgeted: passes
    const r = rc.check(rulesRepo({ 'AGENTS.md': core(['a', 'b']), [R('a')]: rule(), [R('b')]: rule() }), rb);
    assert.deepStrictEqual(r.problems, []);
  }
  { // a rules file AGENTS.md does not link fails, naming it
    const r = rc.check(rulesRepo({ 'AGENTS.md': core(['a']), [R('a')]: rule(), [R('b')]: rule() }), rb);
    assert.strictEqual(r.problems.length, 1);
    assert.match(r.problems[0], /^docs\/rules\/b\.md: not linked from AGENTS\.md/);
  }
  { // a link in prose without the exact path does not count (b.md named, not linked)
    const r = rc.check(rulesRepo({ 'AGENTS.md': `${core(['a'])}\nsee docs/rules/b.md`, [R('a')]: rule(), [R('b')]: rule() }), rb);
    assert.ok(r.problems.some((p) => /b\.md: not linked/.test(p)));
  }
  { // a rules file without the rule-text header fails
    const r = rc.check(rulesRepo({ 'AGENTS.md': core(['a', 'b']), [R('a')]: rule(), [R('b')]: text(10) }), rb);
    assert.strictEqual(r.problems.length, 1);
    assert.match(r.problems[0], /^docs\/rules\/b\.md: missing the rule-text header/);
  }
  { // an extra rules file with no budget fails, and is still checked for its link
    const r = rc.check(rulesRepo({ 'AGENTS.md': core(['a', 'b']), [R('a')]: rule(), [R('b')]: rule(), [R('c')]: rule() }), rb);
    assert.ok(r.problems.some((p) => /^docs\/rules\/c\.md: a rule file with no word budget/.test(p)), r.problems.join('; '));
    assert.ok(r.problems.some((p) => /^docs\/rules\/c\.md: not linked/.test(p)));
  }
  { // within every file budget but over the shared cap fails
    const big = { 'AGENTS.md': 3000, [R('a')]: 600, [R('b')]: 600 };
    const r = rc.check(rulesRepo({ 'AGENTS.md': core(['a', 'b'], 2900), [R('a')]: rule(550), [R('b')]: rule(550) }), big);
    assert.strictEqual(r.problems.length, 1, r.problems.join('; '));
    assert.match(r.problems[0], /^AGENTS\.md \+ docs\/rules\/: \d+ words, cap 3500/);
  }
  { // the CLI on a planted over-budget AGENTS.md exits 1 and names it; within budget exits 0
    const names = Object.keys(rc.BUDGETS).filter((f) => f.startsWith('docs/rules/')).map((f) => f.slice('docs/rules/'.length, -3));
    const sizes = {};
    for (const [f, b] of Object.entries(rc.BUDGETS)) sizes[f] = f.startsWith('docs/rules/') ? rule(10) : f === 'AGENTS.md' ? core(names, 100) : text(b);
    const ok = rulesRepo(sizes);
    execFileSync(process.execPath, [path.join(__dirname, 'rules-check.js'), '--root', ok], { stdio: 'pipe' });
    const over = rulesRepo({ ...sizes, 'AGENTS.md': core(names, rc.BUDGETS['AGENTS.md'] + 1 - rc.countWords(core(names, 0))) });
    let failed = null;
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'rules-check.js'), '--root', over], { stdio: 'pipe' });
    } catch (e) {
      failed = e;
    }
    assert.ok(failed, 'rules-check.js passed an over-budget AGENTS.md');
    assert.strictEqual(failed.status, 1);
    assert.match(String(failed.stderr), new RegExp(`AGENTS\\.md: ${rc.BUDGETS['AGENTS.md'] + 1} words, budget ${rc.BUDGETS['AGENTS.md']}`));
  }

} finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}

console.log('test-rules-check: all tests passed');
process.exitCode = 0;
