#!/usr/bin/env node
// Spec 021 FR-384 (2026-11-22): tests of scripts/pr-preflight.js. Offline: a throwaway git repository (refs made by hand, `--no-fetch`) and an
// injected `gh` that answers from fixtures. Each check has a failing fixture; the assert messages carry the check's tag (PP-<check>) so a
// mutant dies at its own assert. PP_MODULE swaps the module (mutant runs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const modPath = process.env.PP_MODULE ? path.resolve(process.env.PP_MODULE) : path.join(__dirname, 'pr-preflight.js');
const pp = require(modPath);
const { gitRun } = require('./git-index-helper.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const G = (args, opts = {}) => gitRun(tmp, ['-c', 'commit.gpgsign=false', ...args], { env: { ...ENV, ...(opts.env || {}) }, input: opts.input }).trim();
const Gtry = (args) => { try { return G(args); } catch (e) { return String(e.stdout || '').trim(); } };
G(['init', '-q', '-b', 'main']);

let idx = 0;
/** A commit from parents; tree = treeFrom (or the first parent's) with files set; returns the sha. */
function mk(parents, files, message, { treeFrom, ref } = {}) {
  const env = { GIT_INDEX_FILE: path.join(tmp, '.git', `pp-index-${idx++}`) };
  const from = treeFrom || parents[0];
  if (from) G(['read-tree', from], { env }); else G(['read-tree', '--empty'], { env });
  for (const [p, content] of Object.entries(files)) {
    const sha = G(['hash-object', '-w', '--stdin'], { input: content });
    G(['update-index', '--add', '--cacheinfo', `100644,${sha},${p}`], { env });
  }
  const tree = G(['write-tree'], { env });
  const c = G(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message]);
  if (ref) G(['update-ref', ref, c]);
  return c;
}

const PKG = (scripts) => JSON.stringify({ name: 'x', scripts }, null, 2) + '\n';
const base = mk([], {
  'package.json': PKG({ a: 'node a.js', b: 'node b.js' }),
  'specs/001-a/spec.md': '# A\n- **FR-010** one\n',
  'specs/001-a/tasks.md': '# A\n- [ ] T380 one\n',
  'specs/002-b/spec.md': '# B\n- **FR-020** two\n',
  'specs/002-b/tasks.md': '# B\n- [ ] T040 two\n',
  'scripts/t.js': "assert.ok(1, 'one');\nassert.ok(2, 'two');\n",
  'docs/x.md': 'line one\nline two\nline three\n',
  'docs/s.md': 'the old fix strips a CRLF\n',
}, 'base');
// main moves on: a new script and a new FR in another spec, after the PR branches
const main2 = mk([base], { 'package.json': PKG({ a: 'node a.js', b: 'node b.js', c: 'node c.js' }), 'specs/002-b/spec.md': '# B\n- **FR-020** two\n- **FR-030** three\n' }, 'main 2', { ref: 'refs/remotes/origin/main' });

// the good PR: adds FR-500 and T500, one assert, then merges main cleanly (merge-only, resolved nothing)
const good1 = mk([base], { 'specs/001-a/spec.md': '# A\n- **FR-010** one\n- **FR-500** new\n', 'specs/001-a/tasks.md': '# A\n- [ ] T380 one\n- [ ] T500 new\n', 'scripts/t.js': "assert.ok(1, 'one');\nassert.ok(2, 'two');\nassert.ok(3, 'three');\n" }, 'good 1');
const cleanTree = G(['merge-tree', '--write-tree', good1, main2]).split('\n')[0];
const good = mk([good1, main2], {}, 'Merge main', { treeFrom: cleanTree, ref: 'refs/remotes/origin/001-good' });
G(['update-ref', 'refs/remotes/origin/HEAD', main2]);
const REFS_BEFORE = G(['for-each-ref']); // every ref the fixtures below add is removed again; the runs themselves must add or move none

function commitsOf(head, over = {}) {
  return G(['rev-list', '--reverse', '--parents', head, '^refs/remotes/origin/main']).split('\n').filter(Boolean).map((l) => {
    const [sha, ...parents] = l.split(' ');
    return { sha, verified: true, message: G(['log', '-1', '--format=%B', sha]), parents, ...(over[sha] || {}) };
  });
}

