/*
 * Check for spec 080 T013 AC3 and AC4 (FR-011, issue #556): the soft cap on loaded pages (MAX_LIVE_VIEWS = 4). Simulator only (no AI credits,
 * no network: the simulator's own test pages). Memory is NOT measured here (T013 AC5 and AC6 stay open).
 *
 *   npm run check:ui -- --only check-browser-cap        (default: AC3)
 *   BROWSER_CAP_MODE=typing ... check-browser-cap        (AC4)
 *
 * AC3: six sessions open a page each (no forms, no typing). After the sixth, four are loaded and the two least recently shown (sessions 1 and 2) were
 *      dropped (their address is kept); showing session 1 again reloads it with "Reloaded to save memory" in its bar, and still four are loaded.
 * AC4: the same six, but after each of the first five loads a character is typed into its page. None of those five is dropped; the sixth loads over the
 *      cap and its bar says "Many pages are open; close some to save memory.". (AC3 is the control: the same sequence without typing drops pages.)
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const PAGE = 'durbar-sim://pages/';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const typing = process.env.BROWSER_CAP_MODE === 'typing';
  const win = () => ctx.win;
  const views = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => views()[0];
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
  const states = () => ctx.browserStates();
  const loaded = () => states().filter((s) => s.open && s.url !== '').map((s) => s.id).sort();
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const openBrowser = async (n) => {
    const id = 'sim-' + n;
    if (n === 1) {
      const o = await H.openSimAgent(`a=>a.id===${jsLiteral(id)}`, '#panelTabs');
      assert.ok(o.ok, 'chat of ' + id + ' open: ' + JSON.stringify(o.seen));
    } else {
      await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(id)})+'"]').click()`);
      await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(id)}`), id + ' open');
    }
    await js(`document.getElementById('tabBrowser').click()`);
    await wait(() => views().length === 1, id + ' browser attached');
    return id;
  };

  await H.load({ w: 1440, h: 900, ready: 'fit', focus: true });
  assert.deepStrictEqual(states(), [], 'precondition: no browser exists yet');

  for (let n = 1; n <= 6; n++) {
    const id = await openBrowser(n);
    if (typing && n <= 5) {
      // a page with a text field; a click gives it focus and real key events reach the page (and the view's input-event)
      await typeAddress(PAGE + 'fields');
      await wait(() => view().webContents.getURL() === PAGE + 'fields', id + ' fields page');
      await wait(() => view().webContents.executeJavaScript(`!!document.getElementById('name')&&document.readyState==='complete'`, true), id + ': the field exists');
      const r = await view().webContents.executeJavaScript(`(()=>{const b=document.getElementById('name').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`, true);
      const wc = view().webContents;
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      for (const ch of 'ab') { wc.sendInputEvent({ type: 'keyDown', keyCode: ch }); wc.sendInputEvent({ type: 'char', keyCode: ch }); wc.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
      await wait(async () => (await wc.executeJavaScript(`document.getElementById('name').value`, true)) === 'ab', id + ': the typed characters reached the page');
    } else {
      await typeAddress(PAGE + 'links');
      await wait(() => view().webContents.getURL() === PAGE + 'links', id + ' links page');
    }
    await wait(() => states().some((x) => x.id === id && x.url !== '' && !x.loading), id + ': its page finished loading');
    await js(`document.getElementById('tabChat').click()`);
    await wait(() => views().length === 0, id + ' chat tab');
    { const t0 = Date.now(); await wait(() => Date.now() > t0 + 1, 'the clock moved on'); } // the least-recently-shown order needs distinct millisecond stamps
  }

  if (!typing) {
    // AC3
    await wait(() => loaded().length === 4, 'four are loaded');
    assert.deepStrictEqual(loaded(), ['sim-3', 'sim-4', 'sim-5', 'sim-6'], 'the two least recently shown were dropped');
    assert.strictEqual(states().length, 6, 'all six browsers still exist (address and partition kept)');
    await js(`document.querySelector('#stripList [data-sw="sim-1"]').click()`);
    await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw==='sim-1'`), 'sim-1 open again');
    await js(`document.getElementById('tabBrowser').click()`);
    await wait(() => views().length === 1 && view().webContents.getURL() === PAGE + 'links', 'sim-1 reloads its page');
    await wait(() => js(`/Reloaded to save memory/.test((document.getElementById('bNote')||{}).textContent||'')`), 'the bar says it was reloaded to save memory');
    assert.strictEqual(loaded().length, 4, 'still four loaded after the reload');
    assert.ok(loaded().includes('sim-1'));
    console.log('[browser-cap] AC3 ok');
  } else {
    // AC4
    await wait(() => ['sim-1', 'sim-2', 'sim-3', 'sim-4', 'sim-5', 'sim-6'].every((id) => loaded().includes(id)), 'none of the six was dropped: ' + JSON.stringify(loaded()));
    await wait(() => (states().find((x) => x.id === 'sim-6') || {}).memory === 'many', 'the sixth is over the cap and says so');
    await js(`document.querySelector('#stripList [data-sw="sim-6"]').click()`);
    await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw==='sim-6'`), 'sim-6 open');
    await js(`document.getElementById('tabBrowser').click()`);
    await wait(() => js(`/Many pages are open; close some to save memory/.test((document.getElementById('bNote')||{}).textContent||'')`), 'its bar says so');
    console.log('[browser-cap] AC4 ok');
  }
  console.log('[browser-cap] all checks passed');
};
