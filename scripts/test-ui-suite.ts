/** Unit test (spec 008 FR-091): the ui-suite driver list is not stale, and the runner never uses a shell. No Electron is started. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'scripts', 'ui-suite.js');
const names = execFileSync(process.execPath, [SUITE, '--list'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
assert.ok(names.length >= 15, `ui-suite lists ${names.length} drivers`);
for (const n of names) {
  const file = n.split(' ')[0];
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', file + '.js')), `listed driver exists: ${file}`);
}
const src = fs.readFileSync(SUITE, 'utf8');
assert.ok(/shell: false/.test(src) && !/shell: true/.test(src) && !/execSync\(|exec\(/.test(src), 'the runner spawns without a shell');
assert.ok(/require\('electron'\)/.test(src), 'it starts the Electron binary directly');
// spec 008 FR-112: a syntax error fails at once (node --check, no shell) before any Electron starts
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { syntaxErrors } = require(SUITE) as { syntaxErrors: (f: string[]) => { file: string; error: string }[] };
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ui-suite-syntax-'));
  const good = path.join(tmp, 'good.js'), bad = path.join(tmp, 'bad.js');
  fs.writeFileSync(good, 'module.exports = async (ctx) => { await ctx.sleep(1); };\n');
  fs.writeFileSync(bad, 'module.exports = async (ctx) => { await ctx.sleep(1) ;\n');
  assert.deepStrictEqual(syntaxErrors([good]), [], 'a driver that parses passes');
  const errs = syntaxErrors([good, bad]);
  assert.ok(errs.length === 1 && errs[0].file.endsWith('bad.js') && /SyntaxError/.test(errs[0].error), 'a driver with a syntax error is reported with node\'s message');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.deepStrictEqual(syntaxErrors(names.map((n) => path.join(ROOT, 'scripts', n.split(' ')[0] + '.js')).concat(path.join(ROOT, 'scripts', 'driver-helpers.js'))), [], 'every listed driver and the helpers parse');
  assert.ok(src.indexOf('syntaxErrors([...new Set(') > 0 && src.indexOf('syntaxErrors([...new Set(') < src.indexOf('await Promise.all(Array.from({ length: jobs }, worker))'), 'the syntax pass runs before the first driver starts');
  // the real runner: a broken driver named with --only stops before Electron, at once, with the file and exit 1
}
// issue #748 (spec 021 FR-057): no asserting driver sits unrun. Every scripts/check-*.js and shots-*.js that asserts is in the suite, in
// shots-docs' DOC_SHOTS (retaken by `npm run shots:docs`), or in NOT_IN_SUITE with a written reason
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DRIVERS, NOT_IN_SUITE } = require(SUITE) as { DRIVERS: { name: string }[]; NOT_IN_SUITE: Record<string, string> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DOC_SHOTS } = require(path.join(ROOT, 'scripts', 'shots-docs.js')) as { DOC_SHOTS: { name: string }[] };
  const inSuite = new Set(DRIVERS.map((d) => d.name)), inDocs = new Set(DOC_SHOTS.map((d) => d.name));
  /** The names of the asserting drivers in `dir` that nothing runs and nothing explains. */
  const orphans = (dir: string, listed: Record<string, string>): string[] => fs.readdirSync(dir).filter((f) => /^(check|shots)-.+\.js$/.test(f))
    .map((f) => f.slice(0, -3))
    .filter((n) => /\bassert\b/.test(fs.readFileSync(path.join(dir, n + '.js'), 'utf8')) && !inSuite.has(n) && !inDocs.has(n) && !(n in listed));
  assert.deepStrictEqual(orphans(path.join(ROOT, 'scripts'), NOT_IN_SUITE), [], 'an asserting driver is in DRIVERS, in shots-docs DOC_SHOTS or in NOT_IN_SUITE with a reason (issue #748)');
  for (const [n, why] of Object.entries(NOT_IN_SUITE)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', n + '.js')), `NOT_IN_SUITE names a driver that exists: ${n}`);
    assert.ok(typeof why === 'string' && why.length >= 40, `NOT_IN_SUITE ${n} says why`);
    assert.ok(!inSuite.has(n) && !inDocs.has(n), `${n} is run, so it leaves NOT_IN_SUITE`);
  }
  // the guard itself: a new asserting driver that is not listed is found, a listed one is not (what the mutation check relies on)
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ui-suite-orphans-'));
  fs.writeFileSync(path.join(tmp, 'check-new.js'), "const assert = require('assert');\nmodule.exports = async () => { assert.ok(true); };\n");
  fs.writeFileSync(path.join(tmp, 'check-nothing.js'), 'module.exports = async () => {};\n');
  assert.deepStrictEqual(orphans(tmp, {}), ['check-new'], 'an asserting driver nobody lists is reported; a script without asserts is not');
  assert.deepStrictEqual(orphans(tmp, { 'check-new': 'a reason that is long enough to count here' }), [], 'and a listed one is not');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// spec 001 FR-082/FR-083: every screenshot the README and the website link is retaken by `npm run shots:docs`, or has a reason
{
  const DOCS = path.join(ROOT, 'scripts', 'shots-docs.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const docs = require(DOCS) as { coverage: () => { linked: string[]; uncovered: string[]; unlinked: string[]; explainedButMade: string[]; missingDrivers: string[] }; NO_DRIVER: Record<string, string> };
  const c = docs.coverage();
  assert.ok(c.linked.length >= 30, `the README, gallery and landing page link ${c.linked.length} screenshots`);
  assert.deepStrictEqual(c.uncovered, [], 'every linked screenshot has a driver in scripts/shots-docs.js DOC_SHOTS, or a reason in NO_DRIVER');
  assert.deepStrictEqual(c.unlinked, [], 'DOC_SHOTS retakes only linked screenshots');
  assert.deepStrictEqual(c.explainedButMade, [], 'a file is either retaken or explained, not both');
  assert.deepStrictEqual(c.missingDrivers, [], 'every driver in DOC_SHOTS exists');
  for (const [f, why] of Object.entries(docs.NO_DRIVER)) assert.ok(typeof why === 'string' && why.length >= 10, `NO_DRIVER ${f} says why`);
  for (const f of c.linked) assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'screenshots', f)), `linked screenshot exists: ${f}`);
  const dsrc = fs.readFileSync(DOCS, 'utf8');
  assert.ok(!/shell: true|execSync\(|exec\(/.test(dsrc) && /suite\.runOne/.test(dsrc), 'shots-docs starts drivers through ui-suite runOne, never a shell');
  assert.ok(/DURBAR_SIM_CLOCK: clock/.test(dsrc), 'shots-docs pins the page clock (FR-084)');
}
// spec 008 FR-136 (issue #922): a driver's window that closes fails the run, once per window; allow() is for a deliberate close; a normal end closes nothing
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { guardWindow } = require(path.join(ROOT, 'scripts', 'driver-helpers.js')) as { guardWindow: (w: unknown, fail: (m: string) => void, app?: unknown) => { allow: () => void } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events');
  type Setup = (w: InstanceType<typeof EventEmitter>, a: InstanceType<typeof EventEmitter>, g: { allow: () => void }) => void;
  const run = (setup: Setup): string[] => {
    const w = new EventEmitter(), a = new EventEmitter(), fails: string[] = [];
    setup(w, a, guardWindow(w, (m) => fails.push(m), a));
    return fails;
  };
  assert.strictEqual(run(() => undefined).length, 0, 'a driver that ends normally (no close) is not a failure');
  assert.strictEqual(run((w) => w.emit('closed')).length, 0, 'the window closing alone (the normal end: app.exit) is not a failure; the quit-less exit never emits window-all-closed');
  const closed = run((w, a) => { w.emit('closed'); a.emit('window-all-closed'); });
  assert.ok(closed.length === 1 && /DRIVER FAILED/.test(closed[0]) && /window closed/.test(closed[0]), 'a closed window that ends the app fails with a clear DRIVER FAILED message');
  assert.strictEqual(run((w, a, g) => { g.allow(); w.emit('closed'); a.emit('window-all-closed'); }).length, 0, 'allow() before a deliberate close: no failure');
  assert.strictEqual(run((w, a) => { a.emit('window-all-closed'); w.emit('closed'); }).length, 0, 'window-all-closed from another window is not this one closing');
  { const w = new EventEmitter(), a = new EventEmitter(), fails: string[] = []; guardWindow(w, (m) => fails.push(m), a); guardWindow(w, (m) => fails.push(m), a); w.emit('closed'); a.emit('window-all-closed'); assert.strictEqual(fails.length, 1, 'helpers() twice on one window reports once'); }
  assert.doesNotThrow(() => guardWindow(undefined, () => undefined), 'no window, no guard');
  const dh = fs.readFileSync(path.join(ROOT, 'scripts', 'driver-helpers.js'), 'utf8');
  assert.ok(/function waits\(ctx\) \{\s*guardWindow\(ctx\.win\)/.test(dh), 'waits(ctx) arms the guard, so every driver (helpers() calls waits) is covered');
  // every ui-suite driver takes its waits from the shared helpers, so none escapes the guard
  for (const n of new Set(names.map((x) => x.split(' ')[0]))) assert.ok(/driver-helpers/.test(fs.readFileSync(path.join(ROOT, 'scripts', n + '.js'), 'utf8')), `driver ${n} uses the shared helpers (and so the window guard)`);
}
const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
assert.ok(/app\.exit\(failed \? 1 : 0\)/.test(main), 'a failing driver exits 1 (FR-090)');
assert.ok(/dev\.DURBAR_DRIVER \|\| dev\.DURBAR_SHOT \? \{ enableLargerThanScreen: true \}/.test(main), 'test windows may be larger than the screen (FR-093, macOS runners)');
// ---- CI layout (spec 008 FR-104..FR-110, owner decision 2026-10-22): few runner tickets per PR, every check still somewhere ----
const WF = path.join(ROOT, '.github', 'workflows');
const ci = fs.readFileSync(path.join(WF, 'ci.yml'), 'utf8');
/** The `jobs:` blocks of a workflow, by job id (2-space keys under `jobs:`). */
const jobsOf = (y: string): Record<string, string> => {
  const body = y.slice(y.search(/^jobs:/m));
  const out: Record<string, string> = {};
  const re = /^ {2}([\w-]+):\r?\n([\s\S]*?)(?=^ {2}[\w-]+:\r?\n|(?![\s\S]))/gm;
  for (let m = re.exec(body); m; m = re.exec(body)) out[m[1]] = m[2];
  return out;
};
const ciJobs = jobsOf(ci);
// FR-104: no separate "What changed" job, and no job waits for another one in a pull request
assert.ok(!ciJobs.changes && !/needs:/.test(ci), 'ci.yml: no changes job and no needs (each job decides what to run itself)');
for (const j of ['build-test', 'package-smoke', 'office-check']) assert.ok(ciJobs[j] && ciJobs[j].includes('bash .github/scripts/ci-changes.sh') && ciJobs[j].includes('fetch-depth: 2'), `ci.yml ${j} works out what changed inline`);
const changes = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.sh'), 'utf8');
assert.ok(changes.includes('git diff --name-only HEAD^1 HEAD') && /"\$\{EVENT_NAME:-\}" != "pull_request"/.test(changes), 'ci-changes.sh: diff of the test merge commit on PRs, everything on other events');
// the required check names of the main ruleset still report on every pull request
for (const name of ['name: Build and test (${{ matrix.os }})', 'name: Package smoke (unpacked Linux app)', 'name: Office layout check (xvfb)']) assert.ok(ci.includes(name), `ci.yml keeps the required check ${name}`);
const bt = ciJobs['build-test'];
for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) assert.ok(bt.includes(`- os: ${os}`), `Build and test reports for ${os}`);
// FR-106: macOS is a report-only Linux job on pull requests and merge queue entries, the real build and test on every other event
assert.ok(bt.includes(`runner: \${{ (github.event_name == 'pull_request' || github.event_name == 'merge_group') && 'ubuntu-latest' || 'macos-latest' }}`) && bt.includes(`real: \${{ (github.event_name == 'pull_request' || github.event_name == 'merge_group') && 'no' || 'yes' }}`), 'macOS build and test: Linux report on PR and queue, real macOS otherwise');
assert.ok(/^ {2}schedule:/m.test(ci) && /^ {2}push:\r?\n {4}branches: \[main\]/m.test(ci), 'ci.yml runs nightly and on pushes to main (where macOS really runs)');
// FR-105: one office job runs theme geometry and the whole office layout in parallel parts
const office = ciJobs['office-check'];
assert.ok(office.includes('node scripts/check-theme-geometry.js') && office.includes('node scripts/check-parallel.js') && /CHECK_SHARDS: '\d+'/.test(office) && office.includes(`CHECK_MOTION: '1'`), 'ci.yml: one office job, geometry and all parts, motion on');
// FR-108: ui-platforms is one job per OS with every check; macOS nightly and by hand
const wf = fs.readFileSync(path.join(WF, 'ui-platforms.yml'), 'utf8');
for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(wf.includes(os), `the workflow runs on ${os}`);
for (const step of ['check-theme-geometry.js', 'check-office-overlap.js', 'check-mac-titlebar.js', 'ui-suite.js']) assert.ok(wf.includes(step), `the workflow runs ${step}`);
assert.ok(!/part:/.test(wf) && !/OFFICE_SHARD/.test(wf), 'one job per OS: the office layout runs whole, no parts');
assert.ok(wf.includes(`os: \${{ fromJSON((github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && '["ubuntu-latest","macos-latest","windows-latest"]' || '["ubuntu-latest","windows-latest"]') }}`), 'macOS UI checks only nightly and by hand');
assert.ok(/^ {2}schedule:/m.test(wf), 'ui-platforms.yml runs nightly');
assert.ok(wf.includes("OFFICE_HERE: ${{ (matrix.os != 'ubuntu-latest' || (github.event_name != 'pull_request' && github.event_name != 'push'))"), 'Linux skips the office layout here only for the events where ci.yml runs it');
// FR-098: every workflow with a required check also runs on merge queue entries
const sk = fs.readFileSync(path.join(WF, 'spec-kit.yml'), 'utf8');
for (const [f, y] of [['ci.yml', ci], ['spec-kit.yml', sk]]) assert.ok(/^ {2}merge_group:/m.test(y), `${f} runs on merge_group`);
// FR-109: the Spec Kit gate re-runs on description edits (Spec-Exempt line), not on label changes
assert.ok(/types: \[opened, synchronize, reopened, edited, ready_for_review\]/.test(sk) && !/types: \[[^\]]*labeled/.test(sk), 'spec-kit.yml: edited yes, labeled/unlabeled no');
// FR-107: pull request workflows skip drafts, run again when marked ready, and cancel superseded runs, never runs on main
for (const f of ['ci.yml', 'ui-platforms.yml', 'spec-kit.yml', 'install-check.yml', 'installed-app.yml', 'packaged-check.yml', 'pages.yml', 'macos-pr.yml']) {
  const y = fs.readFileSync(path.join(WF, f), 'utf8');
  assert.ok(/^ {2}pull_request:\r?\n {4}types: \[[^\]]*ready_for_review\]/m.test(y), `${f}: runs again when a draft is marked ready`);
  const jobs = jobsOf(y);
  for (const [id, body] of Object.entries(jobs)) if (!/^ {4}needs:/m.test(body)) assert.ok(/^ {4}if: (.*!github\.event\.pull_request\.draft|github\.event_name == 'workflow_dispatch' && )/m.test(body), `${f} ${id}: skipped on a draft (or never on a PR)`);
  assert.ok(/group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.(run_id|ref) \}\}/.test(y) && /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/.test(y), `${f}: one concurrency group per PR, cancelling only PR runs`);
}
// FR-135: the real macOS build and test runs on a pull request only for platform-sensitive paths (GitHub's `paths:` filter), never
// as a required check (the ruleset keeps the FR-106 stub), and uses no secrets and no pull_request_target
const mp = fs.readFileSync(path.join(WF, 'macos-pr.yml'), 'utf8');
const mpPaths = (mp.match(/^ {4}paths:\r?\n((?: {6}- '[^']+'\r?\n)+)/m)?.[1] ?? '').split(/\r?\n/).map((l) => l.replace(/^ {6}- '|'$/g, '')).filter(Boolean);
for (const p of ['src/main/**', 'src/adapters/**', 'src/shared/**', 'src/preload/**', 'scripts/fakes/**', 'scripts/run-tests.js', 'scripts/test-*', 'scripts/*.sh', 'package.json', 'package-lock.json']) assert.ok(mpPaths.includes(p), `macos-pr.yml filters on ${p}`);
assert.ok(!mpPaths.some((p) => p.startsWith('src/renderer') || p.startsWith('docs') || p.startsWith('specs')), 'macos-pr.yml: UI, docs and specs do not start macOS');
assert.ok(/runs-on: macos-latest/.test(mp) && mp.includes('npm test') && !/pull_request_target|secrets\./.test(mp) && !/^ {2}push:|schedule:/m.test(mp), 'macos-pr.yml: real macOS npm test on pull requests only, no secrets');
assert.ok(!/name: Build and test/.test(mp), 'macos-pr.yml does not reuse a required check name');
// FR-106: macOS runs on pull requests nowhere (installed app, packaged check and install check too) and nightly failures are reported
for (const f of ['installed-app.yml', 'packaged-check.yml']) {
  const y = fs.readFileSync(path.join(WF, f), 'utf8');
  assert.ok(/^ {2}schedule:/m.test(y) && y.includes(`(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') &&`) && !/os: \[/.test(y), `${f}: macOS only nightly and by hand`);
}
const ic = fs.readFileSync(path.join(WF, 'install-check.yml'), 'utf8');
assert.ok(/^ {2}schedule:/m.test(ic) && ic.includes(`map(select(startswith("macos") | not))`), 'install-check.yml: no macOS on pull requests, weekly on every OS');
const watch = fs.readFileSync(path.join(WF, 'nightly-watch.yml'), 'utf8');
assert.ok(!/pull_request/.test(watch) && !/actions\/checkout/.test(watch) && watch.includes(`github.event.workflow_run.event == 'schedule'`), 'nightly-watch.yml: only scheduled runs, never PR code');
const watched = ((/workflows: \[(.*)\]/.exec(watch) || [])[1] || '').split(',').map((x) => x.trim());
const wfNames = new Set(fs.readdirSync(WF).filter((f) => f.endsWith('.yml')).map((f) => (/^name: (.*)$/m.exec(fs.readFileSync(path.join(WF, f), 'utf8')) || [])[1]));
for (const w of ['CI', 'UI on three OSes', 'Installed app', 'Packaged check', 'Install check']) assert.ok(watched.includes(w) && wfNames.has(w), `nightly-watch.yml watches "${w}" (a real workflow name)`);
// FR-111 (owner decision 2026-10-22): theme layout checks run Clean Office and Retro on pull requests, every theme elsewhere
assert.ok(office.includes(`CHECK_ALL_THEMES: \${{ (github.event_name == 'pull_request' || github.event_name == 'merge_group') && '0' || '1' }}`) && wf.includes(`CHECK_ALL_THEMES: \${{ github.event_name == 'pull_request' && '0' || '1' }}`), 'every theme on main, nightly and by hand');
const geo = fs.readFileSync(path.join(ROOT, 'scripts', 'check-theme-geometry.js'), 'utf8');
assert.ok(/process\.env\.CHECK_ALL_THEMES === '1' \? ALL_THEMES : 'retro'/.test(geo) && /const ALL_THEMES = 'corporate,retro,durbar-indian,durbar-european,durbar-japanese,user,pink-studio'/.test(geo), 'check-theme-geometry: Retro by default, all with CHECK_ALL_THEMES=1');
assert.ok(/CHECK_ALL_THEMES === '1' \? \[[^\]]*durbar-japanese[^\]]*\] : \['clean', 'retro'\]/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'shots-052-addleft.js'), 'utf8')), 'shots-052-addleft: Clean and Retro by default');
// FR-110: every job of every workflow has a time limit
for (const f of fs.readdirSync(WF).filter((x) => x.endsWith('.yml'))) for (const [id, body] of Object.entries(jobsOf(fs.readFileSync(path.join(WF, f), 'utf8')))) assert.ok(/^ {4}timeout-minutes: /m.test(body), `${f} ${id} has timeout-minutes`);
// ---- scripts/driver-helpers.js (spec 008 FR-097): the shared plumbing behaves as the drivers' own copies did ----
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dh = require(path.join(ROOT, 'scripts', 'driver-helpers.js'));
(async () => {
  const events: any[] = [], sizes: any[] = [], loads: any[] = [], codes: string[] = [], waited: string[] = [], shots: string[] = [], sleeps: number[] = [];
  const ctx = {
    win: { webContents: { sendInputEvent: (e: any) => events.push(e), focus: () => events.push('focus') }, setContentSize: (w: number, h: number) => sizes.push([w, h]), loadFile: async (p: string, o: any) => { loads.push([p, o]); } },
    js: async (c: string) => { codes.push(c); return c.includes('NOPE') ? Promise.reject(new Error('boom')) : true; },
    waitFor: async (e: string) => { waited.push(e); return true; }, sleep: async (ms: number) => { sleeps.push(ms); }, shot: async (f: string) => { shots.push(f); },
  };
  const H = dh.helpers(ctx);
  // Return sends the char event that activates a button; other keys do not; 'always' and 'never' override it
  await H.key('Return'); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'char', 'keyUp'], 'Return: down, char, up'); assert.strictEqual(events[1].keyCode, '\r');
  events.length = 0; await H.key('Tab', ['shift']); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'keyUp'], 'Tab has no char event'); assert.deepStrictEqual(events[0].modifiers, ['shift']);
  events.length = 0; await H.key('K', ['control'], { char: 'always' }); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'char', 'keyUp']);
  events.length = 0; await H.key('Return', [], { char: 'never' }); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'keyUp']);
  // load: sim=15 and simfreeze=1 unless a driver says otherwise (undefined removes one); waits for the desks; settles; focuses on request
  await H.load({ w: 1280, h: 800, query: { simkinds: 'mixed' }, focus: true });
  assert.deepStrictEqual(sizes[0], [1280, 800]); assert.deepStrictEqual(loads[0][1].query, { sim: '15', simfreeze: '1', simkinds: 'mixed' });
  assert.ok(waited[0].includes('>=15'), 'default ready: 15 desks'); assert.ok(events.includes('focus'));
  await H.load({ query: { simfreeze: undefined, sim: '12' }, ready: 'fit', settle: false });
  assert.deepStrictEqual(loads[1][1].query, { sim: '12' }); assert.ok(waited[1].includes('dataset.fit')); assert.strictEqual(sizes.length, 1, 'no size given: the window keeps its size');
  events.length = 0; await H.key('Enter'); assert.deepStrictEqual(events.map((e) => e.type), ['keyDown', 'char', 'keyUp'], 'Enter: down, char, up'); events.length = 0;
  // load settles by default (the page stopped changing: two equal readings 200 ms apart) and not when asked not to
  codes.length = 0; sleeps.length = 0; await H.load({ w: 800, h: 600 });
  assert.ok(codes.some((c) => c.includes("querySelectorAll('*').length")), 'load waits for the page to settle'); assert.ok(sleeps.includes(200), 'the settling wait sleeps between readings');
  codes.length = 0; sleeps.length = 0; await H.load({ w: 800, h: 600, settle: false });
  assert.ok(!codes.some((c) => c.includes("querySelectorAll('*').length")) && !sleeps.includes(200), 'settle: false skips the settling wait');
  // shot prepares the page by its prep: toasts are removed, calm hides them, mouse moves the pointer
  codes.length = 0; await H.shot('/tmp/t.png', { prep: 'toasts', delay: 0 }); assert.ok(codes.some((c) => c.includes('#toasts .toast') && c.includes('remove()')), "prep 'toasts' removes the toasts");
  codes.length = 0; events.length = 0; await H.shot('/tmp/t.png', { prep: 'none', delay: 0 }); assert.deepStrictEqual(codes.map((c) => c.includes('.walker.walking')), [true], "prep 'none' does nothing to the page but wait for walking figures (spec 001 FR-085)");
  codes.length = 0; await H.shot('/tmp/t.png', { prep: 'none', delay: 0, walking: true }); assert.strictEqual(codes.length, 0, 'walking: true skips the walk wait');
  codes.length = 0; await H.calm(); assert.ok(codes[0].includes('shotCalm') && codes.slice(1).some((c) => c.includes('.walker.walking')), 'calm hides the toasts, then waits until no figure walks');
  events.length = 0; await H.shot('/tmp/t.png', { prep: 'mouse', delay: 0 }); assert.strictEqual(events[0].type, 'mouseMove', "prep 'mouse' moves the pointer");
  codes.length = 0; sleeps.length = 0; await H.shot('/tmp/t.png', { settle: true, delay: 0 }); assert.ok(codes.some((c) => c.includes("querySelectorAll('*').length")), 'shot settles when asked');
  // values spliced into page code are escaped, whatever they hold
  const evil = `x');alert(1);//</script>\u2028`;
  codes.length = 0; await H.click(evil); await H.clickText(evil, evil); await H.exists(evil); await H.text(evil); await H.idOf(evil);
  for (const c of codes) { assert.ok(!c.includes(evil), 'the raw value is never in the page code'); assert.ok(!/[\u2028\u2029]|<\/script>/.test(c), 'no raw line separator or closing tag'); }
  // a page error names the code and is thrown again
  await assert.rejects(() => H.js('NOPE'), /boom/);
  // shot: prepares, waits, then takes the picture
  codes.length = 0; shots.length = 0; await H.shot('/tmp/x.png', { prep: 'calm', blur: true, settle: false, delay: 7 }); assert.deepStrictEqual(shots, ['/tmp/x.png']); assert.ok(codes[0].includes("shotCalm") && codes[0].includes('blur()')); assert.ok(sleeps.includes(7));
  console.log('driver-helpers: key, load, escaping and shot behave');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- no driver keeps its own copy of what the shared module does, and no string is spliced raw into page code ----
