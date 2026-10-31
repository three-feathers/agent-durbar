/**
 * Installed worlds on disk (spec 102 FR-060..FR-062, FR-083, T020, T021). No Electron, no network, no download exists in this phase.
 *
 *  - `<root>/<key>/` holds `world.json`, the parts and `installed.json`. A path is built in exactly one place (`dirOf`, `fileIn`) and only from a key that passes
 *    `KEY_RE` and a file name from the closed list (`PART_NAMES`, `world.json`, `installed.json`): no text from a zip entry, a manifest, `installed.json` or the window becomes a path.
 *  - A save reads nothing from the disk of the pack: it takes the validator's result through one small adapter (`fromValidated`), writes a temp dot folder with `wx` and 0600,
 *    checks what it wrote, then moves it in. Replacing is two renames (old to a dot folder, new into place, then delete the old), because Windows cannot rename over a folder.
 *  - Reads never follow a link: `lstat`, `O_NOFOLLOW | O_NONBLOCK`, `fstat` with the same inode, one link only (a hard link is refused), a size cap before the read and at most cap + 1 bytes read.
 *  - Every removal `lstat`s first and unlinks a link as a link; it never follows one out of the store.
 *  - A world is *Damaged* when `installed.json` is unreadable or when a file is not the regular file with the recorded size and sha256. The state is derived at read time, never trusted from the disk.
 * No error text here carries a path: the sentences are the store's own. Pack text (name) is kept in `installed.json` for the Manage list and goes nowhere else (FR-065).
 * `[KNOWN GAP]` a program that can write the profile folder can swap a folder between our `lstat` of it and the open of a file in it (O_NOFOLLOW covers the last part only); it can also rewrite
 * `installed.json` together with a part (out of scope, spec *Known gaps*). Writes are not `fsync`ed: a power cut can leave an empty file, which the hash check at load calls Damaged.
 */
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { THEME_ID_RE } from '../../shared/credits';
import { MANIFEST_BYTES, MANIFEST_NAME, MAX_PARTS, PACK_MAX_BYTES, PART_TABLE, partProblem, pictureHeader } from '../../shared/worldpack';
import type { PackResult, PartSpec } from '../../shared/worldpack';
import { openZip, sha256 } from '../../shared/worldzip';

export type Origin = 'project' | 'source' | 'uploaded' | 'made' | 'imported';
export type WorldState = 'ok' | 'unfinished' | 'damaged' | 'revoked';
export type FailCode = 'bad' | 'exists' | 'full' | 'failed' | 'unknown';
export type StoreFailure = { ok: false; code: FailCode; error: string };

/** The file system calls the store makes: a test hands in a wrapper that fails at a chosen step. */
export type FsLike = Pick<typeof fs, 'lstatSync' | 'openSync' | 'fstatSync' | 'readSync' | 'closeSync' | 'readdirSync' | 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync' | 'rmdirSync' | 'constants'>;

export const INSTALLED_NAME = 'installed.json';
export const MAX_INSTALLED_BYTES = 16 * 1024;
/** FR-061 (a hard limit, disk safety): all installed worlds together. Over it a save is refused. */
export const MAX_STORE_BYTES = 500 * 1024 * 1024;
/** FR-061 as changed on 2026-10-31 (owner principle: warn, do not limit a person's own use): 64 worlds is a warning on save and in the list, never a refusal. */
export const WARN_WORLD_COUNT = 64;
const MAX_SCAN = 512;

