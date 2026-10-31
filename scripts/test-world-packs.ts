/**
 * Spec 102 T016, FR-050, FR-180, SC-002: the synthetic pack passes, and every package of the hostile set (at least 30, generated here) is refused by
 * the SAME functions the app uses (`worldpack.ts`), with nothing written anywhere. `npm run test:world-packs`. Plain Node, no Electron, no network, no credits.
 */
import * as assert from 'assert';
import * as path from 'path';
import { validateWorldZip, validateWorldFiles, PART_NAMES, type PackOptions } from '../src/shared/worldpack';
import { goodPack, toStored, hostileSet, SECRET_MARKER, rawZip, rawFrom } from './fixtures/worlds/gen';
import * as crypto from 'crypto';

process.exitCode = 1;
const R: Record<string, string> = {
  R0: "An entry name ends in a dot or a space, or climbs a folder.",
  R1: "An entry name has a backslash.",
  R2: "An entry name is an absolute path.",
  R3: "An entry name has a character or length that is not allowed.",
  R4: "An entry name is not on the list of allowed names.",
  R5: "An entry name is a reserved Windows device name.",
  R6: "Two entries have the same name, or names that differ only in case.",
  R7: "The zip has folders inside folders.",
  R8: "The zip has more than one top-level folder.",
  R9: "The zip mixes files inside and outside its folder.",
  R10: "An entry name is empty or too long.",
  R11: "A file in the pack is not on the list of allowed names.",
  R12: "The zip holds a link or another file that is not a plain file.",
  R13: "An encrypted zip is not supported.",
  R14: "An entry uses a zip feature that is not supported.",
  R15: "An entry uses a compression method that is not supported.",
  R16: "The zip uses ZIP64, which is not supported.",
  R17: "The zip uses ZIP64, which is not supported, or a header is damaged.",
  R18: "A zip in several parts is not supported.",
  R19: "The zip directory is damaged.",
  R20: "The zip has bytes between its files and its directory.",
  R21: "The zip is empty.",
  R22: "Not a zip file, or it has extra bytes after its end.",
  R23: "The zip has bytes before or between its files.",
  R24: "Not a zip file.",
  R25: "The zip has a comment, which is not supported.",
  R26: "A file header in the zip is damaged.",
  R27: "An entry has too much extra data.",
  R28: "A file header and the zip directory disagree.",
  R29: "A file and its trailing size record disagree.",
  R30: "The file is damaged, or larger than it says.",
  R31: "A file in the zip is packed far smaller than a picture can be.",
  R32: "A stored entry has two different sizes.",
  R33: "Two entries overlap.",
  R34: "A file in the zip runs past its end.",
  R35: "A folder entry holds data.",
  R36: "A file in the zip is too big.",
  R37: "The zip has too many entries.",
  R38: "The zip has too many files.",
  R39: "Not a PNG or WebP picture.",
  R40: "The picture header is damaged.",
  R41: "The picture is cut short.",
  R42: "The picture has extra bytes after its end.",
  R43: "The picture holds data besides the picture (metadata chunks).",
  R44: "An animated picture is not allowed.",
  R45: "The picture header disagrees with itself.",
  R46: "A part entry: an anchor box is not {x, y, w, h} inside the picture.",
  R47: "The picture is too large.",
  R48: "The picture holds data besides the picture (text or metadata chunks).",
  R49: "The picture is damaged.",
  R50: "The picture is larger than this part allows (4096x300).",
  R51: "The picture is larger than this part allows (1920x1200).",
  R52: "The picture is smaller than this part needs.",
  R53: "The picture is bigger than its limit of 120 KB.",
  R54: "The picture is bigger than its limit of 24 KB.",
  R55: "The picture is larger than this part allows (180x1200).",
  R56: "world.json has a field that is not on the list.",
  R57: "world.json sets a real height; a pack cannot (it is one value per place in the app).",
  R58: "This world was made for a newer Agent Durbar.",
  R59: "world.json has no valid format version.",
  R60: "world.json needs an id of lowercase letters, digits, - and _.",
  R61: "The world name must be 1 to 40 plain characters.",
  R62: "The description must be plain text of at most 200 characters.",
  R63: "The licence must be plain text of at most 40 characters.",
  R64: "The world version must be a whole number of up to 9 digits.",
  R65: "The default character set must be a set id.",
  R66: "A light shape is not on the list.",
  R67: "The ride style is not on the list.",
  R68: "A colour or font in world.json is not allowed (no url(), no markup, no font outside the app's list).",
  R69: "The colours and fonts are not an object.",
  R70: "The pack has too many colours and fonts.",
  R71: "world.json lists no parts object.",
  R72: "world.json lists a file that is not on the list.",
  R73: "world.json lists a file that is not in the pack.",
  R74: "The pack has a file that world.json does not list.",
  R75: "A part entry in world.json has a field that is not on the list.",
  R76: "A part entry: an anchor is not a number from 0 to 1.",
  R77: "A part entry: it names an anchor this part does not have.",
  R78: "A part entry: an anchor point is not {x, y} from 0 to 1.",
  R79: "The screen on the small desk is too small to read.",
  R80: "The file does not match the hash in world.json.",
  R81: "A part hash is not a SHA-256.",
  R82: "The file is not the size world.json says.",
  R83: "world.json is not valid JSON.",
  R84: "world.json is not an object.",
  R85: "world.json is over 64 KB.",
  R86: "A colour in world.json is see-through where text has to be read on it.",
  R87: "A colour in world.json is not a plain colour (write #rrggbb).",
  R88: "Text colours in world.json cannot be read on the colours behind them.",
  R89: "world.json sets a name the app does not know.",
  R90: "A status colour in world.json does not keep its meaning (working blue, waiting amber, error red, done green).",
  R91: "An entry has a comment, which is not supported.",
  R92: "world.json is damaged.",
  R93: "world.json repeats a field name.",
  R94: "The pack has no world.json.",
};
/** Why each hostile package is refused: pinned, so a fixture that is refused for the wrong reason (or by a different rule after an edit) fails. */
const WHY: Record<string, string> = {
  "traversal": R.R0,
  "traversal-deep": R.R0,
  "backslash-traversal": R.R1,
  "backslash": R.R1,
  "absolute": R.R2,
  "absolute-windows": R.R2,
  "drive-letter": R.R2,
  "drive-relative": R.R2,
  "colon-stream": R.R3,
  "nul-in-name": R.R4,
  "control-char": R.R4,
  "bidi-name": R.R4,
  "unicode-lookalike": R.R4,
  "reserved-con": R.R5,
  "reserved-nul": R.R5,
  "reserved-com1": R.R5,
  "trailing-dot": R.R0,
  "trailing-space": R.R0,
  "case-duplicate": R.R6,
  "exact-duplicate": R.R6,
  "nested-folder": R.R7,
  "two-top-folders": R.R8,
  "mixed-root-and-folder": R.R9,
  "macosx-traversal": R.R0,
  "dsstore-folder": R.R7,
  "dot-folder": R.R7,
  "name-too-long": R.R10,
  "empty-name": R.R10,
  "not-on-list-readme": R.R11,
  "not-on-list-js": R.R11,
  "not-on-list-html": R.R11,
  "not-on-list-svg": R.R11,
  "not-on-list-exe": R.R11,
  "secret-marker-name": R.R11,
  "symlink-attr": R.R12,
  "device-attr": R.R12,
  "dos-reparse-attr": R.R12,
  "encrypted": R.R13,
  "strong-encryption": R.R13,
  "masked-header": R.R14,
  "method-bzip2": R.R15,
  "method-deflate64": R.R15,
  "zip64-locator": R.R16,
  "zip64-extra": R.R16,
  "zip64-local-extra": R.R17,
  "zip64-sentinel-size": R.R16,
  "zip64-sentinel-entries": R.R16,
  "multi-disk-eocd": R.R18,
  "multi-disk-entry": R.R18,
  "extra-field-damaged": R.R19,
  "eocd-count-mismatch": R.R18,
  "eocd-total-lies": R.R19,
  "cd-offset-lies": R.R20,
  "cd-size-lies": R.R20,
  "empty-zip": R.R21,
  "zip-comment": R.R22,
  "polyglot-suffix": R.R22,
  "polyglot-prefix-png": R.R23,
  "polyglot-prefix-unshifted": R.R20,
  "gap-between-entries": R.R23,
  "not-a-zip-text": R.R22,
  "empty-buffer": R.R24,
  "eocd-only-garbage": R.R21,
  "zip-comment-length-lies": R.R25,
  "cd-signature-bad": R.R19,
  "local-signature-bad": R.R26,
  "cd-extra-too-long": R.R27,
  "local-extra-too-long": R.R28,
  "cd-extra-short-header": R.R19,
  "macosx-deep-folder": R.R4,
  "hidden-folder-entry": R.R7,
  "thumbs-folder-entry": R.R7,
  "descriptor-values-differ": R.R29,
  "descriptor-missing": R.R29,
  "gap-after-last-file": R.R20,
  "deflate-shorter-than-declared": R.R30,
  "deflate-empty-small": R.R31,
  "local-name-differs": R.R28,
  "local-size-differs": R.R28,
  "local-crc-differs": R.R28,
  "local-method-differs": R.R28,
  "local-flags-differ": R.R28,
  "descriptor-disagrees": R.R28,
  "stored-sizes-differ": R.R32,
  "crc-wrong": R.R30,
  "overlap-same-offset": R.R33,
  "overlap-inside": R.R33,
  "entry-past-end": R.R34,
  "offset-past-end": R.R23,
  "folder-with-data": R.R35,
  "bomb-ratio": R.R31,
  "bomb-declared-small": R.R30,
  "bomb-over-entry-cap": R.R36,
  "claimed-huge-size": R.R36,
  "claimed-huge-csize": R.R36,
  "deflate-garbage": R.R30,
  "deflate-empty-but-claims-data": R.R31,
  "too-many-entries": R.R37,
  "too-many-files": R.R38,
  "truncated-0.99": R.R22,
  "truncated-0.9": R.R22,
  "truncated-0.5": R.R22,
  "truncated-0.1": R.R22,
  "truncated-minus-one": R.R22,
  "truncated-eocd-short": R.R22,
  "svg-with-script-as-webp": R.R39,
  "html-as-webp": R.R39,
  "jpeg-as-webp": R.R39,
  "gif-as-webp": R.R39,
  "empty-picture": R.R39,
  "png-magic-only": R.R40,
  "riff-not-webp": R.R39,
  "webp-truncated": R.R41,
  "webp-trailing-script": R.R42,
  "webp-metadata-chunk": R.R43,
  "webp-animated-flag": R.R44,
  "webp-animated-anmf": R.R44,
  "webp-canvas-vs-bitstream": R.R45,
  "webp-no-picture-data": R.R43,
  "webp-two-picture-chunks": R.R40,
  "webp-vp8x-two-picture-chunks": R.R40,
  "webp-simple-with-alph": R.R40,
  "webp-vp8x-only": R.R40,
  "webp-vp8l-bad-signature": R.R40,
  "webp-vp8-bad-start-code": R.R40,
  "png-zero-dims": R.R40,
  "manifest-anchor-rect-extra-key": R.R46,
  "webp-huge-dims": R.R47,
  "png-animated": R.R44,
  "png-text-chunk": R.R48,
  "png-no-iend": R.R41,
  "png-trailing-zip": R.R42,
  "png-bad-crc": R.R49,
  "png-huge-chunk-len": R.R41,
  "too-tall-fixture": R.R50,
  "too-wide-picture": R.R47,
  "welcome-over-1920": R.R51,
  "window-too-narrow": R.R52,
  "over-byte-cap": R.R53,
  "over-byte-cap-lift-frame": R.R54,
  "lift-shaft-too-wide": R.R55,
  "manifest-unknown-field": R.R56,
  "manifest-proto": R.R56,
  "manifest-proto-field": R.R56,
  "manifest-realheight": R.R57,
  "manifest-position-field": R.R56,
  "manifest-newer-format": R.R58,
  "manifest-format-zero": R.R59,
  "manifest-format-string": R.R59,
  "manifest-no-id": R.R60,
  "manifest-bad-id": R.R60,
  "manifest-long-name": R.R61,
  "manifest-empty-name": R.R61,
  "manifest-bidi-name": R.R61,
  "manifest-control-name": R.R61,
  "manifest-markup-name": R.R61,
  "manifest-backtick-description": R.R62,
  "manifest-long-description": R.R62,
  "manifest-long-licence": R.R63,
  "manifest-version-fraction": R.R64,
  "manifest-version-huge": R.R64,
  "manifest-version-negative": R.R64,
  "manifest-bad-defaultset": R.R65,
  "manifest-bad-lamp": R.R66,
  "manifest-light-colour": R.R66,
  "manifest-bad-ride": R.R67,
  "manifest-token-url": R.R68,
  "manifest-token-markup": R.R68,
  "manifest-token-css-syntax": R.R68,
  "manifest-token-bad-key": R.R68,
  "manifest-token-unknown-font": R.R68,
  "manifest-token-font-url": R.R68,
  "manifest-tokens-not-object": R.R69,
  "manifest-too-many-tokens": R.R70,
  "manifest-parts-missing": R.R71,
  "manifest-part-not-on-list": R.R72,
  "manifest-part-not-in-pack": R.R73,
  "manifest-part-unlisted": R.R74,
  "manifest-part-field": R.R75,
  "manifest-anchor-out-of-range": R.R76,
  "manifest-anchor-negative": R.R76,
  "manifest-anchor-unknown": R.R77,
  "manifest-anchor-string": R.R76,
  "manifest-anchor-rect-overflow": R.R46,
  "manifest-anchor-extra-key": R.R78,
  "manifest-screen-too-small": R.R79,
  "manifest-hash-wrong": R.R80,
  "manifest-hash-malformed": R.R81,
  "manifest-bytes-wrong": R.R82,
  "manifest-not-json": R.R83,
  "manifest-array": R.R84,
  "manifest-null": R.R84,
  "manifest-bom": R.R83,
  "manifest-invalid-utf8": R.R83,
  "manifest-too-big": R.R85,
  "manifest-deep-nesting": R.R84,
  "token-ink-transparent": R.R86,
  "token-ink-alpha-zero-hex8": R.R86,
  "token-ink-alpha-zero-hex4": R.R87,
  "token-ink-seven-digit-hex": R.R87,
  "token-ink-same-as-bg-rgb": R.R88,
  "token-ink-same-as-bg-hex": R.R88,
  "token-ink-hsl": R.R87,
  "token-bg-rgb-javascript": R.R87,
  "token-bg-seethrough-with-text": R.R86,
  "token-unknown-t5-size": R.R89,
  "token-unknown-s-1": R.R89,
  "token-unknown-z-top": R.R89,
  "token-colour-name-size-value": R.R87,
  "token-colour-name-word-value": R.R87,
  "token-colour-name-time-value": R.R87,
  "token-value-not-a-string": R.R68,
  "token-value-deep-array": R.R68,
  "token-status-swapped": R.R90,
  "token-status-grey-error": R.R90,
  "token-status-pill-wrong-hue": R.R90,
  "png-gama-blob": R.R40,
  "png-srgb-blob": R.R40,
  "png-phys-blob": R.R40,
  "png-trns-blob": R.R40,
  "png-iend-blob": R.R40,
  "png-second-ihdr": R.R40,
  "png-idat-before-plte": R.R40,
  "png-plte-twice": R.R40,
  "png-bad-depth-and-type": R.R40,
  "png-bad-interlace": R.R40,
  "png-plte-with-greyscale": R.R40,
  "png-trns-with-alpha-type": R.R40,
  "png-palette-type-without-plte": R.R40,
  "png-gama-after-plte": R.R40,
  "png-chunk-between-idats": R.R40,
  "webp-vp8x-blob": R.R40,
  "webp-vp8x-short": R.R40,
  "webp-second-vp8x-animated": R.R40,
  "webp-alph-blob-with-vp8l": R.R40,
  "webp-alph-after-bitstream": R.R40,
  "webp-alph-twice": R.R40,
  "webp-alph-without-alpha-flag": R.R40,
  "webp-vp8x-extra-flags": R.R40,
  "webp-vp8x-reserved-bytes": R.R40,
  "webp-vp8-inter-frame": R.R40,
  "webp-vp8-hidden-frame": R.R40,
  "webp-vp8-scaled": R.R40,
  "webp-vp8l-version-7": R.R40,
  "webp-pad-byte-carries-data": R.R40,
  "entry-comment-in-directory": R.R91,
  "deflate-junk-after-final-block": R.R92,
  "unicode-path-extra-cd": R.R19,
  "unicode-comment-extra-cd": R.R19,
  "unicode-path-extra-local": R.R17,
  "reparse-bit-ntfs-host": R.R12,
  "reparse-bit-unix-host": R.R12,
  "world-json-with-directory-mode": R.R12,
  "file-with-dos-directory-bit": R.R12,
  "folder-entry-with-regular-mode": R.R12,
  "junk-folder-a-then-pack-folder-b": R.R8,
  "pack-folder-b-then-junk-folder-a": R.R8,
  "junk-in-folder-with-root-pack": R.R9,
  "thumbs-in-two-folders-with-root-pack": R.R8,
  "dsstore-inside-dsstore-folder": R.R7,
  "reserved-com0": R.R5,
  "reserved-lpt0-ext": R.R5,
  "reserved-with-space-before-dot": R.R5,
  "json-duplicate-top-level-id": R.R93,
  "json-duplicate-escaped-key": R.R93,
  "json-duplicate-token": R.R93,
  "json-duplicate-in-parts": R.R93,
  "name-blank-u3164": R.R61,
  "name-blank-braille-blank": R.R61,
  "name-blank-cgj": R.R61,
  "name-blank-vs16-alone": R.R61,
  "name-blank-mongolian-vs": R.R61,
  "png-ihdr-length-12": R.R40,
  "png-first-chunk-idat": R.R40,
  "png-colour-type-5": R.R40,
  "png-depth-4-for-rgb": R.R40,
  "png-compression-1": R.R40,
  "png-filter-1": R.R40,
  "png-width-over-2-pow-31": R.R40,
  "png-chrm-31-bytes": R.R40,
  "png-srgb-2-bytes": R.R40,
  "png-srgb-value-5": R.R40,
  "png-phys-10-bytes": R.R40,
  "png-phys-unit-2": R.R40,
  "png-plte-4-bytes": R.R40,
  "png-plte-empty": R.R40,
  "png-plte-771-bytes-16-bit": R.R40,
  "png-plte-3-entries-1-bit": R.R40,
  "png-trns-before-plte": R.R40,
  "png-trns-grey-4-bytes": R.R40,
  "png-trns-palette-too-long": R.R40,
  "png-trns-palette-empty": R.R40,
  "png-trns-palette-without-plte": R.R40,
  "webp-alph-without-vp8x": R.R40,
  "webp-alph-empty": R.R40,
  "webp-two-vp8x-only": R.R40,
  "webp-vp8l-4-bytes": R.R40,
  "webp-vp8-6-bytes": R.R40,
  "webp-vp8-version-4": R.R40,
  "webp-vp8x-posing-as-bitstream": R.R40,
  "nested-folder-entry": R.R7,
  "manifest-missing": R.R94,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string> };
