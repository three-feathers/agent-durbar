/**
 * Spec 095 T013 (FR-030, SC-002): the conversation search's masking, `npm run test:convmask`. Synthetic secrets only (built from parts, so
 * no real-looking token sits in the repo); no credits, no network, no fs write.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MASK_CALL_WORK, MaskBudgetError, WINDOW_CHARS, cleanValues, createMasker, maskWork, scanSecretValues } from '../src/main/convmask';
import { rendererScript } from '../src/main/convsearch';

process.exitCode = 1;
const ROOT = ((): string => {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'renderer'))) return d;
    if (path.dirname(d) === d) throw new Error('repo root not found');
  }
})();
const ST = rendererScript<{ unhide(s: string): string }>('safetext.js', path.join(ROOT, 'src', 'main'));
const M = createMasker({ unhide: (s) => ST.unhide(s) });

// the planted secrets (every class the search must hide), and the fragments that must never show
const GHP = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const ANT = 'sk-' + 'ant-api03-' + 'Zq9'.repeat(14);
const AWS = 'AK' + 'IA' + 'QWERTYUIOPASDFGH';
const MCPV = 'mcp-secret-VALUE-77fa';
const MCPV_SPACE = 'open sesame value 4242';
const URLPW = 'hunter2Pass99';
const USER = 'alicewonder';
const SECRETS = [GHP, ANT, AWS, MCPV, MCPV_SPACE, URLPW, USER];
/** No secret, and no 8-character piece of one (a cut or late split would leave a piece), anywhere in `s`. */
function clean(s: string, what: string): void {
  for (const x of SECRETS) {
    for (let i = 0; i + 8 <= x.length; i++) {
      const piece = x.slice(i, i + 8);
      if (x === USER) { if (s.includes(x)) assert.fail(`${what}: "${x}" in ${JSON.stringify(s.slice(0, 300))}`); break; }
      if (x === MCPV_SPACE) { for (const tail of ['sesame value', 'value 4242']) if (s.includes(tail)) assert.fail(`${what}: part of a spaced value ("${tail}") in ${JSON.stringify(s.slice(0, 300))}`); break; }
      if (s.includes(piece)) assert.fail(`${what}: a piece of a secret (${piece}) in ${JSON.stringify(s.slice(0, 300))}`);
    }
  }
  assert.ok(!/\/home\/|\/Users\/|[A-Za-z]:\\+Users/i.test(s), `${what}: no home path: ${JSON.stringify(s.slice(0, 300))}`);
}
const VALS = [MCPV, MCPV_SPACE];