/** A fake gh from fixtures; records the calls. */
function fakeGh(fx) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'view') {
      if (fx.unreadable) return { status: 1, stdout: '' };
      const fields = args[args.indexOf('--json') + 1];
      if (fields.startsWith('author')) return { status: 0, stdout: JSON.stringify({ author: { login: fx.author || 'vikramgorla' }, isCrossRepository: fx.fork === true, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }) };
      return { status: 0, stdout: JSON.stringify({ headRefOid: fx.head, headRefName: fx.branch || '001-good', baseRefName: 'main', mergeable: fx.mergeable || 'MERGEABLE', labels: (fx.labels || ['task', 'area:harness', 'spec:021']).map((name) => ({ name })), body: fx.body || 'Closes #1. Agent used: Claude Code.', isDraft: false, additions: fx.additions == null ? 150 : fx.additions, deletions: 0 }) };
    }
    if (args[0] === 'api') return { status: 0, stdout: (fx.commits || commitsOf(fx.head)).map((c) => JSON.stringify(c)).join('\n') + '\n' };
    if (args[0] === 'pr' && args[1] === 'list') return fx.branchState ? fx.branchState(args[2]) : { status: 0, stdout: '[]' };
    if (args[0] === 'pr' && args[1] === 'checks') return { status: fx.checksStatus || 0, stdout: JSON.stringify(fx.checks || [{ name: 'Build and test', bucket: 'pass' }]) };
    throw new Error('unexpected gh call ' + args.join(' '));
  };
  return { gh, calls };
}
const TRUSTED = new Set(['vikramgorla', 'fjcabello', 'rubenlupi']);
function run(fx) {
  const f = fakeGh(fx);
  const r = pp.preflight('7', { gh: f.gh, root: tmp, fetch: false, trusted: TRUSTED });
  const text = pp.format(r.lines);
  return { ...r, text, calls: f.calls, fails: r.lines.filter((l) => l.level === 'FAIL').map((l) => l.text), notes: r.lines.filter((l) => l.level === 'NOTE').map((l) => l.text) };
}
const has = (list, re) => list.some((t) => re.test(t));

// ---- the good PR: no FAIL, the clean merge of main is a NOTE
{
  const r = run({ head: good });
  assert.strictEqual(r.code, 0, 'PP-good the good PR passes: ' + r.text);
  assert.ok(has(r.lines.map((l) => l.text), /numbers: FR-500 T500/), 'PP-numbers the added numbers are listed: ' + r.text);
  assert.ok(has(r.notes, /resolved nothing/), 'PP-cleanmerge a clean merge of main is a NOTE: ' + r.text);
  assert.ok(has(r.lines.map((l) => l.text), /merge-only/), 'PP-merge the clean merge is merge-only: ' + r.text);
  assert.ok(!has(r.lines.map((l) => l.text), /package\.json/), 'PP-package package.json untouched: no line (main adding a script is not the PR removing it): ' + r.text);
}

// ---- 0 usage
{
  const calls = [];
  const r = pp.preflight('7; rm -rf x', { gh: (a) => { calls.push(a); return { status: 1, stdout: '' }; }, root: tmp, fetch: false, trusted: TRUSTED });
  assert.ok(r.code === 2 && calls.length === 0, 'PP-usage a non-number is refused before any call: ' + pp.format(r.lines));
}

// ---- 1 readable, ours
{
  const r = run({ head: good, unreadable: true });
  assert.ok(r.code === 1 && has(r.fails, /cannot read PR 7/), 'PP-readable an unreadable PR fails: ' + r.text);
  const o = run({ head: good, author: 'stranger', body: 'Generated with X' });
  assert.ok(o.code === 1 && has(o.fails, /outside PR: author stranger/), 'PP-outside an outside author stops: ' + o.text);
  assert.strictEqual(o.calls.length, 1, 'PP-outside nothing beyond the author is read: ' + o.calls.join(' | '));
  assert.ok(!/Generated/.test(o.text), 'PP-outside the body is never printed');
  // without an injected list, the repository's own list (scripts/trusted-authors.js) decides
  const real = (author) => pp.preflight('7', { gh: fakeGh({ head: good, author }).gh, root: tmp, fetch: false }).lines;
  assert.ok(has(real('stranger').map((l) => l.text), /outside PR/) && !has(real('vikramgorla').map((l) => l.text), /outside PR/), 'PP-outside the default trusted list is the repository loader');
  const k = run({ head: good, fork: true });
  assert.ok(k.code === 1 && has(k.fails, /from a fork/), 'PP-outside a fork PR stops: ' + k.text);
}

