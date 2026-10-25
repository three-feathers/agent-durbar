/**
 * Binary lookup and version probe for the Claude and Codex CLIs (spec 012 FR-035..FR-041).
 * Pure apart from the injected `isFile` and `exec`; `nodeExec` is the only code that touches `child_process`.
 * Mirrors `src/main/vscode.ts` (LaunchEnv, PATH search, planCmd) without importing it: adapters must not import `src/main`. `CMD_UNSAFE` and `windowsCmd` are shared (`src/shared/wincmd.ts`).
 * Nothing here logs or returns an environment value or stderr.
 */

import { execFile } from 'child_process';
import type { ChildProcess, ExecFileOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AdapterDescriptor, DetectResult } from './capabilities';
import { MAX_VERSION_LENGTH, VERSION_TOKEN_SOURCE } from '../shared/versionfield';
import { pathDirs } from '../shared/pathdirs';
import { CMD_UNSAFE, windowsCmd } from '../shared/wincmd';

export interface DetectEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
  /** True if the path exists and is a file. */
  isFile(p: string): boolean;
  /** Spec 060 FR-003: the names of the folders inside `dir` (version managers keep one folder per Node.js version); [] when unreadable. */
  listDir?(dir: string): string[];
  /** Spec 060 FR-003: the login shell's PATH (absolute folders), read once by main; searched after PATH, before the fixed folders. */
  loginPath?: readonly string[];
}