// 1. the whole-text mask (titles): every class, Markdown glue, URL userinfo, home paths on three systems, hidden characters
const shapes = [
  `plain ${GHP} end`,
  `glued x**${GHP}**`,
  `split ${GHP.slice(0, 20)}**${GHP.slice(20)}**`,
  `code gh\`${GHP.slice(2)}\``,
  `escaped ${GHP.replace('_', '\\_')}`,
  `zero width ${GHP.slice(0, 10)}\u200B${GHP.slice(10)}`,
  `soft hyphen ${ANT.slice(0, 9)}\u00AD${ANT.slice(9)}`,
  `aws ${AWS} key`,
  `url https://bob:${URLPW}@example.test/repo.git`,
  `url glued (https://bob:${URLPW}@example.test)`,
  `mcp ${MCPV} value`,
  `mcp split mcp-secret-**VALUE**-77fa marks`,
  `mcp with spaces: ${MCPV_SPACE}!`,
  `linux /home/${USER}/proj/a.ts`,
  `mac /Users/${USER}/proj/a.ts`,
  `windows C:\\Users\\${USER}\\proj\\a.ts`,
  `json "C:\\\\Users\\\\${USER}\\\\proj"`,
  `forward C:/Users/${USER}/proj`,
];
for (const s of shapes) clean(M.maskText(s, VALS), `maskText(${JSON.stringify(s.slice(0, 30))})`);
assert.strictEqual(M.maskText('Fix the invoice export', VALS), 'Fix the invoice export', 'plain text is unchanged');
assert.strictEqual(M.maskText('use **bold** here', []), 'use **bold** here', 'Markdown is kept when nothing is masked');
assert.strictEqual(M.maskText(`**note** the ${MCPV} here`, VALS), '**note** the [redacted] here', 'a value\'s mask keeps its brackets, and the Markdown stays as written');
// review of PR 1098, finding 1: an MCP value that holds a Markdown mark, or is written with a Markdown escape, with a second secret in the
// same text (so the old pass showed the mark-stripped text): never shown, with or without its mark
for (const v of ['p@ss*w0rd!!77', 'hunter~2secret', 'abc[123]xyzQ', 'Pa`ss`word99', 'brkt]Close99x', 'esc_aped_v4lue']) {
  const plainV = v.replace(/[*`~[\]]/g, '');
  for (const written of [v, v.split('_').join('\\_')]) {
    for (const second of [GHP, MCPV]) {
      const t = `the db password is ${written} ok and token ${second} end`;
      const out = M.maskText(t, [v, MCPV]);
      assert.ok(!out.includes(v) && !out.includes(plainV) && !out.includes(v.replace(/_/g, '')), `value ${JSON.stringify(v)} written ${JSON.stringify(written)}: ${JSON.stringify(out)}`);
      const pad = 'word '.repeat(180);
      const w = M.maskedWindow(pad + t + ' ' + pad, pad.length + 4, pad.length + 6, [v, MCPV]);
      assert.ok(!w.text.includes(plainV) && !w.text.includes(v.replace(/_/g, '')), `in a window: ${JSON.stringify(v)}`);
    }
  }
}
assert.strictEqual(M.maskText('db pass abc\\_def1234 here', ['abc_def1234']), 'db pass [redacted] here', 'a value written with a Markdown escape (review: the u = u0 survivor)');
assert.strictEqual(M.maskText('Team \u{1F469}\u200D\u{1F4BB} ok', []), 'Team \u{1F469}\u200D\u{1F4BB} ok', 'a joiner stays when it hides nothing');

// 2. the window: ±600 around the hit, widened to whitespace; a secret at, across or near either edge never survives in the window
// lines of about 70 characters, so window edges fall inside lines (a line far longer than the window is masked whole, see below)
const filler = (n: number): string => { let s = ''; for (let i = 0; s.length < n; i++) s += `word${i % 97}` + (i % 10 === 9 ? '\n' : ' '); return s.slice(0, n); };
const HIT = 'invoice';
let windows = 0;
for (const secret of [GHP, `x**${GHP}**`, `https://bob:${URLPW}@example.test/a`, MCPV, MCPV_SPACE, `/home/${USER}/p`, `C:\\Users\\${USER}\\p`, `${GHP.slice(0, 18)}**${GHP.slice(18)}`]) {
  for (const side of ['before', 'after'] as const) {
    for (let d = WINDOW_CHARS - 60; d <= WINDOW_CHARS + 60; d += 3) {
      // the secret's start sits d characters from the hit (so the raw window edge falls before, inside or after it)
      const pre = side === 'before' ? filler(1000 - d) + ' ' + secret + ' ' + filler(Math.max(1, d - secret.length)) + ' ' : filler(1000) + ' ';
      const raw = side === 'before' ? pre + HIT + ' ' + filler(1000) : pre + HIT + ' ' + filler(d) + ' ' + secret + ' ' + filler(800);
      const at = raw.indexOf(HIT);
      const w = M.maskedWindow(raw, at, at + HIT.length, VALS);
      clean(w.text, `window ${side} d=${d} ${JSON.stringify(secret.slice(0, 12))}`);
      assert.ok(w.text.includes(HIT), 'the hit is in its window');
      windows++;
    }
  }
}
assert.ok(windows > 600, `enough windows (${windows})`);
// the window never starts or ends inside a token
{
  const raw = 'a'.repeat(700) + ' ' + HIT + ' ' + 'b'.repeat(700);
  const at = raw.indexOf(HIT);
  const w = M.maskedWindow(raw, at, at + HIT.length, []);
  assert.deepStrictEqual([w.atStart, w.atEnd, w.text.length], [true, true, raw.length], 'a long run is taken whole, not cut');
  const raw2 = filler(3000) + HIT + filler(3000);
  const at2 = raw2.indexOf(HIT);
  const w2 = M.maskedWindow(raw2, at2, at2 + HIT.length, []);
  assert.ok(!w2.atStart && !w2.atEnd && w2.text.length >= 2 * WINDOW_CHARS && w2.text.length < 2 * WINDOW_CHARS + 200, `a ±600 window, from the start of the line before its edge (${w2.text.length})`);
  assert.ok(w2.text.startsWith('word') && raw2.includes('\n' + w2.text.slice(0, 40)), 'the left edge is a line start');
  assert.ok(raw2.includes(w2.text) && /\s/.test(raw2[raw2.indexOf(w2.text) + w2.text.length]), 'cut at whitespace on the right');
  assert.strictEqual(M.maskedWindow(raw2, at2, at2, [], { whole: true }).text, raw2, 'whole: the whole message');
  const one = 'x '.repeat(2000) + HIT + ' y'.repeat(2000);
  const w3 = M.maskedWindow(one, one.indexOf(HIT), one.indexOf(HIT) + 7, []);
  assert.deepStrictEqual([w3.atStart, w3.atEnd], [true, true], 'a line far longer than the window: the whole message is masked');
}
// a private key block opened before the window: its body is masked from the BEGIN line
{
  const body = Array.from({ length: 40 }, (_, i) => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC' + String(i).padStart(32, 'Q')).join('\n');
  const raw = 'see this: -----BEGIN PRIVATE KEY-----\n' + body + '\n-----END PRIVATE KEY----- and the ' + HIT + ' here ' + filler(900);
  const at = raw.indexOf(HIT);
  const w = M.maskedWindow(raw, at, at + HIT.length, []);
  assert.ok(!w.text.includes('MIIEvQIBADANBgkq'), `no key body in the window: ${JSON.stringify(w.text.slice(0, 120))}`);
}

// review of phase 1, finding 1: rules that read context to the left on the same line, or across up to 8 line ends
{
  // a Cookie header longer than the window (the reviewer's probe 3): its pairs are masked to the end of its line
  const pairs = Array.from({ length: 120 }, (_, i) => `k${i}=v${i}`).join('; ');
  const raw = 'Cookie: ' + pairs + '; x9=Zx81kq0PLm2RtY\ninvoice total is due';
  const w = M.maskedWindow(raw, raw.indexOf(HIT), raw.indexOf(HIT) + 7, []);
  assert.ok(!w.text.includes('Zx81kq0PLm2RtY') && !w.text.includes('v119'), `no cookie value: ${JSON.stringify(w.text.slice(-80))}`);
  // re-check of the review (probe 14): a multi-line value inside a long Cookie line moves the edge to the value; replacing it joins the
  // lines, so the line rule must run again from the value's line or the header falls outside the window
  {
    const V = 'OPEN\nsesame\nVALUE-4242x';
    let ps = '';
    for (let i = 0; ps.length < 800; i++) ps += `k${i}=v${i}; `;
    const raw14 = filler(900) + '\nCookie: a=b; t=' + V + '; ' + ps + 'x9=Zx81kq0PLm2RtY; invoice=due\n' + filler(900);
    const at = raw14.indexOf('invoice=due');
    const w14 = M.maskedWindow(raw14, at, at + 7, [V]);
    assert.ok(!w14.text.includes('Zx81kq0PLm2RtY'), `the header of a value-joined line stays in the window: ${JSON.stringify(w14.text.slice(0, 80))}`);
  }
  // the header on the line before its pairs, and a named secret whose value is lines below its name
  const raw2 = filler(900) + '\nSet-Cookie:\n' + Array.from({ length: 70 }, (_, i) => `c${i}=val${i}x`).join('; ') + '; sid=Qp9xW2mZ7rT5\n' + filler(400) + ' ' + HIT + ' ' + filler(300);
  const w2 = M.maskedWindow(raw2, raw2.indexOf(HIT), raw2.indexOf(HIT) + 7, []);
  assert.ok(!w2.text.includes('Qp9xW2mZ7rT5'), 'a header on the line before');
  for (let blank = 0; blank <= 3; blank++) {
    const raw3 = filler(900) + '\npassword:' + '\n'.repeat(blank) + '\n  hunter2Valu3x ' + filler(560) + ' ' + HIT + ' ' + filler(300);
    const w3 = M.maskedWindow(raw3, raw3.indexOf(HIT), raw3.indexOf(HIT) + 7, []);
    if (w3.text.includes('hunter2Valu3x') && !w3.text.includes('password')) assert.fail(`a name lines above its value (${blank} blank): ${JSON.stringify(w3.text.slice(0, 60))}`);
  }
}
// review finding 2: a BEGIN line with a hidden character opens a key block too (the masks read the text without it)
{
  const body = Array.from({ length: 40 }, (_, i) => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC' + String(i).padStart(32, 'Q')).join('\n');
  for (const begin of ['-----BEG​IN PRIVATE KEY-----', '-----BEGIN­ PRIVATE KEY-----', '-----⁠BEGIN PRIVATE KEY-----']) {
    const raw = 'key: ' + begin + '\n' + body + '\n-----END PRIVATE KEY----- invoice here ' + filler(900);
    const w = M.maskedWindow(raw, raw.indexOf(HIT), raw.indexOf(HIT) + 7, []);
    assert.ok(!w.text.includes('MIIEvQIBADANBgkq'), `no key body after ${JSON.stringify(begin)}: ${JSON.stringify(w.text.slice(0, 80))}`);
  }
}
// review of PR 1098, finding 2: the open key-block check uses KEY_BLOCK's own END grammar; an END CERTIFICATE line does not close it
{
  const b64 = (n: number) => Array.from({ length: n }, (_, i) => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC' + String(i).padStart(32, 'Q')).join('\n');
  const raw = 'key: -----BEGIN RSA PRIVATE KEY-----\n' + b64(3) + '\n-----END CERTIFICATE-----\n' + b64(40) + '\ntail findme\n' + b64(5);
  assert.strictEqual(M.maskText(raw, []), 'key: [redacted]', 'the whole-text mask: to the end');
  const w = M.maskedWindow(raw, raw.indexOf('findme'), raw.indexOf('findme') + 6, []);
  assert.ok(!w.text.includes('MIIEvQIBADANBgkq'), `no key body around the hit: ${JSON.stringify(w.text.slice(0, 80))}`);
  const closed = 'key: -----BEGIN RSA PRIVATE KEY-----\n' + b64(3) + '\n-----END RSA PRIVATE KEY-----\n' + filler(1500) + ' findme ' + filler(300);
  const w2 = M.maskedWindow(closed, closed.indexOf('findme'), closed.indexOf('findme') + 6, []);
  assert.ok(!w2.atStart, 'a closed block does not pull the window back');
}
// review finding 4: the work of a mask is estimated before it runs, and a mask over its budget throws (fail closed)
{
  assert.strictEqual(maskWork('a'.repeat(1000)), 550, 'linear passes: 0.55 per character');
  assert.strictEqual(maskWork('**' + 'abcdefghijklmn '.repeat(10)), Math.ceil(152 * 2.5 + 1 * 250), 'with a split mark: 2.5 per character, and 250 per token-like run next to a mark (one here)');
  assert.strictEqual(maskWork('**abcdefghijklmn** '.repeat(10)), Math.ceil(190 * 2.5 + 10 * 250), 'every run next to a mark counts');
  assert.strictEqual(maskWork('x'.repeat(1000), false, 10), Math.ceil(550 + 10 * 1000 * 0.003), 'each MCP secret value: 0.003 per character');
  // re-check of the review (probes 11, 12): many MCP values make every pass slower; a value-heavy mask is over budget too (fail closed)
  {
    let plain = '';
    for (let i = 0; plain.length < 19_990; i++) plain += 'word' + i + ' invoice ';
    plain = plain.slice(0, 19_990);
    const many = Array.from({ length: 2000 }, (_, i) => 'val' + i + '-qq');
    assert.throws(() => M.maskText(plain, many), MaskBudgetError, '2 000 values over 20 000 characters: over budget');
    assert.throws(() => M.maskedWindow(plain, 9000, 9007, many), MaskBudgetError, 'and as a window of a long line (masked whole)');
    assert.doesNotThrow(() => M.maskText(plain, many.slice(0, 50)), 'a usual number of values still fits');
    assert.ok(M.maskedWindow('the invoice ' + many[7] + ' here', 4, 11, many).text.includes('[redacted]'), 'values are still masked in a short window');
    // a value over several lines across the left edge: the line-start rule takes only the line before, the value search takes it whole
    const V3 = 'first-part-AAAA\nsecond-part-BBBB\nthird-part-CCCC\nfourth-part-DDDD';
    for (let shift = 0; shift < 60; shift += 4) {
      const t = filler(400) + '\n' + V3 + ' ' + 'x '.repeat(270 + shift) + 'invoice ' + filler(600);
      const at = t.indexOf('invoice');
      const w = M.maskedWindow(t, at, at + 7, [V3]);
      assert.ok(!/(?:first|second|third|fourth)-part/.test(w.text), `a value over 4 lines at the edge (shift ${shift}): ${JSON.stringify(w.text.slice(0, 50))}`);
    }
  }
  assert.strictEqual(maskWork('abcdefghijklmn '.repeat(10)), Math.ceil(150 * 0.55), 'no marks: runs cost nothing extra');
  assert.strictEqual(maskWork('x'.repeat(100), true), Math.ceil(100 * 0.55 * 2), 'hidden characters: two passes');
  const tok = (i: number) => 'gh' + 'p_' + (String(i).padStart(6, '0') + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6').slice(0, 36);
  let dense = '**x** ';
  for (let i = 0; dense.length < 19_900; i++) dense += tok(i) + ' invoice ';
  assert.ok(maskWork(dense) > MASK_CALL_WORK);
  assert.throws(() => M.maskedWindow(dense, 0, dense.length, [], { whole: true }), MaskBudgetError, 'a token-dense whole message is over budget');
  assert.throws(() => M.maskText(dense, []), MaskBudgetError);
  assert.throws(() => M.maskedWindow('the invoice', 4, 11, [], { budget: 1 }), MaskBudgetError, 'the caller\'s budget holds');
  assert.ok(M.maskedWindow(dense, 50, 57, []).work <= MASK_CALL_WORK, 'a window of it fits');
}

// 3. fail closed
assert.throws(() => createMasker({} as never), /unhide/, 'no unhide, no masker');
const bad = createMasker({ unhide: () => { throw new Error('boom'); } });
assert.throws(() => bad.maskText('x', []), 'a throwing unhide throws');
assert.throws(() => bad.maskedWindow('some text', 0, 4, []));
assert.throws(() => createMasker({ unhide: () => 42 as unknown as string }).maskText('x', []), 'a non-string throws');
assert.throws(() => M.maskText('already [redaction failed] here', []), 'a failed redaction is never shown');

// 4. FR-030: the values come without any keychain prompt
{
  const calls: string[] = [];
  const src = (noPrompt: boolean) => ({
    knownSecretValues: (k: string) => { calls.push(`known:${k}`); return ['abc', 'folder-value-1']; },
    noPrompt: () => { calls.push('noPrompt'); return noPrompt; },
    secretValuesFor: (id: string) => { calls.push(`session:${id}`); return ['session-value-22']; },
  });
  assert.deepStrictEqual(scanSecretValues(src(false), { folderKey: 'F', agentId: 'a1', open: true }), ['folder-value-1'], 'locked vault: the folder values only (under 4 characters skipped)');
  assert.deepStrictEqual(calls, ['known:F', 'noPrompt'], 'secretValuesFor is never called while it could prompt');
  calls.length = 0;
  assert.deepStrictEqual(scanSecretValues(src(true), { folderKey: 'F', agentId: 'a1', open: true }), ['session-value-22', 'folder-value-1'], 'no prompt possible: the session values too, longest first');
  assert.deepStrictEqual(calls, ['known:F', 'noPrompt', 'session:a1']);
  calls.length = 0;
  assert.deepStrictEqual(scanSecretValues(src(true), { folderKey: 'F', agentId: 'a1', open: false }), ['folder-value-1'], 'an earlier session: its folder values only');
  assert.ok(!calls.some((c) => c.startsWith('session:')));
  assert.throws(() => scanSecretValues({ ...src(true), knownSecretValues: () => { throw new Error('store'); } }, { folderKey: 'F', open: false }), 'a failing store throws (the scan then searches nothing of it)');
  assert.deepStrictEqual(cleanValues(['abcd', 'abcd', 7, 'xyz', 'longer-one']), ['longer-one', 'abcd']);
}

console.log('convmask tests passed');
process.exitCode = 0;
