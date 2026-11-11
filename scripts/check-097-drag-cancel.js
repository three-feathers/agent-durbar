/*
 * Spec 097 FR-352 (issue 1550): a drag in Real office is cancelled by Escape, pointercancel, a window blur, a wheel and a scroll
 * (reorder.js `attach`: end(false) from each). check-097-drag covers Escape; this driver covers the window blur, the wheel and the scroll,
 * which had no test. Simulator only (no AI credits); nothing is written to disk. Real mouse events start the drag (sendInputEvent), the cancel is
 * dispatched as the event the app listens to (a blur Event on window, a wheel and a scroll Event); every wait is an until().
 *
 *   npm run check:ui -- --only check-097-drag-cancel      (builds first)
 *
 * In the Photo office and the arcade, 1440x900 and 1280x800, 15 agents, it fails (exit 1) when, after a drag has started and ONE cancel:
 *   - (a) a window blur, (b) a wheel on the stage, (c) a scroll on an ancestor of #stage, (c2) a scroll on the document, (d) Escape
 *     leaves the drag on, a plate lifted or shifted (.reo-lift, .reo-slot, .reo-dragging, a transform), or the order drawn or saved changed;
 *   - or a short normal drag after the cancels does not save the swap.
 * Not covered: a real OS-level window blur (the page's blur event is what the app listens to; a window that loses the OS focus fires the same one).
 */
const assert = require('assert');
const { helpers, waits, jsLiteral } = require('./driver-helpers');

const SIZES = [[1440, 900], [1280, 800]];
const WORLDS = ['photo', 'retro'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, key } = H;
  const { until } = waits(ctx);
  const wc = () => H.wc();
  const must = async (expr, what, ms = 8000) => assert.ok(await until(expr, ms), 'timed out waiting for ' + what);
  const saved = () => js(`window.__durbarSimUi.order.saved()`);
  const query = (world) => ({ officeview: 'real', simrooms: '3', sim: '15', ...(world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}) });
  const settled = async () => {
    await must(`window.__durbarSimUi.visitsSettled()`, 'no visit about to start or end', 20000);
    await must(`(()=>{const U=window.__durbarSimUi,v=new Set(U.awayIds());return U.realLayout().zones.flatMap(z=>z.desks).filter(d=>!d.lounge).every(d=>!!d.away===v.has(d.id))})()`, 'the drawn desks match the visit record', 20000);
  };
  const load = async (w, h, world) => {
    await js(`try{sessionStorage.removeItem('durbar.simorder')}catch(e){}`);
    await H.load({ w, h, query: query(world), ready: `document.querySelectorAll('#stage .ro-plate').length>=10`, readyMs: 30000, settle: false, focus: true });
    await settled();
  };
  const mouse = (type, p, extra = {}) => wc().sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1, ...extra });
  const center = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  const grab = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+Math.min(14,b.width/2),y:b.top+b.height/2}})()`);
  const plateSel = (id) => `#stage .ro-plate[data-id="${id}"]`;
  const orderOf = (room) => js(`window.__durbarSimUi.realLayout().zones.filter(z=>z.id===${jsLiteral(room)}).flatMap(z=>z.desks.filter(d=>!d.lounge).map(d=>d.id))`);
  const swapAt = (l, i) => { const c = l.slice(); [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; };
  const lifted = () => js(`document.body.classList.contains('reo-dragging')`);
  const classes = () => js(`document.querySelectorAll('.reo-lift,.reo-slot,.reo-dragging').length`);
  const loose = () => js(`[...document.querySelectorAll('#stage .ro-plate,#stage .ro-sign')].filter(e=>e.style.transform).length`);
  const panelOpen = () => js(`document.body.classList.contains('panel-open')`);
  const bigRoom = async () => {
    const away = await js(`window.__durbarSimUi.awayIds()`);
    const rooms = await js(`[...new Set(window.__durbarSimUi.agents().filter(a=>!a.parent).map(a=>a.room))]`);
    let best = null;
    for (const r of rooms) { const o = await orderOf(r); const k = o.findIndex((id, i) => i + 1 < o.length && !away.includes(id)); if (k >= 0 && o.length >= 3 && (!best || o.length > best.o.length)) best = { r, o, k }; }
    assert.ok(best, 'a room with three desks and a desk at its seat with a neighbour after it');
    return best;
  };
  /* the cancels: what the app listens to (reorder.js attach) */
  const CANCELS = [
    ['a window blur', `window.dispatchEvent(new Event('blur'))`],
    ['b wheel on the stage', `document.getElementById('stage').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))`],
    ['c scroll on an ancestor of the stage', `document.getElementById('stage').parentElement.dispatchEvent(new Event('scroll'))`],
    ['c2 scroll on the document', `document.dispatchEvent(new Event('scroll'))`],
    ['d Escape', null],
  ];

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await load(w, h, world);
    const { r: A, o: O, k } = await bigRoom();
    const before = await saved();
    for (const [name, code] of CANCELS) {
      const label = `${tag} (${name})`;
      const a = await grab(plateSel(O[k])), b = await center(plateSel(O[k + 1]));
      await H.pointerStep('check-097-drag-cancel', label, async () => {
        mouse('mouseMove', a); await ctx.sleep(30); mouse('mouseDown', a);
        for (let i = 1; i <= 8; i++) { mouse('mouseMove', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, { modifiers: ['leftButtonDown'] }); await ctx.sleep(25); }
        assert.strictEqual(await lifted(), true, `${label}: the drag is on before the cancel`);
        assert.ok(await classes() >= 3 && await loose() >= 2, `${label}: the plate is lifted and the others slide before the cancel`);
        if (code) await js(code); else await key('Escape', [], { char: 'never' });
        await ctx.sleep(60);
        assert.strictEqual(await lifted(), false, `${label}: the cancel ends the drag (no reo-dragging)`);
        assert.strictEqual(await classes(), 0, `${label}: no plate stays lifted (reo-lift, reo-slot, reo-dragging 0)`);
        assert.strictEqual(await loose(), 0, `${label}: nothing stays shifted`);
        mouse('mouseUp', b); await ctx.sleep(80);
      });
      assert.strictEqual(await lifted(), false, `${label}: still no drag after the button is released`);
      assert.strictEqual(await classes(), 0, `${label}: nothing lifted after the release`);
      assert.deepStrictEqual(await orderOf(A), O, `${label}: the order drawn is as it was`);
      assert.deepStrictEqual(await saved(), before, `${label}: nothing was saved`);
      assert.strictEqual(await panelOpen(), false, `${label}: no chat opened`);
    }
    /* a later normal drag still works */
    const a = await grab(plateSel(O[k])), b = await center(plateSel(O[k + 1])), pa = await js(`window.__durbarSimUi.order.path('room:'+${jsLiteral(A)})`);
    await H.pointerStep('check-097-drag-cancel', `${tag} drag after the cancels`, async () => {
      mouse('mouseMove', a); await ctx.sleep(30); mouse('mouseDown', a);
      for (let i = 1; i <= 8; i++) { mouse('mouseMove', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, { modifiers: ['leftButtonDown'] }); await ctx.sleep(25); }
      assert.strictEqual(await lifted(), true, `${tag}: the drag after the cancels starts`);
      mouse('mouseUp', b); await ctx.sleep(80);
    });
    await must(`(window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]||[]).filter(i=>${jsLiteral(O)}.includes(i)).join()===${jsLiteral(swapAt(O, k).join())}`, `${tag}: the drag after the cancels saved the swap`);
    assert.strictEqual(await classes(), 0, `${tag}: and nothing stays lifted`);
  }
  console.log('[097-drag-cancel] ok');
};
