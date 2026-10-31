/*
 * The Electron half of `check-perf.js --record` (spec 097 FR-187, T145): flat or Real office, 15 or 40 agents, simulator only, 0 AI
 * credits, no assert on any time. Started by `scripts/perf-record.js` through check-perf.js (DURBAR_DRIVER); env: PERF_PHASE
 * (seed | start | main), PERF_MODE (flat | real), PERF_OUT (the JSON file), PERF_RUNS, PERF_SECONDS_SCALE (quick | full), PERF_GPU (1 adds the T162 A/B rows).
 *
 * Honest limits (the record repeats them in `limits`):
 *  - Frames are requestAnimationFrame deltas. They see the main thread and a late frame. They do NOT see compositor-only jank,
 *    GPU-process or raster time, scrolling done off the main thread, tearing, or what the display actually showed.
 *  - Under software compositing (gpu_compositing disabled_software: Xvfb, many CI runners) the GPU process CPU is Skia drawing every
 *    frame in software, so blending, blur and raster look far worse than on a GPU. Read those rows as comparisons. On a real Mac or a
 *    Windows or Linux laptop with a GPU the same rows are the real-GPU evidence (T162); the record names `gpu_compositing`.
 *  - Device pixel ratio 1 hides Retina's four times the pixels; the record names the ratio.
 *  - CPU: /proc ticks on Linux (percent of one core); elsewhere Electron's percentCPUUsage, whose scale differs by OS. Memory: PSS on
 *    Linux, working set elsewhere. Compare within one OS.
 * Real office rows degrade: where the build has no Real office (`officeview=real` leaves the page flat), the case is recorded as absent
 * with its reason, not as a failure.
 * Ported from a private prototype; the measures are those of the table in spec 097 *performance budgets, measured*.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const { helpers, waits, jsLiteral } = require('./driver-helpers.js');

const PHASE = process.env.PERF_PHASE || 'main';
const MODE = process.env.PERF_MODE === 'real' ? 'real' : 'flat';
const N = String(process.env.DURBAR_SIM || 15);
const RUNS = Math.max(1, Math.min(9, Number(process.env.PERF_RUNS) || 3));
const QUICK = process.env.PERF_SECONDS_SCALE === 'quick';
const GPU_AB = process.env.PERF_GPU === '1';
const OUT = process.env.PERF_OUT;
const W = 1440, HH = 900;
const SEC = (x) => (QUICK ? Math.min(x, 3) : x);

const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
const FLAT = `document.querySelectorAll('#stage .desk[data-id]').length>=1&&!document.querySelector('#stage .ro')`;

/* page instruments: frames, rAF callback cost, long tasks, layout reads, mutations; renders of the Real office when present */
const INST = `(()=>{ if(window.__P)return;
  const P=window.__P={frames:[],long:[],gcs:0,reads:0,rafMs:[],renders:0,renderMs:[],floorGcs:0,added:0,removed:0,attrs:0,recording:false};
  const gcs=window.getComputedStyle; window.getComputedStyle=function(e){ if(P.recording){P.gcs++; if(e&&e.id==='floor')P.floorGcs++;} return gcs.apply(this,arguments); };
  for(const prop of ['offsetWidth','offsetHeight','offsetTop','offsetLeft','clientWidth','clientHeight','scrollHeight','scrollWidth','scrollTop']){
    for(const proto of [HTMLElement.prototype,Element.prototype]){const d=Object.getOwnPropertyDescriptor(proto,prop); if(d&&d.get){Object.defineProperty(proto,prop,{...d,get(){if(P.recording)P.reads++;return d.get.call(this);}});}}
  }
  const gbr=Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect=function(){if(P.recording)P.reads++;return gbr.call(this);};
  const raf=window.requestAnimationFrame; window.requestAnimationFrame=function(cb){return raf.call(window,(t)=>{const a=performance.now();try{return cb(t);}finally{if(P.recording)P.rafMs.push(performance.now()-a);}});};
  let last=performance.now(); const loop=()=>{const n=performance.now(); if(P.recording)P.frames.push(n-last); last=n; raf.call(window,loop);}; raf.call(window,loop);
  try{new PerformanceObserver(l=>{if(!P.recording)return;for(const e of l.getEntries())P.long.push(Math.round(e.duration));}).observe({entryTypes:['longtask']});}catch(e){}
  new MutationObserver(ms=>{if(!P.recording)return;for(const m of ms){if(m.type==='attributes'){P.attrs++;continue;}for(const n of m.addedNodes)if(n.nodeType===1)P.added++;for(const n of m.removedNodes)if(n.nodeType===1)P.removed++;}}).observe(document.getElementById('stage'),{childList:true,subtree:true,attributes:true});
  P.wrap=()=>{const D=window.DurbarRealOffice; if(D&&!D.__w&&typeof D.render==='function'){D.__w=1;const r=D.render;D.render=function(){const a=performance.now();try{return r.apply(this,arguments);}finally{if(P.recording){P.renders++;P.renderMs.push(performance.now()-a);}}};}};
  P.wrap();
  P.start=()=>{Object.assign(P,{frames:[],long:[],gcs:0,reads:0,rafMs:[],renders:0,renderMs:[],floorGcs:0,added:0,removed:0,attrs:0,t0:performance.now(),recording:true});P.wrap();};
  const q=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]*100)/100;};
  P.stop=()=>{P.recording=false;const sec=(performance.now()-P.t0)/1000,f=P.frames.slice(1);
    return {sec:Math.round(sec*10)/10,frames:f.length,fps:Math.round(f.length/sec*10)/10,p50:q(f,.5),p95:q(f,.95),worst:q(f,1),over16_7:f.filter(x=>x>17.5).length,over33:f.filter(x=>x>33.4).length,
      longTasks:P.long.length,longest:P.long.length?Math.max(...P.long):0,longTotalMs:P.long.reduce((s,x)=>s+x,0),
      rafP50:q(P.rafMs,.5),rafP95:q(P.rafMs,.95),rafMax:q(P.rafMs,1),
      flatRendersPerSec:Math.round(P.floorGcs/sec*100)/100,realRendersPerSec:Math.round(P.renders/sec*100)/100,renderP50:q(P.renderMs,.5),renderP95:q(P.renderMs,.95),
      layoutReadsPerSec:Math.round(P.reads/sec),addedPerSec:Math.round(P.added/sec*10)/10,removedPerSec:Math.round(P.removed/sec*10)/10,attrsPerSec:Math.round(P.attrs/sec)};};
})()`;

