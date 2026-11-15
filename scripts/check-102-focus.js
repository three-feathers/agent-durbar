/*
 * Spec 102 T166 (FR-227, FR-228, FR-234): the `focus` box of a `circle` layout is drawn as one still, hidden picture box. Simulator only (no AI credits, no art).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-102-focus.js xvfb-run -a npx electron . --no-sandbox
 *
 * The fixture lives in the page only: the Photo office's numbers with `arrangement: "circle"` set after load (no shipped world names circle yet; T174), and a plain
 * colour for a picture. At 15 agents, 1440x900 and 1280x800, asserted: with `rows` there is no .ro-focus (T167); with `circle` exactly one, aria-hidden, no tabindex,
 * no text, no pointer events, nothing tabbable inside it, inside the room, clear of every folder zone and sign; a picture that fails to load moves no desk; a layout
 * with no focus box (page-only: the engine's result without `focus`) renders without a throw, draws no .ro-focus and moves nothing; back to
 * `rows` the element is gone. Prints "[102] focus PASS".  OUT=/tmp (optional) saves 102-focus-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const READ = `(()=>{const ro=document.querySelector('#stage .ro'),f=[...document.querySelectorAll('#stage .ro-focus')],r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};
    const o=ro.getBoundingClientRect(),zones=[...document.querySelectorAll('#stage .ro-zone,#stage .ro-sign')].map(r);
    return {n:f.length,world:ro.dataset.world,desks:[...document.querySelectorAll('#stage .ro-plate[data-id]')].map(e=>e.dataset.id+':'+JSON.stringify(r(e))).join('|'),
      dr:[...document.querySelectorAll('#stage .ro-plate[data-id]')].map(r),zones,room:{x:o.x,y:o.y,w:o.width,h:o.height},box:f[0]?r(f[0]):null,
      aria:f[0]?f[0].getAttribute('aria-hidden'):null,tab:f[0]?f[0].hasAttribute('tabindex'):null,text:f[0]?f[0].textContent:null,
      pe:f[0]?getComputedStyle(f[0]).pointerEvents:null,inner:f[0]?f[0].querySelectorAll('a,button,input,[tabindex]').length:null}})()`;
  const hit = (a, b) => a.x + 0.5 < b.x + b.w && b.x + 0.5 < a.x + a.w && a.y + 0.5 < b.y + b.h && b.y + 0.5 < a.y + a.h;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `focus ${w}x${h}`;
    await H.load({ w, h, ready: 'fit', focus: true, query: { officeview: 'real' } });
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
    assert.strictEqual(ids.length, 15, `${tag}: 15 main agents`);
    const rows = await js(READ);
    assert.strictEqual(rows.world, 'photo', `${tag}: the fixture is the Photo world's numbers`);
    assert.strictEqual(rows.n, 0, `${tag}: with rows no .ro-focus is drawn (T167)`);
    // the fixture: circle, set in the page only, and drawn at the next status change
    await js(`(()=>{window.DurbarRealOfficeWorlds.photo.arrangement='circle';const s=document.createElement('style');s.id='fixFocus';s.textContent='.ro[data-world="photo"] .ro-focus{background-color:#b5651d}';document.head.appendChild(s);return 0})()`);
    const poke = async (id, status) => { await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:${jsLiteral(status)},intent:'x'});0`); };
    await poke(ids[0], 'error'); await poke(ids[0], 'idle');
    assert.ok(await until(`document.querySelectorAll('#stage .ro-focus').length===1`, 8000), `${tag}: with circle one .ro-focus is drawn`);
    await settle();
    const c = await js(READ);
    assert.strictEqual(c.n, 1, `${tag}: exactly one .ro-focus`);
    assert.strictEqual(c.aria, 'true', `${tag}: the focus box is aria-hidden`);
    assert.strictEqual(c.tab, false, `${tag}: the focus box has no tabindex`);
    assert.strictEqual(c.text, '', `${tag}: the focus box holds no text`);
    assert.strictEqual(c.pe, 'none', `${tag}: the focus box takes no pointer`);
    assert.strictEqual(c.inner, 0, `${tag}: nothing tabbable inside the focus box`);
    assert.ok(c.box.w > 20 && c.box.h > 20, `${tag}: the focus box has a size: ` + JSON.stringify(c.box));
    assert.ok(c.box.x >= c.room.x - 1 && c.box.y >= c.room.y - 1 && c.box.x + c.box.w <= c.room.x + c.room.w + 1 && c.box.y + c.box.h <= c.room.y + c.room.h + 1, `${tag}: the focus box is inside the room`);
    const clash = c.zones.filter((z) => hit(c.box, z));
    assert.strictEqual(clash.length, 0, `${tag}: the focus box is clear of every zone and sign: ` + JSON.stringify(clash[0]));
    assert.strictEqual(c.dr.length, 15, `${tag}: 15 plates are drawn`);
    const cx = c.dr.map((d) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 })), b = c.box;
    assert.ok(cx.some((p) => p.x < b.x) && cx.some((p) => p.x > b.x + b.w) && cx.some((p) => p.y < b.y), `${tag}: the ring stands round the box: desks on its left, its right and above it`);
    // a picture that loads, and the same box with a picture that fails: every plate, zone, sign and the box itself is where it was (nothing in the layout reads the picture)
    const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const setPic = (url) => js(`(()=>{document.getElementById('fixFocus').textContent='.ro[data-world="photo"] .ro-focus{background-image:url(${jsLiteral(url).slice(1, -1)})}';return new Promise(res=>{const i=new Image();i.onload=i.onerror=()=>res(1);i.src=${jsLiteral(url)}})})()`);
    const frame = async (id) => { await poke(id, 'error'); await poke(id, 'idle'); await settle(); const r = await js(READ); return JSON.stringify({ dr: r.dr, zones: r.zones, box: r.box, desks: r.desks }); };
    await setPic(PIC);
    const loaded = await frame(ids[2]);
    await setPic('realoffice/worlds/photo/no-such-focus.webp');
    const failed = await frame(ids[2]);
    assert.strictEqual(failed, loaded, `${tag}: a picture that fails to load moves no plate, zone, sign or the box itself`);
    assert.strictEqual((await js(READ)).n, 1, `${tag}: the box stays when its picture fails`);
    await js(`(()=>{document.getElementById('fixFocus').textContent='.ro[data-world="photo"] .ro-focus{background-color:#b5651d}';return 0})()`);
    await settle();
    // no focus box (Changes 2026-11-14: circle omits it on a floor where it cannot hold its minimum): the engine's result without `focus`, a page-only fixture;
    // the render runs without a throw, draws no .ro-focus and moves no plate, zone or sign against the same layout with the box
    await js(`(()=>{const E=window.exports,f=window.__fixLF||E.layoutFor;window.__fixLF=f;E.layoutFor=function(){const l=f.apply(this,arguments);delete l.focus;return l};
      const R=window.DurbarRealOffice,r=window.__fixRender||R.render;window.__fixRender=r;window.__roN=0;window.__roErr='';R.render=function(){try{const l=r.apply(this,arguments);window.__roN++;return l}catch(e){window.__roErr=String(e&&e.message||e);throw e}};return 0})()`);
    const noBox = JSON.parse(await frame(ids[2]));
    assert.ok(await js(`window.__roN>0||window.__roErr!==''`), `${tag}: the office re-rendered with no focus box`);
    assert.strictEqual(await js(`window.__roErr`), '', `${tag}: a layout with no focus box renders without a throw`);
    assert.strictEqual((await js(READ)).n, 0, `${tag}: a layout with no focus box draws no .ro-focus`);
    const was = JSON.parse(loaded);
    assert.deepStrictEqual({ dr: noBox.dr, zones: noBox.zones, desks: noBox.desks }, { dr: was.dr, zones: was.zones, desks: was.desks }, `${tag}: a layout with no focus box moves no plate, zone or sign`);
    await js(`(()=>{window.exports.layoutFor=window.__fixLF;window.DurbarRealOffice.render=window.__fixRender;return 0})()`);
    await poke(ids[2], 'error'); await poke(ids[2], 'idle');
    assert.ok(await until(`document.querySelectorAll('#stage .ro-focus').length===1`, 8000), `${tag}: with the box back one .ro-focus is drawn again`);
    await settle();
    await H.shot(path.join(OUT, `102-focus-${w}x${h}.png`), { prep: 'mouse', tag: '102' });
    console.log(`[102] ${tag}: focus box ${JSON.stringify(c.box)} in room ${JSON.stringify(c.room)}`);
    // back to rows: the box is gone
    await js(`(()=>{window.DurbarRealOfficeWorlds.photo.arrangement='rows';return 0})()`);
    await poke(ids[1], 'error'); await poke(ids[1], 'idle');
    assert.ok(await until(`document.querySelectorAll('#stage .ro-focus').length===0`, 8000), `${tag}: back to rows the .ro-focus is removed`);
  }
  console.log('[102] focus PASS');
};
