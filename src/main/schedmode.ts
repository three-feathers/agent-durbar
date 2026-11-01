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
 * A person's Stop, End session or chosen mode (`end`) always wins, in any phase: the mode comes down and the session is free at once, whatever a call is doing.
 * - Only a status from after the send began counts: an ending status before any other status is left over from a start or a resume.
 * - A send that returns with no status of its own went nowhere (a sandbox hold, a spending limit): the mode comes back at once and it is not `sent`.
 * - A read never changes this. A session that is not live while its send is in flight is reopening (Codex) and stays held; `running` with no live
 *   session is the only state a look may clear, since the adapter then keeps no mode and the next start uses `a.permMode`.
 *
 * The temporary mode goes to the adapter only. It is never written to `a.permMode`, the folder's mode or the session's remembered mode, and never
 * through `setModeOp`, so a crash leaves nothing to undo: a restart starts the session in its own mode. `a.runMode` is what the window shows; not saved.
 */
import type { AdapterRouter } from '../adapters/router';
import { interruptOf, refusesLive, setPermModeOf } from '../adapters/router';
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
const raisedFor = (m: PermMode, a: AgentInfo): boolean => RANK[m] > (RANK[a.permMode] ?? 0);

/**
 * The check at a save and at each run (FR-182..FR-184), for the agent `a` that would run it now. No agent: undefined, and `send` reports
 * `no-agent` as before. Autopilot is the scheduler's (`modeBlock`): it never reaches this as a usable mode.
 */
export function modeCheckOp(d: { router: RunModeDeps['router']; orgNow?(a: AgentInfo, mode: PermMode, raised: boolean): string | undefined }, s: Pick<Schedule, 'mode' | 'modeFor' | 'target'>, a: AgentInfo | undefined): ModeVerdict {
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return undefined;
  const app = d.router.adapterIdOf(a.id);
  if (!s.modeFor || s.modeFor.app !== app || (s.modeFor.session ?? '') !== (s.target?.session ?? '')) return 'other-agent';
  if (!runMode(s.mode)) return 'mode-lacking';
  if (!ad.capabilities?.permissionModes?.includes(s.mode)) return 'mode-lacking';
  if (d.orgNow?.(a, s.mode, raisedFor(s.mode, a))) return 'mode-org';
  // the start options cannot carry it (they are the session's own mode), so an adapter that cannot switch runs only in that mode
  if (s.mode !== a.permMode && !ad.setPermMode) return 'mode-live';
  return undefined;
}

/** One scheduled run's hold on its session; `reserve` hands it out and the run's own code keeps it, so a late return can never touch a later run. */
export interface RunHold {
  phase: 'setup' | 'sending' | 'running';
  /** The temporary mode while it is on the adapter; undefined for a run in the session's own mode, and once it is back. */
  mode?: PermMode;
  /** A status other than an ending one came after the send began. */
  started: boolean;
  /** A person took over: this run no longer holds anything. */
  detached: boolean;
  /** A person typed a message after taking over: a turn now running may be theirs, so it is not interrupted. */
  typedSince: boolean;
  /** Rejects when a person takes over, so a run that waits on a hung call goes on. */
  readonly stopped: Promise<never>;
  stop(): void;
}

export const RUN_STOPPED = Symbol('run stopped');
const HELD_WORDS = 'A scheduled run is using this session. Wait for it to end, or stop it, then send your message.';

export class RunModes {
  private held = new Map<string, RunHold>();
  private typing = new Map<string, number>();
  /** Sends a person walked away from, by session. They may still be running inside the adapter: their return sets the mode right once more, and stops what they delivered. */
  private loose = new Map<string, Set<RunHold>>();
  constructor(private readonly d: RunModeDeps) {}

  /** The gate for a scheduled run: undefined when a typed message is on its way, another run holds the session or a send walked away from has not returned, or it is working. */
  reserve(id: string): RunHold | undefined {
    if (this.isHeld(id) || (this.typing.get(id) ?? 0) > 0 || (this.loose.get(id)?.size ?? 0) > 0 || this.d.statusBusy(id)) return undefined;
    let stop = (): void => undefined;
    const stopped = new Promise<never>((_r, rej) => { stop = () => rej(RUN_STOPPED); });
    stopped.catch(() => undefined);
    const h: RunHold = { phase: 'setup', started: false, detached: false, typedSince: false, stopped, stop };
    this.held.set(id, h);
    return h;
  }

