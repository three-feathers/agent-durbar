/**
 * Guard test (spec 117 FR-018, T022; constitution I and III): every suite in scripts/test-suites.txt, the redact and mask suites above all,
 * runs in a job whose name is a REQUIRED check, on every OS it runs on today. Reads only: the required list is the one recorded in the
 * spec's O1 table (read from the `main` ruleset on 2026-11-22; this test never calls GitHub and changes no setting), the jobs are read from
 * .github/workflows/ci.yml. Moving a suite (a masking one most of all) to a job that is not required would let a PR merge with that suite
 * red, so each way of doing it is a mutant below that must fail at its own assert.
 *
 * ci.yml is parsed with js-yaml (the file is read with line endings normalised, so a Windows checkout passes). The guard FAILS CLOSED: a workflow
 * shape it does not read (anchors, aliases, flow style, a computed or excluded matrix, a reusable workflow, a `run` that mentions `npm test` in any
 * form but the plain one) is a problem, never a pass. For the one job that runs `npm test` it asserts: the name is a required check on every OS;
 * each matrix entry runs on the OS it names (runner = os, real = 'yes'; macOS only the reviewed FR-106 expressions); the `changes` step is the
 * reviewed script under the reviewed condition; no `defaults`, no job or workflow `env`, no step that writes GITHUB_ENV or GITHUB_PATH, and only
 * reviewed env keys on the `npm test` step; every step before `npm test` is a reviewed shape (checkout, setup-node, npm-ci and its own steps, the
 * reviewed run lines: an allow-list, so github-script, an unknown or local action or a run built at run time is refused); the `npm test` step is the real command under no condition but the reviewed one. The summary-job
 * rules of T022 (a failed, skipped or cancelled shard; `if: !cancelled()`) land with the Windows split, if it is ever needed: there is no
 * summary job today.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ROOT = path.join(__dirname, '..', '..');
/** Line endings normalised: a Windows checkout has CRLF (the files here are read as text and matched per line). */
const norm = (t: string) => t.replace(/\r\n?/g, '\n');
const read = (p: string) => norm(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// the workflow is parsed with js-yaml, as scripts/test-electron-cache.ts does (a transitive dependency; no devDependency is added)
let yaml: { load: (s: string) => unknown } | undefined; try { yaml = require('js-yaml'); } catch { yaml = undefined; }
assert.ok(yaml, 'js-yaml is missing: ci.yml cannot be parsed, so the guard cannot check it. Fix the install instead of skipping.');

/** Names of the checks the spec records as required today: rows of the O1 table whose "Required today" cell starts with `yes`. */
export function requiredFromSpec(raw: string): string[] {
  const spec = norm(raw);
  const at = spec.indexOf('**O1, one line per check**');
  if (at < 0) return [];
  const names: string[] = [];
  for (const line of spec.slice(at).split('\n').slice(2)) {
    if (!line.startsWith('|')) { if (names.length) break; continue; }
    const cells = line.split('|').map((c) => c.trim());
    if (/^yes\b/.test(cells[2] || '')) names.push(cells[1]);
  }
  return names;
}

interface Step { [k: string]: unknown }
interface Job { id: string; name: string; raw: Record<string, unknown>; steps: Step[]; oses: string[]; entries: Record<string, unknown>[]; matrixError?: string }
/** YAML shapes the guard does not read (it fails closed on them: a person must extend the guard, a workflow may not slip past it). */
export function unsupportedShapes(wf: string): string[] {
  const out: string[] = [];
  const code = norm(wf).split('\n').filter((l) => !/^\s*#/.test(l));
  if (code.some((l) => /(^|[:,\[{-]\s+)[&*][\w-]+/.test(l) || /^\s*<<\s*:/.test(l))) out.push('the workflow uses YAML anchors, aliases or merge keys (not read by this guard)');
  if (code.some((l) => /^\s*-\s*[{[]/.test(l) || /^\s*(steps|jobs|include|strategy|matrix)\s*:\s*[{[]/.test(l))) out.push('the workflow uses flow style (braces or brackets) for jobs, steps or the matrix (not read by this guard)');
  return out;
}

/** The top-level keys of a workflow: `defaults` and `env` there change what every job runs. */
export function topLevel(wf: string): Record<string, unknown> {
  const doc = (yaml as { load: (s: string) => unknown }).load(norm(wf));
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : {};
}

/** The jobs of a workflow file, from the parsed YAML. Throws (the guard fails) on a shape it does not understand. */
export function readJobs(wf: string): Job[] {
  const doc = (yaml as { load: (s: string) => unknown }).load(norm(wf)) as { jobs?: Record<string, Record<string, unknown>> } | null;
  const jobsRaw = doc && typeof doc === 'object' ? doc.jobs : undefined;
  if (!jobsRaw || typeof jobsRaw !== 'object' || Array.isArray(jobsRaw)) throw new Error('the workflow has no `jobs:` mapping this guard can read');
  const jobs: Job[] = [];
  for (const [id, raw] of Object.entries(jobsRaw)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`job ${id} is not a mapping`);
    if (raw.uses !== undefined) throw new Error(`job ${id} calls a reusable workflow (uses:), which this guard does not read`);
    const steps = raw.steps;
    if (!Array.isArray(steps) || steps.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) throw new Error(`job ${id} has no steps list this guard can read`);
    const name = raw.name === undefined ? id : raw.name;
    if (typeof name !== 'string') throw new Error(`job ${id} has a name that is not a string`);
    const oses: string[] = [];
    const entries: Record<string, unknown>[] = [];
    let matrixError: string | undefined;
    const fail = (m: string) => { matrixError = matrixError || m; };
    const matrix = (raw.strategy as { matrix?: unknown } | undefined)?.matrix;
    if (matrix !== undefined) {
      if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) fail(`job ${id}: strategy.matrix is not a mapping (a computed matrix is not read by this guard)`);
      const m = (matrix && typeof matrix === 'object' && !Array.isArray(matrix) ? matrix : {}) as Record<string, unknown>;
      for (const k of Object.keys(m)) if (!['include', 'os'].includes(k)) fail(`job ${id}: strategy.matrix.${k} is not read by this guard (only include and os are; an exclude could remove an OS)`);
      if (m.os !== undefined) { if (!Array.isArray(m.os) || m.os.some((o) => typeof o !== 'string')) fail(`job ${id}: matrix.os is not a list of strings`); else oses.push(...(m.os as string[])); }
      if (m.include !== undefined) {
        if (!Array.isArray(m.include) || m.include.some((e) => !e || typeof e !== 'object' || typeof (e as { os?: unknown }).os !== 'string')) fail(`job ${id}: matrix.include is not a list of mappings with a string os`);
        else { oses.push(...(m.include as { os: string }[]).map((e) => e.os)); entries.push(...(m.include as Record<string, unknown>[])); }
      }
    }
    jobs.push({ id, name, raw, steps: steps as Step[], oses, entries, matrixError });
  }
  return jobs;
}

/** The names a job's `name:` becomes: `${{ matrix.os }}` is replaced by each matrix os. */
export function jobNames(job: Job): string[] {
  return /\$\{\{\s*matrix\.os\s*\}\}/.test(job.name) ? job.oses.map((o) => job.name.replace(/\$\{\{\s*matrix\.os\s*\}\}/g, o)) : [job.name];
}

const MASK = /redact|mask/i;
const ENV_KEYS = ['PREREVIEW_REQUIRE_REAL_SDK'];
const RUNS_NPM_TEST = /\bnpm\s+test\b/;
const runOf = (s: Step) => (typeof s.run === 'string' ? s.run : '');


// The steps before `npm test` are pinned to reviewed shapes: a step that can set the job's environment (GITHUB_ENV or GITHUB_PATH by any means,
// github-script, a local action, a name built at run time) must not slip in. Anything not listed here is a problem (fail closed): to add a
// step, review it and add its exact shape here. Run steps are matched exactly; actions by name and commit; the local npm-ci action is read too.
const STEP_KEYS = ['name', 'id', 'if', 'uses', 'with', 'run', 'env', 'shell'];
const USES: Record<string, string[]> = {
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1': ['fetch-depth'],
  'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1': ['node-version', 'cache'],
  './.github/actions/npm-ci': [],
};
const RUNS = ['bash .github/scripts/ci-changes.sh', 'npm ci --ignore-scripts --no-audit --no-fund --prefix scripts/prereview', 'npm run build'];
const ECHO_ONLY = /^(echo "[^"$`\\]*" \| tee -a "\$GITHUB_STEP_SUMMARY"\n?)+$/; // the macOS notice: prints and appends to the job summary only
const NPM_CI_RUNS = ['node scripts/electron-cache.js plan', 'node scripts/electron-cache.js seed'];
const NPM_CI_LOOP_SHA256 = '8e497dba0fbf55c032372ee3df9405c2525df90696bbe85c4764a6393c2deb40'; // the npm ci retry loop, reviewed 2026-11-22
const NPM_CI_USES = ['actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9'];

function preStepProblem(s: Step): string | null {
  const bad = (why: string) => `a step before \`npm test\` is not a reviewed shape (${why}): ${JSON.stringify(s.uses ?? runOf(s).slice(0, 50))}`;
  for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) return bad(`key "${k}"`);
  if (s.shell !== undefined && s.shell !== 'bash') return bad('shell is not bash');
  if (s.env !== undefined && JSON.stringify(Object.keys(s.env as object)) !== '["EVENT_NAME"]') return bad('env keys');
  if (s.uses !== undefined) {
    const allowed = USES[String(s.uses)];
    if (!allowed || s.run !== undefined) return bad('an action that is not on the reviewed list');
    for (const k of Object.keys((s.with as object) || {})) if (!allowed.includes(k)) return bad(`with.${k}`);
    return null;
  }
  const r = runOf(s).trim();
  if (RUNS.includes(r) || ECHO_ONLY.test(r)) return null;
  return bad('a run that is not on the reviewed list');
}
/** The local npm-ci action is composite steps the job runs before `npm test`: pinned the same way. */
function npmCiProblems(text: string): string[] {
  let doc: { runs?: { using?: string; steps?: Step[] } };
  try { doc = (yaml as { load: (s: string) => unknown }).load(norm(text)) as typeof doc; } catch (e) { return [`.github/actions/npm-ci/action.yml does not parse: ${(e as Error).message}`]; }
  const steps = doc?.runs?.steps;
  if (doc?.runs?.using !== 'composite' || !Array.isArray(steps)) return ['.github/actions/npm-ci/action.yml is not a composite action this guard reads'];
  const out: string[] = [];
  for (const s of steps) {
    const why = (w: string) => out.push(`the npm-ci action has a step that is not a reviewed shape (${w}): ${JSON.stringify(s.uses ?? runOf(s).slice(0, 50))}`);
    for (const k of Object.keys(s)) if (!['id', 'shell', 'run', 'uses', 'with', 'env'].includes(k)) why(`key "${k}"`);
    if (s.uses !== undefined) { if (!NPM_CI_USES.includes(String(s.uses))) why('an action that is not on the reviewed list'); continue; }
    const r = runOf(s).trim();
    if (NPM_CI_RUNS.includes(r)) continue;
    if (crypto.createHash('sha256').update(r).digest('hex') === NPM_CI_LOOP_SHA256) continue;
    why('a run that is not on the reviewed list: the npm ci retry loop is pinned by hash, so review the change and update NPM_CI_LOOP_SHA256');
  }
  return out;
}

/** Every way the guard can fail, as sentences; empty when the rules hold. */
export function problems(io: { ci: string; npmci: string; spec: string; suites: string; pkgScripts: Record<string, string> }): string[] {
  const out: string[] = [];
  const required = requiredFromSpec(io.spec);
  const buildReq = required.filter((n) => n.startsWith('Build and test ('));
  if (buildReq.length < 3) out.push(`the spec's O1 table records ${buildReq.length} required "Build and test (...)" checks, expected 3 (ubuntu, windows, macos): the table moved, update this guard with it`);
  const suites = io.suites.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  if (suites.length < 100) out.push(`test-suites.txt lists only ${suites.length} suites`);
  if (io.pkgScripts.test !== 'node scripts/run-tests.js') out.push(`package.json "test" is not "node scripts/run-tests.js", so \`npm test\` may not run the list`);

  // every redact or mask suite the package has is on the list, so \`npm test\` (the required job) runs it; none runs only somewhere else
  for (const k of Object.keys(io.pkgScripts)) {
    if (/^test:/.test(k) && MASK.test(k) && !suites.includes(k)) out.push(`masking suite ${k} is not in test-suites.txt: it would run outside the required "Build and test" jobs`);
  }
  for (const n of suites) if (!io.pkgScripts[n]) out.push(`test-suites.txt names ${n}, which is not a package.json script`);

  // the job that runs the whole list: plain `npm test`, under a required name on every OS. Anything about the workflow this guard does not read is a problem
  const shapes = unsupportedShapes(io.ci);
  out.push(...shapes);
  let jobs: Job[];
  try { jobs = readJobs(io.ci); } catch (e) { out.push(`ci.yml is in a shape this guard does not understand: ${(e as Error).message}`); return out; }
  if (shapes.length) return out;
  const PLAIN_KEYS = ['if', 'env', 'run', 'name'];
  const top = topLevel(io.ci);
  if (top.defaults !== undefined) out.push('the workflow has top-level `defaults` (a working-directory or shell there changes what every job runs)');
  if (top.env !== undefined) out.push('the workflow has top-level `env` (it reaches every step, `npm test` included)');
  for (const j of jobs) for (const s of j.steps) {
    if (RUNS_NPM_TEST.test(runOf(s)) && runOf(s).trim() !== 'npm test') out.push(`job ${j.id} has a step whose run mentions \`npm test\` in a shape this guard does not understand (a filter, a chain or several lines): ${JSON.stringify(runOf(s))}`);
  }
  const full = jobs.filter((j) => j.steps.some((s) => runOf(s).trim() === 'npm test'));
  if (full.length !== 1) { out.push(`expected exactly one ci.yml job that runs plain \`npm test\`, found ${full.length}`); return out; }
  const job = full[0];
  if (job.matrixError) { out.push(`ci.yml is in a shape this guard does not understand: ${job.matrixError}`); return out; }
  // every matrix entry runs on the OS its name says, and is really run (FR-106: only macOS reports on Linux in PRs, on purpose)
  const MAC = { runner: "${{(github.event_name=='pull_request'||github.event_name=='merge_group')&&'ubuntu-latest'||'macos-latest'}}", real: "${{(github.event_name=='pull_request'||github.event_name=='merge_group')&&'no'||'yes'}}" };
  const flat = (v: unknown) => String(v).replace(/\s+/g, '');
  if (job.raw['runs-on'] === undefined || flat(job.raw['runs-on']) !== '${{matrix.runner}}') out.push(`the suite job's runs-on is not "\${{ matrix.runner }}": ${String(job.raw['runs-on'])}`);
  for (const e of job.entries) {
    for (const k of Object.keys(e)) if (!['os', 'runner', 'real'].includes(k)) out.push(`matrix entry ${String(e.os)} has the key "${k}", which this guard does not understand`);
    if (e.os === 'macos-latest') {
      if (flat(e.runner) !== MAC.runner) out.push(`the macos-latest matrix entry's runner is not the reviewed FR-106 expression: ${String(e.runner)}`);
      if (flat(e.real) !== MAC.real) out.push(`the macos-latest matrix entry's real is not the reviewed FR-106 expression: ${String(e.real)}`);
    } else {
      if (e.runner !== e.os) out.push(`the ${String(e.os)} matrix entry runs on "${String(e.runner)}": a required check named for an OS must run on that OS`);
      if (e.real !== 'yes') out.push(`the ${String(e.os)} matrix entry has real: ${JSON.stringify(e.real)}: it would skip checkout and \`npm test\` and go green with zero suites`);
    }
  }
  if (job.raw.defaults !== undefined) out.push('the suite job has `defaults` (a working-directory or shell there changes what runs)');
  if (job.raw.env !== undefined) out.push('the suite job has job-level `env` (it reaches `npm test`; NODE_OPTIONS could change what runs)');
  const changes = job.steps.filter((s) => s.id === 'changes');
  const ch = changes[0];
  if (changes.length !== 1 || runOf(ch).trim() !== 'bash .github/scripts/ci-changes.sh' || flat(ch.if) !== "matrix.real=='yes'") out.push("the `changes` step is not the reviewed `bash .github/scripts/ci-changes.sh` under \"matrix.real == 'yes'\": it decides whether `npm test` runs, so it may not be replaced");
  else for (const k of Object.keys(ch)) if (!['id', 'if', 'shell', 'env', 'run'].includes(k) || (k === 'shell' && ch.shell !== 'bash') || (k === 'env' && JSON.stringify(Object.keys(ch.env as object)) !== '["EVENT_NAME"]')) out.push(`the \`changes\` step has the unreviewed key "${k}"`);
  const testAt = job.steps.findIndex((s) => runOf(s).trim() === 'npm test');
  for (const s of job.steps.slice(0, testAt)) if (/GITHUB_ENV|GITHUB_PATH/.test(runOf(s))) out.push(`a step before \`npm test\` writes GITHUB_ENV or GITHUB_PATH (it can change what \`npm test\` runs): ${JSON.stringify(runOf(s).slice(0, 60))}`);
  for (const s of job.steps.slice(0, testAt)) { const w = preStepProblem(s); if (w) out.push(w); }
  out.push(...npmCiProblems(io.npmci));
  const names = jobNames(job);
  for (const n of names) if (!required.includes(n)) out.push(`the job that runs every suite is named "${n}", which is not a required check (required: ${required.join('; ')})`);
  for (const n of buildReq) if (!names.includes(n)) out.push(`required check "${n}" has no job running the suites: the matrix lacks that OS`);
  if (job.raw.if !== undefined && String(job.raw.if).replace(/\s+/g, '') !== '${{!github.event.pull_request.draft}}') out.push(`the suite job has a condition other than "not a draft PR": ${String(job.raw.if)}`);
  if (job.raw['continue-on-error'] !== undefined) out.push('the suite job has continue-on-error');
  const testSteps = job.steps.filter((s) => runOf(s).trim() === 'npm test');
  if (testSteps.length !== 1) out.push(`the suite job has ${testSteps.length} \`npm test\` steps, expected 1`);
  const step = testSteps[0];
  if (step['continue-on-error'] !== undefined) out.push('the `npm test` step has continue-on-error');
  for (const k of Object.keys(step)) if (!PLAIN_KEYS.includes(k) && k !== 'continue-on-error') out.push(`the \`npm test\` step has the key "${k}", which this guard does not understand (a working-directory or shell could change what runs)`);
  if (step.env !== undefined) for (const k of Object.keys(step.env as object)) if (!ENV_KEYS.includes(k)) out.push(`the \`npm test\` step sets env "${k}", which is not a reviewed key (${ENV_KEYS.join(', ')}): it could change what runs`);
  const stepIf = step.if;
  if (stepIf !== undefined && String(stepIf).replace(/\s+/g, '') !== "steps.changes.outputs.code=='true'") out.push(`the \`npm test\` step runs only under "${String(stepIf)}": a suite would be skipped on some OS (only the docs-only skip "steps.changes.outputs.code == 'true'" is allowed)`);
  return out;
}

const live = { ci: read('.github/workflows/ci.yml'), npmci: read('.github/actions/npm-ci/action.yml'), spec: read('specs/117-delivery-speed-2/spec.md'), suites: read('scripts/test-suites.txt'), pkgScripts: JSON.parse(read('package.json')).scripts as Record<string, string> };

// the real repo passes
assert.deepStrictEqual(problems(live), [], 'ci.yml, test-suites.txt and the spec agree: every suite runs in a required job');
assert.deepStrictEqual(requiredFromSpec(live.spec).filter((n) => n.startsWith('Build and test (')).sort(), ['Build and test (macos-latest)', 'Build and test (ubuntu-latest)', 'Build and test (windows-latest)'], 'the spec records the three required Build and test checks');
assert.deepStrictEqual(jobNames(readJobs(live.ci).filter((j) => j.id === 'build-test')[0]).sort(), ['Build and test (macos-latest)', 'Build and test (ubuntu-latest)', 'Build and test (windows-latest)']);
const maskSuites = live.suites.split('\n').filter((l) => /^test:/.test(l) && MASK.test(l));
assert.ok(maskSuites.length >= 20 && maskSuites.includes('test:runtime-redact') && maskSuites.includes('test:maskoutgoing'), `the masking suites are found by name (${maskSuites.length})`);

// mutants: each must be caught, by the message of its own rule
function mutant(label: string, change: (io: typeof live) => typeof live, expect: RegExp) {
  const m = change({ ...live, pkgScripts: { ...live.pkgScripts } });
  assert.notDeepStrictEqual(m, live, `${label}: the mutation changed nothing`);
  const p = problems(m);
  assert.ok(p.some((x) => expect.test(x)), `${label}: expected a problem matching ${expect}, got ${JSON.stringify(p)}`);
}
const swap = (text: string, from: string | RegExp, to: string) => { const t = text.replace(from, to); assert.notStrictEqual(t, text, `no "${String(from)}" in the text to mutate`); return t; };

// a masking suite moved out of `npm test` into a job nobody requires
mutant('masking suite moved to an unrequired job', (io) => ({ ...io, suites: swap(io.suites, /^test:redact-monotone-b\n/m, ''), ci: io.ci + '\n  redact-extra:\n    name: Redact extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test:redact-monotone-b\n' }), /masking suite test:redact-monotone-b is not in test-suites\.txt/);
mutant('a masking suite dropped from the list', (io) => ({ ...io, suites: swap(io.suites, /^test:maskoutgoing\n/m, '') }), /masking suite test:maskoutgoing is not in test-suites\.txt/);
mutant('a mask suite (by name) not listed', (io) => ({ ...io, pkgScripts: { ...io.pkgScripts, 'test:newmask': 'node x.js' } }), /masking suite test:newmask is not in test-suites\.txt/);
// the job that runs everything stops being required
mutant('suite job renamed to an unrequired name', (io) => ({ ...io, ci: swap(io.ci, 'name: Build and test (${{ matrix.os }})', 'name: Unit tests (${{ matrix.os }})') }), /is named "Unit tests \(windows-latest\)", which is not a required check/);
mutant('suite job named without the OS', (io) => ({ ...io, ci: swap(io.ci, 'name: Build and test (${{ matrix.os }})', 'name: Build and test') }), /named "Build and test", which is not a required check/);
mutant('Windows leaves the matrix', (io) => ({ ...io, ci: swap(io.ci, /\s+- os: windows-latest\n\s+runner: windows-latest\n\s+real: 'yes'/, '') }), /required check "Build and test \(windows-latest\)" has no job/);
// `npm test` no longer runs the whole list, or not everywhere
mutant('npm test with a name filter', (io) => ({ ...io, ci: swap(io.ci, /run: npm test\n/, 'run: npm test -- folders\n') }), /mentions `npm test` in a shape this guard does not understand/);
mutant('npm test step skipped on one OS', (io) => ({ ...io, ci: swap(io.ci, /      - if: steps\.changes\.outputs\.code == 'true'\n        env:\n          # spec 103/, "      - if: steps.changes.outputs.code == 'true' && matrix.os != 'windows-latest'\n        env:\n          # spec 103") }), /step runs only under/);
mutant('npm test step continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(\n        run: npm test\n)/, '\n        continue-on-error: true$1') }), /`npm test` step has continue-on-error/);
mutant('suite job continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(    runs-on: \$\{\{ matrix\.runner \}\}\n)/, '$1    continue-on-error: true\n') }), /suite job has continue-on-error/);
mutant('suite job only on some condition', (io) => ({ ...io, ci: swap(io.ci, /(  build-test:\n    name: [^\n]*\n)    if: [^\n]*\n/, "$1    if: ${{ github.event_name == 'push' }}\n") }), /condition other than "not a draft PR"/);
mutant('a second job also runs npm test', (io) => ({ ...io, ci: io.ci + '\n  shadow:\n    name: Shadow\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' }), /exactly one ci\.yml job that runs plain `npm test`, found 2/);
mutant('npm test is not the runner', (io) => ({ ...io, pkgScripts: { ...io.pkgScripts, test: 'node scripts/run-tests.js redact' } }), /"test" is not "node scripts\/run-tests\.js"/);
mutant('the spec table loses a required row', (io) => ({ ...io, spec: swap(io.spec, '| Build and test (windows-latest) | yes |', '| Build and test (windows-latest) | no |') }), /records 2 required/);
mutant('a listed suite that is not a script', (io) => ({ ...io, suites: io.suites + '\ntest:no-such-suite\n' }), /test:no-such-suite, which is not a package\.json script/);

// Windows checkouts have CRLF: the same files with CRLF endings pass the same rules and the same mutants die
{
  const crlf = (t: string) => t.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(problems({ ...live, ci: crlf(live.ci), spec: crlf(live.spec), suites: crlf(live.suites) }), [], 'CRLF files pass');
  assert.deepStrictEqual(norm(crlf(live.ci)), live.ci, 'norm undoes CRLF');
  assert.ok(problems({ ...live, ci: crlf(swap(live.ci, /run: npm test\n/, 'run: npm test -- folders\n')) }).length > 0, 'a CRLF mutant still dies');
}

// valid YAML shapes the guard does not read must FAIL, never pass (fail closed); each is a fixture and has its own message
const BT_IF = '    if: ${{ !github.event.pull_request.draft }}\n    runs-on: ${{ matrix.runner }}\n';
const LAST_STEP = '          PATH="$RUNNER_TEMP/art/bin:$PATH" DURBAR_REQUIRE_PILLOW=1 npm run test:realoffice-assets\n';
mutant('job-level if placed after steps', (io) => ({ ...io, ci: swap(swap(io.ci, BT_IF, '    runs-on: ${{ matrix.runner }}\n'), LAST_STEP, LAST_STEP + "    if: ${{ github.event_name == 'push' }}\n") }), /condition other than "not a draft PR"/);
mutant('job-level continue-on-error placed after steps', (io) => ({ ...io, ci: swap(io.ci, LAST_STEP, LAST_STEP + '    continue-on-error: true\n') }), /suite job has continue-on-error/);
mutant('a step named npm test whose run is filtered', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        name: npm test\n        run: npm test -- folders\n') }), /mentions `npm test` in a shape this guard does not understand/);
mutant('a comment ending in npm test over a filtered run', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: npm test -- folders # npm test\n') }), /mentions `npm test` in a shape/);
mutant('a run block where a later command hides a failed npm test', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: |\n          npm test\n          true\n') }), /mentions `npm test` in a shape/);
mutant('npm test chained with || true', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: npm test || true\n') }), /mentions `npm test` in a shape/);
mutant('a folded multi-line run', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: >-\n          npm test\n          -- folders\n') }), /mentions `npm test` in a shape/);
mutant('a YAML anchor', (io) => ({ ...io, ci: swap(io.ci, 'fail-fast: false\n      matrix:', 'fail-fast: &ff false\n      matrix:') }), /anchors, aliases or merge keys/);
mutant('a YAML alias', (io) => ({ ...io, ci: swap(swap(io.ci, 'fail-fast: false\n      matrix:', 'fail-fast: &ff false\n      matrix:'), "            real: 'yes'\n          - os: windows-latest", '            real: *ff\n          - os: windows-latest') }), /anchors, aliases or merge keys/);
mutant('flow style steps', (io) => ({ ...io, ci: swap(io.ci, '    steps:\n      - name: macOS runs', '    steps:\n      - { run: echo hi }\n      - name: macOS runs') }), /flow style/);
mutant('a matrix exclude drops Windows', (io) => ({ ...io, ci: swap(io.ci, '      matrix:\n        include:', '      matrix:\n        exclude:\n          - os: windows-latest\n        include:') }), /strategy\.matrix\.exclude is not read/);
mutant('the npm test step runs in another folder', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        working-directory: scripts\n        run: npm test\n') }), /has the key "working-directory"/);
mutant('a computed matrix', (io) => ({ ...io, ci: swap(io.ci, '      matrix:\n        include:', '      matrix: ${{ fromJSON(needs.x.outputs.m) }}\n      zz:\n        include:') }), /strategy\.matrix is not a mapping/);
mutant('a workflow that does not parse', (io) => ({ ...io, ci: io.ci + '\n  bad: [unclosed\n' }), /not understand/);

// a required check that runs no suites, or the wrong OS
const WIN = "          - os: windows-latest\n            runner: windows-latest\n            real: 'yes'\n";
const NT = '        run: npm test\n';
const RUNS_ON = '    runs-on: ${{ matrix.runner }}\n    # spec 008 FR-195';
mutant('Windows entry with real: no (zero suites, green)', (io) => ({ ...io, ci: swap(io.ci, WIN, WIN.replace("real: 'yes'", "real: 'no'")) }), /windows-latest matrix entry has real: "no"/);
mutant('Windows entry on an ubuntu runner', (io) => ({ ...io, ci: swap(io.ci, WIN, WIN.replace('runner: windows-latest', 'runner: ubuntu-latest')) }), /windows-latest matrix entry runs on "ubuntu-latest"/);
mutant('Ubuntu entry with real: no', (io) => ({ ...io, ci: swap(io.ci, "          - os: ubuntu-latest\n            runner: ubuntu-latest\n            real: 'yes'\n", "          - os: ubuntu-latest\n            runner: ubuntu-latest\n            real: 'no'\n") }), /ubuntu-latest matrix entry has real: "no"/);
mutant('macOS entry always on Linux', (io) => ({ ...io, ci: swap(io.ci, /(          - os: macos-latest\n            runner: )[^\n]*\n/, '$1ubuntu-latest\n') }), /macos-latest matrix entry's runner is not the reviewed FR-106 expression/);
mutant('macOS real expression changed', (io) => ({ ...io, ci: swap(io.ci, /(          - os: macos-latest\n            runner: [^\n]*\n            real: )[^\n]*\n/, "$1'no'\n") }), /macos-latest matrix entry's real is not the reviewed FR-106 expression/);
mutant('runs-on not the matrix runner', (io) => ({ ...io, ci: swap(io.ci, RUNS_ON, '    runs-on: ubuntu-latest\n    # spec 008 FR-195') }), /runs-on is not "\$\{\{ matrix\.runner \}\}"/);
mutant('a matrix entry with an extra key', (io) => ({ ...io, ci: swap(io.ci, WIN, WIN + '            container: node\n') }), /has the key "container"/);
mutant('the changes step replaced by one that writes code=false', (io) => ({ ...io, ci: swap(io.ci, '        run: bash .github/scripts/ci-changes.sh\n', '        run: echo code=false >> "$GITHUB_OUTPUT"\n') }), /`changes` step is not the reviewed/);
mutant('the changes step loses its condition', (io) => ({ ...io, ci: swap(io.ci, "      - id: changes\n        if: matrix.real == 'yes'\n", "      - id: changes\n        if: matrix.os == 'macos-latest'\n") }), /`changes` step is not the reviewed/);
mutant('the changes step has a second key', (io) => ({ ...io, ci: swap(io.ci, '        run: bash .github/scripts/ci-changes.sh\n', '        continue-on-error: true\n        run: bash .github/scripts/ci-changes.sh\n') }), /`changes` step has the unreviewed key "continue-on-error"/);
mutant('job-level defaults working-directory', (io) => ({ ...io, ci: swap(io.ci, RUNS_ON, '    runs-on: ${{ matrix.runner }}\n    defaults:\n      run:\n        working-directory: scripts\n    # spec 008 FR-195') }), /suite job has `defaults`/);
mutant('workflow-level defaults', (io) => ({ ...io, ci: swap(io.ci, /^jobs:\n/m, 'defaults:\n  run:\n    working-directory: scripts\njobs:\n') }), /top-level `defaults`/);
mutant('workflow-level env', (io) => ({ ...io, ci: swap(io.ci, /^jobs:\n/m, 'env:\n  NODE_OPTIONS: --max-old-space-size=1\njobs:\n') }), /top-level `env`/);
mutant('job-level env NODE_OPTIONS', (io) => ({ ...io, ci: swap(io.ci, RUNS_ON, '    runs-on: ${{ matrix.runner }}\n    env:\n      NODE_OPTIONS: --require ./x.js\n    # spec 008 FR-195') }), /job-level `env`/);
mutant('NODE_OPTIONS on the npm test step', (io) => ({ ...io, ci: swap(io.ci, '          PREREVIEW_REQUIRE_REAL_SDK:', '          NODE_OPTIONS: --require ./x.js\n          PREREVIEW_REQUIRE_REAL_SDK:') }), /sets env "NODE_OPTIONS"/);
mutant('a step before npm test writes GITHUB_ENV', (io) => ({ ...io, ci: swap(io.ci, "      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n", "      - run: echo NODE_OPTIONS=--require=./x.js >> \"$GITHUB_ENV\"\n      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n") }), /writes GITHUB_ENV or GITHUB_PATH/);
mutant('the npm test step is an echo', (io) => ({ ...io, ci: swap(io.ci, NT, '        run: echo npm test\n') }), /mentions `npm test` in a shape this guard does not understand/);

// the steps before npm test are pinned: nothing else may set the job's environment
const BUILD = "      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n";
const pre = (step: string) => (io: typeof live) => ({ ...io, ci: swap(io.ci, BUILD, step + BUILD) });
mutant('a step before npm test writes GITHUB_PATH', pre('      - run: echo "$PWD/evil" >> "$GITHUB_PATH"\n'), /writes GITHUB_ENV or GITHUB_PATH/);
mutant('github-script exports a variable', pre("      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea\n        with:\n          script: core.exportVariable('NODE_OPTIONS', '--require ./x.js')\n"), /an action that is not on the reviewed list/);
mutant('a local action before npm test', pre('      - uses: ./.github/actions/evil\n'), /an action that is not on the reviewed list/);
mutant('a GITHUB_ENV name built at run time', pre('      - run: |\n          n=GITHUB_E; echo "NODE_OPTIONS=--require ./x.js" >> "${!n}"\n'), /a run that is not on the reviewed list/);
mutant('checkout with an extra input', (io) => ({ ...io, ci: swap(io.ci, '          fetch-depth: 2\n', '          fetch-depth: 2\n          path: elsewhere\n') }), /with\.path/);
mutant('setup-node at another commit', (io) => ({ ...io, ci: swap(io.ci, 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@0000000000000000000000000000000000000000') }), /an action that is not on the reviewed list/);
mutant('the macOS notice also writes GITHUB_ENV', (io) => ({ ...io, ci: swap(io.ci, 'tee -a "$GITHUB_STEP_SUMMARY"\n          echo "It runs', 'tee -a "$GITHUB_STEP_SUMMARY"\n          echo NODE_OPTIONS=x >> "$GITHUB_ENV"\n          echo "It runs') }), /writes GITHUB_ENV or GITHUB_PATH/);
mutant('a pre-test step with a shell override', pre('      - shell: pwsh\n        run: npm run build\n'), /shell is not bash/);
mutant('the changes step with another shell', (io) => ({ ...io, ci: swap(io.ci, '        shell: bash\n        env:\n          EVENT_NAME', '        shell: pwsh\n        env:\n          EVENT_NAME') }), /`changes` step has the unreviewed key "shell"/);
mutant('the changes step with an extra env key', (io) => ({ ...io, ci: swap(io.ci, '          EVENT_NAME: ${{ github.event_name }}\n        run: bash .github/scripts/ci-changes.sh', '          EVENT_NAME: ${{ github.event_name }}\n          NODE_OPTIONS: --require ./x.js\n        run: bash .github/scripts/ci-changes.sh') }), /`changes` step has the unreviewed key "env"/);
// the local npm-ci action runs before npm test: pinned too
mutant('npm-ci gains a step that writes GITHUB_ENV', (io) => ({ ...io, npmci: io.npmci + '    - shell: bash\n      run: echo NODE_OPTIONS=x >> "$GITHUB_ENV"\n' }), /the npm-ci action has a step that is not a reviewed shape/);
mutant('npm-ci retry loop edited', (io) => ({ ...io, npmci: swap(io.npmci, '        tries=$(( ${#waits[@]} + 1 ))\n', '        tries=$(( ${#waits[@]} + 1 ))\n        echo NODE_OPTIONS=x >> "$GITHUB_ENV"\n') }), /npm ci retry loop is pinned by hash/);
mutant('npm-ci uses another action', (io) => ({ ...io, npmci: swap(io.npmci, 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9', 'actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea') }), /npm-ci action has a step that is not a reviewed shape \(an action/);
mutant('npm-ci is not a composite action', (io) => ({ ...io, npmci: swap(io.npmci, 'using: composite', 'using: node22') }), /not a composite action/);

console.log(`ci required suites: ok (${live.suites.split('\n').filter((l) => /^test:/.test(l)).length} suites, ${maskSuites.length} masking, 58 mutants)`);
