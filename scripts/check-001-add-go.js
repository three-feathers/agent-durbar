/*
 * Spec 001 FR-272 (issue #1905, owner report 2026-11-19): after adding a folder the owner could not tell which room was the new one nor how to reach it.
 * The office now goes to the new room and marks it for a moment; the toast says "Added <name>." with Show. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-001-add-go
 *   ADDGO_MUTANT=nomark|noscroll|noshow   the old behaviour put back in the page (each must fail, at its own label):
 *     nomark    the room's outline is gone (never marked)       -> "the new room is marked (data-new and a visible outline)"
 *     noscroll  the office never scrolls to the room            -> "the office scrolled to the new room"
 *     noshow    the toast has no Show button                    -> "the toast has Show"
 *
 * With 40 folders (`simrooms=solo`) the office scrolls at 1440x900 and 1280x800. Add existing makes `new-folder-1` (the simulator's picker). It fails when:
 * the new room is not in view and marked (`data-new`) after the add; the toast does not say "Added new-folder-1." with Show, or the result is not announced;
 * the mark outlives 3 s + a margin, or never goes; Show (after scrolling away) does not bring the room into view and mark it again; the mark animates under
 * reduced motion (it is a still outline then) or does not animate with motion on; with floors (`simfloors=1`) the folder added to another floor is marked
 * after Show goes there; the Real office sign is marked too.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.ADDGO_MUTANT || '';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 8000), what);
  const dbg = ctx.win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const motion = (v) => dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
  const prep = () => js(`(()=>{window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});
    ${MUTANT === 'noscroll' ? 'Element.prototype.scrollIntoView=function(){};' : ''}
    ${MUTANT === 'nomark' ? `(()=>{const st=document.createElement('style');st.textContent='[data-new]{outline:none!important;animation:none!important}';document.head.appendChild(st);})();` : ''}
    ${MUTANT === 'noshow' ? `new MutationObserver(()=>{for(const b of document.querySelectorAll('.toast .toast-act'))b.remove();}).observe(document.body,{childList:true,subtree:true});` : ''}
    return true})()`);
  const addExisting = async (floor) => {
    await js(`document.getElementById('addFolder').click()`);
    await ok(`!!document.getElementById('modeDlg')`, 'the Add a folder dialog opened', 5000);
    if (floor) await js(`(()=>{const s=document.getElementById('addFloorSel');s.value=${jsLiteral(floor)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>/Add existing/.test(b.textContent)).click()`);
  };
  const roomSel = (name) => `#stage .room[data-room*=${JSON.stringify(name)}],#stage .ro-sign[data-folder*=${JSON.stringify(name)}]`;
  const inView = (sel) => `(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e||!e.getClientRects().length)return false;const b=e.getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect();return b.top>=f.top-1&&b.bottom<=f.bottom+1&&b.left>=f.left-1&&b.right<=f.right+1})()`;

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await motion('no-preference');
    await H.load({ w, h, query: { sim: '40', simrooms: 'solo', simfreeze: '1' }, ready: `document.querySelectorAll('#stage .room-head').length>=20`, readyMs: 30000, focus: true });
    await H.needFocus(tag);
    await prep();
    const sc = await js(`(()=>{const f=document.getElementById('floor');return {fit:document.getElementById('stage').dataset.fit,over:f.scrollHeight-f.clientHeight}})()`);
    assert.ok(sc.fit === 'scroll' && sc.over > 40, `${tag}: with 40 folders the office scrolls (the check needs a room out of view): ${JSON.stringify(sc)}`);
    await js(`document.getElementById('floor').scrollTop=0`);
    await ok(`document.getElementById('floor').scrollTop===0`, `${tag}: scrolled to the top`);
    await addExisting();
    const sel = roomSel('new-folder-1');
    await ok(`!!document.querySelector(${jsLiteral(sel)})`, `${tag}: the new room is drawn`);
    await ok(`(()=>{const e=document.querySelector(${jsLiteral(sel)});return e.hasAttribute('data-new')&&getComputedStyle(e).outlineStyle==='solid'})()`, `${tag}: the new room is marked (data-new and a visible outline)`, 4000);
    await ok(inView(sel), `${tag}: the office scrolled to the new room (it is wholly in view)`, 6000);
    assert.ok((await js(`document.getElementById('floor').scrollTop`)) > 0, `${tag}: the floor did scroll`);
    const t = await js(`(()=>{const e=document.querySelector('.toast.with-act');return e?{text:e.textContent,show:!![...e.querySelectorAll('.toast-act')].find(b=>/^Show$/.test(b.textContent.trim()))}:null})()`);
    assert.ok(t && /Added new-folder-1\./.test(t.text), `${tag}: the toast says Added new-folder-1. (${JSON.stringify(t)})`);
    assert.ok(t.show, `${tag}: the toast has Show`);
    assert.ok(await js(`window.__ann.some(a=>/Added new-folder-1\\./.test(a))`), `${tag}: the result is announced`);
    const anim = await js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});const c=getComputedStyle(e);return {an:c.animationName,ow:c.outlineWidth,os:c.outlineStyle}})()`);
    assert.ok(anim.os === 'solid' && parseFloat(anim.ow) >= 2, `${tag}: the mark is a 2px outline (${JSON.stringify(anim)})`);
    assert.strictEqual(anim.an, 'new-room', `${tag}: with motion on the mark pulses once (${anim.an})`);
    await ok(`!document.querySelector(${jsLiteral(sel)}).hasAttribute('data-new')`, `${tag}: the mark ends after about 3 s`, 8000);

    /* Show brings it back after the office was scrolled away */
    await js(`document.getElementById('floor').scrollTop=0`);
    await ok(`!(${inView(sel)})`, `${tag}: scrolled away from the new room`);
    await js(`[...document.querySelectorAll('.toast.with-act .toast-act')].find(b=>/^Show$/.test(b.textContent.trim())).click()`);
    await ok(`document.querySelector(${jsLiteral(sel)}).hasAttribute('data-new')`, `${tag}: Show marks the room again`, 4000);
    await ok(inView(sel), `${tag}: Show goes to the room`, 6000);
    await ok(`!document.querySelector(${jsLiteral(sel)}).hasAttribute('data-new')`, `${tag}: the second mark ends too`, 8000);

    /* reduced motion: the mark is a still outline */
    await motion('reduce');
    await js(`window.__simAddFolderSame=undefined;document.getElementById('floor').scrollTop=0`);
    await addExisting();
    await ok(`!!document.querySelector(${jsLiteral(roomSel('new-folder-2'))})`, `${tag}: the second new room is drawn`);
    await ok(`document.querySelector(${jsLiteral(roomSel('new-folder-2'))}).hasAttribute('data-new')`, `${tag}: reduced motion: the room is marked`, 4000);
    const still = await js(`(()=>{const c=getComputedStyle(document.querySelector(${jsLiteral(roomSel('new-folder-2'))}));return {an:c.animationName,os:c.outlineStyle}})()`);
    assert.ok(still.an === 'none' && still.os === 'solid', `${tag}: under reduced motion the mark is a still outline: ${JSON.stringify(still)}`);
    await motion('no-preference');
  }

  /* floors: a folder added to another floor, Show goes there and marks the room */
  {
    const [w, h] = SIZES[0], tag = `floors ${w}x${h}`;
    await H.load({ w, h, query: { sim: '15', simfloors: '1', simfreeze: '1' }, focus: true });
    await ok(`!!document.getElementById('floorsBtn')&&document.querySelectorAll('#stage .desk[data-id]').length>=1`, `${tag}: the floors office is drawn`, 15000);
    await prep();
    const here = await js(`localStorage.getItem('durbar.floor')`);
    await addExisting('f-personal');
    await ok(`!!document.querySelector('.toast.with-act')`, `${tag}: the toast shows`, 6000);
    assert.notStrictEqual(await js(`localStorage.getItem('durbar.floor')`), 'f-personal', `${tag}: adding does not move the person by itself (here ${here})`);
    await js(`document.querySelector('.toast.with-act .toast-act').click()`);
    await ok(`localStorage.getItem('durbar.floor')==='f-personal'`, `${tag}: Show went to the floor`, 6000);
    await ok(`!!document.querySelector(${jsLiteral(roomSel('new-folder-1'))})&&document.querySelector(${jsLiteral(roomSel('new-folder-1'))}).hasAttribute('data-new')`, `${tag}: the new room on that floor is marked`, 8000);
  }

  /* Real office: the sign is marked */
  {
    const [w, h] = SIZES[0], tag = `real ${w}x${h}`;
    await H.load({ w, h, query: { sim: '15', simrooms: 'solo', simfreeze: '1', officeview: 'real' }, ready: `document.querySelectorAll('#stage .ro-sign .ro-sc').length>=10`, readyMs: 30000, focus: true });
    await prep();
    await addExisting();
    await ok(`!!document.querySelector(${jsLiteral(roomSel('new-folder-1'))})`, `${tag}: the new sign is drawn`, 10000);
    await ok(`document.querySelector(${jsLiteral(roomSel('new-folder-1'))}).hasAttribute('data-new')`, `${tag}: the new room is marked (Real office sign)`, 4000);
    await ok(`!document.querySelector(${jsLiteral(roomSel('new-folder-1'))}).hasAttribute('data-new')`, `${tag}: the sign's mark ends`, 8000);
  }
  console.log('check-001-add-go: all checks passed');
};
