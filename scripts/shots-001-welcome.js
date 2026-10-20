/*
 * Spec 001 FR-026/FR-027: the welcome card of an empty office. Real app with a fresh profile (no folders, nothing runs, no
 * prompt, no credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-001-welcome.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks the multi-harness wording (FR-027), the "Do you write code?" choice (spec 052 FR-082) and writes 001-welcome-1440x900.png and
 * 001-welcome-1280x800.png. After the pictures it presses both answers and checks the detail level follows and is remembered.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(3500);
    const t = await ctx.js(`(document.querySelector('.welcome')||{}).innerText||''`);
    assert.ok(t, 'the welcome card is shown');
    for (const need of ['Your AI agents in one office', 'GitHub Copilot', 'Claude Code', 'Add a folder', 'your own plan']) assert.ok(t.includes(need), `welcome says "${need}"`);
    assert.ok(!/coding agent/i.test(t), 'no "coding agents" wording');
    for (const need of ['Do you write code?', 'Yes, show me the details', 'No, keep it simple']) assert.ok(t.includes(need), `welcome asks "${need}"`);
    assert.ok(await ctx.js(`!document.body.classList.contains('simple')&&[...document.querySelectorAll('[data-wl-level]')].every(b=>b.getAttribute('aria-pressed')==='false')`), 'nothing chosen yet: Expert, no answer pressed');
    const overflow = await ctx.js(`(()=>{const c=document.querySelector('.welcome').getBoundingClientRect();return c.right>innerWidth+1||c.bottom>innerHeight+1})()`);
    assert.ok(!overflow, 'the card fits the window');
    await ctx.shot(path.join(OUT, `001-welcome-${w}x${h}.png`));
    console.log('[001-welcome]', w, 'ok');
  }
  // spec 052 FR-082: the answer sets the detail level and is remembered like the Settings choice
  await ctx.js(`document.querySelector('[data-wl-level="simple"]').click()`); await ctx.sleep(500);
  const simple = await ctx.js(`({on:document.body.classList.contains('simple'),kept:localStorage.getItem('durbar.detail'),pressed:(document.querySelector('[data-wl-level="simple"]')||{}).getAttribute?document.querySelector('[data-wl-level="simple"]').getAttribute('aria-pressed'):null})`);
  assert.deepStrictEqual(simple, { on: true, kept: 'simple', pressed: 'true' }, 'No, keep it simple: Simple, remembered');
  await ctx.js(`document.querySelector('[data-wl-level="expert"]').click()`); await ctx.sleep(500);
  assert.ok(await ctx.js(`!document.body.classList.contains('simple')&&localStorage.getItem('durbar.detail')==='expert'`), 'Yes, show me the details: Expert, remembered');
  await ctx.js(`localStorage.removeItem('durbar.detail')`); /* leave the fresh profile as it was */
  console.log('[001-welcome] PASS');
};
