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
 *   - and back to Clean Office: no desk, walker or chip keeps the pack's art (the stale-drawing bug in reverse).
 *
 *   npm run check:theme-art            (builds first; in check:ui too)
 * In the office kit it also checks the drawing order: the headwear comes after the head circle and the hair (over them, not under).
 * Then, at 1440x900, the same pack with `scene: "court-indian"`: the other scene kits get the art too (desks and walkers).
 *
 *   npm run check:theme-art            (builds first; in check:ui too)
 *   SHOTS_OUT=<folder>                 screenshots (default: theme-art-shots in the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'pink-studio.json'), 'utf8'));
/* the pack's pinks (robe #e0218a, chair --chair #c2185b, headband), also when an idle desk is drawn at .7 opacity over its card;
   Clean Office has no such colour (its reds and skins fail the blue test) */
const PINK = (r, g, b) => r >= 170 && r - g >= 70 && b - g >= 25;
const CHAIR = (r, g, b) => Math.abs(r - 0xc2) <= 14 && Math.abs(g - 0x18) <= 14 && Math.abs(b - 0x5b) <= 14;

/* in the page: what each surface draws */
function survey() {
  const q = (s) => [...document.querySelectorAll(s)];
  const has = (el, slot) => !!el.querySelector(`[data-slot="${slot}"]`);
  /* the headwear is drawn over the head circle and the hair (spec 040 FR-023): it follows both in document order */
  const hatOver = (el) => {
    const hw = el.querySelector('[data-slot="char-headwear"]');
    const circle = hw && hw.parentElement.querySelector(':scope > circle[r="12.5"]');
    const hair = circle && circle.nextElementSibling;
    const after = (a) => !!(a.compareDocumentPosition(hw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return !!(hw && circle && hair && hair !== hw && after(circle) && after(hair));
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
  const deskScenes = q('#stage .desk[data-id] svg.scene, #stage .helper svg.scene').filter((s) => s.getClientRects().length);
  // main desks whose agent sits at the desk (an agent away at a place leaves an empty chair: its figure is a walker)
  const mainScenes = q('#stage .desk[data-id]:not(.is-away) svg.scene').filter((s) => s.getClientRects().length && !s.closest('.helper'));
  return {
    theme: window.THEME.current().id,
    desks: deskScenes.map((s) => ({ robe: has(s, 'char-robe'), collar: has(s, 'char-collar'), hat: has(s, 'char-headwear'), deskArt: has(s, 'desk-art'), monitor: has(s, 'monitor-art'), hatOver: hatOver(s), anyArt: !!s.querySelector('.art-slot') })),
    mainBoxes: mainScenes.map((s) => ({ box: box(s), st: (/^(\w+)\|/.exec(s.dataset.sig || '') || [])[1] })),
    walkers: q('.walker').map((w) => ({ robe: has(w, 'char-robe'), hat: has(w, 'char-headwear'), hatOver: hatOver(w), anyArt: !!w.querySelector('.art-slot'), box: box(w.querySelector('svg') || w) })),
    places: q('#stage .place [data-slot^="place-"]').map((e) => e.getAttribute('data-slot')),
    lobbyArt: q('#stage .lobby-art[data-slot="lobby-art"]').length,
    chips: q('#stripList .sitem .sav').filter((e) => e.getClientRects().length).map((e) => ({ robe: has(e, 'char-robe'), hatOver: hatOver(e), anyArt: !!e.querySelector('.art-slot') })),
  };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'theme-art-shots');
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
    await H.js(`window.DurbarScreens.close()`);
    await H.until(`!document.querySelector('.scene-out')`, 3000); // the 180 ms cross-fade of the redrawn desks is over
    await H.settle();
    // painted before the pixels are read: the first capture after the view transition can be blank
    await H.js(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    await ctx.sleep(250);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    // Clean Office first (the theme in use when an AI theme is made or picked), the pack only registered as a user theme
    await H.load({ w, h, query: { usertheme: JSON.stringify(PACK) }, ready: 'fit', settle: false });
    await H.office(15);
    assert.ok(await H.until(`!!document.querySelector('.walker')`, 6000), `${tag}: agents walk to the lobby`);
    await H.until(`!document.querySelector('.walker.walking')`, 6000);
    const before = await H.js(`(${survey.toString()})()`);
    assert.strictEqual(before.theme, 'clean-office');
    assert.ok(before.desks.every((d) => !d.anyArt), `${tag}: Clean Office draws no theme art`);

    await pick(PACK.id);
    const s = await H.js(`(${survey.toString()})()`);
    console.log(`[theme-art] ${tag}`, JSON.stringify({ desks: s.desks.length, walkers: s.walkers.length, places: s.places, lobbyArt: s.lobbyArt }));
    assert.ok(s.desks.length >= 15, `${tag}: desks on screen (${s.desks.length})`);
    s.desks.forEach((d, i) => {
      for (const k of ['robe', 'collar', 'hat', 'deskArt', 'monitor']) assert.ok(d[k], `${tag}: desk scene ${i} draws the pack's ${k} (was the Clean Office drawing kept?)`);
      assert.ok(d.hatOver, `${tag}: desk scene ${i} draws the headwear over the head and the hair`);
    });
    for (const [i, b] of s.mainBoxes.entries()) assert.ok(await count(b.box, PINK) >= 40, `${tag}: desk ${i} (${b.st}) shows the pack's pinks on screen`);
    const awake = s.mainBoxes.filter((b) => b.st !== 'idle');
    for (const [i, b] of awake.entries()) assert.ok(await count(b.box, CHAIR) >= 20, `${tag}: desk ${i} shows the pack's chair colour on screen`);
    assert.ok(s.walkers.length >= 1, `${tag}: somebody is at a place`);
    for (const [i, wk] of s.walkers.entries()) {
      assert.ok(wk.robe && wk.hat, `${tag}: walker ${i} wears the pack's robe and headwear`);
      assert.ok(wk.hatOver, `${tag}: walker ${i} wears the headwear over the head and the hair`);
      assert.ok(await count(wk.box, PINK) >= 2, `${tag}: walker ${i} shows the pack's pink on screen`);
    }
    for (const p of ['place-library', 'place-terminal', 'place-web']) assert.ok(s.places.includes(p), `${tag}: the lobby draws the pack's ${p} icon`);
    assert.strictEqual(s.lobbyArt, 1, `${tag}: the lobby draws the pack's lobby art`);
    await H.shot(path.join(out, `040-theme-art-office-${tag}.png`), { prep: 'toasts', tag: 'theme-art' });

    // the chat's agent strip (the one place where the art did show before the fix)
    await H.js(`document.querySelector('#stage .desk[data-id]').click()`);
    assert.ok(await H.until(`document.body.classList.contains('panel-open')`, 4000), `${tag}: the chat opens`);
    await H.settle();
    const chat = await H.js(`(${survey.toString()})()`);
    assert.ok(chat.chips.length >= 1, `${tag}: the agent strip is on screen`);
    chat.chips.forEach((c, i) => assert.ok(c.robe && c.hatOver, `${tag}: chip ${i} wears the robe, the headwear over the hair`));
    await H.shot(path.join(out, `040-theme-art-chat-${tag}.png`), { prep: 'toasts', tag: 'theme-art' });
    await H.js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`);
    await H.until(`!document.body.classList.contains('panel-open')`);

    // and back: nothing keeps the pack's drawing
    await pick('clean-office');
    const back = await H.js(`(${survey.toString()})()`);
    assert.ok(back.desks.every((d) => !d.anyArt), `${tag}: back in Clean Office no desk keeps the pack's art`);
    assert.ok(back.walkers.every((x) => !x.anyArt), `${tag}: back in Clean Office no walker keeps the pack's art`);
    for (const [i, b] of back.mainBoxes.entries()) assert.strictEqual(await count(b.box, PINK), 0, `${tag}: desk ${i} has no pink left`);
  }
  /* another scene kit (spec 040 FR-023, root cause 4): app.js hands the pack's art to the kits too, so the same pack on the Indian court
     kit draws its robe, headwear and gadgets on every desk and walker */
  {
    const tag = 'court-indian 1440x900';
    const KPACK = Object.assign({}, PACK, { scene: 'court-indian' });
    await H.load({ w: 1440, h: 900, query: { usertheme: JSON.stringify(KPACK) }, ready: 'fit', settle: false });
    await H.office(15);
    assert.ok(await H.until(`!!document.querySelector('.walker')`, 6000), `${tag}: agents walk to the lobby`);
    await H.until(`!document.querySelector('.walker.walking')`, 6000);
    await pick(KPACK.id);
    assert.strictEqual(await H.js(`window.THEME.sceneKit()`), 'court-indian', `${tag}: the pack draws with the court-indian kit`);
    const s = await H.js(`(${survey.toString()})()`);
    console.log(`[theme-art] ${tag}`, JSON.stringify({ desks: s.desks.length, walkers: s.walkers.length }));
    assert.ok(s.desks.length >= 15, `${tag}: desks on screen (${s.desks.length})`);
    s.desks.forEach((d, i) => {
      for (const k of ['robe', 'hat', 'deskArt', 'monitor']) assert.ok(d[k], `${tag}: desk scene ${i} draws the pack's ${k} on the kit (does app.js pass the art?)`);
    });
    assert.ok(s.walkers.length >= 1, `${tag}: somebody is at a place`);
    s.walkers.forEach((wk, i) => assert.ok(wk.robe && wk.hat, `${tag}: walker ${i} wears the pack's robe and headwear on the kit`));
    await H.shot(path.join(out, `040-theme-art-court-indian-1440x900.png`), { prep: 'toasts', tag: 'theme-art' });
  }
  console.log('[theme-art] all checks passed');
};
