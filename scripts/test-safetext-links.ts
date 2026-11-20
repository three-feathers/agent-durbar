/** Spec 012 FR-189 (issue #1940): the desk masks and a token split by link or image markup. `npm run test:safetext-links`. No credits spent. Invented values, built from pieces. */
import './safetext-shared'; // the compiled hidden-character module for safetext.js (spec 084 FR-033)
import assert from 'assert';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { redact, maskSecretCommand, maskSecretUrl, withoutShell, withoutLoose, maskLoose, withoutAfterMask, maskLinkSplitTokens, withoutLinkSplit } from '../src/shared/redact';
import { cases1593 } from './safetext-1593-corpus';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, max: number) => string };
const S = require(path.join(R, 'safetext.js')) as {
  create(o: { redact?: ((s: string) => string) | null; cut?: ((s: string, n: number) => string) | null }): { mask(t: unknown): string; excerpt(t: unknown, n: number, fb?: string): string; plain(t: unknown): string; ready: boolean };
  excerpt(raw: unknown, redact: unknown, n?: number, codeWord?: boolean): string;
  maskLabel(raw: unknown, kind: string, mask: Record<string, unknown>): string;
  maskRaw(raw: unknown, redact: unknown): string;
};
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.strictEqual(a, b, m); n++; };
// token shapes built at run time (push protection); the same as scripts/test-safetext.ts, so the shared random texts are the same
const ghp = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const pat = 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij';
const sk = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

