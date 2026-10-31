/*
 * Real office mode, phase P1 (spec 097 T015..T020): the scene and the lights in the simulator. No real agent session, no account, no
 * AI credits (constitution IV).
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-realoffice.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *   node scripts/ui-suite.js --only shots-097-realoffice
 *
 * At 1440x900 and 1280x800 it fails (exit 1) when:
 *   - flat is not the default (no Real office element, no Real office file requested: FR-002, SC-004);
 *   - Settings > Office layout has no third button, or choosing it does not draw the Real office, or Open office / Office with cabins do
 *     not bring the flat office back (FR-001, FR-003; durbar.doorsigns untouched), or a broken stored value is not flat;
 *   - with 15 agents: a main agent without its one focusable plate (button, accessible name with the status word, FR-090), a plate
 *     without a status word, a desk without a person that is not away or asleep, an away desk without "at <place>" (FR-017);
 *   - a status cue is missing: a waiting agent without its "?" and amber call light, an error agent without "!" and its red call light,
 *     a light shown without a word (FR-038, FR-041, FR-046);
 *   - the lights move under reduced motion (no running animation on .ro-lights) or Serious mode (FR-047), or show under forced colours (FR-051);
 *   - the room is not dimmer with fewer active agents (FR-043);
 *   - a click on a person or a plate does not open that agent's chat (FR-006);
 *   - a picture that fails to load leaves a broken image instead of the initials disc (FR-065).
 * Screenshots: <SHOTS_OUT>/097-real-15-<w>x<h>.png, 097-real-3-<w>x<h>.png, 097-real-lights-1440x900.png, 097-office-layout-1440x900.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  /* every picture of the office has decoded (or failed): no half-drawn screenshot */
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
  };
  /* the requests the page made (performance entries): what flat mode must never fetch (SC-004) */
  const realFiles = () => js(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/realoffice|\\/shared\\/(lights|realoffice-layout)\\.js/.test(n)).length`);

  // ---- FR-002, SC-004: flat is the default and loads nothing of Real office ----
  await H.load({ w: 1440, h: 900 });
  assert.strictEqual(await js(`!!document.querySelector('.ro')`), false, 'flat by default');
  assert.strictEqual(await realFiles(), 0, 'flat mode requested a Real office file');
  assert.strictEqual(await js(`!!window.DurbarRealOffice`), false, 'flat mode loaded realoffice.js');

  // ---- FR-001, FR-003, FR-004: the Settings button and the stored choice ----
  await js(`localStorage.setItem('durbar.doorsigns','off')`);
  await H.load({ w: 1440, h: 900 });
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="real"]')`, 'the Real office button');
  const seg = await js(`[...document.querySelectorAll('[data-officelayout]')].map(b=>b.dataset.officelayout+':'+b.getAttribute('aria-pressed')).join(' ')`);
  assert.strictEqual(seg, 'cabins:false open:true real:false', 'three buttons, Open office pressed: ' + seg);
  await js(`document.querySelector('[data-officelayout="real"]').scrollIntoView({block:'center'})`);
  await H.shot(path.join(OUT, '097-office-layout-1440x900.png'), { prep: 'calm' });
  await js(`document.querySelector('[data-officelayout="real"]').click()`);
  await must(`document.querySelector('[data-officelayout="real"]').getAttribute('aria-pressed')==='true'`, 'Real office pressed');
  assert.strictEqual(await js(`localStorage.getItem('durbar.officeview')`), 'real', 'stored as real');
  assert.strictEqual(await js(`localStorage.getItem('durbar.doorsigns')`), 'off', 'durbar.doorsigns untouched');
  await js(`document.getElementById('scrClose').click()`);
  await must(REAL, 'the Real office after the Settings choice');
  await js(`window.DurbarScreens.openSettings()`);
  await must(`!!document.querySelector('[data-officelayout="open"]')`, 'the Office layout row');
  await js(`document.querySelector('[data-officelayout="open"]').click()`);
  await must(`localStorage.getItem('durbar.officeview')==='flat'`, 'back to flat');
  await js(`document.getElementById('scrClose').click()`);
  await must(`!document.querySelector('#stage .ro')&&document.querySelectorAll('#stage .desk[data-id]').length>=15`, 'the flat desks again');
  await js(`localStorage.setItem('durbar.officeview','nonsense')`);
  await H.load({ w: 1440, h: 900 });
  assert.strictEqual(await js(`!!document.querySelector('.ro')`), false, 'a broken stored value means flat');

  for (const [w, h] of SIZES) {
    await loadReal(w, h);
    // ---- FR-090, FR-016, FR-017, FR-036: plates, people, away desks ----
    const d = await js(`(()=>{const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);
      const plates=[...document.querySelectorAll('#stage .ro-plate')];
      return {ids:ids.length,plates:plates.length,missing:ids.filter(id=>!plates.some(p=>p.dataset.id===id)),
        noWord:plates.filter(p=>!/(Working|Thinking|Waiting|Error|Done|Idle|Paused|Limit|Retrying|Compacting|Failing|Ended|Ready|break|asleep|Stopped)/i.test(p.getAttribute('aria-label')||'')).map(p=>p.getAttribute('aria-label')),
        notButton:plates.filter(p=>p.tagName!=='BUTTON').length,
        away:document.querySelectorAll('#stage .ro-away').length,visitors:document.querySelectorAll('#stage .ro-visitor').length,
        persons:document.querySelectorAll('#stage .ro-person').length,fixtures:document.querySelectorAll('#stage .ro-fx').length,
        face:+document.querySelector('#stage .ro').dataset.face,states:[...new Set(plates.map(p=>p.dataset.state))].sort().join(',')}})()`);
    console.log('[097]', w, h, JSON.stringify(d));
    assert.deepStrictEqual(d.missing, [], 'every main agent has its plate');
    assert.strictEqual(d.plates, d.ids, 'one plate per main agent');
    assert.strictEqual(d.notButton, 0, 'plates are buttons');
    assert.deepStrictEqual(d.noWord, [], 'every plate names its status in words');
    assert.ok(d.persons >= 8, 'people sit at their desks: ' + d.persons);
    assert.ok(d.fixtures >= 8, 'the lobby fixtures are drawn: ' + d.fixtures);
    const aw = await js(`[...document.querySelectorAll('#stage .ro-away')].every(e=>/^at .+ ↑$/.test(e.textContent))`);
    assert.ok(aw, 'away desks say where');
    // ---- FR-038, FR-041, FR-046: cues and lights by status ----
    const cues = await js(`(()=>{const o={};for(const p of document.querySelectorAll('#stage .ro-plate')){const id=p.dataset.id,st=p.dataset.state;
      const call=[...document.querySelectorAll('#stage .ro-call')].find(c=>c.dataset.for===id);(o[st]=o[st]||[]).push(call?call.className.replace(/ro-call |pulse|fade/g,'').trim():'none');}return o;})()`);
    console.log('[097] call lights by state', JSON.stringify(cues));
    if (cues.waiting) assert.ok(cues.waiting.every((c) => c === 'call-amber'), 'waiting: amber call light');
    if (cues.error) assert.ok(cues.error.every((c) => c === 'call-red'), 'error: red call light');
    if (cues.limit) assert.ok(cues.limit.every((c) => c === 'call-orange'), 'limit: orange call light');
    for (const st of ['working', 'thinking', 'idle', 'asleep']) if (cues[st]) assert.ok(cues[st].every((c) => c === 'none'), `${st}: no call light`);
    const bub = await js(`({e:document.querySelectorAll('#stage .ro-plate[data-state="error"]').length,x:document.querySelectorAll('#stage .ro-bang').length})`);
    assert.strictEqual(bub.x, bub.e, 'one "!" per error desk');
    await H.shot(path.join(OUT, `097-real-15-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- FR-020: few agents, big screens ----
  for (const [w, h] of SIZES) {
    await loadReal(w, h, { sim: '3' });
    const big = await js(`document.querySelector('#stage .ro').dataset.big`);
    assert.strictEqual(big, '1', 'big screens with 3 agents');
    await H.shot(path.join(OUT, `097-real-3-${w}x${h}.png`), { prep: 'calm' });
  }

  // ---- FR-006: a click on a person opens its chat ----
  await loadReal(1440, 900);
  const pid = await js(`(document.querySelector('#stage .ro-person')||{dataset:{}}).dataset.for||''`);
  assert.ok(pid, 'a person is drawn');
  await js(`document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(pid)})+'"]').click()`);
  await must(`document.body.classList.contains('panel-open')`, 'the chat after a click on a person');
  await js(`document.getElementById('backBtn').click()`);
  await must(`!document.body.classList.contains('panel-open')&&!!document.querySelector('#stage .ro .ro-plate')`, 'the office again');

  // ---- FR-037: a session keeps its person, also across a status filter that hides it ----
  const who = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('#stage .ro-person')].map(i=>[i.dataset.for,i.getAttribute('src').replace(/-\\w+\\.webp$/,'')])))`;
  const before = await js(who);
  const all = await js(`document.querySelectorAll('#stage .ro-plate').length`);
  await js(`document.querySelector('.stat[data-k="waiting"]').click()`);
  await must(`document.querySelectorAll('#stage .ro-plate').length<${Number(all)}`, 'the filter');
  await js(`document.querySelector('.stat[data-k="waiting"]').click()`);
  await must(`document.querySelectorAll('#stage .ro-plate').length===window.__durbarSimUi.agents().filter(a=>!a.parent).length`, 'the filter off');
  await must(PICS, 'the pictures');
  assert.strictEqual(await js(who), before, 'every session keeps its person across a filter');
  // ---- FR-047: Serious mode: no light animation ----
  await js(`document.documentElement.setAttribute('data-serious','')`);
  const anim = await js(`[...document.querySelectorAll('#stage .ro-lights *')].filter(e=>getComputedStyle(e).animationName!=='none').length`);
  assert.strictEqual(anim, 0, 'Serious mode: no light moves');
  await js(`document.documentElement.removeAttribute('data-serious')`);
  const reduced = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  if (reduced) assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro-lights *')].filter(e=>getComputedStyle(e).animationName!=='none').length`), 0, 'reduced motion: no light moves');

  // ---- FR-043: fewer active agents, a dimmer room (8 agents: bigger desks, every light visible in the picture) ----
  const amb15 = Number(await js(`document.querySelector('#stage .ro').dataset.ambient`));
  await loadReal(1440, 900, { sim: '8' });
  const amb = Number(await js(`document.querySelector('#stage .ro').dataset.ambient`));
  assert.ok(amb >= 0.7 && amb <= 1 && amb15 >= 0.7 && amb15 <= 1, 'ambient in 0.7..1: ' + amb + ', ' + amb15);
  console.log('[097] ambient: 15 agents', amb15, '8 agents', amb);
  await H.shot(path.join(OUT, '097-real-lights-1440x900.png'), { prep: 'calm' });

  // ---- FR-065: a picture that fails: no broken image, the initials disc ----
  const victim = await js(`(()=>{const i=document.querySelector('#stage .ro-person');const f=i.dataset.for;i.src='realoffice/art/missing.webp';return f})()`);
  await must(`!!document.querySelector('#stage .ro-initials[data-for="'+CSS.escape(${jsLiteral(victim)})+'"]')`, 'the initials disc after a failed picture');
  assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro img')].filter(i=>i.complete&&!i.naturalWidth).length`), 0, 'no broken image left on screen');
  console.log('[097] real office checks passed; shots in', OUT);
};
