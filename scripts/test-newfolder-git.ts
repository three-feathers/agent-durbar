/**
 * Spec 093 phase 1, with the real git and the real file system (T023): the op as the app builds it (`nodeNewFolderDeps`: Node's
 * fs and the one git runner), in a scratch HOME and a scratch parent folder. No network, no account, no credits.
 *   - New repository: a `.git` made by `git init` in the new folder (its own repository, no remote); the user's global hooks
 *     (`core.hooksPath`), template hooks and fsmonitor, and the parent repository's planted hooks, fsmonitor and sshCommand
 *     (each writing a marker) do not run (D4, D5); `core.hooksPath` is not written into the new repository; the private hooks
 *     folder is gone afterwards (FR-051).
 *   - Empty folder: an empty folder, no git.
 *   - git missing (PATH without git): the FR-062 message and no folder left.
 *   - POSIX only (a stub `git` first on PATH): a failure after files were written removes the folder, and a symlink inside it to
 *     a folder and a file outside the parent, or a link put in place of the folder itself, is removed as a link: the outside
 *     folder and file keep their content (FR-050, R2). Windows: git does not create symlinks there by default (`[KNOWN GAP]`).
 * Needs `git` on PATH: skipped with a note when it is absent, a failure under CI (like test:gitstatus). `npm run test:newfoldergit`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { GIT_MISSING, createNewFolderOp, nodeNewFolderDeps } from '../src/main/newfolderop';
import { runGitCreate } from '../src/main/gitstatus';
import type { AddResult, PermMode } from '../src/shared/api';

async function main(): Promise<void> {
  try { execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true }); } catch {
    if (process.env.CI && !/^(0|false)$/i.test(process.env.CI)) throw new Error('git is not on PATH under CI: the real-git check must run');
    console.log('newfoldergit: SKIPPED (no git on PATH)');
    return;
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-093-')));
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined): void => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    const slash = (p: string): string => p.split(path.sep).join('/');
    const marks = path.join(root, 'marks');
    const tmp = path.join(root, 'tmp');
    const home = path.join(root, 'home');
    for (const d of [marks, tmp, home]) fs.mkdirSync(d);
    assert.ok(!/['\n]/.test(slash(marks)), 'the temp path can be single-quoted for sh');
    const cmd = (name: string): string => `echo ${name} >> '${slash(marks)}/${name}'`;
    const hookDir = (name: string): string => {
      const d = path.join(root, name);
      fs.mkdirSync(d, { recursive: true });
      for (const h of ['pre-commit', 'post-checkout', 'reference-transaction', 'post-index-change', 'post-commit', 'fsmonitor-watchman']) {
        fs.writeFileSync(path.join(d, h), `#!/bin/sh\n${cmd(`${name.replace(/\W/g, '-')}-${h}`)}\n`);
        fs.chmodSync(path.join(d, h), 0o755);
      }
      return d;
    };
    // the user's own config: a global hooks path, a template folder with hooks, a global fsmonitor command
    const g = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') } });
    const gcfg = path.join(home, '.gitconfig');
    fs.writeFileSync(gcfg, '');
    const tmpl = path.join(root, 'tmpl');
    hookDir(path.join('tmpl', 'hooks'));
    for (const [k, v] of [['core.hooksPath', slash(hookDir('globalhooks'))], ['init.templateDir', slash(tmpl)], ['core.fsmonitor', cmd('globalfsmonitor')], ['init.defaultBranch', 'trunk'], ['user.name', 't'], ['user.email', 't@example.invalid']]) g(root, 'config', '--file', gcfg, k, v);
    // the parent is itself a repository whose own config plants commands (D4: init must not read it)
    const parent = path.join(root, 'parent');
    fs.mkdirSync(parent);
    execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', 'init', '-q'], { cwd: parent, windowsHide: true, stdio: 'ignore', env: { ...process.env, HOME: home, USERPROFILE: home, GIT_TEMPLATE_DIR: '' } });
    for (const [k, v] of [['core.fsmonitor', cmd('parentfsmonitor')], ['core.hooksPath', slash(hookDir('parenthooks'))], ['core.sshCommand', cmd('parentssh')]]) g(root, 'config', '--file', path.join(parent, '.git', 'config'), k, v);

    // Durbar runs with this HOME and temporary folder (gitEnv passes HOME through; os.tmpdir reads TMPDIR / TEMP / TMP)
    for (const k of ['HOME', 'USERPROFILE']) setEnv(k, home);
    setEnv('XDG_CONFIG_HOME', path.join(home, '.config'));
    for (const k of ['TMPDIR', 'TEMP', 'TMP']) setEnv(k, tmp);
    assert.strictEqual(fs.realpathSync(os.tmpdir()), tmp, 'the private hooks folders go to the test temp folder');

    const adds: Array<[string[], PermMode]> = [];
    let remembered: string | undefined;
    const settings = { get newFolderParent() { return remembered; }, setNewFolderParent: (p: string) => { remembered = p; } };
    const addMany = async (paths: string[], mode: PermMode): Promise<AddResult> => { adds.push([paths, mode]); return { ok: true, agents: [{ id: 'x', cwd: paths[0] } as never] }; };
    const makeOp = (run?: Parameters<typeof nodeNewFolderDeps>[0]['runGitCreate']) => createNewFolderOp(nodeNewFolderDeps({ addMany, settings: () => settings, runGitCreate: run }));
    const op = makeOp();
    const pick = async (o: ReturnType<typeof makeOp>): Promise<string> => { const r = await o.pickParent(async () => parent); assert.ok(r.ok); return r.ok ? r.token : ''; };

    // ---- new repository ----
    const r = await op.create({ kind: 'init', token: await pick(op), name: 'notes-app' }, 'ask', { persist: true });
    assert.ok(r.ok, 'init: ' + JSON.stringify(r));
    const repo = path.join(parent, 'notes-app');
    assert.ok(fs.statSync(path.join(repo, '.git')).isDirectory() && fs.existsSync(path.join(repo, '.git', 'HEAD')), 'a .git made by git init');
    assert.strictEqual(fs.realpathSync(g(repo, 'rev-parse', '--show-toplevel').trim()), fs.realpathSync(repo), 'its own repository, not the parent\'s');
    assert.strictEqual(g(repo, 'remote').trim(), '', 'no remote');
    assert.match(fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'), /refs\/heads\/trunk/, "the user's own default branch (init.defaultBranch)");
    const localCfg = fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8');
    assert.ok(!/hooksPath|fsmonitor|protocol|submodule/i.test(localCfg), 'none of the -c settings is written into the new repository: ' + localCfg);
    assert.deepStrictEqual(adds, [[[repo], 'ask']], 'added once, in the mode passed');
    assert.strictEqual(remembered, parent, 'the parent is remembered');
    assert.deepStrictEqual(fs.readdirSync(tmp), [], 'the private hooks folder is removed (FR-051)');
    // the user's hooks come back after the create, as after a terminal init (a commit in the new repository runs them)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    g(repo, '-c', 'core.fsmonitor=false', 'add', 'a.txt');
    g(repo, '-c', 'core.fsmonitor=false', 'commit', '-qm', 'a');
    const after = fs.readdirSync(marks).sort();
    assert.ok(after.includes('globalhooks-pre-commit'), "control: the user's own global hooks do run on a later commit (so the planted hooks work): " + after.join(', '));
    assert.deepStrictEqual(after.filter((m) => /parent/.test(m)), [], "the parent repository's planted commands never ran");
    for (const f of fs.readdirSync(marks)) fs.rmSync(path.join(marks, f));

    // ---- empty folder ----
    const e = await op.create({ kind: 'empty', token: await pick(op), name: 'plain' }, 'read-only', { persist: true });
    assert.ok(e.ok);
    assert.deepStrictEqual(fs.readdirSync(path.join(parent, 'plain')), [], 'an empty folder, no git');
    // ---- a name that exists (as a folder, as a file): refused, nothing touched ----
    fs.writeFileSync(path.join(parent, 'afile'), 'keep');
    for (const n of ['notes-app', 'afile']) {
      const x = await op.create({ kind: 'init', token: await pick(op), name: n }, 'ask', { persist: true });
      assert.strictEqual(x.error, `A folder or file named ${n} already exists there.`);
    }
    assert.strictEqual(fs.readFileSync(path.join(parent, 'afile'), 'utf8'), 'keep');
    assert.ok(fs.existsSync(path.join(repo, 'a.txt')), 'the existing repository is untouched');

    // ---- git missing: an empty PATH ----
    const empty = path.join(root, 'nogit');
    fs.mkdirSync(empty);
    const noGit = makeOp((req, cwd, deps) => runGitCreate(req, cwd, { ...deps, env: { ...process.env, PATH: empty, Path: empty } }));
    const m = await noGit.create({ kind: 'init', token: await pick(noGit), name: 'nogit-repo' }, 'ask', { persist: true });
    assert.deepStrictEqual([m.ok, m.error], [false, GIT_MISSING]);
    assert.ok(!fs.existsSync(path.join(parent, 'nogit-repo')), 'no folder left');
    assert.deepStrictEqual(fs.readdirSync(tmp), [], 'no hooks folder left');

    // ---- POSIX: a failure removes the folder; links inside it (or in its place) are removed as links ----
    if (process.platform !== 'win32') {
      const outside = path.join(root, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'keep.txt'), 'precious');
      const outFile = path.join(root, 'outside-file.txt');
      fs.writeFileSync(outFile, 'precious too');
      const stubs = path.join(root, 'stubs');
      fs.mkdirSync(stubs);
      const stub = (body: string): ReturnType<typeof makeOp> => {
        fs.writeFileSync(path.join(stubs, 'git'), `#!/bin/sh\n${body}\n`);
        fs.chmodSync(path.join(stubs, 'git'), 0o755);
        return makeOp((req, cwd, deps) => runGitCreate(req, cwd, { ...deps, env: { ...process.env, PATH: stubs + path.delimiter + (process.env.PATH ?? '') } }));
      };
      const q = (p: string): string => `'${p}'`;
      const inside = stub(`ln -s ${q(outside)} out\nln -s ${q(outFile)} f\nmkdir -p sub && echo x > sub/y\necho 'fatal: planted failure' >&2\nexit 1`);
      const f1 = await inside.create({ kind: 'init', token: await pick(inside), name: 'linked' }, 'ask', { persist: true });
      assert.deepStrictEqual([f1.ok, f1.error], [false, 'git init failed: fatal: planted failure']);
      assert.ok(!fs.existsSync(path.join(parent, 'linked')), 'the failed folder is removed');
      assert.deepStrictEqual([fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), fs.readFileSync(outFile, 'utf8')], ['precious', 'precious too'], 'the link targets outside the parent are untouched');
      const swapped = stub(`cd .. && rmdir swapped && ln -s ${q(outside)} swapped\nexit 1`);
      const f2 = await swapped.create({ kind: 'init', token: await pick(swapped), name: 'swapped' }, 'ask', { persist: true });
      assert.strictEqual(f2.ok, false);
      assert.ok(!fs.existsSync(path.join(parent, 'swapped')) && !fs.lstatSync(parent).isSymbolicLink(), 'the link put in place of the folder is removed');
      assert.strictEqual(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'precious', 'and the folder it pointed to is untouched');
      assert.ok(adds.every(([p]) => !/linked|swapped|nogit/.test(p[0])), 'a failed folder is never added');
      assert.deepStrictEqual(fs.readdirSync(tmp), [], 'no hooks folder left after failures');
    } else {
      console.log('newfoldergit: the link cleanup check is POSIX only ([KNOWN GAP] on Windows: junctions not tested)');
    }
    assert.deepStrictEqual(fs.readdirSync(marks), [], 'no planted command ran: ' + fs.readdirSync(marks).join(', '));
    console.log(`newfoldergit: real git (${execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()}): init in its own folder, no hook, fsmonitor or parent config ran, empty folder, git missing, cleanup${process.platform === 'win32' ? '' : ' without following links'} OK`);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
