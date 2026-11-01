import type { OrderDoc } from './roomorder';
import type { FolderSetupDecision, FolderSetupView, HookExplanation } from './foldersetup';
import type { BroadKind } from './broadfolder';
import type { AgentEvent, McpServerStatus } from '../adapters/types';
import type { HistoryItem, PreviousSession } from '../adapters/history';
import type { VsChatSummary, VsChatTranscript } from '../adapters/vscodeChat';
import type { UsageDoc } from './toolusage';
import type { UsageNumbers } from './usagedoc';
import type { McpServerInput, McpServerView, McpTransport, McpTrustInfo } from './mcp';

export type { McpServerInput, McpServerView, McpTransport, McpTrustInfo };

import type { AdapterInfo } from './adapters';
import type { OrgPolicyAppView } from './orgpolicy';
import type { ActivityRow } from './activity';
import type { RemoteState } from './remote';
import type { NotesExport, NotesFileCount, NotesSetFile, NotesView, NotesWrote } from './notes';
export type { RemoteState };
export type { AdapterInfo };

export type { HistoryItem, PreviousSession, VsChatSummary, VsChatTranscript };

/** Permission policy chosen when adding a folder. */
export type PermMode = 'read-only' | 'ask' | 'allow';

/** The answer of `renameSession` (spec 059 FR-013). `inApp`: the agent app took the name; `pending`: it will at the session's next launch; `note`: why only Durbar has it. */
export type RenameResult = { ok: true; name?: string; inApp: boolean; pending?: boolean; note?: string } | { ok: false; error: string };

export interface AgentInfo {
  /** Session id. */
  id: string;
  /** The folder or workspace base name. Rooms, tool-usage labels and usage totals use it; it never holds the session title. */
  name: string;
  /** The runtime's display title for this session (spec 002/001 deltas 2026-10-18, issue #126); display only. */
  title?: string;
  /** The user's own name for this session (spec 059); display only, kept in Durbar's folder file. Wins over `title` (FR-001, FR-011). */
  alias?: string;
  /** What a rename of this session does in the agent app (spec 059 FR-007): now, at its next launch, or never (Durbar only). */
  renameCap?: 'any' | 'next-turn';
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
  /** Spec 007 FR-016: the Auto routing tier this agent chose (kept while it uses another model); absent = the default. */
  autoTier?: AutoTier;
  /** What the agent's adapter can do about model and context (spec 030); absent = nothing (a new session is needed). */
  modelControl?: ModelControl;
  /** The agent's kind can select custom agents (spec 043). */
  profiles?: boolean;
  /** Spec 073: the agent app offers a "/" list in the composer (`slashCommands`). */
  slash?: true;
  /** Spec 061 FR-012: the folder's own hooks or allow rules (accepted by the person) apply to this agent's sessions. */
  folderRules?: boolean;
  /** Restored from the saved folder list: no runtime session yet, it starts with the first message. */
  lazy?: boolean;
  /** Credit cap of this session in AIU (spec 011); unset = no cap. */
  maxAiCredits?: number;
  /** Restored from a saved Allow all after a restart (spec 003 FR-026): shown as a small "restored" note until the mode is switched. */
  permRestored?: boolean;
  /**
   * Spec 003 (2026-10-21): where the mode of a session that came back (restart or Previous sessions) was taken from, so the chat
   * can say it: `session` = the mode last chosen for this very session; `folder` = the folder's saved mode (nothing remembered for
   * the session); `opener` = the mode of the session Previous sessions was opened from. Cleared by a mode switch; never saved.
   */
  permFrom?: 'session' | 'folder' | 'opener';
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
  /** Spec 087 FR-011: the agent app's OS sandbox under Durbar's checks, as the adapter last reported it; absent = nothing is shown. Never saved. */
  sandbox?: SandboxState;
}

/**
 * Spec 087 FR-011: the OS sandbox an agent app runs its commands in, normalized (no vendor name or vendor setting key; those stay in
 * `src/adapters/`). `on` only after the agent app confirmed it; `unknown` while its start has not confirmed it yet. `reason` is masked
 * and at most 200 characters.
 */
export interface SandboxState {
  state: 'on' | 'off' | 'unknown';
  /** How it is enforced: the macOS sandbox, bubblewrap, Windows ProcessContainer, or the agent app's own sandbox. */
  mechanism?: 'seatbelt' | 'bubblewrap' | 'processcontainer' | 'vendor';
  /** The organization's own policy keeps it on (Allow all). */
  managed?: boolean;
  /** Set in an earlier mode of this session and kept until a new session (a switch to Allow all does not clear it). */
  untilNewSession?: boolean;
  /** Spec 087 FR-022c: a floor this session set is (assumed) in force, and a switch to Allow all asks the app to turn it off in this session. */
  heldFloor?: boolean;
  /** What runs inside it: shell commands, MCP servers, the app's own file tools. */
  covers: Array<'shell' | 'mcp' | 'files'>;
  /** An approved request may run outside the sandbox (spec 087 FR-021). */
  approvedMayLeave?: boolean;
  /** Read-only (no writes) or Ask first (the session's folders). */
  writes?: 'none' | 'folders';
  /** A real session on this app and OS checked it (spec 087 FR-020); false: "Requested; not verified on a real session." */
  verified: boolean;
  /** Why it is off or unknown, in plain words (masked, at most 200 characters). */
  reason?: string;
  /** Session folders the floor left out, each "<folder> (<why>)" (masked, cut), at most 10; `leftOutMore` counts the rest. */
  leftOut?: string[];
  leftOutMore?: number;
}

/** Spec 087 FR-012: one agent app's OS sandbox on this computer, for Settings > Agent apps. Plain words; `reason` masked and cut. */
export interface SandboxHostView {
  available: boolean;
  mechanism?: SandboxState['mechanism'];
  /** Why not (masked, at most 200 characters) and what would fix it. */
  reason?: string;
  fix?: string;
  /** Spec 087 FR-007c: *Always continue on this computer* is stored for this app (shown and undone in Settings). */
  alwaysContinue?: boolean;
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
import type { AccountView } from './account';
import type { AutoTier, CompactResult, ContextTier, ManagedAutoTier, ModelControl, ModelPricing, ModelSwitchRequest, ModelSwitchResult, PriceClass } from './modelswitch';

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
  /** Spec 077 FR-064: who sits at the desks (`theme`: the theme's own). */
  characters?: 'theme' | 'minimalist' | 'cheeky' | 'prehistoric';
  /** OS notifications when an agent needs you while the window is in the background (spec 052 FR-059). On unless turned off. */
  notifyNeedsMe?: boolean;
  /** Spec 068 FR-006: after a coffee break, `auto` resumes by itself when it costs nothing extra; `ask` always asks. */
  breakResume?: 'auto' | 'ask';
  /** Spec 080 FR-031: where a plain click on a chat link opens (default `'session'`). */
  chatLinksIn?: 'session' | 'system';
}

/** A profile file (spec 043 FR-010); `path` is for display only, the window sends `id` back. */
export interface ProfileFileInfo {
  id: string;
  app: 'copilot' | 'claude';
  scope: 'folder' | 'user';
  folder?: string;
  fileName: string;
  path: string;
  name: string;
  description?: string;
  size: number;
  writable: boolean;
  note?: string;
  tooBig?: boolean;
}

