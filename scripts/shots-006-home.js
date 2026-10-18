/* The calm warning after adding a home folder (spec 006 FR-016, issue #170). Simulator only, no credits.
     DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 SHOTS_SIZE=1440x900 DURBAR_DRIVER=$PWD/scripts/shots-006-home.js xvfb-run -a npx electron . --no-sandbox
   Saves docs/screenshots/006-home-warning-<size>.png; fails when the warning does not appear. */
const path = require('path');

module.exports = async (ctx) => {
  const size = /^(\d+)x(\d+)$/.exec(process.env.SHOTS_SIZE || '') || [null, '1440', '900'];
  ctx.win.setContentSize(Number(size[1]), Number(size[2]));
  await ctx.win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { query: { sim: '15', simfreeze: '1', simaddhome: '1' } });
  await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
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
