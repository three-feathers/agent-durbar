/*
 * Spec 097 FR-186, FR-178's Real office rows (T149, T151, T153; part of T142): operation counts of Real office, never times. Simulator only, no AI credits.
 * `origin/097-flat-perf-has` and `097-flat-perf-layout` (#941, #950) have a file of this name with the flat rows: on a merge keep both, as `flat` and `real` parts.
 * At 15 and 40 agents, 1440x900, device pixel ratio 1 (emulated, so that every OS counts the same; FR-183 says what Retina does):
 *   - one status event of one agent through the normal path (`__durbarSimEmit`), waited for with until(), the median of 8 (simulator visits run on the wall clock, so
 *     a single reading can hold another agent's walk): renders, layout reads (offset*, client*, scroll*, getBoundingClientRect, getClientRects), nodes added or removed
 *     and attribute writes in #stage (a MutationObserver; the state's own cues, a call light, a "?", "!", the thinking dots and a folder's count of a new state, are not "nodes rewritten");
 *   - elements recalculated by one text change (`UpdateLayoutTree.elementCount` of one short contentTracing, a count; animations off for the trace);
 *   - FR-180, FR-181: the running infinite animations (at most one per light whose state moves, none outside the lights), that each is stepped at most 8 changes a
 *     second and names only transform and opacity, no element with a blend mode; none running under reduced motion (emulated) and Serious mode (the Settings switch);
 *   - FR-183: natural area of the distinct pictures over the shown device-pixel area, also at 3 agents (big screens), which must not show a picture below its size.
 * A row over its limit today is named in KNOWN_FAILURES with its fix task and the most it may reach meanwhile; that task's PR deletes the entry.
 *
 *   npm run check:ui -- --only check-office-ops      (builds first)
 *   OPS_INDEX=<index.html>   load another build of the page (a mutation or a before/after run)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { contentTracing } = require('electron');
const { helpers, jsLiteral } = require('./driver-helpers');

const LIMITS = { rendersPerStatus: 1, readsPerStatus: 5, nodesPerStatus: 0, attrWritesPerStatus: 10, elementsRecalculated: 50, pictureArea: 4, animationsOverLights: 0, animationsOffLights: 0, animationsUnstepped: 0, animationsOtherProperty: 0, stepsPerSecond: 8, blendElements: 0, animationsStill: 0 };
const KNOWN_FAILURES = {
  'elementsRecalculated@15': { task: 'T148, on 097-flat-perf-has', max: 1200 },
  'elementsRecalculated@40': { task: 'T148, on 097-flat-perf-has', max: 2000 },
  /* T149 left: 15 and 40 of these are `sc.dataset.for` in render()'s monitor lines (097-p2-screens's until it lands); about 30 are the change itself, as the desks re-sort on a status change. FR-190: the budget of 10 may need moving */
  'attrWritesPerStatus@15': { task: 'T149, monitor lines after 097-p2-screens', max: 60 },
  'attrWritesPerStatus@40': { task: 'T149, monitor lines after 097-p2-screens', max: 90 },
  'blendElements@15': { task: 'T150', max: 30 },
  'blendElements@40': { task: 'T150', max: 60 },
  'animationsUnstepped@15': { task: 'T151', max: 15 },
  'animationsUnstepped@40': { task: 'T151', max: 40 },
  'stepsPerSecond@15': { task: 'T151', max: 60 },
  'stepsPerSecond@40': { task: 'T151', max: 60 },
  'pictureArea@15': { task: 'T153', max: 12 },
  'pictureArea@40': { task: 'T153', max: 24 },
};

const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
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

