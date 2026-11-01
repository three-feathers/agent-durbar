/**
 * The project notes file `.durbar/notes/notes.md` (spec 083 FR-050..FR-055, T041, issue 699): main's mirror of a folder's notes into the
 * project, used only while the folder's switch is on. The folder is the person's project: it may be a git repository that others
 * push to, and an agent with write rights or a `git pull` may change anything in it, so everything read here is hostile input.
 *
 * - Every path is real-path checked: `.durbar` and `.durbar/notes` must be real folders (not links or junctions), each right inside
 *   its parent's real path; `notes.md` must be missing or a regular file with one link (`lstat`, not a link). A FIFO, a folder or a device is refused, and a
 *   read opens with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW` (where the OS has them), checks `fstat` and reads at most `mdBytes + 1`
 *   bytes, so the cap is checked before anything is decoded.
 * - Writes go to a temp file in `.durbar/notes` opened `O_CREAT | O_EXCL | O_WRONLY` (and `O_NOFOLLOW`), 0600 on POSIX; right before the
 *   rename everything is checked again, including that `notes.md` still has the hash this cycle started from (an outside edit is
 *   imported first, never overwritten). On Windows a refused rename is tried once more after 200 ms.
 * - FR-051 (spec Changes 2026-11-01): no process is ever started (no git) and nothing outside `.durbar/notes` is written. `.durbar/notes/.gitignore`
 *   holds `*`, so git ignores the folder and itself; it is kept in place before every write, unless the person chose to keep the notes in git.
 *
 * Nothing here logs; messages carry a short reason, never a path or a note's text. The caller (`NotesOps`) decides whether the switch
 * is on: nothing in this module runs while it is off.
 */
import * as nodeFs from 'fs';
import * as path from 'path';
import { createHash, randomInt } from 'crypto';
import { NOTES_LIMITS, cleanTitle, fitText } from '../shared/notes';
import { readCapped, type CappedRead } from '../shared/cappedread';
import type { Note, NotesFileState, NotesMirror } from '../shared/notes';
import { NOTES_MD_UNREADABLE, parseNotesMd, writeNotesMd, type NotesMdSection } from '../shared/notesmd';
import { isInsideRoots } from '../adapters/permissions';
import type { NotesStore } from './notesstore';
import { maskNoteText } from '../shared/redact';

export type NotesFileFs = Pick<typeof nodeFs, 'realpathSync' | 'lstatSync' | 'statSync' | 'openSync' | 'fstatSync' | 'readSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'readdirSync' | 'unlinkSync' | 'mkdirSync' | 'rmdirSync' | 'linkSync'>;
/** The open flags used; tests pass a set without `O_NOFOLLOW` to act like Windows. */
export type NotesFileFlags = Pick<typeof nodeFs.constants, 'O_RDONLY' | 'O_WRONLY' | 'O_CREAT' | 'O_EXCL' | 'O_APPEND'> & { O_NOFOLLOW?: number; O_NONBLOCK?: number };

export interface NotesFileOptions {
  fs?: NotesFileFs;
  flags?: NotesFileFlags;
  /** The platform paths are compared for (case) and whether modes and the rename retry apply. Default `process.platform`. */
  platform?: string;
  now?: () => Date;
  rand?: (n: number) => number;
  sleep?: (ms: number) => Promise<void>;
  pid?: number;
}

export type FileFail = { ok: false; code: 'refused' | 'missing' | 'conflict' | 'too-big' | 'changed' | 'write' | 'cap'; error: string };
type Read = CappedRead;

const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c) ? c : 'ERROR';
};
/** Git reads `.gitignore` byte for byte (a leading space, tab, VT, FF or NBSP is part of the pattern): only these bytes are Durbar's `*`. */
const isStar = (b: Buffer): boolean => ['*', '*\n', '*\r\n'].includes(b.toString('latin1'));
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const WRITE_FAIL = (why: string): string => `Could not write .durbar/notes/notes.md: ${why}`;
const READ_FAIL = (why: string): string => `Could not read .durbar/notes/notes.md: ${why}`;
/** FR-050: the dialog's line when the existing file cannot be imported. */
export const COUNT_UNREADABLE = 'The existing file cannot be read; Durbar will not change it.';
const READ_WHY: Record<Exclude<Read, { ok: true }>['code'], string> = {
  missing: 'is not there', link: 'is a link', 'not-file': 'is not a regular file', links: 'has more than one link (a hard link)',
  'too-big': 'is too large', changing: 'changed while being read', error: 'could not be opened',
};

