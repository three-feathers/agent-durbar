/**
 * Spec 093, with the real git and the real file system (T023, T037, T042, T043): the op as the app builds it (`nodeNewFolderDeps`:
 * Node's fs and the one git runner), in a scratch HOME and a scratch parent folder. No network, no account, no credits: the clone
 * source is a local bare repository reached through the test seam (`gitCreateCall`'s protocols, FR-095), the hang source a silent
 * local TCP listener, and ssh a stub on PATH.
 *   - New repository: a `.git` made by `git init` in the new folder (its own repository, no remote); the user's global hooks
 *     (`core.hooksPath`), template hooks and fsmonitor, and the parent repository's planted hooks, fsmonitor and sshCommand
 *     (each writing a marker) do not run (D4, D5); `core.hooksPath` is not written into the new repository; the private hooks
 *     folder is gone afterwards (FR-051).
 *   - Empty folder: an empty folder, no git.
 *   - git missing (PATH without git): the FR-062 message and no folder left.
 *   - POSIX only (a stub `git` first on PATH): a failure after files were written removes the folder, and a symlink inside it to
 *     a folder and a file outside the parent, or a link put in place of the folder itself, is removed as a link: the outside
 *     folder and file keep their content (FR-050, R2). Windows: git does not create symlinks there by default (`[KNOWN GAP]`).
 *   - Clone (phase 2): the seam clone (files, `.git`, the given URL as origin, no `-c` setting written, no submodule cloned, no
 *     hook of the user's global hooks path or template, nor the parent repository's planted config, ran); the production call
 *     refuses `file://` and `ext::` built past the validator; each protocol layer alone (R1) against a scratch HOME that allows
 *     `file` and `ext` and rewrites https URLs to them with `insteadOf` (and a `foo::` helper, which only GIT_ALLOW_PROTOCOL stops);
 *     a closed port and git missing leave no folder; Cancel against a listener that never answers ends git and its helper (and
 *     nothing else), then removes the folder; POSIX: links from the cloned tree to outside folders survive a failed clone, and a stub
 *     ssh gets BatchMode=yes (also with a plain-ssh core.sshCommand) but not when core.sshCommand is another program (D11).
 * Needs `git` on PATH: skipped with a note when it is absent, a failure under CI (like test:gitstatus). `npm run test:newfoldergit`.
 */
