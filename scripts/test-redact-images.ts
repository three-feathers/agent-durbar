/**
 * Every image in this repository, wrapped as a base64 data URL, comes through the mask unchanged (spec 012 T137, review of PR #1015: a shape that starts after `/`
 * turned ordinary base64 into `[redacted]`; 23 of 1013 images on that build). What a chat or a tool shows as a data URL must stay an image. `npm run test:redact-images-whole`, `npm run test:redact-images-forms`.
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
// `whole`: every image as a data URL. `forms`: the same bytes in the other forms base64 takes in text, base64url and wrapped at 76 columns (also JSON-escaped, as the debug log writes it), up to 32 KB of each, and seeded random buffers.
const part = process.argv[2];
const wrap = (b64: string, nl: string): string => b64.replace(/.{76}/g, (l) => l + nl);
const same = (t: string, what: string): void => assert.ok(maskBareTokenShapes(t, '[redacted]') === t, `${what} changed`);
for (const f of files) {
  const raw = fs.readFileSync(f);
  const rel = path.relative(root, f);
  if (part === 'whole') { same(`data:image/png;base64,${raw.toString('base64')}`.slice(0, REDACT_MAX_CHARS), rel); continue; }
  const head = raw.subarray(0, 32 * 1024);
  // the one residual in base64url: `sk-` may start after `-` or `_` (`_sk-…_` in Markdown is a real key, on `main` too), and base64url holds that by chance: a few of these heads do
  same(`x=${head.toString('base64url').replace(/[-_]sk-/g, '-sx-')}`, `${rel} as base64url`);
  same(wrap(head.toString('base64'), '\n'), `${rel} wrapped`);
  same(wrap(head.toString('base64'), '\\n'), `${rel} wrapped, JSON-escaped`);
}
// Random bytes, seeded, half of them zero-heavy (zero bytes make `AAAA`, the start of several prefixes), in all forms. Any hit is a false positive to look at: the residual is stated in secret-coverage.md.
let seed = 1009;
const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
const RANDOM_BUFFERS = part === 'forms' ? 400 : 0;
for (let n = 0; n < RANDOM_BUFFERS; n++) {
  const b = Buffer.alloc(1024 + (next() % 15360));
  for (let i = 0; i < b.length; i++) { const r = next(); b[i] = n % 2 && (r >>> 8) % 4 ? 0 : r >>> 24; }
  same(b.toString('base64'), `random buffer ${n}`);
  same(`x=${b.toString('base64url').replace(/[-_]sk-/g, '-sx-')}`, `random buffer ${n} as base64url`);
  same(wrap(b.toString('base64'), '\n'), `random buffer ${n} wrapped`);
}
console.log(`redact images ${part}: ${files.length} images and ${RANDOM_BUFFERS} random buffers unchanged`);
