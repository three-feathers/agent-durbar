/*
 * Spec 058 (issue #364), T113-T115: the MCP dialog's rows show a word and an icon for every state, a hint for a failed or needs-sign-in
 * server, *Details* with *Copy* for the masked error, and follow `mcp` events while open. Simulator only (no AI credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-words.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - sim-5 (Copilot, "my-notes" asks for a sign-in): "Needs sign-in" with an icon, the hint naming GitHub Copilot, Details shows the text, Copy.
 * - sim-6 (Copilot, "my-notes" failed, ENOENT): "Failed", the not-found hint; a switched-off server reads "Off for this session".
 * - Live refresh: an `mcp` event for the open agent changes the row with no click; the focus stays on the same button.
 * - Every string is escaped (a server name and error with markup stay text); text >= 10.5px; the dialog fits the window.
 * Shots: 058-mcp-words-needs-auth-<w>x<h>.png, 058-mcp-words-failed-<w>x<h>.png. Prints "[058] words PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the dialog lists servers');
    await settle();
  };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const row = (name) => js(`(()=>{const li=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n===${jsLiteral(name)});if(!li)return null;
    const st=li.querySelector('.mst');return {word:(li.querySelector('.mst-w')||{}).textContent||'',icon:!!(st&&st.querySelector('svg.mst-ic')),cls:st?st.className:'',hint:(li.querySelector('.srv-hint')||{}).textContent||'',
      det:li.querySelector('button[data-det]')?li.querySelector('button[data-det]').getAttribute('aria-expanded'):null,err:(li.querySelector('.srv-err')||{}).textContent||null,text:li.textContent};})()`);
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });

    // ---- sim-5: a server that needs a sign-in ----
    await openMcp('sim-5');
    let n = await row('my-notes');
    assert.ok(n, 'my-notes is listed');
    assert.strictEqual(n.word, 'Needs sign-in', JSON.stringify(n));
    assert.ok(n.icon && /needs-auth/.test(n.cls), 'it has an icon and its class');
    assert.match(n.hint, /^This server needs you to sign in\. GitHub Copilot keeps the sign-in; Agent Durbar never sees it\.$/);
    assert.strictEqual(n.det, 'false', 'Details starts closed');
    assert.strictEqual(n.err, null);
    const running = await row('github');
    assert.strictEqual(running.word, 'Running');
    assert.strictEqual(running.hint, '', 'a running server has no hint');
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px (${JSON.stringify(mf)})`);
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-det="my-notes"]');b.focus();b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#agMcp li[data-n="my-notes"] .srv-err')`), 'Details opened');
    n = await row('my-notes');
    assert.match(n.err, /401 Unauthorized/, 'Details shows the masked text');
    assert.strictEqual(n.det, 'true');
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset.det==='my-notes'`), 'focus stays on the Details button over the repaint');
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    // record what Copy writes instead of touching the real clipboard
    await js(`window.__copied=null;navigator.clipboard.writeText=async t=>{window.__copied=t;};true`);
    await js(`document.querySelector('#agMcp button[data-copy="my-notes"]').click()`);
    assert.ok(await until(`/Copied the error text/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'Copy answers with the success toast');
    const copied = await js(`window.__copied`);
    assert.strictEqual(copied, n.err, 'Copy writes exactly the error text shown in Details (the masked one)');
    assert.ok(/401 Unauthorized/.test(copied) && !/my-notes$/.test(copied), 'and it is the error, not the name');
    assert.ok(await fits(), `${w}: the dialog still fits with Details open`);
    await shot(`058-mcp-words-needs-auth-${w}x${h}.png`);

    // ---- live refresh: an event for this agent changes the open dialog; markup in names and errors stays text ----
    await js(`document.querySelector('#agMcp button[data-det="my-notes"]').focus()`);
    await emit('sim-5', [
      { name: 'github', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'n'.repeat(300), status: 'z'.repeat(300), transport: 'stdio', source: 'user' },
      { name: '<b id="x">evil</b>', status: 'brand-new<i>', transport: 'stdio', source: 'user', error: '<img src=x onerror=alert(1)> spawn ENOENT' },
    ]);
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li[data-n="my-notes"]');return !!li&&(li.querySelector('.mst-w')||{}).textContent==='Running'})()`), 'the row followed the event with no click');
    // FR-004 / FR-033: the change is said once through the polite live region (a new server is not announced as a change)
    assert.ok(await until(`document.getElementById('srAnnounce').textContent==='my-notes: Running'`), 'the live region says what changed: ' + (await js(`document.getElementById('srAnnounce').textContent`)));
    // FR-168: tooltips are cut (120) for a long server name and a long unknown state
    const tips = await js(`[...document.querySelectorAll('#agMcp .srv-name, #agMcp .mst.unknown')].map(e=>(e.getAttribute('title')||'').length)`);
    assert.ok(tips.length >= 3 && tips.every((t) => t <= 120), 'tooltips are at most 120 characters: ' + JSON.stringify(tips));
    n = await row('my-notes');
    assert.strictEqual(n.hint, '', 'the hint went with the state');
    assert.ok(await js(`document.activeElement&&document.activeElement.closest&&!!document.activeElement.closest('#scrDlg')`), 'focus stays in the dialog after a live repaint');
    assert.ok(await js(`!document.querySelector('#agMcp #x')&&!document.querySelector('#agMcp img')`), 'markup in a name or error is shown as text, never built');
    const odd = await row('<b id="x">evil</b>');
    assert.ok(odd && /^Unknown state: brand-new<i>$/.test(odd.word), 'an unknown token is named and escaped: ' + JSON.stringify(odd));
    // the hostile row: its Details shows the text literally, nothing is built from it
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-det='+JSON.stringify(${jsLiteral('<b id="x">evil</b>')})+']');b.focus();b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#agMcp .srv-err')`), 'Details of the hostile row opened');
    assert.ok((await js(`(document.querySelector('#agMcp li:last-child .srv-err')||{}).textContent`)).includes('<img'), 'the error shows the literal <img');
    assert.ok(await js(`!document.querySelector('#agMcp img')&&!document.querySelector('#agMcp #x')`), 'no element was built from the error text');
    // focus on the open error box survives a live repaint
    await js(`(()=>{const p=document.querySelector('#agMcp li:last-child pre[data-err]');p.focus();})()`);
    assert.ok(await js(`document.activeElement.matches('pre[data-err]')`), 'the error box has focus');
    await emit('sim-5', [
      { name: 'github', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' },
      { name: '<b id="x">evil</b>', status: 'failed', transport: 'stdio', source: 'user', error: '<img src=x onerror=alert(1)> spawn ENOENT again' },
    ]);
    assert.ok(await until(`/again/.test((document.querySelector('#agMcp pre[data-err]')||{}).textContent||'')`), 'the error box followed the event');
    assert.ok(await js(`document.activeElement.matches('pre[data-err]')`), 'focus stays on the error box after a live repaint');
    // two events inside the 150 ms throttle cause one repaint
    await js(`window.__repaints=0;window.__mo=new MutationObserver(()=>{window.__repaints++;});window.__mo.observe(document.querySelector('#scrDlg .dbody'),{childList:true})`);
    const mk = (st) => [{ name: 'github', status: st, transport: 'stdio', source: 'user' }, { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' }];
    await js(`(()=>{window.__durbarSimEmit({type:'mcp',sessionId:'sim-5',timestamp:Date.now(),servers:${jsLiteral(mk('pending'))}});window.__durbarSimEmit({type:'mcp',sessionId:'sim-5',timestamp:Date.now(),servers:${jsLiteral(mk('failed'))}});})()`);
    assert.ok(await until(`(document.querySelector('#agMcp li[data-n="github"] .mst-w')||{}).textContent==='Failed'`), 'the last of the two events is shown');
    await ctx.sleep(500);
    assert.strictEqual(await js(`window.__repaints`), 1, 'two events inside the throttle repaint once');
    await js(`window.__mo.disconnect()`);
    await closeDlg();

    // ---- sim-6: failed (command not found), and a server switched off ----
    await openMcp('sim-6');
    n = await row('my-notes');
    assert.strictEqual(n.word, 'Failed', JSON.stringify(n));
    assert.match(n.hint, /command was not found/);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    await js(`document.querySelector('#agMcp li[data-n="github"] button.swt').click()`);
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li[data-n="github"]');return !!li&&(li.querySelector('.mst-w')||{}).textContent==='Off for this session'})()`), 'a switched-off server reads "Off for this session"');
    await ctx.sleep(600); // past the 150 ms throttle and the 60 ms announce delay
    assert.strictEqual(await js(`document.getElementById('srAnnounce').textContent`), '', "a user's own switch is not announced");
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await shot(`058-mcp-words-failed-${w}x${h}.png`);
    await js(`document.querySelector('#agMcp li[data-n="github"] button.swt').click()`);
    await closeDlg();
    await closePanel();
  }
  console.log('[058] words PASS');
};
