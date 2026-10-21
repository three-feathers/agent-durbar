/*
 * Theme art everywhere (spec 040 FR-023, owner report 2026-10-21): a theme's characters and gadgets show on every surface the moment
 * the theme is picked, not only in the chat's agent strip. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits: the theme is
 * the sample AI-style pack `scripts/fixtures/themes/pink-studio.json` ("Pink Studio"), loaded as a user theme and picked in Settings,
 * the same path as a saved AI theme.
 *
 * At 1440x900 and 1280x800 it checks, after the switch from Clean Office (no reload):
 *   - office desks: every desk scene (main and helper) draws the pack's character (char-robe, char-collar, char-headwear) and gadgets
 *     (desk-art, monitor-art), and the pack's robe pink and chair colour are on screen inside every main desk scene (pixels);
 *   - walkers: every figure away in the lobby wears the pack's robe (attribute), with robe pixels inside it;
 *   - lobby places: the pack's place icons and lobby art are drawn;
 *   - the chat's agent strip: every chip's avatar wears the robe;
 *   - spec 070: the pack's clothes (figures.shirts) on every desk, walker and chip, its cup on idle desks and its laptop on every desk,
 *     and its fonts, corner radius and card shadow in the computed styles;
 *   - and back to Clean Office: no desk, walker or chip keeps the pack's art (the stale-drawing bug in reverse).
 *
 *   npm run check:theme-art            (builds first; in check:ui too)
 *   SHOTS_OUT=<folder>                 screenshots (default /tmp/theme-art-shots)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'pink-studio.json'), 'utf8'));
/* the pack's pinks (robe #e0218a, chair --chair #c2185b, headband), also when an idle desk is drawn at .7 opacity over its card;
   Clean Office has no such colour (its reds and skins fail the blue test) */
const SHIRTS = (PACK.figures && PACK.figures.shirts) || [];
const PINK = (r, g, b) => r >= 170 && r - g >= 70 && b - g >= 25;
const CHAIR = (r, g, b) => Math.abs(r - 0xc2) <= 14 && Math.abs(g - 0x18) <= 14 && Math.abs(b - 0x5b) <= 14;

