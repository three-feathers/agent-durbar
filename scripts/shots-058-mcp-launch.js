/*
 * Spec 058 FR-195..FR-203 (2026-11-03, T173): the MCP health strip at launch, and the chat's Sign in, Sign in again and a Restart for
 * every chat where a server failed, in Settings. Simulator only (no AI credits, no real runtime, no network).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-launch.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed, simmcplaunch=1: a Claude Code server whose command main did not find, a Codex list
 * that cannot be read; simmcpauth=1: "my-notes" asks Copilot and Claude Code chats for a sign-in):
 * - the strip shows the file findings and the chats' failed and needs-sign-in servers with a reason and a fix, never an error text, at
 *   most 5 lines; it takes its own room (the office starts below it), text >= 10.5px, no page overflow (FR-199, FR-200, FR-202, FR-203);
 * - a chat's server that runs again leaves the strip; a new failure and a policy-refused tool call join it (FR-199 part 2);
 * - Show on a chat's line opens that chat's MCP dialog; Show on a list's line opens Settings at MCP servers, where the row says the
 *   command was not found (FR-198);
 * - Settings: a needs-sign-in chat row has Sign in, which opens the chat's dialog with that row's sign-in started (Open sign-in page);
 *   Restart where it failed (2) restarts the two chats where the server failed and no other (FR-195, FR-196);
 * - Dismiss hides the strip and a later failure does not bring it back;
 * - simmcpauth=again: Sign in again in Settings opens the chat's dialog with its own confirmation (Cancel signs nothing in);
 * - without simmcplaunch the simulator shows no strip.
 * Shots: 058-mcp-launch-<w>x<h>.png (the strip over the office), 058-mcp-launch-settings-<w>x<h>.png (Settings with Restart where it failed).
 * Prints "[058] launch PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);
  const items = () => js(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].map(x=>({k:x.dataset.mlk,t:x.textContent}))`);
  const stripText = () => js(`document.getElementById('mcpStrip').textContent`);
  const done = () => js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done');if(b)b.click();})()`);
  const press = (n, id, act) => js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs===${jsLiteral(n)}&&x.dataset.lvc===${jsLiteral(id)});const b=c&&c.querySelector(${jsLiteral(`[data-${act}]`)});if(!b)return false;b.focus();b.click();return true})()`);
  const toggle = (n) => js(`(()=>{const b=[...document.querySelectorAll('#liveList button[data-lv]')].find(x=>x.dataset.lv===${jsLiteral(n)});if(!b)return false;b.click();return true})()`);
  const openSettingsMcp = async () => {
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('liveList')&&document.getElementById('advMcp').open`), 'Settings opened at MCP servers');
    await settle();
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simmcplaunch: '1', simmcpauth: '1' } });
    const chats = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent).map(a=>({id:a.id,name:a.name,kind:a.info&&a.info.adapterId}))`);
    const byKind = (k) => chats.filter((c) => c.kind === k);
    const A = byKind('copilot')[0], B = byKind('claude')[0], C = byKind('codex')[0];
    assert.ok(A && B && C, 'Copilot, Claude Code and Codex chats run: ' + JSON.stringify(chats));
    await emit(A.id, [{ name: 'browser', status: 'connected' }, { name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);

    // ---- FR-199/FR-200: the strip, its findings, no error text ----
    assert.ok(await until(`!document.getElementById('mcpStrip').hidden`, 6000), 'the strip shows');
    let it = await items();
    const keys = it.map((x) => x.k);
    assert.ok(keys.includes('list:codex'), 'the unreadable Codex list: ' + JSON.stringify(keys));
    assert.ok(keys.includes('cmd:playwright'), 'the missing command: ' + JSON.stringify(keys));
    assert.ok(keys.some((k) => k === 'chat:' + A.id + '\0my-notes'), 'the chat\'s needs-sign-in server: ' + JSON.stringify(keys));
    assert.ok(it.length <= 5, 'at most 5 lines');
    const pw = it.find((x) => x.k === 'cmd:playwright').t;
    assert.match(pw, /playwright.*Claude Code list.*Not installed \(command not found\)\. Install the command, or put its full path/);
    const mn = it.find((x) => x.k === 'chat:' + A.id + '\0my-notes').t;
    assert.ok(mn.startsWith('my-notes ' + A.name + ' (') && /: Refused: needs sign-in\. Sign in again: Show opens the chat.s MCP list/.test(mn), 'name, chat and app, reason, fix: ' + mn);
    const all = await stripText();
    assert.match(all, /MCP servers need attention/);
    assert.ok(!/401|Unauthorized|ENOENT|could not be read\./.test(all), 'no error text in the strip: ' + all);
    assert.strictEqual(await js(`document.getElementById('mcpStrip').getAttribute('role')`), 'status', 'a status strip, not an alert or a modal');
    assert.ok(!(await js(`document.getElementById('mcpStrip').contains(document.activeElement)`)), 'it took no focus');
    // FR-203: its own room, 10.5px, no page overflow
    const lay = await js(`(()=>{const s=document.getElementById('mcpStrip').getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect();let min=99;document.querySelectorAll('#mcpStrip, #mcpStrip *').forEach(e=>{if(!e.getClientRects().length)return;if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));});return {below:f.top>=s.bottom-1,min,pageX:document.documentElement.scrollWidth<=innerWidth,pageY:document.documentElement.scrollHeight<=innerHeight+1}})()`);
    assert.ok(lay.below && lay.min >= 10.5 && lay.pageX && lay.pageY, `${w}: the strip takes its own room, 10.5px, no page scroll: ` + JSON.stringify(lay));
    await shot(`058-mcp-launch-${w}x${h}.png`);

    // ---- FR-199 part 2: a server that runs again leaves; a new failure and a policy refusal join ----
    await emit(A.id, [{ name: 'browser', status: 'connected' }, { name: 'my-notes', status: 'connected' }]);
    assert.ok(await until(`![...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral('chat:' + A.id + '\0my-notes')})`), 'my-notes left the strip when it ran');
    await emit(A.id, [{ name: 'browser', status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:3000' }, { name: 'my-notes', status: 'connected' }]);
    assert.ok(await until(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral('chat:' + A.id + '\0browser')}&&/Refused the connection\\. Check the server.s address or port/.test(x.textContent))`), 'a refused server joins with the port fix');
    await js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(B.id)},timestamp:Date.now(),callId:'pc1',tool:'teams_send',mcpServer:'agent365-teams',phase:'failed',output:'AADSTS530003: Your device is required to be managed to access this resource.'})`);
    assert.ok(await until(`/Blocked by your organization.s access policy\\. Your organization.s sign-in rules refused it/.test(document.getElementById('mcpStrip').textContent)||/and \\d+ more/.test(document.getElementById('mcpStrip').textContent)`), 'a policy refusal joins (or is counted in "more")');
    assert.ok(!/AADSTS|managed to access/.test(await stripText()), 'the policy line has no vendor text');

    // ---- Show: a chat's line opens its MCP dialog; a list's line opens Settings, where the row says the command was not found ----
    await js(`document.querySelector(${jsLiteral(`#mcpStrip [data-mlshow="chat:${A.id}\u0000browser"]`)}).click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'Show opened the chat MCP dialog');
    assert.ok((await js(`document.getElementById('scrDlgT').textContent`)).endsWith(A.name), 'that chat\'s dialog');
    await done();
    await until(`!document.getElementById('scrDlg')`);
    await js(`document.querySelector('#mcpStrip [data-mlshow="cmd:playwright"]').click()`);
    assert.ok(await until(`!!document.getElementById('liveList')&&document.getElementById('advMcp').open`), 'Show on a list line opened Settings at MCP servers');
    assert.match(await js(`(document.querySelector('#globList li[data-g="playwright"] [data-miss]')||{}).textContent||''`), /^Agent Durbar did not find this command on this computer\. Install the command/, 'the list row says so');
    assert.ok(!(await js(`!!document.querySelector('#globList li[data-g="sentry"] [data-miss]')`)), 'an http server has no such line');

    // ---- FR-196: Restart where it failed (2) restarts exactly the two failed chats ----
    await emit(B.id, [{ name: 'browser', status: 'failed', error: 'spawn browser-mcp ENOENT', errorClass: 'not-found' }, { name: 'my-notes', status: 'connected' }]);
    await emit(C.id, [{ name: 'browser', status: 'failed', error: 'spawn browser-mcp ENOENT', errorClass: 'not-found' }]);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__lvCalls=[];if(!b.__lvWrapped){b.__lvWrapped=true;const r=b.agentMcpRestart;b.agentMcpRestart=(id,n)=>{window.__lvCalls.push([id,n]);return r(id,n);};}})()`);
    assert.ok(await until(`/Restart where it failed \\(2\\)/.test((document.querySelector('#liveList [data-lvall="browser"]')||{}).textContent||'')`), 'Restart where it failed (2): Copilot and Claude Code, not Codex');
    await toggle('browser');
    await settle();
    await shot(`058-mcp-launch-settings-${w}x${h}.png`);
    await js(`document.querySelector('#liveList [data-lvall="browser"]').click()`);
    assert.ok(await until(`window.__lvCalls.length===2&&!document.querySelector('#liveList [data-lvall="browser"][disabled]')`, 8000), 'two restarts, then the button is free');
    assert.deepStrictEqual((await js(`window.__lvCalls`)).map((c) => c[0]).sort(), [A.id, B.id].sort(), 'only the failed chats that can restart one server');

    // ---- FR-195: Sign in from Settings starts the chat's own sign-in ----
    const signRow = await js(`(()=>{const b=document.querySelector('#liveList li.lv-chat [data-lvsign]');return b?b.closest('li.lv-chat').dataset.lvc:null})()`)
      || (await toggle('my-notes'), await until(`!!document.querySelector('#liveList li.lv-chat [data-lvsign]')`), await js(`document.querySelector('#liveList li.lv-chat [data-lvsign]').closest('li.lv-chat').dataset.lvc`));
    assert.ok(signRow, 'a needs-sign-in chat row has Sign in');
    const sr = await js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvc===${jsLiteral(signRow)}&&x.querySelector('[data-lvsign]'));const b=c.querySelector('.lv-act > button');return {first:b&&b.dataset.lvsign!==undefined,primary:b&&b.classList.contains('primary'),open:!!c.querySelector('[data-lvopen]:not(.primary)'),note:(c.querySelector('.lv-auth')||{}).textContent}})()`);
    assert.ok(sr.first && sr.primary && sr.open, 'Sign in leads, Open in chat stays as a secondary button: ' + JSON.stringify(sr));
    assert.match(sr.note, /Sign in opens the chat's MCP list and starts the sign-in there/);
    await press('my-notes', signRow, 'lvsign');
    assert.ok(await until(`!document.body.classList.contains('screen-open')&&!!document.querySelector('#agMcp button[data-signopen="my-notes"]')`, 6000), 'Settings closed; the chat dialog started its own sign-in (Open sign-in page)');
    await done();
    await until(`!document.getElementById('scrDlg')`);

    // ---- Dismiss: gone for this run; a later failure does not bring it back ----
    await js(`document.querySelector('#mcpStrip [data-ml="close"]').click()`);
    assert.ok(await until(`document.getElementById('mcpStrip').hidden`), 'Dismiss hides the strip');
    await emit(A.id, [{ name: 'late', status: 'failed', error: 'x' }]);
    await ctx.sleep(400);
    assert.ok(await js(`document.getElementById('mcpStrip').hidden`), 'nothing new shows after Dismiss');
  }

  // ---- FR-195: Sign in again from Settings opens the chat's own confirmation; Cancel signs nothing in ----
  await H.load({ w: 1280, h: 800, ready: 'fit', focus: true, query: { simmcpauth: 'again' } });
  {
    const id = await js(`window.__durbarSimUi.agents().find(a=>a.live&&!a.parent&&(a.info&&a.info.adapterId||'copilot')==='copilot').id`);
    await emit(id, [{ name: 'team-wiki', status: 'connected' }]);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__sign=[];const o=b.agentMcpSignIn;b.agentMcpSignIn=(...a)=>{window.__sign.push(a);return o(...a);};})()`);
    await openSettingsMcp();
    await toggle('team-wiki');
    assert.ok(await until(`[...document.querySelectorAll('#liveList li.lv-chat')].some(x=>x.dataset.lvs==='team-wiki'&&x.dataset.lvc===${jsLiteral(id)}&&x.querySelector('[data-lvagain]'))`), 'Sign in again is on the row');
    await press('team-wiki', id, 'lvagain');
    assert.ok(await until(`!!document.getElementById('modeDlg')&&/Sign in again to team-wiki\\?/.test(document.getElementById('modeDlg').textContent)`, 6000), 'the chat dialog asks its own question');
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Cancel').click()`);
    await until(`!document.getElementById('modeDlg')`);
    await ctx.sleep(300);
    assert.deepStrictEqual(await js(`window.__sign`), [], 'Cancel: nothing signed in');
    assert.ok(await js(`document.getElementById('mcpStrip').hidden`), 'no strip without simmcplaunch');
    await done();
  }
  console.log('[058] launch PASS');
};
