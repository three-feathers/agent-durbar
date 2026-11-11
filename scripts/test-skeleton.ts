/**
 * skeleton() and nameKey() (spec 111 FR-012, FR-158, T032): a hand-written, closed, best-effort table. Its keys must EQUAL spec 003's
 * CYRL_LOOK and GREK_LOOK (read from src/renderer/lookalike.js, never copied here) and be a SUBSET of the LATIN_LOOK ranges; digit folds
 * (spec 109 FR-076) only when `digits` is on; code points without an entry are left as they are. `npm run test:skeleton`. No credits.
 * Every non-ASCII character is a \u escape.
 *
 * Mutants (must fail, by hand, 2026-11-11): delete one entry of CYRL_LOOK from SKELETON_MAP in src/shared/skeleton.ts (for example
 * `[0x430, 'a']`); "table keys equal CYRL_LOOK" then fails. Second (2026-11-12): in nameKey, lower-case BEFORE skeleton() (`.toLowerCase()` back in its argument);
 * the capital Cyrillic and Greek checks then fail.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { SKELETON_MAP, nameKey, skeleton } from '../src/shared/skeleton';

let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };

// the real lists, read from the source text (lookalike.js does not export them)
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'lookalike.js'), 'utf8');
const setOf = (name: string): number[] => {
  const m = new RegExp('const ' + name + '=new Set\\(\\[([^\\]]*)\\]\\)').exec(src);
  assert.ok(m, name + ' found in lookalike.js');
  return m![1].split(',').map((s) => parseInt(s.trim(), 16)).sort((a, b) => a - b);
};
/** LATIN_LOOK as numeric ranges, parsed by hand (no eval): `cp===0x..` and `(cp>=0x..&&cp<=0x..)` joined by `||`; tolerates CRLF. */
const parseLatinLook = (text: string): ((cp: number) => boolean) => {
  const m = /const LATIN_LOOK=cp=>([^;\r\n]*);/.exec(text);
  if (!m) throw new Error('LATIN_LOOK not found: revisar el parser de test-skeleton.ts');
  const ranges: [number, number][] = [];
  const rest = m[1].replace(/\(cp>=0x([0-9a-f]+)&&cp<=0x([0-9a-f]+)\)/g, (_a, lo, hi) => { ranges.push([parseInt(lo, 16), parseInt(hi, 16)]); return ''; })
    .replace(/cp===0x([0-9a-f]+)/g, (_a, v) => { ranges.push([parseInt(v, 16), parseInt(v, 16)]); return ''; });
  if (rest.replace(/\|\|/g, '') !== '' || ranges.length < 5) throw new Error('LATIN_LOOK changed format: revisar el parser de test-skeleton.ts');
  return (cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
};
const latinLook = parseLatinLook(src);
const crlf = parseLatinLook(src.replace(/\n/g, '\r\n'));
for (const cp of [0x131, 0x1c1, 0x250, 0x1d00, 0xa7ff, 0xab6f]) ok(latinLook(cp) && crlf(cp), 'parsed LATIN_LOOK holds U+' + cp.toString(16) + ' (LF and CRLF)');
for (const cp of [0x41, 0x130, 0x2b0, 0xab70]) ok(!latinLook(cp) && !crlf(cp), 'parsed LATIN_LOOK leaves out U+' + cp.toString(16));
assert.throws(() => parseLatinLook('const LATIN_LOOK=cp=>cp===0x1&&foo();'), /revisar el parser/);
const cyrl = setOf('CYRL_LOOK'), grek = setOf('GREK_LOOK');
ok(cyrl.length >= 30 && grek.length >= 20, 'the lists were read');

const keys = [...SKELETON_MAP.keys()];
const inCyrl = (cp: number) => cp >= 0x400 && cp <= 0x52f;
const inGrek = (cp: number) => cp >= 0x370 && cp <= 0x3ff;
eq(keys.filter(inCyrl).sort((a, b) => a - b), cyrl, 'table keys equal CYRL_LOOK');
eq(keys.filter(inGrek).sort((a, b) => a - b), grek, 'table keys equal GREK_LOOK');
const rest = keys.filter((k) => !inCyrl(k) && !inGrek(k));
ok(rest.length > 20, 'a real part of LATIN_LOOK is mapped');
ok(rest.every(latinLook), 'the other keys are a subset of LATIN_LOOK');
ok(keys.every((k) => /^[A-Za-z]$/.test(SKELETON_MAP.get(k)!)), 'every value is one Latin letter');

// the folds
eq(skeleton('p\u0430yp\u0430l'), 'paypal', 'Cyrillic a');
eq(skeleton('\u041d\u0435llo'), 'Hello', 'Cyrillic capitals keep their case');
eq(skeleton('\u039f\u03c1en'), 'Open', 'Greek capitals');
eq(skeleton('\u03bf\u03bd\u03b1\u03b9\u03ba\u03c5\u03c1'), 'ovaikup', 'Greek lower case');
eq(skeleton('\u0131\u0237'), 'ij', 'dotless i and j');
eq(skeleton('\u1d00\u1d04\u1d0f'), 'ACO', 'Phonetic Extensions small capitals');
eq(skeleton('\u0261'), 'g', 'IPA g');

// code points without an entry stay as they are
eq(skeleton('abc XYZ 123 \u00e9\u4e2d\ud83d\ude00\u0432'), 'abc XYZ 123 \u00e9\u4e2d\ud83d\ude00\u0432', 'no entry: unchanged (Cyrillic \u0432 is not on the list)');
eq(skeleton(''), '', 'empty');
eq(skeleton('\ud800x'), '\ud800x', 'a lone surrogate stays');

// digit folds (spec 109 FR-076): only when `digits` is on
eq(skeleton('G1tHub'), 'G1tHub', 'digits off: 1 stays');
eq(skeleton('G1tHub', { digits: false }), 'G1tHub', 'digits false');
eq(skeleton('G1tHub', { digits: true }), 'glthub', '1 -> l, case-insensitive');
eq(skeleton('R0bin', { digits: true }), 'robln', '0 -> o, i -> l');
eq(skeleton('0O', { digits: true }), 'oo', '0 and O fold together');
eq(skeleton('I1l', { digits: true }), 'lll', 'I, 1 and l fold together');
eq(skeleton('rn', { digits: true }), 'm', 'rn -> m');
eq(skeleton('modern', { digits: true }), 'modem', 'rn -> m inside a word');
eq(skeleton('rn'), 'rn', 'rn kept with digits off');
eq(skeleton('\u0406\u0430', { digits: true }), 'la', 'letter and digit folds compose');

// nameKey: NFKC, trim, white space runs, case, skeleton with the digit folds
eq(nameKey('  Re\u0301viewer \t One '), nameKey('R\u00e9viewer One'), 'NFD duplicate has the same key');
eq(nameKey('R\u00e9viewer   One'), 'r\u00e9vlewer one', 'white space, case and the digit folds (i -> l)');
ok(nameKey('Reviewer') === nameKey('R\u0435viewer'), 'a Cyrillic letter in an initial name has the same key');
ok(nameKey('Reviewer') === nameKey('\uff32eviewer'), 'a full-width capital too (NFKC)');
ok(nameKey('Reviewer 1') === nameKey('Reviewer l'), 'digit fold applies in nameKey');
ok(nameKey('Reviewer') !== nameKey('Reviewers'), 'different names differ');

// 2026-11-12: the table runs before case is folded, so capitals of the lists match their Latin twin
eq(nameKey('\u0422eam'), nameKey('Team'), 'Cyrillic capital T');
eq(nameKey('\u041caya'), nameKey('Maya'), 'Cyrillic capital M');
eq(nameKey('\u039c\u0397\u039a'), nameKey('MHK'), 'Greek capitals M, H, K');
eq(nameKey('\u041d\u041a'), nameKey('hk'), 'Cyrillic capital N-shape and K');
// known limit of toLowerCase (documented, FR-158)
ok(nameKey('Stra\u00dfe') !== nameKey('STRASSE'), 'known limit: sharp s is not unified with SS');
// digits off: capitals kept, no digit folds
eq(skeleton('Team 0 1 rn', { digits: false }), 'Team 0 1 rn', 'digits false keeps capitals, 0, 1 and rn');
eq(skeleton('\u0422eam 01'), 'Team 01', 'digits off: mapped capital stays a capital');

// big input stays fast (loose bound)
{
  const big = '\u0430b1rn '.repeat(40000);
  const t = Date.now();
  const out = skeleton(big, { digits: true });
  ok(out.length > 0 && Date.now() - t < 2000, 'a 200,000 character name is folded in under 2 s');
  const t2 = Date.now();
  nameKey(big);
  ok(Date.now() - t2 < 2000, 'nameKey on 200,000 characters under 2 s');
}

console.log('test-skeleton: ' + n + ' checks passed');
