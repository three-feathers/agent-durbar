/*
 * Spec 097 FR-184..FR-186 (T142, flat rows): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1),
 * no AI credits. At 15 and 40 agents one text change goes through the normal event path (`__durbarSimEmit`), the driver waits with until() for
 * the change to be drawn, and the counts of that change are asserted:
 *   - elements recalculated: the `elementCount` of every UpdateLayoutTree of one short contentTracing of the change, summed. A count, not a time:
 *     one broad `:has()` rule (FR-185) made one change restyle most of the page. Animations are switched off for the trace so that only the change counts.
 *   - T156, T159 (one status event of one agent through the normal path, the median of 8): renders of the office and layout searches (counters the app keeps for
 *     the simulator, `__durbarSimUi.ops()`; the first proxy for T159, `getComputedStyle(#floor)`, was read twice by one render and so showed two renders where there was
 *     one), and layout reads (offset*, client*, scroll* and getBoundingClientRect/getClientRects calls).
 *   - T158 (FR-180): the infinite animations running, and how many of them animate a property other than transform and opacity (those cost the main thread a restyle
 *     and a repaint on every tick), read from the page's own animations.
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
const LIMITS = { elementsRecalculated: 50, rendersPerStatus: 1, searchesPerStatus: 0, readsPerStatus: 110, animatedOtherProperties: 0, animationsRunning: 90, 'animationsRunning@40': 260, searchesAtStart: 2, probesAtStart: 90, rendersAtStart: 8 };
/* A row over its limit today is named here with its fix task and the most it may reach meanwhile; the task's PR deletes the entry. None now.
   Limits that are floors, not targets: readsPerStatus 110 (measured 98 at 15 agents, 86 at 40 with desks as scenes, from 650 and 998): what is left is what a status change
   needs: the changed room header's fit (about 20), the lobby figures' positions (27), the spare-height spread (13), the changed desk's pencil (11), the rest small.
   animationsRunning: measured 78 at 15 agents (halo 13, bar 32, tap 16, wave 4, dotp 4, steam 4, ...) and 250 at 40, limits 90 and 260, counted so that a new animation is noticed.
   searchesAtStart / probesAtStart: measured 2 / 30 at 15 agents and 1-2 / 47-85 at 40 (limit 90); the cost of a search is its probes (each a forced layout). */
const KNOWN_FAILURES = {}; // 'row@n': 'T-number of the task that fixes it'

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
    const load = () => H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n) }, ready: FLAT, readyMs: 30000 });
    await load();
    await js(`localStorage.setItem('durbar.doorsigns','off')`); // desks as scenes, not doors: every working desk animates (the doors and signs are going)
    await load();
    /* the start: what the page had done by the time the office was drawn and still (a layout search lays trial offices out into the hidden probe: its cost is the number of probes) */
    const start = await js(`window.__durbarSimUi.ops()`);
    rows[`searchesAtStart@${n}`] = start.searches; rows[`probesAtStart@${n}`] = start.probes; rows[`rendersAtStart@${n}`] = start.renders;
    console.log('[ops]', n, 'agents at start: renders', start.renders, 'layout searches', start.searches, 'probes', start.probes);
    /* FR-180: only `transform` and `opacity` animate. An animation of any other property (the halo's fill-opacity was one) is restyled and repainted on the main
       thread on every tick, instead of running on the compositor; counted from the page's own running animations, with their number */
    const anim = await js(`(()=>{const ok=new Set(['offset','easing','composite','computedOffset','transform','opacity']);let running=0,other=0;const names={};
      for(const a of document.getAnimations()){if(a.playState!=='running'||!a.effect||a.effect.getComputedTiming().iterations!==Infinity)continue;running++;
        const bad=new Set();for(const kf of a.effect.getKeyframes())for(const k of Object.keys(kf))if(!ok.has(k))bad.add(k);
        if(bad.size){other++;names[[...bad].join(',')]=(names[[...bad].join(',')]||0)+1;}}
      return {running,other,names};})()`);
    rows[`animatedOtherProperties@${n}`] = anim.other;
    rows[`animationsRunning@${n}`] = anim.running;
    console.log('[ops]', n, 'agents:', anim.running, 'infinite animations running,', anim.other, 'animate a property other than transform and opacity', JSON.stringify(anim.names));
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
    if (value > LIMITS[key] || LIMITS[row]) {
      if (known && value <= known.max) console.log(`[ops] ${key} = ${value} over ${LIMITS[key] || LIMITS[row]} (known failure, ${known.task}; may not pass ${known.max})`);
      else failed.push(`${key} = ${value}, limit ${known ? known.max : LIMITS[key] || LIMITS[row]}`);
    } else if (known) failed.push(`${key} = ${value} is within its limit: delete its KNOWN_FAILURES entry (${known.task})`);
  }
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
  process.exitCode = 0;
};
