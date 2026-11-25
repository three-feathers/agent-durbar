/*
 * Check for spec 058 (delta 2026-11-12, issue #1622): a failed server's row in a chat's MCP list keeps a readable text column. The name
 * stays on one line and the help text wraps in full lines; when the buttons do not fit beside the text they wrap below it, they never
 * squeeze it. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-mcp-row-width
 *   OUT=<folder>  (optional) saves 058-mcp-row-<w>x<h>.png
 *   MEASURE=1     prints the measured widths and does not assert (for the before/after numbers)
 *
 * At 1440x900, 1280x800 and 800x700, in the flat office and Retro: a Copilot chat reports a remote server (shown as `redshift-prod`: its name text is set by hand, the simulator has no long-named remote server) as Failed (refused: needs
 * sign-in) among a few other servers; the MCP dialog opens and the row's measures are read after two animation frames: the name's text
 * is on one line, the text column (`.srv-main`) is at least 220px wide (the buttons wrapped below it when they do not fit), the help text
 * is at most 3 lines, the buttons stay inside the row, nothing is under 10.5px, and the page does not scroll sideways.
 *
 * Spec 058 FR-436 (delta 2026-11-24, owner's report): a row with a long state ("Running · Renewed <date> <time>") and no text under the name, light
 * and dark: no row taller than the lines FR-436 allows, the text column at least 12em, the name broken only at hyphens, the long state at least 8em wide with its Renewed piece on one line, the
 * buttons inside the row, no sideways scroll of the dialog or the page. FR-437: the dialog is min(--dlg-w-l, window - 32px) wide. Every
 * row assert is a property, not a pixel count, so it holds in CI's fonts too: the text column at least 12em, the name broken only at a
 * hyphen or a space, a height bound built from the row's own line heights (see MIN_TEXT_EM). Also at 900x700, at 900x700 with 150% zoom (a 568 px
 * dialog, as wide as the owner's) and at 640x700 with 200% zoom (see LONG_SIZES for what is asserted there). OUT gets
 * 058-mcp-row-long-<w>x<h>[-zoom]-<light|dark>[-tools].png (-tools: the tidy row's Tools list open).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK, CHECK_DARK_QUERY, darkFixtureProblem } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const MEASURE = !!process.env.MEASURE;
const MIN_TEXT = 220; // px: a readable text column (about 30 characters of 11px text)

const SIZES = [[1440, 900], [1280, 800], [800, 700]];
const THEMES = [['flat', 'clean-office'], ['retro', 'retro']];
const SERVERS = [
  /* the simulator's `?simmcpauth=again` remote server: its row has Tools, Restart, Sign in again..., Remove... and the switch, the widest row there is */
  { name: 'team-wiki', status: 'failed', transport: 'http', source: 'user', sources: ['copilot'], error: 'connect ECONNREFUSED 127.0.0.1:9' },
  { name: 'playwright', status: 'failed', transport: 'stdio', source: 'user', error: 'spawn playwright ENOENT', errorClass: 'not-found' },
  { name: 'tidy', status: 'connected', transport: 'stdio', source: 'user' },
];

/* spec 058 FR-436 (2026-11-24, owner's report): a signed-in row with a long state ("Running · Renewed <date> <time>") and no text under it.
   `team-wiki` is the simulator's remote server (Tools, Restart, Sign in again... and the switch); its shown name is set by hand to a
   31-character name and a Remove... button is added by hand (the simulator has neither a long-named remote server nor Remove... on a server the
   session reported: the owner's row had both), its renewal two days back so the state carries the date. `crm` is the same row with a short
   state, `tidy` a short row with fewer buttons. Light (the flat office) and dark (the check-dark fixture). */
const LONG_NAME = 'atlassian-mcp-server-enterprise';
/* zoomed entries are narrow rooms: 900 px at 150% zoom is 600 px of page, a 568 px dialog (the owner's dialog was about that wide); the smallest
   window (640 px) at 200% zoom is 320 px of page, where the buttons and the state wrap inside the row. Where the page itself scrolls sideways
   (the office is not made for a 320 px page; the dialog then scrolls 1 px sideways and clips its footer, before this change too) only the row's
   own measures are asserted (name, state, buttons inside), not the height bound or the sideways scroll */
