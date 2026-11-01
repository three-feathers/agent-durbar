/*
 * Check for spec 080 Phase 1b (US6, FR-120..FR-133, SC-011; T024 AC2/AC5/AC6, T025 AC2, T026): page tabs in a session's browser. Simulator only
 * (no AI credits, no outside network: the simulator's own pages, also served on 127.0.0.1 by this driver for FR-125, which needs a real http referrer).
 *
 *   npm run check:ui -- --only check-browser-tabs                          (1440x900)
 *   BROWSER_TABS_SIZE=1280x800 ... check-browser-tabs                      (the same at 1280x800)
 *   OUT=docs/screenshots ... check-browser-tabs                            also writes 080-browser-tabs-<size>.png (the strip with 10 tabs)
 *
 * Every step waits with until-style polling (no fixed pause), and every "nothing happened" assert runs after the event that would have happened
 * is shown to work. One named step per US6 scenario:
 *   US6.1  the toggle off (the default): a chat link loads in the active tab, no tab added;
 *   US6.2  the toggle on (More > Open chat links in a new tab): a new tab to the right, active; the old page stays loaded; the toggle shows checked in another session;
 *   US6.3  the same link again: its tab is focused and NOT reloaded (a mark set in the page survives);
 *   US6.4  a page's same-origin target=_blank opens a tab; rel=noreferrer, a sandboxed frame's window.open and the hostile-scheme links open none
 *          and send nothing to the system; a window.open loop of 7 opens 5;
 *   FR-129 a page's timer opening a tab while the composer has the focus: the tab opens, the composer keeps the focus;
 *   US6.5  10 tabs: + is disabled with the limit text, Ctrl+T adds nothing and the bar says why; a chat link then loads in the active tab;
 *   US6.6  a loading tab closed: its view goes, the next tab becomes active;
 *   US6.12 the strip's keys: arrows and Home/End move, Enter selects, Delete closes; tab N of M;
 *   US6.11 Ctrl+T, Ctrl+Tab, Ctrl+W (Cmd on a Mac for T and W) inside a page act on the tabs and the page never sees them; in the composer Ctrl+W does what it did before;
 *   US6.7  the last tab closed: one empty New tab, the address field focused, no view;
 *   US6.10 pages dropped by the cap: a dropped background tab's view is gone; selecting it reloads its address with "Reloaded to save memory"; a chat link to
 *          a dropped tab's address focuses it and reloads it;
 *   US6.9  (one session here; the 3 x 10 matrix is the unit test SC-010) never more than four pages loaded;
 *   US6.8  the session ends with several tabs: every tab's view is destroyed and its process gone.
 *   SC-011 the strip with 10 tabs fits the panel: no overlap, text 10.5px or more, no page or office scroll, the active tab in view.
 */
const assert = require('assert');
const path = require('path');
const { webContents, app } = require('electron');
const { helpers, jsLiteral, shotWithView } = require('./driver-helpers');

const IS_MAC = process.platform === 'darwin';
const MOD = IS_MAC ? 'meta' : 'control';
const SYS = '[sim] would open in the system browser:';
const PAGE = 'durbar-sim://pages/';

/* FR-125 needs a real http referrer (Chromium sends none from the simulator's own scheme), so the tab pages are also served here, on loopback
   only, from the same fixed strings (simPage): no file, no outside network. */
