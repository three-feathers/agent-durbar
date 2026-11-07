/**
 * Spec 084 T011 (FR-040..FR-045, FR-004, SC-003, issue 701): the contact link builder `src/shared/contactlinks.ts`.
 * `npm run test:contactlinks`. Pure: no Electron, no network, nothing is opened. Runs on every OS of CI (part of `npm test`).
 * Only made-up people and `example.invalid` addresses.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONTACT_LINK_ALLOWLIST, SUBJECT_CODE_POINTS, TELEGRAM_RESERVED_PATHS, buildContactLink, telegramNameOk, emailParts, encodeValue, encodedLengthOf, linkAddressOk, wellFormed, wellFormedFallback,
  type LinkChannel, type LinkResult,
} from '../src/shared/contactlinks';
import * as contactlinks from '../src/shared/contactlinks';

let passed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; } catch (err) { console.error(`FAIL ${name}`); throw err; }
}

// The reference encoder the test trusts: RFC 3986 strict, written independently of the module.
const ref = (s: string): string =>
  Array.from(new TextEncoder().encode(s), (b) => (/[A-Za-z0-9\-._~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0'))).join('');

const ok = (r: LinkResult): { url: string; encodedLength: number; prefill: boolean; copyText?: string } => {
  assert.ok('url' in r, `expected a link, got ${JSON.stringify(r)}`);
  return r;
};
const URL_CAP = 2_000;

/**
 * FR-004's hostile list, plus shapes the builder must refuse on its own. Kept here until spec 084 T010 (`src/shared/contacts.ts`,
 * PR 1245) is on main; then swap it for that test's exported corpus. Non-ASCII written as escapes so this file stays ASCII.
 */
export const HOSTILE_ADDRESSES: readonly string[] = [
  'alex@example.invalid\r\nbcc:eve@example.invalid', 'alex@example.invalid\n', '\ralex@example.invalid', 'alex\r@example.invalid',
  'alex@example.invalid?cc=eve@example.invalid', 'alex@example.invalid&message=hi', 'alex&message=hi@example.invalid',
  'alex%0A@example.invalid', 'alex@example.invalid%0Abcc:eve@example.invalid', 'al%65x@example.invalid',
  'alex@example.invalid,eve@example.invalid', 'alex@example.invalid;eve@example.invalid',
  '"alex"@example.invalid', "alex'@example.invalid", '<alex@example.invalid>', 'alex @example.invalid', 'alex@example.invalid ',
  'javascript:alert(1)//@example.invalid', 'javascript:alert(1)', 'tel:+15550100@example.invalid', 'alex@example.invalid#x', 'alex#x@example.invalid',
  'alex\uff20example.invalid', 'alex\ufe6bexample.invalid', 'alex@\u200b@example.invalid',
  '\u0430lex@example.invalid', 'alex@ex\u0430mple.invalid', '\u03bfscar@example.invalid', 'alex@exampl\u03bf.invalid',
  'alex@example\uff0einvalid', 'alex@example\u3002invalid', 'alex\u200b@example.invalid', 'alex@example.invalid\u200b',
  'alex@@example.invalid', 'alex@eve@example.invalid', '@example.invalid', 'alex@', 'alex@localhost', 'alex@example.123',
  '.alex@example.invalid', 'alex.@example.invalid', 'al..ex@example.invalid', 'alex@-example.invalid', 'alex@example..invalid',
  'alex@example.invalid/../x', 'alex\u0000@example.invalid', 'a'.repeat(65) + '@example.invalid', 'a.'.repeat(60) + 'a@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.invalid',
  '', 'alex', '\ud800@example.invalid',
  'alex@ex_ample.invalid', 'alex@example.inv_alid', 'alex@_example.invalid', 'alex@example_.invalid', 'alex@example.invalid_',
];
const HOSTILE_SLACK: readonly string[] = [
  'T123&id=U999', 'T123?x=1', 'T123#x', 'T123\n', 't123', 'T1', 'T' + 'A'.repeat(21), 'tel:12345', 'javascript:alert', 'T12\u0430', 'T123 ', 'T%41BC', '',
];
const HOSTILE_TELEGRAM: readonly string[] = [
  'alex_example?text=x', 'alex_example#x', 'alex/../x', 'tel:1234567', '_alexample', '1alexample', 'alex', 'al\u0435xexample', 'alex example',
  'alex.example', 'alex-example', 'a'.repeat(33), 'alexexample\n', 'alexexample%2F', '', 'joinchat', 'Share', 'ADDSTICKERS', 'setLanguage',
];

const TEAMS_WEB = 'https://teams.microsoft.com/l/chat/0/0?';
const TEAMS_APP = 'msteams:/l/chat/0/0?';
const UPN = 'alex.example@example.invalid';
const ENC_UPN = 'alex.example%40example.invalid';

