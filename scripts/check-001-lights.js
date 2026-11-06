/*
 * Spec 001 FR-230, FR-231 (owner, 2026-11-05 16:46 UTC; FR-232 folded into FR-231): Open office's screens are tinted by status, as Real office's (spec 097 FR-236); no
 * separate lights; the card glow and the waiting halo are gone. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits; every
 * wait is an until().
 *
 *   npm run check:ui -- --only check-001-lights      (builds first)
 *   LIGHTS_MUTANT=glow|unread|ink   the card glow back / green over amber / the glyph ink rule gone (each must fail)
 *
 * At 1440x900 and 1280x800, in each scene kit (office; pixel through the Retro theme; crew through the Cheeky characters), with a desk set to
 * error, one at its spending limit, one done with an unread reply and an unread one that asks for permission, it fails (exit 1) when:
 *   - a desk's data-tint is not what its state says (the precedence): needs you amber, the limit or a coffee break orange, an error or failing
 *     red, a done desk with an unread reply green (never over a need), else none;
 *   - a tinted screen is not filled with its tint, or an untinted screen is;
 *   - a tinted screen's glyph strokes or fills are not the light ink (the wait card an outline, the done tick on no disc);
 *   - a desk card has a glow (::after box-shadow), a scene draws halo-waiting, or any old light part (bar, pool, call light) exists;
 *   - the screen animates or transitions.
 */
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.LIGHTS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const KITS = [['office', null], ['pixel', `(window.THEME.setTheme('retro'),true)`], ['crew', `(window.THEME.setCharacters('cheeky'),true)`]];

