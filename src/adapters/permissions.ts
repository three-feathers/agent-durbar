/**
 * Permission broker: decides what happens to each permission request of one session.
 * Pure TypeScript (no SDK import), so it can be unit-tested without a Copilot session or credits.
 *
 * Policy: reads are approved; `allow` approves everything; `ask` leaves non-read requests pending
 * until `resolve` is called, optionally remembering the approval for the rest of the session
 * ("Approve for this session") as a revocable grant; otherwise (read-only) writes etc. are denied.
 * Reads outside the session's roots (spec 003 FR-023) are not free: asked in Ask mode, denied in Read-only.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionInfo, SessionGrant, StartOptions } from './types';

/** The subset of the SDK's PermissionRequest the broker reads (all optional strings besides kind). */
export interface PermissionLike {
  kind: string;
  toolCallId?: string;
  fileName?: string;
  fullCommandText?: string;
  url?: string;
  toolName?: string;
  /** MCP requests: the server that hosts the tool. */
  serverName?: string;
  path?: string;
  /** Spec 052 FR-063: the change an edit would make (unified diff text), shown on the pending card only. */
  diff?: string;
  /** Spec 065: every file a write changes (Codex file changes name several); `fileName`/`path` otherwise. */
  paths?: string[];
  /**
   * Spec 052 FR-172: the adapter's own card line, used instead of the one built here (Codex: the change's kind, "+N more", or
   * "Codex did not say which file"). Only the card text: the grant scope is still built from the fields above.
   */
  cardSummary?: string;
  /** Spec 087 FR-021: the card's own line about the OS sandbox (see `PermissionInfo.sandboxNote`). */
  sandboxNote?: string;
}

export type Decision = { kind: 'approve-once' } | { kind: 'reject'; feedback: string };

/** Short human summary of a permission request (for the needs-permission card). */
export function summarize(req: PermissionLike): string {
  if (typeof req.cardSummary === 'string' && req.cardSummary.trim()) return req.cardSummary.replace(/[\r\n]+/g, ' ').trim().slice(0, 2000);
  switch (req.kind) {
    case 'write':
      return `write ${req.fileName ?? ''}`.trim();
    case 'shell':
      return `run ${req.fullCommandText ?? ''}`.trim();
    case 'read':
      return `read ${req.path ?? ''}`.trim();
    case 'url':
      return `fetch ${req.url ?? ''}`.trim();
    case 'mcp':
      return `mcp ${req.serverName ? req.serverName + ' › ' : ''}${req.toolName ?? ''}`.trim();
    case 'custom-tool':
      return `${req.kind} ${req.toolName ?? ''}`.trim();
    default:
      return String(req.kind);
  }
}

