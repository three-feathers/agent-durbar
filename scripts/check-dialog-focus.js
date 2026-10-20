/*
 * Keyboard check for the "Allow all" confirmation (spec 003 FR-033, issue #25). Simulator only (no AI credits, no Copilot login).
 * Uses real key events (webContents.sendInputEvent), so focus handling is the browser's own. Linux with xvfb-run:
 *
 *   npm run check:dialog-focus
 *
 * Checks: while the dialog is open focus is inside it; Tab / Shift+Tab stay inside; Escape cancels (mode unchanged) and focus
 * returns to the mode chip; Allow all still needs an explicit confirm (Escape, a backdrop click and Cancel never apply it) and
 * focus is back on the chip afterwards. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const { waits } = require('./driver-helpers');

module.exports = async (ctx) => {
  const { until, settle } = waits(ctx); // spec 008 FR-096: wait for the page, not a fixed time
  const key = async (keyCode, shift) => {
    const modifiers = shift ? ['shift'] : [];
    const wc = ctx.win.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers }); // Enter activates a button on the char event
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await ctx.sleep(50); // the key's own handler runs in the next tasks; what it changes is waited for by the caller
  };
  const ev = (code) => ctx.js(code);
  const inDlg = () => ev(`(()=>{const d=document.getElementById('modeDlg');return !!d&&d.contains(document.activeElement)})()`);
  const dlgOpen = () => ev(`!!document.getElementById('modeDlg')`);
  const onChip = () => ev(`document.activeElement&&document.activeElement.id==='modeChip'`);
  const mode = () => ev(`(document.querySelector('#modeChip')||{}).innerText||''`);
  const active = () => ev(`(()=>{const e=document.activeElement;return e?(e.id||e.tagName)+':'+(e.textContent||'').trim().slice(0,20):'none'})()`);
  const openDialog = async () => {
    // keyboard only: focus the chip, Enter opens the menu, ArrowDown to Allow all, Enter picks it
    await ev(`document.getElementById('modeChip').focus()`);
    await key('Return'); await until(`!!document.getElementById('modeMenu')`);
    assert.ok(await ev(`!!document.getElementById('modeMenu')`), 'menu opened with Enter');
    for (let i = 0; i < 3 && !(await ev(`document.activeElement&&document.activeElement.dataset.mode==='allow'`)); i++) { await ev(`window.__was=document.activeElement`); await key('Down'); await until(`document.activeElement!==window.__was`); }
    await key('Return'); await until(`(()=>{const d=document.getElementById('modeDlg');return !!d&&d.contains(document.activeElement)})()`);
    assert.ok(await dlgOpen(), 'the Allow all confirmation is open');
  };

  await ctx.win.setContentSize(1440, 900);
  ctx.win.show(); ctx.win.focus(); ctx.win.webContents.focus(); // key events need a focused page (xvfb has no window manager)
  await until(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000); await settle();
  const id = await ev(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Ada'));return d?d.dataset.id:null})()`);
  assert.ok(id, 'Ada is on the floor');
  await ev(`document.querySelector('#stage [data-id="${id}"]').click()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('modeChip')`); await settle();
  await ev(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="true"]');if(t)t.click();})()`); await until(`!document.querySelector('.prev-toggle[aria-expanded="true"]')`);
  const before = await mode(); assert.match(before, /Read-only/, 'Ada starts read-only');

  // 1) focus lands in the dialog and stays there
  await openDialog();
  assert.ok(await inDlg(), `focus is inside the dialog after it opens (active: ${await active()})`);
  // 2) Tab and Shift+Tab are trapped
  for (let i = 0; i < 6; i++) { await key('Tab'); assert.ok(await inDlg(), `Tab ${i + 1} stays in the dialog (active: ${await active()})`); }
  for (let i = 0; i < 6; i++) { await key('Tab', true); assert.ok(await inDlg(), `Shift+Tab ${i + 1} stays in the dialog (active: ${await active()})`); }
  // 3) Escape cancels: mode unchanged, dialog gone, focus back on the chip
  await key('Escape'); await until(`!document.getElementById('modeDlg')&&document.activeElement&&document.activeElement.id==='modeChip'`);
  assert.ok(!(await dlgOpen()), 'Escape closes the dialog');
  assert.strictEqual(await mode(), before, 'Escape leaves the mode unchanged');
  assert.ok(await onChip(), `focus returns to the mode chip after Escape (active: ${await active()})`);

  // 4) Cancel button and backdrop click also cancel and return focus
  await openDialog();
  await ev(`[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent==='Cancel').click()`); await until(`!document.getElementById('modeDlg')&&document.activeElement&&document.activeElement.id==='modeChip'`);
  assert.ok(!(await dlgOpen()) && await onChip() && await mode() === before, `Cancel closes, mode unchanged, focus on the chip (active: ${await active()})`);
  await openDialog();
  await ev(`document.getElementById('modeDlg').click()`); await until(`!document.getElementById('modeDlg')&&document.activeElement&&document.activeElement.id==='modeChip'`);
  assert.ok(!(await dlgOpen()) && await onChip() && await mode() === before, `backdrop click closes, mode unchanged, focus on the chip (active: ${await active()})`);

  // 5) confirming still needs an explicit action: the primary button is Allow all, and only it applies the mode
  await openDialog();
  assert.strictEqual(await mode(), before, 'opening the dialog does not change the mode');
  await ev(`[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent==='Allow all').click()`); await until(`!document.getElementById('modeDlg')&&/Allow all/.test((document.querySelector('#modeChip')||{}).innerText||'')&&document.activeElement&&document.activeElement.id==='modeChip'`);
  assert.ok(!(await dlgOpen()), 'dialog closed after Allow all');
  assert.match(await mode(), /Allow all/, 'Allow all applied after the explicit confirm');
  assert.ok(await onChip(), `focus is on the (new) mode chip after confirming (active: ${await active()})`);
  console.log('[dialog-focus] all checks passed');
};
