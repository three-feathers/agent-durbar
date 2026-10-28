/**
 * Spec 093 (create a folder from + Folder): the rules for a new folder's name. Pure: no Node, no Electron. Main checks every
 * name here before anything is created (FR-010); the window keeps no copy of the rules (it shows main's answer).
 * Phase 2 (clone): the clone URL rules (`checkCloneUrl`, FR-020..FR-023), the suggested name (FR-011), git's failure texts (FR-071)
 * and its progress lines (FR-040).
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
  /** Characters of a clone URL (FR-020). */
  url: 2048,
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
  // a UTF-16 surrogate without its pair is not a character: how each file system and Git for Windows store it is unknown, so refuse it
  // (in `u` mode the range matches only unpaired surrogates; an emoji is one code point and passes)
  if (/[\ud800-\udfff]/u.test(v)) return bad('The name has a broken character. Type it again.');
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

/* ---- Phase 2: clone ---- */

export type CloneUrlForm = 'https' | 'ssh' | 'scp';
export type CloneUrlCheck = { ok: true; url: string; form: CloneUrlForm; host: string } | { ok: false; error: string };

export const CLONE_URL_MSG = Object.freeze({
  empty: 'Paste the address of the repository.',
  long: `The address is too long (at most ${NEW_FOLDER_LIMITS.url} characters).`,
  space: 'Remove spaces, tabs and line breaks from the address.',
  ascii: 'Use plain ASCII in the address (write an international host name in its xn-- form).',
  form: 'Use an https:// or ssh address (for example git@github.com:owner/repo.git).',
  password: 'Remove the password from the address. Durbar uses your own git credentials.',
  encodedUser: 'Write the user name without % codes (an encoded : or @ could hide a password).',
  dash: 'No part of the address may start with -.',
});

/** A DNS name (labels of letters, digits and `-`, not starting or ending with `-`) or an IPv4 address (FR-020). */
function hostOk(h: string): boolean {
  if (!h || h.length > 253) return false;
  return h.split('.').every((l) => l.length >= 1 && l.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(l));
}
/** A bracketed IPv6 address: hex digits, `:` and `.` (an IPv4 tail) only, at least one `:`. */
const ipv6Ok = (h: string): boolean => /^\[[0-9A-Fa-f:.]{2,45}\]$/.test(h) && h.includes(':');
/** RFC 3986 path characters (unreserved, sub-delims, `:`, `@`, `/`) and `%HH` other than a control character. No `\`, `?` or `#`. */
function pathOk(p: string): boolean {
  if (!/^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})+$/.test(p)) return false;
  return !/%(?:[01][0-9A-Fa-f]|7[Ff])/.test(p);
}
/** The user part (FR-020, FR-023): `:` is a password, `%` could hide one (R3), then the allowed characters, never a leading `-`. */
function userError(u: string): string | undefined {
  if (u.includes(':')) return CLONE_URL_MSG.password;
  if (u.includes('%')) return CLONE_URL_MSG.encodedUser;
  if (u.startsWith('-')) return CLONE_URL_MSG.dash;
  return /^[A-Za-z0-9._~+-]+$/.test(u) ? undefined : CLONE_URL_MSG.form;
}

/**
 * FR-020..FR-023: a clone URL in exactly one of three forms, ASCII only, at most 2048 characters, no whitespace or control character:
 * `https://[user@]host[:port]/path`, `ssh://[user@]host[:port]/path` (scheme in any case) and scp-style `user@host:path` (the user is
 * required, so `C:\x` or `host:path` is never read as one). Everything else is refused: other schemes (`file:`, `git://`, `http://`,
 * `ftp://`), `<transport>::<address>` and any `::` outside brackets, local paths, a leading `-` in any part, a password (Q3 = a), a
 * `%` in the user part (R3). Main checks it in `folders:createCheck` and again in `folders:create`; the git runner checks it a third
 * time. `url` is the address to use, with the scheme lower-cased (git 2.43 refuses "transport 'HTTPS'"); `host` is the host part only
 * (for the Allow all sentence, FR-061): never the user part, port or path. Never throws.
 */
