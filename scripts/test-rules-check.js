/*
 * Spec 021 FR-063 (`npm run test:rules`, part of `npm test`): the rule-file word budgets of scripts/rules-check.js, checked on
 * throwaway folders: within budget passes, one word over fails and names the file, a missing file fails, the CLI exits 1 on a
 * planted over-budget file. FR-082: a docs/rules file with no budget, not linked from AGENTS.md or without the rule-text header
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
  // budget fails here and needs a spec change; AGENTS.md is the core (FR-082, 2026-11-04) with a hard max of 2000
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
  assert.ok(rc.BUDGETS['AGENTS.md'] <= 2000, 'AGENTS.md budget above its core hard max of 2000 words (FR-082)');
  assert.strictEqual(rc.TOTAL_CAP, 3525, 'AGENTS.md + docs/rules cap changed: update spec 021 first');
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
  // FR-082 fixtures: AGENTS.md links each rules file, each rules file carries the header
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
    assert.match(r.problems[0], /^AGENTS\.md \+ docs\/rules\/: \d+ words, cap 3525/);
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


  // FR-423: scripts/harness-refs.js, one failing fixture per check, and a mutant per check that must die at that check's own assert
  const hr = require('./harness-refs.js');
  const hsrc = fs.readFileSync(path.join(__dirname, 'harness-refs.js'), 'utf8');
  const chr = (c) => String.fromCharCode(c); // never typed: an editor turns the raw character into a different one
  const LABELS = '# header\ttwo\ntask\t1d76db\tx\nneeds-owner-approval\td93f0b\tx\nspec-exempt\tcfd3d7\tx\n';
  const RULE = `# A\n\n${rc.RULE_HEADER}\n\n## Real section\n\n- **Bold lead** (FR-1): text.\n`;
  function hrepo(over = {}) {
    const files = {
      'AGENTS.md': '# Rules\n\n## Where\n\nread `docs/rules/a.md` and [x](docs/rules/a.md).\n',
      'docs/rules/a.md': RULE,
      'docs/guide.md': 'plain\n',
      '.github/labels.tsv': LABELS,
      '.specify/memory/constitution.md': 'uses `needs-approval` here.\n',
      'CONTRIBUTING.md': 'label `needs-owner-approval`.\n',
      ...over,
    };
    return rulesRepo(Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)));
  }
  const HB = { 'AGENTS.md': 99, 'docs/rules/a.md': 99, 'docs/guide.md': 99 };
  // each case: [name, fixture over-rides, regex of the one expected problem line, a mutation of harness-refs.js that hides it]
  const CASES = [
    ['path', { 'AGENTS.md': 'see `scripts/gone.js` now.\n' }, /^AGENTS\.md:1: path `scripts\/gone\.js` does not exist/, [/if \(!fs\.existsSync\(path\.join\(root, \.\.\.target\.split\('\/'\)\)\)\)/, 'if (false)']],
    ['path in a link', { 'docs/rules/a.md': `${RULE}\n[gone](../missing.md)\n` }, /^docs\/rules\/a\.md:\d+: path `\.\.\/missing\.md` does not exist/, null],
    ['pointer', { 'docs/guide.md': 'AGENTS.md says *No such section* here.\n' }, /^docs\/guide\.md:1: pointer \*No such section\* is no heading or bold lead of AGENTS\.md/, [/h === want \|\| h\.startsWith/, 'true || h.startsWith']],
    ['invisible', { 'docs/guide.md': `one${chr(160)}two\n` }, /^docs\/guide\.md:1: invisible character U\+00A0/, [/\[8232, 8233, 160\]/, '[8232, 8233]']],
    ['label', { 'CONTRIBUTING.md': 'label `needs-nothing`.\n' }, /^CONTRIBUTING\.md:1: label `needs-nothing` is not in \.github\/labels\.tsv/, [/if \(known\.has\(lab\)\) continue;/, 'continue;']],
    ['stale allow entry', { '.specify/memory/constitution.md': 'no label here.\n' }, /LABEL_ALLOW entry `needs-approval`/, [/known\.has\(lab\) \|\| !used\.has\(lab\)/, 'false']],
    ['marker', { 'docs/guide.md': `a\n${'<'.repeat(7)} HEAD\nb\n` }, /^docs\/guide\.md:2: a conflict marker was left in \(<<<<<<</, [/problems\.push\(`\$\{f\}:\$\{m\.line\}/, 'void (`${f}:${m.line}']],
  ];
  let seq = 0;
  function load(src) { // a mutated copy of the checker that still finds its sibling modules
    const f = path.join(os.tmpdir(), `durbar-hr-mutant-${process.pid}-${seq++}.js`);
    made.push(f);
    fs.writeFileSync(f, src.replace("require('./specs-index.js')", `require(${JSON.stringify(path.join(__dirname, 'specs-index.js'))})`));
    return require(f);
  }
  const ask = (mod, root) => mod.check(root, HB);
  assert.deepStrictEqual(ask(hr, hrepo()), [], 'a clean fixture must produce no problem');
  assert.deepStrictEqual(ask(hr, hrepo({ '.specify/memory/constitution.md': 'uses `needs-approval` here.\n' })), [], 'the allow-listed constitution label passes');
  for (const [name, over, re, mut] of CASES) {
    const probs = ask(hr, hrepo(over));
    const hit = probs.filter((p) => re.test(p));
    assert.strictEqual(hit.length, 1, `${name}: expected one problem line matching ${re}, got [${probs.join(' | ')}]`);
    if (!mut) continue;
    assert.ok(mut[0].test(hsrc), `${name}: mutant pattern ${mut[0]} no longer matches harness-refs.js`);
    const m = ask(load(hsrc.replace(mut[0], mut[1])), hrepo(over));
    // the mutant must be killed by the very assert above (the problem line is gone), not by a crash
    assert.ok(Array.isArray(m), `${name}: mutant crashed`);
    assert.strictEqual(m.filter((p) => re.test(p)).length, 0, `${name}: mutant survived, the check still reported it`);
  }
  { // an unticked task on the line keeps a planned path from failing; a ticked one does not
    const spec = (box) => ({ 'specs/001-x/tasks.md': `- [${box}] T061 later\n`, 'AGENTS.md': 'plans `scripts/fuzz/` (T061).\n' });
    assert.deepStrictEqual(ask(hr, hrepo(spec(' '))), []);
    assert.strictEqual(ask(hr, hrepo(spec('x'))).length, 1);
  }
  { // a pointer in the same sentence as `;`: the italic words after it are emphasis, not a pointer; bold leads and prefixes match
    assert.deepStrictEqual(ask(hr, hrepo({ 'docs/guide.md': 'AGENTS.md (*Where*); must say *ready to merge*. a.md *Real section* and a.md *Bold lead*.\n' })), []);
  }
  { // CRLF files: line numbers and matches are the same
    const probs = ask(hr, hrepo({ 'docs/guide.md': `fine\r\nAGENTS.md says *Nope* here.\r\n`, 'docs/rules/a.md': RULE.replace(/\n/g, '\r\n') }));
    assert.deepStrictEqual(probs.map((p) => p.split(':').slice(0, 2).join(':')), ['docs/guide.md:2']);
  }
  { // the CLI of rules-check.js reports a dead path in a rule file and exits 1
    const names = Object.keys(rc.BUDGETS).filter((f) => f.startsWith('docs/rules/')).map((f) => f.slice('docs/rules/'.length, -3));
    const sizes = {};
    for (const [f, b] of Object.entries(rc.BUDGETS)) sizes[f] = f.startsWith('docs/rules/') ? rule(10) : f === 'AGENTS.md' ? `${core(names, 100)}\nsee \`scripts/not-there.js\`\n` : text(b);
    let failed = null;
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'rules-check.js'), '--root', rulesRepo(sizes)], { stdio: 'pipe' });
    } catch (e) {
      failed = e;
    }
    assert.ok(failed && failed.status === 1, 'rules-check.js passed a dead path in AGENTS.md');
    assert.match(String(failed.stderr), /rules:check: AGENTS\.md:\d+: path `scripts\/not-there\.js` does not exist/);
  }
} finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}

console.log('test-rules-check: all tests passed');
process.exitCode = 0;
