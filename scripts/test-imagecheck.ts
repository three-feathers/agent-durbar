/** Image header checks and WebP frame checks for the AI character maker (spec 096 FR-020, FR-021, FR-023). Plain Node, no decoder, no credits. `npm run test:imagecheck`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { checkImage, MAX_IMAGE_BYTES } from '../src/shared/imagecheck';
import { webpInfo, checkFrame, checkFrames, stripChunks, MAX_FRAME_BYTES, MAX_CHARACTER_BYTES } from '../src/shared/webpcheck';

const be32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const le32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function pngChunk(type: string, data: Buffer): Buffer { return Buffer.concat([be32(data.length), Buffer.from(type, 'latin1'), data, be32(0)]); } // CRC is not checked here (no decoder)
function png(w: number, h: number, opts: { iend?: boolean; extra?: Buffer } = {}): Buffer {
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', Buffer.alloc(40, 1)), ...(opts.iend === false ? [] : [pngChunk('IEND', Buffer.alloc(0))]), ...(opts.extra ? [opts.extra] : [])]);
}
function chunk(id: string, data: Buffer): Buffer { return Buffer.concat([Buffer.from(id, 'latin1'), le32(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); }
function riff(chunks: Buffer[]): Buffer { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]); return Buffer.concat([Buffer.from('RIFF'), le32(body.length), body]); }
function vp8x(w: number, h: number, flags: number): Buffer { const d = Buffer.alloc(10); d[0] = flags; d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3); return chunk('VP8X', d); }
function vp8l(w: number, h: number, alpha: boolean): Buffer { const d = Buffer.alloc(24, 7); d[0] = 0x2f; d.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28), 1); return chunk('VP8L', d); }
function vp8(w: number, h: number): Buffer { const d = Buffer.alloc(30, 3); d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(w, 6); d.writeUInt16LE(h, 8); return chunk('VP8 ', d); }
const meta = (id: string): Buffer => chunk(id, Buffer.from('some metadata!'));

// ---- imagecheck: good files (FR-021) ----
assert.deepStrictEqual(checkImage(png(1024, 1024)), { ok: true, kind: 'png', width: 1024, height: 1024 });
assert.deepStrictEqual(checkImage(png(512, 4096)), { ok: true, kind: 'png', width: 512, height: 4096 }, 'edges of the range');
assert.deepStrictEqual(checkImage(riff([vp8l(1024, 1024, true)])), { ok: true, kind: 'webp', width: 1024, height: 1024 });
assert.deepStrictEqual(checkImage(riff([vp8(1024, 768)])), { ok: true, kind: 'webp', width: 1024, height: 768 }, 'lossy VP8');
assert.deepStrictEqual(checkImage(riff([vp8x(2048, 1024, 0x10), vp8(2048, 1024)])), { ok: true, kind: 'webp', width: 2048, height: 1024 }, 'VP8X');
// ---- bad files ----
const bad = (b: Uint8Array, re: RegExp, why: string): void => { const r = checkImage(b); assert.ok(!r.ok && re.test(r.reason), why + ' -> ' + JSON.stringify(r)); };
bad(Buffer.alloc(0), /Not a PNG/, 'empty');
bad(Buffer.from('not a picture, just some text named sheet.png'.repeat(5)), /Not a PNG/, 'text named .png');
bad(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60)]), /Not a PNG/, 'half a PNG magic');
bad(Buffer.from('GIF89a' + 'x'.repeat(100)), /Not a PNG/, 'GIF');
bad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]), /Not a PNG/, 'JPEG');
bad(png(300, 1024), /too small/, 'width under 512');
bad(png(1024, 100), /too small/, 'height under 512');
bad(png(4097, 1024), /too large/, 'width over 4096');
bad(png(0x7fffffff, 0x7fffffff), /too large/, 'huge IHDR');
bad(png(0xffffffff, 1024), /too large/, 'IHDR width 2^32-1 is read unsigned');
bad(riff([vp8l(16384, 16384, true)]), /too large/, 'huge VP8L');
bad(riff([vp8x(100000, 100000, 0)]), /too large/, 'huge VP8X');
bad(riff([vp8l(100, 100, true)]), /too small/, 'small WebP');
bad(png(1024, 1024).subarray(0, 20), /damaged/, 'PNG cut inside IHDR');
bad(png(1024, 1024).subarray(0, png(1024, 1024).length - 20), /cut short/, 'PNG without its end');
bad(png(1024, 1024, { iend: false }), /cut short/, 'PNG with no IEND');
{ const t = riff([vp8l(1024, 1024, true)]); bad(t.subarray(0, t.length - 10), /cut short/, 'truncated WebP'); }
bad(riff([chunk('JUNK', Buffer.alloc(4))]), /damaged/, 'WebP with no picture header');
bad(Buffer.concat([Buffer.from('RIFF'), le32(4), Buffer.from('WAVE')]), /Not a PNG/, 'RIFF but not WEBP');
{ // a PNG whose IHDR length is wrong
  const b = png(1024, 1024); b.writeUInt32BE(12, 8); bad(b, /damaged/, 'IHDR length 12');
  const c = png(1024, 1024); c.write('IDAT', 12, 'latin1'); bad(c, /damaged/, 'first chunk not IHDR');
}
{ // a chunk length that points far past the end must not loop or throw
  const b = png(1024, 1024); const at = 8 + 25; b.writeUInt32BE(0xfffffff0, at); bad(b, /cut short/, 'chunk length past the end');
}
{ // the size cap
  const big = Buffer.concat([png(1024, 1024), Buffer.alloc(MAX_IMAGE_BYTES)]);
  bad(big, /too big/, 'over 20 MB');
}
// a polyglot PNG + ZIP: the header is a good PNG so the header check passes, by design (the sandboxed re-encode drops the rest); the cap still applies
{
  const zip = Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(200, 0x41)]);
  assert.strictEqual(checkImage(png(1024, 1024, { extra: zip })).ok, true, 'polyglot passes the header check');
  bad(png(1024, 1024, { extra: Buffer.alloc(MAX_IMAGE_BYTES) }), /too big/, 'polyglot over the cap');
}
// ---- hostile and random bytes never throw ----
{
  let seed = 12345; const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const seeds = [png(1024, 1024), riff([vp8x(1024, 1024, 0x10), vp8l(1024, 1024, true)])];
  for (let i = 0; i < 3000; i++) {
    const b = Buffer.from(seeds[i % 2]);
    for (let k = 0; k < 4; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    const cut = rnd() < 0.3 ? b.subarray(0, Math.floor(rnd() * b.length)) : b;
    const r = checkImage(cut); checkFrame(cut); stripChunks(cut);
    assert.ok(typeof r.ok === 'boolean');
  }
}

// ---- webpcheck: frames (FR-023) ----
const goodFrame = riff([vp8x(352, 352, 0x10), vp8l(352, 352, true)]);
assert.deepStrictEqual(checkFrame(goodFrame), [], 'a good frame');
assert.deepStrictEqual(checkFrame(riff([vp8l(352, 352, true)])), [], 'a lossless frame with the alpha bit');
assert.deepStrictEqual(checkFrame(riff([vp8x(352, 352, 0x10), vp8(352, 352), chunk('ALPH', Buffer.alloc(8))])), [], 'lossy VP8 with an ALPH chunk');
const has = (ps: string[], re: RegExp): boolean => ps.some((p) => re.test(p));
assert.ok(has(checkFrame(Buffer.from('plain text, not a picture at all')), /not a WebP/), 'text');
assert.ok(has(checkFrame(riff([vp8l(351, 352, true)])), /351x352/), 'wrong width');
assert.ok(has(checkFrame(riff([vp8l(352, 400, true)])), /352x400/), 'wrong height');
assert.ok(has(checkFrame(riff([vp8l(352, 352, false)])), /no alpha/), 'no alpha (VP8L bit off)');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0), vp8(352, 352)])), /no alpha/), 'no alpha (VP8X flag off, no ALPH)');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x10), meta('EXIF'), vp8l(352, 352, true)])), /chunk "EXIF"/), 'EXIF refused');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x10), vp8l(352, 352, true), meta('XMP ')])), /chunk "XMP "/), 'XMP refused');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x30), meta('ICCP'), vp8l(352, 352, true)])), /chunk "ICCP"/), 'ICC refused');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x10), vp8l(352, 352, true), meta('ZZZZ')])), /chunk "ZZZZ"/), 'unknown chunk refused');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x12), vp8l(352, 352, true), chunk('ANIM', Buffer.alloc(6))])), /chunk "ANIM"/), 'animation chunk refused');
assert.ok(has(checkFrame(riff([vp8x(352, 352, 0x10)])), /no picture data/), 'no picture data');
assert.ok(has(checkFrame(Buffer.concat([goodFrame, Buffer.alloc(MAX_FRAME_BYTES)])), /over the/), 'over 40 KB');
assert.ok(has(checkFrame(Buffer.concat([goodFrame, Buffer.from('PK appended')])), /after the end/), 'bytes appended after the RIFF data');
assert.ok(has(checkFrame(goodFrame.subarray(0, goodFrame.length - 6)), /truncated/), 'truncated');
{ const b = Buffer.from(goodFrame); b.writeUInt32LE(0xfffffff0, 4); assert.ok(has(checkFrame(b), /truncated/), 'RIFF size past the end'); }
{ const b = Buffer.from(goodFrame); b.writeUInt32LE(0xfffffff0, 16); assert.ok(has(checkFrame(b), /truncated/), 'chunk size past the end'); }
// the four frames together
assert.deepStrictEqual(checkFrames([goodFrame, goodFrame, goodFrame, goodFrame]), []);
assert.ok(has(checkFrames([goodFrame, goodFrame, riff([vp8l(1, 1, true)]), goodFrame]), /^frame 3:.*352/), 'a bad frame is named by number');
{
  const pad = riff([vp8x(352, 352, 0x10), vp8l(352, 352, true), chunk('ALPH', Buffer.alloc(MAX_FRAME_BYTES - goodFrame.length - 100))]);
  assert.deepStrictEqual(checkFrame(pad), [], 'a frame just under 40 KB passes');
  assert.ok(has(checkFrames([pad, pad, pad, pad, pad]), /total/) && MAX_CHARACTER_BYTES < 5 * pad.length, 'frames over 160 KB together are refused');
}

// ---- stripChunks: EXIF, XMP and ICC out, the rest untouched ----
{
  const dirty = riff([vp8x(352, 352, 0x10 | 0x20 | 0x08 | 0x04), meta('ICCP'), vp8l(352, 352, true), meta('EXIF'), meta('XMP ')]);
  assert.ok(has(checkFrame(dirty), /ICCP/) && has(checkFrame(dirty), /EXIF/) && has(checkFrame(dirty), /XMP/), 'the dirty file is refused as it is');
  const clean = stripChunks(dirty);
  assert.ok(clean, 'strip works'); const c = clean as Uint8Array;
  assert.deepStrictEqual(webpInfo(c)?.chunks, ['VP8X', 'VP8L'], 'only the picture chunks are left');
  assert.deepStrictEqual(checkFrame(c), [], 'and the result passes the frame check (RIFF size fixed)');
  assert.strictEqual(c[20] & (0x20 | 0x08 | 0x04), 0, 'VP8X metadata flags cleared');
  assert.strictEqual(c[20] & 0x10, 0x10, 'alpha flag kept');
  assert.strictEqual(Buffer.from(c).readUInt32LE(4), c.length - 8, 'RIFF size matches');
  assert.ok(!Buffer.from(c).includes('some metadata!'), 'the metadata bytes are gone');
  assert.ok(has(checkFrame(stripChunks(riff([vp8x(352, 352, 0x10), vp8l(352, 352, true), meta('ZZZZ')])) as Uint8Array), /ZZZZ/), 'an unknown chunk is NOT stripped silently: it is still refused');
  assert.strictEqual(stripChunks(Buffer.from('nope')), null, 'not a WebP');
  assert.strictEqual(stripChunks(dirty.subarray(0, dirty.length - 5)), null, 'truncated');
  // an odd-sized metadata chunk (padded) is removed with its pad byte
  const odd = riff([vp8x(352, 352, 0x10), vp8l(352, 352, true), chunk('EXIF', Buffer.from('abc'))]);
  assert.deepStrictEqual(checkFrame(stripChunks(odd) as Uint8Array), [], 'odd-sized EXIF with its pad byte');
}

// ---- the shipped art still passes the frame rules that apply to it (the walker moved here from test-crew-assets) ----
{
  const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'crew', 'art');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
  assert.ok(files.length >= 19 * 3, 'the shipped art is found (' + files.length + '): the scan is not vacuous');
  for (const f of files) assert.deepStrictEqual(checkFrame(fs.readFileSync(path.join(dir, f))), [], f + ' passes checkFrame');
}
console.log('imagecheck tests passed');
