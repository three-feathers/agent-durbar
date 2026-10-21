/** IPC for sessions and agents: list, add, send, stop, end, new session, mode, cap, limit, pause, remove, wake, permissions, git status, open in VS Code (spec 045 FR-060; moved out of main.ts as it was). */
import { dialog } from 'electron';
import { fromAppFrame as fromApp, ipcHandle, ipcOn } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import { historyOf } from '../../adapters/router';
import type { AddResult, AgentInfo, PickedFile, ResumeResult, SessionOptions } from '../../shared/api';
import { parseAmount, parseCapIn } from '../../shared/credits';
import { errText, setCapOp, setModeOp, stopTurnOp, validMode } from '../agentops';
import type { OpsDeps } from '../agentops';
import { folderGitStatus } from '../gitstatus';
import type { GitStatus } from '../gitstatus';
import { applySetPaused } from '../mcp/agentstate';
import type { AgentStateTracker } from '../mcp/agentstate';
import type { CheckpointStore } from '../checkpoints';
import type { createRemoteOps } from '../remoteops';
import type { Scheduler } from '../schedules';
import { openInVSCode } from '../vscode';
import type { AddWorkspace, EnsureLive, SendOp } from './types';

export interface AgentsIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  agentState: AgentStateTracker;
  /** The handler bodies that refuse a setting a live session cannot take (agentops.ts). */
  opsDeps: OpsDeps;
  remoteOps: ReturnType<typeof createRemoteOps>;
  getScheduler(): Scheduler | undefined;
  getCheckpointStore(): CheckpointStore | undefined;
  /** Per agent: the VS Code chat files last listed; dropped when the agent goes (previous.ts fills it). */
  vsChatRefs: Map<string, unknown>;
  /** Spec 006 FR-021: agents restored as their folder's last session, how that went, until their chat asks for it. */
  continued: Map<string, { resumed: boolean; title?: string }>;
  wsKey(a: AgentInfo): string;
  asEffort(v: unknown): string | undefined;
  addMany(paths: string[], permMode: AgentInfo['permMode'], opts?: SessionOptions & { persist?: boolean }): Promise<AddResult>;
  addWorkspace: AddWorkspace;
  sendOp: SendOp;
  ensureLive: EnsureLive;
  readyAdapterIds(): Promise<ReadonlySet<string>>;
  forgetOpenSession(key: string, id: string): void;
}

