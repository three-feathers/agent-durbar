/*
 * Spec 102 T395 (issue #1954, parity with the Real and Photo office): the arcade's limit pill offers Remove limit. Simulator only (sim=15, the
 * simulator's own spending limit), no AI credits; every wait is an until(). At 1440x900 and 1280x800 in the arcade it fails when:
 *   - the limit slip is not the one-line pill with the words "Omar: Spending limit reached · Show in chat" and a second button reading Remove limit
 *     (the flat card's own words, its own title, the accessible name "Remove limit: Omar", a button of the pill's own slip);
 *   - the pill grows past one line, scrolls, shows text under 10.5 px, is wider than 38% of the floor, covers a plate, a cabinet screen or a person,
 *     or the suffix is cut (FR-359: only the name may end in an ellipsis);
 *   - pressing Remove limit does not settle the limit (no unsettled limit card, and no slip for that request left (the chat card of the agent is not on screen));
 *   - pressing Show in chat does not open the chat at the card's amount field (the pill's old button is unchanged).
 *   source mutant: in `drawSlips` of src/renderer/realoffice.js change `lay.cabinet && L.actions.find(` to `false && L.actions.find(` (npm run build): must fail at "the pill offers Remove limit beside Show in chat"
 *   LIMITRM_MUTANT=click   a click on that button is swallowed before the app sees it (must fail at "pressing Remove limit removes the limit")
 *
 *   npm run check:ui -- --only check-102-arcade-limit-remove
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const MUTANT = process.env.LIMITRM_MUTANT || '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} arcade`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    assert.ok(await until(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden]) .ro-rm')||!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])')`, 20000), `${tag}: the limit slip is drawn`);
    const info = () => js(`(()=>{const e=document.querySelector('#stage .ro-slip.ro-limit:not([hidden])');if(!e)return null;const R=x=>x.getBoundingClientRect(),ro=R(document.querySelector('#stage .ro')),bs=[...e.querySelectorAll('button')],pill=e.querySelector('.ro-pill'),sfx=e.querySelector('.ro-ps'),rm=e.querySelector('.ro-rm');
      const fs=[...bs,...e.querySelectorAll('.ro-pn,.ro-ps')].map(x=>parseFloat(getComputedStyle(x).fontSize));
      const rects=[...document.querySelectorAll('#stage .ro-plate:not(.lounge),#stage .ro-sc,#stage .ro-screen')].map(R),me=R(e);
      const hit=rects.filter(q=>me.left<q.right-0.5&&q.left<me.right-0.5&&me.top<q.bottom-0.5&&q.top<me.bottom-0.5).length;
      return {variant:e.dataset.variant,group:e.getAttribute('role'),btns:bs.map(b=>b.textContent.trim()),title:rm&&rm.title,aria:rm&&rm.getAttribute('aria-label'),w:me.width,h:me.height,floor:ro.width,minFont:Math.min(...fs),sfxCut:sfx?sfx.scrollWidth>sfx.clientWidth+0.5:null,scroll:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1,hit}})()`);
    const i = await info();
    assert.strictEqual(i.variant, 'pill', `${tag}: the arcade draws the limit as the one-line pill: ${JSON.stringify(i)}`);
    assert.ok(i.btns.length === 2 && /^[^:]+: Spending limit reached · Show in chat$/.test(i.btns[0]) && i.btns[1] === 'Remove limit', `${tag}: the pill offers Remove limit beside Show in chat: ${JSON.stringify(i.btns)}`);
    assert.ok(/Remove the limit/.test(i.title) && /^Remove limit: \S/.test(i.aria), `${tag}: the flat tooltip and a name that starts with the visible words: ${JSON.stringify([i.title, i.aria])}`);
    assert.ok(i.h <= 22 && !i.scroll && i.minFont >= 10.5 && i.w <= i.floor * 0.38 + 1 && i.sfxCut === false && i.hit === 0, `${tag}: one line, no scroll, text 10.5 px or more, at most 38% of the floor, the suffix whole, nothing covered: ${JSON.stringify({ ...i, title: undefined, aria: undefined })}`);
    if (process.env.SHOTS_OUT) { fs.mkdirSync(process.env.SHOTS_OUT, { recursive: true }); await H.shot(path.join(process.env.SHOTS_OUT, `102-arcade-limit-remove-${w}x${h}.png`), { prep: 'calm' }); } /* a picture to look at; the check does not read it */
    if (MUTANT === 'click') await js(`(()=>{document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.ro-rm'))e.stopImmediatePropagation()},true);return 1})()`);
    const before = await js(`window.__durbarSimUi.slips().limit.req`);
    assert.ok(await until(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])')&&!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])').querySelector('.ro-rm')`, 8000), `${tag}: the pill offers Remove limit`);
    await js(`document.querySelector('#stage .ro-slip.ro-limit:not([hidden])').querySelector('.ro-rm').click()`);
    /* the simulator may bring another agent to its limit at once: the one slip at the Bank is then the next request's, so the test is that this request's own slip and card are gone */
    assert.ok(await until(`!document.querySelector('#chat .note.limit:not(.settled)')&&(window.__durbarSimUi.slips().limit||{}).req!==${jsLiteral(before)}&&![...document.querySelectorAll('#stage .ro-slip.ro-limit:not([hidden]) .ro-rm')].some(b=>b.dataset.slipreq===${jsLiteral(before)})`, 8000), `${tag}: pressing Remove limit removes the limit and the slip`);
    /* Show in chat keeps its job (a fresh load: with the chat open the floor is not drawn again until it closes) */
    await H.load({ w, h, query: { officeview: 'real', sim: '15', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    assert.ok(await until(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])')`, 20000), `${tag}: the limit slip is drawn again`);
    await js(`document.querySelector('#stage .ro-slip.ro-limit:not([hidden])').querySelector('.ro-pill').click()`);
    assert.ok(await until(`!!document.querySelector('#chat .note.limit:not(.settled)')`, 6000), `${tag}: Show in chat opens the chat with the limit card`);
    console.log(`[arcade-limit-remove] ${tag} ok: ${JSON.stringify(i.btns)} ${Math.round(i.w)}x${Math.round(i.h)}`);
  }
  console.log('[arcade-limit-remove] all checks passed');
};
