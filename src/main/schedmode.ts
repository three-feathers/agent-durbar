/**
 * Spec 044 FR-180..FR-184: a scheduled run's own mode, for one turn. No Electron, no files: `createScheduleWiring` is main's whole wiring of a
 * scheduled send, and a test drives it with the real Scheduler and a FakeAdapter (`test:schedules`).
 *
 * One per-session state machine (`RunModes`) owns every transition, so nothing else decides when a run is over:
 *
 *   free -> setup (reserved: ensureLive and the policy read) -> sending (`apply` switched the mode, the adapter's send is in flight)
 *        -> running (the turn started and the mode is still the run's) -> free
 *
 * The session is held from `reserve` until the mode is proven back. While held, a typed message is refused and other schedules count it as busy.
 * - Only a status from after the send began counts: an ending status before any other status is left over from a start or a resume.
 * - A send that returns with no status of its own went nowhere (a sandbox hold, a spending limit): the mode comes back at once and it is not `sent`.
 * - A read never changes this. A session that is not live while its send is in flight is reopening (Codex) and stays held; `running` with no live
 *   session is the only state a look may clear, since the adapter then keeps no mode and the next start uses `a.permMode`.
 *
 * The temporary mode goes to the adapter only. It is never written to `a.permMode`, the folder's mode or the session's remembered mode, and never
 * through `setModeOp`, so a crash leaves nothing to undo: a restart starts the session in its own mode. `a.runMode` is what the window shows; not saved.
 */
import type { AdapterRouter } from '../adapters/router';
import { refusesLive, setPermModeOf } from '../adapters/router';
import type { AgentAdapter, AgentMessage } from '../adapters/types';
import type { AgentInfo, PermMode } from '../shared/api';
import type { ModeAgentInfo, ModeRefusal, ModeVerdict, Schedule, ScheduleMode, ScheduleTarget } from './schedules';

export interface RunModeDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent' | 'adapterIdOf'>;
  /** The session's last status says it is working or waiting for a person. */
  statusBusy(id: string): boolean;
  /** Spec 054: remote control is on: anyone steering it would reach a raised turn (FR-182). */
  remote?(id: string): boolean;
  /** Spec 052 FR-071: one row when the mode changes for a run and one when it comes back. No prompt text. */
  log?(a: AgentInfo, action: string, mode: PermMode): void;
  /** The window shows the real mode during the turn, and says when it comes back. */
  changed?(a: AgentInfo, mode: PermMode | undefined): void;
}

const WORDS: Record<PermMode, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' };
const RANK: Record<PermMode, number> = { 'read-only': 0, ask: 1, allow: 2 };
const runMode = (m: ScheduleMode | undefined): m is PermMode => m === 'read-only' || m === 'ask' || m === 'allow';

/**
 * The check at a save and at each run (FR-182..FR-184), for the agent `a` that would run it now. No agent: undefined, and `send` reports
 * `no-agent` as before. Autopilot is the scheduler's (`modeBlock`): it never reaches this as a usable mode.
 */
export function modeCheckOp(d: { router: RunModeDeps['router']; orgNow?(a: AgentInfo, mode: PermMode): string | undefined }, s: Pick<Schedule, 'mode' | 'modeFor' | 'target'>, a: AgentInfo | undefined): ModeVerdict {
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return undefined;
  const app = d.router.adapterIdOf(a.id);
  if (!s.modeFor || s.modeFor.app !== app || (s.modeFor.session ?? '') !== (s.target?.session ?? '')) return 'other-agent';
  if (!runMode(s.mode)) return 'mode-lacking';
  if (!ad.capabilities?.permissionModes?.includes(s.mode)) return 'mode-lacking';
  if (d.orgNow?.(a, s.mode)) return 'mode-org';
  // the start options cannot carry it (they are the session's own mode), so an adapter that cannot switch runs only in that mode
  if (s.mode !== a.permMode && !ad.setPermMode) return 'mode-live';
  return undefined;
}

