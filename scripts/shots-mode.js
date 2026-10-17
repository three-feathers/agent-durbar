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
const assert = require('assert');
const OUT = process.env.MODE_OUT || '/tmp';
const W = 1440, H = 900;

module.exports = async (ctx) => {
  const click = (sel) => ctx.js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
  const text = (sel) => ctx.js(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
  // calm picture: no startup toast over the cards, no focus ring on the menu item
  const calm = () => ctx.js(`(()=>{if(!document.getElementById('shotCalm')){const s=document.createElement('style');s.id='shotCalm';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}
    if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();})()`);
  const shot = async (name) => { await ctx.sleep(450); await calm(); await ctx.shot(path.join(OUT, `m7-mode-${name}.png`)); console.log('[mode] saved', name); };
  const idOf = (name) => ctx.js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.querySelector('.name,.nm,h3,b')&&x.innerText.trim().startsWith(${JSON.stringify(name)}));return d?d.dataset.id:null})()`);
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
  await ctx.js(`(()=>{const d=document.querySelector('#stage .desk[data-id="${jonas}"]');const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+60,clientY:r.top+50}));})()`);
  await ctx.sleep(400);
  const ctxMenu = await text('#modeMenu');
  assert.match(ctxMenu, /Allow all/); assert.doesNotMatch(ctxMenu, /Allow edits/);
  await shot('context');
  assert.ok(!/Allow edits/.test(await text('body')), 'no "Allow edits" anywhere on screen');
};
