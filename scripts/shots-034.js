/*
 * Checks + screenshots for spec 034 (issue #20): agents show how they are doing (heavy / monster body, ambulance, faint,
 * impatient, dizzy) and Settings > Serious mode turns every drawing off.
 * Simulator only (no AI credits, no Copilot login). Frozen simulator, plus simwaitold=1 so waiting requests are 2 minutes old:
 *
 *   npm run build
 *   SHOTS_034=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-034.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * It reads only the page (app.js keeps its state private: each desk scene says its mood in data-sig) and prints
 * "DRIVER FAILED" on a miss. What it checks, at 1440x900 and 1280x800:
 *   - US1  heavy and monster bodies exist; a monster's card label says "Context almost full (N%)" with N above 90;
 *   - US2  one ambulance, on an agent in Error; a second, newer error takes it and gives it back when it ends; a fainted agent
 *          at its credit limit; impatient agents only with simwaitold=1 (a fresh request is not impatient); 3 failed calls in a
 *          row make an agent at its desk dizzy and a successful call clears it (sent with window.__durbarSimEmit);
 *          every trouble is named in the card's accessible label, the visible card text does not change;
 *   - US3  Serious mode on: no mood in any scene and no mood drawing in the page; off again: the drawings come back;
 *          reduced motion: nothing animates (emulated through the DevTools protocol);
 *   - FR-002 the compact densities (mini) use the same rules; scene boxes keep their size;
 *   - Edge  an agent on a floor that is off (spec 033) never takes the ambulance.
 * Rooms (spec 034 delta, issue #135): each room's data-alert follows its worst agent (calm, uneasy, alarm); the siren is on only where
 * the ambulance or a faint is, moves with the ambulance, sits on the closed door plate without changing its size and is named in the
 * label; the header text (path, usage) keeps 4.5:1 contrast on the real pixels at every tone, calm rooms included; Serious mode and a floor that is off
 * show neither; reduced motion stops the siren; full-density rooms get no inner ring.
 * Crops of single desks (device pixels) go to 034-crop-<state>.png for a close look at the drawings.
 */
