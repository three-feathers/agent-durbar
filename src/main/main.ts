import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter } from '../adapters/copilot';
import type { AgentAdapter } from '../adapters/types';
import { resolveWorkspaceCwd } from '../adapters/workspace';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, fmtSize, stageAttachment } from '../shared/attachments';
import type { AddResult, AgentInfo, ModelChoice, PermMode, PickedFile, ResumeResult, SessionOptions, VsChatListResult } from '../shared/api';
import { openInVSCode } from './vscode';
import { isHttpUrl } from '../shared/url';
import { FolderStore, restoreMode } from './folders';
import { VSCODE_CHAT_FORMAT_NOTE, listChats, readChat, vscodeUserDirs } from '../adapters/vscodeChat';
import type { ChatFileRef, UserDir } from '../adapters/vscodeChat';
import { McpStore } from './mcpstore';
import { registerMcpIpc, safeStorageCodec } from './mcpipc';
import { UsageStore } from './usagestore';
import { agentLabel } from '../shared/toolusage';
import { devEnv, devWarning } from './devhooks';
import { SettingsStore } from './settings';
import { parseAmount, parseCap } from '../shared/credits';
import { aboutPanelOptions, aboutView } from '../shared/about';
import { modelControlFor, parseFocus, parseSwitchRequest } from '../shared/modelswitch';
import type { ModelSwitchRequest } from '../shared/modelswitch';

// Developer/test hooks (spec 010): ignored in packaged builds unless DURBAR_DEV=1. Read hooks only from `dev`.
const dev = devEnv(process.env, app.isPackaged);
const devNote = devWarning(process.env, app.isPackaged);
if (devNote) console.error(devNote);

// Cheapest routing on the logged-in account's only model ("auto"); see docs/milestone-1.md.
// Dev/test: DURBAR_USER_DATA=/tmp/x keeps the saved folder list (and Electron's other state) out of the real profile.
if (dev.DURBAR_USER_DATA) app.setPath('userData', dev.DURBAR_USER_DATA);
const DEFAULT_MODEL = 'auto';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];
const asEffort = (v: unknown): Effort | undefined => (EFFORTS as readonly string[]).includes(v as string) ? (v as Effort) : undefined;
let folderStore: FolderStore | undefined;
/** Global settings (default credit cap, spec 011), created when the app is ready. */
let settingsStore: SettingsStore | undefined;
/** Global MCP servers (spec 019), created when the app is ready (needs userData and safeStorage). */
let mcpStore: McpStore | undefined;
/** All-time tool usage (spec 020), created when the app is ready. */
let usageStore: UsageStore | undefined;
/** The folder (or .code-workspace file) an agent belongs to; the key of the saved folder list. */
const wsKey = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

const adapter = new CopilotAdapter();
/** The same adapter through the adapter-neutral interface: its optional members (`setModel`, `compact`, ...) say what it can do (spec 030 FR-017). */
const generic: AgentAdapter = adapter;
const agents = new Map<string, AgentInfo>();
const mcp = registerMcpIpc({ store: () => mcpStore as McpStore, agents, adapter, dev });
/** Files the user picked through the native dialog; only these can be attached. */
const pickedFiles = new Set<string>();
/** Private folder for pasted / dropped files (removed on quit). */
let stageDir: string | undefined;
const getStageDir = (): string => (stageDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'agent-durbar-att-')));
const sizeOf = (p: string): number | undefined => {
  try {
    return fs.statSync(p).size;
  } catch {
    return undefined;
  }
};
let win: BrowserWindow | undefined;

const toRenderer = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

