/**
 * Spec 118 T004 (FR-010, SC-004 pure part): release notes are untrusted text. `npm run test:selfupdate-notes`.
 * Plain text out: hidden and direction marks removed, secrets and home folders masked before the clip, clipped per release and per dialog.
 */
import * as assert from 'assert';
import { dialogNotes, notesText, DIALOG_NOTES_MAX, NOTE_MAX } from '../src/shared/selfupdate';
import type { FeedRelease } from '../src/shared/selfupdate';

const T = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const t = (body: unknown): string => notesText(body).text;

const hostile = '<img src=x onerror=alert(1)><script>x()</script> [x](javascript:alert(1))';
assert.strictEqual(t(hostile), hostile, 'markup stays as text, never parsed or dropped (rendered with textContent)');
assert.strictEqual(t('a\u202Eb\u2066c\u200Fd\u061Ce\uFEFFf\u00ADg'), 'abcdefg', 'bidi and invisible marks are removed');
assert.strictEqual(t('a\u0000b\u0007c\u001Bd\u007Fe\u0085f'), 'abcdef', 'control characters are removed');
assert.strictEqual(t('one\r\ntwo\rthree\n\tfour'), 'one\ntwo\nthree\n\tfour', 'line ends become newlines, tabs stay');
assert.ok(!t('token ' + T + ' here').includes(T), 'a token is masked');
assert.ok(!t('see /home/ravi/notes.txt').includes('ravi'), 'a home folder is masked');
for (const v of [null, undefined, 42, {}, ['x']]) assert.deepStrictEqual(notesText(v), { text: '', clipped: false }, 'a non-string body is empty: ' + typeof v);

const long = notesText('x'.repeat(NOTE_MAX + 1));
assert.strictEqual(long.text.length, NOTE_MAX, 'clipped to 8 KiB');
assert.strictEqual(long.clipped, true, 'a clipped body says so');
assert.strictEqual(notesText('x'.repeat(NOTE_MAX)).clipped, false, 'exactly 8 KiB is not clipped');
const across = t('x'.repeat(NOTE_MAX - 10) + ' ' + T);
assert.ok(!across.includes(T.slice(0, 9)), 'masked before the clip: no token prefix at the cut');
const pair = t('x'.repeat(NOTE_MAX - 1) + '\u{1F600}');
assert.ok(pair.length === NOTE_MAX - 1 && !/[\uD800-\uDBFF]$/.test(pair), 'a surrogate pair is not split at the cut');
const huge = notesText('y'.repeat(10 * 1024 * 1024));
assert.ok(huge.clipped && huge.text.length === NOTE_MAX, 'a 10 MB body is bounded');
assert.strictEqual(notesText('\u202E'.repeat(NOTE_MAX) + 'ok').text, 'ok', 'hidden marks do not count toward the clip');

const rel = (version: string, body: string): FeedRelease => ({ tag: 'v' + version, version, publishedAt: '', htmlUrl: '', body, assets: [] });
const many = dialogNotes(Array.from({ length: 30 }, (_, i) => rel('0.1.' + i, 'z'.repeat(NOTE_MAX * 2))));
assert.strictEqual(many.reduce((n, x) => n + x.text.length, 0), DIALOG_NOTES_MAX, 'the whole dialog is at most 64 KiB');
assert.ok(many[7].text.length === NOTE_MAX && many[8].text === '' && many[8].clipped, 'later releases are folded to the release page');
assert.strictEqual(dialogNotes([rel('0.1.2', 'a\u202Eb')])[0].text, 'ab', 'the dialog uses the same plain-text rule');
console.log('selfupdate-notes: ok');
