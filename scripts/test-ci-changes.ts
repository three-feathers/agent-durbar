/**
 * Unit test (spec 008 FR-104, FR-191): .github/scripts/ci-changes.js, the one decision of which CI parts a pull request needs.
 * Feeds changed-file lists against this checkout (base files are faked in memory) and asserts code / themes / ui / macos.
 * No git, no network, no Electron.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cc = require(path.join(ROOT, '.github', 'scripts', 'ci-changes.js')) as {
  decide: (files: string[], io: Io) => { code: boolean; themes: boolean; ui: boolean; macos: boolean };
  gitIo: (root: string) => Io;
};
interface Io { read(p: string): string | null; readBase(p: string): string | null; isFile(p: string): boolean; isDir(p: string): boolean }

const real = cc.gitIo(ROOT);
/** The real head tree with some files replaced or added; the base is the head unless `base` says otherwise. */
function io(head: Record<string, string> = {}, base: Record<string, string> = {}, gone: string[] = [], dirs: string[] = []): Io {
  return {
    read: (p) => (gone.includes(p) ? null : p in head ? head[p] : real.read(p)),
    readBase: (p) => (p in base ? base[p] : real.read(p)),
    isFile: (p) => !gone.includes(p) && (p in head || real.isFile(p)),
    isDir: (p) => dirs.includes(p) || real.isDir(p),
  };
}
const pkgText = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const lockText = fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
const pkg = JSON.parse(pkgText);
const lock = JSON.parse(lockText);
const bumped = (j: { version: string }) => ({ ...j, version: j.version + '-older' });
// a version-only bump: the base had another version (and the lock's packages[""].version too)
const lockOld = JSON.parse(lockText);
lockOld.version = 'old'; lockOld.packages[''].version = 'old';
const versionBump = io({}, { 'package.json': JSON.stringify(bumped(pkg), null, 2), 'package-lock.json': JSON.stringify(lockOld, null, 2) });

const ui = (files: string[], x: Io = io()) => cc.decide(files, x).ui;

// ui=false: what cannot change the app, its build or the UI drivers
assert.strictEqual(ui(['package.json', 'package-lock.json'], versionBump), false, 'a version-only bump of package.json and the lock is not UI');
assert.strictEqual(ui(['package.json'], versionBump), false, 'a version-only package.json bump is not UI');
assert.strictEqual(ui(['scripts/usage-lib.js']), false, 'a report library (scripts/usage-lib.js) is not UI');
assert.strictEqual(ui(['scripts/test-usage.js']), false, 'a unit-test script (scripts/test-usage.js) is not UI');
assert.strictEqual(ui(['scripts/test-ci-changes.ts', 'scripts/pr-gate.sh']), false, 'TypeScript unit tests and shell tooling are not UI');
assert.strictEqual(ui(['docs/collaboration.md', 'specs/008-packaging-and-release/spec.md', 'README.md']), false, 'docs are not UI');
assert.strictEqual(ui(['.github/workflows/pages.yml']), false, 'another workflow is not UI');

