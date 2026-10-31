/*
 * Spec 085 FR-003/FR-004/FR-006/FR-007: the card shown in the chat when a session ends: files, lines, commits, time, cost; a folder that
 * is not git; a folder that already had changes; the changed-files button. Simulator only (`simsummary=1`), no git, no credits.
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-session-summary.js xvfb-run -a npx electron . --no-sandbox
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const until = (expr, ms = 15000) => H.until(expr, ms);
  const endOf = async (id, expectCard = true) => {
    await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('moreBtn')`), `${id}: chat opened`);
    await js(`document.getElementById('moreBtn').click()`);
    assert.ok(await until(`!!document.getElementById('endBtn')`), `${id}: End session in More`);
    await js(`document.getElementById('endBtn').click()`);
    if (expectCard) assert.ok(await until(`!!document.querySelector('.sum-note')`), `${id}: the summary card appears`);
    else assert.ok(await until(`/session ended/i.test(document.getElementById('toasts').textContent)`), `${id}: ended`); // the toast "session ended"; no card
  };
  const card = () => js(`(()=>{const n=document.querySelector('.sum-note'),b=n.querySelector('[data-act="sumFiles"]'),R=n.getBoundingClientRect(),P=document.getElementById('panel').getBoundingClientRect();
    const r=b?b.getBoundingClientRect():null;return {text:n.firstChild.textContent,btn:b?b.textContent:null,font:parseFloat(getComputedStyle(n).fontSize),
      inside:R.width>0&&R.height>0&&P.width>0&&R.top>=0&&R.bottom<=innerHeight+0.5&&R.left>=P.left-0.5&&R.right<=P.right+0.5&&(!r||(r.left>=R.left&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5)),count:document.querySelectorAll('.sum-note').length,
      overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,title:n.title}})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simsummary: '1' } });
    await H.calm();
    // sim-1: a repository with changes, a commit, a reported pull request. Its cost part must be its own usage figure (sim-1 has usage).
    const cost = await js(`window.__durbarSumCost('sim-1')`);
    assert.ok(typeof cost === 'string' && cost.length > 0, `${w}: sim-1 has a usage figure for the card (${cost})`);
    await endOf('sim-1');
    let c = await card();
    assert.strictEqual(c.text, `Session summary: 12 files changed, +340 −80, 3 new files, 1 commit, 1 pull request opened, 25 min, ${cost}. GitHub Copilot reported: 12 files, +338 −80, 2.5 AI credits, 2 requests.`, `${w}: sim-1 card, with its own cost, and the vendor's numbers as a labelled sentence of their own`);
    assert.strictEqual(c.count, 1, `${w}: one card`);
    assert.strictEqual(c.btn, 'Show uncommitted changes');
    assert.ok(c.inside && !c.overflowX && c.font >= 10.5, `${w}: the card fits and is legible ${JSON.stringify(c)}`);
    assert.match(c.title, /Counted by Agent Durbar from git/, `${w}: the tooltip says where the numbers come from`);
    await js(`document.querySelector('.sum-note').scrollIntoView({block:'center'})`);
    // the picture must show the card: the chat is open and the card has a real size inside the window (a hidden 0x0 card fails)
    assert.ok(await until(`(()=>{const n=document.querySelector('.sum-note');if(!n||!document.body.classList.contains('panel-open'))return false;const R=n.getBoundingClientRect();
      return R.width>20&&R.height>10&&R.top>=0&&R.bottom<=innerHeight&&R.left>=0&&R.right<=innerWidth&&getComputedStyle(n).visibility!=='hidden'&&document.elementFromPoint(R.left+R.width/2,R.top+R.height/2)?.closest('.sum-note')===n})()`), `${w}: the card is visible before the screenshot`);
    await H.shot(path.join(OUT, `085-session-summary-${w}x${h}.png`));
    // the button opens the existing folder-changes dialog
    await js(`document.querySelector('.sum-note [data-act="sumFiles"]').click()`);
    assert.ok(await until(`!!document.getElementById('mdT')&&/^Changes in /.test(document.getElementById('mdT').textContent)`), `${w}: the changed-files dialog opens`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].pop().click()`);
    assert.ok(await until(`!document.getElementById('mdT')`), `${w}: the dialog closes`);

    // sim-2: a folder that is not git
    await endOf('sim-2');
    c = await card();
    assert.match(c.text, /^Session summary: not a git folder, so files and lines are not counted, 3 min, cost (\S+ ?\S*|not reported)\.$/, `${w}: sim-2 card: ${c.text}`);
    assert.strictEqual(c.btn, null, `${w}: no files button without git`);

    // sim-3: the folder already had changes
    await endOf('sim-3');
    c = await card();
    assert.match(c.text, /^Session summary: 2 files changed, \+5 −1, no commits, 1 h 5 min, cost .*\. The folder already had changes when the session began; they are counted too\.$/, `${w}: sim-3 card: ${c.text}`);
  }

  // ---- FR-008: the lounge line (Noor and Maya rest in the lounge); FR-009: the strip's sentence; FR-014: calm, no overlap
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simsummary: '1', simaway: '1' } });
    await H.calm();
    assert.ok(await until(`document.querySelectorAll('#stage .lounge .lg-t.sum').length>=1&&document.querySelectorAll('#stage .desk.shut').length===2`, 20000), `${w}: the lounge shows its lines`);
    // the strip: one sentence from the rollup, labelled in its tooltip
    assert.ok(await until(`!!document.querySelector('#awayStrip .aw-brief')`, 10000), `${w}: the strip has the day's numbers`);
    const strip = await js(`(()=>{const e=document.querySelector('#awayStrip .aw-brief'),R=e.getBoundingClientRect(),S=document.getElementById('awayStrip').getBoundingClientRect();return {t:e.textContent,title:e.title,font:parseFloat(getComputedStyle(e).fontSize),inside:R.width>0&&R.left>=S.left-0.5&&R.right<=S.right+0.5&&R.top>=S.top-0.5&&R.bottom<=S.bottom+0.5,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    assert.strictEqual(strip.t, 'Sessions ended yesterday and today: 3, 18 files changed, +400 −90, 2 commits, 2 h 10 min.', `${w}: strip sentence`);
    assert.ok(strip.font >= 10.5 && strip.inside && !strip.overflowX && /Counted by Agent Durbar/.test(strip.title) && /counts twice/.test(strip.title), `${w}: strip legible, inside, honest tooltip ${JSON.stringify(strip)}`);
    // the lounge: every visible line is 10.5 px or more, on one line inside its bubble; the line starts with the numbers
    const geo = () => js(`(()=>{const out=[];for(const b of document.querySelectorAll('#stage .lg-bub')){const t=b.querySelector('.lg-t.on');if(!t)continue;const B=b.getBoundingClientRect(),T=t.getBoundingClientRect(),cs=getComputedStyle(t);
      out.push({text:t.textContent,sum:t.classList.contains('sum'),font:parseFloat(cs.fontSize),oneLine:T.height<=parseFloat(cs.lineHeight)*3+1,inside:T.left>=B.left-0.5&&T.right<=B.right+0.5&&T.top>=B.top-0.5&&T.bottom<=B.bottom+0.5,clickable:cs.pointerEvents==='auto'});}
      const L=[...document.querySelectorAll('#stage .lounge')].map(l=>{const R=l.getBoundingClientRect(),room=l.closest('.room').getBoundingClientRect();return R.left>=room.left-0.5&&R.right<=room.right+0.5&&R.bottom<=room.bottom+0.5});
      return {lines:out,loungesInRoom:L,scrollY:document.getElementById('floor').scrollHeight>document.getElementById('floor').clientHeight+1,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    let g = await geo();
    assert.ok(g.lines.length >= 1 && g.lines.every((l) => l.font >= 10.5 && l.inside), `${w}: lounge lines legible and inside ${JSON.stringify(g.lines)}`);
    assert.ok(g.loungesInRoom.every(Boolean) && !g.scrollY && !g.overflowX, `${w}: no overlap or scroll ${JSON.stringify(g)}`);
    const sumLine = g.lines.find((l) => l.sum);
    assert.ok(sumLine && /^(6 files, \+120 −35|2 files, \+8 −2) · /.test(sumLine.text) && sumLine.clickable, `${w}: the visible line starts with the numbers and is clickable ${JSON.stringify(sumLine)}`);
    // the peek card names the source and says what a click does
    const peek = await js(`(()=>{const d=document.querySelector('#stage .desk.shut[data-id="sim-4"]');const p=d.querySelector('.pk-sum');return {t:p&&p.textContent,title:p&&p.title,label:d.getAttribute('aria-label')}})()`);
    assert.strictEqual(peek.t, '6 files changed, +120 −35, 1 commit, 40 min · Show changed files', `${w}: peek line`);
    assert.ok(/Changed: 6 files changed/.test(peek.label) && /Counted by Agent Durbar/.test(peek.title), `${w}: label and tooltip ${JSON.stringify(peek)}`);
    // look at it: hover Noor (the peek card), then take the picture
    await js(`document.querySelector('#stage .desk.shut[data-id="sim-4"]').scrollIntoView({block:'center'})`);
    const box = await js(`(()=>{const r=document.querySelector('#stage .desk.shut[data-id="sim-4"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    await H.shot(path.join(OUT, `085-lounge-summary-${w}x${h}.png`), { prep: 'calm', keepHover: false });
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
    assert.ok(await until(`getComputedStyle(document.querySelector('#stage .desk.shut[data-id="sim-4"] .peek')).display!=='none'`, 4000), `${w}: the peek card opens`);
    await H.shot(path.join(OUT, `085-lounge-peek-${w}x${h}.png`), { prep: 'calm', keepHover: true });
    // clicking the peek line opens the changed-files list (Noor: 4 files in the sim's git status), not the chat
    await js(`document.querySelector('#stage .desk.shut[data-id="sim-4"] .pk-sum').click()`);
    assert.ok(await until(`!!document.getElementById('mdT')&&/^Changes in /.test(document.getElementById('mdT').textContent)`), `${w}: the peek line opens the changed-files dialog`);
    assert.ok(!(await js(`document.body.classList.contains('panel-open')`)), `${w}: the chat did not open`);
    await js(`[...document.querySelectorAll('#modeDlg .dbtn .btn')].pop().click()`);
    assert.ok(await until(`!document.getElementById('mdT')`), `${w}: closed`);
    // clicking the bubble: the visible line whose agent has numbers
    await js(`(()=>{const t=[...document.querySelectorAll('#stage .lg-t.sum.on')][0];t.click()})()`);
    assert.ok(await until(`!!document.getElementById('mdT')||/No uncommitted changes/.test(document.getElementById('toasts').textContent)`), `${w}: the bubble line opens the list (or says nothing is uncommitted)`);
    await js(`(()=>{const b=[...document.querySelectorAll('#modeDlg .dbtn .btn')].pop();if(b)b.click()})()`);
  }
  // hostile numbers in the strip (a broken main) show as nothing wrong
  await H.load({ w: 1440, h: 900, query: { simsummary: '1', simaway: 'hostile' } });
  assert.ok(await until(`!!document.getElementById('awayStrip')&&!document.getElementById('awayStrip').hidden`, 10000), 'hostile: the strip shows');
  assert.strictEqual(await js(`document.querySelectorAll('#awayStrip .aw-brief').length`), 0, 'hostile: no sentence from broken numbers');
  assert.ok(!(await js(`/NaN|Infinity|undefined|\\[object/.test(document.getElementById('awayStrip').textContent)`)), 'hostile: no garbage shown');
  // without the simulator fixture (an ended session main has no start for) there is no card
  await H.load({ w: 1440, h: 900 });
  await endOf('sim-1', false);
  await ctx.sleep(500);
  assert.strictEqual(await js(`document.querySelectorAll('.sum-note').length`), 0, 'no card when main has no summary');
  console.log('[session-summary] all checks passed');
};
