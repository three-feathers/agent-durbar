/**
 * Spec 069 FR-005, FR-006: reading and writing the agent apps' user-level MCP lists. Two steps: a preview builds every new file text
 * in main and returns a single-use token (5 minutes); apply writes only files that still hold exactly what was reviewed, each after a
 * backup next to the file, through a temporary file and a rename. No Electron import (unit-tested with temp folders). Secret values
 * stay in main memory inside the pending texts and are dropped after apply, cancel or expiry; they are never logged.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NAME_RE, validateInput } from '../shared/mcp';
import type { McpServerSpec } from '../shared/mcp';
import type { GlobalApp, GlobalApplyItem, GlobalDiff, GlobalDiffItem, GlobalApplyResult, GlobalAppState, GlobalPreview, GlobalPreviewItem, GlobalSecretMode, GlobalState } from '../shared/api';
import { addToText, APP_LABEL, differences, GLOBAL_APPS, neededVars, neutralFrom, offOf, previewText, readGlobal, removeFromText, textHash } from './mcpglobal';
import type { GlobalInput } from './mcpglobal';
import type { GlobalFile } from './mcpglobal';

const MAX_BYTES = 8 * 1024 * 1024; // ~/.claude.json also keeps Claude Code's project state and can be a few MiB
export const TOKEN_MS = 5 * 60 * 1000;
export const KEEP_BACKUPS = 3;
/** FR-051: shown on a Copilot item of a review in reference mode. */
export const COPILOT_REF_NOTE = 'Not verified for Copilot: whether the Copilot CLI replaces ${NAME} with the variable\'s value. Check the server starts in a Copilot session.';

export type FileRead = { ok: true; text: string | undefined } | { ok: false; error: string };

/** The file's text, `undefined` when it does not exist; refused when too big or not readable (FR edge cases). */
export function readFileSafe(file: string): FileRead {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, text: undefined } : { ok: false, error: 'The file could not be read.' };
  }
  if (!st.isFile()) return { ok: false, error: 'This is not a regular file. Nothing was written.' };
  if (st.size > MAX_BYTES) return { ok: false, error: 'The file is larger than 8 MiB. Nothing was written.' };
  try {
    const buf = fs.readFileSync(file);
    const text = buf.toString('utf8');
    if (Buffer.from(text, 'utf8').length !== buf.length) return { ok: false, error: 'The file is not UTF-8 text. Nothing was written.' };
    return { ok: true, text };
  } catch {
    return { ok: false, error: 'The file could not be read.' };
  }
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** FR-006: keep the newest `KEEP_BACKUPS` of Durbar's own backups of this file; never touches other files. */
export function pruneBackups(file: string): void {
  const dir = path.dirname(file);
  const pre = path.basename(file) + '.durbar-';
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith(pre) && n.endsWith('.bak') && /^\d{8}T\d{6}Z(-\d+)?\.bak$/.test(n.slice(pre.length)));
  } catch {
    return;
  }
  names.sort((a, b) => {
    const ka = a.slice(pre.length).replace(/\.bak$/, '');
    const kb = b.slice(pre.length).replace(/\.bak$/, '');
    const [sa, na] = ka.split('-');
    const [sb, nb] = kb.split('-');
    return sa === sb ? Number(na ?? 0) - Number(nb ?? 0) : sa < sb ? -1 : 1;
  });
  for (const n of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, n));
    } catch {
      /* a backup that cannot be deleted stays */
    }
  }
}

/**
 * The file to write for `file`: itself, or the file a symbolic link (or a chain of them) points to, also when that file does not exist
 * yet (a dangling link to a file the agent app has not created). Undefined when a link cannot be followed (a loop, too deep, unreadable).
 */
