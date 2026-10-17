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
 *   - mcp-swiss and blog show at least their saved totals; infra-notes says "credits not reported" (and "n/r" on its closed door plate);
 *   - Settings > Credit cap > Usage totals shows the figure and since when, Reset asks first, Cancel changes nothing, Reset sets the
 *     chip and the folder totals to zero (they come back only with new usage).
 */
const path = require('path');
const assert = require('assert');
const OUT = process.env.SHOTS_021 || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const js = (code) => ctx.js(code);
  const shot = async (name, w, h) => { await ctx.sleep(300); await ctx.shot(path.join(OUT, `021-${name}-${w}x${h}.png`)); console.log('[021] saved', name, w, h); };
  const load = async (w, h) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simtotals: '1', simunreported: 'infra-notes' } });
    await ctx.waitFor(`!!document.querySelector('.stat-aiu')&&/Saved since/.test(document.querySelector('.stat-aiu').title)`, 15000);
    await ctx.sleep(1200);
  };
  const read = () => js(`(()=>{const c=document.querySelector('.stat-aiu');const rooms={};document.querySelectorAll('.room').forEach(r=>{rooms[r.querySelector('.room-name').textContent.trim()]=((r.querySelector('.room-aiu')||{}).textContent||'').trim();});return {chip:c?c.innerText.replace(/\\s+/g,' ').trim():'',tip:c?c.title:'',rooms}})()`);
  const aiu = (t) => { const m = /([\d.]+) AIU/.exec(t || ''); return m ? parseFloat(m[1]) : NaN; };

  for (const [w, h] of SIZES) {
    await load(w, h);
    const r = await read();
    console.log('[021]', w, JSON.stringify({ chip: r.chip, rooms: r.rooms }));
    assert.ok(aiu(r.chip) >= 41.7, 'the chip includes what the previous run saved: ' + r.chip);
    assert.ok(/Saved since 2026-10-01 \(reset in Settings\)/.test(r.tip), 'the tooltip says since when');
    assert.ok(/Since the app opened \(or the last reset\): [\d.]+ AIU in \d+ calls?\./.test(r.tip), 'the tooltip gives this run alone');
    assert.ok(/Includes folders no longer shown\./.test(r.tip), 'a saved folder that is not listed is announced');
    assert.ok(aiu(r.rooms['mcp-swiss']) >= 12.4, 'mcp-swiss shows at least its saved total: ' + r.rooms['mcp-swiss']);
    assert.ok(aiu(r.rooms.blog) >= 8.1, 'blog shows at least its saved total: ' + r.rooms.blog);
    assert.strictEqual(r.rooms['infra-notes'], 'credits not reported', 'a room whose calls carry no credits says so, never 0.00');
    await shot('office', w, h);

    // the closed door plate uses the short form
    await js(`(()=>{const d=[...document.querySelectorAll('.room-head .door')].find(b=>/infra-notes/.test(b.getAttribute('aria-label')));d.click();})()`); await ctx.sleep(900);
    const plate = await js(`(()=>{const p=[...document.querySelectorAll('.plate')].find(p=>/infra-notes/.test(p.getAttribute('aria-label')));return p?{t:(p.querySelector('.plate-aiu')||{}).textContent,l:p.getAttribute('aria-label')}:null})()`);
    assert.ok(plate && plate.t === 'n/r' && /Usage: credits not reported\./.test(plate.l), 'closed plate: n/r and a spoken label: ' + JSON.stringify(plate));
    if (w === 1280) await shot('unreported-plate', w, h);
    await js(`(()=>{const p=[...document.querySelectorAll('.plate')].find(p=>/infra-notes/.test(p.getAttribute('aria-label')));p.click();})()`); await ctx.sleep(700);
  }

  // Settings: the figure, since when, and the reset (Cancel first, then Reset)
  const [w, h] = SIZES[1];
  await load(w, h);
  const before = aiu((await read()).chip);
  await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
  const now = await js(`(document.getElementById('usageNow')||{}).textContent||''`);
  assert.ok(/^[\d.]+ AIU in \d+ calls, counting since 2026-10-01\.$/.test(now), 'Settings shows the figure and since when: ' + now);
  await js(`document.getElementById('usageTotalsReset').scrollIntoView({block:'center'})`);
  await shot('settings', w, h);
  await js(`document.getElementById('usageTotalsReset').click()`); await ctx.sleep(500);
  const dlg = await js(`(document.getElementById('scrDlg')||{}).innerText||''`);
  assert.ok(/Reset usage totals\?/.test(dlg) && /Tool counts in Tools > All time are not changed/.test(dlg), 'the confirmation says what is and is not reset');
  await shot('reset-confirm', w, h);
  await js(`[...document.querySelectorAll('#scrDlg button')].find(b=>b.textContent.trim()==='Cancel').click()`); await ctx.sleep(500);
  await js(`document.getElementById('scrClose').click()`); await ctx.sleep(500);
  assert.strictEqual(aiu((await read()).chip), before, 'Cancel changes nothing');
  await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
  await js(`document.getElementById('usageTotalsReset').click()`); await ctx.sleep(500);
  await js(`[...document.querySelectorAll('#scrDlg button')].find(b=>b.textContent.trim()==='Reset').click()`); await ctx.sleep(900);
  const after = await js(`(document.getElementById('usageNow')||{}).textContent||''`);
  assert.ok(/^Nothing recorded yet, counting since \d{4}-\d{2}-\d{2}\.$/.test(after), 'after the reset Settings starts from zero: ' + after);
  await js(`document.getElementById('scrClose').click()`); await ctx.sleep(500);
  const z = await read();
  assert.strictEqual(z.chip, '', 'the header chip is gone until new usage arrives');
  assert.ok(Object.values(z.rooms).every((t) => t === ''), 'every folder total starts from zero');
  console.log('[021] all checks passed');
};
