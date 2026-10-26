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
/* FR-060: the screen's frame starts here; the portrait box ends here, so the status colour is never under it */
const MONITOR_LEFT = 112, DESK_TOP = 86;

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


/* FR-060, in the page: every place a portrait is drawn, with the boxes the face must stay clear of */
function faces() {
  const q = (s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length);
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.x + b.width, b.y + b.height]; };
  const base = (svg, use, clip, extra) => {
    const im = svg.querySelector('image');
    return Object.assign({ use, href: im ? im.getAttribute('href') : '', vb: (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), svg: r(svg), clip: r(clip), covers: [] }, extra);
  };
  const out = [];
  for (const svg of q('#stage .desk[data-id]:not(.shut) svg.scene, #stage .helper svg.scene')) {
    const card = svg.closest('.desk, .helper'), covers = [];
    for (const e of card.querySelectorAll('.chatno')) if (e.getClientRects().length) covers.push(['chat badge', r(e)]);
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!n.nodeValue.trim() || p.closest('svg') || p.closest('.chatno') || !p.getClientRects().length) continue;
      covers.push(['card text', r(p)]);
    }
    const mon = svg.querySelector('rect[x="112"][y="32"]');
    out.push(base(svg, svg.closest('.helper') ? 'helper' : 'desk', svg, { covers, monitor: !!mon }));
    const im = svg.querySelector('image'), kids = [...svg.children];
    out[out.length - 1].order = im && mon ? kids.indexOf(im) < kids.indexOf(mon) : null;
  }
  for (const svg of q('.walker .wk svg')) out.push(base(svg, 'walker', svg.parentElement));
  for (const svg of q('.lg-av:not(.lying) svg')) {
    const av = svg.parentElement, couch = av.closest('.lg-couch'), sofa = couch && couch.querySelector('.lg-sofa'), name = av.parentElement.querySelector('.lg-name');
    const covers = name ? [['name label', r(name)]] : [];
    for (const e of av.parentElement.querySelectorAll('.chatno')) if (e.getClientRects().length) covers.push(['chat badge', r(e)]);
    const x = base(svg, 'seat', av, { covers });
    x.sofaBehind = !!sofa && !!(sofa.compareDocumentPosition(av) & Node.DOCUMENT_POSITION_FOLLOWING) && +getComputedStyle(sofa).zIndex <= (+getComputedStyle(av).zIndex || 0);
    x.back = sofa ? r(sofa.querySelector('.sf-back')) : null;
    out.push(x);
  }
  return out;
}