const fs = require('fs');
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_034 || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const shot = async (name, w, h) => { await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`); await ctx.sleep(300); /* the simulator's start-up toast would cover the office */ await ctx.shot(path.join(OUT, `034-${name}-${w}x${h}.png`)); console.log('[034] saved', name, w, h); };
  const load = async (w, h, extra) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', ...(extra || {}) } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(1500);
  };
  /* every main desk: name, away, mood (from data-sig), labels, visible text, scene box size */
  const desks = () => js(`[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>{const sv=d.querySelector('svg.scene'),sig=(sv&&sv.dataset.sig)||'',m=/\\|(normal|heavy|monster)(\\w*)$/.exec(sig),b=sv?sv.getBoundingClientRect():{width:0,height:0};
    return {id:d.dataset.id,name:d.querySelector('.name').textContent.trim(),room:((d.closest('.room')||document).querySelector('.room-name')||{textContent:''}).textContent.trim(),away:d.classList.contains('is-away'),st:(/is-(\\w+)/.exec(d.className)||[])[1],
      body:m?m[1]:null,trouble:m&&m[2]?m[2]:null,label:d.getAttribute('aria-label')||'',title:d.getAttribute('title')||'',
      text:(d.querySelector('.ci, .info')||d).innerText.replace(/\\s+/g,' ').trim(),box:[Math.round(b.width),Math.round(b.height)],
      amb:d.querySelectorAll('.amb').length,dizzy:d.querySelectorAll('.dizzy').length,sweat:d.querySelectorAll('.sweat').length,tap:d.querySelectorAll('.tap').length}})`);
  const one = async (pred, what) => { const d = (await desks()).find(pred); assert.ok(d, what); return d; };
  const crop = async (id, name) => {
    const r = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id=${jsLiteral(JSON.stringify(id)).slice(1, -1)}]');d.scrollIntoView({block:'center'});const b=d.getBoundingClientRect();return {x:Math.floor(b.left),y:Math.floor(b.top),width:Math.ceil(b.width),height:Math.ceil(b.height)}})()`);
    await ctx.sleep(250);
    const img = await ctx.win.webContents.capturePage(r);
    fs.writeFileSync(path.join(OUT, `034-crop-${name}.png`), img.toPNG());
    console.log('[034] saved crop', name);
  };
  const emit = (e) => js(`window.__durbarSimEmit(${jsLiteral(e)})`);
  const rooms = () => js(`[...document.querySelectorAll('#stage .room')].reduce((o,r)=>{o[r.querySelector('.room-name').textContent.trim()]={tone:r.dataset.alert||'calm',siren:!!r.querySelector('.room-head .siren'),label:r.getAttribute('aria-label')};return o;},{})`);
  /* WCAG contrast of a header text against the pixels right next to it (the real, darkened floor) */
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = async (roomName, sel) => {
    const q = await js(`(()=>{const r=[...document.querySelectorAll('#stage .room')].find(x=>x.querySelector('.room-name').textContent.trim()===${jsLiteral(roomName)});const e=r&&r.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return null;const b=e.getBoundingClientRect(),c=getComputedStyle(e).color.match(/[\\d.]+/g).map(Number);return {x:Math.round(b.left)-5,y:Math.round(b.top+b.height/2)-1,c}})()`);
    if (!q) return null;
    const img = await ctx.win.webContents.capturePage({ x: q.x, y: q.y, width: 2, height: 2 });
    const bm = img.toBitmap(), n = bm.length / 4; let r = 0, g = 0, bl = 0;
    for (let i = 0; i < n; i++) { bl += bm[i * 4]; g += bm[i * 4 + 1]; r += bm[i * 4 + 2]; }
    const bg = [r / n, g / n, bl / n], a = lum(q.c), bb = lum(bg);
    return (Math.max(a, bb) + 0.05) / (Math.min(a, bb) + 0.05);
  };
  const serious = async (on) => {
    await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(800);
    const cur = await js(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`);
    if (cur !== on) { await js(`document.getElementById('seriousSw').click()`); await ctx.sleep(500); }
    const msg = await js(`document.getElementById('seriousMsg').textContent`);
    return msg;
  };

  for (const [w, h] of SIZES) {
    // a fresh request is not impatient (no simwaitold)
    await load(w, h);
    let ds = await desks();
    assert.ok(ds.every((d) => d.trouble !== 'impatient'), 'without simwaitold nobody has waited 60 s yet');

    await load(w, h, { simwaitold: '1' });
    ds = await desks();
    console.log('[034]', w, JSON.stringify(ds.map((d) => `${d.name}:${d.st}:${d.body}${d.trouble ? '+' + d.trouble : ''}${d.away ? '(away)' : ''}`)));
    const box = ds[0].box;
    assert.ok(ds.every((d) => d.box[0] === box[0] && d.box[1] === box[1]), 'every scene box has the same size: ' + JSON.stringify(ds.map((d) => d.box)));

    // US1: heavy and monster
    const heavy = ds.filter((d) => d.body === 'heavy'), monsters = ds.filter((d) => d.body === 'monster');
    assert.ok(heavy.length >= 1 && monsters.length >= 1, 'heavy and monster bodies are on screen');
    for (const m of monsters) {
      const n = /Context almost full \((\d+)%\)/.exec(m.label);
      assert.ok(n && +n[1] > 90 && m.title.includes(n[0]), `${m.name}: label and tooltip say the context is nearly full`);
      assert.ok(!m.text.includes('Context almost full'), `${m.name}: the visible text does not change`);
    }
    assert.ok(heavy.every((d) => !/Context almost full/.test(d.label)), 'heavy agents (70-90%) get no extra words');

    // US2: one ambulance, on an agent in error
    const amb = ds.filter((d) => d.trouble === 'ambulance');
    assert.strictEqual(amb.length, 1, 'exactly one ambulance');
    assert.strictEqual(amb[0].st, 'error', 'the ambulance is at an agent in Error');
    assert.strictEqual(ds.reduce((n, d) => n + d.amb, 0), 1, 'one ambulance drawing in the page');
    assert.ok(/Error: needs a look/.test(amb[0].label), 'the ambulance is named');
    const faint = await one((d) => d.trouble === 'faint', 'an agent fainted at its credit limit');
    assert.ok(/Limit reached/i.test(faint.text) && /Spending limit reached/.test(faint.label), 'faint: limit pill and label');
    assert.strictEqual(await js(`[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>d.dataset.id===${jsLiteral(faint.id)}).querySelectorAll('svg.scene animateTransform, svg.scene .wave').length`), 0, 'a fainted agent does not wave');
    const imp = ds.filter((d) => d.trouble === 'impatient');
    assert.ok(imp.length >= 1 && imp.every((d) => d.st === 'waiting' && /Waiting 2 min for you/.test(d.label)), 'impatient agents wait 2 min');
    assert.ok(imp.some((d) => !d.away && d.tap === 1), 'an impatient agent at its desk taps it');
    // [KNOWN GAP] an agent away at a place (spec 024) shows an empty chair: its mood drawing is there but hidden, the words stay
    const awayDz = ds.find((d) => d.away && d.trouble);
    if (awayDz) assert.strictEqual(await js(`getComputedStyle([...document.querySelectorAll('#stage .desk[data-id]')].find(d=>d.dataset.id===${jsLiteral(awayDz.id)}).querySelector('svg.scene .pp:last-of-type')).display`), 'none', `${awayDz.name}: away, so the drawing is hidden`);
    if (awayDz) assert.ok(/needs help|fainted|impatient|dizzy/.test(awayDz.label), `${awayDz.name}: the words stay while away`);
    // Rooms (issue #135): tone of the worst agent, siren where the ambulance or a faint is
    let rm = await rooms();
    console.log('[034]', w, 'rooms', JSON.stringify(Object.fromEntries(Object.entries(rm).map(([k, v]) => [k, v.tone + (v.siren ? '+siren' : '')]))));
    assert.deepStrictEqual(Object.fromEntries(Object.entries(rm).map(([k, v]) => [k, [v.tone, v.siren]])),
      { 'mcp-swiss': ['alarm', false], 'swisscontract-ai': ['alarm', true], 'command-center': ['alarm', true], blog: ['calm', false], 'infra-notes': ['uneasy', false] },
      'monster/impatient: alarm; ambulance and faint: alarm with siren; heavy only: uneasy; nothing: calm');
    for (const [k, v] of Object.entries(rm)) assert.strictEqual(/Alert: an agent needs help/.test(v.label), v.siren, k + ': the label names the alert only with the siren');
    const low = [];
    for (const k of Object.keys(rm)) for (const sel of ['.room-path', '.room-aiu']) {
      const c = await contrast(k, sel);
      if (c !== null) { low.push([k, rm[k].tone, sel, c]); if (w === 1440) console.log('[034] contrast', k, rm[k].tone, sel, c.toFixed(2)); }
    }
    assert.deepStrictEqual(low.filter((x) => x[3] < 4.5).map((x) => `${x[0]} ${x[2]} ${x[3].toFixed(2)} (${x[1]})`), [], 'header text keeps 4.5:1 at every tone, calm rooms included (T015)');
    assert.ok(low.some((x) => x[1] === 'calm'), 'a calm room was measured too');
    await shot('office', w, h);

    if (w === 1440) {
      await crop(amb[0].id, 'ambulance');
      await crop(faint.id, 'faint');
      await crop(imp.find((d) => !d.away).id, 'impatient');
      const mo = monsters.find((d) => !d.away && !d.trouble) || monsters.find((d) => !d.away);
      if (mo) await crop(mo.id, 'monster');
      const hv = heavy.find((d) => !d.away);
      if (hv) await crop(hv.id, 'heavy');
    }

    // Edge: a second, newer error takes the ambulance; when it ends the ambulance goes back
    const other = await one((d) => !d.away && d.st === 'idle' && !d.trouble && d.room !== amb[0].room, 'an idle agent in another room for a second error');
    await emit({ type: 'status', sessionId: other.id, timestamp: Date.now(), status: 'error', intent: 'Session failed' }); await ctx.sleep(700);
    ds = await desks();
    assert.deepStrictEqual(ds.filter((d) => d.trouble === 'ambulance').map((d) => d.id), [other.id], 'the newest error has the only ambulance');
    assert.strictEqual(ds.find((d) => d.id === amb[0].id).st, 'error', 'the first agent keeps its plain error look');
    rm = await rooms();
    assert.ok(rm[other.room].siren && rm[other.room].tone === 'alarm', 'the siren moves with the ambulance to ' + other.room);
    assert.ok(rm[amb[0].room].tone === 'alarm' && !rm[amb[0].room].siren, 'the old room stays dark without a siren (an agent is still in Error)');
    await emit({ type: 'status', sessionId: other.id, timestamp: Date.now(), status: 'idle' }); await ctx.sleep(700);
    ds = await desks();
    assert.deepStrictEqual(ds.filter((d) => d.trouble === 'ambulance').map((d) => d.id), [amb[0].id], 'the ambulance goes back');
    rm = await rooms(); assert.ok(rm[amb[0].room].siren && !rm[other.room].siren, 'and the siren with it');

    // US2.4: three failed calls in a row at the desk (an edit stays at the desk), then a successful one
    const dz = await one((d) => !d.away && (d.st === 'working' || d.st === 'thinking') && !d.trouble, 'a working agent at its desk');
    const call = (n, phase) => emit({ type: 'toolCall', sessionId: dz.id, timestamp: Date.now(), callId: 'shots-034-' + n, tool: 'edit', phase, args: { path: 'src/a.ts' } });
    for (let n = 0; n < 2; n++) { await call(n, 'start'); await call(n, 'failed'); }
    await ctx.sleep(5600); /* the mood timer looks every 5 s */
    assert.strictEqual((await desks()).find((d) => d.id === dz.id).trouble, null, 'two failed calls are not dizzy yet');
    await call(2, 'start'); await call(2, 'failed'); await ctx.sleep(5600);
    let d = (await desks()).find((x) => x.id === dz.id);
    assert.ok(d.trouble === 'dizzy' && d.dizzy === 1 && /3 tool calls failed in a row/.test(d.label), 'three failed calls: dizzy');
    if (w === 1440) await crop(dz.id, 'dizzy');
    await shot('dizzy', w, h);
    await call(3, 'start'); await call(3, 'complete'); await ctx.sleep(5600);
    assert.strictEqual((await desks()).find((x) => x.id === dz.id).trouble, null, 'a successful call clears it');

    // US3: Serious mode
    assert.strictEqual(await serious(true), 'Serious mode is on: no mood drawings.');
    if (w === 1280) await shot('settings', w, h);
    await js(`document.getElementById('scrClose').click()`); await ctx.sleep(700);
    ds = await desks();
    assert.ok(ds.every((x) => x.body === 'normal' && !x.trouble), 'Serious mode: every scene is plain');
    assert.strictEqual(await js(`document.querySelectorAll('#stage .amb, #stage .dizzy, #stage .sweat, #stage .tap').length`), 0, 'Serious mode: no mood drawing in the page');
    assert.ok(ds.every((x) => !/Context almost full|Error: needs a look|Spending limit reached|Waiting \d|tool calls failed/.test(x.label)), 'Serious mode: no mood words');
    assert.strictEqual(await js(`document.querySelectorAll('#stage .room[data-alert], #stage .siren').length`), 0, 'Serious mode: no room tone and no siren');
    assert.ok(Object.values(await rooms()).every((v) => !/Alert:/.test(v.label)), 'Serious mode: no alert words');
    await shot('serious', w, h);
    await serious(false); await js(`document.getElementById('scrClose').click()`); await ctx.sleep(700);
    assert.ok((await desks()).some((x) => x.body === 'monster'), 'Serious mode off: the drawings are back');
  }

  // US3.2: reduced motion stops the blink and the tapping (drawings stay)
  const dbg = ctx.win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ctx.sleep(300);
  const anim = await js(`[...document.querySelectorAll('#stage .amb-light, #stage .tap, #stage .siren-light')].map(e=>getComputedStyle(e).animationName)`);
  assert.ok(anim.length >= 4 && anim.every((a) => a === 'none'), 'reduced motion: nothing animates ' + JSON.stringify(anim));
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  dbg.detach();

  // FR-002: the compact density uses the same rules
  await load(1280, 800, { simwaitold: '1', density: 'mini' });
  const mini = await desks();
  assert.ok(mini.some((x) => x.body === 'monster') && mini.filter((x) => x.trouble === 'ambulance').length === 1 && mini.some((x) => x.trouble === 'faint'), 'mini density: same moods');
  await shot('mini', 1280, 800);
  // Edge (spec 033): an agent on a floor that is off never takes the ambulance (no alerts from an off floor)
  await load(1280, 800, { simwaitold: '1' });
  const tomas = (await desks()).find((x) => x.trouble === 'ambulance');
  await load(1280, 800, { simwaitold: '1', simfloors: '1', floorsoff: 'Client A' });
  let fl = await desks();
  assert.ok(!fl.some((x) => x.id === tomas.id), 'the agent with the ambulance is on the floor that is off');
  const vis1 = fl.find((x) => !x.away && x.st === 'idle' && !x.trouble);
  assert.ok(vis1, 'an idle agent on a floor that is on');
  await emit({ type: 'status', sessionId: vis1.id, timestamp: Date.now(), status: 'error', intent: 'Session failed' }); await ctx.sleep(400);
  await emit({ type: 'status', sessionId: tomas.id, timestamp: Date.now(), status: 'error', intent: 'Session failed again' }); await ctx.sleep(700);
  fl = await desks();
  assert.deepStrictEqual(fl.filter((x) => x.trouble === 'ambulance').map((x) => x.id), [vis1.id], 'a newer error on an off floor does not take the ambulance away');
  assert.strictEqual(await js(`[...document.querySelectorAll('#stage .room[data-siren]')].length`) >= 1, true, 'the siren is in a room that is shown');

  // closed door plate: the siren sits on the door icon, the plate keeps its size, the label names the alert
  await load(1280, 800, { simwaitold: '1', closed: 'blog,infra-notes' }); /* plates in one row stretch to the same height: measure them without any siren first */
  const h0 = await js(`Math.round(document.querySelector('.plate').getBoundingClientRect().height)`);
  await load(1280, 800, { simwaitold: '1', closed: 'swisscontract-ai,blog' });
  const plates = await js(`[...document.querySelectorAll('.plate')].map(p=>({n:p.querySelector('b').textContent,siren:!!p.querySelector('.siren'),h:Math.round(p.getBoundingClientRect().height),l:p.getAttribute('aria-label')}))`);
  const ps = plates.find((p) => p.n === 'swisscontract-ai'), pb = plates.find((p) => p.n === 'blog');
  assert.ok(ps.siren && /Alert: an agent needs help\./.test(ps.l), 'the closed room with the ambulance: siren and words on its plate');
  assert.ok(!pb.siren && !/Alert:/.test(pb.l), 'a calm closed room: no siren');
  assert.ok(ps.h === h0 && pb.h === h0, `the siren does not change the plate size (${ps.h}/${pb.h} vs ${h0} without a siren)`);
  await shot('plates', 1280, 800);

  // full density: the tone without the compact rooms' inner ring
  await load(1440, 900, { simwaitold: '1', density: 'full' });
  const ring = await js(`[...document.querySelectorAll('#stage .room[data-alert]')].map(r=>getComputedStyle(r).boxShadow)`);
  assert.ok(ring.length >= 1 && ring.every((b) => !/255, 255, 255/.test(b)), 'full density: dark overlay only ' + JSON.stringify(ring));
  console.log('[034] all checks passed');
};
