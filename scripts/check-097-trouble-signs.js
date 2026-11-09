/*
 * Spec 097 FR-360..FR-362 (issue #1171, part of #1147): the heavy look, the monster face and the siren on a Real office desk, on Open office's own
 * triggers. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-trouble-signs      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-trouble-signs-<w>x<h>.png; a temporary folder by default)
 *
 * At 1440x900 and 1280x800 it first loads the flat office and reads which desks Open office marks (the scene signature of each desk: heavy, monster,
 * ambulance, faint), then the Photo office and the cave (each check below), and the Retro arcade, and fails (exit 1) when:
 *   - the desks with a sweat drop, with horns and a ring, or with a siren are not exactly the desks Open office marks (that have a person at a desk);
 *     or one of the three kinds is missing from the simulator's agents (the check would be empty);
 *   - a sign has text, is not aria-hidden, takes a click, covers a face, a plate, a monitor, a note or another sign, or a slip or the inbox pill lies on it, or it leaves
 *     its desk's slot or the office;
 *   - the plate's accessible name lacks Open office's words ("Context almost full (N%)" for a monster, "Error: please check it" or "Spending limit reached" for a siren);
 *   - Serious mode (Settings) leaves a sign, or does not bring them back when it is off again;
 *   - the office scrolls;
 *   - (Photo office) a seat in the lounge row draws a sign, or its name takes mood words from a context event (the cheap path, read before any draw) or a draw, though
 *     Open office gives that agent a monster body (95 %);
 *   - (Retro arcade) a cabinet draws a sign, though a monster sits at it (its plate name keeps the words).
 * Mutants (edit src/renderer/realoffice.js, `npm run build`, run, `git checkout -- <file>`; each must fail its assert):
 *   cabinet     drop `!lay.cabinet` from the signs' guard                       -> "no trouble sign at an arcade cabinet"
 *   loungectx   in ctx() use `mood` for a lounge seat (drop `d.lounge ? null :`)  -> "gives ...'s lounge seat no mood words by the cheap path"
 *   loungemodel drop `!d.lounge` from the signs' guard AND give realModel's lounge seat `mood:realMood(moodFor(a))` (app.js) -> "a lounge seat ... draws no sign"
 *               (dropping `!d.lounge` alone is equivalent: the lounge seat's model carries no mood; spec 097 FR-361)
 *   slipavoid   drop `avoid.push(...MOOD_BOXES)` in drawSlips                    -> "... and a slip or pill ... do not overlap" (the cave at 1440x900)
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
/* the rows worlds draw the signs (FR-361): the Photo office and the cave; the Retro arcade's cabinets draw none */
const WORLDS = [['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['retro', { worldflags: 'retro', world: 'retro' }]];

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
    const slips=[...document.querySelectorAll('#stage .ro-slip')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>Object.assign(R(e),{cls:e.className}));
    return {signs,desks,slips,lounge:(L.lounge?L.lounge.desks:[]).map(d=>d.id),w:o.width,h:o.height,scroll:se.scrollWidth>innerWidth+1||se.scrollHeight>innerHeight+1}})()`);

  /* every draw of the office is counted (none is held or skipped): a step that asks for a draw waits for one before it reads what must not be there */
  const countDraws = () => js(`(()=>{const R=window.DurbarRealOffice;if(!R.__render){R.__render=R.render;R.render=function(){window.__roDraws=(window.__roDraws||0)+1;return R.__render.apply(this,arguments);};}window.__roDraws=window.__roDraws||0;return 1})()`);
  const drawNow = async (what) => { const d0 = await js(`window.__roDraws||0`); await js(`window.__durbarSimUi.render();1`); await must(`(window.__roDraws||0)>${jsLiteral(d0)}`, what); };
  const homeMoody = async (tag, F) => {
    /* the simulator sends some agents to a place (a tool call or a request open) and a desk with nobody at it has no face to put a sign on (FR-361): so the agents that
       carry a mood go home here, by a status event (the turn ended); no agent's state is set by hand; which ones are away at load is a matter of timing */
    const moody = F.filter((x) => x.body && x.body !== 'normal' && !x.trouble).map((x) => x.id);
    await js(`(()=>{for(const id of ${jsLiteral(moody)})window.__durbarSimEmit({type:'status',sessionId:id,timestamp:Date.now(),status:'idle'});window.__durbarSimUi.render();return 1})()`); /* the app's own way home (the turn ended); no state is set by hand */
    await must(`(()=>{const L=window.__durbarSimUi.realLayout(),ids=${jsLiteral(moody)};const ds=L.zones.flatMap(z=>z.desks);return ids.every(id=>{const d=ds.find(x=>x.id===id);return d&&d.person&&d.face&&!d.away})})()`, `${tag}: the heavy and monster agents at their desks`);
    await must(`window.__durbarSimUi.visitsSettled()`, `${tag}: no visit about to start or end`);
    return moody;
  };
  /* FR-361 (review of #1321, item 5): a lounge seat draws no sign and its name takes no mood words, though Open office gives the agent a monster body. An agent that
     finished goes to the lounge row once read, by the app's own Mark as read (check-097-lounge's way); the context event is the real one */
  const loungeStep = async (tag) => {
    const SIM = 'window.__durbarSimUi';
    let L = await js(`(${SIM}.realLayout().lounge||{desks:[]}).desks.map(d=>d.id)`);
    if (!L.length) {
      const pick = await js(`(()=>{const A=${SIM}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit;
        const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away&&d.face).map(d=>d.id));
        const c=M.find(a=>['idle','working','thinking'].includes(a.state)&&home.has(a.id)&&!a.paused&&!a.limit&&!A.some(h=>h.parent===a.id)&&M.some(o=>o.room===a.room&&o.id!==a.id&&!fin(o)));return c?c.id:null})()`);
      assert.ok(pick, `${tag}: an agent that can finish into the lounge (its room keeps one working)`);
      await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(pick)});a.state='done';a.lastOutput=a.lastOutput||'Finished the change and ran the tests.';a.lastEventAt=Date.now();${SIM}.unread.read(a.id);${SIM}.crew.renderAll();return 1})()`);
      await must(`!!document.querySelector('#stage .ro-plate.lounge[data-id="'+CSS.escape(${jsLiteral(pick)})+'"]')`, `${tag}: ${pick} in the lounge row once read`);
      L = [pick];
    }
    const id = L[0];
    /* the context event, and in the same task (before any draw) the name the cheap path wrote */
    const cheap = await js(`(()=>{window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(id)},timestamp:Date.now(),tokens:95000,limit:100000});return document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]').getAttribute('aria-label')})()`);
    assert.ok(/\|monster/.test(await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(id)});const m=/data-sig="([^"]*)"/.exec(${SIM}.scene(a)||'');return m?m[1]:''})()`)), `${tag}: Open office gives ${id}, in the lounge at 95 %, the monster body (else this check is empty)`);
    assert.ok(/context 95 %/.test(cheap) || /lounge/.test(cheap), `${tag}: the cheap path wrote ${id}'s lounge name: ${cheap}`);
    assert.ok(!/Context almost full/.test(cheap), `${tag}: a context event gives ${id}'s lounge seat no mood words by the cheap path (its full draw has none): ${cheap}`);
    await drawNow(`${tag}: a draw after the lounge seat's context event`);
    assert.ok(await js(`!!document.querySelector('#stage .ro-plate.lounge[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')`), `${tag}: ${id} still sits in the lounge row`);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-mood[data-for="'+CSS.escape(${jsLiteral(id)})+'"]').length`), 0, `${tag}: a lounge seat with a monster's context (${id}) draws no sign`);
    assert.ok(!/Context almost full/.test(await js(`document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]').getAttribute('aria-label')`)), `${tag}: ${id}'s lounge name after the draw has no mood words`);
    console.log(`[097-signs] ${tag}: lounge seat ${id} at 95 %: no sign, no mood words`);
  };

  for (const [w, h] of SIZES) {
    await H.load({ w, h, query: { officeview: undefined } });
    const F = await flat();
    assert.ok(F.length >= 15, `${w}x${h}: the flat office has its 15 desks`);
    for (const [world, wq] of WORLDS) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', ...wq }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    if (world !== 'photo') assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), wq.world, `${tag}: the ${world} world is shown`);
    await countDraws();
    await must(`window.__durbarSimUi.visitsSettled()`, `${tag}: no visit about to start or end`);
    if (world === 'retro') {
      /* FR-361: the arcade's cabinets draw no sign, though its desks carry the same moods and the plate's name their words (review of #1321, item 5: the cabinet guard) */
      const moody = await homeMoody(tag, F);
      await drawNow(`${tag}: a draw with the moody agents home`);
      const A = await read();
      const faced = new Set(A.desks.filter((d) => d.face && d.hasPerson).map((d) => d.id));
      const mon = F.filter((x) => x.body === 'monster' && faced.has(x.id)).map((x) => x.id);
      assert.ok(mon.length >= 1, `${tag}: a monster agent sits at a cabinet with a face (else this check is empty): moody ${JSON.stringify(moody)}`);
      assert.deepStrictEqual(A.signs.map((x) => x.kind + ' on ' + x.id), [], `${tag}: no trouble sign at an arcade cabinet`);
      for (const id of mon) assert.ok(/Context almost full \(\d+%\)/.test(A.desks.find((d) => d.id === id).label), `${tag}: ${id}'s plate name still says the monster's words at a cabinet`);
      console.log(`[097-signs] ${tag}: ${mon.length} monsters at a cabinet, no sign drawn`);
      continue;
    }
    await homeMoody(tag, F);
    await drawNow(`${tag}: a draw with the moody agents home`);
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
      for (const r of S.slips) assert.ok(!hit(s.r, r), `${tag}: ${s.kind} on ${s.id} and a slip or pill (${r.cls}) do not overlap: ${JSON.stringify(s.r)} vs ${JSON.stringify(r)}`);
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
    await H.shot(path.join(OUT, `097-trouble-signs-${world}-${w}x${h}.png`), { prep: 'calm', delay: 300, tag: '097', what: `trouble signs ${tag}` });
    /* Serious mode removes every sign and brings them back */
    await serious(true);
    await must(`!document.querySelector('#stage .ro-mood')`, `${tag}: no sign in Serious mode`);
    await serious(false);
    await must(`document.querySelectorAll('#stage .ro-mood').length===${jsLiteral(S.signs.length)}`, `${tag}: the signs back when Serious mode is off`);
    if (world === 'photo') await loungeStep(tag);
    console.log(`[097-signs] ${tag}: ${[...Object.keys(kinds)].map((k) => k + ' ' + kinds[k].size).join(', ')}; ${S.signs.length} signs, none over a face, plate, monitor or note`);
    }
  }
  console.log('[097-signs] pictures in ' + OUT);
};
