import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathDirs } from '../shared/pathdirs';
import { cmdShimArgs, windowsCmd } from '../shared/wincmd';

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Human-readable note on how `code` was found. */
  via: string;
  /** Which edition (FR-015): VS Code, VS Code Insiders or VSCodium. */
  edition?: string;
  /** Windows only (FR-028): `args` is already quoted for cmd.exe (the guarded `.cmd` route), so Node must pass it verbatim. Set by planCmd alone. */
  verbatim?: boolean;
}

export interface LaunchEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  /** True if the path exists and is a file. */
  isFile: (p: string) => boolean;
}

export const defaultEnv = (): LaunchEnv => ({
  platform: process.platform,
  env: process.env,
  homedir: require('os').homedir() as string,
  isFile: (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
});

/** Characters that cmd.exe would interpret, or that could break out of a quoted argument. */

/** Packaged apps started from Finder / Start menu do not inherit the shell PATH, so PATH alone is not enough. */
function pathCandidates(e: LaunchEnv, names: string[]): string[] {
  const join = e.platform === 'win32' ? path.win32.join : path.posix.join;
  const out: string[] = [];
  for (const dir of pathDirs(e.env, e.platform)) for (const n of names) out.push(join(dir, n));
  return out;
}

/** The VS Code editions "Open in VS Code" tries, in this order (spec 009 FR-015): stable first, then Insiders, then VSCodium. */
export interface Edition {
  name: string;
  /** Windows: install folder name (under %LOCALAPPDATA%\Programs, %ProgramFiles%, %ProgramFiles(x86)%), its .exe and its .cmd shim. */
  winDir: string;
  winExe: string;
  winCmd: string;
  /** macOS and Linux: the command on PATH, the app bundle name and the bundle's bin command (macOS), and fixed Linux paths. */
  bin: string;
  macApp: string;
  macBin: string;
  linux: string[];
}

export const EDITIONS: readonly Edition[] = [
  { name: 'VS Code', winDir: 'Microsoft VS Code', winExe: 'Code.exe', winCmd: 'code.cmd', bin: 'code', macApp: 'Visual Studio Code.app', macBin: 'code', linux: ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/usr/share/code/bin/code'] },
  { name: 'VS Code Insiders', winDir: 'Microsoft VS Code Insiders', winExe: 'Code - Insiders.exe', winCmd: 'code-insiders.cmd', bin: 'code-insiders', macApp: 'Visual Studio Code - Insiders.app', macBin: 'code', linux: ['/usr/bin/code-insiders', '/usr/local/bin/code-insiders', '/snap/bin/code-insiders', '/usr/share/code-insiders/bin/code-insiders'] },
  { name: 'VSCodium', winDir: 'VSCodium', winExe: 'VSCodium.exe', winCmd: 'codium.cmd', bin: 'codium', macApp: 'VSCodium.app', macBin: 'codium', linux: ['/usr/bin/codium', '/usr/local/bin/codium', '/snap/bin/codium', '/usr/share/codium/bin/codium'] },
];

/**
 * Work out how to run VS Code on a folder, without a shell where possible: the first edition found (FR-015).
 * Returns undefined if none was found. Pure apart from `e.isFile`, so it is unit tested.
 */
export function planVSCodeLaunch(target: string, e: LaunchEnv = defaultEnv()): LaunchPlan | undefined {
  for (const ed of EDITIONS) {
    const plan = planEdition(ed, target, e);
    if (plan) return { ...plan, edition: ed.name };
  }
  return undefined;
}

export function planEdition(ed: Edition, target: string, e: LaunchEnv): LaunchPlan | undefined {
  if (e.platform === 'win32') {
    const join = path.win32.join;
    const roots = [
      e.env.LOCALAPPDATA && join(e.env.LOCALAPPDATA, 'Programs', ed.winDir),
      e.env.ProgramFiles && join(e.env.ProgramFiles, ed.winDir),
      e.env['ProgramFiles(x86)'] && join(e.env['ProgramFiles(x86)'], ed.winDir),
      join(e.homedir, 'AppData', 'Local', 'Programs', ed.winDir),
    ].filter((r): r is string => !!r);
    // `<edition>.exe <folder>` opens the folder and is a real executable: no cmd.exe, no quoting problems.
    for (const root of roots) {
      const exe = join(root, ed.winExe);
      if (e.isFile(exe)) return { command: exe, args: [target], via: exe };
    }
    // the command on PATH is a .cmd in <root>\bin; use the .exe next to it if there is one.
    for (const c of pathCandidates(e, [ed.winCmd, ed.winCmd.replace(/\.cmd$/, '.exe')])) {
      if (!e.isFile(c)) continue;
      if (c.toLowerCase().endsWith('.exe')) return { command: c, args: [target], via: c };
      const exe = join(path.win32.dirname(c), '..', ed.winExe);
      if (e.isFile(exe)) return { command: path.win32.normalize(exe), args: [target], via: exe };
      return planCmd(c, target, e);
    }
    for (const root of roots) {
      const cmd = join(root, 'bin', ed.winCmd);
      if (e.isFile(cmd)) return planCmd(cmd, target, e);
    }
    return undefined;
  }

  const candidates: string[] = [];
  if (e.platform === 'darwin') {
    candidates.push(
      ...pathCandidates(e, [ed.bin]),
      `/Applications/${ed.macApp}/Contents/Resources/app/bin/${ed.macBin}`,
      path.posix.join(e.homedir, `Applications/${ed.macApp}/Contents/Resources/app/bin/${ed.macBin}`),
      `/opt/homebrew/bin/${ed.bin}`,
      `/usr/local/bin/${ed.bin}`,
    );
  } else {
    candidates.push(...pathCandidates(e, [ed.bin]), ...ed.linux);
  }
  const found = candidates.find((c) => e.isFile(c));
  return found ? { command: found, args: [target], via: found } : undefined;
}

/** Last resort on Windows: run code.cmd through cmd.exe, only when nothing in the arguments can be interpreted. */
function planCmd(cmdFile: string, target: string, e: LaunchEnv): LaunchPlan | undefined {
  // spec 009 FR-029: the one quoting helper (outer pair for /s); undefined for a CMD_UNSAFE character or a spaced target ending in \.
  // A target without white space (a drive root C:\) stays bare, so FR-028's doubling of a trailing backslash is not needed on this line.
  const args = cmdShimArgs(cmdFile, [target]);
  if (!args) return undefined;
  return { command: windowsCmd(e.env), args, via: cmdFile, verbatim: true }; // spec 045 FR-003; FR-028: passed verbatim
}

export type OpenResult = { ok: boolean; error?: string; edition?: string; note?: string };

/** Start a plan with no shell: detached, no stdio, hidden window. `spawnFn` is injectable so tests never start an editor (spec 009 FR-022). */
export function spawnPlan(plan: LaunchPlan, spawnFn: typeof spawn = spawn, platform: NodeJS.Platform = process.platform): Promise<OpenResult> {
  return new Promise((resolve) => {
    // windowsVerbatimArguments (FR-028): only a plan that says so (planCmd's /s /c string, already quoted for cmd.exe), never guessed from its args.
    const child = spawnFn(plan.command, plan.args, {
      stdio: 'ignore',
      detached: true,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: platform === 'win32' && plan.verbatim === true,
    });
    child.once('error', (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, error: err.code === 'ENOENT' ? `Could not start ${plan.edition ?? 'VS Code'} (${plan.via})` : err.message }),
    );
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, edition: plan.edition });
    });
  });
}

