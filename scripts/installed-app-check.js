/**
 * Spec 008 T021: runs inside the INSTALLED app (DURBAR_DEV=1, the simulator, no account, no credits), started by
 * `scripts/installed-app-ci.js` after a real install of the release package. Checks that the office renders with the simulator's
 * 15 agents, reads the app's own name and the window title, saves a screenshot and writes the result as JSON (INSTALLED_OUT).
 */
const fs = require('fs');
const path = require('path');
module.exports = async (ctx) => {
  const { app } = require('electron');
  const out = { packaged: app.isPackaged, name: app.getName(), version: app.getVersion(), exe: path.basename(process.execPath), noSandbox: process.argv.includes('--no-sandbox') };
  ctx.win.setContentSize(1440, 900);
  out.office = await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 60000);
  out.desks = await ctx.js(`document.querySelectorAll('#stage .desk[data-id]').length`);
  out.title = ctx.win.getTitle();
  await ctx.sleep(800);
  if (process.env.INSTALLED_SHOT) await ctx.shot(process.env.INSTALLED_SHOT);
  console.log('[installed]', JSON.stringify(out));
  if (process.env.INSTALLED_OUT) fs.writeFileSync(process.env.INSTALLED_OUT, JSON.stringify(out));
};
