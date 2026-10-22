/*
 * Spec 069 part 3 (T033): an agent's MCP dialog: expand a server row to see its tools (lazy, loading/empty/failed/not-running states),
 * Remove… on servers of an agent app's list or this folder, source chips, on top of spec 058's row (state word, hint, Details / Copy).
 * Simulator only (canned tools; no AI credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-069-mcp-tools.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - sim-1 (running): every row's name is a button with aria-expanded; github opens "5 tools" with names and one-line descriptions; the
 *   focus stays on the toggle; a second press closes it; docs-search style empty server says "This server lists no tools" (when present).
 * - sim-6: my-notes failed: its tools say "Could not list the tools: ..." (masked text from the sim).
 * - The switch keeps spec 058's verb with this session's scope: "Switch off <server> for <agent> in this session" / "Switch on ..."; with no
 *   running session "... when its session starts" (review on #499).
 * - Remove on a server that is in an agent app's list and the folder's extras lists both places, ticked, and removes both.
 * - sim-6's failed my-notes keeps spec 058's state word and Details next to the tools toggle (one row, no second repaint path).
 * - Remove… is on github (in the Copilot and Claude Code lists) and opens the remove choice; built-in github-mcp-server has none.
 * - An idle agent with no running session: "Start the session to see its tools."
 * - Text >= 10.5px, the dialog fits. Shots: 069-mcp-tools-<w>x<h>.png. Prints "[069t] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '069t' });
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done'||x.textContent==='Cancel');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the MCP dialog lists servers');
    await settle();
  };
  const toolsText = (n) => js(`(document.querySelector(${jsLiteral(`#agMcp li[data-n="${n}"] .mcp-tools`)})||{}).textContent||''`);
  const press = (n) => js(`(()=>{const b=document.querySelector(${jsLiteral(`#agMcp button[data-tools="${n}"]`)});b.focus();b.click();})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    await openMcp('sim-1');
    const toggles = await js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>{const b=li.querySelector('button[data-tools]');return b?b.getAttribute('aria-expanded'):'none'})`);
    assert.ok(toggles.every((x) => x === 'false'), 'every row has a closed tools toggle: ' + JSON.stringify(toggles));
    const sw = await js(`document.querySelector('#agMcp li[data-n="github"] button.swt').getAttribute('aria-label')`);
    assert.match(sw, /^Switch (off|on) github for .+ in this session$/);
    assert.ok(await js(`!!document.querySelector('#agMcp li[data-n="github"] [data-mrm]')`), 'Remove… on a server of an agent app list');
    assert.ok(!(await js(`!!document.querySelector('#agMcp li[data-n="github-mcp-server"] [data-mrm]')`)), 'no Remove on the built-in server');
    await press('github');
    assert.ok(await until(`/5 tools/.test((document.querySelector('#agMcp li[data-n="github"] .mcp-tools')||{}).textContent||'')`), 'github lists its tools');
    assert.match(await toolsText('github'), /search_issues\s*Search issues and pull requests/);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.dataset.tools`), 'github', 'the focus stays on the toggle');
    assert.strictEqual(await js(`document.querySelector('#agMcp button[data-tools="github"]').getAttribute('aria-expanded')`), 'true');
    assert.ok(await fits(), `${w}: the dialog fits`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: text >= 10.5px ${JSON.stringify(mf)}`);
    await shot(`069-mcp-tools-${w}x${h}.png`);
    // ---- part 4: single tools off, tri-state, kept per folder ----
    assert.strictEqual(await js(`document.querySelector('#agMcp li[data-n="github"] [data-tall]').getAttribute('aria-checked')`), 'true', 'all tools on at first');
    assert.match(await toolsText('github'), /applies to new sessions and after Restart session/);
    await js(`document.querySelector('#agMcp input[data-tool="create_issue"]').click()`);
    assert.ok(await until(`document.querySelector('#agMcp li[data-n="github"] [data-tall]').getAttribute('aria-checked')==='mixed'`), 'some tools on: mixed');
    assert.strictEqual(await js(`document.querySelector('#agMcp input[data-tool="create_issue"]').checked`), false);
    assert.match(await toolsText('github'), /5 tools, 1 off/);
    await shot(`069-mcp-tool-toggles-${w}x${h}.png`);
    await closeDlg();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`));
    await press('github');
    assert.ok(await until(`!!document.querySelector('#agMcp input[data-tool="create_issue"]')`));
    assert.strictEqual(await js(`document.querySelector('#agMcp input[data-tool="create_issue"]').checked`), false, 'kept when the dialog opens again');
    await js(`document.querySelector('#agMcp [data-tall="github"]').click()`);
    assert.ok(await until(`document.querySelector('#agMcp [data-tall="github"]').getAttribute('aria-checked')==='true'`), 'mixed -> all on');
    await js(`document.querySelector('#agMcp [data-tall="github"]').click()`);
    assert.ok(await until(`document.querySelector('#agMcp [data-tall="github"]').getAttribute('aria-checked')==='false'`), 'all on -> all off');
    assert.strictEqual(await js(`document.querySelectorAll('#agMcp li[data-n="github"] input[data-tool]:checked').length`), 0);
    await js(`document.querySelector('#agMcp [data-tall="github"]').click()`);
    assert.ok(await until(`document.querySelector('#agMcp [data-tall="github"]').getAttribute('aria-checked')==='true'`), 'all on again');
    await press('github');
    assert.ok(await until(`!document.querySelector('#agMcp li[data-n="github"] .mcp-tools')`), 'a second press closes it');
    // remove: opens the per-app choice (then cancelled)
    await js(`document.querySelector('#agMcp li[data-n="github"] [data-mrm]').click()`);
    assert.ok(await until(`/Remove "github" from/.test((document.querySelector('#scrDlg h3')||{}).textContent||'')`), 'Remove… asks which lists');
    await closeDlg();
    await closePanel();

    // ---- a failed server ----
    await openMcp('sim-6');
    assert.match(await js(`document.querySelector('#agMcp li[data-n="my-notes"] .mst-w').textContent`), /Failed/, 'spec 058 state word on the row');
    assert.ok(await js(`!!document.querySelector('#agMcp li[data-n="my-notes"] button[data-det]')`), 'spec 058 Details beside the tools toggle');
    await press('my-notes');
    assert.ok(await until(`/Could not list the tools/.test((document.querySelector('#agMcp li[data-n="my-notes"] .mcp-tools')||{}).textContent||'')`), 'a failed server says why');
    await closeDlg();

    // ---- an agent without a running session ----
    const idle = await js(`(()=>{const d=document.querySelector('#stage .desk.is-idle');return d?d.dataset.id:null})()`);
    if (idle) {
      await openMcp(idle);
      if (/no running session/.test(await js(`document.querySelector('#scrDlg .dbody').textContent`))) {
        // review on #499: no session, so the switch does not say "in this session"
        const isw = await js(`(document.querySelector('#agMcp button.swt:not([disabled])')||{getAttribute:()=>''}).getAttribute('aria-label')`);
        if (isw) assert.match(isw, /when its session starts$/, isw);
        const first = await js(`document.querySelector('#agMcp button[data-tools]').dataset.tools`);
        await press(first);
        assert.ok(await until(`/Start the session to see its tools/.test((document.querySelector('#agMcp .mcp-tools')||{}).textContent||'')`), 'not running: nothing asked');
      }
      await closeDlg();
    }
  }
  // review on #499: a server that is in an agent app's list AND this folder's extras: Remove offers both places, ticked, and removes both
  const ada = await js(`(()=>{const a=__durbarSimUi.agents().find(x=>!x.parent&&/mcp-swiss$/.test(x.room||''));return a?a.id:null})()`);
  assert.ok(ada, 'an agent in mcp-swiss');
  assert.ok(await js(`(async()=>{const b=__durbarSimUi.bridge();const p=await b.mcpGlobalPreview({name:'playwright',transport:'stdio',command:'npx',args:['@playwright/mcp@latest'],env:[],headers:[]},['codex'],'ref');const r=await b.mcpGlobalApply(p.token,[]);return !!(r&&r.ok)})()`), 'playwright added to the Codex list too');
  await openMcp(ada);
  assert.match(await js(`document.querySelector('#agMcp li[data-n="playwright"] .srv-top').textContent`), /Codex.*Durbar folder|Durbar folder.*Codex/s);
  await js(`document.querySelector('#agMcp li[data-n="playwright"] [data-mrm]').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg [name=gFolder]')`), 'the picker lists the folder copy');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg .gapps input')].map(x=>(x.value==='on'?'folder':x.value)+':'+x.checked)`), ['codex:true', 'folder:true'], 'every place, all ticked');
  await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Review…').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg .gpvl')`), 'the Codex file is reviewed');
  await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>/^Remove from/.test(x.textContent)).click()`);
  // both copies gone: the row is gone, or (the running session still has it until it ends) shows neither source
  assert.ok(await until(`(()=>{if(!document.querySelector('#agMcp'))return false;const li=document.querySelector('#agMcp li[data-n="playwright"]');return !li||!/Codex|Durbar folder/.test(li.querySelector('.srv-top').textContent)})()`, 4000),
    'both copies gone: ' + (await js(`(document.querySelector('#agMcp li[data-n="playwright"] .srv-top')||{}).textContent||'(no row)'`)));
  await closeDlg();
  console.log('[069t] PASS');
};