// ui=true: the app, the drivers and what they load, build inputs, dependencies, the workflow and this decision
assert.strictEqual(ui(['src/renderer/app.js']), true, 'src/renderer/app.js is UI');
assert.strictEqual(ui(['src/main/main.ts']), true, 'anything in src/ is UI');
assert.strictEqual(ui(['scripts/check-office-ops.js']), true, 'a driver in ui-suite DRIVERS (check-office-ops.js) is UI');
assert.strictEqual(ui(['scripts/driver-helpers.js']), true, 'the shared driver helpers are UI');
assert.strictEqual(ui(['scripts/ui-suite.js']), true, 'the suite runner is UI');
assert.strictEqual(ui(['scripts/ui-suite-timings.json']), true, 'the shard timing file is UI');
assert.strictEqual(ui(['scripts/office-ops-rules.js']), true, 'a helper a driver requires (office-ops-rules.js) is UI');
assert.strictEqual(ui(['scripts/check-theme-geometry.js']), true, 'a check ui-platforms.yml runs by name is UI');
assert.strictEqual(ui(['scripts/check-parallel.js']), true, 'the office job runner is UI');
assert.strictEqual(ui(['scripts/copy-assets.js']), true, 'the build step copy-assets.js is UI');
assert.strictEqual(ui(['scripts/after-pack.js']), true, 'electron-builder afterPack (package smoke) is UI');
assert.strictEqual(ui(['scripts/fixtures/themes/check-user.json']), true, 'a fixture is UI');
assert.strictEqual(ui(['tsconfig.json']), true, 'tsconfig.json is a build input');
assert.strictEqual(ui(['build/icon.png']), true, 'build/ is a packaging input');
assert.strictEqual(ui(['.github/workflows/ui-platforms.yml']), true, 'the UI workflow itself is UI');
assert.strictEqual(ui(['.github/scripts/ci-changes.js']), true, 'the decision itself is UI');
assert.strictEqual(ui(['.github/actions/npm-ci/action.yml']), true, 'the npm ci action is UI');
assert.strictEqual(ui(['some-new-top-level.cfg']), true, 'an unknown top-level file counts (fail open)');
assert.strictEqual(ui(['scripts/new-data.json'], io({ 'scripts/new-data.json': '{}' })), true, 'a non-source file in scripts/ counts (fail open)');
{ // a lockfile dependency change is UI, also when the version moves with it
  const lockDep = JSON.parse(lockText);
  const dep = Object.keys(lockDep.packages).find((k) => k.startsWith('node_modules/'))!;
  lockDep.packages[dep] = { ...lockDep.packages[dep], version: '0.0.0-other' };
  assert.strictEqual(ui(['package-lock.json'], io({}, { 'package-lock.json': JSON.stringify(lockDep) })), true, 'a lockfile dependency change is UI');
  const pkgDep = { ...pkg, devDependencies: { ...pkg.devDependencies, 'left-pad': '1.0.0' } };
  assert.strictEqual(ui(['package.json'], io({}, { 'package.json': JSON.stringify(pkgDep) })), true, 'a package.json dependency change is UI');
  assert.strictEqual(ui(['package.json'], io({}, { 'package.json': '{ not json' })), true, 'an unparsable base package.json counts (fail open)');
  assert.strictEqual(ui(['package.json'], io({ 'package.json': '{ broken' }, { 'package.json': '{ broken' })), true, 'base and head both unparsable count (fail open), never "equal"');
  // a new or changed report / test npm script is not UI; build, pack:dir and lifecycle hooks are; macOS (npm test) counts every script
  const withScript = (scripts: Record<string, string>) => io({}, { 'package.json': JSON.stringify({ ...bumped(pkg), scripts }) });
  const { 'test:cichanges': _drop, ...fewer } = pkg.scripts as Record<string, string>;
  void _drop;
  assert.strictEqual(ui(['package.json'], withScript(fewer)), false, 'adding an npm test script (with a bump) is not UI');
  assert.strictEqual(cc.decide(['package.json'], withScript(fewer)).macos, true, 'adding an npm test script runs macOS (it runs npm test)');
  assert.strictEqual(ui(['package.json'], withScript({ ...pkg.scripts, 'usage:report': 'node scripts/usage-x.js' })), false, 'removing a report npm script is not UI');
  assert.strictEqual(ui(['package.json'], withScript({ ...pkg.scripts, build: pkg.scripts.build + ' && node x.js' })), true, 'a change to the build script is UI');
  assert.strictEqual(ui(['package.json'], withScript({ ...pkg.scripts, 'pack:dir': 'electron-builder --dir' })), true, 'a change to pack:dir is UI');
  assert.strictEqual(ui(['package.json'], withScript({ ...pkg.scripts, postinstall: 'node x.js' })), true, 'a lifecycle hook is UI');
}
{ // a new helper that ui-suite.js loads counts as soon as it is named, without editing the decision
  const suite = real.read('scripts/ui-suite.js')!;
  const head = { 'scripts/foo.js': 'module.exports = 1;\n', 'scripts/ui-suite.js': suite + "\nrequire('./foo');\n" };
  assert.strictEqual(ui(['scripts/foo.js'], io(head)), true, 'an unknown new scripts/foo.js that ui-suite.js loads is UI');
  assert.strictEqual(ui(['scripts/foo.js'], io({ 'scripts/foo.js': 'module.exports = 1;\n' })), false, 'the same file that nothing in the UI run loads is not');
  const nested = { 'scripts/bar.js': 'module.exports = 2;\n', 'scripts/foo.js': "require('./bar.js');\n", 'scripts/ui-suite.js': suite + "\nrequire('./foo');\n" };
  assert.strictEqual(ui(['scripts/bar.js'], io(nested)), true, 'a helper of a helper is UI (the closure is transitive)');
}

