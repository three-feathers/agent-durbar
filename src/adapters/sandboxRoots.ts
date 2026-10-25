/**
 * Spec 087 FR-015 (T010): the session roots an OS sandbox floor makes readable (and in Ask first writable), one rule for the three
 * adapters (Codex's `codexWorkspaceRoots` calls it). Pure: the caller injects `realpath`. Roots come only from main (the session's cwd
 * and workspace folders); a root that could widen the floor or break a settings string is dropped, so the floor only narrows.
 */
import * as path from 'path';
import { LEFT_OUT_MAX } from '../shared/sandbox';
import { redact } from '../shared/redact';

/** Normalised absolute root and its compare key, or undefined when it must be dropped. Windows-form paths use `path.win32`, others `path.posix`. */
export function normalizeRoot(r0: string): { path: string; key: string } | undefined {
  // a control character or a quote never goes into a settings JSON, a profile or argv (spec 087 edge cases): drop the root
  // eslint-disable-next-line no-control-regex
  if (!r0 || /["\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(r0)) return undefined;
  // review round 6 on PR 733: Windows extended-length forms are checked as what they name (`\\?\UNC\srv\sh` is the share `\\srv\sh`,
  // `\\?\C:\` the drive); any other `\\?\` or a device path (`\\.\`) is dropped
  let r = r0;
  if (/^[\\/]{2}[?.][\\/]/.test(r)) {
    const rest = r.slice(4);
    if (/^UNC[\\/]/i.test(rest) && r[2] === '?') r = '\\\\' + rest.slice(4);
    else if (/^[A-Za-z]:[\\/]/.test(rest) && r[2] === '?') r = rest;
    else return undefined;
  }
  const win = /^[A-Za-z]:[\\/]/.test(r) || r.startsWith('\\\\');
  if (!win && !r.startsWith('/')) return undefined;
  // review round 7 on PR 733: a UNC path needs a server AND a share (`\\srv` alone names no folder); Windows ignores a trailing space or dot
  // in a name (`C:\ ` is `C:\`), so a Windows-form path with one is dropped rather than guessed
  if (win && r.startsWith('\\\\') && r.slice(2).split(/[\\/]/).filter(Boolean).length < 2) return undefined;
  if (win && r.split(/[\\/]/).some((part) => /[ .]$/.test(part) && part !== '.' && part !== '..')) return undefined;
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

/** Compare key of a normalised path: case-insensitive for Windows-form paths and on macOS and Windows (constitution VI). */
const keyOf = (p: string, platform: string): string => (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p);
const sepOf = (p: string): string => (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') ? '\\' : '/');

/**
 * Spec 087 (review round 2 on PR 733): the credential folders of `HOME_SECRETS` under `home` as absolute paths, and the real location of
 * each one that exists and is a link elsewhere (a `~/.ssh -> ~/dotfiles/ssh`): Claude Code's docs say only macOS follows a link on a
 * denied path, so Durbar denies both the link and its target itself. An entry whose `realpath` throws (it does not exist) has no target.
 */
export function homeSecretPaths(home: string, realpath: (p: string) => string): { literal: string[]; targets: string[] } {
  const h = normalizeRoot(home);
  if (!h) return { literal: [], targets: [] };
  const api = sepOf(h.path) === '\\' ? path.win32 : path.posix;
  const literal = HOME_SECRETS.map((x) => api.join(h.path, ...x.split('/')));
  const targets: string[] = [];
  for (const p of literal) {
    let r: { path: string } | undefined;
    try {
      r = normalizeRoot(realpath(p));
    } catch {
      r = undefined;
    }
    if (r && r.path !== p && !targets.includes(r.path)) targets.push(r.path);
  }
  return { literal, targets };
}

/**
 * How a session root relates to the credential paths: `inside` = the root is one of them or inside one (an allow and a deny would name
 * the same region: Durbar leaves the root out); `contains` = a credential path lies inside the root (the root is opened only where the
 * credential paths can be denied inside it); undefined = neither.
 */
export function secretRelation(root: string, secrets: readonly string[], platform: string): 'inside' | 'contains' | undefined {
  const r = keyOf(root, platform);
  const sep = sepOf(root);
  let contains = false;
  for (const s0 of secrets) {
    const s = keyOf(s0, platform);
    if (r === s || r.startsWith(s + sep)) return 'inside';
    if (s.startsWith(r + sep)) contains = true;
  }
  return contains ? 'contains' : undefined;
}

/**
 * Spec 087 (review rounds 3-4 on PR 733): the refusal when the credential filter drops the session's own folder. Like FR-015's empty-roots
 * refusal: nothing is sent, and the text contains "Read-only and Ask first need" so the window offers Change mode…. Per app: `holds` is
 * true only where a folder that HOLDS a credential folder is also left out (Copilot without `denied_paths`); Claude Code drops only a
 * folder that is a credential folder or inside one.
 */
export const CREDENTIAL_FOLDER_REFUSAL = (app: string, holds = false): string =>
  `${app}: this session's folder ${holds ? 'is a credential folder, sits inside one or holds one (for example ~/.ssh or ~/.config)' : 'is a credential folder or sits inside one (for example ~/.ssh)'}, so the OS sandbox keeps its commands out of it. Read-only and Ask first need at least one usable folder, so nothing was sent.`;

/** Spec 087 (review round 4 on PR 733): the state's line naming the other session folders the floor leaves out (shown in its tooltip). */
export interface LeftOut {
  folder: string;
  why: 'credential' | 'unusable';
}
const WHY: Record<LeftOut['why'], string> = { credential: 'credential folder', unusable: 'not usable' };
/** The longest folder shown in the list (its start and end are kept). */
const FOLDER_SHOWN = 120;
/** Review round 7 on PR 733: masked first (the app's redact), then shortened, never inside a word or a `[redacted]` mark. */
const WORDCH = /[A-Za-z0-9_\-.~+=:@%[\]]/;
const shortFolder = (f: string): string => {
  const m = redact(f);
  if (m.length <= FOLDER_SHOWN) return m;
  let end = 40;
  while (end > 0 && WORDCH.test(m[end - 1])) end--;
  let start = m.length - (FOLDER_SHOWN - 41);
  while (start < m.length && WORDCH.test(m[start])) start++;
  return `${m.slice(0, end)}…${m.slice(start)}`;
};
/**
 * Spec 087 (review rounds 4-6 on PR 733): the state fields that name the folders the floor left out: a short reason, and a bounded list
 * (`LEFT_OUT_MAX` entries, each "<folder> (credential folder | not usable)", the folder shortened; main masks and cuts each) plus a count
 * of the rest, so a long list never pushes a folder out of a 200-character reason.
 */
export function leftOutFields(folders: readonly LeftOut[]): { reason: string; leftOut: string[]; leftOutMore?: number } | undefined {
  if (!folders.length) return undefined;
  const shown = folders.slice(0, LEFT_OUT_MAX).map((f) => `${shortFolder(f.folder)} (${WHY[f.why]})`);
  return { reason: 'Some session folders are left out of the sandbox: credential folders, or paths it cannot use.', leftOut: shown, ...(folders.length > LEFT_OUT_MAX ? { leftOutMore: folders.length - LEFT_OUT_MAX } : {}) };
}

/**
 * Spec 087 (review round 5 on PR 733): the session's other folders, each kept (its resolved path, the only form ever passed on, for
 * example as Claude's `--add-dir`) or left out with its reason. An allow-list: a folder the sandbox does not hold is never passed on.
 */
export function splitFolders(folders: readonly string[], own: string, granted: readonly string[], realpath: (p: string) => string): { kept: string[]; leftOut: LeftOut[] } {
  const kept: string[] = [];
  const leftOut: LeftOut[] = [];
  for (const f of folders) {
    if (f === own) continue;
    const real = sandboxRoots([f], realpath)[0];
    if (real === undefined) leftOut.push({ folder: f, why: 'unusable' });
    else if (!granted.includes(real)) leftOut.push({ folder: f, why: 'credential' });
    else if (!kept.includes(real)) kept.push(real);
  }
  return { kept, leftOut };
}
