/**
 * Spec 060 FR-003 (owner Q2: yes): the PATH of the user's login shell, read once per app run on macOS and Linux. An app opened
 * from Finder, the Dock or a desktop menu does not get the PATH that the user's shell profile builds (nvm, fnm, asdf, mise,
 * Homebrew), so agent apps installed there were "not installed" for Durbar.
 *
 * Safety (constitution III): the shell is the user's own `$SHELL` only when it is an absolute path to an existing file named like a
 * known shell, otherwise `/bin/sh`; the command is a constant string with no user-controlled part; argv only; stdin closed;
 * 3 s limit, then the shell's process group is killed; at most 64 KB read. Only absolute folders come back (at most 64, 8 KB of
 * PATH), nothing else of the output is kept or logged. Any failure: an empty list, and detection uses its fixed folders.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const LOGIN_PATH_TIMEOUT_MS = 3000;
export const MAX_LOGIN_DIRS = 64;
export const MAX_LOGIN_PATH = 8 * 1024;
const MAX_OUT = 64 * 1024;
const START = '__DURBAR_PATH__';
const END = '__END__';
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh']);

/** A constant: prints the shell's PATH between markers (profile output before or after it is ignored). */
const POSIX_CMD = `printf "${START}%s${END}" "$PATH"`;
const FISH_CMD = `printf "${START}%s${END}" (string join : $PATH)`;

/** The shell to run and its argv: `$SHELL` when it is an absolute, existing, known shell; else `/bin/sh`. */
export function loginShellCommand(shellEnv: string | undefined, isFile: (p: string) => boolean): { file: string; args: string[] } {
  const ok = typeof shellEnv === 'string' && path.posix.isAbsolute(shellEnv) && !/[\0\n]/.test(shellEnv) && SHELLS.has(path.posix.basename(shellEnv)) && isFile(shellEnv);
  const file = ok ? (shellEnv as string) : '/bin/sh';
  return { file, args: ['-l', '-c', path.posix.basename(file) === 'fish' ? FISH_CMD : POSIX_CMD] };
}

/** The absolute folders of the PATH printed between the markers; [] when the markers are missing. Deduplicated, capped. */
export function parseLoginPath(out: string): string[] {
  if (typeof out !== 'string') return [];
  const s = out.indexOf(START);
  if (s < 0) return [];
  const e = out.indexOf(END, s + START.length);
  if (e < 0) return [];
  const raw = out.slice(s + START.length, e);
  if (raw.length > MAX_LOGIN_PATH) return [];
  const dirs: string[] = [];
  for (const d of raw.split(':')) {
    if (!d || !path.posix.isAbsolute(d) || /[\0\r\n]/.test(d) || dirs.includes(d)) continue;
    dirs.push(d);
    if (dirs.length >= MAX_LOGIN_DIRS) break;
  }
  return dirs;
}

export interface LoginPathDeps {
  platform: NodeJS.Platform;
  shellEnv: string | undefined;
  isFile(p: string): boolean;
  spawn: typeof spawn;
  timeoutMs?: number;
}

/** Runs the login shell once and returns its PATH folders; [] on Windows, on any failure or after the time limit. Never rejects. */
export function readLoginShellPath(deps: LoginPathDeps): Promise<string[]> {
  if (deps.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (dirs: string[]): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(dirs);
    };
    const { file, args } = loginShellCommand(deps.shellEnv, deps.isFile);
    let child: ReturnType<typeof spawn>;
    try {
      // argv only, no shell between Durbar and the login shell; its own process group so a timeout stops what the profile started
      child = deps.spawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'], detached: true, windowsHide: true });
    } catch {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      finish([]);
    }, deps.timeoutMs ?? LOGIN_PATH_TIMEOUT_MS);
    child.stdout?.on('data', (c: Buffer) => {
      if (out.length < MAX_OUT) out += c.toString('utf8').slice(0, MAX_OUT - out.length);
    });
    child.on('error', () => finish([]));
    child.on('close', () => finish(parseLoginPath(out)));
  });
}

/** The real dependencies. */
export function nodeLoginPathDeps(): LoginPathDeps {
  return {
    platform: process.platform,
    shellEnv: process.env.SHELL,
    isFile: (p) => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    },
    spawn,
  };
}
