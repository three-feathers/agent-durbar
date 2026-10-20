/**
 * Spec 061 FR-001: read a folder's own agent setup, read-only, with size caps, never executing anything (research R1-R3, spec).
 *   Claude Code: `.claude/settings.json`, `.claude/settings.local.json` (`hooks`, `permissions.allow/deny/ask`);
 *   Codex:       `.codex/config.toml` (`[mcp_servers.<name>]`), `.codex/hooks.json` (listed, not supported by Codex from Durbar);
 *   Copilot:     `.github/hooks/*.json`, `hooks` in `.github/copilot/settings.json`;
 *   every app:   `.mcp.json` (`mcpServers`).
 * Each item gets a digest of its content (FR-010). The window gets masked text only (FR-014); the raw content stays here and is
 * applied only for accepted items (`acceptedFor`). No Electron import: unit-tested on fixture folders.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NAME_RE } from '../shared/mcp';
import type { McpServerSpec } from '../shared/mcp';
import { maskSecretArgs, maskSecretCommand, maskSecretUrl } from '../shared/redact';
import { isBroadRule } from '../shared/foldersetup';
import type { FolderSetupApp, FolderSetupItem, RuleKind } from '../shared/foldersetup';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_ITEMS = 200;
const MAX_TEXT = 4000;
const MAX_HOOK_FILES = 20;

/** The raw content of one item, kept in main only. */
export type RawItem =
  | { kind: 'hook'; app: 'claude' | 'codex' | 'copilot'; event: string; matcher?: string; command?: string; bash?: string; powershell?: string; timeout?: number }
  | { kind: 'rule'; ruleKind: RuleKind; rule: string }
  | { kind: 'mcp'; name: string; spec: McpServerSpec };

export interface ScanResult {
  items: FolderSetupItem[];
  raw: Map<string, RawItem>;
  problems: { file: string; message: string }[];
}

/** What a session of one agent app gets from the accepted items (FR-004). */
export interface FolderSetupApply {
  hooks: Extract<RawItem, { kind: 'hook' }>[];
  rules: { allow: string[]; deny: string[]; ask: string[] };
  mcpServers: Record<string, McpServerSpec>;
}

const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const cap = (s: string, n = 600): string => (s.length > n ? s.slice(0, n) + '…' : s);

