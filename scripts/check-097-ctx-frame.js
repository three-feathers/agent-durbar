/*
 * Spec 097 FR-322..FR-326 (T253; owner decision Q8, Vikram 2026-11-07 20:20 UTC: "Frame fill and it can go until red as well"): the context line round
 * each desk's monitor frame, in the Photo office, the cave and the arcade. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits; every wait is
 * an until(), every page value goes through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-ctx-frame      (builds first)
 *   CTX_MUTANT=colour|glass|node|rebuild|unknown   a warn desk's line drawn amber / the line moved onto the glass / a node added to the desk's plate by every
 *                                          context update / the desk's line re-created (a new svg) by every context update / a line for an unknown context (each must fail)
 *   Source mutants of the cheap path (edit src/renderer, `npm run build`, run, `git checkout -- <file>`, rebuild; each must fail the cheap step, review of #1299):
 *     push        delete the realCtxPush(a) call after STATS.setContext in the 'context' branch of the event handler (app.js)  -> "a context event reaches the line and the name without a draw"
 *     compaction  delete the realCtxPush(a) call in onCompaction (app.js)                                                     -> "a finished compaction reaches the line and the name without a draw"
 *     noop        make ctx() in realoffice.js return false at once                                                          -> both of the above
 *     moodask     `ctx` returns true instead of 'mood' (realoffice.js), or realCtxPush skips scheduleRender (app.js)  -> "asks for one draw (the mood redraw)"
 *     moodwords   `labelOf` drops a.moodWords, or joins the context words before them (realoffice.js)       -> "reads the mood words, then the context words, then Open chat panel"
 *     hwdrop      in labelOf (realoffice.js) return `l.slice(0, -OPEN_WORDS.length) + w + OPEN_WORDS` without `hw`            -> "a context event keeps the helper words, in order"
 *     hworder     in labelOf swap `w + hw` to `hw + w`                                                                       -> "a context event keeps the helper words, in order"
 *     oldlabel    in ctx() write `a.label` (not labelOf(a, d)) as the plate's aria-label                                      -> the cheap step of every world, and the helper words
 *   SHOTS_OUT=<dir>                        also saves ctx-<world>-<w>x<h>.png (15 agents, every band) and ctx-<world>-crop-<w>x<h>.png (the three desks, 2x)
 *
 * At 15 agents, 1440x900 and 1280x800, each world, with the context seeded across the bands (4 % .. 100 %) and two agents unknown, it fails (exit 1) when:
 *   - an agent with a context has no line, or its band (data-lv), dash (the share of the outline) or computed stroke is not the band's token
 *     (ok below 70 % and warn 70..90 % soft white --tint-ink, high above 90 % red; owner 2026-11-07 21:01 UTC; the dash is exactly the share, no tolerance); the line is not aria-hidden; the plate's name lacks ", context N %";
 *   - a line's ring crosses the glass or the screen's text box (the glass and the text box lie inside the ring's inner edge, 0.6 px of rounding), or lies inside the glass element; the glass tint is not the state's (not drawn on);
 *   - an unknown context draws a line, or its plate's name carries context words;
 *   - the line animates or transitions; a context event, once the desk is quiet, adds or removes a node in the desk's frame (.ro-ctx) or plate, or replaces one of them
 *     (the same nodes are there before and after), or does not move the line and the name;
 *   - FR-325 with FR-308 (review of #1299): an arcade desk with helpers and no strip has the name `..., context P %. N helpers. Open chat panel.` after a context event by the cheap path
 *     alone (no draw), and the next full draw writes the same name;
 *   - FR-326, the cheap path alone: with every draw of the office held (DurbarRealOffice.render counted and skipped, so an ordinary redraw cannot write the same
 *     attributes), a context event and a finished compaction still move the line and the name, and no draw runs while they do.
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
const TOKEN = { ok: '--tint-ink', warn: '--tint-ink', high: '--red' }; /* owner 2026-11-07 21:01 UTC: soft white until 90 %, red only above */

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
    if (MUTANT === 'colour') await ctx.win.webContents.insertCSS('.ro-ctx[data-lv="warn"] rect:not(.ro-ck){stroke:var(--amber)!important}');
    if (MUTANT === 'glass') await ctx.win.webContents.insertCSS('.ro-ctx rect{x:8px!important;y:8px!important;width:calc(var(--ro-cw,20px) - 16px)!important;height:calc(var(--ro-ch,20px) - 16px)!important}');
    if (MUTANT === 'node') await js(`(()=>{const o=window.DurbarRealOffice.ctx;window.DurbarRealOffice.ctx=(id,c)=>{const r=o(id,c);const p=document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(id)+']');if(p)p.appendChild(document.createElement('i'));return r};return 1})()`);
    if (MUTANT === 'rebuild') await js(`(()=>{const o=window.DurbarRealOffice.ctx;window.DurbarRealOffice.ctx=(id,c)=>{const r=o(id,c);const s=document.querySelector('#stage .ro-screen[data-for='+JSON.stringify(id)+'] > .ro-ctx');if(s)s.replaceWith(s.cloneNode(true));return r};return 1})()`);
    /* every draw of the office is counted; while __roHold is set a draw is skipped (the last layout is handed back), so only DurbarRealOffice.ctx can write (FR-326) */
    await js(`(()=>{const R=window.DurbarRealOffice;if(!R.__render){R.__render=R.render;R.render=function(){window.__roDraws=(window.__roDraws||0)+1;if(window.__roHold&&window.__roRet){window.__roHeld=(window.__roHeld||0)+1;return window.__roRet;}return window.__roRet=R.__render.apply(this,arguments);};}window.__roDraws=0;window.__roHold=false;return 1})()`);

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
      const T={ok:tok('--tint-ink'),warn:tok('--tint-ink'),high:tok('--red')},R=e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]};
      return [...document.querySelectorAll('#stage .ro-screen[data-for]')].map(sc=>{const k=sc.dataset.for,sv=sc.querySelector(':scope > .ro-ctx'),r=sv&&sv.lastChild,kl=sv&&sv.firstChild,pl=document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(k)+']'),
        gl=sc.querySelector('.ro-glass'),scb=R(sc),cab=(e=>e?R(e):null)(document.querySelector('#stage .ro-cab[data-for='+JSON.stringify(k)+']')),mq=(e=>e?R(e):null)(document.querySelector('#stage .ro-marquee[data-for='+JSON.stringify(k)+']')),inner=[...sc.querySelectorAll('.ro-glass, .ro-bezel')].map(e=>getComputedStyle(e).backgroundColor),txt=[...document.querySelectorAll('#stage .ro-stext[data-for='+JSON.stringify(k)+'] :is(.ro-sl,.ro-bars i)')].map(e=>getComputedStyle(e).color+'|'+getComputedStyle(e).backgroundColor),tx=document.querySelector('#stage .ro-stext[data-for='+JSON.stringify(k)+']'),cs=r&&getComputedStyle(r),shown=!!sv&&getComputedStyle(sv).display!=='none';
        let ring=null;if(shown){const x=parseFloat(cs.x),y=parseFloat(cs.y),W=parseFloat(cs.width),Hh=parseFloat(cs.height),s=parseFloat(cs.strokeWidth),b=sv.getBoundingClientRect();
          ring={out:[b.left+x-s/2,b.top+y-s/2,b.left+x+W+s/2,b.top+y+Hh+s/2],inn:[b.left+x+s/2,b.top+y+s/2,b.left+x+W-s/2,b.top+y+Hh-s/2],sw:s,per:Math.round(2*(W+Hh)),len:r.getTotalLength?Math.round(r.getTotalLength()):0};}
        return {k,lounge:sc.classList.contains('ro-lmon'),has:!!sv,shown,lv:sv?sv.dataset.lv||'':'',dash:r?r.getAttribute('stroke-dasharray')||'':'',stroke:cs?cs.stroke:'',hidden:sv?sv.getAttribute('aria-hidden'):'',inGlass:!!(gl&&gl.querySelector('.ro-ctx')),
          label:pl?pl.getAttribute('aria-label'):'',glass:R(gl),scb,cab,mq,inner,txt,text:tx?R(tx):null,ring,anim:r?r.getAnimations().length:0,ck:kl?{dash:kl.getAttribute('stroke-dasharray')||'',w:parseFloat(getComputedStyle(kl).strokeWidth),c:getComputedStyle(kl).stroke}:null,trans:cs?cs.transitionDuration:'',T};});})()`);
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
      assert.ok(r.ring.sw >= 4, `${tag}: ${id}: the line is at least 4 px (${r.ring.sw})`);
      assert.ok(r.ck && r.ck.dash === r.dash && r.ck.w >= r.ring.sw + 2 && Math.max(...r.ck.c.match(/\d+/g).slice(0, 3).map(Number)) < 40, `${tag}: ${id}: a dark keyline at least 2 px wider lies under the line with the same dash (${JSON.stringify(r.ck)})`);
      if (world === 'arcade') {
        /* the arcade's line lies in the screen's frame band: its widest part (the keyline) is inside the screen box, which is inside the cabinet's body, clear of the marquee
           (above) and of the control strip (below the screen box); the glass with its text is inside the line's inner edge; no band colour is a colour used inside the screen */
        const rc = [(r.ring.out[0] + r.ring.inn[0]) / 2, (r.ring.out[1] + r.ring.inn[1]) / 2, (r.ring.out[2] + r.ring.inn[2]) / 2, (r.ring.out[3] + r.ring.inn[3]) / 2], kh = r.ck.w / 2;
        const kout = [rc[0] - kh, rc[1] - kh, rc[2] + kh, rc[3] + kh], within = (b, a) => b[0] >= a[0] - 0.6 && b[1] >= a[1] - 0.6 && b[2] <= a[2] + 0.6 && b[3] <= a[3] + 0.6;
        assert.ok(r.cab && within(kout, r.cab), `${tag}: ${id}: the arcade line is inside the cabinet's body (${kout.map(Math.round)} vs ${r.cab && r.cab.map(Math.round)})`);
        assert.ok(within(kout, r.scb), `${tag}: ${id}: the arcade line is inside the screen's frame band, so above the control strip (${kout.map(Math.round)} vs screen ${r.scb.map(Math.round)})`);
        assert.ok(!r.mq || kout[1] >= r.mq[3] - 0.6, `${tag}: ${id}: the arcade line is under the marquee (${kout[1]} vs ${r.mq && r.mq[3]})`);
        assert.ok(inside(r.glass, r.ring.inn) && (!r.text || inside(r.text, r.ring.inn)), `${tag}: ${id}: the glass and its text are inside the arcade line's inner edge`);
        const used = new Set([...r.inner, ...r.txt.flatMap((x) => x.split('|'))]);
        assert.ok(!used.has(r.stroke), `${tag}: ${id}: the arcade band colour ${r.stroke} is not a colour used inside the screen`);
      }
      assert.strictEqual(r.anim, 0, `${tag}: ${id}: the line has no animation`);
      assert.ok(/^0s(, 0s)*$/.test(r.trans), `${tag}: ${id}: the line has no transition (${r.trans})`);
    });
    assert.ok(known >= 8, `${tag}: enough agents with a context were checked (${known})`);
    /* every band is on show (a red desk, a warn one, an ok one) */
    const bands = new Set(desks.filter((r) => r.shown).map((r) => r.lv));
    assert.deepStrictEqual([...bands].sort(), ['high', 'ok', 'warn'], `${tag}: ok, warn and high desks are on show`);
    /* the glass keeps its own tint: it is the state's, never the band's (the line is not the tint) */
    assert.ok(await js(`[...document.querySelectorAll('#stage .ro-screen .ro-glass')].every(g=>!/ro-ctx/.test(g.innerHTML))`), `${tag}: nothing of the line in a glass`);

    /* one context event: the line and the name move, with no node added or removed in this desk's frame and plate, and the same nodes there afterwards (FR-326). Only the desk's own
       subtree is watched, and only once it is quiet (other desks, visitors, chips and shadows redraw on their own and are not this event) */
    const pick = ids.find((id, i) => share(i) !== null && byId.get(id) && !byId.get(id).lounge && share(i) < 60);
    await js(`window.__scr=k=>document.querySelector('#stage .ro-screen[data-for='+JSON.stringify(k)+']');window.__plt=k=>document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(k)+']');1`);
    await js(`(()=>{window.__ctxMut=0;window.__ctxLast=-1;window.__ctxAt=0;const o=new MutationObserver(l=>{for(const m of l)window.__ctxMut+=m.addedNodes.length+m.removedNodes.length});
      const sv=window.__scr(${jsLiteral(pick)}).querySelector(':scope > .ro-ctx'),pl=window.__plt(${jsLiteral(pick)});o.observe(sv,{childList:true,subtree:true});o.observe(pl,{childList:true,subtree:true});window.__ctxObs=o;
      window.__ctxNodes=[sv,...sv.querySelectorAll('*'),pl,...pl.querySelectorAll('*')];window.__ctxSvg=sv;return 1})()`);
    await must(`(()=>{const n=window.__ctxMut;if(window.__ctxLast!==n){window.__ctxLast=n;window.__ctxAt=Date.now();}return Date.now()-window.__ctxAt>400})()`, `${tag}: the desk's frame and plate quiet`);
    await js(`window.__ctxObs.takeRecords();window.__ctxMut=0;1`);
    await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(pick)},timestamp:Date.now(),tokens:930,limit:1000})`);
    await js(`window.__cx=k=>document.querySelector('#stage .ro-screen[data-for='+JSON.stringify(k)+'] > .ro-ctx');window.__cl=k=>document.querySelector('#stage .ro-plate[data-id='+JSON.stringify(k)+']').getAttribute('aria-label');1`);
    await must(`window.__cx(${jsLiteral(pick)}).dataset.lv==='high'&&window.__cx(${jsLiteral(pick)}).lastChild.getAttribute('stroke-dasharray')==='93 100'&&/context 93 %/.test(window.__cl(${jsLiteral(pick)}))`, `${tag}: a context event moves the line and the name`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
    assert.strictEqual(await js(`window.__ctxObs.takeRecords().length+window.__ctxMut`), 0, `${tag}: a context event adds or removes no node in the desk's frame or plate`);
    assert.ok(await js(`window.__ctxNodes.every(n=>n.isConnected)&&window.__scr(${jsLiteral(pick)}).querySelector(':scope > .ro-ctx')===window.__ctxSvg`), `${tag}: a context event keeps the desk's frame and plate nodes (none replaced)`);
    await js(`window.__ctxObs.disconnect();1`);
    /* spec 097 FR-360, FR-362 (merge of #1171 with #1299): the same context-only event moved this desk into the monster look (93 %); the cheap path writes the name, and the signs, which only a draw
       writes, must follow (`ctx` says 'mood' and the app schedules one draw). The name reads the mood's words, then the context's, then the helpers', then ". Open chat panel.". */
    await must(`/, Context almost full \\(93%\\), context 93 %(\\. \\d+ helpers?)?\\. Open chat panel\\.$/.test(window.__cl(${jsLiteral(pick)}))`, `${tag}: the name of ${pick} reads the mood words, then the context words, then Open chat panel (mood, context, helpers order)`);
    if (world !== 'arcade') {
      /* a desk that is seated (a face), shows no sign and is not in trouble: the event makes it a monster */
      const mp = await js(`(()=>{const L=window.__durbarSimUi.realLayout();for(const d of L.zones.flatMap(z=>z.desks)){if(d.lounge||!d.face||d.away||!d.person)continue;if(document.querySelector('#stage .ro-mood[data-for='+JSON.stringify(d.id)+']'))continue;return d.id}return null})()`);
      assert.ok(mp, `${tag}: a seated desk with no sign is on show for the mood redraw step`);
      assert.strictEqual(await js(`document.querySelectorAll('#stage .ro-mood[data-for=${jsLiteral(mp)}]').length`), 0, `${tag}: ${mp} has no sign before the event`);
      await must(`(()=>{const n=window.__roDraws;if(window.__roLast!==n){window.__roLast=n;window.__roAt=Date.now();}return Date.now()-window.__roAt>600})()`, `${tag}: no draw running (mood redraw step)`);
      /* the draw must be the event's own: draws held, the event emitted, three frames; a request to draw must have come (a natural redraw seldom falls in 50 ms after a quiet spell) */
      await js(`window.__roHold=true;window.__roHeld=0;1`);
      let asked = 0;
      try { asked = await js(`(()=>{window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(mp)},timestamp:Date.now(),tokens:930,limit:1000});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(window.__roHeld)))))})()`); } finally { await js(`window.__roHold=false;1`); }
      assert.ok(asked >= 1, `${tag}: a context-only event that makes ${mp} a monster asks for one draw (the mood redraw), none was asked`);
      await must(`!!document.querySelector('#stage .ro-horns[data-for=${jsLiteral(mp)}]')&&!!document.querySelector('#stage .ro-ring[data-for=${jsLiteral(mp)}]')`, `${tag}: a context-only event that makes ${mp} a monster draws its horns and ring (the mood redraw)`, 1500);
      await must(`/, Context almost full \\(93%\\), context 93 %(\\. \\d+ helpers?)?\\. Open chat panel\\.$/.test(window.__cl(${jsLiteral(mp)}))`, `${tag}: ${mp}'s name reads the mood words, then the context words, then Open chat panel, once the signs are drawn`);
    }

    /* FR-326, the cheap path alone: every draw held, so an ordinary redraw cannot write the same attributes. A context event and a finished compaction must still move the
       line and the name, and no draw runs for them. */
    await must(`(()=>{const n=window.__roDraws;if(window.__roLast!==n){window.__roLast=n;window.__roAt=Date.now();}return Date.now()-window.__roAt>400})()`, `${tag}: no draw running`);
    await js(`window.__roHold=true;window.__roHeld=0;window.__roDraws0=window.__roDraws;1`);
    try {
      await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(pick)},timestamp:Date.now(),tokens:760,limit:1000})`);
      await must(`window.__cx(${jsLiteral(pick)}).dataset.lv==='warn'&&window.__cx(${jsLiteral(pick)}).lastChild.getAttribute('stroke-dasharray')==='76 100'&&/context 76 %/.test(window.__cl(${jsLiteral(pick)}))`, `${tag}: a context event reaches the line and the name without a draw`);
      await js(`window.__durbarSimEmit({type:'compaction',sessionId:${jsLiteral(pick)},timestamp:Date.now(),phase:'complete',trigger:'auto',tokensBefore:760,tokensAfter:240,tokensRemoved:520,limit:1000})`);
      await must(`window.__cx(${jsLiteral(pick)}).dataset.lv==='ok'&&window.__cx(${jsLiteral(pick)}).lastChild.getAttribute('stroke-dasharray')==='24 100'&&/context 24 %/.test(window.__cl(${jsLiteral(pick)}))`, `${tag}: a finished compaction reaches the line and the name without a draw`);
      assert.strictEqual(await js(`window.__roDraws-window.__roDraws0-window.__roHeld`), 0, `${tag}: no draw ran while the line moved`);
    } finally { await js(`window.__roHold=false;1`); }

    /* review of #1299 (Ruben): the plate's name when it carries BOTH words, the arcade's fallback plate (helpers with no strip: "+N" on the plate, FR-308) and a context (FR-325).
       The name reads ", context P %" then ". N helpers" then ". Open chat panel.", by the cheap path alone (every draw held), and the next full draw writes the same name. */
    const fb = world === 'arcade' ? await js(`(()=>{for(const p of document.querySelectorAll('#stage .ro-plate[data-id]')){if(p.classList.contains('lounge'))continue;const h=p.querySelector('.ro-help');if(h){const n=parseInt(h.textContent.replace('+',''),10);if(n>0)return {id:p.dataset.id,n}}}return null})()`) : null;
    if (world === 'arcade' && w === 1280) assert.ok(fb, `${tag}: an arcade desk with helpers and no strip is on show (the fallback plate)`);
    if (fb) {
      const words = `${fb.n} helper${fb.n > 1 ? 's' : ''}`, tail = `, context 93 %. ${words}. Open chat panel.`, order = new RegExp(`, Context almost full \\(93%\\)${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      await must(`(()=>{const n=window.__roDraws;if(window.__roLast!==n){window.__roLast=n;window.__roAt=Date.now();}return Date.now()-window.__roAt>400})()`, `${tag}: no draw running (helpers step)`);
      await js(`window.__roHold=true;window.__roHeld=0;window.__roDraws0=window.__roDraws;1`);
      let cheap = '';
      try {
        await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(fb.id)},timestamp:Date.now(),tokens:930,limit:1000})`);
        await must(`/context 93 %/.test(window.__cl(${jsLiteral(fb.id)}))`, `${tag}: a context event reaches the name of ${fb.id}, an arcade desk with ${words}, without a draw`);
        cheap = await js(`window.__cl(${jsLiteral(fb.id)})`);
        assert.ok(order.test(cheap), `${tag}: ${fb.id}: the name reads the mood words, then the context words, then the helpers', then Open chat panel: "${cheap}"`);
        assert.ok(cheap.endsWith(tail), `${tag}: ${fb.id}: a context event keeps the helper words, in order (context, helpers, Open chat panel): "...${tail}" vs "${cheap}"`);
        assert.strictEqual((cheap.match(/helpers?/g) || []).length, 1, `${tag}: ${fb.id}: the helper words are said once (${cheap})`);
        assert.strictEqual(await js(`window.__roDraws-window.__roDraws0-window.__roHeld`), 0, `${tag}: no draw ran while ${fb.id}'s name moved`);
      } finally { await js(`window.__roHold=false;1`); }
      /* the next full draw (the window resizes and returns) writes the same name */
      const d0 = await js(`window.__roDraws`);
      ctx.win.setContentSize(w, h - 40); await ctx.sleep(300); ctx.win.setContentSize(w, h);
      await must(`window.__roDraws>${jsLiteral(d0)}`, `${tag}: a full draw after the cheap step`);
      await must(`window.__cl(${jsLiteral(fb.id)})===${jsLiteral(cheap)}`, `${tag}: ${fb.id}: the next full draw writes the same name as the cheap path ("${cheap}")`);
    }

    if (OUT) {
      await js(`window.__durbarSimEmit({type:'context',sessionId:${jsLiteral(pick)},timestamp:Date.now(),tokens:${jsLiteral(share(ids.indexOf(pick)) * 10)},limit:1000})`);
      await must(`window.__cx(${jsLiteral(pick)}).lastChild.getAttribute('stroke-dasharray')===${jsLiteral(share(ids.indexOf(pick)) + ' 100')}`, `${tag}: the seeded share back`);
      await H.shot(path.join(OUT, `ctx-${world}-${w}x${h}.png`), { prep: 'mouse', tag: 'ctx-frame' });
      /* the 2x crop of three desks at a low, a mid and a high context (a white, a white and a red line) */
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
