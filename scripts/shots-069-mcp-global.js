/*
 * Spec 069 part 1 (T009): add an MCP server for all folders, written into the agent apps' own lists after a per-file review; the lists in
 * Settings with source chips; Remove; the source chips in an agent's MCP dialog. Simulator only (the fake lists live in the page; nothing
 * is written to disk, no AI credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-069-mcp-global.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed: Copilot, Claude Code and Codex installed):
 * - Settings > MCP: the Copilot rows carry the other apps that have the same name; Claude Code's and Codex's own servers are listed with
 *   their chips; every list entry has Remove…; "+ Add server for all folders…" is there.
 * - The add form from Settings offers only "All my folders", ticks for the three apps (all ticked), Reference by default.
 * - Review: one item per app with its file and the entry; a planted secret value is nowhere in the page; the variables to set are named;
 *   Write: a toast names the files and backups, and the server shows with three chips.
 * - Remove: pick apps, review, remove: the row is gone.
 * - A folder's add form starts on "This folder only" and offers "All my folders".
 * - The agent MCP dialog shows source chips (Copilot, Claude Code, Durbar folder).
 * - One installed app (plain sim): a single choice, Copilot selected.
 * - Text >= 10.5px, dialogs fit the window.
 * Shots: 069-mcp-global-settings-<w>x<h>.png, 069-mcp-global-add-<w>x<h>.png, 069-mcp-global-review-<w>x<h>.png. Prints "[069] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const SECRET = 'planted-SECRET-value-069';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '069' });
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = (sel) => js(`(()=>{let min=99,who='';document.querySelectorAll(${jsLiteral(sel)}).forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const btn = (label) => js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent===${jsLiteral(label)});if(!b)return false;b.click();return true;})()`);
  const openSettings = async () => {
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('ambList')&&document.getElementById('advMcp').open`), 'Settings > MCP is open');
    await settle();
  };
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    await openSettings();
    const gh = await js(`[...document.querySelectorAll('#ambList li[data-amb="github"] .mtag')].map(x=>x.textContent)`);
    assert.deepStrictEqual(gh.slice(0, 2), ['Copilot CLI list', 'Claude Code'], 'github is in the Copilot and Claude Code lists: ' + JSON.stringify(gh));
    assert.ok(await js(`!!document.querySelector('#ambList li[data-amb="github"] [data-act=grm]')`), 'a Copilot list entry has Remove…');
    assert.ok(!(await js(`!!document.querySelector('#ambList li[data-amb="github-mcp-server"] [data-act=grm]')`)), 'the built-in server has no Remove');
    const glob = await js(`[...document.querySelectorAll('#globList li.glob')].map(li=>li.dataset.g+':'+[...li.querySelectorAll('.mtag.src')].map(x=>x.textContent).join('+'))`);
    assert.deepStrictEqual(glob, ['sentry:Claude Code', 'context7:Codex'], 'Claude Code and Codex servers listed with chips: ' + JSON.stringify(glob));
    assert.ok(await js(`!!document.querySelector('#globList li[data-g="sentry"] [data-act=gcl]')`), 'a Claude Code entry has its switch for Durbar sessions');
    await js(`document.getElementById('globAdd').scrollIntoView({block:'center'})`);
    await shot(`069-mcp-global-settings-${w}x${h}.png`);

    // ---- add for all folders, from Settings ----
    await js(`document.getElementById('globAdd').click()`);
    assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`), 'the add form opened');
    assert.strictEqual(await js(`document.querySelectorAll('#scrDlg [name=mScope]').length`), 1, 'from Settings: only "All my folders"');
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg [name=gApp]')].map(x=>x.type+':'+x.value+':'+x.checked)`), ['checkbox:copilot:true', 'checkbox:claude:true', 'checkbox:codex:true'], 'three ticks, all installed ones ticked');
    assert.strictEqual(await js(`document.querySelector('#scrDlg [name=gSec]:checked').value`), 'ref', 'Reference is the default');
    assert.ok(await js(`document.getElementById('mCwd').closest('label').hidden`), 'no working directory for a global server');
    await js(`(()=>{const d=document.getElementById('scrDlg');const set=(id,v)=>{const e=d.querySelector(id);e.value=v;e.dispatchEvent(new Event('input'));};set('#mName','acme-notes');set('#mCmd','npx');set('#mArgs','-y\\n@acme/notes-mcp');d.querySelector('[data-add=env]').click();const r=d.querySelector('#envRows .krow');r.querySelector('.k').value='NOTES_TOKEN';r.querySelector('.v').value=${jsLiteral(SECRET)};})()`);
    assert.strictEqual(await js(`document.querySelector('#scrDlg .dbtn .primary').textContent`), 'Review…');
    assert.ok(await fits(), `${w}: the add form fits`);
    const f1 = await minFont('#scrDlg .dlg, #scrDlg .dlg *');
    assert.ok(f1.min >= 10.5, `${w}: form text >= 10.5px ${JSON.stringify(f1)}`);
    await shot(`069-mcp-global-add-${w}x${h}.png`);
    assert.ok(await btn('Review…'));
    assert.ok(await until(`!!document.querySelector('#scrDlg .gpvl')`), 'the review opened');
    await settle();
    const items = await js(`[...document.querySelectorAll('#scrDlg .gpv')].map(li=>li.querySelector('b').textContent+' '+li.querySelector('code').textContent)`);
    assert.deepStrictEqual(items, ['Copilot CLI ~/.copilot/mcp-config.json', 'Claude Code ~/.claude.json', 'Codex ~/.codex/config.toml'], JSON.stringify(items));
    assert.ok(/\$\{NOTES_TOKEN\}/.test(await js(`document.querySelector('#scrDlg .gpvl').textContent`)), 'the JSON entries name the variable');
    assert.ok(/env_vars = \["NOTES_TOKEN"\]/.test(await js(`document.querySelector('#scrDlg .gpvl').textContent`)), 'the Codex entry uses env_vars');
    assert.ok(/Set NOTES_TOKEN/.test(await js(`document.querySelector('#scrDlg .dbody').textContent`)), 'the variable to set is named');
    assert.ok(!(await js(`document.documentElement.outerHTML.includes(${jsLiteral(SECRET)})`)), 'the secret value is nowhere in the page');
    assert.ok(await fits(), `${w}: the review fits`);
    const f2 = await minFont('#scrDlg .dlg, #scrDlg .dlg *');
    assert.ok(f2.min >= 10.5, `${w}: review text >= 10.5px ${JSON.stringify(f2)}`);
    await shot(`069-mcp-global-review-${w}x${h}.png`);
    assert.ok(await btn('Write to 3 files'));
    assert.ok(await until(`/Written: Copilot CLI/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'the toast names the written files');
    assert.match(await toasts(), /backup mcp-config\.json\.durbar-/);
    assert.ok(await until(`!!document.querySelector('#globList li[data-g="acme-notes"]')`), 'the new server is listed');
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#globList li[data-g="acme-notes"] .mtag.src')].map(x=>x.textContent)`), ['Copilot CLI', 'Claude Code', 'Codex']);
    await H.clearToasts();

    // ---- remove from two apps ----
    await js(`document.querySelector('#globList li[data-g="acme-notes"] [data-act=grm]').click()`);
    assert.ok(await until(`!!document.querySelector('#scrDlg [name=gApp]')`));
    await js(`document.querySelector('#scrDlg [name=gApp][value=codex]').click()`);
    assert.ok(await btn('Review…'));
    assert.ok(await until(`document.querySelectorAll('#scrDlg .gpv').length===2`), 'two files to review');
    assert.ok(await btn('Remove from 2 files'));
    assert.ok(await until(`/Removed from: Copilot CLI/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`));
    assert.ok(await until(`[...document.querySelectorAll('#globList li[data-g="acme-notes"] .mtag.src')].map(x=>x.textContent).join()==='Codex'`), 'left only in Codex');
    await H.clearToasts();

    // ---- a folder's add form ----
    await js(`window.DurbarScreens.folderMcp(${jsLiteral('~/work/mcp-swiss')},'mcp-swiss')`);
    assert.ok(await until(`!!document.getElementById('mcpAdd')`), 'the folder extras screen opened');
    await js(`document.getElementById('mcpAdd').click()`);
    assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`));
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg [name=mScope]')].map(x=>x.value+':'+x.checked)`), ['folder:true', 'global:false'], 'This folder only is the default');
    assert.ok(await js(`document.querySelector('#scrDlg [data-for=global]').hidden`), 'the app choice shows only for global');
    assert.strictEqual(await js(`document.querySelector('#scrDlg .dbtn .primary').textContent`), 'Add server');
    await js(`(()=>{const g=document.querySelector('#scrDlg [name=mScope][value=global]');g.click();})()`);
    assert.strictEqual(await js(`document.querySelector('#scrDlg .dbtn .primary').textContent`), 'Review…');
    assert.ok(await btn('Cancel'));
    await js(`(()=>{const b=document.getElementById('backBtn')||document.querySelector('#screen .scr-close');if(b)b.click();})()`);
    await js(`window.DurbarScreens.close&&window.DurbarScreens.close()`);
  }

  // ---- the agent dialog's chips; one installed app ----
  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true });
  await js(`document.querySelector(${jsLiteral('#stage .desk[data-id="sim-1"]')}).click()`);
  assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`));
  await settle();
  await js(`document.getElementById('mcpBtn').click()`);
  assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`));
  const chips = await js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>li.dataset.n+':'+[...li.querySelectorAll('.mtag.src,.mtag.extra')].map(x=>x.textContent).join('+'))`);
  assert.ok(chips.includes('github:Copilot+Claude Code'), 'agent dialog chips: ' + JSON.stringify(chips));
  assert.ok(chips.includes('github-mcp-server:built-in'), 'built-in chip: ' + JSON.stringify(chips));
  await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`);
  await openSettings();
  await js(`document.getElementById('globAdd').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`));
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg [name=gApp]')].map(x=>x.type+':'+x.value+':'+x.checked)`), ['radio:copilot:true', 'radio:claude:false', 'radio:codex:false'], 'one installed app: a single choice');
  console.log('[069] PASS');
};
