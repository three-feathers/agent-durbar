/**
 * Spec 093 (create a folder from + Folder): the rules for a new folder's name. Pure: no Node, no Electron. Main checks every
 * name here before anything is created (FR-010); the window keeps no copy of the rules (it shows main's answer).
 * Phase 2 (clone) adds the URL rules here (`checkCloneUrl`, `suggestedName`).
 */
import { CONTROL_RE, HIDDEN_RE } from './names';
import { redact } from './redact';

export const NEW_FOLDER_LIMITS = Object.freeze({
  /** Characters (code points) in a folder name (FR-010). */
  name: 100,
  /** Characters of the whole target path on Windows (FR-013, D10: git's own files must still fit 260). */
  winPath: 200,
  /** Characters of a remembered parent folder in settings (FR-006). */
  parent: 4096,
});

/**
 * Windows device names (constitution VI): `CON`, `con.txt` or `COM¹` is a device there, so a file or folder with such a name breaks
 * Windows. Refused on every platform, any case, with or without an extension. One constant for profile names (spec 043 FR-011,
 * re-exported by `src/main/profilefiles.ts`) and new folders (spec 093 FR-010). Microsoft's current list: also CONIN$, CONOUT$,
 * COM0, LPT0 and the superscript digits \u00b9 \u00b2 \u00b3 after COM and LPT; spaces before the extension do not help (`CON .txt` is CON).
 */
export const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]) *(\.|$)/i;

/**
 * Characters HFS+ ignores in a name (git's `is_hfs_dotgit`, CVE-2014-9390): `.g<U+200C>it` is `.git` on a Mac. Removed before the
 * `.git` comparison only; several of them are refused anyway as hidden characters (`HIDDEN_RE`). For `replace` only (global).
 */
const GIT_IGNORED_ALL_RE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;

/** Characters Windows refuses in a name; refused on every OS so a folder made on Linux also works on Windows (FR-010). */
const WINDOWS_BAD_CHARS = /[<>:"|?*]/;

export type NewFolderNameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * FR-010: a new folder's name, as main receives it (the window trims spaces at both ends; main does not trim, so a name that still
 * ends in a space is refused). One message per rule. Never throws.
 */
export function checkNewFolderName(v: unknown): NewFolderNameCheck {
  const bad = (error: string): NewFolderNameCheck => ({ ok: false, error });
  if (typeof v !== 'string' || v.length === 0) return bad('Type a name for the new folder.');
  if ([...v].length > NEW_FOLDER_LIMITS.name) return bad(`Use at most ${NEW_FOLDER_LIMITS.name} characters.`);
  if (v.includes('/') || v.includes('\\')) return bad('A single folder name, without / or \\.');
  if (v === '.' || v === '..') return bad('Use a name other than . or ..');
  if (CONTROL_RE.test(v) || HIDDEN_RE.test(v)) return bad('Remove control or hidden characters.');
  if (WINDOWS_BAD_CHARS.test(v)) return bad('Remove these characters: < > : " | ? *');
  if (WINDOWS_RESERVED_NAME.test(v)) return bad('That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9). Choose another.');
  if (/[. ]$/.test(v)) return bad('Do not end the name with a dot or a space.');
  if (v.startsWith('-')) return bad('Do not start the name with -.');
  if (v.replace(GIT_IGNORED_ALL_RE, '').toLowerCase() === '.git') return bad('Use a name other than .git.');
  if (/^git~\d+$/i.test(v)) return bad('Use a name other than .git.'); // the NTFS short name of .git (git's is_ntfs_dotgit)
  if (redact(v) !== v) return bad('That looks like a secret. Use another name.');
  return { ok: true, name: v };
}

/**
 * FR-006: the remembered parent folder (`newFolderParent` in settings): an absolute path (POSIX `/…`, Windows `C:\…`, `C:/…` or a
 * `\\server\share` path), at most 4096 characters, no control or hidden characters. Anything else is dropped (`undefined`). It is a
 * path, never a token. Main still checks it is a folder before the picker starts there (D2).
 */
export function parseNewFolderParent(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v || v.length > NEW_FOLDER_LIMITS.parent || CONTROL_RE.test(v) || HIDDEN_RE.test(v)) return undefined;
  return /^\//.test(v) || /^[A-Za-z]:[\\/]/.test(v) || /^\\\\[^\\/]+[\\/][^\\/]/.test(v) ? v : undefined;
}
