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
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
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
  console.log('[058] mcp row width PASS');
};
