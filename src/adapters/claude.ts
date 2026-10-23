/**
 * `ClaudeAdapter` (spec 012 FR-112, T091): Claude Code behind the `AgentAdapter` interface, over a `ClaudeTransport`
 * (claudeTransport.ts: the CLI transport by default; claudeSdk.ts when the SDK is available and chosen, FR-113).
 *
 * - Messages map through `ClaudeMapper` (claudeMap.ts) to normalized events.
 * - Permissions: the CLI's `can_use_tool` goes through Durbar's `PermissionBroker` (same modes, roots, grants and pending
 *   cards as Copilot); the Read-only `PreToolUse` hook answers with `preToolUseDecision`. The CLI's permission
 *   *suggestions* are never sent back (they would write the user's own settings).
 * - The CLI starts at the first message (lazy, like a restored Copilot folder). A session id given by the app is resumed
 *   when Claude has it on disk, otherwise created under that id.
 * - Settings files are never loaded (`--setting-sources ""`, Q8); the folder's `CLAUDE.md` (with `@` imports inside the
 *   folder) goes in as an appended system prompt instead (owner decision, review of #160).
 */
import { claudeSettingsJson } from '../shared/foldersetup';
import { isAuthError, markAuthError } from './autherrors';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeMapper, claudeMcpServers, withSkipped } from './claudeMap';
import type { ClaudeMessage } from './claudeMap';
import { claudeOptionsFor, parseMcpTool, preToolUseDecision, toolKind } from './claudeModes';
import { createCliTransport } from './claudeTransport';
import type { ClaudeTransport, ControlAnswer, IncomingControl, TransportHandlers, UserContent } from './claudeTransport';
import type { AdapterCapabilities, AdapterDescriptor, PermissionMode } from './capabilities';
import type { EventBody } from './map';
import { PermissionBroker, claudeServerPart, mcpToolBlockList, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import type { AgentAdapter, AgentEvent, AgentMessage, LimitAction, McpServerSpec, McpSignInResult, PlanAnswer, SignInCheck, StartOptions, Unsubscribe, WriteGuard } from './types';
import type { McpToolInfo } from './types';
import { normMcpTools } from './mcptools';
import { PLAN_REJECTED, cleanPlanText, reviseText } from './plan';
import { claudeAccount } from './accounts';
import type { AccountIdentity } from '../shared/account';

/** FR-156: what Settings says of a Claude Code that `auth status` calls signed in: only the first message can confirm it. */
export const CLAUDE_LOCAL_SIGN_IN = 'Signed in on this computer; confirmed at the first message.';
import { parseUsdCap } from '../shared/credits';
import { clipDiff } from '../shared/diff';
import { MCP_TOOL_OFF_RE, SIGN_IN_REQUEST_TIMEOUT_MS, claudeOAuthOf, signInTtlMs } from '../shared/mcp';
import { editOf } from './edits';
import { HANDOFF_PROMPT, cleanSummary } from './handoff';
import type { HandoffResult } from './handoff';
import type { ModelOption, ModelSwitchRequest, ModelSwitchResult } from '../shared/modelswitch';
import { allowedRemoteUrl, cleanRemoteError } from '../shared/remote';
import type { RemoteState } from '../shared/remote';
import { resolveWorkspaceCwd } from './workspace';
import { claudeConfigDir, listClaudeSessions, readClaudeHistory } from './claudeHistory';
import type { HistoryResult, PreviousSession } from './history';
import { cleanAnswers, parseQuestionsWithOriginals } from './questions';
import { claudeSlashPlaces, cleanBuiltins, mergeSlash, SlashCache, vscodeUserPromptDirs } from './slashcommands';
import type { SlashPlace } from './slashcommands';
import { agentsArg, listClaudeAgents } from './claudeAgents';
import type { ClaudeAgentDef } from './claudeAgents';
import type { AgentProfile, AskedQuestion, ElicitAnswer, SlashCommand, SlashExpansion } from './types';
import { answerElicitation, cancelElicitations, runElicitation, type ElicitWaiter } from './elicitation';

export const CLAUDE_ID = 'claude';
export const CLAUDE_NAME = 'Claude Code';

export const CLAUDE_CAPABILITIES: AdapterCapabilities = Object.freeze({
  interrupt: true,
  resume: true,
  images: true,
  models: true, // FR-118: from the CLI's initialize reply, no prompt
  modelSwitch: Object.freeze({ verified: true, contextTier: false }), // spec 030 FR-038/FR-039 (real 2026-10-20): from the next message; no separate tier
  effort: true,
  permissionModes: Object.freeze(['read-only', 'ask', 'allow'] as PermissionMode[]),
  permModeSwitch: 'live', // FR-115/FR-116: the broker and the hook at once, the CLI flags from the next message
  usage: Object.freeze({ tokens: true, costUsd: true, nanoAiu: false }),
  context: true, // FR-134: `modelUsage.contextWindow` and the main agent's last message
  caps: true, // FR-150: a dollar cap on Claude's own estimate
  capUnit: 'usd',
  helpers: true,
  history: true, // FR-125/FR-126: read-only from Claude's own session files
  mcpStatus: true,
  mcpToggle: true, // FR-133: mcp_toggle + mcp_status
  mcpStart: 'next-message', // spec 058 FR-010: the CLI (and its servers) is launched with the next message
  mcpToggleApplies: 'live', // FR-133 (a server that was off at launch: next message)
  mcpToolFilter: true, // spec 069 FR-062: --disallowedTools mcp__<server>__<tool> (read: CLI docs; not run on a real account)
  mcpTools: true, // spec 069 FR-031: the tools of a server in the mcp_status reply (read: docs McpServerStatus.tools; not run on a real account)
  mcpRestart: true, // spec 058 FR-012: control request mcp_reconnect (read: CLI 2.1.304 strings; not checked on a real account)
  mcpSignIn: true, // spec 058 FR-175: control request mcp_authenticate (undocumented; read: CLI 2.1.304 program only; not checked on a real account, T106)
  mcpSignInSteps: "If Sign in is not available, run `claude mcp login {name}` in a terminal and finish in your browser. This works only for a server in Claude Code's own settings. Then press Restart on this row.", // FR-181 (Q21 A)
  mcpSignInNote: 'Not checked on a real account yet.', // FR-180 until T106
  mcpSignInRestart: true, // FR-176/FR-181: Restart (mcp_reconnect) picks up a sign-in finished outside Durbar
  handoff: true, // spec 030 FR-034: a forked one-shot, the session is not changed
  oneShot: true, // spec 040 FR-015: no tools, no MCP, no settings, not saved
  renameSession: 'next-turn', // spec 059 FR-007: `--name` on the session's next CLI start (real: Vikram's agent, 2026-10-20, CLI 2.1.304)
  planMode: true, // spec 066 FR-004: set_permission_mode plan + ExitPlanMode through can_use_tool
  remote: true, // spec 054 FR-061 (real 2026-10-20): `remote_control` over stream-json; claude.ai sign-in on Pro/Max/Team/Enterprise
  remoteService: Object.freeze({ name: 'Claude', host: 'claude.ai', mobile: 'the Claude app' }),
}) as AdapterCapabilities;

/** Spec 059 FR-007: the SDK transport (dev opt-in, `DURBAR_CLAUDE_TRANSPORT=sdk`) does not apply `--name`, so it does not offer a rename. */
export const CLAUDE_SDK_CAPABILITIES: AdapterCapabilities = Object.freeze((() => {
  // the SDK transport sends only a few control requests (claudeSdk.ts): no rename, no mcp_reconnect, no mcp_authenticate (spec 058
  // FR-175); the terminal steps and the note stay (FR-180: the steps show without the in-app call)
  const { renameSession: _r, mcpRestart: _m, mcpTools: _t, mcpSignIn: _s, mcpSignInRestart: _sr, ...rest } = CLAUDE_CAPABILITIES as AdapterCapabilities & { renameSession?: unknown; mcpRestart?: unknown; mcpTools?: unknown; mcpSignIn?: unknown; mcpSignInRestart?: unknown };
  void _r;
  void _m;
  void _t;
  void _s;
  void _sr;
  return rest;
})()) as AdapterCapabilities;
/** Spec 058 FR-175: how long Durbar waits for the CLI's answer to `mcp_authenticate` (discovery and registration run first). */
export const CLAUDE_SIGN_IN_TIMEOUT_MS = SIGN_IN_REQUEST_TIMEOUT_MS; // one definition, in src/shared/mcp.ts (signInTtlMs uses the same limit)
/** Spec 058 FR-175/FR-181: the message for a CLI that does not answer the call (timeout, unknown subtype): main shows the terminal steps. */
export const CLAUDE_NO_SIGN_IN = 'This Claude Code version cannot start a sign-in from Agent Durbar.';
/**
 * A control error that says the CLI does not know the request at all (an older or newer CLI), not a refusal of this server: "unknown /
 * unsupported / unrecognized / unhandled ... subtype" or "... control request". Not "invalid": an "invalid request" can be a refusal of this
 * server, and its own reason is shown then (review on #635).
 */
const UNKNOWN_SUBTYPE = /\b(unknown|unsupported|unrecognized|unrecognised|unhandled)\b[^\n]{0,40}\b(subtype|control request)\b/i;
/** Spec 066: one sentence added to a plan-first message, so the plan reaches the card (Claude's plan file cannot be written in Read-only). */
export const CLAUDE_PLAN_NOTE = '(Plan first: write the full plan in your reply, not in a file, then call ExitPlanMode. Do not change anything yet.)';
/** The text blocks of one assistant message (top level). */
const assistantText = (m: ClaudeMessage): string => {
  const c = (m as { message?: { content?: unknown } }).message?.content;
  return Array.isArray(c) ? c.map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text + '\n' : '')).join('') : '';
};

/** Spec 066: the tools a plan-first turn may use beyond the mode's own reads: the proposal itself, and the loader of deferred tools. */
const PLAN_TOOLS: ReadonlySet<string> = new Set(['ExitPlanMode', 'ToolSearch']);

/** The hook callback id Durbar registers for `PreToolUse` (any string the CLI echoes back). */
export const PRE_TOOL_USE_HOOK = 'durbar_pre_tool_use';
/** CLAUDE.md budget: total characters of the file and its imports, and import depth. */
export const CLAUDE_MD_MAX_CHARS = 64 * 1024;
const CLAUDE_MD_MAX_DEPTH = 4;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const ASK_USER_DENY = 'Agent Durbar cannot show questions to the user yet. Do not ask; decide yourself, or write the question in your reply.';

/* ------------------------------------------------------------------ pure helpers (unit-tested) ------------------------------------------------------------------ */

