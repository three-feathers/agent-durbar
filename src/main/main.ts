import { FolderSetupStore } from './foldersetupstore';
import { acceptedFor, hasFolderRules, scanFolderSetupCached } from './foldersetup';
import type { FolderSetupStart } from '../shared/foldersetup';
import type { McpServerSpec } from '../shared/mcp';
import { cliServers, copilotDir } from './mcpfiles'; // spec 061 FR-015: the explainer switches Copilot's own servers off
import { parseEffort } from '../shared/effort';
import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron';
import { register as registerActivityIpc } from './ipc/activity';
import { register as registerAdaptersIpc } from './ipc/adapters';
import { register as registerAgentsIpc } from './ipc/agents';
import { register as registerAppIpc } from './ipc/app';
import { register as registerAttachmentsIpc } from './ipc/attachments';
import { register as registerCheckpointsIpc } from './ipc/checkpoints';
import { register as registerFloorsIpc } from './ipc/floors';
import { register as registerFoldersIpc } from './ipc/folders';
import { register as registerFolderSetupIpc } from './ipc/foldersetupipc';
import { register as registerHarnessIpc } from './ipc/harness';
import { register as registerModelIpc } from './ipc/model';
import { register as registerPreviousIpc } from './ipc/previous';
import { register as registerProfilesIpc } from './ipc/profiles';
import { register as registerQuestionsIpc } from './ipc/questions';
import { register as registerRemoteIpc } from './ipc/remote';
import { register as registerSchedulesIpc } from './ipc/schedules';
import { register as registerSettingsIpc } from './ipc/settings';
import { register as registerThemesIpc } from './ipc/themes';
import { register as registerUsageIpc } from './ipc/usage';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRODUCTION_DESCRIPTORS } from '../adapters/descriptors';
import { offeredDescriptors } from '../adapters/experimental';
import { createRegistry, detectAll } from '../adapters/registry';
import { detectorFor, setLoginPath } from '../adapters/detect';
import { mergeLoginPath, nodeLoginPathDeps, readLoginShellPath } from './loginpath';
import { renameOp, titleSyncOf } from './sessionnames';
import { adapterForAdd, createRouter, previousSessionsOf } from '../adapters/router';
import { restorable, validMode } from './agentops';
import type { OpsDeps } from './agentops';
import { adapterOf } from './folders';
import type { AgentAdapter, AgentEvent } from '../adapters/types';
import type { AdapterInfo } from '../shared/adapters';
import { startOptionsOf } from './startopts';
import { resolveWorkspaceCwd } from '../adapters/workspace';
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, fmtSize, kindOfFile, sweepStaleStageDirs } from '../shared/attachments';
import type { AddResult, AgentInfo, PermMode, PickedFile, SessionOptions } from '../shared/api';
import { GROUND } from '../shared/floors';
import { createElicitTracker } from '../shared/elicit';
import { CheckpointStore } from './checkpoints';
import { DEFAULT_ADAPTER, FolderStore, modeForSession, restoreMode, sessionsToRestore } from './folders';
import { AppStateStore, buildSinceAway, placeWindow, quitMessage } from './daily';
import type { SinceAway } from './daily';
import { navigationAllowed, permissionAllowed } from './hardening';
import type { ChatFileRef } from '../adapters/vscodeChat';
import { McpStore } from './mcpstore';
import { AgentStateTracker } from './mcp/agentstate';
import { maskMcpEvent, maskMcpHistory } from './mcpmask';
import { registerMcpIpc, safeStorageCodec } from './mcpipc';
import { UsageStore } from './usagestore';
import { AgentTrustStore } from './agenttrust';
import { Scheduler, loadSchedules, saveSchedules } from './schedules';
import type { SchedulerDeps } from './schedules';
import { UsageTotalsStore } from './usagetotalsstore';
import { ActivityStore } from './activitystore';
import { decisionOf } from '../shared/activity';
import type { ActivityDecision } from '../shared/activity';
import { folderKeyOf, folderNameOf } from '../shared/usagedoc';
import { agentLabel } from '../shared/toolusage';
import { devEnv, devWarning } from './devhooks';
import { markSignedOut, withSignIn } from './authcheck';
import type { SignInAnswer } from './authcheck';
import { SettingsStore } from './settings';
import { appMenuTemplate, disposeOnQuit, hideOnClose, windowChrome } from './appmenu';
import { parseCapIn, parseThemeId, startCap } from '../shared/credits';
import { broadFolderKind } from '../shared/broadfolder';
import { REPO_URL, aboutPanelOptions } from '../shared/about';
import { modelControlFor } from '../shared/modelswitch';
import { createDebugSink } from '../shared/redact';
import { profileDir } from './profiledir';
import { debugSwitchesToRemove } from './debugguard';
import { aumidToSet } from './aumid';

