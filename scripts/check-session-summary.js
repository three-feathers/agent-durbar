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
      inside:R.left>=P.left-0.5&&R.right<=P.right+0.5&&(!r||(r.left>=R.left&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5)),count:document.querySelectorAll('.sum-note').length,
      overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,title:n.title}})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simsummary: '1' } });
    await H.calm();
    // sim-1: a repository with changes, a commit, a reported pull request
    await endOf('sim-1');
    let c = await card();
    assert.match(c.text, /^Session summary: 12 files changed, \+340 −80, 3 new files, 1 commit, 1 pull request opened, 25 min, (cost \S+ ?\S*|cost not reported)\.$/, `${w}: sim-1 card: ${c.text}`);
    assert.strictEqual(c.count, 1, `${w}: one card`);
    assert.strictEqual(c.btn, 'Show changed files');
    assert.ok(c.inside && !c.overflowX && c.font >= 10.5, `${w}: the card fits and is legible ${JSON.stringify(c)}`);
    assert.match(c.title, /Counted by Agent Durbar from git/, `${w}: the tooltip says where the numbers come from`);
    await js(`document.querySelector('.sum-note').scrollIntoView({block:'center'})`);
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
  // without the simulator fixture (an ended session main has no start for) there is no card
  await H.load({ w: 1440, h: 900 });
  await endOf('sim-1', false);
  await ctx.sleep(500);
  assert.strictEqual(await js(`document.querySelectorAll('.sum-note').length`), 0, 'no card when main has no summary');
  console.log('[session-summary] all checks passed');
};