/** A Claude tool call as the broker's request (kind from `toolKind`; path, command, URL and MCP server pulled from the input). */
export function permissionLikeOf(toolName: string, input: Record<string, unknown> | undefined, toolUseId?: string): PermissionLike {
  const kind = toolKind(toolName);
  const s = (k: string): string | undefined => (input && typeof input[k] === 'string' ? (input[k] as string) : undefined);
  const like: PermissionLike = { kind, toolName, ...(toolUseId ? { toolCallId: toolUseId } : {}) };
  if (kind === 'read' || kind === 'write') {
    const p = s('file_path') ?? s('notebook_path') ?? s('path');
    if (p) {
      like.path = p;
      like.fileName = p;
    }
    if (kind === 'write') {
      const d = editDiffOf(toolName, input, p);
      if (d) like.diff = d;
    }
  } else if (kind === 'shell') {
    const c = s('command');
    if (c) like.fullCommandText = c;
  } else if (kind === 'url') {
    const u = s('url') ?? s('query');
    if (u) like.url = u;
  } else if (kind === 'mcp') {
    const m = parseMcpTool(toolName);
    if (m) {
      like.serverName = m.server;
      like.toolName = m.tool;
    }
  }
  return like;
}

/**
 * Spec 052 FR-063: the change a Claude Edit, MultiEdit or Write would make, as a simple unified diff for the permission card; undefined
 * when the input has no text to compare. Write shows every line as added (Durbar does not read the file to compare).
 */
export function editDiffOf(toolName: string, input: Record<string, unknown> | undefined, file?: string): string | undefined {
  if (!input) return undefined;
  const f = file ?? 'file';
  const str = (v: unknown): v is string => typeof v === 'string';
  // the inputs that carry text to compare; spec 005 FR-018: the diff itself comes from the shared edit normalizer (masked, cut)
  const ok = (toolName === 'Edit' && str(input.old_string) && str(input.new_string)) || (toolName === 'Write' && str(input.content)) || (toolName === 'MultiEdit' && Array.isArray(input.edits));
  if (!ok) return undefined;
  const body = editOf(toolName, { ...input, edits: Array.isArray(input.edits) ? input.edits.slice(0, 50) : undefined, file_path: f })?.files[0]?.diff;
  return body ? clipDiff(`--- a/${f.replace(/[\r\n]+/g, ' ')}\n+++ b/${f.replace(/[\r\n]+/g, ' ')}\n${body}`) : undefined;
}

/** Durbar's MCP servers as the CLI's `--mcp-config` JSON (`disabled` names left out). Never logged: env and headers may hold secrets. */
export function mcpConfigOf(servers: Record<string, McpServerSpec> | undefined, disabled: readonly string[] = []): string | undefined {
  if (!servers) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || disabled.includes(name)) continue;
    if (spec.type === 'stdio' && spec.command) out[name] = { type: 'stdio', command: spec.command, args: spec.args ?? [], ...(spec.env ? { env: spec.env } : {}) };
    else if ((spec.type === 'http' || spec.type === 'sse') && spec.url) {
      // spec 058 FR-186: only the allow-listed oauth fields, picked again here (never a client secret, whatever the spec object holds)
      const oauth = spec.oauth ? claudeOAuthOf(spec.oauth) : undefined;
      out[name] = { type: spec.type, url: spec.url, ...(spec.headers ? { headers: spec.headers } : {}), ...(oauth ? { oauth } : {}) };
    }
  }
  return Object.keys(out).length ? JSON.stringify({ mcpServers: out }) : undefined;
}

/** What a transport needs to start a session (FR-111): the CLI turns it into argv, the SDK into `query()` options. */
export interface ClaudeLaunch {
  mode: PermissionMode;
  sessionId: string;
  resume: boolean;
  model?: string;
  effort?: string;
  /** spec 043 FR-008: the custom agent for this launch (`--agents` JSON and `--agent` name). */
  agent?: { name: string; json: string };
  /** `--mcp-config` JSON (`{"mcpServers": {...}}`); never logged, never on the command line (`cliLaunchArgs` passes a private file). */
  mcpConfig?: string;
  appendSystemPrompt?: string;
  /** spec 006 FR-019: the workspace's other folders (`--add-dir`, once each). */
  addDirs?: string[];
  /** FR-150: what is left of the session's dollar cap (`--max-budget-usd`). */
  maxBudgetUsd?: number;
  /** Spec 061 FR-004 (research R1): the folder's accepted hooks and rules as one composed `--settings` JSON; never logged. */
  settingsJson?: string;
  /** Spec 061 (Q3): the accepted folder allow rules, which pass Durbar's Read-only for the calls they cover. */
  folderAllow?: string[];
  /** Spec 059 FR-007: the user's name for the session; the CLI stores it as the session title (`--name`, also with `--resume`). */
  name?: string;
  /** Spec 069 FR-062: single MCP tools turned off in Durbar, as `mcp__<server>__<tool>`, added to the mode's `--disallowedTools`. */
  disallowedMcpTools?: string[];
}

export const CLAUDE_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
/** FR-119: Claude ids, aliases and `[1m]` suffixes get `--model`; `auto` and `default` mean Claude's default (no flag). */
export function claudeModelFlag(model: string | undefined): boolean {
  if (!model || model === 'auto' || model === 'default') return false;
  if (/^(gpt|o\d|gemini|grok|sim-)/i.test(model)) return false; // a Copilot or simulator id saved before the folder was Claude's
  return /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,79}$/.test(model);
}

/** FR-118: the `models` entries of the CLI's `initialize` reply in the model picker's shape; malformed entries are dropped. */
export function claudeModelOptions(models: unknown): ModelOption[] {
  if (!Array.isArray(models)) return [];
  const out: ModelOption[] = [];
  for (const m of models.slice(0, 50)) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const id = typeof o.value === 'string' ? o.value : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,79}$/.test(id) || out.some((x) => x.id === id)) continue;
    const name = typeof o.displayName === 'string' && o.displayName.trim() ? o.displayName.trim().slice(0, 60) : id;
    const efforts = Array.isArray(o.supportedEffortLevels) ? o.supportedEffortLevels.filter((e): e is string => typeof e === 'string' && CLAUDE_EFFORTS.has(e)) : [];
    out.push({ id, name, efforts, disabled: false });
  }
  return out;
}

/** A dollar amount for `--max-budget-usd`: at least $0.0001 (Claude stops at once), 4 decimals, no exponent. */
export function budgetText(usd: number): string {
  return String(Math.max(0.0001, Math.round(usd * 1e4) / 1e4).toFixed(4)).replace(/0+$/, '').replace(/\.$/, '');
}

/** FR-150: a usable dollar cap or undefined (no cap). */
const usdCap = (v: unknown): number | undefined => parseUsdCap(v);

/** Spec 059 FR-007: a name that may go to `--name`: 1..200 characters, no control characters, not starting with `-` (it is one argv item, never a shell string). */
export function claudeNameOk(name: unknown): boolean {
  // eslint-disable-next-line no-control-regex
  return typeof name === 'string' && name.length >= 1 && name.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(name) && name === name.trim() && !name.startsWith('-');
}

/** The CLI argv (FR-111). Mode flags come from `claudeOptionsFor`, so an unknown mode gets Read-only. */
/** Spec 069 FR-062: Claude Code's names of the tools turned off in Durbar (other names cannot be turned off at all: FR-063, `MCP_TOOL_OFF_RE`). */
export function claudeDisallowedMcp(off: Readonly<Record<string, readonly string[]>> | undefined): string[] {
  const out: string[] = [];
  for (const [server, tools] of Object.entries(off ?? {})) for (const t of tools ?? []) if (typeof t === 'string' && MCP_TOOL_OFF_RE.test(t)) out.push(`mcp__${claudeServerPart(server)}__${t}`);
  return out.slice(0, 5000);
}

export function claudeArgs(i: ClaudeLaunch): string[] {
  const o = claudeOptionsFor(i.mode, i.folderAllow);
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--include-partial-messages'];
  a.push('--permission-mode', o.permissionMode);
  if (o.allowDangerouslySkipPermissions) a.push('--allow-dangerously-skip-permissions');
  if (o.allowedTools?.length) a.push('--allowedTools', o.allowedTools.join(','));
  const deny = [...(o.disallowedTools ?? []), ...(i.disallowedMcpTools ?? [])];
  if (deny.length) a.push('--disallowedTools', deny.join(','));
  a.push('--setting-sources', o.settingSources.join(','));
  if (o.strictMcpConfig) a.push('--strict-mcp-config');
  if (i.mcpConfig) a.push('--mcp-config', i.mcpConfig);
  if (i.settingsJson) a.push('--settings', i.settingsJson);
  if (claudeModelFlag(i.model)) a.push('--model', i.model as string);
  if (i.effort && CLAUDE_EFFORTS.has(i.effort)) a.push('--effort', i.effort);
  if (i.appendSystemPrompt) a.push('--append-system-prompt', i.appendSystemPrompt);
  if (i.agent && /^[A-Za-z0-9._-]{1,64}$/.test(i.agent.name)) a.push('--agents', i.agent.json, '--agent', i.agent.name);
  for (const d of i.addDirs ?? []) a.push('--add-dir', d);
  if (i.maxBudgetUsd !== undefined && Number.isFinite(i.maxBudgetUsd)) a.push('--max-budget-usd', budgetText(i.maxBudgetUsd));
  if (claudeNameOk(i.name)) a.push('--name', i.name as string);
  a.push(i.resume ? '--resume' : '--session-id', i.sessionId);
  return a;
}

export interface ClaudeMdIo {
  readFile(p: string): string | undefined;
  realpath(p: string): string;
}

const nodeIo: ClaudeMdIo = {
  readFile: (p) => {
    try {
      const st = fs.statSync(p);
      return st.isFile() && st.size <= CLAUDE_MD_MAX_CHARS ? fs.readFileSync(p, 'utf8') : undefined;
    } catch {
      return undefined;
    }
  },
  realpath: (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  },
};

/**
 * The folder's `CLAUDE.md` with its `@path` imports expanded (an import is a whitespace-separated `@relative/path` token
 * outside code spans). Only files inside the folder (symlinks resolved) are read; at most `CLAUDE_MD_MAX_CHARS` in total
 * and `CLAUDE_MD_MAX_DEPTH` levels; each file once. Returns undefined when there is no CLAUDE.md.
 */
