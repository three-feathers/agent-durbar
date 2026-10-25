/**
 * Spec 081 FR-013, plan D5: the update lock and the session gate.
 *
 * The lock is taken the moment *Update…* is chosen, BEFORE the sessions are counted, and held to the end of the run (or a cancel).
 * While it is held nothing of that app can start or resume (`blocksStart`), so a session cannot slip in between the count and the
 * run. Messages and scheduled prompts to sessions that are still open are not blocked: *Update when they end* waits for exactly
 * those sessions to finish their work. After the native confirmation the sessions are counted again; a session that is open by
 * then sends the user back to the gate dialog.
 *
 * Pure of Electron: sessions, the confirmation and the run are injected.
 */
import type { SetupKind } from '../shared/harnesssetup';
import type { PolicyView } from '../shared/updatecheck';

/**
 * FR-013, the one rule for every call site in main (`addWorkspace`, `ensureLive`, the scheduler's `heldBy`): a session that is
 * already open (live) is never held; anything that would start or resume a session of an app whose update holds the lock is.
 * Returns the reason to show, or undefined.
 */
export function startHeldBy(o: { locked: boolean; live: boolean; name: string }, how: 'start' | 'schedule'): string | undefined {
  if (!o.locked || o.live) return undefined;
  return how === 'schedule' ? `${o.name} is updating` : `${o.name} is being updated. Try again when the update has finished.`;
}

/** FR-022: an update the organization does not allow is refused in main, whatever the window sends. */
export function updateRunRefusal(pv: Pick<PolicyView, 'installBlocked' | 'checkHidden'>): string | undefined {
  return pv.installBlocked ? 'Updates are managed by your organization.' : undefined;
}

/** How long a lock may wait for the window's answer to the open-sessions dialog before it is released (review on #721). */
export const ASK_LIMIT_MS = 10 * 60_000;

export type GateChoice = 'wait' | 'end' | 'cancel';
export interface SessionCount { open: number; busy: number; pendingPermissions: number; heldPrompts: number }
/** What the run step answers: the harness result, or `recount` when sessions were open after the confirmation. */
export interface RunReply { ok: boolean; error?: string; cancelled?: boolean; recount?: boolean; [k: string]: unknown }

export interface GateDeps {
  count(kind: SetupKind): SessionCount;
  /** Interrupts each running turn (`stopTurnOp`), then ends each session (`endSessionOp`), for the app's sessions. */
  endAll(kind: SetupKind): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  /** The waiting map or the lock changed: tell the window. */
  changed(): void;
  /** A waiting update ended without a window call to answer (confirmation cancelled, an error): tell the window the way a finished run does. */
  failed(kind: SetupKind, r: RunReply): void;
  /** The lock was released: scheduled prompts held for the app may go. */
  released?(kind: SetupKind): void;
}

type Phase = 'asking' | 'waiting' | 'running';
export const WAIT_POLL_MS = 1500;

export class UpdateGate {
  private locks = new Map<SetupKind, { phase: Phase; timer?: unknown; askTimer?: unknown }>();
  constructor(private readonly d: GateDeps) {}

  /** True while an update of the app holds the lock: no start, no resume of that app's sessions (FR-013). */
  blocksStart(kind: SetupKind): boolean {
    return this.locks.has(kind);
  }

  /** The apps with an update waiting for sessions to end, with how many are open. */
  waiting(): Partial<Record<SetupKind, number>> {
    const out: Partial<Record<SetupKind, number>> = {};
    for (const [k, l] of this.locks) if (l.phase === 'waiting') out[k] = this.d.count(k).open;
    return out;
  }

  /** Releases the lock (a finished run, a failed start, a cancel, quit). */
  release(kind: SetupKind): void {
    const l = this.locks.get(kind);
    if (!l) return;
    if (l.timer !== undefined) this.d.clearTimer(l.timer);
    if (l.askTimer !== undefined) this.d.clearTimer(l.askTimer);
    this.locks.delete(kind);
    this.d.released?.(kind);
    this.d.changed();
  }

  releaseAll(): void {
    for (const k of [...this.locks.keys()]) this.release(k);
  }

