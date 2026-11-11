/*
 * Spec 097 FR-327..FR-330 (issue #1151, part of #1147): the hover card on a desk. The Real office's card is the zoom panel (FR-034); this checks that it opens
 * where the flat office's card does and says what the flat card says. Simulator only (DURBAR_SIM=15, simsummary=1, a frozen simulator), no AI credits; every
 * wait is an until(), every page value goes in through jsLiteral.
 *
 *   npm run check:ui -- --only check-097-hover-card      (builds first)
 *   mutant (a source edit, not a switch: the page's code is a closure): in src/renderer/realoffice.js placeZoom turn `if (fs && ro.contains(fs)) {` into `if (false && fs && ro.contains(fs)) {`, build, run; it must fail at
 *   "the card does not lie over the focused slip". Two more, same way: the card's z-index 5 instead of 7 (realoffice.css, `.ro-zoom`) must fail at "a slip under the card paints over it";
 *   Four more, same way, all in check-097-hover-card (FR-328): `pointerout` closing a held card (`&& !ZOOM.held` dropped in wireZoom's pointerout) fails "still open 700 ms after the refill"; the Escape check in zoomKey for an open menu
 *   removed fails "Escape closes an open menu while a card is open"; the capture `pointermove` listener in wireZoom deleted fails "a real move to empty floor inside the office closes the held card"; the coordinate comparison dropped
 *   (`ZOOM.held !== PT` turned into `true`) fails "a pointermove at the same place does not close the held asleep card"; the `pointerleave` listener in wireZoom deleted ("noleave") fails "a jump straight off the
 *   office closes the held card"; the window's `focus` listener (`addEventListener('focus', replaceZoom)` in openZoom, turned into `0`) removed ("no window focus") fails "the card closes on the window's focus event".
 *   The focus listeners removed (placeZoom's `document.addEventListener('focusin', replaceZoom, true)` and the focusout one turned into `0`) must fail at "the card is placed again off the slip that took the focus".
 *   The page focus (#1408): the shared focus emulation holds it for the steps that test no blur (a neighbour driver takes the OS focus on Windows CI);
 *   CHECK_097_STEAL_FOCUS=plate|refill|all blurs the window just before the plate's focus() and/or the 700 ms rest. Mutant: `focusPage({ emulate: 'first' })` in
 *   ownFocus turned into `focusPage()`, run with `plate`, fails "the asleep agent's plate holds the keyboard focus"; with `refill`, "no window blur during the 700 ms rest".
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
 *   - a card open on a working desk keeps the awake view (status word, tool log) after its agent falls asleep instead of showing the asleep view (FR-328), or closes within 700 ms of it
 *     under the resting pointer, or closes on a pointermove at the same place, or stays after a real move to empty floor inside the office, or takes the Escape meant for an open menu;
 *   - a held asleep card stays open after the pointer jumps straight off the office, or a card stays over a slip that took the focus by script while the window was in the background, once the window has the focus (FR-328, FR-330);
 *   - the card lies over the slip that holds the keyboard focus (a slip with an Allow button, reached by Tab), a card covers that button's point, a click at the button does not press it
 *     once, or a card opens when no place leaves the focused slip free (FR-330, round 3 of #1313; mutant: the focused slip skipped in placeZoom's avoid list, see below);
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
  /* #1408: three drivers share one Windows desktop and a neighbour takes the OS focus; a script focus() then fires no focusin and a window blur closes the card
     (FR-034), so a step that tests no blur would test the environment. The shared focus emulation holds the page focus; loseFocus() ends it for the FR-330 blur step */
  const ownFocus = async (what) => assert.ok(await H.focusPage({ emulate: 'first' }) && await js(`document.hasFocus()`), `${what}: the page holds the focus for the steps that test no blur (focus emulation)`);
  const ZOOM_FOR = (id) => `(document.getElementById('roZoom')||{dataset:{}}).dataset.for===${jsLiteral(id)}`;
  const NONE = `!document.getElementById('roZoom')`;
  /* where a part of one agent is: the middle of its first third (a screen, a person) or of its plate */
  const spot = (kind, id) => js(`(()=>{const S=CSS.escape(${jsLiteral(id)}),q={plate:'.ro-plate[data-id="'+S+'"]',person:'.ro-person[data-for="'+S+'"]',desk:'.ro-desk[data-for="'+S+'"]',table:'.ro-ltable[data-for="'+S+'"]',screen:'.ro-screen[data-for="'+S+'"]'}[${jsLiteral(kind)}];
    const e=document.querySelector('#stage '+q);if(!e)return null;const b=e.getBoundingClientRect();
    /* the part of the box that is really this part (a person's box is partly under the desk, a plate is over it): a point whose topmost element is the part or inside it */
    for(const [fx,fy] of [[.5,.5],[.5,.3],[.5,.7],[.3,.5],[.7,.5],[.5,.15],[.5,.85],[.2,.2],[.8,.8]]){const x=b.left+b.width*fx,y=b.top+b.height*fy,t=document.elementFromPoint(x,y);if(t&&(t===e||e.contains(t)||(${jsLiteral(kind)}==='person'&&(t.classList.contains('ro-rig')||t.classList.contains('ro-person2'))&&t.dataset.for===${jsLiteral(id)})))return {x,y};}
    return null;})()`);
  const hoverAt = async (kind, id, tag) => {
    for (let t = 0; t < 4; t++) {
      if (t) console.log('[hover-card] try', t + 1, 'for', id, kind, JSON.stringify(await js(`({z:window.__zlog,now:Math.round(performance.now()),mv:window.__mv})`)));
      /* read again each try, and wait for it to hold still: a person eases or walks to its place (a handover, a walk back from the lounge) and is not a target until it has arrived */
      let p = null, prev = null;
      for (let w = 0; w < 100; w++) {
        const q = await spot(kind, id);
        if (q && prev && Math.abs(q.x - prev.x) <= 1 && Math.abs(q.y - prev.y) <= 1) { p = q; break; }
        prev = q; await js(`new Promise(r=>setTimeout(r,150))`);
      }
      if (!p) { console.log('[hover-card] never held still', id, kind, 'try', t + 1, JSON.stringify(prev)); continue; }
      await moveTo(1, 1);
      await must(NONE, `${tag}: closed before the hover`);
      await moveTo(p.x - 2, p.y); /* the first event after the room returns only marks where the pointer is */
      if (!(await moveTo(p.x, p.y))) { await refocus(); continue; }
      if (await H.until(ZOOM_FOR(id), 6000)) return true;
      if (!(await js(`document.hasFocus()`))) await refocus();
    }
    const SEL = kind === 'plate' ? '.ro-plate[data-id="' + id + '"]' : '.ro-' + kind + '[data-for="' + id + '"]';
    console.log('[hover-card] no point for', id, kind, JSON.stringify(await js(`(()=>{const e=document.querySelector('#stage '+${jsLiteral(SEL)});if(!e)return {missing:true};const b=e.getBoundingClientRect(),t=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return {box:[b.left,b.top,b.width,b.height].map(Math.round),top:t&&(t.className||t.tagName),topFor:t&&t.dataset&&(t.dataset.for||t.dataset.id),anim:e.getAnimations().length,vis:getComputedStyle(e).visibility,op:getComputedStyle(e).opacity}})()`)));
    const q = await spot(kind, id) || { x: 0, y: 0 };
    console.log('[hover-card] no zoom for', id, JSON.stringify(await js(`(()=>{const e=document.elementFromPoint(${jsLiteral(q.x)},${jsLiteral(q.y)});return {at:e&&(e.className||e.tagName),for:e&&e.dataset&&e.dataset.for,id:e&&e.dataset&&e.dataset.id,zoom:(document.getElementById('roZoom')||{dataset:{}}).dataset.for,hover:window.DurbarRealOffice.hoverState(),mv:window.__mv,focus:document.hasFocus(),zlog:window.__zlog,now:Math.round(performance.now()),scrollY:document.getElementById('floor').scrollTop}})()`)));
    return false;
  };
  /* one re-pick for every hover that targets a working desk's person: a visit can start under load (even with simfreeze), and no sim hook pins an agent, so the desk is picked again when its person has gone */
  const PICKW = (excl) => `(()=>{const L=${sim}.realLayout();const d=L.zones.flatMap(z=>z.desks).find(x=>['working','thinking'].includes(x.state)&&!x.away&&!${jsLiteral(excl)}.includes(x.id)&&document.querySelector('#stage .ro-person[data-for="'+CSS.escape(x.id)+'"]'));return d&&d.id;})()`;
  const HAS = (id) => `!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(id)})+'"]')&&!${sim}.realLayout().zones.flatMap(z=>z.desks).some(d=>d.id===${jsLiteral(id)}&&d.away)`;
  const hoverWork = async (kind, id, excl, tag) => {
    for (let t = 0; t < 5; t++) {
      if (!id || !(await js(HAS(id)))) { id = null; for (let u = 0; u < 40 && !id; u++) { id = await js(PICKW(excl)); if (!id) await js(`new Promise(r=>setTimeout(r,200))`); } }
      if (id && await hoverAt(kind, id, tag)) return id;
    }
    return null;
  };
  const card = async () => { await H.until(`!!document.getElementById('roZoom')`, 3000); return card1(); }; /* an open card is read once it is there (a read in the same tick as its opening is not a failure of the card) */
  const card1 = () => js(`(()=>{const z=document.getElementById('roZoom');if(!z)return null;const b=z.getBoundingClientRect(),w=document.getElementById('floor').getBoundingClientRect(),id=z.dataset.for,pl=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(id)+'"]').getBoundingClientRect();
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

  /* #1408 fault injection (CHECK_097_STEAL_FOCUS=plate|refill|all): the window loses the OS focus just before the plate's focus() or the 700 ms rest, as a
     neighbour driver takes it on Windows CI; the emulation is left as it is (a neighbour does not end it) */
  const THIEF = String(process.env.CHECK_097_STEAL_FOCUS || '');
  const steal = async () => { ctx.win.blur(); await js(`new Promise(r=>setTimeout(r,300))`); console.log('[hover-card] focus stolen; page hasFocus', await js(`document.hasFocus()`)); };
  const shots = [];
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', romotion: '1', simsummary: '1' }, ready: REAL, settle: false });
    await must(PICS, 'the pictures');
    await must(`${sim}.visitsSettled()`, `${tag}: no visit about to start or end`);
    await refocus();
    await ownFocus(tag);
    /* ---- FR-327: any part of a working desk opens its zoom ---- */
    let wk = await js(PICKW([]));
    const desks = await js(`${sim}.realLayout().zones.flatMap(z=>z.desks).map(d=>d.id+':'+d.state+(d.away?'@':''))`);
    assert.ok(wk, `${tag}: a working desk: ${JSON.stringify(desks)}`);
    let c0, c1, pp;
    await H.pointerStep('check-097-hover-card', `${tag} hover parts of one desk`, async () => {
      for (const kind of ['person', 'desk', 'plate', 'screen']) {
        wk = await hoverWork(kind, wk, [], `${tag} ${kind}`);
        assert.ok(wk, `${tag}: hovering the ${kind} of a working desk opens its zoom (FR-327)`);
      }
      /* from the screen to the person of the same desk: the same panel stays (no close and reopen) */
      c0 = await card();
      pp = await spot('person', wk);
      assert.ok(await moveTo(pp.x, pp.y), `${tag}: moved to the person`);
      await js(`new Promise(r=>setTimeout(r,400))`);
      c1 = await card();
      assert.ok(c1 && c1.id === wk && c1.node === c0.node, `${tag}: moving over the parts of one desk keeps the same panel (${c0 && c0.node} then ${c1 && c1.node})`);
    });
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
    if (/plate|all/.test(THIEF)) await steal();
    assert.ok(await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(S)})+'"]');p.focus({focusVisible:true});return document.activeElement===p&&p.matches(':focus-visible')&&document.hasFocus()})()`),
      `${tag}: the asleep agent's plate holds the keyboard focus, :focus-visible, in a page with the focus (#1408: a page without it fires no focusin)`);
    await must(ZOOM_FOR(S), `${tag}: keyboard focus on the asleep agent's plate opens the card (FR-328)`);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(NONE, `${tag}: Esc closes it`);
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id===${jsLiteral(S)}`), `${tag}: the focus stays on the plate`);
    await js(`document.activeElement.blur();0`);
    /* ---- FR-328 (2026-11-08): an agent falls asleep while its card is open: the open card switches to the asleep view (the masked last reply, no tool log) ---- */
    let wk2; /* used by the steps after this one */
    await H.pointerStep('check-097-hover-card', `${tag} falls asleep`, async () => {
      wk2 = await hoverWork('person', null, [R, S], `${tag} falls asleep`);
      assert.ok(wk2, `${tag}: the card opens on a second working desk for the falls-asleep step`);
      const before = await card();
      assert.ok(!/^Asleep/.test(before.word), `${tag}: the card starts awake: ${before.word}`);
      const SAID = 'Wrapped up the fallback and ran the checks. ' + TOKEN;
      await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk2)});a.state='done';a.lastOutput=${jsLiteral(SAID)};a.lastEventAt=Date.now()-34*60000;${sim}.crew.renderAll();return 1})()`);
      await must(`(()=>{const z=document.getElementById('roZoom');return !!z&&z.dataset.for===${jsLiteral(wk2)}&&/^Asleep/.test(z.querySelector('.ro-zs').textContent)&&z.dataset.state==='asleep'&&z.querySelector('.ro-zl').textContent.includes('Wrapped up the fallback and ran the checks.')})()`, `${tag}: the open card shows the asleep view after its agent fell asleep (FR-328)`, 8000);
      const after = await card();
      noBad(`${tag} fell asleep`, after);
      assert.ok(after.node === before.node && after.facts.some(([k]) => k === 'Last activity') && after.inside && !after.small.length, `${tag}: the same panel, refilled: ${JSON.stringify(after.facts)}`);
      const blurs0 = await js(`window.__blurs`);
      if (/refill|all/.test(THIEF)) await steal();
      await js(`new Promise(r=>setTimeout(r,700))`); /* the agent walks to the lounge row under the resting pointer: that is not the pointer leaving (the card stays) */
      assert.strictEqual(await js(`window.__blurs`), blurs0, `${tag}: no window blur during the 700 ms rest (a blur closes the card, FR-034; #1408: an environment problem, not the card)`);
      assert.ok(await js(ZOOM_FOR(wk2)) && (await card()).word.startsWith('Asleep'), `${tag}: the asleep card is still open 700 ms after the refill, the pointer has not moved`);
    });
    /* an open menu is above the card: Escape closes the menu (the app's menus stop the key themselves), the card does not take it first (FR-328) */
    await js(`(()=>{const m=document.createElement('div');m.id='modeMenu';m.tabIndex=-1;const b=document.createElement('button');b.textContent='x';m.appendChild(b);m.addEventListener('keydown',(e)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();m.remove();}});document.body.appendChild(m);b.focus();return document.activeElement===b})()`);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(`!document.getElementById('modeMenu')`, `${tag}: Escape closes an open menu while a card is open (FR-328)`);
    /* held under a resting pointer (FR-328): a pointermove at the same place (the browser sends one after the room changed) does not let go, a real move to empty floor inside the office does */
    const held = await js(`window.__mv`);
    assert.ok(/^\d+,\d+$/.test(held), `${tag}: the driver knows where the pointer is: ${held}`);
    await js(`(()=>{const [x,y]=${jsLiteral(held)}.split(',').map(Number),e=document.elementFromPoint(x,y)||document.body;e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'mouse'}));return 1})()`);
    await js(`new Promise(r=>setTimeout(r,400))`);
    assert.ok(await js(ZOOM_FOR(wk2)), `${tag}: a pointermove at the same place does not close the held asleep card (FR-328)`);
    const EMPTY = `(()=>{const ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect(),held=${jsLiteral(held)};
      for(let y=o.top+8;y<o.bottom-8;y+=23)for(let x=o.left+8;x<o.right-8;x+=29){if(Math.round(x)+','+Math.round(y)===held)continue;const e=document.elementFromPoint(x,y);if(e&&ro.contains(e)&&!e.closest('.ro-screen, .ro-person, .ro-person2, .ro-rig, .ro-initials, .ro-marquee, .ro-desk, .ro-ltable, .ro-plate, .ro-zoom, .ro-slip, .ro-chip, .ro-lplate, .ro-visitor'))return {x:Math.round(x),y:Math.round(y)};}
      return null})()`;
    const empty = await js(EMPTY);
    assert.ok(empty, `${tag}: a point of empty floor inside the office to move to`);
    await moveTo(empty.x, empty.y);
    await must(NONE, `${tag}: a real move to empty floor inside the office closes the held card (FR-328)`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed on leaving after the refill`);
    /* a fresh refill, then the pointer jumps straight off the office with no move inside it: only the office's pointerleave lets the held card go (FR-328) */
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk2)});a.state='working';a.lastEventAt=Date.now();${sim}.crew.renderAll();return 1})()`); /* the first one goes back to work: a working desk for this step */
    const wk4 = await hoverWork('person', null, [R, S], `${tag} falls asleep, then leaves`);
    assert.ok(wk4, `${tag}: the card opens on a third working desk for the leave step`);
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk4)});a.state='done';a.lastOutput='Done and checked.';a.lastEventAt=Date.now()-34*60000;${sim}.crew.renderAll();return 1})()`);
    await must(`(()=>{const z=document.getElementById('roZoom');return !!z&&z.dataset.for===${jsLiteral(wk4)}&&z.dataset.state==='asleep'&&/^Asleep/.test(z.querySelector('.ro-zs').textContent)})()`, `${tag}: the card of the third agent shows the asleep view`, 8000);
    await js(`new Promise(r=>setTimeout(r,400))`);
    assert.ok(await js(ZOOM_FOR(wk4)), `${tag}: the held card of the third agent is still open before the pointer leaves`);
    assert.strictEqual(await js(`(()=>{const e=document.elementFromPoint(1,1);return !!e&&!document.querySelector('#stage .ro').contains(e)})()`), true, `${tag}: (1,1) is outside the office, so the jump leaves it without a move inside`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: a jump straight off the office closes the held card (pointerleave, FR-328)`);
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk4)});a.state='working';a.lastEventAt=Date.now();${sim}.crew.renderAll();return 1})()`);
    /* ---- FR-330: no free place: real-shaped slips (they take pointer events, each holds an input) tile the room except round the hovered person, so the card lands over some of them ---- */
    /* a desk that is working now (read again here: an agent may have left on a visit since the first one was chosen) */
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(wk2)});a.state='working';a.lastEventAt=Date.now();${sim}.crew.renderAll();return 1})()`); /* the one that fell asleep goes back to work: a working desk for this step */
    let wk3 = null;
    const TILES = (keep) => `(()=>{const ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect(),k=${jsLiteral(keep)},keep=document.querySelector('#stage .ro-person[data-for="'+CSS.escape(k)+'"]').getBoundingClientRect();for(const e of ro.querySelectorAll('.fake-slip'))e.remove();
      let n=0;for(let y=0;y<o.height;y+=70)for(let x=0;x<o.width;x+=110){const L=o.left+x,T=o.top+y;if(L<keep.right+40&&keep.left-40<L+104&&T<keep.bottom+40&&keep.top-40<T+64)continue;
        const e=document.createElement('div');e.className='ro-slip fake-slip';e.dataset.n=String(n++);e.style.cssText='position:absolute;left:'+x+'px;top:'+y+'px;width:104px;height:64px;pointer-events:auto';const i=document.createElement('input');i.style.cssText='width:90px';e.appendChild(i);ro.appendChild(e);}return n})()`;
    const COVER = `(()=>{const z=document.getElementById('roZoom');if(!z)return null;const b=z.getBoundingClientRect(),r={under:0,inertUnder:0,inertOther:0,first:-1};
      for(const e of document.querySelectorAll('#stage .ro .fake-slip')){const q=e.getBoundingClientRect(),hit=q.left<b.right&&b.left<q.right&&q.top<b.bottom&&b.top<q.bottom;if(hit){r.under++;const ar=(Math.min(b.right,q.right)-Math.max(b.left,q.left))*(Math.min(b.bottom,q.bottom)-Math.max(b.top,q.top));if(ar>(r.area||0)){r.area=ar;r.first=+e.dataset.n;}if(e.hasAttribute('inert'))r.inertUnder++;}else if(e.hasAttribute('inert'))r.inertOther++;}return r})()`;
    const ANYINERT = `document.querySelectorAll('#stage .ro .fake-slip[inert]').length`;
    wk3 = await hoverWork('person', wk3, [R, S], `${tag} no place`);
    assert.ok(wk3, `${tag}: the card opens on a working desk for the covered-slip step`);
    assert.ok(await js(TILES(wk3)) > 20, `${tag}: slips tiled`); await js(`${sim}.crew.renderAll();0`);
    await must(`${ANYINERT}>0`, `${tag}: a slip under the card is inert (FR-330)`, 8000);
    const cv = await js(COVER);
    assert.ok(cv.under > 0 && cv.inertUnder === cv.under && cv.inertOther === 0, `${tag}: every slip under the card, and none other, is inert: ${JSON.stringify(cv)}`);
    /* the z-order (FR-330): the slips under the card are made live for a moment (inert elements may be skipped by hit-testing) and the card takes pointer events; what is painted at the overlap's points must be the card */
    const zo = await js(`(()=>{const z=document.getElementById('roZoom'),b=z.getBoundingClientRect(),hit=[...document.querySelectorAll('#stage .ro .fake-slip')].filter(e=>{const q=e.getBoundingClientRect();return q.left<b.right&&b.left<q.right&&q.top<b.bottom&&b.top<q.bottom}),bad=[],pts=[0];
      const was=hit.map(e=>e.hasAttribute('inert'));hit.forEach(e=>e.removeAttribute('inert'));z.style.pointerEvents='auto';
      for(const e of hit){const q=e.getBoundingClientRect(),L=Math.max(b.left+10,q.left),R=Math.min(b.right-10,q.right),T=Math.max(b.top+10,q.top),B=Math.min(b.bottom-10,q.bottom);if(R-L<2||B-T<2)continue; /* 10 px in from the card's rounded edge */
        for(const [fx,fy] of [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]]){pts[0]++;const x=L+(R-L-1)*fx,y=T+(B-T-1)*fy,t=document.elementFromPoint(x,y);if(!t||!z.contains(t))bad.push(Math.round(x)+','+Math.round(y)+' '+(t&&(t.className||t.tagName))+' n'+e.dataset.n+' zi'+(t&&getComputedStyle(t).zIndex));}}
      z.style.pointerEvents='';hit.forEach((e,i)=>{if(was[i])e.setAttribute('inert','')});return {n:hit.length,pts:pts[0],bad:bad.slice(0,4)}})()`);
    assert.ok(zo.n > 0 && zo.pts > 0 && zo.bad.length === 0, `${tag}: a slip under the card paints over it (z-order, FR-330): ${JSON.stringify(zo)}`);
    /* the slips go elsewhere and the card is placed again: nothing is inert any more */
    await js(`(()=>{for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.style.left='-9999px';${sim}.crew.renderAll();return 1})()`);
    await must(`${ANYINERT}===0`, `${tag}: a slip no longer under the card is not inert (the card moved)`, 8000);
    /* Esc: the card closes and no slip stays inert */
    await js(TILES(wk3)); await js(`${sim}.crew.renderAll();0`);
    await must(`${ANYINERT}>0`, `${tag}: slips inert again under the card`, 8000);
    const cv2 = await js(COVER);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await must(NONE, `${tag}: Esc closes the card over the slips`);
    await must(`${ANYINERT}===0`, `${tag}: after Esc no slip is inert`, 8000);
    /* FR-330 (round 3): the card is never over the slip that holds the keyboard focus. A slip with an Allow button: Tab reaches it, the card opens near it, lies elsewhere, and a click at the button does what a visible click does */
    await moveTo(1, 1);
    await js(`(()=>{const e=document.querySelector('#stage .ro .fake-slip[data-n="'+${jsLiteral(cv2.first)}+'"]');window.__allow=0;const b=document.createElement('button');b.textContent='Allow';b.style.cssText='width:60px;height:22px';b.addEventListener('click',()=>{window.__allow++});e.appendChild(b);e.querySelector('input').focus();return 1})()`);
    wc().sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); wc().sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await must(`document.activeElement&&document.activeElement.textContent==='Allow'`, `${tag}: Tab reaches the Allow button of the slip`, 5000);
    wk3 = await hoverWork('person', wk3, [R, S], `${tag} focus slip`);
    assert.ok(wk3, `${tag}: the card opens near the focused slip (a place that leaves it free exists)`);
    await js(`${sim}.crew.renderAll();0`);
    const FS = `(()=>{const z=document.getElementById('roZoom'),e=document.querySelector('#stage .ro .fake-slip[data-n="'+${jsLiteral(cv2.first)}+'"]'),bt=e.querySelector('button');if(!z)return {card:false,active:document.activeElement===bt};
      const a=z.getBoundingClientRect(),q=e.getBoundingClientRect(),r=bt.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;z.style.pointerEvents='auto';const t=document.elementFromPoint(x,y);z.style.pointerEvents='';
      return {card:true,active:document.activeElement===bt,overSlip:q.left<a.right&&a.left<q.right&&q.top<a.bottom&&a.top<q.bottom,cardAtButton:!!t&&z.contains(t),inert:e.hasAttribute('inert'),x,y}})()`;
    const fs1 = await js(FS);
    assert.ok(fs1.card && fs1.active && !fs1.overSlip && !fs1.cardAtButton && !fs1.inert, `${tag}: the card does not lie over the focused slip, and no card covers its button (FR-330): ${JSON.stringify(fs1)}`);
    wc().sendInputEvent({ type: 'mouseDown', x: Math.round(fs1.x), y: Math.round(fs1.y), button: 'left', clickCount: 1 }); wc().sendInputEvent({ type: 'mouseUp', x: Math.round(fs1.x), y: Math.round(fs1.y), button: 'left', clickCount: 1 });
    const ALLOW = 'window.__allow===1';
    assert.ok(await H.until(ALLOW, 5000), tag + ': a click at the button of the focused slip pressed it once, as a click with no card over it does (got ' + (await js('window.__allow')) + ')');
    /* no place that leaves the focused slip free: the card is not opened */
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed before the no-place step`);
    await js(`(()=>{const e=document.querySelector('#stage .ro .fake-slip[data-n="'+${jsLiteral(cv2.first)}+'"]');e.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';e.querySelector('button').focus();return document.activeElement===e.querySelector('button')})()`);
    const pq = await spot('person', wk3);
    await moveTo(pq.x - 2, pq.y); await moveTo(pq.x, pq.y);
    await js(`new Promise(r=>setTimeout(r,1200))`);
    assert.ok(await js(NONE), `${tag}: with a focused slip over the whole room no card opens (FR-330)`);
    /* the focus moves into a slip while the card is open (FR-330): the card is placed again off it, or closed when no place leaves it free */
    await js(`(()=>{const b=document.querySelector('#stage .ro .fake-slip[data-n="'+${jsLiteral(cv2.first)}+'"] button');if(b)b.blur();for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.remove();document.activeElement&&document.activeElement.blur&&document.activeElement.blur();return 1})()`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed before the focus-move step`);
    await refocus(); assert.ok(await js(`document.hasFocus()`), `${tag}: the window has the focus for the focus-move steps (a window that lost the system focus fires no focusin: an environment problem, not the card)`);
    wk3 = await hoverWork('person', wk3, [R, S], `${tag} focus move`);
    assert.ok(wk3, `${tag}: the card opens for the focus-move step`);
    const SLIPAT = (full) => `(()=>{const z=document.getElementById('roZoom'),ro=document.querySelector('#stage .ro'),o=ro.getBoundingClientRect(),b=z.getBoundingClientRect(),e=document.createElement('div');e.className='ro-slip fake-slip';e.id='fmSlip';
      e.style.cssText=${jsLiteral(full)}?'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none':'position:absolute;left:'+(b.left-o.left+20)+'px;top:'+(b.top-o.top+20)+'px;width:104px;height:64px;pointer-events:none';
      const i=document.createElement('input');i.style.cssText='width:90px';e.appendChild(i);ro.appendChild(e);i.focus();return document.activeElement===i})()`;
    assert.ok(await js(SLIPAT(false)), `${tag}: the input of a slip lying under the open card took the focus`);
    await must(`(()=>{const z=document.getElementById('roZoom'),e=document.getElementById('fmSlip');if(!z||!e)return false;const a=z.getBoundingClientRect(),q=e.getBoundingClientRect();return !(q.left<a.right&&a.left<q.right&&q.top<a.bottom&&a.top<q.bottom)})()`, `${tag}: the card is placed again off the slip that took the focus (FR-330)`, 4000);
    await js(`document.getElementById('fmSlip').remove();document.activeElement.blur&&document.activeElement.blur();0`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed after the re-place`);
    await refocus(); assert.ok(await js(`document.hasFocus()`), `${tag}: the window has the focus for the no-place focus step (an environment problem when not)`);
    wk3 = await hoverWork('person', wk3, [R, S], `${tag} focus move closes`);
    assert.ok(wk3, `${tag}: the card opens again`);
    assert.ok(await js(SLIPAT(true)), `${tag}: the input of a slip over the whole room took the focus`);
    await must(NONE, `${tag}: the card closes when the focus moves into a slip and no place leaves it free (FR-330)`, 4000);
    await js(`document.getElementById('fmSlip').remove();document.activeElement.blur&&document.activeElement.blur();0`);
    await js(`for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.remove();0`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed after the slip steps`);
    /* the window is in the background when a slip takes the focus by script (no focusin fires): the card is placed again, here closed, when the window has the focus (FR-330) */
    assert.ok(await H.loseFocus(), `${tag}: the window lost the focus (the page reports none)`);
    wk3 = await hoverWork('person', wk3, [R, S], `${tag} window blurred`);
    assert.ok(wk3 && await js(`!document.hasFocus()`), `${tag}: a card is open on a window without the focus`);
    assert.ok(await js(SLIPAT(true)), `${tag}: the input of a slip over the whole room took the focus by script`);
    await js(`new Promise(r=>setTimeout(r,500))`);
    assert.ok(await js(`!!document.getElementById('roZoom')`), `${tag}: no focusin fired in the background window, so the card is still open (the step is real)`);
    /* the window's own focus event, alone (Chromium also sends a focusin to the focused slip when the window is given the focus, which would hide a missing listener; some hosts send none, #1179): the card closes on it */
    await js(`window.dispatchEvent(new Event('focus'));0`);
    await must(NONE, `${tag}: the card closes on the window's focus event when no place leaves the focused slip free (FR-330)`, 4000);
    await refocus();
    await ownFocus(`${tag} after the window-blur step`);
    await js(`for(const e of document.querySelectorAll('#stage .ro .fake-slip'))e.remove();document.activeElement&&document.activeElement.blur&&document.activeElement.blur();0`);
    await moveTo(1, 1);
    /* ---- FR-329: an agent that rested (its numbers are read and kept) and is at a desk again has no Changed line ---- */
    await js(`(()=>{const a=${sim}.agents().find(x=>x.id===${jsLiteral(R)});a.state='working';a.lastEventAt=Date.now();${sim}.crew.renderAll();return 1})()`);
    await must(`(()=>{const L=${sim}.realLayout();return L.zones.flatMap(z=>z.desks).some(d=>d.id===${jsLiteral(R)}&&!d.away&&['working','thinking'].includes(d.state))&&!(L.lounge&&L.lounge.desks.some(d=>d.id===${jsLiteral(R)}))&&!!document.querySelector('#stage .ro-person[data-for="'+CSS.escape(${jsLiteral(R)})+'"]')})()`, `${tag}: the rested agent ${R} is back at a desk`, 8000);
    await js(`new Promise(r=>setTimeout(r,500))`);
    assert.ok(await hoverAt('person', R, `${tag} rested then working`), `${tag}: the card opens on the desk of the agent that rested`);
    const cr = await card();
    assert.ok(cr.id === R && !/^Asleep/.test(cr.word) && cr.facts.every(([k]) => k !== 'Changed'), `${tag}: a rested agent at a desk again has no Changed line (FR-329): ${JSON.stringify(cr.facts)}`);
    await moveTo(1, 1);
    await must(NONE, `${tag}: closed after the rested-then-working step`);
    await H.releaseFocus(); /* the next size loads with the real focus, and turns the emulation on again */
    console.log(`[hover-card] ${tag}: ok; working ${wk}, resting ${R}, asleep ${S}`);
  }
  console.log('[hover-card] pictures:', shots.join(' '));
};
