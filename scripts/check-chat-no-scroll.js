/*
 * Check for spec 052 FR-176 (issue #638): opening a chat, showing its waiting question, answering or skipping it never scrolls the
 * page or the chat's frame, so the chat header stays in view. Simulator only (no AI credits).
 *
 *   npm run check:chat-no-scroll
 *
 * At 1440x900, 1280x800 and 1280x520 (too short for the whole panel), with `simquestion=compact` (one short question):
 *   1. open the asking agent from its desk;  2. scroll the chat up and press Show question in the answer bar;
 *   3. scroll up and press Skip in the bar;  4. open it again and answer in the card (an option, then Answer when there is one);
 *   5. open the chat at the request from its desk's pending line (openAtRequest), when the office shows one.
 * After each step: html (the page), body, .workspace, #floor, #panel and .panel-in have scrollTop and scrollLeft 0, NO scroll event
 * reached any of them during the step (so the safety net did not have to hide a regression), and the chat header is inside the window.
 * 6. the page is scrolled on purpose: the safety net (DurbarScroll.pin) puts it back to 0.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { until, settle, js } = H;
  const FRAME = `[document.scrollingElement,document.documentElement,document.body,document.querySelector('.workspace'),document.getElementById('floor'),document.getElementById('panel'),document.querySelector('.panel-in')].filter(Boolean)`;
  /* our own log of scroll events on the pinned frame: the safety net resets them, so the values alone would hide a regression */
  const watch = () => js(`(()=>{window.__pinLog=[];if(window.__pinWatch)return;window.__pinWatch=1;document.addEventListener('scroll',e=>{const t=e.target===document?document.scrollingElement:e.target;
    if(t&&t.matches&&t.matches(window.DurbarScroll.PINNED))window.__pinLog.push((t.id||t.className||t.tagName)+'');},{capture:true,passive:true});})()`);
  const frame = () => js(`(()=>{const moved=${FRAME}.filter(e=>e.scrollTop||e.scrollLeft).map(e=>(e.id||e.className||e.tagName)+':'+e.scrollTop+'/'+e.scrollLeft);
    const h=document.getElementById('panelHead'),r=h&&h.getBoundingClientRect(),t=document.getElementById('panelTitle'),tr=t&&t.getBoundingClientRect();
    return {moved,events:window.__pinLog.slice(),head:!!r&&r.height>0&&r.top>=0&&tr.top>=0&&tr.bottom<=innerHeight,headTop:r?Math.round(r.top):null}})()`);
  const check = async (label) => {
    await ctx.sleep(120); await settle();
    const f = await frame();
    assert.deepStrictEqual(f.moved, [], `${label}: the page and the chat frame are not scrolled: ${JSON.stringify(f)}`);
    assert.deepStrictEqual(f.events, [], `${label}: nothing scrolled the page or the chat frame (not even for a moment): ${JSON.stringify(f)}`);
    assert.ok(f.head, `${label}: the chat header is in view: ${JSON.stringify(f)}`);
    await js(`window.__pinLog=[]`);
  };
  const chatTop = async () => { await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=0;c.dispatchEvent(new Event('scroll'));})()`); await ctx.sleep(120); await settle(); };
  const open = async (w, h) => {
    await H.load({ w, h, query: { simquestion: 'compact' }, ready: 'fit' });
    await watch();
    const o = await H.openSimAgent(`a=>!a.parent&&a.question`, '#chat .note.question .q-opt');
    assert.ok(o.ok, `${w}x${h}: an agent has the question in its chat: ${JSON.stringify({ id: o.id, ...o.seen })}`);
  };
  const barButton = async (label) => {
    assert.ok(await until(`[...document.querySelectorAll('#answerBar button')].some(b=>b.textContent===${jsLiteral(label)})`), `the answer bar has ${label}`);
    await js(`[...document.querySelectorAll('#answerBar button')].find(b=>b.textContent===${jsLiteral(label)}).click()`);
  };
  for (const [w, h] of [[1440, 900], [1280, 800], [1280, 520]]) {
    const at = `${w}x${h}`;
    // 1. open from the desk
    await open(w, h);
    await check(`${at} open`);
    // 2. Show question (focusRequest: the card to the middle of the chat, its first option focused)
    await chatTop();
    await barButton('Show question');
    assert.ok(await until(`document.activeElement&&document.activeElement.classList.contains('q-opt')`), `${at}: Show question focuses an option`);
    await check(`${at} Show question`);
    // 3. Skip in the bar (then the message box gets the focus)
    await chatTop();
    await barButton('Skip');
    assert.ok(await until(`!!document.querySelector('#chat .note.question.settled')`), `${at}: Skip settles the card`);
    await check(`${at} Skip`);
    // 4. answer in the card
    await open(w, h);
    await js(`document.querySelector('#chat .note.question .q-opt').click()`);
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .note.question:not(.settled) button')].find(b=>b.textContent.trim()==='Answer');if(b)b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#chat .note.question.settled')`), `${at}: the card is answered`);
    await check(`${at} answer in the card`);
    // 5. open at the request from the desk's pending line (openAtRequest), when the office shows it
    await H.load({ w, h, query: { simquestion: 'compact' }, ready: 'fit' });
    await watch();
    const pv = await until(`!!document.querySelector('#stage [data-pvopen]')`, 8000);
    if (pv) {
      await js(`document.querySelector('#stage [data-pvopen]').click()`);
      assert.ok(await until(`document.body.classList.contains('panel-open')&&document.activeElement&&!!document.activeElement.closest('#chat .note')`), `${at}: the chat opens with the request focused`);
      await check(`${at} open at the request`);
    } else console.log('[chat-no-scroll]', at, 'no pending line in the office: step 5 skipped');
    // 6. the safety net: a forced scroll of the page and of the chat frame is put back
    if (!(await js(`document.body.classList.contains('panel-open')`))) await open(w, h);
    await js(`document.scrollingElement.scrollTop=60;document.querySelector('.panel-in').scrollTop=40`);
    assert.ok(await until(`${FRAME}.every(e=>!e.scrollTop&&!e.scrollLeft)`, 3000), `${at}: the safety net puts the page back: ${JSON.stringify(await frame())}`);
    console.log('[chat-no-scroll]', at, 'ok');
  }
  console.log('[chat-no-scroll] all checks passed');
};
