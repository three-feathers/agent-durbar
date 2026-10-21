/*
 * Spec 065 FR-003/FR-004/FR-007: the note after a turn that changed files, the preview dialog, the restore and "Undo the undo",
 * and the refusal when a file changed since. Simulator only (`simcheckpoint=1` / `=conflict`), no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-checkpoints.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const shot = (name) => H.shot(path.join(OUT, name));
  const open = async (w, h, mode) => {
    await H.load({ w, h, query: { simcheckpoint: mode } });
    await js(`document.querySelector('#stage .desk[data-id="sim-1"]').click()`);
    await ctx.waitFor(`!!document.querySelector('.ckpt-note [data-act="ckptUndo"]')`, 8000);
    await js(`document.querySelector('.ckpt-note').scrollIntoView({block:'center'})`);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await open(w, h, '1');
    const note = await js(`(()=>{const n=document.querySelector('.ckpt-note'),b=n.querySelector('[data-act="ckptUndo"]'),R=n.getBoundingClientRect(),r=b.getBoundingClientRect();return {text:n.textContent,btn:b.textContent,inside:r.left>=R.left&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5,font:parseFloat(getComputedStyle(n).fontSize)}})()`);
    assert.match(note.text, /^Changed 3 files in this turn: src\/tools\/registry\.ts, src\/tools\/companies\.ts \(new\), src\/tools\/old-lookup\.ts \(deleted\)\. 1 change cannot be undone \(dist\/bundle\.js: too large to undo\)\./, `${w}: note text: ${note.text}`);
    assert.strictEqual(note.btn, 'Undo these changes…');
    assert.ok(note.inside && note.font >= 10.5, `${w}: the button sits inside a legible note`);
    await shot(`065-checkpoint-note-${w}x${h}.png`);

    await js(`document.querySelector('.ckpt-note [data-act="ckptUndo"]').click()`);
    await ctx.waitFor(`!!document.getElementById('mdT')`, 5000);
    const dlg = await js(`({t:document.getElementById('mdT').textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),b:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent),focus:document.activeElement&&document.activeElement.textContent})`);
    assert.strictEqual(dlg.t, 'Undo these changes?');
    assert.deepStrictEqual(dlg.l, ['Restore src/tools/registry.ts (+2 −1)', 'Remove src/tools/companies.ts (the agent created it)', 'Create src/tools/old-lookup.ts again (the agent deleted it)', 'Not covered: dist/bundle.js (too large to undo)']);
    assert.deepStrictEqual(dlg.b, ['Cancel', 'Restore 3 files']);
    assert.strictEqual(dlg.focus, 'Cancel', `${w}: writing files: focus starts on Cancel`);
    await shot(`065-checkpoint-dialog-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent==='Restore 3 files').click()`);
    await ctx.waitFor(`document.querySelectorAll('.ckpt-note').length===2`, 5000);
    const after = await js(`(()=>{const n=[...document.querySelectorAll('.ckpt-note')];return {first:n[0].querySelector('[data-act="ckptUndo"]').textContent,disabled:n[0].querySelector('[data-act="ckptUndo"]').disabled,second:n[1].textContent,btn:(n[1].querySelector('[data-act="ckptUndo"]')||{}).textContent}})()`);
    assert.deepStrictEqual([after.first, after.disabled], ['Undone', true]);
    assert.match(after.second, /^Restored 3 files: src\/tools\/registry\.ts, src\/tools\/companies\.ts \(deleted\), src\/tools\/old-lookup\.ts \(new\)\./);
    assert.strictEqual(after.btn, 'Undo the undo…');
    await js(`document.querySelectorAll('.ckpt-note')[1].scrollIntoView({block:'center'})`);
    await shot(`065-checkpoint-restored-${w}x${h}.png`);

    // a file changed since the turn: the dialog says nothing will be restored, and names it
    await open(w, h, 'conflict');
    await js(`document.querySelector('.ckpt-note [data-act="ckptUndo"]').click()`);
    await ctx.waitFor(`!!document.getElementById('mdT')`, 5000);
    const c = await js(`({t:document.getElementById('mdT').textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),b:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
    assert.deepStrictEqual(c, { t: 'These changes cannot be undone now', l: ['src/tools/registry.ts'], b: ['OK'] });
    await shot(`065-checkpoint-conflict-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')][0].click()`);
  }
  console.log('[checkpoints] all checks passed');
};
