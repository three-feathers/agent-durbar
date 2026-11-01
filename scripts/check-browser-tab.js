/*
 * Check for spec 080 T014, T015, T018 (issue #556, slice 3): the Chat | Browser tabs of a session's chat, the browser bar, and the native
 * view behind the page area, on the simulator (no agent session, no AI credits, no network beyond the simulator's own scheme).
 *
 *   npm run check:ui -- --only check-browser-tab        (or: DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=scripts/check-browser-tab.js electron .)
 *   SHOTS_DIR=<folder> keeps the pictures (docs/screenshots/080-browser-tab-<w>x<h>.png and ...-narrow.png)
 *
 * At 1440x900 and 1280x800 (and a 480px panel):
 *   1. the tabs are a tablist (Chat selected by default), the Browser pane is hidden and NO view is attached to the window;
 *   2. the Browser tab (click, and the arrow keys): one view is attached, its bounds equal the page area's, the bar has an address field,
 *      Back / Forward / Reload, Sound and Open in system browser, every bar text is at least 10.5px;
 *   3. an address typed in the bar loads a simulator page; links, Back and Forward, a form POST work; the bar follows the page;
 *   4. refused addresses (file:, javascript:, a user name in the address) show their reason and load nothing;
 *   5. Sound starts off, the toggle changes the view's mute state both ways;
 *   6. a slow page shows Loading with Stop; Stop ends it; a download page leaves the page where it was;
 *   7. another session's Browser tab shows its own (blank) view, and coming back shows the first session's page again (SC-002);
 *   8. Chat tab, Esc and closing the panel detach the view (the page stays loaded).
 *   9. (T016) a cover never outlives its reason: menu then Chat tab then Browser tab; the panel closed under a menu; another chat opened under a dialog.
 *  10. (T016) the More menu, a dialog, a toast and the slash list over the page area: the view comes off, the still picture fills the area,
 *      the overlay is on top (elementFromPoint), and everything is back when it closes.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral, shotWithView: shotWithViewOf } = require('./driver-helpers');

const SIM_URL = (name) => 'durbar-sim://pages/' + name;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, js } = H;
  const OUT = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-browser-tab-'));
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
  const state = () => js(`(()=>{const q=s=>document.querySelector(s);return {
    addr:q('#bAddr').value,note:(q('#bNote').textContent||'').trim(),noteKind:q('#bNote').dataset.kind||'',title:q('#bTitle').textContent,
    back:!q('#bBack').disabled,fwd:!q('#bFwd').disabled,reload:q('#bReload').dataset.mode,sound:(q('#bSound').textContent||'').trim(),sys:!q('#bSys').disabled}})()`);
  const typeAddress = async (text) => {
    await js(`(()=>{const a=document.getElementById('bAddr');a.focus();a.value=${jsLiteral(text)};a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.key('Return');
  };
  const viewUrl = () => (view() ? view().webContents.getURL() : '');
  const rectEq = async (label) => {
    const r = await js(`(()=>{const b=document.getElementById('bView').getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}})()`);
    const b = view().getBounds();
    const near = (a, c) => Math.abs(a - c) <= 2;
    assert.ok(near(r.x, b.x) && near(r.y, b.y) && near(r.w, b.width) && near(r.h, b.height), `${label}: the view sits on the page area: area ${JSON.stringify(r)} view ${JSON.stringify(b)}`);
    return b;
  };
  /** The window's page with the native view blitted in (driver-helpers.js). */
  const shotWithView = (file) => shotWithViewOf(win(), view(), file);
  const openChat = async (pick) => {
    const o = await H.openSimAgent(pick, '#panelTabs');
    assert.ok(o.ok, 'the chat of a simulated agent is open with its tabs: ' + JSON.stringify(o.seen));
    return o.id;
  };
  const clickTab = (name) => js(`document.getElementById(${jsLiteral(name)}).click()`);
  const sleepFrame = () => ctx.sleep(180);

  let round = 0;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    const simA = 'sim-' + (2 * round + 1), simB = 'sim-' + (2 * round + 2); /* main keeps a session's view across the page's reloads, so each size uses its own two sessions */
    round++;
    await H.load({ w, h, ready: 'fit', focus: true });
    const idA = await openChat(`a=>a.id===${jsLiteral(simA)}`);
    await H.settle();

    // 1. tabs
    const tabs = await js(`(()=>{const l=document.getElementById('panelTabs');const t=[...l.querySelectorAll('[role=tab]')];
      return {role:l.getAttribute('role'),names:t.map(x=>x.textContent),sel:t.map(x=>x.getAttribute('aria-selected')),tab:t.map(x=>x.tabIndex),paneHidden:document.getElementById('browserPane').hidden,
        chatShown:document.getElementById('chat').getBoundingClientRect().height>100}})()`);
    assert.deepStrictEqual(tabs, { role: 'tablist', names: ['Chat', 'Browser'], sel: ['true', 'false'], tab: [0, -1], paneHidden: true, chatShown: true }, `${tag}: Chat is the default tab: ${JSON.stringify(tabs)}`);
    assert.strictEqual(views().length, 0, `${tag}: no view is attached while the Chat tab shows (and none was made at session start)`);

    // 2. the Browser tab, by the arrow key
    await js(`document.getElementById('tabChat').focus()`);
    await H.key('Right', [], { char: 'never' });
    await wait(() => views().length === 1, `${tag}: the view is attached by the Browser tab`);
    assert.strictEqual(await js(`document.activeElement.id`), 'tabBrowser', `${tag}: the arrow key moved focus to the Browser tab`);
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#panelTabs [role=tab]')].map(x=>x.getAttribute('aria-selected')+':'+x.tabIndex)`), ['false:-1', 'true:0'], `${tag}: roving tabindex`);
    await wait(async () => { try { await rectEq(tag); return true; } catch (e) { return false; } }, `${tag}: the view follows the page area`);
    const bar = await js(`(()=>{const out=[];for(const e of document.querySelectorAll('#browserPane .bbar *, #browserPane .bstat *, #panelTabs *')){const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());const ph=e.placeholder;
      if(t||ph)out.push([e.id||e.className,parseFloat(getComputedStyle(e).fontSize)]);}return out})()`);
    assert.ok(bar.length >= 6 && bar.every(([, px]) => px >= 10.5), `${tag}: the tabs and the bar have text and none is under 10.5px: ${JSON.stringify(bar)}`);
    const s0 = await state();
    assert.deepStrictEqual({ back: s0.back, fwd: s0.fwd, reload: s0.reload, sound: s0.sound, addr: s0.addr }, { back: false, fwd: false, reload: 'reload', sound: 'Sound off', addr: '' }, `${tag}: a new browser: ${JSON.stringify(s0)}`);
    assert.strictEqual(await js(`document.getElementById('bAddr').placeholder.length>10`), true, `${tag}: the address field says what to type`);
    assert.strictEqual(view().webContents.isAudioMuted(), true, `${tag}: muted at creation (FR-012)`);

    // 3. addresses, links, history, a POST
    await typeAddress(SIM_URL('links'));
    await wait(() => viewUrl() === SIM_URL('links'), `${tag}: the links page loads`);
    await wait(async () => (await state()).addr === SIM_URL('links') && (await state()).title === 'Links', `${tag}: the bar shows the page`);
    await inView(`document.getElementById('l-form').click()`);
    await wait(() => viewUrl() === SIM_URL('form'), `${tag}: a link in the page loads`);
    await wait(async () => (await state()).back, `${tag}: Back is on after a link`);
    await js(`document.getElementById('bBack').click()`);
    await wait(() => viewUrl() === SIM_URL('links'), `${tag}: Back goes back`);
    await wait(async () => (await state()).fwd, `${tag}: Forward is on after Back`);
    await js(`document.getElementById('bFwd').click()`);
    await wait(() => viewUrl() === SIM_URL('form'), `${tag}: Forward goes forward`);
    await inView(`document.getElementById('send').click()`);
    await wait(async () => /Got 2 field\(s\)/.test(await inView(`(document.getElementById('result')||{}).textContent||''`)), `${tag}: the form posts`);
    await js(`document.getElementById('bReload').click()`); // a POST reload may be refused by the page; the bar must still be sane
    await ctx.sleep(300);
    assert.ok((await state()).reload === 'reload', `${tag}: the Reload button is back to Reload`);

    // 4. refused addresses
    const keep = viewUrl();
    for (const [text, why] of [['file:///etc/hostname', /Only http and https/], ['javascript:alert(1)', /Only http and https/], ['https://user:pw@example.com/', /user name or password/], ['two words', /not a web address/]]) {
      await typeAddress(text);
      await wait(async () => { const n = await state(); return n.noteKind === 'error' && why.test(n.note); }, `${tag}: "${text}" is refused with its reason`);
      assert.strictEqual(viewUrl(), keep, `${tag}: "${text}" loaded nothing`);
      await js(`(()=>{const a=document.getElementById('bAddr');a.blur();})()`);
    }

    // 5. sound
    await js(`document.getElementById('bSound').click()`);
    await wait(() => view().webContents.isAudioMuted() === false, `${tag}: Sound on unmutes the view`);
    await wait(async () => (await state()).sound === 'Sound on', `${tag}: the toggle says Sound on`);
    await js(`document.getElementById('bSound').click()`);
    await wait(() => view().webContents.isAudioMuted() === true, `${tag}: Sound off mutes it again`);
    await wait(async () => (await state()).sound === 'Sound off', `${tag}: the toggle says Sound off`);

    // 6. slow page, Stop, download
    await typeAddress(SIM_URL('slow?ms=6000'));
    await wait(async () => { const n = await state(); return n.reload === 'stop' && /Loading/.test(n.note); }, `${tag}: a slow page shows Loading and Stop`);
    await js(`document.getElementById('bReload').click()`);
    await wait(async () => { const n = await state(); return n.reload === 'reload' && !/Loading/.test(n.note); }, `${tag}: Stop ends the load`);
    await typeAddress(SIM_URL('form'));
    await wait(() => viewUrl() === SIM_URL('form'), `${tag}: back on the form page`);
    await typeAddress(SIM_URL('download'));
    await ctx.sleep(900);
    assert.strictEqual(viewUrl(), SIM_URL('form'), `${tag}: a download page leaves the page where it was (downloads are cancelled in Phase 1)`);
    await typeAddress(SIM_URL('links'));
    await wait(() => viewUrl() === SIM_URL('links'), `${tag}: links again for the picture`);
    await wait(async () => (await state()).title === 'Links', `${tag}: title shown`);
    await H.clearToasts();
    await ctx.sleep(250);
    await shotWithView(path.join(OUT, `080-browser-tab-${tag}.png`));

    // overlays win (T016, FR-008): each overlay over the page area takes the view off and shows its still picture; it is on top and visible
    {
      const viewNow = view();
      const overlayCase = async (name, open, sel, close, shot) => {
        await open();
        await wait(() => views().length === 0, `${tag}: ${name}: the view comes off the window while the overlay is open`);
        await wait(() => js(`(()=>{const i=document.getElementById('bShot');return !!i&&i.naturalWidth>0&&i.src.startsWith('data:image/')})()`), `${tag}: ${name}: the still picture is shown in the page area`);
        const geo = await js(`(()=>{const v=document.getElementById('bView').getBoundingClientRect(),i=document.getElementById('bShot').getBoundingClientRect(),o=document.querySelector(${jsLiteral(sel)});
          if(!o)return {missing:true};const r=o.getBoundingClientRect();const x=(Math.max(r.left,v.left)+Math.min(r.right,v.right))/2,y=(Math.max(r.top,v.top)+Math.min(r.bottom,v.bottom))/2;const top=document.elementFromPoint(x,y);
          return {same:Math.abs(v.width-i.width)<2&&Math.abs(v.height-i.height)<2,visible:!!top&&!!top.closest(${jsLiteral(sel)}),overlap:r.left<v.right&&r.right>v.left&&r.top<v.bottom&&r.bottom>v.top}})()`);
        assert.ok(!geo.missing && geo.same && geo.visible && geo.overlap, `${tag}: ${name}: the overlay is on top of the page area and the picture fills it: ${JSON.stringify(geo)}`);
        if (shot) await ctx.sleep(500);
        if (shot) await shotWithView(path.join(OUT, shot));
        await close();
        await wait(() => views().length === 1 && view() === viewNow, `${tag}: ${name}: the view is back when the overlay closes`);
        await wait(() => js(`!document.getElementById('bShot')`), `${tag}: ${name}: the picture is dropped`);
      };
      await overlayCase('More menu', () => js(`document.getElementById('moreBtn').click()`), '#moreMenu', () => H.key('Escape', [], { char: 'never' }), `080-browser-overlay-${tag}.png`);
      await overlayCase('dialog', () => js(`void window.DurbarDialog(document)({title:'A question',body:'Shown over the page.',buttons:[{label:'Close',value:null}]});0`), '#modeDlg .dlg', () => H.clickText('#modeDlg .dbtn button', 'Close'));
      await overlayCase('toast', () => js(`(()=>{const t=document.createElement('div');t.className='toast';t.id='drvToast';t.textContent='A toast over the page';const box=document.getElementById('toasts');box.style.setProperty('--toast-b',Math.ceil(innerHeight-document.querySelector('#panel .composer').getBoundingClientRect().top+12)+'px');box.appendChild(t);})()`), '#drvToast', () => js(`document.getElementById('drvToast').remove()`));
      await overlayCase('slash list', () => js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='/';m.dispatchEvent(new Event('input',{bubbles:true}));})()`), '#slashList', () => js(`(()=>{const m=document.getElementById('msgInput');m.value='';m.dispatchEvent(new Event('input',{bubbles:true}));})()`));
    }

    // a cover never outlives its reason (reviewer's probes): the overlay is up and the tab, the panel or the chat changes under it
    {
      const noShot = () => js(`!document.getElementById('bShot')`);
      const backOn = async (label, v) => {
        await wait(() => views().length === 1 && view() === v, `${tag}: ${label}: the view is back`);
        await wait(noShot, `${tag}: ${label}: no stale picture`);
        await ctx.sleep(400);
        assert.strictEqual(views().length, 1, `${tag}: ${label}: and it stays`);
        assert.ok(await noShot(), `${tag}: ${label}: still no picture`);
      };
      const viewKeep = view();
      // (a) menu open, then the Chat tab, then the Browser tab
      await js(`document.getElementById('moreBtn').click()`);
      await wait(() => views().length === 0, `${tag}: menu up: view off`);
      await clickTab('tabChat');
      await wait(async () => (await noShot()) && views().length === 0, `${tag}: Chat tab: no picture, no view`);
      await js(`(()=>{const m=document.getElementById('moreMenu');if(m&&!m.hidden)document.getElementById('moreBtn').click();})()`);
      await clickTab('tabBrowser');
      await backOn('menu, Chat tab, Browser tab', viewKeep);
      // (b) menu open, then the panel closes, then the chat opens again on its Browser tab
      await js(`document.getElementById('moreBtn').click()`);
      await wait(() => views().length === 0, `${tag}: menu up again`);
      await js(`document.getElementById('backBtn').click()`);
      await wait(async () => !(await js(`document.body.classList.contains('panel-open')`)) && views().length === 0, `${tag}: panel closed under the menu`);
      await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(idA)})+'"]').click()`);
      await wait(() => js(`document.body.classList.contains('panel-open')&&!!document.getElementById('tabBrowser')`), `${tag}: chat open again`);
      await clickTab('tabBrowser');
      await backOn('panel closed under a menu', viewKeep);
      // (c) a dialog open, then another chat opens, then the first again
      await js(`void window.DurbarDialog(document)({title:'Still open',body:'x',buttons:[{label:'Close',value:null}]});0`);
      await wait(() => views().length === 0, `${tag}: dialog up: view off`);
      const idC = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(w === 1440 ? 'sim-7' : 'sim-8')});return a&&a.id})()`);
      await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(idC)})+'"]').click()`);
      await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(idC)}`), `${tag}: another chat opened under the dialog`);
      await H.clickText('#modeDlg .dbtn button', 'Close');
      await wait(noShot, `${tag}: no picture in the other chat`);
      await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(idA)})+'"]').click()`);
      await wait(() => js(`document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(idA)}`), `${tag}: first chat again`);
      await clickTab('tabBrowser');
      await backOn('another chat opened under a dialog', viewKeep);
    }

    // 7. another session
    const viewA = view();
    const idB = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(simB)});return a&&a.id})()`);
    assert.ok(idB, `${tag}: a second main agent exists`);
    await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(idB)})+'"]').click()`);
    await wait(() => js(`document.getElementById('panelTitle')&&document.querySelector('.sitem.sel')&&document.querySelector('.sitem.sel').dataset.sw===${jsLiteral(idB)}`), `${tag}: session B is open`);
    await wait(() => views().length === 0, `${tag}: opening B on the Chat tab takes A's view off the window`);
    await clickTab('tabBrowser');
    await wait(() => views().length === 1 && view() !== viewA, `${tag}: B has its own view`);
    assert.strictEqual(viewUrl(), 'about:blank', `${tag}: B's page is blank`);
    assert.notStrictEqual(view().webContents.session, viewA.webContents.session, `${tag}: B has its own partition (cookies and storage are not shared)`);
    await typeAddress(SIM_URL('index'));
    await wait(() => viewUrl() === SIM_URL('index'), `${tag}: B loads its own page`);
    assert.strictEqual(viewA.webContents.getURL(), SIM_URL('links'), `${tag}: A's page did not change`);
    await js(`document.querySelector('#stripList [data-sw="'+CSS.escape(${jsLiteral(idA)})+'"]').click()`);
    await wait(() => views().length === 0, `${tag}: back to A's Chat tab, nothing attached`);
    await clickTab('tabBrowser');
    await wait(() => views().length === 1 && view() === viewA, `${tag}: A's own view is shown again`);
    await wait(async () => (await state()).addr === SIM_URL('links'), `${tag}: the bar shows A's page`);

    // 8. Chat tab, Esc
    await clickTab('tabChat');
    await wait(() => views().length === 0, `${tag}: the Chat tab detaches the view`);
    assert.strictEqual(viewA.webContents.getURL(), SIM_URL('links'), `${tag}: the page stays loaded`);
    assert.strictEqual(await js(`document.getElementById('browserPane').hidden`), true, `${tag}: pane hidden`);
    await clickTab('tabBrowser');
    await wait(() => views().length === 1, `${tag}: and it attaches again`);
    await js(`document.getElementById('panelTabs').focus&&document.getElementById('tabBrowser').focus()`);
    await H.key('Escape', [], { char: 'never' });
    await wait(() => views().length === 0 && js(`!document.body.classList.contains('panel-open')`), `${tag}: Esc closes the panel and the view comes off`);
    console.log(`[browser-tab] ${tag} ok`);
  }

  // a 480px panel (spec 005 FR-058): the tabs and the bar fit one row each and the page area is not empty
  {
    await H.load({ w: 1280, h: 800, ready: 'fit', focus: true });
    await js(`(()=>{const s=document.createElement('style');s.id='narrowPanel';s.textContent='#panel{flex:0 0 480px!important;max-width:480px!important}';document.head.append(s);})()`);
    await openChat("a=>a.id==='sim-5'");
    await clickTab('tabBrowser');
    await wait(() => views().length === 1, 'narrow: the view attaches');
    await typeAddress(SIM_URL('links'));
    await wait(() => viewUrl() === SIM_URL('links'), 'narrow: loads');
    await ctx.sleep(300);
    const fit = await js(`(()=>{const P=document.getElementById('panel').getBoundingClientRect();const bad=[];
      for(const e of document.querySelectorAll('#panelTabs *, #browserPane .bbar *, #browserPane .bstat *')){const r=e.getBoundingClientRect();if(!r.width)continue;if(r.left<P.left-0.5||r.right>P.right+0.5)bad.push((e.id||e.className)+':'+Math.round(r.left)+'-'+Math.round(r.right));}
      const rows=new Set([...document.querySelectorAll('#browserPane .bbar > *')].map(e=>Math.round(e.getBoundingClientRect().top)));
      const v=document.getElementById('bView').getBoundingClientRect();
      return {panel:Math.round(P.width),bad,rows:rows.size,view:[Math.round(v.width),Math.round(v.height)]}})()`);
    assert.ok(fit.panel === 480 && fit.bad.length === 0 && fit.rows === 1 && fit.view[0] > 400 && fit.view[1] > 150, 'narrow: a 480px panel fits the tabs and the bar on one row each: ' + JSON.stringify(fit));
    await rectEq('narrow');
    await shotWithView(path.join(OUT, '080-browser-tab-narrow.png'));
    console.log('[browser-tab] 480px ok');
  }

  console.log('[browser-tab] all checks passed; pictures in ' + OUT);
};
