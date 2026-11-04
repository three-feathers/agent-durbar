/*
 * Spec 005 FR-235 (issue #1168): a chat keeps its place across Chat -> Browser -> Chat. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-browser-follow
 *
 * At 1440x900 and 1280x800, a long chat of the simulator's sim-1 (events through the test hook):
 *   1. at the end and following (pin 1): the Browser tab, a turn writes more while Browser is in front, back to Chat: the chat is at the
 *      end (not 8 px away) and still following (a new line moves the end and the view goes with it);
 *   2. scrolled up (pin 0): the Browser tab, a turn writes, back to Chat: the same scrollTop, pin still 0.
 * Every wait is until() on a condition, none on time. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const ID = 'sim-1';
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(ID)}},${jsLiteral(e)}))`);
  const gap = () => js(`(()=>{const c=document.getElementById('chat');return Math.round(c.scrollHeight-c.scrollTop-c.clientHeight)})()`);
  const pin = () => js(`document.getElementById('chat').dataset.pin`);
  const top = () => js(`document.getElementById('chat').scrollTop`);
  const count = () => js(`document.querySelectorAll('#chat .chip').length`);
  let n = 0;
  const write = async (k) => { // k more tool rows in the running turn; wait until the chat has drawn them
    const before = await count();
    for (let i = 0; i < k; i++, n++) {
      await emit({ type: 'toolCall', sessionId: ID, callId: 'bf-' + n, tool: 'grep', phase: 'start', args: { pattern: 'p' + n } });
      await emit({ type: 'toolCall', sessionId: ID, callId: 'bf-' + n, tool: 'grep', phase: 'complete', output: n + ' matches' });
    }
    await ok(`document.querySelectorAll('#chat .chip').length>=${jsLiteral(before + k)}`, `${k} rows were drawn`);
  };
  /* what FR-210 describes: messages whose size is an estimate while the chat is collapsed (Browser tab) lay out for real when it opens, so the
     end moves after the clamp. A fixed 24px estimate on the last messages is the same mechanism; without the fix the pin goes off then. */
  const estimate = () => js(`(()=>{const k=[...document.querySelector('#chat > .chat-inner').children];k.slice(-6).forEach(e=>{e.style.contentVisibility='auto';e.style.containIntrinsicBlockSize='24px';});return k.length})()`);
  const tab = async (id) => { await js(`document.getElementById(${jsLiteral(id)}).click()`); };
  const atEnd = async (tag) => { const near = await until(`(()=>{const c=document.getElementById('chat');return c.clientHeight>100&&c.scrollHeight-c.scrollTop-c.clientHeight<2})()`, 8000); assert.ok(near, `${tag}: at the end (gap ${await gap()}, pin ${await pin()})`); };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', focus: true });
    const o = await H.openSimAgent(`a=>a.id===${jsLiteral(ID)}`, '#panelTabs');
    assert.ok(o.ok, `${tag}: the chat and its tabs are open: ${JSON.stringify(o.seen)}`);
    await H.settle();
    await emit({ type: 'status', sessionId: ID, status: 'working', intent: 'Working' });
    await write(30);
    await ok(`(()=>{const c=document.getElementById('chat');return c.scrollHeight>c.clientHeight*2})()`, `${tag}: the chat scrolls (else nothing is tested)`);
    await atEnd(tag + ' before');
    assert.strictEqual(await pin(), '1', `${tag}: following at the start`);

    // 1. following: Browser, a turn writes, Chat
    await tab('tabBrowser');
    await ok(`document.querySelector('.panel-in').classList.contains('on-browser')&&document.getElementById('chat').clientHeight===0`, `${tag}: the chat is collapsed on Browser`);
    await write(12);
    await estimate();
    await tab('tabChat');
    await ok(`document.getElementById('chat').clientHeight>100`, `${tag}: the chat is back`);
    await atEnd(tag + ' after Browser');
    assert.strictEqual(await pin(), '1', `${tag}: still following after Browser`);
    await write(3);
    await atEnd(tag + ' following new text');
    assert.strictEqual(await pin(), '1', `${tag}: still following after new text`);

    // 2. scrolled up: the position and the pin stay (the person scrolls after the three frames that follow the return)
    await ok(`!document.getElementById('chat')._hold`, `${tag}: the return has settled`);
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=Math.round(c.scrollHeight/3);})()`);
    await ok(`document.getElementById('chat').dataset.pin==='0'`, `${tag}: scrolling up switches the pin off (pin ${await pin()}, top ${await top()})`);
    const t0 = await top();
    await tab('tabBrowser');
    await ok(`document.getElementById('chat').clientHeight===0`, `${tag}: collapsed again`);
    await write(6);
    await estimate();
    await tab('tabChat');
    await ok(`document.getElementById('chat').clientHeight>100`, `${tag}: back again`);
    await ok(`Math.abs(document.getElementById('chat').scrollTop-${jsLiteral(t0)})<=1`, `${tag}: the position is kept (was ${t0}, now ${await top()})`);
    assert.strictEqual(await pin(), '0', `${tag}: the pin stays off`);
    await write(2);
    assert.ok(Math.abs((await top()) - t0) <= 1, `${tag}: new text does not move a chat scrolled up`);
    console.log('[browser-follow]', tag, 'ok');
  }
  console.log('all checks passed');
};
