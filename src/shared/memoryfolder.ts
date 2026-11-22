/**
 * Office memory (spec 116): which folder may hold it (FR-004, `checkMemoryFolder`) and which git remote a folder names (FR-051,
 * `remoteHosts`). Both are pure: the file system, the home folder and the platform are passed in, so a test drives `path.win32` and
 * `path.posix` from any OS. The one import is `maskTokenShapes` (a dependency-free module); nothing here starts a process or reads a
 * file (FR-012).
 */
import { maskTokenShapes, cut } from './redact';

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
  env?: { appData?: string; localAppData?: string; xdgConfigHome?: string; xdgDataHome?: string };
  /** `fs.realpathSync.native`; throws when the path cannot be resolved. */
  realpath(p: string): string;
  /** `fs.lstatSync`; throws when the path cannot be read. */
  lstat(p: string): { isDirectory(): boolean };
}
export type MemoryRefusal = 'not-absolute' | 'unc' | 'root' | 'home' | 'app-data' | 'agent-folder' | 'office-folder' | 'secret-location' | 'not-folder' | 'unreadable';
export type MemoryFolderCheck = { ok: true; real: string } | { ok: false; reason: MemoryRefusal; text: string };

const TEXT: Record<MemoryRefusal, string> = {
  'not-absolute': 'It is not a full folder path.',
  unc: 'Network and device paths (\\\\server\\share, \\\\?\\) are not supported yet.',
  root: 'It is a drive or file-system root.',
  home: 'It is your home folder.',
  'app-data': "It is, is inside, or holds Durbar's own data folder.",
  'agent-folder': "It is, is inside, or holds an agent app's own folder (.copilot, .claude, .codex).",
  'office-folder': 'It is, is inside, or holds a folder of the office: the agents there would be able to write to it.',
  'secret-location': 'It is, is inside, or holds a folder where programs keep passwords and settings (.ssh, .config, AppData, Library...).',
  'not-folder': 'It is not a folder.',
  unreadable: 'It cannot be read.',
};
const refuse = (reason: MemoryRefusal): MemoryFolderCheck => ({ ok: false, reason, text: TEXT[reason] });

/** Under the home folder, on every OS. */
const HOME_SECRETS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config', '.npmrc'];
const AGENT_APPS = ['.copilot', '.claude', '.codex'];

/** Rule 1 on the text alone: UNC (`\\server`), device (`\\?\`, `\\.\`), drive-relative (`C:foo`), rooted with no drive, relative. */
function badShape(p: string, f: MemoryFlavor): MemoryRefusal | undefined {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return 'not-absolute';
  if (f.platform === 'win32') {
    if (/^[\\/]{2}/.test(p)) return 'unc';
    if (!/^[A-Za-z]:[\\/]/.test(p)) return 'not-absolute';
    return undefined;
  }
  return f.path.isAbsolute(p) ? undefined : 'not-absolute';
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
  if (hits(AGENT_APPS.map((n) => p.join(ctx.home, n)))) return refuse('agent-folder');
  if (hits([...ctx.officeFolders])) return refuse('office-folder');

  const secrets = HOME_SECRETS.map((n) => p.join(ctx.home, n));
  const e = ctx.env ?? {};
  if (flavor.platform === 'win32') secrets.push(p.join(ctx.home, 'AppData'), e.appData ?? '', e.localAppData ?? '');
  if (flavor.platform === 'darwin') secrets.push(p.join(ctx.home, 'Library'));
  if (flavor.platform === 'linux') secrets.push(e.xdgConfigHome ?? '', e.xdgDataHome || p.join(ctx.home, '.local', 'share'));
  if (hits(secrets.filter((s) => s !== ''))) return refuse('secret-location');

  try { if (!ctx.lstat(real).isDirectory()) return refuse('not-folder'); } catch { return refuse('unreadable'); }
  return { ok: true, real };
}

// ---- the git remote (FR-051, FR-055) ----

/** `remote`: at least one remote (`hosts` may be empty when none has a `url`); `none`: a readable config with no remote; `unknown`: could not check. */
export type RemoteAnswer = { kind: 'remote'; hosts: string[]; rewritten: boolean } | { kind: 'none' } | { kind: 'unknown' };
export const MAX_GIT_CONFIG = 64 * 1024;
const MAX_HOSTS = 8;
const HOST_CUT = 64;

/** The host of a remote URL: scheme, user info (and any token in it), port and path dropped first; then masked and cut. */
export function hostOfRemote(url: string): string {
  let s = url.trim();
  let host: string;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (scheme) {
    if (scheme[1].toLowerCase() === 'file') return '(a folder on this computer)';
    s = s.slice(scheme[0].length);
  } else {
    const colon = s.indexOf(':');
    const sl = s.search(/[/\\]/);
    if (/^[A-Za-z]:[\\/]/.test(s) || colon === -1 || (sl !== -1 && sl < colon)) return '(a folder on this computer)';
  }
  const slash = s.search(/[/\\]/);
  let auth = slash === -1 ? s : s.slice(0, slash);
  auth = auth.slice(auth.lastIndexOf('@') + 1);
  if (auth.startsWith('[')) { const c = auth.indexOf(']'); host = c === -1 ? auth : auth.slice(0, c + 1); }
  else host = auth.split(':')[0];
  host = host.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  if (host === '') return '(unknown host)';
  return cut(maskTokenShapes(host, '[hidden]'), HOST_CUT);
}

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
  const key = (line: string): void => {
    const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) return;
    const name = m[1].toLowerCase();
    if (/^(push)?insteadof$/.test(name)) rewritten = true;
    if (section === 'remote' && name === 'url') {
      let v = m[2];
      if (v.startsWith('"')) { const q = v.indexOf('"', 1); v = q === -1 ? v.slice(1) : v.slice(1, q); }
      else v = v.replace(/\s[#;].*$/, '');
      const h = hostOfRemote(v);
      if (!hosts.includes(h) && hosts.length < MAX_HOSTS) hosts.push(h);
    }
  };
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const h = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\](.*)$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase();
      if (name === 'include' || name === 'includeif') return { kind: 'unknown' };
      section = name === 'remote' || name.startsWith('remote.') ? 'remote' : name === 'url' || name.startsWith('url.') ? 'url' : 'other';
      if (section === 'remote') remotes++;
      key(h[2]);
    } else key(line);
  }
  return remotes > 0 ? { kind: 'remote', hosts, rewritten } : { kind: 'none' };
}
