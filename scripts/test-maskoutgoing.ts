/**
 * Spec 084 T012 (FR-033, SC-002, issue 701): `maskOutgoing` is the secret check of a message to a contact. It shares one core with
 * spec 083's `maskNoteText`. Part of `npm run test:runtime-redact`. No credits; every token is built at run time (push protection).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assertLinearShape } from './redact-growth-lib';
import { NOTE_MARK, maskNoteText, maskOutgoing } from '../src/shared/redact';

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

// review of T012 (2026-11-06): a control or an invisible format character inside a token or a known value is a split mark too, so a
// viewer that drops it cannot show a secret the check missed; tab, line feed and carriage return are not marks (they end a token or a line)
const INVISIBLE: Array<[string, string]> = [
  ['U+0001', '\u0001'], ['U+001B', '\u001b'], ['U+000C', '\u000c'], ['U+007F', '\u007f'], ['U+0085', '\u0085'], ['U+00AD', '\u00ad'],
  ['U+034F', '\u034f'], ['U+061C', '\u061c'], ['U+115F', '\u115f'], ['U+17B4', '\u17b4'], ['U+180E', '\u180e'], ['U+200B', '\u200b'],
  ['U+200E', '\u200e'], ['U+200F', '\u200f'], ['U+202A', '\u202a'], ['U+202E', '\u202e'], ['U+2060', '\u2060'], ['U+2064', '\u2064'],
  ['U+2066', '\u2066'], ['U+2069', '\u2069'], ['U+3164', '\u3164'], ['U+1160', '\u1160'], ['U+FEFF', '\ufeff'], ['U+FFA0', '\uffa0'],
];
const VAL = 'plain-' + 'known-' + 'value7';
for (const [cp, c] of INVISIBLE) {
  for (const [name, v, part] of CORPUS) {
    for (const i of splitAt(v, part)) {
      const t = msg(v.slice(0, i) + c + v.slice(i));
      texts.push(t);
      const r = maskOutgoing(t);
      assert.strictEqual(r.changed, true, `${name} split by ${cp} at ${i}: changed`);
      assert.ok(!r.text.split(c).join('').includes(secretOf(v, part)), `${name} split by ${cp}: secret gone (${JSON.stringify(r.text)})`);
    }
  }
  const kv = msg(VAL.slice(0, 7) + c + VAL.slice(7));
  texts.push(kv);
  const r = maskOutgoing(kv, [VAL]);
  assert.strictEqual(r.changed, true, `known value split by ${cp}: changed`);
  assert.ok(!/plain-|known-|value7/.test(r.text), `known value split by ${cp}: no piece left (${JSON.stringify(r.text)})`);
}
for (const c of ['\t', '\n', '\r', ' ']) assert.ok(!NOTE_MARK.test(c), `${JSON.stringify(c)} is not a split mark`);
for (const t of ['Line one\r\nline two with release_notes\r\n', 'Love it ❤\ufe0f and 👨\u200d💻, see #701.', 'a\u00adb soft hyphen, \u200eltr mark, x\u2060y']) {
  texts.push(t);
  assert.deepStrictEqual(maskOutgoing(t), { text: t, changed: false }, `plain text with invisible characters unchanged: ${JSON.stringify(t)}`);
}
// [KNOWN GAP] (spec 084 FR-033, decided 2026-11-06): the variation selectors are not marks (U+FE0F is in common emoji, and a mark makes
// `maskWork` price the whole message as marked), so a token or a known value split by one is not found; update the spec when it closes
{
  const g = CORPUS[0][1];
  for (const c of ['\ufe00', '\ufe0f']) {
    assert.ok(!NOTE_MARK.test(c), `${JSON.stringify(c)} is not a split mark`);
    assert.strictEqual(maskOutgoing(`a ${g.slice(0, 10)}${c}${g.slice(10)} b`).changed, false, 'variation selectors: the recorded gap (token)');
    assert.strictEqual(maskOutgoing(`a ${VAL.slice(0, 7)}${c}${VAL.slice(7)} b`, [VAL]).changed, false, 'variation selectors: the recorded gap (known value)');
  }
}
// [KNOWN GAP] (spec 084 FR-033): astral tag characters are two code units and not in NOTE_MARK, so a token split by one is not found
{
  const g = CORPUS[0][1];
  assert.strictEqual(maskOutgoing(`a ${g.slice(0, 10)}\udb40\udc01${g.slice(10)} b`).changed, false, 'astral tag characters: the recorded gap (update the spec when it closes)');
}
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
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'redact.ts'), 'utf8');
assert.ok(!/^\s*import\s/m.test(src) && !/\brequire\(/.test(src), 'redact.ts still has no imports');
const body = (name: string): string => (src.match(new RegExp(`export function ${name}\\([^]*?\\n}\\n`)) ?? [''])[0];
assert.match(body('maskOutgoing'), /return maskKeepingMarkdown\(/, 'maskOutgoing delegates to the shared core');
assert.match(body('maskNoteText'), /return maskKeepingMarkdown\(/, 'maskNoteText delegates to the shared core');

// linear time on big input (CPU time, docs/agent-notes.md "Timing checks"); a 200k message stays well under a second
const unit = 'Hi **Alex**, see `code` and [a link](https://example.invalid/a); ' + CORPUS[0][1] + ' and release_notes.\n';
assertLinearShape('outgoing text', (x) => void maskOutgoing(x, [V1]), (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n), 200_000);

console.log(`mask outgoing: ${texts.length} texts, every corpus kind in Markdown and split, plain text unchanged, known values, one core with maskNoteText, linear`);
