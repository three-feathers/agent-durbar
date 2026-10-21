/*
 * Smoothness and speed check (spec 052, 2026-10-21). Simulator only, no credits. Measures what a user feels:
 *   - the office under load (simspeed): frame times, long tasks, getComputedStyle calls, elements the office added and removed
 *     per second (whole desks re-created are what flickers), DOM growth;
 *   - opening a chat and switching between agents;
 *   - a long conversation (1000 messages): append cost and DOM size;
 *   - a theme switch.
 * Prints one JSON line `[perf] {...}` and fails only on hard limits (a frozen frame, a leak, a slow chat), so it is a check and a
 * measurement at once. Linux with xvfb-run:
 *
 *   npm run build
 *   DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_DRIVER=$PWD/scripts/check-perf.js xvfb-run -a npx electron . --no-sandbox
 *
 * PERF_SECONDS (default 20) sets the load phase; PERF_SPEED (default 10) how much faster the simulator works than normal.
 */
const assert = require('assert');
const path = require('path');
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const SECONDS = Number(process.env.PERF_SECONDS || 20);
const SPEED = String(process.env.PERF_SPEED || 10);

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  ctx.win.setContentSize(1440, 900);
  await ctx.win.loadFile(INDEX, { query: { sim: '15', simspeed: SPEED } });
  await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
  await ctx.sleep(1500);

  // instruments: counters around the renderer's own global functions, a frame loop, long tasks and the office's mutations
  await js(`(()=>{
    const P=window.__perf={gcs:0,frames:[],long:[],added:0,removed:0,avatarsAdded:0};
    const gcs=window.getComputedStyle; window.getComputedStyle=function(){P.gcs++;return gcs.apply(this,arguments);};
    let last=performance.now(); const loop=(t)=>{P.frames.push(t-last);last=t;if(!P.stop)requestAnimationFrame(loop);}; requestAnimationFrame(loop);
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())P.long.push(e.duration);}).observe({entryTypes:['longtask']});}catch(e){}
    new MutationObserver(ms=>{for(const m of ms){for(const n of m.addedNodes)if(n.nodeType===1){P.added++;if(n.matches&&n.matches('svg')||n.querySelector&&n.querySelector('svg'))P.avatarsAdded++;}for(const n of m.removedNodes)if(n.nodeType===1)P.removed++;}}).observe(document.getElementById('stage'),{childList:true,subtree:true});
    P.nodes0=document.getElementsByTagName('*').length;
  })()`);
  await ctx.sleep(SECONDS * 1000);
  const office = await js(`(()=>{const P=window.__perf;P.stop=true;const f=P.frames.slice(5).sort((a,b)=>a-b),q=p=>f.length?Math.round(f[Math.min(f.length-1,Math.floor(p*f.length))]*10)/10:0;
    return {seconds:${SECONDS},speed:${SPEED},frameP50:q(.5),frameP95:q(.95),frameMax:q(1),longTasks:P.long.length,longMs:Math.round(P.long.reduce((s,x)=>s+x,0)),
      getComputedStylePerSec:Math.round(P.gcs/${SECONDS}),elementsAddedPerSec:Math.round(P.added/${SECONDS}),elementsRemovedPerSec:Math.round(P.removed/${SECONDS}),
      svgSubtreesAddedPerSec:Math.round(P.avatarsAdded/${SECONDS}*10)/10,domGrowth:document.getElementsByTagName('*').length-P.nodes0}})()`);

  // opening a chat, then switching between agents (click a desk -> its panel header shows the name)
  const openMs = await js(`new Promise(r=>{const d=document.querySelector('#stage .desk[data-id="sim-1"]');const t=performance.now();d.click();
    const w=()=>{const h=document.querySelector('#panel .panel-in');if(h){requestAnimationFrame(()=>r(Math.round(performance.now()-t)));}else requestAnimationFrame(w);};w();})`);
  const switchMs = await js(`(async()=>{const ids=[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>d.dataset.id).filter(x=>/^sim-\\d+$/.test(x)).slice(1,11);const out=[];
    for(const id of ids){const t=performance.now();const s=document.querySelector('.strip [data-id="'+id+'"], #stage .desk[data-id="'+id+'"]');if(!s)continue;s.click();
      await new Promise(r=>{const w=()=>{const p=document.querySelector('#panel');if(p&&p.dataset&&(p.dataset.id===id||document.querySelector('#panel .panel-in')))requestAnimationFrame(()=>r());else requestAnimationFrame(w);};w();});out.push(performance.now()-t);}
    out.sort((a,b)=>a-b);return {n:out.length,p50:Math.round(out[Math.floor(out.length/2)]||0),max:Math.round(out[out.length-1]||0)};})()`);

  // a long conversation: 1000 assistant messages to the open agent, through the normal event path
  const chat = await js(`(async()=>{const sid='sim-1';const e=window.__durbarSimEmit;if(!e)return {skipped:'no sim hook'};
    document.querySelector('#stage .desk[data-id="sim-1"]')&&document.querySelector('#stage .desk[data-id="sim-1"]').click();
    await new Promise(r=>setTimeout(r,300));const n0=document.getElementsByTagName('*').length;const t=performance.now();
    for(let i=0;i<1000;i++){const txt='Step '+i+': checked **'+(i%7)+'** files and updated the \`registry\` notes. Next I compare the output with the last run.';
      e({type:'output',sessionId:sid,timestamp:Date.now(),delta:txt,final:true,text:txt});e({type:'status',sessionId:sid,timestamp:Date.now(),status:'idle'});
      if(i%100===99)await new Promise(r=>requestAnimationFrame(()=>r()));}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const ms=performance.now()-t;
    return {messages:1000,totalMs:Math.round(ms),perMessageMs:Math.round(ms/10)/100,domAdded:document.getElementsByTagName('*').length-n0};})()`);

  // a theme switch and back
  const themeMs = await js(`(async()=>{if(!window.THEME||!window.THEME.setTheme)return null;const cur=window.THEME.current().id;const t=performance.now();window.THEME.setTheme('retro');
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const ms=performance.now()-t;window.THEME.setTheme(cur);return Math.round(ms);})()`);

  const report = { office, openChatMs: openMs, switchAgent: switchMs, longChat: chat, themeSwitchMs: themeMs };
  console.log('[perf] ' + JSON.stringify(report));
  // hard limits (generous: they catch freezes and leaks, not small regressions; the numbers go in the spec)
  assert.ok(office.frameMax < 1000, 'no frame froze for a second: ' + office.frameMax);
  assert.ok(office.domGrowth < 2000, 'the office does not leak DOM nodes: ' + office.domGrowth);
  assert.ok(openMs < 1500, 'a chat opens within 1.5 s: ' + openMs);
  console.log('[perf] PASS');
};

// `npm run check:perf` (or `node scripts/check-perf.js` after a build): starts Electron with this driver; xvfb-run on Linux without a display
if (require.main === module) {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  if (!fs.existsSync(INDEX)) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const electron = require('electron');
  const env = { ...process.env, DURBAR_DRIVER: __filename, DURBAR_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-perf-')), DURBAR_SIM: '15' };
  const args = ['.', '--no-sandbox'];
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const r = xvfb ? spawnSync('xvfb-run', ['-a', electron, ...args], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' }) : spawnSync(electron, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out.split('\n').filter((l) => /\[perf\]|DRIVER FAILED|Error/.test(l)).join('\n') + '\n');
  process.exit(/\[perf\] PASS/.test(out) ? 0 : 1);
}
