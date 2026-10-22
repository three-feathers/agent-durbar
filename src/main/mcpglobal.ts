/**
 * Spec 069: the agent apps' own user-level MCP lists ("global"), read and edited as text. Pure: no Electron and no file access, so
 * every format is unit-tested with fixtures (`scripts/test-mcp-global.ts`). File access, backups and the confirm token are in
 * `mcpglobalio.ts`; IPC in `ipc/mcpglobal.ts`.
 *
 *  - Copilot CLI: `<copilot dir>/mcp-config.json`, top-level `mcpServers` (JSON).
 *  - Claude Code: `<CLAUDE_CONFIG_DIR or home>/.claude.json`, top-level `mcpServers` (JSON, user scope).
 *  - Codex: `<CODEX_HOME or ~/.codex>/config.toml`, `[mcp_servers.<name>]` tables (minimal line edit, every other byte kept).
 *
 * Secret values (env and header values) never leave main: views carry key names only, previews carry masked entries (FR-002, FR-004).
 */
import { createHash } from 'crypto';
import * as path from 'path';
import { NAME_RE } from '../shared/mcp';
import { maskSecretArgs, maskSecretCommand, maskSecretUrl } from '../shared/redact';
import { copilotDir } from './mcpfiles';
import { stripTomlComment as stripComment, tomlStringArray, tomlUnquote as unq } from './codextoml';
import type { McpServerInput, McpServerSpec } from '../shared/mcp';
import type { GlobalApp, GlobalEntryView, GlobalSecretMode, McpSourceTag } from '../shared/api';

export const GLOBAL_APPS: readonly GlobalApp[] = ['copilot', 'claude', 'codex'];
export const APP_LABEL: Record<GlobalApp, string> = { copilot: 'Copilot CLI', claude: 'Claude Code', codex: 'Codex' };
export const MASK = '••••••';
const MAX_SERVERS = 200;

export interface GlobalFile {
  app: GlobalApp;
  file: string;
  /** Shown in the window: `~/…` under the home folder, else the full path (no user name when under home). */
  label: string;
}

const tilde = (file: string, home: string): string => {
  const rel = path.relative(home, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? path.join('~', rel) : file;
};

/**
 * FR-001: the file of each app. `env` holds `CLAUDE_CONFIG_DIR` / `CODEX_HOME` (the apps' own variables) and the dev hooks
 * `DURBAR_COPILOT_DIR`, `DURBAR_CLAUDE_CONFIG_DIR`, `DURBAR_CODEX_HOME` (tests and screenshots; empty in a packaged build).
 */
export function globalFiles(env: Readonly<Record<string, string | undefined>>, home: string): Record<GlobalApp, GlobalFile> {
  const copilot = path.join(copilotDir(env, home), 'mcp-config.json');
  const claudeDir = env.DURBAR_CLAUDE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR;
  const claude = claudeDir ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json');
  const codex = path.join(env.DURBAR_CODEX_HOME || env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
  const mk = (app: GlobalApp, file: string): GlobalFile => ({ app, file, label: tilde(file, home) });
  return { copilot: mk('copilot', copilot), claude: mk('claude', claude), codex: mk('codex', codex) };
}

export const textHash = (text: string | undefined): string => createHash('sha256').update(text === undefined ? '\0missing' : `=${text}`).digest('hex');

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown, max = 64): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : undefined);
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v).slice(0, 64) : []);

export type ReadResult = { ok: true; servers: GlobalEntryView[]; values: Map<string, Record<string, unknown>> } | { ok: false; error: string };

/**
 * Command, arguments and URL as the window sees them: secret-shaped arguments, flag values and URL keys masked (the shared rules of
 * spec 061), because another app's file may hold a token in an argument or a URL.
 */
function shown(command: unknown, args: string[] | undefined, url: unknown): { command?: string; args?: string[]; url?: string } {
  return {
    ...(typeof command === 'string' ? { command: maskSecretCommand(command.slice(0, 1024)) } : {}),
    ...(args ? { args: maskSecretArgs(args.map((a) => a.slice(0, 4096))) } : {}),
    ...(typeof url === 'string' ? { url: maskSecretUrl(url.slice(0, 2048)) } : {}),
  };
}

/** A JSON entry (Copilot or Claude Code) as a view: names only. */
function jsonView(name: string, e: Record<string, unknown>): GlobalEntryView {
  const type = typeof e.type === 'string' ? e.type.toLowerCase() : undefined;
  let transport: GlobalEntryView['transport'];
  if (type === 'http' || type === 'streamable-http' || type === 'streamablehttp') transport = 'http';
  else if (type === 'sse') transport = 'sse';
  else if (type === undefined || type === 'local' || type === 'stdio') transport = typeof e.command === 'string' ? 'stdio' : typeof e.url === 'string' ? 'http' : 'other';
  else transport = 'other';
  const env = isObj(e.env) ? e.env : {};
  const headers = isObj(e.headers) ? e.headers : {};
  const refs = [...Object.values(env), ...Object.values(headers)].some((v) => typeof v === 'string' && /\$\{[A-Za-z_]/.test(v));
  return {
    name,
    transport,
    ...shown(e.command, strs(e.args), e.url),
    envKeys: keysOf(env),
    headerKeys: keysOf(headers),
    ...(refs ? { refs: true } : {}),
  };
}

/** FR-003: the parsed JSON document, or why it cannot be edited. Missing or empty text = a new, empty document. */
function parseJsonDoc(text: string | undefined): { ok: true; doc: Record<string, unknown> } | { ok: false; error: string } {
  if (text === undefined || text.trim() === '') return { ok: true, doc: {} };
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'The file is not valid JSON. Fix it first; nothing was written.' };
  }
  if (!isObj(doc)) return { ok: false, error: 'The file does not hold a JSON object. Nothing was written.' };
  if (doc.mcpServers !== undefined && !isObj(doc.mcpServers)) return { ok: false, error: '"mcpServers" in the file is not an object. Nothing was written.' };
  return { ok: true, doc };
}

