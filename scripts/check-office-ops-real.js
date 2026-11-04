/*
 * Spec 097 FR-186, FR-178's Real office rows (this file; the flat rows are `check-office-ops.js`, one file each since the #941/#950 merge) (T149, T151, T153; part of T142): operation counts of Real office, never times. Simulator only, no AI credits.
 * At 15 and 40 agents, 1440x900, device pixel ratio 1 (emulated, so that every OS counts the same; FR-183 says what Retina does):
 *   - one status event of one agent through the normal path (`__durbarSimEmit`), waited for with until(), the median of 8 (simulator visits run on the wall clock, so
 *     a single reading can hold another agent's walk), each started only when nothing is put off (DurbarRealOffice.pending(): no screen repaint, FR-033, and no
 *     done-tick redraw waiting on a timer) and the lobby is settled, so no earlier update's deferred work lands in it: renders, layout reads (offset*, client*, scroll*, getBoundingClientRect, getClientRects), nodes added or removed
 *     and attribute writes in #stage (a MutationObserver; the state's own cues, a call light, a "?", "!", the thinking dots and a folder's count of a new state, are not "nodes rewritten");
 *   - elements recalculated by one text change (`UpdateLayoutTree.elementCount` of one short contentTracing, a count; animations off for the trace);
 *   - FR-180, FR-181: the running infinite animations (at most one per light whose state moves, none outside the lights), that each is stepped at most 8 changes a
 *     second and names only transform and opacity, no element with a blend mode; none running under reduced motion (emulated) and Serious mode (the Settings switch);
 *   - FR-183: natural area of the distinct pictures over the shown device-pixel area, also at 3 agents (big screens), which must not show a picture below its size;
 *     read on a settled lobby (SETTLED): a simulator visit starts 600 ms after its call on the wall clock, so a read taken at once on an idle machine and later on a
 *     loaded one saw different people (4 or 34 visitors at 40 agents, a ratio of 2.81 or 4.05 to 4.65; review on #969).
 * Every row over its limit fails; a KNOWN_FAILURES entry's `max` is what was measured plus a stated margin, so a regression under a known failure still fails.
 * A row over its limit today is named in KNOWN_FAILURES with its fix task and the most it may reach meanwhile; that task's PR deletes the entry.
 *
 *   npm run check:ui -- --only check-office-ops-real      (builds first)
 *   OPS_INDEX=<index.html>   load another build of the page (a mutation or a before/after run)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { contentTracing } = require('electron');
const { helpers, jsLiteral } = require('./driver-helpers');

const LIMITS = { rendersPerStatus: 1, readsPerStatus: 5, nodesPerStatus: 0, attrWritesPerStatus: 10, elementsRecalculated: 50, pictureArea: 4, animationsOverLights: 0, animationsOffLights: 0, animationsUnstepped: 0, animationsOtherProperty: 0, lightsBoxShadow: 0, stepsPerSecond: 8, blendElements: 0, animationsStill: 0 };
/* Measured 2026-11-04 (second review on #969), Linux under xvfb: 16 runs of 8 updates, 8 idle and 8 under eight busy loops on 4 cores: reads 15 and nodes 22 in
   every update at 15 and 40 agents; attribute writes 40 and 34 by turns at 15 (median 40), 48 and 42 at 40 (median 48). Before each update waited for nothing put off,
   a loaded run counted 26, 27 and 44 nodes in single updates at 40 agents (a screen's deferred repaint, or a done tick's redraw, inside the window: a second render);
   with the wait, none. Margin: 2 on each (one more node pair or a few more writes than measured fail). Spec 097, Changes 2026-11-04 (review on #969) */
