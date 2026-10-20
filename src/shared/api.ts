import type { BroadKind } from './broadfolder';
import type { AgentEvent } from '../adapters/types';
import type { HistoryItem, PreviousSession } from '../adapters/history';
import type { VsChatSummary, VsChatTranscript } from '../adapters/vscodeChat';
import type { UsageDoc } from './toolusage';
import type { UsageNumbers } from './usagedoc';
import type { McpServerInput, McpServerView, McpTransport, McpTrustInfo } from './mcp';

export type { McpServerInput, McpServerView, McpTransport, McpTrustInfo };

import type { AdapterInfo } from './adapters';
import type { ActivityRow } from './activity';
import type { RemoteState } from './remote';
export type { RemoteState };
export type { AdapterInfo };

export type { HistoryItem, PreviousSession, VsChatSummary, VsChatTranscript };

/** Permission policy chosen when adding a folder. */
export type PermMode = 'read-only' | 'ask' | 'allow';

export interface AgentInfo {
  /** Session id. */
  id: string;
  /** The folder or workspace base name. Rooms, tool-usage labels and usage totals use it; it never holds the session title. */
  name: string;
  /** The runtime's display title for this session (spec 002/001 deltas 2026-10-18, issue #126); display only. */
  title?: string;
  cwd: string;
  /** Set when the agent was added from a .code-workspace file. */
  workspaceFile?: string;
  folders: string[];
  permMode: PermMode;
  model?: string;
  /** Reasoning effort chosen for this session, when the model supports it. */
  effort?: string;
  /** Context tier of this session (spec 030); absent = the model's default. */
  tier?: ContextTier;
  /** What the agent's adapter can do about model and context (spec 030); absent = nothing (a new session is needed). */
  modelControl?: ModelControl;
  /** The agent's kind can select custom agents (spec 043). */
  profiles?: boolean;
  /** Restored from the saved folder list: no runtime session yet, it starts with the first message. */
  lazy?: boolean;
  /** Credit cap of this session in AIU (spec 011); unset = no cap. */
  maxAiCredits?: number;
  /** Restored from a saved Allow all after a restart (spec 003 FR-026): shown as a small "restored" note until the mode is switched. */
  permRestored?: boolean;
  /** The folder is hidden from the office (it keeps its saved sessions). */
  hidden?: boolean;
  /** The room's door is closed (compact door plate in the office). */
  closed?: boolean;
  /** Floor of the folder (spec 033); absent = the ground floor. */
  floor?: string;
  /** Display name of the folder's room (spec 006 FR-018); absent = the folder's own name. */
  label?: string;
  /** Restored after a restart as the folder's last session (spec 006 FR-021): resumed, not started fresh, when first needed. */
  resumeLast?: boolean;
  /** Custom agent preselected for the folder's new sessions (spec 043 FR-009). */
  defaultAgent?: string;
  /** Which adapter runs this agent (spec 012 FR-058), e.g. `copilot`. */
  adapterId: string;
}

/** Choices for a new session. */
export interface SessionOptions {
  /** AI-credit cap for the session (AIU). `null` = explicitly no cap; unset = the folder's saved cap, else the global default (spec 011). */
  maxAiCredits?: number | null;
  permMode?: PermMode;
  model?: string;
  effort?: string;
  /** Floor for a folder added now (spec 033 FR-006); unknown = the ground floor. */
  floor?: string;
  /** Agent kind (adapter id) for a new folder or session (spec 012 FR-058). Unknown or not ready = refused. Unset = the folder's saved kind, else the default. */
  adapterId?: string;
}

/** A floor as the renderer sees it (spec 033). */
export interface FloorView {
  id: string;
  name: string;
  on: boolean;
  ground: boolean;
}

/** Floors in order, the default floor for the next added folder, and each agent's floor. */
export interface FloorsState {
  floors: FloorView[];
  lastFloor: string;
  byAgent: Record<string, string>;
}

export type FloorsResult = { ok: true; state: FloorsState } | { ok: false; error: string; state: FloorsState };

/** What the user chose for a session that reached its credit cap (spec 011). */
export type LimitChoice = { kind: 'add'; credits: number } | { kind: 'set'; credits: number } | { kind: 'unset' } | { kind: 'cancel' };

