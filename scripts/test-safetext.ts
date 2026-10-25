/** Agent text on the office floor (spec 041 FR-065, issue #541): mask first, then plain, then cut; fails closed. `npm run test:safetext`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { redact, maskSecretCommand, maskSecretUrl } from '../src/shared/redact';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, max: number) => string };
const S = require(path.join(R, 'safetext.js')) as {
  create(o: { redact?: ((s: string) => string) | null; cut?: ((s: string, n: number) => string) | null }): { mask(t: unknown): string; excerpt(t: unknown, n: number, fb?: string): string; plain(t: unknown): string; ready: boolean };
  plain(t: unknown, codeWord?: boolean): string;
  plainKeep(t: unknown, codeWord?: boolean): string;
  unesc(t: unknown): string;
  excerpt(raw: unknown, redact: unknown, n?: number, codeWord?: boolean): string;
  maskLabel(raw: unknown, kind: string, mask: Record<string, unknown>): string;
};
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const DurbarCutText_ = (t: string, n: number): string => cutText(t, n);
const eq = (a: unknown, b: unknown, m: string) => { assert.strictEqual(a, b, m); n++; };

// token shapes built at run time (push protection)
const ghp = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const pat = 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij';
const sk = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const T = S.create({ redact: (s) => redact(s, {}), cut: cutText });
const secrets = [ghp, pat, sk];
const hasSecret = (t: string) => secrets.some((x) => t.includes(x) || t.includes(x.replace(/[_*`]/g, '')) || t.includes(x.slice(0, 14)));

// the whole point: the order. Markdown stripping first would turn ghp_... into ghp... and the pattern would miss it
const raw = `**Done.** The token is ${ghp} and \`${pat}\` and *${sk}*.`;
ok(!hasSecret(T.excerpt(raw, 300)), 'no token in the excerpt');
const wrong = cutText(T.plain(raw), 300); // plain first (the old order)
ok(redact(wrong, {}).includes('ghp') && hasSecret(redact(wrong, {})), 'the old order (plain, then redact) really leaks: the test can tell the orders apart');
for (const s of secrets) ok(!T.mask(`x ${s} y`).includes(s), 'mask hides ' + s.slice(0, 6));

// tokens glued to an underscore or a word (the shapes of spec 012 T127/T128, #543): masked before the text is made plain
for (const t of [`_${ghp}_`, `my_${sk}`, `my_${pat}_x`]) {
  const out = T.excerpt(`value ${t} end`, 300);
  ok(!hasSecret(out) && !out.includes('A1b2C3'), `glued token masked: ${out}`);
}

// a cut that lands inside a token: the token is masked before the cut, so no half token stays
for (let cutAt = 10; cutAt < 90; cutAt += 7) {
  const t = 'a'.repeat(cutAt) + ' ' + ghp + ' tail';
  const out = T.excerpt(t, cutAt + 12);
  ok(!/gh+p_?A1b2/.test(out) && !out.includes('A1b2C3d4'), `cut at ${cutAt}: no part of the token`);
}

// text that is not secret reads as before (Markdown gone, whitespace collapsed, cut with the ellipsis)
eq(T.excerpt('**Done.**   `registry.ts` is _ready_', 100), 'Done. registry.ts is ready', 'plain');
eq(T.excerpt('x'.repeat(50), 10), 'x'.repeat(9) + '…', 'cut');
eq(T.excerpt(null, 10), '', 'null');
eq(T.excerpt('', 10), '', 'empty');
eq(T.mask(null), '', 'mask null');

// fails closed: no redact function, never the raw text
const none = S.create({ redact: null, cut: cutText });
eq(none.excerpt(raw, 300), 'Finished.', 'no redact: neutral word');
eq(none.excerpt(raw, 300, 'Error'), 'Error', 'no redact: the caller word');
eq(none.mask(raw), '', 'no redact: mask gives nothing');
eq(S.create({}).excerpt(raw, 300), 'Finished.', 'no options at all');
const boom = S.create({ redact: () => { throw new Error('x'); }, cut: cutText });
eq(boom.excerpt(raw, 300), 'Finished.', 'a throwing redact fails closed');
eq(boom.mask(raw), '', 'a throwing redact: mask gives nothing');

// time: 200k characters, generous limit
{
  const big = ('word ' + ghp + ' ').repeat(5000);
  const t0 = Date.now();
  const out = T.excerpt(big, 140);
  ok(Date.now() - t0 < 5000, '200k characters in under 5 s');
  ok(!hasSecret(out), 'big input masked');
}

// tokens that Markdown breaks up: an escaped underscore, a backtick or emphasis inside the token (FR-065, review of #567)
{
  const tail = ghp.slice(4);
  const skTail = sk.slice(8);
  const cases: Array<[string, string]> = [
    [`token: gh${'p'}\\_${tail}`, 'escaped underscore'],
    [`gh\`p_${tail}\` done`, 'backtick inside'],
    [`use sk-proj_*${skTail}* now`, 'emphasis after the underscore'],
    [`**Done.** ${ghp} and \`snake_case\``, 'plain control'],
  ];
  for (const [txt, what] of cases) {
    const out = T.excerpt(txt, 300);
    ok(!/A1b2C3d4|AbCdEfGh/.test(out) && !/ghp|sk-proj/i.test(out.replace('[redacted]', '')), `${what}: ${out}`);
  }
  eq(T.excerpt(`**Done.** ${ghp} and \`snake_case\``, 300), 'Done. [redacted] and snakecase', 'the control keeps its words');
  eq(S.unesc('a\\_b \\* \\`'), 'a_b * `', 'unesc');
  eq(S.plainKeep('a_b *c* `d`'), 'a_b c d', 'plainKeep keeps the underscore');
  eq(S.plain('a_b *c* `d`'), 'ab c d', 'plain drops it');
  eq(T.mask(`x gh\`p_${tail}\` y`).includes('A1b2C3d4'), false, 'mask also catches the split token');
  eq(T.mask('a_b *c* `d`'), 'a_b *c* `d`', 'mask leaves an ordinary text as it is');
}
// a token split by Markdown LATE (20+ characters in): the first mask must not run on text that an earlier mask already changed
{
  const norm = (x: string): string => x.replace(/[_\-*`~[\]()\\#>\s]/g, '');
  const marks: Array<[string, string, string]> = [['*', '*', '*'], ['`', '`', '`'], ['**', '**', '**'], ['~~', '~~', '~~'], ['link', '[', '](http://u.test)']];
  let cases = 0;
  for (const tok of [ghp, pat, sk]) {
    for (const [name, open, close] of marks) {
      for (let i = 20; i <= 36 && i < tok.length - 8; i += 2) {
        const split = tok.slice(0, i) + open + tok.slice(i, i + 8) + close + tok.slice(i + 8);
        const tail = norm(tok.slice(i));
        for (const ctx of [`Saved ${split} to the vault.`, `**Done.** ${split}`]) {
          for (const [what, out] of [['excerpt', T.excerpt(ctx, 400)], ['mask', T.mask(ctx)]] as const) {
            const o = norm(out);
            for (let k = 0; k + 6 <= tail.length; k++) assert.ok(!o.includes(tail.slice(k, k + 6)), `${what} leaks "${tail.slice(k, k + 6)}" (${name}, offset ${i}): ${out}`);
            cases++;
          }
        }
      }
    }
  }
  ok(cases > 300, `split-token cases: ${cases}`);
}
// the "Since you were away" prompt: sent whole by main, so the token that starts at character 76 is masked before the cut at 80
{
  const prompt = ('Morning summary of failing checks and so on '.repeat(3)).slice(0, 75) + ' ' + ghp + ' tail';
  const out = T.excerpt(prompt, 80);
  ok(!/ghp|A1b2/i.test(out.replace('[redacted]', '')), `away prompt cut after the mask: ${out}`);
  ok(out.includes('[redacted]') || out.endsWith('…'), 'the away prompt is still cut');
  const wrong = DurbarCutText_(prompt, 80); // the old order (main cut it first) leaves a piece the pattern does not know
  ok(/ghp/.test(wrong) && !/\[redacted\]/.test(redact(wrong, {})), 'cutting first leaves "ghp_..." unmasked: the test can tell the orders apart');
}
// excerpt without n is not cut (the wrapper too)
eq(T.excerpt('word '.repeat(100), undefined as unknown as number), 'word '.repeat(100).trim(), 'create().excerpt without n does not cut');
// the stateless parts (liveact.js and the page share them)
eq(S.plain('a\n```js\nx\n```\nb'), 'a b', 'plain: a code block leaves a space');
eq(S.plain('a\n```js\nx\n```\nb', true), 'a code b', 'plain: the desk variant leaves the word "code"');
eq(S.plain('start ```never closed ghost'), 'start', 'plain: a code fence that never closes is dropped to the end');
eq(S.plain('+ one\n- two\n* three\n> four\n# five'), 'one two three four five', 'plain: list marks (+ - *), quotes and headings go');
eq(S.plain('[a link](http://x) and ![img](y) **bold** _it_ `code` ~~gone~~'), 'a link and img bold it code gone', 'plain: links, emphasis, backticks');
eq(S.excerpt('x '.repeat(100), redact_(), 10), S.excerpt('x '.repeat(100), redact_(), 10), 'excerpt: deterministic');
eq(S.excerpt(`**${ghp}**`, redact_()).includes('ghp'), false, 'excerpt: masked before plain');
eq(S.excerpt('a '.repeat(50), redact_()).length, 99, 'excerpt: no n, not cut');
eq(S.excerpt(raw, undefined), '', 'excerpt: missing redact gives nothing');
eq(S.excerpt(raw, () => { throw new Error('x'); }), '', 'excerpt: a throwing redact gives nothing');
eq(S.excerpt(raw, () => 42), '', 'excerpt: a non-string result gives nothing');
function redact_() { return (x: string) => redact(x, {}); }
// the tool label: a command, a URL and anything else are masked the way the chat chip masks them
{
  const KEY = 'Kd93' + 'LmP27xQvB' + 'w5Zt';
  const mk = { redact: (x: string) => redact(x, {}), cmd: (x: string) => maskSecretCommand(x, {}), url: (x: string) => maskSecretUrl(x, {}) };
  for (const [kind, raw, what] of [
    ['run', `curl --api-key ${KEY} https://example.test/a`, 'a flag in a command'],
    ['run', `curl -H "X-Api-Key: ${KEY}" https://example.test/a`, 'a header in a command'],
    ['fetch', `https://example.test/a?key=${KEY}`, 'a URL query'],
    ['read', `notes ${ghp} end`, 'anything else'],
  ] as const) {
    const out = S.maskLabel(raw, kind, mk);
    ok(out && !out.includes(KEY) && !out.includes(ghp), `label hides the secret in ${what}: ${out}`);
  }
  ok(redact(`curl --api-key ${KEY} https://example.test/a`, {}).includes(KEY), 'plain redact() alone misses --api-key: the label needs the command mask');
  eq(S.maskLabel('x', 'run', { redact: mk.redact }), '', 'a missing command mask fails closed');
  eq(S.maskLabel('', 'run', mk), '', 'empty label');
}
// the stored-task backstop: with no redact the wrapper reports it (the page then keeps only its own words)
eq(none.ready, false, 'no redact: not ready');
eq(T.ready, true, 'redact: ready');
// page wiring
{
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  ok(/<script src="exports-shim\.js"><\/script>\s*<script src="\.\.\/shared\/redact\.js"><\/script>\s*(?:<script src="\.\.\/shared\/answerlimits\.js"><\/script>(?:<!--[^>]*-->)?\s*)?<script src="safetext\.js"><\/script>\s*<script src="liveact\.js"><\/script>\s*<script src="app\.js">/.test(html), 'script order: exports-shim, redact, safetext, liveact, app');
  const la = fs.readFileSync(path.join(R, 'liveact.js'), 'utf8');
  ok(/ST\.plain\(t\)/.test(la) && !/replace\(\/\[\*_`~\]\//.test(la), 'liveact.js keeps no plain() of its own');
  ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes("'safetext.js'"), 'copied to dist');
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  ok(!/plainMd\(/.test(app), 'app.js has no plain-then-cut path of its own left');
  ok(!/SHORT\(plainMd/.test(app), 'no SHORT(plainMd(...))');
  ok(/function setState\(a,state,label,task\)\{\s*if\(typeof task==='string'\)task=taskMask\(task\);/.test(app), 'setState masks the stored task (backstop)');
  ok(/a\.lastOutput\?safeExcerpt\(a\.lastOutput,140\):'Finished\.'/.test(app), 'the done desk uses the excerpt helper');
}
// review of PR #614 (issue #608): removing `**` can GLUE a token to the word before it (`x**ghp_...**` -> `xghp_...`, no shape starts
// after a letter); the pass that found something else must not hide what the other pass found. Both passes are combined.
{
  const z = 'gh' + 'p_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
  const bodies = [ghp.slice(4), z.slice(4), pat.slice(11), sk.slice(3)];
  const piece = (t: string) => { for (const b of bodies) for (let i = 0; i + 6 <= b.length; i++) if (t.includes(b.slice(i, i + 6))) return b.slice(i, i + 6); return ''; };
  const glued = [
    `see x**${ghp}** and gh\`${z.slice(2)}\``, `a**${ghp}`, `x**${ghp}**`, `x**${ghp.slice(0, 24)}**${ghp.slice(24)}**`, `1*${sk}*`,
    `word~~${pat}~~ and \`${z}\`x`, `[${ghp}](u)tail`, `x**${ghp}**y and **${z.slice(0, 24)}**${z.slice(24)}`,
  ];
  for (const t of glued) {
    const a = T.mask(t), b = T.excerpt(t, 300);
    ok(!piece(a), `mask hides a glued token: ${t.slice(0, 20)} -> ${a}`);
    ok(!piece(b), `excerpt hides a glued token: ${t.slice(0, 20)} -> ${b}`);
  }
  eq(T.mask('Run `npm test` on my_branch **now**'), 'Run `npm test` on my_branch **now**', 'no token: the text stays as written');
}
console.log(`safetext: ${n} checks passed`);
