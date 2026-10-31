/**
 * Spec 017 FR-015..FR-018 (review on #631): what the window can do with a door, without Electron so it can be unit-tested
 * (`npm run test:doors`). ipc/doors.ts only checks the frame and calls these.
 *
 * - Closing a door turns remote control off first (spec 054 FR-040); when that fails the door stays open and the window is told the truth.
 *   When it worked, main sends the existing `agents:remoteOff` event so the window drops its Remote chip.
 * - Send all releases held runs one by one through the Scheduler (`release`), which checks Pause all, the schedule, its limit and a busy
 *   agent and credits the run; a run that cannot go now stays held, in order.
 */
import type { Doors, HeldRun } from './doors';

export type ReleaseResult = 'sent' | 'busy' | 'paused-all' | 'paused' | 'cap' | 'ended' | 'updating' | 'gone' | 'mode' | 'failed';

export interface DoorOpsDeps {
  doors(): Doors | undefined;
  /** The stable key of a main session in this office (its resume id), or undefined for an unknown id. */
  keyOf(id: string): string | undefined;
  remote: { has(id: string): boolean; setRemote(id: string, on: boolean): Promise<{ ok: boolean; error?: string }> };
  /** Tells the window that remote control went off for this agent (the existing `agents:remoteOff` event). */
  remoteOff(id: string, reason: string): void;
  /** The scheduler's release path (Scheduler.releaseDoorRun). */
  release(run: HeldRun): Promise<ReleaseResult>;
  /** A scheduled run could not be kept because the door's queue is full (the window says so). */
  full?(id: string): void;
  /** Runs `fn` after main has noted a new status (defaults to setTimeout 0). */
  later?(fn: () => void): void;
  /** The doors changed (the window redraws). */
  changed(): void;
  /** Tells the window why Send all stopped (a run stays held). */
  stopped?(id: string, why: ReleaseResult): void;
}

export const REMOTE_OFF_REASON = 'the door is closed (Do not disturb)';

export function createDoorOps(deps: DoorOpsDeps) {
  const sending = new Set<string>();
  /** Sends the next held run of a releasing door when the scheduler lets it; stops (keeping the run held) when it may not go. */
  const pump = async (id: string): Promise<void> => {
    const d = deps.doors(), key = deps.keyOf(id);
    if (!d || !key || sending.has(key)) return;
    for (;;) {
      if (!d.releasing(key)) return;
      const run = d.peek(key);
      if (!run) return deps.changed();
      sending.add(key);
      let r: ReleaseResult;
      try {
        r = await deps.release(run).catch((): ReleaseResult => 'failed');
      } finally {
        sending.delete(key);
      }
      if (r === 'busy') return; // waits for the next idle (the agent's turn ended)
      if (r === 'sent' || r === 'gone') d.drop(key, run.id); // gone: its schedule was deleted by the user
      if (r !== 'sent' && r !== 'gone') {
        d.stopRelease(key);
        deps.changed();
        deps.stopped?.(id, r);
        return;
      }
      deps.changed();
      if (r === 'sent') return; // the next one goes when this turn has ended
    }
  };
  return {
    pump,
    /**
     * Spec 044 FR-110 (moved here from main.ts, review on #631): the scheduler's `hold` for the agent `id` of a due run. False when the
     * door is open (or the agent is unknown): the run goes as usual. True: queued at the closed door. 'full': the door is closed but its
     * queue is full, so the run is not kept and the window is told (never sent either).
     */
    hold(id: string | undefined, run: { at: number; prompt: string; scheduleId: string }): boolean | 'full' {
      const d = deps.doors(), key = id === undefined ? undefined : deps.keyOf(id);
      if (!d || !key || id === undefined || !d.isClosed(key)) return false;
      const r = d.hold(key, run);
      if (r === 'full') deps.full?.(id);
      deps.changed();
      return r === 'held' ? true : 'full';
    },
    /** A status event from the agents: when a main session's turn ended (idle), the next held run of a releasing door may go. */
    onStatus(e: { type: string; agentId?: string; sessionId: string; status?: string }): void {
      if (e.type !== 'status' || e.agentId || e.status !== 'idle' || deps.keyOf(e.sessionId) === undefined) return;
      (deps.later ?? ((fn) => void setTimeout(fn, 0)))(() => void pump(e.sessionId));
    },
    /** Closes or opens a door. Closing turns remote control off first; if that fails the door stays open. */
    async setDoor(id: string, closed: boolean): Promise<{ ok: true; closed: boolean; held: number; remoteOff?: boolean } | { ok: false; error: string }> {
      const d = deps.doors(), key = deps.keyOf(id);
      if (!d || !key) return { ok: false, error: 'invalid request' };
      let remoteOff = false;
      if (closed && deps.remote.has(id)) {
        const r = await deps.remote.setRemote(id, false).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        if (!r || !r.ok) return { ok: false, error: 'Remote control could not be turned off, so the door stays open' + (r && r.error ? ': ' + String(r.error).slice(0, 200) : '.') };
        remoteOff = true;
        deps.remoteOff(id, REMOTE_OFF_REASON);
      }
      const v = d.setClosed(key, closed);
      if (!v) return { ok: false, error: 'Could not change the door.' };
      deps.changed();
      return { ok: true, ...v, ...(remoteOff ? { remoteOff: true } : {}) };
    },
    /** Send all (one by one, through the scheduler) or Discard, at an open door. */
    async release(id: string, action: 'send' | 'discard'): Promise<{ ok: true; queued?: number; discarded?: number } | { ok: false; error: string }> {
      const d = deps.doors(), key = deps.keyOf(id);
      if (!d || !key) return { ok: false, error: 'invalid request' };
      if (d.isClosed(key)) return { ok: false, error: 'Open the door first.' };
      if (action === 'discard') {
        const n = d.discard(key);
        deps.changed();
        return { ok: true, discarded: n };
      }
      const n = d.view(key).held;
      if (!d.arm(key)) return { ok: true, queued: 0 };
      deps.changed();
      await pump(id);
      return { ok: true, queued: n };
    },
    /** The held prompts of a door, for the window's Send all dialog (it masks and cuts them). */
    held(id: string): { prompt: string; at: number }[] {
      const d = deps.doors(), key = deps.keyOf(id);
      return d && key ? d.held(key).map((r) => ({ prompt: r.prompt, at: r.at })) : [];
    },
  };
}
