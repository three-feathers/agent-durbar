/*
 * Spec 097 FR-184..FR-186 (T142, T148, T156, T158, T159; flat rows): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15
 * DURBAR_SIM_FREEZE=1), no AI credits, no timing assert: every wait is an until(), every row a count, judged by `office-ops-rules.js` (its unit test shows the
 * judge can fail). At 15 and 40 agents, desks as scenes:
 *   - at start: renders, layout searches and probes (a probe is one trial office laid out into the hidden #probe, a forced layout) the page made by the time the office is drawn;
 *   - animations: the infinite ones running, how many animate a property other than transform and opacity (FR-180), and the positions a compact desk's tapping hand shows;
 *   - elements recalculated by one replaced text node (the `elementCount` of every UpdateLayoutTree on the main thread in a short contentTracing, animations
 *     off; a calibration (a new element in a desk) must show at least one event, so a renamed thread or category cannot read as 0 and pass; the text change itself may recalculate 0);
 *   - one status event of one agent, 8 times, each a real change (every sample must draw, none may search; renders, style reads of the floor and layout reads are the median): renders and searches are the app's own counters (`__durbarSimUi.ops()`), reads are offset*, client*, scroll*, getBoundingClientRect and
 *     getClientRects calls. The first proxy for renders, `getComputedStyle(#floor)`, was read twice per render and showed two where there was one;
 *   - one live paint (a thinking delta rewrites one desk's live line, no render; review of #1138), 8 times: the layout reads, the pencils' frame included (median of the samples without a render);
 *   - the arcade (spec 102 T262): over 8 status events on one desk, no element is added or removed anywhere under the office;
 *   - Real office (spec 097 FR-244, T190): over 8 status events that tint and clear one desk's screen (FR-236), no screen or New reply tag is added or removed;
 *   - after each of those status updates no `data-placed` mark sits on anything but a role or a pencil (a finished turn marks the desk unread and shifts keyless spans);
 *   - at 15 agents, 1280x800: after each status pill's filter and its clearing, after an agent starts or stops matching a status filter (a neighbour room's width changes while its HTML does not; its header is made tight by a spacer) and after a body class changes with no room changing (the fit key), the header and usage-line fit classes equal what a
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
function elementsRecalculated(events, eventName = 'UpdateLayoutTree') {
  const names = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
  return events.filter((e) => e.name === eventName && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain')
    .reduce((s, e) => s + ((e.args && e.args.elementCount) || 0), 0);
}

/* #1208: a trace is only a sample of the page if the renderer was recording when the page code ran. `startRecording` resolves when the browser has begun, and a renderer under a
   CPU load can start recording after the code it was meant to cover (the whole trace then holds no UpdateLayoutTree, and the calibration below took that for a renamed event).
   The page puts its own marker (`console.timeStamp`, a `TimeStamp` event of `devtools.timeline`) just before the code; a trace without the marker proves nothing and is taken
   again (at most TRACE_TRIES, each counted and printed). A trace that has the marker and no UpdateLayoutTree still fails the calibration: a renamed thread or event is not waited out.
   OPS_TRACE_MUTANT=name looks for an event with another name (the calibration must fail: "a new element must recalculate some element"); =nomark never emits the marker
   (must fail: "a trace holding the page's own marker"). */
