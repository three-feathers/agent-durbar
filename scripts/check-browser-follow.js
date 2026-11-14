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
 *   3. the Chat content keeps its width while collapsed (the cause: it re-wrapped wider, shorter, and grew back with no scroll event);
 *   4. spec 005 FR-243 (issue #1224): "at the end" is 2 px or less, also 1.3 s after new text (the typing row's timer), after a turn whose
 *      first text is one code block, and when a waiting card's answer bar appears under the chat and makes it shorter;
 *   closing the chat disconnects the box observer (the disconnects of #chat's observers are counted);
   all of it again with a classic scrollbar (15 px, injected style), where the collapsed chat would lose the scrollbar's width.
 * Waits are conditions or counts of frames, never a fixed sleep. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ID = 'sim-1';
  const NEAR = 3; /* "at the end": 2 px or less (spec 005 FR-243, issue #1224: it was 24 for a 10 px offset after new text, the typing row's label); losing the place is hundreds of px (the padding:0 mutant sits about 300 px away) */
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(ID)}},${jsLiteral(e)}))`);
  const para = (i, n) => Array.from({ length: n }, (_, k) => `Paragraph ${i}.${k}: the quick brown fox jumps over the lazy dog while the build runs the tests and checks every file in the folder for drift, then reports.`).join('\n\n');
  const frames = (n) => js(`new Promise(r=>{let k=0;const f=()=>{if(++k>=${jsLiteral(n)})r(1);else requestAnimationFrame(f)};requestAnimationFrame(f)})`);
  const st = () => js(`(()=>{const c=document.getElementById('chat'),i=c.querySelector(':scope > .chat-inner');return {gap:Math.round(c.scrollHeight-c.scrollTop-c.clientHeight),pin:c.dataset.pin,top:Math.round(c.scrollTop),ch:c.clientHeight,w:i?Math.round(i.getBoundingClientRect().width):0,kids:i?i.children.length:0}})()`);
  const CARDS = `(()=>{const c=document.getElementById('chat'),cr=c.getBoundingClientRect();return [...c.querySelectorAll('.note.perm')].map(n=>{const r=n.getBoundingClientRect();return {cls:n.className,top:Math.round(r.top-cr.top),h:Math.round(r.height)}}).concat([{ch:c.clientHeight,st:c.scrollTop,sh:c.scrollHeight}])})()`; /* where the waiting cards are, for a failure message */
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

  for (const [w, h, sb] of [[1440, 900, false], [1280, 800, false], [1440, 900, true], [1280, 800, true]]) {
    const tag = `${w}x${h}${sb ? ' classic scrollbar' : ''}`;
    await H.load({ w, h, ready: 'fit', focus: true });
    /* a classic scrollbar (Windows, Linux, macOS "always show"; FR-235) takes 15 px that overflow:hidden on the collapsed chat would give back */
    if (sb) await js(`(()=>{const st=document.createElement('style');st.textContent='#chat::-webkit-scrollbar{width:15px;background:#ddd}#chat::-webkit-scrollbar-thumb{background:#888}';document.head.append(st);})()`);
    /* count the disconnects of the observers of #chat (the box observer is made in openPanel, so the wrappers go in first) */
    await js(`(()=>{const P=ResizeObserver.prototype,ob=P.observe,dc=P.disconnect;window.__chatDisc=0;P.observe=function(t){if(t&&t.id==='chat')this.__chat=1;return ob.apply(this,arguments)};P.disconnect=function(){if(this.__chat)window.__chatDisc++;return dc.apply(this,arguments)}})()`);
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
    assert.ok(await until(`(()=>{const c=document.getElementById('chat');return c.scrollHeight-c.scrollTop-c.clientHeight<${jsLiteral(NEAR)}})()`), `${tag}: the streaming turn is followed ${JSON.stringify(await st())}`);
    await frames(5);
    let s = await st();
    assert.ok(s.kids <= 40 && s.gap < NEAR && s.pin === '1', `${tag}: a short chat at the end, following: ${JSON.stringify(s)}`);

    // 1. following
    const wd = await trip(tag, 200);
    await frames(10);
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: back at the end and following, no new text: ${JSON.stringify(s)}`);
    await frames(10);
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: still at the end 10 frames later: ${JSON.stringify(s)}`);
    await emit({ type: 'status', status: 'working', intent: 'Working' }); await stream(300); await stream(301); await frames(10);
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: new text keeps it at the end (two streamed blocks are 400 px): ${JSON.stringify(s)}`);

    // 4. spec 005 FR-243 (issue #1224): late growth after the follow, each case with its own cause
    assert.ok(await until(`/· [1-9]\\d*s$/.test(document.querySelector('#chat .typing .t-l').textContent)`, 10000), `${tag}: FR-243 the typing row's timer ran`); await frames(3); /* the 1 s timer has written the typing row's label */
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: FR-243 still at the end after the typing row's 1 s timer (an empty label grew the row by about 9 px): ${JSON.stringify(s)}`);
    await emit({ type: 'output', delta: '', final: true, text: 'done' }); await emit({ type: 'status', status: 'idle' }); await frames(5);
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'output', delta: 'Here is the change:\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));\n```\n\n' }); /* the turn's first and only text: nothing asks for a follow after it */
    await frames(10);
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: FR-243 a turn whose first text is one code block is followed (the follow read the height before the Markdown paint: 130 to 160 px): ${JSON.stringify(s)}`);
    const qid = 'q-1224-' + tag.replace(/\W/g, '');
    await emit({ type: 'question', phase: 'asked', requestId: qid, questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Sage' }, { label: 'Blue' }] }] });
    await emit({ type: 'status', status: 'needs-permission', intent: 'Waiting for your answer' });
    await frames(5);
    assert.ok(await until(`document.getElementById('answerBar').hidden`), `${tag}: FR-243 the answer bar waits while the card is in view`);
    await emit({ type: 'output', delta: '', final: true, text: 'done' }); await emit({ type: 'status', status: 'idle' }); await frames(5); /* the card still waits; the next turn's text goes under it */
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    for (let i = 0; i < 8 && (await js(`document.getElementById('answerBar').hidden`)); i++) { await stream(700 + i); await frames(3); } /* the card scrolls out of view under the followed text: the answer bar appears and the chat gets shorter */
    const barUp = await until(`!document.getElementById('answerBar').hidden`);
    const cards = barUp ? '' : JSON.stringify(await js(CARDS));
    assert.ok(barUp, `${tag}: FR-243 the answer bar appears once the card is out of view ${cards}`);
    await frames(10);
    s = await st();
    assert.ok(s.gap < NEAR && s.pin === '1', `${tag}: FR-243 still at the end when the answer bar makes the chat shorter (no follow of the box: about 58 px): ${JSON.stringify(s)}`);
    await emit({ type: 'question', phase: 'cancelled', requestId: qid, reason: 'test' });
    await emit({ type: 'output', delta: '', final: true, text: 'done' }); await emit({ type: 'status', status: 'idle' }); await frames(5);
    await emit({ type: 'status', status: 'working', intent: 'Working' }); await stream(800); await frames(5); /* a streaming turn again, as case 2 expects */

    assert.strictEqual(wd.wc, wd.w0, `${tag}: the messages keep their width while the chat is collapsed (Chat ${wd.w0} px, collapsed ${wd.wc} px)`);

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
    const d0 = await js(`window.__chatDisc`);
    await js(`document.getElementById('backBtn').click()`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`), `${tag}: back to the office`);
    assert.strictEqual(await js(`window.__chatDisc`), d0 + 1, `${tag}: FR-243 closing the chat disconnects its box observer (disconnects of #chat's observers: ${d0} before Back)`);
    console.log('[browser-follow]', tag, 'ok');
  }
  console.log('all checks passed');
};
