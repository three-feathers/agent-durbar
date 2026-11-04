/*
 * Spec 001 FR-026/FR-027: the welcome card of an empty office. Real app with a fresh profile (no folders, nothing runs, no
 * prompt, no credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-001-welcome.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks the multi-harness wording (FR-027), that the card has no "Do you write code?" question (spec 052, Simple / Expert removed 2026-11-02)
 * and writes 001-welcome-1440x900.png and 001-welcome-1280x800.png.
 */
const assert = require('assert');
const path = require('path');
const { waits } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const { until, settle } = waits(ctx); // spec 008 FR-096: wait for the page, not a fixed time
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await until(`!!document.querySelector('.welcome')`, 15000); await settle();
    const t = await ctx.js(`(document.querySelector('.welcome')||{}).innerText||''`);
    assert.ok(t, 'the welcome card is shown');
    for (const need of ['Your AI agents in one office', 'GitHub Copilot', 'Claude Code', 'Add a folder', 'your own plan']) assert.ok(t.includes(need), `welcome says "${need}"`);
    assert.ok(!/coding agent/i.test(t), 'no "coding agents" wording');
    assert.ok(!/Do you write code|keep it simple|show me the details/i.test(t) && !(await ctx.js(`!!document.querySelector('[data-wl-level]')`)), 'the welcome card asks no detail-level question');
    const overflow = await ctx.js(`(()=>{const c=document.querySelector('.welcome').getBoundingClientRect();return c.right>innerWidth+1||c.bottom>innerHeight+1})()`);
    assert.ok(!overflow, 'the card fits the window');
    await ctx.shot(path.join(OUT, `001-welcome-${w}x${h}.png`));
    console.log('[001-welcome]', w, 'ok');
  }
  console.log('[001-welcome] PASS');
};
