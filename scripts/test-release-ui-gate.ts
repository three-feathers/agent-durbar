/**
 * Spec 117 FR-014 / T045 (`npm run test:releaseuigate`, in `npm test`): release.yml refuses a tag unless the "UI on three OSes" run
 * for exactly the tagged commit finished green. Tests scripts/release-ui-gate.js (the decision, each deciding policy, API error
 * kinds, the poll loop and the CLI exit codes) on fixtures, then guards release.yml's wiring by lines. No network, no gh, no git, no
 * Electron (the CLI cases spawn node on a temporary copy of the gate). Every rule has a mutant that must die at its own assert.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..', '..');
const GATE = path.join(ROOT, 'scripts', 'release-ui-gate.js');
/** Text as LF: a Windows checkout (core.autocrlf) has CRLF, and `.` in a regex stops at `\r` (the shebang strip failed there). */
const lf = (t: string): string => t.replace(/\r\n?/g, '\n');
const same = (t: string): string => t;
const RAW = fs.readFileSync(GATE, 'utf8');
const REAL = lf(RAW);

type Run = Record<string, any>;
type Verdict = { verdict: 'pass' | 'wait' | 'fail'; reason: string; run?: Run; message: string };
type Gate = {
  decide: (runs: Run[], o: Record<string, unknown>) => Verdict;
  eligible: (r: Run, sha: string, repo: string) => boolean;
  checkInputs: (o: Record<string, unknown>) => string[];
  errorKind: (m: string) => string;
  ghApi: (p: string, exec: (...a: unknown[]) => string) => any;
  fetchRuns: (gh: (p: string) => any, o: Record<string, unknown>) => Run[];
  poll: (o: Record<string, unknown>) => Promise<Verdict>;
  runsPath: (repo: string, sha: string) => string;
  POLICY: string;
  POLICIES: Record<string, unknown>;
};

/** Load the gate from source text (the real file or a mutant) as a CommonJS module; `norm` is the line-end normalisation. */
function load(src: string, norm: (t: string) => string = lf): Gate {
  const mod = { exports: {} as any };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__filename', '__dirname', norm(src).replace(/^#!.*\n/, ''))(mod, mod.exports, require, GATE, path.dirname(GATE));
  return mod.exports as Gate;
}

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'three-feathers/agent-durbar';
const MIN = 60 * 1000;
const opts = (elapsedMin: number, policy?: string): Record<string, unknown> => ({ sha: SHA, repo: REPO, tag: 'v0.1.15', elapsedMs: elapsedMin * MIN, notFoundMs: 15 * MIN, maxMs: 150 * MIN, ...(policy ? { policy } : {}) });
let nextId = 100;
function run(o: Partial<Run>): Run {
  const started = o.run_started_at || '2026-11-22T10:00:00Z';
  return {
    id: nextId++, head_sha: SHA, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success',
    run_started_at: started, created_at: started, path: '.github/workflows/ui-platforms.yml',
    head_repository: { full_name: REPO }, html_url: 'https://github.com/x/y/actions/runs/1', ...o,
  };
}
const job = (name: string, conclusion: string | null = 'success', status = 'completed'): Run => ({ name, status, conclusion });
/** The jobs of a full three-OS run; `over` replaces the conclusion (or 'running') of named jobs. */
function jobs3(over: Record<string, string> = {}, oses = ['ubuntu', 'windows', 'macos']): Run[] {
  const out: Run[] = [job('What the UI suite needs')];
  for (const o of oses) for (let i = 1; i <= (o === 'macos' ? 3 : 4); i++) out.push(job(`UI shard (${o}-latest ${i}/${o === 'macos' ? 3 : 4})`));
  out.push(job('UI suite complete'));
  for (const j of out) if (over[j.name]) { if (over[j.name] === 'running') { j.status = 'in_progress'; j.conclusion = null; } else j.conclusion = over[j.name]; }
  return out;
}
const RERUN_UI = /gh run rerun \d/;

