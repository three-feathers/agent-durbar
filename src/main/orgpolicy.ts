/**
 * Spec 076 FR-203/FR-204/FR-207 (issue 602): the agent apps' own organization policies in main. Each adapter reads its app's policy
 * (`AgentAdapter.readOrgPolicy`, Copilot through its runtime); this cache keeps it for 60 seconds (monotonic clock), answers the
 * starters' and setters' refusals with the window's words, and builds the values-free view for the window. Only `blocked` and `fatal`
 * verdicts are refused; `doubt` is advice (FR-201). Never throws; never logs a policy's contents.
 */
import { emptyOrgPolicy, mcpVerdict, modelVerdict, modeVerdict, orgPolicyView, toolVerdict, wholeOrgPolicy } from '../shared/orgpolicy';
import type { OrgMcpServer, OrgPolicy, OrgPolicyAppView, OrgVerdict } from '../shared/orgpolicy';

export const ORG_POLICY_TTL_MS = 60_000;

export interface OrgPolicySource {
  /** The adapter ids to read (the registry's). */
  ids(): readonly string[];
  /** The adapter of an id, for its `readOrgPolicy` and name. */
  adapter(id: string): { displayName: string; readOrgPolicy?(): OrgPolicy | Promise<OrgPolicy> } | undefined;
  now?(): number;
}

/** What a start, resume or switch asks about: a permission mode and/or a model. */
export interface OrgAsk {
  mode?: string;
  model?: string;
}

export class OrgPolicyCache {
  private readonly cache = new Map<string, { at: number; p: OrgPolicy }>();
  private readonly pending = new Map<string, Promise<OrgPolicy | undefined>>();
  constructor(private readonly src: OrgPolicySource) {}

  private now(): number {
    return this.src.now ? this.src.now() : performance.now(); // monotonic: a wall-clock change neither keeps nor drops a read
  }

  private stale(id: string): boolean {
    const hit = this.cache.get(id);
    const t = this.now();
    return !hit || t - hit.at >= ORG_POLICY_TTL_MS || t < hit.at;
  }

  /** Read the policy of one agent app now when the cached one is older than the TTL (FR-204); one read at a time per app. */
  async fresh(id: string | undefined): Promise<OrgPolicy | undefined> {
    if (!id) return undefined;
    const ad = this.src.adapter(id);
    if (!ad || typeof ad.readOrgPolicy !== 'function') return undefined;
    if (!this.stale(id)) return this.cache.get(id)?.p;
    let run = this.pending.get(id);
    if (!run) {
      run = (async () => {
        let p: OrgPolicy;
        try {
          p = (await ad.readOrgPolicy!()) ?? emptyOrgPolicy(ad.displayName);
        } catch {
          p = wholeOrgPolicy(ad.displayName, [], ['the policy could not be read'], 'doubt'); // Durbar could not read it: advice, not a refusal
        }
        this.cache.set(id, { at: this.now(), p });
        return p;
      })();
      this.pending.set(id, run);
      void run.finally(() => this.pending.delete(id));
    }
    return run;
  }

  /** The last read policy (no wait); a stale one starts a new read in the background. */
  cached(id: string | undefined): OrgPolicy | undefined {
    if (!id) return undefined;
    if (this.stale(id)) void this.fresh(id);
    return this.cache.get(id)?.p;
  }

  private static refusalOf(p: OrgPolicy | undefined, ask: OrgAsk): string | undefined {
    if (!p) return undefined;
    const m = ask.mode !== undefined ? modeVerdict(p, ask.mode) : undefined;
    if (m?.refuse) return `${m.why}: pick another permission mode.`;
    const md = ask.model !== undefined ? modelVerdict(p, ask.model) : undefined;
    if (md?.refuse) return `${md.why}: pick another model.`;
    return undefined;
  }

  /** FR-203: why a start, resume or switch must be refused (only `blocked` / `fatal`), after a fresh enough read. */
  async refusal(id: string | undefined, ask: OrgAsk): Promise<string | undefined> {
    return OrgPolicyCache.refusalOf(await this.fresh(id), ask);
  }

  /** FR-201: the advice words for a start (`doubt` on its mode or model), or undefined; never a refusal. */
  async advice(id: string | undefined, ask: OrgAsk): Promise<string | undefined> {
    const p = await this.fresh(id);
    if (!p) return undefined;
    const m = ask.mode !== undefined ? modeVerdict(p, ask.mode) : undefined;
    if (m && !m.refuse) return m.why;
    const md = ask.model !== undefined ? modelVerdict(p, ask.model) : undefined;
    return md && !md.refuse ? md.why : undefined;
  }

  /** The same from the last read, for a caller that cannot wait (the mode switch); a stale cache reads again in the background. */
  refusalNow(id: string | undefined, ask: OrgAsk): string | undefined {
    return OrgPolicyCache.refusalOf(this.cached(id), ask);
  }

  async model(id: string | undefined, model: string): Promise<OrgVerdict | undefined> {
    return modelVerdict(await this.fresh(id), model);
  }

  async mcp(id: string | undefined, s: OrgMcpServer): Promise<OrgVerdict | undefined> {
    return mcpVerdict(await this.fresh(id), s);
  }

  /** From the last read (the MCP list is repainted often; it never waits on a policy read). */
  mcpNow(id: string | undefined, s: OrgMcpServer): OrgVerdict | undefined {
    return mcpVerdict(this.cached(id), s);
  }

  async tool(id: string | undefined, server: string, tool: string): Promise<OrgVerdict | undefined> {
    return toolVerdict(await this.fresh(id), server, tool);
  }

  /** FR-207: per app, no values of the policy; reads what is stale first. */
  async view(): Promise<Record<string, OrgPolicyAppView>> {
    const out: Record<string, OrgPolicyAppView> = {};
    for (const id of this.src.ids()) {
      const p = await this.fresh(id);
      if (p) out[id] = orgPolicyView(p);
    }
    return out;
  }
}