  /** The gate for a typed message: why it is refused, or undefined with the send counted until `endUserSend`. */
  beginUserSend(id: string): string | undefined {
    if (this.isHeld(id)) return HELD_WORDS;
    const loose = this.loose.get(id);
    if (loose?.size) {
      // the session is closed while a send walked away from reopens it: a message now would start it with that send's options
      if (this.d.router.forAgent(id)?.isLive(id) !== true) return 'This session is reopening after a scheduled run was stopped. Send your message in a moment.';
      for (const h of loose) h.typedSince = true;
    }
    this.typing.set(id, (this.typing.get(id) ?? 0) + 1);
    return undefined;
  }

  endUserSend(id: string): void {
    const n = (this.typing.get(id) ?? 0) - 1;
    if (n > 0) this.typing.set(id, n);
    else this.typing.delete(id);
  }

  /**
   * Puts a reserved, live session in the schedule's mode; call it in the same tick as the send. Returns why it could not, and then nothing was sent or
   * changed. The mode the session already has needs no switch and nothing to restore. 'busy': a turn started during the setup, or a person stopped this run.
   */
  apply(a: AgentInfo, mode: ScheduleMode | undefined, h: RunHold): ModeRefusal | 'busy' | undefined {
    if (h.detached || this.held.get(a.id) !== h) return 'busy';
    const ad = this.d.router.forAgent(a.id);
    if (h.phase !== 'setup' || !ad || !ad.isLive(a.id)) return 'mode-live'; // a session that is gone would ignore the switch and start in its own mode
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

  /**
   * The run's own code finished waiting: the send returned or threw, or it stopped before sending (`ok` false). Returns whether a turn started. Only a run
   * whose mode is still on a turn that started stays held. A run a person took over has nothing left to do here.
   */
  settle(id: string, h: RunHold, ok: boolean): { started: boolean } {
    const started = h.started;
    if (h.detached || this.held.get(id) !== h) return { started };
    if (ok && started && h.mode !== undefined) {
      h.phase = 'running';
      return { started };
    }
    this.restore(id, h);
    this.held.delete(id);
    return { started };
  }

  /**
   * The adapter's send really returned. For a send a person walked away from: the mode is set right once more, and if it delivered the prompt that turn is
   * stopped, since the person stopped it. A message they typed since may be what runs now: it is left alone. After End (`forget`) there is nothing left to do.
   */
  sendReturned(id: string, h: RunHold, delivered: boolean): void {
    const loose = this.loose.get(id);
    if (!loose?.delete(h)) return;
    if (!loose.size) this.loose.delete(id);
    if (this.held.get(id)?.mode === undefined) this.putBack(id, false);
    const ad = this.d.router.forAgent(id);
    if (delivered && !h.typedSince && ad?.isLive(id)) void interruptOf(ad, id).catch(() => undefined);
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
   * A person took over: Stop, End session or a mode chosen during the turn. Whatever the phase, whatever an adapter's call is doing: the mode comes down now, the
   * session is free now and the run's own wait ends now. A send still inside the adapter cannot be called back: `sendReturned` sets the mode right when it returns.
   */
  end(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    h.detached = true;
    if (h.phase === 'sending') this.loose.set(id, (this.loose.get(id) ?? new Set<RunHold>()).add(h));
    this.restore(id, h, h.phase === 'sending');
    h.stop();
  }

  /** Back to the session's own mode. If the adapter throws here the session would keep the run's mode, so it is stopped: that is the one way left to be sure. */
  private restore(id: string, h: RunHold, reopening = false): void {
    const mode = h.mode;
    if (mode === undefined) return;
    h.mode = undefined;
    const a = this.d.agents.get(id);
    if (!a) return;
    a.runMode = undefined;
    this.d.changed?.(a, undefined);
    if (this.putBack(id, reopening)) this.d.log?.(a, `Back to ${WORDS[a.permMode] ?? a.permMode} after the scheduled run`, a.permMode);
  }

  /** A session that is not live needs nothing: its next start uses `a.permMode`. Unless its send is in flight (`reopening`): the adapter may be reopening it, and must hear. */
  private putBack(id: string, reopening: boolean): boolean {
    const a = this.d.agents.get(id);
    const ad = a ? this.d.router.forAgent(id) : undefined;
    if (!a || !ad || (!reopening && !ad.isLive(id))) return false;
    try {
      setPermModeOf(ad, id, a.permMode);
      return true;
    } catch {
      void Promise.resolve().then(() => ad.stop(id)).catch(() => undefined);
      return false;
    }
  }

  /** The session ended or its agent was removed: nothing of it stays, also not a hung send's count, or the session could never take a schedule again. */
  forget(id: string): void {
    this.end(id);
    this.typing.delete(id);
    this.loose.delete(id);
  }

  /** The mode the session's turn runs in when a run changed it, else undefined. Only reads. */
  modeOf(id: string): PermMode | undefined {
    return this.held.get(id)?.mode;
  }

  /** Other schedules count this session as busy: a run holds it, a typed message is on its way, or a send walked away from has not returned. */
  busy(id: string): boolean {
    return this.isHeld(id) || (this.typing.get(id) ?? 0) > 0 || (this.loose.get(id)?.size ?? 0) > 0;
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
  /** FR-183: from the last read (no wait). `raised`: above the session's own mode, where a policy Durbar could not read refuses too. */
  orgNow(a: AgentInfo, mode: PermMode, raised: boolean): string | undefined;
  /** FR-183: the same after a fresh enough read. */
  orgRun(a: AgentInfo, mode: PermMode, raised: boolean): Promise<string | undefined>;
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
    const h = runs.reserve(a.id);
    if (!h) return { busy: true };
    // a person's Stop or End ends this wait, whatever the call waited on is doing
    const unlessStopped = <T>(p: Promise<T>): Promise<T> => {
      p.catch(() => undefined);
      return Promise.race([p, h.stopped]);
    };
    d.noteSend(a); // same as the interactive send: the window shows Thinking from the moment a prompt goes out
    let ok = false;
    let temp = false;
    let started = false;
    try {
      await unlessStopped(d.ensureLive(a));
      // FR-183: a read of the policy at each run, once the session is there; `ensureLive` checks the session's own mode, not this one
      if (runMode(s.mode) && (await unlessStopped(d.orgRun(a, s.mode, raisedFor(s.mode, a))))) {
        d.noteSendFailed(a);
        return { refused: 'mode-org' };
      }
      // from here to the adapter's send there is no await: the session cannot change hands
      const refused = runs.apply(a, s.mode, h);
      if (refused) {
        d.noteSendFailed(a);
        return refused === 'busy' ? { busy: true } : { refused };
      }
      temp = h.mode !== undefined;
      d.announce(a, s, prompt, temp);
      // in a temporary mode the app may not keep the prompt for later (at a spending limit): it would run after the mode came back
      const msg: AgentMessage = temp ? { text: prompt, noHold: true } : { text: prompt };
      await unlessStopped((ad as AgentAdapter).send(a.id, msg).then(() => runs.sendReturned(a.id, h, true), (err: unknown) => {
        runs.sendReturned(a.id, h, false);
        throw err;
      }));
      ok = true;
    } catch (err) {
      d.noteSendFailed(a);
      if (err === RUN_STOPPED) {
        if (h.phase === 'setup') return { busy: true }; // Stop before the send: no mode was set and nothing goes out
        throw new Error('A person stopped this run.');
      }
      // the person's own limit: the app's notice has asked them, nothing was kept, and the schedule's next time goes if they raised it. A warning, never a stop
      if ((err as { code?: unknown } | undefined)?.code === 'at-limit') return { refused: 'mode-limit' };
      throw err;
    } finally {
      started = runs.settle(a.id, h, ok).started;
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
      return a && runMode(mode) ? d.orgNow(a, mode, raisedFor(mode, a)) : undefined;
    },
    /** FR-183: reads the policy before a save looks at it: a save never decides on an empty cache. */
    primeMode: async (s: { folder: string; target?: ScheduleTarget }): Promise<void> => {
      const a = d.agentOf(s);
      if (a) await d.orgRun(a, 'read-only', false).catch(() => undefined);
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
