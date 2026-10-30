/*
 * Check for spec 080 T018 AC2 and AC4 (FR-091, issue #556): the simulator's remaining test pages and the acceptance scenarios of US1 (1-5) and
 * US2 (1-3), including SC-002 and SC-004. Simulator only (no AI credits, no network: the simulator's own `durbar-sim:` pages).
 *
 *   npm run check:ui -- --only check-browser-scenarios
 *
 *   US1.1  the Browser tab has the address field, Back, Forward, Reload and a page area; the office is still laid out after closing the chat;
 *   US1.2  SC-002: a storage value set in session A is not readable in session B (same test origin);
 *   US1.3  SC-004: ending A's browser (the driver's hook: the simulator's End never reaches main) destroys its view and process, and a new browser
 *          for A on the same origin sees nothing of the old one (a new partition);
 *   US1.4  a Durbar menu over the page area is visible and the page is not drawn over it (the full overlay matrix is check-browser-tab);
 *   US1.5  file:, chrome:, javascript:, view-source: and data: addresses load nothing and the bar says why;
 *   US2.1  a link the agent printed opens that session's Browser tab with the page, and the chat is as it was when you go back;
 *   US2.2  Ctrl/Cmd+click goes to the system path (the simulator logs it) and loads nothing;
 *   US2.3  session B's link loads in B, never in A (more in check-browser-links);
 *   AC2    a native confirm the user answers (the driver stands in through the view's debugger), prompt() throws, the sensitive fields exist and
 *          take typing, an element slides over its button, a script redirect reaches another test host, a basic-auth challenge shows its 401 body.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const IS_MAC = process.platform === 'darwin';
const SYS = '[sim] would open in the system browser:';
const PAGE = 'durbar-sim://pages/';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const win = () => ctx.win;
  const views = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => views()[0];
  const inView = (code) => view().webContents.executeJavaScript(code, true);
  const wait = async (fn, what, ms = 10000) => {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try { v = await fn(); } catch (e) { v = false; }
      if (v) return v;
      assert.ok(Date.now() < end, 'timed out: ' + what);
      await ctx.sleep(60);
    }
  };
  const logged = [];
  win().webContents.on('console-message', (e) => { const m = String((e && e.message) || ''); if (m.startsWith(SYS)) logged.push(m.slice(SYS.length).trim()); });
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const go = async (url) => { await typeAddress(url); await wait(() => view().webContents.getURL() === url, 'loads ' + url); };
  const note = () => js(`(document.getElementById('bNote')||{}).textContent||''`);
  const centre = (sel) => inView(`(()=>{const b=document.querySelector(${jsLiteral(sel)}).getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
  const clickInPage = async (sel) => {
    const r = await centre(sel);
    const wc = view().webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  };
  const openChat = async (id, first) => {
    if (first) {
      const o = await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#panelTabs');
      assert.ok(o.ok, 'chat open: ' + JSON.stringify(o.seen));
    } else {
      await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(id)})+'"]').click()`);
      await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(id)}`), id + ' open');
    }
  };
  const browserTab = async () => { await js(`document.getElementById('tabBrowser').click()`); await wait(() => views().length === 1, 'the view is attached'); };
  const chatTab = async () => { await js(`document.getElementById('tabChat').click()`); await wait(() => views().length === 0, 'the view is detached'); };

  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true });

  // US1.1
  await openChat('sim-1', true);
  await browserTab();
  const bar = await js(`(()=>{const q=s=>!!document.querySelector(s);const v=document.getElementById('bView').getBoundingClientRect();return {addr:q('#bAddr'),back:q('#bBack'),fwd:q('#bFwd'),reload:q('#bReload'),area:v.width>300&&v.height>150}})()`);
  assert.deepStrictEqual(bar, { addr: true, back: true, fwd: true, reload: true, area: true }, 'US1.1: the bar and a page area');

  // US1.2 SC-002
  await go(PAGE + 'storage?set=fromA');
  await wait(async () => /k=fromA/.test(await inView(`document.getElementById('result').textContent`)), 'A wrote its storage');
  const viewA = view();
  const wcA = viewA.webContents; // kept: a destroyed view no longer has one
  const pidA = wcA.getOSProcessId();
  const sesA = wcA.session;
  await chatTab();
  await openChat('sim-2', false);
  await browserTab();
  await go(PAGE + 'storage');
  assert.ok(/k=null/.test(await inView(`document.getElementById('result').textContent`)), 'US1.2 / SC-002: B does not see A\'s value on the same origin: ' + (await inView(`document.getElementById('result').textContent`)));
  assert.ok(/c=none/.test(await inView(`document.getElementById('result').textContent`)), 'nor a cookie');
  assert.notStrictEqual(view().webContents.session, sesA, 'two partitions');
  await chatTab();

  // US1.3 SC-004
  await openChat('sim-1', false);
  await browserTab();
  assert.strictEqual(view(), viewA);
  assert.ok(/k=fromA/.test(await inView(`document.getElementById('result').textContent`)), 'precondition: A still holds its value');
  await ctx.browserGone('sim-1');
  await wait(() => wcA.isDestroyed(), 'SC-004: the view\'s webContents is destroyed');
  assert.strictEqual(views().length, 0, 'and it is off the window');
  await wait(() => { try { process.kill(pidA, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }, 'SC-004: no process of it is left', 15000);
  await chatTab().catch(() => undefined);
  await js(`document.getElementById('tabChat').click()`);
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(() => views().length === 1 && view() !== viewA, 'a new browser for the same session');
  await go(PAGE + 'storage');
  assert.ok(/k=null/.test(await inView(`document.getElementById('result').textContent`)), 'SC-004: the new browser on the same origin sees no old value');
  assert.notStrictEqual(view().webContents.session, sesA, 'and a new partition');

  // US1.4 (one case; the matrix is check-browser-tab)
  await js(`document.getElementById('moreBtn').click()`);
  await wait(() => views().length === 0, 'US1.4: the menu takes the view off');
  assert.ok(await js(`(()=>{const m=document.getElementById('moreMenu').getBoundingClientRect(),v=document.getElementById('bView').getBoundingClientRect();const x=(Math.max(m.left,v.left)+Math.min(m.right,v.right))/2,y=(Math.max(m.top,v.top)+Math.min(m.bottom,v.bottom))/2;const e=document.elementFromPoint(x,y);return !!e&&!!e.closest('#moreMenu')})()`), 'the menu is the top element over the page area');
  await H.key('Escape', [], { char: 'never' });
  await wait(() => views().length === 1, 'the view is back');

  // US1.5
  for (const [text, why] of [['file:///etc/hostname', /Only http and https/], ['chrome://settings', /Only http and https/], ['javascript:alert(1)', /Only http and https/], ['view-source:https://example.invalid', /Only http and https/], ['data:text/html,hi', /Only http and https/]]) {
    const before = view().webContents.getURL();
    await typeAddress(text);
    await wait(async () => why.test(await note()), `US1.5: "${text}" says why`);
    assert.strictEqual(view().webContents.getURL(), before, `US1.5: "${text}" loaded nothing`);
    await js(`document.getElementById('bAddr').blur()`);
  }

  // T018 AC2: the remaining pages
  // confirm: the native box is the user's; the driver answers it through the view's debugger, as a person would
  await go(PAGE + 'confirm');
  const dbg = view().webContents.debugger;
  const opened = [];
  const onMsg = (_e, method, params) => { if (method === 'Page.javascriptDialogOpening') opened.push(params.type); };
  dbg.on('message', onMsg);
  await clickInPage('#ask');
  await wait(() => opened.includes('confirm'), 'a native confirm appeared for the user');
  await dbg.sendCommand('Page.handleJavaScriptDialog', { accept: true });
  await wait(async () => (await inView(`document.getElementById('result').textContent`)) === 'confirm returned true', 'the answer reached the page (OK)');
  await clickInPage('#ask');
  await wait(() => opened.length === 2, 'a second confirm');
  await dbg.sendCommand('Page.handleJavaScriptDialog', { accept: false });
  await wait(async () => (await inView(`document.getElementById('result').textContent`)) === 'confirm returned false', 'the answer reached the page (Cancel)');
  dbg.removeListener('message', onMsg);
  await go(PAGE + 'prompt');
  await wait(async () => (await inView(`document.getElementById('result').textContent`)) === 'prompt threw', 'prompt() throws (unsupported in the view)');
  // the sensitive fields exist and take typing from the user
  await go(PAGE + 'fields');
  assert.deepStrictEqual(await inView(`['pw','otp','cc'].map(i=>{const e=document.getElementById(i);return [e.type,e.autocomplete]})`), [['password', 'current-password'], ['text', 'one-time-code'], ['text', 'cc-number']]);
  await clickInPage('#pw');
  for (const ch of 'xy') { view().webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); view().webContents.sendInputEvent({ type: 'char', keyCode: ch }); view().webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
  await wait(async () => (await inView(`document.getElementById('pw').value`)) === 'xy', 'typing reaches the password field');
  // an element slides over its button
  await go(PAGE + 'slide');
  const before = await inView(`(()=>{const b=document.getElementById('target').getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return e.id})()`);
  assert.strictEqual(before, 'target', 'precondition: the button is reachable before the cover arrives');
  await wait(async () => (await inView(`(()=>{const b=document.getElementById('target').getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2).id})()`)) === 'cover', 'the element slides over the button');
  // a script redirect reaches another test host
  await typeAddress(PAGE + 'redirect');
  await wait(() => view().webContents.getURL() === 'durbar-sim://other/landing', 'the script redirect reaches the other test host', 12000);
  assert.ok(/other host/.test(await inView(`document.getElementById('result').textContent`)));
  // a basic-auth challenge: no credentials box, the 401 body shows
  await go(PAGE + 'auth');
  await wait(async () => /Authentication is cancelled/.test(await inView(`document.getElementById('result').textContent`)), 'the 401 page shows (the challenge is cancelled)');

  // US2.1: a link the agent printed
  await chatTab();
  await js(`(()=>{const i=document.getElementById('msgInput');i.value='quick links please';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  await wait(() => js(`document.querySelectorAll('#chat .md a').length>=6`), 'the agent prints its links', 20000);
  const msgsBefore = await js(`document.querySelectorAll('#chat .msg').length`);
  await js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()==='the links page');a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))})()`);
  await wait(() => views().length === 1 && view().webContents.getURL() === PAGE + 'links', 'US2.1: the link opens in the session\'s Browser tab');
  await chatTab();
  assert.strictEqual(await js(`document.querySelectorAll('#chat .msg').length`), msgsBefore, 'US2.1: the chat is as it was');
  // US2.2
  assert.deepStrictEqual(logged, [], 'precondition: nothing went to the system yet');
  await js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()==='a web page');a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:${jsLiteral(!IS_MAC)},metaKey:${jsLiteral(IS_MAC)}}))})()`);
  await wait(() => logged.some((u) => u === 'https://example.invalid/docs'), 'US2.2: the modifier click goes to the system path');
  assert.strictEqual(views().length, 0, 'and loads nothing in the tab');
  console.log('[browser-scenarios] all checks passed');
};
