/*
 * Spec 021 FR-424 (`npm run test:rules`, part of `npm test`): `npm run rules:fresh` (scripts/rules-fresh.js) names the rule files that changed on
 * origin/main since the checkout's merge base. Every case runs in a throwaway git repository (a bare origin and a clone made here), never the
 * real history: nothing changed prints `rules: fresh` (exit 0); a changed rule file is named with its commit subject and the summary
 * `rules: stale, read: ...` (exit 1); files that are not rule files, the checkout's own edits and a body line are never listed; a fetch that fails is exit 2.
 * Then mutants of the script (the merge base replaced by HEAD, the fetch dropped, the docs/rules path dropped, a body printed) must each die at their
 * own assert text below, not at a crash.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

process.exitCode = 1; // set to 0 only after the last assert

const SRC = fs.readFileSync(path.join(__dirname, 'rules-fresh.js'), 'utf8').replace(/\r\n/g, '\n'); // CRLF checkouts: anchors use \n
const made = [];
const G = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
const git = (cwd, ...a) => execFileSync('git', [...G, '-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root, f, text) => {
  const p = path.join(root, ...f.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const commit = (root, files, msg) => {
  for (const [f, t] of Object.entries(files)) write(root, f, t);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
};
// a bare origin with one commit on main, a clone of it (the checkout under test), and a second clone to push changes to main from
function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-fresh-'));
  made.push(dir);
  const origin = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  const pusher = path.join(dir, 'pusher');
  git(dir, 'clone', '-q', origin, pusher);
  git(pusher, 'checkout', '-q', '-b', 'main');
  commit(pusher, { 'AGENTS.md': 'rules\n', 'CLAUDE.md': 'c\n', '.specify/memory/constitution.md': 'k\n', 'docs/rules/a.md': 'a\n', 'README.md': 'r\n', '.claude/skills/other/SKILL.md': 's\n' }, 'first');
  git(pusher, 'push', '-q', 'origin', 'main');
  const checkout = path.join(dir, 'checkout');
  git(dir, 'clone', '-q', origin, checkout);
  return { dir, origin, pusher, checkout, push: (files, msg) => { commit(pusher, files, msg); git(pusher, 'push', '-q', 'origin', 'main'); } };
}
const run = (script, root) => {
  const r = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
};
const SCRIPT = path.join(__dirname, 'rules-fresh.js');
const lines = (s) => s.split(/\r?\n/).filter(Boolean);

const EXPECT = [
  '.claude/agents/x.md: Move a rule  into docs/rules',
  '.claude/skills/durbar-y/SKILL.md: Move a rule  into docs/rules',
  '.specify/memory/constitution.md: Move a rule  into docs/rules',
  'AGENTS.md: Tighten the AGENTS.md rule',
  'CLAUDE.md: Move a rule  into docs/rules',
  'docs/rules/a.md: Move a rule  into docs/rules',
  'docs/rules/new.md: Move a rule  into docs/rules',
].sort();

// every behaviour, in order, against one copy of the script; a failing assert names the behaviour (the mutants below are matched on that text)
function scenarios(script) {
  { // nothing changed on main: fresh
    const w = world();
    const r = run(script, w.checkout);
    assert.strictEqual(r.code, 0, `fresh: exit code ${r.code}: ${r.err}`);
    assert.deepStrictEqual(lines(r.out), ['rules: fresh'], 'fresh: prints exactly "rules: fresh"');
  }
  { // the checkout's own commit on a rule file is not "changed on main"
    const w = world();
    commit(w.checkout, { 'AGENTS.md': 'mine\n' }, 'my own edit');
    const r = run(script, w.checkout);
    assert.ok(r.code === 0 && lines(r.out)[0] === 'rules: fresh', `own edit only: fresh, got ${r.out}`);
  }
  { // main changed rule files (and others): each named once with its subject, the summary last; bodies and non-rule files stay out
    const w = world();
    w.push({ 'AGENTS.md': 'rules 2\n', 'README.md': 'r2\n' }, 'Tighten the AGENTS.md rule\n\nBODYLINE secret-looking body');
    w.push({ 'docs/rules/a.md': 'a2\n', 'docs/rules/new.md': 'n\n', '.claude/agents/x.md': 'x\n', '.claude/skills/durbar-y/SKILL.md': 'y\n', '.claude/skills/other/SKILL.md': 's2\n', 'src/z.ts': 'z\n', '.specify/memory/constitution.md': 'k2\n', 'CLAUDE.md': 'c2\n' }, 'Move a rule\u0007 into docs/rules');
    const r = run(script, w.checkout);
    assert.strictEqual(r.code, 1, `stale: exit code ${r.code}: ${r.err}`);
    assert.ok(!/BODYLINE|secret-looking/.test(r.out), 'stale: a commit body is never printed');
    const l = lines(r.out);
    assert.ok(/^rules: stale, read: .*AGENTS\.md/.test(l[l.length - 1]), `stale: summary line is last and lists the files, got ${l[l.length - 1]}`);
    assert.deepStrictEqual(l.slice(0, -1).sort(), EXPECT, 'stale: every changed rule file is named once with its latest commit subject (control characters dropped); README.md, src/ and other skills are not');
    git(w.checkout, 'checkout', '-q', '-b', 'work');
    commit(w.checkout, { 'AGENTS.md': 'mine\n' }, 'my own edit');
    const own = run(script, w.checkout);
    assert.ok(own.code === 1 && lines(own.out).some((x) => x.startsWith('AGENTS.md: Tighten')), "own edit: main's change to the same file is still named");
    git(w.checkout, 'reset', '-q', '--hard', 'origin/main'); // merged main: the merge base moved
    const after = run(script, w.checkout);
    assert.ok(after.code === 0 && lines(after.out)[0] === 'rules: fresh', `merged: fresh again, got ${after.out}`);
    git(w.checkout, 'remote', 'set-url', 'origin', path.join(w.dir, 'gone.git')); // git cannot fetch: exit 2 and no verdict
    const nf = run(script, w.checkout);
    assert.strictEqual(nf.code, 2, `no fetch: exit code ${nf.code}`);
    assert.ok(/rules:fresh: cannot fetch origin main/.test(nf.err) && !/rules: (fresh|stale)/.test(nf.out), `no fetch: message, got ${nf.err}`);
  }
  { // a rule file stored with CRLF line ends is named like any other
    const w = world();
    w.push({ 'docs/rules/a.md': 'a2\r\n' }, 'Subject of a CRLF file');
    const r = run(script, w.checkout);
    assert.ok(r.code === 1 && r.out.includes('docs/rules/a.md: Subject of a CRLF file\n') && !r.out.includes('\r'), `crlf: got ${JSON.stringify(r.out)}`);
  }
}

try {
  scenarios(SCRIPT);
  // mutants of the script: each copy must fail the scenario assert named (a crash or a different assert does not count)
  const mutants = [
    ['the merge base replaced by HEAD', "git(root, ['merge-base', 'HEAD', 'origin/main']).trim()", "git(root, ['rev-parse', 'HEAD']).trim()", 'own edit only: fresh'],
    ['the fetch dropped', "git(root, ['fetch', '-q', 'origin', 'main']);", 'void 0;', 'stale: exit code 0'],
    ['a failed fetch ignored', 'throw new Error(`cannot fetch origin main', 'void (`cannot fetch origin main', 'no fetch: exit code'],
    ['the docs/rules directory left out', "const { FRESH_PATHS } = require('./rules-check.js');", "const FRESH_PATHS = require('./rules-check.js').FRESH_PATHS.filter((p) => !p.startsWith('docs/rules'));", 'stale: every changed rule file is named once'],
    ['the constitution left out', "const { FRESH_PATHS } = require('./rules-check.js');", "const FRESH_PATHS = require('./rules-check.js').FRESH_PATHS.filter((p) => !p.includes('constitution'));", 'stale: every changed rule file is named once'],
    ['every changed file listed, rule or not', "'--', ...FRESH_PATHS]", "'--']", 'stale: every changed rule file is named once'],
    ['the commit body printed', "'--format=%s'", "'--format=%B'", 'stale: a commit body is never printed', ["split(/\\r?\\n/)[0]", "replace(/\\r?\\n/g, ' ')"]],
    ['control characters kept in the subject', "replace(/[\\u0000-\\u001f\\u007f]/g, ' ')", "replace(/[\\u0001]/g, ' ')", 'stale: every changed rule file is named once'],
    ['exit 0 when stale', '  return 1;\n}', '  return 0;\n}', 'stale: exit code 0'],
    ['the summary line dropped', 'console.log(`rules: stale, read:', 'void (`rules: stale, read:', 'stale: summary line is last'],
  ];
  const mroot = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-fresh-mut-'));
  made.push(mroot);
  for (const f of ['rules-check.js', 'harness-refs.js', 'specs-index.js']) fs.copyFileSync(path.join(__dirname, f), path.join(mroot, f));
  for (const [name, from, to, at, also] of mutants) {
    assert.ok(SRC.includes(from), `mutant "${name}": its anchor is in rules-fresh.js`);
    const m = path.join(mroot, 'rules-fresh.js');
    let src = SRC.split(from).join(to);
    if (also) {
      assert.ok(src.includes(also[0]), `mutant "${name}": its second anchor is in rules-fresh.js`);
      src = src.split(also[0]).join(also[1]);
    }
    fs.writeFileSync(m, src);
    let msg = '';
    try {
      scenarios(m);
    } catch (e) {
      msg = String((e && e.message) || e);
    }
    assert.ok(msg.startsWith(at), `mutant "${name}" must die at "${at}", got: ${msg.split('\n')[0] || 'it survived'}`);
  }
} finally {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
}

console.log('test-rules-fresh: all tests passed');
process.exitCode = 0;