// Spec 008 FR-038: no DevTools endpoint in a packaged build. No fuse covers these switches; removing them before ready is shown to work on the packed Linux app (npm run check:fuses-launch).
for (const sw of debugSwitchesToRemove(app.isPackaged)) app.commandLine.removeSwitch(sw);

// Spec 008 FR-043: packaged Windows only, before ready and any window, so toasts and the taskbar button use the Start menu shortcut's AUMID (build.appId).
const aumid = aumidToSet(process.platform, app.isPackaged);
if (aumid) app.setAppUserModelId(aumid);

// Developer/test hooks (spec 010): ignored in packaged builds unless DURBAR_DEV=1. Read hooks only from `dev`.
const dev = devEnv(process.env, app.isPackaged);
const devNote = devWarning(process.env, app.isPackaged);
if (devNote) console.error(devNote);
// Spec 008 FR-103: a test run's window is never treated as hidden when another window covers it (the Windows CI desktop and a shared
// X display run several drivers at once). Chromium then stops animation frames and throttles timers, so the page stopped drawing mid-check.
if (dev.DURBAR_DRIVER || dev.DURBAR_SHOT) app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Cheapest routing on the logged-in account's only model ("auto"); see docs/milestone-1.md.
// Profile folder chosen in code (spec 008 FR-034): packaged `<appData>/agent-durbar`, dev `<appData>/agent-durbar-dev`.
// Dev/test: DURBAR_USER_DATA=/tmp/x wins and keeps the saved folder list (and Electron's other state) out of the real profile.
// Must stay before anything reads the userData folder and before `whenReady`.
app.setPath('userData', profileDir({ packaged: app.isPackaged, platform: process.platform, appData: app.getPath('appData'), env: process.env }));
const DEFAULT_MODEL = 'auto';
const asEffort = parseEffort; // spec 007 FR-008: the models' own effort names, `none` included
let folderSetupStore: FolderSetupStore | undefined; // spec 061
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
const mcp = registerMcpIpc({ store: () => mcpStore as McpStore, agents, router, dev, log: (a, action) => logActivity(a, 'mcp-restart', action) });
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
const outward = (e: AgentEvent): AgentEvent => maskMcpEvent(e, e.type === 'mcp' || (e.type === 'toolCall' && e.phase !== 'start' && e.mcpServer) ? mcp.secretValuesFor(e.sessionId) : []);
router.onEvent((e) => toRenderer('agent:event', outward(e)));
const maskHistory = <H extends { items: { type: string; failed?: boolean; output?: string }[] }>(id: string, h: H): H => maskMcpHistory(h, mcp.secretValuesFor(id)); // FR-067: resume replies skip outward()
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
  if (!a) return;
  a.title = e.title;
  syncSessionName(a, e.title); // spec 059 FR-011
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
  activityStore?.record({ agent: a.alias || a.label || a.name, folder: folderNameOf(a), app: registry.get(a.adapterId)?.displayName ?? a.adapterId, mode, action, decision });
};
// The answer to a permission request, or an automatic approval (Allow all, a session permission), arrives as a `permission` event;
// it is logged here, in main, so the window cannot add or change rows. Pending requests, plain reads and stopped sessions are not logged.
router.onEvent((e) => {
  if (e.type !== 'permission') return;
  const a = agents.get(e.sessionId);
  const decision = decisionOf(e.permission);
  if (a && decision) logActivity(a, decision, e.permission.summary);
});
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
    // spec 061 FR-012: the mode chip says "+ folder rules" when this folder's accepted hooks or allow rules apply to this app
    ...(folderSetupStart(ws.workspaceFile ?? ws.cwd, ws.folders, ad.id).rules ? { folderRules: true } : {}),
    ...(ad.capabilities?.renameSession ? { renameCap: ad.capabilities.renameSession } : {}), // spec 059: what a rename does in the agent app
    ...extra,
  };
};

