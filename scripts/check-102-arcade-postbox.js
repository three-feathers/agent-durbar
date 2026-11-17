/*
 * Spec 102 T318 (issue #1399): the Postbox in the arcade. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 and simsched=1 in the page's own
 * query: three seeded schedules, two missed runs), no AI credits; every wait is an until(). At 1440x900 and 1280x800 in the arcade
 * (worldflags=retro&world=retro) it fails when:
 *   - the Postbox is not a lobby plate button (`.ro-lplate[data-place=postbox][data-post]`) named Postbox (the arcade's plate keeps the lobby
 *     word, as Photo's does: the flat Retro theme's Mailbox is not drawn here) with the label "Postbox: the next scheduled runs. Open Settings > Schedules.";
 *   - a click on it does not open Settings at Schedules (the heading focused).
 *   POSTBOX_MUTANT=click   a click on the plate is swallowed before the app sees it (must fail at "a click on the Postbox opens Settings")
 *
 *   npm run check:ui -- --only check-102-arcade-postbox
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const MUTANT = process.env.POSTBOX_MUTANT || '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} arcade`;
    await H.load({ w, h, query: { officeview: 'real', sim: '15', simsched: '1', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10&&!!document.querySelector('#stage .ro-lplate[data-place="postbox"]')`, readyMs: 30000, settle: false });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    if (MUTANT === 'click') await js(`(()=>{document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.ro-lplate[data-place="postbox"]'))e.stopImmediatePropagation()},true);return 1})()`);
    const p = await js(`(()=>{const e=document.querySelector('#stage .ro-lplate[data-place="postbox"]');return {tag:e.tagName,post:e.dataset.post,title:e.getAttribute('title'),label:e.getAttribute('aria-label'),text:e.textContent}})()`);
    assert.ok(p.tag === 'BUTTON' && p.post === '1', `${tag}: the Postbox is a lobby plate button: ${JSON.stringify(p)}`);
    assert.strictEqual(p.label, 'Postbox: the next scheduled runs. Open Settings > Schedules.', `${tag}: its label says what it is and where it leads: ${JSON.stringify(p)}`);
    assert.strictEqual(p.text, 'Postbox', `${tag}: the plate reads Postbox: ${JSON.stringify(p)}`);
    await js(`document.querySelector('#stage .ro-lplate[data-place="postbox"]').click()`);
    assert.ok(await H.until(`!document.getElementById('screen').hidden&&!!document.getElementById('schedSet')`, 5000), `${tag}: a click on the Postbox opens Settings > Schedules`);
    assert.ok(await H.until(`(document.activeElement||{}).id==='schH'`, 3000), `${tag}: with the Schedules heading focused`);
    await js(`window.DurbarScreens.close()`);
    assert.ok(await H.until(`document.getElementById('screen').hidden`, 4000), `${tag}: Settings closed`);
    console.log(`[arcade-postbox] ${tag} ok: ${p.label}`);
  }
  console.log('[arcade-postbox] all checks passed');
};