/** Version folders, newest first (`v22.3.0` before `v20.11.1`); names that are not versions go last, in name order. At most 20. */
export function newestFirst(names: readonly string[]): string[] {
  const ver = (n: string): string | undefined => (/^v?\d+\.\d+\.\d+$/.test(n) ? n.replace(/^v/, '') : undefined);
  return [...names]
    .filter((n) => n && !n.startsWith('.') && !/[\\/]/.test(n))
    .sort((a, b) => {
      const va = ver(a), vb = ver(b);
      if (va && vb) return compareVersions(vb, va);
      if (va) return -1;
      if (vb) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .slice(0, 20);
}

/**
 * Spec 060 FR-003: where version managers and Linuxbrew put the CLIs that `npm install -g` (or brew) installs, after the fixed
 * folders. macOS and Linux: nvm, fnm (both of its homes, and its default alias), Volta, asdf and mise shims, and Linuxbrew on
 * Linux. Windows: Volta, nvm-windows (its current-version link, then its version folders).
 */
function managerDirs(env: DetectEnv, p: path.PlatformPath): string[] {
  const home = env.homedir;
  const list = (dir: string): string[] => {
    try { return newestFirst(env.listDir ? env.listDir(dir) : []); } catch { return []; }
  };
  const out: string[] = [];
  if (env.platform === 'win32') {
    const local = env.env.LOCALAPPDATA;
    if (local && p.isAbsolute(local)) out.push(p.join(local, 'Volta', 'bin'));
    const link = env.env.NVM_SYMLINK;
    if (link && p.isAbsolute(link)) out.push(link);
    const appData = env.env.APPDATA;
    const nvmHome = env.env.NVM_HOME && p.isAbsolute(env.env.NVM_HOME) ? env.env.NVM_HOME : appData && p.isAbsolute(appData) ? p.join(appData, 'nvm') : undefined;
    if (nvmHome) for (const v of list(nvmHome)) out.push(p.join(nvmHome, v));
    return out;
  }
  if (!home || !p.isAbsolute(home)) return out;
  const nvmDir = env.env.NVM_DIR && p.isAbsolute(env.env.NVM_DIR) ? env.env.NVM_DIR : p.join(home, '.nvm');
  const nvmVersions = p.join(nvmDir, 'versions', 'node');
  for (const v of list(nvmVersions)) out.push(p.join(nvmVersions, v, 'bin'));
  const fnmHomes = [p.join(home, '.fnm'), p.join(home, '.local', 'share', 'fnm')];
  if (env.platform === 'darwin') fnmHomes.push(p.join(home, 'Library', 'Application Support', 'fnm'));
  if (env.env.FNM_DIR && p.isAbsolute(env.env.FNM_DIR)) fnmHomes.unshift(env.env.FNM_DIR);
  for (const f of fnmHomes) {
    out.push(p.join(f, 'aliases', 'default', 'bin'));
    const versions = p.join(f, 'node-versions');
    for (const v of list(versions)) out.push(p.join(versions, v, 'installation', 'bin'));
  }
  out.push(p.join(home, '.volta', 'bin'), p.join(home, '.asdf', 'shims'), p.join(home, '.local', 'share', 'mise', 'shims'));
  if (env.platform === 'linux') out.push('/home/linuxbrew/.linuxbrew/bin', p.join(home, '.linuxbrew', 'bin'));
  return out;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  errorCode?: string;
}

/** `env` (spec 081 T009) is merged over the process environment for that one child only. */
export type Exec = (file: string, args: readonly string[], opts: { timeoutMs: number; verbatim?: boolean; env?: Readonly<Record<string, string>> }) => Promise<ExecResult>;

export interface BinarySpec {
  name: string;
  versionArgs: readonly string[];
  minVersion?: string;
  installHint: string;
}

export const CLAUDE_BINARY: BinarySpec = {
  name: 'claude',
  versionArgs: ['--version'],
  installHint: 'Open Settings > Agent apps and choose Install… (or run `npm install -g @anthropic-ai/claude-code`).',
};

/** Minimum Codex version: the one researched for the read-limiting profile (spec 012 FR-087), also the detect minimum. Older versions are refused because they are unchecked; T061 confirms it on a real Codex. */
export const CODEX_MIN_VERSION = '0.163.0';

export const CODEX_BINARY: BinarySpec = {
  name: 'codex',
  versionArgs: ['--version'],
  minVersion: CODEX_MIN_VERSION,
  installHint: 'Open Settings > Agent apps and choose Install… (or run `npm install -g @openai/codex`).',
};

const TIMEOUT_MS = 5000;
const READY_HINT = 'Sign-in is checked when the agent starts.';
const COPILOT_HINT = 'Uses the Copilot login on this computer when the agent starts.';

/** Characters that cmd.exe would interpret, or that could break out of a quoted argument (same check as `src/main/vscode.ts`). */

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** A path safe to show: `~/…` (`~\\…` on Windows) when under the home folder, otherwise only the file name. Never the user name. */
export function displayPath(file: string, env: Pick<DetectEnv, 'platform' | 'homedir'>): string {
  const p = pathFor(env.platform);
  const sep = env.platform === 'win32' ? '\\' : '/';
  if (env.homedir && p.isAbsolute(env.homedir)) {
    const rel = p.relative(env.homedir, file);
    if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !p.isAbsolute(rel)) return `~${sep}${rel}`;
  }
  return p.basename(file);
}

/** Candidate file paths in search order: configured path, PATH entries, known install folders. */
export function candidates(spec: BinarySpec, env: DetectEnv, configuredPath?: string): string[] {
  const p = pathFor(env.platform);
  const win = env.platform === 'win32';
  const names = win ? [`${spec.name}.exe`, `${spec.name}.cmd`] : [spec.name];
  const out: string[] = [];
  const addDir = (dir: string): void => {
    for (const n of names) out.push(p.join(dir, n));
  };

  if (typeof configuredPath === 'string' && configuredPath && p.isAbsolute(configuredPath)) out.push(configuredPath);

  for (const dir of pathDirs(env.env, env.platform)) addDir(dir);
  // spec 060 FR-003: an app opened from Finder or a desktop menu gets a short PATH; the login shell's adds nvm, fnm, asdf and the like
  if (!win) for (const dir of env.loginPath ?? []) if (dir && p.isAbsolute(dir)) addDir(dir);

  const home = env.homedir;
  if (env.platform === 'darwin') {
    for (const d of ['/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.local/bin'), p.join(home, '.claude/local'), p.join(home, '.npm-global/bin')]) addDir(d);
  } else if (win) {
    addDir(p.join(home, '.local', 'bin'));
    const appData = env.env.APPDATA;
    if (appData && p.isAbsolute(appData)) addDir(p.join(appData, 'npm'));
    const local = env.env.LOCALAPPDATA;
    if (local && p.isAbsolute(local)) {
      addDir(p.join(local, 'Programs', spec.name));
      // OpenAI's official install.ps1 (spec 060, real 2026-10-20): %LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe
      if (spec.name === 'codex') addDir(p.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'));
      addDir(p.join(local, 'Microsoft', 'WinGet', 'Links')); // winget's command shims (spec 052 FR-072): found even before PATH is re-read
      // spec 060 FR-010: winget (and a Microsoft Store PowerShell 7) is an App Execution Alias here, also when PATH lacks the folder
      if (spec.name === 'winget' || spec.name === 'pwsh') addDir(p.join(local, 'Microsoft', 'WindowsApps'));
    }
  } else {
    for (const d of [p.join(home, '.local/bin'), p.join(home, '.claude/local'), '/usr/local/bin', '/usr/bin', p.join(home, '.npm-global/bin')]) addDir(d);
  }
  for (const d of managerDirs(env, p)) addDir(d);
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = win ? c.toLowerCase() : c;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Spec 081 FR-005 and spec 012 FR-039: one limit and one token pattern, shared with `parseVersionField` (`src/shared/versionfield.ts`). */
const VERSION_LINE_RE = new RegExp('^[ \\t]*(?:(?:codex-cli|codex|claude|Claude Code)[ \\t]+)?\\(?(?:rust-v|v)?(' + VERSION_TOKEN_SOURCE + ')(?:\\+[0-9A-Za-z.-]{1,40})?(?=$|[ \\t)])');

/** A bounded version token on the first line; known app labels and version prefixes are omitted. */
export function parseVersion(stdout: string): string | undefined {
  if (typeof stdout !== 'string') return undefined;
  // Inspect one extra character so cutting the line cannot turn an oversized token into a valid version.
  const prefix = stdout.slice(0, 201);
  const line = prefix.split(/[\r\n]/, 1)[0];
  const m = VERSION_LINE_RE.exec(line.slice(0, 200));
  if (!m || (m[0].length === 200 && line.length > 200 && !/[ \t)]/.test(line[200]))) return undefined;
  if (m[1].length > MAX_VERSION_LENGTH) return undefined;
  return m[1];
}

function cmpIdent(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Math.sign(Number(a) - Number(b));
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric per part; a pre-release is older than its release. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { core: number[]; pre: string[] | undefined } => {
    const i = v.indexOf('-');
    const core = (i < 0 ? v : v.slice(0, i)).split('.').map((x) => Number(x) || 0);
    return { core, pre: i < 0 ? undefined : v.slice(i + 1).split('.') };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const c = cmpIdent(x.pre[i], y.pre[i]);
    if (c !== 0) return c;
  }
  return 0;
}

export async function detectBinary(spec: BinarySpec, env: DetectEnv, exec: Exec, configuredPath?: string): Promise<DetectResult & { path?: string }> {
  const found = candidates(spec, env, configuredPath).find((c) => env.isFile(c));
  if (!found) return { state: 'not-installed', hint: spec.installHint };
  const shown = displayPath(found, env);

  if (env.platform === 'win32' && found.toLowerCase().endsWith('.cmd') && CMD_UNSAFE.test(found)) return { state: 'unknown', hint: `Found ${shown} but cannot run it safely; install the native binary.`, path: found };
  let res: ExecResult;
  try {
    res = await execFound(found, spec.versionArgs, env, exec);
  } catch {
    return { state: 'unknown', hint: `Found ${shown} but could not read its version.`, path: found };
  }
  const version = res && res.code === 0 && !res.timedOut && !res.errorCode ? parseVersion(res.stdout) : undefined;
  if (!version) return { state: 'unknown', hint: `Found ${shown} but could not read its version.`, path: found };
  if (spec.minVersion && compareVersions(version, spec.minVersion) < 0) {
    return { state: 'too-old', version, hint: `Found ${version}, needs ${spec.minVersion} or later`, path: found };
  }
  return { state: 'ready', version, hint: READY_HINT, path: found };
}

/** Runs a found binary with fixed arguments: argv only; a Windows `.cmd` shim goes through `cmd /d /s /c` with its own quotes (the caller checked CMD_UNSAFE). */
export function execFound(found: string, args: readonly string[], env: DetectEnv, exec: Exec, extra: { timeoutMs?: number; env?: Readonly<Record<string, string>> } = {}): Promise<ExecResult> {
  if (env.platform === 'win32' && found.toLowerCase().endsWith('.cmd')) {
    const file = windowsCmd(env.env); // spec 045 FR-003: never a command taken from the environment as is
    // the /c argument carries its own quotes; Node must not re-quote them
    return exec(file, ['/d', '/s', '/c', `"${found}" ${args.join(' ')}`], { timeoutMs: extra.timeoutMs ?? TIMEOUT_MS, verbatim: true, ...(extra.env ? { env: extra.env } : {}) });
  }
  return exec(found, args, { timeoutMs: extra.timeoutMs ?? TIMEOUT_MS, ...(extra.env ? { env: extra.env } : {}) });
}

export const CLAUDE_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in… (or run `claude auth login`).';

/**
 * Claude Code (spec 012 FR-132): the version probe, then `claude auth status --json` (no prompt, nothing billed). Detection reads
 * only `loggedIn`; the email and plan are shown only through `accountInfo` (spec 051 FR-011), never kept here. Not signed in = `not-signed-in`; anything unclear
 * (an older CLI, a timeout, not JSON) keeps `ready` as before.
 */
export async function detectClaude(env: DetectEnv, exec: Exec, configuredPath?: string): Promise<DetectResult & { path?: string }> {
  const r = await detectBinary(CLAUDE_BINARY, env, exec, configuredPath);
  if (r.state !== 'ready' || !r.path) return r;
  const loggedIn = await claudeLoggedIn(r.path, env, exec);
  if (loggedIn === false) return { ...r, state: 'not-signed-in', hint: CLAUDE_SIGN_IN_HINT };
  if (loggedIn === true) return { ...r, hint: 'Signed in to Claude Code on this computer.' };
  return r;
}

/**
 * `claude auth status --json` of a found `claude` (local, no prompt, nothing billed), parsed; undefined when unclear (an older CLI,
 * a timeout, not JSON). Spec 051 FR-011: the caller maps only the fields it shows; the answer is never logged or kept on disk.
 */
export async function claudeAuthStatus(found: string, env: DetectEnv, exec: Exec): Promise<Record<string, unknown> | undefined> {
  try {
    const a = await execFound(found, ['auth', 'status', '--json'], env, exec);
    if (a && !a.timedOut && !a.errorCode && a.stdout) {
      const j = JSON.parse(a.stdout) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
    }
  } catch {
    /* unclear */
  }
  return undefined;
}

/**
 * The `loggedIn` of `claude auth status --json`, or undefined when unclear. Detection reads nothing else of it (spec 012 FR-132,
 * FR-156); the account line uses `claudeAuthStatus` itself (spec 051 FR-011).
 */
export async function claudeLoggedIn(found: string, env: DetectEnv, exec: Exec): Promise<boolean | undefined> {
  const loggedIn = (await claudeAuthStatus(found, env, exec))?.loggedIn;
  return typeof loggedIn === 'boolean' ? loggedIn : undefined;
}

export const CODEX_SIGN_IN_HINT = 'Sign in first: open Settings > Agent apps and choose Sign in… (or run `codex login`).';

/**
 * Codex (spec 012 FR-137): the version probe, then `codex login status` (no prompt, nothing billed). "Not logged in" (it exits 1)
 * means not signed in (an exit code alone is not enough: an older CLI without the command fails too); exit 0 with "Logged in" means ready. Nothing of the output is kept; anything unclear keeps `ready`.
 */
export async function detectCodex(env: DetectEnv, exec: Exec, configuredPath?: string): Promise<DetectResult & { path?: string }> {
  const r = await detectBinary(CODEX_BINARY, env, exec, configuredPath);
  if (r.state !== 'ready' || !r.path) return r;
  try {
    const a = await execFound(r.path, ['login', 'status'], env, exec);
    if (a && !a.timedOut && !a.errorCode) {
      const text = `${a.stdout}\n${a.stderr}`;
      if (/\bNot logged in\b/i.test(text)) return { ...r, state: 'not-signed-in', hint: CODEX_SIGN_IN_HINT };
      if (a.code === 0 && /\bLogged in\b/i.test(text)) return { ...r, hint: 'Signed in to Codex on this computer.' };
    }
  } catch {
    /* unclear: ready, as before */
  }
  return r;
}

/** No I/O: the runtime ships with the app and its sign-in is learned at the first start (FR-041). */
export async function detectCopilot(): Promise<DetectResult> {
  return { state: 'ready', hint: COPILOT_HINT };
}

let loginPathDirs: readonly string[] = [];
/** Spec 060 FR-003: main hands in the login shell's PATH once it has read it (src/main/loginpath.ts); adapters never spawn a shell. */
export function setLoginPath(dirs: readonly string[]): void {
  loginPathDirs = Object.freeze([...dirs]);
}

/** Spec 060 FR-010: `%LOCALAPPDATA%\Microsoft\WindowsApps`, where Windows keeps App Execution Aliases (winget.exe); undefined elsewhere. */
export function windowsAppsDir(env: Pick<DetectEnv, 'platform' | 'env'>): string | undefined {
  if (env.platform !== 'win32') return undefined;
  const local = env.env.LOCALAPPDATA;
  return local && path.win32.isAbsolute(local) ? path.win32.join(local, 'Microsoft', 'WindowsApps') : undefined;
}

/** Spec 060 FR-010: true for a file directly in `windowsAppsDir` (an App Execution Alias: run it by this path, never resolve it). */
export function isAppAlias(file: string, env: Pick<DetectEnv, 'platform' | 'env'>): boolean {
  const dir = windowsAppsDir(env);
  return !!dir && path.win32.dirname(file).toLowerCase() === dir.toLowerCase();
}

/**
 * Spec 060 FR-010: "is this a file?" for detection. Node's `fs.statSync` throws EACCES on an App Execution Alias (a reparse point
 * that only CreateProcess follows; read: npm/node-which#157), so winget.exe was never found and Windows got no winget route.
 * Only for `winget.exe` or `pwsh.exe` directly in `windowsAppsDir`, `lstat` (which does not follow it) is asked instead. Elsewhere a failing `stat` stays "no".
 */
export function statIsFile(
  file: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  fsx: { statSync(p: string): { isFile(): boolean }; lstatSync(p: string): { isDirectory(): boolean } },
): boolean {
  try {
    return fsx.statSync(file).isFile();
  } catch {
    // review on #469: only the two aliases FR-010 names (winget, a Store pwsh); any other file there stays "no"
    if (!isAppAlias(file, { platform, env }) || !/^(winget|pwsh)\.exe$/i.test(path.win32.basename(file))) return false;
    try { return !fsx.lstatSync(file).isDirectory(); } catch { return false; }
  }
}

/** The real environment for `detectBinary` (process env, home folder, file check, folder listing, the login shell's PATH when read). */
export function nodeDetectEnv(): DetectEnv {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    isFile: (p) => statIsFile(p, process.platform, process.env, fs),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name).slice(0, 200);
      } catch {
        return [];
      }
    },
    get loginPath() {
      return loginPathDirs; // read at each search: the object may be kept (HarnessSetup) before main has read the login shell
    },
  };
}

