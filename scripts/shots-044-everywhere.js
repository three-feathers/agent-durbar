/*
 * Spec 044 FR-009..FR-011: Schedules are easy to find. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-044-everywhere.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: the room's ⋯ menu has "Schedules"; after adding "Start my day" there, the room header shows a clock chip
 * ("1 · 08:30") that opens the same dialog; the folder's chat header has "Schedules (1)" (and its dialog a "Send to" choice,
 * Phase 2); Settings > Schedules lists it with
 * Pause and Delete. Writes 044-room-chip-<w>x<h>.png and 044-settings-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    await H.calm();
    const room = await js(`document.querySelector('#stage [data-foldermenu]').dataset.foldermenu`);
    assert.ok(!(await js(`!!document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)})`)), 'no chip before there is a schedule');
    // 1) the ⋯ menu has Schedules
    await js(`document.querySelector(${jsLiteral(`#stage [data-foldermenu="${room}"]`)}).click()`); await until(`!!document.querySelector('#modeMenu [data-fact="sched"]')`);
    const items = await js(`[...document.querySelectorAll('#modeMenu [data-fact] b')].map(b=>b.textContent)`);
    assert.ok(items.includes('Schedules'), 'menu: ' + items.join(', '));
    await js(`document.querySelector('#modeMenu [data-fact="sched"]').click()`); await until(`!!document.getElementById('schedDlg')`);
    assert.ok(await js(`!!document.getElementById('schedDlg')`), 'the menu item opens the dialog');
    await js(`(()=>{const s=document.getElementById('scTpl');s.value='start-my-day';s.dispatchEvent(new Event('change'));return true})()`);
    await js(`document.getElementById('scAdd').click()`); await until(`document.querySelectorAll('#sdList .sc-row').length===1`);
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')&&!!document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)})`);
    // 2) the room chip
    const chip = await js(`(document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)})||{}).textContent||''`);
    console.log('[044-every]', w, 'chip', JSON.stringify(chip));
    assert.match(chip, /^1 · (\d\d:\d\d|\w{3} \d\d:\d\d)$/, 'the chip shows the count and a short next run');
    const fits = await js(`(()=>{const c=document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)}).getBoundingClientRect(),h=c.closest?null:null;const head=document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)}).closest('.room-head').getBoundingClientRect();return c.right<=head.right+1&&c.left>=head.left-1})()`);
    assert.ok(fits, 'the chip stays inside the room header');
    await ctx.shot(path.join(OUT, `044-room-chip-${w}x${h}.png`));
    await js(`document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)}).click()`); await until(`!!document.getElementById('schedDlg')`);
    assert.ok(await js(`!!document.getElementById('schedDlg')`), 'the chip opens the dialog');
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    // 3) the chat header button
    await js(`(()=>{const ag=[...document.querySelectorAll('#stage .room')].find(x=>x.querySelector(${jsLiteral(`[data-foldermenu="${room}"]`)})).querySelector('.desk[data-id]');ag.click();return true})()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('schedHdrBtn')`); await settle();
    const btn = await js(`(document.getElementById('schedHdrBtn')||{}).textContent||''`);
    assert.strictEqual(btn, 'Schedules (1)');
    await js(`document.getElementById('schedHdrBtn').click()`); await until(`!!document.getElementById('schedDlg')&&!!document.getElementById('scTarget')`);
    assert.ok(await js(`!!document.getElementById('schedDlg')`), 'the chat button opens the dialog');
    // Phase 2 FR-014: opened from a chat, "Send to" offers the folder's agent (the default) or this session
    // #388 (spec 044): the option reads "This session"; the session's name is on the hint line under it (checked in detail by check-sched-sendto)
    const to = await js(`(()=>{const t=document.getElementById('scTarget');return t?{n:t.options.length,v:t.value,second:t.options[1].textContent,hint:t.getAttribute('aria-describedby')}:null})()`);
    assert.ok(to && to.n === 2 && to.v === '' && to.second === 'This session' && to.hint === 'scToHint', 'Send to: ' + JSON.stringify(to));
    await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
    await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`);
    // 4) Settings > Schedules
    await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelectorAll('#schedSet .sc-row').length===1`); await settle();
    const set = await js(`({rows:document.querySelectorAll('#schedSet .sc-row').length,text:document.getElementById('schedSet').innerText})`);
    console.log('[044-every]', w, 'settings rows', set.rows);
    assert.strictEqual(set.rows, 1);
    assert.match(set.text, /every day at 08:30/);
    await js(`(()=>{const sec=document.getElementById('schH').closest('section');let b=sec.parentElement;while(b&&b.scrollHeight<=b.clientHeight)b=b.parentElement;b=b||document.scrollingElement;b.scrollTop+=sec.getBoundingClientRect().top-b.getBoundingClientRect().top-12;return true})()`); await settle();
    await ctx.shot(path.join(OUT, `044-settings-${w}x${h}.png`));
    await js(`document.querySelector('#schedSet [data-ss="pause"]').click()`); await until(`/paused/.test(document.getElementById('schedSet').innerText)`);
    assert.match(await js(`document.getElementById('schedSet').innerText`), /paused/, 'Pause from Settings');
    await js(`document.querySelector('#schedSet [data-ss="del"]').click()`); await until(`document.querySelectorAll('#schedSet .sc-row').length===0`);
    assert.strictEqual(await js(`document.querySelectorAll('#schedSet .sc-row').length`), 0, 'Delete from Settings');
    await js(`document.getElementById('scrClose').click()`); await until(`!(document.getElementById('scrClose')&&document.getElementById('scrClose').getClientRects().length)`); await settle();
    assert.ok(!(await js(`!!document.querySelector(${jsLiteral(`#stage [data-schedroom="${room}"]`)})`)), 'the chip goes away with the last schedule');
  }
  console.log('[044-every] PASS');
};