// AC1: Teams
test('AC1 Teams web link, exactly', () => {
  const r = ok(buildContactLink({ kind: 'teams', upn: UPN }, '#669 is ready for review'));
  assert.strictEqual(r.url, CONTACT_LINK_ALLOWLIST[0] + 'users=' + ENC_UPN + '&message=%23669%20is%20ready%20for%20review');
  assert.strictEqual(r.url, 'https://teams.microsoft.com/l/chat/0/0?users=alex.example%40example.invalid&message=%23669%20is%20ready%20for%20review');
  assert.strictEqual(r.prefill, true);
  assert.strictEqual(r.copyText, undefined);
  assert.strictEqual(r.encodedLength, r.url.length);
});
test('AC1 Teams app form with teamsApp', () => {
  const r = ok(buildContactLink({ kind: 'teams', upn: UPN }, 'hi & bye', { teamsApp: true }));
  assert.strictEqual(r.url, 'msteams:/l/chat/0/0?users=' + ENC_UPN + '&message=hi%20%26%20bye');
  // only `true` switches to the app form
  for (const v of [1, 'yes', {}] as unknown[]) {
    assert.ok(ok(buildContactLink({ kind: 'teams', upn: UPN }, 'x', { teamsApp: v as boolean })).url.startsWith(TEAMS_WEB));
  }
});
test('AC1 strict encoding: !\'()* + = ? & # % are encoded', () => {
  const text = "!'()*+=?&#%~-._ a";
  const r = ok(buildContactLink({ kind: 'teams', upn: UPN }, text));
  assert.strictEqual(r.url, TEAMS_WEB + 'users=' + ENC_UPN + '&message=%21%27%28%29%2A%2B%3D%3F%26%23%25~-._%20a');
  assert.strictEqual(new URL(r.url).searchParams.get('message'), text);
});

// AC2: email
test('AC2 email: subject is the first line, body the rest with CRLF', () => {
  const r = ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, 'Release ready\nline two\rline three\r\nend & more'));
  assert.strictEqual(r.url, 'mailto:alex@example.invalid?subject=Release%20ready&body=line%20two%0D%0Aline%20three%0D%0Aend%20%26%20more');
  assert.strictEqual(r.prefill, true);
  const u = new URL(r.url);
  assert.strictEqual(u.protocol, 'mailto:');
  assert.strictEqual(u.pathname, 'alex@example.invalid');
  assert.deepStrictEqual([...u.searchParams.keys()], ['subject', 'body']);
  assert.strictEqual(u.searchParams.get('body'), 'line two\r\nline three\r\nend & more');
});
test('AC2 email: one line gives an empty subject and the text as the body', () => {
  const r = ok(buildContactLink({ kind: 'email', address: 'alex+tag@example.invalid' }, 'just one line'));
  assert.strictEqual(r.url, 'mailto:alex+tag@example.invalid?subject=&body=just%20one%20line');
  assert.deepStrictEqual(emailParts(''), { subject: '', body: '' });
});
test('AC2 subject cut at a word, at most 78 code points; the whole first line goes on in the body', () => {
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma';
  assert.ok(words.length > SUBJECT_CODE_POINTS);
  const p = emailParts(words + '\nsecond');
  assert.strictEqual(SUBJECT_CODE_POINTS, 78);
  assert.strictEqual(p.subject, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi');
  assert.strictEqual(p.body, words + '\r\nsecond');
  // a space right after the 78th code point: cut exactly there
  const exact = 'a'.repeat(78) + ' tail';
  assert.strictEqual(emailParts(exact + '\nx').subject, 'a'.repeat(78));
  // exactly 78: kept whole, body is only the rest
  assert.deepStrictEqual(emailParts('b'.repeat(78) + '\nrest'), { subject: 'b'.repeat(78), body: 'rest' });
  // one word longer than 78: hard cut at 78 code points
  assert.strictEqual(emailParts('c'.repeat(200) + '\nx').subject, 'c'.repeat(78));
  // a leading space only: not an empty subject
  assert.strictEqual(emailParts(' ' + 'd'.repeat(100) + '\nx').subject, ' ' + 'd'.repeat(77));
});
test('AC2 subject counted in code points, never a split surrogate', () => {
  const emoji = '\u{1F600}';
  const p = emailParts(emoji.repeat(80) + '\nrest');
  assert.strictEqual(Array.from(p.subject).length, 78, 'code points, not UTF-16 units');
  assert.strictEqual(p.subject, emoji.repeat(78));
  const mixed = 'a' + emoji.repeat(77) + emoji + 'zz';
  assert.strictEqual(emailParts(mixed + '\nx').subject, 'a' + emoji.repeat(77));
  // the link still parses and round-trips
  const r = ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, emoji.repeat(80) + '\nrest'));
  assert.strictEqual(new URL(r.url).searchParams.get('subject'), emoji.repeat(78));
});

const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const boundaries = (s: string): Set<number> => new Set([...Array.from(SEG.segment(s), (x) => x.index), s.length]);
test('AC2 the subject never splits a grapheme cluster (still at most 78 code points)', () => {
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
  const cases: Array<[string, string]> = [
    ['a'.repeat(76) + family + 'tail', 'a'.repeat(76)], // the 78th code point is inside the family emoji
    ['a'.repeat(77) + '\u{1F1EA}\u{1F1F8}' + 'x', 'a'.repeat(77)], // a flag across the limit
    ['a'.repeat(77) + 'e\u0301' + 'zz', 'a'.repeat(77)], // a letter and its combining accent
    ['a'.repeat(76) + '1\ufe0f\u20e3' + 'x', 'a'.repeat(76)], // a keycap
    ['a'.repeat(75) + family, 'a'.repeat(75)], // 80 code points, the family starts at the 76th
    ['b'.repeat(70) + ' ' + 'c'.repeat(6) + family + 'x', 'b'.repeat(70)], // a space before: the word cut wins
    ['a'.repeat(77) + ' \u0301' + 'x', 'a'.repeat(77)], // a space that carries a mark is still a place to cut
  ];
  for (const [line, want] of cases) {
    const p = emailParts(line + '\nb');
    assert.strictEqual(p.subject, want, JSON.stringify(line));
    assert.ok(Array.from(p.subject).length <= SUBJECT_CODE_POINTS);
    assert.strictEqual(p.body, line + '\r\nb', 'the whole first line goes on in the body');
  }
  // a space inside a cluster (after a prepended U+0600) is no place to cut: only a cluster that starts with white space is
  const prepended = 'b'.repeat(70) + '\u0600 ' + 'c'.repeat(10);
  assert.strictEqual(emailParts(prepended + '\nb').subject, 'b'.repeat(70) + '\u0600 ' + 'c'.repeat(6));
  // one cluster longer than 78 code points: an empty subject, nothing lost
  const zalgo = 'e' + '\u0301'.repeat(100);
  assert.deepStrictEqual(emailParts(zalgo + '\nb'), { subject: '', body: zalgo + '\r\nb' });
  assert.ok('url' in buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, zalgo + '\nb'));
});

