/**
 * Read-only access to VS Code Copilot Chat history ("chatSessions") for a folder.
 *
 * This is VS Code's own, internal and undocumented store. It is NOT the Copilot CLI/SDK session store,
 * so these chats can be read here but not continued. The format below is taken from the VS Code sources
 * (chatSessionStore.ts, chatSessionOperationLog.ts, objectMutationLog.ts) and third-party readers, and is
 * parsed tolerantly: anything unknown is skipped and counted, a note says so, and nothing throws to the UI.
 *
 *   <User>/workspaceStorage/<hash>/workspace.json     {"folder":"file:///…"} or {"workspace":"file:///….code-workspace"}
 *   <User>/workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl   VS Code 1.109+: append log (kind 0 snapshot, 1 set, 2 push/splice, 3 delete)
 *   <User>/workspaceStorage/<hash>/chatSessions/<sessionId>.json    older: one JSON document (same shape as the kind-0 snapshot)
 *
 * Content is never logged or sent anywhere; the only consumer is the local window.
 * Unit-tested in scripts/test-vscodechat.ts with synthetic fixtures.
 */
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normDir } from './history';

export const VSCODE_CHAT_FORMAT_NOTE =
  'VS Code keeps chat history in an internal, undocumented format (known: version 3, VS Code 1.109+ append log and older flat JSON). It can change in any VS Code update; unknown parts are skipped.';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_WORKSPACE_JSON_BYTES = 64 * 1024;
const MAX_SESSIONS = 150;
const MAX_REQUESTS_SHOWN = 300;
const MAX_TEXT_CHARS = 20_000;
const MAX_TOTAL_CHARS = 1_500_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ where VS Code keeps its data ------------------------------------------------------------------ */

export interface UserDir {
  product: string;
  dir: string;
}

/** `User` folders of VS Code builds that use the standard layout, for one platform (not checked for existence). */
export function vscodeUserDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): UserDir[] {
  const j = platform === 'win32' ? path.win32.join : path.posix.join;
  const base =
    platform === 'darwin'
      ? j(homedir, 'Library', 'Application Support')
      : platform === 'win32'
        ? env.APPDATA || j(homedir, 'AppData', 'Roaming')
        : env.XDG_CONFIG_HOME || j(homedir, '.config');
  return ['Code', 'Code - Insiders', 'VSCodium'].map((product) => ({ product, dir: j(base, product, 'User') }));
}

/** `file:///c%3A/Users/a` -> `c:\Users\a` (win32) or `/home/a`. Undefined for other schemes (remote, vscode-vfs, …). */
export function fileUriToPath(uri: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (typeof uri !== 'string' || !/^file:\/\//i.test(uri)) return undefined;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return undefined;
  }
  let p: string;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return undefined;
  }
  if (platform === 'win32') {
    if (u.hostname && u.hostname !== 'localhost') return `\\\\${u.hostname}${p.replace(/\//g, '\\')}`; // UNC share
    return p.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
  }
  return p;
}

export interface FolderTargets {
  /** Folders of the agent (the session cwd first). */
  folders: string[];
  /** The `.code-workspace` file, when the agent was added from one. */
  workspaceFile?: string;
}

export interface ChatStore {
  /** `<User>/workspaceStorage/<hash>` */
  storageDir: string;
  hash: string;
  product: string;
  chatDir: string;
}

/** workspaceStorage entries whose workspace.json points at one of the targets and that have a chatSessions folder. */
export function findChatStores(userDir: UserDir, targets: FolderTargets, platform: NodeJS.Platform = process.platform): ChatStore[] {
  const root = path.join(userDir.dir, 'workspaceStorage');
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const folderSet = new Set(targets.folders.map((f) => normDir(f, platform)));
  const wsFile = targets.workspaceFile ? normDir(targets.workspaceFile, platform) : undefined;
  const out: ChatStore[] = [];
  for (const hash of names) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(hash)) continue;
    const storageDir = path.join(root, hash);
    let meta: unknown;
    try {
      const wj = path.join(storageDir, 'workspace.json');
      if (fs.statSync(wj).size > MAX_WORKSPACE_JSON_BYTES) continue;
      meta = JSON.parse(fs.readFileSync(wj, 'utf8'));
    } catch {
      continue; // no workspace.json, unreadable or corrupt: not ours to guess
    }
    if (!isObj(meta)) continue;
    const folder = typeof meta.folder === 'string' ? fileUriToPath(meta.folder, platform) : undefined;
    const ws = typeof meta.workspace === 'string' ? fileUriToPath(meta.workspace, platform) : undefined;
    const hit = (folder && folderSet.has(normDir(folder, platform))) || (ws && wsFile && normDir(ws, platform) === wsFile);
    if (!hit) continue;
    const chatDir = path.join(storageDir, 'chatSessions');
    try {
      if (!fs.statSync(chatDir).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ storageDir, hash, product: userDir.product, chatDir });
  }
  return out;
}