/* in the page: every main desk card's state, its tint, its screen's fill and its glyph colours */
const READ = `(()=>{const col=v=>{const i=document.createElement('i');i.style.color=v;document.body.appendChild(i);const c=getComputedStyle(i).color;i.remove();return c;};
  const T={amber:col('var(--tint-amber)'),orange:col('var(--tint-orange)'),red:col('var(--tint-red)'),green:col('var(--tint-green)')},ink=col('var(--tint-ink)');
  const out=[];
  for(const d of document.querySelectorAll('#stage .desk.card[data-id]')){
    const sc=d.querySelector('svg.scene');if(!sc||!d.getClientRects().length)continue;
    const scr=sc.querySelector('.scr'),pill=(d.querySelector('.pill,.stl')||{}).textContent||'';
    const want=d.matches('.is-waiting')?(/Limit reached|Coffee break/.test(pill)?'orange':'amber'):d.matches('.is-error,.is-failing')?'red':(d.matches('.is-unread')&&d.dataset.state==='done')?'green':'none';
    const g=[...sc.querySelectorAll('.scr-c *')].filter(e=>e.getClientRects().length);
    const strokes=g.filter(e=>e.hasAttribute('stroke')).map(e=>getComputedStyle(e).stroke),fills=g.filter(e=>e.hasAttribute('fill')&&e.getAttribute('fill')!=='none'&&getComputedStyle(e).fill!=='none').map(e=>getComputedStyle(e).fill);
    out.push({id:d.dataset.id,tint:d.dataset.tint,want,pill:pill.trim(),fill:scr?getComputedStyle(scr).fill:'',tintCol:T[d.dataset.tint]||'',tints:Object.values(T),ink,
      offInk:d.dataset.tint!=='none'?[...strokes,...fills].filter(c=>c!==ink).length:0,
      cardGlow:getComputedStyle(d,'::after').boxShadow,moving:scr?(getComputedStyle(scr).animationName!=='none'||parseFloat(getComputedStyle(scr).transitionDuration)>0||scr.getAnimations().length):0});
  }
  return {desks:out,haloWaiting:document.querySelectorAll('#stage .halo-waiting').length,oldParts:document.querySelectorAll('#stage .scene .lt').length};})()`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 10000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const E = (id, e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(id)}},${jsLiteral(e)}))`);
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const seen = { amber: 0, orange: 0, red: 0, green: 0, both: 0 };
  for (const [kit, prep] of KITS) for (const [w, h] of SIZES) {
    const tag = `${kit} ${w}x${h}`;
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await H.load({ w, h, query: { sim: '15' }, ready: `document.querySelectorAll('#stage .desk.card[data-id]').length>=8`, readyMs: 30000, settle: false });
    if (prep) { await js(prep); await must(`window.THEME.sceneKit()===${jsLiteral(kit)}`, `${tag}: the ${kit} kit`); }
    if (MUTANT === 'glow') await js(`(()=>{const s=document.createElement('style');s.textContent='.desk.is-waiting::after{content:"";position:absolute;inset:0;box-shadow:0 0 6px 2px orange}';document.head.appendChild(s);return 1})()`);
    if (MUTANT === 'ink') await js(`(()=>{for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules}catch{continue}for(let i=rs.length-1;i>=0;i--)if(rs[i].selectorText&&rs[i].selectorText.includes('.scr-c'))sh.deleteRule(i);}return 1})()`);
    /* red, orange, green and an unread desk that asks for permission, on desks that were off and at their desk */
    const free = await js(`[...document.querySelectorAll('#stage .desk.card[data-id]')].filter(d=>d.dataset.tint==='none'&&!d.classList.contains('is-away')).map(d=>d.dataset.id)`);
    assert.ok(free.length >= 4, `${tag}: four desks with their light off (${free.length})`);
    const [r, o, g, gw] = free.slice(-4);
    await E(r, { type: 'status', status: 'error', intent: 'Failed' });
    await E(o, { type: 'status', status: 'working', intent: 'Working' });
    await E(o, { type: 'limit', phase: 'exhausted', requestId: 'lights-' + o, maxAiCredits: 5, usedAiCredits: 5 });
    for (const id of [g, gw]) { await E(id, { type: 'status', status: 'working', intent: 'Working' }); await E(id, { type: 'output', final: true, text: 'All done.' }); await E(id, { type: 'status', status: 'idle' }); }
    await must(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(gw)})+'"]').classList.contains('is-unread')`, `${tag}: an unread reply`);
    await E(gw, { type: 'status', status: 'needs-permission', intent: 'Waiting for permission: run ls' });
    await must(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(gw)})+'"]').dataset.state==='waiting'`, `${tag}: the unread desk asks for permission`);
    if (MUTANT === 'unread') await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(gw)})+'"]');d.dataset.tint='green';return 1})()`);
    await must(`!!document.querySelector('#stage .desk[data-tint="red"]')&&!!document.querySelector('#stage .desk[data-tint="orange"]')&&!!document.querySelector('#stage .desk[data-tint="green"]')`, `${tag}: red, orange and green desks`);
    const res = await js(READ);
    const P = [];
    if (res.haloWaiting) P.push(`${res.haloWaiting} halo-waiting drawn (FR-230)`);
    if (res.oldParts) P.push(`${res.oldParts} old light parts (bar, pool, call light) drawn`);
    for (const d of res.desks) {
      if (d.tint !== d.want) P.push(`${d.id} "${d.pill}": data-tint ${d.tint}, its state says ${d.want}`);
      if (d.tint !== 'none' && d.fill !== d.tintCol) P.push(`${d.id}: a ${d.tint} screen filled ${d.fill}, not ${d.tintCol}`);
      if (d.tint === 'none' && d.tints.includes(d.fill)) P.push(`${d.id}: an untinted screen filled with a tint (${d.fill})`);
      if (d.offInk) P.push(`${d.id}: ${d.offInk} glyph colours on the ${d.tint} screen are not the light ink`);
      if (d.cardGlow !== 'none') P.push(`${d.id}: the card glows (${d.cardGlow}), FR-230`);
      if (d.moving) P.push(`${d.id}: the screen animates or transitions`);
      if (d.tint in seen) seen[d.tint]++;
    }
    if (res.desks.some((d) => d.id === gw && d.tint === 'amber')) seen.both++;
    console.log('[001-lights]', tag, res.desks.length, 'desks', JSON.stringify(res.desks.reduce((a, d) => ((a[d.tint] = (a[d.tint] || 0) + 1), a), {})));
    assert.deepStrictEqual(P, [], `${tag}: the screen tints (spec 001 FR-230, FR-231)`);
  }
  for (const k of ['amber', 'orange', 'red', 'green', 'both']) assert.ok(seen[k] > 0, `the run saw ${k} (${JSON.stringify(seen)}): a check that met no case proves nothing`);
  console.log('[001-lights] ok', JSON.stringify(seen));
  process.exitCode = 0;
};
