/*
 * Screenshots + UI checks for the per-folder "Import from VS Code" action (spec 020 FR-020..FR-031, issue #7).
 * Simulator only (no AI credits, no Copilot login). Linux with xvfb-run:
 *
 *   npm run build
 *   I7_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-i7.js xvfb-run -a npx electron . --no-sandbox
 *
 * It asserts what the pictures show and fails (driver failure) on a miss.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers'); /* jsLiteral: CodeQL js/bad-code-sanitization, values spliced into page code */
const assert = require('assert');
const OUT = process.env.I7_OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { click } = H;
  const text = (sel) => H.text(sel, 'textContent');
  const count = (sel) => ctx.js(`document.querySelectorAll(${jsLiteral(sel)}).length`);
  const shot = (name, w, h) => H.shot(path.join(OUT, `${name}-${w}x${h}.png`), { settle: true, delay: 250, tag: 'i7', what: `${name} ${w} ${h}` });
  const closeDlg = () => ctx.js(`(()=>{const d=document.getElementById('scrDlg');if(d&&d._close)d._close();})()`);
  const roomBtn = (name) => `[data-mcproom][aria-label="MCP extras for ${name}"]`;
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);

    // A folder without a .vscode/mcp.json: the action explains instead of failing
    await click(roomBtn('blog')); await ctx.sleep(600);
    assert.strictEqual(await count('#mcpImportVs'), 1, 'Import from VS Code is a button of the folder extras screen');
    await click('#mcpImportVs'); await ctx.sleep(500);
    assert.match(await text('#scrDlg'), /No \.vscode\/mcp\.json in this folder/);
    await closeDlg(); await ctx.sleep(200);
    await click('#scrClose'); await ctx.sleep(300);

    // The preview for mcp-swiss: nothing ticked, masked keys, a blocked entry, an already-added entry
    await click(roomBtn('mcp-swiss')); await ctx.sleep(600);
    const before = await count('#srvList li.srv');
    await click('#mcpImportVs'); await ctx.sleep(600);
    assert.match(await text('#scrDlg h3'), /Import from VS Code · mcp-swiss/);
    assert.strictEqual(await count('#impList li.imp-row'), 6);
    assert.strictEqual(await count('#impList input[data-imp]:checked'), 0, 'nothing is ticked by default');
    assert.strictEqual(await count('#impList input[data-imp]:disabled'), 2, 'already added and blocked entries cannot be ticked');
    const dlg = await text('#scrDlg');
    assert.match(dlg, /switched off/);
    assert.match(dlg, /DATABASE_URL••••••/, 'values are masked');
    assert.match(dlg, /Authorization.*no value/);
    assert.match(dlg, /already added/);
    assert.match(dlg, /cannot import/);
    assert.match(dlg, /never asks for them/);
    assert.ok(!/postgres:\/\/|secret/i.test(dlg), 'no value in the dialog');
    await click('#scrDlg [data-imp="postgres"]'); await click('#scrDlg [data-imp="sentry"]'); await click('#scrDlg [data-imp="github"]'); await ctx.sleep(200);
    assert.match(await text('#impCount'), /^3 selected/);
    // the dialog fits the window: buttons are in view, nothing wider than the window, text >= 10.5px
    const fit = await ctx.js(`(()=>{const d=document.querySelector('.dlg.imp');const r=d.getBoundingClientRect();const b=d.querySelector('.dbtn').getBoundingClientRect();
      const small=[...d.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length;
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,btnBottom:b.bottom,small,vw:innerWidth,vh:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.ok(fit.top >= 0 && fit.bottom <= fit.vh && fit.left >= 0 && fit.right <= fit.vw && fit.btnBottom <= fit.vh, 'dialog inside the window: ' + JSON.stringify(fit));
    assert.strictEqual(fit.small, 0, 'no text under 10.5px');
    assert.strictEqual(fit.overflowX, false);
    await shot('i7-import-preview', w, h);
    // import: the three arrive OFF and untrusted; the others are not added
    await ctx.js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>/Import selected/.test(x.textContent));b.click();})()`);
    await ctx.sleep(700);
    assert.strictEqual(await count('#srvList li.srv'), before + 3);
    assert.match(await text('#srvList'), /postgres/);
    assert.match(await text('#srvList'), /github-vscode/);
    assert.strictEqual(await count('#srvList li.srv[data-name="postgres"] .swt.on'), 0, 'imported servers are off');
    assert.match(await text('#srvList li.srv[data-name="sentry"]'), /needs secrets|Authorization/);
    await click('#srvList li.srv[data-name="postgres"] [data-act="toggle"]'); await ctx.sleep(400);
    assert.match(await text('#scrDlg'), /Trust "postgres" in mcp-swiss/, 'first switch-on goes through the trust dialog');
    await closeDlg(); await ctx.sleep(200);
    await click('#scrClose'); await ctx.sleep(300);
    // other folders did not get them
    await click(roomBtn('blog')); await ctx.sleep(600);
    assert.strictEqual(await count('#srvList li.srv'), 0, 'import is per folder only');
    await click('#scrClose'); await ctx.sleep(300);
    // reset the sim between sizes: remove the imported ones so both sizes show the same preview
    await click(roomBtn('mcp-swiss')); await ctx.sleep(500);
    for (const n of ['postgres', 'sentry', 'github-vscode']) {
      await click(`li.srv[data-name="${n}"] [data-act="remove"]`); await ctx.sleep(250);
      await ctx.js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Remove');b.click();})()`); await ctx.sleep(400);
    }
    assert.strictEqual(await count('#srvList li.srv'), before, 'back to the starting state for the next size');
    await click('#scrClose'); await ctx.sleep(300);
  }
};
