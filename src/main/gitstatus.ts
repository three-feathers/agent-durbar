/**
 * Spec 063: the git branch and uncommitted changes of a session's folder, read-only. `git` runs with argv only (no shell),
 * `--no-optional-locks` (no lock files, no index refresh written), 4 s and 512 KB per command, at most 200 files listed;
 * no command from the folder's own git config runs (FR-008, `makeGitExec`).
 * Any failure (no git, not a repository, a timeout) is `{ repo: false }`: the window then shows nothing extra.
 *
 * Spec 093 (FR-030): the one other entry point, `runGitCreate`, runs the writing commands that create a folder (`git init` now,
 * `git clone` in phase 2). It is separate from the read-only runner on purpose: it spawns (streaming output, no 4 s limit,
 * Cancel ends the process tree) and takes a typed request, never argv. The read-only runner below is unchanged.
 */
import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { killChildTree } from '../adapters/detect';

export type FileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
export interface GitFile { path: string; state: FileState; added?: number; removed?: number; binary?: boolean }
export type GitStatus = { repo: false } | { repo: true; branch: string; detached?: boolean; ahead?: number; behind?: number; files: GitFile[]; more: number };

export const GIT_TIMEOUT_MS = 4000;
export const GIT_MAX_BYTES = 512 * 1024;
export const GIT_MAX_FILES = 200;

/** A path or branch fit to show: no control characters, at most 300 characters. */
const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300);

function stateOf(x: string, y: string): FileState {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || y === 'R' || x === 'C') return 'renamed';
  if (x === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

/** `git status --porcelain=v1 --branch -z`: the `## branch...upstream [ahead N, behind M]` header, then `XY path` records (a rename has its old path as the next record). */
export function parsePorcelainZ(out: string): { branch: string; detached?: boolean; ahead?: number; behind?: number; files: GitFile[] } {
  const recs = out.split('\0');
  let branch = '';
  let detached: boolean | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const files: GitFile[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith('## ')) {
      const h = r.slice(3);
      if (/^HEAD \(no branch\)/.test(h) || h.startsWith('HEAD')) { detached = true; branch = 'HEAD'; continue; }
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(h);
      branch = clean(m ? m[1] : h);
      const a = m && m[3] ? /ahead (\d+)/.exec(m[3]) : null;
      const b = m && m[3] ? /behind (\d+)/.exec(m[3]) : null;
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
      continue;
    }
    if (r.length < 4) continue;
    const x = r[0], y = r[1];
    const state = stateOf(x, y);
    files.push({ path: clean(r.slice(3)), state });
    if (state === 'renamed' || x === 'C') i++; // skip the old path of a rename or copy
  }
  return { branch, ...(detached ? { detached } : {}), ...(ahead ? { ahead } : {}), ...(behind ? { behind } : {}), files };
}

/** `git diff HEAD --numstat -z`: `added\tremoved\tpath` (binary: `-\t-`); a rename is `added\tremoved\t` then old and new path records. */
export function parseNumstatZ(out: string): Map<string, { added?: number; removed?: number; binary?: boolean }> {
  const m = new Map<string, { added?: number; removed?: number; binary?: boolean }>();
  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const t = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(r);
    if (!t) continue;
    let path = t[3];
    if (path === '') { i += 2; path = recs[i] ?? ''; } // rename: old path, new path
    const binary = t[1] === '-' && t[2] === '-';
    m.set(clean(path), binary ? { binary: true } : { added: Number(t[1]), removed: Number(t[2]) });
  }
  return m;
}

export type GitExec = (args: string[]) => Promise<string>;

/**
 * FR-008 (2026-10-25, #719): git honours the folder's own `.git/config`, and some settings there are commands git runs.
 * Every git call in `src/main` goes through this runner, which allows only read-only subcommands and turns those settings off.
 * Not overridden because they cannot fire here (the real-git test plants them anyway): `core.pager`/`pager.*` (stdout is a
 * pipe, and `--no-pager`), `core.editor`/`sequence.editor` (no editing command is allowed), hooks and `core.hooksPath` (none
 * runs for these subcommands; `--no-optional-locks` keeps the index unwritten, so no `post-index-change`), aliases (git never
 * lets an alias replace a built-in, and only built-ins are allowed), `core.sshCommand` (only for a transport, refused below).
 */