// an async test whose promise never settles lets Node exit 0 without the OK line: fail unless the success path is reached
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { execFileSync, spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { CANCELLED, GIT_MISSING, createNewFolderOp, nodeNewFolderDeps } from '../src/main/newfolderop';
import { GIT_TRANSPORTS, gitCreateCall, runGitCreate } from '../src/main/gitstatus';
import type { GitCreateDeps, GitCreateDone, GitCreateHandle, GitCreateRequest } from '../src/main/gitstatus';
import type { AddResult, PermMode } from '../src/shared/api';

/**
 * Two paths name the same folder: both resolved by the OS (`realpathSync.native`), so a Windows 8.3 short name (`C:\\Users\\RUNNER~1`,
 * what os.tmpdir() returns on the CI runner) equals the long one git prints (`C:\\Users\\runneradmin`). Node's JS `realpathSync`
 * does not expand short names. For comparisons in this test only: the app never compares a path git reports with its target, and its
 * cleanup removes the path it created as given, never a resolved one (FR-050).
 */
const samePath = (a: string, b: string): boolean => fs.realpathSync.native(a) === fs.realpathSync.native(b);

/** Waits for a condition (10 s by default), never a fixed sleep. */
async function until(fn: () => boolean, ms = 10000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return fn();
}

/**
 * The test's own git start, for calls the app can never make: the seam (`gitCreateCall` with `['file']`) and the protocol layer
 * tests (a call with one layer taken out). Same spawn options as the runner; Cancel is not needed here.
 */
function spawnCall(call: { argv: string[]; env: NodeJS.ProcessEnv }, cwd: string, deps: GitCreateDeps): GitCreateHandle {
  let tail = '';
  const done = new Promise<GitCreateDone>((resolve) => {
    const c = spawn('git', call.argv, { cwd, env: call.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', () => undefined);
    c.stderr.on('data', (d) => { tail = (tail + String(d)).slice(-8192); deps.onOutput?.(String(d)); });
    c.on('error', (e: NodeJS.ErrnoException) => resolve({ code: null, signal: null, stderrTail: tail, spawnError: e.code ?? 'EFAIL' }));
    c.on('close', (code, signal) => resolve({ code, signal, stderrTail: tail }));
  });
  return { done, cancel: () => undefined };
}
const callOf = (req: GitCreateRequest, deps: GitCreateDeps, protocols?: string[]) => gitCreateCall(req, { hooksDir: deps.hooksDir, env: deps.env ?? process.env, userSshCommand: deps.userSshCommand }, protocols);

async function main(): Promise<void> {
  try { execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true }); } catch {
    if (process.env.CI && !/^(0|false)$/i.test(process.env.CI)) throw new Error('git is not on PATH under CI: the real-git check must run');
    process.exitCode = 0;
    console.log('newfoldergit: SKIPPED (no git on PATH)');
    return;
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-093-')));
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined): void => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    // samePath: another spelling of the same folder compares equal, a different folder does not. Windows: the 8.3 short name of
    // the temp folder when it has one (the CI runner's RUNNER~1); POSIX: a symlink to it (the portable stand-in for an alias)
    {
      const other = fs.mkdtempSync(path.join(root, 'other-'));
      assert.ok(samePath(root, root + path.sep) && !samePath(root, other), 'samePath: same folder yes, another folder no');
      if (process.platform === 'win32') {
        const t = os.tmpdir();
        if (/~\d/.test(t)) assert.ok(samePath(t, fs.realpathSync.native(t)) && fs.realpathSync.native(t) !== t, `samePath expands the short name ${t}`);
        else console.log(`newfoldergit: no 8.3 short name in ${t} on this machine; samePath checked on spelling only`);
        assert.ok(samePath(root, root.toUpperCase()), 'samePath: case on Windows');
      } else {
        const alias = path.join(root, 'alias');
        fs.symlinkSync(root, alias);
        assert.ok(samePath(alias, root), 'samePath: an alias of the same folder');
        fs.unlinkSync(alias);
      }
      fs.rmdirSync(other);
    }
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
    assert.ok(samePath(os.tmpdir(), tmp), `the private hooks folders go to the test temp folder (${os.tmpdir()} vs ${tmp})`);

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
    const top = g(repo, 'rev-parse', '--show-toplevel').trim();
    assert.ok(samePath(top, repo), `its own repository, not the parent's (git: ${top}, ours: ${repo})`);
    assert.ok(!samePath(top, parent), 'not the parent repository');
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

    // =================== phase 2: clone ===================
    const POSIX = process.platform !== 'win32';
    const noHooks = path.join(root, 'nohooks');
    const noTmpl = path.join(root, 'notmpl');
    fs.mkdirSync(noHooks);
    fs.mkdirSync(noTmpl);
    // the test's own setup commands: no hook, template or fsmonitor of the scratch HOME fires while the source is built
    const gs = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', `core.hooksPath=${slash(noHooks)}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TEMPLATE_DIR: noTmpl } });
    const outside2 = path.join(root, 'outside2');
    fs.mkdirSync(outside2);
    fs.writeFileSync(path.join(outside2, 'keep.txt'), 'precious');
    const outFile2 = path.join(root, 'outside2-file.txt');
    fs.writeFileSync(outFile2, 'precious too');
    const subw = path.join(root, 'subwork');
    fs.mkdirSync(subw);
    gs(subw, 'init', '-q');
    fs.writeFileSync(path.join(subw, 's.txt'), 's\n');
    gs(subw, 'add', 's.txt');
    gs(subw, 'commit', '-qm', 's');
    const subSha = gs(subw, 'rev-parse', 'HEAD').trim();
    const work = path.join(root, 'srcwork');
    fs.mkdirSync(path.join(work, 'dir'), { recursive: true });
    gs(work, 'init', '-q');
    fs.writeFileSync(path.join(work, 'README.md'), '# shop\n');
    fs.writeFileSync(path.join(work, 'dir', 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(work, '.gitmodules'), '[submodule "sub"]\n\tpath = sub\n\turl = https://example.invalid/sub.git\n');
    if (POSIX) { fs.symlinkSync(outside2, path.join(work, 'out')); fs.symlinkSync(outFile2, path.join(work, 'f')); }
    gs(work, 'add', '-A');
    gs(work, 'update-index', '--add', '--cacheinfo', `160000,${subSha},sub`);
    gs(work, 'commit', '-qm', 'src');
    const bare = path.join(root, 'src.git');
    gs(root, 'clone', '-q', '--bare', '--no-local', work, bare);
    const bareUrl = pathToFileURL(bare).href;
    // the user's global config allows file and ext and rewrites three https URLs to them (R1), and a helper of another name
    const URL_F = 'https://example.invalid/r.git', URL_E = 'https://example.invalid/e.git', URL_H = 'https://example.invalid/h.git';
    const extMark = `${slash(marks)}/ext-ran`;
    for (const [k, v] of [['protocol.file.allow', 'always'], ['protocol.ext.allow', 'always'], ['protocol.foo.allow', 'always'], [`url.${bareUrl}.insteadOf`, URL_F], [`url.ext::sh -c touch% ${extMark}.insteadOf`, URL_E], ['url.foo::x.insteadOf', URL_H]]) g(root, 'config', '--file', gcfg, k, v);
    const helpers = path.join(root, 'helpers');
    fs.mkdirSync(helpers);
    if (POSIX) {
      fs.writeFileSync(path.join(helpers, 'git-remote-foo'), `#!/bin/sh\necho foo >> '${slash(marks)}/foo-ran'\nexit 1\n`);
      fs.chmodSync(path.join(helpers, 'git-remote-foo'), 0o755);
      setEnv('PATH', helpers + path.delimiter + (process.env.PATH ?? ''));
    }
    // no proxy from the machine reaches these local-only checks
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) setEnv(k, undefined);
    setEnv('NO_PROXY', '*');
    setEnv('no_proxy', '*');
    const clear = (): void => { for (const f of fs.readdirSync(marks)) fs.rmSync(path.join(marks, f)); };
    const seam = (req: GitCreateRequest, cwd: string, deps: GitCreateDeps) => spawnCall(callOf(req, deps, ['file']), cwd, deps);
    const tryClone = async (o: ReturnType<typeof makeOp>, name: string, url: string) => o.create({ kind: 'clone', token: await pick(o), name, url }, 'ask', { persist: true });

    // ---- the seam clone (protocols ['file'], a local bare repository through the user's insteadOf rewrite) ----
    {
      adds.length = 0;
      const progress: unknown[] = [];
      const op2 = createNewFolderOp(nodeNewFolderDeps({ addMany, settings: () => settings, runGitCreate: seam, progress: (p) => progress.push(p) }));
      const r = await op2.create({ kind: 'clone', token: await pick(op2), name: 'shop', url: URL_F }, 'ask', { persist: true });
      assert.ok(r.ok, 'seam clone: ' + JSON.stringify(r));
      const shop = path.join(parent, 'shop');
      assert.ok(fs.existsSync(path.join(shop, '.git', 'HEAD')) && fs.readFileSync(path.join(shop, 'README.md'), 'utf8') === '# shop\n' && fs.existsSync(path.join(shop, 'dir', 'a.txt')), 'the files and a .git');
      assert.strictEqual(g(shop, 'config', '--get', 'remote.origin.url').trim(), URL_F, 'origin is the URL the user gave');
      const cfg = fs.readFileSync(path.join(shop, '.git', 'config'), 'utf8');
      assert.ok(!/hooksPath|fsmonitor|protocol|bundleURI|credentialsInUrl|submodule\.recurse/i.test(cfg), 'none of the -c settings is written into the clone: ' + cfg);
      assert.strictEqual(r.submodules, true, 'the submodule note');
      assert.ok(!fs.existsSync(path.join(shop, 'sub', 's.txt')) && !fs.existsSync(path.join(shop, '.git', 'modules')), 'the submodule is not cloned');
      assert.deepStrictEqual(fs.readdirSync(marks), [], "no hook of the user's hooks path or template, and nothing of the parent repository's config, ran during the clone: " + fs.readdirSync(marks).join(', '));
      assert.ok(progress.length >= 1, 'progress reached the window side');
      assert.deepStrictEqual(adds.map(([p]) => p[0]), [shop]);
      assert.deepStrictEqual(fs.readdirSync(tmp), [], 'the private hooks folder is gone');
      // an upper-case scheme reaches git lower-cased (git refuses "transport 'HTTPS'"): the same rewrite applies and the clone works
      const up = await op2.create({ kind: 'clone', token: await pick(op2), name: 'shop-upper', url: 'HTTPS://example.invalid/r.git' }, 'ask', { persist: true });
      assert.ok(up.ok, 'HTTPS:// clones: ' + JSON.stringify(up));
      assert.strictEqual(g(path.join(parent, 'shop-upper'), 'config', '--get', 'remote.origin.url').trim(), URL_F, 'git got https:// (lower-cased)');
      // control: the user's own hooks run again on a later commit in the clone (so the planted hooks are real)
      fs.writeFileSync(path.join(shop, 'b.txt'), 'b\n');
      g(shop, '-c', 'core.fsmonitor=false', 'add', 'b.txt');
      g(shop, '-c', 'core.fsmonitor=false', 'commit', '-qm', 'b');
      assert.ok(fs.readdirSync(marks).includes('globalhooks-pre-commit'), 'control: the global hooks are live');
      clear();
    }

    // ---- the production call (https and ssh only) against the planted config: each layer alone stops file and ext (R1) ----
    type Variant = 'as built' | 'without GIT_ALLOW_PROTOCOL' | 'without the per-transport nevers' | 'control: neither layer';
    const variant = (v: Variant) => (req: GitCreateRequest, cwd: string, deps: GitCreateDeps): GitCreateHandle => {
      if (v === 'as built') return runGitCreate(req, cwd, deps);
      const call = callOf(req, deps);
      const nevers = new Set(GIT_TRANSPORTS.map((x) => `protocol.${x}.allow=never`));
      const argv: string[] = [];
      for (let i = 0; i < call.argv.length; i++) {
        if (call.argv[i] === '-c' && nevers.has(call.argv[i + 1]) && v !== 'without GIT_ALLOW_PROTOCOL') { i++; continue; }
        argv.push(call.argv[i]);
      }
      const env = { ...call.env };
      if (v !== 'without the per-transport nevers') delete env.GIT_ALLOW_PROTOCOL;
      assert.ok(argv.includes('protocol.allow=never'), 'protocol.allow=never stays in every variant (only the named layer is removed)');
      return spawnCall({ argv, env }, cwd, deps);
    };
    for (const v of ['as built', 'without GIT_ALLOW_PROTOCOL', 'without the per-transport nevers'] as Variant[]) {
      const o = makeOp(variant(v));
      for (const [url, transport] of [[URL_F, 'file'], [URL_E, 'ext']]) {
        const r = await tryClone(o, 'layer', url);
        assert.strictEqual(r.ok, false, `${v}: ${transport} refused`);
        assert.match(String(r.error), new RegExp(`^Git refused that kind of address: Durbar clones over https and ssh only\\. git said: fatal: transport '${transport}' not allowed$`), `${v}: ${transport}: ${r.error}`);
        assert.ok(!fs.existsSync(path.join(parent, 'layer')), `${v}: ${transport}: no folder left`);
      }
      const h = await tryClone(o, 'layer', URL_H);
      if (v === 'without GIT_ALLOW_PROTOCOL') {
        // the -c layer cannot name every helper: only GIT_ALLOW_PROTOCOL stops foo:: (the stub helper runs here, on POSIX)
        assert.strictEqual(h.ok, false);
        if (POSIX) assert.ok(fs.existsSync(path.join(marks, 'foo-ran')), 'without GIT_ALLOW_PROTOCOL a foo:: helper runs: the env is the only layer for helper names');
      } else {
        assert.match(String(h.error), /transport 'foo' not allowed/, `${v}: a foo:: helper is refused: ${h.error}`);
      }
      assert.ok(!fs.existsSync(path.join(parent, 'layer')), `${v}: foo: no folder left`);
      assert.ok(!fs.existsSync(path.join(marks, 'ext-ran')), `${v}: the ext:: command never ran`);
      clear();
      assert.deepStrictEqual(fs.readdirSync(tmp), [], `${v}: no hooks folder left`);
    }
    {
      // control: with neither layer, the same planted config clones file:// and runs the ext:: command (so the layers are what refuse)
      const o = makeOp(variant('control: neither layer'));
      const f = await tryClone(o, 'control-f', URL_F);
      assert.ok(f.ok && fs.existsSync(path.join(parent, 'control-f', 'README.md')), 'control: the file rewrite clones without the layers: ' + JSON.stringify(f));
      if (POSIX) {
        await tryClone(o, 'control-e', URL_E);
        assert.ok(fs.existsSync(path.join(marks, 'ext-ran')), 'control: the ext:: command runs without the layers');
      }
      assert.ok(!fs.existsSync(path.join(parent, 'control-e')), 'control: the failed ext clone left no folder');
      clear();
    }
    {
      // file:// and ext:: built past the validator: the runner refuses the URL itself, and git refuses it when it is put in anyway
      assert.throws(() => runGitCreate({ kind: 'clone', url: bareUrl }, parent, { hooksDir: tmp }), /clone URL not allowed/);
      assert.throws(() => runGitCreate({ kind: 'clone', url: `ext::sh -c touch% ${extMark}` }, parent, { hooksDir: tmp }), /clone URL not allowed/);
      for (const [raw, transport] of [[bareUrl, 'file'], [`ext::sh -c touch% ${extMark}`, 'ext']]) {
        const o = makeOp((req, cwd, deps) => { const c = callOf(req, deps); const argv = [...c.argv]; argv[argv.length - 2] = raw; return spawnCall({ argv, env: c.env }, cwd, deps); });
        const r = await tryClone(o, 'past', URL_F);
        assert.match(String(r.error), new RegExp(`transport '${transport}' not allowed`), `${transport} past the validator: ${r.error}`);
        assert.ok(!fs.existsSync(path.join(parent, 'past')) && !fs.existsSync(path.join(marks, 'ext-ran')), `${transport}: no folder, no command`);
      }
    }

    // ---- FR-050, R2 (POSIX): a clone that fails after checkout is removed without following its links ----
    if (POSIX) {
      const o = makeOp((req, cwd, deps) => {
        const h = seam(req, cwd, deps);
        return { cancel: h.cancel, done: h.done.then((d) => {
          assert.ok(fs.lstatSync(path.join(cwd, 'out')).isSymbolicLink() && fs.lstatSync(path.join(cwd, 'f')).isSymbolicLink(), 'the checkout wrote the links');
          return { ...d, code: 1, stderrTail: 'fatal: planted failure after checkout' };
        }) };
      });
      const r = await tryClone(o, 'linked-clone', URL_F);
      assert.strictEqual(r.ok, false);
      assert.ok(!fs.existsSync(path.join(parent, 'linked-clone')), 'the failed clone is removed');
      assert.deepStrictEqual([fs.readFileSync(path.join(outside2, 'keep.txt'), 'utf8'), fs.readFileSync(outFile2, 'utf8')], ['precious', 'precious too'], 'the folder and file the links pointed to are untouched');
    }

    // ---- a closed port: the network message, no folder ----
    {
      const port = await new Promise<number>((resolve) => { const sv = net.createServer(); sv.listen(0, '127.0.0.1', () => { const a = sv.address() as net.AddressInfo; sv.close(() => resolve(a.port)); }); });
      const r = await tryClone(makeOp(), 'closed', `https://127.0.0.1:${port}/x.git`);
      assert.match(String(r.error), /^Could not reach the server\. Check the address and your network connection\. git said: /, String(r.error));
      assert.ok(!fs.existsSync(path.join(parent, 'closed')));
    }
    // ---- git missing: an empty PATH ----
    {
      const savedPath = process.env.PATH;
      setEnv('PATH', empty);
      try {
        const r = await tryClone(makeOp(), 'nogit-clone', URL_F);
        assert.deepStrictEqual([r.ok, r.error], [false, GIT_MISSING]);
      } finally { process.env.PATH = savedPath; }
      assert.ok(!fs.existsSync(path.join(parent, 'nogit-clone')));
    }

    // ---- FR-041, SC-004: Cancel against a listener that accepts and never answers ----
    {
      const sockets: net.Socket[] = [];
      let closedByGit = 0;
      const server = net.createServer((s) => { sockets.push(s); s.on('close', () => { closedByGit++; }); s.on('error', () => undefined); });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const port = (server.address() as net.AddressInfo).port;
      // a process this test started next to Durbar: Cancel must not end it
      const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      try {
        const o = makeOp();
        const run = tryClone(o, 'hang', `https://127.0.0.1:${port}/r.git`);
        assert.ok(await until(() => sockets.length > 0, 15000), 'git connected to the silent listener');
        assert.ok(fs.existsSync(path.join(parent, 'hang')), 'the folder exists while the clone waits');
        assert.deepStrictEqual(o.cancel(), { ok: true });
        let result: Awaited<typeof run> | undefined;
        void run.then((x) => { result = x; });
        assert.ok(await until(() => result !== undefined, 10000), 'the clone ended within 10 s of Cancel');
        assert.deepStrictEqual([result!.ok, result!.cancelled, result!.error], [false, true, CANCELLED]);
        assert.ok(!fs.existsSync(path.join(parent, 'hang')), 'the folder is gone');
        assert.ok(await until(() => closedByGit === sockets.length, 10000), "git's https helper (a child of git) ended too: its connection closed");
        assert.ok(bystander.exitCode === null && bystander.signalCode === null, 'a process Durbar did not start is untouched');
        assert.deepStrictEqual(fs.readdirSync(tmp), [], 'no hooks folder left');
      } finally {
        bystander.kill();
        for (const s of sockets) s.destroy();
        await new Promise<void>((r) => server.close(() => r()));
      }
    }

    // ---- D6, D11, Q4 (POSIX): ssh through a stub on PATH, which records its arguments and fails like an unknown host key ----
    if (POSIX) {
      const sshStubs = path.join(root, 'sshstubs');
      fs.mkdirSync(sshStubs);
      const stubBody = (name: string): string => `#!/bin/sh\nprintf '%s\\n' "$@" > '${slash(marks)}/${name}-args'\necho 'Host key verification failed.' >&2\nexit 255\n`;
      for (const n of ['ssh', 'plink']) { fs.writeFileSync(path.join(sshStubs, n), stubBody(n)); fs.chmodSync(path.join(sshStubs, n), 0o755); }
      // exit 5: the key was not set
      const unsetSsh = (): void => { try { execFileSync('git', ['config', '--file', gcfg, '--unset-all', 'core.sshCommand'], { stdio: 'ignore', windowsHide: true }); } catch (e) { if ((e as { status?: number }).status !== 5) throw e; } };
      const savedPath = process.env.PATH;
      setEnv('PATH', sshStubs + path.delimiter + (savedPath ?? ''));
      try {
        for (const [sshCmd, stub, batch] of [[undefined, 'ssh', true], ['ssh', 'ssh', true], [slash(path.join(sshStubs, 'plink')), 'plink', false]] as Array<[string | undefined, string, boolean]>) {
          if (sshCmd === undefined) unsetSsh(); else g(root, 'config', '--file', gcfg, 'core.sshCommand', sshCmd);
          const r = await tryClone(makeOp(), 'over-ssh', 'git@example.invalid:o/r.git');
          const args = fs.readFileSync(path.join(marks, `${stub}-args`), 'utf8').split('\n');
          assert.strictEqual(args.includes('BatchMode=yes'), batch, `core.sshCommand ${String(sshCmd)}: BatchMode ${batch ? 'added' : 'not added'}: ${args.join(' ')}`);
          assert.ok(args.includes('example.invalid') || args.includes('git@example.invalid'), 'the stub was the ssh git ran');
          assert.strictEqual(r.error, 'The ssh host key of example.invalid is not known yet. Connect once with ssh in a terminal, then try again. git said: fatal: Could not read from remote repository.', 'Q4 = a');
          assert.ok(!fs.existsSync(path.join(parent, 'over-ssh')), 'no folder left');
          clear();
        }
      } finally { process.env.PATH = savedPath; }
      unsetSsh();
    } else {
      console.log('newfoldergit: the ssh stub check is POSIX only ([KNOWN GAP] on Windows)');
    }
    assert.deepStrictEqual(fs.readdirSync(marks), [], 'no planted command ran during the clone checks: ' + fs.readdirSync(marks).join(', '));
    assert.deepStrictEqual(fs.readdirSync(tmp), [], 'no private hooks folder left');
    process.exitCode = 0;
    console.log(`newfoldergit: real git (${execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()}): init in its own folder, no hook, fsmonitor or parent config ran, empty folder, git missing, cleanup${POSIX ? ' without following links' : ''}; clone: seam clone, no hook ran, submodule not cloned, each protocol layer alone refuses file and ext (and only GIT_ALLOW_PROTOCOL refuses foo::), closed port, Cancel against a silent listener${POSIX ? ', the ssh stub with and without BatchMode' : ''} OK`);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