adapter.onEvent((e) => toRenderer('agent:event', e));
/** Key an agent's all-time counts are kept under: "<agent name> · <folder name>" (base name only, spec 020). */
const usageLabel = (a: AgentInfo): string => agentLabel(a.name, a.workspaceFile ? path.basename(a.workspaceFile).replace(/\.code-workspace$/i, '') : a.cwd);
// All-time tool usage is counted here, not in the window, so it also counts while the Tools view is closed (spec 020 FR-006).
adapter.onEvent((e) => {
  if (e.type !== 'toolCall') return;
  const a = agents.get(e.sessionId);
  if (a) usageStore?.record(usageLabel(a), e);
});
// The runtime confirms the cap now in force (also after a change made by another client): keep AgentInfo and the folder's saved cap in step.
adapter.onEvent((e) => {
  if (e.type !== 'limit' || e.phase !== 'changed') return;
  const a = agents.get(e.sessionId);
  if (!a) return;
  a.maxAiCredits = parseCap(e.maxAiCredits);
  folderStore?.setMaxAiCredits(wsKey(a), a.maxAiCredits);
});

/** Keep AgentInfo in step with the model the runtime reports. Only a switch the user asked for is saved with the folder; a runtime fallback (rate limit, refusal) is shown but never becomes the folder's choice (spec 030 FR-015). */
adapter.onEvent((e) => {
  if (e.type !== 'model' || e.agentId) return;
  const a = agents.get(e.sessionId);
  if (!a) return;
  a.model = e.model;
  if (e.effort !== undefined) a.effort = e.effort;
  a.tier = e.tier === 'long' ? 'long' : undefined;
  if (e.cause === 'user') folderStore?.setModelChoice(wsKey(a), { model: e.model, effort: e.effort, contextTier: a.tier });
});

// Dev/test: DURBAR_LOG=/path/events.jsonl records every normalized event and what is sent to the SDK.
if (dev.DURBAR_LOG) {
  const logFile = dev.DURBAR_LOG;
  const write = (o: unknown): void => fs.appendFileSync(logFile, JSON.stringify(o) + '\n');
  adapter.onEvent((e) => write({ t: Date.now(), event: e }));
  adapter.debug = (m) => write({ t: Date.now(), debug: m });
}

