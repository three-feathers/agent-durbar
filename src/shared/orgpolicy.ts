/**
 * Spec 076 section O (FR-198..FR-207, issue #602): what an agent app's OWN organization policy blocks, in one vendor-neutral shape.
 * The adapters read and parse their app's machine policy file (`src/adapters/<app>OrgPolicy.ts`); main, the window and the tests only
 * see this shape and ask it questions. No imports, no I/O: pure, so it can be tested on fixtures and loaded anywhere.
 *
 * Policy files are hostile input (FR-201): readers use `ownValue` / `ownStrings` / `ownMcpRules` (own properties of plain objects only,
 * capped, all or nothing), and a bad value reads as the strictest state of its key, with a "could not be read" reason. Nothing here keeps
 * a value of the file except what the questions need (rule strings), and nothing here logs.
 */

export type OrgMode = 'read-only' | 'ask' | 'allow';
export const ORG_MODES: readonly OrgMode[] = ['read-only', 'ask', 'allow'];

/** How a thing is blocked: by a rule (`blocked`) or because the value that governs it could not be read (`doubt`, strictest reading). */
export type OrgMark = 'blocked' | 'doubt';

/** One MCP server rule: exactly one of a name, a command with its arguments, or a URL pattern with `*` wildcards. */
export interface OrgMcpRule {
  name?: string;
  command?: string[];
  url?: string;
}

export interface OrgPolicy {
  /** The agent app's name for the reason text ("Claude Code"). */
  app: string;
  /** A policy file was found and applies. */
  found: boolean;
  /** A file was found but could not be read at all: the whole policy reads as its strictest state. */
  unreadable: boolean;
  /** The files read (paths only, never their contents). */
  paths: string[];
  /** What was wrong, by path and kind ("too large", "not a JSON object", "unreadable key allowedMcpServers"); never a value. */
  problems: string[];
  modes: Partial<Record<OrgMode, OrgMark>>;
  /** Models: an allow-list (undefined = every model), a deny-list, and how ids in the allow-list match. */
  models: { allow?: string[]; deny: string[]; exact: boolean; denyAll?: OrgMark; doubt?: boolean };
  /** MCP servers: an allow-list (undefined = every server), a deny-list; built-in servers skip the allow-list, and the deny-list too when `builtinSkipsDeny`. */
  mcp: { allow?: OrgMcpRule[]; deny: OrgMcpRule[]; denyAll?: OrgMark; doubt?: boolean; builtinSkipsDeny: boolean };
  /** MCP tool deny rules in Claude Code's `mcp__<server>__<tool>` form (with `*` wildcards). */
  tools: { deny: string[]; denyAll?: OrgMark; doubt?: boolean };
}

/** Limits on what is read from a policy file (FR-201). */
export const ORG_LIMITS = Object.freeze({ fileBytes: 256 * 1024, listItems: 256, itemChars: 512, commandParts: 64, files: 32 });

export function emptyOrgPolicy(app: string, builtinSkipsDeny = false): OrgPolicy {
  return { app, found: false, unreadable: false, paths: [], problems: [], modes: {}, models: { deny: [], exact: false }, mcp: { deny: [], builtinSkipsDeny }, tools: { deny: [] } };
}

/** FR-201: a policy file that exists but cannot be read is the app's strictest state. `allModes`: Codex's every mode can be refused by its policy. */
export function strictestOrgPolicy(app: string, paths: string[], problems: string[], allModes = false, builtinSkipsDeny = false): OrgPolicy {
  const p = emptyOrgPolicy(app, builtinSkipsDeny);
  p.found = true;
  p.unreadable = true;
  p.paths = [...paths];
  p.problems = [...problems];
  for (const m of allModes ? ORG_MODES : (['allow'] as const)) p.modes[m] = 'doubt';
  p.models.denyAll = 'doubt';
  p.mcp.denyAll = 'doubt';
  p.tools.denyAll = 'doubt';
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hostile-input helpers (FR-201): own properties of plain objects, capped lists, all or nothing.

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The own value of `key` (never an inherited one, never `__proto__` magic); undefined when absent or `o` is not a plain object. */
export function ownValue(o: unknown, key: string): unknown {
  return isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

export const hasOwn = (o: unknown, key: string): boolean => isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, key);

/** A list of non-empty strings within the limits, copied; `null` when the value is anything else (one bad item spoils the list). */
export function ownStrings(v: unknown, maxItems: number = ORG_LIMITS.listItems): string[] | null {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const x: unknown = v[i];
    if (typeof x !== 'string' || !x || x.length > ORG_LIMITS.itemChars) return null;
    out.push(x);
  }
  return out;
}