const clean = T._tokens();
assert.ok(Object.keys(clean).length > 100, 'Clean Office tokens loaded');
const opts: PackOptions = { clean, knownSets: ['office', 'retro'], requireHashes: false };

// ---- the good pack is accepted, and complete ----
const good = validateWorldZip(toStored(goodPack()), opts);
assert.ok(good.ok, 'the synthetic pack passes: ' + good.reason);
assert.deepStrictEqual(good.unfinished, [], 'a full pack covers every moment');
assert.strictEqual(good.coverage.length, 26, 'all 26 registry moments are judged');
assert.strictEqual(good.contrastIssues, 0);
assert.ok(good.manifest && good.manifest.id === 'test-world' && good.manifest.lights.lamp === 'flame');
assert.strictEqual(good.parts.length, PART_NAMES.length, 'every part of the closed list is present and kept');
assert.ok(good.report.every((r) => r.ok), 'no refused row in a good report');

// a folder (upload as folder) goes through the same rules
const asFiles = (f: Record<string, Buffer>): { name: string; data: Buffer }[] => Object.keys(f).map((name) => ({ name, data: f[name] }));
assert.ok(validateWorldFiles(asFiles(goodPack()), opts).ok, 'the same pack as a folder');
assert.ok(!validateWorldFiles([...asFiles(goodPack()), { name: '../x', data: Buffer.from('x') }], opts).ok, 'a folder file with ../');
assert.ok(!validateWorldFiles([...asFiles(goodPack()), { name: 'sub/x.webp', data: Buffer.from('x') }], opts).ok, 'a folder file with a slash');
assert.ok(!validateWorldFiles([...asFiles(goodPack()), { name: 'WALL.webp', data: Buffer.from('x') }], opts).ok, 'a folder case duplicate');

