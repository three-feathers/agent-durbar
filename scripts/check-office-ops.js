/*
 * Spec 097 FR-184..FR-186 (T142, flat rows): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1),
 * no AI credits. At 15 and 40 agents one text change goes through the normal event path (`__durbarSimEmit`), the driver waits with until() for
 * the change to be drawn, and the counts of that change are asserted:
 *   - elements recalculated: the `elementCount` of every UpdateLayoutTree of one short contentTracing of the change, summed. A count, not a time:
 *     one broad `:has()` rule (FR-185) made one change restyle most of the page. Animations are switched off for the trace so that only the change counts.
 *   - T156, T159 (one status event of one agent through the normal path, the median of 8): renders of the office and layout searches (counters the app keeps for
 *     the simulator, `__durbarSimUi.ops()`; the first proxy for T159, `getComputedStyle(#floor)`, was read twice by one render and so showed two renders where there was
 *     one), and layout reads (offset*, client*, scroll* and getBoundingClientRect/getClientRects calls).
 *   - T158: the changes a second of the SVG animations of the compact scenes (they run on the main thread): steps x keyframe intervals / duration, per animation and per
 *     scene, read from the page's own running animations; an animation that is not stepped counts as unbounded.
 * A row that fails today is named in KNOWN_FAILURES with its fix task and the most it may reach meanwhile; the task's PR deletes the entry.
 *
 *   npm run check:ui -- --only check-office-ops      (builds first)
 *   OPS_INDEX=<index.html>   load another build of the page (a mutation or a before/after run)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { contentTracing } = require('electron');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

/* Limits are counts. FR-185 / T148: one text change recalculates at most this many elements (measured after the fix: see the spec). */
const LIMITS = { elementsRecalculated: 50, rendersPerStatus: 1, searchesPerStatus: 0, readsPerStatus: 40, animationRateMax: 2.5, animationRatePerScene: 12 };
/* A row over its limit today, with the fix task and the most it may reach meanwhile (a regression guard). T156: the pencils, headers and usage lines of the room a
   status change rewrote are still fitted (about 190 reads at 15 agents, 160 at 40, from 650 and 1000), and the walkers' positions are read once more. */
const KNOWN_FAILURES = { 'readsPerStatus@15': { task: 'T156', max: 250 }, 'readsPerStatus@40': { task: 'T156', max: 250 } }; // 'row@n': 'T-number of the task that fixes it'

const FLAT = `document.querySelectorAll('#stage .desk[data-id]').length>=1&&!document.querySelector('#stage .ro')`;

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


/* The counters, in the page: renders, searches and layout reads between `start()` and `stop()` */
const INSTRUMENT = `(()=>{ if(window.__ops)return; const O=window.__ops={on:false,reads:0,renders:0,searches:0,gcsFloor:0};
  const bump=()=>{if(O.on)O.reads++;};
  for(const prop of ['offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight','clientTop','clientLeft','scrollHeight','scrollWidth','scrollTop','scrollLeft'])
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.get)Object.defineProperty(proto,prop,{...d,get(){bump();return d.get.call(this);}});}
  for(const m of ['getBoundingClientRect','getClientRects']){const f=Element.prototype[m];Element.prototype[m]=function(){bump();return f.apply(this,arguments);};}
  const g=window.getComputedStyle;window.getComputedStyle=function(e){if(O.on&&e&&e.id==='floor')O.gcsFloor++;return g.apply(this,arguments);};
  O.base=null;O.start=()=>{O.reads=0;O.gcsFloor=0;O.base=window.__durbarSimUi.ops();O.on=true;};
  O.stop=()=>{O.on=false;const n=window.__durbarSimUi.ops();return {reads:O.reads,renders:n.renders-O.base.renders,searches:n.searches-O.base.searches,gcsFloor:O.gcsFloor};};
})()`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const rows = {};
  for (const n of [15, 40]) {
    await H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n) }, ready: FLAT, readyMs: 30000 });
    /* the SVG animations of the compact scenes run on the main thread: changes a second = steps x keyframe intervals / duration, counted from the page's own animations */
    const anim = await js(`(()=>{const out=[];for(const svg of document.querySelectorAll('#stage svg.sc-c')){let sum=0,max=0,n=0;
      for(const a of svg.getAnimations({subtree:true})){const e=a.effect;if(!e||a.playState!=='running'||e.getComputedTiming().iterations!==Infinity)continue; /* the ambulance light's six blinks end by themselves */const kf=e.getKeyframes(),d=e.getComputedTiming().duration;
        const m=/^steps\\((\\d+)/.exec((kf[0]&&kf[0].easing)||'');const r=m&&d>0?Number(m[1])*(kf.length-1)/(d/1000):Infinity;sum+=r;max=Math.max(max,r);n++;}
      out.push({n,sum,max});}return out;})()`);
    rows[`animationRateMax@${n}`] = Math.round(Math.max(...anim.map((x) => x.max)) * 100) / 100;
    rows[`animationRatePerScene@${n}`] = Math.round(Math.max(...anim.map((x) => x.sum)) * 100) / 100;
    console.log(`[ops] ${n} agents: ${anim.filter((x) => x.n).length} compact scenes animate; most changes a second for one animation ${rows[`animationRateMax@${n}`]}, for one scene ${rows[`animationRatePerScene@${n}`]}`);
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(s);})()`);
    /* one text change in one desk (a name's text node replaced: a child-list change, which is what a render does and what `:has()` watches), then a layout read so that the style is recalculated inside the trace */
    const change = (i) => js(`(()=>{document.querySelector('#stage .desk[data-id] .name').textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
    await change(0);
    await H.settle();
    const counts = [];
    for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
    rows[`elementsRecalculated@${n}`] = Math.max(...counts);
    /* status events through the normal path, one at a time; each waits until the page has drawn it (two frames) before the next */
    await js(INSTRUMENT);
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
    const per = { renders: [], searches: [], reads: [], gcsFloor: [] };
    const id = ids[3];
    const emit = (st) => js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`);
    await emit('working'); // so that every change below is a real change of one agent's status
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,100))))`);
    for (let i = 0; i < 8; i++) {
      const st = i % 2 ? 'working' : 'idle';
      await js(`window.__ops.start()`);
      await emit(st);
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,100))))`);
      const o = await js(`window.__ops.stop()`);
      for (const k of Object.keys(per)) per[k].push(o[k]);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    rows[`rendersPerStatus@${n}`] = med(per.renders);
    rows[`searchesPerStatus@${n}`] = med(per.searches);
    rows[`readsPerStatus@${n}`] = med(per.reads);
    console.log('[ops]', n, 'agents, per status update (8, median): renders', per.renders.join(','), 'searches', per.searches.join(','), 'reads', per.reads.join(','), 'getComputedStyle(#floor)', per.gcsFloor.join(','));
    console.log(`[ops] ${n} agents: elements recalculated by one text change`, counts.join(' '));
  }
  const failed = [];
  for (const [key, value] of Object.entries(rows)) {
    const [row, n] = key.split('@');
    const known = KNOWN_FAILURES[key];
    if (value > LIMITS[row]) {
      if (known && value <= known.max) console.log(`[ops] ${key} = ${value} over ${LIMITS[row]} (known failure, ${known.task}; may not pass ${known.max})`);
      else failed.push(`${key} = ${value}, limit ${known ? known.max : LIMITS[row]}`);
    } else if (known) failed.push(`${key} = ${value} is within its limit: delete its KNOWN_FAILURES entry (${known.task})`);
  }
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
  process.exitCode = 0;
};