interface Held {
  phase: 'setup' | 'sending' | 'running';
  /** The temporary mode while it is on the adapter; undefined for a run in the session's own mode, and once it is back. */
  mode?: PermMode;
  /** A status other than an ending one came after the send began. */
  started: boolean;
  /** Stop or the user's own choice came while the send was in flight: the mode comes back when it returns (a reopening session cannot take it now). */
  endWanted: boolean;
}

const HELD_WORDS = 'A scheduled run is using this session. Wait for it to end, or stop it, then send your message.';

export class RunModes {
  private held = new Map<string, Held>();
  private typing = new Map<string, number>();
  constructor(private readonly d: RunModeDeps) {}

  /** The gate for a scheduled run: false when a typed message is on its way, another run holds the session, or it is working. */
  reserve(id: string): boolean {
    if (this.isHeld(id) || (this.typing.get(id) ?? 0) > 0 || this.d.statusBusy(id)) return false;
    this.held.set(id, { phase: 'setup', started: false, endWanted: false });
    return true;
  }

  /** The gate for a typed message: why it is refused, or undefined with the send counted until `endUserSend`. */
  beginUserSend(id: string): string | undefined {
    if (this.isHeld(id)) return HELD_WORDS;
    this.typing.set(id, (this.typing.get(id) ?? 0) + 1);
    return undefined;
  }

  endUserSend(id: string): void {
    const n = (this.typing.get(id) ?? 0) - 1;
    if (n > 0) this.typing.set(id, n);
    else this.typing.delete(id);
  }

  /**
   * Puts a reserved, live session in the schedule's mode; call it in the same tick as the send. Returns why it could not, and then nothing was
   * sent or changed. The mode the session already has needs no switch and nothing to restore. 'busy': a turn started during the setup.
   */
  apply(a: AgentInfo, mode: ScheduleMode | undefined): ModeRefusal | 'busy' | undefined {
    const h = this.held.get(a.id);
    const ad = this.d.router.forAgent(a.id);
    if (!h || h.phase !== 'setup' || !ad || !ad.isLive(a.id)) return 'mode-live'; // a session that is gone would ignore the switch and start in its own mode
    if (!runMode(mode)) return 'mode-lacking';
    if (this.d.statusBusy(a.id)) return 'busy';
    if (mode !== a.permMode) {
      if (RANK[mode] > (RANK[a.permMode] ?? 0) && this.d.remote?.(a.id)) return 'mode-live'; // FR-182: nobody steering remotely reaches a raised turn
      try {
        const r = setPermModeOf(ad, a.id, mode);
        if (refusesLive(ad, a.id, r.applied)) return 'mode-live';
      } catch {
        return 'mode-live';
      }
      h.mode = mode;
      a.runMode = mode;
      this.d.log?.(a, `Scheduled run: ${WORDS[mode]} for this turn`, mode);
      this.d.changed?.(a, mode);
    }
    h.phase = 'sending';
    return undefined;
  }

  /** True when `apply` put a temporary mode on this session. */
  hasTemp(id: string): boolean {
    return this.held.get(id)?.mode !== undefined;
  }

  /**
   * The adapter's send returned or threw, or the run stopped before sending (`ok` false). Every run goes through here exactly once: this is the
   * defined end of each return path. Returns whether a turn started. Only a run whose mode is still on a turn that started stays held.
   */
  settle(id: string, ok: boolean): { started: boolean } {
    const h = this.held.get(id);
    if (!h) return { started: false }; // removed while its send was in flight
    const started = h.started;
    if (ok && started && h.mode !== undefined && !h.endWanted) {
      h.phase = 'running';
      return { started };
    }
    this.restore(id, h);
    this.held.delete(id);
    return { started };
  }