const SHELL_META = /[;&|`$<>\n\r(){}\\]/;

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || p;
}

/** Commands whose arguments are code or privilege: never offered an "any arguments" grant (spec 003 FR-022). */
const NO_BROAD_GRANT = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd', 'node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3', 'ruby', 'perl', 'php', 'lua', 'sudo', 'su', 'doas', 'env', 'xargs', 'eval', 'exec', 'find', 'nohup', 'time', 'watch']);

export interface GrantScope {
  key: string;
  label: string;
  /**
   * Write only, when the request writes in more than one folder (review on #470): the `write:<folder>` key of each. A session grant
   * matches only when every one of them is granted, and approving "for this session" grants each folder (the label names them all).
   */
  folders?: { key: string; label: string }[];
  /** Shell only: the wider "any arguments of <command>" scope. Offered for simple commands of ordinary programs; never the default. */
  broad?: { key: string; label: string };
}

const shortCmd = (cmd: string, n = 28): string => (cmd.length > n ? cmd.slice(0, n - 1) + '…' : cmd);

/**
 * What "Approve for this session" remembers for a request: a key (what the grant matches) and a
 * short label for the chip. Deliberately narrow:
 *  - write: the folder of the file (all writes in that folder)
 *  - shell: **the exact command text** by default. Only when the user explicitly picks the `broad` scope
 *    ("any arguments") is the command name remembered, and `broad` exists only for simple commands (no pipes, `;`, `&&`,
 *    redirects, substitutions, newlines) of programs that are not shells, interpreters or privilege tools.
 *  - read (outside the roots): the folder of the path
 *  - url: the host; mcp / custom tools: the tool name; anything else: the kind.
 * `flavor` is injectable so tests can use Windows paths on any host (spec 003 FR-031).
 */
export function grantScope(req: PermissionLike, flavor: Pick<typeof path, 'dirname'> & { sep?: string } = path): GrantScope {
  // spec 003 T028: on Windows one folder has one key, whatever the case and the separators (`C:/Repo` = `c:\repo`); the label keeps the spelling
  const keyDir = (dir: string): string => (flavor.sep === '\\' ? dir.replace(/\//g, '\\').toLowerCase() : dir);
  switch (req.kind) {
    case 'write': {
      // every file the write changes, not only the first (review on #470: a grant on the first file's folder approved them all)
      const files = [...new Set([req.fileName, ...(req.paths ?? [])].filter((p): p is string => typeof p === 'string' && !!p))];
      const byKey = new Map<string, { key: string; label: string }>();
      for (const f of files) {
        const dir = flavor.dirname(f);
        const key = `write:${keyDir(dir)}`;
        if (!byKey.has(key)) byKey.set(key, { key, label: `write in ${baseName(dir)}/` });
      }
      const folders = [...byKey.values()];
      if (folders.length === 0) return { key: 'write:', label: 'write' };
      if (folders.length === 1) return folders[0];
      const names = folders.map((x) => x.label.replace(/^write in /, ''));
      const label = `write in ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more folders` : ''}`;
      return { key: `write-folders:${folders.map((x) => x.key).sort().join('\n')}`, label, folders };
    }
    case 'read': {
      const f = req.path ?? '';
      const dir = f ? flavor.dirname(f) : '';
      return { key: `read:${keyDir(dir)}`, label: dir ? `read in ${baseName(dir)}/` : 'read' };
    }
    case 'shell': {
      const cmd = (req.fullCommandText ?? '').trim();
      if (!cmd) return { key: 'shell-exact:', label: 'run commands' };
      const exact = { key: `shell-exact:${cmd}`, label: `run ${shortCmd(cmd)}` };
      if (SHELL_META.test(cmd)) return exact;
      const first = cmd.split(/\s+/)[0];
      const name = first.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
      if (!/^[A-Za-z0-9._-]+$/.test(first) || NO_BROAD_GRANT.has(name)) return exact;
      return { ...exact, broad: { key: `shell:${first}`, label: `run ${first} (any arguments)` } };
    }
    case 'url': {
      let host = req.url ?? '';
      try {
        host = new URL(host).host || host;
      } catch {
        /* keep raw */
      }
      return { key: `url:${host}`, label: `fetch ${host}` };
    }
    case 'mcp': {
      // Scoped to the server too: the same tool name on two servers is two different things.
      const tool = req.toolName ?? '';
      return { key: req.serverName ? `mcp:${req.serverName}/${tool}` : `mcp:${tool}`, label: req.serverName ? `${req.serverName} › ${tool || 'tool'}` : tool || 'mcp' };
    }
    case 'custom-tool':
      return { key: `${req.kind}:${req.toolName ?? ''}`, label: `${req.toolName || req.kind}` };
    default:
      return { key: String(req.kind), label: String(req.kind) };
  }
}

/** Options for the path check; `flavor` and `realpath` are injectable for tests (Windows paths, symlinks). */
export interface PathCheckOptions {
  flavor?: Pick<typeof path, 'resolve' | 'relative' | 'isAbsolute' | 'sep' | 'dirname'>;
  realpath?: (p: string) => string;
  /** Compare case-insensitively (Windows). Default: true when `process.platform === 'win32'`. */
  caseInsensitive?: boolean;
}

/** Real path of `p`; when it does not exist yet, the real path of its nearest existing ancestor plus the rest. */
function realOrNearest(p: string, o: Required<Pick<PathCheckOptions, 'flavor' | 'realpath'>>): string {
  const pm = o.flavor;
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = o.realpath(cur);
      return rest.length ? pm.resolve(real, ...rest.reverse()) : real;
    } catch {
      const up = pm.dirname(cur);
      if (up === cur) break;
      rest.push(cur.slice(up.length).replace(/^[\\/]+/, ''));
      cur = up;
    }
  }
  return p;
}

