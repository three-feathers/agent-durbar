/*
 * Spec 097 FR-365 (bug 1513): the rename pencil while its plate eases to a new layout (a lounge move). The pencil is placed by CSS anchor only, so the
 * plate's ease (translate and scale on the compositor) does not carry its painted icon; before the fix it was drawn over the name and the status icon
 * for the first ~200 ms. Simulator only (DURBAR_SIM=15, simfreeze=1 romotion=1), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-pencil-ease      (builds first)
 *   PENCIL_EASE_MUTANT=<name>        each must fail with the label named here:
 *     nohide     the hide cancelled right after the move starts (the code before the fix): "no pencil is painted over its plate's name, role or status"
 *     late       the frames are requested 700 ms after the move (a harness that started late; zero requests in the first 200 ms): "frames caught the plates on their way"
 *     half       the hold at opacity 0.5, not 0: "each moving plate's pencil is at opacity 0 for as long as its plate eases"
 *     early      the hold ends at 30 % of the ease: "no pencil is painted over …" (the opacity label when the painted check is skipped)
 *     skew       the hold a time of its own that ends 40 ms before its plate's ease (the race seen in the cave, review of PR 1555): the opacity label
 *     focushide  the focused pencil hidden too: "the focused pencil stays shown (opacity 1) while its plate eases"
 *     parkold    the pointer parked at the first version's spot, whatever the screen (with PENCIL_EASE_SCREEN=1280x1024 at DPR 2): "the pointer is parked on the visible screen"
 *     far        every pencil 6 px further from its name: "once the ease is over every pencil is painted just after its name"
 *     noease     the OS asks for reduced motion (nothing eases): with PENCIL_EASE_SCREEN smaller than the window the labelled "skipped: no plate eased ... the window is larger than the X screen";
 *                with the window inside the screen it fails "3 or more frames caught the plates on their way"
 *     oldfocus   the focus listener as it was (the cancelled hold stays the current one): a pencil focused while hidden fades in from 0 at the end of the ease:
 *                "a pencil focused while hidden stays at opacity 1 through the end of its plate's ease"
 *     pin        the pointer back on a working plate after parking (it did not leave): fails "the hover card closed after the pointer left"; with PENCIL_EASE_SCREEN smaller than the
 *                window it is the labelled "skipped: the pointer-dependent checks ... need the window inside the screen" instead
 *     hover      the pointer left on a working plate before the end frame: "no hover card is open over the plates in the end frame"
 *   PENCIL_EASE_SIZE=1280x800        only that size
 *   PENCIL_EASE_WORLDS=photo,arcade  only those worlds (photo, cave, arcade)
 *   PENCIL_EASE_SLOW_CAPTURE=<ms>    a pause after each mid-move capture, as a slow (software) compositor: the 3-frame assert is then skipped, printed
 *   PENCIL_EASE_CAPTURE_DELAY=<ms>   each capture is requested on time and answered that late: the 3-frame rule is skipped, printed, never failed (`late` is a request made late)
 *   PENCIL_EASE_BLUR=<px>            box-blur every capture first (device px), as a resampling compositor would: the check must still pass and still fail nohide
 *   PENCIL_EASE_SKIP_PAINTED=1       take the DPR 2 fallback's path (painted checks skipped, printed): shows what the opacity reads alone still fail
 *   PENCIL_EASE_SCREEN=<W>x<H>       an X screen of that many device px: plates beyond it are skipped by the painted checks, printed ("skipped: painted
 *                                    end-state check: N of M plates are off the X screen ...")
 *   PENCIL_EASE_PLAIN=1              no colour marks: only saves the frames (with SHOTS_OUT), to look at; asserts nothing on pixels
 *   SHOTS_OUT=<dir>                  also saves each frame, 097-pencil-ease-<world>-<w>x<h>-<ms>.png, and the driver's log
 *
 * Painted pixels, not boxes: a getBoundingClientRect read forces layout and so shows the pencil where it belongs (issue 1513, Mac evidence). Each
 * plate's name, role and status line and its pencil's icon are painted in their own marker colours (inline styles, no layout change) and found in real
 * capturePage frames taken from the move's start to ~320 ms in. A pencil drawn half-transparent would blend and match no colour, so the page also
 * samples, every animation frame of the ease, each moving plate's pencil's computed opacity (a style read, no layout); under 0.05 counts as not painted
 * (the plate's last frame and the pencil's fade can share one frame: 0.03 was read there).
 *
 * In the Photo office and the arcade (the cave too when asked), at 1440x900 and 1280x800, every pencil shown (body.ren-show, as hover:none shows them),
 * the first mover's pencil focused, it fails (exit 1) when:
 *   - fewer than MIN_CAUGHT frames in the first 200 ms show a plate on its way (measured on the Mac: 9 to 13). When the captures themselves are slow
 *     (median gap over 40 ms: Linux/Xvfb at DPR 2) it prints "skipped: capture too slow" instead; the opacity reads still hold the hide;
 *   - not every marked plate's pencil and name (or status) is found in the end frame (a colour that does not come through would drop it silently);
 *     it prints why per missing plate first. At DPR 2 it prints "skipped: DPR 2 painted check (...)" instead and keeps the opacity reads (Linux/Xvfb);
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
const { helpers, jsLiteral, STILL_STAGE } = require('./driver-helpers');
const { parkCandidates, parkVisible, windowOutsideScreen, fitWindow } = require('./pencil-park');

const MUTANT = process.env.PENCIL_EASE_MUTANT || '';
const PLAIN = process.env.PENCIL_EASE_PLAIN === '1';
const OUT = process.env.SHOTS_OUT || '';
const SIZE_ENV = /^(\d+)x(\d+)$/.exec(process.env.PENCIL_EASE_SIZE || '');
const SIZES = SIZE_ENV ? [[Number(SIZE_ENV[1]), Number(SIZE_ENV[2])]] : [[1440, 900], [1280, 800]]; /* PENCIL_EASE_SIZE=<W>x<H>: only that window size, any size (a mutant is otherwise caught at the first size) */
const ALL = { photo: {}, cave: { worldflags: 'cave', world: 'cave' }, arcade: { worldflags: 'retro', world: 'retro' } };
const WORLDS = (process.env.PENCIL_EASE_WORLDS || 'photo,arcade').split(',').filter((w) => ALL[w]);
const SPAN = 320; /* ms of frames after the move starts: the ease is 280..520 ms, the displacement was seen in its first ~200..300 ms */
const SLOW_CAP = Number(process.env.PENCIL_EASE_SLOW_CAPTURE || 0); /* a pause after each capture (ms): stands in for a slow compositor, to show the skip below */
const CAPTURE_DELAY = Number(process.env.PENCIL_EASE_CAPTURE_DELAY || 0); /* ms between a capture's request and its image: a compositor that answers late (a first image at 250 ms is not a late harness) */
const SKIP_PAINTED = process.env.PENCIL_EASE_SKIP_PAINTED === '1';
const SCREEN = process.env.PENCIL_EASE_SCREEN || ''; /* <W>x<H> device px: treat plates beyond it as off the X screen (as a small Xvfb screen leaves them) */
const MIN_CAUGHT = 3; /* frames in the first 200 ms that must show a plate on its way (Mac: 9..13 of them, one every ~17 ms) */

