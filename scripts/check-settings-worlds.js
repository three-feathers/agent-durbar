/*
 * Spec 102 FR-300, FR-301 (T266, first step): Settings > World, picture cards in one radio group. Simulator only (no AI credits, no agent app).
 *
 *   node scripts/ui-suite.js --only check-settings-worlds
 *   OUT=<folder>  (optional) saves 102-world-section-{1440x900,1280x800}.jpg (Plain in use, the World section at the top)
 *
 * At 1440x900 and 1280x800 (the flat office, and Real office):
 *   - the Display section has no Office layout or World row any more; a section named World holds the cards (Plain, Photo office), one radio group;
 *   - a world behind a closed flag is not listed; with its flag open (the simulator's `worldflags`) it is, after the Photo office, with a plain tile when it has no picture;
 *   - exactly one card is checked and has "In use" and a 2 px edge in --accent (not colour alone); one Tab stop (the checked card);
 *   - the arrow keys move the focus (roving tabindex) and do not choose; Enter and Space choose, at once: Plain is the flat office, a world card is Real office in it;
 *   - focus is drawn outside the card with a gap and never like the chosen edge; every card is at least 24 px high, its text at least 10.5 px;
 *   - the preview zooms on hover and on keyboard focus by transform only, about 1.6 times, and nothing around it moves (no layout shift); with Reduced motion,
 *     with Motion off, there is no zoom; with forced colours the chosen edge is Highlight.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = ctx.win.webContents;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const dbg = wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const emulate = (features) => dbg.sendCommand('Emulation.setEmulatedMedia', { features });
  const key = async (keyCode, ch) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    if (ch) wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const CARDS = `#wrGroup [data-world]`;
  const open = async (w, h, query) => {
    await H.load({ w, h, query: { sim: '3', ...query }, ready: query.officeview === 'real' ? `!!document.querySelector('#stage .ro .ro-plate')` : `document.querySelectorAll('#stage .desk[data-id]').length>=3`, focus: true });
    await js(`document.getElementById('settingsBtn').click();0`);
    await ok(`!!document.querySelector(${jsLiteral(CARDS)})`, 'Settings opens with the World cards');
    await ctx.sleep(0);
  };
  const names = () => js(`[...document.querySelectorAll(${jsLiteral(CARDS)})].map(b=>b.dataset.world)`);
  const checked = () => js(`[...document.querySelectorAll(${jsLiteral(CARDS)})].filter(b=>b.getAttribute('aria-checked')==='true').map(b=>b.dataset.world)`);
  const rects = () => js(`[...document.querySelectorAll('#wrGroup, #wrGroup .wcard, #wrGroup .wcard .wpic, #wrGroup .wcard .wtx')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.left*10),Math.round(r.top*10),Math.round(r.width*10),Math.round(r.height*10)].join(',')}).join('|')`);

  for (const [w, h] of SIZES) {
    for (const [wname, query] of [['flat', { officeview: 'flat' }], ['real', { officeview: 'real' }]]) {
      const tag = `${w}x${h} ${wname}`;
      await emulate([{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'forced-colors', value: 'none' }]);
      await open(w, h, query);

      // ---- the rows are gone, the section is there ----
      const sec = await js(`(()=>{const h=document.getElementById('worldH');const g=document.getElementById('wrGroup');
        return {h:h?h.textContent:null,sec:!!(h&&h.closest('section.scr-sec')),role:g&&g.getAttribute('role'),label:g&&g.getAttribute('aria-labelledby'),layoutRow:!!document.querySelector('[data-officelayout],#dsL'),oldRow:!!document.getElementById('wrRow'),theme:!!document.getElementById('themeH'),chars:!!document.getElementById('chH')}})()`);
      assert.strictEqual(sec.h, 'World', `${tag}: a section named World`);
      assert.ok(sec.sec, `${tag}: the heading is a settings section`);
      assert.strictEqual(sec.role, 'radiogroup', `${tag}: the cards are one radio group`);
      assert.strictEqual(sec.label, 'worldH', `${tag}: the group is named by the heading`);
      assert.ok(!sec.layoutRow && !sec.oldRow, `${tag}: the Office layout row and the World row are gone from Display`);
      assert.ok(sec.theme && sec.chars, `${tag}: Theme and Characters stay until the flip`);
      assert.deepStrictEqual(await names(), ['plain', 'photo'], `${tag}: the closed flag: only Plain and the Photo office are listed`);

      // ---- one checked card, In use, a 2 px accent edge, one Tab stop ----
      const want = wname === 'real' ? 'photo' : 'plain';
      assert.deepStrictEqual(await checked(), [want], `${tag}: exactly one card is checked, the one in use`);
      const look = await js(`(()=>{const probe=document.createElement('i');probe.style.color='var(--accent)';document.body.appendChild(probe);const acc=getComputedStyle(probe).color;probe.remove();
        return [...document.querySelectorAll(${jsLiteral(CARDS)})].map(b=>{const cs=getComputedStyle(b),r=b.getBoundingClientRect(),use=b.querySelector('.wuse');
          const t=[...b.querySelectorAll('.wtx b,.wtx small,.wuse')].map(e=>parseFloat(getComputedStyle(e).fontSize));
          return {id:b.dataset.world,on:b.getAttribute('aria-checked')==='true',tab:b.tabIndex,bw:parseFloat(cs.borderTopWidth),bc:cs.borderTopColor,acc,use:use?use.textContent:'',h:r.height,w:r.width,minText:Math.min(...t),name:(document.getElementById(b.getAttribute('aria-labelledby'))||{}).textContent}})})()`);
      assert.strictEqual(look.filter((c) => c.tab === 0).length, 1, `${tag}: one Tab stop`);
      for (const c of look) {
        assert.strictEqual(c.tab, c.on ? 0 : -1, `${tag}: ${c.id}: roving tabindex follows the choice`);
        assert.strictEqual(c.on ? c.use : '', c.on ? 'In use' : '', `${tag}: ${c.id}: only the chosen card says In use`);
        if (c.on) { assert.strictEqual(c.bw, 2, `${tag}: the chosen card has a 2 px edge`); assert.strictEqual(c.bc, c.acc, `${tag}: the chosen edge is --accent`); }
        assert.ok(c.h >= 24 && c.w >= 24, `${tag}: ${c.id}: the target is at least 24 px (${c.w}x${c.h})`);
        assert.ok(c.minText >= 10.5, `${tag}: ${c.id}: text at least 10.5 px (${c.minText})`);
        assert.ok(c.name && c.name.length > 2, `${tag}: ${c.id}: the card has its name`);
      }

      // ---- keys: arrows move the focus and choose nothing; Enter and Space choose ----
      await js(`document.querySelector(${jsLiteral(CARDS + '[tabindex="0"]')}).focus();0`);
      await key('Right');
      await ok(`document.activeElement&&document.activeElement.dataset.world===${jsLiteral(wname === 'real' ? 'plain' : 'photo')}`, `${tag}: Right arrow moves the focus to the next card (it wraps)`);
      assert.deepStrictEqual(await checked(), [want], `${tag}: an arrow key does not choose`);
      assert.strictEqual(await js(`document.querySelectorAll(${jsLiteral(CARDS + '[tabindex="0"]')}).length`), 1, `${tag}: still one Tab stop after an arrow`);
      // focus is drawn outside the card, with a gap, and not like the chosen edge
      const fo = await js(`(()=>{const a=document.activeElement,cs=getComputedStyle(a);return {ow:parseFloat(cs.outlineWidth),os:cs.outlineStyle,off:parseFloat(cs.outlineOffset),bw:parseFloat(cs.borderTopWidth),bc:cs.borderTopColor,on:a.getAttribute('aria-checked')}})()`);
      assert.ok(fo.os !== 'none' && fo.ow >= 2 && fo.off >= 2, `${tag}: focus is drawn outside the card with a gap: ${JSON.stringify(fo)}`);
      const acc = await js(`(()=>{const p=document.createElement('i');p.style.color='var(--accent)';document.body.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c})()`);
      assert.notStrictEqual(fo.bc, acc, `${tag}: a focused card that is not chosen does not take the chosen edge`);
      const target = await js(`document.activeElement.dataset.world`);
      await key('Return', '\r');
      await ok(`document.querySelector(${jsLiteral(CARDS + '[aria-checked="true"]')})&&document.querySelector(${jsLiteral(CARDS + '[aria-checked="true"]')}).dataset.world===${jsLiteral(target)}`, `${tag}: Enter chooses the focused card`);
      assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.world`), target, `${tag}: the focus stays on the card after the choice`);
      const view = await js(`localStorage.getItem('durbar.officeview')+' '+localStorage.getItem('durbar.world')`);
      assert.ok(target === 'plain' ? /^flat /.test(view) : view === 'real photo', `${tag}: choosing applies at once, stored as it always was: ${view}`);
      await ok(target === 'plain' ? `!document.documentElement.dataset.world` : `document.documentElement.dataset.world==='photo'`, `${tag}: the app is in ${target} (the page's world mark)`);
      // the other card with Space
      await key('Left');
      const other = await js(`document.activeElement.dataset.world`);
      assert.notStrictEqual(other, target, `${tag}: Left moves to the other card`);
      await key('Space', ' ');
      await ok(`(()=>{const c=document.querySelector(${jsLiteral(CARDS + '[aria-checked="true"]')});return !!c&&c.dataset.world===${jsLiteral(other)}})()`, `${tag}: Space chooses the focused card`);

      // ---- the zoom: transform only, about 1.6, nothing around it moves ----
      await js(`document.activeElement.blur();0`);
      await ok(`!document.querySelector('#wrGroup .wcard:focus-visible')`, `${tag}: no card has focus`);
      const before = await rects();
      const pos = await js(`(()=>{const r=document.querySelector(${jsLiteral(CARDS + '[data-world="photo"] .wpic')}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      wc.sendInputEvent({ type: 'mouseMove', x: pos.x, y: pos.y });
      await ok(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#wrGroup [data-world="photo"] .wpic img')).transform);return Math.abs(m.a-1.6)<0.02})()`, `${tag}: hover zooms the preview to 1.6`);
      assert.strictEqual(await rects(), before, `${tag}: the zoom shifts no layout (no box around it moved or resized)`);
      const clip = await js(`(()=>{const p=document.querySelector('#wrGroup [data-world="photo"] .wpic');const cs=getComputedStyle(p);return {ov:cs.overflow,tr:getComputedStyle(p.querySelector('img')).transitionProperty,dur:getComputedStyle(p.querySelector('img')).transitionDuration}})()`);
      assert.strictEqual(clip.ov, 'hidden', `${tag}: the zoom is clipped inside the card`);
      assert.strictEqual(clip.tr, 'transform', `${tag}: only the transform moves`);
      wc.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await ok(`new DOMMatrix(getComputedStyle(document.querySelector('#wrGroup [data-world="photo"] .wpic img')).transform).a===1`, `${tag}: leaving the card undoes the zoom`);
      // keyboard focus zooms too
      await js(`document.querySelector(${jsLiteral(CARDS + '[data-world="photo"]')}).focus();0`);
      await ok(`Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#wrGroup [data-world="photo"] .wpic img')).transform).a-1.6)<0.02`, `${tag}: keyboard focus zooms the preview`);
      await js(`document.activeElement.blur();0`);
      // Reduced motion and Motion off: no zoom at all
      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await js(`document.querySelector(${jsLiteral(CARDS + '[data-world="photo"]')}).focus();0`);
      await ctx.sleep(300);
      assert.strictEqual(await js(`new DOMMatrix(getComputedStyle(document.querySelector('#wrGroup [data-world="photo"] .wpic img')).transform).a`), 1, `${tag}: with Reduced motion there is no zoom`);
      await js(`document.activeElement.blur();0`);
      await emulate([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await js(`document.documentElement.setAttribute('data-motion-off','');document.querySelector(${jsLiteral(CARDS + '[data-world="photo"]')}).focus();0`);
      await ctx.sleep(300);
      assert.strictEqual(await js(`new DOMMatrix(getComputedStyle(document.querySelector('#wrGroup [data-world="photo"] .wpic img')).transform).a`), 1, `${tag}: with Motion off there is no zoom`);
      await js(`document.documentElement.removeAttribute('data-motion-off');document.activeElement.blur();0`);

      // ---- forced colours: the chosen edge is Highlight, the label stays ----
      await emulate([{ name: 'forced-colors', value: 'active' }]);
      const fc = await js(`(()=>{const p=document.createElement('i');p.style.color='Highlight';document.body.appendChild(p);const hl=getComputedStyle(p).color;p.remove();const c=document.querySelector(${jsLiteral(CARDS + '[aria-checked="true"]')});return {edge:getComputedStyle(c).borderTopColor,hl,use:!!c.querySelector('.wuse')&&getComputedStyle(c.querySelector('.wuse')).display!=='none'}})()`);
      assert.strictEqual(fc.edge, fc.hl, `${tag}: forced colours: the chosen edge is Highlight`);
      assert.ok(fc.use, `${tag}: forced colours: the In use label stays`);
      await emulate([{ name: 'forced-colors', value: 'none' }]);

      if (wname === 'flat') {
        await js(`(()=>{const b=document.querySelector('#screen .scr-body'),t=b.getBoundingClientRect().top,e=document.getElementById('worldH').closest('section').getBoundingClientRect().top;b.scrollTop+=e-t-8;})();0`);
        await H.shot(path.join(OUT, `102-world-section-${w}x${h}.jpg`), { prep: 'mouse', quality: 60 });
      }
    }

    // ---- a flag open lists its world, after the Photo office, with a tile when it has no picture; the checked one is still the one in use ----
    await emulate([{ name: 'forced-colors', value: 'none' }]);
    await open(w, h, { officeview: 'real', worldflags: 'cave,retro', world: 'retro' });
    assert.deepStrictEqual(await names(), ['plain', 'photo', 'cave', 'retro'], `${w}x${h}: with their flags open the cave and the arcade are listed, in order`);
    assert.deepStrictEqual(await checked(), ['retro'], `${w}x${h}: the arcade is in use`);
    assert.ok(await js(`document.querySelectorAll('#wrGroup .wnone').length===2`), `${w}x${h}: a world without a picture shows a plain tile with its name`);
  }
  console.log('[check-settings-worlds] all checks passed');
};
