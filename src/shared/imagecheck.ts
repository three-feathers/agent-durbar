/**
 * The first look at a picture an image tool wrote (spec 096 FR-020, FR-021): magic bytes and the dimensions the header declares,
 * read before any decoder sees the file. Pure functions on bytes, no decoder, no I/O (main does the `lstat` and the read).
 * What it does NOT prove: the pixels are valid or the file has nothing appended (a PNG+ZIP polyglot passes this check). Decoding
 * happens only in the sandboxed encoder window, which re-encodes to a fresh WebP, so appended bytes never reach the store.
 */
import { webpInfo } from './webpcheck';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MIN_SIDE = 512;
export const MAX_SIDE = 4096;

export type ImageKind = 'png' | 'webp';
export type ImageCheck = { ok: true; kind: ImageKind; width: number; height: number } | { ok: false; reason: string };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (b: Uint8Array, p: number): number => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const tag = (b: Uint8Array, p: number): string => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/** Walks the PNG chunks (bounded: each is at least 12 bytes) and says whether an IEND chunk is reached inside the file. */
function pngComplete(b: Uint8Array): boolean {
  let p = 8;
  while (p + 12 <= b.length) {
    const len = be32(b, p);
    if (len > 0x7fffffff) return false;
    const t = tag(b, p + 4);
    const next = p + 12 + len;
    if (next > b.length) return false;
    if (t === 'IEND') return true;
    p = next;
  }
  return false;
}

export function checkImage(buf: Uint8Array): ImageCheck {
  if (!buf || typeof buf.length !== 'number') return { ok: false, reason: 'Not a picture.' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'The picture is too big.' };
  let kind: ImageKind, width = 0, height = 0;
  if (buf.length >= 8 && PNG_MAGIC.every((v, i) => buf[i] === v)) {
    kind = 'png';
    if (buf.length < 33 || be32(buf, 8) !== 13 || tag(buf, 12) !== 'IHDR') return { ok: false, reason: 'The picture header is damaged.' };
    width = be32(buf, 16); height = be32(buf, 20);
    if (!pngComplete(buf)) return { ok: false, reason: 'The picture is cut short.' };
  } else if (buf.length >= 12 && tag(buf, 0) === 'RIFF' && tag(buf, 8) === 'WEBP') {
    kind = 'webp';
    const info = webpInfo(buf);
    if (info && info.truncated) return { ok: false, reason: 'The picture is cut short.' };
    if (!info || !info.width || !info.height) return { ok: false, reason: 'The picture header is damaged.' };
    width = info.width; height = info.height;
  } else {
    return { ok: false, reason: 'Not a PNG or WebP picture.' };
  }
  if (width < MIN_SIDE || height < MIN_SIDE) return { ok: false, reason: 'The picture is too small.' };
  if (width > MAX_SIDE || height > MAX_SIDE) return { ok: false, reason: 'The picture is too large.' };
  return { ok: true, kind, width, height };
}
