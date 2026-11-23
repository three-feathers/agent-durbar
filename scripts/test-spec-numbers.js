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
- \`[IMPLEMENTED]\` **FR-031 Tagged title.** an evidence tag before the id (issue #1768)
- \`[KNOWN GAP]\` **FR-032** tagged, bare
- \`[IMPLEMENTED]\` **FR-033, FR-034** a tagged list: mentions
- \`[IMPLEMENTED]\` plain words, **FR-035** later in the line: not a definition
1. \`[IMPLEMENTED]\` Q8 tagged question
`;
assert.deepStrictEqual(ids(spec, 'spec'), ['FR-001', 'FR-002', 'FR-003', 'FR-004a', 'FR-005', 'FR-006', 'FR-015', 'FR-021', 'FR-022', 'FR-023', 'FR-024', 'FR-031', 'FR-032', 'Q1', 'Q2', 'Q3', 'Q4', 'Q8'].sort(), 'a definition after an evidence tag (issue #1768) is read like one without it');

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
assert.deepStrictEqual(clashes.map((c) => `${c.file} ${c.id} ${c.with.split(' ')[0]}`), [`${A} T10 PR`, `${A} T11 origin/main`, `${B} T10 PR`]);
assert.match(clashes[0].with, /PR #7/);
// issue #1935: the same number in ANOTHER existing spec is a clash (numbers are global), naming both files and the PR; a free number, a spec new on main, and a T against an FR do not
const x = sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [A]: ['T10'] }) }] });
assert.deepStrictEqual(x.map((c) => `${c.file} ${c.id}`), [`${B} T10`], 'T10 in two different specs is a clash');
assert.match(x[0].with, /PR #7.*specs\/001-a\/tasks\.md/, 'the clash names the other head and its file');
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [A]: ['T11'] }) }] }), [], 'a number free in every head passes');
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), fresh: new Set([A]), prs: [{ label: 'PR #7', adds: M({ [A]: ['T10'] }) }] }), [], 'a spec new on main numbers from its own start');
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), fresh: new Set([B]), prs: [{ label: 'PR #7', adds: M({ [A]: ['T10'] }) }] }), [], 'the same when the branch file is the new one');
const SA = 'specs/001-a/spec.md', SB = 'specs/002-b/spec.md';
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [SB]: ['FR-300'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [SA]: ['FR-300'] }) }] }).map((c) => `${c.file} ${c.id}`), [`${SB} FR-300`], 'the same FR in two specs is a clash');
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [SB]: ['Q9'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [SA]: ['Q9'] }) }] }).length, 1, 'the same Q in two specs is a clash');
assert.deepStrictEqual(sn.findClashes({ branchAdds: M({ [B]: ['T10'] }), main: M({}), prs: [{ label: 'PR #7', adds: M({ [SA]: ['T10'] }) }] }), [], 'a spec.md id is never compared with a tasks.md id');
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
  write(d, 'specs/002-b/tasks.md', T('001', '040')); // another spec, a number free everywhere: allowed
  commit(d, 'mine');
  let r = cli(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /specs\/001-a\/tasks\.md: T010 is also in PR #7/);
  assert.match(r.stdout, /specs\/001-a\/spec\.md: FR-009 is also in origin\/main/);
  assert.doesNotMatch(r.stdout, /T002|T011|002-b/);
  // issue #1935 through git: PR 7's T010 in spec 001, this branch takes T010 in spec 002 (collect reads the head's own files): a clash naming PR #7
  write(d, 'specs/002-b/tasks.md', T('001', '010')); commit(d, 'takes T010 in the other spec');
  r = cli(d); assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /specs\/002-b\/tasks\.md: T010 is also in PR #7 \(added there too, in specs\/001-a\/tasks\.md/);
  write(d, 'specs/002-b/tasks.md', T('001', '040')); commit(d, 'free again');
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
  { // issue #1935 in a stack: the stacked PR keeps the inherited T020 (spec 001) and adds T040 in spec 002: no clash; taking the inherited T020 again in spec 002 is one
    const { sd, win } = stackRepo();
    G(sd, 'checkout', '-q', '-b', 'search-ui'); write(sd, 'specs/002-b/tasks.md', T('001', '040')); const ui = commit(sd, 'ui, other spec, free number');
    const hd = [{ label: 'PR #10', sha: ui, headRef: 'search-ui', baseRef: 'search-window', sameRepo: true }];
    assert.deepStrictEqual(sn.findClashes(sn.collect(sd, hd, win, { headRef: 'search-window', baseRef: 'main', sameRepo: true })), [], 'a stacked head with a free number in another spec is no clash');
    write(sd, 'specs/002-b/tasks.md', T('001', '020')); const ui2 = commit(sd, 'ui takes the inherited T020 again in spec 002');
    const cl = sn.findClashes(sn.collect(sd, [{ ...hd[0], sha: ui2 }], win, { headRef: 'search-window', baseRef: 'main', sameRepo: true }));
    assert.deepStrictEqual(cl.map((c) => `${c.file} ${c.id}`), ['specs/001-a/tasks.md T020'], 'the same number in two specs inside a stack is a clash when taken on its own');
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

  // issue #1768: two open PR heads hold FR-243, one as a tagged definition (`- `[IMPLEMENTED]` **FR-243 ...**`, #1487) and one as a bold bullet (#1766);
  // the tagged one used to be no definition, so the clash was never seen. Same for a Q.
  { const x = repo(); const F = 'specs/003-c/spec.md';
    write(x, F, '- **FR-001** a\n- **Q1** a\n'); commit(x, 'spec c'); G(x, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    G(x, 'checkout', '-q', '-b', 'tagged'); write(x, F, '- **FR-001** a\n- **Q1** a\n### 2026-11-11: x (FR-243, bug)\n- \`[IMPLEMENTED]\` **FR-243 The office is laid out.** text\n- \`[KNOWN GAP]\` Q9 tagged\n'); const tagged = commit(x, 'tagged');
    G(x, 'checkout', '-q', 'main'); G(x, 'checkout', '-q', '-b', 'bold'); write(x, F, '- **FR-001** a\n- **Q1** a\n- **FR-243** **A question card.** text\n- **Q9** bold\n'); commit(x, 'bold');
    G(x, 'update-ref', 'refs/remotes/pr/1487', tagged);
    r = cli(x); assert.strictEqual(r.status, 1, 'a tagged FR on another open head is a clash: ' + r.stdout + r.stderr);
    assert.match(r.stdout, /specs\/003-c\/spec\.md: FR-243 is also in PR #1487/); assert.match(r.stdout, /specs\/003-c\/spec\.md: Q9 is also in PR #1487/); }

  // ---- --wide (spec 021 FR-085 delta 2026-11-23): remote branches without a PR, worktree branches, dead branches
  { const sd = repo(); G(sd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const branchOff = (name, ...nums) => { G(sd, 'checkout', '-q', '-b', name, 'main'); write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', ...nums)); return commit(sd, name); };
    const nopr = branchOff('nopr', '020'), dead = branchOff('deadpr', '030'), mergedTip = branchOff('mergedbr', '040');
    G(sd, 'checkout', '-q', '-b', 'quiet', 'main'); write(sd, 'README.md', 'quiet\n'); commit(sd, 'quiet'); // a branch that adds no number: it never clashes, so its PR is never looked up
    G(sd, 'checkout', '-q', 'main'); G(sd, 'merge', '-q', '--ff-only', 'mergedbr'); G(sd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const org = path.join(tmp, 'wide-origin.git'); G(tmp, 'init', '-q', '--bare', org);
    G(sd, 'push', '-q', org, 'main', 'nopr', 'deadpr', 'quiet'); G(sd, 'remote', 'add', 'origin', org);
    G(org, 'update-ref', 'refs/heads/gh-readonly-queue/main/pr-1-x', nopr); // a merge-queue branch is never a head
    const wt1 = path.join(tmp, 'wt1'), wt2 = path.join(tmp, 'wt2');
    G(sd, 'worktree', 'add', '-q', '-b', 'wtone', wt1, 'main'); write(wt1, 'specs/001-a/tasks.md', T('001', '002', '003', '040', '050')); commit(wt1, 'wt one');
    G(sd, 'worktree', 'add', '-q', '-b', 'wttwo', wt2, 'main'); write(wt2, 'specs/001-a/tasks.md', T('001', '002', '003', '040', '060')); commit(wt2, 'wt two');
    G(sd, 'checkout', '-q', '-b', 'mine', 'main');
    write(sd, 'specs/001-a/tasks.md', T('001', '002', '003', '040', '020', '030', '050', '060')); commit(sd, 'mine');
    const rows = (sha, over = {}) => [{ headRefOid: sha, mergedAt: null, state: 'CLOSED', isCrossRepository: false, ...over }];
    const state = (over = {}) => (name) => { if (name === 'quiet') throw new Error('WIDE-lookup-clash-only asked about a branch that clashes with nothing'); return name in over ? over[name] : []; };
    const via = async (argv, deps = {}) => { const out = []; const lg = console.log; console.log = (x) => out.push(String(x)); let code;
      try { code = await sn.main(['--root', sd, ...argv], {}, { openPrs: async () => [], ...deps }); } finally { console.log = lg; } return { code, out: out.join('\n') }; };
    // the lists
    assert.ok(sn.worktreeHeads(sd).some((h) => h.name === 'wtone' && /^[0-9a-f]{40}$/.test(h.sha)), 'worktreeHeads lists a worktree branch with its tip');
    assert.deepStrictEqual(sn.liveRemoteHeads(sd).map((h) => h.name).sort(), ['deadpr', 'gh-readonly-queue/main/pr-1-x', 'main', 'nopr', 'quiet'], 'liveRemoteHeads reads git ls-remote');
    const brokenRemote = repo(); G(brokenRemote, 'remote', 'add', 'origin', path.join(tmp, 'does-not-exist.git'));
    assert.throws(() => sn.liveRemoteHeads(brokenRemote), 'WIDE-lsremote a failing ls-remote throws (exit 2), never an empty list');
    assert.throws(() => sn.liveRemoteHeads(sd, () => `${nopr}\trefs/heads/nopr\n`), /did not list main/, 'WIDE-lsremote-main an answer without main is not trusted');
    assert.throws(() => sn.liveRemoteHeads(sd, () => 'garbage\n'), /not a head/, 'WIDE-lsremote-line a line that is not a head throws');
    assert.throws(() => sn.worktreeHeads(path.join(tmp, 'no-such-repo')), 'WIDE-worktree-throws a failing `git worktree list` throws (exit 2), never an empty list');
    // pure: what is left out
    const hh = sn.wideHeads(sd, { remote: [{ name: 'main', sha: nopr }, { name: 'mine', sha: nopr }, { name: 'HEAD', sha: nopr }, { name: 'gh-readonly-queue/main/x', sha: nopr }, { name: 'open1', sha: dead }, { name: 'open2', sha: nopr }, { name: 'free', sha: mergedTip }], worktrees: [{ name: 'free2', sha: mergedTip }, { name: 'wtopen', sha: nopr }], open: [{ sha: dead, headRef: 'x', sameRepo: true }, { sha: '0'.repeat(40), headRef: 'open2', sameRepo: true }, { sha: '1'.repeat(40), headRef: 'wtopen', sameRepo: true }], selfRef: 'mine' });
    assert.deepStrictEqual(hh.map((h) => h.name), ['free'], 'main, HEAD, this branch, queue branches, open PR heads (by name or tip) and a worktree twin of a remote head are left out');
    // a fork PR named like one of our branches does not hide it (by name only a PR of this repository counts); by tip any PR counts
    { const fk = sn.wideHeads(sd, { remote: [{ name: 'nopr', sha: nopr }], worktrees: [{ name: 'wtone', sha: dead }], open: [{ sha: '2'.repeat(40), headRef: 'nopr', sameRepo: false }, { sha: '3'.repeat(40), headRef: 'wtone', sameRepo: false }], selfRef: 'mine', dates: false });
      assert.deepStrictEqual(fk.map((h) => h.name), ['nopr', 'wtone'], 'WIDE-fork a fork PR of the same name leaves the remote branch and the worktree branch in the list');
      const own = sn.wideHeads(sd, { remote: [{ name: 'nopr', sha: nopr }], worktrees: [{ name: 'wtone', sha: dead }], open: [{ sha: '2'.repeat(40), headRef: 'nopr', sameRepo: true }, { sha: '3'.repeat(40), headRef: 'wtone', sameRepo: true }], selfRef: 'mine', dates: false });
      assert.deepStrictEqual(own, [], 'WIDE-own-pr a PR of this repository by that name leaves them out');
      const bySha = sn.wideHeads(sd, { remote: [{ name: 'nopr', sha: nopr }], open: [{ sha: nopr, headRef: 'other', sameRepo: false }], selfRef: 'mine', dates: false });
      assert.deepStrictEqual(bySha, [], 'WIDE-fork-sha the tip of any open PR is that PR\'s tip: compared already'); }
    // main(): the lists that cannot be read are exit 2, never a pass
    for (const [why, deps, re] of [['ls-remote fails', { remoteHeads: () => { throw new Error('ls-remote broke'); } }, /NOT CHECKED: ls-remote broke/], ['a head was never fetched', { remoteHeads: () => [...sn.liveRemoteHeads(sd), { name: 'ghost', sha: '9'.repeat(40) }] }, /NOT CHECKED: a remote head could not be fetched/], ['worktree list fails', { worktrees: () => { throw new Error('worktree list broke'); } }, /NOT CHECKED: worktree list broke/]]) {
      const x = await via(['--wide'], { branchState: state(), ...deps });
      assert.strictEqual(x.code, 2, `WIDE-exit2 ${why}: exit 2: ${x.out}`);
      assert.match(x.out, re, `WIDE-exit2 ${why}: says NOT CHECKED`);
      assert.doesNotMatch(x.out, /ok, no clash/);
    }
    // through main(): the open PR list's refs reach the wide list (a PR of this repository named nopr hides the branch; a fork PR named nopr does not)
    { G(org, 'update-ref', 'refs/pull/99/head', G(sd, 'rev-parse', 'quiet'));
      const pr99 = (extra) => async () => [{ number: 99, sha: G(sd, 'rev-parse', 'quiet'), headRef: 'nopr', baseRef: 'main', ...extra }];
      const t1 = await via(['--wide'], { branchState: state(), openPrs: pr99({ sameRepo: true }) });
      assert.doesNotMatch(t1.out, /T020 is also in branch nopr/, 'WIDE-main-own an open PR of this repository named like the branch: it is that PR, compared as PR #99: ' + t1.out);
      const t2 = await via(['--wide'], { branchState: state(), openPrs: pr99({}) });
      assert.match(t2.out, /T020 is also in branch nopr/, 'WIDE-main-fork a fork PR named like the branch does not hide it: ' + t2.out); }
    // 1: remote branch without a PR, worktree branches, a dead branch, live remote list
    let r = await via(['--wide'], { branchState: state() });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /T020 is also in branch nopr, tip \d{4}-\d\d-\d\d \(added there too\)/, 'WIDE-remote a remote branch with no PR holds a number: a clash naming the branch and its tip date');
    assert.match(r.out, /T050 is also in worktree wtone, tip \d{4}-\d\d-\d\d/, 'WIDE-worktree a worktree branch holds a number: a clash');
    assert.match(r.out, /T060 is also in worktree wttwo/, 'WIDE-worktree-two the second worktree is a clash too');
    assert.match(r.out, /T030 is also in branch deadpr/, 'a branch whose PR state says live (open or none) holds its numbers');
    // 2: closed and unmerged at that tip: skipped, NOTE
    r = await via(['--wide'], { branchState: state({ deadpr: rows(dead) }) });
    assert.match(r.out, /NOTE skipped branch deadpr, tip \d{4}-\d\d-\d\d: its PR is closed and not merged/, 'WIDE-dead a closed, unmerged PR leaves a NOTE');
    assert.doesNotMatch(r.out, /T030 is also/, 'WIDE-dead its numbers are free');
    assert.match(r.out, /T020 is also in branch nopr/, 'the other clashes stay');
    // 3: the branch moved after its PR closed, a merged PR, a fork PR: counted
    for (const [why, over] of [['the tip moved on', rows('f'.repeat(40))], ['it was merged', rows(dead, { state: 'MERGED', mergedAt: '2026-11-01T00:00:00Z' })], ['an open PR', rows(dead, { state: 'OPEN' })], ['a fork PR of that name', rows(dead, { isCrossRepository: true })], ['no PR', []]]) {
      r = await via(['--wide'], { branchState: state({ deadpr: over }) });
      assert.match(r.out, /T030 is also in branch deadpr/, `WIDE-dead-tip ${why}: its numbers are still held`);
    }
    // 4: the PR state cannot be read: exit 2, never a pass
    r = await via(['--wide'], { branchState: state({ nopr: null }) });
    assert.strictEqual(r.code, 2, 'WIDE-unread an unreadable PR state is exit 2: ' + r.out);
    assert.match(r.out, /NOT CHECKED: could not read the PR state of branch nopr/);
    assert.doesNotMatch(r.out, /ok, no clash/);
    // 5: no --wide (the CI invocation): open PR heads only; no remote branch, no worktree, no PR state is read
    r = await via([], { branchState: () => { throw new Error('the narrow run must not ask'); } });
    assert.strictEqual(r.code, 0, 'WIDE-ci without --wide the branches and worktrees are not compared: ' + r.out);
    assert.doesNotMatch(r.out, /nopr|wtone|--wide/);
    // 6: --no-fetch --wide reads the remote-tracking refs, offline
    G(sd, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
    r = await via(['--wide', '--no-fetch'], { branchState: state() });
    assert.match(r.out, /T020 is also in branch nopr/, 'WIDE-nofetch the remote-tracking refs are the list');
    assert.match(r.out, /--wide: \d+ remote branch\(es\)/);
    // 7: a branch name is printed through printable (no workflow command)
    assert.ok(sn.wideHeads(sd, { remote: [{ name: 'a::error::x', sha: nopr }], dates: false })[0].label.includes(': :error: :x'), 'WIDE-print a head name is made printable');
  }
  // the CI invocation never has --wide (open PR heads only), and `npm run specs:numbers` has it
  { const wfText = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'spec-kit.yml'), 'utf8');
    const calls = wfText.split(/\r?\n/).filter((l) => /^\s*(?!#).*node base\/scripts\/spec-numbers\.js/.test(l));
    assert.strictEqual(calls.length, 1, 'WIDE-ci-pin one call of spec-numbers.js in the workflow');
    assert.doesNotMatch(calls[0], /--wide/, 'WIDE-ci-pin CI compares open PR heads only: its call has no --wide');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.match(pkg.scripts['specs:numbers'], /spec-numbers\.js --wide$/, 'WIDE-npm `npm run specs:numbers` compares the wide list'); }

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

  // ---- one number defined twice inside one file (issue #1553), whole tree, offline, temp folders
  assert.strictEqual(sn.checkDuplicates([{ file: 'specs/001-a/spec.md', id: 'FR-001', lines: [1, 3] }], '').length, 1, 'MUTANT-A a number defined twice in one file is a problem');
  assert.deepStrictEqual(sn.checkDuplicates([{ file: 'specs/001-a/spec.md', id: 'FR-001', lines: [1, 3] }], 'specs/001-a/spec.md FR-001 2'), []);
  { const dd = path.join(tmp, 'dups'); fs.mkdirSync(dd);
    const spec = (...ls) => ls.join('\n') + '\n';
    write(dd, 'specs/001-a/spec.md', spec('# A', '- **FR-001** one', '- **FR-002** two', 'A reference to **FR-001** in prose and "FR-002" in a table:', '| FR-002 | row |', '- see **FR-002, FR-003** (a list)'));
    write(dd, 'specs/001-a/tasks.md', T('001', '002'));
    write(dd, 'specs/002-b/spec.md', spec('- **FR-001** one', '- **FR-002** two', '- **FR-001** again'));
    let r = cli(dd, ['--dups']);
    assert.strictEqual(r.status, 1, 'MUTANT-C a duplicate in the second spec folder must fail --dups (every folder is read): ' + r.stdout + r.stderr);
    assert.match(r.stdout, /specs\/002-b\/spec\.md: FR-001 is defined 2 times \(lines 1, 3\)/, 'duplicate named with both lines (second spec folder)');
    assert.doesNotMatch(r.stdout, /001-a/, 'MUTANT-B references and a list in the first folder are not definitions');
    // the first folder alone is also checked
    write(dd, 'specs/002-b/spec.md', spec('- **FR-001** ok'));
    r = cli(dd, ['--dups']); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    write(dd, 'specs/001-a/tasks.md', T('001', '002', '002'));
    r = cli(dd, ['--dups']); assert.strictEqual(r.status, 1, 'duplicate T in the first spec folder must fail --dups: ' + r.stdout); assert.match(r.stdout, /specs\/001-a\/tasks\.md: T002 is defined 2 times \(lines 2, 3\)/, 'duplicate in the first spec folder');
    // a baseline allows what was there, never more; a stale line fails
    r = cli(dd, ['--write-baseline']); assert.strictEqual(r.status, 0, r.stdout);
    r = cli(dd, ['--dups']); assert.strictEqual(r.status, 0, 'baselined duplicate passes: ' + r.stdout);
    write(dd, 'specs/001-a/tasks.md', T('001', '002', '002', '002'));
    r = cli(dd, ['--dups']); assert.strictEqual(r.status, 1); assert.match(r.stdout, /T002 is defined 3 times \(lines 2, 3, 4\); the baseline allows 2/, 'a baselined duplicate may not grow');
    write(dd, 'specs/001-a/tasks.md', T('001', '002'));
    r = cli(dd, ['--dups']); assert.strictEqual(r.status, 1); assert.match(r.stdout, /T002 is no longer duplicated/, 'a stale baseline line fails');
  }
  // a branch that adds a second definition: the clash names both lines
  { const d2 = repo();
    G(d2, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    G(d2, 'checkout', '-q', '-b', 'mine');
    write(d2, 'specs/001-a/spec.md', S('001', '002') + '- **FR-001** again\n'); commit(d2, 'dup');
    const r = cli(d2); assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /specs\/001-a\/spec\.md: FR-001 is also in this branch itself \(defined twice in the file, lines 1 and 3;/, 'both lines named');
  }
  // the repository's own specs: no duplicate beyond the baseline (mutant: references counted as definitions fails here)
  { const r = cli(path.join(__dirname, '..'), ['--dups']); assert.strictEqual(r.status, 0, 'MUTANT-B the repository specs have no duplicate beyond the baseline: ' + r.stdout + r.stderr); }

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
