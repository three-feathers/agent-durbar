/*
 * Screenshots + UI checks for switching the model and context window inside a session (spec 030, Phase 1). Simulator only:
 * no AI credits, no Copilot login, no real session. Linux with xvfb-run:
 *
 *   npm run build
 *   MODEL_W=1440 MODEL_H=900 MODEL_OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-model.js xvfb-run -a npx electron . --no-sandbox
 *
 * Writes 030-<step>-<W>x<H>.png and asserts the behaviour on the way (a miss prints DRIVER FAILED and the run exits non-zero via the npm script).
 * Sim agents used: Noor (sim-4, idle, 91% full, compacted once, Sim Fast), Ada (sim-1, working), Jonas (card menu), Priya (sim-7, behaves like today's real adapter).
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.MODEL_OUT || '/tmp';
const W = Number(process.env.MODEL_W || 1440), H = Number(process.env.MODEL_H || 900);

module.exports = async (ctx) => {
  const HP = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js, click, text, exists, key, idOf } = HP;
  const active = () => js(`(document.activeElement||{}).id||(document.activeElement||{}).tagName||''`);
  const shot = async (name, ringFree = true) => {
    await HP.calm({ keepActions: true }); // the toasts that carry a button stay
    if (ringFree) await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.id!=='mdIn'&&document.activeElement.blur()`);
    await HP.shot(path.join(OUT, `030-${name}-${W}x${H}.png`), { settle: true, tag: 'model', what: name });
  };
  const open = async (name) => { const id = await idOf(name); assert.ok(id, name + ' is on the floor'); await click(`#stage [data-id="${id}"]`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('modelChip')`);
    await js(`(()=>{const t=document.querySelector('.prev-toggle[aria-expanded="true"]');if(t)t.click();})()`); await until(`!document.querySelector('.prev-toggle[aria-expanded="true"]')`); await settle(); return id; };
  const dlgButton = (label) => js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent===${jsLiteral(label)});if(!b)return false;b.click();return true})()`);
  const pick = (id) => click(`#modelMenu [data-pick="${id}"]`);
  const chipText = () => text('#modelChip');
  const noOverflow = async (what) => { const o = await js(`(()=>{const p=document.getElementById('panelHead')||document.body;return p.scrollWidth>p.clientWidth+1})()`); assert.ok(!o, what + ': header does not overflow sideways'); };

  ctx.win.setContentSize(W, H);
  await until(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000); await settle();

  // ---- 1) Noor: idle, near the limit, compacted once: Compact button, tier-less chip, start-fresh note ----
  await open('Noor');
  assert.match(await chipText(), /Sim Fast/, 'the model chip names the model');
  assert.ok(await exists('#compactBtn'), 'Compact action is offered (the adapter can compact)');
  assert.match(await text('#ctxChip'), /Context \d+%/);
  assert.ok(await exists('#chat .note.fresh'), 'start-fresh note appears at 90%+ after a compaction');
  assert.match(await text('#chat .note.fresh'), /New session/);
  assert.match(await text('#chat'), /Context compacted \(automatic\)/, 'the earlier compaction is a line in the chat');
  await noOverflow('chat header');
  await shot('start-fresh');

  // ---- 2) the model menu, by keyboard: Enter opens it, Escape closes it and focus returns to the chip ----
  await js(`document.getElementById('modelChip').focus()`);
  await key('Return'); await until(`!!document.getElementById('modelMenu')&&document.getElementById('modelChip').getAttribute('aria-expanded')==='true'`);
  assert.ok(await exists('#modelMenu'), 'Enter on the chip opens the menu');
  assert.strictEqual(await js(`document.getElementById('modelChip').getAttribute('aria-expanded')`), 'true');
  const menu = await text('#modelMenu');
  assert.match(menu, /Sim Deep/); assert.match(menu, /Sim Preview/); assert.match(menu, /price not reported/, 'an unpriced model says so');
  assert.match(menu, /credits per M tokens/);
  await key('Down'); await until(`!!document.getElementById('modelMenu')&&document.getElementById('modelMenu').contains(document.activeElement)`);
  assert.ok(await js(`document.getElementById('modelMenu').contains(document.activeElement)`), 'arrow keys move inside the menu');
  await shot('menu', false);
  await key('Escape'); await until(`!document.getElementById('modelMenu')&&(document.activeElement||{}).id==='modelChip'`);
  assert.ok(!(await exists('#modelMenu')), 'Escape closes the menu');
  assert.strictEqual(await active(), 'modelChip', 'focus returns to the chip');

  // ---- 3) a pricier model asks first; Escape cancels and nothing changes ----
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`);
  await pick('sim-deep'); await until(`!!document.getElementById('modeDlg')&&document.getElementById('modeDlg').contains(document.activeElement)`);
  let dlg = await text('#modeDlg');
  assert.match(dlg, /Switch Noor to Sim Deep\?/); assert.match(dlg, /costs more per token than Sim Fast/); assert.match(dlg, /Price now: in 20/);
  assert.ok(await js(`document.getElementById('modeDlg').contains(document.activeElement)`), 'focus is inside the dialog');
  await shot('confirm');
  await key('Escape'); await until(`!document.getElementById('modeDlg')&&(document.activeElement||{}).id==='modelChip'`);
  assert.ok(!(await exists('#modeDlg')), 'Escape closes the dialog');
  assert.strictEqual(await active(), 'modelChip', 'focus returns to the chip after the dialog');
  assert.match(await chipText(), /Sim Fast/, 'cancelled: the model is unchanged');

  // ---- 4) an unpriced model asks too; confirming applies it with an Undo toast and "waiting for next message" ----
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`);
  await pick('sim-preview'); await until(`!!document.getElementById('modeDlg')&&document.getElementById('modeDlg').contains(document.activeElement)`);
  dlg = await text('#modeDlg');
  assert.match(dlg, /price of Sim Preview is not reported/);
  await dlgButton('Switch'); await until(`/Sim Preview/.test((document.querySelector('#modelChip')||{}).innerText||'')&&!!document.querySelector('#toasts .toast-act')`); await settle();
  assert.match(await chipText(), /Sim Preview/);
  assert.match(await text('#ctxChip'), /waiting for next message/, 'the old window figure is not shown as if it still applied');
  assert.match(await text('#toasts'), /Sim Preview/); assert.ok(await exists('#toasts .toast-act'), 'an Undo button is offered');
  assert.match(await text('#chat'), /Model set to Sim Preview\. The next message uses it\./);
  await shot('undo-waiting');
  await click('#toasts .toast-act'); await until(`/Sim Fast/.test((document.querySelector('#modelChip')||{}).innerText||'')`); await settle();
  assert.match(await chipText(), /Sim Fast/, 'Undo goes back to the previous model');

  // ---- 5) a cheaper switch applies at once (no dialog): Sim Mid, then Sim Fast again ----
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`); await pick('sim-mid'); await until(`!!document.getElementById('modeDlg')&&document.getElementById('modeDlg').contains(document.activeElement)`);
  assert.ok(await exists('#modeDlg'), 'Fast to Mid costs more: asks');
  await dlgButton('Switch'); await until(`/Sim Mid/.test((document.querySelector('#modelChip')||{}).innerText||'')`); await settle();
  assert.match(await chipText(), /Sim Mid/);
  await click('#modelChip'); await until(`!!document.querySelector('#modelMenu [data-effort="high"]')`);
  assert.ok(await exists('#modelMenu [data-effort="high"]'), 'Sim Mid offers reasoning efforts');
  await click('#modelMenu [data-effort="high"]'); await until(`/high effort/.test((document.querySelector('#modelChip')||{}).innerText||'')`); await settle();
  assert.ok(!(await exists('#modeDlg')), 'an effort change needs no confirmation');
  assert.match(await chipText(), /high effort/);
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`); await pick('sim-fast'); await until(`/Sim Fast/.test((document.querySelector('#modelChip')||{}).innerText||'')`); await settle();
  assert.ok(!(await exists('#modeDlg')), 'a cheaper model applies directly (Undo toast instead of a dialog)');
  assert.match(await chipText(), /Sim Fast/);

  // ---- 6) manual compaction: dialog with an optional focus, result line, context drops, the start-fresh note goes away ----
  const before = await text('#ctxChip');
  await click('#compactBtn'); await until(`!!document.getElementById('modeDlg')&&!!document.getElementById('mdIn')`);
  dlg = await text('#modeDlg');
  assert.match(dlg, /Compact the context of Noor\?/); assert.match(dlg, /one model call/);
  assert.ok(await exists('#mdIn'), 'optional focus text');
  await shot('compact-dialog', false);
  await dlgButton('Compact'); await until(`/Context compacted \\(manual\\)/.test(document.getElementById('chat').innerText)`); await settle();
  assert.match(await text('#chat'), /Context compacted \(manual\): \d+(\.\d+)?k → \d+(\.\d+)?k tokens\./);
  assert.notStrictEqual(await text('#ctxChip'), before, 'the context figure changed');
  assert.ok(!(await exists('#chat .note.fresh')), 'after compaction the start-fresh note is gone');
  await shot('compaction-line');

  // ---- 7) a model change by the runtime is shown, never silent (the word "fallback" makes the simulated runtime do it) ----
  await js(`(()=>{const t=document.getElementById('msgInput');t.value='please trigger a fallback';t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  await until(`/The runtime changed the model from Sim Fast to Sim Mid/.test(document.getElementById('chat').innerText)`, 15000); await settle();
  assert.match(await text('#chat'), /The runtime changed the model from Sim Fast to Sim Mid because the request was refused/);
  assert.match(await chipText(), /Sim Mid/);
  await shot('runtime-change');

  // ---- 8) Ada is working: the switch is queued, shown on the chip, and can be cancelled ----
  await open('Ada');
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`); await pick('sim-mid'); await until(`!!document.getElementById('modeDlg')&&document.getElementById('modeDlg').contains(document.activeElement)`);
  dlg = await text('#modeDlg'); assert.match(dlg, /A reply is running/); assert.match(dlg, /spending limit of 50 AI credits is not changed/); // wording since round 6 ("spending limit")
  await dlgButton('Switch'); await until(`/→ Sim Mid/.test((document.querySelector('#modelChip')||{}).innerText||'')`);
  assert.match(await chipText(), /→ Sim Mid/, 'the chip shows the queued model');
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`);
  assert.match(await text('#modelMenu'), /Next: Sim Mid/);
  await shot('queued', false);
  await click('#modelMenu [data-cancelq]'); await until(`!/→/.test((document.querySelector('#modelChip')||{}).innerText||'')`); await settle();
  assert.doesNotMatch(await chipText(), /→/, 'cancelled: back to the current model only');
  assert.ok(await exists('#compactBtn') && (await js(`document.getElementById('compactBtn').getAttribute('aria-disabled')`)) === 'true', 'Compact is greyed while the agent works');

  // ---- 9) office: "Model and context..." in the card menu ----
  await click('#backBtn'); await until(`!document.body.classList.contains('panel-open')`); await settle();
  const jonas = await idOf('Jonas'); assert.ok(jonas);
  await js(`(()=>{const d=document.querySelector(${jsLiteral(`#stage .desk[data-id="${jonas}"]`)});const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20}));})()`);
  await until(`!!document.querySelector('#modeMenu [data-act="model"]')`);
  assert.match(await text('#modeMenu'), /Model and context…/);
  await shot('card-menu', false);
  await click('#modeMenu [data-act="model"]'); await until(`!!document.getElementById('modelMenu')`);
  assert.ok(await exists('#modelMenu'), 'the card menu opens the model menu');
  assert.match(await text('#modelMenu'), /Sim Deep/);
  assert.match(await text('#modelMenu'), /Not verified on a real account yet/, 'a not-yet-verified adapter says so in the menu');
  await shot('unverified-note', false);
  await key('Escape'); await until(`!document.getElementById('modelMenu')`);

  // ---- 10) an agent that behaves like today's real adapter: disabled with a reason, New session offered ----
  const priya = await idOf('Priya'); assert.ok(priya);
  await click(`#stage [data-id="${priya}"]`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('modelChip')`); await settle();
  assert.ok(!(await exists('#compactBtn')), 'no Compact button when the agent cannot compact');
  await click('#modelChip'); await until(`!!document.getElementById('modelMenu')`);
  const dis = await text('#modelMenu');
  assert.match(dis, /cannot change its model in place/); assert.match(dis, /New session/);
  assert.strictEqual(await js(`[...document.querySelectorAll('#modelMenu [data-pick]')].every(b=>b.getAttribute('aria-disabled')==='true')`), true, 'every model row is disabled');
  await click('#modelMenu [data-pick="sim-deep"]'); await ctx.sleep(300); // a disabled row: wait for nothing to happen
  assert.ok(await exists('#modelMenu'), 'clicking a disabled row does nothing');
  assert.ok(!(await exists('#modeDlg')));
  await shot('disabled', false);
  await click('#modelMenu [data-newsess]'); await until(`!!document.getElementById('sessDlg')`);
  assert.ok(await exists('#sessDlg'), 'New session opens the new-session dialog');
  await key('Escape'); await click('#sdCancel'); await until(`!document.getElementById('sessDlg')`);

  // ---- 11) text sizes stay at or above 10.5px in everything this feature added ----
  const small = await js(`(()=>{const out=[];for(const e of document.querySelectorAll('#panel *')){if(!e.childNodes||![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const fs=parseFloat(getComputedStyle(e).fontSize);if(fs<10.5)out.push(e.className+':'+fs);}return out.slice(0,5)})()`);
  assert.deepStrictEqual(small, [], 'no text under 10.5px');
  console.log('[model] all checks passed ' + W + 'x' + H);
};
