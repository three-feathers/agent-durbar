/*
 * Spec 102 T171 (FR-220, review of the stacked PR, Changes 2026-11-14 third entry): the arcade cabinet paints a picture from a world's `monitor` entry only
 * when `monitorProblem` exists and accepts it (fail closed), and a refused entry takes an earlier picture off the reused cabinet. Simulator only, no AI credits.
 *
 *   npm run build
 *   DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-102-cabinet-guard.js npx electron . --no-sandbox
 *
 * The fixture lives in the page only: the arcade's `monitor` entries are changed after load and a status change re-renders the same, keyed cabinets.
 * At 15 agents, 1440x900 and 1280x800, it fails (exit 1) when: the good entries do not paint every cabinet (picture and data-body); a hostile entry
 * (`../x.webp`, `cells` 0, a slash, a quote, a parenthesis, a semicolon, an upper-case name, `__proto__`) on every monitor kind leaves a picture,
 * its size or position, or a data-body on a cabinet, re-creates a cabinet, throws, or moves a desk, plate, zone or sign against the good case; with
 * `monitorProblem` taken off the page's exports a hostile or a good entry paints anything. Prints "[102] cabinet guard PASS".
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const CABS = `[...document.querySelectorAll('#stage .ro-cab')].map(e=>({k:e.dataset.for,bi:e.style.backgroundImage,bs:e.style.backgroundSize,bp:e.style.backgroundPosition,body:e.dataset.body===undefined?null:e.dataset.body,cbi:getComputedStyle(e).backgroundImage,same:e.__fixG===1}))`;
  const POS = `(()=>{const r=e=>{const b=e.getBoundingClientRect();return [e.className.split(' ')[0],e.dataset.for||e.dataset.id||e.dataset.folder||'',Math.round(b.x*10)/10,Math.round(b.y*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10].join(',')};
    return JSON.stringify([...document.querySelectorAll('#stage .ro-desk,#stage .ro-plate[data-id],#stage .ro-zone,#stage .ro-sign')].map(r))})()`;
  const PAINTED = `(()=>{const c=[...document.querySelectorAll('#stage .ro-cab')];return c.length>0&&c.every(e=>/monitor[a-z-]*\\.webp/.test(e.style.backgroundImage)&&e.dataset.body!==undefined)})()`;
  const moved = (now, was) => { const a = JSON.parse(now), b = JSON.parse(was); return a.length !== b.length ? ['count ' + a.length + ' vs ' + b.length] : a.map((x, i) => (x === b[i] ? null : b[i] + ' -> ' + x)).filter(Boolean); };
  const HOSTILE = [['dot dot', { file: '../x.webp' }], ['cells 0', { cells: 0 }], ['slash', { file: 'a/b.webp' }], ['quote', { file: 'x".webp' }], ['parenthesis', { file: 'x).webp' }],
    ['semicolon', { file: 'x;.webp' }], ['upper case', { file: 'X.webp' }], ['__proto__', { file: '__proto__' }]];
  /* every monitor kind (big, small, narrow) gets the patch, so whichever a cabinet uses is hostile; `null` puts the shipped entries back */
  const patch = (p) => js(`(()=>{const M=window.DurbarRealOfficeWorlds.retro.monitor;if(!window.__fixMon)window.__fixMon=JSON.parse(JSON.stringify(M));const o=window.__fixMon,p=JSON.parse(${jsLiteral(JSON.stringify(p))});
    for(const k of Object.keys(o)){for(const f of ['file','cells','bodies'])M[k][f]=o[k][f];if(p)for(const f of Object.keys(p))M[k][f]=p[f];}return 0})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `cabinet ${w}x${h}`;
    await H.load({ w, h, ready: `!!document.querySelector('#stage .ro .ro-cab')`, query: { officeview: 'real', worldflags: 'retro', world: 'retro' } });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is drawn`);
    const id = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent)[0].id`);
    /* a counted render: a throw inside it is kept, so "nothing moved" cannot pass on a render that never ran */
    await js(`(()=>{const R=window.DurbarRealOffice,r=window.__fixRender||R.render;window.__fixRender=r;window.__roN=0;window.__roErr='';R.render=function(){try{const l=r.apply(this,arguments);window.__roN++;return l}catch(e){window.__roErr=String(e&&e.message||e);throw e}};return 0})()`);
    const rerender = async () => {
      const n = await js(`window.__roN`);
      await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'error',intent:'x'});0`);
      await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'idle',intent:'x'});0`);
      assert.ok(await until(`window.__roErr!==''||window.__roN>${n}`, 8000), `${tag}: a status change re-renders the office`);
      await settle();
    };
    await rerender(); await rerender(); /* twice: the folder sign's count chip for the poked statuses has come and gone once before the good case is read */
    assert.ok(await until(PAINTED, 8000), `${tag}: the good entries paint every cabinet (picture and data-body)`);
    const good = await js(POS), goodCabs = await js(CABS);
    assert.ok(goodCabs.length >= 10, `${tag}: at least 10 cabinets at 15 agents (the rest are away or in the lounge): ${goodCabs.length}`);
    await js(`(()=>{for(const e of document.querySelectorAll('#stage .ro-cab'))e.__fixG=1;return 0})()`);
    const refused = async (label) => {
      assert.strictEqual(await js(`window.__roErr`), '', `${tag} ${label}: the render does not throw`);
      const cabs = await js(CABS);
      assert.strictEqual(cabs.length, goodCabs.length, `${tag} ${label}: the same cabinets are drawn`);
      assert.deepStrictEqual(cabs.filter((c) => !c.same).map((c) => c.k), [], `${tag} ${label}: the cabinets are the reused elements`);
      assert.deepStrictEqual(cabs.filter((c) => c.bi || /url\(/.test(c.cbi)).map((c) => c.k + ' ' + c.bi + ' ' + c.cbi), [], `${tag} ${label}: no cabinet keeps or gets a picture`);
      assert.deepStrictEqual(cabs.filter((c) => c.bs || c.bp).map((c) => c.k + ' ' + c.bs + ' ' + c.bp), [], `${tag} ${label}: no cabinet keeps a picture size or position`);
      assert.deepStrictEqual(cabs.filter((c) => c.body !== null).map((c) => c.k + ' ' + c.body), [], `${tag} ${label}: no cabinet keeps a data-body`);
      assert.deepStrictEqual(moved(await js(POS), good), [], `${tag} ${label}: no desk, plate, zone or sign moved against the good case`);
    };
    const back = async (label) => {
      await patch(null); await rerender();
      assert.ok(await until(PAINTED, 8000), `${tag} ${label}: the shipped entries paint again`);
      assert.deepStrictEqual(moved(await js(POS), good), [], `${tag} ${label}: back to the good case, nothing moved`);
    };
    for (const [label, p] of HOSTILE) {
      await patch(p); await rerender();
      await refused(label);
      await back(label);
    }
    /* fail closed: the validator missing from the page's exports paints no picture, hostile or good */
    await js(`(()=>{const E=window.exports;window.__fixMP=E.monitorProblem;delete E.monitorProblem;return 0})()`);
    await patch({ file: '../x.webp' }); await rerender();
    await refused('with no validator, a hostile entry (fail closed)');
    await patch(null); await rerender();
    await refused('with no validator, even a good entry (fail closed)');
    await js(`(()=>{window.exports.monitorProblem=window.__fixMP;return 0})()`);
    await back('validator back');
    console.log(`[102] ${tag}: ${goodCabs.length} cabinets, ${HOSTILE.length} hostile entries and the missing validator refused, nothing moved`);
  }
  console.log('[102] cabinet guard PASS');
};
