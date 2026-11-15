/*
 * Spec 097 FR-358 (bug #1434): a request slip (queue, limit, MCP question) never covers a name plate, a sign, a chair label, a chip, a cue or a face, in the
 * Photo office, the cave and the Retro arcade, at 1440x900 and 1280x800 with 15 agents (AGENTS.md, Calm UI), and not in the first moments after the first draw
 * either: the slips are made fresh in the page and measured in the same task as the draw that makes them (no timing to miss), and again the moment the page's own first draw is seen. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-097-slip-plates      (builds first)
 *   SLIPPLATES_WORLDS=arcade    only those worlds (photo, cave, arcade)
 *   SLIPPLATES_QUERY='simnames=long'   extra simulator page parameters
 *
 * Mutant (the fix undone): in `put` of src/renderer/realoffice.js, take `dset(e, 'variant', v);` out of the `e.hidden = false;` line (so a pill is measured
 * without its variant's CSS, as it was before the fix): the arcade at 1280x800 fails every run with the limit pill covering Kenji's and Tomas's plates (the fresh-slip case).
 */
const assert = require('assert');
const { helpers, waits } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = [['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['arcade', { worldflags: 'retro', world: 'retro' }]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const only = (process.env.SLIPPLATES_WORLDS || '').split(',').filter(Boolean);
  const extra = Object.fromEntries(new URLSearchParams(process.env.SLIPPLATES_QUERY || ''));
  for (const [world, wq] of WORLDS.filter(([n]) => !only.length || only.includes(n))) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', simelicit: '1', ...wq, ...extra }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    assert.ok(await until(`!!document.querySelector('#stage .ro-slip.ro-limit:not([hidden])')&&!!document.querySelector('#stage .ro-slip.ro-queue:not([hidden])')`, 15000), `${tag}: the limit and queue slips are drawn`);
    /* at once, and again once the draw has settled: what a slip covers (spec 097 FR-110: plates, signs, chair labels, chips, cues, the lobby plates, faces) */
    const COVERS = `(()=>{const R=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
      const S=[...document.querySelectorAll('#stage .ro-slip:not([hidden])')],A=[...document.querySelectorAll('#stage .ro-plate,#stage .ro-sign,#stage .ro-away,#stage .ro-chip,#stage .ro-lplate,#stage .ro-bub,#stage .ro-bang,#stage .ro-eplate')].filter(a=>a.getClientRects().length);
      const ro=R(document.querySelector('#stage .ro')),F=window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks.map(d=>d.face)).filter(Boolean).map(f=>({left:ro.left+f.x,right:ro.left+f.x+f.w,top:ro.top+f.y,bottom:ro.top+f.y+f.h}));
      return S.flatMap(s=>A.filter(a=>hit(R(s),R(a))).map(a=>(s.className.split(' ')[1]||'slip')+'['+s.dataset.variant+'] covers '+(typeof a.className==='string'?a.className:'')+' "'+(a.textContent||'').trim().slice(0,24)+'"').concat(F.filter(f=>hit(R(s),f)).map(()=>(s.className.split(' ')[1]||'slip')+' covers a face')))})()`;
    /* the first draw again, on demand (review of #1477): the slips lose what a fresh element lacks (data-variant, the remembered spot and signature), a draw is made, and the
       measurement is taken in the same task, so the ~440 ms transient cannot be missed whichever way the page's own timing fell */
    const FRESH = `(()=>{for(const s of document.querySelectorAll('#stage .ro-slip')){s.removeAttribute('data-variant');s._sig=null;s._at=null;s._v=null;}
      const u=window.__durbarSimUi;u.render();u.settleNow();return ${COVERS}})()`;
    assert.deepStrictEqual(await js(FRESH), [], `${tag}: a freshly made slip, measured in the draw that made it, covers no plate, sign, chair label, chip, cue or face`);
    assert.deepStrictEqual(await js(COVERS), [], `${tag}: right after the first draw, no slip covers a plate, a sign, a chair label, a chip, a cue or a face`);
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepStrictEqual(await js(COVERS), [], `${tag}: settled, no slip covers a plate, a sign, a chair label, a chip, a cue or a face`);
  }
};
