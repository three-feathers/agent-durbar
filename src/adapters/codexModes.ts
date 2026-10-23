/**
 * Codex mode and approval mapping (spec 012 FR-004, FR-013; plan "Codex" table). Pure: no process, no I/O.
 * The types below mirror the names of the `codex app-server` protocol (research.md, docs-derived, unverified on
 * a real account); they are local on purpose so no vendor type leaks into the renderer or `src/shared`.
 */
import * as path from 'path';
import type { PermissionMode } from './capabilities';
import { CODEX_MIN_VERSION, compareVersions } from './detect';
import { clipDiff, simpleDiff } from '../shared/diff';
import { WRITE_GUARD_MAX_PATHS } from './permissions';

/** Protocol `AskForApproval`, the values we use. `untrusted` is retired; `granular` is not offered. */
export type CodexApprovalPolicy = 'never' | 'on-request';
/** Protocol `SandboxMode`. Only Allow all sends it; Read-only and Ask first use the `durbar_ro` profile (FR-086). */
export type CodexSandbox = 'danger-full-access';

/** Name of the read-limited permission profile (spec 012 FR-086). */
export const CODEX_RO_PROFILE = 'durbar_ro';

/**
 * `thread/start` and `turn/start` settings. `permissions` (a profile id) and `sandbox` are mutually exclusive:
 * exactly one of them is present. On `turn/start` the sandbox field is `sandboxPolicy` (an object), not `sandbox`;
 * the adapter maps `sandbox` to it there.
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

/**
 * A folder that may go into the profile as an extra read root (FR-138: Codex's own install folder). Absolute, normalised,
 * and free of anything that could break the inline TOML string or a path: no quotes, backslash escapes are doubled,
 * no control characters. Anything else is `undefined` (left out: the profile only gets narrower).
 */
