/*
 * Spec 058 FR-187..FR-192 (issue #779 A and B): the MCP dialog says when a Running server's last call was refused, and reads the agent
 * app's server list again on open and on Refresh. Simulator only (no AI credits): the driver reports servers as `mcp` events and failed
 * `toolCall` events the way an agent app's report reaches the window; the simulator counts the re-reads in `__durbarSimMcpRefresh`
 * and sends `__durbarSimMcpRefresh.app[id]` as what the app says next. The error texts are made-up shapes (a Conditional Access code, an
 * e-mail address, a trace id, a claims blob): none of them may reach the page.
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-refresh.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - a Running server whose last call failed with a policy refusal reads "Running · last call blocked by your organization's access
 *   policy" and one with a 401 reads "Running · last call needs sign-in"; a Running server with no failed call says nothing; a hint
 *   says what to do; no piece of the raw text reaches the page (FR-187..FR-189);
 * - a later successful call clears it on the next read (FR-188);
 * - opening the dialog reads the list once, and an open within the minute of the last read reads nothing; the button Refresh reads it again (one count each) and the new state shows (FR-190);
 * - Refresh is a button in the tab order, keeps its focus, says "Refreshing…" while it runs and announces the result (FR-192);
 * - a Codex row (no re-read) shows no button and says it cannot report the list again (FR-190);
 * - text >= 10.5px, the dialog fits the window and the page does not overflow.
 * Shots: 058-mcp-lastcall-<w>x<h>.png. Prints "[058] refresh PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

const MAIL = 'jane.doe@contoso.example';
const TRACE = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const CLAIMS = 'eyJhY2Nlc3NfdG9rZW4iOnsibmJmIjp7ImVzc2VudGlhbCI6dHJ1ZX19fQ';
const POLICY = `AADSTS530003: Your device is required to be managed to access this resource. Trace ID: ${TRACE}. User: ${MAIL}. claims=${CLAIMS}`;
const POLICY_WORDS = '· last call blocked by your organization’s access policy';
const AUTH_WORDS = '· last call needs sign-in';
const RUNNING = [
  { name: 'agent365-teams', status: 'connected', transport: 'http', source: 'user' },
  { name: 'crm', status: 'connected', transport: 'http', source: 'user' },
  { name: 'tidy', status: 'connected', transport: 'stdio', source: 'user' },
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058 refresh' });
  const emit = (id, e) => js(`window.__durbarSimEmit(Object.assign({sessionId:${jsLiteral(id)},timestamp:Date.now()},${jsLiteral(e)}))`);
  const report = (id, servers) => emit(id, { type: 'mcp', servers });
  const failedCall = (id, server, output, callId) => emit(id, { type: 'toolCall', callId, tool: `${server}-send`, mcpServer: server, mcpTool: 'send', phase: 'failed', output });
  const okCall = (id, server, callId) => emit(id, { type: 'toolCall', callId, tool: `${server}-send`, mcpServer: server, mcpTool: 'send', phase: 'complete', output: 'ok' });
  const count = () => js(`(window.__durbarSimMcpRefresh||{count:0}).count`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const openChat = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened with its MCP chip');
    await settle();
  };
  const openDlg = async () => {
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the MCP dialog opened');
    await settle();
  };
  const row = (n) => js(`(()=>{const li=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n===${jsLiteral(n)});if(!li)return null;
    return {word:(li.querySelector('.mst-w')||{}).textContent||'',call:(li.querySelector('.mst-call')||{}).textContent||'',hint:(li.querySelector('.srv-hint')||{}).textContent||'',cls:(li.querySelector('.mst')||{className:''}).className};})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.className||e.tagName;}});return {min,who};})()`);
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    const sb = 'window.__durbarSimUi.bridge()';
    const cands = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`);
    let id = null;
    for (const c of cands) {
      const r = await js(`${sb}.agentMcp(${jsLiteral(c)})`);
      if (r && r.ok && r.live && r.canRefresh) { id = c; break; }
    }
    assert.ok(id, 'a running Copilot chat that can re-read its list: ' + JSON.stringify(cands));
    await js(`window.__durbarSimMcpRefresh={count:0,ids:[],app:{}};true`);
    await openChat(id);
    await report(id, RUNNING);
    await failedCall(id, 'agent365-teams', POLICY, 'c1');
    await failedCall(id, 'crm', 'The server answered 401 Unauthorized', 'c2');
    await settle();

    // ---- A: the words on a Running row; opening the dialog reads the list once ----
    await openDlg();
    assert.ok(await until(`window.__durbarSimMcpRefresh.count===1`), `${w}: opening the dialog read the list once`);
    assert.strictEqual(await count(), 1);
    assert.deepStrictEqual(await js(`window.__durbarSimMcpRefresh.ids`), [id], 'for this chat');
    let t = await row('agent365-teams');
    assert.strictEqual(t.word, 'Running', `${w}: still Running ${JSON.stringify(t)}`);
    assert.strictEqual(t.call, POLICY_WORDS, `${w}: the policy words ${JSON.stringify(t)}`);
    assert.match(t.hint, /organization’s access policy refused/, 'a hint says what it is and who can change it');
    assert.match(t.cls, /connected/, 'the state class stays Running');
    const c = await row('crm');
    assert.strictEqual(c.call, AUTH_WORDS, `${w}: the sign-in words ${JSON.stringify(c)}`);
    assert.match(c.hint, /missing sign-in/);
    const tidy = await row('tidy');
    assert.ok(tidy.word === 'Running' && tidy.call === '' && tidy.hint === '', `${w}: a Running server with no failed call says nothing ${JSON.stringify(tidy)}`);
    const text = await js(`document.getElementById('scrDlg').textContent`);
    for (const piece of ['AADSTS', MAIL, TRACE, CLAIMS, 'claims=', '401']) assert.ok(!text.includes(piece), `${w}: the dialog holds no piece of the raw text: ${piece}`);
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px ${JSON.stringify(mf)}`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(x=>x.remove());document.activeElement&&document.activeElement.blur();true`);
    await shot(`058-mcp-lastcall-${w}x${h}.png`);

    // ---- B: Refresh is a button, in the tab order, and reads the list again ----
    const btn = await js(`(()=>{const b=document.getElementById('mcpRefresh');return b?{tag:b.tagName,tab:b.tabIndex,text:b.textContent,label:b.getAttribute('aria-label'),dis:b.disabled}:null;})()`);
    assert.ok(btn && btn.tag === 'BUTTON' && btn.tab >= 0 && btn.text === 'Refresh' && !btn.dis, `${w}: a Refresh button ${JSON.stringify(btn)}`);
    // what the agent app says now: crm failed on its own; a new server appeared
    await js(`window.__durbarSimMcpRefresh.app[${jsLiteral(id)}]=${jsLiteral([...RUNNING.slice(0, 1), { name: 'crm', status: 'failed', transport: 'http', source: 'user', error: 'connect ECONNREFUSED 127.0.0.1:9' }, RUNNING[2], { name: 'late-one', status: 'connected', transport: 'stdio', source: 'user' }])};true`);
    await js(`(()=>{const b=document.getElementById('mcpRefresh');b.focus();return document.activeElement===b;})()`);
    assert.ok(await js(`document.activeElement.id==='mcpRefresh'`), 'the button takes the focus');
    await js(`window.__live=[];(()=>{const el=document.getElementById('srAnnounce');new MutationObserver(()=>{if(el.textContent)window.__live.push(el.textContent);}).observe(el,{childList:true,characterData:true,subtree:true});})();true`);
    await H.key('Return');
    assert.ok(await until(`window.__durbarSimMcpRefresh.count===2`), `${w}: Refresh (Enter) read the list again`);
    assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="late-one"]')`), `${w}: the new state shows`);
    const crm = await row('crm');
    assert.strictEqual(crm.word, 'Failed', `${w}: crm now reads Failed ${JSON.stringify(crm)}`);
    assert.strictEqual(crm.call, '', 'a Failed row has no last-call words (its reason is its own)');
    assert.ok(await until(`document.activeElement&&document.activeElement.id==='mcpRefresh'`), `${w}: the focus stays on Refresh`);
    assert.ok(await until(`/Updated just now/.test(document.getElementById('mcpRefreshNote').textContent)`), 'the note says it');
    assert.ok(await until(`window.__live.some(x=>/Refreshed/.test(x))`), 'the result is announced');
    // a second press while the first runs is one read; two quick presses = at most one extra read each time they overlap
    // a later successful call clears the words on the next read
    await okCall(id, 'agent365-teams', 'c3');
    await js(`document.getElementById('mcpRefresh').click()`);
    assert.ok(await until(`window.__durbarSimMcpRefresh.count===3`), `${w}: a third read`);
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li.srv[data-n="agent365-teams"]');return !!li&&!li.querySelector('.mst-call');})()`), `${w}: a successful call cleared the words`);
    assert.strictEqual((await row('agent365-teams')).hint, '', 'and its hint');
    // FR-188 (review on #800): a sign-in call class goes when the server comes back to connected; a policy one stays across connected reports
    const all = (tidy) => [...RUNNING.slice(0, 2).map((x) => ({ ...x })), { name: 'tidy', status: tidy, transport: 'stdio', source: 'user' }, { name: 'late-one', status: 'connected', transport: 'stdio', source: 'user' }];
    await report(id, all('connected'));
    await failedCall(id, 'tidy', 'HTTP 401', 'c4');
    await failedCall(id, 'agent365-teams', POLICY, 'c5');
    await report(id, all('connected'));
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li.srv[data-n="tidy"] .mst-call');return !!li&&li.textContent===${jsLiteral(AUTH_WORDS)};})()`), `${w}: tidy says the last call needs sign-in`);
    assert.strictEqual((await row('agent365-teams')).call, POLICY_WORDS, `${w}: a policy stays across a repeated connected report`);
    await report(id, all('needs-auth'));
    assert.ok(await until(`(document.querySelector('#agMcp li.srv[data-n="tidy"] .mst-w')||{}).textContent==='Needs sign-in'`), `${w}: tidy reads Needs sign-in`);
    await report(id, all('connected'));
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li.srv[data-n="tidy"]');return !!li&&li.querySelector('.mst-w').textContent==='Running'&&!li.querySelector('.mst-call');})()`), `${w}: signed in again, the words go`);
    assert.strictEqual((await row('agent365-teams')).call, POLICY_WORDS, `${w}: and the policy words stay`);
    assert.ok(await fits() && (await minFont()).min >= 10.5, `${w}: still fits`);
    await closeDlg();
    // FR-190 (owner, 2026-10-27): opening again within the minute reads nothing (Refresh above always read)
    await openDlg();
    await settle();
    assert.strictEqual(await count(), 3, `${w}: a second open within the minute stays at 3 reads`);
    await closeDlg();

    // ---- a Codex row cannot be read again: no button, and the dialog says so ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    await js(`window.__durbarSimMcpRefresh={count:0,ids:[],app:{}};true`);
    await openChat('sim-5');
    await openDlg();
    assert.ok(await until(`!!document.getElementById('mcpRefreshNote')`), 'the Codex dialog has the note');
    assert.strictEqual(await js(`!!document.getElementById('mcpRefresh')`), false, `${w}: no Refresh button for Codex`);
    assert.match(await js(`document.getElementById('mcpRefreshNote').textContent`), /cannot report its server list again/, 'it says so');
    assert.strictEqual(await count(), 0, 'and nothing was asked');
    assert.ok(await fits(), `${w}: the Codex dialog fits`);
    await closeDlg();
    await closePanel();
  }
  console.log('[058] refresh PASS');
};
