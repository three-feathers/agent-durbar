/*
 * Spec 097 FR-338 (bug #1384, delta 2026-11-09) and FR-356 (bug #1392): a desk's helper strip is one row of heads; when the helpers do not fit, the last place is "+K", and no head
 * is ever laid out on a second line. Simulator only (DURBAR_SIM=15, a frozen simulator), no AI credits; every wait is an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-helper-row      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-helper-row-<world>-<scene>-<w>x<h>.jpg, JPEG quality 60, and 097-helper-row-desk.png, a crop of the 7-helper desk
 *                     in the Photo office's lounge scene at 1440x900; a temporary folder by default)
 *   HELPERROW_WORLDS=photo,cave,retro   the worlds (default: all three)
 *   HELPERROW_SHOTS=photo-lounge,desk   take only the pictures whose name has one of these parts (the spec's linked ones: SHOTS_OUT=docs/screenshots retakes them); default: all
 *   HELPERROW_MUTANT=tworows   the page lays every strip out as a grid of 3 columns, so its heads take a second line (it must fail)
 *   Mutant on the source (by hand): put back FR-308's two-row level in `realLayout` (src/shared/realoffice-layout.ts), `npm run build`, run this driver: it fails in the
 *   Photo office's lounge scene at 1440x900, where the strip took two rows and the 6-helper desk showed 5 heads on its first line and 1 on a second.
 *
 * In the Photo office, the cave and the Retro arcade, at 1440x900 and 1280x800, in the simulator's default scene and in the release clip's lounge scene (two agents
 * finish and are read, so they move to the lounge row and the desks get more height), with 6 and 7 helpers added (the subagent event, as an agent app reports one) to
 * two desks that had none, it fails (exit 1) when, for any desk with helpers:
 *   - the layout's strip has more than one row, or its height is not one row's (helpH(1) - 2);
 *   - its heads and "+K" are not all on one line (the same top, within 1 px), or one leaves its strip box or the window;
 *   - the heads plus K are not the helpers, the heads are not the places across (cols) less one when there is a "+K", "+K" is not the strip's last child, or its text is under 10.5 px;
 *   - the strip overlaps a plate, a sign (the folder's header), a screen or another strip;
 *   - where the room draws no strip (the plate's fallback, FR-308), the plate has no "+N".
 * Spec 097 FR-356 (bug #1392), before and after the helpers are added, for every folder sign: it leaves the window or its room (the arcade's aisle sign may run into
 * the free aisle, FR-256), its + or menu is not whole inside it (cut by the sign's edge), a count or the cost is cut, its name shows under 18 px, text is under
 * 10.5 px, or it overlaps another sign. Mutant on the source: undo FR-356 in `realLayout` (no `signShort` for a narrow room), `npm run build`: the cave's lounge
 * scene at 1280x800 fails on "its ⋯ button whole inside the sign" (the one-desk room "blog", sign 170 px, the menu at 1238..1258 past its right edge 1252).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.HELPERROW_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = (process.env.HELPERROW_WORLDS || 'photo,cave,retro').split(',');
const SHOTS = (process.env.HELPERROW_SHOTS || '').split(',').filter(Boolean);
const wanted = (file) => !SHOTS.length || SHOTS.some((k) => file.includes(k));
const ADD = [6, 7]; /* the bug's 6 helpers, and one more */
const HEAD = 30, GAP = 4, PAD = 4; /* src/shared/realoffice-layout.ts: HEAD, HELP_GAP, HELP_PAD */

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-helper-row-'));
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const SIM = 'window.__durbarSimUi';
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'&&document.querySelectorAll('#stage .ro .ro-plate').length>=10`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (world) => ({ officeview: 'real', simfreeze: '1', sim: '15', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}) });
  const emit = (e) => js(`void window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}));0`);
  const mutate = () => (MUTANT === 'tworows' ? js(`(()=>{if(!document.getElementById('mutRow')){const s=document.createElement('style');s.id='mutRow';s.textContent='#stage .ro-hstrip{grid-template-columns:repeat(3,var(--ro-head))!important;height:auto!important}';document.head.append(s)}return 1})()`) : null);
  /* the release clip's lounge scene (scripts/release-video.js, scene 'lounge'): two agents with no helpers, in rooms where others keep working, finish and are read */
  const lounge = async (tag) => {
    await must(`${SIM}.visitsSettled()`, `${tag}: no visit about to start or end`);
    const pick = await js(`(()=>{const A=${SIM}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit,out=[];
      const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id));
      const cand=M.filter(a=>['idle','working','thinking'].includes(a.state)&&home.has(a.id)&&!a.paused&&!a.limit&&!A.some(h=>h.parent===a.id)).sort((x,y)=>(x.state==='idle'?0:1)-(y.state==='idle'?0:1));
      for(const a of cand){if(out.length===2)break;const next=out.concat(a.id);if(next.every(id=>{const r=A.find(x=>x.id===id).room;return M.some(o=>o.room===r&&!next.includes(o.id)&&!fin(o))}))out.push(a.id);}
      return out})()`);
    assert.strictEqual(pick.length, 2, `${tag}: two agents to finish: ${JSON.stringify(pick)}`);
    await js(`(()=>{for(const id of ${jsLiteral(pick)}){const a=${SIM}.agents().find(x=>x.id===id);a.state='done';a.lastOutput=a.lastOutput||'Finished the change and ran the tests.';a.lastEventAt=Date.now();${SIM}.unread.mark(id);}${SIM}.crew.renderAll();return 1})()`);
    await js(`(()=>{const s=${SIM}.agents().find(x=>x.id===${jsLiteral(pick[1])});s.lastEventAt=Date.now()-34*60000;for(const id of ${jsLiteral(pick)})${SIM}.unread.read(id);${SIM}.crew.renderAll();return 1})()`);
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row once read`);
  };
  /* what the layout says and what the page drew, for every desk with helpers */
  const read = () => js(`(()=>{const L=${SIM}.realLayout(),A=${SIM}.agents(),vw=innerWidth,vh=innerHeight;
    const R=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}};
    const desks=L.zones.flatMap(z=>z.desks).map(d=>{const n=A.filter(x=>x.parent===d.id).length;if(!n)return null;
      const pl=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(d.id)+'"]');let e=pl&&pl.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;const st=e&&e.matches('.ro-hstrip')?e:null;
      const kids=st?[...st.children].map(c=>({more:c.matches('.ro-hmore'),text:c.textContent.trim(),fs:parseFloat(getComputedStyle(c).fontSize),box:R(c)})):[];
      return {id:d.id,n,lay:d.strip||null,box:st?R(st):null,plate:pl?R(pl):null,kids,help:!!(pl&&pl.querySelector('.ro-help')),helpText:pl&&pl.querySelector('.ro-help')?pl.querySelector('.ro-help').textContent.trim():''}}).filter(Boolean);
    return {rows:L.helpRows,scroll:L.scroll,lounge:L.lounge?L.lounge.desks.length:0,vw,vh,desks,
      plates:[...document.querySelectorAll('#stage .ro-plate')].map(e=>({id:e.dataset.id,...R(e)})),signs:[...document.querySelectorAll('#stage .ro-sign')].map(R),screens:[...document.querySelectorAll('#stage .ro-screen')].map(e=>({id:e.dataset.for,...R(e)}))}})()`);
  /* spec 097 FR-356 (bug #1392): every folder sign whole: inside its room and the window, its + and menu whole inside the sign (none cut by its edge), the name at least
     its 3 letters, no text under 10.5 px. (The arcade's aisle sign may run past its room into the free aisle, FR-256: there only the window, the other signs and the buttons.) Read from the page (the drawn rects), so a sign wider than its room or a button cut by the sign's overflow fails. */
  const signs = () => js(`(()=>{const R=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}};
    const o=R(document.querySelector('#stage .ro')),Z=${SIM}.realLayout().zones; /* the layout's rooms are in the office's own coordinates */
    return [...document.querySelectorAll('#stage .ro-sign')].map(sg=>{const b=sg.querySelector('b'),r=R(sg),cx=r.x+r.w/2-o.x,cy=r.y-o.y,zone=Z.find(z=>z.id===sg.dataset.folder&&cx>=z.box.x&&cx<=z.box.x+z.box.w&&cy>=z.box.y-4&&cy<=z.box.y+z.box.h)||Z.find(z=>z.id===sg.dataset.folder&&z.part===1); /* a folder in parts has a sign per part: its own room */
      return {folder:sg.dataset.folder,text:sg.textContent.replace(/\\s+/g,' ').trim(),part:zone?zone.part:1,short:sg.classList.contains('short'),aisles:!!document.querySelector('#stage .ro[data-world="retro"]'),box:r,zone:zone?{x:zone.box.x+o.x,y:zone.box.y+o.y,w:zone.box.w,h:zone.box.h}:null,name:b?R(b):null,nameFull:b?b.scrollWidth<=b.clientWidth+0.5:false,
        btns:[...sg.querySelectorAll('.ro-sb')].map(x=>({t:x.textContent,box:R(x)})),cnts:[...sg.querySelectorAll('.ro-cnt,.ro-cost')].filter(x=>getComputedStyle(x).display!=='none').map(x=>({t:x.textContent,box:R(x),fs:parseFloat(getComputedStyle(x).fontSize)})),
        fs:[b,...sg.querySelectorAll('.ro-path,.ro-cnt,.ro-cost')].filter(x=>x&&getComputedStyle(x).display!=='none').map(x=>parseFloat(getComputedStyle(x).fontSize))}})})()`);
  let signsChecked = 0;
  const checkSigns = async (tag) => {
    const list = await signs();
    console.log('[helper-row] signs', tag, JSON.stringify(list.map((g) => [(g.short ? 'SHORT ' : '') + g.text, Math.round(g.box.x), Math.round(g.box.w), g.zone ? Math.round(g.zone.x + g.zone.w) : null, g.btns.map((b) => b.t + '@' + Math.round(b.box.x) + '+' + Math.round(b.box.w)).join(' ')])));
    for (const g of list) {
      const L = `${tag}: FR-356 the sign of ${g.folder} (${JSON.stringify(g.text)})`, inside = (a, b, t = 0.5) => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
      check(inside(g.box, { x: 0, y: 0, w: s0.vw, h: s0.vh }), `${L}: inside the window ${JSON.stringify(g.box)}`);
      if (g.zone && !g.aisles) check(g.box.x >= g.zone.x - 0.5 && g.box.x + g.box.w <= g.zone.x + g.zone.w + 0.5, `${L}: inside its room ${JSON.stringify([g.box, g.zone])}`);
      check(g.btns.length === (g.part > 1 ? 0 : 2), `${L}: + and the menu on the first part's sign only (${g.btns.length})`);
      for (const b of g.btns) check(b.box.w >= 19.5 && inside(b.box, g.box), `${L}: its ${b.t} button whole inside the sign ${JSON.stringify([b.box, g.box])}`);
      for (const c of g.cnts) check(inside(c.box, g.box), `${L}: ${JSON.stringify(c.t)} whole inside the sign ${JSON.stringify([c.box, g.box])}`);
      check(g.name && g.name.w >= 18, `${L}: the name shows at least its first letters (${g.name && g.name.w} px)`);
      check(g.fs.every((f) => f >= 10.5), `${L}: text at least 10.5 px ${JSON.stringify(g.fs)}`);
      for (const o of list) if (o !== g) check(!hit(g.box, o.box), `${L}: overlaps the sign of ${o.folder}`);
      signsChecked++;
    }
  };
  let s0 = { vw: 0, vh: 0 };
  const hit = (a, b, t = 0.5) => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
  const shots = [];
  const fails = [];
  /* every case runs (all worlds, sizes and scenes, so a failing run still measures and pictures each); the failures are reported together at the end */
  const check = (ok, msg) => { if (!ok) { fails.push(msg); console.log('[helper-row] FAIL', msg); } return ok; };
  let stripsChecked = 0, fallbacks = 0, overflowSeen = 0, wrapsLooked = 0;

  for (const world of WORLDS) for (const [w, h] of SIZES) for (const scene of ['default', 'lounge']) {
    const tag = `${world} ${scene} ${w}x${h}`;
    await H.load({ w, h, query: q(world), ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`);
    if (scene === 'lounge') await lounge(tag);
    s0 = { vw: w, vh: h };
    await checkSigns(tag + ' (no helpers)');
    /* 6 and 7 helpers on two desks at home that had none (not in the lounge, not away) */
    const ids = await js(`(()=>{const A=${SIM}.agents();return ${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away&&!A.some(x=>x.parent===d.id)).slice(0,2).map(d=>d.id)})()`);
    assert.strictEqual(ids.length, 2, `${tag}: two desks without helpers`);
    for (const [k, id] of ids.entries()) for (let i = 0; i < ADD[k]; i++) await emit({ sessionId: id, type: 'subagent', subagentId: `row-${k}-${i}`, name: `Row helper ${k + 1}.${i + 1}`, phase: 'started', task: 'Check part ' + (i + 1), agentName: 'explore' });
    await must(`${ids.map((id, k) => `${SIM}.agents().filter(x=>x.parent===${jsLiteral(id)}).length===${ADD[k]}`).join('&&')}`, `${tag}: the added helpers`);
    await must(`(()=>{const L=window.__durbarSimUi.realLayout(),ids=${jsLiteral(ids)};return ids.every(id=>{const d=L.zones.flatMap(z=>z.desks).find(x=>x.id===id),p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]');if(!d||!p)return false;const n=window.__durbarSimUi.agents().filter(x=>x.parent===id).length;if(!d.strip){const h=p.querySelector('.ro-help');return !!h&&h.textContent.trim().startsWith('+'+n)}let e=p.nextElementSibling;if(e&&e.matches('.ren'))e=e.nextElementSibling;const m=e&&e.querySelector('.ro-hmore');return !!e&&e.matches('.ro-hstrip')&&e.children.length===d.strip.shown+(d.strip.shown<n?1:0)&&(d.strip.shown<n?!!m&&m.textContent.trim()==='+'+(n-d.strip.shown):!m)})})()`, `${tag}: the strips drawn for the added helpers`);
    await must(PICS, `${tag}: the head pictures`);
    await mutate();
    if (MUTANT) console.log('[helper-row] mutant:', MUTANT);
    await js(`document.activeElement&&document.activeElement.blur();0`);
    /* the picture first, so a failing run still leaves the "before" picture */
    const file = `097-helper-row-${world}-${scene}-${w}x${h}.jpg`;
    if (wanted(file)) { await H.shot(path.join(OUT, file), { prep: 'calm', tag: 'helper-row', what: tag }); shots.push(file); }
    const s = await read();
    if (scene === 'lounge') assert.ok(s.lounge >= 2, `${tag}: the lounge row holds the two read agents (${s.lounge})`);
    console.log('[helper-row]', tag, 'helpRows', s.rows, JSON.stringify(s.desks.map((d) => [d.id, d.n, d.lay ? `${d.lay.cols}x${d.lay.rows}` : 'fallback', d.kids.map((c) => (c.more ? c.text : 'h') + '@' + Math.round(c.box.x) + ',' + Math.round(c.box.y)).join(' ') || d.helpText])));
    if (world === 'photo' && w === 1440 && scene === 'lounge') {
      const desk = s.desks.find((d) => d.id === ids[1]);
      if (desk && desk.box && desk.plate && wanted('097-helper-row-desk.png')) {
        const x = Math.max(0, Math.floor(desk.plate.x - 12)), y = Math.max(0, Math.floor(desk.plate.y - 70)), r = { x, y, width: Math.ceil(desk.plate.w + 24), height: Math.ceil(desk.box.y + desk.box.h + 12 - y) };
        const img = await ctx.win.webContents.capturePage(r);
        fs.writeFileSync(path.join(OUT, '097-helper-row-desk.png'), img.toPNG());
        shots.push('097-helper-row-desk.png');
      }
    }
    check(!s.scroll, `${tag}: the office does not scroll`);
    await checkSigns(tag + ' (helpers)');
    const strips = s.desks.filter((d) => d.lay);
    for (const d of s.desks) {
      if (!d.lay) { /* FR-308's fallback: no strip, the plate keeps +N */
        check(!d.box && d.help && new RegExp('^\\+' + d.n + '\\b').test(d.helpText), `${tag}: ${d.id} has no strip, so its plate says +${d.n} (${JSON.stringify(d.helpText)})`);
        fallbacks++;
        continue;
      }
      const L = d.lay, label = `${tag}: ${d.id} (${d.n} helpers, ${L.cols} across)`;
      if (!check(!!d.box, `${label}: the layout has a strip, the page drew none`)) continue;
      const heads = d.kids.filter((c) => !c.more), more = d.kids.filter((c) => c.more);
      const tops = [...new Set(d.kids.map((c) => Math.round(c.box.y)))];
      if (d.n > 1) wrapsLooked++;
      check(d.kids.every((c) => Math.abs(c.box.y - d.kids[0].box.y) <= 1), `${label}: FR-338 every head and +K on one line, tops ${JSON.stringify(tops)}: ${d.kids.map((c) => (c.more ? c.text : 'head') + '@' + Math.round(c.box.x) + ',' + Math.round(c.box.y)).join(' ')}`);
      /* FR-338: one row */
      check(L.rows === 1, `${label}: FR-338 one row of heads, the layout has ${L.rows}`);
      check(Math.abs(L.h - (HEAD + PAD - 2)) < 0.01, `${label}: the strip is one row high (${L.h})`);
      for (const c of d.kids) {
        check(c.box.x >= d.box.x - 3.5 && c.box.x + c.box.w <= d.box.x + d.box.w + 3.5 && c.box.y >= d.box.y - 3.5 && c.box.y + c.box.h <= d.box.y + d.box.h + 3.5, `${label}: a head inside its strip ${JSON.stringify([c.box, d.box])}`);
        check(c.box.x >= 0 && c.box.y >= 0 && c.box.x + c.box.w <= s.vw && c.box.y + c.box.h <= s.vh, `${label}: a head inside the window ${JSON.stringify(c.box)}`);
      }
      /* the count: heads + K = helpers; the heads are the places across, the last one is +K when they do not all fit */
      const K = more.length ? Number((/^\+(\d+)$/.exec(more[0].text) || [])[1]) : 0;
      check(heads.length + K === d.n, `${label}: heads ${heads.length} + K ${K} are the helpers`);
      const cols = Math.floor((d.box.w + GAP) / (HEAD + GAP));
      if (d.n > cols) {
        overflowSeen++;
        check(more.length === 1 && K > 0 && heads.length === cols - 1, `${label}: the places across (${cols}) are ${cols - 1} heads and +K (${heads.length} heads, ${JSON.stringify(more.map((m) => m.text))})`);
        check(d.kids.length > 0 && d.kids[d.kids.length - 1].more, `${label}: +K is the last place`);
        if (more.length) check(more[0].fs >= 10.5, `${label}: +K text ${more[0].fs} px, at least 10.5`);
      } else check(more.length === 0 && heads.length === d.n, `${label}: all ${d.n} heads fit ${cols} places, no +K`);
      /* nothing covers anything: the strip touches no plate, sign (the folder's header), screen or other strip */
      for (const [nm, list] of [['plate', s.plates], ['sign', s.signs], ['screen', s.screens]]) for (const r of list) check(!hit(d.box, r), `${label}: the strip overlaps a ${nm} ${JSON.stringify([d.box, r])}`);
      for (const o of strips) if (o !== d) check(!hit(d.box, o.box), `${label}: two strips overlap`);
      stripsChecked++;
    }
  }
  assert.deepStrictEqual(fails, [], `${fails.length} failure(s), first: ${fails[0]}`);
  const nw = WORLDS.length; /* at all three worlds: 42 strips, 16 with +K, 30 fallbacks (2026-11-09) */
  assert.ok(stripsChecked >= 4 * nw && overflowSeen >= nw && wrapsLooked >= 4 * nw && fallbacks >= 4 && signsChecked >= 20 * nw, `the cases ran: ${stripsChecked} strips, ${overflowSeen} with +K, ${fallbacks} fallbacks, ${signsChecked} signs`);
  console.log('[helper-row] ok:', stripsChecked, 'strips,', overflowSeen, 'with +K,', fallbacks, 'fallbacks,', signsChecked, 'signs;', shots.join(' '));
  process.exitCode = 0;
};
