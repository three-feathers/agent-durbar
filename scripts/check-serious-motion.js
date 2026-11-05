/*
 * Spec 052 FR-069, FR-069a (issue #1182): Serious mode hides only the mood drawings and trouble signs; motion has its own Settings switch (Motion, on by
 * default) and the system's reduced motion. Simulator only, no credits. In ui-suite.js; `node scripts/ui-suite.js --only check-serious-motion`.
 * At 1440x900 and 1280x800, "no preference" emulated first (a Windows CI runner reports "reduce"; check-office-ops-real says so too):
 *   - Serious on, Motion on: no mood drawing, no trouble sign; the Flat office's CSS animations and SMIL wave run, and the Real office's rig, second frames and lights run;
 *   - Serious on, Motion off: everything is still, in both worlds;
 *   - Serious off, Motion off: still, and the moods show;
 *   - Serious off, Motion on: moods show and the animations run (the baseline the rows above are read against);
 *   - reduced motion emulated (page loaded with it): still in both worlds, Serious off or on.
 * Screenshots: <SHOTS_OUT>/052-motion-settings-<w>x<h>.png (the Motion row in Settings).
 * Every wait is asserted. It fails (exit 1) with the text of the first assert that is not met.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-serious-motion-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const emulate = (v) => dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });

  /* a mood drawing or a trouble sign anywhere: heavy or monster body (data-sig), ambulance, dizzy stars, sweat, tapping, a room's siren */
  const MOODS = `(()=>{const sc=[...document.querySelectorAll('#stage svg.scene')].filter(s=>/\\|(heavy|monster)\\w*$/.test(s.dataset.sig||'')).length;return sc+document.querySelectorAll('#stage .amb,#stage .dizzy,#stage .sweat,#stage .tap,#stage .room-head .siren').length;})()`;
  /* running CSS animations on the flat desks, and SMIL waves */
  const FLAT_ANIMS = `document.getAnimations().filter(a=>a.playState==='running'&&a.animationName&&a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('#stage .desk')).length`;
  /* the full-size waving hand is SMIL, which CSS cannot stop: a waiting person's scene is drawn with it or without it (as check-unread does), in the office kit and in a theme kit */
  const WAVES = (kit) => `(()=>{let v;const T=window.THEME,o=T.sceneKit;if(${jsLiteral(kit)})T.sceneKit=()=>${jsLiteral(kit)};try{const U=window.__durbarSimUi;v=U.scene(Object.assign({},U.agents()[0],{state:'waiting',paused:false,live:true}),false,false);}finally{T.sceneKit=o;}return /animateTransform/.test(v);})()`;
  /* the Real office: its rig and second frames, its running animations, and its still class */
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const RO_FRAMES = `document.querySelectorAll('#stage .ro-rig,#stage .ro-person2,#stage .ro-visitor2').length`;
  const RO_ANIMS = `document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.ro-art,.ro-stext,.ro-lights')).length`;
  const RO_STILL = `document.querySelector('#stage .ro').classList.contains('still')`;

  /* a Settings switch to the wanted state, then back to the office */
  const setSwitch = async (id, on) => {
    await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById(${jsLiteral(id)})`, 'the switch ' + id);
    if ((await js(`document.getElementById(${jsLiteral(id)}).getAttribute('aria-checked')==='true'`)) !== on) await js(`document.getElementById(${jsLiteral(id)}).click()`);
    await must(`document.getElementById(${jsLiteral(id)}).getAttribute('aria-checked')===${jsLiteral(String(on))}`, `${id} ${on ? 'on' : 'off'}`);
    await js(`document.getElementById('scrClose').click()`);
    await must(`!document.body.classList.contains('panel-open')&&!document.getElementById(${jsLiteral(id)})`, 'back in the office');
  };
  const flat = async (w, h) => {
    await H.load({ w, h, query: { simwaitold: '1', officeview: 'flat' } });
    await must(`!!document.querySelector('#stage .desk[data-id]')`, 'the flat office');
  };
  const real = async (w, h) => {
    await H.load({ w, h, query: { officeview: 'real', romotion: '1' }, ready: REAL, settle: false });
    await must(`document.querySelector('#stage .ro')._ready===true`, 'the Real office ready to move', 8000);
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
  };
  const flatMoving = async (tag) => {
    await must(`(${FLAT_ANIMS})>0`, tag + ': flat animations run');
    assert.strictEqual(await js(WAVES('')), true, tag + ': the office kit draws the SMIL wave');
    assert.strictEqual(await js(WAVES('pixel')), true, tag + ': a theme kit draws the SMIL wave');
  };
  const flatStill = async (tag) => {
    await must(`(${FLAT_ANIMS})===0`, tag + ': flat animations stopped');
    assert.strictEqual(await js(FLAT_ANIMS), 0, tag + ': no flat animation runs');
    assert.strictEqual(await js(WAVES('')), false, tag + ': the office kit draws no SMIL wave');
    assert.strictEqual(await js(WAVES('pixel')), false, tag + ': a theme kit draws no SMIL wave');
  };
  const realMoving = async (tag) => {
    await must(`!(${RO_STILL})`, tag + ': the Real office is not still');
    await must(`(${RO_FRAMES})>0`, tag + ': the Real office has its rig or second frames');
    await must(`(${RO_ANIMS})>0`, tag + ': Real office animations run');
  };
  const realStill = async (tag) => {
    await must(RO_STILL, tag + ': the Real office is still');
    await must(`(${RO_FRAMES})===0`, tag + ': no second frame and no rig');
    assert.strictEqual(await js(RO_ANIMS), 0, tag + ': no Real office animation runs');
  };

  for (const [w, h] of SIZES) {
    const at = `${w}x${h}`;
    /* ---- "no preference" first ---- */
    await emulate('no-preference');
    await flat(w, h);
    assert.strictEqual(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), false, at + ': normal motion is emulated');
    assert.ok(await js(MOODS) > 0, at + ': baseline: the moods show (Serious off), so the rows below can fail');
    await flatMoving(at + ' baseline');

    await setSwitch('seriousSw', true);
    assert.ok(await H.until(`document.documentElement.hasAttribute('data-serious')`), at + ': Serious mode is on');
    await must(`(${MOODS})===0`, at + ' Serious on: no mood drawing or trouble sign');
    assert.strictEqual(await js(MOODS), 0, at + ' Serious on, Motion on: no mood drawing or trouble sign');
    assert.strictEqual(await js(`document.documentElement.hasAttribute('data-motion-off')`), false, at + ' Serious on: motion is not off');
    await flatMoving(at + ' Serious on, Motion on');

    await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById('motionSw')`, at + ': the Motion switch');
    await js(`document.getElementById('motionSw').scrollIntoView({block:'center'})`);
    await H.shot(path.join(OUT, `052-motion-settings-${w}x${h}.png`), { prep: 'mouse', tag: '052' });
    await js(`document.getElementById('scrClose').click()`);
    await must(`!document.getElementById('motionSw')`, at + ': Settings closed');
    await setSwitch('motionSw', false);
    await must(`document.documentElement.hasAttribute('data-motion-off')`, at + ': Motion is off');
    assert.strictEqual(await js(MOODS), 0, at + ' Serious on, Motion off: still no mood');
    await flatStill(at + ' Serious on, Motion off');

    await setSwitch('seriousSw', false);
    await must(`(${MOODS})>0`, at + ' Serious off: the moods show again');
    await flatStill(at + ' Serious off, Motion off');

    await setSwitch('motionSw', true);
    await flatMoving(at + ' Serious off, Motion on');

    /* ---- the Real office, same four states ---- */
    await real(w, h);
    await realMoving(at + ' real baseline');
    await setSwitch('seriousSw', true);
    await realMoving(at + ' real, Serious on, Motion on');
    await setSwitch('motionSw', false);
    await realStill(at + ' real, Serious on, Motion off');
    await setSwitch('seriousSw', false);
    await realStill(at + ' real, Serious off, Motion off');
    await setSwitch('motionSw', true);
    await realMoving(at + ' real, Serious off, Motion on');

    /* ---- reduced motion, loaded with it: still with Motion on, in both worlds; the moods are not touched ---- */
    await emulate('reduce');
    await flat(w, h);
    assert.strictEqual(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true, at + ': reduced motion is emulated');
    assert.ok(await js(MOODS) > 0, at + ' reduced motion: the moods still show');
    assert.strictEqual(await js(`document.documentElement.hasAttribute('data-motion-off')`), false, at + ' reduced motion: the Motion setting is still on');
    await flatStill(at + ' reduced motion');
    await real(w, h);
    await realStill(at + ' real, reduced motion');
    await setSwitch('seriousSw', true);
    await realStill(at + ' real, reduced motion, Serious on');
    console.log(`[serious-motion] ${at}: ok`);
  }
  await emulate('no-preference');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined);
  dbg.detach();
  console.log('[serious-motion] checks passed');
};
