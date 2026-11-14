/*
 * Spec 058 (2026-11-14 delta, owner report): a server switched off for one chat stays off when the chat is closed and opened again, after
 * and after Restart session with these servers; the dialog's last line says it stays until the person switches it on.
 * Simulator only (DURBAR_SIM=15), no AI credits. The simulator's MCP bridge lives in the page (src/renderer/sim.ts), so this proves the window
 * side (the dialog asks again, the sentence) only; the saving, the app restart and the corrupt file are the node test `npm run test:mcpswitchpersist`.
 *
 *   UI_SUITE_XVFB=1 node scripts/ui-suite.js --only check-058-mcp-switch-persist
 * Shots (OUT=<dir>): 058-mcp-switch-persist-<w>x<h>.png. Prints "[058] switch persist PASS".
 * Mutant (dist copy, by hand): put 'until the app is closed' back in screens.js (the last line of the dialog): the sentence check fails.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the dialog listed servers');
    await settle();
  };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const sw = () => js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>{const b=li.querySelector('button.swt');return b?{n:li.dataset.n,on:b.getAttribute('aria-checked')==='true'}:null;}).filter(Boolean)`);
  const offNames = async () => (await sw()).filter((x) => !x.on).map((x) => x.n).sort();

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    await openMcp('sim-6');
    const before = await sw();
    const target = before.find((x) => x.on);
    assert.ok(target, 'a server is on: ' + JSON.stringify(before));
    const was = await offNames();
    await js(`document.querySelector('#agMcp button.swt[data-n=${jsLiteral(target.n)}]').click()`);
    assert.ok(await until(`${'[...document.querySelectorAll("#agMcp button.swt")]'}.some(b=>b.dataset.n===${jsLiteral(target.n)}&&b.getAttribute('aria-checked')!=='true')`), 'the switch went off');
    const want = [...was, target.n].sort();
    // close the dialog and the chat, open it again
    await closeDlg();
    await closePanel();
    await openMcp('sim-6');
    assert.deepStrictEqual(await offNames(), want, `${w}: closed and opened again, the switch is still off`);
    // Restart session with these servers
    await js(`document.getElementById('mcpRestartSess').click()`);
    if (await ctx.waitFor(`!!document.getElementById('modeDlg')`, 800)) await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Restart session').click()`);
    assert.ok(await until(`/session restarted with the current MCP servers/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`, 8000), 'Restart session went through');
    assert.deepStrictEqual(await offNames(), want, `${w}: after Restart session, still off`);
    await closeDlg();
    await closePanel();
    await openMcp('sim-6');
    assert.deepStrictEqual(await offNames(), want, `${w}: closed and opened after Restart session, still off`);
    const line = await js(`[...document.querySelectorAll('#scrDlg .dsub.small')].map(x=>x.textContent).join(' | ')`);
    assert.ok(/stays off for this agent until you switch it on/.test(line) && !/until the app is closed/.test(line), 'the dialog says how long it stays: ' + line);
    await H.shot(path.join(OUT, `058-mcp-switch-persist-${w}x${h}.png`), { prep: 'mouse', tag: '058' });
    await closeDlg();
    await closePanel();
  }
  console.log('[058] switch persist PASS');
};