export function writeTarget(file: string): string | undefined {
  let cur = path.resolve(file);
  for (let hops = 0; hops < 32; hops++) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? cur : undefined;
    }
    if (!st.isSymbolicLink()) return cur;
    try {
      cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * FR-006 (change 2026-10-22, review 1 on #489): the mode of the written file: the original mode without its group and other bits (a
 * stricter one is kept), 0600 for a new file, so a value written in plain text is never readable by other local users. Windows has no
 * POSIX mode; the temporary file in the same folder takes that folder's inherited ACL.
 */
export const ownerOnlyMode = (mode: number | undefined): number => (mode === undefined ? 0o600 : mode & 0o700 || 0o600);

/**
 * FR-006: back up (when the file exists), then write through `<file>.durbar-tmp` and a rename. `expect` is the hash of the text that was
 * reviewed: a file that changed since is not written (checked before the backup and again right before the rename). Returns the
 * backup's file name.
 */
export function backupAndWrite(link: string, text: string, expect: string, now: number): { ok: true; backup?: string } | { ok: false; error: string } {
  // Spec 069 change 2026-10-22 (review on #489): a symlinked file (dotfile managers link ~/.claude.json or ~/.codex/config.toml) is
  // written through the link: backup, temporary file and rename happen next to the real file, and the link stays a link.
  const file = writeTarget(link);
  if (file === undefined) return { ok: false, error: 'The file is a link that could not be followed. Nothing was written.' };
  const cur = readFileSafe(file);
  if (!cur.ok) return cur;
  if (textHash(cur.text) !== expect) return { ok: false, error: 'The file changed since you reviewed it. Review again.' };
  let mode = ownerOnlyMode(undefined);
  let backup: string | undefined;
  try {
    if (cur.text !== undefined) {
      mode = ownerOnlyMode(fs.statSync(file).mode & 0o777);
      let bak = `${file}.durbar-${stamp(now)}.bak`;
      for (let i = 2; fs.existsSync(bak) && i < 100; i++) bak = `${file}.durbar-${stamp(now)}-${i}.bak`;
      fs.copyFileSync(file, bak, fs.constants.COPYFILE_EXCL);
      if (process.platform !== 'win32') fs.chmodSync(bak, 0o600);
      backup = path.basename(bak);
    } else fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return { ok: false, error: 'Could not make a backup, so nothing was written.' };
  }
  const tmp = `${file}.durbar-tmp`;
  const drop = (): void => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
  };
  try {
    drop(); // a stale temporary file would keep its own mode: always create a new one (`wx`) with the owner-only mode
    fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
    if (process.platform !== 'win32') fs.chmodSync(tmp, mode); // the umask may have taken bits away; never adds group or other
  } catch {
    drop();
    return { ok: false, error: 'Could not write the file; it was left as it was.' };
  }
  // narrow the window in which the agent app itself rewrites the file (Claude Code rewrites ~/.claude.json) between review and rename
  const again = readFileSafe(file);
  if (!again.ok || textHash(again.text) !== expect) {
    drop();
    return { ok: false, error: 'The file changed while it was being written. Nothing was written; review again.' };
  }
  try {
    fs.renameSync(tmp, file);
  } catch {
    drop();
    return { ok: false, error: 'Could not write the file; it was left as it was.' };
  }
  pruneBackups(file);
  return { ok: true, backup };
}

interface PendingFile {
  app: GlobalApp;
  file: GlobalFile;
  hash: string;
  text?: string;
  /** Add with a name that is already there: the text that replaces it (only with the user's tick). */
  replaceText?: string;
  error?: string;
}

interface Pending {
  created: number;
  files: PendingFile[];
}

/** A server of an app's list as a session option (main only; values included). */
function specOf(e: Record<string, unknown>): McpServerSpec | undefined {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const map = (v: unknown): Record<string, string> =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string') as [string, string][]) : {};
  const type = str(e.type)?.toLowerCase();
  if (str(e.command) && (type === undefined || type === 'stdio' || type === 'local'))
    return { type: 'stdio', command: str(e.command), args: Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : [], env: map(e.env), tools: ['*'] };
  if (str(e.url) && (type === 'http' || type === 'sse' || type === undefined)) return { type: type === 'sse' ? 'sse' : 'http', url: str(e.url), headers: map(e.headers), tools: ['*'] };
  return undefined;
}

