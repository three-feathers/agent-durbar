/**
 * Office memory (spec 116): which folder may hold it (FR-004, `checkMemoryFolder`) and which git remote a folder names (FR-051,
 * `remoteHosts`). Both are pure: the file system, the home folder and the platform are passed in, so a test drives `path.win32` and
 * `path.posix` from any OS. The one import is `maskTokenShapes` (a dependency-free module); nothing here starts a process or reads a
 * file (FR-012).
 */
import { maskTokenShapes, cut } from './redact';
import { HOME_SECRETS } from './homesecrets';

/** The `path` members used; `path.win32` and `path.posix` both fit. */
export interface PathFlavor {
  sep: string;
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
  join(...p: string[]): string;
  relative(from: string, to: string): string;
  parse(p: string): { root: string };
}
export type MemoryPlatform = 'win32' | 'darwin' | 'linux';
export interface MemoryFlavor { path: PathFlavor; platform: MemoryPlatform }
export interface MemoryFolderCtx {
  home: string;
  userData: string;
  /** Every office folder (`.code-workspace` folders included), as stored. */
  officeFolders: readonly string[];
  /** `%APPDATA%`, `%LOCALAPPDATA%`, `$XDG_CONFIG_HOME`, `$XDG_DATA_HOME`, when set. */
  env?: { appData?: string; localAppData?: string; xdgConfigHome?: string; xdgDataHome?: string; systemRoot?: string; programData?: string; programFiles?: string; programFilesX86?: string };
  /** The agent apps' own homes as main reads them (`COPILOT_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, else `~/.copilot`, `~/.claude`, `~/.codex`): refused at, inside or around. */
  agentHomes?: readonly string[];
  /** `fs.realpathSync.native`; throws when the path cannot be resolved. */
  realpath(p: string): string;
  /** `fs.lstatSync`; throws when the path cannot be read. */
  lstat(p: string): { isDirectory(): boolean };
}
export type MemoryRefusal = 'not-absolute' | 'unc' | 'root' | 'home' | 'app-data' | 'agent-folder' | 'system' | 'office-folder' | 'secret-location' | 'not-folder' | 'unreadable';
export type MemoryFolderCheck = { ok: true; real: string } | { ok: false; reason: MemoryRefusal; text: string };

const TEXT: Record<MemoryRefusal, string> = {
  'not-absolute': 'It is not a full folder path.',
  unc: 'Network and device paths (\\\\server\\share, \\\\?\\) are not supported yet.',
  root: 'It is a drive or file-system root.',
  home: 'It is your home folder.',
  'app-data': "It is, is inside, or holds Durbar's own data folder.",
  'agent-folder': "It is, is inside, or holds an agent app's own folder (.copilot, .claude, .codex).",
  system: 'It is, or is inside, a folder of the operating system (for example /proc, /sys, /dev, /etc, /usr, Windows or Program Files).',
  'office-folder': 'It is, is inside, or holds a folder of the office: the agents there would be able to write to it.',
  'secret-location': 'It is, is inside, or holds a folder where programs keep passwords and settings (.ssh, .config, AppData, Library...).',
  'not-folder': 'It is not a folder.',
  unreadable: 'It cannot be read.',
};
const refuse = (reason: MemoryRefusal): MemoryFolderCheck => ({ ok: false, reason, text: TEXT[reason] });

/** Under the home folder, on every OS: the shared credential list (`homesecrets.ts`, also the OS sandbox's) and all of `.config`. */
const SECRET_NAMES: readonly string[] = [...HOME_SECRETS, '.config'];
const AGENT_APPS = ['.copilot', '.claude', '.codex'];

/** Rule 1 on the text alone: a stream (`:` after the drive), a name ending in a dot or space, UNC (`\\server`), device (`\\?\`, `\\.\`), drive-relative (`C:foo`), rooted with no drive, relative. */
function badShape(p: string, f: MemoryFlavor): MemoryRefusal | undefined {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return 'not-absolute';
  if (f.platform === 'win32') {
    if (/^[\\/]{2}/.test(p)) return 'unc';
    if (!/^[A-Za-z]:[\\/]/.test(p)) return 'not-absolute';
    if (p.indexOf(':', 2) !== -1) return 'not-absolute'; // an alternate data stream: `.ssh::$INDEX_ALLOCATION`, `.ssh:x`
    // Windows drops a trailing dot or space from a name, so `.ssh.` is `.ssh`
    if (p.split(/[\\/]/).some((c) => c !== '.' && c !== '..' && /[. ]$/.test(c))) return 'not-absolute';
    return undefined;
  }
  return f.path.isAbsolute(p) ? undefined : 'not-absolute';
}