interface Place { folder: string; durbar: string; dir: string; notes: string; has: boolean }
export type ReadBack =
  | { ok: true; sha: string | null; changed: false }
  | { ok: true; sha: string; changed: true; sections: NotesMdSection[]; strayText: number; overflow: number }
  | FileFail;
/** FR-055 (T042): what *Delete the file* did. `removed` false: the file stays and `why` says so (a short fixed text, never a path). */
export type RemoveResult = { removed: boolean; dirRemoved: boolean; why?: string };
/** FR-055: the reasons a delete leaves the file. */
export const REMOVE_CHANGED = '.durbar/notes/notes.md changed since Durbar last wrote it, so it was left in the project.';
export const REMOVE_NONE = 'There was no .durbar/notes/notes.md to delete.';
/** Reviews 2 and 3 of PR 931: the folder's identity differs from the one recorded at turn-on (another folder at the same path, or a remount). */
export const NOTES_REPLACED = 'This folder looks replaced, or its drive was remounted. Turn the switch off and on again to write .durbar/notes/notes.md here.';
/** Review of PR 931 (point 4): the switch is on and `notes.md` is not there (the folder was replaced, the file deleted, or never written). */
export const NOTES_GONE = 'The project file is gone. Turn the switch off and on again to write .durbar/notes/notes.md.';
const REMOVE_REFUSED = (why: string): string => `Durbar did not delete .durbar/notes/notes.md: ${why}.`;

