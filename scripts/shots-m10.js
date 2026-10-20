/*
 * Screenshots + UI checks for spec 020 (Tools "This session / All time", the Copilot CLI MCP list first, MCP extras per folder).
 * Simulator only (no AI credits, no Copilot login). Linux with xvfb-run:
 *
 *   npm run build
 *   M10_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-m10.js xvfb-run -a npx electron . --no-sandbox
 *
 * It asserts what the pictures show and exits non-zero (driver failure) on a miss.
 */
const path = require('path');
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const assert = require('assert');
const OUT = process.env.M10_OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const click = (sel) => ctx.js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.click();return true})()`);
  const text = (sel) => ctx.js(`(document.querySelector(${jsLiteral(sel)})||{}).textContent||''`);
  const count = (sel) => ctx.js(`document.querySelectorAll(${jsLiteral(sel)}).length`);
  const calm = () => ctx.js(`(()=>{if(!document.getElementById('shotCalm')){const s=document.createElement('style');s.id='shotCalm';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}})()`); // the startup toast would sit over the pictures
  const shot = async (name, w, h) => { await ctx.sleep(450); await calm(); await ctx.sleep(150); await ctx.shot(path.join(OUT, `m10-${name}-${w}x${h}.png`)); console.log('[m10] saved', name, w, h); };
  const closeScreen = () => click('#scrClose');
  const closeDlg = () => ctx.js(`(()=>{const d=document.getElementById('scrDlg');if(d&&d._close)d._close();})()`);
  const roomBtn = (name) => `[data-mcproom][aria-label="MCP extras for ${name}"]`;
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);

    // The office room headers carry an MCP button; nothing overlaps (npm run check:office covers the layout)
    assert.ok(await count('[data-mcproom]') >= 4, 'every room has an MCP extras button');

    await shot('office-mcp-buttons', w, h);

    // Settings: the Copilot CLI list is there with no setup; no add/import; extras explained
    await click('#settingsBtn'); await ctx.sleep(500);
    assert.strictEqual(await count('#ambList li.amb'), 3, 'CLI list + built-in server');
    assert.match(await text('#ambList'), /Copilot CLI list/);
    assert.strictEqual(await count('#mcpAdd, #mcpImpCopilot, #mcpImpVs'), 0, 'no app-level add/import in Settings');
    assert.match(await text('#extH'), /Extras for one folder/);
    assert.match(await text('#screen'), /only per folder or workspace/);
    // the CLI list is the first thing the picture is about: scroll it into view and prove it is inside the window
    await ctx.js(`document.getElementById('ambList').scrollIntoView({block:'center'});document.scrollingElement.scrollTop=0`); await ctx.sleep(300);
    assert.strictEqual(await ctx.js(`(()=>{const r=document.getElementById('ambList').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight&&r.left>=0&&r.right<=window.innerWidth})()`), true, 'the CLI list is inside the window for the picture');
    await shot('settings-cli-list', w, h);
    await closeScreen(); await ctx.sleep(300);

    // Tools: This session (default), then All time
    await click('#toolsBtn'); await ctx.sleep(500);
    assert.strictEqual(await ctx.js(`document.getElementById('perSession').getAttribute('aria-selected')`), 'true');
    assert.match(await text('.cfgsec'), /Configured MCP servers/);
    assert.match(await text('.cfgsec'), /github-mcp-server/);
    await shot('tools-this-session', w, h);
    await click('#perAll'); await ctx.sleep(700);
    assert.strictEqual(await ctx.js(`document.getElementById('perAll').getAttribute('aria-selected')`), 'true');
    assert.match(await text('.scr-sum'), /tool calls by \d+ agents since /);
    assert.match(await text('#screen'), /Zoe · old-prototype/, 'history of agents that are gone is kept');
    assert.match(await text('#screen'), /never arguments/);
    assert.strictEqual(await count('#tabAgents'), 0, 'Models and context is a This session view');
    await shot('tools-all-time', w, h);
    // scope to one agent label
    await ctx.js(`(()=>{const s=document.getElementById('toolScope');const o=[...s.options].find(o=>/^Ada · /.test(o.textContent));s.value=o.value;s.onchange({target:s});})()`); await ctx.sleep(600);
    assert.match(await text('.scr-sum'), /by Ada · mcp-swiss/);
    await shot('tools-all-time-agent', w, h);
    await click('#perSession'); await ctx.sleep(500);
    assert.strictEqual(await ctx.js(`document.getElementById('perSession').getAttribute('aria-selected')`), 'true');
    await closeScreen(); await ctx.sleep(300);

    // Folder extras from a room header: mcp-swiss has extras, blog has none, and they are labelled
    await click(roomBtn('mcp-swiss')); await ctx.sleep(600);
    assert.match(await text('h2'), /MCP extras · mcp-swiss/);
    assert.ok(await count('#srvList li.srv') === 2, 'two extras in mcp-swiss');
    assert.match(await text('#srvList'), /Extra, this folder only/);
    assert.match(await text('#legList'), /old-fetch/, 'old app-level server offered');
    await shot('folder-extras', w, h);
    await click('li.srv[data-name="docs-search"] [data-act="toggle"]'); await ctx.sleep(400);
    assert.match(await text('#scrDlg'), /Trust "docs-search" in mcp-swiss/);
    await shot('folder-trust', w, h);
    await closeDlg(); await ctx.sleep(200);
    await closeScreen(); await ctx.sleep(300);
    await click(roomBtn('blog')); await ctx.sleep(600);
    assert.match(await text('h2'), /MCP extras · blog/);
    assert.strictEqual(await count('#srvList li.srv'), 0, 'extras of mcp-swiss are not in blog');
    assert.match(await text('.scr-empty'), /No extras for this folder/);
    await shot('folder-extras-empty', w, h);
    await closeScreen(); await ctx.sleep(300);

    // Agent MCP menu: CLI list + this folder's extras, labelled
    await click('#stage [data-id="sim-1"]'); await ctx.sleep(700);
    await click('#mcpBtn'); await ctx.sleep(500);
    const dlg = await text('#scrDlg');
    assert.match(dlg, /Copilot CLI list/);
    assert.match(dlg, /this folder only/);
    assert.match(dlg, /playwright/);
    await shot('agent-mcp', w, h);
    await closeDlg(); await ctx.sleep(200);
    await click('#backBtn'); await ctx.sleep(300);
  }
};
