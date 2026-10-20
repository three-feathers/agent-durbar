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
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const log = (...a) => console.log('[006-prev]', ...a);
  const rows = () => js(`[...document.querySelectorAll('#prevLists .prev-row')].map(r=>({g:r.dataset.pg,k:r.dataset.pk,t:r.querySelector('.prev-t').textContent,pin:!!r.querySelector('.prev-pin'),hid:r.classList.contains('is-hidden')}))`);
  const hideToasts = () => js(`(()=>{if(!document.getElementById('shotsNoToast')){const s=document.createElement('style');s.id='shotsNoToast';s.textContent='#toasts{display:none!important}';document.head.appendChild(s);}})()`);
  const shot = async (name, w, h, level) => { await hideToasts(); await ctx.sleep(250); await ctx.shot(path.join(OUT, `006-prev-${name}-${w}x${h}${level === 'simple' ? '-simple' : ''}.png`)); };
  const load = async (w, h, query, level) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', ...query } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(800);
    await js(`document.body.classList.toggle('simple',${level === 'simple'})`);
    await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Ada/.test(x.innerText));d.click();})()`);
    await ctx.waitFor(`!!document.getElementById('prevBtn')&&!document.getElementById('prevBtn').hidden`, 8000);
    if (!(await js(`!!document.querySelector('#prev .prev-row')`))) { await js(`document.getElementById('prevBtn').click()`); }
    await ctx.waitFor(`document.querySelectorAll('#prevLists .prev-row').length>=4`, 8000);
    await ctx.sleep(300);
  };
  /* Escape from where the keyboard is: the focused item of the open menu */
  const escKey = () => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  const openMore = async (key) => { await js(`document.querySelector('#prevLists .prev-row[data-pk="${key}"] .prev-more').click()`); await ctx.sleep(250); };
  const menuItems = () => js(`[...document.querySelectorAll('#modeMenu [data-pact]')].map(b=>b.querySelector('b').textContent)`);
  /* a row fits: its buttons are inside it, do not overlap, nothing wraps or scrolls sideways */
  const assertFit = async (label) => {
    const bad = await js(`(()=>{const out=[];for(const r of document.querySelectorAll('#prevLists .prev-row')){
      const R=r.getBoundingClientRect(),bs=[...r.querySelectorAll('.btn')].map(b=>b.getBoundingClientRect());
      if(r.scrollWidth>r.clientWidth+1)out.push('scrolls '+r.dataset.pk);
      bs.forEach((b,i)=>{if(b.left<R.left-0.5||b.right>R.right+0.5||b.height>32)out.push('outside/tall '+r.dataset.pk+' '+i);if(i&&b.left<bs[i-1].right-0.5)out.push('overlap '+r.dataset.pk);});
      const t=r.querySelector('.prev-tx').getBoundingClientRect();if(bs.length&&t.right>bs[0].left+0.5)out.push('title overlaps '+r.dataset.pk);}
      const body=document.querySelector('#prev .prev-body');if(body&&body.scrollWidth>body.clientWidth+1)out.push('panel scrolls sideways');return out;})()`);
    assert.deepStrictEqual(bad, [], `${label}: rows fit the panel`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await load(w, h, {}, level);
      const L = `${w}x${h} ${level}`;
      let r = await rows();
      assert.deepStrictEqual(r.map((x) => x.k), ['prev-1', 'prev-2', 'prev-3', 'prev-4', 'h1/c1', 'h1/c2'], 'both groups, newest first');
      await assertFit(L + ' initial');
      // the menu: Pin, Hide, Delete… on an agent session; no Delete… on a VS Code chat
      await openMore('prev-3');
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Hide', 'Delete…'], 'agent session menu');
      assert.ok(await js(`document.activeElement.closest('#modeMenu')!==null`), 'focus is in the menu');
      assert.ok(await js(`document.querySelector('#modeMenu').getAttribute('role')==='menu'&&document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-more').getAttribute('aria-label')==='Actions for Add a retry with backoff to the registry client'`), 'roles and labels');
      await shot('menu', w, h, level);
      await escKey(); await ctx.sleep(200);
      assert.ok(await js(`!document.getElementById('modeMenu')`), 'Escape closes the menu');
      assert.ok(await js(`document.activeElement===document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-more')`), 'focus returns to the ⋯');
      await openMore('h1/c1');
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Hide'], 'a VS Code chat has no Delete…');
      await escKey(); await ctx.sleep(150);
      // right-click opens the same menu
      await js(`document.querySelector('#prevLists .prev-row[data-pk="prev-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await ctx.sleep(200);
      assert.deepStrictEqual(await menuItems(), ['Pin to top', 'Hide', 'Delete…'], 'right-click opens the row menu');
      await escKey(); await ctx.sleep(150);
      // Pin the third and the VS Code chat: pinned rows come first in their group
      await openMore('prev-3'); await js(`document.querySelector('#modeMenu [data-pact="pin"]').click()`); await ctx.sleep(250);
      await openMore('h1/c2'); await js(`document.querySelector('#modeMenu [data-pact="pin"]').click()`); await ctx.sleep(250);
      r = await rows();
      assert.deepStrictEqual(r.map((x) => x.k), ['prev-3', 'prev-1', 'prev-2', 'prev-4', 'h1/c2', 'h1/c1'], 'pinned first in each group');
      assert.ok(r[0].pin && r[4].pin && !r[1].pin, 'pin marks on the pinned rows only');
      assert.ok(await js(`document.querySelector('#prevLists .prev-row[data-pk="prev-3"] .prev-pin .sr-only').textContent==='Pinned'`), 'Pinned for screen readers');
      await assertFit(L + ' pinned');
      const before = await js(`document.getElementById('prevBtn').textContent`);
      assert.strictEqual(before, 'Previous (6)');
      // Hide the fourth: it leaves the list, the count drops, Show hidden (1) appears, focus moves to the next row's ⋯
      await openMore('prev-4'); await js(`document.querySelector('#modeMenu [data-pact="hide"]').click()`); await ctx.sleep(300);
      r = await rows();
      assert.ok(!r.some((x) => x.k === 'prev-4'), 'hidden row is out');
      assert.strictEqual(await js(`document.getElementById('prevBtn').textContent`), 'Previous (5)');
      assert.ok(/1 hidden/.test(await js(`document.getElementById('prevBtn').title`)), 'tooltip says 1 hidden');
      assert.strictEqual(await js(`document.querySelector('[data-pv="showhidden"]').textContent`), 'Show hidden (1)');
      assert.ok(await js(`document.activeElement.classList.contains('prev-more')`), 'focus is on a ⋯ after Hide');
      await js(`document.querySelector('[data-pv="showhidden"]').click()`); await ctx.sleep(250);
      r = await rows();
      assert.ok(r.find((x) => x.k === 'prev-4').hid, 'Show hidden brings it back, tagged');
      assert.ok(await js(`!!document.querySelector('#prevLists .prev-row[data-pk="prev-4"] .prev-hidtag')`), 'Hidden tag');
      await openMore('prev-4');
      assert.deepStrictEqual(await menuItems(), ['Unhide', 'Delete…'], 'a hidden row offers Unhide (no Pin)');
      await shot('hidden', w, h, level);
      await escKey(); await ctx.sleep(150);
      await assertFit(L + ' hidden shown');
      // Delete…: the red confirmation, Cancel focused
      await openMore('prev-2'); await js(`document.querySelector('#modeMenu [data-pact="delete"]').click()`); await ctx.sleep(300);
      const dlg = await js(`({t:document.getElementById('mdT').textContent,b:document.getElementById('mdB').textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btn:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent+(x.className.includes('danger')?'*':'')),f:document.activeElement.textContent})`);
      assert.deepStrictEqual(dlg, { t: 'Delete this session?', b: '“Why does the canton lookup return duplicates?” will be deleted from GitHub Copilot on this computer.', l: ['It will also be gone from VS Code and the Copilot CLI, and it cannot be resumed again.', 'This cannot be undone. To only take it out of this list, use Hide.'], btn: ['Cancel', 'Delete*'], f: 'Cancel' }, 'delete confirmation');
      await shot('delete', w, h, level);
      await js(`document.querySelector('#modeDlg [data-cancel]').click()`); await ctx.sleep(250);
      assert.ok((await rows()).some((x) => x.k === 'prev-2'), 'Cancel keeps the row');
      await openMore('prev-2'); await js(`document.querySelector('#modeMenu [data-pact="delete"]').click()`); await ctx.sleep(300);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Delete').click()`); await ctx.sleep(120);
      assert.ok(await js(`document.querySelector('#prevLists .prev-row[data-pk="prev-2"] .prev-more').getAttribute('aria-busy')==='true'`), 'busy state on the row while it runs');
      await ctx.waitFor(`!document.querySelector('#prevLists .prev-row[data-pk="prev-2"]')`, 4000);
      assert.strictEqual(await js(`document.getElementById('prevBtn').textContent`), 'Previous (4)');
      assert.ok(await js(`document.activeElement.classList.contains('prev-more')`), 'focus on the next ⋯ after Delete');
      await assertFit(L + ' after delete');
    }
    // the refusal for a session still in the office: with, and without, Remove from office
    for (const [variant, expectBtns, lines] of [['inoffice', ['Cancel', 'Go to session', 'Remove from office'], []], ['inoffice-solo', ['Cancel', 'Go to session'], ['It is the only session in this folder: start a new session there first.']]]) {
      await load(w, h, variant === 'inoffice' ? { simprev: variant } : { simprev: variant, simrooms: 'solo' }, 'expert');
      await openMore('prev-1'); await js(`document.querySelector('#modeMenu [data-pact="delete"]').click()`); await ctx.sleep(300);
      await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Delete').click()`); await ctx.sleep(900);
      const d = await js(`({t:(document.getElementById('mdT')||{}).textContent,b:(document.getElementById('mdB')||{}).textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btn:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
      assert.deepStrictEqual(d, { t: 'This session is still in the office', b: 'This session is still in the office. End it and remove it from the office first.', l: lines, btn: expectBtns }, `refusal dialog (${variant})`);
      assert.ok((await rows()).some((x) => x.k === 'prev-1'), 'the row stays');
      await shot(variant === 'inoffice' ? 'refused' : 'refused-only', w, h);
      await js(`document.querySelector('#modeDlg [data-cancel]').click()`); await ctx.sleep(200);
    }
    // an agent app with no delete: Delete… is shown disabled with the reason
    await load(w, h, { simkinds: 'mixed' }, 'expert'); // Ada is a Claude Code agent: no per-session delete
    await openMore('prev-1');
    const dis = await js(`(()=>{const b=document.querySelector('#modeMenu [data-pact="delete"]');return {dis:b.getAttribute('aria-disabled'),tip:b.title,tab:b.tabIndex}})()`);
    assert.deepStrictEqual(dis, { dis: 'true', tip: 'Claude Code cannot delete one session. Hide it instead.', tab: 0 }, 'disabled, focusable, with the reason');
    await js(`document.querySelector('#modeMenu [data-pact="delete"]').click()`); await ctx.sleep(250);
    assert.ok(await js(`!document.getElementById('modeDlg')`), 'a disabled Delete… does nothing');
    await shot('nodelete', w, h);
  }
  log('PASS');
};
