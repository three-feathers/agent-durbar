/*
 * Screenshots + UI checks for the permission-mode naming (specs 003 and 018): the mode menu, the "Allow all" confirmation and the
 * right-click menu on an office card. Simulator only (no AI credits, no Copilot login). 1440x900, Linux with xvfb-run:
 *
 *   npm run build
 *   MODE_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-mode.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes m7-mode-switch.png, m7-mode-confirm.png and m7-mode-context.png (same names as the first set, which still said "Allow edits").
 * It asserts that "Allow all" is shown and "Allow edits" is not, and exits non-zero (driver failure) on a miss.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers'); /* jsLiteral: CodeQL js/bad-code-sanitization, values spliced into page code */
const assert = require('assert');
const OUT = process.env.MODE_OUT || '/tmp';
const W = 1440, H = 900;

module.exports = async (ctx) => {
  const HP = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { click, text, idOf } = HP;
  const shot = (name) => HP.shot(path.join(OUT, `m7-mode-${name}.png`), { prep: 'calm', blur: true, settle: true, delay: 250, tag: 'mode', what: name });
  ctx.win.setContentSize(W, H);
  await ctx.sleep(2500);

  // 1) chat header menu (Ada, Read-only now)
  const ada = await idOf('Ada'); assert.ok(ada, 'Ada is on the floor');
  await click(`#stage [data-id="${ada}"]`); await ctx.sleep(800);
  await ctx.js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="true"]');if(t)t.click();})()`); await ctx.sleep(300);
  await click('#modeChip'); await ctx.sleep(400);
  const menu = await text('#modeMenu');
  assert.match(menu, /Allow all/); assert.doesNotMatch(menu, /Allow edits/);
  await shot('switch');

  // 2) the confirmation
  await click('#modeMenu .mm-allow'); await ctx.sleep(500);
  const dlg = await text('#modeDlg');
  assert.match(dlg, /Allow all for Ada\?/); assert.doesNotMatch(dlg, /Allow edits/);
  await shot('confirm');
  await ctx.js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent==='Cancel');b&&b.click()})()`); await ctx.sleep(300);

  // 3) right-click menu on a card in the office
  await click('#backBtn'); await ctx.sleep(900);
  const jonas = await idOf('Jonas'); assert.ok(jonas, 'Jonas is on the floor');
  await ctx.js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${jonas}"]`)});const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+60,clientY:r.top+50}));})()`);
  await ctx.sleep(400);
  const ctxMenu = await text('#modeMenu');
  assert.match(ctxMenu, /Allow all/); assert.doesNotMatch(ctxMenu, /Allow edits/);
  await shot('context');
  assert.ok(!/Allow edits/.test(await text('body')), 'no "Allow edits" anywhere on screen');
};