// two parts, each its own suite under ~30 s (`npm run test:safetext-links` and `test:safetext-links-labels`): the labels' differential runs only in the second
const LABELS = process.argv[2] === 'labels';
// spec 012 FR-189 (issue #1940): a token split by link or image markup on the plain-text surfaces (invented values, built from pieces)
if (!LABELS) {
  const shared = require('../src/shared/redact') as { maskLinkSplitTokens(t: unknown): string; _linkWorkForTest(): number; _linkPassesForTest(): number; withoutSplit<X>(f: () => X): X };
  const red = (t: string): string => redact(t);
  const T = S.create({ redact: red });
  const aws = 'AK' + 'IA' + 'Q7R2T5V8X3Z6B9D4';
  const toks: Array<[string, string]> = [['a GitHub token', ghp], ['a project key', sk], ['a cloud key id', aws]];
  const forms: Array<[string, (l: string) => string]> = [
    ['a full reference link', (l) => `[${l}][r]`],
    ['a collapsed reference link', (l) => `[${l}][]`],
    ['a shortcut reference link', (l) => `[${l}]`],
    ['a full reference image', (l) => `![${l}][r]`],
    ['a collapsed reference image', (l) => `![${l}][]`],
    ['a shortcut reference image', (l) => `![${l}]`],
    ['nested brackets in the link text', (l) => `[a[b]${l}](https://e.x)`],
    ['nested brackets at the end of the link text', (l) => `[a[${l}]](https://e.x)`],
    ['a ) inside the target', (l) => `[${l}](https://e.x/(a))`],
    ['an angle autolink', (l) => `<https://e.x/${l}>`],
    ['an angle autolink holding the first part', () => '>'], // with the head below: `<https://e.x/` + head + `>` + rest
    ['an angle target', (l) => `[${l}](<https://e.x>)`],
    ['a target with a title', (l) => `[${l}](https://e.x "t t")`],
    ['a footnote marker', (l) => `[^${l}]`],
    ['a long raw img tag', (l) => `<img src="https://e.x/${'q'.repeat(300)}.png" alt="${l}">`],
    ['an HTML element', (l) => `<span>${l}</span>`],
  ];
  const wraps: Array<[string, (t: string) => string]> = [['in a sentence', (t) => `Your key is ${t} ok`], ['in a list item', (t) => `- item ${t}\n- next`]];
  const shows = (out: string, tok: string): string | undefined => { for (let i = 4; i + 8 <= tok.length; i++) if (out.includes(tok.slice(i, i + 8))) return tok.slice(i, i + 8); return undefined; };
  const label = { cmd: (x: string) => maskSecretCommand(x, {}), url: (x: string) => maskSecretUrl(x, {}), redact: red };
  for (const [tn, tok] of toks) for (const [fn, f] of forms) for (const [wn, w] of wraps) for (const l of ['y', '']) for (const c of [9, tok.length - 5]) {
    const t = w((fn === 'an angle autolink holding the first part' ? '<https://e.x/' : '') + tok.slice(0, c) + f(l) + tok.slice(c));
    const where = `${tn}, ${fn}, ${wn}, cut at ${c}${l ? '' : ', no text'}`;
    for (const [sn, out] of [['excerpt', S.excerpt(t, red, 600)], ['maskRaw', S.maskRaw(t, red)], ['the wrapper excerpt', T.excerpt(t, 600)], ['the wrapper mask', T.mask(t)], ['a tool label', S.maskLabel(t, 'other', label)]] as Array<[string, string]>) {
      const p = shows(out, tok);
      ok(p === undefined, `#1940 ${sn} hides a token split by ${where}: ${p}`);
    }
  }
  // near misses: link and image markup that splits no token is shown as before (the shared step leaves it byte for byte)
  const near = [
    'See [the docs](https://example.com/a_(b)) and [ref][r].\n\n[r]: https://example.com',
    '- [x] done\n- [ ] todo',
    'Use `arr[i](j)` or <https://example.com/path> or <me@example.com>',
    'Image ![alt text](img.png "title") here [^1].\n\n[^1]: footnote',
    'a <b>bold</b> <img src="x.png"> word and <span>config_value_name</span>',
    '[redacted] and ![redacted](x) and [redacted][r]',
    'array[index_value_long](callback_name_long) map[key_long_name_x]',
    '[Version_2.1.3_release][notes] and [CHANGELOG_entry_long]',
    'path/to/[slug]/page_name_long.tsx and (group)/[id]/route.ts',
  ];
  for (const t of near) eq(shared.maskLinkSplitTokens(t), t, `#1940 near miss kept byte for byte by the shared step: ${t.slice(0, 40)}`);
  eq(S.excerpt(near[0], red, 600), 'See the docs) and [ref][r]. [r]: https://example.com', '#1940 near miss: the excerpt of a text with links is as before');
  eq(S.maskRaw(near[4], red), near[4], '#1940 near miss: maskRaw of a text with tags is as before');
  // the readings as before (the split step off) do not read it
  const one = 'x ' + ghp.slice(0, 12) + '[y][r]' + ghp.slice(12) + ' z';
  eq(shared.withoutSplit(() => shared.maskLinkSplitTokens(one)), one, '#1940 with the split step off the shared step reads nothing');
  eq(shared.maskLinkSplitTokens(one), 'x [redacted] z', '#1940 the shared step masks the stretch as written, the markup between its pieces included');
  // the gate: a letter or digit joined to a letter or digit across a removed piece is read (a tail of two, and of one: review of PR 1949, F3); a link before a
  // blank or a full stop joins nothing and costs no mask pass (F4)
  for (const [tn, tok] of toks) eq(shared.maskLinkSplitTokens('x ' + tok.slice(0, -2) + '[y][r]' + tok.slice(-2) + ' z'), 'x [redacted] z', `#1940 a tail of two after the link is read with the token (${tn})`);
  for (const [tn, tok] of toks) for (const [fn, f] of [['a full reference', '[][r]'], ['a collapsed reference', '[][]'], ['a full reference image', '![][r]'], ['a footnote mark', '[^]'], ['an inline link', '[](u)'], ['an inline image', '![](u)']]) {
    const t = tok.slice(0, -1) + f + tok.slice(-1) + ' ok';
    eq(shared.maskLinkSplitTokens(t), '[redacted] ok', `#1940 a one-character tail after ${fn} is read with the token (${tn})`);
    for (const [kind, out] of [['other', S.maskLabel(t, 'other', label)], ['run', S.maskLabel(t, 'run', label)]]) ok(!out.includes(tok.slice(-9, -1)) && !out.includes(tok.slice(4, 12)), `#1940 the ${kind} label hides a token with a one-character tail after ${fn} (${tn}): ${out}`);
  }
  // the gate (review of PR 1949, round 2): a piece between two blanks or between punctuation joins nothing and costs no mask pass; a link before a full stop
  // costs a pass in the readings that keep its text (a token's own `.` can stand there) and masks nothing
  shared._linkPassesForTest();
  eq(shared.maskLinkSplitTokens('a [](u) b, then (c) and [] d; [-](y) - ok, ../[](u)/.. =[^]:'), 'a [](u) b, then (c) and [] d; [-](y) - ok, ../[](u)/.. =[^]:', '#1940 pieces between blanks are kept');
  eq(shared._linkPassesForTest(), 0, '#1940 pieces between blanks or punctuation join nothing and cost no mask pass');
  eq(shared.maskLinkSplitTokens('See [docs](u).'), 'See [docs](u).', '#1940 a link before a full stop is kept');
  eq(shared._linkPassesForTest(), 2, '#1940 a link before a full stop costs a pass in the two readings that keep its text');
  // a target or a link text ends on its own line (a bracket on the next line is no end), and a long one is read to its end
  eq((shared.maskLinkSplitTokens('.-[](x\ny)-.'), shared._linkPassesForTest()), 0, '#1940 a target is not matched across a line break');
  eq(shared.maskLinkSplitTokens('x ' + ghp.slice(0, 12) + '[y](https://e.x/' + 'q'.repeat(600) + ')' + ghp.slice(12) + ' z'), 'x [redacted] z', '#1940 a token split by a link with a long target is hidden');
  // a secret name split by a link, then a separator and its value (review of PR 1949, F2): the value is hidden on every desk surface
  for (const t of ['Run: pas[][r]sword: Hx9Kq2Lm7Np4Rs now', 'tok[^]en: Hx9Kq2Lm7Np4Rs now', 'mys[][r]ql -pHx9Kq2Lm7Np4Rs', 'sec[][r]ret_key = "Hx9Kq2Lm7Np4Rs"', 'pass[w](u)word=Hx9Kq2Lm7Np4Rs ok', 'api<b></b>_key: Hx9Kq2Lm7Np4Rs'])
    for (const [sn, out] of [['excerpt', S.excerpt(t, red, 600)], ['maskRaw', S.maskRaw(t, red)], ['the wrapper excerpt', T.excerpt(t, 600)], ['a tool label', S.maskLabel(t, 'other', label)], ['a command label', S.maskLabel(t, 'run', label)]] as Array<[string, string]>)
      ok(!out.includes('Hx9Kq2Lm'), `#1940 ${sn} hides the value after a secret name split by a link (${t.replace('Hx9Kq2Lm7Np4Rs', '<value>')}): ${out}`);
  // a split right beside a token's own `:` or `.` (review of PR 1949, round 2, N1), and markup between a separator and its value (N2): hidden on every desk surface
  {
    const kb = 'AAZq3Wd8' + 'Kp2Lm5Rt7Yx4Bn6Hj9Fc1Vg0Ts3', jh = 'ey' + 'JhbGciOiJIUzI1NiJ9', jp = 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0', js = 'Xk9Lp2Qr7St4Uv1Wx8Yz5Ab3Cd6Ef0Gh', v = 'Hx9Kq2Lm7Np4Rs';
    const bot = '123456789';
    const cases = ['key ' + bot + '[][r]:' + kb + ' ok', 'key ' + bot + ':[^]' + kb + ' ok', 'key ' + bot + '[]:' + kb + ' ok', 'key ' + bot + '[](u):' + kb + ' ok', 'key ' + bot + '![](u):' + kb + ' ok', 'pass' + 'word=' + bot + '<img src="x">:' + kb,
      jh + '[^].' + jp + '.' + js, jh + '.' + jp + '[](u).' + js, jh + '.[^]' + jp + '.' + js,
      'Run: pass' + 'word: [](u)' + v + ' now', 'token: [](u)' + v, 'pass' + 'word=[](u)' + v, 'API_KEY=[](u)' + v, 'secret_key = "[](u)' + v + '"', 'pass' + 'word=[^]' + v, 'pass' + 'word: [^]' + v, 'token: [^]' + v, 'API_KEY=[^]' + v, 'secret_key = "[^]' + v + '"'];
    for (const t of cases) for (const [sn, out] of [['excerpt', S.excerpt(t, red, 600)], ['maskRaw', S.maskRaw(t, red)], ['the wrapper excerpt', T.excerpt(t, 600)], ['a tool label', S.maskLabel(t, 'other', label)], ['a command label', S.maskLabel(t, 'run', label)]] as Array<[string, string]>)
      ok(!/Hx9Kq2Lm|Kp2Lm5Rt|JzdWIiOi|Xk9Lp2Qr|zI1NiJ9/.test(out), `#1940 ${sn} hides a split beside a token's own mark or markup before a value (${t.replace(v, '<value>').slice(0, 30)}): ${out}`);
  }
  // an environment value (the runner's own values are one: CI sets several, review of PR 1949 round 3): the masks hide it on every desk surface, with the link step
  // and without it alike, and one split by a link is hidden too (the link step's mask passes read the environment). The fixtures above use invented hosts and names
  {
    const name = 'LINKTEST_SERVER_URL', value = 'https://code.example.invalid/' + 'acme-widget';
    const had = Object.prototype.hasOwnProperty.call(process.env, name), old = process.env[name];
    process.env[name] = value;
    try {
      const plain = 'See [the docs](' + value + '/docs) now', split = 'See ' + value.slice(0, 20) + '[](u)' + value.slice(20) + ' now';
      for (const t of [plain, split]) for (const [sn, f] of [['maskRaw', () => S.maskRaw(t, red)], ['excerpt', () => S.excerpt(t, red, 600)], ['a tool label', () => S.maskLabel(t, 'other', label)]] as Array<[string, () => string]>) {
        const out = f();
        ok(!out.includes(value.slice(14, 26)) && !out.includes(value.slice(20)), `#1940 ${sn} hides an environment value${t === split ? ' split by a link' : ''}: ${out}`);
        if (t === plain) eq(out, withoutLinkSplit(f), `#1940 ${sn} of a text with an environment value reads as with the link step off`);
      }
    } finally { if (had) process.env[name] = old; else delete process.env[name]; }
  }
  // a text that holds an open mask label and a token split by a link (review of PR 1949, F1): the desk fails closed as it did before the link step
  {
    const t = ghp.slice(0, 16) + '[redacted:] ' + ghp.slice(16, 24) + ' and ' + ghp.slice(0, 12) + '[y][r]' + ghp.slice(12);
    eq(S.excerpt(t, red, 600), '', '#1940 an open mask label in the text: the excerpt fails closed');
    eq(T.excerpt(t, 600), 'Finished.', '#1940 an open mask label in the text: the wrapper excerpt shows its fallback word');
    eq(S.maskRaw(t, red), withoutLinkSplit(() => S.maskRaw(t, red)) === '' ? '' : S.maskRaw(t, red), '#1940 an open mask label in the text: maskRaw fails closed where the desk did before');
  }
  // benign Markdown stays as written on the desk (the link step masks nothing in it, and reads as with it off)
  for (const t of [
    'See the [README](README.md#install) and the [docs][d], then run `npm test`.\n\n[d]: https://example.com/docs',
    '![screenshot](docs/shots/lobby_1440x900.png "The lobby") shows the [Real office](specs/097-real-office/spec.md).',
    '| file | note |\n|---|---|\n| [safetext.js](src/renderer/safetext.js) | the desk masks |',
    '- [x] [Spec 012](specs/012-claude-codex-adapters/spec.md)[^1]\n- [ ] <https://code.example.invalid/acme/widget-tool> <b>bold</b>\n\n[^1]: a note',
    'Use [`maskRaw`](src/renderer/safetext.js)_and_ [this][link_ref_name] or <kbd>Ctrl</kbd>+<kbd>K</kbd>.',
  ]) {
    eq(S.maskRaw(t, red), t, `#1940 benign Markdown: maskRaw keeps it as written: ${t.slice(0, 40)}`);
    eq(S.excerpt(t, red, 600), withoutLinkSplit(() => S.excerpt(t, red, 600)), `#1940 benign Markdown: the excerpt reads as with the link step off: ${t.slice(0, 40)}`);
    eq(S.maskLabel(t, 'other', label), withoutLinkSplit(() => S.maskLabel(t, 'other', label)), `#1940 benign Markdown: the label reads as with the link step off: ${t.slice(0, 40)}`);
  }
  eq(shared.maskLinkSplitTokens('See <https://example.com/a_long_path_name>. Then [docs][r].'), 'See <https://example.com/a_long_path_name>. Then [docs][r].', '#1940 a link before a full stop is no joined token');
  // a link whose text is one character of a fixed-length token, with a reference label: only the reading that drops the label alone joins it
  const aws1 = 'x ' + aws.slice(0, 10) + '[' + aws[10] + '][r]' + aws.slice(11) + ' z';
  eq(shared.maskLinkSplitTokens(aws1), 'x [redacted] z', '#1940 a fixed-length key whose link text is one of its characters, with a label, is hidden');
  // a secret name split by a link: the value after it is hidden (its run is joined across the removed piece); the name stays as written
  eq(shared.maskLinkSplitTokens('pass[w][r]ord=Hx9Kq2Lm7Np4Rs ok'), 'pass[w][r]ord=[redacted] ok', '#1940 a value after a secret name split by a link is hidden');
  eq(shared.maskLinkSplitTokens('see [docs][r] then Hx9Kq2Lm7Np4Rs[y]ok'), 'see [docs][r] then Hx9Kq2Lm7Np4Rs[y]ok', '#1940 a run joined across a link that the rules do not hide is kept');
  // a mask the text already holds stays whole (its brackets are no link syntax), so the rule for a value glued after a mask still reads it across a link
  eq(shared.maskLinkSplitTokens('[redacted][y]' + ghp.slice(4)), '[redacted][redacted]', '#1940 a value glued after a mask across a link is hidden, the mask kept whole');
  eq(shared.maskLinkSplitTokens('[redacted][y]plain words'), '[redacted][y]plain words', '#1940 words after a mask and a link are kept');
  // bounded: the work is counted and linear (a work counter, not a clock), on shapes that make each part read as far as it can
  const shapes: Array<[string, (n: number) => string]> = [
    ['many openings', (k) => '['.repeat(k)],
    ['many targets never closed', (k) => '](a'.repeat(k)],
    ['many footnote marks never closed', (k) => '[^a'.repeat(k)],
    ['many labels never closed', (k) => '][a'.repeat(k)],
    ['many tags never closed', (k) => '<a b'.repeat(k)],
    ['many opening tags', (k) => '<a>b'.repeat(k)],
    ['many links around token pieces', (k) => (ghp.slice(0, 12) + '[y][r]' + ghp.slice(12) + ' ').repeat(k)],
    ['many target openings (review of PR 1949, F5)', (k) => ']('.repeat(k)],
    ['many target openings with a closing far off', (k) => ('](' + '('.repeat(200) + ')').repeat(k)],
    ['many nested openings with a closing far off', (k) => ('[' + '['.repeat(200) + ']').repeat(k)],
  ];
  for (const [sn, mk] of shapes) {
    const small = mk(4000), big = mk(32000);
    shared._linkWorkForTest();
    shared.maskLinkSplitTokens(small);
    const ws = shared._linkWorkForTest();
    shared.maskLinkSplitTokens(big);
    const wb = shared._linkWorkForTest();
    ok(ws >= 3 * small.length && wb <= 9 * ws && wb <= 12 * big.length, `#1940 the shared step's work grows linearly (${sn}): ${ws} then ${wb} for 8 times the text`);
  }
}
// the differential with the link step on: over the random texts of the #1593 differential (and two bracket-heavy shapes), every text the link step changes
// shows no piece (maskRaw, the wrapper mask) that the frozen main copy does not show, and no 8 characters of a secret (the excerpts, whose cut can fall
// elsewhere) that main's uncut excerpt hides. scripts/test-safetext.ts checks the same texts with the step off, byte for byte as before.
{
  const ENV = {}; // an empty environment for the masks of this test (the environment's secrets are read per call; the link step reads them once per call itself)
  const red = (t: string): string => redact(t, ENV);
  const T = S.create({ redact: red, cut: cutText });
  const label = { cmd: (x: string) => maskSecretCommand(x, {}), url: (x: string) => maskSecretUrl(x, {}), redact: red };
  const refFile = path.join(ROOT, 'scripts', 'fixtures', 'safetext-1593-main-ref.js');
  const refText = fs.readFileSync(refFile, 'utf8').replace(/\r\n/g, '\n');
  eq(crypto.createHash('sha256').update(refText, 'utf8').digest('hex'), '4a1856a6ff14310d9354e7c2e3cae0f1aa6eef742f75c73330c9d46e79191a27', '#1940 differential: the frozen copy is unchanged');
  const R0 = require(refFile) as typeof S & { useShared(m: unknown): boolean; create: typeof S.create };
  R0.useShared(require('../src/shared/redact'));
  const { cases, z } = cases1593(ghp, pat, sk);
  const SECRETS = [ghp.slice(4), pat.slice(11), sk.slice(3), z.slice(4), 'Hx9Kq2Lm7Np4Rs'];
  const ref = (f: () => string): string => withoutAfterMask(() => maskLoose(withoutLoose(() => withoutShell(f))));
  const cutAt = /\s+|\[redacted(?::[^\]\r\n]{1,128})?\]/;
  let lnk = 0;
  let other = 0;
  const planted = [ghp.slice(0, 16) + '[redacted:] ' + ghp.slice(16, 24) + 'xYz', 'x ' + pat.slice(0, 30) + '[y][r]' + pat.slice(30) + ' [redacted: ' + pat.slice(0, 40) + ' and ' + pat, ghp.slice(0, 12) + '[^]' + ghp.slice(12) + ' [redacted:a'];
  for (const t of [...cases, '['.repeat(20_000), '[x]('.repeat(5_000), ...planted]) {
    const where = JSON.stringify(t.slice(0, 60));
    if (!/[[\]<]/.test(t) || (maskLinkSplitTokens(t) === t && withoutShell(() => maskLinkSplitTokens(t)) === t)) {
      // a text the link step leaves as it is reads the same with the step on and off (test-safetext.ts checks it with the step off)
      if (!LABELS) eq(S.maskRaw(t, red), withoutLinkSplit(() => S.maskRaw(t, red)), `#1940 differential: maskRaw of a text the link step leaves reads as with the step off: ${where}`);
      other++;
      continue;
    }
    lnk++;
    const pieceCheck = (h: string, r: string, what: string): void => { const shown = r.split(cutAt).join('\u0000'); for (const p of h.split(cutAt)) assert.ok(p === '' || shown.includes(p), `#1940 differential: ${what} shows nothing main hides: ${where}: ${JSON.stringify(p)}`); };
    // the wrapper's mask is maskRaw with the same redact (one code path), so maskRaw stands for both; the wrapper excerpt is the excerpt with the code word
    // where main gives nothing (fails closed), the head gives nothing too (review of PR 1949, F1); the labels too
    const pc = (h: string, r: string, what: string): void => { if (r === '') eq(h, '', `#1940 differential: ${what} fails closed where main does: ${where}`); else pieceCheck(h, r, what); };
    if (LABELS) {
      // the labels against the head with the link step off (main's label since FR-184/185 differs from the frozen copy's; with the step off the head is main's)
      pc(S.maskLabel(t, 'other', label), withoutLinkSplit(() => S.maskLabel(t, 'other', label)), 'a tool label');
      pc(S.maskLabel(t, 'run', label), withoutLinkSplit(() => S.maskLabel(t, 'run', label)), 'a command label');
      continue;
    }
    pc(S.maskRaw(t, red), ref(() => R0.maskRaw(t, red)), 'maskRaw');
    if (ref(() => R0.excerpt(t, red, 140)) === '') eq(S.excerpt(t, red, 140), '', `#1940 differential: the excerpt fails closed where main does: ${where}`);
    const all = ref(() => R0.excerpt(t, red, undefined, true)), allPlain = ref(() => R0.excerpt(t, red));
    for (const [what, h, a] of [['excerpt', S.excerpt(t, red, 140), allPlain], ['the wrapper excerpt', T.excerpt(t, 140), all]] as Array<[string, string, string]>) {
      const shown = a.replace(/\s+/g, ''), hs = h.replace(/\s+/g, '');
      for (const sec of SECRETS) for (let i = 0; i + 8 <= sec.length; i++) if (hs.includes(sec.slice(i, i + 8))) assert.ok(shown.includes(sec.slice(i, i + 8)), `#1940 differential: ${what} shows no secret main hides: ${where}: ${sec.slice(i, i + 8)}`);
    }
  }
  ok(lnk >= 500 && lnk + other === cases.size + 2 + planted.length, `#1940 differential: ${lnk} texts the link step changes show nothing main hides; ${other} others read as with the step off`);
}
console.log(`safetext-links${LABELS ? ' (labels)' : ''}: ${n} checks passed`);
