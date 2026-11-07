/*
 * Spec 052 FR-191..FR-195, FR-205 (T196, T197): Your door, the Needs you queue as a non-modal panel (behind the `door` flag, off by default).
 * Steps of FR-205 built here: 1 typing, 2 no shift, 3 new, 8 focus, 9a app start (Q-NY-3), the empty panel (Q-NY-13) and, in Real office,
 * the Boss door slips staying visible (Q-NY-15). The other steps (4..7, 9b, 9, 10, 11) are T198..T201.
 * Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=$(mktemp -d) DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-needs-panel.js xvfb-run -a npx electron . --no-sandbox
 *
 * The page is loaded with `door=1` (the flag). Mutation checks (listed in the PR): focus the first heading on an automatic open (step 1),
 * drop the arming at app start (9a), make the panel modal (aria-modal, step 1), drop the throttle or the dismissal rule (step 3), let Esc close
 * from a text field (step 8), give the panel a layout position (step 2).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: Date.now() }, e))})`);
  const READY = { flat: 'fit', real: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'` };
  const deskRects = () => js(`JSON.stringify([...document.querySelectorAll('#stage .desk[data-id]')].map(d=>{const r=d.getBoundingClientRect();return [d.dataset.id,Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];}))`);
  const count = () => js(`Number((document.querySelector('#inboxBtn b')||{}).textContent)||0`);
  const panelOpen = () => js(`!!document.getElementById('needsPanel')`);
  // every agent that needs you finishes its turn (as check-auto-follow does), so nothing waits
  const answerAll = async () => {
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&(a.state==='waiting'||a.state==='error')).map(a=>a.id)`);
    await js(`window.__durbarSimUi.agents().forEach(a=>{if(a.limit)a.limit=null;})`); // the spending limit of the simulator's agent: a limit counts as needing you
    for (const id of ids) {
      await emit({ sessionId: id, type: 'status', status: 'working', intent: 'Working' });
      await emit({ sessionId: id, type: 'output', final: true, text: 'Done.' });
      await emit({ sessionId: id, type: 'status', status: 'idle' });
    }
  };
  const key = (k, mods, o) => H.key(k, mods, o);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const view of ['flat', 'real']) {
      const at = `${w}x${h} ${view}`;
      const tag = `${w}x${h}-${view}`;
      // a page that watches every panel that is added, and every answer that reaches the bridge
      const load = async (door) => {
        await H.load({ w, h, query: Object.assign(view === 'real' ? { officeview: 'real' } : {}, door ? { door: '1' } : {}), ready: READY[view], settle: false, focus: true });
        await js(`(()=>{window.__adds=0;window.__perm=[];new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.id==='needsPanel')window.__adds++;}).observe(document.body,{childList:true});
          const b=window.__durbarSimUi.bridge();if(!b.__w2){const p=b.resolvePermission;b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};b.__w2=1;}})()`);
      };

      // ---- the flag is off: the modal inbox, no panel, whatever waits ----
      if (w === 1440) {
        await load(false);
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>0`, 15000), `${at}: something waits in the simulator`);
        await ctx.sleep(3600); // past the arming (3 s after the agent list)
        assert.strictEqual(await panelOpen(), false, `${at}: with the flag off nothing opens by itself`);
        await js(`document.getElementById('inboxBtn').click()`);
        assert.ok(await until(`!!document.getElementById('inboxDlg')`, 4000), `${at}: with the flag off the amber button still opens the modal inbox`);
        assert.strictEqual(await panelOpen(), false, `${at}: and no panel`);
        await js(`document.getElementById('inboxClose').click()`);
      }

      // ---- 9a: app start (Q-NY-3) ----
      await load(true);
      assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>0`, 15000), `${at}: something waits in the simulator`);
      await js(`window.__ae0=document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 12000), `${at}: with requests waiting at arming the panel opens with the list`);
      const t0 = Date.now(); // the gate's throttle runs from this opening
      assert.ok(await until(`!document.getElementById('needsPanel').getAnimations().length`, 3000), `${at}: the slide ends`);
      const n0 = await count();
      const st = await js(`(()=>{const p=document.getElementById('needsPanel'),r=p.getBoundingClientRect(),cs=getComputedStyle(p);return {role:p.getAttribute('role'),name:p.getAttribute('aria-labelledby'),h:(document.getElementById(p.getAttribute('aria-labelledby'))||{}).textContent,modal:!!document.querySelector('[aria-modal="true"]'),
        rows:p.querySelectorAll('.inbox-row').length,later:!document.getElementById('doorLater').hidden,line:(document.getElementById('doorLine')||{}).textContent,faces:p.querySelectorAll('.door-face').length,
        pos:cs.position,backdrop:!!document.querySelector('.dlg-ov'),ae:document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName,inPanel:p.contains(document.activeElement),
        r:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)],iw:innerWidth,ih:innerHeight,scrollY:document.scrollingElement.scrollTop,docH:document.documentElement.scrollHeight}})()`);
      assert.strictEqual(st.role, 'region', `${at}: a region ${JSON.stringify(st)}`);
      assert.strictEqual(st.h, 'Needs you', `${at}: labelled by its heading "Needs you" ${JSON.stringify(st)}`);
      assert.strictEqual(st.modal, false, `${at}: not modal: no aria-modal anywhere ${JSON.stringify(st)}`);
      assert.strictEqual(st.backdrop, false, `${at}: no backdrop ${JSON.stringify(st)}`);
      assert.strictEqual(st.pos, 'fixed', `${at}: it lies over the room and takes no layout space ${JSON.stringify(st)}`);
      assert.strictEqual(st.rows, n0, `${at}: one row per agent that needs you (the amber count ${n0}) ${JSON.stringify(st)}`);
      assert.ok(st.later, `${at}: the app-start opening has a Later button ${JSON.stringify(st)}`);
      assert.strictEqual(st.line, `${n0} outside your door, oldest first`, `${at}: the line under the heading ${JSON.stringify(st)}`);
      assert.ok(st.faces >= 1 && st.faces <= 8, `${at}: a line of faces ${JSON.stringify(st)}`);
      assert.strictEqual(st.inPanel, false, `${at}: opening by itself leaves focus out of the panel (FR-192) ${JSON.stringify(st)}`);
      assert.strictEqual(st.ae, await js('window.__ae0'), `${at}: focus did not move ${JSON.stringify(st)}`);
      assert.ok(st.r[2] <= st.iw && st.r[3] <= st.ih && st.r[0] >= 0 && st.r[1] > 0, `${at}: inside the window, below the top bar ${JSON.stringify(st)}`);
      assert.ok(st.docH <= st.ih + 1 && st.scrollY === 0, `${at}: no page scroll ${JSON.stringify(st)}`);
      const size = await js(`(()=>{const p=document.getElementById('needsPanel');let min=99;for(const e of p.querySelectorAll('*')){if(!e.childNodes.length)continue;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own||!e.getClientRects().length)continue;min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));}return min;})()`);
      assert.ok(size >= 10.5, `${at}: text at least 10.5 px, smallest ${size}`);
      const clipped = await js(`(()=>{const p=document.getElementById('needsPanel'),pr=p.getBoundingClientRect();return [...p.querySelectorAll('.inbox-row .btn,.door-head .btn')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&(r.left<pr.left-1||r.right>pr.right+1)}).length;})()`);
      assert.strictEqual(clipped, 0, `${at}: no button sticks out of the panel`);
      // Q-NY-15: in Real office the slips at the Boss door stay visible while the panel is open
      if (view === 'real') {
        const slips = await js(`[...document.querySelectorAll('#stage .ro-slip')].filter(s=>{const r=s.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(s).visibility!=='hidden'&&getComputedStyle(s).display!=='none'}).length`);
        assert.ok(slips >= 1, `${at}: the Boss door slips are still visible with the panel open (Q-NY-15): ${slips}`);
      }
      await H.shot(path.join(OUT, `052-door-${tag}-startup.png`), { prep: 'mouse', settle: false });
      // Later closes it, moves no focus, and the asks stay on the amber count
      await js(`document.getElementById('doorLater').click()`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: Later closes the panel`);
      assert.strictEqual(await count(), n0, `${at}: the amber count keeps the asks`);
      assert.strictEqual(await js(`document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName`), await js('window.__ae0'), `${at}: Later moved no focus`);

      // ---- 2: no shift ----
      const closed = await deskRects();
      await js(`document.getElementById('inboxBtn').click()`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000), `${at}: the amber button opens the panel`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').getAttribute('aria-expanded')`), 'true', `${at}: the amber button says it is expanded`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').getAttribute('aria-controls')`), 'needsPanel', `${at}: and what it controls`);
      await ctx.sleep(300);
      assert.strictEqual(await deskRects(), closed, `${at}: no desk moved with the panel open`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').click(),0`), 0);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: the amber button is a toggle`);
      assert.strictEqual(await deskRects(), closed, `${at}: no desk moved with the panel closed again`);

      if (view === 'real') continue; // the rest runs in Flat; Real office has the same code, its slips and faces were checked above

      // ---- 8: focus ----
      await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
      await key('i', [], { char: 'always' });
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000), `${at}: I opens the panel`);
      assert.ok(await until(`document.activeElement&&document.activeElement.classList.contains('ib-h')&&document.getElementById('needsPanel').contains(document.activeElement)`, 3000), `${at}: I puts focus on a row's heading, never a button`);
      await key('Escape', [], { char: 'never' });
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: Esc with focus inside closes it`);
      assert.ok(await until(`document.activeElement===document.getElementById('inboxBtn')`, 3000), `${at}: focus goes back (to the amber button when nothing had it)`);
      await js(`(()=>{const i=document.createElement('input');i.id='drvTxt';i.style.cssText='position:fixed;left:12px;bottom:12px;z-index:50;width:200px';document.body.appendChild(i);i.value='hello';i.focus();i.setSelectionRange(1,3);})()`);
      await key('A', ['control', 'shift'], { char: 'never' });
      assert.ok(await until(`!!document.getElementById('needsPanel')&&document.activeElement.classList.contains('ib-h')`, 3000), `${at}: Ctrl+Shift+A opens it from a text field, focus on a heading`);
      await key('Escape', [], { char: 'never' });
      assert.ok(await until(`!document.getElementById('needsPanel')&&document.activeElement===document.getElementById('drvTxt')`, 3000), `${at}: Esc returns focus to the text field it came from`);
      // Esc from a text field never closes the panel
      await js(`document.getElementById('inboxBtn').click()`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000));
      await js(`document.getElementById('drvTxt').focus()`);
      await key('Escape', [], { char: 'never' });
      await ctx.sleep(200);
      assert.strictEqual(await panelOpen(), true, `${at}: Esc in a text field closes nothing`);
      await js(`document.getElementById('inboxBtn').click()`);
      await until(`!document.getElementById('needsPanel')`, 3000);

      // ---- 3, 1: new, and typing (nothing waits; then one request arrives) ----
      await answerAll();
      assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 8000), `${at}: nothing waits now`);
      // repaints, a resize and a drag of the window do not open it
      await H.js(`window.dispatchEvent(new Event('resize'))`);
      ctx.win.setContentSize(w - 20, h); await ctx.sleep(300); ctx.win.setContentSize(w, h); await ctx.sleep(300);
      assert.strictEqual(await panelOpen(), false, `${at}: a resize opens nothing`);
      const quiet = Math.max(0, 10800 - (Date.now() - t0)); // past the throttle of the app-start opening
      await ctx.sleep(quiet);
      await js(`(()=>{const i=document.getElementById('drvTxt');i.focus();i.setSelectionRange(1,3);window.__perm=[];window.__adds=0;})()`);
      const A = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[3].id`);
      const B = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[4].id`);
      await emit({ type: 'status', sessionId: A, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np1-' + w, kind: 'shell', summary: 'Run the first', state: 'pending' } });
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 6000), `${at}: a new request opens the panel`);
      assert.strictEqual(await js(`document.getElementById('doorLater').hidden`), true, `${at}: Later is only for the app-start opening`);
      // keys typed after the opening go where they were going, and answer nothing
      for (const c of ['a', 's', 'd', 'o']) await key(c, [], { char: 'always' });
      const typed = await js(`(()=>{const i=document.getElementById('drvTxt');return {v:i.value,a:i.selectionStart,b:i.selectionEnd,ae:document.activeElement===i,perm:window.__perm.slice(),panelAe:document.getElementById('needsPanel').contains(document.activeElement)}})()`);
      assert.strictEqual(typed.ae, true, `${at}: focus stayed in the text field ${JSON.stringify(typed)}`);
      assert.deepStrictEqual(typed.perm, [], `${at}: no letter answered anything ${JSON.stringify(typed)}`);
      assert.strictEqual(typed.v, 'hasdolo', `${at}: the four letters replaced the selection in the field and went nowhere else ${JSON.stringify(typed)}`);
      // a burst joins the open list: one panel, no second slide
      await emit({ type: 'status', sessionId: B, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np2-' + w, kind: 'shell', summary: 'Run the second', state: 'pending' } });
      assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2`, 6000), `${at}: the second request joins the open list`);
      assert.strictEqual(await js('window.__adds'), 1, `${at}: one opening for both`);
      await H.shot(path.join(OUT, `052-door-${tag}-two-waiting.png`), { prep: 'mouse', settle: false });
      // dismissed: the ones already seen never reopen it; a new one does, once
      await js(`document.getElementById('inboxClose').click()`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000));
      ctx.win.setContentSize(w - 20, h); await ctx.sleep(300); ctx.win.setContentSize(w, h);
      await js(`window.dispatchEvent(new Event('focus'))`);
      await ctx.sleep(800);
      assert.strictEqual(await panelOpen(), false, `${at}: after dismissal the requests already seen never reopen it`);
      await ctx.sleep(Math.max(0, 10800 - 1500));
      const C = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[5].id`);
      await emit({ type: 'status', sessionId: C, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np3-' + w, kind: 'shell', summary: 'Run the third', state: 'pending' } });
      assert.ok(await until(`!!document.getElementById('needsPanel')&&document.querySelectorAll('#needsPanel .inbox-row').length===3`, 6000), `${at}: a new request reopens it with all three`);
      // opened by itself and emptied (Q-NY-13): All clear, then it goes, focus untouched
      await js(`document.getElementById('drvTxt').focus()`);
      await answerAll();
      assert.ok(await until(`/All clear/.test((document.getElementById('needsPanel')||{textContent:''}).textContent)`, 6000), `${at}: emptied, it says All clear`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 5000), `${at}: and slides away by itself`);
      assert.strictEqual(await js(`document.activeElement===document.getElementById('drvTxt')`), true, `${at}: an automatic close leaves focus alone`);
      await js(`document.getElementById('drvTxt').remove()`);
    }
  }
  console.log('check-needs-panel passed');
};
