/*
 * Spec 097 (issue #2167, T611): H.forceBlur of scripts/driver-helpers.js, with no Electron. A stub window stands for the OS behaviours: one honours
 * blur() (the page then reports no focus), one does not (a Windows window cannot give up the OS focus when nothing else takes it: hasFocus() stays
 * true). The helper takes the platform as a hook, so both branches run on any machine:
 *   honoured, any platform: true, nothing printed;  refused on win32: false, ONE `[focus]` line naming driver, tag and step, no throw;
 *   refused on linux or darwin: a hard assert with the named setup text (a broken blur must not go green there).
 * The REAL helper source is mutated in memory (a module copy compiled from the mutated text, no require cache involved; each text mutation matches
 * \r?\n, fails loudly with "mutation did not apply: <name>"): the platform gate removed, the printed line removed, the return value flipped; each must
 * die at a named assert of the battery. The two drivers must not return early on a refused blur: a CRLF-safe source scan, and a mutant copy with an
 * early return that dies at "does not end the step early".
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const HELPERS = path.join(__dirname, 'driver-helpers.js');
const SETUP = (step) => `the window is blurred, so the page reports no focus (the setup of the ${step})`;

function load(src) { /* a module copy from `src`, resolved like driver-helpers.js itself (relative requires keep working) */
  const m = new Module(HELPERS, module);
  m.filename = HELPERS;
  m.paths = Module._nodeModulePaths(__dirname);
  m._compile(src, HELPERS);
  return m.exports;
}
function stub(honour) {
  let focused = true;
  const win = { webContents: {}, blur() { if (honour) focused = false; }, show() { focused = true; }, focus() { focused = true; } };
  return { win, sleep: () => new Promise((r) => setTimeout(r, 1)), js: async (code) => (/document\.hasFocus\(\)/.test(code) ? (/!document\.hasFocus\(\)/.test(code) ? !focused : focused) : null) };
}
async function capture(fn) {
  const lines = [], log = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { return { value: await fn(), error: null, lines }; } catch (error) { return { value: undefined, error, lines }; } finally { console.log = log; }
}
const LINE = '[focus] drv tag (the step): this OS did not release the window focus on blur(): the forced-blur setup is skipped here (the real condition is the neighbour window of a shared desktop)';

async function battery(H) { /* every row has a name: a mutant dies at one of them */
  for (const platform of ['win32', 'linux', 'darwin']) {
    const r = await capture(() => H.helpers(stub(true)).forceBlur('drv', 'tag', 'the step', platform));
    assert.strictEqual(r.error, null, `honoured blur on ${platform}: no throw`);
    assert.strictEqual(r.value, true, `honoured blur on ${platform}: true`);
    assert.deepStrictEqual(r.lines.filter((l) => /^\[focus\]/.test(l)), [], `honoured blur on ${platform}: no skip line`);
  }
  const w = await capture(() => H.helpers(stub(false)).forceBlur('drv', 'tag', 'the step', 'win32'));
  assert.strictEqual(w.error, null, 'refused blur on win32: no throw');
  assert.strictEqual(w.value, false, 'refused blur on win32: false');
  const skip = w.lines.filter((l) => /^\[focus\]/.test(l));
  assert.strictEqual(skip.length, 1, 'refused blur on win32: exactly one [focus] line');
  assert.strictEqual(skip[0], LINE, 'refused blur on win32: the line names the driver, the tag and the step');
  for (const platform of ['linux', 'darwin']) {
    const r = await capture(() => H.helpers(stub(false)).forceBlur('drv', 'tag', 'the step', platform));
    assert.ok(r.error && r.error.message === `tag: ${SETUP('the step')}`, `refused blur on ${platform}: a hard assert with the named setup text`);
    assert.deepStrictEqual(r.lines.filter((l) => /^\[focus\]/.test(l)), [], `refused blur on ${platform}: nothing skipped`);
  }
}

function mutate(name, src, re, to) {
  const out = src.replace(re, to);
  assert.notStrictEqual(out, src, `mutation did not apply: ${name}`);
  return out;
}
function scan(name, src) { /* the forceBlur call is its own statement (never returned, never negated) and needFocus follows it */
  const L = src.split(/\r?\n/);
  const i = L.findIndex((l) => /H\.forceBlur\(/.test(l));
  assert.ok(i >= 0, `${name}: calls H.forceBlur`);
  assert.ok(/^\s*if \((BLUR|BLUR_RING|BLUR_TIP)\) await H\.forceBlur\(/.test(L[i]), `${name}: a refused blur does not end the step early (the call is a plain awaited statement)`);
  assert.ok(/H\.needFocus\(/.test(L[i + 1]) || /H\.needFocus\(/.test(L[i + 2]), `${name}: the focus is still asked for by state after the forced blur`);
}

(async () => {
  const real = fs.readFileSync(HELPERS, 'utf8');
  await battery(load(real));
  await battery(load(real.replace(/\r?\n/g, '\r\n'))); /* a CRLF checkout */
  const mutants = {
    'platform gate removed (the skip everywhere)': [/platform !== 'win32'/, 'false', /refused blur on (linux|darwin): a hard assert/],
    'printed line removed': [/console\.log\(`\[focus\]/, '(() => {})(`[focus]', /exactly one \[focus\] line/],
    'return value flipped': [/return false; \/\* refused \*\//, 'return true; /* refused */', /refused blur on win32: false/],
  };
  for (const [name, [re, to, died]] of Object.entries(mutants)) {
    const src = mutate(name, real.replace(/\r?\n/g, '\r\n'), re, to);
    await assert.rejects(() => battery(load(src)), (e) => died.test(e.message), `mutant "${name}" must die at a named assert`);
  }
  for (const f of ['check-102-arcade-labels.js', 'shots-097-moments.js', 'check-brain-dock.js', 'check-status-tooltip.js', 'shots-092-lift.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    scan(f, src);
    scan(f + ' (CRLF)', src.replace(/\r?\n/g, '\r\n'));
    const mut = mutate('early return on a refused blur: ' + f, src, /if \((BLUR|BLUR_RING|BLUR_TIP)\) await H\.forceBlur\(([^\r\n]*?)\); \/\*/, 'if ($1) { if (!(await H.forceBlur($2))) return; } /*');
    assert.throws(() => scan(f + ' mutant', mut), /does not end the step early/, `mutant: an early return on a refused blur dies in ${f}`);
  }
  console.log('test-force-blur: ok');
})().catch((e) => { console.error(e); process.exit(1); });
