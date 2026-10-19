import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRODUCTION_DESCRIPTORS } from '../adapters/descriptors';
import { enabledExperimental } from '../adapters/experimental';
import { createRegistry, detectAll } from '../adapters/registry';
import { detectorFor } from '../adapters/detect';
import { adapterForAdd, createRouter, historyOf, modelOptionsOf, previousSessionsOf } from '../adapters/router';
import { errText, restorable, setCapOp, setModeOp, stopTurnOp, validMode } from './agentops';
import type { OpsDeps } from './agentops';
import { adapterOf } from './folders';
import type { AgentAdapter } from '../adapters/types';
import type { AdapterInfo } from '../shared/adapters';
import { startOptionsOf } from './startopts';
import { resolveWorkspaceCwd } from '../adapters/workspace';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, fmtSize, stageAttachment, kindOfFile, sweepStaleStageDirs } from '../shared/attachments';
import type { AddResult, AgentInfo, FloorsResult, FloorsState, ModelChoice, PermMode, PickedFile, ResumeResult, SessionOptions, VsChatListResult } from '../shared/api';
import { GROUND } from '../shared/floors';
import type { FloorOp } from '../shared/floors';
import { openInVSCode } from './vscode';
import { isHttpUrl } from '../shared/url';
import { FolderStore, PROFILE_ID, restoreMode } from './folders';
import { VSCODE_CHAT_FORMAT_NOTE, listChats, readChat, vscodeUserDirs } from '../adapters/vscodeChat';
import type { ChatFileRef, UserDir } from '../adapters/vscodeChat';
import { McpStore } from './mcpstore';
import { registerMcpIpc, safeStorageCodec } from './mcpipc';
import { UsageStore } from './usagestore';
import { AgentTrustStore, hashAgentFile } from './agenttrust';
import { Scheduler, loadSchedules, saveSchedules } from './schedules';
import type { SchedulerDeps } from './schedules';
import { UsageTotalsStore } from './usagetotalsstore';
import { folderKeyOf, folderNameOf } from '../shared/usagedoc';
import { agentLabel } from '../shared/toolusage';
import { devEnv, devWarning } from './devhooks';
import { UserThemeStore } from './themes';
import { SettingsStore } from './settings';
import { parseAmount, parseCap, parseThemeId } from '../shared/credits';
import { broadFolderKind } from '../shared/broadfolder';
import { aboutPanelOptions, aboutView } from '../shared/about';
import { modelControlFor, parseFocus, parseSwitchRequest } from '../shared/modelswitch';
import type { ModelSwitchRequest, ModelSwitchResult } from '../shared/modelswitch';
import { createDebugSink } from '../shared/redact';

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
/** Credit totals per folder kept across restarts (spec 011 FR-025, issue #21). */
let usageTotalsStore: UsageTotalsStore | undefined;
let agentTrust: AgentTrustStore | undefined;
/** The folder (or .code-workspace file) an agent belongs to; the key of the saved folder list. */
const wsKey = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;

/** Only Copilot is registered; every agent is routed to its adapter through the router (spec 012 FR-046..FR-050). Adapters are typed as the neutral interface: optional members say what each can do (spec 030 FR-017, spec 012 FR-027). */
const registry = createRegistry([...PRODUCTION_DESCRIPTORS, ...enabledExperimental(dev)]); // DURBAR_CLAUDE=1 adds Claude Code (spec 012 FR-114)
const router = createRouter(registry);
const agents = new Map<string, AgentInfo>();
const mcp = registerMcpIpc({ store: () => mcpStore as McpStore, agents, router, dev });
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

