/*
 * Spec 097 (issue #2167, T611): H.forceBlur of scripts/driver-helpers.js, with no Electron. A stub window stands for the two OS behaviours:
 * one honours blur() (Linux, macOS: the page then reports no focus), one does not (Windows: a window cannot give up the OS focus when nothing
 * else takes it, so hasFocus() stays true). Honoured: true, nothing printed. Refused: false, ONE `[focus]` line naming the driver, the tag and
 * the step, no throw. The two drivers that use it must not return early on a refused blur (the skip removes the setup assert only): the source
 * scan below reads both (CRLF-safe) and a mutant copy with an early return must fail at the named assert.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers } = require('./driver-helpers');

function stub(honour) {
  let focused = true;
  const win = { webContents: {}, blur() { if (honour) focused = false; }, show() { focused = true; }, focus() { focused = true; } };
  return { win, sleep: () => new Promise((r) => setTimeout(r, 1)), js: async (code) => (/document\.hasFocus\(\)/.test(code) ? (/!document\.hasFocus\(\)/.test(code) ? !focused : focused) : null) };
}
async function capture(fn) {
  const lines = [], log = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { return { value: await fn(), lines }; } finally { console.log = log; }
}
function scan(name, src) { /* the forceBlur call is its own statement (never returned, never negated) and needFocus follows it */
  const L = src.split(/\r?\n/);
  const i = L.findIndex((l) => /H\.forceBlur\(/.test(l));
  assert.ok(i >= 0, `${name}: calls H.forceBlur`);
  assert.ok(/^\s*if \((BLUR|BLUR_RING)\) await H\.forceBlur\(/.test(L[i]), `${name}: a refused blur does not end the step early (the call is a plain awaited statement)`);
  assert.ok(/H\.needFocus\(/.test(L[i + 1]) || /H\.needFocus\(/.test(L[i + 2]), `${name}: the focus is still asked for by state after the forced blur`);
}

(async () => {
  const ok = await capture(() => helpers(stub(true)).forceBlur('drv', 'tag', 'the step'));
  assert.strictEqual(ok.value, true, 'a blur the OS honours: true');
  assert.deepStrictEqual(ok.lines.filter((l) => /^\[focus\]/.test(l)), [], 'a honoured blur prints no skip line');
  const no = await capture(() => helpers(stub(false)).forceBlur('drv', 'tag', 'the step'));
  assert.strictEqual(no.value, false, 'a refused blur: false, and no throw');
  const sk = no.lines.filter((l) => /^\[focus\]/.test(l));
  assert.strictEqual(sk.length, 1, 'a refused blur prints exactly one [focus] line');
  assert.strictEqual(sk[0], '[focus] drv tag (the step): this OS did not release the window focus on blur(): the forced-blur setup is skipped here (the real condition is the neighbour window of a shared desktop)', 'the skip line names the driver, the tag and the step');
  // mutant: a helper that throws on a refused blur (the first fix) must die at the named assert
  const throwing = async (H) => { if (!(await H.forceBlur('drv', 'tag', 'the step'))) throw new Error('refused blur threw'); };
  await assert.rejects(() => capture(() => throwing(helpers(stub(false)))), /refused blur threw/, 'mutant: a driver that fails on a refused blur dies');
  for (const f of ['check-102-arcade-labels.js', 'shots-097-moments.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    scan(f, src);
    const crlf = src.replace(/\r?\n/g, '\r\n');
    scan(f + ' (CRLF)', crlf);
    const mut = src.replace(/(\r?\n)(\s*)if \((BLUR|BLUR_RING)\) await H\.forceBlur\(/, '$1$2if (!(await H.forceBlur(') .replace(/H\.forceBlur\(([^\n]*?)\); \/\*/, 'H.forceBlur($1))) return; /*');
    assert.notStrictEqual(mut, src, `mutation did not apply: ${f}`);
    assert.throws(() => scan(f + ' mutant', mut), /does not end the step early/, `mutant: an early return on a refused blur dies in ${f}`);
  }
  console.log('test-force-blur: ok');
})().catch((e) => { console.error(e); process.exit(1); });
