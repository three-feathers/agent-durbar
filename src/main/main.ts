import { parseEffort } from '../shared/effort';
import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron';
import { ipcHandle, ipcOn } from './ipcguard';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRODUCTION_DESCRIPTORS } from '../adapters/descriptors';
import { offeredDescriptors } from '../adapters/experimental';
import { createRegistry, detectAll } from '../adapters/registry';
import { folderGitStatus } from './gitstatus';
import type { GitStatus } from './gitstatus';
import { detectorFor, nodeDetectEnv, setLoginPath } from '../adapters/detect';
import { mergeLoginPath, nodeLoginPathDeps, readLoginShellPath } from './loginpath';
import { execFile, spawn } from 'child_process';
import { adapterForAdd, createRouter, historyOf, modelOptionsOf, previousSessionsOf } from '../adapters/router';
import { errText, restorable, setCapOp, setModeOp, stopTurnOp, validMode } from './agentops';
import type { OpsDeps } from './agentops';
import { adapterOf } from './folders';
import type { AgentAdapter, AgentEvent } from '../adapters/types';
import type { AdapterInfo } from '../shared/adapters';
import { startOptionsOf } from './startopts';
import { resolveWorkspaceCwd } from '../adapters/workspace';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, fmtSize, stageAttachment, kindOfFile, sweepStaleStageDirs } from '../shared/attachments';
import type { AddResult, AgentInfo, FloorsResult, FloorsState, ModelChoice, PermMode, PickedFile, ResumeResult, SessionOptions, VsChatListResult } from '../shared/api';
import { GROUND } from '../shared/floors';
import type { FloorOp } from '../shared/floors';
import { openInVSCode } from './vscode';
import { isHttpUrl } from '../shared/url';
import { checkElicitAnswer, createElicitTracker, elicitHttpsUrl } from '../shared/elicit';
import { createRemoteOps } from './remoteops';
import { CheckpointStore } from './checkpoints';
import { DEFAULT_ADAPTER, FolderStore, PROFILE_ID, restoreMode, sessionsToRestore } from './folders';
import { AppStateStore, buildSinceAway, placeWindow, quitMessage } from './daily';
import type { SinceAway } from './daily';
import { navigationAllowed, permissionAllowed, senderAllowed } from './hardening';
import { VSCODE_CHAT_FORMAT_NOTE, listChats, readChat, vscodeUserDirs } from '../adapters/vscodeChat';
import type { ChatFileRef, UserDir } from '../adapters/vscodeChat';
import { McpStore } from './mcpstore';
import { AgentStateTracker, applySetPaused } from './mcp/agentstate';
import { maskMcpEvent } from './mcpmask';
import { registerMcpIpc, safeStorageCodec } from './mcpipc';
import { cliServers, copilotDir } from './mcpfiles';
import { UsageStore } from './usagestore';
import { AgentTrustStore, hashAgentFile } from './agenttrust';
import { Scheduler, loadSchedules, saveSchedules } from './schedules';
import type { SchedulerDeps } from './schedules';
import { UsageTotalsStore } from './usagetotalsstore';
import { ALREADY_DELETING, BEING_OPENED, PrevSessions, listPreviousOp, markOp, marksFor, openIdsOf } from './prevsessions';
import type { PrevDeps } from './prevsessions';
import { ActivityStore } from './activitystore';
import { activityCsv, activityJson, decisionOf } from '../shared/activity';
import type { ActivityDecision } from '../shared/activity';
import { folderKeyOf, folderNameOf } from '../shared/usagedoc';
import { agentLabel } from '../shared/toolusage';
import { devEnv, devWarning } from './devhooks';
import { UserThemeStore } from './themes';
import { HarnessSetup, confirmText, posixTrusted } from './harnesssetup';
import { markSignedOut, withSignIn } from './authcheck';
import type { SignInAnswer } from './authcheck';
import { OFFICIAL_PAGES, allowedSignInUrl, isSetupKind } from '../shared/harnesssetup';
import { MAX_DESCRIPTION, MAX_PASSES, THEME_IDEAS, TOP_BAR_ISSUE, buildFixPrompt, buildRetryPrompt, buildThemePrompt, isBlocking, keepArt, parseGeneratedTheme } from '../shared/themegen';
import { SettingsStore } from './settings';
import { parseBadgeCount, shouldBounce, shouldFlash } from './badge';
import { appMenuTemplate, disposeOnQuit, hideOnClose, windowChrome } from './appmenu';
import { parseAmount, parseCapIn, parseThemeId, startCap } from '../shared/credits';
import { broadFolderKind } from '../shared/broadfolder';
import { REPO_URL, aboutPanelOptions, aboutView } from '../shared/about';
import { modelControlFor, parseFocus, parseSwitchRequest } from '../shared/modelswitch';
import type { ModelSwitchRequest, ModelSwitchResult } from '../shared/modelswitch';
import { createDebugSink } from '../shared/redact';
import { profileDir } from './profiledir';
import { debugSwitchesToRemove } from './debugguard';

// Spec 008 FR-038: no DevTools endpoint in a packaged build. No fuse covers these switches; removing them before ready is shown to work on the packed Linux app (npm run check:fuses-launch).
for (const sw of debugSwitchesToRemove(app.isPackaged)) app.commandLine.removeSwitch(sw);

// Developer/test hooks (spec 010): ignored in packaged builds unless DURBAR_DEV=1. Read hooks only from `dev`.
const dev = devEnv(process.env, app.isPackaged);
const devNote = devWarning(process.env, app.isPackaged);
if (devNote) console.error(devNote);

// Cheapest routing on the logged-in account's only model ("auto"); see docs/milestone-1.md.
// Profile folder chosen in code (spec 008 FR-034): packaged `<appData>/agent-durbar`, dev `<appData>/agent-durbar-dev`.
// Dev/test: DURBAR_USER_DATA=/tmp/x wins and keeps the saved folder list (and Electron's other state) out of the real profile.
// Must stay before anything reads the userData folder and before `whenReady`.
app.setPath('userData', profileDir({ packaged: app.isPackaged, platform: process.platform, appData: app.getPath('appData'), env: process.env }));
const DEFAULT_MODEL = 'auto';
const asEffort = parseEffort; // spec 007 FR-008: the models' own effort names, `none` included
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
/** Local activity log (spec 052 FR-071): permission answers, automatic approvals, mode and limit changes. Created when the app is ready. */
let activityStore: ActivityStore | undefined;
/** Spec 052 round 8: the window's place and size and the last quit time (not settings). Created when the app is ready. */
let appState: AppStateStore | undefined;
/** Spec 052 FR-089: what happened while the app was closed, built once at start; null after the card is dismissed. */
let sinceAway: SinceAway | null = null;
/** The folder (or .code-workspace file) an agent belongs to; the key of the saved folder list. */
const wsKey = (a: AgentInfo): string => a.workspaceFile ?? a.cwd;

/** Only Copilot is registered; every agent is routed to its adapter through the router (spec 012 FR-046..FR-050). Adapters are typed as the neutral interface: optional members say what each can do (spec 030 FR-017, spec 012 FR-027). */
const registry = createRegistry([...PRODUCTION_DESCRIPTORS, ...offeredDescriptors(dev)]); // Copilot, then Claude Code (spec 012 FR-135); detection decides what is ready
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
/** Set in before-quit: from then on a close really closes (macOS hides the window otherwise, spec 052 FR-085). */
let quitting = false;

