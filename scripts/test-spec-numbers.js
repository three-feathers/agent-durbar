#!/usr/bin/env node
// Spec 021 FR-085 (2026-11-08): tests of scripts/spec-numbers.js. Offline: the parser on fixtures, the clash logic with fake heads, and
// throwaway git repos run with --no-fetch (refs made by hand). SN_MODULE swaps the module (mutant runs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const modPath = process.env.SN_MODULE ? path.resolve(process.env.SN_MODULE) : path.join(__dirname, 'spec-numbers.js');
const sn = require(modPath);
const { plumbCommit, gitRun } = require('./git-index-helper.js');
const { printable } = require('./safe-print.js');
const ids = (t, k) => [...sn.parseDefinitions(t, k)].sort();

// ---- parser: spec.md (FR, Q)
const spec = `# Spec
- **FR-001** plain definition
- **FR-002.** with a dot
- **FR-003 Visible title.** a titled one
- **FR-004a** letter suffix
* **FR-005** star bullet
- **FR-006:** colon
- **FR-007, FR-008** were superseded by FR-020 (a list: mentions)
- **FR-009 delta** \`[IMPLEMENTED]\` an amendment of an old number
- **FR-010..FR-012 status** (2026-10-28) a range
  - **FR-013.** nested: a delta of an old number
- FR-014 stays \`[IMPLEMENTED]\` (a bullet, not bold)
- **FR-015 Title (amends FR-004).** a titled definition that mentions another number
- **FR-021 Read/write access.** slash in the title
- **FR-022 Status line only.** words that look like an amendment
- **FR-023 Big, small and more.** comma in the title
**FR-024** column-0 paragraph (specs 005, 012, 058)
**FR-025, FR-026** a column-0 list
  **FR-027** indented
- **FR-028 and FR-029** a list
- **FR-030 status** (2026-10-28) a tag
Prose that says FR-016 and **FR-017** in a sentence.
| FR-018 | a table row |
\`\`\`
- **FR-019** in a code fence
\`\`\`
- Q1 Transport: (a) stdio
- **Q2** Bold question
1. **Q3** numbered
- **Q4:** colon
  - Q5 nested
Q6 prose at line start
- see Q7 for details
`;
assert.deepStrictEqual(ids(spec, 'spec'), ['FR-001', 'FR-002', 'FR-003', 'FR-004a', 'FR-005', 'FR-006', 'FR-015', 'FR-021', 'FR-022', 'FR-023', 'FR-024', 'Q1', 'Q2', 'Q3', 'Q4'].sort());

// ---- parser: tasks.md (T)
const tasks = `- [ ] T001 open
- [x] T002 done
- [-] T003 skipped
- [~] T004 maybe
  - [x] T005a indented sub-task
- [ ] **T006** bold
- [ ] ~~T007 struck~~
- T008 and T009 are answered by this entry (a mention)
- T010 → T011 (a graph)
- **T012** builds FR-025d (a bold mention, no checkbox)
Prose T013 here, and - [ ] T014 not at the start
| T015 | table |
- [ ] FR-016 is not a task
`;
assert.deepStrictEqual(ids(tasks, 'tasks'), ['T001', 'T002', 'T003', 'T004', 'T005a', 'T006', 'T007']);
// an FR line in tasks.md and a T line in spec.md are not definitions
assert.deepStrictEqual(ids('- **FR-001** x\n', 'tasks'), []);
assert.deepStrictEqual(ids('- [ ] T001 x\n', 'spec'), []);

// ---- added: a moved or reworded line is not new
const before = '- [ ] T001 a\n- [ ] T002 b\n- [ ] T003 c\n';
const moved = '- [ ] T001 a\n- [ ] T003 c reworded\n- [ ] T002 b moved\n- [ ] T004 new\n';
assert.deepStrictEqual([...sn.added(sn.parseDefinitions(before, 'tasks'), sn.parseDefinitions(moved, 'tasks'))], ['T004']);

// ---- clash logic with fake heads, per spec file
const M = (o) => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
const A = 'specs/001-a/tasks.md', B = 'specs/002-b/tasks.md';
const branchAdds = M({ [A]: ['T10', 'T11'], [B]: ['T10'] });
const clashes = sn.findClashes({
  branchAdds,
  main: M({ [A]: ['T11'], [B]: [] }),
  prs: [{ label: 'PR #7', adds: M({ [A]: ['T10'] }) }, { label: 'PR #8', adds: M({ [B]: ['T99'], [A]: ['T50'] }) }],
});
assert.deepStrictEqual(clashes.map((c) => `${c.file} ${c.id} ${c.with.split(' ')[0]}`), [`${A} T10 PR`, `${A} T11 origin/main`]);
assert.match(clashes[0].with, /PR #7/);
// the same number in another spec is allowed; nothing added: no clash
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [A]: ['T10'] }) }] }), []);
assert.deepStrictEqual(sn.findClashes({ branchAdds: new Map(), main: M({ [A]: ['T10'] }), prs: [{ label: 'x', adds: M({ [A]: ['T10'] }) }] }), []);

