/*
 * Check for spec 080 T015 AC6 (FR-025d, FR-025e; owner decisions Q1-Q3), issue #556: the once-per-app consent, the *Leave this page?* box,
 * and a hidden session's page dialog (toast, chat brought forward once, the *Dialog open* marker). Simulator only (no AI credits); run with
 * DURBAR_SIM_BROWSER_CONSENT=ask so the simulator asks the consent like the app does (it counts as accepted otherwise).
 *
 *   npm run check:ui -- --only check-browser-dialogs   (1440x900; the suite also runs it at 1280x800)
 *
 *   1. the first Browser tab asks (text, buttons); Not now (and Esc) keep the Chat tab, create no view and write nothing; Open the browser
 *      opens it, is remembered in the settings file and is not asked again;
 *   2. beforeunload page, navigation started by main (address bar): Durbar's box, Stay focused; Stay keeps the page; Leave leaves;
 *   3. beforeunload page, a link clicked in the page: the box says *Leave, then click again*; Leave does not leave by itself, the next click does;
 *   4. an alert in a session whose chat is not shown: the toast names the session (page text masked), its chat comes forward on its Browser
 *      tab, the marker shows on its strip item and Browser tab until the dialog closes; a second alert while the user is elsewhere gives
 *      the toast and the marker only; after the user opens that chat themselves, it may bring itself forward again.
 * A native alert is answered through the view's debugger (the driver stands in for the person). A miss prints DRIVER FAILED.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const SIM_URL = (name) => 'durbar-sim://pages/' + name;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { app } = require('electron');
  const OUT = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-browser-dialogs-'));
  fs.mkdirSync(OUT, { recursive: true });
  const win = () => ctx.win;
  const views = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => views()[0];
  const inView = (code) => view().webContents.executeJavaScript(code, true);
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
  const settingsFile = path.join(app.getPath('userData'), 'durbar-settings.json');
  const accepted = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).browserNoteAccepted === true; } catch { return false; } };
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const dlg = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg');return d?{title:d.querySelector('h3').textContent,body:d.querySelector('.dsub').textContent,lines:[...d.querySelectorAll('.dlist li')].map(x=>x.textContent),buttons:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent),focus:document.activeElement&&document.activeElement.textContent}:null})()`);
  const noDlg = () => js(`!document.querySelector('#modeDlg')`);
  const selected = () => js(`(document.querySelector('#stripList .sitem.sel')||{dataset:{}}).dataset.sw||''`);
  const tabSel = () => js(`document.getElementById('tabBrowser')&&document.getElementById('tabBrowser').getAttribute('aria-selected')==='true'`);
  const clickStrip = (id) => js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(id)})+'"]').click()`);
  let nativeOwner;
  const dismissNative = () => nativeOwner.webContents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false });
  /** A click inside the page (view coordinates): it gives the page the user activation a beforeunload handler needs. */
  const clickInPage = async (sel) => {
    const r = await inView(`(()=>{const b=document.querySelector(${jsLiteral(sel)}).getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    const wc = view().webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  };

  const [W, Hh] = (process.env.BROWSER_DIALOGS_SIZE || '1440x900').split('x').map(Number); // the suite runs it at both sizes (BROWSER_DIALOGS_SIZE=1280x800)
  const A = 'sim-1', B = 'sim-2';
  await H.load({ w: W, h: Hh, ready: 'fit', focus: true });
  const o = await H.openSimAgent(`a=>a.id===${jsLiteral(A)}`, '#panelTabs');
  assert.ok(o.ok, 'the chat of the first simulated agent is open: ' + JSON.stringify(o.seen));
  await H.settle();

  // 1. consent
  await js(`document.getElementById('tabBrowser').click()`);
  const c = await wait(dlg, 'the first Browser tab asks');
  assert.strictEqual(c.title, 'Open the session browser?');
  for (const w of [/private browser/, /wiped when the session ends/, /system boxes/, /brings its chat forward/, /once/]) assert.ok(w.test(c.body), `the note says ${w}: ${c.body}`);
  assert.deepStrictEqual(c.buttons, ['Not now', 'Open the browser'], 'the two buttons');
  assert.strictEqual(views().length, 0, 'no view while the question is open');
  await ctx.sleep(250);
  await H.shot(path.join(OUT, `080-browser-consent-${W}x${Hh}.png`), { prep: 'calm', delay: 250 });
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Not now'));
  await wait(noDlg, 'the dialog closes');
  assert.strictEqual(await tabSel(), false, 'Not now keeps the Chat tab');
  assert.strictEqual(await js(`document.getElementById('browserPane').hidden`), true);
  assert.strictEqual(views().length, 0, 'Not now makes no view');
  assert.strictEqual(accepted(), false, 'Not now writes nothing');
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(dlg, 'asked again after Not now');
  await H.key('Escape', [], { char: 'never' });
  await wait(noDlg, 'Esc closes it');
  assert.strictEqual(await tabSel(), false, 'Esc is Not now');
  assert.strictEqual(views().length, 0);
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(dlg, 'asked a third time');
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Open the browser'));
  await wait(() => views().length === 1, 'Open the browser opens the tab');
  assert.ok(await tabSel());
  await wait(() => accepted(), 'the answer is remembered in the settings file');
  await js(`document.getElementById('tabChat').click()`);
  await wait(() => views().length === 0, 'Chat tab detaches');
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(() => views().length === 1, 'the tab opens again');
  await ctx.sleep(300);
  assert.ok(await noDlg(), 'never asked again');
  console.log('[browser-dialogs] consent ok');

  // 2. Leave this page?, a navigation main started
  await typeAddress(SIM_URL('unload'));
  await wait(() => view().webContents.getURL() === SIM_URL('unload'), 'the unload page loads');
  await clickInPage('#draft');
  await ctx.sleep(200);
  await typeAddress(SIM_URL('index'));
  const l1 = await wait(dlg, 'Leave this page? asks');
  assert.strictEqual(l1.title, 'Leave this page?');
  assert.ok(/Changes you made may not be saved/.test(l1.body));
  assert.deepStrictEqual(l1.buttons, ['Stay', 'Leave']);
  assert.strictEqual(l1.focus, 'Stay', 'Stay has the focus');
  assert.deepStrictEqual(l1.lines, [], 'the target is known: no "click again" line');
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Stay'));
  await wait(noDlg, 'Stay closes the box');
  await ctx.sleep(500);
  assert.strictEqual(view().webContents.getURL(), SIM_URL('unload'), 'Stay keeps the page');
  await typeAddress(SIM_URL('index'));
  await wait(dlg, 'asks again');
  await ctx.sleep(300); // a person is never instant (T007: an instant Leave is a known gap)
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Leave'));
  await wait(() => view().webContents.getURL() === SIM_URL('index'), 'Leave leaves (main repeats its own navigation)', 10000);
  console.log('[browser-dialogs] leave (address bar) ok');

  // 3. Leave this page?, a link clicked in the page: the target is not known
  await typeAddress(SIM_URL('unload'));
  await wait(() => view().webContents.getURL() === SIM_URL('unload'), 'the unload page again');
  await clickInPage('#draft');
  await ctx.sleep(200);
  await clickInPage('a[href="/index"]');
  const l2 = await wait(dlg, 'Leave this page? asks for a link in the page');
  assert.deepStrictEqual(l2.lines, ['Leave, then click again.'], 'the unknown target says so');
  await ctx.sleep(300);
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Leave'));
  await wait(noDlg, 'the box closes');
  await ctx.sleep(600);
  assert.strictEqual(view().webContents.getURL(), SIM_URL('unload'), 'a page-started leave does not repeat by itself');
  await clickInPage('a[href="/index"]');
  await wait(() => view().webContents.getURL() === SIM_URL('index'), 'the next click within 10 s goes through (the leave flag)', 10000);
  console.log('[browser-dialogs] leave (link) ok');

  // 4. a hidden session's page dialog
  const viewA = view();
  nativeOwner = viewA;
  await typeAddress(SIM_URL('alert?ms=1500&n=2&html=1'));
  await wait(() => viewA.webContents.getURL().startsWith(SIM_URL('alert')), 'the alert page loads');
  const nameA = await js(`document.querySelector('#panelTitle').textContent`);
  await clickStrip(B);
  await wait(async () => (await selected()) === B, 'session B is open');
  assert.strictEqual(views().length, 0, 'B is on its Chat tab: no view');
  // the alert comes in A's hidden view: toast, A's chat forward on its Browser tab, the marker
  const toastText = await wait(() => js(`(()=>{const t=[...document.querySelectorAll('#toasts .toast')].find(x=>/is asking/.test(x.textContent));return t?t.textContent:''})()`), 'the toast for the hidden dialog', 15000);
  assert.ok(toastText.includes('A page in') && toastText.includes(nameA) && /Delete item 1\?/.test(toastText), 'the toast names the session and shows the page text: ' + toastText);
  assert.ok(toastText.includes('<img src=x') && !(await js(`!!document.querySelector('#toasts .toast img')||window.__pwn===1`)), 'markup in the page text is plain text in the toast, never HTML: ' + toastText);
  assert.ok(!/A1b2A1b2/.test(toastText) && !/gh[p]_/.test(toastText), 'the page text is masked in the toast: ' + toastText);
  await wait(async () => (await selected()) === A && (await tabSel()), "the session's chat comes forward on its Browser tab");
  await wait(() => views().length === 1 && view() === viewA, "A's view is shown next to its chat");
  await wait(() => js(`document.getElementById('tabBrowser').textContent.includes('Dialog open')`), 'the Browser tab says Dialog open');
  await wait(() => js(`!!document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(A)})+'"] .dlg-mark')`), 'the marker is on the session in the strip');
  await dismissNative();
  await wait(async () => !(await js(`document.getElementById('tabBrowser').textContent.includes('Dialog open')||!!document.querySelector('.dlg-mark')`)), 'the marker goes when the dialog closes');
  // the user goes elsewhere; the second alert gives the toast only
  await clickStrip(B);
  await wait(async () => (await selected()) === B, 'back on B');
  await wait(() => js(`[...document.querySelectorAll('#toasts .toast')].filter(x=>/is asking/.test(x.textContent)).length>=1&&[...document.querySelectorAll('#toasts .toast')].some(x=>/item 2/.test(x.textContent))`), 'the second alert raises its toast', 15000);
  await ctx.sleep(1500);
  assert.strictEqual(await selected(), B, 'the second dialog does not switch the chat again');
  await wait(() => js(`!!document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(A)})+'"] .dlg-mark')`), 'but the marker shows');
  await dismissNative();
  await wait(() => js(`!document.querySelector('.dlg-mark')`), 'marker gone');
  // the user comes back to A themselves: it may bring itself forward again
  await clickStrip(A);
  await wait(async () => (await selected()) === A, 'A opened by the user');
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(() => views().length === 1, 'A on its Browser tab');
  await typeAddress(SIM_URL('alert?ms=800&n=1'));
  await wait(() => view().webContents.getURL().startsWith(SIM_URL('alert')), 'the alert page loads again');
  await clickStrip(B);
  await wait(async () => (await selected()) === B, 'B again');
  await wait(async () => (await selected()) === A && (await tabSel()), 'after the user came back, the next dialog brings A forward again', 15000);
  await dismissNative();
  await wait(() => js(`!document.querySelector('.dlg-mark')`), 'marker gone at the end');
  // a hidden dialog brings its chat forward while a Durbar dialog is open: the view stays off while it is, and is back (no stale picture) after
  await clickStrip(B);
  await wait(async () => (await selected()) === B, 'B before the overlay case');
  await clickStrip(A); // the user opens A themselves: it may pull again
  await wait(async () => (await selected()) === A, 'A opened by the user');
  await js(`document.getElementById('tabBrowser').click()`);
  await wait(() => views().length === 1, 'A on its Browser tab');
  await typeAddress(SIM_URL('alert?ms=1500&n=1'));
  await wait(() => viewA.webContents.getURL().includes('n=1'), 'the alert page loads for the overlay case');
  await clickStrip(B);
  await wait(async () => (await selected()) === B, 'B for the overlay case');
  await js(`void window.DurbarDialog(document)({title:'Still open',body:'x',buttons:[{label:'Close',value:null}]});0`);
  await wait(async () => (await selected()) === A && (await tabSel()), 'the dialog pulls A forward under the open question', 15000);
  await wait(() => views().length === 0, 'the view comes off while the question is open', 6000);
  for (let i = 0; i < 10; i++) { assert.strictEqual(views().length, 0, 'and stays off while the question is open (no flash)'); await ctx.sleep(100); }
  await dismissNative();
  assert.ok(await H.clickText('#modeDlg .dbtn button', 'Close'));
  await wait(() => views().length === 1 && view() === viewA, 'the view is back when the question closes');
  await wait(() => js(`!document.getElementById('bShot')`), 'no stale picture');
  await ctx.sleep(400);
  assert.strictEqual(views().length, 1, 'and it stays');
  // a shown view's own dialog raises no toast (its chat is open): only the marker
  await H.clearToasts();
  await typeAddress(SIM_URL('alert?ms=800&n=1'));
  await wait(() => js(`!!document.getElementById('tabBrowser').textContent.includes('Dialog open')`), 'a shown view: the marker', 15000);
  await ctx.sleep(500);
  assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].filter(x=>/is asking/.test(x.textContent)).length`), 0, 'a shown view raises no toast');
  await dismissNative();
  console.log('[browser-dialogs] hidden dialog ok');
  console.log('[browser-dialogs] all checks passed; pictures in ' + OUT);
};
