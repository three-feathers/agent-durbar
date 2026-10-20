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
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const assert = require('assert');
const OUT = process.env.M9_OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const click = (sel) => ctx.js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.click();return true})()`);
  const text = (sel) => ctx.js(`(document.querySelector(${jsLiteral(sel)})||{}).textContent||''`);
  const calm = () => ctx.js(`(()=>{if(!document.getElementById('shotCalm')){const s=document.createElement('style');s.id='shotCalm';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}})()`); // the startup toast would sit over the pictures
  const shot = async (name, w, h) => { await ctx.sleep(450); await calm(); await ctx.sleep(150); await ctx.shot(path.join(OUT, `m9-${name}-${w}x${h}.png`)); console.log('[m9] saved', name, w, h); };
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    assert.ok(await ctx.waitFor(`document.querySelector('[data-id="sim-11"].is-waiting, [data-id="sim-11"].card.is-waiting')`, 8000), 'Omar reaches the credit limit');
    assert.match(await text('[data-id="sim-1"]'), /\/50 AIU/, 'card shows used/cap');
    assert.match(await text('[data-id="sim-11"]'), /Limit reached/, 'card state is Limit reached');
    await shot('office-caps', w, h);
    await click('#stage [data-id="sim-11"]'); await ctx.sleep(700);
    assert.ok(await ctx.js(`!!document.querySelector('.note.limit .limit-amt')`), 'inline limit notice');
    assert.match(await text('#capChip'), /\/ 30 AIU/, 'cap chip shows used / cap');
    await shot('limit-reached', w, h);
    // sending is refused while the question is open
    await ctx.js(`(()=>{const t=document.getElementById('msgInput');t.value='hello';t.dispatchEvent(new Event('input'));document.getElementById('sendBtn').click();})()`);
    await ctx.sleep(500);
    assert.match(await text('#chat'), /spending limit was reached/, 'send is refused with a clear message');
    // raise the cap and continue
    await click('.note.limit .btn.primary'); await ctx.sleep(1800);
    assert.ok(await ctx.js(`!document.querySelector('.note.limit:not(.settled)')`), 'notice is settled');
    assert.match(await text('#capChip'), /\/ 60 AIU/, 'cap raised by the amount (default = the cap)');
    await shot('limit-continued', w, h);
    // cap dialog from the chip
    await click('#capChip'); await ctx.sleep(300);
    await shot('cap-dialog', w, h);
    await click('#cdCancel'); await ctx.sleep(200);
    await click('#backBtn'); await ctx.sleep(300);
    // Settings: default cap
    await click('#settingsBtn'); await ctx.sleep(600);
    await shot('settings-cap', w, h);
    await click('#scrClose'); await ctx.sleep(300);
    // reload the page state for the next size: Omar is resolved already, so only the first size asserts the limit state
    if (w !== SIZES[SIZES.length - 1][0]) { await ctx.js('location.reload()'); await ctx.sleep(1500); }
  }
};