// ---- scrub
assert.strictEqual(sn.scrub('fatal: https://user:s3cr3tpass@github.com/x.git failed', {}), 'fatal: https://***@github.com/x.git failed');
assert.strictEqual(sn.scrub('token ghp_abcdef123456 here', {}), 'token *** here');
// glued tokens (review of PR #1316): snake_case word before, emphasis around, letters before, in a URL query, after a colon
for (const t of ['my_ghp_ABCDEF1234567890', '_ghp_ABCDEF1234567890_', '__ghp_ABCDEF1234567890__', 'xghp_ABCDEF1234567890', 'a-ghp_ABCDEF1234567890', 'token=ghp_ABCDEF1234567890&x=1', 'pre_github_pat_11AAAAAA0abcdefgh', 'k_sk-ABCDEFGHIJKLMNOPQRST', 'xAKIAABCDEFGHIJKLMNOP']) {
  for (const useBuilt of [false, true]) {
    const out = sn.scrub(`E: ${t} end`, {}, { useBuilt });
    assert.ok(!/ABCDEF1234567890|ABCDEFGHIJKLMNOPQRST|AAAAAA0abcdefgh|ABCDEFGHIJKLMNOP/.test(out), `token not masked (${t}, built=${useBuilt}): ${out}`);
  }
}
assert.ok(!sn.scrub('x eyJhbGciOiJI.eyJzdWIiOiIx.abcdef end', {}).includes('eyJhbGci'));
assert.strictEqual(sn.scrub('has MyValue99 inside', { MY_API_KEY: 'MyValue99', PLAIN: 'zzzzzzzz' }), 'has *** inside');