const LONG_SIZES = [[1440, 900, 1], [1280, 800, 1], [900, 700, 1], [900, 700, 1.5], [640, 700, 2]];
/* spec 058 FR-437: the dialog's width is min(--dlg-w-l, window - 32px) (spec 052 FR-167's L), read from the page's own token so the check follows it */
const DLG_MARGIN = 32;
const LONG_THEMES = [['light', 'clean-office', {}], ['dark', CHECK_DARK, CHECK_DARK_QUERY]];
const LONG_SERVERS = [
  { name: 'team-wiki', status: 'connected', transport: 'http', source: 'user' },
  { name: 'crm', status: 'connected', transport: 'http', source: 'user' },
  { name: 'tidy', status: 'connected', transport: 'stdio', source: 'user' },
];
const MIN_TEXT_EM = 12; // FR-436: the text column's floor, in em of its own font (flex-basis 12em), unless the whole row is narrower
const MIN_STATE_EM = 8; // the state's width in em of its own font
/* The height bound is not a pixel number (it would depend on the font: CI's DejaVu is wider than a desktop's Noto). Each row's bound is
   built in the page from its own measures and the lines FR-436 allows: the row's padding and border, the name on at most 2 lines (a
   12em column holds about 20 of its characters a line, so 31 characters broken at hyphens fit in 2), one line of source tags, the state on
   at most 2 lines (its word, then the Renewed piece moved under it whole), the gaps between those 4 lines, and the buttons' own box
   (beside the text or wrapped below it, with the row's gap). The collapse this guards against was about 530 px. */

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const rowMeasure = (n) => js(`(()=>{const li=[...document.querySelectorAll('#agMcp li.srv')].find(x=>x.dataset.n===${jsLiteral(n)});if(!li)return null;
    const R=e=>e?e.getBoundingClientRect():null, main=li.querySelector('.srv-main'), act=li.querySelector('.srv-act'), nm=li.querySelector('.srv-name');
    const lines=e=>{if(!e)return 0;const r=document.createRange();r.selectNodeContents(e);return new Set([...r.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size};
    const hint=li.querySelector('.srv-hint'), lh=hint?parseFloat(getComputedStyle(hint).lineHeight)||parseFloat(getComputedStyle(hint).fontSize)*1.3:0;
    const mr=R(main), ar=R(act), lr=R(li);
    return {row:Math.round(lr.width),text:Math.round(mr.width),act:ar?Math.round(ar.width):0,nameLines:lines(nm),nameW:Math.round(R(nm).width),
      hintLines:hint?Math.round(hint.getBoundingClientRect().height/lh):0,hintW:hint?Math.round(R(hint).width):0,
      actBelow:!!ar&&ar.top>=mr.bottom-1, actInside:!!ar&&ar.right<=lr.right+0.5&&ar.left>=lr.left-0.5,
      btns:[...li.querySelectorAll('.srv-act button')].map(b=>b.textContent.trim()),
      small:[...li.querySelectorAll('*')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(t=>t.nodeType===3&&t.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.className),
      pageX:document.documentElement.scrollWidth<=innerWidth}})()`);
  const raf2 = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);

  for (const [w, h] of SIZES) {
    for (const [wname, theme] of THEMES) {
      const tag = `${w}x${h} ${wname}`;
      await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: 'again' } });
      await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      const cands = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`);
      const id = cands[0]; // the reported servers below replace whatever the simulator listed for it
      assert.ok(id, `${tag}: a running Copilot chat: ${JSON.stringify(cands)}`);
      await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
      assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), `${tag}: the chat opened with its MCP chip`);
      await js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(SERVERS)}})`);
      assert.ok(await until(`!!document.querySelector('#mcpBtn .ct-dot')`), `${tag}: the chip shows the failure`);
      await js(`document.getElementById('mcpBtn').click()`);
      assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="team-wiki"] .srv-why')`), `${tag}: the dialog shows the failed row`);
      await js(`document.querySelector('#agMcp li.srv[data-n="team-wiki"]').scrollIntoView({block:'center'})`);
      await raf2();
      await js(`document.querySelector('#agMcp li.srv[data-n="team-wiki"] .srv-name').textContent='redshift-prod'`);
      await raf2();
      const m = await rowMeasure('team-wiki');
      if (MEASURE) console.log(`[1622] ${tag} ${JSON.stringify(m)}`);
      await H.shot(path.join(OUT, `058-mcp-row-${w}x${h}${wname === 'flat' ? '' : '-' + wname}.png`), { prep: 'mouse', tag: '058' });
      if (!MEASURE) {
        assert.ok(m, `${tag}: the row is there`);
        assert.strictEqual(m.nameLines, 1, `${tag}: the server name is on one line ${JSON.stringify(m)}`);
        assert.ok(m.text >= MIN_TEXT, `${tag}: the text column is at least ${MIN_TEXT}px wide, not squeezed by the buttons ${JSON.stringify(m)}`);
        assert.ok(m.hintLines >= 1 && m.hintLines <= 3, `${tag}: the help text wraps in at most 3 lines ${JSON.stringify(m)}`);
        assert.ok(m.actInside, `${tag}: the buttons stay inside the row ${JSON.stringify(m)}`);
        assert.ok(m.small.length === 0 && m.pageX, `${tag}: no text under 10.5px, no sideways page scroll ${JSON.stringify(m)}`);
      }
      await js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`);
    }
  }

  /* FR-436: every row of the dialog, measured: height, the name's width and line count, the state's width and its renewal piece's lines */
  const allRows = () => js(`(()=>{const R=e=>e?e.getBoundingClientRect():null;
    const lines=e=>{if(!e)return 0;const r=document.createRange();r.selectNodeContents(e);return new Set([...r.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size};
    const body=document.querySelector('#scrDlg .dbody');
    const dl=document.querySelector('#scrDlg .dlg'),xl=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dlg-w-l'));
    return {dlgW:dl?dl.offsetWidth:0,dlgCls:dl?dl.className:'',xl,vw:innerWidth,panelX:body?body.scrollWidth-body.clientWidth:-1,pageX:document.documentElement.scrollWidth<=innerWidth,rows:[...document.querySelectorAll('#agMcp li.srv')].map(li=>{
      const main=li.querySelector('.srv-main'),act=li.querySelector('.srv-act'),nm=li.querySelector('.srv-name'),st=li.querySelector('.mst'),rn=li.querySelector('.mst-renew');
      const lr=R(li),ar=R(act),cs=getComputedStyle(main),fs=parseFloat(getComputedStyle(st).fontSize),ls=getComputedStyle(li),top=li.querySelector('.srv-top');
      /* a line break inside the name that is not after a hyphen or a space: a break inside a word */
      const midBreaks=(()=>{const t=nm.firstChild;if(!t||t.nodeType!==3)return [];const out=[];let prev=null;const r=document.createRange();
        for(let i=0;i<t.length;i++){r.setStart(t,i);r.setEnd(t,i+1);const q=r.getClientRects()[0];if(!q)continue;const y=Math.round(q.top);if(prev!==null&&y>prev+1&&!/[-\s]/.test(t.data[i-1]))out.push(t.data.slice(Math.max(0,i-4),i)+'|'+t.data.slice(i,i+4));prev=y;}return out})();
      const px=v=>parseFloat(v)||0, padY=px(ls.paddingTop)+px(ls.paddingBottom)+px(ls.borderTopWidth)+px(ls.borderBottomWidth);
      const lhName=R(nm).height/Math.max(1,lines(nm)), chip=li.querySelector('.srv-top .mtag'), lhState=R(st.querySelector('.mst-w')).height, gTop=px(getComputedStyle(top).rowGap);
      const bound=Math.ceil(padY+2*lhName+(chip?R(chip).height:0)+2*lhState+3*gTop+px(ls.rowGap)+(ar?ar.height:0))+1;
      return {n:li.dataset.n,name:nm.textContent,h:Math.round(lr.height),bound,row:Math.round(lr.width),rowIn:Math.round(lr.width-px(ls.paddingLeft)-px(ls.paddingRight)-px(ls.borderLeftWidth)-px(ls.borderRightWidth)),text:Math.round(R(main).width),textEm:+(R(main).width/px(cs.fontSize)).toFixed(1),mainFs:px(cs.fontSize),midBreaks,act:ar?Math.round(ar.width):0,
        flex:cs.flexGrow+' '+cs.flexShrink+' '+cs.flexBasis,minW:cs.minWidth,
        nameW:Math.round(R(nm).width),nameLines:lines(nm),stateW:Math.round(R(st).width),stateLines:lines(st.querySelector('.mst-w')),stateEm:+(R(st).width/fs).toFixed(1),
        renew:rn?rn.textContent:'',renewW:rn?Math.round(R(rn).width):0,renewLines:lines(rn),
        beside:!!ar&&ar.top<R(main).bottom-1,actInside:!!ar&&ar.right<=lr.right+0.5&&ar.left>=lr.left-0.5&&ar.bottom<=lr.bottom+0.5&&ar.top>=lr.top-0.5,
        small:[...li.querySelectorAll('*')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(t=>t.nodeType===3&&t.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.className)};})}})()`);
  for (const [w, h, z] of LONG_SIZES) {
    for (const [tname, theme, q] of LONG_THEMES) {
      const tag = `${w}x${h}${z === 1 ? '' : ' zoom ' + z} ${tname} long state`;
      await H.load({ w, h, ready: 'fit', focus: true, query: { simmcpauth: 'again', ...q } });
      await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      if (tname === 'dark') { const bad = await darkFixtureProblem(ctx); assert.ok(!bad, `${tag}: ${bad}`); }
      const cands = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)`);
      const id = cands[0];
      assert.ok(id, `${tag}: a running Copilot chat: ${JSON.stringify(cands)}`);
      await js(`window.__durbarSimSignIn.renewed(${jsLiteral(id)},'team-wiki',Date.now()-2*86400000)`);
      await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
      assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('mcpBtn')`), `${tag}: the chat opened with its MCP chip`);
      await js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(LONG_SERVERS)}})`);
      await js(`document.getElementById('mcpBtn').click()`);
      assert.ok(await until(`!!document.querySelector('#agMcp li.srv[data-n="team-wiki"] .mst-renew')&&!!document.querySelector('#agMcp li.srv[data-n="team-wiki"] [data-signagain]')`), `${tag}: the signed-in row shows Renewed and Sign in again...`);
      /* the dialog repaints its rows (a state report, the renewal clock): the long name is set again after each repaint until Done */
      await js(`(()=>{const N=${jsLiteral(LONG_NAME)},set=()=>{const li=document.querySelector('#agMcp li.srv[data-n="team-wiki"]'),e=li&&li.querySelector('.srv-name');if(e&&e.textContent!==N)e.textContent=N;
          const act=li&&li.querySelector('.srv-act');if(act&&!act.querySelector('[data-mrm],[data-probe]')){const b=document.createElement('button');b.className='btn sm';b.type='button';b.dataset.probe='1';b.textContent='Remove\u2026';act.insertBefore(b,act.querySelector('.swt'))}};set();
        window.__mcpLongName=new MutationObserver(set);window.__mcpLongName.observe(document.getElementById('scrDlg'),{childList:true,subtree:true,characterData:true});return 0})()`);
      if (z !== 1) { ctx.win.webContents.setZoomFactor(z); assert.ok(await until(`Math.abs(window.devicePixelRatio-${jsLiteral(z)})<0.01`), `${tag}: the page is zoomed`); }
      await js(`document.querySelector('#agMcp li.srv[data-n="team-wiki"]').scrollIntoView({block:'center'})`);
      await raf2();
      const m = await allRows();
      if (MEASURE) console.log(`[FR-436] ${tag} ${JSON.stringify(m)}`);
      await H.shot(path.join(OUT, `058-mcp-row-long-${w}x${h}${z === 1 ? '' : '-zoom'}-${tname}.png`), { prep: 'mouse', tag: '058' });
      if (!MEASURE) {
        const longR = m.rows.find((r) => r.n === 'team-wiki'), shortR = m.rows.find((r) => r.n === 'crm');
        assert.ok(longR && shortR && longR.name === LONG_NAME, `${tag}: the long and the short row are there ${JSON.stringify(m)}`);
        for (const r of m.rows) {
          if (m.pageX && LONG_SERVERS.some((x) => x.name === r.n)) assert.ok(r.h <= r.bound, `${tag}: row ${r.n} is at most ${r.bound}px tall, the lines FR-436 allows (no collapsed column) ${JSON.stringify(r)}`);
          assert.ok(r.text >= Math.min(MIN_TEXT_EM * r.mainFs, r.rowIn) - 0.5, `${tag}: the text column of ${r.n} is at least ${MIN_TEXT_EM}em (or the whole row) wide ${JSON.stringify(r)}`);
          assert.deepStrictEqual(r.midBreaks, [], `${tag}: the name of ${r.n} breaks only at a hyphen or a space, never inside a word ${JSON.stringify(r)}`);
          if (r.renew) assert.ok(r.stateEm >= MIN_STATE_EM, `${tag}: the long state of ${r.n} is at least ${MIN_STATE_EM}em wide, never one character a line ${JSON.stringify(r)}`);
          else assert.strictEqual(r.stateLines, 1, `${tag}: the short state of ${r.n} is on one line ${JSON.stringify(r)}`);
          assert.ok(r.actInside, `${tag}: the buttons of ${r.n} stay inside its row ${JSON.stringify(r)}`);
          assert.ok(r.small.length === 0, `${tag}: no text under 10.5px in ${r.n} ${JSON.stringify(r)}`);
        }
        if (z === 1) {
          const want = Math.min(m.xl, m.vw - DLG_MARGIN);
          assert.ok(m.xl > 0 && Math.abs(m.dlgW - want) <= 1, `${tag}: the MCP dialog is min(--dlg-w-l, window - ${DLG_MARGIN}px) = ${want}px wide ${JSON.stringify({ dlgW: m.dlgW, xl: m.xl, vw: m.vw, cls: m.dlgCls })}`);
        }
        assert.strictEqual(longR.renewLines, 1, `${tag}: "${longR.renew}" stays on one line ${JSON.stringify(longR)}`);
        assert.strictEqual(shortR.nameLines, 1, `${tag}: the short row's name is on one line ${JSON.stringify(shortR)}`);
        if (z === 1 || m.pageX) assert.ok(m.panelX <= 0 && m.pageX, `${tag}: the dialog and the page do not scroll sideways ${JSON.stringify({ panelX: m.panelX, pageX: m.pageX })}`);
      }
      /* the Tools list of a short row, open inside the wider dialog: a picture for the eye, no assert */
      await js(`(()=>{const b=document.querySelector('#agMcp li.srv[data-n="tidy"] [data-tools]');if(b){b.click();b.closest('li').scrollIntoView({block:'center'})}return 0})()`);
      await until(`(()=>{const t=document.querySelector('#agMcp li.srv[data-n="tidy"] .mcp-tools');return !!t&&!/Loading tools/.test(t.textContent)})()`);
      await js(`(()=>{const t=document.querySelector('#agMcp li.srv[data-n="tidy"]');if(t)t.scrollIntoView({block:'center'});return 0})()`);
      await raf2();
      await H.shot(path.join(OUT, `058-mcp-row-long-${w}x${h}${z === 1 ? '' : '-zoom'}-${tname}-tools.png`), { prep: 'mouse', tag: '058' });
      if (z !== 1) ctx.win.webContents.setZoomFactor(1);
      await js(`(()=>{if(window.__mcpLongName)window.__mcpLongName.disconnect();const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent==='Done');if(b)b.click();})()`);
    }
  }
  console.log('[058] mcp row width PASS');
};
