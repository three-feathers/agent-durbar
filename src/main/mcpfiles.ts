/**
 * Read-only access to MCP configuration files of other tools (spec 019): ~/.copilot/mcp-config.json (also loaded by the runtime
 * itself, so these servers are "ambient") and VS Code's user `mcp.json`. Nothing here ever writes, and no secret value is returned
 * by `ambientServers`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseMcpConfig } from '../shared/mcpimport';
import type { ImportCandidate } from '../shared/mcpimport';
import type { McpAmbientView } from '../shared/api';

/** Servers the runtime starts by itself in every session. */
export const BUILTIN_SERVERS = ['github-mcp-server'];
const MAX_BYTES = 1024 * 1024;

/** The Copilot CLI/SDK config folder. `DURBAR_COPILOT_DIR` is for tests and screenshots. */
/** `env` is the guarded hook environment from devhooks.ts (empty in a packaged build); it is never read from process.env here. */
export const copilotDir = (env: Readonly<Record<string, string | undefined>> = {}, home: string = os.homedir()): string => env.DURBAR_COPILOT_DIR || path.join(home, '.copilot');

export function readSmallFile(file: string): string | undefined {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return undefined;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Candidates of one file, or undefined when the file is missing or too big. */
export function readCandidates(file: string, kind: 'copilot' | 'vscode'): { candidates: ImportCandidate[]; skipped: number; error?: string } | undefined {
  const text = readSmallFile(file);
  if (text === undefined) return undefined;
  const r = parseMcpConfig(text, kind);
  return { candidates: r.candidates, skipped: r.skipped, error: r.ok ? undefined : r.error };
}

/** Servers of ~/.copilot/mcp-config.json plus the built-in ones, without any env/header value. `disabled` = names switched off in Settings. */
export function ambientServers(dir: string, disabled: ReadonlySet<string>): McpAmbientView[] {
  const out: McpAmbientView[] = [];
  const r = readCandidates(path.join(dir, 'mcp-config.json'), 'copilot');
  for (const c of r?.candidates ?? []) {
    out.push({ name: c.originalName, origin: 'copilot-config', transport: c.transport, command: c.command, args: c.args, url: c.url, enabled: !disabled.has(c.originalName) });
  }
  for (const b of BUILTIN_SERVERS) if (!out.some((o) => o.name === b)) out.push({ name: b, origin: 'builtin', enabled: !disabled.has(b) });
  return out;
}

/** VS Code user-level mcp.json files that exist (Code, Insiders, VSCodium). */
export function vscodeMcpFiles(userDirs: { dir: string }[]): string[] {
  return userDirs.map((u) => path.join(u.dir, 'mcp.json')).filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });
}