export const WORLD_ID_RE = THEME_ID_RE;
export const SOURCE_ID_RE = /^[a-z0-9]{1,16}$/;
const OWN_ID_RE = /^[0-9a-f]{16}$/;
/** FR-060, defined here: `p--<id>` (project), `s-<sourceId>--<id>` (other source; a source id has no `-`, so the split at the first `--` is unique), `u-<16 hex>` (own). Lower case only, no dot, no space. */
export const KEY_RE = /^(?:p--[a-z0-9][a-z0-9_-]{0,63}|s-[a-z0-9]{1,16}--[a-z0-9][a-z0-9_-]{0,63}|u-[0-9a-f]{16})$/;
const TMP_RE = /^\.tmp-[0-9a-f]{12}$/;
const OLD_RE = /^\.old-((?:p--[a-z0-9][a-z0-9_-]{0,63}|s-[a-z0-9]{1,16}--[a-z0-9][a-z0-9_-]{0,63}|u-[0-9a-f]{16}))$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const ORIGINS: readonly Origin[] = ['project', 'source', 'uploaded', 'made', 'imported'];
const BAD_NAME = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}<>`]/u;

const SPEC_OF: ReadonlyMap<string, PartSpec> = new Map(PART_TABLE.map((p) => [p.name, p]));
/** The only names a world folder may hold besides `installed.json`. */
const isStoredName = (n: string): boolean => n === MANIFEST_NAME || SPEC_OF.has(n);
const capOf = (n: string): number => (n === MANIFEST_NAME ? MANIFEST_BYTES : SPEC_OF.get(n)?.maxBytes ?? 0);

const MSG = {
  bad: 'That world could not be saved: it did not pass the final check.',
  exists: 'A world with that name is already installed.',
  full: 'There is not room: the installed worlds would pass 500 MB. Remove one in Manage first.',
  failed: 'The world could not be saved. Check that the disk has room and the profile folder can be written.',
  unknown: 'That world is not in the list.',
} as const;
const fail = (code: FailCode): StoreFailure => ({ ok: false, code, error: MSG[code] });

export interface FileRec { sha256: string; bytes: number }
export interface Installed {
  v: 1; key: string; origin: Origin; sourceId?: string; worldId?: string; name: string; version: number;
  state: 'ok' | 'unfinished'; packSha256?: string; date: string; size: number; files: Record<string, FileRec>;
}
export interface WorldEntry { key: string; name: string; origin: Origin | null; version: number; size: number; state: WorldState; unfinished: boolean; parts: string[]; date: string }
/** What the validator's result and the pack's own bytes come to, with the key's pieces chosen by main (never by the pack). */
export interface StoreInput {
  origin: Origin;
  /** `source` only: main's id for the source. */
  sourceId?: string;
  /** `project` and `source`: the world id; it must be the pack's own id. */
  worldId?: string;
  name: string;
  version: number;
  unfinished: boolean;
  packSha256?: string;
  /** `world.json` and parts, by closed-list name. */
  files: ReadonlyArray<{ name: string; data: Uint8Array }>;
}
export type SaveResult = { ok: true; key: string; warnings: Array<'count'> } | StoreFailure;
export type PartResult = { ok: true; bytes: Buffer; mime: 'image/webp' | 'image/png' } | { ok: false; reason: 'unknown' | 'damaged' | 'revoked' };

const hex = (n: number): string => randomBytes(n).toString('hex');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** The one adapter to the validator (#955 may still change its signature): its result plus the zip's bytes become a `StoreInput`. Anything off is null. Only names from the closed list are read from the zip. */
export function fromValidated(zip: Buffer, result: PackResult, ctx: { origin: Origin; sourceId?: string; worldId?: string; packSha256?: string }): StoreInput | null {
  try {
    if (!result || result.ok !== true || !result.manifest) return null;
    const m = result.manifest;
    if (ctx.worldId !== undefined && ctx.worldId !== m.id) return null;
    const z = openZip(zip);
    if (!z.ok) return null;
    const names = [MANIFEST_NAME, ...result.parts];
    if (new Set(names).size !== names.length || names.some((n) => !isStoredName(n))) return null;
    const files: Array<{ name: string; data: Uint8Array }> = [];
    for (const n of names) {
      const data = z.read(n);
      if (!data) return null;
      files.push({ name: n, data });
    }
    return { origin: ctx.origin, sourceId: ctx.sourceId, worldId: ctx.origin === 'project' || ctx.origin === 'source' ? m.id : undefined, name: m.name, version: m.version, unfinished: result.unfinished.length > 0, packSha256: ctx.packSha256, files };
  } catch {
    return null;
  }
}

export class WorldStore {
  private readonly damaged = new Set<string>();
  private revoked: ReadonlySet<string> = new Set();
  /** `fsx`, `newId`, `now` and `maxBytes` (only ever lowered) are for tests. */
  constructor(
    private readonly root: string,
    private readonly fsx: FsLike = fs,
    private readonly newId: () => string = () => hex(8),
    private readonly now: () => Date = () => new Date(),
    private readonly maxBytes: number = MAX_STORE_BYTES,
  ) {}

  // ---- paths: the only place a path is made ----
  private dirOf(key: unknown): string | null {
    return typeof key === 'string' && KEY_RE.test(key) ? path.join(this.root, key) : null;
  }
  private fileIn(dir: string, name: string): string | null {
    return name === INSTALLED_NAME || isStoredName(name) ? path.join(dir, name) : null;
  }
  private oldOf(key: string): string {
    return path.join(this.root, '.old-' + key);
  }

  private lstatOf(p: string): fs.Stats | null { try { return this.fsx.lstatSync(p); } catch { return null; } }

  /** A regular file, never a link, with one link only, up to `cap` bytes. Checked by `lstat` before and `fstat` after the open; at most cap + 1 bytes are asked for. */
  private readRegular(file: string, cap: number): Buffer | null {
    const st = this.lstatOf(file);
    if (!st || !st.isFile() || st.size > cap || st.nlink > 1) return null;
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = this.fsx.constants;
    let fd: number | undefined;
    try {
      fd = this.fsx.openSync(file, O_RDONLY | (O_NOFOLLOW ?? 0) | (O_NONBLOCK ?? 0));
      const now = this.fsx.fstatSync(fd);
      if (!now.isFile() || now.size > cap || now.ino !== st.ino || now.nlink > 1) return null;
      const buf = Buffer.alloc(Math.min(now.size, cap) + 1);
      let got = 0;
      while (got < buf.length) {
        const n = this.fsx.readSync(fd, buf, got, buf.length - got, got);
        if (n <= 0) break;
        got += n;
      }
      return got === now.size && got <= cap ? buf.subarray(0, got) : null; // grown or shrunk while open: refused
    } catch {
      return null;
    } finally {
      if (fd !== undefined) try { this.fsx.closeSync(fd); } catch { /* closed */ }
    }
  }

  /** The root as a real folder: a link in its place is not used. */
  private rootOk(): boolean {
    const st = this.lstatOf(this.root);
    return !!st && st.isDirectory();
  }

  // ---- installed.json ----
  private parseInstalled(raw: Buffer, key: string): Installed | null {
    let doc: unknown;
    try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return null; }
    if (!isObj(doc)) return null;
    const allowed = new Set(['v', 'key', 'origin', 'sourceId', 'worldId', 'name', 'version', 'state', 'packSha256', 'date', 'size', 'files']);
    for (const k of Object.keys(doc)) if (!allowed.has(k)) return null;
    if (own(doc, 'v') !== 1 || own(doc, 'key') !== key) return null;
    const origin = own(doc, 'origin');
    if (typeof origin !== 'string' || !(ORIGINS as readonly string[]).includes(origin)) return null;
    const sourceId = own(doc, 'sourceId'), worldId = own(doc, 'worldId');
    const expect = origin === 'project' ? `p--${String(worldId)}` : origin === 'source' ? `s-${String(sourceId)}--${String(worldId)}` : null;
    if (expect !== null ? expect !== key : !key.startsWith('u-')) return null;
    if (sourceId !== undefined && (typeof sourceId !== 'string' || !SOURCE_ID_RE.test(sourceId))) return null;
    if (worldId !== undefined && (typeof worldId !== 'string' || !WORLD_ID_RE.test(worldId))) return null;
    if ((origin === 'source') !== (sourceId !== undefined) || (origin === 'project' || origin === 'source') !== (worldId !== undefined)) return null;
    const name = own(doc, 'name'), version = own(doc, 'version'), state = own(doc, 'state'), date = own(doc, 'date'), size = own(doc, 'size'), pack = own(doc, 'packSha256');
    if (typeof name !== 'string' || !name || Array.from(name).length > 40 || BAD_NAME.test(name)) return null;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 999999999) return null;
    if (state !== 'ok' && state !== 'unfinished') return null;
    if (typeof date !== 'string' || date.length > 40 || !Number.isFinite(Date.parse(date))) return null;
    if (pack !== undefined && (typeof pack !== 'string' || !SHA_RE.test(pack))) return null;
    const rf = own(doc, 'files');
    if (!isObj(rf)) return null;
    const files: Record<string, FileRec> = Object.create(null);
    let sum = 0;
    const names = Object.keys(rf);
    if (names.length > MAX_PARTS + 1 || !names.includes(MANIFEST_NAME)) return null;
    for (const n of names) {
      const e = rf[n];
      if (!isStoredName(n) || !isObj(e) || Object.keys(e).sort().join() !== 'bytes,sha256') return null;
      const h = own(e, 'sha256'), b = own(e, 'bytes');
      if (typeof h !== 'string' || !SHA_RE.test(h) || typeof b !== 'number' || !Number.isInteger(b) || b < 1 || b > capOf(n)) return null;
      files[n] = { sha256: h, bytes: b };
      sum += b;
    }
    if (size !== sum || sum > PACK_MAX_BYTES) return null;
    const rec: Installed = { v: 1, key, origin: origin as Origin, name, version, state, date, size: sum, files };
    if (sourceId !== undefined) rec.sourceId = sourceId as string;
    if (worldId !== undefined) rec.worldId = worldId as string;
    if (pack !== undefined) rec.packSha256 = pack as string;
    return rec;
  }

  /** The record of a folder: a real folder (not a link) holding a readable, consistent `installed.json`. */
  private readInstalled(dir: string, key: string): Installed | null {
    const st = this.lstatOf(dir);
    if (!st || !st.isDirectory()) return null;
    const f = this.fileIn(dir, INSTALLED_NAME);
    const raw = f ? this.readRegular(f, MAX_INSTALLED_BYTES) : null;
    return raw ? this.parseInstalled(raw, key) : null;
  }

  /** Every recorded file is the regular file with the recorded size (no hashing): the cheap state check of the list. */
  private sizesOk(dir: string, rec: Installed): boolean {
    for (const [n, r] of Object.entries(rec.files)) {
      const f = this.fileIn(dir, n);
      const st = f ? this.lstatOf(f) : null;
      if (!st || !st.isFile() || st.nlink > 1 || st.size !== r.bytes) return false;
    }
    return true;
  }

  /** The full check: the record, every file read and hashed, and nothing else in the folder. Null when anything is off. */
  private checkDir(dir: string, key: string): Installed | null {
    const rec = this.readInstalled(dir, key);
    if (!rec) return null;
    let listed: string[];
    try { listed = this.fsx.readdirSync(dir); } catch { return null; }
    if (listed.length !== Object.keys(rec.files).length + 1 || listed.some((n) => n !== INSTALLED_NAME && !(n in rec.files))) return null;
    for (const [n, r] of Object.entries(rec.files)) {
      const f = this.fileIn(dir, n);
      const buf = f ? this.readRegular(f, r.bytes) : null;
      if (!buf || buf.length !== r.bytes || sha256(buf) !== r.sha256) return null;
    }
    return rec;
  }

  // ---- reading ----
  private keysOnDisk(): string[] {
    if (!this.rootOk()) return [];
    let names: fs.Dirent[];
    try { names = this.fsx.readdirSync(this.root, { withFileTypes: true }); } catch { return []; }
    return names.map((d) => d.name).filter((n) => KEY_RE.test(n)).sort().slice(0, MAX_SCAN);
  }

  private isRevoked(rec: Installed): boolean {
    if (!this.revoked.size) return false;
    return (rec.packSha256 !== undefined && this.revoked.has(rec.packSha256)) || Object.values(rec.files).some((f) => this.revoked.has(f.sha256));
  }

  /** FR-083: the hashes the catalogue revoked (pack hashes, and any stored file's hash). A listed world with one is *Revoked*: not served; `sweepRevoked` removes it. */
  setRevoked(hashes: Iterable<string>): void {
    this.revoked = new Set([...hashes].filter((h) => typeof h === 'string' && SHA_RE.test(h)));
  }

  /** Every world folder named like a key, with its state. A folder that is a link, or whose record is unreadable, is listed as damaged (with no name) so it can be removed. */
  list(): WorldEntry[] {
    const out: WorldEntry[] = [];
    for (const key of this.keysOnDisk()) {
      const dir = this.dirOf(key) as string;
      const rec = this.readInstalled(dir, key);
      if (!rec) { out.push({ key, name: '', origin: null, version: 0, size: 0, state: 'damaged', unfinished: false, parts: [], date: '' }); continue; }
      let state: WorldState = rec.state;
      if (this.isRevoked(rec)) state = 'revoked';
      else if (this.damaged.has(key) || !this.sizesOk(dir, rec)) state = 'damaged';
      out.push({ key, name: rec.name, origin: rec.origin, version: rec.version, size: rec.size, state, unfinished: rec.state === 'unfinished', parts: Object.keys(rec.files).filter((n) => n !== MANIFEST_NAME).sort(), date: rec.date });
    }
    return out;
  }

  /** The keys main lists now (a damaged one included, so it can be removed). */
  keys(): string[] {
    return this.keysOnDisk();
  }

  /**
   * FR-062: the bytes of one part, after the re-check: key and name from their lists, a real folder, a consistent record, not revoked, the regular file, one link, within the cap,
   * the recorded size and sha256, and a PNG or WebP picture. Any failure marks the world damaged and returns no bytes.
   */
  part(key: unknown, name: unknown): PartResult {
    const dir = this.dirOf(key);
    if (!dir || typeof name !== 'string' || !SPEC_OF.has(name)) return { ok: false, reason: 'unknown' };
    const k = key as string;
    const rec = this.readInstalled(dir, k);
    if (!rec) { if (this.lstatOf(dir)) this.damaged.add(k); return { ok: false, reason: this.lstatOf(dir) ? 'damaged' : 'unknown' }; }
    if (this.isRevoked(rec)) return { ok: false, reason: 'revoked' };
    const r = rec.files[name];
    if (!r) return { ok: false, reason: 'unknown' };
    const f = this.fileIn(dir, name);
    const buf = f ? this.readRegular(f, r.bytes) : null;
    const pic = buf ? pictureHeader(buf) : null;
    if (!buf || buf.length !== r.bytes || sha256(buf) !== r.sha256 || !pic || typeof pic === 'string') { this.damaged.add(k); return { ok: false, reason: 'damaged' }; }
    return { ok: true, bytes: Buffer.from(buf), mime: pic.kind === 'png' ? 'image/png' : 'image/webp' };
  }

  /** The full check of one world (every file read and hashed). Marks it damaged, or clears the mark. */
  verify(key: unknown): boolean {
    const dir = this.dirOf(key);
    if (!dir) return false;
    const k = key as string;
    const rec = this.checkDir(dir, k);
    if (!rec || this.isRevoked(rec)) { if (this.lstatOf(dir)) this.damaged.add(k); return false; }
    this.damaged.delete(k);
    return true;
  }

  // ---- writing ----
  private prepare(input: StoreInput): { files: Array<{ name: string; data: Buffer }>; size: number } | null {
    if (!input || !(ORIGINS as readonly string[]).includes(input.origin)) return null;
    if (input.origin === 'source' ? typeof input.sourceId !== 'string' || !SOURCE_ID_RE.test(input.sourceId) : input.sourceId !== undefined) return null;
    const needsId = input.origin === 'project' || input.origin === 'source';
    if (needsId ? typeof input.worldId !== 'string' || !WORLD_ID_RE.test(input.worldId) : input.worldId !== undefined) return null;
    if (typeof input.name !== 'string' || !input.name || Array.from(input.name).length > 40 || BAD_NAME.test(input.name)) return null;
    if (!Number.isInteger(input.version) || input.version < 0 || input.version > 999999999 || typeof input.unfinished !== 'boolean') return null;
    if (input.packSha256 !== undefined && (typeof input.packSha256 !== 'string' || !SHA_RE.test(input.packSha256))) return null;
    if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > MAX_PARTS + 1) return null;
    const seen = new Set<string>();
    const files: Array<{ name: string; data: Buffer }> = [];
    let size = 0;
    for (const f of input.files) {
      if (!f || typeof f.name !== 'string' || !isStoredName(f.name) || seen.has(f.name) || !(f.data instanceof Uint8Array)) return null;
      seen.add(f.name);
      if (f.data.length < 1 || f.data.length > capOf(f.name)) return null;
      const data = Buffer.from(f.data); // a copy: the bytes hashed are the bytes written, whatever the caller does to its own buffer afterwards
      const spec = SPEC_OF.get(f.name);
      if (spec && partProblem(spec, data)) return null;
      size += data.length;
      files.push({ name: f.name, data });
    }
    if (!seen.has(MANIFEST_NAME) || size > PACK_MAX_BYTES) return null;
    return { files, size };
  }

  private rmTree(p: string, depth = 0): void {
    const st = this.lstatOf(p);
    if (!st) return;
    if (!st.isDirectory()) {
      try { this.fsx.unlinkSync(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; this.fsx.rmdirSync(p); } // a directory link on Windows is removed as a link
      return;
    }
    if (depth > 3) throw new Error('too deep');
    for (const d of this.fsx.readdirSync(p, { withFileTypes: true })) this.rmTree(path.join(p, d.name), depth + 1);
    this.fsx.rmdirSync(p);
  }

  /** Total bytes of the worlds with a readable record, leaving out one key (the one being replaced). */
  private bytesExcept(key: string): { bytes: number; count: number } {
    let bytes = 0, count = 0;
    for (const k of this.keysOnDisk()) {
      count++;
      if (k === key) continue;
      const rec = this.readInstalled(this.dirOf(k) as string, k);
      if (rec) bytes += rec.size;
    }
    return { bytes, count };
  }

  /**
   * FR-060: writes the pack to a temp dot folder, checks what is on disk, then moves it in. `replace` makes it a new version of the same key (old to a dot folder, new into place, delete the old);
   * without it a folder already there is never touched and the save is refused. A failure leaves the old world as it was or, after a crash, for `repair` to settle.
   */
  save(input: StoreInput, opts: { replace?: boolean } = {}): SaveResult {
    const prep = this.prepare(input);
    if (!prep) return fail('bad');
    const key = input.origin === 'project' ? `p--${input.worldId}` : input.origin === 'source' ? `s-${input.sourceId}--${input.worldId}` : `u-${this.newId()}`;
    const dest = this.dirOf(key);
    if (!dest || (input.origin !== 'project' && input.origin !== 'source' && !OWN_ID_RE.test(key.slice(2)))) return fail('bad');
    const tmp = path.join(this.root, '.tmp-' + hex(6));
    let tmpMade = false;
    try {
      this.fsx.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      if (!this.rootOk()) return fail('failed');
      this.repair();
      const existing = this.lstatOf(dest);
      if (existing && !opts.replace) return fail('exists');
      if (this.lstatOf(this.oldOf(key))) return fail('failed'); // a leftover repair could not settle: a person removes the world first
      const { bytes, count } = this.bytesExcept(key);
      if (bytes + prep.size > this.maxBytes) return fail('full');
      const files: Record<string, FileRec> = {};
      this.fsx.mkdirSync(tmp, { mode: 0o700 });
      tmpMade = true;
      for (const f of prep.files) {
        const p = this.fileIn(tmp, f.name) as string;
        files[f.name] = { sha256: sha256(f.data), bytes: f.data.length }; // the hash of the very buffer written below
        this.fsx.writeFileSync(p, f.data, { flag: 'wx', mode: 0o600 });
      }
      const rec: Installed = { v: 1, key, origin: input.origin, name: input.name, version: input.version, state: input.unfinished ? 'unfinished' : 'ok', date: this.now().toISOString(), size: prep.size, files };
      if (input.origin === 'source') rec.sourceId = input.sourceId;
      if (needsWorld(input.origin)) rec.worldId = input.worldId;
      if (input.packSha256) rec.packSha256 = input.packSha256;
      const body = JSON.stringify({ v: rec.v, key: rec.key, origin: rec.origin, sourceId: rec.sourceId, worldId: rec.worldId, name: rec.name, version: rec.version, state: rec.state, packSha256: rec.packSha256, date: rec.date, size: rec.size, files: rec.files }, null, 2);
      this.fsx.writeFileSync(this.fileIn(tmp, INSTALLED_NAME) as string, body, { flag: 'wx', mode: 0o600 });
      if (!this.checkDir(tmp, key)) throw new Error('written folder did not check out');
      if (existing) {
        const old = this.oldOf(key);
        this.fsx.renameSync(dest, old);
        try {
          this.fsx.renameSync(tmp, dest);
        } catch (e) {
          try { this.fsx.renameSync(old, dest); } catch { /* repair at the next start keeps the complete one */ }
          throw e;
        }
        tmpMade = false;
        try { this.rmTree(old); } catch { /* swept at the next start */ }
      } else {
        this.fsx.renameSync(tmp, dest);
        tmpMade = false;
      }
      this.damaged.delete(key);
      return { ok: true, key, warnings: count + (existing ? 0 : 1) > WARN_WORLD_COUNT ? ['count'] : [] };
    } catch {
      if (tmpMade) try { this.rmTree(tmp); } catch { /* the sweep gets it */ }
      return fail('failed');
    }
  }

  /** Removes one world: its folder (a link in its place is removed as a link, its target untouched) and a leftover `.old-` of the same key. */
  remove(key: unknown): { ok: true } | StoreFailure {
    const dir = this.dirOf(key);
    if (!dir) return fail('unknown');
    const k = key as string;
    if (!this.lstatOf(dir) && !this.lstatOf(this.oldOf(k))) return fail('unknown');
    try {
      this.rmTree(dir);
      this.rmTree(this.oldOf(k));
      this.damaged.delete(k);
      return { ok: true };
    } catch {
      return fail('failed');
    }
  }

  /** FR-083: removes every world the catalogue revoked. Returns the keys removed (no names: pack text stays out of the answer). */
  sweepRevoked(): string[] {
    const gone: string[] = [];
    for (const k of this.keysOnDisk()) {
      const rec = this.readInstalled(this.dirOf(k) as string, k);
      if (rec && this.isRevoked(rec) && this.remove(k).ok) gone.push(k);
    }
    return gone;
  }

  /**
   * FR-060 at start: settles what a crash left. A `.old-<key>` beside a complete `<key>` is deleted; beside a missing or broken one it is moved back if it is complete. Neither complete: both are left
   * for a person to remove, nothing is deleted on a guess. Then every `.tmp-` folder is removed. Every removal `lstat`s first and never follows a link.
   */
  repair(): void {
    if (!this.rootOk()) return;
    let names: fs.Dirent[];
    try { names = this.fsx.readdirSync(this.root, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const m = OLD_RE.exec(d.name);
      if (!m) continue;
      const key = m[1], old = path.join(this.root, d.name), dest = this.dirOf(key) as string;
      try {
        if (this.lstatOf(dest) && this.checkDir(dest, key)) this.rmTree(old);
        else if (this.checkDir(old, key)) {
          if (this.lstatOf(dest)) this.rmTree(dest);
          this.fsx.renameSync(old, dest);
        }
      } catch { /* left for the next start */ }
    }
    for (const d of names) {
      if (!TMP_RE.test(d.name)) continue;
      try { this.rmTree(path.join(this.root, d.name)); } catch { /* left for the next start */ }
    }
  }
}

const needsWorld = (o: Origin): boolean => o === 'project' || o === 'source';
