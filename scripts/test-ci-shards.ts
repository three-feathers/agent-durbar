/**
 * Spec 117 FR-018 (#1983): `npm test` runs in 2 parts per OS (`test-ubuntu`, `test-windows`, `test-macos`, each a `shard: [1, 2]` matrix that sets
 * TEST_SHARD for scripts/run-tests.js), and the required checks "Build and test (<os>)" are one summary job (`build-test`) that passes only when
 * every part of its OS passed. The ruleset is not changed: the summary carries the required names (read from .github/ruleset-main.json).
 * This test reads ci.yml (js-yaml) and checks the wiring, then RUNS the summary's own shell script with every part result (success, failure,
 * cancelled, skipped, none) for every OS and event, so a summary that lets a failed, cancelled or skipped part through is caught by behaviour,
 * not by text. Mutants at the end: each must fail at its own message. The script runs under bash on Linux and macOS; on Windows it is not run
 * (the summary job runs on Linux; the wiring checks still run) and the test says so.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const norm = (t: string) => t.replace(/\r\n?/g, '\n');
const read = (p: string) => norm(fs.readFileSync(path.join(ROOT, p), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
let yaml: { load: (s: string) => unknown } | undefined; try { yaml = require('js-yaml'); } catch { yaml = undefined; }
assert.ok(yaml, 'js-yaml is missing: ci.yml cannot be parsed (a transitive dependency, as in scripts/test-electron-cache.ts). Fix the install instead of skipping.');

type Step = Record<string, unknown>;
type Job = Record<string, unknown> & { steps?: Step[] };
const PARTS: Record<string, { os: string; key: string }> = {
  'test-ubuntu': { os: 'ubuntu-latest', key: 'UBUNTU' },
  'test-windows': { os: 'windows-latest', key: 'WINDOWS' },
  'test-macos': { os: 'macos-latest', key: 'MACOS' },
};
const flat = (v: unknown) => String(v).replace(/\s+/g, '');
const RESULTS = ['success', 'failure', 'cancelled', 'skipped', ''];
const BASH = process.platform !== 'win32';

/** Run the summary's script for one OS, event and set of part results; true when it passes (exit 0). */
function summaryPasses(script: string, osName: string, event: string, results: Record<string, string>): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-shards-'));
  try {
    const env = { PATH: process.env.PATH || '', OS: osName, EVENT_NAME: event, GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'), ...results };
    const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
    assert.ok(r.status !== null, `bash did not run the summary script: ${String(r.error)}`);
    return r.status === 0;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Every way the wiring is wrong, as sentences; empty when it holds. */
export function problems(ci: string, ruleset: string): string[] {
  const out: string[] = [];
  const doc = (yaml as { load: (s: string) => unknown }).load(norm(ci)) as { jobs?: Record<string, Job> };
  const jobs = (doc && doc.jobs) || {};
  const required = ((JSON.parse(ruleset) as { rules?: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[] }).rules || [])
    .flatMap((r) => (r.type === 'required_status_checks' && r.parameters && r.parameters.required_status_checks) || []).map((c) => c.context)
    .filter((c) => c.startsWith('Build and test ('));
  if (required.length !== 3) out.push(`the ruleset lists ${required.length} required "Build and test (...)" checks, expected 3`);

  // the parts: one job per OS, on that OS, 2 parts, each runs plain `npm test` with TEST_SHARD i/2 under the docs-only condition only
  for (const [id, { os: osName }] of Object.entries(PARTS)) {
    const j = jobs[id];
    if (!j) { out.push(`ci.yml has no job ${id} (the ${osName} parts of npm test)`); continue; }
    if (j['runs-on'] !== osName) out.push(`${id} runs on ${String(j['runs-on'])}, not ${osName}: a part named for an OS must run on it`);
    if (required.includes(String(j.name))) out.push(`${id} carries a required name (${String(j.name)}): only the summary may`);
    if (j['continue-on-error'] !== undefined) out.push(`${id} has continue-on-error`);
    if (Number(j['timeout-minutes']) > 25) out.push(`${id} raises the 25-minute limit (#1983: not the first step)`);
    const strat = (j.strategy || {}) as { 'fail-fast'?: unknown; matrix?: Record<string, unknown> };
    const shards = strat.matrix && strat.matrix.shard;
    if (!strat.matrix || Object.keys(strat.matrix).join() !== 'shard' || !Array.isArray(shards)) { out.push(`${id}: the matrix is not exactly "shard: [1, 2, ...]"`); continue; }
    const n = shards.length;
    if (JSON.stringify(shards) !== JSON.stringify(Array.from({ length: n }, (_, k) => k + 1))) out.push(`${id}: matrix.shard is ${JSON.stringify(shards)}, expected 1..n with no gap`);
    if (strat['fail-fast'] !== false) out.push(`${id}: fail-fast is not false (one failed part would cancel the other and hide its failures)`);
    const tests = (j.steps || []).filter((s) => typeof s.run === 'string' && /\bnpm\s+test\b/.test(s.run as string));
    if (tests.length !== 1 || flat(tests[0].run) !== 'npmtest') { out.push(`${id}: expected one step that runs plain \`npm test\`, found ${tests.map((s) => JSON.stringify(s.run)).join(', ') || 'none'}`); continue; }
    const t = tests[0];
    const at = (j.steps || []).indexOf(t);
    if (!(j.steps || []).slice(0, at).some((s) => s.run === 'npm run build')) out.push(`${id}: no \`npm run build\` before \`npm test\` (the suites read dist/; spec 008 FR-193)`);
    const env = (t.env || {}) as Record<string, unknown>;
    if (flat(env.TEST_SHARD) !== `\${{matrix.shard}}/${n}`) out.push(`${id}: TEST_SHARD is ${JSON.stringify(env.TEST_SHARD)}, expected "\${{ matrix.shard }}/${n}" (the matrix has ${n} parts): a part count that differs from the matrix drops suites`);
    if (t.if !== undefined && flat(t.if) !== "steps.changes.outputs.code=='true'") out.push(`${id}: the npm test step runs only under "${String(t.if)}"`);
    if (t['continue-on-error'] !== undefined) out.push(`${id}: the npm test step has continue-on-error`);
  }

  // the summary: the required names, waits for exactly the three part jobs, runs unless the run was cancelled, and its script passes only on success
  const bt = jobs['build-test'];
  if (!bt) { out.push('ci.yml has no build-test summary job'); return out; }
  if (bt.name !== 'Build and test (${{ matrix.os }})') out.push(`the summary is named ${String(bt.name)}, not "Build and test (\${{ matrix.os }})"`);
  const oses = ((bt.strategy as { matrix?: { os?: unknown } } | undefined)?.matrix?.os) as unknown;
  const names = Array.isArray(oses) ? oses.map((o) => `Build and test (${String(o)})`) : [];
  for (const r of required) if (!names.includes(r)) out.push(`required check "${r}" has no summary job`);
  if (JSON.stringify([...(Array.isArray(bt.needs) ? bt.needs : [bt.needs])].sort()) !== JSON.stringify(Object.keys(PARTS).sort())) out.push(`the summary needs ${JSON.stringify(bt.needs)}, expected exactly the part jobs ${Object.keys(PARTS).join(', ')}`);
  if (flat(bt.if) !== '${{!cancelled()&&!github.event.pull_request.draft}}') out.push(`the summary's if is ${JSON.stringify(bt.if)}, expected "\${{ !cancelled() && !github.event.pull_request.draft }}" (without !cancelled() a failed part SKIPS the summary, and GitHub counts a skipped required check as passing)`);
  if (bt['continue-on-error'] !== undefined) out.push('the summary has continue-on-error');
  const steps = bt.steps || [];
  if (steps.length !== 1 || typeof steps[0].run !== 'string' || steps[0].shell !== 'bash') { out.push('the summary is not one bash step'); return out; }
  const step = steps[0];
  if (step['continue-on-error'] !== undefined || step.if !== undefined) out.push('the summary step has continue-on-error or a condition');
  const senv = (step.env || {}) as Record<string, unknown>;
  for (const [id, { key }] of Object.entries(PARTS)) if (flat(senv[key]) !== `\${{needs.${id}.result}}`) out.push(`the summary's ${key} is ${JSON.stringify(senv[key])}, expected "\${{ needs.${id}.result }}"`);
  if (flat(senv.OS) !== '${{matrix.os}}' || flat(senv.EVENT_NAME) !== '${{github.event_name}}') out.push('the summary does not read OS from matrix.os and EVENT_NAME from github.event_name');
  if (!BASH) return out;
  const script = step.run as string;
  const others = (osName: string, r: string) => Object.fromEntries(Object.values(PARTS).map((p) => [p.key, p.os === osName ? r : 'success']));
  for (const { os: osName, key } of Object.values(PARTS)) {
    for (const event of ['pull_request', 'push', 'merge_group', 'schedule', 'workflow_dispatch']) {
      const macSkip = osName === 'macos-latest' && (event === 'pull_request' || event === 'merge_group');
      for (const r of RESULTS) {
        const want = macSkip ? r === 'skipped' : r === 'success';
        const got = summaryPasses(script, osName, event, others(osName, r));
        if (got !== want) out.push(`the summary for ${osName} on ${event} ${got ? 'passes' : 'fails'} when its parts are "${r || 'none'}"; it must ${want ? 'pass' : 'fail'}`);
      }
      // a failure of another OS's parts does not decide this OS's check (each summary reads only its own parts)
      const theirs = Object.fromEntries(Object.values(PARTS).map((p) => [p.key, p.key === key ? (macSkip ? 'skipped' : 'success') : 'failure']));
      if (!summaryPasses(script, osName, event, theirs)) out.push(`the summary for ${osName} on ${event} fails because another OS failed: it must read only ${key}`);
    }
  }
  if (summaryPasses(script, 'linux', 'push', others('', 'success'))) out.push('the summary passes for an OS it does not know');
  return out;
}

const live = { ci: read('.github/workflows/ci.yml'), ruleset: read('.github/ruleset-main.json') };
assert.deepStrictEqual(problems(live.ci, live.ruleset), [], 'ci.yml: npm test parts and the Build and test summaries are wired as spec 117 FR-018 says');

// mutants: each must be caught by its own message
function mutant(label: string, change: (ci: string) => string, expect: RegExp, needsBash = false) {
  if (needsBash && !BASH) return;
  const ci = change(live.ci);
  assert.notStrictEqual(ci, live.ci, `${label}: the mutation changed nothing`);
  const p = problems(ci, live.ruleset);
  assert.ok(p.some((x) => expect.test(x)), `${label}: expected a problem matching ${expect}, got ${JSON.stringify(p)}`);
}
const swap = (text: string, from: string | RegExp, to: string) => { const t = text.replace(from, to); assert.notStrictEqual(t, text, `no "${String(from)}" in ci.yml to mutate`); return t; };
const IF = 'if: ${{ !cancelled() && !github.event.pull_request.draft }}';
mutant('the summary loses !cancelled()', (ci) => swap(ci, IF, 'if: ${{ !github.event.pull_request.draft }}'), /without !cancelled\(\) a failed part SKIPS the summary/);
mutant('the summary uses always()', (ci) => swap(ci, IF, 'if: ${{ always() }}'), /the summary's if is/);
mutant('the summary ignores skipped parts', (ci) => swap(ci, 'if [ "$result" != success ]; then', 'if [ "$result" != success ] && [ "$result" != skipped ]; then'), /on push passes when its parts are "skipped"/, true);
mutant('the summary ignores cancelled parts', (ci) => swap(ci, 'if [ "$result" != success ]; then', 'if [ "$result" = failure ]; then'), /passes when its parts are "cancelled"/, true);
mutant('the macOS skip also on push', (ci) => swap(ci, 'if [ "$OS" = macos-latest ] && { [ "$EVENT_NAME" = pull_request ] || [ "$EVENT_NAME" = merge_group ]; }; then', 'if [ "$OS" = macos-latest ]; then'), /macos-latest on push passes when its parts are "skipped"/, true);
mutant('the macOS PR branch passes a failure', (ci) => swap(ci, 'if [ "$result" = skipped ]; then exit 0; fi', 'exit 0'), /macos-latest on pull_request passes when its parts are "failure"/, true);
mutant('Windows reads the Ubuntu result', (ci) => swap(ci, 'windows-latest) result="$WINDOWS" ;;', 'windows-latest) result="$UBUNTU" ;;'), /windows-latest on push passes when its parts are "failure"/, true);
mutant('the summary does not wait for Windows', (ci) => swap(ci, 'needs: [test-ubuntu, test-windows, test-macos]', 'needs: [test-ubuntu, test-macos]'), /expected exactly the part jobs/);
mutant('the summary reads the wrong needs', (ci) => swap(ci, 'WINDOWS: ${{ needs.test-windows.result }}', 'WINDOWS: ${{ needs.test-ubuntu.result }}'), /the summary's WINDOWS is/);
mutant('the summary renamed', (ci) => swap(ci, 'name: Build and test (${{ matrix.os }})', 'name: Tests (${{ matrix.os }})'), /the summary is named Tests/);
mutant('the summary loses an OS', (ci) => swap(ci, 'os: [ubuntu-latest, windows-latest, macos-latest]', 'os: [ubuntu-latest, macos-latest]'), /required check "Build and test \(windows-latest\)" has no summary job/);
mutant('a part takes a required name', (ci) => swap(ci, 'name: Build and test (windows-latest) part ${{ matrix.shard }}/2', 'name: Build and test (windows-latest)'), /test-windows carries a required name/);
mutant('a third part in the matrix but TEST_SHARD still /2', (ci) => swap(ci, /(  test-windows:[\s\S]*?shard: )\[1, 2\]/, '$1[1, 2, 3]'), /test-windows: TEST_SHARD is "\$\{\{ matrix\.shard \}\}\/2", expected "\$\{\{ matrix\.shard \}\}\/3"/);
mutant('only part 1 in the matrix (half the suites never run)', (ci) => swap(ci, /(  test-ubuntu:[\s\S]*?shard: )\[1, 2\]/, '$1[1]'), /test-ubuntu: TEST_SHARD is .* expected "\$\{\{ matrix\.shard \}\}\/1"/);
mutant('a gap in the shard list', (ci) => swap(ci, /(  test-macos:[\s\S]*?shard: )\[1, 2\]/, '$1[1, 3]'), /test-macos: matrix\.shard is \[1,3\]/);
mutant('Windows parts on Linux', (ci) => swap(ci, 'runs-on: windows-latest', 'runs-on: ubuntu-latest'), /test-windows runs on ubuntu-latest, not windows-latest/);
mutant('a part with fail-fast', (ci) => swap(ci, /(  test-windows:[\s\S]*?fail-fast: )false/, '$1true'), /test-windows: fail-fast is not false/);
mutant('npm test filtered in a part', (ci) => swap(ci, /(  test-windows:[\s\S]*?)run: npm test\n/, '$1run: npm test -- redact\n'), /test-windows: expected one step that runs plain `npm test`/);
mutant('npm test skipped on a condition', (ci) => swap(ci, /(  test-windows:[\s\S]*?- if: )steps\.changes\.outputs\.code == 'true'(\n        env:\n          TEST_SHARD)/, "$1steps.changes.outputs.code == 'true' && matrix.shard == 1$2"), /test-windows: the npm test step runs only under/);
mutant('a part raises the limit', (ci) => swap(ci, /(  test-windows:[\s\S]*?timeout-minutes: )25/, '$140'), /test-windows raises the 25-minute limit/);
mutant('a part without the build', (ci) => swap(ci, /(  test-macos:[\s\S]*?)run: npm run build\n/, '$1run: echo no build\n'), /test-macos: no `npm run build` before `npm test`/);
mutant('a part continue-on-error', (ci) => swap(ci, /(  test-windows:\n)/, '$1    continue-on-error: true\n'), /test-windows has continue-on-error/);

console.log(`ci shards: ok (3 OSes x 2 parts, summary script ${BASH ? 'run for every result and event' : 'NOT run on Windows (no bash assumed); the wiring was checked'}, 22 mutants)`);
