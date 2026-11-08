/**
 * My characters on disk (spec 096 FR-030, US4). No Electron. `<root>/<id>/` holds `working.webp`, `waiting.webp`, `resting.webp`, optionally `blink.webp`, and
 * `character.json`. No description or prompt is ever given to this store (D3, SC-004).
 *  - Main makes every id; a path is only ever built from an id that passes `CHARACTER_ID_RE`, so no text from the window becomes a path.
 *  - A save writes a temp folder, then renames it: nothing half-written stays.
 *  - The store reads only folders whose name is an id and files from its own list, never a link. A bad folder is skipped with a warning that names no path.
 *  - Every write is under the root, except `export`, which writes one new folder inside the folder the user picked, overwriting nothing.
 * No error text here carries a path: the sentences are the store's own.
 */
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CHARACTER_ID_RE, cleanCharacterName, isStoredFace } from '../shared/charrules';
import type { FaceSet, FrameSet } from '../shared/charrules';
import { MAX_FRAME_BYTES, checkFrames } from '../shared/webpcheck';

export interface CharacterEntry {
  id: string;
  name: string;
  created: string;
  madeBy: 'codex';
  style: string;
  face: FaceSet;
  blink: boolean;
}
export interface NewCharacter {
  frames: FrameSet;
  face: FaceSet;
  style: string;
}
export type StoreFailure = { ok: false; error: string };

const JSON_FILE = 'character.json';
const FRAME_FILES = { working: 'working.webp', waiting: 'waiting.webp', resting: 'resting.webp' } as const;
const BLINK_FILE = 'blink.webp';
const POSES = ['working', 'waiting', 'resting'] as const;
const MAX_JSON_BYTES = 4 * 1024;
const STYLE_RE = /^[a-z0-9-]{1,64}$/;
const TMP_PREFIX = '.tmp-';
const SAVE_FAILED = 'The character could not be saved. Check that the disk has room and the profile folder can be written.';
const UNKNOWN: StoreFailure = { ok: false, error: 'That character is not in the list.' };
/** Windows keeps these names for devices: never a folder name. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const MAX_SUFFIX = 99;

const hex = (n: number): string => randomBytes(n).toString('hex');
const lstatOf = (p: string): fs.Stats | null => { try { return fs.lstatSync(p); } catch { return null; } };

/** FR-030: a regular file, never a link, up to `cap` bytes. Checked before and after the open, so a link or a FIFO is not followed or waited on. */
function readRegular(file: string, cap: number): Buffer | null {
  const st = lstatOf(file);
  if (!st || !st.isFile() || st.size > cap) return null;
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, O_RDONLY | (O_NOFOLLOW ?? 0) | (O_NONBLOCK ?? 0));
    const now = fs.fstatSync(fd);
    if (!now.isFile() || now.size > cap || now.ino !== st.ino) return null;
    const buf = Buffer.alloc(now.size);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, got);
      if (n <= 0) return null;
      got += n;
    }
    return buf;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/** A folder name from a character name: lower-case letters, digits and dashes; never empty, a Windows device name, or a path. */
export function nameSlug(name: string): string {
  const s = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!s) return 'character';
  return WINDOWS_RESERVED.test(s) ? `character-${s}` : s;
}

export class CharacterStore {
  /** `warn` gets one plain line per bad folder (no path). `id` makes a new id; a test injects its own. */
  constructor(private readonly root: string, private readonly warn: (msg: string) => void = () => undefined, private readonly newId: () => string = () => `my-${hex(6)}`) {}

  /** A folder path only for a real id: the one place a path is made from an id. */
  private dirOf(id: unknown): string | null {
    return typeof id === 'string' && CHARACTER_ID_RE.test(id) ? path.join(this.root, id) : null;
  }

  /** The root as a real folder: a link in its place is not used. */
  private rootOk(): boolean {
    const st = lstatOf(this.root);
    return !!st && st.isDirectory();
  }