/** Adds where the app was found, safe to show (`~/…` or only the file name, never the user name: `displayPath`). */
const withWhere = (r: DetectResult & { path?: string }, env: DetectEnv): DetectResult => {
  const { path: p, ...rest } = r;
  return p ? { ...rest, where: displayPath(p, env) } : rest;
};

export function detectorFor(id: string): ((d: AdapterDescriptor) => Promise<DetectResult>) | undefined {
  if (id === 'copilot') return () => detectCopilot();
  if (id === 'claude') return () => { const env = nodeDetectEnv(); return detectClaude(env, nodeExec).then((r) => withWhere(r, env)); }; // `--version`, then `auth status` (FR-132); never a prompt (FR-010)
  if (id === 'codex') return () => { const env = nodeDetectEnv(); return detectCodex(env, nodeExec).then((r) => withWhere(r, env)); }; // `--version`, then `login status` (FR-137)
  return undefined;
}

/** What `makeExec` needs from the system (tests hand in fakes). */
export interface ExecDeps {
  execFile: typeof execFile;
  /** Ends the child and what it started: Windows `taskkill /T /F /PID` from System32, else the child's process group. */
  killTree(child: ChildProcess): void;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
}

/** Spec 081 T009: the real tree kill. The group exists because POSIX children are started `detached`. */
export function killChildTree(child: Pick<ChildProcess, 'pid' | 'kill'> & { exitCode?: number | null; signalCode?: string | null }, platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, exec: typeof execFile = execFile, kill: (pid: number, sig: NodeJS.Signals) => void = (pid, sig) => process.kill(pid, sig), later: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms).unref(); }): void {
  const pid = child.pid;
  if (!pid) return;
  if (platform === 'win32') {
    const root = env.SystemRoot && path.win32.isAbsolute(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows';
    exec(path.win32.join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => undefined);
    return;
  }
  try { kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  // then SIGKILL after 3 s, unless it has exited: its group id could already belong to something else (one tree kill for the checks and the runner, review on #721)
  later(() => { if (child.exitCode != null || child.signalCode != null) return; try { kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 3000);
}

/**
 * The exec: argv array, no shell, hidden window, a time limit that ends the whole tree (an `npm.cmd` run goes through `cmd.exe`, and
 * `execFile`'s own timeout would kill only that), output capped at 64 KiB, an optional environment for that child only. Never logs.
 */
export function makeExec(d: ExecDeps): Exec {
  return (file, args, opts) =>
    new Promise((resolve) => {
      try {
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        // `detached` makes a POSIX child its own process group (what the tree kill ends); execFile passes it on to spawn
        const o = { shell: false, windowsHide: true, windowsVerbatimArguments: opts.verbatim === true, maxBuffer: 64 * 1024, encoding: 'utf8', detached: d.platform !== 'win32', ...(opts.env ? { env: { ...d.env, ...opts.env } } : {}) } as unknown as ExecFileOptionsWithStringEncoding;
        const child = d.execFile(file, [...args], o, (err, stdout, stderr) => {
          if (timer) clearTimeout(timer);
          if (!err) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string | null };
          const numeric = typeof e.code === 'number' ? e.code : null;
          resolve({
            code: numeric,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            timedOut: timedOut || e.killed === true ? true : undefined,
            errorCode: typeof e.code === 'string' ? e.code : undefined,
          });
        });
        timer = setTimeout(() => { timedOut = true; try { d.killTree(child); } catch { /* gone */ } }, opts.timeoutMs);
      } catch (e) {
        resolve({ code: null, stdout: '', stderr: '', errorCode: (e as NodeJS.ErrnoException).code ?? 'EXEC' });
      }
    });
}

/** The real exec (spec 012 T093 and spec 081). */
// `execFile` is looked up when a command runs, not captured here: the simulator seals child_process (spec 010 FR-030) and its test spies on it
export const nodeExec: Exec = makeExec({ execFile: ((...a: Parameters<typeof execFile>) => (execFile as (...x: unknown[]) => ChildProcess)(...a)) as typeof execFile, killTree: (c) => killChildTree(c, process.platform, process.env), platform: process.platform, env: process.env });
