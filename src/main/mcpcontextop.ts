/**
 * Spec 100 FR-003, FR-004, FR-040: when main asks an agent app for its MCP figures, what it keeps and what reaches the window. Pure (no
 * Electron): one report per agent in memory, only names and numbers out, one ask at a time, 10 s at most, never on a timer. Asked:
 *  - when the session's servers are first reported running, and again when the set of running servers changes (a switch, a restart);
 *  - after a model or tier change;
 *  - when the dialog opens, at most once a minute;
 *  - once more on the next `context` event when the first ask brought no figure (Copilot answers `null` until the session has initialised; spec 100 Changes 2026-10-31);
 *  - at the turn's end when the adapter said its control channel is busy.
 */
import type { AgentEvent, AgentAdapter, McpServerStatus } from '../adapters/types';
import type { AgentInfo, McpContextView } from '../shared/api';
import { hasFigures, safeTokens } from '../shared/mcpcost';
import type { McpContextReport, McpContextServer } from '../shared/mcpcost';
import { cut } from '../shared/redact';
import { maskMcpText } from './mcpmask';

export const MCP_CONTEXT_OPEN_GAP_MS = 60_000;
export const MCP_CONTEXT_LIMIT_MS = 10_000;
const MAX_SERVERS = 500;
const MAX_NAME = 128;

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
  /** The adapter's control channel was busy: ask when the turn ends. */
  atTurnEnd?: boolean;
}

/** What may reach the window: known fields, checked numbers, masked names; a server that failed or is off is not in it, one the app did not figure is "unknown" (US1 scenario 3, FR-040). */
export function cleanReport(r: McpContextReport, live: readonly McpServerStatus[], off: ReadonlySet<string>, secrets: readonly string[]): McpContextReport {
  const stateOf = new Map(live.map((s) => [s.name, s.status]));
  const notLoaded = (n: string): boolean => off.has(n) || ['failed', 'disabled', 'needs-auth'].includes(stateOf.get(n) ?? '');
  const name = (n: string): string => cut(maskMcpText(n, secrets) ?? '', MAX_NAME);
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
  for (const s of live) if (s.status === 'connected' && !named.has(s.name) && !off.has(s.name) && servers.length < MAX_SERVERS) servers.push({ name: name(s.name), source: 'unknown' });
  const window = safeTokens(r?.window);
  const total = rows.length ? undefined : safeTokens(r?.total); // with rows, the rows are the figure (a row left out must leave the total)
  return { servers, ...(window ? { window } : {}), ...(total !== undefined ? { total } : {}), ...(r?.partial === true ? { partial: true } : {}) };
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
    const run = this.read(id, ad).finally(() => {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let r: McpContextReport | undefined;
    try {
      r = await Promise.race([
        (ad.mcpContext as NonNullable<AgentAdapter['mcpContext']>)(id),
        new Promise<never>((_ok, no) => {
          timer = setTimeout(() => no(new Error('timeout')), this.d.timeoutMs ?? MCP_CONTEXT_LIMIT_MS);
        }),
      ]);
    } catch {
      return; // a slow or failing read changes nothing: the last figures stay, and nothing is logged
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (this.slots.get(id) !== s) return; // the session stopped meanwhile
    if (r.busy === true) {
      s.atTurnEnd = true;
      return;
    }
    const report = cleanReport(r, this.d.live(id), this.d.off(id), this.d.secrets(id));
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
      if (e.servers.some((x) => x.status === 'pending')) return; // still starting: asked when it has settled
      const running = e.servers.filter((x) => x.status === 'connected').map((x) => x.name).sort().join('\0');
      const s = this.slot(id);
      if (!s.started && !running) return;
      if (s.started && s.running === running) return;
      s.started = true;
      s.running = running;
      void this.ask(id);
      return;
    }
    const s = this.slots.get(id);
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
