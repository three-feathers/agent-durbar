/*
 * Spec 097 FR-360..FR-362 (issue #1171, part of #1147): the heavy look, the monster face and the siren on a Real office desk, on Open office's own
 * triggers. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-trouble-signs      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-trouble-signs-<w>x<h>.png; a temporary folder by default)
 *
 * At 1440x900 and 1280x800 it first loads the flat office and reads which desks Open office marks (the scene signature of each desk: heavy, monster,
 * ambulance, faint), then the Photo office and fails (exit 1) when:
 *   - the desks with a sweat drop, with horns and a ring, or with a siren are not exactly the desks Open office marks (that have a person at a desk);
 *     or one of the three kinds is missing from the simulator's agents (the check would be empty);
 *   - a sign has text, is not aria-hidden, takes a click, covers a face, a plate, a monitor, a note or another sign, or leaves its desk's slot or the office;
 *   - the plate's accessible name lacks Open office's words ("Context almost full (N%)" for a monster, "Error: please check it" or "Spending limit reached" for a siren);
 *   - Serious mode (Settings) leaves a sign, or does not bring them back when it is off again;
 *   - the office scrolls.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-signs-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  /* Open office's decision per main desk, read from its scene signature (spec 034: "...|heavy|monster" and the trouble) */
  const flat = () => js(`[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>{const sv=d.querySelector('svg.scene'),m=/\\|(normal|heavy|monster)(\\w*)$/.exec((sv&&sv.dataset.sig)||'');return {id:d.dataset.id,body:m?m[1]:null,trouble:m&&m[2]?m[2]:null,label:d.getAttribute('aria-label')||''}})`);
  const serious = async (on) => {
    await js(`document.getElementById('settingsBtn').click()`);
    await must(`!!document.getElementById('seriousSw')`, 'the Serious mode switch');
    if ((await js(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`)) !== on) await js(`document.getElementById('seriousSw').click()`);
    await must(`document.getElementById('seriousSw').getAttribute('aria-checked')===${jsLiteral(String(on))}`, 'the switch to settle');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  };
  /* the signs in the page, by desk, and the geometry of everything they must keep clear of */
  const read = () => js(`(()=>{const L=window.__durbarSimUi.realLayout(),ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect(),R=e=>{const b=e.getBoundingClientRect();return {x:b.left-o.left,y:b.top-o.top,r:b.right-o.left,b:b.bottom-o.top}};
    const signs=[...document.querySelectorAll('#stage .ro-mood')].map(e=>({id:e.dataset.for,kind:/ro-sweat/.test(e.className)?'sweat':/ro-horns/.test(e.className)?'horns':/ro-ring/.test(e.className)?'ring':/ro-siren/.test(e.className)?'siren':'?',r:R(e),text:e.textContent.trim(),paths:e.querySelectorAll('path').length,vb:(e.querySelector('svg')||{getAttribute:()=>''}).getAttribute('viewBox'),siren:!!e.querySelector('.siren'),hidden:e.getAttribute('aria-hidden')==='true',pe:getComputedStyle(e).pointerEvents,shown:e.getClientRects().length>0}));
    const desks=L.zones.flatMap(z=>z.desks).map(d=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"]'),s=document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(d.id)+'"] .ro-bezel'),n=document.querySelector('#stage .ro-away[data-for="'+CSS.escape(d.id)+'"]');
      return {id:d.id,face:d.face,slot:d.slot,hasPerson:!!d.person,away:!!d.away,plate:p?R(p):null,screen:s?R(s):null,note:n&&n.getClientRects().length?R(n):null,label:p?p.getAttribute('aria-label'):''}});
    const se=document.scrollingElement;
    return {signs,desks,lounge:(L.lounge?L.lounge.desks:[]).map(d=>d.id),w:o.width,h:o.height,scroll:se.scrollWidth>innerWidth+1||se.scrollHeight>innerHeight+1}})()`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: undefined } });
    const F = await flat();
    assert.ok(F.length >= 15, `${tag}: the flat office has its 15 desks`);
    await H.load({ w, h, query: { officeview: 'real' }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    await must(`window.__durbarSimUi.visitsSettled()`, `${tag}: no visit about to start or end`);
    /* the simulator sends some agents to a place (a tool call or a request open) and a desk with nobody at it has no face to put a sign on (FR-361): so the agents that
       carry a mood go home here, by a status event (the turn ended); no agent's state is set by hand; which ones are away at load is a matter of timing */
    const moody = F.filter((x) => x.body && x.body !== 'normal' && !x.trouble).map((x) => x.id);
    await js(`(()=>{for(const id of ${jsLiteral(moody)})window.__durbarSimEmit({type:'status',sessionId:id,timestamp:Date.now(),status:'idle'});window.__durbarSimUi.render();return 1})()`); /* the app's own way home (the turn ended); no state is set by hand */
    await must(`(()=>{const L=window.__durbarSimUi.realLayout(),ids=${jsLiteral(moody)};const ds=L.zones.flatMap(z=>z.desks);return ids.every(id=>{const d=ds.find(x=>x.id===id);return d&&d.person&&d.face&&!d.away})})()`, `${tag}: the heavy and monster agents at their desks`);
    await must(`window.__durbarSimUi.visitsSettled()`, `${tag}: no visit about to start or end`);
    let S = await read();
    const drawn = new Map(S.desks.filter((d) => d.face && d.hasPerson).map((d) => [d.id, d]));
    const want = (f) => new Set(F.filter((x) => drawn.has(x.id) && f(x)).map((x) => x.id));
    const have = (k) => new Set(S.signs.filter((s) => s.kind === k).map((s) => s.id));
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const kinds = { sweat: want((x) => x.body === 'heavy'), horns: want((x) => x.body === 'monster'), ring: want((x) => x.body === 'monster'), siren: want((x) => x.trouble === 'ambulance' || x.trouble === 'faint') };
    for (const k of Object.keys(kinds)) {
      assert.ok(kinds[k].size >= 1, `${tag}: the simulator has a desk for the ${k} sign (else this check is empty): ${JSON.stringify(F.map((x) => x.id + ':' + x.body + '/' + x.trouble + (drawn.has(x.id) ? '' : ' nodrawn=' + JSON.stringify((S.desks.find((d) => d.id === x.id) || {}).hasPerson) + (S.lounge.includes(x.id) ? 'lounge' : ''))))}; signs ${jsLiteral(S.signs.length)}`);
      assert.ok(same(kinds[k], have(k)), `${tag}: ${k} sign on exactly Open office's desks: want ${[...kinds[k]]}, drawn ${[...have(k)]}`);
    }
    /* the shape, not only the class: a stale picture under the wrong class must fail (a heavy desk that climbed to monster, and back) */
    const shapeOf = { sweat: (x) => x.paths === 1 && x.vb === '0 0 10 16' && !x.siren, horns: (x) => x.paths === 2 && x.vb === '0 0 40 20' && !x.siren, ring: (x) => x.paths === 0 && !x.vb && !x.siren, siren: (x) => x.siren };
    const shapes = (sg, t) => sg.forEach((x) => assert.ok(shapeOf[x.kind](x), `${t}: the ${x.kind} on ${x.id} has its own shape: ${JSON.stringify({ paths: x.paths, vb: x.vb, siren: x.siren })}`));
    shapes(S.signs, tag);
    assert.strictEqual(S.signs.filter((s) => s.kind === '?').length, 0, `${tag}: only known signs`);
    assert.strictEqual(S.scroll, false, `${tag}: the office does not scroll`);
    /* geometry: inside its slot and the office, clear of the face (the ring excepted: it is the face's frame, outside it), plate, monitor, note and every other sign */
    const hit = (a, b) => a.x + 0.5 < b.r && b.x + 0.5 < a.r && a.y + 0.5 < b.b && b.y + 0.5 < a.b;
    const bySign = new Map(S.desks.map((d) => [d.id, d]));
    S.signs.forEach((s, i) => {
      const d = bySign.get(s.id), f = d.face, fr = { x: f.x, y: f.y, r: f.x + f.w, b: f.y + f.h };
      assert.ok(s.shown && s.hidden && s.pe === 'none' && s.text === '', `${tag}: ${s.kind} on ${s.id} is drawn, aria-hidden, takes no click, has no text`);
      assert.ok(s.r.x >= d.slot.x - 0.5 && s.r.r <= d.slot.x + d.slot.w + 0.5 && s.r.y >= d.slot.y - 0.5 && s.r.r <= S.w + 0.5 && s.r.b <= S.h + 0.5, `${tag}: ${s.kind} on ${s.id} stays inside its slot: ${JSON.stringify(s.r)} in ${JSON.stringify(d.slot)}`);
      if (s.kind !== 'ring') assert.ok(!hit(s.r, fr), `${tag}: ${s.kind} on ${s.id} does not cover the face`);
      for (const [n, r] of [['plate', d.plate], ['monitor', d.screen], ['note', d.note]]) if (r) assert.ok(!hit(s.r, r), `${tag}: ${s.kind} on ${s.id} does not cover the ${n}`);
      S.signs.forEach((t, j) => { if (j > i && !(s.id === t.id && (s.kind === 'ring' || t.kind === 'ring'))) assert.ok(!hit(s.r, t.r), `${tag}: ${s.kind} on ${s.id} overlaps ${t.kind} on ${t.id}`); });
    });
    /* the words */
    const label = (id) => bySign.get(id).label;
    for (const id of kinds.ring) assert.ok(/Context almost full \(\d+%\)/.test(label(id)), `${tag}: ${id}'s plate name says the monster's words: ${label(id)}`);
    for (const id of kinds.sweat) assert.ok(!/Context almost full/.test(label(id)), `${tag}: ${id}'s heavy look has no words, as in Open office (from 90% only): ${label(id)}`);
    for (const id of kinds.siren) assert.ok(/Error: please check it|Spending limit reached/.test(label(id)), `${tag}: ${id}'s plate name names the trouble: ${label(id)}`);
    /* a desk that climbs from heavy to monster and back, by the real context event: the sign changes with it, with its own picture each time */
    const top = [...kinds.sweat][0];
    const ctxAt = async (tokens) => js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(top)},timestamp:Date.now(),tokens:${jsLiteral(tokens)},limit:100000});window.__durbarSimUi.render();1`);
    const kindsOf = (id) => js(`[...document.querySelectorAll('#stage .ro-mood[data-for=${jsLiteral(id)}]')].map(e=>({kind:/ro-sweat/.test(e.className)?'sweat':/ro-horns/.test(e.className)?'horns':/ro-ring/.test(e.className)?'ring':'siren',paths:e.querySelectorAll('path').length,vb:(e.querySelector('svg')||{getAttribute:()=>''}).getAttribute('viewBox'),siren:!!e.querySelector('.siren')}))`);
    const want2 = async (names, what) => {
      assert.ok(await H.until(`[...document.querySelectorAll('#stage .ro-mood[data-for=${jsLiteral(top)}]')].map(e=>/ro-sweat/.test(e.className)?'sweat':/ro-horns/.test(e.className)?'horns':/ro-ring/.test(e.className)?'ring':'siren').sort().join()===${jsLiteral(names.slice().sort().join())}`, 15000), `${tag}: ${what}: signs ${names}`);
      (await kindsOf(top)).forEach((x) => assert.ok(shapeOf[x.kind](x), `${tag}: ${what}: the ${x.kind} has its own picture: ${JSON.stringify(x)}`));
    };
    await ctxAt(95000); await want2(['horns', 'ring'], 'heavy to monster');
    await ctxAt(80000); await want2(['sweat'], 'monster back to heavy');
    await H.shot(path.join(OUT, `097-trouble-signs-${tag}.png`), { prep: 'calm', delay: 300, tag: '097', what: `trouble signs ${tag}` });
    /* Serious mode removes every sign and brings them back */
    await serious(true);
    await must(`!document.querySelector('#stage .ro-mood')`, `${tag}: no sign in Serious mode`);
    await serious(false);
    await must(`document.querySelectorAll('#stage .ro-mood').length===${jsLiteral(S.signs.length)}`, `${tag}: the signs back when Serious mode is off`);
    console.log(`[097-signs] ${tag}: ${[...Object.keys(kinds)].map((k) => k + ' ' + kinds[k].size).join(', ')}; ${S.signs.length} signs, none over a face, plate, monitor or note`);
  }
  console.log('[097-signs] pictures in ' + OUT);
};
