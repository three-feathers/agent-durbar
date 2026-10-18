/**
 * Claude Code permission modes (spec 012 FR-004, FR-013): Durbar's mode -> Claude Agent SDK options,
 * tool name -> Durbar permission kind, and the Read-only `PreToolUse` decision.
 * Pure TypeScript: no SDK import, no I/O, so it is unit-tested without a Claude session or credits.
 *
 * The option, mode and hook names below mirror `@anthropic-ai/claude-agent-sdk` as written in
 * specs/012-claude-codex-adapters/research.md (from docs, unverified on a real run). The SDK is not a dependency yet.
 * Policy: only Allow auto-approves; Read-only denies everything that is not a known read tool (unknown names included);
 * Ask routes everything that is not a known read tool to a permission request.
 */
import type { PermissionMode } from './capabilities';

/** The SDK's own permission modes that Durbar uses. `auto`, `acceptEdits` and `plan` are never offered (plan, mode table). */
export type ClaudeSdkMode = 'default' | 'dontAsk' | 'bypassPermissions';

/** The subset of the SDK's `query()` options that a Durbar mode sets. */
export interface ClaudeModeOptions {
  /** Always set explicitly: a session with no mode can start in `auto`. */
  permissionMode: ClaudeSdkMode;
  /** Only with `bypassPermissions`. */
  allowDangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** The adapter must install a `canUseTool` callback (Ask first; harmless in the others). */
  canUseTool: boolean;
  /** The adapter must install the Read-only `PreToolUse` deny hook. */
  preToolUseHook: boolean;
}

/** Durbar's permission kinds (same strings as `PermissionInfo.kind` / the broker). */
export type ClaudeToolKind = 'read' | 'write' | 'shell' | 'url' | 'mcp' | 'custom-tool';

/** Tools that only read inside the session (plan: tool name -> kind). */
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS'] as const;
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;
const SHELL_TOOLS = ['Bash', 'BashOutput', 'KillBash'] as const;
const URL_TOOLS = ['WebFetch', 'WebSearch'] as const;

/** Maps (not objects) so a tool called `__proto__` or `constructor` gets no special treatment. */
const KIND_BY_TOOL: ReadonlyMap<string, ClaudeToolKind> = new Map<string, ClaudeToolKind>([
  ...READ_TOOLS.map((n): [string, ClaudeToolKind] => [n, 'read']),
  ...WRITE_TOOLS.map((n): [string, ClaudeToolKind] => [n, 'write']),
  ...SHELL_TOOLS.map((n): [string, ClaudeToolKind] => [n, 'shell']),
  ...URL_TOOLS.map((n): [string, ClaudeToolKind] => [n, 'url']),
]);

/** The allow list of Read-only and Ask first: exactly the tools whose kind is `read`, so the SDK mode and the hook agree. */
const CORE_READ_TOOLS: string[] = [...READ_TOOLS];
/** Read-only backstop: shell, write and web tools are denied in every mode of the rule engine. */
const READ_ONLY_DISALLOWED = [...SHELL_TOOLS, ...WRITE_TOOLS, ...URL_TOOLS];

const MCP_NAME = /^mcp__(.+?)__(.+)$/;

/** Durbar mode -> the SDK options that enforce it. An unknown or missing mode (bad data at runtime) gets the Read-only options, never fewer restrictions. */
export function claudeOptionsFor(mode: PermissionMode): ClaudeModeOptions {
  switch (mode) {
    case 'ask':
      return { permissionMode: 'default', allowedTools: [...CORE_READ_TOOLS], canUseTool: true, preToolUseHook: false };
    case 'allow':
      return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, canUseTool: true, preToolUseHook: false };
    case 'read-only':
    default:
      return { permissionMode: 'dontAsk', allowedTools: [...CORE_READ_TOOLS], disallowedTools: [...READ_ONLY_DISALLOWED], canUseTool: true, preToolUseHook: true };
  }
}

/** Claude tool name -> permission kind. Anything not listed is `custom-tool`, which is never a read. */
export function toolKind(toolName: string): ClaudeToolKind {
  const known = KIND_BY_TOOL.get(toolName);
  if (known) return known;
  return MCP_NAME.test(toolName) ? 'mcp' : 'custom-tool';
}

/** Server and tool of an `mcp__<server>__<tool>` name (the server name is the first segment; the init server list can refine it). */
export function parseMcpTool(toolName: string): { server: string; tool: string } | undefined {
  const m = MCP_NAME.exec(toolName);
  return m ? { server: m[1], tool: m[2] } : undefined;
}

/** True only for the known read tools. Unknown names are not reads. */
export function isReadTool(toolName: string): boolean {
  return toolKind(toolName) === 'read';
}

export type ToolDecision = { behavior: 'allow' } | { behavior: 'deny'; reason: string } | { behavior: 'ask'; reason: string };

/**
 * What to do with a tool call in a mode (used for `canUseTool`, and mirrored by the hook in Read-only).
 *  - read-only: reads allowed, everything else (write, shell, web, MCP, unknown) denied.
 *  - ask: reads allowed, everything else asks the user.
 *  - allow: everything allowed, except `AskUserQuestion`, which needs the user (plan, "Needs the user").
 * Whether a read is inside the session's roots is the broker's job (spec 003), not decided here.
 */
export function decideTool(mode: PermissionMode, toolName: string): ToolDecision {
  const kind = toolKind(toolName);
  if (mode === 'allow') return toolName === 'AskUserQuestion' ? { behavior: 'ask', reason: 'needs the user to answer' } : { behavior: 'allow' };
  if (kind === 'read') return { behavior: 'allow' };
  if (mode === 'ask') return { behavior: 'ask', reason: `${toolName} (${kind}) needs your approval` };
  return { behavior: 'deny', reason: `Read-only mode: ${toolName} (${kind}) is not allowed` };
}

/** The `PreToolUse` hook output (the SDK's `hookSpecificOutput` shape; unverified on a real run). */
export interface PreToolUseDeny {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'deny'; permissionDecisionReason: string };
}

/**
 * The Read-only `PreToolUse` decision: a deny for every tool that is not a known read tool, whatever the user's
 * own settings allow; `undefined` (no opinion, let the normal flow run) for reads and for the other modes.
 */
export function preToolUseDecision(mode: PermissionMode, toolName: string): PreToolUseDeny | undefined {
  if (mode === 'ask' || mode === 'allow') return undefined;
  const d = decideTool(mode, toolName);
  if (d.behavior !== 'deny') return undefined;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } };
}
