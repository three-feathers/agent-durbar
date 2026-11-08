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
 * The page is loaded with `door=1` (the flag). Mutation checks (listed in the PR and the 2026-11-08 delta): focus the first heading on an automatic open (step 1),
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
          const b=window.__durbarSimUi.bridge();if(!b.__w2){const p=b.resolvePermission;b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};b.__w2=1;}
          window.__ann=[];const sr=document.getElementById('srAnnounce');if(sr)new MutationObserver(()=>window.__ann.push(sr.textContent)).observe(sr,{childList:true,characterData:true,subtree:true});})()`);
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
      const quietIds = JSON.parse(await js(`JSON.stringify(window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&a.state!=='waiting'&&a.state!=='error'&&a.state!=='needs-permission'&&!a.limit).map(a=>a.id))`)); // agents with no request of their own, for the steps at the end
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
      if (!(await js(`document.hasFocus()`))) await H.focusPage({ ms: 1500 }); // only when it is lost: key delivery needs the window's focus
      assert.ok(await until(`document.hasFocus()&&document.activeElement===document.getElementById('drvTxt')&&document.getElementById('drvTxt').selectionStart===1&&document.getElementById('drvTxt').selectionEnd===3`, 4000), `${at}: the text field has focus and its selection before the keys`);
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
      const tOpen3 = Date.now(); // the gate's throttle for the next automatic opening runs from here
      // opened by itself and emptied (Q-NY-13): All clear, then it goes, focus untouched
      await js(`document.getElementById('drvTxt').focus()`);
      await answerAll();
      assert.ok(await until(`/All clear/.test((document.getElementById('needsPanel')||{textContent:''}).textContent)`, 6000), `${at}: emptied, it says All clear`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 5000), `${at}: and slides away by itself`);
      assert.strictEqual(await js(`document.activeElement===document.getElementById('drvTxt')`), true, `${at}: an automatic close leaves focus alone`);
      await js(`document.getElementById('drvTxt').remove()`);

      // ---- the new steps below open the panel on purpose (the amber button); the gate is not involved except in the last two ----
      const ensureOpen = async () => { if (!(await panelOpen())) await js(`document.getElementById('inboxBtn').click()`); assert.ok(await until(`!!document.getElementById('needsPanel')`, 4000), `${at}: the panel is open`); };
      const pend = [[A, 'np1-' + w], [B, 'np2-' + w], [C, 'np3-' + w]]; // cards the steps above left in their chats
      const perm = (id, rid, summary) => (pend.push([id, rid]), emit({ type: 'status', sessionId: id, status: 'needs-permission', intent: 'Waiting', permission: { requestId: rid, kind: 'shell', summary, state: 'pending' } }));
      assert.ok(quietIds.length >= 3, `${at}: three agents with no request of their own ${JSON.stringify(quietIds)}`);
      const live = async (i) => quietIds[i];
      const idle = async (id) => { await emit({ sessionId: id, type: 'status', status: 'working', intent: 'Working' }); await emit({ sessionId: id, type: 'output', final: true, text: 'Done.' }); await emit({ sessionId: id, type: 'status', status: 'idle' }); };
      const aeInfo = () => js(`(()=>{const a=document.activeElement,r=a&&a.closest&&a.closest('.inbox-row');return {tag:a?a.tagName:'',head:!!a&&a.classList.contains('ib-h'),row:r?r.dataset.id:'',k:a&&a.dataset?a.dataset.k||'':''}})()`);
      const clean = async () => { await answerAll(); while (pend.length) { const [id, rid] = pend.pop(); await emit({ type: 'permission', sessionId: id, permission: { requestId: rid, state: 'denied', via: 'stopped' } }); } assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 8000), `${at}: nothing waits again`); await js(`(document.getElementById('inboxClose')||{click(){}}).click()`); await until(`!document.getElementById('needsPanel')`, 4000); await js(`window.__perm=[];window.__ann=[]`); };
      await clean();

      // ---- FR-033: a repaint never leaves focus on another agent's button, and A answers nothing nobody read (review of #1273, finding 1) ----
      {
        const [X, Y, Z] = [await live(0), await live(1), await live(2)];
        await perm(X, 'fa1-' + w, 'Run the first'); await ctx.sleep(120); await perm(Y, 'fa2-' + w, 'Run the second'); await ctx.sleep(120); await perm(Z, 'fa3-' + w, 'Run the third');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===3`, 6000), `${at}: three wait`);
        await ensureOpen();
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===3`, 4000), `${at}: three rows`);
        await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        assert.strictEqual((await aeInfo()).k, 'approve', `${at}: focus is on the first agent's Allow button`);
        await idle(X); // its request goes away by itself
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2&&!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]')`, 6000), `${at}: the first row left`);
        const f = await aeInfo();
        assert.ok(f.head && f.tag !== 'BUTTON', `${at}: after the row left, focus is on a heading, never a button (FR-033) ${JSON.stringify(f)}`);
        assert.strictEqual(f.row, Y, `${at}: on the next row's heading ${JSON.stringify(f)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A right after a repaint answers nothing (nobody read that request)`);
        await key('j', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')&&document.activeElement.closest('.inbox-row').dataset.id!==${jsLiteral(Y)}`, 3000), `${at}: J moved to the next row ${JSON.stringify(await aeInfo())}`);
        await key('k', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')&&document.activeElement.closest('.inbox-row').dataset.id===${jsLiteral(Y)}`, 3000), `${at}: the person moved (J, K) and is back on the row ${JSON.stringify(await aeInfo())}`);
        await key('a', [], { char: 'always' });
        assert.ok(await until(`window.__perm.length===1`, 3000), `${at}: after the person moves, A answers the row they are on`);
        assert.deepStrictEqual(await js('window.__perm.slice()'), ['fa2-' + w + ':true'], `${at}: and it is that row's own request`);
        await ctx.sleep(300);
        assert.strictEqual(await js(`!document.body.classList.contains('panel-open')&&!!document.getElementById('needsPanel')`), true, `${at}: answering in the panel opens no chat and the panel stays (a row's buttons are not a click on its desk)`);
        await clean();
      }

            // ---- FR-033, repainted twice in a row: the answer keys keep waiting until the person moves (review of #1273, round 2, finding 1) ----
      {
        const [X, Y, Z] = [await live(0), await live(1), await live(2)];
        await perm(X, 'tr1-' + w, 'Run the first'); await ctx.sleep(120); await perm(Y, 'tr2-' + w, 'Run the second'); await ctx.sleep(120); await perm(Z, 'tr3-' + w, 'Run the third');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===3`, 6000), `${at}: three wait`);
        await ensureOpen();
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===3`, 4000), `${at}: three rows`);
        await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        await idle(X);
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2&&document.activeElement.classList.contains('ib-h')`, 6000), `${at}: first repaint: focus on a heading`);
        await idle(Z); // a second repaint, the person has not moved
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1`, 6000), `${at}: the third row left`);
        const g = await aeInfo();
        assert.ok(g.head && g.row === Y, `${at}: after the second repaint focus is still on the remaining row's heading ${JSON.stringify(g)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A after two repaints in a row still answers nothing (the person never moved)`);
        await clean();
      }

      // ---- FR-033: the next card of the same agent rises into the same row while focus is on its Allow ----
      {
        const X = await live(0);
        await perm(X, 'rs1-' + w, 'Run the first'); await ctx.sleep(120); await perm(X, 'rs2-' + w, 'Run the second');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000), `${at}: one agent waits`);
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]')`, 4000));
        await js(`window.__perm=[];window.__rq1=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]').dataset.rq;document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        await emit({ type: 'permission', sessionId: X, permission: { requestId: 'rs1-' + w, state: 'denied', via: 'user' } }); // answered elsewhere: the second card is the row's request now
        assert.ok(await until(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]').dataset.rq!==window.__rq1`, 6000), `${at}: the row now holds the agent's next request`);
        const f = await aeInfo();
        assert.ok(f.head && f.tag !== 'BUTTON', `${at}: a request replaced in the same row puts focus on the heading, not on its Allow (FR-033) ${JSON.stringify(f)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A answers nothing for a request that rose under the person's focus`);
        await clean();
      }

      // ---- FR-033: a deliberate move of the person ends the wait: I back to the panel, a click, coming back from the office (review of #1273, round 3) ----
      {
        const X = await live(0), Y = await live(1);
        let n = 0;
        const arm = async () => { // X and Y wait; focus on X's Allow; X goes idle: a repaint puts focus on Y's heading and the answer keys wait
          n++;
          await perm(X, `dm${n}x-` + w, 'Run the first'); await ctx.sleep(120); await perm(Y, `dm${n}y-` + w, 'Run the second');
          assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two wait (${n})`);
          await ensureOpen();
          assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2`, 4000), `${at}: two rows (${n})`);
          await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
          await idle(X);
          assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1&&document.activeElement.classList.contains('ib-h')`, 6000), `${at}: the repaint put focus on a heading (${n}) ${JSON.stringify(await aeInfo())}`);
          await key('a', [], { char: 'always' }); await ctx.sleep(300);
          assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: the answer keys wait after the repaint (${n})`);
        };
        const answered = async (what) => {
          await key('a', [], { char: 'always' });
          const got = await until(`window.__perm.length===1`, 3000);
          const seen = JSON.stringify(await js('window.__perm.slice()'));
          assert.ok(got, at + ': ' + what + ' ' + seen);
          assert.deepStrictEqual(await js('window.__perm.slice()'), [`dm${n}y-` + w + ':true'], `${at}: and it is that row's own request (${n})`);
          await ctx.sleep(1000);
        };
        // I from the office: focus left the panel to nowhere, I brings it back to the same heading
        await arm();
        await js(`document.activeElement.blur()`);
        await key('i', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')`, 3000), `${at}: I puts focus on a heading ${JSON.stringify(await aeInfo())}`);
        await answered('after I, A answers the row the person asked for');
        await clean();
        // coming back from a desk: focus moved to the office and back to the same heading
        await arm();
        await js(`window.__hd=document.activeElement;document.querySelector('#stage .desk[data-id]').focus()`);
        await js(`window.__hd.focus()`);
        await answered('after leaving to a desk and coming back, A answers');
        await clean();
        // a click on the heading that already has focus
        await arm();
        await js(`document.activeElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
        await answered('after a click on the heading, A answers');
        await clean();
      }

      // ---- FR-206 and FR-208 in the panel (review finding 2) ----
      {
        const W = await live(0);
        await perm(W, 'st1-' + w, 'Run the stale one');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000));
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] [data-k="approve"]')`, 4000), `${at}: the row offers Allow`);
        await js(`window.__perm=[];window.__ann=[];window.__rq1=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}]').dataset.rq;window.__stale=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] [data-k="approve"]')`);
        await emit({ type: 'permission', sessionId: W, permission: { requestId: 'st1-' + w, state: 'denied', via: 'user' } }); // answered elsewhere
        await perm(W, 'st2-' + w, 'Run the second one');
        assert.ok(await until(`(document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}]')||{dataset:{}}).dataset.rq!==window.__rq1`, 6000), `${at}: the row now holds the second request`);
        await js(`window.__stale.click()`);
        assert.ok(await until(`window.__ann.some(t=>/^Already answered/.test(t))||window.__perm.length>0`, 3000), `${at}: the stale press ends`);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: a stale button in the panel sends nothing (its request was answered, the card now holds another)`);
        assert.ok(await js(`window.__ann.some(t=>/^Already answered/.test(t))`), `${at}: and it is announced`);
        // a held key answers nothing
        await js(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] .ib-h').focus()`);
        for (const k of ['a', 's', 'd', 'Enter']) await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(k)},repeat:true,bubbles:true,cancelable:true}))`);
        await ctx.sleep(300);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: a held A, S, D or Enter in the panel answers nothing`);
        await clean();
      }

      // ---- FR-199: Open steps the panel aside, Back to the office returns it (review finding 6) ----
      {
        const X = await live(0);
        await perm(X, 'sa1-' + w, 'Run it');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000));
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="open"]')`, 4000));
        await js(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="open"]').click()`);
        assert.ok(await until(`document.body.classList.contains('panel-open')&&!document.getElementById('needsPanel')`, 4000), `${at}: Open shows the chat and the panel steps aside`);
        assert.deepStrictEqual(await js(`[document.getElementById('inboxBtn').getAttribute('aria-controls'),document.getElementById('inboxBtn').getAttribute('aria-expanded')]`), [null, 'false'], `${at}: with no panel on screen the amber button controls nothing (no aria-controls to a missing element)`);
        await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
        await key('Escape', [], { char: 'never' });
        assert.ok(await until(`!document.body.classList.contains('panel-open')&&!!document.getElementById('needsPanel')`, 4000), `${at}: Back to the office returns the panel`);
        assert.deepStrictEqual(await js(`(()=>{document.getElementById('inboxClose').click();const b=document.getElementById('inboxBtn');return [b.getAttribute('aria-controls'),b.getAttribute('aria-expanded')]})()`), [null, 'false'], `${at}: the moment the panel closes the amber button controls nothing (aria-controls is removed with the panel)`); // dismissed: the next trip to a chat does not bring it back
        assert.ok(await until(`!document.getElementById('needsPanel')`, 3000));
        await clean();
      }

      // ---- FR-202, FR-203: it never opens over the key the person is on (review finding 4) ----
      {
        await ctx.sleep(Math.max(0, 10800 - (Date.now() - tOpen3))); // past the throttle of the last automatic opening
        await ctx.sleep(2200); // past COALESCE_MS of the dismissal that ended the step before
        await js(`(()=>{const i=document.createElement('input');i.id='drvUnder';i.style.cssText='position:fixed;right:24px;top:140px;width:160px;z-index:50';document.body.appendChild(i);i.focus();})()`);
        const E1 = await live(0);
        await perm(E1, 'ov1-' + w, 'Run under the panel');
        await ctx.sleep(1800);
        assert.strictEqual(await panelOpen(), false, `${at}: with focus under where the panel goes, a new request does not open it (FR-203)`);
        await js(`document.getElementById('drvUnder').remove()`);
        await idle(await live(1)); // any later change in the office gives the held opening its next look
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 8000), `${at}: once focus is elsewhere the held opening happens`);
        const tOpenE = Date.now();
        await clean();

        // ---- the gate's dismissal rule, wired (review finding 3): a request within COALESCE_MS of Close does not snap the panel back ----
        await ctx.sleep(Math.max(0, 10800 - (Date.now() - tOpenE)));
        const D1 = await live(1), D2 = await live(2);
        await ensureOpen();
        await js(`document.getElementById('inboxClose').click()`); // dismissed by the person
        await perm(D1, 'di1-' + w, 'Run right after Close');
        await ctx.sleep(1200);
        assert.strictEqual(await panelOpen(), false, `${at}: a new request within COALESCE_MS of a dismissal does not snap it back`);
        await ctx.sleep(1500); // past COALESCE_MS
        await perm(D2, 'di2-' + w, 'Run a while after Close');
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 6000), `${at}: after the coalescing window a new request reopens it`);
        await clean();
      }
    }
  }
  console.log('check-needs-panel passed');
};
