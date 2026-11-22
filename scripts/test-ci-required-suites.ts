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
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Names of the checks the spec records as required today: rows of the O1 table whose "Required today" cell starts with `yes`. */
export function requiredFromSpec(spec: string): string[] {
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

interface Job { id: string; name: string; text: string; steps: string[]; oses: string[] }
/** The jobs of a workflow file: id, name, the text, the step blocks and the `os:` values of its matrix. */
export function readJobs(wf: string): Job[] {
  const lines = wf.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const jobs: Job[] = [];
  let cur: string[] | null = null;
  let id = '';
  const flush = () => {
    if (!cur) return;
    const text = cur.join('\n');
    const nameLine = cur.find((l) => /^ {4}name:/.test(l));
    const name = nameLine ? nameLine.replace(/^ {4}name:\s*/, '').replace(/^["']|["']\s*$/g, '').trim() : id;
    const steps: string[] = [];
    let s: string[] | null = null;
    for (const l of cur) {
      if (/^ {6}- /.test(l)) { if (s) steps.push(s.join('\n')); s = [l]; } else if (s && (/^ {7,}/.test(l) || l.trim() === '' || /^ {0,6}#/.test(l))) s.push(l); else if (s && /^ {0,5}\S/.test(l)) { steps.push(s.join('\n')); s = null; }
    }
    if (s) steps.push(s.join('\n'));
    const oses = [...text.matchAll(/^\s+- os:\s*(\S+)/gm)].map((m) => m[1]);
    jobs.push({ id, name, text, steps, oses });
  };
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { flush(); id = m[1]; cur = []; continue; }
    if (/^\S/.test(l)) break; // another top-level key ends `jobs:`
    if (cur) cur.push(l);
  }
  flush();
  return jobs;
}

/** The names a job's `name:` becomes: `${{ matrix.os }}` is replaced by each matrix os. */
export function jobNames(job: Job): string[] {
  return /\$\{\{\s*matrix\.os\s*\}\}/.test(job.name) ? job.oses.map((o) => job.name.replace(/\$\{\{\s*matrix\.os\s*\}\}/g, o)) : [job.name];
}

const MASK = /redact|mask/i;
const FULL_NPM_TEST = /(^|\s|run:\s*)npm test\s*$/m;

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

  // the job that runs the whole list: plain `npm test`, under a required name on every OS
  const full = readJobs(io.ci).filter((j) => j.steps.some((s) => FULL_NPM_TEST.test(s)));
  if (full.length !== 1) { out.push(`expected exactly one ci.yml job that runs plain \`npm test\`, found ${full.length}`); return out; }
  const job = full[0];
  const names = jobNames(job);
  for (const n of names) if (!required.includes(n)) out.push(`the job that runs every suite is named "${n}", which is not a required check (required: ${required.join('; ')})`);
  for (const n of buildReq) if (!names.includes(n)) out.push(`required check "${n}" has no job running the suites: the matrix lacks that OS`);
  const jobIf = /^ {4}if:\s*(.+)$/m.exec(job.text.split(/^ {4}steps:/m)[0]);
  if (jobIf && jobIf[1].replace(/\s+/g, '') !== '${{!github.event.pull_request.draft}}') out.push(`the suite job has a condition other than "not a draft PR": ${jobIf[1]}`);
  if (/^ {4}continue-on-error:/m.test(job.text.split(/^ {4}steps:/m)[0])) out.push('the suite job has continue-on-error');
  const step = job.steps.find((s) => FULL_NPM_TEST.test(s)) as string;
  if (/continue-on-error/.test(step)) out.push('the `npm test` step has continue-on-error');
  const stepIf = /^\s*(?:- )?if:\s*(.+)$/m.exec(step);
  if (stepIf && stepIf[1].replace(/\s+/g, '') !== "steps.changes.outputs.code=='true'") out.push(`the \`npm test\` step runs only under "${stepIf[1]}": a suite would be skipped on some OS (only the docs-only skip "steps.changes.outputs.code == 'true'" is allowed)`);
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
mutant('npm test with a name filter', (io) => ({ ...io, ci: swap(io.ci, /run: npm test\n/, 'run: npm test -- folders\n') }), /exactly one ci\.yml job that runs plain `npm test`, found 0/);
mutant('npm test step skipped on one OS', (io) => ({ ...io, ci: swap(io.ci, /      - if: steps\.changes\.outputs\.code == 'true'\n        env:\n          # spec 103/, "      - if: steps.changes.outputs.code == 'true' && matrix.os != 'windows-latest'\n        env:\n          # spec 103") }), /step runs only under/);
mutant('npm test step continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(\n        run: npm test\n)/, '\n        continue-on-error: true$1') }), /`npm test` step has continue-on-error/);
mutant('suite job continue-on-error', (io) => ({ ...io, ci: swap(io.ci, /(    runs-on: \$\{\{ matrix\.runner \}\}\n)/, '$1    continue-on-error: true\n') }), /suite job has continue-on-error/);
mutant('suite job only on some condition', (io) => ({ ...io, ci: swap(io.ci, /(  build-test:\n    name: [^\n]*\n)    if: [^\n]*\n/, "$1    if: ${{ github.event_name == 'push' }}\n") }), /condition other than "not a draft PR"/);
mutant('a second job also runs npm test', (io) => ({ ...io, ci: io.ci + '\n  shadow:\n    name: Shadow\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' }), /exactly one ci\.yml job that runs plain `npm test`, found 2/);
mutant('npm test is not the runner', (io) => ({ ...io, pkgScripts: { ...io.pkgScripts, test: 'node scripts/run-tests.js redact' } }), /"test" is not "node scripts\/run-tests\.js"/);
mutant('the spec table loses a required row', (io) => ({ ...io, spec: swap(io.spec, '| Build and test (windows-latest) | yes |', '| Build and test (windows-latest) | no |') }), /records 2 required/);
mutant('a listed suite that is not a script', (io) => ({ ...io, suites: io.suites + '\ntest:no-such-suite\n' }), /test:no-such-suite, which is not a package\.json script/);

console.log(`ci required suites: ok (${live.suites.split('\n').filter((l) => /^test:/.test(l)).length} suites, ${maskSuites.length} masking, 15 mutants)`);
