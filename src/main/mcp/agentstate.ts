/**
 * Spec 041 T014 (FR-011, D-c): the office's own state word and sub-label for every agent, kept in main from the normalized
 * adapter events, so a read tool answers exactly what the window shows. Pure: no Electron, no timers, no adapter calls.
 *
 * The rules are a COPY of the renderer's (src/renderer/app.js); the two can drift, so scripts/test-mcp-agentstate.ts holds one
 * table row per rule and checks that the renderer source still contains each copied fragment. Where each rule comes from
 * (line numbers of the renderer at the time of writing; the test pins the text, not the numbers):
 *   words           app.js:204  LABELS; app.js:206-207  vis() and label() (Paused hides the state and the sub-label)
 *   new agent       app.js:1169 (Idle; sub-label Not started when lazy, else none)
 *   status working  app.js:1651   only when not already Working or Thinking; the sub-label is cleared
 *   needs-permission app.js:1653       Waiting
 *   idle (Aborted)  app.js:1656-1661   Idle; worked flag cleared
 *   idle            app.js:1662-1663   Done when the turn did work, else Idle
 *   error / stopped app.js:1667, 1673   Error / Idle, Ended
 *   limit           app.js:1679 (exhausted: Waiting, Coffee break, spec 068), 1550-1551 (resolved: cancel = Idle; else Working)
 *   usageLimit      spec 068 startCoffee: Waiting, Coffee break; only the turn's closing idle ('Usage limit reached', then one plain idle) keeps it;
 *                   any other idle or error, working, thinking, stopped, Aborted or a send end it; a late `update` after the break ended is ignored
 *   question        app.js:1683 (asked: Waiting), 1542 (answered or cancelled: Working, only if waiting)
 *   thinking        app.js:1688  Thinking
 *   output          app.js:1689  Working
 *   toolCall start  app.js:1693  Thinking becomes Working, ANY OTHER state is kept (Waiting stays Waiting); sub-label cleared
 *   user send       app.js:1708 (noteSend: Thinking from any state, work started); a failed send app.js:1710 (noteSendFailed: Error)
 * Events with an `agentId` (helpers) never change the main agent (app.js:1644 hands them to the sub-agent card); the demo-only
 * renderer paths are not adapter events.
 */
import type { AgentEvent } from '../../adapters/types';

export type OfficeState = 'working' | 'thinking' | 'waiting' | 'idle' | 'error' | 'done';
export type OfficeWord = 'Working' | 'Thinking' | 'Waiting' | 'Idle' | 'Error' | 'Done' | 'Paused';

/** app.js:204 */
const LABELS: Record<OfficeState, OfficeWord> = { working: 'Working', thinking: 'Thinking', waiting: 'Waiting', idle: 'Idle', error: 'Error', done: 'Done' };

export interface AgentStateView {
  /** The word the office shows ("Paused" when the window paused the agent). */
  word: OfficeWord;
  /** The sub-label the office shows next to it (Not started, Ended, Limit reached, Done, ...), or null; null while paused. */
  subLabel: string | null;
  /** The state behind the word (app.js:206 `vis`: a paused agent reads as idle). */
  state: OfficeState;
  paused: boolean;
}

interface Entry { state: OfficeState; label: string | null; paused: boolean; worked: boolean; limit: boolean; limitId?: string; question: boolean; questionId?: string; /** spec 068: on a coffee break (a usage limit of the agent app) */ coffee?: boolean; /** spec 068: the break's turn has closed ('Usage limit reached') */ coffeeShut?: boolean }

export class AgentStateTracker {
  private readonly agents = new Map<string, Entry>();

  /** Start tracking an agent (a new or restored one: Idle; Not started when it is a saved folder with no session yet). Keeps an existing entry. */
  ensure(id: string, lazy = false): void {
    if (!this.agents.has(id)) this.agents.set(id, { state: 'idle', label: lazy ? 'Not started' : null, paused: false, worked: false, limit: false, question: false });
  }

