/*
 * Spec 069 FR-069 (issue #1624): a switch in Settings repaints the page, and the page keeps its scroll position, the focused control and
 * the open or closed state of the Advanced (MCP) block. The Copilot CLI list switch and the Claude Code list switch each rebuild Settings;
 * before the fix the page jumped back to its top. Every switch listed below is read: scrollTop before and after, the focused control, and
 * the Advanced block. Simulator only (no AI credits, no agent app, no real MCP server).
 *
 *   npm run check:ui -- --only check-069-toggle-scroll
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const raf2 = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
  // the element that scrolls Settings (the nearest scrolling ancestor of the MCP list)
  const SC = `window.__sc=()=>{let e=document.getElementById('ambList');while(e&&!(e.scrollHeight>e.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)))e=e.parentElement;return e;};true`;
  const state = () => js(`(()=>{const s=window.__sc(),a=document.activeElement;return {top:s?Math.round(s.scrollTop):-1,room:s?s.scrollHeight-s.clientHeight:-1,focus:a&&a.closest&&a.closest('li[data-amb],li[data-g]')?((a.closest('li[data-amb]')||a.closest('li[data-g]')).dataset.amb||a.closest('li[data-g]').dataset.g)+':'+a.dataset.act:(a&&(a.id||a.dataset.world))||'',adv:document.getElementById('advMcp').open}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('ambList')&&document.getElementById('advMcp').open`), `${w}: Settings > MCP is open`);
    await H.settle();
    await js(SC); // the page's own helper: the element that scrolls Settings

    // the switches that repaint the whole page, and a few that only change themselves
    const SWITCHES = [
      ['Copilot CLI list switch', `#ambList li[data-amb] [data-act=amb]`],
      ['Claude Code list switch', `#globList li[data-g] [data-act=gcl]`],
      ['Serious mode', '#seriousSw'], ['Motion', '#motionSw'], ['Notifications', '#notifySw'], ['Coffee break resume', '#breakSw'],
      ['Still highlights', '#stillSw'], ['MCP sign-in refresh', '#mcpRefreshSw'], ['Auto-follow', '#followSw'], ['Live activity', '#liveActSw'],
      ['Diagnostics', '#diagSw'], ['Shutters', '#shutSw'],
    ];
    // Settings is settled when its height has not changed for ten frames (the agent app, quota and policy rows arrive after the paint)
    const stable = () => js(`new Promise(res=>{let last=-1,n=0,k=0;const t=()=>{const e=document.querySelector('.scr-body'),h=e?e.scrollHeight:-2;n=h===last?n+1:0;last=h;if(n>=10||++k>240)res(true);else requestAnimationFrame(t);};t();})`);
    for (const [label, sel] of SWITCHES) {
      if (!(await js(`!!document.querySelector(${jsLiteral(sel)})`))) { console.log(`[069-1624] ${w}: ${label} is not in this build: skipped`); continue; }
      for (let round = 1; round <= 2; round++) { // off, then on again
        // scroll so the switch is in view and the page is well below its top
        await js(`(()=>{const s=window.__sc();const b=document.querySelector(${jsLiteral(sel)});s.scrollTop+=b.getBoundingClientRect().top-s.getBoundingClientRect().top-200;b.focus({preventScroll:true});})()`);
        await raf2();
        await stable();
        const before = await state();
        assert.ok(before.top > 0, `${w}: ${label}: the page is scrolled before the click (scrollTop ${before.top}, room ${before.room})`);
        const was = await js(`document.querySelector(${jsLiteral(sel)}).getAttribute('aria-checked')`);
        await js(`document.querySelector(${jsLiteral(sel)}).click()`);
        // settled: the switch (found again) shows the new value, then two frames
        assert.ok(await until(`document.querySelector(${jsLiteral(sel)}).getAttribute('aria-checked')!==${jsLiteral(was)}`, 6000), `${w}: ${label} round ${round}: the switch changed`);
        await raf2();
        await stable();
        const after = await state();
        assert.ok(Math.abs(after.top - before.top) <= 1, `${w}: ${label} round ${round}: the page keeps its scroll (before ${before.top}, after ${after.top})`);
        assert.strictEqual(after.focus, before.focus, `${w}: ${label} round ${round}: the focus stays on the same control`);
        assert.strictEqual(after.adv, true, `${w}: ${label} round ${round}: the Advanced (MCP) block stays open`);
      }
    }
  }
  console.log('[069-1624] PASS');
};
