/*
 * Spec 063: the folder chip shows the git branch and how many files changed; a click lists them. Simulator only (the sim bridge
 * answers a fixed status per agent), no git, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-063-folder-status.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const chip = () => js(`(()=>{const c=document.querySelector('#panelHead .folder');if(!c)return null;const t=c.querySelector('.fst');const r=c.getBoundingClientRect(),H=document.getElementById('panelHead').getBoundingClientRect();
    return {fst:t?t.textContent:'',role:c.getAttribute('role'),label:c.getAttribute('aria-label'),font:t?parseFloat(getComputedStyle(t).fontSize):0,inside:r.right<=H.right+0.5&&r.left>=H.left-0.5,overflowX:document.getElementById('panelHead').scrollWidth>document.getElementById('panelHead').clientWidth+1}})()`);
  const open = async (id) => {
    await js(`document.querySelector('#stage .desk[data-id="${id}"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#panelHead .folder')`, 8000);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    // sim-3: 3 changed files on main
    await open('sim-3');
    await ctx.waitFor(`!!document.querySelector('#panelHead .folder .fst')`, 5000);
    let c = await chip();
    assert.strictEqual(c.fst, ' · main · 3 changed', `${w}: chip text ${JSON.stringify(c)}`);
    assert.strictEqual(c.role, 'button', `${w}: a button when there are changes`);
    assert.match(c.label, /^Branch main, 3 changed files/);
    assert.ok(c.font >= 10.5, `${w}: legible`);
    assert.ok(c.inside && !c.overflowX, `${w}: the chip fits the header`);
    await ctx.sleep(150);
    await ctx.shot(path.join(OUT, `063-folder-chip-${w}x${h}.png`));
    await js(`document.querySelector('#panelHead .folder').click()`);
    await ctx.waitFor(`!!document.getElementById('mdT')`, 5000);
    const dlg = await js(`({t:document.getElementById('mdT').textContent,b:document.getElementById('mdB').textContent,l:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btn:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
    assert.match(dlg.t, /^Changes in [^ ]+$/, 'titled with the folder name'); assert.ok(!/Jonas|Ada|Kenji/.test(dlg.t), 'not the agent name');
    assert.strictEqual(dlg.b, 'On branch main. 3 files have changes that are not committed yet:');
    assert.deepStrictEqual(dlg.l, ['src/tools/registry.ts · +42 −17 · changed', 'src/tools/companies.ts · +118 −0 · new', 'src/tools/old-lookup.ts · +0 −64 · deleted']);
    assert.deepStrictEqual(dlg.btn, ['Open in VS Code', 'Done']);
    await ctx.sleep(450); // the dialog fades in
    await ctx.shot(path.join(OUT, `063-folder-changes-${w}x${h}.png`));
    await js(`document.querySelector('#modeDlg .dbtn .primary').click()`);
    await ctx.waitFor(`!document.getElementById('modeDlg')`, 3000);
    // sim-5: a repository with no changes: branch only, not a button
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(300);
    await open('sim-5');
    await ctx.waitFor(`!!document.querySelector('#panelHead .folder .fst')`, 5000);
    c = await chip();
    assert.strictEqual(c.fst, ' · main', `${w}: clean repository: branch only`);
    assert.strictEqual(c.role, null, `${w}: nothing to list, not a button`);
    // sim-6: not a repository: nothing added
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(300);
    await open('sim-6');
    await ctx.sleep(600);
    c = await chip();
    assert.strictEqual(c.fst, '', `${w}: not a repository: the chip is unchanged`);
  }
  console.log('[063] PASS');
};
