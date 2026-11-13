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
 *   - spec 097 FR-366 (#1571): in the flat office, the Photo office and the arcade, three sessions that start needing you at one moment (a tie, oldest first), where
 *     the office order on screen differs from the session list's (one desk moved with Alt+Left), are not in the office order in the inbox or under the N key.
 *     Source mutants (run by hand): needsMeOrder reading `#stage .desk[data-id]` only, or the plates' node order (`#stage .ro-plate[data-id]`): the Photo office step fails
 *     ("FR-366: three that need you since one moment are in the office order on screen in the inbox"); the layout's order skipped in the arcade only: the arcade step fails the same way;
 *     the layout read without its "a Real office is drawn" guard (`const lay=RO_LAST`): the "photo, then flat" step (Photo office switched to Open office in the page) fails the same text.
 *   SHOTS_OUT=docs/screenshots writes the two full pictures (097-order-<w>x<h>.png; the crops in docs are made from them).
 *   source mutant (run by hand): the key path's away test back to `pl.classList.contains('narrow')` only: the arcade step fails
 *   ORDER_MUTANT=keys   Alt+arrows on a plate are swallowed before the app sees them (must fail)
 *   ORDER_MUTANT=menu   the menu's Move earlier / later is swallowed (must fail)
 *   ORDER_MUTANT=pinnoop   the simulator's pinAt does nothing but return true (must fail: the pinned desks never go away)
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
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + (typeof what === 'function' ? await what() : what));
  const said = () => js(`document.getElementById('srAnnounce').textContent`);
  const saved = () => js(`window.__durbarSimUi.order.saved()`);
  /** the plates of one folder, left to right, then top to bottom (a folder's desks stand in one row) */
  const plates = (room) => js(`(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a.room]));return [...document.querySelectorAll('#stage .ro-plate[data-id]')].filter(p=>ag.get(p.dataset.id)===${jsLiteral(room)}&&p.dataset.surface!=='lounge').map(p=>{const r=p.getBoundingClientRect();return {id:p.dataset.id,x:r.left,y:r.top}}).sort((a,b)=>Math.round(a.y/10)-Math.round(b.y/10)||a.x-b.x).map(p=>p.id)})()`);
  /** an until() expression: the plate `id` of `room` stands at place n (left to right) */
  const standsAt = (room, id, n) => `(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a.room]));return [...document.querySelectorAll('#stage .ro-plate[data-id]')].filter(p=>ag.get(p.dataset.id)===${jsLiteral(room)}&&p.dataset.surface!=='lounge').map(p=>{const r=p.getBoundingClientRect();return {id:p.dataset.id,x:r.left,y:r.top}}).sort((a,b)=>Math.round(a.y/10)-Math.round(b.y/10)||a.x-b.x).map(p=>p.id).indexOf(${jsLiteral(id)})===${n}})()`;
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
    /* who is away is the simulator's choice (an away desk is a narrow plate and does not move): every step picks from the plates that can move, never a fixed place in the row */
    const alreadyFirst = `/is already first/.test(document.getElementById('srAnnounce').textContent)`, focusExpr = `document.activeElement&&document.activeElement.dataset.id`;
    const walk = async (P, label) => {
      const awayExpr = `[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id)`, savedExpr = `window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]`;
      const awayA = await js(`[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id)`);
      const movable = P.map((id, i) => (awayA.includes(id) ? -1 : i)).filter((i) => i >= 0);
      const k = movable.find((i) => i >= 1);
      assert.ok(k !== undefined, `${tag}: a desk at its seat that is not first (${P}, away ${awayA})`);
      const swapAt2 = (l, i) => { const c = l.slice(); [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; };
      const savedDesks = (list) => `window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}].filter(i=>${jsLiteral(P)}.includes(i)).join()===${jsLiteral(list.join())}`;
      if (MUTANT === 'pinnoop') await js(`(()=>{window.__durbarSimUi.pinAt=()=>true;return 1})()`);
      if (MUTANT === 'keys') await js(`(()=>{window.addEventListener('keydown',e=>{if(e.altKey&&e.target.closest&&e.target.closest('.ro-plate'))e.stopImmediatePropagation()},true);return 1})()`);
      await must(`!!document.querySelector(${jsLiteral('#stage .ro-plate[data-id="' + P[k] + '"]')})`, `${tag}: the plate`);
      assert.ok(await focus(`#stage .ro-plate[data-id="${P[k]}"]`), `${tag}: the plate takes the focus`);
      await key('Left', ['alt'], { char: 'never' });
      await must(savedDesks(swapAt2(P, k - 1)), `${tag}: Alt+Left saved the desk one place earlier (plates ${P}, away ${awayA}, desk ${P[k]})`);
      await must(`document.activeElement&&document.activeElement.dataset.id===${jsLiteral(P[k])}`, `${tag}: the focus stays on the moved plate`);
      assert.deepStrictEqual(await plates(A), swapAt2(P, k - 1), `${tag}: the plate stands one place earlier`);
      await must(`new RegExp(${jsLiteral('moved to position ' + k + ' of ' + P.length + ' in its room')}).test(document.getElementById('srAnnounce').textContent)`, `${tag}: the flat office words (heard: ${await said()})`);
      await key('Right', ['alt'], { char: 'never' });
      await must(savedDesks(P), `${tag}: Alt+Right moved it back`);
      /* the first desk that can move walks to the front (each step is waited on), then one more key says it is already first; then it walks back */
      const m0 = movable[0];
      for (let i = m0; i > 0; i--) {
        assert.ok(await focus(`#stage .ro-plate[data-id="${P[m0]}"]`), `${tag}: the plate takes the focus`);
        await key('Left', ['alt'], { char: 'never' });
        await must(standsAt(A, P[m0], i - 1), `${tag}: the first movable desk walks to the front (${i})`);
      }
      const front = await plates(A);
      assert.strictEqual(front[0], P[m0], `${tag}: the first movable desk is first (${front}, away ${awayA})`);
      await js(`document.getElementById('srAnnounce').textContent=''`);
      assert.ok(await focus(`#stage .ro-plate[data-id="${P[m0]}"]`), `${tag}: the first plate takes the focus`);
      await key('Left', ['alt'], { char: 'never' });
      const diag = async () => [tag, label, 'heard now: ' + await said(), 'plates ' + await plates(A), 'away ' + await js(awayExpr), 'saved ' + await js(savedExpr), 'focus ' + await js(focusExpr)].join('; ');
      await must(alreadyFirst, async () => { const d = await diag(); console.log('[097-order] ' + d); return d + ' | the first desk says it is already first'; });
      assert.deepStrictEqual(await plates(A), front, `${tag}: and nothing moved`);
      for (let i = 0; i < m0; i++) {
        await key('Right', ['alt'], { char: 'never' });
        await must(standsAt(A, P[m0], i + 1), `${tag}: the desk walks back (${i + 1})`);
      }
      assert.deepStrictEqual(await plates(A), P, `${tag}: back where it was`);
    };
    /* the simulator sends agents away on its own clock (a visit shows after a 600 ms debounce and ends after a dwell), so the away set is read only once no visit is about to start
       or end, and the agents away then are pinned at their place (`crowd`: a pin is never ended by a tick or a tool event). The set cannot change during the walk. Released after it. */
    await must(`window.__durbarSimUi.visitsSettled()`, `${tag}: no visit is about to start or end`, 30000);
    {
      /* the visit record is the truth (a plate shows it a render later, which a loaded machine delays): read who is away from it, pin them by id, then wait for the plates to agree */
      const away1 = await js(`window.__durbarSimUi.awayIds()`);
      for (const id of away1) assert.ok(await js(`window.__durbarSimUi.pinAt(${jsLiteral(id)},'library')`), `${tag}: ${id} is pinned`);
      const narrowIds = `[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id).sort()`;
      await must(jsLiteral(away1.slice().sort().join()) + '===' + narrowIds + '.join()', async () => tag + ': the plates show the pinned away set (' + away1.slice().sort() + '; shown ' + await js(narrowIds) + ')');
      await walk(await plates(A), 'the away set the simulator made, pinned');
    }
    /* the case the simulator only sometimes makes, made every time: desks that are NOT away stand away at a place, put there by the pin (review of PR 1315, Paco: a pinAt that does nothing but return
       true must fail). Two desks that are not away are pinned, this room's first, then any other desk's: when the room's front is not away they are its first two desks (an away desk before the first desk that can
       move, which swaps past them and says already first only at the front of the whole room); when the simulator already had the front away, that case holds as well. Before the pin they are
       asserted NOT away (the plates and the visit record), after it away in both, so this step can never run without the pin. */
    {
      const P1 = await plates(A), awayNow = await js(`window.__durbarSimUi.awayIds()`), narrowNow = await js(`[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id)`);
      const everyone = await js(`[...document.querySelectorAll('#stage .ro-plate[data-id]:not(.lounge)')].map(p=>p.dataset.id)`);
      const notAway = (id) => !awayNow.includes(id) && !narrowNow.includes(id), inRoom = P1.filter(notAway), elsewhere = everyone.filter((id) => !P1.includes(id) && notAway(id));
      /* this room's desks first, but never its last desk that can move (the walk needs one), then any other desk */
      const free = [...inRoom.slice(0, Math.max(0, Math.min(2, inRoom.length - 1))), ...elsewhere].slice(0, 2);
      assert.strictEqual(free.length, 2, `${tag}: two desks that are not away to pin (room ${P1}; away ${awayNow})`);
      for (const id of free) assert.ok(!awayNow.includes(id) && !narrowNow.includes(id), `${tag}: ${id} is not away before the pin`);
      for (const id of free) assert.ok(await js(`window.__durbarSimUi.pinAt(${jsLiteral(id)},'library')`), `${tag}: ${id} is pinned`);
      await must(`${jsLiteral(free)}.every(id=>{const e=document.querySelector('#stage .ro-plate[data-id="'+id+'"]');return e&&e.classList.contains('narrow')})&&${jsLiteral(free)}.every(id=>window.__durbarSimUi.awayIds().includes(id))`, async () => tag + ': the pinned desks are away, in the plates and in the visit record (' + free + '; away ' + await js(`window.__durbarSimUi.awayIds()`) + ')');
      const P2 = await plates(A);
      assert.deepStrictEqual(P2, P1, `${tag}: pinning moves no desk in the row (${P1} / ${P2})`);
      await walk(P2, 'two more desks away, put there by the pin');
    }

    /* ---- 2b. Alt+arrows inside a text field do nothing in Real office (review of PR 1315, finding 3). No text field of the office sits on a plate, so a plain <input> is put inside a movable plate (the guard ahead of the Real branch is what is tested) ---- */
    {
      const nowP = await plates(A), nowAway = await js(`[...document.querySelectorAll('#stage .ro-plate.narrow[data-id]')].map(p=>p.dataset.id)`), holder = nowP.find((id) => !nowAway.includes(id)), doc = await saved(), orderBefore = await plates(A);
      await js(`(()=>{const pl=document.querySelector(${jsLiteral('#stage .ro-plate[data-id="' + holder + '"]')});const i=document.createElement('input');i.id='tp-field';i.type='text';i.value='hello world';pl.appendChild(i);const c=document.createElement('input');c.id='tp-control';c.type='text';c.value='hello world';document.body.appendChild(c);for(const e of [i,c]){e.__n=0;e.__prevented=0;e.__up=0;e.addEventListener('keydown',ev=>{e.__n++;if(ev.defaultPrevented)e.__prevented++});e.addEventListener('keyup',()=>{e.__up++})}return 1})()`);
      /* announce() writes the live region 60 ms late: wait for the last move's words to land, then compare against them (a stale write would otherwise look like a new one) */
      await must(`/moved to position/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the last move's words are in the live region`);
      const heard0 = await said();
      for (const [name, mods] of [['Up', ['alt']], ['Down', ['alt']], ['Left', ['alt']], ['Right', ['alt']]]) {
        /* the control sits outside the stage, so the app never handles it: whatever the platform's own editing does to the caret there is what the field in the plate must show too.
           sendInputEvent only queues the key: on a loaded machine it lands after key()'s pause, so the caret is read, and the focus moved on, only once this element has had the key's keyup
           (the last event of the press; a late key would otherwise reach the next element focused and be counted there) */
        const caretOf = async (id) => {
          const up0 = await js(`(()=>{const e=document.getElementById(${jsLiteral(id)});e.focus();e.setSelectionRange(5,5);return e.__up})()`);
          await key(name, mods, { char: 'never' });
          const upExpr = `document.getElementById(${jsLiteral(id)}).__up`;
          await must(upExpr + '===' + jsLiteral(up0 + 1), async () => tag + ': Alt+' + name + ' reached #' + id + ' (keyups ' + await js(upExpr) + ', before ' + up0 + ')');
          return js(`(()=>{const e=document.getElementById(${jsLiteral(id)});return [e.value,e.selectionStart,e.selectionEnd]})()`);
        };
        const want = await caretOf('tp-control'), got = await caretOf('tp-field');
        assert.deepStrictEqual(got, want, `${tag}: Alt+${name} in a text field in a plate leaves the text and caret as in any text field`);
        assert.strictEqual(got[0], 'hello world', `${tag}: Alt+${name} left the text`);
      }
      await js(`new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)))`);
      assert.strictEqual(await js(`(()=>{const e=document.getElementById('tp-field');return e.__n+'/'+e.__prevented})()`), '4/0', `${tag}: the keys reached the field and the app did not claim them`);
      assert.strictEqual(await said(), heard0, `${tag}: no announcement was made (heard: ${await said()}, before: ${heard0})`);
      assert.deepStrictEqual(await plates(A), orderBefore, `${tag}: no desk moved`);
      assert.deepStrictEqual(await saved(), doc, `${tag}: and nothing was saved`);
      await js(`document.querySelectorAll('#tp-field,#tp-control').forEach(e=>e.remove())`);
      await js(`window.__durbarSimUi.uncrowd()`); /* the pins end here: the away desks are the simulator's own again for the steps that do not depend on them */
    }
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
    await focus('#tp-library');
    await key('Right', ['alt'], { char: 'never' });
    await must(`window.__durbarSimUi.order.get().places.length>=2&&window.__durbarSimUi.order.get().places.indexOf('library')===1`, `${tag}: a movable place moves one later`);
    /* the Boss key came first and the library move after it has been seen, so the Boss's key was handled by now: nothing is waited out */
    assert.strictEqual(await js(`window.__durbarSimUi.order.get().places.indexOf('boss')`), p0.split(',').indexOf('boss'), `${tag}: the Boss keeps its spot`);
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

    /* ---- 6. spec 097 FR-366 (#1571): sessions that start needing you at one moment (a tie, oldest first) keep the office order on screen, in every world ---- */
    /* 'photo, then flat': the Photo office switched to Open office in the same page (Settings, Office layout; no reload), where Real office's last layout is still held: the flat desks' order must win */
    for (const [world, q] of [['flat', { simrooms: '3' }], ['photo', { officeview: 'real', simrooms: '3', sim: '15' }], ['arcade', { officeview: 'real', simrooms: '3', sim: '15', worldflags: 'retro', world: 'retro' }], ['photo, then flat', { officeview: 'real', simrooms: '3', sim: '15' }]]) {
      const switched = world === 'photo, then flat', loadReal = world !== 'flat', real = loadReal && !switched;
      const t = `${tag} ${world}`, card = real ? '.ro-plate' : '.desk';
      await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
      await H.load({ w, h, query: q, ...(loadReal ? { ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false } : {}), focus: true });
      if (loadReal) assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world||'photo'`), world === 'arcade' ? 'retro' : 'photo', `${t}: the world is shown`);
      if (switched) {
        await js(`window.DurbarScreens.openSettings();true`);
        await must(`!!document.querySelector('[data-officelayout="open"]')`, `${t}: Settings shows the office layout choice`);
        await js(`(()=>{document.querySelector('[data-officelayout="open"]').click();const c=document.getElementById('scrClose');if(c)c.click();return 1})()`);
        await must(`!document.querySelector('#stage .ro')&&document.querySelectorAll('#stage .desk[data-id]').length>=10&&!!window.__durbarSimUi.realLayout()`, `${t}: the flat office is drawn in the same page, Real office's last layout still held`);
      }
      /* the office order on screen, read apart from the code under test: Real office's own layout (rooms as drawn, desks left to right, lounge seats out), or the flat rooms' desks */
      const ORDER_NOW = real ? `window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.lounge).map(d=>d.id).filter((x,i,l)=>l.indexOf(x)===i)` : `[...document.querySelectorAll('#stage .room .unit > .desk[data-id]')].map(d=>d.dataset.id)`;
      const shown = () => js(ORDER_NOW);
      /* the simulator's mix of states differs from run to run and under load, so no pair is assumed: a desk is free when it is not waiting, in error, at its limit or, in Real office, away (those need you already, so they would not tie with the others, or they do not move), and the pair is chosen from the desks that are really free */
      const facts = await js(`(()=>{const ag=window.__durbarSimUi.agents().filter(a=>!a.parent);const away=${jsLiteral(real)}?window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.away).map(d=>d.id):[];return {list:ag.map(a=>a.id),room:Object.fromEntries(ag.map(a=>[a.id,a.room])),state:Object.fromEntries(ag.map(a=>[a.id,a.state+(a.limit?'+limit':'')])),away,busy:ag.filter(a=>a.state==='waiting'||a.state==='error'||a.limit).map(a=>a.id).concat(away)}})()`);
      const s0 = await shown(), free = (id) => !facts.busy.includes(id), li = (id) => facts.list.indexOf(id);
      /* two free desks of one room, the later in the session list shown after the earlier one with no away desk between them: the later one moves left past the others (Alt+Left), so the office order and the list's differ. The nearest such pair is taken; the first one found among equals */
      let k = -1, m = -1;
      for (let i = 0; i < s0.length; i++) for (let j = i + 1; j < s0.length; j++) {
        if (facts.room[s0[j]] !== facts.room[s0[i]]) break;
        if (facts.away.includes(s0[j])) break;
        if (free(s0[i]) && free(s0[j]) && li(s0[i]) < li(s0[j]) && (k < 0 || j - i < m - k)) { k = i; m = j; }
      }
      assert.ok(k >= 0, `${t}: two free desks of one room, the later in the list shown after the earlier, no away desk between (${s0}; state ${JSON.stringify(facts.state)}; away ${facts.away})`);
      const [b, a] = [s0[k], s0[m]];
      assert.ok(await focus(`#stage ${card}[data-id="${a}"]`), `${t}: ${a}'s card takes the focus`);
      for (let step = m - 1; step >= k; step--) {
        await key('Left', ['alt'], { char: 'never' });
        await must(`(${ORDER_NOW}).indexOf(${jsLiteral(a)})===${step}`, `${t}: Alt+Left moved ${a} to place ${step} (before ${b}); shown ${await shown()}`);
      }
      await must(`(${ORDER_NOW}).indexOf(${jsLiteral(a)})>=0&&(${ORDER_NOW}).indexOf(${jsLiteral(a)})<(${ORDER_NOW}).indexOf(${jsLiteral(b)})`, `${t}: Alt+Left put ${a} before ${b}`);
      if (real) { /* and on the picture: the moved desk's plate is now before the other's (left of it on its row, or a row higher) */
        const g = await js(`[${jsLiteral(a)},${jsLiteral(b)}].map(id=>{const r=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]').getBoundingClientRect();return [Math.round(r.top/20),r.left]})`);
        assert.ok(g[0][0] < g[1][0] || (g[0][0] === g[1][0] && g[0][1] < g[1][1]), `${t}: ${a}'s plate is drawn before ${b}'s (${JSON.stringify(g)})`);
      }
      const c = (await shown()).find((id) => free(id) && facts.room[id] !== facts.room[a]);
      assert.ok(c, `${t}: a free desk in another room`);
      const group = [a, b, c];
      const old = await inbox();
      /* one moment for all three: the page's clock is held while the three errors arrive, so they need you since the same time (a tie) */
      await js(`(()=>{const n=Date.now(),o=Date.now;Date.now=()=>n;try{for(const id of ${jsLiteral(group)})window.__durbarSimEmit({type:'status',status:'error',intent:'Stopped.',timestamp:n,sessionId:id});}finally{Date.now=o;}return 1})()`);
      await must(`${jsLiteral(group)}.every(id=>{const a=window.__durbarSimUi.agents().find(x=>x.id===id);return a&&a.state==='error'})`, `${t}: the three are in error`);
      let now = [];
      for (let i = 0; i < 20 && !group.every((id) => now.includes(id)); i++) now = await inbox();
      const s1 = await shown();
      const want = group.slice().sort((x, y) => s1.indexOf(x) - s1.indexOf(y));
      if (real) { /* the same order read from the picture alone, not from the layout the app reads: rooms by their folder sign (row band, then left), a room's desks by their plate (row band, then left) */
        const geo = await js(`(()=>{const ag=new Map(window.__durbarSimUi.agents().map(a=>[a.id,a.room])),band=y=>Math.round(y/40),pos=e=>{const r=e.getBoundingClientRect();return [band(r.top),r.left]},cmp=(p,q)=>p[0]-q[0]||p[1]-q[1];
          const sign=id=>pos([...document.querySelectorAll('#stage .ro-sign')].find(s=>s.dataset.folder===ag.get(id)));
          return ${jsLiteral(group)}.slice().sort((x,y)=>{const a=sign(x),b=sign(y);if(ag.get(x)!==ag.get(y))return cmp(a,b);return cmp(pos(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(x)+'"]')),pos(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(y)+'"]')));})})()`);
        assert.deepStrictEqual(geo, want, `${t}: the drawn plates and signs give the same office order as the layout (${geo} vs ${want})`);
      }
      assert.notDeepStrictEqual(want, group.slice().sort((x, y) => li(x) - li(y)), `${t}: the office order (${want}) differs from the session list's, so the step tells them apart`);
      assert.deepStrictEqual(now.filter((id) => !group.includes(id)), old, `${t}: the earlier ones keep their order`);
      assert.deepStrictEqual(now.slice(-3), want, `${t}: FR-366: three that need you since one moment are in the office order on screen in the inbox (${now.slice(-3)} vs ${want})`);
      /* the N key walks the same order (spec 052 FR-014): from the office the first, then each next one from its chat's title */
      for (let i = 0; i < now.length; i++) {
        await key('n', [], { char: 'always' });
        const nm = await nameOf(now[i]);
        await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle').textContent||'').trim()===${jsLiteral(nm)}`, `${t}: FR-366: N ${i + 1} opens ${now[i]} (${nm}), the inbox's order`);
      }
      await key('Escape'); await must(`!document.body.classList.contains('panel-open')`, `${t}: back to the office`);
    }
  }
  console.log('[097-order] ok');
  async function inbox() {
    await key('i', [], { char: 'always' });
    await must(`!!document.getElementById('inboxDlg')`, 'the inbox opens');
    const ids = await js(`[...document.querySelectorAll('#inboxDlg .inbox-row[data-id]')].map(r=>r.dataset.id)`);
    await key('Escape'); await must(`!document.getElementById('inboxDlg')`, 'the inbox closes');
    return ids;
  }
  async function nameOf(id) { return js(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}))||{}).name||''`); }

  async function shot(t) { await H.shot(path.join(OUT, `097-order-${t}.png`), { tag: '097-order', what: t }); }
};