export function codexReadRoot(p: string | undefined): string | undefined {
  if (!p || /["\u0000-\u001f\u007f]/.test(p)) return undefined;
  const win = /^[A-Za-z]:[\\/]/.test(p);
  const api = win ? path.win32 : path.posix;
  if (!api.isAbsolute(p)) return undefined;
  const n = api.normalize(p);
  return n === api.parse(n).root ? undefined : n; // never a whole drive or /
}

/** The profile as an inline TOML table, for `-c permissions.durbar_ro.filesystem=<this>`. `extraRead`: FR-138 install roots. */
export function codexProfileToml(extraRead: readonly string[] = []): string {
  const extra = extraRead.map(codexReadRoot).filter((r): r is string => !!r).map((r) => [r.replace(/\\/g, '\\\\'), 'read'] as const);
  return `{${[...Object.entries(CODEX_RO_FILESYSTEM), ...extra].map(([k, v]) => `"${k}"="${v}"`).join(',')}}`;
}

/**
 * FR-138: the folder Codex is installed in (it runs its own binary again inside the sandbox, so that folder must be readable).
 * The real path of the located command; its folder, or the parent of a `bin` folder (npm: `.../@openai/codex/bin/codex.js`).
 */
export function codexInstallRoot(located: string, realpath: (p: string) => string): string | undefined {
  try {
    const real = realpath(located);
    const win = /^[A-Za-z]:[\\/]/.test(real);
    const api = win ? path.win32 : path.posix;
    const dir = api.dirname(real);
    return codexReadRoot(api.basename(dir).toLowerCase() === 'bin' ? api.dirname(dir) : dir);
  } catch {
    return undefined;
  }
}

/**
 * FR-162: the file to spawn for the located `codex`: its resolved path. Codex's sandbox helper runs `current_exe()` again,
 * which on macOS is the unresolved link (`/opt/homebrew/bin/codex`); seatbelt canonicalizes read roots, so under the
 * read-limited profile the link is not readable and `execvp` fails with EPERM (openai/codex#41493). The resolved file
 * lies inside the FR-138 install root, so the profile needs no new root. npm: `.../bin/codex.js` (POSIX runs it by its
 * shebang). Windows: only a resolved `.exe` replaces the located path (a `.js` cannot be spawned without a launcher).
 * A path that cannot be resolved stays as located (the install root is then missing, so a limited mode fails closed).
 */
export function codexSpawnPath(located: string, realpath: (p: string) => string, platform: string): string {
  let real: string;
  try {
    real = realpath(located);
  } catch {
    return located;
  }
  if (typeof real !== 'string' || !real || real.includes('\0')) return located;
  if (platform === 'win32') return /\.exe$/i.test(real) ? real : located;
  return real;
}

/**
 * Spawn arguments that define the profile (`codex app-server -c key=value`). An argv array for `spawn` without a
 * shell: each element is one argument, nothing is quoted for a shell.
 */
export function codexProfileArgs(extraRead: readonly string[] = []): string[] {
  // Codex 0.163 refuses to start when a config defines `[permissions]` profiles but no `default_permissions` (real, 2026-10-19).
  // The read-limited profile is the default: fail closed; Allow all sends its own `sandbox` (FR-138).
  return ['-c', `permissions.${CODEX_RO_PROFILE}.filesystem=${codexProfileToml(extraRead)}`, '-c', `default_permissions="${CODEX_RO_PROFILE}"`];
}

/** `initialize` capabilities: `permissions` and `runtimeWorkspaceRoots` are experimental fields. */
export const CODEX_INITIALIZE_CAPABILITIES = Object.freeze({ experimentalApi: true });

/** Normalised absolute root, or undefined when it must be dropped. Windows-form paths use `path.win32`, others `path.posix`. */
function normalizeRoot(r: string): { path: string; key: string } | undefined {
  if (!r || r.includes('\0')) return undefined;
  const win = /^[A-Za-z]:[\\/]/.test(r) || r.startsWith('\\\\');
  if (!win && !r.startsWith('/')) return undefined;
  const api = win ? path.win32 : path.posix;
  let n = api.normalize(r);
  const root = api.parse(n).root;
  if (n === root || n === root.replace(/[\\/]+$/, '') || root === '') return undefined; // a filesystem root or a UNC share root
  n = n.replace(/[\\/]+$/, '');
  if (n.split(/[\\/]/).includes('..')) return undefined;
  return { path: n, key: win ? n.toLowerCase() : n };
}

/**
 * Session folders to `runtimeWorkspaceRoots`: absolute paths only, normalised (`.` and `..` resolved, no trailing
 * separator), duplicates removed (case-insensitively for Windows-form paths), order kept. A root that is a
 * filesystem root (`/`, `C:\`, `\\server\share`) or still holds `..` is dropped: a session root must never make
 * everything readable. Values are JSON params (never argv or TOML), so spaces and `=` need no escaping. A relative
 * or empty entry is dropped, never resolved: fewer roots means fewer readable files.
 *
 * Symlinks: `realpath` is required, so an adapter cannot forget it. The function stays I/O-free because the caller
 * injects it (`fs.realpathSync.native` in the adapter; tests pass a fake, or identity for path-only cases): each root
 * is resolved after normalising, and the
 * filesystem-root rule and the dedupe run on the RESOLVED path, so a root that links to `/` or `C:\` is dropped.
 * If the resolver throws (missing path, no permission) the root is dropped: fail closed. Unlike
 * `permissions.ts` `realOrNearest`, a missing root is not replaced by its nearest ancestor, because a session
 * folder that does not exist is not a folder Codex should be told to read.
 */
export function codexWorkspaceRoots(roots: readonly unknown[] | undefined | null, realpath: (p: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(roots) ? roots : []) {
    if (typeof r !== 'string') continue;
    let n = normalizeRoot(r);
    if (n) {
      try {
        const real = realpath(n.path);
        n = typeof real === 'string' ? normalizeRoot(real) : undefined;
      } catch {
        n = undefined;
      }
    }
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n.path);
  }
  return out;
}

/** The Codex version researched (2026-10-18); older ones are refused because they are unchecked (spec 012 FR-087). Same value as `detect.ts`. */
export const CODEX_MIN_PERMISSIONS_VERSION = `rust-v${CODEX_MIN_VERSION}`;

/**
 * `rust-v0.163.0`, `v0.163.0` or `0.163.0` (optional `-pre`, optional `+build`) to the canonical `x.y.z[-pre]` that
 * `detect.ts` `parseVersion` and `compareVersions` use; undefined when unparseable. The `+build` part is ignored.
 */
function canonicalCodexVersion(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(?:rust-v|v)?(\d{1,9}\.\d{1,9}\.\d{1,9})(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.+-]*)?$/.exec(v.trim());
  return m ? m[1] + (m[2] ?? '') : undefined;
}

export interface CodexReadCheck {
  version?: string;
  /** True when `initialize` accepted `capabilities.experimentalApi`. */
  experimentalApi?: boolean;
  platform?: string;
  /** Windows only: the elevated sandbox is set up (Codex refuses split read restrictions without it). */
  elevatedSandbox?: boolean;
}

export type CodexReadResult = { ok: true } | { ok: false; reason: string; advice: string };