export const GIT_READ_ONLY = ['status', 'diff', 'rev-parse', 'rev-list'] as const;
export const GIT_SAFE_CONFIG: readonly string[] = [
  'core.fsmonitor=false', // no fsmonitor hook (passed down to the git a submodule check would start, too)
  'core.useBuiltinFSMonitor=false', // the older Git for Windows spelling
  'protocol.allow=never', // no transport at all: a partial clone's lazy fetch cannot start core.sshCommand, an uploadpack or a credential helper
  ...['file', 'git', 'ssh', 'http', 'https', 'ext'].map((p) => `protocol.${p}.allow=never`), // the folder's own protocol.<name>.allow would beat protocol.allow
  'log.showSignature=false', // no gpg.program
  'credential.helper=', // an empty value clears every helper the folder's config (or any other) lists
  'diff.submodule=short', // a patch diff does not start `git diff` inside a submodule (whose own diff drivers would run)
  'status.submoduleSummary=false', // no `git submodule summary` (long status only, set anyway)
];
/**
 * Set on every git process. `GIT_ALLOW_PROTOCOL` empty: no transport at all, and it replaces every `protocol.*` setting,
 * so a folder's own `protocol.<any name>.allow=always` (ftp, or a `git-remote-<x>` helper) cannot bring one back.
 */
export const GIT_SAFE_ENV: Readonly<Record<string, string>> = { GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

/**
 * The child's environment: Durbar's own minus every `GIT_*` variable (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG*,
 * GIT_EXTERNAL_DIFF, GIT_PAGER, GIT_ASKPASS, ... would redirect git or start a helper) and `SSH_ASKPASS`, plus `GIT_SAFE_ENV`.
 * Compared in upper case: Windows environment names are not case-sensitive.
 */
export function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    const u = k.toUpperCase();
    if (u.startsWith('GIT_') || u === 'SSH_ASKPASS') continue;
    env[k] = v;
  }
  return { ...env, ...GIT_SAFE_ENV };
}
const GLOBAL = ['--no-pager', '--no-optional-locks'];
const AFTER: Record<string, string[]> = {
  status: ['--ignore-submodules=dirty'], // do not start a git inside each submodule (its own filter drivers were not read)
  diff: ['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--submodule=short'], // no diff.external, diff.<name>.command or textconv; no git inside a submodule
};
/**
 * The only options a caller may pass, per subcommand (what spec 063 and spec 085 use). A caller's flag comes after the
 * overrides, so `--textconv`, `--ext-diff`, `--submodule=diff` or `--ignore-submodules=none` would undo them: anything not
 * listed is refused. Arguments that do not start with `-` (a revision such as HEAD or <sha>..HEAD) are allowed, and so is
 * everything after `--` (paths).
 */
export const GIT_CALLER_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  status: ['--porcelain=v1', '--branch', '-z', '--untracked-files=all', '--untracked-files=normal'],
  diff: ['--numstat', '--shortstat', '-z', '--no-ext-diff', '--no-textconv'],
  'rev-parse': ['--verify', '-q'],
  'rev-list': ['--count'],
};

