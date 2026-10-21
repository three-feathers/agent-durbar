/* The calm warning after adding a home folder (spec 006 FR-016, issue #170). Simulator only, no credits.
     DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 SHOTS_SIZE=1440x900 DURBAR_DRIVER=$PWD/scripts/shots-006-home.js xvfb-run -a npx electron . --no-sandbox
   Saves docs/screenshots/006-home-warning-<size>.png; fails when the warning does not appear. */
const path = require('path');
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const size = /^(\d+)x(\d+)$/.exec(process.env.SHOTS_SIZE || '') || [null, '1440', '900'];
  await H.load({ w: Number(size[1]), h: Number(size[2]), query: { simaddhome: '1' }, ready: 'fit', settle: false });
  /* the simulator's "restored" toast arrives a few seconds after start: let it come, then clear it */
  await ctx.waitFor(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/restored/.test(t.textContent))`, 10000).catch(() => undefined);
  await ctx.js(`(()=>{document.querySelectorAll('#toasts > *').forEach((t)=>t.remove());document.getElementById('addFolder').click();return true})()`);
  await ctx.waitFor(`[...document.querySelectorAll('#toasts .toast')].some((t)=>/SSH keys/.test(t.textContent))`, 5000);
  await ctx.js(`(()=>{document.querySelectorAll('#toasts .toast').forEach((t)=>{if(!/SSH keys/.test(t.textContent))t.remove();});return true})()`);
  await ctx.sleep(900);
  const room = await ctx.js(`[...document.querySelectorAll('.room-name, .plate-tx b')].some((n)=>n.textContent.trim()==='home')`);
  if (!room) throw new Error('the added home folder has no room');
  await ctx.shot(path.join(__dirname, '..', 'docs', 'screenshots', `006-home-warning-${size[1]}x${size[2]}.png`));
  console.log('[shots-006-home] saved', `${size[1]}x${size[2]}`);
};
