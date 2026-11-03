/**
 * Spec 058 FR-198: is a stdio MCP server's command on this computer? A file lookup only: nothing is run, opened or sent. The folders are
 * the ones Agent Durbar searches for agent apps (`candidates()`: PATH, the login shell's PATH, the usual install folders; spec 060 FR-003).
 * `undefined` = not judged (a `$` / `%` / backtick reference, a relative path with a folder, an odd value): no flag is set then.
 */
import * as path from 'path';
import { candidates, type DetectEnv } from '../adapters/detect';
import type { GlobalState } from '../shared/api';

const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com'];

export function commandFound(cmd: unknown, env: DetectEnv): boolean | undefined {
  // eslint-disable-next-line no-control-regex
  if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 1024 || /[$%`\u0000-\u001f]/.test(cmd)) return undefined;
  const win = env.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const c = cmd.trim();
  const hasExt = /\.[A-Za-z0-9]{1,4}$/.test(p.basename(c));
  const exts = (): string[] => {
    const own = String(env.env.PATHEXT ?? '').split(';').map((x) => x.trim().toLowerCase()).filter((x) => /^\.[a-z0-9]{1,4}$/.test(x)).slice(0, 12);
    return own.length ? own : WIN_EXTS;
  };
  const names = (base: string): string[] => (win && !hasExt ? exts().map((e) => base + e) : [base]);
  if (p.isAbsolute(c)) return names(c).some((f) => env.isFile(f)) || env.isFile(c);
  if (/[\\/]/.test(c)) return undefined; // relative to a working folder Agent Durbar does not know
  const dirs = [...new Set(candidates({ name: 'x', versionArgs: [], installHint: '' }, env).map((f) => p.dirname(f)))];
  for (const d of dirs) for (const n of names(c)) if (env.isFile(p.join(d, n))) return true;
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
