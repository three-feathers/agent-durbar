/*
 * Spec 005 FR-038 (amended 2026-11-19, issue #1917): the end of a turn in the open chat is said once through #srAnnounce: "Stopped" after Stop,
 * "Reply failed" when the agent is in the error state when the turn ends, else "Reply finished". Simulator only, no credits. The chat of a simulated live agent is open;
 * status events go through the normal path; a MutationObserver on #srAnnounce records every value.
 *   1. working, error, idle: "Reply failed" is said, and "Reply finished" is not (the turn ends at the idle, after the error);
 *   2. working, idle: "Reply finished" is said, and "Reply failed" is not (the old behaviour for a normal end stays);
 *   3. working, error, working again, idle: the agent went on, so "Reply finished" is said and "Reply failed" is not.
 * Not driven: Stop (check-composer-toolbar), a lost session (`stopped`), Windows, Linux, a real screen reader.
 *
 *   npm run check:ui -- --only check-005-announce-failed
 * ANNOUNCE_FAIL_MUTANT (test only), each must fail at its own label: finished = the error case says "Reply finished" (today's behaviour; fails at "1: ..."),
 * always = every end says "Reply failed" (fails at "2: ..."), sticky = a failure is never forgotten when the agent goes on (fails at "3: ..."). Each runs a patched copy of the built app (dist), so the real build is never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUT = process.env.ANNOUNCE_FAIL_MUTANT || '';
const PATCH = {
  finished: ["a.failedTurn?'Reply failed':'Reply finished'", "'Reply finished'"],
  always: ["a.failedTurn?'Reply failed':'Reply finished'", "'Reply failed'"],
  sticky: ['a.worked=true; a.failedTurn=false; /* the agent went on after an error (spec 005 FR-038, issue 1917) */', 'a.worked=true;'],
};
if (MUT && !PATCH[MUT]) throw new Error('ANNOUNCE_FAIL_MUTANT must be finished, always or sticky');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  let index;
  let copy;
  if (MUT) {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-announce-fail-'));
    fs.cpSync(path.join(__dirname, '..', 'dist'), copy, { recursive: true }); // the page reads ../shared too
    const f = path.join(copy, 'renderer', 'app.js');
    const src = fs.readFileSync(f, 'utf8');
    const [from, to] = PATCH[MUT];
    assert.strictEqual(src.split(from).length - 1, 1, `the mutant "${MUT}" finds its line in app.js once`);
    fs.writeFileSync(f, src.replace(from, () => to));
    index = path.join(copy, 'renderer', 'index.html');
  }
  try {
    await H.load({ fastVisits: true, w: 1440, h: 900, focus: true, index });
    const first = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(first.ok, "opened an idle agent's chat " + jsLiteral(first.seen));
    const A = first.id;
    await js(`(()=>{window.__seq=[];window.__last=0;window.__mark=0;const el=document.getElementById('srAnnounce');new MutationObserver(()=>{window.__last=performance.now();if(el.textContent)window.__seq.push(el.textContent);}).observe(el,{childList:true,characterData:true,subtree:true});})();0`);
    const emit = (status, intent) => js(`window.__mark=performance.now();window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: A, timestamp: Date.now(), status, intent })});0`);
    /* announce() lands 60 ms after its call and a later call replaces an earlier one: wait until nothing changed for 150 ms after the last event (a condition) */
    const idle = async (what) => assert.ok(await until('performance.now()-Math.max(window.__last,window.__mark)>150', 8000), 'the announcement settled after ' + what);
    const seen = () => js('window.__seq');
    /* 1 */
    await emit('working'); await idle('the turn started');
    await emit('error', 'a failure'); await idle('the failure');
    await emit('idle'); await idle('the failed turn ended');
    let q = await seen();
    assert.ok(q.includes('Reply failed'), '1: a turn that fails and then ends says "Reply failed"; #srAnnounce took ' + JSON.stringify(q));
    assert.ok(!q.includes('Reply finished'), '1: it does not say "Reply finished"; #srAnnounce took ' + JSON.stringify(q));
    /* 2 */
    await js('window.__seq=[];0');
    await emit('working'); await idle('the second turn started');
    await emit('idle'); await idle('the second turn ended');
    q = await seen();
    assert.ok(q.includes('Reply finished'), '2: a turn that ends normally still says "Reply finished"; #srAnnounce took ' + JSON.stringify(q));
    assert.ok(!q.includes('Reply failed'), '2: it does not say "Reply failed"; #srAnnounce took ' + JSON.stringify(q));
    /* 3 */
    await js('window.__seq=[];0');
    await emit('working'); await idle('the third turn started');
    await emit('error', 'a failure'); await idle('the failure that was not the end');
    await emit('working'); await idle('the agent went on');
    await emit('idle'); await idle('the third turn ended');
    q = await seen();
    assert.ok(q.includes('Reply finished'), '3: a turn that went on after an error says "Reply finished"; #srAnnounce took ' + JSON.stringify(q));
    assert.ok(!q.includes('Reply failed'), '3: it does not say "Reply failed"; #srAnnounce took ' + JSON.stringify(q));
    console.log('[005-announce-failed] ok: "Reply failed" after an error, "Reply finished" after a normal end');
  } finally {
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
};
