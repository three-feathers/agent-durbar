/**
 * Spec 061: a folder's own agent setup (hooks, permission rules, MCP servers), as the window sees it. Pure types: no I/O.
 * What reaches the window is masked (secret values never leave main); the raw content stays in main and is applied only for the
 * items the person accepted in the folder-setup dialog (FR-002, FR-013).
 */

/** The agent app whose file the item comes from; `any` = an MCP server that Durbar can hand to every app (`.mcp.json`). */
export type FolderSetupApp = 'claude' | 'codex' | 'copilot' | 'any';
export type FolderSetupKind = 'hook' | 'rule' | 'mcp';
export type RuleKind = 'allow' | 'deny' | 'ask';

export interface FolderSetupItem {
  /** Digest of the item's content (FR-010): a changed item has a new id, so it is asked again. */
  id: string;
  app: FolderSetupApp;
  kind: FolderSetupKind;
  /** Path of the file inside the folder, with `/` separators (for example `.claude/settings.json`). */
  file: string;
  /** Short title: "SessionStart hook", "Allow rule", "MCP server github". */
  label: string;
  /** The item in full, masked (FR-014): the hook's command, the rule as written, the server's command and arguments or URL. */
  detail: string;
  event?: string;
  matcher?: string;
  ruleKind?: RuleKind;
  /** FR-014: a rule that approves (or asks for) a whole tool rather than a pattern, such as `Bash` or `Bash(*)`. */
  broad?: boolean;
  /** FR-014 (review #424): part of the text was replaced because it has a token's shape; shown as such, and left unticked. */
  hidden?: boolean;
  /** Re-review #424: why the item is marked `hidden` when it is not a token shape (an MCP server that hands env values to a shell). */
  hiddenWhy?: string;
  /** Names of env variables or headers (values never shown). */
  secretNames?: string[];
  /** False when the agent app cannot apply this item from Durbar (FR-006), with the reason. */
  supported: boolean;
  unsupportedWhy?: string;
}

export interface FolderSetupView {
  ok: boolean;
  error?: string;
  /** The folder key the decisions belong to. */
  key: string;
  items: FolderSetupItem[];
  /** Files that exist but could not be read (too large, not JSON, ...): shown, never applied. */
  problems: { file: string; message: string }[];
  accepted: string[];
  declined: string[];
  /** Items with no decision yet: new, or changed since the last decision (FR-010). Nothing pending is ever applied. */
  pending: string[];
}

export interface FolderSetupDecision {
  accepted: string[];
  declined: string[];
  /**
   * FR-011: hooks are accepted only with this explicit confirmation ("I have read these hooks and I know what they run"). The same tick
   * covers broad allow rules (S1, review #424: `Bash`, `Read(*)`, a bare tool name), which act without asking for a whole tool.
   */
  hooksConfirmed: boolean;
}

/** FR-015: an AI explanation of one hook. Advisory only (FR-016): it never accepts, declines or hides anything. */
export interface HookExplanation {
  ok: boolean;
  error?: string;
  verdict?: 'harmless' | 'care' | 'risky';
  text?: string;
  /** Which agent app explained it (shown, so the person knows where the hook text was sent). */
  by?: string;
  /** FR-016: what the explanation cost, as the app reported it (`≈ $0.0012` or `0.071 AIU`), shown like any one-shot. */
  cost?: string;
}

/** S1 (review #424): items that need the explicit tick: every hook, and every broad allow rule. */
export function needsConfirm(i: Pick<FolderSetupItem, 'kind' | 'ruleKind' | 'broad'>): boolean {
  return i.kind === 'hook' || (i.kind === 'rule' && i.ruleKind === 'allow' && !!i.broad);
}

/**
 * FR-014 + S1 (owner, 2026-10-21: "broad allow rules need explicit tick like hooks"): a rule is broad when it covers a whole tool or
 * more than one narrow place: a bare tool name; a pattern of only wildcards and separators (`*`, `:*`, `**`, `*:*`, `/**`); a file tool
 * (`Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`) on a path from the root, the home folder or a drive with `**`; a `Bash`
 * prefix that names no command (`Bash( :*)`).
 */
export function isBroadRule(rule: string): boolean {
  const m = /^([A-Za-z_][A-Za-z0-9_:.-]*)(?:\((.*)\))?$/.exec(rule.trim());
  if (!m) return false;
  const [, tool, pat] = m;
  if (pat === undefined || /^[\s*:/.\\]*$/.test(pat)) return true;
  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) && /^\s*(~|\/|[A-Za-z]:)/.test(pat) && /\*\*/.test(pat)) return true;
  if (tool === 'Bash' && /^\s*:\*\s*$/.test(pat)) return true;
  return false;
}

/** Spec 061 FR-004: one accepted hook, as its app's own file wrote it (Claude/Codex: `command`; Copilot: `bash` / `powershell`). */
export interface FolderHook {
  event: string;
  matcher?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  timeout?: number;
}

/** What a session gets from the folder's accepted setup (MCP servers arrive merged into the session's own `mcpServers`). */
export interface FolderSetupStart {
  hooks?: FolderHook[];
  rules?: { allow: string[]; deny: string[]; ask: string[] };
}

/**
 * Research R1: Claude Code applies exactly what a composed `--settings` JSON holds (hooks, allow, deny and ask rules) with
 * `--setting-sources ""`, without trusting the folder. Undefined when there is nothing to pass.
 */
export function claudeSettingsJson(f: FolderSetupStart | undefined): string | undefined {
  if (!f) return undefined;
  const hooks: Record<string, { matcher?: string; hooks: { type: 'command'; command: string; timeout?: number }[] }[]> = {};
  for (const h of f.hooks ?? []) {
    if (!h.command) continue;
    (hooks[h.event] ??= []).push({ ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: h.command, ...(h.timeout ? { timeout: h.timeout } : {}) }] });
  }
  const r = f.rules;
  const permissions = r && (r.allow.length || r.deny.length || r.ask.length) ? { ...(r.allow.length ? { allow: r.allow } : {}), ...(r.deny.length ? { deny: r.deny } : {}), ...(r.ask.length ? { ask: r.ask } : {}) } : undefined;
  if (!Object.keys(hooks).length && !permissions) return undefined;
  return JSON.stringify({ ...(Object.keys(hooks).length ? { hooks } : {}), ...(permissions ? { permissions } : {}) });
}

/** Research R3: Copilot's own hook file format (for the SDK's explicit `hookDirectories`). Undefined when there is no hook. */
export function copilotHooksJson(f: FolderSetupStart | undefined): string | undefined {
  const hooks: Record<string, { type: 'command'; bash?: string; powershell?: string; timeoutSec?: number }[]> = {};
  for (const h of f?.hooks ?? []) {
    if (!h.bash && !h.powershell) continue;
    (hooks[h.event] ??= []).push({ type: 'command', ...(h.bash ? { bash: h.bash } : {}), ...(h.powershell ? { powershell: h.powershell } : {}), ...(h.timeout ? { timeoutSec: h.timeout } : {}) });
  }
  return Object.keys(hooks).length ? JSON.stringify({ version: 1, hooks }) : undefined;
}