/* ------------------------------------------------------------------ reading a session file ------------------------------------------------------------------ */

export interface ParsedChat {
  state: Record<string, unknown>;
  /** Log lines that could not be parsed or applied. */
  badLines: number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type Seg = string | number;
const validPath = (k: unknown): k is Seg[] =>
  Array.isArray(k) && k.every((s) => (typeof s === 'string' && !UNSAFE_KEYS.has(s)) || (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < 1e7));

/** Walk `k` (creating missing containers); returns the parent container and last key. */
function walk(state: unknown, k: Seg[]): { parent: Record<string, unknown> | unknown[]; key: Seg } | undefined {
  if (!k.length) return undefined;
  let cur: unknown = state;
  for (let i = 0; i < k.length - 1; i++) {
    const seg = k[i];
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    const c = cur as Record<string, unknown>;
    let next = c[seg as string];
    if (next === undefined || next === null) {
      next = typeof k[i + 1] === 'number' ? [] : {};
      c[seg as string] = next;
    }
    cur = next;
  }
  if (!isObj(cur) && !Array.isArray(cur)) return undefined;
  return { parent: cur as Record<string, unknown> | unknown[], key: k[k.length - 1] };
}

/** Rebuild a session from the text of a `.jsonl` append log. Throws only when no snapshot can be found. */
export function replayLog(text: string): ParsedChat {
  let state: Record<string, unknown> | undefined;
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      bad++; // typically a partially written last line
      continue;
    }
    if (!isObj(e)) {
      bad++;
      continue;
    }
    if (e.kind === 0) {
      if (isObj(e.v)) state = e.v;
      else bad++;
      continue;
    }
    if (!state) {
      bad++;
      continue;
    }
    if (!validPath(e.k) || !e.k.length) {
      bad++;
      continue;
    }
    const w = walk(state, e.k);
    if (!w) {
      bad++;
      continue;
    }
    if (e.kind === 1 || e.kind === 3) {
      (w.parent as Record<string, unknown>)[w.key as string] = e.kind === 3 ? undefined : e.v;
    } else if (e.kind === 2) {
      const p = w.parent as Record<string, unknown>;
      const arr = Array.isArray(p[w.key as string]) ? (p[w.key as string] as unknown[]) : [];
      if (typeof e.i === 'number' && Number.isInteger(e.i) && e.i >= 0) arr.length = Math.min(arr.length, e.i);
      if (Array.isArray(e.v)) arr.push(...e.v);
      p[w.key as string] = arr;
    } else bad++;
  }
  if (!state) throw new Error('no session snapshot found in the log');
  return { state, badLines: bad };
}

export function parseChatText(text: string, ext: '.json' | '.jsonl'): ParsedChat {
  if (ext === '.jsonl') return replayLog(text);
  const doc = JSON.parse(text);
  if (!isObj(doc)) throw new Error('not a chat session document');
  return { state: doc, badLines: 0 };
}

