/*
 * Spec 097 FR-365 (bug 1513): the rename pencil while its plate eases to a new layout (a lounge move). The pencil is placed by CSS anchor only, so the
 * plate's ease (translate and scale on the compositor) does not carry its painted icon; before the fix it was drawn over the name and the status icon
 * for the first ~200 ms. Simulator only (DURBAR_SIM=15, simfreeze=1 romotion=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-pencil-ease      (builds first)
 *   PENCIL_EASE_MUTANT=<name>        each must fail with the label named here:
 *     nohide     the hide cancelled right after the move starts (the code before the fix): "no pencil is painted over its plate's name, role or status"
 *     late       the frames start 700 ms after the move (a capture slower than the ease): "frames caught the plates on their way"
 *     half       the hold at opacity 0.5, not 0: "each moving plate's pencil is at opacity 0 for as long as its plate eases"
 *     early      the fade starts at 30 % of the ease: the same label
 *     focushide  the focused pencil hidden too: "the focused pencil stays shown (opacity 1) while its plate eases"
 *   PENCIL_EASE_WORLDS=photo,arcade  only those worlds (photo, cave, arcade)
 *   PENCIL_EASE_SLOW_CAPTURE=<ms>    a pause after each mid-move capture, as a slow (software) compositor: the 3-frame assert is then skipped, printed
 *   PENCIL_EASE_PLAIN=1              no colour marks: only saves the frames (with SHOTS_OUT), to look at; asserts nothing on pixels
 *   SHOTS_OUT=<dir>                  also saves each frame, 097-pencil-ease-<world>-<w>x<h>-<ms>.png, and the driver's log
 *
 * Painted pixels, not boxes: a getBoundingClientRect read forces layout and so shows the pencil where it belongs (issue 1513, Mac evidence). Each
 * plate's name, role and status line and its pencil's icon are painted in their own exact colours (inline styles, no layout change) and found in real
 * capturePage frames taken from the move's start to ~320 ms in. A pencil drawn half-transparent would blend and match no colour, so the page also
 * samples, every animation frame of the ease, each moving plate's pencil's computed opacity (a style read, no layout); under 0.05 counts as not painted
 * (the plate's last frame and the pencil's fade can share one frame: 0.03 was read there).
 *
 * In the Photo office and the arcade (the cave too when asked), at 1440x900 and 1280x800, every pencil shown (body.ren-show, as hover:none shows them),
 * the first mover's pencil focused, it fails (exit 1) when:
 *   - fewer than MIN_CAUGHT frames in the first 200 ms show a plate on its way (measured on the Mac: 9 to 13). When the captures themselves are slow
 *     (median gap over 40 ms: Linux/Xvfb at DPR 2) it prints "skipped: capture too slow" instead; the opacity reads still hold the hide;
 *   - not every marked plate's pencil and name (or status) is found in the end frame (a colour that does not come through would drop it silently);
 *   - in any frame a pencil's painted icon overlaps its own plate's painted name, role or status line (the focused one excepted: FR-365's known gap);
 *   - while a plate eases, its pencil's opacity is not 0 (the focused pencil's: not 1), or the focused pencil's plate did not ease;
 *   - when the ease is over: a WAAPI animation still runs in #stage, a pencil is not painted, or it is not just after its name (0..8 px) clear of the
 *     role and status (painted, and by its box);
 *   - a status change of a desk (working, thinking, waiting and back) hides a pencil whose plate does not move, or (thinking: no layout change)
 *     hides any pencil. Measured: thinking eases no plate; waiting and working again reorder the room (3 plates move 228..456 px), so those hide.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.PENCIL_EASE_MUTANT || '';
const PLAIN = process.env.PENCIL_EASE_PLAIN === '1';
const OUT = process.env.SHOTS_OUT || '';
const SIZES = [[1440, 900], [1280, 800]];
const ALL = { photo: {}, cave: { worldflags: 'cave', world: 'cave' }, arcade: { worldflags: 'retro', world: 'retro' } };
const WORLDS = (process.env.PENCIL_EASE_WORLDS || 'photo,arcade').split(',').filter((w) => ALL[w]);
const SPAN = 320; /* ms of frames after the move starts: the ease is 280..520 ms, the displacement was seen in its first ~200..300 ms */
const SLOW_CAP = Number(process.env.PENCIL_EASE_SLOW_CAPTURE || 0); /* a pause after each capture (ms): stands in for a slow compositor, to show the skip below */
const MIN_CAUGHT = 3; /* frames in the first 200 ms that must show a plate on its way (Mac: 9..13 of them, one every ~17 ms) */

