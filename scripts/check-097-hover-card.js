/*
 * Spec 097 FR-327..FR-330 (issue #1151, part of #1147): the hover card on a desk. The Real office's card is the zoom panel (FR-034); this checks that it opens
 * where the flat office's card does and says what the flat card says. Simulator only (DURBAR_SIM=15, simsummary=1, a frozen simulator), no AI credits; every
 * wait is an until(), every page value goes in through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-hover-card      (builds first)
 *   SHOTS_OUT=<dir>   where its pictures go (097-hover-<what>-<w>x<h>.png; a temporary folder by default)
 *
 * At 1440x900 and 1280x800, 15 agents, by real pointer moves, it fails (exit 1) when:
 *   - hovering a working desk's person, desk or plate (not only its monitor) does not open that agent's zoom, or moving between those parts of the same desk
 *     closes and reopens it (the panel node changes), or leaving the desk does not close it (FR-327);
 *   - hovering a lounge agent (resting, and asleep) opens nothing, or the card lacks the name, role, its status word, the masked last reply, or the "Last activity"
 *     fact (FR-328), or shows part of a token, a home folder or a link in the reply;
 *   - a lounge agent whose numbers are known has no "Changed" line in the flat office's words ("6 files changed, +120 −35, 1 commit, 40 min · counted by
 *     Agent Durbar"), or an agent at a desk has one (FR-329);
 *   - the card is under 10.5 px anywhere, leaves the window, covers the hovered agent's own plate, or the office scrolls (FR-034, FR-313);
 *   - a card open on a working desk keeps the awake view (status word, tool log) after its agent falls asleep instead of showing the asleep view (FR-328);
 *   - with no free place for the card (the room tiled with slips) a slip under the card is not inert, a slip not under it is, or one stays inert after the card moved or Esc closed it (FR-330);
 *   - keyboard focus on an asleep agent's plate does not open the same card, or Esc does not close it (FR-328).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
const BAD = ['ghp_', 'A1b2C3d4', 'E5f6G7h8', 'alice', 'evil.example', '\u001b', '‮'];

module.exports = async (ctx) => {
  const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-hover-'));
  const H = helpers(ctx);
  const { js } = H;
  const wc = () => ctx.win.webContents;
  const sim = 'window.__durbarSimUi'; /* a ready-made code string (test-ui-suite's RAW_OK) */
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const arm = () => js(`(()=>{if(window.__blurs!==undefined)return;window.__blurs=0;window.__mv='';addEventListener('blur',()=>{window.__blurs++;});addEventListener('mousemove',(e)=>{window.__mv=e.clientX+','+e.clientY;},true);window.__zlog=[];new MutationObserver((ms)=>{for(const m of ms){for(const n of m.addedNodes)if(n.id==='roZoom')window.__zlog.push('+'+Math.round(performance.now()));for(const n of m.removedNodes)if(n.id==='roZoom')window.__zlog.push('-'+Math.round(performance.now())+' blurs='+window.__blurs);}}).observe(document.getElementById('stage'),{childList:true,subtree:true});})();0`);
  const moveTo = async (x, y) => { await arm(); const X = Math.round(x), Y = Math.round(y); wc().sendInputEvent({ type: 'mouseMove', x: X, y: Y }); return H.until(`window.__mv===${jsLiteral(X + ',' + Y)}`, 3000); };
  const refocus = async () => { ctx.win.show(); ctx.win.focus(); wc().focus(); await must(`document.hasFocus()&&!document.hidden`, 'the window active', 8000); };
  const ZOOM_FOR = (id) => `(document.getElementById('roZoom')||{dataset:{}}).dataset.for===${jsLiteral(id)}`;
  const NONE = `!document.getElementById('roZoom')`;
  /* where a part of one agent is: the middle of its first third (a screen, a person) or of its plate */
  const spot = (kind, id) => js(`(()=>{const S=CSS.escape(${jsLiteral(id)}),q={plate:'.ro-plate[data-id="'+S+'"]',person:'.ro-person[data-for="'+S+'"]',desk:'.ro-desk[data-for="'+S+'"]',table:'.ro-ltable[data-for="'+S+'"]',screen:'.ro-screen[data-for="'+S+'"]'}[${jsLiteral(kind)}];
    const e=document.querySelector('#stage '+q);if(!e)return null;const b=e.getBoundingClientRect();
    /* the part of the box that is really this part (a person's box is partly under the desk, a plate is over it): a point whose topmost element is the part or inside it */
    for(const [fx,fy] of [[.5,.5],[.5,.3],[.5,.7],[.3,.5],[.7,.5],[.5,.15],[.5,.85],[.2,.2],[.8,.8]]){const x=b.left+b.width*fx,y=b.top+b.height*fy,t=document.elementFromPoint(x,y);if(t&&(t===e||e.contains(t)))return {x,y};}
    return null;})()`);
  const hoverAt = async (kind, id, tag) => {
    for (let t = 0; t < 4; t++) {
      if (t) console.log('[hover-card] try', t + 1, 'for', id, kind, JSON.stringify(await js(`({z:window.__zlog,now:Math.round(performance.now()),mv:window.__mv})`)));
      const p = await spot(kind, id); /* read again each try: a person eases to its place */
      if (!p) { await js(`new Promise(r=>setTimeout(r,300))`); continue; }
      await moveTo(1, 1);
      await must(NONE, `${tag}: closed before the hover`);
      await moveTo(p.x - 2, p.y); /* the first event after the room returns only marks where the pointer is */
      if (!(await moveTo(p.x, p.y))) { await refocus(); continue; }
      if (await H.until(ZOOM_FOR(id), 6000)) return true;
      if (!(await js(`document.hasFocus()`))) await refocus();
    }
    const q = await spot(kind, id) || { x: 0, y: 0 };
    console.log('[hover-card] no zoom for', id, JSON.stringify(await js(`(()=>{const e=document.elementFromPoint(${jsLiteral(q.x)},${jsLiteral(q.y)});return {at:e&&(e.className||e.tagName),for:e&&e.dataset&&e.dataset.for,id:e&&e.dataset&&e.dataset.id,zoom:(document.getElementById('roZoom')||{dataset:{}}).dataset.for,hover:window.DurbarRealOffice.hoverState(),mv:window.__mv,focus:document.hasFocus(),zlog:window.__zlog,now:Math.round(performance.now()),scrollY:document.getElementById('floor').scrollTop}})()`)));
    return false;
  };
  const card = () => js(`(()=>{const z=document.getElementById('roZoom');if(!z)return null;const b=z.getBoundingClientRect(),w=document.getElementById('floor').getBoundingClientRect(),id=z.dataset.for,pl=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]').getBoundingClientRect();
    const small=[...z.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.textContent.slice(0,20));
    return {id,head:z.querySelector('.ro-zh').textContent,name:z.querySelector('.ro-zh b').textContent,role:z.querySelector('.ro-zr').textContent,word:z.querySelector('.ro-zs').textContent,
      facts:[...z.querySelectorAll('.ro-zk .ro-zi')].map(e=>[e.querySelector('.ro-zy').textContent,e.querySelector('.ro-zv').textContent]),rows:[...z.querySelectorAll('.ro-zl .ro-sl')].map(e=>e.textContent),text:z.textContent,small,
      inside:b.left>=-0.5&&b.top>=-0.5&&b.right<=innerWidth+0.5&&b.bottom<=innerHeight+0.5,coversPlate:b.left<pl.right&&pl.left<b.right&&b.top<pl.bottom&&pl.top<b.bottom,
      w:b.width,aria:z.getAttribute('aria-label'),region:z.getAttribute('role'),live:z.getAttribute('aria-live'),node:z.dataset.node||(z.dataset.node=String(Math.random()))}})()`);
  /* FR-330: nothing paints over the card. The panel takes no pointer events, so for this read it takes them for a moment: the topmost element at its corners and centre must be the panel */
  const onTop = (what) => js(`(()=>{const z=document.getElementById('roZoom');z.style.pointerEvents='auto';const b=z.getBoundingClientRect(),bad=[];
    for(const [fx,fy] of [[.5,.5],[.02,.04],[.98,.04],[.02,.96],[.98,.96],[.5,.04],[.5,.96]]){const x=b.left+(b.width-1)*fx,y=b.top+(b.height-1)*fy,e=document.elementFromPoint(x,y);if(!e||!z.contains(e))bad.push(Math.round(x)+','+Math.round(y)+' '+(e&&(e.className||e.tagName)));}
    z.style.pointerEvents='';const slips=[...document.querySelectorAll('#stage .ro-slip:not([hidden])')].filter(e=>{const r=e.getBoundingClientRect();return r.left<b.right&&b.left<r.right&&r.top<b.bottom&&b.top<r.bottom}).length;
    return {bad,slips}})()`).then((r) => { assert.deepStrictEqual(r.bad, [], `${what}: something paints over the card: ${JSON.stringify(r.bad)}`); assert.strictEqual(r.slips, 0, `${what}: a slip lies over the card`); });
  const noBad = (what, c) => { for (const b of BAD) assert.ok(!c.text.includes(b), `${what}: the card shows ${JSON.stringify(b)}: ${c.text}`); };

  const shots = [];
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', romotion: '1', simsummary: '1' }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    await must(`${sim}.visitsSettled()`, `${tag}: no visit about to start or end`);
    await refocus();
    /* ---- FR-327: any part of a working desk opens its zoom ---- */
    const wk = await js(`(()=>{const L=${sim}.realLayout();const d=L.zones.flatMap(z=>z.desks).find(x=>['working','thinking'].includes(x.state)&&!x.away&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.id)+'"]'));return d&&d.id;})()`);
    const desks = await js(`${sim}.realLayout().zones.flatMap(z=>z.desks).map(d=>d.id+':'+d.state+(d.away?'@':''))`);
    assert.ok(wk, `${tag}: a working desk: ${JSON.stringify(desks)}`);
    for (const kind of ['person', 'desk', 'plate', 'screen']) {
      assert.ok(await hoverAt(kind, wk, `${tag} ${kind}`), `${tag}: hovering the ${kind} of ${wk} opens its zoom (FR-327)`);
    }
    /* from the screen to the person of the same desk: the same panel stays (no close and reopen) */
    const c0 = await card();
    const pp = await spot('person', wk);
    assert.ok(await moveTo(pp.x, pp.y), `${tag}: moved to the person`);
    await js(`new Promise(r=>setTimeout(r,400))`);
    const c1 = await card();
    assert.ok(c1 && c1.id === wk && c1.node === c0.node, `${tag}: moving over the parts of one desk keeps the same panel (${c0 && c0.node} then ${c1 && c1.node})`);
    assert.ok(!c1.small.length && c1.inside && !c1.coversPlate && c1.w >= 379 && c1.w <= 481, `${tag}: the card: no text under 10.5 px (${c1.small}), inside the window, not over its plate, 380-480 px wide (${c1.w})`);
    await onTop(`${tag} desk`);
    assert.strictEqual(c1.live, null, `${tag}: not a live region`);
    assert.ok(c1.facts.every(([k]) => k !== 'Changed'), `${tag}: an agent at a desk has no Changed line (FR-329): ${JSON.stringify(c1.facts)}`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: leaving the desk closes the zoom (FR-327)`);
    /* crossing the room opens nothing: a pointer that only passes over a person leaves no panel */
    const pa = await spot('person', wk);
    await moveTo(pa.x - 2, pa.y); await moveTo(pa.x, pa.y); await moveTo(1, 1);
    await js(`new Promise(r=>setTimeout(r,300))`);
    assert.ok(await js(NONE), `${tag}: a pass over a person within 120 ms opens nothing`);

    /* ---- FR-328, FR-329: the lounge: a resting and an asleep agent, with their numbers known (simsummary: sim-4 and sim-15) ---- */
    const pick = await js(`(()=>{const A=${sim}.agents(),M=A.filter(a=>!a.parent),fin=a=>['done','idle'].includes(a.state)&&!a.paused&&!a.limit;
      const home=new Set(${sim}.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.away).map(d=>d.id));
      const out=[];for(const id of ['sim-4','sim-15']){const a=A.find(x=>x.id===id);if(a&&!a.paused&&!a.limit&&!A.some(k=>k.parent===id))out.push(id);}
      const ok=out.length===2&&out.every(id=>{const r=A.find(x=>x.id===id).room;return M.some(o=>o.room===r&&!out.includes(o.id)&&!fin(o))});
      return ok?out:[]})()`);
    assert.strictEqual(pick.length, 2, `${tag}: sim-4 and sim-15 can both rest (each in a folder where another agent works): ${JSON.stringify(await js(`${sim}.agents().filter(a=>['sim-4','sim-15'].includes(a.id)).map(a=>[a.id,a.state,a.room,a.paused,a.limit])`))}`);
    const [R, S] = pick;
    const REPLY = 'Finished the change and ran the tests. ' + TOKEN + ' /home/alice/work/x.ts see [click](https://evil.example/a)';
    await js(`(()=>{for(const id of ${jsLiteral(pick)}){const a=${sim}.agents().find(x=>x.id===id);a.state='done';a.lastOutput=${jsLiteral(REPLY)};a.lastEventAt=Date.now()-(id===${jsLiteral(S)}?34*60000:2*60000);${sim}.unread.mark(id);}${sim}.crew.renderAll();return 1})()`);
    await js(`(()=>{for(const id of ${jsLiteral(pick)})${sim}.unread.read(id);${sim}.crew.renderAll();return 1})()`);
    await must(`document.querySelectorAll('#stage .ro-plate.lounge').length>=2`, `${tag}: the lounge row`);
    await must(PICS, 'the pictures');
    await must(`(()=>{const r=window.__durbarSumReads||{};return r[${jsLiteral(R)}]>=1&&r[${jsLiteral(S)}]>=1})()`, `${tag}: the lounge agents' numbers were read (FR-329)`);
    await js(`new Promise(r=>setTimeout(r,300))`);
    const seats = {};
    for (const [id, what] of [[R, 'resting'], [S, 'asleep']]) {
      assert.ok(await hoverAt('person', id, `${tag} ${what}`), `${tag}: hovering the ${what} agent ${id} opens a card (FR-328; the flat peek card opens for both)`);
      const c = await card();
      seats[what] = c;
      assert.ok(c.name && c.role && c.word, `${tag} ${what}: name, role and status word: ${c.head}`);
      assert.ok(/^Asleep/.test(c.word) === (what === 'asleep'), `${tag} ${what}: the status word says ${what}: ${c.word}`);
      assert.ok(c.rows.join(' ').includes('Finished the change and ran the tests.'), `${tag} ${what}: the masked last reply is on the card: ${JSON.stringify(c.rows)}`);
      assert.ok(c.facts.some(([k]) => k === 'Last activity'), `${tag} ${what}: the Last activity fact: ${JSON.stringify(c.facts)}`);
      const ch = c.facts.find(([k]) => k === 'Changed');
      const want = id === 'sim-4' ? /^6 files changed, \+120 −35, 1 commit, 40 min · counted by Agent Durbar$/ : /^2 files changed, \+8 −2, 12 min · counted by Agent Durbar$/;
      assert.ok(ch && want.test(ch[1]), `${tag} ${what}: the Changed line in the flat office's words: ${JSON.stringify(ch)}`);
      noBad(`${tag} ${what}`, c);
      await onTop(`${tag} ${what}`);
      assert.ok(!c.small.length && c.inside && !c.coversPlate && c.w >= 379 && c.w <= 481, `${tag} ${what}: the card: no text under 10.5 px (${c.small}), inside the window, not over its plate, 380-480 px wide (${c.w})`);
      assert.strictEqual(await js(`(()=>{const f=document.getElementById('floor');return f.scrollHeight<=f.clientHeight+1})()`), true, `${tag} ${what}: the office does not scroll`);
      const file = path.join(OUT, `097-hover-${what}-${w}x${h}.png`);
      await H.shot(file, { prep: 'calm', keepHover: true });
      shots.push(file);
      await moveTo(1, 1);
      await must(NONE, `${tag} ${what}: closed on leaving`);
    }
    /* each secret form alone, at the start of the reply, with a sentinel after it: a card that cut the reply before the secret, or showed any of it, fails */
    const FORMS = [TOKEN, '/home/alice/work/x.ts', 'C:\\Users\\alice\\work\\x.ts', '/Users/alice/work/x.ts', '[click](https://evil.example/a)', '[' + TOKEN + '](https://evil.example/a)'];
    for (const form of FORMS) {
      await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(R)});a.lastOutput=${jsLiteral(form + ' Sentinel-end.')};${sim}.crew.renderAll();return 1})()`);
      await js(`new Promise(r=>setTimeout(r,300))`);
      assert.ok(await hoverAt('person', R, `${tag} form`), `${tag}: the card opens for the form ${form}`);
      await must(`(document.querySelector('#roZoom .ro-zl')||{textContent:''}).textContent.includes('Sentinel-end.')`, `${tag}: the sentinel after ${form} is on the card (the reply is not cut before it)`, 8000);
      noBad(`${tag} form ${form}`, await card());
      await moveTo(1, 1);
      await must(NONE, `${tag}: closed after the form`);
    }
    /* keyboard: Tab to the asleep agent's plate opens the same card; Esc closes it and the focus stays */
    await js(`(()=>{document.activeElement&&document.activeElement.blur&&document.activeElement.blur();return 1})()`);
    await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(S)})+'"]');p.focus({focusVisible:true});return document.activeElement===p})()`);
    await must(ZOOM_FOR(S), `${tag}: keyboard focus on the asleep agent's plate opens the card (FR-328)`);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(NONE, `${tag}: Esc closes it`);
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id===${jsLiteral(S)}`), `${tag}: the focus stays on the plate`);
    await js(`document.activeElement.blur();0`);
    /* ---- FR-328 (2026-11-08): an agent falls asleep while its card is open: the open card switches to the asleep view (the masked last reply, no tool log) ---- */
    const wk2 = await js(`(()=>{const L=${sim}.realLayout();const d=L.zones.flatMap(z=>z.desks).find(x=>['working','thinking'].includes(x.state)&&!x.away&&![${jsLiteral(R)},${jsLiteral(S)}].includes(x.id)&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.id)+'"]'));return d&&d.id;})()`);
    assert.ok(wk2, `${tag}: a second working desk for the falls-asleep step`);
    assert.ok(await hoverAt('person', wk2, `${tag} falls asleep`), `${tag}: the card opens on the working desk of ${wk2}`);
    const before = await card();
    assert.ok(!/^Asleep/.test(before.word), `${tag}: the card starts awake: ${before.word}`);
    const SAID = 'Wrapped up the fallback and ran the checks. ' + TOKEN;
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk2)});a.state='done';a.lastOutput=${jsLiteral(SAID)};a.lastEventAt=Date.now()-34*60000;${sim}.crew.renderAll();return 1})()`);
    await must(`(()=>{const z=document.getElementById('roZoom');return !!z&&z.dataset.for===${jsLiteral(wk2)}&&/^Asleep/.test(z.querySelector('.ro-zs').textContent)&&z.dataset.state==='asleep'&&z.querySelector('.ro-zl').textContent.includes('Wrapped up the fallback and ran the checks.')})()`, `${tag}: the open card shows the asleep view after its agent fell asleep (FR-328)`, 8000);
    const after = await card();
    noBad(`${tag} fell asleep`, after);
    assert.ok(after.node === before.node && after.facts.some(([k]) => k === 'Last activity') && after.inside && !after.small.length, `${tag}: the same panel, refilled: ${JSON.stringify(after.facts)}`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed on leaving after the refill`);
    /* ---- FR-330: no free place: the slips tile the room, so the card lands over some of them; those are inert while it is open, and only those ---- */
    const TILES = `(()=>{const ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect();for(const e of ro.querySelectorAll('.fake-slip'))e.remove();
      for(let y=0;y<o.height;y+=70)for(let x=0;x<o.width;x+=110){const e=document.createElement('div');e.className='ro-slip fake-slip';e.style.cssText='position:absolute;left:'+x+'px;top:'+y+'px;width:104px;height:64px;pointer-events:none';ro.appendChild(e);}return 1})()`;
    const COVER = `(()=>{const z=document.getElementById('roZoom');if(!z)return null;const b=z.getBoundingClientRect(),r={under:0,inertUnder:0,inertOther:0};
      for(const e of document.querySelectorAll('#stage .ro .fake-slip')){const q=e.getBoundingClientRect(),hit=q.left<b.right&&b.left<q.right&&q.top<b.bottom&&b.top<q.bottom;if(hit){r.under++;if(e.hasAttribute('inert'))r.inertUnder++;}else if(e.hasAttribute('inert'))r.inertOther++;}return r})()`;
    const ANYINERT = `document.querySelectorAll('#stage .ro .fake-slip[inert]').length`;
    assert.ok(await hoverAt('person', wk, `${tag} no place`), `${tag}: the card opens on ${wk} for the covered-slip step`);
    await js(TILES); await js(`${sim}.crew.renderAll();0`);
    await must(`${ANYINERT}>0`, `${tag}: a slip under the card is inert (FR-330)`, 8000);
    const cv = await js(COVER);
    assert.ok(cv.under > 0 && cv.inertUnder === cv.under && cv.inertOther === 0, `${tag}: every slip under the card, and none other, is inert: ${JSON.stringify(cv)}`);
    /* the slips go elsewhere and the card is placed again: nothing is inert any more */
    await js(`(()=>{for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.style.left='-9999px';${sim}.crew.renderAll();return 1})()`);
    await must(`${ANYINERT}===0`, `${tag}: a slip no longer under the card is not inert (the card moved)`, 8000);
    /* Esc: the card closes and no slip stays inert */
    await js(TILES); await js(`${sim}.crew.renderAll();0`);
    await must(`${ANYINERT}>0`, `${tag}: slips inert again under the card`, 8000);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(NONE, `${tag}: Esc closes the card over the slips`);
    await must(`${ANYINERT}===0`, `${tag}: after Esc no slip is inert`, 8000);
    await js(`for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.remove();0`);
    await moveTo(1, 1);
    console.log(`[hover-card] ${tag}: ok; working ${wk}, resting ${R}, asleep ${S}`);
  }
  console.log('[hover-card] pictures:', shots.join(' '));
};