import type { AboutView } from './about';
import type { CompactResult, ContextTier, ModelControl, ModelPricing, ModelSwitchRequest, ModelSwitchResult, PriceClass } from './modelswitch';

/** Saved credit totals as the window receives them (spec 011 FR-026). Numbers, a display name and the folder's own path (already known to the window); the file holds a hash, never the path. */
export interface UsageTotalsView {
  ok: boolean;
  /** ISO time the saved totals started counting (first run or the last reset). */
  since?: string;
  office?: UsageNumbers;
  folders?: ({ path: string; name: string } & UsageNumbers)[];
  /** Set when the last write to disk failed. */
  error?: string;
}

/** A place the user made (spec 024 FR-018): a name and an icon id from a fixed set. No paths, no content. */
export interface CustomPlaceView {
  id: string;
  name: string;
  icon: string;
}

/** Result of adding, changing or removing a custom place (spec 024 FR-020). The list and the map are what is in force after the call, also when it was refused. */
export interface CustomPlaceResult {
  ok: boolean;
  /** One of `name-empty`, `name-long`, `name-taken`, `name-invalid`, `icon`, `limit`, `unknown`. */
  error?: string;
  /** The place that was added. */
  place?: CustomPlaceView;
  customPlaces: CustomPlaceView[];
  placeMap: Record<string, string>;
}

export interface AppSettingsView {
  /** Owner, version and contributors for Settings > About (spec 008 FR-018). */
  about?: AboutView;
  /** Default cap (AIU) applied to new sessions; unset = none. */
  defaultMaxAiCredits?: number;
  /** Places in the office (spec 024): MCP server name -> place id or `desk`; unmapped servers use the built-in rules. */
  placeMap?: Record<string, string>;
  /** The user's own places (spec 024 FR-018), up to 3, in creation order. */
  customPlaces?: CustomPlaceView[];
  /** Serious mode (spec 034): the agent figures show no monster, ambulance or other mood drawing. */
  seriousMode?: boolean;
  /** Active theme id (specs 035-040). Omitted = Clean Office. */
  theme?: string;
  /** OS notifications when an agent needs you while the window is in the background (spec 052 FR-059). On unless turned off. */
  notifyNeedsMe?: boolean;
}

/** A custom agent profile as the renderer sees it (spec 043; same shape as the adapter's `AgentProfile`). */
export interface ProfileInfo {
  id: string;
  name: string;
  description?: string;
  source: 'repo' | 'user' | 'other';
  path?: string;
  tools?: string[];
  model?: string;
  mcpServers?: string[];
}

/** A scheduled prompt (spec 044); the same shape as the main process's. */
export interface ScheduleInfo {
  id: string;
  folder: string;
  prompt: string;
  every?: number;
  at?: number;
  /** Phase 2 FR-012: every day, weekdays or weekly on days (0 = Sunday) at a local "HH:MM". */
  rule?: { kind: 'daily' | 'weekdays' | 'weekly'; time: string; days?: number[] };
  next?: number;
  paused?: boolean;
  /** Why the app paused it (FR-014, FR-015). */
  pausedReason?: 'cap' | 'session-ended';
  done?: boolean;
  last?: { at: number; outcome: 'sent' | 'skipped-busy' | 'skipped-paused' | 'skipped-cap' | 'skipped-ended' | 'missed' | 'failed' };
  /** FR-014: one session instead of the folder's agent. */
  target?: { session: string; agent: string; name?: string };
  /** FR-015: the schedule's own limit and what its runs spent. */
  cap?: { amount: number; unit: 'aiu' | 'usd' };
  spent?: number;
  spentUnknown?: boolean;
}
export interface SchedulesInfo {
  pausedAll: boolean;
  schedules: ScheduleInfo[];
}

export interface ModelChoice {
  id: string;
  name: string;
  multiplier?: number;
  /** Context window in tokens; absent = unknown (the runtime reports 0 for `auto`). */
  contextWindow?: number;
  efforts: string[];
  defaultEffort?: string;
  /** Token prices in credits per million tokens, when the runtime reports them (spec 030 FR-011). Absent = "price not reported". */
  pricing?: ModelPricing;
  priceClass?: PriceClass;
  /** Tiers the model offers; `long` only when the runtime advertises a long-context tier. */
  contextTiers?: ContextTier[];
  /** Window in tokens of the long-context tier, when reported. */
  longWindow?: number;
}

