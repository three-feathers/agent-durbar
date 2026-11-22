/**
 * Spec 117 FR-014 / T045 (`npm run test:releaseuigate`, in `npm test`): release.yml refuses a tag unless the "UI on three OSes" run
 * for exactly the tagged commit finished green. Tests scripts/release-ui-gate.js (the decision and the poll loop) on fixtures, then
 * guards release.yml's wiring by lines. No network, no gh, no git, no Electron. Every rule has a source mutant that must die at its
 * own assert.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const GATE = path.join(ROOT, 'scripts', 'release-ui-gate.js');
/** Text as LF: a Windows checkout (core.autocrlf) has CRLF, and `.` in a regex stops at `\r` (the shebang strip failed there). */
const lf = (t: string): string => t.replace(/\r\n?/g, '\n');
const REAL = lf(fs.readFileSync(GATE, 'utf8'));

type Run = Record<string, any>;
type Verdict = { verdict: 'pass' | 'wait' | 'fail'; reason: string; run?: Run; message: string };
type Gate = {
  decide: (runs: Run[], o: Record<string, unknown>) => Verdict;
  eligible: (r: Run, sha: string, repo: string) => boolean;
  checkInputs: (o: Record<string, unknown>) => string[];
  poll: (o: Record<string, unknown>) => Promise<Verdict>;
  runsPath: (repo: string, sha: string) => string;
  WORKFLOW_FILE: string;
};

/** Load the gate from source text (the real file or a mutant) as a CommonJS module. */
function load(src: string): Gate {
  const mod = { exports: {} as any };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__filename', '__dirname', lf(src).replace(/^#!.*\n/, ''))(mod, mod.exports, require, GATE, path.dirname(GATE));
  return mod.exports as Gate;
}

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'three-feathers/agent-durbar';
const MIN = 60 * 1000;
const opts = (elapsedMin: number): Record<string, unknown> => ({ sha: SHA, repo: REPO, tag: 'v0.1.15', elapsedMs: elapsedMin * MIN, notFoundMs: 15 * MIN, maxMs: 150 * MIN });
let nextId = 100;
function run(o: Partial<Run>): Run {
  const started = o.run_started_at || '2026-11-22T10:00:00Z';
  return {
    id: nextId++, head_sha: SHA, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success',
    run_started_at: started, created_at: started, path: '.github/workflows/ui-platforms.yml',
    head_repository: { full_name: REPO }, html_url: 'https://github.com/x/y/actions/runs/1', ...o,
  };
}