/**
 * Spec 061 FR-004: what this folder's ACCEPTED setup gives a session of app `appId` (pending and declined items never apply).
 * `rules` is set only when hooks or allow/ask rules apply (it also drives the "+ folder rules" chip, FR-012).
 */
function folderSetupStart(key: string, dirs: readonly string[], appId: string, taken: ReadonlySet<string> = new Set()): { folderSetup?: FolderSetupStart; mcpServers: Record<string, McpServerSpec>; rules?: true } {
  if (!folderSetupStore || (appId !== 'claude' && appId !== 'codex' && appId !== 'copilot')) return { mcpServers: {} };
  const accepted = new Set(folderSetupStore.get(key).accepted);
  if (!accepted.size) return { mcpServers: {} };
  const ap = acceptedFor(scanFolderSetupCached(dirs.length ? dirs : [key]), accepted, appId, taken); // review nit #424: no rescan per call
  const any = ap.hooks.length || ap.rules.allow.length || ap.rules.deny.length || ap.rules.ask.length;
  return { mcpServers: ap.mcpServers, ...(any ? { folderSetup: { hooks: ap.hooks, rules: ap.rules } } : {}), ...(hasFolderRules(ap) ? { rules: true as const } : {}) };
}

const startOptionsFor = (a: AgentInfo) => {
  const base = { ...startOptionsOf(a, wsKey(a), DEFAULT_MODEL, asEffort(a.effort)), ...mcp.optionsFor(a.id) };
  const fs61 = folderSetupStart(wsKey(a), a.folders ?? [a.cwd], router.adapterIdOf(a.id) ?? a.adapterId ?? registry.defaultId, new Set(Object.keys(base.mcpServers)));
  return { ...base, mcpServers: { ...base.mcpServers, ...fs61.mcpServers }, ...(fs61.folderSetup ? { folderSetup: fs61.folderSetup } : {}) };
};

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
  applyStoredAlias(info); // spec 059 FR-014
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

/** `quiet: false` (spec 058 FR-022, Restart session): the adapter says "Ready" so the window leaves "Ended"; every other caller starts quietly. */
async function ensureLive(a: AgentInfo, opts: { quiet?: boolean } = {}): Promise<void> {
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
      await ad.start({ ...startOptionsFor(a), ...(resume ? { resumeSessionId: a.id } : { sessionId: a.id }), quiet: opts.quiet ?? true });
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
      // FR-021: the folder's last session comes back under its own id (resumed when first needed); a harness this build lacks starts fresh.
      // Spec 052 FR-088: so does every other session that was open in the folder (at most 6), each resumed lazily the same way.
      const sessions = sessionsToRestore(f).filter((s) => registry.has(s.adapterId ?? DEFAULT_ADAPTER) && !agents.has(s.id));
      for (const ls of sessions.length ? sessions : [undefined]) {
        const kind = ls ? (ls.adapterId ?? DEFAULT_ADAPTER) : adapterId;
        // Spec 003: exactly as saved, Allow all included, flagged so the UI shows "restored" (FR-025/026). 2026-10-21: a session's own
        // last mode wins over the folder's (several sessions of one folder may be in different modes), and the chat says which it was.
        const sm = modeForSession(f, [ls?.id], f.permMode);
        const rm = restoreMode(sm.mode);
        const info = infoFor(f.workspace, rm.mode, ls?.id ?? randomUUID(), f.model || DEFAULT_MODEL, f.effort, { lazy: true, tier: f.contextTier, hidden: f.hidden, closed: f.closed, floor: folderStore.floorOfFolder(f.workspace), permRestored: rm.restored || undefined, permFrom: ls ? (sm.fromSession ? 'session' : 'folder') : undefined, maxAiCredits: router.instance(kind).capabilities?.capUnit === 'usd' ? undefined : f.maxAiCredits ?? settingsStore?.defaultMaxAiCredits }, router.instance(kind));
        if (ls) info.resumeLast = true;
        if (f.label) info.label = f.label;
        if (f.defaultAgent) info.defaultAgent = f.defaultAgent;
        router.bind(info.id, kind);
        agents.set(info.id, info);
        applyStoredAlias(info); // spec 059 FR-014
      }
    } catch {
      /* folder gone or not a folder any more */
    }
  }
}
/** The VS Code chat files each agent's list last showed (ipc/previous.ts fills it; the handlers that remove an agent or a folder drop their entry). */
const vsChatRefs = new Map<string, Map<string, ChatFileRef>>();

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