router.onEvent((e) => toRenderer('agent:event', e));
/** Each main agent's last status (spec 044: a scheduled run is skipped while the folder's agent is busy). */
const lastStatus = new Map<string, string>();
router.onEvent((e) => {
  if (e.type === 'status' && !e.agentId) lastStatus.set(e.sessionId, e.status);
});
/** Key an agent's all-time counts are kept under: "<agent name> · <folder name>" (base name only, spec 020). */
const usageLabel = (a: AgentInfo): string => agentLabel(a.name, a.workspaceFile ? path.basename(a.workspaceFile).replace(/\.code-workspace$/i, '') : a.cwd);
// All-time tool usage is counted here, not in the window, so it also counts while the Tools view is closed (spec 020 FR-006).
// A main agent's session title (issue #126): kept on its info so a reloaded window gets it from agents:list. Display only.
router.onEvent((e) => {
  if (e.type !== 'title') return;
  const a = agents.get(e.sessionId);
  if (a) a.title = e.title;
});
router.onEvent((e) => {
  if (e.type !== 'toolCall') return;
  const a = agents.get(e.sessionId);
  if (a) usageStore?.record(usageLabel(a), e);
});
// Credit totals per folder are kept here too (spec 011 FR-026): one record per `usage` event of a known agent (helpers report through
// their agent), so they also count while no window is open. Only numbers, the folder's display name and a hash of its path are saved.
router.onEvent((e) => {
  if (e.type !== 'usage') return;
  const a = agents.get(e.sessionId);
  if (a) usageTotalsStore?.record(folderKeyOf(a), folderNameOf(a), e);
});
/** What the window needs to show the totals: the saved figures from before this run (it adds this run's own on top). */
const usageTotalsView = (): unknown => {
  const st = usageTotalsStore;
  if (!st) return { ok: false };
  const b = st.baselineView();
  const folders: unknown[] = [];
  const seen = new Set<string>();
  for (const a of agents.values()) {
    const k = folderKeyOf(a);
    if (seen.has(k)) continue;
    seen.add(k);
    const f = b.folderOf(k);
    if (f) folders.push({ path: k, ...f });
  }
  return { ok: true, since: b.since, office: b.office, folders, error: st.lastError };
};
// The runtime confirms the cap now in force (also after a change made by another client): keep AgentInfo and the folder's saved cap in step.
router.onEvent((e) => {
  if (e.type !== 'limit' || e.phase !== 'changed') return;
  const a = agents.get(e.sessionId);
  if (!a) return;
  a.maxAiCredits = parseCap(e.maxAiCredits);
  folderStore?.setMaxAiCredits(wsKey(a), a.maxAiCredits);
});

/** Keep AgentInfo in step with the model the runtime reports. Only a switch the user asked for is saved with the folder; a runtime fallback (rate limit, refusal) is shown but never becomes the folder's choice (spec 030 FR-015). */
router.onEvent((e) => {
  if (e.type !== 'model' || e.agentId) return;
  const a = agents.get(e.sessionId);
  if (!a) return;
  // Under Auto the runtime routes each request itself; the agent stays on "auto" unless the user chose a model.
  if (a.model === 'auto' && e.cause !== 'user') return;
  a.model = e.model;
  if (e.cause === 'user' || e.effort !== undefined) a.effort = e.effort;
  a.tier = e.tier === 'long' ? 'long' : undefined;
  if (e.cause === 'user') folderStore?.setModelChoice(wsKey(a), { model: e.model, effort: e.effort, contextTier: a.tier });
});

// Dev/test: DURBAR_LOG=/path/events.jsonl records every normalized event and what is sent to the SDK.
if (dev.DURBAR_LOG) {
  const logFile = dev.DURBAR_LOG;
  const write = createDebugSink(logFile, process.env, fs.appendFileSync); // redacts once, at the sink (spec 012 FR-006)
  router.onEvent((e) => write({ t: Date.now(), event: e }));
  router.setDebug((m) => write({ t: Date.now(), debug: m }));
}