// ---- the hostile set ----
const hostile = hostileSet();
assert.ok(hostile.length >= 30, 'at least 30 hostile packages (SC-002): ' + hostile.length);
assert.strictEqual(new Set(hostile.map((h) => h.id)).size, hostile.length, 'unique ids');

// SC-002 "nothing left on disk, no write outside the temp folder": any write-type call while validating fails the test
const WRITERS = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'symlink', 'symlinkSync', 'link', 'linkSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'truncate', 'truncateSync', 'createWriteStream', 'open', 'openSync', 'write', 'writeSync'];
const saved = new Map<string, unknown>();
let writeAttempts = 0;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsAny = require('fs') as Record<string, unknown>; // the real module object (an `import *` namespace is read-only)
for (const n of WRITERS) if (typeof fsAny[n] === 'function') { saved.set(n, fsAny[n]); fsAny[n] = () => { writeAttempts++; throw new Error('write attempted: ' + n); }; }
const refusedBy: string[] = [];
try {
  for (const h of hostile) {
    let r;
    try { r = validateWorldZip(h.zip, opts); } catch (e) { assert.fail(h.id + ': the validator threw ' + String(e)); }
    assert.strictEqual(r.ok, false, h.id + ' must be refused');
    assert.strictEqual(r.reason, WHY[h.id], h.id + ' is refused for the wrong reason: ' + r.reason);
    assert.ok(r.reason && typeof r.reason === 'string', h.id + ' has a plain reason');
    assert.ok(!r.reason.includes(SECRET_MARKER), h.id + ': the reason repeats pack text');
    assert.strictEqual(r.manifest, undefined, h.id + ': a refused pack hands out no manifest');
    assert.deepStrictEqual(r.parts, [], h.id + ': a refused pack hands out no parts');
    for (const row of r.report) {
      assert.ok(row.part === 'world.json' || row.part.startsWith('(') || PART_NAMES.includes(row.part), h.id + ': report part is from the closed list: ' + row.part);
      assert.ok(!row.reason.includes(SECRET_MARKER) && !row.part.includes(SECRET_MARKER), h.id + ': report repeats pack text');
    }
    refusedBy.push(h.id);
  }
} finally {
  for (const [n, f] of saved) fsAny[n] = f;
}
assert.strictEqual(writeAttempts, 0, 'validation wrote nothing');
assert.strictEqual(refusedBy.length, hostile.length);
assert.deepStrictEqual(Object.keys(WHY).sort(), hostile.map((h) => h.id).sort(), 'every hostile package has a pinned reason');

