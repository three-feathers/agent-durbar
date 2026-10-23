/*
 * Spec 058 FR-080..FR-086 (issue #596, T122): Settings > MCP servers shows each server's live state over the running chats, with an
 * expander per server (the chats, each chat's state, hint, Details, Restart, Restart session, Open in chat). Simulator only (no AI
 * credits, no real runtime): the driver reports ~10 servers in mixed states for several running chats as `mcp` events, the same way an
 * agent app's report reaches the window.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-settings.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed: Copilot, Claude Code and Codex chats):
 * - the chat dialog's Settings button opens Settings at MCP servers (FR-084), and the Advanced heading counts what needs attention;
 * - every reported server has a row with the aggregated words ("Failed in 1 chat · Running in 2 chats", "Not started yet") (FR-080, FR-081);
 * - the expander lists the chats with their own state; a failed row has the hint and Details with the text main sent (masked there:
 *   the simulator's text carries no secret; the driver checks the shown text is exactly the reply's), Copy copies exactly it (FR-082, FR-086);
 * - Restart calls the right chat and server (recorded on the simulator's bridge) and a Codex chat shows the "cannot restart one server" line;
 * - Restart session asks for a busy chat (Cancel changes nothing) and calls that chat;
 * - a new `mcp` report repaints the list without losing the focus, and announces the change (FR-083);
 * - Open in chat closes Settings and opens that chat's MCP dialog;
 * - with no running chat the list says so and has no actions;
 * - text >= 10.5px, no horizontal overflow, every control of the list is the top element at its centre when scrolled into view (FR-085).
 * Shots: 058-mcp-settings-<w>x<h>.png (the list, one server open), 058-mcp-settings-chats-<w>x<h>.png (scrolled to the end).
 * Prints "[058] settings PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

/* ~10 servers in mixed states; each chat reports a different mix (a sign-in in one, a failure in another) */
const ERR = 'spawn notes-mcp ENOENT (the folder ~/work/notes has no notes-mcp)';
const mix = (i) => [
  { name: 'issues', status: 'connected' },
  { name: 'browser', status: i === 0 ? 'failed' : 'connected', ...(i === 0 ? { error: ERR, errorClass: 'not-found' } : {}) },
  { name: 'linear', status: i === 1 ? 'needs-auth' : 'connected', ...(i === 1 ? { error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' } : {}) },
  { name: 'sentry', status: i === 2 ? 'pending' : 'connected' },
  { name: 'filesystem', status: 'connected' },
  { name: 'postgres', status: i === 0 ? 'stopped' : 'connected' },
  { name: 'slack', status: 'connected' },
  { name: 'search-index', status: 'not_configured' },
  { name: 'memory', status: 'connected' },
  { name: 'fetch', status: i === 2 ? 'odd-state' : 'connected' },
  { name: 'time', status: 'connected' },
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name, prep) => H.shot(path.join(OUT, name), { prep: prep || 'mouse', tag: '058' });
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);
  const rowsOf = () => js(`[...document.querySelectorAll('#liveList li.srv.lv')].map(li=>({n:li.dataset.lvn,w:(li.querySelector('.srv-top .mst-w')||{}).textContent,cls:(li.querySelector('.srv-top .mst')||{className:''}).className,tg:!!li.querySelector('button[data-lv]')}))`);
  const chatsOf = (n) => js(`(()=>{const li=[...document.querySelectorAll('#liveList li.srv.lv')].find(x=>x.dataset.lvn===${jsLiteral(n)});return li?[...li.querySelectorAll('li.lv-chat')].map(c=>({id:c.dataset.lvc,who:c.querySelector('.lv-who').textContent,w:c.querySelector('.mst-w').textContent,hint:[...c.querySelectorAll('.srv-hint')].map(h=>h.textContent).join(' '),rs:!!c.querySelector('[data-lvrs]'),sess:!!c.querySelector('[data-lvsess]'),open:!!c.querySelector('[data-lvopen]'),det:!!c.querySelector('[data-lvdet]')})):null})()`);
  const press = (n, id, act) => js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs===${jsLiteral(n)}&&x.dataset.lvc===${jsLiteral(id)});const b=c&&c.querySelector(${jsLiteral(`[data-${act}]`)});if(!b)return false;b.focus();b.click();return true})()`);
  const toggle = (n) => js(`(()=>{const b=[...document.querySelectorAll('#liveList button[data-lv]')].find(x=>x.dataset.lv===${jsLiteral(n)});if(!b)return false;b.focus();b.click();return true})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#advMcp summary, #advMcp summary *, #liveH, #liveH *, #liveBox, #liveBox *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  /* FR-085: every control of the list is the top element at its centre once scrolled into view (nothing covers it), no page overflow */
  const unobstructed = () => js(`(()=>{const bad=[];const sc=document.querySelector('#screen .scr-body');const pageX=document.documentElement.scrollWidth<=innerWidth,y0=document.scrollingElement.scrollTop;for(const b of document.querySelectorAll('#liveBox button')){const s0=sc.getBoundingClientRect();sc.scrollTop+=b.getBoundingClientRect().top-s0.top-s0.height/2;const r=b.getBoundingClientRect();if(!r.width)continue;const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!t||!(t===b||b.contains(t)))bad.push((b.getAttribute('aria-label')||b.textContent)+' under '+(t?t.tagName+'.'+t.className:'nothing'));if(r.right>innerWidth+1||r.left<-1)bad.push('outside: '+b.textContent);}sc.scrollTop=0;return {bad,pageX,pageY:y0===0&&document.scrollingElement.scrollTop===0&&sc.scrollHeight>sc.clientHeight&&sc.getBoundingClientRect().bottom<=innerHeight+1,y0};})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    /* the running main chats and their agent apps, as the window knows them */
    const chats = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent).map(a=>({id:a.id,name:a.name,kind:a.info&&a.info.adapterId,state:a.state}))`);
    const byKind = (k) => chats.filter((c) => c.kind === k);
    assert.ok(byKind('copilot').length >= 1 && byKind('claude').length >= 1 && byKind('codex').length >= 1, 'Copilot, Claude Code and Codex chats are running: ' + JSON.stringify(chats));
    const A = byKind('copilot')[0], B = byKind('claude')[0], C = byKind('codex')[0];
    await emit(A.id, mix(0));
    await emit(B.id, mix(1));
    await emit(C.id, mix(2));
    await settle();

    /* the bridge calls, recorded on the simulator's own bridge (the object Settings calls) */
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__lvCalls=[];if(!b.__lvWrapped){b.__lvWrapped=true;const r=b.agentMcpRestart,s=b.agentMcpRestartSession;b.agentMcpRestart=(id,n)=>{window.__lvCalls.push(['restart',id,n]);return r(id,n);};b.agentMcpRestartSession=(id,c)=>{window.__lvCalls.push(['session',id,c]);return s(id,c);};}})()`);

    // ---- FR-084: the chat dialog's Settings button opens Settings at MCP servers ----
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${A.id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened with its MCP chip');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the chat MCP dialog opened');
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Settings').click()`);
    assert.ok(await until(`!!document.getElementById('liveList')`), 'Settings opened with the live list');
    assert.ok(await js(`document.getElementById('advMcp').open`), 'the MCP section is open');
    await settle();

    // ---- FR-080/FR-081: aggregated words ----
    let rows = await rowsOf();
    const row = (n) => rows.find((x) => x.n === n) || assert.fail('no row for ' + n + ': ' + JSON.stringify(rows));
    assert.ok(rows.length >= 11, '10+ servers are listed: ' + rows.length);
    /* the simulator's own chats add their canned my-notes failure and sign-in (FR-040), so count rather than fix the number */
    const att = rows.filter((x) => /\b(failed|needs-auth)\b/.test(x.cls)).map((x) => x.n);
    assert.ok(att.includes('browser') && att.includes('linear'), 'the failed and needs-sign-in servers need attention: ' + JSON.stringify(att));
    assert.deepStrictEqual(rows.slice(0, att.length).map((x) => x.n).sort(), [...att].sort(), 'the rows that need attention come first');
    const attWord = (n) => n + ' need' + (n === 1 ? 's' : '') + ' attention';
    assert.strictEqual(await js(`document.getElementById('advMcpAtt').textContent`), attWord(att.length), 'the Advanced heading counts what needs attention');
    assert.strictEqual(row('browser').w, 'Failed in 1 chat · Running in 2 chats');
    assert.match(row('browser').cls, /\bfailed\b/, 'the row takes the most urgent state');
    assert.strictEqual(row('linear').w, 'Needs sign-in in 1 chat · Running in 2 chats');
    assert.strictEqual(row('sentry').w, 'Starting in 1 chat · Running in 2 chats');
    assert.strictEqual(row('fetch').w, 'Unknown state: odd-state in 1 chat · Running in 2 chats');
    assert.strictEqual(row('search-index').w, 'Not set up for this session in 3 chats');
    assert.strictEqual(row('issues').w, 'Running in 3 chats', 'a server every reporting chat runs');
    assert.strictEqual(row('my-notes').cls.includes('failed') || row('my-notes').cls.includes('needs-auth'), true, 'the simulator\'s own chats are counted too (my-notes, FR-040)');
    assert.ok(rows.every((x) => x.tg === !/^Not started yet$/.test(x.w)), 'a server no chat uses has no expander');

    // ---- FR-082: the expander ----
    await toggle('browser');
    assert.ok(await until(`document.querySelectorAll('#liveList li.lv-chat').length>=3`), 'the chats of browser are listed');
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset.lv==='browser'&&document.activeElement.getAttribute('aria-expanded')==='true'`), 'the toggle keeps the focus and says it is open');
    let pc = await chatsOf('browser');
    const pa = pc.find((x) => x.id === A.id), pb = pc.find((x) => x.id === B.id), pcx = pc.find((x) => x.id === C.id);
    assert.ok(pa && pb && pcx, 'each chat is listed: ' + JSON.stringify(pc));
    assert.strictEqual(pa.w, 'Failed');
    assert.match(pa.hint, /command was not found/, 'the chat dialog\'s hint (FR-006)');
    assert.ok(pa.det && pa.rs && pa.sess && pa.open, 'the failed Copilot chat has Details, Restart, Restart session and Open in chat: ' + JSON.stringify(pa));
    assert.ok(!pcx.rs && /cannot restart one server; use Restart session with these servers/.test(pcx.hint), 'Codex: no per-server Restart, the FR-032 line: ' + JSON.stringify(pcx));
    assert.ok(pb.rs, 'Claude Code chats can restart one server');
    // Details: exactly the text the reply carries (main masked it), Copy copies exactly that
    await press('browser', A.id, 'lvdet');
    assert.ok(await until(`!!document.querySelector('#liveList pre[data-lverr]')`), 'Details opens');
    const replyErr = await js(`window.__durbarSimUi.bridge().agentMcp(${jsLiteral(A.id)}).then(r=>(r.servers.find(x=>x.name==='browser')||{}).error)`);
    assert.strictEqual(await js(`document.querySelector('#liveList pre[data-lverr]').textContent`), replyErr, 'Details shows the reply\'s own (masked) text');
    await js(`(()=>{window.__copied=null;try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t;}}});}catch(e){}})()`);
    await press('browser', A.id, 'lvcopy');
    assert.ok(await until(`window.__copied!==null`), 'Copy wrote to the clipboard');
    assert.strictEqual(await js(`window.__copied`), replyErr, 'Copy copies exactly the masked text');
    await shot(`058-mcp-settings-${w}x${h}.png`);

    // ---- Restart: the right chat and server ----
    await H.clearToasts();
    await press('browser', A.id, 'lvrs');
    assert.ok(await until(`/Restarted browser\\./.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 6000), 'Restart says it worked');
    assert.deepStrictEqual(await js(`window.__lvCalls.filter(c=>c[0]==='restart')`), [['restart', A.id, 'browser']], 'Restart called that chat for that server only');
    assert.ok(await until(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs==='browser'&&x.dataset.lvc===${jsLiteral(A.id)});return c&&c.querySelector('.mst-w').textContent==='Running'})()`), 'the restarted chat shows Running');
    assert.ok(await js(`document.getElementById('liveBox').contains(document.activeElement)`), 'the focus stays in the list after the repaint');

    // ---- FR-083: a new report repaints in place, keeps the focus, announces ----
    await toggle('linear');
    assert.ok(await until(`[...document.querySelectorAll('#liveList li.lv-chat')].some(x=>x.dataset.lvs==='linear')`), 'linear opened');
    await js(`document.querySelector('#liveList button[data-lv="linear"]').focus()`);
    await js(`(()=>{const l=document.getElementById('srLive')||document.querySelector('[aria-live=polite]');window.__ann=l;})()`);
    await emit(B.id, mix(1).map((s) => (s.name === 'linear' ? { name: 'linear', status: 'connected' } : s)));
    assert.ok(await until(`(document.querySelector('#liveList li.srv.lv[data-lvn="linear"] .srv-top .mst-w')||{}).textContent==='Running in 3 chats'`), 'the row follows the new report');
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset.lv==='linear'`), 'the focus stayed on the same toggle');
    assert.ok(await until(`[...document.querySelectorAll('[aria-live]')].some(x=>/linear: Running in 3 chats/.test(x.textContent))`), 'the change is announced');
    assert.strictEqual(await js(`document.getElementById('advMcpAtt').textContent`), attWord(att.length - 2), 'the count follows (browser restarted, linear signed in)');

    // ---- Restart session: a busy chat asks first; Cancel changes nothing; OK calls that chat ----
    const busy = chats.find((c) => c.state === 'working' || c.state === 'thinking' || c.state === 'waiting');
    assert.ok(busy, 'a busy chat is running');
    await toggle('my-notes');
    assert.ok(await until(`[...document.querySelectorAll('#liveList li.lv-chat')].some(x=>x.dataset.lvs==='my-notes'&&x.dataset.lvc===${jsLiteral(busy.id)})`), 'my-notes lists the busy chat');
    await js(`window.__lvCalls.length=0`);
    await press('my-notes', busy.id, 'lvsess');
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'a busy chat is asked first');
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.textContent`), 'Cancel', 'Cancel is focused');
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Cancel').click()`);
    assert.ok(await until(`!document.getElementById('modeDlg')`), 'Cancel closes the question');
    await ctx.sleep(200);
    assert.deepStrictEqual(await js(`window.__lvCalls`), [], 'Cancel calls nothing');
    await press('my-notes', busy.id, 'lvsess');
    assert.ok(await until(`!!document.getElementById('modeDlg')`), 'asked again');
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Restart session').click()`);
    assert.ok(await until(`/session restarted with the current MCP servers/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), 'Restart session says it worked');
    assert.deepStrictEqual(await js(`window.__lvCalls`), [['session', busy.id, true]], 'Restart session called that chat, confirmed');

    // ---- FR-085: fits, 10.5px, nothing covered ----
    for (const n of ['sentry', 'fetch']) await toggle(n);
    await settle();
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: text >= 10.5px (${JSON.stringify(mf)})`);
    const u = await unobstructed();
    assert.deepStrictEqual(u.bad, [], `${w}: every control of the list is visible and on top`);
    assert.ok(u.pageX && u.pageY, `${w}: the page never scrolls, Settings scrolls itself and ends inside the window ` + JSON.stringify(u));
    await js(`(()=>{const sc=document.querySelector('#screen .scr-body');const l=document.querySelector('#liveList li.srv.lv:last-child');sc.scrollTop+=l.getBoundingClientRect().bottom-sc.getBoundingClientRect().bottom+40;})()`);
    await shot(`058-mcp-settings-chats-${w}x${h}.png`);

    // ---- Open in chat ----
    await press('linear', B.id, 'lvopen');
    assert.ok(await until(`!document.body.classList.contains('screen-open')&&document.querySelectorAll('#agMcp li.srv').length>0`), 'Settings closed and the chat MCP dialog opened');
    assert.ok(await js(`/MCP servers for /.test(document.getElementById('scrDlgT').textContent)&&document.getElementById('scrDlgT').textContent.endsWith(${jsLiteral(B.name)})`), 'it is that chat\'s dialog');
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done').click()`);
    await until(`!document.getElementById('scrDlg')`);
  }

  // ---- no running chat: says so, no actions ----
  await H.load({ w: 1280, h: 800, ready: 'fit', focus: true });
  await js(`window.__durbarSimUi.agents().forEach(a=>{a.live=false;})`);
  await js(`document.getElementById('settingsBtn').click()`);
  assert.ok(await until(`!!document.getElementById('advMcp')`), 'Settings opened');
  await js(`(()=>{const d=document.getElementById('advMcp');d.open=true;})()`);
  assert.ok(await until(`!!document.getElementById('liveNone')`), 'the live list says no chat is running');
  assert.match(await js(`document.getElementById('liveNone').textContent`), /^No chat is running, so no MCP server is running\./);
  assert.strictEqual(await js(`document.querySelectorAll('#liveBox button').length`), 0, 'no actions');
  assert.ok(await js(`document.getElementById('advMcpAtt').hidden`), 'nothing needs attention');
  void toasts;
  console.log('[058] settings PASS');
};
