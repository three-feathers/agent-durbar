/*
 * Spec 097 FR-345..FR-348 (issue #1152): rearranging rooms, desks and places in Real office, by key and by the folder menu, on the one order
 * document of spec 033. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-order      (builds first)
 *
 * At 1440x900 and 1280x800, 15 agents in 3 folders, it fails (exit 1) when:
 *   - an order made in the flat office (Alt+arrows, Alt+Shift+arrows) is not what Real office shows: the saved order's desks left to right on the plates
 *     of that room, and a room the flat office moved is moved in the document Real office reads;
 *   - Alt+Left / Alt+Right on a focused plate does not move its desk one place, does not keep the focus on the plate, does not say "moved to position n of m",
 *     or an end of the room does not say "is already first";
 *   - Alt+Shift+arrows on a plate or a folder sign button does not move that room in the saved order;
 *   - the folder menu's Move earlier / Move later (the sign's ⋯ button) does nothing;
 *   - the keys on a lobby plate that is a button move a fixed place (Boss, coffee, Bank, Postbox) or fail to move a movable one;
 *   - the order made in Real office is not what the flat office shows after a reload;
 *   - after Reset a room is not sorted by status again (a status change in a kept room moves no desk: the layout test of T260);
 *   - in a fresh room with no saved order, Alt+Right on the first movable visible desk (the first that is not away) does not swap it with the next desk shown, or does not save the order on screen
 *     (source mutant: the attention order as the base; run with the app's reoStepModel reading `prio` order, it fails here);
 *   - an away desk or a lounge seat moves, or does not say it does not;
 *   - 15 desks do not all show, a plate's text is under 10.5 px, plates overlap, or the office scrolls.
 *   SHOTS_OUT=docs/screenshots writes the two full pictures (097-order-<w>x<h>.png; the crops in docs are made from them).
 *   source mutant (run by hand): the key path's away test back to `pl.classList.contains('narrow')` only: the arcade step fails
 *   ORDER_MUTANT=keys   Alt+arrows on a plate are swallowed before the app sees them (must fail)
 *   ORDER_MUTANT=menu   the menu's Move earlier / later is swallowed (must fail)
 */
