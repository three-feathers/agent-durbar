/** Masking of MCP server status text before it leaves main (spec 019 FR-021). Pure: no Electron, so it is unit tested. */
import type { AgentEvent, McpServerStatus } from '../adapters/types';
import type { McpServerSpec } from '../shared/mcp';
import { cut, maskSecretUrl, redact, secretFlag } from '../shared/redact';

export const MCP_ERROR_MAX_CHARS = 300;

/** The secret values a session was given (env and header values of its extra servers), longest first; under 4 characters are skipped since they would mangle every string. */
export function mcpSecretValues(servers: Record<string, McpServerSpec> | undefined): string[] {
  const out = new Set<string>();
  for (const s of Object.values(servers ?? {})) for (const v of [...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {})]) if (typeof v === 'string' && v.length >= 4) out.add(v);
  return [...out].sort((a, b) => b.length - a.length);
}

/** `--token value`, `--api-key=value` and `API_KEY=value` in free text (a failed spawn message can quote the command line). */
function maskFlagValues(s: string): string {
  return s
    .replace(/(^|\s)(--?[A-Za-z][\w.-]{0,60})(\s+)(?!-)(\S+)/g, (m, lead: string, name: string, sp: string) => (secretFlag(name) ? `${lead}${name}${sp}[redacted]` : m))
    .replace(/(^|\s)(-{0,2}[A-Za-z][\w.-]{0,60})=(?!\[redacted\])(\S+)/g, (m, lead: string, name: string) => (secretFlag(name) ? `${lead}${name}=[redacted]` : m));
}

/** Spec 058 FR-067: a failed MCP tool card's output is cut here, before the pattern masks (1 MB of `?a=&` took ~0.7 s); the card shows 20 000 characters. */
export const MCP_CARD_MAX_CHARS = 50_000;

/**
 * Session secret values, then env secrets and secret shapes, then URL parts. No cut unless `max` is given (spec 058 FR-067): then the
 * session values go out of the whole text first, the cut follows (at a token boundary, so no token loses only its head), and the
 * pattern masks run on the shorter text.
 */
export function maskMcpText(text: unknown, values: readonly string[] = [], max?: number): string | undefined {
  if (text === undefined || text === null) return undefined;
  let s = typeof text === 'string' ? text : String(text);
  for (const v of values) if (v.length >= 4 && s.includes(v)) s = s.split(v).join('[redacted]');
  if (max !== undefined) s = cut(s, max);
  return maskFlagValues(maskSecretUrl(redact(s)));
}

/** `maskMcpText`, then the cut to 300 characters last, so a secret straddling it leaves no prefix. */
export function maskMcpError(text: unknown, values: readonly string[] = []): string | undefined {
  const s = maskMcpText(text, values);
  return s === undefined ? undefined : cut(s, MCP_ERROR_MAX_CHARS);
}

/** The same list with every `error` masked. */
export function maskMcpStatuses(servers: readonly McpServerStatus[], values: readonly string[] = []): McpServerStatus[] {
  return servers.map((x) => (x.error === undefined ? x : { ...x, error: maskMcpError(x.error, values) }));
}

/**
 * Spec 019 FR-022: the copy of an event that may leave main (window, debug sink): an `mcp` event with its errors masked; any other event
 * unchanged (same object). Spec 058 FR-067: a failed or updating `toolCall` that names an `mcpServer` has its `output` masked too, cut to `MCP_CARD_MAX_CHARS`.
 */
export function maskMcpEvent<E extends AgentEvent>(e: E, values: readonly string[] = []): E {
  if (e.type === 'mcp') return { ...e, servers: maskMcpStatuses(e.servers, values) };
  if (e.type === 'toolCall' && (e.phase === 'failed' || e.phase === 'update') && e.mcpServer && e.output !== undefined) return { ...e, output: maskMcpText(e.output, values, MCP_CARD_MAX_CHARS) };
  return e;
}