/** FR-002: the servers of one app's file (`text` undefined = file missing). `values` (main only) keeps each entry as written. */
export function readGlobal(app: GlobalApp, text: string | undefined): ReadResult {
  if (app === 'codex') return readCodex(text);
  const p = parseJsonDoc(text);
  if (!p.ok) return p;
  let map = isObj(p.doc.mcpServers) ? p.doc.mcpServers : undefined;
  // The Copilot CLI also accepts a bare map (spec 019): listed, but not written (FR-003 refuses it).
  if (!map && app === 'copilot' && Object.values(p.doc).some((v) => isObj(v) && (typeof v.command === 'string' || typeof v.url === 'string'))) map = p.doc;
  const servers: GlobalEntryView[] = [];
  const values = new Map<string, Record<string, unknown>>();
  for (const [name, e] of Object.entries(map ?? {}).slice(0, MAX_SERVERS)) {
    if (!isObj(e) || !name || name.length > 64) continue;
    servers.push(jsonView(name, e));
    values.set(name, e);
  }
  return { ok: true, servers, values };
}

// ---------------------------------------------------------------- Codex TOML (line based)

const MAX_TOML_LINE = 16 * 1024;

interface TomlLine {
  raw: string;
  /** Table header path (`[a.b]` or `[[a.b]]`), or undefined for a key or blank line. */
  header?: string[];
  /** The line is inside a multi-line string (not a header or key). */
  inString: boolean;
}

/** Split a table path like `mcp_servers."my server".env` into its keys. */
function splitPath(p: string): string[] | undefined {
  const out: string[] = [];
  let i = 0;
  const s = p.trim();
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      let j = i + 1;
      for (; j < s.length && s[j] !== q; j++) if (q === '"' && s[j] === '\\') j++;
      if (j >= s.length) return undefined;
      const v = unq(s.slice(i, j + 1));
      if (v === undefined) return undefined;
      out.push(v);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return undefined;
      out.push(m[0]);
      i += m[0].length;
    }
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i < s.length) {
      if (s[i] !== '.') return undefined;
      i++;
    }
  }
  return out.length ? out : undefined;
}

function tomlLines(text: string): TomlLine[] {
  const out: TomlLine[] = [];
  let ml = ''; // open multi-line string delimiter
  for (const raw of text.split(/\r?\n/)) {
    if (ml) {
      out.push({ raw, inString: true });
      if (raw.split(ml).length % 2 === 0) ml = '';
      continue;
    }
    const line = raw.length > MAX_TOML_LINE ? '' : stripComment(raw).trim();
    const h = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (h) {
      out.push({ raw, header: splitPath(h[1]) ?? ['\0bad'], inString: false });
      continue;
    }
    out.push({ raw, inString: false });
    for (const d of ['"""', "'''"]) if (line.split(d).length % 2 === 0) { ml = d; break; }
  }
  return out;
}

const tomlArray = (v: string): string[] => tomlStringArray(v) ?? [];
/** An inline table of string values, `{ "K" = "v", L = 'w' }` (other value kinds are left out). */
const tomlInline2 = (v: string): Record<string, string> => {
  const m = /^\{(.*)\}$/.exec(v.trim());
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const p of m[1].matchAll(/(?:^|,)\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g)) {
    const key = unq(p[1]) ?? p[1];
    const val = unq(p[2]);
    if (val !== undefined && Object.keys(out).length < 64) out[key] = val;
  }
  return out;
};

/** Lines that define `mcp_servers` some other way than `[mcp_servers.<name>]` tables (FR-003 refuses to edit those files). */
function codexOddShape(lines: TomlLine[]): boolean {
  let top = true;
  for (const l of lines) {
    if (l.inString) continue;
    if (l.header) {
      top = false;
      if (l.header[0] === 'mcp_servers' && l.header.length === 1) return true; // [mcp_servers] with dotted keys inside
      continue;
    }
    const line = stripComment(l.raw).trim();
    if (top && /^("mcp_servers"|mcp_servers)\s*[.=]/.test(line)) return true;
  }
  return false;
}

/** `[`/`{` minus `]`/`}` outside quotes and comments: an array or inline table that goes on to the next lines. */
function openBrackets(line: string): number {
  let q = '';
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') break;
    else if (c === '[' || c === '{') n++;
    else if (c === ']' || c === '}') n--;
  }
  return n;
}

const TOML_KEY = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const TOML_KV = new RegExp(`^${TOML_KEY}(?:\\s*\\.\\s*${TOML_KEY})*\\s*=\\s*\\S`);

/**
 * Spec 069 change 2026-10-22 (found by T060): the 1-based number of the first line that is not a table header, a `key = value`, the
 * rest of a multi-line array, inline table or string, a comment or a blank line; undefined when every line has one of those shapes. Not
 * a full TOML parser: it catches a broken header or a stray line, which Codex itself refuses to load, so Durbar does not edit such a file.
 */
function codexBadLine(lines: TomlLine[]): number | undefined {
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.inString) continue;
    if (l.raw.length > MAX_TOML_LINE) continue; // not read (as before), not judged
    const line = stripComment(l.raw).trim();
    if (depth > 0) {
      depth = Math.max(0, depth + openBrackets(line));
      continue;
    }
    if (!line) continue;
    if (l.header) {
      if (l.header[0] === '\0bad') return i + 1;
      continue;
    }
    if (!TOML_KV.test(line)) return i + 1;
    depth = Math.max(0, openBrackets(line.slice(line.indexOf('=') + 1)));
  }
  return undefined;
}

