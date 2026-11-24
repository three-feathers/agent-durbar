/** Unit test for secret redaction and the debug sink (spec 012 T051): `npm run test:runtime`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { MASK_INPUT_MAX, REDACT_MAX_CHARS, createDebugSink, _uncappedForTest, cut, maskSchemeSecrets, maskTokenShapes, maskTokenShapesUnguarded, maskSecretArgs, maskSecretCommand, maskHomePaths, maskHomePathsOutbound, maskSecretUrl, maskNoteText, maskOutgoing, maskGluedTail, maskSplitTokens, _breakCallsForTest, keepShownBy, _unionMasksForTest, withoutSplit, withoutShell, _shellRefsForTest, _shellPassesForTest, _shapePassesForTest, _runReadsForTest, ESC_RUN_SHELL_SOURCE, withoutLoose, maskLoose, _homeGuardReadsForTest, _homeGuardCharsForTest, _guardEdgeScanForTest, HOME_GUARD_WINDOW_FOR_TEST, _splitWorkForTest, withoutLinkSplit, withoutContinuation, _contWorkForTest, _contScanForTest, _contPassesForTest, redact, redactMarkdown, MARKDOWN_WORK, _markdownPassForTest, shQuote, splitCommand } from '../src/shared/redact';

import { assertLinearShape, assertWithinYardstick, cpuMs } from './redact-growth-lib';
import './safetext-shared'; // the desk's maskRaw (src/renderer/safetext.js) reads the compiled redact.ts, for the FR-181 differential below
// Growth and adversarial runs: `test-redact-growth.ts` (split by spec 012 T137, issue #1009; the helpers are in `redact-growth-lib.ts`).
const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const env = {
  GH_TOKEN: GH, // by name
  MY_API_KEY: 'abcd1234efgh', // by name, short value
  SOME_RANDOM_THING: 'zzzz-0123456789-qqqq-long', // by length only
  SHORT_TOKEN: 'abc', // too short to be a secret
  PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin', // long but excluded
  HOME: '/Users/somebody/very/long/home/directory',
  SPACED: 'this value is long but has spaces in it',
};

// spec 012 FR-185 (issue #1329; review of PR 1832, F2): words a GitHub shape must leave alone, checked first so a looser shape fails here, at its own label:
// a lower-case body at a token start, identifiers that end in a prefix's letters (glued, under the token's length, or of its length with no digit)
for (const keep of ['ghp_short', 'see ghs_count', 'wei' + 'ghs_' + 'TotalWeightKilograms', 'my' + 'ghs_' + 'ProcessingTimeForEachRequestInMillis', '%ZZ' + 'gh' + 'p_' + 'x'.repeat(36)]) {
  assert.strictEqual(redact(keep, {}), keep, `#1329 early near miss stays: ${keep}`);
}

{
  const r0 = _homeGuardReadsForTest();
  maskHomePaths('plain text with /home/alicez/x and C:\\Users\\bob\\y', []);
  assert.strictEqual(_homeGuardReadsForTest() - r0, 0, '#1329 F1 work (early): a text with no new home spelling is not read by redact');
}
// the last pass on the Markdown and desk masks, checked first (a cut GitHub token; invented pieces)
{
  const cutTok = 'gh' + 'p_' + 'R1t2Y3u4I5o6P7a8S9';
  const STe = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string };
  assert.ok(!redactMarkdown('see ' + cutTok, 'see ' + cutTok).includes('R1t2Y3u4'), '#1329 early: redactMarkdown hides a cut token');
  assert.ok(!STe.maskRaw('see ' + cutTok, (x) => redact(x, {})).includes('R1t2Y3u4'), '#1329 early: the desk maskRaw hides a cut token');
}

// spec 012 FR-188 (issue #1320): one token character written in an entity form or a percent-escape form left the whole token readable. The split step reads
// such a form as the character it stands for. Every value here is invented and built from pieces.
{
  const STe = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string };
  const surfaces: Array<[string, (t: string) => string]> = [
    ['redact', (t) => redact(t, {})],
    ['maskSecretCommand', (t) => maskSecretCommand(t, {})],
    ['maskSecretArgs', (t) => maskSecretArgs(t.split(' '), {}).join(' ')],
    ['maskOutgoing', (t) => maskOutgoing(t).text],
    ['maskNoteText', (t) => maskNoteText(t).text],
    ['desk maskRaw', (t) => STe.maskRaw(t, (x) => redact(x, {}))],
  ];
  const body = 'Zq3' + 'Wd8' + 'Kp2' + 'Lm5' + 'Rt7' + 'Yx4' + 'Bn6' + 'Hj9' + 'Fc1' + 'Vg0' + 'Ts3' + 'Qa8';
  const ghBody = body; // 36
  const tail = ghBody.slice(-12);
  // [label, text, a piece of the token that must not show]
  const hidden: Array<[string, string, string]> = [
    ['decimal entity of the prefix separator', 'gh' + 'p&#95;' + ghBody, tail],
    ['decimal entity without ;', 'gh' + 'p&#95' + ghBody, tail],
    ['hex entity', 'gh' + 'p&#x5f;' + ghBody, tail],
    ['hex entity without ;, upper case', 'gh' + 'p&#X5F' + ghBody, tail],
    ['named entity', 'gh' + 'p&lowbar;' + ghBody, tail],
    ['entity with leading zeros', 'gh' + 'p&#0095;' + ghBody, tail],
    ['entity of a prefix letter', 'g&#104;' + 'p_' + ghBody, tail],
    ['entity inside the body', 'gh' + 'p_' + ghBody.slice(0, 10) + '&#' + ghBody.charCodeAt(10) + ';' + ghBody.slice(11), tail],
    ['two entities with one character between', 'gh' + 'p_' + ghBody.slice(0, 20) + '&#x' + ghBody.charCodeAt(20).toString(16) + ';' + ghBody[21] + '&#x' + ghBody.charCodeAt(22).toString(16) + ';' + ghBody.slice(23), tail],
    // the scan takes every digit (a number that is no token character); the longest run of its first digits that is one is read, the rest stay text
    ['entity without ; whose number goes on', '1234' + '56789:AA' + body.slice(0, 31) + '&#56' + '8', body.slice(0, 12)],
    ['entity of the first character', '&#103;' + 'hp_' + ghBody, tail],
    ['entity of the last character', 'gh' + 'p_' + ghBody.slice(0, 35) + '&#' + ghBody.charCodeAt(35) + ';', '#' + ghBody.charCodeAt(35) + ';'],
    ['an entity in the rest after a break tag', 'sk-' + 'proj-' + body + '<wbr>' + 'Q' + '&#95;' + body.slice(0, 18), body.slice(6, 18)],
    ['percent escape', 'gh' + 'p%5F' + ghBody, tail],
    ['percent escape, lower case', 'gh' + 'p%5f' + ghBody, tail],
    ['percent escape encoded twice', 'gh' + 'p%255F' + ghBody, tail],
    ['percent escape in a URL query', 'curl "https://api.example/x?q=gh' + 'p%5F' + ghBody + '&y=1"', tail],
    ['entity of a dash in a project key', 'sk' + '&#45;proj-' + body + body, tail],
    ['percent escape of a dash in a project key', 'sk' + '%2Dproj-' + body + body, tail],
    ['entity of the colon of a bot token', '1234' + '56789&#58;AA' + body.slice(0, 33), body.slice(21, 33)],
    ['entity of a dot in a JWT', 'ey' + 'JhbGciOiJIUzI1NiJ9&#46;eyJzdWIiOiIxMjM0NTY3ODkwIn0&period;' + body + 'Xy7', body.slice(0, 12)],
    ['percent escape of a dot in a JWT', 'ey' + 'JhbGciOiJIUzI1NiJ9%2EeyJzdWIiOiIxMjM0NTY3ODkwIn0%2E' + body + 'Xy7', body.slice(0, 12)],
    ['an entity and a percent escape in one token', '1%3' + '23456789&#58;AA' + body.slice(0, 33), body.slice(21, 33)],
    // review of PR 1899: any number of leading zeros, and a percent escape re-encoded more than 8 times
    ['entity with many leading zeros', 'gh' + 'p&#' + '0'.repeat(12) + '95;' + ghBody, tail],
    ['hex entity with many leading zeros', 'gh' + 'p&#x' + '0'.repeat(9) + '5f;' + ghBody, tail],
    ['percent escape encoded ten times', 'gh' + 'p%' + '25'.repeat(9) + '5f' + ghBody, tail],
    ['inside an HTML code element', '<code>gh' + 'p&#95;' + ghBody + '</code>', tail],
    ['in a JSON string', '{"k":"gh' + 'p%5F' + ghBody + '"}', tail],
  ];
  for (const [label, text, piece] of hidden) {
    assert.ok(text.includes(piece), `#1320 decoded: the case holds its piece (${label})`);
    for (const [name, mask] of surfaces) {
      const out = mask(text);
      assert.ok(!out.includes(piece), `#1320 decoded: ${name} hides it (${label}): ${out}`);
    }
  }
  // a separator written in such a form: the value after the name is read as a value (accepted over-masking: the stretch starts right after the decoded character)
  const pv = 'Hq7' + 'Ln2' + 'Xv9';
  assert.ok(!redact('pass' + 'word&#61;' + pv, {}).includes(pv), '#1320 decoded: a value after a separator written as an entity is hidden');
  assert.ok(!redact('pass' + 'word%3D' + pv, {}).includes(pv), '#1320 decoded: a value after a separator written as a percent escape is hidden');
  // review of PR 1899: a letter of a secret name written in such a form (the value is read after the name)
  for (const named of ['pass' + 'w&#111;rd=', 'pass' + '%77ord=', 'pass' + '&#119;ord = ', 'to' + 'k&#x65;n: ']) {
    assert.ok(!redact(named + pv, {}).includes(pv), `#1320 decoded: a value after a secret name with a letter in such a form is hidden (${named.replace(/[a-z]+/g, 'n')})`);
  }
  // review of PR 1899: the decoded reading is a reading of its own, joined to the one before it: a fixed-length key split by a piece and followed by a glued form
  // stays hidden as main hides it (the decoded character after its end made it no key in that reading)
  const aiza = 'AI' + 'za' + 'Sy' + body.slice(0, 33);
  for (const piece of ['<b></b>', '\u200b', '&#8203;']) for (const glued of ['%5Fword', '&#95;word', '%2Dab']) {
    const t = aiza.slice(0, 4) + piece + aiza.slice(4) + glued;
    for (const [name, mask] of surfaces) assert.ok(!mask(t).includes(body.slice(10, 22)), `#1320 decoded: ${name} hides a split fixed-length key with a glued form (${piece.length} ${glued.slice(0, 3)})`);
  }
  // review of PR 1899, round 2: after a token with a decoded character, a keyword past a removed piece keeps its own rule (the stretch stops there), on the desk too
  {
    const ST2 = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string };
    const kpw = 'Hx9' + 'Kq2' + 'Lm7' + 'Np4' + 'Rs';
    for (const [label, t] of [
      ['GitHub', 'gh' + 'p_' + ghBody.slice(0, 30) + '&#' + ghBody.charCodeAt(30) + ';' + ghBody.slice(31) + '\u200bmysql -p' + kpw],
      ['Anthropic', 'sk-' + 'ant-api03-' + body.repeat(3) + '&#72' + 'Wx5Yz7' + '\u200bmysql -p' + kpw],
      // round 3: the decoded character is the first one of the stretch
      ['first character', '&#103;' + 'hp_' + ghBody + '\u200bmysql -p' + kpw],
    ] as Array<[string, string]>) {
      for (const [name, mask] of [['redact', (x: string) => redact(x, {})], ['desk maskRaw', (x: string) => ST2.maskRaw(x, (y) => redact(y, {}))], ['desk excerpt', (x: string) => ST2.excerpt(x, (y) => redact(y, {}))]] as Array<[string, (x: string) => string]>) {
        assert.ok(!mask(t).includes(kpw), `#1320 decoded: ${name} hides a password after a keyword that follows a decoded token and a piece (${label})`);
      }
      // round 3: the stretch stops at the piece, so the keyword stays for its own rule (redact keeps it; the desk, which masks a word its readings cut differently, keeps the flag)
      assert.ok(redact(t, {}).includes('mysql -p'), `#1320 decoded: redact keeps the keyword after a decoded token and a piece (${label})`);
      if (label === 'first character') assert.ok(ST2.maskRaw(t, (y) => redact(y, {})).includes('] -p['), `#1320 decoded: desk maskRaw keeps the flag after a decoded token and a piece (${label})`);
    }
  }
  // independent differential of PR 1899: the readings as before FR-188 keep their bounded entity, so a hidden-character entity with leading zeros inside a token reads as
  // it did (the digits after the bound are token text there); and the desk's own steps after the split step read a decoded mask as before (a decoded reading is a reference)
  {
    const ST3 = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string };
    const deskSurfaces: Array<[string, (t: string) => string]> = [['redact', (t) => redact(t, {})], ['desk maskRaw', (t) => ST3.maskRaw(t, (y) => redact(y, {}))], ['desk excerpt', (t) => ST3.excerpt(t, (y) => redact(y, {}))]];
    for (const [label, t, piece] of [
      ['decimal', 'gh' + 'p_' + ghBody.slice(0, 32) + '&#000' + '8203' + '1234', ghBody.slice(18, 30)],
      ['hex', 'x gh' + 'p_' + ghBody.slice(0, 32) + '&#x00' + '200b' + '5678 y', ghBody.slice(18, 30)],
      ['fixed-length key, hex', 'x AI' + 'za' + ghBody.slice(0, 31) + '&#x00' + '200b' + '5678 y', ghBody.slice(10, 22)],
      ['fixed-length key, decimal', 'x AI' + 'za' + ghBody.slice(0, 31) + '&#000' + '8203' + '5678 y', ghBody.slice(10, 22)],
    ] as Array<[string, string, string]>) {
      for (const [name, mask] of deskSurfaces) assert.ok(!mask(t).includes(piece), `#1320 decoded: ${name} reads a hidden-character entity with leading zeros as before (${label})`);
    }
    const dpw = 'Hx9' + 'Kq2' + 'Lm7' + 'Np4' + 'Rs';
    const t = 'Authorization: Bearer gh' + 'p_' + ghBody.slice(0, 10) + '&#' + ghBody.charCodeAt(10) + ';' + ghBody.slice(11) + '\u200bmysql -p' + dpw;
    for (const [name, mask] of deskSurfaces) assert.ok(!mask(t).includes(dpw), `#1320 decoded: ${name} hides a password after a header, a decoded token, a hidden character and a keyword`);
  }
  // round 5: with the decoded reading off, a word is read as written (the brain's reference reading reads header names as before FR-188)
  {
    const R5 = require(path.join(__dirname, '..', 'src', 'shared', 'redact')) as { decodeTokenForms(t: string): string; withoutDecode<T>(fn: () => T): T };
    assert.strictEqual(R5.decodeTokenForms('Authorizatio' + '%6e:'), 'Authorization:', '#1320 decoded: decodeTokenForms reads a header name in such a form');
    assert.strictEqual(R5.withoutDecode(() => R5.decodeTokenForms('Authorizatio' + '%6e:')), 'Authorizatio' + '%6e:', '#1320 decoded: decodeTokenForms reads a word as written with the decoded reading off');
  }
  // near misses: text with such forms and no token stays byte for byte
  const keep = [
    'R&amp;D &#169; 2024 &mdash; build_v1.2.3',
    'see https://example.com/a%2Fb/c%3Fd%3D1&amp;e=2',
    'path C%3A%5CUsers%5CPublic%5Cdocs_v2',
    'foo&#95;bar&#95;baz_helper()',
    'query?q=hello%5Fworld%5F2&page=3',
    'v1&#46;2&#46;3 release_notes',
    'MyComponent&#46;render&#40;&#41;',
    'a%2Bb%3Dc%2Fd and 50%25 done',
    'https%3A%2F%2Fgithub.com%2Forg%2Frepo%2Fpull%2F12',
    'user_name&#58;admin_role',
    '&#x1F600; and &#8364;100',
  ];
  for (const k of keep) {
    assert.strictEqual(redact(k, {}), k, `#1320 decoded near miss stays: ${k}`);
    assert.strictEqual(maskSplitTokens(k), k, `#1320 decoded near miss stays (split step): ${k}`);
  }
  // a form that stands for no token character is not read as one: a token cut by it stays apart, as on main
  assert.strictEqual(maskSplitTokens('gh' + 'p&#169;' + ghBody), 'gh' + 'p&#169;' + ghBody, '#1320 decoded: a form of a character that is no token character is not read');
  // linear: long runs of the forms, alone and inside tokens
  assertLinearShape('#1320 decoded: redact a run of percent escapes', (x) => { redact(x, {}); }, (k) => 'a%2F'.repeat(Math.ceil(k / 4)).slice(0, k), 200_000);
  assertLinearShape('#1320 decoded: redact a run of entities', (x) => { redact(x, {}); }, (k) => 'b&#95;'.repeat(Math.ceil(k / 6)).slice(0, k), 200_000);
  assertLinearShape('#1320 decoded: redact an entity with a long run of leading zeros', (x) => { redact(x, {}); }, (k) => 'gh' + 'p&#' + '0'.repeat(Math.max(1, k - 8)) + '39', 200_000);
  const unit = 'x gh' + 'p%5F' + ghBody + ' ';
  assertLinearShape('#1320 decoded: redact many decoded tokens', (x) => { redact(x, {}); }, (k) => unit.repeat(Math.ceil(k / unit.length)).slice(0, k), 200_000);
}

// spec 012 FR-190 (issue #1320): a value split across a line break after a secret name kept part of it readable. The split step reads the text once more with such breaks removed. Every value here is invented and built from pieces.
{
  const STc = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string };
  const surfaces: Array<[string, (t: string) => string]> = [
    ['redact', (t) => redact(t, {})],
    ['maskSecretCommand', (t) => maskSecretCommand(t, {})],
    ['maskSecretArgs', (t) => maskSecretArgs(t.split(' '), {}).join(' ')],
    ['maskOutgoing', (t) => maskOutgoing(t).text],
    ['maskNoteText', (t) => maskNoteText(t).text],
    ['desk maskRaw', (t) => STc.maskRaw(t, (x) => redact(x, {}))],
    ['desk excerpt', (t) => STc.excerpt(t, (x) => redact(x, {}))],
  ];
  const v1 = 'Qz7' + 'Wx4' + 'Lk9';
  const v2 = 'Rt3' + 'Mn8' + 'Pb5';
  const names = ['API_' + 'KEY=', '--to' + 'ken=', 'GH_' + 'TOKEN=', 'Authorization: ' + 'Bearer ', 'pass' + 'word=', 'DB_' + 'PASSWORD=', 'export OPENAI_' + 'API_KEY=', 'X-Api-' + 'Key: ', 'set GH_' + 'TOKEN=', 'client_' + 'secret=', 'to' + 'ken: '];
  const breaks: Array<[string, string]> = [['form 1', '\\\n'], ['form 2', '\\\r\n'], ['form 3', '^\r\n'], ['form 4', '\n'], ['form 5', '\r\n']];
  // every word the reading without the step hides stays hidden with it (the head may hide more, never less)
  const wordsShown = (t: string, head: string, ref: string): string[] => t.split(/[\s\\^]+/).filter((w) => w.length >= 3 && !ref.includes(w) && head.includes(w));
  for (const n of names) for (const [bk, b] of breaks) for (const tail of ['', ' done', '\nnext step']) {
    const t = n + v1 + b + v2 + tail;
    for (const [sn, mask] of surfaces) {
      const out = mask(t);
      assert.ok(!out.includes(v1) && !out.includes(v2), `#1320 continuation: ${sn} hides both parts (${n.replace(/[A-Za-z_]+/g, 'n')} ${bk}${tail ? ' +' + tail.length : ''}): ${JSON.stringify(out)}`);
      assert.deepStrictEqual(wordsShown(t, out, withoutContinuation(() => mask(t))), [], `#1320 continuation: ${sn} shows nothing the reading without the step hides (${bk})`);
    }
  }
  // some forms join whatever part follows them
  for (const [bk, b] of breaks.slice(0, 3)) {
    const low = 'qwr' + 'tzp' + 'sdf' + 'ghj';
    assert.ok(!redact('API_' + 'KEY=' + v1 + b + low, {}).includes(low), `#1320 continuation: a second part of another spelling is hidden (${bk})`);
  }
  // a value over three lines
  for (const b of ['\n', '\r\n']) {
    const v3 = 'Hc6' + 'Jd7' + 'Ke8';
    assert.ok(!redact('API_' + 'KEY=' + v1 + b + v2 + b + v3, {}).includes(v3), `#1320 continuation: the third line of a value is hidden (${JSON.stringify(b)})`);
  }
  // the reading without the step reads as before (the reference of the union)
  assert.ok(withoutContinuation(() => redact('API_' + 'KEY=' + v1 + '\n' + v2, {})).includes(v2), '#1320 continuation: withoutContinuation reads as before the step');
  // the note and outgoing masks keep the union with the reading without the step: a text that reading hides whole stays hidden whole
  {
    const t = 'cd src \\\n--pass' + 'word sk-' + 'proj-' + v1 + 'Ab^\r\n' + v2 + 'Cd4Ef5Gh6Jk7 \\\n--to' + 'ken=' + v1 + 'Lm\n' + 'Rj' + 'S73';
    for (const [sn, mask] of [['maskOutgoing', (x: string) => maskOutgoing(x).text], ['maskNoteText', (x: string) => maskNoteText(x).text]] as Array<[string, (x: string) => string]>) {
      assert.ok(!mask(t).includes('Rj' + 'S73'), `#1320 continuation: ${sn} keeps the union with the reading without the step: ${JSON.stringify(mask(t))}`);
    }
  }
  // the command mask keeps it too
  {
    const t = '--to' + 'ken=Kd4' + 'Xw8Mn2Pq7\n  Lp5Rv3' + 'Bt9Hw6\nuser@example.com\nto' + 'ken: gh' + 'p_Qa1Ws2Ed3\\\r\nRf4Tg5Yh6Uj7Ik8Ol9Pz0Xc1Vb2N"\nAPI_' + 'KEY=Zx9Cv8Bn7Mm6\n\nWq5' + 'Er4Ty\nPATH=/usr/bin\nBearer xo' + 'xb-123456789012-R\nTy7Ui8Op9As"';
    assert.ok(!maskSecretCommand(t, {}).includes('Wq5' + 'Er4Ty'), `#1320 continuation: maskSecretCommand keeps the union with the reading without the step: ${JSON.stringify(maskSecretCommand(t, {}))}`);
  }
  // and the desk (`contBoth`)
  {
    const t = 'to' + 'ken: Gk7' + 'Lm2Np9Qr4St6Uv\nWx3' + 'Yz8Ab5Cd1Ef\n--pass' + 'word xo' + 'xb-123456789012-Hj4Kl7Mn2Pq9Rs5Tv\n  Bw8' + 'Cx3Dy6Ez1Fa4Gb"';
    const red = (x: string): string => redact(x, {});
    const out = STc.maskRaw(t, red);
    assert.deepStrictEqual(wordsShown(t, out, withoutContinuation(() => STc.maskRaw(t, red))), [], `#1320 continuation: desk maskRaw keeps the union with its reading without the step: ${JSON.stringify(out)}`);
  }
  // review of PR 2001: the command mask also reads the command as a shell does, so a flag's value split by a continuation is one word; continuations in an ordinary
  // command stay as written
  {
    const w1 = 'Qz7' + 'Wx4' + 'Lk9' + 'Tb2', w2 = 'Rt3' + 'Mn8' + 'Pb5' + 'Hc6';
    for (const [bk, b] of breaks.slice(0, 3)) {
      for (const flag of ['--pass' + 'word ', '--to' + 'ken ', '--pass' + 'word=']) {
        const out = maskSecretCommand(flag + w1 + b + w2, {});
        assert.ok(!out.includes(w1) && !out.includes(w2), `#1320 continuation: maskSecretCommand hides a flag value split by a continuation (${bk}, ${flag.length}): ${JSON.stringify(out)}`);
      }
    }
    for (const k of ['npm run build \\\n  --watch', 'echo abc\\\ndef', 'cd src ^\r\n&& dir']) {
      assert.strictEqual(maskSecretCommand(k, {}), withoutContinuation(() => maskSecretCommand(k, {})), `#1320 continuation: an ordinary command with a continuation reads as before (${JSON.stringify(k)})`);
    }
    // the marks themselves stay, alone or glued to a word, when the joined reading hides something elsewhere
    const tk0 = 'gh' + 'p_' + 'VeLcXJQf4cb27' + 'Q'.repeat(23);
    assert.strictEqual(maskSecretCommand('echo abc\\\n def ' + tk0, {}), 'echo abc\\ def [redacted]', '#1320 continuation near miss: a word glued to a continuation stays when a token elsewhere is hidden');
    assert.ok(maskSecretCommand('--pass' + 'word ' + w1 + '\\\n' + w2 + ' \\\n  --verbose', {}).endsWith(' \\ --verbose'), '#1320 continuation near miss: a later continuation mark and flag stay after a split value is hidden');
    // every platform's line break: a break of one character of the older form is joined too
    assert.ok(!redact('API_' + 'KEY=' + w1 + '\r' + w2, {}).includes(w2), '#1320 continuation: a value split by the one-character break of the older form is hidden');
    assert.strictEqual(redact('line one\rline two\rline 3', {}), 'line one\rline two\rline 3', '#1320 continuation near miss stays: lines split by the older one-character break');
    // review of PR 2001: a known token whose parts sit on three lines, no two of them a token alone, is hidden whole; a line that only starts like a token stays
    for (const b of ['\n', '\r\n']) {
      const t5 = 'x gh' + 'p_' + 'Ab12Cd34Ef' + b + 'Gh56Ij78Kl90Mn' + b + 'Op12Qr34St56 y';
      for (const [sn, mask] of surfaces) {
        const out = mask(t5);
        assert.ok(!out.includes('Ab12Cd34') && !out.includes('Gh56Ij78') && !out.includes('Op12Qr34'), `#1320 continuation: ${sn} hides a token over three lines (${JSON.stringify(b)}): ${JSON.stringify(out)}`);
      }
    }
    for (const k of ['gh' + 'p_short\nAb3Cd4Ef5Gh6\nRelease2024Notes', 'gh' + 'p_short\nREADME.md\nnext step', 'the npm_config value\nBuild2024Release\nVersion2025Notes']) {
      assert.strictEqual(redact(k, {}), k, `#1320 continuation near miss stays: a line that only starts like a token (${JSON.stringify(k)})`);
    }
    // the mask-end trim: a mask already in the text at the end of a stretch is no part of it, so the word after it stays
    const tk = 'gh' + 'p_' + 'VeLcXJQf4cb27' + 'Q'.repeat(23);
    const t6 = 'to' + 'ken: API_' + 'KEY=' + tk + '\\\nAb3Cd4Ef5Gh6pass' + 'word=[redacted] Ab3Cd4Ef5Gh6.';
    assert.ok(maskSplitTokens(t6).endsWith(' Ab3Cd4Ef5Gh6.'), `#1320 continuation near miss: the word after a mask that ends a stretch stays: ${JSON.stringify(maskSplitTokens(t6))}`);
  }
  // review of PR 2001, round 2: the command read as a shell reads it counts as the continuation reading hiding something (`contReads`), so the desk's run label and
  // the permission card (`maskLabel`, `maskLabelPair`, through `contBoth`) take their own reading without the step and keep the union. Five composed texts of the
  // review (invented values, built from pieces): each listed piece is hidden with the step off, and stays hidden with it on, on all three surfaces
  {
    const STl = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskLabel(t: string, k: string, m: Record<string, unknown>): string; maskLabelPair(t: string, k: string, m: Record<string, unknown>): { text: string; ref: string } };
    const lm = { cmd: (x: string) => maskSecretCommand(x, {}), url: (x: string) => maskSecretUrl(x, {}), redact: (x: string) => redact(x, {}) };
    const rows: Array<[string, string, number]> = [
    [['curl -', 'H "eyJ', 'xHreLZ', 'HvQACy', 'NWTFU4', 'M7.eyJ', 'v\u202e^\u000d\u000a\u00ad', '    uZ', 'HNLZtD', 'FlzJoq', 'YlkC3Y', 'DLYupb', '7an.jX', 'XTq_ze', 'WNilyd', 'PkMKnX', 'uxW6lu', 'II8d G', 'H_TOKE', 'N=4283', '23\u200b\u000a\u000a5', '284115', '542\u200b\u000a\u000a', '45\u200b\u000a\u000a4', '1194" ', '\\\u000aAuth', 'orizat', 'ion: B', 'earer ', 'qgmebn', '\u202e`\u000d\u000anv', 'tpyvsl', '\u202e`\u000d\u000aqd'].join(''), '5284 2841 8411 4115 1155 1554 5542 nvtp vtpy tpyv pyvs yvsl', 3],
    [['Run: T', 'oken g', '\u202e\\\u000d\u000av5', 'fMbDMi', 'Ns\u202e\\\u000d\u000a', '++xxB8', '1Og3D/', 'oMIAlX', 'vMj0mg', '" expo', 'rt e\u200b\\', '\u000d\u000ayJy3', 'dd7dI6', 'gwoSjU', '\u200b\\\u000d\u000aB4', 'JYv0.e', 'yJWjUh', 'q9Kf6A', 'pUHVwP', 'vOPVkA', 'HeLmM7', '1h.-Yy', 'gxnCEl', '\u200b\\\u000d\u000aa4', '6U_vw7', 'gFQWKU', 'HgJ5BW', 'p" && ', 'xoxb-0', '\u200b`\u000a134', '904208', '\u200b`\u000a96-', 'IZvUUV', 'p\u200b`\u000amv', 'jvilSh', 'B4WFxh', 'F2e\u000d\u000a2', '. Seco', 'nd ite', 'm Run:', ' s\u000a\u2060- ', 'k-proj', '-UR4Hn', 'GyAHVQ', 'xRrNnh', 'zntTbY', 'QCN\u000a\u2060-', ' c\u000a\u2060- ', 'cL2xdK', 'CRfbc5', 't \\\u000a  ', '--watc', 'h'].join(''), 'xoxb 1349 3490 4904 9042 0420 4208 IZvU ZvUU vUUV UUVp', 3],
    [['- clie', 'nt_sec', 'ret=1\u200b', '^\u000a> 1c', '\u200b^\u000a> g', '293yb\u200b', '^\u000a> j1', 'vtnx51', '\u000a\u000aok\u000ae', 'xport ', 'DB_PAS', 'SWORD=', 'fbc9d9', '1\u2060`\u000a54', '1d00fc', '7c don', 'e'].join(''), '541d 41d0 1d00 d00f 00fc 0fc7 fc7c', 3],
    [['1. DB_', 'PASSWO', 'RD=g-s', 'i\u2029    ', 'q0O6LH', 'tc\u2029   ', ' _Dm1E', '0VxUmW', '7skE\u2029 ', '   AI7', '8s3\u000a\u000ae', 'cho -p', '3\u202e^\u000a72', '719\u202e^\u000a', '323916', '316672', '\u000d\u000a2. S', 'econd ', 'item; ', 'glpat-', 'q^\u000d\u000a- ', 'maqHRh', 'Wl^\u000d\u000a-', ' O4KP4', '^\u000d\u000a- J', 'CSsB5\u000a', '```; e', 'yJiICu', '290RYx', 'QDOoP6', 'lMHm.e', 'yJPsmZ', 'eHFCV9', 'yftWel', '6z8Izh', 'r2gcAX', 'Dm.WP8', 'yseBJC', 'lC_Cg\ufeff', '\u2028MuZKr', 'zzgrp7', 'eXueA ', '\\\u000a  --', 'watch'].join(''), 'q0O6 0O6L O6LH 6LHt LHtc', 3],
    [['Run: g', 'ithub_', 'pat_ue', 'NkFHou', '1nzO3V', 'dvbSDd', 'Ki_9GD', 'oVjEgY', 'tTMlMe', '1eCqQV', '0qkx\u200d^', '\u000ayYTf4', 'jB5egC', 'TYhXkW', '4TTL3e', '8SlGtD', '5k\u200d^\u000aP', '0B"\u000acu', 'rl -H ', '"ghp_o', 'M2i\u00ad^\u000a', '> zBbP', 'DZgtCx', 'EBePnq', 'joNYfY', 'hP2zqw', '5Gep\u000an', 'ext st', 'ep Run', ': API_', 'KEY=HN', 'BBACBP', '\ufeff`\u000a\u200bE\ufeff', '`\u000a\u200bHHP', 'VWOPO\ufeff', '`\u000a\u200bD\u000d\u000a', '- gith', 'ub_pat', '_9YtL5', 'TLDbRr', 'EU1I5l', 'R\u202e`\u000a\u0009H', 'BgB_h2', 'etlywR', 'SyEP0h', 'iAVtYW', '\u202e`\u000a\u00096q', 'L9Oa2u', 'JEeIgP', '9hZ6\u202e`', '\u000a\u0009RcOx', 'txAaxW', 'gAu8Iw', 'eIciT ', 'done'].join(''), 'HBgB h2et 2etl etly tlyw lywR ywRS wRSy RSyE SyEP yEP0 EP0h P0hi 0hiA hiAV iAVt AVtY VtYW 6qL9 qL9O L9Oa 9Oa2 Oa2u a2uJ 2uJE uJEe JEeI EeIg eIgP IgP9 gP9h P9hZ 9hZ6', 3],
    ];
    for (const [k, [t, list, n]] of rows.entries()) {
      const ps = list.split(' ');
      assert.strictEqual(n, 3, 'three surfaces per row');
      const off = withoutContinuation(() => STl.maskLabel(t, 'run', lm));
      assert.deepStrictEqual(ps.filter((x) => off.includes(x)), [], `#1320 continuation desk label: the reading without the step hides the row's pieces (row ${k})`);
      const pair = STl.maskLabelPair(t, 'run', lm);
      for (const [sn, out] of [['the run label', STl.maskLabel(t, 'run', lm)], ['the permission card text', pair.text], ['the permission card reference', pair.ref]]) {
        assert.ok(out !== '', `#1320 continuation desk label: ${sn} is not empty (row ${k})`);
        assert.deepStrictEqual(ps.filter((x) => out.includes(x)), [], `#1320 continuation desk label: ${sn} shows no piece the reading without the step hides (row ${k}): ${JSON.stringify(out)}`);
      }
    }
  }
  // review of PR 2001, round 2: the command mask's own union with its reading without the step, on a command with no shell continuation (the shell-joined reading
  // does not run): the step-off reading hides a quoted value's closing marks inside its mask, the reading with the step shows them, and the union hides them
  {
    const t = "'sk-" + '\nOHo8AE8D' + '0ArX2cnHopF1\n"API_' + 'KEY=JB26\rMWm7' + 'tyV4"' + "'";
    const cutAt = /\s+|\[redacted(?::[^\]\r\n]{1,128})?\]/;
    const out = maskSecretCommand(t, {}), ref = withoutContinuation(() => maskSecretCommand(t, {}));
    const refShown = new Set(ref.split(cutAt));
    assert.deepStrictEqual(out.split(cutAt).filter((p) => p !== '' && !refShown.has(p)), [], `#1320 continuation union: maskSecretCommand shows no piece its reading without the step hides, no shell continuation: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('JB26') && !out.includes('MWm7'), `#1320 continuation union: the value stays hidden: ${JSON.stringify(out)}`);
  }
  // review of PR 2001, round 2: the middle-line rule joins a line only when it holds no blank or punctuation (the middle of one value); a line that holds one, then a
  // line that looks like a token's tail, read as written after a hidden value (the over-masking guard)
  for (const b of ['\n', '\r\n']) {
    const t = 'API_' + 'KEY=' + v1 + b + v2 + b + 'pass' + 'word=abc' + b + 'Release2024Notes';
    for (const [sn, out] of [['redact', redact(t, {})], ['split step', maskSplitTokens(t)]] as Array<[string, string]>) {
      assert.ok(out.endsWith(b + 'pass' + 'word=abc' + b + 'Release2024Notes') && !out.includes(v1), `#1320 continuation near miss: a line with punctuation and the next one read as written after a hidden value (${sn}, ${JSON.stringify(b)}): ${JSON.stringify(out)}`);
    }
  }
  // near misses, byte for byte: line breaks with no secret, ordinary next lines after a hidden value, two whole tokens on two lines (nothing new to hide)
  const tok1 = 'gh' + 'p_' + 'Zq3Wd8Kp2Lm5Rt7Yx4Bn6Hj9Fc1Vg0Ts3Qa8';
  const tok2 = 'gh' + 'p_' + 'Hj9Fc1Vg0Ts3Qa8Zq3Wd8Kp2Lm5Rt7Yx4Bn6';
  for (const k of ['line one\nline two\r\nline 3', 'npm run build \\\n  --watch', 'cd src ^\r\n&& dir', 'echo done\\\nnext', 'v1.2.3\nv1.2.4\r\nREADME.md', 'a_b\\\nc_d', 'x=1 \\\ny=2']) {
    assert.strictEqual(redact(k, {}), k, `#1320 continuation near miss stays: ${JSON.stringify(k)}`);
    assert.strictEqual(maskSplitTokens(k), k, `#1320 continuation near miss stays (split step): ${JSON.stringify(k)}`);
  }
  for (const [t, want] of [
    [`l1\n${tok1}\r\nl3`, 'l1\n[redacted]\r\nl3'],
    ['pass' + 'word=' + v1 + '\nok2', 'pass' + 'word=[redacted]\nok2'],
    ['API_' + 'KEY=' + v1 + '\nnpm test', 'API_' + 'KEY=[redacted]\nnpm test'],
    ['to' + 'ken: ' + v1 + '\nAlternatively', 'to' + 'ken: [redacted]\nAlternatively'],
  ] as Array<[string, string]>) assert.strictEqual(redact(t, {}), want, `#1320 continuation near miss: the next line stays (${JSON.stringify(want)})`);
  for (const b of ['\n', '\r\n']) assert.strictEqual(maskSplitTokens(tok1 + b + tok2), tok1 + b + tok2, `#1320 continuation: two whole tokens on two lines add nothing to the split step (${JSON.stringify(b)})`);
  // work counters, not wall time: one more mask pass at most per text, and the characters read are a fixed multiple of its length
  {
    const unit = 'API_' + 'KEY=' + v1 + '\\\n' + v2 + '\nx ' + tok1 + '\n' + v2 + 'Ab ';
    for (const len of [1_000, 20_000, 200_000]) {
      const x = unit.repeat(Math.ceil(len / unit.length)).slice(0, len);
      _contWorkForTest(); _contPassesForTest();
      maskSplitTokens(x);
      const w = _contWorkForTest();
      assert.ok(w > 0 && w <= 6 * x.length, `#1320 continuation work: ${w} characters read for ${x.length}`);
      assert.strictEqual(_contPassesForTest(), 1, `#1320 continuation work: one mask pass for a text of ${x.length}`);
    }
    _contPassesForTest();
    maskSplitTokens('no break here, ' + tok1);
    assert.strictEqual(_contPassesForTest(), 0, '#1320 continuation work: a text without a line break is not read again');
    // review of PR 2001: the scan for a middle line reads each character once and counts it. A record of many continued lines whose middles fail the body test: a
    // long line, then short lines that each asked for the scan; it read the long line again for each of them (about 78 steps a character, none counted)
    const blk = 'API_' + 'KEY=' + v1 + '\n' + 'A1'.repeat(1024) + '\n:x\n' + 'Ab3Cd4Ef5Gh6\n'.repeat(157);
    for (const len of [20_000, 400_000]) {
      const x = blk.repeat(Math.ceil(len / blk.length)).slice(0, len);
      _contWorkForTest(); _contScanForTest();
      maskSplitTokens(x);
      const w = _contWorkForTest(), sc = _contScanForTest();
      assert.ok(sc >= 0.9 * x.length && sc <= x.length, `#1320 continuation work: the middle-line scan reads each character once, counted: ${sc} for ${x.length}`);
      assert.ok(w >= sc && w <= 6 * x.length, `#1320 continuation work: a long line before many short ones: ${w} characters read for ${x.length}`);
    }
    _contPassesForTest();
    // a plain break after text the rules do not hide joins nothing, so the text is not read again (the guard that spares the pass)
    maskSplitTokens('x build\nRelease2024Notes y\r\nAb3Cd4Ef5Gh6 z');
    assert.strictEqual(_contPassesForTest(), 0, '#1320 continuation work: plain breaks after text that is not hidden are not read again');
  }
  // the growth bound: the split step's output never grows past the text
  for (const [k, x] of Object.entries({ lf: 'gh' + 'p_' + '\\\na'.repeat(4000), crlf: 'gh' + 'p_' + '\\\r\na'.repeat(3000), caret: 'gh' + 'p_' + '^\nab'.repeat(3000) })) {
    const out = maskSplitTokens(x);
    assert.ok(out.length <= x.length, `#1320 continuation growth (${k}): the split step's output is ${out.length} characters for ${x.length}`);
  }
  assertLinearShape('#1320 continuation: redact many continued values', (x) => { redact(x, {}); }, (k) => ('API_' + 'KEY=' + v1 + '\\\n' + v2 + '\n').repeat(Math.ceil(k / 30)).slice(0, k), 200_000);
  assertLinearShape('#1320 continuation: redact one long continued value', (x) => { redact(x, {}); }, (k) => 'API_' + 'KEY=' + 'A1b\\\n'.repeat(Math.ceil(k / 5)).slice(0, k), 200_000);
  assertLinearShape('#1320 continuation: redact a hidden value then many next lines', (x) => { redact(x, {}); }, (k) => 'to' + 'ken: ' + v1 + ('\n' + v2).repeat(Math.ceil(k / 10)).slice(0, k), 200_000);
}

// spec 012 FR-187 (issue #1320): a secret name glued to the end of a token is taken into the token's mask, so the value after it was no value of any name.
// A value after a mask and `=` is now read as a named value. Every value here is invented and built from pieces.
{
  const tok = 'gh' + 'p_' + 'Zq3' + 'x'.repeat(16) + 'K9m' + 'p'.repeat(14);
  const val = 'Vq7' + 'v0T' + 'wQ4';
  const shortVal = 'ab' + 'c12';
  const pw = 'pass' + 'word';
  const STe = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string };
  const surfaces: Array<[string, (t: string) => string]> = [
    ['redact', (t) => redact(t, {})],
    ['maskSecretCommand', (t) => maskSecretCommand(t, {})],
    ['maskSecretArgs', (t) => maskSecretArgs([t], {}).join(' ')],
    ['maskOutgoing', (t) => maskOutgoing(t).text],
    ['maskNoteText', (t) => maskNoteText(t).text],
    ['desk maskRaw', (t) => STe.maskRaw(t, (x) => redact(x, {}))],
  ];
  const hidden: Array<[string, string, string]> = [
    ['glued =', tok + pw + '=' + val, val],
    ['glued, blanks around =', 'x ' + tok + pw + ' = ' + val + ' y', val],
    ['glued, quoted value', tok + 'tok' + 'en="' + val + '"', val],
    ['glued, short value', tok + 'pw' + 'd=' + shortVal, shortVal],
    ['glued =>', tok + 'sec' + 'ret=>' + val, val],
    ['glued %3D', '?q=' + tok + 'tok' + 'en%3D' + val, val],
    // review of PR 1872: the colon forms of config files and JSON, and a short value after a percent-encoded separator
    ['glued, colon and a blank', tok + pw + ': ' + val, val],
    ['glued, colon and a quoted value', tok + pw + ': "' + val + '"', val],
    ['glued, JSON key and value', '{"' + tok + pw + '": "' + val + '"}', val],
    ['glued, colon, a blank and a short value', tok + 'pw' + 'd: ' + shortVal, shortVal],
    ['glued %3D, short value', tok + 'pw' + 'd%3D' + shortVal, shortVal],
    ['glued %3A, short value', tok + 'pw' + 'd%3A' + shortVal, shortVal],
    // review of PR 1872, round 2: a short value glued straight to a colon, and escaped JSON (a backslash and a quote after the colon)
    ['glued, colon and a short value', tok + 'pw' + 'd:' + shortVal, shortVal],
    ['glued, escaped JSON', '{\\"' + tok + pw + '\\":\\"' + val + '\\"}', val],
  ];
  for (const [label, input, secret] of hidden) for (const [name, f] of surfaces) {
    const out = f(input);
    assert.ok(!out.includes(secret), `#1320 glued name: ${name} hides the value (${label}): ${out}`);
  }
  // a closing bracket of one opened before stays
  assert.strictEqual(redact('(' + tok + pw + '=' + val + ')', {}), '([redacted]=[redacted])', '#1320 glued name: the closing bracket stays');
  // near misses: what follows a mask and `=` but is no value (each stays as written)
  const kept: Array<[string, string]> = [
    ['a version', tok + '=v1'],
    ['padding', tok + '=='],
    ['three letters', tok + '=abc'],
    ['a mask in a query', 'x=' + tok + '&y=2'],
    ['a variable', tok + '=$HOME'],
    ['a dotted name', tok + '=config.value'],
    ['a sentence', 'see ' + tok + '. ok'],
    ['a lower-case word', tok + '=reset-flow'],
    ['a port after a colon', tok + ':8080'],
    ['words after a colon', 'see ' + tok + ': none here'],
    ['a version after a colon', tok + ': v2.1.0'],
    ['a word after a colon', 'Token ' + tok + ': Expires soon'],
    ['a dotted name with a digit', tok + '=config.token2'],
    ['a lower-case path', tok + '=src/foo123'],
    ['a variable of 8 or more', tok + '=$HOME_DIR1'],
  ];
  for (const [label, input] of kept) {
    const want = input.replace(tok, '[redacted]');
    assert.strictEqual(redact(input, {}), want, `#1320 glued name near miss stays: ${label}`);
  }
  // review of PR 1872, round 2: the pass reads and writes the caller's mask
  assert.strictEqual(maskTokenShapes(tok + pw + '=' + val, '[secret hidden]'), '[secret hidden]=[secret hidden]', '#1320 glued name: the value pass uses the caller\'s mask');
  assert.strictEqual(maskTokenShapes(tok + pw + '=' + val, '$&x'), '$&x=$&x', '#1320 glued name: a mask with replacement characters is written as it is');
  // a rest glued by a colon is folded first and keeps its host, as on main (the value rule runs after the glued rest)
  assert.strictEqual(redact(tok + ':x-oauth-' + 'basic@github.com', {}), '[redacted]@github.com', '#1320 glued name: a rest glued by a colon keeps its host');
  // review of PR 1872, round 3: the glued rest folds a glued name and its separator as on main (keeping the `=` there made a value the value pass refuses show);
  // the brain's tail reads a quoted value glued to a mask, so a stream cut after the separator still hides the value (`#1320 brain` in test-brainstate)
  assert.strictEqual(redact('x [redacted]' + 'pp' + pw + '="', {}), 'x [redacted]"', '#1320 glued name: the glued rest folds a name and its separator, as on main');
  assert.strictEqual(maskGluedTail('x [redacted]' + pw + '="' + val + '"'), 'x [redacted]"[redacted]"', '#1320 glued name: maskGluedTail reads a quoted value glued to a mask');
  assert.strictEqual(maskGluedTail('x [redacted]>' + val), 'x [redacted]>[redacted]', '#1320 glued name: maskGluedTail reads a value after the rest of `=>`');
  assert.strictEqual(maskGluedTail('x [redacted] ' + val), 'x [redacted] ' + val, '#1320 glued name: maskGluedTail leaves a word after a mask and a blank');
  // review of PR 1872, round 4: `>` counts only glued to the mask (the rest of `=>`); a quoted word after a mask and a blank is hidden on purpose (the folded `<name>= "<value>"`)
  assert.strictEqual(maskGluedTail('echo [redacted] > backup' + '2024 done'), 'echo [redacted] > backup' + '2024 done', '#1320 glued name: maskGluedTail leaves a word after a mask, a blank and >');
  assert.strictEqual(maskGluedTail('see [redacted] "Release' + '2024"'), 'see [redacted] "[redacted]"', '#1320 glued name: maskGluedTail hides a quoted word after a mask and a blank (accepted)');
  // round 4: linear on a long run of quotes after a mask (two quote runs side by side were quadratic). Round 5: 4,000 against 16 runs of 250, so the quadratic rule
  // (about 0.9 s at 4,000) fails the growth ratio within seconds, not at the helper's wall-time backstop
  for (const q of ["'", '"', '`']) {
    const label = `#1320 maskGluedTail quote run ${q}`;
    try { assertLinearShape(label, (x) => { maskGluedTail(x); }, (k) => 'note [redacted]' + q.repeat(k), 4_000); } catch (e) { throw new assert.AssertionError({ message: `${label}: ${(e as Error).message}` }); } // the helper's backstop names no case: it is named here
  }
}

// spec 012 FR-181 (issue #1541, T162): a token written with a backslash escape inside (`ghp\_<body>`, `g\hp_<body>`) is hidden by
// redact, maskSecretCommand and maskSecretArgs, in the text as written. Every token here is invented and built in code from pieces.
{
  const B36 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const B22 = 'Z9y8X7w6V5u4T3s2R1q0P9';
  const B59 = 'o8N7m6L5k4J3i2H1g0F9e8D7c6B5a4Z3y2X1w0V9u8T7s6R5q4P3o2N1m0L';
  const B40 = 'K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6A7b8C9d0';
  const B93 = (B40 + B40 + B40).slice(0, 93);
  // [form, escaped token, the bodies that must not show]
  const FORMS: Array<[string, string, string[]]> = [
    ['ghp\\_', 'ghp' + '\\_' + B36, [B36]],
    ['github\\_pat\\_', 'github' + '\\_pat\\_' + B22 + '\\_' + B59, [B22, B59]],
    ['sk\\-proj\\-', 'sk' + '\\-proj\\-' + B40, [B40]],
    ['sk\\-ant\\-api03\\-', 'sk' + '\\-ant\\-api03\\-' + B93, [B93]],
    ['g\\hp_', 'g' + '\\hp_' + B36, [B36]],
    ['gh\\p\\_ mixed', 'gh' + '\\p\\_' + B36.slice(0, 10) + '\\' + B36.slice(10), [B36]],
  ];
  /** Any 8 characters of a body in `out` (backslashes dropped first: `AB\CD…` is `ABCD…` to a shell). */
  const shows = (out: string, bodies: string[]): string | undefined => {
    const o = out.replace(/\\/g, '');
    for (const b of bodies) for (let i = 0; i + 8 <= b.length; i++) if (o.includes(b.slice(i, i + 8))) return b.slice(i, i + 8);
    return undefined;
  };
  /** The desk's mask (`DurbarSafeText.maskRaw`: Markdown escapes undone, then `redact`): the activity row's last line and the desk read the same text, so they must agree on whether a secret shows. */
  const ST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string; plainKeep(t: string, codeWord?: string): string };
  /** The approval card (`DurbarLiveAct.permText`, shell kind) and its label mask (`maskLabel`, run kind): the window's own escaped-run step (FR-180) in front of the shared masks. */
  const LA = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string } };
  const cardMask = (env: Record<string, string>) => ({ redact: (t: string) => redact(t, env), cmd: (t: string) => maskSecretCommand(t, env), url: (t: string) => maskSecretUrl(t, env) });
  let diffCases = 0;
  /** Both `redact` and `maskRaw` hide every body (the review of PR 1585: a future change to one path must not reopen a leak the other closes). */
  const agree = (text: string, bodies: string[], env: Record<string, string>, label: string): void => {
    const r = redact(text, env);
    const m = ST.maskRaw(text, (t) => redact(t, env));
    assert.strictEqual(shows(r, bodies), undefined, `${label}: redact shows no part: ${JSON.stringify(text)} gave ${r}`);
    assert.strictEqual(shows(m, bodies), undefined, `${label}: maskRaw shows no part: ${JSON.stringify(text)} gave ${m}`);
    // review of PR 1585 (round 4): the card and its label mask hide what redact hides (the same input)
    const cm = cardMask(env);
    const card = LA.permText(text, 'shell', cm).text;
    const lab = ST.maskLabel(text, 'run', cm);
    assert.strictEqual(shows(card, bodies), undefined, `${label}: the card (permText shell) shows no part: ${JSON.stringify(text)} gave ${card}`);
    assert.strictEqual(shows(lab, bodies), undefined, `${label}: maskLabel (run) shows no part: ${JSON.stringify(text)} gave ${lab}`);
    diffCases++;
  };
  for (const [what, tok, bodies] of FORMS) {
    // the baseline: the same token without its backslashes is a token to the rules
    assert.notStrictEqual(redact(tok.replace(/\\/g, ''), {}), tok.replace(/\\/g, ''), `#1541 ${what}: the unescaped token is a token (baseline)`);
    for (const [ctx, text] of [['alone', tok], ['after echo', 'echo ' + tok], ['double quotes', `echo "${tok}"`], ['single quotes', `echo '${tok}'`], ['glued to a plain token', 'echo ghp_' + B36 + tok], ['before a word', tok + ' done']] as const) {
      const r = redact(text, {});
      const c = maskSecretCommand(text, {});
      assert.strictEqual(shows(r, bodies), undefined, `#1541 ${what} ${ctx}: redact shows no part: ${r}`);
      assert.strictEqual(shows(c, bodies), undefined, `#1541 ${what} ${ctx}: maskSecretCommand shows no part: ${c}`);
      assert.ok(r.includes('[redacted]') && c.includes('[redacted]'), `#1541 ${what} ${ctx}: a mask is shown`);
    }
    for (const t of [tok, 'echo ' + tok, `echo "${tok}"`, 'echo ghp_' + B36 + tok]) agree(t, bodies, {}, `#1541 differential ${what}`);
    const a = maskSecretArgs(['run', tok, '--verbose'], {});
    assert.deepStrictEqual(a, ['run', '[redacted]', '--verbose'], `#1541 ${what}: maskSecretArgs hides the argument, the others stay`);
  }
  // the text is kept as written around the run (never shown unescaped), and the run is hidden before the rules (glued: no rest)
  assert.strictEqual(redact('echo a \\> b ' + FORMS[0][1] + ' \\| c', {}), 'echo a \\> b [redacted] \\| c', '#1541 ghp: the command stays as written around the mask');
  assert.strictEqual(redact('ghp_' + B36 + FORMS[0][1], {}), '[redacted]', '#1541 glued: a token glued to an escaped one is hidden whole, before the rules');
  assert.strictEqual(redact('x ' + FORMS[2][1], {}), 'x [redacted]', '#1541 sk-proj: the run set holds sk too');
  assert.strictEqual(redact('x ' + FORMS[1][1], {}), 'x [redacted]', '#1541 github_pat: the run set holds github_pat too');
  assert.strictEqual(redact('x ' + FORMS[4][1], {}), 'x [redacted]', '#1541 g\\hp_: the shell reading of a backslash before a letter');
  // a JSON-escaped line break before an escaped token: only the piece after the break is hidden
  assert.strictEqual(redact('"a\\n' + FORMS[0][1] + '\\tb"', {}), '"a\\n[redacted]\\tb"', '#1541 an escaped token after an escaped line break');
  // a backslash without a token: unchanged
  for (const t of ['a \\> b', 'C:\\Users\\me\\notes', 'private_key=C:\\keys\\server_2026.pem', 'grep -E "a\\.b\\|c"', 'printf "x\\ty\\n"', 'sed s/\\_x/\\-y/', '\\\\server\\share\\dir', 'ab\\_cd ef\\-gh']) {
    assert.strictEqual(redact(t, {}), t, `#1541 no token: unchanged: ${t}`);
    if (!t.startsWith('private_key=')) assert.strictEqual(maskSecretCommand(t, {}), t, `#1541 no token: maskSecretCommand unchanged: ${t}`); // the command mask hides any `private_key=` value (its name rule, with or without a backslash)
  }
  // maskOutgoing and maskNoteText get the shell form through their own redact calls (FR-181 asked whether they do)
  for (const f of [maskOutgoing, maskNoteText]) {
    const r = f('echo ' + FORMS[4][1]);
    assert.ok(r.changed && shows(r.text, [B36]) === undefined, `#1541 g\\hp_: ${f.name} hides it: ${r.text}`);
  }
  // never throws, never longer than the input plus its masks: a backslash at the end, alone, many
  for (const t of ['\\', 'ghp\\', '\\\\\\\\', 'a\\'.repeat(1000), FORMS[0][1] + '\\']) assert.strictEqual(typeof redact(t, {}), 'string', `#1541 odd input is a string: ${t.slice(0, 12)}`);

  // T163: a named marker `[redacted:NAME]` takes its glued rest with the counts of FR-173 (8, 16 after `_`, 32 after `/` or `+`) and the same end rule
  {
    const V = 'Vq7Wx8Ec9Rv0Tb1Yn2Um3Ik4';
    const NE = { FOO_TOKEN: V };
    const REST = 'abcdefghij0123456789xy';
    for (const [sep, what] of [['_', 'after _'], ['-', 'after -'], ['', 'no separator']] as const) {
      const r = redact('secret=' + V + sep + REST, NE);
      assert.strictEqual(r, 'secret=[redacted:FOO_TOKEN]', `#1544 named marker: the rest glued to a named marker is hidden (${what}): ${r}`);
      assert.strictEqual(redact('x ' + V + sep + REST + ' y', NE), 'x [redacted:FOO_TOKEN] y', `#1544 named marker: hidden without a name before it (${what})`);
    }
    assert.strictEqual(redact('cp ' + V + '_backup', NE), 'cp [redacted:FOO_TOKEN]_backup', '#1544 named marker: a short suffix after _ stays');
    assert.strictEqual(redact('x ' + V + '_' + 'a'.repeat(15), NE), 'x [redacted:FOO_TOKEN]_' + 'a'.repeat(15), '#1544 named marker: 15 after _ stay');
    assert.strictEqual(redact('x ' + V + '_' + 'a'.repeat(16), NE), 'x [redacted:FOO_TOKEN]', '#1544 named marker: 16 after _ are hidden');
    assert.strictEqual(redact('x ' + V + 'a'.repeat(7), NE), 'x [redacted:FOO_TOKEN]' + 'a'.repeat(7), '#1544 named marker: 7 glued stay');
    assert.strictEqual(redact('x ' + V + '-' + 'a'.repeat(8), NE), 'x [redacted:FOO_TOKEN]', '#1544 named marker: 8 after - are hidden');
    assert.strictEqual(redact('x ' + V + '/' + 'a'.repeat(31), NE), 'x [redacted:FOO_TOKEN]/' + 'a'.repeat(31), '#1544 named marker: 31 after / stay');
    assert.strictEqual(redact('x ' + V + '/' + 'a'.repeat(32), NE), 'x [redacted:FOO_TOKEN]', '#1544 named marker: 32 after / are hidden');
    assert.strictEqual(redact('see ' + V + '.', NE), 'see [redacted:FOO_TOKEN].', '#1544 named marker: a full stop stays');
    assert.strictEqual(redact('see ' + V + '_' + REST + '.', NE), 'see [redacted:FOO_TOKEN].', '#1544 named marker: the rest is hidden, the full stop stays');
    assert.strictEqual(redact('a ' + V + ' and ' + V + REST + ' and [redacted] ' + REST, NE), 'a [redacted:FOO_TOKEN] and [redacted:FOO_TOKEN] and [redacted] ' + REST, '#1544 named marker: plain and named markers in one text, each read once');
    // review of PR 1585 (2): every mask takes its own rest, not only the first plain one (FR-173), also in the order plain, named, plain
    const R21 = 'k1L2m3N4o5P6q7R8s9T0u';
    const G = 'ghp_' + B36;
    assert.strictEqual(redact('a ' + G + '_' + R21 + ' b ' + G + '_' + R21 + ' c ' + G + '_' + R21, {}), 'a [redacted] b [redacted] c [redacted]', '#1585 glued rest: each of three plain masks takes its rest');
    assert.strictEqual(redact('a ' + G + '_' + R21 + ' b ' + V + '_' + R21 + ' c ' + G + '_' + R21, NE), 'a [redacted] b [redacted:FOO_TOKEN] c [redacted]', '#1585 glued rest: plain, named, plain each take their rest');
    // review of PR 1585 (1): an escaped rest glued to a mask is that mask's rest, named or plain, through redact, maskSecretCommand and the desk's maskRaw
    const R17 = REST.slice(5);
    const ESC_RESTS: Array<[string, string, string[]]> = [
      ['named \\_<rest>', 'secret=' + V + '\\_' + REST, [REST]],
      ['named _<4>\\<18>', 'secret=' + V + '_' + REST.slice(0, 4) + '\\' + REST.slice(4), [REST.slice(4)]],
      ['named <3>\\<19>', 'x ' + V + REST.slice(0, 3) + '\\' + REST.slice(3), [REST.slice(3)]],
      ['named _<3>\\n<18>', 'x ' + V + '_' + REST.slice(0, 3) + '\\n' + REST.slice(3, 21), [REST.slice(3, 21)]],
      ['plain \\_<rest>', 'send x[redacted]\\_' + REST, [REST]],
      ['plain _<5>\\<17>', 'x[redacted]_' + REST.slice(0, 5) + '\\' + R17, [R17]],
      ['plain _AIza<14>\\<21>', 'x[redacted]_AIza' + B36.slice(0, 14) + '\\' + R21, [R21]],
      ['token then \\_<rest>', 'x ' + G + '\\_' + REST, [B36, REST]],
      ['password= named \\_<rest>', 'password=' + V + '\\_' + REST, [REST]],
      ['token= plain \\-<rest>', 'token=[redacted]\\-' + REST, [REST]],
    ];
    for (const [what, text, bodies] of ESC_RESTS) {
      assert.strictEqual(shows(redact(text, NE), bodies), undefined, `#1585 escaped rest after a mask (${what}): redact hides it: ${redact(text, NE)}`);
      assert.strictEqual(shows(maskSecretCommand(text, NE), bodies), undefined, `#1585 escaped rest after a mask (${what}): maskSecretCommand hides it`);
      agree(text, bodies, NE, `#1585 differential escaped rest (${what})`);
    }
    assert.strictEqual(redact('x [redacted]\\nNextlinehere', {}), 'x [redacted]\\nNextlinehere', '#1585 a JSON line break after a mask ends the rest');
    assert.strictEqual(redact('see ' + V + '\\.', NE), 'see [redacted:FOO_TOKEN]\\.', '#1585 an escaped full stop after a mask stays');
    assert.strictEqual(redact('see ' + V + '_' + REST + '\\.', NE), 'see [redacted:FOO_TOKEN]\\.', '#1585 the rest is hidden, an escaped full stop stays with its backslash');
    // the rule itself (FR-173's glued rest), as callers that run maskTokenShapes alone read it (the brain view's brainMaskText)
    assert.strictEqual(maskTokenShapes('x[redacted]\\_' + REST, '[redacted]'), 'x[redacted]', '#1585 maskTokenShapes: an escaped rest after a plain mask is glued');
    assert.strictEqual(maskTokenShapes('x [redacted:FOO_TOKEN]_' + REST.slice(0, 4) + '\\' + REST.slice(4), '[redacted]'), 'x [redacted:FOO_TOKEN]', '#1585 maskTokenShapes: an escaped rest after a named marker is glued');
    // round 3: every escaped character counts toward the rest (16 after `_`, with two escaped characters)
    assert.strictEqual(maskTokenShapes('x[redacted]_Kp3Lm\\4Nq5Rs\\6Tu7V', '[redacted]'), 'x[redacted]', '#1585 round 3 maskTokenShapes: 16 after _ with two escaped characters are hidden');
    assert.strictEqual(maskTokenShapes('x[redacted]_Kp3Lm\\4Nq5Rs\\6Tu7', '[redacted]'), 'x[redacted]_Kp3Lm\\4Nq5Rs\\6Tu7', '#1585 round 3 maskTokenShapes: 15 after _ stay');
    // round 3: a long env name (the marker `redact` writes is read up to a name of 128 characters)
    for (const len of [13, 32, 128]) {
      const name = ('MY_VERY_LONG_GITHUB_DEPLOY_TOKEN_' + 'X'.repeat(128)).slice(0, len);
      const out = redact('secret=' + V + '_abc\\nKp3Lm4Nq5Rs6Tu7Vw8', { [name]: V });
      assert.ok(!out.includes('Kp3Lm4Nq') && out.startsWith(`secret=[redacted:${name}]`), `#1585 round 3: a ${len}-character env name, the rest after a break escape is hidden: ${out.slice(0, 60)}…`);
    }
    // the reverse: the escaped token before a mask, glued to it
    for (const [what, tok, bodies] of FORMS) {
      for (const [where, text] of [['before a plain mask', tok + '[redacted]'], ['before a named marker', tok + V], ['before a named marker after a word', 'x ' + tok + V + ' y']] as const) {
        assert.strictEqual(shows(redact(text, NE), bodies), undefined, `#1585 reverse ${what} ${where}: redact hides it`);
        agree(text, bodies, NE, `#1585 differential reverse ${what} ${where}`);
      }
    }
  }
  // review of PR 1585 (3): \n, \r, \t inside a body are shell escapes of a letter there: the whole run is read when no piece between the breaks hides
  for (const br of ['n', 'r', 't']) {
    for (const [what, text, bodies] of [
      ['ghp', 'echo ghp_' + B36.slice(0, 10) + '\\' + br + B36.slice(10), [B36.slice(0, 10), B36.slice(10)]],
      ['ghp with a second escape, 10 before the break', 'echo ghp\\_' + B36.slice(0, 10) + '\\' + br + B36.slice(10), [B36.slice(0, 10), B36.slice(10)]],
      ['sk-proj', 'echo sk-proj-' + B40.slice(0, 10) + '\\' + br + B40.slice(10), [B40.slice(0, 10), B40.slice(10)]],
    ] as const) {
      const r = redact(text, {});
      assert.strictEqual(r, 'echo [redacted]', `#1585 a \\${br} inside a body (${what}): the whole run is hidden: ${r}`);
      assert.strictEqual(shows(maskSecretCommand(text, {}), [...bodies]), undefined, `#1585 a \\${br} inside a body (${what}): maskSecretCommand hides it`);
      agree(text, [...bodies], {}, `#1585 differential \\${br} inside a body (${what})`);
    }
  }
  // review of PR 1585 (round 3): a break escape after a piece that hides alone (another escape in front of it): the piece after the break is its tail when it holds FR-173's count (8)
  {
    const BODY = B36 + B40;
    const shell = (t: string): string => t.replace(/\\(.)/g, '$1');
    let pinned = 0;
    for (const [what, pre, plain] of [['g\\hp_', 'g\\hp_', 'ghp_'], ['ghp\\_', 'ghp\\_', 'ghp_'], ['sk\\-proj\\-', 'sk\\-proj\\-', 'sk-proj-'], ['github\\_pat\\_', 'github\\_pat\\_', 'github_pat_']] as const) {
      for (const br of ['n', 'r', 't']) {
        for (const l1 of [10, 20, 30]) {
          for (const l2 of [6, 7, 8, 9, 20]) {
            const head = pre + BODY.slice(0, l1), tl = BODY.slice(l1, l1 + l2);
            const text = 'echo ' + head + '\\' + br + tl + ' done';
            const hu = plain + BODY.slice(0, l1);
            // the shapes the escaped-run step reads (spec 012 FR-185's GitHub last pass runs on the output only, not on an escaped run)
            const firstHides = withoutLoose(() => maskTokenShapes(hu, '[redacted]')) !== hu;
            const whole = hu + br + tl;
            const wholeTok = withoutLoose(() => maskTokenShapes(whole, '[redacted]')) !== whole;
            // the first piece hides alone: its tail goes with it from 8 letters and digits on, the break's own letter counted (a tail of 6 stays, FR-173's count); else the whole run is read; no token: as written
            const want = firstHides ? (l2 + 1 >= 8 ? 'echo [redacted] done' : `echo [redacted]\\${br}${tl} done`) : wholeTok ? 'echo [redacted] done' : text;
            assert.strictEqual(redact(text, {}), want, `#1585 round 3 break tail (${what} \\${br}, ${l1} before, ${l2} after): ${redact(text, {})}`);
            if (want !== text && l2 + 1 >= 8) agree(text, [BODY.slice(0, l1), tl], {}, `#1585 round 3 differential (${what} \\${br}, ${l1}/${l2})`);
            pinned++;
          }
        }
      }
    }
    assert.strictEqual(pinned, 180, '#1585 round 3: every combination pinned');
    // the leak inputs of the review, exactly
    assert.strictEqual(redact('echo g\\hp_' + B36.slice(0, 20) + '\\n' + B36.slice(20), {}), 'echo [redacted]', '#1585 round 3: g\\hp_ with a \\n tail');
    assert.strictEqual(redact('echo sk\\-proj\\-' + B36.slice(0, 20) + '\\t' + B36.slice(20) + 'S9', {}), 'echo [redacted]', '#1585 round 3: sk-proj with a \\t tail');
    // accepted over-masking (fail closed): a long word on the next line of a JSON-escaped text, glued to an escaped token, is hidden with it; a short one stays
    assert.strictEqual(redact(FORMS[0][1] + '\\nAllTestsPassedSuccessfully', {}), '[redacted]', '#1585 round 3: accepted over-mask, a long next-line word glued to an escaped token');
    assert.strictEqual(redact(FORMS[0][1] + '\\nok1234', {}), '[redacted]\\nok1234', '#1585 round 3: a short next-line word stays');
    assert.strictEqual(redact('x [redacted]\\nAllTestsPassedSuccessfully', {}), 'x [redacted]\\nAllTestsPassedSuccessfully', '#1585 round 3: a mask already in the text and a line break: the next line stays');
    // round 4: the pieces before the first hidden piece are read as one stretch (a token whose later piece hides shows no earlier piece), through redact, the card and maskLabel
    const R4: Array<[string, string, string[]]> = [
      ['a plain token before a break, an escaped token after', 'echo ghp_' + B36.slice(0, 20) + '\\n' + B36.slice(20) + '\\tg\\hp_' + B40.slice(0, 36), [B36.slice(0, 20), B36.slice(20), B40.slice(0, 36)]],
      ['sk-proj cut by breaks, an AWS key after', 'echo sk-proj-j4n70RjNC9r2t\\rvp1UsC_ZnMA1t4Ar86crLzI5g\\AsnDor7nGT\\nAKIAJT7GCMIE74\\KF2TP0', ['j4n70RjNC9r2t', 'vp1UsC_ZnMA1t4Ar86crLzI5g', 'AsnDor7nGT', 'AKIAJT7GCMIE74']],
    ];
    for (const [what, text, bodies] of R4) {
      assert.strictEqual(redact(text, {}), 'echo [redacted]', `#1585 round 4 stretch (${what}): redact hides every piece: ${redact(text, {})}`);
      agree(text, bodies, {}, `#1585 round 4 stretch (${what})`);
    }
    // round 4: the reviewer's five card inputs, hidden on the card and in maskLabel (run and other) as in redact
    const B20 = B36.slice(0, 20);
    const CARD5 = [
      'echo ghp\\_' + B20 + '\\nK1l2M3n4O5p6Q7r8',
      'echo sk\\-proj\\-' + B20 + '\\tK1l2M3n4O5p6Q7r8S9',
      'echo sk-proj-LztkxXshTHh5XIQLnZsJ\\_rgtAnNtf6Al\\nTBFkUgyOipgTnnR6 done',
      'echo ghp\\_' + B20 + '\\nK1l2\\rM3n4\\tO5p6Q7r8S9',
      'echo github_pat_' + B22 + '\\_' + B59.slice(0, 30) + '\\nr8S9t0U1v2W3',
    ];
    for (const t of CARD5) {
      const want = redact(t, {});
      assert.ok(/^echo \[redacted\]( done)?$/.test(want), `#1585 round 4 card input: redact hides it whole: ${want}`);
      const cm = cardMask({});
      assert.strictEqual(LA.permText(t, 'shell', cm).text, want, `#1585 round 4 card input: the card shows what redact shows: ${t.slice(0, 30)}`);
      assert.strictEqual(ST.maskLabel(t, 'run', cm), want, `#1585 round 4 card input: maskLabel (run) as redact: ${t.slice(0, 30)}`);
      assert.strictEqual(ST.maskLabel(t, 'other', cm), want, `#1585 round 4 card input: maskLabel (other) as redact: ${t.slice(0, 30)}`);
    }
    // round 5: the window's run takes an escape of every token character (digits, `@`, `=`, `/`, `:`, `%` too); each shape through the card and both label kinds gives what redact gives
    const ESC_SET: Array<[string, string]> = [
      ['an escaped @ and digit inside an sk-proj body', 'echo sk\\-proj\\-K7mPqR2sT4\\-vWxYzA\\@bCdEf\\3gHiJkLmNoPqRsTu'],
      ['an escaped = before an escaped token, an escaped @ inside', '[redacted]\\=ghp\\_' + B36.slice(0, 32) + '\\@Q7r8S9t0U'],
      ['an escaped digit inside a ghp body', 'echo ghp\\_' + B36.slice(0, 20) + '\\5' + B36.slice(20)],
      ['an escaped digit, then an escaped @, after a ghp body', 'echo ghp\\_' + B36 + '\\5ab\\@' + B40.slice(0, 14)],
      ['an escaped / after a ghp body', 'echo ghp\\_' + B36 + '\\/' + B40.slice(0, 30)],
      ['an escaped = after a ghp body', 'echo ghp\\_' + B36 + '\\=' + B40.slice(0, 16)],
      ['an escaped : and % after a ghp body', 'echo ghp\\_' + B36 + '\\:' + B40.slice(0, 10) + '\\%' + B40.slice(10, 20)],
      // round 6 (review of PR 1585): each of `\\:` and `\\%` followed by an escaped `@` and more body, so a run without that escape is cut before the `@`
      ['an escaped :, then an escaped @, after a ghp body', 'echo ghp\\_' + B36 + '\\:' + B40.slice(0, 10) + '\\@' + B40.slice(10, 22)],
      ['an escaped %, then an escaped @, after a ghp body', 'echo ghp\\_' + B36 + '\\%' + B40.slice(0, 10) + '\\@' + B40.slice(10, 22)],
    ];
    for (const [what, t] of ESC_SET) {
      const want = redact(t, {});
      assert.ok(!/[A-Za-z0-9]{8}/.test(want.replace(/\[redacted\]/g, ' ').replace(/^echo /, '')), `#1585 round 5 escape set (${what}): redact shows no body: ${want}`);
      const cm = cardMask({});
      assert.strictEqual(LA.permText(t, 'shell', cm).text, want, `#1585 round 5 escape set (${what}): the card as redact`);
      assert.strictEqual(ST.maskLabel(t, 'run', cm), want, `#1585 round 5 escape set (${what}): maskLabel (run) as redact`);
      assert.strictEqual(ST.maskLabel(t, 'other', cm), want, `#1585 round 5 escape set (${what}): maskLabel (other) as redact`);
    }
    // round 6 (review of PR 1585): the desk's maskRaw masks a text with a backslash as written first, so the tail glued to an escaped head goes with it, as in redact
    for (const [what, t] of [
      ['@ after an escaped ghp head', 'echo ghp\\_' + B36 + '@' + B40.slice(0, 16)],
      ['/ after an escaped ghp head', 'echo ghp\\_' + B36 + '/' + B40.slice(0, 16)],
      ['= after an escaped ghp head', 'echo ghp\\_' + B36 + '=' + B40.slice(0, 16)],
      ['\\/ after an escaped ghp head', 'echo ghp\\_' + B36 + '\\/' + B40.slice(0, 16)],
      ['\\= after an escaped ghp head', 'echo ghp\\_' + B36 + '\\=' + B40.slice(0, 16)],
      ['\\+ after an escaped ghp head', 'echo ghp\\_' + B36 + '\\+' + B40.slice(0, 16)],
      ['the review\'s sk-proj shape', 'echo sk\\-proj\\-F8NOjdESu6\\-XEgGYm\\@wQUhx\\0wQWPqf9THhMnxFC'],
    ] as const) {
      assert.strictEqual(redact(t, {}), 'echo [redacted]', `#1585 round 6 maskRaw (${what}): redact hides it`);
      assert.strictEqual(ST.maskRaw(t, (x) => redact(x, {})), 'echo [redacted]', `#1585 round 6 maskRaw (${what}): maskRaw hides the tail too`);
    }
    // round 7 (review of PR 1585): a backslash-free text is masked as in round 5, byte for byte; a frozen reference of that path (unescape is a no-op without a backslash: mask, and the
    // Markdown-split second pass with plainKeep and the run check), so the gate in maskRaw0 cannot be dropped silently (always masking the raw text first changes these outputs)
    {
      const SPLIT5 = /[*`~[\]]/;
      const RUN5 = /[A-Za-z0-9_\-.+/=:@%]{12,}/g;
      const reEsc5 = (t: string): string => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      // `plainFrom` (spec 012 FR-182, review of PR 1721): the text the plain pass reads; round 5 read `u` itself
      const round5 = (u: string, red: (t: string) => string, plainFrom = u): string => {
        const m1 = red(u);
        if (!SPLIT5.test(u)) return m1;
        u = plainFrom;
        const k = ST.plainKeep(u);
        let m = red(k);
        const seen = new Set<string>(), found: string[] = [];
        for (const r of u.match(RUN5) ?? []) { if (seen.has(r)) continue; seen.add(r); if (red(r) !== r) found.push(r); }
        found.sort((a, b) => b.length - a.length);
        for (const r of found) m = m.replace(new RegExp(reEsc5(r) + '[A-Za-z0-9_-]*', 'g'), () => '[redacted]');
        return m !== k ? m : m1;
      };
      const red0 = (t: string) => redact(t, {});
      const G = 'ghp_' + B36;
      for (const [t, want] of [
        ['**bold**\necho\n' + G + '\n[link](u)', 'bold echo [redacted] link'],
        ['see `' + G + '` and ~x~', 'see [redacted] and x'],
        ['Token=' + G + ' [redacted] *done*', 'Token=[redacted] [redacted] done'],
        ['plain ' + G + ' text', 'plain [redacted] text'],
      ] as const) {
        assert.strictEqual(round5(t, red0), want, `#1585 round 7 gate: the frozen reference gives the round-5 output (${t.slice(0, 12)})`);
        assert.strictEqual(ST.maskRaw(t, red0), want, `#1585 round 7 gate: a backslash-free text is masked as in round 5 (${t.slice(0, 12)})`);
      }
      let seed5 = 0x1585, split = 0;
      const rnd5 = (n: number): number => { seed5 = (Math.imul(seed5, 1103515245) + 12345) & 0x7fffffff; return (seed5 >>> 16) % n; };
      const AN5 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const b5 = (n: number): string => Array.from({ length: n }, () => AN5[rnd5(62)]).join('');
      const toks5 = [() => 'ghp_' + b5(36), () => 'sk-proj-' + b5(40), () => 'github_pat_' + b5(22) + '_' + b5(59), () => 'xoxb-' + b5(12) + '-' + b5(24)];
      const words5 = ['echo', 'printf', '"x"', 'token=', 'Authorization: Bearer', '**bold**', '`code`', '[link](u)', '_em_', 'a/b/c', 'k=v', '--token', 'Done.', '{"a":1}', 'x~y', '*', '[redacted]'];
      for (let i = 0; i < 2000; i++) {
        const parts: string[] = [];
        const k = 1 + rnd5(8);
        for (let j = 0; j < k; j++) parts.push(rnd5(3) === 0 ? toks5[rnd5(toks5.length)]() : words5[rnd5(words5.length)]);
        const t = parts.join([' ', '', '\n', ', '][rnd5(4)]);
        if (SPLIT5.test(t) && round5(t, red0) !== red0(t)) split++;
        // spec 012 FR-182 (review of PR 1721, round 4): the desk masks the split tokens first (`maskSplitTokens`), then runs the round-5 steps on that output
        const want5 = maskLoose(withoutLoose(() => round5(maskSplitTokens(t), red0))); // spec 012 FR-185: the desk adds the GitHub last pass once, at its end
        // spec 012 FR-189 (issue #1940): the desk also masks a token split by link markup first; with that step off it is as in round 5, and with it on it shows no
        // piece the round-5 output does not show
        assert.strictEqual(withoutLinkSplit(() => ST.maskRaw(t, red0)), want5, `#1585 round 7 gate: a backslash-free text is masked as in round 5 (fixture case ${i}: ${JSON.stringify(t).slice(0, 80)})`);
        const on = ST.maskRaw(t, red0);
        if (on !== want5) {
          const cutAt = /\s+|\[redacted(?::[^\]\r\n]{1,128})?\]/, shown = want5.split(cutAt).join('\u0000');
          for (const p of on.split(cutAt)) assert.ok(p === '' || shown.includes(p), `#1940 round 7 gate: with the link step the desk shows nothing round 5 hides (fixture case ${i}): ${JSON.stringify(p)}`);
        }
      }
      assert.ok(split > 300, `#1585 round 7 gate: the fixture reaches the plain-kept second pass (${split} cases)`);
    }
    {
      const t = '[redacted]\\=ghp\\_QwsVGBRd4beVAmTRtEBcz0lYUNK\\@XPHikoiuV';
      const m = ST.maskRaw(t, (x) => redact(x, {}));
      assert.ok(!/QwsVGBRd|XPHikoiu/.test(m), `#1585 round 6 maskRaw: the review's [redacted]\\=ghp\\_…\\@… shape is hidden: ${m}`);
    }
  }

  // growth: linear in the text (FR-180 did the same for maskLabel)
  const many = (k: number) => Array.from({ length: Math.ceil(k / 30) }, (_, i) => 'ghp\\_' + String(i).padStart(24, 'Q')).join(' ').slice(0, k);
  assertLinearShape('#1541 redact many distinct escaped tokens', (x) => { redact(x, {}); }, many, 400_000);
  assertLinearShape('#1541 redact one escaped token repeated', (x) => { redact(x, {}); }, (k) => ('x ' + FORMS[0][1] + ' ').repeat(Math.ceil(k / (FORMS[0][1].length + 3))).slice(0, k), 400_000);
  assertLinearShape('#1541 redact one long escaped run', (x) => { redact(x, {}); }, (k) => 'a\\_'.repeat(Math.ceil(k / 3)).slice(0, k), 400_000);
  assertLinearShape('#1541 redact many escaped letters', (x) => { redact(x, {}); }, (k) => 'a\\b '.repeat(Math.ceil(k / 4)).slice(0, k), 400_000);
  assertLinearShape('#1541 redact many escaped line breaks', (x) => { redact(x, {}); }, (k) => 'a\\nb\\_c'.repeat(Math.ceil(k / 7)).slice(0, k), 400_000);
  assertLinearShape('#1585 round 4 redact one run of alternating hiding and other pieces', (x) => { redact(x, {}); }, (k) => ('ab\\n' + FORMS[0][1] + '\\ncd\\_ef\\t').repeat(Math.ceil(k / (FORMS[0][1].length + 14))).slice(0, k), 400_000);
  assertLinearShape('#1585 round 4 redact one run of breaks with an escaped token at the end', (x) => { redact(x, {}); }, (k) => 'ab\\ncd\\_ef\\t'.repeat(Math.ceil(k / 13)).slice(0, k - FORMS[0][1].length - 2) + '\\n' + FORMS[0][1], 400_000);
  assertLinearShape('#1585 round 6 maskRaw many escaped heads with tails', (x) => { ST.maskRaw(x, (t) => redact(t, {})); }, (k) => ('echo ghp\\_' + B36 + '@' + B40.slice(0, 16) + ' ').repeat(Math.ceil(k / 64)).slice(0, k), 400_000);
  assertLinearShape('#1544 redact many named markers', (x) => { redact(x, { FOO_TOKEN: 'Vq7Wx8Ec9Rv0Tb1Yn2Um3Ik4' }); }, (k) => 'Vq7Wx8Ec9Rv0Tb1Yn2Um3Ik4_ab '.repeat(Math.ceil(k / 28)).slice(0, k), 400_000);

  // a seeded randomized fixture: four token types, random escapes at random cut points, the run and other kinds, masks present or not
  {
    let seed = 0x1541;
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 16) % n; }; // Math.imul: a plain `*` here is a float above 2^53 and loses the low bits (so `seed % n` never put a backslash before n, r or t, and some kinds were never drawn: reviews of PR 1585); the high bits of the 31
    const AN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const body = (n: number): string => Array.from({ length: n }, () => AN[rnd(AN.length)]).join('');
    const kinds: Array<() => [string, string[]]> = [
      () => { const b = body(36); return ['ghp_' + b, [b]]; },
      () => { const a = body(22), b = body(59); return ['github_pat_' + a + '_' + b, [a, b]]; },
      () => { const b = body(40); return ['sk-proj-' + b, [b]]; },
      () => { const b = body(93); return ['sk-ant-api03-' + b, [b]]; },
    ];
    /** 1 to 3 backslashes at random cut points (from `min` on), before a character (a letter, a digit, `_` or `-`). */
    const escape = (t: string, min = 0, count = 0): string => {
      const at = new Set<number>();
      const n = count || 1 + rnd(3);
      while (at.size < n) at.add(min + rnd(t.length - min));
      return [...t].map((c, i) => (at.has(i) ? '\\' + c : c)).join('');
    };
    const FV = 'Vq7Wx8Ec9Rv0Tb1Yn2Um3Ik4';
    const FE = { FOO_TOKEN: FV };
    const MASKS = ['', '[redacted] ', FV + ' ', 'x[redacted]_y '];
    const t0 = Date.now();
    let cases = 0;
    let breaks = 0;
    let tails = 0;
    let heads = 0;
    let tailHidden = 0;
    for (let i = 0; i < 3000; i++) {
      const [tok, b0] = kinds[i % 4]();
      let bodies = b0;
      let e = escape(tok);
      const m = MASKS[rnd(MASKS.length)];
      const ctx = rnd(9);
      let tailOf = '';
      let text: string;
      if (ctx === 6) {
        // an escaped rest glued to a plain or named mask (the second piece of a secret whose head was masked); a break escape right after the mask ends the rest, so not at the first place
        const rest = body(22);
        const sep = ['', '_', '-'][rnd(3)];
        e = escape(rest, sep === '' ? 1 : 0);
        text = (rnd(2) ? 'x ' + FV : 'x[redacted]') + sep + e;
        bodies = [rest];
      } else if (ctx === 8) {
        // an escaped head, then a separator and an unescaped tail (round 6 of the review of PR 1585: maskRaw showed the tail; the differential never drew this)
        const tail = body(16);
        e = escape(tok) + ['@', '/', '=', '\\/', '\\=', '\\+'][rnd(6)] + tail;
        text = `echo ${e}`;
        tailOf = tail; // the tail is not part of the token: a plain head keeps it (`ghp_<36>=<16>`, as on `main`); every surface must agree with redact on it
        heads++;
      } else if (ctx === 7) {
        // two escapes, then a break escape (a shell escape of n, r or t) inside the body after at least 20 of its characters, then a tail of 8 or more (round 3 of the review of PR 1585)
        const pre = (tok.match(/^(?:ghp_|github_pat_|sk-proj-|sk-ant-api03-)/) ?? [''])[0].length;
        const at = pre + 20 + rnd(Math.max(1, tok.length - pre - 28));
        e = escape(tok.slice(0, at), 0, 2) + '\\' + ['n', 'r', 't'][rnd(3)] + tok.slice(at);
        text = `echo ${e} done`;
        tails++;
      } else {
        text = ctx === 0 ? e : ctx === 1 ? `${m}echo ${e} done` : ctx === 2 ? `run "${e}" ${m}` : ctx === 3 ? `${m}${tok}${e}` : ctx === 4 ? `curl -d x=1 ${e}` : `x ${e}${['[redacted]', FV][rnd(2)]} y`;
      }
      if (/\\[nrt]/.test(e)) breaks++;
      for (const [fn, out] of [['redact', redact(text, FE)], ['maskSecretCommand', maskSecretCommand(text, FE)], ['maskSecretArgs', maskSecretArgs(ctx === 6 ? ['srv', text] : ['srv', text, e], FE).join(' ')]] as const) {
        const leak = shows(out, bodies);
        assert.strictEqual(leak, undefined, `#1541 fuzz case ${i} (${fn}): ${JSON.stringify(text)} shows ${leak}: ${out}`);
      }
      agree(text, bodies, FE, `#1585 differential fuzz case ${i}`);
      if (tailOf && shows(redact(text, FE), [tailOf]) === undefined) {
        const cm = cardMask(FE);
        for (const [where, out] of [['maskRaw', ST.maskRaw(text, (t) => redact(t, FE))], ['card', LA.permText(text, 'shell', cm).text], ['maskLabel run', ST.maskLabel(text, 'run', cm)]] as const) {
          assert.strictEqual(shows(out, [tailOf]), undefined, `#1585 round 6 fuzz case ${i}: ${where} hides the tail redact hides: ${JSON.stringify(text)} gave ${out}`);
        }
        tailHidden++;
      }
      cases++;
    }
    assert.ok(heads > 100, `#1585 round 6 fuzz: the escaped-head kind is reached (${heads} cases)`);
    assert.ok(tails > 100, `#1585 round 3 fuzz: the kind with a break escape after two escapes is reached (${tails} cases)`);
    assert.ok(breaks > 50, `#1585 fuzz: the escapes reach n, r and t (${breaks} cases with a break escape)`);
    // text with escapes and no secret is returned as written
    const WORDS = ['a\\>b', 'C:\\Users\\me', 'foo\\_bar', 'x\\-y', '\\n', 'echo', 'grep', '"q\\.r"', 'it\\\'s', 'path\\to\\file.txt', 'a\\*b', '\\~', 'k\\=v'];
    for (let i = 0; i < 1000; i++) {
      const text = Array.from({ length: 1 + rnd(8) }, () => WORDS[rnd(WORDS.length)]).join(' ');
      assert.strictEqual(redact(text, {}), text, `#1541 fuzz: text without a secret stays as written: ${JSON.stringify(text)}`);
      cases++;
    }
    const ms = Date.now() - t0; // printed only, never asserted: a slow runner cannot fail the fixture on time (the growth asserts above are ratio-based)
    console.log(`#1541 fuzz: ${cases} cases in ${ms} ms (${breaks} with a backslash before n, r or t, ${tails} of them a break after two escapes with a tail, ${heads} an escaped head with an unescaped tail, ${tailHidden} of them with the tail hidden by redact and checked on every surface; ${diffCases} differential cases on redact, maskRaw, the card and the label in all)`);
  }
}


// 1. env values by name and by length are gone; excluded names stay
{
  const out = redact(`a ${GH} b ${env.MY_API_KEY} c ${env.SOME_RANDOM_THING} d ${env.SHORT_TOKEN} e ${env.PATH} f ${env.HOME} g ${env.SPACED}`, env);
  assert.ok(!out.includes(GH), 'env: GH_TOKEN value removed');
  assert.ok(out.includes('[redacted:GH_TOKEN]'), 'env: placeholder names the variable');
  assert.ok(!out.includes('abcd1234efgh'), 'env: *_KEY value removed');
  assert.ok(!out.includes(env.SOME_RANDOM_THING), 'env: 20+ char value removed whatever its name');
  assert.ok(out.includes('abc'), 'env: value of 3 chars is kept');
  assert.ok(out.includes(env.PATH) && out.includes(env.HOME), 'env: PATH and HOME are not redacted by length');
  assert.ok(out.includes(env.SPACED), 'env: long value with spaces is kept');
}

// 2. longest first
{
  const e = { A_TOKEN: 'secretvalue', B_TOKEN: 'secretvalue-extended-tail' };
  const out = redact('x secretvalue-extended-tail y', e);
  assert.ok(!out.includes('extended') && !out.includes('tail'), 'overlap: longer value replaced whole, no tail leaks');
  assert.strictEqual(out, 'x [redacted:B_TOKEN] y', 'overlap: exact output');
}

// 3. patterns
const planted: Record<string, string> = {
  ghp: 'ghp_' + 'x'.repeat(36),
  gho: 'gho_' + 'Y'.repeat(30),
  github_pat: 'github_pat_' + '11ABCDEFG0abcdefghij_' + 'z'.repeat(30),
  glpat: 'glpat-' + 'a1B2c3D4e5_f6G7-h8I9j0K', // GitLab personal access token (spec 093 phase 2)
  sk: 'sk-' + 'a1B2'.repeat(10),
  skant: 'sk-ant-api03-' + 'Q9w8'.repeat(10),
  bearer: 'Bearer abcdef1234567890.token-value',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36',
  aws: 'AKIA' + 'ABCDEFGH12345678',
  authHeader: 'Authorization: Basic dXNlcjpwYXNzd29yZA==',
  urlCreds: 'https://alice:hunter2pass@example.com/repo.git',
};
for (const [k, v] of Object.entries(planted)) {
  const out = redact(`before ${v} after`, {});
  assert.ok(out.includes('[redacted'), `pattern ${k}: redacted`);
  const secretPart = k === 'urlCreds' ? 'hunter2pass' : k === 'authHeader' ? 'dXNlcjpwYXNzd29yZA' : k === 'bearer' ? 'abcdef1234567890' : v.slice(-12);
  assert.ok(!out.includes(secretPart), `pattern ${k}: secret part gone (${out})`);
  assert.ok(out.startsWith('before ') && out.endsWith(' after') || k === 'authHeader', `pattern ${k}: surroundings kept`);
}
assert.strictEqual(redact('git clone https://alice:hunter2pass@example.com/r.git', {}), 'git clone https://[redacted]@example.com/r.git', 'url creds: host kept');
// 3b. `\b` does not separate `_` from a letter: a token in Markdown emphasis or glued to a snake_case word is masked too
//     (spec 012 FR-080 delta 2026-10-22). Every kind x every wrapping; the whole secret part must be gone.
const secretPartOf = (k: string, v: string): string =>
  k === 'urlCreds' ? 'hunter2pass' : k === 'authHeader' ? 'dXNlcjpwYXNzd29yZA' : k === 'bearer' ? 'abcdef1234567890' : v.slice(-12);
const WRAPS: Array<(v: string) => string> = [
  (v) => `_${v}_`, (v) => `__${v}__`, (v) => `___${v}___`, (v) => `*_${v}_*`, (v) => `**${v}**`, (v) => `~~${v}~~`,
  (v) => '`' + v + '`', (v) => `_\`${v}\`_`, (v) => `(${v})`, (v) => `[${v}](x)`, (v) => `"${v}"`, (v) => `${v}_`,
  (v) => `my_${v}`, (v) => `MY__${v}`, (v) => `____${v}____`, (v) => `a_b_c_d_${v}`, (v) => `my_long_snake_case_${v}`,
  // T129 (review of PR #543): right after a percent-encoded byte in a URL query, double-encoded too, and after the `&` and `+` separators
  ...['%3D', '%2F', '%22', '%3A', '%3d', '%253D', '%25253A'].map((e) => (v: string) => `https://x.example/?q=token${e}${v}&x=1`),
  (v) => `https://x.example/?q=%22${v}%22&x=1`, (v) => `https://x.example/?a=1&${v}&x=1`, (v) => `https://x.example/?q=a+${v}+b`,
  // T130 (review of PR #549): `%` re-encoded 4 and 6 times (any depth), and right after a backslash escape as the debug log writes it
  // after JSON.stringify (`\n`, `\t`, `\r`, double-escaped `\\n`, `\x3d`, `\u003d`), after `=`, and after a real newline or tab
  ...['%' + '25'.repeat(4) + '3D', '%' + '25'.repeat(6) + '3A'].map((e) => (v: string) => `https://x.example/?q=token${e}${v}&x=1`),
  ...['\\n', '\\t', '\\r', '\\\\n', '\\x3d', '\\u003d', '=', '\n', '\t'].map((e) => (v: string) => `"line${e}${v}${e}more"`),
];
for (const [k, v] of Object.entries(planted)) {
  for (const wrap of WRAPS) {
    const w = wrap(v);
    const out = redact(`see ${w} now`, {});
    assert.ok(!out.includes(secretPartOf(k, v)), `pattern ${k} in ${w.slice(0, 9)}…: secret part gone (${out})`);
    assert.ok(out.startsWith('see ') && out.endsWith(' now'), `pattern ${k} in ${w.slice(0, 9)}…: surroundings kept`);
  }
}
assert.strictEqual(redact('_' + planted.ghp + '_', {}), '_[redacted]_', 'emphasis kept around a GitHub token');
assert.strictEqual(redact('__' + planted.aws + '__', {}), '__[redacted]__', 'aws key between underscores');
assert.strictEqual(redact('**' + planted.sk + '**', {}), '**[redacted]**', 'sk- key in bold');
assert.strictEqual(redact('_' + planted.jwt + '_', {}), '_[redacted]', 'a JWT keeps its leading underscore (its class takes the closing one)');
// T128: a JWT glued to a word or after 4+ underscores is masked too, and its prefix stays
assert.strictEqual(redact('x_' + planted.jwt, {}), 'x_[redacted]', 'a JWT glued to a word');
assert.strictEqual(redact('MY__' + planted.jwt, {}), 'MY__[redacted]', 'a JWT after a word and two underscores');
assert.strictEqual(redact('____' + planted.jwt, {}), '____[redacted]', 'a JWT after four underscores');
assert.strictEqual(redact('a_b_c_d_' + planted.jwt, {}), 'a_b_c_d_[redacted]', 'a JWT after four snake_case words');
assert.strictEqual(redact('my_eyJ.a.b plain_snake_case risk_eyJ', {}), 'my_eyJ.a.b plain_snake_case risk_eyJ', 'snake_case words without a JWT stay');
// the shared shapes (spec 061 FR-014's folder-setup display reuses them) with their own mask word
for (const [k, v] of Object.entries(planted)) {
  if (k === 'authHeader' || k === 'urlCreds') continue; // header and URL rules belong to redact() only
  for (const wrap of WRAPS) {
    const w = wrap(v);
    const out = maskTokenShapes(`see ${w} now`, '[secret hidden]');
    assert.ok(out.includes('[secret hidden]') && !out.includes(secretPartOf(k, v)), `maskTokenShapes ${k} in ${w.slice(0, 9)}…: hidden (${out})`);
  }
}
assert.strictEqual(maskTokenShapes('$1 $& plain text', '[x]'), '$1 $& plain text', 'maskTokenShapes: no shape, no change');
// T129: exact output after a percent-encoded byte; the escape and the rest of the query stay
assert.strictEqual(redact('https://x.example/?q=token%3D' + planted.ghp + '&x=1', {}), 'https://x.example/?q=token%3D[redacted]&x=1', 'ghp after %3D');
assert.strictEqual(redact('?q=%22' + planted.sk + '%22', {}), '?q=%22[redacted]%22', 'sk- between %22');
assert.strictEqual(redact('?q=token%253D' + planted.aws + '&x', {}), '?q=token%253D[redacted]&x', 'aws after a double-encoded %253D');
assert.strictEqual(redact('?q=%3D' + planted.jwt + '&x', {}), '?q=%3D[redacted]&x', 'a JWT after %3D');
assert.strictEqual(maskTokenShapes('?q=%2F' + planted.github_pat, '[s]'), '?q=%2F[s]', 'maskTokenShapes: github_pat after %2F');
// T130: any depth of `%25` (4, 5 and 6 levels), and a backslash escape before the token; the escape stays
for (const d of [4, 5, 6]) {
  const e = '%' + '25'.repeat(d) + '3D';
  assert.strictEqual(redact('?q=token' + e + planted.ghp + '&x', {}), '?q=token' + e + '[redacted]&x', `ghp after %25 encoded ${d} times`);
}
assert.strictEqual(redact('"a\\n' + planted.ghp + '\\tb"', {}), '"a\\n[redacted]\\tb"', 'ghp after an escaped newline');
assert.strictEqual(redact('"a\\\\n' + planted.sk + '"', {}), '"a\\\\n[redacted]"', 'sk- after a double-escaped newline');
assert.strictEqual(redact('k\\x3d' + planted.aws + ' k\\u003d' + planted.gho, {}), 'k\\x3d[redacted] k\\u003d[redacted]', 'after \\x3d and \\u003d');
// T129: plain words, hex and percent signs in normal text stay (the new start needs `%` and two hex digits right before a shape)
for (const ok of ['50% off, 100%3Dfine', 'colour %23ff0000 and deadbeef cafe0123456789abcdef', 'a%3Dghp_short x%41BC', '%3Dsk-short %2FAKIA123',
  'q=%3DeyJ.a.b', '%3DBearer', '%ZZghp_' + 'x'.repeat(36), '3Dghp_' + 'x'.repeat(36), '%3' + planted.ghp.slice(0, 1) + 'hp', 'ab%3Dsk-risk-management',
  // T130: backslashes in paths and other escapes stay
  'C:\\new\\temp and \\nfile \\tab', '\\nghp_short \\tsk-short', '\\q' + planted.ghp, '\\x3' + planted.ghp, '\\u003' + planted.ghp]) {
  assert.strictEqual(redact(ok, {}), ok, `near miss kept: ${ok}`);
}
assert.strictEqual(maskTokenShapes('_' + planted.ghp + '_', '$&'), '_$&_', 'maskTokenShapes: the mask is literal, not a replacement pattern');

// 4. near misses stay intact
for (const ok of ['risk-management and task-list', 'sk-short', 'the sk- prefix', 'ghp', 'ghp_short', 'AKIA123', 'v1.2.3', 'file.name.ext', 'https://example.com/a:b', 'user@example.com', 'Bearer', 'a Bearer of news', 'eyJ.a.b']) {
  assert.strictEqual(redact(ok, {}), ok, `near miss kept: ${ok}`);
}

// 5. line structure
assert.strictEqual(redact(`l1\n${planted.ghp}\r\nl3\n`, {}), 'l1\n[redacted]\r\nl3\n', 'line structure kept');

// 6. 1 MB input is fast, and capped
{
  const big = ('word '.repeat(19) + 'sk-' + 'a'.repeat(10) + '\n').repeat(12000); // > 1 MB
  assert.ok(big.length > REDACT_MAX_CHARS);
  assert.ok(redact(big, env).length <= REDACT_MAX_CHARS + 20, 'input capped at 1 MB');
  // linear, against the same shape in the same run (spec 012 T138), also past the cap
  assertLinearShape('1 MB redaction', (x) => void redact(x, env), (n) => big.slice(0, n), 1_000_000);
  assertLinearShape('pathological single token', (x) => void redact(x, env), (n) => 'a'.repeat(n / 2) + ':' + 'a'.repeat(n / 2), 900_000); // under the cap: past it, the cut would leave nothing to time
}

// 7. never throws
for (const bad of [null, undefined, 42, {}, [], Symbol('x'), { toString() { throw new Error('boom'); } }]) {
  assert.doesNotThrow(() => redact(bad as unknown as string, env), `no throw on ${String(typeof bad)}`);
}
assert.strictEqual(redact(null as unknown as string, env), '');
assert.doesNotThrow(() => redact('x', null as unknown as Record<string, string>));

// 8. end to end through the real debug sink (JSON-encoded records, escaped values too)
{
  const lines: string[] = [];
  const trickyEnv = { GH_TOKEN: GH, COPILOT_X_SECRET: 'with"quote\\and-more' };
  const write = createDebugSink('/dev/null/events.jsonl', trickyEnv, (_f, data) => lines.push(data));
  write({ t: 1, debug: `runtime failed, env GH_TOKEN=${GH}` });
  write({ t: 2, event: { type: 'error', message: `bad ${trickyEnv.COPILOT_X_SECRET} and ${planted.sk}` } });
  write({ t: 3, debug: 'plain line' });
  const all = lines.join('');
  assert.ok(!all.includes(GH), 'sink: planted GH_TOKEN never written');
  assert.ok(!all.includes('with\\"quote'), 'sink: JSON-escaped env value never written');
  assert.ok(!all.includes(planted.sk), 'sink: key pattern never written');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.every((l) => l.endsWith('\n') && JSON.parse(l)), 'sink: one valid JSON line per record');
  assert.strictEqual(JSON.parse(lines[2]).debug, 'plain line', 'sink: clean records unchanged');
  assert.doesNotThrow(() => write(undefined), 'sink: undefined record');
  const circ: Record<string, unknown> = {}; circ.self = circ;
  assert.doesNotThrow(() => write(circ), 'sink: circular record');
  // T130 (review of PR #549): the sink redacts after JSON.stringify, so a token at the start of a line becomes `\nghp_…`; it is masked,
  // after a tab and after a backslash-n that was already in the text (`\\n` once encoded) too
  lines.length = 0;
  write({ t: 5, stderr: `line one\n${planted.ghp}\n\t${planted.aws}\r\n${planted.skant}`, nested: { out: `C:\\new\\n${planted.sk}`, arr: [`\n${planted.jwt}`] } });
  assert.strictEqual(lines.length, 1);
  for (const k of ['ghp', 'aws', 'skant', 'sk', 'jwt']) assert.ok(!lines[0].includes(planted[k].slice(-12)), `sink: ${k} after an escaped newline or tab never written (${lines[0]})`);
  const rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.stderr, 'line one\n[redacted]\n\t[redacted]\r\n[redacted]', 'sink: line breaks and tabs kept, tokens masked');
  assert.strictEqual(rec.nested.out, 'C:\\new\\n[redacted]', 'sink: a backslash-n already in the text');
  assert.strictEqual(rec.nested.arr[0], '\n[redacted]', 'sink: a JWT after a newline');
}

// T132 (spec 012 FR-080 delta 2026-10-23, issue #551): Slack, Discord and Telegram secrets, and the `=XX` / `%uXXXX` starts.
// Fake values, built at run time so no secret scanner takes them for real ones.
const AZ = 'AbCdEfGhIjKlMnOpQrStUvWx';
const TG35 = 'AAH' + AZ + '_-AbCdEf'; // a real-shaped Telegram token part: exactly 35 characters
assert.strictEqual(TG35.length, 35);
const DBOT = 'M' + 'TIzNDU2Nzg5MDEyMzQ1Njc4' + '.GhIjKl.' + AZ + '_-AbC'; // user id (24), timestamp (6), HMAC (29)
const chat: Record<string, { v: string; secret: string; keep?: string }> = {
  slackBot: { v: 'xo' + 'xb-' + '1234567890-0987654321-' + AZ, secret: AZ },
  slackUser: { v: 'xo' + 'xp-' + '1234567890-0987654321-1122334455-' + AZ, secret: AZ },
  slackApp: { v: 'xa' + 'pp-' + '1-A0123456789-1234567890123-' + AZ.toLowerCase(), secret: AZ.toLowerCase() },
  slackHook: { v: 'https://hooks.slack.com/services/' + 'T0123ABCD/B0123ABCD/' + AZ, secret: 'T0123ABCD', keep: 'https://hooks.slack.com/services/' },
  discord: { v: 'https://discord.com/api/webhooks/' + '123456789012345678/' + AZ + '_-' + AZ, secret: '123456789012345678', keep: 'https://discord.com/api/webhooks/' },
  discordapp: { v: 'https://discordapp.com/api/webhooks/' + '123456789012345678/' + AZ + '_-' + AZ, secret: AZ + '_-' + AZ, keep: 'https://discordapp.com/api/webhooks/' },
  telegram: { v: '123456789:' + TG35, secret: AZ },
  telegramApi: { v: 'https://api.telegram.org/bot' + '123456789:' + TG35 + '/getMe', secret: AZ, keep: 'https://api.telegram.org/bot' },
  // review of PR #679: session tokens, Workflow Builder webhooks, other Telegram hosts, Discord bot tokens
  slackSession: { v: 'xo' + 'xd-' + 'AbCdEf%2BGh%2FIj' + AZ, secret: AZ },
  slackCookie: { v: 'xo' + 'xc-' + '1234567890-0987654321-' + AZ, secret: AZ },
  slackWorkflow: { v: 'https://hooks.slack.com/workflows/' + 'T0123ABCD/A0123ABCD/123456789/' + AZ, secret: 'A0123ABCD', keep: 'https://hooks.slack.com/workflows/' },
  slackTrigger: { v: 'https://hooks.slack.com:443/triggers/' + 'T0123ABCD/123456789/' + AZ, secret: 'T0123ABCD', keep: 'https://hooks.slack.com:443/triggers/' },
  discordHostVar: { v: 'https://discord.com.:443//api//webhooks//' + '123456789012345678//' + AZ + '_-' + AZ, secret: '123456789012345678', keep: 'https://discord.com.:443//api//webhooks//' },
  telegramFile: { v: 'https://api.telegram.org/file/bot' + '123456789:' + TG35 + '/photos/x.jpg', secret: AZ, keep: 'https://api.telegram.org/file/bot' },
  telegramLocal: { v: 'http://localhost:8081/bot' + '1234567:' + TG35 + '/getMe', secret: AZ, keep: 'http://localhost:8081/bot' },
  discordBot: { v: DBOT, secret: AZ },
  discordBotEnc: { v: DBOT.replace(/\./g, '%2E'), secret: AZ },
  discordBotEnc2: { v: DBOT.replace(/\./g, '%252e'), secret: AZ },
};
/** Test fixtures: write every `/` (or the Telegram token's `:` after its digits) in another spelling, on purpose not an escape. */
const swapSlash = (x: string, to: string): string => x.split('/').join(to);
const swapColon = (x: string, to: string): string => x.replace(/([0-9]):/g, (_m, d: string) => d + to);
for (const [k, c] of Object.entries(chat)) {
  const encTwice = (x: string): string => encodeURIComponent(encodeURIComponent(x));
  const titleHost = (x: string): string => x.replace(/^https:\/\/[^/]+/, (h) => h.replace(/(^|[.\/])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()));
  const forms = c.keep
    ? [c.v, swapSlash(c.v, '\\/'), swapSlash(c.v, '\\\\/'), swapSlash(c.v, '\\u002f'), swapSlash(c.v, '\\x2F'), 'https://x.example/?u=' + encodeURIComponent(c.v),
      'https://x.example/?u=' + encTwice(c.v), 'https://x.example/?u=' + encodeURIComponent(encTwice(c.v)), c.v.replace(/^https:\/\/[^/]+/, (h) => h.toUpperCase()), titleHost(c.v)]
    : [c.v, swapColon(c.v, '%3A'), swapColon(c.v, '%253a'), swapColon(c.v, '\\u003A'), swapColon(c.v, '\\x3a')];
  for (const form of forms) {
    for (const wrap of WRAPS) {
      const w = wrap(form);
      // a Telegram token part may hold `_`, so an underscore glued right after it is part of it (35 exactly is the shape): not a token then
      if (k === 'telegram' && w.includes(form + '_')) continue;
      const out = redact(`see ${w} now`, {});
      assert.ok(!out.includes(c.secret), `T132 ${k} in ${w.slice(0, 12)}…: secret part gone (${out})`);
      assert.ok(out.startsWith('see ') && out.endsWith(' now'), `T132 ${k} in ${w.slice(0, 12)}…: surroundings kept`);
      const out2 = maskTokenShapes(`see ${w} now`, '[secret hidden]');
      assert.ok(out2.includes('[secret hidden]') && !out2.includes(c.secret), `T132 maskTokenShapes ${k} in ${w.slice(0, 12)}…: hidden (${out2})`);
    }
  }
  // JSON.stringify output (the debug log redacts after it) and a token right after a quoted-printable or %uXXXX escape
  assert.ok(!redact(JSON.stringify({ line: c.v }), {}).includes(c.secret), `T132 ${k} in JSON`);
  for (const e of ['=3D', '=0A', '%u003D', '%u0022', '%u003d']) {
    const out = redact(`a${e}${c.v}&x`, {});
    assert.ok(!out.includes(c.secret), `T132 ${k} after ${e}: ${out}`);
    assert.ok(!maskTokenShapes(`a${e}${c.v}&x`, '[s]').includes(c.secret), `T132 maskTokenShapes ${k} after ${e}`);
  }
}
// exact output: the scheme and host of a webhook stay, the secret path goes
assert.strictEqual(redact('post ' + chat.slackHook.v + ' now', {}), 'post https://hooks.slack.com/services/[redacted] now', 'slack webhook: host kept');
assert.strictEqual(redact(chat.discord.v, {}), 'https://discord.com/api/webhooks/[redacted]', 'discord webhook: host kept');
assert.strictEqual(redact('https://discordapp.com/api/v10/webhooks/123456789012/' + AZ + AZ, {}), 'https://discordapp.com/api/v10/webhooks/[redacted]', 'discordapp versioned');
assert.strictEqual(redact(chat.telegramApi.v, {}), 'https://api.telegram.org/bot[redacted]/getMe', 'telegram api URL: host and method kept');
assert.strictEqual(redact('token ' + chat.telegram.v + '.', {}), 'token [redacted].', 'telegram bare token');
assert.strictEqual(redact('a ' + chat.slackBot.v + ' b', {}), 'a [redacted] b', 'slack bot token');
assert.strictEqual(redact('=3D' + chat.slackBot.v, {}), '=3D[redacted]', 'slack token after =3D');
assert.strictEqual(redact('%u003D' + chat.slackApp.v, {}), '%u003D[redacted]', 'slack token after %u003D');
assert.strictEqual(redact('=3D' + planted.ghp + ' %u003D' + planted.sk, {}), '=3D[redacted] %u003D[redacted]', 'ghp after =3D, sk- after %u003D');
assert.strictEqual(maskTokenShapes('=3D' + planted.aws, '[s]'), '=3D[s]', 'maskTokenShapes: aws after =3D');
// Telegram is the exact shape (6-12 digits, `:`, 35 characters, nothing token-like after): ids, sessions and file names are not tokens
{
  const L = (n: number): string => AZ.repeat(2).slice(0, n);
  for (const ok of ['1729680000:session_' + L(40), 'bundle.js:1234567:' + L(40), 'bundle.js:12345678:' + L(36), 'id=12345678:' + L(36), 'x 123456789:' + L(34), 'x 1234567890123:' + L(35), 'x 12345:' + L(35), 'x 123456789:' + L(35) + '_more']) {
    assert.strictEqual(redact(ok, {}), ok, `telegram false positive stays: ${ok.slice(0, 40)}`);
    assert.strictEqual(maskTokenShapes(ok, '[s]'), ok, `maskTokenShapes telegram false positive stays: ${ok.slice(0, 40)}`);
  }
  for (const n of [6, 7, 8, 9, 10, 11, 12]) assert.strictEqual(redact('t ' + '1'.repeat(n) + ':' + L(35) + '.', {}), 't [redacted].', `a ${n}-digit id with a 35-character part is a token`);
}
// the Slack prefix set: `xoxo-` is not one, `xoxa-` `xoxr-` `xoxs-` `xoxe-` are
assert.strictEqual(redact('xoxo-hugs-and-kisses xoxo-1234567890123', {}), 'xoxo-hugs-and-kisses xoxo-1234567890123', 'xoxo- is not a Slack token');
for (const c of 'abprse') assert.strictEqual(redact('t xo' + 'x' + c + '-1234567890-' + AZ + ' z', {}), 't [redacted] z', `xox${c}- is masked`);
// `=XX` is upper case only: after `=3d` the token is glued to a letter, so no rule starts there; after `=3D` it does
assert.strictEqual(redact('a=3d' + planted.ghp, {}), 'a=3d' + planted.ghp, 'ghp after lower-case =3d: no start (documented limit, spec 012 T132)');
assert.strictEqual(redact('a=3D' + planted.ghp, {}), 'a=3D[redacted]', 'ghp after upper-case =3D');
// encodings: any depth of `%25`, and the scheme/host of a webhook kept in the same case it was written
assert.strictEqual(redact('u=' + encodeURIComponent(encodeURIComponent(chat.slackHook.v)), {}), 'u=https%253A%252F%252Fhooks.slack.com%252Fservices%252F[redacted]', 'double-encoded slack webhook');
assert.strictEqual(redact('HTTPS://HOOKS.SLACK.COM/SERVICES/T0123ABCD/B0123ABCD/' + AZ, {}), 'HTTPS://HOOKS.SLACK.COM/SERVICES/[redacted]', 'upper-case host');
assert.strictEqual(redact('https://Discord.com/API/Webhooks/123456789012345678/' + AZ + AZ, {}), 'https://Discord.com/API/Webhooks/[redacted]', 'mixed-case discord host');
assert.strictEqual(redact('https://API.TELEGRAM.ORG/BOT123456789:' + TG35 + '/x', {}), 'https://API.TELEGRAM.ORG/BOT[redacted]/x', 'upper-case telegram host');
// review of PR #679: every input of the review gets a row (S = a fake secret built at run time)
{
  const S = AZ + '9';
  const TGS = (id: string): string => id + ':' + TG35;
  const tg = (host: string, tail = '/getMe'): string => host + '/bot' + TGS('123456789') + tail;
  // 1. Telegram on any host, port or path: only the token goes
  for (const [host, want] of [['https://api.telegram.org/file', 'https://api.telegram.org/file/bot[redacted]/getMe'], ['http://localhost:8081', 'http://localhost:8081/bot[redacted]/getMe'],
    ['https://proxy.example.net/tg/v2', 'https://proxy.example.net/tg/v2/bot[redacted]/getMe'], ['https://api.telegram.org:443', 'https://api.telegram.org:443/bot[redacted]/getMe'],
    ['https://api.telegram.org.', 'https://api.telegram.org./bot[redacted]/getMe']] as const) {
    assert.strictEqual(redact(tg(host), {}), want, `telegram on ${host}`);
    assert.strictEqual(maskTokenShapes(tg(host), '[redacted]'), want, `maskTokenShapes telegram on ${host}`);
  }
  assert.strictEqual(redact(tg('https://api.telegram.org/file', '/photos/x.jpg'), {}), 'https://api.telegram.org/file/bot[redacted]/photos/x.jpg', 'telegram file download URL');
  assert.strictEqual(redact('u=' + encodeURIComponent(tg('http://localhost:8081')), {}), 'u=http%3A%2F%2Flocalhost%3A8081%2Fbot[redacted]%2FgetMe', 'encoded local Bot API URL');
  assert.strictEqual(redact('see ' + 'https://t.me/somebot123456789:short', {}), 'see https://t.me/somebot123456789:short', 'a word ending in bot with a short tail stays');
  // 2. Slack session tokens, also URL-encoded
  for (const pre of ['xoxc-', 'xoxd-']) {
    const t = 'xo' + pre.slice(2);
    assert.strictEqual(redact('c ' + t + '1234567890-' + S + ' z', {}), 'c [redacted] z', `${t} session token`);
    assert.strictEqual(redact('cookie=' + t + 'AbCdEf%2BGh%2FIj%3D%3D' + S + '; path=/', {}), 'cookie=[redacted]; path=/', `${t} with %XX escapes: all of it goes`);
  }
  assert.strictEqual(redact('d=' + encodeURIComponent('xo' + 'xd-' + 'AbCdEf+Gh/Ij' + S + '=='), {}), 'd=[redacted]', 'URL-encoded xoxd- token');
  // 3 and 4. Slack Workflow Builder and trigger webhooks, and host variants for both hosts
  const sw = (path: string): string => path.replace('<s>', S);
  const slackWant = (h: string, p: string): string => `${h}${p}/[redacted]`;
  for (const host of ['https://hooks.slack.com', 'https://hooks.slack.com:443', 'https://hooks.slack.com.', 'https://hooks.slack.com.:8443', 'https://HOOKS.SLACK.COM']) {
    for (const [kind, rest] of [['services', 'T0123ABCD/B0123ABCD/<s>'], ['workflows', 'T0123ABCD/A0123ABCD/123456789/<s>'], ['triggers', 'T0123ABCD/123456789/<s>']] as const) {
      assert.strictEqual(redact(`${host}/${kind}/${sw(rest)} x`, {}), slackWant(host, `/${kind}`) + ' x', `${host}/${kind}`);
      assert.strictEqual(redact(`${host}//${kind}//${sw(rest.split('/').join('//'))} x`, {}), `${host}//${kind}//[redacted] x`, `${host}//${kind}// double slashes`);
    }
  }
  for (const host of ['https://discord.com', 'https://discord.com:443', 'https://discord.com.', 'https://discordapp.com.:443']) {
    const hook = `/api/webhooks/123456789012345678/${AZ}_-${AZ}`;
    assert.strictEqual(redact(host + hook, {}), host + '/api/webhooks/[redacted]', `${host} webhook`);
    assert.strictEqual(redact(host + '//api//v10//webhooks//123456789012345678//' + AZ + '_-' + AZ, {}), host + '//api//v10//webhooks//[redacted]', `${host} double slashes`);
  }
  assert.strictEqual(redact('https://hooks.slack.com/services/T0123ABCD/B0123ABCD/', {}), 'https://hooks.slack.com/services/T0123ABCD/B0123ABCD/', 'a webhook without its secret stays');
  assert.strictEqual(redact('https://hooks.slack.com/other/T0123ABCD/B0123ABCD/' + S, {}), 'https://hooks.slack.com/other/T0123ABCD/B0123ABCD/' + S, 'not a webhook path: not touched here');
  // 5. the last segment is whole: long, underscore and hyphen secrets leave no tail
  for (const last of ['a'.repeat(300), 'a'.repeat(40) + '_' + S, S + '-' + S + '_' + 'Z'.repeat(150)]) {
    assert.strictEqual(redact('https://hooks.slack.com/services/T0123ABCD/B0123ABCD/' + last + ' end', {}), 'https://hooks.slack.com/services/[redacted] end', `slack last segment ${last.length} chars`);
  }
  // 6. Telegram ids of 6 to 12 digits; the false positives of the review stay
  for (const n of [6, 7, 11, 12]) {
    assert.strictEqual(redact('t ' + '7'.repeat(n) + ':' + TG35, {}), 't [redacted]', `${n}-digit bot id`);
    assert.strictEqual(redact(tg('https://api.telegram.org').replace('123456789', '7'.repeat(n)), {}), 'https://api.telegram.org/bot[redacted]/getMe', `${n}-digit bot id after /bot`);
  }
  for (const ok of ['x ' + '7'.repeat(13) + ':' + TG35, 'x ' + '7'.repeat(5) + ':' + TG35, '1729680000:session_' + 'a'.repeat(40), 'bundle.js:1234567:' + 'a'.repeat(40), 'f.js:1234567:' + 'a'.repeat(36), 'f.js:1234567:' + 'a'.repeat(34)]) {
    assert.strictEqual(redact(ok, {}), ok, `telegram id false positive stays: ${ok.slice(0, 30)}`);
    assert.strictEqual(maskTokenShapes(ok, '[s]'), ok, `maskTokenShapes telegram id false positive stays: ${ok.slice(0, 30)}`);
  }
  // 8. Discord bot tokens: user id . timestamp . HMAC
  assert.strictEqual(redact('token ' + DBOT + ' end', {}), 'token [redacted] end', 'discord bot token');
  assert.strictEqual(redact('{"t":"' + DBOT + '"}', {}), '{"t":"[redacted]"}', 'discord bot token in JSON');
  assert.strictEqual(redact('Bot ' + DBOT, {}), 'Bot [redacted]', 'Authorization: Bot <token>');
  for (const dot of ['%2E', '%2e', '%252E', '%25252e']) assert.strictEqual(redact('t=' + DBOT.replace(/\./g, dot) + '&x', {}), 't=[redacted]&x', `discord bot token with ${dot} dots`);
  for (const sec of ['D', 'T', 'j', 'z']) for (const lead of 'MNO') assert.strictEqual(redact(lead + sec + 'a'.repeat(23) + '.abcdef.' + 'b'.repeat(30), {}), '[redacted]', `${lead}${sec} id start`);
  // a 17-digit id (accounts and bots from 2015 and early 2016) is 23 base64 characters (review of PR #679)
  for (const id of ['N' + 'DU2Nzg5MDEyMzQ1Njc4OTA', 'N' + 'zg5MDEyMzQ1Njc4OTAxMjM']) {
    const tok = id + '.GaBcDe.' + 'h'.repeat(27);
    assert.strictEqual(redact('t ' + tok + ' e', {}), 't [redacted] e', 'discord bot token with a 17-digit id');
    assert.strictEqual(redact('t=' + tok.replace(/\./g, '%2E') + '&x', {}), 't=[redacted]&x', 'discord bot token with a 17-digit id and %2E dots');
    assert.strictEqual(redact('{"t":"' + tok + '"}', {}), '{"t":"[redacted]"}', 'discord bot token with a 17-digit id in JSON');
  }
  assert.strictEqual(redact('N' + 'T' + 'a'.repeat(22) + '.abcdef.' + 'b'.repeat(27) + 'c'.repeat(30), {}), '[redacted]', 'a longer HMAC is masked whole');
  for (const [idLen, hmacLen] of [[22, 27], [23, 27], [27, 27], [24, 38], [24, 60]]) {
    assert.strictEqual(redact('x ' + 'M' + 'T' + 'a'.repeat(idLen - 1) + '.abcdef.' + 'b'.repeat(hmacLen) + ' y', {}), 'x [redacted] y', `discord bot token with a ${idLen + 1}-character id and a ${hmacLen}-character HMAC`);
  }
  for (const ok of ['Org.Example.Foo', 'Microsoft.Extensions.Logging.Abstractions.Something', 'M' + 'T' + 'a'.repeat(23) + '.abcdefg.' + 'b'.repeat(30), 'M' + 'T' + 'a'.repeat(23) + '.abcde.' + 'b'.repeat(30), 'M' + 'T' + 'a'.repeat(20) + '.abcdef.' + 'b'.repeat(30), 'M' + 'a'.repeat(24) + '.abcdef.' + 'b'.repeat(30),
    'MainActivityControllerImpl.helper.SomeVeryLongClassNameHereXYZ1', 'MyComponentPackageNameHere.module.webpack-chunk-abcdefghijklmnop.js',
    'org.apache.commons.MathUtilsHelperClassName.common.LongerArtifactNameIsHereOkay', 'NorthwindTradersMarketing.static.MarketingWebsiteCdnAssetsBucketName.com',
    'M' + 'T' + 'a'.repeat(23) + '.abcdef.' + 'b'.repeat(26), 'X' + 'T' + 'a'.repeat(23) + '.abcdef.' + 'b'.repeat(30), 'v1.2.3 N1.2.3 file.tar.gz', 'aM' + 'a'.repeat(23) + '.abcdef.' + 'b'.repeat(30)]) {
    assert.strictEqual(redact(ok, {}), ok, `discord bot false positive stays: ${ok.slice(0, 30)}`);
    assert.strictEqual(maskTokenShapes(ok, '[s]'), ok, `maskTokenShapes discord bot false positive stays: ${ok.slice(0, 30)}`);
  }
  // a JWT is masked whole by its own shape, even when its signature looks like a Discord HMAC; two in a row both go
  const jwt = 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0.' + 'M' + 'T' + 'a'.repeat(30);
  assert.strictEqual(redact('a ' + jwt + ' b ' + DBOT, {}), 'a [redacted] b [redacted]', 'JWT and Discord bot token side by side');
}
// the guard never changes the result (T132 review): every kind x encoding x prefix, then random strings of markers and separators
{
  const pieces: string[] = [];
  const prefixes = ['', 'x ', '=3D', '%u003D', '_', '"', '\\n', '%253D'];
  for (const c of Object.values(chat)) {
    const vs = [c.v, swapSlash(c.v, '\\/'), swapSlash(c.v, '%2F'), swapSlash(c.v, '%252f'), swapSlash(c.v, '\\u002F'), swapSlash(c.v, '\\x2f'), swapColon(c.v, '%3a'), swapColon(c.v, '%25253A'), swapColon(c.v, '\\u003a'), swapColon(c.v, '\\x3A'),
      c.v.toUpperCase(), c.v.replace(/^https:\/\/[^/]+/, (h) => h.toUpperCase())];
    pieces.push(...vs);
    for (const v of vs) for (const pre of prefixes) {
      const t = `see ${pre}${v} now`;
      assert.strictEqual(maskTokenShapes(t, '[s]'), maskTokenShapesUnguarded(t, '[s]'), `guard equivalence on ${t.slice(0, 50)}`);
    }
  }
  pieces.push('xox', 'xoxb-', 'xapp-', 'XOXB-', 'hooks.slack.com', 'HOOKS.Slack.com', 'discord', 'discordapp.com', 'DISCORD.COM', 'api', 'webhooks', 'services', 'api.telegram.org', 'API.TELEGRAM.ORG', 'bot', '/bot', 'file', 'workflows', 'triggers', 'xoxd-', 'xoxc-', '%2B', '%2E', '%252e', ':443', '.:8081', '//', DBOT, '.GhIjKl.', ':', '%3A', '%253a', '\\u003a', '\\x3A',
    '/', '\\/', '%2F', '%252f', '\\u002f', '12345678', '1234567890', AZ, AZ + AZ, TG35, 'T0123ABCD', ' ', '_', '-', '=3D', '%u003D', '.');
  let seed = 12345;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  let changed = 0;
  for (let i = 0; i < 6000; i++) {
    let t = '';
    for (let j = 0, n = 2 + rnd(14); j < n; j++) t += pieces[rnd(pieces.length)];
    const g = maskTokenShapes(t, '[s]');
    assert.strictEqual(g, maskTokenShapesUnguarded(t, '[s]'), `guard equivalence on random ${JSON.stringify(t.slice(0, 80))}`);
    if (g !== t) changed++;
  }
  assert.ok(changed > 100, `the random corpus reaches the shapes (${changed} of 6000 changed)`);
}
// false positives stay
for (const ok of ['the xox of it, xoxo, xoxo-friends xoxb- xoxb-short xapp- xapp-abc', 'xoxz-1234567890123 xoxbb-1234567890123', 'at 12:30 or 12345:abc or 1234:short or 1234567:' + 'a'.repeat(29),
  '12:30:45 123456789:' + 'a'.repeat(29) + ' 1234567890123:' + 'a'.repeat(40) + 'x',
  'https://hooks.slack.com/services/ https://hooks.slack.com/services/T0123ABCD https://hooks.slack.com/services/T0123ABCD/B0123ABCD https://hooks.slack.com/ https://slack.com/help',
  'https://discord.com/api/webhooks/ https://discord.com/api/webhooks/123456789 https://discord.com/channels/123456789012/987654321098 https://discord.com/invite/abcdefg https://discord.com/',
  'https://api.telegram.org/bot https://api.telegram.org/bot123456789:short https://t.me/somebot', 'a%3Dxoxb-short x=3Dfine =3dxoxb-short =3D']) {
  assert.strictEqual(redact(ok, {}), ok, `false positive stays: ${ok.slice(0, 40)}`);
  assert.strictEqual(maskTokenShapes(ok, '[s]'), ok, `maskTokenShapes false positive stays: ${ok.slice(0, 40)}`);
}

// 10. the cap never leaks part of a secret, and the sink always writes one valid JSON line
{
  const secret = 'ghp_' + 'S3cr3t'.repeat(8);
  const half = secret.length / 2;
  for (const shift of [0, 1, half, secret.length - 1]) {
    // key-like secret straddling the cut
    const pre = 'x '.repeat((REDACT_MAX_CHARS - shift) / 2);
    const out = redact(pre + secret + ' tail', {});
    assert.ok(!out.includes('S3cr3t') && !/ghp_/.test(out), `cut straddling pattern secret (shift ${shift})`);
    assert.ok(!out.includes('\n'), 'truncation marker has no newline');
    // env secret straddling the cut: replaced before the cut
    const envOut = redact(pre + 'ZZ' + 'q9w8e7r6t5y4'.repeat(2) + ' tail', { MY_TOKEN: 'q9w8e7r6t5y4'.repeat(2) });
    assert.ok(!envOut.includes('q9w8') && !envOut.includes('t5y4'), `cut straddling env secret (shift ${shift})`);
  }
  // env secret with characters outside the token class, across the cut: no prefix of it may remain
  const odd = 'ab!cd*ef-gh!ij*kl-mn!op*qr-st!uv*wx';
  for (let shift = 1; shift < odd.length; shift += 4) {
    const pre = 'x '.repeat((REDACT_MAX_CHARS - shift) / 2) + (shift % 2 ? 'x' : '');
    const out = redact(pre.slice(0, REDACT_MAX_CHARS - shift) + odd + ' tail', { MY_TOKEN: odd });
    for (let k = 3; k <= odd.length; k++) assert.ok(!out.includes(odd.slice(0, k)), `cut straddling non-token-char env secret: prefix of ${k} chars remains (shift ${shift})`);
  }
  assert.ok(redact('a'.repeat(REDACT_MAX_CHARS + 10), {}).endsWith(' [truncated]'));
  const lines: string[] = [];
  const write = createDebugSink('f', { GH_TOKEN: GH }, (_f, d) => lines.push(d));
  write({ t: 1, debug: ('line\n' + GH + ' ').repeat(200000) });
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].split('\n').length, 2, 'oversized record is one line');
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.truncated, true);
  assert.ok(!lines[0].includes(GH), 'oversized record has no token');
}

// 10b. Copilot API session token, and more length-rule exclusions
{
  const tok = 'tid=0a1b2c3d4e5f;exp=1760000000;sku=free_limited;proxy-ep=proxy.individual.example.com;st=dotcom:9f8e7d6c5b4a39281706f5e4d3c2b1a0';
  assert.strictEqual(redact(tok, {}), '[redacted]', 'copilot token: bare');
  const msg = redact(`request failed: invalid token ${tok} (status 401)`, {});
  assert.ok(!msg.includes('9f8e7d6c') && !msg.includes('proxy-ep') && msg.startsWith('request failed: invalid token [redacted]'), 'copilot token: inside an error message');
  for (const ok of ['tid=abc', 'set tid=abc; then go', 'the tid=12345678 field']) assert.strictEqual(redact(ok, {}), ok, `copilot token near miss kept: ${ok}`);
  const p = '/Users/somebody/projects/some/long/workspace/path';
  const e = { VSCODE_CWD: p, TERM_SESSION_ID: 'w0t0p0:0123456789-ABCDEF-0123', XPC_SERVICE_NAME: 'application.com.example.long.name.1', TERM_PROGRAM_VERSION: '1.2.3.4.5.6.7.8.9.10.11.12', ITERM_PROFILE: 'a-long-profile-name-here', COLORTERM: 'truecolor-24bit-very-long' };
  const text = Object.values(e).join(' | ');
  assert.strictEqual(redact(text, e), text, 'terminal/editor variables stay readable');
}

// 11. URL credentials do not run across JSON fields
assert.strictEqual(redact('{"a":"https://x","b":"y@z"}', {}), '{"a":"https://x","b":"y@z"}', 'url creds: no match across JSON fields');
assert.strictEqual(redact('{"a":"https://u:p@h/x","b":"y"}', {}), '{"a":"https://[redacted]@h/x","b":"y"}');

// 12. encoded forms of env secrets
{
  const e = { MY_SECRET: 'p@ss w/ord"x\\y&z=1' };
  const raw = e.MY_SECRET;
  const forms: Record<string, string> = {
    raw,
    json: JSON.stringify(raw).slice(1, -1),
    jsonTwice: JSON.stringify(JSON.stringify(raw).slice(1, -1)).slice(1, -1),
    urlEncoded: encodeURIComponent(raw),
  };
  for (const [k, f] of Object.entries(forms)) {
    const out = redact(`before ${f} after`, e);
    assert.strictEqual(out, 'before [redacted:MY_SECRET] after', `encoded form ${k}`);
  }
}

// 13. more length-rule exclusions, and no process global
{
  const long = '/some/long/path/that/is/not/a/secret/at/all';
  const out = redact(long, { INIT_CWD: long, _: long, SSL_CERT_FILE: long, JAVA_HOME: long, ONEDRIVE: long, ALLUSERSPROFILE: long, __CFBundleIdentifier: long });
  assert.strictEqual(out, long, 'excluded names stay');
  assert.ok(!redact(long, { OneDriveCommercial_TOKEN: long }).includes('/some'), 'name rule still applies');
  const g = globalThis as { process?: unknown };
  const saved = g.process;
  g.process = undefined;
  try { assert.doesNotThrow(() => redact('x')); } finally { g.process = saved; }
}

// 14. maskSecretArgs / maskSecretUrl (spec 041 FR-053)
{
  const SEC = 'sEcReT-value-1234567';
  assert.deepStrictEqual(maskSecretArgs(['--token', SEC, '--key', SEC, '--secret', SEC, '--password', SEC, '--auth', SEC, '--api-key', SEC, '--verbose']),
    ['--token', '[redacted]', '--key', '[redacted]', '--secret', '[redacted]', '--password', '[redacted]', '--auth', '[redacted]', '--api-key', '[redacted]', '--verbose'], 'value after a secret flag');
  assert.deepStrictEqual(maskSecretArgs(['--token=' + SEC, '--api-key=' + SEC, '--access_token=' + SEC, '--name=' + SEC]), ['--token=[redacted]', '--api-key=[redacted]', '--access_token=[redacted]', '--name=' + SEC], '--flag=value, only for secret-looking flags');
  assert.deepStrictEqual(maskSecretArgs(['--TOKEN', SEC, '--Access-Token', SEC]), ['--TOKEN', '[redacted]', '--Access-Token', '[redacted]'], 'case does not matter');
  assert.deepStrictEqual(maskSecretArgs(['--token', '--verbose', 'plain']), ['--token', '--verbose', 'plain'], 'a flag after a flag is not a value');
  assert.deepStrictEqual(maskSecretArgs(['--token']), ['--token'], 'a trailing flag has nothing to mask');
  assert.deepStrictEqual(maskSecretArgs(['--keyboard', 'x', '--monkey', 'y', '--path', '/a']), ['--keyboard', 'x', '--monkey', 'y', '--path', '/a'], 'only whole key words count');
  assert.deepStrictEqual(maskSecretArgs(['-y', 'server', 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4']), ['-y', 'server', '[redacted]'], 'other args still go through redact()');
  assert.ok(!maskSecretArgs(['run', SEC], { MY_TOKEN: SEC }).join(' ').includes(SEC), 'env values are redacted in args too');
  assert.deepStrictEqual(maskSecretArgs(undefined as unknown as string[]), [], 'never throws');
  const args = ['--token', SEC];
  maskSecretArgs(args);
  assert.deepStrictEqual(args, ['--token', SEC], 'the input is not changed');

  assert.strictEqual(maskSecretUrl('https://u:' + SEC + '@h.test/p?api_key=' + SEC + '&x=1#frag'), 'https://[redacted]@h.test/p?api_key=[redacted]&x=1#frag');
  assert.strictEqual(maskSecretUrl('https://h.test/a?token=' + SEC), 'https://h.test/a?token=[redacted]');
  assert.strictEqual(maskSecretUrl('https://h.test/a?page=2'), 'https://h.test/a?page=2');
  assert.strictEqual(maskSecretUrl(undefined), '');

  // review fixes: NAME=value, Name: value, more words, empty URL user, deliberate over-masking
  assert.deepStrictEqual(maskSecretArgs(['-e', 'GITHUB_TOKEN=abcdefSECRET1234', 'PORT=8080']), ['-e', 'GITHUB_TOKEN=[redacted]', 'PORT=8080'], 'NAME=value without a dash');
  assert.deepStrictEqual(maskSecretArgs(['env', 'API_KEY=x']), ['env', 'API_KEY=[redacted]']);
  assert.deepStrictEqual(maskSecretArgs(['--header', 'X-Api-Key: abc', '--header', 'Content-Type: json']), ['--header', 'X-Api-Key: [redacted]', '--header', 'Content-Type: [redacted]'], 'Name: value; header values are never shown (T053)');
  assert.deepStrictEqual(maskSecretArgs(['--header=X-Api-Key: abc', '--header=Content-Type: json', '--env=GH_TOKEN=abc']), ['--header=X-Api-Key: [redacted]', '--header=Content-Type: [redacted]', '--env=GH_TOKEN=[redacted]'], '--flag=Name: value');
  assert.deepStrictEqual(maskSecretArgs(['--pat', 'a', '--bearer', 'b', '--pwd', 'c', '--path', 'd']), ['--pat', '[redacted]', '--bearer', '[redacted]', '--pwd', '[redacted]', '--path', 'd'], 'pat, bearer, pwd are whole words');
  assert.strictEqual(maskSecretUrl('https://:' + SEC + '@h.test/p'), 'https://[redacted]@h.test/p', 'empty user');
  // owner decision 2026-11-23 (#2060 item 9, spec 012 FR-196): a negated long flag takes no value, so the next word is not masked because of it (was: over-masking beats leaking)
  assert.deepStrictEqual(maskSecretArgs(['--no-auth', 'value']), ['--no-auth', 'value'], 'owner decision 2026-11-23 (#2060 item 9): a negated flag takes no value');
}

// 14b. T053 masking leaks (spec 041 `## Changes` 2026-10-19). SEC is built at run time; every output must not contain it.
{
  const SEC = 'sEc' + 'ReT-' + 'q7w8e9r0t1y2u3i4';
  const R = '[redacted]';
  const noSec = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(SEC), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noSec(got, what); };
  // (a) names
  for (const f of ['--privateKey', '--passphrase', '--pw', '--cookie', '--session', '--jwt', '--signature', '--sig']) masked([f, SEC], [f, R], `name ${f}`);
  assert.deepStrictEqual(maskSecretArgs(['--keyboard', 'x', '--monkey', 'y']), ['--keyboard', 'x', '--monkey', 'y']);
  assert.deepStrictEqual(maskSecretArgs(['-p', '8080']), ['-p', '8080']);
  // (b) one-arg and separator forms
  masked(['--token ' + SEC], ['--token ' + R], 'one arg');
  masked(['--token ' + SEC, 'next'], ['--token ' + R, 'next'], 'the next arg is not masked');
  masked(['--api-key ' + SEC], ['--api-key ' + R], 'api-key one arg');
  masked(['--password:' + SEC], ['--password:' + R], 'colon');
  masked(['/token', SEC], ['/token', R], 'slash flag');
  masked(['/password:' + SEC], ['/password:' + R], 'slash colon');
  assert.deepStrictEqual(maskSecretArgs(['--url=https://h.test/a?x=1']), ['--url=https://h.test/a?x=1']);
  assert.deepStrictEqual(maskSecretArgs(['--port:8080']), ['--port:8080']);
  // (c) headers
  masked(['--header=Cookie: sid=' + SEC], ['--header=Cookie: ' + R], 'header=');
  masked(['-H', 'X-Custom: ' + SEC], ['-H', 'X-Custom: ' + R], '-H');
  assert.deepStrictEqual(maskSecretArgs(['--header', 'Content-Type: json']), ['--header', 'Content-Type: ' + R]);
  masked(['Cookie: ' + SEC], ['Cookie: ' + R], 'cookie without a flag');
  assert.deepStrictEqual(maskSecretArgs(['Accept: json']), ['Accept: json']);
  // (d) structured
  masked(['{"apiKey":"' + SEC + '","port":1}'], ['{"apiKey":"' + R + '","port":1}'], 'json');
  const nested = maskSecretArgs(['--config', '{"auth":{"token":"' + SEC + '"}}']);
  noSec(nested, 'nested json');
  assert.ok(nested[1].includes(R));
  const bad = maskSecretArgs(['--config={"token":"' + SEC + '"']);
  noSec(bad, 'bad json');
  assert.ok(bad[0].includes(R));
  masked(['CONN=Server=x;Password=' + SEC + ';Database=d'], ['CONN=Server=x;Password=' + R + ';Database=d'], 'connection string');
  masked(['--conn', 'Server=x;AccountKey=' + SEC], ['--conn', 'Server=x;AccountKey=' + R], 'AccountKey');
  // (e) URL-shaped args
  noSec(maskSecretArgs(['--url', 'https://' + SEC + '@h.test/']), 'url arg');
  assert.deepStrictEqual(maskSecretArgs(['--url', 'https://' + SEC + '@h.test/']), ['--url', 'https://' + R + '@h.test/']);
  noSec(maskSecretArgs(['--endpoint=https://h.test/?sig=' + SEC]), 'endpoint');
  assert.deepStrictEqual(maskSecretArgs(['--endpoint=https://h.test/?sig=' + SEC]), ['--endpoint=https://h.test/?sig=' + R]);
  // (f) command
  assert.strictEqual(maskSecretCommand('npx srv --token ' + SEC), 'npx srv --token ' + R);
  assert.strictEqual(maskSecretCommand('node s.js --api-key=' + SEC), 'node s.js --api-key=' + R);
  assert.strictEqual(maskSecretCommand('C:\\Program Files\\nodejs\\node.exe'), 'C:\\Program Files\\nodejs\\node.exe');
  assert.strictEqual(maskSecretCommand('C:\\Program Files\\nodejs\\node.exe --token ' + SEC + ' /x'), 'C:\\Program Files\\nodejs\\node.exe --token ' + R + ' /x');
  assert.strictEqual(maskSecretCommand('npx  -y   srv'), 'npx -y srv');
  assert.strictEqual(maskSecretCommand(undefined), '');
  // (g) URLs
  assert.strictEqual(maskSecretUrl('https://rawtok123@host.test/'), 'https://' + R + '@host.test/');
  assert.strictEqual(maskSecretUrl('https://u:p@h.test/'), 'https://' + R + '@h.test/');
  assert.strictEqual(maskSecretUrl('https://registry.npmjs.org/@scope/pkg'), 'https://registry.npmjs.org/@scope/pkg');
  assert.strictEqual(maskSecretUrl('https://api.telegram.org/bot123456:' + SEC + '/sendMessage'), 'https://api.telegram.org/bot123456:' + R + '/sendMessage');
  assert.strictEqual(maskSecretUrl('https://hooks.slack.com/services/T0/B0/' + SEC), 'https://hooks.slack.com/services/T0/B0/' + R);
  assert.strictEqual(maskSecretUrl('https://discord.com/api/webhooks/42/' + SEC), 'https://discord.com/api/webhooks/42/' + R);
  for (const q of ['X-Amz-Signature', 'X-Amz-Security-Token', 'X-Goog-Signature', 'sig', '%74oken']) {
    const u = maskSecretUrl('https://h.test/p?' + q + '=' + SEC + '&page=2');
    assert.strictEqual(u, 'https://h.test/p?' + q + '=' + R + '&page=2', q);
  }
  // review on PR #630: an OAuth authorization `code` is a secret (it was kept before); the page number stays
  assert.strictEqual(maskSecretUrl('https://h.test/?code=abc&page=2'), 'https://h.test/?code=' + R + '&page=2');
  // review round 2: spaces in connection strings, JSON headers, command split, dash values, minor shapes
  masked(['--conn', 'Server=x; Password=' + SEC], ['--conn', 'Server=x; Password=' + R], 'conn with a space after ;');
  masked(['--conn', 'Server=x; Password = ' + SEC + ' ;Database=d'], ['--conn', 'Server=x; Password=' + R + ';Database=d'], 'conn with spaces around =');
  masked(['--headers', '{"X-Custom":"' + SEC + '"}'], ['--headers', '{"X-Custom":"' + R + '"}'], '--headers json');
  masked(['--header={"X-Custom":"' + SEC + '","n":5}'], ['--header={"X-Custom":"' + R + '","n":"' + R + '"}'], '--header= json');
  masked(['-H', '{"X":"' + SEC + '"'], ['-H', '{"X":"' + R + '"'], 'bad json after a header flag');
  const cmd = (c: string): string => maskSecretCommand(c);
  assert.deepStrictEqual(splitCommand('C:\\srv\\srv.exe serve token=' + SEC), ['C:\\srv\\srv.exe', 'serve', 'token=' + SEC]);
  assert.ok(!cmd('C:\\srv\\srv.exe serve token=' + SEC).includes(SEC), 'token=SEC after a drive path');
  assert.strictEqual(cmd('C:\\Program Files\\nodejs\\node.exe'), 'C:\\Program Files\\nodejs\\node.exe');
  assert.strictEqual(cmd('C:\\Program Files\\nodejs\\node.exe s.js --token ' + SEC), 'C:\\Program Files\\nodejs\\node.exe s.js --token ' + R);
  assert.deepStrictEqual(splitCommand('\\\\srv\\share\\my tools\\a.exe -v'), ['\\\\srv\\share\\my tools\\a.exe', '-v']);
  assert.deepStrictEqual(splitCommand('C:\\a\\b.exe C:\\data\\f.txt'), ['C:\\a\\b.exe', 'C:\\data\\f.txt']);
  masked(['--token', '-' + SEC], ['--token', R], 'dash value');
  assert.deepStrictEqual(maskSecretArgs(['--api-key', '-' + SEC, 'next']), ['--api-key', R, 'next']);
  assert.deepStrictEqual(maskSecretArgs(['--token', '--verbose']), ['--token', '--verbose']);
  assert.deepStrictEqual(maskSecretArgs(['--private-key', SEC]), ['--private-key', R]);
  masked(['--token=', SEC], ['--token=' + R, R], 'empty --token= then the value');
  noSec(maskSecretArgs(['--repos=a,https://' + SEC + '@h.test/x']), 'url inside an arg');
  assert.strictEqual(maskSecretArgs(['--repos=a,https://' + SEC + '@h.test/x'])[0], '--repos=a,https://' + R + '@h.test/x');
  masked(['["--token","' + SEC + '"]'], ['["--token","' + R + '"]'], 'json array of args');
  masked(['bearer ' + SEC], ['bearer ' + R], 'bearer');
  masked(['Bearer ' + SEC], ['Bearer ' + R], 'Bearer');
  masked(['--auth', 'Bearer ' + SEC], ['--auth', R], 'Bearer after --auth');
  assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup of the server']), ['--desc', 'Basic setup of the server'], 'prose starting with Basic stays');
  // `bearer of news` has several tokens after the word, so it is NOT masked (rule: the word plus exactly one token)
  assert.deepStrictEqual(maskSecretArgs(['--msg', 'bearer of news']), ['--msg', 'bearer of news']);
  masked(['--header', 'X-Custom=' + SEC], ['--header', 'X-Custom=' + R], 'Name=value after a header flag');
  assert.strictEqual(maskSecretUrl('https://api.telegram.org/BOT123:' + SEC + '/x'), 'https://api.telegram.org/BOT123:' + R + '/x');
  assert.strictEqual(maskSecretUrl('https://u:p@ss@h.test/'), 'https://' + R + '@h.test/', 'user info runs to the last @ of the authority');
  // never throws, and linear on large adversarial input (limit far above the real cost)
  assert.doesNotThrow(() => { maskSecretArgs([null as any, undefined as any, 5 as any]); maskSecretCommand(null); maskSecretUrl(null); });
  const big = 200_000;
  const shapes = ['--token ' + 'a '.repeat(big / 2), '{"a":"'.repeat(big / 6), 'a=b;'.repeat(big / 4), 'x://' + '@'.repeat(big), 'http://' + 'a:'.repeat(big / 2), '/bot1:'.repeat(big / 6), ';token='.repeat(big / 7), '"k": "'.repeat(big / 6), '['.repeat(big)];
  for (const x of shapes) assertLinearShape(`adversarial ${x.slice(0, 12)}`, (t) => { _uncappedForTest.maskSecretArgs([t]); maskSecretUrl(t); _uncappedForTest.maskSecretCommand(t); }, (n) => x.slice(0, n), 200_000);
}

// 14c. T064 masking follow-ups (spec 041 `## Changes` 2026-10-20, R1-R8). SEC is built at run time; no output may contain it.
{
  const SEC = 'sEc' + 'ReT-' + 'q7w8e9r0t1y2u3i4';
  const R = '[redacted]';
  const noSec = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(SEC), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noSec(got, what); };
  const cmd = (c: string, want: string, what: string): void => { const got = maskSecretCommand(c); assert.strictEqual(got, want, what); noSec(got, what); };
  // (a) shell strings (R3)
  masked(['-c', 'npx srv --token ' + SEC], ['-c', 'npx srv --token ' + R], 'a: sh -c');
  masked(['/c', 'npx srv --api-key=' + SEC], ['/c', 'npx srv --api-key=' + R], 'a: cmd /c');
  masked(['-Command', 'srv -Token ' + SEC], ['-Command', 'srv -Token ' + R], 'a: powershell');
  masked(['npx srv --token ' + SEC], ['npx srv --token ' + R], 'a: no flag before it');
  masked(['-c', 'a  --token\t' + SEC], ['-c', 'a  --token\t' + R], 'a: separators kept');
  // (b) assignments in shell strings
  masked(['export TOKEN=' + SEC + '; npx srv'], ['export TOKEN=' + R + '; npx srv'], 'b: export');
  noSec(maskSecretArgs(['set API_KEY=' + SEC + '&& npx srv']), 'b: set');
  assert.strictEqual(maskSecretArgs(['set API_KEY=' + SEC + '&& npx srv'])[0], 'set API_KEY=' + R + '&& npx srv', 'b: set keeps &&');
  noSec(maskSecretArgs(['set "API_KEY=' + SEC + '" && srv']), 'b: set quoted');
  noSec(maskSecretArgs(['export TOKEN="' + SEC + ' x"; npx srv']), 'b: export quoted with a space');
  masked(["$env:API_KEY='" + SEC + "'; srv"], ['$env:API_KEY=' + R + '; srv'], 'b: $env:');
  // (c) nesting and depth
  masked(['-c', 'curl -H "X-Api-Key: ' + SEC + '" https://h.test'], ['-c', 'curl -H "X-Api-Key: ' + R + '" https://h.test'], 'c: quoted header in a shell string');
  noSec(maskSecretArgs(['-c', "srv --cfg '{\"token\":\"" + SEC + "\"}'"]), 'c: json in a shell string');
  noSec(maskSecretArgs(['npx srv https://' + SEC + '@h.test/x']), 'c: url in a shell string');
  {
    let nest = 'srv --token ' + SEC;
    for (let i = 0; i < 6; i++) nest = i % 2 ? 'sh -c ' + JSON.stringify(nest) : JSON.stringify({ cmd: nest });
    assert.doesNotThrow(() => maskSecretArgs(['-c', nest]), 'c: 6 levels never throw');
  }
  // (d) no new over-masking of prose
  assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup of the server']), ['--desc', 'Basic setup of the server'], 'd: Basic');
  assert.deepStrictEqual(maskSecretArgs(['--msg', 'bearer of news']), ['--msg', 'bearer of news'], 'd: bearer');
  assert.deepStrictEqual(maskSecretArgs(['token of thanks']), ['token of thanks'], 'd: token');
  assert.deepStrictEqual(maskSecretArgs(['Accept: a; q=0.9']), ['Accept: a; q=0.9'], 'd: Accept');
  masked(['--conn', 'Server=x; Password = ' + SEC + ' ;Database=d'], ['--conn', 'Server=x; Password=' + R + ';Database=d'], 'd: conn string as in 14b');
  // (e) `Name: value` before `;` (R4)
  masked(['Cookie: a=1; sid=' + SEC], ['Cookie: ' + R], 'e: Cookie');
  masked(['Set-Cookie: sid=' + SEC + '; Path=/'], ['Set-Cookie: ' + R], 'e: Set-Cookie');
  masked(['X-Info: a; password=' + SEC], ['X-Info: a; password=' + R], 'e: harmless name keeps the split');
  // (f) `Name:` then its value (R5)
  masked(['Cookie:', SEC], ['Cookie:', R], 'f: Cookie:');
  masked(['-H', 'X-Api-Key:', SEC], ['-H', 'X-Api-Key:', R], 'f: -H Name:');
  assert.deepStrictEqual(maskSecretArgs(['Accept:', 'json']), ['Accept:', 'json'], 'f: Accept:');
  {
    const once = maskSecretArgs(['-c', 'x Cookie: a=1'])[1];
    assert.strictEqual(once.split(R).length - 1, 1, `f: R once in ${once}`);
  }
  // (g) space before the colon (R4)
  masked(['Password : ' + SEC], ['Password: ' + R], 'g: Password :');
  noSec(maskSecretArgs(['-H', 'X-Api-Key : ' + SEC]), 'g: -H X-Api-Key :');
  assert.deepStrictEqual(maskSecretArgs(['Note : hello']), ['Note : hello'], 'g: Note :');
  // (h) quoted command (R1, R8)
  cmd('srv -H "Authorization: Bearer ' + SEC + '"', 'srv -H "Authorization: ' + R + '"', 'h: Authorization double quotes');
  cmd('srv -H "X-Api-Key: ' + SEC + '"', 'srv -H "X-Api-Key: ' + R + '"', 'h: X-Api-Key');
  noSec(maskSecretCommand("srv -H 'Authorization: Bearer " + SEC + "'"), 'h: single quotes');
  noSec(maskSecretCommand('srv --auth Bearer ' + SEC), 'h: --auth Bearer');
  cmd('srv --token "' + SEC + ' more"', 'srv --token ' + R, 'h: quoted value with a space');
  assert.deepStrictEqual(splitCommand('srv -H "A: b c"'), ['srv', '-H', '"A: b c"'], 'h: quoted header is one word');
  assert.deepStrictEqual(splitCommand('"C:\\Program Files\\srv\\srv.exe" --api-key x'), ['"C:\\Program Files\\srv\\srv.exe"', '--api-key', 'x'], 'h: quoted path is one word');
  cmd("npx srv --token '" + SEC, 'npx srv --token ' + R, 'h: unmatched quote is a literal');
  assert.deepStrictEqual(splitCommand('\\\\srv\\share\\my tools\\a.exe -v'), ['\\\\srv\\share\\my tools\\a.exe', '-v'], 'h: UNC as in 14b');
  assert.deepStrictEqual(splitCommand('C:\\a\\b.exe C:\\data\\f.txt'), ['C:\\a\\b.exe', 'C:\\data\\f.txt'], 'h: drive as in 14b');
  // (i) whole-quoted args (R2)
  masked(['"Server=x;Password=' + SEC + '"'], ['"Server=x;Password=' + R + '"'], 'i: whole-quoted connection string');
  masked(['--token="' + SEC + ' more"'], ['--token=' + R], 'i: flag value');
  // (j) comma pairs (R6)
  masked(['user=me,password=' + SEC], ['user=me,password=' + R], 'j: comma pair');
  masked(['--opts', 'user=me,password=' + SEC], ['--opts', 'user=me,password=' + R], 'j: --opts');
  masked(['--opts=user=me,password=' + SEC], ['--opts=user=me,password=' + R], 'j: --opts=');
  assert.deepStrictEqual(maskSecretArgs(['password=abc,def']), ['password=' + R], 'j: comma in the value');
  masked(['Server=h,1433;Password=' + SEC], ['Server=h,1433;Password=' + R], 'j: Server=h,1433');
  assert.deepStrictEqual(maskSecretArgs(['--tags=a,b,c']), ['--tags=a,b,c'], 'j: tags');
  // (k) JSON name/value (R7)
  masked(['[{"name":"token","value":"' + SEC + '"}]'], ['[{"name":"token","value":"' + R + '"}]'], 'k: name/value');
  noSec(maskSecretArgs(['[{"name":"API_KEY","value":"' + SEC + '"}]']), 'k: API_KEY');
  noSec(maskSecretArgs(['{"key":"Authorization","value":"' + SEC + '"}']), 'k: key/value');
  assert.deepStrictEqual(maskSecretArgs(['[{"name":"port","value":"8080"}]']), ['[{"name":"port","value":"8080"}]'], 'k: port');
  // review fixes: `$env:` names that only match once the prefix is stripped, `Name:` with trailing space, JSON member case
  noSec(maskSecretArgs(["$env:PAT='" + SEC + "'"]), 'b: $env:PAT');
  assert.deepStrictEqual(maskSecretArgs(["$env:PAT='" + SEC + "'"]), ['$env:PAT=' + R], 'b: $env:PAT exact');
  assert.deepStrictEqual(maskSecretArgs(["$env:SIG='" + SEC + "'"]), ['$env:SIG=' + R], 'b: $env:SIG exact');
  masked(['Cookie:  ', SEC], ['Cookie:  ', R], 'f: Cookie: with trailing spaces');
  masked(['[{"Name":"token","Value":"' + SEC + '"}]'], ['[{"Name":"token","Value":"' + R + '"}]'], 'k: member names in any case');
  masked(['{"KEY":"Authorization","value":"' + SEC + '"}'], ['{"KEY":"' + R + '","value":"' + R + '"}'], 'k: KEY in capitals');
  // MAX_DEPTH (8) bounds shell, KV and quoted-word levels; past it a value that needs another pass is masked whole (fail-safe), never shown
  {
    const pre = (core: string, k: number): string => { let x = core; for (let i = 1; i <= k; i++) x = 'A' + i + '=' + x; return x; };
    const head = (k: number): string => { let x = ''; for (let i = 1; i <= k; i++) x = 'A' + i + '=' + x; return x; }; // `Ak=...A1=`
    const kv = (core: string, k: number): string => pre(core, k);
    // a KV chain: masked normally to 7 levels, the whole value past that
    assert.strictEqual(maskSecretArgs([kv('--token ' + SEC, 7)])[0], head(7) + '--token ' + R, 'depth: KV chain of 7 is masked normally');
    assert.strictEqual(maskSecretArgs([kv('--token ' + SEC, 8)])[0], head(8) + R, 'depth: KV chain of 8 is masked whole (fail-safe)');
    // a quoted shell string behind k KV levels
    const one = '"srv --token ' + SEC + '"';
    const two = `"sh -c 'srv --token ${SEC}'"`;
    assert.strictEqual(maskSecretArgs([pre(one, 5)])[0], head(5) + '"srv --token ' + R + '"', 'depth: quoted shell string behind 5 KV levels');
    assert.strictEqual(maskSecretArgs([pre(one, 7)])[0], head(7) + R, 'depth: quoted shell string behind 7 KV levels is masked whole');
    assert.strictEqual(maskSecretArgs([pre(two, 2)])[0], head(2) + `"sh -c 'srv --token ${R}'"`, 'depth: two shell levels behind 2 KV levels');
    assert.strictEqual(maskSecretArgs([pre(two, 6)])[0], head(6) + '"sh -c ' + R + '"', 'depth: two shell levels behind 6 KV levels: the inner string is masked whole');
    assert.strictEqual(maskSecretArgs([pre(two, 7)])[0], head(7) + R, 'depth: two shell levels behind 7 KV levels is masked whole');
    // JSON values carry the budget: past it the whole value is masked, never shown
    for (const js of ['{"c":"srv --token ' + SEC + '"}', '["srv --token ' + SEC + '"]']) {
      for (let k = 0; k <= 11; k++) noSec(maskSecretArgs([pre(js, k)]), `depth: JSON ${js.slice(0, 3)} behind ${k} KV levels`);
      assert.strictEqual(maskSecretArgs([pre(js, 9)])[0], head(9) + R, `depth: JSON ${js.slice(0, 3)} behind 9 KV levels is masked whole`);
    }
    // budget-0 fail-safe, quote branch: a quoted word with no space at exactly the bound
    assert.strictEqual(maskSecretArgs([pre('"abc"', 7)])[0], head(7) + '"abc"', 'depth: a quoted word one level inside the bound is shown');
    assert.strictEqual(maskSecretArgs([pre('"abc"', 8)])[0], head(8) + R, 'depth: a quoted word at the bound is masked whole');
    assert.strictEqual(maskSecretArgs([pre("'abc'", 8)])[0], head(8) + R, "depth: a single-quoted word at the bound is masked whole");
    // budget-0 fail-safe, flag branch: a flag-shaped value with no space at the bound
    assert.strictEqual(maskSecretArgs([pre('--token=' + SEC, 7)])[0], head(7) + '--token=' + R, 'depth: a flag-shaped value inside the bound is masked on its own');
    assert.strictEqual(maskSecretArgs([pre('--token=' + SEC, 8)])[0], head(8) + R, 'depth: a flag-shaped value at the bound is masked whole');
    // B1: shell, KV, quoted word, shell, quoted word
    assert.deepStrictEqual(maskSecretArgs(['-c', 'export X="bash -lc \'npx srv --api-key ' + SEC + '\'"; srv']), ['-c', 'export X="bash -lc \'npx srv --api-key ' + R + '\'"; srv'], 'B1: five levels, readable output');
    // nested far past the bound: no SEC, and the innermost is [redacted]
    for (let k = 9; k <= 14; k++) {
      const o = maskSecretArgs([pre(two, k)])[0];
      noSec(o, `depth: ${k} levels`);
      assert.ok(o.endsWith('=' + R), `depth: ${k} levels ends masked: ${o}`);
    }
    let sh = 'srv --token ' + SEC;
    for (let i = 0; i < 12; i++) sh = (i % 2 ? 'sh -c "' : "sh -c '") + sh + (i % 2 ? '"' : "'");
    noSec(maskSecretArgs(['-c', sh]), 'depth: 12 shell levels');
    noSec(maskSecretCommand(sh), 'depth: 12 shell levels in a command');
    masked(['--cmd="srv --token ' + SEC + '"'], ['--cmd="srv --token ' + R + '"'], 'R2/R3: a whole-quoted shell string as a flag value');
  }
  // L1: text with spaces that R1 cannot split (escaped quotes, a quote glued to a word) is never shown unmasked
  noSec(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + '\\"}"']), 'L1: escaped JSON in a shell string');
  assert.strictEqual(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + '\\"}"'])[1], 'srv --cfg "{\\"token\\":\\"' + R + '\\"}"', 'L1: exact');
  noSec(maskSecretCommand('sh -c "npx srv --token \\"' + SEC + ' x\\""'), 'L1: escaped quotes in a command');
  assert.strictEqual(maskSecretArgs(['-c', 'srv \\"--token ' + SEC + '\\"'])[1], 'srv \\"--token ' + R, 'L1: backslash-quote before a flag');
  noSec(maskSecretArgs(['srv \\"--api-key=' + SEC + '\\"']), 'L1: backslash-quote before a --flag=value');
  assert.strictEqual(maskSecretArgs(['-c', 'srv x"--token ' + SEC + '"'])[1], 'srv x"--token ' + R, 'L1: a quote glued to a word');
  {
    let y = 'srv --token ' + SEC;
    for (let i = 0; i < 2; i++) y = JSON.stringify({ cmd: 'sh -c ' + JSON.stringify({ c: y }) });
    noSec(maskSecretArgs([y]), 'L1: JSON, sh -c, JSON, sh -c');
  }
  // L2: a flag-shaped value (starts with - or /) is masked at any depth; ordinary ones stay
  masked(['A=--token=' + SEC], ['A=--token=' + R], 'L2: NAME=--token=x');
  masked(['{"a":"--api-key=' + SEC + '"}'], ['{"a":"--api-key=' + R + '"}'], 'L2: JSON value that is a flag');
  masked(['--opts', '--password=' + SEC], ['--opts', '--password=' + R], 'L2: --opts --password=x');
  assert.deepStrictEqual(maskSecretArgs(['A=--verbose', '{"a":"/usr/bin/x"}']), ['A=--verbose', '{"a":"/usr/bin/x"}'], 'L2: ordinary flag-shaped values unchanged');
  // C2: an escaped value with spaces is masked before the shell split cuts it apart
  assert.strictEqual(maskSecretArgs(['-c', 'srv --cfg "{\\"token\\":\\"' + SEC + ' x\\"}"'])[1], 'srv --cfg "{\\"token\\":\\"' + R + '\\"}"', 'C2: escaped JSON value with a space');
  noSec(maskSecretArgs(['{\\"a\\":\\"b c\\",\\"password\\":\\"a ' + SEC + '\\"}']), 'C2: escaped password with a space');
  // backtick set aside like a quote
  assert.strictEqual(maskSecretArgs(['-c', 'srv `--token ' + SEC + '`'])[1], 'srv `--token ' + R, 'backtick before a flag');
  // the plain-whitespace fallback on its own: one glued word with spaces, no whole-quoted word, no leading quote
  assert.strictEqual(maskSecretArgs(['-c', 'srv a"b --token ' + SEC + '"c'])[1], 'srv a"b --token ' + R, 'fallback: plain split of a glued word');
  // Paco's review: a flag opened inside a KV value behind a stray quote marks the next word (three forms)
  assert.strictEqual(maskSecretArgs(['-c', 'bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'])[1], 'bash -c "OPTS=\\"--token ' + R + '"', 'Paco 2a: args (T067: the payload is unescaped one level, masked, and written back in its quotes)');
  noSec(maskSecretCommand('bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'), 'Paco 2b: command');
  noSec(maskSecretArgs(['X="X=\\"--token ' + SEC + '\\""']), 'Paco 2c: X="X=\\"--token SEC\\""');
  noSec(maskSecretArgs(['OPTS=\\"--token=' + SEC + '\\"']), 'Paco 2d: --token=SEC behind a stray quote');
  // a flag WITH a value behind a stray quote does not mark the next word (pins the `f2.rest === undefined` guard)
  assert.deepStrictEqual(maskSecretArgs(['OPTS=\\"--token=' + SEC + '\\"', 'next']), ['OPTS=\\"--token=' + R, 'next'], 'guard: the next arg stays visible');
  assert.strictEqual(maskSecretCommand('OPTS=\\"--token=' + SEC + '\\" next'), 'OPTS=\\"--token=' + R + ' next', 'guard: the next word of a command stays visible');
  // display limit, on purpose: after a secret flag the whole next word is masked, so `SEC\\" srv"` (which may itself hold a `\\"`) loses its tail
  assert.strictEqual(maskSecretCommand('bash -c "OPTS=\\"--token ' + SEC + '\\" srv"'), 'bash -c "OPTS=\\"--token ' + R + '"', 'display: the tail of the secret word is dropped, never shown (T067: the payload keeps its closing quote)');
  // (m of 14b still) env prefix keeps other names
  assert.deepStrictEqual(maskSecretArgs(["$env:PORT='8080'; srv"]), ["$env:PORT='8080'; srv"], 'b: $env:PORT unchanged');

  // T066 / R11: a scheme word, then the secret as the next arg; R7 on escaped objects
  {
    const AUTH = 'Authorization: Bearer';
    masked(['--auth', 'Bearer', SEC], ['--auth', 'Bearer', R], 'R11 a: --auth Bearer SEC');
    masked(['--token', 'token', SEC], ['--token', 'token', R], 'R11 a: --token token SEC');
    masked(['-H', 'Bearer', SEC], ['-H', 'Bearer', R], 'R11 a: -H Bearer SEC');
    masked(['--auth', 'basic', SEC], ['--auth', 'basic', R], 'R11 a: case-insensitive');
    masked(['--auth', 'ApiKey', SEC], ['--auth', 'ApiKey', R], 'R11 a: ApiKey');
    masked(['-H', AUTH, SEC], ['-H', AUTH, R], 'R11 b: -H Authorization: Bearer SEC');
    masked(['Authorization: Basic', SEC], ['Authorization: Basic', R], 'R11 b: Authorization: Basic SEC');
    masked(['Proxy-Authorization: Digest', SEC], ['Proxy-Authorization: Digest', R], 'R11 b: Proxy-Authorization');
    masked(['Bearer', SEC], ['Bearer', R], 'R11 c: bare Bearer');
    masked(['Basic', SEC], ['Basic', R], 'R11 c: bare Basic');
    masked(['-c', 'curl --auth Bearer ' + SEC], ['-c', 'curl --auth Bearer ' + R], 'R11 d: shell string');
    noSec(maskSecretArgs(['-c', 'curl -H "Authorization: Bearer" ' + SEC]), 'R11 d: quoted header word in a shell string (redact() hides the scheme too, fine)');
    noSec(maskSecretCommand('curl --auth Bearer ' + SEC), 'R11 d: command (R8: redact() masks `Bearer SEC` first)');
    assert.ok(maskSecretArgs(['--auth', 'Bearer', SEC])[1] === 'Bearer', 'R11 g: the scheme word stays visible');
    masked(['-c', 'curl Bearer ' + SEC], ['-c', 'curl Bearer ' + R], 'R11 c: bare Bearer word in a shell string');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Bearer']), ['-c', 'curl Bearer'], 'R11 c: Bearer as the last word of a shell string shows nothing extra');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Basic setup']), ['-c', 'curl Basic setup'], 'R11 c: Basic stays top-level only');
    // review fixes: command with a quoted header, --flag=Scheme, any header name after -H, trailing space, array values, case variants
    for (const w of ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey']) {
      noSec(maskSecretCommand('curl -H "Authorization: ' + w + '" ' + SEC), 'rev1: command, quoted header, ' + w);
      noSec(maskSecretCommand("curl -H 'Proxy-Authorization: " + w + "' " + SEC), 'rev1: command, single-quoted header, ' + w);
    }
    noSec(maskSecretCommand('curl Authorization: Bearer ' + SEC + ' https://h.test'), 'rev1: command, unquoted header');
    assert.strictEqual(maskSecretCommand('curl "Accept: Token" list'), 'curl "Accept: Token" list', 'rev1: a harmless name without a header flag keeps the next word');
    assert.strictEqual(maskSecretCommand('curl -H "Authorization: Bearer" --verbose'), 'curl -H "Authorization: [redacted]" --verbose', 'rev1: a flag after the scheme word stays');
    masked(['--auth=Bearer', SEC], ['--auth=Bearer', R], 'rev2: --auth=Bearer SEC');
    masked(['--header=Authorization: Bearer', SEC], ['--header=Authorization: [redacted]', R], 'rev2: --header=Authorization: Bearer SEC');
    masked(['-c', 'curl --auth=Bearer ' + SEC], ['-c', 'curl --auth=Bearer ' + R], 'rev2: shell string --auth=Bearer');
    masked(['-H', 'X-Custom: Token', SEC], ['-H', 'X-Custom: [redacted]', R], 'rev3: any name after -H');
    masked(['--header', 'X-Custom: Basic', SEC], ['--header', 'X-Custom: [redacted]', R], 'rev3: any name after --header');
    masked(['--header=X-Custom: Token', SEC], ['--header=X-Custom: [redacted]', R], 'rev2: a harmless name in the --header= form');
    masked(['--auth', 'Bearer ', SEC], ['--auth', 'Bearer ', R], 'rev4: trailing space');
    masked(['Bearer ', SEC], ['Bearer ', R], 'rev4: bare, trailing space');
    for (const same of [['X-Custom: Token', 'list'], ['Accept: Token', 'list']]) assert.deepStrictEqual(maskSecretArgs(same), same, 'rev6: a harmless name without a header flag stays (pins schemeHeader secretFlag): ' + JSON.stringify(same));
    const escA = (k: string, n: string, vk: string): string => '{\\"' + k + '\\":\\"' + n + '\\",\\"' + vk + '\\":[\\"' + SEC + '\\"]}';
    noSec(maskSecretArgs(['-c', 'srv ' + escA('name', 'token', 'value')]), 'rev5: array value');
    noSec(maskSecretArgs(['-c', 'srv ' + escA('key', 'Authorization', 'value')]), 'rev5: array value, key');
    assert.strictEqual(maskSecretArgs(['-c', 'srv {\\"name\\":\\"port\\",\\"value\\":[\\"8080\\"]}'])[1], 'srv {\\"name\\":\\"port\\",\\"value\\":[\\"8080\\"]}', 'rev5: array value of a harmless name stays');
    for (const [k, vk] of [['NAME', 'VALUE'], ['Key', 'Value'], ['KEY', 'value']]) noSec(maskSecretArgs(['-c', 'srv {\\"' + k + '\\":\\"token\\",\\"' + vk + '\\":\\"' + SEC + '\\"}']), 'rev6: case variant ' + k);
    // round 3: `--header=Name: <scheme>` in a command, three forms, every scheme word
    for (const w of ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey', 'apikey', 'DIGEST']) {
      noSec(maskSecretCommand('curl --header=Authorization:' + w + ' ' + SEC), 'rev7: command, no space, ' + w);
      noSec(maskSecretCommand('curl --header=Authorization: ' + w + ' ' + SEC), 'rev7: command, space, ' + w);
      noSec(maskSecretCommand('curl "--header=Authorization: ' + w + '" ' + SEC), 'rev7: command, quoted flag, ' + w);
      noSec(maskSecretCommand("curl '--header=Proxy-Authorization: " + w + "' " + SEC), 'rev7: command, single-quoted flag, ' + w);
      assert.strictEqual(maskSchemeSecrets('curl --header=X-Info: ' + w + ' list'), 'curl --header=X-Info: ' + w + ' list', 'rev7: a harmless name is left to the args rules');
    }
    // round 5: `NAME=Name:` (a secret-looking name) shows one `[redacted]`, not one per depth level
    const once = (x: string, what: string): void => { assert.strictEqual(x.split(R).length - 1, 1, `${what}: exactly one [redacted] in ${x}`); assert.ok(!x.includes(' y') && !x.includes('Y '), what); };
    assert.strictEqual(maskSecretCommand('x=Auth: y'), 'x=Auth: ' + R, 'rev8: command x=Auth: y');
    assert.strictEqual(maskSecretCommand('echo A=Token: x'), 'echo A=Token: ' + R, 'rev8: command echo A=Token: x');
    assert.deepStrictEqual(maskSecretArgs(['x=Auth: y']), ['x=Auth: ' + R], 'rev8: args x=Auth: y');
    assert.deepStrictEqual(maskSecretArgs(['x=Auth:', 'y']), ['x=Auth:', R], 'rev8: args x=Auth: then y as its own arg');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'echo A=Token: x']), ['-c', 'echo A=Token: ' + R], 'rev8: shell string');
    for (const x of [maskSecretCommand('x=Auth: y'), maskSecretCommand('echo A=Token: x'), maskSecretArgs(['x=Auth: y'])[0]]) once(x, 'rev8');
    assert.deepStrictEqual(maskSecretArgs(['x=Info:', 'y']), ['x=Info:', 'y'], 'rev8: a harmless name keeps the next arg');
    // round 6: TOKEN=Auth: SEC (a secret-looking NAME), and a quoted header value with spaces in a command
    assert.strictEqual(maskSecretCommand('TOKEN=Auth: ' + SEC), 'TOKEN=' + R + ' ' + R, 'rev9a: command TOKEN=Auth: SEC');
    masked(['TOKEN=Auth:', SEC], ['TOKEN=' + R, R], 'rev9a: args TOKEN=Auth: then SEC');
    masked(['-c', 'echo TOKEN=Auth: ' + SEC], ['-c', 'echo TOKEN=' + R + ' ' + R], 'rev9a: shell string');
    for (const q of ["'", '"']) {
      cmd('srv Authorization: ' + q + 'a b' + SEC + q, 'srv Authorization: ' + R, 'rev9b: command, ' + q);
      cmd('srv Authorization: ' + q + 'a b' + SEC + q + ' next', 'srv Authorization: ' + R + ' next', 'rev9b: command, ' + q + ', word after it kept');
      cmd('srv X-Api-Key: ' + q + 'a ' + SEC + q + ' next', 'srv X-Api-Key: ' + R + ' next', 'rev9b: another secret name, ' + q);
      cmd('srv Accept: ' + q + 'a b' + q + ' next', 'srv Accept: ' + q + 'a b' + q + ' next', 'rev9b: a harmless name keeps its quoted value, ' + q);
      noSec(maskSecretCommand('curl --header=Authorization: ' + q + 'a ' + SEC + q), 'rev9b: --header= form, ' + q);
    }
    // round 7: an unclosed quote hides the rest; a scheme word then a quoted run; quoted scheme words (B6)
    for (const n of ['Authorization', 'Proxy-Authorization', 'X-Api-Key', 'Cookie', 'Auth', 'token']) for (const q of ['"', "'"]) {
      noSec(maskSecretCommand('srv ' + n + ': ' + q + 'a ' + SEC), 'rev10: unclosed ' + q + ' after ' + n);
      noSec(maskSecretCommand('srv ' + n + ': ' + q + 'a ' + SEC + ' and more'), 'rev10: unclosed ' + q + ' with a tail after ' + n);
    }
    for (const n of ['Authorization', 'Proxy-Authorization']) for (const w of ['Basic', 'Bearer', 'Digest']) for (const q of ['"', "'"]) {
      noSec(maskSecretCommand('srv ' + n + ': ' + w + ' ' + q + SEC + ' x' + q), 'rev11: scheme then quoted run, ' + n + ' ' + w + ' ' + q);
      noSec(maskSecretCommand('srv ' + n + ': ' + w + ' ' + q + SEC + ' x'), 'rev11: scheme then unclosed run, ' + n + ' ' + w + ' ' + q);
    }
    assert.strictEqual(maskSchemeSecrets('srv Authorization: Basic "a b" --y'), 'srv Authorization: Basic ' + R + ' --y', 'rev11: the scheme word stays visible, the quoted run is masked, the next flag stays');
    assert.strictEqual(maskSchemeSecrets('srv Authorization: "a ' + SEC), 'srv Authorization: ' + R, 'rev10: an unclosed quote masks to the end');
    noSec(maskSecretCommand('srv Authorization: "Bearer" ' + SEC), 'rev12: B6 double-quoted scheme word');
    noSec(maskSecretCommand('curl -H Authorization:"Digest" ' + SEC), 'rev12: B6 glued, quoted Digest');
    noSec(maskSecretCommand("curl --header=Authorization: 'Token' " + SEC), 'rev12: B6 --header=, single-quoted Token');
    assert.strictEqual(maskSchemeSecrets('srv Authorization: "Bearer" ' + SEC), 'srv Authorization: "Bearer" ' + R, 'rev12: B6 the quoted scheme word stays, the secret after it is masked (pre-pass only)');
    assert.strictEqual(maskSchemeSecrets('srv Accept: "a ' + SEC), 'srv Accept: "a ' + SEC, 'rev10: a harmless name with an unclosed quote is left alone');
    // round 8: the same shapes in a shell-string ARG (the pre-pass runs on the raw text of the R3 path)
    for (const n of ['Authorization', 'Proxy-Authorization', 'X-Api-Key', 'Cookie', 'Auth', 'token']) for (const q of ['"', "'"]) {
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + q + 'a ' + SEC]), 'rev13: args, unclosed ' + q + ' after ' + n);
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + q + 'a ' + SEC + q + ' next']), 'rev13: args, closed ' + q + ' after ' + n);
      noSec(maskSecretArgs(['curl ' + n + ': ' + q + 'a ' + SEC]), 'rev13: args, no flag, unclosed ' + q + ' after ' + n);
    }
    for (const n of ['Authorization', 'Proxy-Authorization']) for (const w of ['Basic', 'Bearer', 'Digest']) for (const q of ['"', "'"]) {
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + w + ' ' + q + SEC + ' x' + q + ' --y']), 'rev13: args, scheme then quoted run, ' + n + ' ' + w + ' ' + q);
      noSec(maskSecretArgs(['-c', 'curl ' + n + ': ' + w + ' ' + q + SEC + ' x']), 'rev13: args, scheme then unclosed run, ' + n + ' ' + w + ' ' + q);
    }
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Authorization: "a ' + SEC]), ['-c', 'curl Authorization: ' + R], 'rev13: exact output, unclosed');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Authorization: "a b" n']), ['-c', 'curl Authorization: ' + R + ' n'], 'rev13: exact output, closed, single [redacted]');
    assert.deepStrictEqual(maskSecretArgs(['-c', 'curl Accept: "a b" n']), ['-c', 'curl Accept: "a b" n'], 'rev13: a harmless name stays');
    noSec(maskSecretArgs(['-c', 'sh -c \'curl Authorization: "a ' + SEC + '\'']), 'rev13: nested shell string');
    // round 9: a whole-quoted value after `=` on a non-secret flag is masked on its inside (Vikram's re-review)
    masked(['docker', 'run', '--env="API_TOKEN=' + SEC + '"'], ['docker', 'run', '--env="API_TOKEN=' + R + '"'], 'rev14: --env="API_TOKEN=SEC"');
    masked(['--opt=\'token=' + SEC + '\''], ['--opt=\'token=' + R + '\''], 'rev14: --opt=\'token=SEC\'');
    masked(['--opt="token=' + SEC + '"'], ['--opt="token=' + R + '"'], 'rev14: --opt="token=SEC"');
    cmd('docker run --env="API_TOKEN=' + SEC + '" img', 'docker run --env="API_TOKEN=' + R + '" img', 'rev14: command --env="API_TOKEN=SEC"');
    cmd('srv --opt="token=' + SEC + '"', 'srv --opt="token=' + R + '"', 'rev14: command --opt="token=SEC"');
    cmd("srv --opt='token=" + SEC + "'", "srv --opt='token=" + R + "'", "rev14: command --opt='token=SEC'");
    assert.deepStrictEqual(maskSecretArgs(['--opt="plain value"']), ['--opt="plain value"'], 'rev14: a plain quoted value is unchanged');
    assert.strictEqual(maskSecretCommand('srv --opt="plain value" x'), 'srv --opt="plain value" x', 'rev14: command, a plain quoted value is unchanged');
    masked(['--cfg="a b"', '--token', SEC], ['--cfg="a b"', '--token', R], 'rev14: args, cfg kept, SEC masked');
    cmd('srv --cfg="a b" --token ' + SEC, 'srv --cfg="a b" --token ' + R, 'rev14: command, cfg kept, SEC masked');
    masked(['-c', 'docker run --env="API_TOKEN=' + SEC + '" img'], ['-c', 'docker run --env="API_TOKEN=' + R + '" img'], 'rev14: inside a shell string');
    // R7 on escaped objects
    const esc = (k: string, n: string, val: string, rest = ''): string => '{\\"' + k + '\\":\\"' + n + '\\",\\"value\\":\\"' + val + '\\"' + rest + '}';
    masked(['-c', 'srv --cfg "' + esc('name', 'Authorization', SEC) + '"'], ['-c', 'srv --cfg "' + esc('name', 'Authorization', R) + '"'], 'R7 esc: name');
    masked(['-c', 'srv --cfg "' + esc('key', 'Authorization', SEC) + '"'], ['-c', 'srv --cfg "' + esc('key', R, R) + '"'], 'R7 esc: key (the name itself is masked too, as for the pair rule)');
    masked(['-c', 'srv ' + esc('name', 'token', SEC)], ['-c', 'srv ' + esc('name', 'token', R)], 'R7 esc: token name, unquoted');
    masked(['-c', 'srv ' + esc('name', 'API_KEY', SEC, ',\\"other\\":\\"1\\"')], ['-c', 'srv ' + esc('name', 'API_KEY', R, ',\\"other\\":\\"1\\"')], 'R7 esc: other members kept');
    masked(['-c', 'srv ' + '{\\"name\\":\\"password\\",\\"value\\":' + SEC + '}'], ['-c', 'srv ' + '{\\"name\\":\\"password\\",\\"value\\":' + R + '}'], 'R7 esc: bare value');
    // false positives stay as they are
    for (const same of [['npx', 'srv', 'token', 'list'], ['--desc', 'Basic setup of the server'], ['{\\"name\\":\\"port\\",\\"value\\":\\"8080\\"}'], ['-c', 'srv {\\"name\\":\\"port\\",\\"value\\":\\"8080\\"}'], ['Accept: a; q=0.9'], ['Bearer', '--verbose'], ['Authorization: Bearer', '--verbose']]) {
      assert.deepStrictEqual(maskSecretArgs(same), same, 'R11 no false positive: ' + JSON.stringify(same));
    }
    assert.deepStrictEqual(maskSecretArgs(['--desc', 'Basic setup']), ['--desc', 'Basic [redacted]'], 'R11: `Basic setup` (scheme word plus one word) was already masked by the BEARER rule before T066, unchanged');
  }

  // T065 (#374): a string over MASK_INPUT_MAX is hidden whole through the public helpers too, before any rule, in well under 100 ms
  {
    const MB = 1_000_000;
    const timeIt = <T>(f: () => T): { v: T; ms: number } => { let v!: T; const ms = cpuMs(() => { v = f(); }, 100); return { v, ms }; };
    const shapes: Array<[string, string]> = [['a=b;', 'token=' + SEC], ['x ', '--token ' + SEC]];
    for (const [unit, tail] of shapes) {
      const big = unit.repeat(Math.ceil(MB / unit.length)) + tail;
      const a = timeIt(() => maskSecretArgs([big]));
      const c = timeIt(() => maskSecretCommand(big));
      console.log(`redact: 14c 1 MB ${JSON.stringify(unit)} arg ${a.ms.toFixed(1)} ms, command ${c.ms.toFixed(1)} ms`);
      assert.deepStrictEqual(a.v, [R], `14c: 1 MB arg ${JSON.stringify(unit)} comes back [redacted]`);
      assert.strictEqual(c.v, R, `14c: 1 MB command ${JSON.stringify(unit)} comes back [redacted]`);
      assert.ok(a.ms < 100 && c.ms < 100, `14c: 1 MB ${JSON.stringify(unit)} took ${a.ms.toFixed(1)} / ${c.ms.toFixed(1)} ms`);
      noSec([a.v, c.v], '14c: 1 MB');
    }
    const atArg = ('--password=' + SEC).padEnd(MASK_INPUT_MAX, 'y');
    const atCmd = 'node --api-key=' + SEC + ' ' + 'y'.repeat(MASK_INPUT_MAX - 'node --api-key='.length - SEC.length - 1);
    assert.strictEqual(atArg.length, MASK_INPUT_MAX);
    assert.strictEqual(atCmd.length, MASK_INPUT_MAX);
    const gotArg = maskSecretArgs([atArg]);
    assert.ok(gotArg[0].startsWith('--password=' + R) && gotArg[0] !== R, '14c: an arg of exactly MASK_INPUT_MAX is masked by the rules, not hidden whole');
    const gotCmd = maskSecretCommand(atCmd);
    assert.ok(gotCmd.startsWith('node --api-key=' + R) && gotCmd !== R, '14c: a command of exactly MASK_INPUT_MAX is masked by the rules, not hidden whole');
    noSec([gotArg, gotCmd], '14c: at the limit');
    assert.deepStrictEqual(maskSecretArgs([atArg + 'y']), [R], '14c: MASK_INPUT_MAX + 1 arg is hidden whole');
    assert.strictEqual(maskSecretCommand(atCmd + 'y'), R, '14c: MASK_INPUT_MAX + 1 command is hidden whole');
    assert.deepStrictEqual(maskSecretArgs(['a', 'b'.repeat(MASK_INPUT_MAX + 1), '--token', SEC]), ['a', R, '--token', R], '14c: only the long arg is hidden; the others keep their rules');
  }

  // [KNOWN GAP] (spec 041 T064 follow-ups): a bare `token` word is not a flag, so the value after it is NOT masked. This row pins the gap;
  // when it is closed, flip it on purpose (and update the spec).
  assert.deepStrictEqual(maskSecretArgs(['token', SEC]), ['token', SEC], '14c [KNOWN GAP]: a bare `token` before a secret shows the secret');
}

// 14c2. spec 061 T057: `shQuote` is the one display-quoting helper (folder setup list and the sh payload written back by T067).
{
  assert.deepStrictEqual(['-y', 'a b', '', "it's", '$(id)', 'x;y', '@scope/pkg@1.2', '--port=9', 'C:/x'].map((w) => shQuote(w)), ['-y', "'a b'", "''", `'it'\\''s'`, "'$(id)'", "'x;y'", '@scope/pkg@1.2', '--port=9', 'C:/x']);
  assert.strictEqual(shQuote('x', true), "'x'", 'T057: always quotes a safe word');
  assert.strictEqual(shQuote("a'b", true), `'a'\\''b'`, 'T057: a quote inside');
  // the single-quoted sh payload is written back through shQuote: the `'\''` survives and the secret is masked
  assert.strictEqual(maskSecretCommand("sh -c 'echo it'\\''s; srv --api-key SEC'"), "sh -c 'echo it'\\''s; srv --api-key [redacted]'");
}

// 14d. T067 (#447): secrets inside escaped quotes. The payload of `sh|bash -c`, `cmd /c` and `powershell|pwsh -Command` is unescaped one
// level with that shell's own rules, then masked; a leading quote that closes nowhere is set aside (fail closed). T is the issue's placeholder.
{
  const T = 'TOKEN' + '123';
  const R = '[redacted]';
  const noT = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(T), `${what}: no secret in ${JSON.stringify(x)}`);
  const masked = (args: string[], want: string[], what: string): void => { const got = maskSecretArgs(args); assert.deepStrictEqual(got, want, what); noT(got, what); };
  const cmd = (c: string, want: string, what: string): void => { const got = maskSecretCommand(c); assert.strictEqual(got, want, what); noT(got, what); };
  const BT = '`';
  // (a) the ten leaking rows of the issue (fuzz on PR #369 at 0e0737e), each now masked
  masked(['srv', '-H', '"X-Api-Key:', T + '"'], ['srv', '-H', '"X-Api-Key:', R], 'issue row 1: naive split, leading unmatched quote');
  cmd(`sh -c "srv -H \\"X-Api-Key: ${T}\\""`, `sh -c "srv -H \\"X-Api-Key: ${R}\\""`, 'issue row 2: sh -c, \\"');
  cmd(`powershell -Command "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `powershell -Command "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'issue row 3: PowerShell backtick quotes');
  cmd(`powershell -Command "srv {${BT}"api_key${BT}":${BT}"${T}${BT}"}"`, `powershell -Command "srv {${BT}"api_key${BT}":${BT}"${R}${BT}"}"`, 'issue row 4: JSON pair, backtick quotes (was masked only partly)');
  cmd(`powershell -Command "srv {${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${T}${BT}"}"`, `powershell -Command "srv {${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${R}${BT}"}"`, 'issue row 5: R7 name/value, backtick quotes');
  cmd(`powershell -Command "srv {\\${BT}"token\\${BT}":\\${BT}"${T}\\${BT}"}"`, `powershell -Command "srv {\\${BT}"token\\${BT}":\\${BT}"${R}\\${BT}"}"`, 'issue row 6: \\ and backtick quote mixed');
  cmd(`sh -c "srv --env=\\"API_TOKEN=${T}\\""`, `sh -c "srv --env=\\"API_TOKEN=${R}\\""`, 'issue row 7: sh -c, --env=\\"NAME=x\\"');
  cmd(`powershell -Command "srv --env=${BT}"API_TOKEN=${T}${BT}""`, `powershell -Command "srv --env=${BT}"API_TOKEN=${R}${BT}""`, 'issue row 8: PowerShell --env');
  cmd(`sh -c "srv --opt=\\"token=${T}\\""`, `sh -c "srv --opt=\\"token=${R}\\""`, 'issue row 9: sh -c, --opt=\\"token=x\\"');
  cmd(`powershell -Command "srv --opt=${BT}"token=${T}${BT}""`, `powershell -Command "srv --opt=${BT}"token=${R}${BT}""`, 'issue row 10: PowerShell --opt');
  // (a2) review of #455 (Paco's agent, d40f1ab): cmd wrapping PowerShell, `bash -c --`, `bash -O`, PowerShell's short -Command forms
  const leakFree = (c: string, what: string): void => { const got = maskSecretCommand(c); noT(got, what); assert.ok(got.includes(R), `${what}: masked in ${got}`); };
  leakFree(`cmd /c powershell -Command "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, 'cmd /c powershell -Command, header');
  leakFree(`cmd /c powershell -Command "srv --env=${BT}"API_TOKEN=${T}${BT}""`, 'cmd /c powershell -Command, --env=');
  leakFree(`cmd /c powershell -Command "srv --opt=${BT}"token=${T}${BT}""`, 'cmd /c powershell -Command, --opt=');
  leakFree(`cmd /c powershell -Command "srv --header=${BT}"X-Api-Key: ${T}${BT}""`, 'cmd /c powershell -Command, --header=');
  leakFree(`cmd /c powershell -Command "srv --config '{${BT}"name${BT}":${BT}"api_key${BT}",${BT}"value${BT}":${BT}"${T}${BT}"}'"`, 'cmd /c powershell -Command, R7 name/value');
  leakFree(`cmd /c powershell -Command "echo '{${BT}"api_key${BT}":${BT}"${T}${BT}"}' | srv"`, 'cmd /c powershell -Command, JSON pair in echo');
  masked(['cmd', '/c', 'powershell', '-Command', `srv -H ${BT}"X-Api-Key: ${T}${BT}"`], ['cmd', '/c', 'powershell', '-Command', `srv -H "X-Api-Key: ${R}"`], 'args: cmd /c powershell -Command, one script arg');
  masked(['cmd', '/c', 'powershell', '-Command', 'srv', `--env=${BT}"API_TOKEN=${T}${BT}"`], ['cmd', '/c', 'powershell', '-Command', 'srv', `--env="API_TOKEN=${R}"`], 'args: cmd /c powershell -Command, --env= arg');
  cmd(`bash -c -- "srv -H \\"X-Api-Key: ${T}\\""`, `bash -c -- "srv -H \\"X-Api-Key: ${R}\\""`, 'bash -c -- "..."');
  cmd(`bash -O extglob -c "srv -H \\"X-Api-Key: ${T}\\""`, `bash -O extglob -c "srv -H \\"X-Api-Key: ${R}\\""`, 'bash -O extglob -c "..."');
  masked(['bash', '-c', '--', `srv --opt=\\"token=${T}\\"`], ['bash', '-c', '--', `srv --opt=\\"token=${R}\\"`], 'args: bash -c -- <script>');
  cmd(`pwsh -c "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `pwsh -c "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'pwsh -c');
  cmd(`powershell -NoP -Comm "srv -H ${BT}"X-Api-Key: ${T}${BT}""`, `powershell -NoP -Comm "srv -H ${BT}"X-Api-Key: ${R}${BT}""`, 'powershell -NoP -Comm (a prefix of -Command)');
  // cmd: a backslash run without a quote reads back unchanged through encode + decode (whole runs, review item 1)
  for (const v of ['a\\\\\\b', 'a\\\\\\"b', 'x"y\\\\', '\\\\\\\\']) assert.strictEqual(_uncappedForTest.payloadRoundTrip('cmd', '"', v, '\\"'), v, 'cmd round trip ' + JSON.stringify(v));
  // (b) the issue's controls (no escapes) stay masked as before
  cmd(`sh -c 'srv -H "X-Api-Key: ${T}"'`, `sh -c 'srv -H "X-Api-Key: ${R}"'`, 'control: single-quoted payload');
  cmd(`sh -c 'srv --env="API_TOKEN=${T}"'`, `sh -c 'srv --env="API_TOKEN=${R}"'`, 'control: --env in single quotes');
  cmd(`powershell -Command 'srv {"name":"api_key","value":"${T}"}'`, `powershell -Command 'srv {"name":"api_key","value":"${R}"}'`, 'control: PowerShell single quotes');
  masked(['srv', '-H', 'X-Api-Key:', T], ['srv', '-H', 'X-Api-Key:', R], 'control: args without the stray quote');
  // (c) the other escape forms of each shell
  cmd(`cmd /c "srv -H \\"X-Api-Key: ${T}\\""`, `cmd /c "srv -H \\"X-Api-Key: ${R}\\""`, 'cmd /c with \\"');
  cmd(`cmd /c srv -H ^"X-Api-Key: ${T}^"`, `cmd /c srv -H ^"X-Api-Key: ${R}^"`, 'cmd /c with ^"');
  cmd(`cmd.exe /C "srv --opt=\\"token=${T}\\""`, `cmd.exe /C "srv --opt=\\"token=${R}\\""`, 'cmd.exe /C');
  cmd(`powershell -c "srv --token ""${T}"""`, `powershell -c "srv --token ${R}"`, 'PowerShell doubled quotes ""');
  cmd(`powershell -Command 'srv --opt=''token=${T}'''`, `powershell -Command 'srv --opt=''token=${R}'''`, "PowerShell '' inside '...'");
  cmd(`pwsh -NoProfile -ExecutionPolicy Bypass -Command "srv --api-key ${BT}"${T}${BT}""`, `pwsh -NoProfile -ExecutionPolicy Bypass -Command "srv --api-key ${R}"`, 'pwsh with flags and a flag value before -Command');
  cmd(`/bin/bash -o pipefail -c "srv -H \\"Authorization: Bearer ${T}\\""`, `/bin/bash -o pipefail -c "srv -H \\"Authorization: ${R}\\""`, 'bash path, -o value, then -c');
  cmd(`bash -lc "srv --token \\"${T} x\\""`, `bash -lc "srv --token ${R}"`, 'bash -lc, an escaped value with a space');
  cmd(`sh -c 'it'\\''s --token ${T}'`, `sh -c 'it'\\''s --token ${R}'`, "sh '\\'' in single quotes");
  cmd(`TOKEN=${T} sh -c "srv \\"x\\""`, `TOKEN=${R} sh -c "srv \\"x\\""`, 'text before the wrapper is masked by the usual rules');
  cmd(`sh -c "srv \\"x\\"" --token ${T}`, `sh -c "srv \\"x\\"" --token ${R}`, 'text after a sh payload word is masked by the usual rules');
  cmd(`sh -c "a \\"b\\"" && bash -c "srv --opt=\\"token=${T}\\""`, `sh -c "a \\"b\\"" && bash -c "srv --opt=\\"token=${R}\\""`, 'two wrappers in one command');
  cmd(`cmd /c "C:\\Program Files\\srv\\srv.exe" --token ${T}`, `cmd /c "C:\\Program Files\\srv\\srv.exe" --token ${R}`, 'cmd /c with a quoted path and no escape: the usual rules');
  noT(maskSecretCommand(`cmd /c "C:\\Program Files\\x.exe" --opt=\\"token=${T}\\"`), 'cmd /c: quoted path, then an escaped value');
  // backslashes in the payload are written back escaped too (CodeQL js/incomplete-sanitization #54/#55), so the shown text reads back the same
  cmd(`sh -c "cd C:\\\\x\\\\y; srv --token \\"${T}\\""`, `sh -c "cd C:\\\\x\\\\y; srv --token \\"${R}\\""`, 'sh "...": \\\\ and \\" written back as they came');
  cmd(`sh -c "a\\b --opt=\\"token=${T}\\""`, `sh -c "a\\\\b --opt=token=${R}"`, 'sh "...": a lone \\ is shown as \\\\ (same meaning in sh)');
  cmd(`sh -c a\\\\b\\ --token\\ ${T}`, `sh -c a\\\\b\\ --token\\ ${R}`, 'sh unquoted: \\\\ stays \\\\ (it was shown as \\, which sh drops)');
  for (const v of ['a\\b', 'a\\"b', 'a\\\\"b', 'end\\', 'x "y" z', 'C:\\dir\\', '\\\\\\"', '"\\\\', 'p\\\\\\q']) {
    const rt = _uncappedForTest.payloadRoundTrip;
    assert.strictEqual(rt('sh', '"', v), v, `round trip sh "...": ${v}`);
    assert.strictEqual(rt('sh', '', v), v, `round trip sh unquoted: ${v}`);
    assert.strictEqual(rt('sh', "'", v), v, `round trip sh '...': ${v}`);
    assert.strictEqual(rt('cmd', '"', v, '\\"'), v, `round trip cmd "..." with \\": ${v}`);
    assert.strictEqual(rt('cmd', '', v, '\\"'), v, `round trip cmd unquoted with \\": ${v}`);
    assert.strictEqual(rt('ps', '"', v), v, `round trip PowerShell "...": ${v}`);
  }
  // (d) nesting: two decodes are shown readable, a third level is masked whole
  cmd(`bash -c "sh -c \\"srv \\\\\\"--token ${T}\\\\\\"\\""`, `bash -c "sh -c \\"srv --token ${R}\\""`, 'two levels of escapes');
  cmd(`bash -c "sh -c \\"bash -c \\\\\\"srv \\\\\\\\\\\\\\"--token ${T}\\\\\\\\\\\\\\"\\\\\\"\\""`, `bash -c "sh -c \\"${R}\\""`, 'three levels: the script past two decodes is masked whole');
  masked(['bash', '-c', `sh -c "srv \\"--token ${T}\\""`], ['bash', '-c', `sh -c "srv --token ${R}"`], 'args: a wrapper inside the script arg');
  // (e) a quote that does not close: masked to the end of the payload
  cmd(`sh -c "srv \\"--token ${T}`, `sh -c ${R}`, 'sh payload with no closing quote');
  cmd(`powershell -Command "srv ${BT}"--token ${T}`, `powershell -Command ${R}`, 'PowerShell payload with no closing quote');
  // (f) args form: the script arg after the shell and its flag keeps that shell's escapes (cmd and PowerShell join every later arg)
  masked(['sh', '-c', `srv --opt=\\"token=${T}\\"`], ['sh', '-c', `srv --opt=\\"token=${R}\\"`], 'args: sh script with \\"');
  masked(['sh', '-c', `srv {\\\\"token\\\\":\\\\"${T}\\\\"}`], ['sh', '-c', `srv {\\\\"token\\\\":\\\\"${R}\\\\"}`], 'args: sh script with escaped JSON');
  masked(['powershell', '-Command', `srv --opt=${BT}"token=${T}${BT}"`], ['powershell', '-Command', `srv --opt="token=${R}"`], 'args: PowerShell script with backtick quotes (shown unescaped once masked)');
  masked(['powershell', '-Command', `'srv --opt=''token=${T}'''`], ['powershell', '-Command', `srv --opt='token=${R}'`], "args: PowerShell '' in a single-quoted script");
  masked(['powershell', '-Command', 'srv', `--header=${BT}"X-Api-Key:`, `${T}${BT}"`], ['powershell', '-Command', 'srv', '--header="X-Api-Key: ' + R, R], 'args: PowerShell, the script split over args');
  masked(['cmd.exe', '/d', '/c', 'srv', '--header=^"X-Api-Key:', `${T}^"`], ['cmd.exe', '/d', '/c', 'srv', '--header="X-Api-Key: ' + R, R], 'args: cmd, the script split over args');
  masked(['cmd', '/c', `srv -H ^"X-Api-Key: ${T}^"`], ['cmd', '/c', `srv -H "X-Api-Key: ${R}"`], 'args: cmd script with ^"');
  // (g) the leading unmatched quote (#369 review): the flag, header name or NAME= behind it is seen; the rest of the argument is masked
  masked(['srv', `"--token=${T}`], ['srv', `"--token=${R}`], 'unmatched quote: "--token=x');
  masked(['srv', "'--api-key", T], ['srv', "'--api-key", R], "unmatched quote: '--api-key then the value");
  masked(['srv', `"X-Api-Key: ${T}`], ['srv', `"X-Api-Key: ${R}`], 'unmatched quote: "Name: value');
  cmd(`srv "--token ${T}`, `srv "--token ${R}`, 'command: an unclosed quote runs to the end (was a [KNOWN GAP])');
  cmd(`srv "--token ${T} more`, `srv "--token ${R}`, 'command: an unclosed quote is one argument to the end, masked whole after the flag');
  cmd(`srv --opt="token=${T}`, `srv --opt="token=${R}`, 'command: a flag value with an unclosed quote');
  // (h) no over-masking: harmless commands and args come back unchanged, byte for byte
  for (const same of [`sh -c "echo hello"`, `sh -c "echo \\"hello world\\""`, `bash -lc 'npm run build && npm test'`, `powershell -Command "Write-Host ${BT}"hi there${BT}""`,
    `pwsh -c "Get-ChildItem ""C:\\Program Files"""`, `powershell -Command 'Write-Host ''hi'''`, `cmd /c "echo \\"hi\\""`, `cmd /c echo ^"hi^"`, `cmd /c "echo ^"hi^" & dir"`, `cmd /c dir C:\\Users\\me`,
    `sh -c "cd \\"$HOME\\" && ls"`, `sh -c "printf \\"%s\\\\n\\" a"`, `node -e "console.log(\\"hi\\")"`, `bash -c "sh -c \\"echo \\\\\\"x y\\\\\\"\\""`]) {
    assert.strictEqual(maskSecretCommand(same), same, 'no over-masking: ' + same);
  }
  for (const same of [['sh', '-c', 'echo "a \\"b\\""'], ['powershell', '-Command', `Write-Host ${BT}"hi${BT}"`], ['cmd', '/c', 'echo', '^"hi^"'], ['srv', '"hello', 'world"'], ['srv', "it's"]]) {
    assert.deepStrictEqual(maskSecretArgs(same), same, 'no over-masking: ' + JSON.stringify(same));
  }
  // the public helpers still hide a string over MASK_INPUT_MAX whole, before the wrapper decode
  assert.strictEqual(maskSecretCommand('sh -c "' + 'a \\"'.repeat(MASK_INPUT_MAX) + '"'), R, '14d: over MASK_INPUT_MAX, hidden whole');
}

// 15. T054: `cut` stops at a token boundary and never leaves half a surrogate pair
{
  const words = Array.from({ length: 900 }, () => 'abcdef').join(' '); // 6-letter words, period 7: 4096 % 7 != 0, so a character cut lands mid-word
  const c = cut(words, 4096);
  assert.ok(c.endsWith(' [truncated]'), 'marker');
  const body = c.slice(0, -' [truncated]'.length);
  assert.ok(body.length <= 4096 && /abcdef$/.test(body) && body.split(' ').every((w) => w === 'abcdef'), 'ends on a whole word');
  assert.strictEqual(cut('abc', 4096), 'abc');
  const emoji = cut('a '.repeat(2047) + 'a' + '\u{1F600}', 4096);
  assert.ok(!/[\ud800-\udbff] \[truncated\]$/.test(emoji) && !/[\ud800-\udbff]$/.test(emoji.slice(0, -12)), 'no lone surrogate');
  const emoji2 = cut('a'.repeat(4095) + '\u{1F600}', 4096);
  assert.ok(!/[\ud800-\udbff]/.test(emoji2), 'no lone surrogate (4095 a + emoji)');
}

// 16. guard: the test-only uncapped entry is used by tests only (nothing under src/ except its own file)
{
  const root = path.join(__dirname, '..', '..'); // compiled: dist/scripts -> repo root
  const srcRoot = fs.existsSync(path.join(root, 'src')) ? root : path.join(__dirname, '..'); // run with tsx: scripts -> repo root
  assert.ok(fs.existsSync(path.join(srcRoot, 'src', 'shared', 'redact.ts')), 'guard found src/');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(?:ts|js|mjs|cjs|html)$/.test(e.name)) continue;
      const rel = path.relative(srcRoot, p).split(path.sep).join('/');
      if (rel === 'src/shared/redact.ts') continue;
      if (fs.readFileSync(p, 'utf8').includes('_uncappedForTest')) offenders.push(rel);
    }
  };
  walk(path.join(srcRoot, 'src'));
  assert.deepStrictEqual(offenders, [], 'used in: ' + offenders.join(', '));
}

// Review on PR #630 (spec 058 FR-093): home folders to `~`, OAuth query values, a bearer token in any case
{
  const h = (t: string, homes?: string[]) => maskHomePaths(t, homes ?? []);
  const ho = (t: string, homes?: string[]) => maskHomePathsOutbound(t, homes ?? []);
  assert.strictEqual(h('spawn /home/vikram/.local/bin/x ENOENT'), 'spawn ~/.local/bin/x ENOENT');
  assert.strictEqual(h('/Users/ana/x and /Users/ana'), '~/x and ~');
  assert.strictEqual(h('C:\\Users\\vikram\\AppData\\npx.cmd'), '~\\AppData\\npx.cmd');
  assert.strictEqual(h('c:/Users/vikram/x'), '~/x');
  assert.strictEqual(h('{"p":"C:\\\\Users\\\\vikram\\\\x"}'), '{"p":"~\\\\x"}', 'JSON-escaped');
  assert.strictEqual(h('C:\\Users\\Bob Smith\\AppData'), '~\\AppData', 'a Windows user name with a space');
  assert.strictEqual(h('/srv/data/home/x'), '/srv/data/home/x', 'not a home folder');
  assert.strictEqual(h('x /opt/me/proj and /opt/me', ['/opt/me']), 'x ~/proj and ~', 'a given home folder');
  assert.strictEqual(h('/opt/meow/x', ['/opt/me']), '/opt/meow/x', 'only a whole folder name');
  assert.strictEqual(h('/x', ['/']), '/x', 'a too-short home is ignored');
  // UNC paths (review of PR 1272): host, share and the next folder, in text that leaves the machine (spec 012 FR-435: `maskHomePathsOutbound`; the screen's block is `FR-435` below)
  assert.strictEqual(ho('open \\\\fs1.example.invalid\\share\\alexexample\\proj\\a.txt now'), 'open ~\\proj\\a.txt now', 'UNC');
  assert.strictEqual(ho('{"p":"\\\\\\\\fs1\\\\share\\\\alexexample\\\\x"}'), '{"p":"~\\\\x"}', 'UNC, JSON-escaped');
  assert.strictEqual(ho('\\\\fs1\\share\\Alex Example\\x'), '~\\x', 'UNC, a user name with a space');
  assert.strictEqual(ho('\\\\fs1\\alexexample'), '~', 'UNC, only host and share');
  assert.strictEqual(ho('C:\\\\work\\a\\b and D:\\x\\y\\z'), 'C:\\\\work\\a\\b and D:\\x\\y\\z', 'a doubled drive path is not a UNC path');
  assert.strictEqual(ho('~\\proj\\.github\\a.txt'), '~\\proj\\.github\\a.txt', 'a masked Windows path stays as it is');
  // spec 097 FR-311 delta 2026-11-08 (review of PR #1322): any run of two or more `\` (an odd count, as a Markdown escape leaves it) and `//`
  for (const n of [2, 3, 4, 5, 6, 8]) assert.strictEqual(ho('x ' + '\\'.repeat(n) + 'fs01\\homes\\zed_q\\notes'), 'x ~\\notes', 'UNC with ' + n + ' backslashes');
  assert.strictEqual(ho('see //fs01/homes/zed_q/notes now'), 'see ~/notes now', 'UNC with forward slashes');
  assert.strictEqual(ho('"//fs01/Homes"'), '"~"', 'forward-slash UNC, only host and a home share');
  assert.strictEqual(ho('x //nas/users$/Zed Q/a and //fs1/PROFILES/zq'), 'x ~/a and ~', 'forward-slash UNC: users$, any case, a name with a space');
  assert.strictEqual(ho('//fs01/homes/u/x and //fs01/Users/u/y and "//srv/home/bob" (see //srv/home/bob)'), '~/x and ~/y and "~" (see ~)', 'forward-slash UNC on a bare host; a closing paren stays');
  assert.strictEqual(ho('\\\\fs01.corp\\homes\\u\\x'), '~\\x', 'the backslash form keeps an FQDN host masked');
  // third review of PR #1322: a web URL is not a UNC path (a dotted host, localhost, or after src=, href=, srcset=, url()
  for (const t of ['src="//api.example.com/users/42/avatar.png"', '<img src="//gravatar.com/users/abc">', '//www.example.com/home', '//localhost/home/index.html',
    'url(//fonts.example/home/x.woff)', 'url("//cdn/home/x.woff")', "href='//mysite/profiles/settings'", 'src=//cdn/profile/pic.png', 'srcset="//img/users/a.png 2x"',
    '//fs01.corp.example/homes/u'])
    assert.strictEqual(ho(t), t, 'a web URL, not a home on a share: ' + t);
  // a bare host outside those attributes cannot be told from a NetBIOS server: masked (the safe side, [KNOWN GAP] in spec 097); no `)` is eaten
  assert.strictEqual(ho('"//cdn/profile/pic.png" //mysite/profiles/settings //HOME/users (//cdn/home/x)'), '"~" ~ ~ (~)', 'bare hosts are masked as shares (host, share and the next folder)');
  // second review of PR #1322: `//` is not a UNC path unless the share is a home share
  for (const t of ['//cdn.example.com/lib/app.js', 'src="//cdn.example.com/x.js"', '//TODO/fix/this', 'a //b/c', '//fs01/zed_q/notes', '//fs01/homesick/zed_q', '//fs01/myusers/zed_q'])
    assert.strictEqual(ho(t), t, 'not a home on a share: ' + t);
  assert.strictEqual(ho('https://fs01.example.invalid/homes/zed_q/x and file:///srv/a/b'), 'https://fs01.example.invalid/homes/zed_q/x and file:///srv/a/b', 'a URL is not a UNC path');
  assert.strictEqual(ho('a//b/c/d and // note/x'), 'a//b/c/d and // note/x', '`//` after a letter, or before a space, is not a UNC path');
  assert.strictEqual(ho('\\\\\\fs01\\homes'), '~', 'three backslashes, only host and share');
  const t0 = Date.now();
  maskHomePaths('/home/' + 'a'.repeat(1_000_000), []);
  maskHomePaths('/home/a '.repeat(100_000), []);
  maskHomePaths('\\\\a\\b\\'.repeat(100_000), []);
  maskHomePaths('\\'.repeat(1_000_000) + 'x', []);
  maskHomePaths('//a/'.repeat(200_000), []);
  maskHomePathsOutbound('\\\\a\\b\\'.repeat(100_000), []);
  maskHomePathsOutbound('\\'.repeat(1_000_000) + 'x', []);
  maskHomePathsOutbound('//a/'.repeat(200_000), []);
  assert.ok(Date.now() - t0 < 1500, 'bounded on hostile input');
  const u = maskSecretUrl('https://x.test/cb?code=AbC123&state=xyz9&Code=Q1&id_token=i.d.t&refresh_token=rr&ok=1#access_token=at1');
  for (const v of ['AbC123', 'xyz9', 'Q1', 'i.d.t', 'rr', 'at1']) assert.ok(!u.includes(v), 'OAuth value masked: ' + v + ' in ' + u);
  assert.ok(u.includes('ok=1'));
  assert.deepStrictEqual(maskSecretArgs(['--code', 'abc', '--state', 'x']), ['--code', 'abc', '--state', 'x'], 'flags are unchanged by the OAuth rule (it is URL-only)');
  for (const b of ['bearer abcdefgh12345678', 'BEARER abcdefgh12345678', 'Bearer abcdefgh12345678']) assert.ok(!redact(b).includes('abcdefgh12345678'), b);
}

// spec 012 FR-435 (issue #2060 item 2, owner decision 2026-11-23): a network share path is shown whole on screen (`maskHomePaths`), server, share,
// folders and file name; text that leaves the machine keeps its masking (`maskHomePathsOutbound`, the asserts above); secrets inside a share path stay
// hidden by `redact` and the URL masks, as before. Made-up servers and values only.
{
  const B = '\\';
  const SHARES: [string, string][] = [
    ['a UNC path', B + B + 'fs01' + B + 'projects' + B + 'teamA' + B + 'notes.txt'],
    ['a UNC path, share only', B + B + 'fs01' + B + 'projects'],
    ['a UNC path, JSON-doubled', B.repeat(4) + 'fs01' + B + B + 'projects' + B + B + 'teamA' + B + B + 'notes.txt'],
    ['a UNC admin share', B + B + 'fs01' + B + 'c$' + B + 'logs' + B + 'app.log'],
    ['a UNC path on a dotted host', B + B + 'fs01.corp.example' + B + 'data' + B + 'q3' + B + 'report.xlsx'],
    ['a UNC path on an IP host', B + B + '10.0.0.5' + B + 'data' + B + 'x.txt'],
    ['a UNC home share', B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'notes.txt'],
    ['a UNC path with a space', B + B + 'fs01' + B + 'team docs' + B + 'Alex Example' + B + 'plan.md'],
    ['a UNC path with mixed separators', B + B + 'fs01/data/sub/x.txt'],
    ['a UNC path after a Markdown escape (three backslashes)', B.repeat(3) + 'fs01' + B + 'homes' + B + 'zedq'],
    ['a long UNC path', B + B + '?' + B + 'UNC' + B + 'fs01' + B + 'data' + B + 'x.txt'],
    ['a forward-slash home share', '//fs01/homes/zedq/notes.txt'],
    ['a forward-slash share', '//fs01/projects/teamA/notes.txt'],
    ['a file link with a host', 'file://fs01/projects/teamA/notes.txt'],
    ['a file link with four slashes', 'file:////fs01/projects/teamA/notes.txt'],
    ['an smb link', 'smb://fs01/projects/teamA/notes.txt'],
    ['an afp link', 'afp://fs01/projects/teamA/notes.txt'],
    ['a macOS mount', '/Volumes/projects/teamA/notes.txt'],
    ['a Linux GVFS mount', '/run/user/1000/gvfs/smb-share:server=fs01,share=projects/teamA/notes.txt'],
  ];
  const SCREEN: Record<string, (t: string) => string> = {
    home: (t) => maskHomePaths(t, []), 'redact, then home': (t) => maskHomePaths(redact(t, {}), []), 'url, then home': (t) => maskHomePaths(maskSecretUrl(t, {}), []),
    'home, then redact': (t) => redact(maskHomePaths(t, []), {}),
  };
  for (const [what, p] of SHARES) for (const ctx of ['', 'Opened ', '"']) {
    const t = ctx === '"' ? '"' + p + '"' : ctx ? ctx + p + ' for reading' : p;
    for (const [m, f] of Object.entries(SCREEN)) assert.strictEqual(f(t), t, `FR-435 screen: ${what} is shown whole (${m}${ctx ? ', in ' + (ctx === '"' ? 'quotes' : 'prose') : ''})`);
  }
  // the outbound mask hides what it hid before (a UNC path's host, share and next folder); the forms it never read stay as written there too
  for (const [what, p] of SHARES) {
    const o = maskHomePathsOutbound(p, []);
    if (/^\\{2,}(?!\?)|^\/\/fs01\/homes/.test(p)) assert.ok(!o.includes('fs01') && !o.includes('10.0.0.5') && o.includes('~'), `FR-435 outbound: ${what} loses its host and share: ${o}`);
    else assert.strictEqual(o, p, `FR-435 outbound: ${what} is not a form the outbound mask reads, as before`);
  }
  // home folders still become `~` on screen, also next to a share path (item 6 is its own change)
  assert.strictEqual(maskHomePaths('copy /home/zedq/a.txt to ' + B + B + 'fs01' + B + 'projects' + B + 'a.txt', []), 'copy ~/a.txt to ' + B + B + 'fs01' + B + 'projects' + B + 'a.txt', 'FR-435 screen: a home folder next to a share path is still ~');
  assert.strictEqual(maskHomePaths('C:' + B + 'Users' + B + 'zedq' + B + 'x and //fs01/homes/zedq/y', []), '~' + B + 'x and //fs01/homes/zedq/y', 'FR-435 screen: a Windows home folder is still ~, the share path whole');
  // secrets inside a share path: hidden on every screen chain, the rest of the path shown
  const run = (k: number, chars = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7'): string => { let s = ''; while (s.length < k) s += chars; return s.slice(0, k); };
  const GHP = 'gh' + 'p_' + run(36);
  const GKEY = 'AI' + 'za' + run(35);
  const PW = 'Hunter' + '2pass9';
  const SECRET: [string, string, string, string][] = [ // what, text, the secret piece, a piece of the path that stays
    ['a user and password in an smb link', 'smb://alex:' + PW + '@fs01/projects/x.txt', PW, '@fs01/projects/x.txt'],
    ['a user and password in an afp link', 'afp://alex:' + PW + '@fs01/projects/x.txt', PW, '@fs01/projects/x.txt'],
    ['a GitHub token as a UNC folder', B + B + 'fs01' + B + 'projects' + B + GHP + B + 'x.txt', GHP.slice(4, 16), B + B + 'fs01' + B + 'projects' + B],
    ['a base64-family key as a UNC folder', B + B + 'fs01' + B + 'projects' + B + GKEY + B + 'x.txt', GKEY.slice(4, 16), B + B + 'fs01' + B + 'projects' + B],
    ['a GitHub token as the UNC server', B + B + GHP + B + 'projects' + B + 'x.txt', GHP.slice(4, 16), B + B], // the token rule takes the rest of the run, as before
    ['a base64-family key as a forward-slash folder', '//fs01/homes/' + GKEY + '/x.txt', GKEY.slice(4, 16), '//fs01/homes/'],
    ['a base64-family key as an smb folder', 'smb://fs01/projects/' + GKEY + '/x.txt', GKEY.slice(4, 16), 'smb://fs01/projects/'],
    ['a token in a file link\'s query', 'file://fs01/projects/x.txt?access_token=' + run(24), run(24), 'file://fs01/projects/x.txt?access_token='],
  ];
  // review of PR 2112, finding 3: a key glued to letters inside the server, the share or the next folder (which the old rule hid with the whole place, and no key
  // rule reads on its own): five key families, each as the share, the next folder, a home share's folder and the server; the rest of the path is shown
  const hexr = (k: number): string => run(k, '0a1b2c3d4e5f6a7b8c9d');
  const FAMILIES: [string, string][] = [['google api', GKEY], ['bedrock', 'AB' + 'SK' + run(120) + '=='], ['facebook', 'EA' + 'AC' + run(120)], ['databricks', 'da' + 'pi' + hexr(32)], ['twilio', 'S' + 'K' + hexr(32)]];
  for (const [fam, k] of FAMILIES) SECRET.push(
    [`a ${fam} key glued to letters as the UNC share`, B + B + 'fs01' + B + 'y' + k + B + 'x.txt', k.slice(4, 16), B + B + 'fs01' + B],
    [`a ${fam} key glued to letters as the UNC next folder`, B + B + 'fs01' + B + 'projects' + B + 'y' + k + B + 'x.txt', k.slice(4, 16), B + B + 'fs01' + B + 'projects' + B],
    [`a ${fam} key glued to letters in a forward-slash home share`, '//fs01/homes/y' + k + '/x.txt', k.slice(4, 16), '//fs01/homes/'],
    [`a ${fam} key glued to letters as the UNC server`, B + B + 'y' + k + B + 'projects' + B + 'x.txt', k.slice(4, 16), B + 'projects' + B + 'x.txt'],
  );
  for (const [what, t, sec, keep] of SECRET) for (const [m, f] of Object.entries(SCREEN)) {
    if (m === 'home' && !/glued/.test(what)) continue; // the home mask alone hides no secret on these forms (a screen surface always runs a secret mask too)
    const o = f(t);
    assert.ok(!o.includes(sec), `FR-435 secret: ${what} stays hidden (${m}): ${o}`);
    // over-masking kept: redact after the home mask folds what follows a hidden server into the mask (its rule for a value glued to a mask, FR-187)
    if (!(/glued to letters as the UNC server/.test(what) && m === 'home, then redact')) assert.ok(o.includes(keep), `FR-435 secret: ${what}, the rest of the path is shown (${m}): ${o}`);
  }
  // the outbound chains hide them too
  const OUT: Record<string, (t: string) => string> = { 'outbound, redact first': (t) => maskHomePathsOutbound(redact(t, {}), []), 'outbound home, then redact': (t) => redact(maskHomePathsOutbound(t, []), {}) };
  for (const [what, t, sec] of SECRET) for (const [m, f] of Object.entries(OUT)) assert.ok(!f(t).includes(sec), `FR-435 secret (outbound): ${what} stays hidden (${m}): ${f(t)}`);
  // a part with no key shape is never hidden on screen (near misses: a hex digest folder, words, a long name)
  for (const p of [B + B + 'fs01' + B + '0123456789abcdef0123456789abcdef01234567' + B + 'x', B + B + 'fs01' + B + 'Quarterly Reports Archive 2019' + B + 'x', '//fs01/homes/Alexandra-Example-Longname/x'])
    assert.strictEqual(maskHomePaths(p, []), p, `FR-435 screen: a share part with no key shape is shown: ${p}`);
  // the cut marker (finding 1): the outbound mask hides a share lead cut after its server, in every spelling; the screen mask keeps it
  for (const t of [B + B + 'fs01' + B + ' [truncated]', B + B + 'fs01 [truncated]', B.repeat(4) + 'fs01' + B + B + ' [truncated]', 'spawn ' + B + B + 'fs01.corp.example' + B + ' [truncated]', '//fs01/hom [truncated]']) {
    const o = maskHomePathsOutbound(t, []);
    assert.ok(!/fs01/.test(o) && o.endsWith('~ [truncated]'), `FR-435 outbound: a share lead before the cut marker loses its server: ${JSON.stringify(t)} -> ${JSON.stringify(o)}`);
    assert.strictEqual(maskHomePaths(t, []), t, `FR-435 screen: a share lead before the cut marker is shown: ${JSON.stringify(t)}`);
  }
  assertLinearShape('FR-435 maskHomePaths many long share parts', (x) => { maskHomePaths(x, []); }, (k) => (B + B + 'a'.repeat(120) + B + 'b'.repeat(120) + B + 'c'.repeat(120) + ' ').repeat(Math.ceil(k / 364)).slice(0, k), 400_000);
  // differential over a generated corpus: the screen and outbound masks differ only on texts with a UNC path, the outbound mask of the screen's output equals
  // the outbound mask of the text (the screen removes nothing the outbound mask keeps), and nothing else changes
  {
    let seed = 0x2060;
    const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k; };
    const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)];
    const PIECES = [...SHARES.map(([, p]) => p), '/home/zedq/a.txt', 'C:' + B + 'Users' + B + 'zedq' + B + 'x', '/Users/zedq', 'src/app.js', 'https://h.example/p?q=1', 'done.', 'git log -n 5', '~zedq/src/x', GHP, 'password=' + PW];
    let texts = 0, differ = 0, differNoUnc = 0, notOutbound = 0;
    for (let i = 0; i < 2000; i++) {
      const parts: string[] = []; for (let j = 0, k = 1 + rnd(5); j < k; j++) parts.push(pick(PIECES));
      const t = parts.join(pick([' ', '\n', ', ']));
      const s = maskHomePaths(t, []), o = maskHomePathsOutbound(t, []);
      texts++;
      if (s !== o) { differ++; if (!/\\{2,}|\/\/fs01\/homes/.test(t)) differNoUnc++; }
      if (maskHomePathsOutbound(s, []) !== o) notOutbound++;
    }
    assert.strictEqual(differNoUnc, 0, `FR-435 differential: the screen and outbound masks differ only on texts with a UNC path (${differ} of ${texts} differ)`);
    assert.strictEqual(notOutbound, 0, 'FR-435 differential: the outbound mask of the screen\'s output equals the outbound mask of the text');
    assert.ok(differ > 500, `FR-435 differential: the corpus exercises the UNC forms (${differ} of ${texts})`);
    console.log(`FR-435 differential: ${differ} of ${texts} texts read differently on screen and outbound, each with a UNC path`);
  }
  // review of PR 2112, finding 4: secret-bearing shares in the corpus, and the FULL screen chains (secret masks and the home mask, as the window composes them)
  // against the old chains (the outbound home mask in the place of the screen one: main's home mask on text with no cut marker): no 4-character piece of a
  // secret that the old chain hid is shown by the new one. Fixed seed, no timing.
  {
    let seed = 0x2112;
    const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k; };
    const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)];
    const PLAIN = [...SHARES.map(([, p]) => p), '/home/zedq/a.txt', 'C:' + B + 'Users' + B + 'zedq' + B + 'x', 'src/app.js', 'https://h.example/p?q=1', 'done.', 'git log -n 5'];
    const SEC: [string, string][] = SECRET.map(([, t, sec]) => [t, sec]); // text, the secret it holds
    for (const [, k] of FAMILIES) { SEC.push([B + B + 'nas' + B + 'team' + B + 'q' + k, k]); SEC.push(['//nas/users/z' + k + '/a', k]); }
    SEC.push([GHP, GHP], ['password=' + PW, PW]);
    const chain = (home: (t: string) => string): Record<string, (t: string) => string> => ({
      'redact, then home': (t) => home(redact(t, {})), 'redact, home, key shapes': (t) => maskTokenShapes(home(redact(t, {})), '[redacted]'),
      'home, then redact': (t) => redact(home(t), {}), 'url, then home': (t) => home(maskSecretUrl(t, {})),
    });
    const NEW = chain((t) => maskHomePaths(t, [])), OLD = chain((t) => maskHomePathsOutbound(t, []));
    let texts = 0, hidOld = 0, shownNew = 0, withSecret = 0;
    const shown: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const parts: string[] = [], secs: string[] = [];
      for (let j = 0, k = 1 + rnd(5); j < k; j++) { if (rnd(2) === 0) { const [t, sec] = pick(SEC); parts.push(t); secs.push(sec); } else parts.push(pick(PLAIN)); }
      const t = parts.join(pick([' ', '\n', ', ']));
      const plain = parts.filter((p) => !SEC.some(([x]) => x === p)).join(' ');
      texts++; if (secs.length) withSecret++;
      for (const m of Object.keys(NEW)) {
        const o = OLD[m](t), n = NEW[m](t);
        for (const sec of secs) for (let q = 0; q + 4 <= sec.length; q++) {
          const pc = sec.slice(q, q + 4);
          if (plain.includes(pc) || o.includes(pc)) continue;
          hidOld++;
          if (n.includes(pc)) { shownNew++; if (shown.length < 3) shown.push(`${m}: ${pc} in ${JSON.stringify(t).slice(0, 160)}`); }
        }
      }
    }
    assert.strictEqual(shownNew, 0, `FR-435 differential with secrets: pieces the old chain hid and the new chain shows = 0 (${texts} texts, ${hidOld} pieces hidden by the old chains) ${shown.join(' | ')}`);
    assert.ok(withSecret > 2000 && hidOld > 100000, `FR-435 differential with secrets: the corpus exercises secret pieces (${withSecret} texts with a secret, ${hidOld} pieces)`);
    console.log(`FR-435 differential with secrets: ${texts} texts (${withSecret} with a secret), 4 chains, ${hidOld} secret pieces the old chains hide, ${shownNew} of them shown by the new chains`);
  }
}

// ---- spec 058 (security review on #635): OAuth query values in redact() itself, so the debug sink masks a CLI's stderr line ----
{
  const lines: string[] = [];
  const sink = createDebugSink('/dev/null', {}, (_f, d) => lines.push(d));
  const page = 'https://auth.example.com/authorize?response_type=code&client_id=durbar&code_challenge=PKCECHALLENGE123&state=STATEVALUE456&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2Fcallback';
  const cb = 'http://127.0.0.1:41234/callback?code=AUTHCODE789&state=STATEVALUE456';
  const enc = 'next=' + encodeURIComponent(cb);
  const frag = 'https://app.example.com/cb#access_token=ACCESSTOK111;id_token=IDTOK222&refresh_token=REFRESH333';
  const other = 'POST /token code_verifier=x client_secret=y'; // not a URL query: unchanged by this rule
  sink({ stderr: `MCP OAuth for notes: ${page}\nlistening ${cb}\n${enc}\n${frag}\n${other}` });
  const out = lines.join('');
  for (const v of ['PKCECHALLENGE123', 'STATEVALUE456', 'AUTHCODE789', 'ACCESSTOK111', 'IDTOK222', 'REFRESH333']) assert.ok(!out.includes(v), `${v} is masked in the debug sink: ${out}`);
  assert.ok(out.includes('client_id=durbar') && out.includes('response_type=code') && out.includes('127.0.0.1') && out.includes('auth.example.com/authorize'), 'the rest of the line stays readable');
  assert.ok(out.includes('code_verifier=x client_secret=y'), 'only query and fragment values');
  assert.strictEqual(redact('?CODE=abc&State=def'), '?CODE=[redacted]&State=[redacted]', 'any case');
  assert.strictEqual(redact('see ?codec=1&statement=2'), 'see ?codec=1&statement=2', 'a longer name is not one of them');
  assert.ok(!JSON.parse(lines[0]).stderr.includes('AUTHCODE'), 'the line stays valid JSON');
  // bounded and linear: long values and long runs of separators
  assertLinearShape('oauth query value', (x) => void redact(x), (n) => '?code=' + 'a'.repeat(n));
  assertLinearShape('oauth query names', (x) => void redact(x), (n) => '&state='.repeat(Math.ceil(n / 7)));
  assertLinearShape('oauth query separators', (x) => void redact(x), (n) => '%3F'.repeat(Math.ceil(n / 3)));
}

// 14e. T072 (#502, R12): PowerShell hashtable literals `@{ Name = Value; ... }`. The value of a secret-looking member is hidden, quotes kept.
{
  const T = 'TOKEN' + '123';
  const R = '[redacted]';
  const noT = (x: unknown, what: string): void => assert.ok(!JSON.stringify(x).includes(T), `${what}: no secret in ${JSON.stringify(x)}`);
  const cmd = (c: string, want: string, what: string): void => { const got = maskSecretCommand(c); assert.strictEqual(got, want, what); noT(got, what); };
  const args = (a: string[], want: string[], what: string): void => { const got = maskSecretArgs(a); assert.deepStrictEqual(got, want, what); noT(got, what); };
  // commands
  cmd(`srv @{"X-Api-Key"="${T}"}`, `srv @{"X-Api-Key"="${R}"}`, 'R12: quoted name, double-quoted value');
  cmd(`srv @{'api_key'='${T}'}`, `srv @{'api_key'='${R}'}`, 'R12: single quotes');
  cmd(`srv @{Authorization = "Bearer ${T}"}`, `srv @{Authorization = "${R}"}`, 'R12: spaces around =, a value with a space');
  cmd(`srv @{ token = ${T}; port = 8080 }`, `srv @{ token = ${R}; port = 8080 }`, 'R12: bare value, the other member stays');
  cmd(`srv @{ port = 8080; token = ${T} }`, `srv @{ port = 8080; token = ${R} }`, 'R12: the secret member last');
  cmd(`srv @{\n  port = 8080\n  password = ${T}\n}`, `srv @{ port = 8080 password = ${R} }`, 'R12: members on separate lines (the display joins words with one space)');
  cmd(`srv @{token='it''s ${T}'; a=1}`, `srv @{token='${R}'; a=1}`, "R12: '' inside a value");
  cmd(`srv [ordered]@{ password = "p ${T}" }`, `srv [ordered]@{ password = "${R}" }`, 'R12: [ordered]');
  cmd(`srv @{Authorization="${T}"; 'Content-Type'='x'; cookie=${T}}`, `srv @{Authorization="${R}"; 'Content-Type'='x'; cookie=${R}}`, 'R12: two secret members, a quoted name that is not secret');
  // payloads of powershell|pwsh -Command, plain and with escapes (T067 path)
  cmd(`powershell -Command "@{'api_key'='${T}'}"`, `powershell -Command "@{'api_key'='${R}'}"`, 'R12: powershell -Command payload');
  cmd(`pwsh -c '@{token=''${T}''; port=1}'`, `pwsh -c '@{token=''${R}''; port=1}'`, "R12: pwsh -c payload with '' escapes");
  cmd('powershell -Command "@{`"X-Api-Key`"=`"' + T + '`"}"', 'powershell -Command "@{`"X-Api-Key`"=`"' + R + '`"}"', 'R12: powershell backtick-escaped quotes');
  cmd(`sh -c "srv @{\\"token\\"=\\"${T}\\"}"`, `sh -c "srv @{\\"token\\"=\\"${R}\\"}"`, 'R12: sh -c payload with escaped quotes (R3)');
  // args lists, also split across args
  args(['srv', `@{"X-Api-Key"="${T}"}`], ['srv', `@{"X-Api-Key"="${R}"}`], 'R12 args: one arg');
  args(['pwsh', '-c', `@{"X-Api-Key"="${T}"}`], ['pwsh', '-c', `@{"X-Api-Key"="${R}"}`], 'R12 args: pwsh -c payload');
  args(['powershell', '-Command', `@{token='a''${T}'}`], ['powershell', '-Command', `@{token='${R}'}`], "R12 args: powershell -Command payload with ''");
  args(['srv', '@{token=', `${T};`, 'port=8080}'], ['srv', '@{token=', `${R};`, 'port=8080}'], 'R12 args: split after =');
  args(['pwsh', '-c', `@{token=${T};`, 'port=1}'], ['pwsh', '-c', `@{token=${R};`, 'port=1}'], 'R12 args: split inside a pwsh -c payload');
  args(['srv', '@{', 'token', '=', `"x ${T}"`, '}'], ['srv', '@{', 'token', '=', `"${R}"`, '}'], 'R12 args: one word per arg, quoted value');
  const spanned = maskSecretArgs(['srv', '@{Authorization', '=', '"Bearer', T + '"', '}']);
  noT(spanned, 'R12 args: a quoted value that spans args');
  assert.deepStrictEqual(spanned, ['srv', '@{Authorization', '=', R, '"', '}'], 'R12 args: a quoted value that spans args is hidden in the first and cut from the later ones (the lone quote stays)');
  args(['--env=@{token=' + T + '; port=1}'], ['--env=@{token=' + R + '; port=1}'], 'R12 args: behind a flag');
  // quotes stay, with what closes the literal (single quotes, bare names, `''` inside, a value with spaces)
  cmd(`srv @{Authorization='Bearer ${T}'}`, `srv @{Authorization='${R}'}`, "R12: single-quoted value keeps its quotes and the }");
  cmd(`powershell -Command "irm -Headers @{Authorization='Bearer ${T}'}"`, `powershell -Command "irm -Headers @{Authorization='${R}'}"`, 'R12: inside a payload the closing quote stays');
  cmd(`srv @{token='a''b' ; secret='x y ${T}' ; port = 1}`, `srv @{token='${R}' ; secret='${R}' ; port = 1}`, "R12: '' inside, two quoted values with spaces, the other member stays");
  cmd(`srv @{token='a b ${T}'; port=1}`, `srv @{token='${R}'; port=1}`, 'R12: bare name, quoted value with spaces');
  cmd(`srv @{token="a b ${T}"}`, `srv @{token="${R}"}`, 'R12: bare name, double-quoted value with spaces');
  args(['srv', `@{Authorization='${T}'}`], ['srv', `@{Authorization='${R}'}`], 'R12 args: single-quoted value keeps its quotes and the }');
  // unclosed values are hidden to the end (fail closed)
  cmd(`srv @{token="a ${T}`, `srv @{token="${R}`, 'R12: unclosed double quote');
  cmd(`srv @{"X-Api-Key"='a b ${T}`, `srv @{"X-Api-Key"='${R}`, 'R12: unclosed single quote');
  args(['srv', '@{"X-Api-Key"="a', 'b ' + T], ['srv', `@{"X-Api-Key"="${R}`], 'R12 args: unclosed, split across args');
  // a backtick escapes the quote inside a double-quoted value
  cmd('srv @{token="a`"b ' + T + '"}', `srv @{token="${R}"}`, 'R12: backtick-escaped quote inside a double-quoted value');
  cmd('srv @{"X-Api-Key"="a`" ' + T + '"}', `srv @{"X-Api-Key"="${R}"}`, 'R12: backtick-escaped quote, quoted name');
  // nested literals (any depth), and the splatting shape
  cmd(`srv @{Headers=@{"X-Api-Key"="${T}"}}`, `srv @{Headers=@{"X-Api-Key"="${R}"}}`, 'R12: nested literal');
  cmd(`srv @{h=@{Authorization="Basic ${T}"}}`, `srv @{h=@{Authorization="${R}"}}`, 'R12: nested literal, Authorization');
  cmd(`srv @{Headers=@{"X-Api-Key"="${T}"; Accept="x"}; Port=1}`, `srv @{Headers=@{"X-Api-Key"="${R}"; Accept="x"}; Port=1}`, 'R12: nested literal, the other members stay');
  cmd(`srv @{a=@{b=@{token='${T}'}}}`, `srv @{a=@{b=@{token='${R}'}}}`, 'R12: three levels');
  cmd(`$p=@{Uri='u';Headers=@{"X-Api-Key"="${T}"}}; irm @p`, `$p=@{Uri='u';Headers=@{"X-Api-Key"="${R}"}}; irm @p`, 'R12: splatting shape');
  args(['pwsh', '-c', `@{h=@{Authorization="Basic ${T}"}}`], ['pwsh', '-c', `@{h=@{Authorization="${R}"}}`], 'R12 args: nested literal in a payload');
  cmd('srv @{Port=8080; Headers=@{Accept="x"}}', 'srv @{Port=8080; Headers=@{Accept="x"}}', 'R12: a nested literal with nothing secret is unchanged');
  // expression values of a secret member are hidden whole, up to the member's end
  cmd(`srv @{token="a" + "${T}"; port=1}`, `srv @{token=${R}; port=1}`, 'R12: string concatenation');
  cmd(`srv @{token=ConvertTo-SecureString ${T} -AsPlainText; port=1}`, `srv @{token=${R}; port=1}`, 'R12: a command as the value');
  cmd(`srv @{token=""${T}""; port=1}`, `srv @{token=${R}; port=1}`, 'R12: doubled quotes as the value');
  cmd(`srv @{token=(Get-Secret ${T} 1); a=2}`, `srv @{token=${R}; a=2}`, 'R12: a parenthesised expression');
  cmd(`srv @{token=@{a=1}; Port=1}`, `srv @{token=${R}; Port=1}`, 'R12: a nested literal as the value of a secret name is hidden whole');
  cmd('srv @{token="a" `\n + "' + T + '"; port=1}', `srv @{token=${R}; port=1}`, 'R12: backtick line continuation');
  for (const [hs, what] of [[`srv @{token=@'\n${T}\n'@; Port=1}`, "here-string '@"], [`srv @{token=@"\n${T}\n"@; Port=1}`, 'here-string "@'], [`srv @{token=@'\r\n${T}\r\n'@\r\nPort=1}`, 'here-string with CRLF']]) {
    const got = maskSecretCommand(hs);
    assert.ok(!got.includes(T) && got.includes(R), `R12: ${what}: ${JSON.stringify(got)}`);
  }
  // redact() alone: only a whole hidden value is left as it is; `[redacted]` glued to more text is a secret that merely starts like the mask
  for (const x of [`Authorization: [redacted]${T}`, `Authorization='[redacted]${T}'`, `Authorization=[redacted]${T}`, `authorization: Bearer [redacted]${T}`, `Authorization: Bearer '[redacted]-${T}`, `curl -H "Authorization: [redacted]${T}"`,
    `Authorization: [redacted]}${T}`, `Authorization='[redacted]'}${T}`, `authorization: Bearer [redacted]}${T}`, `Authorization: [redacted]}}${T}`, `{"h":"Authorization: [redacted]}${T}"}`]) {
    assert.ok(!redact(x, {}).includes(T), `R12: redact() hides a secret glued to [redacted]: ${x}`);
  }
  assert.strictEqual(redact("Authorization='[redacted]'}", {}), "Authorization='[redacted]'}", 'R12: redact() leaves a whole hidden quoted value alone');
  assert.strictEqual(redact('Authorization: [redacted]', {}), 'Authorization: [redacted]', 'R12: redact() is idempotent on a hidden value');
  // a backtick line continuation right after `=`
  cmd('srv @{"X-Api-Key" = `\n"' + T + '"}', `srv @{"X-Api-Key" = ${R} }`, 'R12: continuation after =, quoted value');
  cmd('srv @{token = `\n' + T + '}', `srv @{token = ${R} }`, 'R12: continuation after =, bare value');
  cmd('srv @{token = `\r\n' + T + '}', `srv @{token = ${R} }`, 'R12: continuation after =, CRLF');
  cmd('srv @{token = `\r\n  "' + T + '"; port=1}', `srv @{token = ${R} ; port=1}`, 'R12: continuation after =, indented quoted value, the next member stays');
  // exact output: what closes the literal stays
  cmd(`srv @{a=@{b=1}; token="${T}"}`, `srv @{a=@{b=1}; token="${R}"}`, 'R12: after a nested literal the outer literal goes on, quotes and } stay');
  cmd(`srv @{token=@'\n${T}\n'@}`, `srv @{token=${R}}`, "R12: here-string ends at its closer, no stray '@ or }");
  cmd(`srv @{Authorization = "Bearer " + "${T}"}`, `srv @{Authorization = ${R}}`, 'R12: an expression stops at the } of the literal');
  // a } inside quotes does not close the literal when it is split across args
  args(['srv', "@{token='it}s", `fine ${T}'}`], ['srv', `@{token='${R}`, "'}"], 'R12 args: a } inside quotes does not end the literal');
  // two here-strings of one kind in a text (the closer search is cached and must be refreshed): exact output, in a worker with a timeout, because a scanner that does not move on hangs
  {
    const input = `srv @{a=@'\nx\n'@; password=@'\n${T}\n'@}`;
    const want = `srv @{a=@'\nx\n'@; password=${R}}`;
    const wcode = `const {workerData:w}=require('worker_threads');const f=new Int32Array(w.sab,0,1);try{const {maskSecretCommand:m}=require(w.mod);Atomics.store(f,0,m(w.input)===w.want?1:3)}catch(e){Atomics.store(f,0,2)}Atomics.notify(f,0)`;
    const sab = new SharedArrayBuffer(8);
    const wk = new Worker(wcode, { eval: true, workerData: { mod: require.resolve('../src/shared/redact'), input, want, sab } });
    const waited = Atomics.wait(new Int32Array(sab, 0, 1), 0, 0, 20000);
    void wk.terminate();
    assert.notStrictEqual(waited, 'timed-out', 'R12: two here-strings of one kind: the scanner hung');
    assert.strictEqual(Atomics.load(new Int32Array(sab, 0, 1), 0), 1, 'R12: two here-strings of one kind: exact output');
  }
  // review of PR #669, round 2: the literal bound inside a string with braces, an open group past the bound, masking twice past the bound, junk before a name
  {
    const items = '{"items":[' + Array.from({ length: 450 }, (_, i) => `{"id":${i}}`).join(',') + ']}';
    for (const [what, body] of [['JSON body over 4000 characters', `$h=@{ Body = '${items}'; 'X-Api-Key' = '${T}' }`], ['a quoted } after 4100 characters', `$h=@{ Body = '${'x'.repeat(4100)}'; a = '}'; 'X-Api-Key' = '${T}' }`]]) {
      assert.ok(!maskSecretCommand('srv ' + body).includes(T), `R12 (command): ${what}`);
      assert.ok(!maskSecretArgs(['srv', body]).join(' ').includes(T), `R12 (args): ${what}`);
    }
    const head = 'x'.repeat(4000 - "@{ Body = '".length);
    assert.deepStrictEqual(maskSecretArgs(['-Command', `$h=@{ Body = '${'x'.repeat(4100)}';`, `'X-Api-Key' = '${T}' }`]), ['-Command', `$h=@{ Body = '${head}${R}`, '}'], 'R12 args: an open group past the bound hides the later args of the literal');
    const once = maskSecretArgs(['-Command', `$h=@{ Body = '${'a'.repeat(4100)}' }`]);
    assert.deepStrictEqual(maskSecretArgs(once), once, 'R12 args: masking twice past the bound gives the same output');
    const onceC = maskSecretCommand(`srv $h=@{ Body = '${'a'.repeat(4100)}' }`);
    assert.strictEqual(maskSecretCommand(onceC), onceC, 'R12 command: masking twice past the bound gives the same output');
    assert.ok(once[1].endsWith(R + '}') && onceC.endsWith(R + '}'), 'R12: the earlier [redacted] and the closer stay');
  }
  args(['-Command', `irm -Headers @{\\\\"X-Api-Key\\\\"=\\\\"${T}\\\\"} u`], ['-Command', `irm -Headers @{\\\\"X-Api-Key\\\\"=\\\\"${R}\\\\"} u`], 'R12 args: two backslashes before a quote');
  assert.ok(!maskSecretCommand(`pwsh -c "irm -Headers @{\\\\\\"X-Api-Key\\\\\\"=\\\\\\"${T}\\\\\\"}"`).includes(T), 'R12: three backslashes before a quote, in a payload');
  cmd(`srv @{ <# '#>' #> 'X-Api-Key' = '${T}' }`, `srv @{ <# '#>' #> 'X-Api-Key' = '${R}' }`, 'R12: a quote inside a block comment');
  cmd(`srv @{ <# junk #> x y 'X-Api-Key' = '${T}' }`, `srv @{ <# junk #> x y 'X-Api-Key' = '${R}' }`, 'R12: junk words before a secret name');
  cmd(`srv @{ token = '${R}' -f= '${T}' }`, `srv @{ token = ${R} }`, 'R12: a hidden value followed by Name=');
  cmd(`srv @{ token = ${R} ${T}=1 }`, `srv @{ token = ${R} }`, 'R12: a hidden bare value followed by Name=1');
  cmd(`srv @{ "X-Api-Key = '${T}' }`, `srv @{ "X-Api-Key = '${R}' }`, 'R12: a stray quote before a secret name');
  cmd(`srv @{ "a; 'X-Api-Key' = '${T}' }`, `srv @{ "a; 'X-Api-Key' = '${R}' }`, 'R12: a stray quote before a quoted secret name');
  const hiddenQuote = `srv $h=@{ Body = '${'a'.repeat(3989)}${R}' }`; // the bound falls where an earlier [redacted] and its closing quote stand
  assert.strictEqual(maskSecretCommand(hiddenQuote), hiddenQuote, 'R12: an earlier [redacted] with its closers past the bound is left as it is');
  // review of PR #669, round 3: line breaks and non-breaking spaces around =, commented-out secrets, a run of stray quotes
  cmd(`pwsh -c "$h=@{ token =\n'${T}' }"`, `pwsh -c "$h=@{ token =\n'${R}' }"`, 'R12: a line break after =');
  args([`$h=@{ 'X-Api-Key' =\n '${T}' }`], [`$h=@{ 'X-Api-Key' =\n '${R}' }`], 'R12 args: a line break after =, quoted name');
  args(['-Command', `$h=@{ "X-Api-Key" =\r\n "${T}" }`], ['-Command', `$h=@{ "X-Api-Key" =\r\n "${R}" }`], 'R12 args: CRLF after =');
  args([`@{ x = 1\n token =\n ${T}\n}`], [`@{ x = 1\n token =\n ${R}\n}`], 'R12 args: a bare value on the next line');
  assert.ok(!maskSecretArgs([`@{ token = '${T}' }`]).join('').includes(T) && !maskSecretArgs([`@{ token = '${T}' }`]).join('').includes(T), 'R12 args: non-breaking spaces around =');
  assert.ok(!maskSecretCommand(`srv @{ <# 'X-Api-Key' = '${T}' #> 'X-Api-Key' = 'NEW' }`).includes(T), 'R12: a commented-out secret is hidden');
  assert.ok(!maskSecretArgs(['-Command', `@{ <# c }; $b = @{ 'X-Api-Key' = '${T}' } #>`]).join(' ').includes(T), 'R12 args: a secret in a literal after a } inside a comment');
  assert.ok(!maskSecretCommand(`srv @{ <# c }; $b = @{ 'X-Api-Key' = '${T}' } #>`).includes(T), 'R12: the same, as a command');
  assert.ok(!maskSecretCommand(`srv @{ ApiKey <# 'X-Api-Key' = '${T}' #> = 'v' }`).includes(T), 'R12: a commented-out member in the gap before = is hidden');
  cmd(`srv '@{token=${T}; port=1}'`, `srv '@{token=${R}; port=1}'`, 'R12: a quoted word keeps the member after the ;');
  // a doubled quote in a quoted name: the name is api"key
  cmd(`srv @{"api""key"="${T}"}`, `srv @{"api""key"="${R}"}`, 'R12: doubled quote in a name');
  // no member bound; past the 4000-character literal bound everything up to the literal's end is hidden (fail closed), review of PR #669
  assert.strictEqual(maskSecretCommand(`srv @{token="${'a'.repeat(2500)}"; Port=1}`), `srv @{token="${R}"; Port=1}`, 'R12: a long value is hidden whole');
  assert.strictEqual(maskSecretCommand(`srv @{p="${'a'.repeat(2500)}"; "token"="${T}"}`), `srv @{p="${'a'.repeat(2500)}"; "token"="${R}"}`, 'R12: a secret member after a 2500-character one');
  assert.strictEqual(maskSecretCommand(`srv @{p="${'a'.repeat(2500)}"; token=${T}}`), `srv @{p="${'a'.repeat(2500)}"; token=${R}}`, 'R12: a bare secret member after a 2500-character one');
  const far = maskSecretCommand(`srv @{${'p=1;'.repeat(1100)}"token"="${T}"} tail`);
  assert.ok(far.startsWith('srv @{' + 'p=1;'.repeat(999)) && far.endsWith(`${R}} tail`) && !far.includes(T), `R12: past the literal bound the rest of the literal is hidden up to its }: ${far.slice(-40)}`);
  const mem4 = [0, 1, 2, 3].map((i) => `m${i}='${'x'.repeat(1000)}'`).join('; ');
  for (const [what, got] of [['command', maskSecretCommand(`srv $h=@{ ${mem4}; 'X-Api-Key' = '${T}' }`)], ['args', maskSecretArgs(['srv', `$h=@{ ${mem4}; 'X-Api-Key' = '${T}' }`]).join(' ')],
    ['pwsh -c', maskSecretCommand(`pwsh -c "$h=@{ Body = '${'x'.repeat(2100)}'; 'X-Api-Key' = '${T}' }"`)]]) assert.ok(!got.includes(T), `R12: ${what}: secrets after long members are hidden`);
  // review of PR #669: more than one literal in the args, block comments, a value hidden twice, \" in the args form, the display of the args form
  args(['-Command', '$a=@{x=1}; $h=@{token=', `'${T}'}`], ['-Command', '$a=@{x=1}; $h=@{token=', `'${R}'}`], 'R12 args: a second literal after a closed one');
  cmd(`pwsh -c "$h=@{ <# auth #> 'X-Api-Key' = '${T}' }"`, `pwsh -c "$h=@{ <# auth #> 'X-Api-Key' = '${R}' }"`, 'R12: block comment before a quoted name');
  cmd(`srv $h=@{ <#k#> ApiKey = '${T}' }`, `srv $h=@{ <#k#> ApiKey = '${R}' }`, 'R12: block comment before a bare name');
  cmd(`srv $h=@{ ApiKey <# c #> = <# d #> '${T}' }`, `srv $h=@{ ApiKey <# c #> = <# d #> '${R}' }`, 'R12: block comments around =');
  cmd(`srv $h=@{ <# open ApiKey = '${T}' }`, `srv $h=@{ <# open ApiKey = '${R}' }`, 'R12: only the <# and #> marks are white space, the inside of a comment is read as code');
  cmd(`srv @{ token = '${R}' + '${T}' }`, `srv @{ token = ${R} }`, 'R12: a hidden value followed by more code');
  cmd(`srv @{ token = "${R}" ${T} }`, `srv @{ token = ${R} }`, 'R12: a hidden quoted value followed by a word');
  cmd(`srv @{ token = ${R} ${T} }`, `srv @{ token = ${R} }`, 'R12: a hidden bare value followed by a word');
  cmd(`srv @{ token = '${R}'; port=1 }`, `srv @{ token = '${R}'; port=1 }`, 'R12: a hidden value then a member is unchanged');
  for (const c of [`srv @{ token = '${T}' ; port = 1 }`, `srv @{Authorization="Bearer ${T}"; a=1}`, `srv @{ <# c #> k = ${T}; b = 2 }`]) assert.strictEqual(maskSecretCommand(maskSecretCommand(c)), maskSecretCommand(c), `R12: masking twice gives the same text: ${c}`);
  args(['-Command', `irm -Headers @{\\"X-Api-Key\\"=\\"${T}\\"} u`], ['-Command', `irm -Headers @{\\"X-Api-Key\\"=\\"${R}\\"} u`], 'R12 args: \\" as a quote');
  args([`$h=@{ Body = 'x'; ApiKey = '${T}' }`], [`$h=@{ Body = 'x'; ApiKey = '${R}' }`], 'R12 args: the display keeps the quotes and the closing }');

  // false positives: unchanged
  for (const c of ['@{Port=8080}', '@{name="build"}', 'a@b.c', 'see @{ the docs } for more', '@{ hello world }', '@{Name = "x"; Count = 3}', '@{', '@{;}']) {
    assert.strictEqual(maskSecretCommand('srv ' + c), 'srv ' + c, `R12 false positive (command): ${c}`);
    assert.deepStrictEqual(maskSecretArgs(['srv', c]), ['srv', c], `R12 false positive (args): ${c}`);
  }
  assert.strictEqual(maskSecretCommand('srv @{token=}'), 'srv @{token=}', 'R12: an empty value has nothing to hide');
  // one level and the bounds
  assert.strictEqual(maskSecretCommand(`srv @{token="${'a'.repeat(1500)}"}`), 'srv @{token="[redacted]"}', 'R12: a value of 1500 chars');
  assert.strictEqual(redact('see @{token=1} here'), 'see @{token=1} here', 'R12 is not part of redact(): free text keeps the pattern rules');
}

// spec 012 FR-182 (issue #1613, T164): a token split by a line break (CRLF or LF), a combining mark, a Markdown escape `\_` in its body, an HTML
// comment or tag, or a hidden character (also written as an entity) is masked like the joined token: by redact, maskSecretCommand, maskSecretArgs,
// the desk's maskRaw and the permission card. Every token is invented and built in code from pieces.
{
  const ST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string, n?: number): string; plainMarks(t: string): string; _deskWindowForTest(t: string): string; _deskWindowStepsForTest(): number; DESK_SPLIT_MAX: number; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string };
  const LA = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string } };
  const red = (t: string): string => redact(t, {});
  const cm = { redact: red, cmd: (t: string) => maskSecretCommand(t, {}), url: (t: string) => maskSecretUrl(t, {}) };
  const B = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6';
  // [name, token, where its body starts]
  const TOKS: Array<[string, string, number]> = [
    ['ghp', 'ghp_' + B.slice(0, 36), 4],
    ['github_pat', 'github_pat_' + B.slice(0, 22) + '_' + (B + B).slice(3, 62), 11],
    ['sk-proj', 'sk-proj-' + B.slice(0, 18) + '_' + B.slice(20, 42), 8],
    ['AKIA', 'AKIA' + 'Q7R2S9T4U1V6W3X8', 4],
    ['AIza', 'AIza' + B.slice(0, 35), 4],
    ['JWT', 'eyJ' + B.slice(0, 20) + '.eyJ' + B.slice(20, 36) + '.' + B.slice(5, 30), 3],
    ['xoxb', 'xoxb-' + '1234567890123-' + B.slice(0, 24), 5],
  ];
  // [form, the piece put inside the token, whether it can end a word (FR-182: then a tail under 8 letters and digits after a whole token stays, a known gap)]
  const FORMS: Array<[string, string, boolean]> = [
    ['CRLF', '\r\n', true],
    ['LF', '\n', true],
    ['a combining mark', '\u0301', false],
    ['two combining marks', '\u0301\u0323', false],
    ['an HTML comment', '<!-- -->', true],
    ['an HTML comment with words', '<!-- note -->', true],
    ['an empty <b></b>', '<b></b>', true],
    ['a <span> with an attribute', '<span class="k">', true],
    ['&#8203;', '&#8203;', false],
    ['&#x200B;', '&#x200B;', false],
    ['&ZeroWidthSpace;', '&ZeroWidthSpace;', false],
    ['&zwj;', '&zwj;', false],
    ['a zero-width space', '\u200b', false],
    // review of PR 1721
    ['CR', '\r', true],
    ['LF and indentation', '\n    ', true],
    ['a Markdown hard break (two spaces, LF)', '  \n', true],
    ['a tab and LF', '\t\n', true],
    ['a space and CRLF', ' \r\n', true],
    ['CRLF and a space', '\r\n ', true],
    // round 2 (fjcabello): a Markdown mark beside the break, a list, heading or table mark starting the next line
    ['a task item', '\n- [ ] ', true], ['strike around LF', '~~\n~~', true], ['CRLF and a quote mark', '\r\n> ', true],
    ['bold around LF', '**\n**', true], ['code marks around LF', '`\n`', true], ['a list mark', '\n- ', true], ['a numbered item', '\n1. ', true], ['a heading mark', '\n# ', true], ['a table cell', '\n| ', true],
    ['CRLF and a tab', '\r\n\t', true],
    ['LF and a quote mark', '\n> ', true],
    ['a blank line', '\n\n', true],
    ['a blank CRLF line', '\r\n\r\n', true],
    ['<!-->', '<!-->', true],
    ['<!--->', '<!--->', true],
    ['<?x?>', '<?x?>', true],
    ['<!x>', '<!x>', true],
    ['<![CDATA[]]>', '<![CDATA[]]>', true],
    ['a custom element', '<my-el></my-el>', true],
    ['an svg:g element', '<svg:g></svg:g>', true],
    ['a long tag name', '<' + 'abcdefghij'.repeat(3) + '></' + 'abcdefghij'.repeat(3) + '>', true],
    ['<span/class>', '<span/class="x">', true],
    ['a long attribute', '<span title="' + 'x'.repeat(140) + '">', true],
    ['a zero-width space and a mark', '\u200b\u0301', false],
    ['an astral hidden character and a mark', '\u{E0041}\u0301', false],
    ['&#8203 without ;', '&#8203', false],
    ['&#x200B without ;', '&#x200B', false],
  ];
  const windows = (tok: string, body: number): string[] => { const w: string[] = []; for (let i = body; i + 8 <= tok.length; i++) w.push(tok.slice(i, i + 8)); return w; };
  const alnum = (s: string): number => (s.match(/[A-Za-z0-9]/g) ?? []).length;
  const CTX: Array<[string, (x: string) => string]> = [['alone', (x) => x], ['among words', (x) => 'see ' + x + ' here'], ['in double quotes', (x) => 'echo "' + x + '"'],
    // Markdown around it: the desk's maskRaw takes its plain pass then (review of PR 1721, item 1)
    ['in a code span', (x) => '`' + x + '`'], ['in a task item', (x) => '- [ ] ' + x], ['after a code span and a masked value', (x) => 'a `b` password=x1234567 ' + x],
    ['beside a second token in a code span', (x) => '`gho_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2' + '` then ' + x],
    // round 2: a Markdown mark right after the token with a word glued on (plainKeep removes the mark and glues the word)
    ['before a code mark and a word', (x) => x + '`s'], ['before a bold word', (x) => x + '**word**'],
    ['after a masked value, before a code mark', (x) => 'Rotated `password=hunter22`, new ' + x + '`s']];
  let checked = 0;
  let gaps = 0;
  for (const [tn, tok, body] of TOKS) {
    const ws = windows(tok, body);
    const shown = (out: string, piece: string): string | undefined => ws.find((w) => out.replace(piece, '').includes(w));
    for (const [fn, piece, ender] of FORMS) {
      for (let c = body + 1; c < tok.length; c++) {
        const head = tok.slice(0, c);
        const tail = tok.slice(c);
        // the known gap of FR-182: a piece that ends a word after a head the rules hide as written, then fewer than 8 letters and digits
        if (ender && alnum(tail) < 8 && red(head) !== head) { gaps++; continue; }
        // a blank line or a quote mark after a whole head: a new paragraph or quote, not the token's rest (round 2, item 4): a written-down gap
        // an entity without its `;` takes the digits after it, as HTML does (`&#82031` is another character): a written-down gap
        if (/^&#[0-9]+$/.test(piece) ? /^[0-9]/.test(tail) : /^&#x/i.test(piece) && !piece.endsWith(';') && /^[0-9A-Fa-f]/.test(tail)) { gaps++; continue; }
        const v = head + piece + tail;
        for (const [cn, ctx] of CTX) {
          // a blank line, a quote, list, heading or table mark, or a Markdown mark at the break, after a head already hidden (alone or by its context): the tail is
          // taken only when it holds both a letter and a digit (round 3, owner decision); one without is a written-down gap
          if (!/[0-9]|[A-Z][^A-Z]*[A-Z]/.test(tail) && (red(head) !== head || red(ctx(head)) !== ctx(head))) { gaps++; continue; }
          const t = ctx(v);
          const what = `#1613 ${fn} (${tn} cut at ${c}, ${cn})`;
          let w = shown(red(t), piece);
          assert.ok(!w, `${what}: redact hides it (${JSON.stringify(w)} shown): ${JSON.stringify(red(t))}`);
          checked++;
          // the other surfaces at the first and last cut and every fifth one (each runs redact itself; the whole table on all six took over three minutes)
          if (c !== body + 1 && c !== tok.length - 1 && c % 5 !== 0) continue;
          w = shown(maskSecretCommand('echo ' + t, {}), piece);
          assert.ok(!w, `${what}: maskSecretCommand hides it (${JSON.stringify(w)} shown)`);
          w = shown(maskSecretArgs(['run', t], {}).join(' '), piece);
          assert.ok(!w, `${what}: maskSecretArgs hides it (${JSON.stringify(w)} shown)`);
          w = shown(ST.maskRaw(t, red), piece);
          assert.ok(!w, `${what}: the desk's maskRaw hides it (${JSON.stringify(w)} shown)`);
          // the desk line: made plain (a line break becomes a space, `_` dropped), so it is checked without the `_` of the body too
          const ex = ST.excerpt(t, red);
          w = ws.find((x) => ex.replace(piece, '').includes(x) || ex.includes(x.replace(/_/g, '')));
          assert.ok(!w, `${what}: the desk excerpt hides it (${JSON.stringify(w)} shown): ${JSON.stringify(ex)}`);
          w = shown(LA.permText('echo ' + t, 'shell', cm).text, piece);
          assert.ok(!w, `${what}: the permission card hides it (${JSON.stringify(w)} shown)`);
        }
      }
    }
    // a Markdown escape of an underscore inside the body (`github_pat_<22>\_<59>`, `sk-proj-<18>\_<22>`): every `_` of the body escaped in turn
    for (let c = body; c < tok.length; c++) {
      if (tok[c] !== '_') continue;
      const v = tok.slice(0, c) + '\\' + tok.slice(c);
      for (const [cn, ctx] of CTX) {
        const t = ctx(v);
        const w = ws.find((x) => red(t).includes(x));
        assert.ok(!w, `#1613 a Markdown escape \\_ in the body (${tn} at ${c}, ${cn}): redact hides it (${JSON.stringify(w)} shown): ${JSON.stringify(red(t))}`);
        assert.ok(!ws.some((x) => maskSecretCommand('echo ' + t, {}).includes(x)), `#1613 a Markdown escape \\_ in the body (${tn} at ${c}, ${cn}): maskSecretCommand hides it`);
        checked++;
      }
    }
  }
  // the escaped rest after a whole head is short: under FR-173's 16 after `_` (the review's form, before FR-182 the last 10 characters showed)
  for (const t of ['sk-proj-' + B.slice(0, 30) + '\\_' + B.slice(30, 40), 'echo sk-proj-' + B.slice(0, 26) + '\\_' + B.slice(26, 34) + ' done']) {
    const out = red(t);
    assert.ok(!out.includes(B.slice(30, 38)) && !out.includes(B.slice(26, 34)), `#1613 a Markdown escape \\_ before a short rest: redact hides it: ${JSON.stringify(out)}`);
  }
  // a line break at a colon inside a token (a Telegram bot token's `<id>:` then its secret on the next line) is read too
  assert.strictEqual(red('bot 123456789:\n' + (B + B).slice(0, 35) + ' ok'), 'bot [redacted]\n[redacted] ok', '#1613 a line break after the colon of a bot token');
  assert.ok(checked > 20000 && gaps < checked / 5, `#1613: the table reaches every form (${checked} cases, ${gaps} in the written-down gap)`);

  const GH = TOKS[0][1];
  // the line structure stays: each side of a line break masked on its own
  assert.strictEqual(red(GH.slice(0, 16) + '\r\n' + GH.slice(16)), '[redacted]\r\n[redacted]', '#1613 CRLF: the line break stays in the output');
  assert.strictEqual(red('a ' + GH.slice(0, 16) + '\n' + GH.slice(16) + ' b'), 'a [redacted]\n[redacted] b', '#1613 LF: the words around it stay');
  assert.strictEqual(red(GH.slice(0, 16) + '<!-- a\r\nb -->' + GH.slice(16)), '[redacted]\r\n[redacted]', '#1613 an HTML comment across lines: the line break stays');
  assert.strictEqual(ST.excerpt('done\r\nline two\nline three', red), 'done line two line three', '#1613 the desk excerpt of plain lines is unchanged');
  // the rules as written and the joined copy together: a key block masked whole stays one mask
  assert.strictEqual(red('key: -----BEGIN PRIVATE KEY-----\n' + ['MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'QQQQ' + B.slice(0, 28)].join('\n') + '\n-----END PRIVATE KEY-----'), 'key: [redacted]', '#1613 a key block stays one mask');
  // a whole token at a line's end: a short next word stays, a word that could be the rest of a token goes with it (FR-173's count, fail closed)
  assert.strictEqual(red(GH + '\nok then'), '[redacted]\nok then', '#1613 a whole token at a line end keeps a short next word');
  assert.strictEqual(red(GH + '</p>ok'), '[redacted]</p>ok', '#1613 a whole token before a tag keeps a short next word');
  assert.strictEqual(red(GH + '\r\nimplementation'), '[redacted]\r\nimplementation', '#1613 round 3: a whole token at a line end keeps a next word without a digit or two capitals');
  assert.strictEqual(red(GH + '\r\nRelease2024'), '[redacted]\r\n[redacted]', '#1613 round 3: a whole token at a line end takes a next run with a digit (the written-down over-mask)');
  // a mask already in the text stays apart
  assert.strictEqual(red('[redacted]' + GH.slice(0, 16) + '&#8203;' + GH.slice(16)), '[redacted][redacted]', '#1613 a mask already in the text stays apart');

  // no over-masking: ordinary text with these pieces is returned as written
  const B64 = Array.from({ length: 6 }, (_, i) => ('TWFueSBoYW5kcyBtYWtlIGxpZ2h0IHdvcmsu' + i).repeat(3).slice(0, 76)).join('\n');
  for (const keep of [
    'line one\r\nline two\r\n', 'see the docs\nimplementation notes\nconfiguration_value_here', 'cafe\u0301 and nai\u0308ve', 'काम\u093f और', '<b>bold</b> text and <i>more</i>',
    'a<!-- note -->b', 'x&#8203;y and &amp; &lt;tag&gt; &#169;', 'Array<string> and Map<K, V>', 'version 1.2.\nNext line',
    'sk-short\nsk_test_x\nsk_test_helpers\npk_live_x', 'abc_def-123\nghi_jkl-456', 'ID12345\r\nAB67890', 'word\u200bword', 'emoji \u{1F469}\u200d\u{1F4BB} here', B64,
    'token:\nnone', 'C:\\Users\\me\\file_name.txt\nD:\\data\\x_y',
  ]) {
    assert.strictEqual(red(keep), keep, `#1613 no over-masking: ${JSON.stringify(keep.slice(0, 40))}`);
    // a command reads a line break as the end of a command (its own rules, as on main), so only the one-line texts go through it
    if (!/[\r\n]/.test(keep)) assert.ok(!maskSecretCommand('echo ' + keep, {}).includes('[redacted]'), `#1613 no over-masking (command): ${JSON.stringify(keep.slice(0, 40))}`);
  }

  // random cuts (as #1585): a seeded generator puts a random piece at a random place in a random token, among random words; no 8 characters of a body survive redact
  {
    let seed = 0x1613;
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 16) % n; };
    const AN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const b = (n: number): string => Array.from({ length: n }, () => AN[rnd(62)]).join('');
    const gen: Array<() => [string, number]> = [() => ['ghp_' + b(36), 4], () => ['sk-proj-' + b(40), 8], () => ['github_pat_' + b(22) + '_' + b(59), 11], () => ['xoxb-' + b(12) + '-' + b(24), 5]];
    const words = ['echo', 'token=', 'Done.', 'a/b/c', 'k=v', '[redacted]', 'the', 'note:'];
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const [tok, body] = gen[rnd(gen.length)]();
      const [fn, piece, ender] = FORMS[rnd(FORMS.length)];
      const c = body + 1 + rnd(tok.length - body - 1);
      const head = tok.slice(0, c);
      const tail = tok.slice(c);
      const w1 = words[rnd(words.length)], w2 = words[rnd(words.length)], sep = [' ', '\n', ', '][rnd(3)];
      const pre = w1 + sep + head; // the head in its context: a name before it can hide it as written
      if (ender && alnum(tail) < 8 && red(head) !== head) continue;
      if (!/[0-9]|[A-Z][^A-Z]*[A-Z]/.test(tail) && (red(head) !== head || red(pre) !== pre)) continue;
      if (/^&#[0-9]+$/.test(piece) ? /^[0-9]/.test(tail) : /^&#x/i.test(piece) && !piece.endsWith(';') && /^[0-9A-Fa-f]/.test(tail)) continue; // the entity takes the digits after it (a written-down gap)
      const t = [w1, head + piece + tail, w2].join(sep);
      const out = red(t).replace(piece, '');
      const w = windows(tok, body).find((x) => out.includes(x));
      assert.ok(!w, `#1613 random cuts (case ${i}, ${fn} at ${c}): redact hides it (${JSON.stringify(w)} shown): ${JSON.stringify(t).slice(0, 90)}`);
      n++;
    }
    assert.ok(n > 1300, `#1613 random cuts: ${n} cases checked`);
  }

  // review of PR 1721, item 1: the review's desk inputs, through maskRaw
  for (const t of ['`' + GH.slice(0, 24) + '\n' + GH.slice(24) + '`', 'Rotated `password=hunter22`, new one ' + GH.slice(0, 12) + '\r\n' + GH.slice(12), '**' + GH.slice(0, 20) + '\r' + GH.slice(20) + '**']) {
    const m = ST.maskRaw(t, red);
    assert.ok(!windows(GH, 4).some((x) => m.replace(/\s/g, '').includes(x)), `#1613 review item 1: maskRaw hides a line-split token beside Markdown: ${JSON.stringify(m)}`);
  }
  // item 3: a token at the end of a long wrapped URL path (a left run of 300 token characters)
  {
    const t = 'https://h.example/' + 'abc/'.repeat(75) + GH.slice(0, 20) + '\n' + GH.slice(20);
    assert.ok(!red(t).includes(GH.slice(24, 32)) && !red(t).includes(GH.slice(4, 12)), `#1613 a token at the end of a long wrapped URL path: ${red(t).slice(-60)}`);
  }
  // item 4: a rule that hides the head first (a secret query name, a Bearer header) does not leave the tail
  for (const [what, got] of [
    ['maskSecretArgs, a query token split by LF', maskSecretArgs(['run', 'https://h.example/x?token=' + GH.slice(0, 20) + '\n' + GH.slice(20)], {}).join(' ')],
    ['maskSecretArgs, a query token split by a comment', maskSecretArgs(['run', 'https://h.example/x?token=' + GH.slice(0, 20) + '<!-- -->' + GH.slice(20)], {}).join(' ')],
    ['maskSecretUrl, a query token split by a comment', maskSecretUrl('https://h.example/x?token=' + GH.slice(0, 20) + '<!-- -->' + GH.slice(20), {})],
    ['maskSecretArgs, a name=value split by an entity', maskSecretArgs(['token=' + GH.slice(0, 20) + '&#8203;' + GH.slice(20)], {}).join(' ')],
    ['maskSecretCommand, a Bearer header split by LF', maskSecretCommand('echo Authorization: Bearer ' + GH.slice(0, 20) + '\n' + GH.slice(20), {})],
  ] as const) assert.ok(!got.includes(GH.slice(24, 32)) && !got.includes(GH.slice(28, 36)), `#1613 review item 4: ${what}: ${got}`);
  // item 7: text far from a split token stays byte for byte
  {
    const far = '\n\nsplit: ghp_' + B.slice(0, 10) + '\u200b' + B.slice(10, 36);
    for (const t of ['a /\\[redacted\\]/ b', "eq('mysql -p' + 'hunter2 -u root', 'x')"]) {
      const alone = red(t);
      const both = red(t + far);
      assert.strictEqual(both.slice(0, alone.length), alone, `#1613 review item 7: unrelated text stays as without the split token: ${JSON.stringify(t)}`);
      assert.ok(!both.includes(B.slice(10, 18)), '#1613 review item 7: the split token is hidden');
    }
  }
  // Paco's item 4: after a whole token, the next line is taken only when it is a token body's own characters
  assert.strictEqual(red(GH + '\nDATABASE_URL=postgres://db.example/app'), '[redacted]\nDATABASE_URL=postgres://db.example/app', '#1613 a whole token at a line end keeps a next line that is a name and a URL');
  assert.strictEqual(red(GH + '<br>DATABASE_URL=postgres://db.example/app'), '[redacted]<br>DATABASE_URL=postgres://db.example/app', '#1613 a whole token before a tag keeps a name and a URL after it');
  // round 2, item 2: the tail of a base64-bodied token after a whole head (a line break or a tag)
  {
    const b64 = B + 'a7B8c9D0e1F2g3H4i5J6k7L8m9N0o1P2q3R4s5T6u7V8w9X0y1Z2a3B4c5D6e7F8g9H0';
    const tail = 'Qr+St/Uv9Wx+Yz/0Ab1Cd2Ef==';
    for (const [what, t, rest] of [
      ['glc_', 'glc_' + b64.slice(0, 40) + '\n' + tail, tail], ['sntrys_', 'sntrys_' + b64.slice(0, 44) + '\n' + tail, tail], ['ABSK', 'ABSK' + b64.slice(0, 104) + '\n' + tail, tail],
      ['fm2_', 'fm2_' + b64.slice(0, 104) + '\n' + tail, tail], ['BBDC-', 'BBDC-' + b64.slice(0, 40) + '\n' + 'ab/cd+ef12/gh34ij56kl', 'ab/cd+ef12/gh34ij56kl'], ['glc_ after a tag', 'glc_' + b64.slice(0, 40) + '<wbr>' + tail, tail],
    ] as const) assert.ok(!red(t).includes(rest.slice(0, 8)) && !red(t).includes(rest.slice(-10)), `#1613 round 2: a base64 tail after a whole ${what} head is hidden: ${JSON.stringify(red(t))}`);
    for (const keep of ['DATABASE_URL=postgres://db.example/app', 'key=value', 'https://h.example/a', 'src/main/app.ts', '/usr/local/bin/node', 'abc1234'])
      assert.strictEqual(red(GH + '\n' + keep), '[redacted]\n' + keep, `#1613 round 2: a whole token at a line end keeps a next line ${JSON.stringify(keep)}`);
  }
  // round 2, item 3: a word, a tag that renders a break, then a split token
  for (const t of ['<p>Token</p><p>' + GH.slice(0, 16) + '<wbr>' + GH.slice(16) + '</p>', 'word<br>' + GH.slice(0, 16) + '<!-- -->' + GH.slice(16), '<td>name</td><td>' + GH.slice(0, 16) + '\u200b' + GH.slice(16) + '</td>', 'key<br>sk-proj-' + B.slice(0, 20) + '<wbr>' + B.slice(20, 48)]) {
    for (const [surface, out] of [['redact', red(t)], ['maskRaw', ST.maskRaw(t, red)], ['excerpt', ST.excerpt(t, red)], ['card', LA.permText('echo ' + t, 'shell', cm).text]] as const)
      assert.ok(![GH.slice(20, 28), GH.slice(30, 38), B.slice(24, 32)].some((x) => out.includes(x)), `#1613 round 2: a word and a break tag before a split token (${surface}): ${JSON.stringify(out)}`);
  }
  assert.strictEqual(red('Token<br>ghp_' + B.slice(0, 36)), 'Token<br>[redacted]', '#1613 round 2: a word, a break tag, then a whole token');
  // round 2, item 4: after a whole token, no tail across a blank line, an indentation or a quote mark
  for (const [t, want] of [[GH + '\n\nAlternatively, use SSH.', '[redacted]\n\nAlternatively, use SSH.'], [GH + '\n\n    implementation detail', '[redacted]\n\n    implementation detail'], [GH + '\r\n\r\nAlternatively', '[redacted]\r\n\r\nAlternatively'], [GH + '\n> Afterwards we rotate it', '[redacted]\n> Afterwards we rotate it']] as const)
    assert.strictEqual(red(t), want, `#1613 round 2: a whole token keeps the word after a blank line or a quote mark: ${JSON.stringify(t.slice(40))}`);
  // round 2 (fjcabello): the helper-name step keeps a leading mark and the blanks, and drops a link and emphasis
  assert.strictEqual(ST.plainMarks('#1613 split  tokens'), '#1613 split  tokens', '#1613 round 2: plainMarks keeps a leading # and the blanks');
  assert.strictEqual(ST.plainMarks('- **Hx** [click](https://evil.example/x) `c`'), '- Hx click c', '#1613 round 2: plainMarks drops a link, emphasis and code marks');
  // round 3 (owner decision): across a blank line or a quote, list, heading or table mark, a whole token's tail with a letter and a digit goes; words stay; a git sha there is masked (written down)
  {
    const pat = 'github_pat_' + B.slice(0, 22) + '_' + (B + B).slice(5, 32);
    const tail31 = 'Q9w8E7r6T5y4U3i2O1p0A9s8D7f6G5h';
    for (const sep of ['\n\n', '\r\n\r\n', '\n> ', '\n- ', '\n| ']) {
      const out = red(pat + sep + tail31);
      assert.ok(!out.includes(tail31.slice(0, 8)) && !out.includes(tail31.slice(-8)), `#1613 round 3: a whole token's tail with a letter and a digit after ${JSON.stringify(sep)} is hidden: ${JSON.stringify(out)}`);
    }
    for (const word of ['Alternatively, use SSH.', '> Note: rotate it', '## Step 2', '- item2', 'Documentation'])
      assert.strictEqual(red(GH + '\n\n' + word), '[redacted]\n\n' + word, `#1613 round 3: a word after a whole token and a blank line stays: ${JSON.stringify(word)}`);
    const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
    assert.strictEqual(red(GH + '\n\n' + sha), '[redacted]\n\n[redacted]', '#1613 round 3: a git sha after a whole token and a blank line is masked (the written-down over-mask)');
  }
  // round 3 (review of PR 1721), item 1: a hidden piece after a whole token leaves the next keyword to its rule; the value stays hidden
  {
    const PW = 'Hx9Kq2Lm7Np4Rs';
    for (const piece of ['\u200b', '\u2028', '\u00ad', '\u0301', '&#8203;', '<b></b>', '\n', '\r\n'])
      for (const form of ['mysql -u root -p' + PW, 'mysql -p' + PW, 'password=' + PW, 'token: ' + PW, 'PGPASSWORD=' + PW, '--password ' + PW]) {
        // `--password <value>` is a flag rule of the command masks only (redact shows it on main too), and a flag glued to a token in one word is no flag (as on main)
        if (form.startsWith('--') && !/[\r\n]/.test(piece)) continue;
        const t = GH + piece + form;
        const surfaces: Array<[string, string]> = form.startsWith('--') ? [['cmd', maskSecretCommand('echo ' + t, {})], ['args', maskSecretArgs(['run', t], {}).join(' ')]] : [['redact', red(t)], ['cmd', maskSecretCommand('echo ' + t, {})], ['args', maskSecretArgs(['run', t], {}).join(' ')], ['excerpt', ST.excerpt(t, red)], ['maskRaw', ST.maskRaw(t, red)]];
        for (const [surface, out] of surfaces)
          assert.ok(!out.includes(PW) && !out.includes(GH.slice(8, 16)), `#1613 round 3: a keyword after a whole token and ${JSON.stringify(piece)} keeps its value hidden (${surface}): ${JSON.stringify(out)}`);
      }
    const t = 'glpat-' + B.slice(0, 20) + '\u200b' + 'curl -u bob:' + PW + ' h';
    assert.ok(!red(t).includes(PW), `#1613 round 3: curl -u after a whole token and a hidden character: ${red(t)}`);
  }
  // round 4 (fjcabello), item 1: an all-capitals keyword after a hidden piece after a whole token is a keyword, not the token's tail: its own rule still reads it
  {
    const PW = 'Hx9Kq2Lm7Np4Rs';
    let own = 0;
    for (const kw of ['TOKEN', 'APIKEY', 'API_KEY', 'AWS_SECRET_ACCESS_KEY', 'MYSQL', 'PASSWORD'])
      for (const form of [kw + ' ' + PW, kw + '=' + PW, kw + ': ' + PW, kw + ' -u root -p' + PW])
        for (const piece of ['\u200d', '\u200b', '\u0301', '&#8203;', '\u00ad']) {
          if (red(form).includes(PW)) continue; // the keyword's own rule does not hide this form: nothing to keep
          own++;
          const out = red(GH + piece + form);
          assert.ok(!out.includes(PW), `#1613 round 4: an all-capitals keyword after a whole token and ${JSON.stringify(piece)} keeps its rule: ${JSON.stringify(out)}`);
        }
    assert.ok(own >= 30, `#1613 round 4: the all-capitals table reaches the forms its rules hide (${own})`);
  }
  // round 4 (Opus 1, 3, 6): a name then `=` is no tail; the tail stops at a character that is no body character; FR-173's count after a hidden character
  {
    const PW = 'Hx9Kq2Lm7Np4Rs';
    for (const sep of ['\n', '\n\n', '\n> ', '\u200b'])
      assert.strictEqual(red(GH + sep + 'Db_Password="' + PW + '"'), '[redacted]' + sep + 'Db_Password="[redacted]"', `#1613 round 4: a name then = after a whole token and ${JSON.stringify(sep)} keeps the name`);
    const o = red('ghp_' + B.slice(0, 24) + '\u200b' + B.slice(24, 36) + ':x-oauth-basic');
    assert.ok(!o.includes(B.slice(26, 34)), `#1613 round 4: the tail before a character that is no body character is hidden: ${JSON.stringify(o)}`);
    const six = red('ghp_' + B.slice(0, 30) + '\u200b' + B.slice(30, 36));
    assert.ok(!six.includes(B.slice(30, 36)), `#1613 round 4: a 6-character tail after a hidden character is hidden: ${JSON.stringify(six)}`);
  }
  // round 4: the keyword after a hidden piece stays visible as a keyword (the union would hide its value anyway; these pin that the split step does not take it)
  {
    const PW = 'Hx9Kq2Lm7Np4Rs';
    assert.strictEqual(red(GH + '\u200bTOKEN ' + PW), '[redacted]\u200bTOKEN [redacted]', '#1613 round 4: an all-capitals keyword after a whole token stays a keyword');
    assert.strictEqual(red(GH + '\u200bAPI_KEY=' + PW), '[redacted]\u200bAPI_KEY=[redacted]', '#1613 round 4: an all-capitals name after a whole token stays a name');
    assert.strictEqual(red('ghp_' + B.slice(0, 18) + '\u200b' + B.slice(18, 36) + '<br>mysql -p' + PW), '[redacted]<br>mysql -p[redacted]', '#1613 round 4: a keyword after a split token stays a keyword');
  }
  // round 5 (fjcabello): keepShownBy compares whole words, whatever they are made of; an all-capitals tail of 8 or more without a secret-name word is a tail
  assert.strictEqual(keepShownBy('--password ab!cd#ef', '--password [redacted]'), '--password [redacted]', '#1613 round 5: keepShownBy masks a word of symbols the reference hides');
  assert.strictEqual(keepShownBy('a [redacted]x9', 'a [redacted]'), 'a [redacted][redacted]', '#1613 round 5: keepShownBy masks a short rest glued to a mask');
  assert.strictEqual(keepShownBy('see [redacted] more', 'see ghp_x more'), 'see [redacted] more', '#1613 round 5: keepShownBy keeps a word of masks only');
  for (const t of ['token: AKIAABQ6<b></b>AGAQWSONVRMK', 'AKIAABQ6\u200bAGAQWSONVRMK here', 'see AKIAABQ6<!-- -->AGAQWSONVRMK'])
    assert.ok(!red(t).includes('AGAQWSON'), `#1613 round 5: an all-capitals tail of 8 or more is hidden: ${JSON.stringify(red(t))}`);
  assert.strictEqual(red(GH + '\u200bAWS_SECRET_ACCESS_KEY is set'), '[redacted]\u200bAWS_SECRET_ACCESS_KEY is set', '#1613 round 5: an all-capitals run holding a secret-name word stays a keyword');
  // round 5 (Opus): the pieces of keepShownBy, the union, the reading as before, the review's repros
  {
    const PW2 = 'Ab3,Cd5#Ef7^Gh9';
    assert.strictEqual(keepShownBy('PGPASSWORD=' + PW2 + ' psql', 'PGPASSWORD=[redacted] psql'), '[redacted] psql', '#1613 round 5: keepShownBy masks a piece the reference does not show whole (fail closed) and keeps the ones it shows');
    assert.strictEqual(_unionMasksForTest('a b c', 'a [redacted] c', '[redacted] b c'), '[redacted] [redacted] c', '#1613 round 5: the union hides what either reading hides');
    assert.strictEqual(_unionMasksForTest('a b c', '[redacted] b c', '[redacted] b c'), '[redacted] b c', '#1613 round 5: the union of one reading is that reading');
    const split = GH.slice(0, 16) + '\u200b' + GH.slice(16);
    assert.ok(withoutSplit(() => red(split)).includes(GH.slice(20, 28)), '#1613 round 5: withoutSplit reads as before PR 1721 (a split token shows)');
    assert.ok(!red(split).includes(GH.slice(20, 28)), '#1613 round 5: outside withoutSplit the split token is hidden');
    const cmd = maskSecretCommand('echo ghp_' + B.slice(0, 18) + '\u200b' + B.slice(18, 36) + '.`\u200bPGPASSWORD=' + PW2 + ' psql', {});
    assert.ok(!cmd.includes(PW2) && !cmd.includes(B.slice(20, 28)), `#1613 round 5: a punctuated password after a split token in a command is hidden: ${JSON.stringify(cmd)}`);
    const link = '[gh](https://h.example/' + 'a'.repeat(2100) + ')p_' + B.slice(0, 36);
    for (const [surface, out] of [['maskRaw', ST.maskRaw(link, red)], ['excerpt', ST.excerpt(link, red)]] as const)
      assert.ok(!out.includes(B.slice(8, 16)), `#1613 round 5: a token glued after a long link is hidden (${surface}): ${out.slice(-60)}`);
    const bearer = red('Authorization: Bearer AKIAQVA\nFPZLDTBSLGUEC');
    assert.ok(!bearer.includes('FPZLDTBS'), `#1613 round 5: an all-capitals tail after a header-hidden head is hidden: ${JSON.stringify(bearer)}`);
  }
  // round 6: the desk bounds its split-aware reading (DESK_SPLIT_MAX, 16,384 characters); timing-free, by the split step's own work counter
  {
    const dense = (n: number) => Array.from({ length: Math.ceil(n / 60) }, (_, i) => 'see ghp_' + B.slice(0, 12) + '\u200b' + B.slice(12, 36) + ' and password=x' + i + 'yz9 <b>w</b>').join('\n').slice(0, n);
    const big = dense(800000);
    _splitWorkForTest();
    const ex = ST.excerpt(big, red);
    const exWork = _splitWorkForTest();
    assert.ok(exWork > 0 && exWork <= 12 * 16384, `#1613 round 6: the desk excerpt reads at most a fixed multiple of 16,384 characters with the split step (${exWork})`);
    assert.ok(!ex.includes(B.slice(16, 24)) && ex.startsWith('see [redacted] and password=[redacted]'), `#1613 round 6: the excerpt of a long text still hides its first split token: ${ex.slice(0, 80)}`);
    ST.maskRaw(big, red);
    assert.strictEqual(_splitWorkForTest(), 0, '#1613 round 6: maskRaw of a text over the bound reads it as before PR 1721 (no split work)');
    // round 7: the window ends at the last blank before the bound, so a token split by an in-line piece across the bound is left out whole (not its first half)
    const pad = 'x '.repeat(8190);
    const edge = pad + 'ghp_' + B.slice(0, 10) + '<!-- -->' + B.slice(10, 36) + ' ' + 'tail '.repeat(4000);
    const ee = ST.excerpt(edge, red);
    assert.ok(![B.slice(0, 8), B.slice(12, 20)].some((x) => ee.includes(x)), '#1613 round 7: a token split by an in-line piece across the bound shows neither half');
    // round 7: the window is taken after closed code blocks and link targets, so a long one at the start no longer eats what the excerpt shows
    for (const lead of ['```\n' + 'c'.repeat(17000) + '\n```\n', '[see](https://h.example/' + 'a'.repeat(17000) + ') '])
      assert.ok(ST.excerpt(lead + 'The fix is ready.', red).includes('The fix is ready'), `#1613 round 7: the excerpt after a long ${lead[0] === '`' ? 'code block' : 'link target'} still shows the text after it`);
    // round 7: the exact bound, the window end, a surrogate pair at the bound
    const M = ST.DESK_SPLIT_MAX;
    assert.strictEqual(M, 16384, '#1613 round 7: the desk bound is 16,384 characters');
    const exact = 'ab '.repeat(6000).slice(0, M);
    assert.strictEqual(ST._deskWindowForTest(exact), exact, '#1613 round 7: a text of exactly the bound is read whole');
    const over = 'ab '.repeat(6000).slice(0, M + 1);
    const wo = ST._deskWindowForTest(over);
    assert.ok(wo !== over && wo.length <= M && wo.length > M - 8 && over.startsWith(wo) && /\s$/.test(wo), `#1613 round 7: one character over the bound, the window ends at the last blank within it (${wo.length})`);
    assert.strictEqual(ST._deskWindowForTest('a'.repeat(M + 1)), '', '#1613 round 7: with no blank, the token characters the bound cut into are left out');
    // round 8: a line break is a piece too: the window ends at a space or a tab, and a line break among the blanks before its end drops the word before it
    for (const brk of ['\n', '\n    ', '\r\n\t', '\n> '])
      assert.ok(!ST._deskWindowForTest('x '.repeat(8180) + 'ghp_' + B.slice(0, 10) + brk + B.slice(10, 36) + ' ' + 'tail '.repeat(100)).includes('ghp_'), `#1613 round 8: a token split by ${JSON.stringify(brk)} across the bound is left out of the window whole`);
    const ws = 'a'.repeat(M) + ' ';
    assert.ok(ws.length === M + 1 && ST._deskWindowForTest(ws).length <= M, '#1613 round 8: a text of 16,385 characters with a blank at index 16,384 gives a window within the bound');
    // round 10: the window ends at the last white space before the bound, then before any split span that crosses it (the shared splitSafeCut): a split
    // token is whole in the window or not in it at all, and nothing else goes. The bound in the second half, or the token ending 1 to 20 characters before it
    // with a keyword across the bound, behind fillers of spaces, tabs only and each line break alone
    {
      const toks: Array<[string, string]> = [['ghp_' + B.slice(0, 10), B.slice(10, 36)], ['AKIAQ7WE9RT1', 'YU3IO5PA']];
      const lc = '<a' + 'b'.repeat(63) + ' ' + 'k="v" '.repeat(43).slice(0, 255) + '>';
      const brks = ['\n', ' \n', '  \n', '\t\n', '\r\n', '\r', '\n\n', '**\n', ' ', ' ', '\f', '\v', '\n    ', '\r    ', '\r> ', '\r\t', '\n> ', '\n1. ', '\n2) ', '\n[x] ', '\n- [x] ', '\n- [ ] ', '\n# ',
        '\n​ ', '<span class="a" id="b">', '<!-- a note -->', '<!-- -->', '<!-- a > b c -->', '<!-- a < b c -->', '<!--' + 'c '.repeat(128) + '-->', '<!--' + ' '.repeat(120) + '-->', lc];
      const mustHide = ['\n', ' \n', '  \n', '\t\n', '\r\n', '\r', '\n\n', '\n    ', '\n> ', '\n1. ', '\n[x] ', '\n- [x] ', '<span class="a" id="b">', '<!-- a note -->', '<!-- a > b c -->', '<!-- a < b c -->', '<!--' + 'c '.repeat(128) + '-->', lc];
      const fills = ['x ', 'x\t', 'x\n', 'x\r\n', 'x\r', 'x ', 'x\f', 'x\v'];
      const pres = ['', 'a > b ', '<b>x</b> '];
      let checked = 0;
      for (const [h1, h2] of toks)
        for (const brk of brks) {
          if (mustHide.includes(brk)) assert.ok(!red('see ' + h1 + brk + h2 + ' now').includes(h1), `#1613 round 10: the split step hides ${h1.slice(0, 4)} split by ${JSON.stringify(brk.slice(0, 20))}`);
          for (const fill of fills)
            for (const pre of pres)
              // off > 0: the bound that many characters into the second half; off < 0: the token ends -off characters before it, the keyword across it
              for (const off of [1, 5, 7, -1, -4, -9, -20]) {
                if (off > 0 && off >= h2.length) continue;
                const sep = fill.slice(1), lead = pre + h1 + brk;
                const after = off > 0 ? h2 + sep + 'tail' : h2 + ' --password Zq9Kq2Lm7Np4Rs' + sep + 'tail';
                const k = Math.floor((M - 600 - lead.length) / fill.length);
                const v = M - (off > 0 ? off : -off - h2.length) - lead.length - sep.length - k * fill.length;
                const t = 'w'.repeat(v) + sep + fill.repeat(k) + lead + after + (sep + 'tail').repeat(200);
                const w = ST._deskWindowForTest(t);
                const whole = h1 + brk + h2;
                // what the reading without a bound hides here (the split step on the text around the token: a filler of hidden characters glues it to its neighbours)
                const p0 = v + sep.length + k * fill.length;
                const hides = !maskSplitTokens(t.slice(p0 - 1024, p0 + 1024)).includes(h1);
                const ok = t.startsWith(w) && w.length > M - 64 - lead.length && (!hides || !w.includes(h1) || w.includes(whole));
                if (hides) checked++;
                assert.ok(ok, `#1613 round 10: a token split by ${JSON.stringify(brk.slice(0, 24))} (${off > 0 ? off + ' into its second half' : -off + ' before the bound'}, filler ${JSON.stringify(fill)}, before it ${JSON.stringify(pre)}) is whole in the window or not in it, the rest kept (${w.length}): ${JSON.stringify(w.slice(-50))}`);
              }
        }
      assert.ok(checked > 3000, `#1613 round 10: the cases the split step hides are checked (${checked})`);
      // the exact bound: a blank at index 16,384 is past the bound (the window ends before the 'y' at 16,383)
      assert.strictEqual(ST._deskWindowForTest('a' + 'y '.repeat(M / 2) + 'z '.repeat(10)).length, M - 1, '#1613 round 10: the window counts back from character 16,384');
      assert.strictEqual(ST._deskWindowForTest('a.b'.repeat(6000)), 'a.b'.repeat(6000).slice(0, M).replace(/[a.b]+$/, ''), '#1613 round 10: no white space at all: the token characters the bound cut into go');
      const json = '{"a":1,"b":[2,3]},'.repeat(1200);
      assert.strictEqual(ST._deskWindowForTest(json), json.slice(0, M).replace(/[A-Za-z0-9_\-.~+\/=:@%]+$/, ''), '#1613 round 10: no white space at all (a minified line): only the token characters the bound cut into go');
      // mark-heavy text keeps its window (round 9's mark walk emptied these)
      for (const t of ['Summary of the work here\n' + '- - - - - - - - - -\n'.repeat(1200), 'Report: ok\n' + '---\n'.repeat(5000), 'Note ' + '> '.repeat(9000), 'Steps\n' + '1. \n'.repeat(5000), 'a'.repeat(16300) + ' b'.repeat(100), '-\n'.repeat(M / 2 + 10)]) {
        const w = ST._deskWindowForTest(t);
        assert.ok(w.length > M - 8 && t.startsWith(w), `#1613 round 10: mark-heavy text keeps its window (${w.length}): ${JSON.stringify(t.slice(0, 24))}`);
      }
      // linear: one walk back (each character at most once) and at most 2 x 512 + 16 characters of split work
      for (const t of ['a'.repeat(15000) + ' ' + 'b'.repeat(1000) + '\n  ' + 'c'.repeat(2000), 'x'.repeat(M + 10), ('q'.repeat(4000) + '\n').repeat(5), 'a '.repeat(9000), ('see ghp_' + B.slice(0, 12) + '\n' + B.slice(12, 36) + ' ').repeat(500)]) {
        ST._deskWindowStepsForTest();
        _splitWorkForTest();
        ST._deskWindowForTest(t);
        const steps = ST._deskWindowStepsForTest(), work = _splitWorkForTest();
        // round 11: the read takes whole runs at both ends: at most cut + 528 + 16,384 characters, about 2 x 512 on text with blanks
        assert.ok(steps <= M && work <= M + 528 + 16384 && (!/^(?:a |see )/.test(t) || work <= 2 * 512 + 16 + 160), `#1613 round 10: the window's walk back is linear (${steps} steps, ${work} characters of split work)`);
      }
    }
    // round 11: a token longer than the 512-character neighbourhood, split near the cut, is read from its start: whole in the window or not in it
    {
      const al = (n: number, salt: number) => Array.from({ length: n }, (_, i) => B[(i * 7 + salt) % B.length]).join('');
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + al(900, 1) + '.' + al(44, 3);
      const gh = 'ghp_' + al(962, 5);
      let checked = 0;
      for (const tok of [jwt, gh])
        for (const brk of ['\n', ' ', '\t', ' '])
          for (const p of [266, 700]) {
            const split = tok.slice(0, p) + brk + tok.slice(p);
            const frag = tok.slice(p - 20, p);
            if (tok === jwt && brk === '\n') assert.ok(!red('see ' + split + ' now').includes(frag), `#1613 round 11: the split step hides a long JWT split by a line break at ${p}`);
            for (let d = -20; d < 20; d++) {
              const p0 = M - p - d; // the token starts here; the bound lies d characters after the break
              const lead = ('x '.repeat(p0)).slice(0, p0 - 1) + ' ';
              const t = lead + split + ' ' + 'tail '.repeat(300);
              const w = ST._deskWindowForTest(t);
              const hides = !maskSplitTokens(t.slice(p0 - 1024, p0 + split.length + 1024)).includes(frag);
              if (hides) checked++;
              assert.ok(t.startsWith(w) && (!hides || !w.includes(frag) || w.includes(split)), `#1613 round 11: a ${tok.slice(0, 4)} token of ${tok.length} characters split by ${JSON.stringify(brk)} at ${p}, the bound ${d} after the break, is whole in the window or not in it (${w.length})`);
            }
          }
      assert.ok(checked >= 40, `#1613 round 11: the long-token cases the split step hides are checked (${checked})`);
      // a run past the right cap cannot be read whole: the cut fails closed to the start of the run that holds cut - 512
      // round 12: a run longer than the cap past the cut is read up to the cap: the window keeps everything to the cut (round 11 dropped 512 more)
      assert.strictEqual(ST._deskWindowForTest('x '.repeat(8190) + 'q'.repeat(40000)).length, M - 4, '#1613 round 12: a run longer than the cap past the cut keeps the window to the cut');
      const sentence = 'The build passed and the report is attached below.';
      const b64 = al(40000, 11);
      for (const t of [sentence + '\n' + b64, sentence + '\r\n' + b64]) {
        assert.ok(ST._deskWindowForTest(t).startsWith(sentence), '#1613 round 12: a sentence, a line break and a 40,000-character run keep the sentence in the window');
        assert.ok(ST.excerpt(t, red).includes('The build passed and the report is attached'), `#1613 round 12: ... and in the excerpt: ${JSON.stringify(ST.excerpt(t, red).slice(0, 80))}`);
      }
      const mini = 'console.log(1)\n' + 'var a={"k":1,"b":[2,3]};'.repeat(2000);
      assert.ok(ST._deskWindowForTest(mini).startsWith('console.log(1)\n'), '#1613 round 12: a minified line with one line break keeps its first line');
      // a 3,000-character JWT split 100 characters in, the bound in the 40 positions after the break: its second half runs about 2,900 characters past the cut
      const big = 'eyJhbGciOiJIUzI1NiJ9.' + al(2935, 13) + '.' + al(44, 17);
      const bigSplit = big.slice(0, 100) + '\n' + big.slice(100);
      assert.ok(!red('see ' + bigSplit + ' now').includes(big.slice(80, 100)), '#1613 round 12: the split step hides a 3,000-character JWT split by a line break');
      for (let d = 1; d <= 40; d++) {
        const p0 = M - 100 - d;
        const t = ('x '.repeat(p0)).slice(0, p0 - 1) + ' ' + bigSplit + ' ' + 'tail '.repeat(100);
        const w = ST._deskWindowForTest(t);
        assert.ok(!w.includes(big.slice(80, 100)) || w.includes(bigSplit), `#1613 round 12: a 3,000-character JWT split by a line break, the bound ${d} after it, is whole in the window or not in it (${w.length})`);
      }
    }
    // round 8: a label with no split token and no hidden character reads once, as before PR 1721 (one call of the mask handed in)
    for (const lab of ['echo hello world', 'echo ' + GH, 'ls -la /tmp']) {
      let calls = 0;
      const out = ST.maskLabel(lab, 'run', { ...cm, cmd: (x: string) => { calls++; return maskSecretCommand(x, {}); } });
      assert.ok(calls === 1 && out === withoutSplit(() => ST.maskLabel(lab, 'run', cm)), `#1613 round 8: a plain label is read once and as before (${calls} calls): ${out}`);
    }
    // round 10: an escaped label's escaped copy is read with its own split step, not the label's (exact output: the escaped word stays as written)
    for (const [lab, kind, want] of [['cat a\\_b AKIAQ7WE9RT1\nYU3IO5PA', 'other', 'cat a\\_b [redacted]\n[redacted]'], ['cat a\\_b AKIAQ7WE9RT1\nYU3IO5PA', 'run', 'cat a\\_b [redacted] [redacted]'],
      ['see a\\_b.md and ghp_' + B.slice(0, 12) + '​' + B.slice(12, 36), 'other', 'see a\\_b.md and [redacted]'], ['see a\\_b.md and ghp_' + B.slice(0, 12) + '​' + B.slice(12, 36), 'run', 'see a\\_b.md and [redacted]']] as const)
      assert.strictEqual(ST.maskLabel(lab, kind, cm), want, `#1613 round 10: an escaped label is masked exactly (${kind})`);
    // round 9: the shortcut needs both checks: a label with a hidden character but no split token reads both ways (the reading as before shows these)
    for (const lab of [GH + '\u200b' + 'password=Hx9Kq2Lm7Np4Rs', 'note' + GH + '\u200b' + 'password=Hx9Kq2Lm7Np4Rs'])
      for (const kind of ['other', 'run']) {
        const out = ST.maskLabel(lab, kind, cm);
        assert.ok(out !== '' && !out.includes('Hx9Kq2Lm7Np4Rs') && !out.includes(GH.slice(8, 16)), `#1613 round 9: a label with a hidden character and no split token is read both ways (${kind}): ${JSON.stringify(out)}`);
      }
    const straddle = 'x '.repeat(8180) + 'ghp_' + B.slice(0, 10) + '<!-- -->' + B.slice(10, 36) + ' ' + 'tail '.repeat(100);
    assert.ok(!ST._deskWindowForTest(straddle).includes('ghp_'), '#1613 round 7: a token split by an in-line piece just before the bound is left out of the window whole');
    const sur = ST._deskWindowForTest('a'.repeat(M - 1) + '\u{1F600}' + 'b'.repeat(10));
    assert.ok(!/[\ud800-\udbff]$/.test(sur), '#1613 round 7: the window never ends with half a surrogate pair');
    const splitAt = (n: number) => { const tok = 'ghp_' + B.slice(0, 12) + '\u200b' + B.slice(12, 36); return ('w '.repeat(n)).slice(0, n - tok.length - 1) + ' ' + tok; };
    _splitWorkForTest();
    ST.maskRaw(splitAt(M), red);
    assert.ok(_splitWorkForTest() > 0, '#1613 round 7: maskRaw of a text of exactly the bound reads it with the split step');
    ST.maskRaw(splitAt(M + 1), red);
    assert.strictEqual(_splitWorkForTest(), 0, '#1613 round 7: maskRaw of a text one character over the bound reads it as before PR 1721');
    // round 7: a label the old masks blank (fail closed) is blank here too
    const lab = 'echo - npm_' + B.slice(0, 14) + '\\_' + B.slice(14, 36) + '\u2028sk_live_7d1\u00ad' + B.slice(0, 21);
    assert.strictEqual(ST.maskLabel(lab, 'run', cm), '', '#1613 round 7: a label the old masks blank (fail closed) stays blank');
  }
  // round 4, item 2: a token right after an entity without its ';' (the entity's digits take its start boundary as written)
  for (const t of ['password=&#8203' + GH, 'see &#x200B' + GH + ' here'])
    assert.ok(!red(t).includes(GH.slice(8, 16)) && !red(t).includes(GH.slice(30, 38)), `#1613 round 4: a token right after an entity without ; is hidden: ${JSON.stringify(red(t))}`);
  // round 4, item 3: the tool phrase masks the label as written too (clearing an invisible character glues two whole tokens into one run)
  {
    const LAp = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as { phrase(o: { kind: string; tool: string; label: string }, m: Record<string, (s: string) => string>): string };
    const GH2 = 'gho_' + B.slice(0, 36);
    for (const kind of ['run', 'read', 'tool']) {
      const out = LAp.phrase({ kind, tool: 'Bash', label: GH + '\u200b' + GH2 }, cm);
      assert.ok(![GH.slice(8, 16), GH.slice(30, 38), GH2.slice(8, 16), GH2.slice(30, 38)].some((x) => out.includes(x)), `#1613 round 4: the tool phrase hides two tokens joined by an invisible character (${kind}): ${JSON.stringify(out)}`);
    }
  }
  // item 2: the desk keeps what both readings hide (a hidden character glues a token to the word before it)
  for (const lead of ['\u2028', '\u200b', '\u00ad']) {
    for (const t of ['see page2' + lead + GH + '<br>glpat-' + B.slice(0, 13) + '&#8203;' + B.slice(13, 20), 'note' + lead + GH + ' AKIAQ7R2S9' + '<b></b>' + 'T4U1V6W3X8'])
      for (const [surface, out] of [['excerpt', ST.excerpt(t, red)], ['maskRaw', ST.maskRaw(t, red)], ['maskLabel', ST.maskLabel(t, 'other', cm)]] as const)
        assert.ok(!out.includes(GH.slice(8, 16)) && !out.includes(GH.slice(30, 38)), `#1613 round 3: the desk keeps a token glued by ${JSON.stringify(lead)} hidden (${surface}): ${JSON.stringify(out)}`);
  }
  // item 3: a long head already hidden, then a blank line, a quote, a list or a strike mark: the tail with a digit goes
  for (const sep of ['\n> ', '\n\n', '\r\n> ', '~~\n~~', '**\n**', '\n- ', '\n1. ', '\n| ', '\n## ', '\n- [ ] ']) {
    const out = red('ghp_' + B.slice(0, 20) + sep + B.slice(20, 36));
    assert.ok(!out.includes(B.slice(24, 32)), `#1613 round 3: a long head, ${JSON.stringify(sep)}, then the tail: ${JSON.stringify(out)}`);
  }
  // item 4: a lower-case path or branch after a whole token stays
  for (const [t, want] of [[GH + '<br>src/renderer/app', '[redacted]<br>src/renderer/app'], [GH + '<wbr>feature/new-login', '[redacted]<wbr>feature/new-login'], [GH + '\nsome/path/to/file', '[redacted]\nsome/path/to/file'], [GH + '\nabcdefgh/ijklmnop', '[redacted]\nabcdefgh/ijklmnop']] as const)
    assert.strictEqual(red(t), want, `#1613 round 3: a lower-case path after a whole token stays: ${JSON.stringify(t.slice(40))}`);
  // item 5: the blank reading of a break tag reads token shapes only (no name and value of its own)
  assert.strictEqual(red('Token:<br/>\u2764\ufe0f' + 'ghp_' + B.slice(0, 13) + '<hr>' + B.slice(13, 36)), 'Token:<br/>\u2764\ufe0f[redacted]', '#1613 round 3: the blank reading keeps an emoji before a split token');
  // item 7: other block tags read as a blank
  for (const t of ['<li>Token</li><li>' + GH.slice(0, 16) + '<wbr>' + GH.slice(16) + '</li>', '<h2>Token</h2><div>' + GH.slice(0, 16) + '<!-- -->' + GH.slice(16) + '</div>', '<tr><td>a</td></tr><tr><td>' + GH.slice(0, 16) + '\u200b' + GH.slice(16)])
    assert.ok(!red(t).includes(GH.slice(20, 28)), `#1613 round 3: li, h2, div and tr read as a blank: ${JSON.stringify(red(t))}`);
  assert.strictEqual(ST.plainMarks('see [doc](https://h.example/a b) and [x](u(1))'), 'see doc and x)', '#1613 round 5: plainMarks reads links as the old regex did (a blank in the target; the first ) ends it)');
  // round 2, item 5: the blanks and quote marks between the two pieces stay as written
  assert.strictEqual(red('x ' + GH.slice(0, 16) + '\n    ' + GH.slice(16) + ' y'), 'x [redacted]\n    [redacted] y', '#1613 round 2: the indentation between two pieces stays');
  assert.strictEqual(red('x ' + GH.slice(0, 16) + '\n> ' + GH.slice(16) + ' y'), 'x [redacted]\n> [redacted] y', '#1613 round 2: the quote mark between two pieces stays');
  // item 8: each guard pinned
  assert.strictEqual(red(GH.slice(0, 16) + '\u2028' + GH.slice(16)), '[redacted]\u2028[redacted]', '#1613 a line separator inside a token stays in the output');
  // spec 012 FR-185: the GitHub head before the entity is a cut token now and is hidden; the guard still keeps the entity and the rest as written
  for (const ent of ['&#38;', '&amp;']) assert.strictEqual(red('ghp_' + B.slice(0, 12) + ent + B.slice(12, 36)), '[redacted]' + ent + B.slice(12, 36), `#1329 cut head before an entity: hidden, the #1613 guard keeps the entity and the rest: ${ent}`);
  for (const keep of ['sgp_CrossValidation_ResultsForThe_Model\nsbp_Final2']) assert.strictEqual(red(keep), keep, `#1613 a guard keeps it readable: ${JSON.stringify(keep)}`);
  _breakCallsForTest();
  red(Array.from({ length: 200 }, (_, i) => 'Some words on line ' + i + ' and more words\nanother line of words here').join('\n'));
  red(Array.from({ length: 200 }, (_, i) => 'ab' + (i % 10) + '\ncd' + (i % 7)).join(' '));
  assert.strictEqual(_breakCallsForTest(), 0, '#1613 prose lines and short pieces cost no line-break mask call');

  // growth: linear in the text
  const split = (k: number) => Array.from({ length: Math.ceil(k / 50) }, (_, i) => 'ghp_' + String(i).padStart(12, 'Q') + '\r\n' + 'R'.repeat(24)).join(' ').slice(0, k);
  assertLinearShape('#1613 redact many tokens split by a line break', (x) => { redact(x, {}); }, split, 400_000);
  assertLinearShape('#1613 redact many joined line breaks', (x) => { redact(x, {}); }, (k) => 'ab_12345678\n'.repeat(Math.ceil(k / 12)).slice(0, k), 400_000);
  assertLinearShape('#1613 redact many tags and comments', (x) => { redact(x, {}); }, (k) => 'a1<b></b>b2<!-- -->'.repeat(Math.ceil(k / 19)).slice(0, k), 400_000);
  assertLinearShape('#1613 redact many unclosed comments', (x) => { redact(x, {}); }, (k) => 'x<!--'.repeat(Math.ceil(k / 5)).slice(0, k), 400_000);
  assertLinearShape('#1613 redact one long run with line breaks', (x) => { redact(x, {}); }, (k) => ('Ab1_'.repeat(70) + '\n').repeat(Math.ceil(k / 281)).slice(0, k), 400_000);
  assertLinearShape('#1613 redact many indented and quoted line breaks', (x) => { redact(x, {}); }, (k) => 'ab_123456\n\n  > cd_789012'.repeat(Math.ceil(k / 24)).slice(0, k), 400_000);
  // issue #1725 (round 3): the desk's plainKeep link regex is bounded, so a reply of many `[` or `[x](` is linear
  assertLinearShape('#1725 the desk excerpt of many [', (x) => { ST.excerpt(x, red); }, (k) => '['.repeat(k), 80_000);
  assertLinearShape('#1725 the desk excerpt of many [x](', (x) => { ST.excerpt(x, red); }, (k) => '[x]('.repeat(Math.ceil(k / 4)).slice(0, k), 320_000);
  assertLinearShape('#1725 the desk mask of many [', (x) => { ST.maskRaw(x, red); }, (k) => '['.repeat(k), 80_000);
  assertLinearShape('#1613 redact many entities and marks', (x) => { redact(x, {}); }, (k) => 'a&#8203;b\u0301c&zwj;'.repeat(Math.ceil(k / 15)).slice(0, k), 400_000);
}

// spec 012 FR-183 (issue 1593): the shared redactMarkdown (maskSlashText's second pass) has the window's work budget; under it, exactly main's output
{
  // main's body at 7ce319809, unchanged (redact itself is not changed by FR-183)
  const MK = '[redacted]';
  const mainMarkdown = (u: string, k: string): string => {
    let m = redact(k);
    const seen = new Set<string>();
    const found: string[] = [];
    for (const r of u.match(/[A-Za-z0-9_\-.+/=:@%]{12,}/g) ?? []) { if (seen.has(r)) continue; seen.add(r); if (redact(r) !== r) found.push(r); }
    found.sort((a, b) => b.length - a.length);
    for (const r of found) m = m.replace(new RegExp(r.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[A-Za-z0-9_-]*', 'g'), () => MK);
    return m;
  };
  const marks = (u: string): string => u.replace(/[*`~[\]]/g, '');
  const pwRun = (k: number, f: (i: number) => string = (i) => 'password=' + String(i).padStart(14, 'K') + ' '): string => { let t = '*'; for (let i = 0; t.length < k; i++) t += f(i); return t.slice(0, k); };
  assert.strictEqual(MARKDOWN_WORK, 2 ** 26, '#1593 redactMarkdown: the budget is 2^26');
  assert.strictEqual((require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { BOTH_WORK: number }).BOTH_WORK, MARKDOWN_WORK, '#1593 redactMarkdown: the same budget as the window');
  assertLinearShape('#1593 redactMarkdown of many distinct secrets after a mark', (x) => void redactMarkdown(x, marks(x)), (k) => pwRun(k), 400_000);
  const over = pwRun(200_000);
  assert.strictEqual(redactMarkdown(over, marks(over)), MK, '#1593 redactMarkdown over the budget: the whole text is one mask');
  const G = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  let seed = 1593;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const parts = [G, 'x**' + G + '**', G.slice(0, 20) + '*' + G.slice(20), 'password=Hx9Kq2Lm7Np4Rs', '*', '`', '~~', '[', ']', ' ', 'word', 'snake_case_name_here', '\n'];
  // review of PR 1816, finding 1: the boundary, with an injected mask (as test-safetext's): 8,192 runs it changes x an output of 8,192 characters is exactly
  // the budget and the pass runs; one more output character is over it (one mask). The budget counts the output (not the text) and only the changed runs.
  {
    const runs = Array.from({ length: 8192 }, (_, i) => 'q' + String(i).padStart(11, '0'));
    const u = '*' + runs.join(' ');
    const inj = (len: number) => (t: string): string => (/^q\d{11}$/.test(t) ? '[x]' : t.length > 1000 ? 'a'.repeat(len) : t);
    assert.strictEqual(_markdownPassForTest(u, marks(u), inj(8192)), 'a'.repeat(8192), '#1593 redactMarkdown exactly at the budget: the pass runs');
    assert.strictEqual(_markdownPassForTest(u, marks(u), inj(8193)), MK, '#1593 redactMarkdown one output character over the budget: one mask');
    // round 2 of the review of PR 1816: over the budget the pass stops at the first run that crosses it (2^26 / 65,536 = 1,024 runs fit), not after all 8,192
    let calls = 0;
    const counted = (t: string): string => { if (/^q\d{11}$/.test(t)) calls++; return inj(65_536)(t); };
    assert.strictEqual(_markdownPassForTest(u, marks(u), counted), MK, '#1593 redactMarkdown far over the budget: one mask');
    assert.strictEqual(calls, 1025, '#1593 redactMarkdown over the budget: it stops at the run that crosses it (1,025 run masks, not 8,192)');
  }
  // about 2,800 distinct runs that the mask leaves alone and a secret every 500th: runs x length is over the budget, changed runs x length is not
  const manyPlain = pwRun(40_000, (i) => (i % 500 === 7 ? 'password=Hx9Kq2Lm7Np4Rs' + i + ' ' : 'plainword' + String(i).padStart(5, '0') + ' '));
  {
    const r = redactMarkdown(manyPlain, marks(manyPlain));
    assert.ok(r !== MK && r.length > 30_000 && !r.includes('Hx9Kq2Lm7Np4Rs'), '#1593 redactMarkdown of many runs the mask leaves alone: masked, not one mask');
  }
  // review of PR 1816, finding 2: a changed run too long for a RegExp (about 32,000 characters; main threw "Invalid regular expression") is one mask, not a throw
  {
    const long = '*' + G.slice(0, 4) + 'A1b2'.repeat(10_000) + ' ' + 'word '.repeat(10_000);
    let r: string;
    try { r = redactMarkdown(long, marks(long)); } catch { r = 'threw'; }
    assert.strictEqual(r, MK, '#1593 redactMarkdown of a changed run of 40,000 characters: one mask, not a throw');
  }
  const texts: string[] = [pwRun(16_000), pwRun(40_000), manyPlain];
  for (let i = 0; i < 1500; i++) { let t = ''; const n = 1 + Math.floor(rnd() * 16); for (let j = 0; j < n; j++) t += parts[Math.floor(rnd() * parts.length)]; texts.push(t); }
  // spec 012 FR-185: main's reading with the GitHub last pass off inside, then that pass once over the result, as `redactMarkdown` does it
  for (const t of texts) assert.strictEqual(redactMarkdown(t, marks(t)), maskLoose(withoutLoose(() => mainMarkdown(t, marks(t)))), `#1593 redactMarkdown as on main under the budget: ${JSON.stringify(t.slice(0, 50))}`);
}

// spec 012 FR-184 (issue #1543, T166): a token behind a shell's backslash forms (ANSI-C `$'…'` escapes, JSON `\u` escapes, a line continuation inside it, the PowerShell
// backtick, the cmd caret, an escaped colon and blank in a header, an env value written with a backslash inside it) is hidden on every surface the approval card and the
// desk are built from. Every token and value here is invented and built in code from pieces.
{
  const BS = '\\';
  const B36 = 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8';
  const VAL = 'Vq7v0TzR8pLw3QaZ'; // an invented env value, under a secret-looking name
  const PW = 'Hx9Kq2Lm7Np4Rs';
  const env = { MY_API_KEY: VAL };
  const ST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string };
  const LA = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string; hidden: boolean }; phrase(o: { kind: string; tool: string; label: string }, m: Record<string, (s: string) => string>): string };
  const mk = (e: Record<string, string>) => ({ redact: (t: string) => redact(t, e), cmd: (t: string) => maskSecretCommand(t, e), url: (t: string) => maskSecretUrl(t, e) });
  /** Any 8 characters of a secret in `out`. */
  const shows = (out: string, secrets: string[]): string | undefined => {
    for (const b of secrets) for (let i = 0; i + 8 <= b.length; i++) if (out.includes(b.slice(i, i + 8))) return b.slice(i, i + 8);
    return undefined;
  };
  // [form, text, the secrets that must not show]; every one of these is shown in clear on main at 4056ec33b
  const FORMS: Array<[string, string, string[]]> = [
    ['ANSI-C \\x5f', `echo $'ghp${BS}x5f${B36}'`, [B36]],
    ['ANSI-C \\x70', `echo $'gh${BS}x70_${B36}'`, [B36]],
    ['ANSI-C octal', `echo $'gh${BS}160_${B36}'`, [B36]],
    ['ANSI-C letters', `echo $'${BS}x67${BS}x68p_${B36}'`, [B36]],
    ['ANSI-C escape in the body', `echo $'ghp_${B36.slice(0, 12)}${BS}x${B36.charCodeAt(12).toString(16)}${B36.slice(13)}'`, [B36.slice(13)]],
    ['JSON \\u005f', `echo ghp${BS}u005f${B36}`, [B36]],
    ['JSON \\u in a JSON command', `{"command":"echo ghp${BS}u005f${B36}"}`, [B36]],
    ['\\u{5f}', `echo ghp${BS}u{5f}${B36}`, [B36]],
    ['a line continuation in the body', `echo ghp_${B36.slice(0, 10)}${BS}\n${B36.slice(10)}`, [B36.slice(10)]],
    ['a line continuation with CRLF', `echo ghp_${B36.slice(0, 10)}${BS}\r\n${B36.slice(10)}`, [B36.slice(10)]],
    ['the PowerShell backtick', `echo gh\`p_${B36}`, [B36]],
    ['the PowerShell backtick in the body', `Write-Output ghp_${B36.slice(0, 20)}\`${B36.slice(20)}`, [B36.slice(20)]],
    ['the cmd caret', `echo g^hp_${B36}`, [B36]],
    ['the cmd caret in the body', `echo ghp_${B36.slice(0, 20)}^${B36.slice(20)}`, [B36.slice(20)]],
    ['an escaped colon and blank in a header', `curl -H X-Api-Key${BS}:${BS} ${PW} https://h.example/x`, [PW]],
    ['a JSON line break and a shell break escape in the token', `line one${BS}nghp_${B36.slice(0, 15)}${BS}t${B36.slice(15)}${BS}nline three`, [B36.slice(15)]],
    ['a second token glued by a full stop', `echo ghp_${B36.slice(0, 10)}${BS}n${B36.slice(10)}.g${BS}hp_${B36}`, [B36.slice(0, 10), B36]],
    // pre-review of PR 1824 (Codex): a `\u{…}` code in the body after a head the rules hide whole, PowerShell's `u{…}, cmd's caret line continuation, and a header's
    // colon and blank spelled as ANSI-C codes
    ['\\u{…} in the body', `echo ghp_${B36.slice(0, 20)}${BS}u{${B36.charCodeAt(20).toString(16)}}${B36.slice(21)}`, [B36.slice(21)]],
    ['the PowerShell `u{…}', `echo "ghp\`u{5f}${B36}"`, [B36]],
    ['a cmd caret line continuation', `echo ghp_${B36.slice(0, 10)}^\r\n${B36.slice(10)}`, [B36.slice(10)]],
    ['a cmd caret line continuation with LF', `echo ghp_${B36.slice(0, 10)}^\n${B36.slice(10)}`, [B36.slice(10)]],
    ['an ANSI-C colon and blank in a header', `curl -H $'X-Api-Key${BS}x3a${BS}x20${PW}' https://h.example/x`, [PW]],
    // pre-review of PR 1824 (the spec 103 bot): forms that pinned no reading of their own: a backtick or caret with a `\x` code in one run (the C reading read by the
    // shell), an escaped `=` and an escaped tab (the escaped-separator reading), a `\t` break around a token, FR-181's round-5 cases, a doubled backslash
    ['a backtick and a \\x code in one run', `echo gh\`p${BS}x5f${B36}`, [B36]],
    ['a caret and a \\x code in one run', `echo $'g^h${BS}x70_${B36}'`, [B36]],
    ['an escaped equals sign after a name', `export API_KEY${BS}=${PW}`, [PW]],
    ['an escaped colon and tab in a header', `curl -H X-Api-Key${BS}:${BS}\t${PW} https://h.example/x`, [PW]],
    ['an escaped tab after a name', `echo API_KEY${BS}\t${PW}`, [PW]],
    ['a JSON tab around a token with a line break escape inside', `a${BS}tghp_${B36.slice(0, 15)}${BS}n${B36.slice(15)}${BS}tb`, [B36.slice(15)]],
    ['round 5: a second token glued by a slash', `echo sk-proj-A1b2C3d4E5${BS}tF6G7h8I9j0_${B36}_x4Y5z6/g${BS}hp_${B36}`, ['A1b2C3d4E5', B36]],
    ['round 5: a second token glued by an equals sign', `echo ghp_A1b2C3d4E5${BS}nF6G7h8I9j0K1l2M3n4O5p6Q7r8=g${BS}hp_${B36}`, ['A1b2C3d4E5', B36]],
    ['round 5: the fuzz case', `echo ghp_sw${BS}clsF2vxJw4VKO${BS}rN${BS}x${BS}xanF2VVqd6xsUJASOD=AK${'IA'}QWERTYUIOPASDFGH`, ['clsF2vxJw4VKO', 'anF2VVqd6xsUJASOD', 'QWERTYUIOPASDFGH']],
    ['round 5: an escaped full stop before a second token', `echo ghs${BS}_${B36.slice(0, 10)}${BS}t${B36.slice(10, 24)}${BS}j${B36.slice(24, 33)}${BS}.ghs_${B36}`, [B36.slice(0, 10), B36]],
    ['a doubled backslash before the underscore', `echo ghp${BS}${BS}_${B36}`, [B36]],
    ['a second token glued by a colon in a JSON command', `{"cmd":"export T=ghp_${B36.slice(0, 10)}${BS}n${B36.slice(10)}:g${BS}hp_${B36}"}`, [B36.slice(0, 10), B36]],
  ];
  const surfaces = (t: string, e: Record<string, string>): Array<[string, string]> => {
    const m = mk(e);
    return [['redact', redact(t, e)], ['maskSecretCommand', maskSecretCommand(t, e)], ['maskSecretArgs', maskSecretArgs(['run', t], e).join(' ')],
      ['maskRaw', ST.maskRaw(t, m.redact)], ['excerpt', ST.excerpt(t, m.redact)], ['maskLabel run', ST.maskLabel(t, 'run', m)], ['maskLabel other', ST.maskLabel(t, 'other', m)],
      ['permText shell', LA.permText('run ' + t, 'shell', m).text], ['permText other', LA.permText(t, 'other', m).text], ['phrase', LA.phrase({ kind: 'run', tool: 'Bash', label: t }, m)]];
  };
  for (const [what, t, secrets] of FORMS) {
    for (const [surface, out] of surfaces(t, {})) assert.strictEqual(shows(out, secrets), undefined, `#1543 ${what}: ${surface} shows no part: ${JSON.stringify(t)} gave ${JSON.stringify(out)}`);
    assert.ok(redact(t, {}).includes('[redacted]') && maskSecretCommand(t, {}).includes('[redacted]'), `#1543 ${what}: a mask is shown`);
  }
  // the env value written with a backslash inside it (the shell drops it), and with the backslash doubled
  assert.ok(redact('echo ' + VAL, {}).includes(VAL), '#1543 env: the value alone is no token shape (baseline)');
  for (const t of [`echo ${VAL.slice(0, 3)}${BS}${VAL.slice(3)}`, `echo "${VAL.slice(0, 3)}${BS}${BS}${VAL.slice(3)}"`, `echo $'${VAL.slice(0, 5)}${BS}x${VAL.charCodeAt(5).toString(16)}${VAL.slice(6)}'`]) {
    for (const [surface, out] of surfaces(t, env)) assert.strictEqual(shows(out, [VAL]), undefined, `#1543 env value with a backslash inside: ${surface} shows no part: ${JSON.stringify(t)} gave ${JSON.stringify(out)}`);
  }
  // exact outputs: the command keeps its shape around the mask
  assert.strictEqual(redact(`echo $'ghp${BS}x5f${B36}' | wc`, {}), `echo $'[redacted]' | wc`, '#1543 exact: ANSI-C quoting keeps its quotes');
  assert.strictEqual(maskSecretCommand(`curl -H X-Api-Key${BS}:${BS} ${PW} https://h.example/x`, {}), 'curl -H [redacted] https://h.example/x', '#1543 exact: the escaped header is one masked word');
  assert.strictEqual(LA.permText(`run echo g^hp_${B36} && ls`, 'shell', mk({})).text, 'run echo [redacted] && ls', '#1543 exact: the card hides the caret form');
  // pre-review of PR 1824: the stretch before a hidden piece stays when the head of that piece hides alone (the head reading's `!hides(head)`)
  assert.strictEqual(redact(`echo X-Api-Key${BS}tg${BS}hp_${B36}=AK${'IA'}QWERTYUIOPASDFGH`, {}), `echo X-Api-Key${BS}t[redacted]`, '#1543 head reading: the stretch before stays when the head hides alone');
  // a line continuation stays in the text after the mask: redact keeps the line structure
  for (const t of [`echo ghp_${B36.slice(0, 10)}${BS}\n${B36.slice(10)}\nnext line`, `a ghp_${B36.slice(0, 6)}${BS}\r\n${B36.slice(6, 20)}${BS}\n${B36.slice(20)} b`]) {
    const out = redact(t, {});
    assert.strictEqual(out.split('\n').length, t.split('\n').length, `#1543 line structure: the line breaks are kept: ${JSON.stringify(out)}`);
    assert.ok(shows(out, [B36.slice(6)]) === undefined && out.includes('[redacted]'), `#1543 line structure: the token is hidden: ${JSON.stringify(out)}`);
  }
  assert.ok(redact(`echo ghp_${B36.slice(0, 10)}${BS}\n${B36.slice(10)}\nnext line`, {}).endsWith('\nnext line'), '#1543 line structure: the next line stays');
  // what stays as written: no token in any reading
  for (const t of [`C:${BS}Users${BS}me${BS}x5fdir${BS}u0041pp`, `make all${BS}\ninstall`, 'use `code` and `more` here', 'a^b^c and 2^32', `printf '%s${BS}n' hello${BS}x20world`, `grep -E '^ghp_[A-Za-z0-9]{36}$' f`,
    `echo $'line${BS}tone${BS}x41'`, `cd C:${BS} && dir`, 'echo 2^\n32 and 2^\r\n64', 'Write-Host "`u{2764} ok"', `printf 'a${BS}x3d${BS}x20b'`]) {
    assert.strictEqual(redact(t, {}), t, `#1543 no token: redact unchanged: ${JSON.stringify(t)}`);
    assert.strictEqual(maskSecretCommand(t, {}), withoutShell(() => maskSecretCommand(t, {})), `#1543 no token: maskSecretCommand as with the shell mode off: ${JSON.stringify(t)}`);
  }
  // spec 012 FR-185 (issue #1329): a whole token after a one-digit `\x` or a short `\u` is hidden now (a GitHub token glued to a digit)
  for (const t of [`x${BS}x3ghp_${B36}`, `x${BS}u003ghp_${B36}`]) assert.ok(!redact(t, {}).includes(B36.slice(0, 8)), `#1329 a short code before a whole token: hidden: ${JSON.stringify(t)}`);
  // a run the shell readings hide can take a word another rule needs (`curl`): both readings count (redact's union, maskLabel's keep)
  {
    const t = `${VAL.slice(0, 7)}${BS}122${VAL.slice(8)}${BS}curl -u bob:${PW} h ${BS}> x`;
    assert.strictEqual(VAL[7], 'R', '#1543 union: the fixture spells R as \\122');
    for (const [surface, out] of surfaces(t, env)) assert.strictEqual(shows(out, [VAL, PW]), undefined, `#1543 union: ${surface} shows neither the value nor the password: ${JSON.stringify(out)}`);
    const t2 = `${BS}sk-proj-${B36}${BS}n8ck${B36}\`curl -u bob:${PW} h`;
    // not the excerpt: it removes the backtick, which glues `curl` to the token on main too (the password shows there as on main; written in FR-184's gap line)
    for (const [surface, out] of surfaces(t2, {}).filter(([n]) => n !== 'excerpt')) assert.strictEqual(shows(out, [B36, PW]), undefined, `#1543 union (backtick): ${surface} shows no secret: ${JSON.stringify(out)}`);
  }
  // a line continuation joins `--password` to a token: the command mask still reads the flag (its union with the reading without the shell mode), and the desk shows
  // no password either; a word after a whole token stays (the rules' masks stand as a blank in the shell readings)
  {
    const t = `echo "ghs_${B36}${BS}\n--password ${PW}`;
    for (const [surface, out] of surfaces(t, {})) assert.strictEqual(shows(out, [B36, PW].filter((x) => surface === 'maskSecretCommand' || surface.startsWith('maskLabel run') || surface === 'permText shell' || surface === 'phrase' || x === B36)), undefined, `#1543 continuation before a flag: ${surface} shows no secret: ${JSON.stringify(out)}`);
    assert.strictEqual(redact(`echo ghs_${B36}${BS}\n--verbose /x`, {}), `echo [redacted]${BS}\n--verbose /x`, '#1543 continuation after a whole token: the next word stays');
    const t2 = `"AIza${B36.slice(0, 20)}^${B36.slice(20, 35)} main\`mysql -p${PW}`;
    // the excerpt removes the backtick and glues `mysql` to `main` (the password shows there on main too: FR-184's gap line), so it is checked for the token only
    for (const [surface, out] of surfaces(t2, {})) assert.strictEqual(shows(out, surface === 'excerpt' ? [B36.slice(20, 35)] : [B36.slice(20, 35), PW]), undefined, `#1543 caret and a backtick before mysql: ${surface} shows no secret: ${JSON.stringify(out)}`);
  }
  // pre-review of PR 1824 (the spec 103 bot): the command mask keeps a piece that stands inside one of the reference's shown pieces (`$'` and `'` around the mask), at
  // most WITHIN_MAX (64) such searches, the rest masked (fail closed)
  {
    assert.strictEqual(maskSecretCommand(`echo $'ghp${BS}x5f${B36}' | wc`, {}), `echo $'[redacted]' | wc`, '#1543 exact: maskSecretCommand keeps the ANSI-C quotes');
    const many = Array.from({ length: 40 }, (_, i) => `$'ghp${BS}x5f${String(i).padStart(36, 'Q')}'`).join(' ');
    const out = maskSecretCommand(`echo ${many}`, {}).split(' ');
    assert.strictEqual(out[1], `$'[redacted]'`, `#1543 keepShownWithin: the first word keeps its quotes: ${out[1]}`);
    assert.strictEqual(out[out.length - 1], '[redacted][redacted][redacted]', `#1543 keepShownWithin: over 64 searches the rest is masked: ${out[out.length - 1]}`);
  }
  // pre-review of PR 1824 (the spec 103 bot): the argument mask's per-argument union with the reading with the shell mode off: in a `sh -c` script the shell readings
  // join `token:` to the token run, and only the reference reading keeps the keyword the name rule needs (`main` showed the token's rest there)
  {
    const out = maskSecretArgs(['sh', '-c', `ghp_${B36.slice(0, 2)}${BS}x6a${B36.slice(3, 20)}^${B36.slice(20)}token: ${PW}`], {}).join(' ');
    assert.strictEqual(shows(out, [B36.slice(20), PW]), undefined, `#1543 union: maskSecretArgs in a sh -c script shows neither the token nor the password: ${JSON.stringify(out)}`);
  }
  // pre-review of PR 1824 (the spec 103 bot): the desk's reference reading (shell mode off) fails closed, so the result does too; a fresh copy of the desk module is
  // handed a shared module whose withoutShell marks the reference reading, and a mask that throws only there
  {
    const file = require.resolve(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js'));
    const saved = require.cache[file];
    delete require.cache[file];
    const ST2 = require(file) as typeof ST & { useShared(m: unknown): boolean };
    require.cache[file] = saved;
    const shared = require(path.join(__dirname, '..', 'src', 'shared', 'redact')) as Record<string, unknown> & { withoutShell<T>(fn: () => T): T };
    let inRef = false;
    let refs = 0;
    assert.ok(ST2.useShared({ ...shared, withoutShell: <T>(fn: () => T): T => shared.withoutShell(() => { inRef = true; refs++; try { return fn(); } finally { inRef = false; } }) }), '#1543 desk fail closed: the fresh copy takes the shared module');
    const red = (x: string): string => { if (inRef) throw new Error('reference reading fails'); return redact(x, {}); };
    // review of PR 1824 (F2): a text the shell readings do not change (FR-181 hides this one alone) is not read again without them
    const t0 = `echo g${BS}hp_${B36} and more`;
    const m0 = ST2.maskRaw(t0, red);
    assert.ok(m0.includes('[redacted]') && refs === 0, `#1543 F2 desk: a text the shell readings leave as FR-181 reads it is read once (${refs} reference readings): ${JSON.stringify(m0)}`);
    // a text only the shell readings hide is read both ways, and fails closed when the reference reading fails
    const t = `echo $'ghp${BS}x5f${B36}' and more`;
    assert.ok(ST2.maskRaw(t, (x) => redact(x, {})).includes('[redacted]'), '#1543 desk fail closed: with a working mask the text is masked (baseline)');
    assert.strictEqual(ST2.maskRaw(t, red), '', '#1543 desk fail closed: maskRaw gives nothing when the reference reading fails');
    assert.strictEqual(ST2.excerpt(t, red), '', '#1543 desk fail closed: the excerpt gives nothing when the reference reading fails');
    assert.strictEqual(ST2.maskLabel(t, 'other', { redact: red }), '', '#1543 desk fail closed: maskLabel gives nothing when the reference reading fails');
  }
  // review of PR 1824 (F1): the card falls back as on main when the label read without the shell readings cannot be matched back to the command (a glued mask and a
  // `\u` escape: main hid the whole command, so the card showed no text); the shell readings alone match it
  {
    const PL = LA as unknown as { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string; hidden: boolean; why?: string } };
    // the reviewer's forms (built from pieces): a caret inside a token, then a JSON line break escape and a keyword with its value, in a `sh -c` script; main's card hid the value
    const PV = '8DVZ' + 'E1FAQKVKqc';
    const PAT = 'github' + '_pat_' + B36.slice(0, 22) + '_' + (B36 + B36).slice(3, 62);
    const reviewForms: Array<[string, string]> = [
      ['ghp_ then token', 'gh' + 'p_' + B36.slice(0, 20) + '^' + B36.slice(20) + BS + 'n' + 'token: ' + PV],
      ['ghp_ then maintoken', 'gh' + 'p_' + B36.slice(0, 20) + '^' + B36.slice(20) + BS + 'n' + 'main' + 'token: ' + PV],
      ['github_pat_ then token', PAT.slice(0, 40) + '^' + PAT.slice(40) + BS + 'n' + 'token: ' + PV],
      ['github_pat_ then maintoken', PAT.slice(0, 40) + '^' + PAT.slice(40) + BS + 'n' + 'main' + 'token: ' + PV],
    ];
    for (const [k, f] of reviewForms) {
      const c = PL.permText('run sh -c ' + f, 'shell', mk({}));
      assert.ok(!c.text.includes(PV), `#1543 F1 card, review form ${k}: the card does not show the value: ${JSON.stringify(c)}`);
    }
    const t = `run [redacted]${BS}u0067hp_${B36}=`;
    const card = PL.permText(t, 'shell', mk({}));
    assert.strictEqual(card.why, 'concealed', `#1543 F1 card: a command the reading without the shell readings cannot match back stays concealed, as on main: ${JSON.stringify(card)}`);
    // a command both readings match back is shown masked as before
    const ok = PL.permText(`run echo $'ghp${BS}x5f${B36}' && ls`, 'shell', mk({}));
    assert.ok(ok.why === 'secret' && ok.text.includes('&& ls') && shows(ok.text, [B36]) === undefined, `#1543 F1 card: a command both readings match is shown masked: ${JSON.stringify(ok)}`);
  }
  // review of PR 1824 (F2): the command and argument masks read a text again without the shell readings only when they changed something in it
  {
    const before = _shellRefsForTest();
    maskSecretCommand(`type C:${BS}Users${BS}me${BS}notes.txt && echo g${BS}hp_${B36}`, {});
    maskSecretArgs(['cmd', `/c type C:${BS}Users${BS}me${BS}a.txt`, `{${BS}"a${BS}":1}`], {});
    assert.strictEqual(_shellRefsForTest(), before, '#1543 F2: a command and arguments the shell readings leave as FR-181 reads them get no reference reading');
    maskSecretCommand(`echo $'ghp${BS}x5f${B36}'`, {});
    assert.ok(_shellRefsForTest() > before, '#1543 F2: a command the shell readings change gets its reference reading');
    // and redact's work on escape-heavy text (review of PR 1824, round 3): counted, not timed: the shell readings of one run make at most this many rule passes (each distinct
    // reading once; a JSON `\t` is no separator to read again), so the count, not a machine's speed, pins the step
    // and `redact` runs every rule over each distinct text once per call (a run its continuations join is often the whole text)
    const passes: Record<string, [string, number]> = { jsonTabs: [`${BS}teyJaaaaa.`, 1], jsonBreaks: [`${BS}n`, 1], jsonGh: [`${BS}nghp_`, 1], jsonCode: [`${BS}u003d`, 2], hexSk: [`${BS}x3dsk-`, 2], lineContinuations: [`pa${BS}\n`, 1] };
    for (const [k, [u, most]] of Object.entries(passes)) {
      const p0 = _shellPassesForTest();
      const q0 = _shapePassesForTest();
      const r0 = _runReadsForTest();
      redact(u.repeat(2000), {});
      const n = _shellPassesForTest() - p0;
      const q = _shapePassesForTest() - q0;
      const rr = _runReadsForTest() - r0;
      assert.ok(n <= most, `#1543 F2 work ${k}: the shell readings make ${n} rule passes (at most ${most})`);
      assert.ok(q <= 2, `#1543 F2 work ${k}: every rule ran ${q} times over the texts of one call (at most 2)`);
      assert.ok(rr <= 1, `#1543 F2 work ${k}: FR-181's readings of the run were made ${rr} times in one call (shared by both passes: at most 1)`);
    }
    // review of PR 1824 (round 5): a JSON-escaped tab-separated table (a tab after each word) takes the separator reading on purpose (a coded tab after a name-like word
    // can stand before a value): exactly four shell-reading passes (the C reading, the two break readings, the separator reading), two rule passes, one reading of the run
    {
      const row = 'col' + '_a' + `${BS}t` + 'col' + '_b' + `${BS}t` + 'col' + '_c' + `${BS}n`;
      const p0 = _shellPassesForTest();
      const q0 = _shapePassesForTest();
      const r0 = _runReadsForTest();
      redact(row.repeat(2000), {});
      const got = [_shellPassesForTest() - p0, _shapePassesForTest() - q0, _runReadsForTest() - r0].join(' ');
      assert.strictEqual(got, '4 2 1', '#1543 F2 work tabTable: shell-reading passes, rule passes and run readings');
    }
    // review of PR 1824 (round 4): a coded tab right after a secret name (or a `=` after it) is still read as a separator, so the value after it stays hidden, while the
    // JSON-escaped text above keeps its one pass; and the tail of a token after a PowerShell `u{…} code in a run that also holds a JSON tab
    const TV = 'Q1w2E3r4T5y6' + 'U7i8O9p0A1s2';
    const PLS = mk({});
    for (const n of ['to' + 'ken', 'X-Api' + '-Key', 'API' + '_KEY', 'GH' + '_TOKEN']) {
      for (const tb of [`${BS}t`, `${BS}x09`, `${BS}u0009`, `${BS}011`, `${BS}u{9}`]) {
        for (const t of [n + tb + TV, n + tb + '=' + tb + TV]) {
          const outs: Record<string, string> = { redact: redact(t, {}), command: maskSecretCommand(t, {}), args: maskSecretArgs([t], {})[0], maskRaw: ST.maskRaw(t, PLS.redact), labelRun: ST.maskLabel(t, 'run', PLS), card: (LA.permText('run ' + t, 'shell', PLS) as { text: string }).text };
          for (const [k, o] of Object.entries(outs)) assert.strictEqual(shows(o, [TV]), undefined, `#1543 coded tab after a name: ${k} shows no part of the value`);
        }
      }
    }
    for (const pre of ['', 'echo ', `x${BS}t`, `a${BS}t`, `> ${BS}t`, `echo ${BS}t`]) {
      for (const post of [`${BS}tb`, `${BS}t`]) {
        for (const at of [20, 30]) {
          const t = pre + 'gh' + 'p_' + B36.slice(0, at) + '`u{41}' + B36.slice(at) + post;
          for (const [k, o] of Object.entries({ redact: redact(t, {}), command: maskSecretCommand(t, {}), args: maskSecretArgs([t], {})[0] })) assert.strictEqual(shows(o, [B36.slice(at)]), undefined, `#1543 a PowerShell code and a JSON tab in one run: ${k} shows no part of the tail`);
        }
      }
    }
    // a JSON tab right before such a token, with nothing or a word after it (the run starts at the tab)
    for (const pre of [`> ${BS}t`, `echo ${BS}t`]) {
      for (const post of ['', ' z', `${BS}\n`]) {
        for (const at of [20, 26]) {
          const t = pre + 'gh' + 'p_' + B36.slice(0, at) + '`u{75}' + B36.slice(at) + post;
          for (const [k, o] of Object.entries({ redact: redact(t, {}), command: maskSecretCommand(t, {}), args: maskSecretArgs([t], {})[0] })) assert.strictEqual(shows(o, [B36.slice(at)]), undefined, `#1543 a JSON tab before a token with a PowerShell code: ${k} shows no part of the tail`);
        }
      }
    }
    // the note and message masks keep the union with the reading without the shell readings too: a run hidden whole that takes a keyword leaves no tail of the
    // value that rule hid (the differential fuzz of round 4 found it on both)
    {
      const tail = B36.slice(10, 16) + 'IdgFAOr';
      const t = `printf "%s${BS}n" npm${BS}u005f${B36} to` + `ken: ${PW} T=xo` + `xb-${'1234' + '56789012'}-${B36.slice(0, 10)}\`u{43}` + tail + ' main';
      for (const [k, o] of Object.entries({ note: maskNoteText(t, []).text, outgoing: maskOutgoing(t, []).text })) assert.strictEqual(shows(o, [PW, B36, tail]), undefined, `#1543 union: ${k} shows no part of a value the reading without the shell readings hides: ${JSON.stringify(o)}`);
    }
    // a loose time check on top (catastrophic cost only, not the step: five runs on Linux measured 1.3 to 1.7 times the reading without the shell readings)
    for (const [k, [u]] of Object.entries(passes)) {
      const x = u.repeat(Math.ceil(131_072 / u.length));
      assertWithinYardstick(`#1543 F2 redact ${k} with the shell readings against without them`, () => { redact(x, {}); }, () => { withoutShell(() => redact(x, {})); }, 3);
    }
  }
  // review of PR 1824 (F3): the desk reads the same escaped runs and line continuations as redact (one shared definition each)
  {
    const t1 = `[redacted]glpat-${B36.slice(0, 6)}^\n${B36.slice(6, 20)}=`;
    assert.strictEqual(shows(redact(t1, {}), [B36.slice(0, 20)]), undefined, '#1543 F3: redact hides a token with a caret continuation after a glued mask (baseline)');
    assert.strictEqual(shows(ST.maskRaw(t1, (x) => redact(x, {})), [B36.slice(0, 20)]), undefined, `#1543 F3 maskRaw: a caret continuation (no backslash) is masked as written first, as the excerpt does: ${JSON.stringify(ST.maskRaw(t1, (x) => redact(x, {})))}`);
    const t2 = `password=ghs_${B36.slice(0, 3)}${BS}u{6d}${B36.slice(3, 20)}${BS}${BS}${B36.slice(20)}${BS}\njhh\``;
    assert.strictEqual(shows(redact(t2, {}), [B36]), undefined, '#1543 F3: redact hides a token with a \\u{…} escape and a continuation (baseline)');
    const lab = ST.maskLabel(t2, 'other', { redact: (x: string) => redact(x, {}) });
    assert.strictEqual(shows(lab, [B36]), undefined, `#1543 F3 maskLabel: the label step judges the shared step's runs (a \\u{…} escape is one run with its token): ${JSON.stringify(lab)}`);
    // the shell-mode run can take a keyword after a backtick with the token (`<run>`token: <password>`); the label is then read again without the shell readings, so the
    // value main hides stays hidden (the differential fuzz of the review round found it)
    for (const t3 of [`> sk-proj-${B36.slice(0, 4)}${BS}${BS}${B36.slice(4)}${BS}tb\`token: ${PW}`, `a${BS}${BS}github_pat_${B36.slice(0, 20)}${BS}${BS}${B36}\`mysql -p${PW}\` x`]) {
      for (const [k, m] of [['other', { redact: (x: string) => redact(x, {}) }], ['run', { cmd: (x: string) => maskSecretCommand(x, {}) }]] as Array<[string, Record<string, (s: string) => string>]>) {
        const o = ST.maskLabel(t3, k, m);
        assert.strictEqual(shows(o, [PW, B36]), undefined, `#1543 F3 maskLabel ${k}: a keyword the shell-mode run takes with the token keeps its value hidden: ${JSON.stringify(o)}`);
      }
    }
    const STF = ST as unknown as { _deskEscRunForTest(): string };
    assert.strictEqual(STF._deskEscRunForTest(), ESC_RUN_SHELL_SOURCE, '#1543 F3: the desk label step reads the shared run definition, not a copy');
  }
  // review of PR 1824 (F4): a mask per short continuation line made the output 3.7 times the text; it is at most three times (plus one mask), failing closed over it
  {
    for (const [k, x] of Object.entries({ lf: 'ghp_' + `${BS}\na`.repeat(4000), crlf: 'ghp_' + `${BS}\r\na`.repeat(3000), caret: 'ghp_' + '^\nab'.repeat(3000) })) {
      for (const [name, out] of Object.entries({ redact: redact(x, {}), command: maskSecretCommand(x, {}), args: maskSecretArgs([x], {})[0], maskRaw: ST.maskRaw(x, (y) => redact(y, {})) })) {
        assert.ok(out.length <= 3 * x.length + 10, `#1543 F4 ${name} ${k}: output ${out.length} characters for ${x.length} (at most three times)`);
        assert.ok(!/a|ab/.test(out.replace(/\[redacted\]/g, '')), `#1543 F4 ${name} ${k}: nothing of the hidden lines shows`);
      }
    }
    // under the bound nothing changes: a text with a few masks per line keeps them in place
    assert.strictEqual(redact(`a ghp_${B36}\nb ghp_${B36}`, {}), 'a [redacted]\nb [redacted]', '#1543 F4: under the bound the masks stay where they are');
  }
  // odd input stays a string
  for (const t of ['`', '^', '`'.repeat(1000), '^a'.repeat(1000), `${BS}\n`.repeat(500), `${BS}u{110000}`, `${BS}U0011FFFF`, `$'${BS}x`, '`u{110000}', '^\n'.repeat(500), '`u{5f}'.repeat(500)]) {
    for (const out of [redact(t, {}), maskSecretCommand(t, {}), maskSecretArgs([t], {})[0]]) assert.ok(typeof out === 'string' && out !== '[redaction failed]', `#1543 odd input is masked, not failed: ${JSON.stringify(t.slice(0, 12))} gave ${JSON.stringify(out.slice(0, 40))}`);
  }
  // growth: linear in the text
  assertLinearShape('#1543 redact many ANSI-C tokens', (x) => { redact(x, env); }, (k) => Array.from({ length: Math.ceil(k / 50) }, (_, i) => `$'ghp${BS}x5f${String(i).padStart(36, 'Q')}'`).join(' ').slice(0, k), 400_000);
  assertLinearShape('#1543 redact many backtick and caret words', (x) => { redact(x, env); }, (k) => 'a`bc^de `f g^h '.repeat(Math.ceil(k / 15)).slice(0, k), 400_000);
  assertLinearShape('#1543 redact one long run of escapes', (x) => { redact(x, env); }, (k) => `a${BS}x41\`b^c${BS}u0041${BS}\n`.repeat(Math.ceil(k / 20)).slice(0, k), 400_000);
  assertLinearShape('#1543 redact many caret continuations and PowerShell codes', (x) => { redact(x, env); }, (k) => `ab^\ncd\`u{5f}ef `.repeat(Math.ceil(k / 15)).slice(0, k), 400_000);
  assertLinearShape('#1543 maskSecretCommand many escaped headers', (x) => { _uncappedForTest.maskSecretCommand(x, env); }, (k) => `-H X-Api-Key${BS}:${BS} v `.repeat(Math.ceil(k / 20)).slice(0, k), 400_000);
}

// spec 012 FR-185 (issue #1329, T167): more spellings of a home folder, and GitHub token forms the held shape left readable (a body cut short, letters from
// another script in the prefix or body, a prefix glued to a word before it). Every value here is invented and built in code from pieces.
{
  const B36 = 'R1t2Y3u4I5o6P7a8S9d0F1g2H3j4K5l6Z7x8';
  const B82 = (B36 + B36 + B36).slice(0, 82);
  const ST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string, n?: number): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string; create(o: { redact: (s: string) => string }): { mask(t: string): string; excerpt(t: string, n?: number): string } };
  const LA = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string }; phrase(o: { kind: string; tool: string; label: string }, m: Record<string, (s: string) => string>): string };
  const m = { redact: (t: string) => redact(t, {}), cmd: (t: string) => maskSecretCommand(t, {}), url: (t: string) => maskSecretUrl(t, {}) };
  const shows = (out: string, secrets: string[]): string | undefined => {
    for (const b of secrets) for (let i = 0; i + 8 <= b.length; i++) if (out.includes(b.slice(i, i + 8))) return b.slice(i, i + 8);
    return undefined;
  };
  const surfaces = (t: string): Array<[string, string]> => [['redact', redact(t, {})], ['maskTokenShapes', maskTokenShapes(t, '[redacted]')], ['maskSecretCommand', maskSecretCommand(t, {})], ['maskSecretArgs', maskSecretArgs(['run', t], {}).join(' ')],
    ['maskRaw', ST.maskRaw(t, m.redact)], ['excerpt', ST.excerpt(t, m.redact)], ['maskLabel run', ST.maskLabel(t, 'run', m)], ['maskLabel other', ST.maskLabel(t, 'other', m)],
    ['permText shell', LA.permText('run ' + t, 'shell', m).text], ['permText other', LA.permText(t, 'other', m).text], ['phrase', LA.phrase({ kind: 'run', tool: 'Bash', label: t }, m)],
    ['maskNoteText', maskNoteText(t).text], ['maskOutgoing', maskOutgoing(t).text], ['redactMarkdown', redactMarkdown(t, t)], ['wrapper mask', ST.create({ redact: m.redact }).mask(t)], ['wrapper excerpt', ST.create({ redact: m.redact }).excerpt(t, 140)]];
  const gh = (p: string): string => 'gh' + p + '_';
  // [label, text, the secrets that must not show]; each is shown in clear on main at 7a5f9777e
  const FORMS: Array<[string, string, string[]]> = [
    ['cut: a short body and an ellipsis', 'echo ' + gh('p') + B36.slice(0, 18) + '\u2026 done', [B36.slice(0, 18)]],
    ['cut: a short body and three dots', 'echo ' + gh('o') + B36.slice(0, 12) + '... done', [B36.slice(0, 12)]],
    ['cut: a short body at the end', 'echo ' + gh('s') + B36.slice(0, 10), [B36.slice(0, 10)]],
    ['cut: a short fine-grained body', 'echo github' + '_pat_' + B82.slice(0, 14) + '\u2026', [B82.slice(0, 14)]],
    ['lookalike prefix: Cyrillic', 'echo gh\u0440_' + B36, [B36]],
    ['lookalike prefix: full-width', 'echo \uff47\uff48\uff50\uff3f' + B36, [B36]],
    ['a letter of another script inside the body', 'echo ' + gh('p') + B36.slice(0, 10) + '\u0430' + B36.slice(10), [B36.slice(0, 10), B36.slice(10)]],
    ['glued after a word', 'ssh ax' + gh('p') + B36, [B36]],
    ['glued after a letter of another script and a word', 'ssh \u0435x' + gh('u') + B36, [B36]],
    ['glued after a digit', 'id9' + gh('r') + B36, [B36]],
    ['glued fine-grained', 'xx' + 'github' + '_pat_' + B82.slice(0, 22) + '_' + B82.slice(22, 81), [B82.slice(0, 22), B82.slice(22, 81)]],
  ];
  for (const [what, t, secrets] of FORMS) {
    for (const [surface, out] of surfaces(t)) assert.strictEqual(shows(out, secrets), undefined, `#1329 ${what}: ${surface} shows no part: ${JSON.stringify(t)} gave ${JSON.stringify(out)}`);
    assert.strictEqual(maskTokenShapesUnguarded(t, '[redacted]'), maskTokenShapes(t, '[redacted]'), `#1329 ${what}: the marker guard changes nothing`);
  }
  // accepted over-masking, pinned (spec FR-185): a word at a token start with a GitHub prefix and a capital
  assert.strictEqual(redact('see ' + 'ghs_' + 'TotalWeight now', {}), 'see [redacted] now', '#1329 accepted: a prefixed word at a token start is hidden');
  // exact outputs: the word before a glued token and the text after a cut one stay
  assert.strictEqual(redact('ssh ax' + gh('p') + B36 + ' now', {}), 'ssh ax[redacted] now', '#1329 glued: the word before stays');
  assert.strictEqual(redact('see ' + gh('p') + B36.slice(0, 18) + '\u2026 then', {}), 'see [redacted]\u2026 then', '#1329 cut: the ellipsis and the rest stay');
  // near misses that stay: a lower-case body (a word), a bare prefix, a snake_case word ending in the prefix letters, a glued body under 20
  // review of PR 1832 (F2): identifiers that end in a prefix's letters, and full-width prose after a look-alike prefix
  for (const keep of ['ghp_short', 'ghs_count', 'the ghp_ prefix', 'ghp_... and ghp_', 'weighs_V2 ok', 'the highs_andlowsofthemarketcycle', 'laughs_total_count',
    'wei' + 'ghs_' + 'TotalWeightKilograms', 'hi' + 'ghs_' + 'AndLowsOfTheMarket2026', 'cou' + 'ghs_' + 'PerDayAverage', 'lau' + 'ghs_' + 'PerMinuteAtTheShow', 'x' + gh('p') + B36.slice(0, 20) + ' y',
    '\uff47\uff48\uff50\uff3f\uff54\uff45\uff53\uff54\uff12', '\uff47\uff48\uff53\uff3f\u30c6\u30b9\u30c8', '\uff47\uff48\uff53\uff3f' + '\u30c6\u30b9\u30c8'.repeat(12),
    'my' + 'ghs_' + 'ProcessingTimeForEachRequestInMillis']) {
    assert.strictEqual(redact(keep, {}), keep, `#1329 near miss stays: ${keep}`);
  }
  // home folders: the user name becomes `~`, the rest stays
  const H: Array<[string, string, string]> = [
    ['~name', '~alicez/x/y', '~/x/y'],
    ['~name and a dotfile', 'cat ~alicez/.ssh/config', 'cat ~/.ssh/config'],
    ['~name and a file name', 'open ~alicez/notes.md', 'open ~/notes.md'],
    ['~name with a backslash', 'cd ~alicez\\proj\\x', 'cd ~\\proj\\x'],
    ['WSL', 'ls /mnt/c/Users/aliceq/x', 'ls ~/x'],
    ['WSL lower case', 'ls /mnt/d/users/aliceq/x', 'ls ~/x'],
    ['drive lowercase', 'c:\\users\\aliceq\\x', '~\\x'],
    ['drive upper case', 'C:/USERS/aliceq/x', '~/x'],
    ['percent-encoded Users', 'open?p=%2FUsers%2Falicen%2Fx', 'open?p=~%2Fx'],
    ['percent-encoded home, lower hex', '%2fhome%2falicen%2fx', '~%2fx'],
    ['percent-encoded drive', 'C%3A%5CUsers%5Calicen%5Cx', '~%5Cx'],
    ['percent-encoded twice', '%252Fhome%252Falicen%252Fx', '~%252Fx'],
  ];
  for (const [what, t, want] of H) assert.strictEqual(maskHomePaths(t, []), want, `#1329 home ${what}`);
  for (const keep of ['~5/10', '~text~ and ~~gone~~', 'the ~half/whole split', 'about ~ten/twenty.', '/mnt/c/Program Files/x', 'see ~/.bashrc', 'cd ~/x', 'a~b/c', 'GET /api/users/42', '%2Fusr%2Flocal%2Fbin', 'q=%2Fhomes%2Fx']) assert.strictEqual(maskHomePaths(keep, []), keep, `#1329 home near miss stays: ${keep}`);
  // the last pass runs once, after the readings: inside them it left a later reading without the token it needed (differential fuzz cases; invented values)
  {
    const t1 = 'ssh)' + gh('r') + 'u6HdGGJbEoxDB6t6XOCmtm\u0301FL1vRxYlppa92B,echo)' + gh('s') + 'spoQP8Daz74IX21gwC&#95;' + '77SXlwH0wpntqfUKpP\\n-';
    assert.strictEqual(shows(maskSecretCommand(t1, {}), ['77SXlwH0wpntqfUKpP']), undefined, `#1329 last pass: maskSecretCommand reads without it first: ${maskSecretCommand(t1, {})}`);
    const t2 = 'ax\\n' + gh('r') + 'SDKYjWh^XHL25Wmr5o0Yr5uKnU3FKWPcC2oVU password=.' + gh('u') + '44OozxSib7X1hEAo\u2026 done.=' + gh('o') + 'jqmTvca45pZDpaKlg7aCMSyL\u4e00' + 'pvonYqxhEZT8\t\t';
    for (const [what, out] of [['maskNoteText', maskNoteText(t2).text], ['maskOutgoing', maskOutgoing(t2).text]] as const) assert.strictEqual(shows(out, ['pvonYqxhEZT8']), undefined, `#1329 last pass: ${what} reads without it first: ${out}`);
  }
  // the excerpt's union with the reading without the pass cannot be trusted when the text holds words that look like a mask: it fails closed there (invented pieces)
  {
    const SKP = 's' + 'k-' + 'proj-';
    const t = gh('p') + 'FNUNrx1cySIjmuYb2eZMEThaFe[redacted:Zcpeeujppb' + SKP + 'Cgl1ORAfbjvl[redacted:hsa4Q4i' + SKP + 'z3MfR1xn\\hQLHi1vrTcBuGGZooLgiWkFigj' + gh('s') + 'dDPObRiEbVd0pJt9rAHOWw0xGQVlg2m5P8Yv\u200b' + gh('s') + 'RNV9SzyW5VEdCg# pqrJuvSaHyS3mKtQxa54yp[my_branch';
    for (const n of [undefined, 140]) assert.strictEqual(shows(ST.excerpt(t, m.redact, n), ['Cgl1ORAfbjvl', 'z3MfR1xnhQLHi1vrTcBuGGZooLgiWkFigj']), undefined, `#1329 excerpt with mask-like words fails closed: ${ST.excerpt(t, m.redact, n)}`);
  }
  // the card judges what it shows: a command that is only a cut token is masked whole by the pass, so the card treats it as lost (its fallback words)
  assert.strictEqual(LA.permText('run ' + gh('p') + B36.slice(0, 10), 'shell', m).text, LA.permText('run ' + gh('p') + B36, 'shell', m).text, '#1329 card: a command that is only a cut token falls back as a whole one does');
  // cost: the new shapes add no rule pass (work counter): each form takes as many passes as the same text with a plain whole token
  for (const [what, t] of FORMS) {
    const plain = 'echo ' + gh('p') + B36;
    const q0 = _shapePassesForTest(); redact(plain, {}); const base = _shapePassesForTest() - q0;
    const q1 = _shapePassesForTest(); redact(t, {}); const got = _shapePassesForTest() - q1;
    assert.ok(got <= base, `#1329 work: ${what}: ${got} rule passes, a plain token takes ${base}`);
  }
  // review of PR 1832 (F1): a surface that masks the home folder first must not show what the secret masks hide in the raw text: a key split by a line break whose
  // second piece reads like `~name/…` (invented pieces); main hides every one of these on that order, and so must this
  {
    const K = 'AK' + 'IA', KB = 'Q7W8E9R0T1Y2U3I4';
    for (const cut of [4, 8, 12]) for (const sep of ['\n~', '\r\n~', '\n\n~']) for (const tail of ['/x', '\\x', '/x/y', '/.ssh', '/a.md']) {
      const t = K + KB.slice(0, cut) + sep + KB.slice(cut) + tail;
      const out = redact(maskHomePaths(t, []), {});
      assert.ok(!out.includes(K) && shows(out, [KB]) === undefined, `#1329 F1 home first: the split key stays hidden: ${JSON.stringify(t)} gave ${JSON.stringify(out)}`);
    }
    // round 2 of the review: F1's neighbours. Invariant: the home-first order shows no piece of the key that `redact` hides in the raw text
    const hiddenRaw = (t: string, parts: string[]): string[] => parts.filter((p) => shows(redact(t, {}), [p]) === undefined);
    const neighbour = (what: string, t: string, parts: string[]): void => {
      const out = redact(maskHomePaths(t, []), {});
      const must = hiddenRaw(t, parts);
      assert.ok(must.length > 0, `#1329 F1 neighbours (${what}): redact hides the key in the raw text (baseline): ${JSON.stringify(t)}`);
      assert.strictEqual(shows(out, must), undefined, `#1329 F1 neighbours (${what}): the home-first order shows nothing redact hides: ${JSON.stringify(t)} gave ${JSON.stringify(out)}`);
    };
    for (const [what, sep] of [['CRLF', '\r\n~'], ['lone CR', '\r~'], ['a tab before ~', '\n\t~'], ['spaces before ~', '\n  ~']] as const)
      for (const tail of ['/x/y', '\\x\\y', '/.ssh']) neighbour(what, K + KB.slice(0, 8) + sep + KB.slice(8) + tail, [KB]);
    neighbour('several ~ lines', K + KB.slice(0, 5) + '\n~' + KB.slice(5, 10) + '\n~' + KB.slice(10) + '/x/y', [KB.slice(0, 10), KB.slice(5)]);
    neighbour('split inside the prefix', K.slice(0, 2) + '\n~' + K.slice(2) + KB + '/x/y', [KB]);
    neighbour('split inside the tail', K + KB.slice(0, 14) + '\n~' + KB.slice(14) + '/x/y', [KB]);
    neighbour('~ then a backslash', K + KB.slice(0, 8) + '\n~' + KB.slice(8) + '\\src\\x', [KB]);
    // a home spelling that overlaps a hidden span in part: a token inside the name (from the right) and a key piece ending at it (from the left)
    neighbour('a token inside the name', 'cd ~' + gh('p') + B36 + '/src/x', [B36]);
    neighbour('a key piece ending inside the name', K + KB.slice(0, 12) + '\n~' + KB.slice(12) + '_alicez/src/x', [KB]);
    // round 2 (cost): the guard reads a window around each new spelling, not the whole text
    {
      const pad = 'word '.repeat(200_000);
      const c0 = _homeGuardCharsForTest();
      assert.strictEqual(maskHomePaths(pad + 'see ~alicez/src/x ' + pad, []), pad + 'see ~/src/x ' + pad, '#1329 guard window: one spelling in a long text is rewritten');
      const read = _homeGuardCharsForTest() - c0;
      assert.ok(read <= 2 * HOME_GUARD_WINDOW_FOR_TEST + 64, `#1329 guard window: a long text with one spelling reads one window (${read} characters)`);
      const dense = 'see ~alicez/src/x and '.repeat(200);
      const c1 = _homeGuardCharsForTest();
      maskHomePaths(dense, []);
      assert.ok(_homeGuardCharsForTest() - c1 <= dense.length, `#1329 guard window: overlapping windows are merged, the text is read at most once (${_homeGuardCharsForTest() - c1} of ${dense.length})`);
      neighbour('a long text around it', pad.slice(0, 50_000) + K + KB.slice(0, 8) + '\n~' + KB.slice(8) + '/x/y ' + pad.slice(0, 50_000), [KB]);
    }
    // issue #1845: a window edge inside a token run moves out to the run's end (at most one more window), so `redact` reads the run whole there (invented pieces)
    {
      const W = HOME_GUARD_WINDOW_FOR_TEST;
      const fill = (n: number): string => 'Qw3Er5Ty7Ui9Op2As4Df6Gh8Jk1Lz0Xc'.repeat(Math.ceil(n / 32)).slice(0, n);
      const readOf = (t: string): number => { const c0 = _homeGuardCharsForTest(); maskHomePaths(t, []); return _homeGuardCharsForTest() - c0; };
      // left edge: a name and a value whose value runs past the window's start; the whole text hides the value and the spelling in it, so the spelling stays
      const nv = 'pass' + 'word=' + fill(W + 52) + '/~alicez/src/x';
      assert.strictEqual(shows(redact(nv, {}), ['alicez']), undefined, '#1845 baseline: redact hides the value with the spelling in it');
      assert.strictEqual(maskHomePaths(nv, []), nv, '#1845 guard window: a run straddling the window start is read whole (the spelling inside a hidden value stays)');
      const left = 'see ' + fill(W + 52) + '/~alicez/src/x end';
      assert.strictEqual(readOf(left), left.length - 4, `#1845 guard window: the start moves out to the run's start (${readOf(left)} of ${left.length - 4})`);
      const right = 'see ~alicez/src/' + fill(W + 52) + ' end';
      assert.strictEqual(readOf(right), right.length - 4, `#1845 guard window: the end moves out to the run's end (${readOf(right)} of ${right.length - 4})`);
      // bounded: a run longer than the cap on both sides is read up to one more window each side, and the spelling there is rewritten as before
      const long = 'x ' + fill(8 * W) + '/~alicez/src/' + fill(8 * W) + ' y';
      assert.strictEqual(readOf(long), 4 * W + '~alicez'.length, `#1845 guard window: the move is capped at one more window each side (${readOf(long)} characters)`);
      assert.strictEqual(maskHomePaths(long, []), long.replace('~alicez', '~'), '#1845 guard window: a spelling inside a run longer than the cap is rewritten as before');
      // the edge scan is bounded: one spelling steps over at most one window on each side; spellings dense in one long run (no blank) are read once in all
      // and their edges are moved only where the windows did not overlap already
      const e0 = _guardEdgeScanForTest();
      maskHomePaths(long, []);
      assert.ok(_guardEdgeScanForTest() - e0 <= 2 * W, `#1845 guard edge work: one spelling steps over at most one window each side (${_guardEdgeScanForTest() - e0})`);
      const denseRun = 'x ' + '/~alicez/src/q'.repeat(20_000) + ' y';
      const e1 = _guardEdgeScanForTest();
      const r1 = readOf(denseRun);
      assert.ok(r1 <= denseRun.length && _guardEdgeScanForTest() - e1 <= 2 * W, `#1845 guard edge work: spellings dense in one run read it once and move two edges (${r1} of ${denseRun.length}, ${_guardEdgeScanForTest() - e1} steps)`);
    }
    const r0 = _homeGuardReadsForTest();
    maskHomePaths('plain text with /home/alicez/x and C:\\Users\\bob\\y', []);
    assert.strictEqual(_homeGuardReadsForTest() - r0, 0, '#1329 F1 work: a text with no new home spelling is not read by redact');
    maskHomePaths('see ~alicez/src/x', []);
    assert.strictEqual(_homeGuardReadsForTest() - r0, 1, '#1329 F1 work: one read when a new spelling matched');
  }
  // cost: linear on dense prefixes and dense encoded separators (FR-183's rule)
  assertLinearShape('#1329 redact many lookalike prefixes', (x) => { redact(x, {}); }, (k) => ('gh\u0440_a\uff47\uff48p_' + B36.slice(0, 3) + ' ').repeat(Math.ceil(k / 16)).slice(0, k), 400_000);
  assertLinearShape('#1329 maskHomePaths many encoded separators', (x) => { maskHomePaths(x, []); }, (k) => '%2Fhome%2Fa%25%2'.repeat(Math.ceil(k / 16)).slice(0, k), 400_000);
  assertLinearShape('#1329 maskHomePaths many tilde paths', (x) => { maskHomePaths(x, []); }, (k) => '~ab/cd/e '.repeat(Math.ceil(k / 9)).slice(0, k), 400_000);
  assertLinearShape('#1329 maskHomePaths a long tilde word', (x) => { maskHomePaths(x, []); }, (k) => ('~a/' + 'b'.repeat(k)).slice(0, k), 400_000);
}

console.log('redact: all checks passed');
