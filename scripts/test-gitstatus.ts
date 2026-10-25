/**
 * Unit test (spec 063): git status parsing, the runner's limits and read-only argv, and the window's words.
 * FR-008 (2026-10-25, #719): the real runner against a scratch repository whose own config plants every command-running
 * setting (needs `git` on PATH; skipped with a note when it is absent).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import { GIT_MAX_FILES, execFileGitRun, filterDrivers, folderGitStatus, gitEnv, makeGitExec, nodeGitExec, parseNumstatZ, parsePorcelainZ } from '../src/main/gitstatus';
import type { GitExec } from '../src/main/gitstatus';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GS = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'gitstatus.js'));
const Z = (...r: string[]): string => r.join('\0') + '\0';

async function main(): Promise<void> {
  // porcelain v1 -z: branch header with upstream and ahead/behind; modified, added, deleted, renamed (old path follows), untracked, conflict
  const p = parsePorcelainZ(Z('## main...origin/main [ahead 2, behind 1]', ' M src/a.ts', 'A  src/new.ts', ' D gone.ts', 'R  src/b2.ts', 'src/b.ts', '?? notes.md', 'UU merge.ts'));
  assert.deepStrictEqual([p.branch, p.ahead, p.behind], ['main', 2, 1]);
  assert.deepStrictEqual(p.files.map((f) => `${f.state}:${f.path}`), ['modified:src/a.ts', 'added:src/new.ts', 'deleted:gone.ts', 'renamed:src/b2.ts', 'untracked:notes.md', 'conflict:merge.ts']);
  assert.deepStrictEqual(parsePorcelainZ(Z('## feature/x')).branch, 'feature/x', 'no upstream');
  assert.deepStrictEqual(parsePorcelainZ(Z('## No commits yet on main')).branch, 'main');
  const det = parsePorcelainZ(Z('## HEAD (no branch)'));
  assert.ok(det.detached && det.branch === 'HEAD');
  assert.strictEqual(parsePorcelainZ(Z('## main', ' M a\u0007b.ts')).files[0].path, 'ab.ts', 'control characters removed');

  // numstat -z: counts, binary, rename records
  const n = parseNumstatZ(Z('12\t3\tsrc/a.ts', '-\t-\timg.png', '5\t1\t') + Z('src/b.ts', 'src/b2.ts'));
  assert.deepStrictEqual(n.get('src/a.ts'), { added: 12, removed: 3 });
  assert.deepStrictEqual(n.get('img.png'), { binary: true });
  assert.deepStrictEqual(n.get('src/b2.ts'), { added: 5, removed: 1 }, 'a rename is keyed by its new path');

  // the runner: read-only argv, counts merged, the file list capped, any failure is { repo: false }
  const seen: string[][] = [];
  const exec = (status: string, diff: string | Error): GitExec => async (args) => {
    seen.push(args);
    if (args.includes('status')) return status;
    if (diff instanceof Error) throw diff;
    return diff;
  };
  const r = await folderGitStatus('/w/api', exec(Z('## main', ' M src/a.ts', '?? new.md'), Z('12\t3\tsrc/a.ts')));
  assert.deepStrictEqual(r, { repo: true, branch: 'main', files: [{ path: 'src/a.ts', state: 'modified', added: 12, removed: 3 }, { path: 'new.md', state: 'untracked' }], more: 0 });
  assert.deepStrictEqual(seen[0], ['-C', '/w/api', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all']);
  assert.deepStrictEqual(seen[1], ['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']);
  assert.ok(!seen.flat().some((a) => /^(fetch|pull|push|commit|add|reset|checkout|stash|gc)$/.test(a)), 'no git command that writes');
  const noHead = await folderGitStatus('/w/new', exec(Z('## No commits yet on main', '?? a.ts'), new Error('bad revision HEAD')));
  assert.ok(noHead.repo && noHead.files.length === 1, 'no HEAD yet: status without line counts');
  assert.deepStrictEqual(await folderGitStatus('/w/x', async () => { throw new Error('not a git repository'); }), { repo: false });
  assert.deepStrictEqual(await folderGitStatus('/w/x', async () => ''), { repo: false }, 'empty output: not a repository');
  const many = Z('## main', ...Array.from({ length: GIT_MAX_FILES + 7 }, (_, i) => `?? f${i}.txt`));
  const big = await folderGitStatus('/w/big', exec(many, ''));
  assert.ok(big.repo && big.files.length === GIT_MAX_FILES && big.more === 7, 'at most 200 files, the rest counted');

  // FR-008: the runner's argv (fake run, no git): every override is asserted one by one, so dropping any of them fails here
  const calls: Array<{ argv: string[]; env: NodeJS.ProcessEnv }> = [];
  const fake = (drivers: string): GitExec => makeGitExec(async (argv, env) => { calls.push({ argv, env }); return argv.includes('config') ? drivers : 'out'; });
  assert.strictEqual(await fake('filter.evil.clean\0filter.evil.process\0filter.a.b.smudge\0')(['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']), 'out');
  const [list, call] = calls;
  const pairs = (argv: string[]): string[] => argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));
  for (const c of ['core.fsmonitor=false', 'core.useBuiltinFSMonitor=false', 'protocol.allow=never', 'protocol.file.allow=never', 'protocol.git.allow=never', 'protocol.ssh.allow=never', 'protocol.http.allow=never', 'protocol.https.allow=never', 'protocol.ext.allow=never', 'log.showSignature=false', 'credential.helper=', 'diff.submodule=short', 'status.submoduleSummary=false']) {
    assert.ok(pairs(call.argv).includes(c), 'the call overrides ' + c);
    assert.ok(pairs(list.argv).includes(c), 'the config read overrides ' + c);
  }
  for (const d of ['evil', 'a.b']) for (const kv of ['clean=', 'smudge=', 'process=', 'required=false']) assert.ok(pairs(call.argv).includes(`filter.${d}.${kv}`), `filter ${d} ${kv}`);
  assert.deepStrictEqual(call.argv.slice(0, 2), ['--no-pager', '--no-optional-locks'], 'global options first');
  assert.deepStrictEqual(call.argv.slice(call.argv.indexOf('-C')), ['-C', '/w/api', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--submodule=short', 'HEAD', '--numstat', '-z'], 'diff: no external diff, no textconv, submodules not entered');
  assert.deepStrictEqual(list.argv.slice(list.argv.indexOf('-C')), ['-C', '/w/api', 'config', '-z', '--name-only', '--get-regexp', '^filter\\.'], 'the driver names are read in the same folder');
  for (const e of [list.env, call.env]) assert.deepStrictEqual([e.GIT_NO_LAZY_FETCH, e.GIT_ALLOW_PROTOCOL, e.GIT_TERMINAL_PROMPT, e.GIT_OPTIONAL_LOCKS], ['1', '', '0', '0'], 'env');
  // Durbar's own GIT_* variables (and SSH_ASKPASS) never reach git; other variables do; Windows names in any case
  const hostile = { PATH: '/bin', HOME: '/h', GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/e', GIT_INDEX_FILE: '/i', GIT_COMMON_DIR: '/c', GIT_OBJECT_DIRECTORY: '/o', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/a', GIT_NAMESPACE: 'n', GIT_CONFIG: '/x', GIT_CONFIG_GLOBAL: '/x', GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='x'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'x', GIT_EXTERNAL_DIFF: 'x', GIT_PAGER: 'x', GIT_ASKPASS: 'x', GIT_SSH_COMMAND: 'x', GIT_EXEC_PATH: '/x', GIT_CEILING_DIRECTORIES: '/', Git_Dir: '/mixed', SSH_ASKPASS: 'x', GIT_NO_LAZY_FETCH: '0', GIT_ALLOW_PROTOCOL: 'ext' };
  assert.deepStrictEqual(gitEnv(hostile), { PATH: '/bin', HOME: '/h', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, 'child env: every GIT_* of Durbar dropped, the safe ones set');
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = '/elsewhere/.git';
  calls.length = 0;
  await fake('')(['-C', '/w/api', 'rev-list', '--count', 'HEAD']);
  if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
  assert.ok(calls.every((c) => c.env.GIT_DIR === undefined && c.env.PATH === process.env.PATH), 'the runner builds its env with gitEnv');
  calls.length = 0;
  await fake('')(['-C', '/w/api', 'status', '--porcelain=v1']);
  assert.deepStrictEqual(calls[1].argv.slice(calls[1].argv.indexOf('-C')), ['-C', '/w/api', 'status', '--ignore-submodules=dirty', '--porcelain=v1'], 'status: submodules not entered');
  calls.length = 0;
  await fake('')(['-C', '/w/api', 'rev-list', '--count', 'HEAD']);
  assert.ok(calls[1].argv.includes('rev-list') && !calls[1].argv.includes('--ignore-submodules=dirty'), 'rev-list as is');
  // refused before any git runs: a writing subcommand, an alias name, a caller's own -c, nothing at all
  calls.length = 0;
  for (const bad of [['-C', '/w', 'commit'], ['-C', '/w', 'st'], ['-C', '/w', '-c', 'core.fsmonitor=x', 'status'], ['-C', '/w', 'fetch'], []]) await assert.rejects(fake('')(bad), /not allowed/, bad.join(' '));
  // a caller's own flag comes after the overrides, so only listed options pass (spec 063 and 085's own): these would undo them
  for (const [sub, flag] of [['diff', '--textconv'], ['diff', '--ext-diff'], ['diff', '--submodule=diff'], ['diff', '--submodule'], ['diff', '--ignore-submodules=none'], ['diff', '--ignore-submodules'], ['diff', '-p'], ['diff', '--output=x'], ['status', '--ignore-submodules=none'], ['status', '--untracked-files=no'], ['status', '-uall'], ['rev-parse', '--git-path'], ['rev-list', '--all'], ['diff', '-c']]) await assert.rejects(fake('')(['-C', '/w', sub, flag, 'HEAD']), /option not allowed/, sub + ' ' + flag);
  assert.strictEqual(calls.length, 0, 'nothing ran for a refused call');
  // every call spec 063 and spec 085 make passes; revisions and anything after -- (paths) are not options
  for (const ok of [['-C', '/w', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'], ['-C', '/w', 'diff', 'HEAD', '--numstat', '-z'], ['-C', '/w', 'rev-parse', '--verify', '-q', 'HEAD'], ['-C', '/w', 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', 'abc123', '--'], ['-C', '/w', 'diff', '--no-ext-diff', '--no-textconv', '--numstat', 'abc123', '--', '-odd-name'], ['-C', '/w', 'rev-list', '--count', 'abc123..HEAD'], ['-C', '/w', 'rev-list', '--count', 'HEAD']]) await fake('')(ok);
  calls.length = 0;
  assert.strictEqual(calls.length, 0, 'nothing ran for a refused call');
  // a driver name -c cannot express is refused (git splits -c at the first "=")
  await assert.rejects(fake('filter.a=b.clean\0')(['-C', '/w', 'status']), /cannot be overridden/);
  assert.deepStrictEqual(filterDrivers('filter.x.clean\0filter.x.required\0filter.y.z.process\0filterx.clean\0'), ['x', 'y.z']);
  // "no filter at all" (git config exits 1) is fine; any other failure of the config read fails the call
  const exit = (code: number): GitExec => makeGitExec(async (argv) => { if (argv.includes('config')) throw Object.assign(new Error('x'), { code }); return 'ok'; });
  assert.strictEqual(await exit(1)(['-C', '/w', 'status']), 'ok');
  await assert.rejects(exit(128)(['-C', '/w', 'status']));
  // the exact file, argv and execFile options of a real call (a fake execFile): shell:true, a missing override or another
  // time/size bound fails here; the source check below ties nodeGitExec to exactly this runner over Node's execFile
  const efCalls: Array<{ file: string; argv: string[]; opts: Record<string, unknown> }> = [];
  const fakeEf = makeGitExec(execFileGitRun((file, argv, opts, cb) => { efCalls.push({ file, argv, opts: opts as unknown as Record<string, unknown> }); cb(null, argv.includes('config') ? 'filter.lfs.clean\0' : 'ok'); }));
  assert.strictEqual(await fakeEf(['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']), 'ok');
  const SAFE = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=never', '-c', 'protocol.git.allow=never', '-c', 'protocol.ssh.allow=never', '-c', 'protocol.http.allow=never', '-c', 'protocol.https.allow=never', '-c', 'protocol.ext.allow=never', '-c', 'log.showSignature=false', '-c', 'credential.helper=', '-c', 'diff.submodule=short', '-c', 'status.submoduleSummary=false'];
  assert.deepStrictEqual(efCalls.map((c) => c.file), ['git', 'git']);
  assert.deepStrictEqual(efCalls[0].argv, [...SAFE, '-C', '/w/api', 'config', '-z', '--name-only', '--get-regexp', '^filter\\.'], 'exact argv: the driver-name read');
  assert.deepStrictEqual(efCalls[1].argv, [...SAFE, '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', '-C', '/w/api', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--submodule=short', 'HEAD', '--numstat', '-z'], 'exact argv: the call');
  for (const c of efCalls) {
    const { env, ...rest } = c.opts;
    assert.deepStrictEqual(rest, { timeout: 4000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, encoding: 'utf8' }, 'exact execFile options: no shell, 4 s, 512 KB');
    const e = env as NodeJS.ProcessEnv;
    assert.deepStrictEqual(e, gitEnv(process.env), 'execFile env');
  }
  const src = (require('fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'gitstatus.ts'), 'utf8') as string).replace(/\r\n/g, '\n');
  assert.ok(/export const nodeGitExec: GitExec = makeGitExec\(execFileGitRun\(execFile as unknown as ExecFileFn\)\);/.test(src), 'nodeGitExec is makeGitExec over execFileGitRun over Node execFile');
  assert.deepStrictEqual(src.match(/^import .*child_process.*$/gm), ["import { execFile } from 'child_process';"], 'only execFile is imported from child_process');
  assert.strictEqual((src.match(/\b(?:execFile|spawn|execSync|execFileSync|spawnSync|fork)\(/g) ?? []).length, 0, 'no other process call in gitstatus.ts');
  assert.strictEqual((src.match(/ef\('git', argv, gitExecOptions\(env\)/g) ?? []).length, 1, 'the one git process call uses gitExecOptions');

  // the window's words (text only)
  assert.strictEqual(GS.chipText({ repo: false }), '');
  assert.strictEqual(GS.chipText({ repo: true, branch: 'main', files: [], more: 0 }), ' · main');
  const st = { repo: true, branch: 'feature/login', ahead: 2, files: [{ path: 'src/a.ts', state: 'modified', added: 12, removed: 3 }, { path: 'img.png', state: 'modified', binary: true }, { path: 'n.md', state: 'untracked' }], more: 4 };
  assert.strictEqual(GS.chipText(st), ' · feature/login · 7 changed');
  assert.strictEqual(GS.chipLabel(st), 'Branch feature/login, 7 changed files. Show them.');
  assert.strictEqual(GS.body(st), 'On branch feature/login (2 ahead of its upstream). 7 files have changes that are not committed yet:');
  assert.deepStrictEqual(GS.lines(st), ['src/a.ts · +12 −3 · changed', 'img.png · binary · changed', 'n.md · new, not tracked yet', 'and 4 more']);
  assert.strictEqual(GS.chipText({ repo: true, branch: 'HEAD', detached: true, files: [], more: 0 }), ' · detached HEAD');
  console.log('gitstatus: porcelain/numstat parsing, read-only argv, limits, failures, window words OK');
}

/**
 * FR-008 real-git check. A scratch repository plants, in its own `.git/config`, every setting that makes git run a command,
 * each command appending its own name to a marker folder outside the repository. Then the real runner (`nodeGitExec`) makes
 * every call the app makes (spec 063 status and numstat, spec 085 rev-parse, rev-list, shortstat) plus a full patch diff
 * (the only diff that would start `diff.external`, `diff.<name>.command` or a textconv). Nothing may have run.
 * Portability: the planted commands are plain `sh` lines (`echo NAME >> 'path'`): git runs config commands through `sh` on
 * every platform (Git for Windows ships its own), and the marker path is written with forward slashes, which that `sh`
 * accepts on Windows too. Hooks are `#!/bin/sh` files (Git for Windows runs those through its `sh` as well).
 * Without the hardening (main before FR-008) this run lists fsmonitor, filter, process and submodule markers.
 */