const codexParseError = (n: number): { ok: false; error: string } => ({ ok: false, error: `This config.toml does not parse (line ${n}). Fix it first; nothing was written.` });

function readCodex(text: string | undefined): ReadResult {
  const servers: GlobalEntryView[] = [];
  const values = new Map<string, Record<string, unknown>>();
  if (text === undefined) return { ok: true, servers, values };
  const lines = tomlLines(text.replace(/^\uFEFF/, ''));
  const bad = codexBadLine(lines);
  if (bad !== undefined) return codexParseError(bad);
  if (codexOddShape(lines)) return { ok: false, error: 'This config.toml defines mcp_servers in a way Agent Durbar does not edit (an inline table or dotted keys). Nothing was written.' };
  const recs = new Map<string, Record<string, unknown>>();
  let cur: Record<string, unknown> | undefined;
  let sub = '';
  for (const l of lines) {
    if (l.inString) continue;
    if (l.header) {
      cur = undefined;
      sub = '';
      if (l.header[0] === 'mcp_servers' && l.header[1] && l.header.length <= 3 && recs.size < MAX_SERVERS) {
        const name = l.header[1];
        if (!recs.has(name)) recs.set(name, {});
        cur = recs.get(name);
        sub = l.header[2] ?? '';
      }
      continue;
    }
    if (!cur) continue;
    const line = stripComment(l.raw).trim();
    const kv = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const k = unq(kv[1]) ?? kv[1];
    const v = kv[2];
    if (sub === 'env') ((cur.env ??= {}) as Record<string, unknown>)[k] = unq(v) ?? '';
    else if (sub === 'http_headers') ((cur.http_headers ??= {}) as Record<string, unknown>)[k] = unq(v) ?? '';
    else if (sub === 'env_http_headers') ((cur.env_http_headers ??= {}) as Record<string, unknown>)[k] = unq(v) ?? '';
    else if (sub) continue;
    else if (k === 'command' || k === 'url' || k === 'bearer_token_env_var' || k === 'cwd') cur[k] = unq(v);
    else if (k === 'args' || k === 'env_vars' || k === 'enabled_tools' || k === 'disabled_tools') cur[k] = tomlArray(v);
    else if (k === 'enabled') cur[k] = v.trim() === 'false' ? false : v.trim() === 'true' ? true : v.trim();
    else if (k === 'env' || k === 'http_headers' || k === 'env_http_headers') cur[k] = tomlInline2(v);
  }
  for (const [name, r] of recs) {
    const envKeys = [...keysOf(r.env), ...(strs(r.env_vars) ?? [])];
    const headerKeys = [...keysOf(r.http_headers), ...keysOf(r.env_http_headers), ...(typeof r.bearer_token_env_var === 'string' ? ['Authorization'] : [])];
    const refs = !!((strs(r.env_vars) ?? []).length || keysOf(r.env_http_headers).length || r.bearer_token_env_var);
    servers.push({
      name,
      transport: typeof r.command === 'string' ? 'stdio' : typeof r.url === 'string' ? 'http' : 'other',
      ...shown(r.command, strs(r.args), r.url),
      envKeys: [...new Set(envKeys)],
      headerKeys: [...new Set(headerKeys)],
      ...(refs ? { refs: true } : {}),
    });
    values.set(name, r);
  }
  return { ok: true, servers, values };
}

// ---------------------------------------------------------------- entries

/**
 * A server to write: the add form's input, or (harmonize, FR-021) an entry converted from another app's file. An item with `ref` is
 * written as a reference to that environment variable whatever the mode; a value such as `Bearer ${X}` holds a reference, not a secret.
 */
export interface GlobalItem {
  key: string;
  value?: string;
  ref?: string;
}
export type GlobalInput = Omit<McpServerInput, 'env' | 'headers'> & {
  env?: GlobalItem[];
  headers?: GlobalItem[];
  /** Harmonize (change 2026-10-22): the server is switched off in its list (Codex `enabled = false`, JSON `disabled: true`). */
  off?: boolean;
  /** Harmonize: tools the source list hides (Codex `disabled_tools`). */
  disabledTools?: string[];
  /** Harmonize: the app the entry was copied from (an add from the form has none). */
  origin?: GlobalApp;
};

const VAR = '[A-Za-z_][A-Za-z0-9_]*';
const REF_ONLY = new RegExp(`^\\$\\{(${VAR})\\}$`);
const BEARER_REF = new RegExp(`^Bearer \\$\\{(${VAR})\\}$`);
/** A value that only names variables (`${X}`, `Bearer ${X}`): shown as it is, never masked. */
const refValue = (v: string | undefined): boolean => !!v && (REF_ONLY.test(v) || BEARER_REF.test(v));

/** The environment variable that holds a header's value in reference mode: `X-Api-Key` -> `X_API_KEY`. */
export const headerVar = (key: string): string => key.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');

/** The variables the user must set in reference mode (shown in the confirmation). */
export function neededVars(input: GlobalInput, mode: GlobalSecretMode = 'ref'): string[] {
  const out: string[] = [];
  const add = (v: string | undefined): void => {
    if (v && !out.includes(v)) out.push(v);
  };
  for (const e of input.env ?? []) add(e.ref ?? (mode === 'ref' ? e.key : (REF_ONLY.exec(e.value ?? '') ?? [])[1]));
  for (const h of input.headers ?? []) add(h.ref ?? (mode === 'ref' ? headerVar(h.key) : (REF_ONLY.exec(h.value ?? '') ?? BEARER_REF.exec(h.value ?? '') ?? [])[1]));
  return out;
}

