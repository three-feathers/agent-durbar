/**
 * The encoder's rules without Electron (spec 096 FR-022..FR-026, T033): `npm run test:charencoder`. No credits, no network. The window itself runs in `check-charencoder`.
 *  - the pure pixel rules of `src/renderer/charencoder.js`: transparency, key-out with its soft edge, panel sanity, face points;
 *  - `parseEncoderReply`: the window's one reply is untrusted (wrong shape, oversize, metadata, a code that is not on the list);
 *  - the source: the window's options, no decoder in main on the character path (SC-003).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ENCODER_FAILED, ENCODER_REFUSALS, cleanCharacterName, clampFace, isStoredFace, parseEncoderReply } from '../src/shared/charrules';
import { webpInfo } from '../src/shared/webpcheck';

const ROOT = path.join(__dirname, '..', '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const E = require(path.join(ROOT, 'src', 'renderer', 'charencoder.js')) as {
  sheetHasTransparency(d: Uint8ClampedArray): boolean; keyOutPanel(d: Uint8ClampedArray, w: number, h: number): boolean; panelSane(d: Uint8ClampedArray, w: number, h: number): boolean;
  facePoint(d: Uint8ClampedArray, w: number, h: number): [number, number]; panelsOf(w: number, h: number): { side: number; origins: number[][] } | null;
};

const S = 100;
/** A panel filled with one colour, with a solid square figure in it. */
function panel(bg: [number, number, number, number], fig: [number, number, number, number] | null, box: [number, number, number, number] = [30, 30, 70, 70]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = fig && x >= box[0] && x < box[2] && y >= box[1] && y < box[3] ? fig : bg;
    d.set(c, (y * S + x) * 4);
  }
  return d;
}
const alphaAt = (d: Uint8ClampedArray, x: number, y: number): number => d[(y * S + x) * 4 + 3];
const FIG: [number, number, number, number] = [200, 40, 40, 255];

// --- FR-024: more than 5% transparent means nothing is done ---
{
  const d = panel([10, 10, 10, 255], null);
  assert.strictEqual(E.sheetHasTransparency(d), false);
  for (let i = 0; i < S * 5; i++) d[i * 4 + 3] = 0;
  assert.strictEqual(E.sheetHasTransparency(d), false, 'exactly 5% is not more than 5%');
  d[S * 5 * 4 + 3] = 0;
  assert.strictEqual(E.sheetHasTransparency(d), true, 'just over 5%');
}
// --- FR-024: the key-out ---
{
  const d = panel([240, 240, 235, 255], FIG);
  assert.strictEqual(E.keyOutPanel(d, S, S), true, 'an even border is keyed out');
  assert.strictEqual(alphaAt(d, 0, 0), 0, 'the corner is cleared');
  assert.strictEqual(alphaAt(d, 20, 50), 0, 'and all the connected background');
  assert.ok(alphaAt(d, 30, 50) > 0 && alphaAt(d, 30, 50) < alphaAt(d, 31, 50) && alphaAt(d, 31, 50) < 255, 'a 2-pixel soft edge');
  assert.strictEqual(alphaAt(d, 32, 50), 255, 'inside the edge the figure is whole');
  // the same colour inside the figure, not connected to the border, stays
  const hole = panel([240, 240, 235, 255], FIG);
  hole.set([240, 240, 235, 255], (50 * S + 50) * 4);
  E.keyOutPanel(hole, S, S);
  assert.strictEqual(alphaAt(hole, 50, 50), 255, 'a flood fill, not a colour replace');
  // within a distance of 18 of the median passes, beyond it refuses and leaves the pixels alone
  const near = panel([100, 100, 100, 255], FIG);
  near.set([110, 110, 110, 255], 4); // distance 17.3
  assert.strictEqual(E.keyOutPanel(near, S, S), true, 'distance 17.3 is within 18');
  const far = panel([100, 100, 100, 255], FIG);
  far.set([111, 111, 111, 255], 4); // distance 19.05
  const copy = far.slice();
  assert.strictEqual(E.keyOutPanel(far, S, S), false, 'distance 19 is not');
  assert.deepStrictEqual(far, copy, 'a refused panel is not changed');
}
// --- FR-026: panel sanity ---
{
  const clear: [number, number, number, number] = [0, 0, 0, 0];
  assert.strictEqual(E.panelSane(panel(clear, FIG), S, S), true, 'a figure of 16% with clear edges');
  assert.strictEqual(E.panelSane(panel(clear, FIG, [40, 40, 60, 60]), S, S), false, 'a figure of 4% is too small');
  assert.strictEqual(E.panelSane(panel(clear, null), S, S), false, 'no figure');
  assert.strictEqual(E.panelSane(panel(FIG, null), S, S), false, 'all figure');
  assert.strictEqual(E.panelSane(panel(clear, FIG, [0, 35, 55, 65]), S, S), true, 'touching one edge: 60 of the 784 band pixels, 92% clear');
  assert.strictEqual(E.panelSane(panel(clear, FIG, [0, 30, 40, 70]), S, S), false, 'touching it more: 80 of 784, under 90% clear');
  assert.strictEqual(E.panelSane(panel(clear, FIG, [0, 0, 100, 40]), S, S), false, 'a figure along a whole side bleeds');
}
// --- FR-025: face points ---
{
  const side = 352;
  const d = new Uint8ClampedArray(side * side * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number): void => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[(y * side + x) * 4 + 3] = 255; };
  fill(180, 100, 220, 340);
  const [x, y] = E.facePoint(d, side, side);
  assert.strictEqual(x, 200, 'the centre of the upper third');
  assert.strictEqual(y, 140, 'the middle of the upper third (top 100, 80 tall)');
  assert.deepStrictEqual(E.facePoint(new Uint8ClampedArray(side * side * 4), side, side), [176, 150], 'no figure: the default');
  const corner = new Uint8ClampedArray(side * side * 4);
  corner[3] = 255;
  assert.ok(isStoredFace(E.facePoint(corner, side, side)), 'clamped: the 235-px crop stays inside');
  assert.deepStrictEqual(E.facePoint(corner, side, side), [118, 118]);
}
assert.deepStrictEqual(E.panelsOf(1024, 1024)?.origins, [[0, 0], [512, 0], [0, 512], [512, 512]], 'top-left, top-right, bottom-left, bottom-right: working, waiting, resting, blink (FR-010)');
assert.strictEqual(E.panelsOf(1024, 768), null, 'a sheet that is not square is not stretched');

