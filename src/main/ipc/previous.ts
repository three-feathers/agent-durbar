/**
 * IPC for the previous sessions of a folder (Copilot CLI/SDK store, resumable) and the VS Code chat history (read-only): list, pin/hide, delete, resume (spec 006 FR-024..FR-032;
 * moved out of main.ts as it was, spec 045 FR-060). The renderer only ever names an agent and an opaque id; folders and file paths are resolved here.
 */
import { ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import { historyOf, previousSessionsOf } from '../../adapters/router';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AgentInfo, ResumeResult, VsChatListResult } from '../../shared/api';
import { VSCODE_CHAT_FORMAT_NOTE, listChats, readChat, vscodeUserDirs } from '../../adapters/vscodeChat';
import type { ChatFileRef, UserDir } from '../../adapters/vscodeChat';
import { errText, resumeModeOp } from '../agentops';
import type { DevEnv } from '../devhooks';
import type { FolderStore } from '../folders';
import type { AgentStateTracker } from '../mcp/agentstate';
import { ALREADY_DELETING, BEING_OPENED, PrevSessions, listPreviousOp, markOp, marksFor, openIdsOf } from '../prevsessions';
import type { PrevDeps } from '../prevsessions';
import type { Scheduler } from '../schedules';
import type { ActivityDecision } from '../../shared/activity';
import type { AddWorkspace } from './types';

export interface PreviousIpcDeps {
  dev: DevEnv;
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  registry: AdapterRegistry;
  agentState: AgentStateTracker;
  /** Created when the app is ready: read when a handler runs. */
  getFolderStore(): FolderStore | undefined;
  getScheduler(): Scheduler | undefined;
  wsKey(a: AgentInfo): string;
  resumeIdFor(id: string): string;
  forgetOpenSession(key: string, id: string): void;
  logActivity(a: AgentInfo, decision: ActivityDecision, action: string): void;
  addWorkspace: AddWorkspace;
  /** Per agent: the VS Code chat files last listed (shared with the handlers that remove an agent). */
  vsChatRefs: Map<string, Map<string, ChatFileRef>>;
}

