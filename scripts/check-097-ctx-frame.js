/*
 * Spec 097 FR-322..FR-326 (T225; owner decision Q8, Vikram 2026-11-07 20:20 UTC: "Frame fill and it can go until red as well"): the context line round
 * each desk's monitor frame, in the Photo office, the cave and the arcade. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits; every wait is
 * an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-ctx-frame      (builds first)
 *   CTX_MUTANT=colour|glass|node|unknown   the amber band drawn green / the line moved onto the glass / a node added by every context update / a line for an
 *                                          unknown context (each must fail)
 *   SHOTS_OUT=<dir>                        also saves ctx-<world>-<w>x<h>.png (15 agents, every band) and ctx-<world>-crop-<w>x<h>.png (the three desks, 2x)
 *
 * At 15 agents, 1440x900 and 1280x800, each world, with the context seeded across the bands (4 % .. 100 %) and two agents unknown, it fails (exit 1) when:
 *   - an agent with a context has no line, or its band (data-lv), dash (the share of the outline) or computed stroke is not the existing band's token
 *     (ok below 70 % green, warn 70..90 % amber, high above 90 % red); the line is not aria-hidden; the plate's name lacks ", context N %";
 *   - a line's ring crosses the glass or the screen's text box, or lies inside the glass element; the glass tint is not the state's (not drawn on);
 *   - an unknown context draws a line, or its plate's name carries context words;
 *   - the line animates or transitions; a context event adds or removes a node anywhere in the stage, or does not move the line and the name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.CTX_MUTANT || '';
const OUT = process.env.SHOTS_OUT || '';
const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = [['photo', {}], ['cave', { worldflags: 'cave', world: 'cave' }], ['arcade', { worldflags: 'retro', world: 'retro' }]];
/* one share per main agent, in order: every band, the steps' edges (69/70, 90/91) and a full window; null: unknown (the window waits for the next message) */
const SHARES = [69, 94, 45, 70, null, 30, 90, 62, 97, 18, 91, null, 56, 78, 8];
const BAND = (p) => (p > 90 ? 'high' : p >= 70 ? 'warn' : 'ok');
const TOKEN = { ok: '--green', warn: '--amber', high: '--red' };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const [world, wq] of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', ...wq }, ready: REAL, readyMs: 30000, settle: false });
    await must(PICS, `${tag}: the pictures`, 20000);
    await must(`document.querySelectorAll('#stage .ro-plate[data-id]').length>=10`, `${tag}: the plates`);
    if (MUTANT === 'unknown') await js(`(()=>{window.exports.ctxFrame=(p,l)=>({lv:l==='warn'||l==='high'?l:'ok',dash:(p||0)+' 100'});return 1})()`);
    if (MUTANT === 'colour') await ctx.win.webContents.insertCSS('.ro-ctx[data-lv="warn"] rect{stroke:var(--green)!important}');
    if (MUTANT === 'glass') await ctx.win.webContents.insertCSS('.ro-ctx rect{x:8px!important;y:8px!important;width:calc(var(--ro-cw,20px) - 16px)!important;height:calc(var(--ro-ch,20px) - 16px)!important}');
    if (MUTANT === 'node') await js(`(()=>{const o=window.DurbarRealOffice.ctx;window.DurbarRealOffice.ctx=(id,c)=>{const r=o(id,c);document.querySelector('#stage .ro-art').appendChild(document.createElement('i'));return r};return 1})()`);

    /* the agents with a desk (a main session), in the simulator's order; the unknown ones wait for the next message (the chat header's "Context: waiting") */
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
    assert.ok(ids.length >= 12, `${tag}: the simulator's main agents (${ids.length})`);
    const share = (i) => SHARES[i % SHARES.length];
    const unknown = ids.filter((_, i) => share(i) === null);
    assert.ok(unknown.length >= 1, `${tag}: some unknown`);
    await js(`(()=>{const U=new Set(${jsLiteral(unknown)});for(const a of window.__durbarSimUi.agents())if(U.has(a.id))a.ctxWaiting='compaction';return 1})()`);
    /* a draw of the office reads the chat header's figure again: the window size changes and returns (the same draw a window resize makes) */
    ctx.win.setContentSize(w, h - 40); await ctx.sleep(300); ctx.win.setContentSize(w, h);
    await must(`document.querySelectorAll('#stage .ro-plate[data-id]').length>=10&&[...document.querySelectorAll('#stage .ro-screen > .ro-ctx[data-lv]')].length<${jsLiteral(ids.length)}`, `${tag}: the unknown desks drawn again`);
    ids.forEach((id, i) => { if (share(i) !== null) js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(id)},timestamp:Date.now(),tokens:${jsLiteral(share(i) * 10)},limit:1000})`); });
    await must(`document.querySelectorAll('#stage .ro-screen:not(.ro-lmon) > .ro-ctx[data-lv]').length>=${jsLiteral(ids.length - unknown.length - 3)}`, `${tag}: the lines`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);

    /* one pass over every desk: what the page draws, as plain values */
    const rows = await js(`(()=>{const tok=n=>{const e=document.createElement('i');e.style.color='var('+n+')';document.body.appendChild(e);const c=getComputedStyle(e).color;e.remove();return c;};
      const T={ok:tok('--green'),warn:tok('--amber'),high:tok('--red')},R=e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]};
      return [...document.querySelectorAll('#stage .ro-screen[data-for]')].map(sc=>{const k=sc.dataset.for,sv=sc.querySelector(':scope > .ro-ctx'),r=sv&&sv.firstChild,pl=document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(k)+']'),
        gl=sc.querySelector('.ro-glass'),tx=document.querySelector('#stage .ro-stext[data-for='+JSON.stringify(k)+']'),cs=r&&getComputedStyle(r),shown=!!sv&&getComputedStyle(sv).display!=='none';
        let ring=null;if(shown){const x=parseFloat(cs.x),y=parseFloat(cs.y),W=parseFloat(cs.width),Hh=parseFloat(cs.height),s=parseFloat(cs.strokeWidth),b=sv.getBoundingClientRect();
          ring={out:[b.left+x-s/2,b.top+y-s/2,b.left+x+W+s/2,b.top+y+Hh+s/2],inn:[b.left+x+s/2,b.top+y+s/2,b.left+x+W-s/2,b.top+y+Hh-s/2],sw:s,per:Math.round(2*(W+Hh)),len:r.getTotalLength?Math.round(r.getTotalLength()):0};}
        return {k,lounge:sc.classList.contains('ro-lmon'),has:!!sv,shown,lv:sv?sv.dataset.lv||'':'',dash:r?r.getAttribute('stroke-dasharray')||'':'',stroke:cs?cs.stroke:'',hidden:sv?sv.getAttribute('aria-hidden'):'',inGlass:!!(gl&&gl.querySelector('.ro-ctx')),
          label:pl?pl.getAttribute('aria-label'):'',glass:R(gl),text:tx?R(tx):null,ring,anim:r?r.getAnimations().length:0,trans:cs?cs.transitionDuration:'',T};});})()`);
    const byId = new Map(rows.map((r) => [r.k, r]));
    const desks = rows.filter((r) => !r.lounge);
    assert.ok(desks.length >= 12, `${tag}: desks with a monitor (${desks.length})`);
    let known = 0;
    ids.forEach((id, i) => {
      const r = byId.get(id), p = share(i);
      if (!r || r.lounge) return; // a seat in the lounge row has no line (FR-322)
      if (p === null) {
        assert.ok(!r.shown && !r.lv && !r.dash, `${tag}: ${id} has an unknown context and draws no line (${JSON.stringify({ shown: r.shown, lv: r.lv, dash: r.dash })})`);
        assert.ok(!/context \d/.test(r.label), `${tag}: ${id}: an unknown context is not in the plate's name (${r.label})`);
        return;
      }
      known++;
      const band = BAND(p);
      assert.ok(r.shown && r.ring, `${tag}: ${id} (${p} %) draws a line`);
      assert.strictEqual(r.lv, band, `${tag}: ${id} at ${p} % is band ${band}`);
      assert.strictEqual(r.dash, p + ' 100', `${tag}: ${id}: the dash is the share (${p})`);
      assert.strictEqual(r.stroke, r.T[band], `${tag}: ${id} at ${p} %: the stroke is the ${TOKEN[band]} token (${r.stroke} vs ${r.T[band]})`);
      assert.ok(Math.abs(r.ring.len - r.ring.per) <= 2, `${tag}: ${id}: the rect's outline is the frame's (${r.ring.len} vs ${r.ring.per}), so ${p} % of it is the line`);
      assert.strictEqual(r.hidden, 'true', `${tag}: ${id}: the line is aria-hidden`);
      assert.ok(r.label.includes(`, context ${p} %`) && r.label.endsWith('. Open chat panel.'), `${tag}: ${id}: the plate's name says the context (${r.label})`);
      assert.ok(!r.inGlass, `${tag}: ${id}: the line is not inside the glass`);
      /* outside the glass: the glass and the screen's text box lie inside the ring's inner edge (0.6 px of rounding) */
      const inside = (b, a) => b[0] >= a[0] - 0.6 && b[1] >= a[1] - 0.6 && b[2] <= a[2] + 0.6 && b[3] <= a[3] + 0.6;
      assert.ok(inside(r.glass, r.ring.inn), `${tag}: ${id}: the line stays outside the glass (glass ${r.glass.map(Math.round)} ring inside ${r.ring.inn.map(Math.round)})`);
      if (r.text) assert.ok(inside(r.text, r.ring.inn), `${tag}: ${id}: the line stays off the screen's text (${r.text.map(Math.round)} vs ${r.ring.inn.map(Math.round)})`);
      assert.ok(r.ring.sw >= 3, `${tag}: ${id}: the line is at least 3 px (${r.ring.sw})`);
      assert.strictEqual(r.anim, 0, `${tag}: ${id}: the line has no animation`);
      assert.ok(/^0s(, 0s)*$/.test(r.trans), `${tag}: ${id}: the line has no transition (${r.trans})`);
    });
    assert.ok(known >= 8, `${tag}: enough agents with a context were checked (${known})`);
    /* every band is on show (a red desk, an amber one, a green one) */
    const bands = new Set(desks.filter((r) => r.shown).map((r) => r.lv));
    assert.deepStrictEqual([...bands].sort(), ['high', 'ok', 'warn'], `${tag}: green, amber and red desks are on show`);
    /* the glass keeps its own tint: it is the state's, never the band's (the line is not the tint) */
    assert.ok(await js(`[...document.querySelectorAll('#stage .ro-screen .ro-glass')].every(g=>!/ro-ctx/.test(g.innerHTML))`), `${tag}: nothing of the line in a glass`);

    /* one context event: the line and the name move, with no node added or removed anywhere in the stage (FR-326) */
    const pick = ids.find((id, i) => share(i) !== null && byId.get(id) && !byId.get(id).lounge && share(i) < 60);
    await js(`(()=>{window.__ctxMut=0;const o=new MutationObserver(l=>{for(const m of l)window.__ctxMut+=m.addedNodes.length+m.removedNodes.length});o.observe(document.getElementById('stage'),{childList:true,subtree:true});window.__ctxObs=o;return 1})()`);
    await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(pick)},timestamp:Date.now(),tokens:930,limit:1000})`);
    await js(`window.__cx=k=>document.querySelector('#stage .ro-screen[data-for='+JSON.stringify(k)+'] > .ro-ctx');window.__cl=k=>document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(k)+']').getAttribute('aria-label');1`);
    await must(`window.__cx(${jsLiteral(pick)}).dataset.lv==='high'&&window.__cx(${jsLiteral(pick)}).firstChild.getAttribute('stroke-dasharray')==='93 100'&&/context 93 %/.test(window.__cl(${jsLiteral(pick)}))`, `${tag}: a context event moves the line and the name`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    assert.strictEqual(await js(`window.__ctxObs.takeRecords().length+window.__ctxMut`), 0, `${tag}: a context event adds or removes no node`);
    await js(`window.__ctxObs.disconnect();1`);

    if (OUT) {
      await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(pick)},timestamp:Date.now(),tokens:${jsLiteral(share(ids.indexOf(pick)) * 10)},limit:1000})`);
      await must(`window.__cx(${jsLiteral(pick)}).firstChild.getAttribute('stroke-dasharray')===${jsLiteral(share(ids.indexOf(pick)) + ' 100')}`, `${tag}: the seeded share back`);
      await H.shot(path.join(OUT, `ctx-${world}-${w}x${h}.png`), { prep: 'mouse', tag: 'ctx-frame' });
      /* the 2x crop of three desks at a low, a mid and a high context (a green, an amber and a red line) */
      const want = [[18, 'low'], [78, 'mid'], [97, 'high']];
      const parts = [];
      for (const [p, name] of want) {
        const id = ids.find((_, i) => share(i) === p), r = await js(`(()=>{const sc=document.querySelector('#stage .ro-screen[data-for='+${jsLiteral(JSON.stringify(id))}+']'),pl=document.querySelector('#stage .ro-plate[data-id='+${jsLiteral(JSON.stringify(id))}+']');if(!sc||sc.classList.contains('ro-lmon'))return null;const a=sc.getBoundingClientRect(),b=pl.getBoundingClientRect(),x=Math.min(a.left,b.left)-10,y=a.top-10,r=Math.max(a.right,b.right)+10,bt=b.bottom+4;return {x:Math.round(x),y:Math.round(y),width:Math.round(r-x),height:Math.round(bt-y)}})()`);
        if (!r) continue;
        const img = await ctx.win.webContents.capturePage(r);
        parts.push({ name: `${name} ${p} %`, url: img.toDataURL(), w: r.width, h: r.height });
      }
      if (parts.length) {
        const png = await js(`(async()=>{const P=${jsLiteral(parts)},K=2,gap=12,cap=22,ims=await Promise.all(P.map(p=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=p.url;})));
          const W=P.reduce((s,p)=>s+p.w*K+gap,gap),Hh=Math.max(...P.map(p=>p.h))*K+cap+gap,c=document.createElement('canvas');c.width=W;c.height=Hh;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,W,Hh);
          g.font='700 15px sans-serif';g.fillStyle='#222';g.imageSmoothingEnabled=false;let x=gap;P.forEach((p,i)=>{g.fillText(p.name,x,16);g.drawImage(ims[i],x,cap,p.w*K,p.h*K);x+=p.w*K+gap;});return c.toDataURL('image/png');})()`);
        fs.writeFileSync(path.join(OUT, `ctx-${world}-crop-${w}x${h}.png`), Buffer.from(png.split(',')[1], 'base64'));
      }
    }
    console.log(`[ctx-frame] ${tag} ok: ${known} lines checked, ${unknown.length} unknown`);
  }
  console.log('[ctx-frame] PASS');
};
