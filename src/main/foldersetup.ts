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
import { maskTokenShapes, secretFlag, shQuote } from '../shared/redact';
import type { McpServerSpec } from '../shared/mcp';
import { isBroadRule } from '../shared/foldersetup';
import { stripTomlComment, tomlStringArray, tomlUnquote as unq } from './codextoml';
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
/** FR-014 (review #424): an item is shown in full or not listed at all; longer than this, it is a problem, never applied. */
export const MAX_SHOWN = 8000;

/**
 * FR-014 / FR-016 (review #424): what a hook command or a rule shows. Only real token shapes are hidden (GitHub and OpenAI/Anthropic
 * keys, bearer tokens, JWTs, AWS keys): their classes cannot contain shell syntax, so `--auth=$(curl …|sh)` or a backtick payload is
 * always shown. The shapes are `redact`'s own (`maskTokenShapes`, spec 012 FR-080), not a copy, so a token after `_` is hidden too.
 * The flag- and name-based masking used for MCP arguments is NOT used here: it let a repository choose what is hidden.
 * `hidden` marks that something was replaced, so the window shows it and leaves the item unticked.
 */
export function shownCommand(cmd: string): { text: string; hidden: boolean } {
  const text = maskTokenShapes(cmd, '[secret hidden]');
  return { text, hidden: text !== cmd };
}

type Read = { state: 'ok'; json: unknown; text: string } | { state: 'missing' } | { state: 'error'; message: string };
/** S2 (review #424): never through a link, and never outside the folder (a linked `.claude/` or `.mcp.json` pointing elsewhere is a problem). */
function readFile(file: string, asJson: boolean, root: string): Read {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) return { state: 'error', message: 'a link: not followed' };
    if (!st.isFile()) return { state: 'error', message: 'not a file' };
    if (!inside(root, file)) return { state: 'error', message: 'outside the folder: not read' };
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

