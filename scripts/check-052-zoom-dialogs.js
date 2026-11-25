/*
 * Check for spec 052 (delta 2026-11-25, issue #2115): at the smallest window (640x700) zoomed to 200 %, the page is 320 px wide. Every wide dialog
 * still fits it: the dialog is inside the window, nothing in it sticks out past its box, its body does not scroll sideways, and its footer buttons
 * wrap onto more rows with every one whole (the "Settings" button of the MCP servers dialog was cut at the left, and the body scrolled 1 px sideways).
 * The page behind a dialog is not asserted: the office does not fit 320 px (a known gap in the spec delta). Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-052-zoom-dialogs
 *   OUT=<folder>  (optional) saves 052-zoom-dialog-<name>.png
 *   MEASURE=1     (also the footer rows of the normal sizes) prints the measures and does not assert
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const MEASURE = !!process.env.MEASURE;
const ZOOM = 2;
/* Normal sizes (spec 052 FR-471, review of PR 2139): the one footer rule `.dlg .dbtn{flex-wrap:wrap}` covers every dialog, so at 1440x900 and 1280x800 the footers
   of the dialogs that had their own wrap rule (the + Folder choice: spec 093; the open-sessions dialog: spec 081) and of the MCP servers dialog are what they were
   before it: the buttons in the same order and on the same number of rows (`rows`; the five-button choice has always wrapped to two rows at these sizes, the other two have one),
   each whole and inside its dialog. The values below were measured on main's CSS before the change (with its two per-dialog wrap rules) and on the new CSS: identical. */
