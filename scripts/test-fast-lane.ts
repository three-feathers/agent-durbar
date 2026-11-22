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
const norm = (t: string) => t.replace(/\r\n?/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// the runner: only list names, in list order, as run-tests.js loads them
const fake = { scripts: { 'test:a': 'tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-a.js', 'test:b': 'node scripts/test-b.js && node scripts/b.js' } };
const got = fl.pickSuites(['test:b', 'test:a'], fake, ['test:a', 'test:b']);
assert.deepStrictEqual(got.map((s) => s.name), ['test:a', 'test:b'], 'suites run in list order');
assert.deepStrictEqual(got[1].steps, [['scripts/test-b.js'], ['scripts/b.js']], 'each suite keeps its own steps in order');
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
console.log(`fast-lane: ok (${mutants.length} workflow mutants caught)`);
