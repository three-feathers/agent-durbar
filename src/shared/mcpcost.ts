/**
 * Spec 100: what MCP tool definitions cost in a session's context window. Pure, no imports, no vendor words: the estimator (FR-002), the
 * share and level rules (FR-020, FR-024), the compaction burst (FR-030) and the words the chip, the dialog and the warning line use.
 * Loaded in the page as `../shared/mcpcost.js` (read through `window.exports`), in main and in the adapters as a module.
 */

export type McpCostSource = 'reported' | 'estimated' | 'unknown';

/** One server's figures: a name and numbers only (FR-001, FR-040). */
export interface McpContextServer {
  name: string;
  /** Tokens these definitions take in the window now. */
  tokens?: number;
  /** Tools the agent app loads on demand, at the figure it reports for them. Never part of `tokens`, never in the share (spec 100 Changes 2026-10-31). */
  deferredTokens?: number;
  tools?: number;
  source: McpCostSource;
  /** The list failed. A fixed word from the adapter, never the agent app's text. */
  error?: string;
  /** Over the 500-tool cap: `tokens` is the part counted, shown with "≥" (spec 100 edge cases). */
  capped?: boolean;
}

export interface McpContextReport {
  servers: McpContextServer[];
  window?: number;
  /** Set only when the agent app gives a total but no server figures; else the sum of the servers. */
  total?: number;
  /** A server failed to list: the total is "of the servers that answered". */
  partial?: boolean;
  /** Claude Code's control channel is busy with a turn: nothing was asked; main asks again at the turn's end (FR-003). */
  busy?: boolean;
}

export interface McpWarnLevels {
  warn: number;
  strong: number;
  off: boolean;
}

export type McpLevel = 'none' | 'warn' | 'strong';

export const MCP_WARN_DEFAULT = 15;
export const MCP_STRONG_DEFAULT = 30;
export const MCP_LEVEL_MIN = 5;
export const MCP_LEVEL_MAX = 90;
export const MCP_COST_MAX_TOOLS = 500;
/** Above this a number from an agent app is not believed. */
const MAX_TOKENS = 1e9;

/** A token figure that can be shown: a finite number from 0 to under a billion, whole; anything else is no figure (T010). */
export function safeTokens(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < MAX_TOKENS ? Math.round(v) : undefined;
}

function schemaText(s: unknown): string {
  if (s === undefined || s === null) return '';
  try {
    return JSON.stringify(s) ?? '';
  } catch {
    return ''; // a circular or BigInt schema is not worth failing a report for
  }
}

/** FR-002: `ceil((name + description + JSON.stringify(inputSchema)).length / 4) + 8`. */
export function estimateTool(t: unknown): number {
  const o = t && typeof t === 'object' ? (t as Record<string, unknown>) : {};
  const text = (typeof o.name === 'string' ? o.name : '') + (typeof o.description === 'string' ? o.description : '') + schemaText(o.inputSchema);
  return Math.ceil(text.length / 4) + 8;
}

/** FR-002: one server's sum. Takes an array, or a map by tool name (Codex). At most 500 tools are counted (spec 069 FR-032); then `capped`. */
export function estimateTools(tools: unknown): { tokens: number; tools: number; capped: boolean } {
  const list: unknown[] = Array.isArray(tools) ? tools : tools && typeof tools === 'object' ? Object.entries(tools as Record<string, unknown>).map(([k, v]) => (v && typeof v === 'object' ? { name: k, ...(v as object) } : { name: k })) : [];
  let tokens = 0;
  const counted = list.slice(0, MCP_COST_MAX_TOOLS);
  for (const t of counted) tokens += estimateTool(t);
  return { tokens, tools: list.length, capped: list.length > MCP_COST_MAX_TOOLS };
}

/** The tokens the report says are in the window: the servers' sum (deferred tools are not), or the app's total when no server has a figure; undefined when nothing was reported. */
export function reportTotal(r: McpContextReport | null | undefined): number | undefined {
  if (!r || !Array.isArray(r.servers)) return undefined;
  let sum: number | undefined;
  for (const s of r.servers) {
    const t = safeTokens(s.tokens);
    if (t !== undefined) sum = (sum ?? 0) + t;
  }
  return sum ?? safeTokens(r.total);
}

