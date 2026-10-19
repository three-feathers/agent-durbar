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
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeMapper, claudeMcpServers } from './claudeMap';
import type { ClaudeMessage } from './claudeMap';
import { claudeOptionsFor, parseMcpTool, preToolUseDecision, toolKind } from './claudeModes';
import { createCliTransport } from './claudeTransport';
import type { ClaudeTransport, ControlAnswer, IncomingControl, TransportHandlers, UserContent } from './claudeTransport';
import type { AdapterCapabilities, AdapterDescriptor, PermissionMode } from './capabilities';
import type { EventBody } from './map';
import { PermissionBroker, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import type { AgentAdapter, AgentEvent, AgentMessage, McpServerSpec, StartOptions, Unsubscribe } from './types';
import type { ModelOption } from '../shared/modelswitch';
import { resolveWorkspaceCwd } from './workspace';
import { listClaudeSessions, readClaudeHistory } from './claudeHistory';
import type { HistoryResult, PreviousSession } from './history';
import { cleanAnswers, parseQuestionsWithOriginals } from './questions';
import { agentsArg, listClaudeAgents } from './claudeAgents';
import type { ClaudeAgentDef } from './claudeAgents';
import type { AgentProfile, AskedQuestion } from './types';

export const CLAUDE_ID = 'claude';
export const CLAUDE_NAME = 'Claude Code';

export const CLAUDE_CAPABILITIES: AdapterCapabilities = Object.freeze({
  interrupt: true,
  resume: true,
  images: true,
  models: true, // FR-118: from the CLI's initialize reply, no prompt
  effort: true,
  permissionModes: Object.freeze(['read-only', 'ask', 'allow'] as PermissionMode[]),
  permModeSwitch: 'live', // FR-115/FR-116: the broker and the hook at once, the CLI flags from the next message
  usage: Object.freeze({ tokens: true, costUsd: true, nanoAiu: false }),
  context: false,
  caps: false, // Q7 / T081
  helpers: true,
  history: true, // FR-125/FR-126: read-only from Claude's own session files
  mcpStatus: true,
  mcpToggle: true, // FR-133: mcp_toggle + mcp_status
}) as AdapterCapabilities;

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

/** Durbar's MCP servers as the CLI's `--mcp-config` JSON (`disabled` names left out). Never logged: env and headers may hold secrets. */
export function mcpConfigOf(servers: Record<string, McpServerSpec> | undefined, disabled: readonly string[] = []): string | undefined {
  if (!servers) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || disabled.includes(name)) continue;
    if (spec.type === 'stdio' && spec.command) out[name] = { type: 'stdio', command: spec.command, args: spec.args ?? [], ...(spec.env ? { env: spec.env } : {}) };
    else if ((spec.type === 'http' || spec.type === 'sse') && spec.url) out[name] = { type: spec.type, url: spec.url, ...(spec.headers ? { headers: spec.headers } : {}) };
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
  /** `--mcp-config` JSON (`{"mcpServers": {...}}`); never logged. */
  mcpConfig?: string;
  appendSystemPrompt?: string;
}

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
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

