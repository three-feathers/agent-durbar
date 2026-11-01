/*
 * Spec 006 FR-022: removing a folder is easy to find. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-remove.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: the folder menu (the ⋯ button on a room header, or right-click) lists New session, Schedules here, Notes (N)…, Rename…, MCP extras…, Cost, Hide and Remove folder; Remove from
 * it removes the room after the confirmation, the app's own dialog with Cancel focused (Cancel keeps it; spec 083 T034b). With one agent per folder (simrooms=solo) the chat header
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
    /* the Notes item reads 'Notes…' until the count arrives, then 'Notes (N)…': both are one token, the order stays strict */
    const normNotes = t => t.replace(/^Notes(?: \(\d+\))?…$/, 'Notes (N)…');
    assert.ok(normNotes('Notes…') === 'Notes (N)…' && normNotes('Notes (3)…') === 'Notes (N)…' && normNotes('Notes (0)…') === 'Notes (N)…' && normNotes('Rename…') === 'Rename…', 'both Notes forms normalise to one token');
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`);
    console.log('[006-rm]', w, 'menu', JSON.stringify(items));
    assert.deepStrictEqual(items.map(normNotes), ['New session', 'Schedules here', 'Notes (N)…', 'Rename…', 'MCP extras…', 'Cost', 'Hide', 'Remove folder']);
    assert.ok(await js(`document.activeElement&&document.activeElement.closest('#modeMenu')!==null`), 'focus is in the menu');
    // the visible ⋯ button opens the same menu
    await js(`(document.getElementById('modeMenu')&&document.getElementById('modeMenu').remove(),true)`);
    await js(`document.querySelector(${jsLiteral(`#stage [data-foldermenu="${target}"]`)}).click()`); await until(menuItems, 'the folder menu from the ⋯ button');
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`), items, 'the ⋯ button opens the folder menu');
    await H.shot(path.join(OUT, `remove-folder-menu-${w}x${h}.png`), { prep: 'calm', delay: 200 });
    // Cancel keeps the room
    // spec 083 T034b: the question is the app's own dialog (askDialog), Cancel focused
    const answer = async (label, what) => { await until(`!!document.querySelector('#modeDlg .dbtn')`, `the Remove folder dialog (${what})`); assert.strictEqual(await js(`(document.activeElement||{}).textContent`), 'Cancel', `Cancel is focused (${what})`); await js(`[...document.querySelectorAll('#modeDlg .dbtn button')].find(b=>b.textContent===${jsLiteral(label)}).click()`); await until(`!document.getElementById('modeDlg')`, `the dialog to close (${what})`); };
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await until(`!document.getElementById('modeMenu')`, 'the menu to close');
    await answer('Cancel', 'Cancel');
    assert.deepStrictEqual(await rooms(), before, 'Cancel keeps the folder');
    // Remove
    await js(openMenu); await until(menuItems, 'the folder menu again');
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await answer('Remove folder', 'Remove'); await until(`document.querySelectorAll('#stage .room [data-door]').length===${jsLiteral(before.length - 1)}`, 'the folder to go');
    const after = await rooms();
    assert.ok(!after.includes(target) && after.length === before.length - 1, `the folder is removed (${before.length} -> ${after.length})`);
    // one agent per folder: Remove folder in the chat header
    await H.load({ query: { simrooms: 'solo' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=10` });
    const solo = await rooms();
    await js(`document.querySelector('#stage .desk[data-id]').click()`); await until(`!!document.getElementById('rmFolderBtn')`, 'the chat header');
    assert.ok(await js(`!!document.getElementById('rmFolderBtn')&&!document.getElementById('rmSessBtn')`), 'a single-session folder shows Remove folder, not Remove from office');
    await H.shot(path.join(OUT, `remove-folder-chat-${w}x${h}.png`), { prep: 'calm', delay: 200 });
    await js(`document.getElementById('rmFolderBtn').click()`); await answer('Remove folder', 'the chat header'); await until(`document.querySelectorAll('#stage .room [data-door]').length===${jsLiteral(solo.length - 1)}`, 'the folder to go from the chat header');
    const solo2 = await rooms();
    assert.strictEqual(solo2.length, solo.length - 1, `the folder is removed from the chat header (${solo.length} -> ${solo2.length})`);
  }
  console.log('[006-rm] PASS');
};
