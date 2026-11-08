/*
 * Spec 097 FR-306..FR-311 (issue #1139, owner decision "1265 1", 2026-11-08): a desk's helpers in the Real office as small head figures with a status dot,
 * under the parent's name plate. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-helpers      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-helpers-<world>-<w>x<h>.png; a temporary folder by default)
 *   HELPERS_WORLDS=photo,cave,retro   the worlds (default: all three; the arcade measured to fit one row of heads under each cabinet's plate, spec 097 FR-306 as built)
 *   HELPERS_MUTANT=nostrip|status|nametile|overlap   no strip is drawn / a status change rebuilds the head's node / a name tile is drawn / a strip lies over its plate (each must fail)
 *
 * In the Photo office, the cave (both sizes) and the Retro arcade (1440x900; at 1280x800 it keeps "+N", see above) at 1440x900 and 1280x800 (15 agents, simhelpers=6, and 5 more helpers on one desk through the event path, so it overflows) it fails (exit 1) when:
 *   - the layout scrolls or its desk face is under the SC-002 ratchet (31 px);
 *   - a desk with helpers has no strip, or a shown helper is not a button (data-id) with a picture, a status dot, and its name and "helper of <parent>" in its accessible name;
 *   - a head's face is under 24 px, the dot's colour is not the status token's, or a visible name tile is drawn anywhere (the name is only in the accessible name and tooltip);
 *   - the strip is not right after its plate and pencil in the Tab order, a text is under 10.5 px, a strip or a head overlaps a plate, screen, sign, another strip or leaves its slot;
 *   - a helper's status change adds or removes any node under the office (statusNodes), replaces the head's node, repaints no dot, or moves any box;
 *   - a click on a head does not open that helper's Sub-agent activity view, or "+K" does not open all the helpers (and "Fewer" fold them);
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.HELPERS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.HELPERS_WORLDS || 'photo,cave,retro').split(',');
const FACE_FLOOR = 31; /* SC-002's ratchet, desk face */
const HEAD_FACE_MIN = 24; /* a helper's face, FR-307 */
const EXTRA = 5; /* helpers added to the first desk through the event path: 6 + 5 = 11, more than any strip holds */

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-helpers-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const SIM = 'window.__durbarSimUi';
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'&&document.querySelectorAll('#stage .ro .ro-plate').length>=10`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world, extra) => ({ officeview: 'real', simfreeze: '1', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}), ...extra });
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const mutate = async () => {
    if (MUTANT === 'nostrip') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hstrip').forEach(e=>e.remove());f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
    if (MUTANT === 'nametile') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hd').forEach(b=>{if(!b.querySelector('.ro-hn')){const n=document.createElement('span');n.className='ro-hn';n.style.cssText='position:absolute;left:34px;top:0;font-size:11px;white-space:nowrap';n.textContent=(b.getAttribute('title')||'').split(' · ')[0];b.appendChild(n);}});f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
    if (MUTANT === 'overlap') await js(`(()=>{const f=()=>document.querySelectorAll('#stage .ro-hstrip').forEach(b=>{b.style.transform='translateY(-28px)'});f();new MutationObserver(f).observe(document.getElementById('stage'),{childList:true,subtree:true});return 1})()`);
  };
  /* what the layout says and what the page drew, for each desk */
  const read = () => js(`(()=>{const L=window.__durbarSimUi.realLayout(),A=window.__durbarSimUi.agents(),o=document.querySelector('#stage .ro').getBoundingClientRect();
    const R=e=>{const r=e.getBoundingClientRect();return {x:Math.round((r.left-o.left)*10)/10,y:Math.round((r.top-o.top)*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10}};
    const desks=L.zones.flatMap(z=>z.desks);
    return {scroll:L.scroll,face:L.faceH,rows:L.helpRows,
      desks:desks.map(d=>{const a=A.find(x=>x.id===d.id),subs=A.filter(x=>x.parent===d.id);
        const plate=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"]');let e=plate&&plate.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;const strip=e&&e.matches('.ro-hstrip')?e:null;
        const heads=strip?[...strip.querySelectorAll('.ro-hd')].map(t=>{const dot=t.querySelector('.dot'),im=t.querySelector('img'),cs=getComputedStyle(dot);return {id:t.dataset.id,label:t.getAttribute('aria-label'),title:t.getAttribute('title'),cls:t.className,dotCls:dot.className,dotBg:cs.backgroundColor,dotBorder:cs.borderTopColor,pic:!!im&&im.complete&&im.naturalWidth>0,text:t.textContent.trim(),box:R(t),pbox:R(t.querySelector('.ro-hp'))}}):[];
        const more=strip&&strip.querySelector('.ro-hmore');
        return {id:d.id,name:a&&a.name,helpers:subs.length,subNames:subs.map(s=>s.name),layoutStrip:d.strip||null,slot:d.slot,plate:R(plate),box:strip?R(strip):null,heads,
          more:more?{text:more.textContent.trim(),fs:parseFloat(getComputedStyle(more).fontSize),label:more.getAttribute('aria-label'),exp:more.getAttribute('aria-expanded'),box:R(more)}:null,
          plateHelp:!!(plate&&plate.querySelector('.ro-help')),tiles:strip?strip.querySelectorAll('.ro-ht,.ro-hn,.ro-hs').length:0};}),
      signs:[...document.querySelectorAll('#stage .ro-sign')].map(R),plates:[...document.querySelectorAll('#stage .ro-plate')].map(R),screens:[...document.querySelectorAll('#stage .ro-screen')].map(R)};})()`);
  /* the status tokens a dot must show: a probe element in the page takes the colour from the token itself */
  const tokens = () => js(`(()=>{const probe=(v)=>{const s=document.createElement('span');s.style.cssText='position:absolute;visibility:hidden;background:var('+v+');border-color:var('+v+');border-style:solid;border-width:1px';document.body.appendChild(s);const c=getComputedStyle(s).backgroundColor;s.remove();return c};return {working:probe('--c-working'),thinking:probe('--c-thinking'),waiting:probe('--c-waiting'),error:probe('--c-error'),done:probe('--c-done'),idle:probe('--c-idle')}})()`);
  const hit = (a, b, t = 0.5) => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
  const shots = [];

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world, { sim: '15', simhelpers: '6' }), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    if (world === 'retro' && w < 1440) { /* measured: one row of heads under every cabinet's plate fits the hall at 1440x900 but not at 1280x800 (spec 097 FR-308 as built): the plates keep "+N" and dots */
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-hstrip').length`), 0, `${tag}: no strips in the arcade at this size`);
      assert.ok(await js(`document.querySelectorAll('#stage .ro-plate .ro-help').length>=10`), `${tag}: the plates keep their +N and dots`);
      assert.strictEqual((await read()).rows, 0, `${tag}: helpRows 0`);
      continue;
    }
    /* one desk gets more helpers than any strip holds (the event path, as an agent app reports a helper) */
    const first = await js(`window.__durbarSimUi.realLayout().zones[0].desks[0].id`);
    for (let i = 0; i < EXTRA; i++) await emit({ sessionId: first, type: 'subagent', subagentId: 'drv-h-' + i, name: 'Extra helper ' + (i + 1), phase: 'started', task: 'Check ' + (i + 1), agentName: 'explore' });
    await must(`${SIM}.agents().filter(x=>x.parent===${jsLiteral(first)}).length>=${jsLiteral(6 + EXTRA)}`, tag + ': the extra helpers on the first desk');
    await must(`document.querySelectorAll('#stage .ro-hstrip').length>=10`, `${tag}: the helper strips`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hstrip .ro-hmore[data-more="'+CSS.escape(${jsLiteral(first)})+'"]');return !!m&&m.parentElement.querySelectorAll('.ro-hd').length+Number(m.textContent.slice(1))===${jsLiteral(6 + EXTRA)}})()`, tag + ': the first desks +K after the extra helpers');
    await must(PICS, `${tag}: the head pictures`);
    await mutate();
    if (MUTANT) console.log('[helpers] mutant:', MUTANT);
    const TOK = await tokens();
    let s = await read();
    assert.ok(!s.scroll, `${tag}: the office does not scroll`);
    assert.ok(s.face >= FACE_FLOOR - 1e-9, `${tag}: desk face ${s.face} px, over the SC-002 ratchet ${FACE_FLOOR}`);
    assert.ok(s.rows === 1 || s.rows === 2, `${tag}: strips drawn at 15 agents (rows ${s.rows})`);
    const withHelpers = s.desks.filter((d) => d.helpers > 0);
    assert.ok(withHelpers.length >= 10, `${tag}: 15 agents with helpers (${withHelpers.length})`);
    let overflowSeen = 0, dotsChecked = 0;
    for (const d of withHelpers) {
      assert.ok(d.layoutStrip && d.box, `${tag}: ${d.id} has a strip (layout and page)`);
      assert.ok(!d.plateHelp, `${tag}: ${d.id}'s plate keeps no +N while its helpers are drawn`);
      assert.strictEqual(d.heads.length, Math.min(d.helpers, d.layoutStrip.shown), `${tag}: ${d.id}: ${d.helpers} helpers, ${d.layoutStrip.shown} shown`);
      assert.strictEqual(d.tiles, 0, `${tag}: ${d.id}: no name tile drawn in the strip`);
      for (const t of d.heads) {
        assert.ok(t.pic || /^[A-Z0-9]$/.test(t.text), `${tag}: ${t.id} shows a picture (or its initial)`);
        assert.ok(t.pic, `${tag}: ${t.id}: the head's picture loaded`);
        assert.ok(d.subNames.some((n) => t.label.includes(n)) && t.label.includes('helper of ' + d.name), `${tag}: ${t.id}'s accessible name has its name and its parent: ${t.label}`);
        assert.ok(d.subNames.some((n) => t.title.includes(n)), `${tag}: ${t.id}'s tooltip has its name: ${t.title}`);
        /* no visible name: the button's text is empty or its one initial (when a picture is missing) */
        assert.ok(t.text.length <= 1, `${tag}: ${t.id} draws text "${t.text}" (the name is never drawn)`);
        assert.ok(t.pbox.w * 0.8 >= HEAD_FACE_MIN - 1e-9, `${tag}: ${t.id}'s face is ${t.pbox.w * 0.8} px, at least ${HEAD_FACE_MIN}`);
        const state = (/st-(\w+)/.exec(t.cls) || [])[1], cls = (t.dotCls.match(/dot (\w+)/) || [])[1];
        assert.ok(cls, `${tag}: ${t.id} has a status dot (${t.dotCls})`);
        const want = cls === 'idle' ? null : TOK[cls === 'failing' || cls === 'retrying' ? 'waiting' : cls === 'compacting' ? 'thinking' : cls];
        if (want) assert.strictEqual(t.dotBg, want, `${tag}: ${t.id}'s dot colour ${t.dotBg} is the --c-${cls} token ${want} (state ${state})`);
        else assert.strictEqual(t.dotBorder, TOK.idle, `${tag}: ${t.id}'s idle dot edge is the --c-idle token`);
        dotsChecked++;
      }
      if (d.helpers > d.layoutStrip.shown) { overflowSeen++; assert.ok(d.more && /^\+\d+$/.test(d.more.text) && Number(d.more.text) === d.helpers - d.layoutStrip.shown && d.more.fs >= 10.5 && /more helpers of/.test(d.more.label), `${tag}: ${d.id}: the rest is "+K" (${JSON.stringify([d.more, d.helpers, d.layoutStrip, d.heads.length])})`); }
      else assert.ok(!d.more, `${tag}: ${d.id}: no "+K" when all fit`);
    }
    assert.ok(overflowSeen >= 1 && dotsChecked >= 20, `${tag}: an overflow "+K" was seen (${overflowSeen}) and ${dotsChecked} dots were checked`);
    /* the name is drawn nowhere in the strips: no element of the office shows a helper's name as visible text */
    const names = await js(`(()=>[...new Set(${SIM}.agents().filter(x=>x.parent).map(x=>x.name))])()`);
    const drawn = await js(`(()=>{const ns=${jsLiteral(names)},out=[];for(const e of document.querySelectorAll('#stage .ro-hstrip *')){const t=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();if(t&&ns.some(n=>t.includes(n)))out.push(t)}return out})()`);
    assert.deepStrictEqual(drawn, [], `${tag}: a helper's name is drawn as text`);
    /* nothing covers anything: each strip, head and "+K" is inside its slot and touches no plate, screen, sign or other strip */
    const strips = withHelpers.map((d) => d.box);
    withHelpers.forEach((d, i) => {
      const slot = d.slot;
      assert.ok(d.box.x >= slot.x - 1 && d.box.x + d.box.w <= slot.x + slot.w + 1 && d.box.y >= slot.y - 1 && d.box.y + d.box.h <= slot.y + slot.h + 1, `${tag}: ${d.id}'s strip is inside its slot ${JSON.stringify([d.box, slot])}`);
      for (const [nm, list] of [['plate', s.plates], ['screen', s.screens], ['sign', s.signs]]) for (const r of list) assert.ok(!hit(d.box, r), `${tag}: ${d.id}'s strip overlaps a ${nm} ${JSON.stringify([d.box, r])}`);
      strips.forEach((o, j) => { if (j > i) assert.ok(!hit(d.box, o), `${tag}: two strips overlap`); });
      const parts = d.heads.map((t) => t.box).concat(d.more ? [d.more.box] : []);
      parts.forEach((p, a) => { assert.ok(p.x >= d.box.x - 3.5 && p.x + p.w <= d.box.x + d.box.w + 3.5 && p.y >= d.box.y - 3.5 && p.y + p.h <= d.box.y + d.box.h + 3.5, `${tag}: a head of ${d.id} inside its strip ${JSON.stringify([p, d.box])}`); parts.forEach((o, b) => { if (b > a) assert.ok(!hit(p, o, 0.5), `${tag}: two heads of ${d.id} overlap`); }); });
    });
    /* Tab order: the plate, its pencil, then its first head, on to "+K" */
    const order = await js(`(()=>{const out=[];for(const b of document.querySelectorAll('#stage .ro-hstrip')){const p=b.previousElementSibling;out.push(!!p&&(p.matches('.ro-plate')||p.matches('.ren.ro-ren')));}return out})()`);
    assert.ok(order.length >= 10 && order.every(Boolean), `${tag}: each strip follows its plate (and pencil) in the DOM`);
    const firstD = s.desks.find((d) => d.id === first);
    await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(first)})+'"]');p.focus();return document.activeElement===p})()`);
    await must(`document.activeElement&&document.activeElement.matches('.ro-plate')`, `${tag}: the plate has focus`);
    await H.key('Tab');
    if (await js(`document.activeElement.matches('.ren.ro-ren')`)) await H.key('Tab');
    assert.ok(await js(`document.activeElement.matches('.ro-hd')&&document.activeElement.dataset.id.length>0`), `${tag}: Tab from the plate (and its pencil) lands on the first head`);
    for (let i = 0; i < firstD.heads.length; i++) await H.key('Tab');
    assert.ok(await js(`document.activeElement.matches('.ro-hmore[data-more]')`), `${tag}: the Tab after the last head is "+K"`);
    await H.key('Tab');
    assert.ok(await js(`!document.activeElement.closest('.ro-hstrip')`), `${tag}: then Tab leaves the strip for the next desk`);
    await js(`document.activeElement.blur()`);

    /* a status update: no node under the office is added or removed (statusNodes), the head keeps its node, its dot's class changes, no box moves (FR-015, FR-184) */
    const target = withHelpers.filter((d) => d.id !== first).flatMap((d) => d.heads).find((t) => /\bworking\b/.test(t.dotCls)); /* a running helper (a finished or failed one takes no status) */
    assert.ok(target, `${tag}: a running helper`);
    const was = target.dotCls;
    await must(`${SIM}.visitsSettled()&&${SIM}.settleNow()`, `${tag}: the office settled before the status updates`);
    await js(`(()=>{window.__hNode=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');window.__aN=0;window.__aL=[];window.__aO=new MutationObserver(ms=>{for(const m of ms){if(m.target.closest&&m.target.closest('.ro-slip'))continue;for(const x of [...m.addedNodes,...m.removedNodes])if(x.nodeType===1){window.__aN++;if(window.__aL.length<6)window.__aL.push((x.className&&x.className.baseVal===undefined?x.className:x.tagName)+'')}}});window.__aO.observe(document.querySelector('#stage .ro'),{childList:true,subtree:true});return !!window.__hNode})()`);
    const before = await read();
    const seq = ['thinking', 'working', 'thinking', 'working'];
    for (const st of seq) {
      assert.ok(await js(`(()=>{try{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(target.id)});a.state=${jsLiteral(st)};${SIM}.render();return true}catch(e){return false}})()`), `${tag}: the state change ${st}`);
      if (MUTANT === 'status') await js(`(()=>{const n=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]');if(n)n.replaceWith(n.cloneNode(true));return 1})()`);
      await must(`(()=>{const d=document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"] .dot');return !!d&&d.className.split(' ').includes(${jsLiteral(st)})})()`, tag + ': the head dot shows ' + st);
    }
    const after = await read();
    const nodes = await js(`(window.__aO.disconnect(),window.__aN)`);
    assert.strictEqual(nodes, 0, tag + ': statusNodes: ' + nodes + ' elements added or removed under the office over ' + seq.length + ' helper status updates');
    assert.ok(await js(`window.__hNode&&window.__hNode.isConnected&&window.__hNode===document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]')`), `${tag}: the head keeps its node on a status update`);
    const boxes = (r) => JSON.stringify(r.desks.map((d) => [d.id, d.box, d.heads.map((t) => t.box), d.plate]));
    assert.strictEqual(boxes(after), boxes(before), `${tag}: a status update moves no strip, head or plate`);

    /* a click on a head opens that helper's Sub-agent activity view (the flat office's own [data-id] handler) */
    const tname = await js(`${SIM}.agents().find(x=>x.id===${jsLiteral(target.id)}).name`);
    await js(`document.querySelector('#stage .ro-hd[data-id="'+CSS.escape(${jsLiteral(target.id)})+'"]').click()`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(tname)}`, `${tag}: a click on a head opens its view`);
    assert.ok(await js(`/ub-agent|elper|Task|Now/i.test(document.getElementById('panel').innerText)`), `${tag}: the helper's activity view (read-only) shows`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: Esc closes the view`);

    /* "+K": a click shows all the helpers in one scrolling row, at the same height, no desk moves; "Fewer" folds them again */
    const mid = firstD.id, mb = (await read());
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]');return m&&m.getAttribute('aria-expanded')==='true'&&m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-hd').length===${jsLiteral(6 + EXTRA)}})()`, `${tag}: "+K" opens all ${jsLiteral(6 + EXTRA)} helpers`);
    const open = await read();
    const b0 = (r) => JSON.stringify(r.desks.map((d) => [d.id, d.box, d.plate]));
    assert.strictEqual(b0(open), b0(mb), `${tag}: opening a strip moves no desk box`);
    await js(`document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]').click()`);
    await must(`(()=>{const m=document.querySelector('#stage .ro-hmore[data-more="'+CSS.escape(${jsLiteral(mid)})+'"]');return m&&m.getAttribute('aria-expanded')==='false'&&!m.parentElement.classList.contains('open')&&m.parentElement.querySelectorAll('.ro-hd').length===${jsLiteral(firstD.heads.length)}})()`, `${tag}: "Fewer" folds them`);
    await js(`document.activeElement&&document.activeElement.blur();0`);
    await H.shot(path.join(OUT, `097-helpers-${world}-${w}x${h}.png`), { prep: 'calm', tag: 'helpers', what: tag });
    shots.push(`097-helpers-${world}-${w}x${h}.png`);
  }

  console.log('[097-helpers] ok', shots.join(' '));
  process.exitCode = 0;
};