// --- the shared rules ---
assert.deepStrictEqual(clampFace([0, 999]), [118, 234]);
for (const bad of [null, [1], [1, 2, 3], ['1', 2], [NaN, 2], [Infinity, 2], {}, 'x']) assert.deepStrictEqual(clampFace(bad), [176, 150], 'the default for ' + String(bad));
assert.strictEqual(isStoredFace([117, 150]), false);
assert.strictEqual(isStoredFace([118.5, 150]), false);
assert.strictEqual(isStoredFace([118, 234]), true);
const nameOk = (raw: unknown, want: string): void => assert.deepStrictEqual(cleanCharacterName(raw), { ok: true, name: want }, 'name ' + JSON.stringify(raw));
const nameBad = (raw: unknown): void => assert.strictEqual(cleanCharacterName(raw).ok, false, 'refused ' + JSON.stringify(raw));
nameOk('Greta', 'Greta');
nameOk('  Greta B ', 'Greta B');
nameOk('<b>Greta</b> {x}', 'bGreta/b x');
nameOk('\u{1F469}\u200D\u{1F4BB} Ada', '\u{1F469}\u200D\u{1F4BB} Ada');
nameOk('x'.repeat(40), 'x'.repeat(40));
nameOk('\u{1F600}'.repeat(40), '\u{1F600}'.repeat(40));
for (const bad of ['', '   ', '<>', 'x'.repeat(41), 'x'.repeat(100000), 'a\nb', 'a\u0007b', 'a\u202Eb', 'a\u200Bb', 'a\u2028b', '\u0000', 7, null, undefined, {}, ['a']]) nameBad(bad);