async function sendOp(id: string, text: string, attachments: PickedFile[], ad: AgentAdapter, plan = false): Promise<{ ok: boolean; error?: string }> {
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
      ...(plan ? { plan: true } : {}),
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

// The handler bodies that refuse a setting a live session cannot take live in agentops.ts (spec 012 FR-054); `store` is read when a handler runs.
const opsDeps: OpsDeps = { agents, router, get store() { return folderStore; }, wsKey, sessionKey: (a) => resumeIdFor(a.id), log: (a, decision, action) => logActivity(a, decision, action) };

/* DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it and is saved as usual. */
let runTheme: string | undefined;


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
/** Ids whose cached state is `ready`; a failed probe counts as none (spec 012 FR-058). */
const readyAdapterIds = async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set((await adaptersList(false)).filter((i) => i.state === 'ready').map((i) => i.id));
  } catch {
    return new Set();
  }
};

/** Spec 006 FR-020: the session a folder continues after a restart is the one that last got a message. */
function noteLastSession(a: AgentInfo | undefined): void {
  if (!a) return;
  const rid = resumeIdFor(a.id); // Codex: its thread id
  folderStore?.setLastSession(wsKey(a), rid, router.adapterIdOf(a.id));
  folderStore?.addOpenSession(wsKey(a), rid, router.adapterIdOf(a.id)); // spec 052 FR-088: every open session comes back, not only the last
  folderStore?.setSessionMode(wsKey(a), rid, a.permMode); // spec 003 (2026-10-21): it comes back in its own mode
}
/** The id a session is resumed under after a restart (Codex: its thread id; others: the agent id). */
const resumeIdFor = (id: string): string => router.forAgent(id)?.resumeIdOf?.(id) ?? id;
/** Spec 052 FR-088: a session that leaves its folder (removed, or replaced by a resumed one) is not restored any more. Call before the session is unbound. */
function forgetOpenSession(key: string, id: string): void {
  const rid = resumeIdFor(id);
  folderStore?.removeOpenSession(key, id);
  if (rid !== id) folderStore?.removeOpenSession(key, rid);
}

// ---- Spec 059: the user's names for sessions ----
/** The adapter id a session name is kept under (`copilot` when none). */
const srcOf = (a: AgentInfo): string => a.adapterId ?? DEFAULT_ADAPTER;
const sameSession = (x: AgentInfo, a: AgentInfo, rid: string): boolean => wsKey(x) === wsKey(a) && srcOf(x) === srcOf(a) && resumeIdFor(x.id) === rid;
function setAlias(a: AgentInfo, rid: string, alias: string | undefined): void {
  for (const x of agents.values()) {
    if (!sameSession(x, a, rid)) continue;
    x.alias = alias;
    toRenderer('agents:renamed', { id: x.id, alias });
  }
}
/** FR-014: an agent that comes back (restart, resume) gets its saved name; a name still waiting for the agent app's next launch is handed to the adapter again. */
function applyStoredAlias(a: AgentInfo): void {
  const rid = resumeIdFor(a.id);
  const e = folderStore?.sessionNameOf(wsKey(a), srcOf(a), rid);
  if (!e) return;
  a.alias = e.name;
  if (e.pending) void router.forAgent(a.id)?.renameSession?.(rid, e.name).catch(() => undefined);
}
/** FR-011: a runtime title arrived; a Durbar-only name stays, a name the agent app now has differently is dropped, a waiting one is confirmed. */
function syncSessionName(a: AgentInfo, title: string): void {
  if (!folderStore) return;
  const src = srcOf(a);
  const rid = resumeIdFor(a.id);
  const entry = folderStore.sessionNameOf(wsKey(a), src, rid);
  const r = titleSyncOf(entry, title);
  if (r.action === 'drop') {
    folderStore.setSessionName(wsKey(a), src, rid, undefined);
    setAlias(a, rid, undefined);
  } else if (r.action === 'update') folderStore.setSessionName(wsKey(a), src, rid, r.entry.name, { inApp: r.entry.inApp === true, pending: r.entry.pending === true });
}
/** Built by ipc/previous.ts, which passes the ids open in the office (it owns the previous-sessions deps). */
const renameSessionOpFor = (openIds: () => ReadonlySet<string>) => renameOp({
  agent: (id) => agents.get(id),
  adapter: (id) => router.forAgent(id),
  resumeIdFor,
  otherOpenIds: (id) => {
    const a = agents.get(id);
    return a ? [...agents.values()].filter((x) => x.id !== id && wsKey(x) === wsKey(a) && srcOf(x) === srcOf(a)).map((x) => resumeIdFor(x.id)) : [];
  },
  previousIds: async (id) => {
    const a = agents.get(id);
    const ad = a ? router.forAgent(id) : undefined;
    return a && ad ? (await previousSessionsOf(ad, a.cwd, openIds())).map((s) => s.id) : [];
  },
  save: (id, src, rid, name, flags) => {
    const a = agents.get(id);
    return !!a && !!folderStore && folderStore.setSessionName(wsKey(a), src, rid, name, flags);
  },
  applyAlias: (id, rid, alias) => {
    const a = agents.get(id);
    if (a) setAlias(a, rid, alias);
  },
});

