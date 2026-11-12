/**
 * skeleton() and nameKey() (spec 111 FR-012, FR-158, T032): a hand-written, closed, best-effort table. Its keys must EQUAL spec 003's
 * CYRL_LOOK and GREK_LOOK (read from src/renderer/lookalike.js, never copied here) and be a SUBSET of the LATIN_LOOK ranges; digit folds
 * (spec 109 FR-076) only when `digits` is on; code points without an entry are left as they are. `npm run test:skeleton`. No credits.
 * Every non-ASCII character is a \u escape.
 *
 * Mutants (must fail, by hand, 2026-11-11): delete one entry of CYRL_LOOK from SKELETON_MAP in src/shared/skeleton.ts (for example
 * `[0x430, 'a']`); "table keys equal CYRL_LOOK" then fails. Second (2026-11-12): in nameKey, lower-case BEFORE skeleton() (`.toLowerCase()` back in its argument); the capital Cyrillic and Greek checks then fail.
 * Third and fourth (2026-11-12, review of #1583): remove the second `mapLetters` pass (the U+0500, U+0423, U+2C6D, U+A7AC names fail); change
 * `/rn/g` to `/rn/` (`rnrn barn` fails). Five golden-table mutants: `[0x51d,'w']` -> 'v', `[0x29f,'L']` -> 'I', `[0x1d20,'V']` -> 'U', `[0x4cf,'l']` -> 'I',
 * and the entry `[0xab53,'x']` removed; the golden comparison fails for each. Sixth (2026-11-12): drop the final `.normalize('NFC')` after the digit folds (the idempotence counterexamples `1` + U+0301 and the like fail).
 * Ten mutants in all, each seen to fail. Combining marks are NOT removed by skeleton(), only composed.
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

// the whole table, checked against a hand-written golden list: one entry per row, so a changed letter, a lost row or an extra row fails
const GOLDEN: [number, string][] = [
  [0x430, 'a'], [0x441, 'c'], [0x435, 'e'], [0x4bb, 'h'], [0x456, 'i'], [0x458, 'j'],
  [0x43e, 'o'], [0x440, 'p'], [0x455, 's'], [0x443, 'y'], [0x445, 'x'], [0x501, 'd'],
  [0x51b, 'q'], [0x51d, 'w'], [0x4cf, 'l'], [0x410, 'A'], [0x412, 'B'], [0x415, 'E'],
  [0x41a, 'K'], [0x41c, 'M'], [0x41d, 'H'], [0x41e, 'O'], [0x420, 'P'], [0x421, 'C'],
  [0x422, 'T'], [0x425, 'X'], [0x405, 'S'], [0x406, 'I'], [0x408, 'J'], [0x4ae, 'Y'],
  [0x51a, 'Q'], [0x51c, 'W'], [0x4ba, 'H'], [0x4c0, 'I'], [0x3bf, 'o'], [0x3bd, 'v'],
  [0x3b1, 'a'], [0x3b9, 'i'], [0x3ba, 'k'], [0x3c5, 'u'], [0x3c1, 'p'], [0x391, 'A'],
  [0x392, 'B'], [0x395, 'E'], [0x396, 'Z'], [0x397, 'H'], [0x399, 'I'], [0x39a, 'K'],
  [0x39c, 'M'], [0x39d, 'N'], [0x39f, 'O'], [0x3a1, 'P'], [0x3a4, 'T'], [0x3a5, 'Y'],
  [0x3a7, 'X'], [0x131, 'i'], [0x237, 'j'], [0x1c0, 'l'], [0x251, 'a'], [0x261, 'g'],
  [0x262, 'G'], [0x269, 'i'], [0x26a, 'I'], [0x274, 'N'], [0x280, 'R'], [0x28f, 'Y'],
  [0x299, 'B'], [0x29c, 'H'], [0x29f, 'L'], [0x1d00, 'A'], [0x1d04, 'C'], [0x1d05, 'D'],
  [0x1d07, 'E'], [0x1d0a, 'J'], [0x1d0b, 'K'], [0x1d0d, 'M'], [0x1d0f, 'O'], [0x1d18, 'P'],
  [0x1d1b, 'T'], [0x1d1c, 'U'], [0x1d20, 'V'], [0x1d21, 'W'], [0x1d22, 'Z'], [0xa730, 'F'],
  [0xa731, 'S'], [0xa7ae, 'I'], [0xab53, 'x'],
];
eq(new Map(GOLDEN).size, GOLDEN.length, 'golden list has no duplicate key');
eq([...SKELETON_MAP.entries()].sort((a, b) => a[0] - b[0]), [...GOLDEN].sort((a, b) => a[0] - b[0]), 'the table equals the golden list, row by row');
for (const [cp, letter] of GOLDEN) eq(skeleton(String.fromCodePoint(cp)), letter.toLowerCase(), 'skeleton of U+' + cp.toString(16));

// the folds (letters, lower case, letters again)
eq(skeleton('p\u0430yp\u0430l'), 'paypal', 'Cyrillic a');
eq(skeleton('\u041d\u0435llo'), 'hello', 'Cyrillic capitals are lower-cased after the table');
eq(skeleton('\u039f\u03c1en'), 'open', 'Greek capitals');
eq(skeleton('\u03bf\u03bd\u03b1\u03b9\u03ba\u03c5\u03c1'), 'ovaikup', 'Greek lower case');
eq(skeleton('\u0131\u0237'), 'ij', 'dotless i and j');
eq(skeleton('\u1d00\u1d04\u1d0f'), 'aco', 'Phonetic Extensions small capitals');
eq(skeleton('\u0261'), 'g', 'IPA g');
// the second pass: capitals the table does not hold but whose lower case it does
eq(nameKey('\u0500og'), 'dog', 'U+0500 (capital of U+0501)');
eq(nameKey('\u0423es'), 'yes', 'Cyrillic capital U');
eq(nameKey('\u2c6dlex'), 'alex', 'Latin capital alpha');
eq(nameKey('\ua7acus'), 'gus', 'Latin capital script g');

// code points without an entry stay as they are
eq(skeleton('abc xyz 123 \u00e9\u4e2d\ud83d\ude00\u0432'), 'abc xyz 123 \u00e9\u4e2d\ud83d\ude00\u0432', 'no entry: unchanged (Cyrillic \u0432 is not on the list)');
eq(skeleton(''), '', 'empty');
eq(skeleton('\ud800x'), '\ud800x', 'a lone surrogate stays');
eq(skeleton('Te\u200bam'), 'te\u200bam', 'a zero-width character is left in place (not a sanitiser)');

// digit folds (spec 109 FR-076): only when `digits` is on
eq(skeleton('G1tHub'), 'g1thub', 'digits off: 1 stays');
eq(skeleton('Team 0 1 rn Ii', { digits: false }), 'team 0 1 rn ii', 'digits false: no 0, 1, rn or i fold');
eq(skeleton('G1tHub', { digits: true }), 'glthub', '1 -> l, case-insensitive');
eq(skeleton('R0bin', { digits: true }), 'robln', '0 -> o, i -> l');
eq(skeleton('0O', { digits: true }), 'oo', '0 and O fold together');
eq(skeleton('I1l', { digits: true }), 'lll', 'I, 1 and l fold together');
eq(skeleton('rn', { digits: true }), 'm', 'rn -> m');
eq(skeleton('rnrn barn', { digits: true }), 'mm bam', 'every rn, not only the first');
eq(skeleton('modern', { digits: true }), 'modem', 'rn -> m inside a word');
eq(skeleton('rn'), 'rn', 'rn kept with digits off');
eq(skeleton('\u0406\u0430', { digits: true }), 'la', 'letter and digit folds compose');

// marks compose (NFKD, then NFC)
eq(nameKey('Ren\u0435\u0301e'), nameKey('Ren\u00e9e'), 'Cyrillic e + acute equals Latin e-acute');
eq(nameKey('Zo\u0451'), nameKey('zo\u00eb'), 'Cyrillic yo equals Latin e-diaeresis');
eq(skeleton('\u04d3\u04e7\u0457\u0450\u03cc\u03ac\u03af\u03cd'), '\u00e4\u00f6\u00ef\u00e8\u00f3\u00e1\u00ed\u00fa', 'letters with marks map their base');
eq(nameKey('Tea\u041c\u0301'), nameKey('Tea\u1e3e'), 'Cyrillic capital M + acute equals Latin capital M-acute');

// nameKey: NFKC, trim, white space runs, then skeleton with the digit folds
eq(nameKey('  Re\u0301viewer \t One '), nameKey('R\u00e9viewer One'), 'NFD duplicate has the same key');
eq(nameKey('R\u00e9viewer   One'), 'r\u00e9vlewer one', 'white space, case and the digit folds (i -> l)');
ok(nameKey('Reviewer') === nameKey('R\u0435viewer'), 'a Cyrillic letter in an initial name has the same key');
ok(nameKey('Reviewer') === nameKey('\uff32eviewer'), 'a full-width capital too (NFKC)');
ok(nameKey('Reviewer 1') === nameKey('Reviewer l'), 'digit fold applies in nameKey');
ok(nameKey('Reviewer') !== nameKey('Reviewers'), 'different names differ');
eq(nameKey('\u0422eam'), nameKey('Team'), 'Cyrillic capital T');
eq(nameKey('\u041caya'), nameKey('Maya'), 'Cyrillic capital M');
eq(nameKey('\u039c\u0397\u039a'), nameKey('MHK'), 'Greek capitals M, H, K');
eq(nameKey('\u041d\u041a'), nameKey('hk'), 'Cyrillic capital H and K');
// known limit of toLowerCase (documented, FR-158)
ok(nameKey('Stra\u00dfe') !== nameKey('STRASSE'), 'known limit: sharp s is not unified with SS');

// nameKey is idempotent: every table key x combining marks x case x wrapper, a fixed list (no randomness)
{
  let bad = 0, total = 0;
  for (const cp of SKELETON_MAP.keys()) {
    const c = String.fromCodePoint(cp);
    for (const mark of ['', '\u0301', '\u0308', '\u0323', '\u0301\u0308']) {
      for (const v of [c, c.toUpperCase(), c.toLowerCase()]) {
        for (const wrap of ['x%sy', 'Rn%s1I', '%s']) {
          const k = nameKey(wrap.replace('%s', () => v + mark));
          total++;
          if (nameKey(k) !== k) bad++;
        }
      }
    }
  }
  // the reviewer's counterexamples: a digit that folds to a letter, then a combining mark (the final NFC composes them)
  for (const t of ['1\u0301', '0\u0301', '0\u0308', '0\u0307', '\ud835\udfd9\u0301']) {
    const k = nameKey(t);
    total++;
    if (nameKey(k) !== k) bad++;
    ok(k === k.normalize('NFC'), 'key of a digit with a mark is composed');
  }
  ok(total > 3000, 'idempotence samples: ' + total);
  eq(bad, 0, 'nameKey(nameKey(s)) equals nameKey(s) for every sample');
}


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