export function register(deps: PreviousIpcDeps): void {
  const { dev, agents, router, registry, agentState, wsKey, resumeIdFor, forgetOpenSession, logActivity, addWorkspace, vsChatRefs } = deps;
  const folderStore = deps.getFolderStore;
  const scheduler = deps.getScheduler;
  // ---- Previous sessions of a folder (Copilot CLI/SDK store, resumable) and VS Code chat history (read-only) ----
  // The renderer only ever names an agent and an opaque id; folders and file paths are resolved here.
  const vsUserDirs = (): UserDir[] =>
    dev.DURBAR_VSCODE_USER_DIR ? [{ product: 'Test', dir: dev.DURBAR_VSCODE_USER_DIR }] : vscodeUserDirs();

  // Spec 006 FR-024..FR-032: the list, pin/hide and delete bodies live in prevsessions.ts. `sessions:delete` exists only here, on the
  // window's own IPC (ipcHandle): the MCP tools, remote control, schedules and agents have no path to it (scripts/test-prevsessions.ts).
  const prevDeps: PrevDeps = { agents, router, get store() { return folderStore(); }, wsKey, resumeIdFor: (id) => resumeIdFor(id), appName: (a) => registry.get(a.adapterId)?.displayName ?? a.adapterId, log: (a, decision, action) => logActivity(a, decision, action) };
  const prevSessions = new PrevSessions(prevDeps);
  ipcHandle('sessions:listPrevious', (_e, id: unknown) => listPreviousOp(prevDeps, id));
  ipcHandle('sessions:mark', (_e, id: unknown, src: unknown, sessionId: unknown, mark: unknown) => markOp(prevDeps, id, src, sessionId, mark));
  ipcHandle('sessions:delete', (_e, id: unknown, sessionId: unknown) => prevSessions.delete(id, sessionId));

  ipcHandle('sessions:resume', async (_e, id: unknown, sessionId: unknown, replace: unknown): Promise<ResumeResult> => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    if (typeof sessionId !== 'string' || openIdsOf(prevDeps).has(sessionId)) return { ok: false, error: 'That session is already open.' }; // by Durbar id and resume id (FR-032)
    if (!prevSessions.beginResume(sessionId)) return { ok: false, error: prevSessions.isDeleting(sessionId) ? ALREADY_DELETING : BEING_OPENED }; // FR-029 step 5
    try {
      // Only sessions that belong to this agent's folder can be resumed (re-checked here, not trusted from the UI).
      const prev = (await previousSessionsOf(ad, a.cwd, openIdsOf(prevDeps))).find((s) => s.id === sessionId);
      if (!prev) return { ok: false, error: 'That session is no longer available for this folder.' };
      // Resume first; only then retire the untouched agent, so a failed resume leaves everything as it was.
      // Spec 003 (2026-10-21): the session comes back in the mode last chosen for it, not in the mode of the session the list was opened from.
    const rm = resumeModeOp(folderStore()?.get(wsKey(a)), sessionId, a.permMode);
    const info = await addWorkspace(a.workspaceFile ?? a.cwd, rm.mode, { resumeSessionId: sessionId, silent: true, adapterId: router.adapterIdOf(a.id) });
    info.permFrom = rm.permFrom;
    info.permRestored = rm.permRestored;
    const modeWas = rm.modeWas;
    if (rm.logLine) logActivity(info, 'mode-change', rm.logLine);
      let history: ResumeResult['history'];
      try {
        history = await historyOf(router.forAgent(info.id) ?? ad, info.id);
      } catch {
        history = { items: [], total: 0, truncated: false };
      }
      let removedId: string | undefined;
      folderStore()?.addOpenSession(wsKey(info), resumeIdFor(info.id), router.adapterIdOf(info.id)); // spec 052 FR-088: a resumed session is open in the folder and comes back after a restart
      if (replace === true) {
        removedId = id as string;
        forgetOpenSession(wsKey(a), removedId);
        await ad.stop(removedId);
        router.unbind(removedId);
        agents.delete(removedId);
        agentState.remove(removedId);
        scheduler()?.sessionsChanged(); // spec 044 FR-014: a schedule for the replaced session pauses
      }
      if (prev.title && prev.title !== 'Untitled session') info.title = prev.title; // the list's title (name, else summary) until the runtime sends its own
      return { ok: true, agent: info, removedId, title: prev.title, history, ...(modeWas ? { modeWas } : {}) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    } finally {
      prevSessions.endResume(sessionId);
    }
  });

  ipcHandle('vschat:list', async (_e, id: unknown): Promise<VsChatListResult> => {
    const empty = { sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0, formatNote: VSCODE_CHAT_FORMAT_NOTE };
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, error: 'unknown agent', ...empty };
    try {
      const l = await listChats(vsUserDirs(), { folders: a.folders, workspaceFile: a.workspaceFile });
      vsChatRefs.set(a.id, new Map(l.sessions.map((r) => [r.summary.key, r])));
      return { ok: true, sessions: l.sessions.map((r) => r.summary), ...marksFor(prevDeps, a, 'vscode', l.sessions.map((r) => r.summary.key)), storesFound: l.storesFound, unreadable: l.unreadable, tooLarge: l.tooLarge, formatNote: VSCODE_CHAT_FORMAT_NOTE };
    } catch (err) {
      return { ok: false, error: errText(err), ...empty };
    }
  });

  ipcHandle('vschat:read', async (_e, id: unknown, key: unknown) => {
    const ref = typeof id === 'string' && typeof key === 'string' ? vsChatRefs.get(id)?.get(key) : undefined;
    if (!ref) return { ok: false, error: 'That chat is not in the list any more. Reopen the list and try again.' };
    return readChat(ref);
  });
}
