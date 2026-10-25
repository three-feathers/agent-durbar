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
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || "/tmp";
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  /* spec 021 FR-057 (review of #752): an assert waits on the condition it asserts, never on a fixed sleep */
  const until = async (expr, what) => { assert.ok(await ctx.waitFor(expr, 10000), 'timed out waiting for ' + what); };
  /** Open the New session dialog; `val`: the agent the picker must show once it has filled in (the saved default, or none). */
  const open = async (val) => {
    await ctx.js(`document.getElementById('foldersBtn').click()`); await until(`!!document.querySelector('[data-fp="new"]')`, 'the folders menu');
    await ctx.js(`document.querySelector('[data-fp="new"]').click()`);
    await until(`(()=>{const x=document.getElementById('sdAgent');return !!x&&x.options.length===4&&x.value===${JSON.stringify(val)}})()`, `the agent picker to show ${JSON.stringify(val)}`);
  };
  const closed = () => until(`!document.getElementById('sdGo')`, 'the dialog to close');
  const state = () => ctx.js(`(()=>{const l=document.getElementById('sdAgentL');return {shown:!!l&&!l.hidden,val:document.getElementById('sdAgent')&&document.getElementById('sdAgent').value,chk:!!document.getElementById('sdAgentDef')&&document.getElementById('sdAgentDef').checked,opts:[...document.querySelectorAll('#sdAgent option')].length}})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await until(`document.querySelectorAll('#stage .desk[data-id]').length>=10&&!!document.getElementById('foldersBtn')`, 'the office');
    await open('');
    let s = await state(); console.log('[def] first', JSON.stringify(s));
    assert.ok(s.shown && s.opts === 4 && s.val === '' && !s.chk, 'no default yet');
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='docs-writer';x.dispatchEvent(new Event('change'));const c=document.getElementById('sdAgentDef');c.checked=true;})()`);
    await ctx.js(`document.getElementById('sdGo').click()`); await closed();
    await open('docs-writer');
    s = await state(); console.log('[def] second', JSON.stringify(s));
    assert.ok(s.val === 'docs-writer' && s.chk, 'the default is preselected and ticked');
    await H.shot(path.join(OUT, `default-agent-${w}x${h}.png`), { prep: 'calm', delay: 300 });
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='reviewer';x.dispatchEvent(new Event('change'));})()`);
    s = await state(); assert.ok(!s.chk, 'another agent unticks the box');
    await ctx.js(`(()=>{const x=document.getElementById('sdAgent');x.value='docs-writer';x.dispatchEvent(new Event('change'));document.getElementById('sdAgentDef').checked=false;})()`);
    await ctx.js(`document.getElementById('sdGo').click()`); await closed();
    await open('');
    s = await state(); console.log('[def] third', JSON.stringify(s));
    assert.ok(s.val === '' && !s.chk, 'unticked on the default clears it');
    await ctx.js(`document.getElementById('sdCancel').click()`); await closed();
    await ctx.js(`location.reload()`); await until(`document.querySelectorAll('#stage .desk[data-id]').length>=10`, 'the office after the reload');
  }
  console.log('[def] PASS');
};