  /** One character's record, or null when anything about the folder is off (FR-030). */
  private readEntry(id: string): CharacterEntry | null {
    const dir = this.dirOf(id);
    if (!dir) return null;
    const st = lstatOf(dir);
    if (!st || !st.isDirectory()) return null;
    const raw = readRegular(path.join(dir, JSON_FILE), MAX_JSON_BYTES);
    if (!raw) return null;
    let doc: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(raw.toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      doc = v as Record<string, unknown>;
    } catch {
      return null;
    }
    if (doc.v !== 1 || doc.id !== id || doc.madeBy !== 'codex' || typeof doc.blink !== 'boolean') return null;
    if (typeof doc.style !== 'string' || !STYLE_RE.test(doc.style)) return null;
    if (typeof doc.created !== 'string' || doc.created.length > 40 || !Number.isFinite(Date.parse(doc.created))) return null;
    const name = cleanCharacterName(doc.name);
    if (!name.ok || name.name !== doc.name) return null;
    const f = doc.face as Record<string, unknown> | null;
    if (!f || typeof f !== 'object' || !POSES.every((p) => isStoredFace(f[p]))) return null;
    for (const file of Object.values(FRAME_FILES)) { const s = lstatOf(path.join(dir, file)); if (!s || !s.isFile() || s.size > MAX_FRAME_BYTES) return null; }
    const blink = lstatOf(path.join(dir, BLINK_FILE));
    if (doc.blink ? !blink || !blink.isFile() || blink.size > MAX_FRAME_BYTES : !!blink) return null;
    return { id, name: name.name, created: doc.created, madeBy: 'codex', style: doc.style, face: { working: f.working, waiting: f.waiting, resting: f.resting } as FaceSet, blink: doc.blink };
  }

  /** Every usable character, newest first. Only folders named like an id are looked at. */
  list(): CharacterEntry[] {
    if (!this.rootOk()) return [];
    let names: fs.Dirent[];
    try { names = fs.readdirSync(this.root, { withFileTypes: true }); } catch { return []; }
    const out: CharacterEntry[] = [];
    for (const d of names) {
      if (!CHARACTER_ID_RE.test(d.name)) continue;
      const e = d.isDirectory() ? this.readEntry(d.name) : null;
      if (e) out.push(e);
      else this.warn('characters: a bad character folder was skipped');
    }
    return out.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
  }

  has(id: unknown): boolean {
    return typeof id === 'string' && !!this.dirOf(id) && !!this.readEntry(id);
  }

  /** FR-030: checks the frames again, writes a temp folder, renames it to a new id. A failure leaves nothing. `name` is the caller's checked name, or empty for "My character N". */
  save(c: NewCharacter, name: string): { ok: true; id: string; name: string } | StoreFailure {
    const current = this.list();
    const frames = [c.frames.working, c.frames.waiting, c.frames.resting, ...(c.frames.blink ? [c.frames.blink] : [])];
    if (checkFrames(frames).length) return { ok: false, error: 'The pictures did not pass the final check. Try again.' };
    if (!STYLE_RE.test(c.style) || !POSES.every((p) => isStoredFace(c.face[p]))) return { ok: false, error: 'The pictures did not pass the final check. Try again.' };
    let finalName = name;
    if (!finalName) {
      const taken = new Set(current.map((e) => e.name));
      let n = current.length + 1;
      while (taken.has(`My character ${n}`)) n++;
      finalName = `My character ${n}`;
    }
    const checked = cleanCharacterName(finalName);
    if (!checked.ok) return checked;
    const id = this.newId();
    const dir = this.dirOf(id);
    if (!dir || lstatOf(dir)) return { ok: false, error: SAVE_FAILED };
    const tmp = path.join(this.root, TMP_PREFIX + hex(6));
    try {
      fs.mkdirSync(this.root, { recursive: true });
      if (!this.rootOk()) return { ok: false, error: SAVE_FAILED };
      this.sweep();
      fs.mkdirSync(tmp);
      for (const p of POSES) fs.writeFileSync(path.join(tmp, FRAME_FILES[p]), c.frames[p], { flag: 'wx', mode: 0o600 });
      if (c.frames.blink) fs.writeFileSync(path.join(tmp, BLINK_FILE), c.frames.blink, { flag: 'wx', mode: 0o600 });
      const entry = { v: 1, id, name: checked.name, created: new Date().toISOString(), madeBy: 'codex', style: c.style, face: { working: c.face.working, waiting: c.face.waiting, resting: c.face.resting }, blink: !!c.frames.blink };
      fs.writeFileSync(path.join(tmp, JSON_FILE), JSON.stringify(entry, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, dir);
      return { ok: true, id, name: checked.name };
    } catch {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the sweep gets it */ }
      return { ok: false, error: SAVE_FAILED };
    }
  }