/** Run the CLI on a temporary copy of `src`; returns the exit status. */
function cli(dir: string, src: string, runs: Run[], extra: string[] = []): number | null {
  const file = path.join(dir, 'gate.js');
  fs.writeFileSync(file, src);
  const data = path.join(dir, 'runs.json');
  fs.writeFileSync(data, JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
  const r = spawnSync(process.execPath, [file, '--sha', SHA, '--repo', REPO, '--tag', 'v0.1.15', '--runs-file', data, ...extra], { encoding: 'utf8', timeout: 30000 });
  return r.status;
}

/** Every rule as fixture cases with labelled asserts; a mutant must make exactly its own label throw first. */
async function suite(src: string, dir: string): Promise<void> {
  const g = load(src);
  const is = (runs: Run[], min: number, verdict: string, reason: string, label: string, policy = 'latest-run'): Verdict => {
    const v = g.decide(runs, opts(min, policy));
    assert.strictEqual(`${v.verdict}/${v.reason}`, `${verdict}/${reason}`, label);
    return v;
  };

  // R0 the policy in force: owner pick (a), Vikram 2026-11-23 (#2038 item 1, recorded on #1995). R2-R6 test the machinery every
  // policy shares on run-level fixtures (policy latest-run); R8 tests each policy's own verdicts, (a) in full.
  assert.strictEqual(g.POLICY, 'linux-windows-jobs', 'R0 the policy in force is linux-windows-jobs (owner pick 2026-11-23)');

  // R1 inputs: a 40-hex sha, an owner/name repo, a v* tag, limits that make sense, a known policy
  assert.deepStrictEqual(g.checkInputs(opts(0)), [], 'R1 good inputs pass');
  assert.ok(g.checkInputs({ ...opts(0), sha: SHA.slice(1) }).length > 0, 'R1 a 39-hex sha is refused');
  assert.ok(g.checkInputs({ ...opts(0), sha: 'A'.repeat(40) }).length === 0, 'R1 upper-case hex is a sha');
  assert.ok(g.checkInputs({ ...opts(0), sha: 'g'.repeat(40) }).length > 0, 'R1 a non-hex sha is refused');
  assert.ok(g.checkInputs({ ...opts(0), sha: `${SHA}\n` }).length > 0, 'R1 a sha with a newline is refused');
  assert.ok(g.checkInputs({ ...opts(0), repo: 'x/y;rm' }).length > 0, 'R1 a repo with shell characters is refused');
  assert.ok(g.checkInputs({ ...opts(0), repo: 'x' }).length > 0, 'R1 a repo without owner is refused');
  assert.ok(g.checkInputs({ ...opts(0), tag: 'v1.2.3$(x)' }).length > 0, 'R1 a tag with shell characters is refused');
  assert.ok(g.checkInputs({ ...opts(0), notFoundMs: 200 * MIN }).length > 0, 'R1 not-found wait longer than the whole wait is refused');
  assert.ok(g.checkInputs({ ...opts(0), policy: 'anything' }).length > 0, 'R1 an unknown policy is refused');
  assert.throws(() => g.decide([], { ...opts(0), sha: 'nope' }), /sha/, 'R1 decide refuses a bad sha');
  assert.ok(g.runsPath(REPO, SHA).startsWith(`repos/${REPO}/actions/workflows/ui-platforms.yml/runs?`) && g.runsPath(REPO, SHA).includes(`head_sha=${SHA}`), 'R1 the API path names the workflow file and the sha');

  // R2 which runs can count: this sha, this repo, push on main, workflow_dispatch or schedule; never pull_request (a merge ref)
  const el = (r: Run): boolean => g.eligible(r, SHA, REPO);
  assert.ok(el(run({})), 'R2 a main push run counts');
  assert.ok(el(run({ event: 'workflow_dispatch', head_branch: 'v0.1.15' })), 'R2 a dispatch run on the sha counts');
  assert.ok(el(run({ event: 'schedule' })), 'R2 a nightly run on the sha counts');
  assert.ok(el(run({ path: '.github/workflows/ui-platforms.yml@refs/heads/main' })), 'R2 a path with an @ref counts');
  assert.ok(!el(run({ head_sha: OTHER })), "R2 another commit's green run does not count");
  assert.ok(!el(run({ event: 'pull_request', head_branch: '117-x' })), 'R2 a pull_request run does not count');
  assert.ok(!el(run({ event: 'workflow_run' })), 'R2 another event does not count');
  assert.ok(!el(run({ head_branch: 'feature' })), 'R2 a push run off main does not count');
  assert.ok(!el(run({ head_repository: { full_name: 'someone/fork' } })), 'R2 a run from another repository does not count');
  assert.ok(!el(run({ path: '.github/workflows/ci.yml' })), 'R2 a run of another workflow does not count');
  is([run({ event: 'schedule' })], 0, 'pass', 'success', 'R2 a green nightly run on the sha passes');

  // R3 no run yet: wait up to notFound, then fail with the dispatch command
  is([], 5, 'wait', 'none-yet', 'R3 no run after 5 min: wait');
  const none = is([], 15, 'fail', 'none', 'R3 no run after the not-found limit: fail');
  is([run({ head_sha: OTHER }), run({ event: 'pull_request' })], 20, 'fail', 'none', 'R3 only runs that do not count: no run');
  assert.ok(none.message.includes('gh workflow run ui-platforms.yml') && none.message.includes('--ref v0.1.15'), 'R3 the no-run message names the dispatch command on the tag');

  // R4 the latest counting run (by run_started_at, then id) is the verdict; it must be completed
  is([run({ status: 'in_progress', conclusion: null })], 30, 'wait', 'running', 'R4 a running run: wait');
  is([run({ status: 'queued', conclusion: null })], 30, 'wait', 'running', 'R4 a queued run: wait');
  is([run({ run_started_at: '2026-11-22T09:00:00Z', conclusion: 'failure' }), run({ run_started_at: '2026-11-22T11:00:00Z', event: 'workflow_dispatch' })], 0, 'pass', 'success', 'R4 red then a green re-run (latest green): pass');
  is([run({ run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure' }), run({ run_started_at: '2026-11-22T09:00:00Z' })], 0, 'fail', 'failed', 'R4 green then red (latest red): fail');
  is([run({ run_started_at: '2026-11-22T09:00:00Z' }), run({ run_started_at: '2026-11-22T11:00:00Z', status: 'in_progress', conclusion: null })], 30, 'wait', 'running', 'R4 an older green run while a newer one runs: wait');
  // a re-run attempt keeps created_at but moves run_started_at: it is the newer verdict
  is([run({ created_at: '2026-11-22T08:00:00Z', run_started_at: '2026-11-22T12:00:00Z' }), run({ created_at: '2026-11-22T09:00:00Z', run_started_at: '2026-11-22T09:00:00Z', conclusion: 'cancelled' })], 0, 'pass', 'success', 'R4 a re-run attempt (later run_started_at) is the latest');
  is([run({ id: 1, conclusion: 'failure' }), run({ id: 2 })], 0, 'pass', 'success', 'R4 same start time: the higher id is the latest');
  is([run({ status: 'in_progress', conclusion: null })], 150, 'fail', 'timeout', 'R4 still running at the wait limit: fail');

  // R5 only success passes; no message suggests re-running a UI run (a push re-run would cancel main's newest UI run under O3)
  const c = is([run({ conclusion: 'cancelled' })], 0, 'fail', 'cancelled', 'R5 a cancelled run: fail');
  assert.ok(c.message.includes('gh workflow run ui-platforms.yml --repo three-feathers/agent-durbar --ref v0.1.15') && /tag a newer main commit/.test(c.message) && c.message.includes('--failed'), 'R5 the cancelled message names the dispatch on the tag, a newer green tag and the release re-run');
  assert.ok(!/O3: a newer merge/.test(c.message) && /concurrency group, a job time limit or a person/.test(c.message), 'R5 the cancelled message does not guess the cause');
  for (const k of ['failure', 'timed_out', 'skipped', 'neutral', 'action_required', 'startup_failure', 'stale']) is([run({ conclusion: k })], 0, 'fail', 'failed', `R5 conclusion ${k}: fail`);
  is([run({ conclusion: null })], 0, 'fail', 'failed', 'R5 completed without a conclusion: fail');
  const f = is([run({ conclusion: 'failure' })], 0, 'fail', 'failed', 'R5 a failed run: fail');
  for (const m of [c.message, f.message, none.message, is([run({ status: 'in_progress', conclusion: null })], 150, 'fail', 'timeout', 'R5 timeout').message]) {
    assert.ok(!RERUN_UI.test(m), 'R5 no message suggests re-running a UI run');
  }

  // R6 the poll loop: waits with the clock, stops at pass or fail, counts transient API errors as a wait, never runs past maxMs
  let t = 0;
  const seq: Array<Run[] | Error> = [[], new Error('gh: Server Error (HTTP 502)'), [run({ status: 'in_progress', conclusion: null })], [run({})]];
  const logs: string[] = [];
  const v = await g.poll({ ...opts(0, 'latest-run'), fetchRuns: () => { const s = seq.shift(); if (s instanceof Error) throw s; return s; }, sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: (s: string) => logs.push(s) });
  assert.strictEqual(`${v.verdict}/${v.reason}`, 'pass/success', 'R6 the loop waits through no-run, an API error and a running run, then passes');
  assert.strictEqual(t, 3 * MIN, 'R6 the loop slept once per wait');
  assert.ok(logs.some((l) => l.includes('API error')), 'R6 the API error is logged');
  t = 0;
  const v2 = await g.poll({ ...opts(0, 'latest-run'), fetchRuns: () => [run({ status: 'in_progress', conclusion: null })], sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: () => undefined });
  assert.strictEqual(`${v2.verdict}/${v2.reason}`, 'fail/timeout', 'R6 a run that never ends fails at the limit');
  assert.ok(t >= 150 * MIN && t <= 151 * MIN, 'R6 the loop stops at maxMs');
  t = 0;
  const v3 = await g.poll({ ...opts(0, 'latest-run'), fetchRuns: () => { throw new Error('gh: Server Error (HTTP 500)'); }, sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: () => undefined });
  assert.strictEqual(`${v3.verdict}/${v3.reason}`, 'fail/api', 'R6 an API that always fails ends in a failure, never a pass');

  // R7 API error kinds: 401, 403, 404 and other 4xx fail at once; 429, 5xx and network errors wait
  assert.strictEqual(g.errorKind('gh: Not Found (HTTP 404)'), 'fatal', 'R7 404 fails at once');
  assert.strictEqual(g.errorKind('gh: Bad credentials (HTTP 401)'), 'fatal', 'R7 401 fails at once');
  assert.strictEqual(g.errorKind('gh: Resource not accessible by integration (HTTP 403)'), 'fatal', 'R7 403 fails at once');
  assert.strictEqual(g.errorKind('gh: Validation Failed (HTTP 422)'), 'fatal', 'R7 422 fails at once');
  assert.strictEqual(g.errorKind('gh: API rate limit exceeded (HTTP 429)'), 'wait', 'R7 429 waits');
  assert.strictEqual(g.errorKind('gh: Bad Gateway (HTTP 502)'), 'wait', 'R7 502 waits');
  assert.strictEqual(g.errorKind('dial tcp: connection reset by peer'), 'wait', 'R7 a network error waits');
  t = 0;
  const v4 = await g.poll({ ...opts(0), fetchRuns: () => { throw new Error('gh: Not Found (HTTP 404)'); }, sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: () => undefined });
  assert.ok(v4.verdict === 'fail' && v4.reason === 'api-fatal' && t === 0, 'R7 the loop stops at once on a 404');
  const failing = (): string => { const e: any = new Error('Command failed: gh api repos/x/y'); e.stderr = 'gh: Not Found (HTTP 404)\n'; throw e; };
  let ghMsg = '';
  try { g.ghApi('repos/x/y', failing); } catch (e) { ghMsg = (e as Error).message; }
  assert.ok(ghMsg.includes('HTTP 404'), 'R7 a gh failure carries the HTTP status from stderr');

  // R8 the deciding policy: one named constant; each owner option has its own fixtures (#2038 item 1)
  assert.deepStrictEqual(Object.keys(g.POLICIES).sort(), ['latest-run', 'linux-windows-jobs', 'push-or-dispatch-without-macos'], 'R8 the three policies');
  const greenPush = (): Run => run({ run_started_at: '2026-11-22T09:00:00Z', jobs: jobs3({}, ['ubuntu', 'windows']) });
  const macRedNightly = (): Run => run({ event: 'schedule', run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure', jobs: jobs3({ 'UI shard (macos-latest 2/3)': 'failure', 'UI suite complete': 'failure' }) });
  is([greenPush(), macRedNightly()], 0, 'fail', 'failed', 'R8 latest-run: a newer nightly red only on macOS fails the gate', 'latest-run');
  // (a) linux-windows-jobs
  const A = 'linux-windows-jobs';
  is([greenPush(), macRedNightly()], 0, 'pass', 'success', 'R8a a red macOS shard does not veto', A);
  is([run({ event: 'schedule', conclusion: 'failure', jobs: jobs3({ 'UI shard (ubuntu-latest 3/4)': 'failure' }) })], 0, 'fail', 'failed', 'R8a a red Linux shard fails', A);
  is([run({ event: 'schedule', conclusion: 'cancelled', jobs: jobs3({ 'UI shard (windows-latest 1/4)': 'cancelled' }) })], 0, 'fail', 'cancelled', 'R8a a cancelled Windows shard fails as cancelled', A);
  is([run({ event: 'schedule', status: 'in_progress', conclusion: null, jobs: jobs3({ 'UI shard (windows-latest 4/4)': 'running' }) })], 30, 'wait', 'running', 'R8a a running Windows shard: wait', A);
  is([run({ event: 'schedule', status: 'in_progress', conclusion: null, jobs: jobs3({ 'UI shard (macos-latest 1/3)': 'running' }) })], 30, 'pass', 'success', 'R8a Linux and Windows done and green while macOS runs: pass', A);
  is([run({ jobs: jobs3({}, ['ubuntu']) })], 0, 'fail', 'failed', 'R8a no Windows shard fails', A);
  is([run({ jobs: jobs3({}, ['ubuntu', 'windows']).filter((j) => j.name !== 'What the UI suite needs') })], 0, 'fail', 'failed', 'R8a a missing decision job fails', A);
  is([run({ jobs: jobs3({ 'What the UI suite needs': 'failure' }, ['ubuntu', 'windows']) })], 0, 'fail', 'failed', 'R8a a red decision job fails', A);
  is([run({})], 0, 'fail', 'failed', 'R8a jobs not read fails', A);
  is([run({ status: 'in_progress', conclusion: null, jobs: [job('What the UI suite needs')] })], 30, 'wait', 'running', 'R8a shards not listed yet: wait', A);
  is([run({ status: 'in_progress', conclusion: null, jobs: jobs3({ 'UI shard (ubuntu-latest 1/4)': 'running' }) })], 150, 'fail', 'timeout', 'R8a still running at the wait limit: fail', A);
  is([run({ run_started_at: '2026-11-22T09:00:00Z', jobs: jobs3() }), run({ event: 'schedule', run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure', jobs: jobs3({ 'UI shard (windows-latest 2/4)': 'failure' }) })], 0, 'fail', 'failed', 'R8a a newer run red on Windows outvotes an older green one', A);
  const aNone = is([], 20, 'fail', 'none', 'R8a no run: fail', A);
  const aCan = is([run({ jobs: jobs3({ 'UI shard (ubuntu-latest 2/4)': 'cancelled' }) })], 0, 'fail', 'cancelled', 'R8a cancelled', A);
  for (const m of [aNone.message, aCan.message]) assert.ok(m.includes('Start a by-hand UI run on the tag (gh workflow run ui-platforms.yml --repo three-feathers/agent-durbar --ref v0.1.15') && !RERUN_UI.test(m), 'R8a the remedy is a by-hand UI run on the tag, never a UI re-run');
  // decide with no policy named uses the one in force
  const dflt = g.decide([greenPush(), macRedNightly()], opts(0));
  assert.strictEqual(`${dflt.verdict}/${dflt.reason}`, 'pass/success', 'R8 decide with no policy named uses the policy in force (a red macOS nightly does not veto)');
  // (b) push-or-dispatch-without-macos
  const B = 'push-or-dispatch-without-macos';
  is([greenPush(), macRedNightly()], 0, 'pass', 'success', 'R8b a newer red nightly does not count', B);
  is([greenPush(), run({ event: 'workflow_dispatch', run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure', jobs: jobs3({ 'UI shard (macos-latest 1/3)': 'failure' }) })], 0, 'pass', 'success', 'R8b a by-hand run with macOS jobs does not count', B);
  is([greenPush(), run({ event: 'workflow_dispatch', run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure', jobs: jobs3({ 'UI shard (ubuntu-latest 1/4)': 'failure' }, ['ubuntu', 'windows']) })], 0, 'fail', 'failed', 'R8b a newer red by-hand run without macOS counts', B);
  is([run({ event: 'workflow_dispatch' })], 20, 'fail', 'none', 'R8b a by-hand run whose jobs were not read does not count', B);
  const bNone = is([], 20, 'fail', 'none', 'R8b no push run: fail', B);
  assert.ok(!bNone.message.includes('gh workflow run') && !RERUN_UI.test(bNone.message), 'R8b the remedy does not suggest a by-hand run that cannot count');
  // fetchRuns attaches latest-attempt jobs only when the policy reads them
  const calls: string[] = [];
  const fake = (p: string): any => { calls.push(p); return p.includes('/jobs?') ? { jobs: jobs3() } : { total_count: 2, workflow_runs: [run({ id: 7 }), run({ id: 8, head_sha: OTHER })] }; };
  const got = g.fetchRuns(fake, opts(0, A));
  assert.ok(Array.isArray(got[0].jobs) && got[0].jobs.length > 0 && calls.some((c2) => c2.includes('/runs/7/jobs?filter=latest')), 'R8 fetchRuns attaches jobs when the policy reads them');
  assert.ok(!calls.some((c2) => c2.includes('/runs/8/')), 'R8 fetchRuns reads jobs only of runs that can count');
  calls.length = 0;
  g.fetchRuns(fake, opts(0, 'latest-run'));
  assert.ok(calls.length === 1, 'R8 fetchRuns reads no jobs for latest-run');
  assert.throws(() => g.fetchRuns(() => ({ total_count: 101, workflow_runs: [run({})] }), opts(0)), /more than one page/, 'R8 more runs than one page: not decided');

  // R9 the CLI exit code: 0 pass, 1 fail, 2 bad input (release.yml relies on it)
  assert.strictEqual(cli(dir, src, [run({ jobs: jobs3() })]), 0, 'R9 the CLI exits 0 on a green run');
  assert.strictEqual(cli(dir, src, [run({ conclusion: 'failure', jobs: jobs3({ 'UI shard (ubuntu-latest 1/4)': 'failure' }) })]), 1, 'R9 the CLI exits 1 on a red run');
  assert.strictEqual(cli(dir, src, [run({ jobs: jobs3() })], ['--max-minutes', '0']), 2, 'R9 the CLI exits 2 on bad input');
}

const mutants: Array<[string, string, string, string]> = [
  ['R1 sha not checked', "!/^[0-9a-f]{40}$/i.test(String(o.sha))", 'false', 'R1 a 39-hex sha is refused'],
  ['R1 sha not anchored', "!/^[0-9a-f]{40}$/i.test(String(o.sha))", "!/[0-9a-f]{40}/i.test(String(o.sha))", 'R1 a sha with a newline is refused'],
  ['R1 repo not checked', "!/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(String(o.repo))", 'false', 'R1 a repo with shell characters is refused'],
  ['R1 tag not checked', "!/^v[0-9A-Za-z.-]+$/.test(String(o.tag))", 'false', 'R1 a tag with shell characters is refused'],
  ['R1 limits not checked', 'Number(o.notFoundMs) > Number(o.maxMs)', 'false', 'R1 not-found wait longer than the whole wait is refused'],
  ['R1 policy not checked', "o.policy !== undefined && !Object.prototype.hasOwnProperty.call(POLICIES, o.policy)", 'false', 'R1 an unknown policy is refused'],
  ['R2 any sha', 'String(r.head_sha).toLowerCase() === s', 'true', "R2 another commit's green run does not count"],
  ['R2 pull_request counted', "const EVENTS = ['push', 'workflow_dispatch', 'schedule'];", "const EVENTS = ['push', 'workflow_dispatch', 'schedule', 'pull_request'];", 'R2 a pull_request run does not count'],
  ['R2 any push branch', "(r.event !== 'push' || r.head_branch === 'main')", 'true', 'R2 a push run off main does not count'],
  ['R2 any repository', '(!r.head_repository || r.head_repository.full_name === repo)', 'true', 'R2 a run from another repository does not count'],
  ['R2 any workflow', '(!r.path || r.path.split', '(true || r.path.split', 'R2 a run of another workflow does not count'],
  ['R3 no wait for a missing run', 'o.elapsedMs < o.notFoundMs', 'false', 'R3 no run after 5 min: wait'],
  ['R3 missing run waits forever', 'o.elapsedMs < o.notFoundMs', 'true', 'R3 no run after the not-found limit: fail'],
  ['R4 oldest run decides', 'return tb - ta || b.id - a.id;', 'return ta - tb || a.id - b.id;', 'R4 red then a green re-run (latest green): pass'],
  ['R4 created_at decides', "const at = (r) => Date.parse(r.run_started_at || r.created_at) || 0;", "const at = (r) => Date.parse(r.created_at) || 0;", 'R4 a re-run attempt (later run_started_at) is the latest'],
  ['R4 id tie ignored', 'return tb - ta || b.id - a.id;', 'return tb - ta;', 'R4 same start time: the higher id is the latest'],
  ['R4 any green counts', 'const latest = ok.slice().sort(newestFirst)[0];', "const latest = ok.find((r) => r.conclusion === 'success') || ok.slice().sort(newestFirst)[0];", 'R4 green then red (latest red): fail'],
  ['R4 running counted', "if (r.status !== 'completed') return { state: 'running', detail: '' };", '', 'R4 a running run: wait'],
  ['R4 waits forever', 'o.elapsedMs < o.maxMs', 'true', 'R4 still running at the wait limit: fail'],
  ['R5 cancelled counted as green', "if (r.conclusion === 'success')", "if (r.conclusion === 'success' || r.conclusion === 'cancelled')", 'R5 a cancelled run: fail'],
  ['R5 only failure fails', "if (r.conclusion === 'success')", "if (r.conclusion !== 'failure' && r.conclusion !== 'cancelled')", 'R5 conclusion timed_out: fail'],
  ['R5 cancelled message lost', "if (r.conclusion === 'cancelled') return { state: 'cancelled', detail: '' };", '', 'R5 a cancelled run: fail'],
  ['R5 cancel blames O3', 'A run is cancelled by a newer run in its concurrency group, a job time limit or a person; its page says which.', 'Spec 117 O3: a newer merge cancelled it.', 'R5 the cancelled message does not guess the cause'],
  ['R5 remedy re-runs the UI run', 'Fix the cause on main.', 'Re-run it: gh run rerun ${latest.id}.', 'R5 no message suggests re-running a UI run'],
  ['R6 errors pass', "return { verdict: 'fail', reason: 'api', message", "return { verdict: 'pass', reason: 'api', message", 'R6 an API that always fails ends in a failure, never a pass'],
  ['R6 no sleep', 'await o.sleep(o.intervalMs);', '', 'R6 the loop slept once per wait'],
  ['R7 4xx waits', "return code === 429 || code >= 500 ? 'wait' : 'fatal';", "return 'wait';", 'R7 404 fails at once'],
  ['R7 429 fatal', 'return code === 429 || code >= 500', 'return code >= 500', 'R7 429 waits'],
  ['R7 loop ignores fatal', "if (errorKind(err) === 'fatal')", 'if (false)', 'R7 the loop stops at once on a 404'],
  ['R7 stderr dropped', "throw new Error(`${String((e && e.stderr) || '').trim()} ", "throw new Error(`", 'R7 a gh failure carries the HTTP status from stderr'],
  ['R0 another policy in force', "const POLICY = 'linux-windows-jobs';", "const POLICY = 'latest-run';", 'R0 the policy in force is linux-windows-jobs (owner pick 2026-11-23)'],
  ['R8a remedy without the dispatch', "remedy: (o) => `Start a by-hand UI run on the tag (${dispatchRedo(o)}; only its Linux and Windows jobs decide)`,", "remedy: () => 'Re-run the UI run',", 'R8a the remedy is a by-hand UI run on the tag, never a UI re-run'],
  ['R8a macOS read', "|| ((SHARD.exec(j.name) || [])[1] === 'windows'));", "|| ((SHARD.exec(j.name) || [])[1] === 'windows') || ((SHARD.exec(j.name) || [])[1] === 'macos'));", 'R8a a red macOS shard does not veto'],
  ['R8a Linux not read', "|| ((SHARD.exec(j.name) || [])[1] === 'ubuntu')", '', 'R8a a red Linux shard fails'],
  ['R8a missing Windows passes', "!has('windows') || ", '', 'R8a no Windows shard fails'],
  ['R8a decision job not required', " || !pick.some((j) => j.name === DECISION_JOB)", '', 'R8a a missing decision job fails'],
  ['R8a unread jobs pass', "{ state: 'failed', detail: 'its jobs could not be read' }", "{ state: 'success', detail: 'its jobs could not be read' }", 'R8a jobs not read fails'],
  ['R8a running shard ignored', "if (pick.some((j) => j.status !== 'completed')) return { state: 'running', detail: 'Linux and Windows jobs' };", '', 'R8a a running Windows shard: wait'],
  ['R8b nightly counts', "counts: (r) => r.event === 'push' ||", "counts: (r) => r.event === 'push' || r.event === 'schedule' ||", 'R8b a newer red nightly does not count'],
  ['R8b macOS dispatch counts', ' && !r.jobs.some(isMacJob)', '', 'R8b a by-hand run with macOS jobs does not count'],
  ['R8 jobs never fetched', 'if (policy.needsJobs) {', 'if (false) {', 'R8 fetchRuns attaches jobs when the policy reads them'],
  ['R9 main always 0', "return v.verdict === 'pass' ? 0 : 1;", 'return 0;', 'R9 the CLI exits 1 on a red run'],
  ['R9 exit code ignored', 'process.exitCode = code;', 'process.exitCode = 0;', 'R9 the CLI exits 1 on a red run'],
  ['R9 bad input exits 0', "console.error(`release UI gate: ${bad.join('; ') || 'interval must be positive'}`); return 2;", "console.error('bad'); return 0;", 'R9 the CLI exits 2 on bad input'],
];

/** release.yml wiring, read by lines (no YAML dependency). */
function jobBlock(text: string, job: string): string[] {
  const ls = text.split('\n');
  const i = ls.findIndex((l) => l === `  ${job}:`);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < ls.length && (ls[j] === '' || /^ {4}|^\s*#/.test(ls[j])); j++) out.push(ls[j]);
  return out;
}
function jobNames(text: string): string[] {
  const ls = text.split('\n');
  const s = ls.indexOf('jobs:');
  return ls.slice(s + 1).filter((l) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l)).map((l) => l.trim().slice(0, -1));
}
const RUN_LINE = '        run: node scripts/release-ui-gate.js --sha "$SHA" --repo "$REPO" --tag "$TAG" --not-found-minutes 15 --max-minutes 150 --summary "$GITHUB_STEP_SUMMARY"';
/** What is wrong with release.yml's gate wiring (empty = fine). `norm` normalises line ends (a Windows checkout has CRLF). */
export function wiringProblems(raw: string, norm: (t: string) => string = lf): string[] {
  const text = norm(raw);
  const bad: string[] = [];
  const names = jobNames(text);
  if (names[0] !== 'ui-gate') bad.push('ui-gate is not the first job');
  const g = jobBlock(text, 'ui-gate');
  const body = g.filter((l) => !/^\s*#/.test(l)).join('\n');
  const perm = body.match(/\n {4}permissions:\n((?: {6}.*\n?)*)/);
  const permLines = perm ? perm[1].split('\n').map((l) => l.replace(/\s#.*$/, '').trim()).filter(Boolean).sort() : [];
  if (JSON.stringify(permLines) !== JSON.stringify(['actions: read', 'contents: read'])) bad.push(`ui-gate permissions are not exactly actions: read and contents: read (${permLines.join(', ')})`);
  if (!g.includes(RUN_LINE)) bad.push('ui-gate run line is not exactly the gate command (no `|| true`, no other flags)');
  for (const [k, v] of [['SHA', '${{ github.sha }}'], ['REPO', '${{ github.repository }}'], ['TAG', '${{ github.ref_name }}'], ['GH_TOKEN', '${{ github.token }}']]) {
    if (!body.split('\n').includes(`${' '.repeat(10)}${k}: ${v}`)) bad.push(`ui-gate env ${k} is not ${v}`);
  }
  const runLine = g.find((l) => /^ {8}run: /.test(l)) || '';
  if (runLine.includes('${{')) bad.push('ui-gate run: has a ${{ }} expression');
  for (const a of ['"$SHA"', '"$REPO"', '"$TAG"']) if (!runLine.includes(a)) bad.push(`ui-gate run: does not pass ${a} quoted`);
  if (/persist-credentials:\s*false/.test(body) === false) bad.push('ui-gate checkout keeps credentials');
  const tm = body.match(/\n {4}timeout-minutes: (\d+)/);
  if (!tm || Number(tm[1]) < 155) bad.push('ui-gate timeout-minutes is shorter than the 150-minute wait');
  const needs = (job: string): string => (jobBlock(text, job).find((l) => /^ {4}needs:/.test(l)) || '');
  if (!/\bui-gate\b/.test(needs('verify'))) bad.push('verify does not need ui-gate');
  if (!/\bui-gate\b/.test(needs('draft-release'))) bad.push('draft-release does not need ui-gate');
  for (const job of names.filter((n) => n !== 'ui-gate')) {
    const n = needs(job);
    if (!n) bad.push(`${job} needs nothing (it could start before the gate)`);
  }
  // a failed gate must stop everything: no job or step may run anyway (if: always() / !cancelled()) or swallow a failure
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  if (/^\s*(- )?continue-on-error\s*:/m.test(code)) bad.push('continue-on-error in release.yml (a failed gate would not stop the release)');
  if (/^\s*(- )?if\s*:/m.test(code)) bad.push('an if: in release.yml (a job or step could run after a failed gate)');
  // the top-level permissions stay read-only
  if (!/\npermissions:\n {2}contents: read\n\n/.test(text)) bad.push('top-level permissions are no longer contents: read only');
  return bad;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-ui-gate-'));
  try {
    await suite(REAL, dir);
    // a Windows checkout (CRLF): the gate loads and passes the same; without the LF normalisation it does not even load
    const crlf = REAL.replace(/\n/g, '\r\n');
    await suite(crlf, dir);
    assert.throws(() => load(crlf, same), SyntaxError, 'R0 a CRLF gate without LF normalisation does not load (the CRLF case can fail)');
    let killed = 0;
    for (const [name, from, to, want] of mutants) {
      assert.strictEqual(REAL.split(from).length - 1, 1, `mutant "${name}" anchor found once: ${from}`);
      let died = '';
      try { await suite(REAL.replace(from, () => to), dir); } catch (e) { died = (e as Error).message; }
      assert.ok(died.startsWith(want), `mutant "${name}" must die at "${want}", got: ${died || 'survived'}`);
      killed++;
    }

    const rawYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    const yml = lf(rawYml);
    assert.deepStrictEqual(wiringProblems(rawYml), [], 'release.yml: the UI gate is wired');
    const crlfYml = yml.replace(/\n/g, '\r\n');
    assert.deepStrictEqual(wiringProblems(crlfYml), [], 'release.yml with CRLF line ends (a Windows checkout) is read the same');
    assert.ok(wiringProblems(crlfYml, same).length > 0, 'the CRLF case can fail: without LF normalisation the wiring is not found');
    // the existing release checks stay (never weakened by this change)
    for (const keep of ['node scripts/release-notes.js --tag "$TAG"', 'sha256sum * > SHA256SUMS.txt', 'actions/attest-build-provenance@', '--draft "${KIND[@]}" --verify-tag', 'is already published: its files are not replaced', "CSC_IDENTITY_AUTO_DISCOVERY: 'false'"]) {
      assert.ok(yml.includes(keep), `release.yml keeps: ${keep}`);
    }
    const swap = (from: string, to: string): string => { assert.strictEqual(yml.split(from).length - 1, 1, `wiring mutant anchor once: ${from}`); return yml.replace(from, () => to); };
    const wiring: Array<[string, string, string]> = [
      ['actions: write', swap('      actions: read #', '      actions: write #'), 'ui-gate permissions'],
      ['extra permission', swap('      actions: read #', '      pull-requests: read\n      actions: read #'), 'ui-gate permissions'],
      ['expression inside run:', swap('--sha "$SHA"', '--sha "${{ github.sha }}"'), 'ui-gate run: has a ${{ }} expression'],
      ['unquoted sha', swap('--sha "$SHA"', '--sha $SHA'), 'ui-gate run: does not pass "$SHA" quoted'],
      ['exit code swallowed', swap('--max-minutes 150 --summary "$GITHUB_STEP_SUMMARY"\n', '--max-minutes 150 --summary "$GITHUB_STEP_SUMMARY" || true\n'), 'ui-gate run line is not exactly'],
      ['continue-on-error on the gate job', swap('    timeout-minutes: 160\n', '    timeout-minutes: 160\n    continue-on-error: true\n'), 'continue-on-error in release.yml'],
      ['continue-on-error on the gate step', swap('      - name: The latest UI run for the tagged commit finished green\n', '      - name: The latest UI run for the tagged commit finished green\n        continue-on-error: true\n'), 'continue-on-error in release.yml'],
      ['if: always() on the gate step', swap('      - name: The latest UI run for the tagged commit finished green\n', '      - name: The latest UI run for the tagged commit finished green\n        if: always()\n'), 'an if: in release.yml'],
      ['if: always() on verify', swap('    needs: ui-gate\n', '    needs: ui-gate\n    if: always()\n'), 'an if: in release.yml'],
      ['if: always() on build', swap('    needs: verify\n', '    needs: verify\n    if: ${{ !cancelled() }}\n'), 'an if: in release.yml'],
      ['verify without the gate', swap('    needs: ui-gate\n', ''), 'verify does not need ui-gate'],
      ['draft-release without the gate', swap('needs: [ui-gate, verify, build]', 'needs: [verify, build]'), 'draft-release does not need ui-gate'],
      ['short timeout', swap('    timeout-minutes: 160\n', '    timeout-minutes: 60\n'), 'ui-gate timeout-minutes'],
      ['sha from the ref', swap('          SHA: ${{ github.sha }}\n', '          SHA: ${{ github.ref }}\n'), 'ui-gate env SHA'],
    ];
    for (const [name, text, want] of wiring) {
      const p = wiringProblems(text);
      assert.ok(p.some((s) => s.startsWith(want)), `wiring mutant "${name}" is caught at "${want}", got: ${JSON.stringify(p)}`);
    }
    console.log(`[release-ui-gate] ok: rules R1-R9, ${killed} source mutants and ${wiring.length} wiring mutants killed, CRLF cases can fail`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
