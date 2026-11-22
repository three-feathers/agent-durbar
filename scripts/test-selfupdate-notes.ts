/**
 * Spec 118 T004 (FR-010, SC-004 pure part): release notes are untrusted text. `npm run test:selfupdate-notes`.
 * Plain text out: the whole body unhidden, redacted and home-masked FIRST, then clipped by UTF-8 bytes per release and per dialog.
 * Secret-shaped values are invented and built from pieces at run time (never one literal); special characters by code point.
 */
import * as assert from 'assert';
import { dialogNotes, notesText, utf8Bytes, DIALOG_NOTES_MAX, MAX_BODY_BYTES, NOTE_MAX } from '../src/shared/selfupdate';
import type { FeedRelease } from '../src/shared/selfupdate';

const ch = (...cps: number[]): string => String.fromCodePoint(...cps);
const T = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
const t = (body: unknown): string => notesText(body).text;
/** Does `text` show 6 or more characters in a row of the secret part (after its known prefix) of `secret`? */
const leaks = (text: string, secret: string, prefix: number): boolean => {
  for (let i = prefix; i + 6 <= secret.length; i++) if (text.includes(secret.slice(i, i + 6))) return true;
  return false;
};
const noLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { if (!((s.charCodeAt(i + 1) & 0xfc00) === 0xdc00)) return false; i++; } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
};

const hostile = '<img src=x onerror=alert(1)><script>x()</script> [x](javascript:alert(1))';
assert.strictEqual(t(hostile), hostile, 'markup stays as text, never parsed or dropped (rendered with textContent)');
assert.strictEqual(t('a' + ch(0x202e) + 'b' + ch(0x2066) + 'c' + ch(0x200f) + 'd' + ch(0x61c) + 'e' + ch(0xfeff) + 'f' + ch(0xad) + 'g'), 'abcdefg', 'bidi and invisible marks are removed');
assert.strictEqual(t('a' + ch(0) + 'b' + ch(7) + 'c' + ch(0x1b) + 'd' + ch(0x7f) + 'e' + ch(0x85) + 'f'), 'abcdef', 'control characters are removed');
// review on PR 2037, item 3: redact.ts HIDDEN_CHARS covers these too (tag characters, variation selectors, fillers, invisible operators)
for (const cp of [0xe0041, 0xfe0f, 0x34f, 0x17b4, 0x180b, 0x3164, 0xffa0, 0x1d173, 0x2061, 0x2800]) {
  assert.strictEqual(t('a' + ch(cp) + 'b'), 'ab', 'hidden character removed: U+' + cp.toString(16).toUpperCase());
}
assert.strictEqual(t('one\r\ntwo\rthree\n\tfour'), 'one\ntwo\nthree\n\tfour', 'line ends become newlines, tabs stay');
assert.ok(!t('token ' + T + ' here').includes(T), 'a token is masked');
assert.ok(!t('see /home/ravi/notes.txt').includes('ravi'), 'a home folder is masked');
for (const v of [null, undefined, 42, {}, ['x']]) assert.deepStrictEqual(notesText(v), { text: '', clipped: false }, 'a non-string body is empty: ' + typeof v);

assert.strictEqual(utf8Bytes('a'), 1, 'UTF-8 size: ASCII is 1 byte');
assert.strictEqual(utf8Bytes(ch(0xe9) + ch(0x7ff)), 4, 'UTF-8 size: up to U+07FF is 2 bytes');
assert.strictEqual(utf8Bytes(ch(0x20ac)), 3, 'UTF-8 size: the euro sign is 3 bytes');
assert.strictEqual(utf8Bytes(ch(0x1f600)), 4, 'UTF-8 size: an emoji (a surrogate pair) is 4 bytes');
assert.strictEqual(utf8Bytes(String.fromCharCode(0xd800)), 3, 'UTF-8 size: a lone surrogate is 3 bytes, as TextEncoder writes it');
// Clip by UTF-8 bytes (item 8), with redact.ts `cut` (marker, no half token, no half surrogate pair)
const long = notesText('word '.repeat(2000));
assert.ok(long.clipped && utf8Bytes(long.text) <= NOTE_MAX && long.text.endsWith('[truncated]'), 'clipped to 8 KiB with a marker');
assert.ok(utf8Bytes(long.text) > NOTE_MAX - 64, 'the clip keeps nearly 8 KiB');
assert.strictEqual(notesText('x'.repeat(NOTE_MAX)).clipped, false, 'exactly 8 KiB is not clipped');
const euro = notesText(ch(0x20ac).repeat(Math.floor(NOTE_MAX / 3) + 1));
assert.ok(euro.clipped && utf8Bytes(euro.text) <= NOTE_MAX, 'the cap counts bytes, not characters');
const emoji = notesText('a '.repeat(NOTE_MAX / 2 - 7) + ch(0x1f600).repeat(40));
assert.ok(emoji.clipped && noLoneSurrogate(emoji.text) && utf8Bytes(emoji.text) <= NOTE_MAX, 'a surrogate pair is not split at the cut');
assert.deepStrictEqual(notesText('y'.repeat(MAX_BODY_BYTES + 1)), { text: '', clipped: true }, 'a body over 1 MiB is not shown at all');
assert.deepStrictEqual(notesText(ch(0x20ac).repeat(MAX_BODY_BYTES / 2)), { text: '', clipped: true }, 'over 1 MiB of UTF-8 is not shown either');
assert.strictEqual(notesText(ch(0x202e).repeat(NOTE_MAX) + 'ok').text, 'ok', 'hidden marks do not count toward the clip');

