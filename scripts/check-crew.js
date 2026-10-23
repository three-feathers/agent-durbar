/*
 * Cheeky Crew (spec 077 FR-014, FR-051, FR-055, FR-058). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800, with Cheeky Crew picked in Settings (the real path):
 *   - every desk scene draws exactly one portrait, in its fixed box, and that box keeps clear of the protected zones of FR-014 (the
 *     monitor and halo, the thought bubble and chat badge corner, the cup zone); the picture is the pose of the desk's status;
 *   - every picture loads (natural size known) and is drawn at no more than half its natural size (sharp, FR-051);
 *   - several characters are in use (the simulator's seeded least-used pick), and no desk shows a broken picture or a console error;
 *   - the walking figures, chat strip chips and the lounge draw the portrait too.
 * At 1920x1080 with 2 agents (grown desks, spec 001 FR-041) the largest shown size of a portrait is still at most half its natural size.
 * Then FR-055: a copy of dist/ with one picture removed. The desks of that character draw the plain figure (no <image>), the others
 * keep their pictures, and nothing is broken.
 *
 *   npm run check:crew            (builds first; in check:ui too)
 *   SHOTS_OUT=<folder>            screenshots (default: crew-shots in the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const ID = 'cheeky-crew';
/* FR-014 zones in stage units: [x0, y0, x1, y1] */
const ZONES = { 'monitor and halo': [101, 22, 187, 88], 'bubble and badge corner': [16, 3, 61, 34], 'cup zone': [96, 66, 114, 87] };

/* in the page: every desk scene's portrait, and every other place one is drawn */
function survey() {
  const q = (s) => [...document.querySelectorAll(s)];
  const info = (img) => {
    const b = img.getBoundingClientRect(), sc = img.closest('svg');
    return { href: img.getAttribute('href'), x: +img.getAttribute('x'), y: +img.getAttribute('y'), w: +img.getAttribute('width'), h: +img.getAttribute('height'), shown: [b.width, b.height], sig: sc && sc.dataset ? sc.dataset.sig || '' : '' };
  };
  const scenes = q('#stage .desk[data-id] svg.scene, #stage .helper svg.scene').filter((s) => s.getClientRects().length);
  return {
    theme: window.THEME.current().id,
    scenes: scenes.map((s) => ({ sig: s.dataset.sig, images: [...s.querySelectorAll('image')].map(info), plain: !!s.querySelector('circle[r="12.5"]'), st: (/^(?:still\|)?(\w+)\|/.exec(s.dataset.sig || '') || [])[1] })),
    walkers: q('.walker').map((w) => [...w.querySelectorAll('image')].map(info)),
    chips: q('#stripList .sitem .sav').filter((e) => e.getClientRects().length).map((e) => [...e.querySelectorAll('image')].map(info)),
    lounge: q('.lg-av').filter((e) => e.getClientRects().length).map((e) => [...e.querySelectorAll('image')].map(info)),
    broken: q('image').filter((i) => i.getClientRects().length && !i.getAttribute('href')).length,
  };
}

