/*
 * Spec 007 FR-013..FR-018 (issue #607): the Auto routing tier in the chat's model menu. Simulator only: no AI credits, no Copilot login.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-007-autotier.js xvfb-run -a npx electron . --no-sandbox
 *
 * Runs at 1440x900 and 1280x800 and writes 007-auto-tier-<step>-<W>x<H>.png. Hugo (idle, on Auto) is the agent. Asserts on the way;
 * waits only with until() and asserts what it waited for (it never throws on a timeout).
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const HP = helpers(ctx);
  const { until, settle, js, click, text, exists, key, idOf } = HP;
  const ok = async (cond, what, ms) => assert.ok(await until(cond, ms), what);
  const label = () => js(`(document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||''`);
  const pressed = () => js(`[...document.querySelectorAll('#modelMenu [data-autotier][aria-pressed="true"]')].map(b=>b.dataset.autotier).join(',')`);
  const dlgButton = (l) => js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .btn')].find(x=>x.textContent===${jsLiteral(l)});if(!b)return false;b.click();return true})()`);
  const openMenu = async () => { await click('#modelChip'); await ok(`!!document.getElementById('modelMenu')`, 'the model menu opens'); };
  const closeMenu = async () => { if (await exists('#modelMenu')) { await key('Escape'); await ok(`!document.getElementById('modelMenu')`, 'Escape closes the menu'); } };
  const open = async (name) => {
    const id = await idOf(name); assert.ok(id, name + ' is on the floor');
    await click(`#stage [data-id="${id}"]`);
    await ok(`document.body.classList.contains('panel-open')&&!!document.getElementById('modelChip')`, 'the chat of ' + name + ' opens');
    await settle();
  };

  for (const [W, H] of [[1440, 900], [1280, 800]]) {
    const shot = async (name) => { await HP.calm({ keepActions: true }); await HP.shot(path.join(OUT, `007-auto-tier-${name}-${W}x${H}.png`), { settle: true, tag: 'autotier', what: name }); };
    await HP.load({ w: W, h: H });
    await open('Hugo');
    assert.doesNotMatch(await label(), /routing/, 'no tier chosen yet: the chip reads as before');

    // ---- 1) the group sits in the model menu (no other popup), Efficiency pressed by default, only for Auto ----
    await openMenu();
    await ok(`document.querySelectorAll('#modelMenu .mm-seg[aria-label="Auto routing"] [data-autotier]').length===3`, 'three tier buttons in the model menu');
    assert.strictEqual(await js(`[...document.querySelectorAll('#modelMenu [data-autotier]')].map(b=>b.textContent).join(',')`), 'Efficiency,Balance,Intelligence');
    assert.strictEqual(await pressed(), 'efficiency', 'Efficiency is what a new Auto session gets');
    assert.match(await text('#modelMenu'), /Auto routing/i); // the heading is upper case in CSS
    assert.strictEqual(await js(`document.querySelectorAll('[data-autotier]').length`), 3, 'the tiers live only in the model menu (no second popup)');
    await shot('menu');

    // ---- 2) a higher tier asks first with the app's dialog; Cancel changes nothing ----
    await click('#modelMenu [data-autotier="intelligence"]');
    await ok(`!!document.getElementById('modeDlg')&&!!document.querySelector('#modeDlg [aria-modal="true"]')&&document.getElementById('modeDlg').contains(document.activeElement)`, 'a modal dialog asks first');
    const dlg = await text('#modeDlg');
    assert.match(dlg, /Switch Hugo to Intelligence routing\?/);
    assert.match(dlg, /cost more per token/);
    assert.match(dlg, /not reported/);
    await shot('confirm');
    await dlgButton('Cancel');
    await ok(`!document.getElementById('modeDlg')`, 'Cancel closes the dialog');
    assert.doesNotMatch(await label(), /routing/, 'cancelled: no tier');

    // ---- 3) confirm: applied with an Undo toast, the chip names the tier, the chat says it ----
    await openMenu();
    await click('#modelMenu [data-autotier="intelligence"]');
    await ok(`!!document.getElementById('modeDlg')`, 'asks again');
    await dlgButton('Switch');
    await ok(`/intelligence routing/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')&&!!document.querySelector('#toasts .toast-act')`, 'applied: the chip says intelligence routing and Undo is offered');
    assert.match(await text('#chat'), /Model set to Auto \(Intelligence routing\)\. The next message uses it\./);
    assert.match(await text('#toasts'), /Auto \(Intelligence routing\)/);
    await openMenu();
    assert.strictEqual(await pressed(), 'intelligence', 'the menu shows the new tier');
    await closeMenu();

    // ---- 4) a lower tier applies at once (no dialog); Undo goes back ----
    await openMenu();
    await click('#modelMenu [data-autotier="balance"]');
    await ok(`/balance routing/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')`, 'a lower tier applies at once');
    assert.ok(!(await exists('#modeDlg')), 'no dialog for a lower tier');
    await ok(`!!document.querySelector('#toasts .toast-act')`, 'Undo is offered');
    await click('#toasts .toast-act');
    await ok(`/intelligence routing/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')`, 'Undo goes back to Intelligence');

    // ---- 5) another model keeps no tier group; back on Auto the agent's own tier is pressed ----
    await openMenu();
    await click('#modelMenu [data-pick="sim-fast"]');
    await ok(`!!document.getElementById('modeDlg')||/Sim Fast/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')`, 'switching to Sim Fast');
    if (await exists('#modeDlg')) await dlgButton('Switch');
    await ok(`/Sim Fast/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')`, 'on Sim Fast');
    assert.doesNotMatch(await label(), /routing/, 'the tier is not shown for another model');
    await openMenu();
    assert.ok(!(await exists('#modelMenu [data-autotier]')), 'no tier group for another model');
    await click('#modelMenu [data-pick="auto"]');
    // review on #642 (item 1): the dialog names the tier that will apply, with the higher-tier reasons
    await ok(`!!document.getElementById('modeDlg')`, 'back to Auto with Intelligence asks first');
    const back = await text('#modeDlg');
    assert.match(back, /Switch Hugo to Auto \(Intelligence routing\)\?/, 'the title names the tier');
    assert.match(back, /cost more per token/, 'with the higher-tier reason');
    await shot('back-to-auto');
    await dlgButton('Switch');
    await ok(`/Auto/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')&&/intelligence routing/.test(document.getElementById('modelChip').getAttribute('aria-label'))`, 'back on Auto with its own tier');
    await openMenu();
    assert.strictEqual(await pressed(), 'intelligence', 'the remembered tier is pressed');
    await closeMenu();

    // ---- 5b) review on #642 (item 4): Undo restores the agent's own choice, "none" included (never the tier in effect) ----
    await HP.load({ w: W, h: H });
    await open('Hugo');
    await openMenu();
    await click('#modelMenu [data-autotier="balance"]');
    await ok(`!!document.getElementById('modeDlg')`, 'Efficiency to Balance asks');
    await dlgButton('Switch');
    await ok(`/balance routing/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')&&!!document.querySelector('#toasts .toast-act')`, 'on Balance, Undo offered');
    await click('#toasts .toast-act');
    await ok(`!/routing/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')&&/back to/.test(document.getElementById('toasts').innerText)`, 'Undo goes back to no tier of its own');
    await openMenu();
    assert.strictEqual(await pressed(), 'efficiency', 'the default is pressed again');
    await closeMenu();

    // ---- 5c) review on #642 (item 3): a tier switch the runtime could not apply: the chip shows the tier still in use, the chat says so ----
    await HP.load({ w: W, h: H, query: { simtierfail: '1' } });
    await open('Hugo');
    await openMenu();
    await click('#modelMenu [data-autotier="intelligence"]');
    await ok(`!!document.getElementById('modeDlg')`, 'asks');
    await dlgButton('Switch');
    await ok(`/could not switch Auto to Intelligence routing/.test(document.getElementById('chat').innerText)`, 'the failure is a note in the chat');
    assert.match(await text('#chat'), /It still uses Efficiency routing\./);
    await ok(`!/intelligence/.test((document.getElementById('modelChip')||{getAttribute:()=>''}).getAttribute('aria-label')||'')`, 'the chip does not claim the failed tier');
    await openMenu();
    assert.strictEqual(await pressed(), 'efficiency', 'the tier in use is pressed');
    await closeMenu();

    // ---- 6) a locked organization tier: buttons disabled, the note says why, a click does nothing ----
    await HP.load({ w: W, h: H, query: { simtierlock: 'balance' } });
    await open('Hugo');
    await openMenu();
    await ok(`document.querySelectorAll('#modelMenu [data-autotier][aria-disabled="true"]').length===3`, 'locked: all three disabled');
    assert.strictEqual(await pressed(), 'balance', 'the locked tier is pressed');
    assert.match(await text('#modelMenu .mm-lock'), /Set by your organization's Copilot policy: Balance\./);
    // review on #642 (item 7): the reason is the buttons' description
    assert.strictEqual(await js(`[...document.querySelectorAll('#modelMenu [data-autotier]')].every(b=>b.getAttribute('aria-describedby')==='mmAutoLock')&&document.querySelector('#modelMenu [role="group"][aria-label="Auto routing"]').getAttribute('aria-describedby')==='mmAutoLock'&&!!document.getElementById('mmAutoLock')`), true, 'aria-describedby points at the note');
    await shot('locked');
    await click('#modelMenu [data-autotier="intelligence"]');
    assert.ok(!(await exists('#modeDlg')), 'a locked tier asks nothing');
    assert.doesNotMatch(await label(), /intelligence/, 'and changes nothing');
    await closeMenu();

    // ---- 7) review on #642 (item 2): a lock on a tier with no known name still locks (fails closed), none pressed, no name ----
    await HP.load({ w: W, h: H, query: { simtierlock: 'other' } });
    await open('Hugo');
    await openMenu();
    await ok(`document.querySelectorAll('#modelMenu [data-autotier][aria-disabled="true"]').length===3`, 'an unnamed lock disables all three');
    assert.strictEqual(await pressed(), '', 'none pressed');
    assert.match(await text('#modelMenu .mm-lock'), /^Set by your organization's Copilot policy\.$/);
    await click('#modelMenu [data-autotier="balance"]');
    assert.ok(!(await exists('#modeDlg')), 'and a click asks nothing');
    await closeMenu();
    console.log(`[autotier] ${W}x${H} checks passed`);
  }
  console.log('[autotier] all checks passed');
};
