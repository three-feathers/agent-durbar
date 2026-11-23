/**
 * Unit test (spec 117 FR-386): the fast lane, scripts/fast-lane.js and .github/workflows/fast-lane.yml. The runner runs only names on
 * scripts/test-suites.txt, compiles only the picked test files, builds the app only for a suite that reads dist/; the workflow is
 * advisory and safe for fork PRs (pull_request only, no secrets, read-only token, no kept credential, PR-number concurrency group).
 * No git, no network, no Electron. Mutants of the workflow each die at their own assert.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fl = require(path.join(ROOT, 'scripts', 'fast-lane.js')) as {
  pickSuites: (names: string[], pkg: { scripts: Record<string, string> }, list?: string[]) => { name: string; steps: string[][] }[];
  tsSources: (suites: { name: string; steps: string[][] }[]) => string[];
  fastTsconfig: (sources: string[], root?: string) => { extends: string; files: string[]; exclude: string[] };
  needsBuild: (suites: { name: string; steps: string[][] }[], read?: (p: string) => string) => boolean;
};
type Plan = { run: string[]; tooSlow: string[]; overBudget: string[]; seconds: number };
type Lane = {
  planSuites: (names: string[], times?: Record<string, unknown>, o?: { heavy?: number; budget?: number }) => Plan;
  runLane: (o: { suites: unknown[]; jobs: number; deadlineMs?: number; run?: (o: { bail: boolean; ctl: { abort?: () => void } }) => Promise<{ failed: string[] }>; setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void }) => Promise<{ code: number; note: string }>;
  HEAVY_S: number; BUDGET_S: number; DEADLINE_MS: number;
};
const norm = (t: string) => t.replace(/\r\n?/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let laneDone: Promise<void> = Promise.resolve();
process.exitCode = 1; // set to 0 only when the async checks finish, so a check that never ends cannot pass silently

// the runner: only list names, in list order, as run-tests.js loads them
const fake = { scripts: { 'test:a': 'tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-a.js', 'test:b': 'node scripts/test-b.js && node scripts/b.js' } };
const got = fl.pickSuites(['test:b', 'test:a', 'test:b'], fake, ['test:a', 'test:b']);
assert.deepStrictEqual(got.map((s) => s.name), ['test:b', 'test:a'], "suites run in the decider's order (its direct picks first), each once");
assert.deepStrictEqual(got[0].steps, [['scripts/test-b.js'], ['scripts/b.js']], 'each suite keeps its own steps in order');
assert.throws(() => fl.pickSuites(['test:a', 'test:nope'], fake, ['test:a', 'test:b']), /not a suite of scripts\/test-suites\.txt: test:nope/, 'a name not on the list fails the run, never skipped');
assert.throws(() => fl.pickSuites(['test:a\n::error::x'], fake, ['test:a']), (e: Error) => !/\n/.test(e.message) && !/::error/.test(e.message), 'a hostile name is printed escaped');
assert.ok(fl.pickSuites(['test:cichanges'], pkg).length === 1, 'a real suite of the live list loads');
// compile only the picked test files
assert.deepStrictEqual(fl.tsSources(got), ['scripts/test-a.ts'], 'only compiled steps need tsc: dist-scripts/X.js is X.ts');
const cfg = fl.fastTsconfig(['scripts/test-a.ts'], '/r');
assert.ok(cfg.extends.endsWith('/r/tsconfig.scripts.json') && cfg.files.length === 1 && cfg.files[0].endsWith('/r/scripts/test-a.ts'), 'the config extends the scripts project and lists the picked file');
assert.ok(cfg.exclude.some((e) => e.endsWith('/r/scripts/test-*.ts')) && cfg.exclude.some((e) => e.endsWith('/r/scripts/prereview/**')), 'every other test file and the prereview package are left out');
assert.ok([cfg.extends, ...cfg.files, ...cfg.exclude].every((p) => !p.includes('\\')), 'paths use / on every OS (tsconfig reads them as globs)');
// build only when a step file reads the app build
const reads = (text: string) => fl.needsBuild([{ name: 'x', steps: [['dist-scripts/scripts/test-x.js']] }], (p) => (p === 'scripts/test-x.ts' ? text : ''));
assert.strictEqual(reads("path.join(ROOT, 'dist', 'main.js')"), true, "path.join(..., 'dist') is the app build");
assert.strictEqual(reads("require('../dist/src/main/x')"), true, 'a dist/ path is the app build');
assert.strictEqual(reads("require('../dist-scripts/x')"), false, 'dist-scripts is not');
assert.strictEqual(reads("const distance = 1;"), false, 'a word starting with dist is not');

// ---- spec 117 FR-390: the lane stays fast (time plan, deadline, process trees stopped). Each rule is checked on the real file and on
// mutants of its source (LF-normalised first, and on a CRLF copy too: the Windows checkout), each dying at its own assert.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module') as { new (id: string, parent: unknown): { filename: string; paths: string[]; exports: unknown; _compile(src: string, file: string): void }; _nodeModulePaths(dir: string): string[] };
  const file = path.join(ROOT, 'scripts', 'fast-lane.js');
  const raw = fs.readFileSync(file, 'utf8');
  const load = (text: string): Lane => { const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(text, file); return m.exports as Lane; };
  const times = { 'test:a': 10, 'test:b': 200, 'test:c': 300, 'test:d': 150, 'test:e': 50 };
  /** What is wrong with a fast-lane.js's plan and deadline rules (empty = fine). */
  async function laneProblems(l: Lane): Promise<string[]> {
    const bad: string[] = [];
    if (!(l.HEAVY_S <= 120 && l.BUDGET_S <= 480 && l.DEADLINE_MS <= 300000)) bad.push('limits above the spec (120 s heavy, 480 s budget, 300 s deadline)');
    const p = l.planSuites(['test:a', 'test:c', 'test:b', 'test:d', 'test:e', 'test:zz'], times, { heavy: 250, budget: 300 });
    if (!p.tooSlow.includes('test:c')) bad.push('a suite recorded over the heavy limit still runs');
    if (p.run.join(' ') !== 'test:a test:b test:e') bad.push(`the plan does not keep the given order within the budget (got ${p.run.join(' ')})`);
    if (!p.overBudget.includes('test:d')) bad.push('a suite over the budget still runs');
    if (p.seconds !== 10 + 200 + 50) bad.push(`the plan's recorded total is wrong (got ${p.seconds} s)`);
    const m = l.planSuites(['test:zz'], times, { heavy: 1000, budget: 1000 }).seconds; // median of 10, 50, 150, 200, 300
    if (m !== 150) bad.push(`a suite with no recorded time does not count as the median (got ${m} s)`);
    const live = l.planSuites(['test:runtime-redact', 'test:redact-monotone', 'test:cichanges']);
    if (live.run.join(' ') !== 'test:cichanges' || live.tooSlow.length !== 2) bad.push('with the live timings the heavy redact suites still run');
    // the deadline: a fake run that only ends when stopped; the stop must come from ctl.abort, children must be detached (bail)
    let detached = false, stopped = false;
    let finish: (v: { failed: string[] }) => void = () => {};
    const hang = (o: { bail: boolean; ctl: { abort?: () => void } }) => new Promise<{ failed: string[] }>((resolve) => { finish = resolve; detached = o.bail; o.ctl.abort = () => { stopped = true; resolve({ failed: [] }); }; });
    const timers: (() => void)[] = [];
    const pending = l.runLane({ suites: [], jobs: 1, run: hang, setTimer: (f) => { timers.push(f); return 1; }, clearTimer: () => {} });
    for (const f of timers) f();
    finish({ failed: [] }); // a lane that did not stop its suites would wait here for ever: end the fake run so the check can report it
    const late = await pending;
    if (!stopped) bad.push('the deadline does not stop the running suites');
    if (!detached) bad.push('suites are not spawned detached, so a stop would leave their child processes');
    if (late.code !== 0 || !/deadline/.test(late.note)) bad.push(`the deadline does not end the lane green with a note (got ${late.code} ${late.note})`);
    const fail = await l.runLane({ suites: [], jobs: 1, run: async () => ({ failed: ['test:x'] }), setTimer: () => 1, clearTimer: () => {} });
    if (fail.code !== 1) bad.push('a failing suite does not fail the lane');
    const ok = await l.runLane({ suites: [], jobs: 1, run: async () => ({ failed: [] }), setTimer: () => 1, clearTimer: () => {} });
    if (ok.code !== 0 || ok.note !== 'all passed') bad.push('a clean run is not green');
    return bad;
  }
  const toLf = (t: string) => t.replace(/\r\n?/g, '\n');
  const crlf = (t: string) => toLf(t).replace(/\n/g, '\r\n');
  const run = async () => {
    for (const [copy, text] of [['checkout', toLf(raw)], ['CRLF copy', toLf(crlf(raw))]] as [string, string][]) {
      assert.deepStrictEqual(await laneProblems(load(text)), [], `FR-390 rules hold (${copy})`);
      const swap = (from: string, to: string) => { assert.ok(text.includes(from), `mutant anchor found (${copy}): ${from}`); return load(text.replace(from, () => to)); };
      const mutants: [string, Lane, RegExp][] = [
        ['no heavy rule', swap('if (t(n) > heavy) tooSlow.push(n);', 'if (false) tooSlow.push(n);'), /over the heavy limit still runs/],
        ['no budget rule', swap('else if (seconds + t(n) > budget) overBudget.push(n);', 'else if (false) overBudget.push(n);'), /over the budget still runs/],
        ['a missing time counts as zero', swap('(Number.isFinite(times[n]) ? times[n] : median)', '(Number.isFinite(times[n]) ? times[n] : 0)'), /median/],
        ['the plan stops at the first suite that does not fit', swap('else if (seconds + t(n) > budget) overBudget.push(n);', 'else if (seconds + t(n) > budget || overBudget.length) overBudget.push(n);'), /given order within the budget/],
        ['a heavy limit of 600 s', swap('const HEAVY_S = 120;', 'const HEAVY_S = 600;'), /limits above the spec/],
        ['no stop at the deadline', swap('late = true; if (ctl.abort) ctl.abort();', 'late = true;'), /does not stop the running suites/],
        ['children not detached', swap('const r = await run({ suites, jobs, bail: true, ctl });', 'const r = await run({ suites, jobs, bail: false, ctl });'), /not spawned detached/],
        ['the deadline is red', swap("if (late) return { code: 0, note:", "if (late) return { code: 1, note:"), /does not end the lane green/],
        ['a failure is green', swap("if (failed.length) return { code: 1,", "if (failed.length) return { code: 0,"), /failing suite does not fail/],
      ];
      for (const [name, l, expect] of mutants) { const bad = await laneProblems(l); assert.ok(bad.some((b) => expect.test(b)), `mutant "${name}" (${copy}) dies at its own assert (got: ${bad.join('; ') || 'nothing'})`); }
    }
  };
  laneDone = run();
}

