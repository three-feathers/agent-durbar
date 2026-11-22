/*
 * Spec 005 FR-341 (issue #1961, T384): the sort choice of the agent rail. Simulator only (no AI credits, no agent app). Needs the window's
 * focus (the keyboard steps).
 *
 *   npm run check:ui -- --only check-005-rail-sort
 *
 * At 1440x900 and 1280x800, 15 agents (frozen clock), a chat open, railstore=1 (the simulator saves the choice only with it):
 *   - the rail's top row has a "Sort" button, accessible name and tooltip "Sort conversations: Needs you first", text at least 10.5px;
 *   - the default is today's order: a stored choice is absent, and the order equals the order of a page that never saw the button's code path;
 *   - keyboard: Enter on the button opens a menu of five radio items (the checked one has the focus), ArrowDown moves, Escape closes and the
 *     button has the focus again; Enter on an item picks it, the name says it ("Sort conversations: Working first");
 *   - Working first: inside every folder the key never goes down (working, needs you, the rest); Waiting first likewise (needs you, working,
 *     the rest); Oldest first is the exact reverse of Newest first inside each folder (the simulator's creation times are all different);
 *   - rows keep their heights (30 and 52 px) under every choice, the tall row stays tall, and the same rows are listed (15, none lost);
 *   - the choice comes back after a reload (railstore=1) and choosing Needs you first removes the stored key;
 *   - the rail's list never scrolls sideways, and the top row's two buttons fit at 180px.
 * Screenshots (OUT or the temp folder): 005-rail-sort-<choice>-<w>x<h>.png for the default, Working first and Oldest first.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

process.exitCode = 1;
const SIZES = [[1440, 900], [1280, 800]];
const NAMES = ['Needs you first', 'Working first', 'Waiting first', 'Oldest first', 'Newest first'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const rows = () => js(`[...document.querySelectorAll('#stripList .rgrp')].map(g=>({room:g.dataset.key.slice(3),rows:[...g.querySelectorAll('.sitem')].map(r=>({id:r.dataset.sw,tall:r.classList.contains('tall'),work:/\\bst-(working|thinking|failing|retrying)\\b/.test(r.className),h:+r.getBoundingClientRect().height.toFixed(1)}))}))`);
  const flat = (g) => g.flatMap((x) => x.rows.map((r) => r.id));
  const stored = () => js(`localStorage.getItem('durbar.railSort')`);
  const label = () => js(`document.getElementById('railSortBtn').getAttribute('aria-label')`);
  const open = async () => {
    await js(`document.getElementById('railSortBtn').focus()`);
    await H.key('Return');
    await ok(`!!document.getElementById('railSortMenu')&&document.getElementById('railSortMenu').contains(document.activeElement)`, 'Enter on the Sort button opens the menu and focuses an item');
  };
  /* pick a choice with the keyboard: open, go to the item by ArrowDown from the first, Enter */
  const pick = async (name) => {
    await open();
    for (let i = 0; i < 7; i++) {
      if (await js(`document.activeElement.textContent`) === name) break;
      await H.key('Down');
    }
    assert.strictEqual(await js(`document.activeElement.textContent`), name, `the menu reaches "${name}" with the arrow keys`);
    await H.key('Return');
    await ok(`!document.getElementById('railSortMenu')`, 'picking closes the menu');
    await ok(`document.getElementById('railSortBtn').getAttribute('aria-label')===${jsLiteral('Sort conversations: ' + name)}`, `the button says "${name}"`);
    await ok(`document.activeElement&&document.activeElement.id==='railSortBtn'`, 'the focus is back on the Sort button');
  };
  const heightsOk = (g, tag) => g.forEach((x) => x.rows.forEach((r) => assert.ok(r.h === (r.tall ? 52 : 30), `${tag}: row ${r.id} is ${r.h}px (tall ${r.tall})`)));
  const keyOf = (kind) => (r) => kind === 'working' ? (r.work ? 0 : r.tall ? 1 : 2) : (r.tall ? 0 : r.work ? 1 : 2);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { railstore: '1' }, focus: true });
    await js(`localStorage.removeItem('durbar.railSort')`);
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15&&!!document.getElementById('railSortBtn')`, `${tag}: a chat is open, the rail lists 15 rows and has a Sort button`, 15000);
    await js(`document.activeElement&&document.activeElement.blur()`);

    // the button
    assert.strictEqual(await label(), 'Sort conversations: Needs you first', `${tag}: the default name`);
    assert.strictEqual(await js(`document.getElementById('railSortBtn').title`), 'Sort conversations: Needs you first', `${tag}: the tooltip says the same`);
    assert.ok(await js(`parseFloat(getComputedStyle(document.getElementById('railSortBtn')).fontSize)>=10.5`), `${tag}: the Sort text is at least 10.5px`);
    assert.strictEqual(await stored(), null, `${tag}: nothing stored for the default`);
    const base = await rows(); heightsOk(base, `${tag} default`);
    assert.strictEqual(flat(base).length, 15, `${tag}: 15 rows`);
    await H.shot(path.join(OUT, `005-rail-sort-needs-${tag}.png`), { prep: 'calm', blur: true, tag: 'rail' });

    // first-seen times (durbar.railBorn): the page stamps every session once; seed distinct times (and one id that is gone), reload, and read them back
    const ids = flat(base);
    const first = JSON.parse(await js(`localStorage.getItem('durbar.railBorn')`));
    assert.ok(first && ids.every((id) => typeof first[id] === 'number'), `${tag}: every listed session was stamped with its first-seen time`);
    const seeded = {}; ids.forEach((id, i) => { seeded[id] = 1700000000000 + ((i * 7) % 15) * 1000 + i; }); seeded['gone-session-id'] = 1700000000001;
    await js(`localStorage.setItem('durbar.railBorn',${jsLiteral(JSON.stringify(seeded))})`);
    await H.load({ w, h, query: { railstore: '1' }, focus: true });
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15`, `${tag}: after a reload a chat opens`, 15000);
    await ok(`!('gone-session-id' in (JSON.parse(localStorage.getItem('durbar.railBorn')||'{}')))`, `${tag}: an id that is gone is pruned from the stored times`);
    const kept = JSON.parse(await js(`localStorage.getItem('durbar.railBorn')`));
    assert.ok(ids.every((id) => kept[id] === seeded[id]), `${tag}: the stored times survive a reload`);
    assert.deepStrictEqual(await rows(), base, `${tag}: the default order is the same after the reload`);

    // keyboard: open, the checked item has the focus, ArrowDown moves, Escape closes
    await open();
    assert.strictEqual(await js(`document.querySelectorAll('#railSortMenu [role=menuitemradio]').length`), 5, `${tag}: five items`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#railSortMenu [role=menuitemradio]')].map(b=>b.textContent)`), NAMES, `${tag}: the five names in order`);
    assert.strictEqual(await js(`document.activeElement.getAttribute('aria-checked')`), 'true', `${tag}: the checked item has the focus`);
    await H.key('Down');
    assert.strictEqual(await js(`document.activeElement.textContent`), 'Working first', `${tag}: ArrowDown moves`);
    await H.key('Escape');
    await ok(`!document.getElementById('railSortMenu')&&document.activeElement.id==='railSortBtn'`, `${tag}: Escape closes the menu and the button has the focus`);
    assert.deepStrictEqual(await rows(), base, `${tag}: Escape changed nothing`);

    // Working first
    await pick('Working first');
    let g = await rows(); heightsOk(g, `${tag} working`);
    assert.strictEqual(flat(g).length, 15);
    assert.deepStrictEqual([...flat(g)].sort(), [...flat(base)].sort(), `${tag}: the same rows`);
    for (const x of g) { const k = x.rows.map(keyOf('working')); assert.deepStrictEqual(k, [...k].sort((a, b) => a - b), `${tag}: working first inside ${x.room}: ${k}`); }
    assert.strictEqual(await stored(), 'working', `${tag}: the choice is stored`);
    await H.shot(path.join(OUT, `005-rail-sort-working-${tag}.png`), { prep: 'calm', blur: true, tag: 'rail' });
    // Waiting first
    await pick('Waiting first');
    g = await rows(); heightsOk(g, `${tag} waiting`);
    for (const x of g) { const k = x.rows.map(keyOf('waiting')); assert.deepStrictEqual(k, [...k].sort((a, b) => a - b), `${tag}: waiting first inside ${x.room}: ${k}`); }
    // Oldest first / Newest first
    await pick('Oldest first');
    const old = await rows(); heightsOk(old, `${tag} oldest`);
    for (const x of old) { const t = x.rows.map((r) => seeded[r.id]); assert.deepStrictEqual(t, [...t].sort((p, q) => p - q), `${tag}: oldest first inside ${x.room}`); }
    await H.shot(path.join(OUT, `005-rail-sort-oldest-${tag}.png`), { prep: 'calm', blur: true, tag: 'rail' });
    await pick('Newest first');
    const nw = await rows(); heightsOk(nw, `${tag} newest`);
    for (const x of old) {
      const o = x.rows.map((r) => r.id), n = nw.find((y) => y.room === x.room).rows.map((r) => r.id);
      assert.deepStrictEqual(n, [...o].reverse(), `${tag}: Newest is the reverse of Oldest inside ${x.room}`);
    }
    assert.strictEqual(await stored(), 'newest');

    // after a reload the choice is back, and the order with it
    await H.load({ w, h, query: { railstore: '1' }, focus: true });
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15`, `${tag}: after a reload a chat opens`, 15000);
    assert.strictEqual(await label(), 'Sort conversations: Newest first', `${tag}: the choice survives a reload`);
    assert.deepStrictEqual(flat(await rows()).length, 15);
    // back to the default removes the key and gives today's order
    await pick('Needs you first');
    assert.strictEqual(await stored(), null, `${tag}: the default removes the key`);
    assert.deepStrictEqual(await rows(), base, `${tag}: Needs you first is the default order again`);

    // repeated renders write nothing: with no session change, 20 events must not call setItem for durbar.railBorn (it is written only when the value changes)
    await js(`(()=>{window.__bornWrites=0;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='durbar.railBorn')window.__bornWrites++;return o.call(this,k,v);};})()`);
    const sid = await js(`document.querySelector('#stripList .sitem[data-sw]').dataset.sw`);
    for (let i = 0; i < 20; i++) await js(`window.__durbarSimEmit({timestamp:Date.now(),sessionId:${jsLiteral(sid)},type:'status',status:'working',intent:'Working'})`);
    await js(`new Promise(r=>setTimeout(r,300))`);
    assert.strictEqual(await js(`window.__bornWrites`), 0, `${tag}: repeated renders and events write durbar.railBorn 0 times`);

    // not remembering (the simulator default, no railstore): choosing a sort and rendering stores nothing. The demo (no bridge) cannot be reached from a driver: the simulator always has one.
    await js(`localStorage.setItem('durbar.railSort','oldest');localStorage.removeItem('durbar.railBorn')`); // a stored choice is not read either
    await H.load({ w, h, focus: true });
    await H.needFocus(tag);
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&document.querySelectorAll('#stripList .sitem').length>=15`, `${tag}: without railstore a chat opens`, 15000);
    assert.strictEqual(await label(), 'Sort conversations: Needs you first', `${tag}: not remembering: a stored choice is not read`);
    await js(`localStorage.removeItem('durbar.railSort')`);
    await pick('Working first');
    await ok(`document.querySelector('#stripList .sitem')&&document.getElementById('railSortBtn').getAttribute('aria-label')==='Sort conversations: Working first'`, `${tag}: the choice applies for this run`);
    assert.strictEqual(await js(`localStorage.getItem('durbar.railSort')`), null, `${tag}: not remembering: the sort is not stored`);
    assert.strictEqual(await js(`localStorage.getItem('durbar.railBorn')`), null, `${tag}: not remembering: the first-seen times are not stored`);

    // narrowest rail: Office and Sort both fit, no sideways scroll
    await js(`document.documentElement.style.setProperty('--rail-w','180px')`);
    await ok(`Math.round(document.querySelector('.rail').getBoundingClientRect().width)===180`, `${tag}: rail at 180px`);
    const fit = await js(`(()=>{const t=document.querySelector('.rail-top').getBoundingClientRect(),b=document.getElementById('backBtn').getBoundingClientRect(),s=document.getElementById('railSortBtn').getBoundingClientRect(),l=document.getElementById('stripList');return {inside:s.right<=t.right+0.5&&b.right<=s.left+0.5,sideways:l.scrollWidth>l.clientWidth+1}})()`);
    assert.ok(fit.inside, `${tag}: Office and Sort fit side by side at 180px`);
    assert.ok(!fit.sideways, `${tag}: the list does not scroll sideways`);
    await js(`document.documentElement.style.removeProperty('--rail-w')`);
  }
  console.log('check-005-rail-sort: all checks passed');
  process.exitCode = 0;
};
