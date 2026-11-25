/**
 * Unit test (spec 021 FR-422, T512): scripts/pr-ready.js, `npm run pr:ready`. Offline. Each guard fails alone through an injected runner
 * (a table), the order and the stop at the first failure are asserted from the recorded calls, the conditional guards run only when their files
 * changed, a CRLF diff is read like an LF one, and three cases run real git in a throwaway repository. Every assert message carries
 * `PR-READY-<guard>`: the mutants (one guard dropped each, two conditions dropped, the stop dropped) run this file again with
 * PR_READY_MODULE set and must die at their own tag. No network, no Electron.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const modPath = process.env.PR_READY_MODULE ? path.resolve(process.env.PR_READY_MODULE) : path.join(ROOT, 'scripts', 'pr-ready.js');
interface Res { lines: string[]; ok: boolean; head: string }
interface Run { (cmd: string, args: string[]): { status: number; out: string } }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pr = require(modPath) as { ready: (o: { root?: string; run: Run; security?: boolean }) => Res; crlfCuts: (d: string) => string[]; BASE: string };

const HEAD = 'a'.repeat(40);
interface Fx { failAt?: string; out?: string; files: string[]; publicDiff: string; srcDiff: string; sigs: string[]; msgs: string[]; dirty: string; fetchFails: boolean }
const fx = (o: Partial<Fx> = {}): Fx => ({ files: ['specs/021-collaboration-harness/spec.md'], publicDiff: '', srcDiff: '', sigs: [`${'b'.repeat(40)} G`], msgs: [`${'b'.repeat(40)}\nA plain message\n`], dirty: '', fetchFails: false, ...o });
/** The injected runner: answers by the command's argv; records every call as a label. failAt = the label that exits 1 with `out`. */
function runner(f: Fx, calls: string[]): Run {
  const label = (cmd: string, a: string[]): string => {
    if (cmd === 'git') return `git ${a[0]}${a[0] === 'diff' && a.includes('--check') ? ' --check' : ''}`;
    const s = a[0].replace(/\\/g, '/');
    if (/typescript\/bin\/tsc$/.test(s)) return 'tsc';
    if (/dist-scripts\/scripts\/(test-[a-z-]+)\.js$/.test(s)) return RegExp.$1;
    return `${s.replace(/^scripts\//, '').replace(/\.js$/, '')}${a[1] ? ' ' + a[1] : ''}`;
  };
  return (cmd, a) => {
    const l = label(cmd, a);
    calls.push(l);
    if (f.failAt === l) return { status: 1, out: f.out || 'boom' };
    if (l === 'git fetch') return { status: f.fetchFails ? 1 : 0, out: '' };
    if (l === 'git rev-parse') return { status: 0, out: `${HEAD}\n` };
    if (l === 'git merge-base') return { status: 0, out: `${'c'.repeat(40)}\n` };
    if (l === 'git status') return { status: 0, out: f.dirty };
    if (l === 'git log') return { status: 0, out: a.includes('-z') ? f.msgs.join('\0') : f.sigs.join('\n') };
    if (l === 'git diff --check') return { status: 0, out: '' };
    if (l === 'git diff') {
      if (a.includes('--name-only')) return { status: 0, out: f.files.join('\0') + '\0' };
      return { status: 0, out: a.includes('specs') ? f.publicDiff : f.srcDiff };
    }
    return { status: 0, out: '' };
  };
}
const go = (f: Fx, security = false): { res: Res; calls: string[] } => { const calls: string[] = []; return { res: pr.ready({ root: ROOT, run: runner(f, calls), security }), calls }; };
const SCRIPTS = ['spec-numbers', 'fragments --check', 'specs-index --check', 'spec-numbers --dups', 'rules-check', 'changelog check'];