export interface PickedFile {
  path: string;
  name: string;
  kind: 'file' | 'image';
  /** Bytes on disk (used for the per-file cap). */
  size?: number;
}

/** Result of staging a pasted or dropped file. */
export type StageResult = { ok: true; file: PickedFile } | { ok: false; error: string };

export interface AddResult {
  ok: boolean;
  agents: AgentInfo[];
  error?: string;
  /** Folders broader than a project (spec 006 FR-016): the renderer shows one calm line each. */
  warnings?: { name: string; kind: BroadKind }[];
}

export interface ResumeResult {
  ok: boolean;
  error?: string;
  agent?: AgentInfo;
  /** The untouched agent that was replaced by the resumed one (when `replace` was requested). */
  removedId?: string;
  title?: string;
  history?: { items: HistoryItem[]; total: number; truncated: boolean };
}

export interface VsChatListResult {
  ok: boolean;
  error?: string;
  sessions: VsChatSummary[];
  /** Matching VS Code workspace folders found on disk (0: VS Code never opened this folder, or is not installed). */
  storesFound: number;
  unreadable: number;
  tooLarge: number;
  formatNote: string;
}

/** A server of the Copilot CLI list (`~/.copilot/mcp-config.json`) or the built-in GitHub server: loaded by the runtime itself, read-only here, on/off for new sessions started by this app. */
export interface McpAmbientView {
  name: string;
  origin: 'copilot-config' | 'builtin';
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Not in the disabled list of Settings. */
  enabled: boolean;
}

/** What was found when reading the Copilot CLI file (a display label, never the real path). */
export interface McpCliFile {
  label: string;
  found: boolean;
  error?: string;
  /** Entries that could not be used. */
  skipped: number;
}

/** The global MCP list: the Copilot CLI list, read live. There is no app-level list of extras (spec 020). */
export interface McpState {
  cli: McpAmbientView[];
  file: McpCliFile;
  /** Secrets can be saved encrypted (Electron safeStorage). When false they only live in memory for this run. */
  secretsPersist: boolean;
}

/** The optional extras of ONE folder/workspace (spec 020). */
export interface McpFolderState {
  ok: boolean;
  error?: string;
  key: string;
  /** Display name of the folder. */
  name: string;
  servers: McpServerView[];
  /** Old app-level servers that are not applied; they can be moved into this folder or removed. */
  legacy: McpServerView[];
  secretsPersist: boolean;
  /** Extras that are on but are not passed to new sessions, with the reason. */
  skipped: { name: string; reason: string }[];
  /** Names of the Copilot CLI list (an extra may not reuse them). */
  cliNames: string[];
}

/** One env/header row in an import preview: the key and whether a value would be copied. The value itself never leaves the main process. */
export interface McpImportRow {
  key: string;
  /** true = a literal value would be copied into the secret store (shown masked); false = no value (enter it after importing). */
  hasValue: boolean;
}

/** One server found in a folder's `.vscode/mcp.json` (spec 020 FR-023). */
export interface McpImportItem {
  /** Opaque id for `mcpImportApply` (source folder index + the key in the file). */
  id: string;
  name: string;
  originalName: string;
  /** Folder name the entry comes from; only set when the key has several folders (a workspace). */
  from?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  env: McpImportRow[];
  headers: McpImportRow[];
  notes: string[];
  /** Why the box is disabled (not importable). */
  blocked?: string;
  /** This exact definition is already an extra of this folder. */
  alreadyAdded?: boolean;
}

/** What was found for one folder of the key. */
export interface McpImportFile {
  from: string;
  state: 'ok' | 'missing' | 'error';
  message?: string;
  /** Entries that are not usable at all. */
  skipped: number;
  /** Ids of the file's `inputs` (names only; they are never asked for or stored). */
  inputs: string[];
}

export interface McpImportPreview {
  ok: boolean;
  error?: string;
  /** Display label of the file (never the real path). */
  label: string;
  files: McpImportFile[];
  items: McpImportItem[];
  /** Digest of the file text(s); `mcpImportApply` refuses when the files changed since. */
  digest: string;
  skipped: number;
}

