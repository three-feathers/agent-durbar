/*
 * Spec 102 T204 (FR-255, issue #1876): the arcade floor at the device pixel ratio the run was started with (UI_SUITE_DPR=1|1.25|1.5|2):
 * 15 agents, 1440x900 and 1280x800. Reads, for every picture of the floor (cabinets, people), the device pixels one art pixel covers
 * (rendered width x ratio / natural width) and whether its edges are on whole device pixels. Prints one line per size; takes a picture.
 * Simulator only: no AI credits. `UI_SUITE_DPR=1.25 node scripts/ui-suite.js --only measure-102-dpr`.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
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
    console.log('[102-dpr] ' + w + 'x' + h + ' ' + JSON.stringify(r));
    await H.shot(path.join(OUT, `102-dpr-${process.env.UI_SUITE_DPR || 1}-${w}x${h}.png`), { prep: 'calm' });
  }
  console.log('[102-dpr] pictures in ' + OUT);
};
