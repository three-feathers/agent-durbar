/**
 * Spec 111 FR-001, FR-003, FR-021 (T006): the one store of team templates, `<userData>/team-templates.json`. Written by main only. No Electron
 * import, no spawn, no shell; the file system is injected (`TeamFs`) so a test drives a fake, a crash and a huge file.
 *
 * Reused, not rebuilt (FR-031): `readCapped` (`src/shared/cappedread.ts`, the one capped no-follow read), the save steps of `SettingsStore.save`
 * (temp file, mode 0600, rename), the `.bad-<time>` set-aside of the schedules and notes stores (`schedules.ts` `setAside`), `checkTeamTemplate`
 * (the only reader of a template object, FR-010) and `nameKey` (names compared as the person reads them, FR-012).
 *
 * Constitution III: the store holds role briefs. Nothing here logs, and no error text carries a field's value, only fixed words and the
 * validator's own messages (which name a field, never its text).
 *
 * Limits (honest): the file mode 0600 applies on POSIX only; on Windows `mode` is ignored and the file has the folder's permissions (FR-155).
 * Not run on Windows or macOS here (the paths use `path.join`/`path.extname` only).
 */
import * as nodeFs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { readCapped, type CappedFs, type CappedFlags } from '../shared/cappedread';
import { checkTeamTemplate, LIMITS, type TeamTemplate } from '../shared/teamtemplate';
import { nameKey } from '../shared/skeleton';
import { removeStaleTemps } from './schedules';
import { pidAlive } from './crashmarker';

/** 50 templates of 8 members of 4,000 characters (up to 4 bytes each) stay far below this; a bigger file is not ours. */
export const MAX_STORE_BYTES = 16 * 1024 * 1024;

/** The calls used; `node:fs` fits. */
export interface TeamFs extends CappedFs {
  mkdirSync(dir: string, opts: { recursive: true; mode: number }): unknown;
  /** size and modified time: the file's fingerprint (two running instances) */
  statSync(file: string): { size: number; mtimeMs: number };
  existsSync(p: string): boolean;
  writeFileSync(file: string, data: string, opts: { mode: number; flag: string }): void;
  /** flushes the temp file to disk before the rename (power loss); best effort */
  fsyncFile(file: string): void;
  readdirSync(dir: string): string[];
  renameSync(from: string, to: string): void;
  rmSync(p: string, opts: { force: true }): void;
}
export interface TeamStoreDeps {
  fs?: TeamFs; flags?: CappedFlags; now?: () => number; newId?: () => string; pid?: number; alive?: (pid: number) => boolean;
  /** a short blocking pause (a held file, a Windows rename); injected so a test does not wait */
  pause?: (ms: number) => void; platform?: NodeJS.Platform;
}
/** A template as stored: main's metadata is always set (FR-003). */
export type StoredTemplate = TeamTemplate & { id: string; origin: 'own' | 'imported'; createdAt: number; updatedAt: number };
export type StoreResult<T> = ({ ok: true } & T) | { ok: false; errors: string[] };

