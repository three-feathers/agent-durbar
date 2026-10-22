/** Agent text on the office floor (spec 041 FR-065, issue #541): mask first, then plain, then cut; fails closed. `npm run test:safetext`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { redact } from '../src/shared/redact';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, max: number) => string };
const S = require(path.join(R, 'safetext.js')) as { create(o: { redact?: ((s: string) => string) | null; cut?: ((s: string, n: number) => string) | null }): { mask(t: unknown): string; excerpt(t: unknown, n: number, fb?: string): string; plain(t: unknown): string } };
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
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

// page wiring
{
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  ok(/<script src="liveact\.js"><\/script>\s*<script src="safetext\.js"><\/script>\s*<script src="app\.js">/.test(html), 'safetext.js loads after liveact.js (which sets DurbarRedact) and before app.js');
  ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes("'safetext.js'"), 'copied to dist');
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  ok(!/plainMd\(/.test(app), 'app.js has no plain-then-cut path of its own left');
  ok(!/SHORT\(plainMd/.test(app), 'no SHORT(plainMd(...))');
  ok(/function setState\(a,state,label,task\)\{\s*if\(typeof task==='string'\)task=safeMask\(task\);/.test(app), 'setState masks the stored task (backstop)');
  ok(/a\.lastOutput\?safeExcerpt\(a\.lastOutput,140\):'Finished\.'/.test(app), 'the done desk uses the excerpt helper');
}
console.log(`safetext: ${n} checks passed`);
