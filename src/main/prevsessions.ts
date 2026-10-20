/**
 * Previous sessions: list, pin/hide and delete (spec 006 FR-024..FR-032). The bodies of the IPC handlers live here, with injected
 * agents, router, store and log, so they are tested with the fake adapter and no Electron.
 *
 * Delete goes only through the agent app's own API (`AgentAdapter.deleteSession`): Durbar never removes, moves or rewrites a session
 * file (constitution III). `sessions:delete` is registered ONLY in `main.ts` through `ipcHandle` (the window's own page); nothing
 * here is reachable from the MCP read/change tools, remote control, schedules or any agent-driven path (`test-prevsessions.ts` pins it).
 * Everything the window sends is an id, checked against a strict allow-list (`src/shared/sessionid.ts`); no path crosses the IPC.
 */
import type { AdapterRouter } from '../adapters/router';
import { deleteSessionOf, previousSessionsOf } from '../adapters/router';
import type { PreviousSession } from '../adapters/history';
import type { AgentInfo } from '../shared/api';
import { markIdOk, sessionIdOk } from '../shared/sessionid';
import type { FolderStore, PrevMarkOp } from './folders';

export interface PrevDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent' | 'adapterIdOf'>;
  store?: Pick<FolderStore, 'get' | 'markPrevious' | 'dropPrevious' | 'removeOpenSession'>;
  wsKey(a: AgentInfo): string;
  /** The id a session is resumed under (Codex: its thread id). */
  resumeIdFor(id: string): string;
  /** The adapter's display name for the activity row ("GitHub Copilot", ...). */
  appName(a: AgentInfo): string;
  /** Local activity log (FR-031): recorded here, in main, never by the window. */
  log?(a: AgentInfo, decision: 'session-deleted', action: string): void;
}

export interface PrevMarks {
  pinned: string[];
  hidden: string[];
}

export type DeleteResult = { ok: true } | { ok: false; error: string; code?: 'in-office'; agentId?: string };

export const NO_DELETE = 'This agent app cannot delete sessions. Hide it instead.';
export const IN_OFFICE = 'This session is still in the office. End it and remove it from the office first.';
export const NOT_AVAILABLE = 'That session is no longer available for this folder.';
export const ALREADY_DELETING = 'Already deleting this session.';
export const BEING_OPENED = 'This session is being opened.';

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) || 'unknown error';

/** Ids of the sessions that have a card in the office: Durbar ids and resume ids (FR-032). */
export function openIdsOf(d: Pick<PrevDeps, 'agents' | 'resumeIdFor'>): Set<string> {
  const out = new Set<string>();
  for (const id of d.agents.keys()) {
    out.add(id);
    out.add(d.resumeIdFor(id));
  }
  return out;
}

/** The pins and hides of the agent's folder for `src`, filtered to the ids present in the result (FR-026). */
export function marksFor(d: Pick<PrevDeps, 'store' | 'wsKey'>, a: AgentInfo, src: string, present: Iterable<string>): PrevMarks {
  const f = d.store?.get(d.wsKey(a));
  const here = new Set(present);
  const pick = (l: Array<{ src: string; id: string }> | undefined): string[] => (l ?? []).filter((x) => x.src === src && here.has(x.id)).map((x) => x.id);
  return { pinned: pick(f?.prevPinned), hidden: pick(f?.prevHidden) };
}

/** `sessions:listPrevious`: open sessions are left out by Durbar id and by resume id (FR-032). */
export async function listPreviousOp(d: PrevDeps, id: unknown): Promise<{ ok: boolean; error?: string; sessions: PreviousSession[]; pinned: string[]; hidden: string[] }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent', sessions: [], pinned: [], hidden: [] };
  try {
    const sessions = await previousSessionsOf(ad, a.cwd, openIdsOf(d));
    return { ok: true, sessions, ...marksFor(d, a, d.router.adapterIdOf(a.id) ?? '', sessions.map((s) => s.id)) };
  } catch (err) {
    return { ok: false, error: errText(err), sessions: [], pinned: [], hidden: [] };
  }
}