/**
 * Can the `durbar_ro` profile be enforced? Anything unknown is not enforceable (fail closed; spec 012 FR-087).
 * The caller refuses to start Read-only or Ask first when `ok` is false, showing `reason` and `advice` (what to
 * install or upgrade). It offers no fallback: not Allow all, not the plain `read-only` sandbox. The user can still
 * pick another mode through the normal mode switch.
 */
export function codexReadEnforceable(c: CodexReadCheck): CodexReadResult {
  const have = canonicalCodexVersion(c?.version);
  if (!have) return { ok: false, reason: `The Codex version could not be read, so Durbar cannot confirm it can limit reads to the session's folders.`, advice: `Install Codex ${CODEX_MIN_PERMISSIONS_VERSION} or later and restart Durbar.` };
  // One comparison for one version string: the same helper as detect.ts (a pre-release is older than its release).
  if (compareVersions(have, CODEX_MIN_VERSION) < 0) return { ok: false, reason: `This Codex is too old to limit reads to the session's folders.`, advice: `Upgrade Codex to ${CODEX_MIN_PERMISSIONS_VERSION} or later.` };
  if (c.experimentalApi !== true) return { ok: false, reason: `This Codex did not accept the experimental API, which Durbar needs to limit reads to the session's folders.`, advice: `Upgrade Codex to ${CODEX_MIN_PERMISSIONS_VERSION} or later and make sure the app-server accepts the experimental API.` };
  if (typeof c.platform !== 'string' || !c.platform) return { ok: false, reason: 'The platform is unknown, so Durbar cannot confirm Codex can limit reads.', advice: 'Restart Durbar; if it persists, report it.' };
  if (c.platform === 'win32' && c.elevatedSandbox !== true) return { ok: false, reason: `On Windows, Codex needs its elevated sandbox set up to limit reads to the session's folders.`, advice: 'Set up the Codex elevated sandbox on Windows, and use the native codex.exe instead of a .cmd shim.' };
  return { ok: true };
}

/** Server request methods that ask for approval (research.md, "Approvals"). */
export const CODEX_APPROVAL_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'tool/requestUserInput',
  'item/tool/requestUserInput', // the name Codex 0.163 really sends (schema, 2026-10-19); questions go to the question card (FR-146)
] as const;

/** Broker-compatible permission fields (a subset of `PermissionLike`). `kind` is never `read`. */
export interface CodexPermission {
  kind: 'shell' | 'write' | 'url' | 'mcp' | 'custom-tool';
  fullCommandText?: string;
  fileName?: string;
  /** Spec 065: every path of a file change (the write guard keeps a copy of each). */
  paths?: string[];
  url?: string;
  toolName?: string;
  serverName?: string;
  /** Spec 052 FR-172: what a file change would do (unified diff text), from the change's own `fileChange` item. */
  diff?: string;
  /** One line for the needs-permission card. */
  summary: string;
}

/**
 * Spec 052 FR-172: one change of a Codex `fileChange` item. Generated type `FileUpdateChange` (`codex app-server generate-ts`,
 * 0.163.0): `{ path, kind: { type: 'add' } | { type: 'delete' } | { type: 'update', move_path }, diff }`.
 */
export interface CodexFileChange {
  path: string;
  kind: 'add' | 'delete' | 'update';
  movePath?: string;
  diff: string;
}

/**
 * Changes of one item whose diff text is kept, and longest diff text kept per change (characters). Every change's path is kept, however
 * many there are (review on #470): the grant scope and the spec 065 undo guard need all of them; only the card's text is bounded.
 */
const MAX_DIFF_CHANGES = 100;
const MAX_CHANGE_TEXT = 100_000;
/** Display only (the card line and the diff headers): one line, at most 1024 characters. Never used for a path a decision reads. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').slice(0, 1024);

/** FR-172: the changes of a `fileChange` item (`item.changes`), checked field by field; anything malformed is left out. */
export function codexFileChanges(changes: unknown): CodexFileChange[] {
  if (!Array.isArray(changes)) return [];
  const out: CodexFileChange[] = [];
  for (const c of changes) {
    const p = str(c, 'path');
    if (!p) continue;
    const k = own(c, 'kind');
    const t = typeof k === 'string' ? k : str(k, 'type'); // the generated type is an object; a plain word is taken too
    const kind = t === 'add' || t === 'delete' ? t : 'update';
    const move = str(k, 'move_path') ?? str(k, 'movePath');
    // the path as Codex sent it (review on #470): the grant scope and the undo guard read it, so it is never cut or rewritten here
    const diff = out.length < MAX_DIFF_CHANGES ? (str(c, 'diff') ?? '').slice(0, MAX_CHANGE_TEXT) : '';
    out.push({ path: p, kind, ...(move && kind === 'update' ? { movePath: move } : {}), diff });
  }
  return out;
}

