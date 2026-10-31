/**
 * Spec 100 FR-003, FR-004, FR-040: when main asks an agent app for its MCP figures, what it keeps and what reaches the window. Pure (no
 * Electron): one report per agent in memory, only names and numbers out, one ask at a time, 10 s at most, never on a timer. Asked:
 *  - when the session's servers are first reported running, and whenever the set of running servers changes (a switch, a restart, which goes through
 *    `pending`); a server stuck `pending` does not hold this back (it shows as not known and the figure as "at least");
 *  - on the first `context` event when every server is still `pending`: the session runs, so the servers that are up are in its window;
 *  - after a model or tier change;
 *  - when the dialog opens, at most once a minute;
 *  - once more on the next `context` event when the first ask brought no figure (Copilot answers `null` until the session has initialised; spec 100 Changes 2026-10-31);
 *  - at the turn's end when the adapter said its control channel is busy.
 */
import type { AgentEvent, AgentAdapter, McpServerStatus } from '../adapters/types';
import type { AgentInfo, McpContextView } from '../shared/api';
import { hasFigures, safeTokens, stripUnsafe } from '../shared/mcpcost';
import type { McpContextReport, McpContextServer } from '../shared/mcpcost';
import { createHash } from 'crypto';
import { cut } from '../shared/redact';
import { maskMcpText } from './mcpmask';

export const MCP_CONTEXT_OPEN_GAP_MS = 60_000;
export const MCP_CONTEXT_LIMIT_MS = 10_000;
const MAX_SERVERS = 500;
const NAME_HEAD = 100;

export interface McpContextDeps {
  agents: Map<string, AgentInfo>;
  router: { forAgent(id: string): Pick<AgentAdapter, 'isLive' | 'mcpContext'> | undefined };
  secrets(id: string): readonly string[];
  /** The server list the agent app last reported, and what the user switched off for this agent. */
  live(id: string): readonly McpServerStatus[];
  off(id: string): ReadonlySet<string>;
  push(id: string, view: McpContextView): void;
  /** FR-004 (decided Q3): server names, numbers and the time; called only for a report with figures. */
  persist?(id: string, servers: readonly McpContextServer[], at: number): void;
  now?(): number;
  timeoutMs?: number;
  /** The one timer: the time limit of a read (tests fire it by hand). */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
}

interface Slot {
  report?: McpContextReport;
  at?: number;
  /** The last time the agent app was asked (the dialog's once-a-minute limit). */
  askedAt?: number;
  asking?: Promise<void>;
  again?: boolean;
  /** The servers' first report was seen. */
  started?: boolean;
  running?: string;
  /** The `context` event's one re-ask was used. */
  retried?: boolean;
  /** The last list had a server still starting. */
  waiting?: boolean;
  /** The adapter's control channel was busy: ask when the turn ends. */
  atTurnEnd?: boolean;
}

/**
 * A reported name as it may be shown and kept: control and bidi characters gone, masked, at most 128 characters. Strip first (a control
 * character inside a token would hide it from the mask), mask before the cut (a token across the cut would leave its head). A name that was masked
 * or cut gets a short fingerprint of the original, so two long or token-like names stay two rows; `cut` backs over token characters, so no head stays.
 */