export interface McpImportResult {
  ok: boolean;
  error?: string;
  /** Names of the extras that were created (off, not trusted). */
  imported: string[];
  failed: { name: string; error: string }[];
}

export interface McpResult {
  ok: boolean;
  error?: string;
  server?: McpServerView;
  /** Enabling needs the user's confirmation of this command/URL (call again with `trustAck`). */
  needsTrust?: McpTrustInfo;
}

/** All-time tool usage as the Tools view gets it (spec 020): the stored document plus the label each live agent is counted under. */
export interface UsageView {
  doc?: UsageDoc;
  labels: Record<string, string>;
  /** The last write to disk failed (counting continues in memory). */
  error?: string;
}

/** One MCP server as one agent sees it. */
export interface AgentMcpEntry {
  name: string;
  /** `cli` = Copilot CLI list or built-in, `folder` = an extra of this agent's folder, `runtime` = only reported by the runtime. */
  origin: 'cli' | 'folder' | 'runtime';
  /** Runtime state when the session is running (connected, failed, needs-auth, disabled, ...). */
  status?: string;
  error?: string;
  /** The default from Settings: on for new sessions. */
  defaultOn: boolean;
  /** This agent switched it off. */
  off: boolean;
}

/** Bridge exposed by the preload script as `window.agentDurbar`. */
export interface DurbarApi {
  version(): Promise<string>;
  addFolder(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  addWorkspaceFile(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  /** Another agent (own chat) in the same folder as agent `id`. */
  newSession?(id: string, opts: SessionOptions): Promise<{ ok: boolean; error?: string; agent?: AgentInfo }>;
  /** Models the account offers (no credits used). */
  /** Models of an agent kind (spec 012 FR-120); no kind = the default kind. */
  listModels?(kind?: string): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }>;
  /** Adapters and whether each can run (spec 012 FR-033). `refresh` probes again instead of using the cached answer. */
  listAdapters?(refresh?: boolean): Promise<AdapterInfo[]>;
  /** End the session (frees it; sending again resumes it). `stop` only interrupts the current turn. */
  end?(id: string): Promise<void>;
  /** Open an http(s) link in the system browser (anything else is refused in the main process). */
  openExternal?(url: string): Promise<{ ok: boolean }>;
  /** Change the permission mode of agent `id` now (applies to the next request). `clearGrants`: forget "Approve for this session"; `approvePending`: approve what is waiting. */
  setPermMode?(id: string, mode: PermMode, opts?: { clearGrants?: boolean; approvePending?: boolean }): Promise<{ ok: boolean; error?: string; mode?: PermMode; pending?: number }>;
  /** Change the model, effort or context tier of agent `id` (spec 030). Validated in main; saved with the folder entry once applied. */
  setModel?(id: string, request: ModelSwitchRequest): Promise<{ ok: boolean; error?: string; result?: ModelSwitchResult }>;
  /** Remove a queued model switch (spec 030). */
  cancelQueuedModel?(id: string, queueId: string): Promise<{ ok: boolean; error?: string }>;
  /** Compact the context of agent `id` now (spec 030); `focus` is an optional short text. */
  compact?(id: string, focus?: string): Promise<{ ok: boolean; error?: string; result?: CompactResult }>;
  /** A hand-off summary of the session, for a new session's first message (spec 030 FR-034); never sent by itself. */
  handoff?(id: string): Promise<{ ok: boolean; error?: string; summary?: string; costUsd?: number }>;
  /** Turn remote control (follow and steer from the agent app's web or mobile app) on or off for live agent `id` (spec 054 FR-004). */
  setRemote?(id: string, on: boolean): Promise<RemoteState>;
  /** Open agent `id`'s remote link (stored in main, https://github.com only) in the system browser (spec 054 FR-005). */
  openRemote?(id: string): Promise<{ ok: boolean }>;
  /** Close or open the door of the room (folder) of agent `id`; remembered. */
  setRoomClosed?(id: string, closed: boolean): Promise<{ ok: boolean }>;
  /** Hide or show the folder of agent `id`; the choice is remembered. */
  setFolderHidden?(id: string, hidden: boolean): Promise<{ ok: boolean }>;
  /** Remove the folder of agent `id`: ends its sessions and forgets the folder. */
  removeFolder?(id: string): Promise<{ ok: boolean; removedIds: string[] }>;
  /** Ends one main session and takes it out of the office (spec 006 FR-017); refused for the last main session of a folder and for helpers. */
  removeSession?(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Sets the folder's display name (spec 006 FR-018); empty = the folder's own name. */
  renameFolder?(id: string, label: string): Promise<{ ok: boolean; label?: string }>;
  setFolderDefaultAgent?(id: string, profileId: string | null): Promise<{ ok: boolean; defaultAgent?: string }>;
  /** Spec 006 FR-021: start a restored agent now (no prompt). `resumed` says whether its last session came back, with its history. */
  wake?(id: string): Promise<{ ok: boolean; error?: string; resumed?: boolean; history?: { items: HistoryItem[]; total: number; truncated: boolean }; title?: string }>;

  /** Floors (spec 033). Validated in main; never touch a session. Every change returns the full new state. */
  floorsState?(): Promise<FloorsState>;
  createFloor?(name: string): Promise<FloorsResult>;
  renameFloor?(id: string, name: string): Promise<FloorsResult>;
  reorderFloors?(ids: string[]): Promise<FloorsResult>;
  deleteFloor?(id: string): Promise<FloorsResult>;
  setFloorOn?(id: string, on: boolean): Promise<FloorsResult>;
  onlyFloor?(id: string): Promise<FloorsResult>;
  /** Move the folder of agent `agentId` (all its agents) to a floor. */
  moveFolderToFloor?(agentId: string, floorId: string): Promise<FloorsResult>;

  /** Credit caps (spec 011). `credits: null` removes the cap. */
  getSettings?(): Promise<AppSettingsView>;
  setDefaultCap?(credits: number | null): Promise<{ ok: boolean; defaultMaxAiCredits?: number }>;
  /** Map an MCP server to a place (a built-in place id `library|software|terminal|web|other`, a custom place id `c-xxxxxx`, or `desk`), or `null` to use the default (spec 024). */
  setPlace?(server: string, place: string | null): Promise<{ ok: boolean; placeMap?: Record<string, string> }>;
  /** Custom places (spec 024 FR-020). `icon` is one of 12 ids (`star`, `flask`, `database`, `cloud`, `chart`, `chat`, `mail`, `calendar`, `shield`, `box`, `bolt`, `pin`). */
  addPlace?(name: string, icon: string): Promise<CustomPlaceResult>;
  /** Rename and/or change the icon; the id, and so every mapping, stays. */
  updatePlace?(id: string, patch: { name?: string; icon?: string }): Promise<CustomPlaceResult>;
  /** Remove a place; the servers that were mapped to it go back to their default place. */
  removePlace?(id: string): Promise<CustomPlaceResult>;
  /** Turn Serious mode on or off (spec 034). */
  setSeriousMode?(on: boolean): Promise<{ ok: boolean; seriousMode?: boolean }>;
  /** Turn the "needs you" OS notifications on or off (spec 052 FR-059). */
  setNotifyNeedsMe?(on: boolean): Promise<{ ok: boolean; notifyNeedsMe?: boolean }>;
  /** The "needs you" count on the app icon (spec 052 FR-059): an integer from 0 to 999. Badge on macOS and Linux where supported; on Windows the taskbar button flashes when it grows in the background. */
  setBadge?(count: number): Promise<{ ok: boolean }>;
  /** Bring the window to the front (a click on a "needs you" notification, spec 052 FR-059). */
  focusWindow?(): Promise<{ ok: boolean }>;
  /** Set the theme (specs 037-040): a built-in id or an imported user theme id. */
  setTheme?(id: string): Promise<{ ok: boolean; theme?: string }>;
  /** User themes (spec 040): scan userData/themes; each valid pack listed, each invalid one given back with a reason. */
  listUserThemes?(): Promise<Array<{ id: string; name?: string; ok: boolean; error?: string }>>;
  getUserTheme?(id: string): Promise<Record<string, unknown> | null>;
  importTheme?(): Promise<{ ok: boolean; id?: string; name?: string; error?: string; cancelled?: boolean }>;
  /** AI theme maker (spec 040 FR-014): one prompt to a harness with `oneShot`; returns a checked manifest (not saved). */
  generateTheme?(description: string, adapterId: string): Promise<{ ok: boolean; manifest?: Record<string, unknown>; warnings?: string[]; passes?: number; costUsd?: number; nanoAiu?: number; error?: string }>;
  saveGeneratedTheme?(manifest: Record<string, unknown>): Promise<{ ok: boolean; id?: string; name?: string; error?: string }>;
  /** Example looks for the AI theme maker (spec 040 FR-021). */
  themeIdeas?(): Promise<string[]>;
  /* Spec 051: harness setup inside the app (install, update, sign in). Fixed commands only; the window never names a command. */
  harnessPlans?(kind: string, op: 'install' | 'update'): Promise<{ plans: Array<{ manager: string; display: string; note?: string }>; page: string; name: string }>;
  harnessRun?(kind: string, op: 'install' | 'update' | 'signin', planIndex?: number): Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
  harnessPaste?(text: string): Promise<{ ok: boolean; error?: string }>;
  harnessCancel?(): Promise<boolean>;
  harnessOpenPage?(kind: string): Promise<{ ok: boolean }>;
  harnessOpenSignIn?(kind: string, url: string): Promise<{ ok: boolean }>;
  /** `pwshMissing` (spec 052 FR-073): Windows only, PowerShell 7 was not found; the Copilot card shows a hint. */
  copilotAuth?(): Promise<{ known: boolean; signedIn?: boolean; pwshMissing?: boolean }>;
  onHarnessProgress?(cb: (p: { kind: string; op: string; lines: string[]; elapsedMs: number; url?: string; code?: string; needsPaste?: boolean }) => void): () => void;
  onHarnessDone?(cb: (p: { kind: string; op: string; ok: boolean; exitCode?: number | null; reason?: string; lines: string[] }) => void): () => void;
  exportTheme?(id: string): Promise<{ ok: boolean; to?: string; error?: string; cancelled?: boolean }>;
  setCap?(id: string, credits: number | null): Promise<{ ok: boolean; error?: string; maxAiCredits?: number }>;
  /** One-way: the window tells main an agent was paused or resumed (spec 041 T014); Paused exists only in the window. */
  setPaused?(id: string, paused: boolean): void;
  resolveLimit?(id: string, requestId: string, choice: LimitChoice): Promise<{ ok: boolean; error?: string }>;
  /** Scheduled prompts (spec 044). */
  listSchedules?(): Promise<SchedulesInfo>;
  saveSchedule?(input: Partial<ScheduleInfo> & { folder: string; prompt: string }): Promise<{ ok: true; schedule: ScheduleInfo } | { ok: false; error: string }>;
  removeSchedule?(id: string): Promise<{ ok: boolean }>;
  setSchedulesPaused?(on: boolean): Promise<{ ok: boolean; pausedAll: boolean }>;
  onSchedules?(cb: (doc: SchedulesInfo) => void): () => void;
  onScheduleRan?(cb: (r: { agentId: string; scheduleId: string; every?: number; at?: number; rule?: ScheduleInfo['rule'] }) => void): () => void;
  /** Answer the agent's question (spec 012 FR-128): question text -> answer; null = skip. */
  answerQuestion?(id: string, requestId: string, answers: Record<string, string> | null): Promise<{ ok: boolean; error?: string }>;
  /** Custom agents the session can use (spec 043); `trusted` is false for a repository agent not yet confirmed for this folder and file. */
  listProfiles?(id: string): Promise<{ ok: boolean; error?: string; profiles: (ProfileInfo & { trusted: boolean })[] }>;
  /** Select a custom agent (null = default). A repository agent not yet confirmed answers `needsConfirm`; call again with `confirm` after the user agreed. */
  selectProfile?(id: string, profileId: string | null, confirm?: boolean): Promise<{ ok: boolean; error?: string; needsConfirm?: boolean; profile?: ProfileInfo | null }>;

  /** Tool usage over all runs (spec 020). */
  usageAllTime?(): Promise<UsageView>;
  usageReset?(): Promise<{ ok: boolean; doc?: UsageDoc }>;
  /** Credit totals saved before this run (spec 011 FR-026, issue #21): the window adds this run's own figures on top. `folders` are the current agents' folders (key = `workspaceFile ?? cwd`). */
  usageTotals?(): Promise<UsageTotalsView>;
  /** Set the saved credit totals to zero (Settings > Usage totals). Returns the now empty view. */
  usageResetTotals?(): Promise<UsageTotalsView>;
  /** Local activity log (spec 052 FR-071), newest first. Rows are written by main only. */
  activityList?(opts?: { limit?: number }): Promise<{ ok: boolean; rows: ActivityRow[] }>;
  /** Save the whole log as CSV or JSON through the system save dialog. */
  activityExport?(format: 'csv' | 'json'): Promise<{ ok: boolean; count?: number; to?: string; error?: string; cancelled?: boolean }>;
  /** Empty the log (the window asks first). */
  activityClear?(): Promise<{ ok: boolean }>;
  /** MCP (specs 019, 020): the Copilot CLI list is global and read live; extras are per folder/workspace key (`workspaceFile ?? cwd`). */
  mcpState?(): Promise<McpState>;
  /** Names of the extras of every saved folder (any state), nothing else: for the Places list (spec 024 FR-016). */
  mcpExtraNames?(): Promise<{ ok: boolean; names: string[] }>;
  mcpSetCli?(name: string, enabled: boolean): Promise<{ ok: boolean }>;
  mcpFolderState?(key: string): Promise<McpFolderState>;
  mcpUpsert?(key: string, input: McpServerInput, originalName?: string): Promise<McpResult>;
  mcpRemove?(key: string, name: string): Promise<{ ok: boolean }>;
  mcpSetEnabled?(key: string, name: string, enabled: boolean, trustAck?: boolean): Promise<McpResult>;
  mcpMoveLegacy?(name: string, key: string): Promise<McpResult>;
  /** Per-folder import from VS Code's `.vscode/mcp.json` (spec 020 FR-020): a preview, then the ticked ids. Imported servers are off and untrusted. */
  mcpImportPreview?(key: string): Promise<McpImportPreview>;
  mcpImportApply?(key: string, ids: string[], digest: string): Promise<McpImportResult>;
  mcpRemoveLegacy?(name: string): Promise<{ ok: boolean }>;
  agentMcp?(id: string): Promise<{ ok: boolean; servers: AgentMcpEntry[]; live: boolean }>;
  /** Per-agent override: `enabled=false` turns the server off for this agent (now when the session runs, else at its next start). */
  setAgentMcp?(id: string, name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>;

  /** Agents already running in main (survives renderer reloads) and startup paths. */
  listAgents(): Promise<AgentInfo[]>;
  /** `image` opens the picker with an image filter (spec 004 FR-013). */
  pickAttachments(want?: 'image' | 'file'): Promise<PickedFile[]>;
  /** Pasted / dropped file bytes (renderer has no path): checked (10 MB, real image format), sanitized, written to a private temp folder. */
  stageAttachment(name: string, mime: string, data: ArrayBuffer): Promise<StageResult>;
  send(id: string, text: string, attachments: PickedFile[]): Promise<{ ok: boolean; error?: string }>;
  /** Interrupt the current turn only; the agent returns to Ready. */
  stop(id: string): Promise<void>;
  /** `remember` = "Approve for this session" (ignored when denying); `broad` = the wider "any arguments" scope of a shell request (only if offered). */
  resolvePermission(id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean): Promise<void>;
  /** Forget one "Approve for this session" grant (key from the `grants` event). */
  revokeGrant(id: string, key: string): Promise<void>;
  openInVSCode(id: string): Promise<{ ok: boolean; error?: string; edition?: string }>;
  /** Earlier Copilot CLI/SDK sessions in this agent's folder (newest first). Optional: not in the simulator. */
  listPrevious?(id: string): Promise<{ ok: boolean; error?: string; sessions: PreviousSession[] }>;
  /** Resume one of them as a new agent in the same folder; `replace` retires this agent if it was never used. */
  resumeSession?(id: string, sessionId: string, replace: boolean): Promise<ResumeResult>;
  /** Read-only VS Code Copilot Chat history for this agent's folder. */
  listVsChats?(id: string): Promise<VsChatListResult>;
  readVsChat?(id: string, key: string): Promise<{ ok: boolean; error?: string; transcript?: VsChatTranscript }>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAgentAdded(cb: (a: AgentInfo) => void): () => void;
}
