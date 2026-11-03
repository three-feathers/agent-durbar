/**
 * Spec 058 FR-198: is a stdio MCP server's command on this computer? Nothing is run, opened or sent, and main never blocks on it:
 * each folder Agent Durbar searches for agent apps (`candidates()`: PATH, the login shell's PATH, the usual install folders; spec 060
 * FR-003), plus the folder of each absolute command, is read once with an async `readdir` into a set of names, kept 10 s, and the
 * commands are looked up in those sets. No `stat`, no per-command file call.
 * Never touched (review on PR 1073, fjcabello): a command or folder that is a network or device path (`\\host\share`, `//host/...`,
 * `\\?\...`, `\\.\pipe\...`, macOS `/net/` and `/Network/`): reading one can open an SMB connection (an NTLM leak, and a freeze). Such
 * a command is "not judged" (`undefined`), never "missing".
 * `undefined` also for a `$` / `%` / backtick reference, a relative path with a folder, a drive-relative `C:x`, and odd values.
 */
import * as path from 'path';
import { candidates, type DetectEnv } from '../adapters/detect';
import type { GlobalState } from '../shared/api';

/** Windows: only these run as a command; another PATHEXT entry (.js, .vbs, .py) would wrongly count as "found". */
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com'];
export const INDEX_TTL_MS = 10_000;

/** A network or device path: never read. */
export function remotePath(p: string, platform: NodeJS.Platform): boolean {
  if (/^[\\/]{2}/.test(p)) return true; // \\host\share, //host/share, \\?\UNC\..., \\.\pipe\..., mixed \/host and /\host
  if (platform === 'darwin' && /^\/(net|network)(\/|$)/i.test(p)) return true; // the automounter and the network volumes (any case: APFS ignores it)
  return false;
}

export interface CmdIndex {
  platform: NodeJS.Platform;
  /** Windows: the extensions tried for a name without one (PATHEXT ∩ WIN_EXTS, else WIN_EXTS). */
  exts: string[];
  /** The searched folders, in order. */
  dirs: string[];
  /** Folder -> names in it (lowercased on Windows); a folder that could not be read is missing. */
  names: Map<string, Set<string>>;
}

function winExts(env: Pick<DetectEnv, 'env'>): string[] {
  const own = String(env.env.PATHEXT ?? '').split(';').map((x) => x.trim().toLowerCase()).filter((x) => WIN_EXTS.includes(x));
  return own.length ? [...new Set(own)] : WIN_EXTS;
}

