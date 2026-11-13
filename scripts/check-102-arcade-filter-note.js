/*
 * Spec 102 delta 2026-11-12 (issue #1588, T310): the Retro arcade does not scroll at 1280x800 with a status filter set. Simulator only (no AI credits).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DRIVER_WORLD=retro \
 *     DURBAR_DRIVER=$PWD/scripts/check-102-arcade-filter-note.js xvfb-run -a npx electron . --no-sandbox
 *
 * N of the 15 agents (11, 13 and 14: the simulator's basic agent never works, so 14 is the most the pill can show; 15 is pinned in test-realoffice-aisles) are made Working (the rest go to error), then the Working pill is set: the arcade draws N cabinets and the filter note stands in the floor's top padding.
 * At 1280x800 the room under the note is 669 px and the hall for 11 to 15 agents needs 682: the floor lends its bottom padding and the top padding down to the note's own line.
 * Asserted per N, at 1280x800 and 1440x900: N cabinets drawn; the floor and the office do not scroll; the note is not covered (the hall starts under it); the same five
 * reads 100 ms apart; #floor.ro-tight at 1280x800 only; Show all gives the padding back. Prints "[102] arcade filter note PASS".
 *   OUT=/tmp  (optional) saves 102-arcade-filter-note-<w>x<h>.png for 14 agents.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const FIT = `(()=>{const f=document.getElementById('floor'),r=document.querySelector('#stage .ro'),n=document.getElementById('filterNote'),nb=n&&!n.hidden?n.getBoundingClientRect().bottom:0;return {sh:f.scrollHeight,ch:f.clientHeight,ro:r?Math.round(r.getBoundingClientRect().height):0,roTop:r?Math.round(r.getBoundingClientRect().top):0,roBottom:r?Math.round(r.getBoundingClientRect().bottom):0,fb:Math.round(f.getBoundingClientRect().bottom),fit:document.getElementById('stage').dataset.fit,noteBottom:Math.round(nb),cabs:document.querySelectorAll('#stage .ro .ro-plate[data-id]').length,tight:f.classList.contains('ro-tight'),pt:getComputedStyle(f).paddingTop,pb:getComputedStyle(f).paddingBottom}})()`;
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    for (const n of [14, 13, 11]) {
      const tag = `arcade filter note ${w}x${h}, ${n} agents`;
      await H.load({ w, h, ready: 'fit', focus: true, query: { officeview: 'real' } });
      const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.id)`);
      assert.strictEqual(ids.length, 15, `${tag}: the simulator has 15 main agents`);
      for (const id of ids) await js(`window.__durbarSimEmit({type:'output',sessionId:${jsLiteral(id)},timestamp:Date.now(),text:'x',final:false});0`);
      await settle();
      const working = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.state==='working').map(a=>a.id)`);
      assert.strictEqual(working.length, 14, `${tag}: the simulator can show 14 working agents (its basic agent never works): ${working.length}`);
      for (const id of working.slice(n)) await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'error',intent:'stopped'});0`); /* agents n.. leave Working */
      await settle();
      await js(`document.querySelector('.stat[data-k="working"]').click()`);
      assert.ok(await until(`document.getElementById('filterNote')&&!document.getElementById('filterNote').hidden&&document.getElementById('floor').classList.contains('has-fnote')`, 6000), `${tag}: the filter note shows`);
      await settle();
      const reads = [];
      for (let i = 0; i < 5; i++) { reads.push(JSON.stringify(await js(FIT))); await ctx.sleep(100); }
      assert.ok(reads.every((r) => r === reads[0]), `${tag}: the office is steady: ` + reads.join(' | '));
      const f = JSON.parse(reads[0]);
      assert.strictEqual(f.cabs, n, `${tag}: ${n} cabinets are drawn: ` + reads[0]);
      assert.ok(f.sh <= f.ch + 1 && f.fit === 'ok' && f.roBottom <= f.fb + 1, `${tag}: the office does not scroll (scrollHeight ${f.sh} against clientHeight ${f.ch}, room ends ${f.roBottom} of ${f.fb}): ` + reads[0]);
      assert.ok(f.roTop >= f.noteBottom, `${tag}: the note is not covered by the hall (note ends ${f.noteBottom}, hall starts ${f.roTop})`);
      assert.strictEqual(f.tight, w === 1280, `${tag}: the floor's padding is lent only where the hall needs it (ro-tight ${f.tight}): ` + reads[0]);
      console.log(`[102] ${tag}: ${reads[0]}`);
      if (n === 14) await H.shot(path.join(OUT, `102-arcade-filter-note-${w}x${h}.png`), { prep: 'mouse', tag: '102' });
      await js(`document.querySelector('#filterNote [data-fn-all]').click()`);
      assert.ok(await until(`document.getElementById('filterNote').hidden&&!document.getElementById('floor').className.includes('ro-tight')`, 6000), `${tag}: Show all removes the note and the lent padding`);
      await settle();
      const g = await js(FIT);
      assert.ok(g.sh <= g.ch + 1 && g.fit === 'ok', `${tag}: after Show all the office does not scroll: ` + JSON.stringify(g));
    }
  }
  console.log('[102] arcade filter note PASS');
};