/**
 * FR-172: one unified diff for the permission card. `read:` Codex's `diff` is the new file's text for an add, the old text for a
 * delete, and a hunk (`@@ … @@`, no `---`/`+++` header) for an update; a header is added where missing. Cut at `DIFF_MAX`.
 * Display text only: never applied.
 */
export function codexChangeDiff(changes: readonly CodexFileChange[]): string {
  const parts = changes.slice(0, MAX_DIFF_CHANGES).map((c) => {
    const name = oneLine(c.path); // display: a newline in a path cannot add diff lines
    if (c.kind === 'add') return simpleDiff(name, '', c.diff, Infinity); // cut once, below, so the "more lines" count is right
    if (c.kind === 'delete') return simpleDiff(name, c.diff, '', Infinity) || `--- a/${name}\n+++ /dev/null`;
    const d = c.diff.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!d) return '';
    return /^--- /.test(d) ? d : `--- a/${name}\n+++ b/${oneLine(c.movePath ?? c.path)}\n${d}`;
  });
  const text = parts.filter(Boolean).join('\n');
  return text ? clipDiff(text) : '';
}

/** FR-172: the card line's note for the first change: a new file, a deletion or a move (an edit in place needs none). */
function kindNote(c: CodexFileChange | undefined): string {
  if (!c) return '';
  if (c.kind === 'add') return ' (new file)';
  if (c.kind === 'delete') return ' (delete)';
  return c.movePath && c.movePath !== c.path ? ` (move to ${oneLine(c.movePath)})` : '';
}

/** FR-172: what the card says when Codex named no file in the request and no `fileChange` item is known for it. */
export const CODEX_NO_FILE = 'Codex did not say which file';

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
export function codexPermission(method: string, params: unknown, known?: readonly CodexFileChange[]): CodexPermission {
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
      // FR-172 (real, Codex 0.163): the request names only `itemId` (generated type `FileChangeRequestApprovalParams`); the files
      // and the diff are on the `fileChange` item sent before it (`known`). `changes` in the request itself is still read.
      const changes = known?.length ? [...known] : codexFileChanges(own(params, 'changes'));
      const paths = changes.map((c) => c.path);
      const fileName = paths[0] ?? str(params, 'grantRoot');
      const more = paths.length > 1 ? ` (+${paths.length - 1} more)` : '';
      // spec 065's undo guard copies at most WRITE_GUARD_MAX_PATHS files of one write: say so on the card instead of missing files silently
      const undo = paths.length > WRITE_GUARD_MAX_PATHS ? ` (undo keeps copies of the first ${WRITE_GUARD_MAX_PATHS} files only)` : '';
      const diff = codexChangeDiff(changes);
      // the card line is display text (one line, cut); `fileName` and `paths` stay exactly as Codex sent them
      const summary = fileName ? `write ${oneLine(fileName)}${kindNote(changes[0])}${more}${undo}` : `write (${CODEX_NO_FILE})`;
      return { kind: 'write', fileName, ...(paths.length ? { paths } : {}), ...(diff ? { diff } : {}), summary };
    }
    case 'item/permissions/requestApproval':
      return { kind: 'custom-tool', toolName: 'request_permissions', summary: `request_permissions ${str(params, 'reason') ?? ''}`.trim() };
    case 'mcpServer/elicitation/request':
    case 'tool/requestUserInput':
    case 'item/tool/requestUserInput': {
      // Mapped to `mcp` only because it is a non-read kind that asks the user; it is not a claim that an MCP server sent it.
      const serverName = str(params, 'serverName');
      // FR-148 (real, Codex 0.163): a tool-call elicitation names the tool only in its message ("… to run tool \"echo\"?")
      const toolName = str(params, 'toolName') ?? str(params, 'message')?.match(/run tool "([^"]{1,80})"/)?.[1];
      // FR-148: an elicitation's own question (for example "Allow the echo tool to run?"), cut to one short line
      const message = str(params, 'message')?.replace(/\s+/g, ' ').slice(0, 160);
      return { kind: 'mcp', serverName, toolName, summary: `mcp ${serverName ? serverName + ' › ' : ''}${toolName ?? message ?? ''}`.trim() };
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
