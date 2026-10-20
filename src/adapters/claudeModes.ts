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
import { isInsideRoots, type PathCheckOptions } from './permissions';

/** The SDK's own permission modes that Durbar uses. `auto`, `acceptEdits` and `plan` are never offered (plan, mode table). */
export type ClaudeSdkMode = 'default' | 'dontAsk' | 'bypassPermissions';

/** The subset of the SDK's `query()` options that a Durbar mode sets. */
export interface ClaudeModeOptions {
  /** Always set explicitly: a session with no mode can start in `auto`. */
  permissionMode: ClaudeSdkMode;
  /** Only with `bypassPermissions`. */
  allowDangerouslySkipPermissions?: boolean;
  /** Never lists a read tool in Ask first or Allow all (see `claudeOptionsFor`); Read-only lists the read set because `dontAsk` needs it. */
  allowedTools?: string[];
  /** Always `[]`, trusted folder or not: Durbar sessions ignore `~/.claude` and project settings (their allow rules would approve tools before `canUseTool`). */
  settingSources: string[];
  /** Always `true`: MCP servers come only from Durbar's own `mcpServers` option, never `.mcp.json`, user settings, plugins or claude.ai connectors. */
  strictMcpConfig: boolean;
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

/**
 * Read-only's allow list: exactly the tools whose kind is `read`. `dontAsk` denies whatever is not pre-approved and never
 * calls `canUseTool`, so without this list Read-only could read nothing. The session-roots check for those reads is done
 * by the `PreToolUse` hook (`preToolUseDecision`), which runs before the permission flow and can deny an outside read.
 * Ask first and Allow all list NO read tool: every read reaches `canUseTool`, so `decideTool` can check the roots.
 */
const READ_ONLY_ALLOWED: string[] = [...READ_TOOLS];
/** Read-only backstop: shell, write and web tools are denied in every mode of the rule engine. */
const READ_ONLY_DISALLOWED = [...SHELL_TOOLS, ...WRITE_TOOLS, ...URL_TOOLS];

const MCP_NAME = /^mcp__(.+?)__(.+)$/;

/**
 * Spec 061 (Q3, Amendment 1): an allow rule from the folder's own setup that the person ACCEPTED passes Durbar's Read-only for the
 * calls it covers. Durbar only stands aside here; Claude Code still decides with its own, stricter matching of the same rule
 * (`dontAsk` approves only what the composed `--settings` allows). Shapes understood: a bare tool name (`Bash`, `WebFetch`,
 * `mcp__server__tool`), `Bash(prefix:*)` and `Bash(exact command)`. Any other shape keeps Read-only (it still applies in Ask first).
 */
function folderRule(rule: string): { tool: string; prefix?: string; exact?: string } | undefined {
  const m = /^([A-Za-z_][A-Za-z0-9_]*(?:__[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+)?)(?:\((.*)\))?$/.exec(rule.trim());
  if (!m) return undefined;
  const [, tool, pat] = m;
  if (pat === undefined || /^\s*\*?\s*$/.test(pat)) return { tool };
  if (tool !== 'Bash') return undefined;
  const pm = /^(.+?):\*$/.exec(pat);
  return pm ? { tool, prefix: pm[1] } : { tool, exact: pat };
}
/** The tool names that accepted folder allow rules open (taken off Read-only's disallowed list). */
export function folderRuleTools(rules: readonly string[] | undefined): Set<string> {
  return new Set((rules ?? []).map(folderRule).filter((r): r is { tool: string } => !!r).map((r) => r.tool));
}
/** True when an accepted folder allow rule covers this call (then Durbar's Read-only hook has no opinion). */
export function folderRuleAllows(rules: readonly string[] | undefined, toolName: string, input?: ToolInput): boolean {
  for (const r of (rules ?? []).map(folderRule)) {
    if (!r || r.tool !== toolName) continue;
    if (r.prefix === undefined && r.exact === undefined) return true;
    const cmd = input && typeof (input as Record<string, unknown>).command === 'string' ? ((input as Record<string, unknown>).command as string).trim() : undefined;
    if (cmd === undefined) continue;
    if (r.exact !== undefined && cmd === r.exact.trim()) return true;
    if (r.prefix !== undefined && cmd.startsWith(r.prefix)) return true;
  }
  return false;
}

/**
 * Durbar mode -> the SDK options that enforce it. An unknown or missing mode (bad data at runtime) gets the Read-only
 * options, never fewer restrictions. `settingSources: []` and `strictMcpConfig: true` in every mode, trusted folder or not (spec 012 Q8, T027).
 */
export function claudeOptionsFor(mode: PermissionMode, folderAllow?: readonly string[]): ClaudeModeOptions {
  switch (mode) {
    case 'ask':
      return { permissionMode: 'default', settingSources: [], strictMcpConfig: true, canUseTool: true, preToolUseHook: false };
    case 'allow':
      return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, settingSources: [], strictMcpConfig: true, canUseTool: true, preToolUseHook: false };
    case 'read-only':
    default:
      return { permissionMode: 'dontAsk', allowedTools: [...READ_ONLY_ALLOWED], disallowedTools: READ_ONLY_DISALLOWED.filter((t) => !folderRuleTools(folderAllow).has(t)), settingSources: [], strictMcpConfig: true, canUseTool: true, preToolUseHook: true };
  }
}

/**
 * Claude tool name -> permission kind. Anything not listed is `custom-tool`, which is never a read: `TodoWrite`, `Task`
 * and `ExitPlanMode` are custom tools too, so Read-only denies them (intended).
 */
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

/** Tool input as the SDK passes it (untrusted shape). */
export type ToolInput = Record<string, unknown> | undefined;

/**
 * The paths a read tool will touch, or `'outside'` when they cannot be told (wrong type, empty, a pattern that escapes).
 * `Read`/`NotebookRead` need a path; `Glob`/`Grep`/`LS` without one work on the session folder (`roots[0]`).
 */
function readPaths(toolName: string, input: ToolInput, roots: readonly string[]): string[] | 'outside' {
  const need = toolName === 'Read' ? 'file_path' : toolName === 'NotebookRead' ? 'notebook_path' : 'path';
  const raw = input ? input[need] : undefined;
  // a Glob pattern can name an absolute or `..` path by itself
  const pat = toolName === 'Glob' && input ? input['pattern'] : undefined;
  if (pat !== undefined && (typeof pat !== 'string' || /^([\\/]|[A-Za-z]:)/.test(pat) || /(^|[\\/])\.\.([\\/]|$)/.test(pat))) return 'outside';
  if (raw === undefined && (toolName === 'Glob' || toolName === 'Grep' || toolName === 'LS')) return roots.length ? [roots[0]] : 'outside';
  if (typeof raw !== 'string' || raw === '') return 'outside';
  return [raw];
}

/**
 * Is a read tool call inside the session's roots? Same rule as the Copilot broker's `readIsOutside`
 * (`isInsideRoots`: `..` collapsed, symlinks resolved), with one difference: no roots given counts as OUTSIDE here,
 * because the broker is only built with roots and this module must never widen by omission.
 */
export function readIsInsideRoots(toolName: string, input: ToolInput, roots: readonly string[] | undefined, pathCheck?: PathCheckOptions): boolean {
  if (!roots || !roots.length) return false;
  const paths = readPaths(toolName, input, roots);
  if (paths === 'outside') return false;
  return paths.every((p) => isInsideRoots(p, roots, pathCheck));
}

/**
 * What to do with a tool call in a mode (used for `canUseTool`, and mirrored by the hook in Read-only).
 *  - read-only: a read inside `roots` is allowed; everything else (outside read, write, shell, web, MCP, unknown) is denied.
 *  - ask: a read inside `roots` is allowed; an outside read and every other tool ask the user.
 *  - allow: everything allowed, except `AskUserQuestion`, which needs the user (plan, "Needs the user").
 * An unknown mode behaves as read-only. `roots` empty or missing means every read is outside.
 */
export function decideTool(mode: PermissionMode, toolName: string, input?: ToolInput, roots?: readonly string[], pathCheck?: PathCheckOptions): ToolDecision {
  const kind = toolKind(toolName);
  if (mode === 'allow') return toolName === 'AskUserQuestion' ? { behavior: 'ask', reason: 'needs the user to answer' } : { behavior: 'allow' };
  if (kind === 'read' && readIsInsideRoots(toolName, input, roots, pathCheck)) return { behavior: 'allow' };
  const what = kind === 'read' ? `${toolName} outside the session's folders` : `${toolName} (${kind})`;
  if (mode === 'ask') return { behavior: 'ask', reason: `${what} needs your approval` };
  return { behavior: 'deny', reason: `Read-only mode: ${what} is not allowed` };
}

/** The `PreToolUse` hook output (the SDK's `hookSpecificOutput` shape; unverified on a real run). */
export interface PreToolUseDeny {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'deny'; permissionDecisionReason: string };
}

/**
 * The Read-only `PreToolUse` decision: a deny for every tool that is not a read inside the roots, whatever the user's
 * own settings allow; `undefined` (no opinion, let the normal flow run) for such reads and for the other modes.
 */
export function preToolUseDecision(mode: PermissionMode, toolName: string, input?: ToolInput, roots?: readonly string[], pathCheck?: PathCheckOptions, folderAllow?: readonly string[]): PreToolUseDeny | undefined {
  if (mode === 'ask' || mode === 'allow') return undefined;
  if (folderRuleAllows(folderAllow, toolName, input)) return undefined; // spec 061: an accepted folder allow rule; Claude decides
  const d = decideTool(mode, toolName, input, roots, pathCheck);
  if (d.behavior !== 'deny') return undefined;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } };
}
