/*
 * Spec 097 FR-352..FR-355 (issue #1152; owner Q30..Q33 = 1, 2026-11-08): drag a desk by its name plate and a room by its folder sign in Real office,
 * the arcade's desks (not its rooms), and the lobby places by a visitor's chip button and the "+N" place menu, all on spec 033's one saved order.
 * Simulator only (no AI credits). Real mouse and key events (sendInputEvent); every wait is an until().
 *
 *   npm run check:ui -- --only check-097-drag      (builds first)
 *   SHOTS_OUT=<dir>   writes 097-drag-<w>x<h>.png (mid-drag) and 097-drag-done-<w>x<h>.png (after the drop), Photo office
 *   DRAG_MUTANT=menu    the place menu's Move earlier / later is swallowed (must fail)
 *   DRAG_MUTANT=away    the dragged desk's agent is sent to a place just before the status-change drag, as a late visit render did in CI (must fail:
 *                       "the drag started before the status change")
 *   Source mutants (threshold 6 px -> 0, Esc not cancelling, the drop not reaching reoApply, a room drag allowed in the arcade, the arcade swap going to the wrong
 *   neighbour, a fixed place moving, a fixed place's menu with Move items, the grab cursor removed, saveOrder returning before bridge.setOrder): each was applied
 *   to src/renderer, built, run under this driver and reverted; the failing assert of each is in the table in the PR #1394 comment "mutants run at ..." (2026-11-09).
 *
 * At 15 agents, 1440x900 and 1280x800, in the Photo office, the cave and the arcade, it fails (exit 1) when:
 *   - a drag of a plate onto its neighbour does not reorder and save the order the flat office then shows (Photo), does not say "moved to position n of m in its room",
 *     leaves the focus off the plate, or opens a chat;
 *   - a press that moves under 6 px is not a click (it opens the chat) or writes an order;
 *   - Escape in the middle of a drag leaves a plate lifted or moved, or writes;
 *   - a folder sign dragged onto another does not move that room in the saved order and the rows (Photo, cave);
 *   - in the arcade a room sign drags (or does not say it keeps its cell), or a plate does not swap with its neighbouring cabinet and save;
 *   - an away desk or a lounge seat drags;
 *   - plates overlap after a drop, the office scrolls, or text is under 10.5 px;
 *   - a status change in the middle of a drag breaks it (the drop still saves, after the repaint that waited); the drag is first asserted to have
 *     started (labelled "the drag started before the status change"), on a desk picked only once the drawn plates match the visit record (T297);
 *   - Alt+arrows on a visitor's chip button do not move a movable place, or move a fixed one (Boss, Bank), or lose the focus or the words;
 *   - a fixed place's "+N" menu has Move items, a movable one's lack their sub-line, or a drag start lacks the grab cursor (a desk's plate, a folder sign; not an arcade sign);
 *   - the drop does not save the order that is on screen (labelled: "the drop saved the new order");
 *   - the "+N" place menu lacks Move earlier / Move later, or they do not move the place on the one saved order (the flat office shows it).
 */
