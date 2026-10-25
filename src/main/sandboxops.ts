/**
 * Spec 087 FR-007a/FR-007c/FR-012: what main does for the window's sandbox calls, without Electron (unit-tested in
 * `scripts/test-sandbox-ops.ts`; `ipc/sandbox.ts` only registers it). *Continue without the OS sandbox* is accepted only for a session
 * that has an open sandbox-unavailable note that main itself forwarded from the adapter (review on PR 733): one-shot, cleared on use and
 * when the adapter reports a new attempt; *Always continue* only when that note offered it, and stored only after the adapter accepted.
 */
import type { AgentAdapter, AgentEvent } from '../adapters/types';
import type { SandboxHostView } from '../shared/api';
import { outwardSandboxEvent, sandboxReason } from '../shared/sandbox';
import { ANNOUNCE_APPS } from '../shared/credits';

export interface SandboxOpsDeps {
  /** The agent's adapter, or undefined for an unknown id. */
  adapterOf(id: string): AgentAdapter | undefined;
  /** An adapter instance by app id (throws for an unknown one). */
  instance(app: string): AgentAdapter;
  readyAdapterIds(): Promise<ReadonlySet<string>>;
  store(): { setSandboxAlwaysContinue(app: unknown, on: unknown): boolean; sandboxAlwaysContinue(app: string): boolean } | undefined;
}

/**
 * Review round 8 on PR 733: what main sends to the window for an adapter event: the MCP/tool masking (`outward`), then the sandbox
 * event's own cleaning. `main.ts` forwards through this one function (a source check in `test-sandbox-ops` pins the call).
 */
export function toWindowEvent(e: AgentEvent, outward: (e: AgentEvent) => AgentEvent): AgentEvent {
  return outwardSandboxEvent(outward(e));
}

export type OpResult = { ok: true } | { ok: false; error: string };
const errText = (e: unknown): string => sandboxReason(e instanceof Error ? e.message : String(e)) ?? 'Durbar could not do that.';
const NO_NOTE = 'There is no OS sandbox note to answer for this session.';

export function createSandboxOps(deps: SandboxOpsDeps) {
  /** Session id -> the actions of the open note main forwarded (the window can answer only these, once). */
  const open = new Map<string, ReadonlyArray<'continue' | 'always'>>();
  return {
    /** Every adapter event: a note with actions opens one; a new attempt (state on or checking) or a refusal closes it. */
    onEvent(e: AgentEvent): void {
      // a session the adapter ended (End session, Remove, removing its folder, Restart session) takes its note with it
      if (e.type === 'status' && e.status === 'stopped' && !e.agentId) return void open.delete(e.sessionId);
      if (e.type !== 'sandbox' || e.agentId) return;
      if (e.notice) {
        const acts = e.notice.refused === true ? [] : (Array.isArray(e.notice.actions) ? e.notice.actions : []).filter((a) => a === 'continue' || a === 'always');
        if (acts.includes('continue')) open.set(e.sessionId, acts);
        else open.delete(e.sessionId);
      } else if (e.sandbox && (e.sandbox.state === 'on' || e.sandbox.state === 'unknown')) open.delete(e.sessionId);
    },
    /** A session that ended or was removed: its note goes with it. */
    forget(id: string): void {
      open.delete(id);
    },
    async continueWithout(fromApp: boolean, id: unknown, opts: unknown): Promise<OpResult> {
      if (!fromApp) return { ok: false, error: 'invalid request' };
      const ad = typeof id === 'string' ? deps.adapterOf(id) : undefined;
      if (typeof id !== 'string' || !ad) return { ok: false, error: 'unknown agent' };
      if (!ad.capabilities.osSandbox || typeof ad.continueWithoutSandbox !== 'function') return { ok: false, error: 'This agent app has no OS sandbox choice.' };
      const always = !!opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'always') && (opts as { always?: unknown }).always === true;
      const note = open.get(id);
      if (!note) return { ok: false, error: NO_NOTE };
      if (always && !note.includes('always')) return { ok: false, error: 'Always continue was not offered for this session.' };
      open.delete(id); // one-shot: a second call (or a stray one) is refused
      try {
        await ad.continueWithoutSandbox(id, { always }); // the adapter refuses under the policy (FR-007d) and where Always is not offered
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
      if (always) deps.store()?.setSandboxAlwaysContinue(ad.id, true); // only after the adapter accepted
      return { ok: true };
    },
    async hosts(fromApp: boolean): Promise<Record<string, SandboxHostView>> {
      if (!fromApp) return {};
      const ready = await deps.readyAdapterIds();
      const out: Record<string, SandboxHostView> = {};
      for (const app of ANNOUNCE_APPS) {
        if (!ready.has(app)) continue;
        let ad: AgentAdapter;
        try {
          ad = deps.instance(app);
        } catch {
          continue;
        }
        if (!ad.capabilities.osSandbox || typeof ad.sandboxHost !== 'function') continue;
        try {
          const v = await ad.sandboxHost();
          out[app] = { ...v, ...(deps.store()?.sandboxAlwaysContinue(app) ? { alwaysContinue: true } : {}) };
        } catch {
          out[app] = { available: false, reason: 'Durbar could not ask this app about its sandbox.' };
        }
      }
      return out;
    },
    /** FR-007c: Settings only undoes the stored choice, for a known app id. */
    alwaysOff(fromApp: boolean, app: unknown): { ok: boolean } {
      if (!fromApp || typeof app !== 'string' || !(ANNOUNCE_APPS as readonly string[]).includes(app)) return { ok: false };
      deps.store()?.setSandboxAlwaysContinue(app, false);
      return { ok: true };
    },
  };
}
export type SandboxOps = ReturnType<typeof createSandboxOps>;
