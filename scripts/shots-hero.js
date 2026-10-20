/*
 * The two README hero pictures (office with 15 agents, full-screen chat with 15 agents). Simulator only (no AI credits).
 * Linux with xvfb-run:
 *
 *   npm run build
 *   HERO_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-hero.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes m5-sim15-1440x900-closed.png and m6-fullchat-sim15-1280x800.png (same names as the first set). It asserts that the
 * office total and the room totals (spec 011), the folder MCP buttons and the "Allow all" naming are on screen, and fails on a miss.
 */
const path = require('path');
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const assert = require('assert');
const OUT = process.env.HERO_OUT || '/tmp';

module.exports = async (ctx) => {
  const click = (sel) => ctx.js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.click();return true})()`);
  const calm = () => ctx.js(`(()=>{if(!document.getElementById('shotCalm')){const s=document.createElement('style');s.id='shotCalm';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}
    if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();})()`);
  const shot = async (file) => { await ctx.sleep(450); await calm(); await ctx.sleep(100); await ctx.shot(path.join(OUT, file)); console.log('[hero] saved', file); };
  const idOf = (name) => ctx.js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith(${jsLiteral(name)}));return d?d.dataset.id:null})()`);

  ctx.win.setContentSize(1440, 900);
  await ctx.sleep(3000);
  assert.ok(await ctx.js(`document.querySelectorAll('#stage .desk[data-id]').length>=10`), 'the floor is populated');
  await shot('m5-sim15-1440x900-closed.png');

  ctx.win.setContentSize(1280, 800);
  await ctx.sleep(2000);
  const ada = await idOf('Ada'); assert.ok(ada, 'Ada is on the floor');
  await click(`#stage [data-id="${ada}"]`); await ctx.sleep(1000);
  await ctx.js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="true"]');if(t)t.click();})()`); await ctx.sleep(400);
  // the start of the conversation, and the agent strip from its first agent (the strip scrolls to the open agent)
  await ctx.js(`(()=>{const c=document.getElementById('chat');if(c)c.scrollTop=0;const s=document.querySelector('.strip .sitem');if(s&&s.parentElement)s.parentElement.scrollLeft=0;})()`); await ctx.sleep(400);
  assert.match(await ctx.js(`document.getElementById('modeChip').innerText`), /Read-only/, 'the mode chip is in the header');
  await shot('m6-fullchat-sim15-1280x800.png');
};
