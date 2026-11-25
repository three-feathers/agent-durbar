/*
 * Check for spec 052 (delta 2026-11-25, issue #2115): at the smallest window (640x700) zoomed to 200 %, the page is 320 px wide. Every wide dialog
 * still fits it: the dialog is inside the window, nothing in it sticks out past its box, its body does not scroll sideways, and its footer buttons
 * wrap onto more rows with every one whole (the "Settings" button of the MCP servers dialog was cut at the left, and the body scrolled 1 px sideways).
 * Also the folder setup, Import from VS Code, Trust and global-file review dialogs (issue #2140 part 1). The page behind a dialog is not asserted: the office does not fit 320 px (a known gap in the spec delta). Simulator only (no AI credits).
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
   before it: the buttons in the same order and on the same number of rows (see below),
   each whole and inside its dialog. Measured on main's CSS (with its two per-dialog wrap rules) and on the new CSS: identical in Noto; in CI's DejaVu the choice wraps to two rows, so the row count is compared with whether the buttons fit in the dialog's content width, not with a fixed number. */
const NORMAL_SIZES = [[1440, 900], [1280, 800]];
const FOOTERS = {
  choice: { buttons: ['Add existing folder\u2026', 'Clone a repository\u2026', 'New repository\u2026', 'Empty folder\u2026', 'Cancel'] },
  sessions: { buttons: ['Cancel', 'Update when they end', 'End 2 sessions and update'] },
  mcp: { buttons: ['Settings', 'Folder extras\u2026', 'Done'] },
};

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const raf2 = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
  /* everything is read from the page: the dialog, its body, its footer and each button, and any element of the dialog right of the body's content box or left of it */
  const measure = () => js(`(()=>{const dl=document.querySelector('#scrDlg .dlg'),bd=dl.querySelector('.dbody'),ft=dl.querySelector('.dbtn'),R=e=>e.getBoundingClientRect();
    const d=R(dl),b=R(bd),f=R(ft),cs=getComputedStyle(bd),pl=parseFloat(cs.paddingLeft)||0,pr=parseFloat(cs.paddingRight)||0;
    const inL=b.left+pl-0.5,inR=b.left+bd.clientWidth-pr+0.5;
    const out=[...bd.querySelectorAll('*')].filter(e=>{const r=R(e);return r.width&&(r.right>inR||r.left<inL)&&!e.closest('[hidden]')}).map(e=>(e.id||e.className||e.tagName)+':'+e.textContent.trim().slice(0,28)+' '+Math.round(R(e).left)+'..'+Math.round(R(e).right)).slice(0,12);
    return {vw:innerWidth,dlgIn:d.left>=0&&d.right<=innerWidth,dlgW:Math.round(d.width),bodyX:bd.scrollWidth-bd.clientWidth,out,
      footX:ft.scrollWidth-ft.clientWidth,btns:[...ft.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>({t:x.textContent,l:Math.round(R(x).left*10)/10,r:Math.round(R(x).right*10)/10})),
      footL:Math.round(f.left*10)/10,footR:Math.round(f.right*10)/10,dlgL:Math.round(d.left*10)/10,dlgR:Math.round(d.right*10)/10}})()`);
  const zoomIn = async (tag) => {
    ctx.win.webContents.setZoomFactor(ZOOM);
    assert.ok(await until(`Math.abs(window.devicePixelRatio-${jsLiteral(ZOOM)})<0.01`), `${tag}: the page is zoomed`);
    await raf2();
  };
  const assertFits = (m, tag) => {
    assert.strictEqual(m.vw, 320, `${tag}: the page is 320 px wide ${JSON.stringify(m)}`);
    assert.ok(m.dlgIn, `${tag}: the dialog is inside the window ${JSON.stringify(m)}`);
    assert.deepStrictEqual(m.out, [], `${tag}: nothing in the dialog's body sticks out of its box ${JSON.stringify(m)}`);
    assert.ok(m.bodyX <= 0, `${tag}: the dialog body does not scroll sideways ${JSON.stringify(m)}`);
    assert.ok(m.footX <= 0 && m.btns.length > 0 && m.btns.every((b) => b.l >= m.dlgL - 0.5 && b.r <= m.dlgR + 0.5), `${tag}: every footer button is whole, inside the dialog ${JSON.stringify(m)}`);
  };
  /* The dialog is also checked in a wide font (a monospace face forced on the whole dialog: wider than any UI font, as CI's DejaVu is wider than a desktop's), so the
     properties hold for any text width, not only the fonts of the machine that ran the check (CI's DejaVu broke the first version of this check). */
  const WIDE = 'html #scrDlg .dlg, html #scrDlg .dlg *{font-family:"DejaVu Sans Mono",ui-monospace,monospace !important}';
  const check = async (name, tag) => {
    const m = await measure();
    if (MEASURE) console.log(`[2115] ${tag} ${JSON.stringify(m)}`);
    await H.shot(path.join(OUT, `052-zoom-dialog-${name}.png`), { prep: 'mouse', tag: '052' });
    if (!MEASURE) assertFits(m, tag);
    await js(`(()=>{const e=document.createElement('style');e.id='wideFont2115';e.textContent=${jsLiteral(WIDE)};document.head.appendChild(e);return 1})()`);
    await raf2();
    const w = await measure();
    if (MEASURE) console.log(`[2115] ${tag} wide font ${JSON.stringify(w)}`);
    await H.shot(path.join(OUT, `052-zoom-dialog-${name}-widefont.png`), { prep: 'mouse', tag: '052' });
    await js(`(()=>{const e=document.getElementById('wideFont2115');if(e)e.remove();return 1})()`);
    if (!MEASURE) assertFits(w, `${tag} in a wide font`);
  };
  /* closes the dialog with its Cancel, else its first footer button (the folder setup dialog has no Cancel: "Turn all off" only records an answer in the simulator) */
  const closeDlg = async () => {
    await js(`(()=>{const o=document.getElementById('scrDlg');if(!o)return 0;const b=o.querySelector('.dbtn [data-cancel]')||o.querySelector('.dbtn .btn');if(b)b.click();return 1})()`);
    await until(`!document.getElementById('scrDlg')`);
  };
  const CHECKED = [];
  const checkDialog = async (name, tag) => {
    await zoomIn(tag);
    await check(name, tag);
    CHECKED.push(name);
    ctx.win.webContents.setZoomFactor(1);
    await closeDlg();
  };
  const openFolderExtras = async (tag) => {
    await H.load({ w: 640, h: 700, ready: 'fit', focus: true });
    await H.settle();
    await js(`window.DurbarScreens.folderMcp(${jsLiteral('~/work/mcp-swiss')},'mcp-swiss')`);
    assert.ok(await until(`!!document.getElementById('mcpAdd')`), `${tag}: the folder extras screen opened`);
  };

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
  CHECKED.push('mcp-servers');
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
  await checkDialog('add-server', tag);

  /* 2b. issue 2140 part 1: the other wide dialogs get the same five asserts. The folder's own agent setup (the simulator's simfoldersetup page address opens it by itself) */
  tag = '640x700 zoom 2 folder setup dialog';
  await H.load({ w: 640, h: 700, query: { simfoldersetup: '1' }, settle: false });
  assert.ok(await until(`!!document.querySelector('#scrDlg .dlg.fs [data-fs]')`), `${tag}: the dialog opened with its items`);
  await checkDialog('folder-setup', tag);

  /* Import from VS Code (the simulator's fake .vscode/mcp.json: six servers, one blocked, one already named, notes and secret chips) */
  tag = '640x700 zoom 2 Import from VS Code dialog';
  await openFolderExtras(tag);
  await js(`document.getElementById('mcpImportVs').click()`);
  assert.ok(await until(`document.querySelectorAll('#scrDlg #impList .imp-row').length>=5`), `${tag}: the import list opened`);
  await js(`document.querySelector('#scrDlg [data-all="1"]').click()`);
  await checkDialog('import-vscode', tag);

  /* Trust (an extra that is off and not yet trusted: turning it on asks first) */
  tag = '640x700 zoom 2 Trust dialog';
  await openFolderExtras(tag);
  await js(`document.querySelector('#stage li.srv[data-name="docs-search"] [data-act="toggle"], li.srv[data-name="docs-search"] [data-act="toggle"]').click()`);
  assert.ok(await until(`/^Trust /.test((document.getElementById('scrDlgT')||{}).textContent||'')&&!!document.querySelector('#scrDlg .trustcmd')`), `${tag}: the trust question opened`);
  await checkDialog('trust', tag);

  /* the review of the agent apps' own files (a global server, one conflicting name so the "Now:" and "Replace it" lines show) */
  tag = '640x700 zoom 2 global-file review dialog';
  await openFolderExtras(tag);
  await js(`document.getElementById('mcpAdd').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`), `${tag}: the add form opened`);
  await js(`(()=>{const q=k=>document.querySelector('#scrDlg '+k);q('[name=mScope][value=global]').click();q('#mName').value='github';q('#mType').value='stdio';q('#mType').dispatchEvent(new Event('change'));q('#mCmd').value='npx';q('#mArgs').value='-y\\n@example/a-very-long-package-name-for-the-global-file-review';return 1})()`);
  await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.classList.contains('primary')).click()`);
  assert.ok(await until(`/^Review: add/.test((document.getElementById('scrDlgT')||{}).textContent||'')&&document.querySelectorAll('#scrDlg .gpv').length>0`), `${tag}: the review opened`);
  await checkDialog('global-review', tag);

  /* a guard that the list holds every wide dialog of the issue (a dropped case would leave a dialog unchecked) */
  assert.deepStrictEqual(CHECKED, ['mcp-servers', 'add-server', 'folder-setup', 'import-vscode', 'trust', 'global-review'], 'every wide dialog (issue 2140 part 1) is opened at 320 px');

  /* 3. the same footers at 1440x900 and 1280x800 */
  const footer = (root) => js(`(()=>{const o=document.getElementById(${jsLiteral(root)}),d=o&&o.querySelector('.dlg'),f=d&&d.querySelector('.dbtn');if(!f)return null;const D=d.getBoundingClientRect();
    const b=[...f.querySelectorAll('button')].filter(x=>x.getClientRects().length);
    const cs=getComputedStyle(f),gap=parseFloat(cs.columnGap)||0,dc=getComputedStyle(d),avail=d.clientWidth-(parseFloat(dc.paddingLeft)||0)-(parseFloat(dc.paddingRight)||0),need=b.reduce((a,x)=>a+x.getBoundingClientRect().width,0)+gap*Math.max(0,b.length-1);
    return {avail:Math.round(avail),need:Math.round(need),buttons:b.map(x=>x.textContent.trim()),rows:new Set(b.map(x=>Math.round(x.getBoundingClientRect().top))).size,
      whole:f.scrollWidth<=f.clientWidth&&b.every(x=>{const r=x.getBoundingClientRect();return r.left>=D.left-0.5&&r.right<=D.right+0.5}),dlgW:Math.round(D.width)}})()`);
  const checkFooter = async (kind, root, tag) => {
    const m = await footer(root);
    if (MEASURE) console.log(`[2115] ${tag} ${JSON.stringify(m)}`);
    if (MEASURE) return;
    const want = FOOTERS[kind];
    assert.ok(m, `${tag}: the dialog is open ${root}`);
    assert.deepStrictEqual(m.buttons, want.buttons, `${tag}: the footer buttons and their order are unchanged ${JSON.stringify(m)}`);
    /* font-independent (CI's DejaVu is wider than a desktop's font): the footer wraps exactly when its buttons do not fit on one row, as with the per-dialog rules */
    assert.strictEqual(m.rows > 1, m.need > m.avail + 1, `${tag}: the footer wraps only when its buttons do not fit on one row (need ${m.need}px, room ${m.avail}px, ${m.rows} row(s)) ${JSON.stringify(m)}`);
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
