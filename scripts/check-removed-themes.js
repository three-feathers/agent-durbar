/*
 * Removed built-in themes (spec 035 FR-017, FR-018). Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI credits.
 *
 * At 1440x900 and 1280x800, a run that starts with a stored theme id of each removed built-in (corporate, durbar-indian,
 * durbar-european, durbar-japanese; the simulator reads it from `?theme=`, as it reads the saved one) shows Clean Office, with no
 * UI style on the page, and without an error; Retro Pixel as the stored id still applies. Settings lists exactly Clean Office and
 * Retro Pixel. The flat office is shown in a picture per size (SHOTS_OUT, default removed-themes-shots in the OS temp folder).
 *
 *   DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/check-removed-themes.js electron . --no-sandbox   (in check:ui)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');

const REMOVED = ['corporate', 'durbar-indian', 'durbar-european', 'durbar-japanese'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const out = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'removed-themes-shots');
  fs.mkdirSync(out, { recursive: true });
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    for (const id of REMOVED) {
      await H.load({ w, h, query: { theme: id }, ready: 'fit', settle: false });
      await H.office(15);
      assert.ok(await H.until(`window.THEME.current().id==='clean-office'`, 6000), `${tag} ${id}: Clean Office is applied`);
      assert.strictEqual(await H.js(`document.documentElement.dataset.ui||''`), '', `${tag} ${id}: no UI style on the page`);
      assert.strictEqual(await H.js(`window.THEME.sceneKit()`), 'office', `${tag} ${id}: the office figure is drawn`);
      assert.ok(await H.js(`document.querySelectorAll('#stage .desk[data-id]').length>=12`), `${tag} ${id}: the office is drawn`);
      if (id === 'corporate') await H.shot(path.join(out, `035-flat-after-removed-theme-${tag}.png`), { prep: 'calm' });
    }
    await H.load({ w, h, query: { theme: 'retro' }, ready: 'fit', settle: false });
    await H.office(15);
    assert.ok(await H.until(`window.THEME.current().id==='retro'`, 6000), `${tag}: Retro Pixel as the stored theme still applies (spec 035 FR-019)`);
    await H.js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await H.until(`!!document.getElementById('thList')`, 6000), `${tag}: Settings shows the theme list`);
    assert.deepStrictEqual(await H.js(`[...document.querySelectorAll('#thList [data-theme]')].map(b=>b.dataset.theme)`), ['clean-office', 'retro'], `${tag}: the list holds the two built-in themes only`);
    console.log(`[removed-themes] ${tag} ok`);
  }
  console.log('[removed-themes] checks passed');
  process.exitCode = 0;
};