export type EntryCheck = { ok: true } | { ok: false; error: string };

/** What one app cannot take from a validated input (FR-003). */
export function checkFor(app: GlobalApp, input: GlobalInput): EntryCheck {
  if (input.workingDirectory) return { ok: false, error: 'A working directory belongs to one folder: add this server to the folder instead.' };
  if (app === 'codex' && !/^[A-Za-z0-9_-]{1,48}$/.test(input.name)) return { ok: false, error: 'Codex needs a name of letters, digits, "_" or "-" (no dots).' };
  if (app === 'codex' && input.transport === 'sse') return { ok: false, error: 'Codex takes http servers only, not sse.' };
  // Change 2026-10-22 (review on #492): a copy never changes what the server may do. A field the target list cannot hold refuses the copy.
  if (input.off && app !== 'codex')
    return { ok: false, error: `It is switched off in its list (enabled = false); ${APP_LABEL[app]}'s list has no such switch, so a copy would turn it on. Nothing was written.` };
  if (input.disabledTools?.length && app !== 'codex')
    return { ok: false, error: `It hides some tools (disabled_tools); ${APP_LABEL[app]}'s list cannot hide tools, so a copy would offer them. Nothing was written.` };
  if (input.origin && app === 'claude' && (input.tools ?? []).some((t) => t !== '*'))
    return { ok: false, error: "It allows only some tools (tools / enabled_tools); Claude Code's list has no tool list, so a copy would allow every tool. Nothing was written." };
  if (app === 'codex') {
    const odd = (input.env ?? []).find((e) => e.ref !== undefined && e.ref !== e.key);
    if (odd) return { ok: false, error: `Codex passes a variable only under its own name (${odd.key} would read ${odd.ref}).` };
    if ([...(input.env ?? []), ...(input.headers ?? [])].some((e) => e.ref === undefined && e.value?.includes('${') && !(BEARER_REF.test(e.value) && (input.headers ?? []).includes(e) && /^authorization$/i.test(e.key))))
      return { ok: false, error: 'Codex does not expand ${...} inside a value.' };
  }
  return { ok: true };
}

const kv = (list: GlobalItem[] | undefined, mode: GlobalSecretMode, masked: boolean, varOf: (k: string) => string): Record<string, string> =>
  Object.fromEntries((list ?? []).map((e) => [e.key, e.ref !== undefined ? '${' + e.ref + '}' : mode === 'ref' ? '${' + varOf(e.key) + '}' : masked && !refValue(e.value) ? MASK : (e.value ?? '')]));

/** FR-003: the JSON entry for Copilot or Claude Code. `masked` replaces plain values with the mask (previews). */
export function jsonEntry(app: 'copilot' | 'claude', input: GlobalInput, mode: GlobalSecretMode, masked = false): Record<string, unknown> {
  const tools = input.tools?.length ? input.tools : ['*'];
  if (input.transport === 'stdio') {
    const env = kv(input.env, mode, masked, (k) => k);
    return {
      type: app === 'copilot' ? 'local' : 'stdio',
      command: input.command,
      args: input.args ?? [],
      ...(Object.keys(env).length || app === 'copilot' ? { env } : {}),
      ...(app === 'copilot' ? { tools } : {}),
    };
  }
  const headers = kv(input.headers, mode, masked, headerVar);
  return { type: input.transport, url: input.url, ...(Object.keys(headers).length ? { headers } : {}), ...(app === 'copilot' ? { tools } : {}) };
}

/** A TOML basic string. */
export const tomlStr = (s: string): string =>
  '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\u0000-\u001f\u007f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
const tomlKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k));
const tomlArr = (a: string[]): string => '[' + a.map(tomlStr).join(', ') + ']';
const tomlInline = (o: Record<string, string>): string => '{ ' + Object.entries(o).map(([k, v]) => `${tomlStr(k)} = ${tomlStr(v)}`).join(', ') + ' }';

/** FR-003: the Codex table lines (no trailing newline). */
export function codexBlock(input: GlobalInput, mode: GlobalSecretMode, masked = false): string[] {
  const out = [`[mcp_servers.${tomlKey(input.name)}]`];
  const val = (v: string | undefined): string => (masked && !refValue(v) ? MASK : (v ?? ''));
  const isRef = (e: GlobalItem): boolean => e.ref !== undefined || mode === 'ref';
  const envRefs = (input.env ?? []).filter(isRef);
  const envPlain = (input.env ?? []).filter((e) => !isRef(e));
  if (input.transport === 'stdio') {
    out.push(`command = ${tomlStr(input.command ?? '')}`);
    if (input.args?.length) out.push(`args = ${tomlArr(input.args)}`);
    if (envRefs.length) out.push(`env_vars = ${tomlArr(envRefs.map((e) => e.ref ?? e.key))}`);
  } else {
    out.push(`url = ${tomlStr(input.url ?? '')}`);
    const hs = input.headers ?? [];
    const bearer = hs.find((h) => !isRef(h) && /^authorization$/i.test(h.key) && BEARER_REF.test(h.value ?? ''));
    const refs = hs.filter(isRef);
    const plain = hs.filter((h) => !isRef(h) && h !== bearer);
    if (bearer) out.push(`bearer_token_env_var = ${tomlStr((BEARER_REF.exec(bearer.value ?? '') ?? [])[1] ?? '')}`);
    if (refs.length) out.push(`env_http_headers = ${tomlInline(Object.fromEntries(refs.map((h) => [h.key, h.ref ?? headerVar(h.key)])))}`);
    if (plain.length) out.push(`http_headers = ${tomlInline(Object.fromEntries(plain.map((h) => [h.key, val(h.value)])))}`);
  }
  const tools = (input.tools ?? []).filter((t) => t !== '*');
  if (tools.length) out.push(`enabled_tools = ${tomlArr(tools)}`);
  if (input.disabledTools?.length) out.push(`disabled_tools = ${tomlArr(input.disabledTools)}`);
  if (input.off) out.push('enabled = false');
  if (input.transport === 'stdio' && envPlain.length) {
    out.push('', `[mcp_servers.${tomlKey(input.name)}.env]`);
    for (const e of envPlain) out.push(`${tomlKey(e.key)} = ${tomlStr(val(e.value))}`);
  }
  return out;
}