/** An office folder a new profile can go into (spec 043 FR-013); the window sends `id` back, never the path. */
export interface ProfileFolderInfo {
  id: string;
  path: string;
}

/** Spec 073 FR-001: one entry of the composer's "/" list as the window sees it (same shape as the adapter's `SlashCommand`; no absolute path). */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  argumentHint?: string;
  source: 'folder' | 'user' | 'app';
  kind: 'skill' | 'command' | 'prompt' | 'builtin';
  where?: string;
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

/** What a scheduled run came to (spec 044; main's `Outcome`). */
export type ScheduleOutcome = 'sent' | 'skipped-busy' | 'skipped-paused' | 'skipped-cap' | 'skipped-ended' | 'missed' | 'failed' | 'held' | 'ended' | 'skipped-door-full' | 'skipped-review';
/** Spec 044 FR-036: one entry of a schedule's run log, as `scheduleRuns` returns it (newest first). Reason codes only, never text. */
export interface ScheduleRunInfo {
  at: number;
  outcome: ScheduleOutcome;
  /** The agent id the prompt went to, or would have gone to. */
  session?: string;
  reason?: 'no-agent' | 'send-error' | 'user' | 'agent' | 'session' | 'limit' | 'passes' | 'time' | 'no-pace' | 'errors' | 'app-closed';
  manual?: true;
  /** A skip repeated n times, the last at `until` (FR-037). */
  n?: number;
  until?: number;
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
  pausedReason?: 'cap' | 'session-ended' | 'review';
  done?: boolean;
  last?: { at: number; outcome: ScheduleOutcome };
  /** FR-014: one session instead of the folder's agent. */
  target?: { session: string; agent: string; name?: string };
  /** FR-015: the schedule's own limit and what its runs spent. */
  cap?: { amount: number; unit: 'aiu' | 'usd' };
  spent?: number;
  spentUnknown?: boolean;
}
/** Spec 052 FR-089: the Since you were away card's facts (src/main/daily.ts). */
export interface SinceAwayInfo {
  awayMs: number;
  missed: Array<{ id: string; folderName: string; prompt: string; repeats: boolean }>;
}

