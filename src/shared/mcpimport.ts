/**
 * Read-only parsers for MCP configuration files of other tools: `~/.copilot/mcp-config.json` (spec 019, 020: the CLI list) and, per
 * folder, VS Code's `.vscode/mcp.json` (spec 020 FR-020..FR-031, a tolerant JSONC reader).
 * Pure: they get the file text and return candidates. Values of env/headers are kept in the candidate (the main process stores them
 * as secrets) but are never part of a preview.
 */
import type { McpServerInput, McpTransport } from './mcp';
import { ENV_KEY_RE, HEADER_KEY_RE, NAME_RE, validateInput } from './mcp';

export interface ImportCandidate {
  name: string;
  /** The key as written in the file (the runtime matches this exact name, e.g. for `disabledMcpServers`). */
  originalName: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  tools?: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  /** Things the user should look at before enabling (VS Code input variables, ignored fields, ...). */
  notes: string[];
}

export interface ParsedMcpFile {
  ok: boolean;
  error?: string;
  candidates: ImportCandidate[];
  /** Entries that could not be used (not an object, neither command nor url, ...). */
  skipped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function sanitizeName(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 48).replace(/[-_.]+$/, '');
  return NAME_RE.test(s) ? s : '';
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return out;
}

const VAR_RE = /\$\{(input|workspaceFolder|env|userHome)[:}]/;

/** The Copilot CLI file (`mcpServers`, or a bare map). Strict JSON, as the CLI reads it. */
export function parseMcpConfig(text: string): ParsedMcpFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON.', candidates: [], skipped: 0 };
  }
  if (!isObj(doc)) return { ok: false, error: 'Unexpected file content.', candidates: [], skipped: 0 };
  let map: unknown = doc.mcpServers;
  if (map === undefined && Object.values(doc).length && Object.values(doc).every(isObj)) map = doc; // bare top-level format
  if (!isObj(map)) return { ok: true, candidates: [], skipped: 0 };
  const out: ImportCandidate[] = [];
  let skipped = 0;
  const used = new Set<string>();
  for (const [rawName, e] of Object.entries(map)) {
    const name = sanitizeName(rawName);
    if (!name || !isObj(e)) {
      skipped++;
      continue;
    }
    const type = typeof e.type === 'string' ? e.type.toLowerCase() : undefined;
    const notes: string[] = [];
    let transport: McpTransport | undefined;
    if (type === 'http' || type === 'streamable-http' || type === 'streamablehttp') transport = 'http';
    else if (type === 'sse') transport = 'sse';
    else if (type === 'local' || type === 'stdio' || type === undefined) transport = typeof e.command === 'string' ? 'stdio' : typeof e.url === 'string' ? 'http' : undefined;
    if (!transport) {
      skipped++;
      continue;
    }
    const c: ImportCandidate = { name, originalName: rawName, transport, env: {}, headers: {}, notes };
    if (name !== rawName) notes.push(`Renamed from "${rawName.slice(0, 60)}".`);
    if (transport === 'stdio') {
      if (typeof e.command !== 'string' || !e.command) {
        skipped++;
        continue;
      }
      c.command = e.command;
      c.args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : [];
      c.env = strMap(e.env);
      const cwd = e.cwd ?? e.workingDirectory;
      if (typeof cwd === 'string' && cwd) c.workingDirectory = cwd;
      if (e.envFile !== undefined) notes.push('"envFile" is not imported.');
    } else {
      if (typeof e.url !== 'string' || !e.url) {
        skipped++;
        continue;
      }
      c.url = e.url;
      c.headers = strMap(e.headers);
    }
    if (Array.isArray(e.tools) && e.tools.every((t) => typeof t === 'string')) c.tools = e.tools as string[];
    const all = JSON.stringify([c.command, c.args, c.url, Object.values(c.env), Object.values(c.headers), c.workingDirectory]);
    if (VAR_RE.test(all)) notes.push('Uses ${...} variables (variables). They are copied as literal text: edit before enabling.');
    let unique = name;
    for (let i = 2; used.has(unique.toLowerCase()); i++) unique = `${name.slice(0, 44)}-${i}`;
    used.add(unique.toLowerCase());
    c.name = unique;
    out.push(c);
  }
  return { ok: true, candidates: out, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// VS Code `.vscode/mcp.json` (spec 020 FR-020..FR-031). Tolerant (JSONC), never resolves anything but ${workspaceFolder}, never throws.
// ---------------------------------------------------------------------------------------------------------------------------------

/** One env/header row of a VS Code candidate. `value` undefined = nothing is copied (empty, a `${...}` reference, or too long). */
export interface VSCodeSecretRow {
  key: string;
  value?: string;
}

export interface VSCodeCandidate {
  /** Cleaned name (the app's name rule); the caller may still rename it on a clash. */
  name: string;
  /** The key as written in the file. */
  originalName: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  url?: string;
  tools?: string[];
  env: VSCodeSecretRow[];
  headers: VSCodeSecretRow[];
  /** What the user should know before ticking it (ignored fields, renamed, references dropped). */
  notes: string[];
  /** Why this entry cannot be imported (the box is disabled); undefined = importable. */
  blocked?: string;
}

export interface ParsedVSCodeFile {
  ok: boolean;
  error?: string;
  candidates: VSCodeCandidate[];
  /** Entries that are not usable at all (not an object, unknown `type`, neither command nor url). */
  skipped: number;
  /** Ids declared in the top-level `inputs` (names only: they are never prompted for, stored or resolved). */
  inputs: string[];
  /** Top-level keys the importer does not use (other than `servers` and `inputs`). */
  ignoredTop: string[];
}

export type Jsonc = { ok: true; text: string } | { ok: false; error: string };

/**
 * JSON with comments to plain JSON: removes a leading BOM, `//` and block comments and trailing commas. Text inside strings is left
 * alone (a URL's `//` is not a comment). It does not validate anything else; `JSON.parse` does that afterwards.
 */
export function stripJsonc(input: string): Jsonc {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return { ok: false, error: 'A comment is not closed (missing */).' };
      out.push(' ');
      i = end + 2;
    } else if (c === '}' || c === ']') {
      let k = out.length - 1;
      while (k >= 0 && /^\s*$/.test(out[k])) k--;
      if (k >= 0 && out[k] === ',') out[k] = '';
      out.push(c);
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return { ok: true, text: out.join('') };
}

const REF_RE = /\$\{[^}]*\}/;
const WS = '${workspaceFolder}';
const STDIO_KEYS = new Set(['type', 'command', 'args', 'env', 'cwd', 'workingDirectory', 'tools']);
const REMOTE_KEYS = new Set(['type', 'url', 'headers', 'tools']);

