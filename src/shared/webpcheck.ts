/**
 * WebP files, read as bytes with no decoder (spec 096 FR-023, spec 077 FR-050). The chunk walker moved here from
 * `scripts/test-crew-assets.ts` (spec 021 FR-031: one walker for the shipped art test and for main's check of the encoder's output).
 * Every read is bounds-checked: a hostile or truncated file gives `null` or a problem sentence, never an exception or a long loop
 * (each chunk is at least 8 bytes, so the walk is linear in the file size).
 */

export const FRAME_SIZE = 352;
export const MAX_FRAME_BYTES = 40 * 1024;
export const MAX_CHARACTER_BYTES = 160 * 1024;
/** The only chunks a stored frame may hold (FR-023). */
export const ALLOWED_CHUNKS: readonly string[] = ['VP8X', 'VP8 ', 'VP8L', 'ALPH'];
/** Metadata chunks `stripChunks` removes. Any other chunk outside ALLOWED_CHUNKS is refused by `checkFrame`, not silently dropped. */
export const METADATA_CHUNKS: readonly string[] = ['EXIF', 'XMP ', 'ICCP'];

export interface WebpChunk { id: string; /** offset of the chunk header */ start: number; /** payload size as declared */ size: number; /** offset after the payload and its pad byte, clamped to the file */ end: number }
export interface WebpInfo {
  chunks: string[];
  list: WebpChunk[];
  width: number;
  height: number;
  alpha: boolean;
  /** the RIFF size or a chunk (with an odd chunk's pad byte) reaches past the end of the file */
  truncated: boolean;
  /** bytes after the end the RIFF header declares */
  trailing: number;
}

const ascii = (b: Uint8Array, p: number, n: number): string => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); return s; };
const u16 = (b: Uint8Array, p: number): number => b[p] | (b[p + 1] << 8);
const u24 = (b: Uint8Array, p: number): number => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
const u32 = (b: Uint8Array, p: number): number => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

/** The RIFF chunks of a WebP and the picture's size from its VP8X, VP8 or VP8L header; `null` when it is not a RIFF/WEBP file at all. */
export function webpInfo(buf: Uint8Array): WebpInfo | null {
  if (!buf || buf.length < 20 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WEBP') return null;
  const riffEnd = u32(buf, 4) + 8;
  const limit = Math.min(buf.length, riffEnd);
  const info: WebpInfo = { chunks: [], list: [], width: 0, height: 0, alpha: false, truncated: riffEnd > buf.length, trailing: Math.max(0, buf.length - riffEnd) };
  let p = 12;
  while (p + 8 <= limit) {
    const id = ascii(buf, p, 4), size = u32(buf, p + 4), d = p + 8;
    const padded = d + size + (size & 1);
    if (padded > limit) info.truncated = true; // an odd chunk's pad byte counts: RIFF always has it
    info.chunks.push(id);
    info.list.push({ id, start: p, size, end: Math.min(padded, limit) });
    if (d + size <= limit) {
      if (id === 'VP8X' && size >= 10) { info.width = 1 + u24(buf, d + 4); info.height = 1 + u24(buf, d + 7); if (buf[d] & 0x10) info.alpha = true; }
      else if (id === 'VP8 ' && !info.width && size >= 10) { info.width = u16(buf, d + 6) & 0x3fff; info.height = u16(buf, d + 8) & 0x3fff; }
      else if (id === 'VP8L' && !info.width && size >= 5) { const b = u32(buf, d + 1); info.width = (b & 0x3fff) + 1; info.height = ((b >> 14) & 0x3fff) + 1; if ((b >>> 28) & 1) info.alpha = true; }
      else if (id === 'ALPH') info.alpha = true;
    }
    p = padded;
  }
  if (p < limit && limit - p < 8 && !info.truncated) info.truncated = true; // a stray tail shorter than a chunk header
  return info;
}

/** Everything wrong with one stored frame, as sentences (empty = fine). FR-023: RIFF/WEBP, 352x352, alpha, at most 40 KB, allow-listed chunks. */
export function checkFrame(buf: Uint8Array): string[] {
  const info = webpInfo(buf);
  if (!info) return ['not a WebP file'];
  const out: string[] = [];
  if (buf.length > MAX_FRAME_BYTES) out.push(`${buf.length} bytes, over the ${MAX_FRAME_BYTES} cap`);
  if (info.truncated) out.push('truncated');
  if (info.trailing) out.push(`${info.trailing} bytes after the end of the RIFF data`);
  for (const c of info.chunks) if (!ALLOWED_CHUNKS.includes(c)) out.push(`metadata or unexpected chunk "${c}" (strip EXIF, XMP, ICC and text)`);
  if (!info.chunks.some((c) => c === 'VP8 ' || c === 'VP8L')) out.push('no picture data');
  if (info.width !== FRAME_SIZE || info.height !== FRAME_SIZE) out.push(`${info.width}x${info.height}, the art is ${FRAME_SIZE}x${FRAME_SIZE}`);
  if (!info.alpha) out.push('no alpha channel');
  return out;
}

/** The four frames of one character together (FR-023: at most 160 KB); each frame also passes `checkFrame`. */
export function checkFrames(frames: readonly Uint8Array[]): string[] {
  const out: string[] = [];
  let total = 0;
  frames.forEach((f, i) => { total += f.length; for (const p of checkFrame(f)) out.push(`frame ${i + 1}: ${p}`); });
  if (total > MAX_CHARACTER_BYTES) out.push(`frames total ${total} bytes, over the ${MAX_CHARACTER_BYTES} cap`);
  return out;
}

/** The file without its EXIF, XMP and ICC chunks (RIFF size and VP8X flags fixed up); `null` when it is not a usable WebP. Other chunks stay (checkFrame refuses them). */
export function stripChunks(buf: Uint8Array): Uint8Array | null {
  const info = webpInfo(buf);
  if (!info || info.truncated) return null;
  const keep = info.list.filter((c) => !METADATA_CHUNKS.includes(c.id));
  const parts: Uint8Array[] = [];
  let len = 12;
  for (const c of keep) { const part = new Uint8Array(buf.subarray(c.start, c.end)); /* a copy: a Buffer's `slice` shares memory and the flags below would change the caller's bytes */ if (c.id === 'VP8X' && part.length > 8) part[8] &= ~(0x20 | 0x08 | 0x04); parts.push(part); len += part.length; }
  const out = new Uint8Array(len);
  out.set(buf.subarray(0, 12), 0);
  let o = 12;
  for (const part of parts) { out.set(part, o); o += part.length; }
  const size = len - 8;
  out[4] = size & 255; out[5] = (size >> 8) & 255; out[6] = (size >> 16) & 255; out[7] = (size >>> 24) & 255;
  return out;
}
