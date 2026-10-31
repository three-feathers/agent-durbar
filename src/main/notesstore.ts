/**
 * Notes per folder, kept on disk (spec 083 FR-002, FR-005..FR-008, issue 699). One JSON file per folder at
 * `<dir>/<folderFingerprint(key)>.json` (the folder `notes/` of userData): the folder owner-only (0700), each file 0600, never a folder
 * path inside. Everything is masked BEFORE it is stored (`maskNoteText`, then cut) and the raw text lives only for the call.
 *
 * Writes are atomic (a unique `wx` temp file in the same folder, then rename; on Windows a rename another program blocks is tried once
 * more after 200 ms) and queued per folder. Before each change the file is compared with the last read or write (size, modification
 * time, inode); another process's change is read again and merged by note id with tombstones (`mergeDocs`). A file Durbar cannot read
 * (unknown version, not JSON, too large, not a regular file, or with notes it cannot parse) is NEVER written over: the folder's notes
 * are read-only until the person starts over (the file is renamed aside, not deleted). The last `notes.md` Durbar wrote (`mirror`) is
 * kept in the same document. No Electron import: the folder is injected. Nothing here logs.
 */
import * as nodeFs from 'fs';
import * as path from 'path';
import { randomInt } from 'crypto';
import { maskNoteText } from '../shared/redact';
import {
  NOTES_LIMITS, applyChange, cleanFolderName, cleanTitle, emptyNotesDoc, fitsCap, fitText, guessTitle, mergeDocs, newNoteId, parseNotesDoc, serializeNotesDoc, stripControls, utf8Len,
} from '../shared/notes';
import type { ChangeResult, Note, NoteChange, NoteSource, NotesDoc, NotesFail, NotesMirror, NotesView, NotesWrote } from '../shared/notes';
export type { NotesFail, NotesView, NotesWrote } from '../shared/notes';
import { folderFingerprint } from './usagetotalsstore';
import { notesMdText, type NotesMdSection } from '../shared/notesmd';
import { HIDDEN_ALL_RE } from '../shared/names';

/** What one import of `.durbar/notes.md` did (FR-054; spec Changes 2026-10-31, T041). Counts only: never a title or a text. */
export interface NotesImport { added: number; edited: number; older: number; deleted: number; tooLong: number; overCap: number; again: number }
/** A file title as Durbar keeps it: hidden bidi and zero-width characters removed (T041 AC14), then `cleanTitle` (undefined: none). */
const fileTitle = (t: string | undefined): string | undefined => (t === undefined ? undefined : cleanTitle(t.replace(HIDDEN_ALL_RE, '')));
const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r));

export type NotesFs = Pick<typeof nodeFs, 'mkdirSync' | 'lstatSync' | 'readFileSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync' | 'chmodSync' | 'linkSync' | 'readdirSync'>;