/* in the page: what each surface draws (`shirts`: the pack's clothes colours, spec 070 FR-010) */
function survey(shirts) {
  const wears = (el) => shirts.some((c) => !!el.querySelector(`[fill="${c}"]`));
  const q = (s) => [...document.querySelectorAll(s)];
  const has = (el, slot) => !!el.querySelector(`[data-slot="${slot}"]`);
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
  const deskScenes = q('#stage .desk[data-id] svg.scene, #stage .helper svg.scene').filter((s) => s.getClientRects().length);
  // main desks whose agent sits at the desk (an agent away at a place leaves an empty chair: its figure is a walker)
  const mainScenes = q('#stage .desk[data-id]:not(.is-away) svg.scene').filter((s) => s.getClientRects().length && !s.closest('.helper'));
  return {
    theme: window.THEME.current().id,
    desks: deskScenes.map((s) => ({ shirt: wears(s), cup: has(s, 'gadget-cup'), laptop: has(s, 'gadget-laptop'), idle: /^(still\|)?idle\|/.test(s.dataset.sig || ''), robe: has(s, 'char-robe'), collar: has(s, 'char-collar'), hat: has(s, 'char-headwear'), deskArt: has(s, 'desk-art'), monitor: has(s, 'monitor-art'), anyArt: !!s.querySelector('.art-slot') })),
    mainBoxes: mainScenes.map((s) => ({ box: box(s), st: (/^(\w+)\|/.exec(s.dataset.sig || '') || [])[1] })),
    walkers: q('.walker').map((w) => ({ shirt: wears(w), robe: has(w, 'char-robe'), hat: has(w, 'char-headwear'), anyArt: !!w.querySelector('.art-slot'), box: box(w.querySelector('svg') || w) })),
    places: q('#stage .place [data-slot^="place-"]').map((e) => e.getAttribute('data-slot')),
    lobbyArt: q('#stage .lobby-art[data-slot="lobby-art"]').length,
    chips: q('#stripList .sitem .sav').filter((e) => e.getClientRects().length).map((e) => ({ shirt: wears(e), robe: has(e, 'char-robe'), anyArt: !!e.querySelector('.art-slot') })),
    css: (() => {
      const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : ''; };
      return { font: getComputedStyle(document.body).fontFamily, mono: cs('.room-path', 'fontFamily'), radius: cs('.select-wrap select', 'borderTopLeftRadius'), shadow: cs('#stage .desk.card:not(.is-waiting):not(.is-error):not(.is-failing)', 'boxShadow'), plate: cs('.plate-tx b', 'fontFamily') };
    })(),
  };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || '/tmp/theme-art-shots';
  fs.mkdirSync(out, { recursive: true });
  /* pixels of a page rectangle that pass a colour test (BGRA bitmap of capturePage) */
  const count = async (rect, test) => {
    const img = await ctx.win.webContents.capturePage({ x: rect[0], y: rect[1], width: Math.max(1, rect[2]), height: Math.max(1, rect[3]) });
    const { width, height } = img.getSize();
    const buf = img.toBitmap();
    let n = 0;
    for (let i = 0; i < width * height * 4; i += 4) if (test(buf[i + 2], buf[i + 1], buf[i])) n++;
    return n;
  };
  const pick = async (id) => {
    await H.js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await H.until(`!!document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)})`, 6000), `${id} is listed in Settings`);
    await H.js(`document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)}).click()`);
    assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(id)}`, 4000), `${id} applied`);
    await H.until(`!!document.querySelector('.scr-head h2')`, 3000);
    const titleFont = await H.js(`(()=>{const h=document.querySelector('.scr-head h2');return h?getComputedStyle(h).fontFamily:''})()`); // spec 070: the display font
    await H.js(`window.DurbarScreens.close()`);
    await H.until(`!document.querySelector('.scene-out')`, 3000); // the 180 ms cross-fade of the redrawn desks is over
    await H.settle();
    // painted before the pixels are read: the first capture after the view transition can be blank
    await H.js(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    await ctx.sleep(250);
    return titleFont;
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    // Clean Office first (the theme in use when an AI theme is made or picked), the pack only registered as a user theme
    await H.load({ w, h, query: { usertheme: JSON.stringify(PACK) }, ready: 'fit', settle: false });
    await H.office(15);
    assert.ok(await H.until(`!!document.querySelector('.walker')`, 6000), `${tag}: agents walk to the lobby`);
    await H.until(`!document.querySelector('.walker.walking')`, 6000);
    const before = await H.js(`(${survey.toString()})(${jsLiteral(SHIRTS)})`);
    assert.strictEqual(before.theme, 'clean-office');
    assert.ok(before.desks.every((d) => !d.anyArt), `${tag}: Clean Office draws no theme art`);

    const title = await pick(PACK.id);
    assert.ok(/Didot/.test(title), `${tag}: Settings titles use the pack's display font (${title})`);
    const s = await H.js(`(${survey.toString()})(${jsLiteral(SHIRTS)})`);
    console.log(`[theme-art] ${tag}`, JSON.stringify({ desks: s.desks.length, walkers: s.walkers.length, places: s.places, lobbyArt: s.lobbyArt }));
    assert.ok(s.desks.length >= 15, `${tag}: desks on screen (${s.desks.length})`);
    s.desks.forEach((d, i) => {
      for (const k of ['robe', 'collar', 'hat', 'deskArt', 'monitor']) assert.ok(d[k], `${tag}: desk scene ${i} draws the pack's ${k} (was the Clean Office drawing kept?)`);
    });
    // spec 070: clothes, gadgets, fonts, corners and shadows
    s.desks.forEach((d, i) => {
      assert.ok(d.shirt, `${tag}: desk scene ${i} dresses the person in the pack's clothes`);
      assert.ok(d.laptop, `${tag}: desk scene ${i} draws the pack's laptop`);
      if (d.idle) assert.ok(d.cup, `${tag}: idle desk scene ${i} draws the pack's cup`);
    });
    assert.ok(s.desks.some((d) => d.idle), `${tag}: an idle desk shows the cup`);
    s.walkers.forEach((wk, i) => assert.ok(wk.shirt, `${tag}: walker ${i} wears the pack's clothes`));
    assert.ok(/Avenir Next/.test(s.css.font), `${tag}: body font is the pack's (${s.css.font})`);
    assert.strictEqual(s.css.radius, PACK.tokens['--r-md'], `${tag}: controls use the pack's --r-md`);
    assert.ok(/rgba\(224, 33, 138, 0\.16\)/.test(s.css.shadow), `${tag}: desk cards use the pack's --shadow-card (${s.css.shadow})`);
    console.log(`[theme-art] ${tag} css`, JSON.stringify(s.css));
    for (const [i, b] of s.mainBoxes.entries()) assert.ok(await count(b.box, PINK) >= 40, `${tag}: desk ${i} (${b.st}) shows the pack's pinks on screen`);
    const awake = s.mainBoxes.filter((b) => b.st !== 'idle');
    for (const [i, b] of awake.entries()) assert.ok(await count(b.box, CHAIR) >= 20, `${tag}: desk ${i} shows the pack's chair colour on screen`);
    assert.ok(s.walkers.length >= 1, `${tag}: somebody is at a place`);
    for (const [i, wk] of s.walkers.entries()) {
      assert.ok(wk.robe && wk.hat, `${tag}: walker ${i} wears the pack's robe and headwear`);
      assert.ok(await count(wk.box, PINK) >= 2, `${tag}: walker ${i} shows the pack's pink on screen`);
    }
    for (const p of ['place-library', 'place-terminal', 'place-web']) assert.ok(s.places.includes(p), `${tag}: the lobby draws the pack's ${p} icon`);
    assert.strictEqual(s.lobbyArt, 1, `${tag}: the lobby draws the pack's lobby art`);
    await H.shot(path.join(out, `040-theme-art-office-${tag}.png`), { prep: 'toasts', tag: 'theme-art' });

    // the chat's agent strip (the one place where the art did show before the fix)
    await H.js(`document.querySelector('#stage .desk[data-id]').click()`);
    assert.ok(await H.until(`document.body.classList.contains('panel-open')`, 4000), `${tag}: the chat opens`);
    await H.settle();
    const chat = await H.js(`(${survey.toString()})(${jsLiteral(SHIRTS)})`);
    assert.ok(chat.chips.length >= 1, `${tag}: the agent strip is on screen`);
    chat.chips.forEach((c, i) => assert.ok(c.robe && c.shirt, `${tag}: chip ${i} wears the robe and the pack's clothes`));
    await H.shot(path.join(out, `040-theme-art-chat-${tag}.png`), { prep: 'toasts', tag: 'theme-art' });
    await H.js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`);
    await H.until(`!document.body.classList.contains('panel-open')`);

    // and back: nothing keeps the pack's drawing
    await pick('clean-office');
    const back = await H.js(`(${survey.toString()})(${jsLiteral(SHIRTS)})`);
    assert.ok(back.desks.every((d) => !d.anyArt), `${tag}: back in Clean Office no desk keeps the pack's art`);
    assert.ok(back.walkers.every((x) => !x.anyArt), `${tag}: back in Clean Office no walker keeps the pack's art`);
    assert.ok(back.desks.every((d) => !d.shirt), `${tag}: back in Clean Office nobody wears the pack's clothes`);
    assert.deepStrictEqual(back.css, before.css, `${tag}: back in Clean Office the fonts, corners and shadows are Clean's again`);
    for (const [i, b] of back.mainBoxes.entries()) assert.strictEqual(await count(b.box, PINK), 0, `${tag}: desk ${i} has no pink left`);
  }
  console.log('[theme-art] all checks passed');
};
