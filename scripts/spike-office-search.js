/*
 * Spec 001 T167 (spike, protocol in spec 001 "2026-11-13 delta: the search-time spike"): how long the flat office's layout search takes, and how many searches and probes
 * the start and a status update make. TEST-ONLY: the instrument below is installed in the page by the debugger (Page.addScriptToEvaluateOnNewDocument) of this
 * driver's own window, before the page's scripts run; nothing in src/ knows it, the shipped app has no hook for it. Simulator only (DURBAR_SIM), 0 AI credits.
 *
 * What it records (one Electron launch is one run of one cell; `SPIKE_N` agents, `SPIKE_W` x `SPIKE_H` window, one JSON line `[spike] {...}`):
 *   - per layout search (chooseLayout): wall ms from the search's entry (it sets the width of #probe) to the last access of #probe or of anything inside it (a trial's
 *     HTML written, a style set in place, a size read: reads force the layout, so a trial's layout is in it), the trials (writes) and size reads it made;
 *   - the app's own counters (`__durbarSimUi.ops()`): renders, searches, probes at the end of the start and over each of 8 status updates;
 *   - page time (ms since the navigation began) of the first desk in #stage and of the first frame after it, and the time of every later change to #stage.
 * It does not record: process start (the window is loaded again at the cell's size, so the first page of the process is not the measured one; `check-perf --record`
 * measures that, 1440x900 only), parts x trials by key, or the layout reads by site. No assert on a time. The only asserts are that the timer works: every search the app
 * counted was timed, each took time, and the first frame was seen (`SPIKE_MUTANT=notimer` removes the timer and must fail the first of them by its label).
 *
 * Run (one cell, one run; the wrapper in the PR description):
 *   SPIKE_N=40 SPIKE_W=1280 SPIKE_H=800 node -e "require('./scripts/ui-suite.js').runOne({name:'spike-office-search',env:{DURBAR_SIM:'40'}},require('os').tmpdir()).then(r=>{console.log(r.log);process.exit(r.ok?0:1)})"
 */
const assert = require('assert');
const os = require('os');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const N = Number(process.env.SPIKE_N || 15);
const W = Number(process.env.SPIKE_W || 1440);
const HGT = Number(process.env.SPIKE_H || 900);
const MUTANT = process.env.SPIKE_MUTANT || '';
const FLAT = `document.querySelectorAll('#stage .desk[data-id]').length>=1&&!document.querySelector('#stage .ro')`;

