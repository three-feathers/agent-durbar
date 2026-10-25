/*
 * Screenshots + UI checks for the credit cap (spec 011). Simulator only (no AI credits, no Copilot login). Linux with xvfb-run:
 *
 *   npm run build
 *   M9_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-m9.js xvfb-run -a npx electron . --no-sandbox
 *
 * Besides the pictures it asserts: Omar (cap 30) is "Limit reached" with the inline notice, sending is refused, "Raise limit"
 * lets him continue, the cap chip shows used / cap, and the card shows used/cap AIU. Exits non-zero (driver failure) on a miss.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers'); /* jsLiteral: CodeQL js/bad-code-sanitization, values spliced into page code */
const assert = require('assert');
const OUT = process.env.M9_OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { click } = H;
  const text = (sel) => H.text(sel, 'textContent');
  /* spec 021 FR-057 (review of #752): an assert waits on the condition it asserts, never on a fixed sleep */
  const until = async (expr, what) => { assert.ok(await ctx.waitFor(expr, 10000), 'timed out waiting for ' + what); };
  const shot = (name, w, h) => H.shot(path.join(OUT, `m9-${name}-${w}x${h}.png`), { prep: 'calm', settle: true, delay: 250, tag: 'm9', what: `${name} ${w} ${h}` });
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    assert.ok(await ctx.waitFor(`document.querySelector('[data-id="sim-11"].is-waiting, [data-id="sim-11"].card.is-waiting')`, 15000), 'Omar reaches the credit limit');
    await until(`/Limit reached/.test((document.querySelector('[data-id="sim-11"]')||{}).textContent||'')&&/\\/50 AIU/.test((document.querySelector('[data-id="sim-1"]')||{}).textContent||'')`, 'the cards to show the cap');
    assert.match(await text('[data-id="sim-1"]'), /\/50 AIU/, 'card shows used/cap');
    assert.match(await text('[data-id="sim-11"]'), /Limit reached/, 'card state is Limit reached');
    await shot('office-caps', w, h);
    await click('#stage [data-id="sim-11"]'); await until(`!!document.querySelector('.note.limit .limit-amt')&&/\\/ 30 AIU/.test((document.getElementById('capChip')||{}).textContent||'')`, 'the limit notice and the cap chip');
    assert.ok(await ctx.js(`!!document.querySelector('.note.limit .limit-amt')`), 'inline limit notice');
    assert.match(await text('#capChip'), /\/ 30 AIU/, 'cap chip shows used / cap');
    await shot('limit-reached', w, h);
    // sending is refused while the question is open
    await ctx.js(`(()=>{const t=document.getElementById('msgInput');t.value='hello';t.dispatchEvent(new Event('input'));document.getElementById('sendBtn').click();})()`);
    await until(`/spending limit was reached/.test((document.getElementById('chat')||{}).textContent||'')`, 'the refusal message');
    assert.match(await text('#chat'), /spending limit was reached/, 'send is refused with a clear message');
    // raise the cap and continue
    await click('.note.limit .btn.primary'); await until(`!document.querySelector('.note.limit:not(.settled)')&&/\\/ 60 AIU/.test((document.getElementById('capChip')||{}).textContent||'')`, 'the notice to settle with the cap raised');
    assert.ok(await ctx.js(`!document.querySelector('.note.limit:not(.settled)')`), 'notice is settled');
    assert.match(await text('#capChip'), /\/ 60 AIU/, 'cap raised by the amount (default = the cap)');
    await shot('limit-continued', w, h);
    // cap dialog from the chip
    await click('#capChip'); await until(`!!document.getElementById('cdCancel')`, 'the cap dialog');
    await shot('cap-dialog', w, h);
    await click('#cdCancel'); await until(`!document.getElementById('cdCancel')`, 'the cap dialog to close');
    await click('#backBtn'); await until(`!document.body.classList.contains('panel-open')`, 'the chat to close');
    // Settings: default cap
    await click('#settingsBtn'); await until(`!!document.getElementById('capDef')`, 'Settings');
    // the Spending limit section is the point of the picture (Settings now opens on Agent apps): scroll it into view and prove it is inside the window
    await ctx.js(`document.getElementById('capDef').scrollIntoView({block:'center',behavior:'instant'})`);
    await until(`(()=>{const r=document.getElementById('capDef').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight})()`, 'the default limit field in view');
    assert.strictEqual(await ctx.js(`(()=>{const r=document.getElementById('capDef').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight})()`), true, 'the default limit field is inside the window for the picture');
    await shot('settings-cap', w, h);
    await click('#scrClose'); await until(`!document.getElementById('scrClose')`, 'Settings to close');
    // reload the page state for the next size: Omar is resolved already, so only the first size asserts the limit state
    if (w !== SIZES[SIZES.length - 1][0]) { await ctx.js('location.reload()'); await until(`document.querySelectorAll('#stage .desk[data-id]').length>=10`, 'the office after the reload'); }
  }
};