/**
 * FR-004 (decided by the coordinator, 2026-11-24, 2026-11-27, 2026-11-28): system and pseudo folders. The candidate is already a real path, so the
 * entries are compared LITERALLY (a symlinked twin such as `/var/run` -> `/run`, `/bin` -> `/usr/bin` is listed itself). A folder that IS, is INSIDE
 * or HOLDS an entry is refused. `home: true` marks an entry a home folder can sit under (`/root`, the `/var/*` parts: service homes): inside the real
 * home those are skipped. `except` is accepted inside an entry (`/run/media`: USB sticks).
 */
interface SystemEntry { p: string; home?: boolean; except?: string }
function systemFolders(f: MemoryFlavor, e: NonNullable<MemoryFolderCtx['env']>): SystemEntry[] {
  const L = (...ps: string[]): SystemEntry[] => ps.map((p) => ({ p }));
  if (f.platform === 'win32') return L(e.systemRoot || 'C:\\Windows', e.programData || 'C:\\ProgramData', e.programFiles || 'C:\\Program Files', e.programFilesX86 || 'C:\\Program Files (x86)');
  const unix = L('/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32', '/dev');
  if (f.platform === 'darwin') return [...unix, ...L('/var', '/tmp', '/private/tmp', '/System', '/Library', '/private/var', '/private/etc')];
  // Linux: not the whole of /var (Silverblue has /home -> /var/home): its system parts; all of /run but /run/media (USB sticks)
  return [...unix, ...L('/proc', '/sys', '/boot', '/tmp'), { p: '/run', except: '/run/media' },
    { p: '/root', home: true }, ...['lib', 'log', 'cache', 'spool', 'db', 'run', 'tmp', 'mail', 'backups'].map((n) => ({ p: '/var/' + n, home: true }))];
}