const KNOWN_FAILURES = {
  /* T149 left: about 24 and 32 attribute writes are the change itself, as the desks re-sort on a status change (measured 2026-11-04 with drawSlips returning at once: reads 3, nodes 0, attribute writes 24 at 15 agents and 32 at 40; FR-190: the budget of 10 may need moving) */
  'attrWritesPerStatus@15': { task: 'T149 (desks re-sorting) and T184 (slips)', max: 42 },
  'attrWritesPerStatus@40': { task: 'T149 (desks re-sorting) and T184 (slips)', max: 50 },
  /* T184: the slips (spec 097 FR-121..FR-124, drawSlips, main) are drawn again on a status update. Measured 2026-11-04 with drawSlips returning at once:
     nodes 22 to 0, layout reads 15 to 3, attribute writes 40 to 24 (15 agents) and 48 to 32 (40): so all 22 nodes, 12 of the 15 reads and 16 attribute writes are the slips'.
     Not known: why they are redrawn (whether the simulator's update really changes a slip's content, or their signature changes without it) */
  'readsPerStatus@15': { task: 'T184, the slips redrawn on a status update', max: 17 },
  'readsPerStatus@40': { task: 'T184, the slips redrawn on a status update', max: 17 },
  'nodesPerStatus@15': { task: 'T184, the slips redrawn on a status update', max: 24 },
  'nodesPerStatus@40': { task: 'T184, the slips redrawn on a status update', max: 24 },
};

const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
/* the lobby as it stays: every script replayed, no visit waiting to start or end (places.js settled()), no render queued (settleNow draws it), no picture fading out, every picture decoded */
const SETTLED = `!!window.__durbarSimReplayed&&window.__durbarSimUi.visitsSettled()&&window.__durbarSimUi.settleNow()&&!document.querySelector('#stage .ro-ghost')&&` + REAL;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function trace(fn) {
  await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'toplevel'], excluded_categories: ['*'] });
  await fn();
  const file = path.join(os.tmpdir(), `durbar-ops-${process.pid}-${Date.now()}.json`);
  await contentTracing.stopRecording(file);
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(d) ? d : d.traceEvents;
  } finally { fs.rmSync(file, { force: true }); }
}

