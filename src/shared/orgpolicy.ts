/**
 * Spec 076 section O (FR-198..FR-207, issue 602): what an agent app's OWN organization policy blocks, in one vendor-neutral shape.
 * The adapters read their app's policy (`src/adapters/<app>OrgPolicy.ts`, Copilot through its runtime first); main, the window and the
 * tests only see this shape and ask it questions. No imports, no I/O: pure, so it can be tested on fixtures and loaded anywhere.
 *
 * FR-201 (review on PR 644): each key is read the way its VENDOR documents it, including the vendor's own fallback for a bad value (an
 * invalid allow-list that the vendor enforces as empty is `blocked`; an invalid deny-list the vendor drops blocks nothing; a bad entry the
 * vendor strips is stripped). Where Durbar cannot know the vendor's reading, the mark is `doubt`: shown as advice, never refused. A
 * policy the app itself refuses to start with is `fatal`. Policy files are hostile input: own properties of plain objects, capped.
 */

export type OrgMode = 'read-only' | 'ask' | 'allow';
export const ORG_MODES: readonly OrgMode[] = ['read-only', 'ask', 'allow'];

/**
 * `blocked`: a rule of the policy blocks it (refused in main, disabled in the window). `fatal`: the agent app does not start with this
 * policy at all (refused). `doubt`: Durbar could not read the policy the way the vendor does; shown as advice, never refused.
 */
export type OrgMark = 'blocked' | 'fatal' | 'doubt';

/** One MCP server rule: exactly one of a name, a command with its arguments, or a URL pattern with `*` wildcards. */
export interface OrgMcpRule {
  name?: string;
  command?: string[];
  url?: string;
}

export interface OrgPolicy {
  /** The agent app's name for the reason text ("Claude Code"). */
  app: string;
  /** A policy applies (a file was found, or the runtime reported managed settings). */
  found: boolean;
  /** Something of it could not be read (a problem says what). */
  unreadable: boolean;
  /** Where it came from: file paths, or the runtime (never the contents). */
  paths: string[];
  /** What was wrong, by path and kind ("not valid JSON", "unreadable key allowedMcpServers"); never a value. */
  problems: string[];
  modes: Partial<Record<OrgMode, OrgMark>>;
  /**
   * Spec 044 FR-183: this comes from the fallback file because the app's runtime, which merges every channel, did not answer: 'failed' (it failed, was late or
   * gave nothing readable) or 'none' (no runtime yet). Fine with a person there; a raised mode nobody is watching does not run on it.
   */
  runtimeUnread?: 'failed' | 'none';
  /** Models: an allow-list (undefined = every model), a deny-list, how allow-list ids match, and a mark for every non-default model. */
  models: { allow?: string[]; deny: string[]; exact: boolean; all?: OrgMark };
  /**
   * MCP servers: an allow-list (undefined = every server) whose misses get `allowMark` (`doubt` when entries Durbar could not read were
   * dropped), a deny-list whose matches get `denyMark` (`doubt` when a team file may replace it), a mark for every server; built-in servers skip the allow-list, and the deny-list too when `builtinSkipsDeny`.
   */
  mcp: { allow?: OrgMcpRule[]; allowMark?: 'blocked' | 'doubt'; deny: OrgMcpRule[]; denyMark?: 'blocked' | 'doubt'; all?: OrgMark; builtinSkipsDeny: boolean };
  /** MCP tool deny rules in Claude Code's `mcp__<server>__<tool>` form (with `*` wildcards), and a mark for every tool. */
  tools: { deny: string[]; all?: OrgMark };
}

/** A question's answer: the words to show, and whether main refuses it (`blocked`, `fatal`) or only shows it (`doubt`). */
export interface OrgVerdict {
  why: string;
  refuse: boolean;
}

/**
 * Limits on what is read (FR-201, review on PR 644 item 3). Over a limit Durbar cannot read the key as the vendor does: `doubt`, never a
 * refusal, and never read as permissive without saying so. Counts: `listItems`, `files`, `commandParts`, `depth`; bytes: `fileBytes` per
 * file, `totalFileBytes` over all files of one app, `itemChars` per item, `listChars` per list, `ruleChars` over all rules. Every
 * pass over them is linear (a Set of keys, never a pairwise scan), so the work is bounded by the caps.
 */
