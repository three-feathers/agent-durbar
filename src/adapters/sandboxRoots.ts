/**
 * Spec 087 FR-015 (T010): the session roots an OS sandbox floor makes readable (and in Ask first writable), one rule for the three
 * adapters (Codex's `codexWorkspaceRoots` calls it). Pure: the caller injects `realpath`. Roots come only from main (the session's cwd
 * and workspace folders); a root that could widen the floor or break a settings string is dropped, so the floor only narrows.
 */
import * as path from 'path';

/** Normalised absolute root and its compare key, or undefined when it must be dropped. Windows-form paths use `path.win32`, others `path.posix`. */
export function normalizeRoot(r: string): { path: string; key: string } | undefined {
  // a control character or a quote never goes into a settings JSON, a profile or argv (spec 087 edge cases): drop the root
  // eslint-disable-next-line no-control-regex
  if (!r || /["\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(r)) return undefined;
  const win = /^[A-Za-z]:[\\/]/.test(r) || r.startsWith('\\\\');
  if (!win && !r.startsWith('/')) return undefined;
  const api = win ? path.win32 : path.posix;
  let n = api.normalize(r);
  const root = api.parse(n).root;
  if (n === root || n === root.replace(/[\\/]+$/, '') || root === '') return undefined; // a filesystem root or a UNC share root
  n = n.replace(/[\\/]+$/, '');
  if (n.split(/[\\/]/).includes('..')) return undefined;
  return { path: n, key: win ? n.toLowerCase() : n };
}

/**
 * Session folders to sandbox roots: absolute paths only, normalised (`.` and `..` resolved, no trailing separator), duplicates removed
 * (case-insensitively for Windows-form paths), order kept. Dropped: a filesystem root (`/`, `C:\`, `\\server\share`), a path that
 * still holds `..`, a relative or empty entry, and one with a quote or a control character. Each root is resolved with `realpath`
 * after normalising and the rules run again on the RESOLVED path, so a link to `/` is dropped; a resolver that throws drops the root
 * (fail closed). An empty result means Read-only and Ask first are refused (spec 012 FR-091, spec 087 FR-015).
 */
export function sandboxRoots(roots: readonly unknown[] | undefined | null, realpath: (p: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(roots) ? roots : []) {
    if (typeof r !== 'string') continue;
    let n = normalizeRoot(r);
    if (n) {
      try {
        const real = realpath(n.path);
        n = typeof real === 'string' ? normalizeRoot(real) : undefined;
      } catch {
        n = undefined;
      }
    }
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n.path);
  }
  return out;
}

/**
 * Spec 087 FR-004/FR-014 (review on PR 733): credential folders and files in the home folder that a sandboxed command must never read or
 * write, also when the session folder is the home folder or a parent of it (Durbar allows that with a warning, spec 006 FR-016). Relative
 * to the home folder. Claude Code: `denyRead`/`denyWrite` entries (`~/…`); Copilot: `deniedPaths` where the host reports `denied_paths`.
 */
export const HOME_SECRETS: readonly string[] = Object.freeze(['.ssh', '.aws', '.config/gh', '.gnupg', '.netrc', '.npmrc', '.git-credentials', '.docker', '.kube', '.azure', '.config/gcloud', '.claude', '.copilot', '.codex']);