/** A list of MCP server rules (`serverName` | `serverCommand` | `serverUrl`, exactly one each); `null` when anything is off. */
export function ownMcpRules(v: unknown): OrgMcpRule[] | null {
  if (!Array.isArray(v) || v.length > ORG_LIMITS.listItems) return null;
  const out: OrgMcpRule[] = [];
  for (let i = 0; i < v.length; i++) {
    const e: unknown = v[i];
    if (!isPlainObject(e)) return null;
    const keys = Object.keys(e);
    if (keys.length !== 1) return null;
    const k = keys[0];
    const val = e[k];
    if (k === 'serverName' && typeof val === 'string' && val && val.length <= ORG_LIMITS.itemChars) out.push({ name: val });
    else if (k === 'serverUrl' && typeof val === 'string' && val && val.length <= ORG_LIMITS.itemChars) out.push({ url: val });
    else if (k === 'serverCommand') {
      const c = ownStrings(val, ORG_LIMITS.commandParts);
      if (!c || !c.length) return null;
      out.push({ command: c });
    } else return null;
  }
  return out;
}

/** Intersection of two allow-lists (FR-200: Durbar's stricter reading for several files); undefined means "no list". */
export function intersectRules<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a) return b && [...b];
  if (!b) return [...a];
  const keys = new Set(b.map((x) => JSON.stringify(x)));
  return a.filter((x) => keys.has(JSON.stringify(x)));
}