export interface NotesStoreOptions {
  fs?: NotesFs;
  now?: () => Date;
  /** A uniform integer 0..n-1 (default `crypto.randomInt`). */
  rand?: (n: number) => number;
  /** The platform the folder key is normalised for, and whether modes apply. Default `process.platform`. */
  platform?: string;
  /** Called after every change that reached the disk, with the folder's fingerprint (never a path). */
  onChanged?: (fingerprint: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Makes the temp file names unique across processes. */
  pid?: number;
}

interface Sig { size: number; mtimeMs: number; ino: number }
interface Entry { doc: NotesDoc; sig?: Sig; readOnly?: string }
type Loaded = { ok: true; entry: Entry } | { ok: false; error: string };

const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c) ? c : 'ERROR';
};
const sameSig = (a: Sig | undefined, b: Sig): boolean => !!a && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
const sigOf = (st: nodeFs.Stats): Sig => ({ size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
const UNREADABLE = 'Durbar could not read the notes file of this folder; it is left as it is.';

export class NotesStore {
  private readonly fs: NotesFs;
  private readonly now: () => Date;
  private readonly rand: (n: number) => number;
  private readonly platform: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pid: number;
  private readonly cache = new Map<string, Entry>();
  private readonly queues = new Map<string, Promise<unknown>>();
  onChanged?: (fingerprint: string) => void;

  constructor(private readonly dir: string, opts: NotesStoreOptions = {}) {
    this.fs = opts.fs ?? nodeFs;
    this.now = opts.now ?? (() => new Date());
    this.rand = opts.rand ?? ((n) => randomInt(n));
    this.platform = opts.platform ?? process.platform;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pid = opts.pid ?? process.pid;
    this.onChanged = opts.onChanged;
  }

  fingerprintOf(folderKey: string): string {
    return folderFingerprint(folderKey, this.platform);
  }

  private fileOf(fp: string): string {
    return path.join(this.dir, `${fp}.json`);
  }

  /** Writes of one folder run one after the other, whatever order they were asked in. */
  private queue<T>(fp: string, job: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(fp) ?? Promise.resolve()).then(job, job);
    this.queues.set(fp, run.then(() => undefined, () => undefined));
    return run;
  }

  /** FR-008: the file as it is now, merged with what this process knew when another process changed it. */
  private load(fp: string): Loaded {
    const file = this.fileOf(fp);
    const cached = this.cache.get(fp);
    let st: nodeFs.Stats;
    try {
      st = this.fs.lstatSync(file);
    } catch (e) {
      if (errCode(e) === 'ENOENT') {
        const entry: Entry = { doc: emptyNotesDoc() }; // gone after we saw it (a delete, a restore): an empty document, never the cache
        this.cache.set(fp, entry);
        return { ok: true, entry };
      }
      return { ok: false, error: `${UNREADABLE} (${errCode(e)})` };
    }
    if (!st.isFile()) return { ok: false, error: UNREADABLE };
    if (!fitsCap(st.size, NOTES_LIMITS.storeBytes)) return { ok: false, error: UNREADABLE };
    const sig = sigOf(st);
    if (cached && sameSig(cached.sig, sig)) return { ok: true, entry: cached };
    let raw: string;
    try { raw = this.fs.readFileSync(file, 'utf8'); } catch (e) { return { ok: false, error: `${UNREADABLE} (${errCode(e)})` }; }
    const parsed = parseNotesDoc(raw);
    if (!parsed.ok) return { ok: false, error: UNREADABLE };
    const readOnly = parsed.dropped > 0 ? `${parsed.dropped} note${parsed.dropped === 1 ? '' : 's'} in this folder's notes file could not be read; the file is left as it is.` : undefined;
    const entry: Entry = { doc: cached && !readOnly ? mergeDocs(cached.doc, parsed.doc) : parsed.doc, sig, readOnly };
    this.cache.set(fp, entry);
    return { ok: true, entry };
  }

  private ensureDir(): void {
    this.fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (this.platform !== 'win32') {
      try {
        const st = this.fs.lstatSync(this.dir);
        if (st.isDirectory() && (st.mode & 0o077) !== 0) this.fs.chmodSync(this.dir, 0o700);
      } catch { /* the write below reports a real problem */ }
    }
  }

  /** FR-002, FR-006: measure, then write a unique temp file and rename it over the document. Nothing is written when it would not read back. */
  private async commit(fp: string, doc: NotesDoc): Promise<{ ok: true } | NotesFail> {
    const json = serializeNotesDoc(doc);
    if (!fitsCap(utf8Len(json), NOTES_LIMITS.storeBytes)) return { ok: false, code: 'cap', error: 'These notes are too large to save. Delete or export some first.' };
    const file = this.fileOf(fp);
    const tmp = path.join(this.dir, `${fp}.json.${this.pid}.${this.rand(36 ** 6).toString(36)}.tmp`);
    let fd: number | undefined;
    try {
      this.ensureDir();
      fd = this.fs.openSync(tmp, 'wx', 0o600);
      const buf = Buffer.from(json, 'utf8');
      let off = 0;
      while (off < buf.length) off += this.fs.writeSync(fd, buf, off, buf.length - off);
      try { this.fs.fsyncSync(fd); } catch { /* best effort */ }
      this.fs.closeSync(fd);
      fd = undefined;
      try {
        this.fs.renameSync(tmp, file);
      } catch (e) {
        if (this.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(errCode(e))) {
          await this.sleep(200);
          this.fs.renameSync(tmp, file);
        } else throw e;
      }
      return { ok: true };
    } catch (e) {
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch { /* gone */ } }
      try { this.fs.unlinkSync(tmp); } catch { /* not there */ }
      return { ok: false, code: 'write', error: `Could not save the notes (${errCode(e)}).` };
    }
  }

  private remember(fp: string, doc: NotesDoc): void {
    let sig: Sig | undefined;
    try { sig = sigOf(this.fs.lstatSync(this.fileOf(fp))); } catch { sig = undefined; }
    this.cache.set(fp, { doc, sig });
  }

  /** The change applied under the folder's queue: load (merging another process's change), apply, write, tell the window. */
  private mutate(folderKey: string, folderName: string, fn: (doc: NotesDoc) => ChangeResult | { ok: true; doc?: undefined; note?: Note; existing: true }): Promise<NotesWrote> {
    const fp = this.fingerprintOf(folderKey);
    return this.queue(fp, async (): Promise<NotesWrote> => {
      const lk = await this.lock(fp);
      if (!lk.ok) return lk;
      try {
        const l = this.load(fp);
        if (!l.ok) return { ok: false, code: 'unreadable', error: l.error };
        if (l.entry.readOnly) return { ok: false, code: 'unreadable', error: l.entry.readOnly };
        const r = fn(l.entry.doc);
        if (!r.ok) return r;
        if (!r.doc) return { ok: true, fingerprint: fp, note: r.note, existing: true };
        const doc: NotesDoc = { ...r.doc, folderName: cleanFolderName(folderName) || r.doc.folderName };
        // a holder paused over 5 s may have lost the lock to a takeover: writing now would be the second writer (issue #723)
        if (!(await this.ownsLock(fp, lk.token))) return { ok: false, code: 'write', error: 'The notes are busy (another Durbar is writing them). Try again.' };
        const w = await this.commit(fp, doc);
        if (!w.ok) return w;
        this.remember(fp, doc);
        this.fire(fp);
        return { ok: true, fingerprint: fp, note: r.note };
      } finally {
        await this.unlockFile(fp, lk.token);
      }
    });
  }

  /**
   * FR-008: a lock file `<fingerprint>.lock` (created with `wx`) around load, write and rename, so two Durbar processes cannot both
   * read the old file and both write. A lock older than 5 s is a crashed process's and is taken over; a busy lock is retried every
   * 20 ms for up to 2 s, then the change is refused with a short reason.
   */
  private async lock(fp: string): Promise<{ ok: true; token: string } | NotesFail> {
    const file = path.join(this.dir, `${fp}.lock`);
    const guard = path.join(this.dir, `${fp}.takeover`);
    const deadline = Date.now() + 2000;
    try { this.ensureDir(); } catch (e) { return { ok: false, code: 'write', error: `Could not save the notes (${errCode(e)}).` }; }
    const busy = (): NotesFail => ({ ok: false, code: 'write', error: 'The notes are busy (another Durbar is writing them). Try again.' });
    // the lock holds a token only its owner knows: a holder that was slow and lost its lock to a takeover must not delete or write under the new owner's lock
    const token = `${this.pid}.${this.rand(36 ** 8).toString(36)}`;
    let quick = 0;
    // a retry "at once" (the lock vanished, a takeover worked) is allowed once in a row; the second pauses 20 ms, so a filesystem that keeps
    // answering EEXIST and then ENOENT can never spin, and the deadline is checked on every pass
    const again = async (): Promise<void> => { if (++quick > 1) { quick = 0; await this.sleep(20); } };
    for (;;) {
      if (Date.now() > deadline) return busy();
      try {
        this.createOwned(file, token);
        return { ok: true, token };
      } catch (e) {
        const code = errCode(e);
        if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
          // reasoned, not verified on Windows: a lock another process just deleted can still be delete-pending and refuse a new one with these; wait like for a busy lock
          await this.sleep(20);
          continue;
        }
        if (code !== 'EEXIST') return { ok: false, code: 'write', error: `Could not save the notes (${code}).` };
      }
      let st: nodeFs.BigIntStats | undefined;
      try { st = this.fs.lstatSync(file, { bigint: true }); } catch (e) { if (errCode(e) === 'ENOENT') { await again(); continue; } } // gone: try again (at once, once); any other error waits like a busy lock
      if (st && Date.now() - Number(st.mtimeMs) > 5000) {
        // Looks stale (its owner is gone). Issue #723: the lstat above and the move below are not one step, so a process that judged the
        // lock stale could move away a FRESH lock another process had just taken over, and a third one then created its own while it was gone
        // (two writers, a lost note). Only the holder of the short-lived `<fingerprint>.takeover` guard may break a lock, and it looks again under it.
        const gtoken = `${token}.g`;
        let got = false;
        try { this.createOwned(guard, gtoken); got = true; } catch (e) {
          if (errCode(e) === 'EEXIST') {
            // a crashed taker's guard goes stale too: break it the same safe way (move aside, check identity), never by a bare delete
            try { const gst = this.fs.lstatSync(guard, { bigint: true }); if (Date.now() - Number(gst.mtimeMs) > 5000) this.breakStale(guard, gst); } catch { /* gone, or kept by the OS */ }
          }
        }
        if (got) {
          try {
            let cur: nodeFs.BigIntStats | undefined;
            try { cur = this.fs.lstatSync(file, { bigint: true }); } catch { cur = undefined; }
            if (!cur) { await again(); continue; } // it vanished (or cannot be looked at): decide again from the top
            if (Date.now() - Number(cur.mtimeMs) <= 5000) { await this.sleep(20); continue; } // a fresh lock was taken over meanwhile: respect it
            this.sweepLeftovers(fp);
            if (this.breakStale(file, cur) !== 'kept') { await again(); continue; }
          } finally {
            // release the guard only while it still holds our token (it could have been judged stale and taken by someone else)
            await this.release(guard, gtoken);
          }
        }
      }
      await this.sleep(20);
    }
  }

  /** Create `file` with `wx` and write `token` into it; on a failed write the file is removed again and the error thrown. */
  private createOwned(file: string, token: string): void {
    const fd = this.fs.openSync(file, 'wx', 0o600);
    try {
      this.fs.writeSync(fd, Buffer.from(token, 'utf8'), 0, Buffer.byteLength(token));
      this.fs.closeSync(fd);
    } catch (e) {
      try { this.fs.closeSync(fd); } catch { /* gone */ }
      try { this.fs.unlinkSync(file); } catch { /* the stale rule covers it */ }
      throw e;
    }
  }

  /**
   * Break a file judged stale (`st` is what was seen): move it to a name of our own, check it is the file we saw (same inode and time) and
   * only then delete it. 'broken' = deleted, 'gone' = someone else removed it first, 'kept' = it could not be moved, or it was a different
   * (fresh) file, which is put back without overwriting (a hard link fails with EEXIST when a newcomer already holds the name; then the
   * newcomer's file stays and the moved one is dropped: a remaining, narrow gap, FR-008).
   */
  private breakStale(file: string, st: nodeFs.BigIntStats): 'broken' | 'gone' | 'kept' {
    const aside = `${file}.stale-${this.pid}-${this.rand(36 ** 6).toString(36)}`;
    try { this.fs.renameSync(file, aside); } catch (e) { return errCode(e) === 'ENOENT' ? 'gone' : 'kept'; }
    let same = false;
    try { const mv = this.fs.lstatSync(aside, { bigint: true }); same = mv.ino === st.ino && mv.mtimeNs === st.mtimeNs; } catch { /* gone */ }
    if (!same) {
      try { this.fs.linkSync(aside, file); } catch { /* a newcomer's file stays, or the link failed: the moved file is dropped */ }
      try { this.fs.unlinkSync(aside); } catch { /* a leftover .stale file is harmless */ }
      return 'kept';
    }
    try { this.fs.unlinkSync(aside); } catch { /* the file itself is gone; a leftover .stale file is harmless */ }
    return 'broken';
  }

  /** True while `file` holds our token. Only a missing file (ENOENT) or another token says "not ours"; any other read error (Windows: antivirus, EBUSY) is retried a few times 20 ms apart, then also counts as not ours (the safe side). */
  private async holds(file: string, token: string): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      try { return this.fs.readFileSync(file, 'utf8') === token; } catch (e) {
        if (errCode(e) === 'ENOENT') return false;
        await this.sleep(20);
      }
    }
    return false;
  }

  /** True while the lock file still holds our token (we were not judged stale and replaced). */
  private ownsLock(fp: string, token: string): Promise<boolean> {
    return this.holds(path.join(this.dir, `${fp}.lock`), token);
  }

  private async unlockFile(fp: string, token: string): Promise<void> {
    // a failed release leaves a lock that goes stale after 5 s; the next writer takes it over by the stale rule
    await this.release(path.join(this.dir, `${fp}.lock`), token);
  }

  /**
   * Delete `file` only if it still holds our token. Check first (a file that is not ours is never touched, not even moved), then move it to a
   * name of our own and read the token again in the moved file: ours is deleted, anything else (a takeover between the check and the move)
   * is put back without overwriting. Remaining windows: between the check and the move; the put-back in that case (the name is free for a
   * few system calls and a newcomer that takes it makes the put-back fail, so the moved lock is dropped); and when the move is refused, the
   * delete by path after the check.
   */
  private async release(file: string, token: string): Promise<void> {
    // not ours (already replaced, or gone): do not touch it at all, a foreign live lock must not even be moved
    if (!(await this.holds(file, token))) return;
    const aside = `${file}.rel-${this.pid}-${this.rand(36 ** 6).toString(36)}`;
    try { this.fs.renameSync(file, aside); } catch (e) {
      if (errCode(e) === 'ENOENT') return; // gone: nothing to release
      // the move itself is refused (Windows: EPERM, EBUSY): check again, then delete by path (a takeover in that instant is the narrow race left)
      if (await this.holds(file, token)) { try { this.fs.unlinkSync(file); } catch { /* the stale rule covers it */ } }
      return;
    }
    if (await this.holds(aside, token)) { try { this.fs.unlinkSync(aside); } catch { /* a leftover .rel file is swept later */ } return; }
    try { this.fs.linkSync(aside, file); } catch { /* a newcomer's file stays, or the link failed: the moved file is dropped */ }
    try { this.fs.unlinkSync(aside); } catch { /* a leftover .rel file is swept later */ }
  }

  /** Under the takeover guard: delete this folder's `.stale-*` / `.rel-*` files that a crash left behind (older than 60 s). Other folders' files are never touched. */
  private sweepLeftovers(fp: string): void {
    try {
      for (const name of this.fs.readdirSync(this.dir)) {
        if (!(name.startsWith(`${fp}.lock.`) || name.startsWith(`${fp}.takeover.`)) || !/\.(stale|rel)-[0-9]+-[0-9a-z]+$/.test(name)) continue;
        const f = path.join(this.dir, name);
        try { if (Date.now() - Number(this.fs.lstatSync(f, { bigint: true }).mtimeMs) > 60_000) this.fs.unlinkSync(f); } catch { /* gone or kept: next time */ }
      }
    } catch { /* a listing that fails is not worth a refusal */ }
  }

  private fire(fp: string): void {
    try { this.onChanged?.(fp); } catch { /* a listener must not break a save */ }
  }

  /** The folder's notes, newest first as stored order (the window orders them, FR-021). A file Durbar cannot read gives `unreadable`. */
  list(folderKey: string): Promise<NotesView> {
    const fp = this.fingerprintOf(folderKey);
    return this.queue(fp, async (): Promise<NotesView> => {
      const l = this.load(fp);
      if (!l.ok) return { ok: false, code: 'unreadable', error: l.error };
      const d = l.entry.doc;
      return { ok: true, fingerprint: fp, folderName: d.folderName, notes: d.notes.map((n) => ({ ...n })), max: NOTES_LIMITS.notesPerFolder, ...(l.entry.readOnly ? { readOnly: l.entry.readOnly } : {}) };
    });
  }

  /** Masks title or text: the known values first, then the shapes (FR-005); `changed` feeds the note's `hidden`. */
  private mask(text: string, values: readonly string[]): { text: string; changed: boolean } {
    // controls are removed BEFORE the mask: a secret split by \u0001 or \u001b shows its shape only once they are gone (FR-005, FR-006)
    const clean = stripControls(text);
    const m = maskNoteText(clean, values);
    return { text: m.text, changed: m.changed };
  }

  /**
   * FR-009, FR-011: a message saved from a chat. `text` is the raw message and is masked here; a note with the same session and
   * digest already there is returned as it is (`existing`), no second note.
   */
  save(folderKey: string, folderName: string, input: { text: string; from: 'agent' | 'user' | 'selection'; source?: NoteSource; values?: readonly string[] }): Promise<NotesWrote> {
    return this.add(folderKey, folderName, { text: input.text, from: input.from, source: input.source, values: input.values });
  }

  /** FR-012: a note typed by hand (`from: typed`, no source), or a saved message when `from` and `source` are given. */
  add(folderKey: string, folderName: string, input: { text: string; title?: string; from?: 'agent' | 'user' | 'selection' | 'typed'; source?: NoteSource; values?: readonly string[] }): Promise<NotesWrote> {
    if (typeof input.text !== 'string' || input.text.length > NOTES_LIMITS.inputChars) {
      return Promise.resolve({ ok: false, code: 'invalid', error: 'That text is too long to save as a note.' });
    }
    if (input.title !== undefined && cleanTitle(input.title) === undefined) return Promise.resolve({ ok: false, code: 'invalid', error: 'The title is empty or has control characters.' });
    const values = input.values ?? [];
    const mt = this.mask(input.text, values);
    const fit = fitText(mt.text); // mask, then cut
    const mTitle = input.title === undefined ? undefined : this.mask(input.title, values);
    const title = mTitle ? mTitle.text : guessTitle(fit.text, this.now());
    const hidden = mt.changed || !!mTitle?.changed;
    const source = input.source;
    return this.mutate(folderKey, folderName, (doc) => {
      if (source) {
        const same = doc.notes.find((n) => n.source?.session === source.session && n.source.digest === source.digest && n.source.role === source.role);
        if (same) return { ok: true, note: { ...same }, existing: true };
      }
      const change: NoteChange = { op: 'add', text: fit.text, title, from: input.from ?? 'typed', hidden, ...(source ? { source } : {}) };
      return applyChange(doc, change, this.now(), () => newNoteId(this.rand));
    });
  }

  /** FR-013: edit or rename one note; `rev` is the version the window holds, a different one is `stale` and carries the saved note. */
  update(folderKey: string, folderName: string, id: string, rev: number, patch: { title?: string; text?: string; done?: boolean; values?: readonly string[] }): Promise<NotesWrote> {
    if (patch.text !== undefined && (typeof patch.text !== 'string' || patch.text.length > NOTES_LIMITS.inputChars)) {
      return Promise.resolve({ ok: false, code: 'invalid', error: 'That text is too long to save as a note.' });
    }
    if (patch.title !== undefined && cleanTitle(patch.title) === undefined) return Promise.resolve({ ok: false, code: 'invalid', error: 'The title is empty or has control characters.' });
    const values = patch.values ?? [];
    const mt = patch.text === undefined ? undefined : this.mask(patch.text, values);
    const mTitle = patch.title === undefined ? undefined : this.mask(patch.title, values);
    const change: NoteChange = {
      op: 'update', id, rev,
      ...(mTitle ? { title: mTitle.text } : {}),
      ...(mt ? { text: fitText(mt.text).text } : {}),
      ...(patch.done !== undefined ? { done: patch.done === true } : {}),
      hidden: !!mt?.changed || !!mTitle?.changed,
    };
    return this.mutate(folderKey, folderName, (doc) => applyChange(doc, change, this.now(), () => newNoteId(this.rand)));
  }

  /** FR-014: delete one note (a tombstone stays so another process's older copy cannot bring it back). */
  remove(folderKey: string, folderName: string, id: string, rev: number): Promise<NotesWrote> {
    return this.mutate(folderKey, folderName, (doc) => applyChange(doc, { op: 'delete', id, rev }, this.now(), () => ''));
  }

  /** FR-048: every note of the folder, tombstones kept. */
  removeAll(folderKey: string, folderName: string): Promise<NotesWrote> {
    return this.mutate(folderKey, folderName, (doc) => applyChange(doc, { op: 'deleteAll' }, this.now(), () => ''));
  }

  /** FR-007: a file Durbar cannot read is renamed to `<fingerprint>.json.bad-<UTC time>` (0600) and the folder starts empty. */
  startOver(folderKey: string): Promise<{ ok: true; fingerprint: string } | NotesFail> {
    const fp = this.fingerprintOf(folderKey);
    return this.queue(fp, async () => {
      const nothing = { ok: false, code: 'invalid', error: 'The notes file of this folder can be read; there is nothing to start over.' } as NotesFail;
      const first = this.load(fp);
      if (first.ok && !first.entry.readOnly) return nothing;
      const lk = await this.lock(fp);
      if (!lk.ok) return lk;
      try {
        const again = this.load(fp); // under the lock: another process may have put a healthy file there since the first look
        if (again.ok && !again.entry.readOnly) return nothing;
        if (!(await this.ownsLock(fp, lk.token))) return { ok: false, code: 'write', error: 'The notes are busy (another Durbar is writing them). Try again.' };
        return await this.moveAside(fp);
      } finally { await this.unlockFile(fp, lk.token); }
    });
  }

  private async moveAside(fp: string): Promise<{ ok: true; fingerprint: string } | NotesFail> {
    {
      const file = this.fileOf(fp);
      try {
        const st = this.fs.lstatSync(file);
        const stamp = this.now().toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
        let dest = `${file}.bad-${stamp}`;
        for (let i = 2; i < 100; i++) {
          try { this.fs.lstatSync(dest); dest = `${file}.bad-${stamp}-${i}`; } catch { break; }
        }
        this.fs.renameSync(file, dest);
        if (this.platform !== 'win32' && st.isFile()) { try { this.fs.chmodSync(dest, 0o600); } catch { /* best effort */ } }
      } catch (e) {
        if (errCode(e) !== 'ENOENT') return { ok: false, code: 'write', error: `Could not move the notes file aside (${errCode(e)}).` } as NotesFail;
      }
      this.cache.delete(fp);
      this.fire(fp);
      return { ok: true as const, fingerprint: fp };
    }
  }

  /**
   * FR-054 (T041 AC3, AC11..AC16): the sections parsed from the folder's `.durbar/notes.md`, imported. A known id whose title (hidden
   * characters removed), text (`notesMdText` form) or `done` differs is an edit, unless its marker's `updated=` is older than the stored
   * note (an older copy: a branch switch, a revert); `created=` is ignored and the edit's time is `updated=` clamped to now, never
   * earlier than the stored one; the edit sets `fileEdited`. Any other section is a new note `from: file`, created now (a valid id never
   * seen is kept; one with a tombstone is not imported). Titles and texts are masked with the folder's `values`, then cut (`fitText`);
   * a text over `inputChars` is not imported. A section that is gone deletes nothing. Masking runs before the lock, yielding between
   * sections; everything is applied in one write.
   */
  async importFile(folderKey: string, folderName: string, sections: readonly NotesMdSection[], values: readonly string[] = [], fileSha?: string): Promise<NotesWrote & { counts?: NotesImport }> {
    const counts: NotesImport = { added: 0, edited: 0, older: 0, deleted: 0, tooLong: 0, overCap: 0, again: 0 };
    // ids the file holds: a note an earlier import added and that was written back has its id in the file
    const fileIds = new Set<string>();
    for (const s of sections) if (s.id !== undefined) fileIds.add(s.id);
    const snap = await this.list(folderKey);
    const known = new Map<string, Note>(snap.ok ? snap.notes.map((n) => [n.id, n]) : []);
    // what the file says differs from the stored note (cheap string compares, no mask yet)
    const differs = (s: NotesMdSection, n: Note): boolean => {
      const t = fileTitle(s.title);
      return (t !== undefined && t !== n.title) || notesMdText(n.text) !== s.text || s.done !== n.done;
    };
    const masked = new Map<NotesMdSection, { text: string; title?: string; hidden: boolean }>();
    const maskOne = (s: NotesMdSection): { text: string; title?: string; hidden: boolean } => {
      let m = masked.get(s);
      if (!m) {
        const mt = this.mask(s.text, values);
        const rawTitle = fileTitle(s.title);
        const mTitle = rawTitle === undefined ? undefined : this.mask(rawTitle, values);
        m = { text: fitText(mt.text).text, title: mTitle ? cleanTitle(mTitle.text) : undefined, hidden: mt.changed || !!mTitle?.changed };
        masked.set(s, m);
      }
      return m;
    };
    for (const s of sections) {
      if (s.text.length > NOTES_LIMITS.inputChars) continue;
      const n = s.id !== undefined ? known.get(s.id) : undefined;
      if (n && !differs(s, n)) continue;
      maskOne(s);
      await yieldNow(); // a file at the cap is masked in slices: other work runs between sections
    }
    const now = this.now();
    const res = await this.mutate(folderKey, folderName, (doc) => {
      Object.assign(counts, { added: 0, edited: 0, older: 0, deleted: 0, tooLong: 0, overCap: 0, again: 0 });
      let d = doc;
      const dead = new Set(doc.tombstones.map((t) => t.id));
      for (const s of sections) {
        if (s.text.length > NOTES_LIMITS.inputChars) { counts.tooLong++; continue; }
        const cur = s.id !== undefined ? d.notes.find((n) => n.id === s.id) : undefined;
        if (cur) {
          if (!differs(s, cur)) continue;
          const curAt = Date.parse(cur.updatedAt);
          const fileAt = s.updatedAt !== undefined ? Date.parse(s.updatedAt) : NaN;
          if (!Number.isNaN(fileAt) && fileAt < curAt) { counts.older++; continue; } // an older copy of the note, not an edit
          const at = new Date(Math.max(Number.isNaN(fileAt) ? now.getTime() : Math.min(fileAt, now.getTime()), curAt));
          const m = maskOne(s);
          const r = applyChange(d, { op: 'update', id: cur.id, rev: cur.rev, text: m.text.trim() ? m.text : undefined, ...(m.title !== undefined ? { title: m.title } : {}), done: s.done, hidden: m.hidden }, at, () => '');
          if (!r.ok || !r.note || r.note.rev === cur.rev) continue;
          const i = r.doc.notes.findIndex((n) => n.id === cur.id);
          r.doc.notes[i] = { ...r.doc.notes[i], fileEdited: true };
          d = r.doc;
          counts.edited++;
          continue;
        }
        if (s.id !== undefined && dead.has(s.id)) { counts.deleted++; continue; } // deleted in Durbar: it leaves the file at the next write
        const m = maskOne(s);
        if (!m.text.trim()) continue;
        // the same new section seen again before a write put its id into the file (a retry, a failing write, a restart): not a second note
        const title = m.title ?? guessTitle(m.text, now);
        if (d.notes.some((n) => n.from === 'file' && !fileIds.has(n.id) && n.text === m.text && n.title === title)) { counts.again++; continue; }
        if (d.notes.length >= NOTES_LIMITS.notesPerFolder) { counts.overCap++; continue; }
        const keepId = s.id !== undefined ? s.id : undefined;
        const r = applyChange(d, { op: 'add', text: m.text, title, from: 'file', hidden: m.hidden }, now, () => keepId ?? newNoteId(this.rand));
        if (!r.ok || !r.note) continue;
        if (s.done) { const i = r.doc.notes.findIndex((n) => n.id === r.note!.id); r.doc.notes[i] = { ...r.doc.notes[i], done: true }; }
        d = r.doc;
        counts.added++;
      }
      if (fileSha && d.fileImport?.sha256 !== fileSha) d = { ...d, fileImport: { sha256: fileSha, at: now.toISOString() } };
      return d === doc ? { ok: true, existing: true } : { ok: true, doc: d };
    });
    return res.ok ? { ...res, counts } : res;
  }

  /** The hash of the last `notes.md` imported (FR-054), as the document holds it. */
  async getFileImport(folderKey: string): Promise<string | undefined> {
    const fp = this.fingerprintOf(folderKey);
    return this.queue(fp, async () => {
      const l = this.load(fp);
      return l.ok ? l.entry.doc.fileImport?.sha256 : undefined;
    });
  }

  /** The last `notes.md` Durbar wrote (FR-053), as the document holds it. */
  async getMirror(folderKey: string): Promise<NotesMirror | undefined> {
    const fp = this.fingerprintOf(folderKey);
    return this.queue(fp, async () => {
      const l = this.load(fp);
      return l.ok ? l.entry.doc.mirror : undefined;
    });
  }

  /** FR-053: persist the hash of the `notes.md` just written (or forget it), in an atomic write of the document. */
  setMirror(folderKey: string, folderName: string, mirror: NotesMirror | undefined): Promise<NotesWrote> {
    return this.mutate(folderKey, folderName, (doc) => {
      const next: NotesDoc = { ...doc, notes: doc.notes.map((n) => ({ ...n })), tombstones: doc.tombstones.map((t) => ({ ...t })) };
      if (mirror) next.mirror = { sha256: mirror.sha256, bytes: mirror.bytes, at: mirror.at };
      else delete next.mirror;
      return { ok: true, doc: next };
    });
  }
}
