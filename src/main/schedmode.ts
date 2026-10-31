/**
 * Spec 044 FR-180..FR-184: a scheduled run's own mode, for one turn. No Electron, no files: unit-tested with a fake adapter (`test:schedules`).
 *
 * The temporary mode goes to the adapter only (`setPermModeOf`). It is never written to `a.permMode`, the folder's mode or the session's
 * remembered mode, and never through `setModeOp`, so nothing has to be undone after a crash: a restart starts the session in its own mode.
 * It lives in memory here until the turn ends, its send fails or the session ends.
 */
import type { AdapterRouter } from '../adapters/router';
import { refusesLive, setPermModeOf } from '../adapters/router';
import type { AgentInfo, PermMode } from '../shared/api';
import type { ModeRefusal, ModeVerdict, Schedule, ScheduleMode } from './schedules';

export interface RunModeDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent' | 'adapterIdOf'>;
  /** Spec 076 FR-203: `OpsDeps.orgRefusal`, the same check `setModeOp` makes. */
  orgRefusal?(a: AgentInfo, mode: PermMode): string | undefined;
  /** Spec 052 FR-071: one row when the mode changes for a run and one when it comes back. No prompt text. */
  log?(a: AgentInfo, action: string, mode: PermMode): void;
}

const WORDS: Record<PermMode, string> = { 'read-only': 'Read-only', ask: 'Ask first', allow: 'Allow all' };
const RANK: Record<PermMode, number> = { 'read-only': 0, ask: 1, allow: 2 };
const runMode = (m: ScheduleMode | undefined): m is PermMode => m === 'read-only' || m === 'ask' || m === 'allow';

/**
 * The check at a save and at each run (FR-182..FR-184), for the agent `a` that would run it now. No agent: undefined, and `send` reports
 * `no-agent` as before. Autopilot is the scheduler's (`modeBlock`): it never reaches this as a usable mode.
 */
export function modeCheckOp(d: Pick<RunModeDeps, 'router' | 'orgRefusal'>, s: Pick<Schedule, 'mode' | 'modeFor' | 'target'>, a: AgentInfo | undefined): ModeVerdict {
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return undefined;
  const app = d.router.adapterIdOf(a.id);
  if (!s.modeFor || s.modeFor.app !== app || (s.modeFor.session ?? '') !== (s.target?.session ?? '')) return 'other-agent';
  if (!runMode(s.mode)) return 'mode-lacking';
  if (!ad.capabilities?.permissionModes?.includes(s.mode)) return 'mode-lacking';
  if (d.orgRefusal?.(a, s.mode)) return 'mode-org';
  // the start options cannot carry it (they are the session's own mode), so an adapter that cannot switch runs only in that mode
  if (s.mode !== a.permMode && !ad.setPermMode) return 'mode-live';
  return undefined;
}

interface TempMode {
  mode: PermMode;
  /** Status events since `apply`: any status but an ending one means the turn started; only then, or once the send returned, an ending one ends it. */
  started: boolean;
  sent: boolean;
}

export class RunModes {
  private temp = new Map<string, TempMode>();
  constructor(private readonly d: RunModeDeps) {}

  /**
   * Puts a live session in the schedule's mode for one turn; call it right before the send. Returns why it could not, and then nothing was
   * sent or changed. The mode the session already has needs no switch and nothing to restore.
   */
  apply(a: AgentInfo, mode: ScheduleMode | undefined): ModeRefusal | undefined {
    const ad = this.d.router.forAgent(a.id);
    if (!ad || !runMode(mode)) return 'mode-lacking';
    if (this.temp.has(a.id) || !ad.isLive(a.id)) return 'mode-live'; // never stacked on another run's mode; a session that is gone would ignore the switch and start in its own mode
    if (mode === a.permMode) return undefined;
    try {
      const r = setPermModeOf(ad, a.id, mode);
      if (refusesLive(ad, a.id, r.applied)) return 'mode-live';
    } catch {
      return 'mode-live';
    }
    this.temp.set(a.id, { mode, started: false, sent: false });
    this.d.log?.(a, `Scheduled run: ${WORDS[mode]} for this turn`, mode);
    return undefined;
  }

  /** The send was accepted: from here an ending status ends the temporary mode even if no other status came. */
  sent(id: string): void {
    const t = this.temp.get(id);
    if (t) t.sent = true;
  }

  /** A main session's status. A leftover `idle` from before the send (a start, a resume) must not end the mode before the turn has begun. */
  onStatus(id: string, status: string): void {
    const t = this.temp.get(id);
    if (!t) return;
    if (status !== 'idle' && status !== 'error' && status !== 'stopped') {
      t.started = true;
      return;
    }
    if (t.started || t.sent) this.end(id);
  }

  /**
   * Back to the session's own mode: the turn ended, the send failed or the session ended. Always `a.permMode` as it is now, so a mode the user
   * chose during the turn stands. A session that is gone needs nothing: its next start uses `a.permMode`. If the adapter throws here the session
   * would keep the run's mode, so the session is stopped: that is the one way left to be sure.
   */
  end(id: string): void {
    const t = this.temp.get(id);
    if (!t) return;
    this.temp.delete(id);
    const a = this.d.agents.get(id);
    const ad = a ? this.d.router.forAgent(id) : undefined;
    if (!a || !ad || !ad.isLive(id)) return;
    try {
      setPermModeOf(ad, id, a.permMode);
      this.d.log?.(a, `Back to ${WORDS[a.permMode] ?? a.permMode} after the scheduled run`, a.permMode);
    } catch {
      void Promise.resolve().then(() => ad.stop(id)).catch(() => undefined);
    }
  }

  /** The removed agent: its adapter state is gone with it. */
  forget(id: string): void {
    this.temp.delete(id);
  }

  /** The mode a session's running turn has when a run changed it, else undefined. Reads the session: an ended one no longer has it. */
  modeOf(id: string): PermMode | undefined {
    const t = this.temp.get(id);
    if (!t) return undefined;
    if (this.d.router.forAgent(id)?.isLive(id) !== true) {
      this.temp.delete(id);
      return undefined;
    }
    return t.mode;
  }

  /** A run holds this session in its mode: other schedules wait (FR-180: "that one turn"), counted as busy. */
  holds(id: string): boolean {
    return this.modeOf(id) !== undefined;
  }

  /**
   * What a message typed by the user during such a turn would do. Fail closed: it would run with more power than the session has, so while
   * that turn runs it is refused; a session whose run ended without a status comes back first. A run in less power than the session is no risk.
   */
  userSendRefusal(id: string, busy: boolean): string | undefined {
    const m = this.modeOf(id);
    const a = this.d.agents.get(id);
    if (m === undefined || !a) return undefined;
    if (!busy) {
      this.end(id);
      return undefined;
    }
    if ((RANK[m] ?? 2) <= (RANK[a.permMode] ?? 0)) return undefined;
    return `A scheduled run is using ${WORDS[m]} for this turn. Wait for it to end, or stop it, then send your message.`;
  }
}
