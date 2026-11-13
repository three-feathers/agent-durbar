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
        small, wide:s.scrollWidth-s.clientWidth,
        body:Math.round(s.querySelector('.scr-body').getBoundingClientRect().width), screenW:s.clientWidth,
        headPad:parseFloat(getComputedStyle(s.querySelector('.scr-head')).paddingLeft),
        clip:tb.getBoundingClientRect().right-s.querySelector('.scr-body').getBoundingClientRect().right,
        wrapShort:rows.some(r=>[...r.querySelectorAll('.act-s,.act-t,td:last-child')].some(c=>getComputedStyle(c).whiteSpace!=='nowrap')), err:window.__actErr||[]};})()`);
    assert.strictEqual(t.sel, 'true', `${tag}: the Activity tab is selected`);
    assert.deepStrictEqual(t.head, ['Time', 'Agent', 'Folder', 'App', 'Mode', 'Action', 'Decision'], `${tag}: the table header`);
    assert.ok(t.n >= 7, `${tag}: the simulator's sample rows are shown (${t.n})`);
    assert.ok(t.times, `${tag}: every row has a time`);
    for (const d of ['Allowed once by you', 'Denied', 'Mode changed', 'Automatic (Allow all)']) assert.ok(t.decisions.includes(d), `${tag}: a "${d}" row: ${jsLiteral(t.decisions)}`);
    assert.ok(/^Kept on this computer\./.test(t.note), `${tag}: the privacy note: ${t.note}`);
    assert.deepStrictEqual(t.btns, [true, true, true], `${tag}: Export CSV, Export JSON and Clear are enabled`);
    assert.deepStrictEqual(t.small, [], `${tag}: no text under 10.5px`);
    assert.ok(t.wide <= 1, `${tag}: the screen does not scroll sideways (${t.wide}px)`);
    assert.ok(t.body >= t.screenW - 2, `${tag}: the Activity body uses the window width (${t.body} of ${t.screenW})`);
    assert.ok(t.headPad <= 80, `${tag}: the header follows the wide body (${t.headPad}px)`);
    assert.ok(t.clip <= 1, `${tag}: the Decision column is not cut at the right (${t.clip}px)`);
    assert.ok(!t.wrapShort, `${tag}: Time, App, Mode and Decision do not wrap`);
    /* a long unbroken Folder (114 characters) and a long Agent name must wrap in their cells, not push Action and Decision out of the window */
    const lg = await js(`(()=>{const s=document.getElementById('screen'),A=window.DurbarActivityTable,e=x=>String(x).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
      const row=(o)=>Object.assign({t:new Date().toISOString(),agent:'Ben',folder:'api',app:'GitHub Copilot',mode:'ask',action:'Run npm test',decision:'allowed-once'},o);
      const tb=s.querySelector('table.act');
      tb.outerHTML=A.tableHtml([row({folder:'/Users/someone/Projects/'+'x'.repeat(90),agent:'An-Agent-With-A-Very-Long-Name-That-Has-No-Spaces-At-All-0123456789',action:'git commit -m "a long message that wraps in the Action cell"'}),row({})],e);
      const b=s.querySelector('.scr-body'),t=s.querySelector('table.act'),a=t.querySelector('.act-a');
      const dc=[...t.querySelectorAll('tbody tr')[0].children].pop().getBoundingClientRect();
      return {side:s.scrollWidth-s.clientWidth,bodySide:b.scrollWidth-b.clientWidth,right:t.getBoundingClientRect().right-b.getBoundingClientRect().right,decRight:dc.right,winW:document.documentElement.clientWidth,actW:Math.round(a.getBoundingClientRect().width),title:a.getAttribute('title')};})()`);
    assert.ok(lg.side <= 1 && lg.bodySide <= 1, `${tag}: a long Folder does not scroll the page or the body sideways: ${jsLiteral(lg)}`);
    assert.ok(lg.right <= 1 && lg.decRight <= lg.winW, `${tag}: Decision stays inside the window: ${jsLiteral(lg)}`);
    assert.ok(lg.actW >= 150, `${tag}: Action is not collapsed (${lg.actW}px)`);
    assert.ok(/commit/.test(lg.title), `${tag}: the Action cell has its text as title`);
    assert.ok(await H.click('#tabCost'), `${tag}: the Cost tab opens`);
    assert.ok(await H.until(`document.querySelector('#screen .scr-body:not(.scr-wide)')`), `${tag}: other Tools tabs keep the 880px column`);
    assert.ok(await H.js(`document.querySelector('#screen .scr-body').getBoundingClientRect().width<=880`), `${tag}: the Cost body is at most 880px`);
    assert.ok(await H.click('#tabActivity') && await H.until(`document.querySelector('#screen table.act tbody tr')`), `${tag}: back on Activity`);
    assert.deepStrictEqual(t.err, [], `${tag}: no page error`);
    assert.deepStrictEqual(errors.filter((m) => /DurbarActivity|tableHtml|NOTE/.test(m)), [], `${tag}: no console error from the table`);
    await H.shot(path.join(OUT, `052-activity-table-${tag}.png`), { prep: 'mouse', delay: 300, tag: 'activity-table' });
    console.log(`[activity-table] ${tag} ok (${t.n} rows)`);
  }
  /* narrow window (review of #1467): .act-a{min-width:24ch} keeps Action from collapsing; the table scrolls inside .scr-body, not the page. 900 is above the 700px KNOWN GAP of spec 052 */
  {
    const tag = '900x800 narrow';
    await H.load({ w: 900, h: 800, ready: 'fit', settle: false });
    assert.ok(await H.click('#toolsBtn'), `${tag}: the Tools button`);
    assert.ok(await H.until(`document.getElementById('tabActivity')`), `${tag}: the Activity tab is there`);
    assert.ok(await H.click('#tabActivity'), `${tag}: the Activity tab opens`);
    assert.ok(await H.until(`document.querySelector('#screen table.act tbody tr')`), `${tag}: the activity table renders`);
    const n = await js(`(()=>{const s=document.getElementById('screen'),A=window.DurbarActivityTable,e=x=>String(x).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
      const row=(o)=>Object.assign({t:new Date().toISOString(),agent:'Ben',folder:'api',app:'GitHub Copilot',mode:'ask',action:'Run npm test',decision:'allowed-once'},o);
      s.querySelector('table.act').outerHTML=A.tableHtml([row({folder:'/Users/someone/Projects/'+'x'.repeat(90),agent:'An-Agent-With-A-Very-Long-Name-That-Has-No-Spaces-At-All-0123456789',action:'git commit -m "a long message that wraps in the Action cell"'}),row({})],e);
      const a=s.querySelector('table.act .act-a'),cs=getComputedStyle(a),c=document.createElement('canvas').getContext('2d');
      c.font=cs.fontStyle+' '+cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
      return {actW:a.getBoundingClientRect().width,ch:c.measureText('0').width,minW:cs.minWidth,bodyRight:Math.round(s.querySelector('.scr-body').getBoundingClientRect().right-s.clientWidth),side:s.scrollWidth-s.clientWidth,doc:document.documentElement.scrollWidth-document.documentElement.clientWidth};})()`);
    assert.ok(n.ch > 0 && n.actW >= 24 * n.ch - 1, `${tag}: Action keeps its 24ch minimum: ${jsLiteral(n)}`);
    assert.ok(n.minW !== 'auto' && n.minW !== '0px', `${tag}: Action has a min-width: ${jsLiteral(n)}`);
    assert.ok(n.bodyRight <= 1 && n.doc <= 1, `${tag}: the page does not scroll sideways, the table scrolls inside the body: ${jsLiteral(n)}`);
    console.log(`[activity-table] ${tag} ok (Action ${Math.round(n.actW)}px, 24ch = ${Math.round(24 * n.ch)}px)`);
  }
  console.log('[activity-table] all checks passed');
};