ipcMain.handle('app:openExternal', async (_e, url: unknown) => {
  if (!isHttpUrl(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

const infoFor = (workspace: string, permMode: PermMode, id: string, model: string, effort: string | undefined, extra: Partial<AgentInfo> = {}, ad: AgentAdapter = router.instance(registry.defaultId)): AgentInfo => {
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
    // `unverified`: the real adapter's switch/compact calls come from the SDK docs and were never run on an account (spec 030 Phase 3).
    modelControl: modelControlFor(ad, { unverified: true }),
    profiles: typeof ad.listAgentProfiles === 'function' && typeof ad.selectAgentProfile === 'function' ? true : undefined, // spec 043
    adapterId: ad.id,
    ...extra,
  };
};

const startOptionsFor = (a: AgentInfo) => ({
  ...startOptionsOf(a, wsKey(a), DEFAULT_MODEL, asEffort(a.effort)),
  ...mcp.optionsFor(a.id),
});

async function addWorkspace(
  workspace: string,
  permMode: PermMode,
  opts: { resumeSessionId?: string; silent?: boolean; model?: string; effort?: string; persist?: boolean; maxAiCredits?: number | null; floor?: string; adapterId?: string; readyIds?: ReadonlySet<string> } = {},
): Promise<AgentInfo> {
  const model = opts.model || DEFAULT_MODEL;
  const effort = asEffort(opts.effort);
  const wsr = resolveWorkspaceCwd(workspace);
  const picked = adapterForAdd(opts.adapterId, (() => { const f = folderStore?.get(wsr.workspaceFile ?? wsr.cwd); return f ? adapterOf(f) : undefined; })(), (i) => registry.has(i), registry.defaultId, opts.readyIds && ((i) => opts.readyIds!.has(i)));
  if ('error' in picked) throw new Error(picked.error); // nothing started, nothing written
  const adapterId = picked.id;
  const ad = router.instance(adapterId);
  const draft = infoFor(workspace, permMode, '', model, effort, {}, ad);
  // Cap: explicit choice (null = none) > the folder's saved cap > the global default (spec 011).
  draft.maxAiCredits = opts.maxAiCredits === null ? undefined : (opts.maxAiCredits ?? folderStore?.get(wsKey(draft))?.maxAiCredits ?? settingsStore?.defaultMaxAiCredits);
  const id = await ad.start({ ...startOptionsFor(draft), resumeSessionId: opts.resumeSessionId });
  router.bind(id, adapterId);
  const saved = folderStore?.get(wsKey(draft));
  const info: AgentInfo = { ...draft, id, hidden: saved?.hidden, closed: saved?.closed, label: saved?.label, defaultAgent: saved?.defaultAgent };
  agents.set(id, info);
  if (opts.persist) folderStore?.upsert({ workspace: wsKey(info), permMode, model, effort, maxAiCredits: info.maxAiCredits, floor: opts.floor, adapterId });
  // An existing folder keeps its floor; a new one gets the chosen floor (spec 033 FR-006).
  info.floor = folderStore?.floorOfFolder(wsKey(info)) ?? GROUND;
  if (!opts.silent) toRenderer('agent:added', info);
  return info;
}

/** Make sure the agent has a live runtime session: resume it by id when it has history, else start one under that id. */
const starting = new Map<string, Promise<void>>();
async function ensureLive(a: AgentInfo): Promise<void> {
  const ad = router.forAgent(a.id);
  if (!ad) throw new Error('unknown agent');
  if (ad.isLive(a.id)) return;
  let p = starting.get(a.id);
  if (!p) {
    p = ad.start({ ...startOptionsFor(a), sessionId: a.id, quiet: true }).then(() => {
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
  const readyIds = opts.adapterId !== undefined ? await readyAdapterIds() : undefined; // a kind the user picked must be ready (FR-058)
  for (const p of paths) {
    try {
      added.push(await addWorkspace(p, permMode, { model: opts.model, effort: opts.effort, persist: opts.persist, maxAiCredits: opts.maxAiCredits, floor: opts.floor, adapterId: opts.adapterId, readyIds }));
    } catch (err) {
      errors.push(`${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Spec 006 FR-016 (issue #170): a calm line for a folder that is the home folder, a parent of it, or a root.
  const warnings: NonNullable<AddResult['warnings']> = [];
  const home = os.homedir();
  for (const a of added) {
    for (const f of a.folders?.length ? a.folders : [a.cwd]) {
      const kind = broadFolderKind(f, home);
      if (kind) {
        warnings.push({ name: path.basename(f) || f, kind });
        break;
      }
    }
  }
  return { ok: errors.length === 0, agents: added, error: errors.join('; ') || undefined, ...(warnings.length ? { warnings } : {}) };
}

/** Folders remembered from earlier runs come back as "not started" agents: nothing runs until the first message. */
function restoreFolders(): void {
  if (!folderStore) return;
  for (const { folder: f, adapterId } of restorable(folderStore.load(), (i) => registry.has(i), console.warn)) {
    try {
      if (!fs.existsSync(f.workspace)) continue; // e.g. an unplugged drive: stays saved, just not shown
      const rm = restoreMode(f.permMode); // exactly as saved, Allow all included, flagged so the UI shows "restored" (spec 003 FR-025/026)
      const info = infoFor(f.workspace, rm.mode, randomUUID(), f.model || DEFAULT_MODEL, f.effort, { lazy: true, tier: f.contextTier, hidden: f.hidden, closed: f.closed, floor: folderStore.floorOfFolder(f.workspace), permRestored: rm.restored || undefined, maxAiCredits: f.maxAiCredits ?? settingsStore?.defaultMaxAiCredits }, router.instance(adapterId));
      if (f.label) info.label = f.label;
      if (f.defaultAgent) info.defaultAgent = f.defaultAgent;
      router.bind(info.id, adapterId);
      agents.set(info.id, info);
    } catch {
      /* folder gone or not a folder any more */
    }
  }
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('agents:list', () => [...agents.values()]);

const sessionOpts = (o: unknown): SessionOptions & { persist: boolean } => {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const cap = x.maxAiCredits === null ? null : parseCap(x.maxAiCredits);
  return { model: typeof x.model === 'string' ? x.model.slice(0, 100) : undefined, effort: asEffort(x.effort), maxAiCredits: cap, floor: typeof x.floor === 'string' ? x.floor.slice(0, 20) : undefined, adapterId: typeof x.adapterId === 'string' ? x.adapterId.slice(0, 40) : undefined, persist: true };
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

ipcMain.handle('sessions:listPrevious', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent', sessions: [] };
  try {
    return { ok: true, sessions: await previousSessionsOf(ad, a.cwd, new Set(agents.keys())) };
  } catch (err) {
    return { ok: false, error: errText(err), sessions: [] };
  }
});

ipcMain.handle('sessions:resume', async (_e, id: unknown, sessionId: unknown, replace: unknown): Promise<ResumeResult> => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof sessionId !== 'string' || agents.has(sessionId)) return { ok: false, error: 'That session is already open.' };
  try {
    // Only sessions that belong to this agent's folder can be resumed (re-checked here, not trusted from the UI).
    const prev = (await previousSessionsOf(ad, a.cwd, new Set(agents.keys()))).find((s) => s.id === sessionId);
    if (!prev) return { ok: false, error: 'That session is no longer available for this folder.' };
    // Resume first; only then retire the untouched agent, so a failed resume leaves everything as it was.
    const info = await addWorkspace(a.workspaceFile ?? a.cwd, a.permMode, { resumeSessionId: sessionId, silent: true, adapterId: router.adapterIdOf(a.id) });
    let history: ResumeResult['history'];
    try {
      history = await historyOf(router.forAgent(info.id) ?? ad, info.id);
    } catch {
      history = { items: [], total: 0, truncated: false };
    }
    let removedId: string | undefined;
    if (replace === true) {
      removedId = id as string;
      await ad.stop(removedId);
      router.unbind(removedId);
      agents.delete(removedId);
    }
    if (prev.title && prev.title !== 'Untitled session') info.title = prev.title; // the list's title (name, else summary) until the runtime sends its own
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

ipcMain.handle('agents:pickAttachments', async (_e, want: unknown): Promise<PickedFile[]> => {
  const images = want === 'image'; // spec 004 FR-013: the image button opens the picker with an image filter
  // Dev/test hook: DURBAR_PICK="/a.txt:/b.png" answers the picker without a native dialog.
  const preset = (dev.DURBAR_PICK ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
  let paths: string[] = preset;
  if (!preset.length) {
    const r = await dialog.showOpenDialog({
      title: images ? 'Attach images' : 'Attach files or images',
      properties: ['openFile', 'multiSelections'],
      ...(images ? { filters: [{ name: 'Images (PNG, JPEG, GIF, WebP, BMP)', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] } : {}),
    });
    if (r.canceled) return [];
    paths = r.filePaths;
  }
  const out: PickedFile[] = [];
  for (const p of paths) {
    const size = sizeOf(p);
    if (!size) continue; // spec 004 FR-012: empty (or unreadable) files are not attached
    pickedFiles.add(p);
    out.push({ path: p, name: path.basename(p), kind: kindOfFile(p), size }); // FR-009: the bytes decide, not the extension
  }
  return out;
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
  const ad = agents.has(id) ? router.forAgent(id) : undefined;
  if (!ad) return { ok: false, error: 'unknown agent' };
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
    await ad.send(id, {
      text: String(text),
      attachments: safe.map((a) => ({ path: a.path, kind: kindOfFile(a.path) })), // FR-009: checked again here, the renderer's kind is not trusted
    });
    for (const a of safe) pickedFiles.delete(a.path); // spec 004 FR-015: a sent file must be picked again to be sent again
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ---- scheduled prompts (spec 044): per folder, while the app runs; the run goes through the user's own send path ----
let scheduler: Scheduler | undefined;
const folderAgent = (folder: string): AgentInfo | undefined => [...agents.values()].find((x) => wsKey(x) === folder);
const scheduleDeps = (file: string): SchedulerDeps => ({
  now: () => Date.now(),
  isBusy: (folder) => [...agents.values()].some((x) => wsKey(x) === folder && ['working', 'needs-permission'].includes(lastStatus.get(x.id) ?? '')),
  send: async (folder, prompt, s) => {
    const a = folderAgent(folder);
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return false;
    await ensureLive(a);
    toRenderer('agent:event', { type: 'user', sessionId: a.id, timestamp: Date.now(), text: prompt });
    toRenderer('schedule:ran', { agentId: a.id, scheduleId: s.id, every: s.every, at: s.at });
    await ad.send(a.id, { text: prompt });
    return true;
  },
  setTimer: (ms, fn) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
  save: (doc) => saveSchedules(file, doc),
  changed: (doc) => toRenderer('schedules:changed', doc),
});
ipcMain.handle('schedules:list', () => scheduler?.doc ?? { pausedAll: false, schedules: [] });
ipcMain.handle('schedules:save', (_e, input: unknown) => (scheduler ? scheduler.save(input, (f) => !!folderStore?.get(f)) : { ok: false, error: 'Schedules are not available.' }));
ipcMain.handle('schedules:remove', (_e, id: unknown) => ({ ok: typeof id === 'string' && !!scheduler?.remove(id) }));
ipcMain.handle('schedules:setPausedAll', (_e, on: unknown) => {
  scheduler?.setPausedAll(on === true);
  return { ok: !!scheduler, pausedAll: scheduler?.doc.pausedAll ?? false };
});

// The handler bodies that refuse a setting a live session cannot take live in agentops.ts (spec 012 FR-054); `store` is read when a handler runs.
const opsDeps: OpsDeps = { agents, router, get store() { return folderStore; }, wsKey };
// Stop only interrupts the running turn (the agent returns to Ready); End session frees the runtime session.
ipcMain.handle('agents:stop', (_e, id: string) => stopTurnOp(opsDeps, id));

ipcMain.handle('agents:end', async (_e, id: string) => {
  if (agents.has(id)) await router.forAgent(id)?.stop(id);
});

ipcMain.handle('agents:newSession', async (_e, id: unknown, opts: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown agent' };
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  try {
    const mode = o.permMode === undefined ? a.permMode : validMode(o.permMode);
    // The dialog's kind (FR-059); none = the current agent's kind. A kind the user picked must be ready (FR-058).
    const picked = typeof o.adapterId === 'string' ? o.adapterId.slice(0, 40) : undefined;
    const readyIds = picked !== undefined ? await readyAdapterIds() : undefined;
    const agent = await addWorkspace(wsKey(a), mode, { model: typeof o.model === 'string' ? o.model.slice(0, 100) : picked !== undefined && picked !== router.adapterIdOf(a.id) ? undefined : a.model, effort: asEffort(o.effort) ?? undefined, maxAiCredits: o.maxAiCredits === null ? null : parseCap(o.maxAiCredits), adapterId: picked ?? router.adapterIdOf(a.id), readyIds });
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
ipcMain.handle('usage:totals', () => usageTotalsView());
ipcMain.handle('usage:resetTotals', () => {
  usageTotalsStore?.reset();
  return usageTotalsView();
});
ipcMain.handle('usage:reset', () => {
  usageStore?.reset();
  return { ok: true, doc: usageStore?.view() };
});
ipcMain.handle('settings:get', () => ({ defaultMaxAiCredits: settingsStore?.defaultMaxAiCredits, placeMap: settingsStore?.placeMap ?? {}, customPlaces: settingsStore?.customPlaces ?? [], seriousMode: settingsStore?.seriousMode ?? false, theme: runTheme ?? settingsStore?.theme ?? 'clean-office', about: aboutView(app.getVersion()) }));
ipcMain.handle('settings:setSeriousMode', (_e, on: unknown) => ({ ok: true, seriousMode: settingsStore?.setSeriousMode(on) ?? false }));
/* DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it and is saved as usual. */
let runTheme: string | undefined;
ipcMain.handle('settings:setTheme', (_e, id: unknown) => {
  runTheme = undefined;
  return settingsStore ? settingsStore.setTheme(id) : { ok: false };
});
/* User themes (spec 040): `userData/themes/<id>/manifest.json`, import/export by folder pick. Dev hook DURBAR_PICK answers the dialog in checks. */
const userThemes = new UserThemeStore(path.join(app.getPath('userData'), 'themes'));
const BUILT_IN_THEME_IDS = ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];
const pickFolder = async (title: string): Promise<string | null> => {
  if (dev.DURBAR_PICK) { const first = dev.DURBAR_PICK.split(path.delimiter)[0]; return first || null; } // path.delimiter keeps C:\ paths whole (spec 040 FR-008)
  const r = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
};
ipcMain.handle('theme:listUser', () => userThemes.list().map((t) => ({ id: t.id, name: t.name, ok: t.ok, error: t.error })));
ipcMain.handle('theme:getUser', (_e, id: unknown) => (typeof id === 'string' ? userThemes.get(id) : null));
ipcMain.handle('theme:import', async () => {
  const dir = await pickFolder('Import a theme folder (with manifest.json)');
  if (!dir) return { ok: false, cancelled: true };
  return userThemes.importFolder(dir, (id) => BUILT_IN_THEME_IDS.includes(id));
});
ipcMain.handle('theme:export', async (_e, id: unknown) => {
  if (typeof id !== 'string' || BUILT_IN_THEME_IDS.includes(id)) return { ok: false, error: 'Only your own imported themes can be exported.' };
  const dir = await pickFolder('Export the theme folder to…');
  if (!dir) return { ok: false, cancelled: true };
  return userThemes.exportFolder(id, dir);
});
ipcMain.handle('settings:setPlace', (_e, server: unknown, place: unknown) => settingsStore?.setPlace(server, place) ?? { ok: false });
ipcMain.handle('settings:addPlace', (_e, name: unknown, icon: unknown) => settingsStore?.addPlace(name, icon) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcMain.handle('settings:updatePlace', (_e, id: unknown, patch: unknown) => settingsStore?.updatePlace(id, patch) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcMain.handle('settings:removePlace', (_e, id: unknown) => settingsStore?.removePlace(id) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcMain.handle('settings:setDefaultCap', (_e, credits: unknown) => ({ ok: true, defaultMaxAiCredits: settingsStore?.setDefaultMaxAiCredits(credits) }));

ipcMain.handle('agents:setCap', async (_e, id: unknown, credits: unknown) => {
  return setCapOp(opsDeps, id, credits);
});

// spec 012 FR-128: the user's answer to an agent's question; strings only, capped; null = skipped
ipcMain.handle('agents:answerQuestion', (_e, id: unknown, requestId: unknown, answers: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad?.answerQuestion || typeof requestId !== 'string' || requestId.length > 200) return { ok: false, error: 'unknown agent or question' };
  let clean: Record<string, string> | null = null;
  if (answers && typeof answers === 'object') {
    clean = {};
    for (const [k, v] of Object.entries(answers as Record<string, unknown>).slice(0, 4)) if (typeof v === 'string' && k.length <= 300) clean[k] = v.slice(0, 500);
  }
  ad.answerQuestion(a.id, requestId, clean);
  return { ok: true };
});

// ---- custom agent per session (spec 043 FR-003): list, select; a repository agent needs a confirmation for its exact file ----
ipcMain.handle('agents:listProfiles', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad?.listAgentProfiles) return { ok: false, error: 'This agent cannot use custom agents.', profiles: [] };
  try {
    await ensureLive(a); // a restored or ended agent starts its session (no prompt, no credits)
    const profiles = (await ad.listAgentProfiles(a.id)).map((p) => ({ ...p, trusted: p.source !== 'repo' || (!!p.path && agentTrust?.isTrusted(wsKey(a), p.id, hashAgentFile(p.path))) }));
    return { ok: true, profiles };
  } catch (err) {
    return { ok: false, error: errText(err), profiles: [] };
  }
});
ipcMain.handle('agents:selectProfile', async (_e, id: unknown, profileId: unknown, confirm: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad?.selectAgentProfile) return { ok: false, error: 'This agent cannot use custom agents.' };
  if (profileId !== null && (typeof profileId !== 'string' || !PROFILE_ID.test(profileId))) return { ok: false, error: 'Unknown agent.' };
  try {
    await ensureLive(a);
    if (profileId !== null) {
      const p = (await ad.listAgentProfiles?.(a.id))?.find((x) => x.id === profileId);
      if (!p) return { ok: false, error: 'That agent is not available in this session.' };
      if (p.source === 'repo') {
        const sha = p.path ? hashAgentFile(p.path) : undefined;
        if (!sha) return { ok: false, error: 'The agent file could not be read.' };
        if (!agentTrust?.isTrusted(wsKey(a), p.id, sha)) {
          if (confirm !== true) return { ok: false, needsConfirm: true, profile: p };
          agentTrust?.trust(wsKey(a), p.id, sha);
        }
      }
    }
    const profile = await ad.selectAgentProfile(a.id, profileId as string | null);
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('agents:resolveLimit', async (_e, id: unknown, requestId: unknown, choice: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad || typeof requestId !== 'string' || !ad.isLive(a.id)) return { ok: false, error: 'unknown agent' };
  const c = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>;
  const add = parseAmount(c.credits);
  const setTo = parseCap(c.credits);
  const action = c.kind === 'add' && add ? { kind: 'add' as const, credits: add } : c.kind === 'set' && setTo ? { kind: 'set' as const, credits: setTo } : c.kind === 'unset' ? { kind: 'unset' as const } : c.kind === 'cancel' ? { kind: 'cancel' as const } : undefined;
  if (!action) return { ok: false, error: 'Invalid choice.' };
  try {
    await ad.resolveLimit?.(a.id, requestId, action);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

/** The last list of models the account offers; a switch request is checked against it (spec 030 FR-018). */
let lastModels: ModelChoice[] = [];
const modelsForValidation = async (): Promise<ModelChoice[]> => {
  if (!lastModels.length) lastModels = (await modelOptionsOf(router.instance(registry.defaultId))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
  return lastModels;
};
const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

ipcMain.handle('agents:setModel', async (_e, id: unknown, raw: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof ad.setModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    const parsed = parseSwitchRequest(raw, await modelsForValidation());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const req: ModelSwitchRequest = parsed.request;
    // Not started (or ended) yet: nothing is running to switch. The choice is saved and the first start (create or resume) uses it (FR-013).
    const result: ModelSwitchResult = ad.isLive(a.id) ? await ad.setModel(a.id, req) : { status: 'applied', model: req.model, message: 'Used from the first message: this agent has not started yet.' };
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
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad || typeof queueId !== 'string' || !queueId || queueId.length > 200) return { ok: false, error: 'unknown agent' };
  if (typeof ad.cancelQueuedModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    await ad.cancelQueuedModel(a.id, queueId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

ipcMain.handle('agents:compact', async (_e, id: unknown, focus: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof ad.compact !== 'function') return { ok: false, error: 'This agent cannot compact its context in place. Start a new session instead.' };
  try {
    if (!ad.isLive(a.id)) return { ok: true, result: { success: false, message: 'This agent has not started yet, so there is nothing to compact.' } };
    return { ok: true, result: await ad.compact(a.id, parseFocus(focus)) };
  } catch (err) {
    return { ok: false, error: errText(err) }; // the focus text is never logged or echoed
  }
});

ipcMain.handle('models:list', async (_e, kind: unknown): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }> => {
  // spec 012 FR-120: one list per agent kind; no kind = the default kind (as before); an unknown kind is refused
  const id = kind === undefined || kind === null || kind === '' ? registry.defaultId : typeof kind === 'string' && registry.has(kind) ? kind : undefined;
  if (!id) return { ok: false, error: 'unknown agent kind', models: [] };
  try {
    const models = (await modelOptionsOf(router.instance(id))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
    if (id !== registry.defaultId) return { ok: true, models };
    lastModels = models;
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: errText(err), models: [] };
  }
});

/** Which adapters exist and whether each can run (spec 012 FR-033, FR-034). Cached; `refresh` probes again. Runs no session and spends no credits. */
let adaptersInfo: Promise<AdapterInfo[]> | undefined;
const adaptersList = (refresh: boolean): Promise<AdapterInfo[]> => {
  if (!adaptersInfo || refresh) adaptersInfo = detectAll(registry, (d) => detectorFor(d.id)?.(d) ?? Promise.resolve({ state: 'unknown' as const }));
  return adaptersInfo;
};
ipcMain.handle('adapters:list', (_e, refresh: unknown): Promise<AdapterInfo[]> => adaptersList(refresh === true));
/** Ids whose cached state is `ready`; a failed probe counts as none (spec 012 FR-058). */
const readyAdapterIds = async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set((await adaptersList(false)).filter((i) => i.state === 'ready').map((i) => i.id));
  } catch {
    return new Set();
  }
};

ipcMain.handle('folders:setHidden', (_e, id: unknown, hidden: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false };
  const key = wsKey(a);
  for (const x of agents.values()) if (wsKey(x) === key) x.hidden = hidden === true;
  folderStore?.setHidden(key, hidden === true);
  return { ok: true };
});

// ---- Floors (spec 033): office data only; no handler pauses, stops or ends a session (FR-009, FR-010) ----
const floorsState = (): FloorsState => {
  const doc = folderStore?.floors() ?? { floors: [{ id: GROUND, name: 'Ground floor', on: true }], lastFloor: GROUND };
  const byAgent: Record<string, string> = {};
  for (const a of agents.values()) byAgent[a.id] = a.floor ?? GROUND;
  return { floors: doc.floors.map((f) => ({ ...f, ground: f.id === GROUND })), lastFloor: doc.lastFloor, byAgent };
};
/** After a floor change, every agent takes its folder's floor from the store again (a deleted floor sends them to the ground floor). */
const floorsResult = (r: FloorOp | undefined): FloorsResult => {
  if (folderStore) for (const a of agents.values()) a.floor = folderStore.floorOfFolder(wsKey(a));
  return r && r.ok ? { ok: true, state: floorsState() } : { ok: false, error: r && !r.ok ? r.error : 'Floors are not available.', state: floorsState() };
};
ipcMain.handle('floors:state', () => floorsState());
ipcMain.handle('floors:create', (_e, name: unknown) => floorsResult(folderStore?.createFloor(name)));
ipcMain.handle('floors:rename', (_e, id: unknown, name: unknown) => floorsResult(folderStore?.renameFloor(id, name)));
ipcMain.handle('floors:reorder', (_e, ids: unknown) => floorsResult(folderStore?.reorderFloors(ids)));
ipcMain.handle('floors:delete', (_e, id: unknown) => floorsResult(folderStore?.deleteFloor(id)));
ipcMain.handle('floors:setOn', (_e, id: unknown, on: unknown) => floorsResult(folderStore?.setFloorOn(id, on === true)));
ipcMain.handle('floors:only', (_e, id: unknown) => floorsResult(folderStore?.onlyFloor(id)));
ipcMain.handle('floors:moveFolder', (_e, agentId: unknown, floorId: unknown): FloorsResult => {
  const a = typeof agentId === 'string' ? agents.get(agentId) : undefined;
  if (!a || !folderStore || !folderStore.moveFolder(wsKey(a), floorId)) return { ok: false, error: 'Unknown folder or floor.', state: floorsState() };
  return floorsResult({ ok: true, doc: folderStore.floors() });
});

ipcMain.handle('folders:setClosed', (_e, id: unknown, closed: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false };
  const key = wsKey(a);
  for (const x of agents.values()) if (wsKey(x) === key) x.closed = closed === true;
  folderStore?.setClosed(key, closed === true);
  return { ok: true };
});

ipcMain.handle('agents:setMode', (_e, id: unknown, mode: unknown, opts: unknown) => setModeOp(opsDeps, id, mode, opts));

ipcMain.handle('folders:remove', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, removedIds: [] as string[] };
  const key = wsKey(a);
  scheduler?.removeFolder(key); // spec 044: a removed folder takes its schedules with it
  const removedIds = [...agents.values()].filter((x) => wsKey(x) === key).map((x) => x.id);
  for (const rid of removedIds) {
    try {
      await router.forAgent(rid)?.stop(rid); // no-op when it is not running; the history stays in ~/.copilot
    } catch {
      /* already gone */
    }
    router.unbind(rid);
    agents.delete(rid);
    vsChatRefs.delete(rid);
  }
  folderStore?.remove(key);
  return { ok: true, removedIds };
});

// One main session out of the office (spec 006 FR-017). The last main session of a folder stays (Folders > Remove is for that).
ipcMain.handle('agents:remove', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false, error: 'unknown session' };
  const key = wsKey(a);
  if ([...agents.values()].filter((x) => wsKey(x) === key).length < 2) return { ok: false, error: 'This is the only session in the folder. Remove the folder from Folders instead.' };
  try {
    await router.forAgent(a.id)?.stop(a.id); // the history stays on disk and is listed under Previous sessions
  } catch {
    /* already gone */
  }
  router.unbind(a.id);
  agents.delete(a.id);
  vsChatRefs.delete(a.id);
  return { ok: true };
});

ipcMain.handle('folders:rename', (_e, id: unknown, label: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !folderStore) return { ok: false };
  const r = folderStore.setLabel(wsKey(a), label);
  if (!r) return { ok: false };
  for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.label = r.label;
  return { ok: true, label: r.label };
});

ipcMain.handle('folders:setDefaultAgent', (_e, id: unknown, profileId: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !folderStore) return { ok: false };
  const r = folderStore.setDefaultAgent(wsKey(a), profileId);
  if (!r) return { ok: false };
  for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.defaultAgent = r.defaultAgent;
  return { ok: true, defaultAgent: r.defaultAgent };
});

ipcMain.handle('agents:resolvePermission', (_e, id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean) => {
  if (agents.has(id)) router.forAgent(id)?.resolvePermission?.(id, String(requestId), approve === true, approve === true && remember === true, approve === true && remember === true && broad === true);
});

ipcMain.handle('agents:revokeGrant', (_e, id: string, key: string) => {
  if (agents.has(id)) router.forAgent(id)?.revokeGrant?.(id, String(key));
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
    if (dev.DURBAR_SIM_FLOORS === '1') query.simfloors = '1';
    if (dev.DURBAR_THEME && /^[a-z0-9_-]{1,64}$/.test(dev.DURBAR_THEME)) query.theme = dev.DURBAR_THEME; // spec 036 FR-005: the simulator's settings carry it
    if (dev.DURBAR_SIM_TITLES === '1') query.simtitles = '1'; // spec 001/002 deltas 2026-10-18: main agents with session titles
    if (/^[0-3]$/.test(dev.DURBAR_SIM_PLACES ?? '')) query.simplaces = dev.DURBAR_SIM_PLACES as string; // spec 024 FR-026: custom places seeded in the simulator
    if (dev.DURBAR_SIM_FLOORS_OFF) query.floorsoff = dev.DURBAR_SIM_FLOORS_OFF.slice(0, 200);
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
  /* Dev/test theme seed (spec 036 FR-005): DURBAR_THEME=<id> makes the office open on that theme for the per-theme checks; invalid ids fall back in the renderer. */
  if (dev.DURBAR_THEME) runTheme = parseThemeId(dev.DURBAR_THEME);
  mcpStore = new McpStore(path.join(app.getPath('userData'), 'durbar-mcp.json'), safeStorageCodec);
  mcpStore.load();
  usageStore = new UsageStore(path.join(app.getPath('userData'), 'durbar-tool-usage.json'));
  usageStore.load();
  usageTotalsStore = new UsageTotalsStore(path.join(app.getPath('userData'), 'durbar-usage-totals.json'));
  sweepStaleStageDirs(os.tmpdir()); // spec 004 FR-010: staging folders a crash left behind
  agentTrust = new AgentTrustStore(path.join(app.getPath('userData'), 'durbar-agent-trust.json'));
  agentTrust.load();
  usageTotalsStore.load();
  restoreFolders();
  {
    const file = path.join(app.getPath('userData'), 'durbar-schedules.json');
    scheduler = new Scheduler(loadSchedules(file, Date.now()), scheduleDeps(file));
    scheduler.start(); // missed once-runs are marked, intervals continue from now (spec 044 FR-002)
  }
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
      void driver(ctx).catch((err) => console.error('DRIVER FAILED', err)).finally(() => void router.disposeAll().finally(() => app.exit(0)));
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  usageStore?.flush();
  usageTotalsStore?.flush();
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
});

app.on('window-all-closed', () => {
  void router.disposeAll().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
