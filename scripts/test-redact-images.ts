/**
 * Every image in this repository, wrapped as a base64 data URL, comes through the mask unchanged (spec 012 T137, review of PR #1015: a shape that starts after `/`
 * turned ordinary base64 into `[redacted]`; 23 of 1013 images on that build). What a chat or a tool shows as a data URL must stay an image. `npm run test:redact-images`.
 * Only the bare shapes run here: the other rules start at a name or a `:`, which base64 does not hold, and test-redact-shapes.ts runs a whole image through `redact`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REDACT_MAX_CHARS, maskBareTokenShapes } from '../src/shared/redact';

const root = path.join(__dirname, '..', '..');
const IMAGE = /\.(?:png|jpe?g|gif|webp|ico|icns)$/i;
const SKIP = new Set(['node_modules', 'dist', 'dist-scripts', 'release', '.git', 'test-results']);
const list = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (SKIP.has(e.name) ? [] : list(path.join(dir, e.name))) : IMAGE.test(e.name) ? [path.join(dir, e.name)] : []));

const files = list(root);
assert.ok(files.length > 100, `found the repo's images (${files.length})`);
for (const f of files) {
  const u = `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`.slice(0, REDACT_MAX_CHARS);
  assert.ok(maskBareTokenShapes(u, '[redacted]') === u, `an image changed: ${path.relative(root, f)}`);
}
console.log(`redact images: ${files.length} images unchanged`);
