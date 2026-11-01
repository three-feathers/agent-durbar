/*
 * The logo family (spec 101 FR-072, SC-001..SC-003, SC-005). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800:
 *   - the default: icon 1 inline in the top bar with no script step needed (data-logo 1), no <img> in the tile, the tile is 32 px and the
 *     name stays beside it, the base palette paints the tile and the slots;
 *   - Settings > Logo: right after Characters, four choices (1, 2, 3, 5) with a 64 px preview and a name each, buttons with aria-pressed,
 *     text at least 10.5 px, the page does not overflow; a pick changes the top bar at once, is stored (durbar.logo) and survives a
 *     reload, a bad stored value shows icon 1, a blocked localStorage fails nothing, and the window icon is never touched;
 *   - the flat office: Clean (base palette, a plate per icon), every other built-in UI style and a generated one (the theme's brand
 *     pair), forced colours (system colours), and a world (html[data-world], set here by hand: spec 097's seam sets it) with and without an
 *     approved palette;
 *   - every icon on every one of those, tile size and name position unchanged; pictures of the top bar go to LOGO_OUT.
 * A miss prints DRIVER FAILED; the npm script exits non-zero unless "all checks passed" is printed.
 *
 *   npm run check:ui -- --only check-logo-family
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const IDS = ['1', '2', '3', '5'];
const PLATE = { 1: '#10141E', 2: '#03183A', 3: '#061C4A', 5: '#07111F' };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const WORLDS = { photo: { plate: '#5C3312', gold: '#FFD45E', bot: '#BFE0FF' }, cave: { plate: '#2A1710', gold: '#F2B46E', bot: '#A3AFC0' }, loft: { plate: '#2C0A5E', gold: '#FFE81F', bot: '#2EE6F2' } };
const UI_THEMES = ['corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese'];
const GENERATED = { id: 'logo-gen-test', name: 'Logo generated test', extends: 'clean-office', ui: 'retro', tokens: { '--brand-mark': '#ffffff', '--brand-bg': '#7a1fa2' } };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, js } = H;
  const out = process.env.LOGO_OUT || path.join(os.tmpdir(), 'logo-family-shots');
  fs.mkdirSync(out, { recursive: true });

  /* the top bar as the page shows it now: the tile, the drawing, the name, the paint of the slots */
  const bar = () => js(`(()=>{const R=e=>e.getBoundingClientRect(),m=document.querySelector('.brand-mark'),s=m.querySelector('svg'),h=document.querySelector('.brand h1'),C=e=>e?getComputedStyle(e):null;
    const fill=k=>{const e=s.querySelector('[data-slot="'+k+'"]');return e?C(e).fill:null;};
    return {logo:document.documentElement.dataset.logo,id:s.getAttribute('data-logo-id'),img:m.querySelectorAll('img').length,w:Math.round(R(m).width),h:Math.round(R(m).height),svgw:Math.round(R(s).width),
      h1x:Math.round(R(h).left),h1y:Math.round(R(h).top),bg:C(m).backgroundColor,gold:fill('gold'),bot:fill('bot'),eye:fill('eye'),cream:fill('cream'),screen:fill('screen'),
      plateShown:(()=>{const p=s.querySelector('[data-slot="plate"]');return !!p&&C(p).display!=='none';})(),shapes:s.querySelectorAll('[data-slot]').length,
      brandMark:C(document.documentElement).getPropertyValue('--brand-mark').trim(),brandBg:C(document.documentElement).getPropertyValue('--brand-bg').trim(),
      over:document.querySelector('.topbar').scrollWidth>document.querySelector('.topbar').clientWidth+1}})()`);
  const shot = async (name) => {
    const r = await js(`(()=>{const b=document.querySelector('.brand').getBoundingClientRect();return {x:Math.max(0,Math.floor(b.left)-4),y:Math.max(0,Math.floor(b.top)-4),width:Math.ceil(b.width)+8,height:Math.ceil(b.height)+8};})()`);
    const img = await ctx.win.webContents.capturePage(r);
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  };
  const setLogo = async (id) => { await js(`window.DurbarLogo.set(${jsLiteral(id)})`); assert.ok(await until(`document.querySelector('.brand-mark svg').getAttribute('data-logo-id')===${jsLiteral(id)}`, 3000), `icon ${id} shown`); };
  const openSettings = async () => {
    if (!(await js(`!!document.getElementById('lgList')`))) await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`!!document.getElementById('lgList')&&!!document.getElementById('chList')`, 6000), 'Settings shows the Characters and Logo lists');
  };
  const closeSettings = async () => { await js(`window.DurbarScreens.close()`); assert.ok(await until(`!document.getElementById('lgList')`, 4000), 'Settings closed'); };
  const forced = async (on) => {
    const d = ctx.win.webContents.debugger;
    if (!d.isAttached()) d.attach('1.3');
    await d.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: on ? 'active' : 'none' }] });
    assert.ok(await until(`matchMedia('(forced-colors: active)').matches===${on}`, 3000), 'forced colours ' + (on ? 'on' : 'off'));
  };
  // the window icon: no call follows the choice (FR-037). The renderer has no way to call it; the page-side proof is that no IPC channel of that name exists
  const winIcon = () => js(`Object.keys(window.durbar||{}).filter(k=>/icon|dock|overlay/i.test(k))`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', settle: false });
    await js(`localStorage.removeItem('durbar.logo')`);
    await H.load({ w, h, ready: 'fit' });
    const iconsBefore = await winIcon();

    // ---- the default, before any pick ----
    const d = await bar();
    assert.strictEqual(d.logo, '1', `${tag}: the default is icon 1: ${JSON.stringify(d)}`);
    assert.strictEqual(d.img, 0, `${tag}: no <img> in the tile (FR-030)`);
    assert.deepStrictEqual([d.w, d.h, d.svgw], [32, 32, 20], `${tag}: a 32 px tile with a 20 px drawing`);
    assert.strictEqual(d.bg, rgb(PLATE[1]), `${tag}: the tile is icon 1's plate: ${d.bg}`);
    assert.strictEqual(d.gold, rgb('#FFC21A'), `${tag}: gold is painted by the token: ${d.gold}`);
    assert.strictEqual(d.bot, rgb('#C2DEFF'), `${tag}: bots are painted by the token: ${d.bot}`);
    assert.ok(!d.plateShown, `${tag}: the drawing's plate slot is hidden, the tile is the plate (FR-031)`);
    assert.ok(!d.over, `${tag}: the top bar does not overflow`);
    const home = { w: d.w, h: d.h, h1x: d.h1x, h1y: d.h1y };
    await shot(`logo-default-${tag}`);

    // ---- Settings > Logo ----
    await openSettings();
    const sec = await js(`(()=>{const h=document.getElementById('lgH'),ch=document.getElementById('chH'),sec=h.closest('section'),prev=sec.previousElementSibling;
      return {afterChars:!!prev&&prev.contains(ch),note:sec.querySelector('.scr-note').textContent,items:[...document.querySelectorAll('#lgList [data-logo]')].map(b=>({id:b.dataset.logo,tag:b.tagName,pressed:b.getAttribute('aria-pressed'),label:b.getAttribute('aria-label'),
        pv:(()=>{const s=b.querySelector('svg.logo-pv');const r=s&&s.getBoundingClientRect();return r?[Math.round(r.width),Math.round(r.height)]:null;})(),hidden:b.querySelector('svg.logo-pv')?b.querySelector('svg.logo-pv').getAttribute('aria-hidden'):null,
        titled:[...b.querySelectorAll('small')].every(e=>e.title===e.textContent),minFont:Math.min(...[...b.querySelectorAll('b,small')].map(e=>parseFloat(getComputedStyle(e).fontSize))),bg:(()=>{const p=b.querySelector('svg.logo-pv [data-slot="plate"]');return p?getComputedStyle(p).fill:null;})()})),
      pageX:document.documentElement.scrollWidth<=innerWidth}})()`);
    assert.ok(sec.afterChars, `${tag}: Logo comes right after Characters`);
    assert.ok(/The icon in the top bar; it takes the colours of your world\. The app.s own icon in the Dock, taskbar or Finder stays the same\./.test(sec.note), `${tag}: the note says what the choice does and does not change: ${sec.note}`);
    assert.deepStrictEqual(sec.items.map((i) => i.id), IDS, `${tag}: four choices in order`);
    assert.deepStrictEqual(sec.items.map((i) => i.pressed), ['true', 'false', 'false', 'false'], `${tag}: Prompt sovereign is the default`);
    for (const i of sec.items) {
      assert.strictEqual(i.tag, 'BUTTON', `${tag}: icon ${i.id} is a button`);
      assert.ok(/^Logo .+: .+/.test(i.label), `${tag}: icon ${i.id} has a name for a screen reader: ${i.label}`);
      assert.deepStrictEqual(i.pv, [64, 64], `${tag}: icon ${i.id} previews at 64 px`);
      assert.ok(i.titled, `${tag}: icon ${i.id}: a cut one-liner keeps its full text in a title (check-ui-text ellipsis-title)`);
      assert.ok(i.minFont >= 10.5, `${tag}: icon ${i.id} text is ${i.minFont}px`);
    }
    assert.ok(/Prompt sovereign/.test(sec.items[0].label) && /Terminal chair/.test(sec.items[1].label) && /Figure with badge/.test(sec.items[2].label) && /Underscore floor/.test(sec.items[3].label), `${tag}: the four names`);
    assert.strictEqual(sec.items[1].bg, rgb(PLATE[2]), `${tag}: a preview shows its own plate in the current palette: ${sec.items[1].bg}`);
    assert.ok(sec.pageX, `${tag}: the page does not overflow sideways`);
    await js(`document.getElementById('lgH').scrollIntoView({block:'center'})`);
    await H.settle();
    await ctx.shot(path.join(out, `logo-settings-${tag}.png`));

    // pick each with the mouse path (click), then check the bar, the store and the tile
    for (const id of ['3', '2', '5', '1']) {
      await js(`document.querySelector('#lgList [data-logo="'+${jsLiteral(id)}+'"]').click()`);
      assert.ok(await until(`document.querySelector('.brand-mark svg').getAttribute('data-logo-id')===${jsLiteral(id)}`, 3000), `${tag}: picking icon ${id} changes the top bar at once`);
      const b = await bar();
      assert.strictEqual(b.logo, id, `${tag}: data-logo is ${id}`);
      assert.strictEqual(b.bg, rgb(PLATE[id]), `${tag}: icon ${id}'s plate is the tile: ${b.bg}`);
      assert.deepStrictEqual({ w: b.w, h: b.h, h1x: b.h1x, h1y: b.h1y }, home, `${tag}: icon ${id}: tile size and name position unchanged`);
      assert.strictEqual(b.img, 0, `${tag}: icon ${id}: no <img>`);
      assert.strictEqual(await js(`localStorage.getItem('durbar.logo')`), id, `${tag}: icon ${id} is stored`);
      assert.deepStrictEqual(await js(`[...document.querySelectorAll('#lgList [data-logo]')].map(b=>b.getAttribute('aria-pressed')).join()`), IDS.map((x) => x === id).join(), `${tag}: the list shows the choice at once`);
      await shot(`logo-${id}-clean-${tag}`);
    }
    // keyboard: the focused button is activated by Enter (a real key event, as the Characters picker)
    await js(`document.querySelector('#lgList [data-logo="5"]').focus()`);
    assert.strictEqual(await js(`document.activeElement.dataset.logo`), '5', `${tag}: a logo button takes the keyboard focus`);
    await H.key('Return');
    assert.ok(await until(`document.querySelector('.brand-mark svg').getAttribute('data-logo-id')==='5'`, 3000), `${tag}: Enter picks the focused icon`);
    await closeSettings();

    // ---- survives a reload; a bad value; a blocked store ----
    await H.load({ w, h, ready: 'fit' });
    assert.strictEqual((await bar()).logo, '5', `${tag}: icon 5 is kept over a reload`);
    assert.strictEqual((await bar()).id, '5', `${tag}: the top bar draws icon 5 after the reload`);
    await js(`localStorage.setItem('durbar.logo','9')`);
    await H.load({ w, h, ready: 'fit' });
    assert.strictEqual((await bar()).logo, '1', `${tag}: a stored 9 shows icon 1`);
    await js(`localStorage.setItem('durbar.logo','<img src=x onerror=1>')`);
    await H.load({ w, h, ready: 'fit' });
    assert.deepStrictEqual([(await bar()).logo, (await bar()).img], ['1', 0], `${tag}: a hostile stored value shows icon 1 and no picture`);
    const blocked = await js(`(()=>{const real=Object.getOwnPropertyDescriptor(window,'localStorage');let threw=false;
      try{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('blocked');}});}catch(e){return {skipped:String(e)};}
      try{window.localStorage;}catch(e){threw=true;}
      let r={threw};try{r.stored=window.DurbarLogo.stored();r.set=window.DurbarLogo.set('2');r.cur=window.DurbarLogo.current();}catch(e){r.error=String(e);}
      if(real)Object.defineProperty(window,'localStorage',real);else delete window.localStorage;return r;})()`);
    const blockedOk = !!blocked.skipped || (blocked.threw && !blocked.error && blocked.stored === '1' && blocked.set === '2');
    assert.ok(blockedOk, tag + ': a blocked localStorage fails nothing: ' + JSON.stringify(blocked));
    await js(`localStorage.removeItem('durbar.logo')`);
    await H.load({ w, h, ready: 'fit' });
    assert.strictEqual((await bar()).logo, '1', `${tag}: back to the default`);
    assert.deepStrictEqual(await winIcon(), iconsBefore, `${tag}: no icon, Dock or overlay call is offered to the page, before or after a pick (FR-037)`);

    // ---- every icon on every flat theme (FR-034) ----
    const palettes = async (label, expect) => {
      let here = null; // a theme may place the name differently from Clean: every icon on one theme keeps that theme's tile and name position
      for (const id of IDS) {
        await setLogo(id);
        const b = await bar();
        here = here || { w: b.w, h: b.h, h1x: b.h1x, h1y: b.h1y };
        assert.deepStrictEqual({ w: b.w, h: b.h, h1x: b.h1x, h1y: b.h1y }, here, `${tag} ${label} icon ${id}: tile size and name position unchanged: ${JSON.stringify(b)}`);
        assert.deepStrictEqual([b.w, b.h], [32, 32], `${tag} ${label} icon ${id}: the tile is 32 px`);
        assert.strictEqual(b.img, 0, `${tag} ${label} icon ${id}: no <img>`);
        const e = expect(id, b);
        for (const [k, v] of Object.entries(e)) if (b[k] !== null) assert.strictEqual(b[k], v, `${tag} ${label} icon ${id}: ${k} is ${v}, got ${b[k]}`);
        assert.ok(!b.plateShown && b.shapes >= 5 && (b.gold !== null || b.bot !== null), `${tag} ${label} icon ${id}: drawn`);
        await shot(`logo-${id}-${label}-${tag}`);
      }
    };
    await palettes('clean', (id) => ({ bg: rgb(PLATE[id]), gold: rgb('#FFC21A'), bot: rgb('#C2DEFF'), eye: rgb('#0E1420') }));
    for (const t of UI_THEMES) {
      await js(`window.THEME.setTheme(${jsLiteral(t)})`);
      assert.ok(await until(`window.THEME.current().id===${jsLiteral(t)}&&!!document.documentElement.dataset.ui`, 4000), `${tag}: theme ${t} applied`);
      await H.settle();
      await palettes(t, (id, b) => ({ bg: rgb(b.brandBg), eye: rgb(b.brandBg), screen: rgb(b.brandBg), gold: rgb(b.brandMark), bot: rgb(b.brandMark), cream: rgb(b.brandMark) }));
    }
    await js(`window.THEME.setTheme(${jsLiteral(GENERATED)})`);
    assert.ok(await until(`document.documentElement.dataset.ui==='retro'`, 4000), `${tag}: a generated theme applied`);
    await H.settle();
    await palettes('generated', (id, b) => ({ bg: rgb('#7a1fa2'), gold: rgb('#ffffff'), bot: rgb('#ffffff'), eye: rgb('#7a1fa2') }));
    await js(`window.THEME.setTheme('clean-office')`);
    assert.ok(await until(`!document.documentElement.dataset.ui`, 4000), `${tag}: back to Clean Office`);
    await H.settle();

    // ---- a world wins over the theme; no approved palette falls back (FR-033) ----
    for (const [world, p] of Object.entries(WORLDS)) {
      await js(`document.documentElement.dataset.world=${jsLiteral(world)}`);
      await palettes('world-' + world, () => ({ bg: rgb(p.plate), gold: rgb(p.gold), bot: rgb(p.bot) }));
    }
    await js(`window.THEME.setTheme('retro')`);
    assert.ok(await until(`document.documentElement.dataset.ui==='retro'`, 4000), `${tag}: retro again`);
    await H.settle();
    await js(`document.documentElement.dataset.world='photo'`);
    await palettes('retro-in-photo', () => ({ bg: rgb(WORLDS.photo.plate), gold: rgb(WORLDS.photo.gold) })); // the world is still set: it wins over the theme
    await js(`window.THEME.setTheme('clean-office')`); await H.settle();
    await js(`document.documentElement.dataset.world='country'`);
    await palettes('world-none', (id) => ({ bg: rgb(PLATE[id]), gold: rgb('#FFC21A') })); // a world with no palette: the base palette
    await js(`delete document.documentElement.dataset.world`);

    // ---- forced colours (FR-036) ----
    await forced(true);
    for (const id of IDS) {
      await setLogo(id);
      const f = await js(`(()=>{const m=document.querySelector('.brand-mark'),s=m.querySelector('svg'),C=e=>getComputedStyle(e),f=k=>{const e=s.querySelector('[data-slot="'+k+'"]');return e?C(e).fill:null;};const t=document.createElement('i');t.style.color='CanvasText';document.body.appendChild(t);const ct=getComputedStyle(t).color;t.style.color='Canvas';const cv=getComputedStyle(t).color;t.remove();
        return {ct,cv,bg:C(m).backgroundColor,gold:f('gold'),bot:f('bot'),cream:f('cream'),eye:f('eye'),screen:f('screen'),w:Math.round(m.getBoundingClientRect().width),outline:C(m).outlineStyle}})()`);
      assert.deepStrictEqual([f.gold, f.bot, f.cream].filter(Boolean), [f.gold, f.bot, f.cream].filter(Boolean).map(() => f.ct), `${tag} forced icon ${id}: light parts are CanvasText: ${JSON.stringify(f)}`);
      assert.deepStrictEqual([f.eye, f.screen].filter(Boolean), [f.eye, f.screen].filter(Boolean).map(() => f.cv), `${tag} forced icon ${id}: dark parts are Canvas: ${JSON.stringify(f)}`);
      assert.strictEqual(f.bg, f.cv, `${tag} forced icon ${id}: the tile is Canvas`);
      assert.ok(f.outline !== 'none' && f.w === 32, `${tag} forced icon ${id}: a CanvasText line, same size: ${JSON.stringify(f)}`);
      await shot(`logo-${id}-forced-${tag}`);
    }
    await forced(false);

    // ---- the tight top bar keeps the tile (edge case) and the app name is still read ----
    await js(`window.DurbarLogo.set('1')`);
    assert.strictEqual(await js(`document.querySelector('.brand h1').textContent.trim()`), 'Agent Durbar', `${tag}: the name is still read beside the tile`);
    console.log('[logo-family]', tag, 'ok');
  }
  await js(`localStorage.removeItem('durbar.logo')`);
  console.log('[logo-family] pictures in', out);
  console.log('[logo-family] all checks passed');
};
