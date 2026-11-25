/*
 * Spec 118 T015 (FR-011, FR-016, FR-464, SC-004): Durbar's own update check in the window, with the simulator's canned feed
 * (`simselfupd=update|hostile|breaking`; nothing is contacted, nothing downloads). At 1440x900 and 1280x800 with DURBAR_SIM=15:
 *
 *   npm run build
 *   OUT=/tmp/shots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-selfupdate-dialog.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: without the canned feed nothing is shown; one toast per version and the More menu line; the dialog (title, "N releases come with
 * it", the source line, the notes as text: a hostile body's markup is never an element and its handlers never run, SC-004); Escape closes
 * and the focus goes back to the More button; the breaking card's tick box gates "Open the release page", and only the target version is
 * sent; Skip and Remind me in 7 days take the menu line away; Settings > About: the state, the source, the switch, Check now and FR-006's
 * words; text at least 10.5 px; the dialog and its buttons inside the window. Prints "[118] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name, prep) => H.shot(path.join(OUT, name), { prep: prep || 'mouse', tag: '118' });
  const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const focusPage = () => { ctx.win.show(); ctx.win.focus(); ctx.win.webContents.focus(); }; // key events need a focused page (xvfb has no window manager)
  const dlgOpen = `!!document.querySelector('#modeDlg .su-dlg')`;
  const dlgBtn = (label) => js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .dbtn .btn')].find(x=>x.textContent.trim()===${jsLiteral(label)});if(!b||b.disabled)return false;b.click();return true})()`);
  const menuShown = `(()=>{const i=document.getElementById('selfUpdItem');return !!i&&!i.hidden})()`;
  const openFromMenu = async () => {
    await js(`document.getElementById('topMoreBtn').click()`); await until(`!document.getElementById('topMoreMenu').hidden`);
    await js(`document.getElementById('selfUpdItem').click()`); await until(dlgOpen); await settle();
  };
  // every element with text in `scope` is at least 10.5 px (calm UI)
  const minFont = (scope) => js(`Math.min(...[...document.querySelectorAll(${jsLiteral(scope)})].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)))`);
  // the dialog box and each button sit inside the window, and nothing in the notes runs wider than its box
  const fits = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg').getBoundingClientRect();const inWin=d.left>=0&&d.top>=0&&d.right<=innerWidth+0.5&&d.bottom<=innerHeight+0.5;const btns=[...document.querySelectorAll('#modeDlg .dbtn .btn')].every(b=>{const r=b.getBoundingClientRect();return r.left>=d.left-0.5&&r.right<=d.right+0.5&&r.bottom<=d.bottom+0.5});const rels=document.querySelector('#modeDlg .su-rels');const noX=!rels||rels.scrollWidth<=rels.clientWidth+1;return {inWin,btns,noX}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // the simulator's canned releases sit just above the app's own version (appversion.js), so About and the dialog agree
    await H.load({ w, h, ready: 'fit' });
    const run = String(await js(`window.DurbarAppVersion`)).match(/^(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
    const V = { run: run.join('.'), p1: `${run[0]}.${run[1]}.${run[2] + 1}`, p2: `${run[0]}.${run[1]}.${run[2] + 2}`, minor: run[0] === 0 ? `0.${run[1] + 1}.0` : `${run[0] + 1}.0.0` };
    // ---- no canned feed: nothing about Durbar's own update anywhere (a dev run or the plain simulator never checks)
    await settle();
    assert.strictEqual(await js(menuShown), false, 'no feed: no More menu line');
    assert.strictEqual(await js(`/is available/.test(document.getElementById('toasts').textContent)`), false, 'no feed: no toast');
    await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.getElementById('aboutH')`); await settle();
    assert.strictEqual(await js(`document.getElementById('selfUpdBlock').hidden`), true, 'no feed: no Updates block in About');

    // ---- an update: one toast, the More menu line, the dialog; Escape closes and the focus goes back to the More button
    await H.load({ w, h, query: { simselfupd: 'update' }, ready: 'fit' });
    await until(`document.getElementById('toasts').textContent.includes(${jsLiteral('Agent Durbar v' + V.p2 + ' is available.')})`);
    await until(menuShown);
    await settle();
    assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].filter(t=>/is available/.test(t.textContent)).length`), 1, 'FR-463: one toast');
    assert.strictEqual(await js(`document.getElementById('selfUpdWord').textContent`), 'Update available: v' + V.p2, 'FR-464: the menu line names the version');
    assert.ok((await minFont('#toasts .toast')) >= 10.5, 'toast text at least 10.5 px');
    await js(`document.getElementById('topMoreBtn').click()`); await until(`!document.getElementById('topMoreMenu').hidden`); await settle();
    assert.ok((await minFont('#topMoreMenu')) >= 10.5, 'menu text at least 10.5 px');
    if (w === 1440) await shot(`118-update-toast-${w}x${h}.png`);
    await js(`document.getElementById('selfUpdItem').click()`); await until(dlgOpen); await settle();
    const d1 = await js(`({t:document.getElementById('mdT').textContent,b:document.getElementById('mdB').textContent,src:(document.querySelector('#modeDlg .su-src')||{}).textContent,card:!!document.getElementById('suTick'),btns:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent+(x.disabled?'(off)':'')),rels:[...document.querySelectorAll('#modeDlg .su-rel summary')].map(s=>s.textContent),open:[...document.querySelectorAll('#modeDlg .su-rel')].map(x=>x.open),nodl:(document.querySelector('#modeDlg .su-nodl')||{}).textContent,role:document.querySelector('#modeDlg .dlg').getAttribute('role'),modal:document.querySelector('#modeDlg .dlg').getAttribute('aria-modal')})`);
    assert.strictEqual(d1.t, 'Update available: v' + V.p2);
    assert.strictEqual(d1.b, `You are running v${V.run}. 2 releases come with it.`);
    assert.strictEqual(d1.src, 'Updates from three-feathers/agent-durbar (built in)', 'FR-002: the source in the dialog');
    assert.strictEqual(d1.card, false, 'not breaking: no tick box');
    assert.deepStrictEqual(d1.btns, ['Close', 'Skip this version', 'Remind me in 7 days', 'Open the release page'], 'FR-464: the buttons (the release page in place of Download until T017)');
    assert.deepStrictEqual(d1.rels, [`v${V.p2} · 2026-11-24`, `v${V.p1} · 2026-11-23`], 'newest first, with dates');
    assert.deepStrictEqual(d1.open, [true, false], 'the newest open, older ones folded');
    assert.match(d1.nodl, /does not download or install updates yet/, 'the dialog says nothing downloads');
    assert.ok(d1.role === 'alertdialog' && d1.modal === 'true', 'a modal dialog for screen readers');
    assert.ok((await minFont('#modeDlg')) >= 10.5, 'dialog text at least 10.5 px');
    const f1 = await fits();
    assert.deepStrictEqual(f1, { inWin: true, btns: true, noX: true }, 'the dialog and its buttons fit the window');
    if (w === 1280) await shot(`118-update-dialog-${w}x${h}.png`, 'toasts');
    focusPage();
    await H.key('Escape'); await until(`!document.getElementById('modeDlg')`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'topMoreBtn', 'Escape closes, the focus goes back to the More button');
    assert.strictEqual(await js(menuShown), true, 'Close keeps the menu line');

    // ---- SC-004: a hostile body shows as text: no element from it, no handler ran; Skip takes the line away
    await H.load({ w, h, query: { simselfupd: 'hostile' }, ready: 'fit' });
    await until(menuShown);
    await openFromMenu();
    const x = await js(`(()=>{const n=document.querySelector('#modeDlg .su-notes');return {kids:n.children.length,html:n.innerHTML,text:n.textContent,bad:document.querySelectorAll('#modeDlg img,#modeDlg script,#modeDlg a,#modeDlg .su-rels b').length,tags:[...new Set([...document.querySelectorAll('#modeDlg .su-rels *')].map(e=>e.tagName))].sort(),xss:window.__suXss||0,clip:/Shortened: the release page has the rest/.test(document.querySelector('#modeDlg .su-rels').textContent)}})()`);
    assert.strictEqual(x.kids, 0, 'SC-004: the notes hold no element');
    assert.ok(!/<img|<script|<b>/i.test(x.html), 'SC-004: the notes innerHTML holds no element from the body (only escaped text)');
    assert.ok(x.text.includes('<img src=x onerror="window.__suXss=1"><script>window.__suXss=2</script>') && x.text.includes('[click me](javascript:window.__suXss=3)'), 'SC-004: the markup is shown as text');
    assert.strictEqual(x.bad, 0, 'SC-004: no img, script, link or bold element in the dialog notes');
    assert.deepStrictEqual(x.tags, ['DETAILS', 'DIV', 'P', 'SUMMARY'], 'SC-004: only the dialog\'s own elements');
    assert.strictEqual(x.xss, 0, 'SC-004: no handler from the body ran');
    assert.ok(x.clip, 'FR-010: a clipped body says the release page has the rest');
    assert.ok(await dlgBtn('Skip this version')); await until(`!document.getElementById('modeDlg')`);
    await until("!" + menuShown);
    assert.strictEqual(await js(menuShown), false, 'FR-016: Skip takes the menu line away');

    // ---- breaking: the card first, the tick gates the release page; Tab stays in the dialog; only the target is sent; snooze
    await H.load({ w, h, query: { simselfupd: 'breaking' }, ready: 'fit' });
    await until(menuShown);
    await openFromMenu();
    const b = await js(`({h:document.getElementById('suBrkH').textContent,t:document.querySelector('#modeDlg .su-brk').textContent,first:document.querySelector('#modeDlg .su-dlg').children[1].className,prim:document.querySelector('#modeDlg .dbtn .primary').disabled,label:document.querySelector('#modeDlg .su-tick').textContent,named:document.querySelector('#modeDlg .su-brk').getAttribute('aria-labelledby')})`);
    assert.strictEqual(b.h, 'Breaking changes');
    assert.match(b.t, new RegExp(`v${re(V.minor)}: Floors are renamed to levels[\\s\\S]*What to do: Check your level names after the update\\.`), 'the releases.json words of the breaking version');
    assert.strictEqual(b.first, 'su-brk', 'the breaking card comes first (after the source line)');
    assert.strictEqual(b.prim, true, 'FR-464: Open the release page is disabled until the box is ticked');
    assert.strictEqual(b.label, 'I have read the breaking changes');
    assert.strictEqual(b.named, 'suBrkH', 'the card is named by its heading');
    assert.ok((await minFont('#modeDlg')) >= 10.5, 'breaking dialog text at least 10.5 px');
    assert.deepStrictEqual(await fits(), { inWin: true, btns: true, noX: true }, 'the breaking dialog fits the window');
    if (w === 1440) await shot(`118-update-breaking-${w}x${h}.png`, 'toasts');
    assert.strictEqual(await dlgBtn('Open the release page'), false, 'a press on the disabled button does nothing');
    assert.strictEqual(await js(`(window.__simSelfOpened||[]).length`), 0, 'nothing was opened before the tick');
    // keyboard: Tab order through the dialog, wrapping inside it; Space ticks the box
    focusPage();
    await js(`document.querySelector('#modeDlg .dbtn [data-cancel]').focus()`);
    const order = [];
    for (let i = 0; i < 8; i++) { await H.key('Tab'); order.push(await js(`(()=>{const e=document.activeElement;if(!e||!document.getElementById('modeDlg').contains(e))return 'OUT';return e.id||e.tagName+':'+(e.textContent||'').trim().slice(0,24)})()`)); }
    assert.ok(!order.includes('OUT'), 'Tab never leaves the dialog: ' + order.join(' > '));
    assert.deepStrictEqual(order.slice(0, 3), ['BUTTON:Skip this version', 'BUTTON:Remind me in 7 days', 'suTick'], 'Tab goes through the buttons, then wraps to the tick box (the disabled button is skipped): ' + order.join(' > '));
    assert.ok(order.includes(`SUMMARY:v${V.minor} · 2026-11-24`) && order.some((o) => o.startsWith('DIV:')), 'the notes and each release summary are on the Tab path: ' + order.join(' > '));
    await js(`document.getElementById('suTick').focus()`);
    await H.key('Space', [], { char: 'always' }); await until(`document.getElementById('suTick').checked`);
    assert.strictEqual(await js(`document.querySelector('#modeDlg .dbtn .primary').disabled`), false, 'FR-464: the tick enables Open the release page');
    assert.ok(await dlgBtn('Open the release page')); await until(`!document.getElementById('modeDlg')`);
 assert.deepStrictEqual(await js(`window.__simSelfOpened||[]`), [V.minor], 'FR-024: only the target version is sent; main opens its own page');
    await openFromMenu();
    assert.ok(await dlgBtn('Remind me in 7 days')); await until(`!document.getElementById('modeDlg')`);
    await until("!" + menuShown);
    assert.strictEqual(await js(menuShown), false, 'FR-016: a snooze takes the menu line away');

    // ---- Settings > About: state, source, switch, Check now, what a check sends
    await js(`document.getElementById('settingsBtn').click()`); await until(`!!document.getElementById('suState')`); await settle();
    const a = await js(`({st:document.getElementById('suState').textContent,src:document.getElementById('suSource').textContent,sw:document.getElementById('suDaily').getAttribute('aria-checked'),swl:document.getElementById('suSwL').textContent,named:document.getElementById('suDaily').getAttribute('aria-labelledby'),check:!!document.getElementById('suCheck'),open:!!document.getElementById('suOpen'),sends:document.getElementById('suSends').textContent,live:document.getElementById('suState').getAttribute('role')})`);
 assert.match(a.st, new RegExp(`^Update available: v${re(V.minor)} \\(reminder in a few days\\) · checked 2 h ago$`), 'FR-016: About still shows a snoozed update, with the time of the check');
    assert.strictEqual(a.src, 'Updates from three-feathers/agent-durbar (built in)', 'FR-002');
    assert.ok(a.sw === 'true' && a.swl === 'Check for Durbar updates once a day' && a.named === 'suSwL', 'FR-462: the switch is on by default and named');
    assert.ok(a.check && a.open, 'Check now and See what is new');
    assert.match(a.sends, /one request to api\.github\.com[\s\S]*no version number, account or machine identifier[\s\S]*IP address, the time and which repository[\s\S]*nothing is sent unless you press Check now/, 'FR-006 in plain words');
    assert.strictEqual(a.live, 'status', 'the state line is announced when it changes');
    assert.ok((await minFont('#selfUpdBlock')) >= 10.5, 'About text at least 10.5 px');
    await js(`document.getElementById('aboutH').scrollIntoView({block:'start'})`); await settle();
    if (w === 1280) await shot(`118-update-about-${w}x${h}.png`, 'toasts');
    await js(`document.getElementById('suDaily').click()`); await until(`document.getElementById('suDaily').getAttribute('aria-checked')==='false'`);
    assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'suDaily', 'the focus stays on the switch after a repaint');
    await js(`document.getElementById('suCheck').click()`);
    await until(`document.getElementById('suCheck')&&!document.getElementById('suCheck').disabled&&document.getElementById('suCheck').textContent==='Check now'`);
    assert.match(await js(`document.getElementById('suState').textContent`), /checked just now/, 'Check now updates the time');
    assert.strictEqual(await js(`[...document.querySelectorAll('#toasts .toast')].filter(t=>/is available/.test(t.textContent)).length<=1`), true, 'FR-463: Check now adds no toast');
  }
  console.log('[118] PASS');
};