/* the marks: plate i (1..15) has v = 16 i; pencil (255,0,v), name (0,255,v), status (v,0,255), role (0,v,255). A pixel is a mark when its full and empty
   channels are within TOL of 255 and 0 and its third channel within 6 of a 16 i: wide enough for a resampled or software-composited capture (Linux/Xvfb
   at DPR 2 lost plates with the earlier exact match, review of PR 1555), still one colour per part. */
const TOL = 12;
const famOf = (R, G, B) => {
  const hi = (c) => c >= 255 - TOL, lo = (c) => c <= TOL;
  if (hi(R) && lo(G) && !hi(B)) return ['pen', B];
  if (lo(R) && hi(G) && !hi(B)) return ['name', B];
  if (hi(B) && lo(G) && !hi(R)) return ['status', R];
  if (hi(B) && lo(R) && !hi(G)) return ['role', G];
  return null;
};
const EXPECT = { pen: (v) => [255, 0, v], name: (v) => [0, 255, v], status: (v) => [v, 0, 255], role: (v) => [0, v, 255] };
const BLUR = Number(process.env.PENCIL_EASE_BLUR || 0); /* a box blur of this radius (device px) on every capture first, as a resampling compositor would */
function bitmapOf(img) {
  const { width: iw, height: ih } = img.getSize(), b = Buffer.from(img.toBitmap());
  if (!BLUR) return { iw, ih, b };
  const tmp = Buffer.alloc(b.length), r = BLUR;
  for (const [src, dst, horiz] of [[b, tmp, true], [tmp, b, false]]) for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) for (let c = 0; c < 3; c++) {
    let sum = 0, cnt = 0;
    for (let d = -r; d <= r; d++) { const xx = horiz ? x + d : x, yy = horiz ? y : y + d; if (xx < 0 || yy < 0 || xx >= iw || yy >= ih) continue; sum += src[(yy * iw + xx) * 4 + c]; cnt++; }
    dst[(y * iw + x) * 4 + c] = Math.round(sum / cnt);
  }
  return { iw, ih, b };
}
/** The painted box of each part of each marked plate in a capture, measured in device pixels, given in CSS px (device / (capture width / view width)).
 *  A part is its 4-connected blobs of its colour that hold at least a tenth of its largest blob's pixels (and 6 pixels): a marked box is one solid
 *  block, so picture pixels of a near colour cannot grow it (review of PR 1555: two neon-cyan arcade pixels 130 px away had stretched a name by 9 px). */