// Not page drivers: they never touch a window (or drive a real session / the packaged app).
const SKIP = new Set(['driver-helpers.js', 'ui-suite.js', 'check-names.js', 'check-fuses.js', 'check-fuses-launch.js', 'check-parallel.js', 'e2e-driver.js', 'installed-app-check.js', 'installed-app-ci.js']);
/** The template literals of one line (top level only): their text and their `${...}` expressions (a nested template is part of its expression). */
function templates(line: string): { text: string; exprs: string[] }[] {
  const out: { text: string; exprs: string[] }[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '`') continue;
    const t = { text: '', exprs: [] as string[] };
    for (i++; i < line.length && line[i] !== '`'; i++) {
      if (line[i] === '\\') { t.text += line[i] + (line[i + 1] || ''); i++; continue; }
      if (line[i] === '$' && line[i + 1] === '{') {
        let depth = 0, k = i + 1, inTpl = 0;
        for (; k < line.length; k++) {
          if (line[k] === '`') inTpl ^= 1;
          else if (!inTpl && line[k] === '{') depth++;
          else if (!inTpl && line[k] === '}' && --depth === 0) break;
        }
        t.exprs.push(line.slice(i + 2, k)); i = k; continue;
      }
      t.text += line[i];
    }
    out.push(t);
  }
  return out;
}
/* Allowed raw splices into page code: jsLiteral (or its alias q), and these typed numbers, booleans and ready-made code strings. */
// box(n) (check-question-options) and the scrollHeight choice (check-question-visible) are ready-made page expressions, not values.
const RAW_OK = /^(w|h|n|i|width|n - 1|before|sim|expanded|expectPlaces|SECONDS|SPEED|open|!open|iconClick|left|box\(\d\)|where === 'top' \? 0 : 'c\.scrollHeight'|tags|level === 'simple'|[\w.]+\.toString\(\))$/;
const PAGE = /\b(document|window)\.|localStorage|getComputedStyle|querySelector/;
const drivers = fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => /^(shots|check)-.*\.js$/.test(x) && !SKIP.has(x));
assert.ok(drivers.length >= 45, `${drivers.length} page drivers are checked`);
export function checkDriverSource(f: string, t: string): string[] {
  const bad: string[] = [];
  if (/\.load(File|URL)\(/.test(t)) bad.push(`${f}: loads the page through helpers(ctx).load, not its own loadFile/loadURL`);
  if (/#toasts[^'"`\n]*\{\s*display\s*:\s*none/.test(t)) bad.push(`${f}: hides the toasts through helpers(ctx).calm`);
  if (/(function\s+jsLiteral\s*\(|(const|let|var)\s+jsLiteral\s*=)/.test(t)) bad.push(`${f}: jsLiteral comes from driver-helpers`);
  if (/\{[^}]*\bjsLiteral\b[^}]*\}\s*=\s*require\(\s*['"`]\.\/check-office-overlap(\.js)?['"`]\s*\)/.test(t)) bad.push(`${f}: takes jsLiteral from driver-helpers`);
  t.split('\n').forEach((line, n) => {
    for (const t of templates(line)) {
      if (!PAGE.test(t.text + t.exprs.join(' '))) continue; // a message, a path, a name: not page code
      for (const e of t.exprs) if (!/^(jsLiteral|q)\(/.test(e) && !RAW_OK.test(e)) bad.push(`${f}:${n + 1}: raw \${${e}} in page code: use jsLiteral(...)`);
    }
  });
  return bad;
}
const allBad = drivers.flatMap((f) => checkDriverSource(f, fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
assert.deepStrictEqual(allBad, [], '\n' + allBad.join('\n'));
// the guard itself catches what it is for (a mutation of a clean driver must fail)
const clean = "const { helpers, jsLiteral } = require('./driver-helpers');\nmodule.exports = async (ctx) => { await ctx.js(`document.title=${jsLiteral(1)}`); };\n";
assert.deepStrictEqual(checkDriverSource('x.js', clean), []);
for (const [what, add] of [
  ['a local loadFile', "await ctx.win.loadFile(INDEX, {});"],
  ['a loadURL', "await ctx.win.loadURL('file://x');"],
  ['a toast-hiding style with spaces', "s.textContent='#toasts { display : none !important }';"],
  ['a double-quoted jsLiteral import from the overlap check', "const { jsLiteral } = require(\"./check-office-overlap.js\");"],
  ['a jsLiteral import from the overlap check without .js', "const { jsLiteral } = require('./check-office-overlap');"],
  ['a toast-hiding style', "s.textContent='#toasts{display:none!important}';"],
  ['a local jsLiteral', "const jsLiteral = (v) => JSON.stringify(v);"],
  ['a function jsLiteral', "function jsLiteral(v) { return v; }"],
  ['a raw string in page code', "await ctx.js(`document.querySelector('[data-id=\"${id}\"]')`);"],
  ['jsLiteral from the overlap check', "const { jsLiteral } = require('./check-office-overlap.js');"],
]) assert.ok(checkDriverSource('x.js', clean + add + '\n').length > 0, `the guard catches ${what}`);
console.log(`ui-suite: ${names.length} drivers listed and present; no shell; driver failures exit 1; workflow covers 3 OSes`);
// ---- spec 008 FR-114: Electron is installed once, before any parallel job starts (PR #546: parts racing on the binary exited 126) ----
// a promise that never settles would let node exit 0 without the rest of the checks (docs/agent-notes.md, PR #473): fail then
let fr114Done = false;
process.on('exit', () => { if (!fr114Done) { console.error('FR-114 checks did not finish'); process.exitCode = 1; } });
(async () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  type Step = string;
  const { ensureElectron } = require(path.join(ROOT, 'scripts', 'ensure-electron.js')) as { ensureElectron: (o?: { spawn?: (...a: unknown[]) => { status: number | null } }) => boolean };
  // the helper itself: one child `node -e "require('electron')"`, no shell; true only on exit 0
  const calls: unknown[][] = [];
  assert.strictEqual(ensureElectron({ spawn: (...a: unknown[]) => { calls.push(a); return { status: 0 }; } }), true, 'ensureElectron: exit 0 is installed');
  assert.ok(calls.length === 1 && calls[0][0] === process.execPath && JSON.stringify(calls[0][1]) === JSON.stringify(['-e', "require('electron')"]) && (calls[0][2] as { shell?: boolean }).shell === false, 'ensureElectron: one child node, require(electron), no shell');
  assert.strictEqual(ensureElectron({ spawn: () => ({ status: 1 }) }), false, 'ensureElectron: a failed fetch is reported');
  for (const f of ['run-tests.js', 'check-parallel.js', 'ui-suite.js']) {
    const s = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
    assert.ok(s.includes("require('./ensure-electron')") && !s.includes(`['-e', "require('electron')"]`), `${f} uses the shared install step, not its own copy`);
  }
  // check-parallel.js: the install runs once, before the first part; a failed install starts no part
  const par = require(path.join(ROOT, 'scripts', 'check-parallel.js')) as { main: (o: object) => Promise<number>; jobs: { label: string }[] };
  const fakeJobs = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
  let order: Step[] = [];
  const quiet = () => undefined;
  let failed = await par.main({ ensure: () => { order.push('ensure'); return true; }, runJob: async (j: { label: string }) => { order.push('run ' + j.label); return 'ok'; }, available: () => Infinity, jobs: fakeJobs, workers: 3, log: quiet });
  assert.strictEqual(failed, 0);
  assert.deepStrictEqual(order.filter((x) => x === 'ensure'), ['ensure'], 'check-parallel: Electron installed exactly once');
  assert.ok(order[0] === 'ensure' && order.length === 4, `check-parallel: the install comes before every part (${order.join(', ')})`);
  order = [];
  failed = await par.main({ ensure: () => { order.push('ensure'); return false; }, runJob: async (j: { label: string }) => { order.push('run ' + j.label); return 'ok'; }, available: () => Infinity, jobs: fakeJobs, workers: 3, log: quiet });
  assert.ok(failed === 3 && order.join() === 'ensure', 'check-parallel: no Electron, no part started, every part counts as failed');
  assert.ok(par.jobs.length >= 2, 'check-parallel still splits the office check into parts');
  // ui-suite.js: the same, after the syntax pass and before the first driver
  const suite = require(SUITE) as { main: (o: object) => Promise<void> };
  const outDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ui-suite-ensure-'));
  const prevOut = process.env.UI_SUITE_OUT;
  process.env.UI_SUITE_OUT = outDir;
  const realLog = console.log;
  console.log = quiet;
  try {
    order = [];
    await suite.main({ argv: ['--only', `${names[1].split(' ')[0]},${names[2].split(' ')[0]}`], ensure: () => { order.push('ensure'); return true; }, run: async (d: { name: string }) => { order.push('run ' + d.name); return { ok: true, secs: 0, why: '', log: '' }; } });
    assert.ok(order[0] === 'ensure' && order.length === 3 && order.filter((x) => x === 'ensure').length === 1, `ui-suite: Electron installed once, before the drivers (${order.join(', ')})`);
    order = [];
    await assert.rejects(suite.main({ argv: ['--only', names[1].split(' ')[0]], ensure: () => { order.push('ensure'); return false; }, run: async () => { order.push('run'); return { ok: true, secs: 0, why: '', log: '' }; } }), /no driver was started/);
    assert.strictEqual(order.join(), 'ensure', 'ui-suite: no Electron, no driver started');
  } finally {
    console.log = realLog;
    if (prevOut === undefined) delete process.env.UI_SUITE_OUT; else process.env.UI_SUITE_OUT = prevOut;
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fr114Done = true;
  console.log('ui-suite: check-parallel and ui-suite install Electron once before their parallel jobs (FR-114)');
})().catch((e) => { console.error(e); process.exitCode = 1; });