async function realGitCheck(): Promise<void> {
  try { execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true }); } catch {
    // every CI runner has git (the checkout needs it): there a missing git is a failure, so a green run proves the check ran
    if (process.env.CI && !/^(0|false)$/i.test(process.env.CI)) throw new Error('git is not on PATH under CI: the real-git check must run');
    console.log('gitstatus: real-git check SKIPPED (no git on PATH)');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-git-'));
  try {
    const marks = path.join(root, 'marks');
    fs.mkdirSync(marks);
    const slash = (p: string): string => p.split(path.sep).join('/');
    assert.ok(!/['\n]/.test(slash(marks)), 'the temp path can be single-quoted for sh');
    const cmd = (name: string): string => `echo ${name} >> '${slash(marks)}/${name}'`;
    const g = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'core.fsmonitor=false', '-c', 'advice.addEmbeddedRepo=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const old = new Date('2001-01-01T00:00:00Z');
    const sameSize = (file: string, text: string): void => { fs.writeFileSync(file, text); fs.utimesSync(file, old, old); }; // same size, old time: only hashing (through the clean filter) can tell

    // the folder: a.txt uses driver "evil" (clean/smudge, textconv, diff command), b.txt driver "evil2" (a long-running process filter)
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    g(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, '.gitattributes'), 'a.txt filter=evil diff=evil\nb.txt filter=evil2\n');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
    // an embedded repository (a gitlink), with its own fsmonitor and filter: `status` would start a git inside it
    const sub = path.join(repo, 's');
    fs.mkdirSync(sub);
    g(sub, 'init', '-q');
    fs.writeFileSync(path.join(sub, '.gitattributes'), '*.txt filter=subevil diff=subdrv\n');
    fs.writeFileSync(path.join(sub, 'g.txt'), 'sub\n');
    g(sub, 'add', '.');
    g(sub, 'commit', '-qm', 'sub');
    g(repo, 'add', '.');
    g(repo, 'commit', '-qm', 'base');
    // the submodule's commit moves, so a patch diff with diff.submodule=diff would start `git diff` inside it (review on #722)
    fs.writeFileSync(path.join(sub, 'g.txt'), 'sub2\n');
    g(sub, 'commit', '-qam', 'sub2');
    const hooks = path.join(root, 'hooks');
    fs.mkdirSync(hooks);
    for (const h of ['post-index-change', 'reference-transaction', 'pre-auto-gc', 'post-checkout', 'fsmonitor-watchman']) {
      fs.writeFileSync(path.join(hooks, h), `#!/bin/sh\n${cmd('hook-' + h)}\n`);
      fs.chmodSync(path.join(hooks, h), 0o755);
    }
    const plant: Array<[string, string]> = [
      ['core.fsmonitor', cmd('fsmonitor')],
      ['filter.evil.clean', cmd('clean') + '; cat'],
      ['filter.evil.smudge', cmd('smudge') + '; cat'],
      ['filter.evil.required', 'true'],
      ['filter.evil2.process', cmd('process')],
      ['diff.evil.textconv', cmd('textconv') + '; cat'],
      ['diff.evil.command', cmd('diffcommand')],
      ['diff.external', cmd('external')],
      ['core.pager', cmd('pager') + '; cat'],
      ['pager.status', cmd('pagerstatus') + '; cat'],
      ['pager.diff', cmd('pagerdiff') + '; cat'],
      ['core.editor', cmd('editor')],
      ['sequence.editor', cmd('seqeditor')],
      ['core.hooksPath', slash(hooks)],
      ['core.sshCommand', cmd('ssh')],
      ['gpg.program', cmd('gpg')],
      ['log.showSignature', 'true'],
      ['alias.st', '!' + cmd('alias')],
      ['alias.status', '!' + cmd('aliasstatus')], // git never lets an alias replace a built-in; planted to prove it
      ['diff.submodule', 'diff'],
      ['status.submoduleSummary', 'true'],
      ['credential.helper', '!' + cmd('credential')],
    ];
    for (const [k, v] of plant) g(repo, 'config', k, v);
    g(sub, 'config', 'core.fsmonitor', cmd('subfsmonitor'));
    g(sub, 'config', 'filter.subevil.clean', cmd('subclean') + '; cat');
    g(sub, 'config', 'diff.subdrv.command', cmd('subdiffcommand'));
    g(sub, 'config', 'diff.subdrv.textconv', cmd('subtextconv') + '; cat');
    g(sub, 'config', 'diff.external', cmd('subexternal'));
    sameSize(path.join(repo, 'a.txt'), 'ONE\n');
    sameSize(path.join(repo, 'b.txt'), 'TWO\n');
    sameSize(path.join(sub, 'g.txt'), 'SUB2\n');

    // a partial clone whose missing blob a diff would fetch over ssh (core.sshCommand) unless every transport is refused
    const lazy = path.join(root, 'lazy');
    fs.mkdirSync(lazy);
    g(lazy, 'init', '-q');
    fs.writeFileSync(path.join(lazy, 'f.txt'), 'old\n');
    g(lazy, 'add', '.');
    g(lazy, 'commit', '-qm', 'base');
    const blob = g(lazy, 'rev-parse', 'HEAD:f.txt').trim();
    const obj = path.join(lazy, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    fs.chmodSync(obj, 0o644); // git writes objects read-only, which Windows refuses to delete
    fs.rmSync(obj);
    for (const [k, v] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', 'ssh://example.invalid/x'], ['remote.origin.promisor', 'true'], ['core.sshCommand', cmd('lazyssh')]]) g(lazy, 'config', k, v);
    fs.writeFileSync(path.join(lazy, 'f.txt'), 'new\n');

    // the same over a remote helper the folder allows itself (protocol.testhelper.allow=always, url testhelper::x), on a git
    // that ignores GIT_NO_LAZY_FETCH (simulated: the runner below drops it). git starts `git-remote-testhelper` from PATH
    // (a #!/bin/sh file, which Git for Windows runs too) unless GIT_ALLOW_PROTOCOL is empty (review on #722)
    const helpers = path.join(root, 'helpers');
    fs.mkdirSync(helpers);
    fs.writeFileSync(path.join(helpers, 'git-remote-testhelper'), `#!/bin/sh\n${cmd('remotehelper')}\nexit 1\n`);
    fs.chmodSync(path.join(helpers, 'git-remote-testhelper'), 0o755);
    const lazy2 = path.join(root, 'lazy2');
    fs.mkdirSync(lazy2);
    g(lazy2, 'init', '-q');
    fs.writeFileSync(path.join(lazy2, 'f.txt'), 'old\n');
    g(lazy2, 'add', '.');
    g(lazy2, 'commit', '-qm', 'base');
    const blob2 = g(lazy2, 'rev-parse', 'HEAD:f.txt').trim();
    const obj2 = path.join(lazy2, '.git', 'objects', blob2.slice(0, 2), blob2.slice(2));
    fs.chmodSync(obj2, 0o644);
    fs.rmSync(obj2);
    for (const [k, v] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', 'testhelper::x'], ['remote.origin.promisor', 'true'], ['protocol.testhelper.allow', 'always'], ['protocol.allow', 'always'], ['credential.helper', '!' + cmd('lazycredential')]]) g(lazy2, 'config', k, v);
    fs.writeFileSync(path.join(lazy2, 'f.txt'), 'new\n');
    const oldGit = makeGitExec(execFileGitRun((file, argv, opts, cb) => {
      const env = { ...opts.env };
      delete env.GIT_NO_LAZY_FETCH;
      const pk = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[pk] = helpers + path.delimiter + (env[pk] ?? '');
      return execFile(file, argv, { ...opts, env }, cb);
    }));

    // every call the app makes, through the real runner
    const st = await folderGitStatus(repo, nodeGitExec);
    await nodeGitExec(['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD']);
    await nodeGitExec(['-C', repo, 'rev-list', '--count', 'HEAD']);
    await nodeGitExec(['-C', repo, 'diff', '--shortstat', 'HEAD', '--']).catch(() => '');
    await nodeGitExec(['-C', repo, 'diff', 'HEAD']).catch(() => ''); // a full patch: the diff that would run diff.external, the driver command and textconv
    await nodeGitExec(['-C', lazy, 'diff', 'HEAD', '--numstat', '-z']).catch(() => '');
    await folderGitStatus(lazy, nodeGitExec);
    await oldGit(['-C', lazy2, 'diff', 'HEAD', '--numstat', '-z']).catch(() => '');
    await folderGitStatus(lazy2, oldGit);
    // Durbar's own GIT_DIR (or any GIT_*) does not redirect git to another repository (review on #722)
    const savedDir = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(lazy, '.git');
    const stEnv = await folderGitStatus(repo, nodeGitExec).finally(() => { if (savedDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = savedDir; });
    // a caller's flag that would undo an override is refused before git starts
    for (const f of ['--textconv', '--ext-diff', '--submodule=diff', '--ignore-submodules=none']) await assert.rejects(nodeGitExec(['-C', repo, 'diff', f, 'HEAD']), /option not allowed/, f);
    // refused without running git: a writing command, and an alias name
    await assert.rejects(nodeGitExec(['-C', repo, 'st']), /not allowed/);
    await assert.rejects(nodeGitExec(['-C', repo, 'commit', '-m', 'x']), /not allowed/);
    await assert.rejects(nodeGitExec(['-C', repo, '-c', 'core.fsmonitor=x', 'status']), /not allowed/, 'a caller cannot add its own -c');

    const ran = fs.readdirSync(marks).sort();
    assert.deepStrictEqual(ran, [], 'no command from the folder config ran: ' + ran.join(', '));
    // and the status is still right (filters off: the files compare by their raw bytes)
    assert.ok(st.repo, 'still a repository');
    const want = ['modified:a.txt', 'modified:b.txt', 'modified:s'];
    if (st.repo) assert.deepStrictEqual(st.files.map((f) => `${f.state}:${f.path}`).sort(), want, 'a.txt and b.txt changed, the moved submodule shows; its own changes are not read');
    assert.ok(stEnv.repo && stEnv.files.map((f) => `${f.state}:${f.path}`).sort().join() === want.join(), 'a GIT_DIR in Durbar\'s environment does not redirect the status: ' + JSON.stringify(stEnv));
    console.log(`gitstatus: real git (${execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()}): ${plant.length + 12} planted settings, a remote helper and a GIT_DIR, none ran`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(realGitCheck).catch((e) => { console.error(e); process.exit(1); });