function servePages() {
  const http = require('http');
  const { simPage } = require(path.join(__dirname, '..', 'dist', 'main', 'browser', 'simpages.js'));
  const server = http.createServer(async (req, res) => {
    const r = await simPage('durbar-sim://pages' + (req.url || '/'), req.method || 'GET', '');
    res.writeHead(r.status, r.headers);
    res.end(r.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { server, base: WEB } = await servePages();
  const { js } = H;
  const [W, Hh] = (process.env.BROWSER_TABS_SIZE || '1440x900').split('x').map(Number);
  const size = `${W}x${Hh}`;
  const win = () => ctx.win;
  const attached = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => attached()[0];
  const allViews = () => webContents.getAllWebContents().filter((w) => w !== win().webContents && !w.isDestroyed());
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
  const tabs = (id = 'sim-1') => ctx.browserTabs(id);
  const count = (id = 'sim-1') => tabs(id).tabs.length;
  const activeUrl = () => { const t = tabs(); const a = t.tabs.find((x) => x.tabId === t.active); return a ? a.url : null; };
  const inView = (code) => view().webContents.executeJavaScript(code, true);
  /* A script in a given page (FR-048b): "Script failed to execute" when the page's context changes under it (a load settling, a refused
     request's side effects) is retried once the page settles, up to 4 times; `again()` false = the effect already happened, do not repeat. */
  const inWc = async (wc, code, what, again = () => true) => {
    for (let i = 0; ; i++) {
      try { return await wc.executeJavaScript(code, true); } catch (e) {
        if (i >= 4 || !/Script failed to execute/.test(String(e && e.message)) || !again()) throw e;
        console.log(`[browser-tabs] ${what}: the page changed under the script, trying again`);
        await wait(() => !wc.isDestroyed() && !wc.isLoading(), what + ': the page settles');
      }
    }
  };
  const clickLink = (text) => js(`(()=>{const a=[...document.querySelectorAll('#chat .md a')].find(x=>x.textContent.trim()===${jsLiteral(text)});if(!a)return false;a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return true})()`);
  const toChat = async () => { await js(`document.getElementById('tabChat').click()`); await wait(() => attached().length === 0, 'the Chat tab'); };
  const toBrowser = async () => { await js(`document.getElementById('tabBrowser').click()`); await wait(() => js(`document.getElementById('tabBrowser').getAttribute('aria-selected')==='true'`), 'the Browser tab'); };
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const go = async (url) => { await typeAddress(url); await wait(() => view() && view().webContents.getURL() === url && !view().webContents.isLoading(), 'loads ' + url); };
  const stripTabs = () => js(`[...document.querySelectorAll('#bTabs .btab-b')].map(b=>({id:b.closest('[data-tab]').dataset.tab,sel:b.getAttribute('aria-selected'),ti:b.tabIndex,pos:b.getAttribute('aria-posinset'),of:b.getAttribute('aria-setsize'),name:b.querySelector('.btab-t').textContent}))`);
  const moreToggle = async () => {
    await js(`document.getElementById('bMore').click()`);
    await wait(() => js(`!!document.querySelector('#modeMenu [data-bact="newtab"]')`), 'the More menu');
    return js(`document.querySelector('#modeMenu [data-bact="newtab"]').getAttribute('aria-checked')`);
  };
  /* closes the active tab with its x once the strip shows main's active tab (a click on a stale strip would name a tab that is gone) */
  const closeActive = async () => {
    const want = tabs().active, n = count();
    await wait(() => js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return !!e&&e.dataset.tab===${jsLiteral(want)}})()`), 'the strip shows the active tab');
    await js(`document.querySelector('#bTabs .btab.on .btab-x').click()`);
    await wait(() => count() === n - 1 && !tabs().tabs.some((x) => x.tabId === want), 'the active tab closes');
  };
  const pageKey = async (keyCode, modifiers) => {
    const wc = view().webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };

  await H.load({ w: W, h: Hh, ready: 'fit', focus: true });
  const o = await H.openSimAgent(`a=>a.id==='sim-1'`, '#msgInput');
  assert.ok(o.ok, 'the chat of sim-1 is open: ' + JSON.stringify(o.seen));
  await js(`(()=>{const i=document.getElementById('msgInput');i.value='quick links please';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  await wait(() => js(`[...document.querySelectorAll('#chat .md a')].some(a=>a.textContent.trim()==='the keys page')`), 'the agent prints its links', 20000);

  // US6.1: the toggle is off by default; a chat link loads in the active tab
  assert.ok(await clickLink('the form page'));
  await wait(() => view() && view().webContents.getURL() === PAGE + 'form', 'the link loads');
  assert.strictEqual(count(), 1, 'one tab');
  assert.strictEqual(await moreToggle(), 'false', 'Open chat links in a new tab is off by default');
  await H.key('Escape', [], { char: 'never' });
  await wait(() => js(`!document.getElementById('modeMenu')`), 'the menu closes');
  await toChat();
  assert.ok(await clickLink('the links page'));
  await wait(() => view() && view().webContents.getURL() === PAGE + 'links', 'toggle off: the link replaces the page');
  assert.strictEqual(count(), 1, 'toggle off: no tab added (US6.1)');
  console.log('[browser-tabs] US6.1 ok');

  // US6.2: the toggle on; a link opens a new tab to the right, active; the page I was on stays loaded
  assert.strictEqual(await moreToggle(), 'false');
  await js(`document.querySelector('#modeMenu [data-bact="newtab"]').click()`);
  await wait(() => js(`!document.getElementById('modeMenu')`), 'the menu closes after the choice');
  assert.strictEqual(await moreToggle(), 'true', 'the toggle is on');
  await H.key('Escape', [], { char: 'never' });
  const firstTab = tabs().active;
  const linksWc = view().webContents;
  await toChat();
  assert.ok(await clickLink('the form page'));
  await wait(() => count() === 2 && activeUrl() === PAGE + 'form', 'a new tab with the link (US6.2)');
  const t = tabs();
  assert.deepStrictEqual(t.tabs.map((x) => x.tabId)[0], firstTab, 'the new tab is to the right of the one I was on');
  assert.notStrictEqual(t.active, firstTab, 'and active');
  assert.ok(!linksWc.isDestroyed() && linksWc.getURL() === PAGE + 'links', 'the page I was on stays loaded in its tab');
  await wait(() => view() && view().webContents !== linksWc && view().webContents.getURL() === PAGE + 'form', 'the new tab is the one on the window');
  console.log('[browser-tabs] US6.2 ok');

  // US6.3: the same link focuses its tab and does not reload it
  await wait(() => !view().webContents.isLoading(), 'the form page loaded');
  await inView(`window.__mark=7`);
  const formTab = tabs().active;
  await js(`(async()=>{const r=await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(firstTab)});return !!(r&&r.ok)})()`);
  await wait(() => tabs().active === firstTab, 'back on the first tab');
  await toChat();
  assert.ok(await clickLink('the form page'));
  await wait(() => tabs().active === formTab && view() && view().webContents.getURL() === PAGE + 'form', 'the same link focuses its tab');
  assert.strictEqual(count(), 2, 'no tab added (US6.3)');
  assert.strictEqual(await inView(`window.__mark`), 7, 'and the page was not reloaded');
  // the toggle is app-wide: checked in another session's menu too
  await js(`document.querySelector('#stripList [data-sw="sim-2"]').click()`);
  await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw==='sim-2'`), 'session sim-2');
  await toBrowser();
  await wait(() => js(`!!document.getElementById('bMore')`), 'sim-2 browser bar');
  assert.strictEqual(await moreToggle(), 'true', 'shown checked in another session');
  await H.key('Escape', [], { char: 'never' });
  await js(`document.querySelector('#stripList [data-sw="sim-1"]').click()`);
  await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw==='sim-1'`), 'back to sim-1');
  await toBrowser();
  await wait(() => view() && view().webContents.getURL() === PAGE + 'form', 'sim-1 Browser tab again');
  console.log('[browser-tabs] US6.3 ok');

  // US6.4: pages opening tabs (served over loopback http: see servePages)
  await go(WEB + 'tabs');
  const base = count();
  const opener = tabs().active;
  const openerWc = view().webContents; // every script below runs in the opener page, whichever tab is on the window
  await wait(() => inWc(openerWc, `document.readyState==='complete'&&!!document.getElementById('t-blank')`, 'the tabs page is ready'), 'the tabs page is ready');
  // each of these clicks opens nothing, so repeating one after a context change is harmless
  assert.strictEqual(await inWc(openerWc, `(()=>{let n=0;for(let i=0;i<13;i++){const a=document.getElementById('t-bad'+i);if(a){a.click();n++;}}return n})()`, 'the hostile-scheme links'), 13, 'every hostile-scheme link was clicked');
  await inWc(openerWc, `document.getElementById('t-noref').click()`, 'the rel=noreferrer link');
  await inWc(openerWc, `(()=>{const f=document.getElementById('t-frame');const b=f&&f.contentDocument?f.contentDocument.getElementById('f'):null;if(b)b.click();return !!b})()`, 'the frame');
  // the frame is sandboxed (an opaque origin): its document is not reachable from the page; click it with real input instead
  {
    const r = await inWc(openerWc, `(()=>{const b=document.getElementById('t-frame').getBoundingClientRect();return {x:Math.round(b.left+20),y:Math.round(b.top+16)}})()`, 'the frame\'s place');
    openerWc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    openerWc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }
  // the precondition: a same-origin _blank does open a tab (repeated after a context change only while no tab came from it)
  await inWc(openerWc, `document.getElementById('t-blank').click()`, 'the target=_blank link', () => count() === base);
  await wait(() => count() === base + 1, 'a same-origin target=_blank opens a tab');
  const added = tabs().tabs.find((x) => x.url === WEB + 'index');
  assert.ok(added, 'with its page');
  assert.strictEqual(count(), base + 1, 'the hostile schemes, rel=noreferrer and the sandboxed frame opened no tab');
  assert.deepStrictEqual(logged, [], 'nothing went to the system (the simulator logs every system-browser call)');
  // a window.open loop of 7 in a new page load: at most 5 tabs
  await js(`(async()=>{await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(opener)});return true})()`);
  await wait(() => tabs().active === opener && view() && view().webContents.getURL() === WEB + 'tabs', 'the opener again');
  await go(WEB + 'tabs?again=1');
  const before = count();
  const loopWc = view().webContents; // the first tab of the loop becomes active: the next click is still the opener page's
  await wait(() => inWc(loopWc, `document.readyState==='complete'&&!!document.getElementById('t-loop')`, 'the opener page is ready'), 'the opener page is ready');
  await inWc(loopWc, `document.getElementById('t-loop').click()`, 'the window.open loop', () => count() === before);
  await wait(() => count() === Math.min(10, before + 5), 'the loop opened its tabs');
  await inWc(loopWc, `document.getElementById('t-blank2').click()`, 'one more request'); // one more request in the same load: refused (already 5)
  await go(WEB + 'tabs?third=1'); // a navigation settles the page's own events first
  assert.strictEqual(count(), Math.min(10, before + 5), 'a page load opens at most 5 tabs (FR-125)');
  console.log('[browser-tabs] US6.4 ok');
  // FR-129 (2026-10-31 delta): a page that opens a tab on a timer while the user types in the composer never takes the keyboard focus
  {
    await js(`(async()=>{await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(opener)});return true})()`);
    await wait(() => tabs().active === opener && view() && view().webContents === openerWc, 'the opener again');
    await go(WEB + 'tabs?focus=1'); // a new page load: its own 5
    const n = count();
    await inWc(openerWc, `setTimeout(()=>window.open('/index?timer=1'),300);true`, 'the timer');
    win().webContents.focus();
    await js(`document.getElementById('msgInput').focus()`);
    await wait(() => win().webContents.isFocused() && js(`document.activeElement&&document.activeElement.id==='msgInput'`), 'the composer has the focus');
    await wait(() => count() === n + 1 && view() && view().webContents.getURL() === WEB + 'index?timer=1' && !view().webContents.isLoading(), 'the timer\'s tab opens and loads');
    assert.ok(!view().webContents.isFocused(), 'FR-129: the new page did not take the focus');
    assert.ok(win().webContents.isFocused() && await js(`document.activeElement&&document.activeElement.id==='msgInput'`), 'FR-129: the composer keeps it');
  }

  // US6.5: 10 tabs
  while (count() < 10) {
    const n = count();
    await js(`document.getElementById('bNewTab').click()`);
    await wait(() => count() === n + 1, '+ adds a tab');
  }
  await wait(() => js(`document.getElementById('bNewTab').disabled===true&&document.getElementById('bNewTab').getAttribute('aria-describedby')==='bLimitText'`), '+ is disabled at 10 with the limit text');
  assert.ok(/10 tabs, the most it can hold/.test(await js(`document.getElementById('bLimitText').textContent`)));
  await js(`document.getElementById('bAddr').focus()`);
  await H.key('T', [MOD], { char: 'never' });
  await wait(() => js(`/10 tabs/.test(document.getElementById('bNote').textContent)`), 'Ctrl+T at 10: the bar says why');
  assert.strictEqual(count(), 10, 'no 11th tab');
  // SC-011: the strip with 10 tabs fits
  const fit = await js(`(()=>{const P=[],R=e=>e.getBoundingClientRect(),de=document.documentElement;
    if(de.scrollWidth>innerWidth+1||de.scrollHeight>innerHeight+1)P.push('page overflows');
    const strip=document.querySelector('#browserPane .bstrip'),list=document.getElementById('bTabs'),plus=document.getElementById('bNewTab');
    const s=R(strip),l=R(list),p=R(plus);
    if(s.left<-1||s.right>innerWidth+1)P.push('the strip leaves the window');
    if(Math.min(l.right,p.right)-Math.max(l.left,p.left)>0.5)P.push('the tabs overlap +');
    if(p.right>s.right+1)P.push('+ leaves the strip');
    const on=list.querySelector('.btab.on');if(on){const a=R(on);if(a.left<l.left-1||a.right>l.right+1)P.push('the active tab is not in view');}
    const small=[...document.querySelectorAll('#bTabs .btab-t, #browserPane .bbar *, #browserPane .bstat *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5);
    if(small.length)P.push('text under 10.5px');
    const w=[...list.querySelectorAll('.btab')].map(e=>R(e).width);if(Math.min(...w)<71.5)P.push('a tab under 72px: '+Math.min(...w));
    const st=document.getElementById('stage');if(st&&st.scrollWidth>st.clientWidth+1)P.push('the office scrolls');
    return P})()`);
  assert.deepStrictEqual(fit, [], 'SC-011 at ' + size);
  if (process.env.OUT || process.env.SHOTS_OUT) {
    const firstId = tabs().tabs[0].tabId;
    await js(`(async()=>{const r=await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(firstId)});return true})()`);
    // This tab was dropped by the cap (US6.10), so selecting it reloads it: right after the call its entry still reads `about:blank`, no address, loading
    // (issue #934, seen on Ubuntu CI as "timed out: the first tab for the picture"). Read the address to expect only once the page has loaded again.
    await wait(() => { const t = tabs(), f = t.tabs[0]; return t.active === firstId && f.tabId === firstId && f.url && !f.loading && view() && !view().webContents.isLoading(); }, 'the first tab has loaded again');
    const first = tabs().tabs[0];
    await wait(async () => tabs().active === first.tabId && view() && !view().webContents.isLoading() && (await js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return !!e&&e.dataset.tab===${jsLiteral(first.tabId)}&&document.getElementById('bAddr').value===${jsLiteral(first.url)}})()`)), 'the first tab for the picture, in the strip and the bar too');
    win().webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await H.calm({ blur: true });
    win().webContents.invalidate(); // the window's page repaints under the native view before its capture
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const file = path.join(process.env.OUT || process.env.SHOTS_OUT, `080-browser-tabs-${size}.png`);
    await shotWithView(win(), view(), file); // the strip and the page itself (the window's capture leaves the native view out)
    console.log('[browser-tabs] saved', path.basename(file));
  }
  // a chat link at 10 loads in the active (non-empty) tab
  const nonEmpty = tabs().tabs.find((x) => x.url && !/\/slow/.test(x.url));
  await js(`(async()=>{await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(nonEmpty.tabId)});return true})()`);
  await wait(() => tabs().active === nonEmpty.tabId, 'a tab with a page');
  await toChat();
  assert.ok(await clickLink('the slow page'));
  await wait(() => tabs().active === nonEmpty.tabId && /\/slow/.test(activeUrl()), 'at 10 the link loads in the active tab');
  assert.strictEqual(count(), 10, 'still 10');
  await wait(() => js(`/10 tabs/.test(document.getElementById('bNote').textContent)`), 'with the limit note');
  console.log('[browser-tabs] US6.5 ok');

  // US6.6: a loading tab closed: its view goes, the tab to its right becomes active
  await typeAddress(PAGE + 'slow?ms=4000');
  await wait(() => view() && view().webContents.isLoading(), 'the tab is loading');
  const slowWc = view().webContents;
  const order = tabs().tabs.map((x) => x.tabId);
  const i = order.indexOf(tabs().active);
  const wantNext = order[i + 1] || order[i - 1];
  await wait(() => js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return !!e&&e.dataset.tab===${jsLiteral(tabs().active)}})()`), 'the strip shows the loading tab');
  await js(`document.querySelector('#bTabs .btab.on .btab-x').click()`);
  await wait(() => count() === 9 && tabs().active === wantNext, 'closed; the next tab is active (US6.6)');
  await wait(() => slowWc.isDestroyed(), 'the loading tab\'s view is gone');
  console.log('[browser-tabs] US6.6 ok');

  // US6.12: the strip's keys. The strip must show main's 9 tabs and the new active tab first: read earlier it still lists the tab just closed, and
  // Home would name a tab that is gone (issue #934 family: a value read before the window caught up; seen as "Home moves the focus to the first tab").
  await wait(() => js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return document.querySelectorAll('#bTabs .btab').length===9&&!!e&&e.dataset.tab===${jsLiteral(wantNext)}&&!document.querySelector('#bTabs [data-tab=${jsLiteral(order[i])}]')})()`), 'the strip shows the 9 tabs and the tab after the closed one');
  await js(`document.querySelector('#bTabs .btab.on .btab-b').focus()`);
  let st = await stripTabs();
  const sel0 = st.findIndex((x) => x.sel === 'true');
  assert.ok(st.every((x) => x.of === String(st.length)) && st[sel0].pos === String(sel0 + 1), 'tab N of M (aria-posinset, aria-setsize)');
  assert.strictEqual(st.filter((x) => x.ti === 0).length, 1, 'one tab stop');
  await H.key('Home', [], { char: 'never' });
  await wait(() => js(`document.activeElement&&document.activeElement.id==='btab-'+${jsLiteral(st[0].id)}`), 'Home moves the focus to the first tab');
  await H.key('Right', [], { char: 'never' });
  await wait(() => js(`document.activeElement&&document.activeElement.id==='btab-'+${jsLiteral(st[1].id)}`), 'ArrowRight moves the focus');
  assert.strictEqual(tabs().active, wantNext, 'moving the focus selects nothing');
  await H.key('Return');
  await wait(() => tabs().active === st[1].id, 'Enter selects');
  await wait(() => js(`document.activeElement&&document.activeElement.id==='btab-'+${jsLiteral(st[1].id)}&&document.querySelector('#bTabs .btab.on')===document.activeElement.parentElement`), 'the focus stays on the selected tab after the strip is redrawn');
  await H.key('End', [], { char: 'never' });
  await wait(() => js(`document.activeElement&&document.activeElement.id==='btab-'+${jsLiteral(st[st.length - 1].id)}`), 'End');
  await H.key('Space', [], { char: 'always' });
  await wait(() => tabs().active === st[st.length - 1].id, 'Space selects');
  await H.key('Delete', [], { char: 'never' });
  await wait(() => count() === 8, 'Delete closes the focused tab');
  st = await stripTabs();
  await wait(() => js(`document.activeElement&&document.activeElement.closest('.btab.on')&&document.activeElement.classList.contains('btab-b')`), 'closed from the strip by keyboard: the focus is on the newly active tab (FR-129)');
  console.log('[browser-tabs] US6.12 ok');

  // US6.11: the tab keys inside a page never reach it
  await go(PAGE + 'keys');
  await inView(`document.getElementById('k').focus()`);
  const keysTab = tabs().active;
  const n0 = count();
  await pageKey('T', [MOD]);
  await wait(() => count() === n0 + 1, 'Ctrl/Cmd+T in the page opens a tab');
  await wait(() => js(`document.activeElement&&document.activeElement.id==='bAddr'`), 'and focuses the new tab\'s address field (FR-129)');
  await js(`(async()=>{await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(keysTab)});return true})()`);
  await wait(() => tabs().active === keysTab && view() && view().webContents.getURL() === PAGE + 'keys', 'the keys page again');
  await inView(`document.getElementById('k').focus()`);
  await pageKey('Tab', ['control']);
  await wait(() => tabs().active !== keysTab, 'Ctrl+Tab in the page switches tabs');
  const afterTab = tabs().active;
  await js(`(async()=>{await window.agentDurbar.browserSelectTab('sim-1',${jsLiteral(keysTab)});return true})()`);
  await wait(() => tabs().active === keysTab && view() && view().webContents.getURL() === PAGE + 'keys', 'the keys page again');
  await inView(`document.getElementById('k').focus()`);
  await pageKey('a', []); // the precondition: an ordinary key does reach the page
  await wait(() => inView(`document.getElementById('log').textContent.includes('a')`), 'the page logs its own keys');
  const log = await inView(`document.getElementById('log').textContent`);
  assert.ok(!/(C-|M-)(t|T|Tab|w|W)\b/.test(log), 'the page never saw the tab keys: ' + log);
  const n1 = count();
  await pageKey('W', [MOD]);
  await wait(() => count() === n1 - 1 && !tabs().tabs.some((x) => x.tabId === keysTab), 'Ctrl/Cmd+W in the page closes its tab');
  // the bar's own keys (the window's handler): Ctrl+Tab and Ctrl+Shift+Tab
  await js(`document.getElementById('bAddr').focus()`);
  const a0 = tabs().active;
  await H.key('Tab', ['control'], { char: 'never' });
  await wait(() => tabs().active !== a0, 'Ctrl+Tab in the bar');
  // the window works out "previous" from the tab list it last received, so the strip must show main's new active tab before the next key (issue #934)
  const a1 = tabs().active;
  await wait(() => js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return !!e&&e.dataset.tab===${jsLiteral(a1)}})()`), 'the strip shows the tab Ctrl+Tab chose');
  await H.key('Tab', ['control', 'shift'], { char: 'never' });
  await wait(() => tabs().active === a0, 'Ctrl+Shift+Tab back');
  assert.ok(afterTab);
  // anywhere else the keys keep their meaning: Ctrl+W in the composer closes no tab
  await toChat();
  const n2 = count();
  await js(`document.getElementById('msgInput').focus()`);
  // Windows and Linux have no app menu (spec 052 FR-083, appmenu.ts), so nothing there binds Ctrl+W: pressed here it must close no tab and
  // no window. On a Mac Cmd+W is the menu's Close Window (it hides the window, the old behaviour; FR-130 [KNOWN GAP]), so it is not pressed.
  // A closed window fails the driver at once: the shared helpers guard every driver's window (spec 008 FR-136, issue #922).
  const w0 = win();
  if (!IS_MAC) await H.key('W', ['control'], { char: 'never' });
  await toBrowser(); // the precondition: the browser still answers, and nothing was closed
  await wait(() => count() === n2 && tabs().tabs.length === n2, 'Ctrl+W outside the Browser tab closed no tab');
  // A close destroys the window on Windows and Linux (it only hides on a Mac, appmenu.ts hideOnClose), so not destroyed is the check there.
  // isVisible() is not: on the Windows CI runner it is false for this window even when no key was pressed (run 41191186758, 2026-10-31).
  const winState = w0.isDestroyed() ? 'destroyed' : `visible=${w0.isVisible()} minimized=${w0.isMinimized()}`;
  assert.ok(!w0.isDestroyed() && !w0.webContents.isDestroyed() && (process.platform === 'win32' || w0.isVisible()), 'and the window is still there: ' + winState);
  console.log('[browser-tabs] US6.11 ok');

  // US6.10 and the cap: six pages in this session's tabs; at most four stay loaded; a dropped background tab has no view and comes back
  while (count() > 1) await closeActive();
  // US6.7: the last tab closed
  const last = tabs().active;
  await wait(() => js(`(()=>{const e=document.querySelector('#bTabs .btab.on');return !!e&&e.dataset.tab===${jsLiteral(last)}})()`), 'the strip shows the last tab');
  await js(`document.querySelector('#bTabs .btab.on .btab-x').click()`);
  await wait(() => count() === 1 && tabs().active !== last, 'the last tab closed: one new tab');
  await wait(() => attached().length === 0, 'with no view (FR-004)');
  await wait(() => js(`document.querySelector('#bTabs .btab.on .btab-t').textContent==='New tab'`), 'named New tab'); // FR-048b: the strip redraws after the tab has closed
  await wait(() => js(`document.activeElement&&document.activeElement.id==='bAddr'`), 'the address field is focused');
  console.log('[browser-tabs] US6.7 ok');
  const pages = ['links', 'form', 'index', 'getform', 'storage', 'file'];
  for (let k = 0; k < pages.length; k++) {
    if (k > 0) {
      const n = count();
      await js(`document.getElementById('bNewTab').click()`);
      await wait(async () => count() === n + 1 && (await js(`document.activeElement&&document.activeElement.id==='bAddr'&&document.getElementById('bAddr').value===''`)), '+ (and the window has focused the new tab\'s empty address field)');
    }
    await go(PAGE + pages[k]);
    const live = allViews().filter((w) => w.getURL().startsWith(PAGE)).length;
    assert.ok(live <= 4, `never more than four pages loaded (${live} after ${pages[k]})`);
  }
  const dropped = tabs().tabs.filter((x) => x.memory === 'dropped');
  assert.ok(dropped.length >= 2, 'background tabs were dropped: ' + JSON.stringify(tabs().tabs.map((x) => [x.url, x.memory])));
  const pick = dropped.find((x) => x.url !== PAGE + 'links') || dropped[0]; // the links tab stays dropped for the reuse check below
  assert.ok(!allViews().some((w) => w.getURL() === pick.url), 'a dropped background tab has no view (its webContents is closed)');
  await js(`document.querySelector('#bTabs [data-tab="'+${jsLiteral(pick.tabId)}+'"] .btab-b').click()`);
  await wait(() => tabs().active === pick.tabId && view() && view().webContents.getURL() === pick.url, 'selecting it reloads its address');
  await wait(() => js(`/Reloaded to save memory/.test(document.getElementById('bNote').textContent)`), 'with Reloaded to save memory (US6.10)');
  // reuse while dropped: the links page was the first and is dropped again or still dropped
  const linksTab = tabs().tabs.find((x) => x.url === PAGE + 'links');
  if (linksTab && linksTab.memory === 'dropped' && linksTab.tabId !== tabs().active) {
    const n = count();
    await toChat();
    assert.ok(await clickLink('the links page'));
    await wait(() => tabs().active === linksTab.tabId && view() && view().webContents.getURL() === PAGE + 'links', 'a chat link to a dropped tab\'s address focuses and reloads it');
    assert.strictEqual(count(), n, 'no tab added');
  } else assert.fail('the links tab (the oldest) should still be dropped: ' + JSON.stringify(tabs().tabs.map((x) => [x.url, x.memory])));
  console.log('[browser-tabs] US6.9/US6.10 ok');

  // FR-130: the keyboard shortcut sheet lists the Browser tab's keys
  await js(`document.getElementById('kbdHelpBtn').click()`);
  await wait(() => js(`!!document.getElementById('kbdDlg')`), 'the shortcut sheet');
  const sheet = await js(`document.getElementById('kbdDlg').innerText`);
  assert.ok(/In the Browser tab/.test(sheet) && /New page tab/.test(sheet) && /Close the page tab/.test(sheet) && /Next page tab/.test(sheet), 'the sheet has the tab keys');
  await js(`document.getElementById('kbdClose').click()`);
  await wait(() => js(`!document.getElementById('kbdDlg')`), 'the sheet closes');

  // US6.8: the session ends with several tabs: every view goes, no process of any tab is left
  const mine = allViews().filter((w) => w.getURL().startsWith(PAGE));
  assert.ok(mine.length >= 2, 'several tabs with views');
  const pids = mine.map((w) => w.getOSProcessId());
  await ctx.browserGone('sim-1');
  await wait(() => mine.every((w) => w.isDestroyed()), 'every tab\'s view is destroyed');
  await wait(() => { const live = new Set(app.getAppMetrics().map((m) => m.pid)); return pids.every((p) => !live.has(p)); }, 'no process of any tab is left (SC-004)', 15000);
  assert.deepStrictEqual(tabs().tabs, [], 'the session has no tabs left');
  server.close();
  console.log(`[browser-tabs] US6.8 ok; all checks passed at ${size}`);
};
