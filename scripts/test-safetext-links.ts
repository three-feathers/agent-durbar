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

// spec 012 FR-189 (issue #1940): a token split by link or image markup on the plain-text surfaces (invented values, built from pieces)
{
  const shared = require('../src/shared/redact') as { maskLinkSplitTokens(t: unknown): string; _linkWorkForTest(): number; withoutSplit<X>(f: () => X): X };
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
  // the gate: a run joined across a removed piece with two letters or digits after it is read (a tail of two), one with none is not (a link before a full stop)
  for (const [tn, tok] of toks) eq(shared.maskLinkSplitTokens('x ' + tok.slice(0, -2) + '[y][r]' + tok.slice(-2) + ' z'), 'x [redacted] z', `#1940 a tail of two after the link is read with the token (${tn})`);
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
  ];
  for (const [sn, mk] of shapes) {
    const small = mk(4000), big = mk(32000);
    shared._linkWorkForTest();
    shared.maskLinkSplitTokens(small);
    const ws = shared._linkWorkForTest();
    shared.maskLinkSplitTokens(big);
    const wb = shared._linkWorkForTest();
    ok(ws >= 3 * small.length && wb <= 9 * ws && wb <= 3 * 1100 * big.length, `#1940 the shared step's work grows linearly (${sn}): ${ws} then ${wb} for 8 times the text`);
  }
}
// the differential with the link step on: over the random texts of the #1593 differential (and two bracket-heavy shapes), every text the link step changes
// shows no piece (maskRaw, the wrapper mask) that the frozen main copy does not show, and no 8 characters of a secret (the excerpts, whose cut can fall
// elsewhere) that main's uncut excerpt hides. scripts/test-safetext.ts checks the same texts with the step off, byte for byte as before.
{
  const ENV = {}; // an empty environment for the masks of this test (the environment's secrets are read per call; the link step reads them once per call itself)
  const red = (t: string): string => redact(t, ENV);
  const T = S.create({ redact: red, cut: cutText });
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
  for (const t of [...cases, '['.repeat(20_000), '[x]('.repeat(5_000)]) {
    const where = JSON.stringify(t.slice(0, 60));
    if (!/[[\]<]/.test(t) || (maskLinkSplitTokens(t) === t && withoutShell(() => maskLinkSplitTokens(t)) === t)) {
      // a text the link step leaves as it is reads the same with the step on and off (test-safetext.ts checks it with the step off)
      eq(S.maskRaw(t, red), withoutLinkSplit(() => S.maskRaw(t, red)), `#1940 differential: maskRaw of a text the link step leaves reads as with the step off: ${where}`);
      other++;
      continue;
    }
    lnk++;
    const pieceCheck = (h: string, r: string, what: string): void => { const shown = r.split(cutAt).join('\u0000'); for (const p of h.split(cutAt)) assert.ok(p === '' || shown.includes(p), `#1940 differential: ${what} shows nothing main hides: ${where}: ${JSON.stringify(p)}`); };
    // the wrapper's mask is maskRaw with the same redact (one code path), so maskRaw stands for both; the wrapper excerpt is the excerpt with the code word
    pieceCheck(S.maskRaw(t, red), ref(() => R0.maskRaw(t, red)), 'maskRaw');
    const all = ref(() => R0.excerpt(t, red, undefined, true)), allPlain = ref(() => R0.excerpt(t, red));
    for (const [what, h, a] of [['excerpt', S.excerpt(t, red, 140), allPlain], ['the wrapper excerpt', T.excerpt(t, 140), all]] as Array<[string, string, string]>) {
      const shown = a.replace(/\s+/g, ''), hs = h.replace(/\s+/g, '');
      for (const sec of SECRETS) for (let i = 0; i + 8 <= sec.length; i++) if (hs.includes(sec.slice(i, i + 8))) assert.ok(shown.includes(sec.slice(i, i + 8)), `#1940 differential: ${what} shows no secret main hides: ${where}: ${sec.slice(i, i + 8)}`);
    }
  }
  ok(lnk >= 500 && lnk + other === cases.size + 2, `#1940 differential: ${lnk} texts the link step changes show nothing main hides; ${other} others read as with the step off`);
}
console.log(`safetext-links: ${n} checks passed`);