// the whole-pack cap (10 MB by default; the per-part caps add up to far less, so it is tested with the cap lowered)
{
  const r = validateWorldZip(toStored(goodPack()), { ...opts, maxBytes: 1000 });
  assert.ok(!r.ok && r.reason === 'The pack is over 10 MB.', 'the whole-pack cap: ' + r.reason);
}


// limits are checked BEFORE work (FR-051, FR-081's order): a pack refused by name, count or declared size inflates nothing
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zl = require('zlib') as { inflateRawSync: (b: Buffer, o?: unknown) => Buffer };
  const real = zl.inflateRawSync; let inflated = 0;
  zl.inflateRawSync = (b, o) => { inflated++; return real(b, o); };
  try {
    const rnd = crypto.randomBytes(130 * 1024); // incompressible: the ratio rule does not apply, the part cap (120 KB) does
    const deflated = (extra: { name: string; data: Buffer }[]) => rawZip([...rawFrom(goodPack()).filter((e) => !extra.some((x) => x.name === e.name)).map((e) => ({ ...e, method: 8 })), ...extra.map((e) => ({ ...e, method: 8 }))]);
    const over = deflated([{ name: 'fx-library.webp', data: rnd }]);
    inflated = 0; const a = validateWorldZip(over, opts);
    assert.ok(!a.ok && /bigger than its limit/.test(a.reason) && inflated === 0, 'an over-cap part is refused from its declared size, nothing inflated (' + inflated + '): ' + a.reason);
    inflated = 0; const b = validateWorldZip(deflated([{ name: 'evil.js', data: Buffer.from('alert(1)'.repeat(10)) }]), opts);
    assert.ok(!b.ok && inflated === 0, 'a name off the list inflates nothing (' + inflated + ')');
    inflated = 0; const ok = validateWorldZip(deflated([]), opts);
    assert.ok(ok.ok && inflated > 20, 'the spy sees real inflation on a good deflated pack: ' + inflated);
  } finally { zl.inflateRawSync = real; }
}

