/*
 * Spec 011 FR-096 (issue #1667): a Copilot runtime that asks below its cap (SDK 1.0.32 asks at 90%) gets "Close to the spending limit"
 * on the card, with the same choices. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-011-limit-near.js xvfb-run -a npx electron . --no-sandbox
 *
 * `simlimitnear`: Omar (30 AIU cap) spends 9.5 a call and the simulated runtime asks at 90%, so his third call (28.5) asks with `near`.
 * At both sizes: his card reads "Close to the spending limit: used 28.50 of 30 AIU. The agent waits for you." with Raise limit / Remove
 * limit / Stop here, its accessible name and the agent's state say "Close to spending limit", no "Limit reached" anywhere. Writes limit-near-<w>x<h>.png (not linked from any page).
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { sim: '15', simlimitnear: '1' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=15`, settle: false });
    const omar = `[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>d.innerText.split('\\n').some(l=>l.trim()==='Omar'))`;
    assert.ok(await until(`!!(${omar})`, 10000), `${w}: Omar's desk`);
    await js(`(${omar}).click()`); await ctx.sleep(700);
    assert.ok(await until(`!!document.querySelector('#chat .note.limit')`, 60000), `${w}: Omar's limit card`);
    await js(`(()=>{const d=document.querySelector('details[open]');if(d)d.open=false;document.querySelector('#chat .note.limit').scrollIntoView({block:'center'});return true})()`);
    await ctx.sleep(400);
    const note = await js(`document.querySelector('#chat .note.limit').textContent`);
    const label = await js(`document.querySelector('#chat .note.limit').getAttribute('aria-label')`);
    console.log('[011-near]', w, JSON.stringify(note), JSON.stringify(label));
    assert.match(note, /^Close to the spending limit: used 28\.50 of 30 AIU\. The agent waits for you\./, `${w}: FR-096 near words on the card`);
    assert.ok(!/Spending limit reached/.test(note), `${w}: not "reached" below the cap`);
    assert.match(note, /Raise limit/); assert.match(note, /Remove limit/); assert.match(note, /Stop here/);
    assert.strictEqual(label, 'Close to spending limit', `${w}: FR-096 the card's accessible name`);
    // the state chip and the line under the name (the Bank's word) say "close to" too; no "Limit reached" anywhere (no one else is at a cap)
    assert.ok(await until(`document.body.innerText.includes('Close to spending limit')`, 5000), `${w}: FR-096 the state says Close to spending limit`);
    assert.ok(!/Limit reached|Spending limit reached/.test(await js(`document.body.innerText`)), `${w}: FR-096 no "reached" words below the cap`);
    await H.shot(path.join(OUT, `limit-near-${w}x${h}.png`), { prep: 'calm', delay: 200 });
  }
  console.log('[011-near] all checks passed');
};
