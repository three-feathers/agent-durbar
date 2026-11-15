/*
 * Spec 033 FR-089..FR-092 (issue #1709, owner report 2026-11-13): after an add the person sees where the folder went. Simulator only (no AI credits).
 *   npm run check:ui -- --only check-floor-add
 * Personal is switched off, then Add a folder is opened: the dialog names the floor (select, aria-labelled) and the choice is Personal. The new folder
 * lands on an off floor that is not the one shown: the floor is switched on, a toast names it with Show, Show goes there, one announcement says it.
 * Then the same folder is added again (the simulator's picker is told to choose it): "already added on the floor", no second desk.
 */
const assert = require('assert');
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, settle } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
  await H.load({ w, h, query: { simfloors: '1' }, focus: true });
  await until(`!!document.getElementById('floorsBtn')&&document.querySelectorAll('#stage .desk[data-id]').length>=1`, 15000);
  await settle();
  await js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);
  // Personal off, from the Floors panel
  if (await js(`document.getElementById('floorsPop').hidden`)) await js(`document.getElementById('floorsBtn').click()`);
  await until(`!document.getElementById('floorsPop').hidden`);
  await js(`document.querySelector('#floorsPop [data-fl="on"][data-floor="f-personal"]').click()`);
  await until(`document.querySelector('#floorsPop [data-fl="on"][data-floor="f-personal"]').getAttribute('aria-checked')==='false'`, 4000);
  await js(`document.getElementById('floorsBtn').click()`);
  await settle();
  assert.strictEqual(await js(`document.querySelector('#floorsBtn .fl-cnt').textContent.trim()`), '2/3', 'Personal is off');
  const cur = () => js(`localStorage.getItem('durbar.floor')`);
  const here = await cur();
  assert.notStrictEqual(here, 'f-personal', 'the floor shown is not Personal');
  const desks = () => js(`document.querySelectorAll('#stage .desk[data-id]').length`);
  // the dialog: the floor is named and can be changed
  await js(`document.getElementById('addFolder').click()`);
  await until(`!!document.getElementById('addFloorSel')`, 4000);
  const sel = await js(`(()=>{const s=document.getElementById('addFloorSel');return {label:s.getAttribute('aria-label'),opts:[...s.options].map(o=>o.textContent),val:s.value,size:parseFloat(getComputedStyle(s).fontSize)};})()`);
  assert.ok(sel.label && sel.opts.some((o) => /Personal \(off\)/.test(o)), `the dialog lists the floors by name, Personal marked off: ${JSON.stringify(sel)}`);
  assert.ok(sel.size >= 10.5, `the floor select text is at least 10.5px: ${sel.size}`);
  await js(`(()=>{const s=document.getElementById('addFloorSel');s.value='f-personal';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const before = await desks();
  await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>/Add existing/.test(b.textContent)).click()`);
  await until(`!!document.querySelector('.toast.with-act')`, 6000);
  const t = await js(`document.querySelector('.toast.with-act').textContent`);
  assert.ok(/Personal/.test(t) && /switched on/.test(t) && /Show/.test(t), `the toast names the floor, says it was switched on and offers Show: ${t}`);
  assert.strictEqual(await js(`document.querySelector('#floorsBtn .fl-cnt').textContent.trim()`), '3/3', 'Personal is on again (the Floors button counts every floor on)');
  assert.strictEqual(await cur(), here, 'adding does not move the person by itself');
  assert.strictEqual(await desks(), before, 'the new desk is on the other floor, not on the one shown');
  await until(`window.__ann.some(a=>/Added .* on the floor "Personal"/.test(a))`, 3000);
  assert.ok(await js(`window.__ann.some(a=>/Added .* on the floor "Personal".*Show/.test(a))`), 'the result is announced');
  await js(`document.querySelector('.toast.with-act .toast-act').click()`);
  await until(`localStorage.getItem('durbar.floor')==='f-personal'`, 4000);
  assert.strictEqual(await cur(), 'f-personal', 'Show went to Personal');
  await settle();
  assert.ok((await desks()) >= 1, 'Show went to the floor and its desk is drawn');
  // the same folder again
  await js(`window.__simAddFolderSame='~/work/new-folder-1';window.__ann=[]`);
  const n = await desks();
  await js(`document.getElementById('addFolder').click()`);
  await until(`!!document.getElementById('modeDlg')`, 4000);
  await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>/Add existing/.test(b.textContent)).click()`);
  await until(`window.__ann.some(a=>/already added on the floor "Personal"/.test(a))`, 6000);
  assert.ok(await js(`window.__ann.some(a=>/already added on the floor "Personal"/.test(a))`), 'a repeat says it is already added, on which floor');
  assert.strictEqual(await desks(), n, 'no second desk for a folder that is already there');
  // switching the floor on fails: the folder is still reported, with the reason, and the floor stays off (this was issue 1709 again)
  await js(`window.__simAddFolderSame=undefined;window.__ann=[]`);
  if (await js(`document.getElementById('floorsPop').hidden`)) await js(`document.getElementById('floorsBtn').click()`);
  await until(`!document.getElementById('floorsPop').hidden`);
  await js(`document.querySelector('#floorsPop [data-fl="on"][data-floor="f-personal"]').click()`);
  await until(`document.querySelector('#floorsBtn .fl-cnt').textContent.trim()==='2/3'`, 4000);
  await js(`document.getElementById('floorsBtn').click();window.__simSetFloorOnFail=true`);
  await js(`document.getElementById('addFolder').click()`);
  await until(`!!document.getElementById('addFloorSel')`, 4000);
  await js(`(()=>{const s=document.getElementById('addFloorSel');s.value='f-personal';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>/Add existing/.test(b.textContent)).click()`);
  await until(`window.__ann.some(a=>/could not be switched on/.test(a))`, 6000);
  assert.ok(await js(`window.__ann.some(a=>/Added .* on the floor "Personal".*could not be switched on.*Show/.test(a))`), 'a failed switch-on is still said, with the reason');
  assert.ok(/could not be switched on/.test(await js(`[...document.querySelectorAll('.toast.with-act')].map(t=>t.textContent).join('|')`)), 'the toast says it too, with a Show button');
  assert.strictEqual(await js(`document.querySelector('#floorsBtn .fl-cnt').textContent.trim()`), '2/3', 'the floor stayed off');
  // Show tries again; while it still fails the person is told, not left with nothing
  await js(`window.__ann=[];[...document.querySelectorAll('.toast.with-act .toast-act')].find(b=>/Show/.test(b.textContent)).click()`);
  await until(`window.__ann.some(a=>/still could not be switched on/.test(a))`, 4000);
  assert.ok(await js(`window.__ann.some(a=>/still could not be switched on/.test(a))`), 'a second failure is said too');
  assert.strictEqual(await js(`document.querySelector('#floorsBtn .fl-cnt').textContent.trim()`), '2/3', 'the floor is still off');
  await js(`window.__simSetFloorOnFail=false`);
  console.log(`[033 add] ${w}x${h}: floor named in the dialog, off floor switched on, Show goes there, a repeat says already added`);
  }
};