// review of PR #1349, finding 1: a file gone at head (deleted, or a rename's old name: the diff has --no-renames) counts; the head
// closure cannot know it. scripts/ui-text-page.js is read only by check-ui-text.js (no unit test loads it).
assert.strictEqual(ui(['scripts/ui-text-page.js'], io({}, {}, ['scripts/ui-text-page.js'])), true, 'deleting a UI helper is UI');
assert.strictEqual(ui(['scripts/ui-text-page.js', 'scripts/ui-text-page2.js'], io({ 'scripts/ui-text-page2.js': 'x' }, {}, ['scripts/ui-text-page.js'])), true, 'renaming a UI helper (delete plus add) is UI');
assert.strictEqual(ui(['scripts/usage-lib.js'], io({}, {}, ['scripts/usage-lib.js'])), true, 'deleting any scripts/ file counts (fail open: the base closure is not computed)');
// finding 2: a name the literal matcher cannot read can never join the closure, so it counts
assert.strictEqual(ui(['scripts/a b.js'], io({ 'scripts/a b.js': 'module.exports = 1;\n' })), true, 'a scripts/ name with a space is UI');
assert.strictEqual(ui(['scripts/a\u00f1o.js'], io({ 'scripts/a\u00f1o.js': 'module.exports = 1;\n' })), true, 'a scripts/ name with a non-ASCII letter is UI');
// finding 6: a folder the closure names (other than fixtures/, which is always UI) covers every file under it
{
  const suite = real.read('scripts/ui-suite.js')!;
  const head = { 'scripts/ui-suite.js': suite + "\nconst DATA = path.join(__dirname, 'zz-data');\n", 'scripts/zz-data/table.txt': 'x' };
  assert.strictEqual(ui(['scripts/zz-data/table.txt'], io(head, {}, [], ['scripts/zz-data'])), true, 'a file in a folder the UI run names is UI');
  assert.strictEqual(ui(['scripts/zz-data/table.txt'], io({ 'scripts/zz-data/table.txt': 'x' }, {}, [], ['scripts/zz-data'])), false, 'the same folder nothing names is not');
}
// finding 7: roots from .ts files, `npm run` chains (from the workflow and inside package.json) and the lifecycle hooks npm ci runs
{
  const wf = real.read('.github/workflows/ui-platforms.yml')!;
  const tsRoot = { '.github/workflows/ui-platforms.yml': wf + '\n      - run: npx tsx scripts/zz-root.ts\n', 'scripts/zz-root.ts': "import './zz-dep';\n", 'scripts/zz-dep.ts': 'export {};\n' };
  assert.strictEqual(ui(['scripts/zz-root.ts'], io(tsRoot)), true, 'a .ts file the UI workflow runs is UI');
  assert.strictEqual(ui(['scripts/zz-dep.ts'], io(tsRoot)), true, 'a .ts file it imports is UI');
  assert.strictEqual(ui(['scripts/zz-root.ts'], io({ 'scripts/zz-root.ts': 'x' })), false, 'the same .ts file nothing runs is not');
  const pkgWith = (scripts: Record<string, string>) => JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, ...scripts } });
  const chain = { '.github/workflows/ui-platforms.yml': wf + '\n      - run: npm run zz:check\n', 'package.json': pkgWith({ 'zz:check': 'npm run zz:inner', 'zz:inner': 'node scripts/zz-two.js' }), 'scripts/zz-two.js': 'x' };
  assert.strictEqual(ui(['scripts/zz-two.js'], io(chain)), true, 'a script reached through npm run, two levels deep, is UI');
  const hook = { 'package.json': pkgWith({ postinstall: 'node scripts/zz-setup.js' }), 'scripts/zz-setup.js': 'x' };
  assert.strictEqual(ui(['scripts/zz-setup.js'], io(hook)), true, 'a script of a lifecycle hook (postinstall) is UI');
  assert.strictEqual(ui(['scripts/zz-setup.js'], io({ 'package.json': pkgWith({ 'zz:report': 'node scripts/zz-setup.js' }), 'scripts/zz-setup.js': 'x' })), false, 'the same script under a report npm script is not');
}

