/*
 * Screenshot of Settings scrolled to the About section (owner Three Feathers, version, contributors; spec 008 FR-018).
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   ABOUT_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-about.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes about-settings-1280x800.png. It asserts the About text, including the version from package.json, and fails on a miss.
 */
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');
const version = require('../package.json').version;
const OUT = process.env.ABOUT_OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  ctx.win.setContentSize(1280, 800);
  await ctx.sleep(2500);
  await ctx.js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(700);
  await ctx.js(`(()=>{const s=document.getElementById('screen');const sc=[s,...s.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+20&&getComputedStyle(e).overflowY!=='visible');if(sc)sc.scrollTop=sc.scrollHeight;})()`); await ctx.sleep(400);
  const text = await ctx.js(`document.getElementById('screen').innerText`);
  assert.match(text, /About/); assert.match(text, /by Three Feathers/); assert.ok(text.includes('Agent Durbar ' + version), 'version ' + version + ' is shown');
  await H.shot(path.join(OUT, 'about-settings-1280x800.png'), { prep: 'calm', blur: true, delay: 500 });
  console.log('[about] saved');
};
