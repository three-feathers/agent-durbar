/*
 * Website-gallery and spec 003 / 005 / 011 pictures that show the top bar: the mode menu open on an agent whose folder was restored in
 * "Allow all" (003), the full-screen chat at 1440x900 (005 / m6), and the office with the usage totals at both sizes (011).
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   SHOTS_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-003-011.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes 003-allow-all-menu-1440x900.png, m6-fullchat-sim15-1440x900.png, 011-usage-totals-1440x900.png and 011-usage-totals-1280x800.png
 * (same names as the first set). It asserts what each picture is meant to show and fails (driver error) on a miss.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers'); /* jsLiteral: CodeQL js/bad-code-sanitization, values spliced into page code */
const assert = require('assert');
const OUT = process.env.SHOTS_OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { click, text, idOf } = H;
  const shot = (file) => H.shot(path.join(OUT, file), { prep: 'calm', blur: true, settle: true, delay: 250, tag: '003-011' });

  // 011: the office with the office total chip and each room's total
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(w === 1440 ? 3000 : 1500);
    assert.ok(await ctx.js(`document.querySelectorAll('#stage .desk[data-id]').length>=10`), 'the floor is populated');
    assert.match(await text('#stats'), /(\$|AIU)/, 'the office total is on screen');
    await shot(`011-usage-totals-${w}x${h}.png`);
  }

  // 003: the mode menu on Jonas (his folder was restored in Allow all), then 005: the chat of Ada
  ctx.win.setContentSize(1440, 900);
  await ctx.sleep(1500);
  const jonas = await idOf('Jonas'); assert.ok(jonas, 'Jonas is on the floor');
  await click(`#stage [data-id="${jonas}"]`); await ctx.sleep(1000);
  await click('#modeChip'); await ctx.sleep(400);
  const menu = await text('#modeMenu');
  assert.match(menu, /Read-only/); assert.match(menu, /Ask first/); assert.match(menu, /Allow all/); assert.doesNotMatch(menu, /Allow edits/);
  await shot('003-allow-all-menu-1440x900.png');
  await click('#backBtn'); await ctx.sleep(900);

  // 005: the full-screen chat of Ada (same steps as shots-hero.js)
  const ada = await idOf('Ada'); assert.ok(ada, 'Ada is on the floor');
  await click(`#stage [data-id="${ada}"]`); await ctx.sleep(1000);
  await ctx.js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="true"]');if(t)t.click();})()`); await ctx.sleep(400);
  await ctx.js(`(()=>{const c=document.getElementById('chat');if(c)c.scrollTop=0;const s=document.querySelector('.strip .sitem');if(s&&s.parentElement)s.parentElement.scrollLeft=0;})()`); await ctx.sleep(400);
  assert.match(await text('#modeChip'), /Read-only/, 'the mode chip is in the header');
  await shot('m6-fullchat-sim15-1440x900.png');
};
