/*
 * Spec 033 delta 2026-11-01 (issue #677): rearrange rooms, desks and places by drag and by keyboard. Simulator only (no AI credits, no login):
 *
 *   npm run build
 *   SHOTS_033=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-033-order.js xvfb-run -a npx electron . --no-sandbox
 *
 * Real mouse and key events (sendInputEvent), at 1440x900 and 1280x800, in the Open office and with cabins; exits non-zero on a miss:
 *   - dragging a room's header onto another room swaps them; during the drag nothing in the layout moves (only transform), the press-drag-release does
 *     not open a chat; the saved order (bridge.getOrder) lists the rooms; a reload keeps the order;
 *   - dragging a desk inside a room; Escape in the middle of a drag leaves everything as it was;
 *   - Alt+arrows move the focused desk and place, Alt+Shift+arrows the room, the folder menu has Move earlier / Move later, each says what it did
 *     (live region), the focus stays on the moved item; an end of the list says so; the palette resets the order;
 *   - a corrupt stored order is tolerated (the automatic order shows);
 *   - 15 agents still fit (data-fit ok), no rooms overlap, text at least 10.5px.
 * Notes: mouseMove needs modifiers ['leftButtonDown'] while the button is down (else buttons is 0 and the drag cancels); app.js is one IIFE, so page state
 *   is read through window.__durbarSimUi.order (get, saved, reset, path); the page does not repaint while a drag runs (DurbarReorder.busy()).
 * Screenshots: 033-order-drag-<w>x<h>.png (mid-drag), 033-order-done-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.SHOTS_033 || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle, key } = H;
  const wc = () => H.wc();
  const shot = (name, w, h) => H.shot(path.join(OUT, `033-${name}-${w}x${h}.png`), { tag: '033-order', what: `${name} ${w}x${h}` });
  const rooms = () => js(`[...document.querySelectorAll('#stage .room')].map(r=>({key:r.dataset.key,name:r.querySelector('.room-name').textContent,
    desks:[...r.querySelectorAll('.unit > .desk[data-id]')].map(d=>d.dataset.id)}))`);
  const places = () => js(`[...document.querySelectorAll('#stage .lobby .place')].map(p=>({id:p.dataset.place,reo:!!p.dataset.reo}))`);
  const center = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+Math.min(b.height/2,14)),r:[b.left,b.top,b.width,b.height]}})()`);
  const mouse = (type, p, extra = {}) => wc().sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1, ...extra });
  /** Press at `a`, move to `b` in steps, call `mid` while the button is still down, release (or Escape first with `cancel`). */
  const drag = async (a, b, { mid, cancel } = {}) => {
    mouse('mouseMove', a);
    await ctx.sleep(30);
    mouse('mouseDown', a);
    for (let i = 1; i <= 8; i++) {
      mouse('mouseMove', { x: Math.round(a.x + ((b.x - a.x) * i) / 8), y: Math.round(a.y + ((b.y - a.y) * i) / 8) }, { modifiers: ['leftButtonDown'] });
      await ctx.sleep(25);
    }
    if (mid) await mid();
    if (cancel) { await key('Escape', [], { char: 'never' }); await ctx.sleep(30); }
    mouse('mouseUp', b);
    await ctx.sleep(60);
  };
  const saidNow = () => js(`document.getElementById('srAnnounce').textContent`);
  const names = async () => (await rooms()).map((r) => r.name);
  const layoutSig = () => js(`[...document.querySelectorAll('#stage .room,#stage .unit,#stage .place')].map(e=>e.offsetLeft+','+e.offsetTop+','+e.offsetWidth+','+e.offsetHeight).join('|')`);
  const noOverlap = async () => {
    const rs = await js(`[...document.querySelectorAll('#stage .room')].map(r=>{const b=r.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]})`);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      assert.ok(a[2] <= b[0] + 1 || b[2] <= a[0] + 1 || a[3] <= b[1] + 1 || b[3] <= a[1] + 1, `rooms ${i} and ${j} overlap`);
    }
  };
  const fits = async () => {
    assert.strictEqual(await js(`document.getElementById('stage').dataset.fit`), 'ok', '15 agents fit');
    assert.strictEqual(await js(`document.querySelectorAll('#stage .desk[data-id]').length>=15`), true, 'all 15 desks are drawn');
    assert.ok(await js(`Math.min(...[...document.querySelectorAll('#stage .room-name,#stage .desk .name')].map(e=>parseFloat(getComputedStyle(e).fontSize)))`) >= 10.5, 'text at least 10.5px');
    await noOverlap();
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const signs of ['off', 'on']) {
      await js(`try{localStorage.setItem('durbar.doorsigns',${jsLiteral(signs)})}catch(e){}`);
      await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });
      await H.clearToasts();
      const tag = `${w} ${signs === 'off' ? 'open' : 'cabins'}`;
      let rs = await rooms();
      assert.ok(rs.length >= 3, `three rooms: ${rs.length}`);
      const first = rs.map((r) => r.name);
      console.log('[033-order]', tag, 'rooms', JSON.stringify(first));
      await fits();

      // ---- mouse: room header onto the next room's header; nothing in the layout moves during the drag ----
      const a = await center(`#stage .room[data-key="${rs[0].key}"] .room-name`);
      const b = await center(`#stage .room[data-key="${rs[1].key}"] .room-head`);
      assert.ok(a && b, 'room headers found');
      const before = await layoutSig();
      let during = null;
      await drag(a, { x: b.x, y: b.y }, {
        mid: async () => {
          during = await js(`(()=>{const l=document.querySelector('#stage .reo-lift');return {lift:!!l,tf:l&&l.style.transform,body:document.body.classList.contains('reo-dragging'),
            opened:document.body.classList.contains('panel-open')}})()`);
          during.same = (await layoutSig()) === before;
          if (signs === 'off') await shot('order-drag', w, h); // the lifted room and the sliding neighbour, button still down
        },
      });
      assert.ok(during && during.lift && during.body && /translate/.test(during.tf), `a lifted room follows the pointer by transform: ${JSON.stringify(during)}`);
      assert.ok(during.same, 'during a drag nothing in the layout (offset boxes) changed');
      assert.ok(await until(`(()=>{const n=[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent);return n[0]===${jsLiteral(first[1])}&&n[1]===${jsLiteral(first[0])}})()`), `the two rooms swapped: ${JSON.stringify(await names())}`);
      assert.strictEqual(await js(`document.body.classList.contains('panel-open')`), false, 'a drag does not open a chat');
      assert.strictEqual(await js(`document.querySelectorAll('.reo-lift,.reo-slot,.reo-dragging').length`), 0, 'drag classes are gone');
      assert.strictEqual(await js(`[...document.querySelectorAll('#stage .room,#stage .unit')].filter(e=>e.style.transform).length`), 0, 'no transform is left behind');
      await fits();
      const saved = await js(`window.__durbarSimUi.order.saved()`);
      assert.ok(saved && saved.rooms.length >= 2, `the order was saved: ${JSON.stringify(saved)}`);

      // ---- a reload keeps it; a stored order that is corrupt is tolerated ----
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });
      assert.deepStrictEqual((await names()).slice(0, 2), [first[1], first[0]], 'the order survives a reload');
      await js(`sessionStorage.setItem('durbar.simorder','{"rooms":5,"desks":[1,2],"places":{"a":1}}')`);
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });
      assert.deepStrictEqual(await names(), first, 'a corrupt stored order shows the automatic order');
      await js(`sessionStorage.removeItem('durbar.simorder')`);
      await H.load({ w, h, query: { simrooms: '3' }, focus: true });

      // ---- Escape in the middle of a drag changes nothing ----
      rs = await rooms();
      const a2 = await center(`#stage .room[data-key="${rs[0].key}"] .room-name`);
      const b2 = await center(`#stage .room[data-key="${rs[1].key}"] .room-head`);
      await drag(a2, b2, { cancel: true });
      assert.deepStrictEqual(await names(), first, 'Escape cancels the drag');
      assert.strictEqual(await js(`document.querySelectorAll('.reo-lift,.reo-slot').length`), 0);

      if (signs === 'on') continue; // the rest once per size, in the Open office

      // ---- a desk inside a room: drag the first desk onto the third ----
      rs = await rooms();
      const big = rs.find((r) => r.desks.length >= 3);
      assert.ok(big, 'a room with three desks');
      const d0 = await center(`#stage .room[data-key="${big.key}"] .unit > .desk[data-id="${big.desks[0]}"]`);
      const d2 = await center(`#stage .room[data-key="${big.key}"] .unit > .desk[data-id="${big.desks[2]}"]`);
      await drag(d0, d2);
      assert.ok(await until(`(()=>{const r=document.querySelector(${jsLiteral('#stage .room[data-key="' + big.key + '"]')});return [...r.querySelectorAll('.unit > .desk[data-id]')].map(d=>d.dataset.id)[2]===${jsLiteral(big.desks[0])}})()`),
        'the dragged desk took the third place');
      assert.strictEqual(await js(`document.body.classList.contains('panel-open')`), false, 'dragging a desk does not open its chat');
      const nowDesks = (await rooms()).find((r) => r.key === big.key).desks;
      assert.deepStrictEqual(nowDesks.slice().sort(), big.desks.slice().sort(), 'the same desks, only in another order');
      const savedDesks = (await js(`window.__durbarSimUi.order.saved()`)).desks[await js(`window.__durbarSimUi.order.path(${jsLiteral(big.key)})`)];
      assert.deepStrictEqual(savedDesks.filter((id) => nowDesks.includes(id)), nowDesks, `the desk order was saved (rolled-up desks keep a place in it): ${savedDesks}`);
      await fits();

      // ---- keyboard: Alt+Right on the focused desk, Alt+Shift+Left on its room, a place, the end of the list ----
      const focusDesk = (id) => js(`(()=>{const d=document.querySelector(${jsLiteral('#stage .desk[data-id="' + id + '"]')});d.focus();return document.activeElement===d})()`);
      assert.ok(await focusDesk(nowDesks[0]));
      await key('Right', ['alt'], { char: 'never' });
      assert.ok(await until(`[...document.querySelectorAll(${jsLiteral('#stage .room[data-key="' + big.key + '"] .unit > .desk[data-id]')})][1].dataset.id===${jsLiteral(nowDesks[0])}`), 'Alt+Right moved the desk one later');
      assert.strictEqual(await js(`document.activeElement.dataset.id`), nowDesks[0], 'the focus stays on the moved desk');
      assert.ok(await until(`/moved to position 2 of \\d+/.test(document.getElementById('srAnnounce').textContent)`), `it says what it did: ${await saidNow()}`);
      await key('Left', ['alt'], { char: 'never' });
      await key('Left', ['alt'], { char: 'never' });
      assert.ok(await until(`/already first/.test(document.getElementById('srAnnounce').textContent)`), `the start of the list says so: ${await saidNow()}`);
      const roomsBefore = await names();
      await key('Right', ['alt', 'shift'], { char: 'never' });
      assert.ok(await until(`document.querySelectorAll('#stage .room-name')[1].textContent===${jsLiteral(roomsBefore[0])}`), `Alt+Shift+Right moved the room: ${JSON.stringify(await names())}`);
      assert.strictEqual(await js(`document.activeElement.closest('.room')&&document.activeElement.closest('.room').querySelector('.room-name').textContent`), roomsBefore[0], 'the focus stayed in the moved room');
      // the folder menu
      await js(`document.querySelector(${jsLiteral('#stage .room[data-key="' + (await rooms())[1].key + '"] [data-foldermenu]')}).click()`);
      assert.ok(await until(`!!document.querySelector('#modeMenu [data-fact="rup"]')`), 'the folder menu has Move earlier');
      const mn = await js(`[...document.querySelectorAll('#modeMenu [data-fact]')].map(e=>e.dataset.fact+':'+(e.getAttribute('aria-disabled')||''))`);
      assert.ok(mn.includes('rup:') && mn.includes('rdn:'), `both menu items usable for a middle room: ${mn}`);
      await js(`document.querySelector('#modeMenu [data-fact="rup"]').click()`);
      assert.ok(await until(`document.querySelectorAll('#stage .room-name')[0].textContent===${jsLiteral(roomsBefore[0])}`), 'Move earlier from the menu');
      // places
      const ps = (await places()).filter((p) => p.reo);
      assert.ok(ps.length >= 2, `the lobby has places that can move: ${JSON.stringify(await places())}`);
      await js(`(()=>{const p=document.querySelector(${jsLiteral('#stage .place[data-place="' + ps[0].id + '"]')});p.focus()})()`);
      await key('Right', ['alt'], { char: 'never' });
      assert.ok(await until(`(()=>{const l=[...document.querySelectorAll('#stage .lobby .place[data-reo]')].map(p=>p.dataset.place);return l[1]===${jsLiteral(ps[0].id)}})()`), 'Alt+Right moved the place');
      assert.strictEqual((await places()).filter((p) => !p.reo).length >= 3, true, 'the Boss, coffee corner, Bank (and Postbox) stay fixed');
      // places by mouse
      // after the key press the order is [ps1, ps0, ...]: drag the first tile onto the second, so ps0 is first again
      const pa = await center(`#stage .place[data-place="${ps[1].id}"] .plh`);
      const pb = await center(`#stage .place[data-place="${ps[0].id}"] .plh`);
      if (pa && pb) {
        await drag(pa, pb);
        assert.ok(await until(`(()=>{const l=[...document.querySelectorAll('#stage .lobby .place[data-reo]')].map(p=>p.dataset.place);return l[0]===${jsLiteral(ps[0].id)}})()`), 'a place dragged onto another takes its spot');
      }
      await fits();
      await shot('order-done', w, h);

      // ---- reset from the palette ----
      await js(`window.__durbarSimUi.order.reset()`);
      assert.deepStrictEqual(await names(), first, 'Reset puts the automatic order back');
      assert.deepStrictEqual(await js(`window.__durbarSimUi.order.saved()`), { rooms: [], desks: {}, places: [] }, 'and saves it');
    }
  }
  console.log('[033-order] ok');
};