// ---- IPC (spec 045 FR-060): every handler lives in src/main/ipc/<area>.ts, registered here through ipcHandle / ipcOn (ipcguard.ts). ----
// Stores created in whenReady, and state that changes, are passed as getters so a handler reads them when it runs.
const remoteOps = registerRemoteIpc({ agents, router, toRenderer, getWin: () => win, logActivity });
registerAppIpc({ getSinceAway: () => sinceAway, clearSinceAway: () => { sinceAway = null; }, getWin: () => win });
registerAgentsIpc({ agents, router, agentState, opsDeps, remoteOps, mcpSecrets: (id) => mcp.secretValuesFor(id), logMcp: (a, action) => logActivity(a, 'mcp-restart', action), getScheduler: () => scheduler, getCheckpointStore: () => checkpointStore, vsChatRefs, continued, wsKey, asEffort, addMany, addWorkspace, sendOp, ensureLive, readyAdapterIds, forgetOpenSession, maskHistory });
registerAttachmentsIpc({ dev, pickedFiles, getStageDir, sizeOf });
registerPreviousIpc({ renameSessionOpFor, dev, agents, router, registry, agentState, getFolderStore: () => folderStore, getScheduler: () => scheduler, wsKey, resumeIdFor, forgetOpenSession, logActivity, addWorkspace, vsChatRefs, maskHistory });
registerCheckpointsIpc({ agents, getCheckpointStore: () => checkpointStore, busyStatus });
registerSchedulesIpc({ getScheduler: () => scheduler, getFolderStore: () => folderStore });
registerUsageIpc({ agents, getUsageStore: () => usageStore, getUsageTotalsStore: () => usageTotalsStore, usageLabel });
registerSettingsIpc({ getSettingsStore: () => settingsStore, getRunTheme: () => runTheme, clearRunTheme: () => { runTheme = undefined; } });
registerThemesIpc({ dev, registry, router });
registerHarnessIpc({ dev, registry, router, remoteOps, toRenderer, getWin: () => win, adaptersList });
registerActivityIpc({ getActivityStore: () => activityStore, getWin: () => win });
registerQuestionsIpc({ agents, router, elicitTracker });
/**
 * Spec 040 FR-015 (reused by spec 061 FR-015 and spec 043 FR-028): an agent app's one-shot text call: one prompt, no tools, no
 * session kept, an empty temp folder; Copilot's own MCP servers switched off by name. Undefined when the app has none.
 */