/** The painted box of each part of each marked plate in a capture (CSS px), from its exact colour (±2 per channel: a scaled layer's inside stays exact).
 *  Plate i (1..) has v = 8 + 8 i: pencil (255,0,v), name (0,255,v), status (v,0,255), role (0,v,255). A box spans only rows and columns with 2 or more of
 *  its pixels, so one stray picture pixel of a marker's colour cannot grow it into a false overlap. */
function marks(img, vw) {
  const { width: iw, height: ih } = img.getSize(), b = img.toBitmap(), s = iw / vw, acc = {};
  const near = (c, t) => Math.abs(c - t) <= 2;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const i = (y * iw + x) * 4, B = b[i], G = b[i + 1], R = b[i + 2]; /* BGRA */
    let fam = null, v = 0;
    if (near(R, 255) && near(G, 0) && B >= 14) { fam = 'pen'; v = B; }
    else if (near(R, 0) && near(G, 255) && B >= 14) { fam = 'name'; v = B; }
    else if (near(B, 255) && near(G, 0) && R >= 14) { fam = 'status'; v = R; }
    else if (near(B, 255) && near(R, 0) && G >= 14) { fam = 'role'; v = G; }
    if (!fam) continue;
    const k = Math.round((v - 8) / 8);
    if (k < 1 || Math.abs(8 + 8 * k - v) > 2) continue;
    const a = acc[fam + ':' + k] || (acc[fam + ':' + k] = { cols: new Map(), rows: new Map() });
    a.cols.set(x, (a.cols.get(x) || 0) + 1); a.rows.set(y, (a.rows.get(y) || 0) + 1);
  }
  const out = {};
  for (const [key, a] of Object.entries(acc)) {
    const xs = [...a.cols].filter(([, c]) => c >= 2).map(([x]) => x), ys = [...a.rows].filter(([, c]) => c >= 2).map(([y]) => y);
    if (!xs.length || !ys.length) continue;
    out[key] = { x: Math.min(...xs) / s, y: Math.min(...ys) / s, r: (Math.max(...xs) + 1) / s, b: (Math.max(...ys) + 1) / s };
  }
  return out;
}
const overlap = (a, c) => Math.min(a.r, c.r) - Math.max(a.x, c.x) > 1 && Math.min(a.b, c.b) - Math.max(a.y, c.y) > 1; /* more than 1 px each way: an edge's blend is not an overlap */
const rd = (o) => o && [o.x, o.y, o.r, o.b].map((n) => Math.round(n));

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const wc = () => ctx.win.webContents;
  const SIM = 'window.__durbarSimUi';
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const STILL = `!document.getElementById('stage').getAnimations({subtree:true}).some(a=>!a.animationName&&a.playState==='running')`; /* no WAAPI move or fade (the CSS loops, a person's bob, keep running) */
  /* page code: a plate's own move (translate or scale), as realoffice.js starts it */
  const EASE_OF = `(p=>p.getAnimations().find(a=>!a.animationName&&a.playState==='running'&&a.effect&&a.effect.getKeyframes().some(f=>f.translate||f.scale)))`;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const log = (...a) => { console.log('[097-pencil-ease]', ...a); if (OUT) fs.appendFileSync(path.join(OUT, '097-pencil-ease.log'), a.join(' ') + '\n'); }; /* also beside the frames: the suite prints a driver's log only when it fails */
  if (MUTANT) log('mutant:', MUTANT);
  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', romotion: '1', ...ALL[world] }, ready: REAL, settle: false });
    /* the OS may ask for reduced motion (then nothing eases, FR-249): this check needs the ease */
    const dbg = wc().debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const READY = PICS + `&&document.querySelector('#stage .ro').dataset.go==='1'`;
    await must(READY, `${tag}: the pictures, and the office past its first 2 s (FR-228: nothing eases before)`);
    wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    /* the release clip's lounge scene (scripts/release-video.js): two agents in rooms where others keep working finish, replies unread; then they are read */
    await must(`${SIM}.visitsSettled()`, `${tag}: no visit about to start or end`);
    const pick = await js(`(()=>{const A=${SIM}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit,out=[];
      const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id));
      const cand=M.filter(a=>['idle','working','thinking'].includes(a.state)&&home.has(a.id)&&!a.paused&&!a.limit&&!A.some(h=>h.parent===a.id)).sort((x,y)=>(x.state==='idle'?0:1)-(y.state==='idle'?0:1));
      for(const a of cand){if(out.length===2)break;const next=out.concat(a.id);if(next.every(id=>{const r=A.find(x=>x.id===id).room;return M.some(o=>o.room===r&&!next.includes(o.id)&&!fin(o))}))out.push(a.id);}
      return out})()`);
    assert.strictEqual(pick.length, 2, `${tag}: two agents to finish`);
    await js(`(()=>{for(const id of ${jsLiteral(pick)}){const a=${SIM}.agents().find(x=>x.id===id);a.state='done';a.lastOutput=a.lastOutput||'Finished the change and ran the tests.';a.lastEventAt=Date.now();${SIM}.unread.mark(id);}${SIM}.crew.renderAll();return 1})()`);
    await must(`document.querySelectorAll('#stage .ro-plate.st-done').length>=2`, `${tag}: the finished desks`);
    await must(PICS + '&&' + STILL, `${tag}: the office still before the move`, 8000);
    /* every pencil shown; the slips hidden (one may lie over a plate); each plate's parts and its pencil's icon marked */
    const n = await js(`(()=>{document.body.classList.add('ren-show');document.querySelectorAll('#stage .ro-slip').forEach(e=>e.style.setProperty('visibility','hidden','important'));
      if(${PLAIN})return document.querySelectorAll('#stage .ren.ro-ren').length;
      const set=(e,c)=>{if(!e)return;e.style.setProperty('background',c,'important');e.style.setProperty('color',c,'important');e.style.setProperty('-webkit-text-fill-color',c,'important');e.style.setProperty('text-shadow','none','important');e.style.setProperty('opacity','1','important');e.style.setProperty('filter','none','important');e.querySelectorAll('*').forEach(x=>{x.style.setProperty('color',c,'important');x.style.setProperty('-webkit-text-fill-color',c,'important');x.style.setProperty('fill',c,'important');x.style.setProperty('stroke',c,'important');x.style.setProperty('background',c,'important')});};
      const rgb=a=>'rgb('+a.join(',')+')';let i=0;
      for(const b of document.querySelectorAll('#stage .ren.ro-ren')){const p=b.previousElementSibling;if(!p||!p.matches('.ro-plate'))continue;i++;const v=8+8*i;
        p.dataset.peMark=String(i);b.style.setProperty('background','transparent','important');b.style.setProperty('box-shadow','none','important');
        set(b.querySelector('svg'),rgb([255,0,v]));set(p.querySelector('.ro-l1>b'),rgb([0,255,v]));set(p.querySelector('.ro-l2'),rgb([v,0,255]));set(p.querySelector('.ro-role'),rgb([0,v,255]));}
      return i})()`);
    assert.ok(n >= 10, `${tag}: pencils to mark (${n})`);
    /* FR-365's focus rule: the first mover's pencil has the keyboard focus (a plate that goes to the lounge always eases) */
    const focusMark = await js(`(()=>{const b=document.querySelector('#stage .ren.ro-ren[data-ren="'+CSS.escape(${jsLiteral(pick[0])})+'"]');b.focus({preventScroll:true});return document.activeElement===b?(b.previousElementSibling.dataset.peMark||'?'):''})()`);
    assert.ok(focusMark, `${tag}: the first mover's pencil has the focus`);
    await must(`[...document.querySelectorAll('#stage .ren.ro-ren')].every(b=>getComputedStyle(b).opacity==='1')`, `${tag}: every pencil shown (ren-show's fade in over)`, 3000);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    /* the move: both read (the second finished long ago, so it sleeps there). The page then samples, each animation frame, every moving plate's pencil's
       computed opacity (a style read: no layout); nothing else reads the page until the frames are taken */
    const easing = await js(`(()=>{const s=${SIM}.agents().find(x=>x.id===${jsLiteral(pick[1])});s.lastEventAt=Date.now()-34*60000;for(const id of ${jsLiteral(pick)})${SIM}.unread.read(id);${SIM}.crew.renderAll();
      const M=${jsLiteral(MUTANT)},pens=[...document.querySelectorAll('#stage .ren.ro-ren')],foc=document.activeElement;
      if(M==='nohide')pens.forEach(b=>b.getAnimations().forEach(a=>a.cancel()));
      if(M==='half'||M==='early')pens.forEach(b=>b.getAnimations().filter(a=>!a.animationName).forEach(a=>{const o=a.effect.getKeyframes()[1].offset;a.effect.setKeyframes(M==='half'?[{opacity:.5},{opacity:.5,offset:o}]:[{opacity:0},{opacity:0,offset:.3}])}));
      if(M==='focushide'&&foc&&foc.matches('.ren')){const e=${EASE_OF}(foc.previousElementSibling);if(e)foc.animate([{opacity:0},{opacity:0,offset:.9}],{duration:Number(e.effect.getTiming().duration)+60})}
      const S=window.__peS={samples:0,bad:[],focusEased:0,moving:0},t0=performance.now();
      const step=()=>{for(const b of pens){const p=b.previousElementSibling;if(!p||!${EASE_OF}(p))continue;S.moving++;const op=getComputedStyle(b).opacity,f=b===document.activeElement;if(f)S.focusEased++;
        if((f?op!=='1':Number(op)>=0.05)&&S.bad.length<12)S.bad.push(Math.round(performance.now()-t0)+' ms '+(p.dataset.peMark||b.dataset.ren)+(f?' (focused)':'')+' opacity '+op);}
        S.samples++;if(performance.now()-t0<900)requestAnimationFrame(step);else S.done=true;};
      step();
      return [...document.querySelectorAll('#stage .ro-plate')].filter(p=>${EASE_OF}(p)).length})()`);
    if (MUTANT === 'late') await ctx.sleep(700);
    const t0 = Date.now(), frames = [];
    while (Date.now() - t0 < SPAN) { const img = await wc().capturePage(); frames.push({ t: Date.now() - t0 + (MUTANT === 'late' ? 700 : 0), img }); if (SLOW_CAP) await ctx.sleep(SLOW_CAP); }
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row`, 8000);
    await must(STILL + '&&!!(window.__peS||{}).done', `${tag}: the ease is over (no WAAPI animation running in #stage)`, 5000);
    const S = await js(`window.__peS`);
    /* the end frame: the ease and the pencils' 120 ms fade over (no WAAPI animation in #stage), every pencil at its CSS opacity (ren-show: 1), then a
       capture that shows every marked plate; a slow (software) compositor can hand back an older frame, so it is taken again, up to 3 s (review of PR 1555:
       Linux/Xvfb at DPR 2 lost 4..6 plates in the one end capture) */
    await must(STILL + `&&[...document.querySelectorAll('#stage .ren.ro-ren')].every(b=>getComputedStyle(b).opacity==='1')`, `${tag}: every pencil back at its CSS opacity (1 under ren-show)`, 5000);
    const keys = [...Array(n)].map((_, i) => String(i + 1));
    const lostIn = (m) => keys.filter((i) => !m['pen:' + i] || !(m['name:' + i] || m['status:' + i]));
    let endImg = null, end = null, tries = 0;
    for (const until = Date.now() + 3000; ;) {
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
      endImg = await wc().capturePage(); tries++;
      if (PLAIN) break;
      end = marks(endImg, w);
      if (!lostIn(end).length || Date.now() > until) break;
      await ctx.sleep(100);
    }
    if (OUT) {
      for (const f of frames) fs.writeFileSync(path.join(OUT, `097-pencil-ease-${world}-${w}x${h}-${String(f.t).padStart(3, '0')}.png`), f.img.toPNG());
      fs.writeFileSync(path.join(OUT, `097-pencil-ease-${world}-${w}x${h}-end.png`), endImg.toPNG());
    }
    log(tag, 'frames at', frames.map((f) => f.t).join(','), 'ms;', n, 'pencils;', easing, 'plates easing at the start; opacity samples', S.samples, 'frames,', S.moving, 'moving-pencil reads,', S.focusEased, 'of the focused one');
    if (!PLAIN) {
      /* every marked plate came through the capture: its pencil and its name or status (a colour lost would drop the plate from every assert) */
      if (tries > 1) log(tag, 'end frame taken', tries, 'times');
      assert.deepStrictEqual(lostIn(end), [], `${tag}: every marked plate's pencil and name (or status) is found in the end frame (${tries} captures in 3 s)`);
      /* the frames saw the ease: in the first 200 ms, frames where some plate's painted name or status is away from where it ends */
      const away = (m) => keys.some((i) => ['name', 'status'].some((p) => { const a = m[p + ':' + i], z = end[p + ':' + i]; return a && z && Math.max(Math.abs(a.x - z.x), Math.abs(a.y - z.y), Math.abs(a.r - z.r)) >= 3; }));
      for (const f of frames) f.m = marks(f.img, w);
      const caught = frames.filter((f) => f.t <= 200 && away(f.m));
      log(tag, caught.length, 'frames mid-move in the first 200 ms; painted pencils per frame', frames.map((f) => keys.filter((i) => f.m['pen:' + i]).length).join(','));
      /* a compositor whose captures take over 40 ms each (Linux/Xvfb at DPR 2: ~100 ms) cannot give 3 frames in 200 ms: that assert is then skipped, said
         in the log, never passed; the opacity reads below do not depend on the capture and still fail a pencil shown while its plate eases */
      const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b), gap = gaps.length ? gaps[gaps.length >> 1] : SPAN;
      if (caught.length < MIN_CAUGHT && gap > 40) log(tag, `skipped: capture too slow (${caught.length} frames mid-move in the first 200 ms, ${frames.length} in ${SPAN} ms, a capture every ${gap} ms): the painted check saw few frames; the opacity reads still apply`);
      else assert.ok(caught.length >= MIN_CAUGHT, `${tag}: ${MIN_CAUGHT} or more frames caught the plates on their way in the first 200 ms (got ${caught.length}; frames at ${frames.map((f) => f.t).join(',')} ms): too few means the captures are slower than the ease on this machine, so nothing was tested; not a pass`);
      /* in every frame: no pencil's painted icon over its own plate's painted name, role or status (the focused one may be: FR-365's known gap) */
      const bad = [];
      for (const f of frames) for (const i of keys) {
        const pen = f.m['pen:' + i];
        if (!pen || i === focusMark) continue; /* not painted (hidden while its plate eases) */
        for (const p of ['name', 'role', 'status']) if (f.m[p + ':' + i] && overlap(pen, f.m[p + ':' + i])) bad.push(`${f.t} ms plate ${i}: the pencil ${JSON.stringify(rd(pen))} over its ${p} ${JSON.stringify(rd(f.m[p + ':' + i]))}`);
      }
      assert.deepStrictEqual(bad, [], `${tag}: no pencil is painted over its plate's name, role or status while the plates ease`);
      /* a half-shown pencil blends and matches no colour: the page's opacity reads cover it */
      assert.ok(S.moving > 0 && S.focusEased > 0, `${tag}: the opacity reads saw moving plates, the focused pencil's among them (${JSON.stringify(S)})`);
      const focBad = S.bad.filter((x) => x.includes('(focused)')), restBad = S.bad.filter((x) => !x.includes('(focused)'));
      assert.deepStrictEqual(restBad, [], `${tag}: each moving plate's pencil is at opacity 0 (under 0.05) for as long as its plate eases`);
      assert.deepStrictEqual(focBad, [], `${tag}: the focused pencil stays shown (opacity 1) while its plate eases`);
      /* at the end: every pencil painted, just after its painted name, clear of the role and status; and by its boxes */
      const endBad = [];
      for (const i of keys) {
        const pen = end['pen:' + i], nm = end['name:' + i];
        for (const p of ['name', 'role', 'status']) if (end[p + ':' + i] && overlap(pen, end[p + ':' + i])) endBad.push(`plate ${i}: the pencil over its ${p}`);
        if (nm && (pen.x - nm.r < -1 || pen.x - nm.r > 9)) endBad.push(`plate ${i}: the pencil ${Math.round(pen.x - nm.r)} px after its name`);
      }
      assert.deepStrictEqual(endBad, [], `${tag}: once the ease is over every pencil is painted just after its name, over nothing`);
      const geo = await js(`[...document.querySelectorAll('#stage .ren.ro-ren')].map(b=>{const p=b.previousElementSibling,R=e=>e.getBoundingClientRect(),ic=R(b.querySelector('svg')||b),nb=p.querySelector('.ro-l1>b'),named=!!nb.getClientRects().length,nm=R(nb),st=R(p.querySelector('.ro-l2'));
        return {k:b.dataset.ren,gap:Math.round(named?ic.left-nm.right:p.getBoundingClientRect().right-ic.right),status:ic.bottom>st.top+0.5&&ic.top<st.bottom-0.5&&ic.left<st.right&&ic.right>st.left}})`);
      const geoBad = geo.filter((g) => g.gap < 0 || g.gap > 8 || g.status);
      assert.deepStrictEqual(geoBad, [], `${tag}: once the ease is over each pencil's box is just after its name (or the plate's end), off the status line`);
    }
    /* a status change hides only the pencils of plates that move (thinking moves none; waiting puts the desk first in its room, so a few do) */
    const who = await js(`(()=>{const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id)),p=${jsLiteral(pick)};
      const a=${SIM}.agents().find(a=>!a.parent&&home.has(a.id)&&!p.includes(a.id)&&['working','thinking'].includes(a.state)&&!a.paused&&!a.limit);return a?a.id:null})()`);
    assert.ok(who, `${tag}: a working agent at its desk`);
    const blinks = [];
    for (const st of ['thinking', 'waiting', 'working']) {
      const r = await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(who)});a.state=${jsLiteral(st)};a.lastEventAt=Date.now();${SIM}.crew.renderAll();
        return {kinds:[...document.querySelectorAll('#stage .ro-plate')].filter(p=>${EASE_OF}(p)).map(p=>{const f=${EASE_OF}(p).effect.getKeyframes()[0];return (p.dataset.id===${jsLiteral(who)}?'self ':'')+'t['+(f.translate||'-')+'] s['+(f.scale||'-')+']'}).join(' | '),plates:[...document.querySelectorAll('#stage .ro-plate')].filter(p=>${EASE_OF}(p)).length,hidden:[...document.querySelectorAll('#stage .ren.ro-ren')].filter(b=>b.getAnimations().some(x=>!x.animationName&&x.playState==='running')).length,
        still:[...document.querySelectorAll('#stage .ren.ro-ren')].filter(b=>b.getAnimations().some(x=>!x.animationName&&x.playState==='running')&&!${EASE_OF}(b.previousElementSibling)).length}})()`);
      blinks.push(`${st}: ${r.plates} plates eased, ${r.hidden} pencils hidden, ${r.still} of a still plate`); log(tag, st, r.kinds);
      await must(STILL, `${tag}: still after the change to ${st}`, 5000);
    }
    log(tag, 'status changes:', blinks.join('; '));
    assert.ok(blinks.every((b) => / 0 of a still plate$/.test(b)) && /^thinking: 0 plates eased, 0 pencils hidden/.test(blinks[0]), `${tag}: a status change hides only the pencils of plates that move (${blinks.join('; ')})`);
    log(tag, 'ok');
    try { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }); dbg.detach(); } catch (e) { /* the page went: nothing to undo */ }
  }
  console.log('[097-pencil-ease] ok');
  process.exitCode = 0;
};