export function claudeMdPrompt(folder: string, io: ClaudeMdIo = nodeIo, flavor: Pick<typeof path, 'resolve' | 'relative' | 'isAbsolute' | 'dirname' | 'sep'> = path): string | undefined {
  const root = io.realpath(flavor.resolve(folder));
  const inside = (p: string): boolean => {
    const r = flavor.relative(root, p);
    return r === '' || (!r.startsWith('..') && !flavor.isAbsolute(r));
  };
  const seen = new Set<string>();
  let budget = CLAUDE_MD_MAX_CHARS;
  const load = (file: string, depth: number): string | undefined => {
    const real = io.realpath(file);
    if (!inside(real) || seen.has(real) || budget <= 0) return undefined;
    seen.add(real);
    const text = io.readFile(real);
    if (text === undefined) return undefined;
    const kept = text.slice(0, budget);
    budget -= kept.length;
    if (depth >= CLAUDE_MD_MAX_DEPTH) return kept;
    let inFence = false;
    return kept
      .split('\n')
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        if (inFence) return line;
        return line.replace(/(^|\s)@([^\s`]+)/g, (whole, pre: string, ref: string) => {
          if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('~')) return whole; // URLs and home paths are not imported
          const target = flavor.resolve(flavor.dirname(real), ref);
          const sub = load(target, depth + 1);
          return sub === undefined ? whole : `${pre}\n<!-- imported from ${ref} -->\n${sub}\n`;
        });
      })
      .join('\n');
  };
  const main = load(flavor.resolve(root, 'CLAUDE.md'), 0);
  return main === undefined || !main.trim() ? undefined : `The folder's CLAUDE.md (project instructions; Agent Durbar passes it because project settings are not loaded):\n\n${main}`;
}

/** A user message as the CLI's content: text, then images as base64 blocks; attached files are named in the text (Claude reads them with its tools). */
export function userContentOf(message: AgentMessage, readImage: (p: string) => Buffer | undefined = (p) => {
  try {
    return fs.readFileSync(p);
  } catch {
    return undefined;
  }
}): UserContent {
  const atts = message.attachments ?? [];
  const files = atts.filter((a) => a.kind !== 'image');
  let text = message.text;
  if (files.length) text += `\n\nAttached files:\n${files.map((f) => `- ${f.path}`).join('\n')}`;
  const images = atts.filter((a) => a.kind === 'image');
  if (!images.length) return text;
  const blocks: Exclude<UserContent, string> = [{ type: 'text', text }];
  for (const img of images) {
    const media = IMAGE_TYPES[path.extname(img.path).toLowerCase()];
    const data = media ? readImage(img.path) : undefined;
    if (media && data) blocks.push({ type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } });
  }
  return blocks;
}

/** True when Claude has a saved session with this id (`<config>/projects/<folder>/<id>.jsonl`). Bounded scan, never throws. */
export function claudeSessionExists(id: string, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')): boolean {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return false;
  try {
    const projects = path.join(configDir, 'projects');
    for (const d of fs.readdirSync(projects, { withFileTypes: true }).slice(0, 5000)) {
      if (d.isDirectory() && fs.existsSync(path.join(projects, d.name, `${id}.jsonl`))) return true;
    }
  } catch {
    /* no Claude data yet */
  }
  return false;
}

/* ------------------------------------------------------------------ the adapter ------------------------------------------------------------------ */

/** Everything a transport factory gets. */
export interface TransportInput {
  /** Absolute path of `claude`. */
  file: string;
  launch: ClaudeLaunch;
  cwd: string;
  env: NodeJS.ProcessEnv;
  handlers: TransportHandlers;
}
/** May be async (the SDK transport loads its package first). */
export type TransportFactory = (o: TransportInput) => ClaudeTransport | Promise<ClaudeTransport>;

/** The CLI transport (FR-111). */
/** Spec 012 FR-159: the entrypoint Claude records for the chat sessions Durbar starts (not an SDK value, so `claude --resume` lists them). */
export const CLAUDE_ENTRYPOINT = 'agent-durbar';

/**
 * Spec 069 FR-009 (change 2026-10-22, review 6 on #489): the `--mcp-config` JSON holds env and header values (Claude Code's user list
 * and the folder's extras), and a command line is visible to every local user (`ps`). It goes into `mcp-config.json`, mode 0600, in a
 * new private temp folder (`mkdtemp`, 0700); `--mcp-config` gets the path; `cleanup` deletes the folder (on the CLI's exit).
 */
export function privateMcpConfig(json: string, tmpRoot: string = os.tmpdir()): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'durbar-mcp-'));
  const cleanup = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the OS cleans its temp folder */
    }
  };
  try {
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'mcp-config.json');
    fs.writeFileSync(file, json, { mode: 0o600, flag: 'wx' });
    return { file, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** The CLI argv for a launch, with the MCP JSON moved to a private file (`privateMcpConfig`). */
export function cliLaunchArgs(launch: ClaudeLaunch, tmpRoot?: string): { args: string[]; cleanup: () => void } {
  if (!launch.mcpConfig) return { args: claudeArgs(launch), cleanup: () => undefined };
  const p = privateMcpConfig(launch.mcpConfig, tmpRoot);
  return { args: claudeArgs({ ...launch, mcpConfig: p.file }), cleanup: p.cleanup };
}

export const cliTransportFactory: TransportFactory = (o) => {
  const { args, cleanup } = cliLaunchArgs(o.launch);
  try {
    return createCliTransport({
      file: o.file,
      args,
      cwd: o.cwd,
      env: o.env,
      handlers: {
        ...o.handlers,
        exit: (info) => {
          cleanup();
          o.handlers.exit(info);
        },
      },
    });
  } catch (e) {
    cleanup();
    throw e;
  }
};

export interface ClaudeAdapterDeps {
  /** Absolute path of `claude` (from detect); resolved lazily at the first start of a CLI. */
  claudePath: () => Promise<string | undefined>;
  /** Makes a transport (tests inject a fake; default: the CLI transport; the SDK transport when chosen, FR-113). */
  makeTransport?: TransportFactory;
  /** The SDK transport is in use (dev opt-in): it does not apply `--name`, so the adapter offers no rename (spec 059). */
  sdkTransport?: boolean;
  sessionExists?: (id: string) => boolean;
  claudeMd?: (folder: string) => string | undefined;
  readImage?: (p: string) => Buffer | undefined;
  env?: () => NodeJS.ProcessEnv;
  /** Claude's config folder (tests); default `CLAUDE_CONFIG_DIR` or `~/.claude`. */
  configDir?: string;
  /** VS Code's user prompt folders (spec 073 delta 2026-10-23); default `vscodeUserPromptDirs()`. Tests pass their own. */
  vscodePromptDirs?: string[];
  /** Runs `claude` once with fixed arguments (spec 030 FR-034: the hand-off summary); tests inject a fake. */
  runOnce?: RunOnce;
  /** Spec 012 FR-156: `loggedIn` of `claude auth status --json` (local); tests inject a fake. Default: runs it on the found `claude`. */
  loggedIn?: () => Promise<boolean | undefined>;
  /** Spec 051 FR-011: the parsed `claude auth status --json` (local); tests inject a fake. Default: runs it on the found `claude`. */
  authJson?: () => Promise<Record<string, unknown> | undefined>;
  /** Spec 058 FR-175: the clock of a sign-in's `ttlMs` (tests inject one). Default `performance.now()` (monotonic). */
  now?: () => number;
  /** Spec 058 FR-175: how long to wait for the `mcp_authenticate` answer (tests pass a short one). Default 30 s. */
  signInTimeoutMs?: number;
}

export type RunOnce = (file: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ code: number | null; stdout: string }>;

const execRunOnce: RunOnce = (file, args, o) =>
  new Promise((resolve) => {
    // stdin closed: with an open pipe `claude -p` waits 3 s for input
    const child = spawn(file, args, { cwd: o.cwd, env: o.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (b: Buffer) => {
      if (out.length < 4 * 1024 * 1024) out += b.toString('utf8');
    });
    const timer = setTimeout(() => child.kill(), o.timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout: out });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out });
    });
  });

/** Spec 030 FR-034: the one-shot that summarizes a FORK of the session: no tools, no MCP, no settings, not saved, at most $0.50. */
export function handoffArgs(i: { sessionId: string; model?: string }): string[] {
  const a = ['-p', HANDOFF_PROMPT, '--resume', i.sessionId, '--fork-session', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--output-format', 'json', '--max-budget-usd', '0.5'];
  if (claudeModelFlag(i.model)) a.push('--model', i.model as string);
  return a;
}

/** Spec 040 FR-015: a stand-alone one-shot (no session at all): no tools, no MCP, no settings, not saved, at most $0.25, on haiku. */
export function oneShotArgs(prompt: string): string[] {
  return ['-p', prompt, '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--output-format', 'json', '--max-budget-usd', '0.25', '--model', 'haiku'];
}

/** The `--output-format json` result of that one-shot: the summary text and Claude's cost estimate. */
export function parseHandoffOutput(stdout: string): HandoffResult {
  let o: Record<string, unknown> | undefined;
  for (const line of stdout.split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object' && (v as { type?: unknown }).type === 'result') { o = v as Record<string, unknown>; break; }
    } catch { /* not JSON */ }
  }
  if (!o) return { summary: '' };
  const cost = typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd) && o.total_cost_usd > 0 ? o.total_cost_usd : undefined;
  const ok = o.subtype === 'success' && o.is_error !== true;
  return { summary: ok ? cleanSummary(o.result) : '', ...(cost !== undefined ? { costUsd: cost } : {}) };
}

