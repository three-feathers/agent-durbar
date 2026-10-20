/*
 * Spec 044 FR-006..FR-008: the starter kit in the Schedules dialog. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-044-templates.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: "Start from a template" fills the prompt and "Every day at 08:30"; the note says what the template needs and
 * that it ends with a question; Add schedule lists it as "every day at 08:30". Phase 2: the calendar choice is "Every day" and
 * "Weekly on" shows the day checkboxes. Writes 044-templates-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(500);
    await js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);return true})()`);
    await js(`document.getElementById('foldersBtn').click()`); await ctx.sleep(300);
    await js(`document.querySelector('[data-fp="sched"]').click()`); await ctx.sleep(400);
    assert.ok(await js(`!!document.getElementById('scTpl')`), 'the template picker is there');
    await js(`(()=>{const s=document.getElementById('scTpl');s.value='start-my-day';s.dispatchEvent(new Event('change'));return true})()`); await ctx.sleep(200);
    const st = await js(`({p:document.getElementById('scPrompt').value,kind:document.querySelector('input[name="scKind"]:checked').value,t:document.getElementById('scDaily').value,note:document.getElementById('scTplNote').textContent,fits:(()=>{const r=document.querySelector('#schedDlg .dlg').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()})`);
    console.log('[044-tpl]', w, JSON.stringify({ kind: st.kind, t: st.t, fits: st.fits, chars: st.p.length }));
    assert.match(st.p, /^Start my day/);
    assert.strictEqual(st.kind, 'daily');
    assert.strictEqual(st.t, '08:30');
    assert.match(st.note, /shows as Waiting,/);
    assert.ok(st.fits, 'the dialog fits the window');
    // Phase 2 FR-012: "On a calendar" is every day for the template; weekly shows the day checkboxes, then back to every day
    const cal = await js(`(()=>{const c=document.getElementById('scCal'),days=document.getElementById('scDays');const a=[c.value,days.hidden];c.value='weekly';c.dispatchEvent(new Event('change'));const b=[days.hidden,days.querySelectorAll('input:checked').length];c.value='daily';c.dispatchEvent(new Event('change'));return {a,b,back:days.hidden}})()`);
    assert.deepStrictEqual(cal.a, ['daily', true], 'every day, no day checkboxes');
    assert.deepStrictEqual(cal.b, [false, 1], 'weekly: the days show, today is ticked');
    assert.strictEqual(cal.back, true);
    await ctx.shot(path.join(OUT, `044-templates-${w}x${h}.png`));
    await js(`document.getElementById('scAdd').click()`); await ctx.sleep(500);
    const row = await js(`(document.querySelector('#sdList .sc-row small')||{}).textContent||''`);
    assert.match(row, /every day at 08:30/, 'listed as every day at 08:30');
    await js(`document.getElementById('scClose').click()`); await ctx.sleep(200);
  }
  console.log('[044-tpl] PASS');
};
