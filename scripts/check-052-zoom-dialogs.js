/*
 * Check for spec 052 (delta 2026-11-25, issue #2115): at the smallest window (640x700) zoomed to 200 %, the page is 320 px wide. Every wide dialog
 * still fits it: the dialog is inside the window, nothing in it sticks out past its box, its body does not scroll sideways, and its footer buttons
 * wrap onto more rows with every one whole (the "Settings" button of the MCP servers dialog was cut at the left, and the body scrolled 1 px sideways).
 * The page behind a dialog is not asserted: the office does not fit 320 px (a known gap in the spec delta). Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-052-zoom-dialogs
 *   OUT=<folder>  (optional) saves 052-zoom-dialog-<name>.png
 *   MEASURE=1     prints the measures and does not assert
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const MEASURE = !!process.env.MEASURE;
const ZOOM = 2;

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
  console.log('[052] zoomed dialogs PASS');
};