interface Session {
  id: string;
  /** Spec 066: a plan-first turn is open (the CLI is in permission mode `plan`); plans waiting for the user. */
  planTurn?: boolean;
  plans?: Map<string, (answer: PlanAnswer) => void>;
  /** Spec 066: what Claude wrote during the plan-first turn (the plan when ExitPlanMode carries none). */
  planDraft?: string;
  cwd: string;
  roots: string[];
  options: StartOptions;
  broker: PermissionBroker;
  mapper: ClaudeMapper;
  /** True once Claude has this id on disk (resume on the next CLI start). */
  resumable: boolean;
  transport?: ClaudeTransport;
  starting?: Promise<ClaudeTransport>;
  stopping?: boolean;
  /** The CLI was started with --resume and exited before `init`: retry once as a new session under the same id. */
  resumeTried?: boolean;
  initSeen?: boolean;
  /** The mode the running CLI was launched with (its flags); differs from the broker's mode after a live switch until the next send (FR-116). */
  launchedMode?: PermissionMode;
  /** A user message was sent and its `result` has not come yet (a relaunch would cut the turn). */
  turnOpen?: boolean;
  /** Spec 054 FR-062: Remote Control is on; a relaunch turns it back on. */
  remoteOn?: boolean;
  /** The claude.ai link while it is on (a relaunch may give a new one). */
  remoteUrl?: string;
  /** MCP servers left out of the running CLI's config at launch (FR-133): turning one on needs a relaunch. */
  launchedOff?: Set<string>;
  needsRelaunch?: boolean;
  /** An `mcp_status` request for an MCP sign-in challenge is in flight. */
  mcpRefreshing?: boolean;
  /** Spec 058 FR-060: servers whose tool call showed a sign-in challenge; read as needs-auth until the CLI reports a real change for them. */
  mcpAuthSeen?: Set<string>;
  /** The last server list this session emitted (before the sign-in mark), so a challenge can show at once. */
  lastMcp?: ReturnType<typeof claudeMcpServers>;
  /** Spec 059 FR-007: the user's name waiting for the next CLI start, and the one the running CLI was started with (reported as the title after its first turn). */
  pendingName?: string;
  launchedName?: string;
  /** spec 043 FR-008: the selected custom agent (passed on every launch). */
  agent?: ClaudeAgentDef;
  /** FR-150: the dollar cap (Claude's estimate) and what the session spent while Durbar ran it. */
  capUsd?: number;
  spentUsd: number;
  /** FR-150: the cap was reached; the next message waits here until `resolveLimit` (or a higher cap) lets it go. */
  limit?: { requestId: string; held?: AgentMessage };
  /** Questions waiting for the user (FR-128): request id -> what was asked, Claude's original texts, and the waiter. */
  questions?: Map<string, { asked: AskedQuestion[]; originals: string[]; resolve: (a: Record<string, string> | null) => void }>;
  /** MCP elicitations waiting for the user (FR-151): request id -> waiter. */
  elicitations?: Map<string, ElicitWaiter>;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = CLAUDE_ID;
  readonly displayName = CLAUDE_NAME;
  readonly capabilities: AdapterCapabilities;
  debug?: (message: string) => void;
  /** Spec 065 FR-001: assigned by the main process (router.setWriteGuard). */
  writeGuard?: WriteGuard;
  private sessions = new Map<string, Session>();
  /** Spec 059 FR-007: names for sessions that are not open yet (by Claude session id); applied at their first start. */
  private pendingNames = new Map<string, string>();
  private listeners = new Set<(event: AgentEvent) => void>();

  constructor(private readonly deps: ClaudeAdapterDeps) {
    // spec 059 FR-007: on the SDK transport `--name` is not applied, so no rename is offered (capability and member agree, contract C2)
    this.capabilities = deps.sdkTransport ? CLAUDE_SDK_CAPABILITIES : CLAUDE_CAPABILITIES;
    if (deps.sdkTransport) (this as { renameSession?: unknown }).renameSession = undefined;
    if (deps.sdkTransport) (this as { restartMcpServer?: unknown }).restartMcpServer = undefined;
    if (deps.sdkTransport) (this as { listMcpTools?: unknown }).listMcpTools = undefined;
    if (deps.sdkTransport) (this as { startMcpSignIn?: unknown }).startMcpSignIn = undefined;
    if (deps.sdkTransport) (this as { refreshMcpStatus?: unknown }).refreshMcpStatus = undefined;
  }

  onEvent(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Spec 012 FR-156: Claude Code offers no free server-side check (`claude auth status` reads this computer only; any real request
   * spends tokens). So a sign-in that `auth status` denies is `signed-out`, and anything else is `unknown`: an expired or refused
   * sign-in is learned at the first message (FR-157).
   */
  async verifySignIn(): Promise<SignInCheck> {
    const probe = this.deps.loggedIn ?? (async () => {
      const p = await this.deps.claudePath();
      if (!p) return undefined;
      const { claudeLoggedIn, nodeDetectEnv, nodeExec } = await import('./detect');
      return claudeLoggedIn(p, nodeDetectEnv(), nodeExec);
    });
    const loggedIn = await probe().catch(() => undefined);
    if (loggedIn === false) return { status: 'signed-out', detail: 'No Claude Code sign-in on this computer.' };
    return { status: 'unknown', detail: CLAUDE_LOCAL_SIGN_IN };
  }

  /**
   * Spec 051 FR-011: the account `claude auth status --json` reports (email and plan for a Claude sign-in, an API key, a provider).
   * Local, no prompt, nothing billed. Personal data: never passed to `debug` (FR-015).
   */
  async accountInfo(): Promise<AccountIdentity> {
    const probe = this.deps.authJson ?? (async () => {
      const p = await this.deps.claudePath();
      if (!p) return undefined;
      const { claudeAuthStatus, nodeDetectEnv, nodeExec } = await import('./detect');
      return claudeAuthStatus(p, nodeDetectEnv(), nodeExec);
    });
    return claudeAccount(await probe().catch(() => undefined));
  }

  private initCache?: { at: number; reply: Promise<Record<string, unknown>> };

  /**
   * FR-118: the models the user's `claude` offers, from its `initialize` reply. A short-lived CLI in Read-only in the temp
   * folder; no prompt is written, so no tokens are spent. Cached 10 minutes; any failure is an empty list.
   */
  listModelOptions(): Promise<ModelOption[]> {
    return this.initReply().then((r) => claudeModelOptions(r.models));
  }

  /** The probe's `initialize` reply (models, and spec 073's built-in `commands`), cached 10 minutes; a failure is `{}` and is retried next time. */
  private initReply(): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (this.initCache && now - this.initCache.at < 10 * 60_000) return this.initCache.reply;
    const reply = this.probeInit().catch((e) => {
      this.debug?.(`claude: initialize probe failed: ${e instanceof Error ? e.message : String(e)}`);
      this.initCache = undefined; // try again next time
      return {} as Record<string, unknown>;
    });
    this.initCache = { at: now, reply };
    return reply;
  }

  private async probeInit(): Promise<Record<string, unknown>> {
    const file = await this.deps.claudePath();
    if (!file) return {};
    const make = this.deps.makeTransport ?? cliTransportFactory;
    const t = await make({
      file,
      launch: { mode: 'read-only', sessionId: randomUUID(), resume: false },
      cwd: os.tmpdir(),
      env: (this.deps.env ?? (() => process.env))(),
      handlers: { message: () => undefined, control: async () => ({ error: 'not handled in the model probe' }), exit: () => undefined },
    });
    try {
      return await t.request({ subtype: 'initialize' }, 20_000);
    } finally {
      await t.close().catch(() => undefined);
    }
  }

  /** Spec 073 FR-004: the folder's and the user's skills and commands (Claude does not load them: `--setting-sources ""`). */
  private readonly slash = new SlashCache();
  private slashPlaces(s: Session): SlashPlace[] {
    return claudeSlashPlaces(s.roots, this.deps.configDir ?? claudeConfigDir(), undefined, this.deps.vscodePromptDirs ?? vscodeUserPromptDirs());
  }

  /** Spec 073 FR-001: files first, then the built-ins of the CLI's `initialize` reply that run in Durbar's sessions (FR-006, FR-007). */
  async listSlashCommands(sessionId: string): Promise<SlashCommand[]> {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    const builtins = cleanBuiltins((await this.initReply()).commands);
    return mergeSlash(this.slash.list(this.slashPlaces(s), { refresh: true }), builtins); // the window opening its list: read afresh
  }

  /** Spec 073 FR-005: a folder or user entry is sent as its text (real 2026-10-22: Claude sends an unknown `/name` to the model as is). */
  async expandSlashCommand(sessionId: string, text: string): Promise<SlashExpansion | undefined> {
    const s = this.sessions.get(sessionId);
    return s ? this.slash.expand(text, () => this.slashPlaces(s)) : undefined; // no IO unless the text is a `/name` line
  }

  /** spec 043 FR-008: the custom agents of the session's folders and of the user (read by the adapter; Claude does not load them). */
  async listAgentProfiles(sessionId: string): Promise<AgentProfile[]> {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    return listClaudeAgents(s.roots, this.deps.configDir).map((d) => d.profile);
  }

