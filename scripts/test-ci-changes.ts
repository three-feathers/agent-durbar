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
  npmTargets: (line: string) => { names: string[]; opaque: boolean };
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
    // a committed .ci-changes-base/ is cleared first: its package.json saying "type":"module" would make the copied decision fail
    fs.mkdirSync(path.join(repo, '.ci-changes-base'));
    fs.writeFileSync(path.join(repo, '.ci-changes-base', 'package.json'), '{"type":"module"}\n');
    git('add', '-A'); git('commit', '-q', '-m', 'a planted base folder');
    assert.strictEqual(bash(repo, 'pull_request'), 'code=true\nthemes=false\nui=true\nmacos=true\n', 'a committed .ci-changes-base/ is cleared before the base copy runs');
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