/** The CLI argv (FR-111). Mode flags come from `claudeOptionsFor`, so an unknown mode gets Read-only. */
export function claudeArgs(i: ClaudeLaunch): string[] {
  const o = claudeOptionsFor(i.mode);
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--include-partial-messages'];
  a.push('--permission-mode', o.permissionMode);
  if (o.allowDangerouslySkipPermissions) a.push('--allow-dangerously-skip-permissions');
  if (o.allowedTools?.length) a.push('--allowedTools', o.allowedTools.join(','));
  if (o.disallowedTools?.length) a.push('--disallowedTools', o.disallowedTools.join(','));
  a.push('--setting-sources', o.settingSources.join(','));
  if (o.strictMcpConfig) a.push('--strict-mcp-config');
  if (i.mcpConfig) a.push('--mcp-config', i.mcpConfig);
  if (claudeModelFlag(i.model)) a.push('--model', i.model as string);
  if (i.effort && CLAUDE_EFFORTS.has(i.effort)) a.push('--effort', i.effort);
  if (i.appendSystemPrompt) a.push('--append-system-prompt', i.appendSystemPrompt);
  if (i.agent && /^[A-Za-z0-9._-]{1,64}$/.test(i.agent.name)) a.push('--agents', i.agent.json, '--agent', i.agent.name);
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
export const cliTransportFactory: TransportFactory = (o) => createCliTransport({ file: o.file, args: claudeArgs(o.launch), cwd: o.cwd, env: o.env, handlers: o.handlers });

export interface ClaudeAdapterDeps {
  /** Absolute path of `claude` (from detect); resolved lazily at the first start of a CLI. */
  claudePath: () => Promise<string | undefined>;
  /** Makes a transport (tests inject a fake; default: the CLI transport; the SDK transport when chosen, FR-113). */
  makeTransport?: TransportFactory;
  sessionExists?: (id: string) => boolean;
  claudeMd?: (folder: string) => string | undefined;
  readImage?: (p: string) => Buffer | undefined;
  env?: () => NodeJS.ProcessEnv;
  /** Claude's config folder (tests); default `CLAUDE_CONFIG_DIR` or `~/.claude`. */
  configDir?: string;
}

interface Session {
  id: string;
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
  /** MCP servers left out of the running CLI's config at launch (FR-133): turning one on needs a relaunch. */
  launchedOff?: Set<string>;
  needsRelaunch?: boolean;
  /** spec 043 FR-008: the selected custom agent (passed on every launch). */
  agent?: ClaudeAgentDef;
  /** Questions waiting for the user (FR-128): request id -> what was asked, Claude's original texts, and the waiter. */
  questions?: Map<string, { asked: AskedQuestion[]; originals: string[]; resolve: (a: Record<string, string> | null) => void }>;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = CLAUDE_ID;
  readonly displayName = CLAUDE_NAME;
  readonly capabilities = CLAUDE_CAPABILITIES;
  debug?: (message: string) => void;
  private sessions = new Map<string, Session>();
  private listeners = new Set<(event: AgentEvent) => void>();

  constructor(private readonly deps: ClaudeAdapterDeps) {}

  onEvent(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private modelCache?: { at: number; list: Promise<ModelOption[]> };

  /**
   * FR-118: the models the user's `claude` offers, from its `initialize` reply. A short-lived CLI in Read-only in the temp
   * folder; no prompt is written, so no tokens are spent. Cached 10 minutes; any failure is an empty list.
   */
  listModelOptions(): Promise<ModelOption[]> {
    const now = Date.now();
    if (this.modelCache && now - this.modelCache.at < 10 * 60_000) return this.modelCache.list;
    const list = this.probeModels().catch((e) => {
      this.debug?.(`claude: model list failed: ${e instanceof Error ? e.message : String(e)}`);
      this.modelCache = undefined; // try again next time
      return [] as ModelOption[];
    });
    this.modelCache = { at: now, list };
    return list;
  }

  private async probeModels(): Promise<ModelOption[]> {
    const file = await this.deps.claudePath();
    if (!file) return [];
    const make = this.deps.makeTransport ?? cliTransportFactory;
    const t = await make({
      file,
      launch: { mode: 'read-only', sessionId: randomUUID(), resume: false },
      cwd: os.tmpdir(),
      env: (this.deps.env ?? (() => process.env))(),
      handlers: { message: () => undefined, control: async () => ({ error: 'not handled in the model probe' }), exit: () => undefined },
    });
    try {
      const r = await t.request({ subtype: 'initialize' }, 20_000);
      return claudeModelOptions(r.models);
    } finally {
      await t.close().catch(() => undefined);
    }
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
    const broker = new PermissionBroker({ roots, mode, emit: (e) => this.onBroker(id, e) });
    const mapper = new ClaudeMapper((b) => this.emit(id, b), { quiet: true, onDropped: (why) => this.debug?.(`claude: dropped ${why}`) });
    this.sessions.set(id, { id, cwd: ws.cwd, roots, options: { ...options, permissionMode: mode }, broker, mapper, resumable });
    if (!options.quiet) this.emit(id, { type: 'status', status: 'idle', intent: `Ready in ${ws.cwd}` });
    return id;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    const s = this.mustGet(sessionId);
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
    s.turnOpen = true;
    t.sendUser(userContentOf(message, this.deps.readImage));
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
    try {
      const r = await s.transport.request({ subtype: 'mcp_status' }, 15_000);
      this.emit(s.id, { type: 'mcp', servers: claudeMcpServers(r.mcpServers) });
    } catch {
      /* the toggle worked; the list comes with the next init */
    }
  }

  /** FR-128: the user's answers (question text -> label(s)), or null when they skipped. */
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string> | null): void {
    const q = this.sessions.get(sessionId)?.questions?.get(requestId);
    q?.resolve(answers);
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
    if (!file) throw new Error('Claude Code is not installed or could not be found. Install it, sign in with `claude` in a terminal, then restart Durbar.');
    const o = s.options;
    const launch: ClaudeLaunch = {
      mode: s.broker.getMode(),
      sessionId: s.id,
      resume: s.resumable,
      model: o.model,
      effort: o.reasoningEffort,
      ...(s.agent ? { agent: { name: s.agent.profile.id, json: agentsArg(s.agent) } } : {}),
      mcpConfig: mcpConfigOf(o.mcpServers, o.disabledMcpServers),
      appendSystemPrompt: (this.deps.claudeMd ?? claudeMdPrompt)(s.cwd),
    };
    const handlers: TransportHandlers = {
      message: (m) => this.onMessage(s, m),
      control: (req) => this.onControl(s, req),
      exit: (info) => this.onExit(s, info),
    };
    const make = this.deps.makeTransport ?? cliTransportFactory;
    s.initSeen = false;
    s.mapper.reset();
    const t = await make({ file, launch, cwd: s.cwd, env: (this.deps.env ?? (() => process.env))(), handlers });
    s.transport = t;
    s.launchedMode = launch.mode;
    s.launchedOff = new Set(o.disabledMcpServers ?? []);
    s.needsRelaunch = false;
    // Register the PreToolUse hook (Read-only roots check) before the first prompt.
    await t.request({ subtype: 'initialize', hooks: { PreToolUse: [{ matcher: '*', hookCallbackIds: [PRE_TOOL_USE_HOOK] }] } });
    s.resumable = true; // from now on Claude has (or will have) this id on disk
    return t;
  }

  private onMessage(s: Session, m: ClaudeMessage): void {
    if (m.type === 'system' && m.subtype === 'init') s.initSeen = true;
    if (m.type === 'result') s.turnOpen = false;
    s.mapper.map(m);
  }

  private async onControl(s: Session, req: IncomingControl): Promise<ControlAnswer> {
    const r = req.request;
    if (req.subtype === 'can_use_tool') {
      const tool = typeof r.tool_name === 'string' ? r.tool_name : '';
      const input = r.input && typeof r.input === 'object' && !Array.isArray(r.input) ? (r.input as Record<string, unknown>) : {};
      const toolUseID = typeof r.tool_use_id === 'string' ? r.tool_use_id : undefined;
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
      return { response: await this.hookDecision(s, tool, toolInput, typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined) };
    }
    // elicitation, mcp_message, ... are not supported yet (T052, FR-024): refuse explicitly
    return { error: `Agent Durbar does not handle ${req.subtype || 'this request'} yet.` };
  }

  /**
   * The `PreToolUse` answer with the launched and the current mode (FR-115). The CLI enforces its launch flags; this hook
   * makes sure the user's current choice is never looser: Read-only (current or launched) gets the Read-only decision, and a
   * process launched in Allow all (`bypassPermissions`, which never calls `canUseTool`) asks through the broker in Ask first.
   */
  private async hookDecision(s: Session, tool: string, toolInput: Record<string, unknown> | undefined, toolUseID: string | undefined): Promise<Record<string, unknown>> {
    if (tool === 'AskUserQuestion') return this.askUser(s, toolInput ?? {}, toolUseID); // FR-129: a question, not an action: every mode
    const current = s.broker.getMode();
    const launched = s.launchedMode ?? current;
    if (current === 'read-only' || launched === 'read-only') {
      const deny = preToolUseDecision('read-only', tool, toolInput, s.roots);
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
  }

  private onExit(s: Session, info: { code: number | null; signal: string | null; stderrTail: string }): void {
    s.transport = undefined;
    s.turnOpen = false;
    if (s.stopping || !this.sessions.has(s.id)) return;
    if (info.stderrTail) this.debug?.(`claude stderr (exit ${String(info.code)}): ${info.stderrTail}`);
    s.broker.denyPending();
    this.cancelQuestions(s);
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
          const word = e.permission.state === 'approved' ? (e.permission.via === 'session' ? 'Allowed for this session' : 'Approved') : 'Denied';
          this.emit(sid, { type: 'status', status: 'working', intent: `${word}: ${e.permission.summary}` });
        }
        return;
      case 'grants':
        return this.emit(sid, { type: 'grants', grants: e.grants });
    }
  }

  private emit(sessionId: string, body: EventBody): void {
    const event = { ...body, sessionId, timestamp: Date.now() } as AgentEvent;
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
export function claudeDescriptor(makeTransport: TransportFactory = cliTransportFactory): AdapterDescriptor {
  return {
    id: CLAUDE_ID,
    displayName: CLAUDE_NAME,
    installHint: 'Install Claude Code (npm install -g @anthropic-ai/claude-code), sign in with `claude` in a terminal, then restart Durbar.',
    capabilities: CLAUDE_CAPABILITIES,
    create: () => new ClaudeAdapter({ claudePath: claudeBinaryPath, makeTransport }),
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
