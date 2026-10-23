/*
 * Spec 058 FR-090..FR-096 (issue #603, T143): MCP health. A failed server's row says why in plain words (or "Failed (reason unknown)"),
 * when Agent Durbar saw it, and has Copy diagnostics (masked); the composer's MCP chip shows a dot when a server of the chat failed.
 * Simulator only (no AI credits): the driver reports servers in mixed states for one running chat as `mcp` events, the way an agent
 * app's report reaches the window. In the simulator the reply does not pass through main, so a token planted in an error reaches the
 * page unmasked: Copy diagnostics must still copy no piece of it (the page's shared redact(), FR-093).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-health.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - before any failure the chip has no dot and its name says nothing failed; after the report it has the dot (a shape, inside the chip,
 *   the toolbar not overflowing) and its name and tooltip say "N failed" (N counted from the chat's reply) (FR-094);
 * - every failed row has "Reason: <words>" with the right words: not installed, crashed on start, disconnected later (Running first,
 *   then failed), timed out, refused, refused: needs sign-in, and "Failed (reason unknown)"; a running row has none (FR-090);
 * - each reason line shows "seen at HH:MM", the same as the page's whenText of the reply's time (FR-092);
 * - Copy diagnostics writes the server, state, reason, ISO time, transport, agent app and version and the error, and no piece of the
 *   planted token (FR-093); the same in Settings > MCP servers (the chat's row in the expander);
 * - the needs-sign-in row keeps its sign-in hint first; Copy diagnostics is a small button after Details (FR-095);
 * - text >= 10.5px, the dialog fits the window and its body scrolls (FR-096);
 * - after a report with no failure the dot goes.
 * Shots: 058-mcp-health-<w>x<h>.png (the dialog), 058-mcp-health-chip-<w>x<h>.png (the composer with the dot),
 * 058-mcp-health-settings-<w>x<h>.png (Settings, one server open). Prints "[058] health PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

/* a fake token (a ghp_ shape, 36 characters after the prefix): it must never be copied */
const TOKEN = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
const FAILED = [
  { name: 'playwright', status: 'failed', transport: 'stdio', source: 'user', error: 'spawn playwright ENOENT', errorClass: 'not-found' },
  { name: 'markitdown-mcp', status: 'failed', transport: 'stdio', source: 'user', error: `markitdown-mcp exited with code 1 (argv: markitdown-mcp ${TOKEN})` },
  { name: 'linkcheck', status: 'failed', transport: 'http', source: 'user' },
  { name: 'slowpoke', status: 'failed', transport: 'stdio', source: 'user', errorClass: 'timeout', error: 'MCP error -32001: Request timed out' },
  { name: 'refuser', status: 'failed', transport: 'http', source: 'user', error: 'connect ECONNREFUSED 127.0.0.1:9' },
  { name: 'mystery', status: 'failed', transport: 'stdio', source: 'user', error: 'something odd happened' },
  { name: 'linear', status: 'needs-auth', transport: 'http', source: 'user', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' },
  { name: 'tidy', status: 'connected', transport: 'stdio', source: 'user' },
];
const WANT = {
  playwright: 'Not installed (command not found)', 'markitdown-mcp': 'Crashed on start', linkcheck: 'Disconnected later', slowpoke: 'Timed out',
  refuser: 'Refused the connection', mystery: 'Failed (reason unknown)', linear: 'Refused: needs sign-in',
};
const RUNNING = FAILED.map((x) => ({ name: x.name, status: x.name === 'linkcheck' || x.name === 'tidy' ? 'connected' : 'pending', transport: x.transport, source: 'user' }));

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name, prep) => H.shot(path.join(OUT, name), { prep: prep || 'mouse', tag: '058' });
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const chip = () => js(`(()=>{const b=document.getElementById('mcpBtn');if(!b)return null;const d=b.querySelector('.ct-dot'),r=b.getBoundingClientRect(),dr=d?d.getBoundingClientRect():null,tb=b.closest('.ctoolbar');const t=tb?tb.getBoundingClientRect():null;
    return {label:b.getAttribute('aria-label'),title:b.getAttribute('title'),dot:!!d,dotHidden:d?d.getAttribute('aria-hidden'):null,dotIn:!!dr&&dr.width>=6&&dr.left>=r.left-0.5&&dr.right<=r.right+0.5&&dr.top>=r.top-0.5&&dr.bottom<=r.bottom+0.5,
      bg:d?getComputedStyle(d).backgroundColor:null,inToolbar:!!t&&r.right<=t.right+0.5&&r.left>=t.left-0.5,tbOver:tb?tb.scrollWidth>tb.clientWidth+1:null};})()`);
  const rows = () => js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>({n:li.dataset.n,word:(li.querySelector('.mst-w')||{}).textContent||'',why:(li.querySelector('.srv-why')||{}).textContent||'',
    reason:(li.querySelector('.srv-why')||{dataset:{}}).dataset.reason||'',diag:!!li.querySelector('button[data-diag]'),hint:(li.querySelector('.srv-hint')||{}).textContent||'',
    order:[...li.querySelectorAll('.srv-why,.srv-hint,.srv-btns')].map(e=>e.className),btns:[...li.querySelectorAll('.srv-btns button')].map(b=>b.textContent)}))`);
  const minFont = (sel) => js(`(()=>{let min=99,who='';document.querySelectorAll(${jsLiteral(sel)}).forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const clipboard = () => js(`window.__copied=null;navigator.clipboard.writeText=async t=>{window.__copied=t;};true`);
  const checkDiag = (text, name, where) => {
    assert.ok(typeof text === 'string' && text.length > 0, `${where}: something was copied`);
    for (const want of [`Server: ${name}`, 'State: Failed', `Reason: ${WANT[name]}`, 'Transport: stdio', 'Error (masked): '])
      assert.ok(text.includes(want), `${where}: the diagnostics have "${want}"\n${text}`);
    assert.match(text, /^When \(UTC\): \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/m, `${where}: the UTC time only`);
    assert.ok(!/local/i.test(text), `${where}: no local time (it would give away the time zone)`);
    assert.match(text, /^Agent app: \S.*$/m, `${where}: the agent app line`);
    assert.ok(!/version not known/.test(text), `${where}: the agent app's version is known in the simulator\n${text}`);
    assert.ok(!text.includes(TOKEN) && !text.includes(TOKEN.slice(4, 16)) && !text.includes(TOKEN.slice(-12)), `${where}: no piece of the planted token\n${text}`);
    assert.ok(text.includes('[redacted]'), `${where}: the token was masked, the rest stays readable`);
    assert.ok(!/~\/work|\/home\/|sim-\d/.test(text), `${where}: no folder, path or agent id`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    const sb = 'window.__durbarSimUi.bridge()';
    /* a running Copilot main chat whose servers have not failed (the simulator's own canned failures are on other desks) */
    const cands = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`);
    let id = null;
    for (const c of cands) {
      const r = await js(`${sb}.agentMcp(${jsLiteral(c)})`);
      if (r && r.ok && r.live && !r.servers.some((x) => x.status === 'failed' || x.status === 'needs-auth')) { id = c; break; }
    }
    assert.ok(id, 'a running Copilot chat with no failed server: ' + JSON.stringify(cands));
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened with its MCP chip');
    await emit(id, RUNNING); // linkcheck runs first, so its later failure is "Disconnected later"
    await settle();
    let c = await chip();
    assert.ok(c && !c.dot && !/failed/.test(c.label) && !/failed/.test(c.title), `${w}: no dot and no "failed" before a failure ${JSON.stringify(c)}`);

    // ---- the report with mixed failures; the chip gets its dot ----
    await emit(id, FAILED);
    const reply = await js(`${sb}.agentMcp(${jsLiteral(id)})`);
    const nFailed = reply.servers.filter((x) => x.status === 'failed' || x.status === 'needs-auth').length;
    assert.ok(nFailed >= 7, 'the reply lists the failures: ' + nFailed);
    assert.ok(await until(`!!document.querySelector('#mcpBtn .ct-dot')`), `${w}: the chip shows the dot`);
    c = await chip();
    assert.ok(c.label.includes(`, ${nFailed} failed. Open the list`) && c.title.includes(`${nFailed} failed`), `${w}: the chip's name and tooltip say it ${JSON.stringify(c)}`);
    assert.ok(c.dotHidden === 'true' && c.dotIn && c.inToolbar && c.tbOver === false, `${w}: the dot is a shape inside the chip, the chip fits the toolbar ${JSON.stringify(c)}`);
    assert.ok(/^rgb/.test(c.bg) && c.bg !== 'rgba(0, 0, 0, 0)', `${w}: the dot is filled ${c.bg}`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await shot(`058-mcp-health-chip-${w}x${h}.png`);

    // ---- the dialog: reasons, time, Copy diagnostics ----
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv .srv-why').length>=7`), 'the dialog shows the reasons');
    await settle();
    const rs = await rows();
    for (const [n, want] of Object.entries(WANT)) {
      const r = rs.find((x) => x.n === n);
      assert.ok(r, 'row ' + n);
      const since = reply.servers.find((x) => x.name === n).since;
      assert.ok(typeof since === 'number', `${n}: the reply has its time`);
      const when = await js(`window.DurbarMcpWords.whenText(${jsLiteral(since)})`);
      assert.ok(/^at \d\d:\d\d$/.test(when), 'today: ' + when);
      assert.strictEqual(r.why, `Reason: ${want} · seen ${when}`, `${w}: ${n}`);
      assert.ok(r.diag, `${n}: Copy diagnostics`);
      assert.deepStrictEqual(r.btns.slice(-1), ['Copy diagnostics'], `${n}: Copy diagnostics comes last, after Details`);
    }
    const tidy = rs.find((x) => x.n === 'tidy');
    assert.ok(tidy && tidy.word === 'Running' && !tidy.why && !tidy.diag, 'a running server has no reason and no Copy diagnostics');
    const lin = rs.find((x) => x.n === 'linear');
    assert.match(lin.hint, /needs you to sign in/, 'the needs-sign-in row keeps its sign-in hint');
    assert.ok(lin.order.indexOf('srv-hint') < lin.order.indexOf('srv-btns'), 'the sign-in hint comes before the buttons: ' + JSON.stringify(lin.order));
    assert.strictEqual(await js(`!!document.querySelector('#agMcp img')`), false);
    const mf = await minFont('#scrDlg .dlg, #scrDlg .dlg *');
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px ${JSON.stringify(mf)}`);
    const fit = await js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect(),b=document.querySelector('#scrDlg .dbody');return {fits:d.top>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1,scrolls:b.scrollHeight>b.clientHeight,pageX:document.documentElement.scrollWidth<=innerWidth}})()`);
    assert.ok(fit.fits && fit.pageX, `${w}: the dialog fits ${JSON.stringify(fit)}`);
    if (h <= 800) assert.ok(fit.scrolls, `${w}: the list scrolls inside the dialog`);
    await clipboard();
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-diag="markitdown-mcp"]');b.scrollIntoView({block:'center'});b.focus();b.click();})()`);
    assert.ok(await until(`typeof window.__copied==='string'`), 'Copy diagnostics wrote to the clipboard');
    checkDiag(await js(`window.__copied`), 'markitdown-mcp', `${w} dialog`);
    assert.ok(await until(`/Copied the diagnostics of markitdown-mcp \\(masked\\)/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'the toast says it');
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset.diag==='markitdown-mcp'`), 'focus stays on the button');
    // a reason with no class but the text: playwright copies its own reason
    await clipboard();
    await js(`document.querySelector('#agMcp button[data-diag="playwright"]').click()`);
    assert.ok(await until(`typeof window.__copied==='string'`));
    assert.match(await js(`window.__copied`), /Reason: Not installed \(command not found\)/);
    // fail closed: without the page's redact() nothing is copied
    await clipboard();
    await js(`window.__keepRedact=window.DurbarRedact;window.DurbarRedact=undefined;document.querySelector('#agMcp button[data-diag="playwright"]').click()`);
    assert.ok(await until(`/nothing was copied/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'no redact: a toast says nothing was copied');
    assert.strictEqual(await js(`window.__copied`), null, 'and nothing was copied');
    await js(`window.DurbarRedact=window.__keepRedact;true`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());document.querySelector('#scrDlg .dbody').scrollTop=0;document.activeElement.blur()`);
    await shot(`058-mcp-health-${w}x${h}.png`);

    // ---- Settings > MCP servers: the same reason and Copy diagnostics in the chat's row ----
    await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Settings').click()`);
    assert.ok(await until(`!!document.getElementById('liveList')`), 'Settings opened with the live list');
    await js(`(()=>{const b=[...document.querySelectorAll('#liveList button[data-lv]')].find(x=>x.dataset.lv==='markitdown-mcp');b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#liveList li.lv-chat[data-lvs="markitdown-mcp"] .srv-why')`), 'the expander shows the chat with its reason');
    const lv = await js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs==='markitdown-mcp'&&x.dataset.lvc===${jsLiteral(id)});return c?{why:c.querySelector('.srv-why').textContent,diag:!!c.querySelector('[data-lvdiag]'),label:c.querySelector('[data-lvdiag]').getAttribute('aria-label')}:null})()`);
    assert.ok(lv && lv.diag && /^Reason: Crashed on start · seen at \d\d:\d\d$/.test(lv.why), `${w}: Settings shows the same reason ${JSON.stringify(lv)}`);
    assert.match(lv.label, /^Copy diagnostics of markitdown-mcp for /);
    await clipboard();
    await js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs==='markitdown-mcp'&&x.dataset.lvc===${jsLiteral(id)});const b=c.querySelector('[data-lvdiag]');const sc=document.querySelector('#screen .scr-body');sc.scrollTop+=b.getBoundingClientRect().top-sc.getBoundingClientRect().top-sc.getBoundingClientRect().height/2;b.focus();b.click();})()`);
    assert.ok(await until(`typeof window.__copied==='string'`), 'Copy diagnostics in Settings wrote to the clipboard');
    checkDiag(await js(`window.__copied`), 'markitdown-mcp', `${w} settings`);
    const mf2 = await minFont('#liveBox, #liveBox *');
    assert.ok(mf2.min >= 10.5, `${w}: Settings list text >= 10.5px ${JSON.stringify(mf2)}`);
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth&&document.scrollingElement.scrollTop===0`), `${w}: no page overflow`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());document.activeElement.blur()`);
    await shot(`058-mcp-health-settings-${w}x${h}.png`);
    await js(`document.getElementById('scrClose').click()`);
    await until(`!document.body.classList.contains('screen-open')`);

    // ---- every server running again: the dot goes ----
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    await until(`!!document.getElementById('mcpBtn')`);
    await emit(id, FAILED.map((x) => ({ name: x.name, status: 'connected', transport: x.transport, source: 'user' })));
    assert.ok(await until(`!!document.getElementById('mcpBtn')&&!document.querySelector('#mcpBtn .ct-dot')`), `${w}: the dot goes when nothing failed`);
    c = await chip();
    assert.ok(!/failed/.test(c.label), `${w}: the chip's name no longer says failed ${JSON.stringify(c)}`);
    await closePanel();
  }
  console.log('[058] health PASS');
};
