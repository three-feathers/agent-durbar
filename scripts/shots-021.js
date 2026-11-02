/*
 * Checks + screenshots for spec 011 second delta (issue #21): usage totals kept across restarts, the reset, "credits not reported".
 * Simulator only (no AI credits, no Copilot login). It reloads the window with simulator query parameters:
 *   simtotals=1             a previous run saved 41.70 AIU (mcp-swiss 12.40, blog 8.10, and 21.20 in a folder no longer listed)
 *   simunreported=infra-notes   that room's agents and helpers report usage without credits
 *
 *   npm run build
 *   SHOTS_021=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-021.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * It exits non-zero (driver failure) on a miss. What it checks, at 1440x900 and 1280x800:
 *   - the header chip = saved + this run (at least the 41.70 saved), its tooltip says "Saved since 2026-10-01" and gives this run alone;
 *   - mcp-swiss and blog show at least their saved totals; infra-notes says "credits not reported";
 *   - Settings > Credit cap > Usage totals shows the figure and since when, Reset asks first, Cancel changes nothing, Reset sets the
 *     chip and the folder totals to zero (they come back only with new usage).
 */
const path = require('path');
const { helpers } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.SHOTS_021 || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `021-${name}-${w}x${h}.png`), { delay: 300, tag: '021', what: `${name} ${w} ${h}` });
  const load = (w, h) => H.load({ w, h, query: { simtotals: '1', simunreported: 'infra-notes' }, ready: `!!document.querySelector('.stat-aiu')&&/Saved since/.test(document.querySelector('.stat-aiu').title)` }); // was a fixed 1200 ms; now waits for the page to stop changing (FR-096)
  const read = () => js(`(()=>{const c=document.querySelector('.stat-aiu');const rooms={};document.querySelectorAll('.room').forEach(r=>{rooms[r.querySelector('.room-name').textContent.trim()]=((r.querySelector('.room-aiu')||{}).textContent||'').trim();});return {chip:c?c.innerText.replace(/\\s+/g,' ').trim():'',tip:c?c.title:'',rooms}})()`);
  /* spec 021 FR-057 (review of #752): an assert waits on the condition it asserts, never on a fixed sleep */
  const until = async (expr, what) => { assert.ok(await ctx.waitFor(expr, 10000), 'timed out waiting for ' + what); };
  const aiu = (t) => { const m = /([\d.]+) AIU/.exec(t || ''); return m ? parseFloat(m[1]) : NaN; };
  /* spec 052 FR-028 (#307): the chip and the rooms show money (Copilot credits at USD 0.01); the chip's tooltip keeps the exact AIU */
  const officeAiu = (r) => { const m = /= ([\d.]+) AIU/.exec(r.tip || ''); return m ? parseFloat(m[1]) : NaN; };
  const usd = (t) => { if (/^<\$0\.01$/.test(t || '')) return 0; const m = /\$([\d.]+)/.exec(t || ''); return m ? parseFloat(m[1]) : NaN; };
  /* a room shows at least its saved total, in money rounded to the cent */
  const atLeast = (shown, savedAiu) => usd(shown) >= savedAiu * 0.01 - 0.005;

  for (const [w, h] of SIZES) {
    await load(w, h);
    const r = await read();
    console.log('[021]', w, JSON.stringify({ chip: r.chip, rooms: r.rooms }));
    assert.ok(/^≈ \$[\d.]+$/.test(r.chip), 'the chip shows money (spec 052 FR-028): ' + r.chip);
    assert.ok(officeAiu(r) >= 41.7, 'the chip includes what the previous run saved: ' + r.chip + ' / ' + officeAiu(r) + ' AIU');
    assert.ok(/Saved since 2026-10-01 \(reset in Settings\)/.test(r.tip), 'the tooltip says since when');
    assert.ok(/This run: [\d.]+ AIU in \d+ calls?\./.test(r.tip), 'the tooltip gives this run alone');
    assert.ok(/Includes folders no longer shown\./.test(r.tip), 'a saved folder that is not listed is announced');
    assert.ok(atLeast(r.rooms['mcp-swiss'], 12.4), 'mcp-swiss shows at least its saved total: ' + r.rooms['mcp-swiss']);
    assert.ok(atLeast(r.rooms.blog, 8.1), 'blog shows at least its saved total: ' + r.rooms.blog);
    assert.strictEqual(r.rooms['infra-notes'], 'cost not reported', 'a room whose calls carry no credits says so, never $0.00 (spec 052 FR-051: "cost")');
    await shot('office', w, h);
  }

  // Settings: the figure, since when, and the reset (Cancel first, then Reset)
  const [w, h] = SIZES[1];
  await load(w, h);
  const before = officeAiu(await read());
  await js(`document.getElementById('settingsBtn').click()`); await until(`/AIU in \\d+ calls, counting since/.test((document.getElementById('usageNow')||{}).textContent||'')`, 'the usage figure in Settings');
  const now = await js(`(document.getElementById('usageNow')||{}).textContent||''`);
  assert.ok(/^[\d.]+ AIU in \d+ calls, counting since 2026-10-01\.$/.test(now), 'Settings shows the figure and since when: ' + now);
  await js(`document.getElementById('usageTotalsReset').scrollIntoView({block:'center'})`);
  await shot('settings', w, h);
  await js(`document.getElementById('usageTotalsReset').click()`); await until(`/Reset usage totals\\?/.test((document.getElementById('scrDlg')||{}).innerText||'')`, 'the reset confirmation');
  const dlg = await js(`(document.getElementById('scrDlg')||{}).innerText||''`);
  assert.ok(/Reset usage totals\?/.test(dlg) && /Tool counts in Tools > All time are not changed/.test(dlg), 'the confirmation says what is and is not reset');
  await shot('reset-confirm', w, h);
  await js(`[...document.querySelectorAll('#scrDlg button')].find(b=>b.textContent.trim()==='Cancel').click()`); await until(`!document.getElementById('scrDlg')`, 'the confirmation to close');
  await js(`document.getElementById('scrClose').click()`); await until(`!document.getElementById('scrClose')`, 'Settings to close');
  assert.strictEqual(officeAiu(await read()), before, 'Cancel changes nothing');
  await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.getElementById('usageTotalsReset')`, 'Settings');
  await js(`document.getElementById('usageTotalsReset').click()`); await until(`!!document.getElementById('scrDlg')`, 'the reset confirmation');
  await js(`[...document.querySelectorAll('#scrDlg button')].find(b=>b.textContent.trim()==='Reset').click()`); await until(`/^Nothing recorded yet/.test((document.getElementById('usageNow')||{}).textContent||'')`, 'the totals to reset');
  const after = await js(`(document.getElementById('usageNow')||{}).textContent||''`);
  assert.ok(/^Nothing recorded yet, counting since \d{4}-\d{2}-\d{2}\.$/.test(after), 'after the reset Settings starts from zero: ' + after);
  await js(`document.getElementById('scrClose').click()`); await until(`!document.getElementById('scrClose')&&![...document.querySelectorAll('.stat-aiu, .room-aiu')].some(e=>e.textContent.trim())`, 'the header chip and the room totals to clear');
  const z = await read();
  assert.strictEqual(z.chip, '', 'the header chip is gone until new usage arrives');
  assert.ok(Object.values(z.rooms).every((t) => t === ''), 'every folder total starts from zero');
  console.log('[021] all checks passed');
};