export const EDITOR_NOT_FOUND = 'VS Code was not found (also looked for VS Code Insiders and VSCodium). Install it from https://code.visualstudio.com (on macOS, run "Shell Command: Install \'code\' command in PATH" from its command palette, or keep it in /Applications).';

/**
 * FR-028: on Windows only a drive path (C:\dir, C:/dir) or a UNC path (\\server\share) is a target, and of the \\?\ forms only
 * \\?\C:\dir and \\?\UNC\server\share. path.win32.isAbsolute also accepts a root-relative \dir or /dir, which Code.exe (Chromium)
 * would read as a switch; device paths (\\.\pipe\x, \\.\PhysicalDrive0, \\?\GLOBALROOT\...) are no folder either, nor a
 * pipe or mailslot share (\\localhost\pipe\x, \\*\mailslot\x), a redirector prefix (\\;LanmanRedirector\...) or a
 * DOS device name in any component (C:\NUL, C:\x\COM1.txt), all refused (review of #1523).
 */
export function isWindowsTarget(p: string): boolean {
  if (!windowsTargetShape(p)) return false;
  const parts = p.split(/[\\/]/);
  // a `.` or `..` component (\\srv\.\pipe\x) is never in a realpath result; Windows would fold it away
  if (parts.some((c) => DOS_DEVICE.test(c) || c === '.' || c === '..')) return false;
  // the share after the server: \\server\share -> parts[3], \\?\UNC\server\share -> parts[5]
  const share = /^\\\\\?\\UNC\\/i.test(p) ? parts[5] : /^\\\\[^?]/.test(p) ? parts[3] : undefined;
  // Windows drops trailing dots and spaces, so \\srv\pipe. is the pipe root too; `:` starts a stream
  return !(share !== undefined && /^(?:pipe|mailslot)[ .]*(?::.*)?$/i.test(share));
}