/** The entry as the confirmation shows it (values masked). */
export function previewText(app: GlobalApp, input: GlobalInput, mode: GlobalSecretMode): string {
  // FR-012 / SC-002 (change 2026-10-22, review on #492): a copy's command, arguments and URL come from another app's file and may hold
  // a token: they are masked with the shared rules, like every other view of the files.
  const x: GlobalInput = {
    ...input,
    ...(input.command !== undefined ? { command: maskSecretCommand(input.command) } : {}),
    ...(input.args ? { args: maskSecretArgs(input.args) } : {}),
    ...(input.url !== undefined ? { url: maskSecretUrl(input.url) } : {}),
  };
  if (app === 'codex') return codexBlock(x, mode, true).join('\n');
  return jsonBlock(x.name, jsonEntry(app, x, mode, true));
}

/** `"name": { ... }` with one line per field and each value on one line, as the review shows it. */
export function jsonBlock(name: string, entry: Record<string, unknown>): string {
  const one = (v: unknown): string => (Array.isArray(v) ? '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']' : '{ ' + Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ') + ' }');
  const lines = Object.entries(entry).map(([k, v]) => `  ${JSON.stringify(k)}: ${Array.isArray(v) || (v && typeof v === 'object') ? one(v) : JSON.stringify(v)}`);
  return `${JSON.stringify(name)}: {\n${lines.join(',\n')}\n}`;
}

// ---------------------------------------------------------------- editors

export type EditResult = { ok: true; text: string } | { ok: false; error: string; conflict?: boolean };

const eolOf = (text: string | undefined): string => (text && /\r\n/.test(text) ? '\r\n' : '\n');

// ---------------------------------------------------------------- JSON: surgical text edit (change 2026-10-22, review 2 on #489)

interface JMember {
  key: string;
  keyStart: number;
  valStart: number;
  valEnd: number;
}
/** An object of the text: `start` is its `{`, `end` its `}`. */
interface JObject {
  start: number;
  end: number;
  members: JMember[];
}

class JsonShapeError extends Error {}

const skipWs = (t: string, i: number): number => {
  while (i < t.length && (t[i] === ' ' || t[i] === '\t' || t[i] === '\r' || t[i] === '\n')) i++;
  return i;
};

/** `t[i]` is `"`: the index after the closing quote. */
function strEnd(t: string, i: number): number {
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] === '\\') j++;
    else if (t[j] === '"') return j + 1;
  }
  throw new JsonShapeError('string');
}

/** The index after the value that starts at `i` (the text already passed `JSON.parse`). */
function valueEnd(t: string, i: number): number {
  const c = t[i];
  if (c === '"') return strEnd(t, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      const d = t[j];
      if (d === '"') j = strEnd(t, j) - 1;
      else if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw new JsonShapeError('bracket');
  }
  let j = i;
  while (j < t.length && !/[\s,}\]]/.test(t[j])) j++;
  if (j === i) throw new JsonShapeError('value');
  return j;
}

/** The members of the object whose `{` is at `start`, with their positions in the text. */
function objectAt(t: string, start: number): JObject {
  if (t[start] !== '{') throw new JsonShapeError('object');
  const members: JMember[] = [];
  let i = skipWs(t, start + 1);
  if (t[i] === '}') return { start, end: i, members };
  for (;;) {
    if (t[i] !== '"') throw new JsonShapeError('key');
    const keyStart = i;
    const ke = strEnd(t, i);
    const key = JSON.parse(t.slice(keyStart, ke)) as string;
    i = skipWs(t, ke);
    if (t[i] !== ':') throw new JsonShapeError('colon');
    const valStart = skipWs(t, i + 1);
    const valEnd = valueEnd(t, valStart);
    members.push({ key, keyStart, valStart, valEnd });
    i = skipWs(t, valEnd);
    if (t[i] === ',') {
      i = skipWs(t, i + 1);
      continue;
    }
    if (t[i] === '}') return { start, end: i, members };
    throw new JsonShapeError('member');
  }
}

/** The spaces or tabs that start the line holding `pos`. */
const lineIndent = (t: string, pos: number): string => /^[ \t]*/.exec(t.slice(t.lastIndexOf('\n', pos - 1) + 1, pos))![0];
/** A member that starts on its own line. */
const ownLine = (t: string, m: JMember): boolean => /\n[ \t]*$/.test(t.slice(0, m.keyStart));

interface JsonStyle {
  /** One indent level (spaces or a tab); undefined: the file is on one line, so new members are compact too. */
  unit?: string;
  eol: string;
}

