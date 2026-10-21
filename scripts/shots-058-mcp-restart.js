/*
 * Spec 058 (issue #349), T033/T034/T042/T043/T044: per-server Restart and Restart session with these servers in the per-agent MCP
 * dialog. Simulator only (no AI credits, no real runtime): the simulator plays a canned Restart (Starting, then Running) and a canned
 * Restart session.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-restart.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - Copilot (sim-6, its "my-notes" failed): every running server that is on has Restart with a name ("Restart <server> for <agent>");
 *   a press shows "Restarting…" (disabled), then a toast "Restarted my-notes." and the row is running again; focus stays in the dialog.
 * - Restart session with these servers: a busy agent asks first (Cancel focused, the lines of FR-023); Cancel changes nothing; OK
 *   restarts and says so; the dialog stays open and fits the window; text >= 10.5px.
 * - Codex (simkinds=mixed, sim-5): no per-server Restart, the line says to use Restart session instead.
 * - Claude (simkinds=mixed, sim-6): Restart session says its servers start with the next message.
 * - simauth=expired: Restart session fails for sign-in: the dialog closes and the chat shows the sign-in card (FR-027).
 * Shots: 058-mcp-restart-<w>x<h>.png, 058-mcp-restart-session-confirm-<w>x<h>.png, 058-mcp-restart-codex-<w>x<h>.png.
 * Prints "[058] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the page reached the expected state (wait 1)');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the page reached the expected state (wait 2)');
    await settle();
  };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const rows = () => js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>{const r=li.querySelector('button[data-restart]');return {n:li.dataset.n,status:(li.querySelector('.mst')||{}).textContent,restart:r?r.getAttribute('aria-label'):null,busy:!!li.querySelector('.srv-act button.btn[disabled]')};})`);
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // ---- Copilot: per-server Restart ----
    await H.load({ w, h, ready: 'fit', focus: true });
    await openMcp('sim-6');
    let r = await rows();
    const notes = r.find((x) => x.n === 'my-notes');
    assert.ok(notes && notes.status === 'failed', 'my-notes failed in this simulated session: ' + JSON.stringify(r));
    assert.ok(/^Restart my-notes for .+/.test(notes.restart || ''), 'the failed server has Restart with an accessible name: ' + JSON.stringify(notes));
    assert.ok(r.filter((x) => x.restart).length >= 2, 'every running server that is on has Restart');
    assert.ok(await js(`!!document.getElementById('mcpRestartSess')`), 'Restart session with these servers is offered');
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px (${JSON.stringify(mf)})`);
    await shot(`058-mcp-restart-${w}x${h}.png`);
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-restart="my-notes"]');b.focus();b.click();})()`);
    assert.ok(await until(`[...document.querySelectorAll('#agMcp li.srv')].some(li=>li.dataset.n==='my-notes'&&/Restarting/.test(li.textContent))`), 'the page reached the expected state (wait 3)');
    r = await rows();
    assert.ok(r.find((x) => x.n === 'my-notes').busy, 'while it runs the button reads Restarting… and is disabled');
    assert.strictEqual(r.find((x) => x.n === 'my-notes').status, 'pending', 'the row shows the server starting');
    assert.ok(await until(`/Restarted my-notes\\./.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'the page reached the expected state (wait 4)');
    assert.ok(await until(`[...document.querySelectorAll('#agMcp li.srv')].some(li=>li.dataset.n==='my-notes'&&(li.querySelector('.mst')||{}).textContent==='connected')`), 'the page reached the expected state (wait 5)');
    assert.ok(await js(`document.getElementById('scrDlg').contains(document.activeElement)`), 'focus stays in the dialog after the repaint');

    // ---- Restart session on this agent (asked first only when it is busy, has session grants or remote control) ----
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await js(`document.getElementById('mcpRestartSess').click()`);
    if (await ctx.waitFor(`!!document.getElementById('modeDlg')`, 800)) await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Restart session').click()`);
    assert.ok(await until(`/session restarted with the current MCP servers/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), 'the page reached the expected state (wait 6)');
    assert.match(await toasts(), /session restarted with the current MCP servers/, 'Restart session says it worked');
    assert.ok(await js(`!!document.getElementById('scrDlg')`), 'the dialog stays open after Restart session');
    // the restarted session has no grants left and is idle: a second Restart session asks nothing
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await js(`document.getElementById('mcpRestartSess').click()`);
    await ctx.sleep(300);
    assert.ok(!(await js(`!!document.getElementById('modeDlg')`)), 'an idle agent with no grants and no remote control is not asked');
    assert.ok(await until(`/session restarted with the current MCP servers/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), 'the page reached the expected state (wait 7)');
    assert.match(await toasts(), /session restarted/, 'and it restarts');
    await closeDlg();

    // ---- Restart session, busy agent: asks first (FR-023), Cancel focused, Cancel changes nothing ----
    const busyId = await js(`(()=>{const d=document.querySelector('#stage .desk.is-working:not(.is-away), #stage .desk.is-thinking:not(.is-away), #stage .desk.is-waiting:not(.is-away)');return d?d.dataset.id:null;})()`);
    assert.ok(busyId, 'a busy agent is on the floor');
    await openMcp(busyId);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await js(`document.getElementById('mcpRestartSess').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'the page reached the expected state (wait 8)');
    const c = await js(`(()=>{const d=document.getElementById('modeDlg');return {title:d.querySelector('h3').textContent,lines:[...d.querySelectorAll('#mdL li')].map(l=>l.textContent),focus:document.activeElement&&document.activeElement.textContent};})()`);
    assert.ok(/^Restart .+'s session\?$/.test(c.title), 'confirmation title: ' + c.title);
    assert.ok(c.lines.includes('The conversation is kept and resuming spends no AI credits.') && c.lines.includes('"Approve for this session" grants are cleared.'), 'FR-023 lines: ' + JSON.stringify(c.lines));
    assert.strictEqual(c.focus, 'Cancel', 'Cancel is focused');
    await shot(`058-mcp-restart-session-confirm-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Cancel').click()`);
    assert.ok(await until(`!document.getElementById('modeDlg')`), 'the page reached the expected state (wait 9)');
    await ctx.sleep(300);
    assert.ok(!/session restarted/.test(await toasts()), 'Cancel changes nothing');
    await js(`document.getElementById('mcpRestartSess').click()`);
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'the page reached the expected state (wait 10)');
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Restart session').click()`);
    assert.ok(await until(`/session restarted with the current MCP servers/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), 'the page reached the expected state (wait 11)');
    assert.match(await toasts(), /session restarted with the current MCP servers/, 'confirmed: Restart session says it worked');
    await closeDlg();

    // ---- Codex: no per-server Restart; Claude: servers start with the next message ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    await openMcp('sim-5');
    r = await rows();
    assert.ok(r.every((x) => !x.restart), 'Codex has no per-server Restart: ' + JSON.stringify(r));
    assert.ok(/cannot restart one server; use this instead/.test(await js(`document.querySelector('.mcp-rsess').textContent`)), 'the line says to use Restart session');
    await shot(`058-mcp-restart-codex-${w}x${h}.png`);
    await closeDlg();
    await openMcp('sim-6');
    assert.ok(/The servers start with your next message\./.test(await js(`document.querySelector('.mcp-rsess').textContent`)), 'Claude: the servers start with the next message (Q11)');
    await closeDlg();
    await closePanel();

    // ---- an expired sign-in: Restart session shows the chat's sign-in card (FR-027) ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simauth: 'expired' } });
    await openMcp('sim-6');
    await js(`document.getElementById('mcpRestartSess').click()`);
    if (await ctx.waitFor(`!!document.getElementById('modeDlg')`, 800)) await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Restart session').click()`);
    assert.ok(await until(`!document.getElementById('scrDlg')&&!!document.querySelector('#chat .note.signin')`, 8000), 'the page reached the expected state (wait 12)');
    assert.ok(/sign in again/.test(await js(`document.querySelector('#chat .note.signin .signin-title').textContent`)), 'the sign-in card, not a toast');
    await closePanel();
  }
  console.log('[058] PASS');
};
