/**
 * The `cmd.exe` that runs a Windows `.cmd` shim (spec 045 FR-003). The system's own copy under `%SystemRoot%\System32` comes
 * first; `ComSpec` is taken only when it is an absolute path to a file named `cmd.exe`; otherwise plain `cmd.exe` (found on
 * PATH by Windows). Environment text is never run as a command on its own. Windows path rules on every OS, so it can be tested.
 */
import * as path from 'path';

/**
 * Characters that make a path or argument unsafe on a `cmd.exe` command line (quotes, separators, redirection, expansion,
 * line breaks). A `.cmd` shim or a target containing one is never run through `cmd` (spec 045 FR-003, spec 012 FR-041).
 */
export const CMD_UNSAFE = /[\r\n\0"&|<>^%!`(),;=]/;

export function windowsCmd(env: Readonly<Record<string, string | undefined>>): string {
  const w = path.win32;
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
  if (root && w.isAbsolute(root) && !root.includes('"')) return w.join(root, 'System32', 'cmd.exe');
  const spec = env.ComSpec ?? env.COMSPEC;
  if (spec && w.isAbsolute(spec) && !spec.includes('"') && w.basename(spec).toLowerCase() === 'cmd.exe') return spec;
  return 'cmd.exe';
}