function marks(img, vw) {
  const { iw, ih, b } = bitmapOf(img), s = iw / vw, acc = {};
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const i = (y * iw + x) * 4, f = famOf(b[i + 2], b[i + 1], b[i]); /* BGRA */
    if (!f) continue;
    const k = Math.round(f[1] / 16);
    if (k < 1 || k > 15 || Math.abs(16 * k - f[1]) > 6) continue;
    (acc[f[0] + ':' + k] || (acc[f[0] + ':' + k] = [])).push(y * iw + x);
  }
  const out = {};
  for (const [key, list] of Object.entries(acc)) {
    const left = new Set(list), blobs = [];
    for (const p0 of list) {
      if (!left.has(p0)) continue;
      left.delete(p0);
      const q = [p0], blob = { x: 1e9, y: 1e9, r: -1, b: -1, n: 0 };
      while (q.length) {
        const p = q.pop(), x = p % iw, y = (p - x) / iw;
        blob.n++; if (x < blob.x) blob.x = x; if (y < blob.y) blob.y = y; if (x + 1 > blob.r) blob.r = x + 1; if (y + 1 > blob.b) blob.b = y + 1;
        for (const nb of [x > 0 ? p - 1 : -1, x < iw - 1 ? p + 1 : -1, p - iw, p + iw]) if (nb >= 0 && left.has(nb)) { left.delete(nb); q.push(nb); }
      }
      blobs.push(blob);
    }
    const big = Math.max(...blobs.map((o) => o.n)), keep = blobs.filter((o) => o.n >= big / 10 && o.n >= 6);
    if (!keep.length) continue;
    out[key] = { x: Math.min(...keep.map((o) => o.x)) / s, y: Math.min(...keep.map((o) => o.y)) / s, r: Math.max(...keep.map((o) => o.r)) / s, b: Math.max(...keep.map((o) => o.b)) / s, n: keep.reduce((t, o) => t + o.n, 0) };
  }
  return out;
}
/** For a plate the end frame lacks: per part, the closest colour to its mark inside the plate's box (device px), as max channel distance. */
function nearest(img, box, s, i) {
  const { iw, ih, b } = bitmapOf(img), out = {};
  for (const fam of ['pen', 'name', 'status']) {
    const e = EXPECT[fam](16 * Number(i));
    let best = 999, at = null;
    for (let y = Math.max(0, Math.floor(box.y * s) - 30); y < Math.min(ih, Math.ceil((box.y + box.h) * s) + 30); y++) for (let x = Math.max(0, Math.floor(box.x * s) - 30); x < Math.min(iw, Math.ceil((box.x + box.w) * s) + 30); x++) {
      const j = (y * iw + x) * 4, d = Math.max(Math.abs(b[j + 2] - e[0]), Math.abs(b[j + 1] - e[1]), Math.abs(b[j] - e[2]));
      if (d < best) { best = d; at = [x, y, b[j + 2], b[j + 1], b[j]]; }
    }
    out[fam] = best + (at ? ` at ${at[0]},${at[1]} rgb(${at[2]},${at[3]},${at[4]})` : '');
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
  const STILL = STILL_STAGE; /* no WAAPI move or fade (the CSS loops, a person's bob, keep running): the one text the release clip's capture waits on too */
  /* page code: a plate's own move (translate or scale), as realoffice.js starts it */
  const EASE_OF = `(p=>p.getAnimations().find(a=>!a.animationName&&a.playState==='running'&&a.effect&&a.effect.getKeyframes().some(f=>f.translate||f.scale)))`;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const log = (...a) => { console.log('[097-pencil-ease]', ...a); if (OUT) fs.appendFileSync(path.join(OUT, '097-pencil-ease.log'), a.join(' ') + '\n'); }; /* also beside the frames: the suite prints a driver's log only when it fails */
  if (MUTANT) log('mutant:', MUTANT);
  /* the X screen and the window in device px (PENCIL_EASE_SCREEN stands in for a smaller screen), as the page sees them now */
  const screenInfo = () => js(`(()=>{const d=devicePixelRatio,m=/^(\\d+)x(\\d+)$/.exec(${jsLiteral(SCREEN)});return {dpr:d,view:[innerWidth,innerHeight],top:document.getElementById('stage').getBoundingClientRect().top,screen:m?[+m[1],+m[2]]:[Math.round(screen.width*d),Math.round(screen.height*d)],at:[Math.round((screenX+(outerWidth-innerWidth))*d),Math.round((screenY+(outerHeight-innerHeight))*d)]}})()`);
  for (const world of WORLDS) {
  const queue = SIZES.map((z) => [...z, false]); /* [w, h, fits]: a window that fits the screen is queued once when the screen is smaller than a window */
  for (let qi = 0; qi < queue.length; qi++) {
    const [w, h, fits] = queue[qi];
    const tag = `${world} ${w}x${h}${fits ? ' (a window that fits the screen)' : ''}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', romotion: '1', ...ALL[world] }, ready: REAL, settle: false });
    /* the OS may ask for reduced motion (then nothing eases, FR-249): this check needs the ease */
    const dbg = wc().debugger; if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: MUTANT === 'noease' ? 'reduce' : 'no-preference' }] });
    if (!fits && !SIZE_ENV) { /* the screen is smaller than this window (a Windows runner's 1024x768 under 1440x900): one more size, the largest that fits it, runs the same checks with the plates on the screen */
      const sc1 = await screenInfo(), want = windowOutsideScreen({ win: sc1.view.map((v) => v * sc1.dpr), screen: sc1.screen, at: sc1.at }) ? fitWindow({ win: sc1.view, screen: sc1.screen, dpr: sc1.dpr }) : null;
      if (want && !queue.some((z) => z[2])) queue.push([want[0], want[1], true]);
    }
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
      for(const b of document.querySelectorAll('#stage .ren.ro-ren')){const p=b.previousElementSibling;if(!p||!p.matches('.ro-plate'))continue;i++;if(i>15)break;const v=16*i;
        p.dataset.peMark=String(i);b.style.setProperty('background','transparent','important');b.style.setProperty('box-shadow','none','important');
        set(b.querySelector('svg'),rgb([255,0,v]));set(p.querySelector('.ro-l1>b'),rgb([0,255,v]));set(p.querySelector('.ro-l2'),rgb([v,0,255]));set(p.querySelector('.ro-role'),rgb([0,v,255]));}
      return i})()`);
    assert.ok(n >= 10 && n <= 15, `${tag}: pencils to mark (${n}; the marks hold 15)`);
    /* FR-365's focus rule: the first mover's pencil has the keyboard focus (a plate that goes to the lounge always eases) */
    const focusMark = await js(`(()=>{const b=document.querySelector('#stage .ren.ro-ren[data-ren="'+CSS.escape(${jsLiteral(pick[0])})+'"]');b.focus({preventScroll:true});return document.activeElement===b?(b.previousElementSibling.dataset.peMark||'?'):''})()`);
    assert.ok(focusMark, `${tag}: the first mover's pencil has the focus`);
    await must(`[...document.querySelectorAll('#stage .ren.ro-ren')].every(b=>getComputedStyle(b).opacity==='1')`, `${tag}: every pencil shown (ren-show's fade in over)`, 3000);
    if (MUTANT === 'far') await js(`(()=>{document.querySelectorAll('#stage .ren.ro-ren').forEach(b=>b.style.setProperty('left','calc(anchor(right) + 5px)','important'));return 1})()`); /* every pencil 6 px further from its name: 12 CSS px painted, over nothing */
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    /* the move: both read (the second finished long ago, so it sleeps there). The page then samples, each animation frame, every moving plate's pencil's
       computed opacity (a style read: no layout); nothing else reads the page until the frames are taken */
    const easing = await js(`(()=>{const s=${SIM}.agents().find(x=>x.id===${jsLiteral(pick[1])});s.lastEventAt=Date.now()-34*60000;for(const id of ${jsLiteral(pick)})${SIM}.unread.read(id);${SIM}.crew.renderAll();
      const M=${jsLiteral(MUTANT)},pens=[...document.querySelectorAll('#stage .ren.ro-ren')],foc=document.activeElement;
      if(M==='nohide')pens.forEach(b=>b.getAnimations().forEach(a=>a.cancel()));
      if(M==='half')pens.forEach(b=>b._hide&&b._hide.effect.setKeyframes([{opacity:.5},{opacity:.5}]));
      if(M==='early'||M==='skew')pens.forEach(b=>{const h=b._hide,e=b.previousElementSibling&&${EASE_OF}(b.previousElementSibling);if(h&&e){const d=Number(e.effect.getTiming().duration);setTimeout(()=>h.cancel(),M==='early'?d*0.3:d-40)}});
      if(M==='focushide'&&foc&&foc.matches('.ren')){const e=${EASE_OF}(foc.previousElementSibling);if(e)foc.animate([{opacity:0},{opacity:0,offset:.9}],{duration:Number(e.effect.getTiming().duration)+60})}
      const S=window.__peS={samples:0,bad:[],focusEased:0,moving:0},t0=performance.now();
      const step=()=>{for(const b of pens){const p=b.previousElementSibling;if(!p||!${EASE_OF}(p))continue;S.moving++;const op=getComputedStyle(b).opacity,f=b===document.activeElement;if(f)S.focusEased++;
        if((f?op!=='1':Number(op)>=0.05)&&S.bad.length<12)S.bad.push(Math.round(performance.now()-t0)+' ms '+(p.dataset.peMark||b.dataset.ren)+(f?' (focused)':'')+' opacity '+op+' [plate '+p.getAnimations().filter(a=>!a.animationName).map(a=>Math.round(a.startTime)+'/'+Math.round(a.currentTime)+'/'+a.effect.getTiming().duration+'/'+a.playState).join(',')+' pencil '+b.getAnimations().map(a=>(a.animationName||a.transitionProperty||'waapi')+':'+Math.round(a.startTime)+'/'+Math.round(a.currentTime)+'/'+Math.round(a.effect.getTiming().duration)+'/'+a.playState).join(',')+' cls '+p.className+']');}
        S.samples++;if(performance.now()-t0<900)requestAnimationFrame(step);else S.done=true;};
      step();
      return [...document.querySelectorAll('#stage .ro-plate')].filter(p=>${EASE_OF}(p)).length})()`);
    /* nothing eased and the window is larger than the X screen (a Windows runner's 1024x768 under a 1440x900 window printed 0 plates easing): every check below
       needs plates on their way, so the run ends here, labelled, with the numbers; with the window inside the screen it goes on and fails as before */
    if (easing === 0) {
      const sc0 = await screenInfo(), win0 = sc0.view.map((v) => v * sc0.dpr);
      if (windowOutsideScreen({ win: win0, screen: sc0.screen, at: sc0.at })) {
        log(tag, `skipped: no plate eased (0 of ${n} plates easing at the start) and the window is larger than the X screen (screen ${sc0.screen.join('x')} device px, window content ${win0.join('x')} at ${sc0.at.join(',')}, devicePixelRatio ${sc0.dpr}): the checks that need plates on their way, the opacity reads, the frames and the status changes, are not run for this size; the product's ease under a clipped window is not shown here`);
        try { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }); dbg.detach(); } catch (e) { /* the page went */ }
        continue;
      }
    }
    if (MUTANT === 'late') await ctx.sleep(700);
    const t0 = Date.now(), frames = [];
    /* a frame's time is when its capture was REQUESTED (a slow compositor hands the image back later, which says nothing about whether the harness started on time:
       a first request 700 ms late is the late mutant, a first request on time whose image arrives 250 ms later is a slow capture, skipped below) */
    while (Date.now() - t0 < SPAN) { const req = Date.now() - t0; if (CAPTURE_DELAY) await ctx.sleep(CAPTURE_DELAY); const img = await wc().capturePage(); frames.push({ t: req + (MUTANT === 'late' ? 700 : 0), img }); if (SLOW_CAP) await ctx.sleep(SLOW_CAP); }
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row`, 8000);
    await must(STILL + '&&!!(window.__peS||{}).done', `${tag}: the ease is over (no WAAPI animation running in #stage)`, 5000);
    const S = await js(`window.__peS`);
    /* the end frame: the ease and the pencils' 120 ms fade over (no WAAPI animation in #stage), every pencil at its CSS opacity (ren-show: 1), then a
       capture that shows every marked plate; a slow (software) compositor can hand back an older frame, so it is taken again, up to 3 s (review of PR 1555:
       Linux/Xvfb at DPR 2 lost 4..6 plates in the one end capture) */
    await must(STILL + `&&[...document.querySelectorAll('#stage .ren.ro-ren')].every(b=>getComputedStyle(b).opacity==='1')`, `${tag}: every pencil back at its CSS opacity (1 under ren-show)`, 5000);
    /* no hover card over the plates in the end frame: the pointer parked on a spot outside the office (an X server's own pointer may rest mid-window:
       Linux/Xvfb showed Ada's card over two plates, review of PR 1555) and the focus taken off the pencil */
    /* the spot is on the part of the page that is on the screen too (scripts/pencil-park.js: a window taller than a small X screen is cut by it, and a pointer put
       in the cut part never leaves the plate: Linux/Xvfb at DPR 2, review of PR 1555); PENCIL_EASE_SCREEN stands in for a small screen here as below */
    const pg0 = await screenInfo();
    let cardStays = false;
    const outside = windowOutsideScreen({ win: pg0.view.map((v) => v * pg0.dpr), screen: pg0.screen, at: pg0.at }); /* the real pointer cannot be trusted to leave the plates then */
    const cands = MUTANT === 'parkold' ? [{ x: Math.round(pg0.view[0] / 2), y: Math.max(1, Math.round(pg0.top) - 4) }] : parkCandidates(pg0); /* parkold: the first version's point, whatever the screen */
    /* a spot no hover target is under: not in the office at all (its desk, monitor, person, table, marquee or plate opens the card: FR-327) */
    const HOVER = '.ro, #stage, .ro-screen, .ro-person, .ro-person2, .ro-rig, .ro-initials, .ro-marquee, .ro-desk, .ro-ltable, .ro-plate, [data-hover-target]';
    const free = await js(`${jsLiteral(cands)}.filter(c=>{const e=document.elementFromPoint(c.x,c.y);return !e||!e.closest(${jsLiteral(HOVER)})})`);
    const where = `pointer ${free.length ? free[0].x + ',' + free[0].y : 'none'} css px; screen ${pg0.screen.join('x')} device px; window content ${pg0.view.map((v) => v * pg0.dpr).join('x')} device px at ${pg0.at.join(',')}; devicePixelRatio ${pg0.dpr}`;
    assert.ok(free.length > 0, `${tag}: a spot outside the plates on the visible screen to park the pointer (${where})`);
    const park = free[0];
    const chain = await js(`(()=>{const out=[];for(let e=document.elementFromPoint(${jsLiteral(park.x)},${jsLiteral(park.y)});e&&out.length<6;e=e.parentElement)out.push(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).join('.'):''));return out.join(' < ')})()`);
    assert.ok(!(await js(`(()=>{const e=document.elementFromPoint(${jsLiteral(park.x)},${jsLiteral(park.y)});return !!(e&&e.closest(${jsLiteral(HOVER)}))})()`)), tag + ': the parked pointer is over no hover target (plate, desk, monitor, person, table; ' + where + '; element chain: ' + chain + ')');
    assert.ok(parkVisible(park, pg0), `${tag}: the pointer is parked on the visible screen (${where})`);
    wc().sendInputEvent({ type: 'mouseMove', x: park.x, y: park.y });
    await js(`(()=>{const a=document.activeElement;if(a&&a.closest&&a.closest('#stage'))a.blur();return 1})()`);
    if (MUTANT === 'hover') { /* a pointer left on a working desk's plate: its card opens over the room */
      const c = await js(`(()=>{const r=document.querySelector('#stage .ro-plate.st-working').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y }); await H.until(`!!document.getElementById('roZoom')`, 3000);
    } else {
      if (MUTANT === 'pin') { /* the pointer that did not leave (an X server that does not move it): back on a working plate, its card open */
        const c = await js(`(()=>{const r=document.querySelector('#stage .ro-plate.st-working').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y }); await H.until(`!!document.getElementById('roZoom')`, 3000);
      }
      const closed = await H.until(`!document.getElementById('roZoom')`, 3000);
      const cardText = closed ? '-' : await js(`(()=>{const z=document.getElementById('roZoom');return z?z.textContent.slice(0,40):'-'})()`);
      /* a window larger than the X screen (Linux/Xvfb 1280x1024): the real pointer is not trusted to leave the plates, so a card that stays is a labelled skip,
         never a timeout; a card that closed is checked as everywhere */
      if (!closed && outside) { cardStays = true; log(tag, `skipped: the pointer-dependent checks (the hover card closing, none open in the end frame) need the window inside the screen: the card over ${cardText} stayed open; screen ${pg0.screen.join('x')} device px, window content ${pg0.view.map((v) => v * pg0.dpr).join('x')} at ${pg0.at.join(',')}, devicePixelRatio ${pg0.dpr}: land the screen sizing first (spec 097 FR-365); the opacity reads, the box checks and the end state still apply`); }
      else assert.ok(closed, tag + ': the hover card closed after the pointer left (' + where + '; a card over: ' + cardText + ')');
    }
    const keys = [...Array(n)].map((_, i) => String(i + 1));
    const lostIn = (m) => keys.filter((i) => !m['pen:' + i] || !(m['name:' + i] || m['status:' + i]));
    /* the plates off the X screen: an Xvfb screen smaller than the window (1280x1024 device px for a 2880x1800 window at DPR 2) leaves them unpainted;
       PENCIL_EASE_SCREEN=<W>x<H> (device px) stands in for such a screen */
    const scr = await js(`(()=>{const d=devicePixelRatio,want=${jsLiteral(SCREEN)},m=/^(\\d+)x(\\d+)$/.exec(want),sw=m?+m[1]/d:screen.width,sh=m?+m[2]/d:screen.height,ox=screenX+(outerWidth-innerWidth),oy=screenY+(outerHeight-innerHeight);
      return {dpr:d,screen:[Math.round(sw*d),Math.round(sh*d)],win:[Math.round(innerWidth*d),Math.round(innerHeight*d)],at:[Math.round(ox*d),Math.round(oy*d)],
        off:[...document.querySelectorAll('#stage .ro-plate[data-pe-mark]')].filter(p=>{const r=p.getBoundingClientRect();return ox+r.right>sw||oy+r.bottom>sh||r.bottom>innerHeight||r.right>innerWidth||r.top<0||r.left<0}).map(p=>p.dataset.peMark)}})()`);
    log(tag, `screen ${scr.screen.join('x')} device px, window content ${scr.win.join('x')} device px at ${scr.at.join(',')}; ${scr.off.length} of ${n} plates off the screen${scr.off.length ? ' (' + scr.off.join(',') + ')' : ''}`);
    const off = new Set(scr.off);
    let endImg = null, end = null, tries = 0;
    for (const until = Date.now() + 3000; ;) {
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
      endImg = await wc().capturePage(); tries++;
      if (PLAIN) break;
      end = marks(endImg, w);
      if (!lostIn(end).filter((i) => !off.has(i)).length || Date.now() > until) break;
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
      if (!cardStays) assert.ok(!(await js(`!!document.getElementById('roZoom')`)), `${tag}: no hover card is open over the plates in the end frame`);
      if (off.size) log(tag, `skipped: painted end-state check: ${off.size} of ${n} plates are off the X screen or outside the window's view (screen ${scr.screen.join('x')} device px, window ${scr.win.join('x')} at ${scr.at.join(',')}): plates ${[...off].join(',')}; their opacity reads still apply`);
      const lost = lostIn(end).filter((i) => !off.has(i));
      let painted = true;
      if (SKIP_PAINTED && !lost.length) lost.push(...keys.slice(-1)); /* the fallback's path, on demand */
      if (lost.length) {
        /* say why, per plate: the parts found anywhere, the closest colour near the plate, the boxes, the pencil's style and what is on top of it */
        const pg = await js(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}};return {dpr:devicePixelRatio,view:[innerWidth,innerHeight],screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],
          plates:Object.fromEntries([...document.querySelectorAll('#stage .ro-plate[data-pe-mark]')].map(p=>{const b=p.nextElementSibling,ic=b&&(b.querySelector('svg')||b),c=ic&&r(ic),cs=b&&getComputedStyle(b),top=c&&document.elementFromPoint(c.x+c.w/2,c.y+c.h/2),nb=p.querySelector('.ro-l1>b'),nc=nb&&nb.getClientRects().length?r(nb):null,ntop=nc&&document.elementFromPoint(nc.x+nc.w/2,nc.y+nc.h/2);
            return [p.dataset.peMark,{plate:r(p),icon:c,pen:cs&&[cs.opacity,cs.visibility,cs.display].join('/'),onIcon:top?top.tagName+'.'+String(top.className&&top.className.baseVal!==undefined?top.className.baseVal:top.className).split(' ')[0]:'-',name:nc,onName:ntop?ntop.tagName+'.'+String(ntop.className&&ntop.className.baseVal!==undefined?ntop.className.baseVal:ntop.className).split(' ')[0]:'-'}]}))}})()`);
        const sz = endImg.getSize(), sc = sz.width / w, R = (o) => o && [o.x, o.y, o.w, o.h].map((v) => Math.round(v));
        log(tag, `end frame: capture ${sz.width}x${sz.height} for a ${pg.view.join('x')} view at devicePixelRatio ${pg.dpr} (screen ${pg.screen.join('x')}); ${keys.length - lost.length} of ${keys.length} plates found`);
        for (const i of lost) {
          const q = pg.plates[i] || {}, nr = q.plate ? nearest(endImg, q.plate, sc, i) : {};
          log(tag, `missing plate ${i}: found pen ${!!end['pen:' + i]} name ${!!end['name:' + i]} status ${!!end['status:' + i]}; nearest colour in its box: pen ${nr.pen}, name ${nr.name}, status ${nr.status}; plate css ${JSON.stringify(R(q.plate))} device ${JSON.stringify(R(q.plate && { x: q.plate.x * sc, y: q.plate.y * sc, w: q.plate.w * sc, h: q.plate.h * sc }))}; icon ${JSON.stringify(R(q.icon))}; pencil opacity/visibility/display ${q.pen}; on the icon ${q.onIcon}, on the name ${q.onName}`);
        }
        /* DPR 2 under a software compositor (Linux/Xvfb) loses some marks even in a settled frame (review of PR 1555): the painted checks are skipped there,
           said in the log, never passed; the opacity reads (capture-free) still fail a pencil shown while its plate eases. At DPR 1 it fails. */
        if (pg.dpr >= 2 || SKIP_PAINTED) { painted = false; log(tag, `skipped: DPR 2 painted check (marker detection unreliable under software compositing: ${keys.length - lost.length} of ${keys.length} plates found); the opacity reads still apply`); }
        else assert.deepStrictEqual(lost, [], `${tag}: every marked plate's pencil and name (or status) is found in the end frame (${tries} captures in 3 s)`);
      }
      /* the frames saw the ease: in the first 200 ms, frames where some plate's painted name or status is away from where it ends */
      if (painted) {
      const away = (m) => keys.some((i) => ['name', 'status'].some((p) => { const a = m[p + ':' + i], z = end[p + ':' + i]; return a && z && Math.max(Math.abs(a.x - z.x), Math.abs(a.y - z.y), Math.abs(a.r - z.r)) >= 3; }));
      for (const f of frames) f.m = marks(f.img, w);
      const caught = frames.filter((f) => f.t <= 200 && away(f.m));
      log(tag, caught.length, 'frames mid-move in the first 200 ms; painted pencils per frame', frames.map((f) => keys.filter((i) => f.m['pen:' + i]).length).join(','));
      /* a compositor whose captures take over 40 ms each (Linux/Xvfb at DPR 2: ~100 ms) cannot give 3 frames in 200 ms: that assert is then skipped, said
         in the log, never passed; the opacity reads below do not depend on the capture and still fail a pencil shown while its plate eases */
      const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b), gap = gaps.length ? gaps[gaps.length >> 1] : SPAN;
      const early = frames.filter((f) => f.t <= 200).length; /* some frames, but sparse (a burst of slow captures at DPR 1: 1 mid-move frame of 5, Linux/Xvfb): too slow too; none at all (the late mutant: the capture did not run in time) is a failure, slow or not */
      if (caught.length < MIN_CAUGHT && early > 0 && (gap > 40 || early < 2 * MIN_CAUGHT)) log(tag, `skipped: capture too slow (${caught.length} frames mid-move and ${early} frames in the first 200 ms, ${frames.length} in ${SPAN} ms, a capture every ${gap} ms): the painted check saw few frames; the opacity reads still apply`);
      else assert.ok(caught.length >= MIN_CAUGHT, `${tag}: ${MIN_CAUGHT} or more frames caught the plates on their way in the first 200 ms (got ${caught.length}; frames at ${frames.map((f) => f.t).join(',')} ms): too few means the captures are slower than the ease on this machine, so nothing was tested; not a pass`);
      /* in every frame: no pencil's painted icon over its own plate's painted name, role or status (the focused one may be: FR-365's known gap) */
      const bad = [];
      for (const f of frames) for (const i of keys) {
        if (off.has(i)) continue; /* off the X screen: skipped, said above */
        const pen = f.m['pen:' + i];
        if (!pen || i === focusMark) continue; /* not painted (hidden while its plate eases) */
        for (const p of ['name', 'role', 'status']) if (f.m[p + ':' + i] && overlap(pen, f.m[p + ':' + i])) bad.push(`${f.t} ms plate ${i}: the pencil ${JSON.stringify(rd(pen))} over its ${p} ${JSON.stringify(rd(f.m[p + ':' + i]))}`);
      }
      if (bad.length) log(tag, 'painted over:', bad.slice(0, 8).join('; '));
      assert.deepStrictEqual(bad, [], `${tag}: no pencil is painted over its plate's name, role or status while the plates ease`);
      }
      /* a half-shown pencil blends and matches no colour: the page's opacity reads cover it */
      assert.ok(S.moving > 0 && S.focusEased > 0, `${tag}: the opacity reads saw moving plates, the focused pencil's among them (${JSON.stringify(S)})`);
      const focBad = S.bad.filter((x) => x.includes('(focused)')), restBad = S.bad.filter((x) => !x.includes('(focused)'));
      assert.deepStrictEqual(restBad, [], `${tag}: each moving plate's pencil is at opacity 0 (under 0.05) for as long as its plate eases`);
      assert.deepStrictEqual(focBad, [], `${tag}: the focused pencil stays shown (opacity 1) while its plate eases`);
      /* at the end: every pencil painted, just after its painted name, clear of the role and status; and by its boxes */
      const endBad = [], dsc = endImg.getSize().width / w;
      for (const i of painted ? keys.filter((k) => !off.has(k)) : []) {
        const pen = end['pen:' + i], nm = end['name:' + i];
        for (const p of ['name', 'role', 'status']) if (end[p + ':' + i] && overlap(pen, end[p + ':' + i])) endBad.push(`plate ${i}: the pencil over its ${p}`);
        /* the offset in CSS px (the marks are device px): the DOM's own gap is 0..8 (asserted below); the painted one may differ from the layout's by the
           icon's own padding and antialiasing, 3 CSS px at most (derived, not a number tuned to one machine: 5 CSS px measured on Linux/Xvfb at DPR 2, 6 on the Mac) */
        if (nm && (((pen.x - nm.r) / dsc < -1) || ((pen.x - nm.r) / dsc > 8 + 3))) endBad.push(`plate ${i}: the pencil ${Math.round((pen.x - nm.r) / dsc)} CSS px after its name (at most 11)`);
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
    /* a pencil that gets the focus while it is hidden (its plate eases): its opacity is 1 from the focus on, through the end of the ease and the 120 ms after it:
       its focus ring never vanishes (FR-365); the old listener left the cancelled hold as the pencil's current one, and the end of the ease faded it in from 0 */
    const fr = await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(who)});a.state='waiting';a.lastEventAt=Date.now();${SIM}.crew.renderAll();
      const b=[...document.querySelectorAll('#stage .ren.ro-ren')].find(b=>b!==document.activeElement&&${EASE_OF}(b.previousElementSibling)&&Number(getComputedStyle(b).opacity)<0.05);
      if(!b)return null;
      if(${jsLiteral(MUTANT)}==='oldfocus'){const h=b._hide;b.addEventListener('focus',()=>{b._hide=h},{once:true})} /* the old listener: the cancelled hold stays the current one */
      b.focus();if(!document.hasFocus())b.dispatchEvent(new FocusEvent('focus')); /* a window the OS has not focused sets the active element but fires no focus event */
      const F=window.__peF={min:1,n:0,at:'',done:false,k:b.dataset.ren},p=b.previousElementSibling,t0=performance.now();let end=0;
      const step=()=>{const now=performance.now(),o=Number(getComputedStyle(b).opacity);F.n++;if(o<F.min){F.min=o;F.at=Math.round(now-t0)+' ms'+(${EASE_OF}(p)?' (easing)':' (ease over)')}
        if(!${EASE_OF}(p)&&!end)end=now;if((end&&now-end>300)||now-t0>3000)F.done=true;else requestAnimationFrame(step)};
      step();return b.dataset.ren})()`);
    assert.ok(fr, `${tag}: a hidden mover's pencil to focus mid-ease (waiting puts the desk first in its room)`);
    await must(`!!(window.__peF||{}).done`, `${tag}: the focused pencil sampled to 300 ms past its plate's ease`, 6000);
    const F = await js(`window.__peF`);
    log(tag, `focus during the hold: pencil ${F.k}, ${F.n} frames, lowest opacity ${F.min} ${F.at}`);
    assert.ok(F.min >= 0.99, `${tag}: a pencil focused while hidden stays at opacity 1 through the end of its plate's ease (lowest ${F.min} at ${F.at}, ${F.n} frames)`);
    await js(`(()=>{const a=${SIM}.agents().find(x=>x.id===${jsLiteral(who)});a.state='working';a.lastEventAt=Date.now();${SIM}.crew.renderAll();return 1})()`);
    await js(`(()=>{const a=document.activeElement;if(a&&a.blur)a.blur();return 1})()`);
    await must(STILL, `${tag}: still after the focus case`, 5000);
    log(tag, 'status changes:', blinks.join('; '));
    assert.ok(blinks.every((b) => / 0 of a still plate$/.test(b)) && /^thinking: 0 plates eased, 0 pencils hidden/.test(blinks[0]), `${tag}: a status change hides only the pencils of plates that move (${blinks.join('; ')})`);
    log(tag, 'ok');
    try { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }); dbg.detach(); } catch (e) { /* the page went: nothing to undo */ }
  }
  }
  console.log('[097-pencil-ease] ok');
  process.exitCode = 0;
};
