#!/usr/bin/env node
// Spec 021 FR-063 (2026-11-08): tests of scripts/spec-numbers.js. Offline: the parser on fixtures, the clash logic with fake heads, and
// throwaway git repos run with --no-fetch (refs made by hand). SN_MODULE swaps the module (mutant runs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const modPath = process.env.SN_MODULE ? path.resolve(process.env.SN_MODULE) : path.join(__dirname, 'spec-numbers.js');
const sn = require(modPath);
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
- **FR-015 Title (amends FR-004).** an amendment with a title
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
assert.deepStrictEqual(ids(spec, 'spec'), ['FR-001', 'FR-002', 'FR-003', 'FR-004a', 'FR-005', 'FR-006', 'Q1', 'Q2', 'Q3', 'Q4'].sort());

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
assert.strictEqual(sn.scrub('has MyValue99 inside', { MY_API_KEY: 'MyValue99', PLAIN: 'zzzzzzzz' }), 'has *** inside');

// ---- git repos, --no-fetch
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-sn-'));
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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
  assert.notStrictEqual(r.status, 0, 'cannot fetch: never a pass');
  assert.match(all, /NOT CHECKED|WARN/);
  for (const secret of ['CanaryUrlPass77', 'CanaryTokenValue1234567', 'CanaryOther7654321', 'CanaryPlainEnv5555', 'CanaryNpm0000']) assert.ok(!all.includes(secret), `output must not contain ${secret}`);
  // a clash found with the heads at hand never prints the environment either
  r = cli(d, ['--no-fetch'], env); assert.ok(!(r.stdout + r.stderr).includes('Canary'));

  // the real repository's own files parse to something sane (the patterns still match the specs)
  const root = path.join(__dirname, '..');
  const s21 = sn.parseDefinitions(fs.readFileSync(path.join(root, 'specs/021-collaboration-harness/spec.md'), 'utf8'), 'spec');
  assert.ok(s21.has('FR-063') && s21.has('FR-082'), 'spec 021 defines FR-063 and FR-082');
  assert.ok(sn.parseDefinitions(fs.readFileSync(path.join(root, 'specs/021-collaboration-harness/tasks.md'), 'utf8'), 'tasks').has('T060'));
  console.log('spec-numbers tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