/** The file's own style: the first member on its own line gives the indent unit (relative to its object's line). */
function jsonStyle(t: string, objs: JObject[]): JsonStyle {
  const eol = eolOf(t);
  if (!t.trim().includes('\n')) return { eol };
  for (const o of objs) {
    const m = o.members.find((x) => ownLine(t, x));
    if (!m) continue;
    const mi = lineIndent(t, m.keyStart);
    const oi = lineIndent(t, o.start);
    if (mi.length > oi.length && mi.startsWith(oi)) return { unit: mi.slice(oi.length), eol };
  }
  return { unit: '  ', eol };
}

/** `value` as JSON text in the file's style; continuation lines start with `indent`. */
const jsonText = (value: unknown, st: JsonStyle, indent: string): string =>
  st.unit === undefined ? JSON.stringify(value) : JSON.stringify(value, null, st.unit).split('\n').join(st.eol + indent);

/** Set member `key` of object `o` to `value`: its value replaced in place, or a new member after the last one. */
function setMember(t: string, o: JObject, key: string, value: unknown, st: JsonStyle): string {
  const hit = o.members.filter((m) => m.key === key);
  if (hit.length > 1) throw new JsonShapeError('duplicate');
  if (hit.length === 1) {
    const m = hit[0];
    return t.slice(0, m.valStart) + jsonText(value, st, lineIndent(t, m.keyStart)) + t.slice(m.valEnd);
  }
  const sep = st.unit === undefined ? ':' : ': ';
  if (!o.members.length) {
    const ci = lineIndent(t, o.start);
    if (st.unit === undefined) return t.slice(0, o.start + 1) + JSON.stringify(key) + sep + jsonText(value, st, '') + t.slice(o.end);
    const mi = ci + st.unit;
    return t.slice(0, o.start + 1) + st.eol + mi + JSON.stringify(key) + sep + jsonText(value, st, mi) + st.eol + ci + t.slice(o.end);
  }
  const last = o.members[o.members.length - 1];
  const multi = st.unit !== undefined && ownLine(t, last);
  const mi = multi ? lineIndent(t, last.keyStart) : '';
  const lead = multi ? ',' + st.eol + mi : t.slice(last.valEnd, skipWs(t, last.valEnd)) === '' && /,\s/.test(t.slice(o.start, o.end)) ? ', ' : ',';
  return t.slice(0, last.valEnd) + lead + JSON.stringify(key) + sep + jsonText(value, st, mi) + t.slice(last.valEnd);
}

/** Delete member `key` of object `o` with the comma and the line break that belong to it. */
function deleteMember(t: string, o: JObject, key: string): string {
  const idx = o.members.findIndex((m) => m.key === key);
  if (idx < 0 || o.members.filter((m) => m.key === key).length > 1) throw new JsonShapeError('member');
  const m = o.members[idx];
  if (o.members.length === 1) return t.slice(0, o.start + 1) + t.slice(o.end);
  if (idx > 0) return t.slice(0, o.members[idx - 1].valEnd) + t.slice(m.valEnd);
  return t.slice(0, m.keyStart) + t.slice(o.members[1].keyStart);
}

/**
 * FR-003 (change 2026-10-22): set (`entry`) or delete (`undefined`) `mcpServers[name]` in the text itself. Every other byte stays as
 * written: indentation, key order, number literals (`12345678901234567890`, `1.0`), escapes and line ends. The result is parsed again
 * and must hold exactly the intended change, else the edit is refused.
 */
function jsonEdit(text: string | undefined, doc: Record<string, unknown>, name: string, entry: Record<string, unknown> | undefined): EditResult {
  const servers = isObj(doc.mcpServers) ? doc.mcpServers : undefined;
  const want: Record<string, unknown> = { ...doc, mcpServers: { ...(servers ?? {}) } };
  if (entry) (want.mcpServers as Record<string, unknown>)[name] = entry;
  else delete (want.mcpServers as Record<string, unknown>)[name];
  if (text === undefined || text.trim() === '') {
    const eol = eolOf(text);
    return { ok: true, text: (JSON.stringify(want, null, 2) + '\n').replace(/\n/g, eol) };
  }
  const refuse = { ok: false as const, error: 'Agent Durbar could not change only this server in the file (an unusual layout, such as a key written twice). Nothing was written.' };
  let out: string;
  try {
    const top = objectAt(text, skipWs(text, text.startsWith('\uFEFF') ? 1 : 0));
    if (top.members.filter((m) => m.key === 'mcpServers').length > 1) return refuse;
    const ms = top.members.find((m) => m.key === 'mcpServers');
    const inner = ms ? objectAt(text, ms.valStart) : undefined;
    const st = jsonStyle(text, inner ? [inner, top] : [top]);
    if (!entry) out = deleteMember(text, inner as JObject, name);
    else if (inner) out = setMember(text, inner, name, entry, st);
    else out = setMember(text, top, 'mcpServers', { [name]: entry }, st);
  } catch {
    return refuse;
  }
  let got: unknown;
  try {
    got = JSON.parse(out.replace(/^\uFEFF/, ''));
  } catch {
    return refuse;
  }
  return JSON.stringify(got) === JSON.stringify(want) ? { ok: true, text: out } : refuse;
}

