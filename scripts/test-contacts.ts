/** Spec 084 T010 (FR-002..FR-006, FR-004's hostile list, SC-003, issue 701): the pure contacts model. `npm run test:contacts`. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONTACTS_LIMITS, REASONS, TELEGRAM_RESERVED, graphemes, addressOk, applyChange, checkedSerialize, cleanChannel, cleanContact, emptyContactsDoc, guessInitials, newId, parseContactsDoc,
  serializeContactsDoc, sortContacts,
} from '../src/shared/contacts';
import type { Contact, ContactsDoc, ContactChange } from '../src/shared/contacts';
import { utf8Len } from '../src/shared/notes';
import { HIDDEN_CHARS } from '../src/shared/redact';

const L = CONTACTS_LIMITS;
const T0 = new Date('2026-11-06T10:00:00.000Z');
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);
let seq = 7;
/** A seeded generator (deterministic) of uniform draws over 36 symbols; ids differ within a run. */
const rand = (n: number): number => { assert.strictEqual(n, 36, 'a uniform draw over 36 symbols, no modulo'); seq = (seq * 1103515245 + 12345) % 2147483648; return Math.floor((seq / 2147483648) * n); };
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const person = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, channels: [{ kind: 'email', address: `${name.split(' ')[0].replace(/[^A-Za-z]/g, '').toLowerCase() || 'x'}@example.invalid` }], ...extra });
const add = (doc: ContactsDoc, name: string, extra: Record<string, unknown> = {}): { doc: ContactsDoc; contact: Contact } => {
  const r = must(applyChange(doc, { op: 'add', fields: person(name, extra) }, T0, rand));
  return { doc: r.doc, contact: r.contact! };
};
const op = (doc: ContactsDoc, c: ContactChange, now = at(1)): ContactsDoc => must(applyChange(doc, c, now, rand)).doc;
const find = (doc: ContactsDoc, id: string): Contact => doc.contacts.find((c) => c.id === id)!;

// AC1: parseContactsDoc keeps valid contacts, drops a bad one, errors on a document it cannot read
const a1 = add(emptyContactsDoc(), 'Alex Example');
const raw = JSON.parse(serializeContactsDoc(a1.doc));
raw.contacts.push(
  { id: 'bad', name: 'x' },
  { ...raw.contacts[0], id: 'p-' + 'b'.repeat(L.personIdChars), name: '' },
  { ...raw.contacts[0], id: 'p-' + 'c'.repeat(L.personIdChars), source: 'robot' },
  { ...raw.contacts[0], id: 'p-' + 'd'.repeat(L.personIdChars), channels: [{ id: 'ch-aaaaaaaa', kind: 'email', address: 'a\nb@example.invalid' }] },
  raw.contacts[0],
);
const p = parseContactsDoc(JSON.stringify(raw));
assert.ok(p.ok && p.doc.contacts.length === 1 && p.dropped === 5, 'one good contact kept; four bad ones and a duplicate dropped and counted');
assert.strictEqual(parseContactsDoc('not json').ok, false);
assert.strictEqual(parseContactsDoc('[]').ok, false);
assert.strictEqual(parseContactsDoc('null').ok, false);
assert.strictEqual(parseContactsDoc(JSON.stringify({ version: 2, contacts: [] })).ok, false, 'unknown version');
assert.strictEqual(parseContactsDoc(JSON.stringify({ contacts: [] })).ok, false, 'no version');
assert.strictEqual(parseContactsDoc('x'.repeat(L.storeBytes + 1)).ok, false, 'over the derived cap is not read');
const padded = (n: number): string => JSON.stringify({ version: 1, contacts: [], pad: 'x'.repeat(n - '{"version":1,"contacts":[],"pad":""}'.length) });
assert.strictEqual(utf8Len(padded(L.storeBytes)), L.storeBytes);
assert.ok(parseContactsDoc(padded(L.storeBytes)).ok, 'a valid document of exactly the cap is read');
const tooBig = parseContactsDoc(padded(L.storeBytes + 1));
assert.ok(!tooBig.ok && /larger/.test(tooBig.error), 'a valid document one byte over the cap is refused as too large');
assert.ok(parseContactsDoc(JSON.stringify({ version: 1 })).ok, 'an empty document reads');
const dangling = parseContactsDoc(JSON.stringify({ version: 1, contacts: [{ ...raw.contacts[0], preferred: 'ch-zzzzzzzz' }] }));
assert.ok(dangling.ok && dangling.doc.contacts[0].preferred === raw.contacts[0].channels[0].id, 'a dangling preferred falls back to the first way');
const over = parseContactsDoc(JSON.stringify({ version: 1, contacts: Array.from({ length: L.contactsMax + 5 }, (_, i) => ({ ...raw.contacts[0], id: 'p-' + String(i).padStart(L.personIdChars, '0') })) }));
assert.ok(!over.ok && /more than/.test(over.error), 'more valid contacts than the cap is a file Durbar cannot read (FR-008), not cut');
const atCap = parseContactsDoc(JSON.stringify({ version: 1, contacts: [...Array.from({ length: L.contactsMax }, (_, i) => ({ ...raw.contacts[0], id: 'p-' + String(i).padStart(L.personIdChars, '0') })), { id: 'bad' }, { id: 'bad2' }] }));
assert.ok(atCap.ok && atCap.doc.contacts.length === L.contactsMax && atCap.dropped === 2, 'exactly the cap reads; bad entries beyond it are only dropped');
const recipesMany = (n: number) => JSON.stringify({ version: 1, recipes: Array.from({ length: n }, (_, i) => ({ id: 'r-' + String(i).padStart(L.recipeIdChars, '0'), kind: 'send', label: 'T', channelKind: 'teams', server: 'm365', tool: 't', args: '{}' })) });
assert.ok(parseContactsDoc(recipesMany(L.recipesMax)).ok && !parseContactsDoc(recipesMany(L.recipesMax + 1)).ok, 'recipes: the cap reads, one more is unreadable');
const rec = { id: 'r-aaaaaaaa', kind: 'send', label: 'Teams', channelKind: 'teams', server: 'm365', tool: 'send-chat-message', args: '{"to":"{{to}}","content":"{{text}}"}' };
const withRecipes = parseContactsDoc(JSON.stringify({ version: 1, recipes: [rec, { ...rec, id: 'x' }, { ...rec, id: 'r-bbbbbbbb', server: '' }], settings: { teamsApp: true } }));
assert.ok(withRecipes.ok && withRecipes.doc.recipes.length === 1 && withRecipes.dropped === 2 && withRecipes.doc.settings.teamsApp, 'recipes and settings are read, bad recipes dropped');