const requestsOf = (state: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(state.requests) ? state.requests.filter(isObj) : [];

/** Message text of a request: `message` is `{text}` (current) or a plain string (old files). */
function requestText(req: Record<string, unknown>): string {
  const m = req.message;
  if (typeof m === 'string') return m;
  if (isObj(m) && typeof m.text === 'string') return m.text;
  return '';
}

const oneLine = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export interface VsChatSummary {
  /** Opaque key (`<storage hash>/<session id>`), resolved to a file only inside the main process. */
  key: string;
  title: string;
  created?: number;
  updated?: number;
  requests: number;
  format: 'jsonl' | 'json';
}

export function summarize(parsed: ParsedChat, key: string, format: 'jsonl' | 'json', mtimeMs: number): VsChatSummary | undefined {
  const reqs = requestsOf(parsed.state);
  if (!reqs.length) return undefined; // VS Code itself hides empty chats
  const custom = typeof parsed.state.customTitle === 'string' ? parsed.state.customTitle.trim() : '';
  const first = requestText(reqs[0]);
  const created = typeof parsed.state.creationDate === 'number' ? parsed.state.creationDate : undefined;
  const lastTs = reqs.map((r) => (typeof r.timestamp === 'number' ? r.timestamp : 0)).reduce((a, b) => Math.max(a, b), 0);
  return {
    key,
    title: oneLine(custom || first, 120) || 'Untitled chat',
    created,
    updated: lastTs || mtimeMs || created,
    requests: reqs.length,
    format,
  };
}

/* ------------------------------------------------------------------ transcript ------------------------------------------------------------------ */

export type VsChatBlock =
  | { type: 'user'; text: string; attachments?: string[]; ts?: number }
  | { type: 'assistant'; text: string; ts?: number }
  | { type: 'tool'; label: string }
  | { type: 'note'; text: string };

export interface VsChatTranscript {
  title: string;
  blocks: VsChatBlock[];
  /** Requests in the chat / shown. */
  totalRequests: number;
  shownRequests: number;
  /** Things we could not interpret (never an error): shown as one honest line. */
  notes: string[];
}

const textOfMsg = (m: unknown): string => (typeof m === 'string' ? m : isObj(m) && typeof m.value === 'string' ? m.value : '');
const baseName = (s: string): string => {
  const t = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const b = t.slice(t.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(b);
  } catch {
    return b;
  }
};

/** `Read [](file:///a/b.ts), lines 1 to 20` -> `Read b.ts, lines 1 to 20`; keeps link text when there is some. */
export function plainLinks(s: string): string {
  return s.replace(/\[([^\]]*)\]\(((?:file|vscode|https?|command)[^)\s]*)\)/gi, (_m, label: string, uri: string) => label || baseName(uri));
}

const uriName = (u: unknown): string => {
  if (typeof u === 'string') return baseName(u);
  if (isObj(u)) {
    if (typeof u.path === 'string') return baseName(u.path);
    if (typeof u.fsPath === 'string') return baseName(u.fsPath);
    if (typeof u.external === 'string') return baseName(u.external);
  }
  return '';
};

const QUESTIONS_SHOWN = 20;
const OPTIONS_SHOWN = 30;
const strOf = (v: unknown, max: number): string => (typeof v === 'string' ? oneLine(plainLinks(v), max) : '');

/** `questionCarousel` part -> a plain read-only text (the questions VS Code asked; no answer is shown). */
function questionText(part: Record<string, unknown>): string {
  const qs = Array.isArray(part.questions) ? part.questions.filter(isObj).slice(0, QUESTIONS_SHOWN) : [];
  if (!qs.length) return '';
  const lines: string[] = ['Copilot asked (read-only copy, not answerable here):'];
  for (const q of qs) {
    const title = strOf(q.title, 300);
    const msg = isObj(q.message) ? strOf(q.message.value, 1000) : strOf(q.message, 1000);
    lines.push('', `**${title || 'Question'}**` + (msg && msg !== title ? `: ${msg}` : ''));
    const opts = Array.isArray(q.options) ? q.options.filter(isObj).slice(0, OPTIONS_SHOWN) : [];
    for (const o of opts) {
      const l = strOf(o.label, 200) || strOf(o.value, 200);
      if (l) lines.push(`- ${l}`);
    }
    if (q.allowFreeformInput === true) lines.push('(free text allowed)');
  }
  if (part.allowSkip === true) lines.push('', '(can be skipped)');
  return lines.join('\n');
}