export function register(deps: AgentsIpcDeps): void {
  const { agents, router, agentState, opsDeps, remoteOps, wsKey, asEffort, addMany, addWorkspace, sendOp, ensureLive, readyAdapterIds, forgetOpenSession, vsChatRefs, continued } = deps;
  const scheduler = deps.getScheduler;
  const checkpointStore = deps.getCheckpointStore;
  ipcHandle('agents:list', () => [...agents.values()]);
  const sessionOpts = (o: unknown): SessionOptions & { persist: boolean } => {
    const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    const cap = x.maxAiCredits === null ? null : parseAmount(x.maxAiCredits); // checked in the adapter's unit by addWorkspace
    return { model: typeof x.model === 'string' ? x.model.slice(0, 100) : undefined, effort: asEffort(x.effort), maxAiCredits: cap, floor: typeof x.floor === 'string' ? x.floor.slice(0, 20) : undefined, adapterId: typeof x.adapterId === 'string' ? x.adapterId.slice(0, 40) : undefined, persist: true };
  };

  ipcHandle('agents:addFolder', async (_e, mode: unknown, opts: unknown) => {
    const r = await dialog.showOpenDialog({ title: 'Add folder', properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode), sessionOpts(opts));
  });

  ipcHandle('agents:addWorkspaceFile', async (_e, mode: unknown, opts: unknown) => {
    const r = await dialog.showOpenDialog({
      title: 'Add .code-workspace file',
      properties: ['openFile'],
      filters: [{ name: 'VS Code workspace', extensions: ['code-workspace'] }],
    });
    return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode), sessionOpts(opts));
  });
  ipcHandle('agents:send', async (_e, id: string, text: string, attachments: PickedFile[]) => {
    const ad = agents.has(id) ? router.forAgent(id) : undefined;
    if (!ad) return { ok: false, error: 'unknown agent' };
    agentState.ensure(id, agents.get(id)?.lazy);
    agentState.noteSend(id); // the window shows Thinking from the moment the user sends (app.js sendLive)
    const r = await sendOp(id, text, attachments, ad);
    if (!r.ok) agentState.noteSendFailed(id); // and Error when the send fails (app.js sendLive)
    return r;
  });
  // Stop only interrupts the running turn (the agent returns to Ready); End session frees the runtime session.
  ipcHandle('agents:stop', (_e, id: string) => stopTurnOp(opsDeps, id));

  ipcHandle('agents:end', async (_e, id: string) => {
    if (!agents.has(id)) return;
    await remoteOps.release(id); // spec 054 FR-011: off on GitHub too before the session ends
    await router.forAgent(id)?.stop(id);
  });

  ipcHandle('agents:newSession', async (_e, id: unknown, opts: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, error: 'unknown agent' };
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
    try {
      const mode = o.permMode === undefined ? a.permMode : validMode(o.permMode);
      // The dialog's kind (FR-059); none = the current agent's kind. A kind the user picked must be ready (FR-058).
      const picked = typeof o.adapterId === 'string' ? o.adapterId.slice(0, 40) : undefined;
      const readyIds = picked !== undefined ? await readyAdapterIds() : undefined;
      const agent = await addWorkspace(wsKey(a), mode, { model: typeof o.model === 'string' ? o.model.slice(0, 100) : picked !== undefined && picked !== router.adapterIdOf(a.id) ? undefined : a.model, effort: asEffort(o.effort) ?? undefined, maxAiCredits: o.maxAiCredits === null ? null : parseAmount(o.maxAiCredits), adapterId: picked ?? router.adapterIdOf(a.id), readyIds });
      return { ok: true, agent };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
  ipcHandle('agents:setCap', async (_e, id: unknown, credits: unknown) => {
    return setCapOp(opsDeps, id, credits);
  });
  ipcHandle('agents:resolveLimit', async (_e, id: unknown, requestId: unknown, choice: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad || typeof requestId !== 'string' || !ad.isLive(a.id)) return { ok: false, error: 'unknown agent' };
    const c = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>;
    const add = parseAmount(c.credits);
    const setTo = parseCapIn(ad.capabilities?.capUnit, c.credits);
    const action = c.kind === 'add' && add ? { kind: 'add' as const, credits: add } : c.kind === 'set' && setTo ? { kind: 'set' as const, credits: setTo } : c.kind === 'unset' ? { kind: 'unset' as const } : c.kind === 'cancel' ? { kind: 'cancel' as const } : undefined;
    if (!action) return { ok: false, error: 'Invalid choice.' };
    try {
      await ad.resolveLimit?.(a.id, requestId, action);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
  ipcHandle('agents:setMode', (e, id: unknown, mode: unknown, opts: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    // spec 054 FR-011: Allow all and remote control never together (anyone steering on GitHub could run commands unasked)
    if (mode === 'allow' && typeof id === 'string' && remoteOps.has(id)) return { ok: false, error: 'Stop remote control first: Allow all and remote control from GitHub are never on together.' };
    return setModeOp(opsDeps, id, mode, opts);
  });
  // One-way from the window: the pause button (spec 041 T014). Unknown ids and non-boolean values are ignored.
  ipcOn('agents:setPaused', (_e, id: unknown, paused: unknown) => {
    applySetPaused(agentState, (k) => agents.get(k), id, paused);
  });

  // One main session out of the office (spec 006 FR-017). The last main session of a folder stays (Folders > Remove is for that).
  ipcHandle('agents:remove', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, error: 'unknown session' };
    const key = wsKey(a);
    if ([...agents.values()].filter((x) => wsKey(x) === key).length < 2) return { ok: false, error: 'This is the only session in the folder. Remove the folder from Folders instead.' };
    forgetOpenSession(key, a.id); // FR-020 and spec 052 FR-088: a removed session does not come back after a restart
    try {
      await remoteOps.release(a.id); // spec 054 FR-011
      await router.forAgent(a.id)?.stop(a.id); // the history stays on disk and is listed under Previous sessions
    } catch {
      /* already gone */
    }
    router.unbind(a.id);
    checkpointStore()?.forget(a.id); // spec 065 FR-006
    agents.delete(a.id);
    agentState.remove(a.id);
    vsChatRefs.delete(a.id);
    scheduler()?.sessionsChanged(); // spec 044 FR-014: a schedule for this session pauses and says so
    return { ok: true };
  });
  /** Spec 006 FR-021: the chat of a restored agent was opened; start it now (a resume sends no prompt) and hand back what came back. */
  ipcHandle('agents:wake', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    try {
      await ensureLive(a);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const c = continued.get(a.id);
    continued.delete(a.id);
    if (!c) return { ok: true };
    if (!c.resumed) return { ok: true, resumed: false };
    let history: NonNullable<ResumeResult['history']>;
    try {
      history = await historyOf(ad, a.id);
    } catch {
      history = { items: [], total: 0, truncated: false };
    }
    return { ok: true, resumed: true, history, title: c.title };
  });

  ipcHandle('agents:resolvePermission', (_e, id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean) => {
    if (agents.has(id)) router.forAgent(id)?.resolvePermission?.(id, String(requestId), approve === true, approve === true && remember === true, approve === true && remember === true && broad === true);
  });

  ipcHandle('agents:revokeGrant', (_e, id: string, key: string) => {
    if (agents.has(id)) router.forAgent(id)?.revokeGrant?.(id, String(key));
  });

  // spec 063: the git branch and changed files of an agent's own folder (read-only; the window never passes a path)
  ipcHandle('agents:gitStatus', async (e, id: unknown): Promise<GitStatus> => {
    const a = fromApp(e) && typeof id === 'string' ? agents.get(id) : undefined;
    return a && a.cwd ? folderGitStatus(a.cwd) : { repo: false };
  });
  ipcHandle('agents:openInVSCode', (_e, id: string) => {
    const a = agents.get(id);
    // Only paths of agents we started: the workspace file if there is one, else the folder.
    return a ? openInVSCode(a.workspaceFile ?? a.cwd) : { ok: false, error: 'unknown agent' };
  });
}