type Read = { state: 'ok'; json: unknown; text: string } | { state: 'missing' } | { state: 'error'; message: string };
function readFile(file: string, asJson: boolean): Read {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { state: 'error', message: 'not a file' };
    if (st.size > MAX_FILE_BYTES) return { state: 'error', message: 'larger than 256 KiB: not read' };
    const text = fs.readFileSync(file, 'utf8');
    if (!asJson) return { state: 'ok', json: undefined, text };
    try {
      return { state: 'ok', json: JSON.parse(text), text };
    } catch {
      return { state: 'error', message: 'not valid JSON' };
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'missing' } : { state: 'error', message: 'could not be read' };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function mcpItem(app: FolderSetupApp, file: string, name: string, spec: McpServerSpec, note?: string): { item: FolderSetupItem; raw: RawItem } {
  const secretNames = [...Object.keys(spec.env ?? {}), ...Object.keys(spec.headers ?? {})].slice(0, 30);
  const env = spec.env ?? {};
  const detail = spec.type === 'stdio' ? [maskSecretCommand(spec.command ?? '', env), ...maskSecretArgs(spec.args ?? [], env)].join(' ') : maskSecretUrl(spec.url ?? '', env);
  const id = digest(['mcp', name, spec]);
  return {
    item: { id, app, kind: 'mcp', file, label: `MCP server ${name}`, detail: cap(detail), ...(secretNames.length ? { secretNames } : {}), supported: true, ...(note ? { unsupportedWhy: note } : {}) },
    raw: { kind: 'mcp', name, spec },
  };
}

/** `{ mcpServers: { name: { command, args, env, url, headers, type } } }` (Claude Code's and Copilot CLI's `.mcp.json`). */
function readMcpJson(json: unknown): { name: string; spec: McpServerSpec }[] {
  const servers = isObj(json) && isObj(json.mcpServers) ? json.mcpServers : {};
  const out: { name: string; spec: McpServerSpec }[] = [];
  for (const [name, v] of Object.entries(servers)) {
    if (!NAME_RE.test(name) || !isObj(v)) continue;
    const env = isObj(v.env) ? Object.fromEntries(Object.entries(v.env).filter((e): e is [string, string] => typeof e[1] === 'string')) : undefined;
    const headers = isObj(v.headers) ? Object.fromEntries(Object.entries(v.headers).filter((e): e is [string, string] => typeof e[1] === 'string')) : undefined;
    const url = str(v.url, 2048);
    const command = str(v.command, 1000);
    if (url && (v.type === 'http' || v.type === 'sse' || !command)) out.push({ name, spec: { type: v.type === 'sse' ? 'sse' : 'http', url, ...(headers ? { headers } : {}) } });
    else if (command) {
      const args = Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string').slice(0, 64) : [];
      out.push({ name, spec: { type: 'stdio', command, args, ...(env && Object.keys(env).length ? { env } : {}), ...(str(v.cwd, 1000) ? { workingDirectory: v.cwd as string } : {}) } });
    }
  }
  return out;
}

/** The `[mcp_servers.<name>]` tables of a Codex `config.toml`: `command`, `args`, `url`, `env` (names), nothing else. */
export function readCodexMcpToml(text: string): { name: string; spec: McpServerSpec }[] {
  const out = new Map<string, { command?: string; args?: string[]; url?: string; env?: Record<string, string> }>();
  let cur: { command?: string; args?: string[]; url?: string; env?: Record<string, string> } | undefined;
  let inEnv = false;
  const unq = (v: string): string | undefined => {
    const m = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(v.trim());
    return m ? (m[1] !== undefined ? m[1].replace(/\\(["\\])/g, '$1') : m[2]) : undefined;
  };
  for (const lineRaw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = lineRaw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      const parts = head[1].split('.').map((p) => p.trim().replace(/^"|"$/g, ''));
      inEnv = false;
      cur = undefined;
      if (parts[0] === 'mcp_servers' && parts[1] && NAME_RE.test(parts[1])) {
        if (!out.has(parts[1])) out.set(parts[1], {});
        cur = out.get(parts[1]);
        inEnv = parts[2] === 'env';
      }
      continue;
    }
    if (!cur) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    if (inEnv) { const s = unq(v); if (s !== undefined) (cur.env ??= {})[k] = s; continue; }
    if (k === 'command') cur.command = unq(v);
    else if (k === 'url') cur.url = unq(v);
    else if (k === 'args') {
      const m = /^\[(.*)\]$/.exec(v.trim());
      if (m) cur.args = (m[1].match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) ?? []).map((x) => unq(x) ?? '').slice(0, 64);
    } else if (k === 'env') {
      const m = /^\{(.*)\}$/.exec(v.trim());
      if (m) for (const pair of m[1].split(',')) { const p = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(pair); const s = p ? unq(p[2]) : undefined; if (p && s !== undefined) (cur.env ??= {})[p[1]] = s; }
    }
  }
  const list: { name: string; spec: McpServerSpec }[] = [];
  for (const [name, v] of out) {
    if (v.url) list.push({ name, spec: { type: 'http', url: v.url } });
    else if (v.command) list.push({ name, spec: { type: 'stdio', command: v.command, args: v.args ?? [], ...(v.env && Object.keys(v.env).length ? { env: v.env } : {}) } });
  }
  return list;
}

/** Claude-style hooks (`{ hooks: { Event: [{ matcher?, hooks: [{ type: 'command', command }] }] } }`), also Codex's `hooks.json`. */
function readClaudeHooks(json: unknown, app: 'claude' | 'codex'): Extract<RawItem, { kind: 'hook' }>[] {
  const hooks = isObj(json) && isObj(json.hooks) ? json.hooks : {};
  const out: Extract<RawItem, { kind: 'hook' }>[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!/^[A-Za-z]{1,40}$/.test(event) || !Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue;
      const matcher = str(g.matcher, 200);
      for (const h of g.hooks) {
        if (!isObj(h) || h.type !== 'command') continue;
        const command = str(h.command);
        if (command) out.push({ kind: 'hook', app, event, ...(matcher ? { matcher } : {}), command, ...(typeof h.timeout === 'number' ? { timeout: h.timeout } : {}) });
      }
    }
  }
  return out;
}

/** Copilot hooks (`{ version?, hooks: { event: [{ type: 'command', bash?, powershell?, timeoutSec? }] } }`). */
function readCopilotHooks(json: unknown): Extract<RawItem, { kind: 'hook' }>[] {
  const hooks = isObj(json) && isObj(json.hooks) ? json.hooks : {};
  const out: Extract<RawItem, { kind: 'hook' }>[] = [];
  for (const [event, list] of Object.entries(hooks)) {
    if (!/^[A-Za-z]{1,40}$/.test(event) || !Array.isArray(list)) continue;
    for (const h of list) {
      if (!isObj(h) || (h.type !== undefined && h.type !== 'command')) continue;
      const bash = str(h.bash), powershell = str(h.powershell);
      if (bash || powershell) out.push({ kind: 'hook', app: 'copilot', event, ...(bash ? { bash } : {}), ...(powershell ? { powershell } : {}), ...(typeof h.timeoutSec === 'number' ? { timeout: h.timeoutSec } : {}) });
    }
  }
  return out;
}

const APP_NAME: Record<'claude' | 'codex' | 'copilot', string> = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot' };

/** Scans the folders of one workspace (the first one first). Pure apart from reading files; never throws. */
export function scanFolderSetup(dirs: readonly string[]): ScanResult {
  const items: FolderSetupItem[] = [];
  const raw = new Map<string, RawItem>();
  const problems: { file: string; message: string }[] = [];
  const add = (item: FolderSetupItem, r: RawItem): void => {
    if (items.length >= MAX_ITEMS || raw.has(item.id)) return;
    items.push(item);
    raw.set(item.id, r);
  };
  const many = dirs.length > 1;
  for (const dir of dirs.slice(0, 8)) {
    const rel = (f: string): string => (many ? `${path.basename(dir)}/` : '') + f;
    const hookItem = (file: string, h: Extract<RawItem, { kind: 'hook' }>): void => {
      const cmd = h.command ?? h.bash ?? h.powershell ?? '';
      const supported = h.app !== 'codex';
      add(
        {
          id: digest(['hook', h]),
          app: h.app,
          kind: 'hook',
          file: rel(file),
          label: `${h.event} hook`,
          detail: cap(maskSecretCommand(cmd), 1200) + (h.bash && h.powershell ? `  (PowerShell: ${cap(maskSecretCommand(h.powershell), 400)})` : ''),
          event: h.event,
          ...(h.matcher ? { matcher: h.matcher } : {}),
          supported,
          ...(supported ? {} : { unsupportedWhy: `${APP_NAME[h.app]} does not run a folder's hooks from Agent Durbar (they need its own review in a terminal).` }),
        },
        h,
      );
    };
    // Claude Code
    for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
      const r = readFile(path.join(dir, ...f.split('/')), true);
      if (r.state === 'error') { problems.push({ file: rel(f), message: r.message }); continue; }
      if (r.state !== 'ok') continue;
      for (const h of readClaudeHooks(r.json, 'claude')) hookItem(f, h);
      const perms = isObj(r.json) && isObj(r.json.permissions) ? r.json.permissions : {};
      for (const ruleKind of ['allow', 'deny', 'ask'] as const) {
        const list = Array.isArray(perms[ruleKind]) ? (perms[ruleKind] as unknown[]) : [];
        for (const rule of list.slice(0, 100)) {
          const s = str(rule, 500);
          if (!s) continue;
          const word = ruleKind === 'allow' ? 'Allow' : ruleKind === 'deny' ? 'Deny' : 'Ask';
          add(
            { id: digest(['rule', ruleKind, s]), app: 'claude', kind: 'rule', file: rel(f), label: `${word} rule`, detail: maskSecretCommand(s), ruleKind, ...(ruleKind !== 'deny' && isBroadRule(s) ? { broad: true } : {}), supported: true },
            { kind: 'rule', ruleKind, rule: s },
          );
        }
      }
    }
    // MCP servers in .mcp.json: Durbar can hand them to any app's session (Copilot itself does not read the file, R3)
    {
      const f = '.mcp.json';
      const r = readFile(path.join(dir, f), true);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const s of readMcpJson(r.json)) { const m = mcpItem('any', rel(f), s.name, s.spec); add(m.item, m.raw); }
    }
    // Codex
    {
      const f = '.codex/config.toml';
      const r = readFile(path.join(dir, '.codex', 'config.toml'), false);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const s of readCodexMcpToml(r.text)) { const m = mcpItem('codex', rel(f), s.name, s.spec); add(m.item, m.raw); }
      const fh = '.codex/hooks.json';
      const rh = readFile(path.join(dir, '.codex', 'hooks.json'), true);
      if (rh.state === 'error') problems.push({ file: rel(fh), message: rh.message });
      else if (rh.state === 'ok') for (const h of readClaudeHooks(rh.json, 'codex')) hookItem(fh, h);
    }
    // Copilot
    {
      const hdir = path.join(dir, '.github', 'hooks');
      let names: string[] = [];
      try { names = fs.readdirSync(hdir).filter((n) => n.endsWith('.json')).sort().slice(0, MAX_HOOK_FILES); } catch { names = []; }
      for (const n of names) {
        const f = `.github/hooks/${n}`;
        const r = readFile(path.join(hdir, n), true);
        if (r.state === 'error') { problems.push({ file: rel(f), message: r.message }); continue; }
        if (r.state === 'ok') for (const h of readCopilotHooks(r.json)) hookItem(f, h);
      }
      const f = '.github/copilot/settings.json';
      const r = readFile(path.join(dir, '.github', 'copilot', 'settings.json'), true);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const h of readCopilotHooks(r.json)) hookItem(f, h);
    }
  }
  return { items, raw, problems };
}

