/**
 * Strict allow-lists for the ids that cross the IPC boundary for Previous sessions (spec 006 FR-026, FR-029). A session id may end
 * up inside a path in the runtime (`deleteSession(id)`), so nothing but letters, digits, `_` and `-` is accepted: no `/`, `\`, `.`
 * (so no `..`), `:` (so no drive letters), NUL or other control characters, and at most 100 characters. Pure: no I/O.
 */

const ID_BODY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** One rule per agent app, so a tighter shape can be set for one without touching the others. Copilot, Claude Code and Codex all use UUIDs today. */
const SESSION_ID_BY_ADAPTER: Readonly<Record<string, RegExp>> = { copilot: ID_BODY, claude: ID_BODY, codex: ID_BODY };

/** True when `id` is a well-formed session id for the adapter (any other adapter gets the same strict shape). */
export function sessionIdOk(adapterId: string | undefined, id: unknown): id is string {
  return typeof id === 'string' && (SESSION_ID_BY_ADAPTER[adapterId ?? ''] ?? ID_BODY).test(id);
}

/** The opaque key of a VS Code chat: `<storage hash>/<session id>`, exactly one `/`. */
const VSCHAT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** True when `key` is a well-formed VS Code chat key. */
export function vsChatKeyOk(key: unknown): key is string {
  return typeof key === 'string' && VSCHAT_KEY.test(key);
}

/** The `src` of a pin or hide entry: an adapter id or `vscode`. Same shape rule as `adapterId` in the folder store. */
export function markSrcOk(src: unknown): src is string {
  return typeof src === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(src);
}

/** A pin or hide entry id: the VS Code key for `vscode`, else the adapter's session id. */
export function markIdOk(src: unknown, id: unknown): id is string {
  return markSrcOk(src) && (src === 'vscode' ? vsChatKeyOk(id) : sessionIdOk(src, id));
}
