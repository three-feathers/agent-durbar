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
import { EventEmitter } from 'events';
import { GIT_CLONE_PROTOCOLS, GIT_MAX_FILES, GIT_TRANSPORTS, SSH_COMMAND_READ, execFileGitRun, sshCommandReadArgv, filterDrivers, folderGitStatus, gitCreateCall, gitEnv, gitSshCommandFor, makeGitExec, nodeGitExec, parseNumstatZ, parsePorcelainZ, readUserSshCommand, runGitCreate } from '../src/main/gitstatus';
import type { GitChild, GitCreateRequest, GitExec, GitSpawnOptions } from '../src/main/gitstatus';

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
  assert.strictEqual(await fake('local\0filter.evil.clean\0local\0filter.evil.process\0worktree\0filter.a.b.smudge\0global\0filter.lfs.clean\0system\0filter.crypt.smudge\0')(['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']), 'out');
  const [list, call] = calls;
  const pairs = (argv: string[]): string[] => argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));
  for (const c of ['core.fsmonitor=false', 'core.useBuiltinFSMonitor=false', 'protocol.allow=never', 'protocol.file.allow=never', 'protocol.git.allow=never', 'protocol.ssh.allow=never', 'protocol.http.allow=never', 'protocol.https.allow=never', 'protocol.ext.allow=never', 'log.showSignature=false', 'credential.helper=', 'diff.submodule=short', 'status.submoduleSummary=false']) {
    assert.ok(pairs(call.argv).includes(c), 'the call overrides ' + c);
    assert.ok(pairs(list.argv).includes(c), 'the config read overrides ' + c);
  }
  for (const d of ['evil', 'a.b']) for (const kv of ['clean=', 'smudge=', 'process=', 'required=false']) assert.ok(pairs(call.argv).includes(`filter.${d}.${kv}`), `filter ${d} ${kv}`);
  for (const d of ['lfs', 'crypt']) assert.ok(pairs(call.argv).includes(`filter.${d}.clean=`), `the user's own driver ${d} is off too (a trusted filter can still run the folder's config, round 3 on #722)`);
  assert.deepStrictEqual(call.argv.slice(0, 2), ['--no-pager', '--no-optional-locks'], 'global options first');
  assert.deepStrictEqual(call.argv.slice(call.argv.indexOf('-C')), ['-C', '/w/api', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--submodule=short', 'HEAD', '--numstat', '-z'], 'diff: no external diff, no textconv, submodules not entered');
  assert.deepStrictEqual(list.argv.slice(list.argv.indexOf('-C')), ['-C', '/w/api', 'config', '-z', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], 'the driver names are read in the same folder, from every config file');
  for (const e of [list.env, call.env]) assert.deepStrictEqual([e.GIT_NO_LAZY_FETCH, e.GIT_ALLOW_PROTOCOL, e.GIT_TERMINAL_PROMPT, e.GIT_OPTIONAL_LOCKS], ['1', '', '0', '0'], 'env');
  // Durbar's own GIT_* variables (and SSH_ASKPASS) never reach git; other variables do; Windows names in any case
  const hostile = { PATH: '/bin', HOME: '/h', GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/e', GIT_INDEX_FILE: '/i', GIT_COMMON_DIR: '/c', GIT_OBJECT_DIRECTORY: '/o', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/a', GIT_NAMESPACE: 'n', GIT_CONFIG: '/x', GIT_CONFIG_GLOBAL: '/x', GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='x'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'x', GIT_EXTERNAL_DIFF: 'x', GIT_PAGER: 'x', GIT_ASKPASS: 'x', GIT_SSH_COMMAND: 'x', GIT_EXEC_PATH: '/x', GIT_CEILING_DIRECTORIES: '/', Git_Dir: '/mixed', SSH_ASKPASS: 'x', GIT_NO_LAZY_FETCH: '0', GIT_ALLOW_PROTOCOL: 'ext' };
  assert.deepStrictEqual(gitEnv(hostile), { PATH: '/bin', HOME: '/h', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, 'child env: every GIT_* of Durbar dropped, the safe ones set');
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = '/elsewhere/.git';
  calls.length = 0;
  await fake('')(['-C', '/w/api', 'rev-list', '--count', 'HEAD']);
  const expectEnv = gitEnv(process.env); // a plain object: on Windows its PATH key keeps its own case ("Path"), so compare whole objects
  if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
  assert.ok(calls.length === 2 && calls.every((c) => !Object.keys(c.env).some((k) => k.toUpperCase() === 'GIT_DIR')), 'no GIT_DIR reaches git');
  for (const c of calls) assert.deepStrictEqual(c.env, expectEnv, 'the runner builds its env with gitEnv');
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
  for (const ok of [['-C', '/w', 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'], ['-C', '/w', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], ['-C', '/w', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], ['-C', '/w', 'diff', 'HEAD', '--numstat', '-z'], ['-C', '/w', 'rev-parse', '--verify', '-q', 'HEAD'], ['-C', '/w', 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', 'abc123', '--'], ['-C', '/w', 'diff', '--no-ext-diff', '--no-textconv', '--numstat', 'abc123', '--', '-odd-name'], ['-C', '/w', 'rev-list', '--count', 'abc123..HEAD'], ['-C', '/w', 'rev-list', '--count', 'HEAD']]) await fake('')(ok);
  calls.length = 0;
  assert.strictEqual(calls.length, 0, 'nothing ran for a refused call');
  // a driver name -c cannot express is refused (git splits -c at the first "=")
  await assert.rejects(fake('local\0filter.a=b.clean\0')(['-C', '/w', 'status']), /cannot be overridden/);
  assert.deepStrictEqual(filterDrivers('filter.x.clean\0filter.x.process\0filter.y.z.process\0filter.lfs.clean\0filter.Sys.smudge\0filterx.clean\0filter.r.required\0'), ['x', 'y.z', 'lfs', 'Sys'], 'every driver with a command, whatever its config file');
  // "no filter at all" (git config exits 1) is fine; any other failure of the config read fails the call
  const exit = (code: number): GitExec => makeGitExec(async (argv) => { if (argv.includes('config')) throw Object.assign(new Error('x'), { code }); return 'ok'; });
  assert.strictEqual(await exit(1)(['-C', '/w', 'status']), 'ok');
  await assert.rejects(exit(128)(['-C', '/w', 'status']));
  // the exact file, argv and execFile options of a real call (a fake execFile): shell:true, a missing override or another
  // time/size bound fails here; the source check below ties nodeGitExec to exactly this runner over Node's execFile
  const efCalls: Array<{ file: string; argv: string[]; opts: Record<string, unknown> }> = [];
  const fakeEf = makeGitExec(execFileGitRun((file, argv, opts, cb) => { efCalls.push({ file, argv, opts: opts as unknown as Record<string, unknown> }); cb(null, argv.includes('config') ? 'local\0filter.lfs.clean\0' : 'ok'); }));
  assert.strictEqual(await fakeEf(['-C', '/w/api', 'diff', 'HEAD', '--numstat', '-z']), 'ok');
  const SAFE = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=never', '-c', 'protocol.git.allow=never', '-c', 'protocol.ssh.allow=never', '-c', 'protocol.http.allow=never', '-c', 'protocol.https.allow=never', '-c', 'protocol.ext.allow=never', '-c', 'log.showSignature=false', '-c', 'credential.helper=', '-c', 'diff.submodule=short', '-c', 'status.submoduleSummary=false'];
  assert.deepStrictEqual(efCalls.map((c) => c.file), ['git', 'git']);
  assert.deepStrictEqual(efCalls[0].argv, [...SAFE, '-C', '/w/api', 'config', '-z', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], 'exact argv: the driver-name read');
  assert.deepStrictEqual(efCalls[1].argv, [...SAFE, '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', '-C', '/w/api', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--submodule=short', 'HEAD', '--numstat', '-z'], 'exact argv: the call');
  for (const c of efCalls) {
    const { env, ...rest } = c.opts;
    assert.deepStrictEqual(rest, { timeout: 4000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, encoding: 'utf8' }, 'exact execFile options: no shell, 4 s, 512 KB');
    const e = env as NodeJS.ProcessEnv;
    assert.deepStrictEqual(e, gitEnv(process.env), 'execFile env');
  }
  const src = (require('fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'gitstatus.ts'), 'utf8') as string).replace(/\r\n/g, '\n');
  assert.ok(/export const nodeGitExec: GitExec = makeGitExec\(execFileGitRun\(execFile as unknown as ExecFileFn\)\);/.test(src), 'nodeGitExec is makeGitExec over execFileGitRun over Node execFile');
  // spec 093 FR-030, FR-034: execFile for the read-only runner, spawn for the create entry point; nothing else
  assert.deepStrictEqual(src.match(/^import .*child_process.*$/gm), ["import { execFile, spawn } from 'child_process';", "import type { ChildProcess } from 'child_process';"], 'only execFile and spawn are imported from child_process');
  assert.strictEqual((src.match(/\b(?:execFile|spawn|execSync|execFileSync|spawnSync|fork)\(/g) ?? []).length, 0, 'no other process call in gitstatus.ts');
  assert.strictEqual((src.match(/ef\('git', argv, gitExecOptions\(env\)/g) ?? []).length, 1, 'the one read-only git process call uses gitExecOptions');
  assert.strictEqual((src.match(/\bsp\('git', argv, gitSpawnOptions\(cwd, env, platform\)\)/g) ?? []).length, 1, 'the one create git process call uses gitCreateCall\'s argv and gitSpawnOptions');
  assert.strictEqual((src.match(/\bsp\(/g) ?? []).length, 1, 'and nothing else is spawned');
  assert.ok(/const sp: GitSpawn = deps\.spawn \?\? \(spawn as unknown as GitSpawn\);/.test(src), "the create runner reads child_process's spawn when it runs (the simulator's seal applies)");
  assert.ok(src.includes("const { argv, env } = gitCreateCall(req, { hooksDir: deps.hooksDir, env: deps.env, userSshCommand: deps.userSshCommand, platform: deps.platform }); // never the protocols seam (FR-095)"), 'the create runner takes its argv and env from gitCreateCall only, with the default protocols (no seam)');
  // spec 093 FR-033: the clone's one config read is a fixed argv in the private hooks folder, with the read-only runner's options
  assert.strictEqual((src.match(/\bef\('git', sshCommandReadArgv\(o\.url\), \{ \.\.\.gitExecOptions\(env\), cwd: o\.hooksDir \}/g) ?? []).length, 1, 'the core.sshCommand read: fixed argv, gitExecOptions, in the hooks folder');
  assert.strictEqual((src.match(/\bef\(/g) ?? []).length, 2, 'and no other execFile call in gitstatus.ts');
  // FR-095: nothing in src/ passes the protocols seam (a third argument to gitCreateCall) or names `file` as an allowed protocol
  {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const SRC = path.join(__dirname, '..', '..', 'src');
    const calls = walk(SRC).flatMap((f) => (fs.readFileSync(f, 'utf8').match(/\bgitCreateCall\([^;]*/g) ?? []).map((c) => [path.relative(SRC, f), c] as const));
    assert.ok(calls.length >= 1 && calls.every(([f]) => f === path.join('main', 'gitstatus.ts')), 'only gitstatus.ts calls gitCreateCall: ' + JSON.stringify(calls));
    assert.ok(!walk(SRC).some((f) => /\bprotocols:\s*\[\s*['"]file/.test(fs.readFileSync(f, 'utf8'))), 'no protocols: [\'file\'] anywhere in src/');
  }
  // FR-030: no other file in src/ starts git (a git binary name as the file of a process call)
  {
    const walkTs = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkTs(path.join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const SRC = path.join(__dirname, '..', '..', 'src');
    const STARTS_GIT = /\b(?:execFile|execFileSync|spawn|spawnSync|exec|execSync|fork|sp|ef)\s*\(\s*['"`](?:[^'"`]*[\\/])?git(?:\.exe)?['"`]/;
    const files = walkTs(SRC);
    assert.ok(files.length > 100, 'src/ is scanned');
    const others = files.filter((f) => path.basename(f) !== 'gitstatus.ts' && STARTS_GIT.test(fs.readFileSync(f, 'utf8')));
    assert.deepStrictEqual(others.map((f) => path.relative(SRC, f)), [], 'only src/main/gitstatus.ts starts git');
    for (const sample of ["spawn('git', a)", 'execFile("git", a, cb)', "spawnSync('/usr/bin/git', a)", "execFile('C:\\\\Git\\\\bin\\\\git.exe', a)"]) assert.ok(STARTS_GIT.test(sample), `the scan sees ${sample}`);
  }

  await createEntryChecks();

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
/** Spec 093 FR-030..FR-034: the create entry point's exact argv, environment and spawn options (fakes only; the real git runs in test:newfoldergit). */
async function createEntryChecks(): Promise<void> {
  assert.deepStrictEqual([...GIT_TRANSPORTS], ['file', 'git', 'ssh', 'http', 'https', 'ext', 'fd', 'ftp', 'ftps'], 'every transport git ships');
  const base: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/h', GIT_DIR: '/elsewhere/.git', git_config_global: '/y', GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/evil'", GIT_SSL_NO_VERIFY: '1', GIT_PROXY_COMMAND: 'x', GIT_SSH: 's', GIT_SSH_COMMAND: 'ssh -x', GIT_TEMPLATE_DIR: '/t', SSH_ASKPASS: 'a', HTTPS_PROXY: 'http://proxy.example:3128', SSH_AUTH_SOCK: '/run/agent' };
  const init = gitCreateCall({ kind: 'init' }, { hooksDir: '/tmp/durbar-hooks-1', env: base });
  const NEVER = ['file', 'git', 'ssh', 'http', 'https', 'ext', 'fd', 'ftp', 'ftps'].flatMap((p) => ['-c', `protocol.${p}.allow=never`]);
  assert.deepStrictEqual(init.argv, ['--no-pager', '-c', 'core.hooksPath=/tmp/durbar-hooks-1', '-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never', ...NEVER, 'init', '--quiet'], 'init: exact argv (every -c before the subcommand, no path, every transport off)');
  assert.ok(!init.argv.some((a) => /^credential\.helper/.test(a)), 'credential.helper is not touched (D7)');
  assert.deepStrictEqual(Object.keys(init.env).filter((k) => /^git_/i.test(k)).sort(), ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT'], "init: none of the user's GIT_* reach git, only the safe ones");
  assert.deepStrictEqual([init.env.GIT_ALLOW_PROTOCOL, init.env.GIT_TERMINAL_PROMPT], ['', '0'], 'init: no transport at all, never a prompt');
  assert.deepStrictEqual([init.env.PATH, init.env.HTTPS_PROXY, init.env.SSH_AUTH_SOCK, init.env.SSH_ASKPASS], ['/usr/bin', 'http://proxy.example:3128', '/run/agent', undefined], 'PATH and the non-GIT variables pass; SSH_ASKPASS is dropped');
  const probeKey = 'DURBAR_093_ENV_PROBE';
  process.env[probeKey] = '1';
  try { assert.strictEqual(gitCreateCall({ kind: 'init' }, { hooksDir: '/x', env: base }).env[probeKey], undefined, "the injected environment is the one used (not Durbar's own)"); } finally { delete process.env[probeKey]; }
  assert.throws(() => gitCreateCall({ kind: 'status' } as unknown as GitCreateRequest, { hooksDir: '/x' }), /not allowed/);
  assert.throws(() => gitCreateCall(null as unknown as GitCreateRequest, { hooksDir: '/x' }), /not allowed/);
  assert.throws(() => gitCreateCall({ kind: 'init' }, { hooksDir: '' }), /hooks folder/, 'no run without the private hooks folder');

  await cloneCallChecks(base);

  // runGitCreate over a fake spawn: the file, argv and options of the real call, its output and end, Cancel
  type Rec = { file: string; args: string[]; opts: GitSpawnOptions };
  const calls: Rec[] = [];
  const kids: Array<EventEmitter & { pid?: number; exitCode: number | null; signalCode: string | null; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean }> = [];
  const fakeSpawn = (pid: number | undefined) => (file: string, args: string[], opts: GitSpawnOptions): GitChild => {
    calls.push({ file, args, opts });
    const k = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    kids.push(k);
    return k as unknown as GitChild;
  };
  const killed: Array<{ pid?: number; platform: string }> = [];
  const kill = ((c: { pid?: number }, platform: NodeJS.Platform) => { killed.push({ pid: c.pid, platform }); }) as never;
  for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
    calls.length = 0;
    const seen: string[] = [];
    const h = runGitCreate({ kind: 'init' }, '/w/new', { hooksDir: '/tmp/durbar-hooks-2', env: base, platform, spawn: fakeSpawn(4242), kill, onOutput: (t) => seen.push(t) });
    const want = gitCreateCall({ kind: 'init' }, { hooksDir: '/tmp/durbar-hooks-2', env: base });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].file, 'git', 'git from PATH');
    assert.deepStrictEqual(calls[0].args, want.argv, 'the argv is gitCreateCall\'s');
    const { env, ...opts } = calls[0].opts;
    assert.deepStrictEqual(env, want.env, 'the env is gitCreateCall\'s');
    assert.deepStrictEqual(opts, { cwd: '/w/new', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: platform !== 'win32' }, `${platform}: no shell, no window, stdin closed, its own process group on POSIX`);
    const k = kids[kids.length - 1];
    k.stderr.emit('data', Buffer.from('hint: Using master\n'));
    h.cancel();
    assert.deepStrictEqual(killed.pop(), { pid: 4242, platform }, `${platform}: Cancel ends the tree through killChildTree`);
    k.exitCode = 0;
    k.emit('close', 0, null);
    const r = await h.done;
    assert.deepStrictEqual(r, { code: 0, signal: null, stderrTail: 'hint: Using master\n' });
    assert.deepStrictEqual(seen, ['hint: Using master\n'], 'each piece of output is handed on');
    h.cancel();
    assert.strictEqual(killed.length, 0, 'no kill after the child exited (its pid may be another process now)');
  }
  // git not installed: spawn throws, or emits error without a pid; both end with spawnError ENOENT and nothing to kill
  const thrown = runGitCreate({ kind: 'init' }, '/w', { hooksDir: '/h', spawn: () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }); }, kill });
  assert.deepStrictEqual(await thrown.done, { code: null, signal: null, stderrTail: '', spawnError: 'ENOENT' });
  const noPid = runGitCreate({ kind: 'init' }, '/w', { hooksDir: '/h', spawn: fakeSpawn(undefined), kill });
  kids[kids.length - 1].emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
  assert.deepStrictEqual(await noPid.done, { code: null, signal: null, stderrTail: '', spawnError: 'ENOENT' });
  noPid.cancel();
  assert.strictEqual(killed.length, 0, 'nothing to kill when git never started');
  // an error from a child that did start (it has a pid) does not settle the run: the caller removes the folder only after git has
  // exited, so `done` waits for close (review on 11183593, mutant M11: finishing on every error)
  {
    const started = runGitCreate({ kind: 'init' }, '/w', { hooksDir: '/h', spawn: fakeSpawn(5150), kill });
    const sk = kids[kids.length - 1];
    let settled = false;
    void started.done.then(() => { settled = true; });
    sk.stderr.emit('data', 'fatal: x\n');
    sk.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.strictEqual(settled, false, 'an error from a running child does not end the run before it has exited');
    sk.exitCode = 1;
    sk.emit('close', 1, null);
    assert.deepStrictEqual(await started.done, { code: 1, signal: null, stderrTail: 'fatal: x\n', spawnError: 'EPERM' }, 'it ends on close, with the error code kept');
  }
  // the tail keeps the end of a long output
  const long = runGitCreate({ kind: 'init' }, '/w', { hooksDir: '/h', spawn: fakeSpawn(7), kill });
  const lk = kids[kids.length - 1];
  lk.stderr.emit('data', 'x'.repeat(20000));
  lk.stderr.emit('data', 'fatal: the end\n');
  lk.emit('close', 128, null);
  const lr = await long.done;
  assert.ok(lr.stderrTail.endsWith('fatal: the end\n') && lr.stderrTail.length === 8192 && lr.code === 128, 'the last 8 KB of stderr are kept');
  console.log('gitstatus: create entry point (spec 093): init argv/env, spawn options per platform, cancel, missing git OK');
}

/** Spec 093 phase 2 (T032, T033, T044): the clone's exact argv and environment, the D11 ssh rule, the CA pass-through, the seam. */
async function cloneCallChecks(base: NodeJS.ProcessEnv): Promise<void> {
  const URL = 'git@github.com:o/r.git';
  const c = gitCreateCall({ kind: 'clone', url: URL }, { hooksDir: '/tmp/durbar-hooks-9', env: base });
  const CLONE_CFG = ['core.hooksPath=/tmp/durbar-hooks-9', 'core.fsmonitor=false', 'core.useBuiltinFSMonitor=false', 'submodule.recurse=false', 'protocol.allow=never',
    'protocol.file.allow=never', 'protocol.git.allow=never', 'protocol.ssh.allow=always', 'protocol.http.allow=never', 'protocol.https.allow=always', 'protocol.ext.allow=never', 'protocol.fd.allow=never', 'protocol.ftp.allow=never', 'protocol.ftps.allow=never',
    'transfer.credentialsInUrl=die', 'transfer.bundleURI=false', 'core.protectNTFS=true', 'core.protectHFS=true'];
  assert.deepStrictEqual(c.argv, ['--no-pager', ...CLONE_CFG.flatMap((x) => ['-c', x]), 'clone', '--progress', '--no-recurse-submodules', '--', URL, '.'], 'clone: exact argv (every -c before the subcommand, -- before the URL, . last)');
  assert.ok(!c.argv.some((a) => /^(credential\.helper|filter\.|core\.sshCommand)/.test(a)), "the user's credential helper and filter drivers are kept (D7, Q5); no sshCommand override in argv");
  assert.deepStrictEqual([...GIT_CLONE_PROTOCOLS], ['https', 'ssh'], 'the default protocols');
  assert.deepStrictEqual(Object.keys(c.env).filter((k) => /^git_/i.test(k)).sort(), ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_OPTIONAL_LOCKS', 'GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT'], "clone: none of the user's GIT_* (GIT_SSL_NO_VERIFY, GIT_PROXY_COMMAND, GIT_SSH, GIT_CONFIG_*, GIT_DIR...) reach git");
  assert.deepStrictEqual([c.env.GIT_ALLOW_PROTOCOL, c.env.GIT_TERMINAL_PROMPT, c.env.GIT_SSH_COMMAND], ['https:ssh', '0', 'ssh -o BatchMode=yes'], 'https and ssh only, never a prompt, ssh in BatchMode');
  assert.deepStrictEqual([c.env.HTTPS_PROXY, c.env.SSH_AUTH_SOCK, c.env.SSH_ASKPASS, c.env.PATH], ['http://proxy.example:3128', '/run/agent', undefined, '/usr/bin'], 'the proxy and the ssh agent pass; SSH_ASKPASS does not');
  // R4: GIT_SSL_CAINFO / GIT_SSL_CAPATH pass only as absolute paths (any case of the name); nothing else of GIT_SSL_*
  const abs = path.resolve('ca', 'corp.pem');
  const caEnv = { ...base, GIT_SSL_CAINFO: abs, git_ssl_capath: path.resolve('certs'), GIT_SSL_CERT: abs, GIT_SSL_NO_VERIFY: 'true' };
  const ca = gitCreateCall({ kind: 'clone', url: URL }, { hooksDir: '/h', env: caEnv, platform: 'win32' }).env;
  assert.deepStrictEqual([ca.GIT_SSL_CAINFO, ca.GIT_SSL_CAPATH, ca.GIT_SSL_CERT, ca.GIT_SSL_NO_VERIFY, ca.git_ssl_capath], [abs, path.resolve('certs'), undefined, undefined, undefined], 'Windows: the two CA paths pass, absolute, under their upper-case name (names ignore case there)');
  const caPosix = gitCreateCall({ kind: 'clone', url: URL }, { hooksDir: '/h', env: caEnv, platform: 'linux' }).env;
  assert.deepStrictEqual([caPosix.GIT_SSL_CAINFO, caPosix.GIT_SSL_CAPATH, caPosix.git_ssl_capath], [abs, undefined, undefined], 'POSIX: names are case-sensitive, a lower-case git_ssl_capath is another variable and is dropped');
  for (const rel of ['ca.pem', './ca.pem', '../ca.pem', '', '~/ca.pem']) assert.strictEqual(gitCreateCall({ kind: 'clone', url: URL }, { hooksDir: '/h', env: { ...base, GIT_SSL_CAINFO: rel, GIT_SSL_CAPATH: rel } }).env.GIT_SSL_CAINFO, undefined, `a relative CA path is dropped: ${JSON.stringify(rel)}`);
  // init gets no CA variable and no ssh command (no transport at all)
  const ini = gitCreateCall({ kind: 'init' }, { hooksDir: '/h', env: { ...base, GIT_SSL_CAINFO: abs } }).env;
  assert.deepStrictEqual([ini.GIT_SSL_CAINFO, ini.GIT_SSH_COMMAND, ini.GIT_ALLOW_PROTOCOL], [undefined, undefined, '']);
  // D11: the user's own core.sshCommand
  const sshFor = (u: string | undefined): string | undefined => gitCreateCall({ kind: 'clone', url: URL }, { hooksDir: '/h', env: base, userSshCommand: u }).env.GIT_SSH_COMMAND;
  for (const [u, want] of [
    [undefined, 'ssh -o BatchMode=yes'], ['', 'ssh -o BatchMode=yes'], ['   ', 'ssh -o BatchMode=yes'],
    ['ssh', 'ssh -o BatchMode=yes'], ['ssh -i ~/.ssh/work', 'ssh -i ~/.ssh/work -o BatchMode=yes'], ['/usr/bin/ssh -v', '/usr/bin/ssh -v -o BatchMode=yes'],
    ['"C:\\Program Files\\OpenSSH\\ssh.exe"', '"C:\\Program Files\\OpenSSH\\ssh.exe" -o BatchMode=yes'], ["'/opt/my ssh/ssh' -F cfg", "'/opt/my ssh/ssh' -F cfg -o BatchMode=yes"], ['C:/Windows/System32/OpenSSH/SSH.EXE', 'C:/Windows/System32/OpenSSH/SSH.EXE -o BatchMode=yes'], ['ssh -o BatchMode=no', 'ssh -o BatchMode=no -o BatchMode=yes'],
    ['plink', undefined], ['"C:\\Program Files\\PuTTY\\plink.exe" -batch', undefined], ['/usr/local/bin/my-ssh-wrapper', undefined], ['sshpass -p x ssh', undefined], ['env A=1 ssh', undefined], ['"unclosed ssh', undefined], ['ssh.sh', undefined], ['xssh', undefined],
  ] as Array<[string | undefined, string | undefined]>) assert.strictEqual(sshFor(u), want, `core.sshCommand ${JSON.stringify(u)} -> ${String(want)}`);
  assert.strictEqual(gitSshCommandFor(undefined), 'ssh -o BatchMode=yes');
  // the URL is checked again here, and the seam takes only known protocols
  for (const bad of ['file:///x', 'ext::sh -c x', '-u', 'https://u:p@h/x', 'https://h/x y', '', 42]) assert.throws(() => gitCreateCall({ kind: 'clone', url: bad } as GitCreateRequest, { hooksDir: '/h' }), /clone URL not allowed/, `refused again by the runner: ${String(bad)}`);
  const seam = gitCreateCall({ kind: 'clone', url: 'https://h/x.git' }, { hooksDir: '/h', env: base }, ['file']);
  assert.deepStrictEqual(seam.argv.filter((a) => /^protocol\./.test(a)), ['protocol.allow=never', 'protocol.file.allow=always', 'protocol.git.allow=never', 'protocol.ssh.allow=never', 'protocol.http.allow=never', 'protocol.https.allow=never', 'protocol.ext.allow=never', 'protocol.fd.allow=never', 'protocol.ftp.allow=never', 'protocol.ftps.allow=never'], "the seam's file: only file allowed, every other transport by name off");
  assert.strictEqual(seam.env.GIT_ALLOW_PROTOCOL, 'file');
  for (const p of [['ext'], ['fd'], ['https', 'ext'], [], ['foo'], 'file' as unknown as string[]]) assert.throws(() => gitCreateCall({ kind: 'clone', url: 'https://h/x.git' }, { hooksDir: '/h' }, p), /protocols not allowed/, `seam refuses ${JSON.stringify(p)}`);
  // runGitCreate never passes the seam: a request through it (fake spawn) has https:ssh only
  const seen: string[][] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const k = runGitCreate({ kind: 'clone', url: 'https://h/x.git' }, '/w', { hooksDir: '/h', env: base, userSshCommand: 'plink', spawn: (_f: string, a: string[], o: GitSpawnOptions) => { seen.push(a); envs.push(o.env); const e = Object.assign(new EventEmitter(), { pid: 1, exitCode: 0, signalCode: null, stdout: null, stderr: null, kill: () => true }); setImmediate(() => e.emit('close', 0, null)); return e as unknown as GitChild; }, protocols: ['file'] } as never);
  await k.done;
  assert.ok(seen[0].includes('protocol.https.allow=always') && seen[0].includes('protocol.file.allow=never') && envs[0].GIT_ALLOW_PROTOCOL === 'https:ssh', 'runGitCreate ignores a protocols field: https and ssh only');
  assert.strictEqual(envs[0].GIT_SSH_COMMAND, undefined, "plink in core.sshCommand: Durbar's GIT_SSH_COMMAND is not set, git uses the user's own");
  // readUserSshCommand: one fixed read in the hooks folder, GIT_CEILING_DIRECTORIES its parent, the user's GIT_* dropped
  const reads: Array<{ file: string; args: string[]; opts: Record<string, unknown> }> = [];
  const ef = (out: string | null, code?: number) => ((file: string, args: string[], opts: unknown, cb: (e: Error | null, o: string) => void) => { reads.push({ file, args, opts: opts as Record<string, unknown> }); if (out === null) cb(Object.assign(new Error('x'), { code }), ''); else cb(null, out); }) as never;
  const hooks = path.resolve('tmp', 'durbar-hooks-x');
  assert.strictEqual(await readUserSshCommand({ hooksDir: hooks, env: base, execFile: ef('ssh -i k\n') }), 'ssh -i k');
  assert.deepStrictEqual(SSH_COMMAND_READ, ['--no-pager', '-c', 'core.fsmonitor=false', 'config', '--get', 'core.sshCommand']);
  assert.deepStrictEqual(sshCommandReadArgv(), [...SSH_COMMAND_READ], 'without a URL: the fixed read');
  const r0 = reads[0];
  assert.deepStrictEqual([r0.file, r0.args, r0.opts.cwd, r0.opts.shell, r0.opts.timeout], ['git', [...SSH_COMMAND_READ], hooks, false, 4000], 'git from PATH, the fixed argv, in the hooks folder, no shell, 4 s');
  const renv = r0.opts.env as NodeJS.ProcessEnv;
  assert.deepStrictEqual([renv.GIT_CEILING_DIRECTORIES, renv.GIT_DIR, renv.GIT_CONFIG_PARAMETERS, renv.HOME], [path.dirname(hooks), undefined, undefined, '/h'], 'GIT_CEILING_DIRECTORIES is the hooks folder\'s parent; the user\'s GIT_* are dropped; HOME passes (the global config)');
  // with the clone's URL: -c remote.origin.url=<url> before the subcommand, so includeIf "hasconfig:remote.*.url:…" is evaluated
  await readUserSshCommand({ hooksDir: hooks, url: 'HTTPS://github.com/o/r.git', env: base, execFile: ef('ssh') });
  assert.deepStrictEqual(reads[reads.length - 1].args, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'remote.origin.url=https://github.com/o/r.git', 'config', '--get', 'core.sshCommand'], 'the URL as git will get it');
  await readUserSshCommand({ hooksDir: hooks, url: 'ext::sh -c x', env: base, execFile: ef('ssh') });
  assert.deepStrictEqual(reads[reads.length - 1].args, [...SSH_COMMAND_READ], 'a refused URL is never put in the argv');
  assert.strictEqual(await readUserSshCommand({ hooksDir: hooks, env: base, execFile: ef(null, 1) }), undefined, 'unset (exit 1)');
  assert.strictEqual(await readUserSshCommand({ hooksDir: hooks, env: base, execFile: ef(null, 128) }), undefined, 'a failed read: unset (then BatchMode ssh, the safe side)');
  assert.strictEqual(await readUserSshCommand({ hooksDir: hooks, env: base, execFile: ef('x'.repeat(5000)) }), undefined, 'an oversized value is not used');
  assert.strictEqual(await readUserSshCommand({ hooksDir: hooks, env: base, execFile: (() => { throw new Error('spawn'); }) as never }), undefined);
  assert.strictEqual(await readUserSshCommand({ hooksDir: 'relative', env: base, execFile: ef('ssh') }), undefined, 'only in an absolute hooks folder');
  console.log('gitstatus: clone argv/env (spec 093 phase 2), D11 ssh rule, CA pass-through, URL re-check, seam, core.sshCommand read OK');
}

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
    // spec 085's calls exactly as #718 makes them (src/main/sessionsummary.ts on 085-session-summary, read 2026-10-25), each
    // must pass the option allow-list (a refusal would show "could not read git" on every summary card)
    await nodeGitExec(['-C', repo, 'status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    const ref = (await nodeGitExec(['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD'])).trim();
    assert.ok(/^[0-9a-f]{40,64}$/.test(ref), 'rev-parse through the runner');
    await nodeGitExec(['-C', repo, 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', ref, '--']);
    await nodeGitExec(['-C', repo, 'diff', '--no-ext-diff', '--no-textconv', '--numstat', ref, '--']);
    assert.strictEqual((await nodeGitExec(['-C', repo, 'rev-list', '--count', `${ref}..HEAD`])).trim(), '0');
    assert.strictEqual((await nodeGitExec(['-C', repo, 'rev-list', '--count', 'HEAD'])).trim(), '1');
    await nodeGitExec(['-C', repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
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

    // every filter driver is off, the user's own too (round 3 on #722): git-lfs, trusted in ~/.gitconfig, still runs
    // `lfs.extension.<name>.clean` from the folder's config as a command. Stand-in: a global filter that writes a marker and
    // then runs the folder's lfs.extension.x.clean, as git-lfs does. c.txt is stored through it (x -> X), d.txt through a
    // filter from the folder's own config; both are touched (old time) so status must re-hash them through their filters
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const gcfg = path.join(home, '.gitconfig');
    fs.writeFileSync(gcfg, '');
    const gc = (k: string, v: string): string => g(root, 'config', '--file', gcfg, k, v);
    gc('filter.userlfs.clean', `${cmd('globalfilter')}; eval "$(git config --get lfs.extension.x.clean)"; tr x X`);
    gc('filter.userlfs.required', 'true');
    const own = path.join(root, 'own');
    fs.mkdirSync(own);
    g(own, 'init', '-q');
    fs.writeFileSync(path.join(own, '.gitattributes'), 'c.txt filter=userlfs\nd.txt filter=localevil\n');
    fs.writeFileSync(path.join(own, 'c.txt'), 'x\n');
    fs.writeFileSync(path.join(own, 'd.txt'), 'd\n');
    g(own, '-c', 'filter.userlfs.clean=tr x X', 'add', '.');
    g(own, 'commit', '-qm', 'base');
    g(own, 'config', 'filter.localevil.clean', cmd('localclean') + '; cat');
    g(own, 'config', 'lfs.extension.x.clean', cmd('lfsextension'));
    sameSize(path.join(own, 'c.txt'), 'x\n');
    sameSize(path.join(own, 'd.txt'), 'd\n');
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    const stOwn = await folderGitStatus(own, nodeGitExec).finally(() => { if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome; });
    // the documented price (spec 063 FR-008, README): c.txt shows as changed, although plain git status (with the filter) is clean
    assert.deepStrictEqual(stOwn.repo && stOwn.files.map((f) => `${f.state}:${f.path}`), ['modified:c.txt'], "the user's global filter is off too: " + JSON.stringify(stOwn) + ' markers: ' + fs.readdirSync(marks).join(', '));

    const ran = fs.readdirSync(marks).sort();
    assert.deepStrictEqual(ran, [], 'no command from the folder config ran: ' + ran.join(', '));

    // positive control for GIT_ALLOW_PROTOCOL='' (review on #722): the same call without it must start the helper, so a pass on
    // a platform proves the empty value works there (and that git can start the fake helper at all)
    const noAllow = makeGitExec(execFileGitRun((file, argv, opts, cb) => {
      const env = { ...opts.env };
      delete env.GIT_NO_LAZY_FETCH;
      delete env.GIT_ALLOW_PROTOCOL;
      const pk = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[pk] = helpers + path.delimiter + (env[pk] ?? '');
      return execFile(file, argv, { ...opts, env }, cb);
    }));
    await noAllow(['-C', lazy2, 'diff', 'HEAD', '--numstat', '-z']).catch(() => '');
    assert.ok(fs.readdirSync(marks).includes('remotehelper'), 'control: without GIT_ALLOW_PROTOCOL the folder-allowed remote helper starts: ' + fs.readdirSync(marks).join(', '));
    // and the status is still right (filters off: the files compare by their raw bytes)
    assert.ok(st.repo, 'still a repository');
    const want = ['modified:a.txt', 'modified:b.txt', 'modified:s'];
    if (st.repo) assert.deepStrictEqual(st.files.map((f) => `${f.state}:${f.path}`).sort(), want, 'a.txt and b.txt changed, the moved submodule shows; its own changes are not read');
    assert.ok(stEnv.repo && stEnv.files.map((f) => `${f.state}:${f.path}`).sort().join() === want.join(), 'a GIT_DIR in Durbar\'s environment does not redirect the status: ' + JSON.stringify(stEnv));
    console.log(`gitstatus: real git (${execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).trim()}): ${plant.length + 13} planted settings, a remote helper and a GIT_DIR, none ran; the user's own filter off too; the protocol control fired`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(realGitCheck).catch((e) => { console.error(e); process.exit(1); });