/* the end of a frame: after paint has been committed on the main thread */
const AFTER_PAINT = `()=>new Promise(r=>requestAnimationFrame(()=>{const c=new MessageChannel();c.port1.onmessage=()=>r(performance.now());c.port2.postMessage(0);}))`;

/* CPU and memory per process. Linux: /proc ticks (percent of one core) and PSS; elsewhere Electron's own numbers. */
const cpuSample = () => {
  const out = {};
  for (const m of app.getAppMetrics()) {
    let ticks = null, pss = null;
    if (process.platform === 'linux') {
      try { const s = fs.readFileSync(`/proc/${m.pid}/stat`, 'utf8'); const a = s.slice(s.lastIndexOf(')') + 2).split(' '); ticks = Number(a[11]) + Number(a[12]); } catch { /* process gone */ }
      try { const x = /^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${m.pid}/smaps_rollup`, 'utf8')); pss = x ? Number(x[1]) : null; } catch { /* process gone */ }
    }
    out[m.pid] = { type: m.type, pct: m.cpu.percentCPUUsage, ws: m.memory.workingSetSize, ticks, pss };
  }
  return out;
};
const r2 = (x) => Math.round(x * 100) / 100;
const cpuOver = async (ctx, sec) => {
  app.getAppMetrics();
  const a = cpuSample(), t0 = Date.now();
  await ctx.sleep(sec * 1000);
  const b = cpuSample(), dt = (Date.now() - t0) / 1000;
  const byType = {};
  let total = 0;
  const linux = process.platform === 'linux';
  for (const pid of Object.keys(b)) {
    const d = linux ? (b[pid].ticks != null && a[pid] && a[pid].ticks != null ? (b[pid].ticks - a[pid].ticks) * 0.01 / dt * 100 : 0) : b[pid].pct;
    byType[b[pid].type] = r2((byType[b[pid].type] || 0) + d);
    total += d;
  }
  return { method: linux ? 'proc-ticks-percent-of-one-core' : 'electron-percentCPUUsage', totalPct: r2(total), byType };
};
const memory = async (js) => {
  const heap = await js(`(()=>{ if(window.gc){gc();gc();} const m=performance.memory; return {used:m.usedJSHeapSize,nodes:document.getElementsByTagName('*').length,stageNodes:document.querySelectorAll('#stage *').length}; })()`);
  await new Promise((r) => setTimeout(r, 1000));
  const s = cpuSample();
  let pss = 0, ws = 0;
  for (const p of Object.values(s)) { pss += p.pss || 0; ws += p.ws || 0; }
  return { method: process.platform === 'linux' ? 'pss' : 'working-set', processMB: r2((process.platform === 'linux' ? pss : ws) / 1024), workingSetMB: r2(ws / 1024), jsHeapMB: r2(heap.used / 1048576), domNodes: heap.nodes, stageNodes: heap.stageNodes };
};
/* pictures: decoded against shown (Real office only; flat has none) */
const IMAGES = `(()=>{const imgs=[...document.querySelectorAll('#stage img')];const by=new Map();
  for(const i of imgs){const r=i.getBoundingClientRect(),o=by.get(i.currentSrc||i.src)||{w:i.naturalWidth,h:i.naturalHeight,sw:0,sh:0};o.sw=Math.max(o.sw,r.width);o.sh=Math.max(o.sh,r.height);by.set(i.currentSrc||i.src,o);}
  let natural=0,shown=0;for(const [,o] of by){natural+=o.w*o.h*4;shown+=Math.ceil(o.sw)*Math.ceil(o.sh)*4;}
  return {elements:imgs.length,distinct:by.size,decodedMB:Math.round(natural/1048576*10)/10,shownMB:Math.round(shown/1048576*10)/10,decodedOverShown:Math.round(natural/(shown||1)*100)/100};})()`;

/* one status change at a time through the normal event path: main-thread cost of each update, rAF start to after paint */
const UPDATES = (n) => `(async()=>{const P=window.__P,e=window.__durbarSimEmit;if(!e)return {skipped:'no simulator emit hook'};const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);const out=[],ops=[];const after=${AFTER_PAINT};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<${n};i++){const id=ids[i%ids.length];const st=(i%2)?'idle':'working';
    const b={r:P.renders,g:P.floorGcs,rd:P.reads,a:P.added,rm:P.removed,at:P.attrs};
    let rs=0;requestAnimationFrame(()=>{rs=performance.now();});
    e({type:'status',sessionId:id,timestamp:Date.now(),status:st});
    const end=await after();out.push(end-rs);await sleep(0);
    ops.push({renders:Math.max(P.renders-b.r,P.floorGcs-b.g),layoutReads:P.reads-b.rd,nodesAdded:P.added-b.a,nodesRemoved:P.removed-b.rm,attrWrites:P.attrs-b.at});
    await sleep(120);}
  const s=[...out].sort((a,b)=>a-b),q=p=>Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]*100)/100,m=k=>{const v=ops.map(o=>o[k]).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
  return {updates:out.length,costP50:q(.5),costP95:q(.95),costMax:q(1),over16_7:out.filter(x=>x>16.7).length,renders:m('renders'),layoutReads:m('layoutReads'),nodesAdded:m('nodesAdded'),nodesRemoved:m('nodesRemoved'),attrWrites:m('attrWrites')};})()`;

const decodeAll = `Promise.all([...document.querySelectorAll('#stage img')].map(i=>i.decode().catch(()=>0)))`;
const picsDone = (real) => (real ? `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)` : 'true');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until, settle } = waits(ctx);
  const isReal = MODE === 'real';
  const ready = isReal ? REAL : FLAT;
  const query = (x = {}) => ({ sim: N, officeview: MODE, ...x });
  const setDoors = () => js(`localStorage.setItem('durbar.doorsigns','off')`);
  const done = async (o) => {
    try { o.meta.devicePixelRatio = await js(`window.devicePixelRatio`); } catch { /* page gone: the record falls back to 1 and says nothing */ }
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(o));
    console.log(`[perf-record] ${PHASE} ${MODE} ${N} done`);
  };
  const meta = () => ({ phase: PHASE, mode: MODE, n: Number(N), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, loadavg: os.loadavg(), gpu: app.getGPUFeatureStatus() });

  /* Real office present in this build? The page stays flat when `officeview=real` is unknown (before spec 097 P1 is merged). */
  const load = async (x, o = {}) => {
    await H.load({ w: W, h: HH, query: query(x), ready: o.anyReady ? `!!document.getElementById('stage')&&document.querySelectorAll('#stage .desk[data-id], #stage .ro-plate').length>=1` : ready, readyMs: 30000, settle: false });
  };
  const loadAndInstrument = async (x) => {
    await load(x);
    await until(picsDone(isReal), 30000);
    await js(decodeAll);
    await js(`(${AFTER_PAINT})()`);
    await js(INST);
  };
  const realPresent = async () => {
    await H.load({ w: W, h: HH, query: { sim: N, officeview: 'real' }, ready: `document.querySelectorAll('#stage .desk[data-id], #stage .ro-plate').length>=1`, readyMs: 30000, settle: false });
    return until(REAL, 10000);
  };
  const absent = { available: false, reason: 'this build has no Real office mode (officeview=real left the page flat): recorded as absent, not as a failure' };

  if (PHASE === 'seed') {
    if (isReal && !(await realPresent())) return done({ meta: meta(), ...absent });
    if (!isReal) await H.load({ w: W, h: HH, query: query(), ready: FLAT, readyMs: 30000, settle: false });
    await js(`localStorage.setItem('durbar.officeview',${jsLiteral(MODE)})`);
    if (MODE !== 'cabins') await setDoors();
    await js(`new Promise(r=>setTimeout(r,800))`);
    return done({ meta: meta(), available: true });
  }

  if (PHASE === 'start') {
    /* the page was loaded by main with the saved mode; from process start to the first complete frame */
    const procStart = Date.now() - process.uptime() * 1000;
    await until(ready, 30000);
    const domReady = await js(`performance.now()`);
    await until(picsDone(isReal), 30000);
    await js(decodeAll);
    const painted = await js(`(${AFTER_PAINT})()`);
    const nav = await js(`(()=>{const n=performance.getEntriesByType('navigation')[0];return {timeOrigin:performance.timeOrigin,dcl:n.domContentLoadedEventEnd,real:!!document.querySelector('#stage .ro')}})()`);
    const start = { fromProcessStartMs: Math.round(nav.timeOrigin + painted - procStart), officeDrawnMs: Math.round(domReady), domContentLoadedMs: Math.round(nav.dcl), completeFrameMs: Math.round(painted), savedModeShown: nav.real ? 'real' : 'flat' };
    await ctx.sleep(1500);
    return done({ meta: meta(), start, memoryAtStart: await memory(js) });
  }

  /* ---- main: switches (fresh profile), then the runs ---- */
  if (isReal && !(await realPresent())) return done({ meta: meta(), ...absent });
  const out = { meta: meta(), available: true };

  /* the mode switch through Settings, as a user does it: a timeline per switch. Failures here are recorded, never thrown. */
  const oneSwitch = async (to) => {
    await js(`window.DurbarScreens.openSettings()`);
    if (!(await until(`!!document.querySelector('[data-officelayout=${jsLiteral(to)}]')`, 8000))) return { error: `no Settings control for ${to}` };
    const r = await js(`(async()=>{const P=window.__P;P.start();const t0=performance.now();const tl={};
      document.querySelector('[data-officelayout="${to}"]').click();
      const closer=document.getElementById('scrClose');if(closer)closer.click();
      const real=${to === 'real'};const st=document.getElementById('stage');
      for(;;){const ok=real?(st.dataset.d==='real'&&!!st.querySelector('.ro .ro-plate')):(!st.querySelector('.ro')&&st.querySelector('.desk[data-id]'));if(ok)break;await new Promise(r=>requestAnimationFrame(r));if(performance.now()-t0>20000)return {timeout:true};}
      tl.domMs=performance.now()-t0;
      if(real){for(;;){const im=[...st.querySelectorAll('img')];if(im.length&&im.every(i=>i.complete))break;await new Promise(r=>setTimeout(r,4));if(performance.now()-t0>20000)return {timeout:true};}
        await ${decodeAll};tl.decodedMs=performance.now()-t0;}
      const end=await (${AFTER_PAINT})();tl.frameMs=end-t0;
      await new Promise(r=>setTimeout(r,250));const s=P.stop();for(const k of Object.keys(tl))tl[k]=Math.round(tl[k]);
      return {...tl,worstFrame:s.worst,longTasks:s.longTasks,longestLongTask:s.longest};})()`);
    await settle(3000);
    await ctx.sleep(500);
    return r;
  };
  try {
    await H.load({ w: W, h: HH, query: { sim: N, officeview: 'flat' }, ready: FLAT, readyMs: 30000, settle: false });
    await setDoors();
    await H.load({ w: W, h: HH, query: { sim: N, officeview: 'flat' }, ready: FLAT, readyMs: 30000, settle: false });
    await settle();
    await js(INST);
    const sw = {};
    if (isReal) {
      sw.first = await oneSwitch('real');
      sw.repeat = []; sw.backToFlat = [];
      for (let i = 0; i < RUNS; i++) { sw.backToFlat.push(await oneSwitch('open')); sw.repeat.push(await oneSwitch('real')); }
    } else {
      sw.openToCabins = []; sw.cabinsToOpen = [];
      for (let i = 0; i < RUNS; i++) { sw.openToCabins.push(await oneSwitch('cabins')); sw.cabinsToOpen.push(await oneSwitch('open')); }
    }
    const med = (arr, k) => { const v = arr.filter((x) => x && typeof x[k] === 'number').map((x) => x[k]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
    out.switches = isReal
      ? { firstFrameMs: sw.first.frameMs ?? null, first: sw.first, repeatFrameMs: med(sw.repeat, 'frameMs'), backToFlatFrameMs: med(sw.backToFlat, 'frameMs'), backToFlatLongestLongTask: med(sw.backToFlat, 'longestLongTask') }
      : { openToCabinsFrameMs: med(sw.openToCabins, 'frameMs'), cabinsToOpenFrameMs: med(sw.cabinsToOpen, 'frameMs'), openToCabinsLongestLongTask: med(sw.openToCabins, 'longestLongTask') };
  } catch (e) {
    out.switches = { error: String(e && e.message || e).slice(0, 200) };
  }

  const oneRun = async () => {
    const R = {};
    await H.load({ w: W, h: HH, query: query(), ready, readyMs: 30000, settle: false });
    await setDoors();
    await loadAndInstrument();
    await ctx.sleep(3000);
    R.counts = await js(`({scrolls:document.getElementById('floor').scrollHeight>document.getElementById('floor').clientHeight+1,animationsRunning:document.getAnimations().filter(a=>a.playState==='running').length,animationsTotal:document.getAnimations().length})`);
    R.counts.scrolls = R.counts.scrolls ? 1 : 0;
    if (isReal) R.images = await js(IMAGES);
    R.memorySettled = await memory(js);

    /* idle, nothing changing: visible, then hidden (no frames) */
    R.idleVisible = await cpuOver(ctx, SEC(15));
    ctx.win.webContents.setBackgroundThrottling(true); // as in production: drivers switch it off (spec 097 FR-103)
    ctx.win.hide();
    await ctx.sleep(1500);
    R.hiddenState = await js(`document.visibilityState`) === 'hidden' ? 1 : 0;
    R.idleHidden = await cpuOver(ctx, SEC(15));
    ctx.win.show();
    ctx.win.webContents.setBackgroundThrottling(false);
    await ctx.sleep(1500);

    /* controlled status changes */
    await js(`window.__P.start()`);
    R.update = await js(UPDATES(SEC(60) === 3 ? 10 : 60));
    await js(`window.__P.stop()`);

    /* chat open and close, 6 cycles */
    await js(`window.__P.start()`);
    R.chat = await js(`(async()=>{const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);const open=[],close=[];const after=${AFTER_PAINT};
      const sel=id=>document.querySelector('#stage .ro-plate[data-id="'+id+'"],#stage .desk[data-id="'+id+'"]');
      const wait=async f=>{for(let i=0;i<400&&!f();i++)await new Promise(r=>requestAnimationFrame(r));};
      for(let i=0;i<${QUICK ? 2 : 6};i++){const id=ids[(i*3)%ids.length];let t=performance.now();const s=sel(id);if(!s)continue;s.click();await wait(()=>document.body.classList.contains('panel-open')&&document.querySelector('#panel .panel-in'));open.push((await after())-t);await new Promise(r=>setTimeout(r,500));
        t=performance.now();document.getElementById('backBtn').click();await wait(()=>!document.body.classList.contains('panel-open'));close.push((await after())-t);await new Promise(r=>setTimeout(r,500));}
      const m=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?Math.round(s[Math.floor(s.length/2)]):null;};return {openMedianMs:m(open),closeMedianMs:m(close)};})()`);
    R.chatFrames = await js(`window.__P.stop()`);

    /* lobby visits: tool calls through the normal event path */
    await js(`window.__P.start()`);
    R.visits = await js(`(async()=>{const e=window.__durbarSimEmit;const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);let maxV=0;
      for(let i=0;i<${QUICK ? 6 : 24};i++){const id=ids[(i*2+1)%ids.length];const c='perf'+i;
        e({type:'status',sessionId:id,timestamp:Date.now(),status:'working'});
        e({type:'toolCall',sessionId:id,timestamp:Date.now(),callId:c,tool:'web_fetch',phase:'start',args:{url:'https://example.test/'}});
        await new Promise(r=>setTimeout(r,350));maxV=Math.max(maxV,document.querySelectorAll('#stage .ro-visitor,#stage .walker').length);
        e({type:'toolCall',sessionId:id,timestamp:Date.now(),callId:c,tool:'web_fetch',phase:'complete',output:'ok'});}
      await new Promise(r=>setTimeout(r,1500));return {maxVisitorsSeen:maxV};})()`);
    R.visitFrames = await js(`window.__P.stop()`);

    /* scrolling, only when the office scrolls (past the 15-agent scale) */
    if (await js(`(()=>{const f=document.getElementById('floor');return f.scrollHeight>f.clientHeight+1;})()`)) {
      await js(`window.__P.start()`);
      await js(`(async()=>{const f=document.getElementById('floor');const max=f.scrollHeight-f.clientHeight;const step=()=>new Promise(r=>requestAnimationFrame(r));for(let k=0;k<2;k++){for(let y=0;y<=max;y+=10){f.scrollTop=y;await step();}for(let y=max;y>=0;y-=10){f.scrollTop=y;await step();}}})()`);
      R.scrollFrames = await js(`window.__P.stop()`);
    }

    /* background activity: 10x, and normal speed */
    for (const speed of ['10', '1']) {
      await loadAndInstrument({ simspeed: speed, simfreeze: undefined });
      await ctx.sleep(2000);
      await js(`window.__P.start()`);
      const cpu = await cpuOver(ctx, SEC(20));
      R['activity' + speed] = { ...(await js(`window.__P.stop()`)), cpu };
    }
    R.memoryAfterRun = await memory(js);
    return R;
  };

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try { runs.push(await oneRun()); } catch (e) { console.log('[perf-record] run failed: ' + String(e && e.message || e).slice(0, 200)); }
  }
  if (!runs.length) { out.available = false; out.reason = 'every run failed in the page (see the log)'; return done(out); }
  /* medians over the runs (kept here so a Mac session needs no second tool) */
  const { medianOf } = require('./perf-record.js');
  out.rows = medianOf(runs);
  out.runsDone = runs.length;
  out.raw = runs;

  /* T162: the GPU A/B rows, Real office only, on a GPU machine: a style turned off in the same window, idle CPU and a dialog's frames over 10x activity */
  if (GPU_AB && isReal) {
    const V = { base: '', noBlur: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}', noBlend: '.ro-lamp,.ro-fxl{mix-blend-mode:normal!important}', noLights: '.ro-lights,.ro-amb{display:none!important}', noAnim: '*{animation:none!important;transition:none!important}', noShadow: '.ro *{box-shadow:none!important}', base2: '' };
    const setV = (css) => js(`(()=>{let s=document.getElementById('perfVar');if(!s){s=document.createElement('style');s.id='perfVar';document.head.append(s);}s.textContent=${jsLiteral(css)};})()`);
    out.ab = { idle: {}, dialog: {} };
    await loadAndInstrument();
    for (const [k, css] of Object.entries(V)) { await setV(css); await ctx.sleep(1500); out.ab.idle[k] = await cpuOver(ctx, SEC(10)); }
    await loadAndInstrument({ simspeed: '10', simfreeze: undefined });
    for (const [k, css] of [['base', V.base], ['noBlur', V.noBlur], ['base', V.base], ['noBlur', V.noBlur]]) {
      await setV(css);
      await js(`(()=>{const o=document.createElement('div');o.id='perfDlg';o.className='dlg-ov';o.innerHTML='<div class="dlg wide"><h3>Perf</h3><p class="dsub">A dialog the size of a real one.</p><div style="height:380px;width:560px"></div></div>';document.body.append(o);})()`);
      await ctx.sleep(500);
      await js(`window.__P.start()`);
      const cpu = await cpuOver(ctx, SEC(10));
      const fr = await js(`window.__P.stop()`);
      await js(`document.getElementById('perfDlg').remove()`);
      out.ab.dialog[k] = out.ab.dialog[k] || [];
      out.ab.dialog[k].push({ fps: fr.fps, p95: fr.p95, worst: fr.worst, over33: fr.over33, cpu });
    }
    await setV('');
  }
  return done(out);
};