/* the timer: a search starts when the page sets the width of #probe (chooseLayout does that first, and nothing else sets it) and lasts to the last access of #probe or of a node in it */
const TIMER = `(()=>{ const S=window.__spike;
  let cur=null,P=null; const probe=()=>P||(P=document.getElementById('probe'));
  const touch=()=>{if(cur)cur.last=performance.now();};
  const inProbe=(e)=>{const p=probe();return !!p&&(e===p||p.contains(e));};
  const wd=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'width');
  Object.defineProperty(CSSStyleDeclaration.prototype,'width',{...wd,set(v){const p=probe();if(p&&p.style===this){const t=performance.now();cur={t0:t,last:t,writes:0,reads:0};S.searches.push(cur);}return wd.set.call(this,v);}});
  const ih=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  Object.defineProperty(Element.prototype,'innerHTML',{...ih,set(v){const r=ih.set.call(this,v);if(cur&&this===probe()){cur.writes++;touch();}return r;}});
  const sa=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(n,v){const r=sa.apply(this,arguments);if(cur&&n==='style'&&inProbe(this)){cur.writes++;touch();}return r;};
  for(const prop of ['scrollHeight','scrollWidth','offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight'])
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.get)Object.defineProperty(proto,prop,{...d,get(){const r=d.get.call(this);if(cur&&inProbe(this)){cur.reads++;touch();}return r;}});}
  for(const m of ['getBoundingClientRect','getClientRects']){const f=Element.prototype[m];Element.prototype[m]=function(){const r=f.apply(this,arguments);if(cur&&inProbe(this)){cur.reads++;touch();}return r;};}
})()`;
/* the first frame: page time of the first desk in #stage, then of the frame after it (a rAF, then a message, as check-perf --record), and of every later change to #stage */
const INSTRUMENT_BASE = `(()=>{ if(window.__spike)return; const S=window.__spike={searches:[],stage:[],firstDesk:null,firstPaint:null};
  const mo=new MutationObserver((ms)=>{
    if(!ms.some(m=>m.target.nodeType===1&&m.target.closest&&m.target.closest('#stage')))return;
    const t=performance.now();S.stage.push(Math.round(t*10)/10);
    if(S.firstDesk===null&&document.querySelector('#stage .desk[data-id]')){S.firstDesk=t;requestAnimationFrame(()=>{const c=new MessageChannel();c.port1.onmessage=()=>{S.firstPaint=performance.now();};c.port2.postMessage(0);});}});
  mo.observe(document,{childList:true,subtree:true});
})()`;
const TWO_FRAMES = `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;
const r1 = (x) => Math.round(x * 10) / 10;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT_BASE + (MUTANT === 'notimer' ? '' : ';' + TIMER) });
  const loadBefore = os.loadavg()[0];
  await H.load({ w: W, h: HGT, query: { sim: String(N) }, ready: FLAT, readyMs: 30000 });
  assert.ok(await js(`!!window.__spike`), 'the instrument was installed in the page before its scripts ran');
  const start = await js(`(()=>{const S=window.__spike;return {ops:window.__durbarSimUi.ops(),searches:S.searches.map(s=>({ms:s.last-s.t0,at:s.t0,writes:s.writes,reads:s.reads})),firstDesk:S.firstDesk,firstPaint:S.firstPaint,stage:S.stage,
    size:[innerWidth,innerHeight],dpr:devicePixelRatio,desks:document.querySelectorAll('#stage .desk[data-id]').length};})()`);
  assert.ok(await until(`window.__spike.firstPaint!==null`, 5000), 'the first frame with a desk was seen');
  const paint = await js(`({firstDesk:window.__spike.firstDesk,firstPaint:window.__spike.firstPaint,lastStageChange:window.__spike.stage[window.__spike.stage.length-1]})`);
  assert.strictEqual(start.searches.length, start.ops.searches, `every layout search the app counted was timed (timed ${start.searches.length}, counted ${start.ops.searches}): the timer is live`);
  assert.ok(start.searches.every((s) => s.ms > 0 && s.writes >= 1), `every timed search took time and made a trial (${JSON.stringify(start.searches)})`);

  /* one status event of one agent, 8 times, each a real change: renders, searches and probes by the app's own counters, and the searches the timer saw */
  const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
  const id = ids[3];
  const emit = (st) => `window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(st)}})`;
  const drawn = async (action) => {
    const before = await js(`window.__durbarSimUi.ops().renders`);
    await js(action);
    assert.ok(await until(`window.__durbarSimUi.ops().renders>${before}`, 8000), `the office drew after: ${action.slice(0, 60)}`);
    await js(TWO_FRAMES);
  };
  await drawn(emit('working'));
  const per = { renders: [], searches: [], probes: [], timed: [] };
  for (let i = 0; i < 8; i++) {
    assert.ok(await until(`window.__durbarSimUi.visitsSettled()&&window.__durbarSimUi.settleNow()`, 15000), `the office settled before update ${i}`);
    const a = await js(`({o:window.__durbarSimUi.ops(),t:window.__spike.searches.length})`);
    await drawn(emit(i % 2 ? 'working' : 'idle'));
    const b = await js(`({o:window.__durbarSimUi.ops(),t:window.__spike.searches.length})`);
    per.renders.push(b.o.renders - a.o.renders); per.searches.push(b.o.searches - a.o.searches); per.probes.push(b.o.probes - a.o.probes); per.timed.push(b.t - a.t);
  }
  const rec = {
    n: N, requested: [W, HGT], page: start.size, dpr: start.dpr, desks: start.desks, loadavgBefore: r1(loadBefore), loadavgAfter: r1(os.loadavg()[0]), cpu: os.cpus()[0].model, cores: os.cpus().length, mutant: MUTANT || undefined,
    start: { renders: start.ops.renders, searches: start.ops.searches, probes: start.ops.probes, searchMs: start.searches.map((s) => r1(s.ms)), searchAtMs: start.searches.map((s) => r1(s.at)), trialsWritten: start.searches.map((s) => s.writes), sizeReads: start.searches.map((s) => s.reads), firstDeskMs: r1(paint.firstDesk), firstPaintMs: r1(paint.firstPaint), lastStageChangeMs: r1(paint.lastStageChange), stageChangesAtStart: start.stage.length },
    perStatus: { renders: per.renders, searches: per.searches, probes: per.probes, timedSearches: per.timed, medianProbes: med(per.probes) },
  };
  console.log('[spike] ' + JSON.stringify(rec));
  process.exitCode = 0;
};
