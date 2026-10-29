/*
 * Check for spec 052 FR-071 (delta 2026-10-21, issue #474): Tools > Activity shows the activity log table. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-activity-table
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * At 1440x900 and 1280x800: activity.js and activitytable.js each keep their own window global (DurbarActivity, DurbarActivityTable);
 * Tools opens, the Activity tab opens, and the table renders with the simulator's sample rows (header, at least 7 rows, plain decision
 * words), the privacy note above it, the Export and Clear buttons enabled, no page error, no text under 10.5px and no sideways scroll of
 * the screen. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const js = H.js;
  const errors = [];
  ctx.win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    errors.length = 0;
    await H.load({ w, h, ready: 'fit', settle: false });
    await js(`window.addEventListener('error',e=>{(window.__actErr=window.__actErr||[]).push(String(e.message))});window.addEventListener('unhandledrejection',e=>{(window.__actErr=window.__actErr||[]).push(String(e.reason&&e.reason.message||e.reason))})`);

    const g = await js(`({act:typeof (window.DurbarActivity&&window.DurbarActivity.agoLong),table:typeof (window.DurbarActivityTable&&window.DurbarActivityTable.tableHtml),same:window.DurbarActivity===window.DurbarActivityTable})`);
    assert.deepStrictEqual(g, { act: 'function', table: 'function', same: false }, `${tag}: each script keeps its own global: ${jsLiteral(g)}`);

    assert.ok(await H.click('#toolsBtn'), `${tag}: the Tools button`);
    assert.ok(await H.until(`document.getElementById('tabActivity')`), `${tag}: the Activity tab is there`);
    assert.ok(await H.click('#tabActivity'), `${tag}: the Activity tab opens`);
    assert.ok(await H.until(`document.querySelector('#screen table.act tbody tr')`), `${tag}: the activity table renders`);

    const t = await js(`(()=>{const s=document.getElementById('screen'),tb=s.querySelector('table.act');
      const rows=[...tb.querySelectorAll('tbody tr')];
      const small=[...s.querySelectorAll('*')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.tagName+':'+e.textContent.trim().slice(0,30));
      return {sel:document.getElementById('tabActivity').getAttribute('aria-selected'),
        head:[...tb.querySelectorAll('thead th')].map(x=>x.textContent),
        n:rows.length,
        decisions:rows.map(r=>r.lastElementChild.textContent),
        times:rows.every(r=>r.firstElementChild.textContent.trim().length>0),
        note:(tb.previousElementSibling||{}).textContent||'',
        btns:['actCsv','actJson','actClear'].map(i=>{const b=document.getElementById(i);return !!b&&!b.disabled}),
        small, wide:s.scrollWidth-s.clientWidth, err:window.__actErr||[]};})()`);
    assert.strictEqual(t.sel, 'true', `${tag}: the Activity tab is selected`);
    assert.deepStrictEqual(t.head, ['Time', 'Agent', 'Folder', 'App', 'Mode', 'Action', 'Decision'], `${tag}: the table header`);
    assert.ok(t.n >= 7, `${tag}: the simulator's sample rows are shown (${t.n})`);
    assert.ok(t.times, `${tag}: every row has a time`);
    for (const d of ['Allowed once by you', 'Denied', 'Mode changed', 'Automatic (Allow all)']) assert.ok(t.decisions.includes(d), `${tag}: a "${d}" row: ${jsLiteral(t.decisions)}`);
    assert.ok(/^Kept on this computer\./.test(t.note), `${tag}: the privacy note: ${t.note}`);
    assert.deepStrictEqual(t.btns, [true, true, true], `${tag}: Export CSV, Export JSON and Clear are enabled`);
    assert.deepStrictEqual(t.small, [], `${tag}: no text under 10.5px`);
    assert.ok(t.wide <= 1, `${tag}: the screen does not scroll sideways (${t.wide}px)`);
    assert.deepStrictEqual(t.err, [], `${tag}: no page error`);
    assert.deepStrictEqual(errors.filter((m) => /DurbarActivity|tableHtml|NOTE/.test(m)), [], `${tag}: no console error from the table`);
    await H.shot(path.join(OUT, `052-activity-table-${tag}.png`), { prep: 'mouse', delay: 300, tag: 'activity-table' });
    console.log(`[activity-table] ${tag} ok (${t.n} rows)`);
  }
  console.log('[activity-table] all checks passed');
};