/** FR-003: add (or with `replace`, replace) one server in an app's file text. `text` undefined = the file does not exist yet. */
export function addToText(app: GlobalApp, text: string | undefined, input: GlobalInput, mode: GlobalSecretMode, replace = false): EditResult {
  const chk = checkFor(app, input);
  if (!chk.ok) return chk;
  if (!NAME_RE.test(input.name)) return { ok: false, error: 'Not a valid server name.' };
  if (app === 'codex') return codexAdd(text, input, mode, replace);
  const p = parseJsonDoc(text);
  if (!p.ok) return p;
  if (p.doc.mcpServers === undefined && app === 'copilot' && readGlobal('copilot', text).ok && (readGlobal('copilot', text) as { servers: unknown[] }).servers.length)
    return { ok: false, error: 'This file lists servers without an "mcpServers" object; Agent Durbar does not change that layout. Nothing was written.' };
  const servers = isObj(p.doc.mcpServers) ? p.doc.mcpServers : {};
  if (Object.prototype.hasOwnProperty.call(servers, input.name) && !replace) return { ok: false, conflict: true, error: `"${input.name}" is already in this file.` };
  if (!Object.prototype.hasOwnProperty.call(servers, input.name) && Object.keys(servers).length >= MAX_SERVERS) return { ok: false, error: `At most ${MAX_SERVERS} servers.` };
  return jsonEdit(text, p.doc, input.name, jsonEntry(app, input, mode));
}

/** FR-003: remove one server. */
export function removeFromText(app: GlobalApp, text: string | undefined, name: string): EditResult {
  if (text === undefined) return { ok: false, error: 'The file does not exist.' };
  if (app === 'codex') return codexRemove(text, name);
  const p = parseJsonDoc(text);
  if (!p.ok) return p;
  const servers = isObj(p.doc.mcpServers) ? p.doc.mcpServers : undefined;
  if (!servers || !Object.prototype.hasOwnProperty.call(servers, name)) return { ok: false, error: `"${name}" is not in this file.` };
  return jsonEdit(text, p.doc, name, undefined);
}

/** Line ranges `[start, end)` of every table of server `name` (its own and its sub-tables). */
function codexRanges(lines: TomlLine[], name: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].header;
    if (!h) continue;
    const mine = h[0] === 'mcp_servers' && h[1] === name && !lines[i].raw.trim().startsWith('[[');
    if (open >= 0 && !mine) {
      out.push([open, i]);
      open = -1;
    }
    if (mine && open < 0) open = i;
  }
  if (open >= 0) out.push([open, lines.length]);
  return out;
}

function codexAdd(text: string | undefined, input: GlobalInput, mode: GlobalSecretMode, replace: boolean): EditResult {
  let base = text ?? '';
  if (base) {
    const r = readCodex(base);
    if (!r.ok) return r;
    if (r.servers.some((s) => s.name === input.name)) {
      if (!replace) return { ok: false, conflict: true, error: `"${input.name}" is already in this file.` };
      const rm = codexRemove(base, input.name);
      if (!rm.ok) return rm;
      base = rm.text;
    } else if (r.servers.length >= MAX_SERVERS) return { ok: false, error: `At most ${MAX_SERVERS} servers.` };
  }
  const eol = eolOf(text);
  const block = ['# added by Agent Durbar', ...codexBlock(input, mode)].join(eol) + eol;
  if (!base) return { ok: true, text: block };
  const sep = base.endsWith(eol + eol) || base.endsWith('\n\n') ? '' : base.endsWith('\n') ? eol : eol + eol;
  return { ok: true, text: base + sep + block };
}

function codexRemove(text: string, name: string): EditResult {
  const lines = tomlLines(text);
  const bad = codexBadLine(lines);
  if (bad !== undefined) return codexParseError(bad);
  if (codexOddShape(lines)) return { ok: false, error: 'This config.toml defines mcp_servers in a way Agent Durbar does not edit (an inline table or dotted keys). Nothing was written.' };
  const ranges = codexRanges(lines, name);
  if (!ranges.length) return { ok: false, error: `"${name}" is not in this file.` };
  const drop = new Set<number>();
  for (const [a, b] of ranges) {
    let end = b;
    // keep the comments and blank lines that lead into the next table (they belong to it)
    while (end > a + 1 && b < lines.length && (lines[end - 1].raw.trim() === '' || lines[end - 1].raw.trim().startsWith('#')) && !lines[end - 1].inString) end--;
    for (let i = a; i < end; i++) drop.add(i);
    // our own marker comment and the blank line before it
    if (a > 0 && lines[a - 1].raw.trim() === '# added by Agent Durbar') {
      drop.add(a - 1);
      if (a > 1 && lines[a - 2].raw.trim() === '') drop.add(a - 2);
    }
  }
  const eol = eolOf(text);
  const raws = text.split(/\r?\n/);
  let kept = raws.filter((_l, i) => !drop.has(i)).join(eol);
  if (text.endsWith('\n') && !kept.endsWith('\n') && kept !== '') kept += eol;
  return { ok: true, text: kept };
}

/** FR-011: every list that has `name` (each tag once, in a fixed order); `runtime` only when no list has it. */
export function sourcesFor(name: string, global: Partial<Record<GlobalApp, readonly string[]>>, folder: ReadonlySet<string>, builtin: ReadonlySet<string>): McpSourceTag[] {
  const out: McpSourceTag[] = GLOBAL_APPS.filter((app) => (global[app] ?? []).includes(name));
  if (folder.has(name)) out.push('folder');
  if (builtin.has(name)) out.push('builtin');
  if (!out.length) out.push('runtime');
  return out;
}

/** The key of a Claude Code list entry in the Settings off-list (Copilot names are kept bare, as before; spec 069 FR-009). */
export const claudeOffKey = (name: string): string => `claude:${name}`;

/** The names of one app's list that new Durbar sessions skip, from the Settings off-list. Codex starts its own list itself: none. */
export function offOf(app: GlobalApp, list: readonly string[]): string[] {
  if (app === 'copilot') return list.filter((n) => !n.startsWith('claude:'));
  if (app === 'claude') return list.filter((n) => n.startsWith('claude:')).map((n) => n.slice(7));
  return [];
}

// ---------------------------------------------------------------- harmonize (part 2, FR-020, FR-021)