// 1. all pass: ready: yes with the head; nothing conditional ran
{
  const { res } = go(fx());
  assert.ok(res.ok, 'PR-READY-yes: all guards pass -> ok');
  assert.strictEqual(res.lines[res.lines.length - 1].startsWith('ready: yes'), true, 'PR-READY-yes: last line is ready: yes');
  assert.ok(res.lines.includes(`head ${HEAD}`), 'PR-READY-yes: the head sha is printed');
  assert.ok(!res.lines.some((l) => /^FAIL|ready: no/.test(l)), 'PR-READY-yes: no failing line');
}
// 6. CRLF (rule 18): a diff with CRLF line ends is read like the LF one; \r?\n is not flagged, a bare \n is
{
  // git writes the header lines with \n and keeps the file's own CR at the end of each content line
  const mk = (line: string, eol: string): string => ['diff --git a/scripts/test-a.ts b/scripts/test-a.ts', '--- a/scripts/test-a.ts', '+++ b/scripts/test-a.ts', '@@ -0,0 +1,2 @@'].join('\n') + `\n+const s = fs.readFileSync(f, "utf8");${eol}+${line}${eol}`;
  const bare = 'const i = s.indexOf("x\\n");';
  const ok = 'const i = s.search(/x\\r?\\n/);';
  assert.deepStrictEqual(pr.crlfCuts(mk(bare, '\n')), ['scripts/test-a.ts'], 'PR-READY-crlf: a bare \\n cut is found');
  assert.deepStrictEqual(pr.crlfCuts(mk(bare, '\r\n')), ['scripts/test-a.ts'], 'PR-READY-crlf: the same diff with CRLF ends is found too');
  assert.deepStrictEqual(pr.crlfCuts(mk(ok, '\r\n')), [], 'PR-READY-crlf: \\r?\\n is accepted');
  assert.deepStrictEqual(pr.crlfCuts(mk('const t = s.split("\\n").length;', '\n')), [], 'PR-READY-crlf: no cut call, no warning');
  const w = go(fx({ files: ['scripts/test-a.ts'], srcDiff: mk(bare, '\r\n') }));
  assert.ok(w.res.ok && w.res.lines.some((l) => /NOTE crlf: scripts\/test-a.ts/.test(l) && /rule 18/.test(l)), 'PR-READY-crlf: a warning line, never a block');
  const w2 = go(fx({ files: ['docs/a.md'], srcDiff: mk(bare, '\n') }));
  assert.ok(w2.res.lines.some((l) => /^skip \(\d+\) crlf/.test(l)), 'PR-READY-crlf: skipped when nothing under scripts/ or src/ changed');
}
// 2. each guard fails alone: its own line, ready: no, and nothing after it runs
const table: { id: string; n: number; f: () => Fx; call: string }[] = [
  { id: 'numbers', n: 1, f: () => fx({ failAt: 'spec-numbers', out: 'specs:numbers: FR-999 clashes with #1' }), call: 'spec-numbers' },
  { id: 'numbers', n: 1, f: () => fx({ fetchFails: true }), call: 'git fetch' },
  { id: 'fragments', n: 2, f: () => fx({ failAt: 'fragments --check', out: 'package.json: "test:x" must sort before "test:a"' }), call: 'fragments --check' },
  { id: 'specs', n: 3, f: () => fx({ failAt: 'specs-index --check', out: 'index: FAIL stale' }), call: 'specs-index --check' },
  { id: 'specs', n: 3, f: () => fx({ failAt: 'spec-numbers --dups', out: 'FAIL FR-1 defined twice' }), call: 'spec-numbers --dups' },
  { id: 'rules', n: 4, f: () => fx({ failAt: 'rules-check', out: 'rules: AGENTS.md over budget' }), call: 'rules-check' },
  { id: 'changelog', n: 5, f: () => fx({ failAt: 'changelog check', out: 'changelog: fragment missing' }), call: 'changelog check' },
  { id: 'theme-tokens', n: 6, f: () => fx({ files: ['src/renderer/app.js'], failAt: 'test-theme-tokens', out: 'FAIL "#2056" in an app.js comment' }), call: 'test-theme-tokens' },
  { id: 'public-text', n: 7, f: () => fx({ publicDiff: 'diff --git a/docs/x.md b/docs/x.md\n--- a/docs/x.md\n+++ b/docs/x.md\n@@ -1 +1 @@\n+the Bearer header\n' }), call: 'git diff' },
  { id: 'drivers', n: 8, f: () => fx({ files: ['scripts/check-x.js'], failAt: 'test-ui-suite', out: 'FAIL raw ${} in page code' }), call: 'test-ui-suite' },
  { id: 'git', n: 10, f: () => fx({ dirty: ' M src/a.ts\n' }), call: 'git status' },
  { id: 'git', n: 10, f: () => fx({ failAt: 'git diff --check', out: 'a.md:3: trailing whitespace.' }), call: 'git diff --check' },
  { id: 'git', n: 10, f: () => fx({ sigs: [`${'d'.repeat(40)} N`] }), call: 'git log' },
  { id: 'git', n: 10, f: () => fx({ msgs: [`${'d'.repeat(40)}\nfix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n`] }), call: 'git log' },
  { id: 'git', n: 10, f: () => fx({ msgs: [`${'d'.repeat(40)}\nfix\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)\n`] }), call: 'git log' },
];
for (const t of table) {
  const { res, calls } = go(t.f(), t.id === 'public-text');
  const fails = res.lines.filter((l) => l.startsWith('FAIL'));
  assert.strictEqual(res.ok, false, `PR-READY-${t.id}: (${t.n}) fails alone -> not ready (${t.call})`);
  assert.strictEqual(fails.length, 1, `PR-READY-${t.id}: exactly one failing line (${t.call})`);
  assert.ok(fails[0].startsWith(`FAIL (${t.n}) `), `PR-READY-${t.id}: the line names guard ${t.n}: ${fails[0]}`);
  assert.strictEqual(res.lines[res.lines.length - 1], 'ready: no', `PR-READY-${t.id}: ends with ready: no`);
  assert.ok(!res.lines.some((l) => l.startsWith('head ') || l.startsWith('ready: yes')), `PR-READY-${t.id}: no head, no yes`);
  if (t.id === 'git' && t.n === 10 && t.call === 'git log') assert.ok(!/noreply|anthropic|claude\.com|Claude </i.test(res.lines.join("\n")), 'PR-READY-git: the trailer text is matched, never printed');
}
// 3. the order and the stop: a failure at guard 3 runs 1 and 2 only
{
  const { res, calls } = go(fx({ failAt: 'specs-index --check', out: 'FAIL x' }));
  assert.deepStrictEqual(calls.filter((c) => SCRIPTS.includes(c)), ['spec-numbers', 'fragments --check', 'specs-index --check'], 'PR-READY-stop: nothing runs after the first failure');
  assert.ok(res.lines.filter((l) => l.startsWith('ok')).length === 2, 'PR-READY-stop: two ok lines before it');
  const two = go(fx({ failAt: 'rules-check', out: 'FAIL a' }));
  const both = go(fx({ failAt: 'fragments --check', out: 'FAIL first' }));
  assert.ok(both.res.lines.some((l) => /FAIL \(2\)/.test(l)) && !both.calls.includes('rules-check'), 'PR-READY-order: the earlier guard speaks first');
  assert.ok(two.res.lines.some((l) => /FAIL \(4\)/.test(l)), 'PR-READY-order: guard 4 is rules');
}
// 4. the conditional guards run only when their files changed
{
  const a = go(fx({ files: ['src/renderer/screens.js'] }));
  assert.ok(a.calls.includes('test-theme-tokens') && a.calls.includes('tsc'), 'PR-READY-cond6: screens.js changed -> theme-tokens runs');
  const b = go(fx({ files: ['src/renderer/styles.css', 'docs/a.md'] }));
  assert.ok(!b.calls.includes('test-theme-tokens'), 'PR-READY-cond6: neither app.js nor screens.js changed -> it does not run');
  assert.ok(b.res.lines.some((l) => /^skip \(\d+\) theme-tokens/.test(l)), 'PR-READY-cond6: a skip line says so');
  const c = go(fx({ files: ['scripts/shots-017.js'] }));
  assert.ok(c.calls.includes('test-ui-suite'), 'PR-READY-cond8: a driver changed -> test:uisuite runs');
  const d = go(fx({ files: ['scripts/pr-ready.js', 'src/renderer/app.js'] }));
  assert.ok(!d.calls.includes('test-ui-suite'), 'PR-READY-cond8: a non-driver script does not start the driver lint');
}
// 4b. the order of the script guards when all pass
{
  const all = go(fx());
  assert.deepStrictEqual(all.calls.filter((c) => SCRIPTS.includes(c) || c === 'tsc'), SCRIPTS, 'PR-READY-order: the script guards run in the plan order and no conditional one ran');
}
// 5. the public-text guard: a NOTE without --security, a block with it; an edited line that already named the word is not new
{
  const diff = 'diff --git a/docs/x.md b/docs/x.md\n--- a/docs/x.md\n+++ b/docs/x.md\n@@ -1 +1 @@\n+a Bearer header\n';
  const n = go(fx({ publicDiff: diff }), false);
  assert.ok(n.res.ok && n.res.lines.some((l) => /NOTE public text/.test(l)), 'PR-READY-public-text: without --security a hit is a NOTE and does not block');
  const old = go(fx({ publicDiff: diff.replace('+a Bearer', '+the Bearer').replace('@@ -1 +1 @@\n', '@@ -1 +1 @@\n-a Bearer header\n') }), true);
  assert.ok(old.res.ok, 'PR-READY-public-text: a word already on the base is not new');
}
// 7. real git in a throwaway repository: an unsigned commit, a whitespace error and an uncommitted change each stop guard 10
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-ready-'));
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
    const G = (...a: string[]): string => { const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: tmp, env, encoding: 'utf8' }); assert.strictEqual(r.status, 0, `git ${a[0]}: ${r.stderr}`); return r.stdout; };
    G('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    G('add', '.'); G('commit', '-q', '-m', 'base');
    G('update-ref', 'refs/remotes/origin/main', 'HEAD');
    G('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\ntwo\n');
    G('commit', '-q', '-am', 'change');
    // only git is real; the script guards answer ok and the fetch has no remote to ask
    const run: Run = (cmd, args) => {
      if (cmd !== 'git') return { status: 0, out: '' };
      if (args[0] === 'fetch') return { status: 0, out: '' };
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      return { status: r.status === null ? -1 : r.status, out: `${r.stdout}${r.stderr}` };
    };
    let r = pr.ready({ root: tmp, run });
    assert.ok(!r.ok && r.lines.some((l) => /^FAIL \(10\) git: commit [0-9a-f]{9} is not SSH-signed/.test(l)), `PR-READY-git: a real unsigned commit stops guard 10: ${r.lines.join(' | ')}`);
    assert.strictEqual(r.head, G('rev-parse', 'HEAD').trim(), 'PR-READY-git: the head is the repository head');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\ntwo\nthree  \n');
    r = pr.ready({ root: tmp, run });
    assert.ok(r.lines.some((l) => /^FAIL \(10\) git: uncommitted changes/.test(l)), 'PR-READY-git: a real uncommitted change stops guard 10');
    G('commit', '-q', '-am', 'trailing space');
    r = pr.ready({ root: tmp, run });
    assert.ok(r.lines.some((l) => /^FAIL \(10\) git diff --check: /.test(l)), `PR-READY-git: a real trailing space is found by git diff --check: ${r.lines.join(' | ')}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// 8. no shell, no network: the module spawns with fixed argv and never calls anything but git, node and gh through them
{
  const src = fs.readFileSync(modPath, 'utf8');
  assert.ok(/shell: false/.test(src) && !/shell: true|execSync\(|\bexec\(|https?:\/\//.test(src), 'PR-READY-shell: spawn without a shell, no URL, no exec of a string');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
  const need: [string, string[]][] = [['specs:numbers', ['scripts/spec-numbers.js']], ['specs:check', ['scripts/specs-index.js --check', 'scripts/spec-numbers.js --dups']], ['rules:check', ['scripts/rules-check.js']], ['changelog:check', ['scripts/changelog.js check']], ['test:theme-tokens', ['test-theme-tokens.js']], ['test:uisuite', ['test-ui-suite.js']], ['pr:ready', ['scripts/pr-ready.js']]];
  for (const [name, parts] of need) for (const p of parts) assert.ok((pkg[name] || '').includes(p), `PR-READY-drift: package.json "${name}" still runs ${p}`);
  assert.ok((pkg['fragments:fix'] || '').includes('fragments.js'), 'PR-READY-drift: fragments.js is the one behind fragments:fix');
}

// 9. mutants: only when running the real module
if (!process.env.PR_READY_MODULE) {
  const real = fs.readFileSync(modPath, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-ready-mut-'));
  const abs = (t: string): string => t.split("require('./").join(`require('${path.join(ROOT, 'scripts').replace(/\\/g, '/')}/`);
  const dropLine = (id: string) => (t: string): string => t.split('\n').filter((l) => !l.startsWith(`  ['${id}',`)).join('\n');
  const mutants: { name: string; tag: string; mut: (t: string) => string }[] = [
    ...['numbers', 'fragments', 'specs', 'rules', 'changelog', 'theme-tokens', 'public-text', 'drivers', 'crlf', 'git'].map((id) => ({ name: `drop-${id}`, tag: `PR-READY-${id}`, mut: dropLine(id) })),
    { name: 'cond6-always', tag: 'PR-READY-cond6', mut: (t) => t.replace('ctx.files.some((f) => APP_FILES.includes(f))', 'true') },
    { name: 'cond8-always', tag: 'PR-READY-cond8', mut: (t) => t.replace('ctx.files.some((f) => DRIVER_RE.test(f))', 'true') },
    { name: 'no-stop', tag: 'PR-READY-stop', mut: (t) => t.replace('if (ctx.stopped) return;', '') },
    { name: 'signed-any', tag: 'PR-READY-git', mut: (t) => t.replace("if (sig !== 'G')", "if (false)") },
  ];
  const tag = (m: { mut: (t: string) => string }): string => m.mut(real);
  for (const m of mutants) {
    const mutated = tag(m);
    assert.notStrictEqual(mutated, real, `PR-READY-mutant: ${m.name} changed the module (the anchor exists)`);
    const f = path.join(tmp, `${m.name}.js`);
    fs.writeFileSync(f, abs(mutated));
    const r = spawnSync(process.execPath, [__filename, ], { env: { ...process.env, PR_READY_MODULE: f }, encoding: 'utf8' });
    const err = `${r.stderr}${r.stdout}`;
    console.log(`  mutant ${m.name}: ${(err.split('\n').find((l) => /^AssertionError/.test(l)) || '').replace(/^AssertionError \[ERR_ASSERTION\]: /, '').slice(0, 110)}`);
    assert.ok(r.status !== 0 && err.includes(m.tag), `PR-READY-mutant: ${m.name} must die at ${m.tag}, got status ${r.status}: ${err.split('\n').find((l) => /AssertionError|PR-READY/.test(l)) || err.slice(0, 200)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`test-pr-ready: ${mutants.length} mutants killed`);
}
console.log('test-pr-ready: OK');
