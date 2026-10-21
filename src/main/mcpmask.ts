/** Masking of MCP server status text before it leaves main (spec 019 FR-021). Pure: no Electron, so it is unit tested. */
import type { AgentEvent, McpServerStatus } from '../adapters/types';
import type { McpServerSpec } from '../shared/mcp';
import type { EditInfo } from '../shared/edits';
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

/** Spec 058 FR-067: a failed MCP tool card's output is cut here, after the secret masks and before the slow URL mask (1 MB of `?a=&` took ~0.4 s there); the card shows 20 000 characters. */
export const MCP_CARD_MAX_CHARS = 50_000;

/**
 * Session secret values, then env secrets and secret shapes, both on the whole text; then URL parts and flag values. No cut unless `max`
 * is given (spec 058 FR-067): then the cut comes after the secret masks (so a secret straddling it leaves no head) and the URL and flag
 * masks run on the shorter text.
 */
export function maskMcpText(text: unknown, values: readonly string[] = [], max?: number): string | undefined {
  if (text === undefined || text === null) return undefined;
  let s = typeof text === 'string' ? text : String(text);
  for (const v of values) if (v.length >= 4 && s.includes(v)) s = s.split(v).join('[redacted]');
  s = redact(s); // env values and token shapes on the whole text: linear, about 7 ms per MB
  if (max !== undefined) s = cut(s, max);
  return maskFlagValues(maskSecretUrl(s)); // the slow URL pass runs on the shorter text
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
 * Spec 005 FR-024 (review on #463): a file edit's paths and diffs with the session's secret values removed, then `redact()` again. Only the
 * linear steps: no URL pass (a partial update can carry 20 files of 20,000 characters, many times a second) and no cut (the adapter already
 * cut each diff at a line). Without session values the edit is returned as it is (the adapter's `redact()` already ran).
 */
export function maskEditInfo(edit: EditInfo, values: readonly string[] = []): EditInfo {
  const vs = values.filter((v) => typeof v === 'string' && v.length >= 4);
  if (!vs.length || !edit || !Array.isArray(edit.files)) return edit;
  const m = (s: string): string => {
    for (const v of vs) if (s.includes(v)) s = s.split(v).join('[redacted]');
    return redact(s);
  };
  return {
    ...edit,
    files: edit.files.map((f) => ({ ...f, path: m(String(f.path)), ...(typeof f.diff === 'string' ? { diff: m(f.diff) } : {}), ...(typeof f.movedTo === 'string' ? { movedTo: m(f.movedTo) } : {}) })),
  };
}

/**
 * Spec 019 FR-022: the copy of an event that may leave main (window, debug sink): an `mcp` event with its errors masked; any other event
 * unchanged (same object). Spec 058 FR-067: every `toolCall` (update, complete or failed) that names an `mcpServer` has its `output` masked too, cut to `MCP_CARD_MAX_CHARS`.
 * Spec 005 FR-024: a `toolCall` with an `edit` (any phase) has its paths and diffs masked with the session values (`maskEditInfo`).
 */
export function maskMcpEvent<E extends AgentEvent>(e: E, values: readonly string[] = []): E {
  if (e.type === 'mcp') return { ...e, servers: maskMcpStatuses(e.servers, values) };
  if (e.type !== 'toolCall') return e;
  let out = e;
  if (e.phase !== 'start' && e.mcpServer && e.output !== undefined) out = { ...out, output: maskMcpText(e.output, values, MCP_CARD_MAX_CHARS) };
  if (e.edit && values.length) out = { ...out, edit: maskEditInfo(e.edit, values) };
  return out;
}

/** Spec 058 FR-067: replayed history (resumed session) with every failed tool's output masked like a live MCP card; other items are the same objects. */
export function maskMcpHistory<H extends { items: { type: string; failed?: boolean; output?: string }[] }>(h: H, values: readonly string[] = []): H {
  return { ...h, items: h.items.map((it) => (it.type === 'tool' && it.failed && it.output !== undefined ? { ...it, output: maskMcpText(it.output, values, MCP_CARD_MAX_CHARS) } : it)) };
}
