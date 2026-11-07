/*
 * Spec 052 FR-226 (T219): the Settings section list. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-settings-nav
 *   OUT=<folder>  (optional) saves 052-settings-nav-{1440x900,1280x800}.png (and one per world, -<world>-)
 *
 * At 1440x900 and 1280x800, in the Flat office (Clean Office), Retro, and Real office in its worlds, the cave among them (one screen serves every world):
 *   - the list is a <nav aria-label="Settings sections"> with one button per heading that is on the page (the same labels, in page order);
 *   - every label is at least 10.5px, the list sits inside the screen, beside the page and not over it; nothing scrolls sideways; the page behind
 *     does not scroll; the first section is current at the top (aria-current on exactly one button);
 *   - a real click on an entry jumps to its section (the heading is at the top of the page, inside the window) and puts the focus on the heading;
 *     scrolling the page moves aria-current to the section at the top; every entry, clicked in turn, shows its own heading;
 *   - keys: one Tab stop in the list, the arrows, Home and End move the focus inside it, Enter jumps;
 *   - reduced motion emulated: the jump is already done in the same frame (no smooth scrolling), and the page's scroll-behavior is auto;
 *   - a narrow window (640 wide): the list is a row above the page, scrolls sideways, and nothing else breaks.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

const SIZES = [[1440, 900], [1280, 800]];
/* [name, theme, officeview, Real office world set by hand]: the flat office, Retro, and Real office in its three worlds (photo, the cave, the loft) */
const WORLDS = [['flat', 'clean-office', null, null], ['retro', 'retro', null, null], ['real', null, 'real', null], ['cave', null, 'real', 'cave'], ['loft', null, 'real', 'loft']];
const HEADS = `.scr-body>.scr-sec>h3,.scr-body>.scr-adv>summary>h3`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = ctx.win.webContents;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const dbg = wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const emulate = (v) => dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });

  const clickAt = async (x, y) => {
    await js(`(()=>{if(!window.__upOn){window.__upOn=1;document.addEventListener('click',()=>{window.__ups++;},true);}window.__ups=0;})();0`);
    for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await until(`window.__ups>0`, 1500);
  };
  const mclick = async (selector) => {
    const r = await js(`(()=>{const e=document.querySelector(${jsLiteral(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    assert.ok(r, `${selector} is there to click`);
    await clickAt(r.x, r.y);
  };
  const state = () => js(`(()=>{const b=document.querySelector('#screen .scr-body'),n=document.getElementById('scrNav');
    const cur=[...n.querySelectorAll('.scr-nav-b')].map((x,i)=>x.hasAttribute('aria-current')?i:-1).filter(i=>i>=0);
    const a=document.activeElement;
    return {top:Math.round(b.scrollTop),max:b.scrollHeight-b.clientHeight,cur,focus:a?{tag:a.tagName,id:a.id,inNav:!!a.closest('#scrNav'),i:a.dataset&&a.dataset.i}:null,page:document.scrollingElement.scrollTop}})()`);
  /* an independent reading of the page: each section's top relative to the page's top */
  const tops = () => js(`(()=>{const b=document.querySelector('#screen .scr-body'),t=b.getBoundingClientRect().top;return [...document.querySelectorAll(${jsLiteral(HEADS)})].map(h=>Math.round((h.closest('.scr-sec,.scr-adv')||h).getBoundingClientRect().top-t))})()`);
  const headTop = (i) => js(`(()=>{const b=document.querySelector('#screen .scr-body'),h=[...document.querySelectorAll(${jsLiteral(HEADS)})][${i}];const r=h.getBoundingClientRect(),br=b.getBoundingClientRect();return {top:Math.round(r.top-br.top),inView:r.top>=br.top&&r.bottom<=br.bottom+1,focused:document.activeElement===h}})()`);
  const open = async (w, h, theme, view, world) => {
    await H.load(Object.assign({ w, h, ready: 'fit', focus: true }, view ? { query: { officeview: view }, ready: `!!document.querySelector('#stage .ro .ro-plate')`, settle: false } : {}));
    if (theme) { await js(`window.THEME.setTheme(${jsLiteral(theme)})`); await H.settle(); }
    await mclick('#settingsBtn');
    await ok(`!!document.querySelector('#screen .scr-body')&&!document.getElementById('scrNav').hidden&&document.querySelectorAll('#scrNav .scr-nav-b').length>5`, 'Settings opens with its section list');
    if (world) await js(`document.documentElement.dataset.world=${jsLiteral(world)}`); // by hand, as check-logo-family does: Real office offers only its first world today
    await ctx.sleep(150);
  };

  for (const [w, h] of SIZES) {
    for (const [wname, theme, view, world] of WORLDS) {
      const tag = `${w}x${h} ${wname}`;
      await open(w, h, theme, view, world);
      await emulate('no-preference');

      // ---- the list is built from the headings that are on the page ----
      const built = await js(`(()=>{const n=document.getElementById('scrNav');
        const hs=[...document.querySelectorAll(${jsLiteral(HEADS)})].map(h=>{const c=h.cloneNode(true);c.querySelectorAll('small').forEach(x=>x.remove());return c.textContent.replace(/\\s+/g,' ').trim();});
        const bs=[...n.querySelectorAll('.scr-nav-b')].map(b=>b.textContent);
        return {tag:n.tagName,label:n.getAttribute('aria-label'),hs,bs,sizes:[...n.querySelectorAll('.scr-nav-b')].map(b=>parseFloat(getComputedStyle(b).fontSize))}})()`);
      assert.strictEqual(built.tag, 'NAV', `${tag}: a nav landmark`);
      assert.strictEqual(built.label, 'Settings sections', `${tag}: the landmark is named`);
      assert.deepStrictEqual(built.bs, built.hs.map((t) => (t.length > 40 ? t.slice(0, 39) + '…' : t)), `${tag}: one entry per heading on the page, in page order`);
      assert.ok(built.bs.length >= 10, `${tag}: the page has many sections (${built.bs.length})`);
      assert.ok(Math.min(...built.sizes) >= 10.5, `${tag}: text at least 10.5px: ${Math.min(...built.sizes)}`);

      // ---- fit: inside the screen, beside the page, nothing sideways, the page behind still ----
      const fit = await js(`(()=>{const n=document.getElementById('scrNav').getBoundingClientRect(),b=document.querySelector('#screen .scr-body'),br=b.getBoundingClientRect(),s=document.getElementById('screen').getBoundingClientRect();
        return {inScreen:n.left>=s.left-1&&n.right<=s.right+1&&n.top>=s.top-1&&n.bottom<=s.bottom+1,apart:n.right<=br.left+1,bodyX:b.scrollWidth-b.clientWidth,pageX:document.scrollingElement.scrollWidth-innerWidth,page:document.scrollingElement.scrollTop,w:Math.round(n.width),bw:Math.round(br.width)}})()`);
      assert.ok(fit.inScreen, `${tag}: the list is inside the screen: ${JSON.stringify(fit)}`);
      assert.ok(fit.apart, `${tag}: the list is beside the page, not over it: ${JSON.stringify(fit)}`);
      assert.ok(fit.bodyX <= 1 && fit.pageX <= 0, `${tag}: nothing scrolls sideways: ${JSON.stringify(fit)}`);
      assert.strictEqual(fit.page, 0, `${tag}: the page behind does not scroll`);
      let s = await state();
      assert.deepStrictEqual(s.cur, [0], `${tag}: at the top, only the first section is current: ${JSON.stringify(s)}`);
      assert.ok(s.max > h, `${tag}: the page is taller than the window (${s.max})`);

      // ---- a real click jumps and focuses the heading ----
      const n = built.bs.length, k = Math.floor(n / 2);
      await mclick(`#scrNav .scr-nav-b[data-i="${k}"]`);
      await ok(`document.querySelector('#screen .scr-body').scrollTop>0`, `${tag}: the click scrolled the page`);
      s = await state();
      let ht = await headTop(k);
      assert.ok(ht.inView && ht.top >= 0 && ht.top <= 40, `${tag}: the section is at the top of the page: ${JSON.stringify(ht)}`);
      assert.ok(ht.focused, `${tag}: the focus is on the heading`);
      assert.deepStrictEqual(s.cur, [k], `${tag}: the clicked section is current: ${JSON.stringify(s)}`);
      assert.strictEqual(s.page, 0, `${tag}: the page behind did not move`);

      // ---- scrolling the page moves aria-current (read independently from the sections' own positions) ----
      for (const j of [3, n - 4, 1, n - 1, 0]) {
        const at = (await tops())[j];
        await js(`(()=>{const b=document.querySelector('#screen .scr-body');b.scrollTop=b.scrollTop+${jsLiteral(at)}-4;})()`);
        await ok(`(()=>{const c=[...document.querySelectorAll('#scrNav .scr-nav-b')].findIndex(x=>x.hasAttribute('aria-current'));return c>=0})()`, `${tag}: a section is current`);
        const exp = await js(`(()=>{const b=document.querySelector('#screen .scr-body'),t=b.getBoundingClientRect().top,e=[...document.querySelectorAll(${jsLiteral(HEADS)})].map(h=>(h.closest('.scr-sec,.scr-adv')||h).getBoundingClientRect().top-t);
          if(b.scrollHeight-b.clientHeight-b.scrollTop<=1&&b.scrollTop>0)return e.length-1;let k=0;e.forEach((v,i)=>{if(v<=14)k=i;});return k;})()`);
        await ok(`[...document.querySelectorAll('#scrNav .scr-nav-b')].map((x,i)=>x.hasAttribute('aria-current')?i:-1).filter(i=>i>=0).join()===${jsLiteral(String(exp))}`, `${tag}: scrolling to section ${j} makes ${exp} current (it was ${JSON.stringify((await state()).cur)})`);
      }

      // ---- every entry, clicked in turn, shows its own heading ----
      for (let i = 0; i < n; i++) {
        await mclick(`#scrNav .scr-nav-b[data-i="${i}"]`);
        await ok(`document.querySelectorAll('#scrNav [aria-current]').length===1&&document.querySelector('#scrNav [aria-current]').dataset.i==='${i}'`, `${tag}: entry ${i} is current after its click`);
        ht = await headTop(i);
        assert.ok(ht.inView && ht.focused, `${tag}: entry ${i} (${built.bs[i]}) shows its heading, focused: ${JSON.stringify(ht)}`);
        const atEnd = (await state());
        assert.ok(ht.top <= 40 || atEnd.top >= atEnd.max - 1, `${tag}: entry ${i} is at the top (or the page is at its end): ${JSON.stringify(ht)}`);
      }

      // ---- keyboard ----
      await js(`(()=>{const b=document.querySelector('#screen .scr-body');b.scrollTop=0;document.querySelector('#scrNav .scr-nav-b[data-i="0"]').focus();})()`);
      await ok(`document.querySelectorAll('#scrNav .scr-nav-b[tabindex="0"]').length===1`, `${tag}: one Tab stop in the list`);
      const prevented = (key) => js(`(()=>{const e=new KeyboardEvent('keydown',{key:${jsLiteral(key)},bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);return e.defaultPrevented})()`);
      assert.strictEqual(await prevented('ArrowDown'), true, `${tag}: an arrow key in the list does not also scroll anything (default prevented)`);
      assert.strictEqual(await prevented('Tab'), false, `${tag}: Tab is left alone`);
      await js(`document.querySelector('#scrNav .scr-nav-b[data-i="0"]').focus()`);
      await H.key('Down'); await ok(`document.activeElement.dataset.i==='1'`, `${tag}: ArrowDown moves to the next entry`);
      await H.key('Down'); await ok(`document.activeElement.dataset.i==='2'`, `${tag}: ArrowDown again`);
      await H.key('Up'); await ok(`document.activeElement.dataset.i==='1'`, `${tag}: ArrowUp goes back`);
      await H.key('End'); await ok(`document.activeElement.dataset.i==='${n - 1}'`, `${tag}: End goes to the last entry`);
      await H.key('Down'); assert.strictEqual(await js(`document.activeElement.dataset.i`), String(n - 1), `${tag}: no wrap at the end`);
      await H.key('Home'); await ok(`document.activeElement.dataset.i==='0'`, `${tag}: Home goes to the first entry`);
      await H.key('Down'); await H.key('Down'); await H.key('Down');
      await H.key('Return');
      await ok(`(()=>{const h=[...document.querySelectorAll(${jsLiteral(HEADS)})][3];return document.activeElement===h})()`, `${tag}: Enter jumps to the section and focuses its heading`);
      s = await state();
      assert.deepStrictEqual(s.cur, [3], `${tag}: Enter made the section current: ${JSON.stringify(s)}`);
      assert.strictEqual(s.page, 0, `${tag}: the page behind did not move`);
      // Tab from the heading comes into the section's own controls, not into 20 list entries (the list is one stop, before the page)
      await H.key('Tab');
      assert.ok(!(await state()).focus.inNav, `${tag}: Tab from the heading goes on into the page`);
      await H.key('Tab', ['shift']); await H.key('Tab', ['shift']);
      const back = await state();
      assert.ok(back.focus && back.focus.inNav ? back.focus.i === '3' : true, `${tag}: the list is one stop (current entry): ${JSON.stringify(back)}`);

      // ---- reduced motion: the jump is done in the same frame ----
      await emulate('reduce');
      const instant = await js(`(()=>{const b=document.querySelector('#screen .scr-body');b.scrollTop=0;const btn=document.querySelector('#scrNav .scr-nav-b[data-i="6"]');btn.click();return {top:b.scrollTop,behavior:getComputedStyle(b).scrollBehavior,rm:matchMedia('(prefers-reduced-motion: reduce)').matches}})()`);
      assert.ok(instant.rm, `${tag}: reduced motion is emulated`);
      assert.ok(instant.top > 0 && instant.behavior === 'auto', `${tag}: reduced motion: the jump is instant, no smooth scrolling: ${JSON.stringify(instant)}`);
      await emulate('no-preference');
      const normal = await js(`(()=>{const b=document.querySelector('#screen .scr-body');b.scrollTop=0;document.querySelector('#scrNav .scr-nav-b[data-i="7"]').click();return {top:b.scrollTop,behavior:getComputedStyle(b).scrollBehavior}})()`);
      assert.ok(normal.top > 0 && normal.behavior === 'auto', `${tag}: the jump is also instant with motion on: ${JSON.stringify(normal)}`);

      // ---- picture, at the top of the page, with a section current ----
      await js(`(()=>{const b=document.querySelector('#screen .scr-body');b.scrollTop=0;})()`);
      await mclick(`#scrNav .scr-nav-b[data-i="4"]`);
      await ctx.sleep(200);
      const file = wname === 'flat' ? `052-settings-nav-${w}x${h}.png` : `052-settings-nav-${wname}-${w}x${h}.png`;
      await H.shot(path.join(OUT, file), { prep: 'mouse', tag: '052' });
    }
  }

  // ---- narrow: a row above the page ----
  await open(640, 800, 'clean-office', null);
  const row = await js(`(()=>{const n=document.getElementById('scrNav'),b=document.querySelector('#screen .scr-body'),nr=n.getBoundingClientRect(),br=b.getBoundingClientRect(),s=document.getElementById('screen').getBoundingClientRect(),ul=n.querySelector('ul');
    return {dir:getComputedStyle(ul).flexDirection,above:nr.bottom<=br.top+1,inScreen:nr.left>=s.left-1&&nr.right<=s.right+1,scrollsX:n.scrollWidth>n.clientWidth,h:Math.round(nr.height),bodyX:b.scrollWidth-b.clientWidth,pageX:document.scrollingElement.scrollWidth-innerWidth,bodyH:Math.round(br.height),min:Math.min(...[...n.querySelectorAll('.scr-nav-b')].map(x=>parseFloat(getComputedStyle(x).fontSize)))}})()`);
  assert.strictEqual(row.dir, 'row', `narrow: the list is a row: ${JSON.stringify(row)}`);
  assert.ok(row.above && row.inScreen, `narrow: the row is above the page and inside the screen: ${JSON.stringify(row)}`);
  assert.ok(row.scrollsX && row.bodyX <= 1 && row.pageX <= 0, `narrow: the row scrolls sideways, the page does not: ${JSON.stringify(row)}`);
  assert.ok(row.h < 80 && row.bodyH > 300 && row.min >= 10.5, `narrow: the row is slim and the page keeps its room: ${JSON.stringify(row)}`);
  await js(`(()=>{const n=document.getElementById('scrNav'),b=n.querySelector('.scr-nav-b[data-i="9"]');n.scrollLeft+=b.getBoundingClientRect().left-n.getBoundingClientRect().left-40;})()`); // the row scrolls sideways: bring a far entry into reach, as a finger would
  await mclick(`#scrNav .scr-nav-b[data-i="9"]`);
  await ok(`document.querySelector('#scrNav [aria-current]').dataset.i==='9'&&document.querySelector('#screen .scr-body').scrollTop>0`, 'narrow: a click jumps');
  assert.ok((await js(`(()=>{const n=document.getElementById('scrNav'),c=n.querySelector('[aria-current]').getBoundingClientRect(),r=n.getBoundingClientRect();return c.left>=r.left-1&&c.right<=r.right+1})()`)), 'narrow: the current entry is brought into view in the row');
  await H.shot(path.join(OUT, '052-settings-nav-narrow-640x800.png'), { prep: 'mouse', tag: '052' });
  console.log('all checks passed');
};
