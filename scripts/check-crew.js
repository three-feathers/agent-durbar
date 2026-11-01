/*
 * Cheeky Crew (spec 077 FR-014, FR-051, FR-055, FR-058). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800, with Characters = Cheeky picked in Settings on top of the theme CREW_THEME (default Clean Office; spec 077 FR-070
 * runs it on Retro Pixel and Corporate too), both through Settings (the real path):
 *   - every desk scene draws exactly one portrait, in its fixed box, and that box keeps clear of the protected zones of FR-014 (the
 *     monitor and halo, the thought bubble and chat badge corner, the cup zone); the picture is the pose of the desk's status;
 *   - every picture loads (natural size known) and is drawn at no more than half its natural size (sharp, FR-051);
 *   - several characters are in use (the simulator gives each demo name a fitting character, spec 077 FR-073: Ada and Hugo are checked), and no desk shows a broken picture or a console error;
 *   - the walking figures, chat strip chips and the lounge draw the portrait too.
 * At 1920x1080 with 2 agents (grown desks, spec 001 FR-041) the largest shown size of a portrait is still at most half its natural size.
 * Then the review fixes of PR 621: sessions removed (the map, the helpers), a character falling back after the header and the inbox are open, and crew.js itself missing.
 * Then FR-055: a copy of dist/ with one picture removed. The desks of that character draw the plain figure (no <image>), the others
 * keep their pictures, and nothing is broken.
 *
 * Spec 077 FR-072, FR-074 (issue #815): the same checks run for the Prehistoric and Pirate crews (Characters = Prehistoric, Pirate) with their 6 characters: the desks, poses,
 * sharpness, faces, glow, idle, the bed slot at both sizes and the missing-picture fallback. The steps that do not depend on the crew (the
 * review fixes of PR 621, the missing module) run once, with Cheeky.
 *
 *   npm run check:ui -- --only check-crew            (builds first)
 *   CREW_THEME=<theme id>         the theme under the crew (default clean-office)
 *   CREW_CHARS=<cheeky|prehistoric|pirate>  run one crew only (default: both)
 *   SHOTS_OUT=<folder>            screenshots (default: crew-shots in the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

/* spec 077 FR-064..FR-066: Cheeky is a Characters choice, picked on top of a theme */
const THEME_ID = process.env.CREW_THEME || 'clean-office';
let CHARS = 'cheeky'; // the crew being checked (see RUNS)
const RUNS = process.env.CREW_CHARS ? [[process.env.CREW_CHARS, true]] : [['cheeky', true], ['prehistoric', false], ['pirate', false]]; // [Characters value, whole check (the crew-independent steps too)]
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

/* issue 871 (FR-071), in the page: every sleeper in a nap bed with the boxes its parts must keep */
function sleepers() {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.x + b.width, b.y + b.height]; };
  return [...document.querySelectorAll('#stage .lounge .desk.rest-old')].filter((d) => d.getClientRects().length).map((d) => {
    const av = d.querySelector('.lg-av'), svg = av && av.querySelector('svg'), im = svg && svg.querySelector('image');
    return { id: d.dataset.id, crew: d.classList.contains('crew-bed'), lying: !!(av && av.classList.contains('lying')), href: im ? im.getAttribute('href') : '', vb: svg ? (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number) : [],
      svg: r(svg), av: r(av), slot: r(d), bed: r(d.querySelector('.lg-bed')), name: r(d.querySelector('.lg-name')), chat: r(d.querySelector('.chatno')), lounge: r(d.closest('.lounge')), solo: !!d.closest('.lg-bunk.solo'),
      ztop: +getComputedStyle(d.querySelector('.lg-blanket')).zIndex, zav: +getComputedStyle(av).zIndex || 0 };
  });
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