/** Every rule as one fixture case with a labelled assert; a mutant must make exactly its own label throw first. */
async function suite(src: string): Promise<void> {
  const g = load(src);
  const is = (runs: Run[], min: number, verdict: string, reason: string, label: string): Verdict => {
    const v = g.decide(runs, opts(min));
    assert.strictEqual(`${v.verdict}/${v.reason}`, `${verdict}/${reason}`, label);
    return v;
  };

  // R1 inputs: a 40-hex sha, an owner/name repo, a v* tag, limits that make sense
  assert.deepStrictEqual(g.checkInputs(opts(0)), [], 'R1 good inputs pass');
  assert.ok(g.checkInputs({ ...opts(0), sha: SHA.slice(1) }).length > 0, 'R1 a 39-hex sha is refused');
  assert.ok(g.checkInputs({ ...opts(0), sha: 'A'.repeat(40) }).length === 0, 'R1 upper-case hex is a sha');
  assert.ok(g.checkInputs({ ...opts(0), sha: 'g'.repeat(40) }).length > 0, 'R1 a non-hex sha is refused');
  assert.ok(g.checkInputs({ ...opts(0), sha: `${SHA}\n` }).length > 0, 'R1 a sha with a newline is refused');
  assert.ok(g.checkInputs({ ...opts(0), repo: 'x/y;rm' }).length > 0, 'R1 a repo with shell characters is refused');
  assert.ok(g.checkInputs({ ...opts(0), repo: 'x' }).length > 0, 'R1 a repo without owner is refused');
  assert.ok(g.checkInputs({ ...opts(0), tag: 'v1.2.3$(x)' }).length > 0, 'R1 a tag with shell characters is refused');
  assert.ok(g.checkInputs({ ...opts(0), notFoundMs: 200 * MIN }).length > 0, 'R1 not-found wait longer than the whole wait is refused');
  assert.throws(() => g.decide([], { ...opts(0), sha: 'nope' }), /sha/, 'R1 decide refuses a bad sha');
  assert.ok(g.runsPath(REPO, SHA).startsWith(`repos/${REPO}/actions/workflows/ui-platforms.yml/runs?`) && g.runsPath(REPO, SHA).includes(`head_sha=${SHA}`), 'R1 the API path names the workflow file and the sha');

  // R2 which runs count: this sha, this repo, push on main, workflow_dispatch or schedule; never pull_request (it tests a merge ref)
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

  // R4 the latest run (by run_started_at, then id) is the verdict; it must be completed
  is([run({ status: 'in_progress', conclusion: null })], 30, 'wait', 'running', 'R4 a running run: wait');
  is([run({ status: 'queued', conclusion: null })], 30, 'wait', 'running', 'R4 a queued run: wait');
  is([run({ run_started_at: '2026-11-22T09:00:00Z', conclusion: 'failure' }), run({ run_started_at: '2026-11-22T11:00:00Z', event: 'workflow_dispatch' })], 0, 'pass', 'success', 'R4 red then a green re-run (latest green): pass');
  is([run({ run_started_at: '2026-11-22T11:00:00Z', conclusion: 'failure' }), run({ run_started_at: '2026-11-22T09:00:00Z' })], 0, 'fail', 'failed', 'R4 green then red (latest red): fail');
  is([run({ run_started_at: '2026-11-22T09:00:00Z' }), run({ run_started_at: '2026-11-22T11:00:00Z', status: 'in_progress', conclusion: null })], 30, 'wait', 'running', 'R4 an older green run while a newer one runs: wait');
  // a re-run attempt keeps created_at but moves run_started_at: it is the newer verdict
  is([run({ created_at: '2026-11-22T08:00:00Z', run_started_at: '2026-11-22T12:00:00Z' }), run({ created_at: '2026-11-22T09:00:00Z', run_started_at: '2026-11-22T09:00:00Z', conclusion: 'cancelled' })], 0, 'pass', 'success', 'R4 a re-run attempt (later run_started_at) is the latest');
  is([run({ id: 1, conclusion: 'failure' }), run({ id: 2 })], 0, 'pass', 'success', 'R4 same start time: the higher id is the latest');
  is([run({ status: 'in_progress', conclusion: null })], 150, 'fail', 'timeout', 'R4 still running at the wait limit: fail');

  // R5 only success passes; cancelled has its own message (O3: a newer merge cancelled it)
  const c = is([run({ conclusion: 'cancelled' })], 0, 'fail', 'cancelled', 'R5 a cancelled run: fail');
  assert.ok(c.message.includes('gh run rerun') && c.message.includes('gh workflow run ui-platforms.yml') && /newer/.test(c.message), 'R5 the cancelled message says re-run it, dispatch on the tag, or tag a newer green commit');
  for (const k of ['failure', 'timed_out', 'skipped', 'neutral', 'action_required', 'startup_failure', 'stale']) is([run({ conclusion: k })], 0, 'fail', 'failed', `R5 conclusion ${k}: fail`);
  is([run({ conclusion: null })], 0, 'fail', 'failed', 'R5 completed without a conclusion: fail');

  // R6 the poll loop: waits with the clock, stops at pass or fail, counts API errors as a wait, never runs past maxMs
  let t = 0;
  const seq: Array<Run[] | Error> = [[], new Error('HTTP 502'), [run({ status: 'in_progress', conclusion: null })], [run({})]];
  const logs: string[] = [];
  const v = await g.poll({ ...opts(0), fetchRuns: () => { const s = seq.shift(); if (s instanceof Error) throw s; return s; }, sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: (s: string) => logs.push(s) });
  assert.strictEqual(`${v.verdict}/${v.reason}`, 'pass/success', 'R6 the loop waits through no-run, an API error and a running run, then passes');
  assert.strictEqual(t, 3 * MIN, 'R6 the loop slept once per wait');
  assert.ok(logs.some((l) => l.includes('API error')), 'R6 the API error is logged');
  t = 0;
  const v2 = await g.poll({ ...opts(0), fetchRuns: () => [run({ status: 'in_progress', conclusion: null })], sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: () => undefined });
  assert.strictEqual(`${v2.verdict}/${v2.reason}`, 'fail/timeout', 'R6 a run that never ends fails at the limit');
  assert.ok(t >= 150 * MIN && t <= 151 * MIN, 'R6 the loop stops at maxMs');
  t = 0;
  const v3 = await g.poll({ ...opts(0), fetchRuns: () => { throw new Error('HTTP 500'); }, sleep: async (ms: number) => { t += ms; }, now: () => t, intervalMs: MIN, log: () => undefined });
  assert.strictEqual(`${v3.verdict}/${v3.reason}`, 'fail/api', 'R6 an API that always fails ends in a failure, never a pass');
}

