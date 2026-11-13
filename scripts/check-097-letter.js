/*
 * Spec 097 FR-377 (bug, issue #1587): when a schedule fires, the letter flies from the Postbox to the agent's plate in the Real office (spec 001 FR-038).
 * Simulator only (DURBAR_SIM=15, `simsched=1&simschedfire=N`: the one-off run for the first idle agent, the path shots-001-lobby uses), no AI credits.
 *
 *   npm run check:ui -- --only check-097-letter                (Photo office; builds first)
 *   DRIVER_WORLD=retro  ...                                    (the Retro arcade: the suite's `check-097-letter retro` entry)
 *
 * At 1440x900 and 1280x800 it fails (exit 1) when, with the Real office drawn:
 *   - `the letter flies in the <world> at <size>`: no `#walkers .letter` appears when the run fires (the page under reduced motion, which the suite's
 *     Electron may report, is checked the other way round: `no letter under reduced motion`);
 *   - `the letter starts at the Postbox`: its first frame is not within 4 px of the centre of `.ro-lplate[data-post]`;
 *   - `the letter is for the agent` / `the letter reaches the plate`: its `data-for` is not an agent of the office with a `.ro-plate`, or its last frame is not inside
 *     that plate's rect with its centre within 4 px of the plate's centre;
 *   - `the letter is removed once it lands` / `one letter`: it stays in `#walkers` after 2.2 s, or more than one was made;
 *   - `the letter reads on the picture`: in a real capture (`capturePage`) with the letter at the plate, its strongest pixel against the one behind it (a capture with the
 *     letter hidden) is under 3:1 (WCAG 1.4.11), or it is not painted at all;
 *   - `no letter when the plate is off screen` (1440x900 only): with every plate moved out of the window before the run fires, a letter flies anyway.
 *   source mutant (run by hand, then `npm run build` again): in dist/renderer/app.js delete `, #stage .ro-lplate[data-post]` and
 *   `, #stage .ro-plate[data-id="${CSS.escape(String(agentId))}"]` from flyLetter (the flat lookup): the driver must fail at `the letter flies in the <world> at 1440x900`;
 *   source mutant 2 (by hand): delete `if(!seen(a)||!seen(b))return;` from flyLetter: it must fail at `no letter when the plate is off screen`
 *   SHOTS_OUT=<dir> writes 097-letter-<world>-<w>x<h>-end.jpg (at the plate); LETTER_FLIGHT=1 instead holds it half way, writes -flight.jpg and runs no other check (pictures only).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const WORLD = process.env.DRIVER_WORLD === 'retro' ? 'Retro arcade' : 'Photo office';
const SIZES = [[1440, 900], [1280, 800]];
const OUT = process.env.SHOTS_OUT || process.env.SHOTS_097_LETTER || require('os').tmpdir();
const FLIGHT = process.env.LETTER_FLIGHT === '1'; // pictures only: the letter is held half way for a capture, then goes on (the 1.6 s removal timer leaves little room, so CI does not)
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const reduced = await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  const ready = `document.querySelectorAll('#stage .ro-plate[data-id]').length>=10&&!!document.querySelector('#stage .ro-lplate[data-post]')`;
  const watch = `(()=>{window.__lt={n:0,first:null,last:null,el:null,hold:${jsLiteral(FLIGHT)}};const lay=document.getElementById('walkers');
    new MutationObserver(m=>m.forEach(r=>r.addedNodes.forEach(n=>{if(n.classList&&n.classList.contains('letter')){window.__lt.n++;window.__lt.el=n;window.__lt.for=n.dataset.for;const b=n.getBoundingClientRect();window.__lt.first={x:b.left+b.width/2,y:b.top+b.height/2};const q=document.querySelector('#stage .ro-lplate[data-post]').getBoundingClientRect();window.__lt.post={x:q.left+q.width/2,y:q.top+q.height/2};}}))).observe(lay,{childList:true});
    const rect=e=>{const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};};
    const tick=()=>{const e=window.__lt.el;if(e&&e.isConnected){const r=rect(e);window.__lt.last=r;
      const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(window.__lt.for)+'"]');
      if(p&&window.__lt.hold&&!window.__lt.mid&&!window.__lt.held&&e.classList.contains('flying')){const q=rect(p),f=window.__lt.first,d0=Math.hypot(q.x-f.x,q.y-f.y),d1=Math.hypot(r.x-f.x,r.y-f.y);
        if(d0>60&&d1>=0.4*d0){window.__lt.mid=true;window.__lt.goal=e.style.transform;const tr=getComputedStyle(e).transform;e.style.transition='none';e.style.transform=tr;window.__lt.last=rect(e);}} /* held half way for the picture */
      if(p&&!window.__lt.held&&(window.__lt.go||!window.__lt.hold)&&e.classList.contains('flying')){const q=rect(p);if(Math.abs(r.x-q.x)<6&&Math.abs(r.y-q.y)<6){window.__lt.held=true;e.style.transition='none';window.__lt.last=rect(e);}}}
      requestAnimationFrame(tick);};requestAnimationFrame(tick);return true})()`;
  const capture = async () => ctx.win.webContents.capturePage();
  const shot = (file) => ctx.shot(file); // main's shot: the compressed picture of the window (docs pictures are never raw captures)
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', simsched: '1', simschedfire: '8' }, ready, readyMs: 30000, settle: false });
    assert.ok(await js(`!!document.querySelector('#stage .ro')`), `${tag}: a Real office is drawn`);
    H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); // a virtual display's pointer rests mid-window and opens a hover card over the plate
    await js(watch);
    if (reduced) {
      await ctx.sleep(11000);
      assert.strictEqual(await js(`window.__lt.n`), 0, `${tag}: no letter under reduced motion`);
      continue;
    }
    assert.ok(await until(`window.__lt.n>=1`, 20000), `the letter flies in the ${WORLD} at ${tag}`);
    /* mid-flight picture, then the end */
    if (FLIGHT) {
      assert.ok(await until(`window.__lt.mid`, 3000), `the letter flies in the ${WORLD} at ${tag}: it never got half way to its plate`);
      await shot(path.join(OUT, `097-letter-${WORLD === 'Photo office' ? 'photo' : 'retro'}-${tag}-flight.jpg`));
      continue; // the picture only: the held letter is not the one the checks below read
    }
    const reached = await until(`window.__lt.held`, 3000);
    const where = JSON.stringify(await js('({last:window.__lt.last,for:window.__lt.for})'));
    assert.ok(reached, `the letter reaches the plate (${tag}): no frame had it at the centre of its plate: ${where}`);
    const lt = await js(`(()=>{const L=window.__lt,p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(L.for||'')+'"]'),b=p&&p.getBoundingClientRect();
      return {n:L.n,post:L.post,first:L.first,last:L.last,for:L.for,plate:b?{l:b.left,t:b.top,r:b.right,b:b.bottom,x:b.left+b.width/2,y:b.top+b.height/2}:null,ink:getComputedStyle(L.el).color,real:L.el.classList.contains('real'),
        agent:window.__durbarSimUi.agents().some(a=>a.id===L.for)}})()`);
    assert.ok(lt.agent && lt.plate, `the letter is for the agent (${tag}): data-for "${lt.for}" is not an agent with a plate`);
    assert.ok(Math.abs(lt.first.x - lt.post.x) <= 4 && Math.abs(lt.first.y - lt.post.y) <= 4, `the letter starts at the Postbox (${tag}): first frame ${JSON.stringify(lt.first)}, Postbox centre ${JSON.stringify(lt.post)}`);
    assert.ok(lt.last.l >= lt.plate.l && lt.last.r <= lt.plate.r && lt.last.t >= lt.plate.t && lt.last.b <= lt.plate.b, `the letter reaches the plate (${tag}): ${JSON.stringify(lt.last)} not inside ${JSON.stringify(lt.plate)}`);
    assert.ok(Math.abs(lt.last.x - lt.plate.x) <= 6 && Math.abs(lt.last.y - lt.plate.y) <= 6, `the letter reaches the plate (${tag}): its centre is more than 6 px from the plate's centre`);
    assert.ok(lt.real, `the letter is the Real office's (${tag}): no .real class`);
    /* the picture, with the letter held at the plate: once with it, once with it hidden; the pixels that differ are the letter's, each read against the one behind it */
    await ctx.sleep(120);
    await shot(path.join(OUT, `097-letter-${WORLD === 'Photo office' ? 'photo' : 'retro'}-${tag}-end.jpg`));
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
    console.log(`[097-letter] ${WORLD} ${tag}: letter ink ${lt.ink}, ${painted} painted pixels, strongest ${best.toFixed(2)}:1 against what is behind`);
    assert.ok(painted >= 20, `the letter reads on the picture (${tag}): only ${painted} pixels differ with it hidden (is something drawn over it?)`);
    assert.ok(best >= 3, `the letter reads on the picture (${tag}): its strongest pixel is ${best.toFixed(2)}:1 against what is behind it (need 3:1)`);
    assert.ok(await until(`!document.querySelector('#walkers .letter')`, 2200), `the letter is removed once it lands (${tag})`);
    assert.strictEqual(await js(`window.__lt.n`), 1, `one letter (${tag})`);
  }

  if (FLIGHT) return;
  /* an end off screen: no letter (the flat office's rule, now in the Real office too) */
  await H.load({ w: 1440, h: 900, query: { officeview: 'real', sim: '15', simsched: '1', simschedfire: '9' }, ready, readyMs: 30000, settle: false });
  await js(watch);
  await js(`(()=>{const s=document.createElement('style');s.id='letter-off';s.textContent='#stage .ro-plate[data-id]{position:fixed!important;left:-9000px!important;top:0!important}';document.head.appendChild(s)})()`);
  assert.ok(await until(`document.querySelectorAll('#stage .ro-plate[data-id]').length>0&&[...document.querySelectorAll('#stage .ro-plate[data-id]')].every(p=>p.getBoundingClientRect().right<0)`, 3000), 'the plates are off screen');
  if (reduced) return;
  await ctx.sleep(12500); /* the run fires 9 s after the simulator starts, a few seconds into this wait */
  assert.strictEqual(await js(`window.__lt.n`), 0, 'no letter when the plate is off screen');
  console.log(`[097-letter] ${WORLD}: all checks passed`);
};