/**
 * Is `p` inside one of `roots`? Relative paths resolve against the first root; `..` is collapsed and symlinks are resolved
 * (a link inside a root that points outside counts as outside). A missing or empty path is outside.
 */
export function isInsideRoots(p: string | undefined, roots: readonly string[], opts: PathCheckOptions = {}): boolean {
  if (!p || !roots.length) return false;
  const flavor = opts.flavor ?? path;
  const realpath = opts.realpath ?? ((x: string) => fs.realpathSync(x));
  const ci = opts.caseInsensitive ?? process.platform === 'win32';
  const o = { flavor, realpath };
  const norm = (x: string): string => (ci ? x.toLowerCase() : x);
  const target = norm(realOrNearest(flavor.resolve(roots[0], p), o));
  return roots.some((r) => {
    const root = norm(realOrNearest(flavor.resolve(r), o));
    const rel = flavor.relative(root, target);
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + flavor.sep) && !flavor.isAbsolute(rel));
  });
}

export type BrokerEvent =
  /** A request is waiting for the user (card goes to "Waiting for you"). */
  | { type: 'pending'; permission: PermissionInfo }
  /** Denied by the read-only policy. */
  | { type: 'denied-policy'; permission: PermissionInfo }
  /** A request got its final answer (user, session grant, or the session was stopped). */
  | { type: 'resolved'; permission: PermissionInfo }
  /** Allow all approved a non-read request without asking (spec 052 FR-071): for the local activity log only, never a chat card. */
  | { type: 'auto'; permission: PermissionInfo }
  | { type: 'grants'; grants: SessionGrant[] };

export type BrokerMode = 'read-only' | 'ask' | 'allow';

/** The permission mode to start with: `permissionMode` wins (unknown = read-only, constitution III), else the old booleans. */
export function startModeOf(o: Pick<StartOptions, 'permissionMode' | 'allow' | 'ask'>): BrokerMode {
  const m = o.permissionMode as unknown;
  if (m !== undefined && m !== null) return m === 'allow' || m === 'ask' || m === 'read-only' ? m : 'read-only';
  return o.allow ? 'allow' : o.ask ? 'ask' : 'read-only';
}

export interface BrokerOptions {
  /** Initial mode (`allow`/`ask` flags are kept for older callers); it can be changed at any time with `setMode`. */
  mode?: BrokerMode;
  allow?: boolean;
  ask?: boolean;
  emit: (e: BrokerEvent) => void;
  /**
   * Folders this session may read freely (cwd + workspace folders). When set, `read` requests for paths outside them are
   * asked (Ask) or denied (Read-only); Allow all approves everything. When unset, reads are not path-checked (unit tests, other callers).
   */
  roots?: string[];
  /** Test hooks for the path check. */
  pathCheck?: PathCheckOptions;
  /** Spec 065 FR-001: awaited (at most 2 s, errors ignored) just before an approved `write` goes ahead, with the paths it writes. */
  beforeWrite?: (paths: string[]) => Promise<void>;
  /** Spec 069 FR-063: MCP tools turned off in Durbar (from `mcpToolBlockList`); a request for one is refused in every mode. */
  blockedTools?: () => ReadonlySet<string>;
}

/** Claude Code's wire name for a server: characters outside [A-Za-z0-9_-] become `_` (`mcp__<server>__<tool>`). */
export const claudeServerPart = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Spec 069 FR-063: the keys a request for a turned-off tool can match: `<server>/<tool>` (split names), Claude Code's
 * `mcp__<server>__<tool>` and Copilot's wire name `<server>-<tool>` (when a request carries only the tool's full name).
 */
export function mcpToolBlockList(off: Readonly<Record<string, readonly string[]>> | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [server, tools] of Object.entries(off ?? {}))
    for (const t of tools ?? []) {
      if (typeof t !== 'string' || !t) continue;
      out.add(`${server}/${t}`);
      out.add(`mcp__${claudeServerPart(server)}__${t}`);
      out.add(`${server}-${t}`);
    }
  return out;
}

