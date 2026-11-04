/*
 * Spec 005 FR-234 (issue #1145): a helper's chat has no More button (its menu would hold nothing), and a main agent's chat still has
 * More with items. Simulator only (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:ui -- --only check-helper-more
 *
 * At 1440x900 and 1280x800 (SIM=15): a helper's chat (the read-only .panel-in.ro) shows no visible #moreBtn and no open menu; going back
 * and opening a main agent's chat shows #moreBtn, its menu holds at least one item and opens with the button inside the chat header's
 * bounds. Every wait is until() and its result is asserted. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const more = () => js(`(()=>{const b=document.getElementById('moreBtn'),m=document.getElementById('moreMenu');return {btn:!!b&&b.getClientRects().length>0,items:m?m.querySelectorAll('[role="menuitem"]').length:0,menuOpen:!!m&&!m.hidden}})()`);
  const back = async (tag) => { await js(`document.getElementById('backBtn').click()`); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back to the office`); };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    const helper = await js(`(()=>{const h=window.__durbarSimUi.agents().find(a=>a.parent&&document.querySelector('#stage .helper[data-id="'+CSS.escape(a.id)+'"]'));return h?h.id:null})()`);
    assert.ok(helper, `${tag}: a helper is on the office floor`);
    await js(`document.querySelector('#stage .helper[data-id="'+CSS.escape(${jsLiteral(helper)})+'"]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.querySelector('#panel .panel-in.ro')`, `${tag}: the helper's chat is open`);
    await H.settle();
    const hm = await more();
    assert.deepStrictEqual(hm, { btn: false, items: 0, menuOpen: false }, `${tag}: a helper's chat has no visible More button: ${JSON.stringify(hm)}`);
    await back(tag);

    const main = await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&document.querySelector('#stage .desk[data-id="'+CSS.escape(a.id)+'"]'));return a?a.id:null})()`);
    assert.ok(main, `${tag}: a main agent's desk is on the office floor`);
    await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(main)})+'"]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!document.querySelector('#panel .panel-in.ro')&&!!document.getElementById('moreBtn')`, `${tag}: a main agent's chat is open`);
    await H.settle();
    const mm = await more();
    assert.ok(mm.btn && mm.items >= 1, `${tag}: a main agent's chat keeps More with items: ${JSON.stringify(mm)}`);
    await js(`document.getElementById('moreBtn').click()`);
    await ok(`!document.getElementById('moreMenu').hidden`, `${tag}: More opens`);
    const inside = await js(`(()=>{const m=document.getElementById('moreMenu').getBoundingClientRect(),i=window.innerWidth;return m.width>0&&m.height>0&&m.left>=0&&m.right<=i})()`);
    assert.ok(inside, `${tag}: the open menu is inside the window`);
    await js(`document.getElementById('moreBtn').click()`);
    await back(tag);
    console.log('[helper-more]', tag, 'ok');
  }
  console.log('all checks passed');
};
