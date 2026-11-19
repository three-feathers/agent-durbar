/*
 * Spec 030 FR-068..FR-070 (issue #1909): a model list that failed or came back empty is asked for again when the menu opens, and says so when it
 * stays unavailable. Simulator only (no AI credits, no account).
 *
 *   npm run check:ui -- --only check-model-list-unavailable
 *   OUT=<folder>   (optional) where the pictures go
 *
 * At 1440x900 and 1280x800, Hugo (a Copilot agent), page address `simmodelfail=`:
 *   once   the first list call fails (the owner's report), the menu asks again with fresh:true and shows the full list, no restart;
 *   error  the menu says "Model list unavailable: <reason>" and Retry; Retry asks once more per press; never the one-row menu with a price claim;
 *   hidden the same, plus "3 models are hidden by your account's policy".
 * A miss is listed and fails the run at the end (DRIVER FAILED).
 */
const path = require('path');
const { helpers } = require('./driver-helpers');
const OUT = process.env.OUT || process.env.SHOTS_OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js, click, exists, key, idOf } = H;
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('FAIL ' + msg); } };
  const calls = () => js(`JSON.stringify(window.__simListCalls||[])`).then((r) => JSON.parse(r || '[]'));
  const rows = () => js(`[...document.querySelectorAll('#modelMenu [data-pick]')].length`);
  const menuText = () => js(`(document.getElementById('modelMenu')||{textContent:''}).textContent`);
  const open = async () => {
    const id = await idOf('Hugo');
    await click(`#stage [data-id="${id}"]`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('modelChip')`);
    await settle();
  };
  for (const [W, Hh] of [[1440, 900], [1280, 800]]) {
    const shot = async (name) => { await H.calm({ keepActions: true }); await H.shot(path.join(OUT, `030-model-list-${name}-${W}x${Hh}.png`), { settle: true, tag: 'modellist', what: name }); };
    const closeMenu = async () => { if (await exists('#modelMenu')) { await key('Escape'); await until(`!document.getElementById('modelMenu')`); } };

    // ---- once: first call fails, the menu retries, the full list shows without a restart ----
    await H.load({ w: W, h: Hh, query: { simmodelfail: 'once' }, ready: 'fit' });
    await open();
    check((await calls())[0] && (await calls())[0].fresh === false, 'the start-up call was not fresh');
    await click('#modelChip');
    check(await until(`document.querySelectorAll('#modelMenu [data-pick]').length>1`), 'once: the menu fills with the full list after the retry');
    const c1 = await calls();
    check(c1.length === 2 && c1[1].fresh === true, 'once: exactly one more call, fresh: ' + JSON.stringify(c1));
    check(!/Model list unavailable/.test(await menuText()), 'once: no unavailable line once the list is back');
    await closeMenu();

    // ---- error: unavailable + Retry, one call per open and per press ----
    await H.load({ w: W, h: Hh, query: { simmodelfail: 'error' }, ready: 'fit' });
    await open();
    await click('#modelChip');
    check(await until(`!!document.querySelector('#modelMenu [data-retrylist]')`), 'error: a Retry button shows');
    let t = await menuText();
    check(/Model list unavailable: the sign-in was not accepted/.test(t), 'error: the reason is shown: ' + t.slice(0, 120));
    check(!/price not reported/.test(t), 'error: no price claim for the current model');
    check(/Current model/.test(t), 'error: the current model is labelled');
    check((await rows()) === 1, 'error: the current model is the only row');
    const n1 = (await calls()).length;
    await shot('unavailable');
    await click('#modelMenu [data-retrylist]');
    check(await until(`!!document.querySelector('#modelMenu [data-retrylist]')`), 'error: Retry answers again');
    const n2 = (await calls()).length;
    check(n2 === n1 + 1, 'error: one press = one call (' + n1 + ' -> ' + n2 + ')');
    await settle();
    check((await calls()).length === n2, 'error: no loop');
    const fs = await js(`parseFloat(getComputedStyle(document.querySelector('#modelMenu .mm-unavail .mm-why')).fontSize)`);
    check(fs >= 10.5, 'error: text at least 10.5px: ' + fs);
    await closeMenu();

    // ---- hidden: the policy count ----
    await H.load({ w: W, h: Hh, query: { simmodelfail: 'hidden' }, ready: 'fit' });
    await open();
    await click('#modelChip');
    check(await until(`!!document.querySelector('#modelMenu [data-retrylist]')`), 'hidden: a Retry button shows');
    t = await menuText();
    check(/3 models are hidden by your account's policy/.test(t), 'hidden: the count is shown: ' + t.slice(0, 160));
    await shot('hidden');
    await closeMenu();
  }
  if (fails.length) throw new Error('DRIVER FAILED: ' + fails.length + ' miss(es)\n' + fails.join('\n'));
  console.log('check-model-list-unavailable: ok');
};