ipcMain.handle('app:openExternal', async (_e, url: unknown) => {
  if (!isHttpUrl(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

const infoFor = (workspace: string, permMode: PermMode, id: string, model: string, effort: string | undefined, extra: Partial<AgentInfo> = {}): AgentInfo => {
  const ws = resolveWorkspaceCwd(workspace);
  return {
    id,
    name: path.basename(ws.workspaceFile ?? ws.cwd).replace(/\.code-workspace$/, ''),
    cwd: ws.cwd,
    workspaceFile: ws.workspaceFile,
    folders: ws.folders,
    permMode,
    model,
    effort,
    modelControl: modelControlFor(generic),
    ...extra,
  };
};

const startOptionsFor = (a: AgentInfo) => ({
  workspace: wsKey(a),
  model: a.model ?? DEFAULT_MODEL,
  reasoningEffort: asEffort(a.effort),
  autoTier: (a.model ?? DEFAULT_MODEL) === 'auto' ? ('efficiency' as const) : undefined,
  allow: a.permMode === 'allow',
  ask: a.permMode === 'ask',
  maxAiCredits: a.maxAiCredits,
  ...mcp.optionsFor(a.id),
});

async function addWorkspace(
  workspace: string,
  permMode: PermMode,
  opts: { resumeSessionId?: string; silent?: boolean; model?: string; effort?: string; persist?: boolean; maxAiCredits?: number | null } = {},
): Promise<AgentInfo> {
  const model = opts.model || DEFAULT_MODEL;
  const effort = asEffort(opts.effort);
  const draft = infoFor(workspace, permMode, '', model, effort);
  // Cap: explicit choice (null = none) > the folder's saved cap > the global default (spec 011).
  draft.maxAiCredits = opts.maxAiCredits === null ? undefined : (opts.maxAiCredits ?? folderStore?.get(wsKey(draft))?.maxAiCredits ?? settingsStore?.defaultMaxAiCredits);
  const id = await adapter.start({ ...startOptionsFor(draft), resumeSessionId: opts.resumeSessionId });
  const info: AgentInfo = { ...draft, id, hidden: folderStore?.get(wsKey(draft))?.hidden, closed: folderStore?.get(wsKey(draft))?.closed };
  agents.set(id, info);
  if (opts.persist) folderStore?.upsert({ workspace: wsKey(info), permMode, model, effort, maxAiCredits: info.maxAiCredits });
  if (!opts.silent) toRenderer('agent:added', info);
  return info;
}

/** Make sure the agent has a live runtime session: resume it by id when it has history, else start one under that id. */
const starting = new Map<string, Promise<void>>();
async function ensureLive(a: AgentInfo): Promise<void> {
  if (adapter.isLive(a.id)) return;
  let p = starting.get(a.id);
  if (!p) {
    p = adapter.start({ ...startOptionsFor(a), sessionId: a.id, quiet: true }).then(() => {
      a.lazy = false;
    });
    starting.set(a.id, p);
    void p.finally(() => starting.delete(a.id)).catch(() => undefined);
  }
  await p;
}

async function addMany(paths: string[], permMode: PermMode, opts: SessionOptions & { persist?: boolean } = {}): Promise<AddResult> {
  const added: AgentInfo[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    try {
      added.push(await addWorkspace(p, permMode, { model: opts.model, effort: opts.effort, persist: opts.persist, maxAiCredits: opts.maxAiCredits }));
    } catch (err) {
      errors.push(`${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: errors.length === 0, agents: added, error: errors.join('; ') || undefined };
}

/** Folders remembered from earlier runs come back as "not started" agents: nothing runs until the first message. */
function restoreFolders(): void {
  if (!folderStore) return;
  for (const f of folderStore.load()) {
    try {
      if (!fs.existsSync(f.workspace)) continue; // e.g. an unplugged drive: stays saved, just not shown
      const rm = restoreMode(f.permMode); // exactly as saved, Allow all included, flagged so the UI shows "restored" (spec 003 FR-025/026)
      const info = infoFor(f.workspace, rm.mode, randomUUID(), f.model || DEFAULT_MODEL, f.effort, { lazy: true, tier: f.contextTier, hidden: f.hidden, closed: f.closed, permRestored: rm.restored || undefined, maxAiCredits: f.maxAiCredits ?? settingsStore?.defaultMaxAiCredits });
      agents.set(info.id, info);
    } catch {
      /* folder gone or not a folder any more */
    }
  }
}

const validMode = (m: unknown): PermMode => (m === 'ask' || m === 'allow' ? m : 'read-only');

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('agents:list', () => [...agents.values()]);

const sessionOpts = (o: unknown): SessionOptions & { persist: boolean } => {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const cap = x.maxAiCredits === null ? null : parseCap(x.maxAiCredits);
  return { model: typeof x.model === 'string' ? x.model.slice(0, 100) : undefined, effort: asEffort(x.effort), maxAiCredits: cap, persist: true };
};

ipcMain.handle('agents:addFolder', async (_e, mode: unknown, opts: unknown) => {
  const r = await dialog.showOpenDialog({ title: 'Add folder', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode), sessionOpts(opts));
});

ipcMain.handle('agents:addWorkspaceFile', async (_e, mode: unknown, opts: unknown) => {
  const r = await dialog.showOpenDialog({
    title: 'Add .code-workspace file',
    properties: ['openFile'],
    filters: [{ name: 'VS Code workspace', extensions: ['code-workspace'] }],
  });
  return r.canceled ? { ok: true, agents: [] } : addMany(r.filePaths, validMode(mode), sessionOpts(opts));
});

// ---- Previous sessions of a folder (Copilot CLI/SDK store, resumable) and VS Code chat history (read-only) ----
// The renderer only ever names an agent and an opaque id; folders and file paths are resolved here.
const vsUserDirs = (): UserDir[] =>
  dev.DURBAR_VSCODE_USER_DIR ? [{ product: 'Test', dir: dev.DURBAR_VSCODE_USER_DIR }] : vscodeUserDirs();
const vsChatRefs = new Map<string, Map<string, ChatFileRef>>();
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

ipcMain.handle('sessions:listPrevious', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent', sessions: [] };
  try {
    return { ok: true, sessions: await adapter.listPreviousSessions(a.cwd, new Set(agents.keys())) };
  } catch (err) {
    return { ok: false, error: errText(err), sessions: [] };
  }
});

ipcMain.handle('sessions:resume', async (_e, id: unknown, sessionId: unknown, replace: unknown): Promise<ResumeResult> => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  if (typeof sessionId !== 'string' || agents.has(sessionId)) return { ok: false, error: 'That session is already open.' };
  try {
    // Only sessions that belong to this agent's folder can be resumed (re-checked here, not trusted from the UI).
    const prev = (await adapter.listPreviousSessions(a.cwd, new Set(agents.keys()))).find((s) => s.id === sessionId);
    if (!prev) return { ok: false, error: 'That session is no longer available for this folder.' };
    // Resume first; only then retire the untouched agent, so a failed resume leaves everything as it was.
    const info = await addWorkspace(a.workspaceFile ?? a.cwd, a.permMode, { resumeSessionId: sessionId, silent: true });
    let history: ResumeResult['history'];
    try {
      history = await adapter.history(info.id);
    } catch {
      history = { items: [], total: 0, truncated: false };
    }
    let removedId: string | undefined;
    if (replace === true) {
      removedId = id as string;
      await adapter.stop(removedId);
      agents.delete(removedId);
    }
    return { ok: true, agent: info, removedId, title: prev.title, history };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('vschat:list', async (_e, id: unknown): Promise<VsChatListResult> => {
  const empty = { sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0, formatNote: VSCODE_CHAT_FORMAT_NOTE };
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent', ...empty };
  try {
    const l = await listChats(vsUserDirs(), { folders: a.folders, workspaceFile: a.workspaceFile });
    vsChatRefs.set(a.id, new Map(l.sessions.map((r) => [r.summary.key, r])));
    return { ok: true, sessions: l.sessions.map((r) => r.summary), storesFound: l.storesFound, unreadable: l.unreadable, tooLarge: l.tooLarge, formatNote: VSCODE_CHAT_FORMAT_NOTE };
  } catch (err) {
    return { ok: false, error: errText(err), ...empty };
  }
});

ipcMain.handle('vschat:read', async (_e, id: unknown, key: unknown) => {
  const ref = typeof id === 'string' && typeof key === 'string' ? vsChatRefs.get(id)?.get(key) : undefined;
  if (!ref) return { ok: false, error: 'That chat is not in the list any more. Reopen the list and try again.' };
  return readChat(ref);
});

ipcMain.handle('agents:pickAttachments', async (): Promise<PickedFile[]> => {
  // Dev/test hook: DURBAR_PICK="/a.txt:/b.png" answers the picker without a native dialog.
  const preset = (dev.DURBAR_PICK ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
  if (preset.length) {
    return preset.map((p) => {
      pickedFiles.add(p);
      return { path: p, name: path.basename(p), kind: IMAGE_EXT.has(path.extname(p).toLowerCase()) ? 'image' : 'file', size: sizeOf(p) };
    });
  }
  const r = await dialog.showOpenDialog({ title: 'Attach files or images', properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    pickedFiles.add(p);
    return { path: p, name: path.basename(p), kind: IMAGE_EXT.has(path.extname(p).toLowerCase()) ? 'image' : 'file', size: sizeOf(p) };
  });
});

ipcMain.handle('agents:stageAttachment', (_e, name: unknown, mime: unknown, data: unknown) => {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
  if (!bytes) return { ok: false, error: 'No file data.' };
  try {
    const r = stageAttachment(getStageDir(), String(name ?? ''), String(mime ?? ''), bytes);
    if (!r.ok) return r;
    pickedFiles.add(r.path);
    return { ok: true, file: { path: r.path, name: r.name, kind: r.kind, size: r.size } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('agents:send', async (_e, id: string, text: string, attachments: PickedFile[]) => {
  if (!agents.has(id)) return { ok: false, error: 'unknown agent' };
  const safe = (Array.isArray(attachments) ? attachments : []).filter((a) => pickedFiles.has(a.path));
  // Caps are enforced here too, not only in the UI.
  if (safe.length > MAX_ATTACH_FILES) return { ok: false, error: `Up to ${MAX_ATTACH_FILES} attachments per message (got ${safe.length}).` };
  for (const a of safe) {
    const size = sizeOf(a.path);
    if (size === undefined) return { ok: false, error: `"${a.name}" is no longer available.` };
    if (size > MAX_ATTACH_BYTES) return { ok: false, error: `"${a.name}" is ${fmtSize(size)}, over the ${fmtSize(MAX_ATTACH_BYTES)} per-file limit.` };
  }
  try {
    await ensureLive(agents.get(id) as AgentInfo); // an ended or not-yet-started agent starts (resumes) its session here
    await adapter.send(id, {
      text: String(text),
      attachments: safe.map((a) => ({ path: a.path, kind: a.kind === 'image' ? 'image' : 'file' })),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// Stop only interrupts the running turn (the agent returns to Ready); End session frees the runtime session.
ipcMain.handle('agents:stop', async (_e, id: string) => {
  if (agents.has(id)) await adapter.interrupt(id);
});

ipcMain.handle('agents:end', async (_e, id: string) => {
  if (agents.has(id)) await adapter.stop(id);
});

ipcMain.handle('agents:newSession', async (_e, id: unknown, opts: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  try {
    const mode = o.permMode === undefined ? a.permMode : validMode(o.permMode);
    const agent = await addWorkspace(wsKey(a), mode, { model: typeof o.model === 'string' ? o.model.slice(0, 100) : a.model, effort: asEffort(o.effort) ?? undefined, maxAiCredits: o.maxAiCredits === null ? null : parseCap(o.maxAiCredits) });
    return { ok: true, agent };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

// ---- AI-credit caps (spec 011): numbers only, validated here ----
ipcMain.handle('usage:allTime', () => ({
  doc: usageStore?.view(),
  labels: Object.fromEntries([...agents.values()].map((a) => [a.id, usageLabel(a)])),
  error: usageStore?.lastError,
}));
ipcMain.handle('usage:reset', () => {
  usageStore?.reset();
  return { ok: true, doc: usageStore?.view() };
});
ipcMain.handle('settings:get', () => ({ defaultMaxAiCredits: settingsStore?.defaultMaxAiCredits, about: aboutView(app.getVersion()) }));
ipcMain.handle('settings:setDefaultCap', (_e, credits: unknown) => ({ ok: true, defaultMaxAiCredits: settingsStore?.setDefaultMaxAiCredits(credits) }));

ipcMain.handle('agents:setCap', async (_e, id: unknown, credits: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  const cap = credits === null ? undefined : parseCap(credits);
  if (credits !== null && cap === undefined) return { ok: false, error: 'The cap must be a number of at least 30 AI credits (the runtime minimum).' };
  try {
    if (adapter.isLive(a.id)) await adapter.setCap(a.id, cap ?? null); // not started yet: applied when the session starts
    a.maxAiCredits = cap;
    folderStore?.setMaxAiCredits(wsKey(a), cap);
    return { ok: true, maxAiCredits: cap };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('agents:resolveLimit', async (_e, id: unknown, requestId: unknown, choice: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || typeof requestId !== 'string' || !adapter.isLive(a.id)) return { ok: false, error: 'unknown agent' };
  const c = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>;
  const add = parseAmount(c.credits);
  const setTo = parseCap(c.credits);
  const action = c.kind === 'add' && add ? { kind: 'add' as const, credits: add } : c.kind === 'set' && setTo ? { kind: 'set' as const, credits: setTo } : c.kind === 'unset' ? { kind: 'unset' as const } : c.kind === 'cancel' ? { kind: 'cancel' as const } : undefined;
  if (!action) return { ok: false, error: 'Invalid choice.' };
  try {
    await adapter.resolveLimit(a.id, requestId, action);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

/** The last list of models the account offers; a switch request is checked against it (spec 030 FR-018). */
let lastModels: ModelChoice[] = [];
const modelsForValidation = async (): Promise<ModelChoice[]> => {
  if (!lastModels.length) lastModels = (await adapter.listModelOptions()).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
  return lastModels;
};
const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

ipcMain.handle('agents:setModel', async (_e, id: unknown, raw: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  if (typeof generic.setModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    const parsed = parseSwitchRequest(raw, await modelsForValidation());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const req: ModelSwitchRequest = parsed.request;
    const result = await generic.setModel(a.id, req);
    if (result.status === 'applied') {
      // Saved only in this app's own folder file; never in Copilot's settings (no repoScope / modelChangeScope / pickerPersistence is ever sent).
      a.model = req.model;
      if (req.effort === null) a.effort = undefined;
      else if (req.effort !== undefined) a.effort = req.effort;
      a.tier = req.contextTier === 'long' ? 'long' : undefined;
      folderStore?.setModelChoice(wsKey(a), { model: req.model, effort: req.effort, contextTier: a.tier });
    }
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('agents:cancelQueuedModel', async (_e, id: unknown, queueId: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || typeof queueId !== 'string' || !queueId || queueId.length > 200) return { ok: false, error: 'unknown agent' };
  if (typeof generic.cancelQueuedModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    await generic.cancelQueuedModel(a.id, queueId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('agents:compact', async (_e, id: unknown, focus: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  if (typeof generic.compact !== 'function') return { ok: false, error: 'This agent cannot compact its context in place. Start a new session instead.' };
  try {
    return { ok: true, result: await generic.compact(a.id, parseFocus(focus)) };
  } catch (err) {
    return { ok: false, error: errText(err) }; // the focus text is never logged or echoed
  }
});

ipcMain.handle('models:list', async (): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }> => {
  try {
    const models = (await adapter.listModelOptions()).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
    lastModels = models;
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: errText(err), models: [] };
  }
});

ipcMain.handle('folders:setHidden', (_e, id: unknown, hidden: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false };
  const key = wsKey(a);
  for (const x of agents.values()) if (wsKey(x) === key) x.hidden = hidden === true;
  folderStore?.setHidden(key, hidden === true);
  return { ok: true };
});

ipcMain.handle('folders:setClosed', (_e, id: unknown, closed: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false };
  const key = wsKey(a);
  for (const x of agents.values()) if (wsKey(x) === key) x.closed = closed === true;
  folderStore?.setClosed(key, closed === true);
  return { ok: true };
});

ipcMain.handle('agents:setMode', (_e, id: unknown, mode: unknown, opts: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  const m = validMode(mode);
  a.permMode = m;
  a.permRestored = undefined; // a fresh choice, no longer "restored"
  const r = adapter.setPermMode(a.id, m, { clearGrants: o.clearGrants === true, approvePending: o.approvePending === true });
  folderStore?.setPermMode(wsKey(a), m);
  return { ok: true, mode: m, pending: r.pending };
});

ipcMain.handle('folders:remove', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, removedIds: [] as string[] };
  const key = wsKey(a);
  const removedIds = [...agents.values()].filter((x) => wsKey(x) === key).map((x) => x.id);
  for (const rid of removedIds) {
    try {
      await adapter.stop(rid); // no-op when it is not running; the history stays in ~/.copilot
    } catch {
      /* already gone */
    }
    agents.delete(rid);
    vsChatRefs.delete(rid);
  }
  folderStore?.remove(key);
  return { ok: true, removedIds };
});

ipcMain.handle('agents:resolvePermission', (_e, id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean) => {
  if (agents.has(id)) adapter.resolvePermission(id, String(requestId), approve === true, approve === true && remember === true, approve === true && remember === true && broad === true);
});

ipcMain.handle('agents:revokeGrant', (_e, id: string, key: string) => {
  if (agents.has(id)) adapter.revokeGrant(id, String(key));
});

ipcMain.handle('agents:openInVSCode', (_e, id: string) => {
  const a = agents.get(id);
  // Only paths of agents we started: the workspace file if there is one, else the folder.
  return a ? openInVSCode(a.workspaceFile ?? a.cwd) : { ok: false, error: 'unknown agent' };
});

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    title: 'Agent Durbar',
    backgroundColor: '#f6f1e7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Links never navigate this window or open new windows; chat links go through app:openExternal (http/https only).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  // DURBAR_SIM=N: simulated live agents (fake events, no sessions, no AI credits). See src/renderer/sim.ts.
  const sim = parseInt(dev.DURBAR_SIM ?? '', 10);
  const query: Record<string, string> = {};
  if (sim > 0) {
    query.sim = String(sim);
    if (dev.DURBAR_SIM_FREEZE === '1') query.simfreeze = '1';
    if (dev.DURBAR_SIM_ROOMS) query.simrooms = dev.DURBAR_SIM_ROOMS;
  }
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });
  // Dev: DURBAR_SHOT=/tmp/out.png [DURBAR_SHOT_SIZE=1280x800] [DURBAR_SHOT_CLICK=sim-1] saves a screenshot and quits.
  const shot = dev.DURBAR_SHOT;
  if (shot) {
    const m = /^(\d+)x(\d+)$/.exec(dev.DURBAR_SHOT_SIZE ?? '');
    if (m) win.setContentSize(Number(m[1]), Number(m[2]));
    const w = win;
    w.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const click = dev.DURBAR_SHOT_CLICK;
        if (click) {
          await w.webContents.executeJavaScript(`document.querySelector('[data-id=${JSON.stringify(click)}]')?.click()`);
          await new Promise((r) => setTimeout(r, 600));
        }
        const img = await w.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        app.quit();
      }, 1800);
    });
  }
}

app.whenReady().then(() => {
  app.setAboutPanelOptions(aboutPanelOptions(app.getVersion())); // owner and contributors: src/shared/about.ts (spec 008 FR-018)
  folderStore = new FolderStore(path.join(app.getPath('userData'), 'durbar-folders.json'));
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'durbar-settings.json'));
  settingsStore.load();
  mcpStore = new McpStore(path.join(app.getPath('userData'), 'durbar-mcp.json'), safeStorageCodec);
  mcpStore.load();
  usageStore = new UsageStore(path.join(app.getPath('userData'), 'durbar-tool-usage.json'));
  usageStore.load();
  restoreFolders();
  createWindow();
  // Dev/headless convenience: DURBAR_OPEN="/path/a:/path/b" starts agents (read-only) on launch.
  const open = (dev.DURBAR_OPEN ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
  if (open.length) void addMany(open, validMode(dev.DURBAR_PERM));
  // Dev/test: DURBAR_DRIVER=/path/driver.js runs a UI-driving script against the real window + adapter.
  // The module exports async (ctx) => void with ctx = { win, addMany, shot(file), js(code), sleep(ms), waitFor(expr, ms) }.
  if (dev.DURBAR_DRIVER) {
    const ctx = {
      get win() {
        return win as BrowserWindow;
      },
      addMany,
      js: <T>(code: string): Promise<T> => (win as BrowserWindow).webContents.executeJavaScript(code, true) as Promise<T>,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      shot: async (file: string) => fs.writeFileSync(file, (await (win as BrowserWindow).webContents.capturePage()).toPNG()),
      waitFor: async (expr: string, ms = 120000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await (win as BrowserWindow).webContents.executeJavaScript(`!!(${expr})`)) return true;
          await new Promise((r) => setTimeout(r, 300));
        }
        return false;
      },
    };
    win?.webContents.once('did-finish-load', () => {
      const driver = require(dev.DURBAR_DRIVER as string) as (c: typeof ctx) => Promise<void>;
      void driver(ctx).catch((err) => console.error('DRIVER FAILED', err)).finally(() => void adapter.dispose().finally(() => app.exit(0)));
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  usageStore?.flush();
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
});

app.on('window-all-closed', () => {
  void adapter.dispose().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
