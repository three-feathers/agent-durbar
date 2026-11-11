/*
 * Spec 097 FR-365 (bug 1513): the rename pencil while its plate eases to a new layout (a lounge move). The pencil is placed by CSS anchor only, so the
 * plate's ease (translate and scale on the compositor) does not carry its painted icon; before the fix it was drawn over the name and the status icon
 * for the first ~200 ms. Simulator only (DURBAR_SIM=15, simfreeze=1 romotion=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-pencil-ease      (builds first)
 *   PENCIL_EASE_MUTANT=nohide        the pencils' hide during the ease cancelled right after the move starts (the code before the fix; must fail
 *                                    "no pencil is painted over its plate's name, role or status while the plates ease")
 *   PENCIL_EASE_WORLDS=photo,arcade  only those worlds (photo, cave, arcade)
 *   PENCIL_EASE_PLAIN=1              no colour marks: only saves the frames (with SHOTS_OUT), to look at; asserts nothing on pixels
 *   SHOTS_OUT=<dir>                  also saves each frame, 097-pencil-ease-<world>-<w>x<h>-<ms>.png
 *
 * Painted pixels, not boxes: a getBoundingClientRect read forces layout and so shows the pencil where it belongs (issue 1513, Mac evidence). Each
 * plate's name, role and status line and its pencil's icon are painted in their own exact colours (inline styles, no layout change) and found in real
 * capturePage frames taken from the move's start to ~320 ms in.
 *
 * In the Photo office and the arcade (the cave too when asked), at 1440x900 and 1280x800, every pencil shown (body.ren-show, as hover:none shows them),
 * it fails (exit 1) when:
 *   - no frame caught a plate on its way (the move did not ease, or the frames came too late: the check would prove nothing);
 *   - in any frame a pencil's painted icon overlaps its own plate's painted name, role or status line;
 *   - when the ease is over: a WAAPI animation still runs in #stage, a pencil is not painted, or it is not just after its name (0..8 px) clear of the
 *     role and status (painted, and by its box).
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
/* the marks: plate i (1..) gets v = 8 + 8 i; each part its own colour family, so an exact pixel says which part of which plate it is */
const FAM = { pen: (v) => [255, 0, v], name: (v) => [0, 255, v], status: (v) => [v, 0, 255], role: (v) => [0, v, 255] };

