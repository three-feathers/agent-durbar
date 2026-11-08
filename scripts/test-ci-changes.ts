/**
 * Unit test (spec 008 FR-104, FR-190): .github/scripts/ci-changes.js, the one decision of which CI parts a pull request needs.
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
function io(head: Record<string, string> = {}, base: Record<string, string> = {}): Io {
  return {
    read: (p) => (p in head ? head[p] : real.read(p)),
    readBase: (p) => (p in base ? base[p] : p in head ? real.read(p) : real.read(p)),
    isFile: (p) => p in head || real.isFile(p),
    isDir: (p) => real.isDir(p),
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
assert.strictEqual(ui(['scripts/new-data.json']), true, 'a non-source file in scripts/ counts (fail open)');
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
  fs.copyFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.js'), path.join(repo, '.github', 'scripts', 'ci-changes.js'));
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
  fs.rmSync(tmp, { recursive: true, force: true });
}
// the decision has no shell: execFileSync with argument arrays only
const src = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.js'), 'utf8');
assert.ok(!/shell: true/.test(src) && !/\bexecSync\(|\bexec\(/.test(src) && /shell: false/.test(src), 'ci-changes.js spawns git without a shell');
console.log('ci-changes: ok');