/** The input form of a candidate (what the add form would send); the store validates and stores it like a hand-typed server. */
export function candidateInput(c: VSCodeCandidate): McpServerInput {
  const rows = (l: VSCodeSecretRow[]): { key: string; value?: string }[] => l.map((r) => ({ key: r.key, value: r.value }));
  return {
    name: c.name,
    transport: c.transport,
    command: c.command,
    args: c.args,
    workingDirectory: c.workingDirectory,
    url: c.url,
    tools: c.tools,
    env: c.transport === 'stdio' ? rows(c.env) : [],
    headers: c.transport === 'stdio' ? [] : rows(c.headers),
  };
}

/**
 * Parse a VS Code `mcp.json` (`servers` map, `inputs`). `workspaceFolder` = absolute path of the folder that holds `.vscode`; it is the
 * only variable that is resolved. Every other `${...}` in command, args, url or cwd makes the entry not importable; in env/header
 * values the reference is dropped (key kept, no value). Secrets never appear in `notes` or `blocked`.
 */
export function parseVSCodeMcp(text: string, opts: { workspaceFolder: string }): ParsedVSCodeFile {
  const none = (error: string): ParsedVSCodeFile => ({ ok: false, error, candidates: [], skipped: 0, inputs: [], ignoredTop: [] });
  const j = stripJsonc(text);
  if (!j.ok) return none(j.error);
  let doc: unknown;
  try {
    doc = JSON.parse(j.text);
  } catch {
    return none('Not valid JSON (comments and trailing commas are fine, but something else in the file is wrong).');
  }
  if (!isObj(doc)) return none('Unexpected file content: expected an object with a "servers" map.');
  const inputs: string[] = [];
  if (Array.isArray(doc.inputs)) for (const i of doc.inputs) if (isObj(i) && typeof i.id === 'string' && i.id) inputs.push(i.id.slice(0, 60));
  const ignoredTop = Object.keys(doc).filter((k) => k !== 'servers' && k !== 'inputs').map((k) => k.slice(0, 40));
  const map = doc.servers;
  if (map === undefined) return { ok: true, candidates: [], skipped: 0, inputs, ignoredTop };
  if (!isObj(map)) return none('"servers" must be an object (a map of server name to definition).');
  const resolve = (s: string): string => s.split(WS).join(opts.workspaceFolder);
  const out: VSCodeCandidate[] = [];
  const used = new Set<string>();
  let skipped = 0;
  for (const [rawName, e] of Object.entries(map)) {
    const name = sanitizeName(rawName);
    if (!name || !isObj(e)) {
      skipped++;
      continue;
    }
    const type = typeof e.type === 'string' ? e.type.toLowerCase() : undefined;
    let transport: McpTransport | undefined;
    if (type === 'http' || type === 'streamable-http' || type === 'streamablehttp') transport = 'http';
    else if (type === 'sse') transport = 'sse';
    else if (type === 'stdio' || type === 'local' || type === undefined) transport = typeof e.command === 'string' && e.command ? 'stdio' : type === undefined && typeof e.url === 'string' && e.url ? 'http' : undefined;
    if (!transport || (transport === 'stdio' ? typeof e.command !== 'string' : typeof e.url !== 'string')) {
      skipped++;
      continue;
    }
    const notes: string[] = [];
    if (name !== rawName) notes.push(`Renamed from "${rawName.slice(0, 60)}" to fit the name rule.`);
    const c: VSCodeCandidate = { name, originalName: rawName, transport, env: [], headers: [], notes };
    const refs = new Set<string>(); // unresolved references in clear-text fields
    const clear = (v: string): string => {
      const r = resolve(v);
      for (const m of r.match(/\$\{[^}]*\}/g) ?? []) refs.add(m.slice(0, 60));
      return r;
    };
    const rows = (v: unknown, keyRe: RegExp, what: string): VSCodeSecretRow[] => {
      const list: VSCodeSecretRow[] = [];
      if (!isObj(v)) return list;
      for (const [k, raw] of Object.entries(v)) {
        if (!keyRe.test(k)) {
          notes.push(`Ignored ${what} "${k.slice(0, 40)}": not a valid name.`);
          continue;
        }
        const val = typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : undefined;
        if (val === undefined || val === '') {
          list.push({ key: k });
          continue;
        }
        const r = resolve(val);
        if (REF_RE.test(r)) {
          list.push({ key: k });
          notes.push(`${k}: contains a \${...} reference. The value is not copied or resolved; enter it after importing.`);
        } else if (r.length > 8192) {
          list.push({ key: k });
          notes.push(`${k}: value too long to import; enter it after importing.`);
        } else list.push({ key: k, value: r });
      }
      return list;
    };
    if (transport === 'stdio') {
      c.command = clear(e.command as string);
      c.args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string').map(clear) : [];
      const cwd = e.cwd ?? e.workingDirectory;
      if (typeof cwd === 'string' && cwd) c.workingDirectory = clear(cwd);
      c.env = rows(e.env, ENV_KEY_RE, 'variable');
    } else {
      c.url = clear((e.url as string).trim());
      c.headers = rows(e.headers, HEADER_KEY_RE, 'header');
    }
    if (Array.isArray(e.tools) && e.tools.length && e.tools.every((t) => typeof t === 'string')) c.tools = e.tools as string[];
    const known = transport === 'stdio' ? STDIO_KEYS : REMOTE_KEYS;
    const ignored = Object.keys(e).filter((k) => !known.has(k)).map((k) => k.slice(0, 40));
    if (ignored.length) notes.push(`Ignored fields: ${ignored.join(', ')}.`);
    if (ignored.includes('envFile')) notes.push('"envFile" is not read: add its variables by hand if the server needs them.');
    if (refs.size) {
      const inputRef = [...refs].some((r) => r.startsWith('${input:'));
      c.blocked = inputRef
        ? `Needs a value that VS Code asks you for (${[...refs].filter((r) => r.startsWith('${input:')).slice(0, 3).join(', ')}). Agent Durbar never asks for or guesses it: add this server by hand.`
        : `Uses a variable that is not resolved here (${[...refs].slice(0, 3).join(', ')}). Only \${workspaceFolder} is. Add this server by hand.`;
    } else {
      const v = validateInput(candidateInput(c));
      if (!v.ok) c.blocked = v.error;
    }
    let unique = name;
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${name.slice(0, 44)}-${n}`;
    used.add(unique.toLowerCase());
    if (unique !== name) notes.push(`Another entry already uses the name "${name}"; this one is called "${unique}".`);
    c.name = unique;
    out.push(c);
  }
  return { ok: true, candidates: out, skipped, inputs, ignoredTop };
}
