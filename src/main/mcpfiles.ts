/**
 * Read-only access to the Copilot CLI's MCP list, `~/.copilot/mcp-config.json` (spec 019, 020). The runtime loads it itself in every
 * session; this module only reads it again whenever a screen opens, so the list is always the current one. Nothing here ever writes,
 * and no secret value is returned by `cliServers`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseMcpConfig } from '../shared/mcpimport';
import type { ImportCandidate } from '../shared/mcpimport';
import type { McpAmbientView, McpCliFile } from '../shared/api';

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

/** Candidates of the Copilot CLI file, or undefined when the file is missing or too big. */
export function readCandidates(file: string): { candidates: ImportCandidate[]; skipped: number; error?: string } | undefined {
  const text = readSmallFile(file);
  if (text === undefined) return undefined;
  const r = parseMcpConfig(text);
  return { candidates: r.candidates, skipped: r.skipped, error: r.ok ? undefined : r.error };
}

/** Label shown instead of the real path. */
export const CLI_FILE_LABEL = '~/.copilot/mcp-config.json';

/**
 * Servers of ~/.copilot/mcp-config.json plus the built-in ones, without any env/header value, and what happened when reading the file.
 * `disabled` = names switched off in Settings (for new sessions started here).
 */
/**
 * Spec 040 FR-015, spec 051 FR-022: the names of every MCP server the Copilot runtime starts by itself (the ~/.copilot/mcp-config.json
 * list and its built-in ones), which a helper session (a one-shot, the account probe) switches off by name.
 */
export function copilotServerNames(dir: string): string[] {
  return cliServers(dir, new Set()).servers.map((s) => s.name);
}

export function cliServers(dir: string, disabled: ReadonlySet<string>): { servers: McpAmbientView[]; file: McpCliFile } {
  const out: McpAmbientView[] = [];
  const r = readCandidates(path.join(dir, 'mcp-config.json'));
  for (const c of r?.candidates ?? []) {
    if (out.some((o) => o.name === c.originalName)) continue;
    out.push({ name: c.originalName, origin: 'copilot-config', transport: c.transport, command: c.command, args: c.args, url: c.url, enabled: !disabled.has(c.originalName) });
  }
  for (const b of BUILTIN_SERVERS) if (!out.some((o) => o.name === b)) out.push({ name: b, origin: 'builtin', enabled: !disabled.has(b) });
  return { servers: out, file: { label: CLI_FILE_LABEL, found: r !== undefined, error: r?.error, skipped: r?.skipped ?? 0 } };
}