const realFs: TeamFs = {
  openSync: (f, fl) => nodeFs.openSync(f, fl), fstatSync: (fd) => nodeFs.fstatSync(fd), readSync: (fd, b, o, l, p) => nodeFs.readSync(fd, b, o, l, p), closeSync: (fd) => nodeFs.closeSync(fd),
  mkdirSync: (d, o) => nodeFs.mkdirSync(d, o), statSync: (f) => nodeFs.statSync(f), existsSync: (p) => nodeFs.existsSync(p), writeFileSync: (f, d, o) => nodeFs.writeFileSync(f, d, o),
  renameSync: (a, b) => nodeFs.renameSync(a, b), rmSync: (p, o) => nodeFs.rmSync(p, o), readdirSync: (d) => nodeFs.readdirSync(d),
  fsyncFile: (f) => { const fd = nodeFs.openSync(f, 'r+'); try { nodeFs.fsyncSync(fd); } finally { nodeFs.closeSync(fd); } },
};
const FORMAT = 'agent-durbar-team-templates';
/** The newest schemaVersion this build writes. Older files are upgraded in memory by `MIGRATIONS[v]` (v -> v + 1), pure; none exists yet (FR-004). */
export const SCHEMA_VERSION = 1;
export const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};
const pauseSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** how many `team-templates.bad-<time>.json` files are kept (each may hold briefs) */
export const KEEP_BAD = 5;
const TRAILING_JOINERS = /[\u200C\u200D\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA\u1039\u17D2\u1B44\uA8C4\uA9C0]+$/u;
const SAVE_FAILED = 'The team templates could not be saved.';
const graphemes = (t: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map((x) => x.segment);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class TeamTemplateStore {
  private items: StoredTemplate[] = [];
  private readonly fs: TeamFs;
  private readonly flags: CappedFlags;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly pid: number;
  private readonly alive: (pid: number) => boolean;
  private readonly pause: (ms: number) => void;
  private readonly platform: NodeJS.Platform;
  /** size and modified time of the file at the load or the last save; a save finds the file changed (another running instance) and is refused */
  private fp = '';
  private toast = false;
  /** a bad file that could not be moved: nothing is written over it until the move works */
  private blocked = false;

  constructor(private readonly file: string, deps: TeamStoreDeps = {}) {
    this.fs = deps.fs ?? realFs;
    this.flags = deps.flags ?? nodeFs.constants;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomBytes(16).toString('hex'));
    this.pid = deps.pid ?? process.pid;
    this.alive = deps.alive ?? pidAlive;
    this.pause = deps.pause ?? pauseSync;
    this.platform = deps.platform ?? process.platform;
    this.load();
  }

  /** True once after a bad file was set aside at load (the caller shows one toast, no content); false after that. */
  takeToast(): boolean {
    const t = this.toast;
    this.toast = false;
    return t;
  }

  /** True while a bad file could not be set aside: the list shows the valid part and every save is refused (T007 shows a notice, not a toast). */
  isBlocked(): boolean { return this.blocked; }

  list(): StoredTemplate[] { return clone(this.items); }
  get(id: string): StoredTemplate | undefined {
    const t = this.items.find((x) => x.id === id);
    return t ? clone(t) : undefined;
  }

  /**
   * Create (no id) or update (a known id), from the window. Validated at level `own` (FR-010); an unknown id is refused (the window never
   * picks an id). A new template is always `own` (the value's `origin` is ignored); an update keeps the stored `origin` and `createdAt`
   * (FR-023). Nothing is written when the value is refused.
   */
  put(value: unknown): StoreResult<{ template: StoredTemplate }> {
    return this.write(value, false);
  }

  /**
   * The import path of main ONLY: creates a template with `origin: 'imported'` from a value main already built (checked at level `imported`,
   * FR-090..FR-098, then re-checked here at `own`: the store is the person's file). A value with an `id` is refused. T007 must not expose
   * this to the window.
   */
  putImported(value: unknown): StoreResult<{ template: StoredTemplate }> {
    return this.write(value, true);
  }

  private write(value: unknown, imported: boolean): StoreResult<{ template: StoredTemplate }> {
    const r = checkTeamTemplate(value, 'own');
    if (!r.ok) return { ok: false, errors: r.errors };
    const t = r.template;
    if (imported && t.id !== undefined) return { ok: false, errors: ['Template: an imported template has no id yet.'] };
    const cur = t.id !== undefined ? this.items.find((x) => x.id === t.id) : undefined;
    if (t.id !== undefined && !cur) return { ok: false, errors: ['Template: not found.'] };
    if (!cur && this.items.length >= LIMITS.templates) return { ok: false, errors: [`Templates: at most ${LIMITS.templates}.`] };
    const at = this.now();
    const stored: StoredTemplate = { ...t, id: cur ? cur.id : this.newId(), origin: cur ? cur.origin : imported ? 'imported' : 'own', createdAt: cur ? cur.createdAt : at, updatedAt: at };
    const next = cur ? this.items.map((x) => (x === cur ? stored : x)) : [...this.items, stored];
    const c = this.commit(next);
    if (c !== 'ok') return { ok: false, errors: [c === 'changed' ? 'changed' : SAVE_FAILED] };
    return { ok: true, template: clone(stored) };
  }

  /**
   * FR-021: "<name> copy", origin `own`, each brief's `briefFrom` copied, no `memberId` (T007 gives each member a new one). The name gets
   * " copy", then " copy 2", " copy 3" until its `nameKey` is not one of a stored name (an NFD spelling or a Cyrillic lookalike counts as the same).
   */
  duplicate(id: string): StoreResult<{ template: StoredTemplate }> {
    const src = this.items.find((x) => x.id === id);
    if (!src) return { ok: false, errors: ['Template: not found.'] };
    const copy = clone(src) as Partial<StoredTemplate> & TeamTemplate;
    delete copy.id; delete copy.createdAt; delete copy.updatedAt;
    copy.origin = 'own';
    for (const m of copy.members) delete m.memberId;
    const taken = new Set(this.items.map((x) => nameKey(x.name)));
    const base = graphemes(src.name);
    for (let i = 1; ; i++) {
      const suffix = i === 1 ? ' copy' : ` copy ${i}`;
      const head = base.slice();
      const len = (g: string[]): number => g.reduce((t, x) => t + Array.from(x).length, 0);
      while (len(head) + Array.from(suffix).length > LIMITS.templateName && head.length > 0) head.pop(); // by grapheme: a conjunct or an emoji sequence is never split
      const name = head.join('').replace(TRAILING_JOINERS, '') + suffix;
      if (!taken.has(nameKey(name))) { copy.name = name; break; }
      if (i > LIMITS.templates + 2) return { ok: false, errors: ['Template: no free name.'] };
    }
    return this.put(copy);
  }

  /** `removed` is false (and nothing is written) for an id that is not stored. */
  delete(id: string): StoreResult<{ removed: boolean }> {
    if (!this.items.some((x) => x.id === id)) return { ok: true, removed: false };
    const c = this.commit(this.items.filter((x) => x.id !== id));
    if (c !== 'ok') return { ok: false, errors: [c === 'changed' ? 'changed' : SAVE_FAILED] };
    return { ok: true, removed: true };
  }

  // ------------------------------------------------------------------------------------------------------------------ disk

  /**
   * The fingerprint is taken BEFORE the read: a file another instance writes while this one reads it is then seen as changed at the next save
   * (`setAside` and `commit` set it again themselves, after their own change).
   */
  private load(): void {
    this.fp = this.fingerprint();
    this.loadFile();
  }

  /** `size:mtimeMs` of the file, `none` when it is not there. */
  private fingerprint(): string {
    try {
      const st = this.fs.statSync(this.file);
      return `${st.size}:${st.mtimeMs}`;
    } catch (e) {
      const c = (e as { code?: unknown } | null)?.code;
      return c === 'ENOENT' ? 'none' : 'error';
    }
  }

  private loadFile(): void {
    removeStaleTemps(this.file, { fs: this.fs, pid: this.pid, alive: this.alive }); // a dead process's temp may hold briefs
    let r = readCapped(this.fs, this.flags, this.file, MAX_STORE_BYTES);
    // a read can fail for a moment on a good file (an antivirus or an indexer holding it): once more after a short pause; only a second failure sets it aside
    if (!r.ok && (r.code === 'error' || r.code === 'changing')) { this.pause(200); r = readCapped(this.fs, this.flags, this.file, MAX_STORE_BYTES); }
    if (!r.ok) {
      if (r.code === 'missing') return;
      this.setAside(); // too big, a link, a directory, unreadable twice: out of the way, the store starts empty
      return;
    }
    const good: StoredTemplate[] = [];
    let bad = false;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(r.buf); // bad UTF-8 throws: a bad file, never rewritten with U+FFFD; a BOM is stripped
      let doc = JSON.parse(text) as Record<string, unknown> | null;
      // another format, a version that is not an integer, or a newer one: refused and set aside whole (FR-004, FR-093)
      const v = doc && typeof doc === 'object' ? doc.schemaVersion : undefined;
      if (doc && typeof doc === 'object' && doc.format === FORMAT && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= SCHEMA_VERSION) {
        for (let k = v; k < SCHEMA_VERSION; k++) doc = MIGRATIONS[k](doc); // ordered, pure; none yet
      } else doc = null;
      if (!doc || !Array.isArray(doc.templates)) bad = true;
      else {
        const ids = new Set<string>();
        for (const raw of doc.templates) {
          // the file is the person's own store: level `own` whatever a template's origin says (2026-11-12); an `imported` template keeps its marks
          const c = checkTeamTemplate(raw, 'own');
          if (!c.ok || c.template.id === undefined || ids.has(c.template.id) || good.length >= LIMITS.templates) { bad = true; continue; }
          ids.add(c.template.id);
          good.push({ ...c.template, id: c.template.id, origin: c.template.origin ?? 'own', createdAt: c.template.createdAt ?? 0, updatedAt: c.template.updatedAt ?? 0 });
        }
      }
    } catch {
      bad = true;
    }
    if (!bad) { this.items = good; return; }
    this.items = good;
    if (this.setAside() && good.length > 0) this.commit(good); // the valid ones go on; the bad file keeps the rest
  }

  /** Moves the file to `<name>.bad-<UTC time>.json` once, and asks for one toast; only the newest `KEEP_BAD` such files stay. False when the move failed: saves are refused until it works. */
  private setAside(): boolean {
    try {
      if (!this.fs.existsSync(this.file)) { this.blocked = false; return true; }
      const ext = path.extname(this.file);
      const stem = ext ? this.file.slice(0, -ext.length) : this.file;
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
      let dest = `${stem}.bad-${stamp}${ext}`;
      for (let i = 2; this.fs.existsSync(dest); i++) {
        if (i > 100) throw new Error('no free name');
        dest = `${stem}.bad-${stamp}-${i}${ext}`;
      }
      this.rename(this.file, dest);
      this.blocked = false;
      this.toast = true;
      this.fp = this.fingerprint();
      this.pruneBad(stem, ext);
      return true;
    } catch {
      this.blocked = true;
      return false;
    }
  }

  /**
   * Each set-aside file may hold briefs: the newest `KEEP_BAD` stay, the older ones are removed. Only names `setAside` makes are
   * touched (`<name>.bad-<UTC time as YYYY-MM-DDTHH-MM-SS-mmmZ>[-<n>]<ext>`); the order is the time, then `n` as a number (-10 after -2).
   */
  private pruneBad(stem: string, ext: string): void {
    try {
      const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${esc(path.basename(stem))}\\.bad-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)(?:-(\\d+))?${esc(ext)}$`);
      const dir = path.dirname(this.file);
      const found: { name: string; at: string; n: number }[] = [];
      for (const name of this.fs.readdirSync(dir)) { const m = re.exec(name); if (m) found.push({ name, at: m[1], n: m[2] ? Number(m[2]) : 1 }); }
      found.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.n - y.n));
      for (const f of found.slice(0, Math.max(0, found.length - KEEP_BAD))) { try { this.fs.rmSync(path.join(dir, f.name), { force: true }); } catch { /* next time */ } }
    } catch { /* best effort */ }
  }

  /** Windows: an antivirus or indexer may hold the file for a moment, so a rename that fails with EPERM, EBUSY or EACCES is tried once more after a pause (as `saveSchedules`). */
  private rename(from: string, to: string): void {
    try {
      this.fs.renameSync(from, to);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? '';
      if (this.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        this.pause(200);
        this.fs.renameSync(from, to);
      } else throw e;
    }
  }

  /**
   * Writes `next` (temp file, rename); memory changes only when the write worked, and a failure leaves the old file as it was. When the file
   * is not the one this store last read or wrote (another running instance saved: the app takes no single-instance lock) nothing is written:
   * the store reloads and answers `changed`, so that instance's templates are never lost silently.
   */
  private commit(next: StoredTemplate[]): 'ok' | 'changed' | 'failed' {
    if (this.blocked && !this.setAside()) return 'failed';
    if (this.fingerprint() !== this.fp) { this.load(); return 'changed'; }
    const tmp = `${this.file}.${this.pid}.tmp`;
    try {
      this.fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 }); // POSIX; Windows ignores the mode
      this.fs.rmSync(tmp, { force: true });
      this.fs.writeFileSync(tmp, JSON.stringify({ format: FORMAT, schemaVersion: SCHEMA_VERSION, templates: next }, null, 1) + '\n', { mode: 0o600, flag: 'wx' });
      try { this.fs.fsyncFile(tmp); } catch { /* best effort, as schedules */ }
      this.rename(tmp, this.file);
      this.items = next;
      this.fp = this.fingerprint();
      return 'ok';
    } catch {
      try { this.fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      return 'failed';
    }
  }
}