  /**
   * spec 043 FR-008: the agent the session starts with (`--agents`/`--agent` on its first launch); null = without. Claude fixes the
   * agent when a session is created and ignores `--agent` on `--resume` (real, 2026-10-19), so a session that already exists refuses.
   */
  async selectAgentProfile(sessionId: string, id: string | null): Promise<AgentProfile | null> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Unknown Claude session.');
    if (s.resumable) throw new Error('Claude Code sets the agent when a session starts. Start a new session with this agent (+ New session).');
    const def = id === null ? undefined : listClaudeAgents(s.roots, this.deps.configDir).find((d) => d.profile.id === id);
    if (id !== null && !def) throw new Error('That agent is not available in this session.');
    s.agent = def;
    this.emit(s.id, { type: 'agentProfile', profile: def ? def.profile : null });
    return def ? def.profile : null;
  }

  /** FR-125: this folder's earlier Claude sessions, read-only from Claude's session files. */
  async listPreviousSessions(cwd: string, excludeIds?: ReadonlySet<string>): Promise<PreviousSession[]> {
    return listClaudeSessions(cwd, excludeIds, this.deps.configDir);
  }

  /** FR-126: a session's chat for the replay after a resume. */
  async history(sessionId: string): Promise<HistoryResult> {
    return readClaudeHistory(sessionId, this.sessions.get(sessionId)?.cwd, this.deps.configDir);
  }

  /**
   * Spec 059 FR-007 (Q10): the user's name for a session. Claude has no call for it on the CLI transport, but `--name` together with
   * `--resume <id>` keeps the session id and appends a title that Claude itself writes (real, Vikram's agent, 2026-10-20). So the name
   * is only remembered here and goes with the session's next CLI start: an open session is relaunched before its next message (as
   * for a mode change, a resume, no extra prompt); one that is not open gets it at its first start. After the first turn that follows,
   * the adapter reports the name as the session's `title`. Durbar never writes the session file.
   */
  async renameSession(sessionId: string, name: string): Promise<void> {
    if (!claudeNameOk(name)) throw new Error('Claude Code cannot use that name.');
    const s = this.sessions.get(sessionId);
    if (s) {
      s.pendingName = name;
      s.needsRelaunch = true;
      return;
    }
    if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) throw new Error('Unknown Claude session.');
    if (!this.pendingNames.has(sessionId) && this.pendingNames.size >= 50) this.pendingNames.delete(this.pendingNames.keys().next().value as string);
    this.pendingNames.set(sessionId, name);
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async start(options: StartOptions): Promise<string> {
    const mode = startModeOf(options);
    const ws = resolveWorkspaceCwd(options.workspace);
    const given = options.resumeSessionId ?? options.sessionId;
    const id = given ?? randomUUID();
    if (this.sessions.has(id)) return id;
    const exists = this.deps.sessionExists ?? claudeSessionExists;
    const resumable = options.resumeSessionId !== undefined || (given !== undefined && exists(id));
    const roots = [...new Set([ws.cwd, ...ws.folders])];
    const blocked = mcpToolBlockList(options.disabledMcpTools); // spec 069 FR-063
    const broker = new PermissionBroker({ roots, mode, blockedTools: () => blocked, emit: (e) => this.onBroker(id, e), beforeWrite: (paths) => this.writeGuard?.(id, paths) ?? Promise.resolve() }); // spec 065 FR-001
    const mapper = new ClaudeMapper((b) => this.onMapped(id, b), { quiet: true, onDropped: (why) => this.debug?.(`claude: dropped ${why}`) });
    this.sessions.set(id, { id, cwd: ws.cwd, roots, options: { ...options, permissionMode: mode }, broker, mapper, resumable, capUsd: usdCap(options.maxAiCredits), spentUsd: 0, ...(this.pendingNames.has(id) ? { pendingName: this.pendingNames.get(id), needsRelaunch: false } : {}) });
    this.pendingNames.delete(id);
    if (!options.quiet) this.emit(id, { type: 'status', status: 'idle', intent: `Ready in ${ws.cwd}` });
    return id;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    const s = this.mustGet(sessionId);
    // FR-150: at the cap, the message waits for the user's answer to the limit notice (like Copilot's blocked request)
    if (s.limit || this.capReached(s)) {
      this.openLimit(s).held = message;
      return;
    }
    if (message.attachments?.length) s.broker.allowReadPaths(message.attachments.map((a) => a.path));
    this.emit(sessionId, { type: 'status', status: 'working', intent: 'Thinking' });
    let t: ClaudeTransport;
    try {
      // FR-116: new flags for a changed mode, but never in the middle of a turn (the hook keeps the current mode until then)
      if (s.transport?.alive && !s.turnOpen && ((s.launchedMode !== undefined && s.launchedMode !== s.broker.getMode()) || s.needsRelaunch)) await this.relaunchForMode(s);
      t = await this.ensureTransport(s);
    } catch (e) {
      this.emit(sessionId, { type: 'status', status: 'error', intent: e instanceof Error ? e.message : 'Claude could not start' });
      return;
    }
    // spec 066 FR-004: plan first: Claude Code's own plan mode for this turn (it reads and proposes with ExitPlanMode; nothing changes)
    if (message.plan) {
      try {
        await t.request({ subtype: 'set_permission_mode', mode: 'plan' }, 15_000);
        s.planTurn = true;
        s.planDraft = '';
      } catch (e) {
        this.emit(sessionId, { type: 'status', status: 'error', intent: `Claude could not switch to plan mode: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    }
    s.turnOpen = true;
    t.sendUser(userContentOf(message.plan ? { ...message, text: `${message.text}\n\n${CLAUDE_PLAN_NOTE}` } : message, this.deps.readImage));
  }

  /** Spec 066 FR-004: back to the launch mode of the folder's permission mode after a plan-first turn (never wider). */
  private async leavePlanMode(s: Session): Promise<void> {
    if (!s.planTurn) return;
    s.planTurn = false;
    const mode = claudeOptionsFor(s.launchedMode ?? s.broker.getMode()).permissionMode;
    await s.transport?.request({ subtype: 'set_permission_mode', mode }, 15_000).catch(() => undefined);
  }

  /** Spec 066 FR-002: the user's answer to a proposed plan. */
  async resolvePlan(sessionId: string, requestId: string, answer: PlanAnswer): Promise<void> {
    const w = this.sessions.get(sessionId)?.plans?.get(requestId);
    if (w) w(answer);
  }

  async interrupt(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.broker.denyPending();
    this.cancelQuestions(s);
    if (s.transport?.alive) {
      s.mapper.expectAbort();
      try {
        await s.transport.request({ subtype: 'interrupt' }, 5000);
      } catch {
        /* no turn running */
      }
    }
    this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Aborted' });
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.stopping = true;
    s.broker.stop(); // pending permissions are answered deny; grants are dropped
    this.cancelQuestions(s);
    try {
      await s.transport?.close();
    } catch {
      /* already gone */
    }
    this.sessions.delete(sessionId);
    this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  /**
   * Live mode switch (spec 012 FR-115): the broker takes the new mode at once (the hook and `canUseTool` read it on every call);
   * the CLI's own flags follow on the next send (FR-116). Same pending rules as Copilot.
   */
  setPermMode(sessionId: string, mode: PermissionMode, opts: { clearGrants?: boolean; approvePending?: boolean } = {}): { pending: number } {
    const s = this.sessions.get(sessionId);
    if (!s) return { pending: 0 };
    s.broker.setMode(mode);
    s.options = { ...s.options, permissionMode: mode };
    if (opts.clearGrants) s.broker.clearGrants();
    let pending = s.broker.pendingCount();
    if (pending) {
      if (opts.approvePending && mode !== 'read-only') pending -= s.broker.approvePending();
      else if (mode === 'read-only') pending -= s.broker.denyPendingByUser();
    }
    return { pending };
  }

  /**
   * FR-133: switch one MCP server of the session. Live: the CLI's `mcp_toggle`, then `mcp_status` for the new list. Always kept in
   * the start options so a relaunch keeps it; a session that is not running only records it.
   */
  async setMcpEnabled(sessionId: string, name: string, enabled: boolean): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Unknown Claude session.');
    const off = new Set(s.options.disabledMcpServers ?? []);
    if (enabled) off.delete(name);
    else off.add(name);
    s.options = { ...s.options, disabledMcpServers: [...off] };
    if (!s.transport?.alive) return;
    if (enabled && s.launchedOff?.has(name)) {
      s.needsRelaunch = true; // not in the running CLI's config: it comes back with the next message (a resume, no extra prompt)
      return;
    }
    await s.transport.request({ subtype: 'mcp_toggle', serverName: name, enabled }, 15_000);
    s.mcpAuthSeen?.delete(name); // a real change for this server
    try {
      const r = await s.transport.request({ subtype: 'mcp_status' }, 15_000);
      s.lastMcp = withSkipped(claudeMcpServers(r.mcpServers), s.mapper.skipped);
      this.emit(s.id, { type: 'mcp', servers: this.withAuthSeen(s, s.lastMcp) });
    } catch {
      /* the toggle worked; the list comes with the next init */
    }
  }

  /**
   * Spec 058 FR-012: restart one MCP server of the running CLI with the control request `mcp_reconnect` ("Reconnects a disconnected
   * or failed MCP server", read: CLI 2.1.304), then `mcp_status` for the new list. The CLI is not launched for it: before the first
   * message there is nothing to restart. A server that was off at launch is not in the CLI's config at all.
   */
  async restartMcpServer(sessionId: string, name: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('This session is not running. Send a message to start it.');
    if (!s.transport?.alive) throw new Error('Claude Code starts its MCP servers with your next message; there is nothing to restart yet.');
    if (s.launchedOff?.has(name) || (s.options.disabledMcpServers ?? []).includes(name)) throw new Error('Switch it on first; it starts with your next message.');
    await s.transport.request({ subtype: 'mcp_reconnect', serverName: name }, 30_000);
    // spec 058 FR-176: a restart is a real change for this server: its FR-060 sign-in mark ends (a sign-in finished outside Durbar shows)
    s.mcpAuthSeen?.delete(name);
    try {
      const r = await s.transport.request({ subtype: 'mcp_status' }, 15_000);
      s.lastMcp = withSkipped(claudeMcpServers(r.mcpServers), s.mapper.skipped);
      this.emit(s.id, { type: 'mcp', servers: this.withAuthSeen(s, s.lastMcp) });
    } catch {
      /* the reconnect worked; the list comes with the next init */
    }
  }

  /**
   * Spec 058 FR-175 (T099): Claude Code's own sign-in for one MCP server of the running CLI: the control request `mcp_authenticate
   * {serverName}` (undocumented; `read:` 2.1.304: the CLI runs discovery, registration and PKCE, opens its own listener on 127.0.0.1 for
   * 5 minutes and answers the page to open). Nothing else is sent: no `redirectUri` (the CLI keeps its own callback), never
   * `mcp_oauth_callback_url` (that would pass the code through Durbar), never `mcp_clear_auth`. The answer's `state`, `callbackPort` and
   * `redirectScheme` are read by nothing; the answer is never logged. A timeout or an unknown subtype means this CLI cannot do it here:
   * the terminal steps show. A late answer after the timeout is dropped unread by the transport (unknown `request_id`).
   */
  async startMcpSignIn(sessionId: string, name: string): Promise<McpSignInResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('This session is not running. Send a message to start it, then sign in.');
    const t = s.transport;
    if (!t?.alive) throw new Error('Send a message first, then sign in.'); // Q15: no early CLI launch for a sign-in
    if (s.launchedOff?.has(name) || (s.options.disabledMcpServers ?? []).includes(name)) throw new Error('Switch it on first; it starts with your next message.');
    const now = this.deps.now ?? (() => performance.now()); // monotonic: a wall-clock jump never stretches or empties ttlMs (review on #635)
    const sent = now();
    let r: Record<string, unknown>;
    try {
      r = await t.request({ subtype: 'mcp_authenticate', serverName: name }, this.deps.signInTimeoutMs ?? CLAUDE_SIGN_IN_TIMEOUT_MS);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/timed out/i.test(m) || UNKNOWN_SUBTYPE.test(m)) throw new Error(CLAUDE_NO_SIGN_IN);
      throw new Error(m); // a refusal ("Server not found", "does not support OAuth authentication", ...): main masks it (FR-067)
    }
    // the CLI was relaunched or ended meanwhile: its listener is gone with it
    if (this.sessions.get(sessionId) !== s || s.transport !== t || !t.alive) throw new Error('Claude Code restarted during the sign-in. Press Sign in again.');
    const url = r?.authUrl;
    if (typeof url === 'string' && url && r.requiresUserAction === true && r.callbackExpected !== false) return { kind: 'browser', url, ttlMs: signInTtlMs(now() - sent) };
    if (r?.requiresUserAction === false && url === undefined) {
      // FR-175 (review on #635): the CLI says this server needs no browser step: a real change, so its FR-060 mark ends (as Restart
      // does) and the row reads what the CLI reports, in step with the "Signed in" toast
      if (s.mcpAuthSeen?.delete(name) && s.lastMcp) this.emit(s.id, { type: 'mcp', servers: this.withAuthSeen(s, s.lastMcp) });
      return { kind: 'connected' };
    }
    // a claude.ai connector (`callbackExpected: false`) or any other shape: not a sign-in Durbar can finish here
    throw new Error('Claude Code cannot finish this sign-in inside Agent Durbar.');
  }

  /**
   * Spec 058 FR-176: read the running CLI's server list again (`mcp_status`) for main's poll while a sign-in page is open, and once on a
   * dialog open or window focus soon after an attempt. **A re-read is not a new status**: a server the CLI still calls `connected` keeps
   * its FR-060 sign-in mark; a server whose reported status changed loses it. Never launches the CLI.
   */
  async refreshMcpStatus(sessionId: string, _name?: string): Promise<void> {
    void _name; // one mcp_status covers every server of the session
    const s = this.sessions.get(sessionId);
    const t = s?.transport;
    if (!s || !t?.alive) return;
    const r = await t.request({ subtype: 'mcp_status' }, 15_000);
    if (this.sessions.get(sessionId) !== s || s.transport !== t) return;
    this.reread(s, withSkipped(claudeMcpServers(r.mcpServers), s.mapper.skipped));
  }

  /** Spec 069 FR-031: the tools of one server, from the CLI's `mcp_status` reply (no extra start: only a running CLI is asked). */
  async listMcpTools(sessionId: string, name: string): Promise<McpToolInfo[]> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('This session is not running. Send a message to start it.');
    if (!s.transport?.alive) throw new Error('Claude Code starts its MCP servers with your next message; send one to see the tools.');
    const r = await s.transport.request({ subtype: 'mcp_status' }, 15_000);
    const list: unknown[] = Array.isArray(r?.mcpServers) ? r.mcpServers : [];
    const srv = list.find((x) => !!x && typeof x === 'object' && (x as { name?: unknown }).name === name) as { tools?: unknown; status?: unknown } | undefined;
    if (!srv) throw new Error(`${name} is not running in this session.`);
    return normMcpTools(srv.tools);
  }

  /** FR-128: the user's answers (question text -> label(s)), or null when they skipped. */
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string> | null): void {
    const q = this.sessions.get(sessionId)?.questions?.get(requestId);
    q?.resolve(answers);
  }

  /** FR-151: the user's answer to an MCP elicitation (main checked it against the fields). */
  answerElicitation(sessionId: string, requestId: string, answer: ElicitAnswer): void {
    answerElicitation(this.sessions.get(sessionId)?.elicitations, requestId, answer);
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false, broad = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember, broad);
  }

  revokeGrant(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.broker.revoke(key);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  /* ---------------- internals ---------------- */

  private mustGet(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Unknown Claude session.');
    return s;
  }

  /** Ends the running CLI so the next launch uses the current mode's flags; the session id is resumed (FR-116). */
  private async relaunchForMode(s: Session): Promise<void> {
    const t = s.transport;
    if (!t) return;
    s.stopping = true; // this exit is ours: no error status
    try {
      await t.close();
    } catch {
      /* already gone */
    } finally {
      s.stopping = false;
      if (s.transport === t) s.transport = undefined;
    }
    this.debug?.(`claude: relaunching ${s.id} for mode ${s.broker.getMode()}`);
  }

  private ensureTransport(s: Session): Promise<ClaudeTransport> {
    if (s.transport?.alive) return Promise.resolve(s.transport);
    if (!s.starting) {
      s.starting = this.launch(s).finally(() => {
        s.starting = undefined;
      });
    }
    return s.starting;
  }

  private async launch(s: Session): Promise<ClaudeTransport> {
    const file = await this.deps.claudePath();
    if (!file) throw new Error('Claude Code is not installed or could not be found. Open Settings > Agent apps and choose Install…, then Sign in… there.');
    const o = s.options;
    const launch: ClaudeLaunch = {
      mode: s.broker.getMode(),
      sessionId: s.id,
      resume: s.resumable,
      model: o.model,
      effort: o.reasoningEffort,
      ...(s.agent ? { agent: { name: s.agent.profile.id, json: agentsArg(s.agent) } } : {}),
      mcpConfig: mcpConfigOf(o.mcpServers, o.disabledMcpServers),
      ...(claudeDisallowedMcp(o.disabledMcpTools).length ? { disallowedMcpTools: claudeDisallowedMcp(o.disabledMcpTools) } : {}),
      settingsJson: claudeSettingsJson(o.folderSetup),
      ...(o.folderSetup?.rules?.allow.length ? { folderAllow: o.folderSetup.rules.allow } : {}),
      appendSystemPrompt: (this.deps.claudeMd ?? claudeMdPrompt)(s.cwd),
      ...(s.roots.length > 1 ? { addDirs: s.roots.filter((r) => r !== s.cwd) } : {}),
      ...(s.capUsd !== undefined ? { maxBudgetUsd: s.capUsd - s.spentUsd } : {}),
      ...(claudeNameOk(s.pendingName) ? { name: s.pendingName } : {}),
    };
    const handlers: TransportHandlers = {
      message: (m) => this.onMessage(s, m),
      control: (req) => this.onControl(s, req),
      exit: (info) => this.onExit(s, info),
    };
    const make = this.deps.makeTransport ?? cliTransportFactory;
    s.initSeen = false;
    s.mapper.reset();
    // spec 012 FR-159 (real, 2.1.304): a `-p` session is recorded as entrypoint `sdk-cli`, which `claude --resume`'s picker leaves out;
    // an entrypoint of our own keeps the user's own CLI able to list and open the sessions Durbar starts
    const env = { ...(this.deps.env ?? (() => process.env))(), CLAUDE_CODE_ENTRYPOINT: CLAUDE_ENTRYPOINT };
    const t = await make({ file, launch, cwd: s.cwd, env, handlers });
    s.transport = t;
    s.launchedMode = launch.mode;
    s.launchedName = t.kind === 'cli' ? launch.name : undefined; // the SDK transport ignores `name`: it stays pending
    s.launchedOff = new Set(o.disabledMcpServers ?? []);
    s.needsRelaunch = false;
    // Register the PreToolUse hook (Read-only roots check) before the first prompt.
    await t.request({ subtype: 'initialize', hooks: { PreToolUse: [{ matcher: '*', hookCallbackIds: [PRE_TOOL_USE_HOOK] }] } });
    s.resumable = true; // from now on Claude has (or will have) this id on disk
    if (s.remoteOn) {
      // spec 054 FR-062: a relaunch (new mode, model or MCP set) starts a new CLI process; turn Remote Control back on in it
      try {
        const r = (await t.request({ subtype: 'remote_control', enabled: true }, 60_000)) as { session_url?: unknown };
        const url = typeof r?.session_url === 'string' && allowedRemoteUrl(r.session_url, 'claude.ai') ? r.session_url : undefined;
        if (url && url !== s.remoteUrl) {
          s.remoteUrl = url;
          this.emit(s.id, { type: 'remote', on: true, url });
        }
      } catch (e) {
        s.remoteOn = false;
        this.emit(s.id, { type: 'remote', on: false, reason: `Claude could not turn remote control back on after a restart (${cleanRemoteError(e)})` });
      }
    }
    return t;
  }

  private onMessage(s: Session, m: ClaudeMessage): void {
    if (m.type === 'system' && m.subtype === 'init') s.initSeen = true;
    if (m.type === 'result') {
      s.turnOpen = false;
      // Spec 059 FR-007: the first turn after a launch with `--name` finished: the CLI stored the title, so report it
      if (s.launchedName) {
        const applied = s.launchedName;
        s.launchedName = undefined;
        if (s.pendingName === applied) s.pendingName = undefined;
        this.emit(s.id, { type: 'title', title: applied });
      }
    }
    if (s.planTurn && m.type === 'assistant') s.planDraft = ((s.planDraft ?? '') + assistantText(m)).slice(-40_000); // spec 066: bounded (the card shows 20k)
    if (m.type === 'result' && s.planTurn && !s.plans?.size) void this.leavePlanMode(s); // spec 066: a plan turn that ended without ExitPlanMode
    s.mapper.map(m);
    if (m.type === 'result' && this.capReached(s)) this.openLimit(s);
  }

  /** Mapper events of one session: the cost estimate counts towards the cap; Claude's own budget stop is the limit notice, not an error. */
  private onMapped(sid: string, b: EventBody): void {
    const s = this.sessions.get(sid);
    if (s && b.type === 'usage' && typeof b.costUsd === 'number' && b.costUsd > 0) s.spentUsd += b.costUsd;
    if (s && b.type === 'status' && b.status === 'error' && s.capUsd !== undefined && /budget/i.test(b.intent ?? '')) {
      this.openLimit(s);
      return;
    }
    if (s && b.type === 'mcp') {
      s.mcpAuthSeen?.clear(); // the CLI's own list (init) replaces the derived state
      s.lastMcp = b.servers as ReturnType<typeof claudeMcpServers>;
    }
    this.emit(sid, b);
    if (s && b.type === 'toolCall' && b.mcpAuth === true && b.mcpServer) {
      (s.mcpAuthSeen ??= new Set()).add(b.mcpServer);
      if (s.lastMcp) this.emit(sid, { type: 'mcp', servers: this.withAuthSeen(s, s.lastMcp) }); // at once, from the last known list: a slow or failed mcp_status still shows it
      void this.refreshMcp(s);
    }
  }

  /** FR-060: what the CLI reports, but a server it still calls `connected` after this session's challenge reads needs-auth. */
  private withAuthSeen(s: Session, list: ReturnType<typeof claudeMcpServers>): ReturnType<typeof claudeMcpServers> {
    if (!s.mcpAuthSeen?.size) return list;
    return list.map((x) => (s.mcpAuthSeen!.has(x.name) && x.status === 'connected' ? { ...x, status: 'needs-auth' as const, errorClass: 'auth' as const } : x));
  }

  /**
   * Spec 058 FR-176: a list the adapter asked for (`mcp_status`), not the CLI's own report: a server whose status differs from the last
   * list loses its sign-in mark (a real change), one that still reads the same keeps it; then the usual `mcp` event.
   */
  private reread(s: Session, list: ReturnType<typeof claudeMcpServers>): void {
    if (s.mcpAuthSeen?.size) {
      const before = new Map((s.lastMcp ?? []).map((x) => [x.name, x.status]));
      for (const x of list) if (s.mcpAuthSeen.has(x.name) && before.has(x.name) && before.get(x.name) !== x.status) s.mcpAuthSeen.delete(x.name);
    }
    s.lastMcp = list;
    this.emit(s.id, { type: 'mcp', servers: this.withAuthSeen(s, list) });
  }

  /** Spec 058 FR-060: a tool call showed an MCP sign-in challenge: ask the CLI for the server list once (not per failure while one is in flight). */
  private async refreshMcp(s: Session): Promise<void> {
    if (s.mcpRefreshing || !s.transport?.alive) return;
    s.mcpRefreshing = true;
    try {
      const r = await s.transport.request({ subtype: 'mcp_status' }, 15_000);
      this.reread(s, withSkipped(claudeMcpServers(r.mcpServers), s.mapper.skipped));
    } catch {
      /* the list comes with the next init */
    } finally {
      s.mcpRefreshing = false;
    }
  }

  private capReached(s: Session): boolean {
    return s.capUsd !== undefined && s.spentUsd >= s.capUsd - 1e-9;
  }

  /** FR-150: the cap was reached: one `limit exhausted` notice per stop, answered by `resolveLimit`. */
  private openLimit(s: Session): NonNullable<Session['limit']> {
    if (s.limit) return s.limit;
    s.limit = { requestId: randomUUID() };
    this.emit(s.id, { type: 'limit', phase: 'exhausted', requestId: s.limit.requestId, maxAiCredits: s.capUsd ?? null, usedAiCredits: Math.round(s.spentUsd * 1e4) / 1e4 });
    return s.limit;
  }

  /** Spec 030 FR-034: a hand-off summary from a forked one-shot of the user's `claude`; the session itself is not changed. */
  async handoffSummary(sessionId: string): Promise<HandoffResult> {
    const s = this.mustGet(sessionId);
    if (!s.resumable) return { summary: '' }; // nothing said yet: nothing to summarize
    const file = await this.deps.claudePath();
    if (!file) throw new Error('Claude Code is not installed or could not be found.');
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) throw new Error('A summary needs the native claude.exe, not a .cmd launcher.');
    const run = this.deps.runOnce ?? execRunOnce;
    const r = await run(file, handoffArgs({ sessionId: s.id, model: s.options.model }), { cwd: s.cwd, env: (this.deps.env ?? (() => process.env))(), timeoutMs: 180_000 });
    const out = parseHandoffOutput(r.stdout);
    if (out.costUsd) this.onMapped(s.id, { type: 'usage', costUsd: out.costUsd, costBasis: 'estimate' }); // counts towards the session's usage and its cap
    if (!out.summary && r.code !== 0) throw new Error(`Claude could not make a summary (exit ${r.code ?? 'timeout'}).`);
    return out;
  }

  /** Spec 040 FR-015: one prompt in an empty temp folder (the AI theme maker); no session is created or kept. */
  async generateText(prompt: string): Promise<{ text: string; costUsd?: number }> {
    const file = await this.deps.claudePath();
    if (!file) throw new Error('Claude Code is not installed or could not be found.');
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) throw new Error('This needs the native claude.exe, not a .cmd launcher.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gen-'));
    try {
      const r = await (this.deps.runOnce ?? execRunOnce)(file, oneShotArgs(prompt), { cwd: dir, env: (this.deps.env ?? (() => process.env))(), timeoutMs: 180_000 });
      const out = parseHandoffOutput(r.stdout);
      if (!out.summary) throw new Error(`Claude gave no answer (exit ${r.code ?? 'timeout'}).`);
      return { text: out.summary, ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Spec 030 FR-038: change the model (and effort) of this session from the next message. The CLI takes them per launch, so the
   * next message relaunches it with `--resume` and the new `--model`/`--effort`; a turn in progress finishes on the old model.
   */
  async setModel(sessionId: string, request: ModelSwitchRequest): Promise<ModelSwitchResult> {
    const s = this.mustGet(sessionId);
    const raw = typeof request.model === 'string' ? request.model.trim() : '';
    const toDefault = raw === 'auto' || raw === 'default';
    if (!toDefault && !claudeModelFlag(raw)) return { status: 'rejected', model: raw, message: `Claude Code does not take "${raw.slice(0, 40)}" as a model.` };
    if (typeof request.effort === 'string' && !CLAUDE_EFFORTS.has(request.effort)) return { status: 'rejected', model: raw, message: `Claude Code has no effort level "${request.effort.slice(0, 20)}".` };
    const previousModel = s.options.model;
    const previousEffort = s.options.reasoningEffort;
    const model = toDefault ? undefined : raw;
    const effort = request.effort === undefined ? previousEffort : request.effort === null ? undefined : request.effort;
    s.options = { ...s.options, model, reasoningEffort: effort as typeof s.options.reasoningEffort }; // checked against CLAUDE_EFFORTS above
    s.needsRelaunch = true; // the next message relaunches with --resume and the new flags; nothing is sent now
    this.emit(sessionId, { type: 'model', cause: 'user', model: model ?? 'auto', ...(previousModel ? { previousModel } : {}), ...(effort ? { effort } : {}), ...(previousEffort ? { previousEffort } : {}) });
    return { status: 'applied', model: model ?? 'auto', message: 'Applies from the next message.' };
  }

  /**
   * Spec 054 FR-061: turn Remote Control on or off for this session over the running CLI (`remote_control` control request).
   * The link is `session_url` when it is on claude.ai; main checks it again and never lets the window open another host.
   */
  async setRemote(sessionId: string, on: boolean): Promise<RemoteState> {
    const s = this.mustGet(sessionId);
    if (!s.transport?.alive) {
      // no CLI process: nothing is steerable, so "off" is already true; "on" needs a running session
      if (!on) { s.remoteOn = false; s.remoteUrl = undefined; return { ok: true, on: false }; }
      return { ok: false, error: 'Send a message first so the session is running, then turn on remote control.' };
    }
    try {
      const r = (await s.transport.request({ subtype: 'remote_control', enabled: on }, 60_000)) as { session_url?: unknown };
      s.remoteOn = on;
      if (!on) { s.remoteUrl = undefined; return { ok: true, on: false }; }
      const url = typeof r?.session_url === 'string' && allowedRemoteUrl(r.session_url, 'claude.ai') ? r.session_url : undefined;
      s.remoteUrl = url;
      return { ok: true, on: true, steerable: true, ...(url ? { url } : {}) };
    } catch (e) {
      return { ok: false, error: cleanRemoteError(e) };
    }
  }

  /** FR-150: change (null = remove) the dollar cap; the running CLI gets the new budget with the next message. */
  async setCap(sessionId: string, usd: number | null): Promise<void> {
    const s = this.mustGet(sessionId);
    if (usd !== null && usdCap(usd) === undefined) throw new Error('Invalid cost cap.');
    s.capUsd = usd === null ? undefined : usdCap(usd);
    s.needsRelaunch = true;
    this.emit(sessionId, { type: 'limit', phase: 'changed', maxAiCredits: s.capUsd ?? null });
    if (s.limit && !this.capReached(s)) this.releaseLimit(s, usd === null ? 'unset' : 'set');
  }

  /** FR-150: the user's answer to the limit notice: add to the cap, set a new one, remove it, or drop the held message. */
  async resolveLimit(sessionId: string, requestId: string, action: LimitAction): Promise<void> {
    const s = this.mustGet(sessionId);
    if (!s.limit || s.limit.requestId !== requestId) return;
    if (action.kind !== 'cancel') {
      // `add` gives that much more from here: a turn can overshoot the cap (a first turn's cache write, real: $0.06 on a $0.01 cap), so it counts from the higher of cap and spend, rounded up to the cent
      const next = action.kind === 'add' ? usdCap(Math.ceil((Math.max(s.capUsd ?? 0, s.spentUsd) + action.credits) * 100 - 1e-6) / 100) : action.kind === 'set' ? usdCap(action.credits) : undefined;
      if (action.kind !== 'unset' && next === undefined) throw new Error('Invalid cost cap.');
      s.capUsd = next;
      s.needsRelaunch = true;
      this.emit(sessionId, { type: 'limit', phase: 'changed', maxAiCredits: s.capUsd ?? null });
    }
    this.releaseLimit(s, action.kind);
  }

  private releaseLimit(s: Session, action: LimitAction['kind']): void {
    const l = s.limit;
    if (!l) return;
    s.limit = undefined;
    this.emit(s.id, { type: 'limit', phase: 'resolved', requestId: l.requestId, action });
    if (action === 'cancel' || !l.held) {
      this.emit(s.id, { type: 'status', status: 'idle', intent: action === 'cancel' ? 'Stopped at the cost cap' : 'Ready' });
      return;
    }
    void this.send(s.id, l.held);
  }

  private async onControl(s: Session, req: IncomingControl): Promise<ControlAnswer> {
    const r = req.request;
    if (req.subtype === 'can_use_tool') {
      const tool = typeof r.tool_name === 'string' ? r.tool_name : '';
      const input = r.input && typeof r.input === 'object' && !Array.isArray(r.input) ? (r.input as Record<string, unknown>) : {};
      const toolUseID = typeof r.tool_use_id === 'string' ? r.tool_use_id : undefined;
      if (tool === 'ToolSearch' && s.planTurn) return { response: { behavior: 'allow', updatedInput: input, ...(toolUseID ? { toolUseID } : {}) } }; // spec 066: loads definitions only
      if (tool === 'ExitPlanMode' && s.planTurn) {
        // spec 066 FR-004: Claude's proposed plan goes to the plan card; approve continues in the folder's own mode
        const requestId = `claude-plan-${toolUseID ?? randomUUID()}`.slice(0, 200);
        s.plans ??= new Map();
        const answer = await new Promise<PlanAnswer>((resolve) => {
          s.plans!.set(requestId, resolve);
          // real 2026-10-21 (Claude Code 2.1.305): ExitPlanMode's input is empty (the plan lives in Claude's plan file, which Read-only
          // rightly blocks); the plan is then the text Claude wrote in this turn
          this.emit(s.id, { type: 'plan', phase: 'proposed', requestId, text: cleanPlanText(input.plan) || cleanPlanText(s.planDraft) });
        });
        s.plans.delete(requestId);
        this.emit(s.id, { type: 'plan', phase: 'resolved', requestId, action: answer.kind });
        if (answer.kind === 'revise') return { response: { behavior: 'deny', message: reviseText(answer), ...(toolUseID ? { toolUseID } : {}) } };
        await this.leavePlanMode(s);
        if (answer.kind === 'approve') return { response: { behavior: 'allow', updatedInput: input, ...(toolUseID ? { toolUseID } : {}) } };
        return { response: { behavior: 'deny', message: PLAN_REJECTED, ...(toolUseID ? { toolUseID } : {}) } };
      }
      if (tool === 'AskUserQuestion') {
        // FR-129 fallback: the hook normally answers first; if Claude still asks for permission, ask the user here
        if (input.answers && typeof input.answers === 'object') return { response: { behavior: 'allow', updatedInput: input, ...(toolUseID ? { toolUseID } : {}) } };
        const h = (await this.askUser(s, input, toolUseID)) as { hookSpecificOutput?: { permissionDecision?: string; updatedInput?: Record<string, unknown> } };
        const out = h.hookSpecificOutput;
        if (out?.permissionDecision === 'allow') return { response: { behavior: 'allow', updatedInput: out.updatedInput ?? input, ...(toolUseID ? { toolUseID } : {}) } };
        return { response: { behavior: 'deny', message: out ? 'The user skipped the question.' : ASK_USER_DENY, ...(toolUseID ? { toolUseID } : {}) } };
      }
      const d = await s.broker.request(permissionLikeOf(tool, input, toolUseID));
      return d.kind === 'approve-once'
        ? { response: { behavior: 'allow', updatedInput: input, ...(toolUseID ? { toolUseID } : {}) } }
        : { response: { behavior: 'deny', message: d.feedback, ...(toolUseID ? { toolUseID } : {}) } };
    }
    if (req.subtype === 'hook_callback') {
      if (r.callback_id !== PRE_TOOL_USE_HOOK) return { response: {} };
      const input = r.input && typeof r.input === 'object' ? (r.input as Record<string, unknown>) : {};
      const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
      const toolInput = input.tool_input && typeof input.tool_input === 'object' ? (input.tool_input as Record<string, unknown>) : undefined;
      const decision = await this.hookDecision(s, tool, toolInput, typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined);
      // spec 065 FR-001: the hook runs before every tool in every mode; a write the hook does not deny gets its copy kept first
      const denied = (decision as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === 'deny';
      if (!denied && toolKind(tool) === 'write' && this.writeGuard) {
        const like = permissionLikeOf(tool, toolInput);
        if (like.path) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([this.writeGuard(s.id, [like.path]).catch(() => undefined), new Promise<void>((res) => { timer = setTimeout(res, 2000); })]);
          if (timer) clearTimeout(timer);
        }
      }
      return { response: decision };
    }
    // FR-151: an MCP server's elicitation (a form or a URL flow) goes to the question card; the answer is the MCP `{action, content?}`.
    // The field names follow the Agent SDK's control request (read:, not yet seen from a real CLI).
    if (req.subtype === 'elicitation') {
      s.elicitations ??= new Map();
      const id = typeof r.elicitation_id === 'string' && r.elicitation_id.length <= 200 ? `claude-e-${r.elicitation_id}` : `claude-e-${randomUUID()}`;
      const a = await runElicitation((b) => this.emit(s.id, b), s.elicitations, id, { message: r.message, schema: r.requested_schema, mode: r.mode, url: r.url, source: r.mcp_server_name }, (m) => this.debug?.(`claude: ${m}`));
      return { response: { ...a } };
    }
    // mcp_message, ... are not supported yet (T052, FR-024): refuse explicitly
    return { error: `Agent Durbar does not handle ${req.subtype || 'this request'} yet.` };
  }

  /**
   * The `PreToolUse` answer with the launched and the current mode (FR-115). The CLI enforces its launch flags; this hook
   * makes sure the user's current choice is never looser: Read-only (current or launched) gets the Read-only decision, and a
   * process launched in Allow all (`bypassPermissions`, which never calls `canUseTool`) asks through the broker in Ask first.
   */
  private async hookDecision(s: Session, tool: string, toolInput: Record<string, unknown> | undefined, toolUseID: string | undefined): Promise<Record<string, unknown>> {
    if (tool === 'AskUserQuestion') return this.askUser(s, toolInput ?? {}, toolUseID); // FR-129: a question, not an action: every mode
    // spec 066: in a plan-first turn only the plan proposal passes (to the plan card, through can_use_tool), plus ToolSearch,
    // which only loads tool definitions (real 2026-10-21: Claude Code 2.1.305 defers ExitPlanMode behind ToolSearch)
    if (s.planTurn && PLAN_TOOLS.has(tool)) return {};
    const current = s.broker.getMode();
    const launched = s.launchedMode ?? current;
    if (current === 'read-only' || launched === 'read-only') {
      const deny = preToolUseDecision('read-only', tool, toolInput, s.roots, undefined, s.options.folderSetup?.rules?.allow);
      if (!deny) return {};
      if (current !== 'read-only') deny.hookSpecificOutput.permissionDecisionReason += ' The new permission mode applies from your next message.';
      return { ...deny };
    }
    if (launched === 'allow' && current === 'ask') {
      if (tool === 'AskUserQuestion') return {};
      const d = await s.broker.request(permissionLikeOf(tool, toolInput ?? {}, toolUseID));
      if (d.kind === 'approve-once') return {};
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.feedback ?? 'Denied by user in Agent Durbar.' } };
    }
    return {};
  }

  /**
   * FR-129: show the agent's questions and wait for the user. The answer goes back as `updatedInput.answers`, keyed by Claude's
   * own question texts; a skip is a deny. Input without a usable question gets no opinion (Claude's own handling).
   */
  private async askUser(s: Session, input: Record<string, unknown>, toolUseID: string | undefined): Promise<Record<string, unknown>> {
    if (input.answers && typeof input.answers === 'object') return {}; // already answered (a second check of the same call)
    const { asked, originals } = parseQuestionsWithOriginals(input);
    if (!asked.length) return {};
    const requestId = toolUseID ?? randomUUID();
    s.questions ??= new Map();
    const answer = await new Promise<Record<string, string> | null>((resolve) => {
      s.questions!.set(requestId, { asked, originals, resolve });
      this.emit(s.id, { type: 'question', phase: 'asked', requestId, questions: asked });
      this.emit(s.id, { type: 'status', status: 'needs-permission', intent: 'Waiting for your answer' });
    });
    s.questions.delete(requestId);
    const clean = answer ? cleanAnswers(asked, answer) : undefined;
    if (!clean) {
      this.emit(s.id, { type: 'question', phase: 'cancelled', requestId });
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The user skipped the question. Decide yourself, or ask in your reply.' } };
    }
    const byOriginal: Record<string, string> = {};
    asked.forEach((q, i) => {
      if (clean[q.question] !== undefined) byOriginal[originals[i] ?? q.question] = clean[q.question];
    });
    this.emit(s.id, { type: 'question', phase: 'answered', requestId, answers: clean });
    this.emit(s.id, { type: 'status', status: 'working', intent: 'Answered' });
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Answered by the user in Agent Durbar.', updatedInput: { ...input, answers: byOriginal } } };
  }

  /** Stop, interrupt or a crash: unanswered questions are skipped (the hook answers deny). */
  private cancelQuestions(s: Session): void {
    for (const q of [...(s.questions?.values() ?? [])]) q.resolve(null);
    for (const p of [...(s.plans?.values() ?? [])]) p({ kind: 'reject' }); // spec 066: Stop / End reject an open plan
    cancelElicitations(s.elicitations);
  }

  private onExit(s: Session, info: { code: number | null; signal: string | null; stderrTail: string }): void {
    s.transport = undefined;
    s.turnOpen = false;
    if (s.stopping || !this.sessions.has(s.id)) return;
    if (info.stderrTail) this.debug?.(`claude stderr (exit ${String(info.code)}): ${info.stderrTail}`);
    s.broker.denyPending();
    this.cancelQuestions(s);
    // FR-157: Claude ended because its sign-in failed; the stderr text itself is never shown (only this sentence)
    if (isAuthError(info.stderrTail)) return this.emit(s.id, { type: 'status', status: 'error', intent: 'Claude Code could not authenticate: its sign-in is missing or has expired.', errorKind: 'auth' });
    this.emit(s.id, { type: 'status', status: 'error', intent: info.code === 0 ? 'Claude ended the session; send a message to continue.' : `Claude stopped unexpectedly (exit ${info.code ?? info.signal ?? '?'}). Send a message to resume.` });
  }

  private onBroker(sid: string, e: BrokerEvent): void {
    switch (e.type) {
      case 'pending':
        return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Waiting for permission: ${e.permission.summary}`, permission: e.permission });
      case 'denied-policy':
        return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Denied (read-only mode): ${e.permission.summary}`, permission: e.permission });
      case 'resolved':
        this.emit(sid, { type: 'permission', permission: e.permission });
        if (e.permission.via !== 'stopped') {
          const word = e.permission.state === 'approved' ? (e.permission.via === 'session' ? 'Allowed for this session' : 'Allowed') : 'Denied';
          this.emit(sid, { type: 'status', status: 'working', intent: `${word}: ${e.permission.summary}` });
        }
        return;
      case 'auto': // Allow all approved it: a permission event for the activity log; the window shows no card (spec 052 FR-071)
        return this.emit(sid, { type: 'permission', permission: e.permission });
      case 'grants':
        return this.emit(sid, { type: 'grants', grants: e.grants });
    }
  }

  private emit(sessionId: string, body: EventBody): void {
    const event = { ...markAuthError(body), sessionId, timestamp: Date.now() } as AgentEvent; // FR-157: a sign-in failure is marked
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a listener bug must not break the session */
      }
    }
  }
}

/** The descriptor; `makeTransport` chooses the transport (main passes the SDK one when it is chosen and available, FR-113/FR-114). */
export function claudeDescriptor(makeTransport: TransportFactory = cliTransportFactory, sdkTransport = false): AdapterDescriptor {
  return {
    id: CLAUDE_ID,
    displayName: CLAUDE_NAME,
    installHint: 'Open Settings > Agent apps and choose Install…, then Sign in… (or run `npm install -g @anthropic-ai/claude-code`, then `claude auth login`).',
    capabilities: sdkTransport ? CLAUDE_SDK_CAPABILITIES : CLAUDE_CAPABILITIES,
    create: () => new ClaudeAdapter({ claudePath: claudeBinaryPath, makeTransport, sdkTransport }),
  };
}
export const CLAUDE_DESCRIPTOR: AdapterDescriptor = claudeDescriptor();

/** The installed `claude` found by `detect()` (cached for the app's life once found). */
let cachedPath: string | undefined;
export async function claudeBinaryPath(): Promise<string | undefined> {
  if (cachedPath) return cachedPath;
  const { detectBinary, CLAUDE_BINARY, nodeExec, nodeDetectEnv } = await import('./detect');
  const r = await detectBinary(CLAUDE_BINARY, nodeDetectEnv(), nodeExec);
  if (r.state === 'ready' && r.path) cachedPath = r.path;
  return cachedPath;
}
