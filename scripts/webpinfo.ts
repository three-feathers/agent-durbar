/** WebP RIFF chunk walker for the shipped-art tests (spec 077 FR-050, spec 097 FR-062): test-crew-assets.ts and test-realoffice-assets.ts.
 * The walker itself is `src/shared/webpcheck.ts` (spec 096 FR-023, spec 021 FR-031: one walker for the art tests and for the world pack
 * validator); this file only keeps the tests' old contract, an assertion when the file is not a WebP. */
import * as assert from 'assert';
import { webpInfo as walk } from '../src/shared/webpcheck';

/** The RIFF chunks of a WebP: fourcc names in order, and the picture's size from its VP8, VP8L or VP8X header. */
export function webpInfo(buf: Buffer): { chunks: string[]; width: number; height: number } {
  const info = buf.length > 30 ? walk(buf) : null;
  assert.ok(info, 'a WebP file');
  return { chunks: info.chunks, width: info.width, height: info.height };
}