export const ORG_LIMITS = Object.freeze({ fileBytes: 1024 * 1024, listItems: 4096, itemChars: 2048, commandParts: 256, files: 64, depth: 32, ruleChars: 64 * 1024, memo: 4096, listChars: 256 * 1024, totalFileBytes: 4 * 1024 * 1024 });

/**
 * FR-201 (review on PR 644): the whole policy's rules are bounded, not only each one. Past `ruleChars` characters of model, server and
 * tool rules in total, Durbar does not check them one by one (a verdict could cost a lot of CPU on every repaint of the MCP list): they are
 * dropped and those areas become advice. Each reader calls this on its result.
 */
export function boundOrgPolicy(p: OrgPolicy): OrgPolicy {
  const len = (r: OrgMcpRule): number => (r.name?.length ?? 0) + (r.url?.length ?? 0) + (r.command ?? []).reduce((n, x) => n + x.length + 1, 0);
  const total = (p.models.allow ?? []).reduce((n, x) => n + x.length, 0) + p.models.deny.reduce((n, x) => n + x.length, 0) + (p.mcp.allow ?? []).reduce((n, r) => n + len(r), 0) + p.mcp.deny.reduce((n, r) => n + len(r), 0) + p.tools.deny.reduce((n, x) => n + x.length, 0);
  if (total <= ORG_LIMITS.ruleChars) return p;
  const doubt = (m: OrgMark | undefined): OrgMark => (m === 'fatal' ? 'fatal' : 'doubt');
  p.models = { deny: [], exact: p.models.exact, all: doubt(p.models.all) };
  p.mcp = { deny: [], all: doubt(p.mcp.all), builtinSkipsDeny: p.mcp.builtinSkipsDeny };
  p.tools = { deny: [], all: doubt(p.tools.all) };
  p.problems.push(`its rules are longer in total than Agent Durbar checks (${ORG_LIMITS.ruleChars} characters)`);
  p.unreadable = true;
  return p;
}

/** How many server and tool verdicts were worked out (not answered from the memo); for the tests. */
export const orgVerdictStats = { evaluations: 0 };
/** Verdicts per policy read: a new read is a new object, so the memo never outlives the policy it was made for. */
const memo = new WeakMap<object, Map<string, OrgVerdict | null>>();
function memoized(p: OrgPolicy, key: string, work: () => OrgVerdict | undefined): OrgVerdict | undefined {
  let m = memo.get(p);
  if (!m) memo.set(p, (m = new Map()));
  if (m.has(key)) return m.get(key) ?? undefined;
  orgVerdictStats.evaluations++;
  const v = work();
  if (m.size < ORG_LIMITS.memo) m.set(key, v ?? null);
  return v;
}

export function emptyOrgPolicy(app: string, builtinSkipsDeny = false): OrgPolicy {
  return { app, found: false, unreadable: false, paths: [], problems: [], modes: {}, models: { deny: [], exact: false }, mcp: { deny: [], builtinSkipsDeny }, tools: { deny: [] } };
}

