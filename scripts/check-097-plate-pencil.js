/*
 * Spec 059 FR-170 (issue #1155): Open office's rename pencil beside a Real office plate's name, and F2 on a plate. Simulator only (DURBAR_SIM=15
 * DURBAR_SIM_FREEZE=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-plate-pencil      (builds first)
 *   PENCIL_MUTANT=anchor|f2|hover   the name's anchor removed / F2 not reaching a plate / the pencil's own hover rule removed (each must fail)
 *
 * At 1440x900 and 1280x800 in Real office it fails (exit 1) when:
 *   - a plate of a session that may be renamed has no pencil right after it, or a pencil has no plate, or a plate is followed by another's pencil;
 *   - a pencil shows before its plate is hovered or focused, does not show on hover, or fades when the pointer reaches it (review of #1200);
 *   - the pencil's icon covers the plate's name, role or helper dots, or leaves the plate;
 *   - a click on the pencil, or F2 on the focused plate, does not open the name field over that plate's name;
 *   - Enter does not put the new name on the plate, or Esc does not keep the old one.
 */
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.PENCIL_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
/* page helpers, installed after each load: the desk under test is window.__ppK (set through jsLiteral) */
const INSTALL = `window.__pp={pen:()=>document.querySelector('#stage .ren.ro-ren[data-ren="'+CSS.escape(window.__ppK)+'"]'),plate:()=>document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(window.__ppK)+'"]'),field:()=>document.querySelector('input.inl-input')};true`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const wc = () => ctx.win.webContents;
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    await must(`document.querySelectorAll('#stage .ren.ro-ren').length>=1`, `${tag}: the pencils`);
    if (MUTANT === 'anchor') await js(`(()=>{document.querySelectorAll('#stage .ro-plate .ro-l1>b').forEach(b=>b.style.removeProperty('anchor-name'));return 1})()`);
    if (MUTANT === 'hover') await js(`(()=>{for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules}catch{continue}for(let i=rs.length-1;i>=0;i--)if(rs[i].selectorText&&rs[i].selectorText.includes('.ren.ro-ren:is(:hover'))sh.deleteRule(i);}return 1})()`);
    if (MUTANT === 'f2') await js(`(()=>{document.addEventListener('keydown',e=>{if(e.key==='F2'&&e.target.closest&&e.target.closest('.ro-plate'))e.stopImmediatePropagation();},true);return 1})()`);
    /* every renamable main session's plate has its pencil right after it; nothing else has one (the app's own rule, canRenameSession) */
    const pairs = await js(`(()=>{const ren=new Set(window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id));
      const plates=[...document.querySelectorAll('#stage .ro-plate[data-id]')],pens=[...document.querySelectorAll('#stage .ren.ro-ren')];
      return {plates:plates.length,pens:pens.length,missing:plates.filter(p=>ren.has(p.dataset.id)&&!(p.nextElementSibling&&p.nextElementSibling.matches('.ren[data-ren]')&&p.nextElementSibling.dataset.ren===p.dataset.id)).map(p=>p.dataset.id),
        orphans:pens.filter(b=>!(b.previousElementSibling&&b.previousElementSibling.dataset.id===b.dataset.ren)).map(b=>b.dataset.ren)};})()`);
    assert.ok(pairs.pens >= 10, `${tag}: pencils on the plates (${JSON.stringify(pairs)})`);
    assert.deepStrictEqual({ missing: pairs.missing, orphans: pairs.orphans }, { missing: [], orphans: [] }, `${tag}: each renamable plate is followed by its own pencil`);
    /* geometry: the icon beside the name, inside the plate, clear of the name, the role and the helper dots */
    const geo = await js(`[...document.querySelectorAll('#stage .ren.ro-ren')].map(b=>{const p=b.previousElementSibling,R=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,r:r.right,b:r.bottom}},ic=R(b.querySelector('svg')||b),
      hit=(a,c)=>a.x+0.5<c.r&&c.x+0.5<a.r&&a.y+0.5<c.b&&c.y+0.5<a.b,parts=[['name',p.querySelector('.ro-l1>b')],['role',p.querySelector('.ro-role')],['helpers',p.querySelector('.ro-help')]].filter(x=>x[1]&&x[1].getClientRects().length);
      const P=R(p),nm=R(p.querySelector('.ro-l1>b'));return {k:b.dataset.ren,covers:parts.filter(x=>hit(ic,R(x[1]))).map(x=>x[0]),out:ic.x<P.x-0.5||ic.r>P.r+0.5||ic.y<P.y-0.5||ic.b>P.b+0.5,gap:Math.round(ic.x-nm.r),hidden:getComputedStyle(b).opacity==='0'}})`);
    const bad = geo.filter((g) => g.covers.length || g.out || g.gap < 0 || g.gap > 8).map((g) => `${g.k}: covers ${g.covers.join(',') || '-'}, outside ${g.out}, ${g.gap}px after the name`);
    assert.deepStrictEqual(bad, [], `${tag}: each pencil sits just after its name, inside its plate, over nothing`);
    assert.ok(geo.every((g) => g.hidden), `${tag}: the pencils are hidden until a plate is hovered or focused`);
    /* hover shows it */
    const k = geo[0].k;
    await js(INSTALL); await js(`window.__ppK=${jsLiteral(k)};true`);
    const c = await js(`(()=>{const r=window.__pp.plate().getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height-6)}})()`);
    wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
    await must(`getComputedStyle(window.__pp.pen()).opacity==='1'`, `${tag}: the pencil shows on the plate's hover`);
    /* onto the pencil itself (review of #1200): the plate is no longer :hover, the pencil must stay shown under the pointer, and a real click on it edits */
    const pc = await js(`(()=>{const r=window.__pp.pen().getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    wc().sendInputEvent({ type: 'mouseMove', x: pc.x, y: pc.y });
    await must(`window.__pp.pen().matches(':hover')`, `${tag}: the pointer is on the pencil`);
    await must(`getComputedStyle(window.__pp.pen()).opacity==='1'&&!window.__pp.plate().matches(':hover')`, `${tag}: the pencil stays shown with the pointer on it (the plate no longer hovered)`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    assert.strictEqual(await js(`getComputedStyle(window.__pp.pen()).opacity`), '1', `${tag}: the pencil stays shown with the pointer on it, two frames later`);
    wc().sendInputEvent({ type: 'mouseDown', x: pc.x, y: pc.y, button: 'left', clickCount: 1 });
    wc().sendInputEvent({ type: 'mouseUp', x: pc.x, y: pc.y, button: 'left', clickCount: 1 });
    await must(`!!window.__pp.field()`, `${tag}: a real click on the hovered pencil opens the name field`);
    await H.key('Escape');
    await must(`!window.__pp.field()`, `${tag}: Esc closes it`);
    wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    /* the pencil: the field over the name; Esc keeps the old name */
    const old = await js(`window.__pp.plate().querySelector('.ro-l1>b').textContent`);
    await js(`window.__pp.pen().click()`);
    await must(`!!window.__pp.field()&&document.activeElement===window.__pp.field()`, `${tag}: a click on the pencil opens the name field`);
    const over = await js(`(()=>{const f=window.__pp.field().getBoundingClientRect(),n=window.__pp.plate().querySelector('.ro-l1>b').getBoundingClientRect();return f.left<=n.left+1&&f.right>=n.right-1&&f.top<=n.top+1&&f.bottom>=n.bottom-1})()`);
    assert.ok(over, `${tag}: the field lies over the plate's name`);
    await js(`(()=>{const i=window.__pp.field();i.value='Not kept';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await H.key('Escape');
    await must(`!window.__pp.field()`, `${tag}: Esc closes the field`);
    assert.strictEqual(await js(`window.__pp.plate().querySelector('.ro-l1>b').textContent`), old, `${tag}: Esc keeps the old name`);
    /* F2 on the focused plate: the same field; Enter saves the new name onto the plate */
    await js(`window.__pp.plate().focus()`);
    await must(`document.activeElement===window.__pp.plate()`, `${tag}: the plate has focus`);
    await H.key('F2');
    await must(`!!window.__pp.field()&&document.activeElement===window.__pp.field()`, `${tag}: F2 on a plate opens the name field`);
    const nu = `Renamed ${w}`;
    await js(`(()=>{const i=window.__pp.field();i.value=${jsLiteral(nu)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await H.key('Return');
    await must(`!window.__pp.field()&&window.__pp.plate().querySelector('.ro-l1>b').textContent===${jsLiteral(nu)}`, `${tag}: Enter puts the new name on the plate`);
    await must(`(window.__pp.pen()||{}).getAttribute&&window.__pp.pen().getAttribute('aria-label')===${jsLiteral('Rename ' + nu)}`, `${tag}: the pencil's name follows`);
    console.log('[097-plate-pencil]', tag, pairs.pens, 'pencils, gaps', [...new Set(geo.map((g) => g.gap))].join(','), 'px; click, hover, F2, Enter and Esc ok');
  }
  console.log('[097-plate-pencil] ok');
  process.exitCode = 0;
};
