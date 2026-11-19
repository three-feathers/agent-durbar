/*
 * Spec 102 T231 / spec 097 T162 (issues #1400, #1879): the real-GPU run of the Retro arcade on a real Mac. Simulator only, 0 AI credits, no real session.
 * Run by `scripts/real-gpu-retro-run.sh`-style launches: one Electron per size x device-pixel-ratio, DRIVER_WORLD=retro, window shown on the desktop.
 * Env: RGPU_W, RGPU_H, RGPU_OUT (a folder for the JSON, the picture and, when RGPU_REC=1, the dissolve frames).
 * Records, never asserts: frame times are requestAnimationFrame deltas (main thread + vsync), `presented` counts the frames the compositor really painted
 * (beginFrameSubscription), CPU is Electron's percentCPUUsage per process. Not seen: tearing, what the panel showed, power.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { helpers, waits, jsLiteral } = require('./driver-helpers.js');

const W = Number(process.env.RGPU_W) || 1440, HH = Number(process.env.RGPU_H) || 900;
const OUT = process.env.RGPU_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rgpu-'));
const REC = process.env.RGPU_REC === '1';
const TAG = `${W}x${HH}-dpr${process.env.UI_SUITE_DPR || '1'}`;
const STATES = ['working', 'thinking', 'waiting', 'limit', 'error', 'done', 'idle', 'asleep'];
const r2 = (x) => Math.round(x * 100) / 100;
const q = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: r2(q(s, 0.5)), p95: r2(q(s, 0.95)), p99: r2(q(s, 0.99)), max: r2(s[s.length - 1] || 0), over25: s.filter((x) => x > 25).length, over34: s.filter((x) => x > 34).length }; };
const AFTER_PAINT = `()=>new Promise(r=>requestAnimationFrame(()=>{const c=new MessageChannel();c.port1.onmessage=()=>r(performance.now());c.port2.postMessage(0);}))`;
const INST = `(()=>{if(window.__F)return;const F=window.__F={d:[],rec:false};let last=performance.now();const loop=()=>{const n=performance.now();if(F.rec)F.d.push(n-last);last=n;requestAnimationFrame(loop);};requestAnimationFrame(loop);})()`;

module.exports = async (ctx) => {
  const H = helpers(ctx); const { js } = H; const { until } = waits(ctx);
  const wc = ctx.win.webContents;
  const out = { tag: TAG, size: [W, HH], electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, gpu: app.getGPUFeatureStatus(), rows: {} };
  await H.load({ w: W, h: HH, query: { sim: '15', officeview: 'real', simfreeze: '1', romotion: '1' }, ready: `!!document.querySelector('#stage .ro[data-world="retro"] .ro-plate')`, readyMs: 30000, settle: true });
  await until(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 30000);
  await js(`Promise.all([...document.querySelectorAll('#stage img')].map(i=>i.decode().catch(()=>0)))`);
  out.dpr = await js('window.devicePixelRatio'); out.inner = await js('[innerWidth,innerHeight]');
  out.scroll = await js(`(()=>{const s=document.getElementById('stage');return {scrollH:s.scrollHeight,clientH:s.clientHeight,docScroll:document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight};})()`);
  await js(INST);
  const setStates = (list) => js(`(()=>{const U=window.__durbarSimUi,S=${jsLiteral(list)};U.agents().filter(a=>!a.parent).forEach((a,i)=>{a.state=S[i%S.length];delete a.label;});U.render();})();0`);
  const cpu = () => { const m = app.getAppMetrics(); const f = (t) => r2(m.filter((p) => p.type === t).reduce((a, p) => a + p.cpu.percentCPUUsage, 0)); return { renderer: f('Tab'), gpu: f('GPU'), main: f('Browser') }; };
  const win = async (ms) => { /* a window of rAF deltas and the CPU over it */
    cpu(); await js(`(()=>{window.__F.d=[];window.__F.rec=true;})()`); await ctx.sleep(ms);
    const c = cpu(); const d = await js(`(()=>{window.__F.rec=false;return window.__F.d;})()`); return { ms, frames: stats(d), cpuPct: c };
  };
  await ctx.sleep(1500);
  /* 1. mixed states (the arcade as a user sees it: every cabinet state, flashes on their beat), 10 s */
  await setStates(STATES); await ctx.sleep(800); out.rows.idleMixed = await win(10000);
  /* 2. every cabinet idle: nothing flashes */
  await setStates(['idle']); await ctx.sleep(800); out.rows.idleQuiet = await win(6000);
  /* 3. a status change through the normal event path: cost from the rAF to after paint, and the frame deltas over the whole run */
  await setStates(STATES); await ctx.sleep(500);
  cpu(); await js(`(()=>{window.__F.d=[];window.__F.rec=true;})()`);
  const costs = await js(`(async()=>{const e=window.__durbarSimEmit;const ids=window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id);const after=${AFTER_PAINT};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const o=[];
    for(let i=0;i<40;i++){const id=ids[i%ids.length];let rs=0;requestAnimationFrame(()=>{rs=performance.now();});e({type:'status',sessionId:id,timestamp:Date.now(),status:(i%2)?'idle':'working'});o.push((await after())-rs);await sleep(120);}
    return o;})()`);
  const c3 = cpu(); const d3 = await js(`(()=>{window.__F.rec=false;return window.__F.d;})()`);
  out.rows.statusChange = { updates: costs.length, cost: stats(costs), frames: stats(d3), cpuPct: c3 };
  /* 4. the frames the compositor really painted over 5 s of the mixed look */
  { const t = []; wc.beginFrameSubscription(false, () => { t.push(performance.now()); }); await ctx.sleep(5000); wc.endFrameSubscription();
    const gaps = t.slice(1).map((x, i) => x - t[i]); out.rows.presented = { frames: t.length, perSec: r2(t.length / 5), gaps: stats(gaps) }; }
  /* 5. the dissolve: a person goes to a place and back; rAF deltas over the move, and with RGPU_REC=1 every painted frame is kept */
  const who = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).find(d=>d.person).id`);
  await js(`(()=>{const U=window.__durbarSimUi;U.agents().find(a=>a.id===${jsLiteral(who)}).state='done';U.render();})();0`); await ctx.sleep(1500);
  const frames = []; let t0 = 0;
  if (REC) { t0 = Date.now(); wc.beginFrameSubscription(false, (img) => { const s = img.getSize(); const k = s.width > 960 ? img.resize({ width: 960 }) : img; frames.push({ t: Date.now() - t0, jpg: k.toJPEG(70) }); }); }
  await js(`(()=>{window.__F.d=[];window.__F.rec=true;})()`);
  await js(`window.__durbarSimUi.emit({type:'toolCall',sessionId:${jsLiteral(who)},callId:'rgpu-mv',tool:'bash',phase:'start',args:{command:'npm run a-long-one'}});0`);
  const dis = await js(`new Promise((done)=>{const t0=performance.now();let max=0;const look=()=>{max=Math.max(max,document.querySelectorAll('#stage .ro-dis').length);if(performance.now()-t0<1200)requestAnimationFrame(look);else done({maxCopies:max,left:document.querySelectorAll('#stage .ro-dis').length});};look();})`);
  if (REC) { wc.endFrameSubscription(); fs.mkdirSync(path.join(OUT, 'frames-' + TAG), { recursive: true }); frames.forEach((f, i) => fs.writeFileSync(path.join(OUT, 'frames-' + TAG, String(i).padStart(3, '0') + '-' + f.t + 'ms.jpg'), f.jpg)); dis.recordedFrames = frames.length; dis.spanMs = frames.length ? frames[frames.length - 1].t - frames[0].t : 0; }
  const d5 = await js(`(()=>{window.__F.rec=false;return window.__F.d;})()`);
  out.rows.dissolve = { ...dis, frames: stats(d5) };
  /* 6. what it looks like: one picture of the mixed look (read by eye afterwards) */
  await setStates(STATES); await ctx.sleep(600);
  await js(`window.__durbarSimUi.emit({type:'toolCall',sessionId:${jsLiteral(who)},callId:'rgpu-mv2',tool:'bash',phase:'end',args:{}});0`);
  await ctx.sleep(900);
  await ctx.shot(path.join(OUT, 'retro-' + TAG + '.png'));
  fs.writeFileSync(path.join(OUT, 'rgpu-' + TAG + '.json'), JSON.stringify(out, null, 1));
  console.log('[rgpu] ' + TAG + ' done');
};