/** A whole policy that cannot be used: `fatal` when the app refuses to start with it, `doubt` when Durbar only could not read it. */
export function wholeOrgPolicy(app: string, paths: string[], problems: string[], mark: 'fatal' | 'doubt', builtinSkipsDeny = false): OrgPolicy {
  const p = emptyOrgPolicy(app, builtinSkipsDeny);
  p.found = true;
  p.unreadable = true;
  p.paths = [...paths];
  p.problems = [...problems];
  for (const m of ORG_MODES) p.modes[m] = mark;
  p.models.all = mark;
  p.mcp.all = mark;
  p.tools.all = mark;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hostile-input helpers (FR-201): own properties of plain objects, capped lists.

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The own value of `key` (never an inherited one, never `__proto__` magic); undefined when absent or `o` is not a plain object. */
export function ownValue(o: unknown, key: string): unknown {
  return isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

export const hasOwn = (o: unknown, key: string): boolean => isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, key);

/** A list read the vendor's way: `null` when it is not an array; `tooLong` when over Durbar's limits; otherwise the good items and how many were stripped. */
export type OrgList<T> = null | { tooLong: true } | { tooLong?: false; items: T[]; stripped: number };

/** Non-empty strings; any other item is stripped (Claude Code strips a non-string entry and enforces the rest). Linear: a Set removes duplicates. */
export function ownStrings(v: unknown, maxItems: number = ORG_LIMITS.listItems): OrgList<string> {
  if (!Array.isArray(v)) return null;
  if (v.length > maxItems) return { tooLong: true };
  const items: string[] = [];
  const seen = new Set<string>();
  let stripped = 0;
  let chars = 0;
  for (let i = 0; i < v.length; i++) {
    const x: unknown = v[i];
    if (typeof x === 'string') {
      if (x.length > ORG_LIMITS.itemChars) return { tooLong: true };
      chars += x.length;
      if (chars > ORG_LIMITS.listChars) return { tooLong: true };
    }
    if (typeof x !== 'string' || !x) stripped++;
    else if (!seen.has(x)) {
      seen.add(x);
      items.push(x);
    }
  }
  return { items, stripped };
}

/** MCP server rules (`serverName` | `serverCommand` | `serverUrl`, exactly one each); a bad entry is stripped, as the vendors do. Linear, like `ownStrings`. */
export function ownMcpRules(v: unknown): OrgList<OrgMcpRule> {
  if (!Array.isArray(v)) return null;
  if (v.length > ORG_LIMITS.listItems) return { tooLong: true };
  const items: OrgMcpRule[] = [];
  const seen = new Set<string>();
  let stripped = 0;
  let chars = 0;
  for (let i = 0; i < v.length; i++) {
    const e: unknown = v[i];
    const keys = isPlainObject(e) ? Object.keys(e) : [];
    const k = keys.length === 1 ? keys[0] : '';
    const val = k ? (e as Record<string, unknown>)[k] : undefined;
    if (typeof val === 'string') {
      if (val.length > ORG_LIMITS.itemChars) return { tooLong: true };
      chars += val.length;
    } else if (Array.isArray(val) && val.length <= ORG_LIMITS.commandParts) {
      for (const x of val) if (typeof x === 'string') chars += x.length;
    }
    if (chars > ORG_LIMITS.listChars) return { tooLong: true };
    let rule: OrgMcpRule | undefined;
    let key = '';
    if (k === 'serverName' && typeof val === 'string' && val) (rule = { name: val }), (key = 'n\0' + val);
    else if (k === 'serverUrl' && typeof val === 'string' && val) (rule = { url: val }), (key = 'u\0' + val);
    else if (k === 'serverCommand' && Array.isArray(val) && val.length > 0 && val.length <= ORG_LIMITS.commandParts && val.every((x) => typeof x === 'string' && x.length <= ORG_LIMITS.itemChars)) (rule = { command: [...(val as string[])] }), (key = 'c\0' + JSON.stringify(val));
    if (!rule) stripped++;
    else if (!seen.has(key)) {
      seen.add(key);
      items.push(rule);
    }
  }
  return { items, stripped };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reasons (FR-202): the same words in the window, in main's refusals and in the tests.

export const orgBlockedText = (app: string): string => `Blocked by your organization's ${app} policy`;
export const orgFatalText = (app: string): string => `${app} will not start: your organization's ${app} policy file could not be read`;
export const orgDoubtText = (app: string): string => `Your organization's ${app} policy may block this (Agent Durbar could not read all of it)`;
export function verdictOf(p: OrgPolicy, mark: OrgMark | undefined): OrgVerdict | undefined {
  if (!mark) return undefined;
  return { why: mark === 'doubt' ? orgDoubtText(p.app) : mark === 'fatal' ? orgFatalText(p.app) : orgBlockedText(p.app), refuse: mark !== 'doubt' };
}

export function modeVerdict(p: OrgPolicy | undefined, mode: string): OrgVerdict | undefined {
  if (!p || !p.found) return undefined;
  return (ORG_MODES as readonly string[]).includes(mode) ? verdictOf(p, p.modes[mode as OrgMode]) : undefined;
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

export function modelVerdict(p: OrgPolicy | undefined, id: string | undefined): OrgVerdict | undefined {
  if (!p || !p.found) return undefined;
  const m = (id ?? '').trim();
  if (DEFAULT_MODELS.has(m.toLowerCase())) return undefined; // the Default / Auto choice is never greyed (FR-200)
  if (p.models.all) return verdictOf(p, p.models.all);
  if (p.models.deny.some((e) => modelMatches(e, m, false))) return verdictOf(p, 'blocked');
  if (p.models.allow && !p.models.allow.some((e) => modelMatches(e, m, p.models.exact))) return verdictOf(p, 'blocked');
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

/** `*` matches any run of characters (including none), and with `anyChar` `?` matches one; one greedy pass with backtracking to the last star only (linear-ish, capped input). */
export function globMatch(pattern: string, text: string, anyChar = false): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === text[t] || (anyChar && pattern[p] === '?'))) {
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

export function mcpVerdict(p: OrgPolicy | undefined, s: OrgMcpServer): OrgVerdict | undefined {
  if (!p || !p.found) return undefined;
  return memoized(p, 'mcp\0' + JSON.stringify([s.name, s.command ?? null, s.args ?? null, s.url ?? null, !!s.builtin]), () => mcpWork(p, s));
}

function mcpWork(p: OrgPolicy, s: OrgMcpServer): OrgVerdict | undefined {
  const skipsDeny = !!s.builtin && p.mcp.builtinSkipsDeny;
  if (p.mcp.all && (p.mcp.all === 'fatal' || !s.builtin)) return verdictOf(p, p.mcp.all);
  if (!skipsDeny && p.mcp.deny.some((r) => ruleMatches(r, s) === true)) return verdictOf(p, p.mcp.denyMark ?? 'blocked');
  if (p.mcp.allow && !s.builtin) {
    const results = p.mcp.allow.map((r) => ruleMatches(r, s));
    if (results.includes(true)) return undefined;
    // FR-200: refused only when every rule could be checked; a rule Durbar cannot check is advice (the running app reports the truth)
    return verdictOf(p, results.includes(undefined) ? 'doubt' : (p.mcp.allowMark ?? 'blocked'));
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// MCP tools (FR-200: Claude Code's `permissions.deny` rules for MCP tools).

/** Claude Code's server segment: characters other than letters, digits, `_` and `-` read as `_`. */
export const claudeServerSegment = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_');

export function toolVerdict(p: OrgPolicy | undefined, server: string, tool: string): OrgVerdict | undefined {
  if (!p || !p.found) return undefined;
  return memoized(p, 'tool\0' + JSON.stringify([server, tool]), () => toolWork(p, server, tool));
}

function toolWork(p: OrgPolicy, server: string, tool: string): OrgVerdict | undefined {
  if (p.tools.all) return verdictOf(p, p.tools.all);
  const seg = claudeServerSegment(server);
  const full = `mcp__${seg}__${tool}`;
  for (const r of p.tools.deny) {
    if (r === `mcp__${seg}` || globMatch(r, full)) return verdictOf(p, 'blocked');
  }
  return undefined;
}

/** Keep only the deny rules that can name an MCP tool (`*`, `mcp__...`), without parentheses (Claude Code skips those in settings files). */
export const mcpToolRules = (rules: readonly string[]): string[] => rules.filter((r) => !r.includes('(') && (r === '*' || r.startsWith('mcp__')));

// ---------------------------------------------------------------------------------------------------------------------------------
// FR-207: what the window and the Organization page get (no values of the policy).

export interface OrgPolicyAppView {
  app: string;
  found: boolean;
  unreadable: boolean;
  /** Where it came from (file paths, or "Copilot runtime"); never contents. */
  paths: string[];
  /** Problems by path and kind; never a value. */
  problems: string[];
  /** Per mode: the words, and whether it is refused (blocked) or only advice (doubt). */
  modes: Partial<Record<OrgMode, OrgVerdict>>;
  counts: { modelAllow: number | null; modelDeny: number; mcpAllow: number | null; mcpDeny: number; toolDeny: number };
}

export function orgPolicyView(p: OrgPolicy): OrgPolicyAppView {
  const modes: OrgPolicyAppView['modes'] = {};
  for (const m of ORG_MODES) {
    const r = modeVerdict(p, m);
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
