/**
 * The strict zip subset a world pack may use (spec 102 FR-051, FR-085; plan D5, R2). Pure: a Buffer in, a result out, no file or network access,
 * no dependency beyond Node's own `zlib`. Every pack is hostile: anything this reader does not expect is refused with a plain reason, and the
 * reasons never repeat text from the pack. It never throws on bad input (a thrown error is turned into a refusal).
 *
 * Order of work (limits first): input size, end record, entry count, central directory, names, the layout of the whole file (no gap, no
 * overlap, local headers agree with the directory), declared sizes and ratio, and only then inflate, under `maxOutputLength`, with a CRC-32
 * check. Entries that real tools add (folders, `.DS_Store`, `Thumbs.db`, `__MACOSX/._<name>`) are counted but never inflated.
 */
import { createHash } from 'crypto';
import * as zlib from 'zlib';

export const MAX_ZIP_BYTES = 64 * 1024 * 1024; // upload cap (FR-051); a download has its own, smaller, cap (FR-081)
export const MAX_RAW_ENTRIES = 96;
export const MAX_KEPT_ENTRIES = 40;
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
/** A deflated entry may not claim to grow by more than this factor (over 4 KB); stored packs need none. */
export const MAX_RATIO = 100;
export const MAX_NAME_BYTES = 64;
export const MAX_EXTRA_BYTES = 1024;

export interface ZipLimits { maxZipBytes?: number; maxRawEntries?: number; maxKeptEntries?: number; maxEntryBytes?: number; maxTotalBytes?: number }
export interface ZipEntry { name: string; data: Buffer }
export type ZipResult = { ok: true; entries: ZipEntry[]; ignored: number } | { ok: false; reason: string };
export interface ZipHeader { name: string; size: number }
export type ZipOpen = { ok: true; headers: ZipHeader[]; ignored: number; read(name: string): Buffer | null } | { ok: false; reason: string };

// ---- CRC-32 (own table: zlib.crc32 is missing from the oldest supported Node) ----
const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// ---- names ----
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SEGMENT_RE = /^[A-Za-z0-9._ -]{1,64}$/;
/**
 * Why one path segment is not acceptable on Windows, macOS and Linux alike, or '' when it is. ASCII only: that removes control and bidi
 * characters, NUL, lookalikes and Unicode normalisation variants in one step. No `:` (streams), no backslash, no `.` or `..`, no trailing dot
 * or space, no Windows device name (with or without an extension: `con.txt`).
 */
export function segmentProblem(seg: string): string {
  if (!SEGMENT_RE.test(seg)) return 'an entry name has a character or length that is not allowed';
  if (seg === '.' || seg === '..' || /[. ]$/.test(seg)) return 'an entry name ends in a dot or a space, or climbs a folder';
  if (RESERVED.test(seg.split('.')[0].trimEnd())) return 'an entry name is a reserved Windows device name';
  return '';
}

const IGNORED_FILES = ['.ds_store', 'thumbs.db']; // lower case, for folder names that must not look like them
interface Parsed { name: string; dir: boolean; method: number; flags: number; crc: number; csize: number; size: number; off: number; descriptor: boolean; made: number; attr: number; nameBytes: Buffer; extra: Buffer; ignore: boolean; keep: string }

const u16 = (b: Buffer, p: number): number => b.readUInt16LE(p);
const u32 = (b: Buffer, p: number): number => b.readUInt32LE(p);