/* FR-061, in the page: the opacity a node really shows at is its own times its ancestors' */
function idleOpacity() {
  const eff = (e) => { let o = 1; for (; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const q = (s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length);
  return q('#stage .desk.is-idle svg.scene, #stage .helper.is-idle svg.scene').map((svg) => {
    const pic = svg.querySelector('image.crew-pic'), rest = [...svg.children].filter((c) => c !== pic && c.tagName !== 'defs');
    return { pic: pic ? eff(pic) : null, rest: Math.min(...rest.map(eff)), text: eff(svg.closest('.desk, .helper').querySelector('.info, .hinfo') || svg) };
  });
}

/* spec 001 FR-178 with spec 077: the desk glow and the person's zoom (.pp scaled by --hl-e about the chair, 74 99). In the page: each desk with a
   portrait at the peak of its entry pulse, with what the face must stay clear of. Each desk gets the New class, then the waiting class, for the
   measurement only (synchronous, so the app never redraws in between). */
function glowZoom() {
  const out = [];
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.x + b.width, b.y + b.height]; };
  for (const d of document.querySelectorAll('#stage .desk[data-id]:not(.shut)')) {
    if (!d.getClientRects().length || d.classList.contains('is-away')) continue;
    const svg = d.querySelector('svg.scene'), pp = svg && svg.querySelector('.pp'), im = svg && svg.querySelector('image.crew-pic');
    if (!pp || !im) continue;
    if (d.matches('.is-failing,.is-retrying,.is-error')) continue; // no glow on these (FR-178)
    const had = d.className;
    for (const needs of [false, true]) { // both glows on every desk: New (zoom 1.15), then needs you (1.25)
      d.className = had; d.classList.remove('is-waiting', 'is-unread'); d.classList.add(needs ? 'is-waiting' : 'is-unread');
      const e = parseFloat(getComputedStyle(d).getPropertyValue('--hl-e')) || 1, saved = pp.style.cssText;
      pp.style.animation = 'none'; pp.style.transform = `scale(${e})`;
      const covers = [];
      for (const c of d.querySelectorAll('.chatno')) if (c.getClientRects().length) covers.push(['chat badge', r(c)]);
      const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement; if (n.nodeValue.trim() && !p.closest('svg') && !p.closest('.chatno') && p.getClientRects().length) covers.push(['card text', r(p)]); }
      out.push({ kind: needs ? 'needs you' : 'new', e, href: im.getAttribute('href'), vb: (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), svg: r(svg), card: r(d), covers,
        glow: getComputedStyle(d, '::after').boxShadow !== 'none', ink: getComputedStyle(d).getPropertyValue('--hl').trim() });
      pp.style.cssText = saved;
    }
    d.className = had;
  }
  return out;
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

  /* FR-060: for each use at this size, the drawn face box is inside what is visible, and the things that must stay readable are not on it */
  const faceChecks = async (tag) => {
    const list = await H.js(`(${faces.toString()})()`);
    const uses = {};
    for (const f of list) {
      if (!f.href) continue; // the plain figure (fallback) has no picture
      const m = /crew\/art\/([\w-]+)-(working|waiting|resting)\.webp/.exec(f.href);
      assert.ok(m, `${tag}: ${f.use}: a crew picture (${f.href})`);
      const [id, pose] = [m[1], m[2]];
      const fb = C.faceBox(id, pose); // stage units
      const [vx, vy, vw, vh] = f.vb, R = f.svg;
      const sc = Math.min((R[2] - R[0]) / vw, (R[3] - R[1]) / vh), ox = R[0] + ((R[2] - R[0]) - vw * sc) / 2, oy = R[1] + ((R[3] - R[1]) - vh * sc) / 2;
      const px = [ox + (fb[0] - vx) * sc, oy + (fb[1] - vy) * sc, ox + (fb[0] + fb[2] - vx) * sc, oy + (fb[1] + fb[3] - vy) * sc];
      const where = `${tag} ${f.use} ${id}-${pose}`;
      uses[f.use] = (uses[f.use] || 0) + 1;
      // inside the visible clip: the view box, the element's own box
      const eps = 0.75;
      assert.ok(fb[0] >= vx - 1e-6 && fb[1] >= vy - 1e-6 && fb[0] + fb[2] <= vx + vw + 1e-6 && fb[1] + fb[3] <= vy + vh + 1e-6, `${where}: the face box ${fb.map((n) => +n.toFixed(1))} is inside the view box ${f.vb}`);
      assert.ok(px[0] >= f.clip[0] - eps && px[1] >= f.clip[1] - eps && px[2] <= f.clip[2] + eps && px[3] <= f.clip[3] + eps, `${where}: the face box ${px.map(Math.round)} is inside the visible clip ${f.clip.map(Math.round)}`);
      if (f.use === 'walker') { // a round clip: the four corners of the face box are inside the circle
        const cx = (f.clip[0] + f.clip[2]) / 2, cy = (f.clip[1] + f.clip[3]) / 2, rad = Math.min(f.clip[2] - f.clip[0], f.clip[3] - f.clip[1]) / 2;
        for (const [x, y] of [[px[0], px[1]], [px[2], px[1]], [px[0], px[3]], [px[2], px[3]]]) assert.ok(Math.hypot(x - cx, y - cy) <= rad + 0.5, `${where}: a corner of the face box is outside the round avatar`);
        assert.ok((px[2] - px[0]) >= 0.35 * (f.clip[2] - f.clip[0]), `${where}: the face fills the circle (${Math.round(px[2] - px[0])} of ${Math.round(f.clip[2] - f.clip[0])} px)`);
      }
      if (f.use === 'desk' || f.use === 'helper') {
        assert.ok(f.order === true, `${where}: the portrait is drawn before (under) the monitor and the desk`);
        assert.ok(fb[0] + fb[2] <= MONITOR_LEFT && fb[1] + fb[3] <= DESK_TOP, `${where}: the face is left of the monitor and its chin above the desk top`);
        for (const [name, z] of Object.entries(ZONES)) assert.ok(!hit([fb[0], fb[1], fb[0] + fb[2], fb[1] + fb[3]], z), `${where}: the face keeps clear of the ${name}`);
      }
      // a seat is small (about 38 px) and its chat-number badge sits on its top-left corner by design (spec 074): there the eyes-and-nose
      // core of the face box (its middle half) must be clear of the badge; everywhere else the whole face box must be
      for (const [name, c] of f.covers) {
        if (f.use === 'seat' && name === 'chat badge' && f.clip[2] - f.clip[0] < 30) continue; // a 20 px seat (1280x800) is smaller than its own number badge, whatever the picture
        const core = f.use === 'seat' && name === 'chat badge' ? [px[0] + 0.25 * (px[2] - px[0]), px[1] + 0.25 * (px[3] - px[1]), px[2] - 0.25 * (px[2] - px[0]), px[3] - 0.25 * (px[3] - px[1])] : px;
        const dx = Math.min(core[2], c[2]) - Math.max(core[0], c[0]), dy = Math.min(core[3], c[3]) - Math.max(core[1], c[1]); // overlap depth, 1.5 px of sub-pixel slack
        assert.ok(!(dx > 1.5 && dy > 1.5), `${where}: the face box ${core.map(Math.round)} is not under the ${name} ${c.map(Math.round)}`);
      }
      if (f.use === 'seat') {
        assert.ok(f.sofaBehind, `${where}: the couch is drawn behind the figure, its back does not cover the face`);
        assert.ok(px[1] >= f.clip[1] - eps, `${where}: the head is not cut at the top`);
      }
    }
    for (const u of ['desk', 'helper', 'walker', 'seat']) assert.ok(uses[u] >= 1, `${tag}: a ${u} portrait is on screen to check (${JSON.stringify(uses)})`);
    console.log(`[crew] ${tag} faces`, JSON.stringify(uses));
    /* the seat's shown size and its chat badge's, for the spec's known gap (the badge check is skipped below 30 px) */
    const seats = list.filter((f) => f.use === 'seat' && f.href).map((f) => ({ seat: [Math.round(f.clip[2] - f.clip[0]), Math.round(f.clip[3] - f.clip[1])], badge: (f.covers.find(([n]) => n === 'chat badge') || [, null])[1] }));
    console.log(`[crew] ${tag} seats`, JSON.stringify(seats.map((s) => ({ seat: s.seat, badge: s.badge && [Math.round(s.badge[2] - s.badge[0]), Math.round(s.badge[3] - s.badge[1])] }))));
  };
  const sizes = async () => Object.fromEntries((await H.js(naturals(C.files()))).map(([f, w, h]) => [f, [w, h]]));
  const sharpOk = (tag, img, nat) => {
    assert.ok(nat && nat[0] > 0, `${tag}: ${img.href} loads`);
    assert.ok(nat[0] >= 2 * img.shown[0] - 0.5 && nat[1] >= 2 * img.shown[1] - 0.5, `${tag}: ${img.href} is shown at ${img.shown.map(Math.round)} px, natural ${nat} is not at least 2x (FR-051)`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', settle: false });
    // spec 017: with the cabins on (the default) a busy or waiting desk is a closed door, not a scene; this step measures the scenes, so the cabins are off here (the cabin portrait is checked below)
    if (await H.js(`localStorage.getItem('durbar.doorsigns')!=='off'`)) { await H.js(`localStorage.setItem('durbar.doorsigns','off')`); await H.load({ w, h, ready: 'fit', settle: false }); }
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
      const im = sc.images[0], id = (/\|crew\|([\w-]+)/.exec(sc.sig) || [])[1];
      seen.add(id);
      assert.strictEqual(im.href, C.file(id, C.poseFor(sc.st)), `${tag}: scene ${i} (${sc.st}) shows the ${C.poseFor(sc.st)} pose of ${id}`);
      assert.deepStrictEqual([im.x, im.y, im.w, im.h], [C.BOX.x, C.BOX.y, C.BOX.w, C.BOX.h], `${tag}: scene ${i}: the portrait's fixed box`);
      const box = [im.x, im.y, im.x + im.w, im.y + im.h];
      assert.ok(box[2] <= MONITOR_LEFT, `${tag}: scene ${i}: the portrait box ${box} ends before the monitor frame (x ${MONITOR_LEFT}), so the status colour is not covered`);
      assert.ok(!sc.plain, `${tag}: scene ${i}: no plain figure under a portrait`);
      sharpOk(`${tag} scene ${i}`, im, nat[im.href]);
    }
    await faceChecks(tag);
    assert.ok(seen.size === C.IDS.length, `${tag}: all ${C.IDS.length} characters on screen with 15 agents (least-used pick) (${[...seen]})`);
    for (const [kind, list] of [['walker', s.walkers], ['chip', s.chips], ['lounge figure', s.lounge]]) for (const [i, imgs] of list.entries()) {
      assert.strictEqual(imgs.length, 1, `${tag}: ${kind} ${i} draws the portrait`);
      sharpOk(`${tag} ${kind} ${i}`, imgs[0], nat[imgs[0].href]);
    }
    assert.strictEqual(s.broken, 0, `${tag}: no picture without a source`);
    console.log(`[crew] ${tag}`, JSON.stringify({ scenes: mains.length, characters: [...seen], walkers: s.walkers.length, chips: s.chips.length, lounge: s.lounge.length }));
    await H.clearToasts();
    await ctx.sleep(200);
    await ctx.shot(path.join(out, `crew-office-${tag}.png`));
    // FR-061: an idle desk's portrait is full colour; its furniture keeps the dim
    const idle = await H.js(`(${idleOpacity.toString()})()`);
    assert.ok(idle.length >= 1, `${tag}: an idle desk or helper is on screen (${idle.length})`);
    for (const x of idle) {
      assert.ok(x.pic !== null, `${tag}: an idle scene draws its portrait`);
      assert.ok(Math.abs(x.pic - 1) < 1e-3, `${tag}: an idle portrait shows at full colour (opacity ${x.pic})`);
      assert.ok(x.rest < 0.9, `${tag}: the furniture of an idle crew desk stays dimmed (opacity ${x.rest})`);
    }
    // spec 001 FR-178: the New glow and the needs-you glow, with the person zoomed at the peak of the pulse: the face stays inside its card and clear of the text and the badge
    const gz = await H.js(`(${glowZoom.toString()})()`);
    assert.ok(gz.length >= 1, `${tag}: a desk to measure the glow on`);
    for (const g of gz) {
      const m = /crew\/art\/([\w-]+)-(working|waiting|resting)\.webp/.exec(g.href), fb = C.faceBox(m[1], m[2]), [vx, vy] = g.vb;
      const z = (p, o) => o + (p - o) * g.e, X = (u) => z(u, 74), Y = (u) => z(u, 99); // the zoom about the chair, in stage units
      const [u0, v0, u1, v1] = [X(fb[0]), Y(fb[1]), X(fb[0] + fb[2]), Y(fb[1] + fb[3])];
      const R = g.svg, sc = Math.min((R[2] - R[0]) / g.vb[2], (R[3] - R[1]) / g.vb[3]), ox = R[0] + ((R[2] - R[0]) - g.vb[2] * sc) / 2, oy = R[1] + ((R[3] - R[1]) - g.vb[3] * sc) / 2;
      const px = [ox + (u0 - vx) * sc, oy + (v0 - vy) * sc, ox + (u1 - vx) * sc, oy + (v1 - vy) * sc], where = `${tag} ${g.kind} ${m[1]}-${m[2]} (zoom ${g.e})`;
      assert.ok(g.glow && g.e > 1 && g.ink, `${where}: the glow and a zoom are on`);
      assert.ok(px[0] >= g.card[0] - 0.5 && px[1] >= g.card[1] - 0.5 && px[2] <= g.card[2] + 0.5 && px[3] <= g.card[3] + 0.5, `${where}: the zoomed face ${px.map(Math.round)} stays inside its card ${g.card.map(Math.round)}`);
      for (const [name, c] of g.covers) {
        const dx = Math.min(px[2], c[2]) - Math.max(px[0], c[0]), dy = Math.min(px[3], c[3]) - Math.max(px[1], c[1]);
        assert.ok(!(dx > 1.5 && dy > 1.5), `${where}: the zoomed face ${px.map(Math.round)} is not under the ${name} ${c.map(Math.round)}`);
      }
      // the picture is under the monitor in the drawing order (asserted above), so a zoomed edge goes behind the screen frame, never over it
    }
    console.log(`[crew] ${tag} glow`, JSON.stringify({ desks: gz.length, needs: gz.filter((g) => g.kind === 'needs you').length, zoom: [...new Set(gz.map((g) => g.e))] }));
    // the other themes keep the whole scene dimmed
    await pick('clean-office');
    const plain = await H.js(`(${idleOpacity.toString()})()`);
    assert.ok(plain.length >= 1 && plain.every((x) => x.pic === null && x.rest < 0.9), `${tag}: an idle Clean Office scene is still dimmed (${JSON.stringify(plain.slice(0, 2))})`);
    console.log(`[crew] ${tag} idle`, JSON.stringify({ crew: idle.length, cleanOffice: plain.length }));
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
  // The log's "refused a call that did not come from its own window" for 'app:version' is expected here: the sender guard accepts only the real dist index, and this step loads a temp copy
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-dist-'));
    try {
      fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(tmp, 'dist'), { recursive: true });
      const index = path.join(tmp, 'dist', 'renderer', 'index.html');
      const lost = 'punk';
      fs.rmSync(path.join(tmp, 'dist', 'renderer', 'crew', 'art', `${lost}-waiting.webp`));
      await H.load({ w: 1440, h: 900, index, query: { theme: ID }, ready: 'fit', settle: false });
      await H.office(15);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(ID)}`, 4000), 'the theme is on');
      assert.ok(await H.until(`[...document.querySelectorAll('#stage svg.scene')].some(s=>(s.dataset.sig||'').includes(${jsLiteral('|crew|' + lost + '|fb')}))`, 8000), `the desks of ${lost} are redrawn once its picture fails`);
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
