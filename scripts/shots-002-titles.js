/* Session titles for main agents (spec 001/002 deltas 2026-10-18, issue #126): office and chat pictures at one size.
   Simulator only (simtitles=1), no credits. Usage (Linux, no display):
     DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_TITLES=1 SHOTS_SIZE=1440x900 DURBAR_DRIVER=$PWD/scripts/shots-002-titles.js xvfb-run -a npx electron . --no-sandbox
   Saves docs/screenshots/002-titles-<size>.png and 002-titles-chat-<size>.png; fails when no title reached a card. */
const path = require('path');
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const size = /^(\d+)x(\d+)$/.exec(process.env.SHOTS_SIZE || '') || [null, '1440', '900'];
  const tag = `${size[1]}x${size[2]}`;
  const out = path.join(__dirname, '..', 'docs', 'screenshots');
  await H.load({ w: Number(size[1]), h: Number(size[2]), query: { simtitles: '1' }, ready: 'fit', settle: false });
  await ctx.waitFor(`[...document.querySelectorAll('#stage .desk .name')].some((n)=>n.textContent==='Fix login bug')`, 5000);
  await ctx.sleep(3000); /* the simulator's "restored" toast arrives after about 2 s: wait for it, then clear it */
  const clearToasts = H.clearToasts;
  await clearToasts();
  await ctx.sleep(200);
  await ctx.shot(path.join(out, `002-titles-${tag}.png`));
  await ctx.js(`(()=>{const c=[...document.querySelectorAll('#stage .desk')].find((d)=>d.querySelector('.name').textContent==='Release notes for v0.3');c&&c.click();return !!c})()`);
  await ctx.sleep(800);
  await clearToasts();
  await ctx.shot(path.join(out, `002-titles-chat-${tag}.png`));
  console.log('[shots-002-titles] saved', tag);
};
