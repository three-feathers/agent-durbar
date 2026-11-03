/*
 * Spec 033 FR-088 (issue #787): a failing side panel never leaves the office stale after a floor switch. Simulator only (no AI credits).
 *   npm run check:ui -- --only check-floor-repaint
 * The Floors panel render is made to throw, then a floor is switched off and on from #floorsPop. After each switch the desks of #stage must equal
 * those of a forced full redraw (__durbarSimUi.render, which also clears the layout key). Without the `finally` in afterFloorsChange the first
 * check fails: the throw comes before the render is scheduled. The console error of the fake failure is expected.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const { js, until, settle } = helpers(ctx);
  await until(`!!document.getElementById('floorsBtn')&&document.querySelectorAll('#stage .desk[data-id]').length>=1`, 15000);
  await settle();
  const desks = () => js(`[...document.querySelectorAll('#stage .desk[data-id]')].filter(d=>!d.closest('.helpers')).map(d=>d.dataset.id).sort().join(',')`);
  const redraw = async () => { await js(`window.__durbarSimUi.render()`); await settle(); return desks(); };
  if (await js(`document.getElementById('floorsPop').hidden`)) await js(`document.getElementById('floorsBtn').click()`);
  await until(`!document.getElementById('floorsPop').hidden`);
  // the app is one closed function, so the panel render cannot be replaced; its paint (box.innerHTML=) is made to throw instead
  await js(`(()=>{const p=document.getElementById('floorsPop');window.__stubN=0;Object.defineProperty(p,'innerHTML',{configurable:true,set(){window.__stubN++;throw new Error('simulated side-panel failure (spec 033 FR-088)');}});})()`);
  const ids = await js(`[...document.querySelectorAll('#floorsPop [data-fl="on"]')].map(b=>b.dataset.floor)`);
  assert.ok(ids.length >= 2, `the simulator has several floors (DURBAR_SIM_FLOORS=1): ${ids}`);
  const sw = (id) => `document.querySelector(${jsLiteral(`#floorsPop [data-fl="on"][data-floor="${id}"]`)})`;
  const btn = () => js(`document.getElementById('floorsBtn').textContent.trim()`); // updated before the side panels, so it also moves while the panel is broken
  for (const id of [ids[ids.length - 1], ids[ids.length - 1], ids[0], ids[0]]) { // off, on, off, on (the panel keeps its first paint: the click does not need it)
    const was = await btn();
    await js(`${sw(id)}.click()`);
    await until(`document.getElementById('floorsBtn').textContent.trim()!==${jsLiteral(was)}`, 3000);
    await settle();
    const shown = await desks();
    assert.strictEqual(shown, await redraw(), `the office after switching ${id} (button was ${was}) is what a forced full redraw draws`);
  }
  assert.ok(await js(`window.__stubN>0`), 'the failing Floors panel was really called (the check is not vacuous)');
  await js(`delete document.getElementById('floorsPop').innerHTML;0`);
  console.log('[033 repaint] 4 switches with a failing Floors panel: the office equals a full redraw each time');
};
