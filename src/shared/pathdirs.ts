import * as path from 'path';

/**
 * The absolute folders of PATH, in order (spec 060 FR-094). Pure: the caller passes the environment and the platform.
 * Windows: `PATH`, else `Path`; split on `;`; one pair of surrounding double quotes stripped; case-insensitive dedupe, first wins.
 * macOS and Linux: `PATH`; split on `:`; exact dedupe. Empty and non-absolute entries are dropped on both.
 */
export function pathDirs(env: Record<string, string | undefined>, platform: NodeJS.Platform | string): string[] {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const raw = win ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(win ? ';' : ':')) {
    let dir = part;
    if (win) {
      dir = dir.trim();
      if (dir.length >= 2 && dir.startsWith('"') && dir.endsWith('"')) dir = dir.slice(1, -1).trim();
    }
    if (!dir || !p.isAbsolute(dir)) continue;
    const key = win ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}