const isStrMap = (v: unknown): Record<string, string> =>
  isObj(v) ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string>) : {};
const toItems = (m: Record<string, string>): GlobalItem[] =>
  Object.entries(m).map(([key, value]) => {
    const r = REF_ONLY.exec(value);
    return r ? { key, ref: r[1] } : { key, value };
  });

/**
 * FR-021: one app's entry (as `readGlobal` keeps it, values included; main only) in the neutral form the writers take, or why it cannot
 * be copied. References stay references (`${X}`, Codex `env_vars`, `env_http_headers`, `bearer_token_env_var` -> `Bearer ${X}`).
 */
export function neutralFrom(app: GlobalApp, name: string, raw: Record<string, unknown>): { ok: true; input: GlobalInput } | { ok: false; error: string } {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const tools = strs(app === 'codex' ? raw.enabled_tools : raw.tools);
  const hidden = app === 'codex' ? strs(raw.disabled_tools) : undefined;
  // Change 2026-10-22 (review on #492): switched off and tool lists travel with the copy (checkFor refuses a target that cannot hold them).
  const off = app === 'codex' ? raw.enabled === false : raw.disabled === true || raw.enabled === false;
  if (app === 'codex' && raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return { ok: false, error: 'Its "enabled" is not true or false.' };
  const base = {
    name,
    origin: app,
    ...(tools && tools.length && !(tools.length === 1 && tools[0] === '*') ? { tools } : {}),
    ...(hidden?.length ? { disabledTools: hidden } : {}),
    ...(off ? { off: true } : {}),
  };
  if (app !== 'codex' && typeof raw.cwd === 'string') return { ok: false, error: 'It has a working directory, which belongs to one folder.' };
  if (app === 'codex') {
    if (str(raw.cwd)) return { ok: false, error: 'It has a working directory, which belongs to one folder.' };
    if (str(raw.command)) {
      const env = [...toItems(isStrMap(raw.env)), ...(strs(raw.env_vars) ?? []).map((k) => ({ key: k, ref: k }))];
      return { ok: true, input: { ...base, transport: 'stdio', command: str(raw.command), args: strs(raw.args) ?? [], env, headers: [] } };
    }
    if (str(raw.url)) {
      const headers: GlobalItem[] = [
        ...toItems(isStrMap(raw.http_headers)),
        ...Object.entries(isStrMap(raw.env_http_headers)).map(([key, ref]) => ({ key, ref })),
        ...(str(raw.bearer_token_env_var) ? [{ key: 'Authorization', value: 'Bearer ${' + str(raw.bearer_token_env_var) + '}' }] : []),
      ];
      return { ok: true, input: { ...base, transport: 'http', url: str(raw.url), env: [], headers } };
    }
    return { ok: false, error: 'Agent Durbar cannot copy this kind of server.' };
  }
  const v = jsonView(name, raw);
  if (v.transport === 'stdio') return { ok: true, input: { ...base, transport: 'stdio', command: str(raw.command), args: strs(raw.args) ?? [], env: toItems(isStrMap(raw.env)), headers: [] } };
  if (v.transport === 'http' || v.transport === 'sse') return { ok: true, input: { ...base, transport: v.transport, url: str(raw.url), env: [], headers: toItems(isStrMap(raw.headers)) } };
  return { ok: false, error: 'Agent Durbar cannot copy this kind of server.' };
}

/** FR-020: what differs between two neutral entries (names of fields only; values are compared, never returned). */
export function differences(a: GlobalInput, b: GlobalInput): string[] {
  const out: string[] = [];
  const keys = (l?: GlobalItem[]): string => (l ?? []).map((e) => e.key).sort().join('\n');
  const vals = (l?: GlobalItem[]): string => JSON.stringify((l ?? []).map((e) => [e.key, e.ref ?? null, e.value ?? null]).sort());
  if (a.transport !== b.transport) out.push('type');
  if ((a.command ?? '') !== (b.command ?? '')) out.push('command');
  if (JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? [])) out.push('arguments');
  if ((a.url ?? '') !== (b.url ?? '')) out.push('URL');
  if (keys(a.env) !== keys(b.env)) out.push('environment variables');
  if (keys(a.headers) !== keys(b.headers)) out.push('headers');
  if (keys(a.env) === keys(b.env) && keys(a.headers) === keys(b.headers) && (vals(a.env) !== vals(b.env) || vals(a.headers) !== vals(b.headers))) out.push('values');
  const list = (l?: string[]): string => [...new Set((l ?? []).filter((t) => t !== '*'))].sort().join('\n');
  if (list(a.tools) !== list(b.tools)) out.push('tools');
  if (list(a.disabledTools) !== list(b.disabledTools)) out.push('hidden tools');
  if (!!a.off !== !!b.off) out.push('on/off');
  return out;
}

/**
 * FR-009: the MCP servers one session gets: the agent app's user list that Durbar passes itself (`glob`, Claude Code only), minus the
 * names this agent switched off, then the folder's extras. A folder extra wins over a user-list server of the same name (compared
 * without case, as the agent's MCP dialog lists them).
 */
export function mergeSessionServers(glob: Readonly<Record<string, McpServerSpec>>, folder: Readonly<Record<string, McpServerSpec>>, off: ReadonlySet<string> = new Set()): Record<string, McpServerSpec> {
  const taken = new Set(Object.keys(folder).map((n) => n.toLowerCase()));
  const out: Record<string, McpServerSpec> = {};
  for (const [n, s] of Object.entries(glob)) if (!off.has(n) && !taken.has(n.toLowerCase())) out[n] = s;
  return { ...out, ...folder };
}