/** Fold `b` into `a` (several files of one app): locks and doubts add up, deny-lists join, allow-lists intersect. */
export function mergeOrgPolicy(a: OrgPolicy, b: OrgPolicy): OrgPolicy {
  const worst = (x?: OrgMark, y?: OrgMark): OrgMark | undefined => (x === 'doubt' || y === 'doubt' ? 'doubt' : x ?? y);
  const modes: OrgPolicy['modes'] = {};
  for (const m of ORG_MODES) {
    const w = worst(a.modes[m], b.modes[m]);
    if (w) modes[m] = w;
  }
  return {
    app: a.app,
    found: a.found || b.found,
    unreadable: a.unreadable || b.unreadable,
    paths: [...a.paths, ...b.paths],
    problems: [...a.problems, ...b.problems],
    modes,
    models: { allow: intersectRules(a.models.allow, b.models.allow), deny: [...a.models.deny, ...b.models.deny], exact: a.models.exact || b.models.exact, denyAll: worst(a.models.denyAll, b.models.denyAll), doubt: !!(a.models.doubt || b.models.doubt) },
    mcp: { allow: intersectRules(a.mcp.allow, b.mcp.allow), deny: [...a.mcp.deny, ...b.mcp.deny], denyAll: worst(a.mcp.denyAll, b.mcp.denyAll), doubt: !!(a.mcp.doubt || b.mcp.doubt), builtinSkipsDeny: a.mcp.builtinSkipsDeny && b.mcp.builtinSkipsDeny },
    tools: { deny: [...a.tools.deny, ...b.tools.deny], denyAll: worst(a.tools.denyAll, b.tools.denyAll), doubt: !!(a.tools.doubt || b.tools.doubt) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reasons (FR-202): the same words in the window, in main's refusals and in the tests.

export const orgBlockedText = (app: string): string => `Blocked by your organization's ${app} policy`;
export const orgDoubtText = (app: string): string => `Your organization's ${app} policy could not be read; treated as blocked`;
const reason = (p: OrgPolicy, mark: OrgMark | undefined): string | undefined => (mark ? (mark === 'doubt' ? orgDoubtText(p.app) : orgBlockedText(p.app)) : undefined);

export function modeBlocked(p: OrgPolicy | undefined, mode: string): string | undefined {
  if (!p || !p.found) return undefined;
  return (ORG_MODES as readonly string[]).includes(mode) ? reason(p, p.modes[mode as OrgMode]) : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Models (FR-200, Claude Code's documented matching, read 2026-10-23).

const DEFAULT_MODELS = new Set(['', 'auto', 'default']);
const FAMILIES = new Set(['opus', 'sonnet', 'haiku']);
const IGNORED_ENTRIES = new Set(['best', 'opusplan', 'default']);
const SEP = (c: string | undefined): boolean => c === undefined || c === '.' || c === ':' || c === '/' || c === '@' || c === '[';

/** The family of a model id (`claude-opus-4-1` -> `opus`), from its `-`/`.` separated parts. */
function familyOf(id: string): string | undefined {
  for (const part of id.toLowerCase().split(/[-.:@/[\]]/)) if (FAMILIES.has(part)) return part;
  return undefined;
}

/**
 * Does `entry` (a model id from a policy) cover `id`? `entry` must start `id` at a segment boundary (a provider prefix such as
 * `us.anthropic.` may come before it). After it: the end, a provider suffix (`@`, `:`), or - unless `exact` - any `-...` extension;
 * with `exact`, only a dated id (`-YYYYMMDD`). One `indexOf` loop, no regular expression from the file.
 */
function idCovers(entry: string, id: string, exact: boolean): boolean {
  const e = entry.toLowerCase();
  const s = id.toLowerCase();
  for (let i = s.indexOf(e); i >= 0; i = s.indexOf(e, i + 1)) {
    if (i > 0 && !SEP(s[i - 1])) continue;
    const rest = s.slice(i + e.length);
    if (rest === '' || rest[0] === '@' || rest[0] === ':' || rest[0] === '[') return true;
    if (rest[0] !== '-') continue;
    if (!exact) return true;
    const tail = rest.slice(1);
    if (tail.length >= 8 && /^\d{8}$/.test(tail.slice(0, 8)) && (tail.length === 8 || SEP(tail[8]))) return true;
  }
  return false;
}

function modelMatches(entry: string, id: string, exact: boolean): boolean {
  const e = entry.toLowerCase();
  if (IGNORED_ENTRIES.has(e)) return false;
  if (FAMILIES.has(e)) return familyOf(id) === e;
  return idCovers(e, id, exact);
}

export function modelBlocked(p: OrgPolicy | undefined, id: string | undefined): string | undefined {
  if (!p || !p.found) return undefined;
  const m = (id ?? '').trim();
  if (DEFAULT_MODELS.has(m.toLowerCase())) return undefined; // the Default / Auto choice is never greyed (FR-200)
  if (p.models.denyAll) return reason(p, p.models.denyAll);
  if (p.models.deny.some((e) => modelMatches(e, m, false))) return reason(p, 'blocked');
  if (p.models.allow && !p.models.allow.some((e) => modelMatches(e, m, p.models.exact))) return reason(p, p.models.doubt ? 'doubt' : 'blocked');
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// MCP servers (FR-200; URL canonicalization as GitHub documents it, read 2026-10-23).

/** What Durbar knows of a server: always its name; its command and arguments or its URL when Durbar has its definition. */
export interface OrgMcpServer {
  name: string;
  command?: string;
  args?: readonly string[];
  url?: string;
  builtin?: boolean;
}

/** `*` matches any run of characters (including none); one greedy pass with backtracking to the last star only (linear-ish, capped input). */
export function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** Split a URL or URL pattern into a canonical scheme, authority and path (lower-case scheme and host, default port and fragment and a trailing host dot dropped). */
export function urlParts(u: string): { scheme: string; authority: string; path: string } | undefined {
  const i = u.indexOf('://');
  if (i <= 0) return undefined;
  const scheme = u.slice(0, i).toLowerCase();
  let rest = u.slice(i + 3);
  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  const slash = rest.search(/[/?]/);
  let authority = (slash >= 0 ? rest.slice(0, slash) : rest).toLowerCase();
  const path = slash >= 0 ? (rest[slash] === '?' ? '/' + rest.slice(slash) : rest.slice(slash)) : '/';
  if (authority.includes('@')) authority = authority.slice(authority.lastIndexOf('@') + 1); // never match on credentials
  if ((scheme === 'https' && authority.endsWith(':443')) || (scheme === 'http' && authority.endsWith(':80'))) authority = authority.slice(0, authority.lastIndexOf(':'));
  const colon = authority.lastIndexOf(':');
  const host = colon > authority.lastIndexOf(']') ? authority.slice(0, colon) : authority;
  if (host.endsWith('.')) authority = host.slice(0, -1) + authority.slice(host.length);
  return authority ? { scheme, authority, path } : undefined;
}

/** A server URL against a pattern: the scheme exactly, the authority with `*` (never across `/`, since it has none), the path with `*`. */
export function urlMatches(pattern: string, url: string): boolean {
  const p = urlParts(pattern);
  let canon = url;
  try {
    canon = new URL(url).href; // punycode and percent-decoded host octets, as the vendors canonicalize
  } catch {
    return false;
  }
  const u = urlParts(canon);
  if (!p || !u || p.scheme !== u.scheme) return false;
  return globMatch(p.authority, u.authority) && globMatch(p.path, u.path);
}

function ruleMatches(r: OrgMcpRule, s: OrgMcpServer): boolean | undefined {
  if (r.name !== undefined) return r.name === s.name;
  if (r.command) {
    if (s.command === undefined) return s.url !== undefined ? false : undefined; // a remote server is never a command rule; unknown otherwise
    const full = [s.command, ...(s.args ?? [])];
    return full.length === r.command.length && full.every((x, i) => x === r.command![i]);
  }
  if (r.url !== undefined) {
    if (s.url === undefined) return s.command !== undefined ? false : undefined;
    return urlMatches(r.url, s.url);
  }
  return false;
}

export function mcpBlocked(p: OrgPolicy | undefined, s: OrgMcpServer): string | undefined {
  if (!p || !p.found) return undefined;
  const skipsDeny = !!s.builtin && p.mcp.builtinSkipsDeny;
  if (p.mcp.denyAll && !s.builtin) return reason(p, p.mcp.denyAll);
  if (!skipsDeny && p.mcp.deny.some((r) => ruleMatches(r, s) === true)) return reason(p, 'blocked');
  if (p.mcp.allow && !s.builtin) {
    const results = p.mcp.allow.map((r) => ruleMatches(r, s));
    if (results.includes(true)) return undefined;
    // FR-200: blocked only when every rule could be checked; a rule Durbar cannot check leaves the row as it is (the app reports the truth)
    if (!results.includes(undefined)) return reason(p, p.mcp.doubt ? 'doubt' : 'blocked');
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// MCP tools (FR-200: Claude Code's `permissions.deny` rules for MCP tools).

/** Claude Code's server segment: characters other than letters, digits, `_` and `-` read as `_`. */
export const claudeServerSegment = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_');

export function toolBlocked(p: OrgPolicy | undefined, server: string, tool: string): string | undefined {
  if (!p || !p.found) return undefined;
  if (p.tools.denyAll) return reason(p, p.tools.denyAll);
  const seg = claudeServerSegment(server);
  const full = `mcp__${seg}__${tool}`;
  for (const r of p.tools.deny) {
    if (r === `mcp__${seg}` || globMatch(r, full)) return reason(p, 'blocked');
  }
  return undefined;
}

/** Keep only the deny rules that can name an MCP tool (`*`, `mcp__...`), without parentheses (Claude Code skips those in settings files). */
export const mcpToolRules = (rules: readonly string[]): string[] => rules.filter((r) => !r.includes('(') && (r === '*' || r.startsWith('mcp__')));

// ---------------------------------------------------------------------------------------------------------------------------------
// FR-207: what the window and the Organization page get (no values of the files).

export interface OrgPolicyAppView {
  app: string;
  found: boolean;
  unreadable: boolean;
  paths: string[];
  problems: string[];
  /** Blocked modes and their reasons. */
  modes: Partial<Record<OrgMode, string>>;
  counts: { modelAllow: number | null; modelDeny: number; mcpAllow: number | null; mcpDeny: number; toolDeny: number };
}

export function orgPolicyView(p: OrgPolicy): OrgPolicyAppView {
  const modes: OrgPolicyAppView['modes'] = {};
  for (const m of ORG_MODES) {
    const r = modeBlocked(p, m);
    if (r) modes[m] = r;
  }
  return {
    app: p.app,
    found: p.found,
    unreadable: p.unreadable,
    paths: [...p.paths],
    problems: [...p.problems],
    modes,
    counts: { modelAllow: p.models.allow ? p.models.allow.length : null, modelDeny: p.models.deny.length, mcpAllow: p.mcp.allow ? p.mcp.allow.length : null, mcpDeny: p.mcp.deny.length, toolDeny: p.tools.deny.length },
  };
}
