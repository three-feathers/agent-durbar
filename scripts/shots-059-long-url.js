/*
 * Screenshots + check for spec 059 FR-019 (issue #536): a desk whose name is one long URL-like token stays inside its card in the full layout.
 * Simulator only (no AI credits). Three agents give the full layout; `simnames=long` gives agent 2 the URL-like name.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=3 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/shots-059-long-url.js \
 *     npx electron . --no-sandbox        (xvfb-run -a on Linux)
 *
 * OUT_SUFFIX (default empty) is added to the file names (`before`/`after`). A miss prints DRIVER FAILED (Electron still exits 0):
 * look for '[059-url] all checks passed'.
 */
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const SUF = process.env.OUT_SUFFIX ? '-' + process.env.OUT_SUFFIX : '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { sim: '3', simfreeze: '1', simnames: 'long' }, ready: 'fit', settle: false });
    await ctx.sleep(800);
    const r = await H.js(`(()=>{const e=[...document.querySelectorAll('#stage .desk .name')].find(n=>/^https:\\/\\/example\\.invalid\\//.test(n.textContent));if(!e)return null;const c=e.closest('.desk').getBoundingClientRect(),b=e.getBoundingClientRect();return {d:document.getElementById('stage').dataset.d,out:b.right>c.right+0.5||b.left<c.left-0.5||(e.matches('.who .name')&&e.scrollWidth>e.clientWidth+1),lines:Math.round(b.height/parseFloat(getComputedStyle(e).lineHeight||'18')),tip:e.title.length>60}})()`);
    assert.ok(r, `${w}x${h}: the URL-like name is on a card`);
    if (process.env.OUT_SUFFIX !== 'before') assert.strictEqual(r.d, 'full', `${w}x${h}: three agents use the full layout`);
    await H.shot(path.join(OUT, `059-long-url-name${SUF}-${w}x${h}.png`), { prep: 'mouse', delay: 300, tag: '059-url', what: `059-long-url-name${SUF}-${w}x${h}.png` });
    console.log(`[059-url] ${w}x${h} ${JSON.stringify(r)}`);
    if (!process.env.OUT_SUFFIX || process.env.OUT_SUFFIX !== 'before') assert.ok(!r.out && r.tip, `${w}x${h}: the name stays in its card and keeps its tooltip: ${JSON.stringify(r)}`);
  }
  console.log('[059-url] all checks passed');
};