export class NotesFile {
  private readonly fs: NotesFileFs;
  private readonly k: NotesFileFlags;
  private readonly platform: string;
  private readonly now: () => Date;
  private readonly rand: (n: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pid: number;
  /** Per real folder: the hash of a `notes.md` that did not parse (a conflict): the same bytes are not parsed again on every cycle. */
  private readonly unreadable = new Map<string, { sha: string; code: 'conflict' | 'too-big' }>();
  /** Notes masked for the file, by id and rev and the values used (masking 300 full notes on every write would cost about a second). */
  private readonly masked = new Map<string, { sig: string; rev: number; title: string; text: string }>();

  /**
   * Q1 (spec Changes, T041): the notes as the shared file gets them, masked again with the folder's CURRENT secret values, so a value
   * registered after a note was saved never reaches `notes.md` (then cut, as on save). The token shapes run too when no value is known
   * (review of PR 931: a shape added to the mask after a note was saved). `syncNotesFile` writes a changed note back to the store.
   */
  forFile(notes: readonly Note[], values: readonly string[]): Note[] {
    const sig = sha256(values.join('\u0000'));
    return notes.map((n) => {
      let m = this.masked.get(n.id);
      if (!m || m.sig !== sig || m.rev !== n.rev) {
        m = { sig, rev: n.rev, title: cleanTitle(maskNoteText(n.title, values).text) ?? n.title, text: fitText(maskNoteText(n.text, values).text).text };
        this.masked.set(n.id, m);
      }
      return { ...n, title: m.title, text: m.text };
    });
  }

  constructor(opts: NotesFileOptions = {}) {
    this.fs = opts.fs ?? nodeFs;
    this.k = opts.flags ?? nodeFs.constants;
    this.platform = opts.platform ?? process.platform;
    this.now = opts.now ?? (() => new Date());
    this.rand = opts.rand ?? ((n) => randomInt(n));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pid = opts.pid ?? process.pid;
  }

  private ci(): boolean { return this.platform === 'win32' || this.platform === 'darwin'; }
  private same(a: string, b: string): boolean { return this.ci() ? a.toLowerCase() === b.toLowerCase() : a === b; }
  private inside(root: string, p: string): boolean { return isInsideRoots(p, [root], { realpath: (x) => x, caseInsensitive: this.ci() }); }

  /**
   * FR-053: the folder's real path, `.durbar` and `.durbar/notes` (each created 0700 when `create` and missing) as real folders, each
   * right inside its parent, and the path of `notes.md`. A link or junction, a path outside, or anything that is not a folder is refused.
   */
  private place(folderPath: string, create: boolean): { ok: true; p: Place } | FileFail {
    const refuse = (why: string): FileFail => ({ ok: false, code: 'refused', error: (create ? WRITE_FAIL : READ_FAIL)(why) });
    if (typeof folderPath !== 'string' || !folderPath || !path.isAbsolute(folderPath)) return refuse('the folder is not there');
    let folder: string;
    try {
      folder = this.fs.realpathSync(folderPath);
      if (!this.fs.lstatSync(folder).isDirectory()) return refuse('the folder is not there');
    } catch { return { ok: false, code: 'missing', error: (create ? WRITE_FAIL : READ_FAIL)('the folder is not there') }; }
    const durbar = path.join(folder, '.durbar'), dir = path.join(durbar, 'notes');
    const p: Place = { folder, durbar, dir, notes: path.join(dir, 'notes.md'), has: false };
    for (const [parent, d] of [[folder, durbar], [durbar, dir]]) {
      let st: nodeFs.Stats;
      try { st = this.fs.lstatSync(d); } catch (e) {
        if (errCode(e) !== 'ENOENT') return refuse(`${path.basename(d)} could not be checked (${errCode(e)})`);
        if (!create) return { ok: true, p };
        try { this.fs.mkdirSync(d, { mode: 0o700 }); st = this.fs.lstatSync(d); } catch (e2) { return refuse(`${path.basename(d)} could not be created (${errCode(e2)})`); }
      }
      const checked = this.checkDir(parent, d, st);
      if (checked) return refuse(checked);
    }
    return { ok: true, p: { ...p, has: true } };
  }

  /** `d` is a real folder (not a link or junction) whose real path is itself, right inside `parent`. A reason, or `undefined`. */
  private checkDir(parent: string, d: string, st?: nodeFs.Stats): string | undefined {
    const name = path.basename(d);
    try {
      const s = st ?? this.fs.lstatSync(d);
      if (s.isSymbolicLink()) return `${name} is a link`;
      if (!s.isDirectory()) return `${name} is not a folder`;
      const real = this.fs.realpathSync(d);
      if (!this.inside(parent, real) || !this.same(real, d)) return `${name} leads outside the folder`;
      return undefined;
    } catch (e) { return `${name} could not be checked (${errCode(e)})`; }
  }
  /** Both folders of a place, again. */
  private checkPlace(p: Place): string | undefined { return this.checkDir(p.folder, p.durbar) ?? this.checkDir(p.durbar, p.dir); }

  /**
   * Spec Changes 2026-11-01: `.durbar/notes/.gitignore` holds `*`. Missing: created (`O_CREAT | O_EXCL | O_NOFOLLOW`). Anything else
   * (other text, a link, a folder, a hard link, too big) is a reason to write nothing: the file may be tracked or edited, and then git
   * might not ignore the notes. A reason, or `undefined`.
   */
  private ensureIgnore(p: Place): string | undefined {
    const f = path.join(p.dir, '.gitignore');
    try { if (this.fs.lstatSync(f).isSymbolicLink()) return '.gitignore is a link'; } catch { /* missing: read says so */ }
    const r = readCapped(this.fs, this.k, f, 16);
    if (r.ok) return isStar(r.buf) ? undefined : '.gitignore in .durbar/notes is not "*"';
    if (r.code !== 'missing') return `.gitignore ${READ_WHY[r.code]}`;
    let fd: number | undefined;
    try {
      fd = this.fs.openSync(f, this.k.O_CREAT | this.k.O_EXCL | this.k.O_WRONLY | (this.k.O_NOFOLLOW ?? 0), 0o600);
      this.fs.writeSync(fd, Buffer.from('*\n'), 0, 2);
      return undefined;
    } catch (e) { return `.gitignore could not be written (${errCode(e)})`; } finally { if (fd !== undefined) { try { this.fs.closeSync(fd); } catch { /* gone */ } } }
  }

  /**
   * Delete `.gitignore` only when it is a regular file with one link holding exactly `*` (`isStar`), and Durbar made it (`own`: the
   * caller's record; a file a repository ships is never deleted). Both folders and the real path of the file are checked again right
   * before the unlink; a swap in the last instant stays open `[KNOWN GAP]` (Node has no unlinkat). `true` when deleted.
   */
  private dropIgnore(p: Place, own: boolean): boolean {
    if (!own) return false;
    const f = path.join(p.dir, '.gitignore');
    try {
      const r = readCapped(this.fs, this.k, f, 16); // where there is no O_NOFOLLOW a link is read through; the real-path check below refuses it
      if (!r.ok || !isStar(r.buf)) return false;
      if (this.checkPlace(p) || !this.same(this.fs.realpathSync(f), f)) return false;
      this.fs.unlinkSync(f);
      return true;
    } catch { return false; }
  }

  /** Is there a `.gitignore` in `.durbar/notes` (any kind of entry)? For turn-on: only one Durbar makes is Durbar's to delete. */
  hasIgnore(folderPath: string): boolean {
    try { this.fs.lstatSync(path.join(this.fs.realpathSync(folderPath), '.durbar', 'notes', '.gitignore')); return true; } catch { return false; }
  }

  /** The person chose to keep the notes in git: Durbar's own `.gitignore` (`own`) goes (called after the native box). `true` when it went. */
  allowGit(folderPath: string, own: boolean): boolean {
    const pl = this.place(folderPath, false);
    return pl.ok && pl.p.has && this.dropIgnore(pl.p, own);
  }

  /** `notes.md` now: its bytes (`null`: missing), or why it is refused. `lstat` first: a link, a folder or a FIFO is never opened. */
  private current(p: Place): { ok: true; buf: Buffer | null } | { ok: false; why: string; code: FileFail['code'] } {
    let st: nodeFs.Stats;
    try { st = this.fs.lstatSync(p.notes); } catch (e) {
      return errCode(e) === 'ENOENT' ? { ok: true, buf: null } : { ok: false, code: 'refused', why: `could not be checked (${errCode(e)})` };
    }
    if (st.isSymbolicLink()) return { ok: false, code: 'refused', why: READ_WHY.link };
    if (!st.isFile()) return { ok: false, code: 'refused', why: READ_WHY['not-file'] };
    if (st.size > NOTES_LIMITS.mdBytes) return { ok: false, code: 'too-big', why: READ_WHY['too-big'] };
    const r = readCapped(this.fs, this.k, p.notes, NOTES_LIMITS.mdBytes);
    if (r.ok) return { ok: true, buf: r.buf };
    if (r.code === 'missing') return { ok: true, buf: null };
    return { ok: false, code: r.code === 'too-big' ? 'too-big' : 'refused', why: READ_WHY[r.code] + (r.errno ? ` (${r.errno})` : '') };
  }

  /**
   * FR-054: has `notes.md` changed since Durbar last wrote it (`mirror`) or last imported it? Only then is it decoded and parsed (a
   * conflict or a file that does not parse is `conflict`: no import, no write). Missing: `sha: null`, nothing to import.
   */
  readBack(folderPath: string, mirror: NotesMirror | undefined, imported?: string): ReadBack {
    const pl = this.place(folderPath, false);
    if (!pl.ok) return pl;
    if (!pl.p.has) return { ok: true, sha: null, changed: false };
    const cur = this.current(pl.p);
    if (!cur.ok) return { ok: false, code: cur.code, error: cur.code === 'too-big' ? NOTES_MD_UNREADABLE : READ_FAIL(`it ${cur.why}`) };
    if (!cur.buf) return { ok: true, sha: null, changed: false };
    const sha = sha256(cur.buf);
    if (sha === mirror?.sha256 || sha === imported) return { ok: true, sha, changed: false };
    const bad = this.unreadable.get(pl.p.folder);
    if (bad?.sha === sha) return { ok: false, code: bad.code, error: NOTES_MD_UNREADABLE };
    const parsed = parseNotesMd(cur.buf.toString('utf8'));
    if (!parsed.ok) {
      const code = parsed.reason === 'too-big' ? 'too-big' : 'conflict';
      this.unreadable.set(pl.p.folder, { sha, code });
      return { ok: false, code, error: NOTES_MD_UNREADABLE };
    }
    return { ok: true, sha, changed: true, sections: parsed.sections, strayText: parsed.strayText, overflow: parsed.overflow };
  }

  /**
   * FR-050: how many notes an existing `notes.md` would add (sections whose id is not in `knownIds`), for the turn-on dialog only.
   * No file: 0. A conflict, a parse error or a refused file: `COUNT_UNREADABLE` (the switch then stays off).
   */
  count(folderPath: string, knownIds: ReadonlySet<string> = new Set()): { ok: true; count: number; exists: boolean; strayText: number } | { ok: false; error: string } {
    const pl = this.place(folderPath, false);
    if (!pl.ok) return pl.code === 'missing' ? { ok: false, error: pl.error } : { ok: false, error: COUNT_UNREADABLE };
    if (!pl.p.has) return { ok: true, count: 0, exists: false, strayText: 0 };
    const cur = this.current(pl.p);
    if (!cur.ok) return { ok: false, error: COUNT_UNREADABLE };
    if (!cur.buf) return { ok: true, count: 0, exists: false, strayText: 0 };
    const parsed = parseNotesMd(cur.buf.toString('utf8'));
    if (!parsed.ok) return { ok: false, error: COUNT_UNREADABLE };
    return { ok: true, count: parsed.sections.filter((s) => s.id === undefined || !knownIds.has(s.id)).length + parsed.overflow, exists: true, strayText: parsed.strayText };
  }

  /** FR-053 right before the rename: both folders unchanged, `notes.md` missing or a regular file, and its hash still `expect` (`null`: still missing). */
  private recheck(p: Place, expect: string | null): FileFail | undefined {
    const bad = this.checkPlace(p);
    if (bad) return { ok: false, code: 'refused', error: WRITE_FAIL(bad) };
    const cur = this.current(p);
    if (!cur.ok) return { ok: false, code: 'refused', error: WRITE_FAIL(`notes.md ${cur.why}`) };
    const sha = cur.buf ? sha256(cur.buf) : null;
    if (sha !== expect) return { ok: false, code: 'changed', error: WRITE_FAIL('it changed while Durbar was writing it; the change is read first') };
    return undefined;
  }

  /**
   * FR-053: write `text` as `notes.md`, replacing the file whose hash was `expect` (`null`: no file). Temp file `O_CREAT | O_EXCL |
   * O_WRONLY | O_NOFOLLOW`, 0600; everything is checked again right before the rename (and before the Windows retry); any failure
   * deletes the temp file. Returns the `mirror` for the store to persist.
   */
  async syncOut(folderPath: string, text: string, expect: string | null, git = false): Promise<{ ok: true; mirror: NotesMirror } | FileFail> {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > NOTES_LIMITS.mdBytes) return { ok: false, code: 'cap', error: WRITE_FAIL('the notes are too large for the file') };
    const pl = this.place(folderPath, true);
    if (!pl.ok) return pl;
    const p = pl.p;
    // before the write and again before the rename: the checks, then `.gitignore` (unless the person chose git)
    const check = (): FileFail | undefined => {
      const f = this.recheck(p, expect);
      const ig = f ? undefined : git ? undefined : this.ensureIgnore(p);
      return f ?? (ig ? { ok: false, code: 'refused', error: WRITE_FAIL(ig) } : undefined);
    };
    const early = check();
    if (early) return early;
    const tmp = path.join(p.dir, `.notes.md.${this.pid}.${this.rand(36 ** 6).toString(36)}.tmp`);
    let fd: number | undefined;
    let made = false;
    try {
      fd = this.fs.openSync(tmp, this.k.O_CREAT | this.k.O_EXCL | this.k.O_WRONLY | (this.k.O_NOFOLLOW ?? 0), 0o600);
      made = true;
      let off = 0;
      while (off < bytes.length) off += this.fs.writeSync(fd, bytes, off, bytes.length - off);
      try { this.fs.fsyncSync(fd); } catch { /* best effort */ }
      this.fs.closeSync(fd);
      fd = undefined;
      const late = check();
      if (late) return late;
      try {
        this.fs.renameSync(tmp, p.notes);
      } catch (e) {
        if (this.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(errCode(e))) throw e;
        // Windows: another program (an editor, an indexer) holds the file; once more after 200 ms, checked again first
        await this.sleep(200);
        const again = check();
        if (again) return again;
        this.fs.renameSync(tmp, p.notes);
      }
      made = false;
      return { ok: true, mirror: { sha256: sha256(bytes), bytes: bytes.length, at: this.now().toISOString() } };
    } catch (e) {
      return { ok: false, code: 'write', error: WRITE_FAIL(errCode(e)) };
    } finally {
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch { /* gone */ } }
      if (made) { try { this.fs.unlinkSync(tmp); } catch { /* not there */ } }
    }
  }

  /** Walk up from a real folder path to the first `.git` (a folder, a file or anything else: the caller checks it). No git process (FR-051). */
  private findDotGit(folder: string): { root: string; st: nodeFs.Stats } | undefined {
    for (let dir = folder, i = 0; i < 256; i++) {
      try { return { root: dir, st: this.fs.lstatSync(path.join(dir, '.git')) }; } catch (e) { if (errCode(e) !== 'ENOENT') return undefined; }
      const up = path.dirname(dir);
      if (up === dir) return undefined;
      dir = up;
    }
    return undefined;
  }

  /** FR-050 (T042): is the folder inside a git repository (a `.git` folder or file found walking up from its real path)? Only for the dialog's box. */
  inRepo(folderPath: string): boolean {
    try {
      if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) return false;
      const folder = this.fs.realpathSync(folderPath);
      if (!this.fs.lstatSync(folder).isDirectory()) return false;
      const g = this.findDotGit(folder);
      return !!g && (g.st.isDirectory() || g.st.isFile() || g.st.isSymbolicLink());
    } catch { return false; }
  }

  /**
   * Reviews 2 and 3 of PR 931: the identity of the project folder, recorded at turn-on: `<dev>:<ino>:<birth time in ns>` of its real path
   * (decimal text, never a path). An inode number is reused after a delete (ext4), so the birth time is what tells a fresh clone at the
   * same path apart. Where the file system has no birth time (Node gives 0 or 1970) only `<dev>:<ino>` is kept, and a folder deleted
   * and made again can then look the same; where Node reports the change time instead, a change at the top of the folder makes it look
   * replaced (fails safe: turn the switch off and on). `undefined` where the OS gives no inode.
   */
  folderId(folderPath: string): string | undefined {
    try {
      const st = this.fs.lstatSync(this.fs.realpathSync(folderPath), { bigint: true }) as unknown as { dev: bigint; ino: bigint; birthtimeNs: bigint; isDirectory(): boolean };
      if (!st.isDirectory() || st.ino <= 0n) return undefined;
      const born = st.birthtimeNs > 86_400_000_000_000n; // 0 or 1970: the file system gives no birth time
      return `${st.dev}:${st.ino}${born ? `:${st.birthtimeNs}` : ''}`;
    } catch { return undefined; }
  }

  /** `p` (built from the real path of `.durbar`) still resolves to itself: no link on the way. */
  private isHere(p: string): boolean {
    try { return this.same(this.fs.realpathSync(p), p); } catch { return false; }
  }

  /** The same folder: device and inode equal, and the birth time too when both identities have one. */
  static sameFolder(a: string, b: string): boolean {
    const [x, y] = [a.split(':'), b.split(':')];
    return x[0] === y[0] && x[1] === y[1] && (x.length < 3 || y.length < 3 || x[2] === y[2]);
  }

  /** FR-050 (T042): is the folder there (a real folder after its real path)? Stats the folder only, never `.durbar` or `notes.md`. */
  folderThere(folderPath: string): boolean {
    try {
      if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) return false;
      return this.fs.lstatSync(this.fs.realpathSync(folderPath)).isDirectory();
    } catch { return false; }
  }

  /**
   * FR-055 (T042): *Delete the file*. `notes.md` is unlinked only when `.durbar` passes FR-053's checks, `notes.md` is a regular file with
   * one link (a symlink or a hard link is never deleted) and its SHA-256 is `mirror` (the file Durbar last wrote); all of it is checked
   * again right before the unlink. Then `.durbar` is removed with `rmdir` only when it is empty (never recursively). Never throws.
   */
  remove(folderPath: string, mirror: NotesMirror | undefined, own = false): RemoveResult & { ignoreDropped?: true } {
    const keep = (why: string): RemoveResult => ({ removed: false, dirRemoved: false, why });
    try {
      const pl = this.place(folderPath, false);
      if (!pl.ok) return keep(pl.code === 'missing' ? REMOVE_REFUSED('the folder is not there') : REMOVE_REFUSED(pl.error.replace(/^Could not read \.durbar\/notes\/notes\.md: /, '')));
      if (!pl.p.has) return keep(REMOVE_NONE);
      const cur = this.current(pl.p);
      if (!cur.ok) return keep(cur.code === 'too-big' ? REMOVE_CHANGED : REMOVE_REFUSED(`it ${cur.why}`));
      if (!cur.buf) return keep(REMOVE_NONE);
      if (!mirror || sha256(cur.buf) !== mirror.sha256) return keep(REMOVE_CHANGED);
      const again = this.recheck(pl.p, mirror.sha256);
      if (again) return keep(again.code === 'changed' ? REMOVE_CHANGED : REMOVE_REFUSED(again.error.replace(/^Could not write \.durbar\/notes\/notes\.md: /, '').replace(/^notes\.md /, 'it ')));
      // Review of PR 931: never unlink by the name `notes.md`, which a swapped `.durbar` could point elsewhere. Rename the file to a random
      // name inside `.durbar`, check THAT name (its folder's real path, a regular file with one link, Durbar's hash), and unlink only it.
      // A swap before the rename moves the other file to the random name elsewhere, and the real-path check of that name (last, right
      // before the unlink) fails; a swap after it finds no file with that random name elsewhere, so the unlink fails. This closes the race
      // for a process that cannot read the other folder and narrows it otherwise: one that can read it learns the random name, can put a
      // decoy under it here and swap again before the unlink (Node has no unlinkat). Under attack a file may be left under the random name.
      const name = `.notes.md.${this.pid}.${this.rand(36 ** 8).toString(36)}.del`;
      const doomed = path.join(pl.p.dir, name);
      try { this.fs.renameSync(pl.p.notes, doomed); } catch (e) { return keep(REMOVE_REFUSED(`it could not be deleted (${errCode(e)})`)); }
      const left = (why: string, newer: boolean): RemoveResult => keep(REMOVE_REFUSED(`${why}; ${newer ? 'a newer notes.md is there, so the old one' : 'the file'} may be left as ${name}, in .durbar/notes or in another folder: renaming it back to notes.md restores it`));
      // the rename back never replaces a notes.md that appeared meanwhile (a POSIX rename would): a hard link fails with EEXIST instead
      const putBack = (why: string): RemoveResult => {
        try {
          this.fs.linkSync(doomed, pl.p.notes);
        } catch (e) {
          if (errCode(e) === 'EEXIST') return left(why, true);
          // no hard links here (some file systems): rename only when nothing is at notes.md
          try { this.fs.lstatSync(pl.p.notes); return left(why, true); } catch (e2) { if (errCode(e2) !== 'ENOENT') return left(why, false); }
          try { this.fs.renameSync(doomed, pl.p.notes); return keep(REMOVE_REFUSED(why)); } catch { return left(why, false); }
        }
        // two names for one file now: drop the random one, but only where it really is in this `.durbar` (review 3 of PR 931: an
        // unchecked unlink here could remove a file a swapped link points to). Nothing on this path ever unlinks the name `notes.md`
        // (re-check of review 3): when the random name cannot go, the answer says the file has two names and which one to delete.
        if (this.isHere(doomed)) { try { this.fs.unlinkSync(doomed); return keep(REMOVE_REFUSED(why)); } catch { /* held open: below */ } }
        return keep(REMOVE_REFUSED(`${why}; notes.md and ${name} are now two names of the same file: delete ${name} in .durbar/notes once nothing holds it`));
      };
      const moved = this.checkPlace(pl.p);
      if (moved) return putBack('.durbar changed while it was being deleted');
      const r = readCapped(this.fs, this.k, doomed, NOTES_LIMITS.mdBytes);
      if (!r.ok || sha256(r.buf) !== mirror.sha256) return putBack('it changed while it was being deleted');
      // the decisive check, last before the unlink: the random name really is in this folder's `.durbar` now. A rename that landed
      // elsewhere through a swapped link left no file with that name here, so a swap after this check finds no such name elsewhere.
      let rp = '';
      try { rp = this.fs.realpathSync(doomed); } catch { return putBack('.durbar changed while it was being deleted'); }
      if (!this.same(rp, doomed)) return putBack('.durbar changed while it was being deleted');
      try { this.fs.unlinkSync(doomed); } catch (e) { return putBack(`it could not be deleted (${errCode(e)})`); }
      let dirRemoved = false, ignoreDropped = false;
      if (!this.checkPlace(pl.p)) {
        // the `.gitignore` goes only when it is the last thing in the folder: a crash leftover (`.notes.md.*.tmp`, with note text) stays ignored
        if (this.fs.readdirSync(pl.p.dir).join() === '.gitignore') ignoreDropped = this.dropIgnore(pl.p, own);
        try { this.fs.rmdirSync(pl.p.dir); dirRemoved = true; this.fs.rmdirSync(pl.p.durbar); } catch { /* not empty (ENOTEMPTY, EEXIST) or held open: it stays */ }
      }
      return { removed: true, dirRemoved, ...(ignoreDropped ? { ignoreDropped: true as const } : {}) };
    } catch (e) {
      return keep(REMOVE_REFUSED(`it could not be checked (${errCode(e)})`));
    }
  }
}

