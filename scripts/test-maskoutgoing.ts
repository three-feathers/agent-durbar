/**
 * Spec 084 T012 (FR-033, SC-002, issue 701): `maskOutgoing` is the secret check of a message to a contact. It shares one core with
 * spec 083's `maskNoteText`. Part of `npm run test:runtime-redact`. No credits; every token is built at run time (push protection).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assertLinearShape } from './redact-growth-lib';
import { HIDDEN_CHARS, NOTE_MARK, hiddenCanHide, maskKeepingMarkdownReference, maskNoteText, maskOutgoing, redact } from '../src/shared/redact';

// test-redact.ts's corpus (§3 `planted`), one sample per kind, with the part that must never survive
const CORPUS: Array<[string, string, string]> = [
  ['ghp', 'gh' + 'p_' + 'x'.repeat(36), ''],
  ['gho', 'gh' + 'o_' + 'Y'.repeat(30), ''],
  ['github_pat', 'github' + '_pat_' + '11ABCDEFG0abcdefghij_' + 'z'.repeat(30), ''],
  ['glpat', 'gl' + 'pat-' + 'a1B2c3D4e5_f6G7-h8I9j0K', ''],
  ['sk', 's' + 'k-' + 'a1B2'.repeat(10), ''],
  ['skant', 's' + 'k-ant-api03-' + 'Q9w8'.repeat(10), ''],
  ['bearer', 'Bear' + 'er ' + 'abcdef1234567890.token-value', 'abcdef1234567890'],
  ['jwt', 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTYifQ.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36', ''],
  ['aws', 'AK' + 'IA' + 'ABCDEFGH12345678', ''],
  ['authHeader', 'Authori' + 'zation: Basic ' + 'dXNlcjpw' + 'YXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
  ['urlCreds', 'https://alice:' + 'hunter2' + 'pass@example.invalid/repo.git', 'hunter2pass'],
];
const secretOf = (v: string, part: string): string => part || v.slice(-12);
// where a mark may split the value: inside its secret part (after the scheme word for the header kinds)
const splitAt = (v: string, part: string): number[] => {
  const from = part ? v.indexOf(part) : 0;
  const len = part ? part.length : v.length;
  return [from + 2, from + Math.floor(len / 2), from + len - 4].filter((i) => i > 0 && i < v.length);
};
const shapes = (v: string, part: string): string[] => {
  const out = [v, `**${v}**`, '`' + v + '`', `_${v}_`, `[${v}](https://example.invalid/x)`, '```\nexport T=' + v + '\n```', `> ${v}`, `x**${v}**`];
  for (const i of splitAt(v, part)) out.push(`${v.slice(0, i)}**${v.slice(i)}**`, v.slice(0, i) + '`' + v.slice(i) + '`', `**${v.slice(0, i)}**${v.slice(i)}`);
  return out;
};
const msg = (p: string): string => `Hi Alex Example,\n\nthe build log says ${p} and nothing else.\n\nThanks!`;
const texts: string[] = [];

// AC2: every kind, as written, inside Markdown and split by `**` or a backtick: changed, and no piece of the secret is left
for (const [name, v, part] of CORPUS) {
  for (const p of shapes(v, part)) {
    const t = msg(p);
    texts.push(t);
    const r = maskOutgoing(t);
    assert.strictEqual(r.changed, true, `${name}: changed for ${JSON.stringify(p)}`);
    const flat = r.text.replace(/[*`_]/g, '');
    assert.ok(!flat.includes(secretOf(v, part)), `${name}: secret gone from ${JSON.stringify(p)} (got ${JSON.stringify(r.text)})`);
    assert.ok(r.text.startsWith('Hi Alex Example,') && r.text.endsWith('Thanks!'), `${name}: the text around it is kept`);
    assert.ok(r.text.includes('[redacted'), `${name}: the mask shows`);
  }
}

// AC3: plain text gives `changed: false` and comes back as written
const PLAIN = [
  'Hi Alex, the release_notes and snake_case_name files are ready; see #701 and #1228.',
  'Mail alex.example@example.invalid or a_b@example.invalid, issue 42, PR #9 and v1.2.3.',
  '**Done**: `npm test` passes, _all_ of it. [the spec](https://example.invalid/specs/084)\n\n- one\n- two',
  'C:\\Users\\alex\\notes.md and /home/alex/notes.md, 2026-11-06T10:00:00Z.',
  'Ünïcödé, emoji 🎉 and 日本語 text with a long_identifier_name_here_ok.',
  '',
];
for (const t of PLAIN) {
  texts.push(t);
  assert.deepStrictEqual(maskOutgoing(t), { text: t, changed: false }, `plain text unchanged: ${JSON.stringify(t)}`);
}

// AC1: known values first (4 characters or more, longest first), then the shapes
const V1 = 'hunter2-' + 'plain-value';
const V2 = 'xyz-' + 'longer-secret-value';
assert.deepStrictEqual(maskOutgoing(`the pass is ${V1}.`, [V1]), { text: 'the pass is [redacted].', changed: true }, 'a known value without a shape');
assert.strictEqual(maskOutgoing(`the pass is ${V1}.`).changed, false, 'unknown, a plain word is not guessed');
assert.strictEqual(maskOutgoing('abcdefgh', ['abcd', 'abcdefgh']).text, '[redacted]', 'longest first: the longer value is not half masked');
assert.strictEqual(maskOutgoing('x abcd-efgh-ijkl y', ['abcd', 'abcd-efgh-ijkl']).text, 'x [redacted] y', 'longest first, short value given first');
assert.deepStrictEqual(maskOutgoing('abc stays', ['abc']), { text: 'abc stays', changed: false }, 'under 4 characters skipped');
assert.deepStrictEqual(maskOutgoing('text stays', ['', 'a', 'xyz']), { text: 'text stays', changed: false }, 'empty and short values skipped');
assert.strictEqual(maskOutgoing(`a ${V1} b ${V2} c ${V1}`, [V1, V2]).text, 'a [redacted] b [redacted] c [redacted]', 'every value, every time');
for (const split of ['hunter2-**plain**-value', 'hunter2-`plain-value`', '**hunter2-plain-value**']) {
  const r = maskOutgoing(`pass: ${split} end`, [V1]);
  assert.ok(r.changed && !/hunter2|plain/.test(r.text), `a known value split by Markdown: ${split} -> ${JSON.stringify(r.text)}`);
}
const both = maskOutgoing(`${V1} and ${CORPUS[0][1]}`, [V1]);
assert.ok(!both.text.includes(V1) && !both.text.includes('x'.repeat(12)), 'the shapes still run after the values');
// non-strings and a missing list never throw
assert.deepStrictEqual(maskOutgoing(undefined), { text: '', changed: false });
assert.deepStrictEqual(maskOutgoing(12345 as unknown as string), { text: '12345', changed: false });
assert.deepStrictEqual(maskOutgoing('fine', null as unknown as string[]), { text: 'fine', changed: false });

// Review of PR 1236 (2026-11-06): every code point that can sit invisibly inside a token, BMP and astral, walked one by one. A case
// leaks when the output with that character removed (what a viewer that drops it shows) still holds the token's tail or a piece of
// the known value. The sets come from the Unicode properties themselves, so a character the list missed cannot hide here.
const cps = (re: RegExp): number[] => { const out: number[] = []; for (let cp = 0; cp <= 0x10ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; if (re.test(String.fromCodePoint(cp))) out.push(cp); } return out; };
const CF = cps(/^\p{Cf}$/u);
const DI = cps(/^\p{Default_Ignorable_Code_Point}$/u);
const CC = cps(/^\p{Cc}$/u).filter((cp) => cp !== 9 && cp !== 10 && cp !== 13);
const ZS = cps(/^\p{Zs}$/u);
const NEAR_INVISIBLE = [0x2006, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f]; // six-per-em, punctuation, thin, hair, narrow no-break, medium math
assert.ok(CF.length >= 170 && DI.length >= 4174 && CC.length === 62 && ZS.length >= 17, `the property sets are complete (${CF.length} Cf, ${DI.length} DI, ${CC.length} Cc, ${ZS.length} Zs)`);
// review of PR 1236 (2026-11-07): characters that render as an empty glyph but are neither Cf nor default-ignorable, by name; a sweep of
// the Unicode names (BLANK, FILLER, NULL, INVISIBLE, EMPTY, SPACE, PLACEHOLDER outside Cf, Zs and Cc) found these; the others it found
// draw a visible glyph (spec 084 FR-033 [KNOWN GAP])
const BLANK_GLYPHS = [0x2800, 0x13441, 0x13442, 0x16fe4, 0x1d159]; // braille pattern blank, hieroglyph full and half blank, Khitan filler, null notehead
for (const cp of BLANK_GLYPHS) assert.ok(!/^[\p{Cf}\p{Default_Ignorable_Code_Point}]$/u.test(String.fromCodePoint(cp)), `U+${cp.toString(16)} is outside the property sets (so it is named)`);
const WALK = [...new Set([...CF, ...DI, ...CC, 0x2028, 0x2029, ...NEAR_INVISIBLE, ...BLANK_GLYPHS])].sort((a, b) => a - b);
const VAL = 'plain-' + 'known-' + 'value7';
const G = CORPUS[0][1];
const hex = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
let walked = 0;
for (const cp of WALK) {
  const c = String.fromCodePoint(cp);
  assert.ok(HIDDEN_CHARS.test(c), `${hex(cp)} is a hidden character`);
  for (const at of BLANK_GLYPHS.includes(cp) || (cp < 0x10000 && (CF.includes(cp) || CC.includes(cp) || cp < 0x3000)) ? [2, 9, 30] : [9]) { // three places in the BMP, one for the rest (time)
    const t = `Hi Alex, ${G.slice(0, at)}${c}${G.slice(at)} thanks`;
    const r = maskOutgoing(t);
    const seen = r.text.split(c).join('');
    assert.ok(r.changed && !seen.includes(G.slice(-12)) && !seen.includes(G.slice(at, at + 8)), `${hex(cp)} inside a token at ${at}: caught (${JSON.stringify(r.text)})`);
    walked++;
  }
  const r = maskOutgoing(`pass ${VAL.slice(0, 7)}${c}${VAL.slice(7)} end`, [VAL]);
  assert.ok(r.changed && !/plain-|known-|value7/.test(r.text.split(c).join('')), `${hex(cp)} inside a known value: caught (${JSON.stringify(r.text)})`);
  walked++;
}
if (texts.length < 2000) for (const cp of [0x00ad, 0x200b, 0x2060, 0xfe0f, 0xe0001, 0x1d173, 0xfff9, 0x0600]) texts.push(`Hi ${G.slice(0, 9)}${String.fromCodePoint(cp)}${G.slice(9)} ok`);
// tab, line feed and carriage return end a token or a line: neither hidden characters nor marks (a CRLF text costs as its LF one)
for (const c of ['\t', '\n', '\r', ' ']) assert.ok(!NOTE_MARK.test(c) && !HIDDEN_CHARS.test(c), `${JSON.stringify(c)} is neither a mark nor hidden`);
// [KNOWN GAP] (spec 084 FR-033): a visible space (every other \p{Zs}: U+0020, no-break, en and em spaces, figure, ideographic...) is a
// visible gap, so a token split by one is two words to the check; the person sees the gap in the preview
for (const cp of ZS.filter((x) => !NEAR_INVISIBLE.includes(x))) {
  assert.ok(!HIDDEN_CHARS.test(String.fromCodePoint(cp)), `${hex(cp)} (a visible space) is not hidden`);
  assert.strictEqual(maskOutgoing(`a ${G.slice(0, 12)}${String.fromCodePoint(cp)}${G.slice(12)} b`).text.includes(G.slice(-12)), true, `${hex(cp)}: the recorded gap (update the spec when it closes)`);
}
// real scripts and emoji keep their joiners: text with hidden characters and no secret comes back as written
for (const t of ['Line one\r\nline two with release_notes\r\n', 'Love it ❤\ufe0f and \u{1F468}\u200d\u{1F4BB}, see #701.', 'a\u00adb soft hyphen, \u200eltr mark, x\u2060y', 'Persian می\u200cخواهم, thin\u2009space, flag \u{1F3F4}\u{E0067}\u{E0062}\u{E007F}']) {
  texts.push(t);
  assert.deepStrictEqual(maskOutgoing(t), { text: t, changed: false }, `plain text with hidden characters unchanged: ${JSON.stringify(t)}`);
}
// the text around a caught token keeps its hidden characters as written
assert.strictEqual(maskOutgoing(`ok ❤\ufe0f then ${G.slice(0, 9)}\u200b${G.slice(9)} end`).text, 'ok ❤\ufe0f then [redacted] end', 'only the token is masked; the emoji stays');
// a hidden character that glues a token to the word before it in the copy: the text as written still finds it (union of both passes)
assert.ok(!maskOutgoing(`word\u200b${G} and ${CORPUS[4][1]}`).text.includes(G.slice(-12)), 'a token after a hidden character next to a word is masked');
// the AWS shape refuses a letter before it, so in the copy `wordAKIA…` is no key; the copy still finds the other token, and only the union
// with the text as written masks both
assert.strictEqual(maskOutgoing(`word\u200b${CORPUS[8][1]} and ${G}`).text, 'word\u200b[redacted] and [redacted]', 'the union of the copy and the text as written');
{
  const A = CORPUS[8][1];
  const out = maskOutgoing(`word\u200b${A.slice(0, 2)}**${A.slice(2)}** and ${G}`).text;
  assert.ok(!out.replace(/\*/g, '').includes(A.slice(-12)) && !out.includes(G.slice(-12)), `a split token only the text as written finds, beside one the copy finds: both masked (${JSON.stringify(out)})`);
}