const mutants: Array<[string, string, string, string]> = [
  ['R1 sha not checked', "!/^[0-9a-f]{40}$/i.test(String(o.sha))", 'false', 'R1 a 39-hex sha is refused'],
  ['R1 sha not anchored', "!/^[0-9a-f]{40}$/i.test(String(o.sha))", "!/[0-9a-f]{40}/i.test(String(o.sha))", 'R1 a sha with a newline is refused'],
  ['R1 repo not checked', "!/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(String(o.repo))", 'false', 'R1 a repo with shell characters is refused'],
  ['R1 tag not checked', "!/^v[0-9A-Za-z.-]+$/.test(String(o.tag))", 'false', 'R1 a tag with shell characters is refused'],
  ['R1 limits not checked', 'Number(o.notFoundMs) > Number(o.maxMs)', 'false', 'R1 not-found wait longer than the whole wait is refused'],
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
  ['R4 running counted', "latest.status !== 'completed'", 'false', 'R4 a running run: wait'],
  ['R4 waits forever', 'o.elapsedMs < o.maxMs', 'true', 'R4 still running at the wait limit: fail'],
  ['R5 cancelled counted as green', "latest.conclusion === 'success'", "(latest.conclusion === 'success' || latest.conclusion === 'cancelled')", 'R5 a cancelled run: fail'],
  ['R5 only failure fails', "latest.conclusion === 'success'", "(latest.conclusion !== 'failure' && latest.conclusion !== 'cancelled')", 'R5 conclusion timed_out: fail'],
  ['R5 cancelled message lost', "latest.conclusion === 'cancelled'", 'false', 'R5 a cancelled run: fail'],
  ['R6 errors pass', "return { verdict: 'fail', reason: 'api'", "return { verdict: 'pass', reason: 'api'", 'R6 an API that always fails ends in a failure, never a pass'],
  ['R6 no sleep', 'await o.sleep(o.intervalMs);', '', 'R6 the loop slept once per wait'],
];

