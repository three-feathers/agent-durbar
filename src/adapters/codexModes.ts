/**
 * Codex mode and approval mapping (spec 012 FR-004, FR-013; plan "Codex" table). Pure: no process, no I/O.
 * The types below mirror the names of the `codex app-server` protocol (research.md, docs-derived, unverified on
 * a real account); they are local on purpose so no vendor type leaks into the renderer or `src/shared`.
 */
import type { PermissionMode } from './capabilities';

/** Protocol `AskForApproval`, the values we use. `untrusted` is retired; `granular` is not offered. */
export type CodexApprovalPolicy = 'never' | 'on-request';
/** Protocol `SandboxMode`. Only Allow all sends it; Read-only and Ask first use the `durbar_ro` profile (FR-086). */
export type CodexSandbox = 'danger-full-access';

/** Name of the read-limited permission profile (spec 012 FR-086). */
export const CODEX_RO_PROFILE = 'durbar_ro';

/**
 * `thread/start` and `turn/start` settings. `permissions` (a profile id) and `sandbox` are mutually exclusive:
 * exactly one of them is present.
 */
export interface CodexModeSettings {
  approvalPolicy: CodexApprovalPolicy;
  sandbox?: CodexSandbox;
  permissions?: typeof CODEX_RO_PROFILE;
}

/**
 * Durbar mode to `thread/start` and `turn/start` settings. An unknown mode (bad data) gets the most restrictive
 * setting: refuse, never weaken. Read-only and Ask first never send `sandbox` (it would replace the profile with
 * the unrestricted `read-only` sandbox, which reads anywhere the OS user can).
 */
export function codexModeSettings(mode: PermissionMode | string): CodexModeSettings {
  switch (mode) {
    case 'allow':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    case 'ask':
      return { approvalPolicy: 'on-request', permissions: CODEX_RO_PROFILE };
    default:
      return { approvalPolicy: 'never', permissions: CODEX_RO_PROFILE };
  }
}

/**
 * The `durbar_ro` filesystem table: read `:minimal` and the workspace roots, nothing else. No `:root`, no
 * `write` or `deny` entry (anything not listed is unreadable). Constant data: no user string goes into it.
 */
export const CODEX_RO_FILESYSTEM: Readonly<Record<string, 'read'>> = Object.freeze({ ':minimal': 'read', ':workspace_roots': 'read' });

/** The profile as an inline TOML table, for `-c permissions.durbar_ro.filesystem=<this>`. */
export function codexProfileToml(): string {
  return `{${Object.entries(CODEX_RO_FILESYSTEM).map(([k, v]) => `"${k}"="${v}"`).join(',')}}`;
}

/**
 * Spawn arguments that define the profile (`codex app-server -c key=value`). An argv array for `spawn` without a
 * shell: each element is one argument, nothing is quoted for a shell.
 */
export function codexProfileArgs(): string[] {
  return ['-c', `permissions.${CODEX_RO_PROFILE}.filesystem=${codexProfileToml()}`];
}

/** `initialize` capabilities: `permissions` and `runtimeWorkspaceRoots` are experimental fields. */
export const CODEX_INITIALIZE_CAPABILITIES = Object.freeze({ experimentalApi: true });

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/**
 * Session folders to `runtimeWorkspaceRoots`: absolute paths only, duplicates removed, order kept. Values are
 * JSON params (never argv or TOML), so spaces, `=` and Windows separators need no escaping. A relative or empty
 * entry is dropped, never resolved: fewer roots means fewer readable files.
 */
export function codexWorkspaceRoots(roots: readonly unknown[] | undefined | null): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(roots) ? roots : []) {
    if (typeof r !== 'string' || !r || r.includes('\0') || !isAbsolutePath(r)) continue;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** First Codex version that has `permissions` (spec 012 FR-087). */
export const CODEX_MIN_PERMISSIONS_VERSION = 'rust-v0.163.0';

/** `rust-v0.163.0`, `v0.163.0` or `0.163.0` (optional `-pre`/`+build`) to numbers; undefined when unparseable. */
function parseCodexVersion(v: unknown): { n: [number, number, number]; pre: boolean } | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(?:rust-v|v)?(\d{1,9})\.(\d{1,9})\.(\d{1,9})([-+][0-9A-Za-z.+-]*)?$/.exec(v.trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] && m[4][0] === '-' } : undefined;
}

export interface CodexReadCheck {
  version?: string;
  /** True when `initialize` accepted `capabilities.experimentalApi`. */
  experimentalApi?: boolean;
  platform?: string;
  /** Windows only: the elevated sandbox is set up (Codex refuses split read restrictions without it). */
  elevatedSandbox?: boolean;
}

/**
 * Can the `durbar_ro` profile be enforced? Anything unknown is not enforceable (fail closed; spec 012 FR-087).
 * The caller refuses to start Read-only or Ask first when `ok` is false and may offer Allow all as the user's choice.
 */