/** The window of the report, or the one the caller knows from the context figure. Undefined while unknown (FR-024). */
function windowOf(r: McpContextReport, fallback?: number): number | undefined {
  const w = safeTokens(r.window);
  if (w) return w;
  const f = safeTokens(fallback);
  return f || undefined;
}

/** FR-020: the share of the window in percent, not rounded; undefined when the window or the figure is unknown. */
export function shareOf(r: McpContextReport | null | undefined, window?: number): number | undefined {
  if (!r) return undefined;
  const total = reportTotal(r);
  const w = windowOf(r, window);
  return total === undefined || !w ? undefined : (total / w) * 100;
}

/** FR-020, FR-021: strictly above a level counts; off or an unknown share is 'none'. */
export function levelOf(share: number | undefined, levels: McpWarnLevels): McpLevel {
  if (levels.off || share === undefined || !Number.isFinite(share)) return 'none';
  if (share > levels.strong) return 'strong';
  if (share > levels.warn) return 'warn';
  return 'none';
}

const parseLevel = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= MCP_LEVEL_MIN && v <= MCP_LEVEL_MAX ? v : undefined);

/** FR-020: whole percents from 5 to 90, warn below strong. Anything else is undefined, so the setting keeps its value. */
export function parseWarnLevels(v: unknown): McpWarnLevels | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const warn = parseLevel(o.warn);
  const strong = parseLevel(o.strong);
  if (warn === undefined || strong === undefined || warn >= strong) return undefined;
  return { warn, strong, off: o.off === true };
}

export const mcpWarnDefaults = (): McpWarnLevels => ({ warn: MCP_WARN_DEFAULT, strong: MCP_STRONG_DEFAULT, off: false });

/** The n heaviest servers by what they take in the window (ties by name, so the order is stable); a server with no figure or 0 is left out. */
export function heaviest(r: McpContextReport | null | undefined, n: number): McpContextServer[] {
  if (!r || !Array.isArray(r.servers)) return [];
  return r.servers.filter((s) => (safeTokens(s.tokens) ?? 0) > 0).sort((a, b) => (b.tokens as number) - (a.tokens as number) || a.name.localeCompare(b.name)).slice(0, Math.max(0, n));
}

/** FR-030: more than `count` completed compactions in the last `minutes`. */
export function compactionBurst(times: readonly number[], now: number, o: { count: number; minutes: number } = { count: 3, minutes: 30 }): boolean {
  const from = now - o.minutes * 60_000;
  let n = 0;
  for (const t of times) if (t > from && t <= now) n++;
  return n > o.count;
}

/** Per session: the level of the line shown, and the level dismissed. */
export interface McpLineState {
  shown: McpLevel;
  dismissed: McpLevel;
}

/**
 * FR-022: what the one warning line of a session does for a new level. A dismissed line comes back only when the level rises from warn to
 * strong; a dismissed strong one never does. A share that fell below the levels takes the line away; it may come back if not dismissed.
 */
export function lineAction(state: McpLineState, level: McpLevel): 'none' | 'show' | 'update' | 'hide' {
  if (level === 'none') return state.shown === 'none' ? 'none' : 'hide';
  if (state.dismissed === 'strong' || (state.dismissed === 'warn' && level === 'warn')) return state.shown === 'none' ? 'none' : 'hide';
  if (state.shown === 'none') return 'show';
  return state.shown === level ? 'none' : 'update';
}

/** FR-024: the warning for a report, or null: no line while the window is unknown or nothing has a figure. A partial total warns only above the level, as "at least". */
export function warningOf(r: McpContextReport | null | undefined, window: number | undefined, levels: McpWarnLevels): { level: McpLevel; share: number; atLeast: boolean; window: number; total: number; servers: McpContextServer[] } | null {
  const share = shareOf(r, window);
  const level = levelOf(share, levels);
  if (!r || share === undefined || level === 'none') return null;
  return { level, share, atLeast: !!r.partial, window: windowOf(r, window) as number, total: reportTotal(r) as number, servers: heaviest(r, 3) };
}