/** release.yml wiring, read by lines (no YAML dependency). */
function jobBlock(text: string, job: string): string[] {
  const ls = text.split(/\r?\n/);
  const i = ls.findIndex((l) => l === `  ${job}:`);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < ls.length && (ls[j] === '' || /^ {4}|^\s*#/.test(ls[j])); j++) out.push(ls[j]);
  return out;
}
function jobNames(text: string): string[] {
  const ls = text.split(/\r?\n/);
  const s = ls.indexOf('jobs:');
  return ls.slice(s + 1).filter((l) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l)).map((l) => l.trim().slice(0, -1));
}
export function wiringProblems(text: string): string[] {
  const bad: string[] = [];
  const names = jobNames(text);
  if (names[0] !== 'ui-gate') bad.push('ui-gate is not the first job');
  const g = jobBlock(text, 'ui-gate');
  const body = g.filter((l) => !/^\s*#/.test(l)).join('\n');
  const perm = body.match(/\n {4}permissions:\n((?: {6}.*\n?)*)/);
  const permLines = perm ? perm[1].split('\n').map((l) => l.replace(/\s#.*$/, '').trim()).filter(Boolean).sort() : [];
  if (JSON.stringify(permLines) !== JSON.stringify(['actions: read', 'contents: read'])) bad.push(`ui-gate permissions are not exactly actions: read and contents: read (${permLines.join(', ')})`);
  if (!/\n {6}- name: [^\n]*\n(?: {8}.*\n)*? {8}run: node scripts\/release-ui-gate\.js /.test(body + '\n')) bad.push('ui-gate does not run scripts/release-ui-gate.js');
  for (const [k, v] of [['SHA', '${{ github.sha }}'], ['REPO', '${{ github.repository }}'], ['TAG', '${{ github.ref_name }}'], ['GH_TOKEN', '${{ github.token }}']]) {
    if (!body.split('\n').includes(`${' '.repeat(10)}${k}: ${v}`)) bad.push(`ui-gate env ${k} is not ${v}`);
  }
  const runLine = g.find((l) => /^ {8}run: /.test(l)) || '';
  if (runLine.includes('${{')) bad.push('ui-gate run: has a ${{ }} expression');
  for (const a of ['"$SHA"', '"$REPO"', '"$TAG"']) if (!runLine.includes(a)) bad.push(`ui-gate run: does not pass ${a} quoted`);
  if (/persist-credentials:\s*false/.test(body) === false) bad.push('ui-gate checkout keeps credentials');
  const tm = body.match(/\n {4}timeout-minutes: (\d+)/);
  if (!tm || Number(tm[1]) < 155) bad.push('ui-gate timeout-minutes is shorter than the 150-minute wait');
  if (!/--max-minutes 150\b/.test(runLine) || !/--not-found-minutes 15\b/.test(runLine)) bad.push('ui-gate limits are not 150 and 15 minutes');
  const needs = (job: string): string => (jobBlock(text, job).find((l) => /^ {4}needs:/.test(l)) || '');
  if (!/\bui-gate\b/.test(needs('verify'))) bad.push('verify does not need ui-gate');
  if (!/\bui-gate\b/.test(needs('draft-release'))) bad.push('draft-release does not need ui-gate');
  for (const job of names.filter((n) => n !== 'ui-gate')) {
    const n = needs(job);
    if (!n) bad.push(`${job} needs nothing (it could start before the gate)`);
  }
  // the top-level permissions stay read-only
  if (!/\npermissions:\n {2}contents: read\n\n/.test(text)) bad.push('top-level permissions are no longer contents: read only');
  return bad;
}

(async () => {
  await suite(REAL);
  await suite(REAL.replace(/\n/g, '\r\n')); // the gate as a Windows checkout has it (CRLF): it loads and passes the same
  let killed = 0;
  for (const [name, from, to, want] of mutants) {
    assert.strictEqual(REAL.split(from).length - 1, 1, `mutant "${name}" anchor found once: ${from}`);
    let died = '';
    try { await suite(REAL.replace(from, () => to)); } catch (e) { died = (e as Error).message; }
    assert.ok(died.startsWith(want), `mutant "${name}" must die at "${want}", got: ${died || 'survived'}`);
    killed++;
  }

  const yml = lf(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
  assert.deepStrictEqual(wiringProblems(lf(yml.replace(/\n/g, '\r\n'))), [], 'release.yml with CRLF line ends (a Windows checkout) is read the same');
  assert.deepStrictEqual(wiringProblems(yml), [], 'release.yml: the UI gate is wired');
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
    ['verify without the gate', swap('    needs: ui-gate\n', ''), 'verify does not need ui-gate'],
    ['draft-release without the gate', swap('needs: [ui-gate, verify, build]', 'needs: [verify, build]'), 'draft-release does not need ui-gate'],
    ['short timeout', swap('    timeout-minutes: 160\n', '    timeout-minutes: 60\n'), 'ui-gate timeout-minutes'],
    ['sha from the ref', swap('          SHA: ${{ github.sha }}\n', '          SHA: ${{ github.ref }}\n'), 'ui-gate env SHA'],
  ];
  for (const [name, text, want] of wiring) {
    const p = wiringProblems(text);
    assert.ok(p.some((s) => s.startsWith(want)), `wiring mutant "${name}" is caught at "${want}", got: ${JSON.stringify(p)}`);
  }
  console.log(`[release-ui-gate] ok: decision and loop rules R1-R6, ${killed} source mutants and ${wiring.length} wiring mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });
