/*
 * Spec 059 FR-170 (issue #1155): Open office's rename pencil beside a Real office plate's name, and F2 on a plate. Simulator only (DURBAR_SIM=15
 * DURBAR_SIM_FREEZE=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-plate-pencil      (builds first)
 *   PENCIL_MUTANT=anchor|f2|hover|plate   the name's anchor removed / F2 not reaching a plate / the pencil's own hover rule removed /
 *                                         the plate's anchor removed (spec 097 FR-357: an arcade cabinet's pencil) (each must fail)
 *   PENCIL_MUTANT=shown                   every pencil always shown (must fail "the pencils are hidden until a plate is hovered or focused")
 *   SHOTS_OUT=<dir>                        also saves 097-plate-pencil-<world>-<w>x<h>.png with every pencil shown (before the geometry asserts, so a failing build has its picture)
 *   UI_SUITE_XVFB=1 locally: a DISPLAY without a pointer reports hover:none, which shows every pencil (docs/agent-notes.md)
 *
 * At 1440x900 and 1280x800 in Real office, in the Photo office, the cave, the arcade and the one-room arcade, it fails (exit 1) when:
 *   - a plate of a session that may be renamed has no pencil right after it, or a pencil has no plate, or a plate is followed by another's pencil;
 *   - a pencil shows before its plate is hovered or focused, does not show on hover, or fades when the pointer reaches it (review of #1200);
 *   - the pencil's icon covers the plate's name, role, status or helper dots, or leaves the plate;
 *   - spec 097 FR-357 (bug #1427): on a plate that does not draw the name (an arcade cabinet's), the icon is not at the plate's right end (0..8 px), or the field is not over the marquee;
 *   - a click on the pencil, or F2 on the focused plate, does not open the name field over that plate's name;
 *   - Enter does not put the new name on the plate, or Esc does not keep the old one.
 *   - spec 097 FR-367 (#1571): F2 on a folder sign's ⋯ button does not open the folder name field over the sign's name, inside the sign and filling its free width,
 *     Esc does not keep the name and give the focus back to the ⋯ button, or Enter does not put the new name on the sign.
 *     Source mutants (run by hand): folderNameEl without the sign's name fails "FR-367: F2 on a folder sign's ⋯ button opens the folder name field";
 *     the edit's clip without `.ro-sign` fails "FR-367: the folder field lies over the sign's name, inside the sign, and fills its free width".
 */
const path = require('path');
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.PENCIL_MUTANT || '';
const OUT = process.env.SHOTS_OUT || ''; /* also saves 097-plate-pencil-<world>-<w>x<h>.png: every pencil shown (body.ren-show), before the geometry asserts */
const SIZES = [[1440, 900], [1280, 800]];
/* spec 097 FR-357 (bug #1427): every world draws the pencil, the arcade (cabinet plates carry no name: it is on the marquee; lounge plates do) also with one room */
const WORLDS = [['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['arcade', { worldflags: 'retro', world: 'retro' }], ['arcade-one-room', { worldflags: 'retro', world: 'retro', simrooms: 'solo' }]];
/* page helpers, installed after each load: the desk under test is window.__ppK (set through jsLiteral) */
/* name(): the desk's drawn name: the plate's, or (FR-357) the cabinet's marquee when the plate does not draw it */
const INSTALL = `window.__pp={pen:()=>document.querySelector('#stage .ren.ro-ren[data-ren="'+CSS.escape(window.__ppK)+'"]'),plate:()=>document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(window.__ppK)+'"]'),field:()=>document.querySelector('input.inl-input'),
  nameOf:()=>window.__pp.plate().querySelector('.ro-l1>b'),name:()=>{const b=window.__pp.nameOf();return b.getClientRects().length?b:document.querySelector('#stage .ro-marquee[data-for="'+CSS.escape(window.__ppK)+'"]')}};true`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const wc = () => ctx.win.webContents;
  const only = (process.env.PENCIL_WORLDS || '').split(',').filter(Boolean); /* PENCIL_WORLDS=cave,arcade: only those worlds (repeat runs of one step) */
  for (const [world, wq] of WORLDS.filter(([n]) => !only.length || only.includes(n))) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', ...wq }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    await must(`document.querySelectorAll('#stage .ren.ro-ren').length>=1`, `${tag}: the pencils`);
    if (MUTANT === 'shown') await js(`(()=>{document.querySelectorAll('#stage .ren.ro-ren').forEach(b=>b.style.setProperty('opacity','1','important'));return 1})()`); /* CSSOM: the page's CSP refuses a new <style> */
    if (MUTANT === 'plate') await js(`(()=>{document.querySelectorAll('#stage .ro-plate').forEach(p=>p.style.removeProperty('anchor-name'));return 1})()`);
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
    /* geometry: the icon beside the name, inside the plate, clear of the name, the role, the status and the helper dots; FR-357 (bug #1427): a plate that does
       not draw the name (an arcade cabinet's: the name is on its marquee) has the icon at its right end, inside it, clear of the status and the dots */
    const geo = await js(`[...document.querySelectorAll('#stage .ren.ro-ren')].map(b=>{const p=b.previousElementSibling,R=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,r:r.right,b:r.bottom}},ic=R(b.querySelector('svg')||b),
      hit=(a,c)=>a.x+0.5<c.r&&c.x+0.5<a.r&&a.y+0.5<c.b&&c.y+0.5<a.b,parts=[['name',p.querySelector('.ro-l1>b')],['role',p.querySelector('.ro-role')],['status',p.querySelector('.ro-l2')],['helpers',p.querySelector('.ro-help')]].filter(x=>x[1]&&x[1].getClientRects().length);
      const P=R(p),nb=p.querySelector('.ro-l1>b'),shown=!!nb.getClientRects().length,nm=R(nb),rd=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Math.round(v)]));
      return {k:b.dataset.ren,named:shown,covers:parts.filter(x=>hit(ic,R(x[1]))).map(x=>x[0]),out:ic.x<P.x-0.5||ic.r>P.r+0.5||ic.y<P.y-0.5||ic.b>P.b+0.5,gap:Math.round(shown?ic.x-nm.r:P.r-ic.r),plate:rd(P),icon:rd(ic),hidden:getComputedStyle(b).opacity==='0'}})`);
    /* the picture: every pencil shown; the office's request slips are hidden for it (review of #1432: at 1280x800 the arcade's limit pill docks over a plate) */
    if (OUT) { await js(`(()=>{document.body.classList.add('ren-show');document.querySelectorAll('#stage .ro-slip').forEach(e=>e.style.setProperty('visibility','hidden','important'));return 1})()`); await H.shot(path.join(OUT, `097-plate-pencil-${world}-${w}x${h}.png`), { prep: 'mouse' }); await js(`(()=>{document.body.classList.remove('ren-show');document.querySelectorAll('#stage .ro-slip').forEach(e=>e.style.removeProperty('visibility'));return 1})()`); }
    const bad = geo.filter((g) => g.covers.length || g.out || g.gap < 0 || g.gap > 8).map((g) => `${g.k}: covers ${g.covers.join(',') || '-'}, outside ${g.out}, ${g.gap}px ${g.named ? 'after the name' : 'before the plate\'s right end'} (plate ${JSON.stringify(g.plate)}, icon ${JSON.stringify(g.icon)})`);
    console.log('[097-plate-pencil]', tag, geo.filter((g) => g.named).length, 'named plates,', geo.filter((g) => !g.named).length, 'without the name; e.g.', JSON.stringify(geo.slice(0, 2).map((g) => [g.k, g.plate, g.icon])));
    assert.deepStrictEqual(bad, [], `${tag}: each pencil sits just after its name (or at the right end of a plate with no name), inside its plate, over nothing`);
    /* review of #1432 (a cave run failed this 2 of 5 times on another machine, never here in 20): the pointer is parked off the office and the hover and the
       0.12 s fade must clear first, so a pointer left on a plate by the load (or the world before) is not read as a pencil shown without hover */
    wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    const calm = `![...document.querySelectorAll('#stage .ro-plate,#stage .ren.ro-ren')].some(e=>e.matches(':hover'))&&[...document.querySelectorAll('#stage .ren.ro-ren')].every(b=>getComputedStyle(b).opacity==='0')`;
    if (!(await until(calm, 3000))) console.log('[097-plate-pencil] shown before hover', tag, JSON.stringify(await js(`[...document.querySelectorAll('#stage .ren.ro-ren')].filter(b=>getComputedStyle(b).opacity!=='0').map(b=>({k:b.dataset.ren,op:getComputedStyle(b).opacity,plateHover:b.previousElementSibling.matches(':hover'),plateFocus:b.previousElementSibling.matches(':focus-visible'),penHover:b.matches(':hover'),renShow:document.body.classList.contains('ren-show'),hoverNone:matchMedia('(hover:none)').matches}))`)));
    assert.ok(await js(calm), `${tag}: the pencils are hidden until a plate is hovered or focused (pointer parked at 1,1, no plate hovered)`);
    /* hover shows it */
    const k = (geo.find((g) => !g.named) || geo[0]).k; /* FR-357: a cabinet plate when there is one (its field goes over the marquee) */
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
    const old = await js(`window.__pp.nameOf().textContent`);
    await js(`window.__pp.pen().click()`);
    await must(`!!window.__pp.field()&&document.activeElement===window.__pp.field()`, `${tag}: a click on the pencil opens the name field`);
    const over = await js(`(()=>{const f=window.__pp.field().getBoundingClientRect(),n=window.__pp.name().getBoundingClientRect();return f.left<=n.left+1&&f.right>=n.right-1&&f.top<=n.top+1&&f.bottom>=n.bottom-1})()`);
    assert.ok(over, `${tag}: the field lies over the desk's drawn name (the plate's, or the cabinet's marquee)`);
    await js(`(()=>{const i=window.__pp.field();i.value='Not kept';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await H.key('Escape');
    await must(`!window.__pp.field()`, `${tag}: Esc closes the field`);
    assert.strictEqual(await js(`window.__pp.nameOf().textContent`), old, `${tag}: Esc keeps the old name`);
    /* F2 on the focused plate: the same field; Enter saves the new name onto the plate */
    await js(`window.__pp.plate().focus()`);
    await must(`document.activeElement===window.__pp.plate()`, `${tag}: the plate has focus`);
    await H.key('F2');
    await must(`!!window.__pp.field()&&document.activeElement===window.__pp.field()`, `${tag}: F2 on a plate opens the name field`);
    const nu = `Renamed ${w}`;
    await js(`(()=>{const i=window.__pp.field();i.value=${jsLiteral(nu)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await H.key('Return');
    await must(`!window.__pp.field()&&window.__pp.nameOf().textContent===${jsLiteral(nu)}&&window.__pp.name().textContent===${jsLiteral(nu)}`, `${tag}: Enter puts the new name on the plate`);
    await must(`(window.__pp.pen()||{}).getAttribute&&window.__pp.pen().getAttribute('aria-label')===${jsLiteral('Rename ' + nu)}`, `${tag}: the pencil's name follows`);
    /* spec 097 FR-367 (#1571): F2 on a folder sign's ⋯ button renames the folder in place (spec 059's item 4): the field over the sign's name, inside the sign */
    const fid = await js(`(()=>{const b=document.querySelector('#stage .ro-sign .ro-sb[data-foldermenu]');return b?b.dataset.foldermenu:''})()`);
    assert.ok(fid, `${tag}: a folder sign has its ⋯ button`);
    await js(`window.__fsign=()=>{const b=document.querySelector('#stage .ro-sb[data-foldermenu="'+CSS.escape(${jsLiteral(fid)})+'"]');return b&&b.closest('.ro-sign')};true`);
    const fold0 = await js(`window.__fsign().querySelector(':scope>b').textContent`);
    await js(`window.__fsign().querySelector('.ro-sb[data-foldermenu]').focus()`);
    await must(`document.activeElement&&document.activeElement.dataset.foldermenu===${jsLiteral(fid)}`, `${tag}: the sign's ⋯ button has focus`);
    await H.key('F2');
    await must(`!!document.querySelector('input.inl-input')&&document.activeElement===document.querySelector('input.inl-input')`, `${tag}: FR-367: F2 on a folder sign's ⋯ button opens the folder name field`);
    const fg = await js(`(()=>{const f=document.querySelector('input.inl-input').getBoundingClientRect(),sg=window.__fsign(),n=sg.querySelector(':scope>b').getBoundingClientRect(),s=sg.getBoundingClientRect();return {over:f.left<=n.left+1&&f.right>=Math.min(n.right,s.right)-1&&f.top<=n.bottom&&f.bottom>=n.top,inside:f.left>=s.left-1&&f.right<=s.right+1,fills:f.right>=Math.min(f.left+360,s.right-4)-1,f:[f.left,f.right,f.top,f.bottom].map(Math.round),n:[n.left,n.right,n.top,n.bottom].map(Math.round),s:[s.left,s.right,s.top,s.bottom].map(Math.round),value:document.querySelector('input.inl-input').value}})()`);
    assert.deepStrictEqual({ over: fg.over, inside: fg.inside, fills: fg.fills }, { over: true, inside: true, fills: true }, `${tag}: FR-367: the folder field lies over the sign's name, inside the sign, and fills its free width (spec 059 FR-025) (${JSON.stringify(fg)})`);
    if (OUT) await H.shot(path.join(OUT, `097-folder-f2-${world}-${w}x${h}.png`), { prep: 'mouse' });
    { /* the field follows its sign through a live repaint (spec 059 FR-023 item 5): status updates repaint the office, a window resize moves the sign */
      const OVER = `(()=>{const i=document.querySelector('input.inl-input'),sg=window.__fsign();if(!i||!sg)return false;const f=i.getBoundingClientRect(),n=sg.querySelector(':scope>b').getBoundingClientRect();return Math.abs(f.left-n.left)<=2&&f.top<=n.bottom&&f.bottom>=n.top})()`;
      const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).slice(0,4).map(a=>a.id)`);
      for (const id of ids) await js(`window.__durbarSimEmit({type:'status',status:'working',intent:'Live repaint',timestamp:Date.now(),sessionId:${jsLiteral(id)}});true`);
      await must(`${OVER}&&document.activeElement===document.querySelector('input.inl-input')`, `${tag}: FR-367: the folder field stays open over the sign's name through a live repaint`);
      const [ow, oh] = w === 1440 ? [1280, 800] : [1440, 900];
      ctx.win.setContentSize(ow, oh);
      await must(`innerWidth===${jsLiteral(ow)}`, `${tag}: the window is resized`);
      await H.settle();
      await must(OVER, `${tag}: FR-367: the folder field follows the sign after a resize moves it (${await js(`(()=>{const i=document.querySelector('input.inl-input'),sg=window.__fsign();return JSON.stringify({f:i&&[i.getBoundingClientRect().left,i.getBoundingClientRect().top],n:sg&&[sg.querySelector(':scope>b').getBoundingClientRect().left,sg.querySelector(':scope>b').getBoundingClientRect().top]})})()`)})`);
      ctx.win.setContentSize(w, h);
      await must(`innerWidth===${jsLiteral(w)}`, `${tag}: the window size is back`);
      await H.settle();
      await must(OVER, `${tag}: FR-367: and again after the size is back`);
    }
    await H.key('Escape');
    await must(`!document.querySelector('input.inl-input')&&document.activeElement&&document.activeElement.dataset.foldermenu===${jsLiteral(fid)}`, `${tag}: Esc closes the folder field and gives the focus back to the ⋯ button`);
    assert.strictEqual(await js(`window.__fsign().querySelector(':scope>b').textContent`), fold0, `${tag}: Esc keeps the folder's name`);
    await H.key('F2');
    await must(`!!document.querySelector('input.inl-input')`, `${tag}: F2 again`);
    const fnu = `Folder ${w}`;
    await js(`(()=>{const i=document.querySelector('input.inl-input');i.value=${jsLiteral(fnu)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await H.key('Return');
    await must(`!document.querySelector('input.inl-input')&&window.__fsign().querySelector(':scope>b').textContent===${jsLiteral(fnu)}`, `${tag}: FR-367: Enter puts the new folder name on the sign`);
    console.log('[097-plate-pencil]', tag, pairs.pens, 'pencils, gaps', [...new Set(geo.map((g) => g.gap))].join(','), 'px; click, hover, F2, Enter and Esc ok; folder F2', JSON.stringify(fg.f), 'in sign', JSON.stringify(fg.s));
  }
  console.log('[097-plate-pencil] ok');
  process.exitCode = 0;
};
