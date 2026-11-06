/*
 * Spec 005 FR-236 (issue #1223): the agent rail's width is draggable. Simulator only (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:ui -- --only check-rail-resize
 *
 * At 1440x900 and 1280x800 (SIM=15), with a chat open so the rail shows: its right edge is a focusable vertical separator (role, orientation,
 * name, aria-valuenow/min/max that match the rail); the default is 220px; a real mouse drag widens and narrows it; ArrowRight/ArrowLeft move it by 16,
 * Shift+arrows and PageUp/PageDown by 64, Home and End go to 180 and to 40% of the window; a double-click goes back to 220; the width is back after a
 * reload (localStorage, never session data); and when the window shrinks the width is clamped to the new 40% (and returns when it grows again).
 * 15 agents still fit (the rail list scrolls inside the rail, the office does not). Every wait is until() and its result is asserted.
 * A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const wc = () => ctx.win.webContents;
  const width = () => js(`Math.round(document.querySelector('.rail').getBoundingClientRect().width)`);
  const aria = () => js(`(()=>{const g=document.getElementById('railGrip');return {role:g.getAttribute('role'),or:g.getAttribute('aria-orientation'),name:g.getAttribute('aria-label'),tab:g.tabIndex,now:+g.getAttribute('aria-valuenow'),min:+g.getAttribute('aria-valuemin'),max:+g.getAttribute('aria-valuemax')}})()`);
  const widthIs = (n, what) => ok(`Math.round(document.querySelector('.rail').getBoundingClientRect().width)===${n}`, `${what}: the rail is ${n}px wide`);
  const stored = () => js(`localStorage.getItem('durbar.railWidth')`);
  const open = async (tag) => {
    const main = await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&document.querySelector('#stage .desk[data-id="'+CSS.escape(a.id)+'"]'));return a?a.id:null})()`);
    assert.ok(main, `${tag}: a main agent's desk is on the office floor`);
    await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(main)})+'"]').click()`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.getElementById('railGrip')`, `${tag}: the chat and its rail are open`);
    await H.settle();
  };
  const gripCentre = () => js(`(()=>{const r=document.getElementById('railGrip').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  const mouse = (type, x, y, extra = {}) => wc().sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra });
  const press = async (code, mods) => { await js(`document.getElementById('railGrip').focus()`); await H.key(code, mods, { char: 'never' }); };
  const noOfficeScroll = () => js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`);

  for (const [W, Hh] of [[1440, 900], [1280, 800]]) {
    const tag = `${W}x${Hh}`;
    const max = Math.floor(W * 0.4);
    await H.load({ w: W, h: Hh });
    await H.calm({ blur: true });
    await js(`localStorage.removeItem('durbar.railWidth')`);
    await open(tag);

    // the separator and the default width
    assert.deepStrictEqual(await aria(), { role: 'separator', or: 'vertical', name: 'Resize the agent list', tab: 0, now: 220, min: 180, max }, `${tag}: separator semantics`);
    await widthIs(220, `${tag}: default`);
    assert.strictEqual(await stored(), null, `${tag}: nothing stored for the default`);

    // drag: wider, then narrower, with real mouse events
    let c = await gripCentre();
    mouse('mouseMove', c.x, c.y); mouse('mouseDown', c.x, c.y);
    mouse('mouseMove', c.x + 40, c.y); mouse('mouseMove', c.x + 80, c.y); mouse('mouseUp', c.x + 80, c.y);
    await widthIs(300, `${tag}: dragged 80px wider`);
    assert.strictEqual((await aria()).now, 300, `${tag}: aria-valuenow follows`);
    assert.strictEqual(await stored(), '300', `${tag}: the drag is remembered`);
    c = await gripCentre();
    mouse('mouseMove', c.x, c.y); mouse('mouseDown', c.x, c.y);
    mouse('mouseMove', c.x - 60, c.y); mouse('mouseMove', c.x - 400, c.y); mouse('mouseUp', c.x - 400, c.y);
    await widthIs(180, `${tag}: dragged far left stops at the minimum`);
    c = await gripCentre();
    mouse('mouseMove', c.x, c.y); mouse('mouseDown', c.x, c.y);
    mouse('mouseMove', c.x + 100, c.y); mouse('mouseMove', c.x + 2000, c.y); mouse('mouseUp', c.x + 2000, c.y);
    await widthIs(max, `${tag}: dragged far right stops at 40% of the window`);

    // keyboard
    await press('Home'); await widthIs(180, `${tag}: Home`);
    await press('Right'); await widthIs(196, `${tag}: ArrowRight`);
    await press('Right', ['shift']); await widthIs(260, `${tag}: Shift+ArrowRight`);
    await press('Left'); await widthIs(244, `${tag}: ArrowLeft`);
    await press('PageUp'); await widthIs(308, `${tag}: PageUp`);
    await press('PageDown'); await widthIs(244, `${tag}: PageDown`);
    await press('End'); await widthIs(max, `${tag}: End`);
    await press('Right'); await widthIs(max, `${tag}: ArrowRight at the maximum stays`);
    assert.strictEqual(await stored(), String(max), `${tag}: keys are remembered`);
    await press('Left'); await widthIs(max - 16, `${tag}: ArrowLeft from the maximum`);
    assert.ok(await noOfficeScroll(), `${tag}: the page does not scroll`);

    // a reload keeps it
    await H.load({ w: W, h: Hh });
    await open(tag);
    await widthIs(max - 16, `${tag}: after a reload`);

    // the window shrinks: clamped to the new 40%, and back when it grows
    const small = Math.floor(W * 0.6), smallMax = Math.floor(small * 0.4);
    ctx.win.setContentSize(small, Hh);
    await widthIs(smallMax, `${tag}: window ${small}px wide, the rail is clamped`);
    assert.strictEqual((await aria()).max, smallMax, `${tag}: aria-valuemax follows the window`);
    assert.strictEqual(await stored(), String(max - 16), `${tag}: the chosen width is not overwritten by the clamp`);
    ctx.win.setContentSize(W, Hh);
    await widthIs(max - 16, `${tag}: window back, the chosen width is back`);

    // double-click resets
    c = await gripCentre();
    mouse('mouseMove', c.x, c.y); mouse('mouseDown', c.x, c.y); mouse('mouseUp', c.x, c.y);
    mouse('mouseDown', c.x, c.y, { clickCount: 2 }); mouse('mouseUp', c.x, c.y, { clickCount: 2 });
    await widthIs(220, `${tag}: double-click resets`);
    await ok(`localStorage.getItem('durbar.railWidth')===null`, `${tag}: the reset forgets the width`);

    // 15 agents: every row reachable (the list scrolls inside the rail) and no text under 10.5px
    const fit = await js(`(()=>{const l=document.getElementById('stripList'),r=document.querySelector('.rail').getBoundingClientRect(),f=[...l.querySelectorAll('.sitem b,.sitem span')].map(e=>parseFloat(getComputedStyle(e).fontSize));return {rows:l.querySelectorAll('.sitem').length,inside:r.bottom<=innerHeight+1,minFont:Math.min(...f)}})()`);
    assert.ok(fit.rows >= 10 && fit.inside && fit.minFont >= 10.5, `${tag}: the rail list fits: ${JSON.stringify(fit)}`);
    console.log('[rail-resize]', tag, 'ok');
  }
  console.log('all checks passed');
};
