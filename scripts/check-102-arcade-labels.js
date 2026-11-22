/*
 * Spec 102 T445, T446 (issues #2009, #2010; Changes 2026-11-22, eleventh entry): the arcade's back-wall labels and its message box. Simulator only
 * (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no account, no AI credits; every wait is an until().
 *
 *   npm run build
 *   node scripts/ui-suite.js --only check-102-arcade-labels        (xvfb-run -a ... on Linux)
 *
 * At 1440x900 and 1280x800, 15 agents, in the arcade (worldflags=retro&world=retro) it fails when:
 *   - "no neon under a label": with the labels, people, fixtures and lights hidden, a name chip or a place plate stands on lit wall pixels (a sign drawn in
 *     the wall picture). Read from the page's own pixels, so there is no table of sign places to go stale;
 *   - "no plate on a head" / "no chip on a head": a place plate or a name chip touches a visitor's head box. The head box is written out here from the
 *     standing picture's drawn box (the middle half of its width, its top 30 %), not asked of the code;
 *   - "plate text": a plate's text is under 10.5 px, or a place plate's word is cut while a plate-sized free place exists on its rows;
 *   - "one outline": in an open chat with the message box focused, the textarea draws a ring or halo of its own as well as the box around it, or the box
 *     draws none (focus must stay shown, by exactly one ring).
 * ARCADE_LABELS_MUTANT=sign  paints a neon sign on the wall in the label rows       (dies at "no neon under a label")
 *                     heads  moves every plate over the first visitor's head        (dies at "no plate on a head")
 *                     halo   gives the textarea its focus halo back                 (dies at "one outline")
 * Screenshots: <SHOTS_OUT>/102-arcade-labels-<w>x<h>.png and ...-chat-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-102-labels-'));
const MUTANT = process.env.ARCADE_LABELS_MUTANT || '';
const ONLY = process.env.LABELS_ONLY || ''; /* `labels`, `heads` (the labels without the wall's pixels) or `chat`: one part, to see each defect red on its own (the suite runs all) */
const SIZES = [[1440, 900], [1280, 800]];
const hit = (a, b) => a.x0 + 0.5 < b.x1 && b.x0 + 0.5 < a.x1 && a.y0 + 0.5 < b.y1 && b.y0 + 0.5 < a.y1;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const BOXES = `(()=>{const q=(s)=>[...document.querySelectorAll(s)],b=(e)=>{const r=e.getBoundingClientRect();return {x0:r.left,y0:r.top,x1:r.right,y1:r.bottom}};
    const lob=document.querySelector('#stage .ro-lobby');
    return {lobby:b(lob),
      chips:q('#stage .ro-chip').map(e=>({n:e.dataset.name,...b(e)})),
      plates:q('#stage .ro-lplate').map(e=>({n:e.dataset.place,fs:parseFloat(getComputedStyle(e).fontSize),cut:(e.firstElementChild||e).scrollWidth>(e.firstElementChild||e).clientWidth+0.5,...b(e)})),
      heads:q('#stage .ro-visitor,#stage .ro-visitor2').filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(),w=r.width,h=r.height;return {n:e.dataset.for||'',x0:r.left+0.25*w,x1:r.right-0.25*w,y0:r.top,y1:r.top+0.30*h}})}})()`;
  /* lit wall pixels (a neon sign) under a rectangle, from the page's own pixels with everything but the wall hidden */
  const wallPixels = async (w, h, rects, lobby) => {
    await js(`(()=>{let s=document.getElementById('lblHide');if(!s){s=document.createElement('style');s.id='lblHide';document.head.appendChild(s)}
      s.textContent='#stage .ro-art>*:not(.ro-lobby),#stage .ro-chrome,#stage .ro-lights,#stage .ro-amb{visibility:hidden!important}';return 1})()`);
    await ctx.sleep(200);
    const img = await H.wc().capturePage(), sz = img.getSize(), bm = img.toBitmap();
    if (process.env.LABELS_DUMP) require('fs').writeFileSync(process.env.LABELS_DUMP + `-${w}.png`, img.toPNG());
    await js(`document.getElementById('lblHide').textContent=''`);
    const sx = sz.width / w, sy = sz.height / h;
    const lit = (x, y) => { const i = (y * sz.width + x) * 4, B = bm[i], G = bm[i + 1], R = bm[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B); return mx > 140 && mx - mn > 50; };
    /* a row that is lit across much of the wall is the rim or the floor line (a tube along the whole room), not a sign: it is skipped */
    const line = new Set();
    for (let y = Math.floor(lobby.y0 * sy); y < Math.ceil(lobby.y1 * sy); y++) { let n = 0; const x0 = Math.floor(lobby.x0 * sx), x1 = Math.ceil(lobby.x1 * sx); for (let x = x0; x < x1; x++) if (lit(x, y)) n++; if (n > 0.3 * (x1 - x0)) line.add(y); }
    assert.ok(line.size >= 1 && line.size <= 12, `the wall's rim lines are found (${line.size} rows)`);
    return rects.map((r) => {
      let n = 0;
      for (let y = Math.floor(r.y0 * sy); y < Math.ceil(r.y1 * sy); y++) for (let x = Math.floor(r.x0 * sx); x < Math.ceil(r.x1 * sx); x++) {
        if (!line.has(y) && lit(x, y)) n++; /* lit and saturated: neon; the brick is dark navy */
      }
      return n;
    });
  };
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} arcade`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10&&document.querySelectorAll('#stage .ro-visitor').length>=4`, readyMs: 30000, settle: true });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    if (MUTANT === 'sign') await js(`(()=>{const l=document.querySelector('#stage .ro-lobby'),r=l.getBoundingClientRect(),d=document.createElement('div');d.id='mutSign';d.style.cssText='position:absolute;left:0;top:0;width:100%;height:60px;background:linear-gradient(90deg,transparent 0,transparent 8%,#ffd400 8%,#ffd400 9%,transparent 9%,transparent 20%,#33ff66 20%,#33ff66 21%,transparent 21%,transparent 35%,#ff66aa 35%,#ff66aa 36%,transparent 36%,transparent 50%,#3399ff 50%,#3399ff 51%,transparent 51%,transparent 65%,#ffd400 65%,#ffd400 66%,transparent 66%,transparent 80%,#33ff66 80%,#33ff66 81%,transparent 81%);pointer-events:none';l.appendChild(d);return 1})()`);
    if (MUTANT === 'heads') await js(`(()=>{const v=document.querySelector('#stage .ro-visitor'),vr=v.getBoundingClientRect(),cr=document.querySelector('#stage .ro-chrome').getBoundingClientRect();for(const p of document.querySelectorAll('#stage .ro-lplate')){p.style.left=(vr.left+0.3*vr.width-cr.left)+'px';p.style.top=(vr.top-cr.top)+'px'}return 1})()`);
    await H.settle();
    if (ONLY !== 'chat') {
    const g = await js(BOXES);
    assert.ok(g.plates.length >= 8 && g.heads.length >= 4 && g.chips.length >= 4, `${tag}: a lobby with plates, chips and heads is drawn: ${g.plates.length} plates, ${g.chips.length} chips, ${g.heads.length} heads`);
    if (process.env.LABELS_DEBUG) console.log('[102-labels] DEBUG', JSON.stringify({ plates: g.plates.map((p) => [p.n, Math.round(p.x0), Math.round(p.y0), Math.round(p.x1), Math.round(p.y1)]), heads: g.heads.map((q) => [q.n, Math.round(q.x0), Math.round(q.y0), Math.round(q.x1), Math.round(q.y1)]), world: await js(`document.querySelector('#stage .ro').dataset.world+' '+location.href`) }));
    const labels = [...g.plates.map((p) => ({ ...p, kind: 'plate' })), ...g.chips.map((c) => ({ ...c, kind: 'chip', n: c.n }))];
    const neon = ONLY === 'heads' ? labels.map(() => 0) : await wallPixels(w, h, labels, g.lobby);
    labels.forEach((l, i) => assert.strictEqual(neon[i], 0, `${tag}: no neon under a label: the ${l.kind} ${l.n} stands on ${neon[i]} lit wall pixels (a sign in the wall picture) at ${Math.round(l.x0)},${Math.round(l.y0)}`));
    for (const p of g.plates) for (const hd of g.heads) assert.ok(!hit(p, hd), `${tag}: no plate on a head: the plate ${p.n} (${Math.round(p.x0)}..${Math.round(p.x1)} x ${Math.round(p.y0)}..${Math.round(p.y1)}) touches the head of ${hd.n} (${Math.round(hd.x0)}..${Math.round(hd.x1)} x ${Math.round(hd.y0)}..${Math.round(hd.y1)})`);
    for (const c of g.chips) for (const hd of g.heads) assert.ok(!hit(c, hd), `${tag}: no chip on a head: the chip ${c.n} touches the head of ${hd.n}`);
    for (const p of g.plates) assert.ok(p.fs >= 10.5, `${tag}: plate text at least 10.5 px: ${p.n} is ${p.fs}`);
    g.plates.forEach((p, i) => { for (const q of g.plates.slice(i + 1)) assert.ok(!hit(p, q), `${tag}: plates ${p.n} and ${q.n} overlap`); });
    const cut = g.plates.filter((p) => p.cut).map((p) => p.n);
    assert.strictEqual(cut.length, 0, `${tag}: plate text: no place plate's word is cut at 15 agents: ${cut.join(', ')}`);
    await H.shot(path.join(OUT, `102-arcade-labels-${w}x${h}.png`), { prep: 'calm' });
    console.log(`[102-labels] ${tag}: ${g.plates.length} plates, ${g.chips.length} chips, ${g.heads.length} heads: none on a sign or a head`);

    }
    if (ONLY === 'labels' || ONLY === 'heads') continue;
    /* the open chat's message box: one outline */
    const id = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent)[0].id`);
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
    await must(`document.body.classList.contains('panel-open')&&!!document.querySelector('.inbox textarea')`, 'the chat and its message box');
    await H.settle();
    if (MUTANT === 'halo') await js(`(()=>{const s=document.createElement('style');s.textContent='html[data-world="retro"] .inbox textarea:focus-visible{box-shadow:0 0 0 5px #ff004d!important}';document.head.appendChild(s);return 1})()`);
    await js(`document.querySelector('.inbox textarea').focus();0`);
    await must(`document.activeElement===document.querySelector('.inbox textarea')&&document.querySelector('.inbox textarea').matches(':focus-visible')`, 'the message box focused');
    const rings = await js(`(()=>{const ring=(e)=>{const s=getComputedStyle(e);return (s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0?'outline '+s.outlineWidth+' '+s.outlineColor:'')+(s.boxShadow!=='none'?' shadow '+s.boxShadow:'')};
      return {ta:ring(document.querySelector('.inbox textarea')).trim(),box:ring(document.querySelector('.inbox')).trim()}})()`);
    assert.strictEqual(rings.ta, '', `${tag}: one outline: the textarea draws no ring or halo of its own: ${rings.ta}`);
    assert.notStrictEqual(rings.box, '', `${tag}: one outline: the message box shows the focus ring`);
    await H.shot(path.join(OUT, `102-arcade-labels-chat-${w}x${h}.png`), { prep: 'none' });
    console.log(`[102-labels] ${tag}: the message box has one outline (${rings.box})`);
  }
  console.log('[102-labels] all checks passed');
};