const toRenderer = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/** An MCP status event carries server error text: masked here, once, before the window sees it (spec 019 FR-021). */
/** Spec 019 FR-022: the masked copy of an `mcp` event, built once per event; every path out of main (window, debug sink) uses it. */
const outward = (e: AgentEvent): AgentEvent => maskMcpEvent(e, e.type === 'mcp' ? mcp.secretValuesFor(e.sessionId) : []);
router.onEvent((e) => toRenderer('agent:event', outward(e)));
/** Open MCP elicitations (spec 012 FR-151): main checks each answer against the fields it was asked with. */
const elicitTracker = createElicitTracker();
router.onEvent((e) => elicitTracker.onEvent(e));
/** The office's state word and sub-label per agent, kept from the same events (spec 041 T014); read tools use it. "Paused" comes from the window (agents:setPaused). */
const agentState = new AgentStateTracker();
router.onEvent((e) => {
  const a = agents.get(e.sessionId);
  if (!a) return; // removed or unknown: the tracker drops it too
  agentState.ensure(a.id, a.lazy);
  agentState.onEvent(e);
});
/** Each main agent's last status (spec 044: a scheduled run is skipped while the folder's agent is busy). */
const lastStatus = new Map<string, string>();
router.onEvent((e) => {
  if (e.type === 'status' && !e.agentId) lastStatus.set(e.sessionId, e.status);
  // spec 044 FR-015: usage between a scheduled send and the end of that turn counts toward the schedule's own limit
  if (e.type === 'usage') scheduler?.noteUsage(e.sessionId, e);
  else if (e.type === 'status' && !e.agentId && (e.status === 'idle' || e.status === 'error' || e.status === 'stopped')) scheduler?.turnEnded(e.sessionId);
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
/** One activity row for agent `a` (spec 052 FR-071): names, the folder's base name, the adapter's display name and a short summary. */
const logActivity = (a: AgentInfo, decision: ActivityDecision, action: string, mode: string = a.permMode): void => {
  activityStore?.record({ agent: a.label || a.name, folder: folderNameOf(a), app: registry.get(a.adapterId)?.displayName ?? a.adapterId, mode, action, decision });
};
// The answer to a permission request, or an automatic approval (Allow all, a session permission), arrives as a `permission` event;
// it is logged here, in main, so the window cannot add or change rows. Pending requests, plain reads and stopped sessions are not logged.
router.onEvent((e) => {
  if (e.type !== 'permission') return;
  const a = agents.get(e.sessionId);
  const decision = decisionOf(e.permission);
  if (a && decision) logActivity(a, decision, e.permission.summary);
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
  const unit = router.forAgent(a.id)?.capabilities?.capUnit;
  a.maxAiCredits = parseCapIn(unit, e.maxAiCredits);
  if (unit !== 'usd') folderStore?.setMaxAiCredits(wsKey(a), a.maxAiCredits); // a dollar cap is per session only (FR-150)
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
  router.onEvent((e) => write({ t: Date.now(), event: outward(e) })); // FR-022: the sink's redact() does not know a folder extra's secret values
  router.setDebug((m) => write({ t: Date.now(), debug: m }));
}

ipcHandle('app:openExternal', async (_e, url: unknown) => {
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
    // spec 030 FR-040: the adapter says whether its switch was checked on a real account and whether it has a context tier
    modelControl: modelControlFor(ad, { unverified: !ad.capabilities.modelSwitch?.verified, contextTier: ad.capabilities.modelSwitch?.contextTier }),
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
  // Cap: explicit choice (null = none) > the folder's saved cap > the global default (spec 011); a dollar cap only when chosen (FR-150).
  const usdCap = ad.capabilities?.capUnit === 'usd';
  draft.maxAiCredits = startCap(ad.capabilities?.capUnit, opts.maxAiCredits, folderStore?.get(wsKey(draft))?.maxAiCredits, settingsStore?.defaultMaxAiCredits);
  const id = await ad.start({ ...startOptionsFor(draft), resumeSessionId: opts.resumeSessionId });
  router.bind(id, adapterId);
  const saved = folderStore?.get(wsKey(draft));
  const info: AgentInfo = { ...draft, id, hidden: saved?.hidden, closed: saved?.closed, label: saved?.label, defaultAgent: saved?.defaultAgent };
  agents.set(id, info);
  if (opts.persist) folderStore?.upsert({ workspace: wsKey(info), permMode, model, effort, maxAiCredits: usdCap ? saved?.maxAiCredits : info.maxAiCredits, floor: opts.floor, adapterId });
  // An existing folder keeps its floor; a new one gets the chosen floor (spec 033 FR-006).
  info.floor = folderStore?.floorOfFolder(wsKey(info)) ?? GROUND;
  if (!opts.silent) toRenderer('agent:added', info);
  return info;
}

/** Make sure the agent has a live runtime session: resume it by id when it has history, else start one under that id. */
const starting = new Map<string, Promise<void>>();
/** Spec 006 FR-021: agents restored as their folder's last session, how that went, until their chat asks for it (agents:wake). */
const continued = new Map<string, { resumed: boolean; title?: string }>();

async function ensureLive(a: AgentInfo): Promise<void> {
  const ad = router.forAgent(a.id);
  if (!ad) throw new Error('unknown agent');
  if (ad.isLive(a.id)) return;
  let p = starting.get(a.id);
  if (!p) {
    p = (async () => {
      let resume = false;
      if (a.resumeLast) {
        // only a session that is still one of this folder's previous sessions of this harness is resumed (constitution: resumed sessions belong to the folder)
        const others = new Set([...agents.keys()].filter((k) => k !== a.id));
        const prev = (await previousSessionsOf(ad, a.cwd, others).catch(() => [])).find((s) => s.id === a.id);
        resume = !!prev;
        continued.set(a.id, { resumed: resume, title: prev?.title });
      }
      await ad.start({ ...startOptionsFor(a), ...(resume ? { resumeSessionId: a.id } : { sessionId: a.id }), quiet: true });
      a.lazy = false;
      a.resumeLast = undefined;
    })();
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
      // FR-021: the folder's last session comes back under its own id (resumed when first needed); a harness this build lacks starts fresh.
      // Spec 052 FR-088: so does every other session that was open in the folder (at most 6), each resumed lazily the same way.
      const sessions = sessionsToRestore(f).filter((s) => registry.has(s.adapterId ?? DEFAULT_ADAPTER) && !agents.has(s.id));
      for (const ls of sessions.length ? sessions : [undefined]) {
        const kind = ls ? (ls.adapterId ?? DEFAULT_ADAPTER) : adapterId;
        const info = infoFor(f.workspace, rm.mode, ls?.id ?? randomUUID(), f.model || DEFAULT_MODEL, f.effort, { lazy: true, tier: f.contextTier, hidden: f.hidden, closed: f.closed, floor: folderStore.floorOfFolder(f.workspace), permRestored: rm.restored || undefined, maxAiCredits: router.instance(kind).capabilities?.capUnit === 'usd' ? undefined : f.maxAiCredits ?? settingsStore?.defaultMaxAiCredits }, router.instance(kind));
        if (ls) info.resumeLast = true;
        if (f.label) info.label = f.label;
        if (f.defaultAgent) info.defaultAgent = f.defaultAgent;
        router.bind(info.id, kind);
        agents.set(info.id, info);
      }
    } catch {
      /* folder gone or not a folder any more */
    }
  }
}

ipcHandle('app:version', () => app.getVersion());
ipcHandle('app:sinceAway', (e) => (fromApp(e) ? sinceAway : null));
ipcHandle('app:dismissSinceAway', (e) => {
  if (fromApp(e)) sinceAway = null;
  return { ok: true };
});
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

// ---- Previous sessions of a folder (Copilot CLI/SDK store, resumable) and VS Code chat history (read-only) ----
// The renderer only ever names an agent and an opaque id; folders and file paths are resolved here.
const vsUserDirs = (): UserDir[] =>
  dev.DURBAR_VSCODE_USER_DIR ? [{ product: 'Test', dir: dev.DURBAR_VSCODE_USER_DIR }] : vscodeUserDirs();
const vsChatRefs = new Map<string, Map<string, ChatFileRef>>();

// Spec 006 FR-024..FR-032: the list, pin/hide and delete bodies live in prevsessions.ts. `sessions:delete` exists only here, on the
// window's own IPC (ipcHandle): the MCP tools, remote control, schedules and agents have no path to it (scripts/test-prevsessions.ts).
const prevDeps: PrevDeps = { agents, router, get store() { return folderStore; }, wsKey, resumeIdFor: (id) => resumeIdFor(id), appName: (a) => registry.get(a.adapterId)?.displayName ?? a.adapterId, log: (a, decision, action) => logActivity(a, decision, action) };
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
    const info = await addWorkspace(a.workspaceFile ?? a.cwd, a.permMode, { resumeSessionId: sessionId, silent: true, adapterId: router.adapterIdOf(a.id) });
    let history: ResumeResult['history'];
    try {
      history = await historyOf(router.forAgent(info.id) ?? ad, info.id);
    } catch {
      history = { items: [], total: 0, truncated: false };
    }
    let removedId: string | undefined;
    folderStore?.addOpenSession(wsKey(info), resumeIdFor(info.id), router.adapterIdOf(info.id)); // spec 052 FR-088: a resumed session is open in the folder and comes back after a restart
    if (replace === true) {
      removedId = id as string;
      forgetOpenSession(wsKey(a), removedId);
      await ad.stop(removedId);
      router.unbind(removedId);
      agents.delete(removedId);
      agentState.remove(removedId);
      scheduler?.sessionsChanged(); // spec 044 FR-014: a schedule for the replaced session pauses
    }
    if (prev.title && prev.title !== 'Untitled session') info.title = prev.title; // the list's title (name, else summary) until the runtime sends its own
    return { ok: true, agent: info, removedId, title: prev.title, history };
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

ipcHandle('agents:pickAttachments', async (_e, want: unknown): Promise<PickedFile[]> => {
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

ipcHandle('agents:stageAttachment', (_e, name: unknown, mime: unknown, data: unknown) => {
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

ipcHandle('agents:send', async (_e, id: string, text: string, attachments: PickedFile[]) => {
  const ad = agents.has(id) ? router.forAgent(id) : undefined;
  if (!ad) return { ok: false, error: 'unknown agent' };
  agentState.ensure(id, agents.get(id)?.lazy);
  agentState.noteSend(id); // the window shows Thinking from the moment the user sends (app.js sendLive)
  const r = await sendOp(id, text, attachments, ad);
  if (!r.ok) agentState.noteSendFailed(id); // and Error when the send fails (app.js sendLive)
  return r;
});
// ---- spec 065: undo an agent's file changes per turn (copies kept just before each file-edit write, while the app runs) ----
let checkpointStore: CheckpointStore | undefined;
const checkpoints = (): CheckpointStore => (checkpointStore ??= new CheckpointStore(path.join(app.getPath('userData'), 'checkpoints')));
const rootsOf = (a: AgentInfo): string[] => (a.folders?.length ? a.folders : [a.cwd]);
router.setWriteGuard(async (sid, paths) => {
  const a = agents.get(sid);
  if (!a) return;
  for (const p of paths) checkpoints().capture(sid, rootsOf(a), p);
});
router.onEvent((e) => {
  if (e.type !== 'status' || e.agentId || (e.status !== 'idle' && e.status !== 'stopped' && e.status !== 'error')) return;
  const s = checkpointStore?.endTurn(e.sessionId);
  if (s) toRenderer('agents:checkpoint', { id: e.sessionId, ...s });
});
const checkpointArgs = (id: unknown, turn: unknown): string | undefined => (typeof id === 'string' && agents.has(id) && Number.isInteger(turn) && (turn as number) > 0 ? id : undefined);
ipcHandle('agents:checkpointPreview', (e, id: unknown, turn: unknown) => {
  const a = fromApp(e) ? checkpointArgs(id, turn) : undefined; // FR-005: Durbar's own window only, never MCP, remote control or schedules
  return a && checkpointStore ? checkpointStore.preview(a, turn) : { ok: false, error: 'invalid request' };
});
ipcHandle('agents:checkpointUndo', (e, id: unknown, turn: unknown) => {
  const a = fromApp(e) ? checkpointArgs(id, turn) : undefined;
  if (!a || !checkpointStore) return { ok: false, error: 'invalid request' };
  if (busyStatus(a)) return { ok: false, error: 'The agent is working. Stop it or wait for the turn to end, then undo.' };
  return checkpointStore.undo(a, turn);
});

async function sendOp(id: string, text: string, attachments: PickedFile[], ad: AgentAdapter): Promise<{ ok: boolean; error?: string }> {
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
    checkpoints().beginTurn(id, rootsOf(agents.get(id) as AgentInfo)); // spec 065 FR-002: a send starts a turn (scheduled prompts too)
    await ad.send(id, {
      text: String(text),
      attachments: safe.map((a) => ({ path: a.path, kind: kindOfFile(a.path) })), // FR-009: checked again here, the renderer's kind is not trusted
    });
    for (const a of safe) pickedFiles.delete(a.path); // spec 004 FR-015: a sent file must be picked again to be sent again
    noteLastSession(agents.get(id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- scheduled prompts (spec 044): per folder, while the app runs; the run goes through the user's own send path ----
let scheduler: Scheduler | undefined;
const folderAgent = (folder: string): AgentInfo | undefined => [...agents.values()].find((x) => wsKey(x) === folder);
/** The session a schedule runs in: its target (FR-014), only while that session is in this folder, else the folder's agent. */
const scheduleAgent = (s: { folder: string; target?: { session: string } }): AgentInfo | undefined => {
  if (!s.target) return folderAgent(s.folder);
  const a = agents.get(s.target.session);
  return a && wsKey(a) === s.folder ? a : undefined;
};
const busyStatus = (id: string): boolean => ['working', 'needs-permission'].includes(lastStatus.get(id) ?? '');
const scheduleDeps = (file: string): SchedulerDeps => ({
  now: () => Date.now(),
  isBusy: (folder, session) => (session ? busyStatus(session) : [...agents.values()].some((x) => wsKey(x) === folder && busyStatus(x.id))),
  hasSession: (session) => agents.has(session),
  capUnitOf: (s) => {
    const a = scheduleAgent(s);
    const caps = a ? router.forAgent(a.id)?.capabilities : undefined;
    if (!caps) return undefined;
    const unit = caps.capUnit === 'usd' ? 'usd' : 'aiu';
    return (unit === 'usd' ? caps.usage.costUsd : caps.usage.nanoAiu) ? unit : undefined; // FR-015: a limit needs the spend in that unit
  },
  send: async (folder, prompt, s) => {
    const a = scheduleAgent(s);
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return false;
    agentState.ensure(a.id, a.lazy);
    agentState.noteSend(a.id); // same as the interactive send: the window shows Thinking from the moment a prompt goes out
    try {
      await ensureLive(a);
      toRenderer('agent:event', { type: 'user', sessionId: a.id, timestamp: Date.now(), text: prompt });
      toRenderer('schedule:ran', { agentId: a.id, scheduleId: s.id, every: s.every, at: s.at, rule: s.rule });
      await ad.send(a.id, { text: prompt });
      noteLastSession(a);
    } catch (err) {
      agentState.noteSendFailed(a.id);
      throw err;
    }
    return a.id;
  },
  setTimer: (ms, fn) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
  save: (doc) => saveSchedules(file, doc),
  changed: (doc) => toRenderer('schedules:changed', doc),
});
ipcHandle('schedules:list', () => scheduler?.doc ?? { pausedAll: false, schedules: [] });
ipcHandle('schedules:save', (e, input: unknown) => (!fromApp(e) ? { ok: false, error: 'invalid request' } : scheduler ? scheduler.save(input, (f) => !!folderStore?.get(f)) : { ok: false, error: 'Schedules are not available.' }));
ipcHandle('schedules:remove', (e, id: unknown) => ({ ok: fromApp(e) && typeof id === 'string' && !!scheduler?.remove(id) }));
// spec 052 FR-089: "Run missed now" from the Since you were away card: one run through the same send path as a scheduled one
ipcHandle('schedules:runNow', async (e, id: unknown) => (!fromApp(e) || typeof id !== 'string' || id.length > 100 ? { ok: false, error: 'invalid request' } : scheduler ? scheduler.runNow(id) : { ok: false, error: 'Schedules are not available.' }));
ipcHandle('schedules:setPausedAll', (_e, on: unknown) => {
  scheduler?.setPausedAll(on === true);
  return { ok: !!scheduler, pausedAll: scheduler?.doc.pausedAll ?? false };
});

// The handler bodies that refuse a setting a live session cannot take live in agentops.ts (spec 012 FR-054); `store` is read when a handler runs.
const opsDeps: OpsDeps = { agents, router, get store() { return folderStore; }, wsKey, log: (a, decision, action) => logActivity(a, decision, action) };
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

// ---- AI-credit caps (spec 011): numbers only, validated here ----
ipcHandle('usage:allTime', () => ({
  doc: usageStore?.view(),
  labels: Object.fromEntries([...agents.values()].map((a) => [a.id, usageLabel(a)])),
  error: usageStore?.lastError,
}));
ipcHandle('usage:totals', () => usageTotalsView());
ipcHandle('usage:resetTotals', () => {
  usageTotalsStore?.reset();
  return usageTotalsView();
});
ipcHandle('usage:reset', () => {
  usageStore?.reset();
  return { ok: true, doc: usageStore?.view() };
});
ipcHandle('settings:get', () => ({ defaultMaxAiCredits: settingsStore?.defaultMaxAiCredits, placeMap: settingsStore?.placeMap ?? {}, customPlaces: settingsStore?.customPlaces ?? [], seriousMode: settingsStore?.seriousMode ?? false, notifyNeedsMe: settingsStore?.notifyNeedsMe ?? true, theme: runTheme ?? settingsStore?.theme ?? 'clean-office', about: aboutView(app.getVersion()) }));
ipcHandle('settings:setSeriousMode', (_e, on: unknown) => ({ ok: true, seriousMode: settingsStore?.setSeriousMode(on) ?? false }));
/* spec 052 FR-059: OS notifications when an agent needs you and the window is in the background (on unless turned off) */
ipcHandle('settings:setNotifyNeedsMe', (_e, on: unknown) => ({ ok: true, notifyNeedsMe: settingsStore?.setNotifyNeedsMe(on) ?? true }));
/* spec 052 FR-059: the "needs you" count on the app icon (macOS, Linux where the desktop supports it), a taskbar flash on Windows */
let badgeCount = 0;
ipcHandle('app:setBadge', (_e, count: unknown) => {
  const n = parseBadgeCount(count);
  if (n === null) return { ok: false };
  const w = win && !win.isDestroyed() ? win : undefined;
  if (w && shouldFlash(badgeCount, n, w.isFocused())) w.flashFrame(true);
  if (w && shouldBounce(badgeCount, n, w.isFocused())) app.dock?.bounce('informational'); // spec 052 FR-085: one bounce, not until focused
  if (w && n === 0) w.flashFrame(false);
  badgeCount = n;
  if (process.platform !== 'win32') {
    try {
      app.setBadgeCount(n);
    } catch {
      /* not supported by this desktop: the window title still shows the count */
    }
  }
  return { ok: true };
});
/* spec 052 FR-059: a click on a notification brings the window to the front */
ipcHandle('app:focusWindow', () => {
  const w = win && !win.isDestroyed() ? win : undefined;
  if (!w) return { ok: false };
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return { ok: true };
});
/* DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it and is saved as usual. */
let runTheme: string | undefined;
ipcHandle('settings:setTheme', (_e, id: unknown) => {
  runTheme = undefined;
  return settingsStore ? settingsStore.setTheme(id) : { ok: false };
});
/* User themes (spec 040): `userData/themes/<id>/manifest.json`, import/export by folder pick. Dev hook DURBAR_PICK answers the dialog in checks. */
const userThemes = new UserThemeStore(path.join(app.getPath('userData'), 'themes'));
const BUILT_IN_THEME_IDS = ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];
const pickFolder = async (title: string, create = false): Promise<string | null> => {
  if (dev.DURBAR_PICK) { const first = dev.DURBAR_PICK.split(path.delimiter)[0]; return first || null; } // path.delimiter keeps C:\ paths whole (spec 040 FR-008)
  // spec 040 FR-019: an export target may be a new folder (macOS shows "New Folder" only with createDirectory)
  const r = await dialog.showOpenDialog({ title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
};
/* Spec 040 FR-014..FR-021: the AI theme maker. One prompt to a harness that has `generateText` (no tools, no session kept); the
   reply keeps only the safe subset and must pass the contrast rules and `checkUserManifest`. The description is never logged. */
ipcHandle('theme:generate', async (_e, description: unknown, adapterId: unknown) => {
  const d = typeof description === 'string' ? description.trim().slice(0, MAX_DESCRIPTION) : '';
  if (d.length < 3) return { ok: false, error: 'Describe the look in a few words.' };
  const kind = typeof adapterId === 'string' && registry.has(adapterId) ? adapterId : undefined;
  const ad = kind ? router.instance(kind) : undefined;
  if (!ad || typeof ad.generateText !== 'function') return { ok: false, error: 'That agent app cannot make a theme. Pick Claude Code, Codex or Copilot.' };
  // the renderer's own theme module: Clean Office's tokens and the art sanitizer, so the result is exactly what the app draws
  const T = require(path.join(__dirname, '..', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null };
  // main never sets a theme on this module, so `_tokens()` is Clean Office's full set
  const ctx = { clean: T._tokens(), sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: (id: string) => BUILT_IN_THEME_IDS.includes(id) || userThemes.list().some((t) => t.id === id) };
  let cost = 0;
  let nano = 0;
  // Copilot loads the servers of ~/.copilot/mcp-config.json and its built-in one by itself: all of them are switched off by name (FR-015)
  const genOpts = kind === 'copilot' ? { disabledMcpServers: cliServers(copilotDir(dev), new Set()).servers.map((s) => s.name) } : {};
  const ask = async (prompt: string): Promise<string> => {
    const r = await ad.generateText!(prompt, genOpts);
    if (r.costUsd) cost += r.costUsd;
    if (r.nanoAiu) nano += r.nanoAiu;
    return r.text;
  };
  try {
    // spec 040 FR-020: up to three passes; Durbar checks, the model fixes what failed
    let g = parseGeneratedTheme(await ask(buildThemePrompt(d, ctx.clean)), d, ctx);
    let passes = 1;
    // a reply that could not be used at all gets the request again (it counts as a pass)
    while (!g.ok && passes < MAX_PASSES) {
      g = parseGeneratedTheme(await ask(buildRetryPrompt(d, ctx.clean, g.error)), d, ctx);
      passes++;
    }
    while (g.ok && g.issues.length && passes < MAX_PASSES) {
      const next = parseGeneratedTheme(await ask(buildFixPrompt(g.raw, g.issues)), d, ctx);
      passes++;
      if (next.ok && next.issues.length <= g.issues.length) g = keepArt(next, g); // keep the better one, with the earlier art; a broken fix keeps the last good theme
    }
    const costPart = { ...(cost ? { costUsd: cost } : {}), ...(nano ? { nanoAiu: nano } : {}) };
    if (!g.ok) return { ok: false, error: g.error, ...costPart };
    // a top bar that is still unreadable after the passes: the Clean style, whose top bar follows --surface and --ink (FR-020)
    if (g.issues.some((i) => i.startsWith(TOP_BAR_ISSUE))) {
      g = { ...g, manifest: { ...g.manifest, ui: 'clean' }, issues: g.issues.filter((i) => !i.startsWith(TOP_BAR_ISSUE)), warnings: [...g.warnings, 'the UI style was changed to clean so the top bar stays readable'] };
    }
    const blocking = g.issues.filter(isBlocking);
    if (blocking.length) return { ok: false, error: `Text would still be hard to read after ${passes} passes: ${blocking[0]}. Try again or change the description.`, ...costPart };
    return { ok: true, manifest: g.manifest, warnings: [...g.warnings, ...g.issues], passes, ...costPart };
  } catch (err) {
    return { ok: false, error: errText(err), ...(cost ? { costUsd: cost } : {}), ...(nano ? { nanoAiu: nano } : {}) };
  }
});
ipcHandle('theme:ideas', () => THEME_IDEAS.slice());
/* Spec 051: harness setup inside the app. One fixed install, update or sign-in at a time (argv, no shell); progress and the end go to
   the window; detection runs again when it ends. Nothing of the output is logged. */
const sysExe = (name: string): string => path.win32.join(process.env.SystemRoot && path.win32.isAbsolute(process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows', 'System32', name);
const harnessSetup = new HarnessSetup({
  detectEnv: nodeDetectEnv(),
  spawn: (file, args, opts) => spawn(file, args as string[], opts),
  killTree: (c) => {
    const pid = c.pid;
    if (!pid) return;
    if (process.platform === 'win32') execFile(sysExe('taskkill.exe'), ['/pid', String(pid), '/t', '/f'], () => undefined);
    else {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
      // no SIGKILL once it has exited: its group id could already belong to something else
      const cp = c as unknown as { exitCode: number | null; signalCode: string | null };
      setTimeout(() => { if (cp.exitCode !== null || cp.signalCode !== null) return; try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
    }
  },
  send: (channel: string, p: unknown) => toRenderer(channel, p),
  redetect: async () => { await adaptersList(true); },
  // spec 012 FR-158: only an adapter already created is refreshed (none is created here); Copilot restarts its shared client
  afterSignIn: async (kind: string) => {
    const ad = router.created().find((x) => x.id === kind);
    if (!ad?.refreshAuth) return;
    // spec 012 FR-158 / 054 FR-011: a reconnected session is not remote any more; say so instead of keeping a stale Remote chip
    for (const id of remoteOps.ids()) if (router.adapterIdOf(id) === kind) { remoteOps.forget(id); toRenderer('agents:remoteOff', id); }
    await ad.refreshAuth();
  },
  realpath: (p: string) => fs.realpathSync(p),
  trustedPath: (p: string) => process.platform === 'win32' || posixTrusted(p, (q) => fs.statSync(q).mode),
} as ConstructorParameters<typeof HarnessSetup>[0]);
/** FR-004b: harness setup answers only the app's own page in the main frame. */
const fromApp = (e: Electron.IpcMainInvokeEvent): boolean => senderAllowed(e.senderFrame ? { url: e.senderFrame.url, isMain: e.senderFrame === e.sender.mainFrame } : null, path.join(__dirname, '..', 'renderer', 'index.html'));
ipcHandle('harness:plans', (e, kind: unknown, op: unknown) => (fromApp(e) && isSetupKind(kind) && (op === 'install' || op === 'update') ? harnessSetup.plans(kind, op) : { plans: [], page: '', name: '' }));
ipcHandle('harness:run', async (e, kind: unknown, op: unknown, planIndex: unknown) => {
  if (!fromApp(e) || !isSetupKind(kind) || (op !== 'install' && op !== 'update' && op !== 'signin')) return { ok: false, error: 'invalid request' };
  const p = harnessSetup.prepare(kind, op, typeof planIndex === 'number' && Number.isInteger(planIndex) && planIndex >= 0 && planIndex < 8 ? planIndex : 0);
  if (!p.ok) return p;
  // FR-004b: an install or update changes the computer, so the main process asks itself, in a native dialog the page cannot
  // answer, showing the real path and arguments. Sign-in runs the harness's own fixed login and changes nothing else.
  if (op !== 'signin') {
    const t = confirmText(p.job);
    const opts = { type: 'question' as const, buttons: ['Cancel', t.button], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar', message: t.message, detail: t.detail };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 1) return { ok: false, cancelled: true, error: 'Cancelled.' };
  }
  return harnessSetup.start(p.job);
});
ipcHandle('harness:paste', (e, text: unknown) => (fromApp(e) ? harnessSetup.paste(text) : { ok: false, error: 'invalid request' }));
ipcHandle('harness:cancel', (e) => fromApp(e) && harnessSetup.cancel());
ipcHandle('harness:openPage', async (e, kind: unknown) => {
  if (!fromApp(e) || !isSetupKind(kind)) return { ok: false };
  await shell.openExternal(OFFICIAL_PAGES[kind]);
  return { ok: true };
});
ipcHandle('harness:openSignIn', async (e, kind: unknown, url: unknown) => {
  // FR-005: only a link on that harness's own sign-in hosts is ever opened, and the parsed, normalised form of it
  if (!fromApp(e) || !isSetupKind(kind) || typeof url !== 'string' || !allowedSignInUrl(kind, url)) return { ok: false };
  await shell.openExternal(new URL(url).href);
  return { ok: true };
});
ipcHandle('harness:copilotAuth', async (e) => {
  if (!fromApp(e)) return { known: false };
  const pw = harnessSetup.pwshMissing() ? { pwshMissing: true } : {}; // spec 052 FR-073: Windows only, a file check, no process
  try {
    const ad = registry.has('copilot') ? router.instance('copilot') : undefined;
    if (!ad || typeof ad.authStatus !== 'function') return { known: false, ...pw };
    return { known: true, ...(await ad.authStatus()), ...pw };
  } catch {
    return { known: false, ...pw };
  }
});
ipcHandle('theme:saveGenerated', (_e, manifest: unknown) => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, error: 'invalid theme' };
  return userThemes.saveManifest(manifest as Record<string, unknown>, (id) => BUILT_IN_THEME_IDS.includes(id));
});
ipcHandle('theme:listUser', () => userThemes.list().map((t) => ({ id: t.id, name: t.name, ok: t.ok, error: t.error })));
ipcHandle('theme:getUser', (_e, id: unknown) => (typeof id === 'string' ? userThemes.get(id) : null));
ipcHandle('theme:import', async () => {
  const dir = await pickFolder('Import a theme folder (with manifest.json)');
  if (!dir) return { ok: false, cancelled: true };
  return userThemes.importFolder(dir, (id) => BUILT_IN_THEME_IDS.includes(id));
});
ipcHandle('theme:export', async (_e, id: unknown) => {
  if (typeof id !== 'string' || BUILT_IN_THEME_IDS.includes(id)) return { ok: false, error: 'Only your own imported themes can be exported.' };
  const dir = await pickFolder('Export the theme folder to…', true);
  if (!dir) return { ok: false, cancelled: true };
  return userThemes.exportFolder(id, dir);
});
ipcHandle('settings:setPlace', (_e, server: unknown, place: unknown) => settingsStore?.setPlace(server, place) ?? { ok: false });
ipcHandle('settings:addPlace', (_e, name: unknown, icon: unknown) => settingsStore?.addPlace(name, icon) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcHandle('settings:updatePlace', (_e, id: unknown, patch: unknown) => settingsStore?.updatePlace(id, patch) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcHandle('settings:removePlace', (_e, id: unknown) => settingsStore?.removePlace(id) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
ipcHandle('settings:setDefaultCap', (_e, credits: unknown) => ({ ok: true, defaultMaxAiCredits: settingsStore?.setDefaultMaxAiCredits(credits) }));

// Activity log (spec 052 FR-071): read, export through the save dialog, clear (the window asks first).
ipcHandle('activity:list', (e, opts: unknown) => {
  if (!fromApp(e)) return { ok: false, rows: [] };
  const limit = opts && typeof opts === 'object' ? (opts as { limit?: unknown }).limit : undefined;
  return { ok: true, rows: activityStore?.list(limit) ?? [] };
});
ipcHandle('activity:export', async (e, format: unknown) => {
  if (!fromApp(e) || (format !== 'csv' && format !== 'json')) return { ok: false, error: 'invalid request' };
  const day = new Date().toISOString().slice(0, 10);
  const opts: Electron.SaveDialogOptions = { title: 'Export activity', defaultPath: `durbar-activity-${day}.${format}`, filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }] };
  const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  const rows = activityStore?.all() ?? [];
  try {
    fs.writeFileSync(r.filePath, format === 'csv' ? activityCsv(rows) : activityJson(rows), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, count: rows.length, to: path.basename(r.filePath) };
  } catch (err) {
    return { ok: false, error: errText(err).slice(0, 160) };
  }
});
ipcHandle('activity:clear', (e) => {
  if (!fromApp(e)) return { ok: false };
  activityStore?.clear();
  return { ok: true };
});

ipcHandle('agents:setCap', async (_e, id: unknown, credits: unknown) => {
  return setCapOp(opsDeps, id, credits);
});

// spec 012 FR-128: the user's answer to an agent's question; strings only, capped; null = skipped
ipcHandle('agents:answerQuestion', (_e, id: unknown, requestId: unknown, answers: unknown) => {
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

// spec 012 FR-151: the answer to an MCP elicitation, checked here against the open request (types, choices, lengths, required).
// The values are never logged: they can be secrets.
ipcHandle('agents:answerElicitation', (_e, id: unknown, requestId: unknown, action: unknown, values: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  const req = a && typeof requestId === 'string' && requestId.length <= 300 ? elicitTracker.get(a.id, requestId) : undefined;
  if (!a || !ad?.answerElicitation || !req) return { ok: false, error: 'That request is no longer open.' };
  const r = checkElicitAnswer(req, action, values);
  if (!r.ok) return { ok: false, error: r.error, ...(r.field ? { field: r.field } : {}) };
  ad.answerElicitation(a.id, requestId as string, r.answer);
  return { ok: true };
});
// spec 012 FR-151: open the request's own https address (never one sent by the window), only after the user clicked
ipcHandle('agents:openElicitationUrl', async (_e, id: unknown, requestId: unknown) => {
  const req = typeof id === 'string' && typeof requestId === 'string' && requestId.length <= 300 ? elicitTracker.get(id, requestId) : undefined;
  const u = req?.url ? elicitHttpsUrl(req.url) : undefined;
  if (!u) return { ok: false, error: 'That request has no https page to open.' };
  await shell.openExternal(u.url);
  return { ok: true };
});

// ---- custom agent per session (spec 043 FR-003): list, select; a repository agent needs a confirmation for its exact file ----
ipcHandle('agents:listProfiles', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad?.listAgentProfiles) return { ok: false, error: 'This agent app has no profiles.', profiles: [] };
  try {
    await ensureLive(a); // a restored or ended agent starts its session (no prompt, no credits)
    const profiles = (await ad.listAgentProfiles(a.id)).map((p) => ({ ...p, trusted: p.source !== 'repo' || (!!p.path && agentTrust?.isTrusted(wsKey(a), p.id, hashAgentFile(p.path))) }));
    return { ok: true, profiles };
  } catch (err) {
    return { ok: false, error: errText(err), profiles: [] };
  }
});
ipcHandle('agents:selectProfile', async (_e, id: unknown, profileId: unknown, confirm: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad?.selectAgentProfile) return { ok: false, error: 'This agent app has no profiles.' };
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

/** The last list of models the account offers; a switch request is checked against it (spec 030 FR-018). */
let lastModels: ModelChoice[] = [];
const modelsForValidation = async (): Promise<ModelChoice[]> => {
  if (!lastModels.length) lastModels = (await modelOptionsOf(router.instance(registry.defaultId))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
  return lastModels;
};
const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

ipcHandle('agents:setModel', async (_e, id: unknown, raw: unknown) => {
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

ipcHandle('agents:cancelQueuedModel', async (_e, id: unknown, queueId: unknown) => {
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

// Spec 030 FR-034: a hand-off summary of a live session (user content: never logged; shown for editing in the window).
ipcHandle('agents:handoff', async (_e, id: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof ad.handoffSummary !== 'function') return { ok: false, error: 'This agent app cannot make a summary.' };
  if (!ad.isLive(a.id)) return { ok: false, error: 'This session has not started yet, so there is nothing to summarize.' };
  try {
    const r = await ad.handoffSummary(a.id);
    return { ok: true, summary: r.summary, ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
});

// Spec 054 FR-003..FR-005: remote control of a live session (Copilot: github.com and GitHub Mobile). Validated in remoteops.ts; nothing is logged.
const remoteOps = createRemoteOps({
  known: (id) => agents.has(id),
  adapterOf: (id) => router.forAgent(id),
  open: (url) => shell.openExternal(url),
  modeOf: (id) => agents.get(id)?.permMode,
  // FR-011: a native confirmation the page cannot answer (Cancel is the default), like harness setup's (spec 051 FR-004b)
  confirm: async (id) => {
    const a = agents.get(id);
    const opts = {
      type: 'warning' as const, buttons: ['Cancel', 'Turn on remote control'], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar',
      message: `Control ${a?.label || a?.name || 'this session'} from GitHub?`,
      detail: 'Its messages are sent to GitHub, so it can be followed and steered from github.com and GitHub Mobile. Anyone who can see the session on GitHub can steer it.\n\nOnly continue if you started this in Durbar.',
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return r.response === 1;
  },
  record: (id, on) => {
    const a = agents.get(id);
    if (a) logActivity(a, on ? 'remote-on' : 'remote-off', on ? 'Remote control from GitHub turned on' : 'Remote control from GitHub turned off');
  },
});
router.onEvent((e) => {
  if (e.type === 'status' && e.status === 'stopped' && !e.agentId) remoteOps.forget(e.sessionId);
});
// spec 054 FR-062: the adapter says remote control ended on its own (for example a relaunch could not turn it back on)
router.onEvent((e) => {
  if (e.type !== 'remote' || e.agentId) return;
  if (e.on) {
    const url = remoteOps.updateUrl(e.sessionId, e.url);
    if (url) toRenderer('agents:remoteUrl', { id: e.sessionId, url });
    return;
  }
  remoteOps.forget(e.sessionId);
  toRenderer('agents:remoteOff', { id: e.sessionId, ...(e.reason ? { reason: e.reason } : {}) });
});
ipcHandle('agents:setRemote', (e, id: unknown, on: unknown) => (fromApp(e) ? remoteOps.setRemote(id, on) : { ok: false, error: 'invalid request' }));
ipcHandle('agents:openRemote', (e, id: unknown) => (fromApp(e) ? remoteOps.openRemote(id) : { ok: false }));

ipcHandle('agents:compact', async (_e, id: unknown, focus: unknown) => {
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

ipcHandle('models:list', async (_e, kind: unknown): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }> => {
  // spec 012 FR-120: one list per agent kind; no kind = the default kind (as before); an unknown kind is refused
  const id = kind === undefined || kind === null || kind === '' ? registry.defaultId : typeof kind === 'string' && registry.has(kind) ? kind : undefined;
  if (!id) return { ok: false, error: 'unknown agent app', models: [] };
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
/** The adapter's own sign-in question, when it has one (spec 012 FR-156): `verifySignIn` (a free server call where the app has one), else `authStatus`. */
const signInCheck = (id: string): (() => Promise<SignInAnswer>) | undefined => {
  try {
    if (!registry.has(id)) return undefined;
    const ad = router.instance(id);
    if (typeof ad.verifySignIn === 'function') return () => (ad.verifySignIn as () => Promise<SignInAnswer>)();
    return typeof ad.authStatus === 'function' ? () => (ad.authStatus as () => Promise<SignInAnswer>)() : undefined;
  } catch {
    return undefined;
  }
};
/* spec 060 FR-003: the login shell's PATH, read once (at most 3 s) before the first detection; not under the simulator */
let loginPathRead: Promise<void> | undefined;
const loginPathReady = (): Promise<void> => {
  if (!loginPathRead) loginPathRead = dev.DURBAR_SIM ? Promise.resolve() : readLoginShellPath(nodeLoginPathDeps()).then((dirs) => {
    setLoginPath(dirs);
    // what is found must also run: agent apps, their probes and MCP servers start with this PATH (an nvm `claude` needs its `node`)
    if (dirs.length) process.env.PATH = mergeLoginPath(process.env.PATH, dirs);
  }, () => undefined);
  return loginPathRead;
};
const adaptersList = (refresh: boolean): Promise<AdapterInfo[]> => {
  // spec 012 FR-156: after the probes, each agent app that can tell is asked whether its sign-in works; cached until Check again
  if (!adaptersInfo || refresh) adaptersInfo = loginPathReady().then(() => detectAll(registry, (d) => detectorFor(d.id)?.(d) ?? Promise.resolve({ state: 'unknown' as const }))).then((infos) => withSignIn(infos, signInCheck));
  return adaptersInfo;
};
/** Spec 012 FR-157: a session refused because of the sign-in marks its agent app `not-signed-in` in the cached list and tells the window. */
router.onEvent((e) => {
  if (e.type !== 'status' || e.status !== 'error' || e.errorKind !== 'auth' || e.agentId) return;
  const id = agents.get(e.sessionId)?.adapterId;
  if (!id || !adaptersInfo) return;
  const before = adaptersInfo;
  adaptersInfo = before.then((infos) => markSignedOut(infos, id)).catch(() => before);
  void adaptersInfo.then((infos) => toRenderer('adapters:changed', infos)).catch(() => undefined);
});
ipcHandle('adapters:list', (_e, refresh: unknown): Promise<AdapterInfo[]> => adaptersList(refresh === true));
/** Ids whose cached state is `ready`; a failed probe counts as none (spec 012 FR-058). */
const readyAdapterIds = async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set((await adaptersList(false)).filter((i) => i.state === 'ready').map((i) => i.id));
  } catch {
    return new Set();
  }
};

ipcHandle('folders:setHidden', (_e, id: unknown, hidden: unknown) => {
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
ipcHandle('floors:state', () => floorsState());
ipcHandle('floors:create', (_e, name: unknown) => floorsResult(folderStore?.createFloor(name)));
ipcHandle('floors:rename', (_e, id: unknown, name: unknown) => floorsResult(folderStore?.renameFloor(id, name)));
ipcHandle('floors:reorder', (_e, ids: unknown) => floorsResult(folderStore?.reorderFloors(ids)));
ipcHandle('floors:delete', (_e, id: unknown) => floorsResult(folderStore?.deleteFloor(id)));
ipcHandle('floors:setOn', (_e, id: unknown, on: unknown) => floorsResult(folderStore?.setFloorOn(id, on === true)));
ipcHandle('floors:only', (_e, id: unknown) => floorsResult(folderStore?.onlyFloor(id)));
ipcHandle('floors:moveFolder', (_e, agentId: unknown, floorId: unknown): FloorsResult => {
  const a = typeof agentId === 'string' ? agents.get(agentId) : undefined;
  if (!a || !folderStore || !folderStore.moveFolder(wsKey(a), floorId)) return { ok: false, error: 'Unknown folder or floor.', state: floorsState() };
  return floorsResult({ ok: true, doc: folderStore.floors() });
});

ipcHandle('folders:setClosed', (_e, id: unknown, closed: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a) return { ok: false };
  const key = wsKey(a);
  for (const x of agents.values()) if (wsKey(x) === key) x.closed = closed === true;
  folderStore?.setClosed(key, closed === true);
  return { ok: true };
});

ipcHandle('agents:setMode', (e, id: unknown, mode: unknown, opts: unknown) => {
  if (!fromApp(e)) return { ok: false, error: 'invalid request' };
  // spec 054 FR-011: Allow all and remote control never together (anyone steering on GitHub could run commands unasked)
  if (mode === 'allow' && typeof id === 'string' && remoteOps.has(id)) return { ok: false, error: 'Stop remote control first: Allow all and remote control from GitHub are never on together.' };
  return setModeOp(opsDeps, id, mode, opts);
});

ipcHandle('folders:remove', async (_e, id: unknown) => {
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
    agentState.remove(rid);
    vsChatRefs.delete(rid);
  }
  scheduler?.sessionsChanged();
  folderStore?.remove(key);
  return { ok: true, removedIds };
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
  checkpointStore?.forget(a.id); // spec 065 FR-006
  agents.delete(a.id);
  agentState.remove(a.id);
  vsChatRefs.delete(a.id);
  scheduler?.sessionsChanged(); // spec 044 FR-014: a schedule for this session pauses and says so
  return { ok: true };
});

ipcHandle('folders:rename', (_e, id: unknown, label: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !folderStore) return { ok: false };
  const r = folderStore.setLabel(wsKey(a), label);
  if (!r) return { ok: false };
  for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.label = r.label;
  return { ok: true, label: r.label };
});

ipcHandle('folders:setDefaultAgent', (_e, id: unknown, profileId: unknown) => {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !folderStore) return { ok: false };
  const r = folderStore.setDefaultAgent(wsKey(a), profileId);
  if (!r) return { ok: false };
  for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.defaultAgent = r.defaultAgent;
  return { ok: true, defaultAgent: r.defaultAgent };
});

/** Spec 006 FR-020: the session a folder continues after a restart is the one that last got a message. */
function noteLastSession(a: AgentInfo | undefined): void {
  if (!a) return;
  const rid = resumeIdFor(a.id); // Codex: its thread id
  folderStore?.setLastSession(wsKey(a), rid, router.adapterIdOf(a.id));
  folderStore?.addOpenSession(wsKey(a), rid, router.adapterIdOf(a.id)); // spec 052 FR-088: every open session comes back, not only the last
}
/** The id a session is resumed under after a restart (Codex: its thread id; others: the agent id). */
const resumeIdFor = (id: string): string => router.forAgent(id)?.resumeIdOf?.(id) ?? id;
/** Spec 052 FR-088: a session that leaves its folder (removed, or replaced by a resumed one) is not restored any more. Call before the session is unbound. */
function forgetOpenSession(key: string, id: string): void {
  const rid = resumeIdFor(id);
  folderStore?.removeOpenSession(key, id);
  if (rid !== id) folderStore?.removeOpenSession(key, rid);
}

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

/** Spec 052 FR-087: where the window opens: the saved place and size on a display it still fits, else 1440x900. Dev screenshot runs keep the default. */
function initialPlacement(): ReturnType<typeof placeWindow> {
  const saved = dev.DURBAR_SHOT || dev.DURBAR_DRIVER ? undefined : appState?.window;
  return placeWindow(saved, saved ? screen.getDisplayMatching(saved).workArea : undefined);
}

/** FR-087: remember the window's normal (not maximized) place and size and whether it was maximized. */
function saveWindowState(w: BrowserWindow): void {
  if (dev.DURBAR_SHOT || dev.DURBAR_DRIVER || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
  appState?.setWindow({ ...w.getNormalBounds(), maximized: w.isMaximized() });
}

/** Spec 052 FR-090: main agents in the middle of a turn (working, thinking, or waiting for an answer inside the turn). */
function workingCount(): number {
  let n = 0;
  for (const id of agents.keys()) {
    const st = agentState.get(id)?.state;
    if (busyStatus(id) || st === 'working' || st === 'thinking') n++;
  }
  return n;
}
/** FR-090: true once the user chose Quit (or nothing was working), so later close and quit events do not ask again. */
let quitConfirmed = false;
let quitAsking = false;
/** Asks once whether to quit while agents work; resolves true for Quit. Cancel is the default and the Escape answer. */
async function confirmQuit(): Promise<boolean> {
  const n = workingCount();
  if (n === 0 || dev.DURBAR_SHOT || dev.DURBAR_DRIVER) return true;
  if (quitAsking) return false;
  quitAsking = true;
  try {
    const q = quitMessage(n);
    const opts = { type: 'warning' as const, buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: 'Agent Durbar', message: q.message, detail: q.detail };
    const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return r.response === 0;
  } finally {
    quitAsking = false;
  }
}

function createWindow(): void {
  quitConfirmed = false; // macOS: a window opened again after the last one closed asks again when its agents work
  const place = initialPlacement();
  win = new BrowserWindow({
    ...place.bounds,
    useContentSize: !place.restored, // the default is the office's content size; a restored window gets back its outer bounds
    minWidth: 640,
    minHeight: 480,
    title: 'Agent Durbar',
    backgroundColor: '#f6f1e7',
    ...windowChrome(process.platform), // spec 052 FR-085: macOS hides the title bar; the top bar is the drag area (styles.css)
    // spec 008 FR-025: Windows and macOS take the icon from the .exe/.icns; Linux needs it on the window
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, '..', 'icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Links never navigate this window or open new windows; chat links go through app:openExternal (http/https only).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // spec 045 FR-004: only the app's own page, never another local file (it would get the preload bridge) or a web page
  const INDEX_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
  const guardNav = (e: { preventDefault(): void }, url: string): void => {
    if (!navigationAllowed(url, INDEX_HTML)) e.preventDefault();
  };
  win.webContents.on('will-navigate', guardNav);
  win.webContents.on('will-redirect', guardNav);
  // spec 045 FR-005: Electron grants web permissions by default; this page needs only clipboard writes (Copy buttons) and notifications (spec 052 FR-059)
  win.webContents.session.setPermissionRequestHandler((_wc, permission, done) => done(permissionAllowed(permission)));
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission));
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
  win.on('focus', () => win?.flashFrame(false)); // spec 052 FR-059: the taskbar flash stops when you come back
  {
    // spec 052 FR-085 / FR-087 / FR-090: on macOS closing the window hides it (the agents keep running; ⌘Q quits);
    // elsewhere it asks first while agents work (closing ends their sessions); either way the window's place is remembered
    const w = win;
    w.on('close', (ev) => {
      if (hideOnClose(process.platform, quitting)) {
        ev.preventDefault();
        saveWindowState(w);
        if (w.isFullScreen()) {
          w.once('leave-full-screen', () => w.hide()); // hiding a full-screen window would leave an empty Space
          w.setFullScreen(false);
        } else w.hide();
        return;
      }
      if (!quitConfirmed && workingCount() > 0 && !dev.DURBAR_SHOT && !dev.DURBAR_DRIVER) {
        ev.preventDefault();
        void confirmQuit().then((ok) => {
          if (!ok) return;
          quitConfirmed = true;
          w.close();
        });
        return;
      }
      saveWindowState(w);
    });
    // the top bar drops the room it keeps for the traffic lights while the window is full screen (macOS only, see styles.css)
    w.on('enter-full-screen', () => toRenderer('window:fullScreen', true));
    w.on('leave-full-screen', () => toRenderer('window:fullScreen', false));
  }
  win.webContents.on('did-finish-load', () => agentState.clearPaused()); // a fresh page starts with nobody paused (Paused is window-only, spec 041 T014)
  void win.loadFile(INDEX_HTML, { query });
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
  // spec 052 FR-083: a Mac menu from roles (Settings… ⌘,); no menu on Windows and Linux (no Reload or DevTools for users)
  const menu = appMenuTemplate(process.platform, {
    openSettings: () => {
      const w = win && !win.isDestroyed() ? win : undefined;
      if (!w) return;
      w.show();
      toRenderer('menu:settings', null);
    },
    openRepo: () => void shell.openExternal(REPO_URL),
  });
  Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu) : null);
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
  appState = new AppStateStore(path.join(app.getPath('userData'), 'durbar-app-state.json'));
  appState.load();
  const startedAt = Date.now();
  const quitAt = appState.quitAt;
  appState.setQuitAt(undefined); // spec 052 FR-089: a crash leaves no quit time, so it never shows a wrong "away" time
  activityStore = new ActivityStore(path.join(app.getPath('userData'), 'activity.json'));
  activityStore.load();
  sweepStaleStageDirs(os.tmpdir()); // spec 004 FR-010: staging folders a crash left behind
  agentTrust = new AgentTrustStore(path.join(app.getPath('userData'), 'durbar-agent-trust.json'));
  agentTrust.load();
  usageTotalsStore.load();
  restoreFolders();
  {
    const file = path.join(app.getPath('userData'), 'durbar-schedules.json');
    scheduler = new Scheduler(loadSchedules(file, Date.now()), scheduleDeps(file));
    scheduler.start(); // missed once-runs are marked, intervals continue from now (spec 044 FR-002)
    // spec 052 FR-089: the Since you were away card, from the saved quit time and the runs the scheduler just marked missed
    sinceAway = buildSinceAway(quitAt, startedAt, scheduler.doc.schedules, (f) => folderStore?.get(f)?.label ?? folderNameOf(/\.code-workspace$/i.test(f) ? { workspaceFile: f, cwd: f } : { cwd: f })) ?? null;
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
  // macOS: a click on the Dock icon brings back the hidden window (FR-085), or opens a new one
  app.on('activate', () => {
    if (win && !win.isDestroyed()) win.show();
    else createWindow();
  });
});

// One before-quit handler, in order (a second handler would run even after the first one called preventDefault):
// 1. spec 052 FR-090: agents still working? Ask Quit / Cancel once (the window's close handler shares the answer).
// 2. spec 052 FR-087 / FR-089: remember the window and the quit time.
// 3. spec 054 FR-011: remote control is turned off on GitHub before the app quits (best effort, at most 3 s);
// 4. spec 052 FR-085: on macOS the window only hides and window-all-closed does not fire on ⌘Q, so the agents are ended here (at most 3 s).
let remoteReleased = false;
let quitNoted = false;
let disposedOnQuit = false;
app.on('before-quit', (ev) => {
  if (!quitConfirmed) {
    if (workingCount() > 0 && !dev.DURBAR_SHOT && !dev.DURBAR_DRIVER) {
      ev.preventDefault();
      void confirmQuit().then((ok) => {
        if (!ok) return;
        quitConfirmed = true;
        app.quit();
      });
      return;
    }
    quitConfirmed = true;
  }
  quitting = true; // only once the quit is confirmed: after a Cancel, closing the window on macOS still only hides it
  if (!quitNoted) {
    quitNoted = true;
    if (win && !win.isDestroyed()) saveWindowState(win);
    appState?.setQuitAt(Date.now());
  }
  const release = !remoteReleased && remoteOps.ids().length > 0;
  const dispose = !disposedOnQuit && disposeOnQuit(process.platform);
  if (!release && !dispose) return;
  ev.preventDefault();
  remoteReleased = true;
  disposedOnQuit = true;
  const capped = (p: Promise<unknown>): Promise<unknown> => Promise.race([p, new Promise((r) => setTimeout(r, 3000))]);
  void (release ? capped(Promise.all(remoteOps.ids().map((id) => remoteOps.release(id)))) : Promise.resolve())
    .then(() => (dispose ? capped(router.disposeAll()) : undefined))
    .catch(() => undefined)
    .finally(() => app.quit());
});
app.on('will-quit', () => {
  usageStore?.flush();
  usageTotalsStore?.flush();
  activityStore?.flush();
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
});

app.on('window-all-closed', () => {
  void router.disposeAll().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
