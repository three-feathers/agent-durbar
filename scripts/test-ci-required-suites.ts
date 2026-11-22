/**
 * Guard test (spec 117 FR-018, T022; constitution I and III): every suite in scripts/test-suites.txt, the redact and mask suites above all,
 * runs in a job whose name is a REQUIRED check, on every OS it runs on today. Reads only: the required list is the one recorded in the
 * spec's O1 table (read from the `main` ruleset on 2026-11-22; this test never calls GitHub and changes no setting), the jobs are read from
 * .github/workflows/ci.yml. Moving a suite (a masking one most of all) to a job that is not required would let a PR merge with that suite
 * red, so each way of doing it is a mutant below that must fail at its own assert.
 *
 * The line-based reader below understands the shape of ci.yml (jobs at two spaces, steps at six); a shape it does not understand
 * makes the check fail loudly, never pass. The summary-job rules of T022 (a failed, skipped or cancelled shard; `if: !cancelled()`)
 * land with the Windows split, if it is ever needed: there is no summary job today.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
interface Job { id: string; name: string; raw: Record<string, unknown>; steps: Step[]; oses: string[]; matrixError?: string }
/** YAML shapes the guard does not read (it fails closed on them: a person must extend the guard, a workflow may not slip past it). */
export function unsupportedShapes(wf: string): string[] {
  const out: string[] = [];
  const code = norm(wf).split('\n').filter((l) => !/^\s*#/.test(l));
  if (code.some((l) => /(^|[:,\[{-]\s+)[&*][\w-]+/.test(l) || /^\s*<<\s*:/.test(l))) out.push('the workflow uses YAML anchors, aliases or merge keys (not read by this guard)');
  if (code.some((l) => /^\s*-\s*[{[]/.test(l) || /^\s*(steps|jobs|include|strategy|matrix)\s*:\s*[{[]/.test(l))) out.push('the workflow uses flow style (braces or brackets) for jobs, steps or the matrix (not read by this guard)');
  return out;
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
        else oses.push(...(m.include as { os: string }[]).map((e) => e.os));
      }
    }
    jobs.push({ id, name, raw, steps: steps as Step[], oses, matrixError });
  }
  return jobs;
}

/** The names a job's `name:` becomes: `${{ matrix.os }}` is replaced by each matrix os. */
export function jobNames(job: Job): string[] {
  return /\$\{\{\s*matrix\.os\s*\}\}/.test(job.name) ? job.oses.map((o) => job.name.replace(/\$\{\{\s*matrix\.os\s*\}\}/g, o)) : [job.name];
}

const MASK = /redact|mask/i;
const RUNS_NPM_TEST = /\bnpm\s+test\b/;
const runOf = (s: Step) => (typeof s.run === 'string' ? s.run : '');

/** Every way the guard can fail, as sentences; empty when the rules hold. */
export function problems(io: { ci: string; spec: string; suites: string; pkgScripts: Record<string, string> }): string[] {
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
  for (const j of jobs) for (const s of j.steps) {
    if (RUNS_NPM_TEST.test(runOf(s)) && runOf(s).trim() !== 'npm test') out.push(`job ${j.id} has a step whose run mentions \`npm test\` in a shape this guard does not understand (a filter, a chain or several lines): ${JSON.stringify(runOf(s))}`);
  }
  const full = jobs.filter((j) => j.steps.some((s) => runOf(s).trim() === 'npm test'));
  if (full.length !== 1) { out.push(`expected exactly one ci.yml job that runs plain \`npm test\`, found ${full.length}`); return out; }
  const job = full[0];
  if (job.matrixError) { out.push(`ci.yml is in a shape this guard does not understand: ${job.matrixError}`); return out; }
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
  const stepIf = step.if;
  if (stepIf !== undefined && String(stepIf).replace(/\s+/g, '') !== "steps.changes.outputs.code=='true'") out.push(`the \`npm test\` step runs only under "${String(stepIf)}": a suite would be skipped on some OS (only the docs-only skip "steps.changes.outputs.code == 'true'" is allowed)`);
  return out;
}

const live = { ci: read('.github/workflows/ci.yml'), spec: read('specs/117-delivery-speed-2/spec.md'), suites: read('scripts/test-suites.txt'), pkgScripts: JSON.parse(read('package.json')).scripts as Record<string, string> };

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

console.log(`ci required suites: ok (${live.suites.split('\n').filter((l) => /^test:/.test(l)).length} suites, ${maskSuites.length} masking, 27 mutants)`);