/** Why a command is not judged ('' = it can be looked up). */
export function notJudged(cmd: unknown, platform: NodeJS.Platform): string {
  // eslint-disable-next-line no-control-regex
  if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 1024 || /[$%`\u0000-\u001f]/.test(cmd)) return 'odd';
  const c = cmd.trim();
  if (remotePath(c, platform)) return 'remote';
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32' && /^[A-Za-z]:(?![\\/])/.test(c)) return 'drive-relative';
  if (!p.isAbsolute(c) && /[\\/]/.test(c)) return 'relative';
  return '';
}

/** The folders to read for these commands: detection's folders, plus each absolute command's own folder; network folders dropped. */
export function foldersFor(commands: readonly string[], env: DetectEnv): string[] {
  const p = env.platform === 'win32' ? path.win32 : path.posix;
  const out = candidates({ name: 'x', versionArgs: [], installHint: '' }, env).map((f) => p.dirname(f));
  for (const c of commands) if (!notJudged(c, env.platform) && p.isAbsolute(c.trim())) out.push(p.dirname(c.trim()));
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = env.platform === 'win32' ? d.toLowerCase() : d;
    if (!d || remotePath(d, env.platform) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reads each folder once (async, all at once); a failed read leaves that folder out. */
export async function buildIndex(dirs: readonly string[], env: Pick<DetectEnv, 'platform' | 'env'>, readdir: (dir: string) => Promise<string[]>): Promise<CmdIndex> {
  const win = env.platform === 'win32';
  const names = new Map<string, Set<string>>();
  await Promise.all(dirs.map(async (d) => {
    try {
      const list = await readdir(d);
      names.set(win ? path.win32.normalize(d).toLowerCase() : d, new Set(list.slice(0, 20000).map((n) => (win ? n.toLowerCase() : n))));
    } catch { /* unreadable: not in the index */ }
  }));
  return { platform: env.platform, exts: win ? winExts(env) : [], dirs: [...dirs], names };
}

/** Looks a command up in the index: true found, false not found, undefined not judged. Pure. */
export function commandFound(cmd: unknown, idx: CmdIndex): boolean | undefined {
  if (notJudged(cmd, idx.platform)) return undefined;
  const win = idx.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const c = (cmd as string).trim();
  const key = (s: string) => (win ? s.toLowerCase() : s);
  // Windows: a suffix is an extension only when it is one of the runnable ones (`python.exe`); `python3.11` gets each of them
  const ext = p.extname(c).toLowerCase();
  const known = win && !!ext && idx.exts.includes(ext);
  const variants = (base: string): string[] => (win && !known ? idx.exts.map((e) => base + e) : [base]);
  const inDir = (dir: string, base: string): boolean | undefined => {
    const set = idx.names.get(win ? path.win32.normalize(dir).toLowerCase() : dir);
    if (!set) return undefined;
    return variants(base).some((n) => set.has(key(n)));
  };
  if (p.isAbsolute(c)) return inDir(p.dirname(c), p.basename(c)); // its folder unreadable: not judged
  for (const d of idx.dirs) if (inDir(d, c)) return true;
  return false;
}

/** `mcp:globalState` with `missing: true` on each stdio server whose command was looked up and not found. The state is copied, not changed. */
export function withMissing(state: GlobalState, found: (cmd: string) => boolean | undefined): GlobalState {
  if (!state || !state.ok || !Array.isArray(state.apps)) return state;
  const memo = new Map<string, boolean | undefined>();
  const look = (c: string): boolean | undefined => {
    if (!memo.has(c)) memo.set(c, found(c));
    return memo.get(c);
  };
  return {
    ...state,
    apps: state.apps.map((a) => ({
      ...a,
      servers: a.servers.map((s) => (s.transport === 'stdio' && typeof s.command === 'string' && look(s.command) === false ? { ...s, missing: true } : s)),
    })),
  };
}

/**
 * The check main hands to `mcp:globalState`: one index per 10 s (the same folders), shared by concurrent calls; `readdir` and the clock
 * are injected (tests count the calls). Never a synchronous file call per command.
 */
export function missingChecker(envOf: () => DetectEnv, readdir: (dir: string) => Promise<string[]>, now: () => number = () => performance.now()): (s: GlobalState) => Promise<GlobalState> {
  let cache: { key: string; at: number; idx: Promise<CmdIndex> } | undefined;
  return async (state) => {
    if (!state || !state.ok || !Array.isArray(state.apps)) return state;
    const env = envOf();
    const cmds = state.apps.flatMap((a) => a.servers.filter((s) => s.transport === 'stdio' && typeof s.command === 'string').map((s) => s.command as string));
    if (!cmds.length) return state;
    // the key: the absolute commands' folders; the folder list (detection's, with a few small listings of version-manager folders) is
    // built only when the index is rebuilt
    const p = env.platform === 'win32' ? path.win32 : path.posix;
    const key = env.platform + '\0' + [...new Set(cmds.filter((c) => !notJudged(c, env.platform) && p.isAbsolute(c.trim())).map((c) => p.dirname(c.trim())))].sort().join('\0');
    const t = now();
    if (!cache || cache.key !== key || !(t - cache.at >= 0 && t - cache.at < INDEX_TTL_MS)) cache = { key, at: t, idx: buildIndex(foldersFor(cmds, env), env, readdir) };
    const idx = await cache.idx;
    return withMissing(state, (c) => commandFound(c, idx));
  };
}