/** `sessions:mark`: pin, unpin, hide or unhide one row. `src` must be the agent's own adapter or `vscode`; the id passes the strict allow-list. */
export function markOp(d: PrevDeps, id: unknown, src: unknown, sessionId: unknown, mark: unknown): { ok: boolean; error?: string } {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || !d.router.forAgent(a.id)) return { ok: false, error: 'unknown agent' };
  if (src !== 'vscode' && src !== d.router.adapterIdOf(a.id)) return { ok: false, error: 'unknown source' };
  if (!markIdOk(src, sessionId)) return { ok: false, error: 'That is not a session id.' };
  if (mark !== 'pin' && mark !== 'unpin' && mark !== 'hide' && mark !== 'unhide') return { ok: false, error: 'unknown action' };
  return d.store?.markPrevious(d.wsKey(a), src, sessionId, mark as PrevMarkOp) ? { ok: true } : { ok: false, error: 'That folder is not saved.' };
}

/** The in-flight guard shared by delete and resume of the same id (FR-029 step 5). */
export class PrevSessions {
  private readonly deleting = new Set<string>();
  private readonly resuming = new Set<string>();
  constructor(private readonly d: PrevDeps) {}

  /** True while `sessions:delete` runs on this id; `sessions:resume` refuses it. */
  isDeleting(sessionId: string): boolean {
    return this.deleting.has(sessionId);
  }

  /** `sessions:resume` takes the id for its duration; false = refuse (a delete of it is running, or another resume). Call `endResume` in a `finally`. */
  beginResume(sessionId: string): boolean {
    if (this.deleting.has(sessionId) || this.resuming.has(sessionId)) return false;
    this.resuming.add(sessionId);
    return true;
  }

  endResume(sessionId: string): void {
    this.resuming.delete(sessionId);
  }

  /** `sessions:delete`, in the order of FR-029. Any failure changes nothing and writes no activity row. */
  async delete(id: unknown, sessionId: unknown): Promise<DeleteResult> {
    const d = this.d;
    const a = typeof id === 'string' ? d.agents.get(id) : undefined;
    const ad = a ? d.router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    // 1. the adapter has the capability (flag and member agree, spec 012 FR-027)
    if (!ad.capabilities.deleteSession || !ad.deleteSession) return { ok: false, error: NO_DELETE };
    // 2. the id passes the strict allow-list before anything else sees it
    const adapterId = d.router.adapterIdOf(a.id) ?? ad.id;
    if (!sessionIdOk(adapterId, sessionId)) return { ok: false, error: 'That is not a session id.' };
    // 3. refused while the session has a card in the office (Durbar id or resume id), or is live in the adapter
    for (const other of d.agents.values()) {
      if (other.id === sessionId || d.resumeIdFor(other.id) === sessionId) return { ok: false, code: 'in-office', agentId: other.id, error: IN_OFFICE };
    }
    if (ad.isLive(sessionId)) return { ok: false, code: 'in-office', error: IN_OFFICE };
    // 5 (checked early so a second click never reaches the adapter twice)
    if (this.deleting.has(sessionId)) return { ok: false, error: ALREADY_DELETING };
    if (this.resuming.has(sessionId)) return { ok: false, error: BEING_OPENED };
    this.deleting.add(sessionId);
    try {
      // 4. still among this folder's previous sessions of that adapter (the same re-check as resume)
      let prev: PreviousSession | undefined;
      try {
        prev = (await previousSessionsOf(ad, a.cwd, openIdsOf(d))).find((s) => s.id === sessionId);
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
      if (!prev) return { ok: false, error: NOT_AVAILABLE };
      // 6. the adapter's own API; an error leaves everything as it was
      try {
        await deleteSessionOf(ad, sessionId);
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
      // 7. forget its marks (and any saved last/open session), log once, no title
      const key = d.wsKey(a);
      d.store?.dropPrevious(key, adapterId, sessionId);
      d.store?.removeOpenSession(key, sessionId);
      d.log?.(a, 'session-deleted', `Session deleted · ${d.appName(a)} · ${sessionId.slice(0, 8)} · last used ${isoDay(prev.modifiedTime)}`);
      return { ok: true };
    } finally {
      this.deleting.delete(sessionId);
    }
  }
}

/** `YYYY-MM-DD` (UTC) of a time in ms; `unknown date` when there is none. */
function isoDay(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : 'unknown date';
}
