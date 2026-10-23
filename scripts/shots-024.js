/*
 * Checks + screenshots for spec 024 (places in the office: lobby, walking figures, place per MCP server).
 * Simulator only (no AI credits, no Copilot login). Frozen simulator so the open calls are fixed:
 *
 *   npm run build
 *   SHOTS_024=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-024.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * It reads only the page (app.js keeps its state private) and exits non-zero (driver failure) on a miss. Theme-neutral since spec 036:
 * places are matched by their `data-place` id (a theme may rename the display words).
 *   SC-001  every agent at a place is at the place its open call belongs to (bash -> Terminal, github -> Software library,
 *           github -> software, playwright -> web, my-notes -> library), its desk shows the empty chair and its card says so; after a call ends the
 *           agent walks back to its desk.
 *   SC-003  a place chosen in Settings decides where the next call of that server goes. Settings > Places lists ONE github row
 *           (no github-mcp-server row, a note "also github-mcp-server"), and a place set on it applies to a call that comes in as
 *           github-mcp-server (spec 024 FR-014; the walk/SC-001 checks use the plain github name, so both names are covered). (The "survives a restart" part is the
 *           SettingsStore unit test in test-credits: the simulator keeps settings in memory.)
 *   Edge    figures stay on their slots after a window resize and after the full-screen chat was opened and closed; a status
 *           filter hides filtered-out agents in the lobby too; at most 3 figures walk at once; Demo mode hides the lobby.
 * A one-off call is sent with the simulator-only hook window.__durbarSimEmit (spec 010 dev/test infrastructure).
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.SHOTS_024 || '/tmp';
const SIZES = [[1440, 900], [1280, 800]];

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `024-${name}-${w}x${h}.png`), { delay: 300, tag: '024', what: `${name} ${w} ${h}` });
  const settle = async () => { await ctx.waitFor(`!!document.querySelector('.place.busy:not([data-place="coffee"]):not([data-place="boss"]):not([data-place="bank"])')`, 6000); await ctx.waitFor(`!document.querySelector('.walker.walking')`, 6000); await ctx.sleep(200); };
  /* every figure must stand on a lit slot of the lobby */
  const onSlots = () => js(`(()=>{const sl=[...document.querySelectorAll('.lobby .slot.on')].map(e=>e.getBoundingClientRect());const bad=[];document.querySelectorAll('#walkers .walker').forEach(w=>{const b=w.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;if(!sl.some(s=>Math.abs(s.left+s.width/2-cx)<4&&Math.abs(s.top+s.height/2-cy)<4))bad.push([Math.round(cx),Math.round(cy)]);});return {walkers:document.querySelectorAll('#walkers .walker').length,bad}})()`);
  /* which place an away desk is visiting: the data-place id, never the rendered words (spec 036 FR-004) */
  /* tool walks only: the Boss, the Bank and the coffee corner (spec 001 FR-034/FR-035, spec 068) are not tool places */
  const visits = () => js(`[...document.querySelectorAll('#stage .desk.is-away')].map(d=>({id:d.dataset.id,place:d.dataset.place||null})).filter(v=>!['boss','bank','coffee'].includes(v.place))`);
  const placeOf = async (id) => (await visits()).find((v) => v.id === id)?.place || null;
  const expect = { bash: 'terminal', github: 'software', playwright: 'web', 'my-notes': 'library' };

  for (const [w, h] of SIZES) {
    ctx.win.setContentSize(w, h);
    await ctx.sleep(1500);
    await settle();

    // FR-016/FR-017 (issue #116): Settings lists docs-search (an extra that is off, untrusted and never called) with the default place, and one playwright row
    await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
    const ex = await js(`(()=>{const q=n=>[...document.querySelectorAll('#plList .plrow')].filter(r=>r.dataset.srv===n);const d=q('docs-search')[0];const o=d&&d.querySelector('select option:checked');return {docs:q('docs-search').length,docsDefault:o?o.textContent.trim():'',pw:q('playwright').length}})()`);
    assert.strictEqual(ex.docs, 1, 'Settings lists docs-search before any call');
    // the name rules send `docs*` servers to the Library by default (spec 024 #116 scenario 1)
    assert.strictEqual(ex.docsDefault, 'Default (Library)', 'docs-search shows the default place: ' + ex.docsDefault);
    assert.strictEqual(ex.pw, 1, 'exactly one playwright row');
    console.log('[024]', w, 'extras rows', JSON.stringify(ex));
    await js(`document.getElementById('scrClose').click()`); await ctx.sleep(500);

    // SC-001: the right place for each open call, empty chair at the desk, figures on slots
    const vs = await visits();
    console.log('[024]', w, 'visits', JSON.stringify(vs.map((v) => `${v.id}@${v.place}`)));
    assert.ok(vs.length >= 3, 'several agents are in the lobby');
    for (const v of vs) assert.ok(Object.values(expect).includes(v.place), `${v.id}: known place id (${v.place})`);
    assert.ok(new Set(vs.map((v) => v.place)).size >= 3, 'at least three different places are in use');
    let s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures stand on slots'); assert.ok(s.walkers >= 3);
    const label = await js(`document.querySelector('.place.busy:not(.boss):not(.bank):not(.coffee)').getAttribute('aria-label')`);
    assert.ok(/: (nobody|[A-Z])/.test(label), 'a busy place names who is there: ' + label);
    await shot('lobby', w, h);

    // Edge: a resize moves the slots; the figures follow without a walk
    ctx.win.setContentSize(w - 120, h - 40); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after a resize');
    ctx.win.setContentSize(w, h); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after resizing back');

    // Edge: open the full-screen chat of a visiting agent and close it again
    await js(`[...document.querySelectorAll('#stage .desk.is-away')].find(d=>!['boss','bank','coffee'].includes(d.dataset.place)).click()`); await ctx.sleep(600);
    await js(`document.getElementById('backBtn').click()`); await ctx.sleep(700);
    s = await onSlots(); assert.deepStrictEqual(s.bad, [], 'figures on slots after the chat was closed'); assert.ok(s.walkers >= 3);

    // Edge: a status filter hides filtered-out agents in the lobby too
    await js(`document.querySelector('.stat[data-k="waiting"]').click()`); await ctx.sleep(500);
    const filtered = await js(`({walkers:document.querySelectorAll('#walkers .walker').length,atWait:[...document.querySelectorAll('.place.busy')].filter(p=>['boss','bank','coffee'].includes(p.dataset.place)).reduce((t,p)=>t+p.querySelectorAll('.pv:not(.pv-more)').length,0),busy:[...document.querySelectorAll('.place.busy')].filter(p=>!['boss','bank','coffee'].includes(p.dataset.place)).length})`);
    assert.strictEqual(filtered.busy, 0, 'only Waiting agents shown: none of them is at a tool place');
    assert.strictEqual(filtered.walkers, filtered.atWait, 'the only figures are the waiting agents at the Boss, the Bank or the coffee corner (spec 001 FR-034)');
    await js(`document.querySelector('.stat[data-k="waiting"]').click()`); await ctx.sleep(600);
    s = await onSlots(); assert.ok(s.walkers >= 3, 'filter cleared: the figures are back');
  }

  // a walk (mid-walk picture) and the walk back: one github call of an agent at its desk, then its end
  const [w, h] = SIZES[1];
  ctx.win.setContentSize(w, h); await ctx.sleep(800);
  const who = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk:not(.is-away)')].find(d=>/is-(idle|done)/.test(d.className));return d&&d.dataset.id})()`);
  assert.ok(who, 'an idle agent at its desk to send for a walk');
  const call = (n, phase) => js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(who)},timestamp:Date.now(),callId:${jsLiteral(`shots-024-${n}`)},tool:'github-search_issues',phase:${jsLiteral(phase)},mcpServer:'github',mcpTool:'search_issues'})`);
  /* the walk goes to the Web place: it is empty, so the figure is drawn (the Software library may already be full and show "+N" since spec 001 FR-039's narrower tiles) */
  const web = (phase) => js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(who)},timestamp:Date.now(),callId:'shots-024-web',tool:'playwright-browser_navigate',phase:${jsLiteral(phase)},mcpServer:'playwright',mcpTool:'browser_navigate'})`);
  await web('start');
  await ctx.waitFor(`!!document.querySelector('.walker.walking')`, 3000); await ctx.sleep(380);
  const walking = await js(`document.querySelectorAll('.walker.walking').length`);
  assert.ok(walking >= 1 && walking <= 3, 'at most 3 figures walk at once: ' + walking);
  await ctx.shot(path.join(OUT, `024-walking-${w}x${h}.png`)); console.log('[024] saved walking', w, h);
  await ctx.waitFor(`!document.querySelector('.walker.walking')`, 4000);
  assert.strictEqual(await placeOf(who), expect.playwright, 'playwright goes to its place');
  await web('complete');
  await ctx.waitFor(`!document.querySelector('#stage [data-id=${jsLiteral(who)}].is-away')`, 6000);
  assert.strictEqual(await placeOf(who), null, 'back at the desk after the call, the 2 s stay and the walk back');

  // SC-003: Settings sends github to Terminal; the next github call of that agent goes there
  await js(`document.getElementById('settingsBtn').click()`); await ctx.sleep(900);
  const rows = await js(`({github:!!document.querySelector('#plList .plrow[data-srv="github"]'),alias:!!document.querySelector('#plList .plrow[data-srv="github-mcp-server"]'),note:((document.querySelector('#plList .plrow[data-srv="github"] small')||{}).textContent||'').trim()})`);
  assert.strictEqual(rows.github, true, 'Settings lists one github row');
  assert.strictEqual(rows.alias, false, 'no separate github-mcp-server row');
  assert.ok(rows.note.includes('also github-mcp-server'), 'the github row notes the other name: ' + rows.note);
  const row = await js(`(()=>{const s=document.querySelector('#plList .plrow[data-srv="github"] select');if(!s)return false;s.value='terminal';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  assert.ok(row, 'Settings lists the github server');
  await ctx.sleep(600);
  // Settings is long: bring the Places section (heading first) to the top of the scroll area (the save toast stays and confirms the choice), then check the rows are on screen
  // scroll only the Settings container (.scr-body), never the page, so the top bar and Settings header stay in place
  await js(`(()=>{const c=document.querySelector('#screen .scr-body'),sec=document.querySelector('#plList').closest('.scr-sec');c.scrollTop+=sec.getBoundingClientRect().top-c.getBoundingClientRect().top-16})()`);
  await ctx.sleep(900);
  const vis = await js(`(()=>{const r=document.querySelector('#plList .plrow[data-srv="github"]').getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight&&r.left>=0&&r.right<=window.innerWidth})()`);
  const page = await js(`({scroll:document.scrollingElement.scrollTop,top:Math.round(document.querySelector('.topbar').getBoundingClientRect().top)})`);
  assert.deepStrictEqual(page, { scroll: 0, top: 0 }, 'the page itself did not scroll: the top bar is still at y=0');
  assert.strictEqual(vis, true, 'the github row is inside the viewport for the screenshot');
  await shot('settings-places', w, h);
  await js(`document.getElementById('scrClose').click()`); await ctx.sleep(400);
  await call(2, 'start');
  // the desk turns away first and gets its place a moment later: wait for the place itself, not only for is-away
  // Settings sent github to the Terminal place: the next github call goes there (`expect` is keyed by server, so `expect.terminal`
  // was undefined and this check could never pass; the place id is 'terminal', the same as bash's)
  await ctx.waitFor(`(document.querySelector('#stage [data-id=${jsLiteral(who)}].is-away')||{dataset:{}}).dataset.place==='terminal'`, 3000).catch(() => undefined);
  assert.strictEqual(await placeOf(who), expect.bash, 'the mapping decides the place of the next call');
  await call(2, 'complete');
  await ctx.waitFor(`!document.querySelector('#stage [data-id=${jsLiteral(who)}].is-away')`, 6000);

  // FR-014: the place set on the github row also applies to a call that comes in as github-mcp-server
  await js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(who)},timestamp:Date.now(),callId:'shots-024-3',tool:'github-mcp-server-search_issues',phase:'start',mcpServer:'github-mcp-server',mcpTool:'search_issues'})`);
  await ctx.waitFor(`(document.querySelector('#stage [data-id=${jsLiteral(who)}].is-away')||{dataset:{}}).dataset.place==='terminal'`, 3000).catch(() => undefined);
  assert.strictEqual(await placeOf(who), 'terminal', 'a place set on the github row applies to a github-mcp-server call'); // the place id (spec 036 FR-004), not the rendered word
  await js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(who)},timestamp:Date.now(),callId:'shots-024-3',tool:'github-mcp-server-search_issues',phase:'complete',mcpServer:'github-mcp-server',mcpTool:'search_issues'})`);

  // Demo mode hides the lobby and every figure
  await js(`document.getElementById('demoToggle').click()`); await ctx.sleep(800);
  assert.deepStrictEqual(await js(`({lobby:!!document.querySelector('.lobby'),walkers:document.querySelectorAll('#walkers .walker').length})`), { lobby: false, walkers: 0 }, 'Demo mode: no lobby');
  console.log('[024] all checks passed');
};
