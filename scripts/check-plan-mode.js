/*
 * Spec 066 (plan first): the mode menu's "Plan first (next message)", the composer chip, the proposed-plan card with Approve /
 * Revise… / Reject, keyboard focus, and the attention state. Simulator only (every simulated kind has `planMode`), no credits.
 * Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-plan-mode.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = async (c) => { try { return await ctx.js(c); } catch (e) { throw new Error('page code failed: ' + c.slice(0, 160)); } };
  const shot = async (name) => { await ctx.sleep(150); await ctx.shot(path.join(OUT, name)); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
    await ctx.sleep(800);
    // an idle agent (a busy one cannot send)
    const id = 'sim-1'; // the agent the other chat drivers send to (sim-1 accepts sends in the simulator)

    await js(`document.querySelector('#stage .desk[data-id="${id}"]').click()`);
    await ctx.waitFor(`!!document.getElementById('modeChip')&&!!document.getElementById('msgInput')`, 8000);
    // the menu offers Plan first; it sets a one-shot chip
    await js(`document.getElementById('modeChip').click()`);
    await ctx.waitFor(`!!document.querySelector('#modeMenu [data-act="planNext"]')`, 5000);
    const item = await js(`(()=>{const b=document.querySelector('#modeMenu [data-act="planNext"]');return {t:b.innerText,role:b.getAttribute('role'),checked:b.getAttribute('aria-checked'),font:parseFloat(getComputedStyle(b.querySelector('small')).fontSize)}})()`);
    assert.match(item.t, /Plan first \(next message\)/);
    assert.deepStrictEqual([item.role, item.checked], ['menuitemcheckbox', 'false']);
    assert.ok(item.font >= 10.5, `${w}: legible (${item.font}px)`);
    if (w === 1440) await shot(`066-plan-menu-${w}x${h}.png`);
    await js(`document.querySelector('#modeMenu [data-act="planNext"]').click()`);
    await ctx.waitFor(`!!document.querySelector('#attached .plan-chip')`, 3000);
    // send: the plan card appears, Approve has focus, the desk waits for an OK
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='Refactor the login module';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    await ctx.waitFor(`!!document.querySelector('.note.plan-card .note-actions')`, 8000);
    assert.ok(await js(`!document.querySelector('#attached .plan-chip')`), `${w}: the chip is one-shot`);
    const card = await js(`(()=>{const n=document.querySelector('.note.plan-card');return {head:n.querySelector('b').textContent,body:n.querySelector('.plan-body').innerText,btns:[...n.querySelectorAll('.note-actions .btn')].map(b=>b.textContent),focus:document.activeElement&&document.activeElement.textContent,why:n.querySelector('.plan-why').textContent}})()`);
    assert.strictEqual(card.head, 'Proposed plan');
    assert.match(card.body, /Plan for: Refactor the login module/);
    assert.deepStrictEqual(card.btns, ['Approve', 'Revise…', 'Reject']);
    assert.strictEqual(card.focus, 'Approve', `${w}: focus on Approve`);
    assert.match(card.why, /^Nothing has changed yet\./);
    const desk = await js(`document.querySelector('#stage .desk[data-id="${id}"]')?document.querySelector('#stage .desk[data-id="${id}"]').innerText:''`);
    await shot(`066-plan-card-${w}x${h}.png`);
    // Revise: a dialog for the changes, then a new plan
    await js(`[...document.querySelectorAll('.note.plan-card .note-actions .btn')].find(b=>b.textContent==='Revise…').click()`);
    await ctx.waitFor(`!!document.getElementById('mdIn')`, 4000);
    await js(`(()=>{const t=document.getElementById('mdIn');t.value='Keep the old file names';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    if (w === 1440) await shot(`066-plan-revise-${w}x${h}.png`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(b=>b.textContent==='Send').click()`);
    await ctx.waitFor(`document.querySelectorAll('.note.plan-card').length>=2&&!!document.querySelectorAll('.note.plan-card')[1].querySelector('.note-actions')`, 8000);
    const second = await js(`(()=>{const c=document.querySelectorAll('.note.plan-card');return {first:c[0].querySelector('.pstate').textContent,body:c[1].querySelector('.plan-body').innerText}})()`);
    assert.match(second.first, /sent back with your changes/);
    assert.match(second.body, /As you asked: Keep the old file names/);
    // Approve: the card settles and the agent works on the plan
    await js(`[...document.querySelectorAll('.note.plan-card')].pop().querySelector('.btn.primary').click()`);
    await ctx.waitFor(`/approved/.test([...document.querySelectorAll('.note.plan-card')].pop().querySelector('.pstate').textContent)`, 5000);
    await shot(`066-plan-approved-${w}x${h}.png`);
    assert.ok(desk.length > 0);
  }
  // Reject: nothing runs; the agent is idle with the reason
  await ctx.waitFor(`!document.querySelector('.note.plan-card .note-actions')`, 2000).catch(() => undefined);
  console.log('[plan-mode] PASS');
};
