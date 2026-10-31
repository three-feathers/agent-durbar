/*
 * Spec 097 FR-184..FR-186 (T142, T148, T156, T158, T159; flat rows): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15
 * DURBAR_SIM_FREEZE=1), no AI credits, no timing assert: every wait is an until(), every row a count, judged by `office-ops-rules.js` (its unit test shows the
 * judge can fail). At 15 and 40 agents, desks as scenes:
 *   - at start: renders, layout searches and probes (a probe is one trial office laid out into the hidden #probe, a forced layout) the page made by the time the office is drawn;
 *   - animations: the infinite ones running, how many animate a property other than transform and opacity (FR-180), and the positions a compact desk's tapping hand shows;
 *   - elements recalculated by one replaced text node (the `elementCount` of every UpdateLayoutTree on the main thread in a short contentTracing, animations
 *     off; a trace with none fails the row, so a renamed thread cannot read as 0);
 *   - one status event of one agent, 8 times, each a real change (every sample must draw, none may search; renders, style reads of the floor and layout reads are the median): renders and searches are the app's own counters (`__durbarSimUi.ops()`), reads are offset*, client*, scroll*, getBoundingClientRect and
 *     getClientRects calls. The first proxy for renders, `getComputedStyle(#floor)`, was read twice per render and showed two where there was one;
 *   - after each of those status updates no `data-placed` mark sits on anything but a role or a pencil (a finished turn marks the desk unread and shifts keyless spans);
 *   - at 15 agents, 1100x700 (headers are tight there): after each status pill's filter and its clearing, and after Simple to Expert and back, the header and usage-line fit classes equal what a
 *     full fit gives (stale fits).
 * A row over its limit today is a KNOWN_FAILURE with its open task and a ceiling.
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
const { judge } = require('./office-ops-rules');

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

/* The counters, in the page: layout reads and the floor's style reads between `start()` and `stop()`, renders and searches from the app's own counters */
const INSTRUMENT = `(()=>{ if(window.__ops)return; const O=window.__ops={on:false,reads:0,gcsFloor:0,base:null};
  const bump=()=>{if(O.on)O.reads++;};
  for(const prop of ['offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight','clientTop','clientLeft','scrollHeight','scrollWidth','scrollTop','scrollLeft'])
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.get)Object.defineProperty(proto,prop,{...d,get(){bump();return d.get.call(this);}});}
  for(const m of ['getBoundingClientRect','getClientRects']){const f=Element.prototype[m];Element.prototype[m]=function(){bump();return f.apply(this,arguments);};}
  const g=window.getComputedStyle;window.getComputedStyle=function(e){if(O.on&&e&&e.id==='floor')O.gcsFloor++;return g.apply(this,arguments);};
  O.start=()=>{O.reads=0;O.gcsFloor=0;O.base=window.__durbarSimUi.ops();O.on=true;};
  O.stop=()=>{O.on=false;const n=window.__durbarSimUi.ops();return {reads:O.reads,renders:n.renders-O.base.renders,searches:n.searches-O.base.searches,gcsFloor:O.gcsFloor};};
})()`;
const TWO_FRAMES = `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;
/* the header and usage-line fit classes: what a full fit (DurbarFit) would change is a stale fit */
const FIT_STATE = `[...document.querySelectorAll('#stage .room-head,#stage .desk .use')].map(e=>e.className).join('|')`;


module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const rows = {};
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  /* run `action` (page code) and wait until the office has drawn at least one more render, then two frames */
  const drawn = async (action, ms = 8000) => {
    const before = await js(`window.__durbarSimUi.ops().renders`);
    await js(action);
    assert.ok(await until(`window.__durbarSimUi.ops().renders>${before}`, ms), `the office drew after: ${action.slice(0, 80)}`);
    await js(TWO_FRAMES);
  };
  for (const n of [15, 40]) {
    const load = (w = 1440, h = 900) => H.load({ w, h, index: process.env.OPS_INDEX || undefined, query: { sim: String(n) }, ready: FLAT, readyMs: 30000 });
    await load();
    await js(`localStorage.setItem('durbar.doorsigns','off')`); // desks as scenes, not doors: every working desk animates (the doors and signs are going)
    await load();

    /* the start */
    const start = await js(`window.__durbarSimUi.ops()`);
    rows[`searchesAtStart@${n}`] = start.searches; rows[`probesAtStart@${n}`] = start.probes; rows[`rendersAtStart@${n}`] = start.renders;
    console.log('[ops]', n, 'agents at start: renders', start.renders, 'layout searches', start.searches, 'probes', start.probes);

    /* animations (FR-180): only transform and opacity animate */
    const anim = await js(`(()=>{const ok=new Set(['offset','easing','composite','computedOffset','transform','opacity']);let running=0,other=0;const names={};
      for(const a of document.getAnimations()){if(a.playState!=='running'||!a.effect||a.effect.getComputedTiming().iterations!==Infinity)continue;running++;
        const bad=new Set();for(const kf of a.effect.getKeyframes())for(const k of Object.keys(kf))if(!ok.has(k))bad.add(k);
        if(bad.size){other++;names[[...bad].join(',')]=(names[[...bad].join(',')]||0)+1;}}
      return {running,other,names};})()`);
    rows[`animatedOtherProperties@${n}`] = anim.other;
    rows[`animationsRunning@${n}`] = anim.running;
    console.log('[ops]', n, 'agents:', anim.running, 'infinite animations running,', anim.other, 'animate a property other than transform and opacity', JSON.stringify(anim.names));
    /* a tapping hand of a compact desk: the positions it shows, sampled by setting the animation's time (two cycles, forward and back), so no clock is involved */
    const hand = await js(`(()=>{for(const h of document.querySelectorAll('#stage svg.sc-c .hand-l')){const a=h.getAnimations()[0];if(!a)continue;
      const d=a.effect.getComputedTiming().duration;a.pause();const seen=new Set();
      for(const t of [0.05,0.3,0.55,0.8,0.95,1.05,1.3,1.55,1.8,1.95]){a.currentTime=t*d;seen.add(getComputedStyle(h).transform);}
      a.play();return {positions:seen.size,dur:d};}return null;})()`);
    assert.ok(hand, `${n} agents: a compact desk has a tapping hand`);
    rows[`handPositions@${n}`] = hand.positions;
    console.log('[ops]', n, 'agents: a compact desk hand shows', hand.positions, 'positions over two cycles');

    /* one replaced text node, animations off so that only the change counts */
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(s);})()`);
    const change = (i) => js(`(()=>{document.querySelector('#stage .desk[data-id] .name').textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
    await change(0);
    await H.settle();
    const counts = [];
    for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
    assert.ok(counts.every((c) => c > 0), `${n} agents: a replaced text node must recalculate some element; a trace with none means the trace's thread or event name changed (${counts})`);
    rows[`elementsRecalculated@${n}`] = Math.min(...counts); // the least of 4: a render that lands inside one trace by itself (a timer) only adds, and the `:has()` cost shows in all 4
    console.log('[ops]', n, 'agents: elements recalculated by one text change', counts.join(' '));

    /* one status event of one agent, each a real change; every sample must be one render, no search, one style read of the floor */
    await js(INSTRUMENT);
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
    const id = ids[3];
    const emit = (st) => `window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`;
    await drawn(emit('working')); // so that every change below is a real change of one agent's status
    const per = { renders: [], searches: [], reads: [], gcsFloor: [] }, leaks = [];
    for (let i = 0; i < 8; i++) {
      await js(`window.__ops.start()`);
      await drawn(emit(i % 2 ? 'working' : 'idle'));
      const o = await js(`window.__ops.stop()`);
      for (const k of Object.keys(per)) per[k].push(o[k]);
      /* a finished turn marks the desk unread (a "New" label before the name), which shifts the keyless spans a morph matches by position */
      leaks.push(await js(`document.querySelectorAll('#stage [data-placed]:not(.role):not(.ren)').length`));
    }
    rows[`leakedPlaced@${n}`] = Math.max(...leaks);
    console.log('[ops]', n, 'agents, per status update (8): renders', per.renders.join(','), 'searches', per.searches.join(','), 'reads', per.reads.join(','), 'floor style reads', per.gcsFloor.join(','));
    /* every update drew (a missed render would show 0), and at most one render of something else (the coffee break's own timer, \`coffeeTick\`, can fall in the window and
       add one: traced, it is the only other caller); the row is the median, so a second render caused by the update itself would show */
    assert.ok(per.renders.every((r) => r >= 1 && r <= 2), `${n} agents: every status update is one render, two at most with a timer's (${per.renders})`);
    rows[`rendersPerStatus@${n}`] = med(per.renders);
    rows[`searchesPerStatus@${n}`] = Math.max(...per.searches);
    rows[`floorStyleReadsPerStatus@${n}`] = med(per.gcsFloor);
    rows[`readsPerStatus@${n}`] = med(per.reads);

    if (n === 15) {
      /* stale fits (T156): what an incremental fit leaves must equal a full fit, after a status filter and its clearing, and across Simple and Expert, at 1280x800 */
      await load(1100, 700);
      await js(INSTRUMENT);
      const stale = [];
      const compare = async (what) => {
        const after = await js(FIT_STATE);
        await js(`window.DurbarFit()`);
        const full = await js(FIT_STATE);
        if (after !== full) stale.push(what);
      };
      const pills = await js(`[...document.querySelectorAll('#stats .stat[data-k]')].map(b=>b.dataset.k)`);
      for (const k of pills) { // every status pill leaves some rooms some desks and others all of theirs
        await drawn(`document.querySelector('#stats .stat[data-k=${jsLiteral(k)}]').click()`); await compare(`status filter ${k} on`);
        await drawn(`document.querySelector('#stats .stat[data-k=${jsLiteral(k)}]').click()`); await compare(`status filter ${k} cleared`);
      }
      await drawn(`window.__durbarSimUi.setDetail('simple')`); await compare('Expert to Simple');
      await drawn(`window.__durbarSimUi.setDetail('expert')`); await compare('Simple to Expert');
      rows[`staleFits@${n}`] = stale.length;
      if (stale.length) console.log('[ops] stale fits after:', stale.join(', '));
    }
  }
  const { failed, notes } = judge(rows);
  for (const l of notes) console.log('[ops]', l);
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
  process.exitCode = 0;
};