const assert = require('assert');
const path = require('path');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.DRAG_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const OUT = process.env.SHOTS_OUT || require('os').tmpdir();
const WORLDS = (process.env.DRAG_WORLDS || 'photo,cave,retro').split(',');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, key } = H;
  const { until } = waits(ctx);
  const wc = () => H.wc();
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const said = () => js(`document.getElementById('srAnnounce').textContent`);
  const saved = () => js(`window.__durbarSimUi.order.saved()`);
  const query = (world) => ({ officeview: 'real', simrooms: '3', sim: '15', ...(world === 'retro' ? { worldflags: 'retro', world: 'retro' } : world === 'cave' ? { worldflags: 'cave', world: 'cave' } : {}) });
  /* no visit about to start or end, and the drawn office matches the visit record: right after a load the plates can lag the record by a
     render, and a desk the stale layout shows at its seat is away by the press (an away desk does not drag: CI #1412, #1410, #1413; T297) */
  const settled = async () => {
    await must(`window.__durbarSimUi.visitsSettled()`, 'no visit about to start or end', 20000);
    await must(`(()=>{const U=window.__durbarSimUi,v=new Set(U.awayIds());return U.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.lounge).every(d=>!!d.away===v.has(d.id))})()`, 'the drawn desks match the visit record', 20000);
  };
  const load = async (w, h, world) => {
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: query(world), ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    await settled();
  };
  const mouse = (type, p, extra = {}) => wc().sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1, ...extra });
  /** press at `a`, move to `b` in steps (call `mid` with the button down), Escape first with `cancel`, release */
  const drag = async (a, b, { mid, cancel, steps = 8 } = {}) => {
    mouse('mouseMove', a); await ctx.sleep(30); mouse('mouseDown', a);
    for (let i = 1; i <= steps; i++) { mouse('mouseMove', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, { modifiers: ['leftButtonDown'] }); await ctx.sleep(25); }
    if (mid) await mid();
    if (cancel) { await key('Escape', [], { char: 'never' }); await ctx.sleep(40); }
    mouse('mouseUp', b); await ctx.sleep(80);
  };
  const center = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  const grab = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+Math.min(14,b.width/2),y:b.top+b.height/2}})()`);
  const plateSel = (id) => `#stage .ro-plate[data-id="${id}"]`;
  const signSel = (id) => `#stage .ro-sign[data-folder="${id}"]`;
  /** a room's desks as the layout draws them (the order a drag and the keys move in), lounge seats out */
  const orderOf = (room) => js(`window.__durbarSimUi.realLayout().zones.filter(z=>z.id===${jsLiteral(room)}).flatMap(z=>z.desks.filter(d=>!d.lounge).map(d=>d.id))`);
  const pathOf = (id) => js(`window.__durbarSimUi.order.path('room:'+${jsLiteral(id)})`);
  const swapAt = (l, i) => { const c = l.slice(); [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; };
  const awayIds = () => js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.away&&!d.lounge).map(d=>d.id)`);
  const roomOf = (id) => js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).room`);
  const signsInOrder = () => js(`[...document.querySelectorAll('#stage .ro-sign')].filter(s=>s.querySelector('.ro-sc')).map(s=>({id:s.dataset.folder,x:s.getBoundingClientRect().left,y:s.getBoundingClientRect().top})).sort((a,b)=>Math.abs(a.y-b.y)>4?a.y-b.y:a.x-b.x).map(s=>s.id)`);
  const lifted = () => js(`document.body.classList.contains('reo-dragging')`);
  const loose = () => js(`[...document.querySelectorAll('#stage .ro-plate,#stage .ro-sign')].filter(e=>e.style.transform||e.classList.contains('reo-lift')).length`);
  const panelOpen = () => js(`document.body.classList.contains('panel-open')`);
  const checks = async (tag) => {
    assert.strictEqual(await js(`document.getElementById('stage').dataset.fit`), 'ok', `${tag}: the office fits, no scroll`);
    assert.strictEqual(await js(`new Set([...document.querySelectorAll('#stage .ro-plate[data-id]')].map(p=>p.dataset.id)).size`), 15, `${tag}: all 15 desks show`);
    assert.ok(await js(`Math.min(...[...document.querySelectorAll('#stage .ro-plate .ro-l1>b,#stage .ro-plate .ro-l2,#stage .ro-sign>b')].map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(n=>n>0))`) >= 10.5, `${tag}: text at least 10.5 px`);
    const ov = await js(`(()=>{const r=[...document.querySelectorAll('#stage .ro-plate[data-id]')].map(p=>{const b=p.getBoundingClientRect();return [p.dataset.id,b.left,b.top,b.right,b.bottom]}),bad=[];for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];if(a[1]+1<b[3]&&b[1]+1<a[3]&&a[2]+1<b[4]&&b[2]+1<a[4])bad.push(a[0]+'/'+b[0])}return bad})()`);
    assert.deepStrictEqual(ov, [], `${tag}: no two plates overlap`);
  };
  const bigRoom = async () => {
    const away = await awayIds();
    const rooms = await js(`[...new Set(window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.room))]`);
    let best = null;
    for (const r of rooms) { const o = (await orderOf(r)); const k = o.findIndex((id, i) => i + 1 < o.length && !away.includes(id)); if (k >= 0 && o.length >= 3 && (!best || o.length > best.o.length)) best = { r, o, k }; }
    assert.ok(best, 'a room with three desks and a desk at its seat with a neighbour after it');
    return best;
  };

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await load(w, h, world);
    if (world !== 'photo') assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), world, `${tag}: the world is shown`);
    const { r: A, o: O, k } = await bigRoom();
    const pa = await pathOf(A);
    /* pointing shows the drag (the flat room head's grab): a plate and a folder sign where a drag starts, never an arcade room sign */
    const cur = (sel) => js(`getComputedStyle(document.querySelector(${jsLiteral(sel)})).cursor`);
    if (world !== 'retro') {
      assert.strictEqual(await cur(plateSel(O[k])), 'grab', `${tag}: a desk's plate shows the grab cursor`);
      assert.strictEqual(await cur(signSel(A)), 'grab', `${tag}: a folder sign shows the grab cursor`);
    } else assert.notStrictEqual(await cur(signSel(A)), 'grab', `${tag}: an arcade room sign does not promise a drag`);
    const docDesks = () => js(`window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]`);

    /* ---- a press under 6 px is a click: it opens the chat, and writes nothing ---- */
    const p0 = await grab(plateSel(O[k]));
    mouse('mouseMove', p0); await ctx.sleep(30); mouse('mouseDown', p0); await ctx.sleep(20);
    mouse('mouseMove', { x: p0.x + 3, y: p0.y + 2 }, { modifiers: ['leftButtonDown'] }); await ctx.sleep(30);
    assert.strictEqual(await lifted(), false, `${tag}: 3 px does not start a drag`);
    mouse('mouseUp', { x: p0.x + 3, y: p0.y + 2 });
    await must(`document.body.classList.contains('panel-open')`, `${tag}: a press under 6 px opens the chat like a click`);
    assert.strictEqual(await docDesks(), undefined, `${tag}: and writes no order`);
    await key('Escape', [], { char: 'never' });
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: the chat closes`);

    /* ---- Escape in the middle of a drag cancels: nothing lifted, nothing moved, nothing written ---- */
    const before = await saved();
    await drag(await grab(plateSel(O[k])), await center(plateSel(O[k + 1])), { cancel: true, mid: async () => { assert.strictEqual(await lifted(), true, `${tag}: the drag is on mid-way`); assert.ok(await loose() >= 2, `${tag}: the plate and its neighbours follow the pointer`); } });
    assert.strictEqual(await lifted(), false, `${tag}: Escape ends the drag`);
    assert.strictEqual(await loose(), 0, `${tag}: and nothing stays lifted or shifted`);
    assert.deepStrictEqual(await orderOf(A), O, `${tag}: the order is as it was`);
    assert.deepStrictEqual(await saved(), before, `${tag}: and nothing was written`);
    assert.strictEqual(await panelOpen(), false, `${tag}: and no chat opened`);

    /* ---- the drag: the first plate onto the second (the arcade: onto its neighbouring cabinet); shot mid-drag ---- */
    await js(`document.getElementById('srAnnounce').textContent=''`);
    await drag(await grab(plateSel(O[k])), await center(plateSel(O[k + 1])), {
      mid: async () => {
        assert.ok(await loose() >= 2, `${tag}: the plate is lifted and the others slide`);
        if (world === 'photo') require('fs').writeFileSync(path.join(OUT, `097-drag-crop-${w}x${h}.json`), JSON.stringify(await js(`(()=>{const r=[...document.querySelectorAll('#stage .ro-plate[data-id],#stage .ro-sign[data-folder=${jsLiteral(A)}]')].filter(e=>e.classList.contains('ro-sign')||${jsLiteral(O)}.includes(e.dataset.id)).map(e=>e.getBoundingClientRect());return {x:Math.min(...r.map(b=>b.left))-24,y:Math.min(...r.map(b=>b.top))-150,r:Math.max(...r.map(b=>b.right))+24,b:Math.max(...r.map(b=>b.bottom))+40}})()`)));
        if (world === 'photo') await H.shot(path.join(OUT, `097-drag-${w}x${h}.png`), { tag: '097-drag', what: `mid-drag ${w}x${h}`, prep: 'none', settle: false });
      },
    });
    await must(`(window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]||[]).filter(i=>${jsLiteral(O)}.includes(i)).join()===${jsLiteral(swapAt(O, k).join())}`, `${tag}: the drop saved the swap (order ${await docDesks()}, was ${O})`);
    const sv = await saved(), onScreen = await js(`window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]`);
    assert.ok(sv && sv.desks && Array.isArray(sv.desks[pa]), `${tag}: the drop saved the new order (nothing was saved: ${JSON.stringify(sv)})`);
    assert.deepStrictEqual(sv.desks[pa], onScreen, `${tag}: the drop saved the new order (the saved order equals the order on screen)`);
    assert.deepStrictEqual(sv.desks[pa].filter((i) => O.includes(i)), swapAt(O, k), `${tag}: it is the saved document`);
    await must(`new RegExp(${jsLiteral('moved to position ' + (k + 2) + ' of ' + O.length + ' in its room')}).test(document.getElementById('srAnnounce').textContent)`, `${tag}: the flat office's words (heard: ${await said()})`);
    await must(`document.activeElement&&document.activeElement.dataset.id===${jsLiteral(O[k])}`, `${tag}: the focus stays on the moved plate`);
    assert.deepStrictEqual(await orderOf(A), swapAt(O, k), `${tag}: the layout draws the new order`);
    assert.strictEqual(await panelOpen(), false, `${tag}: the drop opens no chat`);
    assert.strictEqual(await loose(), 0, `${tag}: nothing stays shifted`);
    await checks(`${tag} after the drop`);
    if (world === 'photo') { await ctx.sleep(700); await H.shot(path.join(OUT, `097-drag-done-${w}x${h}.png`), { tag: '097-drag', what: `after the drop ${w}x${h}`, prep: 'none', settle: false }); }
    if (world !== 'cave') { /* the flat office shows the same order */
      const doc = await saved();
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });
      const flat = await js(`(()=>{const r=document.querySelector('#stage .room[data-key="room:'+${jsLiteral(A)}+'"]');return r?[...r.querySelectorAll('.unit > .desk[data-id]')].map(d=>d.dataset.id):[]})()`);
      assert.deepStrictEqual(flat, doc.desks[pa].filter((i) => flat.includes(i)), `${tag}: the flat office shows the order the drag saved`);
      await H.load({ w, h, query: query(world), ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
      await settled();
    }

    /* ---- a status change in the middle of a drag does not break it ---- */
    const O2 = await orderOf(A), away2 = await awayIds(), k2 = O2.findIndex((id, i) => i + 1 < O2.length && !away2.includes(id)), docBefore = JSON.stringify(await js(`window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]||null`));
    if (MUTANT === 'away') { await js(`window.__durbarSimUi.pinAt(${jsLiteral(O2[k2])},'library')`); await must(`window.__durbarSimUi.realLayout().zones.some(z=>z.desks.some(d=>d.id===${jsLiteral(O2[k2])}&&d.away))`, 'the mutant desk is drawn away'); }
    await drag(await grab(plateSel(O2[k2])), await center(plateSel(O2[k2 + 1])), {
      mid: async () => {
        const on = await lifted(), awayNow = on ? [] : await js(`window.__durbarSimUi.awayIds()`);
        assert.strictEqual(on, true, `${tag}: the drag started before the status change (dragging ${O2[k2]}; away now: ${awayNow})`);
        await js(`window.__durbarSimUi.crowd('library',1,${jsLiteral(0)})`);
        await ctx.sleep(300);
        assert.strictEqual(await lifted(), true, `${tag}: a status change does not end the drag`);
        assert.ok(await loose() >= 2, `${tag}: and the plates stay where the drag put them (no repaint under it)`);
      },
    });
    await must(`JSON.stringify(window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]||null)!==${jsLiteral(docBefore)}`, `${tag}: the drop after the status change saved`);
    const O3 = await orderOf(A);
    assert.deepStrictEqual(O3.filter((i) => O2.includes(i)), swapAt(O2, k2), `${tag}: the order is the dropped one (${O2} -> ${O3})`);
    await js(`window.__durbarSimUi.uncrowd()`);
    await checks(`${tag} after the status change`);

    /* ---- an away desk does not drag; nor does a lounge seat ---- */
    await js(`window.__durbarSimUi.crowd('library',1,${jsLiteral(0)})`);
    await must(`window.__durbarSimUi.realLayout().zones.some(z=>z.desks.some(d=>d.away&&!d.lounge))`, `${tag}: an agent is away`);
    const awayId = (await awayIds())[0], saved1 = await saved();
    await drag(await grab(plateSel(awayId)), { x: (await center(plateSel(awayId))).x + 80, y: (await center(plateSel(awayId))).y }, { mid: async () => assert.strictEqual(await lifted(), false, `${tag}: an away desk does not drag`) });
    assert.deepStrictEqual(await saved(), saved1, `${tag}: and writes nothing`);
    const lounge = await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-surface="lounge"][data-id]');return p?p.dataset.id:''})()`);
    if (lounge) {
      await drag(await grab(plateSel(lounge)), { x: (await center(plateSel(lounge))).x + 80, y: (await center(plateSel(lounge))).y }, { mid: async () => assert.strictEqual(await lifted(), false, `${tag}: a lounge seat does not drag`) });
      assert.deepStrictEqual(await saved(), saved1, `${tag}: and writes nothing`);
    }
    await js(`window.__durbarSimUi.uncrowd()`);

    /* ---- rooms: a folder sign drags (not in the arcade, where the rooms keep their cells) ---- */
    const signs = await signsInOrder();
    assert.ok(signs.length >= 3, `${tag}: three folder signs (${signs})`);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    const rooms0 = (await saved()).rooms.join();
    if (world === 'retro') {
      await drag(await grab(signSel(signs[0])), await center(signSel(signs[1])), { mid: async () => assert.strictEqual(await lifted(), false, `${tag}: a folder sign does not drag in the arcade`) });
      assert.strictEqual((await saved()).rooms.join(), rooms0, `${tag}: no room moved`);
      await must(`/keeps its place in the arcade/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the sign says the rooms keep their cells (heard: ${await said()})`);
    } else {
      await drag(await grab(signSel(signs[0])), await center(signSel(signs[signs.length - 1])));
      await must(`window.__durbarSimUi.order.get().rooms.length>=3`, `${tag}: a sign drag saved a room order`);
      await must(`(()=>{const U=window.__durbarSimUi,ps=[...document.querySelectorAll('#stage .ro-sign')].filter(s=>s.querySelector('.ro-sc')).map(s=>({p:U.order.path('room:'+s.dataset.folder),x:s.offsetLeft,y:s.offsetTop})).sort((a,b)=>Math.abs(a.y-b.y)>4?a.y-b.y:a.x-b.x).map(s=>s.p);return ps.join()===U.order.get().rooms.filter(r=>ps.includes(r)).join()})()`, `${tag}: the rows draw the saved room order after the first drag (Q31)`);
      const s1 = await signsInOrder(), pathA = await pathOf(s1[0]);
      await js(`document.getElementById('srAnnounce').textContent=''`);
      await drag(await grab(signSel(s1[0])), await center(signSel(s1[1])));
      const want = s1.slice(); [want[0], want[1]] = [want[1], want[0]];
      await must(`window.__durbarSimUi.order.get().rooms.indexOf(${jsLiteral(pathA)})>window.__durbarSimUi.order.get().rooms.indexOf(${jsLiteral(await pathOf(s1[1]))})`, `${tag}: the sign moved its room one place later in the saved order`);
      await must(`/moved to position 2 of \\d+\\./.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the room's move is spoken (heard: ${await said()})`);
      assert.deepStrictEqual(await js(`window.__durbarSimUi.order.get().rooms`), (await saved()).rooms, `${tag}: and is the saved document`);
      await must(`(()=>{const s=[...document.querySelectorAll('#stage .ro-sign')].filter(s=>s.querySelector('.ro-sc')).map(s=>({id:s.dataset.folder,x:s.getBoundingClientRect().left,y:s.getBoundingClientRect().top})).sort((a,b)=>Math.abs(a.y-b.y)>4?a.y-b.y:a.x-b.x).map(s=>s.id);return s.join()===${jsLiteral(want.join())}})()`, `${tag}: the rows keep the saved order (Q31): ${want}, drawn ${await signsInOrder()}`);
      assert.strictEqual(await panelOpen(), false, `${tag}: no chat opened`);
    }
    await checks(`${tag} after the room moves`);

    /* ---- the lobby (Photo office): a chip button's Alt+arrows, the "+N" menu, a fixed place ---- */
    if (world === 'photo') {
      await js(`window.__durbarSimUi.crowd('library',1,${jsLiteral(0)})`);
      await must(`!!document.querySelector('#stage .ro-plate.narrow[data-id]')`, `${tag}: someone is at the library`);
      const visitor = await js(`document.querySelector('#stage .ro-plate.narrow[data-id]').dataset.id`);
      await js(`(()=>{const c=document.querySelector('#stage .ro-chrome');for(const [id,pl] of [['tp-chip-library','library'],['tp-chip-boss','boss']]){const b=document.createElement('button');b.type='button';b.id=id;b.className='ro-chip';b.dataset.pvopen=${jsLiteral(visitor)};b.dataset.place=pl;b.textContent=pl;c.appendChild(b)}const m=document.createElement('button');m.type='button';m.id='tp-more';m.className='ro-lplate';m.dataset.place='library';m.dataset.placemore='library';m.textContent='library +1';c.appendChild(m);return 1})()`);
      const places0 = await js(`window.__durbarSimUi.order.get().places.join()`);
      await js(`document.getElementById('srAnnounce').textContent=''`);
      await js(`document.getElementById('tp-chip-boss').focus()`);
      await key('Right', ['alt'], { char: 'never' });
      await must(`/is a fixed place and does not move/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: Alt+Right on a Boss chip says the place is fixed (heard: ${await said()})`);
      assert.strictEqual(await js(`window.__durbarSimUi.order.get().places.join()`), places0, `${tag}: the Boss keeps its spot`);
      await js(`document.getElementById('tp-chip-library').focus()`);
      await key('Right', ['alt'], { char: 'never' });
      await must(`window.__durbarSimUi.order.get().places.indexOf('library')===1`, `${tag}: Alt+Right on a chip button moved its place one later`);
      await must(`document.activeElement&&document.activeElement.id==='tp-chip-library'`, tag + ': the focus stays on the chip');
      await must(`/moved to position 2 of \\d+ in the lobby/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the flat office's words (heard: ${await said()})`);
      /* the menu */
      if (MUTANT === 'menu') await js(`(()=>{document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#modeMenu [data-pfact]'))e.stopImmediatePropagation()},true);return 1})()`);
      const idx = () => js(`window.__durbarSimUi.order.get().places.indexOf('library')`);
      const i1 = await idx();
      await js(`document.getElementById('tp-more').click()`);
      await must(`!!document.querySelector('#modeMenu [data-pfact="pup"]')&&!!document.querySelector('#modeMenu [data-pfact="pdn"]')`, `${tag}: the +N place menu has Move earlier and Move later`);
      assert.ok(await js(`Math.min(...[...document.querySelectorAll('#modeMenu [data-pfact] b')].map(e=>parseFloat(getComputedStyle(e).fontSize)))`) >= 10.5, `${tag}: menu text at least 10.5 px`);
      await js(`document.querySelector('#modeMenu [data-pfact="pup"]').click()`);
      await must(`window.__durbarSimUi.order.get().places.indexOf('library')===${jsLiteral(i1 - 1)}`, `${tag}: Move earlier moved the place (from ${i1})`);
      await js(`document.getElementById('tp-more').click()`);
      await must(`!!document.querySelector('#modeMenu [data-pfact="pdn"]')`, `${tag}: the menu opens again`);
      await js(`document.querySelector('#modeMenu [data-pfact="pdn"]').click()`);
      await must(`window.__durbarSimUi.order.get().places.indexOf('library')===${jsLiteral(i1)}`, `${tag}: Move later moved it back`);
      assert.deepStrictEqual((await saved()).places, await js(`window.__durbarSimUi.order.get().places`), `${tag}: and it is the saved document`);
      /* a fixed place's menu: the visitors only, no Move items (the folder menu's pattern; not dashed disabled ones); a movable place's items say what they do */
      await js(`window.__durbarSimUi.crowd('boss',1,1)`);
      await js(`(()=>{const m=document.createElement('button');m.type='button';m.id='tp-more-boss';m.className='ro-lplate';m.dataset.place='boss';m.dataset.placemore='boss';m.textContent='boss +1';document.querySelector('#stage .ro-chrome').appendChild(m);return 1})()`);
      await must(`window.__durbarSimUi.awayIds().length>=2`, `${tag}: someone is at the Boss too`);
      await js(`document.getElementById('modeMenu')&&document.getElementById('modeMenu').remove()`);
      await js(`document.getElementById('tp-more-boss').click()`);
      await must(`!!document.querySelector('#modeMenu [data-pvopen]')`, `${tag}: the Boss's +N menu opens`);
      assert.strictEqual(await js(`document.querySelectorAll('#modeMenu [data-pfact]').length`), 0, `${tag}: a fixed place's menu has no Move earlier / Move later`);
      await key('Escape');
      await must(`!document.getElementById('modeMenu')`, `${tag}: the Boss's menu closes`);
      await js(`document.getElementById('tp-more').click()`);
      await must(`!!document.querySelector('#modeMenu [data-pfact="pup"]')`, `${tag}: the library's menu opens`);
      assert.ok(await js(`[...document.querySelectorAll('#modeMenu [data-pfact]')].every(b=>!!b.querySelector('small')&&!!b.title)`), `${tag}: a movable place's Move items say what they do (a sub-line and a title)`);
      await key('Escape');
      await must(`!document.getElementById('modeMenu')`, `${tag}: the library's menu closes`);
      await js(`document.querySelectorAll('#tp-chip-library,#tp-chip-boss,#tp-more,#tp-more-boss').forEach(e=>e.remove())`);
      await js(`window.__durbarSimUi.uncrowd()`);
      await checks(`${tag} after the place moves`);
      const doc = await saved();
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });
      const flatPlaces = await js(`[...document.querySelectorAll('#stage .lobby .place[data-reo]')].map(p=>p.dataset.place)`);
      assert.deepStrictEqual(flatPlaces, doc.places.filter((i) => flatPlaces.includes(i)), `${tag}: the flat office shows the place order`);
    }
  }
  console.log('[097-drag] ok');
};
