/**
 * Guard test (spec 117 FR-018, T022; constitution I and III): every suite in scripts/test-suites.txt, the redact and mask suites above all,
 * runs in a job whose name is a REQUIRED check, on every OS it runs on today. Reads only: the required list is the one recorded in the
 * spec's O1 table (read from the `main` ruleset on 2026-11-22; this test never calls GitHub and changes no setting), the jobs are read from
 * .github/workflows/ci.yml. Moving a suite (a masking one most of all) to a job that is not required would let a PR merge with that suite
 * red, so each way of doing it is a mutant below that must fail at its own assert.
 *
 * ci.yml is parsed with js-yaml (the file is read with line endings normalised, so a Windows checkout passes). The guard FAILS CLOSED: a workflow
 * shape it does not read (anchors, aliases, flow style, a computed or excluded matrix, a reusable workflow, a `run` that mentions `npm test` in any
 * form but the plain one) is a problem, never a pass. Since the split (FR-018 delta 2026-11-22, #2031) `npm test` runs in part jobs, one per required
 * OS, on that OS ("Build and test (<os>) part ${{ matrix.shard }}/N", a `shard: [1..N]` matrix, TEST_SHARD i/N; macOS only under the reviewed
 * FR-106 condition), and for each part it asserts: the `changes` step is the reviewed script with no condition; no `defaults`, no job or workflow
 * `env`, no step that writes GITHUB_ENV or GITHUB_PATH, and only reviewed env keys on the `npm test` step; every step before `npm test` is a reviewed
 * shape (checkout, setup-node, npm-ci and its own steps, the reviewed run lines: an allow-list, so github-script, an unknown or local action or a run
 * built at run time is refused); the `npm test` step is the real command under no condition but the reviewed one. The summary job carries the
 * required names, needs exactly the parts, runs under `always()` with `permissions: {}`, and its script is RUN (scripts/ci-summary-probe.ts) for
 * every part result: it must fail on a failed, cancelled, skipped or missing part. That every suite is in exactly one part is run-tests.js's own
 * check (scripts/test-run-tests.ts).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { canRun, summaryPasses } from './ci-summary-probe';

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
interface Job { id: string; name: string; raw: Record<string, unknown>; steps: Step[]; oses: string[]; entries: Record<string, unknown>[]; shards: number[]; matrixError?: string }
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
    const shards: number[] = [];
    let matrixError: string | undefined;
    const fail = (m: string) => { matrixError = matrixError || m; };
    const matrix = (raw.strategy as { matrix?: unknown } | undefined)?.matrix;
    if (matrix !== undefined) {
      if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) fail(`job ${id}: strategy.matrix is not a mapping (a computed matrix is not read by this guard)`);
      const m = (matrix && typeof matrix === 'object' && !Array.isArray(matrix) ? matrix : {}) as Record<string, unknown>;
      for (const k of Object.keys(m)) if (!['include', 'os', 'shard'].includes(k)) fail(`job ${id}: strategy.matrix.${k} is not read by this guard (only include, os and shard are; an exclude could remove an OS or a part)`);
      if (m.shard !== undefined) { if (!Array.isArray(m.shard) || m.shard.some((x) => !Number.isInteger(x))) fail(`job ${id}: matrix.shard is not a list of whole numbers`); else shards.push(...(m.shard as number[])); }
      if (m.os !== undefined) { if (!Array.isArray(m.os) || m.os.some((o) => typeof o !== 'string')) fail(`job ${id}: matrix.os is not a list of strings`); else oses.push(...(m.os as string[])); }
      if (m.include !== undefined) {
        if (!Array.isArray(m.include) || m.include.some((e) => !e || typeof e !== 'object' || typeof (e as { os?: unknown }).os !== 'string')) fail(`job ${id}: matrix.include is not a list of mappings with a string os`);
        else { oses.push(...(m.include as { os: string }[]).map((e) => e.os)); entries.push(...(m.include as Record<string, unknown>[])); }
      }
    }
    jobs.push({ id, name, raw, steps: steps as Step[], oses, entries, shards, matrixError });
  }
  return jobs;
}

/** The names a job's `name:` becomes: `${{ matrix.os }}` is replaced by each matrix os. */
export function jobNames(job: Job): string[] {
  return /\$\{\{\s*matrix\.os\s*\}\}/.test(job.name) ? job.oses.map((o) => job.name.replace(/\$\{\{\s*matrix\.os\s*\}\}/g, o)) : [job.name];
}

