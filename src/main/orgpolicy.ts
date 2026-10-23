/**
 * Spec 076 FR-203/FR-204/FR-207 (issue #602): the agent apps' own organization policies in main. Each adapter reads its app's machine
 * policy (`AgentAdapter.readOrgPolicy`); this cache keeps it for 60 seconds, answers the starters' and setters' refusals with the
 * window's words, and builds the values-free view for the window. Never throws; never logs a policy's contents.
 */
import { emptyOrgPolicy, mcpBlocked, modeBlocked, modelBlocked, orgPolicyView, strictestOrgPolicy, toolBlocked } from '../shared/orgpolicy';
import type { OrgMcpServer, OrgPolicy, OrgPolicyAppView } from '../shared/orgpolicy';

export const ORG_POLICY_TTL_MS = 60_000;

export interface OrgPolicySource {
  /** The adapter ids to read (the registry's). */
  ids(): readonly string[];
  /** The adapter of an id, for its `readOrgPolicy` and name. */
  adapter(id: string): { displayName: string; readOrgPolicy?(): OrgPolicy } | undefined;
  now?(): number;
}

export class OrgPolicyCache {
  private readonly cache = new Map<string, { at: number; p: OrgPolicy }>();
  constructor(private readonly src: OrgPolicySource) {}

  private now(): number {
    return this.src.now ? this.src.now() : Date.now();
  }

  /** The policy of one agent app (an empty one for an app that reads none); re-read when older than the TTL (FR-204). */
  get(id: string | undefined): OrgPolicy | undefined {
    if (!id) return undefined;
    const ad = this.src.adapter(id);
    if (!ad || typeof ad.readOrgPolicy !== 'function') return undefined;
    const hit = this.cache.get(id);
    const t = this.now();
    if (hit && t - hit.at < ORG_POLICY_TTL_MS && t >= hit.at) return hit.p;
    let p: OrgPolicy;
    try {
      p = ad.readOrgPolicy() ?? emptyOrgPolicy(ad.displayName);
    } catch {
      p = strictestOrgPolicy(ad.displayName, [], ['the policy could not be read']); // FR-201: a reader that fails is the strictest state
    }
    this.cache.set(id, { at: t, p });
    return p;
  }

  /** FR-203: why a start, resume or switch must be refused, or undefined. */
  refusal(id: string | undefined, what: { mode?: string; model?: string }): string | undefined {
    const p = this.get(id);
    if (!p) return undefined;
    if (what.mode !== undefined) {
      const r = modeBlocked(p, what.mode);
      if (r) return `${r}: pick another permission mode.`;
    }
    if (what.model !== undefined) {
      const r = modelBlocked(p, what.model);
      if (r) return `${r}: pick another model.`;
    }
    return undefined;
  }

  model(id: string | undefined, model: string): string | undefined {
    return modelBlocked(this.get(id), model);
  }

  mcp(id: string | undefined, s: OrgMcpServer): string | undefined {
    return mcpBlocked(this.get(id), s);
  }

  tool(id: string | undefined, server: string, tool: string): string | undefined {
    return toolBlocked(this.get(id), server, tool);
  }

  /** FR-207: per app, no values of the files. */
  view(): Record<string, OrgPolicyAppView> {
    const out: Record<string, OrgPolicyAppView> = {};
    for (const id of this.src.ids()) {
      const p = this.get(id);
      if (p) out[id] = orgPolicyView(p);
    }
    return out;
  }
}