export function cleanName(raw: string, secrets: readonly string[]): string {
  const clean = stripUnsafe(raw);
  const masked = maskMcpText(clean, secrets) ?? '';
  if (masked === clean && masked && masked.length <= NAME_HEAD) return masked;
  const head = masked.length > NAME_HEAD ? cut(masked, NAME_HEAD) : masked;
  return `${head || 'unnamed'} #${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

/** What may reach the window: known fields, checked numbers, masked names; a server that failed or is off is not in it, one the app did not figure is "unknown" (US1 scenario 3, FR-040). */
export function cleanReport(r: McpContextReport, live: readonly McpServerStatus[], off: ReadonlySet<string>, secrets: readonly string[]): McpContextReport {
  const stateOf = new Map(live.map((s) => [s.name, s.status]));
  const notLoaded = (n: string): boolean => off.has(n) || ['failed', 'disabled', 'needs-auth'].includes(stateOf.get(n) ?? '');
  const name = (n: string): string => cleanName(n, secrets);
  const rows = Array.isArray(r?.servers) ? r.servers.slice(0, MAX_SERVERS).filter((s) => s && typeof s.name === 'string' && s.name) : [];
  const servers: McpContextServer[] = [];
  for (const s of rows) {
    if (notLoaded(s.name)) continue;
    const tokens = safeTokens(s.tokens);
    const deferredTokens = safeTokens(s.deferredTokens);
    const tools = safeTokens(s.tools);
    servers.push({ name: name(s.name), source: s.source === 'reported' || s.source === 'estimated' ? s.source : 'unknown', ...(tokens !== undefined ? { tokens } : {}), ...(deferredTokens ? { deferredTokens } : {}), ...(tools !== undefined ? { tools } : {}), ...(s.capped === true ? { capped: true } : {}), ...(s.error ? { error: 'list failed' } : {}) });
  }
  const named = new Set(rows.map((s) => s.name));
  for (const s of live) if ((s.status === 'connected' || s.status === 'pending') && !named.has(s.name) && !off.has(s.name) && servers.length < MAX_SERVERS) servers.push({ name: name(s.name), source: 'unknown' });
  const window = safeTokens(r?.window);
  const total = rows.some((s) => notLoaded(s.name)) ? undefined : safeTokens(r?.total); // a row left out must leave the total
  // finding 7: a running server with no figure means the total is "at least", whatever the app said
  const partial = r?.partial === true || servers.some((s) => safeTokens(s.tokens) === undefined && !s.deferredTokens);
  return { servers, ...(window ? { window } : {}), ...(total !== undefined ? { total } : {}), ...(partial ? { partial: true } : {}) };
}

export class McpContextTracker {
  private readonly slots = new Map<string, Slot>();
  constructor(private readonly d: McpContextDeps) {}

  private slot(id: string): Slot {
    let s = this.slots.get(id);
    if (!s) this.slots.set(id, (s = {}));
    return s;
  }
  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  /** What the window may hold for this agent. */
  view(id: string): McpContextView {
    const ad = this.d.router.forAgent(id);
    if (!this.d.agents.has(id) || typeof ad?.mcpContext !== 'function') return { ok: false, supported: false };
    const s = this.slots.get(id);
    return { ok: true, supported: true, ...(s?.report ? { report: s.report, at: s.at } : {}) };
  }

  /** `agents:mcpContext(id, open)`: the last report; `open` (the dialog opening) asks first, at most once a minute (FR-003). */
  async get(id: unknown, open?: unknown): Promise<McpContextView> {
    if (typeof id !== 'string' || !this.d.agents.has(id)) return { ok: false, supported: false };
    if (open === true) {
      const s = this.slot(id);
      if (s.askedAt === undefined || this.now() - s.askedAt >= MCP_CONTEXT_OPEN_GAP_MS || this.now() < s.askedAt) await this.ask(id);
    }
    return this.view(id);
  }

  /** One ask at a time; an ask that comes meanwhile runs once after it, so a switch during a read is not lost. */
  private ask(id: string): Promise<void> {
    const s = this.slot(id);
    if (s.asking) {
      s.again = true;
      return s.asking;
    }
    const ad = this.d.router.forAgent(id);
    if (typeof ad?.mcpContext !== 'function' || !ad.isLive(id)) return Promise.resolve();
    s.askedAt = this.now();
    const run = this.read(id, ad).catch(() => undefined).finally(() => {
      s.asking = undefined;
      if (s.again && this.slots.get(id) === s) {
        s.again = false;
        void this.ask(id);
      }
    });
    s.asking = run;
    return run;
  }

  private async read(id: string, ad: Pick<AgentAdapter, 'mcpContext'>): Promise<void> {
    const s = this.slot(id);
    let timer: unknown;
    let r: McpContextReport | undefined;
    try {
      r = await Promise.race([
        (ad.mcpContext as NonNullable<AgentAdapter['mcpContext']>)(id),
        new Promise<never>((_ok, no) => {
          const fire = () => no(new Error('timeout'));
          const ms = this.d.timeoutMs ?? MCP_CONTEXT_LIMIT_MS;
          timer = this.d.setTimer ? this.d.setTimer(fire, ms) : setTimeout(fire, ms);
        }),
      ]);
    } catch {
      return; // a slow or failing read changes nothing: the last figures stay, and nothing is logged
    } finally {
      if (timer !== undefined) (this.d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(timer);
    }
    if (this.slots.get(id) !== s) return; // the session stopped meanwhile
    if (r?.busy === true) {
      s.atTurnEnd = true;
      return;
    }
    const report = cleanReport(r as McpContextReport, this.d.live(id), this.d.off(id), this.d.secrets(id));
    const at = this.now();
    s.report = report;
    s.at = at;
    if (hasFigures(report)) {
      try {
        this.d.persist?.(id, report.servers, at);
      } catch {
        /* the figures still show; they are only not kept */
      }
    }
    this.d.push(id, this.view(id));
  }

  /** Called with each agent event (`mcpipc.ts`). */
  onEvent(e: AgentEvent): void {
    if (e.agentId) return; // only the main agent's window counts
    const id = e.sessionId;
    if (e.type === 'status' && e.status === 'stopped') {
      if (this.slots.delete(id)) this.d.push(id, { ok: true, supported: true });
      return;
    }
    if (e.type === 'mcp') {
      const s0 = this.slot(id);
      s0.waiting = e.servers.some((x) => x.status === 'pending');
      const running = e.servers.filter((x) => x.status === 'connected').map((x) => x.name).sort().join('\0');
      const s = this.slot(id);
      if (!s.started && !running) return; // nothing up yet; a `pending` one starts the ask on the next context event
      if (s.started && s.running === running) return;
      s.started = true;
      s.running = running;
      void this.ask(id);
      return;
    }
    const s = this.slots.get(id);
    if (e.type === 'context' && s?.waiting && !s.started) {
      s.started = true;
      s.running = '';
      void this.ask(id);
      return;
    }
    if (!s?.started) return;
    if (e.type === 'model') void this.ask(id);
    else if (e.type === 'context' && !s.retried && !s.atTurnEnd && !s.asking && !hasFigures(s.report)) {
      s.retried = true;
      void this.ask(id);
    } else if (e.type === 'status' && e.status === 'idle' && s.atTurnEnd) {
      s.atTurnEnd = false;
      void this.ask(id);
    }
  }
}
