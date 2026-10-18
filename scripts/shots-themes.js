/* One office screenshot per built-in theme for owner review (PR #137 stage D).
   Simulator only: DURBAR_SIM=15 DURBAR_SIM_FREEZE=1, 1280x800 (SHOTS_SIZE=1440x900 for the other size), agents settled in the lobby.
   The sim bridge keeps settings in memory, so the theme is applied in-page via the same
   THEME.setTheme() + scene-cache-clear + re-render path that the Settings picker uses.
   Saves <SHOTS_DIR>/<SHOTS_PREFIX><theme>[-<size>].png (no toast in the picture); fails the driver if the theme did not apply. */
const path = require('path');
const fs = require('fs');

module.exports = async (ctx) => {
  const out = process.env.SHOTS_DIR || '/tmp/theme-shots';
  const theme = process.env.DURBAR_THEME || 'clean-office';
  fs.mkdirSync(out, { recursive: true });
  const size = /^(\d+)x(\d+)$/.exec(process.env.SHOTS_SIZE || '') || [null, '1280', '800'];
  ctx.win.setContentSize(Number(size[1]), Number(size[2]));
  await ctx.win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { query: { sim: '15', simfreeze: '1' } });
  await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
  /* apply the requested theme through the same path as the settings picker */
  await ctx.js(`window.THEME.setTheme('${theme}')`);
  await ctx.js(`(()=>{document.getElementById('stage').innerHTML='';window.dispatchEvent(new Event('resize'));return true})()`);
  await ctx.sleep(1500);
  const st = await ctx.js(`({theme:window.THEME.current().id,artSlots:document.querySelectorAll('.art-slot,.room-art,.lobby-art').length,desks:document.querySelectorAll('#stage .desk').length,fit:document.getElementById('stage').dataset.fit})`);
  console.log('[shots-themes]', theme, JSON.stringify(st));
  if (st.theme !== theme) throw new Error(`theme ${theme} did not apply (got ${st.theme})`);
  if (theme !== 'clean-office' && st.artSlots === 0) throw new Error(`${theme}: no art slots rendered`);
  /* let agents settle in the lobby before the shot */
  try {
    await ctx.waitFor(`!!document.querySelector('.place.busy')`, 6000);
    await ctx.waitFor(`!document.querySelector('.walker.walking')`, 6000);
    await ctx.sleep(300);
  } catch (e) { /* fine */ }
  await ctx.js(`(()=>{document.querySelectorAll('#toasts > *').forEach(t=>t.remove());return true})()`);
  await ctx.sleep(200);
  const file = path.join(out, `${process.env.SHOTS_PREFIX || ''}${theme}${process.env.SHOTS_SIZE ? '-' + process.env.SHOTS_SIZE : ''}.png`);
  await ctx.shot(file);
  console.log('[shots-themes] saved', file);
  process.exitCode = 0;
};