async function runCrew(ctx, full) {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'crew-shots');
  fs.mkdirSync(out, { recursive: true });
  const C = require('../src/renderer/crew.js');
  const CREW_IDS = C.idsFor(CHARS), PIC_RE = /crew\/art\/(?:prehistoric-|pirate-)?([\w-]+)-(working|waiting|resting)\.webp/;
  /* one Settings pick: a theme (kind 'theme', #thList) or a Characters value (kind 'characters', #chList) */
  const pickIn = async (kind, id) => {
    const list = kind === 'theme' ? '#thList' : '#chList', sel = `${list} [data-${kind}="${id}"]`;
    await H.js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await H.until(`!!document.querySelector(${jsLiteral(sel)})`, 6000), `${kind} ${id} is listed in Settings`);
    await H.js(`document.querySelector(${jsLiteral(sel)}).click()`);
    const on = kind === 'theme' ? `window.THEME.current().id===${jsLiteral(id)}` : `window.THEME.characters()===${jsLiteral(id)}`;
    assert.ok(await H.until(on, 4000), `${kind} ${id} applied`);
    await H.js(`window.DurbarScreens.close()`);
    await H.until(`!document.querySelector('.scene-out')`, 3000);
    await H.settle();
    await H.js(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    await ctx.sleep(250);
  };
  const pick = (id) => pickIn('theme', id);
  const pickChars = (v) => pickIn('characters', v);
  /* the crew on the theme under test: the theme first, then Characters = Cheeky */
  const useCrew = async () => {
    if (await H.js(`window.THEME.current().id`) !== THEME_ID) await pick(THEME_ID);
    await pickChars(CHARS);
    assert.strictEqual(await H.js(`window.THEME.sceneKit()`), 'crew', `${THEME_ID}: Characters = ${CHARS} draws the crew kit`);
  };
  console.log(`[crew] theme ${THEME_ID}, characters ${CHARS}`);

  /* FR-060: for each use at this size, the drawn face box is inside what is visible, and the things that must stay readable are not on it */
  const faceChecks = async (tag) => {
    const list = await H.js(`(${faces.toString()})()`);
    const uses = {};
    for (const f of list) {
      if (!f.href) continue; // the plain figure (fallback) has no picture
      const m = PIC_RE.exec(f.href);
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
  const sizes = async () => Object.fromEntries((await H.js(naturals(C.files(CREW_IDS)))).map(([f, w, h]) => [f, [w, h]]));
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
    await useCrew();
    const nat = await sizes();
    const s = await H.js(`(${survey.toString()})()`);
    assert.strictEqual(s.theme, THEME_ID, 'the theme stays the one under test');
    const mains = s.scenes.filter((x) => /\|crew\|/.test(x.sig));
    assert.ok(mains.length >= 15, `${tag}: crew scenes on screen (${mains.length})`);
    const seen = new Set();
    for (const [i, sc] of mains.entries()) {
      assert.strictEqual(sc.images.length, 1, `${tag}: scene ${i} (${sc.st}) draws exactly one portrait`);
      const im = sc.images[0], id = (/\|crew\|([\w-]+)/.exec(sc.sig) || [])[1];
      seen.add(id);
      assert.ok(CREW_IDS.includes(id), `${tag}: scene ${i} wears ${id}, a character of the ${CHARS} crew`);
      assert.strictEqual(im.href, C.file(id, C.poseFor(sc.st)), `${tag}: scene ${i} (${sc.st}) shows the ${C.poseFor(sc.st)} pose of ${id}`);
      assert.deepStrictEqual([im.x, im.y, im.w, im.h], [C.BOX.x, C.BOX.y, C.BOX.w, C.BOX.h], `${tag}: scene ${i}: the portrait's fixed box`);
      const box = [im.x, im.y, im.x + im.w, im.y + im.h];
      assert.ok(box[2] <= MONITOR_LEFT, `${tag}: scene ${i}: the portrait box ${box} ends before the monitor frame (x ${MONITOR_LEFT}), so the status colour is not covered`);
      assert.ok(!sc.plain, `${tag}: scene ${i}: no plain figure under a portrait`);
      sharpOk(`${tag} scene ${i}`, im, nat[im.href]);
    }
    await faceChecks(tag);
    assert.ok(seen.size === CREW_IDS.length, `${tag}: all ${CREW_IDS.length} ${CHARS} characters on screen with 15 agents (the simulator's name table uses every one, FR-073) (${[...seen]})`);
    // spec 077 FR-073 (issue #879): the simulator gives each demo name its fitting character; Ada and Hugo are the check's anchors (literals, not read from the table)
    const want = { cheeky: { Ada: 'gamer', Hugo: 'bookworm' }, prehistoric: { Ada: 'braids', Hugo: 'inventor' }, pirate: { Ada: 'captain', Hugo: 'cook' } }[CHARS];
    const SC = require('../src/renderer/simcrew.js');
    assert.ok(await H.until(`(()=>{const U=window.__durbarSimUi,s=U.crew.state();return U.agents().filter((x)=>!x.parent).every((x)=>s.map[x.id]);})()`, 6000), `${tag}: every main agent has a character`);
    const named = await H.js(`(()=>{const U=window.__durbarSimUi,s=U.crew.state();return U.agents().filter((x)=>!x.parent).map((x)=>{const d=document.querySelector('#stage .desk[data-id="'+x.id+'"] svg.scene');return {name:x.baseName||x.name,c:s.map[x.id],sig:d?d.dataset.sig||'':null};});})()`);
    for (const [n, c] of Object.entries(want)) {
      const a = named.find((x) => x.name === n);
      assert.ok(a, `${tag}: the demo agent ${n} is in the office`);
      assert.strictEqual(a.c, c, `${tag}: ${n} wears ${c} in the ${CHARS} crew (got ${a.c})`);
      assert.ok(a.sig && a.sig.includes('|crew|' + c), `${tag}: ${n}'s desk draws ${c} (sig ${a.sig})`);
    }
    for (const a of named) assert.strictEqual(a.c, SC.characterFor(CHARS, a.name, CREW_IDS), `${tag}: ${a.name} wears its table character`);
    for (const [kind, list] of [['walker', s.walkers], ['chip', s.chips], ['lounge figure', s.lounge]]) for (const [i, imgs] of list.entries()) {
      assert.strictEqual(imgs.length, 1, `${tag}: ${kind} ${i} draws the portrait`);
      sharpOk(`${tag} ${kind} ${i}`, imgs[0], nat[imgs[0].href]);
    }
    assert.strictEqual(s.broken, 0, `${tag}: no picture without a source`);
    console.log(`[crew] ${tag}`, JSON.stringify({ scenes: mains.length, characters: [...seen], walkers: s.walkers.length, chips: s.chips.length, lounge: s.lounge.length }));
    await H.clearToasts();
    await ctx.sleep(200);
    await ctx.shot(path.join(out, `crew-office-${CHARS}-${THEME_ID}-${tag}.png`));
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
      const m = PIC_RE.exec(g.href), fb = C.faceBox(m[1], m[2]), [vx, vy] = g.vb;
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
    // the theme's own characters keep the whole scene dimmed
    await pickChars('theme');
    assert.notStrictEqual(await H.js(`window.THEME.sceneKit()`), 'crew', `${THEME_ID}: The theme's own is not the crew`);
    const plain = await H.js(`(${idleOpacity.toString()})()`);
    assert.ok(plain.length >= 1 && plain.every((x) => x.pic === null && x.rest < 0.9), `${tag}: an idle scene of ${THEME_ID}'s own characters is still dimmed (${JSON.stringify(plain.slice(0, 2))})`);
    console.log(`[crew] ${tag} idle`, JSON.stringify({ crew: idle.length, themeOwn: plain.length }));
  }

  // FR-051: the largest shown size (grown desks, a big window) is still at most half the natural size
  {
    await H.load({ w: 1920, h: 1080, query: { sim: '2', simrooms: '1', simhelpers: '0' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=2&&document.getElementById('stage').dataset.fit` });
    await useCrew();
    const nat = await sizes();
    const s = await H.js(`(${survey.toString()})()`);
    const imgs = s.scenes.flatMap((x) => x.images);
    assert.ok(imgs.length >= 2, `1920x1080: grown desks draw portraits (${imgs.length})`);
    const biggest = Math.max(...imgs.map((i) => i.shown[0]));
    console.log('[crew] 1920x1080 grown desks: largest shown width', Math.round(biggest), 'px, natural', C.BOX.w * C.PX_PER_UNIT);
    for (const im of imgs) sharpOk('1920x1080 grown', im, nat[im.href]);
    await ctx.shot(path.join(out, `crew-office-${CHARS}-1920x1080-grown.png`));
  }

  // issue 871 (FR-071): a sleeping crew character in the bed slot reads like the couch seat, at both sizes. One agent on the couch and a lone sleeper.
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h} bed`;
    await H.load({ w, h, query: { sim: '14', simrooms: '2', simhelpers: '0' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=14&&document.getElementById('stage').dataset.fit` });
    await useCrew();
    for (const id of ['sim-2', 'sim-3']) {
      const ev = (e) => H.js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(Object.assign({ sessionId: id }, e))}))`);
      await ev({ type: 'status', status: 'working', intent: 'Working' });
      await ev({ type: 'output', final: true, text: 'Done. The edge cases are listed.' });
      await ev({ type: 'status', status: 'idle' });
    }
    await H.js(`window.__durbarSimUi.readAll()`);
    // sim-2 finished a moment ago (the couch), sim-3 half an hour ago (a bed)
    await H.js(`(()=>{for(const [id,min] of [['sim-2',2],['sim-3',30]]){window.__durbarSimUi.agents().find(x=>x.id===id).lastEventAt=Date.now()-min*60000;}window.__durbarSimUi.render();})()`);
    assert.ok(await H.until(`!!document.querySelector('#stage .lounge .desk.rest-old.crew-bed')&&!!document.querySelector('#stage .lounge .lg-av svg image')`, 6000), `${tag}: a crew sleeper is in a nap bed`);
    await H.settle();
    // the lounge is laid out again for a moment after the sleepers appear (a fit pass; seen as a flake on Retro Pixel on main too): measure when two reads 300 ms apart agree
    let list = await H.js(`(${sleepers.toString()})()`);
    let settled = false;
    for (let i = 0; i < 20 && !settled; i++) { await ctx.sleep(300); const next = await H.js(`(${sleepers.toString()})()`); settled = JSON.stringify(next) === JSON.stringify(list); list = next; } // a poll interval, not a fixed wait: it stops on two equal reads
    assert.ok(settled, `${tag}: the lounge settles (two reads 300 ms apart agree within 6 s)`);
    const lone = list.filter((x) => x.solo);
    assert.ok(lone.length >= 1, `${tag}: a lone sleeper (a bunk with one bed) is on screen (${list.length} sleepers)`);
    for (const x of lone) {
      const where = `${tag} ${x.id}`, eps = 0.75, inside = (a, b) => a[0] >= b[0] - eps && a[1] >= b[1] - eps && a[2] <= b[2] + eps && a[3] <= b[3] + eps;
      assert.ok(x.crew && !x.lying && x.href, `${where}: drawn with the crew picture, upright (${JSON.stringify({ crew: x.crew, lying: x.lying, href: x.href })})`);
      assert.ok(inside(x.av, x.slot) && inside(x.slot, x.lounge), `${where}: the figure ${x.av.map(Math.round)} is inside its bed slot ${x.slot.map(Math.round)} and the lounge ${x.lounge.map(Math.round)}`);
      // the face is not cut: the face box of the picture, mapped to the screen, is inside the visible figure
      const m = PIC_RE.exec(x.href), fb = C.faceBox(m[1], m[2]), [vx, vy, vw, vh] = x.vb, R = x.svg;
      const sc = Math.min((R[2] - R[0]) / vw, (R[3] - R[1]) / vh), ox = R[0] + ((R[2] - R[0]) - vw * sc) / 2, oy = R[1] + ((R[3] - R[1]) - vh * sc) / 2;
      const face = [ox + (fb[0] - vx) * sc, oy + (fb[1] - vy) * sc, ox + (fb[0] + fb[2] - vx) * sc, oy + (fb[1] + fb[3] - vy) * sc];
      assert.ok(inside(face, x.av), `${where}: the face box ${face.map(Math.round)} is inside the visible figure ${x.av.map(Math.round)} (not cut)`);
      // the name sits under the figure's face (the middle of the figure, like the couch's label), not on top of an empty column
      assert.ok(x.name[1] >= face[3] - 1.5, `${where}: the name ${x.name.map(Math.round)} is under the face ${face.map(Math.round)}`);
      assert.ok(x.name[1] >= x.slot[3] - 20 && x.name[3] <= x.slot[3] + eps, `${where}: the name is on the bed's foot line, not in the middle of the column (${x.name.map(Math.round)} in ${x.slot.map(Math.round)})`);
      // the chat number does not cover the face (a seat of 30 px or less is smaller than the badge itself, as for the couch)
      if (x.av[2] - x.av[0] >= 30) assert.ok(!hit(face, x.chat), `${where}: the chat number ${x.chat.map(Math.round)} does not cover the face ${face.map(Math.round)}`);
      assert.ok(x.chat[0] <= x.slot[0] + 6 && x.chat[1] <= x.slot[1] + 6, `${where}: the chat number is on the top-left corner like the couch's (${x.chat.map(Math.round)})`);
      // the bed is drawn at a sensible size and under the figure
      assert.ok(x.bed[2] - x.bed[0] >= 60 && x.bed[3] - x.bed[1] >= 26, `${where}: the bed is ${Math.round(x.bed[2] - x.bed[0])}x${Math.round(x.bed[3] - x.bed[1])} px (at least 60x26)`);
      assert.ok(inside(x.bed, x.slot), `${where}: the bed ${x.bed.map((n) => +n.toFixed(1))} is inside its slot ${x.slot.map((n) => +n.toFixed(1))}`);
      assert.ok(x.av[3] > x.bed[1] && x.av[1] < x.bed[1], `${where}: the figure rests on the bed (figure ${x.av.map(Math.round)}, bed ${x.bed.map(Math.round)})`);
      assert.ok(x.ztop > x.zav, `${where}: the blanket is drawn over the figure's lower edge`);
      console.log(`[crew] ${tag}`, JSON.stringify({ figure: x.av.map(Math.round), bed: x.bed.map(Math.round), name: x.name.map(Math.round) }));
    }
    await H.clearToasts();
    await ctx.shot(path.join(out, `crew-bed-${CHARS}-${THEME_ID}-${w}x${h}.png`));
  }

  // FR-055: one picture removed from a copy of dist/: its character is drawn as the plain figure, the others keep their pictures
  // The log's "refused a call that did not come from its own window" for 'app:version' is expected here: the sender guard accepts only the real dist index, and this step loads a temp copy
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-dist-'));
    try {
      fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(tmp, 'dist'), { recursive: true });
      const index = path.join(tmp, 'dist', 'renderer', 'index.html');
      const lost = CREW_IDS[0];
      fs.rmSync(path.join(tmp, 'dist', 'renderer', ...C.file(lost, 'waiting').split('/')));
      await H.load({ w: 1440, h: 900, index, query: { theme: THEME_ID, characters: CHARS }, ready: 'fit', settle: false });
      await H.office(15);
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(THEME_ID)}&&window.THEME.sceneKit()==='crew'`, 4000), 'the theme and the crew are on');
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
      await ctx.shot(path.join(out, `crew-fallback-${CHARS}-1440x900.png`));
      console.log(`[crew] fallback: ${lostScenes.length} desk(s) of ${lost} drawn as the plain figure`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!full) { console.log(`[crew] ${CHARS}: crew steps passed`); return; }
  // PR 621 review: the characters of a closed session are freed (the main-session ids decide, the array keeps its identity), the last one too
  // the helpers' characters go with their parent; no stale id stays in the map (nor in durbar.crew where it is stored)
  {
    await H.load({ w: 1440, h: 900, ready: 'fit', settle: false });
    await H.office(15);
    await useCrew();
    const r = await H.js(`(()=>{ try {
      const U = window.__durbarSimUi, agents = U.agents(), st = () => U.crew.state(), before = Object.keys(st().map).length, helpers0 = Object.keys(st().help).length;
      const parent = agents.find((a) => !a.parent && agents.some((h) => h.parent === a.id)) || agents.find((a) => !a.parent);
      const kids = agents.filter((h) => h.parent === parent.id).map((h) => h.id);
      for (let i = agents.length - 1; i >= 0; i--) if (agents[i].id === parent.id || agents[i].parent === parent.id) agents.splice(i, 1);
      try { U.crew.renderAll(); } catch (e) { return { err: 'one: ' + e.stack }; }
      const one = { gone: parent.id, kids, inMap: parent.id in st().map, staleHelpers: Object.keys(st().help).filter((k) => !agents.some((a) => a.id === k)), size: Object.keys(st().map).length };
      agents.splice(0, agents.length);
      try { U.crew.renderAll(); } catch (e) { return { err: 'last: ' + e.stack }; }
      return { before, helpers0, one, last: { map: Object.keys(st().map).length, helpers: Object.keys(st().help).length } };
    } catch (e) { return { err: 'setup: ' + e.stack }; } })()`);
    assert.ok(!r.err, `removal: renderAll threw ${r.err}`);
    assert.ok(r.before >= 12, `removal: the map held the sessions first (${r.before})`);
    assert.ok(!r.one.inMap && r.one.size === r.before - 1, `removal: a closed session leaves the character map (${JSON.stringify(r.one)})`);
    assert.deepStrictEqual(r.one.staleHelpers, [], 'removal: no helper of a closed session keeps a character');
    assert.deepStrictEqual(r.last, { map: 0, helpers: 0 }, `removal: the last session leaves nothing behind (${JSON.stringify(r.last)})`);
    console.log('[crew] removal', JSON.stringify(r));
  }

  // PR 621 review: a character that falls back after the chat header or the inbox is open: those avatars are redrawn as the plain figure, not left on a broken <image>
  {
    await H.load({ w: 1440, h: 900, ready: 'fit', settle: false });
    await H.office(15);
    await useCrew();
    const fall = (c) => `window.__durbarSimUi.crew.fall(${jsLiteral(c)})`;
    const st = `window.__durbarSimUi.crew.state()`;
    const pics = (sel) => `[...document.querySelectorAll(${jsLiteral(sel)})].map((e)=>e.querySelectorAll('image').length)`;
    // the inbox: the first row's agent
    await H.js(`window.__durbarSimUi.crew.openInbox()`);
    assert.ok(await H.until(`!!document.querySelector('#inboxBody .inbox-row .ib-av image')`, 6000), 'inbox: a row draws its crew portrait');
    const row = await H.js(`(()=>{const r=document.querySelector('#inboxBody .inbox-row');const id=r.dataset.id,s=window.__durbarSimUi.crew.state();return {id, c: s.map[id]||s.help[id]};})()`);
    await H.js(fall(row.c));
    assert.ok(await H.until(`${st}.bad.includes(${jsLiteral(row.c)})`, 6000), `inbox: ${row.c} is marked as fallen back`);
    assert.ok(await H.until(`!document.querySelector('#inboxBody .inbox-row[data-id=${jsLiteral(row.id)}] .ib-av image')`, 3000), `inbox: the row of ${row.id} is redrawn as the plain figure (no broken <image>)`);
    assert.ok(await H.js(`!!document.querySelector('#inboxBody .inbox-row[data-id=${jsLiteral(row.id)}] .ib-av svg')`), 'inbox: the row still has an avatar');
    await H.js(`window.__durbarSimUi.crew.closeInbox()`);
    // the chat header: another character, an agent at its desk
    const pick2 = await H.js(`(()=>{const U=window.__durbarSimUi,s=U.crew.state(),a=U.agents().find((x)=>!x.parent&&!s.bad.includes(s.map[x.id])&&document.querySelector('#stage .desk[data-id="'+x.id+'"]'));return {id:a.id,c:s.map[a.id]};})()`);
    await H.js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(pick2.id)})`);
    assert.ok(await H.until(`!!document.querySelector('#panelHead .avatar image')`, 6000), 'header: the chat header draws the crew portrait');
    await H.js(fall(pick2.c));
    assert.ok(await H.until(`${st}.bad.includes(${jsLiteral(pick2.c)})`, 6000), `header: ${pick2.c} is marked as fallen back`);
    assert.ok(await H.until(`!document.querySelector('#panelHead .avatar image')&&!!document.querySelector('#panelHead .avatar svg')`, 3000), 'header: the avatar is redrawn as the plain figure, not left on a broken <image>');
    console.log('[crew] fallback after mount: inbox row of', row.id, row.c, 'and header of', pick2.id, pick2.c, 'redrawn');
  }

  // PR 621 review (FR-017, T028): the module itself missing (not only one picture): crew.js removed from a copy of dist/. Picking the theme and restoring it at start throw nothing, every desk draws the plain figure
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-nomod-'));
    try {
      fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(tmp, 'dist'), { recursive: true });
      const index = path.join(tmp, 'dist', 'renderer', 'index.html');
      fs.rmSync(path.join(tmp, 'dist', 'renderer', 'crew.js'));
      assert.ok(fs.readFileSync(index, 'utf8').includes('<script src="crew.js"></script>'), 'the page loads crew.js (the copy has the file removed, the tag stays and fails to load)');
      await H.load({ w: 1440, h: 900, index, query: { theme: THEME_ID, characters: CHARS }, ready: 'fit', settle: false });
      await H.office(15);
      assert.strictEqual(await H.js(`typeof window.DurbarCrew`), 'undefined', 'the module is not there');
      assert.ok(await H.until(`window.THEME.current().id===${jsLiteral(THEME_ID)}&&window.THEME.sceneKit()==='crew'`, 4000), 'the crew restores at start with no module');
      await pickChars('theme');
      await pickChars(CHARS); // selecting it again, by hand
      const probe = await H.js(`window.__durbarSimUi.crew.probe()`);
      assert.deepStrictEqual(probe, { ok: true, of: 0 }, `no module: preload, sync and every crewOf answer without throwing and name no character (${JSON.stringify(probe)})`);
      const s = await H.js(`(${survey.toString()})()`);
      const desks = s.scenes.filter((x) => x.st);
      assert.ok(desks.length >= 12, `no module: the desks are drawn (${desks.length})`);
      for (const sc of desks) assert.ok(sc.images.length === 0 && sc.plain, `no module: the plain figure on every desk (${sc.sig})`);
      assert.ok(s.walkers.every((w) => w.length === 0), 'no module: figures draw no portrait');
      assert.strictEqual(await H.js(`(()=>{const s=window.__durbarSimUi.crew.state();return Object.keys(s.map).length+Object.keys(s.help).length+(s.hasModule?1:0);})()`), 0, 'no module: no character is assigned');
      await H.clearToasts();
      console.log(`[crew] no module: ${desks.length} desks drawn as the plain figure`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log(`[crew] ${CHARS}: checks passed`);
}

module.exports = async (ctx) => {
  for (const [chars, full] of RUNS) {
    CHARS = chars;
    assert.ok(require('../src/renderer/crew.js').CREWS[chars], `CREW_CHARS ${chars} is a crew`);
    await runCrew(ctx, full);
  }
  console.log('[crew] checks passed');
  process.exitCode = 0;
};