/** Response parts -> blocks (assistant text, tool lines). Markdown stays as text; nothing is rendered as HTML. */
function responseBlocks(parts: unknown[], unknownKinds: Set<string>): VsChatBlock[] {
  const blocks: VsChatBlock[] = [];
  let buf = '';
  const flush = (): void => {
    const t = buf.replace(/```\s*\n\s*```/g, '').trim(); // empty fences are placeholders for edited files
    if (t) blocks.push({ type: 'assistant', text: t });
    buf = '';
  };
  let lastEdit = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      buf += part;
      continue;
    }
    if (!isObj(part)) continue;
    const kind = typeof part.kind === 'string' ? part.kind : undefined;
    if (kind === undefined && typeof part.value === 'string') {
      buf += part.value; // serialized MarkdownString chunk
      continue;
    }
    switch (kind) {
      case 'markdownContent':
        if (isObj(part.content) && typeof part.content.value === 'string') buf += part.content.value;
        break;
      case 'inlineReference': {
        const n = (typeof part.name === 'string' && part.name) || uriName(part.inlineReference) || uriName(part.uri);
        if (n) buf += '`' + n + '`';
        break;
      }
      case 'toolInvocationSerialized': {
        flush();
        const msg = plainLinks(textOfMsg(part.pastTenseMessage) || textOfMsg(part.invocationMessage)).replace(/\s+/g, ' ').trim();
        const sd = isObj(part.toolSpecificData) ? part.toolSpecificData : undefined;
        let cmd = '';
        if (sd && sd.kind === 'terminal') {
          const c = sd.commandLine;
          cmd = typeof sd.command === 'string' ? sd.command : isObj(c) ? String(c.original ?? c.toolEdited ?? c.userEdited ?? '') : '';
        }
        const id = typeof part.toolId === 'string' ? part.toolId : 'tool';
        blocks.push({ type: 'tool', label: oneLine(cmd ? `${msg || id}: ${cmd}` : msg || id, 300) });
        break;
      }
      case 'textEditGroup': {
        const n = uriName(part.uri);
        if (n && n !== lastEdit) {
          flush();
          blocks.push({ type: 'tool', label: `Edited ${n}` });
        }
        lastEdit = n;
        break;
      }
      // Known and deliberately skipped: reasoning text, UI chrome, bookkeeping.
      case 'thinking':
      case 'codeblockUri':
      case 'progressMessage':
      case 'progressTaskSerialized':
      case 'undoStop':
      case 'clearToPreviousToolInvocation':
      case 'confirmation':
      case 'warning':
      case 'info':
      case 'systemNotification':
      case 'hook':
      case 'command':
      case 'treeData':
      case 'extensions':
      case 'autoModeResolution':
      case 'mcpServersStarting': // only lists the ids of MCP servers that were starting
        break;
      case 'questionCarousel': {
        // Read-only: titles, messages and option labels as plain text (never a control). Shape known from VS Code 1.109+; every string is untrusted.
        const text = questionText(part);
        if (text) {
          flush();
          blocks.push({ type: 'assistant', text });
        }
        break;
      }
      default:
        if (kind) unknownKinds.add(kind);
    }
  }
  flush();
  return blocks;
}

const capText = (s: string, left: { n: number }): string => {
  const t = s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + '…' : s;
  left.n -= t.length;
  return t;
};

export function toTranscript(parsed: ParsedChat): VsChatTranscript {
  const state = parsed.state;
  const all = requestsOf(state);
  const shown = all.length > MAX_REQUESTS_SHOWN ? all.slice(all.length - MAX_REQUESTS_SHOWN) : all;
  const custom = typeof state.customTitle === 'string' ? state.customTitle.trim() : '';
  const notes: string[] = [];
  const unknownKinds = new Set<string>();
  const blocks: VsChatBlock[] = [];
  const left = { n: MAX_TOTAL_CHARS };
  for (const req of shown) {
    if (left.n <= 0) {
      notes.push('The rest of this long chat is not shown.');
      break;
    }
    if (req.hiddenFromTranscript === true || req.requestHiddenFromTranscript === true) continue;
    const vars = isObj(req.variableData) && Array.isArray(req.variableData.variables) ? req.variableData.variables.filter(isObj) : [];
    const names = vars.map((v) => (typeof v.name === 'string' ? v.name : '')).filter(Boolean).slice(0, 10);
    const text = requestText(req).trim();
    if (text || names.length) {
      blocks.push({ type: 'user', text: capText(text, left), attachments: names.length ? names : undefined, ts: typeof req.timestamp === 'number' ? req.timestamp : undefined });
    }
    const resp = Array.isArray(req.response) ? req.response : typeof req.response === 'string' ? [req.response] : [];
    for (const b of responseBlocks(resp, unknownKinds)) {
      if (b.type === 'assistant') b.text = capText(b.text, left);
      blocks.push(b);
    }
    const err = isObj(req.result) && isObj(req.result.errorDetails) ? req.result.errorDetails.message : undefined;
    if (typeof err === 'string' && err) blocks.push({ type: 'note', text: 'This response ended with an error: ' + oneLine(err, 300) });
  }
  if (all.length > shown.length) notes.push(`Only the last ${shown.length} of ${all.length} messages are shown.`);
  if (parsed.badLines) notes.push(`${parsed.badLines} unreadable line(s) in the log were skipped; the transcript may be incomplete.`);
  if (unknownKinds.size) notes.push(`${unknownKinds.size} kind(s) of content were not recognised and skipped (${[...unknownKinds].slice(0, 5).join(', ')}). VS Code's format may have changed.`);
  const ver = state.version;
  if (typeof ver === 'number' && ver !== 3) notes.push(`This chat uses format version ${ver}; only version 3 has been checked.`);
  if (ver === undefined) notes.push('This file has no format version; it may be from a very old or very new VS Code.');
  return {
    title: oneLine(custom || (all[0] ? requestText(all[0]) : ''), 120) || 'Untitled chat',
    blocks,
    totalRequests: all.length,
    shownRequests: shown.length,
    notes,
  };
}

