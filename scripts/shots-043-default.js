/*
 * Spec 043 FR-009: the folder's default agent in the New session dialog (preselect, tick, untick clears).
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-043-default.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes default-agent-1440x900.png and default-agent-1280x800.png and fails on a miss.
 */
const assert = require('assert');
const OUT = process.env.OUT || "/tmp";
module.exports = async (ctx) => {
  const open = async () => {
    await ctx.js(`document.getElementById('foldersBtn').click()`); await ctx.sleep(400);
    await ctx.js(`document.querySelector('[data-fp="new"]').click()`); await ctx.sleep(900);
  };
  const state = () => ctx.js(`(()=>{const l=document.getElementById('sdAgentL');return {shown:!!l&&!l.hidden,val:document.getElementById('sdAgent')&&document.getElementById('sdAgent').value,chk:!!document.getElementById('sdAgentDef')&&document.getElementById('sdAgentDef').checked,opts:[...document.querySelectorAll('#sdAgent option')].length}})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    await open();
    let s = await state(); console.log('[def] first', JSON.stringify(s));
    assert.ok(s.shown && s.opts === 4 && s.val === '' && !s.chk, 'no default yet');
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='docs-writer';x.dispatchEvent(new Event('change'));const c=document.getElementById('sdAgentDef');c.checked=true;})()`);
    await ctx.js(`document.getElementById('sdGo').click()`); await ctx.sleep(1200);
    await open();
    s = await state(); console.log('[def] second', JSON.stringify(s));
    assert.ok(s.val === 'docs-writer' && s.chk, 'the default is preselected and ticked');
    await ctx.js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);})()`);
    await ctx.sleep(300);
    await ctx.shot(`${OUT}/default-agent-${w}x${h}.png`);
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='reviewer';x.dispatchEvent(new Event('change'));})()`);
    s = await state(); assert.ok(!s.chk, 'another agent unticks the box');
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='docs-writer';x.dispatchEvent(new Event('change'));document.getElementById('sdAgentDef').checked=false;})()`);
    await ctx.js(`document.getElementById('sdGo').click()`); await ctx.sleep(1200);
    await open();
    s = await state(); console.log('[def] third', JSON.stringify(s));
    assert.ok(s.val === '' && !s.chk, 'unticked on the default clears it');
    await ctx.js(`document.getElementById('sdCancel').click()`); await ctx.sleep(300);
    await ctx.js(`location.reload()`); await ctx.sleep(1500);
  }
  console.log('[def] PASS');
};
