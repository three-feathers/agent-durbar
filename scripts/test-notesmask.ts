/** Spec 083 T011 (FR-005, D3, SC-002, issue 699): `maskNoteText` masks a note's text and keeps its Markdown. `npm run test:notes`. No credits; every token is built at run time. */
import * as assert from 'assert';
import { CUT_LINE, NOTES_LIMITS, fitText } from '../src/shared/notes';
import { maskNoteText } from '../src/shared/redact';

// fake secrets, built at run time (push protection)
const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const SK = 'sk-' + 'ant-' + 'api03-Zx9Yw8Vv7Uu6Tt5Ss4Rr3Qq2Pp1';
const JWT = 'ey' + 'J' + 'hbGciOiJIUzI1NiJ9.' + 'ey' + 'J' + 'zdWIiOiIxMjM0NTY3ODkwIn0.' + 'dBjftJeZ4CVPmB92K27uhbUJU1p1r';
const AWS = 'AK' + 'IA' + 'IOSFODNN7EXAMPLE';
const BEARER = 'Bear' + 'er ' + 'abcdef0123456789ABCDEF.xyz';
const body = (t: string): string => t.slice(6, 6 + 14); // a piece of the token's body: it must never survive
const leaks = (out: string, tok: string): boolean => out.includes(body(tok)) || out.includes(tok.slice(-12));
const M = (t: string, v: string[] = []): string => maskNoteText(t, v).text;

// AC1: every shape, planted as written and inside Markdown
for (const [name, tok] of [['github', GH], ['anthropic', SK], ['jwt', JWT], ['aws', AWS]] as const) {
  const planted = [
    tok, `**${tok}**`, `\`${tok}\``, `*${tok}*`, `~~${tok}~~`, `[${tok}](https://example.org/x)`, `[label](${tok})`,
    '```\nexport T=' + tok + '\n```', `# ${tok}`, `- item ${tok}`, `> ${tok}`, `token%3D${tok}`, `line one\\n${tok}\\nline two`, `x**${tok}**`, `_${tok}_`, `\\${tok.slice(0, 4)}${tok.slice(4)}`,
  ];
  for (const p of planted) {
    const out = M('Before.\n\n' + p + '\n\nAfter.');
    assert.ok(!leaks(out, tok), `${name}: masked in ${JSON.stringify(p.slice(0, 40))} (got ${JSON.stringify(out.slice(0, 120))})`);
    assert.ok(out.startsWith('Before.') && out.endsWith('After.'), `${name}: the text around it is kept`);
  }
}
assert.ok(!M(BEARER).includes('abcdef0123456789'), 'a Bearer value is masked');
assert.ok(!M('Authorization: ' + BEARER).includes('abcdef0123456789'), 'an Authorization header is masked');
// split by a mark: the token only shows once the Markdown is gone
for (const split of [`${GH.slice(0, 2)}**${GH.slice(2)}**`, `${GH.slice(0, 2)}\`${GH.slice(2)}\``, `${GH.slice(0, 8)}**${GH.slice(8)}**`, `${GH.slice(0, 24)}**${GH.slice(24)}**`, `${GH.slice(0, 5)}~~${GH.slice(5)}`, `${GH.slice(0, 5)}[${GH.slice(5)}]`]) {
  const out = M('See ' + split + ' now.');
  assert.ok(!out.includes(GH.slice(8, 20)) && !out.includes(GH.slice(-10)), `split token masked: ${JSON.stringify(split)} -> ${JSON.stringify(out)}`);
  assert.ok(out.startsWith('See ') && out.endsWith(' now.'), 'around a split token the text is kept');
}
// a token glued to the word before it by a mark, and a late-split tail
assert.ok(!M(`x**${GH}**`).includes(GH.slice(8, 20)), 'glued to a word by **');
assert.ok(!M(`${GH.slice(0, 24)}**${GH.slice(24)}**`).includes(GH.slice(-8)), 'late-split tail masked');

// AC2: Markdown outside a masked token is unchanged; text with no secret is returned as it is
const plain = '# Plan\n\n- **bold** step with `code` and [a link](https://example.org/docs)\n- release_notes and snake_case_name stay\n\n```ts\nconst a = 1;\n```\n\n> quote _em_ end\n';
const pr = maskNoteText(plain);
assert.strictEqual(pr.text, plain, 'a note without a secret is returned as written');
assert.strictEqual(pr.changed, false, 'nothing masked: not hidden');
const mixed = maskNoteText('# Plan\n\n- **bold** step\n- key: `' + GH + '`\n- `code` and [link](https://example.org)\n');
assert.ok(mixed.changed, 'a masked token sets changed');
assert.ok(mixed.text.startsWith('# Plan\n\n- **bold** step\n- key: `') && mixed.text.endsWith('`\n- `code` and [link](https://example.org)\n'), `the Markdown around the mask is unchanged: ${JSON.stringify(mixed.text)}`);
assert.strictEqual(maskNoteText('a **b** c\\_d').text, 'a **b** c\\_d', 'escapes and marks alone change nothing');
assert.strictEqual(maskNoteText('C:\\Users\\me\\notes.md and \\\\server\\share').text, 'C:\\Users\\me\\notes.md and \\\\server\\share', 'Windows paths are left as written');

