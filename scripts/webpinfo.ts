/** WebP RIFF chunk walker (spec 077 FR-050, spec 097 FR-062): used by test-crew-assets.ts and test-realoffice-assets.ts. */
import * as assert from 'assert';

/** The RIFF chunks of a WebP: [fourcc, size] in order, and the picture's size from its VP8, VP8L or VP8X header. */
export function webpInfo(buf: Buffer): { chunks: string[]; width: number; height: number } {
  assert.ok(buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP', 'a WebP file');
  const chunks: string[] = []; let width = 0, height = 0;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4), d = p + 8;
    chunks.push(id);
    if (id === 'VP8X') { width = 1 + buf.readUIntLE(d + 4, 3); height = 1 + buf.readUIntLE(d + 7, 3); }
    else if (id === 'VP8 ' && !width) { width = buf.readUInt16LE(d + 6) & 0x3fff; height = buf.readUInt16LE(d + 8) & 0x3fff; }
    else if (id === 'VP8L' && !width) { const b = buf.readUInt32LE(d + 1); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
    p = d + size + (size & 1);
  }
  return { chunks, width, height };
}