// review of the PR 1236 batch, finding 3: astral hidden characters are two code units; the map from the copy back to the text counts both
assert.strictEqual(maskOutgoing('ok \u{E0001} ' + G.slice(0, 9) + '\u{E0020}' + G.slice(9) + ' end').text, 'ok \u{E0001} [redacted] end', 'an astral hidden character before and inside a token: exact output');
for (const [before, inside] of [['\u{13441}', '\u{1D159}'], ['\u{16FE4}', '\u{13442}'], ['\u2800', '\u{16FE4}'], ['\u{1D159}', '\u2800']]) {
  assert.strictEqual(maskOutgoing(`ok ${before} ` + G.slice(0, 9) + inside + G.slice(9) + ' end').text, `ok ${before} [redacted] end`, `a blank glyph before and inside a token: exact output (${JSON.stringify(before + inside)})`);
}
{
  const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const astral = ['\u{E0001}', '\u{E0020}', '\u{E007F}', '\u{1D173}', '\u{E0100}', '\u{13441}', '\u{13442}', '\u{16FE4}', '\u{1D159}', '\u2800', '\u{1F468}\u200d\u{1F4BB}', '❤\ufe0f', '\u{1F600}', '\u200b'];
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 2000; round++) {
    const parts: string[] = [];
    for (let i = 0, n = 2 + rnd(6); i < n; i++) {
      const pick = rnd(4);
      if (pick === 0) { const [, v] = CORPUS[rnd(CORPUS.length)]; const at = 2 + rnd(v.length - 3); parts.push(v.slice(0, at) + astral[rnd(astral.length)] + v.slice(at)); }
      else if (pick === 1) parts.push(astral[rnd(astral.length)]);
      else parts.push(['ok', 'abba', 'release_notes', 'x', '**b**'][rnd(5)]);
    }
    const text = parts.join(rnd(2) ? ' ' : '');
    const r = maskOutgoing(text, rnd(3) ? [] : [VAL]);
    assert.ok(!LONE.test(r.text), `no lone surrogate: ${JSON.stringify(text)} -> ${JSON.stringify(r.text)}`);
    // every character the output shows outside the masks is from the text, in order (nothing dropped or made up)
    const shown = r.text.split(/\[redacted(?::[^\]]*)?\]/);
    let pos = 0;
    for (const piece of shown) { const at = text.indexOf(piece, pos); assert.ok(at >= 0, `shown text is the text's own, in order: ${JSON.stringify(text)} -> ${JSON.stringify(r.text)}`); pos = at + piece.length; }
  }
}