export function checkMemoryFolder(candidate: string, ctx: MemoryFolderCtx, flavor: MemoryFlavor): MemoryFolderCheck {
  const p = flavor.path;
  const fold = flavor.platform !== 'linux';
  const first = badShape(candidate, flavor);
  if (first) return refuse(first);
  let real: string;
  try { real = ctx.realpath(candidate); } catch { return refuse('unreadable'); }
  const again = badShape(real, flavor); // a link to a network path
  if (again) return refuse(again);

  const key = (s: string): string => {
    let k = p.normalize(s);
    const root = p.parse(k).root;
    while (k.length > root.length && (k.endsWith('/') || k.endsWith(p.sep))) k = k.slice(0, -1);
    return fold ? k.toLowerCase() : k;
  };
  const inside = (a: string, b: string): boolean => {
    const rel = p.relative(key(b), key(a));
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !rel.startsWith('../') && !p.isAbsolute(rel));
  };
  /** Equal, inside, or holds. */
  const overlap = (a: string, b: string): boolean => inside(a, b) || inside(b, a);
  /** The path and, when it resolves, its real path. */
  const forms = (s: string): string[] => {
    if (typeof s !== 'string' || s === '' || badShape(s, flavor)) return [];
    let r: string | undefined;
    try { r = ctx.realpath(s); } catch { /* absent: the plain form still counts */ }
    return r !== undefined && key(r) !== key(s) ? [s, r] : [s];
  };
  const hits = (list: string[]): boolean => list.some((x) => forms(x).some((y) => overlap(real, y)));

  const k = key(real);
  const roots = [p.parse(real).root, ...forms(ctx.home).map((h) => p.parse(h).root)];
  if (roots.some((r) => key(r) === k)) return refuse('root');
  if (forms(ctx.home).some((h) => key(h) === k)) return refuse('home');
  if (hits([ctx.userData])) return refuse('app-data');
  // a home can sit under `/root` or a `/var/*` part (service homes, Durbar as root): inside the REAL home those are skipped; every other entry always counts,
  // and a file-system root is under none of them (HOME=/). The other rules below still apply inside home.
  // The skip needs the REAL home (the last form) to sit under `/home`, `/Users`, `/var/home` or an entry marked `home` (strictly), or to be `/root` itself:
  // HOME=/etc, HOME=/usr or a home that links there never switches the rule off.
  const sysList = systemFolders(flavor, ctx.env ?? {});
  const realHome = forms(ctx.home).slice(-1)[0];
  const homeBases = ['/home', '/Users', '/var/home', ...sysList.filter((x) => x.home).map((x) => x.p)];
  const inHome = realHome !== undefined
    && (key(realHome) === key('/root') || homeBases.some((b) => key(realHome) !== key(b) && inside(realHome, b)))
    && inside(real, realHome);
  // string compares on the normalised keys (the candidate may be 200k characters: no `relative` per entry)
  const kReal = key(real);
  const under = (ka: string, kb: string): boolean => ka === kb || ka.startsWith(kb.endsWith(p.sep) ? kb : kb + p.sep);
  const sysHit = (x: SystemEntry): boolean => {
    if (badShape(x.p, flavor) || (inHome && x.home)) return false;
    if (x.except && under(kReal, key(x.except))) return false;
    const kx = key(x.p);
    return under(kReal, kx) || under(kx, kReal);
  };
  if (sysList.some(sysHit)) return refuse('system');
  if (hits([...AGENT_APPS.map((n) => p.join(ctx.home, n)), ...(ctx.agentHomes ?? [])])) return refuse('agent-folder');
  if (hits([...ctx.officeFolders])) return refuse('office-folder');

  const secrets = SECRET_NAMES.map((n) => p.join(ctx.home, ...n.split('/')));
  const e = ctx.env ?? {};
  if (flavor.platform === 'win32') secrets.push(p.join(ctx.home, 'AppData'), e.appData ?? '', e.localAppData ?? '');
  if (flavor.platform === 'darwin') secrets.push(p.join(ctx.home, 'Library'));
  // `~/.local/share` always (a relative or unset XDG_DATA_HOME does not replace it); the variables count only when absolute (`forms` drops others)
  secrets.push(p.join(ctx.home, '.local', 'share'));
  if (flavor.platform === 'linux') secrets.push(e.xdgConfigHome ?? '', e.xdgDataHome ?? '');
  if (hits(secrets.filter((s) => s !== ''))) return refuse('secret-location');

  try { if (!ctx.lstat(real).isDirectory()) return refuse('not-folder'); } catch { return refuse('unreadable'); }
  return { ok: true, real };
}

// ---- the git remote (FR-051, FR-055) ----

/** `remote`: at least one remote (`hosts` may be empty when none has a `url`); `none`: this folder's own `.git/config` names no remote (global and system git config, `.git/remotes` and `config.worktree` are not read here: spec KNOWN GAP); `unknown`: could not check. */
export type RemoteAnswer = { kind: 'remote'; hosts: string[]; rewritten: boolean } | { kind: 'none' } | { kind: 'unknown' };
export const MAX_GIT_CONFIG = 64 * 1024;
const MAX_HOSTS = 8;
const HOST_CUT = 64;

/** `(unknown host)` is the answer whenever the text is not plainly a host. */
const UNKNOWN_HOST = '(unknown host)';
const LOCAL = '(a folder on this computer)';

/**
 * The host of a remote URL. The authority ends at the first `/ \ ? # ;` or white space (cut, nothing after it is read); user info is
 * dropped; the port is dropped; the rest must be `[A-Za-z0-9._~-]+` or a bracketed IPv6, else `(unknown host)`. An `@` between the
 * authority and the first `?` or `#` (`https://secret/x@host/y`) also answers `(unknown host)`: the secret would sit where a host sits.
 * Then masked and cut.
 */
