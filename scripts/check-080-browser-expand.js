/*
 * Check for spec 080 FR-134..FR-139 (issue #1691, tasks T080-T082): the session browser's Expand control. The simulator only: no agent
 * session, no account, no AI credits, no network beyond the simulator's own `durbar-sim:` pages.
 *
 *   npm run check:ui -- --only check-080-browser-expand                    (Flat, both sizes)
 *   EXPAND_WORLD=real ...                                                 (the Photo office: officeview=real)
 *   DRIVER_WORLD=retro EXPAND_WORLD=real ...                              (the Retro arcade)
 *   EXPAND_SIZE=1280x800 runs one size only (a quick mutation run; the suite runs both)
 *   SHOTS_DIR=<folder> keeps the pictures (080-browser-expand-<small|big>-<world>-<w>x<h>.png)
 *
 * At 1440x900 and 1280x800 it fails, each at its labelled assertion, when:
 *   - the bar's last control is not the Expand button with its names (FR-134);
 *   - "expand does not fill": the big pane is not the chat panel's box, or the panel is not the window's content minus the notice strips (FR-135);
 *   - the native view is not on the page area after either change (FR-003, FR-138), an overlay over the big page does not take the view off (FR-008);
 *   - "restore forgets": Back to small browser or Escape does not give back the small rectangle (FR-136);
 *   - "focus not returned": the focus is not on Expand browser after a restore (FR-136);
 *   - "Escape steals from the page": Escape typed in the page does not reach the page, or makes the browser small (FR-136);
 *   - a Durbar menu over the big page does not close first with Escape (FR-136);
 *   - "state persisted": another chat, the Chat tab or a reload does not start small, or anything is written to localStorage (FR-137);
 *   - the draft in the message box is lost; text under 10.5px; the page or the panel scrolls (FR-135, FR-139).
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral, shotWithView: shotWithViewOf } = require('./driver-helpers');

const PAGE = 'durbar-sim://pages/';
const WORLD = process.env.EXPAND_WORLD === 'real' ? 'real' : 'flat';
const TAG_WORLD = WORLD === 'flat' ? 'flat' : process.env.DRIVER_WORLD === 'retro' ? 'retro' : 'photo';
const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const OUT = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-080-expand-'));
  fs.mkdirSync(OUT, { recursive: true });
  const win = () => ctx.win;
  const views = () => win().contentView.children.filter((v) => v.webContents && v.webContents !== win().webContents);
  const view = () => views()[0];
  const inView = (code) => view().webContents.executeJavaScript(code, true);
  const viewUrl = () => (view() ? view().webContents.getURL() : '');
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
  /** Wait for a change, but let the labelled assertion after it name a miss (a mutant then fails at its own label, not at a timeout). */
  const soft = async (fn, ms = 3000) => { try { await wait(fn, '', ms); } catch (e) { /* the assertion that follows says what is wrong */ } };
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const go = async (url) => { await typeAddress(url); await wait(() => viewUrl() === url && !view().webContents.isLoading(), 'loads ' + url); };
  const big = () => js(`document.body.classList.contains('browser-big')`);
  /** Everything the checks read, in one settled page task. */
  const geo = () => js(`(()=>{const R=e=>{if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
    const q=s=>document.querySelector(s);const vis=e=>!!e&&e.getClientRects().length>0;
    const notes=[...document.querySelectorAll('.notice-strip')].filter(vis).map(e=>e.getBoundingClientRect().bottom);
    const answers=[...document.querySelectorAll('#panel .answer-bar')].filter(e=>!e.hidden&&vis(e)).map(e=>e.getBoundingClientRect().top);
    const b=q('#bBig');
    return {pane:R(q('#browserPane')),view:R(q('#bView')),panel:R(q('#panel')),W:innerWidth,Hh:innerHeight,noticeBottom:notes.length?Math.max(...notes):0,answerTop:answers.length?Math.min(...answers):null,
      hidden:{rail:!vis(q('#panel>.rail')),head:!vis(q('#panel .ph')),tabs:!vis(q('#panelTabs')),composer:!vis(q('#panel .composer'))},
      btn:b?{label:b.getAttribute('aria-label'),title:b.title,pressed:b.hasAttribute('aria-pressed'),svg:!!b.querySelector('svg'),last:b.parentElement.lastElementChild===b,inBar:!!b.closest('.bbar[role=toolbar]')}:null,
      focus:document.activeElement?(document.activeElement.id||document.activeElement.className):'',
      scroll:{doc:document.scrollingElement.scrollHeight>innerHeight+1||document.scrollingElement.scrollWidth>innerWidth+1,panel:q('#panel').scrollHeight>q('#panel').clientHeight+1||q('#panel').scrollWidth>q('#panel').clientWidth+1}};})()`);
  const near = (a, b, d) => Math.abs(a - b) <= d;
  const sameRect = (a, b, d) => !!a && !!b && near(a.x, b.x, d) && near(a.y, b.y, d) && near(a.w, b.w, d) && near(a.h, b.h, d);
  /** The native view sits on the page area (FR-003): within 2 px, as check-browser-tab. */
  const onArea = async (label) => {
    await wait(async () => { const g = await geo(); const v = view(); if (!v) return false; const b = v.getBounds(); return sameRect(g.view, { x: b.x, y: b.y, w: b.width, h: b.height }, 2); }, label);
  };
  const textSizes = () => js(`(()=>{const out=[];for(const e of document.querySelectorAll('#browserPane *')){if(!e.getClientRects().length)continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(t||e.placeholder)out.push([e.id||e.className,parseFloat(getComputedStyle(e).fontSize)]);}return out})()`);
  /** Before a picture: the pointer off the controls (xvfb rests it mid-window), the start-up toasts hidden, no focus ring. */
  const calm = async () => { win().webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(120); await H.calm({ blur: true }); await ctx.sleep(200); };
  const shot = (file) => shotWithViewOf(win(), view(), path.join(OUT, file));
  const openChat = async (id) => {
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
    await wait(() => js(`document.body.classList.contains('panel-open')&&!!document.getElementById('panelTabs')&&document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(id)}`), 'the chat of ' + id + ' is open with its tabs', 15000);
  };
  const toBrowser = async () => {
    await js(`document.getElementById('tabBrowser').click()`);
    await wait(() => views().length === 1, 'the Browser tab attaches the view');
  };
  const pageKey = async (keyCode) => {
    const wc = view().webContents;
    assert.ok(await H.focusWc(wc), 'the page has the focus before its key');
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  };

  let round = 0;
  const SIZES = /^\d{3,4}x\d{3,4}$/.test(process.env.EXPAND_SIZE || '') ? [process.env.EXPAND_SIZE.split('x').map(Number)] : [[1440, 900], [1280, 800]]; // one size for a quick mutation run
  for (const [w, h] of SIZES) {
    const tag = `${TAG_WORLD} ${w}x${h}`, file = `${TAG_WORLD}-${w}x${h}`;
    await H.load({ w, h, ready: WORLD === 'flat' ? 'fit' : REAL, settle: WORLD === 'flat', focus: true, query: WORLD === 'flat' ? undefined : { officeview: 'real' } });
    if (WORLD !== 'flat') await H.settle();
    /* two live main sessions without a question (an answer bar would sit under the page; FR-135 keeps it, checked by the rule, not needed here) */
    const ids = await js(`(()=>{const all=window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent);return all.map(a=>a.id)})()`);
    assert.ok(ids.length >= 4, `${tag}: the simulator has live main sessions: ${JSON.stringify(ids)}`);
    const idA = ids[2 * round], idB = ids[2 * round + 1];
    round++;
    await openChat(idA);
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='a draft kept while the browser is big';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await toBrowser();
    await go(PAGE + 'links');
    await onArea(`${tag}: small: the view is on the page area`);
    await H.clearToasts();
    const small = await geo();

    // FR-134: the control
    assert.deepStrictEqual(small.btn, { label: 'Expand browser', title: 'Expand browser: fill the window', pressed: false, svg: true, last: true, inBar: true }, `${tag}: Expand browser is the browser toolbar's last control: ${JSON.stringify(small.btn)}`);
    assert.strictEqual(await big(), false, `${tag}: the browser starts small`);
    await calm();
    await shot(`080-browser-expand-small-${file}.png`);

    // FR-135: Expand fills the chat panel; the panel is the window's content below the notice strips. FR-137: around this first click
    // nothing else runs, so any localStorage entry that appears or changes is the big state being remembered
    const snap = () => js(`(()=>{try{return Object.keys(localStorage).sort().map(k=>k+'='+localStorage.getItem(k));}catch(e){return ['unreadable']}})()`);
    const before = await snap();
    await js(`document.getElementById('bBig').click()`);
    await soft(async () => (await big()) && !sameRect((await geo()).view, small.view, 1));
    const g1 = await geo();
    const added = (await snap()).filter((x) => !before.includes(x)).map((x) => x.slice(0, 120));
    assert.deepStrictEqual(added, [], tag + ': state persisted: Expand writes nothing to localStorage');
    const bottom = g1.answerTop === null ? g1.Hh : g1.answerTop;
    assert.ok(sameRect(g1.pane, { x: g1.panel.x, y: g1.panel.y, w: g1.panel.w, h: bottom - g1.panel.y }, 1), `${tag}: expanded: the pane fills the panel: ${JSON.stringify({ pane: g1.pane, panel: g1.panel, bottom })}`);
    assert.ok(sameRect(g1.panel, { x: 0, y: g1.noticeBottom, w: g1.W, h: g1.Hh - g1.noticeBottom }, 1), `${tag}: expanded: the panel is the window's content below the notice strips: ${JSON.stringify({ panel: g1.panel, W: g1.W, H: g1.Hh, notices: g1.noticeBottom })}`);
    if (g1.noticeBottom === 0 && g1.answerTop === null) assert.ok(sameRect(g1.pane, { x: 0, y: 0, w: g1.W, h: g1.Hh }, 1), `${tag}: expanded: with no notice and no answer bar the pane is the whole window: ${JSON.stringify(g1.pane)}`);
    assert.deepStrictEqual(g1.hidden, { rail: true, head: true, tabs: true, composer: true }, `${tag}: expanded: the rail, the header, the tabs and the message box are out of view`);
    assert.ok(g1.view.w > small.view.w + 150 && g1.view.h > small.view.h + 150, `${tag}: expanded: the page area is much bigger: ${JSON.stringify([small.view, g1.view])}`);
    assert.strictEqual(g1.btn.label, 'Back to small browser', `${tag}: expanded: the same button is named Back to small browser`);
    assert.ok(/\(Esc\)$/.test(g1.btn.title) && !g1.btn.pressed, `${tag}: expanded: its tooltip names Esc, no aria-pressed: ${JSON.stringify(g1.btn)}`);
    assert.strictEqual(g1.focus, 'bBig', `${tag}: expanded: the focus stays on the button`);
    await onArea(`${tag}: big: the view follows the page area`);
    await wait(() => js(`/Escape/.test(document.getElementById('bLive').textContent)`), `${tag}: expanded: the change is announced`);
    assert.deepStrictEqual(g1.scroll, { doc: false, panel: false }, `${tag}: expanded: no page or panel scroll`);
    const sizes = await textSizes();
    assert.ok(sizes.length >= 4 && sizes.every(([, px]) => px >= 10.5), `${tag}: expanded: every text in the pane is at least 10.5px: ${JSON.stringify(sizes)}`);
    assert.strictEqual(viewUrl(), PAGE + 'links', `${tag}: expanded: the same page, not reloaded`);
    assert.strictEqual(view().webContents.isAudioMuted(), true, `${tag}: expanded: the sound state is unchanged (FR-138)`);
    await calm();
    await shot(`080-browser-expand-big-${file}.png`);

    // FR-008 over the big page, and FR-136: a Durbar menu closes first with Escape; the browser stays big
    await js(`document.getElementById('bMore').click()`);
    await wait(() => views().length === 0, `${tag}: a menu over the big page takes the view off (FR-008)`);
    await wait(() => js(`(()=>{const m=document.getElementById('modeMenu');if(!m)return false;const r=m.getBoundingClientRect();const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!t&&!!t.closest('#modeMenu')})()`), `${tag}: the menu is on top of the big page`);
    await H.key('Escape', [], { char: 'never' });
    await wait(() => js(`!document.getElementById('modeMenu')`), `${tag}: Escape closes the menu`);
    assert.strictEqual(await big(), true, `${tag}: a menu closes first with Escape, the browser stays big`);
    await wait(() => views().length === 1, `${tag}: the view is back after the menu`);
    await onArea(`${tag}: big again after the menu: the view is on the page area`);

    // FR-136: Escape in the page reaches the page and leaves the browser big
    await go(PAGE + 'keys');
    await inView(`document.getElementById('k').focus()`);
    await pageKey('Escape');
    await pageKey('a');
    await wait(() => inView(`document.getElementById('log').textContent.includes('a')`), `${tag}: the page logs its keys`);
    const log = await inView(`document.getElementById('log').textContent`);
    assert.ok(/\bEscape\b/.test(log), `${tag}: Escape in the page reaches the page: ${log}`);
    assert.strictEqual(await big(), true, `${tag}: Escape in the page leaves the browser big`);
    assert.strictEqual(views().length, 1, `${tag}: and the view stays on`);

    // FR-136: Escape on the button restores and the focus lands on Expand browser
    await js(`document.getElementById('bBig').focus()`);
    await H.focusPage();
    await js(`document.getElementById('bBig').focus()`);
    await H.key('Escape', [], { char: 'never' });
    await soft(async () => !(await big()) && sameRect((await geo()).view, small.view, 1));
    let g2 = await geo();
    assert.ok(sameRect(g2.view, small.view, 1), `${tag}: restored: the page area is back to its small rect: ${JSON.stringify([small.view, g2.view])}`);
    assert.ok(sameRect(g2.pane, small.pane, 1), `${tag}: restored: the pane is back to its small rect`);
    assert.strictEqual(g2.focus, 'bBig', `${tag}: restored by Escape: focus is on Expand browser`);
    assert.strictEqual(g2.btn.label, 'Expand browser', `${tag}: restored: the button is named Expand browser again`);
    assert.strictEqual(await js(`document.body.classList.contains('panel-open')`), true, `${tag}: Escape while big never closes the chat`);
    await onArea(`${tag}: restored: the view follows the page area`);
    await wait(() => js(`/small again/.test(document.getElementById('bLive').textContent)`), `${tag}: restored: the change is announced`);

    // the button both ways, and Escape from the address field (not typing) and from the page tabs
    for (const from of ['button', 'address', 'strip']) {
      await js(`document.getElementById('bBig').click()`);
      await wait(big, `${tag}: big again (${from})`);
      if (from === 'button') await js(`document.getElementById('bBig').click()`);
      else {
        await js(from === 'address' ? `document.getElementById('bAddr').focus()` : `document.querySelector('#bTabs .btab.on .btab-b').focus()`);
        await H.key('Escape', [], { char: 'never' });
      }
      await soft(async () => !(await big()) && sameRect((await geo()).view, small.view, 1));
      g2 = await geo();
      assert.ok(sameRect(g2.view, small.view, 1), `${tag}: restored by ${from}: the page area is back to its small rect`);
      await onArea(`${tag}: restored by ${from}: the view follows`);
      assert.strictEqual(g2.focus, 'bBig', `${tag}: restored by ${from}: focus is on Expand browser`);
    }
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'a draft kept while the browser is big', `${tag}: the draft in the message box is kept`);
    assert.deepStrictEqual(g2.hidden, { rail: false, head: false, tabs: false, composer: false }, `${tag}: restored: the rail, the header, the tabs and the message box are back`);

    // FR-137: not remembered: the Chat tab, another chat, a reload
    await js(`document.getElementById('bBig').click()`);
    await wait(big, `${tag}: big before the Chat tab`);
    await js(`window.DurbarBrowserPane.select('chat')`);
    await wait(async () => !(await big()), `${tag}: the Chat tab ends the big browser`);
    await toBrowser();
    assert.strictEqual(await big(), false, `${tag}: back on the Browser tab it is small`);
    await js(`document.getElementById('bBig').click()`);
    await wait(big, `${tag}: big before another chat`);
    await openChat(idB);
    assert.strictEqual(await big(), false, `${tag}: another chat ends the big browser`);
    await openChat(idA);
    await toBrowser();
    assert.strictEqual(await big(), false, `${tag}: back in the first chat the browser is small`);
    await js(`document.getElementById('bBig').click()`);
    await wait(big, `${tag}: big before the reload`);
    await H.load({ w, h, ready: WORLD === 'flat' ? 'fit' : REAL, settle: WORLD === 'flat', focus: true, query: WORLD === 'flat' ? undefined : { officeview: 'real' } });
    await openChat(idA);
    await toBrowser();
    await ctx.sleep(300);
    assert.strictEqual(await big(), false, `${tag}: state persisted: after a reload the browser starts small`);
    assert.strictEqual(await js(`document.getElementById('bBig').getAttribute('aria-label')`), 'Expand browser', `${tag}: state persisted: after a reload the button offers Expand`);
    await js(`document.getElementById('backBtn').click()`);
    await wait(() => views().length === 0, `${tag}: the chat closed, the view is off`);
    console.log(`[080-expand] ${tag} ok`);
  }
  console.log('[080-expand] all checks passed; pictures in ' + OUT);
};