const assert = require('assert');
const path = require('path');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.ORDER_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const OUT = process.env.SHOTS_OUT || process.env.SHOTS_097_ORDER || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, key } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const said = () => js(`document.getElementById('srAnnounce').textContent`);
  const saved = () => js(`window.__durbarSimUi.order.saved()`);
  /** the plates of one folder, left to right, then top to bottom (a folder's desks stand in one row) */
  const plates = (room) => js(`(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a.room]));return [...document.querySelectorAll('#stage .ro-plate[data-id]')].filter(p=>ag.get(p.dataset.id)===${jsLiteral(room)}&&p.dataset.surface!=='lounge').map(p=>{const r=p.getBoundingClientRect();return {id:p.dataset.id,x:r.left,y:r.top}}).sort((a,b)=>Math.round(a.y/10)-Math.round(b.y/10)||a.x-b.x).map(p=>p.id)})()`);
  const roomsOf = () => js(`[...document.querySelectorAll('#stage .room')].map(r=>({id:r.dataset.key.replace(/^room:/,''),desks:[...r.querySelectorAll('.unit > .desk[data-id]')].map(d=>d.dataset.id)}))`);
  const roomOf = (id) => js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).room`);
  const pathOf = (id) => js(`window.__durbarSimUi.order.path('room:'+${jsLiteral(id)})`);
  const focus = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.focus({preventScroll:true});return document.activeElement===e})()`);
  const checks = async (tag) => {
    assert.strictEqual(await js(`document.getElementById('stage').dataset.fit`), 'ok', `${tag}: the office fits, no scroll`);
    assert.strictEqual(await js(`new Set([...document.querySelectorAll('#stage .ro-plate[data-id]')].map(p=>p.dataset.id)).size`), 15, `${tag}: all 15 desks show`);
    assert.ok(await js(`Math.min(...[...document.querySelectorAll('#stage .ro-plate .ro-l1>b,#stage .ro-plate .ro-l2,#stage .ro-sign>b')].map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(n=>n>0))`) >= 10.5, `${tag}: plate and sign text at least 10.5 px`);
    const ov = await js(`(()=>{const r=[...document.querySelectorAll('#stage .ro-plate[data-id]')].map(p=>{const b=p.getBoundingClientRect();return [p.dataset.id,b.left,b.top,b.right,b.bottom]}),bad=[];for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];if(a[1]+1<b[3]&&b[1]+1<a[3]&&a[2]+1<b[4]&&b[2]+1<a[4])bad.push(a[0]+'/'+b[0])}return bad})()`);
    assert.deepStrictEqual(ov, [], `${tag}: no two plates overlap`);
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    /* ---- 0. a fresh room (no saved order): the first Alt+Right on the first desk shown swaps with the second desk shown (review of PR 1315, finding 1) ---- */
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: { officeview: 'real', simrooms: '3', sim: '15' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    assert.deepStrictEqual(await js(`window.__durbarSimUi.order.get().desks`), {}, `${tag}: a fresh office has no saved desk order`);
    const roomIds = await js(`[...new Set(window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.room))]`);
    let F = null, FP = [];
    for (const id of roomIds) { const l = await plates(id); if (l.length > FP.length) { F = id; FP = l; } }
    assert.ok(F && FP.length >= 3, `${tag}: a room with three desks (${FP})`);
    const fpath = await pathOf(F);
    const awayNow = await js(`[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id)`);
    const k0 = FP.findIndex((id, i) => !awayNow.includes(id) && i + 1 < FP.length);
    assert.ok(k0 >= 0, `${tag}: a desk at its seat with a desk after it (${FP}, away ${awayNow})`);
    const swapAt = (l, i) => { const c = l.slice(); [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; };
    assert.ok(await focus(`#stage .ro-plate[data-id="${FP[k0]}"]`), `${tag}: the plate takes the focus`);
    await key('Right', ['alt'], { char: 'never' });
    await must(`!!window.__durbarSimUi.order.get().desks[${jsLiteral(fpath)}]`, `${tag}: the first move saved an order (heard: ${await said()}; plates ${FP})`);
    assert.deepStrictEqual(await plates(F), swapAt(FP, k0), `${tag}: Alt+Right swapped the desk with the next desk shown (was ${FP}, now ${await plates(F)})`);
    assert.deepStrictEqual((await js(`window.__durbarSimUi.order.get().desks[${jsLiteral(fpath)}]`)).filter((i) => FP.includes(i)), swapAt(FP, k0), `${tag}: the saved order is the order on screen, with that swap`);
    await must(`document.activeElement&&document.activeElement.dataset.id===${jsLiteral(FP[k0])}`, `${tag}: the focus stays on the moved plate`);
    /* an away desk and a lounge seat do not move, and say so (findings 2, 4, 5) */
    const before = await saved();
    await js(`window.__durbarSimUi.crowd('library',1,${jsLiteral(0)})`);
    await must(`!!document.querySelector('#stage .ro-plate.narrow[data-id]')`, `${tag}: an agent is away at a place`);
    const awayId = await js(`document.querySelector('#stage .ro-plate.narrow[data-id]').dataset.id`);
    const awayRoom = await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(awayId)}).room`);
    const awayOrder = await plates(awayRoom);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    assert.ok(await focus(`#stage .ro-plate[data-id="${awayId}"]`), `${tag}: the away plate takes the focus`);
    await key('Right', ['alt'], { char: 'never' });
    await must(`/is away from its desk and does not move/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: an away desk says it does not move (heard: ${await said()})`);
    assert.deepStrictEqual(await plates(awayRoom), awayOrder, `${tag}: the away desk did not move`);
    const lounge = await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-surface="lounge"][data-id]');return p?p.dataset.id:''})()`);
    console.log('[097-order] ' + tag + ': lounge seat ' + (lounge || 'none at this size') + ', away desk ' + awayId);
    if (lounge) {
      assert.ok(await focus(`#stage .ro-plate[data-id="${lounge}"]`), `${tag}: the lounge plate takes the focus`);
      const rooms0 = (await saved()).rooms.join();
      await key('Right', ['alt', 'shift'], { char: 'never' });
      await must(`/resting in the lounge/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: Alt+Shift on a lounge seat says the room moves from a desk (heard: ${await said()})`);
      assert.strictEqual((await saved()).rooms.join(), rooms0, `${tag}: and no room moved`);
    }
    await js(`window.__durbarSimUi.uncrowd()`);
    assert.deepStrictEqual((await saved()).places, before.places, `${tag}: places untouched`);

    /* ---- 1. an order made in the flat office shows in Real office ---- */
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: { simrooms: '3' }, focus: true });
    const flat0 = await roomsOf();
    assert.ok(flat0.length >= 3 && flat0[0].desks.length >= 3, `${tag}: three flat rooms, the first with three desks (${JSON.stringify(flat0)})`);
    const A = flat0[0].id;
    /* the first desk (the attention order puts the one that waits first) goes to the end: an order that the status sort would undo */
    const n0 = flat0[0].desks.length;
    for (let i = 0; i < n0 - 1; i++) {
      assert.ok(await focus(`#stage .desk[data-id="${flat0[0].desks[0]}"]`), `${tag}: the flat desk takes the focus`);
      await key('Right', ['alt'], { char: 'never' });
      await must(`document.querySelectorAll(${jsLiteral('#stage .room[data-key="room:' + A + '"] .unit > .desk[data-id]')})[${jsLiteral(i)}].dataset.id!==${jsLiteral(flat0[0].desks[0])}`, `${tag}: the flat desk moved later (${i + 1})`);
    }
    await must(`window.__durbarSimUi.order.get().desks[window.__durbarSimUi.order.path('room:'+${jsLiteral(A)})]`, `${tag}: the flat office saved a desk order`);
    assert.ok(await focus(`#stage .room[data-key="room:${A}"] .desk[data-id]`), `${tag}: a flat desk of the room takes the focus`);
    await key('Right', ['alt', 'shift'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().rooms.length>=3`, `${tag}: the flat office saved a room order`);
    const flatDesks = (await roomsOf()).find((r) => r.id === A).desks;
    const doc1 = await saved();
    assert.notDeepStrictEqual(flatDesks, flat0[0].desks, `${tag}: the flat move changed the desk order`);
    await H.load({ w, h, query: { officeview: 'real', simrooms: '3', sim: '15' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    assert.deepStrictEqual(await js(`window.__durbarSimUi.order.get()`), doc1, `${tag}: Real office reads the document the flat office saved`);
    assert.deepStrictEqual(await plates(A), flatDesks, `${tag}: Real office shows the flat office's desk order, left to right (no status sort over it)`);
    await checks(`${tag} after the flat order`);

    /* ---- 2. a key on a plate moves its desk one place, the focus stays, the words are the flat office's ---- */
    const P = await plates(A), pa = await pathOf(A);
    if (MUTANT === 'keys') await js(`(()=>{window.addEventListener('keydown',e=>{if(e.altKey&&e.target.closest&&e.target.closest('.ro-plate'))e.stopImmediatePropagation()},true);return 1})()`);
    await must(`!!document.querySelector(${jsLiteral('#stage .ro-plate[data-id="' + P[2] + '"]')})`, `${tag}: the plate`);
    assert.ok(await focus(`#stage .ro-plate[data-id="${P[2]}"]`), `${tag}: the plate takes the focus`);
    await key('Left', ['alt'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}].filter(i=>${jsLiteral(P)}.includes(i)).join()===${jsLiteral([P[0], P[2], P[1], ...P.slice(3)].join())}`, `${tag}: Alt+Left saved the desk one place earlier`);
    await must(`document.activeElement&&document.activeElement.dataset.id===${jsLiteral(P[2])}`, `${tag}: the focus stays on the moved plate`);
    assert.deepStrictEqual((await plates(A)).slice(0, 3), [P[0], P[2], P[1]], `${tag}: the plate stands one place earlier`);
    await must(`new RegExp(${jsLiteral('moved to position 2 of ' + P.length + ' in its room')}).test(document.getElementById('srAnnounce').textContent)`, `${tag}: the flat office words (heard: ${await said()})`);
    await key('Right', ['alt'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}].filter(i=>${jsLiteral(P)}.includes(i)).join()===${jsLiteral(P.join())}`, `${tag}: Alt+Right moved it back`);
    await focus(`#stage .ro-plate[data-id="${P[0]}"]`);
    await key('Left', ['alt'], { char: 'never' });
    await must(`/is already first/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the first desk says it is already first`);
    assert.deepStrictEqual(await plates(A), P, `${tag}: and nothing moved`);
    await checks(`${tag} after the desk moves`);

    /* ---- 3. a room: Alt+Shift on a plate and on a sign button, and the folder menu ---- */
    const r0 = (await js(`window.__durbarSimUi.order.get().rooms`)).slice();
    assert.ok(r0.length >= 3, `${tag}: the saved room order lists the folders (${JSON.stringify(r0)})`);
    const swap = (l, i, j) => { const c = l.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; };
    const ia = r0.indexOf(pa);
    assert.ok(ia >= 1, `${tag}: the moved room is not first (${ia})`);
    await focus(`#stage .ro-plate[data-id="${P[0]}"]`);
    await key('Left', ['alt', 'shift'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().rooms.join()===${jsLiteral(swap(r0, ia, ia - 1).join())}`, `${tag}: Alt+Shift+Left on a plate moved its room one earlier`);
    await must(`document.activeElement&&document.activeElement.dataset.id===${jsLiteral(P[0])}`, `${tag}: the focus stays on the plate`);
    await must(`/moved to position \\d+ of \\d+\\./.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the room move is spoken`);
    const r1 = await js(`window.__durbarSimUi.order.get().rooms`);
    assert.ok(await focus(`#stage .ro-sb[data-foldermenu="${A}"]`), `${tag}: the sign's menu button takes the focus`);
    await key('Right', ['alt', 'shift'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().rooms.join()===${jsLiteral(swap(r1, r1.indexOf(pa), r1.indexOf(pa) + 1).join())}`, `${tag}: Alt+Shift+Right on a sign button moved its room one later`);
    await must(`document.activeElement&&document.activeElement.dataset.foldermenu===${jsLiteral(A)}`, `${tag}: the focus stays on the sign's button`);
    const r2 = await js(`window.__durbarSimUi.order.get().rooms`);
    if (MUTANT === 'menu') await js(`(()=>{document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#modeMenu [data-fact="rup"],#modeMenu [data-fact="rdn"]'))e.stopImmediatePropagation()},true);return 1})()`);
    await js(`document.querySelector(${jsLiteral('#stage .ro-sb[data-foldermenu="' + A + '"]')}).click()`);
    await must(`!!document.querySelector('#modeMenu [data-fact="rup"]')`, `${tag}: the folder menu has Move earlier in Real office`);
    const mn = await js(`[...document.querySelectorAll('#modeMenu [data-fact]')].map(e=>e.dataset.fact+':'+(e.getAttribute('aria-disabled')||''))`);
    const i2 = r2.indexOf(pa);
    assert.ok(mn.includes('rup:' + (i2 === 0 ? 'true' : '')) && mn.includes('rdn:' + (i2 === r2.length - 1 ? 'true' : '')), `${tag}: the items are disabled at the ends only (${mn} at ${i2} of ${r2.length})`);
    const way = i2 > 0 ? 'rup' : 'rdn', to = i2 > 0 ? i2 - 1 : i2 + 1;
    await js(`document.querySelector(${jsLiteral('#modeMenu [data-fact="' + way + '"]')}).click()`);
    await must(`window.__durbarSimUi.order.get().rooms.join()===${jsLiteral(swap(r2, i2, to).join())}`, `${tag}: the menu's ${way} moved the room in Real office`);
    assert.deepStrictEqual(await js(`window.__durbarSimUi.order.saved().then(d=>d.rooms)`), await js(`window.__durbarSimUi.order.get().rooms`), `${tag}: and it is the saved document`);
    await checks(`${tag} after the room moves`);

    /* ---- 4. places: a movable one moves, a fixed one does not (a lobby plate that is a button; none is at 15 agents, so one is made) ---- */
    await js(`(()=>{for(const id of ['library','boss']){const b=document.createElement('button');b.className='ro-lplate';b.dataset.place=id;b.id='tp-'+id;b.type='button';b.textContent=id;document.querySelector('#stage .ro-chrome').appendChild(b)}return 1})()`);
    const p0 = await js(`window.__durbarSimUi.order.get().places.join()`);
    await focus('#tp-boss');
    await key('Right', ['alt'], { char: 'never' });
    await ctx.sleep(200);
    assert.strictEqual(await js(`window.__durbarSimUi.order.get().places.join()`), p0, `${tag}: the Boss keeps its spot`);
    await focus('#tp-library');
    await key('Right', ['alt'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().places.length>=2&&window.__durbarSimUi.order.get().places.indexOf('library')===1`, `${tag}: a movable place moves one later`);
    await js(`document.querySelectorAll('#tp-library,#tp-boss').forEach(e=>e.remove())`);
    await shot(`${tag}`);

    /* ---- 5. an order made in Real office shows in the flat office; Reset gives the status order back ---- */
    const doc2 = await saved();
    await H.load({ w, h, query: { simrooms: '3' }, focus: true });
    const flat2 = await roomsOf();
    const paths = await Promise.all(flat2.map((r) => pathOf(r.id)));
    assert.deepStrictEqual(paths, paths.slice().sort((a, b) => doc2.rooms.indexOf(a) - doc2.rooms.indexOf(b)), `${tag}: the flat office draws the rooms in the order made in Real office (${JSON.stringify(doc2.rooms)} vs ${JSON.stringify(paths)})`);
    assert.deepStrictEqual(flat2.find((r) => r.id === A).desks, doc2.desks[pa].filter((id) => flat2.find((r) => r.id === A).desks.includes(id)), `${tag}: and the desks`);
    await H.load({ w, h, query: { officeview: 'real', simrooms: '3', sim: '15' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    await js(`window.__durbarSimUi.order.reset()`);
    await must(`window.__durbarSimUi.order.get().rooms.length===0`, `${tag}: Reset cleared the order`);
    await must(`document.querySelectorAll('#stage .ro-plate[data-id]').length>=15`, `${tag}: the plates are drawn again`);
    const auto = await plates(A);
    const rankOf = await js(`(()=>{const o={waiting:0,limit:0,error:1,working:2,thinking:2,done:3,idle:4,asleep:4};return Object.fromEntries([...document.querySelectorAll('#stage .ro-plate[data-id]')].map(p=>[p.dataset.id,o[p.dataset.state]]))})()`);
    assert.deepStrictEqual(auto.map((id) => rankOf[id]), auto.map((id) => rankOf[id]).sort((a, b) => a - b), `${tag}: with no saved order the room is sorted by status again (${auto.map((id) => rankOf[id])})`);
    await checks(`${tag} after Reset`);

    /* ---- the arcade (spec 102, review of PR 1315): its plates are never narrow, so an away desk is known by its visit; Alt+arrow on it says so and moves nothing ---- */
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: { officeview: 'real', simrooms: '3', sim: '15', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    await js(`window.__durbarSimUi.crowd('library',1,${jsLiteral(0)})`);
    await must(`window.__durbarSimUi.realLayout().zones.some(z=>z.desks.some(d=>d.away&&!d.lounge))`, `${tag}: an arcade agent is away`);
    const arcAway = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.away&&!d.lounge).id`);
    const arcRoom = await roomOf(arcAway), arcBefore = await plates(arcRoom), arcDoc = await saved();
    await js(`document.getElementById('srAnnounce').textContent=''`);
    assert.ok(await focus(`#stage .ro-plate[data-id="${arcAway}"]`), `${tag}: the away cabinet's plate takes the focus`);
    await key('Right', ['alt'], { char: 'never' });
    await must(`/is away from its desk and does not move/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: an away arcade desk says it does not move (heard: ${await said()})`);
    assert.deepStrictEqual(await plates(arcRoom), arcBefore, `${tag}: and nothing moved`);
    assert.deepStrictEqual(await saved(), arcDoc, `${tag}: and nothing was saved`);
    await js(`window.__durbarSimUi.uncrowd()`);
  }
  console.log('[097-order] ok');

  async function shot(t) { await H.shot(path.join(OUT, `097-order-${t}.png`), { tag: '097-order', what: t }); }
};
