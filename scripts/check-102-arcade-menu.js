/*
 * Spec 102 T317 (issue #1399): the folder menu on a folder sign in the arcade. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1), no AI
 * credits; every wait is an until(). At 1440x900 and 1280x800, 15 agents in 3 folders, the arcade (worldflags=retro&world=retro):
 *   - the sign's menu button (`.ro-sb[data-foldermenu]`) opens the folder menu, which lists Move earlier and Move later;
 *   - in the arcade the rooms stay in their cells (spec 097 FR-354; app.js reoStepModel): either item says "keeps its place in the arcade", the signs do not move and
 *     no order is saved (Photo's rooms do move: check-097-order).
 *   ARCMENU_MUTANT=swallow|move|save   (each must fail at its own assert) the item's click is swallowed ("the menu's Move earlier says") / a sign is moved
 *                        after the click ("the signs stay in their cells") / a desk order is saved after the click ("no order was saved")
 *
 *   npm run check:ui -- --only check-102-arcade-menu
 */
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const MUTANT = process.env.ARCMENU_MUTANT || '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const { until } = waits(ctx);
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + (typeof what === 'function' ? await what() : what));
  const signs = () => js(`[...document.querySelectorAll('#stage .ro-sb[data-foldermenu]')].map(b=>b.dataset.foldermenu)`);

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h} arcade`;
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: { officeview: 'real', simrooms: '3', sim: '15', worldflags: 'retro', world: 'retro' }, ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world`), 'retro', `${tag}: the arcade is shown`);
    const before = await signs();
    assert.ok(before.length >= 3, `${tag}: three folder signs with a menu button (${before})`);
    const second = before[1];
    if (MUTANT === 'swallow') await js(`(()=>{document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#modeMenu [data-fact="rup"],#modeMenu [data-fact="rdn"]'))e.stopImmediatePropagation()},true);return 1})()`);
    const open = async (id) => {
      await js(`document.getElementById('modeMenu')&&document.getElementById('modeMenu').remove();document.querySelector(${jsLiteral(`#stage .ro-sb[data-foldermenu="${id}"]`)}).click()`);
      await must(`!!document.querySelector('#modeMenu [data-fact="rup"]')`, `${tag}: the sign's menu button opens the folder menu with Move earlier`);
      return js(`[...document.querySelectorAll('#modeMenu [data-fact]')].map(e=>e.dataset.fact+':'+(e.getAttribute('aria-disabled')||''))`);
    };
    const mn = await open(second);
    assert.ok(mn.includes('rup:') && mn.includes('rdn:'), `${tag}: the folder menu lists Move earlier and Move later on a sign (${mn})`);
    const doc0 = await js(`window.__durbarSimUi.order.saved().then(d=>JSON.stringify(d))`);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    await js(`document.querySelector('#modeMenu [data-fact="rup"]').click()`);
    await must(`/keeps its place in the arcade/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: the menu's Move earlier says the room keeps its place in the arcade`);
    await open(second);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    await js(`document.querySelector('#modeMenu [data-fact="rdn"]').click()`);
    await must(`/keeps its place in the arcade/.test(document.getElementById('srAnnounce').textContent)`, `${tag}: and Move later says so too`);
    if (MUTANT === 'move') await js(`(()=>{const e=document.querySelector('#stage .ro-sb[data-foldermenu]').closest('.ro-sign');e.parentNode.appendChild(e);return 1})()`);
    if (MUTANT === 'save') {
      const ids = await js(`(()=>{const away=new Set(window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.away||d.lounge).map(d=>d.id));return [...document.querySelectorAll('#stage .ro-plate[data-id]:not([data-surface="lounge"])')].map(p=>p.dataset.id).filter(id=>!away.has(id))})()`);
      for (const id of ids) { await js(`(()=>{const e=document.querySelector(${jsLiteral(`#stage .ro-plate[data-id="${id}"]`)});e.focus({preventScroll:true});return 1})()`); await H.key('Right', ['alt'], { char: 'never' }); if (await until(`Object.keys(window.__durbarSimUi.order.get().desks).length>0`, 800)) break; }
    }
    assert.deepStrictEqual(await signs(), before, `${tag}: the signs stay in their cells`);
    assert.strictEqual(await js(`window.__durbarSimUi.order.saved().then(d=>JSON.stringify(d))`), doc0, `${tag}: and no order was saved`);
    console.log(`[arcade-menu] ${tag} ok`);
  }
  console.log('[arcade-menu] all checks passed');
};
