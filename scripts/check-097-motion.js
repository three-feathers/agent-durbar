/*
 * Real office mode, phase P2 (spec 097 T033): the people's motion and what stops it, in the simulator. No credits. In ui-suite.js; `node scripts/ui-suite.js --only check-097-motion`.
 * It fails (exit 1) when:
 *   - motion: a working person's two pictures do not alternate (computed opacity over time, and two pixel captures that differ); periods outside 1.15-1.5 s, or more than 2 changes a
 *     second a desk; anything but `transform` and `opacity` in an animation of the people or screens, or no stepped timing; a blur on the zoom (FR-070, FR-180, FR-181, FR-182);
 *   - under reduced motion (emulated, page loaded with it) or Serious mode (the real switch): a person moves, a second frame or a caret is there, or captures differ; the text still changes (FR-071, FR-033);
 *   - hidden: animations run or text repaints while hidden; a missed line does not show once on return (FR-074);
 *   - a pose change without its cross-fade, a desk-to-lobby move without its fade at both ends, a person drawn over the desk after coming back (FR-072, FR-073);
 *   - 40 agents: a desk scrolled out of view keeps moving, or paints (FR-181, spec 097 T030 pacing).
 * Screenshots: <SHOTS_OUT>/097-real-moving-<w>x<h>.png
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-motion-'));
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const T0 = Date.now(), mark = (m) => console.log(`[097-motion] ${Math.round((Date.now() - T0) / 1000)} s: ${m}`);
  const wc = () => ctx.win.webContents;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  /* a frozen simulator (nothing changes but what the driver emits); romotion=1: the people move, as outside a driver */
  const loadReal = async (w, h, query = {}) => {
    await H.load({ w, h, query: { officeview: 'real', romotion: '1', ...query }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    await must(`document.querySelectorAll('#stage .ro-stext:not(.off) .ro-sl').length>0`, 'text on the screens');
    await H.calm();
  };
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  /* a screen's text box lies exactly over its glass: find it by the desk's glass rectangle from the layout */
  const INSTALL = `window.__scr=(id)=>{const L=window.__durbarSimUi.realLayout(),d=L.zones.flatMap(z=>z.desks).find(x=>x.id===id),ro=document.querySelector('#stage .ro').getBoundingClientRect();if(!d)return null;
      return [...document.querySelectorAll('#stage .ro-stext')].find(e=>{const b=e.getBoundingClientRect();return Math.abs(b.left-ro.left-d.glass.x)<1&&Math.abs(b.top-ro.top-d.glass.y)<1;})||null;};0`;
  const pickWorking = `window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state==='working').map(d=>d.id)`;

  /* simulator visits run on the wall clock and take the frozen run's working agents to the lobby: an idle agent told to work stays at its desk */
  const seat = async (nth = 0) => {
    const id = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.state==='idle'&&d.person).map(d=>d.id)[${jsLiteral(nth)}]`);
    assert.ok(id, 'an idle agent at a desk');
    await emit({ type: 'status', sessionId: id, status: 'working', intent: 'Driver work' });
    await must(`!!document.querySelector('#stage .ro-person[data-pose="typeA"][data-for="'+CSS.escape(${jsLiteral(id)})+'"]')`, 'a person typing at the desk');
    return id;
  };
  mark('motion');
  /* ---- FR-070, FR-180, FR-181: the people move, in steps ---- */
  const CROP = (id) => `(()=>{const b=document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(id)})+'"]').getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),width:Math.round(b.width*0.75),height:Math.round(b.height)};})()`; /* the person only: the right quarter holds the monitor, whose text may change */
  const bitmap = async (r) => (await ctx.win.webContents.capturePage(r)).toBitmap();
  /* the share of pixels that really changed (more than 8 of 255 in a channel): a capture of one state can differ by rounding */
  const changed = (a, b) => { if (a.length !== b.length) return 1; let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++; return n / (a.length / 4); };
  const same = (a, b) => changed(a, b) < 0.001;
  const animInfo = `document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.ro-art,.ro-stext')).map(a=>{const t=a.effect.getTiming(),k=a.effect.getKeyframes(),props=[...new Set(k.flatMap(f=>Object.keys(f).filter(p=>!['offset','computedOffset','easing','composite'].includes(p))))];
    return {name:a.animationName||'',target:a.effect.target.className,dur:t.duration,props,ease:a.animationName?getComputedStyle(a.effect.target).animationTimingFunction:t.easing,state:a.playState,changes:k.length,kf:k.map(f=>f.easing)};})`;
  for (const [w, h] of SIZES) {
    await loadReal(w, h);
    await js(INSTALL);
    /* simulator visits run on the wall clock and can take a person from the desk on a slow machine: another idle one then */
    const onRig = (i) => `!!document.querySelector('#stage .ro-person.m-rig[data-for="'+CSS.escape(${jsLiteral(i)})+'"]')&&document.querySelectorAll('#stage .ro-rig[data-for="'+CSS.escape(${jsLiteral(i)})+'"] img').length===3`;
    let typist = await seat();
    for (let t = 1; t < 4 && !(await H.until(onRig(typist), 5000)); t++) typist = await seat(0);
    await must(onRig(typist), 'the typist on the rig: head and two hands (spec Changes 2026-11-01)');
    const anims = await js(animInfo);
    const names = {}; for (const a of anims) names[a.name] = (names[a.name] || 0) + 1;
    console.log('[097-motion] animations', w, h, JSON.stringify(names));
    assert.ok(names['ro-type'] >= 2 && names['ro-rig-hand'] >= 2 && names['ro-rig-head'] >= 1, 'two-frame animations: ' + JSON.stringify(names));
    for (const a of anims) {
      assert.ok(a.props.every((p) => p === 'opacity' || p === 'transform'), `FR-180: only opacity and transform: ${a.name}: ${a.props}`);
      if (/ro-(person|visitor)/.test(a.target) && /^ro-(fa|fb|fa-run|fb-run|br|type|wave|run|knock)$/.test(a.name)) assert.ok(!/steps|step-/.test(a.ease), `people ease (spec Changes 2026-11-01): ${a.name}: ${a.ease}`);
      if (/ro-(person|visitor)/.test(a.target) && /^ro-f[ab]/.test(a.name)) assert.ok(a.dur >= 720 && a.dur <= 3200, 'a frame period: ' + a.dur);
      if (a.name === 'ro-br' || a.name === 'ro-type') assert.ok(a.dur >= 5000 && a.dur <= 8000, 'a sway: ' + a.dur);
    }
    // the two pictures alternate: computed opacity, always one showing, over two periods; and the pixels differ
    await must(`!!document.querySelector('#stage .ro-visitor.m-a')&&!!document.querySelector('#stage .ro-visitor2.m-b')`, 'a runner on two pictures');
    const id = await js(`document.querySelector('#stage .ro-visitor.m-a').dataset.for`);
    const alt = await js(`new Promise(res=>{const A=document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(${jsLiteral(id)})+'"]'),B=document.querySelector('#stage .ro-visitor2[data-for="'+CSS.escape(${jsLiteral(id)})+'"]');
      const seen=new Set(),bad=[];const t0=performance.now();const iv=setInterval(()=>{if(!A.isConnected||!B.isConnected||!A.classList.contains('m-a')){clearInterval(iv);res({gone:true});return;}
        const a=+getComputedStyle(A).opacity,b=+getComputedStyle(B).opacity;seen.add(a+'/'+b);if(Math.max(a,b)<0.6)bad.push(a+'/'+b);if(a>0.05&&a<0.95||b>0.05&&b<0.95)window.__between=(window.__between||0)+1;if(performance.now()-t0>3200){clearInterval(iv);res({seen:[...seen],bad,srcA:A.src.split('/').pop(),srcB:B.src.split('/').pop(),startA:(A.getAnimations()[0]||{}).startTime,startB:(B.getAnimations()[0]||{}).startTime});}},40);})`);
    assert.ok(!alt.gone, 'the typist stayed at the desk');
    console.log('[097-motion] frames', JSON.stringify(alt));
    assert.deepStrictEqual(alt.bad, [], 'the figure never goes see-through');
    assert.ok(alt.seen.includes('1/0') && alt.seen.includes('0/1'), 'both frames seen');
    assert.ok(await js(`window.__between||0`) > 0, 'and in between: it cross-fades, nothing pops');
    assert.notStrictEqual(alt.srcA, alt.srcB, 'two pictures');
    assert.strictEqual(alt.startA, alt.startB, 'FR-181: one clock per desk');
    assert.ok(alt.startA < 1500, 'its own place in the cycle, not the time it was drawn: ' + alt.startA);
    const rigClock = await js(`[...document.querySelectorAll('#stage .ro-rig[data-for="'+CSS.escape(${jsLiteral(typist)})+'"] img.h')].map(i=>i.getAnimations()[0].startTime)[0]`);
    assert.strictEqual(typeof rigClock, 'number', 'the rig has a clock');
    await must(`!!window.__scr(${jsLiteral(typist)}).querySelector('.ro-caret')`, 'a caret on the working screen');
    assert.strictEqual(await js(`window.__scr(${jsLiteral(typist)}).querySelector('.ro-caret').getAnimations()[0].startTime`), await js(`document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(typist)})+'"]').getAnimations()[0].startTime`), 'the caret on the same clock as its desk');
    const r = await js(CROP(typist)), first = await bitmap(r);
    let most = 0;
    for (let t = 0; t < 12 && most < 0.005; t++) { await ctx.sleep(180); most = Math.max(most, changed(first, await bitmap(r))); }
    console.log(`[097-motion] frames differ by ${(most * 100).toFixed(1)} % of the person's pixels`);
    assert.ok(most >= 0.005, 'frame captures differ while working');
    await H.shot(path.join(OUT, `097-real-moving-${w}x${h}.png`), { prep: 'calm' });
  }

  mark('fades');
  /* ---- FR-072, FR-073: a pose change cross-fades; a person leaves the desk and arrives at a fixture; back behind the desk ---- */
  await loadReal(1440, 900);
  await js(INSTALL);
  const mover = await seat(0);
  await js(`(()=>{window.__g=[];new MutationObserver(ms=>{for(const m of ms){for(const n of m.addedNodes)if(n.classList&&n.classList.contains('ro-ghost'))window.__g.push(n.src);if(m.type==='attributes'&&m.target.classList.contains('ro-ghost')){window.__g.push(m.target.src);(window.__gz=window.__gz||{})[m.target.src]=getComputedStyle(m.target).zIndex;}}}).observe(document.querySelector('#stage .ro-art'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});})();0`);
  const SRC = (id) => `document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(id)})+'"]').src`;
  const oldPose = await js(SRC(mover));
  await emit({ type: 'status', sessionId: mover, status: 'idle' });
  await must(`window.__g.includes(${jsLiteral(oldPose)})`, 'FR-072: a ghost of the old pose', 5000);
  await must(`!document.querySelector('#stage .ro-ghost')`, 'the ghost gone after its fade');
  const lobbyId = await seat(0);
  const seated = await js(SRC(lobbyId));
  await js(`window.__g=[];0`);
  await js(`0`);
  await emit({ type: 'toolCall', sessionId: lobbyId, callId: 'drv-walk', tool: 'bash', phase: 'start', args: { command: 'npm run a-long-one' } });
  await must(`!!document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(${jsLiteral(lobbyId)})+'"]')`, 'the agent at its place in the lobby');
  assert.ok(await H.until(`window.__g.includes(${jsLiteral(seated)})`, 2000), 'FR-073: a fade where the person sat');
  assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-walker').length`), 0, 'nobody walks across the room (spec Changes 2026-11-01)');
  await must(`!document.querySelector('#stage .ro-ghost')`, 'the fade over', 6000);
  const standing = await js(`document.querySelector('#stage .ro-visitor[data-for="'+CSS.escape(${jsLiteral(lobbyId)})+'"]').src`);
  await emit({ type: 'toolCall', sessionId: lobbyId, callId: 'drv-walk', tool: 'bash', phase: 'complete', output: 'ok' });
  await must(`!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(lobbyId)})+'"]')`, 'the person back at the desk');
  await must(`window.__g.includes(${jsLiteral(standing)})`, 'FR-073: a fade where the visitor stood');
  assert.strictEqual(await js(`(window.__gz||{})[${jsLiteral(standing)}]`), '3', 'a visitor fades in front of its fixture');
  const order = await js(`(()=>{const q=(s)=>document.querySelector('#stage '+s+'[data-for="'+CSS.escape(${jsLiteral(lobbyId)})+'"]');return {p:+getComputedStyle(q('.ro-person')).zIndex,d:+getComputedStyle(q('.ro-desk')).zIndex,s:+getComputedStyle(q('.ro-screen')).zIndex};})()`);
  assert.ok(order.p < order.d && order.d < order.s, 'back behind the desk: ' + JSON.stringify(order));

  mark('hidden');
  /* ---- FR-074: hidden: nothing runs, nothing paints; one catch-up on return. A real hide where the OS gives one, else the document's own signal ---- */
  await loadReal(1440, 900);
  await js(INSTALL);
  const hid = await seat();
  ctx.win.hide();
  let realHide = await H.until(`document.hidden`, 3000);
  if (!realHide) await js(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));})();0`);
  console.log('[097-motion] hidden:', realHide ? 'a real hide' : 'the signal only (the window manager did not hide it)');
  await must(`document.querySelector('#stage .ro').classList.contains('paused')`, 'the scene paused when hidden');
  const running = await js(`document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.ro')&&a.playState==='running').map(a=>(a.animationName||'waapi')+':'+a.effect.target.className)`);
  assert.deepStrictEqual(running, [], 'FR-074: nothing runs while hidden');
  const hiddenText = await js(`window.__scr(${jsLiteral(hid)}).textContent`);
  await emit({ type: 'toolCall', sessionId: hid, callId: 'drv-hid', tool: 'read_file', phase: 'start', args: { path: 'src/while/hidden.ts' } });
  await js(`new Promise(r=>setTimeout(r,2300))`); // a bound on a negative: longer than one repaint period, and it must not paint
  assert.strictEqual(await js(`window.__scr(${jsLiteral(hid)}).textContent`), hiddenText, 'no repaint while hidden');
  ctx.win.show(); ctx.win.focus();
  if (!realHide) await js(`(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));})();0`);
  await must(`window.__scr(${jsLiteral(hid)}).textContent.includes('hidden.ts')`, 'the catch-up on return');
  await must(`!document.querySelector('#stage .ro').classList.contains('paused')`, 'running again');

  mark('still');
  /* ---- FR-071, FR-047: reduced motion (emulated, page loaded with it) and Serious mode (the real switch): one still frame, text still updates ---- */
  const stillChecks = async (tag) => {
    await must(`document.getElementById('stage').dataset.d==='real'&&document.querySelector('#stage .ro').classList.contains('still')`, tag + ': the scene still');
    await must(`document.querySelectorAll('#stage .ro-person2,#stage .ro-rig').length===0`, tag + ': no second frame and no rig');
    const n = await js(animInfo);
    assert.deepStrictEqual(n.map((a) => a.name), [], tag + ': nothing moves');
    await js(INSTALL);
    assert.strictEqual(await js(`[...document.querySelectorAll('#stage .ro-caret')].filter(e=>e.getClientRects().length).length`), 0, tag + ': no caret');
    const id = await seat();
    /* the picture of the new pose decodes first; simulator visits end on the wall clock, and a neighbour coming back moves this desk: the read starts
       again from a new place or ambient. On one place it must hold, unchanged, for over a whole frame period. */
    const place = async () => { await must(`!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(id)})+'"]')`, tag + ': the person at the desk'); return js('JSON.stringify([' + CROP(id) + `,document.querySelector('#stage .ro').dataset.ambient])`); };
    let held = 0, worst = 0, at = '', a = null;
    for (let t = 0; t < 60 && held < 7; t++) {
      await ctx.sleep(250);
      const p = await place(), r = JSON.parse(p)[0], b = await bitmap(r);
      if (p !== at || !a) { at = p; a = b; held = 0; continue; }
      const c = changed(a, b);
      if (held === 0 && c >= 0.001) { a = b; continue; } /* still decoding */
      worst = Math.max(worst, c); held++;
      assert.ok(c < 0.001, `${tag}: captures are equal: ${(c * 100).toFixed(2)} % of pixels changed at one place`);
    }
    assert.strictEqual(held, 7, tag + ': the desk held still long enough to compare');
    console.log(`[097-motion] ${tag}: captures alike over ${held * 250} ms, at most ${(worst * 100).toFixed(2)} % changed`);
    const who = (await js(pickWorking))[0];
    await emit({ type: 'toolCall', sessionId: who, callId: 'drv-still-' + tag, tool: 'read_file', phase: 'start', args: { path: 'src/still/' + tag + '.ts' } });
    await must(`window.__scr(${jsLiteral(who)}).textContent.includes(${jsLiteral(tag + '.ts')})`, tag + ': the text still changes');
    assert.strictEqual(await js(`document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.ro-stext')).length`), 0, tag + ': no slide');
  };
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await loadReal(1440, 900);
  await stillChecks('reduced');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  await loadReal(1440, 900);
  await must(`document.querySelectorAll('#stage .ro-rig,#stage .ro-person2,#stage .ro-visitor2').length>0`, 'the rig or second frames without reduced motion');
  await js(`document.getElementById('settingsBtn').click()`);
  await must(`!!document.getElementById('seriousSw')`, 'the Serious mode switch');
  await js(`document.getElementById('seriousSw').click()`);
  await must(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`, 'Serious mode on');
  await js(`window.DurbarScreens.close();0`);
  await must(REAL + `&&!document.body.classList.contains('panel-open')`, 'back in the office');
  await stillChecks('serious');
  await js(`document.getElementById('settingsBtn').click()`);
  await must(`!!document.getElementById('seriousSw')`, 'the Serious mode switch');
  await js(`document.getElementById('seriousSw').click()`);
  await must(`document.getElementById('seriousSw').getAttribute('aria-checked')==='false'`, 'Serious mode off');
  await js(`window.DurbarScreens.close();0`);
  await must(REAL + `&&!document.body.classList.contains('panel-open')`, 'back in the office');

  mark('forty');
  /* ---- FR-181: 40 agents: a desk scrolled away stands still and does not paint; scrolled back it catches up ---- */
  await loadReal(1280, 560, { sim: '40' }); // a short window: past the 15-agent scale, whole rows are out of view
  await js(INSTALL);
  await must(`document.getElementById('floor').classList.contains('scrolls')`, 'a scrolling floor with 40 agents');
  await must(`document.querySelectorAll('#stage .ro-stext.ro-off').length>0`, 'desks out of view marked');
  const OUTRUN = `(()=>{const fl=document.getElementById('floor').getBoundingClientRect();return [...document.querySelectorAll('#stage .ro-person,#stage .ro-rig img')].filter(e=>e.getBoundingClientRect().top>fl.bottom+20&&e.getAnimations().some(a=>a.playState==='running'));})()`;
  assert.ok(await H.until(`${OUTRUN}.length===0`, 8000), 'nothing out of view runs');
  const rigsOut = await js(`(()=>{const fl=document.getElementById('floor').getBoundingClientRect();return [...document.querySelectorAll('#stage .ro-rig')].filter(e=>e.getBoundingClientRect().top>fl.bottom+20).length;})()`);
  console.log('[097-motion] rigs out of view', rigsOut);
  assert.ok(rigsOut > 0, 'a rig out of view, or the line above proved nothing for rigs');
  /* a rig goes still with its person, in the same frame: not only when the next draw sets the class */
  const late = await js(`new Promise((done)=>{const f=document.getElementById('floor');f.scrollTop=0;const t0=performance.now();let bad=0,seen=0;const look=()=>{for(const r of document.querySelectorAll('#stage .ro-rig')){const p=document.querySelector('#stage .ro-person[data-for="'+CSS.escape(r.dataset.for)+'"]');if(!p)continue;if(p.classList.contains('ro-off'))seen++;if(p.classList.contains('ro-off')!==r.classList.contains('ro-off'))bad++;}if(performance.now()-t0<1500)requestAnimationFrame(look);else done({bad,seen});};f.scrollTop=f.scrollHeight;requestAnimationFrame(look);})`);
  console.log('[097-motion] rig with its person', JSON.stringify(late));
  assert.ok(late.seen > 0, 'rigs went out of view: ' + JSON.stringify(late));
  assert.strictEqual(late.bad, 0, 'a rig out of step with its person');
  await js(`document.getElementById('floor').scrollTop=0;0`);
  const off = await js(`(()=>{const fl=document.getElementById('floor').getBoundingClientRect();const out=[...document.querySelectorAll('#stage .ro-person')].filter(e=>e.getBoundingClientRect().top>fl.bottom+20);
return {out:out.length};})()`);
  console.log('[097-motion] 40 agents', JSON.stringify({ out: off.out }));
  assert.ok(off.out > 0, 'people out of view');
  /* a working desk scrolled away (a line would re-sort an idle one, FR-022, and bring it into view): scroll to the end, so the first rows are out. Simulator visits can still
     lay a row out again and bring a desk back: then the paint is fair, and the read starts over on another */
  /* visits start 600 ms after a call and shrink the desks: draw once more and wait until the layout's height holds for a second */
  const first = (await js(pickWorking))[0];
  await emit({ type: 'status', sessionId: first, status: 'working', intent: 'Driver work' });
  let hgt = -1;
  for (let t = 0; t < 40; t++) { const n = await js(`window.__durbarSimUi.realLayout().height`); if (n === hgt && t > 4) break; hgt = n; await ctx.sleep(250); }
  await js(`(()=>{const f=document.getElementById('floor');f.scrollTop=f.scrollHeight;})();0`);
  await must(`document.getElementById('floor').scrollTop>0&&window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).some(x=>x.state==='working'&&window.__scr(x.id)&&window.__scr(x.id).classList.contains('ro-off'))`, 'a working desk scrolled out of view');
  let proved = false;
  for (let t = 0; t < 4 && !proved; t++) {
    const away = await js(`(()=>{const L=window.__durbarSimUi.realLayout();const d=L.zones.flatMap(z=>z.desks).filter(x=>x.state==='working'&&window.__scr(x.id)&&window.__scr(x.id).classList.contains('ro-off')&&!window.__scr(x.id).textContent.includes('of-view')).sort((p,q)=>p.glass.y-q.glass.y);return d.length?d[0].id:'';})()`);
    if (!away) break;
    const t0 = await js(`window.__scr(${jsLiteral(away)}).textContent`);
    await emit({ type: 'toolCall', sessionId: away, callId: 'drv-off' + t, tool: 'read_file', phase: 'start', args: { path: 'src/out/of-view.ts' } });
    await js(`new Promise(r=>setTimeout(r,2300))`); // a bound on a negative
    const after = await js(`(()=>{const e=window.__scr(${jsLiteral(away)});return {text:e.textContent,off:e.classList.contains('ro-off'),top:Math.round(e.getBoundingClientRect().top)};})()`);
    if (!after.off) continue;
    assert.strictEqual(after.text, t0, 'no repaint out of view');
    await js(`(()=>{const b=window.__scr(${jsLiteral(away)}).getBoundingClientRect(),f=document.getElementById('floor');f.scrollTop+=b.top-f.getBoundingClientRect().top-100;})();0`);
    await must(`window.__scr(${jsLiteral(away)}).textContent.includes('of-view')`, 'the catch-up when scrolled back');
    proved = true;
  }
  assert.ok(proved, 'a desk stayed out of view long enough to prove it');

  console.log('[097-motion] OK');
};
