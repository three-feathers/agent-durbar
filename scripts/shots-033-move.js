/*
 * Spec 033 FR-024 (issue #590): "Move to floor ▸" in the folder menu, with Undo. Simulator only (no AI credits, no login):
 *
 *   npm run build
 *   SHOTS_033=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-033-move.js xvfb-run -a npx electron . --no-sandbox
 *
 * Real key presses (sendInputEvent), at 1440x900 and 1280x800; exits non-zero on a miss:
 *   - the context-menu key on a room's door opens the folder menu; it has "Move to floor" after "Rename…";
 *   - Right arrow opens the floors (‹ Back first, every floor in order, the current one ticked and aria-disabled), Left arrow and
 *     Escape go back to the top level, focus on "Move to floor";
 *   - Enter on another floor moves the folder: its room carries the new floor's tag and every agent of that room is now in it
 *     (the agents follow); the action toast says "moved to" and has Undo; Undo moves the room and its agents back;
 *   - List view: a right-click on a row's Folder cell opens the same folder menu (for that row's folder);
 *   - one floor (no simfloors): the folder menu has no "Move to floor".
 * Screenshots: 033-move-menu-<w>x<h>.png (the floors level open), 033-move-toast-<w>x<h>.png (after the move, with Undo).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.SHOTS_033 || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle, key } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `033-${name}-${w}x${h}.png`), { tag: '033-move', what: `${name} ${w}x${h}` });
  const menu = () => js(`(()=>{const m=document.getElementById('modeMenu');if(!m)return null;const b=m.getBoundingClientRect();
    return {label:m.getAttribute('aria-label'),focus:document.activeElement&&document.activeElement.closest('#modeMenu')?(document.activeElement.dataset.fact+':'+(document.activeElement.dataset.floor||'')):null,
      items:[...m.querySelectorAll('[data-fact]')].map(e=>({fact:e.dataset.fact,floor:e.dataset.floor||'',b:(e.querySelector('b')||{}).textContent||'',checked:e.getAttribute('aria-checked'),disabled:e.getAttribute('aria-disabled')==='true',role:e.getAttribute('role')})),
      font:Math.min(...[...m.querySelectorAll('b,small')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      fits:b.top>=0&&b.left>=0&&b.bottom<=innerHeight&&b.right<=innerWidth}})()`);
  /* rooms in the office: name, floor tag and the agent ids at their desks (main agents only) */
  const rooms = () => js(`[...document.querySelectorAll('#stage .room')].map(r=>({id:(r.querySelector('[data-door]')||{dataset:{}}).dataset.door,name:r.querySelector('.room-name').textContent,
    floor:(r.querySelector('.floor-tag')||{}).textContent||null,agents:[...r.querySelectorAll('.desk[data-id]')].filter(d=>!d.closest('.helpers')).map(d=>d.dataset.id).sort()}))`);
  const openByKey = async (roomId) => {
    await js(`(()=>{const m=document.getElementById('modeMenu');if(m)m.remove();const d=document.querySelector(${jsLiteral(`#stage .room [data-door="${roomId}"]`)});d.focus();return true})()`);
    await key('Apps', [], { char: 'never', pause: 30 });
    // some platforms have no Apps key code in sendInputEvent: fall back to the event the key sends (keyboard contextmenu, no coordinates)
    if (!(await js(`!!document.getElementById('modeMenu')`))) await js(`document.activeElement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await until(`!!document.getElementById('modeMenu')`, 3000);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simfloors: '1' }, focus: true });
    await H.clearToasts();
    // spec 092: the office shows one floor at a time; this driver works on the first floor's screen and visits the others with PageUp
    const floorList = await H.floors();
    const floorsInOrder = floorList.map((f) => f.name);
    assert.ok(floorsInOrder.length >= 2, `simfloors has two or more floors on: ${floorsInOrder}`);
    assert.ok(await H.goToFloor(floorList[0].id), 'the first floor is shown');
    await settle();
    let rs = await rooms();
    // a room on the first floor with at least two agents, so "the agents follow" means something
    const room = rs.find((r) => r.floor === floorsInOrder[0] && r.agents.length >= 2) || rs.find((r) => r.floor === floorsInOrder[0]);
    assert.ok(room, 'a room on the first floor');
    const from = room.floor;
    console.log('[033-move]', w, 'room', room.name, 'on', from, 'agents', room.agents.length);

    // the folder menu from the keyboard: Move to floor after Rename…
    await openByKey(room.id);
    let m = await menu();
    const top = m.items.map((i) => i.b);
    console.log('[033-move]', w, 'menu', JSON.stringify(top));
    const iMove = top.indexOf('Move to floor');
    assert.ok(iMove > 0 && top[iMove - 1] === 'Rename…', `Move to floor comes after Rename…: ${top}`);
    assert.strictEqual(m.label, 'Folder ' + room.name);
    // ArrowDown to it, then Right arrow opens the floors
    for (let i = 0; i < iMove; i++) await key('Down', [], { char: 'never', pause: 20 });
    assert.strictEqual((await menu()).focus, 'floor:', 'focus on Move to floor');
    await key('Right', [], { char: 'never' });
    await until(`!!document.querySelector('#modeMenu [data-fact="back"]')`, 3000);
    m = await menu();
    console.log('[033-move]', w, 'floors', JSON.stringify(m.items.map((i) => `${i.b}${i.checked === 'true' ? '✓' : ''}${i.disabled ? '(disabled)' : ''}`)));
    assert.strictEqual(m.items[0].fact, 'back', '‹ Back first');
    const fl = m.items.slice(1);
    assert.ok(fl.length >= 2 && fl.every((i) => i.fact === 'to' && i.role === 'menuitemradio'), 'one radio item per floor');
    const cur = fl.filter((i) => i.checked === 'true');
    assert.ok(cur.length === 1 && cur[0].disabled && cur[0].b === from, `the current floor (${from}) is ticked and disabled`);
    assert.ok(fl.filter((i) => i.disabled).length === 1, 'only the current floor is disabled');
    assert.ok(m.font >= 10.5, `menu text at least 10.5px (${m.font})`);
    assert.ok(m.fits, 'the menu fits the window');
    assert.ok(m.focus && m.focus.startsWith('to:') && m.focus !== 'to:' + cur[0].floor, `focus on a floor that is not the current one (${m.focus})`);
    await shot('move-menu', w, h);
    // Left arrow back, Escape back: focus returns to Move to floor
    await key('Left', [], { char: 'never' });
    await until(`!document.querySelector('#modeMenu [data-fact="back"]')&&!!document.querySelector('#modeMenu [data-fact="floor"]')`, 3000);
    assert.strictEqual((await menu()).focus, 'floor:', 'Left arrow: back, focus on Move to floor');
    await key('Return', [], { pause: 50 });
    await until(`!!document.querySelector('#modeMenu [data-fact="back"]')`, 3000);
    await key('Escape', [], { char: 'never' });
    await until(`!document.querySelector('#modeMenu [data-fact="back"]')&&!!document.querySelector('#modeMenu [data-fact="floor"]')`, 3000);
    assert.strictEqual((await menu()).focus, 'floor:', 'Escape on the floors: back one level');
    await key('Right', [], { char: 'never' });
    await until(`!!document.querySelector('#modeMenu [data-fact="back"]')`, 3000);
    // move: Enter on the focused floor (the first one that is not the current one)
    const target = (await menu()).focus.slice(3);
    const targetName = fl.find((i) => i.floor === target).b;
    await key('Return', [], { pause: 50 });
    await until(`!document.getElementById('modeMenu')`, 3000);
    // spec 092 (FR-001, edge case "an agent's folder moves to another floor"): the room leaves the screen of the floor it was on; the user is not moved
    await until(`!document.querySelector(${jsLiteral(`#stage .room [data-door="${room.id}"]`)})`, 5000);
    await settle();
    assert.strictEqual(await H.shownFloor(), floorList[0].id, 'the user stays on the floor they were on');
    assert.ok(!(await rooms()).some((r) => r.id === room.id), 'the room left this floor screen');
    const toast = await js(`(()=>{const t=[...document.querySelectorAll('#toasts .toast.with-act')].pop();return t?{text:t.textContent,act:(t.querySelector('.toast-act')||{}).textContent}:null})()`);
    console.log('[033-move]', w, 'toast', JSON.stringify(toast));
    assert.ok(toast && toast.text.includes(room.name) && toast.text.includes('moved to') && toast.text.includes(targetName) && toast.act === 'Undo', 'the note names the folder and the floor, with Undo');
    await shot('move-toast', w, h);
    // the room is on the floor it was moved to (its agents followed), one PageUp away
    assert.ok(await H.goToFloor(target), 'the target floor is shown');
    await until(`!!document.querySelector(${jsLiteral(`#stage .room [data-door="${room.id}"]`)})`, 5000);
    await settle();
    rs = await rooms();
    const moved = rs.find((r) => r.id === room.id);
    assert.strictEqual(moved.floor, targetName, `the room is now on ${targetName}`);
    assert.deepStrictEqual(moved.agents, room.agents, 'its agents followed (same desks in the moved room)');
    // Undo: back to where it was, agents too (the room leaves this screen again, the user is not moved)
    await js(`[...document.querySelectorAll('#toasts .toast.with-act .toast-act')].pop().click()`);
    await until(`!document.querySelector(${jsLiteral(`#stage .room [data-door="${room.id}"]`)})`, 5000);
    assert.ok(await H.goToFloor(floorList[0].id), 'the first floor is shown again');
    await until(`!!document.querySelector(${jsLiteral(`#stage .room [data-door="${room.id}"]`)})`, 5000);
    await settle();
    rs = await rooms();
    const back = rs.find((r) => r.id === room.id);
    assert.strictEqual(back.floor, from, 'Undo: the room is back on its floor');
    assert.deepStrictEqual(back.agents, room.agents, 'Undo: its agents came back with it');
    await H.clearToasts();

    // List view: the Folder cell opens the folder menu
    await js(`document.getElementById('vList').click()`);
    await until(`!!document.querySelector('#list .lrow[data-id] .lfold')`, 3000);
    const lf = await js(`(()=>{const c=document.querySelector('#list .lrow[data-id] .lfold');const b=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+8,clientY:b.top+6}));return c.textContent})()`);
    await until(`!!document.getElementById('modeMenu')`, 3000);
    m = await menu();
    assert.strictEqual(m.label, 'Folder ' + lf, `List view: the Folder cell opens the folder menu of ${lf}`);
    assert.ok(m.items.some((i) => i.fact === 'floor'), 'List view: Move to floor is there');
    await key('Escape', [], { char: 'never' });
    await until(`!document.getElementById('modeMenu')`, 3000);
    await js(`document.getElementById('vOffice').click()`);
    console.log('[033-move]', w, 'ok');
  }
  // one floor: the menu is as before (no Move to floor)
  await H.load({ w: 1440, h: 900, focus: true });
  const r1 = (await rooms())[0];
  await openByKey(r1.id);
  const one = await menu();
  assert.ok(!one.items.some((i) => i.fact === 'floor'), `one floor: no Move to floor (${one.items.map((i) => i.b)})`);
  console.log('[033-move] all checks passed');
};