// AC3: Slack
test('AC3 Slack: slack://user?team=&id=, the text to copy, no prefill', () => {
  const r = ok(buildContactLink({ kind: 'slack', team: 'T0ABC12', user: 'U0XYZ99' }, 'paste me & send\n#669'));
  assert.strictEqual(r.url, 'slack://user?team=T0ABC12&id=U0XYZ99');
  assert.strictEqual(r.copyText, 'paste me & send\n#669');
  assert.strictEqual(r.prefill, false);
  assert.ok(ok(buildContactLink({ kind: 'slack', team: 'T12', user: 'W12' }, '')).url.endsWith('id=W12'));
  // a huge text does not make a Slack link too long: the text is not in it
  assert.strictEqual(ok(buildContactLink({ kind: 'slack', team: 'T12', user: 'U12' }, 'x'.repeat(10_000))).copyText?.length, 10_000);
});

// AC4: Telegram
test('AC4 Telegram: https://t.me/<username>?text=', () => {
  const r = ok(buildContactLink({ kind: 'telegram', username: 'alex_example' }, 'hola, \u00bfqu\u00e9 tal?'));
  assert.strictEqual(r.url, 'https://t.me/alex_example?text=hola%2C%20%C2%BFqu%C3%A9%20tal%3F');
  assert.strictEqual(r.prefill, true);
});

// AC5: the URL cap and copyOnly
test('AC5 over 2,000 characters: too-long with the encoded length; 2,000 fits', () => {
  const head = TEAMS_WEB + 'users=' + ENC_UPN + '&message=';
  const fits = 'x'.repeat(URL_CAP - head.length);
  const r = ok(buildContactLink({ kind: 'teams', upn: UPN }, fits));
  assert.strictEqual(r.url.length, URL_CAP);
  assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: UPN }, fits + 'x'), { error: 'too-long', encodedLength: URL_CAP + 1 });
  // counted after encoding: 700 x U+00E9 is 700 characters but 4,200 encoded
  const accents = '\u00e9'.repeat(700);
  assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: UPN }, accents), { error: 'too-long', encodedLength: head.length + 4_200 });
  for (const [ch, text] of [
    [{ kind: 'email', address: 'alex@example.invalid' }, 'subject\n' + '%'.repeat(700)],
    [{ kind: 'telegram', username: 'alex_example' }, '\u{1F600}'.repeat(200)],
  ] as Array<[LinkChannel, string]>) {
    const e = buildContactLink(ch, text);
    assert.ok('error' in e && e.error === 'too-long' && typeof e.encodedLength === 'number' && e.encodedLength > URL_CAP, JSON.stringify(e).slice(0, 200));
  }
});
test('AC5 copyOnly drops message / body / text and returns the text to copy', () => {
  const long = 'z'.repeat(3_000);
  const t = ok(buildContactLink({ kind: 'teams', upn: UPN }, long, { copyOnly: true }));
  assert.strictEqual(t.url, TEAMS_WEB + 'users=' + ENC_UPN);
  assert.deepStrictEqual([t.prefill, t.copyText], [false, long]);
  assert.strictEqual(ok(buildContactLink({ kind: 'teams', upn: UPN }, long, { copyOnly: true, teamsApp: true })).url, TEAMS_APP + 'users=' + ENC_UPN);
  const m = ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, 'Hello Alex\n' + long, { copyOnly: true }));
  assert.strictEqual(m.url, 'mailto:alex@example.invalid?subject=Hello%20Alex');
  assert.deepStrictEqual([m.prefill, m.copyText], [false, long]);
  const one = ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, long, { copyOnly: true }));
  assert.deepStrictEqual([one.url, one.copyText], ['mailto:alex@example.invalid?subject=', long]);
  const g = ok(buildContactLink({ kind: 'telegram', username: 'alex_example' }, long, { copyOnly: true }));
  assert.deepStrictEqual([g.url, g.prefill, g.copyText], ['https://t.me/alex_example', false, long]);
  assert.strictEqual(new URL(g.url).search, '');
});