/** The file's real folder is the root or below it (links in between resolved). */
function inside(root: string, file: string): boolean {
  try {
    const r = fs.realpathSync(root);
    const d = fs.realpathSync(path.dirname(file));
    const rel = path.relative(r, d);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

/** Shells, and interpreters with the flag that takes inline code (the flag `null` = the program always runs code it is given). */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'csh', 'tcsh', 'busybox', 'cmd', 'powershell', 'pwsh', 'nu', 'xonsh']);
const INLINE: { re: RegExp; flag: RegExp }[] = [
  { re: /^(node|nodejs|bun)$/, flag: /^(-e|-p|--eval|--print|-pe)$|^--(eval|print)=/ },
  { re: /^deno$/, flag: /^eval$/ },
  { re: /^(python|pypy)[0-9.]*$/, flag: /^-[A-Za-z]*c$/ },
  { re: /^(perl|ruby)$/, flag: /^-[A-Za-z]*[eE]$/ },
  { re: /^php$/, flag: /^-r$/ },
  { re: /^npx$/, flag: /^(-c|--call)(=|$)/ },
  { re: /^(lua|luajit|osascript|rscript)$/, flag: /^-e$/ },
];
const progName = (c: string): string => (c.replace(/^["']+|["']+$/g, '').split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
/** Re-review #424 (7537f86): programs that start another program given in their arguments (looked through by `runsGivenCode`). */
const WRAPPERS = new Set(['env', 'timeout', 'nice', 'nohup', 'sudo', 'doas', 'stdbuf', 'xargs', 'setsid', 'ionice', 'chrt', 'taskset', 'time', 'command', 'exec', 'start', 'runas']);
/** Is `words[0]` a program that runs code it is given? A shell, or an interpreter with its inline-code flag later on. */
function givenCodeAt(words: readonly string[]): string | undefined {
  const prog = progName(words[0]);
  if (SHELLS.has(prog)) return prog;
  const it = INLINE.find((x) => x.re.test(prog));
  return it && words.slice(1).some((w) => it.flag.test(w)) ? prog : undefined;
}
/**
 * Re-review #424: the program an MCP server starts runs code it is handed (a shell, or an interpreter with inline code), so an env value
 * can be that code (`sh -c 'eval "$PAYLOAD"'`). Re-review at 7537f86: a wrapper (`env -S "sh -c …"`, `timeout 60 sh -c …`, `nice`,
 * `sudo`, `xargs`, …) is looked through: its arguments are split on whitespace (as `env -S` does) and ANY later word that is a shell,
 * or an inline-code interpreter with its flag, counts; parsing each wrapper's options would miss one. Returns the program's name.
 */
export function runsGivenCode(command: string, args: readonly string[]): string | undefined {
  const words = [command, ...args];
  const first = progName(words[0]);
  if (!WRAPPERS.has(first)) return givenCodeAt(words);
  const rest = words.slice(1).flatMap((w) => w.split(/\s+/)).filter(Boolean);
  if ((first === 'sudo' || first === 'doas') && rest.some((w) => /^(-[A-Za-z]*[si][A-Za-z]*|--shell|--login)$/.test(w))) return first;
  for (let i = 0; i < rest.length; i++) { const p = givenCodeAt(rest.slice(i)); if (p) return p; }
  return undefined;
}

/**
 * Re-review #424 (7537f86): env variables that make a program load or run code from their value, whatever the command (`NODE_OPTIONS=
 * --import=data:…`, `BASH_ENV`, `LD_PRELOAD`, …). A server whose env sets one is marked with the reason and starts unticked.
 * Re-review at 97dc616: also `BASH_FUNC_*` (exported bash functions, run by any bash child) and `MAKEFLAGS` / `MFLAGS` (`--eval=…`).
 */
const CODE_LOADING_ENV = /^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|ELECTRON_RUN_AS_NODE|BASH_ENV|ENV|ZDOTDIR|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|PS4|IFS|SHELL|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|DYLD_\w+|PERL5OPT|PERL5LIB|PERLLIB|PERL5DB|RUBYOPT|RUBYLIB|PYTHONSTARTUP|PYTHONPATH|PYTHONHOME|PYTHONINSPECT|PYTHONUSERBASE|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH|PATH|PATHEXT|COMSPEC|PSMODULEPATH|GIT_\w+|NPM_CONFIG_\w+|YARN_\w+|BUN_\w+|DENO_\w+|UV_\w+|PIP_\w+|GEM_PATH|GEM_HOME|BUNDLE_GEMFILE|LUA_INIT\w*|LUA_PATH\w*|LUA_CPATH\w*|PHPRC|PHP_INI_SCAN_DIR|TCLLIBPATH|EDITOR|VISUAL|PAGER|BROWSER|BASH_FUNC_.+|MAKEFLAGS|MFLAGS)$/i;
export function codeLoadingEnv(names: readonly string[]): string[] {
  return names.filter((n) => CODE_LOADING_ENV.test(n));
}

/**
 * Constitution III (safe by default): an env value whose NAME looks secret is not shown (`DB_PASSWORD`, `PGPASSWORD`, `API_KEY`,
 * `GITHUB_TOKEN`, ...). Reuses spec 041's `secretFlag` (token, secret, passw, key, pwd, auth, credential, cookie, session, ...) plus
 * `private` and `cert`. Re-review at 97dc616 (option a): a value hidden by its name marks the item hidden (unticked) with a reason,
 * because the program may run it and the person cannot read it.
 */
export function secretEnvName(name: string): boolean {
  return secretFlag(name) || /private|cert/i.test(name);
}

function mcpItem(app: FolderSetupApp, file: string, name: string, spec: McpServerSpec, note?: string): { item: FolderSetupItem; raw: RawItem } {
  const env = spec.type === 'stdio' ? Object.entries(spec.env ?? {}) : [];
  const envNames = env.map(([k]) => k);
  const headerNames = Object.keys(spec.headers ?? {}).slice(0, 30);
  const secretEnv = envNames.filter(secretEnvName);
  // FR-014 (re-review #424): the same token-shape masking as hooks and rules; anything hidden is marked (and starts unticked).
  // Re-review at 7537f86: env values are shown too (`NAME=value` before the command), and every word is quoted where needed (`shQuote`, shared with spec 041; T057).
  // a secret-looking NAME shows `NAME=[hidden]` (never the value, never in the digest) and is listed as "value hidden"
  const envParts = env.map(([k, v]) => (secretEnvName(k) ? { text: `${k}=[hidden]`, hidden: false } : shownCommand(`${k}=${shQuote(v)}`)));
  const parts = [...envParts, ...(spec.type === 'stdio' ? [spec.command ?? '', ...(spec.args ?? [])].map((w) => shownCommand(shQuote(w))) : [shownCommand(spec.url ?? '')])];
  const detail = parts.map((p) => p.text).join(' ');
  const tokenHidden = parts.some((p) => p.hidden);
  const shell = spec.type === 'stdio' && envNames.length ? runsGivenCode(spec.command ?? '', spec.args ?? []) : undefined;
  const loaders = codeLoadingEnv(envNames);
  // Re-review at 97dc616 (required 2): "read them above" only for values that are shown; a value hidden by name cannot be read here.
  const hiddenText = (names: string[]): string => (names.length === 1 ? `the value of ${names[0]} is hidden here, so it cannot be read` : `the values of ${names.slice(0, 5).join(', ')} are hidden here, so they cannot be read`);
  const readHint = (names: string[]): string => {
    const hid = names.filter(secretEnvName), shown = names.filter((n) => !secretEnvName(n));
    if (!hid.length) return names.length === 1 ? 'read it above' : 'read them above';
    return shown.length ? `read ${shown.slice(0, 5).join(', ')} above; ${hiddenText(hid)}` : hiddenText(hid);
  };
  const why = [
    ...(shell ? [`It starts ${shell}, which can run what it is given, and hands it env values (${envNames.slice(0, 5).join(', ')}): they can be commands, so ${readHint(envNames)}. Ticking it runs them too.`] : []),
    ...(loaders.length ? [`Its env sets ${loaders.slice(0, 5).join(', ')}, which can make the program load and run code from that value: ${readHint(loaders)} before ticking it.`] : []),
    // Re-review at 97dc616 (required 1, option a): a value hidden by its name is a hidden payload whatever the command runs it with.
    ...(secretEnv.length && !shell ? [secretEnv.length === 1 ? '1 env value is hidden because its name looks secret; a program could run it. Tick only if you trust it.' : `${secretEnv.length} env values are hidden because their names look secret; a program could run them. Tick only if you trust it.`] : []),
  ];
  if (why.length && tokenHidden) why.push('Part of it is hidden because it looks like a secret key.');
  const hiddenWhy = why.length ? why.join(' ') : undefined;
  const hidden = tokenHidden || !!hiddenWhy;
  // S3 (review #424): no secret in the digest. Amended at 7537f86: env values are shown now, so the SHOWN values (token shapes masked)
  // are part of the digest and a changed value asks again; header values stay out (names only).
  const id = digest(['mcp', name, { ...spec, ...(spec.env ? { env: envParts.map((p) => p.text).sort() } : {}), ...(spec.headers ? { headers: Object.keys(spec.headers).sort() } : {}) }]);
  return {
    item: { id, app, kind: 'mcp', file, label: `MCP server ${name}`, detail, ...(hidden ? { hidden: true } : {}), ...(hiddenWhy ? { hiddenWhy } : {}), ...(secretEnv.length + headerNames.length ? { secretNames: [...secretEnv, ...headerNames].slice(0, 30) } : {}), supported: true, ...(note ? { unsupportedWhy: note } : {}) },
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

const MAX_TOML_LINE = 4096;
/** The `[mcp_servers.<name>]` tables of a Codex `config.toml`: `command`, `args`, `url`, `env` (names), nothing else. */
export function readCodexMcpToml(text: string): { name: string; spec: McpServerSpec }[] {
  const out = new Map<string, { command?: string; args?: string[]; url?: string; env?: Record<string, string> }>();
  let cur: { command?: string; args?: string[]; url?: string; env?: Record<string, string> } | undefined;
  let inEnv = false;
  for (const lineRaw of text.split(/\r?\n/).slice(0, 5000)) {
    // review #424: linear only (a hostile 256 KiB value must not block main): long lines are skipped, comments cut by a scan
    if (lineRaw.length > MAX_TOML_LINE) continue;
    const line = stripTomlComment(lineRaw).trim();
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
      const a = tomlStringArray(v);
      if (a) cur.args = a;
    } else if (k === 'env') {
      const m = /^\{(.*)\}$/.exec(v.trim());
      if (m) for (const pair of m[1].split(',')) { const p = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(pair.trim()); const s = p ? unq(p[2]) : undefined; if (p && s !== undefined) (cur.env ??= {})[p[1]] = s; }
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
function readClaudeHooks(json: unknown, app: 'claude' | 'codex', tooLong: () => void): Extract<RawItem, { kind: 'hook' }>[] {
  const hooks = isObj(json) && isObj(json.hooks) ? json.hooks : {};
  const out: Extract<RawItem, { kind: 'hook' }>[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!/^[A-Za-z]{1,40}$/.test(event) || !Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue;
      const matcher = str(g.matcher, 200);
      for (const h of g.hooks) {
        if (!isObj(h) || h.type !== 'command') continue;
        if (typeof h.command === 'string' && h.command.length > MAX_TEXT) { tooLong(); continue; }
        const command = str(h.command);
        if (command) out.push({ kind: 'hook', app, event, ...(matcher ? { matcher } : {}), command, ...(typeof h.timeout === 'number' ? { timeout: h.timeout } : {}) });
      }
    }
  }
  return out;
}

/** Copilot hooks (`{ version?, hooks: { event: [{ type: 'command', bash?, powershell?, timeoutSec? }] } }`). */
function readCopilotHooks(json: unknown, tooLong: () => void): Extract<RawItem, { kind: 'hook' }>[] {
  const hooks = isObj(json) && isObj(json.hooks) ? json.hooks : {};
  const out: Extract<RawItem, { kind: 'hook' }>[] = [];
  for (const [event, list] of Object.entries(hooks)) {
    if (!/^[A-Za-z]{1,40}$/.test(event) || !Array.isArray(list)) continue;
    for (const h of list) {
      if (!isObj(h) || (h.type !== undefined && h.type !== 'command')) continue;
      if ((typeof h.bash === 'string' && h.bash.length > MAX_TEXT) || (typeof h.powershell === 'string' && h.powershell.length > MAX_TEXT)) { tooLong(); continue; }
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
  const list = dirs.slice(0, 8);
  const labels = rootLabels(list);
  list.forEach((dir, di) => {
    const rel = (f: string): string => (list.length > 1 ? `${labels[di]}/` : '') + f;
    const tooLong = (f: string) => (): void => { problems.push({ file: rel(f), message: `a hook longer than ${MAX_TEXT} characters: not shown, never used` }); };
    const hookItem = (file: string, h: Extract<RawItem, { kind: 'hook' }>): void => {
      const main = shownCommand(h.command ?? h.bash ?? h.powershell ?? '');
      const ps = h.bash && h.powershell ? shownCommand(h.powershell) : undefined;
      const supported = h.app !== 'codex';
      add(
        {
          id: digest(['hook', h]),
          app: h.app,
          kind: 'hook',
          file: rel(file),
          label: `${h.event} hook`,
          // FR-014 (review #424): the whole command, never cut (the window scrolls); only real token shapes are hidden
          detail: main.text + (ps ? `\n(PowerShell) ${ps.text}` : ''),
          ...(main.hidden || ps?.hidden ? { hidden: true } : {}),
          event: h.event,
          ...(h.matcher ? { matcher: h.matcher } : {}),
          supported,
          ...(supported ? {} : { unsupportedWhy: `${APP_NAME[h.app]} does not run a folder's hooks from Agent Durbar (they need its own review in a terminal).` }),
        },
        h,
      );
    };
    const mcpAdd = (f: string, app: FolderSetupApp, name: string, spec: McpServerSpec): void => {
      const m = mcpItem(app, rel(f), name, spec);
      if (m.item.detail.length > MAX_SHOWN) problems.push({ file: rel(f), message: `MCP server ${name}: too long to show in full, never used` });
      else add(m.item, m.raw);
    };
    // Claude Code
    for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
      const r = readFile(path.join(dir, ...f.split('/')), true, dir);
      if (r.state === 'error') { problems.push({ file: rel(f), message: r.message }); continue; }
      if (r.state !== 'ok') continue;
      for (const h of readClaudeHooks(r.json, 'claude', tooLong(f))) hookItem(f, h);
      const perms = isObj(r.json) && isObj(r.json.permissions) ? r.json.permissions : {};
      for (const ruleKind of ['allow', 'deny', 'ask'] as const) {
        const list = Array.isArray(perms[ruleKind]) ? (perms[ruleKind] as unknown[]) : [];
        for (const rule of list.slice(0, 100)) {
          const word = ruleKind === 'allow' ? 'Allow' : ruleKind === 'deny' ? 'Deny' : 'Ask';
          // re-review #424: a rule too long to show is a problem, never dropped silently (and never used)
          if (typeof rule === 'string' && rule.length > 500) { problems.push({ file: rel(f), message: `${word.toLowerCase()} rule longer than 500 characters: not shown, never used` }); continue; }
          const s = str(rule, 500);
          if (!s) continue;
          const shown = shownCommand(s);
          add(
            { id: digest(['rule', ruleKind, s]), app: 'claude', kind: 'rule', file: rel(f), label: `${word} rule`, detail: shown.text, ...(shown.hidden ? { hidden: true } : {}), ruleKind, ...(ruleKind === 'allow' && isBroadRule(s) ? { broad: true } : {}), supported: true },
            { kind: 'rule', ruleKind, rule: s },
          );
        }
      }
    }
    // MCP servers in .mcp.json: Durbar can hand them to any app's session (Copilot itself does not read the file, R3)
    {
      const f = '.mcp.json';
      const r = readFile(path.join(dir, f), true, dir);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const s of readMcpJson(r.json)) mcpAdd(f, 'any', s.name, s.spec);
    }
    // Codex
    {
      const f = '.codex/config.toml';
      const r = readFile(path.join(dir, '.codex', 'config.toml'), false, dir);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const s of readCodexMcpToml(r.text)) mcpAdd(f, 'codex', s.name, s.spec);
      const fh = '.codex/hooks.json';
      const rh = readFile(path.join(dir, '.codex', 'hooks.json'), true, dir);
      if (rh.state === 'error') problems.push({ file: rel(fh), message: rh.message });
      else if (rh.state === 'ok') for (const h of readClaudeHooks(rh.json, 'codex', tooLong(fh))) hookItem(fh, h);
    }
    // Copilot
    {
      const hdir = path.join(dir, '.github', 'hooks');
      let names: string[] = [];
      // S2: a linked hooks folder is not followed (readFile also checks each file stays inside the folder)
      let linked = false;
      try { linked = fs.lstatSync(hdir).isSymbolicLink(); } catch { linked = false; }
      if (linked) problems.push({ file: rel('.github/hooks'), message: 'a link: not followed' });
      else try { names = fs.readdirSync(hdir).filter((n) => n.endsWith('.json')).sort().slice(0, MAX_HOOK_FILES); } catch { names = []; }
      for (const n of names) {
        const f = `.github/hooks/${n}`;
        const r = readFile(path.join(hdir, n), true, dir);
        if (r.state === 'error') { problems.push({ file: rel(f), message: r.message }); continue; }
        if (r.state === 'ok') for (const h of readCopilotHooks(r.json, tooLong(f))) hookItem(f, h);
      }
      const f = '.github/copilot/settings.json';
      const r = readFile(path.join(dir, '.github', 'copilot', 'settings.json'), true, dir);
      if (r.state === 'error') problems.push({ file: rel(f), message: r.message });
      else if (r.state === 'ok') for (const h of readCopilotHooks(r.json, tooLong(f))) hookItem(f, h);
    }
  });
  return { items, raw, problems };
}

/** Review nit #424: folder labels for a multi-root workspace that never collide (`app`, `web/app`, then a number). */
export function rootLabels(dirs: readonly string[]): string[] {
  const base = dirs.map((d) => path.basename(d) || d);
  const two = dirs.map((d, i) => (base.filter((b) => b === base[i]).length > 1 ? `${path.basename(path.dirname(d))}/${base[i]}` : base[i]));
  return two.map((l, i) => (two.filter((x) => x === l).length > 1 ? `${l} (${two.slice(0, i + 1).filter((x) => x === l).length})` : l));
}

const SIGNATURE_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', '.codex/config.toml', '.codex/hooks.json', '.github/copilot/settings.json'];
const scanCache = new Map<string, { sig: string; scan: ScanResult }>();
/**
 * Review nit #424: the same scan while no setup file changed (size and change time of each file, and the hooks folder's entries).
 * Used where main asks often (every agent's info and start); the dialog and `decide` always read the disk afresh.
 */
export function scanFolderSetupCached(dirs: readonly string[]): ScanResult {
  const parts: string[] = [];
  for (const dir of dirs.slice(0, 8)) {
    for (const f of SIGNATURE_FILES) {
      try { const st = fs.lstatSync(path.join(dir, ...f.split('/'))); parts.push(`${f}:${st.size}:${st.mtimeMs}`); } catch { parts.push(`${f}:-`); }
    }
    try {
      const hd = path.join(dir, '.github', 'hooks');
      for (const n of fs.readdirSync(hd).sort().slice(0, MAX_HOOK_FILES)) { const st = fs.lstatSync(path.join(hd, n)); parts.push(`h/${n}:${st.size}:${st.mtimeMs}`); }
    } catch { parts.push('h:-'); }
  }
  const key = dirs.join('\0');
  const sig = parts.join('|');
  const hit = scanCache.get(key);
  if (hit && hit.sig === sig) return hit.scan;
  const scan = scanFolderSetup(dirs);
  scanCache.set(key, { sig, scan });
  if (scanCache.size > 200) scanCache.delete(scanCache.keys().next().value as string);
  return scan;
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