// AC2: FR-004's hostile addresses, each refused with the field's reason, for email and Teams
const hostile: Record<string, string> = {
  CR: 'a@example.invalid\r', LF: 'a@example.invalid\nBcc: x@example.invalid', 'CR LF in the middle': 'a\r\nb@example.invalid', cc: 'a@example.invalid?cc=x@example.invalid',
  message: 'a@example.invalid&message=hi', pct0A: 'a@example.invalid%0A', pct: 'a%40b@example.invalid', comma: 'a@example.invalid,b@example.invalid', semicolon: 'a@example.invalid;b@example.invalid',
  dquote: 'a"b@example.invalid', squote: "a'b@example.invalid", backtick: 'a`b@example.invalid', javascript: 'javascript:alert(1)@example.invalid', 'javascript with space': 'javascript: alert(1)',
  fullwidthAt: 'a＠example.invalid', smallAt: 'a﹫example.invalid', cyrillicLocal: 'pаco@example.invalid', cyrillicDomain: 'paco@exаmple.invalid', greekLocal: 'pacο@example.invalid',
  greekDomain: 'paco@exοmple.invalid', fullwidthDot: 'paco@example．invalid', ideographicDot: 'paco@example。invalid', zeroWidth: 'pa​co@example.invalid', zeroWidthDomain: 'paco@exam​ple.invalid',
  bom: '﻿paco@example.invalid', nbsp: 'pa co@example.invalid', space: 'pa co@example.invalid', tab: 'pa\tco@example.invalid', hash: 'paco@example.invalid#x', lt: '<paco@example.invalid>', gt: 'paco@example.invalid>',
  paren: 'paco(x)@example.invalid', backslash: 'pa\\co@example.invalid', slash: 'pa/co@example.invalid', colon: 'mailto:paco@example.invalid', twoAt: 'a@b@example.invalid', noAt: 'paco.example.invalid',
  noLocal: '@example.invalid', noDomain: 'paco@', oneLabel: 'paco@localhost', dotStart: '.paco@example.invalid', dotEnd: 'paco.@example.invalid', dotDot: 'pa..co@example.invalid',
  domainDash: 'paco@-example.invalid', domainDashEnd: 'paco@example-.invalid', emptyLabel: 'paco@example..invalid', trailingDot: 'paco@example.invalid.', ip: 'paco@[127.0.0.1]', numericTld: 'paco@example.123',
  nul: 'paco\u0000@example.invalid', del: 'paco\u007f@example.invalid', c1: 'paco\u0085@example.invalid', emoji: 'paco@exa😀mple.invalid', empty: '', long: 'a'.repeat(L.addressChars) + '@example.invalid',
  commaLocal: 'a,b@example.invalid', semiLocal: 'a;b@example.invalid', quoteLocal: 'a"b"@example.invalid', longLocal: 'a'.repeat(L.localChars + 1) + '@example.invalid', longLabel: 'paco@' + 'a'.repeat(L.domainLabelChars + 1) + '.invalid',
};
for (const [why, addr] of Object.entries(hostile)) {
  assert.strictEqual(addressOk(addr), false, `addressOk refuses: ${why}`);
  const e = cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: addr });
  assert.ok(!e.ok && e.field === 'address' && e.error === REASONS.address, `email refuses ${why} with its reason`);
  const t = cleanChannel({ id: 'ch-aaaaaaaa', kind: 'teams', upn: addr });
  assert.ok(!t.ok && t.field === 'upn' && t.error === REASONS.upn, `Teams refuses ${why} with its reason`);
  assert.strictEqual(cleanContact({ name: 'Sam Sample', channels: [{ id: 'ch-aaaaaaaa', kind: 'email', address: addr }] }).ok, false, `a contact refuses ${why}`);
}
for (const bad of [undefined, null, 5, {}, ['a@example.invalid']]) assert.strictEqual(addressOk(bad), false);
const pad = (n: number): string => Array.from({ length: Math.ceil(n / (L.domainLabelChars + 1)) }, () => 'b'.repeat(L.domainLabelChars - 1)).join('.');
const longest = 'a'.repeat(L.localChars) + '@' + (pad(L.addressChars - L.localChars - 1) + '.invalid').slice(-(L.addressChars - L.localChars - 1)).replace(/^[.-]+/, 'c');
assert.strictEqual(longest.length, L.addressChars, `a ${L.addressChars}-character address is built: ${longest.length}`);
for (const good of ['paco@example.invalid', 'a.b+tag_x-y@sub.example.invalid', 'A@B.CO', 'x@a-b.example.invalid', longest]) assert.ok(addressOk(good), `accepts ${good.slice(0, 40)}`);
assert.strictEqual(addressOk(longest + 'x'), false, 'one character more than the address cap is refused');
// Slack and Telegram follow their FR-003 patterns
const sl = (team: unknown, user: unknown): boolean => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team, user }).ok;
assert.ok(sl('T0123ABC', 'U0123ABC') && sl('T' + 'A'.repeat(L.slackIdMin), 'W' + '9'.repeat(L.slackIdMax)));
assert.ok(!sl('T' + 'A'.repeat(L.slackIdMin - 1), 'U0123ABC') && !sl('T' + 'A'.repeat(L.slackIdMax + 1), 'U0123ABC'), 'team length bounds');
assert.ok(!sl('T0123ABC', 'U' + 'A'.repeat(L.slackIdMin - 1)) && !sl('T0123ABC', 'U' + 'A'.repeat(L.slackIdMax + 1)), 'user length bounds');
assert.ok(!sl('U0123ABC', 'U0123ABC') && !sl('T0123ABC', 'T0123ABC') && !sl('t0123abc', 'U0123ABC') && !sl('T0123ABC', 'u0123abc') && !sl('T0123ABC\n', 'U0123ABC') && !sl('T01АBC', 'U0123ABC'), 'prefix, case, newline, look-alike');
const tg = (username: unknown): boolean => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'telegram', username }).ok;
assert.ok(tg('a' + 'b'.repeat(L.telegramMin)) && tg('A' + '_9'.repeat(L.telegramMax / 2 | 0) + 'z') && tg('a' + 'b'.repeat(L.telegramMax)));
assert.ok(!tg('a' + 'b'.repeat(L.telegramMin - 1)) && !tg('a' + 'b'.repeat(L.telegramMax + 1)) && !tg('1abcde') && !tg('_abcde') && !tg('abc de') && !tg('abc?de') && !tg('abc\nde') && !tg('abсde'), 'telegram bounds and characters');
assert.ok(!cleanChannel({ id: 'ch-aaaaaaaa', kind: 'fax', address: 'a@example.invalid' }).ok, 'unknown kind');
assert.ok(!cleanChannel({ id: 'nope', kind: 'email', address: 'a@example.invalid' }).ok, 'a bad channel id');
const stripped = must(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', upn: 'x', username: 'y', junk: 1, label: ' Work ', recipe: 'r-aaaaaaaa', to: 'a@example.invalid' })).channel;
assert.deepStrictEqual(stripped, { id: 'ch-aaaaaaaa', kind: 'email', label: 'Work', address: 'a@example.invalid', recipe: 'r-aaaaaaaa', to: 'a@example.invalid' }, 'only the fields of the kind are kept');
for (const [field, v] of [['label', 'x'.repeat(L.labelChars + 1)], ['label', 'a\nb'], ['to', 'x'.repeat(L.toChars + 1)], ['to', 'a\u0000b'], ['recipe', 'r-short']] as const) {
  const r = cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', [field]: v });
  assert.ok(!r.ok && r.field === field && r.error === REASONS[field], `${field} ${JSON.stringify(v).slice(0, 12)} refused with its reason`);
}
assert.ok(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: 'x'.repeat(L.labelChars), to: 'y'.repeat(L.toChars) }).ok, 'label and to at their caps');
// name, aliases, initials, notes
const cc = (o: Record<string, unknown>) => cleanContact({ name: 'Sam Sample', ...o });
assert.ok(!cc({ name: '' }).ok && !cc({ name: '   ' }).ok && !cc({ name: 'a\nb' }).ok && !cc({ name: 'x'.repeat(L.nameChars + 1) }).ok && cc({ name: 'x'.repeat(L.nameChars) }).ok && !cc({ name: 5 }).ok, 'name rules');
assert.deepStrictEqual(must(cc({ name: '  Sam   Sample ' })).fields.name, 'Sam Sample');
assert.ok(!cc({ aliases: ['a b'] }).ok && !cc({ aliases: [''] }).ok && !cc({ aliases: ['x'.repeat(L.aliasChars + 1)] }).ok && !cc({ aliases: ['é'] }).ok && cc({ aliases: ['x'.repeat(L.aliasChars), 'a.b_c-d'] }).ok, 'alias rules');
assert.deepStrictEqual(must(cc({ aliases: ['sam', 'SAM', 'Sam2'] })).fields.aliases, ['sam', 'Sam2'], 'a repeated alias is kept once');
assert.strictEqual(must(cc({})).fields.initials, 'SS');
assert.strictEqual(guessInitials('alex'), 'A');
assert.strictEqual(guessInitials('Alex B Example'), 'AB');
assert.strictEqual(guessInitials('😀 Sam'), 'S', 'a word without a letter or digit is skipped');
assert.strictEqual(must(cc({ initials: 'xy' })).fields.initials, 'xy');
assert.ok(!cc({ initials: 'xyz' }).ok && !cc({ initials: 'a\n' }).ok, 'initials 1..2');
assert.ok(cc({ notes: 'n'.repeat(L.notesChars) }).ok && !cc({ notes: 'n'.repeat(L.notesChars + 1) }).ok && !cc({ notes: 5 }).ok, 'notes cap');
assert.strictEqual(must(cc({ notes: 'a\r\nb\u0000\tc' })).fields.notes, 'a\nb\tc', 'notes keep line ends, lose other controls');
assert.ok(!cc({ channels: [{ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid' }, { id: 'ch-aaaaaaaa', kind: 'email', address: 'b@example.invalid' }] }).ok, 'a repeated channel id');
assert.ok(!cc({ channels: [{ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid' }], preferred: 'ch-bbbbbbbb' }).ok, 'preferred must be a channel');
assert.strictEqual(must(cc({})).fields.preferred, '');

// review of T010 (2026-11-07), finding 1: the guessed initials survive a round trip (upper-casing can lengthen a letter)
for (const n of ['ßen ßa', 'ﬀoo bar', 'ŉa b', 'ǆa ǆb', 'ﬃ ﬃ', '😀 Sam', 'ß']) {
  const g = guessInitials(n);
  assert.ok(graphemes(g).length >= 1 && graphemes(g).length <= L.initialsMax, `${n}: ${g}`);
  const r = add(emptyContactsDoc(), n);
  const back = parseContactsDoc(serializeContactsDoc(r.doc));
  assert.ok(back.ok && back.dropped === 0 && back.doc.contacts.length === 1 && back.doc.contacts[0].initials === r.contact.initials, `${n}: the contact is still there after a round trip`);
}
assert.strictEqual(guessInitials('ßen ßa'), 'SS');
// finding 2: a long list is refused before any loop over it (loose limit, no ratio)
{
  const t1 = Date.now();
  const huge = Array.from({ length: 40_000 }, (_, i) => 'a' + i);
  const r1 = cleanContact({ name: 'Sam Sample', aliases: huge });
  assert.ok(!r1.ok && r1.field === 'aliases' && r1.cap === true && r1.error === REASONS.aliasesCap, 'a huge alias list is refused with the alias cap');
  assert.ok(!cleanContact({ name: 'Sam Sample', channels: Array.from({ length: 40_000 }, () => ({ kind: 'email', address: 'a@example.invalid' })) }).ok);
  const million = '"a",'.repeat(1_000_000) + '"a"';
  assert.ok(utf8Len(million) < L.storeBytes, 'the million aliases fit the byte cap');
  const pr = parseContactsDoc(`{"version":1,"contacts":[{"id":"p-${'a'.repeat(L.personIdChars)}","name":"Sam Sample","aliases":[${million}],"createdAt":"${T0.toISOString()}","updatedAt":"${T0.toISOString()}","rev":1,"source":"typed"}]}`);
  assert.ok(pr.ok && pr.doc.contacts.length === 0 && pr.dropped === 1, 'a contact with a million aliases is dropped');
  assert.ok(Date.now() - t1 < 10_000, 'refused quickly (well under 10 s; it took 56 s for 40,000 before)');
}
// finding 3: format, bidi, invisible, separator and lone-surrogate characters are refused in every text field
{
  const bad: number[] = []; // every code point of HIDDEN_CHARS (the one list), tab, CR and LF
  const re = HIDDEN_CHARS;
  for (let cp = 0; cp <= 0x10ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; if (re.test(String.fromCodePoint(cp)) || cp === 0x09 || cp === 0x0a || cp === 0x0d) bad.push(cp); }
  for (const must of [0x202e, 0x2066, 0x2069, 0x200b, 0x200f, 0x2028, 0x2029, 0x00ad, 0xfeff, 0x3164, 0xfe0f, 0xe0041, 0x2800, 0x13441, 0x13442, 0x16fe4, 0x1d159, 0x2009, 0x202f, 0x09, 0x0a, 0x0d, 0x85]) assert.ok(bad.includes(must), `the walk covers U+${must.toString(16)}`);
  assert.ok(bad.length > 400, `the walk covers ${bad.length} code points`);
  const lone = ['\ud800', '\udbff', '\udc00', '\udfff', '\ud83d', '\ude00'];
  const probes = [...bad.map((cp) => String.fromCodePoint(cp)), ...lone];
  const fields: Array<[string, (x: string) => boolean]> = [
    ['name', (x) => cleanContact({ name: `Pa${x}co` }).ok],
    ['initials', (x) => cleanContact({ name: 'Paco', initials: `P${x}` }).ok],
    ['label', (x) => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: `W${x}` }).ok],
    ['handle', (x) => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: `h${x}` }).ok],
    ['to', (x) => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', to: `t${x}` }).ok],
    ['alias', (x) => cleanContact({ name: 'Paco', aliases: [`p${x}q`] }).ok],
  ];
  assert.strictEqual(cleanContact({ name: 'Paco\u2800' }).ok, false, 'a blank braille glyph reads as nothing');
  const NEAR_SPACE = /^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/; // names and labels fold these to a plain space (below); no other field does
  for (const [f, ok] of fields) { const accepted = probes.filter((x) => !(['name', 'label'].includes(f) && NEAR_SPACE.test(x))).filter(ok); assert.deepStrictEqual(accepted.map((x) => x.codePointAt(0)!.toString(16)), [], `${f}: nothing invisible or reversing is accepted`); }
  assert.strictEqual(cleanContact({ name: 'Pa\u202eoc' }).ok, false);
  for (const [f, ok] of fields.filter(([f]) => f !== 'alias')) assert.ok(ok('é') && ok('😀') && ok('Ж'), `${f}: ordinary letters, accents, emoji and Cyrillic names still pass`);
}
// review 2, finding 1: ZWNJ and ZWJ are allowed only between two letters or marks (name, label, Slack name, initials)
{
  // the legacy Malayalam chillu (a trailing ZWJ) is refused: a documented limit; the atomic chillu letters U+0D7A..U+0D7F are plain letters
  for (let cp = 0x0d7a; cp <= 0x0d7f; cp++) assert.ok(cleanContact({ name: `ന${String.fromCodePoint(cp)}മ` }).ok, `atomic chillu U+${cp.toString(16)} accepted`);
  assert.strictEqual(cleanContact({ name: 'ന\u0d4d\u200d' }).ok, false, 'legacy chillu at the end of a word is refused');
  assert.strictEqual(cleanContact({ name: 'ന\u0d4d\u200d മ' }).ok, false, 'legacy chillu before a space is refused');
  assert.ok(cleanContact({ name: 'ന\u0d4d\u200dമ' }).ok, 'a joiner inside a Malayalam word is accepted');
  const names = ['نرگس می\u200cخواهد', 'ന\u0d4d\u200dമ', 'क\u094d\u200dष', 'ന്‍', 'क्‍ष', 'نرگس می‌خواهد'];
  for (const n of names) {
    const lone = /[\u200c\u200d]$/.test(n);
    const r = cleanContact({ name: n });
    assert.strictEqual(r.ok, !lone, `${JSON.stringify(n)} ${lone ? 'ends in a joiner: refused' : 'accepted'}`);
    if (lone) continue;
    const added = add(emptyContactsDoc(), n);
    const back = parseContactsDoc(serializeContactsDoc(added.doc));
    assert.ok(back.ok && back.dropped === 0 && back.doc.contacts[0].name === n, `${JSON.stringify(n)} round-trips`);
    assert.ok(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: n }).ok, 'label takes it too');
    assert.ok(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: n }).ok, 'handle takes it too');
  }
  for (const j of ['\u200c', '\u200d']) {
    for (const [why, n] of Object.entries({ start: `${j}Paco`, end: `Paco${j}`, doubled: `Pa${j}${j}co`, 'after a space': `Pa ${j}co`, 'before a space': `Pa${j} co`, 'between emoji': `😀${j}😀`, 'emoji then letter': `😀${j}a`, 'letter then emoji': `a${j}😀`, 'family emoji': `👨${j}👩${j}👧`, 'only a joiner': j, 'after a digit': `1${j}2`, 'digit then letter': `1${j}a`, 'letter then digit': `a${j}1`, 'mark-less digit start': `9${j}b`, 'letter then digit end': `ab${j}7`, 'next to a dash': `a${j}-b` })) {
      assert.strictEqual(cleanContact({ name: n }).ok, false, `name: U+${j.charCodeAt(0).toString(16)} ${why} is refused`);
      assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: n }).ok, false, `label: ${why}`);
      assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: n }).ok, false, `handle: ${why}`);
    }
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', to: `a${j}b` }).ok, false, '`to` never takes a joiner');
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', to: `\u0646${j}\u0645` }).ok, false, '`to` takes no joiner even between Persian letters');
    assert.strictEqual(cleanContact({ name: 'Paco', initials: `a${j}b` }).ok, false, 'initials: Latin both sides');
    assert.strictEqual(cleanContact({ name: 'Paco', initials: `\u0646${j}\u0645` }).ok, true, 'initials: Persian letters keep their joiner');
    assert.strictEqual(cleanContact({ name: 'Paco', aliases: [`pa${j}co`] }).ok, false, 'aliases are ASCII only');
  }
}
// review 3, finding 2: a joiner between Latin, Greek or Cyrillic letters is refused (it makes `Paco` a look-alike); other scripts keep theirs
{
  const nm = (n: string): boolean => cleanContact({ name: n }).ok;
  for (const j of ['\u200c', '\u200d']) {
    for (const [why, n] of Object.entries({ latin: `Pa${j}co`, greek: `Πα${j}ρο`, cyrillic: `Па${j}ко`, 'latin + cyrillic': `a${j}а`, 'latin + greek': `a${j}ο`, 'accented latin both sides': `e\u0301${j}x`, 'latin, accent after the joiner': `a${j}e\u0301`, 'latin then mark then cyrillic': `a\u0301${j}б` })) {
      assert.strictEqual(nm(n), false, `U+${j.charCodeAt(0).toString(16)} ${why} is refused`);
      assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: n }).ok, false, `label ${why}`);
      assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: n }).ok, false, `handle ${why}`);
    }
    // mixed with a script that needs joiners: refused only when BOTH sides are Latin, Greek or Cyrillic
    assert.ok(nm(`Ali${j}\u0628`) && nm(`\u0628${j}Ali`), 'Latin next to Arabic is accepted (one side needs the joiner)');
    assert.ok(nm(`\u0928${j}\u0928`) && nm(`\u0d15${j}\u0d2e`), 'Persian-script, Devanagari and Malayalam letters keep theirs');
    assert.ok(nm(`\u0915\u094d${j}\u0937`), 'Devanagari consonant + virama + joiner + consonant');
  }
  assert.ok(nm('نرگس می\u200cخواهد'));
  // scripts that never use joiners: refused between two letters of the same script, mixed with Latin, or with a mark between
  const never: Record<string, [string, string]> = { Han: ['\u5c71', '\u7530'], Hangul: ['\uae40', '\ubbfc'], Katakana: ['\u30ab', '\u30ad'], Hiragana: ['\u3042', '\u3044'], Hebrew: ['\u05d0', '\u05d1'], Armenian: ['\u0531', '\u0532'], Georgian: ['\u10d0', '\u10d1'], Thai: ['\u0e01', '\u0e02'] };
  const uses: Record<string, [string, string]> = {
    Arabic: ['\u0628', '\u062a'], Persian: ['\u0645', '\u062e'], Syriac: ['\u0710', '\u0712'], Thaana: ['\u0780', '\u0781'], NKo: ['\u07ca', '\u07cb'], Mongolian: ['\u1820', '\u1821'],
    Devanagari: ['\u0915', '\u0937'], Bengali: ['\u0995', '\u09b7'], Gurmukhi: ['\u0a15', '\u0a38'], Gujarati: ['\u0a95', '\u0ab7'], Oriya: ['\u0b15', '\u0b37'], Tamil: ['\u0b95', '\u0bb7'],
    Telugu: ['\u0c15', '\u0c37'], Kannada: ['\u0c95', '\u0cb7'], Malayalam: ['\u0d15', '\u0d2e'], Sinhala: ['\u0d9a', '\u0dc2'], Khmer: ['\u1780', '\u179f'], Myanmar: ['\u1000', '\u1019'],
  };
  for (const j of ['\u200c', '\u200d']) {
    for (const [sc, [x, y]] of Object.entries(never)) {
      for (const [why, n] of Object.entries({ same: `${x}${j}${y}`, 'with a family name': `${x}${j}${y} ${x}${y}`, 'next to Latin': `a${j}${x}`, 'Latin after': `${x}${j}a`, 'past a mark': `${x}\u0301${j}${y}` })) {
        assert.strictEqual(nm(n), false, `${sc} ${why}: U+${j.charCodeAt(0).toString(16)} is refused`);
        assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: n }).ok, false, `${sc} label ${why}`);
      }
      assert.ok(nm(`${x}${j}\u0628`) && nm(`\u0628${j}${x}`), `${sc} next to Arabic: one side needs the joiner, accepted`);
    }
    for (const [sc, [x, y]] of Object.entries(uses)) {
      assert.ok(nm(`${x}${j}${y}`), `${sc}: U+${j.charCodeAt(0).toString(16)} accepted`);
      assert.ok(nm(`Ali${j}${x}`) && nm(`${x}${j}Ali`), `${sc}: Latin on one side stays accepted`);
    }
    assert.strictEqual(nm('\u5c71\u200c\u7530 \u592a\u90ce'), false, 'the look-alike of 山田 太郎 is refused');
    // the joiner script may sit past a combining mark on either side
    assert.ok(nm(`\u0915\u093f${j}\u5c71`), 'Devanagari letter + vowel sign, joiner, Han: accepted (the letter is found past the mark)');
    assert.ok(nm(`a${j}\u064e\u0628`), 'Latin, joiner, fatha + Arabic letter: accepted (the letter is found past the mark)');
    // an Arabic letter on one side is not enough when the other side is not a letter or mark
    const ar = '\u0628';
    for (const [why, n] of Object.entries({ start: `${j}${ar}`, end: `${ar}${j}`, 'after a space': `${ar} ${j}${ar}`, 'before a space': `${ar}${j} ${ar}`, doubled: `${ar}${j}${j}${ar}`, 'digit before': `1${j}${ar}`, 'digit after': `${ar}${j}1`, 'emoji before': `😀${j}${ar}`, 'emoji after': `${ar}${j}😀`, 'dash': `${ar}${j}-${ar}`, 'full stop': `${ar}.${j}${ar}` })) {
      assert.strictEqual(nm(n), false, `Arabic letter, U+${j.charCodeAt(0).toString(16)} ${why}: refused`);
    }
  }
  assert.ok(nm('\u5c71\u7530 \u592a\u90ce') && nm('\ud55c\uae00 \uc774\ub984'), 'plain Han and Hangul names are fine');
}
// review 5, finding 2: near-invisible spaces are folded to a plain space in names and labels, and ALL of them are refused in handles, `to`, initials, aliases, addresses and recipes
{
  const spaces = ['\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u202f', '\u205f', '\u3000'];
  for (const sp of spaces) {
    const n = must(cleanContact({ name: `M.${sp}Dupont` })).fields.name;
    assert.strictEqual(n, 'M. Dupont', `U+${sp.charCodeAt(0).toString(16)} in a name is stored as a plain space`);
    assert.strictEqual(must(cleanContact({ name: `  Alex${sp}${sp}Example${sp}` })).fields.name, 'Alex Example', 'collapsed and trimmed');
    assert.strictEqual(must(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: `Work${sp}mail` })).channel.label, 'Work mail', 'a label folds it too');
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: `h${sp}x` }).ok, false, 'the Slack name does not fold, and refuses the whole near-space set');
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', to: `t${sp}x` }).ok, false, '`to` does not fold, and refuses the whole near-space set');
    assert.strictEqual(cleanContact({ name: 'Paco', initials: `P${sp}` }).ok, false, 'initials refuse it too');
    const rr = parseContactsDoc(JSON.stringify({ version: 1, recipes: [{ ...rec, label: `a${sp}b` }] }));
    assert.ok(rr.ok && rr.doc.recipes.length === 0 && rr.dropped === 1, 'a recipe label refuses it');
    assert.strictEqual(cleanContact({ name: 'Paco', aliases: [`a${sp}b`] }).ok, false, 'aliases never take a space');
    assert.strictEqual(addressOk(`a${sp}b@example.invalid`), false, 'addresses never take a space');
  }
  // runs of different near-spaces collapse to one plain space, in a name and in a label
  assert.strictEqual(must(cleanContact({ name: 'Alex\u202f\u2009 \u3000Example' })).fields.name, 'Alex Example', 'name: a run of mixed spaces is one space');
  assert.strictEqual(must(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: 'Work\u202f\u2009mail' })).channel.label, 'Work mail', 'label: a run of mixed spaces is one space');
  assert.strictEqual(must(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: ' \u00a0Work \u3000 \u3000mail\u200a ' })).channel.label, 'Work mail', 'label: trimmed and collapsed');
  // a label of spaces only is no label (the stored doc and the read-back agree)
  for (const only of ['\u202f\u3000\u00a0', '   ', '\u2009']) {
    const r = must(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: only }));
    assert.ok(!('label' in r.channel), `label ${JSON.stringify(only)} is omitted`);
    const doc2 = add(emptyContactsDoc(), 'Alex Example', { channels: [{ kind: 'email', address: 'a@example.invalid', label: only }] });
    assert.ok(!('label' in doc2.contact.channels[0]), 'the stored channel has no label key');
    const back2 = parseContactsDoc(serializeContactsDoc(doc2.doc));
    assert.ok(back2.ok && back2.dropped === 0 && JSON.stringify(back2.doc) === JSON.stringify(doc2.doc), 'and the read-back is the same document');
  }
  const back = parseContactsDoc(serializeContactsDoc(add(emptyContactsDoc(), 'M.\u202fDupont').doc));
  assert.ok(back.ok && back.dropped === 0 && back.doc.contacts[0].name === 'M. Dupont', 'stored and read back with a plain space');
  assert.strictEqual(guessInitials('M.\u202fDupont'), 'MD');
  assert.strictEqual(cleanContact({ name: 'a\nb' }).ok, false, 'a newline is still refused');
  assert.strictEqual(cleanContact({ name: 'a\u2028b' }).ok, false, 'the line separator is still refused');
  assert.strictEqual(cleanContact({ name: 'a\u200bb' }).ok, false, 'a zero-width space is still refused');
  assert.strictEqual(cleanContact({ name: '\u202f' }).ok, false, 'a name of spaces only is empty');
}
// review 5, finding 1: initials follow the name rules (no leading mark, a cap of marks per cluster), and the guess always passes them
{
  const M = '\u0301';
  assert.strictEqual(cc({ initials: `${M}A` }).ok, false, 'a leading mark');
  assert.strictEqual(cc({ initials: `A${M.repeat(6)}` }).ok, false, 'A and six marks');
  assert.strictEqual(cc({ initials: `A${M.repeat(L.marksPerCluster + 1)}` }).ok, false, 'one mark over the cap');
  assert.ok(cc({ initials: `A${M.repeat(L.marksPerCluster)}` }).ok, 'at the cap');
  assert.ok(cc({ initials: `A${M}B${M}` }).ok, 'the cap is per cluster');
  const bad = parseContactsDoc(JSON.stringify({ version: 1, contacts: [{ ...JSON.parse(serializeContactsDoc(add(emptyContactsDoc(), 'Sam Sample').doc)).contacts[0], initials: `${M}S` }] }));
  assert.ok(bad.ok && bad.doc.contacts.length === 0 && bad.dropped === 1, 'a stored contact with a leading-mark initial is dropped');
  for (const n of ['\u0390' + M.repeat(3), '\u0390' + M.repeat(L.marksPerCluster) + ' \u0390' + M.repeat(L.marksPerCluster), 'e' + M.repeat(L.marksPerCluster) + ' x', 'ǰ' + M.repeat(3)]) {
    const g = guessInitials(n);
    assert.ok(cc({ initials: g }).ok, `${JSON.stringify(n)}: the guess ${JSON.stringify(g)} passes the initials rules`);
    assert.ok((g.match(/\p{M}/gu) ?? []).length <= L.marksPerCluster * L.initialsMax, 'marks are kept within the cap');
    const r = add(emptyContactsDoc(), n);
    const back2 = parseContactsDoc(serializeContactsDoc(r.doc));
    assert.ok(back2.ok && back2.dropped === 0 && back2.doc.contacts[0].initials === r.contact.initials, `${JSON.stringify(n)} round-trips`);
  }
}
// review 3, finding 3: a leading combining mark is refused, and so is a stack of marks on one cluster
{
  const M = '\u0301';
  for (const n of [`${M}Paco`, ` ${M}Paco`, `${M}`, `\u0308a`]) {
    assert.strictEqual(cleanContact({ name: n }).ok, false, `${JSON.stringify(n)}: a name cannot start with a combining mark`);
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: n }).ok, false, 'label');
    assert.strictEqual(cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: n }).ok, false, 'handle');
  }
  assert.strictEqual(cleanContact({ name: 'x' + M.repeat(30) }).ok, false, 'x + 30 accents is refused');
  assert.ok(cleanContact({ name: 'x' + M.repeat(L.marksPerCluster) }).ok, 'at the cap of marks per cluster');
  assert.ok(!cleanContact({ name: 'x' + M.repeat(L.marksPerCluster + 1) }).ok, 'one more mark is refused');
  assert.ok(!cleanContact({ name: 'ok ' + 'y' + M.repeat(L.marksPerCluster + 1) + ' ok' }).ok, 'in the middle of the name too');
  assert.ok(cleanContact({ name: ('x' + M.repeat(L.marksPerCluster) + ' ').repeat(3) }).ok, 'the cap is per cluster, not per name');
  assert.ok(!cleanChannel({ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid', label: 'x' + M.repeat(L.marksPerCluster + 1) }).ok, 'label');
  assert.ok(!cleanChannel({ id: 'ch-aaaaaaaa', kind: 'slack', team: 'T0123ABC', user: 'U0123ABC', handle: 'x' + M.repeat(L.marksPerCluster + 1) }).ok, 'handle');
  assert.ok(cleanContact({ name: 'e\u0301 é Ζ\u0301 क\u094d\u0937\u093f' }).ok, 'ordinary accents and Devanagari signs pass');
}
// review 3, finding 5: a favOrder out of range goes LAST among the favourites, in file order; the order is rebuilt dense
{
  const base = add(emptyContactsDoc(), 'Zoe Zero').contact;
  const mkRaw = (i: number, name: string, fav: boolean, order: unknown): Record<string, unknown> => ({ ...JSON.parse(JSON.stringify(base)), id: 'p-' + String(i).padStart(L.personIdChars, '0'), name, favourite: fav, favOrder: order, initials: undefined });
  const raws = [mkRaw(1, 'Late One', true, 999), mkRaw(2, 'Bea Bee', true, 7), mkRaw(3, 'Neg', true, -3), mkRaw(4, 'Fraction', true, 1.5), mkRaw(5, 'Ann Ay', true, 2), mkRaw(6, 'Text', true, 'x'), mkRaw(7, 'Plain', false, 5), mkRaw(8, 'Missing', true, undefined)];
  const r = parseContactsDoc(JSON.stringify({ version: 1, contacts: raws }));
  assert.ok(r.ok);
  const favs = r.ok ? sortContacts(r.doc.contacts).filter((c) => c.favourite) : [];
  assert.deepStrictEqual(favs.map((c) => c.name), ['Ann Ay', 'Bea Bee', 'Late One', 'Neg', 'Fraction', 'Text', 'Missing'], 'in-range first by number, the rest last in file order');
  assert.deepStrictEqual(favs.map((c) => c.favOrder), [0, 1, 2, 3, 4, 5, 6], 'dense');
  assert.strictEqual(r.ok && r.doc.contacts.find((c) => c.name === 'Plain')!.favOrder, 0, 'non-favourites carry 0');
  const reversed = parseContactsDoc(JSON.stringify({ version: 1, contacts: [...raws].reverse() }));
  assert.deepStrictEqual(reversed.ok && sortContacts(reversed.doc.contacts).filter((c) => c.favourite).map((c) => c.name), ['Ann Ay', 'Bea Bee', 'Missing', 'Text', 'Fraction', 'Neg', 'Late One'], 'the rest follow the file order');
}
// review 3, finding 6: Telegram page names are not chats
{
  const tg2 = (u: string) => cleanChannel({ id: 'ch-aaaaaaaa', kind: 'telegram', username: u });
  for (const n of TELEGRAM_RESERVED) for (const u of [n, n.toUpperCase(), n[0].toUpperCase() + n.slice(1), n.split('').map((c, i) => (i % 2 ? c : c.toUpperCase())).join('')]) {
    const r = tg2(u);
    assert.ok(!r.ok && r.field === 'username', `${u} is refused`);
    if (u.length >= 5 + 0 && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(u)) assert.strictEqual(r.ok === false && r.error, REASONS.telegramReserved, `${u}: the reserved-name reason`);
  }
  assert.ok(TELEGRAM_RESERVED.length >= 20 && ['share', 'joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'proxy', 'socks', 'login', 'setlanguage', 'confirmphone', 'invoice', 'giftcode', 'boost', 'contact', 'c', 's', 'm', 'iv', 'bg'].every((x) => TELEGRAM_RESERVED.includes(x)));
  for (const ok of ['shares', 'share_bot', 'myshare', 'logins', 'proxy1', 'boosted', 'Contacts', 'joinchat2']) assert.ok(tg2(ok).ok, `${ok} is a normal name`);
}
// review 3, finding 7: equal names and equal favOrder: the id decides, whatever the input order
{
  const twin = (id: string, fav: boolean): Contact => ({ ...add(emptyContactsDoc(), 'Same Name').contact, id: 'p-' + id.repeat(L.personIdChars), favourite: fav, favOrder: fav ? 0 : 0 });
  for (const fav of [true, false]) {
    const three = [twin('c', fav), twin('a', fav), twin('b', fav)];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const pm of perms) assert.deepStrictEqual(sortContacts(pm.map((i) => three[i])).map((c) => c.id[2]), ['a', 'b', 'c'], `favourite=${fav}: the id decides, input order ${pm}`);
  }
}
// review 2, finding 2: initials are counted and cut in grapheme clusters
{
  assert.strictEqual(guessInitials('🇪🇸'), '🇪🇸', 'a flag is one character when it is all there is');
  assert.strictEqual(guessInitials('Sam 🇪🇸'), 'S', 'an emoji word is skipped');
  assert.strictEqual(guessInitials('Paco (you)'), 'PY', 'the first letter of each word, not a bracket');
  assert.strictEqual(guessInitials('(x) [y]'), 'XY');
  assert.strictEqual(guessInitials('Alex 3rd'), 'A3', 'a digit counts');
  assert.strictEqual(guessInitials('--- Sam'), 'S', 'a word with no letter or digit is skipped');
  assert.strictEqual(guessInitials('(( ))'), '(', 'no letter or digit at all: the first character');
  assert.strictEqual(guessInitials('Sam 1\ufe0f\u20e3'), 'S1\ufe0f\u20e3', 'a keycap is one character');
  assert.strictEqual(guessInitials('👍🏽'), '👍🏽', 'a skin-tone emoji is one character');
  const greek = guessInitials('ΐ b');
  assert.strictEqual(graphemes(greek).length, 2, `accented Greek keeps its accent and the second word: ${JSON.stringify(greek)}`);
  assert.ok(greek.endsWith('B') && greek.length > 2, 'the accent is there');
  assert.strictEqual(guessInitials('éa b'), 'ÉB');
  assert.strictEqual(guessInitials('e\u0301a b'), 'E\u0301B', 'a letter with a combining accent is one character');
  for (const n of ['Sam 🇪🇸', '🇪🇸', '👍🏽', 'Sam 👍🏽', 'ΐ b', 'e\u0301a b', 'ßen ßa', 'ﬀoo bar', 'ŉa b', '🇪 🇸', '🇪🇸 🇫🇷 x', 'Paco (you)', '(( ))']) {
    const r = add(emptyContactsDoc(), n);
    const back = parseContactsDoc(serializeContactsDoc(r.doc));
    assert.ok(back.ok && back.dropped === 0 && back.doc.contacts[0].initials === r.contact.initials && graphemes(r.contact.initials).length <= L.initialsMax, `${JSON.stringify(n)}: ${JSON.stringify(r.contact.initials)} round-trips`);
  }
  for (const n of ['ن\u200cمی', 'ക\u200dമ', 'ن\u200cمی خ']) {
    const g = guessInitials(n);
    assert.ok(!/[\u200c\u200d]$/.test(g) && cc({ initials: g }).ok, `${JSON.stringify(n)}: the guess ${JSON.stringify(g)} has no joiner left at its end and reads back`);
    const r = add(emptyContactsDoc(), n);
    const back = parseContactsDoc(serializeContactsDoc(r.doc));
    assert.ok(back.ok && back.dropped === 0, `${JSON.stringify(n)} round-trips with initials ${JSON.stringify(r.contact.initials)}`);
  }
  assert.ok(cc({ initials: '🇪🇸' }).ok && cc({ initials: '🇪🇸🇫🇷' }).ok && !cc({ initials: '🇪🇸🇫🇷🇩🇪' }).ok, 'the validator counts clusters, not code points');
  assert.ok(!cc({ initials: 'e' + '\u0301'.repeat(L.initialsChars) }).ok, 'a cluster with a mountain of marks is over the character cap');
  const long = guessInitials('x' + '\u0301'.repeat(30) + ' y');
  assert.strictEqual(long, 'X' + '\u0301'.repeat(L.marksPerCluster) + 'Y', 'a stack of marks is cut to the cap and the second word still counts');
  assert.ok(cc({ initials: long }).ok, 'and it reads back');
  const jamo = '\u1100' + '\u1161'.repeat(20); // Hangul L + 20 V jamo: one cluster, all letters, no marks, 21 units
  assert.ok(graphemes(jamo).length === 1 && jamo.length > L.initialsChars, 'a long letter-only cluster');
  assert.strictEqual(cc({ initials: jamo }).ok, false, 'initials over the character cap are refused');
  assert.strictEqual(guessInitials(`${jamo} x`), '\u1100', 'the first cluster over the cap gives its first code point, never the next word\'s letter');
  const family = Array(3).fill('\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}').join('\u200d');
  assert.ok(graphemes(family).length === 1 && family.length > L.initialsChars, 'one cluster longer than the cap');
  assert.strictEqual(guessInitials(family), '\u{1f468}', 'a first cluster over the cap gives its first code point');
  const zalgo = guessInitials('e' + '\u0301'.repeat(100) + ' b');
  assert.ok(zalgo.length <= L.initialsChars, `a guess never exceeds the character cap (${zalgo.length})`);
  assert.ok(cc({ initials: zalgo }).ok, 'and it reads back');
  assert.strictEqual(guessInitials('क्‍ष क्‍ष').replace(/[^\u200c\u200d]/g, '').length <= 2, true);
  const dev = add(emptyContactsDoc(), 'क्‍ष क्‍ष');
  assert.ok(parseContactsDoc(serializeContactsDoc(dev.doc)).ok, 'a Devanagari conjunct in the guess reads back');
}
// AC3: stale rev; the 301st contact, the 9th channel and the 6th alias
const s0 = add(emptyContactsDoc(), 'Alex Example');
const e1 = must(applyChange(s0.doc, { op: 'update', id: s0.contact.id, rev: s0.contact.rev, fields: { notes: 'hello' } }, at(1), rand));
assert.strictEqual(e1.contact!.rev, 2);
assert.strictEqual(e1.contact!.updatedAt, at(1).toISOString());
const stale = applyChange(e1.doc, { op: 'update', id: s0.contact.id, rev: 1, fields: { notes: 'older' } }, at(2), rand);
assert.ok(!stale.ok && stale.code === 'stale' && stale.error === REASONS.stale && stale.current?.rev === 2, 'a stale rev is refused with stale and the saved contact');
for (const c of [{ op: 'delete' }, { op: 'star' }, { op: 'unstar' }, { op: 'moveUp' }, { op: 'moveDown' }] as const) {
  const r = applyChange(e1.doc, { ...c, id: s0.contact.id, rev: 1 }, at(2), rand);
  assert.ok(!r.ok && r.code === 'stale', `${c.op}: stale`);
}
assert.ok(JSON.stringify(e1.doc).includes('hello') && find(s0.doc, s0.contact.id).notes === '', 'the input document is never changed');
const missing = applyChange(e1.doc, { op: 'delete', id: 'p-' + 'z'.repeat(L.personIdChars), rev: 1 }, at(2), rand);
assert.ok(!missing.ok && missing.code === 'missing');
const same = must(applyChange(e1.doc, { op: 'update', id: s0.contact.id, rev: 2, fields: { notes: 'hello' } }, at(3), rand));
assert.strictEqual(same.contact!.rev, 2, 'an update that changes nothing keeps rev');
// the 301st contact
let full = emptyContactsDoc();
for (let i = 0; i < L.contactsMax; i++) full = add(full, `Person ${i}`).doc;
assert.strictEqual(full.contacts.length, L.contactsMax);
assert.strictEqual(new Set(full.contacts.map((c) => c.id)).size, L.contactsMax, 'distinct ids');
const c301 = applyChange(full, { op: 'add', fields: person('One More') }, at(1), rand);
assert.ok(!c301.ok && c301.code === 'cap' && c301.error === REASONS.contactsCap && /300/.test(c301.error), 'the 301st contact is refused');
assert.strictEqual(full.contacts.length, L.contactsMax);
// the 9th channel
const mkCh = (i: number): Record<string, unknown> => ({ kind: 'email', address: `p${i}@example.invalid` });
const eight = add(emptyContactsDoc(), 'Alex Example', { channels: Array.from({ length: L.channelsMax }, (_, i) => mkCh(i)) });
assert.strictEqual(eight.contact.channels.length, L.channelsMax);
assert.strictEqual(new Set(eight.contact.channels.map((c) => c.id)).size, L.channelsMax, 'channel ids are made');
assert.ok(eight.contact.channels.every((c) => /^ch-[a-z0-9]{8}$/.test(c.id)));
const nine = applyChange(eight.doc, { op: 'update', id: eight.contact.id, rev: 1, fields: { channels: [...eight.contact.channels, mkCh(9)] } }, at(1), rand);
assert.ok(!nine.ok && nine.code === 'cap' && nine.error === REASONS.channelsCap && /8/.test(nine.error), 'the 9th channel is refused');
const nineAdd = applyChange(emptyContactsDoc(), { op: 'add', fields: person('X', { channels: Array.from({ length: L.channelsMax + 1 }, (_, i) => mkCh(i)) }) }, T0, rand);
assert.ok(!nineAdd.ok && nineAdd.code === 'cap', 'the 9th channel on add');
// the 6th alias
const five = add(emptyContactsDoc(), 'Alex Example', { aliases: ['a1', 'a2', 'a3', 'a4', 'a5'] });
assert.strictEqual(five.contact.aliases.length, L.aliasesMax);
const six = applyChange(five.doc, { op: 'update', id: five.contact.id, rev: 1, fields: { aliases: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] } }, at(1), rand);
assert.ok(!six.ok && six.code === 'cap' && six.error === REASONS.aliasesCap && /5/.test(six.error), 'the 6th alias is refused');
// the preferred way survives edits of the channels
const two = add(emptyContactsDoc(), 'Alex Example', { channels: [mkCh(1), mkCh(2)] });
const second = two.contact.channels[1].id;
const pref = must(applyChange(two.doc, { op: 'update', id: two.contact.id, rev: 1, fields: { preferred: second } }, at(1), rand)).contact!;
assert.strictEqual(pref.preferred, second);
const keep = must(applyChange(two.doc, { op: 'update', id: two.contact.id, rev: 1, fields: { preferred: second } }, at(1), rand));
const edited = must(applyChange(keep.doc, { op: 'update', id: two.contact.id, rev: 2, fields: { channels: [...keep.contact!.channels, mkCh(3)] } }, at(2), rand)).contact!;
assert.strictEqual(edited.preferred, second, 'adding a way keeps the preferred one');
const dropped = must(applyChange(keep.doc, { op: 'update', id: two.contact.id, rev: 2, fields: { channels: [keep.contact!.channels[0]] } }, at(2), rand)).contact!;
assert.strictEqual(dropped.preferred, keep.contact!.channels[0].id, 'removing the preferred way falls back to the first');
const none = must(applyChange(keep.doc, { op: 'update', id: two.contact.id, rev: 2, fields: { channels: [] } }, at(2), rand)).contact!;
assert.strictEqual(none.preferred, '');
const dele = op(keep.doc, { op: 'delete', id: two.contact.id, rev: 2 });
assert.strictEqual(dele.contacts.length, 0);

// AC4: favourites keep a dense favOrder; the sorted list is favourites by favOrder, then by name
let f = emptyContactsDoc();
const ids: Record<string, string> = {};
for (const n of ['Zed Zero', 'Bea Bee', 'Cy Sea', 'Dee Dee', 'Alex Example']) { const r = add(f, n); f = r.doc; ids[n.split(' ')[0]] = r.contact.id; }
const rev = (n: string): number => find(f, ids[n]).rev;
const order = (): string[] => sortContacts(f.contacts).map((c) => c.name.split(' ')[0]);
const dense = (): void => {
  const favs = f.contacts.filter((c) => c.favourite).map((c) => c.favOrder).sort((x, y) => x - y);
  assert.deepStrictEqual(favs, favs.map((_, i) => i), `favOrder is dense: ${favs}`);
  assert.ok(f.contacts.filter((c) => !c.favourite).every((c) => c.favOrder === 0), 'non-favourites carry 0');
};
assert.deepStrictEqual(order(), ['Alex', 'Bea', 'Cy', 'Dee', 'Zed'], 'by name when nobody is a favourite');
for (const n of ['Zed', 'Cy', 'Alex']) { f = op(f, { op: 'star', id: ids[n], rev: rev(n) }); dense(); }
assert.deepStrictEqual(order(), ['Zed', 'Cy', 'Alex', 'Bea', 'Dee'], 'favourites in star order, then the rest by name');
f = op(f, { op: 'moveUp', id: ids.Alex, rev: rev('Alex') }); dense();
assert.deepStrictEqual(order(), ['Zed', 'Alex', 'Cy', 'Bea', 'Dee']);
f = op(f, { op: 'moveUp', id: ids.Alex, rev: rev('Alex') }); dense();
f = op(f, { op: 'moveUp', id: ids.Alex, rev: rev('Alex') }); dense();
assert.deepStrictEqual(order(), ['Alex', 'Zed', 'Cy', 'Bea', 'Dee'], 'moving the first up changes nothing');
f = op(f, { op: 'moveDown', id: ids.Alex, rev: rev('Alex') }); dense();
f = op(f, { op: 'moveDown', id: ids.Alex, rev: rev('Alex') }); dense();
f = op(f, { op: 'moveDown', id: ids.Alex, rev: rev('Alex') }); dense();
assert.deepStrictEqual(order(), ['Zed', 'Cy', 'Alex', 'Bea', 'Dee'], 'moving the last down changes nothing');
const before = rev('Zed');
f = op(f, { op: 'moveDown', id: ids.Zed, rev: before }); dense();
assert.deepStrictEqual(order(), ['Cy', 'Zed', 'Alex', 'Bea', 'Dee']);
assert.strictEqual(rev('Zed'), before + 1, 'a swap bumps both revs');
f = op(f, { op: 'unstar', id: ids.Cy, rev: rev('Cy') }); dense();
assert.deepStrictEqual(order(), ['Zed', 'Alex', 'Bea', 'Cy', 'Dee'], 'unstar closes the gap and the contact joins the rest by name');
assert.strictEqual(find(f, ids.Cy).favourite, false);
f = op(f, { op: 'delete', id: ids.Zed, rev: rev('Zed') }); dense();
assert.deepStrictEqual(order(), ['Alex', 'Bea', 'Cy', 'Dee']);
assert.strictEqual(find(f, ids.Alex).favOrder, 0, 'deleting a favourite closes the gap');
const nf = applyChange(f, { op: 'moveUp', id: ids.Bea, rev: rev('Bea') }, at(5), rand);
assert.ok(!nf.ok && nf.code === 'invalid' && nf.error === REASONS.notFavourite, 'only a favourite moves');
const starTwice = must(applyChange(f, { op: 'star', id: ids.Alex, rev: rev('Alex') }, at(6), rand));
assert.strictEqual(starTwice.contact!.rev, rev('Alex'), 'starring a favourite changes nothing');
// starring after a document with gaps puts the new favourite last and closes the gaps
const gaps: ContactsDoc = { ...emptyContactsDoc(), contacts: ['Ann', 'Ben', 'Cy'].map((n, i) => ({ ...add(emptyContactsDoc(), n).contact, id: 'p-' + String(i).padStart(L.personIdChars, '0'), favourite: i < 2, favOrder: [5, 9, 0][i] })) };
const starred = must(applyChange(gaps, { op: 'star', id: gaps.contacts[2].id, rev: gaps.contacts[2].rev }, at(1), rand));
assert.deepStrictEqual(sortContacts(starred.doc.contacts).map((c) => [c.name, c.favOrder]), [['Ann', 0], ['Ben', 1], ['Cy', 2]], 'star: dense, new favourite last');
// finding 4: every contact whose favourite number changes gets exactly one rev bump, the moved one at the edge too
{
  const mk = (n: string, i: number, order: number): Contact => ({ ...add(emptyContactsDoc(), n).contact, id: 'p-' + String(i).padStart(L.personIdChars, '0'), favourite: true, favOrder: order });
  const base: ContactsDoc = { ...emptyContactsDoc(), contacts: [mk('Ann', 1, 5), mk('Ben', 2, 9)] };
  const [ann, ben] = base.contacts;
  const edge = must(applyChange(base, { op: 'moveUp', id: ann.id, rev: ann.rev }, at(1), rand));
  assert.strictEqual(find(edge.doc, ann.id).favOrder, 0);
  assert.strictEqual(find(edge.doc, ann.id).rev, ann.rev + 1, 'moving the first favourite up: its number changed 5 -> 0, rev +1 exactly');
  assert.strictEqual(find(edge.doc, ben.id).rev, ben.rev + 1, 'and the neighbour renumbered 9 -> 1: rev +1 exactly');
  const swap = must(applyChange(base, { op: 'moveDown', id: ann.id, rev: ann.rev }, at(1), rand));
  assert.deepStrictEqual(sortContacts(swap.doc.contacts).map((c) => [c.name, c.favOrder]), [['Ben', 0], ['Ann', 1]]);
  assert.strictEqual(find(swap.doc, ann.id).rev, ann.rev + 1, 'a swap that also closes a gap: the moved one +1, not +2');
  assert.strictEqual(find(swap.doc, ben.id).rev, ben.rev + 1, 'and the neighbour +1, not +2');
  const clean = op(base, { op: 'moveUp', id: ann.id, rev: ann.rev });
  const again = must(applyChange(clean, { op: 'moveUp', id: ann.id, rev: find(clean, ann.id).rev }, at(2), rand));
  assert.strictEqual(find(again.doc, ann.id).rev, find(clean, ann.id).rev, 'a move that changes nothing keeps rev');
  const unstarGap = must(applyChange({ ...base, contacts: [...base.contacts, mk('Cy', 3, 12)] }, { op: 'unstar', id: ann.id, rev: ann.rev }, at(1), rand));
  assert.deepStrictEqual([find(unstarGap.doc, ann.id).rev, find(unstarGap.doc, ben.id).rev], [ann.rev + 1, ben.rev + 1], 'unstar: each changed contact +1 once');
  const delGap = must(applyChange({ ...base, contacts: [...base.contacts, mk('Cy', 3, 12)] }, { op: 'delete', id: ann.id, rev: ann.rev }, at(1), rand));
  assert.deepStrictEqual(delGap.doc.contacts.map((c) => [c.name, c.favOrder, c.rev]), [['Ben', 0, ben.rev + 1], ['Cy', 1, ann.rev + 1]], 'delete: the renumbered ones +1 once');
}
// finding 7: a channel id that is taken (by another contact, or by a channel made a moment ago) is drawn again
{
  const seqDraws = (vals: number[]): ((n: number) => number) => { let i = 0; return () => vals[i < vals.length ? i++ : vals.length - 1]; };
  const has = add(emptyContactsDoc(), 'Alex Example', { channels: [{ id: 'ch-aaaaaaaa', kind: 'email', address: 'a@example.invalid' }] });
  const eight = Array.from({ length: L.channelIdChars }, () => 0);
  const redraw = must(applyChange(has.doc, { op: 'add', fields: person('Sam Sample') }, T0, seqDraws([...eight, ...eight.map(() => 1), ...Array.from({ length: L.personIdChars }, () => 5)])));
  assert.strictEqual(redraw.contact!.channels[0].id, 'ch-bbbbbbbb', 'the id of another contact is not reused: drawn again');
  const twin = must(applyChange(emptyContactsDoc(), { op: 'add', fields: person('Sam Sample', { channels: [{ kind: 'email', address: 'a@example.invalid' }, { kind: 'email', address: 'b@example.invalid' }] }) }, T0, seqDraws([...eight, ...eight, ...eight.map(() => 1), ...Array.from({ length: L.personIdChars }, () => 5)])));
  assert.deepStrictEqual(twin.contact!.channels.map((c) => c.id), ['ch-aaaaaaaa', 'ch-bbbbbbbb'], 'two new channels of one contact never share an id');
  const stuck = applyChange(has.doc, { op: 'add', fields: person('Sam Sample') }, T0, () => 0);
  assert.ok(!stuck.ok && stuck.code === 'invalid', 'an id that stays taken is refused, never stored twice');
  const other = must(applyChange(has.doc, { op: 'add', fields: person('Sam Sample', { channels: [{ id: 'ch-hhhhhhhh', kind: 'email', address: 's@example.invalid' }] }) }, T0, rand));
  const clash = applyChange(other.doc, { op: 'update', id: has.contact.id, rev: 1, fields: { channels: [{ kind: 'email', address: 'z@example.invalid' }] } }, at(1), () => 7);
  assert.ok(!clash.ok && clash.code === 'invalid', 'update: an id that stays taken by another contact is refused');
}
// a document read with gaps and ties is made dense by the next operation, and sorting is stable
const gappy: ContactsDoc = { ...emptyContactsDoc(), contacts: ['Mo', 'Ann', 'Ben'].map((n, i) => ({ ...add(emptyContactsDoc(), n, {}).contact, id: 'p-' + String(i).padStart(L.personIdChars, '0'), favourite: true, favOrder: [7, 7, 2][i] })) };
assert.deepStrictEqual(sortContacts(gappy.contacts).map((c) => c.name), ['Ben', 'Ann', 'Mo'], 'ties by name');
const gd = op(gappy, { op: 'moveUp', id: gappy.contacts[0].id, rev: gappy.contacts[0].rev });
assert.deepStrictEqual(gd.contacts.map((c) => c.favOrder).sort(), [0, 1, 2]);
// locale compare, not code-point order
const lc = sortContacts(['Zoë', 'Émile', 'abe', 'Bob'].map((n) => ({ ...add(emptyContactsDoc(), n).contact })));
assert.deepStrictEqual(lc.map((c) => c.name), ['abe', 'Bob', 'Émile', 'Zoë'], 'names sort by locale compare');

// AC5: CONTACTS_LIMITS is the only place with caps; byte caps are derived; a store at every cap writes and reads back
assert.strictEqual(L.contactsMax, 300);
assert.strictEqual(L.channelsMax, 8);
assert.strictEqual(L.aliasesMax, 5);
assert.strictEqual(L.notesChars, 1000);
assert.strictEqual(L.recipesMax, 20);
assert.strictEqual(L.logEntries, 500);
assert.strictEqual(L.urlChars, 2000);
assert.strictEqual(L.textChars, 4000);
assert.strictEqual(L.addressChars, 254);
assert.strictEqual(L.channelJsonBytes, 3 * (L.labelChars + L.addressChars + L.labelChars + L.toChars + 2 * (L.slackIdMax + 1) + L.telegramMax + 1) + L.channelExtraBytes);
assert.strictEqual(L.contactJsonBytes, 3 * (L.nameChars + L.aliasesMax * L.aliasChars + L.initialsChars + L.notesChars) + L.channelsMax * L.channelJsonBytes + L.contactExtraBytes);
assert.strictEqual(L.recipeJsonBytes, 3 * (L.labelChars + L.serverChars + L.toolChars + L.argsChars) + L.recipeExtraBytes);
assert.strictEqual(L.storeBytes, L.contactsMax * L.contactJsonBytes + L.recipesMax * L.recipeJsonBytes + L.docExtraBytes);
assert.strictEqual(L.logBytes, L.logEntries * L.logEntryBytes + L.docExtraBytes);
assert.ok(L.storeBytes < 16 * 1024 * 1024, `the store cap (${L.storeBytes}) is below 16 MB`);
const SRC = path.join(__dirname, '..', '..', 'src');
for (const file of ['shared/contacts.ts']) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const body = src.replace(/export const CONTACTS_LIMITS = \(\(\) => \{[\s\S]*?\n\}\)\(\);/, '');
  assert.ok(body.length < src.length, 'the limits block was found');
  const numbers = (body.replace(/'[^'\n]*'|`[^`\n]*`/g, "''").match(/(?<![\w.$-])\d[\d_]*(?:\.\d+)?(?:e\d+)?\b/g) ?? []).filter((n) => !['0', '1', '2'].includes(n));
  assert.deepStrictEqual(numbers, [], `${file}: no cap number outside CONTACTS_LIMITS (found ${numbers})`);
  assert.ok(!/\$\{\s*\d/.test(body), `${file}: no number in a template`);
}
// a store at every cap (300 contacts, 8 channels of every kind at full length, 5 aliases, 1,000 three-byte or escaped characters of notes, 20 recipes) writes and reads back
const worstText = (ch: string, n: number): string => ch.repeat(Math.ceil(n / ch.length)).slice(0, n);
const bigAddr = ((): string => {
  const room = L.addressChars - L.localChars - 1;
  const labels: string[] = [];
  let left = room;
  while (left > L.domainLabelChars + 1) { labels.push('a'.repeat(L.domainLabelChars)); left -= L.domainLabelChars + 1; }
  labels.push('a'.repeat(left - 'bc'.length - 1) + '.bc');
  return 'x'.repeat(L.localChars) + '@' + labels.join('.');
})();
assert.ok(addressOk(bigAddr) && bigAddr.length <= L.addressChars, `bigAddr is valid (${bigAddr.length})`);
for (const ch of ['€', '"', '\\', '\n', '😀', '\t']) {
  const plain = ch === '\n' || ch === '\t' ? '"' : ch; // controls are refused outside the notes
  const doc = emptyContactsDoc();
  for (let i = 0; i < L.contactsMax; i++) {
    const channels = Array.from({ length: L.channelsMax }, (_, k) => {
      const base = { id: 'ch-' + String(k).padStart(L.channelIdChars, '0'), label: worstText(plain, L.labelChars), recipe: 'r-' + '9'.repeat(L.recipeIdChars), to: worstText(plain, L.toChars) };
      return k % 4 === 0 ? { ...base, kind: 'teams' as const, upn: bigAddr } : k % 4 === 1 ? { ...base, kind: 'email' as const, address: bigAddr }
        : k % 4 === 2 ? { ...base, kind: 'slack' as const, team: 'T' + '9'.repeat(L.slackIdMax), user: 'U' + '9'.repeat(L.slackIdMax), handle: worstText(plain, L.labelChars) }
        : { ...base, kind: 'telegram' as const, username: 'z' + '9'.repeat(L.telegramMax) };
    });
    doc.contacts.push({
      id: 'p-' + String(i).padStart(L.personIdChars, '0'), name: worstText(plain, L.nameChars), aliases: Array.from({ length: L.aliasesMax }, (_, k) => String(k).repeat(L.aliasChars)),
      initials: ch === '😀' ? '😀😀' : '€€', notes: worstText(ch, L.notesChars), channels, preferred: channels[0].id, favourite: true, favOrder: i, source: 'teams-import',
      createdAt: T0.toISOString(), updatedAt: T0.toISOString(), rev: L.revMax,
    });
  }
  for (let i = 0; i < L.recipesMax; i++) doc.recipes.push({ id: 'r-' + String(i).padStart(L.recipeIdChars, '0'), kind: 'send', label: worstText(plain, L.labelChars), channelKind: 'telegram', server: worstText(plain, L.serverChars), tool: worstText(plain, L.toolChars), args: worstText('"', L.argsChars) });
  doc.settings.teamsApp = true;
  const w = checkedSerialize(doc);
  assert.ok(w.ok, `a full store writes (${ch === '\n' ? 'newline' : ch})`);
  const bytes = utf8Len(w.text);
  assert.ok(bytes <= L.storeBytes, `${bytes} bytes fit the derived cap ${L.storeBytes}`);
  assert.strictEqual(Buffer.byteLength(w.text, 'utf8'), bytes, 'utf8Len is the byte length');
  const back = parseContactsDoc(w.text);
  assert.ok(back.ok && back.dropped === 0, `a full store reads back with nothing dropped (${ch === '\n' ? 'newline' : ch})`);
  assert.deepStrictEqual(back.ok && back.doc, doc, 'and equal');
  if (ch === '€') assert.ok(bytes > L.storeBytes * 0.35, `the worst case is a real fraction of the cap (${bytes} of ${L.storeBytes})`);
}
// one more than a cap is refused before any write, field by field
const bump = (mutate: (c: Contact, d: ContactsDoc) => void): ReturnType<typeof checkedSerialize> => { const d = JSON.parse(JSON.stringify(full)) as ContactsDoc; mutate(d.contacts[0], d); return checkedSerialize(d); };
assert.ok(checkedSerialize(full).ok);
assert.ok(!bump((_c, d) => { d.contacts.push({ ...d.contacts[0], id: 'p-' + 'q'.repeat(L.personIdChars) }); }).ok, 'the 301st contact is not serialised');
const rec21 = checkedSerialize({ ...emptyContactsDoc(), recipes: Array.from({ length: L.recipesMax + 1 }, (_, i) => ({ ...rec, id: 'r-' + String(i).padStart(L.recipeIdChars, '0') })) as never });
assert.ok(!rec21.ok && rec21.error === REASONS.recipesCap && !/contacts/.test(rec21.error), 'the 21st recipe is not serialised, with its own reason');
assert.ok(!checkedSerialize({ ...emptyContactsDoc(), recipes: [{ ...rec, args: 'x'.repeat(L.storeBytes) }] as never }).ok, 'over the byte cap is not serialised');
const upd = (c: Contact, fields: Record<string, unknown>) => applyChange(full, { op: 'update', id: c.id, rev: c.rev, fields }, at(1), rand);
const c0 = full.contacts[0];
for (const [name, ok, bad] of [
  ['name', 'n'.repeat(L.nameChars), 'n'.repeat(L.nameChars + 1)],
  ['notes', 'n'.repeat(L.notesChars), 'n'.repeat(L.notesChars + 1)],
  ['aliases', Array.from({ length: L.aliasesMax }, (_, i) => `a${i}`), Array.from({ length: L.aliasesMax + 1 }, (_, i) => `a${i}`)],
  ['aliases', ['x'.repeat(L.aliasChars)], ['x'.repeat(L.aliasChars + 1)]],
  ['channels', Array.from({ length: L.channelsMax }, (_, i) => mkCh(i)), Array.from({ length: L.channelsMax + 1 }, (_, i) => mkCh(i))],
  ['channels', [{ kind: 'email', address: 'a@example.invalid', label: 'l'.repeat(L.labelChars) }], [{ kind: 'email', address: 'a@example.invalid', label: 'l'.repeat(L.labelChars + 1) }]],
  ['channels', [{ kind: 'email', address: 'a@example.invalid', to: 't'.repeat(L.toChars) }], [{ kind: 'email', address: 'a@example.invalid', to: 't'.repeat(L.toChars + 1) }]],
  ['initials', 'ab', 'abc'],
] as const) {
  assert.ok(upd(c0, { [name]: ok }).ok, `${name}: at the cap is accepted`);
  assert.ok(!upd(c0, { [name]: bad }).ok, `${name}: one more is refused`);
}
// the limits object carries every cap the model uses (a change to one number moves the test)
assert.strictEqual(REASONS.notes, 'The notes are longer than 1000 characters.');

// AC6: ids come from an injected uniform random function over 36 symbols (no modulo)
const draws: number[] = [];
const spy = (n: number): number => { draws.push(n); return (draws.length * 5) % n; };
const pid = newId('p-', spy);
assert.ok(/^p-[a-z0-9]{12}$/.test(pid), pid);
assert.ok(draws.length === L.personIdChars && draws.every((n) => n === 36), 'p-: twelve draws, each uniform over 36');
draws.length = 0;
assert.ok(/^ch-[a-z0-9]{8}$/.test(newId('ch-', spy)) && draws.length === L.channelIdChars && draws.every((n) => n === 36));
draws.length = 0;
assert.ok(/^r-[a-z0-9]{8}$/.test(newId('r-', spy)) && draws.length === L.recipeIdChars && draws.every((n) => n === 36));
assert.strictEqual(newId('p-', () => 0), 'p-aaaaaaaaaaaa');
assert.strictEqual(newId('p-', () => 35), 'p-' + '9'.repeat(L.personIdChars));
assert.strictEqual(newId('ch-', (n) => n - 1), 'ch-99999999');
const seen = new Set<string>();
let state = 1;
const lcg = (n: number): number => { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor((state / 2147483648) * n); };
for (let i = 0; i < 2000; i++) seen.add(newId('p-', lcg));
assert.strictEqual(seen.size, 2000, 'ids differ');
// applyChange draws from the injected function only: a fixed one gives a fixed id, a taken id is redrawn
const fixed = must(applyChange(emptyContactsDoc(), { op: 'add', fields: person('Alex Example') }, T0, () => 3));
assert.strictEqual(fixed.contact!.id, 'p-dddddddddddd');
assert.strictEqual(fixed.contact!.channels[0].id, 'ch-dddddddd');
const clash = applyChange(fixed.doc, { op: 'add', fields: person('Sam Sample') }, T0, () => 3);
assert.ok(!clash.ok && clash.code === 'invalid', 'an id that is always taken gives up after a few draws');
let k = 0;
const redraw = must(applyChange(fixed.doc, { op: 'add', fields: person('Sam Sample', { channels: [] }) }, T0, (n) => (k++ < L.personIdChars ? 3 : 4 % n)));
assert.strictEqual(redraw.contact!.id, 'p-eeeeeeeeeeee', 'a taken id is drawn again');
assert.strictEqual(must(applyChange(emptyContactsDoc(), { op: 'add', fields: person('Alex Example'), source: 'teams-import' }, T0, rand)).contact!.source, 'teams-import');

// the model has no clock, random source or Node import of its own
const own = fs.readFileSync(path.join(SRC, 'shared/contacts.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.ok(!/Date\.now|new Date\(\)|Math\.random|crypto|from 'fs'|from 'path'|from 'electron'|require\(/.test(own), 'pure: no clock, random or Node import');
assert.deepStrictEqual([...own.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['./notes', './redact'], 'imports only the notes helpers and the one hidden-character list');

// speed on large input (loose limit)
const t0 = Date.now();
const bigRaw = checkedSerialize(full);
assert.ok(bigRaw.ok && parseContactsDoc(bigRaw.text).ok);
assert.ok(Date.now() - t0 < 5000, 'a full store parses in well under 5 s');

console.log('contacts: ok');