// code / themes keep FR-104 and FR-031 as they were
const d = (files: string[], x: Io = io()) => cc.decide(files, x);
assert.deepStrictEqual(d(['docs/a.md', 'specs/008-packaging-and-release/tasks.md']), { code: false, themes: false, ui: false, macos: false }, 'docs only: nothing runs');
assert.strictEqual(d(['scripts/usage-lib.js']).code, true, 'a script change still builds and tests (code=true)');
assert.strictEqual(d(['package.json'], versionBump).code, true, 'a version bump still builds and tests (unit tests read the version)');
assert.strictEqual(d(['src/renderer/styles.css']).themes, true, 'a renderer change runs theme geometry');
assert.strictEqual(d(['src/main/main.ts']).themes, false, 'a main-process change does not');
// macos: only docs and a version-only bump skip the macOS pull-request job
assert.strictEqual(d(['package.json', 'package-lock.json', 'CHANGELOG.md', 'changelog.d/x.md'], versionBump).macos, false, 'a release bump skips the macOS PR job');
assert.strictEqual(d(['package.json', 'src/main/main.ts'], versionBump).macos, true, 'a bump with code runs it');
assert.strictEqual(d(['scripts/test-usage.js']).macos, true, 'a test script runs it (unit tests are what it checks)');

// the CLI on a throwaway repository whose last commit changes only docs: a pull request says code=false, every other event (main,
// merge queue, nightly, by hand, none) runs everything. No network; git with argument arrays, no shell.
{
  const os = require('os') as typeof import('os');
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-changes-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.mkdirSync(path.join(repo, 'scripts'));
  for (const f of ['.github/scripts/ci-changes.js', '.github/scripts/ci-changes.sh', 'scripts/safe-print.js']) fs.copyFileSync(path.join(ROOT, ...f.split('/')), path.join(repo, ...f.split('/')));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, stdio: 'ignore', shell: false });
  git('init', '-q');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), 'docs\n');
  git('add', '-A'); git('commit', '-q', '-m', 'docs only');
  const run = (ev: string) => {
    const outFile = path.join(tmp, `out-${ev || 'none'}`);
    execFileSync(process.execPath, [path.join(repo, '.github', 'scripts', 'ci-changes.js')], { cwd: repo, env: { ...process.env, EVENT_NAME: ev, GITHUB_OUTPUT: outFile }, stdio: 'ignore', shell: false });
    return fs.readFileSync(outFile, 'utf8');
  };
  assert.strictEqual(run('pull_request'), 'code=false\nthemes=false\nui=false\nmacos=false\n', 'pull_request: the diff of HEAD^1..HEAD decides (docs only: nothing)');
  for (const ev of ['push', 'merge_group', 'schedule', 'workflow_dispatch', '']) assert.strictEqual(run(ev), 'code=true\nthemes=true\nui=true\nmacos=true\n', `${ev || 'no event'}: everything runs`);
  const ALL = 'code=true\nthemes=true\nui=true\nmacos=true\n';
  // finding 3: a file name with a newline and `::` is printed escaped, so it cannot start a workflow command (POSIX: Windows forbids the name)
  if (process.platform !== 'win32') {
    fs.writeFileSync(path.join(repo, 'scripts', 'x\n::warning::injected ##[error]y.txt'), 'x');
    git('add', '-A'); git('commit', '-q', '-m', 'hostile name');
    const outFile = path.join(tmp, 'out-hostile');
    const stdout = execFileSync(process.execPath, [path.join(repo, '.github', 'scripts', 'ci-changes.js')], { cwd: repo, env: { ...process.env, EVENT_NAME: 'pull_request', GITHUB_OUTPUT: outFile }, encoding: 'utf8', shell: false });
    assert.ok(stdout.includes('injected') && stdout.split(/\r?\n/).every((l) => !l.trim().startsWith('::') && !l.includes('##[') && !l.includes('::warning')), 'a hostile file name is printed escaped: no line starts a workflow command');
  }
  // finding 4: ci-changes.sh runs the BASE copy of the decision (HEAD^1), never the PR's; with no base copy everything runs
  const bash = (cwd: string, ev: string) => {
    const outFile = path.join(tmp, `sh-${Math.random().toString(36).slice(2)}`);
    execFileSync('bash', [path.join('.github', 'scripts', 'ci-changes.sh')], { cwd, env: { ...process.env, EVENT_NAME: ev, GITHUB_OUTPUT: outFile }, stdio: 'ignore', shell: false });
    return fs.readFileSync(outFile, 'utf8');
  };
  let haveBash = true;
  try { execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: false }); } catch { haveBash = false; }
  if (haveBash) {
    // a tooling script the closure does not name, present at head: the base copy, run with --root on the checkout, says ui=false
    fs.writeFileSync(path.join(repo, 'scripts', 'tool.js'), 'module.exports = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'a tooling script');
    assert.strictEqual(bash(repo, 'pull_request'), 'code=true\nthemes=false\nui=false\nmacos=true\n', 'the wrapper decides on the PR checkout (--root): a tooling script is not UI');
    const broken = "require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'code=true\\nthemes=false\\nui=false\\nmacos=false\\n');\n";
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'x');
    fs.writeFileSync(path.join(repo, '.github', 'scripts', 'ci-changes.js'), broken);
    git('add', '-A'); git('commit', '-q', '-m', 'a PR that breaks the decision and changes src/');
    assert.strictEqual(bash(repo, 'pull_request'), ALL, 'the base copy decides: a PR that breaks ci-changes.js still runs its UI checks');
    assert.ok(!fs.existsSync(path.join(repo, '.ci-changes-base')), 'the base copy folder is removed');
    const fresh = path.join(tmp, 'fresh');
    fs.mkdirSync(path.join(fresh, '.github', 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.sh'), path.join(fresh, '.github', 'scripts', 'ci-changes.sh'));
    const g2 = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: fresh, stdio: 'ignore', shell: false });
    g2('init', '-q'); g2('add', '-A'); g2('commit', '-q', '-m', 'base without the decision');
    fs.mkdirSync(path.join(fresh, 'docs')); fs.writeFileSync(path.join(fresh, 'docs', 'a.md'), 'x');
    g2('add', '-A'); g2('commit', '-q', '-m', 'docs');
    assert.strictEqual(bash(fresh, 'pull_request'), ALL, 'no base copy of the decision: everything runs');
    assert.strictEqual(bash(fresh, 'push'), ALL, 'a push runs everything (the wrapper says so without the decision)');
  } else console.log('ci-changes: bash not found, the wrapper test is skipped here (CI runs it on every OS)');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// the decision has no shell: execFileSync with argument arrays only
const src = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.js'), 'utf8');
assert.ok(!/shell: true/.test(src) && !/\bexecSync\(|\bexec\(/.test(src) && /shell: false/.test(src), 'ci-changes.js spawns git without a shell');
console.log('ci-changes: ok');