// ---- 2 mergeable
{
  const r = run({ head: good, mergeable: 'CONFLICTING' });
  assert.ok(r.code === 1 && has(r.fails, /CONFLICTING/), 'PP-mergeable a conflicting PR fails: ' + r.text);
  assert.ok(has(run({ head: good, mergeable: 'UNKNOWN' }).notes, /UNKNOWN/), 'PP-mergeable UNKNOWN is a NOTE');
}

// ---- 3 labels
{
  assert.ok(has(run({ head: good, labels: ['task', 'bug', 'area:harness', 'spec:021'] }).fails, /2 type labels/), 'PP-labels two types fail');
  assert.ok(has(run({ head: good, labels: ['area:harness', 'spec:021'] }).fails, /0 type labels/), 'PP-labels no type fails');
  assert.ok(has(run({ head: good, labels: ['task', 'spec:021'] }).fails, /no area/), 'PP-labels no area fails');
  assert.ok(has(run({ head: good, labels: ['task', 'area:harness'] }).fails, /no spec/), 'PP-labels no spec fails');
}

// ---- 4 body, 5 commits
{
  for (const b of ['x\n\nGenerated with [Claude Code](https://claude.com/claude-code)', 'Co-Authored-By: Claude Opus <noreply@anthropic.com>', 'https://claude.ai/code/session_1', 'Co-Authored-By: Claude <c@example.com>', 'Co-Authored-By: Bot <noreply@anthropic.com>']) {
    assert.ok(has(run({ head: good, body: b }).fails, /body: an AI attribution line/), 'PP-body an AI line in the body fails: ' + b);
  }
  assert.ok(!has(run({ head: good, body: 'Co-Authored-By: Paco <p@example.com>' }).fails, /body/), 'PP-body a human co-author is not an AI line');
  assert.ok(!has(run({ head: good, body: 'Pictures generated with npm run shots:docs. Generated with the simulator.' }).fails, /body/), 'PP-body "generated with" a tool is not an AI line');
  const unv = run({ head: good, commits: commitsOf(good, { [good1]: { verified: false } }) });
  assert.ok(has(unv.fails, new RegExp(`not Verified: ${good1.slice(0, 9)}`)), 'PP-verified an unverified commit fails: ' + unv.text);
  const tr = run({ head: good, commits: commitsOf(good, { [good1]: { message: 'x\n\nClaude-Session: https://example.com/s' } }) });
  assert.ok(has(tr.fails, /AI trailer or line in/), 'PP-trailer an AI trailer in a commit fails: ' + tr.text);
}

// ---- 6 merge commits: an evil merge fails, a resolved conflict is a NOTE
{
  const evil = mk([good1, main2], { 'scripts/sneak.js': 'x\n' }, 'Merge main', { treeFrom: cleanTree });
  const r = run({ head: evil, branch: '001-evil' });
  assert.ok(has(r.fails, /changes beyond the plain merge in scripts\/sneak\.js/), 'PP-evilmerge a change hidden in a merge fails: ' + r.text);
  assert.ok(!has(r.notes, /resolved nothing/), 'PP-cleanmerge an evil merge is not "resolved nothing"');
  // a clean merge of a branch that is not main (a stack) is merge-only and not "resolved nothing"
  const topic = mk([base], { 'docs/y.md': 'y\n' }, 'topic');
  const stack = mk([good1, topic], {}, 'Merge topic', { treeFrom: G(['merge-tree', '--write-tree', good1, topic]).split('\n')[0] });
  const st = run({ head: stack, branch: '001-stack' });
  assert.ok(has(st.lines.map((l) => l.text), /merge-only/) && !has(st.notes, /resolved nothing/), 'PP-cleanmerge only a merge of main is "resolved nothing": ' + st.text);
  // a conflict: both sides change docs/x.md line two
  const side = mk([main2], { 'docs/x.md': 'line one\nline TWO main\nline three\n' }, 'main 3');
  const mine = mk([good1], { 'docs/x.md': 'line one\nline two mine\nline three\n' }, 'mine');
  const conflictTree = Gtry(['merge-tree', '--write-tree', mine, side]).split('\n')[0];
  const resolved = mk([mine, side], { 'docs/x.md': 'line one\nline two mine and main\nline three\n' }, 'Merge main', { treeFrom: conflictTree });
  const saved = G(['rev-parse', 'refs/remotes/origin/main']);
  G(['update-ref', 'refs/remotes/origin/main', side]);
  const c = run({ head: resolved, branch: '001-conflict' });
  assert.ok(has(c.notes, /resolved conflicts in docs\/x\.md/) && !has(c.fails, /merge /), 'PP-conflictmerge a resolved conflict is a NOTE, not a FAIL: ' + c.text);
  const evil2 = mk([mine, side], { 'docs/x.md': 'line one\nline two mine and main\nline three\n', 'scripts/t.js': 'nothing\n' }, 'Merge main', { treeFrom: conflictTree });
  assert.ok(has(run({ head: evil2, branch: '001-conflict' }).fails, /beyond the plain merge in scripts\/t\.js/), 'PP-evilmerge a change beside a resolved conflict fails');
  G(['update-ref', 'refs/remotes/origin/main', saved]);
}

