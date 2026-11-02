/*
 * Spec 009 FR-019..FR-025 (issue #685, task T027): the chat header's Open with menu. Simulator only (stand-in bridge: nothing is launched, no credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-009-openwith.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800: the header button says Open with and is a menu button; the menu lists the stand-in editors and Show in folder,
 * says it opens the folder only and the conversation stays; text is 10.5px or more; the menu stays inside the window; arrows move, Esc closes
 * and returns focus; a choice gives a toast that says the conversation stays. Writes 009-openwith-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    await js(`document.querySelector('#stage .desk[data-id="sim-2"]').click()`);
    await ctx.waitFor(`!!document.getElementById('vscodeBtn')`, 8000);
    await ctx.waitFor(`document.querySelectorAll('#owItems [data-ow]').length>=1&&document.getElementById('vscodeBtn').textContent.includes('Open with')`, 8000);
    const b = await js(`(()=>{const b=document.getElementById('vscodeBtn');return {t:b.textContent.trim(),pop:b.getAttribute('aria-haspopup'),exp:b.getAttribute('aria-expanded')}})()`);
    assert.strictEqual(b.t, 'Open with', `${w}: button label`);
    assert.deepStrictEqual([b.pop, b.exp], ['menu', 'false']);
    await js(`document.getElementById('vscodeBtn').click()`);
    await ctx.waitFor(`!document.getElementById('openWithMenu').hidden`, 5000);
    const m = await js(`(()=>{const m=document.getElementById('openWithMenu'),r=m.getBoundingClientRect(),its=[...m.querySelectorAll('[role=menuitem]')];
      const fs=[...m.querySelectorAll('.ow-note,.more-it,.more-it small')].map(e=>parseFloat(getComputedStyle(e).fontSize));
      return {items:its.map(i=>i.querySelector('.mt').firstChild.textContent),note:document.getElementById('owNote').textContent,minFont:Math.min(...fs),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,focus:document.activeElement===its[0],exp:document.getElementById('vscodeBtn').getAttribute('aria-expanded')}})()`);
    console.log('[009-openwith]', w, JSON.stringify(m));
    assert.deepStrictEqual(m.items, ['VS Code', 'VSCodium', 'Show in folder']);
    assert.match(m.note, /folder only.*conversation stays here.*Continue in another app/);
    assert.ok(m.minFont >= 10.5, `${w}: text ${m.minFont}px`);
    assert.ok(m.inside, `${w}: menu inside the window`);
    assert.ok(m.focus && m.exp === 'true', `${w}: first item focused, expanded`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    assert.strictEqual(await js(`document.activeElement.querySelector('.mt').firstChild.textContent`), 'VSCodium', 'ArrowDown moves');
    await H.shot(path.join(OUT, `009-openwith-${w}x${h}.png`), { prep: 'calm', keepHover: true, delay: 300 });
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await js(`document.getElementById('openWithMenu').hidden&&document.activeElement===document.getElementById('vscodeBtn')`), 'Esc closes, focus back on the button');
    const slowList = () => js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owo||b.openWithTargets;b.__owo=o;window.__owDone=false;b.openWithTargets=async(i)=>{await new Promise(r=>setTimeout(r,250));const t=await o.call(b,i);setTimeout(()=>{window.__owDone=true;},0);return t;};})();0`);
    const hoverThenOpen = () => js(`(()=>{const v=document.getElementById('vscodeBtn');v.dispatchEvent(new PointerEvent('pointerenter'));v.click();window.__owFocus=document.activeElement;})();0`);
    /* the list arrives after the menu opened: it must not rebuild the menu under the focused item */
    await slowList(); await hoverThenOpen();
    assert.ok(await H.until(`window.__owDone===true`, 3000), `${w}: the late list came`);
    assert.strictEqual(await js(`window.__owFocus.isConnected&&window.__owFocus===document.activeElement&&!!window.__owFocus.dataset.ow`), true, `${w}: a late list does not rebuild an open menu`);
    await js(`window.__durbarSimUi.bridge().openWithTargets=window.__durbarSimUi.bridge().__owo;document.getElementById('openWithMenu').hidden||document.getElementById('vscodeBtn').click();0`);
    /* opened before the first list came: not an empty menu; it fills and the first item takes focus */
    await js(`document.getElementById('owItems').innerHTML='';0`);
    await slowList(); await hoverThenOpen();
    assert.ok(await H.until(`window.__owDone===true`, 3000), `${w}: the first list came`);
    assert.ok(await H.until(`document.activeElement&&document.activeElement.parentElement&&document.activeElement.parentElement.id==='owItems'`, 3000), `${w}: a first fill of an open menu focuses its first item`);
    assert.strictEqual(await js(`document.activeElement.dataset.ow`), 'vscode', `${w}: the first item`);
    assert.deepStrictEqual(await js(`[document.getElementById('owItems').getAttribute('role'),document.getElementById('owNote').getAttribute('role')]`), ['none', 'none'], `${w}: nothing but items in the menu's roles`);
    await js(`window.__durbarSimUi.bridge().openWithTargets=window.__durbarSimUi.bridge().__owo;document.getElementById('vscodeBtn').click();0`);
    await js(`document.getElementById('vscodeBtn').click()`);
    await ctx.waitFor(`!document.getElementById('openWithMenu').hidden`, 5000);
    await js(`document.querySelector('#openWithMenu [data-ow="folder"]').click()`);
    assert.ok(await H.until(`/Opening the folder/.test(document.getElementById('toasts').innerText)`, 5000), `${w}: the toast came`);
    const t = await js(`document.getElementById('toasts').innerText`);
    assert.match(t, /Opening the folder in your file manager.*conversation stays here/);
    assert.ok(!/Show in folder/.test(t), 'the toast names the file manager, not the menu item');
  }
  console.log('[009-openwith] PASS');
};
