/*
 * Spec 005 FR-235 (issue #1168): a chat keeps its place across Chat -> Browser -> Chat. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-browser-follow
 *
 * At 1440x900 and 1280x800, sim-1 gets a chat of long wrapping text turns (fewer than 41 messages, so no FR-210 marks) and a streaming turn:
 *   1. following the end: the Browser tab, more text streams while Chat is collapsed, back to Chat: at the end with no new text, still there
 *      10 frames later with the pin on, and new text keeps it at the end;
 *   2. scrolled up 400 px above the end (near enough that collapsing clamps it): the same trip leaves scrollTop and the pin off as they were,
 *      held over frames, and new text does not move it;
 *   3. the Chat content keeps its width while collapsed (the cause: it re-wrapped wider, shorter, and grew back with no scroll event).
 * Waits are conditions or counts of frames, never a fixed sleep. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ID = 'sim-1';
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(ID)}},${jsLiteral(e)}))`);
  const para = (i, n) => Array.from({ length: n }, (_, k) => `Paragraph ${i}.${k}: the quick brown fox jumps over the lazy dog while the build runs the tests and checks every file in the folder for drift, then reports.`).join('\n\n');
  const frames = (n) => js(`new Promise(r=>{let k=0;const f=()=>{if(++k>=${jsLiteral(n)})r(1);else requestAnimationFrame(f)};requestAnimationFrame(f)})`);
  const st = () => js(`(()=>{const c=document.getElementById('chat'),i=c.querySelector(':scope > .chat-inner');return {gap:Math.round(c.scrollHeight-c.scrollTop-c.clientHeight),pin:c.dataset.pin,top:Math.round(c.scrollTop),ch:c.clientHeight,w:i?Math.round(i.getBoundingClientRect().width):0,kids:i?i.children.length:0}})()`);
  const stream = async (i) => { await emit({ type: 'output', delta: para(i, 2) + '\n\n' }); await frames(2); };
  const trip = async (tag, extra) => {
    const w0 = (await st()).w;
    await js(`document.getElementById('tabBrowser').click()`);
    assert.ok(await until(`document.querySelector('.panel-in').classList.contains('on-browser')&&document.getElementById('chat').clientHeight===0`), `${tag}: the chat is collapsed on Browser`);
    for (let i = 0; i < 4; i++) await stream(extra + i);
    await emit({ type: 'output', delta: '', final: true, text: para(extra + 9, 2) }); await emit({ type: 'status', status: 'idle' }); /* the turn ends while Browser is in front */
    await frames(10);
    const wc = (await st()).w;
    await js(`document.getElementById('tabChat').click()`);
    assert.ok(await until(`document.getElementById('chat').clientHeight>100`), `${tag}: the chat is back`);
    return { w0, wc };
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', focus: true });
    const o = await H.openSimAgent(`a=>a.id===${jsLiteral(ID)}`, '#panelTabs');
    assert.ok(o.ok, `${tag}: the chat and its tabs are open: ${JSON.stringify(o.seen)}`);
    await H.settle();
    for (let i = 0; i < 14; i++) { await emit({ type: 'status', status: 'working', intent: 'Working' }); await emit({ type: 'output', delta: '', final: true, text: para(i, 3) }); await emit({ type: 'status', status: 'idle' }); }
    assert.ok(await until(`document.querySelector('#chat > .chat-inner').children.length>=14`, 15000), `${tag}: the history is drawn`);
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await frames(10);
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight;})()`); /* the person scrolls to the end: the pin goes on */
    assert.ok(await until(`document.getElementById('chat').dataset.pin==='1'`), `${tag}: at the end the pin is on`);
    await stream(100); await stream(101);
    assert.ok(await until(`(()=>{const c=document.getElementById('chat');return c.scrollHeight-c.scrollTop-c.clientHeight<2})()`), `${tag}: the streaming turn is followed ${JSON.stringify(await st())}`);
    await frames(5);
    let s = await st();
    assert.ok(s.kids <= 40 && s.gap < 2 && s.pin === '1', `${tag}: a short chat at the end, following: ${JSON.stringify(s)}`);

    // 1. following
    const wd = await trip(tag, 200);
    await frames(10);
    s = await st();
    assert.ok(s.gap < 2 && s.pin === '1', `${tag}: back at the end and following, no new text: ${JSON.stringify(s)}`);
    await frames(10);
    s = await st();
    assert.ok(s.gap < 2 && s.pin === '1', `${tag}: still at the end 10 frames later: ${JSON.stringify(s)}`);
    await emit({ type: 'status', status: 'working', intent: 'Working' }); await stream(300); await stream(301); await frames(10);
    s = await st();
    assert.ok(s.gap < 24 && s.pin === '1', `${tag}: new text keeps it at the end (two streamed blocks are 400 px; a last wrapped line may land a frame after the write, under 24 px): ${JSON.stringify(s)}`);

    assert.strictEqual(wd.wc, wd.w0, `${tag}: the messages keep their width while the chat is collapsed`);

    // 2. scrolled up near the end
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight-c.clientHeight-400;})()`);
    assert.ok(await until(`document.getElementById('chat').dataset.pin==='0'`), `${tag}: scrolling up switches the pin off`);
    await frames(5);
    const t0 = (await st()).top;
    await trip(tag, 400);
    for (let k = 0; k < 2; k++) {
      await frames(10);
      s = await st();
      assert.ok(s.top === t0 && s.pin === '0', `${tag}: scrolled up chat keeps its place (was ${t0}): ${JSON.stringify(s)}`);
    }
    await emit({ type: 'status', status: 'working', intent: 'Working' }); await stream(500); await frames(10);
    s = await st();
    assert.ok(s.top === t0 && s.pin === '0', `${tag}: new text does not move a chat scrolled up: ${JSON.stringify(s)}`);
    await emit({ type: 'output', delta: '', final: true, text: 'done' }); await emit({ type: 'status', status: 'idle' });
    console.log('[browser-follow]', tag, 'ok');
  }
  console.log('all checks passed');
};