// ---- 7 numbers
{
  // FR-030 is on main in 002-b only: new in 001-a it is no clash (the rule is specs:numbers', which never compares other files of main)
  const fr = mk([base], { 'specs/001-a/spec.md': '# A\n- **FR-010** one\n- **FR-030** again\n' }, 'fr', { ref: 'refs/remotes/origin/001-fr' });
  const r = run({ head: fr, branch: '001-fr' });
  assert.ok(!has(r.fails, /FR-030/) && has(r.lines.map((l) => l.text), /numbers: FR-030;/), 'PP-numbers-main a number other specs on main use is no clash: ' + r.text);
  // the same file on main: a clash
  const fr2 = mk([base], { 'specs/002-b/spec.md': '# B\n- **FR-020** two\n- **FR-030** mine too\n' }, 'fr2');
  assert.ok(has(run({ head: fr2, branch: '001-fr2' }).fails, /FR-030 \(specs\/002-b\/spec\.md\) is also in origin\/main/), 'PP-numbers-main a number main defines in the same file fails');
  G(['update-ref', '-d', 'refs/remotes/origin/001-fr']);
  // another remote head adds FR-600 in 002-b and T501 in 001-a
  const otherSha = mk([base], { 'specs/002-b/spec.md': '# B\n- **FR-020** two\n- **FR-600** other\n', 'specs/001-a/tasks.md': '# A\n- [ ] T380 one\n- [ ] T501 other\n', 'specs/002-b/tasks.md': '# B\n- [ ] T040 two\n- [ ] T041 other\n' }, 'other', { ref: 'refs/remotes/origin/002-other' });
  const mineN = mk([base], { 'specs/001-a/spec.md': '# A\n- **FR-010** one\n- **FR-600** mine\n', 'specs/001-a/tasks.md': '# A\n- [ ] T380 one\n- [ ] T501 mine\n' }, 'mine');
  const n = run({ head: mineN, branch: '001-mine' });
  assert.ok(has(n.fails, /FR-600 \(specs\/001-a\/spec\.md\) is also in origin\/002-other \(added there too, in specs\/002-b\/spec\.md/), 'PP-numbers-global a global FR on another head in another spec fails: ' + n.text);
  assert.ok(has(n.fails, /T501 \(specs\/001-a\/tasks\.md\) is also in origin\/002-other \(added there too\)$/), 'PP-numbers-same the same number in the same file on another head fails: ' + n.text);
  // that branch is the leftover of a closed, unmerged PR (its tip is the PR's head): not a clash, a NOTE (the same rule as specs:numbers --wide)
  const closedAtTip = (sha) => (a) => ({ status: 0, stdout: JSON.stringify([{ headRefOid: sha, mergedAt: null, state: 'CLOSED', isCrossRepository: false }]) });
  const dead = run({ head: mineN, branch: '001-mine', branchState: closedAtTip(otherSha) });
  assert.ok(!has(dead.fails, /FR-600|T501/), 'PP-numbers-dead a branch of a closed, unmerged PR holds no number: ' + dead.text);
  assert.ok(has(dead.notes, /^skipped origin\/002-other: its PR is closed and not merged/), 'PP-numbers-dead-note it is named as a NOTE: ' + dead.text);
  assert.ok(has(run({ head: mineN, branch: '001-mine', branchState: closedAtTip('e'.repeat(40)) }).fails, /T501/), 'PP-numbers-dead-tip a closed PR at another tip is a live branch');
  assert.ok(has(run({ head: mineN, branch: '001-mine', branchState: () => ({ status: 1, stdout: '' }) }).fails, /numbers: not checked \(could not read the PR state of branch 002-other/), 'PP-numbers-unread an unreadable PR state is a FAIL, not a pass');
  // the ok line counts remote branches and worktree branches, and says so
  assert.ok(has(run({ head: good, branch: '001-good' }).lines.map((l) => l.text), /numbers: FR-500 T500; checked against origin\/main and \d+ other head\(s\) \(remote branches and worktree branches\)/), 'PP-numbers-wording the ok line does not call worktree branches remote heads');
  // fetch mode compares the heads the remote lists NOW: a remote-tracking ref of a deleted branch is not compared
  { const liveNames = (names) => () => names.map((name) => ({ name, sha: G(['rev-parse', `refs/remotes/origin/${name}`]) }));
    const f = (liveHeads) => { const g = fakeGh({ head: mineN, branch: '001-mine' }); const r = pp.preflight('7', { gh: g.gh, root: tmp, fetch: false, trusted: TRUSTED, liveHeads }); return pp.format(r.lines) + '\n' + r.lines.filter((l) => l.level === 'FAIL').length; };
    assert.match(f(liveNames(['002-other'])), /T501 .* is also in origin\/002-other/, 'PP-live-listed a head the remote lists is compared');
    assert.doesNotMatch(f(liveNames([])), /002-other/, 'PP-live-stale a tracked ref that the remote no longer lists is not compared'); }
  // the real fetch mode (no liveHeads stand-in): a throwaway remote with main, 002-other and the PR's head; the clone keeps a stale tracked ref of a deleted branch
  { const org = path.join(tmp, 'pp-org.git'), cl = path.join(tmp, 'pp-clone');
    const Gx = (dir, args) => gitRun(dir, ['-c', 'commit.gpgsign=false', ...args], { env: ENV }).trim();
    fs.mkdirSync(org); Gx(org, ['init', '-q', '--bare', '-b', 'main']);
    Gx(tmp, ['push', '-q', org, `${main2}:refs/heads/main`, `${otherSha}:refs/heads/002-other`, `${mineN}:refs/pull/7/head`]);
    Gx(tmp, ['clone', '-q', org, cl]);
    Gx(cl, ['update-ref', 'refs/remotes/origin/002-stale', otherSha]);
    const g = fakeGh({ head: mineN, branch: '001-mine' });
    const r = pp.preflight('7', { gh: g.gh, root: cl, trusted: TRUSTED });
    const text = pp.format(r.lines);
    assert.ok(/is also in origin\/002-other/.test(text), 'PP-live-fetch fetch mode compares a head the remote lists: ' + text);
    assert.ok(!/origin\/002-stale/.test(text), 'PP-live-fetch-stale fetch mode does not compare a remote-tracking ref of a branch the remote no longer lists: ' + text); }
  // a worktree branch holds a number: a FAIL
  { const wt = path.join(os.tmpdir(), `pp-wt-${process.pid}`);
    try {
      const wtSha = mk([base], { 'specs/001-a/tasks.md': '# A\n- [ ] T380 one\n- [ ] T501 worktree\n' }, 'wt');
      G(['worktree', 'add', '-q', '-b', 'pp-wt-branch', wt, wtSha]);
      const w = run({ head: mineN, branch: '001-mine' });
      assert.ok(has(w.fails, /T501 \(specs\/001-a\/tasks\.md\) is also in worktree pp-wt-branch/), 'PP-numbers-worktree a worktree branch holds a number: ' + w.text);
    } finally { try { G(['worktree', 'remove', '--force', wt]); } catch { /* gone */ } try { G(['branch', '-D', 'pp-wt-branch']); } catch { /* gone */ } } }
  G(['update-ref', '-d', 'refs/remotes/origin/002-other']);
}

// ---- 8 removed asserts
{
  const rm = mk([base], { 'scripts/t.js': "assert.ok(1, 'one');\n" }, 'rm');
  const r = run({ head: rm, branch: '001-rm' });
  assert.ok(has(r.notes, /asserts: 1 removed/) && has(r.notes, /scripts\/t\.js: assert\.ok\(2, 'two'\);/), 'PP-asserts a removed assert is listed: ' + r.text);
  assert.ok(!has(r.fails, /assert/), 'PP-asserts a removed assert is a NOTE, not a FAIL');
}

// ---- 9 security shape words
{
  const sh = mk([base], { 'docs/x.md': 'line one\nline two\nline three\nthe fix strips a CRLF\n' }, 'sh');
  const r = run({ head: sh, branch: '001-sh', labels: ['bug', 'area:security', 'spec:021'] });
  assert.ok(has(r.fails, /public text: shape words in docs\/x\.md: "crlf"/), 'PP-security a shape word in docs fails a security PR: ' + r.text);
  assert.ok(has(run({ head: good, labels: ['bug', 'area:security', 'spec:021'], body: 'uses a Bearer header' }).fails, /PR body: "bearer"/), 'PP-security a shape word in the body fails');
  assert.ok(!has(run({ head: sh, branch: '001-sh' }).lines.map((l) => l.text), /public text/), 'PP-security only area:security PRs are checked');
  // an edited sentence that already named the word on the base is not new; a second, new occurrence is
  const ed = mk([base], { 'docs/s.md': 'the fix strips a CRLF from the value\n' }, 'ed');
  const e = run({ head: ed, branch: '001-ed', labels: ['bug', 'area:security', 'spec:021'] });
  assert.ok(!has(e.fails, /public text/) && has(e.lines.map((l) => l.text), /public text: no new shape words/), 'PP-security-net an edited line that kept the word is not new: ' + e.text);
  const ed2 = mk([base], { 'docs/s.md': 'the fix strips a CRLF from the value, and a CRLF in the name\n' }, 'ed2');
  assert.ok(has(run({ head: ed2, branch: '001-ed', labels: ['bug', 'area:security', 'spec:021'] }).fails, /docs\/s\.md: "crlf"/), 'PP-security-net a second occurrence is new');
}

// ---- 10 package.json
{
  const pk = mk([base], { 'package.json': PKG({ a: 'node a2.js', d: 'node d.js' }) }, 'pk');
  const r = run({ head: pk, branch: '001-pk' });
  assert.ok(has(r.fails, /package\.json scripts: \+1, removed \[b\], changed \[a\]/), 'PP-package a removed and a changed script fail: ' + r.text);
  const ok = mk([base], { 'package.json': PKG({ a: 'node a.js', b: 'node b.js', e: 'node e.js' }) }, 'pk ok');
  assert.ok(!has(run({ head: ok, branch: '001-pk' }).fails, /package/), 'PP-package an added script is fine');
}

// ---- 11 size
{
  assert.ok(has(run({ head: good, additions: 40 }).notes, /under 100/), 'PP-size a small PR gets the batch NOTE');
  assert.ok(has(run({ head: good, additions: 400 }).notes, /over 300/), 'PP-size a large PR gets the split NOTE');
  assert.ok(!has(run({ head: good, additions: 150 }).notes, /size/), 'PP-size 150 lines: no NOTE');
}

// ---- 12 checks
{
  const r = run({ head: good, checksStatus: 1, checks: [{ name: 'Build and test', bucket: 'fail' }, { name: 'Lint', bucket: 'pass' }] });
  assert.ok(has(r.fails, /checks: fail=1 pass=1 -- failing: Build and test/), 'PP-checks a failing check fails: ' + r.text);
  assert.ok(!has(run({ head: good, checksStatus: 8, checks: [{ name: 'x', bucket: 'pending' }] }).fails, /checks/), 'PP-checks pending is no FAIL');
}

// ---- read only: after all the runs above, the repository's refs are what the fixtures left
assert.strictEqual(G(['for-each-ref']), REFS_BEFORE, 'PP-readonly the runs changed no ref');

console.log('pr-preflight: all tests passed');
