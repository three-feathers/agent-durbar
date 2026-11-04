/*
 * Spec 009 FR-019..FR-025 (issue #685, task T027): the chat header's Open with menu. Simulator only (stand-in bridge: nothing is launched, no credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-009-openwith.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800: the header button says Open with and is a menu button; the menu lists the stand-in editors and Show in folder,
 * says it opens the folder only and the conversation stays (and names Continue in another app… only when More has it); text is 10.5px
 * or more; the menu stays inside the window; arrows move, Esc closes and returns focus; the list is asked again on focus and keys, at most
 * once in OW_REFETCH_MS; a choice gives a toast that says the conversation stays, with main's note, escaped; an error toast is escaped;
 * a keyboard choice puts focus back on the button; a demo agent has a plain button and no menu. Writes 009-openwith-<w>x<h>.png.
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
    assert.match(m.note, /^Opens this folder only\. Your conversation stays here\./);
    assert.strictEqual(/Continue in another app/.test(m.note), await js(`!!document.getElementById('handoverBtn')`), `${w}: the note names Continue in another app… only when More has it`);
    assert.ok(m.minFont >= 10.5, `${w}: text ${m.minFont}px`);
    assert.ok(m.inside, `${w}: menu inside the window`);
    assert.ok(m.focus && m.exp === 'true', `${w}: first item focused, expanded`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    assert.ok(await H.until(`(()=>{const e=document.activeElement,t=e&&e.querySelector('.mt');return !!t&&t.firstChild.textContent==='VSCodium'})()`, 3000), `${w}: ArrowDown moves`);
    await H.shot(path.join(OUT, `009-openwith-${w}x${h}.png`), { prep: 'calm', keepHover: true, delay: 300 });
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await H.until(`document.getElementById('openWithMenu').hidden&&document.activeElement===document.getElementById('vscodeBtn')`, 3000), `${w}: Esc closes, focus back on the button`);
    /* a keyboard or screen-reader user gets a fresh list too (focus, a key that opens), and a burst asks main once (each list is a PATH scan) */
    const count = () => js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owc||b.openWithTargets;b.__owc=o;window.__owN=0;b.openWithTargets=async(i)=>{window.__owN++;return o.call(b,i);};document.getElementById('owItems').dataset.owAt='-1e12';})();0`);
    await count();
    await js(`document.getElementById('vscodeBtn').dispatchEvent(new FocusEvent('focus'));0`); /* the focus event itself: under xvfb the window may not have the system focus */
    assert.ok(await H.until(`window.__owN>=1`, 3000), `${w}: focus asks for a fresh list`);
    await js(`(()=>{const v=document.getElementById('vscodeBtn');for(let i=0;i<5;i++){v.dispatchEvent(new FocusEvent('focus'));v.dispatchEvent(new PointerEvent('pointerenter'));v.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}})();0`);
    await ctx.sleep(300); /* a bound on what must NOT happen (no more calls), not a wait for something to happen */
    assert.strictEqual(await js(`window.__owN`), 1, `${w}: a burst of focus, hovers and keys asks main once`);
    await js(`document.getElementById('owItems').dataset.owAt='-1e12';document.getElementById('vscodeBtn').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));0`);
    assert.ok(await H.until(`window.__owN>=2`, 3000), `${w}: a key that opens the menu asks again once the wait is over`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.openWithTargets=b.__owc;const m=document.getElementById('openWithMenu');if(!m.hidden)m.querySelector('[data-ow]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})();0`);
    assert.ok(await H.until(`document.getElementById('openWithMenu').hidden`, 3000), `${w}: closed again`);
    const slowList = () => js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owo||b.openWithTargets;b.__owo=o;window.__owDone=false;b.openWithTargets=async(i)=>{await new Promise(r=>setTimeout(r,250));const t=await o.call(b,i);setTimeout(()=>{window.__owDone=true;},0);return t;};})();0`);
    const hoverThenOpen = () => js(`(()=>{const v=document.getElementById('vscodeBtn');v.dispatchEvent(new PointerEvent('pointerenter'));v.click();window.__owFocus=document.activeElement;})();0`);
    /* the list arrives after the menu opened: it must not rebuild the menu under the focused item */
    await js(`document.getElementById('owItems').dataset.owAt='-1e12';0`); /* past the wait, so the hover asks */
    await slowList(); await hoverThenOpen();
    assert.ok(await H.until(`window.__owDone===true`, 3000), `${w}: the late list came`);
    assert.strictEqual(await js(`window.__owFocus.isConnected&&window.__owFocus===document.activeElement&&!!window.__owFocus.dataset.ow`), true, `${w}: a late list does not rebuild an open menu`);
    await js(`window.__durbarSimUi.bridge().openWithTargets=window.__durbarSimUi.bridge().__owo;document.getElementById('openWithMenu').hidden||document.getElementById('vscodeBtn').click();0`);
    /* a changed list under an open menu (an editor installed meanwhile): rebuilt, and the focus stays on the same target */
    await js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owo;b.openWithTargets=async(i)=>{const t=await o.call(b,i);return [t[0],{id:'vscode-insiders',label:'VS Code Insiders',hint:'Opens this folder in VS Code Insiders'},...t.slice(1)];};document.getElementById('vscodeBtn').click();})();0`);
    assert.ok(await H.until(`!document.getElementById('openWithMenu').hidden&&document.activeElement.dataset.ow==='vscode'`, 3000), `${w}: open on the first item`);
    await js(`(()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.getElementById('owItems').dataset.owAt='-1e12';document.getElementById('vscodeBtn').dispatchEvent(new PointerEvent('pointerenter'));})();0`);
    assert.ok(await H.until(`document.querySelectorAll('#owItems [data-ow]').length===4`, 3000), `${w}: the changed list came`);
    assert.strictEqual(await js(`document.activeElement.dataset.ow`), 'vscodium', `${w}: the focus stays on the same target after a rebuild`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.openWithTargets=b.__owo;document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const it=document.getElementById('owItems');it.dataset.owAt='-1e12';})();0`);
    assert.ok(await H.until(`document.getElementById('openWithMenu').hidden`, 3000), `${w}: closed`);
    await js(`document.getElementById('vscodeBtn').dispatchEvent(new PointerEvent('pointerenter'));0`);
    assert.ok(await H.until(`document.querySelectorAll('#owItems [data-ow]').length===3`, 3000), `${w}: back to the simulator's list`);
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
    assert.match(t, /Opening the folder in your file manager.*conversation stays here.*This folder is a link, so its real folder was opened\./, `${w}: main's note after the usual text`);
    assert.ok(!/Show in folder/.test(t), 'the toast names the file manager, not the menu item');
    /* a keyboard choice: the item's menu closes and the button is busy for the call, then focus is back on the button */
    await H.clearToasts();
    await js(`document.getElementById('vscodeBtn').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));0`);
    assert.ok(await H.until(`!document.getElementById('openWithMenu').hidden&&!!document.activeElement.dataset.ow`, 3000), `${w}: ArrowDown opens on an item`);
    await js(`(()=>{const its=[...document.querySelectorAll('#owItems [data-ow]')];its.find(i=>i.dataset.ow==='vscodium').focus();document.activeElement.click();})();0`);
    assert.ok(await H.until(`/Could not open VSCodium/.test(document.getElementById('toasts').innerText)`, 5000), `${w}: the error toast came`);
    assert.ok(await H.until(`document.activeElement===document.getElementById('vscodeBtn')&&!document.getElementById('vscodeBtn').disabled`, 3000), `${w}: focus back on the button after a keyboard choice`);
    assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].some(t=>t.classList.contains('err')&&/its path has &, which cmd\.exe/.test(t.innerText))`), true, `${w}: main's refusal in the error style`);
    /* main's text is shown as text: markup in a note or an error stays visible characters (esc) */
    await H.clearToasts();
    await js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owr||b.openWith;b.__owr=o;b.openWith=async(i,t)=>t==='vscodium'?{ok:false,error:'<b id="owx">bad</b>'}:{ok:true,edition:'<i id="owe">E</i>',note:'<u id="own">n</u>'};})();0`);
    for (const [pick, n] of [[`document.querySelector('#owItems [data-ow="vscode"]').click();0`, `document.querySelectorAll('#toasts .toast').length>=1`], [`document.querySelector('#owItems [data-ow="vscodium"]').click();0`, `document.querySelectorAll('#toasts .toast').length>=2`]]) {
      await js(`document.getElementById('vscodeBtn').click();0`);
      assert.ok(await H.until(`!document.getElementById('openWithMenu').hidden`, 3000), `${w}: menu opens`);
      await js(pick);
      assert.ok(await H.until(n, 3000), `${w}: toast came`);
    }
    const esc = await js(`({txt:document.getElementById('toasts').innerText,els:!!document.querySelector('#toasts #owx,#toasts #owe,#toasts #own'),ok:document.querySelectorAll('#toasts .toast.ok').length,err:document.querySelectorAll('#toasts .toast.err').length})`);
    assert.ok(!esc.els, `${w}: no markup from main became an element`);
    assert.ok(esc.txt.includes('<i id="owe">E</i>') && esc.txt.includes('<u id="own">n</u>') && esc.txt.includes('<b id="owx">bad</b>'), `${w}: the markup shows as text ${JSON.stringify(esc.txt)}`);
    assert.deepStrictEqual([esc.ok, esc.err], [1, 1], `${w}: one ok and one err toast`);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.openWith=b.__owr;})();0`);
    await H.clearToasts();
    /* FR-027: the folder status dialog's Open in editor names the edition that answered, or "your editor", never a fixed VS Code */
    await js(`(()=>{const b=window.__durbarSimUi.bridge(),o=b.__owv||b.openInVSCode;b.__owv=o;let n=0;b.openInVSCode=async()=>++n===1?{ok:false,edition:'VSCodium',error:'<b id="owv">v</b>'}:{ok:true,note:'<i id="owv">This folder is a link, so its real folder was opened.</i>'};})();0`);
    for (const want of [/Could not open VSCodium: <b id="owv">v<\/b>/, /Opening in your editor…\s*<i id="owv">This folder is a link/]) {
      await js(`document.querySelector('#panelHead .folder').click();0`);
      assert.ok(await H.until(`!!document.getElementById('mdT')&&[...document.querySelectorAll('#modeDlg .dbtn .btn')].some(x=>x.textContent==='Open in editor')`, 5000), `${w}: the folder status dialog`);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Open in editor').click();0`);
      assert.ok(await H.until(`!document.getElementById('modeDlg')&&document.querySelectorAll('#toasts .toast').length>=1`, 5000), `${w}: Open in editor answered`);
      const t2 = await js(`({t:document.getElementById('toasts').innerText,el:!!document.querySelector('#toasts #owv')})`);
      assert.match(t2.t, want, `${w}: ${JSON.stringify(t2.t)}`); assert.ok(!/VS Code/.test(t2.t) && !t2.el, `${w}: no fixed VS Code, escaped`);
      await H.clearToasts();
    }
    await js(`(()=>{const b=window.__durbarSimUi.bridge();b.openInVSCode=b.__owv;})();0`);
  }
  /* a demo agent: a plain button, no menu promised (no chevron, no aria-haspopup, no menu in the page) */
  await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();const t=document.getElementById('demoToggle');t.checked=true;t.dispatchEvent(new Event('change'));})();0`);
  assert.ok(await H.until(`!!document.querySelector('#stage .desk[data-id]')`, 5000), 'demo desks');
  await js(`document.querySelector('#stage .desk[data-id]').click();0`);
  assert.ok(await H.until(`!!document.getElementById('vscodeBtn')`, 5000), 'demo chat');
  const demo = await js(`(()=>{const b=document.getElementById('vscodeBtn');return {t:b.textContent.trim(),pop:b.hasAttribute('aria-haspopup'),menu:!!document.getElementById('openWithMenu'),svgs:b.querySelectorAll('svg').length}})()`);
  assert.deepStrictEqual(demo, { t: 'Open in editor', pop: false, menu: false, svgs: 1 }, 'a demo agent: a plain button');
  await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=false;t.dispatchEvent(new Event('change'));})();0`);
  console.log('[009-openwith] PASS');
};