export function checkCloneUrl(v: unknown): CloneUrlCheck {
  const bad = (error: string): CloneUrlCheck => ({ ok: false, error });
  if (typeof v !== 'string' || v.length === 0) return bad(CLONE_URL_MSG.empty);
  if (v.length > NEW_FOLDER_LIMITS.url) return bad(CLONE_URL_MSG.long);
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return bad(CLONE_URL_MSG.space);
  if (/[^\x21-\x7e]/.test(v)) return bad(CLONE_URL_MSG.ascii);
  if (v.startsWith('-')) return bad(CLONE_URL_MSG.dash);
  if (/[\\?#]/.test(v)) return bad(CLONE_URL_MSG.form);
  if (v.replace(/\[[^\]]*\]/g, '[]').includes('::')) return bad(CLONE_URL_MSG.form); // ext::, fd::, any <transport>::
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(v);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== 'https' && s !== 'ssh') return bad(CLONE_URL_MSG.form);
    const rest = scheme[2];
    const slash = rest.indexOf('/');
    if (slash < 0) return bad(CLONE_URL_MSG.form);
    const authority = rest.slice(0, slash);
    const p = rest.slice(slash);
    const at = authority.lastIndexOf('@');
    if (at >= 0) {
      const u = authority.slice(0, at);
      if (!u) return bad(CLONE_URL_MSG.form);
      const ue = userError(u);
      if (ue) return bad(ue);
    }
    const hp = authority.slice(at + 1);
    const m = /^(\[[^\]]*\]|[^:\[\]]*)(?::([0-9]{1,5}))?$/.exec(hp);
    if (!m) return bad(CLONE_URL_MSG.form);
    const host = m[1];
    if (host.startsWith('-')) return bad(CLONE_URL_MSG.dash);
    if (!(host.startsWith('[') ? ipv6Ok(host) : hostOk(host))) return bad(CLONE_URL_MSG.form);
    if (m[2] !== undefined && !(Number(m[2]) >= 1 && Number(m[2]) <= 65535)) return bad(CLONE_URL_MSG.form);
    if (p.length < 2 || !pathOk(p.slice(1))) return bad(CLONE_URL_MSG.form);
    return { ok: true, url: `${s}://${rest}`, form: s, host }; // the scheme lower-cased: git refuses `HTTPS` as a transport name
  }
  // scp style: user@host:path (git reads it so only when no `/` comes before the first `:`)
  const at = v.indexOf('@');
  if (at <= 0) return bad(CLONE_URL_MSG.form);
  const u = v.slice(0, at);
  if (u.includes('/')) return bad(CLONE_URL_MSG.form);
  const ue = userError(u);
  if (ue) return bad(ue);
  const rest = v.slice(at + 1);
  const m = /^(\[[^\]]*\]|[^:\[\]/@]*):(.*)$/.exec(rest);
  if (!m) return bad(CLONE_URL_MSG.form);
  const host = m[1];
  const p = m[2];
  if (host.startsWith('-') || p.startsWith('-')) return bad(CLONE_URL_MSG.dash);
  if (!(host.startsWith('[') ? ipv6Ok(host) : hostOk(host))) return bad(CLONE_URL_MSG.form);
  if (!p || !pathOk(p)) return bad(CLONE_URL_MSG.form);
  return { ok: true, url: v, form: 'scp', host };
}

/**
 * FR-011: the suggested folder name: the URL's last path segment without a trailing `/` and `.git`, `%HH` decoded, kept only when it
 * passes FR-010 (else empty, so the field starts empty). For an accepted URL only (else empty).
 */
