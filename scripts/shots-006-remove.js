/*
 * Spec 006 FR-022: removing a folder is easy to find. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-remove.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: the folder menu (the ⋯ button on a room header, or right-click) lists New session, Rename, Hide and Remove folder; Remove from
 * it removes the room after the confirmation (Cancel keeps it). With one agent per folder (simrooms=solo) the chat header
 * shows Remove folder, which removes that folder. Writes remove-folder-menu-<w>x<h>.png and remove-folder-chat-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const rooms = () => js(`[...document.querySelectorAll('#stage .room [data-door]')].map(d=>d.dataset.door)`);
  const hideToasts = () => js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(800);
    const before = await rooms();
    const target = before[before.length - 1];
    const openMenu = `(()=>{const h=document.querySelector('#stage .room [data-door="${target}"]').closest('.room-head');const b=h.getBoundingClientRect();h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+10}));return true})()`;
    await js(openMenu); await ctx.sleep(300);
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`);
    console.log('[006-rm]', w, 'menu', JSON.stringify(items));
    assert.deepStrictEqual(items, ['New session', 'Rename…', 'Hide', 'Remove folder…']);
    assert.ok(await js(`document.activeElement&&document.activeElement.closest('#modeMenu')!==null`), 'focus is in the menu');
    // the visible ⋯ button opens the same menu
    await js(`(document.getElementById('modeMenu')&&document.getElementById('modeMenu').remove(),true)`);
    await js(`document.querySelector('#stage [data-foldermenu="${target}"]').click()`); await ctx.sleep(300);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`), items, 'the ⋯ button opens the folder menu');
    await hideToasts(); await ctx.sleep(200);
    await ctx.shot(path.join(OUT, `remove-folder-menu-${w}x${h}.png`));
    // Cancel keeps the room
    await js(`(window.confirm=()=>false,true)`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await ctx.sleep(500);
    assert.deepStrictEqual(await rooms(), before, 'Cancel keeps the folder');
    // Remove
    await js(openMenu); await ctx.sleep(300);
    await js(`(window.confirm=()=>true,true)`);
    await js(`document.querySelector('#modeMenu [data-fact="rm"]').click()`); await ctx.sleep(800);
    const after = await rooms();
    assert.ok(!after.includes(target) && after.length === before.length - 1, `the folder is removed (${before.length} -> ${after.length})`);
    // one agent per folder: Remove folder in the chat header
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simrooms: 'solo' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=10`, 15000);
    await ctx.sleep(800);
    const solo = await rooms();
    await js(`document.querySelector('#stage .desk[data-id]').click()`); await ctx.sleep(700);
    assert.ok(await js(`!!document.getElementById('rmFolderBtn')&&!document.getElementById('rmSessBtn')`), 'a single-session folder shows Remove folder, not Remove session');
    await hideToasts(); await ctx.sleep(200);
    await ctx.shot(path.join(OUT, `remove-folder-chat-${w}x${h}.png`));
    await js(`(window.confirm=()=>true,true)`);
    await js(`document.getElementById('rmFolderBtn').click()`); await ctx.sleep(900);
    const solo2 = await rooms();
    assert.strictEqual(solo2.length, solo.length - 1, `the folder is removed from the chat header (${solo.length} -> ${solo2.length})`);
  }
  console.log('[006-rm] PASS');
};