/* ------------------------------------------------------------------ listing ------------------------------------------------------------------ */

export interface ChatFileRef {
  summary: VsChatSummary;
  file: string;
}

export interface ChatListing {
  sessions: ChatFileRef[];
  /** Matching VS Code workspace storage folders found (0 = VS Code never opened this folder, or not installed). */
  storesFound: number;
  /** Files that exist but could not be read or understood. */
  unreadable: number;
  tooLarge: number;
}

const FILE_RE = /^([A-Za-z0-9_-]{1,100})\.(jsonl|json)$/;

/** All chats of the matching stores in the given `User` folders, newest first. Never throws. */
export async function listChats(userDirs: UserDir[], targets: FolderTargets, platform: NodeJS.Platform = process.platform): Promise<ChatListing> {
  const stores = userDirs.flatMap((u) => findChatStores(u, targets, platform));
  const files: { key: string; id: string; file: string; ext: '.json' | '.jsonl'; mtime: number }[] = [];
  let tooLarge = 0;
  for (const s of stores) {
    let names: string[] = [];
    try {
      names = await fsp.readdir(s.chatDir);
    } catch {
      continue;
    }
    const byId = new Map<string, { name: string; ext: '.json' | '.jsonl' }>();
    for (const n of names) {
      const m = FILE_RE.exec(n);
      if (!m) continue;
      const cur = byId.get(m[1]);
      if (!cur || m[2] === 'jsonl') byId.set(m[1], { name: n, ext: m[2] === 'jsonl' ? '.jsonl' : '.json' }); // .jsonl wins over .json
    }
    for (const [id, { name, ext }] of byId) {
      const file = path.join(s.chatDir, name);
      try {
        const st = await fsp.stat(file);
        if (!st.isFile() || st.size === 0) continue;
        if (st.size > MAX_FILE_BYTES) {
          tooLarge++;
          continue;
        }
        files.push({ key: `${s.hash}/${id}`, id, file, ext, mtime: st.mtimeMs });
      } catch {
        /* vanished */
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const sessions: ChatFileRef[] = [];
  let unreadable = 0;
  for (const f of files.slice(0, MAX_SESSIONS)) {
    try {
      const sum = summarize(parseChatText(await fsp.readFile(f.file, 'utf8'), f.ext), f.key, f.ext === '.jsonl' ? 'jsonl' : 'json', f.mtime);
      if (sum) sessions.push({ summary: sum, file: f.file });
    } catch {
      unreadable++;
    }
  }
  sessions.sort((a, b) => (b.summary.updated ?? 0) - (a.summary.updated ?? 0));
  return { sessions, storesFound: stores.length, unreadable, tooLarge };
}

/** Read one listed chat as a transcript. Returns an error string instead of throwing. */
export async function readChat(ref: ChatFileRef): Promise<{ ok: true; transcript: VsChatTranscript } | { ok: false; error: string }> {
  try {
    const ext = ref.file.endsWith('.jsonl') ? '.jsonl' : '.json';
    return { ok: true, transcript: toTranscript(parseChatText(await fsp.readFile(ref.file, 'utf8'), ext)) };
  } catch {
    return { ok: false, error: 'This chat file could not be read (missing, corrupt or in a format this version does not know).' };
  }
}