// a folder: the same exact name twice must not be merged silently; the count is capped before any work
{
  const base = Object.keys(goodPack()).map((name) => ({ name, data: goodPack()[name] }));
  const dup = validateWorldFiles([...base, { name: 'wall.webp', data: goodPack()['wall.webp'] }], opts);
  assert.ok(!dup.ok && /same name/.test(dup.reason), 'the same name twice: ' + dup.reason);
  const many = validateWorldFiles(Array.from({ length: 41 }, (_, i) => ({ name: 'f' + i + '.webp', data: Buffer.alloc(1) })), opts);
  assert.ok(!many.ok && /too many files/.test(many.reason), 'too many files: ' + many.reason);
  const nm = validateWorldFiles([...base, { name: '../x', data: Buffer.from('x') }], opts); assert.ok(!nm.ok && /file name in the folder is not allowed/.test(nm.reason), 'a folder file with ../ is refused by name: ' + nm.reason);
  const sl = validateWorldFiles([...base, { name: 'a/b', data: Buffer.from('x') }], opts); assert.ok(!sl.ok && /file name in the folder is not allowed/.test(sl.reason), 'a slash: ' + sl.reason);
  const dt = validateWorldFiles([{ name: 'wall.webp', data: 'not bytes' as never }], opts); assert.ok(!dt.ok && /cannot be read/.test(dt.reason), 'data that is not bytes: ' + dt.reason);
  // what a person's OS leaves in a folder is ignored by exact name, as in a zip, and never read
  const withJunk = validateWorldFiles([...base, { name: '.DS_Store', data: Buffer.alloc(300, 0xff) }, { name: 'Thumbs.db', data: Buffer.from('not a database') }], opts);
  assert.ok(withJunk.ok && withJunk.parts.length === PART_NAMES.length, 'a folder with .DS_Store and Thumbs.db: ' + withJunk.reason);
  for (const bad of ['.ds_store', 'THUMBS.DB', '.DS_Store ', 'desktop.ini', '._wall.webp']) assert.ok(!validateWorldFiles([...base, { name: bad, data: Buffer.from('x') }], opts).ok, 'only the two exact names are ignored: ' + bad);
  assert.ok(validateWorldFiles([...base, ...Array.from({ length: 96 - base.length }, (_, i) => ({ name: i % 2 ? '.DS_Store' : 'Thumbs.db', data: Buffer.alloc(1) }))], opts).ok, 'ignored names count toward the 96 but 96 is allowed');
  assert.ok(!validateWorldFiles([...base, ...Array.from({ length: 97 - base.length }, () => ({ name: '.DS_Store', data: Buffer.alloc(1) }))], opts).ok, 'a 97th file is too many, ignored or not');
  { const nl = validateWorldFiles(null as never, opts); assert.ok(!nl.ok && /cannot be read/.test(nl.reason), 'not a list: ' + nl.reason); }
  assert.ok(!validateWorldFiles([] as never, opts).ok && !validateWorldFiles(null as never, opts).ok && !validateWorldFiles([{ name: 5, data: 1 }] as never, opts).ok, 'bad input shapes are refused, not thrown');
}

// an unfinished (not hostile) pack is accepted and says what is missing, FR-034
{
  const only = goodPack({}, ['wall.webp', 'floor.webp']);
  const r = validateWorldZip(toStored(only), opts);
  assert.ok(r.ok, 'a pack of two parts is valid but unfinished: ' + r.reason);
  assert.ok(r.unfinished.includes('first-run') && r.unfinished.includes('lobby') && r.unfinished.includes('answer-bar'), 'missing parts name their moments');
  assert.ok(r.report.some((x) => x.part === 'fx-library.webp' && x.ok && x.moments.includes('lobby')), 'the report names the moments a missing part affects');
}

console.log('OK: ' + hostile.length + ' hostile packages refused, the good pack accepted, no write attempted');
process.exitCode = 0;



