/** Unit tests for the shared name rule (spec 059 FR-002): `npm run test:names`. Hidden characters are escapes on purpose. */
import * as assert from 'assert';
import { MAX_SESSION_NAME, checkDisplayName, cleanDisplayName, nameError } from '../src/shared/names';

const good: Array<[unknown, string]> = [
  ['Billing refactor', 'Billing refactor'],
  ['  spaced   out \t name\n', 'spaced out name'],
  ['日本語のセッション', '日本語のセッション'],
  ['שלום עולם', 'שלום עולם'],
  ['a'.repeat(60), 'a'.repeat(60)],
  ['😀'.repeat(60), '😀'.repeat(60)], // code points, not UTF-16 units
  ['family \u{1F468}\u200d\u{1F469}', 'family \u{1F468}\u200d\u{1F469}'], // ZWJ allowed
  ['<img src=x onerror=1>', '<img src=x onerror=1>'], // markup is a legal name; escaping is the display's job
  ['', ''],
  ['   ', ''],
];
for (const [i, o] of good) assert.deepStrictEqual(checkDisplayName(i), { ok: true, name: o }, JSON.stringify(i));

const tooLong = 'Use 1 to 60 characters.';
const hidden = 'Remove control or hidden characters.';
const secret = 'That looks like a secret. Use another name.';
const bad: Array<[unknown, string]> = [
  ['a'.repeat(61), tooLong],
  ['😀'.repeat(61), tooLong],
  [5, tooLong],
  [undefined, tooLong],
  [null, tooLong],
  [{}, tooLong],
  ['bad\u0000name', hidden],
  ['bad\u001bname', hidden],
  ['bad\u007fname', hidden],
  ['bad\u0085name', hidden],
  ['bad\u009fname', hidden],
  ['rtl\u202etrick', hidden],
  ['iso\u2066late', hidden],
  ['zero\u200bwidth', hidden],
  ['word\u2060joiner', hidden],
  ['bom\ufeffname', hidden],
  ['soft\u00adhyphen', hidden],
  ['line\u2028sep', hidden],
  ['fill\u3164er', hidden],
  ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', secret],
  ['Bearer abcdefghijklmnopqrstuvwxyz0123456789', secret],
];
for (const [i, e] of bad) {
  const r = checkDisplayName(i);
  assert.ok(!r.ok && r.error === e, `${JSON.stringify(i)} -> ${JSON.stringify(r)}`);
  assert.strictEqual(nameError(i), e);
  assert.strictEqual(cleanDisplayName(i), undefined);
}

assert.strictEqual(nameError('ok'), '');
assert.strictEqual(nameError(''), '', 'empty is a reset, not an error');
assert.strictEqual(cleanDisplayName(' a  b '), 'a b');
assert.strictEqual(cleanDisplayName(''), undefined);
assert.strictEqual(checkDisplayName('a'.repeat(41), 40).ok, false, 'max is a parameter');
assert.strictEqual(checkDisplayName('a'.repeat(40), 40).ok, true);
assert.strictEqual(MAX_SESSION_NAME, 60);
// the cap counts after collapsing: many spaces do not count
assert.strictEqual(checkDisplayName('a' + ' '.repeat(100) + 'b').ok, true);
console.log('names: ok');