  /** A main session's status. Before the send began it says nothing about this run; a status left over from a start or a resume does not end it. */
  onStatus(id: string, status: string): void {
    const h = this.held.get(id);
    if (!h || h.phase === 'setup') return;
    if (status !== 'idle' && status !== 'error' && status !== 'stopped') {
      h.started = true;
      return;
    }
    if (!h.started) return;
    this.restore(id, h);
    if (h.phase === 'running') this.held.delete(id); // `sending`: `settle` is still to come and finishes it
  }

  /**
   * The user took over: Stop, or a mode chosen during the turn. While the send is in flight the session may be reopening and cannot take a mode,
   * so it comes back when the send returns. Always `a.permMode` as it is now.
   */
  end(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    if (h.phase !== 'running') {
      h.endWanted = true;
      return;
    }
    this.restore(id, h);
    this.held.delete(id);
  }

  /**
   * Back to the session's own mode. A session that is not live needs nothing: its next start uses `a.permMode`. If the adapter throws here the
   * session would keep the run's mode, so it is stopped: that is the one way left to be sure.
   */
  private restore(id: string, h: Held): void {
    const mode = h.mode;
    if (mode === undefined) return;
    h.mode = undefined;
    const a = this.d.agents.get(id);
    if (!a) return;
    a.runMode = undefined;
    const ad = this.d.router.forAgent(id);
    this.d.changed?.(a, undefined);
    if (!ad || !ad.isLive(id)) return;
    try {
      setPermModeOf(ad, id, a.permMode);
      this.d.log?.(a, `Back to ${WORDS[a.permMode] ?? a.permMode} after the scheduled run`, a.permMode);
    } catch {
      void Promise.resolve().then(() => ad.stop(id)).catch(() => undefined);
    }
  }

  /** The removed agent: its adapter state is gone with it. */
  forget(id: string): void {
    this.held.delete(id);
    this.typing.delete(id);
  }

  /** The mode the session's turn runs in when a run changed it, else undefined. Only reads. */
  modeOf(id: string): PermMode | undefined {
    return this.held.get(id)?.mode;
  }

  /** Other schedules count this session as busy: a run holds it, or a typed message is on its way. */
  busy(id: string): boolean {
    return this.isHeld(id) || (this.typing.get(id) ?? 0) > 0;
  }

  /** A run holds this session. A `running` one whose session has ended no longer does: nothing is left to restore (see the top of this file). */
  private isHeld(id: string): boolean {
    const h = this.held.get(id);
    if (!h) return false;
    if (h.phase !== 'running' || this.d.router.forAgent(id)?.isLive(id) === true) return true;
    this.held.delete(id);
    const a = this.d.agents.get(id);
    if (a) {
      a.runMode = undefined;
      this.d.changed?.(a, undefined);
    }
    return false;
  }
}

export interface ScheduleWiringDeps extends RunModeDeps {
  /** The session a schedule runs in now (`scheduleAgent` in main.ts). */
  agentOf(s: Pick<Schedule, 'folder' | 'target'>): AgentInfo | undefined;
  ensureLive(a: AgentInfo): Promise<void>;
  /** FR-183: from the last read (no wait); a read that failed is a refusal. */
  orgNow(a: AgentInfo, mode: PermMode): string | undefined;
  /** FR-183: after a fresh enough read; a read that failed is a refusal. */
  orgRun(a: AgentInfo, mode: PermMode): Promise<string | undefined>;
  noteSend(a: AgentInfo): void;
  noteSendFailed(a: AgentInfo): void;
  noteSent(a: AgentInfo): void;
  /** The chat's copy of the prompt and its note, in the same tick as the send. */
  announce(a: AgentInfo, s: Schedule, prompt: string, modeTurn: boolean): void;
  appName(app: string): string;
  agentName(a: AgentInfo): string;
  folderName(a: AgentInfo): string;
}

/** What a run sends back to the scheduler. */
export type RunSendResult = boolean | string | { refused: ModeRefusal } | { busy: true };