/** The painted box of each part of each marked plate in a capture (CSS px), from its exact colour (±2 per channel: a scaled layer's inside stays exact). */
function marks(img, vw) {
  const { width: iw, height: ih } = img.getSize(), b = img.toBitmap(), s = iw / vw, out = {};
  const put = (key, x, y) => { const o = out[key] || (out[key] = { x: 1e9, y: 1e9, r: -1, b: -1, n: 0 }); o.x = Math.min(o.x, x); o.y = Math.min(o.y, y); o.r = Math.max(o.r, x + 1); o.b = Math.max(o.b, y + 1); o.n++; };
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
    put(fam + ':' + k, x, y);
  }
  for (const o of Object.values(out)) { o.x /= s; o.y /= s; o.r /= s; o.b /= s; }
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
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const log = (...a) => { console.log('[097-pencil-ease]', ...a); if (OUT) fs.appendFileSync(path.join(OUT, '097-pencil-ease.log'), a.join(' ') + '\n'); }; /* also beside the frames: the suite prints a driver's log only when it fails */
  if (MUTANT) console.log('[097-pencil-ease] mutant:', MUTANT);
  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', romotion: '1', ...ALL[world] }, ready: REAL, settle: false });
    /* the OS may ask for reduced motion (then nothing eases, FR-249): this check needs the ease */
    const dbg = wc().debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await must(`${PICS}&&document.querySelector('#stage .ro').dataset.go==='1'`, `${tag}: the pictures, and the office past its first 2 s (FR-228: nothing eases before)`);
    wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    /* the release clip's lounge scene (scripts/release-video.js): two agents in rooms where others keep working finish, replies unread; then they are read */
    await must(`${SIM}.visitsSettled()`, `${tag}: no visit about to start or end`);
    const pick = await js(`(()=>{const A=${SIM}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit,out=[];
      const home=new Set(${SIM}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id));
      const cand=M.filter(a=>['idle','working','thinking'].includes(a.state)&&home.has(a.id)&&!a.paused&&!a.limit&&!A.some(h=>h.parent===a.id)).sort((x,y)=>(x.state==='idle'?0:1)-(y.state==='idle'?0:1));
      for(const a of cand){if(out.length===2)break;const next=out.concat(a.id);if(next.every(id=>{const r=A.find(x=>x.id===id).room;return M.some(o=>o.room===r&&!next.includes(o.id)&&!fin(o))}))out.push(a.id);}
      return out})()`);
    assert.strictEqual(pick.length, 2, `${tag}: two agents to finish`);
    const ids = `[${pick.map(jsLiteral).join(',')}]`;
    await js(`(()=>{for(const id of ${ids}){const a=${SIM}.agents().find(x=>x.id===id);a.state='done';a.lastOutput=a.lastOutput||'Finished the change and ran the tests.';a.lastEventAt=Date.now();${SIM}.unread.mark(id);}${SIM}.crew.renderAll();return 1})()`);
    await must(`document.querySelectorAll('#stage .ro-plate.st-done').length>=2`, `${tag}: the finished desks`);
    await must(`${PICS}&&${STILL}`, `${tag}: the office still before the move`, 8000);
    log(tag, 'picked', JSON.stringify(await js(`${ids}.map(id=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]');return p&&p.className})`)));
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
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    const before = PLAIN ? null : marks(await wc().capturePage(), w);
    /* the move: both read (the second finished long ago, so it sleeps there); nothing below reads layout until the frames are taken */
    const easing = await js(`(()=>{const s=${SIM}.agents().find(x=>x.id===${jsLiteral(pick[1])});s.lastEventAt=Date.now()-34*60000;for(const id of ${ids})${SIM}.unread.read(id);${SIM}.crew.renderAll();
      if(${jsLiteral(MUTANT === 'nohide')})document.querySelectorAll('#stage .ren.ro-ren').forEach(b=>b.getAnimations().forEach(a=>a.cancel()));
      return [...document.querySelectorAll('#stage .ro-plate')].filter(p=>p.getAnimations().some(a=>!a.animationName&&a.playState==='running')).length+' (office '+document.querySelector('#stage .ro').className+', reduced '+matchMedia('(prefers-reduced-motion: reduce)').matches+', hidden '+document.hidden+')'})()`);
    const t0 = Date.now(), frames = [];
    while (Date.now() - t0 < SPAN) { const img = await wc().capturePage(); frames.push({ t: Date.now() - t0, img }); }
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row`, 8000);
    await must(STILL, `${tag}: the ease is over (no WAAPI animation running in #stage)`, 5000);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    const endImg = await wc().capturePage();
    if (OUT) {
      for (const f of frames) fs.writeFileSync(path.join(OUT, `097-pencil-ease-${world}-${w}x${h}-${String(f.t).padStart(3, '0')}.png`), f.img.toPNG());
      fs.writeFileSync(path.join(OUT, `097-pencil-ease-${world}-${w}x${h}-end.png`), endImg.toPNG());
    }
    log( tag, 'frames at', frames.map((f) => f.t).join(','), 'ms;', n, 'pencils;', easing, 'plates easing at the start');
    if (PLAIN) continue;
    const end = marks(endImg, w);
    /* the frames saw the ease: some plate's painted name or status is away from where it ends (else nothing here would be tested) */
    const keys = [...new Set(Object.keys(end).map((k) => k.split(':')[1]))];
    const away = (m) => keys.some((i) => ['name', 'status'].some((p) => { const a = m[p + ':' + i], z = end[p + ':' + i]; return a && z && Math.max(Math.abs(a.x - z.x), Math.abs(a.y - z.y), Math.abs(a.r - z.r)) >= 3; }));
    const caught = frames.filter((f) => away(f.m = marks(f.img, w)));
    assert.ok(away(before) || caught.length, `${tag}: a frame caught the plates on their way (frames at ${frames.map((f) => f.t).join(',')} ms)`);
    /* in every frame: no pencil's painted icon over its own plate's painted name, role or status */
    const bad = [];
    for (const f of frames) for (const i of keys) {
      const pen = f.m['pen:' + i];
      if (!pen) continue; /* not painted (hidden while its plate eases) */
      for (const p of ['name', 'role', 'status']) if (f.m[p + ':' + i] && overlap(pen, f.m[p + ':' + i])) bad.push(`${f.t} ms plate ${i}: the pencil ${JSON.stringify(rd(pen))} over its ${p} ${JSON.stringify(rd(f.m[p + ':' + i]))}`);
    }
    log( tag, caught.length, 'of', frames.length, 'frames mid-move; painted pencils per frame', frames.map((f) => keys.filter((i) => f.m['pen:' + i]).length).join(','));
    assert.deepStrictEqual(bad, [], `${tag}: no pencil is painted over its plate's name, role or status while the plates ease`);
    /* at the end: every pencil painted, just after its painted name, clear of the role and status; and by its boxes */
    const endBad = [];
    for (const i of keys) {
      const pen = end['pen:' + i], nm = end['name:' + i];
      if (!pen) { endBad.push(`plate ${i}: no pencil painted`); continue; }
      for (const p of ['name', 'role', 'status']) if (end[p + ':' + i] && overlap(pen, end[p + ':' + i])) endBad.push(`plate ${i}: the pencil over its ${p}`);
      if (nm && (pen.x - nm.r < -1 || pen.x - nm.r > 9)) endBad.push(`plate ${i}: the pencil ${Math.round(pen.x - nm.r)} px after its name`);
    }
    assert.deepStrictEqual(endBad, [], `${tag}: once the ease is over every pencil is painted just after its name, over nothing`);
    const geo = await js(`[...document.querySelectorAll('#stage .ren.ro-ren')].map(b=>{const p=b.previousElementSibling,R=e=>e.getBoundingClientRect(),ic=R(b.querySelector('svg')||b),nb=p.querySelector('.ro-l1>b'),named=!!nb.getClientRects().length,nm=R(nb),st=R(p.querySelector('.ro-l2'));
      return {k:b.dataset.ren,gap:Math.round(named?ic.left-nm.right:p.getBoundingClientRect().right-ic.right),status:ic.bottom>st.top+0.5&&ic.top<st.bottom-0.5&&ic.left<st.right&&ic.right>st.left}})`);
    const geoBad = geo.filter((g) => g.gap < 0 || g.gap > 8 || g.status);
    assert.deepStrictEqual(geoBad, [], `${tag}: once the ease is over each pencil's box is just after its name (or the plate's end), off the status line`);
    log( tag, 'ok:', keys.length, 'marked plates; at the end every pencil painted at its spot');
  }
  console.log('[097-pencil-ease] ok');
  process.exitCode = 0;
};