function blockedMcp(req: PermissionLike, set: ReadonlySet<string> | undefined): { server?: string; tool: string } | undefined {
  if (!set || !set.size || String(req.kind) !== 'mcp') return undefined;
  const tool = typeof req.toolName === 'string' ? req.toolName : '';
  const server = typeof req.serverName === 'string' ? req.serverName : undefined;
  if (server && tool && set.has(`${server}/${tool}`)) return { server, tool };
  if (tool && set.has(tool)) return { server, tool };
  return undefined;
}

const WRITE_GUARD_MS = 2000;
/** Spec 065: most files of one write the undo guard copies (a Codex change can name more; its card says so, spec 052 FR-172). */
export const WRITE_GUARD_MAX_PATHS = 200;

type Answer = { approve: boolean; remember: boolean; broad: boolean; via: 'user' | 'stopped' };

interface Pending {
  info: PermissionInfo;
  resolve: (d: Answer) => void;
}

export class PermissionBroker {
  private seq = 0;
  private grants = new Map<string, SessionGrant>();
  private pending = new Map<string, Pending>();
  private stopped = false;
  private mode: BrokerMode;
  /** Files the user attached in this session: reading them is the user's own request. */
  private extraRoots: string[] = [];
  constructor(private readonly opts: BrokerOptions) {
    this.mode = opts.mode ?? (opts.allow ? 'allow' : opts.ask ? 'ask' : 'read-only');
  }

  /** The user attached these files to a message: the runtime may read them even when they are outside the roots. */
  allowReadPaths(paths: readonly string[]): void {
    for (const p of paths) if (p && !this.extraRoots.includes(p)) this.extraRoots.push(p);
  }

  private readIsOutside(req: PermissionLike): boolean {
    const roots = this.opts.roots;
    if (!roots || !roots.length) return false;
    return !isInsideRoots(req.path, [...roots, ...this.extraRoots], this.opts.pathCheck);
  }

  getMode(): BrokerMode {
    return this.mode;
  }

