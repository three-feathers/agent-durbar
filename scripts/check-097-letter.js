/*
 * Spec 097 FR-377 (bug, issue #1587): when a schedule fires, the letter flies from the Postbox to the agent's plate in the Real office (spec 001 FR-038).
 * Simulator only (DURBAR_SIM=15, `simsched=1&simschedfire=300`: the one-off run for the first idle agent, made due at once by the driver), no AI credits.
 *
 *   npm run check:ui -- --only check-097-letter                (Photo office; builds first)
 *   DRIVER_WORLD=retro|cave  ...                               (the Retro arcade / the Prehistoric cave: the suite's `check-097-letter retro` and `cave` entries)
 *
 * The run is fired by the driver (`__durbarSimSched.dueNow`) after the page is set up for the case, and every case first proves the run fired (the simulator's `probe.ranCalls`: a run that fired
 * during the page load fails there, a "no letter" never passes by accident). Each letter's own `remove()` is switched off (`__lt.removeCalled` counts the page's removal calls), so the letter
 * stays at its end point for the reads; the driver removes it itself at the end.
 *
 * At 1440x900 and 1280x800 it fails (exit 1) when, with the Real office drawn:
 *   - `the letter flies in the <world> at <size>`: no `#walkers .letter` appears when the run fires (the page under reduced motion, which the suite's
 *     Electron may report, is checked the other way round: `no letter under reduced motion`, after the run was seen to call `flyLetter`);
 *   - `the letter starts at the Postbox`: its first frame is not within 4 px of the centre of `.ro-lplate[data-post]`;
 *   - `the letter is for the agent` / `the letter reaches the plate`: its `data-for` is not an agent of the office with a `.ro-plate`, or, once it has landed, it is not inside
 *     that plate's rect with its centre within 2 px of the plate's centre (the settled end point: a frame read in flight cannot make this pass);
 *   - `the letter is removed once it lands` / `one letter`: the page never asked to remove it (at the transition's end or after 1.6 s), or more than one was made;
 *   - `the letter has its chip`: not 16x12 px or more, no backing, no card shadow (the arcade: no shadow and a 1 px solid outline);
 *   - `the letter reads on the picture`: in a real capture (`capturePage`) its strongest pixel against the one behind it (a capture with the
 *     letter hidden) is under 3:1 (WCAG 1.4.11), or it is not painted at all;
 *   - the scrolled case (1280x800, Photo office; the labels end in `(1280x800 scrolled)`): with `#floor` scrolled down 40 px at the time of the run, the letter does not start at the Postbox or end at the plate;
 *   - `no letter when the plate is off screen` / `... the Postbox is off screen` / `... the desk is off screen in the flat office` (1440x900; the last two in the Photo run only), and
 *     `a letter when the plate is partly on screen`: with the plates (or the Postbox, or the flat desks) moved out of the window before the run fires, a letter flies anyway;
 *     with the plates half outside the floor, none flies.
 *   Source mutants (run by hand, the dist copy, never `check:ui`, which builds first and copies src over dist): `npm run build`, edit dist/renderer/app.js, run
 *   `UI_SUITE_XVFB=1 node scripts/ui-suite.js --only check-097-letter`, then `npm run build` again. Each fails at the label named:
 *     1. in flyLetter delete `, #stage .ro-lplate[data-post]` and `, #stage .ro-plate[data-id="${CSS.escape(String(agentId))}"]` (the flat lookup): `the letter flies in the Photo office at 1440x900`;
 *     2. delete `if(!seen(a)||!seen(b))return;`: `no letter when the plate is off screen`;
 *     3. replace it by `if(!seen(b))return;` (the Postbox half dropped): `no letter when the Postbox is off screen`;
 *     4. make `seen` need the whole rect inside the floor: `a letter when the plate is partly on screen`;
 *     5. in `c` drop `+floor.scrollLeft` and `+floor.scrollTop`: `the letter starts at the Postbox (1280x800 scrolled)`;
 *     6. `if(real&&(!seen(a)||!seen(b)))return;` (the guard only in the Real office): `no letter when the desk is off screen in the flat office`;
 *     7. `to={x:to.x+5,y:to.y}` after `const from=...`: `the letter reaches the plate`.
 *   SHOTS_OUT=<dir> writes 097-letter-<world>-<w>x<h>-end.jpg (at the plate); LETTER_FLIGHT=1 instead holds it half way, writes -flight.jpg and runs no other check (pictures only).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const KEY = process.env.DRIVER_WORLD === 'retro' ? 'retro' : process.env.DRIVER_WORLD === 'cave' ? 'cave' : 'photo';
const WORLD = { retro: 'Retro arcade', cave: 'Prehistoric cave', photo: 'Photo office' }[KEY];
const SIZES = [[1440, 900], [1280, 800]];
const OUT = process.env.SHOTS_OUT || process.env.SHOTS_097_LETTER || require('os').tmpdir();
const FLIGHT = process.env.LETTER_FLIGHT === '1'; // pictures only: the letter is held half way for a capture, and stays (its own removal is off in this page)
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const reduced = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  const realReady = `document.querySelectorAll('#stage .ro-plate[data-id]').length>=10&&!!document.querySelector('#stage .ro-lplate[data-post]')`;
  const flatReady = `document.querySelectorAll('#stage .desk[data-id]').length>=15&&!!document.querySelector('#stage .place.postbox')`;
  /* before the run: note the floor's scroll when a letter is added, and switch each letter's own remove() off (the page's removal calls are counted).
     The run is fired by the driver (`__durbarSimSched.dueNow`) once the page is as the case wants it, and counted by the simulator (`probe.ranCalls`: the page was told of a run), so a "no letter" is read only after a run that was seen to fire */
  const ran = `__durbarSimSched.probe.ranCalls`;
  const fire = async (label) => { assert.strictEqual(await js(ran), 0, `${label}: the run fired before the page was set up (the check would prove nothing)`); assert.ok(await js(`__durbarSimSched.dueNow('sched-fire')`), `${label}: no one-off run to fire`); };
  const watch = `(()=>{window.__lt={n:0,scroll:null,removeCalled:0,first:null,post:null,el:null,mid:false};const lay=document.getElementById('walkers');
    new MutationObserver(m=>m.forEach(r=>r.addedNodes.forEach(n=>{if(n.classList&&n.classList.contains('letter')){window.__lt.n++;window.__lt.el=n;window.__lt.for=n.dataset.for;window.__lt.scroll=document.getElementById('floor').scrollTop;n.remove=function(){window.__lt.removeCalled++;};
      const b=n.getBoundingClientRect();window.__lt.first={x:b.left+b.width/2,y:b.top+b.height/2};const pb=document.querySelector('#stage .ro-lplate[data-post], #stage .place.postbox'),q=pb.querySelector('.pic')?pb.querySelector('.pic').getBoundingClientRect():pb.getBoundingClientRect();window.__lt.post={x:q.left+q.width/2,y:q.top+q.height/2};}}))).observe(lay,{childList:true});
    const rect=e=>{const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};};
    const tick=()=>{const e=window.__lt.el;if(e&&e.isConnected&&${jsLiteral(FLIGHT)}&&!window.__lt.mid&&e.classList.contains('flying')){const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(window.__lt.for)+'"]');
      if(p){const r=rect(e),q=rect(p),f=window.__lt.first,d0=Math.hypot(q.x-f.x,q.y-f.y),d1=Math.hypot(r.x-f.x,r.y-f.y);
        if(d0>60&&d1>=0.4*d0){window.__lt.mid=true;const tr=getComputedStyle(e).transform;e.style.transition='none';e.style.transform=tr;}}} /* held half way for the picture */
      requestAnimationFrame(tick);};requestAnimationFrame(tick);return true})()`;
  const capture = async () => ctx.win.webContents.capturePage();
  const shot = (file) => ctx.shot(file); // main's shot: the compressed picture of the window (docs pictures are never raw captures)
  const park = () => H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); // a virtual display's pointer rests mid-window and opens a hover card over the plate
  const loadReal = async (w, h) => { await H.load({ w, h, query: { officeview: 'real', sim: '15', simsched: '1', simschedfire: '300' }, ready: realReady, readyMs: 30000, settle: false }); assert.ok(await js(`!!document.querySelector('#stage .ro')`), `${w}x${h}: a Real office is drawn`); park(); assert.ok(await js(watch), 'the page could not be watched'); };

  /* the whole check of one letter: where it starts, where it ends, its chip, its pixels; `scrolled`: #floor is scrolled when the run fires (no pictures then) */
  const flight = async (w, h, scrolled) => {
    const tag = scrolled ? `${w}x${h} scrolled` : `${w}x${h}`;
    await loadReal(w, h);
    if (scrolled) {
      await js(`(()=>{const f=document.getElementById('floor');f.classList.add('scrolls');const sp=document.createElement('div');sp.id='letter-spacer';sp.style.cssText='height:2000px;width:1px';f.appendChild(sp);f.scrollTop=40;})()`);
      assert.ok(await js(`document.getElementById('floor').scrollTop>0`), `the letter flies with the floor scrolled (${tag}): the floor did not scroll`);
    }
    await fire(`the letter flies in the ${WORLD} at ${tag}`);
    assert.ok(await until(`${ran}>=1`, 5000), `the letter flies in the ${WORLD} at ${tag}: the run never fired`);
    if (reduced) {
      await ctx.sleep(500);
      assert.strictEqual(await js(`window.__lt.n`), 0, `no letter under reduced motion (${tag})`);
      return;
    }
    assert.ok(await until(`window.__lt.n>=1`, 3000), `the letter flies in the ${WORLD} at ${tag}`);
    if (FLIGHT) { /* the picture only: the held letter is not the one the checks below read */
      assert.ok(await until(`window.__lt.mid`, 3000), `the letter flies in the ${WORLD} at ${tag}: it never got half way to its plate`);
      await shot(path.join(OUT, `097-letter-${KEY}-${tag}-flight.jpg`));
      return;
    }
    /* the page asks to remove it when the flight ends (at the transition's end or after 1.6 s): by then it has settled at its end point, and (its remove() being off here) it is still there to read */
    assert.ok(await until(`window.__lt.removeCalled>=1`, 3000), `the letter is removed once it lands (${tag}): the page never asked to remove it`);
    const lt = await js(`(()=>{const L=window.__lt,p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(L.for||'')+'"]'),b=p&&p.getBoundingClientRect(),e=L.el,r=e.getBoundingClientRect(),cs=getComputedStyle(e);
      return {n:L.n,scroll:L.scroll,post:L.post,first:L.first,for:L.for,last:{l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,x:r.left+r.width/2,y:r.top+r.height/2},plate:b?{l:b.left,t:b.top,r:b.right,b:b.bottom,x:b.left+b.width/2,y:b.top+b.height/2}:null,
        ink:cs.color,real:e.classList.contains('real'),bg:cs.backgroundColor,shadow:cs.boxShadow,outline:cs.outlineStyle+' '+cs.outlineWidth,connected:e.isConnected,
        agent:window.__durbarSimUi.agents().some(a=>a.id===L.for)}})()`);
    if (scrolled) assert.ok(lt.scroll > 0, `the letter flies with the floor scrolled (${tag}): the floor was at ${lt.scroll} when the run fired`);
    assert.ok(lt.agent && lt.plate, `the letter is for the agent (${tag}): data-for "${lt.for}" is not an agent with a plate`);
    assert.ok(lt.connected, `the letter is removed once it lands (${tag}): the letter was not there to read`);
    assert.ok(Math.abs(lt.first.x - lt.post.x) <= 4 && Math.abs(lt.first.y - lt.post.y) <= 4, `the letter starts at the Postbox (${tag}): first frame ${JSON.stringify(lt.first)}, Postbox centre ${JSON.stringify(lt.post)}`);
    assert.ok(lt.last.l >= lt.plate.l && lt.last.r <= lt.plate.r && lt.last.t >= lt.plate.t && lt.last.b <= lt.plate.b, `the letter reaches the plate (${tag}): ${JSON.stringify(lt.last)} not inside ${JSON.stringify(lt.plate)}`);
    assert.ok(Math.abs(lt.last.x - lt.plate.x) <= 2 && Math.abs(lt.last.y - lt.plate.y) <= 2, `the letter reaches the plate (${tag}): its centre ${JSON.stringify([lt.last.x, lt.last.y])} is more than 2 px from the plate's centre ${JSON.stringify([lt.plate.x, lt.plate.y])}`);
    assert.ok(lt.real, `the letter is the Real office's (${tag}): no .real class`);
    const arcade = KEY === 'retro';
    assert.ok(lt.last.w >= 16 && lt.last.h >= 12 && lt.bg !== 'rgba(0, 0, 0, 0)' && (arcade ? lt.shadow === 'none' && /^solid 1px$/.test(lt.outline) : lt.shadow !== 'none'),
      `the letter has its chip (${tag}): size ${lt.last.w}x${lt.last.h}, backing ${lt.bg}, shadow ${lt.shadow}, outline ${lt.outline}`);
    if (!scrolled) {
      /* the picture, with the letter at the plate: once with it, once with it hidden; the pixels that differ are the letter's, each read against the one behind it */
      await ctx.sleep(120);
      await shot(path.join(OUT, `097-letter-${KEY}-${tag}-end.jpg`));
      const img = await capture();
      await js(`window.__lt.el.style.visibility='hidden'`);
      await ctx.sleep(120);
      const bare = await capture();
      await js(`window.__lt.el.style.visibility=''`);
      const { width: iw, height: ih } = img.getSize(), s = iw / w, A = img.toBitmap(), B = bare.toBitmap(); // BGRA
      let painted = 0, best = 0;
      for (let y = Math.floor((lt.last.t - 3) * s); y <= Math.ceil((lt.last.b + 3) * s); y++) for (let x = Math.floor((lt.last.l - 3) * s); x <= Math.ceil((lt.last.r + 3) * s); x++) {
        if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
        const i = (y * iw + x) * 4;
        if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) < 12) continue;
        painted++; best = Math.max(best, ratio(lum(A[i + 2], A[i + 1], A[i]), lum(B[i + 2], B[i + 1], B[i])));
      }
      const line = `[097-letter] ${WORLD} ${tag}: letter ink ${lt.ink}, ${painted} painted pixels, strongest ${best.toFixed(2)}:1 against what is behind`;
      console.log(line);
      if (process.env.SHOTS_OUT) fs.appendFileSync(path.join(OUT, '097-letter-pixels.txt'), line + '\n'); // the suite hides a passing driver's output: with SHOTS_OUT the numbers are kept
      assert.ok(painted >= 20, `the letter reads on the picture (${tag}): only ${painted} pixels differ with it hidden (is something drawn over it?)`);
      assert.ok(best >= 3, `the letter reads on the picture (${tag}): its strongest pixel is ${best.toFixed(2)}:1 against what is behind it (need 3:1)`);
    }
    await js(`Element.prototype.remove.call(window.__lt.el)`); // the driver's own removal: the page's was switched off
    assert.ok(await until(`!document.querySelector('#walkers .letter')`, 1000), `the letter is removed once it lands (${tag})`);
    assert.strictEqual(await js(`window.__lt.n`), 1, `one letter (${tag})`);
  };

  /* an end that is off screen or half out: the run fired and reached flyLetter (the positive control), then a letter or none */
  const endCase = async ({ label, flat, css, hold, letters }) => {
    const query = flat ? { sim: '15', simsched: '1', simschedfire: '300' } : { officeview: 'real', sim: '15', simsched: '1', simschedfire: '300' };
    await H.load({ w: 1440, h: 900, query, ready: flat ? flatReady : realReady, readyMs: 30000, settle: false });
    park();
    assert.ok(await js(watch), 'the page could not be watched');
    await js(`(()=>{const fr=document.getElementById('floor').getBoundingClientRect(),s=document.createElement('style');s.id='letter-off';s.textContent=${jsLiteral(css)}.replace(/FLOORLEFT/g,Math.round(fr.left)).replace(/FLOORTOP/g,Math.round(fr.top)+20);document.head.appendChild(s)})()`);
    assert.ok(await until(hold, 3000), `${label}: the ends were not moved`);
    await fire(label);
    assert.ok(await until(`${ran}>=1`, 5000), `${label}: the run never fired`);
    if (reduced) return;
    await ctx.sleep(500);
    assert.strictEqual(await js(`window.__lt.n`), letters, `${label}: ${letters} letter(s) expected`);
  };

  for (const [w, h] of SIZES) await flight(w, h, false);
  if (FLIGHT) return;
  if (KEY === 'photo') await flight(1280, 800, true);
  const plates = `[...document.querySelectorAll('#stage .ro-plate[data-id]')]`;
  await endCase({ label: 'no letter when the plate is off screen', css: '#stage .ro-plate[data-id]{position:fixed!important;left:-9000px!important;top:0!important}',
    hold: `${plates}.length>0&&${plates}.every(p=>p.getBoundingClientRect().right<0)`, letters: 0 });
  if (KEY === 'photo') {
    await endCase({ label: 'no letter when the Postbox is off screen', css: '#stage .ro-lplate[data-post]{position:fixed!important;left:-9000px!important;top:0!important}',
      hold: `document.querySelector('#stage .ro-lplate[data-post]').getBoundingClientRect().right<0`, letters: 0 });
    await endCase({ label: 'a letter when the plate is partly on screen', css: '#stage .ro-plate[data-id]{position:fixed!important;left:calc(FLOORLEFTpx - 20px)!important;top:FLOORTOPpx!important}',
      hold: `${plates}.length>0&&${plates}.every(p=>{const r=p.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect();return r.left<f.left&&r.right>f.left&&r.top>=f.top&&r.bottom<=f.bottom})`, letters: 1 });
    await endCase({ label: 'no letter when the desk is off screen in the flat office', flat: true, css: '#stage .desk[data-id]{position:fixed!important;left:-9000px!important;top:0!important}',
      hold: `document.querySelectorAll('#stage .desk[data-id]').length>0&&[...document.querySelectorAll('#stage .desk[data-id]')].every(p=>p.getBoundingClientRect().right<0)`, letters: 0 });
  }
  console.log(`[097-letter] ${WORLD}: all checks passed`);
};