/** Walks an extra field (id, size, data ...) and says whether it is well formed and free of ZIP64 (id 1). */
function extraProblem(extra: Buffer): string {
  let p = 0;
  while (p < extra.length) {
    if (p + 4 > extra.length) return 'an extra field is damaged';
    const id = u16(extra, p), len = u16(extra, p + 2);
    if (p + 4 + len > extra.length) return 'an extra field is damaged';
    if (id === 0x0001) return 'the zip uses ZIP64, which is not supported';
    p += 4 + len;
  }
  return '';
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Opens a zip for reading headers; file data is only produced by `read`, after every structural check has passed. */
export function openZip(buf: Buffer, limits: ZipLimits = {}): ZipOpen {
  try { return openZipInner(buf, limits); } catch { return fail('The zip file is damaged.'); }
}

function openZipInner(buf: Buffer, limits: ZipLimits): ZipOpen {
  const maxZip = limits.maxZipBytes ?? MAX_ZIP_BYTES, maxRaw = limits.maxRawEntries ?? MAX_RAW_ENTRIES, maxKept = limits.maxKeptEntries ?? MAX_KEPT_ENTRIES;
  const maxEntry = limits.maxEntryBytes ?? MAX_ENTRY_BYTES, maxTotal = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  if (!Buffer.isBuffer(buf)) return fail('Not a zip file.');
  if (buf.length > maxZip) return fail('The zip file is too big.');
  if (buf.length < 22) return fail('Not a zip file.');

  // End record: exactly the last 22 bytes. A comment, or any byte after it, is refused (a polyglot can hide in either).
  const eocd = buf.length - 22;
  if (u32(buf, eocd) !== 0x06054b50) return fail('Not a zip file, or it has extra bytes after its end.');
  if (eocd >= 20 && u32(buf, eocd - 20) === 0x07064b50) return fail('The zip uses ZIP64, which is not supported.');
  const disk = u16(buf, eocd + 4), cdDisk = u16(buf, eocd + 6), onDisk = u16(buf, eocd + 8), total = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12), cdOff = u32(buf, eocd + 16), comment = u16(buf, eocd + 20);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) return fail('The zip uses ZIP64, which is not supported.');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) return fail('A zip in several parts is not supported.');
  if (comment !== 0) return fail('The zip has a comment, which is not supported.');
  if (total === 0) return fail('The zip is empty.');
  if (total > maxRaw) return fail('The zip has too many entries.');
  if (cdOff + cdSize !== eocd) return fail('The zip has bytes between its files and its directory.');

  // Central directory
  const list: Parsed[] = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || u32(buf, p) !== 0x02014b50) return fail('The zip directory is damaged.');
    const made = u16(buf, p + 4), flags = u16(buf, p + 8), method = u16(buf, p + 10);
    const crc = u32(buf, p + 16), csize = u32(buf, p + 20), size = u32(buf, p + 24);
    const nl = u16(buf, p + 28), el = u16(buf, p + 30), cl = u16(buf, p + 32), dn = u16(buf, p + 34);
    const attr = u32(buf, p + 38), off = u32(buf, p + 42);
    if (p + 46 + nl + el + cl > eocd) return fail('The zip directory is damaged.');
    if (nl === 0 || nl > MAX_NAME_BYTES) return fail('An entry name is empty or too long.');
    if (el > MAX_EXTRA_BYTES) return fail('An entry has too much extra data.');
    const nameBytes = Buffer.from(buf.subarray(p + 46, p + 46 + nl));
    const extra = Buffer.from(buf.subarray(p + 46 + nl, p + 46 + nl + el));
    if (csize === 0xffffffff || size === 0xffffffff || off === 0xffffffff || dn === 0xffff) return fail('The zip uses ZIP64, which is not supported.');
    if (dn !== 0) return fail('A zip in several parts is not supported.');
    const ep = extraProblem(extra);
    if (ep) return fail(ep.includes('ZIP64') ? 'The zip uses ZIP64, which is not supported.' : 'The zip directory is damaged.');
    if (flags & 0x0001 || flags & 0x0040) return fail('An encrypted zip is not supported.');
    if (flags & ~(0x0002 | 0x0004 | 0x0008 | 0x0800)) return fail('An entry uses a zip feature that is not supported.');
    if (method !== 0 && method !== 8) return fail('An entry uses a compression method that is not supported.');
    // Not a regular file: a unix mode in the high half of the attributes (symlink, device, pipe, socket) or a DOS reparse-point bit.
    const mode = attr >>> 16, fmt = mode & 0o170000;
    if (fmt !== 0 && fmt !== 0o100000 && fmt !== 0o040000) return fail('The zip holds a link or another file that is not a plain file.');
    if ((made >> 8) === 0 && (attr & 0x400)) return fail('The zip holds a link or another file that is not a plain file.');
    let name = '';
    for (const b of nameBytes) { if (b < 0x20 || b > 0x7e) return fail('An entry name is not on the list of allowed names.'); name += String.fromCharCode(b); }
    list.push({ name, dir: name.endsWith('/'), method, flags, crc, csize, size, off, descriptor: (flags & 0x0008) !== 0, made, attr, nameBytes, extra, ignore: false, keep: '' });
    p += 46 + nl + el + cl;
  }
  if (p !== eocd) return fail('The zip directory is damaged.');

  // Names: classify each entry as kept, ignored (what real tools add) or refused; the rules of FR-051 on the whole name, nothing normalised.
  const seen = new Set<string>();
  let top = '';
  const files: Parsed[] = [];
  for (const e of list) {
    const lower = e.name.toLowerCase();
    if (seen.has(lower)) return fail('Two entries have the same name, or names that differ only in case.');
    seen.add(lower);
    if (e.name.startsWith('/') || /^[A-Za-z]:/.test(e.name)) return fail('An entry name is an absolute path.');
    if (e.name.includes('\\')) return fail('An entry name has a backslash.');
    const segs = (e.dir ? e.name.slice(0, -1) : e.name).split('/');
    for (const s of segs) { const why = segmentProblem(s); if (why) return fail(why.charAt(0).toUpperCase() + why.slice(1) + '.'); }
    if (e.dir) { if (e.size !== 0 || e.csize > 2 || (e.method !== 0 && e.method !== 8)) return fail('A folder entry holds data.'); e.ignore = true; }
    files.push(e);
  }
  // A single top-level folder is the one allowance (hand-made zips); every kept file is in it, or none is.
  const kept: Parsed[] = [];
  for (const e of files) {
    const segs = (e.dir ? e.name.slice(0, -1) : e.name).split('/');
    const mac = segs[0] === '__MACOSX';
    if (mac) {
      // __MACOSX/ (folder), __MACOSX/._name, __MACOSX/<top>/._name: nothing else, never opened.
      const leaf = segs[segs.length - 1];
      if (e.dir && segs.length <= 2) { e.ignore = true; continue; }
      if (!e.dir && /^\._[A-Za-z0-9._ -]{1,60}$/.test(leaf) && !segmentProblem(leaf.slice(2)) && segs.length >= 2 && segs.length <= 3) { e.ignore = true; continue; }
      return fail('An entry name is not on the list of allowed names.');
    }
    if (e.dir) {
      if (segs.length !== 1 || IGNORED_FILES.includes(segs[0].toLowerCase()) || segs[0].startsWith('.')) return fail('The zip has folders inside folders.');
      if (top && top !== segs[0]) return fail('The zip has more than one top-level folder.');
      top = segs[0];
      continue;
    }
    const leaf = segs[segs.length - 1];
    if ((leaf === '.DS_Store' || leaf === 'Thumbs.db') && segs.length <= 2) {
      if (segs.length === 2) { if (top && top !== segs[0]) return fail('The zip has more than one top-level folder.'); }
      e.ignore = true; continue;
    }
    if (segs.length === 1) { e.keep = leaf; kept.push(e); continue; }
    if (segs.length !== 2 || segs[0].startsWith('.') || IGNORED_FILES.includes(segs[0].toLowerCase())) return fail('The zip has folders inside folders.');
    if (top && top !== segs[0]) return fail('The zip has more than one top-level folder.');
    top = segs[0];
    e.keep = leaf; kept.push(e);
  }
  // all kept files at the root, or all inside the one folder (not a mix)
  if (kept.length && top) { const inFolder = kept.filter((e) => e.name.includes('/')).length; if (inFolder !== kept.length) return fail('The zip mixes files inside and outside its folder.'); }
  if (kept.length > maxKept) return fail('The zip has too many files.');

  // Layout: the files tile [0, cdOff) exactly, each local header agrees with the directory.
  const sorted = list.slice().sort((a, b) => a.off - b.off);
  let at = 0;
  let totalSize = 0;
  const dataAt = new Map<Parsed, number>();
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.off < at) return fail('Two entries overlap.');
    if (e.off > at) return fail('The zip has bytes before or between its files.');
    if (e.size > maxEntry || e.csize > maxEntry) return fail('A file in the zip is too big.');
    totalSize += e.size;
    if (totalSize > maxTotal) return fail('The files in the zip are too big together.');
    if (e.method === 0 && e.csize !== e.size) return fail('A stored entry has two different sizes.');
    if (e.method === 8 && e.size > 4096 && e.size / Math.max(1, e.csize) > MAX_RATIO) return fail('A file in the zip is packed far smaller than a picture can be.');
    if (e.method === 8 && e.size > 0 && e.csize === 0) return fail('A file in the zip is packed far smaller than a picture can be.');
    if (e.off + 30 > cdOff || u32(buf, e.off) !== 0x04034b50) return fail('A file header in the zip is damaged.');
    const lflags = u16(buf, e.off + 6), lmethod = u16(buf, e.off + 8), lcrc = u32(buf, e.off + 14), lcs = u32(buf, e.off + 18), lsz = u32(buf, e.off + 22);
    const lnl = u16(buf, e.off + 26), lel = u16(buf, e.off + 28);
    if (lnl !== e.nameBytes.length || lel > MAX_EXTRA_BYTES) return fail('A file header and the zip directory disagree.');
    const hdrEnd = e.off + 30 + lnl + lel;
    if (hdrEnd > cdOff) return fail('A file header in the zip is damaged.');
    if (!buf.subarray(e.off + 30, e.off + 30 + lnl).equals(e.nameBytes)) return fail('A file header and the zip directory disagree.');
    if (lflags !== e.flags || lmethod !== e.method) return fail('A file header and the zip directory disagree.');
    if (extraProblem(Buffer.from(buf.subarray(e.off + 30 + lnl, hdrEnd)))) return fail('The zip uses ZIP64, which is not supported, or a header is damaged.');
    if (!e.descriptor) {
      if (lcrc !== e.crc || lcs !== e.csize || lsz !== e.size) return fail('A file header and the zip directory disagree.');
    } else if ((lcrc !== 0 && lcrc !== e.crc) || (lcs !== 0 && lcs !== e.csize) || (lsz !== 0 && lsz !== e.size)) return fail('A file header and the zip directory disagree.');
    const dataEnd = hdrEnd + e.csize;
    if (dataEnd > cdOff) return fail('A file in the zip runs past its end.');
    dataAt.set(e, hdrEnd);
    let end = dataEnd;
    if (e.descriptor) {
      // with or without the optional signature; whichever length lands on the next entry (or the directory) is the one, and the values must agree
      const next = i + 1 < sorted.length ? sorted[i + 1].off : cdOff;
      const tryDesc = (len: number): boolean => {
        if (dataEnd + len > cdOff) return false;
        const sig = len === 16;
        if (sig && u32(buf, dataEnd) !== 0x08074b50) return false;
        const q = dataEnd + (sig ? 4 : 0);
        return dataEnd + len === next && u32(buf, q) === e.crc && u32(buf, q + 4) === e.csize && u32(buf, q + 8) === e.size;
      };
      if (tryDesc(16)) end = dataEnd + 16; else if (tryDesc(12)) end = dataEnd + 12; else return fail('A file and its trailing size record disagree.');
    }
    at = end;
  }
  if (at !== cdOff) return fail('The zip has bytes between its files and its directory.');

  const byKeep = new Map<string, Parsed>();
  for (const e of kept) byKeep.set(e.keep, e);
  return {
    ok: true,
    ignored: list.length - kept.length,
    headers: kept.map((e) => ({ name: e.keep, size: e.size })),
    read(name: string): Buffer | null {
      const e = byKeep.get(name);
      if (!e) return null;
      const s = dataAt.get(e);
      if (s === undefined) return null;
      try {
        const raw = buf.subarray(s, s + e.csize);
        let out: Buffer;
        if (e.method === 0) out = Buffer.from(raw);
        else {
          out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
        }
        if (out.length !== e.size) return null;
        if (crc32(out) !== e.crc) return null;
        return out;
      } catch { return null; }
    },
  };
}