/** Sum of `elementCount` of the renderer main thread's UpdateLayoutTree events, and how many events of that thread the trace holds at all. */
function elementsRecalculated(events) {
  const names = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
  const main = events.filter((e) => e.ph !== 'M' && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain');
  return { count: main.filter((e) => e.name === 'UpdateLayoutTree').reduce((s, e) => s + ((e.args && e.args.elementCount) || 0), 0), mainEvents: main.length };
}

/* The counters, in the page: renders, layout reads, nodes and attribute writes between `start()` and `stop()` */
const INSTRUMENT = `(()=>{ if(window.__ops)return; const O=window.__ops={on:false,reads:0,renders:0,attrs:0,nodes:0,seen:{},by:{}};const CUE=/^ro-(call|bub|bang|dots|cnt)\\b/;
  const bump=()=>{if(!O.on)return;O.reads++;const f=String(new Error().stack||'').split('\\n').slice(3,5).map(x=>x.trim().replace(/^.*\\/([^/]+:\\d+):\\d+\\)?$/,'$1')).join(' < ');O.by[f]=(O.by[f]||0)+1;};
  for(const prop of ['offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight','clientTop','clientLeft','scrollHeight','scrollWidth','scrollTop','scrollLeft'])
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.get)Object.defineProperty(proto,prop,{...d,get(){bump();return d.get.call(this);}});}
  for(const m of ['getBoundingClientRect','getClientRects']){const f=Element.prototype[m];Element.prototype[m]=function(){bump();return f.apply(this,arguments);};}
  const R=window.DurbarRealOffice,r=R.render;R.render=function(){if(O.on)O.renders++;return r.apply(this,arguments);};
  const take=(l)=>{if(!O.on)return;for(const m of l){if(m.type==='attributes'){O.attrs++;const k=(m.target.className&&String(m.target.className).split(' ')[0]||m.target.tagName)+'.'+m.attributeName;O.seen[k]=(O.seen[k]||0)+1;}else for(const n of [...m.addedNodes,...m.removedNodes])if(!(n.classList&&CUE.test(n.className))){O.nodes++;const k='node:'+(n.className&&String(n.className).split(' ')[0]||n.nodeName)+' in '+(m.target.className&&String(m.target.className).split(' ')[0]||m.target.nodeName);O.seen[k]=(O.seen[k]||0)+1;}}};
  const mo=new MutationObserver(take);mo.observe(document.getElementById('stage'),{subtree:true,childList:true,attributes:true});
  O.start=()=>{O.reads=O.renders=O.attrs=O.nodes=0;O.seen={};O.by={};O.on=true;};
  O.stop=()=>{take(mo.takeRecords());O.on=false;return {reads:O.reads,renders:O.renders,attrs:O.attrs,nodes:O.nodes,seen:O.seen,by:O.by};};
})()`;

/* FR-183: natural area of the distinct pictures (each decoded once) over what is shown, in device pixels; a chosen picture's real size comes from a plain Image of its currentSrc (with srcset, naturalWidth is corrected by the chosen density) */
const AREA = `(async()=>{const imgs=[...document.querySelectorAll('#stage .ro img')],seen=new Map(),dpr=devicePixelRatio;let shown=0,under=[];
  for(const i of imgs){const r=i.getBoundingClientRect();const a=r.width*r.height*dpr*dpr;shown+=a;
    let s=seen.get(i.currentSrc);if(!s){const p=new Image();p.src=i.currentSrc;await p.decode();s=[p.naturalWidth,p.naturalHeight];seen.set(i.currentSrc,s);}
    if(s[0]+1<r.width*dpr)under.push(i.currentSrc.split('/').pop()+' '+s[0]+'<'+Math.round(r.width*dpr));}
  let nat=0;for(const [w,h] of seen.values())nat+=w*h;return {dpr,distinct:seen.size,half:[...seen.keys()].filter(u=>/\\.h\\.webp/.test(u)).length,naturalMB:nat*4/1e6,shownMB:shown*4/1e6,ratio:nat/shown,under};})()`;

/* FR-180, FR-181: the infinite animations running now; what they animate, how often they change, and whether their light's state moves */
const ANIMS = `(()=>{const ok=new Set(['offset','easing','composite','computedOffset','transform','opacity']);const r={running:0,offLights:0,unstepped:0,other:0,stepsPerSecond:0,names:{}};
  for(const a of document.getAnimations()){if(a.playState!=='running'||!a.effect||a.effect.getComputedTiming().iterations!==Infinity)continue;const t=a.effect.target;if(!t||!t.closest('.ro'))continue;
    r.running++;r.names[a.animationName]=(r.names[a.animationName]||0)+1;if(!t.closest('.ro-lights'))r.offLights++;
    const kf=a.effect.getKeyframes();let n=0,stepped=true;
    kf.slice(0,-1).forEach((k,i)=>{const m=/steps\\((\\d+)/.exec(k.easing);const hold=JSON.stringify({...k,offset:0,computedOffset:0,easing:0})===JSON.stringify({...kf[i+1],offset:0,computedOffset:0,easing:0});if(hold)return;if(m)n+=+m[1];else{stepped=false;n+=60*(kf[i+1].computedOffset-k.computedOffset)*a.effect.getComputedTiming().duration/1000;}});
    if(!stepped)r.unstepped++;r.stepsPerSecond=Math.max(r.stepsPerSecond,Math.round(n/(a.effect.getComputedTiming().duration/1000)*10)/10);
    if(kf.some(k=>Object.keys(k).some(x=>!ok.has(x))))r.other++;}
  r.moving=[...document.querySelectorAll('#stage .ro-plate')].filter(p=>/^(waiting|thinking)$/.test(p.dataset.state)).length;
  r.blend=[...document.querySelectorAll('#stage .ro, #stage .ro *')].filter(e=>getComputedStyle(e).mixBlendMode!=='normal').length;
  r.boxShadow=[...document.querySelectorAll('#stage .ro-lights *')].filter(e=>getComputedStyle(e).boxShadow!=='none').length;
  return r;})()`;
const ANIMS_STILL = `document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&a.effect.target&&a.effect.target.closest('.ro')&&a.effect.getComputedTiming().iterations===Infinity).length`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const index = process.env.OPS_INDEX || undefined;
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 1, mobile: false });
  /* the machine's own setting must not decide the motion rows (as in check-097-motion): Windows CI runners report "reduce motion", and then the people and the lights
     rightly stand still, so "second frames running" found none there (spec 097, Changes 2026-11-04). The reduced-motion rows below emulate "reduce" themselves */
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const rows = {};
  const readsBy = {}; /* n -> the layout reads of the update with the most, by the page line that made them (a reads row over its limit names them) */
  const load = (n, extra = {}) => H.load({ w: 1440, h: 900, index, query: { sim: String(n), officeview: 'real', ...extra }, ready: REAL, readyMs: 30000, settle: false });
  const frames = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const c=new MessageChannel();c.port1.onmessage=()=>r(1);c.port2.postMessage(0);})))`);

  // ---- FR-183 at big screens ----
  await load(3);
  assert.ok(await H.until(SETTLED, 20000), '3 agents: the lobby settled');
  const big = await js(AREA);
  rows['pictureArea@3'] = big.ratio;
  console.log('[ops] 3 agents, pictures:', JSON.stringify(big));
  assert.deepStrictEqual(big.under, [], 'big screens: no picture is shown larger than it is');

  // ---- FR-183 with the people moving (romotion=1): a pose's second frame takes the same size as its first, so the half-size set holds with motion on ----
  await load(15, { romotion: '1' });
  assert.strictEqual(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), false, 'motion on: reduced motion is emulated off, whatever the machine says');
  assert.ok(await H.until('(' + SETTLED + `)&&document.querySelectorAll('#stage :is(.ro-person2,.ro-visitor2).m-b').length>0`, 20000), 'motion on: second frames running: ' + JSON.stringify(await js(`[...document.querySelectorAll('#stage :is(.ro-person2,.ro-visitor2,.ro-rig)')].map(e=>e.className)`)));
  const pair = await js(`[...document.querySelectorAll('#stage :is(.ro-person2,.ro-visitor2)')].map(b=>{const a=document.querySelector('#stage :is(.ro-person,.ro-visitor)[data-for="'+CSS.escape(b.dataset.for)+'"]');return [b.dataset.for,/\.h\.webp$/.test(a&&a.currentSrc||''),/\.h\.webp$/.test(b.currentSrc)];})`);
  const moving15 = await js(AREA);
  rows['pictureArea@15motion'] = moving15.ratio;
  console.log('[ops] 15 agents with motion, pictures:', JSON.stringify(moving15), 'second frames', pair.length);
  assert.ok(pair.length > 0, 'motion on: second frames to compare');
  assert.deepStrictEqual(pair.filter(([, a, b]) => a !== b), [], 'FR-183: a second frame is half size exactly when its first frame is ([id, first half, second half])');

  for (const n of [15, 40]) {
    await load(n);
    assert.ok(await H.until(SETTLED, 20000), `${n} agents: the lobby settled`);
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.big==='1'`), false, `${n} agents are not big screens`);
    const area = await js(AREA);
    rows[`pictureArea@${n}`] = area.ratio;
    console.log('[ops]', n, 'agents, pictures:', JSON.stringify(area));
    assert.deepStrictEqual(area.under, [], `${n} agents: no picture is shown larger than it is`);
    // ---- FR-180, FR-181: wait for a light that moves (a simulator agent may be on a visit), then read ----
    await H.until(`document.querySelectorAll('#stage .ro-call.pulse, #stage .ro-glow.breathe').length>0`, 40000);
    const a = await js(ANIMS);
    console.log('[ops]', n, 'agents, animations:', JSON.stringify(a));
    assert.ok(a.running > 0, 'a light moves, so the row is not empty');
    rows[`animationsOverLights@${n}`] = Math.max(0, a.running - a.moving);
    rows[`animationsOffLights@${n}`] = a.offLights;
    rows[`animationsUnstepped@${n}`] = a.unstepped;
    rows[`animationsOtherProperty@${n}`] = a.other;
    rows[`stepsPerSecond@${n}`] = a.stepsPerSecond;
    rows[`lightsBoxShadow@${n}`] = a.boxShadow;
    rows[`blendElements@${n}`] = a.blend;
    /* T151: what the moving lights make the main thread paint: logged, never asserted (a number of a stretch of time) */
    for (let t = 0; t < 3; t++) {
      const tick = await trace(() => ctx.sleep(2200)); /* FR-048b: a measurement window of a fixed length (what 2.2 s of moving lights paint), not a wait for a state */
      const main = new Map(tick.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
      const count = (name) => tick.filter((e) => e.name === name && main.get(`${e.pid}:${e.tid}`) === 'CrRendererMain').length;
      console.log('[ops]', n, 'agents, in 2.2 s of moving lights, main thread: Paint', count('Paint'), 'UpdateLayoutTree', count('UpdateLayoutTree'), 'PrePaint', count('PrePaint'), 'Layerize', count('Layerize'), '(logged only)');
    }
    // ---- FR-184: one status change of one agent at its desk ----
    await js(INSTRUMENT);
    const id = await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(x=>x.dataset.state==='working'&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.dataset.id)+'"]'))||[...document.querySelectorAll('#stage .ro-plate')].find(x=>x.dataset.state==='idle'&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.dataset.id)+'"]'));return p&&p.dataset.id})()`);
    assert.ok(id, 'an agent at its desk, working or idle');
    const emit = (st) => js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`);
    /* the simulator's idle agent has replied, so it may read as done: "not working" is the change that is waited for */
    const stateOf = `(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')||{dataset:{}}).dataset.state`;
    const shows = (st) => (st === 'working' ? `${stateOf}==='working'` : `${stateOf}&&${stateOf}!=='working'`);
    await emit('working');
    await H.until(shows('working'), 8000);
    await frames();
    const per = { renders: [], reads: [], nodes: [], attrs: [] };
    let seen = {}, worst = null, putOff = 0, mostReads = null;
    const startedBusy = [];
    for (let i = 0; i < 8; i++) {
      const st = i % 2 ? 'working' : 'idle';
      /* a deterministic window (review on #969, nodes 27 once at 40 agents): the previous update's deferred work (its screen's throttled repaint, FR-033, 2 s; a done tick's redraw, 2.05 s)
         lands later on the wall clock, and under a CPU load inside this window. Start only when nothing is put off, the lobby settled and no render queued */
      assert.ok(await H.until(`(()=>{const p=window.DurbarRealOffice.pending();return p.screens===0&&p.ticks===0;})()&&` + SETTLED, 15000), `${n} agents: nothing put off before update ${i}: ` + JSON.stringify(await js(`window.DurbarRealOffice.pending()`)));
      await frames();
      /* what was put off at the very start of the window, read in the same page task that starts it: every measured update must start from none */
      if (await js(`(()=>{const p=window.DurbarRealOffice.pending();window.__ops.start();return p.screens+p.ticks;})()`)) startedBusy.push(i);
      await emit(st);
      const ok = await H.until(shows(st), 8000);
      assert.ok(ok, `the plate shows ${st}`);
      await frames();
      const o = await js(`window.__ops.stop()`);
      const put = await js(`(()=>{const p=window.DurbarRealOffice.pending();return p.screens+p.ticks;})()`); putOff += put;
      for (const k of Object.keys(per)) per[k].push(o[k]);
      seen = o.seen;
      if (!mostReads || o.reads > mostReads.reads) mostReads = { i, reads: o.reads, by: o.by };
      if (!worst || o.nodes + o.attrs > worst.nodes + worst.attrs) worst = { i, ...o }; /* the most costly update's breakdown is logged, so a failure says what it wrote */
    }
    assert.deepStrictEqual(startedBusy, [], `${n} agents: every measured update started with nothing put off (the updates that did not)`);
    assert.ok(putOff > 0, `${n} agents: pending() saw the screen repaints the updates put off (FR-033), so the wait before each update waits for something real`);
    rows[`rendersPerStatus@${n}`] = med(per.renders);
    rows[`readsPerStatus@${n}`] = med(per.reads);
    rows[`nodesPerStatus@${n}`] = med(per.nodes);
    rows[`attrWritesPerStatus@${n}`] = med(per.attrs);
    readsBy[n] = mostReads;
    console.log('[ops]', n, 'agents, per status update (8):', JSON.stringify(per));
    console.log('[ops]', n, 'agents, layout reads of update', mostReads.i, '(' + mostReads.reads + '), by line:', JSON.stringify(mostReads.by));
    for (const [k, v] of Object.entries(seen)) console.log('[ops]  ', n, 'agents, last update wrote', k, v); // node: = added or removed
    console.log('[ops]', n, 'agents, the most costly update (' + worst.i + '):', worst.nodes, 'nodes', worst.attrs, 'attribute writes', JSON.stringify(worst.seen));
    // ---- FR-185: one text change, in the normal shape of a render ----
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(s);})()`);
    const change = (i) => js(`(()=>{document.querySelector('#stage .ro-plate .ro-l2').textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
    await change(0);
    await frames();
    /* a trace that holds no event of the renderer's main thread did not record it (seen under a CPU load: 2 0 2 2): taken again, up to 4 more times; a trace
       that recorded the thread but no recalculation still fails below */
    const counts = [];
    for (let i = 1, again = 0; counts.length < 4; i++) {
      const r = elementsRecalculated(await trace(() => change(i)));
      if (r.mainEvents === 0 && again < 4) { again++; console.log('[ops]', n, 'agents, a trace without the renderer main thread, taken again'); continue; }
      counts.push(r.count);
    }
    assert.ok(counts.every((c) => c > 0), `${n} agents: a replaced text node must recalculate some element; a trace with none means the trace's thread or event name changed (${counts})`);
    rows[`elementsRecalculated@${n}`] = Math.max(...counts);
    console.log('[ops]', n, 'agents, elements recalculated by one text change:', counts.join(' '));
  }

  // ---- FR-047, FR-181: nothing runs under reduced motion or Serious mode ----
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load(15);
  assert.ok(await js(`document.querySelector('#stage .ro').classList.contains('still')`), 'reduced motion: the scene is still');
  rows['animationsStill@reduced'] = await js(ANIMS_STILL);
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await load(15);
  await H.until(`document.querySelectorAll('#stage .ro-call.pulse, #stage .ro-glow.breathe').length>0`, 40000);
  assert.ok((await js(ANIMS_STILL)) > 0, 'normal motion: a light moves, so the two rows above and below can fail');
  await js(`document.getElementById('settingsBtn').click()`);
  await H.until(`!!document.getElementById('seriousSw')`);
  await js(`document.getElementById('seriousSw').click()`);
  await H.until(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`);
  await js(`document.getElementById('scrClose').click()`);
  await H.until(`document.querySelector('#stage .ro').classList.contains('still')`);
  rows['animationsStill@serious'] = await js(ANIMS_STILL);
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined);
  await dbg.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  dbg.detach();

  console.log('[ops] rows', JSON.stringify(rows));
  const failed = [];
  for (const [key, value] of Object.entries(rows)) {
    const row = key.split('@')[0], known = KNOWN_FAILURES[key];
    if (value > LIMITS[row]) {
      if (known && value <= known.max) console.log(`[ops] ${key} = ${value} over ${LIMITS[row]} (known failure, ${known.task}; may not pass ${known.max})`);
      else failed.push(`${key} = ${value}, limit ${known ? known.max : LIMITS[row]}` + (row === 'readsPerStatus' ? ' (callers in the [ops] reads lines above)' : ''));
    } else if (known) failed.push(`${key} = ${value} is within its limit: delete its KNOWN_FAILURES entry (${known.task})`);
  }
  /* a failing reads row names its callers one per short line, the most first, right before the assert: the suite keeps only a failed driver's last 25 lines of 240 characters */
  for (const f of failed) {
    const m = /^readsPerStatus@(\d+) /.exec(f), r = m && readsBy[m[1]];
    if (r) for (const [line, c] of Object.entries(r.by).sort((x, y) => y[1] - x[1]).slice(0, 10)) console.log(`[ops] reads@${m[1]} update ${r.i}: ${c} from ${line}`);
  }
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
};
