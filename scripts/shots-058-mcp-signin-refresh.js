/*
 * Spec 058 FR-208, FR-211, FR-213, FR-215, FR-216 (2026-11-03, T186): the automatic MCP sign-in refresh in the window. Simulator only
 * (no AI credits, no real runtime, no network, no token anywhere).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-signin-refresh.js xvfb-run -a npx electron . --no-sandbox
 *
 * With `simsigninrefresh=1` (the planner copy on a simulated monotonic clock) and `simsigninwait=1500` (a shorter wait), at 1440x900 and
 * 1280x800 with 15 agents:
 * - a message after a simulated hour without a reply shows "Reconnecting MCP sign-ins (2 servers)…" under it, as one quiet status line
 *   (role=status, 10.5px or more, inside the chat, the composer and the office not covered, no dialog, the focus stays in the composer);
 *   a server that renews leaves no trace; one that stays expired gets "<name> needs you to sign in again." with Sign in…, which opens
 *   the chat's MCP dialog (no browser, no sign-in started by itself); the local server is never reconnected;
 * - within the hour nothing is reconnected and no line shows; the same server is not tried twice in one gap;
 * - a slow server: at the bound the message goes with "MCP sign-ins are still reconnecting: <name>. Sent anyway; …";
 * - Stop during the wait: the message reads Not sent, its text is back in the composer, no reply comes;
 * - Settings > MCP servers: the switch "Refresh MCP sign-ins automatically" (on) with its line; off, a quiet hour reconnects nothing;
 * - a hostile server name renders as text (checked after the pictures, on a first message);
 * - a Copilot chat whose OS sandbox covers its MCP servers (Read-only, Ask first) is not reconnected: only the sign-in line.
 * - (2026-11-05, FR-218) the one automatic note to the agent shows one calm line, "Sent automatically: <server> was reconnected after a sign-in error, so the agent was asked to retry the step that failed.", naming the server as configured;
 * - (2026-11-05, FR-226/FR-227, #1205) the "Reconnecting <name>\u2026" line only while a check's reconnect runs (picture 058-mcp-reconnecting-<w>x<h>.png), a non-plain name shown as "an MCP server", and the Diagnostics switch (off by default).
 * - (2026-11-05, FR-220) a server renewed in the background reads "Renewed 12:40" on its dialog row (only that row, 10.5px or more), with no chat line (picture 058-mcp-renewed-<w>x<h>.png in OUT, not a documentation picture: the site budget).
 * Shots (DOC_SHOTS): 058-mcp-refresh-waiting-<w>x<h>.png (the waiting line), 058-mcp-refresh-signin-<w>x<h>.png (the sign-in line),
 * 058-mcp-refresh-settings-<w>x<h>.png (the switch and its line). Prints "[058] sign-in refresh PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const HOUR = 60 * 60 * 1000;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${jsLiteral(e)}))`);
  const send = (t) => js(`(()=>{const i=document.getElementById('msgInput');i.focus();i.value=${jsLiteral(t)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  const lines = () => js(`[...document.querySelectorAll('#chat .note.mcpre')].map(n=>n.textContent)`);
  /* FR-215: the line's room: inside the chat, above the composer, 10.5px or more, nothing of the page scrolls sideways */
  const layout = () => js(`(()=>{const ns=[...document.querySelectorAll('#chat .note.mcpre')];const c=document.getElementById('chat').getBoundingClientRect(),cmp=document.getElementById('msgInput').getBoundingClientRect();
    let min=99;for(const n of ns)n.querySelectorAll('*').forEach(e=>{min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));}),min=Math.min(min,parseFloat(getComputedStyle(n).fontSize));
    const vis=ns.filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect());
    return {n:ns.length,min,inChat:vis.every(r=>r.left>=c.left-1&&r.right<=c.right+1),aboveComposer:vis.every(r=>r.bottom<=cmp.top+1||r.top>=c.bottom),roles:ns.every(n=>n.getAttribute('role')==='status'),noDialog:!document.querySelector('[aria-modal="true"]'),pageX:document.documentElement.scrollWidth<=innerWidth}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simsigninrefresh: '1', simsigninwait: '1500' } });
    // a Copilot chat that is not busy (the simulator's own state)
    // a Claude Code chat (its OS sandbox covers shell commands only, so it is reconnected in Read-only too)
    const id = await js(`((window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&(a.info&&a.info.adapterId)==='claude'&&(a.state==='idle'||a.state==='done')&&!(a.info.sandbox&&a.info.sandbox.covers.includes('mcp'))))||{}).id||''`);
    assert.ok(id, 'an idle Claude Code chat');
    const EVIL = 'crm'; // the pictures show a plain name; a hostile one is checked at the end
    const servers = (crm, docs) => [{ name: 'docs', status: docs, transport: 'http' }, { name: EVIL, status: crm, transport: 'http' }, { name: 'files', status: 'connected', transport: 'stdio' }];
    await emit({ type: 'mcp', sessionId: id, servers: servers('connected', 'connected') });
    await js(`window.__durbarSimSignIn.fate('docs','ok');window.__durbarSimSignIn.fate(${jsLiteral(EVIL)},'expired');window.__durbarSimSignIn.fate('files','ok');0`);
    const opened = await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#msgInput');
    assert.ok(opened.ok, 'the chat opened: ' + JSON.stringify(opened.seen));
    // count the reconnects through the bridge's own reply path: the simulator emits an mcp event per reconnect
    await js(`(()=>{window.__mcpEv=[];window.__durbarSimUi.bridge().onEvent(e=>{if(e.type==='mcp'&&e.sessionId===${jsLiteral(id)})window.__mcpEv.push(e.servers.map(s=>s.name+':'+s.status).join(','));});})()`);

    // every send's answer, recorded (the window's own bridge object)
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__sendRes=[];if(!b.__srs){b.__srs=1;const o=b.send;b.send=async(...a)=>{const r=await o(...a);window.__sendRes.push(r);return r;};}})()`);
    // ---- within the hour: nothing ----
    // (review of PR 1080: the mark is set right before the clock moves, with a minute to spare, so a slow machine never crosses the hour)
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    assert.ok(await until(`window.__durbarSimSignIn.lastResponse(${jsLiteral(id)})!==undefined`), 'the turn end set the last-response mark');
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(HOUR - 60000)});0`);
    await send('within the hour');
    assert.ok(await until(`[...document.querySelectorAll('#chat .msg.user')].some(m=>m.textContent.includes('within the hour'))`), 'sent');
    await settle();
    assert.deepStrictEqual(await lines(), [], 'no reconnect, no line within the hour');
    assert.ok(await until(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='thinking'&&window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='working'`, 15000), 'the reply ended');

    // ---- after a quiet hour: the waiting line, then one renews (no trace) and one needs a sign-in ----
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(HOUR)});0`);
    await send('after an hour');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>n.textContent==='Reconnecting MCP sign-ins (2 servers)…')`, 3000), 'the waiting line');
    // the chat scrolls the new line into view above the composer (never under it)
    assert.ok(await until(`(()=>{const n=[...document.querySelectorAll('#chat .note.mcpre')].pop(),c=document.getElementById('msgInput').getBoundingClientRect();return !!n&&n.getBoundingClientRect().bottom<=c.top+1&&n.getBoundingClientRect().top>0})()`, 1500), `${w}: the line is in view above the composer`);
    const lay = await layout();
    assert.ok(lay.min >= 10.5 && lay.inChat && lay.aboveComposer && lay.roles && lay.noDialog && lay.pageX, `${w}: one calm status line: ` + JSON.stringify(lay));
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'msgInput', 'the focus stays in the composer');
    await shot(`058-mcp-refresh-waiting-${w}x${h}.png`);
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-sign')].length===1&&![...document.querySelectorAll('#chat .note.mcpre')].some(n=>/^Reconnecting/.test(n.textContent))`, 5000), 'the waiting line is gone; one sign-in line');
    const sign = await js(`(()=>{const n=document.querySelector('#chat .note.mcpre-sign');return {t:n.textContent,img:n.querySelectorAll('img').length,pwn:window.__pwn===1,btn:(n.querySelector('button')||{}).textContent,role:n.getAttribute('role')}})()`);
    assert.ok(sign.t === EVIL + ' needs you to sign in again.Sign in…' && sign.img === 0 && !sign.pwn && sign.btn === 'Sign in…' && sign.role === 'status', 'the sign-in line, the hostile name as text: ' + JSON.stringify(sign));
    const ev = await js(`window.__mcpEv`);
    assert.ok(ev.length >= 2 && ev.every((x) => x.includes('files:connected')), 'the local server is reported unchanged in every report: ' + JSON.stringify(ev));
    assert.ok(await until(`[...document.querySelectorAll('#chat .msg')].some(m=>!m.classList.contains('user'))||window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='thinking'`, 15000), 'the message went on');
    const layS = await layout();
    assert.ok(layS.min >= 10.5 && layS.inChat && layS.pageX, `${w}: the sign-in line is calm: ` + JSON.stringify(layS));
    await js(`document.querySelector('#chat .note.mcpre-sign').scrollIntoView({block:'center'});0`);
    await shot(`058-mcp-refresh-signin-${w}x${h}.png`);
    // Sign in… opens the chat's MCP dialog; no sign-in starts by itself and no browser opens
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__signCalls=[];if(!b.__srw){b.__srw=1;const o=b.agentMcpSignIn,p=b.openExternal;if(o)b.agentMcpSignIn=(...a)=>{window.__signCalls.push(a);return o(...a);};}})()`);
    await js(`document.querySelector('#chat .note.mcpre-sign .mcpre-btn').click()`);
    assert.ok(await until(`!!document.getElementById('agMcp')`, 6000), 'Sign in… opened the chat MCP dialog');
    assert.deepStrictEqual(await js(`window.__signCalls`), [], 'no sign-in started by itself (the browser opens only from Open sign-in page)');
    await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done');if(b)b.click();})()`);
    assert.ok(await until(`!document.getElementById('scrDlg')`), 'the dialog closed');
    assert.ok(await until(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='thinking'&&window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='working'`, 15000), 'the reply ended');

    // ---- the same gap again: docs was tried, the expired one is blocked: nothing, no line ----
    const before = (await js(`window.__mcpEv`)).length;
    await emit({ type: 'mcp', sessionId: id, servers: servers('needs-auth', 'connected') });
    await send('same gap');
    await settle();
    assert.ok(await until(`[...document.querySelectorAll('#chat .msg.user')].some(m=>m.textContent.includes('same gap'))`), 'sent');
    assert.strictEqual(await js(`[...document.querySelectorAll('#chat .note.mcpre')].filter(n=>/^Reconnecting/.test(n.textContent)).length`), 0, 'no second reconnect in the same gap, none of a blocked server');
    assert.strictEqual((await js(`window.__mcpEv`)).length, before + 1, 'only the report the driver sent');
    assert.ok(await until(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='thinking'&&window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='working'`, 15000), 'the reply ended');

    // ---- a slow server: the late line at the bound, the message goes ----
    await js(`window.__durbarSimSignIn.fate('docs','slow');0`);
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(2 * HOUR)});0`);
    await send('slow one');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>n.textContent==='Reconnecting MCP sign-ins (1 server)…')`, 3000), 'waiting for one server');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>n.textContent==='MCP sign-ins are still reconnecting: docs. Sent anyway; a tool from those servers may wait or fail.')`, 4000), 'the late line at the bound');
    assert.ok(await until(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='thinking'&&window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state!=='working'`, 15000), 'the message went and the reply ended');
    assert.ok(await until(`window.__mcpEv.some(x=>x.startsWith('docs:connected'))`, 6000), 'the slow reconnect ended by itself (not cancelled)');

    // ---- Stop during the wait: Not sent, text back, no reply ----
    await js(`window.__durbarSimSignIn.fate('docs','slow');0`);
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(2 * HOUR)});0`);
    await send('stop me');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>n.textContent==='Reconnecting MCP sign-ins (1 server)…')&&!!document.getElementById('stopBtn')&&!document.getElementById('stopBtn').hidden`, 3000), 'waiting, with Stop');
    await js(`(()=>{window.__work=0;if(!window.__workOn){window.__workOn=1;window.__durbarSimUi.bridge().onEvent(e=>{if(e.type==='status'&&e.status==='working'&&e.sessionId===${jsLiteral(id)})window.__work++;});}})()`);
    await js(`document.getElementById('stopBtn').click()`);
    assert.ok(await until(`(()=>{const m=[...document.querySelectorAll('#chat .msg.user')].pop();return !!m&&m.textContent.includes('stop me')&&!!m.querySelector('.unsent')&&m.querySelector('.unsent').textContent==='Not sent'})()`, 3000), 'Not sent');
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'stop me', 'the text is back in the composer');
    assert.ok(!(await js(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>/^Reconnecting/.test(n.textContent))`)), 'the waiting line is gone');
    // the send itself answered "not sent" (the simulator starts a reply only after a send that went), and no turn started
    assert.ok(await until(`window.__sendRes.some(r=>r&&r.notSent===true)`, 3000), 'the send answered not sent');
    assert.strictEqual(await js(`window.__work`), 0, 'no reply: nothing was sent');
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);

    // ---- FR-220 (2026-11-05): a server Durbar renewed in the background says "Renewed 12:40" on its row, and nothing in the chat ----
    {
      // the one automatic note to the agent (owner, 2026-11-05): one calm line that says what was sent, the server named as configured
      await js(`window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'nudged',name:'Teams (work)'});0`);
      assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-nudge')].some(n=>n.textContent==='Sent automatically: Teams (work) was reconnected after a sign-in error, so the agent was asked to retry the step that failed.')`, 3000), 'the automatic-note line names the server');
      await emit({ type: 'user', sessionId: id, text: 'The MCP server "Teams-work" was reconnected after a sign-in error. Please retry the step that failed.', auto: true });
      assert.ok(await until(`[...document.querySelectorAll('#chat .msg.user.auto')].some(m=>/^Agent Durbar, automatic/.test(m.querySelector('.meta').textContent)&&m.querySelector('.bubble').textContent.startsWith('The MCP server "Teams-work"'))`, 3000), 'the automatic message is drawn as Agent Durbar\'s own, not as the person\'s');
      await js(`window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'nudge-failed',name:'Teams-work'});0`);
      assert.ok(await until(`(()=>{const m=[...document.querySelectorAll('#chat .msg.user.auto')].pop();return !!m&&!!m.querySelector('.unsent')&&[...document.querySelectorAll('#chat .note.mcpre-nudge')].pop().textContent.startsWith('The automatic message was not sent')})()`, 3000), 'a refused automatic message is marked Not sent');
      await js(`(()=>{const m=[...document.querySelectorAll('#chat .msg.user.auto')].pop();if(m)m.scrollIntoView({block:'center'});})()`);
      await shot(`058-mcp-auto-message-${w}x${h}.png`);
      const lay2 = await layout();
      assert.ok(lay2.min >= 10.5 && lay2.inChat && lay2.roles && lay2.pageX, `${w}: the automatic-note line is calm: ` + JSON.stringify(lay2));
      const chatLines = await js(`document.querySelectorAll('#chat .note').length`);
      await js(`window.__durbarSimSignIn.renewed(${jsLiteral(id)},'docs',${jsLiteral(new Date(2026, 10, 5, 12, 40).getTime())});0`);
      await js(`document.getElementById('mcpBtn').click()`);
      assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="docs"] .mst-renew')`, 6000), 'the dialog row shows the renewal note');
      const row = await js(`(()=>{const e=document.querySelector('#agMcp li.srv[data-n="docs"] .mst-renew');const r=e.getBoundingClientRect(),d=document.querySelector('#agMcp').getBoundingClientRect();return {t:e.textContent,fs:parseFloat(getComputedStyle(e).fontSize),inside:r.left>=d.left-1&&r.right<=d.right+1,other:!!document.querySelector('#agMcp li.srv[data-n="crm"] .mst-renew')||!!document.querySelector('#agMcp li.srv[data-n="files"] .mst-renew'),pageX:document.documentElement.scrollWidth<=innerWidth};})()`);
      assert.ok(row.t === '\u00b7 Renewed 12:40' && row.fs >= 10.5 && row.inside && !row.other && row.pageX, `${w}: the quiet "Renewed 12:40" note, only on the renewed server: ` + JSON.stringify(row));
      await shot(`058-mcp-renewed-${w}x${h}.png`);
      await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done');if(b)b.click();})()`);
      assert.ok(await until(`!document.getElementById('scrDlg')`), 'the dialog closed');
      assert.strictEqual(await js(`document.querySelectorAll('#chat .note').length`), chatLines, 'no chat line came with it');
    }

    // ---- FR-226 (2026-11-05, issue #1205): the check before a message is silent; only a reconnect it starts shows "Reconnecting <name>…" ----
    {
      const notes0 = await js(`document.querySelectorAll('#chat .note').length`);
      await js(`window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'reconnecting',name:'Teams-work'});0`);
      assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-rc')].some(n=>n.textContent==='Reconnecting Teams-work\u2026')`, 3000), 'the line names the server being reconnected');
      await js(`window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'reconnecting',name:'Teams (work)'});0`);
      assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-rc')].some(n=>n.textContent==='Reconnecting an MCP server\u2026')`, 3000), 'a name that is not plain text is not shown');
      await js(`(()=>{const n=[...document.querySelectorAll('#chat .note.mcpre-rc')].pop();if(n)n.scrollIntoView({block:'center'});})()`);
      await H.clearToasts();
      await shot(`058-mcp-reconnecting-${w}x${h}.png`);
      const lay3 = await layout();
      assert.ok(lay3.min >= 10.5 && lay3.inChat && lay3.roles && lay3.pageX, `${w}: the Reconnecting line is calm: ` + JSON.stringify(lay3));
      await js(`window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'reconnect-end',name:'Teams-work'});window.__durbarSimSignIn.push({id:${jsLiteral(id)},kind:'reconnect-end',name:'Teams (work)'});0`);
      assert.ok(await until(`!document.querySelector('#chat .note.mcpre-rc')`, 3000), 'the line is gone when the reconnect ends');
      assert.strictEqual(await js(`document.querySelectorAll('#chat .note').length`), notes0, 'nothing else stays in the chat');
    }

    // ---- Settings: the switch and its line; off = nothing runs ----
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`), 'the chat closed');
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('mcpRefreshSw')&&document.getElementById('advMcp').open`), 'Settings at MCP servers, with the switch');
    const st = await js(`(()=>{const s=document.getElementById('mcpRefreshSw'),l=document.getElementById('mcpRefreshLine');l.scrollIntoView({block:'center'});return {on:s.getAttribute('aria-checked'),role:s.getAttribute('role'),label:s.getAttribute('aria-label'),line:l.textContent,fs:Math.min(parseFloat(getComputedStyle(l).fontSize),parseFloat(getComputedStyle(s.closest('.swrow')).fontSize)),pageX:document.documentElement.scrollWidth<=innerWidth}})()`);
    assert.ok(st.on === 'true' && st.role === 'switch' && st.label === 'Refresh MCP sign-ins automatically' && st.fs >= 10.5 && st.pageX, 'the switch is on by default: ' + JSON.stringify(st));
    assert.strictEqual(st.line, 'Agent Durbar asks the agent app to reconnect remote MCP servers on its own before a message after an hour without a reply. This happens in every permission mode. Where the agent app runs its MCP servers in its own OS sandbox (Copilot in Read-only and Ask first), a reconnect did not renew the sign-in, so there Agent Durbar only tells you when a server needs you to sign in again. Only the app\u2019s own sign-in is renewed; Agent Durbar never sees it. A reconnect never starts a local server. In a Copilot chat, when a call to a remote server fails with a sign-in error, it reconnects that server at once and, if that worked, sends the agent one short automatic message asking it to retry the step. That is one extra message and uses AI credits; it is never sent at a spending limit, and your own message is never sent again. Turning this switch off stops both. Codex chats are not reconnected; they renew with their next session. In a Copilot chat it also checks each remote sign-in server in the background beside every message you send (a tool-list request, no AI, never holding the message) and reconnects at once one that answers unauthorized.', 'the Settings line, word for word');
    await settle();
    await H.clearToasts();
    await shot(`058-mcp-refresh-settings-${w}x${h}.png`);
    // FR-227: Diagnostics, off by default, its own switch; main's answer is what is in force
    assert.strictEqual(await js(`(()=>{const d=document.getElementById('diagSw');return d?d.getAttribute('role')+'|'+d.getAttribute('aria-label')+'|'+d.getAttribute('aria-checked'):'missing'})()`), 'switch|Diagnostics|false', `${w}: Diagnostics is off by default`);
    await js(`document.getElementById('diagSw').click()`);
    assert.ok(await until(`document.getElementById('diagSw').getAttribute('aria-checked')==='true'`, 3000), 'Diagnostics turns on');
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().getSettings().then(s=>s.diagnostics)`), true, 'and is stored on');
    await js(`document.getElementById('diagSw').click()`);
    assert.ok(await until(`document.getElementById('diagSw').getAttribute('aria-checked')==='false'`, 3000), 'and off again');
    await js(`document.getElementById('mcpRefreshSw').click()`);
    assert.ok(await until(`document.getElementById('mcpRefreshSw').getAttribute('aria-checked')==='false'&&/^Off:/.test(document.getElementById('mcpRefreshMsg').textContent)`), 'switched off, said so');
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().getSettings().then(s=>s.mcpSignInRefresh)`), false, 'stored off');
    await js(`window.DurbarScreens.close&&window.DurbarScreens.close();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('screen-open')`), 'Settings closed');
    await js(`window.__durbarSimSignIn.fate('docs','ok');0`);
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(2 * HOUR)});0`);
    const evOff = (await js(`window.__mcpEv`)).length;
    // the simulator's own turn end for this direct send (the window never shows Thinking for it): count idle events from here
    await js(`(()=>{window.__idleN=0;if(!window.__idleOn){window.__idleOn=1;window.__durbarSimUi.bridge().onEvent(e=>{if(e.type==='status'&&e.status==='idle'&&e.sessionId===${jsLiteral(id)})window.__idleN++;});}})()`);
    const r = await js(`window.__durbarSimUi.bridge().send(${jsLiteral(id)},'switched off',[])`);
    assert.ok(r && r.ok, 'sent at once');
    assert.strictEqual((await js(`window.__mcpEv`)).length, evOff, 'off: no reconnect after a quiet hour');
    await js(`window.__durbarSimUi.bridge().setMcpSignInRefresh(true)`);

    // ---- a hostile server name renders as text (FR-202's rule for every line) ----
    const BAD = '<img src=x onerror="window.__pwn=1"><b>x</b>';
    await emit({ type: 'mcp', sessionId: id, servers: [{ name: BAD, status: 'needs-auth', transport: 'http' }] });
    await js(`window.__durbarSimSignIn.fate(${jsLiteral(BAD)},'expired');0`);
    assert.ok(await until(`window.__idleN>0`, 15000), 'the reply to that send ended (the simulator said idle)');
    await emit({ type: 'status', sessionId: id, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(2 * HOUR)});0`);
    await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#msgInput');
    await send('hostile');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-sign')].some(n=>n.dataset.n===${jsLiteral(BAD)})`, 5000), 'the hostile line shows');
    const ev2 = await js(`(()=>{const n=[...document.querySelectorAll('#chat .note.mcpre-sign')].find(n=>n.dataset.n===${jsLiteral(BAD)});return {t:n.querySelector('span').textContent,img:n.querySelectorAll('img,b').length,pwn:window.__pwn===1}})()`);
    assert.ok(ev2.t === BAD + ' needs you to sign in again.' && ev2.img === 0 && !ev2.pwn, 'the name renders literally, nothing injected: ' + JSON.stringify(ev2));

    // ---- a Copilot chat whose OS sandbox covers its MCP servers (Read-only): no reconnect, no wait, only the sign-in line (real: 2026-11-03) ----
    const cid = await js(`((window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&(a.info&&a.info.adapterId||'copilot')==='copilot'&&(a.state==='idle'||a.state==='done')&&a.info.sandbox&&a.info.sandbox.state!=='off'&&a.info.sandbox.covers.includes('mcp')))||{}).id||''`);
    assert.ok(cid, 'an idle Copilot chat with its sandbox over MCP');
    await emit({ type: 'mcp', sessionId: cid, servers: [{ name: 'wiki', status: 'needs-auth', transport: 'http' }] });
    await emit({ type: 'status', sessionId: cid, status: 'idle' });
    await js(`window.__durbarSimSignIn.advance(${jsLiteral(2 * HOUR)});0`);
    await js(`(()=>{window.__cpEv=0;window.__durbarSimUi.bridge().onEvent(e=>{if(e.type==='mcp'&&e.sessionId===${jsLiteral(cid)})window.__cpEv++;});})()`);
    const o2 = await H.openSimAgent(`a=>a.id===${jsLiteral(cid)}`, '#msgInput');
    assert.ok(o2.ok, 'the Copilot chat opened');
    await send('sandboxed');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.mcpre-sign')].some(n=>n.dataset.n==='wiki')`, 3000), 'the sign-in line');
    assert.ok(!(await js(`[...document.querySelectorAll('#chat .note.mcpre')].some(n=>/^Reconnecting/.test(n.textContent))`)), 'no waiting line: nothing was reconnected');
    assert.strictEqual(await js(`window.__cpEv`), 0, 'no reconnect report');
  }
  console.log('[058] sign-in refresh PASS');
};
