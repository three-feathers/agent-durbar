/*
 * Spec 058 (issue #364), T102/T104: the MCP Sign in in the per-agent MCP dialog, Copilot first. Simulator only (no AI credits, no real
 * runtime, no browser, no real OAuth): `simmcpauth=1` gives the Copilot agents a "my-notes" server that needs a sign-in; Sign in shows the
 * host, Open sign-in page opens nothing (a toast) and the row reads Running after 2 s. `simmcpauth=manual` shows the terminal steps instead.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-signin.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - the needs-sign-in row: hint, Sign in, Switch off for this session, How to sign in from a terminal; other rows have none of it;
 * - the steps (copilot, /mcp auth <name>) with Copy; Sign in -> "Sign-in page on auth.example.com" (no address anywhere), focus on
 *   Open sign-in page; Open -> toast, waiting text with the keychain sentence; then Running and a toast; the live region says so;
 * - Cancel returns to Sign in with focus on it; Switch off for this session goes through the existing switch;
 * - simmcpauth=manual: no Sign in, the steps are open; Claude and Codex rows (simkinds=mixed) keep today's behaviour;
 * - the dialog fits the window and its text is at least 10.5px.
 * Shots: 058-mcp-signin-row-, -steps-, -confirm-, -waiting-, -manual-<w>x<h>.png. Prints "[058 signin] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058 signin' });
  const toasts = () => js(`[...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' | ')`);
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'chat opened');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the MCP dialog opened');
    await settle();
  };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const row = (n) => `[...document.querySelectorAll('#agMcp li.srv')].find(li=>li.dataset.n===${jsLiteral(n)})`;
  const info = (n) => js(`(()=>{const li=${row(n)};if(!li)return null;const b=[...li.querySelectorAll('button')].map(x=>x.textContent);return {status:(li.querySelector('.mst')||{}).textContent,buttons:b,sign:!!li.querySelector('.srv-sign'),text:li.textContent,focus:document.activeElement&&document.activeElement.textContent,focusIn:!!(document.activeElement&&li.contains(document.activeElement))};})()`);
  const click = (n, label) => js(`(()=>{const li=${row(n)};const b=[...li.querySelectorAll('button')].find(x=>x.textContent===${jsLiteral(label)});if(!b)throw new Error('no button '+${jsLiteral(label)});b.click();})()`);
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const dlgText = () => js(`document.getElementById('scrDlg').textContent`);
  const check = async (w, what) => {
    assert.ok(await fits(), `${w}: the dialog fits the window (${what})`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px (${what}) ${JSON.stringify(mf)}`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: '1' } });
    await openMcp('sim-6');

    // the polite live region (#srAnnounce): every text it gets is recorded
    await js(`(()=>{window.__live=[];const el=document.getElementById('srAnnounce');new MutationObserver(()=>{if(el.textContent)window.__live.push(el.textContent);}).observe(el,{childList:true,characterData:true,subtree:true});})()`);

    // ---- the row ----
    let n = await info('my-notes');
    assert.strictEqual(n.status, 'Needs sign-in', 'my-notes needs a sign-in: ' + JSON.stringify(n));
    assert.ok(/This server needs you to sign in\. GitHub Copilot keeps the sign-in; Agent Durbar never sees it\./.test(n.text), 'the hint: ' + n.text);
    assert.deepStrictEqual(n.buttons.filter((b) => ['Sign in', 'Switch off for this session', 'How to sign in from a terminal'].includes(b)), ['Sign in', 'Switch off for this session', 'How to sign in from a terminal']);
    const other = await info('github');
    assert.ok(other && !other.sign && other.status === 'Running', 'a running server has no sign-in block: ' + JSON.stringify(other));
    assert.ok(await js(`!!document.querySelector('#agMcp button[data-signin="my-notes"][aria-label="Sign in to my-notes"]')`), 'Sign in has an accessible name');
    await check(w, 'row');
    await shot(`058-mcp-signin-row-${w}x${h}.png`);

    // ---- the terminal steps ----
    await click('my-notes', 'How to sign in from a terminal');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('.srv-steps')`), 'steps opened');
    const steps = await js(`${row('my-notes')}.querySelector('.srv-steps').textContent`);
    assert.ok(/copilot/.test(steps) && /\/mcp auth my-notes/.test(steps) && /Restart session with these servers/.test(steps), 'Copilot manual route: ' + steps);
    assert.deepStrictEqual(await js(`[...${row('my-notes')}.querySelectorAll('.srv-steps code')].map(c=>c.textContent)`), ['copilot', '/mcp auth my-notes']);
    assert.ok(await js(`!!${row('my-notes')}.querySelector('button[data-copysteps]')`), 'Copy is offered');
    await check(w, 'steps');
    await shot(`058-mcp-signin-steps-${w}x${h}.png`);
    await click('my-notes', 'How to sign in from a terminal');
    assert.ok(await until(`!${row('my-notes')}.querySelector('.srv-steps')`), 'steps closed again');

    // ---- Sign in: the host, never the address; focus moves to Open sign-in page ----
    await click('my-notes', 'Sign in');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('button[data-signopen]')`), 'Open sign-in page shows');
    n = await info('my-notes');
    assert.ok(/Sign-in page on auth\.example\.com/.test(n.text), 'the host: ' + n.text);
    assert.ok(n.buttons.includes('Open sign-in page') && n.buttons.includes('Cancel') && !n.buttons.includes('Sign in'), 'Open sign-in page and Cancel: ' + JSON.stringify(n.buttons));
    assert.strictEqual(n.focus, 'Open sign-in page', 'focus moved to Open sign-in page');
    assert.ok(!/https?:\/\/|authorize|state=|code_challenge/i.test(await dlgText()), 'no address anywhere in the dialog');
    await check(w, 'confirm');
    await shot(`058-mcp-signin-confirm-${w}x${h}.png`);

    // ---- Open: a toast, the waiting text; then Running after 2 s ----
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await click('my-notes', 'Open sign-in page');
    assert.ok(await until(`/Opened the sign-in page in your browser/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'a toast says the page was opened');
    assert.ok(await until(`/Finish signing in in your browser/.test(${row('my-notes')}.textContent)`), 'the waiting text');
    n = await info('my-notes');
    assert.ok(/GitHub Copilot keeps this sign-in in your system keychain; Agent Durbar never sees it\./.test(n.text), 'the keychain sentence: ' + n.text);
    assert.ok(/This row updates when GitHub Copilot reports the server\./.test(n.text));
    assert.ok(n.focusIn, 'focus stays on the row');
    await check(w, 'waiting');
    await shot(`058-mcp-signin-waiting-${w}x${h}.png`);
    assert.ok(await until(`(${row('my-notes')}.querySelector('.mst')||{}).textContent==='Running'`, 8000), 'the row reads Running once the runtime reports it');
    assert.ok(await until(`/Signed in to my-notes\\./.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'a toast: ' + await toasts());
    n = await info('my-notes');
    assert.ok(!n.sign, 'no sign-in block once it is running: ' + JSON.stringify(n));
    await until(`/my-notes: Running/.test(window.__live.join(' | '))`, 3000);
    const said = (await js(`window.__live.join(' | ')`));
    assert.ok(/Sign-in page on auth\.example\.com/.test(said) && /my-notes: Running/.test(said), 'the polite live region says what changed: ' + said);

    // ---- Cancel: back to Sign in, focus on it ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: '1' } });
    await openMcp('sim-6');
    await click('my-notes', 'Sign in');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('button[data-signopen]')`), 'confirm again');
    await click('my-notes', 'Cancel');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('button[data-signin]')`), 'Sign in is back after Cancel');
    n = await info('my-notes');
    assert.strictEqual(n.status, 'Needs sign-in');
    assert.strictEqual(n.focus, 'Sign in', 'focus is on Sign in again');
    assert.ok(/Cancelled the sign-in for my-notes/.test(await toasts()));
    // a cancelled sign-in cannot be opened: Sign in again then switch off for this session
    await click('my-notes', 'Sign in');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('button[data-signopen]')`), 'confirm once more');
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await click('my-notes', 'Cancel');
    assert.ok(await until(`!!${row('my-notes')}.querySelector('button[data-signin]')`));
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);

    // ---- Switch off for this session: the existing switch ----
    await click('my-notes', 'Switch off for this session');
    assert.ok(await until(`(${row('my-notes')}.querySelector('.mst')||{}).textContent==='Off for this session'`), 'the row reads off for this session');
    assert.ok(/Switched my-notes off for this session\. Turn it back on in MCP servers\./.test(await toasts()), 'toast: ' + await toasts());
    assert.ok(!(await info('my-notes')).sign, 'no sign-in block for a server that is off');
    await closeDlg();

    // ---- manual: the app cannot start a sign-in, so the steps show ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: 'manual' } });
    await openMcp('sim-6');
    n = await info('my-notes');
    assert.strictEqual(n.status, 'Needs sign-in');
    assert.ok(!n.buttons.includes('Sign in') && n.buttons.includes('Switch off for this session'), 'no Sign in, but Switch off: ' + JSON.stringify(n.buttons));
    assert.ok(await js(`!!${row('my-notes')}.querySelector('.srv-steps')`), 'the steps are open by default');
    assert.ok(/\/mcp auth my-notes/.test(await js(`${row('my-notes')}.querySelector('.srv-steps').textContent`)));
    await check(w, 'manual');
    await shot(`058-mcp-signin-manual-${w}x${h}.png`);
    await closeDlg();

    // ---- Claude and Codex keep today's behaviour (Copilot first) ----
    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: '1', simkinds: 'mixed' } });
    await openMcp('sim-5'); // Codex in the mixed set; its my-notes asks for a sign-in the old canned way
    n = await info('my-notes');
    assert.strictEqual(n.status, 'Needs sign-in', 'Codex still reads Needs sign-in: ' + JSON.stringify(n));
    assert.ok(!n.sign && !n.buttons.includes('Sign in') && !n.buttons.includes('Switch off for this session'), 'Codex: no sign-in block yet: ' + JSON.stringify(n));
    await closeDlg();
    await closePanel();
  }
  console.log('[058 signin] PASS');
};