const TRACE_TRIES = 10;
const MARK = 'ops-trace-start';
const TRACE_MUTANT = process.env.OPS_TRACE_MUTANT || '';
const markerIn = (events) => events.some((e) => e.name === 'TimeStamp' && e.args && e.args.data && e.args.data.message === MARK);
async function tracedWithMarker(code) {
  for (let attempt = 1; attempt <= TRACE_TRIES; attempt++) {
    const events = await trace(() => code(TRACE_MUTANT !== 'nomark'));
    if (markerIn(events)) return { events, attempt };
  }
  return { events: null, attempt: TRACE_TRIES };
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
  /* motion allowed: the Windows runner reports prefers-reduced-motion: reduce by itself, which sets every animation to none (styles.css) so no desk animates and the tapping hand below
     is missing there (CI run 41721270320: 0 infinite animations); emulated before each load, as check-unread does (agent-notes: reduced motion takes other code paths) */
  {
    const dbg = ctx.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  }
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
    /* one text change in `text` (a text node replaced: a child-list change, which is what a render does and what `:has()` watches), then a layout read so that the style is recalculated inside the trace */
    const measure = async (host, text, key, label) => {
      const change = (i) => js(`(()=>{document.querySelector(${jsLiteral(text)}).textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
      await change(0);
      await H.settle();
      /* calibration (pre-review of #949): a new element always has its style computed, so a trace with no UpdateLayoutTree event at all means the thread or event name changed. A text change itself may recalculate 0 elements when no stylesheet rule watches it (the AI maker's \`body:has()\` rule used to), and that is a pass */
      const sample = await tracedWithMarker((mark) => js(`(()=>{if(${jsLiteral(mark)})console.timeStamp(${jsLiteral(MARK)});const d=document.querySelector(${jsLiteral(host)});const s=document.createElement('i');s.className='ops-probe';d.appendChild(s);const h=document.body.offsetHeight;s.remove();return h;})()`));
      console.log(`[ops] ${label}: calibration trace recorded the page's marker on attempt ${sample.attempt}`);
      assert.ok(sample.events, `${label}: a trace holding the page's own marker: none of ${TRACE_TRIES} traces did, so the renderer was not recording while the page code ran`);
      const probe = elementsRecalculated(sample.events, TRACE_MUTANT === 'name' ? 'UpdateLayoutTreeX' : 'UpdateLayoutTree');
      assert.ok(probe > 0, `${label}: a new element must recalculate some element; a trace with none means the trace's thread or event name changed (${probe})`);
      const counts = [];
      for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
      rows[key] = Math.min(...counts); // the least of 4: a render that lands inside one trace by itself (a timer) only adds, and the `:has()` cost shows in all 4
      console.log(`[ops] ${label}: elements recalculated by one text change`, counts.join(' '));
    };
    await measure('#stage .desk[data-id]', '#stage .desk[data-id] .name', `elementsRecalculated@${n}`, `${n} agents`);

    /* one status event of one agent, each a real change; every sample must be one render, no search, one style read of the floor */
    await js(INSTRUMENT);
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
    const id = ids[3];
    const emit = (st) => `window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`;
    await drawn(emit('working')); // so that every change below is a real change of one agent's status
    const per = { renders: [], searches: [], reads: [], gcsFloor: [] }, leaks = [], due = [];
    for (let i = 0; i < 8; i++) {
      /* a settled window (#1195, 3 renders once in 8 on Linux CI, 3 of 10 runs under a CPU load): the previous update's visit (a desk walking to a place starts, or ends, on the
         250 ms visit tick, which renders) lands inside this window on a slow machine. Start only when no visit waits to start or end and no render is queued (the lobby's own
         settled signals, as check-office-ops-real does); the visit this update starts is the one timer's render the limit below allows */
      assert.ok(await until(`window.__durbarSimUi.visitsSettled()&&window.__durbarSimUi.settleNow()`, 15000), `${n} agents: the office settled before update ${i}`);
      await js(TWO_FRAMES);
      await js(`window.__ops.start()`);
      await drawn(emit(i % 2 ? 'working' : 'idle'));
      const o = await js(`window.__ops.stop()`);
      for (const k of Object.keys(per)) per[k].push(o[k]);
      due.push(await js(`window.__durbarSimUi.timerDraw()`));
      /* a finished turn marks the desk unread (a "New" label before the name), which shifts the keyless spans a morph matches by position */
      leaks.push(await js(`document.querySelectorAll('#stage [data-placed]:not(.role):not(.ren)').length`));
    }
    rows[`leakedPlaced@${n}`] = Math.max(...leaks);
    console.log('[ops]', n, 'agents, per status update (8): renders', per.renders.join(','), 'searches', per.searches.join(','), 'reads', per.reads.join(','), 'floor style reads', per.gcsFloor.join(','));
    /* every update drew (a missed render would show 0), and at most one render of something else (the coffee break's own timer, \`coffeeTick\`, can fall in the window and
       add one: traced, it is the only other caller); the row is the median, so a second render caused by the update itself would show */
    /* #1302: the second and third render of a sample were the mood tick (5 s) and the "ago" tick (30 s) drawing, after an update, what the update's own draw had shown: a tick that
       compared with the signature of its last tick, not of the last draw (traced under load: renderAll < setState, then the ticks at app.js 295 and 298, and coffeeTick's minute).
       A draw now records what it showed, so after an update's draw no tick is due: asserted on every sample, not by hoping no tick lands inside one */
    assert.deepStrictEqual(due, due.map(() => false), `${n} agents: after a status update's draw no mood or "ago" tick is due to draw it again (${due})`);
    assert.ok(per.renders.every((r) => r >= 1 && r <= 2), `${n} agents: every status update is one render, two at most with a timer's (${per.renders})`);
    rows[`rendersPerStatus@${n}`] = med(per.renders);
    rows[`searchesPerStatus@${n}`] = Math.max(...per.searches);
    rows[`floorStyleReadsPerStatus@${n}`] = med(per.gcsFloor);
    rows[`readsPerStatus@${n}`] = med(per.reads);

    /* one live paint (spec 001 FR-028, review of #1138): a thinking delta rewrites one desk's live line without a render. Its layout reads, through the
       pencils' frame (two frames waited), must not grow with the pencils of the room: the line's height is read, the names only when it changed */
    const lid = await js(`(()=>{const e=document.querySelector('#stage .desk[data-id] [data-live]');return e&&e.dataset.live;})()`);
    assert.ok(lid, `${n} agents: a desk has a live line`);
    const liveLine = `document.querySelector('#stage [data-live=${jsLiteral(lid)}]')`;
    await drawn(emit('working').split(id).join(lid)); // working, so that the deltas below change no status
    const live = { reads: [], renders: [] };
    for (let i = 0; i < 8; i++) {
      const word = `Ops step ${i} checked`;
      await js(`window.__ops.start()`);
      await js(`window.__durbarSimEmit({type:'thinking',sessionId:${jsLiteral(lid)},reasoningId:'ops-r',timestamp:Date.now(),delta:${jsLiteral(word + '. ')}})`);
      assert.ok(await until(`(${liveLine}||{}).textContent&&${liveLine}.textContent.includes(${jsLiteral(word)})`, 5000), `${n} agents: live paint ${i} shows`);
      await js(TWO_FRAMES);
      const o = await js(`window.__ops.stop()`);
      live.reads.push(o.reads); live.renders.push(o.renders);
    }
    console.log('[ops]', n, 'agents, per live paint (8): reads', live.reads.join(','), 'renders', live.renders.join(','));
    const quiet = live.reads.filter((_, i) => live.renders[i] === 0); // a sample with a render in it (a timer's) measures the render
    assert.ok(quiet.length >= 4, `${n} agents: at least 4 live paints without a render (${live.renders})`);
    rows[`readsPerLivePaint@${n}`] = med(quiet);

    if (n === 15) {
      /* stale fits (T156): what an incremental fit leaves must equal a full fit, after a status filter and its clearing, at 1280x800 */
      const stale = [];
      await load(1280, 800);
      await js(INSTRUMENT);
      const compare = async (what) => {
        const after = await js(FIT_STATE);
        await js(`window.DurbarFit()`);
        const full = await js(FIT_STATE);
        if (after !== full) stale.push(what);
      };
      const pill = (k) => `document.querySelector('#stats .stat[data-k=${jsLiteral(k)}]').click()`;
      const pills = await js(`[...document.querySelectorAll('#stats .stat[data-k]')].map(b=>b.dataset.k)`);
      for (const k of pills) { // every status pill leaves some rooms some desks and others all of theirs
        await drawn(pill(k)); await compare(`status filter ${k} on`);
        await drawn(pill(k)); await compare(`status filter ${k} cleared`);
      }

      /* A neighbour's width (the widthMoved guard): rooms share a line by --w. A status filter is on, so the rooms draw only the matching desks while the layout key (sized on every
         agent) does not change: when an agent starts to match, its room gains a desk and a wider --w, the layout is reused, and a neighbour whose HTML does not change gets narrower.
         No real header is near its limit at this size, so make one so: measure each room's header (its width and the width its parts use) before and after, pick a room the render
         does not rewrite (a mark on it survives) whose header is narrower, and add a spacer that leaves the header just whole when wide and over its width when narrow. */
      const NAMES = `(()=>{const o={};for(const r of document.querySelectorAll('#stage .room')){const hd=r.querySelector('.room-head');if(!hd)continue;const cs=getComputedStyle(hd);const kids=[...hd.children].filter(c=>c.getClientRects().length);const used=kids.reduce((x,c)=>x+c.getBoundingClientRect().width,0)+(parseFloat(cs.columnGap)||0)*Math.max(0,kids.length-1)+parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);o[r.dataset.key]={w:hd.getBoundingClientRect().width,used,kept:r.hasAttribute('data-ops-mark')};}return o;})()`;
      const MARK = `document.querySelectorAll('#stage .room').forEach(r=>r.setAttribute('data-ops-mark',''))`; // a room the render rewrites loses the mark
      const UNMARK = `document.querySelectorAll('[data-ops-mark]').forEach(r=>r.removeAttribute('data-ops-mark'))`;
      const status = (id, st) => `window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`;
      // every agent in error (an error keeps the desk, nothing rests in a lounge) but the first of each room (working); the filter 'working' hides the rest
      const mains = await js(`(()=>{const o=[];for(const r of document.querySelectorAll('#stage .room')){let i=0;for(const d of r.querySelectorAll('.desk[data-id]'))o.push([d.dataset.id,i++===0]);}return o;})()`);
      await js(mains.map(([id, first]) => status(id, first ? 'working' : 'error')).join(';'));
      await H.settle();
      await drawn(pill('working'));
      let pick = null;
      for (const [id, first] of mains) { // one hidden agent starts working
        if (first) continue;
        await js(MARK);
        const wide = await js(NAMES);
        const s0 = (await js(`window.__durbarSimUi.ops()`)).searches;
        await drawn(status(id, 'working'));
        const narrow = await js(NAMES);
        const searched = (await js(`window.__durbarSimUi.ops()`)).searches > s0; // a new search fits everything: not the case under test
        await js(UNMARK);
        await drawn(status(id, 'error'));
        const spare = (r) => wide[r].w - wide[r].used, shrink = (r) => wide[r].w - narrow[r].w;
        const c = searched ? [] : Object.keys(wide).filter((r) => narrow[r] && narrow[r].kept && shrink(r) > 4 && spare(r) >= shrink(r) / 2).sort((x, y) => shrink(y) - shrink(x));
        if (c.length) { pick = { id, room: c[0], pad: spare(c[0]) - shrink(c[0]) / 2 }; break; }
      }
      assert.ok(pick, 'an agent that starts to match the status filter narrows a room that is not rewritten, and its header has room to spare when wide (the stale-fit case for a neighbour\'s width)');
      await js(`(()=>{const s=document.createElement('style');s.id='ops-width';s.textContent=${jsLiteral(`#stage .room[data-key="${pick.room}"] .room-head::after{content:"";flex:none;width:${pick.pad}px}`)};document.head.append(s);})()`);
      await js(`window.DurbarFit()`); // every header fitted, the filter on
      await drawn(status(pick.id, 'working')); await compare("a neighbour's width, an agent starts to match the status filter");
      await drawn(status(pick.id, 'error')); await compare("a neighbour's width, an agent stops matching the status filter");
      await js(`document.getElementById('ops-width').remove()`);
      await drawn(pill('working')); // the filter off
      await js(`window.DurbarFit()`); // so that the next case starts from fitted headers

      /* The fit key (what else decides a fit): the body's classes change with no change to any room's HTML. A class that squeezes every name stands for chat open, zoom...;
         the office is drawn again with the same rooms and the headers must be fitted to it. */
      await js(`(()=>{const s=document.createElement('style');s.id='ops-key';s.textContent='body.ops-squeeze #stage .room-name{padding-right:4000px!important}';document.head.append(s);})()`);
      await js(`window.DurbarFit()`);
      await drawn(`document.body.classList.add('ops-squeeze');window.__durbarSimUi.paint()`); await compare('a body class changes, no room does');
      await drawn(`document.body.classList.remove('ops-squeeze');window.__durbarSimUi.paint()`); await compare('the body class goes, no room changes');
      rows[`staleFits@${n}`] = stale.length;
      if (stale.length) console.log('[ops] stale fits after:', stale.join(', '));
    }

    /* spec 102 T212: a world's arrangement has the same row and no allowance of its own: the arcade, one text change on a marquee. */
    await H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n), officeview: 'real', worldflags: 'retro', world: 'retro' }, ready: `!!document.querySelector('#stage .ro .ro-marquee')`, readyMs: 30000 });
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(s);})();0`);
    await measure('#stage .ro-marquee', '#stage .ro-marquee', `elementsRecalculated@retro${n}`, `${n} agents, arcade`);
    /* spec 102 T262 (FR-229, SC-024): in the arcade a status update adds or removes no element under the office: 8 status events alternating idle and
       working on one desk (neither needs you, so the inbox count and its slip keep their words; an error would change them), every element added or
       removed anywhere under #stage .ro counted (subtree), so a world that rebuilds a desk or a slip on a status change fails (`OPS_INDEX` with a build that
       appends a node on each status update shows the row fails) */
    const aid = await js(`(()=>{const p=document.querySelector('#stage .ro-plate.st-working');return p?p.dataset.id:'';})()`);
    assert.ok(aid, `${n} agents, arcade: a working desk`);
    /* settle first: the desk's first change of state may send a visitor away or clear an away mark once; the row counts what repeats, from a settled office */
    for (const st of ['idle', 'working']) {
      await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(aid)},timestamp:Date.now(),status:${jsLiteral(st)}})`);
      assert.ok(await until(`(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(aid)})+'"]')||{classList:{contains:()=>false}}).classList.contains('st-working')===${jsLiteral(st === 'working')}`, 8000), `${n} agents, arcade: the desk settles (${st})`);
    }
    /* no screen repaint put off either (DurbarRealOffice.pending(), FR-033, as check-office-ops-real waits) */
    assert.ok(await until(`window.DurbarRealOffice.pending().screens===0&&window.__durbarSimUi.visitsSettled()&&window.__durbarSimUi.settleNow()`, 15000), `${n} agents, arcade: the office settled before the status updates`);
    await js(`(()=>{window.__aN=0;window.__aO=new MutationObserver(ms=>{for(const m of ms)for(const x of [...m.addedNodes,...m.removedNodes])if(x.nodeType===1)window.__aN++;});window.__aO.observe(document.querySelector('#stage .ro'),{childList:true,subtree:true});})()`);
    const aseen = [];
    for (let i = 0; i < 8; i++) {
      const st = i % 2 ? 'working' : 'idle';
      await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(aid)},timestamp:Date.now(),status:${jsLiteral(st)}})`);
      aseen.push(await until(`(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(aid)})+'"]')||{classList:{contains:()=>false}}).classList.contains('st-working')===${jsLiteral(st === 'working')}`, 8000));
      /* and its screen's throttled repaint (2 s, FR-033) has landed inside the window, whatever the load: a repaint that removes the caret (a node) then always counts */
      aseen.push(await until(`window.DurbarRealOffice.pending().screens===0`, 8000));
    }
    assert.ok(aseen.every(Boolean), `${n} agents, arcade: every status event reached the desk's plate and its screen repainted (${aseen})`);
    rows[`statusNodes@retro${n}`] = await js(`(window.__aO.disconnect(),window.__aN)`);
    console.log('[ops]', n, 'agents, arcade: elements added or removed under the office over 8 status updates', rows[`statusNodes@retro${n}`]);

    /* spec 097 FR-244 (T190): a status change that tints or clears a desk's screen (FR-236) adds or removes no screen or New reply tag: the tint is a
       class on the screen made once per desk. 8 status events alternating error (red) and working (the normal screen) on one desk. */
    await H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n), officeview: 'real' }, ready: `!!document.querySelector('#stage .ro .ro-screen')`, readyMs: 30000 });
    const tid = await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate[data-state="working"]')][0];return p?p.dataset.id:'';})()`);
    assert.ok(tid, `${n} agents: a working desk with the normal screen`);
    await js(`(()=>{window.__tN=0;const f=ms=>{for(const m of ms)for(const x of [...m.addedNodes,...m.removedNodes])if(x.nodeType===1&&x.matches('.ro-screen,.ro-newtag'))window.__tN++;};window.__tO=new MutationObserver(f);for(const l of document.querySelectorAll('#stage .ro-art,#stage .ro-chrome'))window.__tO.observe(l,{childList:true});})()`);
    const seen = [];
    for (let i = 0; i < 8; i++) {
      const st = i % 2 ? 'working' : 'error', red = !(i % 2);
      await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(tid)},timestamp:Date.now(),status:${jsLiteral(st)}})`);
      seen.push(await until(`(document.querySelector('#stage .ro-screen[data-for="'+CSS.escape(${jsLiteral(tid)})+'"]')||{classList:{contains:()=>false}}).classList.contains('tint-red')===${jsLiteral(red)}`, 8000));
    }
    assert.ok(seen.every(Boolean), `${n} agents: every status event tinted or cleared the screen (${seen})`);
    rows[`tintNodesPerStatus@${n}`] = await js(`(window.__tO.disconnect(),window.__tN)`);
    console.log('[ops]', n, 'agents, Real office: screen and tag nodes added or removed over 8 tint changes', rows[`tintNodesPerStatus@${n}`]);
  }
  const { failed, notes } = judge(rows);
  for (const l of notes) console.log('[ops]', l);
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
  process.exitCode = 0;
};
