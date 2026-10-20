/*
 * Spec 034 FR-014: mood words in the List view. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-034-list.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes mood-list-*.png and mood-walker-*.png (the lobby, FR-015) at both sizes. Fails when no row shows mood words, when a helper shows
 * them, when a row overflows its height, or when the words are missing from the row's accessible label.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(2500);
    await ctx.js(`document.getElementById('vList').click()`); await ctx.sleep(700);
    const r = await ctx.js(`(()=>{const rows=[...document.querySelectorAll('button.lrow')];
      return {n:rows.length, mood:rows.filter(x=>x.querySelector('.lmood')).map(x=>({name:x.querySelector('.lname').innerText, words:x.querySelector('.lmood').innerText, label:x.getAttribute('aria-label'), sub:!!x.querySelector('.lname .sub'), h:x.getBoundingClientRect().height}))};})()`);
    console.log('[034-list]', w, JSON.stringify(r.mood.map((m) => [m.name, m.words])));
    assert.ok(r.n > 0 && r.mood.length > 0, 'some rows show mood words');
    for (const m of r.mood) {
      assert.ok(!m.sub, 'helpers show no mood words');
      assert.ok(m.label.includes(m.words), 'the words are in the accessible label');
      assert.ok(m.h <= 35, 'the row keeps its height (34px since spec 052 FR-064)');
    }
    await ctx.js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);if(document.activeElement)document.activeElement.blur();})()`);
    await ctx.sleep(300);
    await ctx.shot(path.join(OUT, `mood-list-${w}x${h}.png`));
    await ctx.js(`document.getElementById('vOffice').click()`); await ctx.sleep(1500);
    // FR-015: a figure away at a place keeps its mood (in the simulator Sven is dizzy and away)
    const wk = await ctx.js(`[...document.querySelectorAll('#walkers .walker')].map(x=>({body:x.dataset.body,trouble:x.dataset.trouble,dot:getComputedStyle(x,'::after').content!=='none'}))`);
    console.log('[034-list] walkers', w, JSON.stringify(wk));
    assert.ok(wk.length > 0, 'some agent is away at a place');
    assert.ok(wk.some((x) => x.trouble === 'dizzy' && x.dot), 'the dizzy walker shows its dot');
    assert.ok(wk.filter((x) => !x.trouble).every((x) => !x.dot), 'no dot without a trouble');
    const lobby = await ctx.js(`(()=>{const r=document.querySelector('#stage .lobby');if(!r)return null;const b=r.getBoundingClientRect();return {x:Math.max(0,Math.round(b.left)),y:Math.max(0,Math.round(b.top)),width:Math.round(Math.min(b.width,${w})),height:Math.round(Math.min(b.height,${h}))};})()`);
    if (lobby && lobby.width > 0) require('fs').writeFileSync(path.join(OUT, `mood-walker-${w}x${h}.png`), (await ctx.win.webContents.capturePage({ x: lobby.x, y: lobby.y, width: lobby.width, height: Math.min(lobby.height + 24, h - lobby.y) })).toPNG());
  }
  console.log('[034-list] PASS');
};
