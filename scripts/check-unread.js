/*
 * Spec 001 FR-170..FR-177 and spec 005 FR-176, FR-177 (issue #691): a finished agent's reply stays marked "New" until its chat is shown.
 * Simulator only (no AI credits, no agent app).
 *
 *   npm run check:unread
 *   OUT=docs/screenshots  (optional) also saves 001-unread-{1440x900,1280x800}.png
 *
 * At 1440x900 and 1280x800 it checks: a completion while the office is shown marks the desk (badge with the word New, outline, accessible
 * name, tooltip) and keeps it off the couch while the shown state stays Done and the Done count rises by one; a repeated idle or a streaming
 * update does not mark or announce again (one announcement); a completion while another chat is open marks the agent (also on the strip);
 * a completion while its own chat is open does not; closing the chat or going back to the office does not clear; opening the chat does, and the
 * agent then follows the couch rule; the Browser tab and the Notes drawer are not "shown"; Mark as read from the keyboard (Shift+F10 on the
 * desk) clears without opening the chat; a hidden folder keeps the marker, announces nothing and shows it again when shown; two unread
 * sessions at once; the list row carries the marker; all 15 unread fit the office page rules (no overlap, text at least 10.5px); the pulse
 * only with motion allowed (reduced motion emulated). Every wait is until() and its result is asserted.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 6000), what);
  const sel = (id) => `#stage .desk[data-id="${id}"]`;
  const turn = (id, text) => js(`(()=>{const E=e=>window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},e));E({type:'status',status:'working',intent:'Working'});E({type:'output',final:true,text:${jsLiteral(text || 'All done.')}});E({type:'status',status:'idle'});})()`);
  const idleAgain = (id) => js(`(()=>{const E=e=>window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},e));E({type:'output',final:false,delta:' more'});E({type:'status',status:'idle'});})()`);
  const marks = () => js(`[...document.querySelectorAll('#stage .unread-mark')].map(m=>m.closest('[data-id]').dataset.id).sort().join(',')`);
  const info = (id) => js(`(()=>{const d=document.querySelector(${jsLiteral(sel(id))});if(!d)return null;const m=d.querySelector('.unread-mark');return {cls:d.className,state:d.dataset.state,label:d.getAttribute('aria-label')||'',mark:!!m,text:m?m.textContent.trim():'',tip:m?m.title:'',font:m?parseFloat(getComputedStyle(m).fontSize):0,outline:getComputedStyle(d).outlineStyle,oColor:getComputedStyle(d).outlineColor,oWidth:getComputedStyle(d).outlineWidth,aria:m?m.getAttribute('aria-hidden'):''}})()`);
  const done = () => js(`+document.querySelector('#stats .stat[data-k=done] b').textContent`);
  const anns = () => js(`window.__ann.filter(t=>/New reply/.test(t))`);
  const strip = (id) => '.sitem[data-sw="' + id + '"] .unread-mark'; // the chat strip's marker of one session (a selector, put into page code with jsLiteral)
  const stripMark = (id) => js(`!!document.querySelector('.sitem[data-sw="'+CSS.escape(${jsLiteral(id)})+'"] .unread-mark')`);
  const openChat = async (id) => { await js(`document.querySelector(${jsLiteral(sel(id))}).click()`); await ok(`document.body.classList.contains('panel-open')&&document.querySelector('#chat')`, 'the chat of ' + id + ' opens'); };
  const closeChat = async () => { await H.key('Escape'); await ok(`!document.body.classList.contains('panel-open')`, 'the chat closes'); };
  // the colour --desk-new as the browser computes it (rgb), read through a probe so a theme or a fallback cannot hide a wrong value
  const green = () => js(`(()=>{const p=document.createElement('i');p.style.color='var(--desk-new)';document.body.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c;})()`);
  const needsC = () => js(`(()=>{const p=document.createElement('i');p.style.color='var(--desk-needs)';document.body.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c;})()`);
  const A = 'sim-7', B = 'sim-13', C = 'sim-15'; // Priya (idle, folder with others at work), Hugo (idle, likewise), Maya (Done, on the couch)

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    await js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);
    assert.strictEqual(await marks(), '', `${tag}: nothing is unread at start (the simulator's start-up script is history)`);
    const done0 = await done();
    await ok(`!!document.querySelector(${jsLiteral(sel(C) + '.shut')})`, `${tag}: Maya starts on the couch`);

    // a completion while the office is shown
    await turn(A, 'Priya finished the migration.');
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: Priya's desk is marked`);
    await H.settle();
    let a = await info(A);
    assert.strictEqual(a.text, 'New', `${tag}: the badge has the word New: ${a.text}`);
    assert.ok(a.font >= 10.5, `${tag}: badge text is at least 10.5px: ${a.font}`);
    assert.strictEqual(a.state, 'done', `${tag}: the shown state is still Done`);
    assert.ok(!/\bshut\b/.test(a.cls) && /\bis-unread\b/.test(a.cls), `${tag}: an unread finished desk keeps its desk: ${a.cls}`);
    assert.notStrictEqual(a.outline, 'none', `${tag}: the desk has an outline`);
    const G = await green();
    assert.ok(/^rgb\(/.test(G) && G !== 'rgb(0, 0, 0)', `${tag}: --desk-new is a colour: ${G}`);
    assert.strictEqual(a.oColor, G, `${tag}: the unread desk's outline is the green: ${a.oColor} vs ${G}`);
    assert.strictEqual(a.oWidth, '3px', `${tag}: and 3px wide: ${a.oWidth}`);
    const gm = G.match(/\d+/g).map(Number); assert.ok(gm[1] > gm[0] && gm[1] > gm[2], `${tag}: the highlight is green (g above r and b): ${G}`);
    assert.ok(/, new reply not read yet\b/.test(a.label), `${tag}: the accessible name says it: ${a.label}`);
    assert.strictEqual(a.tip, 'New reply, not read yet', `${tag}: tooltip`);
    assert.strictEqual(a.aria, 'true', `${tag}: the badge is hidden from the reader (the name carries the words)`);
    assert.strictEqual(await done(), done0 + 1, `${tag}: the Done count rose by one, as for any finished agent`);
    assert.strictEqual((await anns()).length, 1, `${tag}: one announcement: ${JSON.stringify(await anns())}`);
    assert.ok((await anns())[0].startsWith('Priya finished'), `${tag}: announcement text`);

    // no duplicate: another idle and a streaming update change nothing
    await idleAgain(A); await H.settle(); await ctx.sleep(300);
    assert.strictEqual(await marks(), A, `${tag}: still one marked desk`);
    assert.strictEqual((await anns()).length, 1, `${tag}: no second announcement for a streaming update or a second idle`);

    // a completion while ANOTHER chat is open: marked; the open chat's strip shows it too
    await openChat(C);
    await turn(B, 'Hugo finished the notes.');
    await ok(`!!document.querySelector(${jsLiteral(strip(B))})`, `${tag}: Hugo is marked on the strip while Maya's chat is open`);
    assert.ok(await stripMark(A), `${tag}: Priya is still marked on the strip`);
    assert.ok(/, new reply not read yet/.test(await js(`document.querySelector(${jsLiteral('.sitem[data-sw="' + B + '"]')}).getAttribute('aria-label')`)), `${tag}: the strip item's name says it`);
    // a completion while ITS OWN chat is open: not unread
    await ok(`window.__ann.some(t=>/Hugo finished/.test(t))`, `${tag}: Hugo's announcement`);
    const annN = (await anns()).length;
    await turn(C, 'Maya finished the release notes.');
    await H.settle(); await ctx.sleep(300);
    assert.ok(!(await stripMark(C)), `${tag}: Maya's own open chat: her reply is not unread`);
    assert.strictEqual((await anns()).length, annN, `${tag}: no announcement for a reply that is shown`);
    // closing the chat and going back to the office does not clear the others
    await closeChat();
    await ok(`!!document.querySelector(${jsLiteral(sel(B) + ' .unread-mark')})`, `${tag}: Hugo's desk shows the marker back in the office`);
    assert.strictEqual(await marks(), [A, B].sort().join(','), `${tag}: two unread desks, Maya not among them: ${await marks()}`);
    for (const id of [A, B]) assert.ok(!/\bshut\b/.test((await info(id)).cls), `${tag}: ${id} stays on its desk`);
    await turn(A, 'Priya finished the migration.'); // a second turn of an unread agent: no second marker, and its state reads Done again for the picture
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '[data-state=\"done\"]')})`, `${tag}: Priya is Done again`);
    await H.settle(); await ctx.sleep(300);
    // the "already unread" path: a real working -> idle turn (noteCompleted runs) while still unread says nothing more and changes nothing (Priya + Hugo = 2)
    assert.strictEqual((await anns()).length, 2, `${tag}: a second finished turn of an unread agent is not announced again: ${JSON.stringify(await anns())}`);
    assert.strictEqual(await marks(), [A, B].sort().join(','), `${tag}: and no marker is added or lost`);
    // needs you wins: the same unread desk asking for permission keeps the amber highlight, the green outline is not drawn (the badge stays)
    await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'status',status:'needs-permission',intent:'Waiting for permission: run ls'})`);
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '[data-state=\"waiting\"]')})`, `${tag}: Priya asks for permission`);
    const wt = await info(A);
    assert.ok(wt.mark && /\bis-unread\b/.test(wt.cls), `${tag}: still marked New while waiting: ${wt.cls}`);
    assert.ok(wt.oColor !== G || wt.outline === 'none', `${tag}: the waiting desk does not get the green outline: ${wt.outline} ${wt.oColor}`);
    const NC = await needsC();
    assert.ok(NC !== G && /^rgb\(/.test(NC), `${tag}: the needs-you colour is its own: ${NC} vs ${G}`);
    assert.strictEqual(wt.oColor, NC, `${tag}: a desk that needs you has the strong amber outline: ${wt.oColor} vs ${NC}`);
    assert.strictEqual(wt.oWidth, '4px', `${tag}: 4px, wider than New's 3px: ${wt.oWidth}`);
    await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'status',status:'working',intent:'Working'})`);
    await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'status',status:'idle'})`);
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '[data-state=\"done\"]')})`, `${tag}: Priya is Done again after the question`);
    assert.strictEqual((await info(A)).oColor, G, `${tag}: and the green outline is back`);
    if (process.env.OUT) await H.shot(path.join(OUT, `001-unread-${tag}.png`), { prep: 'calm', blur: true, settle: true });

    // the Browser tab and the Notes drawer are not "shown"
    await openChat(A);
    await ok(`!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: opening Priya's chat reads her reply`); // the office under an open chat is not repainted (the strip is the live surface)
    assert.ok(await stripMark(B), `${tag}: Hugo is still unread while Priya's chat is open`);
    await closeChat();
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + '.shut')})`, `${tag}: Priya, read, follows the couch rule`);
    a = await info(A);
    assert.ok(['done', 'idle'].includes(a.state), `${tag}: and its state is the one it had (the simulator answers an opened chat with Ready): ${a.state}`);
    assert.strictEqual(await marks(), B, `${tag}: only Hugo is unread now`);
    assert.ok(/\brest-recent\b/.test(a.cls), `${tag}: on the couch (finished a moment ago): ${a.cls}`);
    assert.ok(!/\bis-unread\b/.test(a.cls) && a.oColor !== G, `${tag}: read: no green outline: ${a.cls} ${a.oColor}`);

    // Mark as read from the keyboard: Shift+F10 on the focused desk
    await js(`document.querySelector(${jsLiteral(sel(B))}).focus()`);
    await H.key('F10', ['shift'], { char: 'never' });
    await ok(`!!document.querySelector('#modeMenu [data-op="read"]')`, `${tag}: Shift+F10 opens the card menu with Mark as read`);
    assert.ok(await js(`document.getElementById('modeMenu').getAttribute('role')==='menu'`), 'the card menu is a menu');
    await js(`document.querySelector('#modeMenu [data-op="read"]').focus()`);
    await H.key('Return');
    await ok(`!document.getElementById('modeMenu')&&!document.querySelector(${jsLiteral(sel(B) + ' .unread-mark')})`, `${tag}: Mark as read clears the marker`);
    assert.ok(!(await js(`document.body.classList.contains('panel-open')`)), `${tag}: without opening the chat`);
    assert.ok(await js(`window.__ann.some(t=>/Hugo: marked as read/.test(t))`), `${tag}: announced`);
    await ok(`!!document.querySelector(${jsLiteral(sel(B) + '.shut')})`, `${tag}: Hugo, read, follows the couch rule`);
    assert.strictEqual(await marks(), '', `${tag}: nothing is unread`);

    // the Browser tab is not the chat; the Notes drawer covers it
    await turn(A, 'Priya again.');
    await ok(`!!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: Priya is unread again`);
    await openChat(A);
    await ok(`!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: read on open`);
    const tabs = await js(`!!document.getElementById('tabBrowser')`);
    if (tabs) {
      await js(`document.getElementById('tabBrowser').click()`);
      await ok(`document.getElementById('tabBrowser').getAttribute('aria-selected')==='true'`, `${tag}: Browser tab in front`);
      const nAnn = await js(`window.__ann.length`);
      await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'status',status:'working',intent:'Working'})`);
      await ok(`document.getElementById('runSlot').classList.contains('running')`, `${tag}: the run slot shows the turn`);
      await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'output',final:true,text:'Priya, while the Browser tab is in front.'})`);
      await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(A)},type:'status',status:'idle'})`);
      await ok(`!document.getElementById('runSlot').classList.contains('running')`, `${tag}: the run slot shows the turn ended`);
      await H.settle(); await ctx.sleep(400);
      const said = (await js(`window.__ann.slice(${jsLiteral(nAnn)})`)).filter((t) => /finished/i.test(t));
      assert.strictEqual(said.length, 1, `${tag}: one announcement for the reply behind the Browser tab: ${JSON.stringify(said)}`);
      assert.ok(/New reply/.test(said[0]), `${tag}: and it is the New reply one: ${said[0]}`);
      await ok(`!!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: a reply finished behind the Browser tab is unread`);
      // closing the chat with an unread reply (Browser tab in front) does not read it; the office shows the marker
      await closeChat();
      await ok(`!!document.querySelector(${jsLiteral(sel(A) + ' .unread-mark')})`, `${tag}: closing the chat does not clear an unread reply`);
      await openChat(A);
      await js(`(()=>{const t=document.getElementById('tabChat');if(t&&t.getAttribute('aria-selected')!=='true')t.click();})()`);
      await ok(`document.getElementById('tabChat').getAttribute('aria-selected')==='true'&&!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: back on the Chat tab it is read`);
    } else console.log(`[unread] ${tag}: no Browser tab in this build, tab step skipped`);
    // the Notes drawer covers the chat log: a reply that finishes under it is not shown
    const nt = await js(`!!document.querySelector('[data-notes-toggle]')`);
    if (nt) {
      await js(`document.querySelector('[data-notes-toggle]').click()`);
      await ok(`!!document.getElementById('notesDrawer')&&!document.getElementById('notesDrawer').hidden`, `${tag}: the Notes drawer opens`);
      await turn(A, 'Priya, under the Notes drawer.');
      await ok(`!!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: a reply finished under the Notes drawer is unread`);
      await js(`document.querySelector('[data-notes-toggle]').click()`);
      await ok(`document.getElementById('notesDrawer').hidden&&!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: closing the drawer shows the chat, so it is read`);
    } else console.log(`[unread] ${tag}: no Notes drawer in this build, drawer step skipped`);
    // a minimised or hidden window does not show the chat: a reply that finishes then is New, and it clears when the window is visible again
    // (document.visibilityState is overridden where the page reads it, so the page's own visibility rule is what is tested)
    const vis = (v) => js(`(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>${jsLiteral(v)}});document.dispatchEvent(new Event('visibilitychange'));})()`);
    await vis('hidden');
    await turn(A, 'Priya, window hidden.');
    await ok(`!!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: a reply into the open chat of a hidden window is New`);
    await vis('visible');
    await ok(`!document.querySelector(${jsLiteral(strip(A))})`, `${tag}: the window is visible again: the open chat shows it, so it is read`);
    await js(`delete document.visibilityState`);
    await closeChat();

    // a hidden folder keeps the marker and says nothing; shown again, the desk is marked
    const room = await js(`window.__durbarSimUi.agents().find(x=>x.id==='sim-13').room`);
    await js(`window.__durbarSimUi.hideRoom(${jsLiteral(room)},true)`);
    await ok(`!document.querySelector(${jsLiteral(sel(B))})`, `${tag}: the folder is hidden`);
    const annH = (await anns()).length, doneH = await done();
    await turn(B, 'Hugo finished while hidden.');
    await H.settle(); await ctx.sleep(300);
    assert.strictEqual((await anns()).length, annH, `${tag}: nothing announced for a hidden folder`);
    assert.strictEqual(await marks(), '', `${tag}: no marker drawn for a hidden folder`);
    assert.ok((await done()) <= doneH, `${tag}: the header counts do not include the hidden agent`);
    await js(`window.__durbarSimUi.hideRoom(${jsLiteral(room)},false)`);
    await ok(`!!document.querySelector(${jsLiteral(sel(B) + ' .unread-mark')})`, `${tag}: shown again, the marker is there`);
    assert.ok(!/\bshut\b/.test((await info(B)).cls), `${tag}: and the desk is kept`);

    // the list view carries the marker and the name
    await H.click('#vList');
    await ok(`!!document.querySelector(${jsLiteral('#list .lrow[data-id="' + B + '"] .unread-mark')})&&/new reply not read yet/.test(document.querySelector(${jsLiteral('#list .lrow[data-id="' + B + '"]')}).getAttribute('aria-label'))`, `${tag}: the list row says New`);
    await H.click('#vOffice');
    await ok(`document.getElementById('vOffice').getAttribute('aria-pressed')==='true'&&!!document.querySelector(${jsLiteral(sel(B))})`, `${tag}: back in the office`);

    // an unsent draft on one desk too (the pencil and the badge share the corner)
    await openChat('sim-3');
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='half a prompt';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await closeChat();
    await ok(`!!document.querySelector(${jsLiteral(sel('sim-3') + ' .draft-mark')})`, `${tag}: sim-3 shows the draft pencil`);

    // all 15 unread: the page rules hold (no overlap, text at least 10.5px)
    await js(`window.__durbarSimUi.agents().filter(x=>!x.parent).forEach(x=>{const E=e=>window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:x.id},e));E({type:'status',status:'working',intent:'Working'});E({type:'status',status:'idle'});})`);
    await ok(`document.querySelectorAll('#stage .unread-mark').length===15`, `${tag}: all 15 are unread`, 8000);
    await H.settle(); await H.settleWalk(); // the figures that went to a place and back have arrived
    const probs = (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
    assert.ok(await js(`!!document.querySelector(${jsLiteral(sel('sim-3') + ' .draft-mark')})&&!!document.querySelector(${jsLiteral(sel('sim-3') + ' .unread-mark')})`), `${tag}: sim-3 has both the pencil and the badge`);
    assert.deepStrictEqual(probs, [], `${tag}: page rules with all 15 unread: ${probs.join('; ')}`);
    const boxes = await js(`(()=>{const bad=[];for(const d of document.querySelectorAll('#stage .desk[data-id]')){const m=d.querySelector('.unread-mark');if(!m){bad.push(d.dataset.id+' no mark');continue;}const r=m.getBoundingClientRect(),q=d.getBoundingClientRect();if(r.left<q.left-0.5||r.right>q.right+0.5||r.top<q.top-0.5||r.bottom>q.bottom+0.5)bad.push(d.dataset.id+' mark outside desk');for(const o of d.querySelectorAll('.name,.chatno,.draft-mark')){const b=o.getBoundingClientRect();if(b.width&&r.left<b.right-0.5&&r.right>b.left+0.5&&r.top<b.bottom-0.5&&r.bottom>b.top+0.5)bad.push(d.dataset.id+' mark covers '+o.className);}}return bad;})()`);
    assert.deepStrictEqual(boxes, [], `${tag}: the badge stays inside its desk and covers nothing: ${boxes.join('; ')}`);
    const small = await js(`[...document.querySelectorAll('#stage .unread-mark')].filter(m=>parseFloat(getComputedStyle(m).fontSize)<10.5).length`);
    assert.strictEqual(small, 0, `${tag}: no badge text under 10.5px`);
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`), `${tag}: no page overflow`);
    console.log(`[unread] ${tag} ok`);
  }

  // reduced motion: emulated before the page loads (the app reads it once); the marker is static and still complete
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await H.load({ w: 1440, h: 900 });
      assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'reduced motion is on');
      await turn(B, 'Hugo, reduced motion.');
      await ok(`!!document.querySelector(${jsLiteral(sel(B) + ' .unread-mark')})`, 'reduced motion: the marker is there');
      const m = await js(`(()=>{const e=document.querySelector(${jsLiteral(sel(B) + ' .unread-mark')});const s=getComputedStyle(e);return {fresh:e.classList.contains('fresh'),anim:s.animationName,text:e.textContent.trim()}})()`);
      assert.deepStrictEqual(m, { fresh: false, anim: 'none', text: 'New' }, 'reduced motion: static badge, same words: ' + JSON.stringify(m));
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
    // motion allowed: the badge pulses once when it is set. Emulated explicitly (a runner may report "reduce"), and clock-free: an observer
    // reads the badge the moment it is first drawn, so a slow runner cannot let the 1.4 s "fresh" window pass before the check looks.
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await H.load({ w: 1440, h: 900 });
      assert.ok(await js(`matchMedia('(prefers-reduced-motion: no-preference)').matches`), 'motion is allowed');
      await js(`(()=>{window.__pulse=null;new MutationObserver(()=>{if(window.__pulse)return;const e=document.querySelector('#stage .desk[data-id="sim-13"] .unread-mark');if(e)window.__pulse={fresh:e.classList.contains('fresh'),anim:getComputedStyle(e).animationName};}).observe(document.getElementById('stage'),{childList:true,subtree:true});})()`);
      await turn(B, 'Hugo, motion allowed.');
      await ok(`!!window.__pulse`, 'motion allowed: the badge was drawn');
      const p = await js(`window.__pulse`);
      assert.ok(p.fresh && p.anim === 'unread-pulse', 'motion allowed: one pulse when it is set: ' + JSON.stringify(p));
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  }
  console.log('[unread] all checks passed');
};
