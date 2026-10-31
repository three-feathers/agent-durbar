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
  /** Opens a checked link on the adapter's remote service host in the system browser. */
  open(url: string): Promise<void>;
  /** The agent's permission mode now (remote control is refused in Allow all). */
  modeOf?(id: string): string | undefined;
  /** FR-011: the main process asks the user itself (a native dialog the page cannot answer) before remote control turns on. */
  confirm?(id: string): Promise<boolean>;
  /** FR-011: remote control on or off, for the activity log. */
  record?(id: string, on: boolean): void;
  /** FR-040 (spec 017 FR-018, owner 2026-10-23): the agent's door is closed by the user; turning remote control on is then refused. */
  doorClosed?(id: string): boolean;
  /** Spec 099 FR-007: the session is on Autopilot, or being turned on. Its own check, so that a later change to Autopilot's state cannot open this. */
  autopilotOn?(id: string): boolean;
}

export const NOT_ON_AUTOPILOT = 'Remote control is off on Autopilot: anyone who can steer this session remotely could make it run commands without asking you. Stop Autopilot and switch to Ask first, then turn it on.';
export const DOOR_CLOSED = 'The door is closed (Do not disturb). Open it first.';

export const NO_REMOTE = 'This agent app cannot be controlled remotely.';
export const NOT_RUNNING = 'Send a message first so the session is running, then turn on remote control.';
export const NOT_IN_ALLOW_ALL = 'Remote control is off in Allow all: anyone who can steer this session remotely could make it run commands without asking you. Switch to Ask first, then turn it on.';

export function createRemoteOps(deps: RemoteOpsDeps) {
  /** Last state per agent id while remote control is on; dropped when it is turned off, fails, or the session ends. */
  const state = new Map<string, RemoteState>();
  /** Spec 099 FR-007: asked or being turned on, not yet in `state`; Autopilot's own check after its dialog looks here. */
  const turningOn = new Map<string, number>();
  const raised = (id: string): string | undefined => (deps.autopilotOn?.(id) ? NOT_ON_AUTOPILOT : deps.modeOf?.(id) === 'allow' ? NOT_IN_ALLOW_ALL : undefined);
  return {
    async setRemote(id: unknown, on: unknown): Promise<RemoteState> {
      if (typeof id !== 'string' || !id || id.length > 200 || !deps.known(id) || typeof on !== 'boolean') return { ok: false, error: 'unknown agent' };
      const ad = deps.adapterOf(id);
      if (!ad || typeof ad.setRemote !== 'function' || !ad.capabilities.remote) return { ok: false, error: NO_REMOTE };
      if (!ad.isLive(id)) return { ok: false, error: NOT_RUNNING };
      // FR-011 (security review, 2026-10-20): never with Allow all, and only after the main process's own confirmation
      const up = on && raised(id);
      if (up) return { ok: false, error: up };
      if (on && deps.doorClosed?.(id)) return { ok: false, error: DOOR_CLOSED };
      if (on) turningOn.set(id, (turningOn.get(id) ?? 0) + 1);
      let r: RemoteState;
      try {
        if (on && deps.confirm && !(await deps.confirm(id))) return { ok: false, cancelled: true, error: 'Cancelled.' };
        // a raise while the dialog was open (spec 099 FR-007): asked again here, and once more after the app's answer
        const during = on && raised(id);
        if (during) return { ok: false, error: during };
        try {
          r = await ad.setRemote(id, on);
        } catch (err) {
          r = { ok: false, error: cleanRemoteError(err) };
        }
        const late = on && r?.ok && r.on === true && raised(id);
        if (late) {
          await Promise.resolve().then(() => ad.setRemote?.(id, false)).catch(() => undefined);
          return { ok: false, error: late };
        }
      } finally {
        if (on) {
          const n = (turningOn.get(id) ?? 1) - 1;
          if (n > 0) turningOn.set(id, n);
          else turningOn.delete(id);
        }
      }
      // only plain, checked fields cross back to the window
      const out: RemoteState = r && r.ok ? { ok: true, on: r.on === true } : { ok: false, error: cleanRemoteError(r?.error) };
      if (out.ok && out.on) {
        if (allowedRemoteUrl(r.url, ad.capabilities.remoteService?.host)) out.url = r.url; // FR-060: that service's host only
        if (typeof r.steerable === 'boolean') out.steerable = r.steerable;
        if (r.visibility === 'repo' || r.visibility === 'unshared') out.visibility = r.visibility;
        state.set(id, out);
        deps.record?.(id, true);
      } else if (out.ok) {
        if (state.delete(id)) deps.record?.(id, false);
      }
      return out;
    },
    /** FR-005: opens the stored link of agent `id` after checking it again; anything else is refused. */
    async openRemote(id: unknown): Promise<{ ok: boolean }> {
      const s = typeof id === 'string' ? state.get(id) : undefined;
      const host = typeof id === 'string' ? deps.adapterOf(id)?.capabilities.remoteService?.host : undefined;
      if (!s || !s.url || !allowedRemoteUrl(s.url, host)) return { ok: false };
      await deps.open(new URL(s.url).href);
      return { ok: true };
    },
    /** FR-062: the adapter reports a new link after a relaunch; kept only when it is on that service's host and remote control is on. */
    updateUrl(id: string, url: unknown): string | undefined {
      const s = state.get(id);
      if (!s || !allowedRemoteUrl(url, deps.adapterOf(id)?.capabilities.remoteService?.host)) return undefined;
      s.url = url;
      return url;
    },
    /** FR-003: the session ended or the agent left the office. */
    forget(id: string): void {
      if (state.delete(id)) deps.record?.(id, false);
    },
    /**
     * FR-011: turns remote control off on GitHub too before a session ends, is removed or the app quits (best effort: the
     * runtime may otherwise keep the session steerable after Durbar says it is off).
     */
    async release(id: string): Promise<void> {
      if (!state.has(id)) return;
      state.delete(id);
      deps.record?.(id, false);
      const ad = deps.adapterOf(id);
      try {
        if (ad && typeof ad.setRemote === 'function') await ad.setRemote(id, false);
      } catch {
        /* the session is going away anyway */
      }
    },
    ids(): string[] {
      return [...state.keys()];
    },
    has(id: string): boolean {
      return state.has(id);
    },
    /** On, or on its way (its dialog is open, or the app has not answered): spec 099 FR-007. */
    engaged(id: string): boolean {
      return state.has(id) || turningOn.has(id);
    },
  };
}
