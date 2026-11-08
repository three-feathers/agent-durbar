/**
 * Spec 084 T012 (FR-033, SC-002, issue 701): `maskOutgoing` is the secret check of a message to a contact. It shares one core with
 * spec 083's `maskNoteText`. Part of `npm run test:runtime-redact`. No credits; every token is built at run time (push protection).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assertLinearShape } from './redact-growth-lib';
import { HIDDEN_CHARS, NOTE_MARK, hiddenCanHide, maskKeepingMarkdownReference, maskNoteText, maskOutgoing, redact } from '../src/shared/redact';

import { CORPUS, V1, V2 } from './maskoutgoing-corpus';
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

// the rule itself (spec 095 T065)
{
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
}
// review of PR 1244, item 1: Markdown marks inside a rule head. `maskCore` also masks the text without its marks, where `pass**word**=` is
// `password=`; the head is read there too, so the hidden character is live and the password does not show.
{
  const Z = '\u200d';
  const pw = 'Hunter2' + 'pass99';
  const e = '\u00e9';
  const repros: Record<string, string> = {
    url_marks: 'https:**//**' + (e + Z).repeat(110) + e + ':' + pw + '@x.test/',
    password_bold: '**Password**: ' + e.repeat(64) + Z + e.repeat(64) + '1',
    pass_word: 'pass**word**=' + (e + Z).repeat(70) + '1',
    pass_tick: 'pass`word`=' + (e + Z).repeat(70) + '1',
    api_key: 'api\\_key=' + (e + Z).repeat(70) + '1',
    eq_bold: 'password**=**' + (e + Z).repeat(70) + '1',
    cookie_marks: 'Coo**kie**: ' + (e + Z).repeat(70) + '=' + pw,
    cookie_json: '{"Coo**kie**": "' + (e + Z).repeat(70) + '=' + pw + '"}',
    machine_marks: 'mach**ine** ' + (e + Z).repeat(130) + ' login bob password ' + pw,
  };
  for (const [k, t] of Object.entries(repros)) {
    const a = maskOutgoing(t, []);
    assert.strictEqual(a.changed, true, `marks ${k}: masked`);
    assert.strictEqual(maskKeepingMarkdownReference(t, []).changed, true, `marks ${k}: the reference masks it`);
    assert.ok(!a.text.includes(pw), `marks ${k}: the password is gone`);
    assert.strictEqual(hiddenCanHide(t, [], {}), true, `marks ${k}: the head read without marks makes the hidden characters live`);
  }
  // review of PR 1244, item 3: a space beside a hidden run is not an inert neighbour (M09), and a non-ASCII environment secret split by a
  // hidden character is live (M13); both would mask less than the reference
  const sp = '\u3000';
  const m09 = 'Bearer' + sp.repeat(4) + Z + sp.repeat(4) + 'abcdef1234567890xyz';
  assert.strictEqual(hiddenCanHide(m09, [], {}), true, 'M09: a space beside a hidden run is live');
  assert.strictEqual(hiddenCanHide(e + Z + ' ' + e, [], {}), true, 'M09: an ASCII space beside a hidden run is live');
  assert.strictEqual(hiddenCanHide(sp + Z + e, [], {}), true, 'M09: U+3000 on one side is live');
  assert.strictEqual(maskOutgoing(m09, []).changed, maskKeepingMarkdownReference(m09, []).changed, 'M09: changed as the reference');
  const secret = 'ab\u65e5\u672ccdS3cretV4lue9';
  const split = 'note ' + secret.slice(0, 3) + Z + secret.slice(3) + ' end';
  assert.strictEqual(hiddenCanHide(split, [], { MY_SECRET: secret }), true, 'M13: a non-ASCII environment secret makes every hidden character live');
  assert.strictEqual(hiddenCanHide(split, [], { MY_SECRET: 'plainsecretvalue99' }), false, 'M13: an ASCII environment secret does not');
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  process.env.MY_SECRET = secret;
  try {
    const a = maskOutgoing(split, []);
    assert.strictEqual(a.changed, true, 'M13: the split environment secret is masked');
    assert.ok(!a.text.includes('S3cretV4lue9'), 'M13: no piece of it is left');
    assert.strictEqual(maskKeepingMarkdownReference(split, []).changed, true, 'M13: the reference masks it');
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}
// the differential and long-value fuzz, the audit repros and the template fuzz: `scripts/test-maskoutgoing-fuzz.ts` (own suite, FR-048b)

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'redact.ts'), 'utf8');
assert.ok(!/^\s*import\s/m.test(src) && !/\brequire\(/.test(src), 'redact.ts still has no imports');
const body = (name: string): string => (src.match(new RegExp(`export function ${name}\\([^]*?\\r?\\n}\\r?\\n`)) ?? [''])[0];
assert.match(body('maskOutgoing'), /return maskKeepingMarkdown\(/, 'maskOutgoing delegates to the shared core');
assert.match(body('maskNoteText'), /return maskKeepingMarkdown\(/, 'maskNoteText delegates to the shared core');

// linear time on big input (CPU time, docs/agent-notes.md "Timing checks"); a 200k message stays well under a second
const unit = 'Hi **Alex**, see `code` and [a link](https://example.invalid/a); ' + CORPUS[0][1] + ' and release_notes.\n';
assertLinearShape('outgoing text', (x) => void maskOutgoing(x, [V1]), (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n), 200_000);

console.log(`mask outgoing: ${walked} hidden-character cases over ${WALK.length} code points, ${texts.length} texts, every corpus kind in Markdown and split, plain text unchanged, known values, one core with maskNoteText, linear`);
