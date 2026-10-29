/*
 * Check for spec 080 T017 (FR-030, FR-031, FR-024, FR-033; issue #556) and T018 AC3/AC4 (US2 scenarios): links a simulated agent prints in
 * its chat. Simulator only (no AI credits, no real site: the pages are the simulator's own, the only web address is a closed port on 127.0.0.1).
 *
 *   npm run check:ui -- --only check-browser-links          (and with DURBAR_SIM_BROWSER_CONSENT=ask: the one-time note on a link click)
 *
 * Default run (the note counts as accepted):
 *   1. the agent prints links (reply to "quick links"): three simulator pages, a mail link, an https link, a local http link, and a link whose
 *      scheme the sanitiser drops (no href);
 *   2. a plain click on a simulator page link opens it in THAT session's Browser tab (the panel switches, the view loads it);
 *   3. session B's click loads in B only; A's page stays where it was (SC-002: the links of one session never load in another);
 *   4. Ctrl (Cmd on a Mac) + click, and the menu's "Open in system browser", go to the system browser path (the simulator logs it) and load nothing;
 *   5. the link's menu is the shared menu: "Open in session browser" loads it; Esc closes it;
 *   6. a mail link shows the mail text with an Open button; nothing happens until Open; a link with another scheme gets the refusal text and NO button;
 *   7. Settings > Open chat links in: System browser sends a plain click to the system path; Session browser (the default) loads it in the tab.
 * With DURBAR_SIM_BROWSER_CONSENT=ask: a plain click asks the one-time note; Not now opens nothing and the link goes to the system path that time;
 * the next click asks again; Open the browser loads the link and is not asked again.
 * Every "nothing happened" assert runs after its precondition (the event that would have happened is shown to work first).
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const IS_MAC = process.platform === 'darwin';
const SYS = '[sim] would open in the system browser:';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const win = () => ctx.win;
  const views = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => views()[0];
  const wait = async (fn, what, ms = 8000) => {
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
  win().webContents.on('console-message', (e) => {
    const m = String((e && e.message) || '');
    if (m.startsWith(SYS)) logged.push(m.slice(SYS.length).trim());
  });
  const clickLink = (text, o = {}) => js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()===${jsLiteral(text)});if(!a)return false;
    a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:${!!o.mod && !IS_MAC},metaKey:${!!o.mod && IS_MAC}}));return true})()`);
  const printLinks = async (id) => {
    const o = await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#msgInput');
    assert.ok(o.ok, 'the chat of ' + id + ' is open: ' + JSON.stringify(o.seen));
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='quick links please';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    await wait(() => js(`document.querySelectorAll('#chat .md a').length>=6`), id + ' prints its links', 20000);
  };
  const toastText = () => js(`[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')`);
  const urlOf = (v) => v.webContents.getURL();

  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true });
  const ask = process.env.DURBAR_SIM_BROWSER_CONSENT === 'ask';
  await printLinks('sim-1');

  // 1. what was printed
  const links = await js(`[...document.querySelectorAll('#chat .md a')].map(a=>[a.textContent.trim(),a.getAttribute('href')])`);
  const byText = Object.fromEntries(links);
  assert.strictEqual(byText['the form page'], 'durbar-sim://pages/form');
  assert.strictEqual(byText['the links page'], 'durbar-sim://pages/links');
  assert.strictEqual(byText['mail me'], 'mailto:sim@example.invalid');
  assert.strictEqual(byText['a web page'], 'https://example.invalid/docs');
  assert.strictEqual(byText['a local page'], 'http://127.0.0.1:9/page');
  assert.strictEqual(byText['not a web link'], null, 'a scheme the sanitiser drops has no href');

  if (ask) {
    // the one-time note on a link click
    assert.deepStrictEqual(logged, [], 'precondition: nothing went to the system yet');
    await clickLink('a local page');
    await wait(() => js(`!!document.querySelector('#modeDlg .dlg')`), 'a link click asks the one-time note');
    assert.strictEqual(views().length, 0, 'no view while the note is open');
    assert.ok(await H.clickText('#modeDlg .dbtn button', 'Not now'));
    await wait(() => logged.includes('http://127.0.0.1:9/page'), 'Not now: the link goes to the system browser this time');
    assert.strictEqual(views().length, 0, 'Not now opens nothing');
    await clickLink('a local page');
    await wait(() => js(`!!document.querySelector('#modeDlg .dlg')`), 'asked again after Not now');
    assert.ok(await H.clickText('#modeDlg .dbtn button', 'Open the browser'));
    await wait(() => views().length === 1 && urlOf(view()).startsWith('http://127.0.0.1:9/'), 'Open the browser loads the link');
    assert.strictEqual(logged.length, 1, 'only the first click went to the system');
    await js(`document.getElementById('tabChat').click()`);
    await wait(() => views().length === 0, 'back on the chat');
    await clickLink('the form page');
    await wait(() => views().length === 1 && urlOf(view()) === 'durbar-sim://pages/form', 'the next link loads at once');
    assert.ok(await js(`!document.querySelector('#modeDlg')`), 'never asked again');
    console.log('[browser-links] one-time note ok');
    console.log('[browser-links] all checks passed');
    return;
  }

  // 2. a plain click: that session's Browser tab
  assert.strictEqual(views().length, 0, 'precondition: no view yet');
  assert.ok(await clickLink('the form page'));
  await wait(() => views().length === 1 && urlOf(view()) === 'durbar-sim://pages/form', "the link loads in the session's view");
  assert.strictEqual(await js(`document.getElementById('tabBrowser').getAttribute('aria-selected')`), 'true', 'the panel switched to the Browser tab');
  assert.deepStrictEqual(logged, [], 'a plain click never touches the system browser');
  const viewA = view();
  const nameA = await js(`document.getElementById('panelTitle').textContent`);

  // 3. session B: its click loads in B only
  await js(`document.getElementById('tabChat').click()`);
  await wait(() => views().length === 0, 'A on its chat');
  await js(`document.querySelector('#stripList [data-sw="sim-2"]').click()`);
  await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw==='sim-2'`), 'session B is open');
  assert.ok((await js(`document.getElementById('panelTitle').textContent`)) !== nameA, 'a different session');
  await js(`(()=>{const i=document.getElementById('msgInput');i.value='quick links please';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  await wait(() => js(`document.querySelectorAll('#chat .md a').length>=6`), 'B prints its links', 20000);
  assert.strictEqual(views().length, 0, 'B has no browser before its click');
  assert.ok(await clickLink('the links page'));
  await wait(() => views().length === 1 && view() !== viewA && urlOf(view()) === 'durbar-sim://pages/links', "B's link loads in B's own view");
  assert.strictEqual(urlOf(viewA), 'durbar-sim://pages/form', "A's page did not move");
  assert.notStrictEqual(view().webContents.session, viewA.webContents.session, 'two partitions');
  const viewB = view();

  // 4. Ctrl/Cmd+click and the menu's system item: the system path, nothing loads
  assert.ok(await clickLink('a web page', { mod: true }));
  await wait(() => logged.includes('https://example.invalid/docs'), 'Ctrl/Cmd+click goes to the system browser path');
  assert.strictEqual(urlOf(viewB), 'durbar-sim://pages/links', 'and loads nothing in the tab');
  await js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()==='a web page');const r=a.getBoundingClientRect();a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+4}))})()`);
  await wait(() => js(`!!document.querySelector('#modeMenu [data-lact="sys"]')&&!!document.querySelector('#modeMenu [data-lact="tab"]')`), 'the link menu offers both');
  assert.strictEqual(await js(`[...document.querySelectorAll('#modeMenu [data-lact]')].map(b=>b.querySelector('b').textContent).join('|')`), 'Open in session browser|Open in system browser');
  assert.ok(await js(`document.querySelector('#modeMenu').classList.contains('mode-menu')&&document.querySelector('#modeMenu').getAttribute('role')==='menu'`), 'the shared menu element');
  const before = logged.length;
  await js(`document.querySelector('#modeMenu [data-lact="sys"]').click()`);
  await wait(() => logged.length === before + 1 && logged[logged.length - 1] === 'https://example.invalid/docs', 'the menu item goes to the system path');
  assert.ok(await js(`!document.getElementById('modeMenu')`), 'the menu closes');
  assert.strictEqual(urlOf(viewB), 'durbar-sim://pages/links');

  // 5. the menu of a simulator page link: only the session browser; Esc closes it
  await js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()==='the slow page');const r=a.getBoundingClientRect();a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+4}))})()`);
  await wait(() => js(`!!document.querySelector('#modeMenu [data-lact="tab"]')&&!document.querySelector('#modeMenu [data-lact="sys"]')`), 'a page link: only the session browser item');
  await H.key('Escape', [], { char: 'never' });
  await wait(() => js(`!document.getElementById('modeMenu')`), 'Esc closes the menu');
  assert.ok(await js(`document.body.classList.contains('panel-open')`), 'and the chat stays open');
  await js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()==='the slow page');const r=a.getBoundingClientRect();a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+4}))})()`);
  await wait(() => js(`!!document.querySelector('#modeMenu [data-lact="tab"]')`), 'the menu again');
  await js(`document.querySelector('#modeMenu [data-lact="tab"]').click()`);
  await wait(() => urlOf(viewB).startsWith('durbar-sim://pages/slow'), "the menu's session item loads the link in B");

  // 6. a mail link and another scheme
  await js(`document.getElementById('tabChat').click()`);
  await wait(() => views().length === 0, 'B on its chat');
  await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
  assert.ok(await clickLink('mail me'));
  await wait(() => js(`[...document.querySelectorAll('#toasts .toast')].some(t=>/wants to open your mail app/.test(t.textContent)&&[...t.querySelectorAll('button')].some(b=>b.textContent==='Open'))`), 'a mail link: the mail text and an Open button');
  assert.deepStrictEqual(logged.filter((u) => u.startsWith('mailto')), [], 'nothing opened before the click on Open');
  await js(`[...document.querySelectorAll('#toasts .toast button')].find(b=>b.textContent==='Open').click()`);
  await wait(() => js(`![...document.querySelectorAll('#toasts .toast')].some(t=>/mail app/.test(t.textContent))`), 'the toast goes after Open');
  await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
  // a scheme the sanitiser dropped cannot be clicked; a hostile anchor that reached the page anyway gets the refusal text and no button
  await js(`(()=>{const md=document.querySelector('#chat .md');const a=document.createElement('a');a.setAttribute('href','ms-msdt:/id');a.textContent='hostile';md.appendChild(a);})()`);
  assert.ok(await clickLink('hostile'));
  await wait(() => js(`[...document.querySelectorAll('#toasts .toast')].some(t=>/opens only mail links in other apps/.test(t.textContent))`), 'the refusal text');
  assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].filter(t=>/other apps/.test(t.textContent)).some(t=>t.querySelector('button'))`), false, 'and no button');
  assert.strictEqual(views().length, 0, 'nothing loaded');
  assert.ok(!logged.some((u) => /ms-msdt|mailto/.test(u)), 'nothing went to the system');
  await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);

  // 7. Settings > Open chat links in
  await js(`window.DurbarScreens.openSettings()`);
  await wait(() => js(`!!document.getElementById('chatLinksSel')`), 'the setting is in Settings');
  assert.strictEqual(await js(`document.getElementById('chatLinksSel').value`), 'session', 'the default is the session browser');
  assert.strictEqual(await js(`[...document.querySelectorAll('#chatLinksSel option')].map(o=>o.textContent).join('|')`), 'Session browser|System browser');
  await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='system';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(() => js(`/usual browser/.test((document.getElementById('chatLinksMsg')||{}).textContent||'')`), 'the choice is saved');
  await js(`document.getElementById('scrClose').click()`);
  await wait(() => js(`!document.getElementById('scrClose')`), 'Settings closed');
  const viewsBefore = urlOf(viewB);
  const sysBefore = logged.length;
  assert.ok(await clickLink('a local page'));
  await wait(() => logged.length === sysBefore + 1 && logged[logged.length - 1] === 'http://127.0.0.1:9/page', 'System browser: a plain click goes to the system path');
  assert.strictEqual(views().length, 0, 'and opens no tab');
  await js(`window.DurbarScreens.openSettings()`);
  await wait(() => js(`!!document.getElementById('chatLinksSel')`), 'Settings again');
  assert.strictEqual(await js(`document.getElementById('chatLinksSel').value`), 'system', 'the choice stays');
  await js(`(()=>{const s=document.getElementById('chatLinksSel');s.value='session';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(() => js(`/Browser tab/.test((document.getElementById('chatLinksMsg')||{}).textContent||'')`), 'back to the session browser');
  await js(`document.getElementById('scrClose').click()`);
  await wait(() => js(`!document.getElementById('scrClose')`), 'Settings closed again');
  assert.ok(await clickLink('a local page'));
  await wait(() => views().length === 1 && urlOf(view()).startsWith('http://127.0.0.1:9/'), 'Session browser: a plain click loads it in the tab (a closed local port, nothing else)');
  assert.strictEqual(logged.length, sysBefore + 1, 'and does not touch the system');
  assert.notStrictEqual(urlOf(view()), viewsBefore);
  console.log('[browser-links] all checks passed');
};
