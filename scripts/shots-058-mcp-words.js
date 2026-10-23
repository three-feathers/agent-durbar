/*
 * Spec 058 (issue #364), T113-T115: the MCP dialog's rows show a word and an icon for every state, a hint for a failed or needs-sign-in
 * server, *Details* with *Copy* for the masked error, and follow `mcp` events while open. Simulator only (no AI credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-words.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800:
 * - sim-5 (Copilot, "my-notes" asks for a sign-in): "Needs sign-in" with an icon, the hint naming GitHub Copilot, Details shows the text, Copy.
 * - sim-6 (Copilot, "my-notes" failed, ENOENT): "Failed", the not-found hint; a switched-off server reads "Off for this session".
 * - Live refresh: an `mcp` event for the open agent changes the row with no click; the focus stays on the same button.
 * - Every string is escaped (a server name and error with markup stay text); text >= 10.5px; the dialog fits the window.
 * Shots: 058-mcp-words-needs-auth-<w>x<h>.png, 058-mcp-words-failed-<w>x<h>.png. Prints "[058] words PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click()})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const openMcp = async (id) => {
    await closePanel();
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), 'the chat opened');
    await settle();
    await js(`document.getElementById('mcpBtn').click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'the dialog lists servers');
    await settle();
  };
  const closeDlg = async () => { await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`); await until(`!document.getElementById('scrDlg')`); };
  const row = (name) => js(`(()=>{const li=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n===${jsLiteral(name)});if(!li)return null;
    const st=li.querySelector('.mst');return {word:(li.querySelector('.mst-w')||{}).textContent||'',icon:!!(st&&st.querySelector('svg.mst-ic')),cls:st?st.className:'',hint:(li.querySelector('.srv-hint')||{}).textContent||'',
      det:li.querySelector('button[data-det]')?li.querySelector('button[data-det]').getAttribute('aria-expanded'):null,err:(li.querySelector('.srv-err')||{}).textContent||null,text:li.textContent};})()`);
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = () => js(`(()=>{let min=99,who='';document.querySelectorAll('#scrDlg .dlg, #scrDlg .dlg *').forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  /* issue #544 (Mac): the "Applies to this agent..." line and the Restart session row sit in the scrolling body, never on the buttons */
  const footerClear = () => js(`(()=>{const q=s=>document.querySelector(s),btn=q('#scrDlg .dbtn').getBoundingClientRect(),body=q('#scrDlg .dbody'),bb=body.getBoundingClientRect();
    const els=[q('#scrDlg .mcp-rsess'),[...document.querySelectorAll('#scrDlg .dbody > p.dsub.small')].pop()].filter(Boolean);
    const rs=q('#scrDlg .mcp-rsess').getBoundingClientRect(),note=els[els.length-1].getBoundingClientRect();
    return {inBody:els.every(e=>body.contains(e)),clear:els.every(e=>{const r=e.getBoundingClientRect();return r.bottom<=btn.top+0.5||r.top>=btn.bottom-0.5||r.top<bb.top||r.bottom>bb.bottom;}),
      vis:els.every(e=>{const r=e.getBoundingClientRect();return r.top>=bb.top-0.5&&r.bottom<=bb.bottom+0.5;}),btnTop:btn.top,rsBottom:rs.bottom,noteBottom:note.bottom,noteAfterRs:note.top>=rs.bottom-0.5};})()`);
  /* issue #544 (second report): after a switch toggle the dialog repaints; Done must stay fully visible and hit-testable (centre and corners), and no row meets the footer */
  const footerIntegrity = () => js(`(()=>{const q=s=>document.querySelector(s),r=e=>e.getBoundingClientRect(),ft=r(q('#scrDlg .dbtn')),done=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done'),d=r(done);
    const pts=[[.5,.5],[.1,.15],[.9,.15],[.1,.85],[.9,.85]].map(([x,y])=>[d.left+d.width*x,d.top+d.height*y]);
    const hits=pts.map(([x,y])=>{const el=document.elementFromPoint(x,y);return el===done||done.contains(el);});
    const bb=r(q('#scrDlg .dbody')),over=[...document.querySelectorAll('#scrDlg .dbody *')].filter(e=>{const b=r(e),t=Math.max(b.top,bb.top),bt=Math.min(b.bottom,bb.bottom);return b.width>0&&b.height>0&&bt>t&&bt>ft.top+0.5&&t<ft.bottom-0.5&&b.right>ft.left&&b.left<ft.right;}).length; /* the part of an element the scroller shows */
    return {hits,over,visible:d.top>=0&&d.bottom<=innerHeight&&d.width>0,btnTop:ft.top};})()`);
  /* review on PR #588: the footer is its own layer, pinned by computed style (an opaque background, positioned, above the scroller), not only by the scroller's clip */
  const footerStyle = () => js(`(()=>{const q=s=>document.querySelector(s),cs=e=>getComputedStyle(e),ft=cs(q('#scrDlg .dbtn')),bd=cs(q('#scrDlg .dbody')),dl=cs(q('#scrDlg .dlg'));
    const m=/^rgba?\\(([^)]*)\\)$/.exec(ft.backgroundColor),p=m?m[1].split(/[ ,\\/]+/).filter(Boolean):[],alpha=p.length>3?parseFloat(p[3]):1;
    const z=v=>v==='auto'?0:parseInt(v,10);
    return {bg:ft.backgroundColor,opaque:!!m&&alpha===1,sameAsDialog:ft.backgroundColor===dl.backgroundColor,pos:ft.position,zFoot:ft.zIndex,zBody:bd.zIndex,above:ft.position!=='static'&&z(ft.zIndex)>z(bd.zIndex)};})()`);
  const assertFooterStyle = async (where) => {
    const fs = await footerStyle();
    assert.ok(fs.opaque && fs.sameAsDialog && fs.above, `${where}: the footer is an opaque, positioned layer above the scroller ${JSON.stringify(fs)}`);
  };
  /* every button of the footer is visible and the topmost thing at its centre; the first and last control in the scroller show their whole focus ring (3px outline + 1px offset) */
  const wideDialogOk = async (where) => {
    await assertFooterStyle(where);
    const r = await js(`(()=>{const q=s=>document.querySelector(s),b=e=>e.getBoundingClientRect(),dlg=b(q('#scrDlg .dlg')),body=q('#scrDlg .dbody');
      const btns=[...document.querySelectorAll('#scrDlg .dbtn .btn')].filter(x=>x.getClientRects().length);
      const hit=btns.map(x=>{const r=b(x),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return (e===x||x.contains(e))&&r.top>=0&&r.bottom<=innerHeight;});
      const foc=[...body.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,pre[tabindex],[tabindex="0"]')].filter(x=>x.getClientRects().length);
      const ring=(e,top)=>{body.scrollTop=top?0:body.scrollHeight;e.focus({preventScroll:true});const r=b(e),bb=b(body),w=4;
        const out=r.left-w<bb.left-0.5||r.right+w>bb.right+0.5||(top?r.top-w<bb.top-0.5:r.bottom+w>bb.bottom+0.5);return out;};
      const first=foc[0],last=foc[foc.length-1];
      return {btns:btns.length,hit,fits:dlg.top>=0&&dlg.bottom<=innerHeight+1,scrolls:body.scrollHeight>body.clientHeight,nFocus:foc.length,
        firstClipped:first?ring(first,true):null,lastClipped:last?ring(last,false):null};})()`);
    assert.ok(r.btns > 0 && r.hit.every(Boolean) && r.fits, `${where}: every footer button is visible and clickable ${JSON.stringify(r)}`);
    assert.ok(r.firstClipped === false && r.lastClipped === false, `${where}: the focus ring of the first and last control is not clipped ${JSON.stringify(r)}`);
    return r;
  };
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });

    // ---- sim-5: a server that needs a sign-in ----
    await openMcp('sim-5');
    let n = await row('my-notes');
    assert.ok(n, 'my-notes is listed');
    assert.strictEqual(n.word, 'Needs sign-in', JSON.stringify(n));
    assert.ok(n.icon && /needs-auth/.test(n.cls), 'it has an icon and its class');
    assert.match(n.hint, /^This server needs you to sign in\. GitHub Copilot keeps the sign-in; Agent Durbar never sees it\.$/);
    assert.strictEqual(n.det, 'false', 'Details starts closed');
    assert.strictEqual(n.err, null);
    const running = await row('github');
    assert.strictEqual(running.word, 'Running');
    assert.strictEqual(running.hint, '', 'a running server has no hint');
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    const mf = await minFont();
    assert.ok(mf.min >= 10.5, `${w}: dialog text >= 10.5px (${JSON.stringify(mf)})`);
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-det="my-notes"]');b.focus();b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#agMcp li[data-n="my-notes"] .srv-err')`), 'Details opened');
    n = await row('my-notes');
    assert.match(n.err, /401 Unauthorized/, 'Details shows the masked text');
    assert.strictEqual(n.det, 'true');
    assert.ok(await js(`document.activeElement&&document.activeElement.dataset.det==='my-notes'`), 'focus stays on the Details button over the repaint');
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    // record what Copy writes instead of touching the real clipboard
    await js(`window.__copied=null;navigator.clipboard.writeText=async t=>{window.__copied=t;};true`);
    await js(`document.querySelector('#agMcp button[data-copy="my-notes"]').click()`);
    assert.ok(await until(`/Copied the error text/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`), 'Copy answers with the success toast');
    const copied = await js(`window.__copied`);
    assert.strictEqual(copied, n.err, 'Copy writes exactly the error text shown in Details (the masked one)');
    assert.ok(/401 Unauthorized/.test(copied) && !/my-notes$/.test(copied), 'and it is the error, not the name');
    assert.ok(await fits(), `${w}: the dialog still fits with Details open`);
    await shot(`058-mcp-words-needs-auth-${w}x${h}.png`);

    // ---- live refresh: an event for this agent changes the open dialog; markup in names and errors stays text ----
    await js(`document.querySelector('#agMcp button[data-det="my-notes"]').focus()`);
    await emit('sim-5', [
      { name: 'github', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'n'.repeat(300), status: 'z'.repeat(300), transport: 'stdio', source: 'user' },
      { name: '<b id="x">evil</b>', status: 'brand-new<i>', transport: 'stdio', source: 'user', error: '<img src=x onerror=alert(1)> spawn ENOENT' },
    ]);
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li[data-n="my-notes"]');return !!li&&(li.querySelector('.mst-w')||{}).textContent==='Running'})()`), 'the row followed the event with no click');
    // FR-004 / FR-033: the change is said once through the polite live region (a new server is not announced as a change)
    assert.ok(await until(`document.getElementById('srAnnounce').textContent==='my-notes: Running'`), 'the live region says what changed: ' + (await js(`document.getElementById('srAnnounce').textContent`)));
    // FR-168: tooltips are cut (120) for a long server name and a long unknown state
    const tips = await js(`[...document.querySelectorAll('#agMcp .srv-name, #agMcp .mst.unknown')].map(e=>(e.getAttribute('title')||'').length)`);
    assert.ok(tips.length >= 3 && tips.every((t) => t <= 120), 'tooltips are at most 120 characters: ' + JSON.stringify(tips));
    n = await row('my-notes');
    assert.strictEqual(n.hint, '', 'the hint went with the state');
    assert.ok(await js(`document.activeElement&&document.activeElement.closest&&!!document.activeElement.closest('#scrDlg')`), 'focus stays in the dialog after a live repaint');
    assert.ok(await js(`!document.querySelector('#agMcp #x')&&!document.querySelector('#agMcp img')`), 'markup in a name or error is shown as text, never built');
    const odd = await row('<b id="x">evil</b>');
    assert.ok(odd && /^Unknown state: brand-new<i>$/.test(odd.word), 'an unknown token is named and escaped: ' + JSON.stringify(odd));
    // the hostile row: its Details shows the text literally, nothing is built from it
    await js(`(()=>{const b=document.querySelector('#agMcp button[data-det='+JSON.stringify(${jsLiteral('<b id="x">evil</b>')})+']');b.focus();b.click();})()`);
    assert.ok(await until(`!!document.querySelector('#agMcp .srv-err')`), 'Details of the hostile row opened');
    assert.ok((await js(`(document.querySelector('#agMcp li:last-child .srv-err')||{}).textContent`)).includes('<img'), 'the error shows the literal <img');
    assert.ok(await js(`!document.querySelector('#agMcp img')&&!document.querySelector('#agMcp #x')`), 'no element was built from the error text');
    // focus on the open error box survives a live repaint
    await js(`(()=>{const p=document.querySelector('#agMcp li:last-child pre[data-err]');p.focus();})()`);
    assert.ok(await js(`document.activeElement.matches('pre[data-err]')`), 'the error box has focus');
    await emit('sim-5', [
      { name: 'github', status: 'connected', transport: 'stdio', source: 'user' },
      { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' },
      { name: '<b id="x">evil</b>', status: 'failed', transport: 'stdio', source: 'user', error: '<img src=x onerror=alert(1)> spawn ENOENT again' },
    ]);
    assert.ok(await until(`/again/.test((document.querySelector('#agMcp pre[data-err]')||{}).textContent||'')`), 'the error box followed the event');
    assert.ok(await js(`document.activeElement.matches('pre[data-err]')`), 'focus stays on the error box after a live repaint');
    // two events inside the 150 ms throttle cause one repaint
    await js(`window.__repaints=0;window.__mo=new MutationObserver(()=>{window.__repaints++;});window.__mo.observe(document.querySelector('#scrDlg .dbody'),{childList:true})`);
    const mk = (st) => [{ name: 'github', status: st, transport: 'stdio', source: 'user' }, { name: 'my-notes', status: 'connected', transport: 'stdio', source: 'user' }];
    await js(`(()=>{window.__durbarSimEmit({type:'mcp',sessionId:'sim-5',timestamp:Date.now(),servers:${jsLiteral(mk('pending'))}});window.__durbarSimEmit({type:'mcp',sessionId:'sim-5',timestamp:Date.now(),servers:${jsLiteral(mk('failed'))}});})()`);
    assert.ok(await until(`(document.querySelector('#agMcp li[data-n="github"] .mst-w')||{}).textContent==='Failed'`), 'the last of the two events is shown');
    await ctx.sleep(500);
    assert.strictEqual(await js(`window.__repaints`), 1, 'two events inside the throttle repaint once');
    await js(`window.__mo.disconnect()`);
    await closeDlg();

    // ---- sim-6: failed (command not found), and a server switched off ----
    await openMcp('sim-6');
    n = await row('my-notes');
    assert.strictEqual(n.word, 'Failed', JSON.stringify(n));
    assert.match(n.hint, /command was not found/);
    await js(`document.getElementById('srAnnounce').textContent=''`);
    await js(`document.querySelector('#agMcp li[data-n="github"] button.swt').click()`);
    assert.ok(await until(`(()=>{const li=document.querySelector('#agMcp li[data-n="github"]');return !!li&&(li.querySelector('.mst-w')||{}).textContent==='Off for this session'})()`), 'a switched-off server reads "Off for this session"');
    await ctx.sleep(600); // past the 150 ms throttle and the 60 ms announce delay
    assert.strictEqual(await js(`document.getElementById('srAnnounce').textContent`), '', "a user's own switch is not announced");
    assert.ok(await fits(), `${w}: the dialog fits the window`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
    await shot(`058-mcp-words-failed-${w}x${h}.png`);
    await js(`document.querySelector('#agMcp li[data-n="github"] button.swt').click()`);
    await closeDlg();
    await closePanel();
  }

  // ---- spec 058 FR-077 / FR-078 (issue #544): 14 servers, six turned off by the agent app, three window sizes ----
  const many = [];
  for (let i = 1; i <= 8; i++) many.push({ name: `cli-server-${i}`, status: i === 3 ? 'failed' : 'connected', transport: 'stdio', source: 'user', ...(i === 3 ? { error: 'spawn ENOENT' } : {}) });
  for (const n of ['azure', 'com.microsoft/azure', 'powerbi-modeling-mcp', 'workiq', 'Microsoft MCP Server for Enterprise', 'microsoft/markitdown']) many.push({ name: n, status: 'disabled', transport: 'stdio', source: 'user' });
  many.push({ name: 'zz-last-row', status: 'connected', transport: 'stdio', source: 'user' }); // the last row has a working switch (issue #544: toggling it)
  for (const [w, h] of [[1440, 900], [1280, 800], [1280, 600]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    await closePanel();
    await emit('sim-5', many);
    await openMcp('sim-5');
    const lay = await js(`(()=>{const q=s=>document.querySelector(s),r=e=>e.getBoundingClientRect();
      const dlg=r(q('#scrDlg .dlg')),btn=r(q('#scrDlg .dbtn')),body=q('#scrDlg .dbody'),rows=[...document.querySelectorAll('#agMcp li.srv')].map(li=>r(li));
      const done=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done'),dr=r(done),cx=dr.left+dr.width/2,cy=dr.top+dr.height/2;
      const hit=document.elementFromPoint(cx,cy);
      return {n:rows.length,dlgTop:dlg.top,dlgBottom:dlg.bottom,btnTop:btn.top,btnBottom:btn.bottom,
        rowsOutOfBody:rows.filter(x=>x.top>=body.getBoundingClientRect().bottom||x.bottom<=body.getBoundingClientRect().top).length,
        bodyScrolls:body.scrollHeight>body.clientHeight,bodyBottom:body.getBoundingClientRect().bottom,
        doneVisible:dr.top>=0&&dr.bottom<=innerHeight&&dr.width>0,doneHit:hit===done||done.contains(hit)};})()`);
    assert.ok(lay.n >= 14, `${w}x${h}: 14 or more rows ${JSON.stringify(lay)}`);
    assert.ok(lay.dlgTop >= 0 && lay.dlgBottom <= h + 1, `${w}x${h}: the dialog fits ${JSON.stringify(lay)}`);
    assert.ok(lay.bodyBottom <= lay.btnTop + 0.5, `${w}x${h}: the body ends above the buttons ${JSON.stringify(lay)}`);
    assert.ok(lay.doneVisible && lay.doneHit, `${w}x${h}: Done is visible and nothing covers it ${JSON.stringify(lay)}`);
    if (h <= 800) assert.ok(lay.bodyScrolls, `${w}x${h}: the rows scroll inside the body`);
    // a visible row never meets the footer: every row part inside the body is above the button row
    const meet = await js(`(()=>{const btn=document.querySelector('#scrDlg .dbtn').getBoundingClientRect(),body=document.querySelector('#scrDlg .dbody');const bb=body.getBoundingClientRect();
      return [...document.querySelectorAll('#agMcp li.srv')].filter(li=>{const x=li.getBoundingClientRect();const t=Math.max(x.top,bb.top),b=Math.min(x.bottom,bb.bottom);return b>t&&b>btn.top&&t<btn.bottom;}).length;})()`);
    assert.strictEqual(meet, 0, `${w}x${h}: no row meets the footer`);
    // the last row scrolls into view above the footer and its switch is clickable without the footer in the way
    await js(`document.querySelector('#agMcp li:last-child').scrollIntoView({block:'end'})`);
    const lastHit = await js(`(()=>{const sw=document.querySelector('#agMcp li:last-child .srv-act')||document.querySelector('#agMcp li:last-child'),r=sw.getBoundingClientRect(),el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!el&&!el.closest('.dbtn')&&!!el.closest('#agMcp');})()`);
    assert.ok(lastHit, `${w}x${h}: the last row is reachable and not under the footer`);
    // issue #544: toggle the LAST row off and on; the footer stays clear and Done clickable after each repaint
    for (const want of ['false', 'true']) {
      await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());(()=>{const sw=document.querySelector('#agMcp li:last-child button.swt');if(!sw||sw.disabled)throw new Error('the last row has no working switch');sw.scrollIntoView({block:'end'});sw.click();})()`);
      assert.ok(await until(`document.querySelector('#agMcp li:last-child button.swt').getAttribute('aria-checked')===${jsLiteral(want)}`), `${w}x${h}: the last switch turned ${want}`);
      await settle();
      const fi = await footerIntegrity();
      assert.ok(fi.visible && fi.hits.every(Boolean), `${w}x${h}: Done is visible and clickable after the last switch turned ${want} ${JSON.stringify(fi)}`);
      await assertFooterStyle(`${w}x${h}`);
      assert.strictEqual(fi.over, 0, `${w}x${h}: no body element meets the footer after the toggle ${JSON.stringify(fi)}`);
      if (w === 1440 || w === 1280) await shot(`058-mcp-dialog-toggle-${want === 'false' ? 'off' : 'on'}-${w}x${h}.png`);
    }
    // FR-078: a server the agent app turned off reads who did it, and its switch agrees
    const ro = await js(`[...document.querySelectorAll('#agMcp li.srv')].map(li=>({n:li.dataset.n,word:li.querySelector('.mst-w').textContent,on:li.querySelector('button.swt').getAttribute('aria-checked'),dis:li.querySelector('button.swt').disabled,hint:(li.querySelector('.srv-hint')||{}).textContent||''}))`);
    for (const x of ro.filter((r) => many.some((m) => m.name === r.n && m.status === 'disabled'))) {
      assert.strictEqual(x.word, 'Off in GitHub Copilot', JSON.stringify(x));
      assert.ok(x.on === 'false' && x.dis, `the word and the switch agree (off): ${JSON.stringify(x)}`);
      assert.match(x.hint, /^Turn it on in GitHub Copilot\u2019s own MCP settings/, JSON.stringify(x));
    }
    assert.strictEqual(ro.filter((r) => /^Off in /.test(r.word)).length, 6, 'six runtime-disabled rows');
    for (const x of ro.filter((r) => r.word === 'Running')) assert.strictEqual(x.on, 'true', 'a running server has its switch on');
    // a server the user switched off here still reads "Off for this session"
    await js(`document.querySelector('#agMcp li[data-n="cli-server-1"] button.swt').click()`);
    assert.ok(await until(`(document.querySelector('#agMcp li[data-n="cli-server-1"] .mst-w')||{}).textContent==='Off for this session'`), 'switched off here: "Off for this session"');
    assert.ok(await fits(), `${w}x${h}: the dialog fits`);
    await js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());document.querySelector('#agMcp li[data-n="cli-server-1"] button.swt').click()`);
    await js(`document.querySelector('#scrDlg .dbody').scrollTop=0`);
    await shot(`058-mcp-dialog-fit-${w}x${h}.png`);
    await js(`document.querySelector('#scrDlg .dbody').scrollTop=1e6`);
    const fc = await footerClear();
    assert.ok(fc.inBody && fc.clear && fc.vis && fc.noteAfterRs && fc.noteBottom <= fc.btnTop + 0.5, `${w}x${h}: the Restart session row and the note are inside the body, above the buttons ${JSON.stringify(fc)}`);
    // Vikram (macOS, ~10 servers): the footer floated over rows in the middle of the list. Top, middle and bottom of the scroll: Done hit-testable, no row meets the footer
    assert.ok(lay.n >= 10 && await js(`!!document.querySelector('#scrDlg .dbody .mcp-rsess')`), `${w}x${h}: a long list with the Restart session row in the body`);
    for (const [where, frac] of [['top', 0], ['middle', 0.5], ['bottom', 1]]) {
      await js(`(()=>{const b=document.querySelector('#scrDlg .dbody');b.scrollTop=(b.scrollHeight-b.clientHeight)*${jsLiteral(frac)};})()`);
      await settle();
      const sf = await footerIntegrity();
      assert.ok(sf.visible && sf.hits.every(Boolean), `${w}x${h}, scrolled to the ${where}: Done is fully visible and clickable ${JSON.stringify(sf)}`);
      assert.strictEqual(sf.over, 0, `${w}x${h}, scrolled to the ${where}: no row meets the footer ${JSON.stringify(sf)}`);
      await assertFooterStyle(`${w}x${h} ${where}`);
    }
    await js(`document.querySelector('#scrDlg .dbody').scrollTop=1e6`);
    await shot(`058-mcp-dialog-fit-end-${w}x${h}.png`);
    await closeDlg();
    await closePanel();
  }
  // ---- review on PR #588: the footer is opaque in every built-in theme ----
  await H.load({ w: 1280, h: 800, ready: 'fit', focus: true });
  const themes = await js(`Object.keys(window.THEME._builtins())`);
  assert.ok(themes.length >= 6 && themes.includes('clean-office'), `the built-in themes are listed ${JSON.stringify(themes)}`);
  for (const t of themes) {
    await closePanel();
    await js(`window.THEME.setTheme(${jsLiteral(t)})`);
    await settle();
    assert.strictEqual(await js(`window.THEME.current().id`), t, `theme ${t} applied`);
    await emit('sim-5', many);
    await openMcp('sim-5');
    await assertFooterStyle(`theme ${t}`);
    const fi = await footerIntegrity();
    assert.ok(fi.visible && fi.hits.every(Boolean) && fi.over === 0, `theme ${t}: Done is clickable and nothing meets the footer ${JSON.stringify(fi)}`);
    await closeDlg();
  }
  await closePanel();

  // ---- review on PR #588: the other wide dialogs (add/edit server, trust) in a short window ----
  await H.load({ w: 1280, h: 600, ready: 'fit', focus: true });
  await js(`window.DurbarScreens.folderMcp(${jsLiteral('~/work/mcp-swiss')},'mcp-swiss')`);
  assert.ok(await until(`!!document.getElementById('mcpAdd')`), 'the folder extras screen opened');
  await js(`document.getElementById('mcpAdd').click()`);
  assert.ok(await until(`!!document.querySelector('#scrDlg .mscope')`), 'the add server dialog opened');
  await settle();
  const add = await wideDialogOk('add server 1280x600');
  assert.ok(add.scrolls && add.nFocus > 3, `the add form scrolls in 600px and has controls ${JSON.stringify(add)}`);
  await shot('058-mcp-wide-add-1280x600.png');
  await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Cancel').click()`);
  await until(`!document.getElementById('scrDlg')`);
  await js(`document.querySelector('li.srv[data-name="docs-search"] [data-act="toggle"]').click()`);
  assert.ok(await until(`/Trust "docs-search"/.test((document.getElementById('scrDlg')||{}).textContent||'')`), 'the trust dialog opened');
  await settle();
  await wideDialogOk('trust 1280x600');
  await shot('058-mcp-wide-trust-1280x600.png');
  await js(`[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Cancel').click()`);
  await until(`!document.getElementById('scrDlg')`);
  console.log('[058] words PASS');
};
