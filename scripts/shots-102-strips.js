/*
 * Spec 102 T340 (issue #1589, owner decision 8 on #1400, 2026-11-13): in the arcade the notice strips yield before the office scrolls.
 * Simulator only (no AI credits, no real runtime, no network). Run through the suite:
 *
 *   DRIVER_WORLD=retro node scripts/ui-suite.js --only shots-102-strips            (the arcade, both sizes, 15 agents; and 16 agents at 1280x800)
 *   node scripts/ui-suite.js --only shots-102-strips-photo                         (the Photo office: its strips stay in the flow)
 *   (the same, then Office -> List with the overlay open: the strips are back in the flow, no bar, no overlay; and back)
 *   SHOTS=1 OUT=<folder>  also saves 102-1589-<case>-<w>x<h>.png
 *
 * Cases (restore = the restored-Allow-all strip, away, crash, follow, MCP; crash Pick and MCP List opened where named):
 * - every case: the office does not scroll (scrollHeight <= clientHeight, data-fit ok, the room ends inside the floor);
 * - a strip or two that fit stay in the flow: no #stripBar, body has no strips-yield;
 * - the MCP list open, and five strips at 1280x800: #stripBar shows "N notices: names." with a Show/Hide button that has an accessible name,
 *   aria-expanded and a tab stop; the strips are hidden until Show; Show opens each as an overlay under the bar that takes no office height;
 *   List... opens the overlay by itself and the list is in view; Escape hides it and focus is on the bar's button; Dismiss on the last strip
 *   takes the bar away;
 * - 16 agents with five strips at 1280x800: the yield does not help, so the strips stay in the flow and the office scrolls as before;
 * - Photo: no yield whatever the strips.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const PHOTO = process.env.DRIVER_CASE === 'photo';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);
  const SHOW = (id) => `(()=>{const e=document.getElementById(${jsLiteral(id)});return !!e&&!e.hidden})()`;
  const CASES = [
    { id: 'crash', strips: ['crash'], bar: false },
    { id: 'mcp+crash', strips: ['mcp', 'crash'], bar: false },
    { id: 'mcp-list', strips: ['mcp'], list: true, bar: true },
    { id: 'all5', strips: ['restore', 'away', 'crash', 'follow', 'mcp'], bar: (w) => w === 1280 },
  ];
  const setup = async (c, w, h, agents) => {
    const q = { simkinds: 'mixed', officeview: 'real', sim: String(agents || 15) };
    if (c.strips.includes('away')) q.simaway = '1';
    if (c.strips.includes('crash')) q.simcrash = '3';
    if (c.strips.includes('mcp')) { q.simmcplaunch = '1'; q.simmcpauth = '1'; }
    await H.load({ w, h, ready: 'fit', focus: true, query: q });
    if (!c.strips.includes('restore') && (await js(SHOW('restoreStrip')))) { await js(`document.querySelector('#restoreStrip [data-ns="keep"]').click();0`); await until(`document.getElementById('restoreStrip').hidden`, 4000); }
    if (c.strips.includes('follow')) await js(`window.__durbarSimUi.afNotice.on(true);0`);
    if (c.strips.includes('mcp')) {
      const A = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&a.info&&a.info.adapterId==='copilot')[0].id`);
      await emit(A, [{ name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);
    }
    for (const s of c.strips) assert.ok(await until(SHOW(s + 'Strip'), 6000), `${c.id} ${w}: the ${s} strip shows`);
    await settle();
  };
  const STATE = `(()=>{const f=document.getElementById('floor'),r=document.querySelector('#stage .ro'),bar=document.getElementById('stripBar'),b=document.getElementById('sbBtn'),L=window.__durbarSimUi.realLayout();
    return JSON.parse(JSON.stringify({sh:f.scrollHeight,ch:f.clientHeight,fit:document.getElementById('stage').dataset.fit,inside:r?Math.round(r.getBoundingClientRect().bottom)<=Math.round(f.getBoundingClientRect().bottom)+1:false,
      yield:document.body.classList.contains('strips-yield'),open:document.body.classList.contains('strips-open'),bar:!!bar&&!bar.hidden,barText:bar&&document.getElementById('sbText')?document.getElementById('sbText').textContent:'',barBottom:bar?Math.round(bar.getBoundingClientRect().bottom):0,
      btn:b?{name:b.getAttribute('aria-label'),exp:b.getAttribute('aria-expanded'),tab:b.tabIndex,dis:b.disabled,text:b.textContent}:null,floorTop:Math.round(f.getBoundingClientRect().top),
      shown:['restore','away','crash','follow','mcp'].filter(n=>{const e=document.getElementById(n+'Strip');return e&&!e.hidden}),
      vis:['restore','away','crash','follow','mcp'].filter(n=>{const e=document.getElementById(n+'Strip');return e&&!e.hidden&&e.getBoundingClientRect().height>0}),
      scroll:!!(L&&L.scroll),aisles:!!(L&&L.aisles),
      focusBtn:!!b&&document.activeElement===b}))})()`;
  const fits = (S) => S.sh <= S.ch + 1 && S.fit === 'ok' && S.inside;

  if (PHOTO) {
    const c = CASES[3];
    await H.load({ w: 1280, h: 800, ready: 'fit', focus: true, query: { simkinds: 'mixed', officeview: 'real', simaway: '1', simcrash: '3', simmcplaunch: '1', simmcpauth: '1' } });
    assert.strictEqual(await js(`document.documentElement.dataset.world`), 'photo', 'photo: the world is the Photo office');
    await js(`window.__durbarSimUi.afNotice.on(true);0`);
    const A = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&a.info&&a.info.adapterId==='copilot')[0].id`);
    await emit(A, [{ name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);
    for (const s of c.strips) await until(SHOW(s + 'Strip'), 6000);
    await settle();
    const S = await js(STATE);
    assert.ok(S.shown.length >= 4, `photo: the strips show (${S.shown})`);
    assert.ok(!S.yield && !S.bar && S.vis.length === S.shown.length, `photo: the strips are never yielded outside the arcade: ${JSON.stringify(S)}`);
    console.log('[102] strips photo PASS');
    return;
  }

  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    for (const c of CASES) {
      await setup(c, w, h);
      if (c.list) await js(`document.querySelector('#mcpStrip [data-ml="list"]').click();0`);
      if (c.list) await settle();
      let S = await js(STATE);
      const tell = JSON.stringify(S);
      assert.ok(fits(S), `${c.id} ${w}x${h}: the office does not scroll (scrollHeight ${S.sh} against ${S.ch}): ${tell}`);
      assert.ok(S.aisles, `${c.id} ${w}x${h}: the arcade's hall is drawn: ${tell}`);
      if (process.env.SHOTS) await H.shot(path.join(OUT, `102-1589-${c.id.replace(/\+/g, '-')}-${w}x${h}.png`), { prep: 'mouse', tag: '102' });
      const wantBar = typeof c.bar === 'function' ? c.bar(w) : c.bar;
      if (!wantBar) {
        assert.ok(!S.bar && !S.yield && S.vis.length === S.shown.length, `${c.id} ${w}x${h}: strips that fit stay in the flow, no bar: ${tell}`);
        continue;
      }
      const n = S.shown.length;
      assert.ok(S.bar && S.yield, `${c.id} ${w}x${h}: the strips gave way to the bar: ${tell}`);
      assert.ok(S.barText.startsWith(`${n} notice${n === 1 ? '' : 's'}: `), `${c.id} ${w}x${h}: the bar counts the strips (${n}): ${S.barText}`);
      if (c.id === 'all5') {
        assert.ok(/Allow all restored/.test(S.barText) && /Interrupted sessions/.test(S.barText), `${c.id} ${w}x${h}: the bar's text names the folded alert strips: ${S.barText}`);
        assert.strictEqual(await js(`document.getElementById('stripBar').getAttribute('role')`), 'status', `${c.id} ${w}x${h}: the bar stays role=status (the alert is its own region)`);
        assert.strictEqual(await js(`document.getElementById('stripAlert').textContent`), 'Allow all restored', `${c.id} ${w}x${h}: the always-present alert region holds the phrase while the restore strip is folded in (a display:none alert is never read)`);
        assert.strictEqual(await js(`document.getElementById('stripAlert').getAttribute('role')`), 'alert', `${c.id} ${w}x${h}: the alert region is role=alert`);
      } else if (c.bar === true || (typeof c.bar === 'function' && c.bar(w))) {
        assert.strictEqual(await js(`document.getElementById('stripAlert').textContent`), '', `${c.id} ${w}x${h}: no restore strip folded in, so the alert region is empty`);
      }
      assert.ok(S.btn && S.btn.name && /^(Show|Hide) /.test(S.btn.name) && S.btn.tab >= 0 && !S.btn.dis, `${c.id} ${w}x${h}: the bar's button has an accessible name and a tab stop: ${JSON.stringify(S.btn)}`);
      if (c.list) {
        assert.ok(S.open && S.btn.exp === 'true', `${c.id} ${w}x${h}: List... opens the overlay by itself: ${tell}`);
        assert.ok(await js(`(()=>{const l=document.querySelector('#mcpStrip [data-mlk]');if(!l)return false;const r=l.getBoundingClientRect();return r.height>0&&r.bottom<=innerHeight})()`), `${c.id} ${w}x${h}: the opened list is in view`);
        await js(`document.getElementById('sbBtn').click();0`);
        await settle();
      } else {
        assert.ok(!S.open && S.btn.exp === 'false' && S.vis.length === 0, `${c.id} ${w}x${h}: the strips are hidden until Show: ${tell}`);
        await js(`document.getElementById('sbBtn').click();0`);
        await settle();
      }
      S = await js(STATE);
      if (c.list) assert.ok(!S.open && S.btn.exp === 'false' && S.vis.length === 0, `${c.id} ${w}x${h}: Hide closes the overlay: ${JSON.stringify(S)}`);
      else assert.ok(S.open && S.btn.exp === 'true' && S.vis.length === n, `${c.id} ${w}x${h}: Show opens every strip (${S.vis.length} of ${n}): ${JSON.stringify(S)}`);
      assert.ok(fits(S) && S.floorTop <= S.barBottom + 1, `${c.id} ${w}x${h}: the overlay takes no office height: ${JSON.stringify(S)}`);
      if (!c.list) {
        const ov = await js(`(()=>{const bar=document.getElementById('stripBar').getBoundingClientRect();let y=bar.bottom,ok=true;for(const n of ['restore','away','crash','follow','mcp']){const e=document.getElementById(n+'Strip');if(!e||e.hidden)continue;const r=e.getBoundingClientRect();if(Math.abs(r.top-y)>2)ok=false;y=r.bottom;}return ok})()`);
        assert.ok(ov, `${c.id} ${w}x${h}: the strips stack under the bar without overlap`);
        /* Escape from inside an opened strip */
        await js(`(()=>{const b=document.querySelector('.notice-strip:not(#stripBar):not([hidden]) button');b.focus();return 0})()`);
        await H.key('Escape', [], { char: 'always' });
        assert.ok(await until(`document.activeElement===document.getElementById('sbBtn')&&!document.body.classList.contains('strips-open')`, 3000), `${c.id} ${w}x${h}: Escape hides the overlay and focus is on the bar's button`);
        await js(`document.getElementById('sbBtn').click();0`);
        await settle();
        /* dismissing the last strips takes the bar away */
        for (let i = 0; i < 6; i++) {
          const done = await js(`(()=>{const b=document.querySelector('.notice-strip:not(#stripBar):not([hidden]) [data-ns="keep"],.notice-strip:not(#stripBar):not([hidden]) [data-aw="close"],.notice-strip:not(#stripBar):not([hidden]) [data-cr="close"],.notice-strip:not(#stripBar):not([hidden]) [data-ml="close"]');if(!b)return false;b.click();return true})()`);
          if (!done) break;
          await settle();
        }
        const E = await js(STATE);
        assert.ok(E.shown.every((x) => x === 'follow') && fits(E), `${c.id} ${w}x${h}: after Dismiss only what has no Dismiss is left and the office fits: ${JSON.stringify(E)}`);
        assert.strictEqual(await js(`document.getElementById('stripAlert').textContent`), '', `${c.id} ${w}x${h}: the restore strip is gone, so the alert region is empty again`);
        assert.ok(!E.bar && !E.yield, `${c.id} ${w}x${h}: with one strip left the bar goes and the strip is in the flow again: ${JSON.stringify(E)}`);
      }
    }
  }
  /* the yield ends with the Office view: List puts the strips back in the flow and forgets the open overlay; Office brings the bar back */
  await setup(CASES[3], 1280, 800);
  await js(`document.getElementById('sbBtn').click();0`);
  await settle();
  assert.ok(await js(`document.body.classList.contains('strips-open')`), 'view switch: the overlay is open before the switch');
  await js(`document.getElementById('vList').click();0`);
  assert.ok(await until(`document.body.classList.contains('list-mode')`, 4000), 'view switch: List is showing');
  await settle();
  const L = await js(`(()=>{const bar=document.getElementById('stripBar');const sh=['restore','away','crash','follow','mcp'].map(n=>document.getElementById(n+'Strip')).filter(e=>e&&!e.hidden);
    return JSON.parse(JSON.stringify({yield:document.body.classList.contains('strips-yield'),open:document.body.classList.contains('strips-open'),bar:!!bar&&!bar.hidden,n:sh.length,
      inFlow:sh.every(e=>getComputedStyle(e).position!=='fixed'&&e.getBoundingClientRect().height>0),tops:sh.some(e=>e.style.top!=='')}))})()`);
  assert.ok(!L.yield && !L.open && !L.bar && L.n >= 4 && L.inFlow && !L.tops, `Office to List with strips open: no yield, no overlay, no bar, the strips are in the flow: ${JSON.stringify(L)}`);
  assert.strictEqual(await js(`document.getElementById('stripAlert').textContent`), '', 'view switch: in List the alert region is empty');
  await js(`document.getElementById('vOffice').click();0`);
  assert.ok(await until(`document.body.classList.contains('strips-yield')&&!document.getElementById('stripBar').hidden&&!document.body.classList.contains('strips-open')`, 4000), 'view switch: back in the Office the strips yield again, folded');
  /* 16 agents with five strips: the bar would not make them fit, so the strips stay where they were (as the lend, T308) */
  await setup(CASES[3], 1280, 800, 16);
  const S16 = await js(STATE);
  assert.ok(!S16.bar && !S16.yield && S16.vis.length === S16.shown.length && S16.sh > S16.ch + 1, `16 agents, five strips, 1280x800: the yield does not help, the strips stay in the flow and the office scrolls as before: ${JSON.stringify(S16)}`);
  console.log('[102] strips arcade PASS');
};
