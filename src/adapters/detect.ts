/**
 * Binary lookup and version probe for the Claude and Codex CLIs (spec 012 FR-035..FR-041).
 * Pure apart from the injected `isFile` and `exec`; `nodeExec` is the only code that touches `child_process`.
 * Mirrors `src/main/vscode.ts` (LaunchEnv, PATH search, CMD_UNSAFE, planCmd) without importing it: adapters must not import `src/main`.
 * Nothing here logs or returns an environment value or stderr.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AdapterDescriptor, DetectResult } from './capabilities';
import { windowsCmd } from '../shared/wincmd';

export interface DetectEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
  /** True if the path exists and is a file. */
  isFile(p: string): boolean;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  errorCode?: string;
}

export type Exec = (file: string, args: readonly string[], opts: { timeoutMs: number; verbatim?: boolean }) => Promise<ExecResult>;

export interface BinarySpec {
  name: 'claude' | 'codex';
  versionArgs: readonly string[];
  minVersion?: string;
  installHint: string;
}

export const CLAUDE_BINARY: BinarySpec = {
  name: 'claude',
  versionArgs: ['--version'],
  installHint: 'Install Claude Code (npm install -g @anthropic-ai/claude-code), then restart Durbar.',
};

/** Minimum Codex version: the one researched for the read-limiting profile (spec 012 FR-087), also the detect minimum. Older versions are refused because they are unchecked; T061 confirms it on a real Codex. */
export const CODEX_MIN_VERSION = '0.163.0';

export const CODEX_BINARY: BinarySpec = {
  name: 'codex',
  versionArgs: ['--version'],
  minVersion: CODEX_MIN_VERSION,
  installHint: 'Install the Codex CLI (npm install -g @openai/codex), then restart Durbar.',
};

const TIMEOUT_MS = 5000;
const READY_HINT = 'Sign-in is checked when the agent starts.';
const COPILOT_HINT = 'Uses the Copilot login on this computer when the agent starts.';

/** Characters that cmd.exe would interpret, or that could break out of a quoted argument (same check as `src/main/vscode.ts`). */
const CMD_UNSAFE = /[\r\n\0"&|<>^%!`(),;=]/;

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

function stripQuotes(s: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).trim() : t;
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

  const rawPath = win ? (env.env.PATH ?? env.env.Path ?? '') : (env.env.PATH ?? '');
  for (const raw of rawPath.split(win ? ';' : ':')) {
    const dir = win ? stripQuotes(raw) : raw;
    if (!dir || !p.isAbsolute(dir)) continue;
    addDir(dir);
  }

  const home = env.homedir;
  if (env.platform === 'darwin') {
    for (const d of ['/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.local/bin'), p.join(home, '.claude/local'), p.join(home, '.npm-global/bin')]) addDir(d);
  } else if (win) {
    addDir(p.join(home, '.local', 'bin'));
    const appData = env.env.APPDATA;
    if (appData && p.isAbsolute(appData)) addDir(p.join(appData, 'npm'));
    const local = env.env.LOCALAPPDATA;
    if (local && p.isAbsolute(local)) addDir(p.join(local, 'Programs', spec.name));
  } else {
    for (const d of [p.join(home, '.local/bin'), p.join(home, '.claude/local'), '/usr/local/bin', '/usr/bin', p.join(home, '.npm-global/bin')]) addDir(d);
  }
  return out;
}

/** The first `x.y.z` (optionally with a pre-release suffix) in the output, without a leading `v`. */
export function parseVersion(stdout: string): string | undefined {
  const m = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(typeof stdout === 'string' ? stdout : '');
  return m ? m[0] : undefined;
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
function execFound(found: string, args: readonly string[], env: DetectEnv, exec: Exec): Promise<ExecResult> {
  if (env.platform === 'win32' && found.toLowerCase().endsWith('.cmd')) {
    const file = windowsCmd(env.env); // spec 045 FR-003: never a command taken from the environment as is
    // the /c argument carries its own quotes; Node must not re-quote them
    return exec(file, ['/d', '/s', '/c', `"${found}" ${args.join(' ')}`], { timeoutMs: TIMEOUT_MS, verbatim: true });
  }
  return exec(found, args, { timeoutMs: TIMEOUT_MS });
}

export const CLAUDE_SIGN_IN_HINT = 'Sign in first: run `claude auth login` in a terminal, then refresh the agent kinds.';

/**
 * Claude Code (spec 012 FR-132): the version probe, then `claude auth status --json` (no prompt, nothing billed). Only `loggedIn`
 * is read; the email, organisation and plan in that output are never kept. Not signed in = `not-signed-in`; anything unclear
 * (an older CLI, a timeout, not JSON) keeps `ready` as before.
 */
export async function detectClaude(env: DetectEnv, exec: Exec, configuredPath?: string): Promise<DetectResult & { path?: string }> {
  const r = await detectBinary(CLAUDE_BINARY, env, exec, configuredPath);
  if (r.state !== 'ready' || !r.path) return r;
  try {
    const a = await execFound(r.path, ['auth', 'status', '--json'], env, exec);
    if (a && !a.timedOut && !a.errorCode && a.stdout) {
      const loggedIn = (JSON.parse(a.stdout) as { loggedIn?: unknown } | null)?.loggedIn;
      if (loggedIn === false) return { ...r, state: 'not-signed-in', hint: CLAUDE_SIGN_IN_HINT };
      if (loggedIn === true) return { ...r, hint: 'Signed in to Claude Code on this computer.' };
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

/** The real environment for `detectBinary` (process env, home folder, file check). */
export function nodeDetectEnv(): DetectEnv {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

export function detectorFor(id: string): ((d: AdapterDescriptor) => Promise<DetectResult>) | undefined {
  if (id === 'copilot') return () => detectCopilot();
  if (id === 'claude') return () => detectClaude(nodeDetectEnv(), nodeExec).then(({ path: _p, ...r }) => r); // `--version`, then `auth status` (FR-132); never a prompt (FR-010)
  return undefined;
}

/** The real exec: argv array, no shell, hidden window, 5 s timeout, output capped. Never logs. Used by the Claude detector (spec 012 T093). */
export const nodeExec: Exec = (file, args, opts) =>
  new Promise((resolve) => {
    try {
      execFile(file, [...args], { shell: false, windowsHide: true, windowsVerbatimArguments: opts.verbatim === true, timeout: opts.timeoutMs, maxBuffer: 64 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string | null };
        const numeric = typeof e.code === 'number' ? e.code : null;
        resolve({
          code: numeric,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: e.killed === true ? true : undefined,
          errorCode: typeof e.code === 'string' ? e.code : undefined,
        });
      });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: '', errorCode: (e as NodeJS.ErrnoException).code ?? 'EXEC' });
    }
  });