  /** Applies to the next request; requests already pending stay pending (see `approvePending` / `denyPending`). */
  setMode(mode: BrokerMode): void {
    this.mode = mode;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /** "Approve now" after switching to Allow all: answer every pending request with approve-once (nothing is remembered). */
  approvePending(): number {
    const all = [...this.pending.values()];
    for (const p of all) p.resolve({ approve: true, remember: false, broad: false, via: 'user' });
    return all.length;
  }

  /** Deny every pending request as the user's decision (e.g. after switching to Read-only). */
  denyPendingByUser(): number {
    const all = [...this.pending.values()];
    for (const p of all) p.resolve({ approve: false, remember: false, broad: false, via: 'user' });
    return all.length;
  }

  /** Forget every "Approve for this session" grant. */
  clearGrants(): void {
    if (!this.grants.size) return;
    this.grants.clear();
    this.opts.emit({ type: 'grants', grants: [] });
  }

  listGrants(): SessionGrant[] {
    return [...this.grants.values()];
  }

  /** Spec 065 FR-001: let the write guard keep a copy before an approved write (bounded; a slow or failing guard never blocks it). */
  private async approveWrite(req: PermissionLike): Promise<Decision> {
    const guard = this.opts.beforeWrite;
    if (guard && String(req.kind) === 'write') {
      const paths = (req.paths?.length ? req.paths : [req.fileName ?? req.path]).filter((p): p is string => typeof p === 'string' && !!p).slice(0, WRITE_GUARD_MAX_PATHS);
      if (paths.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([guard(paths).catch(() => undefined), new Promise<void>((r) => { timer = setTimeout(r, WRITE_GUARD_MS); })]);
        if (timer) clearTimeout(timer);
      }
    }
    return { kind: 'approve-once' };
  }

  async request(req: PermissionLike, now: () => number = Date.now): Promise<Decision> {
    const kind = String(req.kind);
    const summary = summarize(req);
    const requestId = String(req.toolCallId ?? `${kind}-${now()}-${++this.seq}`); // T026: two requests in the same millisecond get different ids
    const off = blockedMcp(req, this.opts.blockedTools?.());
    if (off) {
      const what = off.server ? `${off.server} › ${off.tool}` : off.tool;
      this.opts.emit({ type: 'denied-policy', permission: { requestId, kind, summary, state: 'denied' } });
      return { kind: 'reject', feedback: `This tool is turned off in Agent Durbar (${what}). Do not retry it.` };
    }
    const outsideRead = kind === 'read' && this.mode !== 'allow' && this.readIsOutside(req);
    if (kind === 'read' && !outsideRead) return { kind: 'approve-once' };
    if (this.mode === 'allow') {
      if (kind !== 'read') this.opts.emit({ type: 'auto', permission: { requestId, kind, summary, state: 'approved', via: 'policy' } });
      return this.approveWrite(req);
    }
    const scope = grantScope(req, this.opts.pathCheck?.flavor);
    const base = {
      requestId,
      kind,
      summary,
      scopeKey: scope.key,
      scopeLabel: scope.label,
      ...(scope.broad ? { broadScopeKey: scope.broad.key, broadScopeLabel: scope.broad.label } : {}),
    };
    if (this.stopped) return { kind: 'reject', feedback: 'Session was stopped in Agent Durbar.' };
    if (this.mode !== 'ask') {
      const permission: PermissionInfo = { ...base, state: 'denied' };
      this.opts.emit({ type: 'denied-policy', permission });
      return {
        kind: 'reject',
        feedback: outsideRead
          ? "Agent Durbar is in read-only mode and this path is outside the session's folders: the read was denied. Do not retry it."
          : 'Agent Durbar is in read-only mode: this action was denied. Do not retry it.',
      };
    }
    const granted = scope.folders ? scope.folders.every((x) => this.grants.has(x.key)) : this.grants.has(scope.key) || (!!scope.broad && this.grants.has(scope.broad.key));
    if (granted) {
      this.opts.emit({ type: 'resolved', permission: { ...base, state: 'approved', via: 'session' } });
      return this.approveWrite(req);
    }
    const info: PermissionInfo = { ...base, state: 'pending', ...(typeof req.diff === 'string' && req.diff ? { diff: req.diff } : {}), ...(typeof req.sandboxNote === 'string' && req.sandboxNote ? { sandboxNote: req.sandboxNote.slice(0, 300) } : {}) }; // spec 052 FR-063: the diff rides on the pending request only; spec 087 FR-021: so does the sandbox line
    this.opts.emit({ type: 'pending', permission: info });
    const r = await new Promise<Answer>((resolve) => this.pending.set(requestId, { info, resolve }));
    this.pending.delete(requestId);
    if (r.approve && r.remember && !this.stopped) {
      const gs = r.broad && scope.broad ? [scope.broad] : scope.folders ?? [scope];
      for (const g of gs) this.grants.set(g.key, { key: g.key, kind, label: g.label });
      this.opts.emit({ type: 'grants', grants: this.listGrants() });
    }
    this.opts.emit({ type: 'resolved', permission: { ...base, state: r.approve ? 'approved' : 'denied', via: r.via, remembered: r.approve && r.remember ? true : undefined } });
    return r.approve ? this.approveWrite(req) : { kind: 'reject', feedback: r.via === 'stopped' ? 'Session was stopped in Agent Durbar.' : 'Denied by user in Agent Durbar.' };
  }

  /**
   * Answer a pending request. `remember` = "Approve for this session" (ignored when denying).
   * `broad` = remember the wider "any arguments of this command" scope instead of the exact command (only when the request offered one).
   */
  resolve(requestId: string, approve: boolean, remember = false, broad = false): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    p.resolve({ approve, remember: approve && remember, broad: approve && remember && broad && !!p.info.broadScopeKey, via: 'user' });
    return true;
  }

  revoke(key: string): boolean {
    const had = this.grants.delete(key);
    if (had) this.opts.emit({ type: 'grants', grants: this.listGrants() });
    return had;
  }

  /** Turn interrupted (Stop): deny what is pending so nothing waits forever; the session and its grants stay. */
  denyPending(): void {
    for (const p of [...this.pending.values()]) p.resolve({ approve: false, remember: false, broad: false, via: 'stopped' });
  }

  /** Session ended: deny everything pending cleanly and forget all grants. */
  stop(): void {
    this.stopped = true;
    for (const p of [...this.pending.values()]) p.resolve({ approve: false, remember: false, broad: false, via: 'stopped' });
    if (this.grants.size) {
      this.grants.clear();
      this.opts.emit({ type: 'grants', grants: [] });
    }
  }
}