/** Reads a whole zip: every kept entry's bytes (after every check), or the reason it was refused. */
export function readZip(buf: Buffer, limits: ZipLimits = {}): ZipResult {
  const z = openZip(buf, limits);
  if (!z.ok) return z;
  const entries: ZipEntry[] = [];
  for (const h of z.headers) {
    const data = z.read(h.name);
    if (!data) return fail('A file in the zip is damaged, or larger than it says.');
    entries.push({ name: h.name, data });
  }
  return { ok: true, entries, ignored: z.ignored };
}

// ---- stored-only writer (FR-085, FR-160) ----
const DOS_DATE = 0x0021; // 1980-01-01, a fixed stamp so the same files give the same bytes
const DOS_TIME = 0;
/** A stored zip of the given files in the given order: fixed stamps, no extra fields, ASCII names checked by the reader's own name rule. Throws on a bad name (a programmer error, never pack data). */
export function writeStoredZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  const seen = new Set<string>();
  for (const f of files) {
    if (segmentProblem(f.name) || f.name.includes('/') || seen.has(f.name.toLowerCase())) throw new Error('worldzip: bad entry name');
    seen.add(f.name.toLowerCase());
    const name = Buffer.from(f.name, 'latin1'), data = Buffer.from(f.data), crc = crc32(data);
    if (data.length > MAX_ENTRY_BYTES) throw new Error('worldzip: entry too big');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data); central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
