/**
 * Spec 033 FR-090: which folder is "already in the office". One pure decision, importable by tests (main.ts is not): the key of a folder
 * is its real path (links followed; the path as written when it does not exist) and, on Windows and macOS where a name differs only by
 * case on the same disk, lower-cased. Trailing slashes and `..` go with `path.resolve`.
 */
import * as fs from 'fs';
import * as path from 'path';

export function canonicalKey(p: string, platform: string = process.platform, realpath: (p: string) => string = fs.realpathSync.native): string {
  const abs = path.resolve(p);
  let real = abs;
  try { real = realpath(abs); } catch { /* it does not exist (yet): the path as written */ }
  return platform === 'win32' || platform === 'darwin' ? real.toLowerCase() : real;
}

/**
 * The agent already holding `want` (the folder or workspace file main resolved for the picked path), any floor, hidden or not.
 * `keyOf` is main's `wsKey` (the workspace file, else the folder).
 */
export function findAdded<T>(want: string, agents: Iterable<T>, keyOf: (a: T) => string, platform: string = process.platform, realpath?: (p: string) => string): T | undefined {
  const k = canonicalKey(want, platform, realpath);
  for (const a of agents) if (canonicalKey(keyOf(a), platform, realpath) === k) return a;
  return undefined;
}