// AC3: mask, then cut. A bare token across the 16,000 cut leaves no piece of it
const room = NOTES_LIMITS.textChars - CUT_LINE.length - 2; // where fitText cuts a text with no line end
const filler = 'word '.repeat(Math.floor((room - 10) / 5)) + 'w'.repeat((room - 10) % 5); // the token starts 10 characters before the cut
const across = filler + GH + ' tail'.repeat(60); // over the cap, so it is cut
const maskedThenCut = fitText(M(across)).text;
assert.ok(!maskedThenCut.includes('ghp_'), 'mask then cut: no head of the token is left');
const cutThenMasked = M(fitText(across).text);
assert.ok(cutThenMasked.includes('ghp_') || cutThenMasked.includes(GH.slice(4, 10)), 'cutting first leaves a piece of the token (so this test tells the orders apart)');

// AC6: known values first, also when they have no token shape
const PLAIN = 'hunter2-' + 'plain-value';
const PLAIN2 = 'xyz-' + 'longer-secret-value';
assert.strictEqual(M(`the pass is ${PLAIN}.`, [PLAIN]), 'the pass is [redacted].');
assert.ok(!M(`the pass is ${PLAIN}.`).includes('[redacted]'), 'without the value known, a plain word is not guessed');
assert.strictEqual(maskNoteText(`the pass is ${PLAIN}.`, [PLAIN]).changed, true, 'known value: changed');
assert.strictEqual(M('abcdefgh', ['abcd', 'abcdefgh']), '[redacted]', 'longest first: the longer value is not left half-masked');
assert.strictEqual(M('abc stays', ['abc']), 'abc stays', 'under 4 characters skipped');
assert.strictEqual(M(`a ${PLAIN} b ${PLAIN2} c ${PLAIN}`, [PLAIN, PLAIN2]), 'a [redacted] b [redacted] c [redacted]', 'every value, every time');
for (const split of [`hunter2-**plain**-value`, `hunter2-\`plain-value\``, `**hunter2-plain-value**`, `hunter2-[plain-value](https://example.org)`.replace(/\(.*\)/, '')]) {
  const out = M(`pass: ${split} end`, [PLAIN]);
  assert.ok(!out.includes('plain') || out.includes('[redacted]'), `known value split by Markdown: ${split}`);
  assert.ok(!/hunter2|plain-value|plain\*\*/.test(out.replace('[redacted]', '')) , `no piece of the known value is left: ${JSON.stringify(out)}`);
  assert.ok(out.startsWith('pass: ') && out.endsWith(' end'), 'text around kept');
}
// the shape pass still runs after the values pass
assert.ok(!M(`${PLAIN} and ${GH}`, [PLAIN]).includes(GH.slice(6, 18)));
// non-strings and empty input never throw
assert.deepStrictEqual(maskNoteText(undefined), { text: '', changed: false });
assert.deepStrictEqual(maskNoteText(''), { text: '', changed: false });
assert.strictEqual(maskNoteText(12345 as unknown as string).text, '12345');

// AC4: linear time (CPU time, docs/agent-notes.md "Timing checks"): 8x the input, far less than 128x the time (spec: under 16x)
const cpuMs = (f: () => void): number => { const c = process.cpuUsage(); f(); const d = process.cpuUsage(c); return (d.user + d.system) / 1000; };
const unit = '## Heading\n\nSome **bold** text with `code`, a [link](https://example.org/a) and snake_case_words; ' + GH + ' and more.\n\n- one\n- two _em_\n\n';
const make = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const small = make(20_000);
const large = make(160_000);
let bestSmall = Infinity;
let bestLarge = Infinity;
for (let i = 0; i < 3; i++) { bestSmall = Math.min(bestSmall, cpuMs(() => M(small))); bestLarge = Math.min(bestLarge, cpuMs(() => M(large))); }
assert.ok(bestLarge < Math.max(bestSmall, 5) * 16 + 200, `linear: 20k ${bestSmall.toFixed(1)} ms, 160k ${bestLarge.toFixed(1)} ms`);
assert.ok(bestLarge < 3000, `160k characters in ${bestLarge.toFixed(0)} ms (limit 3 s)`);
const pathological = ('**' + 'a'.repeat(30) + '`').repeat(5000);
assert.ok(cpuMs(() => M(pathological)) < 3000, 'many marks next to long runs stay fast');

console.log(`notes mask: shapes in Markdown, split and glued tokens, known values, mask-then-cut, linear (20k ${bestSmall.toFixed(0)} ms, 160k ${bestLarge.toFixed(0)} ms)`);
