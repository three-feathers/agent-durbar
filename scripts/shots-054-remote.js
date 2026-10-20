/*
 * Spec 054 Phase 1 (remote control from GitHub): simulator checks and screenshots at 1440x900 and 1280x800. Nothing leaves the
 * computer: the simulator answers with a canned github.com link and "Open on GitHub" only logs.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-054-remote.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks: a Copilot agent's chat More menu has "Control from GitHub (web and mobile)"; the dialog says what is sent and has Cancel
 * focused first; Turn on shows the link dialog (link, GitHub Mobile note, Copy link, Open on GitHub); the Remote chip shows in the chat
 * header and " · Remote" on the desk card; the item then reads "Stop remote control" and turns it off. Prints "[054] PASS".
 */
const assert = require('assert');
const path = require('path');
const { waits } = require('./driver-helpers');
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(process.cwd(), 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const { until, settle } = waits(ctx); // spec 008 FR-096: wait for the page, not a fixed time
  const js = (c) => ctx.js(c);
  const shot = async (name) => { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(150); await ctx.shot(path.join(OUT, name)); console.log('[054] saved', name); };
  const clickText = (sel, text) => js(`(()=>{const b=[...document.querySelectorAll(${jsLiteral(sel)})].find(x=>x.textContent.trim()===${jsLiteral(text)});if(!b)return false;b.click();return true;})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await settle();
    // open the first main agent's chat (every agent is Copilot without simkinds)
    const id = await js(`(document.querySelector('.desk[data-id]')||{dataset:{}}).dataset.id||''`);
    assert.ok(id, 'a desk card to open');
    await js(`document.querySelector('.desk[data-id=' + JSON.stringify(${jsLiteral(id)}) + ']').click()`); await until(`!!document.getElementById('moreBtn')&&!!document.getElementById('remoteChip')`); await settle();
    assert.ok(await js(`!!document.getElementById('moreBtn')`), 'the chat is open');
    assert.ok(await js(`document.getElementById('remoteChip')&&document.getElementById('remoteChip').hidden`), 'the Remote chip is hidden while off');
    await js(`document.getElementById('moreBtn').click()`); await until(`!!(document.getElementById('remoteBtn')||{}).textContent`);
    const item = await js(`(document.getElementById('remoteBtn')||{}).textContent||''`);
    assert.ok(/^Control from GitHub \(web and mobile\)/.test(item), 'the More menu offers remote control: ' + item);
    await shot(`054-remote-menu-${w}x${h}.png`);
    await js(`document.getElementById('remoteBtn').click()`); await until(`document.querySelectorAll('#modeDlg .dbtn .btn').length===2&&document.activeElement&&document.activeElement.textContent==='Cancel'`);
    const ask = await js(`({t:(document.getElementById('mdT')||{}).textContent,b:(document.getElementById('mdB')||{}).textContent,focus:document.activeElement&&document.activeElement.textContent,btns:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
    assert.strictEqual(ask.t, 'Control this session from GitHub?');
    assert.ok(/messages are sent to GitHub/.test(ask.b) && /Anyone who can see this session on GitHub can steer it/.test(ask.b), 'the dialog says what is sent: ' + ask.b);
    assert.deepStrictEqual(ask.btns, ['Cancel', 'Turn on']);
    assert.strictEqual(ask.focus, 'Cancel', 'Cancel has the first focus');
    await shot(`054-remote-confirm-${w}x${h}.png`);
    assert.ok(await clickText('#modeDlg .dbtn .btn', 'Turn on'));
    await ctx.waitFor(`document.getElementById('mdT')&&document.getElementById('mdT').textContent==='Remote control is on'`, 5000);
    const link = await js(`({lines:[...document.querySelectorAll('#mdL li')].map(x=>x.textContent),btns:[...document.querySelectorAll('#modeDlg .dbtn .btn')].map(x=>x.textContent)})`);
    assert.ok(link.lines.some((l) => /^https:\/\/github\.com\/three-feathers\/agent-durbar\/sessions\/sim-\d+$/.test(l)), 'the link shows: ' + JSON.stringify(link.lines));
    assert.ok(link.lines.includes('Open this link in GitHub Mobile to steer from your phone.'));
    assert.deepStrictEqual(link.btns, ['Copy link', 'Open on GitHub', 'Done']);
    await shot(`054-remote-link-${w}x${h}.png`);
    assert.ok(await clickText('#modeDlg .dbtn .btn', 'Open on GitHub'), 'Open on GitHub (the simulator only logs)');
    await until(`!!document.getElementById('remoteChip')&&!document.getElementById('remoteChip').hidden`); await settle();
    const on = await js(`({chip:!!document.getElementById('remoteChip')&&!document.getElementById('remoteChip').hidden,card:(document.querySelector('.desk[data-id=' + JSON.stringify(${jsLiteral(id)}) + '] .role')||{}).textContent||'',item:(document.getElementById('remoteBtn')||{}).textContent||''})`);
    assert.ok(on.chip, 'the Remote chip shows in the chat header');
    assert.ok(/^Stop remote control/.test(on.item), 'the item now stops it: ' + on.item);
    await shot(`054-remote-on-${w}x${h}.png`);
    // the office is drawn again when the chat closes: the desk card names it there
    await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`); await settle();
    const card = await js(`(document.querySelector('.desk[data-id=' + JSON.stringify(${jsLiteral(id)}) + '] .role')||{}).textContent||''`);
    assert.ok(/ · Remote$/.test(card), 'the desk card says Remote: ' + card);
    await js(`document.querySelector('.desk[data-id=' + JSON.stringify(${jsLiteral(id)}) + ']').click()`); await until(`!!document.getElementById('moreBtn')`); await settle();
    await js(`document.getElementById('moreBtn').click()`); await until(`/^Stop remote control/.test((document.getElementById('remoteBtn')||{}).textContent||'')`);
    await js(`document.getElementById('remoteBtn').click()`); await until(`document.getElementById('remoteChip').hidden`); await settle();
    const off = await js(`({chip:document.getElementById('remoteChip').hidden,item:(document.getElementById('remoteBtn')||{}).textContent||''})`);
    assert.ok(off.chip && /^Control from GitHub/.test(off.item), 'Stop remote control turns it off: ' + JSON.stringify(off));
    console.log('[054]', w, 'ok');
  }
  console.log('[054] PASS');
};