export class GlobalLists {
  private pending = new Map<string, Pending>();
  /** Last read of each file by size and modification time: lists and session options are asked often (every MCP event masks with them). */
  private cache = new Map<string, { size: number; mtimeMs: number; read: FileRead; parsed?: ReturnType<typeof readGlobal> }>();

  /** `readFileSafe`, reused while the file's size and modification time are unchanged (reviews and writes always read afresh). */
  private readCached(file: string): FileRead {
    let st: fs.Stats | undefined;
    try {
      st = fs.statSync(file);
    } catch {
      st = undefined;
    }
    const c = this.cache.get(file);
    if (st && c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.read;
    const read = readFileSafe(file);
    if (st) this.cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, read });
    else this.cache.delete(file);
    return read;
  }

  /** The file read and parsed, both reused while it is unchanged. */
  private parsedOf(app: GlobalApp, file: string): { read: FileRead; parsed?: ReturnType<typeof readGlobal> } {
    const read = this.readCached(file);
    if (!read.ok) return { read };
    const c = this.cache.get(file);
    if (c && c.read === read) return { read, parsed: (c.parsed ??= readGlobal(app, read.text)) };
    return { read, parsed: readGlobal(app, read.text) };
  }

  constructor(
    private readonly files: () => Record<GlobalApp, GlobalFile>,
    private readonly now: () => number = Date.now,
  ) {}

  private sweep(): void {
    const t = this.now();
    for (const [k, p] of this.pending) if (t - p.created > TOKEN_MS) this.pending.delete(k);
  }

  /** FR-008: every app's list, read now (names only). */
  state(offOf: (app: GlobalApp) => string[]): GlobalState {
    const f = this.files();
    const apps: GlobalAppState[] = GLOBAL_APPS.map((app) => {
      const { read: r, parsed } = this.parsedOf(app, f[app].file);
      const base = { app, label: APP_LABEL[app], file: f[app].label, off: offOf(app) };
      if (!r.ok || !parsed) return { ...base, found: true, error: r.ok ? 'The file could not be read.' : r.error, servers: [] };
      const g = parsed;
      return g.ok ? { ...base, found: r.text !== undefined, servers: g.servers } : { ...base, found: true, error: g.error, servers: [] };
    });
    return { ok: true, apps };
  }

  /** FR-009: the servers of one app's list for a session (values included, main only), minus `off`. */
  sessionServers(app: GlobalApp, off: ReadonlySet<string>): Record<string, McpServerSpec> {
    const { parsed: g } = this.parsedOf(app, this.files()[app].file);
    if (!g || !g.ok) return {};
    const out: Record<string, McpServerSpec> = {};
    for (const [name, e] of g.values) {
      if (off.has(name)) continue;
      const s = specOf(e);
      if (s) out[name] = s;
    }
    return out;
  }

  private apps(list: unknown): GlobalApp[] {
    return Array.isArray(list) ? GLOBAL_APPS.filter((a) => list.includes(a)) : [];
  }

  /** FR-005: what adding the server would write to each chosen app's file. Nothing is written. */
  preview(input: unknown, appList: unknown, mode: unknown): GlobalPreview {
    this.sweep();
    const apps = this.apps(appList);
    if (!apps.length) return { ok: false, error: 'Pick at least one agent app.', items: [] };
    const v = validateInput(input);
    if (!v.ok) return { ok: false, error: v.error, items: [] };
    const sm: GlobalSecretMode = mode === 'plain' ? 'plain' : 'ref';
    return this.previewInput(v.value, apps, sm);
  }

  /** FR-005: the per-file review of writing `x` to `apps` (the add form's input, or a harmonize copy). */
  private previewInput(x: GlobalInput, apps: GlobalApp[], sm: GlobalSecretMode): GlobalPreview {
    const f = this.files();
    const items: GlobalPreviewItem[] = [];
    const files: PendingFile[] = [];
    for (const app of apps) {
      const gf = f[app];
      const r = readFileSafe(gf.file);
      const base = { app, label: APP_LABEL[app], file: gf.label, exists: r.ok && r.text !== undefined, entry: previewText(app, x, sm) };
      if (!r.ok) {
        items.push({ ...base, error: r.error });
        files.push({ app, file: gf, hash: '', error: r.error });
        continue;
      }
      const add = addToText(app, r.text, x, sm, false);
      // FR-004, FR-051 (change 2026-10-22, review 4 on #489): Copilot expanding `${NAME}` was not observed in the real check
      const note = app === 'copilot' && sm === 'ref' && neededVars(x).length ? COPILOT_REF_NOTE : undefined;
      if (add.ok) {
        items.push(note ? { ...base, note } : base);
        files.push({ app, file: gf, hash: textHash(r.text), text: add.text });
      } else if (add.conflict) {
        const rep = addToText(app, r.text, x, sm, true);
        const g = readGlobal(app, r.text);
        const current = g.ok ? g.servers.find((s) => s.name === x.name) : undefined;
        items.push({ ...base, conflict: true, ...(current ? { current } : {}), ...(rep.ok ? {} : { error: rep.error }), ...(note ? { note } : {}) });
        files.push({ app, file: gf, hash: textHash(r.text), replaceText: rep.ok ? rep.text : undefined, error: rep.ok ? undefined : rep.error });
      } else {
        items.push({ ...base, error: add.error });
        files.push({ app, file: gf, hash: '', error: add.error });
      }
    }
    const token = randomUUID();
    this.pending.set(token, { created: this.now(), files });
    const vars = neededVars(x, sm);
    return { ok: true, token, items, ...(vars.length ? { vars } : {}) };
  }

  /**
   * FR-020: servers that are missing in some readable app list, or defined differently, with the names of the fields that differ
   * (values are compared here and never returned). Empty when fewer than two lists can be read.
   */
  diff(): GlobalDiff {
    const f = this.files();
    const lists = new Map<GlobalApp, Map<string, Record<string, unknown>>>();
    for (const app of GLOBAL_APPS) {
      const { parsed } = this.parsedOf(app, f[app].file);
      if (parsed && parsed.ok) lists.set(app, parsed.values);
    }
    const apps = [...lists.keys()];
    if (apps.length < 2) return { ok: true, apps, items: [] };
    const names: string[] = [];
    for (const m of lists.values()) for (const n of m.keys()) if (!names.includes(n)) names.push(n);
    const items: GlobalDiffItem[] = [];
    for (const name of names.slice(0, 200)) {
      const inApps = apps.filter((a) => lists.get(a)?.has(name));
      const missing = apps.filter((a) => !inApps.includes(a));
      const conv = inApps.map((a) => ({ a, n: neutralFrom(a, name, lists.get(a)?.get(name) ?? {}) }));
      const ok = conv.filter((c) => c.n.ok) as { a: GlobalApp; n: { ok: true; input: GlobalInput } }[];
      const diffs = new Set<string>();
      for (const c of ok.slice(1)) for (const d of differences(ok[0].n.input, c.n.input)) diffs.add(d);
      if (!missing.length && !diffs.size) continue;
      const copyable = ok.map((c) => c.a);
      items.push({ name, in: inApps, missing, differs: [...diffs], from: copyable, ...(copyable.length ? {} : { error: (conv[0]?.n as { error?: string })?.error ?? 'Agent Durbar cannot copy this server.' }) });
    }
    return { ok: true, apps, items };
  }

  /** FR-021: the review of copying `name` from one app's list to others (values stay in main; the preview masks them). */
  copyPreview(name: unknown, from: unknown, toList: unknown): GlobalPreview {
    this.sweep();
    if (typeof name !== 'string' || !name || name.length > 64 || !GLOBAL_APPS.includes(from as GlobalApp)) return { ok: false, error: 'Unknown server.', items: [] };
    const to = this.apps(toList).filter((a) => a !== from);
    if (!to.length) return { ok: false, error: 'Pick at least one agent app to copy to.', items: [] };
    const src = this.files()[from as GlobalApp];
    const r = readFileSafe(src.file);
    const g = r.ok ? readGlobal(from as GlobalApp, r.text) : undefined;
    const raw = g && g.ok ? g.values.get(name) : undefined;
    if (!raw) return { ok: false, error: `"${name}" is not in ${APP_LABEL[from as GlobalApp]}'s list any more.`, items: [] };
    const n = neutralFrom(from as GlobalApp, name, raw);
    if (!n.ok) return { ok: false, error: n.error, items: [] };
    if (!NAME_RE.test(name)) return { ok: false, error: 'This name cannot be written by Agent Durbar (letters, digits, "_", "." or "-").', items: [] };
    return this.previewInput(n.input, to, 'plain');
  }

  /** FR-005: what removing `name` would change in each chosen app's file. */
  removePreview(name: unknown, appList: unknown): GlobalPreview {
    this.sweep();
    const apps = this.apps(appList);
    if (typeof name !== 'string' || !name || name.length > 64) return { ok: false, error: 'Unknown server.', items: [] };
    if (!apps.length) return { ok: false, error: 'Pick at least one agent app.', items: [] };
    const f = this.files();
    const items: GlobalPreviewItem[] = [];
    const files: PendingFile[] = [];
    for (const app of apps) {
      const gf = f[app];
      const r = readFileSafe(gf.file);
      const g = r.ok ? readGlobal(app, r.text) : undefined;
      const cur = g && g.ok ? g.servers.find((s) => s.name === name) : undefined;
      const entry = cur ? [cur.command ? [cur.command, ...(cur.args ?? [])].join(' ') : (cur.url ?? ''), cur.envKeys.length ? `env: ${cur.envKeys.join(', ')}` : '', cur.headerKeys.length ? `headers: ${cur.headerKeys.join(', ')}` : ''].filter(Boolean).join('\n') : '';
      const base = { app, label: APP_LABEL[app], file: gf.label, exists: r.ok && r.text !== undefined, entry };
      if (!r.ok) {
        items.push({ ...base, error: r.error });
        files.push({ app, file: gf, hash: '', error: r.error });
        continue;
      }
      const rm = removeFromText(app, r.text, name);
      items.push(rm.ok ? base : { ...base, error: rm.error });
      files.push(rm.ok ? { app, file: gf, hash: textHash(r.text), text: rm.text } : { app, file: gf, hash: '', error: rm.error });
    }
    const token = randomUUID();
    this.pending.set(token, { created: this.now(), files });
    return { ok: true, token, items };
  }

  /** FR-005, FR-006: write a reviewed preview (single use). `replace` lists the apps where an existing entry may be replaced. */
  apply(token: unknown, replaceList: unknown = []): GlobalApplyResult {
    this.sweep();
    const p = typeof token === 'string' ? this.pending.get(token) : undefined;
    if (!p) return { ok: false, error: 'This review has expired. Review again.', items: [] };
    this.pending.delete(token as string);
    const replace = this.apps(replaceList);
    const items: GlobalApplyItem[] = [];
    for (const pf of p.files) {
      const base = { app: pf.app, file: pf.file.label };
      if (pf.error) {
        items.push({ ...base, ok: false, error: pf.error });
        continue;
      }
      const text = pf.text ?? (replace.includes(pf.app) ? pf.replaceText : undefined);
      if (text === undefined) {
        items.push({ ...base, ok: false, error: 'Already there; not replaced.' });
        continue;
      }
      const w = backupAndWrite(pf.file.file, text, pf.hash, this.now());
      items.push(w.ok ? { ...base, ok: true, ...(w.backup ? { backup: w.backup } : {}) } : { ...base, ok: false, error: w.error });
    }
    return { ok: items.some((i) => i.ok), items };
  }

  /** Test helper: pending reviews (their texts never leave main). */
  pendingCount(): number {
    return this.pending.size;
  }
}

/**
 * FR-009: the user-list servers Durbar passes to one agent's session: Claude Code's list for a Claude agent (Claude sessions run with
 * `--strict-mcp-config`), minus the Settings off-list; nothing for Copilot (it loads its own list) or Codex (it starts its own list).
 */
export function sessionGlobalFor(appId: string | undefined, lists: Pick<GlobalLists, 'sessionServers'>, offList: readonly string[]): Record<string, McpServerSpec> {
  return appId === 'claude' ? lists.sessionServers('claude', new Set(offOf('claude', offList))) : {};
}