function oneShotFor(id: string): { name: string; generate: (prompt: string) => ReturnType<NonNullable<AgentAdapter['generateText']>> } | undefined {
  if (!registry.has(id)) return undefined;
  const ad = router.instance(id);
  if (typeof ad.generateText !== 'function') return undefined;
  const opts = id === 'copilot' ? { disabledMcpServers: cliServers(copilotDir(dev), new Set()).servers.map((x) => x.name) } : {};
  return { name: registry.get(id)?.displayName ?? id, generate: (prompt: string) => ad.generateText!(prompt, opts) };
}
registerProfilesIpc({ agents, router, getAgentTrust: () => agentTrust, wsKey, ensureLive, oneShot: (id) => oneShotFor(id) });
registerModelIpc({ agents, router, registry, getFolderStore: () => folderStore, wsKey });
registerAdaptersIpc({ adaptersList });
registerFoldersIpc({ agents, router, agentState, getFolderStore: () => folderStore, getScheduler: () => scheduler, vsChatRefs, wsKey });
registerFloorsIpc({ agents, getFolderStore: () => folderStore, wsKey });
/* Spec 061: a folder's own agent setup (scan, decide, explain), window-only (FR-013); the pure handler bodies are unit-tested. */
registerFolderSetupIpc({
  store: () => folderSetupStore,
  dirsOf: (key) => {
    const a = [...agents.values()].find((x) => wsKey(x) === key);
    return a ? (a.folders?.length ? a.folders : [a.cwd]) : undefined;
  },
  explainer: () => {
    // FR-015: the first installed app that answers one prompt with no tools; Copilot first (its `auto` is the cheapest)
    for (const id of ['copilot', 'claude', 'codex']) {
      const g = oneShotFor(id);
      if (g) return g;
    }
    return undefined;
  },
  afterDecide: (key) => {
    const out: Record<string, boolean> = {};
    for (const a of agents.values()) {
      if (wsKey(a) !== key) continue;
      const on = !!folderSetupStart(key, a.folders ?? [a.cwd], router.adapterIdOf(a.id) ?? a.adapterId ?? registry.defaultId).rules;
      a.folderRules = on || undefined;
      out[a.id] = on;
    }
    return out;
  },
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
    // spec 008 FR-093: test runs ask for exact sizes (1440x900, 1280x800); macOS otherwise clamps a window to its screen (CI: 677 px tall)
    ...(dev.DURBAR_DRIVER || dev.DURBAR_SHOT ? { enableLargerThanScreen: true } : {}),
    // spec 008 FR-025: Windows and macOS take the icon from the .exe/.icns; Linux needs it on the window
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, '..', 'icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(dev.DURBAR_DRIVER || dev.DURBAR_SHOT ? { backgroundThrottling: false } : {}), // FR-103: test runs only; the app keeps saving power when hidden
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
  // spec 052 FR-083, FR-164: a Mac menu from roles (Settings… ⌘,; File > Add Folder… ⌘O); no menu on Windows and Linux (no Reload or DevTools for users)
  const menu = appMenuTemplate(process.platform, {
    openSettings: () => {
      const w = win && !win.isDestroyed() ? win : undefined;
      if (!w) return;
      w.show();
      toRenderer('menu:settings', null);
    },
    openRepo: () => void shell.openExternal(REPO_URL),
    // spec 052 FR-164: File > Add Folder… / Add VS Code Workspace… press the page's own buttons (one code path, agents:addFolder / addWorkspaceFile)
    add: (kind) => {
      const w = win && !win.isDestroyed() ? win : undefined;
      if (!w) return;
      w.show();
      toRenderer('menu:add', kind);
    },
  });
  Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu) : null);
  folderStore = new FolderStore(path.join(app.getPath('userData'), 'durbar-folders.json'));
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'durbar-settings.json'));
  settingsStore.load();
  /* Dev/test theme seed (spec 036 FR-005): DURBAR_THEME=<id> makes the office open on that theme for the per-theme checks; invalid ids fall back in the renderer. */
  if (dev.DURBAR_THEME) runTheme = parseThemeId(dev.DURBAR_THEME);
  mcpStore = new McpStore(path.join(app.getPath('userData'), 'durbar-mcp.json'), safeStorageCodec);
  folderSetupStore = new FolderSetupStore(path.join(app.getPath('userData'), 'folder-setup.json')); // spec 061: digests and paths only
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
          await new Promise((r) => setTimeout(r, 50)); // spec 008 FR-096: a wait ends as soon as the page is ready
        }
        return false;
      },
    };
    win?.webContents.once('did-finish-load', () => {
      const driver = require(dev.DURBAR_DRIVER as string) as (c: typeof ctx) => Promise<void>;
      // spec 008 FR-090: a failing driver exits 1, so CI on every OS sees it without reading the log
      let failed = false;
      void driver(ctx).catch((err) => { failed = true; console.error('DRIVER FAILED', err); }).finally(() => void router.disposeAll().finally(() => app.exit(failed ? 1 : 0)));
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