/**
 * CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9 and LPT0-9 (also with ¹²³). Windows cuts a name at its first `.` or `:` and drops
 * trailing spaces, so NUL.txt, NUL , NUL: and NUL:stream are the device too.
 */
const DOS_DEVICE = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[0-9\u00b9\u00b2\u00b3])[ .]*(?:[.:].*)?$/i;

function windowsTargetShape(p: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\?\\')) return /^\\\\\?\\(?:[A-Za-z]:\\|UNC\\[^\\/?.;*][^\\/?*]*\\[^\\/])/i.test(p);
  // \\server\share: a server name does not start with `.` (\\.\ is the device namespace) or `;` (a redirector) and has no `?` or `*`
  return /^\\\\[^\\/?.;*][^\\/?*]*[\\/][^\\/]/.test(p);
}

/** FR-028: no Windows file name holds a control character, so on Windows a path with one is refused before anything is planned. */
const CONTROL = /[\x00-\x1f]/;

/**
 * Open a folder or .code-workspace file with VS Code.
 * A single absolute path argument; never a shell with user-controlled text (see planCmd for the one guarded exception).
 * `e` and `spawnFn` are injectable so tests can force a platform and never start an editor.
 */
export function openInVSCode(target: string, e: LaunchEnv = defaultEnv(), spawnFn: typeof spawn = spawn): Promise<OpenResult> {
  if (typeof target !== 'string') return Promise.resolve({ ok: false, error: 'path must be absolute' });
  if (target.includes('\0')) return Promise.resolve({ ok: false, error: 'invalid path' });
  if (e.platform === 'win32' && CONTROL.test(target)) return Promise.resolve({ ok: false, error: 'invalid path' });
  if (e.platform === 'win32' ? !isWindowsTarget(target) : !path.posix.isAbsolute(target)) {
    return Promise.resolve({ ok: false, error: e.platform === 'win32' ? 'path must start with a drive letter or be a UNC path' : 'path must be absolute' });
  }
  const plan = planVSCodeLaunch(target, e);
  if (!plan) {
    return Promise.resolve({
      ok: false,
      error: EDITOR_NOT_FOUND,
    });
  }
  return spawnPlan(plan, spawnFn, e.platform);
}