  /** Temp folders a crash left behind. Only real folders named like one, directly in the root. */
  private sweep(): void {
    for (const d of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.startsWith(TMP_PREFIX)) fs.rmSync(path.join(this.root, d.name), { recursive: true, force: true });
    }
  }

  /** The frames as stored, each checked again; anything off is refused rather than handed to the window. */
  frames(id: unknown): ({ ok: true } & { frames: FrameSet }) | StoreFailure {
    const dir = this.dirOf(id);
    const e = dir ? this.readEntry(id as string) : null;
    if (!dir || !e) return UNKNOWN;
    const read = (f: string): Buffer | null => readRegular(path.join(dir, f), MAX_FRAME_BYTES);
    const working = read(FRAME_FILES.working), waiting = read(FRAME_FILES.waiting), resting = read(FRAME_FILES.resting), blink = e.blink ? read(BLINK_FILE) : null;
    if (!working || !waiting || !resting || (e.blink && !blink)) return { ok: false, error: 'The pictures of that character could not be read.' };
    const all = [working, waiting, resting, ...(blink ? [blink] : [])];
    if (checkFrames(all).length) return { ok: false, error: 'The pictures of that character could not be read.' };
    return { ok: true, frames: { working, waiting, resting, ...(blink ? { blink } : {}) } };
  }

  /** Only the name changes; the id stays (US4 scenario 1). Written to a temp name, then renamed. */
  rename(id: unknown, name: unknown): { ok: true; id: string; name: string } | StoreFailure {
    const dir = this.dirOf(id);
    const e = dir ? this.readEntry(id as string) : null;
    if (!dir || !e) return UNKNOWN;
    const checked = cleanCharacterName(name);
    if (!checked.ok) return checked;
    const tmp = path.join(dir, `${JSON_FILE}.${hex(6)}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, id: e.id, name: checked.name, created: e.created, madeBy: e.madeBy, style: e.style, face: e.face, blink: e.blink }, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, path.join(dir, JSON_FILE));
      return { ok: true, id: e.id, name: checked.name };
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
      return { ok: false, error: SAVE_FAILED };
    }
  }

  /** Removes a character's own folder. A link named like an id is not a character (`has` is false), so what it points at is never touched. */
  delete(id: unknown): { ok: true } | StoreFailure {
    const dir = this.dirOf(id);
    if (!dir || !this.readEntry(id as string)) return UNKNOWN;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    } catch {
      return { ok: false, error: 'The character could not be deleted.' };
    }
  }

  /**
   * US4 scenario 3: `<target>/<name-slug>/` with the frames and a small `character.json` (no description, no prompt). A taken name gets ` (2)`, ` (3)`...: a plain
   * `mkdir` fails on anything already there, a link included, so nothing is overwritten or followed, and the files are written `wx` into the new folder.
   */
  export(id: unknown, target: string): { ok: true; to: string } | StoreFailure {
    const got = this.frames(id);
    if (!got.ok) return got;
    const e = this.readEntry(id as string);
    if (!e) return UNKNOWN;
    const t = lstatOf(target);
    if (!path.isAbsolute(target) || !t || !t.isDirectory()) return { ok: false, error: 'That folder cannot be used.' };
    const slug = nameSlug(e.name);
    let dest = '';
    for (let n = 1; n <= MAX_SUFFIX && !dest; n++) {
      const candidate = path.join(target, n === 1 ? slug : `${slug} (${n})`);
      try {
        fs.mkdirSync(candidate);
        dest = candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return { ok: false, error: 'The character could not be exported to that folder.' };
      }
    }
    if (!dest) return { ok: false, error: 'That folder already holds too many exports of this character.' };
    try {
      for (const p of POSES) fs.writeFileSync(path.join(dest, FRAME_FILES[p]), got.frames[p], { flag: 'wx' });
      if (got.frames.blink) fs.writeFileSync(path.join(dest, BLINK_FILE), got.frames.blink, { flag: 'wx' });
      fs.writeFileSync(path.join(dest, JSON_FILE), JSON.stringify({ v: 1, name: e.name, created: e.created, madeWith: 'Codex', style: e.style, face: e.face, blink: e.blink }, null, 2), { flag: 'wx' });
      return { ok: true, to: dest };
    } catch {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* it was ours and new */ }
      return { ok: false, error: 'The character could not be exported to that folder.' };
    }
  }
}
