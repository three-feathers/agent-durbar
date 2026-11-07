/*
 * Spec 097 FR-306..FR-311 (issue #1139, owner decision Q7 (a), 2026-11-07): a desk's helpers in the Real office, as a strip of tiles (or cards) under the
 * parent's name plate. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-helpers      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-helpers-<world>-<w>x<h>.png; a temporary folder by default)
 *   HELPERS_MUTANT=nostrip|status|move   the strips are never drawn / a status change rebuilds the tile / a status change moves a strip (each must fail)
 *
 * In the Photo office and the cave at 1440x900 and 1280x800 (15 agents, simhelpers=2) it fails (exit 1) when:
 *   - the layout scrolls, its desk face is under the SC-002 ratchet (31 px), or it did not choose the tile level at 15 agents;
 *   - a desk with helpers has no strip, or a helper of a shown parent is not a button (data-id) with its name, its status word and "helper of <parent>" in its name;
 *   - a strip is not right after its plate and pencil in the Tab order (the first Tab from the pencil lands on a helper);
 *   - a tile's text is under 10.5 px, a strip overlaps a plate, screen, sign or another strip, or leaves its slot;
 *   - a helper's status change moves any box or replaces the tile's node, or does not repaint its word;
 *   - a click on a tile does not open that helper's Sub-agent activity view;
 *   - with simhelpers=4 a strip has no "+N more" that opens all four helpers (and "Show fewer" folds them again);
 *   - the Retro arcade (no strip yet) loses its "+N" on the plate.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.HELPERS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.HELPERS_WORLDS || 'photo,cave').split(',');
const FACE_FLOOR = 31;

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-helpers-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const SIM = 'window.__durbarSimUi';
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'&&document.querySelectorAll('#stage .ro .ro-plate').length>=10`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world, extra) => ({ officeview: 'real', simfreeze: '1', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}), ...extra });
  const mutate = async () => {
    if (MUTANT === 'nostrip') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hstrip').forEach(e=>e.remove());f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
  };
  /* what the layout says and what the page drew, for each desk that has helpers */
  const read = () => js(`(()=>{const L=${SIM}.realLayout(),A=${SIM}.agents(),R=e=>{const r=e.getBoundingClientRect(),o=document.querySelector('#stage .ro').getBoundingClientRect();return {x:Math.round((r.left-o.left)*10)/10,y:Math.round((r.top-o.top)*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
    const desks=L.zones.flatMap(z=>z.desks.map(d=>({d,z})));
    return {scroll:L.scroll,face:L.faceH,level:L.helpLevel,
      desks:desks.map(({d,z})=>{const S=CSS.escape(d.id),a=A.find(x=>x.id===d.id),subs=A.filter(x=>x.parent===d.id),bx=document.querySelector('#stage .ro-hstrip[data-key], #stage .ro-chrome')&&null;
        const strip=[...document.querySelectorAll('#stage .ro-hstrip')].find(e=>e.previousElementSibling&&((e.previousElementSibling.dataset.id===d.id)||(e.previousElementSibling.dataset.ren===d.id)));
        const tiles=strip?[...strip.querySelectorAll('.ro-ht')].map(t=>({id:t.dataset.id,name:t.querySelector('.ro-hn').textContent,word:t.querySelector('.ro-hs').textContent,label:t.getAttribute('aria-label'),cls:t.className,fs:Math.min(...[...t.querySelectorAll('.ro-hn,.ro-hs')].map(e=>parseFloat(getComputedStyle(e).fontSize))),box:R(t)})):[];
        return {id:d.id,name:a&&a.name,helpers:subs.length,layoutStrip:d.strip||null,slot:d.slot,plate:d.plate,box:strip?R(strip):null,tiles,more:strip&&strip.querySelector('.ro-hmore')?strip.querySelector('.ro-hmore').textContent.trim():null,
          plateHelp:!!document.querySelector('#stage .ro-plate[data-id="'+S+'"] .ro-help')};}),
      signs:[...document.querySelectorAll('#stage .ro-sign')].map(R),plates:[...document.querySelectorAll('#stage .ro-plate')].map(R),screens:[...document.querySelectorAll('#stage .ro-screen')].map(R)};})()`);
  const hit = (a, b, t = 0.5) => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
  const shots = [];

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world, { sim: '15', simhelpers: '2' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    await mutate();
    if (MUTANT === 'nostrip') console.log('[helpers] mutant: the strips are never drawn');
    await must(`document.querySelectorAll('#stage .ro-hstrip').length>=10`, `${tag}: the helper strips`);
    let s = await read();
    assert.ok(!s.scroll, `${tag}: the office does not scroll`);
    assert.ok(s.face >= FACE_FLOOR - 1e-9, `${tag}: desk face ${s.face} px, over the SC-002 ratchet ${FACE_FLOOR}`);
    assert.strictEqual(s.level, 0, `${tag}: the tile level at 15 agents`);
    const withHelpers = s.desks.filter((d) => d.helpers > 0);
    assert.ok(withHelpers.length >= 10, `${tag}: 15 agents with helpers (${withHelpers.length})`);
    /* every helper of a shown parent: a button with its name, its status word and "helper of <parent>" */
    for (const d of withHelpers) {
      assert.ok(d.layoutStrip && d.box, `${tag}: ${d.id} has a strip (layout and page)`);
      assert.ok(!d.plateHelp, `${tag}: ${d.id}'s plate keeps no +N while its helpers are drawn`);
      assert.strictEqual(d.tiles.length + (d.more ? 1 : 0) > 0, true, `${tag}: ${d.id}: buttons in the strip`);
      assert.strictEqual(d.tiles.length, Math.min(d.helpers, d.layoutStrip.shown), `${tag}: ${d.id}: ${d.helpers} helpers, ${d.layoutStrip.shown} shown`);
      for (const t of d.tiles) {
        assert.ok(t.name && t.word, `${tag}: ${t.id} shows its name and its status word (${JSON.stringify([t.name, t.word])})`);
        assert.ok(t.label.includes('helper of ' + d.name) && t.label.includes(t.name) && t.label.includes(t.word), `${tag}: ${t.id}'s accessible name: ${t.label}`);
        assert.ok(t.fs >= 10.5 - 1e-9, `${tag}: ${t.id}'s text is ${t.fs}px, at least 10.5`);
      }
      if (d.helpers > d.layoutStrip.shown) assert.ok(/^\+\d+ more/.test(d.more || ''), `${tag}: ${d.id}: the rest is "+N more" (${d.more})`);
    }
    /* nothing covers anything: each strip is inside its slot and touches no plate, screen, sign or other strip */
    const strips = withHelpers.map((d) => d.box);
    withHelpers.forEach((d, i) => {
      const slot = { x: d.slot.x, y: d.slot.y, w: d.slot.w, h: d.slot.h };
      assert.ok(d.box.x >= slot.x - 1 && d.box.x + d.box.w <= slot.x + slot.w + 1 && d.box.y >= slot.y - 1 && d.box.y + d.box.h <= slot.y + slot.h + 1, `${tag}: ${d.id}'s strip is inside its slot ${JSON.stringify([d.box, slot])}`);
      for (const [nm, list] of [['plate', s.plates], ['screen', s.screens], ['sign', s.signs]]) for (const r of list) assert.ok(!hit(d.box, r), `${tag}: ${d.id}'s strip overlaps a ${nm} ${JSON.stringify([d.box, r])}`);
      strips.forEach((o, j) => { if (j > i) assert.ok(!hit(d.box, o), `${tag}: two strips overlap`); });
      for (const t of d.tiles) assert.ok(t.box.x >= d.box.x - 1 && t.box.x + t.box.w <= d.box.x + d.box.w + 1 && t.box.y >= d.box.y - 1 && t.box.y + t.box.h <= d.box.y + d.box.h + 1, `${tag}: a tile of ${d.id} inside its strip`);
    });
    /* Tab order: the plate, its pencil, then its first helper */
    const order = await js(`(()=>{const out=[];for(const b of document.querySelectorAll('#stage .ro-hstrip')){const p=b.previousElementSibling;out.push(!!p&&(p.matches('.ro-plate')||p.matches('.ren.ro-ren')));}return out})()`);
    assert.ok(order.length >= 10 && order.every(Boolean), `${tag}: each strip follows its plate (and pencil) in the DOM`);
    const firstId = withHelpers[0].id;
    await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(firstId)})+'"]');p.focus();return document.activeElement===p})()`);
    await must(`document.activeElement&&document.activeElement.matches('.ro-plate')`, `${tag}: the plate has focus`);
    await H.key('Tab');
    const hasPen = await js(`document.activeElement.matches('.ren.ro-ren')`);
    if (hasPen) await H.key('Tab');
    assert.ok(await js(`document.activeElement.matches('.ro-ht')&&document.activeElement.dataset.id.length>0`), `${tag}: Tab from the plate (and its pencil) lands on the first helper`);
    await js(`document.activeElement.blur()`);

    /* a status change: the tile's node stays, its word and class change, no box moves (FR-015, FR-184) */
    const target = withHelpers.find((d) => d.tiles.length) .tiles[0];
    await js(`(()=>{window.__hNode=document.querySelector('#stage .ro-ht[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');return !!window.__hNode})()`);
    const before = await read();
    const was = target.word;
    const chg = await js(`(()=>{try{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(target.id)});a.state=a.state==='waiting'?'working':'waiting';${SIM}.render();return a.state}catch(e){return 'ERR '+e.message}})()`);
    assert.ok(!String(chg).startsWith('ERR'), `${tag}: the state change: ${chg}`);
    if (MUTANT === 'status') await js(`(()=>{const n=window.__hNode;n.replaceWith(n.cloneNode(true));return 1})()`);
    if (MUTANT === 'move') await js(`(()=>{const b=document.querySelector('#stage .ro-hstrip');b.style.top=(parseFloat(b.style.top)+3)+'px';return 1})()`);
    await must(`document.querySelector('#stage .ro-ht[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"] .ro-hs').textContent!==${jsLiteral(was)}`, `${tag}: the tile repaints its status word`);
    const after = await read();
    assert.ok(await js(`window.__hNode&&window.__hNode.isConnected&&window.__hNode===document.querySelector('#stage .ro-ht[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]')`), `${tag}: the tile keeps its node on a status change`);
    const boxes = (r) => JSON.stringify(r.desks.map((d) => [d.id, d.box, d.tiles.map((t) => t.box), d.plate]));
    assert.strictEqual(boxes(after), boxes(before), `${tag}: a status change moves no strip, tile or plate`);

    /* a click on a helper opens its Sub-agent activity view (the flat office's own [data-id] handler) */
    await js(`document.querySelector('#stage .ro-ht[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]').click()`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(target.name)}`, `${tag}: a click on a helper opens its view`);
    assert.ok(await js(`/ub-agent|elper|Task|Now/i.test(document.getElementById('panel').innerText)`), `${tag}: the helper's activity view (read-only) shows`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: Esc closes the view`);
    await H.load({ w, h, query: q(world, { sim: '15', simhelpers: '2' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures again`);
    await must(`document.querySelectorAll('#stage .ro-hstrip').length>=10`, `${tag}: the strips again`);
    await H.shot(path.join(OUT, `097-helpers-${world}-${w}x${h}.png`), { prep: 'calm', tag: 'helpers', what: tag });
    shots.push(`097-helpers-${world}-${w}x${h}.png`);

    /* "+N more": with 4 helpers a desk shows a tile and "+3 more"; a click shows all four (a scrolling row) and "Show fewer" folds them again */
    await H.load({ w, h, query: q(world, { sim: '15', simhelpers: '4' }), ready: REAL, readyMs: 30000, settle: false });
    await must(`document.querySelectorAll('#stage .ro-hmore[data-more]').length>=10`, `${tag}: "+N more" buttons with 4 helpers`);
    const more = await js(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more]');return {id:m.dataset.more,text:m.textContent.trim(),label:m.getAttribute('aria-label'),exp:m.getAttribute('aria-expanded'),fs:parseFloat(getComputedStyle(m).fontSize),tiles:m.parentElement.querySelectorAll('.ro-ht').length}})()`);
    assert.ok(/^\+\d+ more/.test(more.text) && more.exp === 'false' && /more helpers of/.test(more.label) && more.fs >= 10.5, `${tag}: the more button: ${JSON.stringify(more)}`);
    const L4 = await read(); assert.ok(!L4.scroll && L4.face >= FACE_FLOOR - 1e-9, `${tag}: 4 helpers each: no scroll, face ${L4.face}`);
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(more.id)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(more.id)})+'"]');return m&&m.getAttribute('aria-expanded')==='true'&&m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-ht').length===4})()`, `${tag}: "+N more" opens all 4 helpers`);
    const open = await read();
    assert.strictEqual(boxes0(open), boxes0(L4), `${tag}: opening a strip moves no desk box`);
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(more.id)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(more.id)})+'"]');return m&&m.getAttribute('aria-expanded')==='false'&&!m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-ht').length===${more.tiles}})()`, `${tag}: "Show fewer" folds them`);
  }
  function boxes0(r) { return JSON.stringify(r.desks.map((d) => [d.id, d.box, d.plate])); }

  /* the Retro arcade has no strip yet (FR-308's last step): its plates keep "+N" and dots */
  for (const [w, h] of SIZES) {
    await H.load({ w, h, query: q('retro', { sim: '15', simhelpers: '2' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `retro ${w}x${h}: the pictures`);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-hstrip').length`), 0, `retro ${w}x${h}: no strips in the arcade`);
    assert.ok(await js(`document.querySelectorAll('#stage .ro-plate .ro-help').length>=10`), `retro ${w}x${h}: the plates keep their +N and dots`);
  }
  console.log('[097-helpers] ok', shots.join(' '));
  process.exitCode = 0;
};
