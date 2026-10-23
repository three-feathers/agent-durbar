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
  /** Spec 058 FR-186: Claude Code's own `oauth` settings of a user-list `http`/`sse` server, the allow-listed fields only (`claudeOAuthOf`). */
  oauth?: McpOAuthSpec;
}

/** Spec 058 FR-186: the part of Claude Code's `oauth` object Agent Durbar copies into its `--mcp-config`. Never a client secret. */
export interface McpOAuthSpec {
  clientId?: string;
  callbackPort?: number;
  authServerMetadataUrl?: string;
  scopes?: string;
}

/**
 * Spec 058 FR-186 (Q22 B): the allow-listed copy of a Claude Code `oauth` object, or undefined. Only `clientId` (1-256 characters),
 * `callbackPort` (an integer 1-65535), `authServerMetadataUrl` (at most 2048 characters, a URL with `https:`) and `scopes` (one string,
 * 1-1024 characters), each with the type Claude Code's own schema has (`read:` 2.1.304). Every other key (`clientSecret`, `xaa`, unknown
 * ones, an own `__proto__`) is dropped on its own; a wrong type, shape or length in an allow-listed key means no copy at all. Keys are
 * read only as own properties of a plain object. Nothing here logs.
 */
export function claudeOAuthOf(v: unknown): McpOAuthSpec | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const o = v as Record<string, unknown>;
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
  const out: McpOAuthSpec = {};
  if (own('clientId')) {
    if (!text(o.clientId, 256)) return undefined;
    out.clientId = o.clientId;
  }
  if (own('callbackPort')) {
    const p = o.callbackPort;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 65535) return undefined;
    out.callbackPort = p;
  }
  if (own('authServerMetadataUrl')) {
    const u = o.authServerMetadataUrl;
    if (!text(u, 2048) || !httpsMetadataUrl(u)) return undefined;
    out.authServerMetadataUrl = u;
  }
  if (own('scopes')) {
    if (!text(o.scopes, 1024)) return undefined;
    out.scopes = o.scopes;
  }
  return Object.keys(out).length ? out : undefined;
}

// eslint-disable-next-line no-control-regex
const URL_BLANKS = /[\s\u0000-\u001f\u007f-\u009f]/;
/**
 * Spec 058 FR-186 (security review on #635): Claude Code's schema wants a literal `https://` prefix, so the text must start with exactly
 * `https://` (case-sensitive; not `HTTPS://`, `https:/x` or `https:evil`), hold no whitespace or control character anywhere (the URL
 * parser would drop or trim them), carry no user name or password, and parse as a URL with a host. Anything else: no `oauth` copy.
 */
function httpsMetadataUrl(u: string): boolean {
  if (!u.startsWith('https://') || URL_BLANKS.test(u)) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && !!p.hostname && !p.username && !p.password && !u.slice(8).split(/[/?#]/, 1)[0].includes('@');
  } catch {
    return false;
  }
}

/** Spec 058 FR-175/FR-177: how long an agent app's sign-in listener waits (it starts before the app answers), and the margin Durbar keeps. */
export const APP_SIGN_IN_LISTENER_MS = 300_000;
/** Spec 058 FR-175: how long Durbar waits for an app's answer to a sign-in request (the most a wait can be). */
export const SIGN_IN_REQUEST_TIMEOUT_MS = 30_000;
const SIGN_IN_MARGIN_MS = 10_000;
/** Spec 058 FR-180: the shortest time main keeps a sign-in address (also what an invalid `ttlMs` gets in `McpSignInStore.begin`). */
export const SIGN_IN_MIN_TTL_MS = 30_000;
/**
 * Spec 058 FR-175 (FR-180): the time main may keep a sign-in address, so **Open sign-in page** never points at a closed listener: the
 * listener's 5 minutes minus the time from sending the request to its answer, minus 10 seconds, at least 30 seconds. A wait that is
 * negative or not a finite number (a clock that went wrong) counts as the whole 30-second request limit (`SIGN_IN_REQUEST_TIMEOUT_MS`),
 * which leaves a TTL of 260 seconds; it never counts as no wait (review on #635).
 */
export function signInTtlMs(waitedMs: number): number {
  const w = Number.isFinite(waitedMs) && waitedMs >= 0 ? waitedMs : SIGN_IN_REQUEST_TIMEOUT_MS;
  return Math.max(SIGN_IN_MIN_TTL_MS, APP_SIGN_IN_LISTENER_MS - w - SIGN_IN_MARGIN_MS);
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
/**
 * Spec 069 FR-063 (change 2026-10-22): an MCP tool name Durbar can turn off. Every agent app's own filter takes such a name (Claude Code
 * `--disallowedTools mcp__<server>__<tool>` cannot carry a comma or a space); a tool with any other character cannot be turned off,
 * because Claude Code in Allow all never asks Durbar's broker. The renderer keeps a copy of this pattern (`screens.js`).
 */
export const MCP_TOOL_OFF_RE = /^[A-Za-z0-9_.-]{1,128}$/;
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const HEADER_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
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

