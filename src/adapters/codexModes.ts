/**
 * Codex mode and approval mapping (spec 012 FR-004, FR-013; plan "Codex" table). Pure: no process, no I/O.
 * The types below mirror the names of the `codex app-server` protocol (research.md, docs-derived, unverified on
 * a real account); they are local on purpose so no vendor type leaks into the renderer or `src/shared`.
 */
import type { PermissionMode } from './capabilities';

/** Protocol `AskForApproval`, the values we use. `untrusted` is retired; `granular` is not offered. */
export type CodexApprovalPolicy = 'never' | 'on-request';
/** Protocol `SandboxMode`, the values we use. `workspace-write` is deliberately not offered (plan Q6). */
export type CodexSandbox = 'read-only' | 'danger-full-access';

export interface CodexModeSettings {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandbox;
}

/**
 * Durbar mode to `thread/start` and `turn/start` settings. An unknown mode (bad data) gets the most restrictive
 * setting: refuse, never weaken.
 */
export function codexModeSettings(mode: PermissionMode | string): CodexModeSettings {
  switch (mode) {
    case 'allow':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    case 'ask':
      return { approvalPolicy: 'on-request', sandbox: 'read-only' };
    default:
      return { approvalPolicy: 'never', sandbox: 'read-only' };
  }
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