// Inputs the builder refuses on its own (fail closed), and never throws on
test('hostile addresses, Slack ids and Telegram names are refused', () => {
  for (const a of HOSTILE_ADDRESSES) {
    assert.strictEqual(linkAddressOk(a), false, JSON.stringify(a));
    assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: a }, 'hi'), { error: 'bad-channel' }, JSON.stringify(a));
    assert.deepStrictEqual(buildContactLink({ kind: 'email', address: a }, 'hi'), { error: 'bad-channel' }, JSON.stringify(a));
  }
  for (const s of HOSTILE_SLACK) {
    assert.deepStrictEqual(buildContactLink({ kind: 'slack', team: s, user: 'U123' }, 'hi'), { error: 'bad-channel' }, JSON.stringify(s));
    assert.deepStrictEqual(buildContactLink({ kind: 'slack', team: 'T123', user: s.replace(/^T/, 'U') }, 'hi'), { error: 'bad-channel' }, JSON.stringify(s));
  }
  assert.deepStrictEqual(buildContactLink({ kind: 'slack', team: 'U123', user: 'T123' }, 'hi'), { error: 'bad-channel' });
  for (const u of HOSTILE_TELEGRAM) assert.deepStrictEqual(buildContactLink({ kind: 'telegram', username: u }, 'hi'), { error: 'bad-channel' }, JSON.stringify(u));
  // the edges that pass: 254 characters, 64-character local part, Telegram 5 and 32, Slack 2 and 20 after the letter
  const a254 = 'a'.repeat(64) + '@' + ['b'.repeat(63), 'c'.repeat(63), 'd'.repeat(58), 'io'].join('.');
  assert.strictEqual(a254.length, 254);
  assert.ok(linkAddressOk(a254));
  assert.ok(!linkAddressOk('a' + a254));
  const a255 = 'a'.repeat(64) + '@' + ['b'.repeat(63), 'c'.repeat(63), 'd'.repeat(59), 'io'].join('.');
  assert.strictEqual(a255.length, 255);
  assert.ok(!linkAddressOk(a255), 'over 254 characters, every part within its own cap');
  assert.ok('url' in buildContactLink({ kind: 'telegram', username: 'a'.repeat(5) }, ''));
  assert.ok('url' in buildContactLink({ kind: 'telegram', username: 'a'.repeat(32) }, ''));
  assert.ok('url' in buildContactLink({ kind: 'slack', team: 'T' + 'A'.repeat(20), user: 'U' + '9'.repeat(2) }, ''));
});
test('bad shapes: unknown kind, wrong types, inherited fields, non-string text; never throws', () => {
  const bad: unknown[] = [null, undefined, 1, 'teams', [], {}, { kind: 'sms', upn: UPN }, { kind: 'teams' }, { kind: 'teams', upn: 5 },
    { kind: 'email', upn: 'alex@example.invalid' }, { kind: 'slack', team: 'T123' }, { kind: 'telegram', handle: 'alex_example' },
    Object.create({ kind: 'teams', upn: UPN }), Object.assign(Object.create({ upn: UPN }), { kind: 'teams' })];
  for (const c of bad) assert.deepStrictEqual(buildContactLink(c as LinkChannel, 'hi'), { error: 'bad-channel' }, String(JSON.stringify(c)));
  for (const t of [undefined, null, 5, {}, ['a']] as unknown[]) {
    assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: UPN }, t as string), { error: 'bad-text' });
  }
  assert.ok('url' in buildContactLink({ kind: 'teams', upn: UPN }, 'x', null as unknown as undefined));
});
test('lone surrogates become U+FFFD (no URIError), pairs are kept', () => {
  assert.strictEqual(wellFormed('a\ud800b\udc00c\u{1F600}\udbff'), 'a\ufffdb\ufffdc\u{1F600}\ufffd');
  assert.strictEqual(wellFormedFallback('a\ud800b\udc00c\u{1F600}\udbff'), 'a\ufffdb\ufffdc\u{1F600}\ufffd');
  for (const text of ['\ud800', '\udfff', 'x\ud83d', '\ude00x', '\ud83d\u{1F600}']) {
    for (const ch of [{ kind: 'teams', upn: UPN }, { kind: 'email', address: 'alex@example.invalid' }, { kind: 'telegram', username: 'alex_example' }, { kind: 'slack', team: 'T12', user: 'U12' }]) {
      const r = ok(buildContactLink(ch, text + '\n' + text));
      const u = new URL(r.url);
      const values = [...u.searchParams.values()].join('') + (r.copyText ?? '');
      assert.ok(!/[\ud800-\udfff]/.test(values.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), 'no lone surrogate left');
      if (ch.kind !== 'slack') assert.ok(values.includes('\ufffd'));
    }
  }
  assert.strictEqual(ok(buildContactLink({ kind: 'slack', team: 'T12', user: 'U12' }, 'a\ud800')).copyText, 'a\ufffd');
});