/**
 * FR-004: what one app's session gets, from the ACCEPTED items only (pending and declined items never apply).
 * Hooks and rules only of that app; MCP servers from `.mcp.json` for every app and from `.codex/config.toml` for Codex.
 * A name already used by the session's own servers is left out (Durbar's own list wins).
 */
export function acceptedFor(scan: ScanResult, accepted: ReadonlySet<string>, app: 'claude' | 'codex' | 'copilot', takenNames: ReadonlySet<string> = new Set()): FolderSetupApply {
  const out: FolderSetupApply = { hooks: [], rules: { allow: [], deny: [], ask: [] }, mcpServers: {} };
  for (const it of scan.items) {
    if (!accepted.has(it.id) || !it.supported) continue;
    const r = scan.raw.get(it.id);
    if (!r) continue;
    if (r.kind === 'hook' && r.app === app) out.hooks.push(r);
    else if (r.kind === 'rule' && app === 'claude') out.rules[r.ruleKind].push(r.rule);
    else if (r.kind === 'mcp' && (it.app === 'any' || it.app === app) && !takenNames.has(r.name) && !out.mcpServers[r.name]) out.mcpServers[r.name] = r.spec;
  }
  return out;
}

/** FR-012: does this app's session run with folder hooks or folder allow rules (so the mode chip says "+ folder rules")? */
export function hasFolderRules(a: FolderSetupApply): boolean {
  return a.hooks.length > 0 || a.rules.allow.length > 0 || a.rules.ask.length > 0;
}