// ---- git repos, --no-fetch
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-sn-'));
const G = (cwd, ...a) => gitRun(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a]).trim();
const write = (d, f, t) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); };
const commit = (d, m) => { G(d, 'add', '--all'); G(d, 'commit', '-q', '-m', m); return G(d, 'rev-parse', 'HEAD'); }; // throwaway repo
const cli = (d, args = ['--no-fetch'], env = {}) => spawnSync(process.execPath, [modPath, '--root', d, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const T = (...n) => n.map((x) => `- [ ] T${x} task\n`).join('');
const S = (...n) => n.map((x) => `- **FR-${x}** req\n`).join('');
function repo() {
  const d = path.join(tmp, `r${fs.readdirSync(tmp).length}`);
  fs.mkdirSync(d); G(d, 'init', '-q', '-b', 'main');
  write(d, 'specs/001-a/tasks.md', T('001', '002', '003')); write(d, 'specs/001-a/spec.md', S('001'));
  write(d, 'specs/002-b/tasks.md', T('001'));
  commit(d, 'base');
  return d;
}
(async () => {
try {
  // a clash with an open PR head (same file), none for the other spec; the moved line is not a clash with main
  let d = repo();
  G(d, 'checkout', '-q', '-b', 'pr7'); write(d, 'specs/001-a/tasks.md', T('001', '002', '003', '010')); const pr7 = commit(d, 'pr7');
  G(d, 'checkout', '-q', 'main'); write(d, 'specs/001-a/spec.md', S('001', '009')); const mainSha = commit(d, 'main moves');
  G(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); G(d, 'update-ref', 'refs/remotes/pr/7', pr7);
  G(d, 'checkout', '-q', '-b', 'mine', 'main~1');
  write(d, 'specs/001-a/tasks.md', '- [ ] T001 task\n- [ ] T003 task\n- [ ] T002 task moved\n- [ ] T010 task\n- [ ] T011 task\n'); // T010 clashes with PR 7; T002 only moved
  write(d, 'specs/001-a/spec.md', S('001', '009'));  // FR-009 was added on main meanwhile
  write(d, 'specs/002-b/tasks.md', T('001', '010')); // T010 here is another spec: allowed
  commit(d, 'mine');
  let r = cli(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /specs\/001-a\/tasks\.md: T010 is also in PR #7/);
  assert.match(r.stdout, /specs\/001-a\/spec\.md: FR-009 is also in origin\/main/);
  assert.doesNotMatch(r.stdout, /T002|T011|002-b/);
  assert.match(r.stdout, /Fix: take the next free number/);
  // renumber to a free number: ok
  write(d, 'specs/001-a/tasks.md', '- [ ] T001 task\n- [ ] T003 task\n- [ ] T002 task moved\n- [ ] T012 task\n- [ ] T011 task\n');
  write(d, 'specs/001-a/spec.md', S('001', '010')); commit(d, 'renumber');
  r = cli(d); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ok, no clash/);
  // --exclude skips a PR number (own PR); a head HEAD already contains is skipped on its own
  G(d, 'update-ref', 'refs/remotes/pr/8', G(d, 'rev-parse', 'HEAD~1'));
  assert.strictEqual(cli(d).status, 0);
  write(d, 'specs/001-a/tasks.md', T('001', '010')); commit(d, 'takes 010 again');
  assert.strictEqual(cli(d).status, 1);
  assert.strictEqual(cli(d, ['--no-fetch', '--exclude', '7']).status, 0);
  // no origin/main: exit 2, a clear line, never ok
  const e = path.join(tmp, 'noorigin'); fs.mkdirSync(e); G(e, 'init', '-q', '-b', 'main'); write(e, 'specs/001-a/tasks.md', T('001')); commit(e, 'x');
  r = cli(e); assert.strictEqual(r.status, 2); assert.match(r.stdout, /NOT CHECKED.*git fetch origin main/); assert.doesNotMatch(r.stdout, /ok/);

  // secrets: a failing fetch (origin URL with credentials, tokens in the environment) prints neither
  const f = repo();
  G(f, 'remote', 'add', 'origin', 'http://user:CanaryUrlPass77@127.0.0.1:9/x/y.git');
  const env = { GH_TOKEN: 'ghp_CanaryTokenValue1234567', GITHUB_TOKEN: 'ghs_CanaryOther7654321', PLAIN_ENV: 'CanaryPlainEnv5555', NPM_TOKEN: 'CanaryNpm0000' };
  r = cli(f, [], env);
  const all = r.stdout + r.stderr;
  assert.strictEqual(r.status, 2, 'cannot fetch: exit 2, never 0 or 1');
  assert.match(all, /NOT CHECKED: could not fetch origin\/main/);
  for (const secret of ['CanaryUrlPass77', 'CanaryTokenValue1234567', 'CanaryOther7654321', 'CanaryPlainEnv5555', 'CanaryNpm0000']) assert.ok(!all.includes(secret), `output must not contain ${secret}`);
  // a clash found with the heads at hand never prints the environment either
  r = cli(d, ['--no-fetch'], env); assert.ok(!(r.stdout + r.stderr).includes('Canary'));

  // a failed fetch is exit 2 even when refs for origin/main are already here (a stale main must not read as "ok")
  const st = repo(); G(st, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); G(st, 'remote', 'add', 'origin', 'http://127.0.0.1:9/x/y.git');
  r = cli(st, []); assert.strictEqual(r.status, 2, r.stdout); assert.doesNotMatch(r.stdout, /no clash/);
  { // in process, with a PR list that reads fine: only the failed fetch of main can make it 2
    const out = []; const lg = console.log; console.log = (x) => out.push(String(x));
    let code; try { code = await sn.main(['--root', st], {}, { openPrs: async () => [] }); } finally { console.log = lg; }
    assert.strictEqual(code, 2, out.join('\n')); assert.ok(!out.some((l) => /no clash/.test(l)));
  }
  // the open PR list unreadable: exit 2 (it used to fetch every PR head ever opened and go on); readable and empty: goes on
  const src = repo(); const bare = path.join(tmp, 'origin.git'); G(tmp, 'clone', '-q', '--bare', src, bare);
  G(src, 'remote', 'add', 'origin', bare); G(src, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const lines = []; const log = console.log; console.log = (x) => lines.push(String(x));
  let c1, c2;
  try { c1 = await sn.main(['--root', src], {}, { openPrs: async () => null }); c2 = await sn.main(['--root', src], {}, { openPrs: async () => [] }); } finally { console.log = log; }
  assert.strictEqual(c1, 2); assert.ok(lines.some((l) => /NOT CHECKED: the open PR list could not be read/.test(l)));
  assert.strictEqual(c2, 0, lines.join('\n'));
  // a file that cannot be read from the repository: show throws, never an empty answer
  assert.throws(() => sn.show(src, 'f'.repeat(40), 'specs/001-a/tasks.md'));
  assert.strictEqual(sn.show(src, 'HEAD', 'specs/009-none/tasks.md'), '');
  assert.match(sn.show(src, 'HEAD', 'specs/001-a/tasks.md'), /T001/);

  // a number that main took after the merge-base and that was merged into the branch cleanly: HEAD is a merge commit (CI), the PR head is --head
  const hid = repo();
  const tf = (x) => `# a\n- [ ] T001 x\n${x.mid || ''}${'filler\n'.repeat(8)}- [ ] T002 y\n${x.end || ''}`;
  write(hid, 'specs/001-a/tasks.md', tf({})); commit(hid, 'layout');
  G(hid, 'checkout', '-q', '-b', 'feat'); write(hid, 'specs/001-a/tasks.md', tf({ end: '- [ ] T010 mine\n' })); const featTip = commit(hid, 'mine');
  G(hid, 'checkout', '-q', 'main'); write(hid, 'specs/001-a/tasks.md', tf({ mid: '- [ ] T010 main took it\n' })); commit(hid, 'main took T010');
  G(hid, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); G(hid, 'checkout', '-q', 'feat'); G(hid, 'merge', '-q', '--no-edit', 'main');
  r = cli(hid, ['--no-fetch', '--head', featTip]); assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /specs\/001-a\/tasks\.md: T010 is also in origin\/main/);
  r = cli(hid, ['--no-fetch']); assert.strictEqual(r.status, 1, 'no --head: the second definition in the merged file is still a clash'); assert.match(r.stdout, /T010 is also in this branch itself/);
  assert.strictEqual(cli(hid, ['--no-fetch', '--head', 'nothex']).status, 2);
  assert.strictEqual(sn.definitionCounts('- [ ] T001 a\n- [ ] T001 again\n', 'tasks').get('T001'), 2);

  // a hostile directory name (newline, ::error::, ##[error]) is never printed raw: both branch and main define T010 there. Built in the git index
  // only (git-index-helper.js), so it runs on Windows too, where such a directory name cannot exist.
  const ev = repo(); const evil = 'specs/009-x\n::error::pwned\n##[add-mask]y\n::set-output name=a::b/tasks.md';
  const evBase = plumbCommit(ev, 'HEAD', { [evil]: T('001') }, 'evil base');
  const evMine = plumbCommit(ev, evBase, { [evil]: T('001', '010') }, 'mine', 'refs/heads/mine');
  const evMain = plumbCommit(ev, evBase, { [evil]: T('001', '010') }, 'main');
  G(ev, 'update-ref', 'refs/remotes/origin/main', evMain); G(ev, 'symbolic-ref', 'HEAD', 'refs/heads/mine');
  r = cli(ev); assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  for (const line of (r.stdout + r.stderr).split('\n')) assert.ok(!/^\s*::/.test(line) && !line.includes('::') && !line.includes('##['), `raw workflow command in output: ${JSON.stringify(line)}`);
  assert.match(r.stdout, /CLASH specs\/009-x\\n: :error: :pwned\\n# #\[add-mask\]y\\n: :set-output name=a: :b\/tasks\.md: T010/);
  assert.ok(evMine);

  // printable: every `::` and every legacy `##[` / `##vso[` form is broken, anywhere in the text, with a control character or not
  for (const form of ['error', 'warning', 'add-mask', 'set-output name=x', 'debug', 'group', 'endgroup', 'stop-commands', 'notice', 'command']) {
    for (const t of [`##[${form}]x`, `docs/a##[${form}]fake##[${form}]CLASH.png`, `###[${form}]`, `x\n##[${form}]y`, `  ##[${form}]`]) {
      const out = printable(t); assert.ok(!out.includes('##['), `##[${form}] survives in ${JSON.stringify(out)}`); assert.ok(!/\n/.test(out));
    }
  }
  for (const t of ['##vso[task.setvariable variable=a]b', 'a##vso[task.complete result=Failed]']) assert.ok(!printable(t).includes('##vso['), t);
  for (const t of ['::error::x', 'a\n::warning::x', ':::error::x', 'a::b::c']) assert.ok(!printable(t).includes('::'), t);
  assert.strictEqual(printable('plain/path.png #1 [x] #[y]'), 'plain/path.png #1 [x] #[y]');

  // the PR list: a 401 with the token is retried without it; no token, no retry; both fail: null
  const calls = [];
  const rows = [{ number: 5, head: { sha: 'a'.repeat(40) } }];
  const expired = async (url, tok) => { calls.push(tok); if (tok) throw Object.assign(new Error('HTTP 401'), { status: 401 }); return rows; };
  assert.deepStrictEqual(await sn.restOpenPrs('o/r', 'expiredtoken', expired), [{ number: 5, sha: 'a'.repeat(40) }]);
  assert.deepStrictEqual(calls, ['expiredtoken', '']);
  const dead = async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); };
  assert.strictEqual(await sn.restOpenPrs('o/r', 'tok', dead), null);
  assert.strictEqual(await sn.restOpenPrs('o/r', '', async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }); }), null);

  // paging: pages are read until a short one; a list that never ends (more than the pages read) is "cannot tell", never a cut-short list
  const pagesSeen = [];
  const paged = async (url) => { const pg = Number(new URL(url).searchParams.get('page')); pagesSeen.push(pg); return Array.from({ length: pg < 3 ? 100 : 50 }, (_, i) => ({ number: pg * 1000 + i, head: { sha: 'b'.repeat(40) } })); };
  assert.strictEqual((await sn.restOpenPrs('o/r', '', paged)).length, 250); assert.deepStrictEqual(pagesSeen, [1, 2, 3]);
  assert.strictEqual(await sn.restOpenPrs('o/r', '', async () => Array.from({ length: 100 }, (_, i) => ({ number: i, head: { sha: 'c'.repeat(40) } }))), null);
  // `gh pr list --limit N` cuts the rest silently: an answer that reaches the limit is not trusted, the REST pages are read instead
  const gh = (n) => () => JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1, headRefOid: 'd'.repeat(40) })));
  const gr = repo(); G(gr, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  let rest = 0; const getJson = async () => { rest++; return [{ number: 7, head: { sha: 'e'.repeat(40) } }]; };
  assert.strictEqual((await sn.openPrs(gr, {}, { runCmd: gh(sn.GH_LIMIT - 1), getJson })).length, sn.GH_LIMIT - 1); assert.strictEqual(rest, 0);
  assert.deepStrictEqual(await sn.openPrs(gr, {}, { runCmd: gh(sn.GH_LIMIT), getJson }), [{ number: 7, sha: 'e'.repeat(40) }]); assert.strictEqual(rest, 1);
  assert.strictEqual(await sn.openPrs(gr, {}, { runCmd: gh(sn.GH_LIMIT), getJson: async () => { throw new Error('offline'); } }), null, 'at the limit and no REST: exit 2 follows, not a cut list');

  // a failed fetch of the PR heads is exit 2 (origin and the list are fine; the head ref does not exist on origin)
  { const out = []; const lg = console.log; console.log = (x) => out.push(String(x));
    let code; try { code = await sn.main(['--root', src], {}, { openPrs: async () => [{ number: 99, sha: 'a'.repeat(40) }] }); } finally { console.log = lg; }
    assert.strictEqual(code, 2, out.join('\n')); assert.ok(out.some((l) => /NOT CHECKED: could not fetch the PR heads/.test(l)), out.join('\n')); }

  // --head / PR_HEAD_SHA must be a full 40-hex sha: the check is what keeps `--output=...` or a branch name from reaching git as a revision.
  // `main` is a valid revision here, so only the check (not git's own failure) makes it exit 2; a real sha is accepted.
  { const sha = G(hid, 'rev-parse', 'main');
    for (const bad of ['main', 'HEAD~1', '--output=/dev/null', 'abc123', `${sha}x`, `${sha.slice(0, 39)}`]) {
      r = cli(hid, ['--no-fetch', '--head', bad]); assert.strictEqual(r.status, 2, `--head ${bad}`); assert.match(r.stdout, /40-character commit sha/, bad);
      r = cli(hid, ['--no-fetch'], { PR_HEAD_SHA: bad }); assert.strictEqual(r.status, 2, `PR_HEAD_SHA ${bad}`); assert.match(r.stdout, /40-character commit sha/);
    }
    r = cli(hid, ['--no-fetch', '--head', sha]); assert.notStrictEqual(r.status, 2, r.stdout); }

  // FR-094: stacked PRs inherit numbers. Pure part first.
  { const H = (label, headRef, baseRef, sameRepo = true) => ({ label, headRef, baseRef, sameRepo });
    const stk = (self, heads) => [...sn.stackRelated({ sameRepo: true, ...self }, heads).keys()].sort();
    assert.deepStrictEqual(stk({ headRef: 'a', baseRef: 'main' }, [H('PR #2', 'b', 'a'), H('PR #3', 'c', 'b'), H('PR #4', 'x', 'main')]), ['PR #2', 'PR #3'], 'stacked on this head branch, also a chain of two');
    assert.deepStrictEqual(stk({ headRef: 'c', baseRef: 'b' }, [H('PR #1', 'a', 'main'), H('PR #2', 'b', 'a'), H('PR #4', 'x', 'main')]), ['PR #1', 'PR #2'], 'this branch is stacked on them: the base chain');
    assert.deepStrictEqual(stk({ headRef: 'a', baseRef: 'main' }, [H('PR #4', 'x', 'main'), H('PR #5', 'y', 'main')]), [], 'two PRs on main are not stacked');
    assert.deepStrictEqual(stk({ headRef: 'main', baseRef: 'main' }, [H('PR #4', 'x', 'main')]), [], 'main is never a stack member');
    assert.deepStrictEqual(sn.stackRelated(null, [H('PR #4', 'x', 'a')]).size, 0);
    // two PRs on the same NON-main base are siblings, not a stack: only the PR of that base is related
    assert.deepStrictEqual(stk({ headRef: 'x', baseRef: 'F' }, [H('PR #1', 'F', 'main'), H('PR #2', 'y', 'F')]), ['PR #1'], 'siblings on a shared non-main base are not stacked with each other');
    // a fork PR never joins a stack, by name: not as a member, not as a link of a chain, not as the checked branch
    assert.deepStrictEqual(stk({ headRef: 'w', baseRef: 'main' }, [H('PR #900', '096-x', 'w', false), H('PR #50', '096-y', '096-x')]), [], 'a fork PR on this branch is no stack member and no link to a team PR');
    assert.deepStrictEqual(stk({ headRef: 'c', baseRef: 'b' }, [H('PR #900', 'b', 'main', false)]), [], 'a fork whose head name equals our base is not our base');
    assert.deepStrictEqual([...sn.stackRelated({ headRef: 'a', baseRef: 'main', sameRepo: false }, [H('PR #2', 'b', 'a')]).keys()], [], 'a fork branch is stacked with nothing');
    assert.deepStrictEqual(stk({ headRef: 'a', baseRef: 'main' }, [{ label: 'PR #2', headRef: 'b', baseRef: 'a' }]), [], 'unknown repository = not stacked (fail closed)'); }

  const stackRepo = () => {
    const sd = repo(); G(sd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    G(sd, 'checkout', '-q', '-b', 'search-window'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020')); const win = commit(sd, 'window');
    return { sd, win };
  };
  const names = (sd, args) => cli(sd, args, {});
  { // separate PR, same number: clash (no refs at all, no ancestry)
    const { sd } = stackRepo();
    G(sd, 'checkout', '-q', '-b', 'other', 'main'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020')); const oth = commit(sd, 'other');
    G(sd, 'update-ref', 'refs/remotes/pr/9', oth); G(sd, 'checkout', '-q', 'search-window');
    r = names(sd, ['--no-fetch']); assert.strictEqual(r.status, 1, 'separate PR taking the same number must clash: ' + r.stdout); assert.match(r.stdout, /T020 is also in PR #9/);
    // unrelated PR with other numbers: no clash
    write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '021')); commit(sd, 'renumbered');
    r = names(sd, ['--no-fetch']); assert.strictEqual(r.status, 0, 'unrelated PR with other numbers: ' + r.stdout);
  }
  { // PR whose history contains this head (no ref names known): the inherited number is no clash, its own new number is compared
    const { sd, win } = stackRepo();
    G(sd, 'checkout', '-q', '-b', 'search-ui'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020', '030')); const ui = commit(sd, 'ui');
    G(sd, 'update-ref', 'refs/remotes/pr/10', ui); G(sd, 'checkout', '-q', 'search-window');
    r = names(sd, ['--no-fetch']); assert.strictEqual(r.status, 0, 'a PR containing the checked head is not a second claim of what it inherits: ' + r.stdout);
    assert.ok(win);
  }
  { // a real double-take INSIDE one stack: both take T030 on their own after the cut (history shared up to the cut, neither contains the other)
    const { sd } = stackRepo();
    G(sd, 'checkout', '-q', '-b', 'search-ui'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020', '030')); const ui = commit(sd, 'ui takes T030');
    G(sd, 'checkout', '-q', 'search-window'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020', '030')); const win2 = commit(sd, 'window takes T030 on its own');
    G(sd, 'update-ref', 'refs/remotes/pr/10', ui);
    const heads = [{ label: 'PR #10', sha: ui, headRef: 'search-ui', baseRef: 'search-window', sameRepo: true }];
    const cl = sn.findClashes(sn.collect(sd, heads, win2, { headRef: 'search-window', baseRef: 'main', sameRepo: true }));
    assert.deepStrictEqual(cl.map((c) => `${c.id} ${c.with.split(' ')[0]}`), ['T030 PR'], 'a number each of two stacked PRs adds on its own is a clash');
    // the reverse: checked on the stacked branch
    const cl2 = sn.findClashes(sn.collect(sd, [{ label: 'PR #8', sha: win2, headRef: 'search-window', baseRef: 'main', sameRepo: true }], ui, { headRef: 'search-ui', baseRef: 'search-window', sameRepo: true }));
    assert.deepStrictEqual(cl2.map((c) => c.id), ['T030'], 'the reverse direction: the same double-take');
  }

  // diverged stack, the base PR moved on after the stack was cut: only the ref link (in main(), through gh and through the REST fallback) clears it
  { const sd = repo(); G(sd, 'checkout', '-q', '-b', 'search-window');
    write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020')); commit(sd, 'window cut');
    G(sd, 'checkout', '-q', '-b', 'search-ui'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020', '030')); const ui = commit(sd, 'ui');
    G(sd, 'checkout', '-q', 'search-window'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '020', '025')); const win = commit(sd, 'window moved on');
    G(sd, 'checkout', '-q', 'main'); G(sd, 'update-ref', 'refs/remotes/origin/main', 'main');
    const org = path.join(tmp, `o${fs.readdirSync(tmp).length}.git`); G(tmp, 'clone', '-q', '--bare', sd, org); G(sd, 'remote', 'add', 'origin', org);
    G(org, 'update-ref', 'refs/pull/10/head', ui); G(org, 'update-ref', 'refs/pull/8/head', win);
    G(sd, 'checkout', '-q', '--detach', win); // the checked-out branch name must not be what the answer depends on
    const gh = (rows) => () => JSON.stringify(rows);
    const ghRows = (cross10, base10 = 'search-window') => [
      { number: 8, headRefOid: win, headRefName: 'search-window', baseRefName: 'main', isCrossRepository: false },
      { number: 10, headRefOid: ui, headRefName: 'search-ui', baseRefName: base10, isCrossRepository: cross10 }];
    const restRows = (repo10) => [
      { number: 8, head: { sha: win, ref: 'search-window', repo: { full_name: 'o/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } } },
      { number: 10, head: { sha: ui, ref: 'search-ui', repo: { full_name: repo10 } }, base: { ref: 'search-window', repo: { full_name: 'o/r' } } }];
    const viaMain = async (openPrsFn, num) => { const out = []; const lg = console.log; console.log = (x) => out.push(String(x)); let code;
      try { code = await sn.main(['--root', sd], { PR_NUMBER: num, PR_HEAD_SHA: win }, { openPrs: openPrsFn }); } finally { console.log = lg; } return { code, out: out.join('\n') }; };
    const viaGh = (rows) => (root, env) => sn.openPrs(root, env, { runCmd: gh(rows) });
    const viaRest = (rows) => (root, env) => sn.openPrs(gr, env, { runCmd: () => { throw new Error('no gh'); }, getJson: async () => rows });
    // the list itself
    assert.deepStrictEqual(await viaGh(ghRows(false))(sd, {}), [{ number: 8, sha: win, headRef: 'search-window', baseRef: 'main', sameRepo: true }, { number: 10, sha: ui, headRef: 'search-ui', baseRef: 'search-window', sameRepo: true }], 'gh: refs and isCrossRepository are read');
    assert.deepStrictEqual((await viaRest(restRows('o/r'))(sd, { }))[1], { number: 10, sha: ui, headRef: 'search-ui', baseRef: 'search-window', sameRepo: true }, 'REST: refs and the repository are read');
    assert.strictEqual((await viaRest(restRows('fork/r'))(sd, {}))[1].sameRepo, undefined, 'REST: another repository is not same-repo');
    // through main(): the own PR's refs come from the list
    for (const [name, fn] of [['gh', viaGh(ghRows(false))], ['REST', viaRest(restRows('o/r'))]]) {
      const rr = await viaMain(fn, '8'); assert.strictEqual(rr.code, 0, `${name}: stacked PR #10 clears PR #8: ${rr.out}`);
    }
    // the same number on its own: no refs from the list (a mutant that drops them) must clash, and so must a fork PR of the same shape
    let rr = await viaMain(viaGh(ghRows(true)), '8'); assert.strictEqual(rr.code, 1, 'gh: a cross-repository PR never joins the stack: ' + rr.out);
    rr = await viaMain(viaGh(ghRows(null)), '8'); assert.strictEqual(rr.code, 1, 'gh: isCrossRepository unknown is not stacked: ' + rr.out);
    rr = await viaMain(viaRest(restRows('fork/r')), '8'); assert.strictEqual(rr.code, 1, 'REST: a fork PR never joins the stack: ' + rr.out);
    rr = await viaMain(viaGh(ghRows(false, 'unrelated')), '8'); assert.strictEqual(rr.code, 1, 'gh: base ref not this head: a separate PR clashes: ' + rr.out);
  }

  // the workflow keeps the token away from PR code (mutant: remove any of these and this fails)
  // a Windows checkout has CRLF line ends (core.autocrlf): the shape checks read the workflow with LF only, and a CRLF copy must give the same jobs
  const wfRaw = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'spec-kit.yml'), 'utf8');
  const wf = wfRaw.replace(/\r\n/g, '\n');
  assert.strictEqual(wfRaw.replace(/\r?\n/g, '\r\n').replace(/\r\n/g, '\n'), wf, 'a CRLF checkout of the workflow reads the same as LF');
  const job = (name) => { const m = wf.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\n|(?![\\s\\S]))`, 'm')); assert.ok(m, `job ${name}`); return m[1]; };
  const code_ = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  // the trigger: `pull_request_target` nowhere in the workflow (the `on:` block and any `if:` included), no workflow-level or job-level `env:`
  // (a token set there reaches every step and every checkout, not only the one that needs it)
  const wfCode = code_(wf);
  assert.doesNotMatch(wfCode, /pull_request_target/, 'no pull_request_target anywhere in the workflow');
  assert.doesNotMatch(wfCode, /^env:/m, 'no workflow-level env');
  for (const name of ['spec-numbers', 'spec-numbers-selftest']) {
    const j = code_(job(name));
    assert.doesNotMatch(j, /^    env:/m, `${name}: no job-level env (a token there reaches every step)`);
    assert.doesNotMatch(j, /^    (?:container|services|defaults):/m);
    const perms = (j.match(/^    permissions:\n((?:      [a-z-]+: [a-z]+\n)+)/m) || [])[1] || '';
    assert.ok(perms, `${name}: job permissions`); assert.doesNotMatch(perms, /: write/, `${name}: read-only permissions`);
    const checkouts = j.split(/- (?:name: [^\n]*\n\s+)?uses: actions\/checkout@/).slice(1);
    assert.ok(checkouts.length >= 1);
    for (const c of checkouts) assert.match(c.split(/\n\s+- /)[0], /persist-credentials: false/, `${name}: every checkout has persist-credentials: false`);
  }
  // a token (secrets.*, GH_TOKEN, GITHUB_TOKEN, github.token) appears in exactly one place of the whole workflow's two jobs: the step that runs the base spec-numbers.js
  const tokenRe = /secrets\.|GH_TOKEN|GITHUB_TOKEN|github\.token/; // no /g: test() on a /g regex keeps lastIndex between calls
  const tokenAll = new RegExp(tokenRe.source, 'g');
  const mine = code_(job('spec-numbers')) + '\n' + code_(job('spec-numbers-selftest'));
  const steps = mine.split(/\n      - /);
  const withToken = steps.filter((t) => tokenRe.test(t));
  assert.strictEqual(withToken.length, 1, 'one step holds a token');
  assert.match(withToken[0], /node base\/scripts\/spec-numbers\.js/); assert.doesNotMatch(withToken[0], /picture-budget/);
  assert.strictEqual((mine.match(tokenAll) || []).length, 3, 'one line: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
  const selftest = code_(job('spec-numbers-selftest'));
  assert.doesNotMatch(selftest, /secrets\.|GH_TOKEN|GITHUB_TOKEN|github\.token/, 'the job that runs the PR scripts has no token');
  const nums = code_(job('spec-numbers'));
  assert.match(nums, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n\s+path: base/, 'the base ref is checked out to base/');
  assert.match(nums, /node base\/scripts\/spec-numbers\.js/); assert.match(nums, /node base\/scripts\/picture-budget\.js/);
  assert.doesNotMatch(nums, /node (?!base\/)[^\n]*scripts\//, 'the token job runs only the base copy of the scripts');
  assert.doesNotMatch(nums, /test-(spec-numbers|picture-budget)/, 'the PR self-tests do not run in the token job');
  assert.match(nums, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.strictEqual((nums.match(/GH_TOKEN/g) || []).length, 1, 'the token is in the environment of one step only');
  assert.doesNotMatch(nums, /\$\{\{ github\.event\.pull_request\.(body|title|head\.ref)/);

  // the real repository's own files parse to something sane (the patterns still match the specs)
  const root = path.join(__dirname, '..');
  const s21 = sn.parseDefinitions(fs.readFileSync(path.join(root, 'specs/021-collaboration-harness/spec.md'), 'utf8'), 'spec');
  assert.ok(s21.has('FR-063') && s21.has('FR-082'), 'spec 021 defines FR-063 and FR-082');
  assert.ok(sn.parseDefinitions(fs.readFileSync(path.join(root, 'specs/021-collaboration-harness/tasks.md'), 'utf8'), 'tasks').has('T060'));
  console.log('spec-numbers tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
})().catch((e) => { console.error(e); process.exit(1); });
