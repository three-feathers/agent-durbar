/* Full-density figure shots per theme (PR #137 owner review):
   1440x900, sim=12 frozen, all-but-one room closed so the open room lays out at `full`
   density (200x124 scenes with big figures). Saves <SHOTS_DIR>/<theme>-full.png. */
const path = require('path');
const fs = require('fs');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const out = process.env.SHOTS_DIR || '/tmp/theme-shots';
  const theme = process.env.DURBAR_THEME || 'clean-office';
  fs.mkdirSync(out, { recursive: true });
  await H.load({ w: 1440, h: 900, query: { sim: '12', closed: 'swisscontract-ai,command-center,blog,infra-notes' }, ready: 'fit', settle: false });
  await ctx.js(`window.THEME.setTheme(${jsLiteral(theme)})`);
  await ctx.js(`(()=>{document.getElementById('stage').innerHTML='';window.dispatchEvent(new Event('resize'));return true})()`);
  await ctx.sleep(1500);
  const st = await ctx.js(`({theme:window.THEME.current().id,d:document.getElementById('stage').dataset.d,artSlots:document.querySelectorAll('.art-slot,.room-art,.lobby-art').length,desks:document.querySelectorAll('#stage .desk').length})`);
  console.log('[shots-full]', theme, JSON.stringify(st));
  if (st.theme !== theme) throw new Error(`theme ${theme} did not apply`);
  await ctx.sleep(800);
  const file = path.join(out, `${theme}-full.png`);
  await ctx.shot(file);
  console.log('[shots-full] saved', file);
};
