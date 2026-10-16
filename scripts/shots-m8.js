/*
 * Screenshots for milestone 8 (spec 019): Settings (MCP), trust, import, Tools view, models and context, chat header, per-agent MCP.
 * Simulator only (no AI credits, no Copilot login). Needs Linux with xvfb-run:
 *
 *   npm run build
 *   M8_OUT=/workspace/command-center DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-m8.js xvfb-run -a npx electron . --no-sandbox
 */
const path = require('path');
const OUT = process.env.M8_OUT || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const click = (sel) => ctx.js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
  const shot = async (name, w, h) => { await ctx.sleep(450); await ctx.shot(path.join(OUT, `m8-${name}-${w}x${h}.png`)); console.log('[m8] saved', name, w, h); };
  const closeScreen = () => click('#scrClose');
  const closeDlg = () => ctx.js(`(()=>{const d=document.getElementById('scrDlg');if(d&&d._close)d._close();})()`);
  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    // Settings
    await click('#settingsBtn'); await ctx.sleep(500);
    await shot('settings-mcp', w, h);
    // edit form: first server (secret value stays masked)
    await click('li.srv[data-name="github"] [data-act="edit"]'); await ctx.sleep(400);
    await shot('mcp-form', w, h);
    await closeDlg(); await ctx.sleep(200);
    // trust dialog: switch on the untrusted remote server
    await click('li.srv[data-name="docs-search"] [data-act="toggle"]'); await ctx.sleep(400);
    await shot('mcp-trust', w, h);
    await closeDlg(); await ctx.sleep(200);
    // import preview
    await click('#mcpImpVs'); await ctx.sleep(500);
    await shot('mcp-import', w, h);
    await closeDlg(); await ctx.sleep(200);
    await closeScreen(); await ctx.sleep(300);
    // Tools: all agents, then the models and context tab
    await click('#toolsBtn'); await ctx.sleep(500);
    await shot('tools-usage', w, h);
    await click('#tabAgents'); await ctx.sleep(400);
    await shot('tools-models-context', w, h);
    await closeScreen(); await ctx.sleep(300);
    // chat header of the first agent (context chip, Tools, MCP), then its own Tools view and MCP menu
    await click('#stage [data-id="sim-1"]'); await ctx.sleep(700);
    await shot('chat-header', w, h);
    await click('#mcpBtn'); await ctx.sleep(500);
    await shot('agent-mcp', w, h);
    await closeDlg(); await ctx.sleep(200);
    await click('#toolsHdrBtn'); await ctx.sleep(500);
    await shot('tools-agent', w, h);
    await closeScreen(); await ctx.sleep(200);
    await click('#backBtn'); await ctx.sleep(300);
  }
};
