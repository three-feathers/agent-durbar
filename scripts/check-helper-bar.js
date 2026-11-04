/*
 * Spec 015 FR-018 (issue #1142): the "Sub-agent activity / Back to parent chat" bar stays at the top of a helper's chat while the log
 * scrolls. Simulator only (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:ui -- --only check-helper-bar
 *   OUT=<dir>  (optional) also saves 015-helper-bar-{top,end}-{1440x900,1280x800}.png
 *
 * At 1440x900 and 1280x800 (SIM=15), in a helper's chat padded with a long log: at scroll top the bar is the first thing in the log and
 * covers no message; scrolled to the end the bar is still inside the chat's top edge and flush with it (no line shows above it), its background is opaque, its text is at least
 * 10.5 px, `elementFromPoint` at the middle of "Back to parent chat" is that button, and a click returns to the parent's chat.
 * Every wait is until() and its result is asserted. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const geom = () => js(`(()=>{const c=document.getElementById('chat'),bar=c.querySelector('.sub-ro'),btn=bar&&bar.querySelector('[data-parentchat]');if(!bar||!btn)return null;
    const cr=c.getBoundingClientRect(),br=bar.getBoundingClientRect(),tr=btn.getBoundingClientRect(),hit=document.elementFromPoint(tr.left+tr.width/2,tr.top+tr.height/2);
    const next=bar.nextElementSibling,nr=next&&next.getBoundingClientRect(),bg=getComputedStyle(bar).backgroundColor;
    const alpha=/rgba\\(.*,\\s*([\\d.]+)\\)/.exec(bg);
    const small=[...bar.querySelectorAll('b,span,button')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<10.5).length;
    return {top:c.scrollTop,max:c.scrollHeight-c.clientHeight,inView:br.top>=cr.top-1&&br.bottom<=cr.bottom+1&&br.height>0,btnHit:!!hit&&hit.closest('[data-parentchat]')===btn,
      clear:!nr||br.bottom<=nr.top+1,opaque:!alpha||+alpha[1]===1,small,pos:getComputedStyle(bar).position,barTop:Math.round(br.top-cr.top)}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    const helper = await js(`(()=>{const h=window.__durbarSimUi.agents().find(a=>a.parent&&document.querySelector('#stage .helper[data-id="'+CSS.escape(a.id)+'"]'));return h?h.id:null})()`);
    assert.ok(helper, `${tag}: a helper is on the office floor`);
    await js(`document.querySelector('#stage .helper[data-id="'+CSS.escape(${jsLiteral(helper)})+'"]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.querySelector('#panel .panel-in.ro')`, `${tag}: the helper's chat is open`);
    await H.settle();
    await ok(`!!document.querySelector('#chat .sub-ro [data-parentchat]')`, `${tag}: the helper's chat has the Sub-agent activity bar`);
    /* a long log under the bar */
    await js(`(()=>{const inner=document.querySelector('#chat .chat-inner');for(let i=0;i<80;i++){const d=document.createElement('div');d.className='note';d.dataset.fill='1';d.textContent='Filler line '+i+' of a long helper transcript, to scroll past the bar.';inner.appendChild(d);}document.getElementById('chat').scrollTop=0})()`);
    await H.settle();
    const top = await geom();
    assert.ok(top && top.max > 400, `${tag}: the log is long enough to scroll (${JSON.stringify(top)})`);
    assert.strictEqual(top.top, 0, `${tag}: at scroll top`);
    assert.ok(top.inView && top.clear && top.btnHit, `${tag}: at the top the bar is in view, covers no message and takes the click: ${JSON.stringify(top)}`);
    await H.shot(path.join(OUT, `015-helper-bar-top-${tag}.png`), { prep: 'calm', settle: true, tag: 'helper-bar', what: 'top ' + tag });

    await js(`(()=>{const c=document.getElementById('chat');c.dataset.pin='0';c.scrollTop=c.scrollHeight})()`);
    await ok(`(()=>{const c=document.getElementById('chat');return c.scrollHeight-c.clientHeight-c.scrollTop<2})()`, `${tag}: scrolled to the end`);
    const end = await geom();
    assert.ok(end.top > 400, `${tag}: really scrolled (${end.top})`);
    assert.strictEqual(end.pos, 'sticky', `${tag}: the bar is sticky`);
    assert.ok(end.inView, `${tag}: at the end of a long log the bar is still in view: ${JSON.stringify(end)}`);
    assert.ok(end.btnHit, `${tag}: at the end, elementFromPoint on "Back to parent chat" is the button: ${JSON.stringify(end)}`);
    assert.strictEqual(end.barTop, 0, `${tag}: stuck, the bar is flush with the top of the log, so no line shows above it: ${JSON.stringify(end)}`);
    assert.ok(end.opaque, `${tag}: the bar's background is opaque`);
    assert.strictEqual(end.small, 0, `${tag}: the bar's text is at least 10.5 px`);
    await H.shot(path.join(OUT, `015-helper-bar-end-${tag}.png`), { prep: 'calm', settle: true, tag: 'helper-bar', what: 'end ' + tag });

    await js(`document.querySelector('#chat .sub-ro [data-parentchat]').click()`);
    await ok(`!document.querySelector('#panel .panel-in.ro')&&document.body.classList.contains('panel-open')`, `${tag}: Back to parent chat shows the parent's chat`);
    console.log('[helper-bar]', tag, 'ok');
  }
  console.log('all checks passed');
};