export function suggestedName(url: unknown): string {
  const c = checkCloneUrl(url);
  if (!c.ok) return '';
  // scp: the path follows `user@host:`; https and ssh: it follows `scheme://authority`
  const p = c.form === 'scp' ? c.url.slice(c.url.indexOf('@') + 1 + c.host.length + 1) : c.url.replace(/^[^:]+:\/\/[^/]*/, '');
  const seg = p.replace(/\/+$/, '').split('/').pop() || '';
  let name = seg.replace(/\.git$/i, '');
  try { name = decodeURIComponent(name); } catch { return ''; }
  return checkNewFolderName(name).ok ? name : '';
}

/**
 * FR-071: the plain message for a failed clone, from git's stderr (raw; the caller adds git's masked last line under it). `host` is
 * `checkCloneUrl`'s host (for the unknown host key message, Q4 = a). '' when no common failure matches.
 */
export function gitFailureText(stderrTail: unknown, host: string): string {
  const t = typeof stderrTail === 'string' ? stderrTail : '';
  if (/uses plaintext credentials/i.test(t)) return CLONE_URL_MSG.password;
  if (/SSL certificate problem|unable to get local issuer certificate|server certificate verification failed|certificate verify failed|SSL_ERROR|schannel|Proxy CONNECT aborted|Failed to connect to proxy|Could not resolve proxy|proxy.*(?:refused|denied)/i.test(t)) {
    return 'The secure connection failed. Durbar does not pass GIT_SSL_NO_VERIFY, GIT_SSL_CERT, GIT_SSL_KEY, GIT_PROXY_COMMAND or your other GIT_* variables to git (only GIT_SSL_CAINFO and GIT_SSL_CAPATH, as absolute paths): if you set one of them, put the setting in your git config instead (http.sslCAInfo, http.proxy).';
  }
  if (/Host key verification failed|No [A-Za-z0-9-]+ host key is known|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(t)) return `The ssh host key of ${host} is not known yet. Connect once with ssh in a terminal, then try again.`;
  if (/Authentication failed|could not read (?:Username|Password)|Permission denied \(publickey|terminal prompts disabled|Invalid username or password|HTTP Basic: Access denied/i.test(t)) {
    return 'Sign-in failed: Durbar uses your own git credentials and cannot ask for a password. Set up a credential helper or an ssh agent, then try again.';
  }
  if (/transport '[^']*' not allowed|Unable to find remote helper|protocol '?[^ ]*'? is not supported|unsupported protocol/i.test(t)) return 'Git refused that kind of address: Durbar clones over https and ssh only.';
  if (/Repository not found|does not appear to be a git repository|repository '[^']*' not found|returned error: 404/i.test(t)) return 'The repository was not found. Check the address, and that your account can see it.';
  if (/Could not resolve host|Connection refused|timed out|Network is unreachable|Failed to connect to|Connection reset|Could not read from remote repository/i.test(t)) return 'Could not reach the server. Check the address and your network connection.';
  if (/No space left on device/i.test(t)) return 'The disk is full. Free some space or choose another place.';
  if (/Filename too long|File name too long/i.test(t)) return 'A file in this repository has a path too long for this computer. Choose a shorter place or name.';
  return '';
}

/** FR-040: git's progress phases, as git writes them ("Receiving objects:  45% (…)"); `remote:` lines are the server's. */
const PROGRESS_RE = /^(?:remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files|Filtering content)\s*:\s*(?:(\d{1,3})%)?/;
export type CloneProgressLine = { phase: string; percent?: number };
/** FR-040: the phase and percent of one line of git's stderr, or undefined when it is not a progress line. */
export function parseCloneProgress(line: unknown): CloneProgressLine | undefined {
  if (typeof line !== 'string') return undefined;
  const m = PROGRESS_RE.exec(line.trim());
  if (!m) return undefined;
  const pct = m[2] === undefined ? undefined : Number(m[2]);
  return { phase: m[1], ...(pct !== undefined && pct >= 0 && pct <= 100 ? { percent: pct } : {}) };
}
