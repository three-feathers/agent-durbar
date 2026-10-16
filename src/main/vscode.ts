import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Human-readable note on how `code` was found. */
  via: string;
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
const CMD_UNSAFE = /[\r\n\0"&|<>^%!`(),;=]/;

/** Packaged apps started from Finder / Start menu do not inherit the shell PATH, so PATH alone is not enough. */
function pathCandidates(e: LaunchEnv, names: string[]): string[] {
  const sep = e.platform === 'win32' ? ';' : ':';
  const join = e.platform === 'win32' ? path.win32.join : path.posix.join;
  const out: string[] = [];
  for (const dir of (e.env.PATH ?? e.env.Path ?? '').split(sep)) {
    if (!dir || !(e.platform === 'win32' ? path.win32.isAbsolute(dir) : path.posix.isAbsolute(dir))) continue;
    for (const n of names) out.push(join(dir, n));
  }
  return out;
}

/**
 * Work out how to run VS Code on a folder, without a shell where possible.
 * Returns undefined if VS Code was not found. Pure apart from `e.isFile`, so it is unit tested.
 */
export function planVSCodeLaunch(target: string, e: LaunchEnv = defaultEnv()): LaunchPlan | undefined {
  if (e.platform === 'win32') {
    const join = path.win32.join;
    const roots = [
      e.env.LOCALAPPDATA && join(e.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
      e.env.ProgramFiles && join(e.env.ProgramFiles, 'Microsoft VS Code'),
      e.env['ProgramFiles(x86)'] && join(e.env['ProgramFiles(x86)'], 'Microsoft VS Code'),
      join(e.homedir, 'AppData', 'Local', 'Programs', 'Microsoft VS Code'),
    ].filter((r): r is string => !!r);
    // `Code.exe <folder>` opens the folder and is a real executable: no cmd.exe, no quoting problems.
    for (const root of roots) {
      const exe = join(root, 'Code.exe');
      if (e.isFile(exe)) return { command: exe, args: [target], via: exe };
    }
    // `code` on PATH is `code.cmd` in <root>\bin; use the Code.exe next to it if there is one.
    for (const c of pathCandidates(e, ['code.cmd', 'code.exe'])) {
      if (!e.isFile(c)) continue;
      if (c.toLowerCase().endsWith('.exe')) return { command: c, args: [target], via: c };
      const exe = join(path.win32.dirname(c), '..', 'Code.exe');
      if (e.isFile(exe)) return { command: path.win32.normalize(exe), args: [target], via: exe };
      return planCmd(c, target, e);
    }
    for (const root of roots) {
      const cmd = join(root, 'bin', 'code.cmd');
      if (e.isFile(cmd)) return planCmd(cmd, target, e);
    }
    return undefined;
  }

  const candidates: string[] = [];
  if (e.platform === 'darwin') {
    candidates.push(
      ...pathCandidates(e, ['code']),
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      path.posix.join(e.homedir, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
      '/opt/homebrew/bin/code',
      '/usr/local/bin/code',
    );
  } else {
    candidates.push(...pathCandidates(e, ['code']), '/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/usr/share/code/bin/code');
  }
  const found = candidates.find((c) => e.isFile(c));
  return found ? { command: found, args: [target], via: found } : undefined;
}

/** Last resort on Windows: run code.cmd through cmd.exe, only when nothing in the arguments can be interpreted. */
function planCmd(cmdFile: string, target: string, e: LaunchEnv): LaunchPlan | undefined {
  if (CMD_UNSAFE.test(target) || CMD_UNSAFE.test(cmdFile)) return undefined;
  const comspec = e.env.ComSpec || e.env.COMSPEC || 'cmd.exe';
  return { command: comspec, args: ['/d', '/s', '/c', `"${cmdFile}" "${target}"`], via: cmdFile };
}

/**
 * Open a folder or .code-workspace file with VS Code.
 * A single absolute path argument; never a shell with user-controlled text (see planCmd for the one guarded exception).
 */
export function openInVSCode(target: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return resolve({ ok: false, error: 'path must be absolute' });
    if (target.includes('\0')) return resolve({ ok: false, error: 'invalid path' });
    const plan = planVSCodeLaunch(target);
    if (!plan) {
      return resolve({
        ok: false,
        error: 'VS Code was not found. Install it from https://code.visualstudio.com (on macOS, run "Shell Command: Install \'code\' command in PATH" from its command palette, or keep it in /Applications).',
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
      resolve({ ok: false, error: err.code === 'ENOENT' ? `Could not start VS Code (${plan.via})` : err.message }),
    );
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}
