/*
 * Spec 012 FR-150: a dollar cap for Claude Code. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-012-cost-cap.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes, with mixed kinds (simkinds=mixed): Ada is a simulated Claude Code agent with a $0.01 cap. Its chip shows dollars
 * ("$0.00 / $0.01"), the cap dialog asks for dollars (min $0.01), and when the estimate reaches the cap the chat shows
 * "Cost cap reached" with Raise cap / Remove cap / Stop here. Writes cost-cap-<w>x<h>.png and cost-cap-dialog-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const hideToasts = () => js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simkinds: 'mixed' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(500);
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`); await ctx.sleep(700);
    await ctx.waitFor(`!!document.getElementById('capChip')`, 5000);
    const chip = await js(`document.getElementById('capChip').textContent`);
    console.log('[012-cap]', w, 'chip', JSON.stringify(chip));
    assert.match(String(chip), /^\$\d+\.\d\d \/ \$0\.01$/, 'the chip is in dollars');
    // Ada is busy: wait until the estimate reaches the cap, then show the notice
    await ctx.waitFor(`!!document.querySelector('.note.limit')`, 60000);
    await js(`(()=>{const d=document.querySelector('details[open]');if(d)d.open=false;document.querySelector('.note.limit').scrollIntoView({block:'center'});return true})()`);
    await ctx.sleep(400);
    const note = await js(`document.querySelector('.note.limit').textContent`);
    console.log('[012-cap]', w, 'note', JSON.stringify(note));
    assert.match(note, /Cost cap reached/);
    assert.match(note, /Raise cap/);
    assert.ok(!/AIU/.test(note), 'no AIU on a dollar cap');
    await hideToasts(); await ctx.sleep(200);
    await ctx.shot(path.join(OUT, `cost-cap-${w}x${h}.png`));
    // the cap dialog asks for dollars
    await js(`document.getElementById('capChip').click()`); await ctx.sleep(400);
    assert.match(await js(`document.getElementById('cdT').textContent`), /^Cost cap for/);
    assert.strictEqual(await js(`document.getElementById('cdVal').min`), '0.01');
    await ctx.shot(path.join(OUT, `cost-cap-dialog-${w}x${h}.png`));
    await js(`document.getElementById('cdCancel').click()`); await ctx.sleep(200);
  }
  console.log('[012-cap] PASS');
};
