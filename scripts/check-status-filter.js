/*
 * Spec 001 FR-180 (issue #790): while a status pill filters, the office and the List say so and offer Show all. Simulator only
 * (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:statusfilter
 *
 * At 1440x900 and 1280x800 (SIM=15): with no pill on there is no notice and Noor and Maya (done, on the lounge couch) are shown; the Idle
 * pill shows "Showing only idle · N hidden · Show all" (N is the other four pills' counts added up, an independent source), the notice
 * is at least 10.5px, sits above the first room and covers nothing, the page rules still hold (no overlap, no scrolling), the lounge of
 * the hidden finished agents is not drawn and the layout is not sized for it (`sizingLounges` is 0, 2 without the pill), and a screen
 * reader is told once; Show all (the same toggle as the pill: focus goes back to it) brings Noor and Maya back to the lounge and the
 * notice goes. The Done pill keeps the lounge (the layout is sized for it). In List the same notice shows above the rows, the rows leave
 * out Noor and Maya, and Show all brings both back. Every wait is until() and its result is asserted. A miss prints DRIVER FAILED
 * (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 *   OUT=docs/screenshots  (optional) also saves 001-status-filter-{1440x900,1280x800}.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const pill = (k) => `.stat[data-k="${k}"]`;
  const clickPill = (k) => js(`document.querySelector(${jsLiteral(pill(k))}).click()`);
  const count = (k) => js(`+document.querySelector(${jsLiteral(pill(k) + ' b')}).textContent`);
  const note = () => js(`(()=>{const e=document.getElementById('filterNote');return e&&!e.hidden&&e.getClientRects().length?e.textContent.replace(/\\s+/g,' ').trim():null})()`);
  const listNote = () => js(`(()=>{const e=document.querySelector('#list .filter-note');return e?e.textContent.replace(/\\s+/g,' ').trim():null})()`);
  const names = (where) => js(`[...document.querySelectorAll(${jsLiteral(where)})].map(e=>e.dataset.id)`);
  const idOf = (name) => js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.name===${jsLiteral(name)})||{}).id`);
  const inLounge = (id) => js(`!!document.querySelector('#stage .lounge .desk.shut[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')`);
  const inList = (id) => js(`!!document.querySelector('#list .lrow[data-id="'+CSS.escape(${jsLiteral(id)})+'"]')`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h });
    await H.calm({ blur: true });
    await js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);
    const noor = await idOf('Noor'), maya = await idOf('Maya');
    assert.ok(noor && maya, `${tag}: the simulator has Noor and Maya`);

    // no filter: no notice, the finished agents rest in the lounge, the layout is sized for their lounges
    assert.strictEqual(await note(), null, `${tag}: no notice without a filter`);
    await ok(`!!document.querySelector('#stage .lounge')`, `${tag}: the lounge is drawn`);
    assert.ok(await inLounge(noor) && await inLounge(maya), `${tag}: Noor and Maya rest in the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: the layout is sized for two lounges without a filter`);

    // Idle pill: the notice, no lounge, no reserved lounge width
    const hiddenIdle = (await count('working')) + (await count('waiting')) + (await count('error')) + (await count('done'));
    await clickPill('idle');
    await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${tag}: the notice shows`);
    assert.strictEqual(await note(), `Showing only idle · ${hiddenIdle} hidden · Show all`, `${tag}: notice text: ${await note()}`);
    await H.settle(); await H.settleWalk();
    assert.strictEqual(await js(`document.querySelectorAll('#stage .lounge, #stage .desk.shut, #stage .units.has-shut').length`), 0, `${tag}: no lounge and no empty lounge band under the Idle pill`);
    assert.ok(!(await inLounge(noor)) && !(await inLounge(maya)), `${tag}: Noor and Maya are hidden by the filter`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 0, `${tag}: the layout reserves no lounge width for hidden rolled agents`);
    const g = await js(`(()=>{const n=document.getElementById('filterNote'),r=n.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect(),first=document.querySelector('#stage > *'),q=first.getBoundingClientRect();return {font:parseFloat(getComputedStyle(n).fontSize),top:r.top,bottom:r.bottom,left:r.left,right:r.right,fl:f.left,fr:f.right,ft:f.top,qtop:q.top,over:document.documentElement.scrollHeight-innerHeight,btn:!!n.querySelector('button.fn-all')}})()`);
    assert.ok(g.font >= 10.5, `${tag}: notice text is at least 10.5px: ${g.font}`);
    assert.ok(g.top >= g.ft && g.left >= g.fl && g.right <= g.fr, `${tag}: the notice is inside the floor: ${JSON.stringify(g)}`);
    assert.ok(g.bottom <= g.qtop + 0.5, `${tag}: the notice does not cover the first room: ${JSON.stringify(g)}`);
    assert.ok(g.btn && g.over <= 0, `${tag}: Show all is a button and the page does not scroll: ${JSON.stringify(g)}`);
    const probs = (await js(`(${pageCheck.toString()})(false, 5)`)).problems;
    assert.deepStrictEqual(probs, [], `${tag}: page rules under the Idle pill: ${probs.join('; ')}`);
    await ok(`window.__ann.some(t=>t.startsWith('Showing only idle.')&&t.includes(' '+${jsLiteral(String(hiddenIdle))}+' hidden'))`, tag + ': a screen reader is told');
    assert.strictEqual(await js(`window.__ann.filter(t=>/Showing only/.test(t)).length`), 1, `${tag}: told once`);
    if (w === 1440) await H.shot(path.join(OUT, `001-status-filter-${tag}.png`), { prep: 'calm', settle: true, blur: true, tag: 'statusfilter' });

    // Show all: the pill's own toggle
    await js(`document.querySelector('#filterNote .fn-all').click()`);
    await ok(`document.getElementById('filterNote').hidden`, `${tag}: the notice goes`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(pill('idle'))}).getAttribute('aria-pressed')`), 'false', `${tag}: the pill is off`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.k`), 'idle', `${tag}: focus goes to the pill`);
    await ok(`!!document.querySelector('#stage .lounge .desk.shut')`, `${tag}: the lounge is back`);
    assert.ok(await inLounge(noor) && await inLounge(maya), `${tag}: Noor and Maya are back in the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: sized for two lounges again`);
    assert.strictEqual(await js(`document.getElementById('floor').classList.contains('has-fnote')`), false, `${tag}: the floor gives the line back`);
    await ok(`window.__ann.some(t=>/Showing all agents/.test(t))`, `${tag}: Show all is announced`);

    // Done pill: the finished agents are shown, the lounge stays and the layout is sized for it
    const hiddenDone = (await count('working')) + (await count('waiting')) + (await count('error')) + (await count('idle'));
    await clickPill('done');
    await ok(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden`, `${tag}: the notice shows for Done`);
    assert.strictEqual(await note(), `Showing only done · ${hiddenDone} hidden · Show all`, `${tag}: Done notice: ${await note()}`);
    await ok(`!!document.querySelector('#stage .lounge .desk.shut')`, `${tag}: Done shows the lounge`);
    assert.strictEqual(await js(`window.__durbarSimUi.sizingLounges()`), 2, `${tag}: Done keeps the lounge width`);
    await clickPill('done');
    await ok(`document.getElementById('filterNote').hidden`, `${tag}: the Done notice goes with its pill`);

    // List
    await js(`document.getElementById('vList').click()`);
    await ok(`document.body.classList.contains('list-mode')&&document.querySelectorAll('#list .lrow[data-id]').length>=15`, `${tag}: the list is shown`);
    assert.strictEqual(await listNote(), null, `${tag}: no notice in the list without a filter`);
    assert.ok(await inList(noor) && await inList(maya), `${tag}: List shows Noor and Maya`);
    await clickPill('idle');
    await ok(`!!document.querySelector('#list .filter-note')`, `${tag}: the notice shows in the list`);
    assert.strictEqual(await listNote(), `Showing only idle · ${hiddenIdle} hidden · Show all`, `${tag}: List notice: ${await listNote()}`);
    assert.ok(!(await inList(noor)) && !(await inList(maya)), `${tag}: List leaves out Noor and Maya under the Idle pill`);
    assert.strictEqual(await js(`document.querySelectorAll('#list .lrow[data-id]').length`), 15 - hiddenIdle, `${tag}: List rows are the idle ones`);
    await js(`document.querySelector('#list .fn-all').click()`);
    await ok(`!document.querySelector('#list .filter-note')&&document.querySelectorAll('#list .lrow[data-id]').length>=15`, `${tag}: Show all clears the list notice`);
    assert.ok(await inList(noor) && await inList(maya), `${tag}: List shows Noor and Maya again`);
    await js(`document.getElementById('vOffice').click()`);
    await ok(`!document.body.classList.contains('list-mode')`, `${tag}: back to the office`);
    console.log(`[statusfilter] ${tag} ok`);
  }
  console.log('[statusfilter] all checks passed');
};
