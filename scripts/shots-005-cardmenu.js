/*
 * Screenshots of the office card menu with Stop and End session (spec 005 FR-017, T026). Simulator only (no AI credits).
 *
 *   npm run build
 *   CARDMENU_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-005-cardmenu.js npx electron .
 *
 * Writes 005-card-menu-stop-end-1440x900.png and -1280x800.png.
 */
const path = require('path');
const assert = require('assert');
const OUT = process.env.CARDMENU_OUT || '/tmp';

module.exports = async (ctx) => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    const id = await ctx.js(`(()=>{const d=document.querySelector('#stage .desk.is-working:not(.is-away), #stage .desk.is-thinking:not(.is-away)');return d?d.dataset.id:null})()`);
    assert.ok(id, 'a working main agent is on the floor');
    await ctx.js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);const d=document.querySelector('#stage .desk[data-id="${id}"]');const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+60,clientY:r.top+50}));})()`);
    await ctx.sleep(500);
    assert.ok(await ctx.js(`!!document.querySelector('#modeMenu [data-op="stop"]')&&!!document.querySelector('#modeMenu [data-op="end"]')`), 'Stop and End session are in the menu');
    await ctx.shot(path.join(OUT, `005-card-menu-stop-end-${w}x${h}.png`));
    await ctx.js(`document.getElementById('modeMenu').remove()`);
  }
};