export function hostOfRemote(url: string): string {
  let s = url.trim();
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (scheme) {
    if (scheme[1].toLowerCase() === 'file') return LOCAL;
    s = s.slice(scheme[0].length);
  } else {
    const colon = s.indexOf(':');
    const sl = s.search(/[/\\]/);
    if (/^[A-Za-z]:[\\/]/.test(s) || colon === -1 || (sl !== -1 && sl < colon)) return LOCAL;
  }
  const end = s.search(/[/\\?#;\s]/);
  let auth = end === -1 ? s : s.slice(0, end);
  if (end !== -1) {
    if (s.indexOf('@', end) !== -1) return UNKNOWN_HOST; // user info can hide after the cut (`https://secret#x@host`): any `@` there
  }
  auth = auth.slice(auth.lastIndexOf('@') + 1);
  let host: string;
  if (auth.startsWith('[')) { const c = auth.indexOf(']'); host = c === -1 ? auth : auth.slice(0, c + 1); if (!/^\[[0-9A-Fa-f:.]+\]$/.test(host)) return UNKNOWN_HOST; }
  else { host = auth.split(':')[0]; if (!/^[A-Za-z0-9._~-]+$/.test(host)) return UNKNOWN_HOST; }
  return cut(maskTokenShapes(host, '[hidden]'), HOST_CUT);
}

/** Git's own reading of a value: `"` toggles quotes, `\"` `\\` `\n` `\t` `\b` decode, `#` or `;` outside quotes starts a comment, outer blanks go. */
function configValue(raw: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const n = raw[++i];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'b' ? '\b' : n === '"' || n === '\\' ? n : '\\' + n; // unknown escapes stay as written
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '#' || c === ';')) break;
    else out += c;
  }
  return out.trim();
}
/** A line that ends in an odd number of backslashes continues on the next one. */
const continues = (line: string): boolean => { let n = 0; for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n++; return n % 2 === 1; };
const MAX_JOIN = 32;

/**
 * The remotes a `.git/config` names. Tolerant: only `url =` lines inside `[remote "..."]` sections give a host; an `include` or
 * `includeIf` section means the answer is `unknown` (the settings could live in another file), never `none`. `insteadOf` is reported as
 * `rewritten` (the real host may differ). Linear in the text; the caller reads at most 64 KB.
 */
export function remoteHosts(configText: string): RemoteAnswer {
  if (typeof configText !== 'string') return { kind: 'unknown' };
  const lines = configText.slice(0, MAX_GIT_CONFIG).split('\n');
  const hosts: string[] = [];
  let remotes = 0;
  let rewritten = false;
  let section = '';
  let doubt = false;
  const key = (line: string): void => {
    const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) {
      if (section === 'extensions' && /^\s*worktreeconfig\s*(?:[#;].*)?$/i.test(line)) doubt = true; // no `=` means true
      return;
    }
    const name = m[1].toLowerCase();
    if (/^(push)?insteadof$/.test(name)) rewritten = true;
    if (section === 'extensions' && name === 'worktreeconfig' && !/^(false|no|off|0)$/i.test(configValue(m[2]))) doubt = true;
    if (section === 'remote' && name === 'url') {
      const h = hostOfRemote(configValue(m[2]));
      if (!hosts.includes(h) && hosts.length < MAX_HOSTS) hosts.push(h);
    }
  };
  const noCr = (s: string): string => (s.endsWith('\r') ? s.slice(0, -1) : s);
  for (let i = 0; i < lines.length; i++) {
    let line = noCr(lines[i]);
    for (let j = 0; j < MAX_JOIN && continues(line) && i + 1 < lines.length; j++) line = line.slice(0, -1) + noCr(lines[++i]);
    if (continues(line) && i + 1 < lines.length) doubt = true; // still continuing at the cap: the line is not complete, so no answer from it
    const h = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\](.*)$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase();
      if (name === 'include' || name === 'includeif') return { kind: 'unknown' };
      section = name === 'extensions' ? 'extensions' : name === 'remote' || name.startsWith('remote.') ? 'remote' : name === 'url' || name.startsWith('url.') ? 'url' : 'other';
      if (section === 'remote') remotes++;
      key(h[2]);
    } else key(line);
  }
  if (doubt) return { kind: 'unknown' };
  return remotes > 0 ? { kind: 'remote', hosts, rewritten } : { kind: 'none' };
}
