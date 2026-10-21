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
import type { McpServerInput } from '../shared/mcp';
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
  const copilot = path.join(env.DURBAR_COPILOT_DIR || path.join(home, '.copilot'), 'mcp-config.json');
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
/** A `${NAME}` reference (the whole value). */
const REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

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

/** Cut a `#` comment that is outside quotes. */
function stripComment(line: string): string {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

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
      let v = '';
      for (; j < s.length && s[j] !== q; j++) {
        if (q === '"' && s[j] === '\\') {
          v += s[j + 1] ?? '';
          j++;
        } else v += s[j];
      }
      if (j >= s.length) return undefined;
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

const unq = (v: string): string | undefined => {
  const m = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(v.trim());
  if (!m) return undefined;
  if (m[2] !== undefined) return m[2];
  return m[1].replace(/\\u([0-9A-Fa-f]{4})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
};
const tomlArray = (v: string): string[] => {
  const m = /^\[(.*)\]$/.exec(v.trim());
  return m ? (m[1].match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) ?? []).map((x) => unq(x) ?? '').slice(0, 64) : [];
};
const tomlInlineKeys = (v: string): string[] => {
  const m = /^\{(.*)\}$/.exec(v.trim());
  if (!m) return [];
  return (m[1].match(/(?:^|,)\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=/g) ?? []).map((k) => {
    const key = k.replace(/^,?\s*/, '').replace(/\s*=$/, '');
    return unq(key) ?? key;
  });
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
    else if (k === 'args' || k === 'env_vars' || k === 'enabled_tools') cur[k] = tomlArray(v);
    else if (k === 'env' || k === 'http_headers' || k === 'env_http_headers') cur[k] = Object.fromEntries(tomlInlineKeys(v).map((x) => [x, '']));
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

/** The environment variable that holds a header's value in reference mode: `X-Api-Key` -> `X_API_KEY`. */
export const headerVar = (key: string): string => key.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');

/** The variables the user must set in reference mode (shown in the confirmation). */
export function neededVars(input: McpServerInput): string[] {
  return [...(input.env ?? []).map((e) => e.key), ...(input.headers ?? []).map((h) => headerVar(h.key))];
}

export type EntryCheck = { ok: true } | { ok: false; error: string };

/** What one app cannot take from a validated input (FR-003). */
export function checkFor(app: GlobalApp, input: McpServerInput): EntryCheck {
  if (input.workingDirectory) return { ok: false, error: 'A working directory belongs to one folder: add this server to the folder instead.' };
  if (app === 'codex' && !/^[A-Za-z0-9_-]{1,48}$/.test(input.name)) return { ok: false, error: 'Codex needs a name of letters, digits, "_" or "-" (no dots).' };
  if (app === 'codex' && input.transport === 'sse') return { ok: false, error: 'Codex takes http servers only, not sse.' };
  return { ok: true };
}

const kv = (list: { key: string; value?: string }[] | undefined, mode: GlobalSecretMode, masked: boolean, varOf: (k: string) => string): Record<string, string> =>
  Object.fromEntries((list ?? []).map((e) => [e.key, mode === 'ref' ? '${' + varOf(e.key) + '}' : masked ? MASK : (e.value ?? '')]));

/** FR-003: the JSON entry for Copilot or Claude Code. `masked` replaces plain values with the mask (previews). */
export function jsonEntry(app: 'copilot' | 'claude', input: McpServerInput, mode: GlobalSecretMode, masked = false): Record<string, unknown> {
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
export function codexBlock(input: McpServerInput, mode: GlobalSecretMode, masked = false): string[] {
  const out = [`[mcp_servers.${tomlKey(input.name)}]`];
  const val = (v: string | undefined): string => (masked ? MASK : (v ?? ''));
  if (input.transport === 'stdio') {
    out.push(`command = ${tomlStr(input.command ?? '')}`);
    if (input.args?.length) out.push(`args = ${tomlArr(input.args)}`);
    if (input.env?.length && mode === 'ref') out.push(`env_vars = ${tomlArr(input.env.map((e) => e.key))}`);
  } else {
    out.push(`url = ${tomlStr(input.url ?? '')}`);
    if (input.headers?.length)
      out.push(mode === 'ref' ? `env_http_headers = ${tomlInline(Object.fromEntries(input.headers.map((h) => [h.key, headerVar(h.key)])))}` : `http_headers = ${tomlInline(Object.fromEntries(input.headers.map((h) => [h.key, val(h.value)])))}`);
  }
  const tools = (input.tools ?? []).filter((t) => t !== '*');
  if (tools.length) out.push(`enabled_tools = ${tomlArr(tools)}`);
  if (input.transport === 'stdio' && input.env?.length && mode === 'plain') {
    out.push('', `[mcp_servers.${tomlKey(input.name)}.env]`);
    for (const e of input.env) out.push(`${tomlKey(e.key)} = ${tomlStr(val(e.value))}`);
  }
  return out;
}

/** The entry as the confirmation shows it (values masked). */
export function previewText(app: GlobalApp, input: McpServerInput, mode: GlobalSecretMode): string {
  if (app === 'codex') return codexBlock(input, mode, true).join('\n');
  return jsonBlock(input.name, jsonEntry(app, input, mode, true));
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

function jsonWrite(doc: Record<string, unknown>, text: string | undefined): string {
  const out = JSON.stringify(doc, null, 2) + '\n';
  return eolOf(text) === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

/** FR-003: add (or with `replace`, replace) one server in an app's file text. `text` undefined = the file does not exist yet. */
export function addToText(app: GlobalApp, text: string | undefined, input: McpServerInput, mode: GlobalSecretMode, replace = false): EditResult {
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
  const next = { ...servers, [input.name]: jsonEntry(app, input, mode) };
  return { ok: true, text: jsonWrite({ ...p.doc, mcpServers: next }, text) };
}

/** FR-003: remove one server. */
export function removeFromText(app: GlobalApp, text: string | undefined, name: string): EditResult {
  if (text === undefined) return { ok: false, error: 'The file does not exist.' };
  if (app === 'codex') return codexRemove(text, name);
  const p = parseJsonDoc(text);
  if (!p.ok) return p;
  const servers = isObj(p.doc.mcpServers) ? p.doc.mcpServers : undefined;
  if (!servers || !Object.prototype.hasOwnProperty.call(servers, name)) return { ok: false, error: `"${name}" is not in this file.` };
  const next = { ...servers };
  delete next[name];
  return { ok: true, text: jsonWrite({ ...p.doc, mcpServers: next }, text) };
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

function codexAdd(text: string | undefined, input: McpServerInput, mode: GlobalSecretMode, replace: boolean): EditResult {
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