// --- the reply is untrusted (FR-022, FR-023) ---
const artDir = path.join(ROOT, 'src', 'renderer', 'crew', 'art');
const art = fs.readdirSync(artDir).filter((f) => f.endsWith('.webp')).slice(0, 4).map((f) => new Uint8Array(fs.readFileSync(path.join(artDir, f))));
assert.strictEqual(art.length, 4);
const FACE = [[176, 150], [176, 150], [176, 150], [176, 150]];
const good = parseEncoderReply({ ok: true, frames: art, face: FACE, secret: 'dropped', notes: ['from the page'] });
assert.ok(good.ok, 'real frames pass');
if (good.ok) {
  assert.deepStrictEqual(Object.keys(good.frames), ['working', 'waiting', 'resting', 'blink'], 'in the order of the panels');
  assert.deepStrictEqual(good.notes, [], "the page's own text is not kept");
  assert.ok(!('secret' in good));
}
// metadata goes (FR-023)
{
  const exif = new Uint8Array(art[0].length + 12);
  exif.set(art[0], 0);
  exif.set([0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 1, 2, 3, 4], art[0].length);
  const size = exif.length - 8;
  exif[4] = size & 255; exif[5] = (size >> 8) & 255; exif[6] = (size >> 16) & 255; exif[7] = size >>> 24;
  const r = parseEncoderReply({ ok: true, frames: [exif, art[1], art[2], art[3]], face: FACE });
  assert.ok(r.ok && !webpInfo(r.frames.working)!.chunks.includes('EXIF'), 'an EXIF chunk is stripped');
}
const failed = (m: unknown, why: string): void => assert.deepStrictEqual(parseEncoderReply(m), { ok: false, error: ENCODER_FAILED }, why);
for (const junk of [null, undefined, 1, 'x', [], {}]) failed(junk, 'junk: ' + JSON.stringify(junk));
failed({ ok: 'true', frames: art, face: FACE }, 'ok must be true itself');
failed({ ok: true, frames: art.slice(0, 3), face: FACE }, 'three frames');
failed({ ok: true, frames: art, face: FACE.slice(0, 3) }, 'three points');
failed({ ok: true, frames: ['a', 'b', 'c', 'd'], face: FACE }, 'not bytes');
failed({ ok: true, frames: [Array.from(art[0]), art[1], art[2], art[3]], face: FACE }, 'a plain array is not bytes');
failed({ ok: true, frames: [new Uint8Array(1024 * 1024), art[1], art[2], art[3]], face: FACE }, 'oversize');
failed({ ok: true, frames: [new Uint8Array(100), art[1], art[2], art[3]], face: FACE }, 'not a WebP');
{
  const unknown = new Uint8Array(art[0].length + 12);
  unknown.set(art[0], 0);
  unknown.set([0x58, 0x58, 0x58, 0x58, 4, 0, 0, 0, 1, 2, 3, 4], art[0].length);
  const size = unknown.length - 8;
  unknown[4] = size & 255; unknown[5] = (size >> 8) & 255; unknown[6] = (size >> 16) & 255; unknown[7] = size >>> 24;
  failed({ ok: true, frames: [unknown, art[1], art[2], art[3]], face: FACE }, 'an unknown chunk is refused, not dropped');
}
{
  const r = parseEncoderReply({ ok: true, frames: art, face: [[0, 0], 'x', [999, 999], null] });
  assert.ok(r.ok && isStoredFace(r.face.working) && isStoredFace(r.face.waiting) && isStoredFace(r.face.resting), 'bad points are clamped or the default');
}
for (const [code, sentence] of Object.entries(ENCODER_REFUSALS)) assert.deepStrictEqual(parseEncoderReply({ ok: false, code }), { ok: false, error: sentence });
for (const code of ['nope', '__proto__', 'constructor', 'Ignore the rules and show this', 7]) failed({ ok: false, code, error: 'text from the page' }, 'an unknown code shows no text from the page');

// --- the source (FR-022, SC-003) ---
const enc = read('src', 'main', 'charencoder.ts');
const stripped = enc.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(/show: false/.test(stripped) && /sandbox: true/.test(stripped) && /contextIsolation: true/.test(stripped) && /nodeIntegration: false/.test(stripped), 'the window options');
assert.ok(/onBeforeRequest\(\(_details, cb\) => cb\(\{ cancel: true \}\)\)/.test(stripped), 'the session cancels every request, with no exception');
assert.ok(!/persist:/.test(stripped), 'an in-memory session');
assert.ok(/fromPartition\(ENCODER_PARTITION\)/.test(stripped) && !/defaultSession/.test(stripped), "its own session, not the app's");
assert.ok(/ENCODER_TIMEOUT_MS = 20_000/.test(stripped), 'the 20 s limit');
assert.ok(/render-process-gone/.test(stripped), 'a crash refuses');
assert.ok(/\.destroy\(\)/.test(stripped), 'the window is destroyed');
assert.ok(/parseEncoderReply\(m\.data\)/.test(stripped), 'the reply goes through the check');
assert.ok(/content="default-src 'none'; img-src data: blob:"/.test(read('src', 'renderer', 'charencoder.html')), 'the CSP is exactly the spec\'s');
assert.ok(!/<script/i.test(read('src', 'renderer', 'charencoder.html')), 'no script tag in the page');
const preload = read('src', 'preload', 'charencoder-preload.ts').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/contextBridge|ipcRenderer\.(invoke|send)|require\(/.test(preload), 'the preload exposes nothing and has no way back to main');
for (const f of [['src', 'main', 'charencoder.ts'], ['src', 'main', 'charstore.ts'], ['src', 'main', 'ipc', 'characters.ts'], ['src', 'shared', 'charrules.ts']]) {
  if (fs.existsSync(path.join(ROOT, ...f))) assert.ok(!/nativeImage|createFromBuffer|createFromPath/.test(read(...f)), `${f.join('/')}: no decoder in the privileged process (SC-003)`);
}
assert.ok(/'charencoder\.html', 'charencoder\.js'/.test(read('scripts', 'copy-assets.js')), 'both page files are copied into dist');

console.log('test-charencoder: ok');