test('R1 hostile objects never throw: getters are not called, Proxy traps that throw give the error of their part', () => {
  let called = 0;
  const getter = (v: unknown) => ({ enumerable: true, get() { called++; if (v instanceof Error) throw v; return v; } });
  const channels: Array<[string, object]> = [
    ['throwing getter', Object.defineProperty({ kind: 'teams' }, 'upn', getter(new Error('boom')))],
    ['valid-looking getter', Object.defineProperty({ kind: 'teams' }, 'upn', getter(UPN))],
    ['getter on kind', Object.defineProperty({ upn: UPN }, 'kind', getter('teams'))],
  ];
  const revoked = Proxy.revocable({ kind: 'teams', upn: UPN }, {});
  revoked.revoke();
  channels.push(['revoked Proxy', revoked.proxy]);
  channels.push(['throwing getOwnPropertyDescriptor trap', new Proxy({ kind: 'teams', upn: UPN }, { getOwnPropertyDescriptor() { throw new Error('trap'); } })]);
  for (const [name, ch] of channels) assert.deepStrictEqual(buildContactLink(ch as LinkChannel, 'hi'), { error: 'bad-channel' }, name);
  assert.strictEqual(called, 0, 'no getter is ever called');
  // traps the builder does not use: the plain data still gives the link
  for (const trap of ['get', 'has', 'ownKeys', 'getPrototypeOf'] as const) {
    const p = new Proxy({ kind: 'teams', upn: UPN }, { [trap]() { throw new Error('trap ' + trap); } });
    assert.strictEqual(ok(buildContactLink(p as LinkChannel, 'hi')).url, TEAMS_WEB + 'users=' + ENC_UPN + '&message=hi', trap);
  }
  // text: only a string is read
  const revokedText = Proxy.revocable({}, {});
  revokedText.revoke();
  for (const t of [revokedText.proxy, new Proxy({}, { get() { throw new Error('x'); } }), { toString() { throw new Error('x'); } }]) {
    assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: UPN }, t as unknown as string), { error: 'bad-text' });
  }
  // options: own data properties only; a hostile object gives bad-options
  const ch = { kind: 'teams', upn: UPN };
  const revokedOpts = Proxy.revocable({ copyOnly: true }, {});
  revokedOpts.revoke();
  for (const o of [revokedOpts.proxy, new Proxy({ copyOnly: true }, { getOwnPropertyDescriptor() { throw new Error('trap'); } }), 5, 'copyOnly']) {
    assert.deepStrictEqual(buildContactLink(ch, 'hi', o as never), { error: 'bad-options' }, String(typeof o));
  }
  for (const o of [Object.create({ copyOnly: true, teamsApp: true }), Object.defineProperty({}, 'copyOnly', getter(true)), Object.defineProperty({}, 'teamsApp', getter(new Error('x')))]) {
    const r = ok(buildContactLink(ch, 'hi', o));
    assert.deepStrictEqual([r.url, r.prefill], [TEAMS_WEB + 'users=' + ENC_UPN + '&message=hi', true]);
  }
  assert.strictEqual(called, 0);
  for (const trap of ['get', 'has', 'ownKeys'] as const) {
    const o = new Proxy({ copyOnly: true }, { [trap]() { throw new Error('trap'); } });
    assert.strictEqual(ok(buildContactLink(ch, 'hi', o)).prefill, false, trap);
  }
});
test('R2 an underscore is fine in the local part and refused in any domain label', () => {
  assert.ok(linkAddressOk('alex_example@example.invalid'));
  for (const a of ['alex@ex_ample.invalid', 'alex@example.inv_alid', 'alex@_example.invalid', 'alex@example_.invalid', 'alex@a_b.example.io']) {
    assert.ok(!linkAddressOk(a), a);
  }
});
test('R3 Telegram names that open a page, not a chat, are refused in any case', () => {
  for (const n of ['share', 'joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'proxy', 'socks', 'login', 'setlanguage', 'confirmphone', 'invoice', 'giftcode', 'boost', 'contact', 'c', 's', 'm', 'iv', 'bg']) {
    assert.ok(TELEGRAM_RESERVED_PATHS.includes(n), n);
  }
  for (const n of TELEGRAM_RESERVED_PATHS) {
    for (const v of [n, n.toUpperCase(), n[0].toUpperCase() + n.slice(1)]) {
      assert.ok(!telegramNameOk(v), v);
      assert.deepStrictEqual(buildContactLink({ kind: 'telegram', username: v }, 'hi'), { error: 'bad-channel' }, v);
    }
  }
  for (const v of ['shares', 'share_bot', 'joinchats', 'alex_example', 'Login_Helper']) assert.ok('url' in buildContactLink({ kind: 'telegram', username: v }, 'hi'), v);
});

/** Every non-function export, walked: primitives, or frozen plain arrays and objects all the way down (no Set, Map or RegExp). */
function assertDeepFrozen(v: unknown, where: string): void {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return;
  assert.ok(!(v instanceof Set) && !(v instanceof Map) && !(v instanceof WeakMap) && !(v instanceof WeakSet) && !(v instanceof RegExp), `${where}: a mutable structure`);
  assert.ok(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, `${where}: only plain arrays and objects`);
  assert.ok(Object.isFrozen(v), `${where} is not frozen`);
  for (const k of Object.keys(v as object)) assertDeepFrozen((v as Record<string, unknown>)[k], `${where}.${k}`);
}
test('R5 exported lists are frozen arrays; changing them or the exports does not change the builder', () => {
  const mod = contactlinks as unknown as Record<string, unknown>;
  const values = Object.keys(mod).filter((k) => typeof mod[k] !== 'function');
  assert.deepStrictEqual(values.sort(), ['CONTACT_LINK_ALLOWLIST', 'SUBJECT_CODE_POINTS', 'TELEGRAM_RESERVED_PATHS'], 'the exported values');
  for (const k of values) assertDeepFrozen(mod[k], k);
  assert.ok(Array.isArray(TELEGRAM_RESERVED_PATHS) && TELEGRAM_RESERVED_PATHS.includes('share'));
  // strict mode: every change throws, and nothing changes
  const list = TELEGRAM_RESERVED_PATHS as string[];
  const allow = CONTACT_LINK_ALLOWLIST as string[];
  const tries: Array<() => unknown> = [
    () => list.push('x'), () => list.pop(), () => list.splice(0, 1), () => { list[0] = 'alexexample'; }, () => { list.length = 0; },
    () => allow.push('javascript:'), () => { allow[2] = 'javascript:'; }, () => allow.shift(),
  ];
  for (const t of tries) assert.throws(t, TypeError);
  assert.strictEqual(TELEGRAM_RESERVED_PATHS[0], 'share');
  assert.deepStrictEqual(buildContactLink({ kind: 'telegram', username: 'share' }, 'hi'), { error: 'bad-channel' });
  // CommonJS lets an importer replace an export: the builder only uses its private bindings
  const saved = Object.fromEntries(Object.keys(mod).map((k) => [k, mod[k]]));
  try {
    mod.TELEGRAM_RESERVED_PATHS = [];
    mod.CONTACT_LINK_ALLOWLIST = ['javascript:'];
    mod.SUBJECT_CODE_POINTS = 2;
    mod.telegramNameOk = () => true;
    mod.linkAddressOk = () => true;
    mod.encodeValue = (x: string) => x;
    mod.encodedLengthOf = () => 0;
    mod.wellFormed = (x: string) => x;
    mod.emailParts = () => ({ subject: '', body: '' });
    assert.deepStrictEqual(buildContactLink({ kind: 'telegram', username: 'share' }, 'hi'), { error: 'bad-channel' });
    assert.deepStrictEqual(buildContactLink({ kind: 'teams', upn: 'a b@example.invalid' }, 'hi'), { error: 'bad-channel' });
    assert.strictEqual(ok(buildContactLink({ kind: 'teams', upn: UPN }, 'a b')).url, TEAMS_WEB + 'users=' + ENC_UPN + '&message=a%20b');
    assert.strictEqual(ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, 'one two three\nx')).url, 'mailto:alex@example.invalid?subject=one%20two%20three&body=x');
    assert.strictEqual((buildContactLink({ kind: 'teams', upn: UPN }, 'x'.repeat(3_000)) as { error: string }).error, 'too-long');
  } finally {
    for (const [k, v] of Object.entries(saved)) mod[k] = v;
  }
  assert.strictEqual(contactlinks.CONTACT_LINK_ALLOWLIST, CONTACT_LINK_ALLOWLIST);
});

