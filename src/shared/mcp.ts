/**
 * MCP server definitions of Agent Durbar's global Settings (spec 019). Pure: no Electron, no SDK, no file access.
 *
 * Secrets: env values and header values never reach the renderer. The renderer sees `McpSecretKey` (key + "is set") and sends
 * `McpSecretInput` (value undefined = keep what is stored).
 */
import { createHash } from 'crypto';

export type McpTransport = 'stdio' | 'http' | 'sse';

/** What is handed to a runtime session (agent-neutral shape; the Copilot adapter maps it to the SDK's `mcpServers`). */
export interface McpServerSpec {
  type: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
  url?: string;
  headers?: Record<string, string>;
  /** Tool filter of this server; `['*']` = all. */
  tools?: string[];
}

export interface McpSecretKey {
  key: string;
  set: boolean;
}

export interface McpSecretInput {
  key: string;
  /** undefined = keep the stored value of this key. */
  value?: string;
}

/** What the Settings form sends. */
export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  tools?: string[];
  env?: McpSecretInput[];
  headers?: McpSecretInput[];
}

/** What the renderer gets: no secret values. */
export interface McpServerView {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** The current command/URL was confirmed by the user (trust is per exact definition). */
  trusted: boolean;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  tools?: string[];
  env: McpSecretKey[];
  headers: McpSecretKey[];
  /** A secret key has no value (not persisted without safeStorage, or could not be decrypted): the server is not started until re-entered. */
  needsSecrets: boolean;
}

/** What the trust dialog must show. */
export interface McpTrustInfo {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
}

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const MAX_SERVERS = 100;
const MAX_ARGS = 64;
const MAX_SECRETS = 64;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max && !v.includes('\0') ? v : undefined);

function checkSecrets(list: unknown, keyRe: RegExp, what: string): Checked<McpSecretInput[]> {
  if (list === undefined) return { ok: true, value: [] };
  if (!Array.isArray(list) || list.length > MAX_SECRETS) return { ok: false, error: `${what}: too many entries (max ${MAX_SECRETS}).` };
  const out: McpSecretInput[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const key = str(o.key, 128)?.trim();
    if (!key || !keyRe.test(key)) return { ok: false, error: `${what}: "${String(o.key ?? '').slice(0, 40)}" is not a valid name.` };
    if (seen.has(key.toLowerCase())) return { ok: false, error: `${what}: "${key}" appears twice.` };
    seen.add(key.toLowerCase());
    if (o.value !== undefined && str(o.value, 8192) === undefined) return { ok: false, error: `${what}: the value of "${key}" is too long (max 8192).` };
    out.push({ key, value: o.value === undefined ? undefined : (o.value as string) });
  }
  return { ok: true, value: out };
}

/** Validate and normalise the form input. Nothing invalid is stored or passed on. */
export function validateInput(input: unknown): Checked<McpServerInput> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = str(o.name, 48)?.trim();
  if (!name || !NAME_RE.test(name)) return { ok: false, error: 'Name: 1-48 characters, letters, digits, "_", "." or "-", starting with a letter or digit.' };
  if (o.transport !== 'stdio' && o.transport !== 'http' && o.transport !== 'sse') return { ok: false, error: 'Type must be stdio, http or sse.' };
  const transport: McpTransport = o.transport;
  const env = checkSecrets(o.env, ENV_KEY_RE, 'Environment');
  if (!env.ok) return env;
  const headers = checkSecrets(o.headers, HEADER_KEY_RE, 'Headers');
  if (!headers.ok) return headers;
  let tools: string[] | undefined;
  if (o.tools !== undefined) {
    if (!Array.isArray(o.tools) || o.tools.length > 200 || !o.tools.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 100)) return { ok: false, error: 'Tools: a list of tool names (or *).' };
    tools = (o.tools as string[]).map((t) => t.trim());
  }
  const base = { name, transport, tools };
  if (transport === 'stdio') {
    const command = str(o.command, 1024)?.trim();
    if (!command || /[\r\n]/.test(command)) return { ok: false, error: 'Command is required (one line, the program to run).' };
    if (o.args !== undefined && (!Array.isArray(o.args) || o.args.length > MAX_ARGS || !o.args.every((a) => typeof a === 'string' && a.length <= 4096 && !a.includes('\0')))) return { ok: false, error: `Arguments: up to ${MAX_ARGS}, each a text.` };
    const wd = o.workingDirectory === undefined || o.workingDirectory === '' ? undefined : str(o.workingDirectory, 4096);
    if (o.workingDirectory && (!wd || !/^([A-Za-z]:[\\/]|\/|\\\\)/.test(wd))) return { ok: false, error: 'Working directory must be an absolute path.' };
    if (headers.value.length) return { ok: false, error: 'Headers are for http/sse servers only.' };
    return { ok: true, value: { ...base, command, args: (o.args as string[] | undefined) ?? [], workingDirectory: wd, env: env.value, headers: [] } };
  }
  const url = str(o.url, 2048)?.trim();
  let parsed: URL | undefined;
  try {
    parsed = url ? new URL(url) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return { ok: false, error: 'URL must start with http:// or https://.' };
  if (parsed.username || parsed.password) return { ok: false, error: 'Do not put credentials in the URL; use a header (it is stored as a secret).' };
  if (env.value.length) return { ok: false, error: 'Environment variables are for stdio servers only.' };
  return { ok: true, value: { ...base, url, headers: headers.value, env: [] } };
}

/** Hash of what the user confirmed in the trust dialog: any change of command, args, working directory, URL or type resets trust. */
export function trustHash(d: { transport: string; command?: string; args?: string[]; workingDirectory?: string; url?: string }): string {
  return createHash('sha256')
    .update(JSON.stringify([d.transport, d.command ?? '', d.args ?? [], d.workingDirectory ?? '', d.url ?? '']))
    .digest('hex');
}

/** One line for logs and toasts: never contains values of env/headers. */
export function describeServer(d: McpTrustInfo): string {
  return d.transport === 'stdio' ? [d.command, ...(d.args ?? [])].join(' ') : `${d.transport} ${d.url ?? ''}`;
}
