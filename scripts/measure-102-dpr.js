/*
 * Spec 102 T204 (FR-255, issue #1876): the arcade floor at the device pixel ratio the run was started with (UI_SUITE_DPR=1|1.25|1.5|2):
 * 15 agents, 1440x900 and 1280x800. Reads, for every picture of the floor (cabinets, people), the device pixels one art pixel covers
 * (rendered width x ratio / natural width) and whether its edges are on whole device pixels. Prints one line per size; takes a picture.
 * It fails (exit 1) at a whole ratio (1, 2) when a cabinet or person picture (`ro-art`) is uneven or the floor scrolls, and when the ratio changes under a running
 * window (CDP emulation: no resize, only the resolution query fires) and the floor's `g` does not follow (#1884 review). At 1.25 and 1.5 it measures and prints.
 * Simulator only: no AI credits. `UI_SUITE_DPR=1.25 node scripts/ui-suite.js --only measure-102-dpr`.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { helpers } = require('./driver-helpers');
const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-102-dpr-'));
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { officeview: 'real', worldflags: 'retro', world: 'retro', sim: '15' }, ready: REAL, settle: false });
    await H.until(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 15000);
    const r = await H.js(`(()=>{const d=window.devicePixelRatio,L=window.__durbarSimUi.realLayout(),eps=0.01,whole=(v)=>Math.abs(v*d-Math.round(v*d))<eps;
      const st=document.querySelector('#stage .ro').getBoundingClientRect(),rows=[];
      for(const i of document.querySelectorAll('#stage .ro img')){const b=i.getBoundingClientRect();if(!b.width||!i.naturalWidth)continue;const s=b.width*d/i.naturalWidth,sy=b.height*d/i.naturalHeight;
        rows.push({cls:(i.parentElement&&i.parentElement.className||'').toString().split(' ')[0],sx:+s.toFixed(3),sy:+sy.toFixed(3),even:Math.abs(s-Math.round(s))<eps&&Math.abs(sy-Math.round(sy))<eps,edges:whole(b.left)&&whole(b.top)&&whole(b.right)&&whole(b.bottom)});}
      const by={};for(const x of rows){const k=x.cls+' '+x.sx+'x'+x.sy;by[k]=by[k]||{n:0,even:0,edges:0};by[k].n++;by[k].even+=x.even?1:0;by[k].edges+=x.edges?1:0;}
      return {dpr:d,g:L.g,n:rows.length,uneven:rows.filter(x=>!x.even).length,edgesOff:rows.filter(x=>!x.edges).length,by,scroll:document.querySelector('#stage .ro').scrollHeight>document.querySelector('#stage').clientHeight+1};})()`);
    fs.appendFileSync(path.join(OUT, `102-dpr-${process.env.UI_SUITE_DPR || 1}.txt`), w + 'x' + h + ' ' + JSON.stringify(r) + '\n');
    assert.strictEqual(r.scroll, false, `no scroll at ${w}x${h}, ratio ${r.dpr}`);
    if (Number.isInteger(r.dpr)) { const bad = Object.entries(r.by).filter(([k, v]) => k.startsWith('ro-art') && v.even !== v.n); assert.deepStrictEqual(bad, [], `ratio ${r.dpr}: every cabinet and person picture is an even square (${w}x${h})`); }
    console.log('[102-dpr] ' + w + 'x' + h + ' ' + JSON.stringify(r));
    await H.shot(path.join(OUT, `102-dpr-${process.env.UI_SUITE_DPR || 1}-${w}x${h}.png`), { prep: 'calm' });
  }
  /* the ratio changes under the open window (a drag to another screen): same CSS size, so no resize event; the floor must be laid out again for the new ratio */
  if (!process.env.UI_SUITE_DPR || Number(process.env.UI_SUITE_DPR) === 1) {
    await H.load({ w: 1280, h: 800, query: { officeview: 'real', worldflags: 'retro', world: 'retro', sim: '2', simfreeze: '1' }, ready: REAL, settle: false });
    const G = () => H.js('window.__durbarSimUi.realLayout().g');
    const g1 = await G();
    await H.js('window.addEventListener("resize",(e)=>e.stopImmediatePropagation(),true);0'); /* a move to another screen gives no resize: nothing but the resolution query may lay the floor out again */
    const dbg = ctx.win.webContents.debugger; dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 1.25, mobile: false });
    assert.ok(await H.until(`Math.abs(window.__durbarSimUi.realLayout().g*1.25-Math.round(window.__durbarSimUi.realLayout().g*1.25))<1e-6&&devicePixelRatio===1.25`, 8000), 'ratio 1 to 1.25 under the window: g follows (was ' + g1 + ', now ' + await G() + ')');
    assert.strictEqual(await H.js('document.documentElement.dataset.dprq'), '(resolution: 1.25dppx)', 'the resolution query was set again for the new ratio by its own handler');
    assert.strictEqual(await H.js('document.documentElement.dataset.dprn'), '1', 'the floor was laid out once after the ratio change, by the path the handler asks for (relayout counts itself)'); /* the sim's own redraws can also lay the floor out, so the counter is the proof of the handler */
    /* a second change (back to 1) is not driven: under xvfb the CDP override fires a media-query change on the first change only (`[KNOWN GAP]`, tested by hand never) */
    dbg.detach();
    console.log('[102-dpr] the ratio changed under the window: g ' + g1 + ' to ' + await G());
  }
  console.log('[102-dpr] pictures in ' + OUT);
};