  remove(id: string): void {
    this.agents.delete(id);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  /** Window-only flag (the pause button). False when the agent is unknown. */
  setPaused(id: string, paused: boolean): boolean {
    const a = this.agents.get(id);
    if (!a) return false;
    a.paused = paused;
    return true;
  }

  /** The window forgot every pause (a fresh page starts unpaused). */
  clearPaused(): void {
    for (const a of this.agents.values()) a.paused = false;
  }

  /** The user sent a message (app.js:1708 sendLive, before the runtime answers): Thinking from any state, sub-label cleared, work started. */
  noteSend(id: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    a.worked = true;
    a.coffee = false; // spec 068: a message ends the coffee break
    a.state = 'thinking';
    a.label = null;
  }

  /** The send was refused or failed (app.js:1710): Error, sub-label cleared. */
  noteSendFailed(id: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    a.state = 'error';
    a.label = null;
  }

  /** Spec 058 FR-022: working, thinking or waiting, also while the window shows it paused (a pause hides the state, it does not end the turn). */
  isBusy(id: string): boolean {
    const st = this.agents.get(id)?.state;
    return st === 'working' || st === 'thinking' || st === 'waiting';
  }

  /** Spec 068 FR-008: on a coffee break (a usage limit of the agent app, or Durbar's own cap): a scheduled run is skipped, never sent. */
  onBreak(id: string): boolean {
    const a = this.agents.get(id);
    return !!a && (!!a.coffee || a.limit);
  }

  get(id: string): AgentStateView | undefined {
    const a = this.agents.get(id);
    if (!a) return undefined;
    // app.js:206-207
    if (a.paused) return { word: 'Paused', subLabel: null, state: 'idle', paused: true };
    return { word: LABELS[a.state], subLabel: a.label, state: a.state, paused: false };
  }

  /** Feed one normalized event; events of an agent that is not tracked are ignored (the renderer drops them too). */
  onEvent(e: AgentEvent): void {
    const a = this.agents.get(e.sessionId);
    if (!a) return;
    if (e.agentId && e.type !== 'limit') return; // helper events belong to the sub-agent card (limit is never a helper's)
    const set = (state: OfficeState, label: string | null): void => { a.state = state; a.label = label; };
    switch (e.type) {
      case 'status':
        // spec 068 (app.js onLiveEvent, 2026-10-22): only the turn's closing status keeps the break ('Usage limit reached', then at most
        // one plain idle of the same turn); any other idle or error means the turn went on after the limit: the break ends, shown as usual
        if (a.coffee) {
          if (e.status === 'idle' && e.intent === 'Usage limit reached') { a.worked = false; a.coffeeShut = true; return; }
          if (e.status === 'idle' && !e.intent && a.coffeeShut) { a.coffeeShut = false; a.worked = false; return; }
          if (e.status === 'idle' && !e.intent) a.worked = true; // the turn went on and finished: Done
          a.coffeeShut = false;
        }
        if (e.status === 'working' || e.status === 'stopped' || e.status === 'idle' || e.status === 'error') a.coffee = false;
        if (e.status === 'working') {
          a.worked = true;
          if (a.state !== 'working' && a.state !== 'thinking') set('working', null);
        } else if (e.status === 'needs-permission') {
          set('waiting', null);
        } else if (e.status === 'idle' && e.intent === 'Aborted') {
          a.limit = false; // settleLimit('cancel'), then the Aborted state itself
          a.limitId = undefined;
          a.question = false;
          a.questionId = undefined;
          a.worked = false;
          set('idle', null);
        } else if (e.status === 'idle') {
          const was = a.worked;
          a.worked = false;
          if (was) set('done', 'Done'); else set('idle', null);
        } else if (e.status === 'error') {
          set('error', null);
        } else if (e.status === 'stopped') {
          if (a.limit) a.worked = false; // settleLimit('cancel') clears the work flag (app.js:1550)
          a.limit = false;
          a.limitId = undefined;
          set('idle', 'Ended');
        }
        return;
      case 'limit':
        if (e.phase === 'exhausted') {
          if (a.limit && a.limitId === e.requestId) return; // ids compared as the renderer does: undefined equals undefined
          a.limit = true;
          a.limitId = e.requestId;
          set('waiting', 'Coffee break'); // spec 068 Q2: Durbar's own spending limit is a coffee break too
        } else if (e.phase === 'resolved' && a.limit && a.limitId === e.requestId) {
          a.limit = false;
          a.limitId = undefined;
          if ((e.action || 'add') === 'cancel') { a.worked = false; set('idle', null); } else set('working', null);
        }
        return;
      case 'usageLimit':
        // spec 068 FR-004: a usage limit of the agent app: Waiting, Coffee break (app.js startCoffee); a late update of a break that already ended is ignored
        if (e.update && !a.coffee) return;
        if (!a.coffee) a.coffeeShut = false;
        a.coffee = true;
        a.worked = false;
        set('waiting', 'Coffee break');
        return;
      case 'question':
        if (e.phase === 'asked') {
          if (a.question && a.questionId === e.requestId) return;
          a.question = true;
          a.questionId = e.requestId;
          set('waiting', null);
        } else if (a.question && a.questionId === e.requestId) {
          a.question = false;
          a.questionId = undefined;
          if (a.state === 'waiting') set('working', null);
        }
        return;
      case 'thinking':
        a.coffee = false;
        set('thinking', null);
        return;
      case 'output':
        if (a.coffee || a.limit) return; // spec 068: text after a usage limit (or at Durbar's cap) does not end the coffee break
        set('working', null);
        return;
      case 'toolCall':
        // app.js:1693: the sub-agent task tools are the sub-agent card's business ('task' and 'agent', app.js:1375)
        if (a.coffee || a.limit) return; // spec 068: the coffee break keeps its word
        if (e.phase === 'start' && e.tool !== 'task' && e.tool !== 'agent') set(a.state === 'thinking' ? 'working' : a.state, null);
        return;
      default:
        return;
    }
  }
}

/** The window's pause button (agents:setPaused): unknown ids and non-boolean values are ignored; true pauses, false clears. Returns whether it changed anything. */
export function applySetPaused(tracker: AgentStateTracker, lookup: (id: string) => { id: string; lazy?: boolean } | undefined, id: unknown, paused: unknown): boolean {
  const a = typeof id === 'string' ? lookup(id) : undefined;
  if (!a || typeof paused !== 'boolean') return false;
  tracker.ensure(a.id, a.lazy);
  return tracker.setPaused(a.id, paused);
}
