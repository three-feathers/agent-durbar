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

export type NotesFs = Pick<typeof nodeFs, 'mkdirSync' | 'lstatSync' | 'readFileSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync' | 'chmodSync' | 'linkSync'>;

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
  private mutate(folderKey: string, folderName: string, fn: (doc: NotesDoc) => ChangeResult | { ok: true; doc?: undefined; note: Note; existing: true }): Promise<NotesWrote> {
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
        if (!this.ownsLock(fp, lk.token)) return { ok: false, code: 'write', error: 'The notes are busy (another Durbar is writing them). Try again.' };
        const w = await this.commit(fp, doc);
        if (!w.ok) return w;
        this.remember(fp, doc);
        this.fire(fp);
        return { ok: true, fingerprint: fp, note: r.note };
      } finally {
        this.unlockFile(fp, lk.token);
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
        const fd = this.fs.openSync(file, 'wx', 0o600);
        try {
          this.fs.writeSync(fd, Buffer.from(token, 'utf8'), 0, Buffer.byteLength(token));
          this.fs.closeSync(fd);
        } catch (e) {
          try { this.fs.closeSync(fd); } catch { /* gone */ }
          try { this.fs.unlinkSync(file); } catch { /* the stale rule covers it */ }
          return { ok: false, code: 'write', error: `Could not save the notes (${errCode(e)}).` };
        }
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
        // (two writers, a lost note). Only the holder of the short-lived `<fingerprint>.takeover` file may break a lock, and it looks again under it.
        let got = false;
        try { this.fs.closeSync(this.fs.openSync(guard, 'wx', 0o600)); got = true; } catch (e) {
          if (errCode(e) === 'EEXIST') {
            // a crashed taker's guard is stale too
            try { if (Date.now() - Number(this.fs.lstatSync(guard, { bigint: true }).mtimeMs) > 5000) this.fs.unlinkSync(guard); } catch { /* gone, or kept by the OS */ }
          }
        }
        if (got) {
          try {
            let cur: nodeFs.BigIntStats | undefined;
            try { cur = this.fs.lstatSync(file, { bigint: true }); } catch { cur = undefined; }
            if (!cur) { await again(); continue; } // it vanished (or cannot be looked at): decide again from the top
            if (Date.now() - Number(cur.mtimeMs) <= 5000) { await this.sleep(20); continue; } // a fresh lock was taken over meanwhile: respect it
            // stale: move it to a name of our own, then check it is the lock we just saw (same inode and time) before deleting it
            const aside = `${file}.stale-${this.pid}-${this.rand(36 ** 6).toString(36)}`;
            let moved = false;
            try { this.fs.renameSync(file, aside); moved = true; } catch (e) { if (errCode(e) === 'ENOENT') { await again(); continue; } }
            if (moved) {
              let same = false;
              try { const mv = this.fs.lstatSync(aside, { bigint: true }); same = mv.ino === cur.ino && mv.mtimeNs === cur.mtimeNs; } catch { /* gone */ }
              if (!same) {
                // not the lock we saw: put it back WITHOUT overwriting (a hard link fails with EEXIST when a newcomer already holds the lock;
                // then that lock stays and the moved one is dropped, the remaining gap in FR-008)
                try { this.fs.linkSync(aside, file); } catch { /* a newcomer's lock stays, or the link failed: the moved file is dropped */ }
                try { this.fs.unlinkSync(aside); } catch { /* a leftover .stale file is harmless */ }
              } else {
                try { this.fs.unlinkSync(aside); } catch { /* the lock itself is gone; a leftover .stale file is harmless */ }
                await again();
                continue;
              }
            }
          } finally {
            try { this.fs.unlinkSync(guard); } catch { /* a leftover guard goes stale after 5 s */ }
          }
        }
      }
      await this.sleep(20);
    }
  }

  /** True while the lock file still holds our token (we were not judged stale and replaced). */
  private ownsLock(fp: string, token: string): boolean {
    try { return this.fs.readFileSync(path.join(this.dir, `${fp}.lock`), 'utf8') === token; } catch { return false; }
  }

  private unlockFile(fp: string, token: string): void {
    // never delete a lock that is not ours any more (a slow holder lost it to a takeover); a failed unlink leaves a lock that goes stale after 5 s
    if (!this.ownsLock(fp, token)) return;
    try { this.fs.unlinkSync(path.join(this.dir, `${fp}.lock`)); } catch { /* already gone, or kept by the OS: the stale rule covers it */ }
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
        if (!this.ownsLock(fp, lk.token)) return { ok: false, code: 'write', error: 'The notes are busy (another Durbar is writing them). Try again.' };
        return await this.moveAside(fp);
      } finally { this.unlockFile(fp, lk.token); }
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