// Never cut before masking (item 1): every way of shortening the text before the clip, from pieces
assert.ok(!leaks(t('x'.repeat(NOTE_MAX - 10) + ' ' + T), T, 4), 'masked before the clip: no token piece at the cut');
for (const filler of [ch(0x202e), ch(0x200b), ch(0)]) {
  for (let k = 9; k < T.length; k++) {
    assert.ok(!leaks(t(filler.repeat(NOTE_MAX * 4 + 256 - k) + T), T, 4), `no piece after a hidden run (U+${filler.codePointAt(0)!.toString(16)}, ${k})`);
  }
}
for (let c = 1; c <= 60; c++) assert.ok(!leaks(t('x'.repeat(NOTE_MAX - c) + ' ' + T), T, 4), 'no piece at the clip end: ' + c);
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let seed = 118;
const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const word = (n: number, alpha = A): string => Array.from({ length: n }, () => alpha[rnd(alpha.length)]).join('');
const shapes = (): [string, number][] => [
  [['gh', 'p_'].join('') + word(36), 4], [['github', '_pat_'].join('') + word(82), 11], [['sk-', 'ant-api03-'].join('') + word(95), 13],
  [['AK', 'IA'].join('') + word(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), 4], [['xo', 'xb-'].join('') + word(12, '0123456789') + '-' + word(24), 5], [['sk-', 'proj-'].join('') + word(48), 8],
];
const shrinker = ['github', '_pat_'].join('') + word(82);
// the value's head at the old first-cut point behind a hidden run, for every shape (a shape that needs its full length shows a piece when cut first)
for (const [secret, prefix] of shapes()) {
  for (const filler of [ch(0x202e), ch(0x200b)]) {
    for (let k = prefix + 6; k < secret.length; k += 3) {
      assert.ok(!leaks(t(filler.repeat(NOTE_MAX * 4 + 256 - k) + secret), secret, prefix), `no piece at the old first cut (${secret.slice(0, 4)}, ${k})`);
    }
  }
}
for (let i = 0; i < 300; i++) {
  const [secret, prefix] = shapes()[rnd(6)];
  const fill = [ch(0x202e), ch(0x200b), 'x', ' ', shrinker + ' '][rnd(5)];
  const at = [NOTE_MAX, NOTE_MAX * 4 + 256][rnd(2)] - rnd(secret.length + 40);
  const head = fill.repeat(Math.ceil(at / fill.length)).slice(0, Math.max(0, at));
  // a blank before the value: a letter glued to it makes it no token at all, and the uncut text shows it too
  const body = head + [' ', '\n', ' (', ' "'][rnd(4)] + secret + ' tail';
  assert.ok(!leaks(t(body), secret, prefix), 'random cut ' + i + ': no piece of the value shows');
}

const rel = (version: string, body: string): FeedRelease => ({ tag: 'v' + version, version, publishedAt: '', htmlUrl: '', body, assets: [] });
const many = dialogNotes(Array.from({ length: 30 }, (_, i) => rel('0.1.' + i, 'z '.repeat(NOTE_MAX))));
const total = many.reduce((n, x) => n + utf8Bytes(x.text), 0);
assert.ok(total <= DIALOG_NOTES_MAX && total > DIALOG_NOTES_MAX - 1024, 'the whole dialog is at most 64 KiB');
assert.ok(many[29].text === '' && many[29].clipped, 'later releases are folded to the release page');
const wide = dialogNotes(Array.from({ length: 30 }, (_, i) => rel('0.1.' + i, (ch(0x20ac) + ' ').repeat(NOTE_MAX))));
assert.ok(wide.reduce((n, x) => n + utf8Bytes(x.text), 0) <= DIALOG_NOTES_MAX, 'the dialog total counts bytes, not characters');
assert.strictEqual(dialogNotes([rel('0.1.2', 'a' + ch(0x202e) + 'b')])[0].text, 'ab', 'the dialog uses the same plain-text rule');
console.log('selfupdate-notes: ok');
