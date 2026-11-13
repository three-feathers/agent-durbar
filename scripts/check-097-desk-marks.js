/*
 * Spec 097 FR-316 (issue #1149): a Real office desk whose chat has an unsent draft shows a Draft tag above its plate's left end, and its plate's name says
 * ", unsent draft" (Open office's words). Simulator only (sim=15), no AI credits; every wait is an until().
 *
 *   npm run check:ui -- --only check-097-desk-marks      (builds first)
 *   DESK_MARKS_MUTANT=lounge-pick   the picker takes lounge seats (must fail with "the picked desk is not a lounge seat")
 *   DESK_MARKS_MUTANT=unsettled   the page is not awaited before the picks (the old driver: a desk picked while its place visit is still pending goes away and its tag moves to the post-it; must fail with "is the tag above its plate's left end")
 *   DESK_MARKS_MUTANT=moving   a picked plate eases for a minute (must fail with "timed out waiting for the plates and Draft tags to stop moving (settled layout)")
 *   DESK_MARKS_MUTANT=stale   the tag's class is not removed when the draft goes (must fail with "an emptied draft loses its tag"; the observer adds `on` only when it is missing: a bare add() of a class already set still fires an attribute mutation, so the old mutant looped in a microtask and froze the page until the suite's 601 s limit)
 *
 * At 1440x900 and 1280x800 in Real office it fails (exit 1) when:
 *   - a tag shows before any draft, or a desk without a draft has a tag, or a desk with one has none;
 *   - the plate's name lacks ", unsent draft", or has it without a draft;
 *   - the tag is not above its plate, leaves the floor, touches its plate or another desk's plate or tag, is under 10.5px or under 4.5:1, or is not aria-hidden;
 *   - the draft going away (chat sent or emptied) leaves the tag shown, or any draft change adds or removes a tag node.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.DESK_MARKS_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-desk-marks-'));
  const H = helpers(ctx);
  const { js } = H;
  const { until, SETTLED } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const INSTALL = `window.__dm={plate:k=>document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(k)+'"]'),tag:k=>document.querySelector('#stage .ro-drafttag[data-for="'+CSS.escape(k)+'"]')};true`;
  const shown = () => js(`[...document.querySelectorAll('#stage .ro-drafttag.on')].map(e=>e.dataset.for).sort()`);
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', simfreeze: '1' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false });
    await js(INSTALL);
    /* the lobby's visits settle some time after the replay (the debounce of a place call): a desk picked before that can go away afterwards, and an away desk's tag stands on its post-it, not over its plate. Settled first, then picked. */
    if (MUTANT !== 'unsettled') await must(SETTLED, `${tag}: the page replayed, its visits settled and drawn`, 15000);
    /* DESK_MARKS_FONT=wide (a developer aid): Verdana / DejaVu Sans with 0.1 px letter spacing in the stage, the widths CI's Linux fonts give, so a Mac run takes the wide-font path */
    if (process.env.DESK_MARKS_FONT === 'wide') await js(`(()=>{const s=document.createElement('style');s.textContent='#stage .ro,#stage .ro *{font-family:Verdana,"DejaVu Sans",sans-serif!important;letter-spacing:.1px!important}';document.head.appendChild(s);return 1})()`);
    assert.deepStrictEqual(await shown(), [], `${tag}: no Draft tag before a draft`);
    assert.ok(!(await js(`/unsent draft/.test([...document.querySelectorAll('#stage .ro-plate')].map(p=>p.getAttribute('aria-label')).join('|'))`)), `${tag}: no plate says unsent draft before a draft`);
    const ids = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),aw=new Set(L.zones.flatMap(z=>z.desks).filter(d=>d.away).map(d=>d.id));return window.__durbarSimUi.agents().filter(a=>!a.parent&&!aw.has(a.id)).map(a=>a.id)})()`); /* an empty seat (away) has its post-it where the tag would sit: its tag moves onto the note's corner, which check-office-overlap measures */
    /* FR-316: a desk's tag stands above its plate's left end; a lounge seat's tag stands on the seat's screen (check-office-overlap measures that). The two drafted desks are picked by the
       property this driver asserts, asked of the DOM: an active desk (working, thinking or error: never rolled into the lounge, which only finished or idle agents are), no lounge, asleep or narrow plate,
       a plate wide enough that the tag fits over its left end, a desk of the layout (not a lounge seat, not an empty seat). Mutant lounge-pick takes the lounge seats. */
    const PLATE_MIN = 80;
    const cands = await js(`(()=>{const L=window.__durbarSimUi.realLayout(),lg=new Set(((L.lounge||{}).desks||[]).map(d=>d.id)),aw=new Set(L.zones.flatMap(z=>z.desks).filter(d=>d.away).map(d=>d.id)),bad=${jsLiteral(MUTANT === 'lounge-pick')};
      return [...document.querySelectorAll('#stage .ro-plate')].map(p=>{const c=p.classList,w=p.getBoundingClientRect().width,k=p.dataset.id,
        ok=/(^| )st-(working|thinking|error)( |$)/.test(p.className)&&!c.contains('lounge')&&!c.contains('asleep')&&!c.contains('narrow')&&w>=${jsLiteral(PLATE_MIN)}&&!lg.has(k)&&!aw.has(k);return {k,ok,cls:p.className,w:Math.round(w)}}).filter(x=>bad?lg.has(x.k):x.ok)})()`);
    assert.ok(cands.length >= 2, `${tag}: at least two desks with the property (an active desk, no lounge/asleep/narrow plate, a plate of ${PLATE_MIN}px or more) to draft; found ${JSON.stringify(cands)}`);
    const picks = [cands[0].k, cands[cands.length - 1].k];
    const loungeNow = () => js(`((window.__durbarSimUi.realLayout().lounge||{}).desks||[]).map(d=>d.id)`);
    for (const k of picks) assert.ok(!(await loungeNow()).includes(k), `${tag}: the picked desk is not a lounge seat: ${k}`);
    /* the tag nodes, counted before and after the draft changes: made once per desk, shown by class */
    const nodes = () => js(`document.querySelectorAll('#stage .ro-drafttag').length`);
    const n0 = await nodes();
    await js(`window.__dtN=0;window.__dtO=new MutationObserver(ms=>{for(const m of ms)for(const x of [...m.addedNodes,...m.removedNodes])if(x.nodeType===1&&x.matches('.ro-drafttag'))window.__dtN++;});for(const l of document.querySelectorAll('#stage .ro-chrome'))window.__dtO.observe(l,{childList:true});true`);
    for (const k of picks) {
      await js(`window.__dm.plate(${jsLiteral(k)}).click()`);
      await must(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`, `${tag}: the chat of ${k} opens`);
      await js(`(()=>{const m=document.getElementById('msgInput');m.value='half a prompt';m.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
      await H.key('Escape');
      await must(`!document.body.classList.contains('panel-open')`, `${tag}: the chat closes`);
    }
    await must(`document.querySelectorAll('#stage .ro-drafttag.on').length===2`, `${tag}: two Draft tags show`);
    assert.deepStrictEqual(await shown(), picks.slice().sort(), `${tag}: the tags are on the desks with drafts`);
    for (const k of ids) {
      const has = picks.includes(k), lab = await js(`window.__dm.plate(${jsLiteral(k)}).getAttribute('aria-label')`);
      assert.strictEqual(/, unsent draft/.test(lab), has, `${tag}: ${k} name ${has ? 'says' : 'does not say'} unsent draft: ${lab}`);
      if (has) assert.ok(/^[^,]+, unsent draft/.test(lab), `${tag}: the words come right after the name (Open office's order): ${lab}`);
    }
    /* geometry and look */
    /* settled first, by a condition on the layout (not a re-read until the assertion passes): no plate or Draft tag is still easing (a draw eases what the layout moved) and every plate's and tag's rect is the same as at the previous poll */
    await js(`window.__dmSig=null;true`);
    if (MUTANT === 'moving') await js(`document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(picks[0])})+'"]').animate([{translate:'0 0'},{translate:'40px 0'}],{duration:60000});true`);
    await must(`(()=>{const els=[...document.querySelectorAll('#stage .ro-plate,#stage .ro-drafttag.on')],busy=els.some(e=>e.getAnimations().some(a=>a.effect&&a.effect.getTiming().iterations!==Infinity&&a.playState==='running')),sig=els.map(e=>{const r=e.getBoundingClientRect();return [e.dataset.id||e.dataset.for,r.left,r.top,r.right,r.bottom].join(':')}).join('|'),same=sig===window.__dmSig;window.__dmSig=sig;return !busy&&same})()`, `${tag}: the plates and Draft tags to stop moving (settled layout)`, 10000);
    const geo = await js(`(()=>{const R=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,r:r.right,b:r.bottom}},hit=(a,c)=>a.x+0.5<c.r&&c.x+0.5<a.r&&a.y+0.5<c.b&&c.y+0.5<a.b,fl=R(document.getElementById('floor')),
      rgb=c=>(c.match(/[\\d.]+/g)||[]).map(Number),lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)},
      bgOf=e=>{for(let n=e;n;n=n.parentElement){const c=rgb(getComputedStyle(n).backgroundColor);if(c.length>=3&&(c.length<4||c[3]>0.95))return c}return [255,255,255]};
      const plates=[...document.querySelectorAll('#stage .ro-plate')],tags=[...document.querySelectorAll('#stage .ro-drafttag.on')];
      return tags.map(t=>{const r=R(t),p=R(document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(t.dataset.for)+'"]')),a=lum(rgb(getComputedStyle(t).color)),b=lum(bgOf(t));
        return {k:t.dataset.for,dx:+(r.x-p.x).toFixed(2),tr:[r.x,r.y,r.r,r.b].map(Math.round),pr:[p.x,p.y,p.r,p.b].map(Math.round),cls:document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(t.dataset.for)+'"]').className,above:r.b<=p.y+0.5,left:Math.abs(r.x-p.x)<=1,outFloor:r.x<fl.x-0.5||r.r>fl.r+0.5||r.y<fl.y-0.5||r.b>fl.b+0.5,
          touches:plates.filter(q=>hit(r,R(q))).map(q=>q.dataset.id),others:tags.filter(o=>o!==t&&hit(r,R(o))).map(o=>o.dataset.for),font:parseFloat(getComputedStyle(t).fontSize),ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),hid:t.getAttribute('aria-hidden'),text:t.textContent.trim(),svg:!!t.querySelector('svg')}})})()`);
    assert.strictEqual(geo.length, 2, `${tag}: both tags measured`);
    assert.deepStrictEqual((await loungeNow()).filter(k => picks.includes(k)), [], `${tag}: the drafted desks are still desks when measured (none moved into the lounge)`);
    for (const g of geo) {
      assert.ok(g.above && g.left, `${tag}: ${g.k}: the tag is above its plate's left end (tag left ${g.tr[0]}, plate left ${g.pr[0]}, delta ${g.dx}px, font ${g.font}px, plate classes: ${g.cls}) ${JSON.stringify(g)}`);
      assert.ok(!g.outFloor, `${tag}: ${g.k}: the tag is inside the floor`);
      assert.deepStrictEqual([g.touches, g.others], [[], []], `${tag}: ${g.k}: the tag touches no plate or tag`);
      assert.ok(g.font >= 10.5 && g.ratio >= 4.5, `${tag}: ${g.k}: ${g.font}px, ${g.ratio.toFixed(2)}:1`);
      assert.strictEqual(g.hid, 'true', `${tag}: ${g.k}: the tag is aria-hidden`);
      assert.ok(g.svg && /Draft/.test(g.text), `${tag}: ${g.k}: a pencil and the word Draft`);
    }
    await H.shot(path.join(OUT, `097-desk-marks-${tag}.png`), { prep: 'calm', tag: 'desk-marks', what: tag }); /* the owner's look (Q9): 15 agents, two drafted desks */
    /* emptying the draft hides its tag (the chat reopened shows the draft; the office is hidden under an open chat, so the tag is judged after it closes) */
    const k0 = picks[0];
    await js(`window.__dm.plate(${jsLiteral(k0)}).click()`);
    await must(`document.body.classList.contains('panel-open')&&document.getElementById('msgInput').value==='half a prompt'`, `${tag}: the draft comes back in its chat`);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    if (MUTANT === 'stale') await js(`(()=>{const t=window.__dm.tag(${jsLiteral(k0)});new MutationObserver(()=>{if(!t.classList.contains('on'))t.classList.add('on')}).observe(t,{attributes:true,attributeFilter:['class']});t.classList.add('on');return 1})()`);
    await H.key('Escape');
    await must(`!document.body.classList.contains('panel-open')`, `${tag}: the chat closes`);
    await must(`!window.__dm.tag(${jsLiteral(k0)}).classList.contains('on')&&document.querySelectorAll('#stage .ro-drafttag.on').length===1`, `${tag}: an emptied draft loses its tag, the other keeps it`);
    assert.ok(!/unsent draft/.test(await js(`window.__dm.plate(${jsLiteral(k0)}).getAttribute('aria-label')`)), `${tag}: and its name no longer says it`);
    assert.strictEqual(await js(`window.__dtN`), 0, `${tag}: no tag node was added or removed by the draft changes`);
    assert.strictEqual(await nodes(), n0, `${tag}: the tag count is the same (made once per desk)`);
    console.log('[097-desk-marks]', tag, 'tags above the left ends, names say it, shown by class');
  }
  console.log('[097-desk-marks] ok');
  process.exitCode = 0;
};
