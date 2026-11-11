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

/** What the user reads when a `.cmd` route is refused (spec 009 FR-029): harness setup and the update check. */
export const CMD_REFUSED = 'This command cannot be run safely on this computer.';

export function windowsCmd(env: Readonly<Record<string, string | undefined>>): string {
  const w = path.win32;
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
  if (root && w.isAbsolute(root) && !root.includes('"')) return w.join(root, 'System32', 'cmd.exe');
  const spec = env.ComSpec ?? env.COMSPEC;
  if (spec && w.isAbsolute(spec) && !spec.includes('"') && w.basename(spec).toLowerCase() === 'cmd.exe') return spec;
  return 'cmd.exe';
}

/**
 * The argument list for `cmd.exe` that runs a Windows `.cmd` shim with fixed arguments (spec 009 FR-029): `/d /s /c` and ONE string,
 * `""<file>" arg1 arg2"`, to be passed with `windowsVerbatimArguments`. With `/s`, cmd.exe removes the first and the last quote of the
 * line after `/c` and runs the rest as written, so the line carries one outer pair of quotes for cmd.exe to remove, exactly as Node's own
 * `shell: true` builds it. Without that pair cmd.exe would take the shim's own quotes away and a path with a space (`...\Microsoft VS
 * Code\bin\code.cmd`) would break at the first space. The shim is always quoted, an argument only when it holds white space. Fails closed:
 * undefined when the shim or any argument has a `CMD_UNSAFE` character (a quote among them), so nothing reaches cmd.exe that it could read
 * as a command; an empty shim name, and an argument with white space that ends in `\\`, are refused too.
 */
export function cmdShimArgs(file: string, args: readonly string[]): string[] | undefined {
  if (!file || CMD_UNSAFE.test(file) || args.some((a) => CMD_UNSAFE.test(a))) return undefined;
  // a quoted argument ending in \ would reach the program as `...\"` (a literal quote to the C runtime that code.cmd hands it to)
  if (args.some((a) => /\s/.test(a) && a.endsWith('\\'))) return undefined;
  const words = [`"${file}"`, ...args.map((a) => (a === '' || /\s/.test(a) ? `"${a}"` : a))];
  return ['/d', '/s', '/c', `"${words.join(' ')}"`];
}