const NORMAL_SIZES = [[1440, 900], [1280, 800]];
const FOOTERS = {
  choice: { buttons: ['Add existing folder\u2026', 'Clone a repository\u2026', 'New repository\u2026', 'Empty folder\u2026', 'Cancel'], rows: 1 },
  sessions: { buttons: ['Cancel', 'Update when they end', 'End 2 sessions and update'], rows: 2 },
  mcp: { buttons: ['Settings', 'Folder extras\u2026', 'Done'], rows: 1 },
};

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const raf2 = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
  /* everything is read from the page: the dialog, its body, its footer and each button, and any element of the dialog right of the body's content box or left of it */
  const measure = () => js(`(()=>{const dl=document.querySelector('#scrDlg .dlg'),bd=dl.querySelector('.dbody'),ft=dl.querySelector('.dbtn'),R=e=>e.getBoundingClientRect();
    const d=R(dl),b=R(bd),f=R(ft),cs=getComputedStyle(bd),pl=parseFloat(cs.paddingLeft)||0,pr=parseFloat(cs.paddingRight)||0;
    const inL=b.left+pl-0.5,inR=b.left+bd.clientWidth-pr+0.5;
    const out=[...bd.querySelectorAll('*')].filter(e=>{const r=R(e);return r.width&&(r.right>inR||r.left<inL)&&!e.closest('[hidden]')}).map(e=>(e.id||e.className||e.tagName)+':'+e.textContent.trim().slice(0,28)+' '+Math.round(R(e).left)+'..'+Math.round(R(e).right)).slice(0,6);
    return {vw:innerWidth,dlgIn:d.left>=0&&d.right<=innerWidth,dlgW:Math.round(d.width),bodyX:bd.scrollWidth-bd.clientWidth,out,
      footX:ft.scrollWidth-ft.clientWidth,btns:[...ft.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>({t:x.textContent,l:Math.round(R(x).left*10)/10,r:Math.round(R(x).right*10)/10})),
      footL:Math.round(f.left*10)/10,footR:Math.round(f.right*10)/10,dlgL:Math.round(d.left*10)/10,dlgR:Math.round(d.right*10)/10}})()`);
  const zoomIn = async (tag) => {
    ctx.win.webContents.setZoomFactor(ZOOM);
    assert.ok(await until(`Math.abs(window.devicePixelRatio-${jsLiteral(ZOOM)})<0.01`), `${tag}: the page is zoomed`);
    await raf2();
  };
  const check = async (name, tag) => {
    const m = await measure();
    if (MEASURE) console.log(`[2115] ${tag} ${JSON.stringify(m)}`);
    await H.shot(path.join(OUT, `052-zoom-dialog-${name}.png`), { prep: 'mouse', tag: '052' });
    if (MEASURE) return;
    assert.strictEqual(m.vw, 320, `${tag}: the page is 320 px wide ${JSON.stringify(m)}`);
    assert.ok(m.dlgIn, `${tag}: the dialog is inside the window ${JSON.stringify(m)}`);
    assert.deepStrictEqual(m.out, [], `${tag}: nothing in the dialog's body sticks out of its box ${JSON.stringify(m)}`);
    assert.ok(m.bodyX <= 0, `${tag}: the dialog body does not scroll sideways ${JSON.stringify(m)}`);
    assert.ok(m.footX <= 0 && m.btns.length > 0 && m.btns.every((b) => b.l >= m.dlgL - 0.5 && b.r <= m.dlgR + 0.5), `${tag}: every footer button is whole, inside the dialog ${JSON.stringify(m)}`);
  };
  const closeDlg = () => js(`(()=>{const o=document.getElementById('scrDlg');if(!o)return 0;const b=o.querySelector('.dbtn [data-cancel]')||[...o.querySelectorAll('.dbtn .btn')].pop();if(b)b.click();return 1})()`);

  /* 1. the chat's MCP servers dialog (the widest footer: Settings, Folder extras..., Done), with the restart-session button showing */
  let tag = '640x700 zoom 2 MCP servers dialog';
  await H.load({ w: 640, h: 700, ready: 'fit', focus: true, query: { simmcpauth: 'again' } });
  await H.settle();
  const id = (await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`))[0];
  assert.ok(id, `${tag}: a running Copilot chat`);
  await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
  assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), `${tag}: the chat opened with its MCP chip`);
  await js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:[{name:'team-wiki',status:'connected',transport:'http',source:'user'},{name:'tidy',status:'connected',transport:'stdio',source:'user'}]})`);
  await js(`document.getElementById('mcpBtn').click()`);
  assert.ok(await until(`!!document.querySelector('#agMcp li.srv')&&!!document.getElementById('mcpRestartSess')`), `${tag}: the dialog shows its rows and the restart-session button`);
  await zoomIn(tag);
  await check('mcp-servers', tag);
  ctx.win.webContents.setZoomFactor(1);
  await closeDlg();

  /* 2. a folder's Add server dialog with the global choice on (it shows the most) */
  tag = '640x700 zoom 2 Add server dialog';
  await H.load({ w: 640, h: 700, ready: 'fit', focus: true });
  await H.settle();
  await js(`window.DurbarScreens.folderMcp(${jsLiteral('~/work/mcp-swiss')},'mcp-swiss')`);
  assert.ok(await until(`!!document.getElementById('mcpAdd')`), `${tag}: the folder extras screen opened`);
  await js(`document.getElementById('mcpAdd').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`), `${tag}: the add form opened`);
  await js(`document.querySelector('#scrDlg [name=mScope][value=global]').click()`);
  await zoomIn(tag);
  await check('add-server', tag);
  ctx.win.webContents.setZoomFactor(1);
  await closeDlg();

  /* 3. the same footers at 1440x900 and 1280x800 */
  const footer = (root) => js(`(()=>{const o=document.getElementById(${jsLiteral(root)}),d=o&&o.querySelector('.dlg'),f=d&&d.querySelector('.dbtn');if(!f)return null;const D=d.getBoundingClientRect();
    const b=[...f.querySelectorAll('button')].filter(x=>x.getClientRects().length);
    return {buttons:b.map(x=>x.textContent.trim()),rows:new Set(b.map(x=>Math.round(x.getBoundingClientRect().top))).size,
      whole:f.scrollWidth<=f.clientWidth&&b.every(x=>{const r=x.getBoundingClientRect();return r.left>=D.left-0.5&&r.right<=D.right+0.5}),dlgW:Math.round(D.width)}})()`);
  const checkFooter = async (kind, root, tag) => {
    const m = await footer(root);
    if (MEASURE) console.log(`[2115] ${tag} ${JSON.stringify(m)}`);
    if (MEASURE) return;
    const want = FOOTERS[kind];
    assert.ok(m, `${tag}: the dialog is open ${root}`);
    assert.deepStrictEqual(m.buttons, want.buttons, `${tag}: the footer buttons and their order are unchanged ${JSON.stringify(m)}`);
    assert.strictEqual(m.rows, want.rows, `${tag}: the footer is on ${want.rows} row(s) as before the one wrap rule ${JSON.stringify(m)}`);
    assert.ok(m.whole, `${tag}: every footer button is whole, inside the dialog ${JSON.stringify(m)}`);
  };
  for (const [w, h] of NORMAL_SIZES) {
    const at = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit' });
    await H.calm();
    await js(`document.getElementById('addFolder').click()`);
    assert.ok(await until(`!!document.querySelector('#modeDlg .dbtn button')`), `${at}: the + Folder choice opened`);
    await checkFooter('choice', 'modeDlg', `${at} + Folder choice`);
    await H.shot(path.join(OUT, `052-footer-choice-${at}.png`), { prep: 'mouse', tag: '052' });
    await js(`(()=>{const b=document.querySelector('#modeDlg .dbtn [data-cancel]')||[...document.querySelectorAll('#modeDlg .dbtn button')].pop();b.click()})()`);

    await H.load({ w, h, query: { simkinds: '1', simupd: 'avail', simsessions: '2' }, ready: 'fit' });
    await js(`document.getElementById('settingsBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('.hs-card').length===3`), `${at}: Settings opened`);
    await js(`document.querySelector('[data-hs="checkall"]').click()`);
    assert.ok(await until(`/Update available/.test(document.querySelector('.hs-card[data-kind="claude"] .hs-upd').textContent)`), `${at}: the check found an update`);
    await js(`document.querySelector('.hs-card[data-kind="claude"] [data-hs="update"]').click()`);
    assert.ok(await until(`!!document.querySelector('#hsDlg .hs-plan')`), `${at}: the update plan opened`);
    await js(`[...document.querySelectorAll('#hsDlg .btn')].find(x=>x.textContent.trim()==='Update').click()`);
    assert.ok(await until(`/2 Claude Code sessions are open/.test((document.getElementById('hsDlgT')||{}).textContent||'')`), `${at}: the open-sessions dialog opened`);
    await checkFooter('sessions', 'hsDlg', `${at} open sessions`);
    await H.shot(path.join(OUT, `052-footer-sessions-${at}.png`), { prep: 'mouse', tag: '052' });

    await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: 'again' } });
    await H.settle();
    const id = (await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`))[0];
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), `${at}: the chat opened with its MCP chip`);
    await js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:[{name:'team-wiki',status:'connected',transport:'http',source:'user'}]})`);
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#agMcp li.srv')`), `${at}: the MCP dialog opened`);
    await checkFooter('mcp', 'scrDlg', `${at} MCP servers`);
    await H.shot(path.join(OUT, `052-footer-mcp-${at}.png`), { prep: 'mouse', tag: '052' });
  }
  console.log('[052] zoomed dialogs PASS');
};