/** The driver-name read: every filter setting with a command (`-z`: one name per NUL), from any config file. */
export const FILTER_LIST = ['config', '-z', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'];

/**
 * The filter drivers to switch off: **all of them**, the user's own (git-lfs, git-crypt in ~/.gitconfig) included. A trusted
 * driver still reads the folder's config: git-lfs runs `lfs.extension.<name>.clean` from the folder's `.git/config` as a
 * command (review on #722, round 3). The price: a touched file that such a filter stores differently can show as changed
 * in Durbar while plain `git status` says clean (spec 063 FR-008, README). The name may hold dots.
 */
export function filterDrivers(out: string): string[] {
  const names = new Set<string>();
  for (const k of out.split('\0')) {
    const m = /^filter\.(.+)\.(?:clean|smudge|process)$/is.exec(k);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/** `-c` pairs that switch a filter driver off. A name `-c` cannot express (git splits `-c` at the first `=`) is refused. */
export function filterOverrides(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (n.includes('=')) throw new Error('git: a filter driver name that cannot be overridden');
    for (const kv of ['clean=', 'smudge=', 'process=', 'required=false']) out.push('-c', `filter.${n}.${kv}`);
  }
  return out;
}

/** The leading `-C <dir>` of a call (where it runs), then the subcommand and its arguments; anything else is refused. */
function split(args: string[]): { at: string[]; sub: string; rest: string[] } {
  const at = args[0] === '-C' && typeof args[1] === 'string' ? args.slice(0, 2) : [];
  const sub = args[at.length];
  if (!(GIT_READ_ONLY as readonly string[]).includes(sub)) throw new Error(`git: subcommand not allowed: ${String(sub).slice(0, 40)}`);
  const rest = args.slice(at.length + 1);
  const end = rest.indexOf('--');
  for (const a of end < 0 ? rest : rest.slice(0, end)) {
    if (typeof a !== 'string' || (a.startsWith('-') && !GIT_CALLER_OPTIONS[sub].includes(a))) throw new Error(`git: option not allowed: ${String(a).slice(0, 40)}`);
  }
  return { at, sub, rest };
}

/** The full argv of one call: global options, the safe config, the filter overrides, then the call with its subcommand's flags. */
export function hardenedArgv(args: string[], drivers: string[]): string[] {
  const { at, sub, rest } = split(args);
  return [...GLOBAL, ...GIT_SAFE_CONFIG.flatMap((c) => ['-c', c]), ...filterOverrides(drivers), ...at, sub, ...(AFTER[sub] ?? []), ...rest];
}

export type GitRun = (argv: string[], env: NodeJS.ProcessEnv) => Promise<string>;

/** The runner over any `run` (tests pass a fake): first the filter driver names (reading config runs nothing), then the call. */
export function makeGitExec(run: GitRun): GitExec {
  return async (args) => {
    const { at } = split(args);
    const env = gitEnv(process.env);
    const list = [...GLOBAL, ...GIT_SAFE_CONFIG.flatMap((c) => ['-c', c]), ...at, ...FILTER_LIST];
    // exit status 1: no such key (no filter driver at all); anything else is a failure
    const names = await run(list, env).catch((e: { code?: unknown }) => { if (e && e.code === 1) return ''; throw e; });
    return run(hardenedArgv(args, filterDrivers(names)), env);
  };
}

/** The options of every git process: time and size limits, no window, no shell (argv only), the safe environment. */
export const gitExecOptions = (env: NodeJS.ProcessEnv): { timeout: number; maxBuffer: number; windowsHide: true; shell: false; encoding: 'utf8'; env: NodeJS.ProcessEnv } =>
  ({ timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BYTES, windowsHide: true, shell: false, encoding: 'utf8', env });

type ExecFileFn = (file: string, args: string[], options: ReturnType<typeof gitExecOptions>, cb: (err: Error | null, stdout: string) => void) => unknown;

/** A `GitRun` over an `execFile` (tests pass a fake one to pin the file, argv and options). */
export const execFileGitRun = (ef: ExecFileFn): GitRun => (argv, env) =>
  new Promise((resolve, reject) => { ef('git', argv, gitExecOptions(env), (err, stdout) => (err ? reject(err) : resolve(stdout))); });

/** The real runner: `git` from PATH, argv only (no shell), time and size limits. */
export const nodeGitExec: GitExec = makeGitExec(execFileGitRun(execFile as unknown as ExecFileFn));

export async function folderGitStatus(dir: string, exec: GitExec = nodeGitExec): Promise<GitStatus> {
  try {
    const st = parsePorcelainZ(await exec(['-C', dir, 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all']));
    if (!st.branch) return { repo: false };
    // line counts are best effort (a repository with no commit yet has no HEAD)
    const counts = await exec(['-C', dir, 'diff', 'HEAD', '--numstat', '-z']).then(parseNumstatZ, () => new Map());
    const files = st.files.map((f) => ({ ...f, ...(counts.get(f.path) ?? {}) }));
    return { repo: true, branch: st.branch, ...(st.detached ? { detached: true } : {}), ...(st.ahead ? { ahead: st.ahead } : {}), ...(st.behind ? { behind: st.behind } : {}), files: files.slice(0, GIT_MAX_FILES), more: Math.max(0, files.length - GIT_MAX_FILES) };
  } catch {
    return { repo: false };
  }
}

/* ---- Spec 093: creating a folder (FR-030..FR-034). `git init` in phase 1; phase 2 adds `{ kind: 'clone', url }` ---- */

/**
 * Every transport git ships (FR-032). A call gets `protocol.<x>.allow=never` for each one it does not need, so a user's global
 * `protocol.<x>.allow=always` cannot bring it back (the more specific key beats `protocol.allow`, spec R1). `init` needs none.
 */
export const GIT_TRANSPORTS = ['file', 'git', 'ssh', 'http', 'https', 'ext', 'fd', 'ftp', 'ftps'] as const;

/** What a caller may ask for: a typed request, never argv (FR-030). Phase 2 adds `{ kind: 'clone'; url: string }`. */
export type GitCreateRequest = { kind: 'init' };

export interface GitCreateCallOptions {
  /**
   * A private, empty folder made for this run and removed after it (FR-032, FR-051): `core.hooksPath` points there, so none of the
   * user's own hooks (a global `core.hooksPath`) run during the command. A remote cannot bring hooks (D5); after the command the
   * user's hooks apply again as usual, because a `-c` before the subcommand is not written into the new repository.
   */
  hooksDir: string;
  /** Durbar's environment (tests pass their own); every `GIT_*` in it is dropped by `gitEnv` (FR-033). */
  env?: NodeJS.ProcessEnv;
}

/**
 * The exact argv and environment of a create call (FR-031..FR-033). Pure. git runs with the new folder as its working folder
 * and no path in the argv (D4), so a name can never be read as an option.
 * - init: `git --no-pager <-c settings> init --quiet`; every transport off (`protocol.allow=never` and each one by name), and
 *   `GIT_ALLOW_PROTOCOL` empty from `gitEnv`, which replaces every `protocol.*` setting and also covers remote helpers.
 */
export function gitCreateCall(req: GitCreateRequest, o: GitCreateCallOptions): { argv: string[]; env: NodeJS.ProcessEnv } {
  if (typeof o.hooksDir !== 'string' || !o.hooksDir) throw new Error('git: a private hooks folder is required');
  const base = [`core.hooksPath=${o.hooksDir}`, 'core.fsmonitor=false', 'core.useBuiltinFSMonitor=false', 'submodule.recurse=false'];
  const env = gitEnv(o.env ?? process.env); // GIT_ALLOW_PROTOCOL='' and GIT_TERMINAL_PROMPT=0 (GIT_SAFE_ENV)
  if (req && req.kind === 'init') {
    const cfg = [...base, 'protocol.allow=never', ...GIT_TRANSPORTS.map((p) => `protocol.${p}.allow=never`)];
    return { argv: ['--no-pager', ...cfg.flatMap((c) => ['-c', c]), 'init', '--quiet'], env };
  }
  throw new Error('git: create request not allowed');
}

export interface GitSpawnOptions { cwd: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: ['ignore', 'pipe', 'pipe']; detached: boolean }
/**
 * FR-034: no shell (argv only), no window, stdin closed, and on POSIX `detached` (its own process group and session: no terminal
 * to prompt in, and the group is what Cancel ends with `killChildTree`). Windows ends the tree with `taskkill /t` instead.
 */
export const gitSpawnOptions = (cwd: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): GitSpawnOptions =>
  ({ cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: platform !== 'win32' });

export type GitChild = Pick<ChildProcess, 'pid' | 'kill' | 'on' | 'exitCode' | 'signalCode'> & { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null };
export type GitSpawn = (file: string, args: string[], options: GitSpawnOptions) => GitChild;

/** How a create command ended. `spawnError` is the error code when git could not start (`ENOENT`: git is not installed). */
export interface GitCreateDone { code: number | null; signal: NodeJS.Signals | null; stderrTail: string; spawnError?: string }
export interface GitCreateHandle { done: Promise<GitCreateDone>; cancel(): void }
export interface GitCreateDeps extends GitCreateCallOptions {
  /** Tests pass a fake; the default is Node's `spawn`, read from `child_process` when the call runs (the simulator's seal applies). */
  spawn?: GitSpawn;
  platform?: NodeJS.Platform;
  kill?: typeof killChildTree;
  /** Each piece of git's stderr as it arrives (raw: the caller masks it before showing it, FR-070). */
  onOutput?(text: string): void;
}
/** The most of git's stderr kept for the error message (the tail). */
export const GIT_CREATE_TAIL = 8192;

/**
 * Runs one create command in `cwd` (the new folder). Only `gitCreateCall`'s argv and environment; `git` from PATH, as the
 * read-only runner. No time limit here (FR-037); the caller ends it with `cancel()`, which ends the child and its own
 * descendants only (`killChildTree`), and only while it has not exited.
 */
export function runGitCreate(req: GitCreateRequest, cwd: string, deps: GitCreateDeps): GitCreateHandle {
  const { argv, env } = gitCreateCall(req, deps);
  const platform = deps.platform ?? process.platform;
  const sp: GitSpawn = deps.spawn ?? (spawn as unknown as GitSpawn);
  let child: GitChild | undefined;
  let tail = '';
  const done = new Promise<GitCreateDone>((resolve) => {
    let settled = false;
    let spawnError: string | undefined;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stderrTail: tail, ...(spawnError ? { spawnError } : {}) });
    };
    const codeOf = (e: unknown): string => (e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'EFAIL');
    try {
      child = sp('git', argv, gitSpawnOptions(cwd, env, platform));
    } catch (e) {
      spawnError = codeOf(e);
      finish(null, null);
      return;
    }
    const c = child;
    c.stdout?.on('data', () => undefined); // drained, so git never blocks on a full pipe
    c.stderr?.on('data', (d: unknown) => {
      const s = String(d);
      tail = (tail + s).slice(-GIT_CREATE_TAIL);
      deps.onOutput?.(s);
    });
    // a spawn failure (no git) has no pid and may never close; a later error waits for close
    c.on('error', (e: unknown) => { spawnError = codeOf(e); if (c.pid === undefined) finish(null, null); });
    c.on('close', (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
  });
  return {
    done,
    cancel: () => {
      const c = child;
      if (!c || !c.pid || c.exitCode != null || c.signalCode != null) return; // never started, or exited: its pid may belong to another process now
      (deps.kill ?? killChildTree)(c, platform, deps.env ?? process.env);
    },
  };
}