const MASK = /redact|mask/i;
const ENV_KEYS = ['PREREVIEW_REQUIRE_REAL_SDK', 'TEST_SHARD', 'TEST_JOBS'];
const DRAFT_IF = '${{!github.event.pull_request.draft}}';
const MAC_IF = "${{!github.event.pull_request.draft&&github.event_name!='pull_request'&&github.event_name!='merge_group'}}"; // FR-106: macOS parts never on PRs or queue entries
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
  if (RUNS.includes(r)) return null;
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

  // The jobs that run the whole list: since the split (FR-018 delta 2026-11-22) one part job per required OS ("Build and test (<os>) part
  // ${{ matrix.shard }}/N", a `shard: [1..N]` matrix, TEST_SHARD i/N), behind one summary job whose names are the required checks. Anything about
  // the workflow this guard does not read is a problem.
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
  const flat = (v: unknown) => String(v).replace(/\s+/g, '');
  const parts = jobs.filter((j) => j.steps.some((s) => runOf(s).trim() === 'npm test'));
  const osOfReq = (n: string) => n.slice('Build and test ('.length, -1);
  for (const n of buildReq) {
    const k = parts.filter((j) => j.raw['runs-on'] === osOfReq(n)).length;
    if (k !== 1) out.push(`required check "${n}" has ${k} part jobs running the suites on ${osOfReq(n)}, expected exactly 1`);
  }
  out.push(...npmCiProblems(io.npmci));
  for (const job of parts) {
    const osName = String(job.raw['runs-on']);
    const tag = `the ${osName} part job (${job.id})`;
    if (!buildReq.includes(`Build and test (${osName})`)) out.push(`job ${job.id} runs \`npm test\` on "${osName}", which no required "Build and test" check names: a required check named for an OS must run on that OS`);
    if (job.matrixError) { out.push(`ci.yml is in a shape this guard does not understand: ${job.matrixError}`); continue; }
    const n = job.shards.length;
    if (!n || JSON.stringify(job.shards) !== JSON.stringify(Array.from({ length: n }, (_, k) => k + 1))) out.push(`${tag}: matrix.shard is ${JSON.stringify(job.shards)}, expected [1, ..., n] with no gap`);
    if (job.oses.length) out.push(`${tag} has a matrix os or include, which this guard does not read for a part job`);
    if (flat(job.name) !== flat(`Build and test (${osName}) part \${{ matrix.shard }}/${n}`)) out.push(`${tag} is named "${job.name}", expected "Build and test (${osName}) part \${{ matrix.shard }}/${n}"`);
    if (required.includes(job.name)) out.push(`${tag} carries the required name "${job.name}": only the summary job may`);
    for (const k of Object.keys(job.raw)) if (!['name', 'if', 'runs-on', 'timeout-minutes', 'strategy', 'steps', 'defaults', 'env', 'continue-on-error'].includes(k)) out.push(`${tag} has the job key "${k}", which this guard does not understand (a container or services change what runs)`);
    const strat = (job.raw.strategy || {}) as Record<string, unknown>;
    for (const k of Object.keys(strat)) if (!['fail-fast', 'matrix'].includes(k)) out.push(`${tag} has strategy.${k}, which this guard does not understand`);
    if (strat['fail-fast'] !== false) out.push(`${tag}: fail-fast is not false (one failed part would cancel the other and hide its failures)`);
    const wantIf = osName === 'macos-latest' ? MAC_IF : DRAFT_IF;
    if (flat(job.raw.if) !== wantIf) out.push(`${tag} has a condition other than the reviewed one (${osName === 'macos-latest' ? 'FR-106: not a draft, never on pull_request or merge_group' : 'not a draft PR'}): ${String(job.raw.if)}`);
    if (job.raw.defaults !== undefined) out.push(`${tag} has \`defaults\` (a working-directory or shell there changes what runs)`);
    if (job.raw.env !== undefined) out.push(`${tag} has job-level \`env\` (it reaches \`npm test\`; NODE_OPTIONS could change what runs)`);
    if (job.raw['continue-on-error'] !== undefined) out.push(`${tag} has continue-on-error`);
    const changes = job.steps.filter((s) => s.id === 'changes');
    const ch = changes[0];
    if (changes.length !== 1 || runOf(ch).trim() !== 'bash .github/scripts/ci-changes.sh' || ch.if !== undefined) out.push(`${tag}: the \`changes\` step is not the reviewed \`bash .github/scripts/ci-changes.sh\` with no condition: it decides whether \`npm test\` runs (a condition such as matrix.shard == 1 lets a part go green with no suites)`);
    else for (const k of Object.keys(ch)) if (!['id', 'shell', 'env', 'run'].includes(k) || (k === 'shell' && ch.shell !== 'bash') || (k === 'env' && (JSON.stringify(Object.keys(ch.env as object)) !== '["EVENT_NAME"]' || flat((ch.env as Record<string, unknown>).EVENT_NAME) !== '${{github.event_name}}'))) out.push(`${tag}: the \`changes\` step has the unreviewed key "${k}"`);
    const testAt = job.steps.findIndex((s) => runOf(s).trim() === 'npm test');
    for (const s of job.steps.slice(0, testAt)) if (/GITHUB_ENV|GITHUB_PATH/.test(runOf(s))) out.push(`${tag}: a step before \`npm test\` writes GITHUB_ENV or GITHUB_PATH (it can change what \`npm test\` runs): ${JSON.stringify(runOf(s).slice(0, 60))}`);
    for (const s of job.steps.slice(0, testAt)) { const w = preStepProblem(s); if (w) out.push(`${tag}: ${w}`); }
    const testSteps = job.steps.filter((s) => runOf(s).trim() === 'npm test');
    if (testSteps.length !== 1) out.push(`${tag} has ${testSteps.length} \`npm test\` steps, expected 1`);
    const step = testSteps[0];
    if (step['continue-on-error'] !== undefined) out.push(`${tag}: the \`npm test\` step has continue-on-error`);
    for (const k of Object.keys(step)) if (!PLAIN_KEYS.includes(k) && k !== 'continue-on-error') out.push(`${tag}: the \`npm test\` step has the key "${k}", which this guard does not understand (a working-directory or shell could change what runs)`);
    const env = (step.env || {}) as Record<string, unknown>;
    for (const k of Object.keys(env)) if (!ENV_KEYS.includes(k)) out.push(`${tag}: the \`npm test\` step sets env "${k}", which is not a reviewed key (${ENV_KEYS.join(', ')}): it could change what runs`);
    if (env.TEST_JOBS !== undefined && flat(env.TEST_JOBS) !== '4') out.push(`${tag}: TEST_JOBS is ${JSON.stringify(env.TEST_JOBS)}, expected 4 (the part runners have 4 vCPU; another count changes the load the suites were timed under)`);
    if (flat(env.TEST_SHARD) !== `\${{matrix.shard}}/${n}`) out.push(`${tag}: TEST_SHARD is ${JSON.stringify(env.TEST_SHARD)}, expected "\${{ matrix.shard }}/${n}" (the matrix has ${n} parts): a part count that differs from the matrix drops suites`);
    if (osName === 'ubuntu-latest' && env.PREREVIEW_REQUIRE_REAL_SDK !== '1') out.push(`${tag}: PREREVIEW_REQUIRE_REAL_SDK is not '1' (test:prereview would skip its real-SDK test on Linux)`);
    const stepIf = step.if;
    if (stepIf !== undefined && flat(stepIf) !== "steps.changes.outputs.code=='true'") out.push(`${tag}: the \`npm test\` step runs only under "${String(stepIf)}": a suite would be skipped in some part (only the docs-only skip "steps.changes.outputs.code == 'true'" is allowed)`);
  }

  // The summary: the one job that waits for the parts; its names are the required checks, it runs whatever the parts did (always()), and its own
  // script passes for an OS only when that OS's parts succeeded (run with bash below: a summary that lets a failed, cancelled or skipped part through dies by behaviour)
  const partIds = parts.map((j) => j.id).sort();
  const needsOf = (j: Job) => { const nd = j.raw.needs; return (Array.isArray(nd) ? nd : nd === undefined ? [] : [nd]).map(String); };
  const sums = jobs.filter((j) => !parts.includes(j) && needsOf(j).some((x) => partIds.includes(x)));
  if (sums.length !== 1) { out.push(`expected exactly one summary job that waits for the part jobs, found ${sums.length}`); return out; }
  const sum = sums[0];
  if (sum.matrixError) { out.push(`ci.yml is in a shape this guard does not understand: ${sum.matrixError}`); return out; }
  const names = jobNames(sum);
  for (const nm of names) if (!required.includes(nm)) out.push(`the summary job is named "${nm}", which is not a required check (required: ${required.join('; ')})`);
  for (const nm of buildReq) if (!names.includes(nm)) out.push(`required check "${nm}" has no summary job: the summary's matrix lacks that OS`);
  if (JSON.stringify(needsOf(sum).sort()) !== JSON.stringify(partIds)) out.push(`the summary job needs ${JSON.stringify(needsOf(sum))}, expected exactly the part jobs ${JSON.stringify(partIds)}`);
  if (flat(sum.raw.if) !== '${{always()&&!github.event.pull_request.draft}}') out.push(`the summary job's if is ${JSON.stringify(sum.raw.if)}, expected "\${{ always() && !github.event.pull_request.draft }}": without always() a failed or cancelled part can SKIP the summary, and GitHub counts a skipped required check as passing`);
  if (sum.raw['continue-on-error'] !== undefined) out.push('the summary job has continue-on-error');
  if (JSON.stringify(sum.raw.permissions) !== '{}') out.push(`the summary job's permissions are ${JSON.stringify(sum.raw.permissions)}, expected {} (it reads only the needs results)`);
  if (sum.steps.length !== 1 || typeof sum.steps[0].run !== 'string' || sum.steps[0].shell !== 'bash' || sum.steps[0].if !== undefined || sum.steps[0]['continue-on-error'] !== undefined) { out.push('the summary job is not one bash step with no condition'); return out; }
  const senv = (sum.steps[0].env || {}) as Record<string, unknown>;
  const keyOf: Record<string, string> = {};
  for (const j of parts) {
    const k = Object.keys(senv).find((x) => flat(senv[x]) === `\${{needs.${j.id}.result}}`);
    if (!k) out.push(`the summary step does not read needs.${j.id}.result`); else keyOf[String(j.raw['runs-on'])] = k;
  }
  if (flat(senv.OS) !== '${{matrix.os}}' || flat(senv.EVENT_NAME) !== '${{github.event_name}}') out.push('the summary step does not read OS from matrix.os and EVENT_NAME from github.event_name');
  if (!canRun || Object.keys(keyOf).length !== parts.length) return out;
  const script = sum.steps[0].run as string;
  for (const osName of Object.keys(keyOf)) {
    for (const event of ['push', 'pull_request']) {
      if (osName === 'macos-latest' && event === 'pull_request') continue; // FR-106: the macOS parts are skipped on purpose there (test:ci-shards covers that branch)
      for (const r of ['success', 'failure', 'cancelled', 'skipped', '']) {
        const results = Object.fromEntries(Object.entries(keyOf).map(([o, k]) => [k, o === osName ? r : 'success']));
        const passes = summaryPasses(script, osName, event, results);
        if (passes !== (r === 'success')) out.push(`the summary for ${osName} on ${event} ${passes ? 'passes' : 'fails'} when its parts are "${r || 'none'}": it must pass only when every part succeeded`);
      }
    }
  }
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
let mutants = 0;
function mutant(label: string, change: (io: typeof live) => typeof live, expect: RegExp) {
  mutants++;
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
mutant('npm test is not the runner', (io) => ({ ...io, pkgScripts: { ...io.pkgScripts, test: 'node scripts/run-tests.js redact' } }), /"test" is not "node scripts\/run-tests\.js"/);
mutant('the spec table loses a required row', (io) => ({ ...io, spec: swap(io.spec, '| Build and test (windows-latest) | yes |', '| Build and test (windows-latest) | no |') }), /records 2 required/);
mutant('a listed suite that is not a script', (io) => ({ ...io, suites: io.suites + '\ntest:no-such-suite\n' }), /test:no-such-suite, which is not a package\.json script/);

// the summary stops carrying the required names, or stops deciding them
const SUM_IF = 'if: ${{ always() && !github.event.pull_request.draft }}';
mutant('summary renamed to an unrequired name', (io) => ({ ...io, ci: swap(io.ci, 'name: Build and test (${{ matrix.os }})', 'name: Unit tests (${{ matrix.os }})') }), /summary job is named "Unit tests \(windows-latest\)", which is not a required check/);
mutant('summary named without the OS', (io) => ({ ...io, ci: swap(io.ci, 'name: Build and test (${{ matrix.os }})', 'name: Build and test') }), /summary job is named "Build and test", which is not a required check/);
mutant('Windows leaves the summary matrix', (io) => ({ ...io, ci: swap(io.ci, 'os: [ubuntu-latest, windows-latest, macos-latest]', 'os: [ubuntu-latest, macos-latest]') }), /required check "Build and test \(windows-latest\)" has no summary job/);
mutant('the summary does not wait for Windows', (io) => ({ ...io, ci: swap(io.ci, 'needs: [test-ubuntu, test-windows, test-macos]', 'needs: [test-ubuntu, test-macos]') }), /summary job needs \["test-ubuntu","test-macos"\], expected exactly the part jobs/);
mutant("the summary's if removed (a failed part skips it: skipped counts as passing)", (io) => ({ ...io, ci: swap(io.ci, `    ${SUM_IF}\n`, '') }), /without always\(\) a failed or cancelled part can SKIP the summary/);
mutant('the summary under !cancelled()', (io) => ({ ...io, ci: swap(io.ci, SUM_IF, 'if: ${{ !cancelled() && !github.event.pull_request.draft }}') }), /summary job's if is/);
mutant('the summary without permissions: {}', (io) => ({ ...io, ci: swap(io.ci, /(  build-test:[\s\S]*?)    permissions: \{\}\n/, '$1') }), /summary job's permissions are undefined/);
mutant('the summary continue-on-error', (io) => ({ ...io, ci: swap(io.ci, `    ${SUM_IF}\n`, `    ${SUM_IF}\n    continue-on-error: true\n`) }), /summary job has continue-on-error/);
mutant('the summary reads the wrong needs', (io) => ({ ...io, ci: swap(io.ci, 'WINDOWS: ${{ needs.test-windows.result }}', 'WINDOWS: ${{ needs.test-ubuntu.result }}') }), /summary step does not read needs\.test-windows\.result/);
if (canRun) {
  mutant('the summary ignores skipped parts', (io) => ({ ...io, ci: swap(io.ci, 'if [ "$result" != success ]; then', 'if [ "$result" != success ] && [ "$result" != skipped ]; then') }), /on push passes when its parts are "skipped"/);
  mutant('the summary ignores cancelled parts', (io) => ({ ...io, ci: swap(io.ci, 'if [ "$result" != success ]; then', 'if [ "$result" = failure ]; then') }), /passes when its parts are "cancelled"/);
  mutant('the summary passes with no part result', (io) => ({ ...io, ci: swap(io.ci, 'if [ "$result" != success ]; then', 'if [ -n "$result" ] && [ "$result" != success ]; then') }), /passes when its parts are "none"/);
  mutant('the Windows summary reads the Ubuntu result in its script', (io) => ({ ...io, ci: swap(io.ci, 'windows-latest) result="$WINDOWS" ;;', 'windows-latest) result="$UBUNTU" ;;') }), /summary for windows-latest on push passes when its parts are "failure"/);
}

// the parts: one per OS, on that OS, every part really running the whole of its share
mutant('a part takes a required name', (io) => ({ ...io, ci: swap(io.ci, 'name: Build and test (windows-latest) part ${{ matrix.shard }}/2', 'name: Build and test (windows-latest)') }), /carries the required name "Build and test \(windows-latest\)"/);
mutant('Windows parts removed', (io) => ({ ...io, ci: swap(io.ci, /  test-windows:\n[\s\S]*?(?=\n  # FR-106: no macOS runner)/, '') }), /required check "Build and test \(windows-latest\)" has 0 part jobs/);
mutant('a second job also runs npm test on Linux', (io) => ({ ...io, ci: io.ci + '\n  shadow:\n    name: Shadow\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' }), /"Build and test \(ubuntu-latest\)" has 2 part jobs/);
mutant('Windows parts on a Linux runner', (io) => ({ ...io, ci: swap(io.ci, 'runs-on: windows-latest', 'runs-on: ubuntu-latest') }), /"Build and test \(windows-latest\)" has 0 part jobs/);
mutant('a part on an OS no check names', (io) => ({ ...io, ci: swap(io.ci, 'runs-on: windows-latest', 'runs-on: windows-2019') }), /runs `npm test` on "windows-2019", which no required "Build and test" check names/);
mutant('only part 1 in the matrix, TEST_SHARD still /2', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:[\s\S]*?shard: )\[1, 2\]/, '$1[1]') }), /test-windows\): TEST_SHARD is "\$\{\{ matrix\.shard \}\}\/2", expected "\$\{\{ matrix\.shard \}\}\/1"/);
mutant('a third part, TEST_SHARD still /2', (io) => ({ ...io, ci: swap(io.ci, /(  test-ubuntu:[\s\S]*?shard: )\[1, 2\]/, '$1[1, 2, 3]') }), /test-ubuntu\): TEST_SHARD is .* expected "\$\{\{ matrix\.shard \}\}\/3"/);
mutant('a gap in the parts', (io) => ({ ...io, ci: swap(io.ci, /(  test-macos:[\s\S]*?shard: )\[1, 2\]/, '$1[1, 3]') }), /matrix\.shard is \[1,3\], expected/);
mutant('TEST_SHARD removed (every part runs everything, or nothing is split)', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:[\s\S]*?)        env:\n          TEST_SHARD: [^\n]*\n(?:          # spec 117 T070[^\n]*\n          TEST_JOBS: 4\n)?/, '$1') }), /test-windows\): TEST_SHARD is undefined/);
mutant('a part with fail-fast', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:[\s\S]*?fail-fast: )false/, '$1true') }), /test-windows\): fail-fast is not false/);
mutant('a part with a container', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:\n)/, '$1    container: node:22\n') }), /has the job key "container"/);
mutant('the macOS parts also on pull requests', (io) => ({ ...io, ci: swap(io.ci, " && github.event_name != 'pull_request' && github.event_name != 'merge_group' }}", ' }}') }), /macos-latest part job \(test-macos\) has a condition other than the reviewed one \(FR-106/);
mutant('Ubuntu loses PREREVIEW_REQUIRE_REAL_SDK', (io) => ({ ...io, ci: swap(io.ci, "PREREVIEW_REQUIRE_REAL_SDK: '1'", "PREREVIEW_REQUIRE_REAL_SDK: ''") }), /PREREVIEW_REQUIRE_REAL_SDK is not '1'/);
// `npm test` no longer runs the whole share, or not everywhere
mutant('npm test with a name filter', (io) => ({ ...io, ci: swap(io.ci, /run: npm test\n/, 'run: npm test -- folders\n') }), /mentions `npm test` in a shape this guard does not understand/);
mutant('npm test step skipped in one part', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:[\s\S]*?- if: )steps\.changes\.outputs\.code == 'true'(\n        env:\n          TEST_SHARD)/, "$1steps.changes.outputs.code == 'true' && matrix.shard == 1$2") }), /test-windows\): the `npm test` step runs only under/);
mutant('npm test step continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(\n        run: npm test\n)/, '\n        continue-on-error: true$1') }), /the `npm test` step has continue-on-error/);
mutant('part job continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(    runs-on: windows-latest\n)/, '$1    continue-on-error: true\n') }), /test-windows\) has continue-on-error/);
mutant('part job only on some condition', (io) => ({ ...io, ci: swap(io.ci, /(  test-ubuntu:\n    name: [^\n]*\n)    if: [^\n]*\n/, "$1    if: ${{ github.event_name == 'push' }}\n") }), /test-ubuntu\) has a condition other than the reviewed one/);
mutant('the npm test step is an echo', (io) => ({ ...io, ci: swap(io.ci, '        run: npm test\n', '        run: echo npm test\n') }), /mentions `npm test` in a shape this guard does not understand/);

// Windows checkouts have CRLF: the same files with CRLF endings pass the same rules and the same mutants die
{
  const crlf = (t: string) => t.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(problems({ ...live, ci: crlf(live.ci), spec: crlf(live.spec), suites: crlf(live.suites) }), [], 'CRLF files pass');
  assert.deepStrictEqual(norm(crlf(live.ci)), live.ci, 'norm undoes CRLF');
  assert.ok(problems({ ...live, ci: crlf(swap(live.ci, /run: npm test\n/, 'run: npm test -- folders\n')) }).length > 0, 'a CRLF mutant still dies');
}

// valid YAML shapes the guard does not read must FAIL, never pass (fail closed); each is a fixture and has its own message
const U_IF = '    if: ${{ !github.event.pull_request.draft }}\n    runs-on: ubuntu-latest\n';
const LAST_STEP = '          PATH="$RUNNER_TEMP/art/bin:$PATH" DURBAR_REQUIRE_PILLOW=1 npm run test:realoffice-assets\n';
mutant('job-level if placed after steps', (io) => ({ ...io, ci: swap(swap(io.ci, U_IF, '    runs-on: ubuntu-latest\n'), LAST_STEP, LAST_STEP + "    if: ${{ github.event_name == 'push' }}\n") }), /test-ubuntu\) has a condition other than the reviewed one/);
mutant('job-level continue-on-error placed after steps', (io) => ({ ...io, ci: swap(io.ci, LAST_STEP, LAST_STEP + '    continue-on-error: true\n') }), /test-ubuntu\) has continue-on-error/);
mutant('a step named npm test whose run is filtered', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        name: npm test\n        run: npm test -- folders\n') }), /mentions `npm test` in a shape this guard does not understand/);
mutant('a comment ending in npm test over a filtered run', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: npm test -- folders # npm test\n') }), /mentions `npm test` in a shape/);
mutant('a run block where a later command hides a failed npm test', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: |\n          npm test\n          true\n') }), /mentions `npm test` in a shape/);
mutant('npm test chained with || true', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: npm test || true\n') }), /mentions `npm test` in a shape/);
mutant('a folded multi-line run', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        run: >-\n          npm test\n          -- folders\n') }), /mentions `npm test` in a shape/);
mutant('a YAML anchor', (io) => ({ ...io, ci: swap(io.ci, 'fail-fast: false\n      matrix:', 'fail-fast: &ff false\n      matrix:') }), /anchors, aliases or merge keys/);
mutant('a YAML alias', (io) => ({ ...io, ci: swap(swap(io.ci, 'fail-fast: false\n      matrix:', 'fail-fast: &ff false\n      matrix:'), /(  test-windows:[\s\S]*?fail-fast: )false/, '$1*ff') }), /anchors, aliases or merge keys/);
mutant('flow style steps', (io) => ({ ...io, ci: swap(io.ci, '    steps:\n      - name: Every part', '    steps:\n      - { run: echo hi }\n      - name: Every part') }), /flow style/);
mutant('a matrix exclude drops a part', (io) => ({ ...io, ci: swap(io.ci, '      matrix:\n        shard: [1, 2]', '      matrix:\n        exclude:\n          - shard: 2\n        shard: [1, 2]') }), /strategy\.matrix\.exclude is not read/);
mutant('the npm test step runs in another folder', (io) => ({ ...io, ci: swap(io.ci, /        run: npm test\n/, '        working-directory: scripts\n        run: npm test\n') }), /has the key "working-directory"/);
mutant('a computed matrix', (io) => ({ ...io, ci: swap(io.ci, '      matrix:\n        shard: [1, 2]', '      matrix: ${{ fromJSON(needs.x.outputs.m) }}\n      zz:\n        shard: [1, 2]') }), /strategy\.matrix is not a mapping/);
mutant('a workflow that does not parse', (io) => ({ ...io, ci: io.ci + '\n  bad: [unclosed\n' }), /not understand/);

// the changes step decides whether npm test runs in each part: pinned (review of #2031: under `if: matrix.shard == 1` part 2 went green with no suites)
mutant('the Windows changes step only in part 1', (io) => ({ ...io, ci: swap(io.ci, /(  test-windows:[\s\S]*?      - id: changes\n)/, '$1        if: matrix.shard == 1\n') }), /test-windows\): the `changes` step is not the reviewed .* with no condition/);
mutant('the changes step replaced by one that writes code=false', (io) => ({ ...io, ci: swap(io.ci, '        run: bash .github/scripts/ci-changes.sh\n', '        run: echo code=false >> "$GITHUB_OUTPUT"\n') }), /`changes` step is not the reviewed/);
mutant('the changes step has a second key', (io) => ({ ...io, ci: swap(io.ci, '        run: bash .github/scripts/ci-changes.sh\n', '        continue-on-error: true\n        run: bash .github/scripts/ci-changes.sh\n') }), /`changes` step has the unreviewed key "continue-on-error"/);
mutant('the changes step with another shell', (io) => ({ ...io, ci: swap(io.ci, '        shell: bash\n        env:\n          EVENT_NAME', '        shell: pwsh\n        env:\n          EVENT_NAME') }), /`changes` step has the unreviewed key "shell"/);
mutant('the changes step with an extra env key', (io) => ({ ...io, ci: swap(io.ci, '          EVENT_NAME: ${{ github.event_name }}\n        run: bash .github/scripts/ci-changes.sh', '          EVENT_NAME: ${{ github.event_name }}\n          NODE_OPTIONS: --require ./x.js\n        run: bash .github/scripts/ci-changes.sh') }), /`changes` step has the unreviewed key "env"/);
mutant('the changes step reads another event', (io) => ({ ...io, ci: swap(io.ci, '          EVENT_NAME: ${{ github.event_name }}\n        run: bash .github/scripts/ci-changes.sh', "          EVENT_NAME: pull_request\n        run: bash .github/scripts/ci-changes.sh") }), /`changes` step has the unreviewed key "env"/);
// nothing may change what npm test runs
const W_RUNS_ON = '    runs-on: windows-latest\n';
mutant('job-level defaults working-directory', (io) => ({ ...io, ci: swap(io.ci, W_RUNS_ON, W_RUNS_ON + '    defaults:\n      run:\n        working-directory: scripts\n') }), /test-windows\) has `defaults`/);
mutant('workflow-level defaults', (io) => ({ ...io, ci: swap(io.ci, /^jobs:\n/m, 'defaults:\n  run:\n    working-directory: scripts\njobs:\n') }), /top-level `defaults`/);
mutant('workflow-level env', (io) => ({ ...io, ci: swap(io.ci, /^jobs:\n/m, 'env:\n  NODE_OPTIONS: --max-old-space-size=1\njobs:\n') }), /top-level `env`/);
mutant('job-level env NODE_OPTIONS', (io) => ({ ...io, ci: swap(io.ci, W_RUNS_ON, W_RUNS_ON + '    env:\n      NODE_OPTIONS: --require ./x.js\n') }), /test-windows\) has job-level `env`/);
mutant('TEST_JOBS set to another count', (io) => ({ ...io, ci: swap(io.ci, '          TEST_JOBS: 4', '          TEST_JOBS: 64') }), /TEST_JOBS is 64, expected 4/);
mutant('NODE_OPTIONS on the npm test step', (io) => ({ ...io, ci: swap(io.ci, "          PREREVIEW_REQUIRE_REAL_SDK: '1'", "          NODE_OPTIONS: --require ./x.js\n          PREREVIEW_REQUIRE_REAL_SDK: '1'") }), /sets env "NODE_OPTIONS"/);
mutant('a step before npm test writes GITHUB_ENV', (io) => ({ ...io, ci: swap(io.ci, "      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n", "      - run: echo NODE_OPTIONS=--require=./x.js >> \"$GITHUB_ENV\"\n      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n") }), /writes GITHUB_ENV or GITHUB_PATH/);

// the steps before npm test are pinned: nothing else may set the job's environment
const BUILD = "      - if: steps.changes.outputs.code == 'true'\n        run: npm run build\n";
const pre = (step: string) => (io: typeof live) => ({ ...io, ci: swap(io.ci, BUILD, step + BUILD) });
mutant('a step before npm test writes GITHUB_PATH', pre('      - run: echo "$PWD/evil" >> "$GITHUB_PATH"\n'), /writes GITHUB_ENV or GITHUB_PATH/);
mutant('github-script exports a variable', pre("      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea\n        with:\n          script: core.exportVariable('NODE_OPTIONS', '--require ./x.js')\n"), /an action that is not on the reviewed list/);
mutant('a local action before npm test', pre('      - uses: ./.github/actions/evil\n'), /an action that is not on the reviewed list/);
mutant('a GITHUB_ENV name built at run time', pre('      - run: |\n          n=GITHUB_E; echo "NODE_OPTIONS=--require ./x.js" >> "${!n}"\n'), /a run that is not on the reviewed list/);
mutant('an echo step before npm test (the old macOS notice shape is no longer allowed)', pre('      - run: echo "hi" | tee -a "$GITHUB_STEP_SUMMARY"\n'), /a run that is not on the reviewed list/);
mutant('checkout with an extra input', (io) => ({ ...io, ci: swap(io.ci, '          fetch-depth: 2\n', '          fetch-depth: 2\n          path: elsewhere\n') }), /with\.path/);
mutant('setup-node at another commit', (io) => ({ ...io, ci: swap(io.ci, 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@0000000000000000000000000000000000000000') }), /an action that is not on the reviewed list/);
mutant('a pre-test step with a shell override', pre('      - shell: pwsh\n        run: npm run build\n'), /shell is not bash/);
// the local npm-ci action runs before npm test: pinned too
mutant('npm-ci gains a step that writes GITHUB_ENV', (io) => ({ ...io, npmci: io.npmci + '    - shell: bash\n      run: echo NODE_OPTIONS=x >> "$GITHUB_ENV"\n' }), /the npm-ci action has a step that is not a reviewed shape/);
mutant('npm-ci retry loop edited', (io) => ({ ...io, npmci: swap(io.npmci, '        tries=$(( ${#waits[@]} + 1 ))\n', '        tries=$(( ${#waits[@]} + 1 ))\n        echo NODE_OPTIONS=x >> "$GITHUB_ENV"\n') }), /npm ci retry loop is pinned by hash/);
mutant('npm-ci uses another action', (io) => ({ ...io, npmci: swap(io.npmci, 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9', 'actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea') }), /npm-ci action has a step that is not a reviewed shape \(an action/);
mutant('npm-ci is not a composite action', (io) => ({ ...io, npmci: swap(io.npmci, 'using: composite', 'using: node22') }), /not a composite action/);

console.log(`ci required suites: ok (${live.suites.split('\n').filter((l) => /^test:/.test(l)).length} suites, ${maskSuites.length} masking, ${mutants} mutants${canRun ? '' : '; the summary script was not run (Windows, no bash assumed): its wiring was checked'})`);