// AC6: the one allow-list
function repoRoot(): string {
  let d = __dirname;
  for (;;) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'shared'))) return d;
    const up = path.dirname(d);
    assert.notStrictEqual(up, d, 'repo root not found');
    d = up;
  }
}
function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|cjs|html|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
/** Indexes of a bare `'mailto:'` string literal (any quote). */
function mailtoLiterals(s: string): number[] {
  return Array.from(s.matchAll(/(['"`])mailto:\1/gi), (m) => m.index as number);
}
const SCHEME_LITERAL_RE = /(['"`])[a-z][a-z0-9+.-]*:[^'"`\s]{0,60}\1/gi;
/** Whether a bare `'mailto:'` sits in an array literal with another scheme-like literal (`'tel:'`, `'slack://user?'`, `'https://t.me/'`). */
function mailtoInList(s: string): boolean {
  for (const at of mailtoLiterals(s)) {
    // the enclosing `[`: walk back over balanced brackets; a `;`, `{` or `}` at depth 0 means the literal is not in an array
    let depth = 0;
    let open = -1;
    for (let i = at - 1; i >= 0 && i > at - 5_000; i--) {
      const c = s[i];
      if (c === ']') depth++;
      else if (c === '[') { if (depth === 0) { open = i; break; } depth--; }
      else if (depth === 0 && (c === ';' || c === '{' || c === '}')) break;
    }
    if (open < 0) continue;
    depth = 0;
    let close = -1;
    for (let i = open; i < s.length && i < open + 10_000; i++) {
      if (s[i] === '[') depth++;
      else if (s[i] === ']' && --depth === 0) { close = i; break; }
    }
    const list = s.slice(open, close < 0 ? open + 10_000 : close + 1);
    const schemes = Array.from(list.matchAll(SCHEME_LITERAL_RE), (m) => m[0].slice(1, -1).toLowerCase());
    if (schemes.some((x) => x !== 'mailto:')) return true;
  }
  return false;
}
test('the list detector: a mailto: list is found, spec 080 shapes are not', () => {
  for (const bad of ["const X = ['mailto:', 'tel:'];", 'const X = ["tel:", "mailto:"];', "f(['https://a.example/?', 'mailto:'])", "const X = [\n  'x',\n  'mailto:',\n  'sms:',\n];", 'const X = [`mailto:`, `slack://user?`];']) {
    assert.ok(mailtoInList(bad), bad);
  }
  for (const fine of ["if (u.protocol === 'mailto:') return 1;", "const rest = text.slice('mailto:'.length);", "const href = 'mailto:' + addrs.join(',');",
    "const a = ['mailto:']; const b = ['tel:'];", "x(['javascript:alert(1)', 'mailto:sim@example.invalid'])", "const r = /^(?:https?:\\/\\/|mailto:)/i;"]) {
    assert.ok(!mailtoInList(fine), fine);
  }
});
test('AC6 CONTACT_LINK_ALLOWLIST is the one list of the five prefixes in src/', () => {
  assert.deepStrictEqual([...CONTACT_LINK_ALLOWLIST], [TEAMS_WEB, TEAMS_APP, 'mailto:', 'slack://user?', 'https://t.me/']);
  assert.ok(Object.isFrozen(CONTACT_LINK_ALLOWLIST));
  const root = repoRoot();
  const own = path.join(root, 'src', 'shared', 'contactlinks.ts');
  const files = walk(path.join(root, 'src'), []);
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  assert.ok(files.includes(own));
  const ownText = fs.readFileSync(own, 'utf8');
  for (const p of CONTACT_LINK_ALLOWLIST) assert.strictEqual(ownText.split(`'${p}'`).length - 1, 1, `${p} written once in contactlinks.ts`);
  // `mailto:` alone predates this spec (spec 080's mail links: `browserurl.ts` compares and builds with it), so it is allowed on its
  // own; a list is not: a file naming any of the four contact-only prefixes or their hosts, or an array literal that holds the bare
  // `'mailto:'` together with another scheme or prefix literal, is another copy.
  const contactOnly = [/teams\.microsoft\.com\/l\/chat/, /msteams:/, /slack:\/\/user/, /\/\/t\.me\//];
  const offenders: string[] = [];
  let bareMailto = 0;
  for (const f of files) {
    if (f === own) continue;
    const s = fs.readFileSync(f, 'utf8');
    bareMailto += mailtoLiterals(s).length;
    if (contactOnly.some((re) => re.test(s)) || mailtoInList(s)) offenders.push(path.relative(root, f));
  }
  assert.ok(bareMailto >= 3, `the scan sees spec 080's own mailto: literals (${bareMailto})`);
  assert.deepStrictEqual(offenders, [], 'another copy of the contact link prefixes');
});

// A seeded generator (mulberry32): the same 10,000 cases on every OS and run.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PIECES = ['a', 'Z', '7', ' ', '  ', '&', '#', '%', '%0A', '%26', '=', '?', '+', '/', ':', ';', ',', '"', "'", '!', '(', ')', '*', '~', '\\',
  '\r', '\n', '\r\n', '\0', '\t', '\u2028', '\u2029', '&message=x', '&body=x', '&text=x', '?cc=eve@example.invalid', '#frag', 'javascript:alert(1)',
  '\u{1F600}', '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}', '\u{1F1EA}\u{1F1F8}', '\u0645\u0631\u062d\u0628\u0627', '\u05e9\u05dc\u05d5\u05dd', '\u202e', '\u2066',
  '\u0430', '\u03bf', '\uff20', '\uff0e', '\u200b', '\ufeff', '\u4f60\u597d', '\u00e9', 'e\u0301', '\ud800', '\udc00', '\ufffd', '\u{10FFFF}'];
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
function genText(r: () => number): string {
  const n = r() < 0.05 ? 200 + Math.floor(r() * 800) : Math.floor(r() * 60);
  let s = '';
  for (let i = 0; i < n; i++) s += r() < 0.15 ? String.fromCodePoint(Math.floor(r() * 0x110000)) : pick(r, PIECES);
  return s;
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// FR-004's shape written again here, apart from the module, so the generator's idea of "valid" does not come from the code under test
const REF_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const REF_ADDRESS_RE = new RegExp(`^(?!\\.)(?!.*\\.\\.)[A-Za-z0-9._+-]{1,64}(?<!\\.)@(?:${REF_LABEL}\\.)+${REF_LABEL}$`);
const refAddressOk = (a: string): boolean => a.length <= 254 && REF_ADDRESS_RE.test(a) && /[A-Za-z]/.test(a.slice(a.lastIndexOf('.') + 1));
const word = (r: () => number, alphabet: string, n: number): string => Array.from({ length: n }, () => pick(r, alphabet.split(''))).join('');
function genChannel(r: () => number): { ch: LinkChannel; valid: boolean } {
  const kind = pick(r, ['teams', 'email', 'slack', 'telegram'] as const);
  const hostile = r() < 0.3;
  if (kind === 'teams' || kind === 'email') {
    const h = r();
    const a = hostile ? (h < 0.5 ? pick(r, HOSTILE_ADDRESSES) : h < 0.75 ? word(r, 'abc', 3) + pick(r, PIECES) + '@example.invalid' : 'alex@' + word(r, 'ab_-', 1 + Math.floor(r() * 5)) + '.' + pick(r, ['example', 'ex_ample']) + '.' + pick(r, ['invalid', 'inv_alid', 'io']))
      : word(r, 'abcxyz09._+-_', 1 + Math.floor(r() * 10)).replace(/^\.|\.$|\.\.+/g, 'q') + '@' + word(r, 'abc09', 2) + '.example.invalid';
    return { ch: kind === 'teams' ? { kind, upn: a } : { kind, address: a }, valid: refAddressOk(a) };
  }
  if (kind === 'slack') {
    const team = hostile ? pick(r, HOSTILE_SLACK) : 'T' + word(r, ALNUM, 2 + Math.floor(r() * 19));
    const user = hostile && r() < 0.5 ? pick(r, HOSTILE_SLACK).replace(/^T/, 'U') : pick(r, ['U', 'W']) + word(r, ALNUM, 2 + Math.floor(r() * 19));
    return { ch: { kind, team, user }, valid: /^T[A-Z0-9]{2,20}$/.test(team) && /^[UW][A-Z0-9]{2,20}$/.test(user) };
  }
  const username = hostile ? pick(r, HOSTILE_TELEGRAM) : 'a' + word(r, 'abcXYZ_09', 4 + Math.floor(r() * 28));
  return { ch: { kind, username }, valid: /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) && !TELEGRAM_RESERVED_PATHS.includes(username.toLowerCase()) };
}
const VALUE_RE = /^[A-Za-z0-9\-._~%]*$/;
const expectedNames = (kind: string, copyOnly: boolean): string[] =>
  ({ teams: copyOnly ? ['users'] : ['users', 'message'], email: copyOnly ? ['subject'] : ['subject', 'body'], slack: ['team', 'id'], telegram: copyOnly ? [] : ['text'] })[kind] as string[];

test('AC6 / SC-003: 10,000 generated channels and texts never give another prefix or an extra parameter', () => {
  const r = rng(0x084011);
  const seen = { url: 0, tooLong: 0, bad: 0, copyOnly: 0, app: 0 };
  for (let i = 0; i < 10_000; i++) {
    const { ch, valid } = genChannel(r);
    const text = genText(r);
    const copyOnly = r() < 0.25;
    const teamsApp = r() < 0.3;
    const res = buildContactLink(ch, text, { copyOnly, teamsApp });
    const where = `case ${i}: ${JSON.stringify(ch)} ${JSON.stringify(text).slice(0, 120)}`;
    if (!('url' in res)) {
      if (!valid) { assert.deepStrictEqual(res, { error: 'bad-channel' }, where); seen.bad++; continue; }
      assert.strictEqual(res.error, 'too-long', where);
      seen.tooLong++;
      continue;
    }
    assert.ok(valid, `a link from a refused channel: ${where}`);
    seen.url++;
    if (copyOnly) seen.copyOnly++;
    const url = res.url;
    const prefix = CONTACT_LINK_ALLOWLIST.filter((p) => url.startsWith(p));
    assert.strictEqual(prefix.length, 1, `prefix ${where}`);
    assert.ok(url.length <= URL_CAP && res.encodedLength === url.length, where);
    assert.ok(!/[\s\0#]/.test(url) && /^[\x21-\x7e]+$/.test(url), `only visible ASCII, no fragment: ${where}`);
    const u = new URL(url);
    assert.strictEqual(u.hash, '', where);
    const names = [...u.searchParams.keys()];
    assert.deepStrictEqual(names, expectedNames(ch.kind, copyOnly && ch.kind !== 'slack'), `parameters ${where}`);
    for (const part of u.search.slice(1).split('&').filter(Boolean)) assert.ok(VALUE_RE.test(part.slice(part.indexOf('=') + 1)), `value ${where}`);
    const t = wellFormed(text);
    if (ch.kind === 'teams') {
      if (teamsApp) seen.app++;
      assert.strictEqual(prefix[0], teamsApp ? TEAMS_APP : TEAMS_WEB, where);
      assert.strictEqual(u.pathname, '/l/chat/0/0');
      assert.strictEqual(u.searchParams.get('users'), ch.upn);
      if (copyOnly) assert.strictEqual(res.copyText, t); else assert.strictEqual(u.searchParams.get('message'), t, where);
    } else if (ch.kind === 'email') {
      assert.deepStrictEqual([u.protocol, u.pathname], ['mailto:', ch.address], where);
      const p = emailParts(text);
      assert.strictEqual(u.searchParams.get('subject'), p.subject, where);
      assert.ok(Array.from(p.subject).length <= SUBJECT_CODE_POINTS && !/[\r\n]/.test(p.subject), where);
      const firstLine = wellFormed(text).split(/\r\n|\r|\n/)[0];
      assert.ok(firstLine.startsWith(p.subject) && boundaries(firstLine).has(p.subject.length), `subject at a grapheme boundary: ${where}`);
      if (copyOnly) assert.strictEqual(res.copyText, p.body); else assert.strictEqual(u.searchParams.get('body'), p.body, where);
      assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(p.body), 'CRLF only');
    } else if (ch.kind === 'slack') {
      assert.deepStrictEqual([u.protocol, u.host, u.searchParams.get('team'), u.searchParams.get('id')], ['slack:', 'user', ch.team, ch.user], where);
      assert.deepStrictEqual([res.prefill, res.copyText], [false, t]);
    } else {
      assert.deepStrictEqual([u.protocol, u.host, u.pathname], ['https:', 't.me', '/' + ch.username], where);
      if (copyOnly) assert.strictEqual(res.copyText, t); else assert.strictEqual(u.searchParams.get('text'), t, where);
    }
    assert.strictEqual(res.prefill, !copyOnly && ch.kind !== 'slack');
  }
  // the generator really reaches every branch
  assert.ok(seen.url > 3_000 && seen.bad > 1_000 && seen.tooLong > 50 && seen.copyOnly > 500 && seen.app > 200, JSON.stringify(seen));
});
test('encodedLengthOf and encodeValue agree with an independent UTF-8 encoder', () => {
  const r = rng(7);
  for (let i = 0; i < 3_000; i++) {
    const s = wellFormed(genText(r));
    const e = encodeValue(s);
    assert.strictEqual(e, ref(s));
    assert.strictEqual(encodedLengthOf(s), e.length);
  }
  // the fallback for runtimes without toWellFormed gives the same text
  for (let i = 0; i < 2_000; i++) { const t = genText(r); assert.strictEqual(wellFormedFallback(t), wellFormed(t)); }
  // too-long reports the exact length the link would have had
  for (let i = 0; i < 300; i++) {
    const text = wellFormed(genText(r)) + '\u{1F600}'.repeat(200);
    const res = buildContactLink({ kind: 'teams', upn: UPN }, text);
    assert.deepStrictEqual(res, { error: 'too-long', encodedLength: (TEAMS_WEB + 'users=' + ENC_UPN + '&message=').length + ref(text).length });
  }
});

// Linear time on huge inputs (CPU time, generous limit; nothing near the 4,000-character text cap is slow)
const cpuMs = (fn: () => void): number => { const t = process.cpuUsage(); fn(); const d = process.cpuUsage(t); return (d.user + d.system) / 1000; };
test('200k characters well under a second, 2M linear', () => {
  for (const n of [200_000, 2_000_000]) {
    const big = ('\u{1F600} a&#%\n' + '\u00e9'.repeat(10)).repeat(Math.ceil(n / 18)).slice(0, n);
    const firstLine = 'w'.repeat(n);
    const ms = cpuMs(() => {
      assert.strictEqual((buildContactLink({ kind: 'teams', upn: UPN }, big) as { error: string }).error, 'too-long');
      assert.strictEqual(ok(buildContactLink({ kind: 'teams', upn: UPN }, big, { copyOnly: true })).copyText?.length, wellFormed(big).length);
      assert.strictEqual((buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, firstLine + '\nx') as { error: string }).error, 'too-long');
      assert.strictEqual(ok(buildContactLink({ kind: 'email', address: 'alex@example.invalid' }, firstLine, { copyOnly: true })).url, 'mailto:alex@example.invalid?subject=');
      assert.strictEqual(emailParts(firstLine + '\nx').subject.length, 78);
      ok(buildContactLink({ kind: 'slack', team: 'T12', user: 'U12' }, big));
      assert.strictEqual((buildContactLink({ kind: 'telegram', username: 'alex_example' }, '\ud800'.repeat(n)) as { error: string }).error, 'too-long');
    });
    // about 40 ms and 350 ms here; 200k must stay under a second, 2M is the linear backstop (a quadratic pass takes minutes)
    const limit = n === 200_000 ? 1_000 : 4_000;
    assert.ok(ms < limit, `${n} characters took ${ms.toFixed(0)} ms CPU`);
  }
});

console.log(`contactlinks: ${passed} tests passed`);
