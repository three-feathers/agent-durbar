/*
 * Spec 097 FR-358 (bug #1434): a request slip (queue, limit, MCP question) never covers a name plate, a sign, a chair label, a chip, a cue or a face, in the
 * Photo office, the cave and the Retro arcade, at 1440x900 and 1280x800 with 15 agents (AGENTS.md, Calm UI), and not in the first moments after the first draw
 * either: the slips are made fresh in the page and measured in the same task as the draw that makes them (no timing to miss), and again the moment the page's own first draw is seen. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-097-slip-plates      (builds first)
 *   SLIPPLATES_WORLDS=arcade    only those worlds (photo, cave, arcade)
 *   SHOTS_OUT=<dir>             also saves 097-slip-pills-arcade-long-<w>x<h>.png (the arcade's lane with long names)
 *   SLIPPLATES_QUERY='simnames=long'   extra simulator page parameters
 *
 * FR-359 (bug #1478): no slip lies over another slip, with long names too (the limit pill, 617 px with `simnames=long`, was docked over the queue pill in the arcade at 1280x800).
 * Mutant 2: take `;max-width:30%` out of the arcade's pill rule in src/renderer/realoffice/worlds/retro/world.css: `arcade 1280x800 long names` fails "no slip covers another slip".
 * FR-359: each arcade pill is at most 30% of the floor wide (+1 px). Mutant 4: `max-width:30%` -> `40%` in the arcade's pill rule fails "an arcade pill is at most 30% of the floor wide".
 * SLIPPLATES_QUERY is spread after the name pass's own query, so `simnames=...` in it overrides both passes (the default-name pass then runs with it too).
 * FR-359: a pill's title is its whole text (what the ellipsis cuts shows on hover). Mutant 3: in `drawSlips` of src/renderer/realoffice.js give the limit pill's `btn(t, t, ...)` the title 'Open the chat' again:
 * fails "a pill's title is its whole text" where the limit pill is a pill (the cave at 1280x800 with long names was the first, 2026-11-11).
 *
 * Mutant (the fix undone): in `put` of src/renderer/realoffice.js, take `dset(e, 'variant', v);` out of the `e.hidden = false;` line (so a pill is measured
 * without its variant's CSS, as it was before the fix): the arcade at 1280x800 fails every run with the limit pill covering Kenji's and Tomas's plates (the fresh-slip case).
 */
const assert = require('assert');
const path = require('path');
const { helpers, waits } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = [['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['arcade', { worldflags: 'retro', world: 'retro' }]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const only = (process.env.SLIPPLATES_WORLDS || '').split(',').filter(Boolean);
  const extra = Object.fromEntries(new URLSearchParams(process.env.SLIPPLATES_QUERY || ''));
  /* FR-359 (#1478): also with long names, where the limit pill ("Name: Spending limit reached - Show in chat") is wide */
  const NAMES = [[' ', {}], [' long names ', { simnames: 'long' }]];
  for (const [world, wq] of WORLDS.filter(([n]) => !only.length || only.includes(n))) for (const [w, h] of SIZES) for (const [nlabel, nq] of NAMES) {
    const tag = `${world} ${w}x${h}${nlabel.trimEnd()}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', simelicit: '1', ...wq, ...nq, ...extra }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    assert.ok(await until(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])')&&!!document.querySelector('#stage .ro-slip.ro-queue:not([hidden])')`, 15000), `${tag}: the limit and queue slips are drawn`);
    /* at once, and again once the draw has settled: what a slip covers (spec 097 FR-110: plates, signs, chair labels, chips, cues, the lobby plates, faces) */
    const COVERS = `(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
      const S=[...document.querySelectorAll('#stage .ro-slip:not([hidden])')],A=[...document.querySelectorAll('#stage .ro-plate,#stage .ro-sign,#stage .ro-away,#stage .ro-chip,#stage .ro-lplate,#stage .ro-bub,#stage .ro-bang,#stage .ro-eplate')].filter(a=>a.getClientRects().length);
      const ro=R(document.querySelector('#stage .ro')),F=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks.map(d=>d.face)).filter(Boolean).map(f=>({left:ro.left+f.x,right:ro.left+f.x+f.w,top:ro.top+f.y,bottom:ro.top+f.y+f.h}));
      const SS=S.flatMap((s,i)=>S.slice(i+1).filter(t=>hit(R(s),R(t))).map(t=>(s.className.split(' ')[1]||'slip')+' covers the '+(t.className.split(' ')[1]||'slip')+' slip'));
      return SS.concat(S.flatMap(s=>A.filter(a=>hit(R(s),R(a))).map(a=>(s.className.split(' ')[1]||'slip')+'['+s.dataset.variant+'] covers '+(typeof a.className==='string'?a.className:'')+' "'+(a.textContent||'').trim().slice(0,24)+'"').concat(F.filter(f=>hit(R(s),f)).map(()=>(s.className.split(' ')[1]||'slip')+' covers a face'))))})()`;
    /* the first draw again, on demand (review of #1477): the slips lose what a fresh element lacks (data-variant, the remembered spot and signature), a draw is made, and the
       measurement is taken in the same task, so the ~440 ms transient cannot be missed whichever way the page's own timing fell */
    const FRESH = `(()=>{for(const s of document.querySelectorAll('#stage .ro-slip')){s.removeAttribute('data-variant');s._sig=null;s._at=null;s._v=null;}
      const u=window.__durbarSimUi;u.render();u.settleNow();return ${COVERS}})()`;
    assert.deepStrictEqual(await js(FRESH), [], `${tag}: a freshly made slip, measured in the draw that made it, covers no plate, sign, chair label, chip, cue or face, and no slip lies over another slip`);
    assert.deepStrictEqual(await js(COVERS), [], `${tag}: right after the first draw, no slip covers another slip, a plate, a sign, a chair label, a chip, a cue or a face`);
    await new Promise((r) => setTimeout(r, 1200));
    /* FR-359: a pill may end in an ellipsis; its title carries the whole text, and the accessible name is the button's text */
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#stage .ro-slip[data-variant="pill"]:not([hidden]) .ro-pill')].filter(b=>b.title!==b.textContent.trim()).map(b=>b.textContent.trim()+' | title "'+b.title+'"')`), [], `${tag}: a pill's title is its whole text`);
    if (world === 'arcade') { /* the arcade draws only pills (Photo and cave may find room for every full slip) */
      assert.ok(await js(`document.querySelectorAll('#stage .ro-slip[data-variant="pill"]:not([hidden]) .ro-pill').length>0`), `${tag}: a pill is drawn to read the title of`);
      assert.deepStrictEqual(await js(`(()=>{const f=document.querySelector('#stage .ro').getBoundingClientRect().width;return [...document.querySelectorAll('#stage .ro-slip[data-variant="pill"]:not([hidden])')].filter(e=>e.getBoundingClientRect().width>0.3*f+1).map(e=>e.className+' '+Math.round(e.getBoundingClientRect().width)+' of '+Math.round(f))})()`), [], `${tag}: an arcade pill is at most 30% of the floor wide`);
    }
    if (process.env.SHOTS_OUT && world === 'arcade' && nq.simnames) await H.shot(path.join(process.env.SHOTS_OUT, `097-slip-pills-arcade-long-${w}x${h}.png`), { prep: 'mouse' });
    assert.deepStrictEqual(await js(COVERS), [], `${tag}: settled, no slip covers another slip, a plate, a sign, a chair label, a chip, a cue or a face`);
  }
};
