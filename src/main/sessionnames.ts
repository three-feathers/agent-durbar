/**
 * Renaming a session (spec 059 FR-013, FR-007, FR-010, FR-011): validation, the agent-app call, the saved entry. Pure of Electron: every
 * dependency is injected, so tests use fakes. Main validates everything; the window only sends an agent id, an optional session id and
 * the name.
 */
import { cut, redact } from '../shared/redact';
import { checkDisplayName } from '../shared/names';
import { renameTarget, syncEntry } from '../shared/sessionname';
import type { RenameCap, SessionNameEntry } from '../shared/sessionname';
import { SESSION_NAME_ID } from './folders';

export type RenameResult = { ok: true; name?: string; inApp: boolean; pending?: boolean; note?: string } | { ok: false; error: string };

/** What the op needs to know about an office agent (a subset of `AgentInfo`). */
export interface RenameAgent {
  id: string;
  adapterId?: string;
  /** Restored from the saved list and not started yet. */
  lazy?: boolean;
  /** Restored as the folder's earlier session (it exists in the agent app). */
  resumeLast?: boolean;
}

export interface RenameAdapter {
  displayName: string;
  capabilities?: { renameSession?: RenameCap };
  renameSession?(sessionId: string, name: string): Promise<void>;
}

export interface RenameDeps {
  agent(id: string): RenameAgent | undefined;
  adapter(agentId: string): RenameAdapter | undefined;
  /** The id the agent's session has in its agent app (Codex: the thread id). */
  resumeIdFor(agentId: string): string;
  /** Resume ids of the other office agents of the same folder and adapter. */
  otherOpenIds(agentId: string): string[];
  /** Ids of the folder's previous sessions of the agent's adapter (re-checked, never trusted from the window). */
  previousIds(agentId: string): Promise<string[]>;
  /** Saves (or, with `name` undefined, removes) the entry; false when it could not be written. */
  save(agentId: string, src: string, id: string, name: string | undefined, flags: { inApp: boolean; pending: boolean }): boolean;
  /** Sets or clears `alias` on every office agent with that session and tells the windows. */
  applyAlias(agentId: string, id: string, alias: string | undefined): void;
}

const inFlight = new Set<string>();
const SRC_DEFAULT = 'copilot';

export function renameOp(deps: RenameDeps): (agentId: unknown, sessionId: unknown, name: unknown) => Promise<RenameResult> {
  return async (agentId, sessionId, name) => {
    const a = typeof agentId === 'string' ? deps.agent(agentId) : undefined;
    const ad = a ? deps.adapter(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'Unknown session.' };
    if (typeof name !== 'string') return { ok: false, error: 'Use 1 to 60 characters.' };
    const check = checkDisplayName(name);
    if (!check.ok) return { ok: false, error: check.error };
    const src = a.adapterId ?? SRC_DEFAULT;

    let rid: string;
    if (sessionId === null || sessionId === undefined) rid = deps.resumeIdFor(a.id);
    else {
      if (typeof sessionId !== 'string' || !SESSION_NAME_ID.test(sessionId)) return { ok: false, error: 'Unknown session.' };
      const own = deps.resumeIdFor(a.id);
      let known = sessionId === own || deps.otherOpenIds(a.id).includes(sessionId);
      if (!known) known = (await deps.previousIds(a.id).catch(() => [] as string[])).includes(sessionId);
      if (!known) return { ok: false, error: 'That session is no longer available for this folder.' };
      rid = sessionId;
    }
    if (!SESSION_NAME_ID.test(rid)) return { ok: false, error: 'Unknown session.' };

    const key = `${src}:${rid}`;
    if (inFlight.has(key)) return { ok: false, error: 'Already renaming this session.' };
    inFlight.add(key);
    try {
      if (!check.name) {
        // reset: only Durbar's copy goes; the agent app keeps its last name
        if (!deps.save(a.id, src, rid, undefined, { inApp: false, pending: false })) return { ok: false, error: 'Could not rename the session.' };
        deps.applyAlias(a.id, rid, undefined);
        return { ok: true, inApp: false };
      }
      const cap = ad.capabilities?.renameSession;
      const target = renameTarget(cap);
      // a never-started card has no session in the agent app yet: its name stays Durbar's
      const inAppSession = !(rid === deps.resumeIdFor(a.id) && a.lazy && !a.resumeLast);
      let inApp = false;
      let pending = false;
      let note: string | undefined;
      if (target !== 'durbar' && typeof ad.renameSession === 'function' && inAppSession) {
        try {
          await ad.renameSession(rid, check.name);
          inApp = target === 'now';
          pending = target === 'next-turn';
        } catch (err) {
          const why = cut(redact(err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim(), 120);
          note = `Renamed in Agent Durbar only. ${ad.displayName} did not accept the name${why ? `: ${why}` : ''}.`;
        }
      }
      if (!deps.save(a.id, src, rid, check.name, { inApp, pending })) return { ok: false, error: 'Could not rename the session.' };
      deps.applyAlias(a.id, rid, check.name);
      return { ok: true, name: check.name, inApp, ...(pending ? { pending } : {}), ...(note ? { note } : {}) };
    } finally {
      inFlight.delete(key);
    }
  };
}

/**
 * FR-011: a runtime title arrived for a session. Returns what to do with its entry: nothing, a changed entry (pending became inApp) or a
 * dropped one (the app's name differs now). Pure over the entry.
 */
export function titleSyncOf(entry: SessionNameEntry | undefined, title: string): { action: 'none' } | { action: 'update'; entry: SessionNameEntry } | { action: 'drop' } {
  if (!entry) return { action: 'none' };
  const next = syncEntry(entry, title);
  if (!next) return { action: 'drop' };
  if (next.inApp !== entry.inApp || next.pending !== entry.pending) return { action: 'update', entry: next };
  return { action: 'none' };
}