/** "0.4k", "1.2k", "38k", "1M": short token words, the same for the chip, the rows and the lines. */
export function fmtK(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(n >= 1e7 ? 0 : 1))}M`;
  if (n >= 1e4) return `${Math.round(n / 1000)}k`;
  if (n > 0) return `${Number((n / 1000).toFixed(1))}k`;
  return '0';
}

/** The figure of one server with its mark (SC-002): "≈" for an estimate, "≥" over the cap, nothing for a reported figure. */
export function figureOf(s: Pick<McpContextServer, 'tokens' | 'source' | 'capped'>): string {
  const t = safeTokens(s.tokens);
  if (t === undefined) return '';
  return `${s.capped ? '≥' : s.source === 'estimated' ? '≈' : ''}${fmtK(t)}`;
}

/** Whether any figure in the report is an estimate: then the total is one too. */
const anyEstimated = (r: McpContextReport): boolean => r.servers.some((s) => s.source === 'estimated' && safeTokens(s.tokens) !== undefined);
const anyCapped = (r: McpContextReport): boolean => r.servers.some((s) => s.capped === true);
/** Whether any server has a figure. False = "not reported by <app>" (FR-044). */
export const hasFigures = (r: McpContextReport | null | undefined): boolean => reportTotal(r) !== undefined;

/** FR-010: the chip's "≈38k", or '' with no figure. */
export function chipFigure(r: McpContextReport | null | undefined): string {
  const t = reportTotal(r);
  if (!r || t === undefined) return '';
  return `${anyCapped(r) ? '≥' : anyEstimated(r) ? '≈' : ''}${fmtK(t)}`;
}

const pctWord = (share: number): number => Math.round(share);

/** "about 38 thousand tokens" / "38 thousand tokens". */
function tokenWords(t: number, about: boolean): string {
  const n = t >= 1e6 ? `${Number((t / 1e6).toFixed(1))} million` : t >= 1000 ? `${Math.round(t / 1000)} thousand` : String(t);
  return `${about ? 'about ' : ''}${n} tokens`;
}

/** FR-010, FR-021: the words of the chip's name and tooltip: never colour alone. '' with no figure. */
export function chipWords(r: McpContextReport | null | undefined, window: number | undefined, levels: McpWarnLevels): string {
  const t = reportTotal(r);
  if (!r || t === undefined) return '';
  const est = anyEstimated(r);
  const share = shareOf(r, window);
  const level = levelOf(share, levels);
  const parts = [`MCP tool definitions: ${tokenWords(t, est)}`];
  if (share !== undefined) parts.push(`${pctWord(share)} % of the window`);
  parts.push(est ? 'estimated' : 'reported');
  const said = parts.join(', ');
  if (level === 'strong') return `${said}. Far above the warning level of ${levels.strong} %`;
  if (level === 'warn') return `${said}. Above the warning level of ${levels.warn} %`;
  return said;
}

const namesOf = (servers: readonly McpContextServer[]): string => servers.map((s) => `${s.name} ${figureOf(s)}`).join(', ');

/** Spec 100 US2, FR-022, FR-024: the line. A window of a million or more also says the absolute tokens (edge case "1M window"). */
export function warningText(w: NonNullable<ReturnType<typeof warningOf>>): string {
  const of = w.window >= 500_000 ? `${fmtK(w.window)} window, ${fmtK(w.total)} tokens` : `${fmtK(w.window)} window`;
  const servers = w.servers.length ? ` (${namesOf(w.servers)})` : '';
  return `MCP tool definitions take ${w.atLeast ? 'at least ' : ''}${pctWord(w.share)} % of this ${of}${servers}. This can make the conversation compact often.`;
}

/** FR-030: the sentence added to the compaction line. */
export function compactionHintText(w: { share: number; atLeast: boolean; servers: readonly McpContextServer[] }): string {
  const top = w.servers[0];
  const free = top ? ` Switching off ${top.name} would free ${figureOf(top)}.` : '';
  return `MCP tool definitions take ${w.atLeast ? 'at least ' : ''}${pctWord(w.share)} % of the window, so each compaction frees less.${free}`;
}

/**
 * FR-030: the hint for a compaction, or null: a burst, the MCP share at least the warn level, not yet shown at this level. `shown` is what
 * this session already showed or dismissed.
 */
export function compactionHint(r: McpContextReport | null | undefined, window: number | undefined, levels: McpWarnLevels, times: readonly number[], now: number, shown: Partial<Record<McpLevel, boolean>>): { level: McpLevel; text: string; top?: string } | null {
  const share = shareOf(r, window);
  if (!r || levels.off || share === undefined || share < levels.warn || !compactionBurst(times, now)) return null;
  const level: McpLevel = share > levels.strong ? 'strong' : 'warn';
  if (shown[level] === true) return null;
  const servers = heaviest(r, 1);
  return { level, text: compactionHintText({ share, atLeast: !!r.partial, servers }), ...(servers[0] ? { top: servers[0].name } : {}) };
}

const COST_APP_WORDS: Record<string, string> = { copilot: 'Copilot', claude: 'Claude Code', codex: 'Codex' };
/**
 * FR-012: one server's last figures in Settings: "≈12k in Codex, 0.4k on demand in Claude Code, measured 10:21". `per` is the entries of
 * this server by agent app; the time is the newest one's. '' when there is none.
 */
export function costLine(per: Record<string, { tokens?: number; deferredTokens?: number; source: string; at: number } | undefined>, time: (at: number) => string): string {
  const parts: string[] = [];
  let at = 0;
  for (const app of Object.keys(COST_APP_WORDS)) {
    const e = per[app];
    if (!e) continue;
    const mark = e.source === 'estimated' ? '≈' : '';
    const t = safeTokens(e.tokens);
    const dt = safeTokens(e.deferredTokens);
    const bits = [t !== undefined && (t > 0 || !dt) ? `${mark}${fmtK(t)}` : '', dt ? `${mark}${fmtK(dt)} on demand` : ''].filter(Boolean);
    if (!bits.length) continue;
    parts.push(`${bits.join(', ')} in ${COST_APP_WORDS[app]}`);
    at = Math.max(at, e.at);
  }
  return parts.length ? `${parts.join(', ')}, measured ${time(at)}` : '';
}

/** FR-011: a dialog row's figure. `status` is the row's state: a failed or switched-off server is "not loaded" and has no figure (US1 scenario 3). */
export function rowFigure(s: McpContextServer | undefined, o: { off?: boolean; status?: string; hasReport: boolean; largest?: boolean }): string {
  if (o.off || o.status === 'failed' || o.status === 'disabled' || o.status === 'needs-auth') return 'not loaded';
  if (!o.hasReport) return '';
  if (!s || s.source === 'unknown') return 'size not known';
  const fig = figureOf(s);
  const main = fig ? `${fig} tokens${s.source === 'estimated' ? ' (estimated)' : ''}` : '';
  const dt = safeTokens(s.deferredTokens);
  const def = dt !== undefined && dt > 0 ? `loaded on demand: ${s.source === 'estimated' ? '≈' : ''}${fmtK(dt)}` : '';
  const text = [main, def].filter(Boolean).join(', ') || 'size not known';
  return o.largest ? `${text}, largest` : text;
}

/** US1: "Tool definitions of these servers: ≈38k tokens, 19 % of the 200k window". '' with no figure. */
export function totalLine(r: McpContextReport | null | undefined, window: number | undefined): string {
  const fig = chipFigure(r);
  if (!r || !fig) return '';
  const share = shareOf(r, window);
  const w = windowOf(r, window);
  const of = share !== undefined && w ? `, ${pctWord(share)} % of the ${fmtK(w)} window` : '';
  return `Tool definitions of ${r.partial ? 'the servers that answered' : 'these servers'}: ${fig} tokens${of}`;
}

/** FR-011, FR-044: the footnote names the source; an estimate says how. `app` is the short name ("Copilot"). */
export function footnoteOf(r: McpContextReport | null | undefined, app: string): string {
  if (!r || !hasFigures(r)) return `Size not reported by ${app}.`;
  if (anyEstimated(r)) return `Estimated by Agent Durbar from the tool definitions: about 4 characters per token; the real figure can differ by a third.`;
  return `Reported by ${app}.`;
}
