/*
 * Spec 097 FR-352 (issue 1550): a drag in Real office is cancelled by Escape, pointercancel, a window blur, a wheel and a scroll
 * (reorder.js `attach`: end(false) from each). check-097-drag covers Escape; this driver covers the window blur, the wheel, the scroll and the
 * pointercancel, which had no test, and that a scroll elsewhere does not end a drag. Simulator only (no AI credits); nothing is written to disk. Real mouse events start the drag (sendInputEvent), the cancel is
 * dispatched as the event the app listens to (a blur Event on window, a wheel and a scroll Event); every wait is an until().
 *
 *   npm run check:ui -- --only check-097-drag-cancel      (builds first)
 *
 * In the Photo office and the arcade, 1440x900 and 1280x800, 15 agents, it fails (exit 1) when, after a drag has started and ONE cancel:
 *   - (a) a window blur, (b) a real wheel, (b2) a wheel whose bubbling is stopped below the document (only a capture listener sees it), (c) a scroll
 *     on an ancestor of #stage, (c2) a scroll on the document, (d) a real Escape, (d2) an Escape from a focused element that stops the key's
 *     bubbling, (e) a pointercancel with the live pointer id leaves the drag on, a plate lifted or shifted (.reo-lift, .reo-slot, .reo-dragging, a
 *     transform), or the order drawn or saved changed;
 *   - (n) a scroll on an element that does NOT contain #stage (the chat scrolling) ends the drag;
 *   - or a short normal drag after the cancels does not save the swap.
 * Each case settles first (no visit about to start or end, the drawn desks match the visit record) and picks its desk afresh.
 * Not covered: a real OS-level window blur, a real scrollbar or scroll wheel moving a scroller (the page's own events are what the app listens to).
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
  const T_INIT = `(()=>{if(!window.__t){window.__t={blur:0,wheel:0,pid:null};window.addEventListener('blur',e=>{if(e.target===window)window.__t.blur++;},true);window.addEventListener('wheel',()=>{window.__t.wheel++;},{capture:true,passive:true});window.addEventListener('pointerdown',e=>{window.__t.pid=e.pointerId;},true);}window.__t.blur=0;window.__t.wheel=0;return 1})()`;
  /* the dispatch runs in the SAME page evaluation as the check that the drag is on: a real OS blur between the two cannot make a case pass */
  const atomic = (code) => "(()=>{const on=()=>document.body.classList.contains('reo-dragging');const pre=on();" + code + ";return {pre,post:on()}})()";
  const helper = (html) => "(()=>{document.querySelectorAll('#tp-aux').forEach(e=>e.remove());const d=document.createElement('div');d.id='tp-aux';d.tabIndex=-1;" + html + ";document.body.appendChild(d);return 1})()";
  /* name, kind: 'cancel' ends the drag, 'stay' must not; act(b): what is done mid-drag; atomic page code where it is a dispatch */
  const CASES = [
    { name: 'a window blur', blurs: 1, act: async () => atomic(`window.dispatchEvent(new Event('blur'))`) },
    { name: 'b real wheel', wheel: true, act: async (b) => { wc().sendInputEvent({ type: 'mouseWheel', x: Math.round(b.x), y: Math.round(b.y), deltaX: 0, deltaY: -120, canScroll: true }); await until(`window.__t.wheel>=1`, 3000); return null; } },
    { name: 'b2 wheel stopped below the document', act: async () => { await js(helper(`d.addEventListener('wheel',e=>e.stopPropagation())`)); return atomic(`document.getElementById('tp-aux').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))`); } },
    { name: 'c scroll on an ancestor of the stage', act: async () => atomic(`document.getElementById('stage').parentElement.dispatchEvent(new Event('scroll'))`) },
    { name: 'c2 scroll on the document', act: async () => atomic(`document.dispatchEvent(new Event('scroll'))`) },
    { name: 'd real Escape', act: async () => { await key('Escape', [], { char: 'never' }); return null; } },
    { name: 'd2 Escape from an element that stops the key', act: async () => { await js(helper(`d.addEventListener('keydown',e=>e.stopPropagation())`) + `&&(document.getElementById('tp-aux').focus(),document.activeElement.id==='tp-aux')`); await key('Escape', [], { char: 'never' }); return null; } },
    { name: 'e pointercancel', act: async () => atomic(`document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__t.pid,bubbles:true}))`) },
    { name: 'n scroll elsewhere does not end the drag', stay: true, act: async () => { await js(helper(`d.style.cssText='position:fixed;left:0;top:0;width:10px;height:10px;overflow:auto'`)); return atomic(`document.getElementById('tp-aux').dispatchEvent(new Event('scroll'))`); } },
  ];

  const press = async (a, b) => {
    mouse('mouseMove', a); await ctx.sleep(30); mouse('mouseDown', a);
    for (let i = 1; i <= 8; i++) { mouse('mouseMove', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, { modifiers: ['leftButtonDown'] }); await ctx.sleep(25); }
  };
  const pick = async () => { await settled(); const r = await bigRoom(); return { ...r, a: await grab(plateSel(r.o[r.k])), b: await center(plateSel(r.o[r.k + 1])), before: await saved() }; };

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await load(w, h, world);
    await js(T_INIT);
    for (const c of CASES) {
      const label = `${tag} (${c.name})`;
      const { r: A, o: O, k, a, b, before } = await pick();
      await js(T_INIT);
      await H.pointerStep('check-097-drag-cancel', label, async () => {
        await press(a, b);
        assert.strictEqual(await lifted(), true, `${label}: the drag is on before the cancel`);
        assert.ok(await classes() >= 3 && await loose() >= 2, `${label}: the plate is lifted and the others slide before the cancel`);
        const r = await c.act(b);
        if (r) { const x = await js(r); assert.strictEqual(x.pre, true, `${label}: the drag was on at the moment of the dispatch`); if (!c.stay) assert.strictEqual(x.post, false, `${label}: the cancel ends the drag (no reo-dragging, same evaluation)`); }
        await ctx.sleep(60);
        if (c.stay) {
          assert.strictEqual(await lifted(), true, `${label}: the drag is still on`);
          await key('Escape', [], { char: 'never' }); await ctx.sleep(60);
        }
        assert.strictEqual(await lifted(), false, `${label}: ${c.stay ? 'Escape then ends the drag' : 'the cancel ends the drag'} (no reo-dragging)`);
        assert.strictEqual(await classes(), 0, `${label}: no plate stays lifted (reo-lift, reo-slot, reo-dragging 0)`);
        assert.strictEqual(await loose(), 0, `${label}: nothing stays shifted`);
        assert.strictEqual(await js(`window.__t.blur`), c.blurs || 0, `${label}: the page saw ${c.blurs || 0} blur events (an OS blur from another window would make a case pass for the wrong reason)`);
        if (c.wheel) assert.ok(await js(`window.__t.wheel`) >= 1, `${label}: the real wheel reached the page`);
        mouse('mouseUp', b); await ctx.sleep(80);
      });
      await js(`document.querySelectorAll('#tp-aux').forEach(e=>e.remove())`);
      await ctx.sleep(150); /* a wrong write by a cancelled drag is synchronous with the drop; the wait only lets a late one show */
      assert.strictEqual(await lifted(), false, `${label}: still no drag after the button is released`);
      assert.strictEqual(await classes(), 0, `${label}: nothing lifted after the release`);
      assert.deepStrictEqual(await orderOf(A), O, `${label}: the order drawn is as it was`);
      assert.deepStrictEqual(await saved(), before, `${label}: nothing was saved`);
      assert.strictEqual(await panelOpen(), false, `${label}: no chat opened`);
    }
    /* a later normal drag still works */
    const { r: A, o: O, k, a, b } = await pick();
    const pa = await js(`window.__durbarSimUi.order.path('room:'+${jsLiteral(A)})`);
    await H.pointerStep('check-097-drag-cancel', `${tag} drag after the cancels`, async () => {
      await press(a, b);
      assert.strictEqual(await lifted(), true, `${tag}: the drag after the cancels starts`);
      mouse('mouseUp', b); await ctx.sleep(80);
    });
    await must(`(window.__durbarSimUi.order.get().desks[${jsLiteral(pa)}]||[]).filter(i=>${jsLiteral(O)}.includes(i)).join()===${jsLiteral(swapAt(O, k).join())}`, `${tag}: the drag after the cancels saved the swap`);
    assert.strictEqual(await classes(), 0, `${tag}: and nothing stays lifted`);
  }
  console.log('[097-drag-cancel] ok');
};