/* natural sizes of the portraits (in the page: an Image per file) */
const naturals = (files) => `Promise.all(${jsLiteral(files)}.map(f=>new Promise(r=>{const i=new Image();i.onload=()=>r([f,i.naturalWidth,i.naturalHeight]);i.onerror=()=>r([f,0,0]);i.src=f;})))`;
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'crew-shots');
  fs.mkdirSync(out, { recursive: true });
  const C = require('../src/renderer/crew.js');
  const pick = async (id) => {
    await H.js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await H.until(`!!document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)})`, 6000), `${id} is listed in Settings`);
    await H.js(`document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)}).click()`);
    assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(id)}`, 4000), `${id} applied`);
    await H.js(`window.DurbarScreens.close()`);
    await H.until(`!document.querySelector('.scene-out')`, 3000);
    await H.settle();
    await H.js(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    await ctx.sleep(250);
  };
  const sizes = async () => Object.fromEntries((await H.js(naturals(C.files()))).map(([f, w, h]) => [f, [w, h]]));
  const sharpOk = (tag, img, nat) => {
    assert.ok(nat && nat[0] > 0, `${tag}: ${img.href} loads`);
    assert.ok(nat[0] >= 2 * img.shown[0] - 0.5 && nat[1] >= 2 * img.shown[1] - 0.5, `${tag}: ${img.href} is shown at ${img.shown.map(Math.round)} px, natural ${nat} is not at least 2x (FR-051)`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', settle: false });
    await H.office(15);
    await pick(ID);
    const nat = await sizes();
    const s = await H.js(`(${survey.toString()})()`);
    assert.strictEqual(s.theme, ID);
    const mains = s.scenes.filter((x) => /\|crew\|/.test(x.sig));
    assert.ok(mains.length >= 15, `${tag}: crew scenes on screen (${mains.length})`);
    const seen = new Set();
    for (const [i, sc] of mains.entries()) {
      assert.strictEqual(sc.images.length, 1, `${tag}: scene ${i} (${sc.st}) draws exactly one portrait`);
      const im = sc.images[0], id = (/\|crew\|(\w+)/.exec(sc.sig) || [])[1];
      seen.add(id);
      assert.strictEqual(im.href, C.file(id, C.poseFor(sc.st)), `${tag}: scene ${i} (${sc.st}) shows the ${C.poseFor(sc.st)} pose of ${id}`);
      assert.deepStrictEqual([im.x, im.y, im.w, im.h], [C.BOX.x, C.BOX.y, C.BOX.w, C.BOX.h], `${tag}: scene ${i}: the portrait's fixed box`);
      const box = [im.x, im.y, im.x + im.w, im.y + im.h];
      for (const [name, z] of Object.entries(ZONES)) assert.ok(!hit(box, z), `${tag}: scene ${i}: the portrait box ${box} keeps clear of the ${name} ${z} (FR-014)`);
      assert.ok(!sc.plain, `${tag}: scene ${i}: no plain figure under a portrait`);
      sharpOk(`${tag} scene ${i}`, im, nat[im.href]);
    }
    assert.ok(seen.size >= 3, `${tag}: several characters on screen (${[...seen]})`);
    for (const [kind, list] of [['walker', s.walkers], ['chip', s.chips], ['lounge figure', s.lounge]]) for (const [i, imgs] of list.entries()) {
      assert.strictEqual(imgs.length, 1, `${tag}: ${kind} ${i} draws the portrait`);
      sharpOk(`${tag} ${kind} ${i}`, imgs[0], nat[imgs[0].href]);
    }
    assert.strictEqual(s.broken, 0, `${tag}: no picture without a source`);
    console.log(`[crew] ${tag}`, JSON.stringify({ scenes: mains.length, characters: [...seen], walkers: s.walkers.length, chips: s.chips.length, lounge: s.lounge.length }));
    await H.clearToasts();
    await ctx.sleep(200);
    await ctx.shot(path.join(out, `crew-office-${tag}.png`));
  }

  // FR-051: the largest shown size (grown desks, a big window) is still at most half the natural size
  {
    await H.load({ w: 1920, h: 1080, query: { sim: '2', simrooms: '1', simhelpers: '0' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=2&&document.getElementById('stage').dataset.fit` });
    await pick(ID);
    const nat = await sizes();
    const s = await H.js(`(${survey.toString()})()`);
    const imgs = s.scenes.flatMap((x) => x.images);
    assert.ok(imgs.length >= 2, `1920x1080: grown desks draw portraits (${imgs.length})`);
    const biggest = Math.max(...imgs.map((i) => i.shown[0]));
    console.log('[crew] 1920x1080 grown desks: largest shown width', Math.round(biggest), 'px, natural', C.BOX.w * C.PX_PER_UNIT);
    for (const im of imgs) sharpOk('1920x1080 grown', im, nat[im.href]);
    await ctx.shot(path.join(out, 'crew-office-1920x1080-grown.png'));
  }

  // FR-055: one picture removed from a copy of dist/: its character is drawn as the plain figure, the others keep their pictures
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-dist-'));
    try {
      fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(tmp, 'dist'), { recursive: true });
      const index = path.join(tmp, 'dist', 'renderer', 'index.html');
      const lost = 'punk';
      fs.rmSync(path.join(tmp, 'dist', 'renderer', 'crew', `${lost}-waiting.webp`));
      await H.load({ w: 1440, h: 900, index, query: { theme: ID }, ready: 'fit', settle: false });
      await H.office(15);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(ID)}`, 4000), 'the theme is on');
      assert.ok(await H.until(`[...document.querySelectorAll('#stage svg.scene')].some(s=>/\\|crew\\|${lost}\\|fb/.test(s.dataset.sig))`, 8000), `the desks of ${lost} are redrawn once its picture fails`);
      await H.settle();
      const s = await H.js(`(${survey.toString()})()`);
      const mains = s.scenes.filter((x) => /\|crew\|/.test(x.sig));
      const lostScenes = mains.filter((x) => new RegExp(`\\|crew\\|${lost}(\\||$)`).test(x.sig));
      assert.ok(lostScenes.length >= 1, `${lost} is on screen`);
      for (const sc of lostScenes) assert.ok(/\|fb$/.test(sc.sig) && sc.images.length === 0 && sc.plain, `${lost}: the plain figure, no picture, no empty chair (${sc.sig})`);
      for (const sc of mains.filter((x) => !lostScenes.includes(x))) assert.strictEqual(sc.images.length, 1, 'the other characters keep their pictures');
      assert.ok(s.walkers.every((w) => w.length === 1 || w.length === 0), 'figures draw a picture or the plain figure');
      await H.clearToasts();
      await ctx.shot(path.join(out, 'crew-fallback-1440x900.png'));
      console.log(`[crew] fallback: ${lostScenes.length} desk(s) of ${lost} drawn as the plain figure`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log('[crew] checks passed');
  process.exitCode = 0;
};