// the workflow
const wfRaw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'fast-lane.yml'), 'utf8');
const wf = norm(wfRaw);
/** Every shell line of a workflow: each `run:` value and each line of a `run: |` block. No `${{ }}` may appear in one. */
function runLines(text: string): string[] {
  const out: string[] = [];
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(ls[i]);
    if (!m) continue;
    if (/^[|>]/.test(m[2])) { const ind = m[1].length; while (i + 1 < ls.length && (ls[i + 1].trim() === '' || ls[i + 1].search(/\S/) > ind)) out.push(ls[++i]); } else out.push(m[2]);
  }
  return out;
}
/** What is wrong with the lane's workflow (empty = fine). */
function problems(text: string): string[] {
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const bad: string[] = [];
  if (/pull_request_target/.test(code)) bad.push('pull_request_target');
  if (!/^on:\n {2}pull_request:\n/m.test(code) || /^ {2}(push|merge_group|schedule|workflow_dispatch|workflow_run):/m.test(code)) bad.push('trigger is not pull_request only');
  if (/secrets\./.test(code)) bad.push('uses a secret');
  if (!/^permissions:\n {2}contents: read\n(?! )/m.test(code) || /write/.test(code)) bad.push('token is not read-only');
  if (!/persist-credentials: false/.test(code)) bad.push('checkout keeps its credential');
  if (!/group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/.test(code) || !/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/.test(code)) bad.push('no PR-number concurrency group that cancels');
  if (!/os: \[ubuntu-latest, windows-latest, macos-latest\]/.test(code)) bad.push('not on the three OSes');
  if (!/run: bash \.github\/scripts\/ci-changes\.sh --suites\n/.test(code)) bad.push('the base copy of the one decision does not pick');
  if (runLines(code).some((l) => l.includes('${{'))) bad.push('a value from the PR in a shell string');
  if (!/FAST_SUITES: \$\{\{ steps\.pick\.outputs\.suites \}\}\n\s+run: node scripts\/fast-lane\.js\n/.test(code)) bad.push('the suites do not reach the runner through env');
  if (/continue-on-error/.test(code)) bad.push('continue-on-error hides a red lane');
  const m = /timeout-minutes: (\d+)/.exec(code);
  if (!m || Number(m[1]) > 10) bad.push('no timeout of at most 10 minutes');
  return bad;
}
assert.deepStrictEqual(problems(wf), [], 'fast-lane.yml: advisory, three OSes, safe for fork PRs');
// Windows checks files out with CRLF (review of #2032): the same check on a CRLF copy, normalised first, passes; without the
// normalisation it does not, so the normalisation is what makes it pass there
const crlf = (t: string) => norm(t).replace(/\n/g, '\r\n');
assert.deepStrictEqual(problems(norm(crlf(wfRaw))), [], 'fast-lane.yml checks pass on a CRLF copy (normalised first)');
assert.ok(problems(crlf(wfRaw)).length > 0, 'mutant "normalisation stripped": a raw CRLF copy fails the checks');
const swap = (from: string | RegExp, to: string) => { const t = wf.replace(from, to); assert.notStrictEqual(t, wf, `mutant anchor found: ${String(from)}`); return t; };
const mutants: [string, string, string][] = [
  ['pull_request_target', swap('on:\n  pull_request:\n', 'on:\n  pull_request_target:\n'), 'pull_request_target'],
  ['a push trigger', swap('on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n', 'on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n  push:\n'), 'trigger is not pull_request only'],
  ['a secret', swap('          FAST_SUITES:', '          T: ${{ secrets.X }}\n          FAST_SUITES:'), 'uses a secret'],
  ['write permission', swap('permissions:\n  contents: read\n', 'permissions:\n  contents: write\n'), 'token is not read-only'],
  ['credential kept', swap('          persist-credentials: false\n', ''), 'checkout keeps its credential'],
  ['no cancel', swap("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: false'), 'no PR-number concurrency group that cancels'],
  ['Windows dropped', swap('os: [ubuntu-latest, windows-latest, macos-latest]', 'os: [ubuntu-latest, macos-latest]'), 'not on the three OSes'],
  ["the PR's copy decides", swap('run: bash .github/scripts/ci-changes.sh --suites\n', 'run: node .github/scripts/ci-changes.js --suites\n'), 'the base copy of the one decision does not pick'],
  ['suites in the shell string', swap('run: node scripts/fast-lane.js\n', 'run: node scripts/fast-lane.js ${{ steps.pick.outputs.suites }}\n'), 'a value from the PR in a shell string'],
  ['continue-on-error', swap('        run: node scripts/fast-lane.js\n', '        continue-on-error: true\n        run: node scripts/fast-lane.js\n'), 'continue-on-error hides a red lane'],
  ['a long timeout', swap(/timeout-minutes: \d+/, 'timeout-minutes: 25'), 'no timeout of at most 10 minutes'],
];
for (const [name, text, expect] of mutants) assert.ok(problems(text).includes(expect), `mutant "${name}" dies at its own assert (got: ${problems(text).join('; ') || 'nothing'})`);
// advisory: the lane's check names are not in the required list the spec records (spec 117 O1 table)
const spec = norm(fs.readFileSync(path.join(ROOT, 'specs', '117-delivery-speed-2', 'spec.md'), 'utf8'));
const required = spec.split('\n').filter((l) => /^\| [^|]+ \| yes\b/.test(l)).map((l) => l.split('|')[1].trim());
assert.ok(required.includes('Build and test (windows-latest)') && !required.some((n) => /fast lane/i.test(n)), 'no Fast lane check is required (the lane is advisory)');
laneDone.then(() => { process.exitCode = 0; console.log(`fast-lane: ok (${mutants.length} workflow mutants, 9 FR-390 mutants on two copies caught)`); }, (e) => { console.error(e); process.exitCode = 1; });
