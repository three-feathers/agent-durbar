/*
 * Spec 009 FR-015/FR-017 (task T026): the VS Code chat view opens at the latest message and has Continue in VS Code.
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-009-vschat.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800: View on a long chat must be scrolled to the bottom (scrollTop + clientHeight ~ scrollHeight) with the
 * last message visible, the notes must be above the transcript, and the Continue button must be there and give a toast.
 * Writes 009-vschat-latest-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const js = ctx.js;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    const id = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Ada'));return d?d.dataset.id:null})()`);
    assert.ok(id, 'Ada (mcp-swiss) is on the floor');
    await js(`document.querySelector('#stage .desk[data-id="${id}"]').click()`); await ctx.sleep(900);
    if (!(await js(`!!document.querySelector('#prev [data-pv="view"]')`))) { await js(`document.querySelector('#prev [data-pv="toggle"]').click()`); await ctx.sleep(400); }
    await ctx.waitFor(`!!document.querySelector('#prev [data-pv="view"]')`, 5000);
    await js(`document.querySelector('#prev [data-pv="view"]').click()`); await ctx.sleep(900);
    const r = await js(`(()=>{const c=document.getElementById('chat'),b=c.querySelector('.vsbody'),n=c.querySelector('.vsnotes'),last=b.lastElementChild.getBoundingClientRect(),cr=c.getBoundingClientRect();
      return {st:c.scrollTop,ch:c.clientHeight,sh:c.scrollHeight,notesAbove:!!n&&n.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?true:false,lastIn:last.bottom<=cr.bottom+1&&last.top>=cr.top,cont:!!document.getElementById('vsCont'),banner:/cannot be continued here/.test(c.querySelector('.vsbar').innerText)};})()`);
    console.log('[009-vschat]', w, JSON.stringify(r));
    assert.ok(r.sh > r.ch * 2, 'the simulated chat is long enough to scroll');
    assert.ok(Math.abs(r.st + r.ch - r.sh) <= 2, 'opened scrolled to the bottom');
    assert.ok(r.lastIn, 'the last message is visible');
    assert.ok(r.notesAbove, 'the notes are above the transcript');
    assert.ok(r.cont && r.banner, 'Continue in VS Code is there and the banner still says it cannot be continued here');
    await js(`document.getElementById('vsCont').click()`); await ctx.sleep(400);
    assert.match(await js(`document.getElementById('toasts').innerText`), /Opening in VS Code/);
    await js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);})()`); await ctx.sleep(300);
    await ctx.shot(path.join(OUT, `009-vschat-latest-${w}x${h}.png`));
    await js(`document.getElementById('vsBack').click()`); await ctx.sleep(300);
    await js(`document.getElementById('panelClose')&&document.getElementById('panelClose').click()`); await ctx.sleep(300);
  }
  console.log('[009-vschat] PASS');
};
