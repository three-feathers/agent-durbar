/*
 * Spec 052 FR-182..FR-190 (issue #686): opt-in Auto-follow and the attention queue. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-auto-follow
 *   OUT=<folder>  (optional) saves the pictures (052-auto-follow-{1440x900,1280x800}.png and the steps)
 *
 * At 1440x900 and 1280x800 (15 agents): off by default (no strip, `[` / `]` do nothing, a send leaves the chat open); Settings' switch turns it on
 * (a real click); a send returns to the office with the desk marked and the focus on it; a completion, a permission request, an error and a limit open
 * the chat with the focus on its title (never an answer button; Enter there approves nothing); a dialog, a menu and a field being typed in each hold the
 * switch until they clear, as do a key typed in the last 2 s and a window in the background or hidden; a chat opened by hand ends the following; a chat already shown moves nothing; a hidden folder opens nothing; Previous and Next by pointer and by
 * keys with the position and count; pause; the empty queue; the strip's text at least 10.5px and the page rules (no overlap, no scroll). Every wait is
 * until() and its result is asserted; keys and clicks are real input events.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  /* spec 052 FR-239: every automatic move here goes through the Auto-follow notice, shortened to 600 ms after each load (simulator only) so this
     driver's many moves stay quick; its words, the 3 s default, Stay and Escape are check-052-follow-notice's */
  const load0 = H.load;
  H.load = async (o) => { await load0(o); assert.strictEqual(await js(`window.__durbarSimUi.afNotice.ms(600)`), 600, 'the notice is shortened for this driver'); };
  /* The whole driver runs with Chromium's focus emulation on (spec 052 delta 2026-11-05, #1179): the return to the office after a send is decided once, at the
     moment the app accepts the message, and is skipped when the window is in the background then; on the shared Windows desktop a neighbour can take the OS focus at
     that moment, and no later wait can bring the return back. The hold steps below stand in for a blur with window.__durbarFocus, not with the OS, so they still test it. */
  await H.focusPage({ emulate: 'first' });
  try {
  const wc = ctx.win.webContents;
  const MOD = process.platform === 'darwin' ? ['meta'] : ['control'];
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  /* An arrival the strip delivers is held while the window is in the background (FR-185). On Windows CI three drivers share one desktop and a neighbour's
     window can take the OS focus at any moment, so a wait for an arrival asks for the real focus again at any look where the page lacks it (the whole driver also runs
     under emulate:'first', see above; the background hold steps stand in for a blur with window.__durbarFocus) and, when it fails, says what the page saw (focus and the strip's text). Every wait still ends as soon as the condition holds. */
  const okArrival = async (expr, what, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      if (!(await js(`document.hasFocus()`))) await H.focusPage({ ms: 1500 }); /* only when it is lost: a focus call on a focused window raises a focus event, and the strip holds an arrival for POINTER_MS after one (FR-185) */
      if (await until(expr, 1500)) return;
      if (Date.now() > end) break;
    }
    const seen = await js(`({focus:document.hasFocus(),strip:(document.getElementById('afText')||{}).textContent||'',open:document.body.classList.contains('panel-open')})`);
    assert.fail(what + ' (page: ' + JSON.stringify(seen) + ')');
  };
  const sel = (id) => `#stage .desk[data-id="${id}"]`;
  const E = (id, ev) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},${jsLiteral(ev)}))`);
  const finish = async (id, text) => { await E(id, { type: 'status', status: 'working', intent: 'Working' }); await E(id, { type: 'output', final: true, text: text || 'All done.' }); await E(id, { type: 'status', status: 'idle' }); };
  /* a real click, and the page has had it */
  const clickAt = async (x, y) => {
    await js(`(()=>{if(!window.__upOn){window.__upOn=1;document.addEventListener('click',()=>{window.__ups++;},true);}window.__ups=0;})();0`);
    for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await until(`window.__ups>0`, 1500); /* a click may land on nothing that takes it: the step's own check says so */
  };
  /* FR-048b, a negative: true at every look for this long, sampled in the page, so a slow machine only looks less often */
  const stays = async (expr, what, ms = 700) => assert.strictEqual(await js(`new Promise(res=>{const end=Date.now()+${Number(ms)},t=setInterval(()=>{if(!(${expr})){clearInterval(t);res(false);}else if(Date.now()>=end){clearInterval(t);res(true);}},25);})`), true, what);
  const OPEN = `document.body.classList.contains('panel-open')`;
  const mclick = async (selector) => {
    const r = await js(`(()=>{const e=document.querySelector(${jsLiteral(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    assert.ok(r, `${selector} is there to click`);
    await clickAt(r.x, r.y);
  };
  const type = async (s) => { for (const ch of s) await H.key(ch === ' ' ? 'Space' : ch, [], { char: 'always', pause: 15 }); };
  const panelOpen = () => js(`document.body.classList.contains('panel-open')`);
  const title = () => js(`(document.getElementById('panelTitle')||{}).textContent||''`);
  const active = () => js(`(()=>{const a=document.activeElement;return {id:a&&a.id||'',cls:a&&a.className&&String(a.className)||'',tag:a?a.tagName:'',inBar:!!(a&&a.closest&&a.closest('.answer-bar,.note-actions,.q-opts')),desk:a&&a.dataset&&a.dataset.id||''}})()`);
  const stateOf = (id) => js(`(()=>{const d=document.querySelector(${jsLiteral(sel(id))});return d?d.dataset.state:null})()`);
  const strip = () => js(`(()=>{const s=document.getElementById('followStrip');if(!s)return null;const r=s.getBoundingClientRect();return {hidden:s.hidden,h:r.height,text:(document.getElementById('afText')||{}).textContent||'',pos:(document.getElementById('afPos')||{}).textContent||'',pause:(document.getElementById('afPause')||{}).textContent||'',prev:(document.getElementById('afPrev')&&document.getElementById('afPrev').getAttribute('aria-label'))||'',next:(document.getElementById('afNext')&&document.getElementById('afNext').getAttribute('aria-label'))||''}})()`);
  const followed = () => js(`[...document.querySelectorAll('.is-followed')].map(n=>n.dataset.id).sort().join(',')`);
  const marks = () => js(`[...document.querySelectorAll('#stage .unread-mark')].map(m=>m.closest('[data-id]').dataset.id).sort().join(',')`);
  /* the desk's picture: the middle of a name or a card can be the rename pencil, which is there on purpose and opens a rename */
  /* Issue #1343: the office lays out again only some time after the floor changes height (the strip appearing when Auto-follow is turned on: up to
     2 s here, longer on a loaded runner), and until then its desks overflow the floor. At 1280x800 that layout puts Priya's desk elsewhere, so a
     point measured before it was a point on another desk by the time of the click (Omar's: the send went to him and nothing was followed). The
     click waits for the office to fit its floor again, and the chat that opens must be the one asked for. */
  const officeFits = `document.body.classList.contains('panel-open')||document.getElementById('stage').dataset.fit!=='ok'||document.getElementById('floor').scrollHeight<=document.getElementById('floor').clientHeight+1`;
  const openChat = async (id) => {
    if (!(await until(officeFits, 10000))) assert.fail('the office is laid out for its floor before ' + id + ' is clicked (floor scroll/client height: ' + await js(`(()=>{const f=document.getElementById('floor');return f.scrollHeight+'/'+f.clientHeight})()`) + ')');
    const name = await nameOf(id);
    const p = await js(`(()=>{const d=document.querySelector(${jsLiteral(sel(id))});d.scrollIntoView({block:'nearest'});const b=d.getBoundingClientRect(),x=Math.round(b.left+Math.min(24,b.width/4)),y=Math.round(b.top+b.height*0.7),e=document.elementFromPoint(x,y);return {x,y,inside:!!e&&d.contains(e)};})()`);
    assert.ok(p.inside, id + ': the point on its desk is the desk');
    await clickAt(p.x, p.y);
    if (!(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(name)}`, 8000))) assert.fail('the chat of ' + id + ' (' + name + ') opens (open: ' + await panelOpen() + ', title: ' + JSON.stringify(await title()) + ')');
  };
  const backToOffice = async () => { await H.key('Escape'); await ok(`!document.body.classList.contains('panel-open')`, 'the chat closes'); };
  const send = async (id, text) => { await openChat(id); await mclick('#msgInput'); await type(text); await H.key('Return'); };
  /* accepted, with no scripted reply after it: the event the step emits is the only arrival (the script's own Done would replace an error) */
  const sendQuiet = async (id, text) => {
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;b.send=async()=>({ok:true});})();0`);
    await send(id, text);
    await okArrival(`!document.body.classList.contains('panel-open')`, 'back in the office after the send', 8000);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.send=b.__send;})();0`);
  };
  const setting = async (want) => {
    await mclick('#settingsBtn');
    await ok(`!!document.getElementById('followSw')`, 'Settings has the Auto-follow switch');
    const now = (await js(`document.getElementById('followSw').getAttribute('aria-checked')`)) === 'true';
    if (now !== want) { await mclick('#followSw'); await ok(`document.getElementById('followSw').getAttribute('aria-checked')===${jsLiteral(String(want))}`, 'the switch follows the answer of main'); }
    await H.key('Escape');
    await ok(`document.getElementById('screen').hidden`, 'Settings closes');
  };
  const SIZES = process.env.AF_FAST ? [[1440, 900]] : [[1440, 900], [1280, 800]];
  const anns = () => js(`window.__ann.slice()`);
  const A = 'sim-7', B = 'sim-13', C = 'sim-15'; // Priya and Hugo (idle at start), Maya (Done at start)

  const nameOf = (id) => js(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}))||{}).name||''`);
  const idByName = (n) => js(`((window.__durbarSimUi.agents().find(a=>a.name===${jsLiteral(n)}))||{}).id||''`);
  const inboxIds = async () => {
    await H.key('i', [], { char: 'always' });
    await ok(`!!document.getElementById('inboxDlg')`, 'the inbox opens');
    const ids = await js(`[...document.querySelectorAll('#inboxDlg .inbox-row[data-id]')].map(r=>r.dataset.id)`);
    await H.key('Escape'); await ok(`!document.getElementById('inboxDlg')`, 'the inbox closes');
    return ids;
  };
  const posText = async () => (await strip()).pos;
  // the simulator's own state (the stage is not redrawn while a chat is open)
  const settled = (id) => ok(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(id)});return a&&a.state!=='working'&&a.state!=='thinking'})()`, id + ' is not working', 25000);
  const shotTo = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', settle: true });
  const fonts = (ids) => js(`${jsLiteral(ids)}.map(i=>{const e=document.getElementById(i);return e?parseFloat(getComputedStyle(e).fontSize):0})`);
  const hooks = () => js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    wc.focus();
    await hooks();

    // ---- off by default: nothing changes
    assert.strictEqual((await strip()).hidden, true, `${tag}: no strip while Auto-follow is off`);
    assert.strictEqual(await js(`document.getElementById('followStrip').getClientRects().length`), 0, `${tag}: the strip takes no room`);
    await send(A, 'hello off');
    await ok(`[...document.querySelectorAll('#chat .msg.user')].some(m=>/hello off/.test(m.textContent))`, `${tag}: the message was sent`);
    await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.is-followed')`, `${tag}: off: a send leaves the chat open and marks nothing`);
    const t0 = await title();
    await H.key(']', [], { char: 'always' });
    await stays(`(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(t0)}`, `${tag}: off: ] does not move to another chat`);
    await settled(A);
    await stays(OPEN, `${tag}: off: the chat stayed open when the reply came`);
    await backToOffice();
    assert.strictEqual(await js(`document.getElementById('followSw')`), null, 'no switch outside Settings');

    // ---- on: the switch is a real click, the answer comes from main (the simulator's stand-in refuses a non-boolean like main)
    assert.deepStrictEqual(await js(`window.__durbarSimUi.bridge().setAutoFollowWork('yes').then(r=>({ok:r.ok,v:r.autoFollowWork}))`), { ok: false, v: false }, `${tag}: a non-boolean is refused with ok:false`);
    await setting(true);
    let st = await strip();
    assert.ok(!st.hidden && st.h >= 28 && st.h <= 40, `${tag}: the strip shows, one row: ${st.h}px`);
    assert.strictEqual(st.text, 'Auto-follow on. It follows an agent after you send it a message.', `${tag}: idle words`);
    for (const f of await fonts(['afText', 'afPos', 'afPrev', 'afNext', 'afPause'])) assert.ok(f >= 10.5, `${tag}: strip text is at least 10.5px: ${f}`);
    {
      await until(`(${pageCheck.toString()})(false, 5).problems.length===0`, 5000); /* the office lays out again with the strip */
      const probs = (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
      assert.deepStrictEqual(probs, [], `${tag}: the office with the strip: no overlap, no scroll, text >= 10.5px: ${JSON.stringify(probs)}`);
    }
    await shotTo(`052-auto-follow-idle-${tag}.png`);

    // ---- send -> office and desk -> completion opens the chat on its title
    await sendQuiet(A, 'hello follow');
    const nameA = await nameOf(A);
    if (!(await until(`!document.body.classList.contains('panel-open')&&!!document.querySelector(${jsLiteral(sel(A) + '.is-followed')})&&document.activeElement&&document.activeElement.dataset.id===${jsLiteral(A)}`, 8000))) assert.fail(`${tag}: back to the office with ${nameA} followed and focused ` + JSON.stringify(await js(`({open:document.body.classList.contains('panel-open'),f:[...document.querySelectorAll('.is-followed')].map(n=>n.dataset.id),act:document.activeElement&&(document.activeElement.id||document.activeElement.className),notice:!!document.querySelector('.af-notice'),n:document.querySelectorAll('#stage .desk[data-id="sim-7"]').length,same:document.activeElement===document.querySelector('#stage .desk[data-id="sim-7"]'),cls:(document.querySelector('#stage .desk[data-id="sim-7"]')||{}).className,strip:document.getElementById('afText').textContent})`)));
    const off = await js(`(()=>{const c=getComputedStyle(document.querySelector(${jsLiteral(sel(A))}));return {ol:c.outlineStyle+' '+c.outlineWidth,tx:document.getElementById('afText').textContent};})()`);
    assert.strictEqual(off.ol, 'dashed 2px', `${tag}: the marker is a dashed 2px outline (not colour alone): ${off.ol}`);
    assert.ok(new RegExp(nameA + ' is working\\. Back to the office\\.').test(off.tx), `${tag}: honest status: ${off.tx}`);
    assert.ok(!/done|finished/i.test(off.tx), `${tag}: the status promises nothing`);
    await ok(`window.__ann.includes(${jsLiteral(nameA + ' is working. Back to the office.')})`, `${tag}: said`);
    await finish(A, 'All done.');
    await okArrival(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}`, `${tag}: its chat opens when it finishes`, 25000);
    let ac = await active();
    assert.strictEqual(ac.id, 'panelTitle', `${tag}: focus is on the chat title: ${JSON.stringify(ac)}`);
    assert.strictEqual(await followed(), '', `${tag}: no longer followed once shown`);
    assert.strictEqual((await anns()).filter((t) => t.includes('Back to the office')).length, 1, `${tag}: announced once`);
    await ok(`window.__ann.includes(${jsLiteral(nameA + ' finished. Its chat is open.')})`, `${tag}: the arrival was the completion`);
    await shotTo(`052-auto-follow-chat-${tag}.png`);
    await settled(A); await backToOffice();
    await ok(`!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: the reply was shown, so it is not marked New`);

    // ---- a permission request: the chat opens, Enter on the title approves nothing
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(A)},'ask',{}).then(r=>r.ok)`), true, `${tag}: ${nameA} goes to Ask first`);
    await send(A, 'please edit the file');
    await okArrival(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}&&!!document.querySelector('#chat .note.perm:not(.settled)')&&document.activeElement&&document.activeElement.id==='panelTitle'`, `${tag}: ${nameA}'s permission request opens its chat with the focus on the title`, 25000);
    ac = await active();
    assert.ok(ac.id === 'panelTitle' && !ac.inBar, `${tag}: focus on the title, not a button of the request: ${JSON.stringify(ac)}`);
    for (const k of ['Return', 'Space']) await H.key(k, [], { char: 'always' });
    await stays(`!!document.querySelector('#chat .note.perm:not(.settled)')`, `${tag}: Enter and Space on the title approved nothing: the request is still open`);
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A)}).state`), 'waiting', `${tag}: and the agent still waits`);
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .note.perm:not(.settled) .note-actions button')].find(x=>/deny/i.test(x.textContent));if(b)b.click();})()`); // the user's own answer, to free the agent
    await settled(A); await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: the Office button closes the chat`);

    // ---- an error and a limit
    await sendQuiet(B, 'hello error');
    await E(B, { type: 'status', status: 'error', intent: 'The agent app stopped with an error.' });
    const nameB = await nameOf(B);
    await okArrival(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameB)}`, `${tag}: an error opens the chat`, 15000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: error: focus on the title`);
    await ok(`window.__ann.includes(${jsLiteral(nameB + ' has an error. Its chat is open.')})`, `${tag}: the arrival was the error`);
    await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: the Office button closes the chat`);
    await sendQuiet(C, 'hello limit');
    await E(C, { type: 'limit', phase: 'exhausted', requestId: 'lim-af', maxAiCredits: 30, usedAiCredits: 30 });
    const nameC = await nameOf(C);
    await okArrival(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameC)}`, `${tag}: a limit opens the chat`, 15000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: limit: focus on the title`);
    await ok(`window.__ann.includes(${jsLiteral(nameC + ' reached its limit. Its chat is open.')})`, `${tag}: the arrival was the limit`);
    await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: the Office button closes the chat`);

    // ---- Previous and Next over the queue: the inbox's order (needsMeOrder) then the unread; position and count; keys and pointer
    const U = await idByName('Noor');
    await finish(U, 'Noor is done.');
    await ok(`!!document.querySelector(${jsLiteral(sel(U) + ' .unread-mark')})`, `${tag}: ${U} is unread`);
    const needs = await inboxIds();
    const queue = [...needs.filter((x) => x !== U), U];
    assert.ok(needs.length >= 2 && needs.includes(C), `${tag}: the simulator's waiting agents and the limit are in the inbox: ${needs}`);
    const N = queue.length;
    st = await strip();
    assert.strictEqual(st.pos, `Attention: ${N} need you`, `${tag}: outside the queue it says the count only: ${st.pos}`);
    await H.key(']', [], { char: 'always' });
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(queue[0]))}`, `${tag}: ] from the office opens the first of the queue`);
    assert.strictEqual(await posText(), `Attention: 1 of ${N}`, `${tag}: position and count`);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: Next focuses the title`);
    for (let i = 1; i < N; i++) {
      if (i % 2) await H.key(']', [], { char: 'always' }); else await mclick('#afNext');
      await ok(`document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(queue[i]))}`, `${tag}: Next ${i}: ${queue[i]} (the queue is the inbox's order, then unread)`);
      assert.strictEqual(await posText(), `Attention: ${i + 1} of ${N}`, `${tag}: position ${i + 1} of ${N}`);
    }
    // the unread one is shown (its marker clears) and keeps its place
    await ok(`!document.querySelector('.sitem[data-sw="'+${jsLiteral(U)}+'"] .unread-mark')`, `${tag}: showing it cleared its New marker`);
    await stays(`(document.getElementById('afPos')||{}).textContent===${jsLiteral(`Attention: ${N} of ${N}`)}`, `${tag}: it keeps its place after it was read`);
    st = await strip();
    assert.ok(/Next in attention queue\. \d+ of \d+ \(\]\)$/.test(st.next), `${tag}: the button names the position and key: ${st.next}`);
    await H.key(']', [], { char: 'always' });
    await ok(`document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(queue[0]))}`, `${tag}: Next wraps to the first`);
    assert.strictEqual(await posText(), `Attention: 1 of ${N - 1}`, `${tag}: the read one left the queue once we moved on`);
    await H.key('[', [], { char: 'always' });
    await ok(`document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(queue[N - 2]))}`, `${tag}: Previous wraps to the last`);
    assert.strictEqual(await posText(), `Attention: ${N - 1} of ${N - 1}`, `${tag}: last position`);
    await shotTo(`052-auto-follow-queue-${tag}.png`);
    {
      const bad = await js(`(()=>{const b=['afPrev','afNext','afPause','afText','afPos'].map(i=>document.getElementById(i).getBoundingClientRect());const o=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)if(b[i].left<b[j].right-0.5&&b[j].left<b[i].right-0.5&&b[i].top<b[j].bottom-0.5&&b[j].top<b[i].bottom-0.5)o.push([i,j]);return {o,over:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}})()`);
      assert.deepStrictEqual(bad, { o: [], over: false }, `${tag}: strip parts do not overlap and the page does not overflow in a chat`);
    }
    await backToOffice();

    // ---- a question: the chat opens on its title; Enter and Space answer nothing
    const Q = await idByName('Rosa'), nameQ = await nameOf(Q);
    await sendQuiet(Q, 'hello question');
    await E(Q, { type: 'question', phase: 'asked', requestId: 'q-af', questions: [{ question: 'Which one?', multiSelect: false, options: [{ label: 'yes' }, { label: 'no' }] }] });
    await okArrival(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameQ)}`, `${tag}: a question opens the chat`, 15000);
    ac = await active();
    assert.ok(ac.id === 'panelTitle' && !ac.inBar, `${tag}: question: focus on the title: ${JSON.stringify(ac)}`);
    for (const k of ['Return', 'Space']) await H.key(k, [], { char: 'always' });
    await stays(`!!document.querySelector('#chat .q-opts')&&!document.querySelector('#chat .q-opts button[disabled]')`, `${tag}: Enter and Space on the title answered nothing`);
    await E(Q, { type: 'question', phase: 'cancelled', requestId: 'q-af', reason: 'stop' });
    await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: the Office button closes the chat`);
    console.log(`[follow] ${tag} on, send, arrivals, queue ok`);
  }

  // ---- the guards, the user's own choices and the pause (fresh page: Priya, Hugo and Maya are free again)
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} guards`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    wc.focus();
    await hooks();
    await setting(true);
    const S1 = A, S2 = B, S3 = C;

    /* The dialog, menu and typing steps make the arrival themselves (sendQuiet, then finish() once the guard is up), as the pointer and popover
       steps do. They used to send for real and race the simulator's scripted reply (Done about 3 s after the send) against the guard: on a slow
       runner the reply came first, its chat opened with nothing to hold, and the 25 s wait for "Held: ..." failed (issue #1343). */
    // a dialog holds the switch; closing it delivers
    await sendQuiet(S1, 'hello dialog');
    await H.key('k', MOD, { char: 'never' });
    await ok(`!!document.getElementById('palDlg')`, `${tag}: the palette (a dialog) is open`);
    await finish(S1);
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: a dialog is open')`, `${tag}: held by the dialog, and it says so`, 25000);
    await stays(`!document.body.classList.contains('panel-open')&&!!document.getElementById('palDlg')`, `${tag}: the dialog and the office stay: nothing was switched while it was open`);
    assert.ok((await strip()).text.includes('1 is waiting to open'), `${tag}: the arrival waits in the count`);
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}`, `${tag}: closing the dialog delivers it`, 8000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: focus on the title`);
    await backToOffice();

    // a menu holds it
    await sendQuiet(S1, 'hello menu');
    await mclick('#topMoreBtn');
    await ok(`document.getElementById('topMoreBtn').getAttribute('aria-expanded')==='true'`, `${tag}: the More menu is open`);
    await finish(S1);
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: a menu is open')`, `${tag}: held by the menu`, 25000);
    await stays(`!document.body.classList.contains('panel-open')`, `${tag}: nothing switched under the open menu`);
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}`, `${tag}: closing the menu delivers it`, 8000);
    await backToOffice();

    // typing in a field holds it (renaming a desk in place)
    await sendQuiet(S1, 'hello typing');
    await ok(`!document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.dataset.id===${jsLiteral(S1)}`, `${tag}: office, desk focused`);
    await H.key('F2');
    await ok(`document.activeElement&&document.activeElement.tagName==='INPUT'`, `${tag}: the rename field is open`);
    await type('zz');
    await finish(S1);
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: you are typing')`, `${tag}: held while typing`, 25000);
    /* longer than the 2 s a typed key holds it (FR-185), so the field having the focus is what holds it at the end */
    await stays(`!document.body.classList.contains('panel-open')&&String(document.activeElement.value).endsWith('zz')`, `${tag}: the field keeps its focus and text; no switch`, 2600);
    /* FR-185: out of the field, a key typed in the last 2 s still holds it: a lower bound, so a slow machine cannot fail it */
    await js(`(()=>{window.__keyAt=0;window.__openAt=0;document.addEventListener('keydown',e=>{if(e.key==='q')window.__keyAt=Date.now();},true);clearInterval(window.__op);window.__op=setInterval(()=>{if(!window.__openAt&&document.body.classList.contains('panel-open'))window.__openAt=Date.now();},20);})();0`);
    await type('q');
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')&&window.__openAt>0`, `${tag}: leaving the field delivers it`, 10000);
    { const gap = await js(`clearInterval(window.__op);window.__openAt-window.__keyAt`); assert.ok(gap >= 1900, `${tag}: the last key held it for 2 s, then it came: ${gap} ms`); }
    await backToOffice();

    // the user opened another agent by hand: the following has ended (FR-185), so its chat, typed in and scrolled up, is never switched away from
    await send(S1, 'hello other');
    await ok(`!document.querySelector('.af-notice')&&!document.body.classList.contains('panel-open')`, `${tag}: the notice, then the office (FR-238)`, 8000);
    await openChat(S2);
    await js(`(()=>{const c=document.getElementById('chat');const f=document.createElement('div');f.id='afFill';f.style.height='3000px';f.style.flex='none';c.appendChild(f);c.scrollTop=c.scrollHeight;})()`);
    await js(`document.getElementById('chat').scrollTop=0`); // fixture: scrolled to the top (the page's own scroll handler marks it as being read)
    await ok(`document.getElementById('chat').dataset.pin==='0'`, `${tag}: the chat is scrolled up: ` + await js(`(()=>{const c=document.getElementById('chat');return [c.scrollHeight,c.clientHeight,c.scrollTop,c.dataset.pin,getComputedStyle(c).overflowY,!!document.getElementById('afFill')].join(' ')})()`));
    await mclick('#msgInput'); await type('my draft');
    const top0 = await js(`document.getElementById('chat').scrollTop`);
    await settled(S1);
    await ok(`!!document.querySelector(${jsLiteral('.sitem[data-sw="' + S1 + '"] .unread-mark')})`, `${tag}: ${S1} finished and is marked New in the strip`, 25000);
    await stays(`(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(await nameOf(S2))}`, `${tag}: still in the chat the user chose`);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'my draft', `${tag}: the draft is untouched`);
    assert.strictEqual((await active()).id, 'msgInput', `${tag}: the focus stays in the message box`);
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), top0, `${tag}: the chat stays where it was scrolled`);
    assert.strictEqual(await followed(), '', `${tag}: ${S1} is no longer followed: you chose another agent`);
    await js(`document.getElementById('msgInput').value='';document.getElementById('afFill').remove()`);
    await backToOffice();

    // FR-185, FR-190: a window in the background, then a hidden one: held, the New marker kept; delivered on return, and only then read
    for (const [what, off, on, words] of [
      ['in the background', `window.__durbarFocus=()=>false;0`, `window.__durbarFocus=()=>true;window.dispatchEvent(new Event('focus'));0`, 'Held: the window is in the background'],
      ['hidden', `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'));0`, `delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));0`, 'Held: the window is hidden'],
    ]) {
      await send(S1, 'hello ' + what);
      await ok(`!document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.dataset.id===${jsLiteral(S1)}`, `${tag}: office, desk focused`);
      await js(off);
      await ok(`(document.getElementById('afText').textContent||'').startsWith(${jsLiteral(words)})`, `${tag}: ${what}: held, and it says so`, 25000);
      assert.ok(!(await panelOpen()), `${tag}: ${what}: nothing switched`);
      await ok(`!!document.querySelector(${jsLiteral(sel(S1) + ' .unread-mark')})`, `${tag}: ${what}: the reply is still New`);
      await js(on);
      await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}`, `${tag}: ${what}: delivered on return`, 8000);
      assert.strictEqual((await active()).id, 'panelTitle', `${tag}: ${what}: focus on the title`);
      await settled(S1); await backToOffice();
      await ok(`!document.querySelector(${jsLiteral(sel(S1) + ' .unread-mark')})`, `${tag}: ${what}: shown now, so read`);
    }

    // FR-184: the chat already shown moves nothing, scrolled up or not: an agent's own chat is not "another chat"
    await send(S1, 'hello shown');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back in the office`);
    await openChat(S1);
    await ok(`document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}&&${jsLiteral(S1)}===(document.querySelector('.is-followed')||{dataset:{}}).dataset.id`, `${tag}: its own chat, still followed`);
    await js(`(()=>{const c=document.getElementById('chat');const f=document.createElement('div');f.id='afFill';f.style.height='3000px';f.style.flex='none';c.appendChild(f);c.scrollTop=0;window.__ann=[];})();0`);
    await ok(`document.getElementById('chat').dataset.pin==='0'`, `${tag}: scrolled up`);
    /* out of the message box with a click on the chat log, not on the title: a click on the title more than 400 ms after the chat opened starts
       a rename (FR-020 item 1), whose field then holds the arrival as typing for good (issue #1343: seen under load, where the click came late) */
    await mclick('#chat');
    await ok(`document.activeElement&&document.activeElement.id!=='msgInput'&&!document.activeElement.closest('input,textarea,[contenteditable="true"]')`, `${tag}: out of the message box, in no field`);
    await ok(`!document.querySelector('.is-followed')`, `${tag}: its arrival was handled: no longer followed, nothing held`, 25000);
    assert.ok(!(await anns()).some((t) => /Its chat is open/.test(t)), `${tag}: already shown: no switch and nothing said: ${JSON.stringify(await anns())}`);
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), 0, `${tag}: the chat stays where it was scrolled`);
    await js(`document.getElementById('afFill').remove();0`);
    await settled(S1); await backToOffice();

    // FR-183: a failed send follows nothing and stays in the chat
    await openChat(S2);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;b.send=async()=>({ok:false,error:'refused'});})();0`);
    await mclick('#msgInput'); await type('hello refused'); await H.key('Return');
    await ok(`[...document.querySelectorAll('.toast,#toasts *')].some(n=>/refused/.test(n.textContent))||!!document.querySelector('#chat .err,#chat .msg.failed')||document.getElementById('msgInput').value===''`, `${tag}: the send was answered`);
    await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.is-followed')`, `${tag}: a failed send leaves the chat open and follows nothing`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.send=b.__send;const m=document.getElementById('msgInput');m.value='';})();0`);
    await backToOffice();

    // FR-185: a button held down holds the arrival; 600 ms after the release it comes (a lower bound: a slow machine cannot fail it)
    {
      await sendQuiet(S1, 'hello pointer');
      const p = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.right-6),y:Math.round(b.bottom-6)};})()`);
      wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await E(S1, { type: 'status', status: 'error', intent: 'Stopped.' });
      await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: you are clicking')`, `${tag}: a button down holds it, and it says so`);
      await js(`(()=>{window.__upAt=0;window.__openAt=0;document.addEventListener('pointerup',()=>{window.__upAt=Date.now();},{capture:true,once:true});clearInterval(window.__op);window.__op=setInterval(()=>{if(!window.__openAt&&document.body.classList.contains('panel-open'))window.__openAt=Date.now();},20);})();0`);
      wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await ok(`document.body.classList.contains('panel-open')&&window.__openAt>0&&window.__upAt>0`, `${tag}: after the release it comes`);
      const gap = await js(`clearInterval(window.__op);window.__openAt-window.__upAt`);
      assert.ok(gap >= 550, `${tag}: not before the 600 ms: ${gap} ms`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
    }

    // FR-185: any popover of the app's one list holds it (fixture: a `.pop`, as the grants popover is); a toast does not
    {
      await sendQuiet(S1, 'hello popover');
      await js(`(()=>{const p=document.createElement('div');p.className='pop';p.id='afPop';p.textContent='x';document.body.appendChild(p);const t=document.createElement('div');t.className='toast';t.id='afToast';t.textContent='y';t.style.setProperty('display','block','important');const w=document.getElementById('toasts');w.style.setProperty('display','flex','important');w.appendChild(t);})();0`); /* H.calm hides the toasts */
      await E(S1, { type: 'status', status: 'error', intent: 'Stopped.' });
      await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: a menu is open')`, `${tag}: a popover holds it, and it says so`);
      await js(`document.getElementById('afPop').remove();0`);
      await ok(OPEN, `${tag}: the popover closed; a toast alone does not hold it`);
      assert.ok(await js(`document.getElementById('afToast').getClientRects().length>0`), `${tag}: the toast was on screen`);
      await js(`document.getElementById('afToast').remove();document.getElementById('toasts').style.removeProperty('display');0`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
    }

    // FR-184: a click that lands on Allow in the moment the chat opens answers nothing; the same click later does
    {
      assert.strictEqual(await js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(S2)},'ask',{}).then(r=>r.ok)`), true, `${tag}: Ask first`);
      await sendQuiet(S2, 'hello allow');
      await js(`(()=>{window.__hit=0;const o=new MutationObserver(()=>{const b=[...document.querySelectorAll('#chat .note.perm:not(.settled) .note-actions button')][0];if(b&&document.body.classList.contains('panel-open')){o.disconnect();window.__hit=1;b.click();}});o.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});})();0`);
      await E(S2, { type: 'status', status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'p-af', kind: 'shell', summary: 'run a thing', state: 'pending' } });
      await ok(`window.__hit===1`, `${tag}: the click came as the chat opened`, 15000);
      await stays(`!!document.querySelector('#chat .note.perm:not(.settled)')`, `${tag}: it answered nothing: the request is still open`);
      await js(`[...document.querySelectorAll('#chat .note.perm:not(.settled) .note-actions button')].find(x=>/deny/i.test(x.textContent)).click();0`);
      await ok(`!document.querySelector('#chat .note.perm:not(.settled)')`, `${tag}: the same kind of click later answers`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
    }

    // FR-183: a chat opened while the send was on its way stays, and nothing is followed
    {
      await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;b.send=async()=>{await new Promise(r=>{window.__letGo=r;});return {ok:true};};})();0`);
      await send(S1, 'hello in flight');
      await ok(`typeof window.__letGo==='function'`, `${tag}: the send is on its way`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
      await openChat(S3);
      await js(`(()=>{window.__letGo();window.__letGo=null;const b=window.__durbarSimUi.bridge();b.send=b.__send;})();0`);
      await stays(`(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(await nameOf(S3))}&&!document.querySelector('.is-followed')`, `${tag}: the chat you opened stays and nothing is followed`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
    }

    // FR-183: answered, but no turn started: nothing is followed, and the chat that says why stays
    {
      await openChat(S1);
      await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;b.send=async(id)=>{window.__durbarSimEmit({timestamp:Date.now(),sessionId:id,type:'status',status:'idle',intent:'Not sent'});return {ok:true};};})();0`);
      await mclick('#msgInput'); await type('hello not sent'); await H.key('Return');
      await ok(`['idle','done'].includes(((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(S1)}))||{}).state)`, `${tag}: no turn is running`);
      await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.is-followed')`, `${tag}: no turn started: the chat stays, nothing is followed`);
      await js(`(()=>{const b=window.__durbarSimUi.bridge();b.send=b.__send;})();0`);
      await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back`);
    }

    // FR-188: a hidden folder: no automatic chat, it says so, and Previous still reaches it (your own action)
    {
      const room = await js(`document.querySelector(${jsLiteral(sel(S2))}).closest('[data-room]').dataset.room`);
      await send(S2, 'hello hidden');
      await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back in the office`);
      await js(`__durbarSimUi.hideRoom(${jsLiteral(room)});0`);
      await ok(`/is working in a hidden folder/.test(document.getElementById('afText').textContent)`, `${tag}: the strip says it is in a hidden folder`);
      await settled(S2);
      await ok(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(S2)}))||{}).state!=='working'`, `${tag}: it finished`);
      const passes0 = await js(`window.__durbarSimUi.afPasses()`);
      await ok(`window.__durbarSimUi.afPasses()>=${jsLiteral(Number(passes0) + 2)}`, `${tag}: two delivery passes ran after it finished (the witness)`, 4000);
      await stays(`!document.body.classList.contains('panel-open')`, `${tag}: a hidden folder opens nothing by itself`, 300); /* the passes above are the proof it was looked at; this holds while they run */
      await H.key('[', [], { char: 'always' });
      await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S2))}`, `${tag}: Previous reaches it`);
      await backToOffice();
    }

    // pause: nothing follows, nothing moves; resume
    await mclick('#afPause');
    await ok(`document.getElementById('afPause').textContent==='Resume'`, `${tag}: paused`);
    assert.strictEqual((await strip()).text, 'Auto-follow is paused. Nothing moves by itself.', `${tag}: paused words`);
    await send(S3, 'hello paused');
    await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.is-followed')`, `${tag}: paused: a send leaves the chat open and follows nothing`);
    await settled(S3);
    await stays(`(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(await nameOf(S3))}`, `${tag}: paused: nothing moved`);
    await shotTo(`052-auto-follow-paused-${w}x${h}.png`);
    await backToOffice();
    await mclick('#afPause');
    await ok(`document.getElementById('afPause').textContent==='Pause'`, `${tag}: resumed`);
    console.log(`[follow] ${tag} ok`);
  }

  // ---- the empty queue: two agents, none needs you
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} empty queue`;
    await H.load({ w, h, query: { sim: '2' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=2` }); /* the default (15 desks) never holds with 2 agents: the load waited its whole 15 s (spec 008 FR-190) */
    await H.calm({ blur: true });
    wc.focus();
    await hooks();
    await setting(true);
    assert.strictEqual(await posText(), 'Attention: Nothing needs you', `${tag}: the queue starts empty`);
    await openChat('sim-1');
    await mclick('#chat'); // out of the message box: the keys never act inside a text field
    await H.key(']', [], { char: 'always' });
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: ] goes back to the office`);
    assert.strictEqual((await active()).desk, 'sim-1', `${tag}: with the last desk focused: ${JSON.stringify(await active())}`);
    await ok(`window.__ann.includes('Nothing needs you. Back to the office.')`, `${tag}: said so: ` + JSON.stringify(await anns()));
    await H.key('[', [], { char: 'always' });
    await stays(`!document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.dataset.id==='sim-1'`, `${tag}: again in the office: nothing moves, the desk keeps the focus`);
    console.log(`[follow] ${tag} ok`);
  }


  // ---- Send to several (FR-183): one move and one announcement for the whole send; a chat opened by hand while it goes on stays
  {
    const tag = '1440x900 several';
    await H.load({ w: 1440, h: 900 });
    await H.calm({ blur: true });
    wc.focus();
    await hooks();
    await setting(true);
    const nA = await nameOf(A), nB = await nameOf(B);
    const sendSeveral = async (text, names) => {
      await mclick('#topMoreBtn');
      await ok(`!!document.getElementById('sendSeveralBtn')&&!document.getElementById('sendSeveralBtn').hidden`, `${tag}: the menu offers it`);
      await mclick('#sendSeveralBtn');
      await ok(`!!document.getElementById('mdP')`, `${tag}: the dialog is there`);
      const n = await js(`(()=>{const t=document.getElementById('mdIn');t.value=${jsLiteral(text)};t.dispatchEvent(new Event('input',{bubbles:true}));
        for(const l of document.querySelectorAll('#mdP .dpick')){const cb=l.querySelector('input');if(${jsLiteral(names)}.includes(l.querySelector('.dpick-t').textContent.split(' \u00b7 ')[0])&&!cb.disabled){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}}
        return document.querySelectorAll('#mdP input:checked').length})()`);
      assert.strictEqual(n, 2, `${tag}: the two sessions are picked`);
      await ok(`document.querySelector('#modeDlg .btn.primary').textContent==='Send to 2 sessions'&&!document.querySelector('#modeDlg .btn.primary').disabled`, `${tag}: Send is ready`);
      await mclick('#modeDlg .btn.primary');
    };
    // two followed sessions: one announcement for both, and the desk of the last is marked
    await js(`window.__ann=[]`);
    /* each send takes 200 ms, so a sentence said per session would land on its own (the announcer keeps only the last one inside 60 ms) */
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;b.send=async(...a)=>{await new Promise(r=>setTimeout(r,200));return b.__send(...a);};})();0`);
    await sendSeveral('hello several', [nA, nB]);
    await ok(`[...document.querySelectorAll('.toast')].some(t=>/Sent to 2 sessions/.test(t.textContent))`, `${tag}: sent`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.send=b.__send;})();0`);
    await ok(`window.__ann.some(t=>/2 followed agents are working\. Back to the office\./.test(t))`, `${tag}: one sentence for the two: ` + JSON.stringify(await anns()));
    await settled(A); await settled(B);
    assert.strictEqual((await anns()).filter((t) => /Back to the office/.test(t)).length, 1, `${tag}: exactly one "Back to the office" for the whole send: ` + JSON.stringify(await anns()));
    // a chat opened by hand while the sends are on their way stays open (the setting off and on forgets the followed ones, and a chat an arrival opened is closed)
    /* an arrival of the two opens a chat after its notice (FR-238): wait for it, so Settings is not clicked under the notice (no assert: only the order matters here) */
    await until(`!document.querySelector('.af-notice')&&document.body.classList.contains('panel-open')`, 6000);
    await ok(`!document.querySelector('.af-notice')`, `${tag}: no notice is up`);
    if (await panelOpen()) await backToOffice();
    await setting(false); await setting(true);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.__send=b.send;window.__gate=new Promise(r=>{window.__openGate=r;});b.send=async()=>{await window.__gate;return {ok:true};};})();0`);
    await js(`window.__ann=[]`);
    await sendSeveral('hello again', [nA, nB]);
    await openChat(C);
    await ok(`document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(C))}`, `${tag}: Maya's chat is open by hand`);
    await js(`window.__openGate();0`);
    await ok(`[...document.querySelectorAll('.toast')].some(t=>/Sent to 2 sessions/.test(t.textContent))`, `${tag}: the held sends finished`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.send=b.__send;})();0`);
    await stays(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(C))}`, `${tag}: the chat opened by hand stays`, 600);
    assert.strictEqual((await anns()).filter((t) => /Back to the office/.test(t)).length, 0, `${tag}: and nothing says Back to the office: ` + JSON.stringify(await anns()));
    console.log(`[follow] ${tag} ok`);
  }

  // ---- floors (spec 092): the follow shows the right floor and announces once
  {
    const tag = '1440x900 floors';
    await H.load({ w: 1440, h: 900, query: { simfloors: '1' }, ready: 'fit' });
    await H.calm({ blur: true });
    wc.focus();
    await hooks();
    await setting(true);
    let home = null, other = null;
    await H.eachFloor(async (f) => { if (await js(`!!document.querySelector(${jsLiteral(sel(A))})`)) home = f; else if (!other) other = f; });
    assert.ok(home && other, `${tag}: ${A} is on one floor and another floor exists: ${JSON.stringify([home, other])}`);
    await H.goToFloor(other.id);
    await ok(`localStorage.getItem('durbar.floor')===${jsLiteral(other.id)}`, `${tag}: on the other floor`);
    await H.key('k', MOD, { char: 'never' });
    await ok(`!!document.getElementById('palDlg')`, `${tag}: the palette opens`);
    await type(await nameOf(A));
    await ok(`[...document.querySelectorAll('#palDlg [role="option"],#palDlg .pal-row')].some(n=>n.textContent.includes(${jsLiteral(await nameOf(A))}))`, `${tag}: the palette lists it`);
    await H.key('Return');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(A))}`, `${tag}: the chat opens`);
    await js(`window.__ann=[]`);
    await mclick('#msgInput'); await type('hello floor'); await H.key('Return');
    await ok(`!document.body.classList.contains('panel-open')&&localStorage.getItem('durbar.floor')===${jsLiteral(home.id)}`, `${tag}: back in the office on ${home.name}`, 15000);
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '.is-followed')})`, `${tag}: the desk is drawn and marked`);
    await ok(`window.__ann.some(t=>/Back to the office/.test(t))`, `${tag}: it is said`);
    const said = await anns();
    assert.deepStrictEqual(said.filter((t) => /Back to the office/.test(t)).length, 1, `${tag}: one announcement: ${JSON.stringify(said)}`);
    assert.ok(said.some((t) => t.includes(' on ' + home.name + '. Back to the office.')), `${tag}: it names the floor: ${JSON.stringify(said)}`);
    assert.ok(!said.some((t) => /^Floor /.test(t)), `${tag}: no second, separate floor announcement: ${JSON.stringify(said)}`);
    console.log(`[follow] ${tag} ok`);
  }

  // ---- pre-review: an automatic send follows nothing; the keys wait behind Settings; the Real office has the marker and the focus too
  const EXTRA = [
    ['a coffee break resuming by itself', async () => {
      await H.load({ w: 1440, h: 900, query: { simbreak: '12' } });
      const tomas = await idByName('Tomas');
      await setting(true);
      await openChat(A);
      await ok(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(tomas)})||{}).coffee===true`, 'Tomas is on a break', 12000);
      await ok(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(tomas)})||{}).coffee===false`, 'Tomas resumed by itself', 20000);
      await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.is-followed')`, 'FR-183: the chat being read stays open when another agent resumes by itself, and an automatic send follows nothing');
    }],
    ['the keys behind Settings', async () => {
      await H.load({ w: 1440, h: 900 });
      await setting(true);
      await mclick('#settingsBtn');
      await ok(`!!document.getElementById('followSw')`, 'Settings is open');
      await H.key(']', [], { char: 'always' });
      await stays(`!document.body.classList.contains('panel-open')`, 'FR-186: ] does not open a chat behind Settings');
      await H.key('Escape');
    }],
    ['the Real office', async () => {
      const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
      await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: REAL }); /* the Real office has plates, not desks: the default ready never held (spec 008 FR-190) */
      await ok(REAL, 'the Real office');
      await setting(true);
      await ok(REAL, 'the Real office after Settings');
      const plate = `#stage .ro-plate[data-id="${A}"]`;
      await mclick(plate);
      await ok(`document.body.classList.contains('panel-open')`, 'its chat opens');
      await mclick('#msgInput'); await type('hello real'); await H.key('Return');
      await ok(`!document.body.classList.contains('panel-open')`, 'back to the office');
      await ok(`!!document.activeElement&&document.activeElement.dataset.id===${jsLiteral(A)}&&document.activeElement.classList.contains('ro-plate')`, 'FR-183: the focus on its plate');
      await stays(`!document.getElementById('roZoom')`, 'FR-183: a keyboard send moves the focus, and opens no screen zoom'); /* the zoom by focus opens at once, the one by hover in 120 ms */
      await ok(`!!document.querySelector(${jsLiteral(plate)}+'.is-followed')`, 'FR-183: its plate is marked');
      { /* the pointer moving on a screen still opens its zoom: only the still pointer was quiet */
        const r = await js(`(()=>{const b=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(A)})+'"]').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/3)};})()`);
        for (const dx of [-4, 0]) wc.sendInputEvent({ type: 'mouseMove', x: r.x + dx, y: r.y }); /* two points: a still pointer's event does not clear the quiet */
        await ok(`(document.getElementById('roZoom')||{dataset:{}}).dataset.for===${jsLiteral(A)}`, 'a moved pointer opens the zoom');
        wc.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
        await ok(`!document.getElementById('roZoom')`, 'it closes when the pointer leaves');
      }
      await js(`document.activeElement.blur();0`); /* a focused plate shows the focus ring instead */
      await ok(`getComputedStyle(document.querySelector(${jsLiteral(plate)})).outlineStyle==='dashed'`, 'not colour alone');
      await E(B, { type: 'status', status: 'working', intent: 'Another' }); /* a redraw must not take the mark away */
      await until(`document.querySelector(${jsLiteral(`#stage .ro-plate[data-id="${B}"]`)})&&document.querySelector(${jsLiteral(`#stage .ro-plate[data-id="${B}"]`)}).classList.contains('st-working')`, 4000);
      await ok(`!!document.querySelector(${jsLiteral(plate)}+'.is-followed')`, 'the mark survives a redraw');
      await js(`window.__durbarSimUi.setOfficeView&&window.__durbarSimUi.setOfficeView('flat');0`);
    }],
  ];
  for (const [what, run] of EXTRA) { console.log('[follow]', what); await run(); }

  // ---- reduced motion: the marker and the strip add no animation or transition
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await H.load({ w: 1440, h: 900 });
      assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'reduced motion is on');
      await setting(true);
      await sendQuiet(A, 'hello reduced');
      await ok(`!!document.querySelector(${jsLiteral(sel(A) + '.is-followed')})`, 'reduced motion: still followed');
      const m = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id=${jsLiteral(B)}]');const f=document.querySelector('#stage .desk.is-followed')||document.querySelector('#stage .desk[data-id=${jsLiteral(A)}]');const s=document.getElementById('followStrip');const a=getComputedStyle(f),b=getComputedStyle(d);return {anim:a.animationName,sameTr:a.transitionProperty===b.transitionProperty&&a.transitionDuration===b.transitionDuration,strip:getComputedStyle(s).animationName,stripTr:getComputedStyle(s).transitionDuration}})()`);
      assert.deepStrictEqual(m, { anim: 'none', sameTr: true, strip: 'none', stripTr: '0s' }, 'reduced motion: the marker adds no animation or transition: ' + JSON.stringify(m));
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  }
  } finally { await H.releaseFocus(); }
  console.log('[follow] all checks passed');
};
