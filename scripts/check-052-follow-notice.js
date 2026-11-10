/*
 * Spec 052 FR-238..FR-241 (owner, 2026-11-09): the Auto-follow notice, a full-screen card with a 3 s countdown before each automatic move.
 * Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-052-follow-notice
 *   OUT=<folder>  (optional) saves the pictures: 052-follow-notice-{office,chat}-<world>-<w>x<h>.png
 *
 * In Open office at 1440x900 and 1280x800 (15 agents): a send shows the notice to the office (its words through the mask, the countdown 3, 2, 1,
 * Stay here focused, role dialog named Auto-follow, digits hidden from screen readers), said once at request priority (a status in the same 60 ms
 * window does not replace it), then moves after about 3 s; an arrival shows the notice to the chat (a completion: "finished", "See if it is OK";
 * a request: "needs you"); Stay here, Escape and Stay in the office cancel (the chat stays and the agent stays followed; the arrival is not
 * offered again and keeps its New marker); a chat already shown shows no notice; a window in the background pauses the count. Reduced motion
 * (media emulation) and the Motion setting off: no running animation, the number still counts. In Open office, the Photo office, the cave and
 * the arcade at both sizes (and Open office in the Retro Pixel theme): the notice covers the window, its card is inside it, nothing in it overlaps, text >= 10.5 px, no page scroll.
 * Every wait is until() and its result is asserted; keys and clicks are real input events.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  await H.focusPage({ emulate: 'first' }); /* as check-auto-follow (#1179): the background steps below use window.__durbarFocus, not the OS */
  try {
  const wc = ctx.win.webContents;
  /* CI run 42670456931 (Windows): the runner's OS asks for reduced motion, so "motion allowed" must be set, not assumed. Media emulation (the same
     on every OS) says no-preference for the whole driver; the reduced-motion step sets reduce and back. */
  const media = async (v) => { const d = wc.debugger; if (!d.isAttached()) d.attach('1.3'); await d.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] }); };
  await media('no-preference');
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const stays = async (expr, what, ms = 700) => assert.strictEqual(await js(`new Promise(res=>{const end=Date.now()+${Number(ms)},t=setInterval(()=>{if(!(${expr})){clearInterval(t);res(false);}else if(Date.now()>=end){clearInterval(t);res(true);}},25);})`), true, what);
  const E = (id, ev) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},${jsLiteral(ev)}))`);
  const finish = async (id, text) => { await E(id, { type: 'status', status: 'working', intent: 'Working' }); await E(id, { type: 'output', final: true, text: text || 'All done.' }); await E(id, { type: 'status', status: 'idle' }); };
  const clickAt = async (x, y) => {
    await js(`(()=>{if(!window.__upOn){window.__upOn=1;document.addEventListener('click',()=>{window.__ups++;},true);}window.__ups=0;})();0`);
    for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await until(`window.__ups>0`, 1500);
  };
  const mclick = async (selector) => {
    const r = await js(`(()=>{const e=document.querySelector(${jsLiteral(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    assert.ok(r, `${selector} is there to click`);
    await clickAt(r.x, r.y);
  };
  const type = async (s) => { for (const ch of s) await H.key(ch === ' ' ? 'Space' : ch, [], { char: 'always', pause: 15 }); };
  const OPEN = `document.body.classList.contains('panel-open')`;
  const NOTICE = `document.querySelector('.dlg-ov.af-notice')`;
  const nameOf = (id) => js(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}))||{}).name||''`);
  const title = () => js(`(document.getElementById('panelTitle')||{}).textContent||''`);
  const notice = () => js(`(()=>{const d=document.querySelector('.dlg-ov.af-notice');if(!d)return null;const b=d.querySelector('.dlg'),btn=b.querySelector('.dbtn .btn');return {to:d.classList.contains('afn-to-office')?'office':d.classList.contains('afn-to-chat')?'chat':'',
    head:b.querySelector('h3').textContent,sub:b.querySelector('.dsub').textContent,n:(b.querySelector('.afn-n')||{}).textContent||'',btn:btn?btn.textContent:'',btns:b.querySelectorAll('.dbtn .btn').length,
    focusBtn:document.activeElement===btn,role:b.getAttribute('role'),label:b.getAttribute('aria-label'),modal:b.getAttribute('aria-modal'),desc:b.getAttribute('aria-describedby'),
    hidden:(b.querySelector('.afn-count')||{getAttribute:()=>null}).getAttribute('aria-hidden'),art:(b.querySelector('.afn-art')||{getAttribute:()=>null}).getAttribute('aria-hidden')}})()`);
  /* every announcement, and what the live region ends on; `__racer` says a status within the notice's own 60 ms window (FR-240's priority) */
  const hooks = () => js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});
    window.__nseq=[];window.__nAt=0;window.__nGone=0;new MutationObserver(()=>{const d=document.querySelector('.dlg-ov.af-notice');if(d&&!d.__seen){d.__seen=1;window.__nAt=performance.now();window.__nGone=0;if(window.__racer)window.__durbarSimUi.announce('Racer status.');
      const n=d.querySelector('.afn-n');window.__nseq=[n.textContent];new MutationObserver(()=>{if(window.__nseq[window.__nseq.length-1]!==n.textContent)window.__nseq.push(n.textContent);}).observe(n,{childList:true,characterData:true,subtree:true});}
      if(!d&&window.__nAt&&!window.__nGone)window.__nGone=performance.now();}).observe(document.body,{childList:true});})()`);
  const anns = () => js(`window.__ann.slice()`);
  const sel = (id) => `#stage .desk[data-id="${id}"]`;
  const plate = (id) => `#stage .ro-plate[data-id="${id}"]`;
  /* as check-auto-follow (#1343): the office lays out again after the strip appears; a desk is clicked on its picture (the middle of a name can be the rename pencil) */
  const officeFits = `document.body.classList.contains('panel-open')||document.getElementById('stage').dataset.d==='real'||document.getElementById('stage').dataset.fit!=='ok'||document.getElementById('floor').scrollHeight<=document.getElementById('floor').clientHeight+1`;
  const openChatBy = async (selector, name) => {
    assert.ok(await until(officeFits, 10000), 'the office is laid out before ' + name + ' is clicked');
    const p = await js(`(()=>{const d=document.querySelector(${jsLiteral(selector)});if(!d)return null;d.scrollIntoView({block:'nearest'});const b=d.getBoundingClientRect(),real=d.classList.contains('ro-plate'),x=Math.round(real?b.left+b.width/2:b.left+Math.min(24,b.width/4)),y=Math.round(real?b.top+b.height/2:b.top+b.height*0.7),e=document.elementFromPoint(x,y);return {x,y,inside:!!e&&d.contains(e)};})()`);
    assert.ok(p && p.inside, name + ': the point on its desk is the desk');
    await clickAt(p.x, p.y);
    /* a Real office plate may take the first click as a hover zoom on a small layout: Enter on the focused plate opens it (both are a person's own opening) */
    if (!(await until(`document.body.classList.contains('panel-open')`, 1500)) && selector.includes('ro-plate')) { await js(`document.querySelector(${jsLiteral(selector)}).focus();0`); await H.key('Return'); }
    if (!(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(name)}`, 8000))) assert.fail(`the chat of ${name} opens (title: ${JSON.stringify(await title())})`);
  };
  /* accepted, with no scripted reply after it: the step's own events are the only arrival */
  const quiet = (on) => (on ? js(`(()=>{const b=window.__durbarSimUi.bridge();if(!b.__send){b.__send=b.send;b.send=async()=>({ok:true});}})();0`) : js(`(()=>{const b=window.__durbarSimUi.bridge();if(b.__send){b.send=b.__send;b.__send=null;}})();0`));
  const sendHere = async (text) => { await mclick('#msgInput'); await type(text); await H.key('Return'); };
  /* FR-241: the notice covers the window, its card is inside, its parts do not overlap, text >= 10.5 px, no page scroll */
  const fit = () => js(`(()=>{const P=[],d=document.querySelector('.dlg-ov.af-notice');if(!d)return ['no notice'];const W=innerWidth,Hh=innerHeight,o=d.getBoundingClientRect(),c=d.querySelector('.dlg').getBoundingClientRect();
    if(Math.round(o.left)!==0||Math.round(o.top)!==0||Math.round(o.width)!==W||Math.round(o.height)!==Hh)P.push('overlay is not the whole window: '+[o.left,o.top,o.width,o.height].map(Math.round));
    if(c.left<0||c.top<0||c.right>W||c.bottom>Hh)P.push('card outside the window: '+[c.left,c.top,c.right,c.bottom].map(Math.round));
    const parts=[...d.querySelectorAll('.afn-art,.dlg>h3,.dlg>.dsub,.afn-count,.dbtn .btn')].map(e=>({k:e.className.baseVal!==undefined?e.className.baseVal:(e.className||e.tagName),r:e.getBoundingClientRect()}));
    if(parts.length!==5)P.push('parts: '+parts.length);
    for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){const a=parts[i].r,b=parts[j].r;if(a.left+0.5<b.right&&b.left+0.5<a.right&&a.top+0.5<b.bottom&&b.top+0.5<a.bottom)P.push('overlap '+parts[i].k+' / '+parts[j].k);}
    for(const e of d.querySelectorAll('h3,.dsub,.afn-n,.btn')){const f=parseFloat(getComputedStyle(e).fontSize);if(f<10.5)P.push('text under 10.5px: '+e.className+' '+f);if(e.scrollWidth>e.clientWidth+1&&!e.matches('.afn-n'))P.push('text cut: '+e.textContent);}
    const se=document.scrollingElement;if(se.scrollHeight>se.clientHeight+1||se.scrollWidth>se.clientWidth+1)P.push('the page scrolls');
    const fl=document.getElementById('floor');if(fl&&fl.scrollTop>0)P.push('the office scrolled');
    return P;})()`);
  /* the animations running inside the notice */
  const running = () => js(`(()=>{const d=document.querySelector('.dlg-ov.af-notice');if(!d)return -1;return document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&a.effect.target&&d.contains(a.effect.target)).length;})()`);
  const shotTo = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', settle: false, delay: 250 });
  const bg = (on) => (on ? js(`window.__durbarFocus=()=>false;0`) : js(`window.__durbarFocus=null;0`));
  const A = 'sim-7', B = 'sim-13';

  // ======== Open office: the whole behaviour, both sizes ========
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    await hooks();
    assert.strictEqual(await js(`window.__durbarSimUi.afNotice.ms(3000)`), 3000, 'the default length');
    assert.strictEqual(await js(`window.__durbarSimUi.afNotice.on(true)`), true, `${tag}: Auto-follow on`);
    const nameA = await nameOf(A), nameB = await nameOf(B);

    // ---- to the office: words, countdown, focus, said once at request priority, then the move after about 3 s
    await openChatBy(sel(A), nameA);
    await quiet(true);
    await js(`window.__racer=1;window.__ann.length=0;0`);
    await sendHere('hello notice');
    await ok(NOTICE, `${tag}: FR-238: a send shows the notice`, 4000);
    let n = await notice();
    assert.strictEqual(n.to, 'office', `${tag}: the notice goes to the office`);
    assert.strictEqual(n.head, `${nameA} is working on this`, `${tag}: FR-238: the heading names the agent`);
    assert.strictEqual(n.sub, `Taking you to the office. Auto-follow brings you back when ${nameA} finishes or needs you.`, `${tag}: FR-238: the line says where and why`);
    assert.strictEqual(n.btn, 'Stay here', `${tag}: FR-239: the Stay here button`);
    assert.strictEqual(n.btns, 1, `${tag}: one button`);
    assert.ok(n.focusBtn, `${tag}: FR-239: the focus starts on Stay here`);
    assert.deepStrictEqual([n.role, n.label, n.modal, n.desc], ['dialog', 'Auto-follow', 'true', null], `${tag}: FR-240: a modal dialog named Auto-follow, no description read again`);
    assert.deepStrictEqual([n.hidden, n.art], ['true', 'true'], `${tag}: FR-240: the digits and the picture are hidden from screen readers`);
    assert.strictEqual(n.n, '3', `${tag}: FR-239: the countdown starts at 3`);
    assert.strictEqual(await js(OPEN), true, `${tag}: the chat is still open under the notice`);
    assert.deepStrictEqual(await fit(), [], `${tag}: FR-241: the notice to the office fits`);
    assert.strictEqual(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), false, `${tag}: motion is allowed in this step (emulated no-preference, whatever the runner's OS asks)`);
    if (w === 1440) assert.ok((await running()) >= 2, `${tag}: FR-241: the picture and the ring move with motion allowed`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&!document.body.classList.contains('panel-open')`, `${tag}: FR-239: the move happens when the count ends`, 6000);
    const took = await js(`window.__nGone-window.__nAt`);
    assert.ok(took >= 2700 && took <= 4500, `${tag}: FR-239: about 3 s: ${Math.round(took)} ms`);
    assert.deepStrictEqual(await js(`window.__nseq.slice()`), ['3', '2', '1'], `${tag}: FR-239: it counts 3, 2, 1`);
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '.is-followed')})&&document.activeElement&&document.activeElement.dataset.id===${jsLiteral(A)}`, `${tag}: FR-183 after the notice: the desk followed and focused`);
    await js(`window.__racer=0;0`);
    await ok(`window.__ann.includes(${jsLiteral(nameA + ' is working. Back to the office.')})`, `${tag}: the move's own line is said`, 2000);
    let said = await anns();
    const toOffice = `${nameA} is working on this. Taking you to the office in 3 seconds. Press Escape to stay here.`;
    assert.strictEqual(said.filter((t) => t === toOffice).length, 1, `${tag}: FR-240: the notice is said once: ${JSON.stringify(said)}`);
    assert.ok(!said.includes('Racer status.'), `${tag}: FR-240: a status in the same window did not replace it (request priority): ${JSON.stringify(said)}`);
    assert.ok(said.indexOf(`${nameA} is working. Back to the office.`) > said.indexOf(toOffice), `${tag}: the move's own line is still said after it: ${JSON.stringify(said)}`);
    assert.ok(!said.some((t) => /^[123]$/.test(t)), `${tag}: no digit is said`);

    // ---- to the chat at a completion: words, then the chat opens with the focus on its title, the arrival line said
    await js(`window.__racer=1;window.__ann.length=0;0`);
    await finish(A, 'All done.');
    await ok(NOTICE, `${tag}: FR-238: a completion shows the notice`, 15000);
    n = await notice();
    assert.deepStrictEqual([n.to, n.head, n.sub, n.btn, n.focusBtn, n.n], ['chat', `${nameA} finished`, 'See if it is OK. Opening its chat.', 'Stay in the office', true, '3'], `${tag}: FR-238, FR-239: the notice to the chat: ${JSON.stringify(n)}`);
    assert.strictEqual(await js(OPEN), false, `${tag}: nothing opened yet`);
    assert.deepStrictEqual(await fit(), [], `${tag}: FR-241: the notice to the chat fits`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}&&document.activeElement&&document.activeElement.id==='panelTitle'`, `${tag}: FR-239: after the count its chat opens, focus on the title`, 6000);
    await js(`window.__racer=0;0`);
    await ok(`window.__ann.includes(${jsLiteral(nameA + ' finished. Its chat is open.')})`, `${tag}: FR-240: the arrival line is said`, 2000);
    said = await anns();
    const toChat = `${nameA} finished. See if it is OK. Opening its chat in 3 seconds. Press Escape to stay in the office.`;
    assert.strictEqual(said.filter((t) => t === toChat).length, 1, `${tag}: FR-240: said once: ${JSON.stringify(said)}`);
    assert.ok(!said.includes('Racer status.'), `${tag}: FR-240: request priority: ${JSON.stringify(said)}`);
    assert.ok(said.indexOf(`${nameA} finished. Its chat is open.`) > said.indexOf(toChat), `${tag}: FR-240: the arrival line is not dropped: ${JSON.stringify(said)}`);

    // ---- Stay here: the chat stays, the agent stays followed, and its arrival (its chat shown) moves nothing
    await js(`window.__ann.length=0;0`);
    await sendHere('again');
    await ok(NOTICE, `${tag}: the notice again (every time)`, 4000);
    await ok(`window.__ann.some(t=>/Press Escape to stay here\\.$/.test(t))`, `${tag}: the notice was said (a cancel within its 60 ms window would be outranked by it)`, 2000);
    await mclick(`.dlg-ov.af-notice .dbtn .btn`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: Stay here closes the notice`, 2000);
    await stays(`document.body.classList.contains('panel-open')&&document.getElementById('panelTitle').textContent===${jsLiteral(nameA)}&&!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: Stay here: the chat stays open, past the count`, 3600);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'msgInput', `${tag}: FR-239: the focus goes back to the message box`);
    assert.ok((await js(`document.getElementById('afText').textContent`)).includes(`${nameA} is working`), `${tag}: FR-239: ${nameA} is still followed`);
    if (!(await until(`window.__ann.includes('Staying here.')`, 3000))) assert.fail(tag + ': FR-240: the cancel is said: ' + JSON.stringify(await anns()));
    await finish(A, 'Done again.');
    await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-184: an arrival in the chat already shown shows no notice and moves nothing`, 1500);

    // ---- Escape cancels the same way
    await sendHere('and again');
    await ok(NOTICE, `${tag}: the notice`, 4000);
    await H.key('Escape');
    await ok(`!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: Escape closes the notice`, 2000);
    await stays(`document.body.classList.contains('panel-open')&&!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: Escape: the chat stays open, past the count`, 3600);

    // ---- a window in the background pauses the count; it goes on when the window is back
    await finish(A, 'Done.');
    await sendHere('in the background');
    await ok(NOTICE, `${tag}: the notice`, 4000);
    await bg(true);
    await stays(`!!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')&&document.querySelector('.af-notice .afn-n').textContent==='3'`, `${tag}: FR-239: in the background the count waits at 3`, 3600);
    assert.strictEqual(await js(`document.querySelector('.dlg-ov.af-notice').classList.contains('afn-paused')`), true, `${tag}: and its motion pauses`);
    await bg(false);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&!document.body.classList.contains('panel-open')`, `${tag}: FR-239: back in front, the count goes on and moves`, 6000);

    // ---- Stay in the office: no chat, the New marker kept, not offered again
    await js(`window.__ann.length=0;0`);
    await finish(A, 'Finished in the office.');
    await ok(NOTICE, `${tag}: the notice to the chat`, 15000);
    await ok(`window.__ann.some(t=>/Press Escape to stay in the office\\.$/.test(t))`, `${tag}: the notice was said`, 2000);
    await mclick(`.dlg-ov.af-notice .dbtn .btn`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')`, `${tag}: Stay in the office closes it`, 2000);
    await stays(`!document.body.classList.contains('panel-open')&&!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: Stay in the office: no chat opens, and the arrival is not offered again`, 3600);
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: FR-239: its New marker stays`);
    await ok(`window.__ann.includes('Staying in the office.')`, `${tag}: FR-240: said`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id`), A, `${tag}: FR-239: the focus goes back to the desk`);

    // ---- a request: "needs you", then its chat with the focus on the title and nothing answered
    await quiet(false);
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(B)},'ask',{}).then(r=>r.ok)`), true, `${tag}: ${nameB} asks first`);
    await openChatBy(sel(B), nameB);
    await sendHere('please edit the file');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back to the office after the notice`, 8000);
    await ok(`!!document.querySelector('.dlg-ov.af-notice')&&document.querySelector('.dlg-ov.af-notice').querySelector('h3').textContent===${jsLiteral(nameB + ' needs you')}`, `${tag}: FR-238: a request: "${nameB} needs you"`, 20000);
    assert.strictEqual((await notice()).sub, 'Opening its chat.', `${tag}: no "see if it is OK" for a request`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.perm:not(.settled)')&&document.activeElement&&document.activeElement.id==='panelTitle'`, `${tag}: its chat opens, the request still open, the focus on the title`, 6000);
    await ctx.sleep(600); /* FR-184: the answer controls ignore clicks for 500 ms after an automatic open */
    await js(`(()=>{const b=[...document.querySelectorAll('#chat .note.perm:not(.settled) .note-actions button')].find(x=>/deny/i.test(x.textContent));if(b)b.click();})()`);
    await ok(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(B)});return a&&a.state!=='working'&&a.state!=='thinking'&&a.state!=='waiting'})()`, `${tag}: ${nameB} settles`, 25000);
    console.log(`[follow-notice] open office ${tag} ok`);
  }

  // ======== review on #1414: typing holds the notice and is never eaten (F2), a replacing dialog keeps its focus (F3), a hostile name is text (F1) ========
  {
    const tag = 'review 1440x900';
    const MOD = process.platform === 'darwin' ? ['meta'] : ['control'];
    const box = () => js(`(document.getElementById('msgInput')||{}).value`);
    await H.load({ w: 1440, h: 900 });
    await H.calm({ blur: true });
    await hooks();
    await js(`window.__durbarSimUi.afNotice.on(true)`);
    const nameA = await nameOf(A);
    await openChatBy(sel(A), nameA);
    await quiet(true);
    // F2: text in the box holds the notice; it takes no focus and moves nothing
    await js(`window.__nAt=0;(()=>{const b=window.__durbarSimUi.bridge();b.__q=b.send;window.__gate=new Promise(r=>{window.__openGate=r;});b.send=async()=>{await window.__gate;return {ok:true};};})();0`);
    await sendHere('first');
    await type('draft'); /* the next message, written while the first is on its way */
    await js(`(()=>{window.__openGate();const b=window.__durbarSimUi.bridge();b.send=b.__q;})();0`);
    await stays(`!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.id==='msgInput'`, `${tag}: FR-239: while you type, no notice, the focus stays in the box`, 3000);
    assert.strictEqual(await js(`window.__nAt`), 0, `${tag}: FR-239: no notice opened at any time while you typed`);
    assert.strictEqual(await box(), 'draft', `${tag}: the draft is whole`);
    await H.key('a', MOD, { char: 'never' }); await H.key('Backspace');
    await ok(`!!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: with the box empty again, the notice comes`, 6000);
    // F2: typing on the notice is writing: it stays, and the text lands in the box
    await type('ok go');
    await ok(`!document.querySelector('.dlg-ov.af-notice')`, `${tag}: FR-239: a typed character closes the notice as Stay`, 2000);
    assert.strictEqual(await box(), 'ok go', `${tag}: FR-239: every typed character landed in the message box`);
    await stays(`!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')`, `${tag}: FR-239: and nothing moves`, 3500);
    // F3: another dialog replaces the notice: the focus stays in the new dialog
    await H.key('a', MOD, { char: 'never' }); await H.key('Backspace');
    await H.key('Return');
    await sendHere('third');
    await ok(`!!document.querySelector('.dlg-ov.af-notice')`, `${tag}: the notice`, 6000);
    await js(`window.__opFocus=0;document.getElementById('msgInput').addEventListener('focus',()=>{window.__opFocus++;});window.__d2=window.DurbarDialog(document)({title:'Another dialog',body:'It replaces the notice.',buttons:[{label:'OK',value:null}]});0`);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&!!document.getElementById('modeDlg')`, `${tag}: the new dialog took the notice's place`, 2000);
    await stays(`!!document.getElementById('modeDlg')&&document.getElementById('modeDlg').contains(document.activeElement)&&document.body.classList.contains('panel-open')`, `${tag}: FR-239: the replaced notice leaves the focus in the new dialog and moves nothing`, 3500);
    assert.strictEqual(await js(`window.__opFocus`), 0, `${tag}: FR-239: the focus never went back to the message box behind the new dialog, not even for a moment (its own trap would only pull it back)`);
    await H.key('Escape');
    await ok(`!document.getElementById('modeDlg')`, `${tag}: the new dialog closes`);
    // F1: a hostile name is shown as masked text, never as markup
    await mclick('#backBtn');
    await ok(`!document.body.classList.contains('panel-open')`, `${tag}: back in the office`);
    const TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const hostile = '<img src=x onerror="window.__pwn=1"> "q" & \u202eevil\u200b ' + TOKEN;
    await js(`window.__pwn=0;window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A)}).name=${jsLiteral(hostile)};0`);
    await js(`window.__ann.length=0;0`);
    await finish(A, 'Done.');
    await ok(`!!document.querySelector('.dlg-ov.af-notice')`, `${tag}: the notice for the hostile name`, 15000);
    await ctx.sleep(300);
    const seen = await js(`(()=>{const d=document.querySelector('.dlg-ov.af-notice');return {els:[...d.querySelectorAll('*')].filter(e=>!e.closest('svg')).map(e=>e.tagName.toLowerCase()).filter(t=>!['div','h3','p','button','span'].includes(t)),head:d.querySelector('h3').textContent,pwn:window.__pwn,said:window.__ann.filter(t=>/Press Escape/.test(t)).join(' | ')}})()`);
    assert.deepStrictEqual(seen.els, [], `${tag}: FR-238: the name made no element in the notice: ${JSON.stringify(seen.els)}`);
    assert.strictEqual(seen.pwn, 0, `${tag}: FR-238: no script ran`);
    assert.ok(/Press Escape/.test(seen.said), `${tag}: the notice's line was said`);
    assert.ok(seen.head.endsWith(' finished') && seen.head.includes('<img'), `${tag}: FR-238: the name is shown as text: ${JSON.stringify(seen.head)}`);
    assert.ok(!seen.head.includes(TOKEN) && !seen.said.includes(TOKEN), `${tag}: FR-238: the token-shaped part is masked in the notice and its own announcement: ${JSON.stringify(seen)}`);
    await mclick('.dlg-ov.af-notice .dbtn .btn');
    await ok(`!document.querySelector('.dlg-ov.af-notice')`, `${tag}: Stay in the office`);
    console.log(`[follow-notice] ${tag} ok`);
  }

  // ======== reduced motion (media emulation) and the Motion setting off: nothing moves, the number still counts ========
  {
    const dbg = wc.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    for (const how of ['reduced motion', 'Motion off']) {
      if (how === 'reduced motion') await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await H.load({ w: 1440, h: 900 });
        await hooks();
        if (how === 'Motion off') assert.strictEqual(await js(`window.__durbarSimUi.setMotion(false)`), false, 'Motion off');
        else assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'reduced motion is on');
        await js(`window.__durbarSimUi.afNotice.on(true)`);
        await openChatBy(sel(A), await nameOf(A));
        await quiet(true);
        await sendHere('still');
        await ok(NOTICE, `${how}: the notice shows`, 4000);
        assert.strictEqual(await running(), 0, `${how}: FR-241: no animation runs in the notice`);
        await ok(`document.querySelector('.dlg-ov.af-notice')&&document.querySelector('.af-notice .afn-n').textContent==='2'`, `${how}: FR-241: the number still counts`, 2500);
        assert.strictEqual(await running(), 0, `${how}: FR-241: still none later`);
        await ok(`!document.querySelector('.dlg-ov.af-notice')&&!document.body.classList.contains('panel-open')`, `${how}: the move happens`, 4000);
      } finally {
        if (how === 'reduced motion') await media('no-preference');
      }
    }
  }

  // ======== Open office and the worlds (Photo office, cave, arcade), both sizes: both notices fit; pictures ========
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  /* `flat-retro`: Open office in the Retro Pixel theme (html[data-ui="retro"], no world) */
  const WORLDS = [['flat', null], ['flat-retro', null, { theme: 'retro' }], ['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['arcade', { worldflags: 'retro', world: 'retro' }]];
  for (const [world, q, tq] of WORLDS) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${world} ${w}x${h}`;
    if (q) { await H.load({ w, h, query: { officeview: 'real', ...q }, ready: REAL }); await ok(REAL, `${tag}: the Real office`); } else await H.load({ w, h, query: tq || {} });
    if (tq) assert.strictEqual(await js(`document.documentElement.dataset.ui||''`), tq.theme, `${tag}: the theme drawn`);
    if (q && q.world) assert.strictEqual(await js(`document.documentElement.dataset.world`), q.world, `${tag}: the world drawn`);
    await H.calm({ blur: true });
    await hooks();
    await js(`window.__durbarSimUi.afNotice.on(true)`);
    const nameA = await nameOf(A);
    const home = q ? plate(A) : sel(A);
    const ext = world === 'cave' ? 'jpg' : 'png'; /* the cave's art shows through the backdrop: as a palette PNG its picture passes the 300 KB limit */
    await openChatBy(home, nameA);
    await quiet(true);
    await sendHere('hello world');
    await ok(NOTICE, `${tag}: the notice to the office`, 4000);
    await bg(true); /* the count waits, so the picture shows 3 */
    assert.deepStrictEqual(await fit(), [], `${tag}: FR-241: the notice to the office fits`);
    await shotTo(`052-follow-notice-office-${world}-${w}x${h}.${ext}`);
    await bg(false);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&!document.body.classList.contains('panel-open')`, `${tag}: the move`, 6000);
    await ok(`!!document.querySelector(${jsLiteral(home + '.is-followed')})`, `${tag}: its desk is followed`);
    await finish(A, 'Done.');
    await ok(NOTICE, `${tag}: the notice to the chat`, 15000);
    await bg(true);
    assert.strictEqual((await notice()).head, `${nameA} finished`, `${tag}: the words`);
    assert.deepStrictEqual(await fit(), [], `${tag}: FR-241: the notice to the chat fits`);
    await shotTo(`052-follow-notice-chat-${world}-${w}x${h}.${ext}`);
    await bg(false);
    await ok(`!document.querySelector('.dlg-ov.af-notice')&&document.body.classList.contains('panel-open')&&document.activeElement&&document.activeElement.id==='panelTitle'`, `${tag}: its chat opens`, 6000);
    console.log(`[follow-notice] ${tag} ok`);
  }
  } finally { await H.releaseFocus(); }
  console.log('[follow-notice] all checks passed');
};
