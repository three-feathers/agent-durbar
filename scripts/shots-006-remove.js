/*
 * Spec 006 FR-022: removing a folder is easy to find. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-remove.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: the folder menu (the ⋯ button on a room header, or right-click) lists New session, Schedules, Rename…, Hide and Remove folder; Remove from
 * it removes the room after the confirmation (Cancel keeps it). With one agent per folder (simrooms=solo) the chat header
 * shows Remove folder, which removes that folder. Writes remove-folder-menu-<w>x<h>.png and remove-folder-chat-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  /* spec 021 FR-057 (review of #752): an assert waits on the condition it asserts, never on a fixed sleep */
  const until = async (expr, what) => { assert.ok(await ctx.waitFor(expr, 10000), 'timed out waiting for ' + what); };
  const menuItems = `[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent).length>=5`;
  const rooms = () => js(`[...document.querySelectorAll('#stage .room [data-door]')].map(d=>d.dataset.door)`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    const before = await rooms();
    const target = before[before.length - 1];
    const openMenu = `(()=>{const h=document.querySelector(${jsLiteral(`#stage .room [data-door="${target}"]`)}).closest('.room-head');const b=h.getBoundingClientRect();h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+10}));return true})()`;
    await js(openMenu); await until(menuItems, 'the folder menu');
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`);
    console.log('[006-rm]', w, 'menu', JSON.stringify(items));
    assert.deepStrictEqual(items, ['New session', 'Schedules', 'Rename…', 'Hide', 'Remove folder']);
    assert.ok(await js(`document.activeElement&&document.activeElement.closest('#modeMenu')!==null`), 'focus is in the menu');
    // the visible ⋯ button opens the same menu
    await js(`(document.getElementById('modeMenu')&&document.getElementById('modeMenu').remove(),true)`);
    await js(`document.querySelector(${jsLiteral(`#stage [data-foldermenu="${target}"]`)}).click()`); await until(menuItems, 'the folder menu from the ⋯ button');
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`), items, 'the ⋯ button opens the folder menu');
    await H.shot(path.join(OUT, `remove-folder-menu-${w}x${h}.png`), { prep: 'calm', delay: 200 });
    // Cancel keeps the room
    await js(`(window.confirm=()=>false,true)`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await until(`!document.getElementById('modeMenu')`, 'the menu to close after Cancel');
    assert.deepStrictEqual(await rooms(), before, 'Cancel keeps the folder');
    // Remove
    await js(openMenu); await until(menuItems, 'the folder menu again');
    await js(`(window.confirm=()=>true,true)`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await until(`document.querySelectorAll('#stage .room [data-door]').length===${before.length - 1}`, 'the folder to go');
    const after = await rooms();
    assert.ok(!after.includes(target) && after.length === before.length - 1, `the folder is removed (${before.length} -> ${after.length})`);
    // one agent per folder: Remove folder in the chat header
    await H.load({ query: { simrooms: 'solo' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=10` });
    const solo = await rooms();
    await js(`document.querySelector('#stage .desk[data-id]').click()`); await until(`!!document.getElementById('rmFolderBtn')`, 'the chat header');
    assert.ok(await js(`!!document.getElementById('rmFolderBtn')&&!document.getElementById('rmSessBtn')`), 'a single-session folder shows Remove folder, not Remove from office');
    await H.shot(path.join(OUT, `remove-folder-chat-${w}x${h}.png`), { prep: 'calm', delay: 200 });
    await js(`(window.confirm=()=>true,true)`);
    await js(`document.getElementById('rmFolderBtn').click()`); await until(`document.querySelectorAll('#stage .room [data-door]').length===${solo.length - 1}`, 'the folder to go from the chat header');
    const solo2 = await rooms();
    assert.strictEqual(solo2.length, solo.length - 1, `the folder is removed from the chat header (${solo.length} -> ${solo2.length})`);
  }
  console.log('[006-rm] PASS');
};