  /**
   * Review on #721: a lock that waits for the window's answer (the open-sessions dialog) is released when that window reloads or
   * goes away, since its answer can never come. A waiting or running update keeps its lock (main finishes it on its own).
   */
  releaseAsking(): void {
    for (const [k, l] of [...this.locks]) if (l.phase === 'asking') this.release(k);
  }

  /** The lock is in the asking phase: it is released after ASK_LIMIT_MS without an answer. */
  private asking(kind: SetupKind): void {
    const l = this.locks.get(kind);
    if (!l) return;
    l.phase = 'asking';
    if (l.askTimer !== undefined) this.d.clearTimer(l.askTimer);
    l.askTimer = this.d.setTimer(() => { const cur = this.locks.get(kind); if (cur === l && l.phase === 'asking') { l.askTimer = undefined; this.release(kind); } }, ASK_LIMIT_MS);
  }

  private leaveAsking(l: { askTimer?: unknown }): void {
    if (l.askTimer !== undefined) { this.d.clearTimer(l.askTimer); l.askTimer = undefined; }
  }

  /**
   * One *Update…* request. `gate` is undefined on the first call, then the user's answer to the gate dialog.
   * `proceed` is the rest (fresh check, prepare, native confirmation, then `recount()`, then start).
   */
  async request(kind: SetupKind, gate: GateChoice | undefined, proceed: (recount: () => number) => Promise<RunReply>): Promise<RunReply | { ok: false; needsGate: SessionCount } | { ok: true; waiting: number }> {
    const cur = this.locks.get(kind);
    if (gate === 'cancel') {
      this.release(kind);
      return { ok: false, cancelled: true, error: 'Cancelled.' };
    }
    if (!cur) {
      if (gate !== undefined) return { ok: false, error: 'invalid request' };
      this.locks.set(kind, { phase: 'asking' });
      this.asking(kind);
    } else if (gate === undefined || cur.phase !== 'asking') {
      return { ok: false, error: 'An update of that app is already waiting or running.' };
    }
    const lock = this.locks.get(kind) as { phase: Phase; timer?: unknown; askTimer?: unknown };
    const c = this.d.count(kind);
    if (c.open > 0) {
      if (gate === undefined) return { ok: false, needsGate: c };
      if (gate === 'wait') {
        this.leaveAsking(lock);
        lock.phase = 'waiting';
        this.poll(kind, proceed);
        this.d.changed();
        return { ok: true, waiting: c.open };
      }
      // 'end': interrupt each turn, then end each session; they stay resumable
      try { await this.d.endAll(kind); } catch { /* the count below decides */ }
    }
    return this.go(kind, proceed);
  }

  private async go(kind: SetupKind, proceed: (recount: () => number) => Promise<RunReply>): Promise<RunReply | { ok: false; needsGate: SessionCount }> {
    const lock = this.locks.get(kind);
    if (!lock) return { ok: false, cancelled: true, error: 'Cancelled.' };
    this.leaveAsking(lock);
    lock.phase = 'running';
    let r: RunReply;
    try { r = await proceed(() => this.d.count(kind).open); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    if (r.recount) {
      // a session was open after the confirmation: the lock stays and the gate dialog comes back
      if (this.locks.has(kind)) this.asking(kind);
      return { ok: false, needsGate: this.d.count(kind) };
    }
    // started: the lock is held until the run ends (`release` from the done event); anything else frees it now
    if (!r.ok) this.release(kind);
    else this.d.changed();
    return r;
  }

  private poll(kind: SetupKind, proceed: (recount: () => number) => Promise<RunReply>): void {
    const lock = this.locks.get(kind);
    if (!lock) return;
    lock.timer = this.d.setTimer(() => {
      lock.timer = undefined;
      if (this.locks.get(kind) !== lock || lock.phase !== 'waiting') return;
      if (this.d.count(kind).open > 0) { this.d.changed(); this.poll(kind, proceed); return; }
      // the last session ended: the native confirmation comes again, and consent is given at the moment of running
      void this.go(kind, proceed).then((r) => {
        if ('needsGate' in r) { const l = this.locks.get(kind); if (l) { this.leaveAsking(l); l.phase = 'waiting'; this.poll(kind, proceed); } return; }
        if (!r.ok) this.d.failed(kind, r);
      });
    }, WAIT_POLL_MS);
  }
}
