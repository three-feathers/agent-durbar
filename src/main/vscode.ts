import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathDirs } from '../shared/pathdirs';
import { CMD_UNSAFE, windowsCmd } from '../shared/wincmd';

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Human-readable note on how `code` was found. */
  via: string;
  /** Which edition (FR-015): VS Code, VS Code Insiders or VSCodium. */
  edition?: string;
}

export interface LaunchEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  /** True if the path exists and is a file. */
  isFile: (p: string) => boolean;
}

const defaultEnv = (): LaunchEnv => ({
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

function planEdition(ed: Edition, target: string, e: LaunchEnv): LaunchPlan | undefined {
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
  if (CMD_UNSAFE.test(target) || CMD_UNSAFE.test(cmdFile)) return undefined;
  const comspec = windowsCmd(e.env); // spec 045 FR-003
  return { command: comspec, args: ['/d', '/s', '/c', `"${cmdFile}" "${target}"`], via: cmdFile };
}

/**
 * Open a folder or .code-workspace file with VS Code.
 * A single absolute path argument; never a shell with user-controlled text (see planCmd for the one guarded exception).
 */
export function openInVSCode(target: string): Promise<{ ok: boolean; error?: string; edition?: string }> {
  return new Promise((resolve) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return resolve({ ok: false, error: 'path must be absolute' });
    if (target.includes('\0')) return resolve({ ok: false, error: 'invalid path' });
    const plan = planVSCodeLaunch(target);
    if (!plan) {
      return resolve({
        ok: false,
        error: 'VS Code was not found (also looked for VS Code Insiders and VSCodium). Install it from https://code.visualstudio.com (on macOS, run "Shell Command: Install \'code\' command in PATH" from its command palette, or keep it in /Applications).',
      });
    }
    // windowsVerbatimArguments: the /s /c string above is already quoted for cmd.exe.
    const child = spawn(plan.command, plan.args, {
      stdio: 'ignore',
      detached: true,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32' && plan.args[0] === '/d',
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