/** Sum of `elementCount` of the renderer main thread's UpdateLayoutTree events. */
function elementsRecalculated(events) {
  const names = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
  return events.filter((e) => e.name === 'UpdateLayoutTree' && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain')
    .reduce((s, e) => s + ((e.args && e.args.elementCount) || 0), 0);
}

/* The counters, in the page: renders, layout reads, nodes and attribute writes between `start()` and `stop()` */
const INSTRUMENT = `(()=>{ if(window.__ops)return; const O=window.__ops={on:false,reads:0,renders:0,attrs:0,nodes:0,seen:{}};const CUE=/^ro-(call|bub|bang|dots|cnt)\\b/;
  const bump=()=>{if(O.on)O.reads++;};
  for(const prop of ['offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight','clientTop','clientLeft','scrollHeight','scrollWidth','scrollTop','scrollLeft'])
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.get)Object.defineProperty(proto,prop,{...d,get(){bump();return d.get.call(this);}});}
  for(const m of ['getBoundingClientRect','getClientRects']){const f=Element.prototype[m];Element.prototype[m]=function(){bump();return f.apply(this,arguments);};}
  const R=window.DurbarRealOffice,r=R.render;R.render=function(){if(O.on)O.renders++;return r.apply(this,arguments);};
  const take=(l)=>{if(!O.on)return;for(const m of l){if(m.type==='attributes'){O.attrs++;const k=(m.target.className&&String(m.target.className).split(' ')[0]||m.target.tagName)+'.'+m.attributeName;O.seen[k]=(O.seen[k]||0)+1;}else for(const n of [...m.addedNodes,...m.removedNodes])if(!(n.classList&&CUE.test(n.className)))O.nodes++;}};
  const mo=new MutationObserver(take);mo.observe(document.getElementById('stage'),{subtree:true,childList:true,attributes:true});
  O.start=()=>{O.reads=O.renders=O.attrs=O.nodes=0;O.seen={};O.on=true;};
  O.stop=()=>{take(mo.takeRecords());O.on=false;return {reads:O.reads,renders:O.renders,attrs:O.attrs,nodes:O.nodes,seen:O.seen};};
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
  const rows = {};
  const load = (n, extra = {}) => H.load({ w: 1440, h: 900, index, query: { sim: String(n), officeview: 'real', ...extra }, ready: REAL, readyMs: 30000, settle: false });
  const frames = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const c=new MessageChannel();c.port1.onmessage=()=>r(1);c.port2.postMessage(0);})))`);

  // ---- FR-183 at big screens ----
  await load(3);
  await H.until(REAL, 15000);
  const big = await js(AREA);
  rows['pictureArea@3'] = big.ratio;
  console.log('[ops] 3 agents, pictures:', JSON.stringify(big));
  assert.deepStrictEqual(big.under, [], 'big screens: no picture is shown larger than it is');

  for (const n of [15, 40]) {
    await load(n);
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
    rows[`blendElements@${n}`] = a.blend;
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
    let seen = {};
    for (let i = 0; i < 8; i++) {
      const st = i % 2 ? 'working' : 'idle';
      await js(`window.__ops.start()`);
      await emit(st);
      const ok = await H.until(shows(st), 8000);
      assert.ok(ok, `the plate shows ${st}`);
      await frames();
      const o = await js(`window.__ops.stop()`);
      for (const k of Object.keys(per)) per[k].push(o[k]);
      seen = o.seen;
    }
    rows[`rendersPerStatus@${n}`] = med(per.renders);
    rows[`readsPerStatus@${n}`] = med(per.reads);
    rows[`nodesPerStatus@${n}`] = med(per.nodes);
    rows[`attrWritesPerStatus@${n}`] = med(per.attrs);
    console.log('[ops]', n, 'agents, per status update (8):', JSON.stringify(per), 'last writes:', JSON.stringify(seen));
    // ---- FR-185: one text change, in the normal shape of a render ----
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(s);})()`);
    const change = (i) => js(`(()=>{document.querySelector('#stage .ro-plate .ro-l2').textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
    await change(0);
    await frames();
    const counts = [];
    for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
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
      else failed.push(`${key} = ${value}, limit ${known ? known.max : LIMITS[row]}`);
    } else if (known) failed.push(`${key} = ${value} is within its limit: delete its KNOWN_FAILURES entry (${known.task})`);
  }
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
};
