/**
 * Spec 054 FR-003..FR-005: the main-process side of remote control, without Electron so it can be unit-tested.
 * Input from the window is validated here; the link that is opened is the one stored for that agent, never one sent by the page.
 */
import type { AgentAdapter } from '../adapters/types';
import { allowedRemoteUrl, cleanRemoteError } from '../shared/remote';
import type { RemoteState } from '../shared/remote';

export interface RemoteOpsDeps {
  /** The agent exists in this window's office. */
  known(id: string): boolean;
  /** The adapter that runs the agent. */
  adapterOf(id: string): AgentAdapter | undefined;
  /** Opens a checked https://github.com/... link in the system browser. */
  open(url: string): Promise<void>;
}

export const NO_REMOTE = 'This agent app cannot be controlled from GitHub.';
export const NOT_RUNNING = 'Send a message first so the session is running, then turn on remote control.';

export function createRemoteOps(deps: RemoteOpsDeps) {
  /** Last state per agent id while remote control is on; dropped when it is turned off, fails, or the session ends. */
  const state = new Map<string, RemoteState>();
  return {
    async setRemote(id: unknown, on: unknown): Promise<RemoteState> {
      if (typeof id !== 'string' || !id || id.length > 200 || !deps.known(id) || typeof on !== 'boolean') return { ok: false, error: 'unknown agent' };
      const ad = deps.adapterOf(id);
      if (!ad || typeof ad.setRemote !== 'function' || !ad.capabilities.remote) return { ok: false, error: NO_REMOTE };
      if (!ad.isLive(id)) return { ok: false, error: NOT_RUNNING };
      let r: RemoteState;
      try {
        r = await ad.setRemote(id, on);
      } catch (err) {
        r = { ok: false, error: cleanRemoteError(err) };
      }
      // only plain, checked fields cross back to the window
      const out: RemoteState = r && r.ok ? { ok: true, on: r.on === true } : { ok: false, error: cleanRemoteError(r?.error) };
      if (out.ok && out.on) {
        if (allowedRemoteUrl(r.url)) out.url = r.url;
        if (typeof r.steerable === 'boolean') out.steerable = r.steerable;
        if (r.visibility === 'repo' || r.visibility === 'unshared') out.visibility = r.visibility;
        state.set(id, out);
      } else if (out.ok) state.delete(id);
      return out;
    },
    /** FR-005: opens the stored link of agent `id` after checking it again; anything else is refused. */
    async openRemote(id: unknown): Promise<{ ok: boolean }> {
      const s = typeof id === 'string' ? state.get(id) : undefined;
      if (!s || !s.url || !allowedRemoteUrl(s.url)) return { ok: false };
      await deps.open(new URL(s.url).href);
      return { ok: true };
    },
    /** FR-003: the session ended or the agent left the office. */
    forget(id: string): void {
      state.delete(id);
    },
    has(id: string): boolean {
      return state.has(id);
    },
  };
}
