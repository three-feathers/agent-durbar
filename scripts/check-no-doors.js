/*
 * Spec 017 FR-029..FR-034 (owner decision 2026-10-31: no doors) and spec 044 FR-128: the office has no doors, and prompts that were held
 * behind a door before the update are asked about once and never sent or dropped on their own. Simulator only (no AI credits, no agent app).
 *
 *   npm run check:ui -- --only check-no-doors
 *   OUT=docs/screenshots  (optional) also saves 017-no-doors-{1440x900,1280x800}.png and 017-held-notice-{1440x900,1280x800}.png
 *
 * At 1440x900 and 1280x800, with 15 agents: no cabin, door button, sign, plate, room door, Close all or Open all anywhere; the desks and the
 * room headers satisfy the office page rules (no overlap, text at least 10.5px, nothing outside the floor); Settings has no Office layout row;
 * a folder is renamed from its header (F2 on the folder button). With `simheld=3` (3 held prompts of one session and 1 of a session that has
 * gone): the notice comes once, with Decide later as the first button; Escape keeps all four held and the Settings > Schedules row lists them;
 * a gone session can only be discarded; Send goes through the schedule's rules (Pause all stops it and keeps the prompt); Discard removes
 * only what was chosen. Every wait is until() and its result is asserted.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const { pageCheck } = require('./check-office-overlap.js');
const OUT = process.env.OUT || require('os').tmpdir();

const GONE = '.cabin, .cb-scene, .cb-toggle, .cb-sign, .cb-door, .plate, .doors, .door, .door-svg, [data-door], [data-doorset], [data-cabin], [data-sign], .dsign-tx, .wprop, #closeAll, #openAll, #doorBar, [data-officelayout]';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 6000), what);
  const dlgText = () => js(`(()=>{const d=document.getElementById('modeDlg');return d?d.innerText:null})()`);
  const dlgBtn = (label) => js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent.trim().startsWith(${jsLiteral(label)}));if(!b)return false;b.click();return true})()`);
  const shot = (name, w, h) => H.shot(path.join(OUT, `017-${name}-${w}x${h}.png`), { prep: 'toasts', delay: 300, tag: '017', what: `${name} ${w} ${h}` });
  const openSched = async () => { await js(`window.DurbarScreens.openSettings()`); await ok(`!document.getElementById('screen').hidden&&!!document.getElementById('schedSet')`, 'Settings opens'); };
  const heldRows = () => js(`[...document.querySelectorAll('#schedSet #heldBefore .held-row')].map(r=>({name:r.querySelector('b').textContent,text:r.innerText.replace(/\\s+/g,' ').trim(),btns:[...r.querySelectorAll(':scope > button')].map(b=>b.textContent.trim())}))`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    // ---- no doors anywhere ----
    await H.load({ w, h, ready: 'fit' });
    await H.office(15);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .desk[data-id]').length`), 15, `${tag}: 15 agents`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll(${jsLiteral(GONE)})].map(e=>e.className||e.id)`), [], `${tag}: no cabin, door, sign, plate or door control on the page`);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .room-head').length>=2&&document.querySelectorAll('#stage .room-head .room-name').length===document.querySelectorAll('#stage .room-head').length`), true, `${tag}: every room header shows its name`);
    await ok(`!document.querySelector('.walker.walking')`, `${tag}: the walks have settled`, 8000);
    const res = await js(`(${pageCheck.toString()})(false, 5)`);
    assert.deepStrictEqual(res.problems, [], `${tag}: the office page rules hold with 15 agents: ${JSON.stringify(res.problems)}`);
    assert.ok(res.info.minFont >= 10.5 || res.info.minFont === undefined, `${tag}: text stays at least 10.5px`);
    assert.strictEqual(await js(`document.getElementById('stage').dataset.fit`), 'ok', `${tag}: the office fits without scroll`);
    // the plain status word is still on every desk
    assert.ok(await js(`[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>d.querySelector('.stl,.pill')).length`) >= 10, `${tag}: the desks keep their plain status word`);
    // the ⋯ menu and the palette lost Close all / Open all
    assert.strictEqual(await js(`/Collapse all|Expand all/.test(document.body.innerHTML)`), false, `${tag}: no Collapse all or Expand all anywhere`);
    // a folder is renamed in place from its header: the pencil, and F2 on the folder button
    const rid = await js(`document.querySelector('#stage .room[data-room]').dataset.room`);
    if (await js(`!!document.querySelector(${jsLiteral(`#stage .room[data-room="${rid}"] [data-foldermenu]`)})`)) {
      await js(`document.querySelector(${jsLiteral(`#stage .room[data-room="${rid}"] [data-foldermenu]`)}).focus()`);
      await H.key('F2');
      await ok(`!!document.querySelector('.inl-input')`, `${tag}: F2 on the folder button opens the name field`);
      await H.key('Escape');
      await ok(`!document.querySelector('.inl-input')`, `${tag}: Escape closes it`);
    }
    // Settings: no Office layout row
    await openSched();
    assert.strictEqual(await js(`/Office layout|Office with cabins|cabin/i.test(document.getElementById('screen').innerText)`), false, `${tag}: Settings has no Office layout row`);
    assert.strictEqual(await js(`document.querySelectorAll('#schedSet #heldBefore').length`), 0, `${tag}: nothing held, no "Held from before the update" row`);
    await H.key('Escape');
    await shot('no-doors', w, h);

    // ---- held prompts from before the update ----
    await H.load({ w, h, ready: 'fit', query: { simheld: '3' } });
    await ok(`!!document.getElementById('modeDlg')&&/held behind a door/.test(document.getElementById('modeDlg').innerText)`, `${tag}: the notice comes`, 10000);
    const t = await dlgText();
    assert.ok(/4 scheduled prompts were held behind a door\. Doors are gone\. Nothing was sent\./.test(t), `${tag}: the notice says what happened: ${t}`);
    assert.ok(/gone/.test(t) && /only Discard/.test(t), `${tag}: the session that has gone is named with Discard only: ${t}`);
    const btns = await js(`[...document.querySelectorAll('#modeDlg .btn')].map(b=>b.textContent.trim())`);
    assert.deepStrictEqual(btns, ['Decide later', 'Discard (4)', 'Send (3)'], `${tag}: Decide later is first (the default and Escape); Send counts only what can go`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.textContent.trim()`), 'Decide later', `${tag}: focus starts on Decide later`);
    await shot('held-notice', w, h);
    await H.key('Escape');
    await ok(`!document.getElementById('modeDlg')`, `${tag}: Escape closes the notice`);
    // Escape decided nothing: all four stay held, in Settings > Schedules
    await openSched();
    await ok(`document.querySelectorAll('#schedSet #heldBefore .held-row').length===2`, `${tag}: two rows (the session, and the one that has gone)`);
    let rows = await heldRows();
    assert.ok(rows.some((r) => /3 held/.test(r.text) && r.btns.join() === 'Send,Discard'), `${tag}: the session's row has Send and Discard: ${JSON.stringify(rows)}`);
    assert.ok(rows.some((r) => /A session that has gone/.test(r.name) && /1 held/.test(r.text) && r.btns.join() === 'Discard' && /only Discard/.test(r.text)), `${tag}: the gone one only has Discard, and says why: ${JSON.stringify(rows)}`);
    await js(`document.getElementById('heldBefore').scrollIntoView({block:'center'})`);
    await shot('held-row', w, h);
    // Send is stopped by Pause all (the schedules' own rules), keeps the prompts
    await js(`document.getElementById('schedPauseAllSet').click()`);
    await ok(`document.getElementById('schedPauseAllSet').checked`, `${tag}: Pause all is on`);
    await js(`document.querySelector('#schedSet #heldBefore [data-ss="held-send"]').click()`);
    await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>/Send stopped because schedules are paused/.test(t.innerText))`, `${tag}: Send stopped by Pause all and says so`, 10000);
    rows = await heldRows();
    assert.ok(rows.some((r) => /3 held/.test(r.text)), `${tag}: all three prompts are still held: ${JSON.stringify(rows)}`);
    await js(`document.getElementById('schedPauseAllSet').click()`);
    await ok(`!document.getElementById('schedPauseAllSet').checked`, `${tag}: Pause all is off`);
    // Discard only what was chosen: the gone one
    await js(`document.querySelector('#schedSet #heldBefore .held-row:last-of-type [data-ss="held-discard"]').click()`);
    await ok(`document.querySelectorAll('#schedSet #heldBefore .held-row').length===1`, `${tag}: only the gone one is discarded`);
    rows = await heldRows();
    assert.ok(/3 held/.test(rows[0].text), `${tag}: the three of the session stay: ${JSON.stringify(rows)}`);
    // Send now: the simulator's frozen agent is busy, so nothing goes out and nothing is dropped (the send itself is tested in test-doormigrate)
    await js(`document.querySelector('#schedSet #heldBefore [data-ss="held-send"]').click()`);
    await ok(`[...document.querySelectorAll('#toasts .toast')].some(t=>/held prompts go out one by one/.test(t.innerText))`, `${tag}: Send says the prompts go out one by one`, 8000);
    rows = await heldRows();
    assert.ok(rows.length === 1 && /(3|2) held/.test(rows[0].text), `${tag}: nothing was dropped while the agent is busy: ${JSON.stringify(rows)}`);
    await H.key('Escape');
  }
  console.log('[017] all checks passed');
};