export function codexReadEnforceable(c: CodexReadCheck): { ok: true } | { ok: false; reason: string } {
  const have = parseCodexVersion(c?.version);
  const min = parseCodexVersion(CODEX_MIN_PERMISSIONS_VERSION)!;
  if (!have) return { ok: false, reason: `The Codex version could not be read, so Durbar cannot confirm it can limit reads to the session's folders (needs ${CODEX_MIN_PERMISSIONS_VERSION} or newer).` };
  let cmp = 0;
  for (let i = 0; i < 3 && cmp === 0; i++) cmp = have.n[i] - min.n[i];
  if (cmp === 0 && have.pre) cmp = -1; // a pre-release of the minimum may predate the feature
  if (cmp < 0) return { ok: false, reason: `This Codex is too old to limit reads to the session's folders (needs ${CODEX_MIN_PERMISSIONS_VERSION} or newer).` };
  if (c.experimentalApi !== true) return { ok: false, reason: 'This Codex did not accept the experimental API, which Durbar needs to limit reads to the session\'s folders.' };
  if (typeof c.platform !== 'string' || !c.platform) return { ok: false, reason: 'The platform is unknown, so Durbar cannot confirm Codex can limit reads.' };
  if (c.platform === 'win32' && c.elevatedSandbox !== true) return { ok: false, reason: 'On Windows, Codex needs its elevated sandbox set up to limit reads to the session\'s folders.' };
  return { ok: true };
}

/** Server request methods that ask for approval (research.md, "Approvals"). */
export const CODEX_APPROVAL_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'tool/requestUserInput',
] as const;

/** Broker-compatible permission fields (a subset of `PermissionLike`). `kind` is never `read`. */
export interface CodexPermission {
  kind: 'shell' | 'write' | 'url' | 'mcp' | 'custom-tool';
  fullCommandText?: string;
  fileName?: string;
  url?: string;
  toolName?: string;
  serverName?: string;
  /** One line for the needs-permission card. */
  summary: string;
}

/** Own string property only: inherited or prototype keys never count. */
function str(o: unknown, key: string): string | undefined {
  if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, key)) return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'string' && v ? v : undefined;
}

function own(o: unknown, key: string): unknown {
  return o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined;
}

/**
 * Codex approval request (method and params) to a Durbar permission. Anything unknown or malformed becomes
 * `custom-tool`, which is not a read: Read-only denies it and Ask first asks.
 */
export function codexPermission(method: string, params: unknown): CodexPermission {
  switch (method) {
    case 'item/commandExecution/requestApproval': {
      const command = str(params, 'command');
      const net = own(params, 'networkApprovalContext');
      const host = str(net, 'host');
      // Always a shell request: the user must see (and a grant must key on) the command; the host is extra context.
      const netHost = net && typeof net === 'object' ? host : undefined;
      return { kind: 'shell', fullCommandText: command, url: netHost, summary: `run ${command ?? ''}${netHost ? ` (network: ${netHost})` : ''}`.trim() };
    }
    case 'item/fileChange/requestApproval': {
      const changes = own(params, 'changes');
      const paths = Array.isArray(changes) ? changes.map((c) => str(c, 'path')).filter((p): p is string => !!p) : [];
      const fileName = paths[0] ?? str(params, 'grantRoot');
      const more = paths.length > 1 ? ` (+${paths.length - 1} more)` : '';
      return { kind: 'write', fileName, summary: `write ${fileName ?? ''}${more}`.trim() };
    }
    case 'item/permissions/requestApproval':
      return { kind: 'custom-tool', toolName: 'request_permissions', summary: `request_permissions ${str(params, 'reason') ?? ''}`.trim() };
    case 'mcpServer/elicitation/request':
    case 'tool/requestUserInput': {
      // Mapped to `mcp` only because it is a non-read kind that asks the user; it is not a claim that an MCP server sent it.
      const serverName = str(params, 'serverName');
      const toolName = str(params, 'toolName');
      return { kind: 'mcp', serverName, toolName, summary: `mcp ${serverName ? serverName + ' › ' : ''}${toolName ?? ''}`.trim() };
    }
    default: {
      const name = typeof method === 'string' ? method.slice(0, 100) : 'unknown';
      return { kind: 'custom-tool', toolName: name, summary: `custom-tool ${name}`.trim() };
    }
  }
}

/** What the user (or the mode) answered, in Durbar's words. */
export type DurbarAnswer = 'approve' | 'remember' | 'deny' | 'stop';
/** Protocol approval decisions we send: `acceptForSession` and amendments are never sent (plan). */
export type CodexDecision = 'accept' | 'decline' | 'cancel';

export interface CodexReply {
  decision: CodexDecision;
  /** True: the adapter records Durbar's own session grant (plan: not `acceptForSession`). */
  remember: boolean;
  /** True: the adapter also calls `turn/interrupt`. */
  interruptTurn: boolean;
}

/**
 * Durbar answer to the Codex reply. In Read-only nothing is ever accepted (plan: an approval request that
 * still arrives is answered `decline`); "stop" still cancels and interrupts there.
 */
export function codexReply(answer: DurbarAnswer | string, mode: PermissionMode | string | undefined): CodexReply {
  if (answer === 'stop') return { decision: 'cancel', remember: false, interruptTurn: true };
  if (mode !== 'ask' && mode !== 'allow') return { decision: 'decline', remember: false, interruptTurn: false };
  if (answer === 'approve') return { decision: 'accept', remember: false, interruptTurn: false };
  if (answer === 'remember') return { decision: 'accept', remember: true, interruptTurn: false };
  return { decision: 'decline', remember: false, interruptTurn: false };
}
