/*
 * Spec 006 FR-024..FR-031 (issue #368): Pin, Hide and Delete in Previous sessions. Simulator only (no AI credits, nothing is deleted:
 * the simulator only removes rows from its own list). Linux with xvfb-run, one Electron at a time:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-prevmarks.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800, Expert and Simple: the row menu, pinned rows first, Show hidden, the red delete confirmation (Cancel
 * focused), the refusal for a session still in the office (with and without Remove from office), and Delete… disabled with its
 * reason. Asserts the row fits (Resume/View and ⋯ never wrap, overlap or leave the row). Writes docs/screenshots/006-prev-*.png.
 *
 * FR-033..FR-037 (2026-10-21): the section above the chat, collapsed and expanded, light and dark: no Previous (N) in the header,
 * one slim toggle row with aria-expanded, Ctrl+Shift+H with its focus moves, the choice saved for the next chat, Simple wording, no
 * section for a folder without history. Writes docs/screenshots/006-sessions-*.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir();
/* the dark fixture theme of check-ui-text (spec 052 FR-170), passed as an in-memory user theme */
const DARK = fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'dark-audit.json'), 'utf8');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  const log = (...a) => console.log('[006-prev]', ...a);
  const count = () => js(`document.querySelector('#prevBtn .prev-c').textContent`);
  const rows = () => js(`[...document.querySelectorAll('#prevLists .prev-row')].map(r=>({g:r.dataset.pg,k:r.dataset.pk,t:r.querySelector('.prev-t').textContent,pin:!!r.querySelector('.prev-pin'),hid:r.classList.contains('is-hidden')}))`);
  const shot = (name, w, h, level) => H.shot(path.join(OUT, `006-prev-${name}-${w}x${h}${level === 'simple' ? '-simple' : ''}.png`), { prep: 'calm' });
  const load = async (w, h, query, level) => {
    await H.load({ w, h, query });
    await js(`document.body.classList.toggle('simple',${level === 'simple'})`);
    await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Ada/.test(x.innerText));d.click();})()`);
    await ctx.waitFor(`!!document.getElementById('prevBtn')&&!document.getElementById('prevBtn').hidden`, 8000);
    if (!(await js(`!!document.querySelector('#prev .prev-row')`))) { await js(`document.getElementById('prevBtn').click()`); }
    await ctx.waitFor(`document.querySelectorAll('#prevLists .prev-row').length>=4`, 8000);
    await settle();
  };
  /* Escape from where the keyboard is: the focused item of the open menu */
  const escKey = () => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  const openMore = async (key) => { await ctx.waitFor(`!!document.querySelector(${jsLiteral(`#prevLists .prev-row[data-pk="${key}"] .prev-more`)})&&!document.getElementById('modeDlg')`, 8000); await js(`document.querySelector(${jsLiteral(`#prevLists .prev-row[data-pk="${key}"] .prev-more`)}).click()`); await ctx.waitFor(`!!document.querySelector('#modeMenu [data-pact]')`, 8000); };
  /* a menu action, then (for Delete…) the confirmation dialog: waits for each instead of a fixed delay */
  const pact = async (a) => { await js(`document.querySelector(${jsLiteral(`#modeMenu [data-pact="${a}"]`)}).click()`); if (a === 'delete') await ctx.waitFor(`!!document.querySelector('#modeDlg .dbtn .btn')`, 8000); else await ctx.waitFor(`!document.getElementById('modeMenu')`, 8000); await ctx.sleep(150); };
  const menuItems = () => js(`[...document.querySelectorAll('#modeMenu [data-pact]')].map(b=>b.querySelector('b').textContent)`);
  /* a row fits: its buttons are inside it, do not overlap, nothing wraps or scrolls sideways */
  const assertFit = async (label) => {
    const bad = await js(`(()=>{const out=[];for(const r of document.querySelectorAll('#prevLists .prev-row')){
      const R=r.getBoundingClientRect(),bs=[...r.querySelectorAll('.btn')].map(b=>b.getBoundingClientRect());
      if(r.scrollWidth>r.clientWidth+1)out.push('scrolls '+r.dataset.pk);
      bs.forEach((b,i)=>{if(b.left<R.left-0.5||b.right>R.right+0.5||b.height>32)out.push('outside/tall '+r.dataset.pk+' '+i);if(i&&b.left<bs[i-1].right-0.5)out.push('overlap '+r.dataset.pk);});
      const t=r.querySelector('.prev-tx').getBoundingClientRect();if(bs.length&&t.right>bs[0].left+0.5)out.push('title overlaps '+r.dataset.pk);}
      const body=document.querySelector('#prev .prev-body');if(body&&body.scrollWidth>body.clientWidth+1)out.push('panel scrolls sideways');
      /* macOS draws an overlay scrollbar whose click zone is the last 16px of the scroller (real, Paco's Mac, 2026-10-20): no ⋯ may reach it (it would hide the glyph and take the clicks) */
      if(body){const bb=body.getBoundingClientRect(),BR=bb.left+body.clientLeft+body.clientWidth; /* the scroller's content edge: a classic scrollbar is already outside it, an overlay one is not */for(const m of document.querySelectorAll('#prevLists .prev-more'))if(m.getBoundingClientRect().right>BR-16+0.5)out.push('⋯ under the scrollbar '+m.closest('.prev-row').dataset.pk);}
      return out;})()`);
    assert.deepStrictEqual(bad, [], `${label}: rows fit the panel`);
  };

  /* ---- FR-033..FR-037: the section, before the row checks below (each load starts from no saved choice unless said) ---- */
  /* the shortcut as the app shows it on this platform (FR-036, spec 052 FR-084): ⌘ on a Mac, Ctrl elsewhere; macOS drivers press meta */
  const MAC = process.platform === 'darwin';
  const MODS = MAC ? ['meta', 'shift'] : ['control', 'shift'];
  const ARIA = MAC ? 'Meta+Shift+H' : 'Control+Shift+H', KEYTXT = MAC ? '⇧⌘H' : 'Ctrl+Shift+H';
  /* a capture can fail once right after a page load on the Windows runner (UnknownVizError): settle and try once more */
  const shotSafe = async (file) => { try { await H.shot(file, { prep: 'calm' }); } catch (e) { console.log('[006-prev] capture retry:', String(e && e.message || e)); await settle(); await ctx.sleep(500); await H.shot(file, { prep: 'calm' }); } };
  const forget = () => js(`(()=>{try{localStorage.removeItem('durbar.prevOpen');localStorage.removeItem('durbar.detail');}catch(e){}})()`);
  const openAgent = async (name) => { await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.includes(${jsLiteral(name)}));d.click();})()`); await ctx.waitFor(`!!document.getElementById('panelHead')`, 8000); await settle(); };
  const sect = () => js(`(()=>{const p=document.getElementById('prev'),b=document.getElementById('prevBtn'),pp=document.getElementById('prevPanel');if(!p||!b)return null;const r=p.getBoundingClientRect(),br=b.getBoundingClientRect();
    return {shown:!p.hidden&&r.height>0,exp:b.getAttribute('aria-expanded'),ctl:b.getAttribute('aria-controls'),keys:b.getAttribute('aria-keyshortcuts'),panel:!pp.hidden,label:b.querySelector('.prev-l').textContent,region:p.getAttribute('aria-label'),
      count:b.querySelector('.prev-c').hidden?null:b.querySelector('.prev-c').textContent,sub:b.querySelector('.prev-sub').textContent,title:b.title,h:Math.round(r.height),bh:Math.round(br.height),
      inHeader:!!document.querySelector('#panelHead #prevBtn'),sideways:p.scrollWidth>p.clientWidth+1||b.scrollWidth>b.clientWidth+1,
      minFont:Math.min(...[...b.querySelectorAll('span')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      chev:getComputedStyle(b.querySelector('.chev')).transform,pref:(()=>{try{return localStorage.getItem('durbar.prevOpen')}catch(e){return 'x'}})()}})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const theme of ['light', 'dark']) {
      const q = theme === 'dark' ? { theme: 'audit-dark', usertheme: DARK } : {};
      const T = `${w}x${h} ${theme}`;
      const sshot = (name) => shotSafe(path.join(OUT, `006-sessions-${name}-${w}x${h}${theme === 'dark' ? '-dark' : ''}.png`));
      await H.load({ w, h, query: q }); await forget(); await H.load({ w, h, query: q }); await settle();
      await openAgent('Ada'); await ctx.waitFor(`!document.getElementById('prev').hidden`, 8000); await settle();
      let S = await sect();
      // FR-033: collapsed by default for a chat with a conversation; one slim row; not in the header any more
      assert.strictEqual(S.inHeader, false, T + ': no Previous (N) in the chat header');
      assert.ok(S.shown && S.exp === 'false' && !S.panel, T + ': collapsed ' + JSON.stringify(S));
      assert.strictEqual(S.ctl, 'prevPanel'); assert.strictEqual(S.keys, ARIA);
      assert.strictEqual(S.label, 'Previous sessions'); assert.strictEqual(S.region, 'Previous sessions');
      assert.strictEqual(S.count, '6'); assert.strictEqual(S.sub, '4 Copilot · 2 VS Code chats');
      assert.ok(S.title.endsWith('Show (' + KEYTXT + ')'), T + ': tooltip names the key ' + S.title);
      assert.ok(S.h <= 32 && S.bh === 28, T + ': one slim row (28px toggle, 32px section) ' + S.h + '/' + S.bh);
      assert.ok(!S.sideways && S.minFont >= 10.5, T + ': fits, text ≥10.5px');
      assert.ok(await js(`(()=>{const bs=[...document.querySelectorAll('#panelHead .actions > button')].filter(b=>b.getClientRects().length);return bs.length>=3&&bs.every(b=>Math.abs(b.getBoundingClientRect().top-bs[0].getBoundingClientRect().top)<1)})()`), T + ': header actions on one row');
      await sshot('collapsed');
      // FR-036: Ctrl+Shift+H from the message box opens it and focuses the search; again closes and focuses the toggle
      await js(`document.getElementById('msgInput').focus()`);
      await H.key('H', MODS, { char: 'never' }); assert.ok(await until(`document.getElementById('prevBtn').getAttribute('aria-expanded')==='true'&&!!document.getElementById('prevQ')`), T + ': Ctrl+Shift+H opens');
      S = await sect();
      assert.ok(S.panel && S.pref === 'open' && S.chev !== 'none', T + ': open by the key, saved, chevron turned ' + JSON.stringify(S));
      assert.ok(await js(`document.activeElement===document.getElementById('prevQ')`), T + ': focus on the search');
      assert.ok(await js(`document.querySelectorAll('#prevLists .prev-row').length===6`), T + ': the same lists');
      await js(`document.activeElement.blur()`); await sshot('expanded');
      await js(`document.getElementById('prevQ').focus()`);
      await H.key('H', MODS, { char: 'never' }); assert.ok(await until(`document.getElementById('prevBtn').getAttribute('aria-expanded')==='false'`), T + ': Ctrl+Shift+H closes');
      S = await sect();
      assert.ok(!S.panel && S.pref === 'closed', T + ': closed by the key, saved');
      assert.ok(await js(`document.activeElement===document.getElementById('prevBtn')`), T + ': focus back on the toggle');
      // a click opens it; FR-035: the next chat (after a reload) opens the same way
      await js(`document.getElementById('prevBtn').click()`); await until(`!document.getElementById('prevPanel').hidden`);
      await H.load({ w, h, query: q }); await openAgent('Ada'); await ctx.waitFor(`!document.getElementById('prev').hidden`, 8000); await settle();
      S = await sect(); assert.ok(S.exp === 'true' && S.panel, T + ': the saved choice (open) applies to the next chat');
      if (theme === 'light') {
        // FR-034: a folder without history has no section, and the key says so
        await js(`document.getElementById('backBtn').click()`); await settle();
        await openAgent('Kenji'); await settle();
        assert.ok(await js(`document.getElementById('prev').hidden`), T + ': no section for a folder without previous sessions');
        await H.key('H', MODS, { char: 'never' }); assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/No previous sessions in this folder/.test(t.textContent))`), T + ': the key says there are none');
        // the palette and the keyboard sheet name it
        await js(`document.getElementById('backBtn').click()`); await settle(); await openAgent('Ada');
        await H.key('K', [MAC ? 'meta' : 'control'], { char: 'never' }); assert.ok(await until(`!!document.getElementById('palIn')`), T + ': palette opens');
        await js(`(()=>{const i=document.getElementById('palIn');i.value='previous sessions';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.ok(await until(`[...document.querySelectorAll('.pal-o .pal-l')].some(x=>x.textContent==='Show or hide previous sessions')`), T + ': palette item');
        await H.key('Escape', [], { char: 'never' }); await settle();
        // Simple wording (FR-033)
        await js(`localStorage.setItem('durbar.detail','simple')`); await H.load({ w, h, query: q }); await openAgent('Ada'); await ctx.waitFor(`!document.getElementById('prev').hidden`, 8000); await settle();
        S = await sect(); assert.strictEqual(S.label, 'Earlier chats'); assert.strictEqual(S.region, 'Earlier chats');
        await shotSafe(path.join(OUT, `006-sessions-simple-${w}x${h}.png`));
        // FR-034/FR-036 (review on #497): the key pressed while the lists still load never says "none"; it opens once they are back
        await js(`localStorage.removeItem('durbar.detail')`); await forget();
        await H.load({ w, h, query: { ...q, simprevdelay: '2500' } }); await openAgent('Ada');
        assert.ok(await js(`document.getElementById('prev').hidden`), T + ': no row while loading');
        await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());document.getElementById('msgInput').focus()`);
        await H.key('H', MODS, { char: 'never' });
        assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/Looking for previous sessions/.test(t.textContent))`, 1500), T + ': says it is looking');
        assert.ok(await js(`![...document.querySelectorAll('#toasts .toast')].some(t=>/No previous sessions/.test(t.textContent))`), T + ': no false "none" while loading');
        assert.ok(await until(`!document.getElementById('prev').hidden&&document.getElementById('prevBtn').getAttribute('aria-expanded')==='true'&&document.activeElement===document.getElementById('prevQ')`, 8000), T + ': opens with focus on the search once loaded');
        assert.ok(await js(`![...document.querySelectorAll('#toasts .toast')].some(t=>/No previous sessions/.test(t.textContent))`), T + ': still no "none" after loading');
        // FR-036 (review on #497): a key pressed while loading, then leaving the chat, is dropped. Back in the chat the section stays
        // as saved ("closed"), the saved choice is unchanged and focus stays in the message box, even after both loads come back.
        await js(`localStorage.setItem('durbar.prevOpen','closed')`);
        await H.load({ w, h, query: { ...q, simprevdelay: '2500' } }); await openAgent('Ada');
        await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());document.getElementById('msgInput').focus()`);
        await H.key('H', MODS, { char: 'never' });
        assert.ok(await until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/Looking for previous sessions/.test(t.textContent))`, 1500), T + ': says it is looking (before leaving)');
        await js(`document.getElementById('backBtn').click()`); await settle(); await openAgent('Ada');
        await js(`document.getElementById('msgInput').focus()`);
        const after = await js(`performance.now()+3200`); /* the first load (before leaving) and the second (after coming back) are both back by then */
        assert.ok(await until(`!document.getElementById('prev').hidden&&performance.now()>${jsLiteral(after)}`, 8000), T + ': the lists come back');
        assert.strictEqual(await js(`document.getElementById('prevBtn').getAttribute('aria-expanded')`), 'false', T + ': an old key press does not open the section after leaving the chat');
        assert.strictEqual(await js(`localStorage.getItem('durbar.prevOpen')`), 'closed', T + ': the saved choice is unchanged');
        assert.ok(await js(`document.activeElement===document.getElementById('msgInput')`), T + ': focus stays in the message box');
        // A list that comes back while the search has focus (here the second load, after leaving and coming back) keeps the focus there.
        await js(`localStorage.setItem('durbar.prevOpen','open')`);
        await H.load({ w, h, query: { ...q, simprevdelay: '2500' } }); await openAgent('Ada');
        const t1 = await js(`performance.now()+1200`);
        await js(`document.getElementById('backBtn').click()`); await settle(); await until(`performance.now()>${jsLiteral(t1)}`, 3000); await openAgent('Ada');
        const t2 = await js(`performance.now()+2900`); /* the second load is back by then; the first one opened the section ~1.2 s earlier */
        assert.ok(await until(`!!document.getElementById('prevQ')`, 8000), T + ': the first load opens the saved section');
        await js(`(()=>{const i=document.getElementById('prevQ');i.focus();i.value='re';i.setSelectionRange(2,2);})()`);
        assert.ok(await js(`performance.now()<${jsLiteral(t2)}-1000`), T + ': the search got focus before the second load came back');
        await until(`performance.now()>${jsLiteral(t2)}`, 5000);
        assert.ok(await js(`document.activeElement===document.getElementById('prevQ')`), T + ': a list coming back keeps focus in the search');
        await js(`localStorage.setItem('durbar.prevOpen','closed')`);
      }
      await forget();
    }
  }
  await H.load({ w: 1440, h: 900 }); await forget(); /* the row checks below start from no saved choice */

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await load(w, h, {}, level);
      const L = `${w}x${h} ${level}`;
      let r = await rows();
      assert.deepStrictEqual(r.map((x) => x.k), ['prev-1', 'prev-2', 'prev-3', 'prev-4', 'h1/c1', 'h1/c2'], 'both groups, newest first');
      await assertFit(L + ' initial');
      // the menu: Pin, Rename… (059 FR-006), Hide, Delete… on an agent session; no Delete… on a VS Code chat
      await openMore('prev-3');
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Rename…', 'Hide', 'Delete…'], 'agent session menu (059 FR-006: Rename… between Pin and Hide)');
      assert.ok(await js(`document.activeElement.closest('#modeMenu')!==null`), 'focus is in the menu');
      assert.ok(await js(`document.querySelector('#modeMenu').getAttribute('role')==='menu'&&document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-more').getAttribute('aria-label')==='Actions for Add a retry with backoff to the registry client'`), 'roles and labels');
      await shot('menu', w, h, level);
      await escKey(); await until(`!document.getElementById('modeMenu')&&document.activeElement===document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-more')`);
      assert.ok(await js(`!document.getElementById('modeMenu')`), 'Escape closes the menu');
      assert.ok(await js(`document.activeElement===document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-more')`), 'focus returns to the ⋯');
      await openMore('h1/c1');
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Hide'], 'a VS Code chat has no Delete…');
      await escKey(); await until(`!document.getElementById('modeMenu')`);
      // right-click opens the same menu
      await js(`document.querySelector('#prevLists .prev-row[data-pk="prev-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await until(`!!document.querySelector('#modeMenu [data-pact]')`);
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Rename…', 'Hide', 'Delete…'], 'right-click opens the row menu');
      await escKey(); await until(`!document.getElementById('modeMenu')`);
      // Pin the third and the VS Code chat: pinned rows come first in their group
      await openMore('prev-3'); await pact('pin');
      await openMore('h1/c2'); await pact('pin');
      r = await rows();
      assert.deepStrictEqual(r.map((x) => x.k), ['prev-3', 'prev-1', 'prev-2', 'prev-4', 'h1/c2', 'h1/c1'], 'pinned first in each group');
      assert.ok(r[0].pin && r[4].pin && !r[1].pin, 'pin marks on the pinned rows only');
      assert.ok(await js(`document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-pin .sr-only').textContent==='Pinned'`), 'Pinned for screen readers');
      await assertFit(L + ' pinned');
      assert.strictEqual(await count(), '6', 'the section counts 6 rows');
      // Hide the fourth: it leaves the list, the count drops, Show hidden (1) appears, focus moves to the next row's ⋯
      await openMore('prev-4'); await pact('hide');
      r = await rows();
      assert.ok(!r.some((x) => x.k === 'prev-4'), 'hidden row is out');
      assert.strictEqual(await count(), '5');
      assert.ok(/1 hidden/.test(await js(`document.getElementById('prevBtn').title`)), 'tooltip says 1 hidden');
      assert.ok(/1 hidden/.test(await js(`document.querySelector('#prevBtn .prev-sub').textContent`)), 'the row says 1 hidden (FR-033)');
      assert.strictEqual(await js(`document.querySelector('[data-pv="showhidden"]').textContent`), 'Show hidden (1)');
      assert.ok(await js(`document.activeElement.classList.contains('prev-more')`), 'focus is on a ⋯ after Hide');
      await js(`document.querySelector('[data-pv="showhidden"]').click()`); await until(`!!document.querySelector('#prevLists .prev-row.is-hidden[data-pk="prev-4"]')`);
      r = await rows();
      assert.ok(r.find((x) => x.k === 'prev-4').hid, 'Show hidden brings it back, tagged');
      assert.ok(await js(`!!document.querySelector('#prevLists .prev-row[data-pk="prev-4"] .prev-hidtag')`), 'Hidden tag');
      await openMore('prev-4');
      assert.deepStrictEqual(await menuItems(), ['Rename…', 'Unhide', 'Delete…'], 'a hidden row offers Unhide (no Pin)');
      await shot('hidden', w, h, level);
      await escKey(); await until(`!document.getElementById('modeMenu')`);
      await assertFit(L + ' hidden shown');
      // Delete…: the red confirmation, Cancel focused
      await openMore('prev-2'); await pact('delete');
      const dlg = await js(`({t:document.getElementById('mdT').textContent,b:document.getElementById('mdB').textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btn:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent+(x.className.includes('danger')?'*':'')),f:document.activeElement.textContent})`);
      assert.deepStrictEqual(dlg, { t: 'Delete this session?', b: '“Why does the canton lookup return duplicates?” will be deleted from GitHub Copilot on this computer.', l: ['It will also be gone from VS Code and the Copilot CLI, and it cannot be resumed again.', 'This cannot be undone. To only take it out of this list, use Hide.'], btn: ['Cancel', 'Delete*'], f: 'Cancel' }, 'delete confirmation');
      await shot('delete', w, h, level);
      await js(`document.querySelector('#modeDlg [data-cancel]').click()`); await ctx.waitFor(`!document.getElementById('modeDlg')`, 8000);
      assert.ok((await rows()).some((x) => x.k === 'prev-2'), 'Cancel keeps the row');
      await openMore('prev-2'); await pact('delete');
      // the busy state can be short (a fast delete): record it from before the click, so a slow runner cannot miss it
      await js(`(()=>{window.__busySeen=false;const o=new MutationObserver(()=>{const b=document.querySelector('#prevLists .prev-row[data-pk="prev-2"] .prev-more');if(b&&b.getAttribute('aria-busy')==='true')window.__busySeen=true;});o.observe(document.getElementById('prevLists'),{subtree:true,attributes:true,attributeFilter:['aria-busy']});window.__busyObs=o;})()`);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Delete').click()`);
      await ctx.waitFor(`!document.querySelector('#prevLists .prev-row[data-pk="prev-2"]')`, 8000);
      assert.ok(await js(`(()=>{window.__busyObs.disconnect();return window.__busySeen})()`), 'busy state on the row while it runs');
      await settle();
      assert.strictEqual(await count(), '4');
      assert.ok(await js(`document.activeElement.classList.contains('prev-more')`), 'focus on the next ⋯ after Delete');
      await assertFit(L + ' after delete');
    }
    // the refusal for a session still in the office: with, and without, Remove from office
    for (const [variant, expectBtns, lines] of [['inoffice', ['Cancel', 'Go to session', 'Remove from office'], []], ['inoffice-solo', ['Cancel', 'Go to session'], ['It is the only session in this folder: start a new session there first.']]]) {
      await load(w, h, variant === 'inoffice' ? { simprev: variant } : { simprev: variant, simrooms: 'solo' }, 'expert');
      await openMore('prev-1'); await pact('delete');
      await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Delete').click()`); await ctx.waitFor(`!!document.getElementById('mdT')&&document.getElementById('mdT').textContent==='This session is still in the office'`, 8000); await ctx.sleep(200);
      const d = await js(`({t:(document.getElementById('mdT')||{}).textContent,b:(document.getElementById('mdB')||{}).textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btn:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
      assert.deepStrictEqual(d, { t: 'This session is still in the office', b: 'End it and remove it from the office first, then delete it here.', l: lines, btn: expectBtns }, `refusal dialog (${variant})`);
      assert.ok((await rows()).some((x) => x.k === 'prev-1'), 'the row stays');
      await shot(variant === 'inoffice' ? 'refused' : 'refused-only', w, h);
      await js(`document.querySelector('#modeDlg [data-cancel]').click()`); await ctx.waitFor(`!document.getElementById('modeDlg')`, 8000);
    }
    // an agent app with no delete: Delete… is shown disabled with the reason
    await load(w, h, { simkinds: 'mixed' }, 'expert'); // Ada is a Claude Code agent: no per-session delete
    await openMore('prev-1');
    const dis = await js(`(()=>{const b=document.querySelector('#modeMenu [data-pact="delete"]');return {dis:b.getAttribute('aria-disabled'),tip:b.title,tab:b.tabIndex}})()`);
    assert.deepStrictEqual(dis, { dis: 'true', tip: 'Claude Code cannot delete one session. Hide it instead.', tab: 0 }, 'disabled, focusable, with the reason');
    await js(`document.querySelector('#modeMenu [data-pact="delete"]').click()`); await ctx.sleep(250); // a disabled item: wait for nothing to happen
    assert.ok(await js(`!document.getElementById('modeDlg')`), 'a disabled Delete… does nothing');
    await shot('nodelete', w, h);
  }
  log('PASS');
};