/** Spec 006 FR-040..FR-041 (issue #606): sessions the last run left in the middle of a turn, still resumable. Ids and folder names only. */
export interface InterruptedInfo {
  items: Array<{ id: string; adapterId: string; folderName: string }>;
  /** Busy sessions of the last run that could not be brought back (removed, folder gone): the card says "N of M". */
  missing: number;
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
  /** Spec 076 FR-202 (issue #602): the agent app's own organization policy blocks this model; the reason to show. */
  orgBlocked?: string;
  /** Spec 076 FR-201: the policy may block it (Durbar could not read all of it); advice, still selectable. */
  orgDoubt?: string;
  /** Spec 007 FR-012: the Auto routing tiers (Copilot's `auto` only). */
  autoTiers?: AutoTier[];
  /** Spec 007 FR-017: the organization's Auto tier, when set. */
  autoTierManaged?: ManagedAutoTier;
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

/** Spec 093: what the window sends to create a folder: never a path, only the token of main's own pick; a clone adds its URL. */
export interface NewFolderRequest { kind: 'clone' | 'init' | 'empty'; token: string; name: string; url?: string }
/** Spec 093 FR-022: the answer of an early check; for a clone URL also its host (FR-061), the suggested name and the URL masked. */
export type NewFolderCheck = { ok: true; host?: string; suggested?: string; shown?: string } | { ok: false; error: string; retry?: 'url' | 'name' };
/** Spec 093 FR-040, FR-044: one clone progress event (masked in main). */
export interface NewFolderProgress { phase?: string; percent?: number; lines: string[]; elapsedMs: number; waiting?: true }
export type NewFolderPick = { ok: true; token: string; parent: string } | { ok: false; cancelled?: true; error?: string };
/** `retry` says which step the window offers again: the URL, the name, or the place (*Change place…*). */
export type NewFolderResult = AddResult & { name?: string; retry?: 'url' | 'name' | 'place'; cancelled?: true; submodules?: true };

export interface ResumeResult {
  ok: boolean;
  error?: string;
  agent?: AgentInfo;
  /** The untouched agent that was replaced by the resumed one (when `replace` was requested). */
  removedId?: string;
  title?: string;
  history?: { items: HistoryItem[]; total: number; truncated: boolean };
  /** Spec 003 (2026-10-21): the mode of the session it was opened from, when the resumed session came back in a different one. */
  modeWas?: PermMode;
}

export interface VsChatListResult {
  ok: boolean;
  error?: string;
  sessions: VsChatSummary[];
  /** Keys pinned / hidden in this folder (spec 006 FR-026), filtered to the chats in `sessions`. */
  pinned?: string[];
  hidden?: string[];
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

/** Spec 069: an agent app whose user-level MCP list Durbar can read and, after a confirmation, edit. */
export type GlobalApp = 'copilot' | 'claude' | 'codex';
/** Spec 069 FR-004: secret values as `${NAME}` references (default) or written as plain text into the app's file. */
export type GlobalSecretMode = 'ref' | 'plain';
/** Spec 069 FR-011: where a server comes from. */
export type McpSourceTag = GlobalApp | 'folder' | 'builtin' | 'runtime';

/** One server of an app's user-level list, names only (no env or header value). */
export interface GlobalEntryView {
  name: string;
  transport: 'stdio' | 'http' | 'sse' | 'other';
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  headerKeys: string[];
  /** Some value is a `${NAME}` reference (or Codex `env_vars` / `env_http_headers`). */
  refs?: boolean;
}

/** One app's list as read now (spec 069 FR-002, FR-008). */
export interface GlobalAppState {
  app: GlobalApp;
  label: string;
  /** The file label (`~/...`), never the user name. */
  file: string;
  found: boolean;
  /** The file could not be read or would not be edited (nothing is written to it). */
  error?: string;
  servers: GlobalEntryView[];
  /** Names of this list that new Durbar sessions skip (Settings switches; Copilot and Claude Code). */
  off: string[];
}

export interface GlobalState {
  ok: boolean;
  apps: GlobalAppState[];
}

/** Spec 069 FR-020: a server missing in some agent apps' lists, or defined differently (field names only, never values). */
export interface GlobalDiffItem {
  name: string;
  in: GlobalApp[];
  missing: GlobalApp[];
  /** Fields that differ between the lists that have it: type, command, arguments, URL, environment variables, headers, values, tools, hidden tools, on/off. */
  differs: string[];
  /** Lists it can be copied from. */
  from: GlobalApp[];
  error?: string;
}

export interface GlobalDiff {
  ok: boolean;
  /** The lists that could be read. */
  apps: GlobalApp[];
  items: GlobalDiffItem[];
}

/** Spec 069 FR-005: what will be written to one file, shown before anything is written. */
export interface GlobalPreviewItem {
  app: GlobalApp;
  label: string;
  file: string;
  exists: boolean;
  /** The entry as it will be written, secret values masked; removal: the entry being removed (names only). */
  entry: string;
  error?: string;
  /** The name is already in this file (add): replaced only when the user ticks it. */
  conflict?: boolean;
  /** With `conflict`: the entry that is there now (names only). */
  current?: GlobalEntryView;
  /** Spec 069 FR-051: a limit to say on this item (Copilot `${NAME}` expansion not verified). */
  note?: string;
}

export interface GlobalPreview {
  ok: boolean;
  error?: string;
  token?: string;
  items: GlobalPreviewItem[];
  /** Reference mode: the environment variables the user must set. */
  vars?: string[];
}

export interface GlobalApplyItem {
  app: GlobalApp;
  file: string;
  ok: boolean;
  /** Label of the backup made before the write (no backup when the file did not exist). */
  backup?: string;
  error?: string;
}

export interface GlobalApplyResult {
  ok: boolean;
  error?: string;
  items: GlobalApplyItem[];
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
  /** Spec 058 FR-011/FR-020: what kind of failure the adapter said it was (only when the vendor said so). */
  errorClass?: McpServerStatus['errorClass'];
  /** Spec 058 FR-187 (issue #779 A): a Running server whose last tool call failed with a refused sign-in (`auth`) or an organization access policy (`policy`). The class only, never the text. */
  lastCall?: 'auth' | 'policy';
  /** Spec 058 FR-092: when Agent Durbar first saw this state (epoch ms); only for a reported state. */
  since?: number;
  /** Spec 058 FR-092: a failed or needs-sign-in state that came after the server was Running in this session. */
  afterRunning?: boolean;
  /** Spec 058 FR-092: the transport the adapter reported (`stdio`, `http`, ...); missing = not reported. */
  transport?: string;
  /** The default from Settings: on for new sessions. */
  defaultOn: boolean;
  /** This agent switched it off. */
  off: boolean;
  /** Spec 069 FR-011: every list that has this name. */
  sources?: McpSourceTag[];
  /** Spec 076 FR-202 (issue #602): the agent app's own organization policy blocks this server; the reason to show. */
  orgBlocked?: string;
  /** Spec 076 FR-201: the policy may block it (Durbar could not read all of it); advice, still usable. */
  orgDoubt?: string;
  /** Spec 069 FR-061: tools of this server turned off in this agent's folder. */
  toolsOff?: string[];
  /** Spec 058 FR-020: Restart is offered: the agent app can restart one server, the session runs and knows this server, and it is on. */
  canRestart?: boolean;
  /** Spec 058 FR-065: **Sign in** is offered: the agent app can start its own sign-in, the session runs, and this server reads Needs sign-in. */
  canSignIn?: boolean;
  /** Spec 058 FR-164: **Sign in again** is offered: the agent app can redo the sign-in itself, the session runs, and this server is on and not waiting for a first sign-in. */
  canSignInAgain?: boolean;
  /** Spec 058 FR-065: a sign-in is open for this server. The host only, never the address; `expiresInMs` is what is left of the 10 minutes. */
  signIn?: { host: string; opened: boolean; expiresInMs: number; otherSite?: string };
  /** Spec 058 FR-068: the terminal steps for this needs-sign-in server, the agent app's plain text with the name filled in (commands in backticks). */
  signInSteps?: string;
  /** Spec 058 FR-180: how the agent app said a sign-in Agent Durbar started ended (`next-message`: signed in, applies next message; `failed`). */
  signInEnd?: 'next-message' | 'failed';
  /** Spec 058 FR-180: the agent app's own sentence on how far its sign-in was checked, shown under a row that offers Sign in. */
  signInNote?: string;
  /** Spec 058 FR-176/FR-181: this needs-sign-in row keeps **Restart**: the agent app picks up a sign-in finished outside Agent Durbar with it. */
  signInRestart?: boolean;
  /** Spec 058 FR-078: Agent Durbar passed this server as switched off when the session started (Settings or the folder's extras), so a runtime `disabled` is not the app's own doing. */
  launchedOff?: boolean;
  /** Spec 058 FR-078: the user switched this server here since the session started (a runtime `disabled` may be the old state until its event arrives). */
  switchedHere?: boolean;
}

/** `agents:mcp` (spec 019 FR-009, spec 058 FR-020). */
export interface AgentMcpReply {
  ok: boolean;
  servers: AgentMcpEntry[];
  live: boolean;
  /** Spec 058 FR-020: the agent app's display name (for hints); missing when no adapter answers. */
  app?: string;
  /** Spec 058 FR-010: when this agent app starts its servers; missing = not said. */
  start?: 'session' | 'next-message';
  /** Spec 058 FR-010: when a switch takes effect in a running session; missing = not said. */
  toggleApplies?: 'live' | 'next-message';
  /** Spec 058 FR-022: *Restart session with these servers* is offered (the app can resume and the session runs). */
  canRestartSession?: boolean;
  /** Spec 058 FR-190 (issue #779 B): the agent app can report its server list again (`agents:mcpRefresh`); missing = it cannot, and the dialog says so. */
  canRefresh?: boolean;
  /** Spec 069 FR-031: this agent app can list a server's tools (`agents:mcpTools`). */
  canListTools?: boolean;
  /** Spec 069 FR-064: this agent app can turn single tools off (`agents:setMcpToolsOff`); missing = the checkboxes are disabled. */
  toolFilter?: boolean;
}

/** `agents:mcpTools` (spec 069 FR-032): one server's tools, masked and cut in main. */
export interface McpToolsResult {
  ok: boolean;
  tools?: { name: string; description?: string; orgBlocked?: string; orgDoubt?: string }[];
  /** How many the server listed (more than `tools` when it listed over 500). */
  total?: number;
  /** The session is not running: nothing was asked. */
  notRunning?: boolean;
  error?: string;
}

/** `agents:mcpSignIn` (spec 058 FR-065): the host only, never the address. `manual` = show the terminal steps (FR-068). The error is masked and has no address. */
export type McpSignInStartResult =
  | { ok: true; kind: 'browser'; host: string; otherSite?: string }
  | { ok: true; kind: 'connected' }
  | { ok: false; error: string; manual?: boolean };

/** `agents:mcpOpenSignIn` (spec 058 FR-065): `gone` = the sign-in is no longer open (time limit, End session, connected). */
export interface McpOpenSignInResult {
  ok: boolean;
  error?: string;
  gone?: boolean;
  manual?: boolean;
}

/** `agents:mcpRefresh` (spec 058 FR-190). `supported: false` = this agent app cannot report its list again (the dialog says so); `ok: false` = it could not be read now. No vendor text. */
export interface McpRefreshResult {
  ok: boolean;
  supported: boolean;
  /** Spec 058 FR-190: the open-time read was skipped, the last read of this agent is under a minute old. */
  skipped?: true;
  error?: string;
}

/** `agents:mcpRestart` (spec 058 FR-021): the error is short and masked. */
export interface McpRestartResult {
  ok: boolean;
  error?: string;
}

/** Spec 087 FR-022: why `agents:mcpRestartSession` runs: 'mcp' (Restart session with these servers) or 'sandbox' (*Restart without the sandbox*). Words only. */
export type McpRestartReason = 'mcp' | 'sandbox';

/** `agents:mcpRestartSession` (spec 058 FR-022, FR-027). */
export interface McpRestartSessionResult {
  ok: boolean;
  error?: string;
  /** The agent is working, thinking or waiting: ask, then call again with `confirmed`. Nothing changed. */
  needsConfirm?: boolean;
  /** The session ended but could not be resumed (as after *End session*; a message tries again). */
  ended?: boolean;
  /** The resume failed because the agent app's sign-in expired (FR-027). */
  errorKind?: 'auth';
}

/** Bridge exposed by the preload script as `window.agentDurbar`. */
/** Spec 081: one app's check result as the window sees it (plain data; `src/shared/updatecheck.ts` has the rules). */
export interface UpdateResultView {
  app: string;
  state: 'up-to-date' | 'update-available' | 'could-not-check' | 'outside' | 'checking' | 'not-checked';
  installed?: string; latest?: string; stable?: string; newerOnLatest?: string; installedNewer?: boolean;
  source: string; sourceKind: string; hint?: string; reason?: string; checkedAt?: number; asHomebrew?: boolean;
}
export interface UpdatesView {
  results: UpdateResultView[];
  checking: string[];
  startCheck: boolean;
  policy: { checkHidden: boolean; installBlocked: boolean; unreadable: boolean; startAllowed: boolean };
  runtime?: string;
  waiting: Record<string, number>;
  announce?: { app: string; version: string; name: string };
}

export interface DurbarApi {
  version(): Promise<string>;
  addFolder(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  addWorkspaceFile(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  /** Spec 093 FR-004, FR-005: main's system picker for the parent of a new folder; a one-use token and the parent's text (display only). */
  createPickParent?(): Promise<NewFolderPick>;
  /** Spec 093 FR-022: early feedback on a create request (kind, the clone URL, the name); nothing is created or run. */
  createCheck?(req: Partial<NewFolderRequest>): Promise<NewFolderCheck>;
  /** Spec 093 FR-060: create the folder in the picked place and add it like Add existing (same mode and options). */
  createFolder?(req: NewFolderRequest, permMode: PermMode, opts?: SessionOptions): Promise<NewFolderResult>;
  /** Spec 093 FR-041: end the running clone (only the git Durbar started); its folder is removed after git has exited. */
  createCancel?(): Promise<{ ok: boolean }>;
  /** Spec 093 FR-040: the running clone's progress (masked in main). */
  onCreateProgress?(cb: (p: NewFolderProgress) => void): () => void;
  /** Another agent (own chat) in the same folder as agent `id`. */
  newSession?(id: string, opts: SessionOptions): Promise<{ ok: boolean; error?: string; agent?: AgentInfo }>;
  /** Models the account offers (no credits used). */
  /** Models of an agent kind (spec 012 FR-120); no kind = the default kind. */
  listModels?(kind?: string): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }>;
  /** Spec 076 FR-207 (issue #602): per agent app, what its own organization policy blocks (modes with reasons, counts; no values). */
  orgPolicyView?(): Promise<Record<string, OrgPolicyAppView>>;
  /** Adapters and whether each can run (spec 012 FR-033). `refresh` probes again instead of using the cached answer. */
  listAdapters?(refresh?: boolean): Promise<AdapterInfo[]>;
  /** Spec 012 FR-157: main changed the cached list by itself (a session was refused because of the sign-in). */
  onAdaptersChanged?(cb: (list: AdapterInfo[]) => void): () => void;
  /** End the session (frees it; sending again resumes it). `stop` only interrupts the current turn. */
  end?(id: string): Promise<void>;
  /** Open an http(s) link in the system browser (anything else is refused in the main process). */
  openExternal?(url: string): Promise<{ ok: boolean }>;
  /** Change the permission mode of agent `id` now (applies to the next request). `clearGrants`: forget "Approve for this session"; `approvePending`: approve what is waiting. */
  setPermMode?(id: string, mode: PermMode, opts?: { clearGrants?: boolean; approvePending?: boolean }): Promise<{ ok: boolean; error?: string; mode?: PermMode; pending?: number }>;
  /** Spec 087 FR-007a/FR-007c: *Continue without the OS sandbox* for this session (`always`: on this computer, where offered). Nothing is sent. */
  sandboxContinue?(id: string, opts?: { always?: boolean }): Promise<{ ok: boolean; error?: string }>;
  /** Spec 087 FR-012: per ready agent app, whether its OS sandbox can run here (Settings > Agent apps). */
  sandboxHosts?(): Promise<Record<string, SandboxHostView>>;
  /** Spec 087 FR-007c: undo *Always continue on this computer* for an app. */
  sandboxAlwaysOff?(app: string): Promise<{ ok: boolean }>;
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
  /** Spec 065: a turn's file changes (what an undo would do), the undo itself, and the note after a turn that changed files. */
  checkpointPreview?(id: string, turn: number): Promise<CheckpointPreview | { ok: false; error: string }>;
  checkpointUndo?(id: string, turn: number): Promise<CheckpointUndo>;
  onCheckpoint?(cb: (p: CheckpointNote) => void): () => void;
  /** Close or open the door of the room (folder) of agent `id`; remembered. */
  setRoomClosed?(id: string, closed: boolean): Promise<{ ok: boolean }>;
  /** Hide or show the folder of agent `id`; the choice is remembered. */
  setFolderHidden?(id: string, hidden: boolean): Promise<{ ok: boolean }>;
  /** Remove the folder of agent `id`: ends its sessions and forgets the folder. */
  /**
   * Spec 083 FR-048 (T034b): `deleteNotes` also deletes the folder's notes file, after main's native confirmation (Cancel: nothing is
   * removed, `cancelled`). `notesDeleted` / `notesError` say what happened to the notes.
   */
  removeFolder?(id: string, opts?: { deleteNotes?: boolean }): Promise<{ ok: boolean; removedIds: string[]; cancelled?: boolean; error?: string; notesDeleted?: boolean; notesError?: string }>;
  /** Ends one main session and takes it out of the office (spec 006 FR-017); refused for the last main session of a folder and for helpers. */
  removeSession?(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Sets the folder's display name (spec 006 FR-018); empty = the folder's own name. */
  renameFolder?(id: string, label: string): Promise<{ ok: boolean; label?: string; error?: string }>;
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
  /** The saved manual order of rooms (by folder path), desks inside a room (by agent id) and places (by place id); sequencing only (issue #677). */
  getOrder?(): Promise<OrderDoc>;
  /** Saves the order; resolves with what was kept after cleaning. */
  setOrder?(doc: OrderDoc): Promise<OrderDoc>;

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
  /** Spec 068 FR-006: what happens when a coffee break ends. */
  setBreakResume?(v: 'auto' | 'ask'): Promise<{ ok: boolean; breakResume?: 'auto' | 'ask' }>;
  setChatLinksIn?(v: 'session' | 'system'): Promise<{ ok: boolean; chatLinksIn?: 'session' | 'system' }>;
  /** The "needs you" count on the app icon (spec 052 FR-059): an integer from 0 to 999. Badge on macOS and Linux where supported; on Windows the taskbar button flashes when it grows in the background. */
  setBadge?(count: number): Promise<{ ok: boolean }>;
  /** Bring the window to the front (a click on a "needs you" notification, spec 052 FR-059). */
  focusWindow?(): Promise<{ ok: boolean }>;
  /** Set the theme (specs 037-040): a built-in id or an imported user theme id. */
  setTheme?(id: string): Promise<{ ok: boolean; theme?: string; characters?: 'theme' | 'minimalist' | 'cheeky' | 'prehistoric' }>;
  /** Spec 077 FR-064: set who sits at the desks; main refuses anything not on the list (`ok: false`, the value in force). */
  setCharacters?(v: string): Promise<{ ok: boolean; characters: 'theme' | 'minimalist' | 'cheeky' | 'prehistoric' }>;
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
  harnessPlans?(kind: string, op: 'install' | 'update'): Promise<{ plans: Array<{ manager: string; display: string; note?: string; owner?: boolean; pinned?: string; own?: string; script?: unknown }>; page: string; name: string; blocked?: string }>;
  /** `gate` (spec 081 FR-013): the answer to the open-sessions dialog ('wait', 'end', or 'cancel' to release the update lock). A reply with `needsGate` asks the window to show that dialog. */
  harnessRun?(kind: string, op: 'install' | 'update' | 'signin', planIndex?: number, gate?: 'wait' | 'end' | 'cancel'): Promise<{ ok: boolean; error?: string; cancelled?: boolean; busy?: boolean; waiting?: number; needsGate?: { open: number; busy: number; pendingPermissions: number; heldPrompts: number } }>;
  /** Spec 081 FR-003: the kept update-check results; `'check'` asks the sources anew (all apps, or one). Accepting winget's source terms is main's own native question (FR-004). */
  harnessUpdates?(what?: 'check', app?: string): Promise<UpdatesView>;
  onHarnessUpdates?(cb: (v: UpdatesView) => void): () => void;
  /** Spec 081 FR-016: whether Settings > Agent apps is on screen (then the card is the announcement and no toast is shown). */
  harnessVisible?(on: boolean): Promise<boolean>;
  setCheckUpdatesAtStart?(on: boolean): Promise<{ ok: boolean; checkUpdatesAtStart?: boolean }>;
  harnessPaste?(text: string): Promise<{ ok: boolean; error?: string }>;
  harnessCancel?(): Promise<boolean>;
  harnessOpenPage?(kind: string): Promise<{ ok: boolean }>;
  harnessOpenSignIn?(kind: string, url: string): Promise<{ ok: boolean }>;
  /** `pwshMissing` (spec 052 FR-073): Windows only, PowerShell 7 was not found; the Copilot card shows a hint. */
  copilotAuth?(): Promise<{ known: boolean; signedIn?: boolean; pwshMissing?: boolean }>;
  /** Spec 051 FR-014: the account each installed agent app reports (`{ [appId]: { status, text } }`); `refresh` asks again. Personal data: shown in the window only. */
  harnessAccounts?(refresh?: boolean | 'check'): Promise<Record<string, AccountView>>;
  onHarnessProgress?(cb: (p: { kind: string; op: string; lines: string[]; elapsedMs: number; url?: string; code?: string; needsPaste?: boolean }) => void): () => void;
  /** spec 012 FR-158: remote control ended because the agent app reconnected after a new sign-in. */
  /** Remote control ended without the user (spec 012 FR-158, spec 054 FR-062): an agent id, or the id with a plain reason. */
  onRemoteOff?(cb: (p: string | { id: string; reason?: string }) => void): () => void;
  /** Spec 017 FR-015..FR-017: per agent id, a door the user closed and how many runs are held there (only doors that are closed or hold something). */
  doorsList?(): Promise<Record<string, { closed: boolean; held: number }>>;
  setDoor?(id: string, closed: boolean): Promise<{ ok: true; closed: boolean; held: number; remoteOff?: boolean } | { ok: false; error: string }>;
  releaseHeld?(id: string, action: 'send' | 'discard'): Promise<{ ok: true; queued?: number; sent?: number; discarded?: number } | { ok: false; error: string }>;
  onDoorsChanged?(cb: (doors: Record<string, { closed: boolean; held: number }>) => void): () => void;
  /** Review on #631: the held prompts of a door (the window masks and cuts them in the Send all dialog). */
  doorsHeld?(id: string): Promise<{ prompt: string; at: number }[]>;
  /** Send all stopped; the runs stay held (why: paused-all, paused, cap, ended, failed). */
  onDoorsStopped?(cb: (p: { id: string; why: string }) => void): () => void;
  /** A scheduled run could not be kept at a closed door whose queue is full. */
  onDoorsFull?(cb: (p: { id: string }) => void): () => void;
  /** Spec 076 FR-203: a session started under advice of its agent app's organization policy; the words to show (no policy values). */
  onOrgNote?(cb: (p: { id: string; text: string }) => void): () => void;
  /** Spec 054 FR-062: remote control is still on with a new (checked) link after a relaunch. */
  onRemoteUrl?(cb: (p: { id: string; url: string }) => void): () => void;
  onHarnessDone?(cb: (p: { kind: string; op: string; ok: boolean; exitCode?: number | null; reason?: string; lines: string[]; error?: string; failure?: string; fallback?: 'official'; note?: string }) => void): () => void;
  exportTheme?(id: string): Promise<{ ok: boolean; to?: string; error?: string; cancelled?: boolean }>;
  setCap?(id: string, credits: number | null): Promise<{ ok: boolean; error?: string; maxAiCredits?: number }>;
  /** One-way: the window tells main an agent was paused or resumed (spec 041 T014); Paused exists only in the window. */
  setPaused?(id: string, paused: boolean): void;
  resolveLimit?(id: string, requestId: string, choice: LimitChoice): Promise<{ ok: boolean; error?: string }>;
  /** Scheduled prompts (spec 044). */
  listSchedules?(): Promise<SchedulesInfo>;
  saveSchedule?(input: Partial<ScheduleInfo> & { folder: string; prompt: string; edit?: boolean }): Promise<{ ok: true; schedule: ScheduleInfo } | { ok: false; error: string }>;
  removeSchedule?(id: string): Promise<{ ok: boolean }>;
  setSchedulesPaused?(on: boolean): Promise<{ ok: boolean; pausedAll: boolean }>;
  /** Spec 052 FR-089: one run of a schedule now ("Run missed now"), through the same path as a scheduled run. */
  runScheduleNow?(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Spec 044 FR-043: one schedule's run log, newest first; read-only. */
  scheduleRuns?(id: string): Promise<{ ok: true; runs: ScheduleRunInfo[] } | { ok: false }>;
  /** Spec 052 FR-089: what happened while the app was closed (more than 30 minutes), or null. */
  sinceAway?(): Promise<SinceAwayInfo | null>;
  dismissSinceAway?(): Promise<{ ok: boolean }>;
  /** Spec 006 FR-041: the crash card's sessions (null: none, or dismissed). Resuming one is `wake`. */
  interrupted?(): Promise<InterruptedInfo | null>;
  dismissInterrupted?(): Promise<{ ok: boolean }>;
  onSchedules?(cb: (doc: SchedulesInfo) => void): () => void;
  onScheduleRan?(cb: (r: { agentId: string; scheduleId: string; every?: number; at?: number; rule?: ScheduleInfo['rule'] }) => void): () => void;
  /** Answer the agent's question (spec 012 FR-128): question text -> answer; null = skip. */
  answerQuestion?(id: string, requestId: string, answers: Record<string, string> | null): Promise<{ ok: boolean; error?: string }>;
  /** Answer an MCP elicitation (spec 012 FR-151): `accept` with the form's values (checked in main), `decline` or `cancel`. `field` names a field that failed the check. */
  answerElicitation?(id: string, requestId: string, action: 'accept' | 'decline' | 'cancel', values?: Record<string, string | number | boolean>): Promise<{ ok: boolean; error?: string; field?: string }>;
  /** Open an elicitation's https page in the system browser (spec 012 FR-151); main opens the address it holds for that request, never one from the window. */
  openElicitationUrl?(id: string, requestId: string): Promise<{ ok: boolean; error?: string }>;
  /** Custom agents the session can use (spec 043); `trusted` is false for a repository agent not yet confirmed for this folder and file. */
  listProfiles?(id: string): Promise<{ ok: boolean; error?: string; profiles: (ProfileInfo & { trusted: boolean })[] }>;
  /** Select a custom agent (null = default). A repository agent not yet confirmed answers `needsConfirm`; call again with `confirm` after the user agreed. */
  selectProfile?(id: string, profileId: string | null, confirm?: boolean): Promise<{ ok: boolean; error?: string; needsConfirm?: boolean; profile?: ProfileInfo | null }>;
  /** Spec 043 FR-010: the profile files of the office's folders and the user (main lists them; `folders` = the places a new file can go, by id, FR-020; `userDirs` = each app's user agent folder, for the New profile hint, FR-013). */
  listProfileFiles?(): Promise<{ ok: boolean; error?: string; folders: ProfileFolderInfo[]; files: ProfileFileInfo[]; userDirs?: { copilot?: string; claude?: string } }>;
  /** Spec 043 FR-011/FR-012: read by id only (never a path); text with LF line endings, `sha256` of the bytes on disk. */
  readProfileFile?(fileId: string): Promise<{ ok: true; info: ProfileFileInfo; text: string; sha256: string; eol: 'lf' | 'crlf' } | { ok: false; error: string }>;
  /** Writes atomically; `conflict` when the file changed since `baseSha` (unless `overwrite`). */
  saveProfileFile?(fileId: string, text: string, baseSha: string, overwrite?: boolean): Promise<{ ok: true; sha256: string; info: ProfileFileInfo } | { ok: false; error: string; conflict?: boolean }>;
  /** Spec 043 FR-013/FR-018: `place` = the `id` of one of `listProfileFiles().folders`, or 'user'; `template` defaults to the Agent Success Profile; `text`: a reviewed AI draft (FR-029). */
  createProfileFile?(app: 'copilot' | 'claude', place: string, name: string, template?: 'success' | 'standard', text?: string): Promise<{ ok: true; id: string; info: ProfileFileInfo } | { ok: false; error: string }>;
  openProfileInVSCode?(fileId: string): Promise<{ ok: boolean; error?: string }>;
  /** Spec 043 FR-040: delete a listed, writable profile file by id (main resolves it again; never a path from the window). */
  deleteProfileFile?(fileId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Spec 043 FR-026..FR-028: one prompt to an agent app's one-shot path (`by`); a checked draft, nothing written. */
  generateProfile?(req: { app: 'copilot' | 'claude'; name: string; by: string; mode: 'describe' | 'questions'; description?: string; answers?: Record<string, string>; tools?: string }): Promise<{ ok: true; text: string; warnings: string[]; extraTools?: string[]; by: string; costUsd?: number; nanoAiu?: number } | { ok: false; error: string; busy?: true; costUsd?: number; nanoAiu?: number }>; // busy: a request is still running (spec 043 FR-039)

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
  /** Spec 061: a folder's own agent setup (masked), the person's decision (window only, FR-013), and an AI explanation of a hook (FR-015). */
  folderSetupScan?(key: string): Promise<FolderSetupView>;
  folderSetupDecide?(key: string, decision: FolderSetupDecision): Promise<{ ok: boolean; error?: string; view?: FolderSetupView; folderRules?: Record<string, boolean> }>;
  folderSetupExplain?(key: string, id: string): Promise<HookExplanation>;
  mcpImportApply?(key: string, ids: string[], digest: string): Promise<McpImportResult>;
  mcpRemoveLegacy?(name: string): Promise<{ ok: boolean }>;
  /** Spec 069: the agent apps' user-level MCP lists (names only), read now. */
  mcpGlobalState?(): Promise<GlobalState>;
  /** Spec 069 FR-005: what adding `input` to the chosen apps' lists would write; nothing is written. */
  mcpGlobalPreview?(input: unknown, apps: GlobalApp[], mode: GlobalSecretMode): Promise<GlobalPreview>;
  /** Spec 069 FR-005: write a reviewed preview; `replace` = apps where an existing entry of that name may be replaced. */
  mcpGlobalApply?(token: string, replace: GlobalApp[]): Promise<GlobalApplyResult>;
  mcpGlobalRemovePreview?(name: string, apps: GlobalApp[]): Promise<GlobalPreview>;
  /** Spec 069 FR-020: servers missing or different between the agent apps' lists. */
  mcpGlobalDiff?(): Promise<GlobalDiff>;
  /** Spec 069 FR-021: the review of copying one server from `from`'s list to `to`; written with `mcpGlobalApply`. */
  mcpGlobalCopyPreview?(name: string, from: GlobalApp, to: GlobalApp[]): Promise<GlobalPreview>;
  mcpGlobalRemoveApply?(token: string): Promise<GlobalApplyResult>;
  /** Spec 069 FR-009: switch one server of an app's list off (or on) for new Durbar sessions (Copilot and Claude Code). */
  mcpGlobalSetOff?(app: GlobalApp, name: string, off: boolean): Promise<{ ok: boolean }>;
  /** `focus: true` = the window regained focus: main reads the agent app's MCP list again when a sign-in page is open (spec 058 FR-064). */
  agentMcp?(id: string, focus?: boolean): Promise<AgentMcpReply>;
  /** Spec 058 FR-190 (issue #779 B): ask the agent app for its server list again (the dialog opening, or Refresh); the new states arrive as the usual `mcp` event. */
  agentMcpRefresh?(id: string, manual?: boolean): Promise<McpRefreshResult>;
  /** Spec 058 FR-021: restart one MCP server of this agent's running session. */
  agentMcpRestart?(id: string, name: string): Promise<McpRestartResult>;
  /** Spec 058 FR-065: start the agent app's own sign-in for one MCP server. Main keeps the address; the reply has the host only. */
  agentMcpSignIn?(id: string, name: string, again?: boolean): Promise<McpSignInStartResult>;
  /** Spec 058 FR-065: open the held sign-in page in the system browser (main holds the address; only after this click). */
  agentMcpOpenSignIn?(id: string, name: string, shownHost: string): Promise<McpOpenSignInResult>;
  /** Spec 058 FR-065: forget the open sign-in. */
  agentMcpCancelSignIn?(id: string, name: string): Promise<{ ok: boolean; error?: string }>;
  /** Spec 069 FR-032: the tools of one MCP server of this agent's running session. */
  agentMcpTools?(id: string, name: string): Promise<McpToolsResult>;
  /** Spec 069 FR-061: the tools of one server turned off in this agent's folder (applies to new sessions and after Restart session). */
  setAgentMcpToolsOff?(id: string, name: string, off: string[]): Promise<{ ok: boolean; error?: string }>;
  /** Spec 058 FR-022: end and resume this agent's session with the current MCP servers; `confirmed` after the window asked.
   *  Spec 087 FR-022: `reason` 'sandbox' is *Restart without the sandbox* (the same op; it changes main's words only; anything else is 'mcp'). */
  agentMcpRestartSession?(id: string, confirmed: boolean, reason?: McpRestartReason): Promise<McpRestartSessionResult>;
  /** Per-agent override: `enabled=false` turns the server off for this agent (now when the session runs, else at its next start). */
  setAgentMcp?(id: string, name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>;

  /** Agents already running in main (survives renderer reloads) and startup paths. */
  listAgents(): Promise<AgentInfo[]>;
  /** `image` opens the picker with an image filter (spec 004 FR-013). */
  pickAttachments(want?: 'image' | 'file'): Promise<PickedFile[]>;
  /** Pasted / dropped file bytes (renderer has no path): checked (10 MB, real image format), sanitized, written to a private temp folder. */
  stageAttachment(name: string, mime: string, data: ArrayBuffer): Promise<StageResult>;
  /** `slash` (spec 073 FR-005): the message started with a folder or user entry and its text was sent; the value says where it came from.
   *  `slashNote` (a VS Code prompt file): the settings not applied and the variables left as written. */
  send(id: string, text: string, attachments: PickedFile[], opts?: { plan?: boolean }): Promise<{ ok: boolean; error?: string; slash?: string; slashNote?: string }>;
  /** Spec 073 FR-010: the "/" entries of the agent's app in its folder (folder, user, app). */
  slashCommands?(id: string): Promise<{ ok: boolean; error?: string; entries: SlashCommandInfo[] }>;
  /**
   * Spec 083 FR-062 (issue 699): the folder's notes, by agent id (the window never passes a path). Everything stored is masked in main
   * before it is written; a refusal carries a short reason. `notesFileCount` / `notesSetFile` are the project-file switch (T042; the simulator answers *Demo: no file written*).
   */
  notesList?(id: string): Promise<NotesView>;
  notesSave?(id: string, input: { role: 'user' | 'agent'; ord: number; text: string; from?: 'agent' | 'user' | 'selection' }): Promise<NotesWrote>;
  notesAdd?(id: string, input: { text: string }): Promise<NotesWrote>;
  notesUpdate?(id: string, noteId: string, rev: number, patch: { title?: string; text?: string; done?: boolean }): Promise<NotesWrote>;
  notesDelete?(id: string, noteId: string, rev: number): Promise<NotesWrote>;
  notesDeleteAll?(id: string): Promise<NotesWrote>;
  notesStartOver?(id: string): Promise<NotesWrote>;
  notesFileCount?(id: string): Promise<NotesFileCount>;
  notesSetFile?(id: string, on: boolean, opts?: { deleteFile?: boolean; git?: boolean }): Promise<NotesSetFile>;
  /** FR-048 (T034b): main shows the save dialog and writes the chosen file; the window sends no path. The simulator writes nothing (`demo`). */
  notesExport?(id: string): Promise<NotesExport>;
  /** A folder's notes changed (another chat, another process): refetch the open folder's notes when the fingerprint is its own. */
  onNotesChanged?(cb: (v: { fingerprint: string }) => void): () => void;
  /** Spec 066: answer a proposed plan (window only). */
  resolvePlan?(id: string, requestId: string, answer: { kind: 'approve' | 'reject' | 'revise'; feedback?: string }): Promise<{ ok: boolean; error?: string }>;
  /** Interrupt the current turn only; the agent returns to Ready. */
  stop(id: string): Promise<void>;
  /** `remember` = "Approve for this session" (ignored when denying); `broad` = the wider "any arguments" scope of a shell request (only if offered). */
  resolvePermission(id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean): Promise<void>;
  /** Forget one "Approve for this session" grant (key from the `grants` event). */
  revokeGrant(id: string, key: string, callId?: string): Promise<number | void>;
  openInVSCode(id: string): Promise<{ ok: boolean; error?: string; edition?: string }>;
  /** Spec 063: the git branch and uncommitted changes of the agent's folder (read-only). Optional: older bridges lack it. */
  gitStatus?(id: string): Promise<FolderGitStatus>;
  /** Spec 085: what the session did since its first message in this run (time, git files and lines, commits), for the card shown when it ends. Optional: older bridges lack it. */
  sessionSummary?(id: string): Promise<SessionSummaryInfo>;
  /** Earlier Copilot CLI/SDK sessions in this agent's folder (newest first). Optional: not in the simulator. */
  listPrevious?(id: string): Promise<{ ok: boolean; error?: string; sessions: PreviousSession[]; pinned?: string[]; hidden?: string[]; names?: Record<string, string> }>;
  /** Pin, unpin, hide or unhide one row (spec 006 FR-026). `src` is the agent's adapter id or `vscode`; ids only, never a path. */
  markPrevious?(id: string, src: string, sessionId: string, mark: 'pin' | 'unpin' | 'hide' | 'unhide'): Promise<{ ok: boolean; error?: string }>;
  /** Delete one earlier session through the agent app's own API (spec 006 FR-029). `code: 'in-office'` = it still has a card. */
  deletePrevious?(id: string, sessionId: string): Promise<{ ok: boolean; error?: string; code?: 'in-office'; agentId?: string }>;
  /** Spec 059 FR-013: give a session the user's name. `sessionId` null = this agent's own session; an id = another open or previous session of the same folder. An empty name resets. */
  renameSession?(id: string, sessionId: string | null, name: string): Promise<RenameResult>;
  /** Spec 059 FR-013: a session's user name changed (here or in another window); `alias` undefined = reset. */
  onAgentRenamed?(cb: (e: { id: string; alias?: string }) => void): () => void;
  /** Resume one of them as a new agent in the same folder; `replace` retires this agent if it was never used. */
  resumeSession?(id: string, sessionId: string, replace: boolean): Promise<ResumeResult>;
  /** Read-only VS Code Copilot Chat history for this agent's folder. */
  listVsChats?(id: string): Promise<VsChatListResult>;
  readVsChat?(id: string, key: string): Promise<{ ok: boolean; error?: string; transcript?: VsChatTranscript }>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAgentAdded(cb: (a: AgentInfo) => void): () => void;
  /** The Settings… item of the macOS app menu (⌘,), spec 052 FR-083. */
  onMenuSettings?(cb: () => void): () => void;
  /** File > Add Folder… / Add VS Code Workspace… of the macOS menu (⌘O, ⇧⌘O), spec 052 FR-164; File > New Folder… (`new`), spec 093 FR-001a. */
  onMenuAdd?(cb: (kind: 'folder' | 'workspace' | 'new') => void): () => void;
  /** The window entered (true) or left (false) full screen, spec 052 FR-085. */
  onFullScreen?(cb: (on: boolean) => void): () => void;
  /** A double-click on a drag area of the top bar, spec 052 FR-085 (Mac only; main zooms, minimizes or ignores it by the system setting). */
  titleDoubleClick?(): void;
  /**
   * Spec 080 T014 (FR-003): the session browser. Every call names a top-level session; main looks it up and answers only with `BrowserState`
   * (URL, title, loading, history, mute and driver state): never the page's DOM, text, cookies or storage.
   */
  browserOpen?(id: string, address?: string): Promise<BrowserResult>;
  browserState?(id: string): Promise<BrowserResult>;
  browserNavigate?(id: string, address: string): Promise<BrowserResult>;
  browserBack?(id: string): Promise<BrowserResult>;
  browserForward?(id: string): Promise<BrowserResult>;
  browserReload?(id: string): Promise<BrowserResult>;
  browserStop?(id: string): Promise<BrowserResult>;
  /** The page area's rectangle in CSS pixels, relative to the window's page; main checks it and sets the native view's bounds. */
  browserBounds?(id: string, bounds: BrowserBounds): Promise<{ ok: boolean }>;
  /** Attach (true) or detach (false) the session's view. Only the Browser tab shown asks for true. */
  browserVisible?(id: string, visible: boolean): Promise<{ ok: boolean }>;
  /** A Durbar overlay covers the page area (FR-008): main hides the view while it is open. */
  browserOverlay?(id: string, open: boolean): Promise<{ ok: boolean }>;
  browserMute?(id: string, muted: boolean): Promise<BrowserResult>;
  /** Open the view's current http(s) address in the system browser (the existing external-link path). */
  browserOpenSystem?(id: string): Promise<{ ok: boolean }>;
  /** Spec 080 FR-030: a link from the chat (agent text): main classifies it. A web link opens in the session's browser; `link` says why a refused one is not opened (`mailto` waits for the user's click through `browserOpenMail`). `how: 'newTab'` (FR-124) is the link menu's *Open in a new tab*; the toggle itself is read in main. */
  browserOpenLink?(id: string, url: string, how?: 'default' | 'newTab'): Promise<BrowserResult>;
  /** Spec 080 FR-127: page tabs. Main mints every tab id; the window only names tabs main told it about. */
  browserNewTab?(id: string, address?: string): Promise<BrowserResult>;
  browserSelectTab?(id: string, tabId: string): Promise<BrowserResult>;
  browserCloseTab?(id: string, tabId: string): Promise<BrowserResult>;
  /** FR-123: the app-wide *Open chat links in a new tab* toggle. */
  browserSetLinksNewTab?(on: boolean): Promise<{ ok: boolean; on?: boolean }>;
  onBrowserTabs?(cb: (t: BrowserTabs) => void): () => void;
  onBrowserKey?(cb: (k: BrowserKeyEvent) => void): () => void;
  onBrowserLinksNewTab?(cb: (on: boolean) => void): () => void;
  /** Spec 080 FR-024: the user pressed *Open* on a mail link; main checks it is a `mailto:` link before it hands it to the system. */
  browserOpenMail?(url: string): Promise<{ ok: boolean }>;
  onBrowserState?(cb: (s: BrowserState) => void): () => void;
  /** The user accepted the one-time note (FR-025d); remembered in settings, never asked again. */
  browserConsentAccept?(): Promise<{ ok: boolean }>;
  /** FR-008: a still picture of the page area (an in-memory data URL) while an overlay hides the view. */
  browserSnapshot?(id: string): Promise<{ ok: boolean; image?: string }>;
  /** FR-025e: the user's answer to *Leave this page?* (true = Leave). */
  browserLeaveAnswer?(req: string, leave: boolean): Promise<{ ok: boolean }>;
  onBrowserDialog?(cb: (d: BrowserDialogEvent) => void): () => void;
  onBrowserLeave?(cb: (a: BrowserLeaveAsk) => void): () => void;
  /** The OS the app runs on ('darwin', 'win32', 'linux'), spec 052 FR-085: the Mac title bar styles. */
  platform?: string;
}

/** Spec 063: what `gitStatus` answers (mirrors `GitStatus` in src/main/gitstatus.ts; the window gets plain data only). */
export type FolderGitStatus =
  | { repo: false }
  | { repo: true; branch: string; detached?: boolean; ahead?: number; behind?: number; files: Array<{ path: string; state: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'; added?: number; removed?: number; binary?: boolean }>; more: number };

/** Spec 085: what `sessionSummary` answers (mirrors `SessionSummary` in src/main/sessionsummary.ts; `unreadable`: git could not be read, which is not "not a git folder"). `pullRequests`: only when the adapter reports them (none does yet). */
export type SessionSummaryInfo =
  | { ok: false; error: string }
  | { ok: true; ms: number; pullRequests?: number; git: { repo: false; unreadable?: true } | { repo: true; files: number; added: number; removed: number; binary: number; newFiles: number; commits: number; dirtyAtStart: boolean; noHead?: boolean; newFilesUnknown?: boolean } };

/** Spec 065: the note after a turn whose file-edit tools changed files. */
export interface CheckpointNote { id: string; turn: number; kind: 'turn' | 'undo'; files: { path: string; change: 'changed' | 'created' | 'deleted' }[]; notCovered: { path: string; why: string }[] }
export interface CheckpointPreview { ok: true; turn: number; files: { path: string; action: 'restore' | 'remove' | 'create'; diff?: string; binary?: boolean }[]; conflicts: string[]; notCovered: { path: string; why: string }[] }
export type CheckpointUndo =
  | { ok: true; restored: number; removed: number; created: number; undo: Omit<CheckpointNote, 'id'> }
  | { ok: false; error: string; conflicts?: string[] };

/** Spec 080 T014: what the session browser tells the window. Plain data, no page content. */
export interface BrowserState {
  id: string;
  /** False before the first open and after the session ended (the view is gone). */
  open: boolean;
  /** The page's address, userinfo dropped; '' for about:blank. */
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  muted: boolean;
  /** Who drives the view (FR-060). Always 'user' in Phase 1. */
  driver: 'user' | 'agent' | 'none';
  /** A page dialog (`alert`, `confirm`) is open and waiting for the user: the *Dialog open* marker (FR-025d). */
  dialogOpen: boolean;
  /** The note of a dialog main closed for the agent (FR-025d); the bar shows it with an icon. Page text, already masked. */
  note?: string;
  /** FR-011: the page was dropped to save memory and came back (`reloaded`), or too many pages are open and none could be unloaded (`many`). */
  memory?: 'reloaded' | 'many';
  /** A Chromium network error name such as ERR_CONNECTION_REFUSED after the last load failed. */
  error?: string;
  /** Spec 080 FR-127: the page tab this state is about (the session's active tab, chosen by main). Absent before the first open. */
  tabId?: string;
  /** FR-126: the last tab request hit the 10-tab limit; the bar says so until a tab closes or another tab action. */
  tabLimit?: true;
}
/** Spec 080 FR-127: one page tab as the window may see it. Explicit fields, primitives only; titles cleaned, URLs through `displayUrl`. */
export interface BrowserTab {
  tabId: string;
  kind: 'user' | 'agent';
  title: string;
  url: string;
  loading: boolean;
  dialogOpen: boolean;
  /** `dropped`: the cap closed this background tab's page (its address is kept); `reloaded` / `many` as `BrowserState.memory`. */
  memory?: 'dropped' | 'reloaded' | 'many';
}
/** Spec 080 FR-127: the `browser:tabs` push. */
export interface BrowserTabs { id: string; active: string; tabs: BrowserTab[] }
export type BrowserResult =
  | { ok: true; state: BrowserState; tabs?: BrowserTabs; linksNewTab?: boolean }
  | { ok: false; reason: string; state?: BrowserState; needsConsent?: true; link?: 'mailto' | 'refused'; tabLimit?: true };
/** A page dialog opened (FR-025d): the window raises a toast naming the session and, for a hidden view, brings its chat forward. `text` is masked page text. `tabId`: the tab it came from (FR-132); `bg`: a background tab of the session that is shown. */
export interface BrowserDialogEvent { id: string; type: string; text: string; shown: boolean; tabId?: string; bg?: boolean }
/** Spec 080 FR-130: a tab key pressed inside a page (main kept it from the page). */
export interface BrowserKeyEvent { id: string; key: 'new' | 'close' | 'next' | 'prev' }
/** FR-025e: ask *Leave this page?*; answer with `browserLeaveAnswer(req, leave)`. */
export interface BrowserLeaveAsk { id: string; req: string; known: boolean; shown: boolean }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