/**
 * One mirror cycle for a folder whose switch is on (FR-053, FR-054; spec Changes 2026-10-31): read back an outside change and import it,
 * then write the store's notes unless the file already holds exactly them. `retry` asks the caller for one more cycle (the file changed
 * right before the rename). Returns the state for the window.
 */
export async function syncNotesFile(d: {
  file: NotesFile; store: NotesStore; folderKey: string; folderName: string; folderPath: string; values: readonly string[]; now?: () => Date;
  /** Only the turn-on call may create the file (review 2 of PR 931): any other cycle that finds no file reports it gone. */
  create?: boolean;
  /** The person chose to keep the notes in git: no `.gitignore` is kept in `.durbar/notes`. */
  git?: boolean;
}): Promise<{ state: NotesFileState; retry?: boolean }> {
  const mirror = await d.store.getMirror(d.folderKey);
  // reviews 2 and 3 of PR 931: the folder must be the one the switch was turned on in (its identity is recorded at turn-on), so another
  // folder at the same path (a fresh clone, perhaps shipping its own notes.md) is neither read nor written
  const recorded = await d.store.getFileFolder(d.folderKey);
  const here = recorded ? d.file.folderId(d.folderPath) : undefined;
  if (recorded && here && !NotesFile.sameFolder(recorded, here)) return { state: { error: NOTES_REPLACED } };
  const rb = d.file.readBack(d.folderPath, mirror, await d.store.getFileImport(d.folderKey));
  if (!rb.ok) return { state: { error: rb.error } };
  // review of PR 931 (point 4): a file Durbar wrote is gone (another clone at the same path, a deleted folder): never recreate it unasked
  if (!d.create && rb.sha === null) return { state: { error: NOTES_GONE } };
  const info: string[] = [];
  if (rb.changed) {
    const imp = await d.store.importFile(d.folderKey, d.folderName, rb.sections, d.values, rb.overflow ? undefined : rb.sha);
    if (!imp.ok) return { state: { error: imp.error } };
    const c = imp.counts;
    const notIn = (c?.tooLong ?? 0) + (c?.overCap ?? 0) + rb.overflow;
    // FR-053, FR-054: a section that could not be added exists only in the file: never write over it
    if (notIn) {
      const why = [c?.tooLong ? 'too long' : '', (c?.overCap ?? 0) + rb.overflow ? `over ${NOTES_LIMITS.notesPerFolder} notes` : ''].filter(Boolean).join(', ');
      return { state: { error: `${notIn} section${notIn === 1 ? '' : 's'} of notes.md could not be added (${why}). Durbar left the file as it is until they are fixed or removed.` } };
    }
    if (rb.strayText) info.push(`${rb.strayText} line${rb.strayText === 1 ? '' : 's'} of text outside notes in notes.md ${rb.strayText === 1 ? 'was' : 'were'} removed`);
    if (c?.keptDurbar) info.push(`${c.keptDurbar} note${c.keptDurbar === 1 ? '' : 's'} added in notes.md ${c.keptDurbar === 1 ? 'was' : 'were'} changed in Durbar before reaching the file; Durbar's version was kept`);
    if (c?.older) info.push(`${c.older} note${c.older === 1 ? '' : 's'} in notes.md ${c.older === 1 ? 'was an older copy' : 'were older copies'}; Durbar's version was kept`);
  }
  let v = await d.store.list(d.folderKey);
  if (!v.ok) return { state: { error: v.error } };
  if (v.readOnly) return { state: { error: v.readOnly } };
  // review of PR 931 (point 1b): a note the file masks differently is masked in the store too, so the file never un-masks later
  let out = d.file.forFile(v.notes, d.values);
  let fixed = 0;
  for (let i = 0; i < out.length; i++) {
    const n = v.notes[i], m = out[i];
    if (m.title === n.title && m.text === n.text) continue;
    const u = await d.store.update(d.folderKey, d.folderName, n.id, n.rev, { ...(m.title !== n.title ? { title: n.title } : {}), ...(m.text !== n.text ? { text: n.text } : {}), values: d.values });
    if (u.ok) fixed++;
  }
  if (fixed) {
    v = await d.store.list(d.folderKey);
    if (!v.ok) return { state: { error: v.error } };
    out = d.file.forFile(v.notes, d.values);
  }
  const text = writeNotesMd(out);
  const want = sha256(Buffer.from(text, 'utf8'));
  const done = (state: NotesFileState): NotesFileState => (info.length ? { ...state, info: info.join('. ') + '.' } : state);
  if (rb.sha === want) {
    if (mirror?.sha256 !== want) await d.store.setMirror(d.folderKey, d.folderName, { sha256: want, bytes: Buffer.byteLength(text, 'utf8'), at: (d.now?.() ?? new Date()).toISOString() });
    return { state: done({}) };
  }
  const w = await d.file.syncOut(d.folderPath, text, rb.sha, d.git);
  if (!w.ok) return { state: done({ error: w.error }), retry: w.code === 'changed' };
  const m = await d.store.setMirror(d.folderKey, d.folderName, w.mirror);
  if (!m.ok) return { state: done({ error: m.error }) };
  return { state: done({}) };
}
