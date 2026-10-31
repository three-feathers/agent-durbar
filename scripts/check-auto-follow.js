/*
 * Spec 052 FR-182..FR-190 (issue #686): opt-in Auto-follow and the attention queue. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-auto-follow
 *   OUT=<folder>  (optional) saves the pictures (052-auto-follow-{1440x900,1280x800}.png and the steps)
 *
 * At 1440x900 and 1280x800 (15 agents): off by default (no strip, `[` / `]` do nothing, a send leaves the chat open); Settings' switch turns it on
 * (a real click); a send returns to the office with the desk marked and the focus on it; a completion, a permission request, an error and a limit open
 * the chat with the focus on its title (never an answer button; Enter there approves nothing); a dialog, a menu and a field being typed in each hold the
 * switch until they clear; typing in another chat's composer and a chat scrolled up are never switched away from; Previous and Next by pointer and by
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
  const wc = ctx.win.webContents;
  const MOD = process.platform === 'darwin' ? ['meta'] : ['control'];
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const sel = (id) => `#stage .desk[data-id="${id}"]`;
  const E = (id, ev) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},${jsLiteral(ev)}))`);
  const finish = async (id, text) => { await E(id, { type: 'status', status: 'working', intent: 'Working' }); await E(id, { type: 'output', final: true, text: text || 'All done.' }); await E(id, { type: 'status', status: 'idle' }); };
  const mclick = async (selector) => {
    const r = await js(`(()=>{const e=document.querySelector(${jsLiteral(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    assert.ok(r, `${selector} is there to click`);
    for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await ctx.sleep(120);
  };
  const type = async (s) => { for (const ch of s) await H.key(ch === ' ' ? 'Space' : ch, [], { char: 'always', pause: 15 }); };
  const panelOpen = () => js(`document.body.classList.contains('panel-open')`);
  const title = () => js(`(document.getElementById('panelTitle')||{}).textContent||''`);
  const active = () => js(`(()=>{const a=document.activeElement;return {id:a&&a.id||'',cls:a&&a.className&&String(a.className)||'',tag:a?a.tagName:'',inBar:!!(a&&a.closest&&a.closest('.answer-bar,.note-actions,.q-opts')),desk:a&&a.dataset&&a.dataset.id||''}})()`);
  const stateOf = (id) => js(`(()=>{const d=document.querySelector(${jsLiteral(sel(id))});return d?d.dataset.state:null})()`);
  const strip = () => js(`(()=>{const s=document.getElementById('followStrip');if(!s)return null;const r=s.getBoundingClientRect();return {hidden:s.hidden,h:r.height,text:(document.getElementById('afText')||{}).textContent||'',pos:(document.getElementById('afPos')||{}).textContent||'',pause:(document.getElementById('afPause')||{}).textContent||'',prev:(document.getElementById('afPrev')&&document.getElementById('afPrev').getAttribute('aria-label'))||'',next:(document.getElementById('afNext')&&document.getElementById('afNext').getAttribute('aria-label'))||''}})()`);
  const followed = () => js(`[...document.querySelectorAll('.is-followed')].map(n=>n.dataset.id).sort().join(',')`);
  const marks = () => js(`[...document.querySelectorAll('#stage .unread-mark')].map(m=>m.closest('[data-id]').dataset.id).sort().join(',')`);
  const openChat = async (id) => { const hit = await js(`(()=>{const d=document.querySelector(${jsLiteral(sel(id))});if(!d)return '';const n=d.querySelector('.name');if(!n)return 'desk';const r=n.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e&&d.contains(e)?'name':'desk'})()`); await mclick(hit === 'name' ? sel(id) + ' .name' : sel(id)); await ok(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, 'the chat of ' + id + ' opens'); };
  const backToOffice = async () => { await H.key('Escape'); await ok(`!document.body.classList.contains('panel-open')`, 'the chat closes'); };
  const send = async (id, text) => { await openChat(id); await mclick('#msgInput'); await type(text); await H.key('Return'); };
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
  const sampler = () => js(`(()=>{window.__s=[];clearInterval(window.__si);window.__si=setInterval(()=>{const a=document.activeElement,d=document.querySelector('#stage .desk.is-followed'),cs=d?getComputedStyle(d):null;window.__s.push({panel:document.body.classList.contains('panel-open'),f:[...document.querySelectorAll('.is-followed')].map(n=>n.dataset.id).join(','),act:(a&&a.dataset&&a.dataset.id)||(a&&a.id)||'',ol:cs?cs.outlineStyle+' '+cs.outlineWidth:'',tx:(document.getElementById('afText')||{}).textContent||''});},30);})()`);
  const samples = () => js(`window.__s.slice()`);
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
    await ctx.sleep(400);
    assert.ok(await panelOpen(), `${tag}: off: a send leaves the chat open`);
    assert.strictEqual(await followed(), '', `${tag}: off: nothing is marked`);
    const t0 = await title();
    await H.key(']', [], { char: 'always' }); await ctx.sleep(150);
    assert.strictEqual(await title(), t0, `${tag}: off: ] does not move to another chat`);
    await settled(A); await ctx.sleep(300);
    assert.ok(await panelOpen(), `${tag}: off: the chat stayed open when the reply came`);
    await backToOffice();
    assert.strictEqual(await js(`document.getElementById('followSw')`), null, 'no switch outside Settings');

    // ---- on: the switch is a real click, the answer comes from main (the simulator's stand-in refuses a non-boolean like main)
    assert.deepStrictEqual(await js(`window.__durbarSimUi.bridge().setAutoFollowWork('yes').then(r=>({ok:r.ok,v:r.autoFollowWork,e:typeof r.error}))`), { ok: false, v: false, e: 'string' }, `${tag}: a non-boolean is refused with ok:false`);
    await setting(true);
    let st = await strip();
    assert.ok(!st.hidden && st.h >= 28 && st.h <= 40, `${tag}: the strip shows, one row: ${st.h}px`);
    assert.strictEqual(st.text, 'Auto-follow on. It follows an agent after you send it a message.', `${tag}: idle words`);
    for (const f of await fonts(['afText', 'afPos', 'afPrev', 'afNext', 'afPause'])) assert.ok(f >= 10.5, `${tag}: strip text is at least 10.5px: ${f}`);
    {
      const probs = (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
      assert.deepStrictEqual(probs, [], `${tag}: the office with the strip: no overlap, no scroll, text >= 10.5px: ${JSON.stringify(probs)}`);
    }
    await shotTo(`052-auto-follow-idle-${tag}.png`);

    // ---- send -> office and desk -> completion opens the chat on its title
    await sampler();
    await send(A, 'hello follow');
    const nameA = await nameOf(A);
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}&&window.__s.some(x=>!x.panel&&x.f===${jsLiteral(A)})`, `${tag}: back to the office with ${nameA} followed, then its chat opens when it finishes`, 25000);
    let ss = await samples();
    const off = ss.find((x) => !x.panel && x.f === A);
    assert.ok(off, `${tag}: a moment in the office with the desk marked`);
    assert.strictEqual(off.act, A, `${tag}: the focus was on the followed desk: ${off.act}`);
    assert.strictEqual(off.ol, 'dashed 2px', `${tag}: the marker is a dashed 2px outline (not colour alone): ${off.ol}`);
    assert.ok(new RegExp(nameA + ' is working\\. Back to the office\\.').test(off.tx), `${tag}: honest status: ${off.tx}`);
    assert.ok(!/done|finished/i.test(off.tx), `${tag}: the status promises nothing`);
    let ac = await active();
    assert.strictEqual(ac.id, 'panelTitle', `${tag}: focus is on the chat title: ${JSON.stringify(ac)}`);
    assert.strictEqual(await followed(), '', `${tag}: no longer followed once shown`);
    assert.strictEqual((await anns()).filter((t) => t.includes('Back to the office')).length, 1, `${tag}: announced once`);
    await js(`clearInterval(window.__si)`);
    await shotTo(`052-auto-follow-chat-${tag}.png`);
    await settled(A); await backToOffice();
    await ok(`!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: the reply was shown, so it is not marked New`);

    // ---- a permission request: the chat opens, Enter on the title approves nothing
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(A)},'ask',{}).then(r=>r.ok)`), true, `${tag}: ${nameA} goes to Ask first`);
    await send(A, 'please edit the file');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}&&!!document.querySelector('#chat .note.perm:not(.settled)')`, `${tag}: ${nameA}'s permission request opens its chat`, 25000);
    ac = await active();
    assert.ok(ac.id === 'panelTitle' && !ac.inBar, `${tag}: focus on the title, not a button of the request: ${JSON.stringify(ac)}`);
    for (const k of ['Return', 'Space']) await H.key(k, [], { char: 'always' });
    await ctx.sleep(500);
    assert.ok(await js(`!!document.querySelector('#chat .note.perm:not(.settled)')`), `${tag}: Enter and Space on the title approved nothing: the request is still open`);
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A)}).state`), 'waiting', `${tag}: and the agent still waits`);
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .note.perm:not(.settled) .note-actions button')].find(x=>/deny/i.test(x.textContent));if(b)b.click();})()`); // the user's own answer, to free the agent
    await settled(A); await mclick('#backBtn'); await ok(`!document.body.classList.contains('panel-open')`, `${tag}: the Office button closes the chat`);

    // ---- an error and a limit
    await send(B, 'hello error');
    await ctx.sleep(300);
    await E(B, { type: 'status', status: 'error', intent: 'The agent app stopped with an error.' });
    const nameB = await nameOf(B);
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameB)}`, `${tag}: an error opens the chat`, 15000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: error: focus on the title`);
    await backToOffice();
    await send(C, 'hello limit');
    await ctx.sleep(300);
    await E(C, { type: 'limit', phase: 'exhausted', requestId: 'lim-af', maxAiCredits: 30, usedAiCredits: 30 });
    const nameC = await nameOf(C);
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameC)}`, `${tag}: a limit opens the chat`, 15000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: limit: focus on the title`);
    await backToOffice();

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
    await ctx.sleep(300);
    assert.strictEqual(await posText(), `Attention: ${N} of ${N}`, `${tag}: it keeps its place after it was read`);
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

    // a dialog holds the switch; closing it delivers
    await sampler();
    await send(S1, 'hello dialog');
    await H.key('k', MOD, { char: 'never' });
    await ok(`!!document.getElementById('palDlg')`, `${tag}: the palette (a dialog) is open`);
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: a dialog is open')`, `${tag}: held by the dialog, and it says so`, 25000);
    await settled(S1);
    await ctx.sleep(600);
    assert.ok(!(await panelOpen()) && await js(`!!document.getElementById('palDlg')`), `${tag}: the dialog and the office stay: nothing was switched while it was open`);
    assert.ok((await strip()).text.includes('1 is waiting to open'), `${tag}: the arrival waits in the count`);
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}`, `${tag}: closing the dialog delivers it`, 8000);
    assert.strictEqual((await active()).id, 'panelTitle', `${tag}: focus on the title`);
    await js(`clearInterval(window.__si)`);
    await backToOffice();

    // a menu holds it
    await send(S1, 'hello menu');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back in the office`);
    await mclick('#topMoreBtn');
    await ok(`document.getElementById('topMoreBtn').getAttribute('aria-expanded')==='true'`, `${tag}: the More menu is open`);
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: a menu is open')`, `${tag}: held by the menu`, 25000);
    await ctx.sleep(500);
    assert.ok(!(await panelOpen()), `${tag}: nothing switched under the open menu`);
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(await nameOf(S1))}`, `${tag}: closing the menu delivers it`, 8000);
    await settled(S1); await backToOffice();

    // typing in a field holds it (renaming a desk in place)
    await send(S1, 'hello typing');
    await ok(`!document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.dataset.id===${jsLiteral(S1)}`, `${tag}: office, desk focused`);
    await H.key('F2');
    await ok(`document.activeElement&&document.activeElement.tagName==='INPUT'`, `${tag}: the rename field is open`);
    await type('zz');
    await ok(`(document.getElementById('afText').textContent||'').startsWith('Held: you are typing')`, `${tag}: held while typing`, 25000);
    await ctx.sleep(500);
    assert.ok(!(await panelOpen()) && (await js(`document.activeElement.value`)).endsWith('zz'), `${tag}: the field keeps its focus and text; no switch`);
    await H.key('Escape');
    await ok(`document.body.classList.contains('panel-open')`, `${tag}: leaving the field delivers it`, 10000);
    await settled(S1); await backToOffice();

    // the user chose another agent: typing in its composer, and a chat scrolled up, are never switched away from
    await send(S1, 'hello other');
    await openChat(S2);
    await js(`(()=>{const c=document.getElementById('chat');const f=document.createElement('div');f.id='afFill';f.style.height='3000px';f.style.flex='none';c.appendChild(f);c.scrollTop=c.scrollHeight;})()`);
    await js(`document.getElementById('chat').scrollTop=0`); // fixture: scrolled to the top (the page's own scroll handler marks it as being read)
    await ok(`document.getElementById('chat').dataset.pin==='0'`, `${tag}: the chat is scrolled up: ` + await js(`(()=>{const c=document.getElementById('chat');return [c.scrollHeight,c.clientHeight,c.scrollTop,c.dataset.pin,getComputedStyle(c).overflowY,!!document.getElementById('afFill')].join(' ')})()`));
    await mclick('#msgInput'); await type('my draft');
    const top0 = await js(`document.getElementById('chat').scrollTop`);
    await settled(S1);
    await ok(`!!document.querySelector(${jsLiteral('.sitem[data-sw="' + S1 + '"] .unread-mark')})`, `${tag}: ${S1} finished and is marked New in the strip`, 25000);
    await ctx.sleep(600);
    assert.strictEqual(await title(), await nameOf(S2), `${tag}: still in the chat the user chose`);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'my draft', `${tag}: the draft is untouched`);
    assert.strictEqual((await active()).id, 'msgInput', `${tag}: the focus stays in the message box`);
    assert.strictEqual(await js(`document.getElementById('chat').scrollTop`), top0, `${tag}: the chat stays where it was scrolled`);
    assert.strictEqual(await followed(), '', `${tag}: ${S1} is no longer followed: you chose another agent`);
    await js(`document.getElementById('msgInput').value='';document.getElementById('afFill').remove()`);
    await backToOffice();

    // pause: nothing follows, nothing moves; resume
    await mclick('#afPause');
    await ok(`document.getElementById('afPause').textContent==='Resume'`, `${tag}: paused`);
    assert.strictEqual((await strip()).text, 'Auto-follow is paused. Nothing moves by itself.', `${tag}: paused words`);
    await send(S3, 'hello paused');
    await ctx.sleep(700);
    assert.ok(await panelOpen(), `${tag}: paused: a send leaves the chat open`);
    assert.strictEqual(await followed(), '', `${tag}: paused: nothing is followed`);
    await settled(S3); await ctx.sleep(300);
    assert.strictEqual(await title(), await nameOf(S3), `${tag}: paused: nothing moved`);
    await shotTo(`052-auto-follow-paused-${w}x${h}.png`);
    await backToOffice();
    await mclick('#afPause');
    await ok(`document.getElementById('afPause').textContent==='Pause'`, `${tag}: resumed`);
    console.log(`[follow] ${tag} ok`);
  }

  // ---- the empty queue: two agents, none needs you
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} empty queue`;
    await H.load({ w, h, query: { sim: '2' } });
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
    await H.key('[', [], { char: 'always' }); await ctx.sleep(150);
    assert.ok(!(await panelOpen()) && (await active()).desk === 'sim-1', `${tag}: again in the office: nothing moves, the desk keeps the focus`);
    console.log(`[follow] ${tag} ok`);
  }

  // ---- reduced motion: the marker and the strip add no animation or transition
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await H.load({ w: 1440, h: 900 });
      assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'reduced motion is on');
      await setting(true);
      await sampler();
      await send(A, 'hello reduced');
      await ok(`window.__s.some(x=>!x.panel&&x.f===${jsLiteral(A)})`, 'reduced motion: still followed', 15000);
      const m = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id=${jsLiteral(B)}]');const f=document.querySelector('#stage .desk.is-followed')||document.querySelector('#stage .desk[data-id=${jsLiteral(A)}]');const s=document.getElementById('followStrip');const a=getComputedStyle(f),b=getComputedStyle(d);return {anim:a.animationName,sameTr:a.transitionProperty===b.transitionProperty&&a.transitionDuration===b.transitionDuration,strip:getComputedStyle(s).animationName,stripTr:getComputedStyle(s).transitionDuration}})()`);
      assert.deepStrictEqual(m, { anim: 'none', sameTr: true, strip: 'none', stripTr: '0s' }, 'reduced motion: the marker adds no animation or transition: ' + JSON.stringify(m));
      await js(`clearInterval(window.__si)`);
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  }
  console.log('[follow] all checks passed');
};
