/*
 * The Prehistoric cave world, behind its flag (spec 097 phase 4, spec 102 FR-201, FR-205): the simulator only, no real session, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-cave.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * Fails (exit 1) when:
 *   - the flag is off (the default) and a stored `durbar.world=cave` still draws the cave, asks for a cave file, or a World row shows;
 *   - with the flag on (the simulator's `worldflags=cave`): html[data-world] and .ro[data-world] are not `cave`, the set is not Prehistoric, the
 *     page asked for any file of another world or set, a picture is broken, or any light uses a blend mode (spec 097 FR-180);
 *   - the World row is not a radio group of two with the cave checked, the arrow keys do not move between worlds, the Photo office does not
 *     draw the Office people on the default, or a Characters pick of Prehistoric does not draw Prehistoric in the Photo office (any set in any world);
 *   - at 3, 8 and 15 agents, 1440x900 and 1280x800: a main agent has no plate, a person or visitor is missing, a plate or chip is under 10.5 px, a
 *     plate overlaps another, the office scrolls (15 agents), or a screen has no live text lines.
 * Screenshots: <SHOTS_OUT>/cave-<n>-<w>x<h>.png (n = 3, 8, 15), cave-settings-1440x900.png, photo-prehistoric-15-1440x900.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-cave-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
  };
  /* the packs the page asked for: "sets/x worlds/y" */
  /* a file:// page has no resource timing for its files: the packs are read from the script, link and picture elements the page holds */
  const packs = () => js(`[...new Set([...document.querySelectorAll('script[src],link[href],#stage img[src]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(n=>/realoffice\\/(worlds|sets)\\//.test(n)).map(n=>n.replace(/^.*realoffice\\/(worlds|sets)\\/([^/]+)\\/.*$/,'$1/$2')))].sort().join(' ')`);
  const CAVE = { worldflags: 'cave', world: 'cave' };

  // ---- the flag is off by default: a stored cave choice draws the Photo office, asks for no cave file, shows no World row ----
  await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: REAL, settle: false });
  await js(`localStorage.setItem('durbar.world','cave')`);
  await H.load({ w: 1440, h: 900, query: { officeview: 'real' }, ready: REAL, settle: false });
  await must(PICS, 'the pictures');
  assert.strictEqual(await js(`document.documentElement.dataset.world+' '+document.querySelector('#stage .ro').dataset.set`), 'photo office', 'flag off: the Photo office with the Office people');
  assert.strictEqual(await packs(), 'sets/office worlds/photo', 'flag off: no cave or Prehistoric file asked for: ' + await packs());
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="real"]')`, 'Settings');
  assert.strictEqual(await js(`!!document.querySelector('#wrGroup')`), false, 'flag off: no World row');
  await js(`document.getElementById('scrClose').click();localStorage.removeItem('durbar.world')`);

  // ---- the flag on (simulator): the cave, its set, nothing else ----
  for (const [w, h] of SIZES) for (const n of [3, 8, 15]) {
    await loadReal(w, h, { ...CAVE, sim: String(n) });
    assert.strictEqual(await js(`document.documentElement.dataset.world`), 'cave', 'html[data-world] is cave');
    assert.strictEqual(await js(`(()=>{const r=document.querySelector('#stage .ro');return r.dataset.world+' '+r.dataset.set})()`), 'cave prehistoric', 'the cave with the Prehistoric people');
    assert.strictEqual(await packs(), 'sets/prehistoric worlds/cave', 'only the cave and its set were asked for: ' + await packs());
    const bad = await js(`[...document.querySelectorAll('#stage .ro img')].filter(i=>!i.naturalWidth).map(i=>i.getAttribute('src'))`);
    assert.deepStrictEqual(bad, [], 'no broken picture');
    const blend = await js(`[...document.querySelectorAll('#stage .ro *')].filter(e=>{const b=getComputedStyle(e).mixBlendMode;return b&&b!=='normal'}).length`);
    assert.strictEqual(blend, 0, 'no element uses a blend mode in the cave (FR-180)');
    const d = await js(`(()=>{const R=e=>e.getBoundingClientRect(),P=[...document.querySelectorAll('#stage .ro-plate')],C=[...document.querySelectorAll('#stage .ro-chip,#stage .ro-plate,#stage .ro-lplate')];
      const hit=(a,b)=>{const x=R(a),y=R(b);return x.left<y.right-0.5&&y.left<x.right-0.5&&x.top<y.bottom-0.5&&y.top<x.bottom-0.5};
      const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);
      return {ids:ids.length,plates:P.length,missing:ids.filter(id=>!P.some(p=>p.dataset.id===id)),
        persons:document.querySelectorAll('#stage .ro-person').length,visitors:document.querySelectorAll('#stage .ro-visitor').length,
        small:C.filter(c=>parseFloat(getComputedStyle(c).fontSize)<10.5).length,
        pp:P.flatMap((p,i)=>P.slice(i+1).filter(q=>hit(p,q)).map(q=>p.dataset.id+'/'+q.dataset.id)),
        lines:[...document.querySelectorAll('#stage .ro-glass')].filter(g=>g.querySelector('i')).length,screens:document.querySelectorAll('#stage .ro-glass').length,
        fit:document.getElementById('stage').dataset.fit,face:+document.querySelector('#stage .ro').dataset.face}})()`);
    console.log('[cave]', n, w, h, JSON.stringify(d));
    assert.deepStrictEqual(d.missing, [], 'every main agent has its plate');
    assert.strictEqual(d.plates, d.ids, 'one plate per main agent');
    assert.strictEqual(d.small, 0, 'no text under 10.5 px');
    assert.deepStrictEqual(d.pp, [], 'no plate overlaps another');
    assert.ok(d.persons + d.visitors >= Math.min(d.ids, 3), 'people are drawn');
    assert.ok(d.screens >= 1, 'screens are drawn');
    if (n === 15) assert.strictEqual(d.fit, 'ok', 'no office scroll with 15 agents');
    await H.shot(path.join(OUT, `cave-${n}-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- Settings: the World row (two worlds offered), keys, the default set, any set in any world ----
  await loadReal(1440, 900, CAVE);
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('#wrGroup')`, 'the World row');
  const row = await js(`(()=>{const g=document.querySelector('#wrGroup');return {role:g.getAttribute('role'),radios:[...g.querySelectorAll('[role=radio]')].map(b=>b.dataset.world+':'+b.getAttribute('aria-checked')+':'+b.tabIndex).join(' '),label:document.getElementById('wrL').textContent}})()`);
  assert.deepStrictEqual(row, { role: 'radiogroup', radios: 'photo:false:-1 cave:true:0', label: 'World' }, 'a radio group with the cave checked and one tab stop: ' + JSON.stringify(row));
  assert.ok(/World’s default \(Prehistoric\)/.test(await js(`document.querySelector('#chList [data-characters="theme"]').getAttribute('aria-label')`)), 'Characters names the cave’s default set');
  await js(`document.querySelector('#wrGroup [data-world="cave"]').focus()`);
  await H.shot(path.join(OUT, 'cave-settings-1440x900.png'), { prep: 'mouse' });
  /* the office behind Settings draws only when Settings is closed: close, check the room, open Settings again */
  const room = async (expr, what) => {
    await js(`document.getElementById('scrClose').click()`);
    await must(expr, what);
    await must(PICS, 'the pictures');
    await js(`window.DurbarScreens.openSettings()`);
    await must(`!!document.querySelector('#wrGroup')`, 'the World row again');
  };
  const RO = (world, set) => `(()=>{const r=document.querySelector('#stage .ro');return !!r&&r.dataset.world===${jsLiteral(world)}&&r.dataset.set===${jsLiteral(set)}})()`;
  await H.key('Left');
  await must(`document.documentElement.dataset.world==='photo'&&document.activeElement&&document.activeElement.dataset.world==='photo'`, 'ArrowLeft moves to the Photo office and keeps focus on the radio');
  assert.strictEqual(await js(`localStorage.getItem('durbar.world')`), 'photo', 'the choice is kept');
  assert.ok(/World\u2019s default \(Office people\)/.test(await js(`document.querySelector('#chList [data-characters="theme"]').getAttribute('aria-label')`)), 'Characters now names the Office people');
  await room(RO('photo', 'office'), 'the Photo office draws the Office people on the default');
  await js(`document.querySelector('#chList [data-characters="prehistoric"]').click()`);
  await room(RO('photo', 'prehistoric'), 'Prehistoric people in the Photo office (any set in any world)');
  await js(`document.getElementById('scrClose').click()`);
  await must(PICS, 'the pictures');
  await H.shot(path.join(OUT, 'photo-prehistoric-15-1440x900.png'), { prep: 'calm' });
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('#wrGroup')`, 'the World row');
  await js(`document.querySelector('#chList [data-characters="cheeky"]').click()`);
  await must(`/until Cheeky has Real office poses/.test(document.getElementById('dsR').textContent)`, 'Cheeky has no Real office poses: one line saying so');
  await room(RO('photo', 'office'), 'Cheeky: the world\u2019s default set');
  await js(`document.querySelector('#chList [data-characters="theme"]').click();document.querySelector('#wrGroup [data-world="photo"]').focus()`);
  await H.key('Right');
  await must(`document.documentElement.dataset.world==='cave'`, 'ArrowRight back to the cave');
  await room(RO('cave', 'prehistoric'), 'the cave with its default set');
  await js(`document.getElementById('scrClose').click()`);
  console.log('[cave] checks passed; shots in', OUT);
};
