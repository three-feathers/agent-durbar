/**
 * Read-only parsers for MCP configuration files of other tools (spec 019): `~/.copilot/mcp-config.json` and VS Code's user `mcp.json`.
 * Pure: they get the file text and return candidates. Values of env/headers are kept in the candidate (the main process stores them
 * as secrets) but are never part of a preview.
 */
import type { McpTransport } from './mcp';
import { NAME_RE } from './mcp';

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

export type McpFileKind = 'copilot' | 'vscode';

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

export function parseMcpConfig(text: string, kind: McpFileKind): ParsedMcpFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON (VS Code files may contain comments; remove them or import by hand).', candidates: [], skipped: 0 };
  }
  if (!isObj(doc)) return { ok: false, error: 'Unexpected file content.', candidates: [], skipped: 0 };
  let map: unknown = kind === 'vscode' ? doc.servers : doc.mcpServers;
  if (map === undefined && kind === 'copilot' && Object.values(doc).length && Object.values(doc).every(isObj)) map = doc; // bare top-level format
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
    if (VAR_RE.test(all)) notes.push('Uses ${...} variables (VS Code input/workspace). They are copied as literal text: edit before enabling.');
    let unique = name;
    for (let i = 2; used.has(unique.toLowerCase()); i++) unique = `${name.slice(0, 44)}-${i}`;
    used.add(unique.toLowerCase());
    c.name = unique;
    out.push(c);
  }
  return { ok: true, candidates: out, skipped };
}
