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
  fastSuites: (files: string[], io: Io) => string[];
  decide: (files: string[], io: Io) => { code: boolean; themes: boolean; ui: boolean; macos: boolean };
  npmTargets: (line: string) => { names: string[]; opaque: boolean };
  gitIo: (root: string) => Io;
};
interface Io { read(p: string): string | null; readBase(p: string): string | null; isFile(p: string): boolean; isDir(p: string): boolean; countUnder?(d: string): number }

const real = cc.gitIo(ROOT);
// Windows checks files out with CRLF: every text this test anchors on or mutates (ci-changes.sh, ci-changes.js) is normalised to LF
// first (review of #2032: the wrapper anchors missed on windows-latest), and each such check also runs on a CRLF copy of the file
const toLf = (t: string): string => t.replace(/\r\n?/g, '\n');
const crlfCopy = (t: string): string => toLf(t).replace(/\n/g, '\r\n');
/** The real head tree with some files replaced or added; the base is the head unless `base` says otherwise. */
function io(head: Record<string, string> = {}, base: Record<string, string> = {}, gone: string[] = [], dirs: string[] = []): Io {
  return {
    read: (p) => (gone.includes(p) ? null : p in head ? head[p] : real.read(p)),
    readBase: (p) => (p in base ? base[p] : real.read(p)),
    isFile: (p) => !gone.includes(p) && (p in head || real.isFile(p)),
    isDir: (p) => dirs.includes(p) || real.isDir(p),
    countUnder: (d: string) => (real as unknown as { countUnder(d: string): number }).countUnder(d),
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
assert.strictEqual(ui(['src/renderer/realoffice/sets/office/ASSETS.md', 'scripts/usage-lib.js']), true, 'Markdown inside src/ is UI too (with a non-doc file, the docs rule does not take it)');
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
  // review of PR #1349 (round 2): the npm lines compared are every name the UI run REACHES (seeds, the workflow's `npm run`s, followed),
  // not a fixed pattern. Base and head both set here so only the one line differs.
  const wfText = real.read('.github/workflows/ui-platforms.yml')!;
  const both = (headScripts: Record<string, string>, baseScripts: Record<string, string>, wf = wfText) => io(
    { 'package.json': JSON.stringify({ ...pkg, scripts: headScripts }), '.github/workflows/ui-platforms.yml': wf },
    { 'package.json': JSON.stringify({ ...pkg, scripts: baseScripts }), '.github/workflows/ui-platforms.yml': wf });
  const wfRunsUisuite = wfText + '\n      - run: npm run test:uisuite\n';
  const s0 = pkg.scripts as Record<string, string>;
  assert.strictEqual(ui(['package.json'], both({ ...s0, 'test:uisuite': s0['test:uisuite'] + ' --edited' }, s0, wfRunsUisuite)), true, 'editing test:uisuite, which the UI workflow runs, is UI');
  assert.strictEqual(ui(['package.json'], both({ ...s0, 'test:uisuite': s0['test:uisuite'] + ' --edited' }, s0)), false, 'the same edit while nothing in the UI run reaches test:uisuite is not');
  const chain = { ...s0, build: s0.build + ' && npm run zcopy', zcopy: 'node scripts/zz-copy.js' };
  assert.strictEqual(ui(['package.json'], both({ ...chain, zcopy: 'node scripts/zz-copy.js --all' }, chain)), true, 'editing a script that build chains to (zcopy) is UI');
  // build is a seed of its own (the office job and package smoke run it), not only because the UI workflow says `npm run build`
  const wfNoBuild = wfText.split('npm run build').join('echo no-build');
  const noChain = { ...s0, 'pack:dir': 'electron-builder --dir' }; // and no other reached script chains to it
  { // also without ci.yml's office job naming it: build stays a seed
    const ciNoBuild = real.read('.github/workflows/ci.yml')!.split('npm run build').join('echo no-build');
    const pkgOf = (sc: Record<string, string>) => JSON.stringify({ ...pkg, scripts: sc });
    const x = io({ 'package.json': pkgOf({ ...noChain, build: s0.build + ' --edited' }), '.github/workflows/ui-platforms.yml': wfNoBuild, '.github/workflows/ci.yml': ciNoBuild },
      { 'package.json': pkgOf(noChain), '.github/workflows/ui-platforms.yml': wfNoBuild, '.github/workflows/ci.yml': ciNoBuild });
    assert.strictEqual(ui(['package.json'], x), true, 'editing build is UI even when nothing else names it');
  }
  // round 3: other ways a line starts an npm script. Each row: the UI workflow runs `cmd`, and only the script it names (`zz:t`, or
  // the npm command's own script) changes. Runners this cannot resolve make every script count (fail open).
  const viaWf = (cmd: string, target: string) => {
    const base = { ...s0, [target]: 'node scripts/zz-target.js' };
    return ui(['package.json'], both({ ...base, [target]: 'node scripts/zz-target.js --edited' }, base, wfText + `\n      - run: ${cmd}\n`));
  };
  for (const [cmd, target] of [
    ['npm run -s zz:t', 'zz:t'], ['npm run --silent zz:t -- --x', 'zz:t'], ['npm run-script zz:t', 'zz:t'], ['npm start', 'start'], ['npm test', 'test'],
    ['npm t', 'test'], ['npm run zz+t', 'zz+t'], ['FOO=1 npx cross-env A=1 npm run zz:t', 'zz:t'],
    ['npm --prefix . run zz:t', 'zz:t'], ['npm -C . run zz:t', 'zz:t'], ['npm-run-all zz:*', 'zz:t'], ['run-p zz:a zz:t', 'zz:t'], ['run-s zz:t', 'zz:t'],
    ['yarn zz:t', 'zz:t'], ['pnpm run zz:t', 'zz:t'],
  ]) assert.strictEqual(viaWf(cmd, target), true, `the UI workflow running "${cmd}": editing ${target} is UI`);
  { // the same forms one level down, inside a reached script (build), and an opaque runner there
    const base = { ...s0, build: s0.build + ' && npm run -s zz:t', 'zz:t': 'node scripts/zz-target.js' };
    assert.strictEqual(ui(['package.json'], both({ ...base, 'zz:t': 'node scripts/zz-target.js --edited' }, base)), true, 'build running "npm run -s zz:t": editing zz:t is UI');
    const opaque = { ...s0, build: s0.build + ' && run-p zz:*', 'zz:u': 'node scripts/zz-u.js' };
    assert.strictEqual(ui(['package.json'], both({ ...opaque, 'zz:u': 'node scripts/zz-u.js --edited' }, opaque)), true, 'build running run-p: every script counts (fail open)');
    assert.strictEqual(ui(['scripts/zz-u.js'], io({ 'package.json': JSON.stringify({ ...pkg, scripts: opaque }), 'scripts/zz-u.js': 'x' })), true, 'and so does a scripts/ file any script names');
  }
  assert.strictEqual(viaWf('echo done', 'zz:t'), false, 'a workflow line that starts no npm script reaches nothing');
  // round 4 (default inverted): a reached line counts as parsed only when every command is an exact form. Every evasion Paco listed
  // must give ui=true when only the called script changes, from the workflow and from inside build; every exact form must give
  // ui=false when an unreached script changes.
  const EVASIONS = ['npm --loglevel warn run zz:t', 'npm run zz:a & npm run zz:t', '(npm run zz:t)', '`npm run zz:t`', '$(npm run zz:t)', 'npm run zz:t>log',
    'npm run zz:t < in.txt', 'npm run zz:t | cat', 'npm run zz:a; npm run zz:t', 'npm run zz:a || npm run zz:t', 'npm.cmd run zz:t', 'node_modules/.bin/run-p zz:t',
    'npm exec run-p zz:t', 'npm x run-p zz:t', 'npx run-p zz:t', 'npx cross-env A=1 npm run zz:t', 'yarn zz:t', 'pnpm run zz:t', 'run-s zz:t', 'npm-run-all zz:*',
    'npm run zz:t --if-present', 'npm run "zz:t"', 'npm --prefix . run zz:t', 'sh -c npm-run-zz', 'bash scripts/zz.sh',
    'node scripts/zz-x.js `npm run zz:t`', 'node scripts/zz-x.js; npm run zz:t', 'npm run zz:t,zz:u', 'npm run zz:t@1'];
  const viaBuild = (cmd: string, target: string) => {
    const base = { ...s0, build: s0.build + ' && ' + cmd, [target]: 'node scripts/zz-target.js' };
    return ui(['package.json'], both({ ...base, [target]: 'node scripts/zz-target.js --edited' }, base));
  };
  const unreachedEdit = (cmd: string) => {
    const base = { ...s0, build: s0.build + ' && ' + cmd, 'zz:t': 'node scripts/zz-target.js', 'zz+t': 'node scripts/zz-target.js', 'usage:zz': 'node scripts/usage-zz.js' };
    return ui(['package.json'], both({ ...base, 'usage:zz': 'node scripts/usage-zz.js --edited' }, base));
  };
  for (const cmd of EVASIONS) {
    assert.strictEqual(viaBuild(cmd, 'zz:t'), true, `build running "${cmd}": editing zz:t is UI (not an exact form: every script counts)`);
    // from a workflow, only lines that name a runner start npm scripts; `sh -c npm-run-zz` and `bash scripts/zz.sh` name none
    assert.strictEqual(unreachedEdit(cmd), true, `build running "${cmd}": even an unreached script counts (fail open)`);
    if (!/^(sh|bash) /.test(cmd)) assert.strictEqual(viaWf(cmd, 'zz:t'), true, `the UI workflow running "${cmd}": editing zz:t is UI`);
  }
  const EXACT = ['node scripts/zz-x.js --a b', 'tsc -p tsconfig.json', 'electron .', 'electron-builder --dir --publish never', 'npx tsc -p x', 'npx electron-builder --dir',
    'FOO=1 node scripts/zz-x.js', 'npm run zz:t', 'npm run -s zz:t', 'npm run --silent zz:t -- --x', 'npm run-script zz:t', 'npm start', 'npm test', 'npm t', 'npm run zz+t', 'npm stop', 'npm run zz:none',
    'tsc -p a && node scripts/zz-x.js && npm run zz:t'];
  for (const cmd of EXACT) assert.strictEqual(unreachedEdit(cmd), false, `build running the exact form "${cmd}": editing an unreached script is not UI`);
  for (const cmd of ['npm run zz:t', 'npm run -s zz:t', 'npm run-script zz:t', 'npm start', 'npm test', 'npm t']) {
    const target = /start/.test(cmd) ? 'start' : /npm t(est)?$/.test(cmd) ? 'test' : 'zz:t';
    assert.strictEqual(viaBuild(cmd, target), true, `build running the exact form "${cmd}": editing ${target} is UI (it is reached)`);
  }
  // round 5: (1) a scripts/ name without its extension, or a folder with an index file, is a root like a node path
  {
    const noExt = { ...s0, build: s0.build + ' && node scripts/zz-noext', 'zz:dir': 'x' };
    const head = { 'package.json': JSON.stringify({ ...pkg, scripts: noExt }), 'scripts/zz-noext.js': 'module.exports = 1;\n' };
    assert.strictEqual(ui(['scripts/zz-noext.js'], io(head)), true, 'build running "node scripts/zz-noext": scripts/zz-noext.js is UI');
    const withIndex = { ...s0, build: s0.build + ' && node scripts/zz-pkg' };
    const head2 = { 'package.json': JSON.stringify({ ...pkg, scripts: withIndex }), 'scripts/zz-pkg/index.js': "require('./part');\n", 'scripts/zz-pkg/part.js': 'x' };
    assert.strictEqual(ui(['scripts/zz-pkg/part.js'], io(head2, {}, [], ['scripts/zz-pkg'])), true, 'build running "node scripts/zz-pkg": its index.js and what that loads are UI');
    // resolved as node does: the folder's index.js is the root (not the whole folder), so a file there that nothing loads is not UI
    assert.strictEqual(ui(['scripts/zz-pkg/unused.js'], io({ ...head2, 'scripts/zz-pkg/unused.js': 'x' }, {}, [], ['scripts/zz-pkg'])), false, 'a file in that folder that index.js does not load is not UI');
    const head3 = { 'package.json': JSON.stringify({ ...pkg, scripts: { ...s0, build: s0.build + ' && node scripts/zz-tsx' } }), 'scripts/zz-tsx.mjs': 'x' };
    assert.strictEqual(ui(['scripts/zz-tsx.mjs'], io(head3)), true, 'build running "node scripts/zz-tsx": scripts/zz-tsx.mjs is UI');
    for (const [file, label] of [['scripts/zz-ext.js', '.js'], ['scripts/zz-ext.ts', '.ts'], ['scripts/zz-ext.cjs', '.cjs'], ['scripts/zz-ext/index.ts', 'index.ts']]) {
      const h = { 'package.json': JSON.stringify({ ...pkg, scripts: { ...s0, build: s0.build + ' && node scripts/zz-ext' } }), [file]: 'x' };
      assert.strictEqual(ui([file], io(h, {}, [], file.includes('/index') ? ['scripts/zz-ext'] : [])), true, `build running "node scripts/zz-ext": ${file} (${label}) is UI`);
    }
  }
  // (2) ci.yml steps the ui decision gates (the office job) seed npm names and roots; steps gated on code (Build and test) do not
  {
    const ciText = real.read('.github/workflows/ci.yml')!;
    const officeStep = "      - if: steps.changes.outputs.ui == 'true'\n        run: npm run zz:office && node scripts/zz-office-root.js\n";
    const ciWith = ciText.replace('  # On demand only (workflow_dispatch with full_themes)', officeStep + '\n  # On demand only (workflow_dispatch with full_themes)');
    assert.ok(ciWith !== ciText, 'the test step was placed in the office job');
    const scr = { ...s0, 'zz:office': 'node scripts/zz-office.js' };
    const pair = (head: Record<string, string>) => io({ '.github/workflows/ci.yml': ciWith, 'package.json': JSON.stringify({ ...pkg, scripts: { ...scr, ...head } }), 'scripts/zz-office.js': 'x', 'scripts/zz-office-root.js': 'x' },
      { '.github/workflows/ci.yml': ciWith, 'package.json': JSON.stringify({ ...pkg, scripts: scr }) });
    assert.strictEqual(ui(['package.json'], pair({ 'zz:office': 'node scripts/zz-office.js --edited' })), true, 'a script a ui-gated ci.yml step runs (npm run zz:office) is reached');
    assert.strictEqual(ui(['scripts/zz-office.js'], pair({})), true, 'and its scripts/ file is UI');
    assert.strictEqual(ui(['scripts/zz-office-root.js'], pair({})), true, 'a scripts/ file a ui-gated ci.yml step runs by node is UI');
    assert.strictEqual(ui(['package.json'], pair({ test: s0.test + ' --edited' })), false, 'the test script, which only the code-gated Build and test runs, is not reached');
    assert.strictEqual(ui(['package.json'], both({ ...s0, 'pack:dir:prebuilt': s0['pack:dir:prebuilt'] + ' --edited' }, s0)), true, 'the office job runs pack:dir:prebuilt: editing it is UI');
  }
  // round 6: the whole text of every ci.yml job that reads `outputs.ui` in any way is taken, cut by indentation; no step condition
  // escapes. Each row adds a step to the office job (or a new job) that runs `npm run zz:office`, and edits only that script line.
  {
    const ciText = real.read('.github/workflows/ci.yml')!;
    const ANCHOR = '  # On demand only (workflow_dispatch with full_themes)';
    assert.ok(ciText.includes(ANCHOR), 'the office job ends before the on-demand theme job');
    const scr = { ...s0, 'zz:office': 'node scripts/zz-office.js' };
    const edited = (ci: string) => ui(['package.json'], io({ '.github/workflows/ci.yml': ci, 'package.json': JSON.stringify({ ...pkg, scripts: { ...scr, 'zz:office': 'node scripts/zz-office.js --edited' } }) },
      { '.github/workflows/ci.yml': ci, 'package.json': JSON.stringify({ ...pkg, scripts: scr }) }));
    const inOffice = (step: string) => ciText.replace(ANCHOR, step + '\n' + ANCHOR);
    const CASES: [string, string][] = [
      ['double quotes', '      - if: steps.changes.outputs.ui == "true"\n        run: npm run zz:office\n'],
      ["!= 'false'", "      - if: steps.changes.outputs.ui != 'false'\n        run: npm run zz:office\n"],
      ['fromJSON', '      - if: ${{ fromJSON(steps.changes.outputs.ui) }}\n        run: npm run zz:office\n'],
      ['gated only on the build outcome', "      - if: steps.build.outcome == 'success'\n        run: npm run zz:office\n"],
      ['a run block holding a "- " line', "      - if: steps.changes.outputs.ui == 'true'\n        run: |\n          echo start\n          - not a step\n          npm run zz:office\n"],
    ];
    for (const [label, step] of CASES) assert.strictEqual(edited(inOffice(step)), true, `a ci.yml office step written with ${label}: its npm script is reached`);
    const newJob = '  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - id: changes\n        run: bash .github/scripts/ci-changes.sh\n      - if: steps.changes.OUTPUTS.UI == \'true\'\n        run: npm run zz:office\n\n';
    assert.strictEqual(edited(ciText.replace(ANCHOR, newJob + ANCHOR)), true, 'a new ci.yml job that reads outputs.UI in another case is covered whole');
    // round 7: bracket syntax and spaces; each a new job that reads the ui output only that way
    for (const ref of ["steps.changes.outputs['ui']", 'steps.changes.outputs["ui"]', "steps.changes.outputs [ 'ui' ]", 'steps.changes.outputs. ui', 'steps.changes.outputs .ui']) {
      const job = `  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - id: changes\n        run: bash .github/scripts/ci-changes.sh\n      - if: \${{ ${ref} == 'true' }}\n        run: npm run zz:office\n\n`;
      assert.strictEqual(edited(ciText.replace(ANCHOR, job + ANCHOR)), true, `a new ci.yml job gated on ${ref} is covered whole`);
    }
    assert.strictEqual(edited(ciText.replace(ANCHOR, "  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo outputs.uix && npm run zz:office\n\n" + ANCHOR)), false, 'outputs.uix is not the ui output');
    const noUiJob = '  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run zz:office\n\n';
    assert.strictEqual(edited(ciText.replace(ANCHOR, noUiJob + ANCHOR)), false, 'a ci.yml job that never reads outputs.ui is not covered');
    const uncut = ciText.replace(/^jobs:/m, 'jobs_renamed:') + '\n# npm run zz:office\n      - run: npm run zz:office\n';
    assert.strictEqual(edited(uncut), true, 'a ci.yml whose jobs cannot be cut is taken whole (fail open)');
  }
  // (3) runner words in any case are looked at; upper case is not an exact form, so the line fails open
  for (const cmd of ['NPM run zz:t', 'Npm.cmd run zz:t', 'NPX run-p zz:t', 'YARN zz:t']) assert.strictEqual(viaWf(cmd, 'zz:t'), true, `the UI workflow running "${cmd}": editing zz:t is UI`);
  // the parser on its own: the exact forms name what they start and are not opaque; one non-exact command makes the whole line opaque
  assert.deepStrictEqual(cc.npmTargets('tsc -p a && npm run -s zz:t -- --x && npm test'), { names: ['zz:t', 'test'], opaque: false }, 'exact forms are read');
  assert.deepStrictEqual(cc.npmTargets('npm run zz:t && sudo rm x'), { names: ['zz:t'], opaque: true }, 'an unknown command word makes the line opaque');
  assert.deepStrictEqual(cc.npmTargets(''), { names: [], opaque: true }, 'an empty command is not an exact form');
  assert.strictEqual(ui(['package.json'], both({ ...s0, 'usage:zz': 'node scripts/usage-zz.js --new' }, { ...s0, 'usage:zz': 'node scripts/usage-zz.js' })), false, 'editing an unreached usage:* script is not UI');
  assert.strictEqual(ui(['package.json'], io({ 'package.json': JSON.stringify({ ...pkg, scripts: chain }) }, { 'package.json': JSON.stringify({ ...pkg, scripts: { ...s0, build: s0.build + ' && npm run zcopy' } }) })), true, 'adding a script line that build reaches is UI');
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
  const chain = { '.github/workflows/ui-platforms.yml': wf + '\n      - run: npm run zz:check\n', 'package.json': pkgWith({ 'zz:check': 'npm run zz:mid', 'zz:mid': 'npm run zz:inner', 'zz:inner': 'node scripts/zz-two.js' }), 'scripts/zz-two.js': 'x' };
  assert.strictEqual(ui(['scripts/zz-two.js'], io(chain)), true, 'a script reached through npm run, three levels deep, is UI');
  const hook = { 'package.json': pkgWith({ postinstall: 'node scripts/zz-setup.js' }), 'scripts/zz-setup.js': 'x' };
  assert.strictEqual(ui(['scripts/zz-setup.js'], io(hook)), true, 'a script of a lifecycle hook (postinstall) is UI');
  assert.strictEqual(ui(['scripts/zz-setup.js'], io({ 'package.json': pkgWith({ 'zz:report': 'node scripts/zz-setup.js' }), 'scripts/zz-setup.js': 'x' })), false, 'the same script under a report npm script is not');
}

// code / themes keep FR-104 and FR-031 as they were
const d = (files: string[], x: Io = io()) => cc.decide(files, x);
assert.deepStrictEqual(d(['docs/zz-none.md', 'specs/999-none/tasks.md']), { code: false, themes: false, ui: false, macos: false }, 'docs only: nothing runs');
assert.strictEqual(d(['scripts/usage-lib.js']).code, true, 'a script change still builds and tests (code=true)');
assert.strictEqual(d(['package.json'], versionBump).code, true, 'a version bump still builds and tests (unit tests read the version)');
assert.strictEqual(d(['src/renderer/styles.css']).themes, true, 'a renderer change runs theme geometry');
assert.strictEqual(d(['src/main/main.ts']).themes, false, 'a main-process change does not');
// macos: only docs and a version-only bump skip the macOS pull-request job
assert.strictEqual(d(['package.json', 'package-lock.json', 'CHANGELOG.md', 'changelog.d/x.md'], versionBump).macos, false, 'a release bump skips the macOS PR job');
assert.strictEqual(d(['package.json', 'src/main/main.ts'], versionBump).macos, true, 'a bump with code runs it');
assert.strictEqual(d(['scripts/test-usage.js']).macos, true, 'a test script runs it (unit tests are what it checks)');

// ---- spec 117 FR-387 (and review of #2032): the docs-only skip FAILS CLOSED. Only a plain path on the small allow list that no suite
// names may take it; every live file under src/, scripts/ and .github/, rule text, the site's code, README, LICENSE, case tricks, odd
// paths, an empty diff and a missing suite list run everything. Each part has a fixture here and a mutant below that dies at its assert.
type Decision = { code: boolean; themes: boolean; ui: boolean; macos: boolean };
type Cc = { decide: (files: string[], io: Io) => Decision; DOCS: { test(f: string): boolean } };
// a tiny tree: two suites, one names docs/named.md and LICENSE (bare word at the root), one names the docs/zzfolder folder
const fakeFiles: Record<string, string> = {
  'scripts/test-suites.txt': 'test:x\ntest:y\n',
  'package.json': JSON.stringify({ scripts: { 'test:x': 'node scripts/test-x.js', 'test:y': 'tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-y.js' } }),
  'scripts/test-x.js': "read('docs/named.md'); path.join(ROOT, 'LICENSE');\n",
  'scripts/test-y.ts': "path.join(__dirname, '../docs/zzfolder');\n",
  'docs/named.md': 'x', LICENSE: 'x',
};
const fakeIo: Io = { read: (p) => (p in fakeFiles ? fakeFiles[p] : null), readBase: (p) => (p in fakeFiles ? fakeFiles[p] : null), isFile: (p) => p in fakeFiles, isDir: (p) => p === 'docs/zzfolder', countUnder: () => 100 }; // a big folder: the docs skip still counts it (FR-390)
const emptyIo: Io = { read: () => null, readBase: () => null, isFile: () => false, isDir: () => false };
const walk = (rel: string): string[] => {
  const out: string[] = [];
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(path.join(ROOT, ...rel.split('/')), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules') continue;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(r)); else out.push(r);
  }
  return out;
};
const LIVE = [...walk('src'), ...walk('scripts'), ...walk('.github')];
const NEVER_SKIP = ['src/renderer/x.md', 'scripts/x.md', 'scripts/prereview/prompts/system.md', '.github/pull_request_template.md', '.github/agents/new.agent.md',
  'src/LICENSE', 'scripts/docs/a.md', '.github/specs/a.md', 'src/changelog.d/a.md', 'unknown-top-level.txt', 'build/x.json', 'tsconfig.json', 'zz/new.js',
  // rule text, the site's code and data, scripts in docs, files many suites read
  'AGENTS.md', 'CLAUDE.md', 'README.md', 'docs/rules/x.md', 'docs/agent-setup/x.sh', 'docs/agent-setup/x.md', 'docs/site/app.js', 'docs/site/x.md', 'docs/site/gallery.json', 'LICENSE',
  // case tricks (one folder on a case-insensitive checkout)
  'agents.md', 'Readme.md', 'docs/RULES/x.md', 'Docs/Site/app.js', 'Src/x.md', 'SCRIPTS/prereview/prompts/system.md', '.GitHub/x.md', 'Docs/x.md', 'SPECS/x.md',
  // odd paths
  'docs/../src/x.md', './docs/a.md', 'docs/./a.md', 'docs//a.md', '/docs/a.md', ' docs/a.md', 'docs/a.md ', 'docs\\a.md', 'docs/a\u0007.md', 'docs/a.md\n',
  // a doc a suite names (by a literal), and one inside a folder a suite names
  'docs/named.md', 'docs/zzfolder/new.md',
  // reviews of #2032: root files other than the two named ones, anything but Markdown under docs/ and specs/, every changelog fragment
  'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'zz-notes.md', 'docs/x.js', 'docs/x.sh', 'docs/x.svg', 'docs/CODEOWNERS', 'docs/screenshots/a.png',
  'specs/001-x/sample.json', 'changelog.d/x.md'];
const DOCS_ONLY = ['docs/a.md', 'docs/zz/b.md', 'specs/999-none/spec.md', 'CHANGELOG.md', 'CONTRIBUTING.md'];
/** What is wrong with a decision's docs-only skip: a never-skip path that skips (alone, with docs), or a docs path that does not. */
function skipProblems(c: Cc): string[] {
  const bad: string[] = [];
  for (const f of LIVE) if (c.DOCS.test(f)) bad.push(`${f} alone takes the docs-only skip`);
  for (const f of NEVER_SKIP) {
    if (!c.decide([f], fakeIo).code) bad.push(`${f} alone takes the docs-only skip`);
    if (!c.decide(['docs/a.md', f], fakeIo).code) bad.push(`${f} with a doc takes the docs-only skip`);
  }
  if (!c.decide([], fakeIo).code) bad.push('an empty diff takes the docs-only skip');
  if (!c.decide(['docs/a.md'], emptyIo).code) bad.push('a tree with no suite list takes the docs-only skip');
  for (const f of DOCS_ONLY) if (c.decide([f], fakeIo).code) bad.push(`${f} is docs only but runs everything`);
  return bad;
}
assert.ok(LIVE.filter((f) => f.startsWith('src/')).length > 50 && LIVE.some((f) => f.startsWith('.github/workflows/')) && LIVE.includes('scripts/run-tests.js') && LIVE.includes('scripts/prereview/prompts/system.md'), 'the guard walked the live src/, scripts/ and .github/ trees');
assert.deepStrictEqual(skipProblems(cc as unknown as Cc), [], 'FR-387: only a plain, allow-listed path no suite names takes the docs-only skip');
// on the real tree: README and LICENSE are read by suites (and are off the list); a doc a real test names runs everything
assert.strictEqual(cc.decide(['docs/collaboration.md'], io()).code, true, 'a doc a real test names (docs/collaboration.md) runs everything');
assert.strictEqual(cc.decide(['docs/zz-none.md', 'specs/999-none/spec.md'], io()).code, false, 'docs no test names skip on the real tree');
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module') as { new (id: string, parent: unknown): { filename: string; paths: string[]; exports: unknown; _compile(src: string, file: string): void }; _nodeModulePaths(dir: string): string[] };
  const file = path.join(ROOT, '.github', 'scripts', 'ci-changes.js');
  const sourceRaw = fs.readFileSync(file, 'utf8');
  // the mutants run twice: on the checkout's text and on a CRLF copy, both normalised before any anchor is looked for
  for (const [copy, source] of [['checkout', toLf(sourceRaw)], ['CRLF copy', toLf(crlfCopy(sourceRaw))]] as [string, string][]) {
  const variant = (from: string | RegExp, to: string): Cc => {
    const text = source.replace(from, to);
    assert.notStrictEqual(text, source, `mutant anchor found (${copy}): ${String(from)}`);
    const m = new Module(file, null);
    m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(text, file);
    return m.exports as Cc;
  };
  const DENY = 'const DOCS_DENY = /^docs\\/(rules|agent-setup|site)\\//i;';
  const ALLOW = 'const DOCS_ALLOW = /^(specs|docs)\\/.+\\.md$|^(CHANGELOG|CONTRIBUTING)\\.md$/;';
  const mutants: [string, Cc, RegExp][] = [
    ['the old rule (any .md anywhere is docs)', variant(/const DOCS = \{[^\n]*\n/, 'const DOCS = /^(docs\\/|specs\\/|changelog\\.d\\/)|\\.md$|^LICENSE$/;\n'), /src\/renderer\/x\.md alone takes the docs-only skip/],
    ['deny list matched case-sensitively', variant(DENY, DENY.replace(/\/i;$/, '/;')), /docs\/RULES\/x\.md alone takes/],
    ['docs/rules/ dropped from the deny list', variant(DENY, DENY.replace('rules|', '')), /docs\/rules\/x\.md alone takes/],
    ['docs/site/ dropped from the deny list', variant(DENY, DENY.replace('|site', '')), /docs\/site\/x\.md alone takes/],
    ['docs/agent-setup/ dropped from the deny list', variant(DENY, DENY.replace('|agent-setup', '')), /docs\/agent-setup\/x\.md alone takes/],
    ['allow list matched in any case', variant(ALLOW, ALLOW.replace(/\/;$/, '/i;')), /Docs\/x\.md alone takes/],
    ['any top-level Markdown allowed', variant(ALLOW, ALLOW.replace('^(CHANGELOG|CONTRIBUTING)\\.md$', '^[^/]+\\.md$')), /SECURITY\.md alone takes/],
    ['any file type under docs/ and specs/', variant(ALLOW, ALLOW.replace('^(specs|docs)\\/.+\\.md$', '^(specs|docs)\\/.+$')), /docs\/x\.js alone takes/],
    ['changelog fragments allowed', variant(ALLOW, ALLOW.replace('^(specs|docs)\\/', '^(specs|docs|changelog\\.d)\\/')), /changelog\.d\/x\.md alone takes/],
    ['odd paths not refused', variant(/const PLAIN_PATH = [^\n]*\n/, 'const PLAIN_PATH = () => true;\n'), /docs\/\.\.\/src\/x\.md alone takes/],
    ['an empty diff allowed', variant('if (!list.length || !list.every', 'if (!list.every'), /an empty diff takes/],
    ['a missing suite list allowed', variant('if (!names.length) return false;', 'if (!names.length) return true;'), /no suite list takes/],
    ['the docs skip ignores big folders, as the lane does', variant("for (const r of literalTargets(src, io)) if (r.endsWith('/') ? list.some(", "for (const r of literalTargets(src, io)) if (r.endsWith('/') ? (typeof io.countUnder === 'function' ? io.countUnder(r) : 0) <= FOLDER_MAX && list.some("), /docs\/zzfolder\/new\.md alone takes/],
    ['docs a suite names allowed', variant('for (const name of names) for (const src of stepSources(scripts[name])) {', 'for (const name of []) for (const src of stepSources(scripts[name])) {'), /docs\/named\.md alone takes/],
    ['docs only when one file is docs (some, not every)', variant('!list.every((f) => DOCS.test(f))', '!list.some((f) => DOCS.test(f))'), /with a doc takes the docs-only skip/],
  ];
  for (const [name, c, expect] of mutants) {
    const bad = skipProblems(c);
    assert.ok(bad.some((b) => expect.test(b)), `mutant "${name}" (${copy}) dies at its own assert (got: ${bad.slice(0, 3).join('; ') || 'nothing'})`);
  }
  }
}

// ---- spec 117 FR-386: the fast lane's suites (`--suites`), derived from the diff
{
  type Fs = { fastSuites: (files: string[], io: Io) => string[]; suiteNames: (t: string) => string[]; stepSources: (c: string) => string[] };
  const fc = cc as unknown as Fs;
  const list = fc.suiteNames(fs.readFileSync(path.join(ROOT, 'scripts', 'test-suites.txt'), 'utf8'));
  const shared = io(); // one tree for the plain cases: its literal reads are cached across calls
  const fast = (files: string[], x: Io = shared) => fc.fastSuites(files, x);
  assert.deepStrictEqual(fc.stepSources('tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-a.js && node scripts/b.js'), ['scripts/test-a.ts', 'scripts/b.js'], 'a compiled step is its .ts source; a plain node step is itself');
  assert.deepStrictEqual(fc.suiteNames('test:a\n# c\n\ntest:b # note\nnot a suite\ntest:$(x)\n'), ['test:a', 'test:b'], 'only plain test:* names, comments dropped');
  assert.ok(fast(['scripts/test-ci-changes.ts']).includes('test:cichanges'), 'a changed test file runs its suite');
  assert.ok(fast(['scripts/run-tests.js']).includes('test:runtests'), 'a file a test loads by a relative literal (./run-tests) runs that test');
  assert.ok(fast(['src/shared/redact.ts']).includes('test:runtime-redact'), 'a src file a test imports (../src/shared/redact) runs that test');
  assert.ok(fast(['scripts/prereview/prompts/system.md']).includes('test:prereview'), 'a file inside a folder a test names (scripts/prereview) runs that test');
  // spec 117 FR-390: a folder literal picks only when the folder is small (at most FOLDER_MAX files); a new fixture under the shared
  // scripts/fixtures (84 files) no longer picks every test that names that folder (#2037: 23 suites, the heavy redact ones included)
  assert.ok((cc as unknown as { FOLDER_MAX: number }).FOLDER_MAX <= 40, 'FOLDER_MAX is at most 40 (spec)');
  const viaFixtures = fast(['scripts/fixtures/zz-new/x.json']);
  assert.ok(!viaFixtures.includes('test:redact-monotone') && viaFixtures.length < 5, `a new file in the big scripts/fixtures folder picks almost nothing (got ${viaFixtures.join(' ')})`);
  assert.ok(fast(['.github/scripts/ci-changes.js']).includes('test:cichanges'), 'a repo-relative path a test names runs that test');
  assert.deepStrictEqual(fast(['specs/999-none/spec.md']), ['test:specsindex'], 'a spec change runs the specs index check (docs table)');
  assert.ok(fast(['AGENTS.md']).includes('test:rules') && fast(['docs/rules/zz-new.md']).includes('test:rules'), 'rule text, even a new rule file, runs the word budget check (rules-check.js names AGENTS.md and docs/rules)');
  assert.ok(fast(['LICENSE']).includes('test:about'), "a bare-word root file a test names ('LICENSE') runs that test");
  assert.ok(fast(['changelog.d/zz-none.md']).includes('test:changelog'), 'a new changelog fragment runs the changelog check');
  assert.ok(fast(['changelog.d/x.md']).includes('test:changelog'), 'a changelog fragment runs the changelog check');
  assert.deepStrictEqual(fast(['zz/new-file.txt']), [], 'a file nothing names runs no suite (the lane is advisory: the required jobs run everything)');
  const r = fast(['src/shared/api.ts', 'scripts/run-tests.js', 'specs/x/spec.md']);
  assert.ok(r.length > 3 && r.every((n) => list.includes(n)), 'every picked name is on the list');
  assert.deepStrictEqual(r, list.filter((n) => r.includes(n)), 'the picks are in list order, each once');
  // a new suite, or a changed package.json line, runs that suite even when no file it names changed
  const listText = fs.readFileSync(path.join(ROOT, 'scripts', 'test-suites.txt'), 'utf8');
  const baseList = listText.split(/\r?\n/).filter((l) => l.trim() !== 'test:cichanges').join('\n');
  assert.ok(fast(['scripts/test-suites.txt'], io({}, { 'scripts/test-suites.txt': baseList })).includes('test:cichanges'), 'a suite new on the list runs');
  const basePkg = JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, 'test:cichanges': pkg.scripts['test:cichanges'] + ' && node scripts/x.js' } });
  assert.ok(fast(['package.json'], io({}, { 'package.json': basePkg })).includes('test:cichanges'), 'a suite whose package.json line changed runs');
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Module = require('module') as { new (id: string, parent: unknown): { filename: string; paths: string[]; exports: unknown; _compile(src: string, file: string): void }; _nodeModulePaths(dir: string): string[] };
    const file = path.join(ROOT, '.github', 'scripts', 'ci-changes.js');
    for (const [copy, text] of [['checkout', toLf(fs.readFileSync(file, 'utf8'))], ['CRLF copy', toLf(crlfCopy(fs.readFileSync(file, 'utf8')))]] as [string, string][]) {
      const variant = (from: string, to: string): Fs => { assert.ok(text.includes(from), `mutant anchor found (${copy}): ${from}`); const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(text.replace(from, () => to), file); return m.exports as Fs; };
      // a tiny tree: test:w names the big folder scripts/zzbig (41 files) and the file scripts/lib.js; test:x is its own changed file
      const tf: Record<string, string> = {
        'scripts/test-suites.txt': 'test:w\ntest:x\n',
        'package.json': JSON.stringify({ scripts: { 'test:w': 'node scripts/test-w.js', 'test:x': 'node scripts/test-x.js' } }),
        'scripts/test-w.js': "path.join(__dirname, 'zzbig'); require('./lib');\n", 'scripts/test-x.js': '//\n', 'scripts/lib.js': '//\n',
      };
      const tiny: Io = { read: (q) => (q in tf ? tf[q] : null), readBase: (q) => (q in tf ? tf[q] : null), isFile: (q) => q in tf, isDir: (q) => q === 'scripts/zzbig', countUnder: () => 41 };
      const info: { capped?: Set<string> } = {};
      assert.deepStrictEqual((cc.fastSuites as (f: string[], io: Io, i: object) => string[])(['scripts/zzbig/a.json'], tiny, info), [], 'a file in a 41-file folder a test names picks nothing');
      assert.deepStrictEqual([...(info.capped || [])], ['scripts/zzbig/'], 'and the big folder is named, so the summary says why nothing was picked');
      assert.deepStrictEqual(cc.fastSuites(['scripts/zzbig/a.json'], { ...tiny, countUnder: () => 40 }), ['test:w'], 'a 40-file folder still picks');
      assert.deepStrictEqual(cc.fastSuites(['scripts/lib.js', 'scripts/test-x.js'], tiny), ['test:x', 'test:w'], 'the directly changed suite comes first');
      const noCap = variant("const small = (dir) => (typeof io.countUnder === 'function' ? io.countUnder(dir) : 0) <= FOLDER_MAX;", 'const small = () => true;');
      assert.deepStrictEqual(noCap.fastSuites(['scripts/zzbig/a.json'], tiny), ['test:w'], `mutant "no folder cap" (${copy}) dies: the big folder picks again`);
      const listOrder = variant('return [...names.filter((n) => direct.has(n)), ...names.filter((n) => byName.has(n) && !direct.has(n))];', 'return names.filter((n) => direct.has(n) || byName.has(n));');
      assert.deepStrictEqual(listOrder.fastSuites(['scripts/lib.js', 'scripts/test-x.js'], tiny), ['test:w', 'test:x'], `mutant "list order, not direct first" (${copy}) dies`);
    }
  }
  // a hostile name on the list is never output (the output is one line of plain names)
  assert.ok(!fast(['scripts/test-suites.txt'], io({ 'scripts/test-suites.txt': listText + '\ntest:x\nsuites=y\n' }, { 'scripts/test-suites.txt': listText })).some((n) => /[=\s]/.test(n)), 'names are plain');
}

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
  // a suite list, so the docs-only skip can say "no suite names this doc" (with no list it fails closed)
  fs.writeFileSync(path.join(repo, 'scripts', 'test-suites.txt'), 'test:x\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { 'test:x': 'node scripts/test-x.js' } }));
  fs.writeFileSync(path.join(repo, 'scripts', 'test-x.js'), '// a test\n');
  git('add', '-A'); git('commit', '-q', '-m', 'suite list');
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), 'docs\n');
  git('add', '-A'); git('commit', '-q', '-m', 'docs only');
  const run = (ev: string, args: string[] = []) => {
    const outFile = path.join(tmp, `out-${ev || 'none'}-${args.length}`);
    fs.rmSync(outFile, { force: true });
    execFileSync(process.execPath, [path.join(repo, '.github', 'scripts', 'ci-changes.js'), ...args], { cwd: repo, env: { ...process.env, EVENT_NAME: ev, GITHUB_OUTPUT: outFile }, stdio: 'ignore', shell: false });
    return fs.readFileSync(outFile, 'utf8');
  };
  assert.strictEqual(run('pull_request'), 'code=false\nthemes=false\nui=false\nmacos=false\nos_sensitive=false\n', 'pull_request: the diff of HEAD^1..HEAD decides (docs only: nothing)');
  // spec 117 FR-386: --suites writes only the fast lane's two outputs (a docs change no suite names: none picked)
  assert.strictEqual(run('pull_request', ['--suites']), 'fast=yes\nsuites=\n', '--suites: only fast and suites');
  // a changed step file picks its suite on a pull request, and nothing on any other event (review of #2032: the lane is PR-only)
  fs.writeFileSync(path.join(repo, 'scripts', 'test-x.js'), '// a test, changed\n');
  git('add', '-A'); git('commit', '-q', '-m', 'a test changes');
  assert.strictEqual(run('pull_request', ['--suites']), 'fast=yes\nsuites=test:x\n', '--suites on a pull request picks the changed suite');
  for (const ev of ['push', 'merge_group', 'schedule', 'workflow_dispatch', '']) assert.strictEqual(run(ev, ['--suites']), 'fast=yes\nsuites=\n', `--suites on ${ev || 'no event'}: the lane runs on pull requests only`);
  // spec 117 FR-390 (review of #2049): a change in a big folder (more than 40 files) that only a folder literal names picks nothing and
  // writes `capped=1`, through the CLI and through the wrapper (the base copy); the mutant without that output line loses it
  fs.mkdirSync(path.join(repo, 'scripts', 'big'));
  for (let i = 0; i < 41; i++) fs.writeFileSync(path.join(repo, 'scripts', 'big', `f${i}.txt`), 'x');
  fs.writeFileSync(path.join(repo, 'scripts', 'test-x.js'), "require('path').join(__dirname, 'big');\n");
  git('add', '-A'); git('commit', '-q', '-m', 'a big folder a test names');
  fs.writeFileSync(path.join(repo, 'scripts', 'big', 'new.txt'), 'x');
  git('add', '-A'); git('commit', '-q', '-m', 'a file in the big folder');
  assert.strictEqual(run('pull_request', ['--suites']), 'fast=yes\nsuites=\ncapped=1\n', '--suites: a big folder picks nothing and says so (capped=1)');
  {
    const jsPath = path.join(repo, '.github', 'scripts', 'ci-changes.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    const line = "    if (capped.length) out('capped', String(capped.length));";
    assert.ok(js.includes(line), 'mutant anchor: the capped output line');
    fs.writeFileSync(jsPath, js.replace(line, ''));
    assert.strictEqual(run('pull_request', ['--suites']), 'fast=yes\nsuites=\n', 'mutant "no capped output" dies: the line is gone');
    fs.writeFileSync(jsPath, js);
    let canBash = true;
    try { execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: false }); } catch { canBash = false; }
    if (canBash) {
      const outFile = path.join(tmp, 'sh-capped');
      execFileSync('bash', [path.join('.github', 'scripts', 'ci-changes.sh'), '--suites'], { cwd: repo, env: { ...process.env, EVENT_NAME: 'pull_request', GITHUB_OUTPUT: outFile }, stdio: 'ignore', shell: false });
      assert.strictEqual(fs.readFileSync(outFile, 'utf8'), 'fast=yes\nsuites=\ncapped=1\n', 'the wrapper (base copy) writes capped=1 too');
    }
  }
  for (const ev of ['push', 'merge_group', 'schedule', 'workflow_dispatch', '']) assert.strictEqual(run(ev), 'code=true\nthemes=true\nui=true\nmacos=true\nos_sensitive=true\n', `${ev || 'no event'}: everything runs`);
  const ALL = 'code=true\nthemes=true\nui=true\nmacos=true\nos_sensitive=true\n';
  // finding 3: a file name with a newline and `::` is printed escaped, so it cannot start a workflow command (POSIX: Windows forbids the name)
  if (process.platform !== 'win32') {
    fs.writeFileSync(path.join(repo, 'scripts', 'x\n::warning::injected ##[error]y.txt'), 'x');
    git('add', '-A'); git('commit', '-q', '-m', 'hostile name');
    const outFile = path.join(tmp, 'out-hostile');
    const stdout = execFileSync(process.execPath, [path.join(repo, '.github', 'scripts', 'ci-changes.js')], { cwd: repo, env: { ...process.env, EVENT_NAME: 'pull_request', GITHUB_OUTPUT: outFile }, encoding: 'utf8', shell: false });
    assert.ok(stdout.includes('injected') && stdout.split(/\r?\n/).every((l) => !l.trim().startsWith('::') && !l.includes('##[') && !l.includes('::warning')), 'a hostile file name is printed escaped: no line starts a workflow command');
  }
  // finding 4: ci-changes.sh runs the BASE copy of the decision (HEAD^1), never the PR's; with no base copy everything runs
  const bash = (cwd: string, ev: string, args: string[] = []) => {
    const outFile = path.join(tmp, `sh-${Math.random().toString(36).slice(2)}`);
    execFileSync('bash', [path.join('.github', 'scripts', 'ci-changes.sh'), ...args], { cwd, env: { ...process.env, EVENT_NAME: ev, GITHUB_OUTPUT: outFile }, stdio: 'ignore', shell: false });
    return fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  };
  let haveBash = true;
  try { execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', shell: false }); } catch { haveBash = false; }
  if (haveBash) {
    // a tooling script the closure does not name, present at head: the base copy, run with --root on the checkout, says ui=false
    fs.writeFileSync(path.join(repo, 'scripts', 'tool.js'), 'module.exports = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'a tooling script');
    assert.strictEqual(bash(repo, 'pull_request'), 'code=true\nthemes=false\nui=false\nmacos=true\nos_sensitive=true\n', 'the wrapper decides on the PR checkout (--root): a tooling script is not UI');
    assert.strictEqual(bash(repo, 'pull_request', ['--suites']), 'fast=yes\nsuites=\n', 'the wrapper passes --suites to the base copy (spec 117 FR-386)');
    // a committed .ci-changes-base/ is cleared first: its package.json saying "type":"module" would make the copied decision fail
    fs.mkdirSync(path.join(repo, '.ci-changes-base'));
    fs.writeFileSync(path.join(repo, '.ci-changes-base', 'package.json'), '{"type":"module"}\n');
    git('add', '-A'); git('commit', '-q', '-m', 'a planted base folder');
    assert.strictEqual(bash(repo, 'pull_request'), 'code=true\nthemes=false\nui=true\nmacos=true\nos_sensitive=true\n', 'a committed .ci-changes-base/ is cleared before the base copy runs');
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
    // reviews of #2032: unless the base copy wrote exactly one `code=` line holding `true` or `false` (it exits 0 silently, writes
    // `code=` empty, `code=maybe`, or two code lines), ci.yml's `code == 'true'` could read a wrong value: the wrapper replaces the
    // output with "everything runs". Each mutant of the guard leaves at least one fixture without ALL.
    const silent = path.join(tmp, 'silent');
    fs.mkdirSync(path.join(silent, '.github', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(silent, 'scripts'));
    fs.mkdirSync(path.join(silent, 'docs'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'safe-print.js'), path.join(silent, 'scripts', 'safe-print.js'));
    const shRaw = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.sh'), 'utf8');
    const sh = toLf(shRaw);
    const g3 = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: silent, stdio: 'ignore', shell: false });
    g3('init', '-q');
    const out = (lines: string) => `require('fs').appendFileSync(process.env.GITHUB_OUTPUT, ${JSON.stringify(lines)});\n`;
    const BASES: [string, string][] = [
      ['writes nothing', 'process.exit(0);\n'],
      ['writes code= empty', out('code=\nthemes=false\nui=false\nmacos=false\n')],
      ['writes code=maybe', out('code=maybe\nthemes=false\nui=false\nmacos=false\n')],
      ['writes two code lines', out('code=false\ncode=true\nthemes=false\nui=false\nmacos=false\n')],
      // spec 117 FR-012 (review of #2039): every decision name, os_sensitive too, exactly once and exact; else everything runs
      ['writes no os_sensitive (a base older than it)', out('code=false\nthemes=false\nui=false\nmacos=false\n')],
      ['writes os_sensitive=FALSE', out('code=false\nthemes=false\nui=false\nmacos=false\nos_sensitive=FALSE\n')],
      ['writes two os_sensitive lines', out('code=false\nthemes=false\nui=false\nmacos=false\nos_sensitive=false\nos_sensitive=false\n')],
    ];
    /** The wrapper's output with this base decision (committed as HEAD^1) and a docs commit on top. */
    const withBase = (js: string, wrapper: string) => {
      fs.writeFileSync(path.join(silent, '.github', 'scripts', 'ci-changes.js'), js);
      fs.writeFileSync(path.join(silent, '.github', 'scripts', 'ci-changes.sh'), wrapper);
      g3('add', '-A'); g3('commit', '-q', '--allow-empty', '-m', 'base');
      fs.writeFileSync(path.join(silent, 'docs', 'a.md'), String(Math.random()));
      g3('add', '-A'); g3('commit', '-q', '-m', 'docs');
      return bash(silent, 'pull_request');
    };
    for (const [name, js] of BASES) assert.strictEqual(withBase(js, sh), ALL, `a base decision that ${name}: the wrapper writes everything runs`);
    assert.strictEqual(withBase(out('code=false\nthemes=false\nui=false\nmacos=false\nos_sensitive=false\n'), sh), 'code=false\nthemes=false\nui=false\nmacos=false\nos_sensitive=false\n', 'a valid decision passes through, each name once');
    const cond = `  if [ "$n" != 1 ] || { [ "$v" != true ] && [ "$v" != false ]; }; then\n`;
    const guard = /\nlines=""\nfor k in code themes ui macos os_sensitive; do\n[\s\S]*?\ndone\nprintf '%s' "\$lines" >> "\$out"\n/;
    /** The wrapper's anchors are found in this text, after `normalise`. */
    const anchored = (raw: string, normalise: (t: string) => string = toLf) => { const t = normalise(raw); return t.includes(cond) && guard.test(t); };
    assert.ok(anchored(shRaw), 'mutant anchors: the wrapper guard and its exact-value condition');
    assert.ok(anchored(crlfCopy(shRaw)), 'mutant anchors: found in a CRLF copy of the wrapper too (normalised first)');
    assert.ok(!anchored(crlfCopy(shRaw), (t) => t), 'mutant "normalisation stripped": on a CRLF copy the anchors are not found, so the normalisation is what finds them');
    const wrapperMutants: [string, string][] = [
      ['no guard (the raw output passed on)', sh.replace(guard, '\nif [ -f "$raw" ]; then cat "$raw" >> "$out"; fi\n')],
      ['only that a line exists', sh.replace(cond, `  if [ "$n" = 0 ]; then\n`)],
      ['any one line', sh.replace(cond, `  if [ "$n" != 1 ]; then\n`)],
      ['a valid value, not exactly one line', sh.replace(cond, `  if { [ "$v" != true ] && [ "$v" != false ]; }; then\n`)],
    ];
    for (const [name, text] of wrapperMutants) {
      assert.notStrictEqual(text, sh, `wrapper mutant "${name}": the text to change is there`);
      assert.ok(BASES.some(([, js]) => withBase(js, text) !== ALL), `wrapper mutant "${name}" dies at its own assert`);
    }
    assert.strictEqual(bash(fresh, 'push'), ALL, 'a push runs everything (the wrapper says so without the decision)');
  } else console.log('ci-changes: bash not found, the wrapper test is skipped here (CI runs it on every OS)');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// the decision has no shell: execFileSync with argument arrays only
const src = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ci-changes.js'), 'utf8');
assert.ok(!/shell: true/.test(src) && !/\bexecSync\(|\bexec\(/.test(src) && /shell: false/.test(src), 'ci-changes.js spawns git without a shell');
console.log('ci-changes: ok');