/** Main's wiring of a scheduled run, with nothing of Electron in it. Every dependency is one main already has. */
export function createScheduleWiring(d: ScheduleWiringDeps) {
  const runs = new RunModes(d);
  const send = async (s: Schedule, prompt: string): Promise<RunSendResult> => {
    const a = d.agentOf(s);
    const ad = a ? d.router.forAgent(a.id) : undefined;
    if (!a || !ad) return false;
    if (!runs.reserve(a.id)) return { busy: true };
    d.noteSend(a); // same as the interactive send: the window shows Thinking from the moment a prompt goes out
    let ok = false;
    let temp = false;
    let started = false;
    try {
      await d.ensureLive(a);
      // FR-183: a read of the policy at each run, once the session is there; `ensureLive` checks the session's own mode, not this one
      if (runMode(s.mode) && (await d.orgRun(a, s.mode))) {
        d.noteSendFailed(a);
        return { refused: 'mode-org' };
      }
      // from here to the adapter's send there is no await: the session cannot change hands
      const refused = runs.apply(a, s.mode);
      if (refused) {
        d.noteSendFailed(a);
        return refused === 'busy' ? { busy: true } : { refused };
      }
      temp = runs.hasTemp(a.id);
      d.announce(a, s, prompt, temp);
      // in a temporary mode the app may not keep the prompt for later (at a spending limit): it would run after the mode came back
      const msg: AgentMessage = temp ? { text: prompt, noHold: true } : { text: prompt };
      await (ad as AgentAdapter).send(a.id, msg);
      ok = true;
    } catch (err) {
      d.noteSendFailed(a);
      // the person's own limit: the app's notice has asked them, nothing was kept, and the schedule's next time goes if they raised it. A warning, never a stop
      if ((err as { code?: unknown } | undefined)?.code === 'at-limit') return { refused: 'mode-limit' };
      throw err;
    } finally {
      started = runs.settle(a.id, ok).started;
    }
    // a send that returned with no turn started: a sandbox hold or the like. The mode is back already; it was not sent, and the chat says why
    if (temp && !started) {
      d.noteSendFailed(a);
      throw new Error('The agent app did not start the turn.');
    }
    d.noteSent(a);
    return a.id;
  };
  return {
    runs,
    send,
    /** Other schedules wait while a run holds the session or a typed message is on its way. */
    busy: (id: string): boolean => d.statusBusy(id) || runs.busy(id),
    onStatus: (id: string, status: string): void => runs.onStatus(id, status),
    modeCheck: (s: Schedule): ModeVerdict => modeCheckOp({ router: d.router, orgNow: d.orgNow }, s, d.agentOf(s)),
    modeAgent: (s: Pick<Schedule, 'folder' | 'target'>): ModeAgentInfo | undefined => {
      const a = d.agentOf(s);
      const app = a ? d.router.adapterIdOf(a.id) : undefined;
      return a && app ? { app, appName: d.appName(app), agent: d.agentName(a), folderName: d.folderName(a) } : undefined;
    },
    orgWords: (s: Schedule, mode: ScheduleMode): string | undefined => {
      const a = d.agentOf(s);
      return a && runMode(mode) ? d.orgNow(a, mode) : undefined;
    },
    /** FR-183: reads the policy before a save looks at it: a save never decides on an empty cache. */
    primeMode: async (s: { folder: string; target?: ScheduleTarget }): Promise<void> => {
      const a = d.agentOf(s);
      if (a) await d.orgRun(a, 'read-only').catch(() => undefined);
    },
    /** The window's send: refused while a run holds the session, and counted while it is on its way, so a run cannot start under it. */
    userSend: async <T>(id: string, refused: (error: string) => T, go: () => Promise<T>): Promise<T> => {
      const no = runs.beginUserSend(id);
      if (no) return refused(no);
      try {
        return await go();
      } finally {
        runs.endUserSend(id);
      }
    },
  };
}
