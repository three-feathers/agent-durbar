/*
 * Spec 030 FR-036: a new session that starts from a reviewed hand-off summary. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-030-handoff.js xvfb-run -a npx electron . --no-sandbox
 *
 * At both sizes: the New session dialog of a live agent shows "Start with a summary of this conversation"; with it on, Start
 * shows the summary in an editable box (nothing sent yet); the edited text becomes the new session's first message.
 * A kind without the capability (simkinds=mixed: the basic agent) shows no checkbox.
 * Writes handoff-dialog-<w>x<h>.png and handoff-review-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h });
    await H.calm();
    await js(`document.querySelector('#stage .desk[data-id="sim-2"]').click()`); await ctx.sleep(600);
    await js(`document.getElementById('newSessBtn').click()`); await ctx.sleep(400);
    assert.ok(await js(`!!document.getElementById('sdSum')&&!document.getElementById('sdSum').checked`), 'the checkbox is there, off by default');
    await js(`document.getElementById('sdSum').click()`); await ctx.sleep(150);
    await ctx.shot(path.join(OUT, `handoff-dialog-${w}x${h}.png`));
    const sent0 = await js(`document.querySelectorAll('.msg.user').length`);
    await js(`document.getElementById('sdGo').click()`);
    await ctx.waitFor(`!!document.getElementById('hoText')`, 8000);
    await ctx.sleep(200);
    const text = await js(`document.getElementById('hoText').value`);
    console.log('[030-ho]', w, 'summary chars', text.length);
    assert.match(text, /^## Goal/);
    assert.match(text, /## Next step/);
    await ctx.shot(path.join(OUT, `handoff-review-${w}x${h}.png`));
    await js(`(()=>{const t=document.getElementById('hoText');t.value=t.value+'\\n\\nAlso: keep the old API.';return true})()`);
    const before = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`document.getElementById('hoGo').click()`);
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>${before}`, 8000);
    await ctx.sleep(600);
    const first = await js(`(()=>{const b=[...document.querySelectorAll('.msg.user .bubble')].pop();return b?b.textContent:''})()`);
    assert.match(first, /## Goal|Goal/);
    assert.match(first, /keep the old API/, 'the edited text is the first message');
    console.log('[030-ho]', w, 'first message sent, user messages', sent0, '->', await js(`document.querySelectorAll('.msg.user').length`));
    // Cancel in the review box sends nothing and starts nothing
    await js(`document.getElementById('newSessBtn').click()`); await ctx.sleep(300);
    await js(`document.getElementById('sdSum').click()`);
    await js(`document.getElementById('sdGo').click()`);
    await ctx.waitFor(`!!document.getElementById('hoText')`, 8000);
    const n = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`document.getElementById('hoCancel').click()`); await ctx.sleep(400);
    assert.strictEqual(await js(`document.querySelectorAll('#stage .desk[data-id]').length`), n, 'Cancel starts nothing');
    // a kind without the capability: no checkbox
    await H.load({ query: { simkinds: 'mixed' } });
    await js(`document.querySelector('#stage .desk[data-id="sim-7"]').click()`); await ctx.sleep(500);
    const kind = 'basic';
    if (await js(`!!document.getElementById('newSessBtn')`)) {
      await js(`document.getElementById('newSessBtn').click()`); await ctx.sleep(300);
      assert.ok(await js(`!document.getElementById('sdSum')`), `no summary checkbox for the ${kind} kind`);
      await js(`document.getElementById('sdCancel').click()`);
    }
  }
  console.log('[030-ho] PASS');
};