// review of PR 1236, finding 4: a known value that overlaps a token hides no less than `redact` does (one union of spans)
assert.strictEqual(maskOutgoing(`x ${G} y`, ['gh' + 'p_']).text, 'x [redacted] y', 'a value at the start of a token');
{
  const GL = CORPUS[3][1];
  assert.strictEqual(maskOutgoing(`#701 Hi ${GL}`, ['701 Hi ' + GL.slice(0, 5)]).text, '#[redacted]', 'a value from the word before into a token');
}
{
  let seed = 1236;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let cases = 0;
  for (let round = 0; round < 3000; round++) {
    const [name, v, part] = CORPUS[rnd(CORPUS.length)];
    const secret = secretOf(v, part);
    const before = ['', 'see ', 'key=', 'x '][rnd(4)];
    const after = ['', ' now', '.', ' and more'][rnd(4)];
    let tok = v;
    const split = rnd(3);
    if (split) { const i = 2 + rnd(v.length - 3); tok = v.slice(0, i) + (split === 1 ? '**' : '`') + v.slice(i) + (split === 1 ? '**' : '`'); }
    const t = `Note: ${before}${tok}${after} end`;
    const a = rnd(t.length - 4);
    const value = t.slice(a, a + 4 + rnd(Math.min(24, t.length - a - 4) + 1));
    if (value.length < 4) continue;
    const r = maskOutgoing(t, [value]);
    const flat = r.text.replace(/[*`]/g, '');
    assert.ok(redact(t).replace(/[*`]/g, '') !== t.replace(/[*`]/g, '') || split, 'sanity: redact finds the token');
    for (let j = 0; j + 8 <= secret.length; j++) assert.ok(!flat.includes(secret.slice(j, j + 8)), `${name} with value ${JSON.stringify(value)} in ${JSON.stringify(t)}: hides what redact hides (got ${JSON.stringify(r.text)})`);
    assert.ok(!r.text.includes(value), `the value itself is masked: ${JSON.stringify(value)} in ${JSON.stringify(r.text)}`);
    cases++;
  }
  assert.ok(cases > 2500, `overlap cases run (${cases})`);
}

// review of PR 1236, finding 5: a token-like run followed (not preceded) by a mark, where the text without marks no longer matches
// the shape (a fixed-length key glued to capitals): only the run itself shows the shape
assert.ok(!maskOutgoing(`k ${CORPUS[8][1]}**WORDS**`).text.includes(CORPUS[8][1].slice(-12)), 'a run that touches a mark only after it is checked on its own');
// (checking only the mark before a run is an equivalent mutant now: a run is maximal, so the character before it is no run character,
// and `redact` on the text as written, whose spans join the union, sees the run with the mark after it as a boundary)
// a list that is not an array is no list: never a throw
for (const bad of ['abcd', { length: 1, 0: 'fine' }, 42, true]) assert.deepStrictEqual(maskOutgoing('fine abcd', bad as unknown as string[]), { text: 'fine abcd', changed: false }, `values ${JSON.stringify(bad)}: ignored`);

// review of T012: the 4-character boundary, and a value as long as the mask still counts as changed
assert.deepStrictEqual(maskOutgoing('pin abcd', ['abcd']), { text: 'pin [redacted]', changed: true }, 'a 4-character value is masked');
const TEN = 'q7' + 'w8e9r0t1';
assert.strictEqual(TEN.length, '[redacted]'.length, 'the value is as long as the mask');
assert.deepStrictEqual(maskOutgoing(`code ${TEN} ok`, [TEN]), { text: 'code [redacted] ok', changed: true }, 'a 10-character value: changed');

// AC4: one core: maskNoteText and maskOutgoing agree on the whole corpus, with and without known values
for (const t of texts) {
  for (const vals of [[], [V1, 'abcd'], ['abc', V2]]) {
    const t2 = vals.length ? `${t} ${V1} ${V2}` : t;
    assert.deepStrictEqual(maskOutgoing(t2, vals), maskNoteText(t2, vals), `same result: ${JSON.stringify(t2.slice(0, 60))}`);
  }
}

// issue 1234 (spec 095 T065): an inert hidden character (between two non-ASCII, non-space characters) skips the copy pass. Seeded
// differential fuzz against the reference (the masks as before: the copy pass always): what the new masks still show (the text without
// its masks and spaces) is a subsequence of what the reference shows, so nothing the reference hides can become readable; most are
// identical (the reference may hide a space or a neighbour more, never less). Tokens are cut by hidden characters of every class, alone, next to emoji, after long text.
{
  const savedEnv = { ...process.env }; // the fuzz does not depend on the machine: no secret-like variable (a space in one changed the rule)
  for (const k of Object.keys(process.env)) delete process.env[k];
  let seed = 0x1234b;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const hiddenAll: string[] = [];
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (HIDDEN_CHARS.test(ch) && (cp < 0x3000 || cp > 0xe0000 || cp % 7 === 0 || cp === 0xfe0f || cp === 0xfeff)) hiddenAll.push(ch);
  }
  const hidden = ['\u200d', '\u200b', '\ufe0f', '\u{e0041}', '\u00ad', '\u2060', '\u200c', ...hiddenAll.slice(0, 40), pick(hiddenAll)];
  const emoji = ['\u{1F600}', '\u{1F468}', '\u{1F4BB}', '\u2764', '\u26a0', '\u{1F3F4}', '\u{1F1E9}'];
  const letters = ['\u00e9', '\u00fc', '\u0436', '\u0915', '\u0937', '\u65e5', '\u672c', '\u03b1', '\u0627'];
  const wide = ['\uff21', '\uff47', '\uff48', '\uff50', '\uff3f', '\uff10', '\uff0a', '\uff40'];
  const combining = ['\u0301', '\u0308', '\u0338', '\u20e3', '\u064b'];
  const surrogate = ['\ud83d', '\ude00', '\udc68'];
  const spaces = [' ', ' ', '\n', '\t', '\u00a0', '\u3000', '\u2003'];
  const marks = ['**', '`', '~~', '[', ']', '\\', '_'];
  const tokens = CORPUS.map(([, v]) => v);
  const words = ['hello', 'release_notes', 'the build', 'password:', 'Bearer', 'invoice', 'a1B2c3', '2026-11-07'];
  const vals = [V1, V2, 'caf\u00e9-secret-99', 'plain-secret-abcd'];
  const piece = (): string => {
    const r = rnd();
    if (r < 0.2) { // a token cut once or twice by hidden characters, or marks
      const t = pick(tokens);
      const cut = (x: string): string => { const i = 1 + Math.floor(rnd() * (x.length - 1)); return x.slice(0, i) + pick(rnd() < 0.7 ? hidden : marks) + x.slice(i); };
      return rnd() < 0.3 ? cut(cut(t)) : cut(t);
    }
    if (r < 0.3) return pick(tokens);
    if (r < 0.42) return pick(emoji) + pick(hidden) + pick(emoji);
    if (r < 0.5) return pick(letters) + pick(hidden) + pick(letters);
    if (r < 0.56) return pick(wide) + pick(hidden) + pick(wide);
    if (r < 0.6) return pick(combining) + pick(hidden) + pick(letters);
    if (r < 0.64) return pick(surrogate) + pick(hidden) + pick(surrogate);
    if (r < 0.68) return pick(hidden);
    if (r < 0.74) return pick(marks);
    if (r < 0.8) return pick(emoji) + pick(['\ufe0f', '']) + pick(wide) + pick(letters);
    if (r < 0.86) return pick(vals).slice(0, 3 + Math.floor(rnd() * 8)) + pick(hidden) + pick(vals).slice(3);
    if (r < 0.9) return pick(vals);
    if (r < 0.96) return pick(words);
    return pick(letters) + pick(letters);
  };
  const shown = (x: string): string => x.split(/\[redacted(?::[^\]\r\n]{1,128})?\]/).join('').replace(/\s/g, '');
  const subseq = (small: string, big: string): boolean => { let j = 0; for (let i = 0; i < big.length && j < small.length; i++) if (big[i] === small[j]) j++; return j === small.length; };
  let same = 0;
  let gap = 0;
  const unhideText = (x: string): string => x.replace(new RegExp(HIDDEN_CHARS.source, 'gu'), '');
  const N = 32_000;
  let live = 0;
  let inert = 0;
  let masked = 0;
  for (let n = 0; n < N; n++) {
    let t = rnd() < 0.1 ? 'Some long plain words about nothing in particular. '.repeat(1 + Math.floor(rnd() * 40)) : '';
    for (let k = 1 + Math.floor(rnd() * 7); k > 0; k--) t += piece() + pick(spaces).repeat(rnd() < 0.5 ? 1 : 0);
    const values = rnd() < 0.4 ? [pick(vals), pick(vals)] : [];
    const a = maskOutgoing(t, values);
    const b = maskKeepingMarkdownReference(t, values);
    if (a.text === b.text) same++;
    assert.strictEqual(a.changed, b.changed, `fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
    // `redact` leaves a token glued to another token (`AKIA...sk-ant-...`) readable with no hidden character at all; the reference hid it
    // by accident, as its union of spans hides more than the copy found. That is not a hidden character's doing: tolerated only when the
    // text without them, masked as the reference does, shows what the new masks show (`gap`, counted and printed).
    const plain = unhideText(t);
    if (!subseq(shown(a.text), shown(b.text))) {
      assert.ok(plain !== t && subseq(unhideText(shown(a.text)), shown(maskKeepingMarkdownReference(plain, values).text)), `fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)} -> ${JSON.stringify(a.text)} (reference ${JSON.stringify(b.text)})`);
      gap++;
    }
    assert.deepStrictEqual(maskNoteText(t, values), a, `fuzz ${n}: maskNoteText too`);
    if (HIDDEN_CHARS.test(t)) { if (hiddenCanHide(t, values)) live++; else inert++; }
    if (b.changed) masked++;
  }
  assert.ok(inert >= 1000 && live >= 1000 && masked >= 3000, `the fuzz exercises both paths and masks (inert ${inert}, live ${live}, masked ${masked})`);
  // the rule itself
  assert.strictEqual(hiddenCanHide('ab'), false);
  assert.strictEqual(hiddenCanHide('\u{1F468}\u200d\u{1F4BB}'), false, 'a ZWJ sequence is inert');
  assert.strictEqual(hiddenCanHide('\u2764\ufe0f\u{1F600}'), false, 'a VS16 between two emoji is inert');
  assert.strictEqual(hiddenCanHide('\u2764\ufe0f x'), true, 'next to a space: live');
  assert.strictEqual(hiddenCanHide('gh\u200dp'), true, 'next to ASCII: live');
  assert.strictEqual(hiddenCanHide('\u200d\u00e9'), true, 'at the start: live');
  assert.strictEqual(hiddenCanHide('\u00e9\u200d'), true, 'at the end: live');
  assert.strictEqual(hiddenCanHide('\u00e9\u200d\u200b\u00e9'), false, 'a run of hidden characters between two letters: inert');
  assert.strictEqual(hiddenCanHide('\u00e9\u200d\u200bx'), true, 'a run with an ASCII end: live');
  assert.strictEqual(hiddenCanHide('\u00e9\u200d\u00e9', ['caf\u00e9']), true, 'a non-ASCII known value: live');
  assert.strictEqual(hiddenCanHide('\ud83d\u200d\ude00'), true, 'a surrogate half beside it: live');
  // the new guards (review of PR 1244): a long non-ASCII value after a secret name, and an env secret with a space
  {
    const long = 'password=' + '\u00e9'.repeat(64) + '\u200d' + '\u00e9'.repeat(64) + '1';
    assert.strictEqual(maskKeepingMarkdownReference(long, []).changed, true, 'the reference masks the 129-character value');
    assert.strictEqual(maskOutgoing(long, []).changed, true, 'maskOutgoing masks it too: a hidden character in a named value is live');
    assert.strictEqual(hiddenCanHide(long, [], {}), true, 'a secret name with a separator makes every hidden character live');
    assert.strictEqual(hiddenCanHide('\u00e9\u200d\u00e9', [], {}), false, 'no secret name: still inert');
    // seeded long-value fuzz: names, separators, values over 128 characters of non-ASCII letters, emoji, the hidden character anywhere, the digit anywhere
    const names = ['password', 'token', 'API_KEY', 'client_secret', 'Passwd', '"secret"', 'pass', 'auth_key'];
    const seps = ['=', ': ', ':=', '=>', '%3D', ' = '];
    const vbits = ['\u00e9', '\u0436', '\u65e5', '\u{1F600}', '\u03b1', 'a', 'Z'];
    for (let n = 0; n < 4000; n++) {
      let v = '';
      const len = 100 + Math.floor(rnd() * 100);
      const bit = pick(vbits);
      for (let k = 0; k < len; k++) v += rnd() < 0.9 ? bit : pick(vbits);
      const at = Math.floor(rnd() * v.length);
      v = v.slice(0, at) + pick(hidden) + v.slice(at);
      if (rnd() < 0.8) { const d = Math.floor(rnd() * v.length); v = v.slice(0, d) + String(Math.floor(rnd() * 10)) + v.slice(d); }
      const t = (rnd() < 0.3 ? 'note: ' : '') + pick(names) + pick(seps) + v + pick(['', ' tail', '\n']);
      const a = maskOutgoing(t, []);
      const b = maskKeepingMarkdownReference(t, []);
      assert.strictEqual(a.changed, b.changed, `long fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
      assert.ok(subseq(shown(a.text), shown(b.text)), `long fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)}`);
    }
    // the independent audit of PR 1244: bounded windows over non-ASCII classes in the other rule families (one repro per `LIVE_HEAD` alternative)
    const Z = '\u200d';
    const pad = (n: number): string => ('\u00e9' + Z).repeat(n) + '\u00e9';
    const PW = 'Hunter2' + 'pass99';
    const audit: Record<string, string> = {
      netrc_host: `machine ${pad(130)} login bob password ${PW}`,
      netrc_login: `machine example.org login ${pad(70)} password ${PW}`,
      curl_window: `curl "${pad(110)}" -u bob:${PW} https://x.test`,
      curl_user: `curl -u ${pad(70)}:${PW} https://x.test`,
      curl_window_nourl: `curl "${pad(110)}" -u bob:${PW}`,
      curl_user_nourl: `curl -u ${pad(70)}:${PW}`,
      url_user: `https://${pad(110)}:${PW}@x.test/`,
      url_pass: `https://bob:${pad(110)}@x.test/`,
      json_cookie: `{"Cookie": "${pad(70)}=${PW}"}`,
      cookie_hdr: `Cookie: ${pad(70)}=${PW}`,
    };
    for (const [k, t] of Object.entries(audit)) {
      const a = maskOutgoing(t, []);
      const b = maskKeepingMarkdownReference(t, []);
      assert.strictEqual(a.changed, b.changed, `audit ${k}: changed as the reference`);
      assert.ok(subseq(shown(a.text), shown(b.text)), `audit ${k}: nothing the reference hides is shown`);
      assert.strictEqual(hiddenCanHide(t, [], {}), true, `audit ${k}: LIVE_HEAD makes the hidden characters live`);
    }
    // seeded structural templates: a non-ASCII run (with joiners) in the host, user, cookie name or curl argument, all window sizes
    const run = (): string => { const n = 20 + Math.floor(rnd() * 150); let r = 'x'; for (let k = 0; k < n; k++) r += pick(['\u00e9', '\u0436', '\u65e5']) + (rnd() < 0.5 ? pick(hidden) : ''); return r; };
    const tpl: Array<() => string> = [
      () => `machine ${run()} login bob password ${PW}`,
      () => `machine example.org login ${run()} password ${PW}`,
      () => `curl "${run()}" -u bob:${PW} https://x.test`,
      () => `curl -u ${run()}:${PW} https://x.test`,
      () => `curl -u ${run()}:${PW}`,
      () => `curl "${run()}" -u bob:${PW}`,
      () => `https://${run()}:${PW}@x.test/`,
      () => `https://bob:${run()}@x.test/`,
      () => `{"Cookie": "${run()}=${PW}"}`,
      () => `Cookie: ${run()}=${PW}`,
      () => `Set-Cookie: ${run()}=${PW}; Path=/`,
    ];
    for (let n = 0; n < 3000; n++) {
      const t = pick(tpl)();
      const a = maskOutgoing(t, []);
      const b = maskKeepingMarkdownReference(t, []);
      assert.strictEqual(a.changed, b.changed, `template fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
      assert.ok(subseq(shown(a.text), shown(b.text)), `template fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)}`);
    }
    // an env secret with a space (VS Code sets GIT_ASKPASS to such a path on macOS and Windows) leaves the rule as with none
    for (const e of [{ GIT_ASKPASS: '/a b/askpass.sh' }, { API_TOKEN: 'my secret value 12' }, { GIT_ASKPASS: '/Users/a b/Library/askpass.sh', VSCODE_GIT_ASKPASS_NODE: 'C:\\Program Files\\Code\\Code.exe' }]) {
      for (const t of ['\u2764\ufe0f\u{1F600}', '\u00e9\u200d\u00e9', 'gh\u200dp', '\u00e9\u200d x']) {
        assert.strictEqual(hiddenCanHide(t, [], e), hiddenCanHide(t, [], {}), `env ${Object.keys(e)[0]} with a space: same rule for ${JSON.stringify(t)}`);
      }
      const saved = { ...process.env };
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, e);
      try {
        const t = '\u00e9\u200d\u00e9 ' + Object.values(e)[0] + ' \u{1F600}\u200d\u{1F600}';
        const a = maskOutgoing(t, []);
        const b = maskKeepingMarkdownReference(t, []);
        assert.ok(a.changed && b.changed && subseq(shown(a.text), shown(b.text)) && !a.text.includes(Object.values(e)[0]), 'a space-valued env secret: masked, nothing the reference hides is shown');
      } finally {
        for (const k of Object.keys(process.env)) delete process.env[k];
        Object.assign(process.env, saved);
      }
    }
  }
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  console.log(`mask outgoing fuzz: ${N} texts, none shows what the reference hides except ${gap} glued-token gaps the hidden-free text has too (${same} identical, inert ${inert}, live ${live}, masked ${masked})`);
}

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'redact.ts'), 'utf8');
assert.ok(!/^\s*import\s/m.test(src) && !/\brequire\(/.test(src), 'redact.ts still has no imports');
const body = (name: string): string => (src.match(new RegExp(`export function ${name}\\([^]*?\\r?\\n}\\r?\\n`)) ?? [''])[0];
assert.match(body('maskOutgoing'), /return maskKeepingMarkdown\(/, 'maskOutgoing delegates to the shared core');
assert.match(body('maskNoteText'), /return maskKeepingMarkdown\(/, 'maskNoteText delegates to the shared core');

// linear time on big input (CPU time, docs/agent-notes.md "Timing checks"); a 200k message stays well under a second
const unit = 'Hi **Alex**, see `code` and [a link](https://example.invalid/a); ' + CORPUS[0][1] + ' and release_notes.\n';
assertLinearShape('outgoing text', (x) => void maskOutgoing(x, [V1]), (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n), 200_000);

console.log(`mask outgoing: ${walked} hidden-character cases over ${WALK.length} code points, ${texts.length} texts, every corpus kind in Markdown and split, plain text unchanged, known values, one core with maskNoteText, linear`);
