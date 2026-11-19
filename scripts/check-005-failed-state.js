/*
 * Spec 005 FR-245 (issue #1919): a turn that failed keeps showing the error. Simulator only, no credits; status events through the normal path; the flat office,
 * no chat open (the unread mark shows only for a chat that is not shown).
 *   1. working, error, idle: the agent is in Error (not Done), its desk has no "New" unread mark (a second agent's normal end, whose mark shows, proves the page redrew since), its text is not "Finished.";
 *   2. then working: Working again (the error is left by the next turn);
 *   3. working, idle: Done as before, with the unread mark (the old behaviour for a normal end stays, and the mark can show);
 *   4. working, error, working, idle: the agent went on, so Done.
 * Not driven: a real session's order of events, Windows, Linux.
 *
 *   npm run check:ui -- --only check-005-failed-state
 * FAILED_STATE_MUTANT (test only), each must fail at its own label: done = the idle of a failed turn sets Done (today's behaviour; fails at "1: ..."),
 * always = every idle leaves the state as it was (fails at "1: the marker agent's unread mark showed": a normal end no longer marks). Each runs a patched copy of the built app (dist).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUT = process.env.FAILED_STATE_MUTANT || '';
const LINE = "if(a.state==='error'){";
const PATCH = {
  done: [LINE, "if(false){"],
  always: [LINE, "if(was){"],
};
if (MUT && !PATCH[MUT]) throw new Error('FAILED_STATE_MUTANT must be done or always');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  let index;
  let copy;
  if (MUT) {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-failed-state-'));
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
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&(a.state==='idle'||a.state==='done')).map(a=>a.id)`);
    assert.ok(ids.length >= 1, 'a simulated live agent at rest');
    const A = ids[0];
    const emit = (status, intent) => js(`window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: A, timestamp: Date.now(), status, intent })});0`);
    const look = () => js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(A)});const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(A)})+'"]');return {state:a.state,task:String(a.task||''),mark:!!(d&&d.querySelector('.unread-mark'))}})()`);
    const settle = async (want, what) => { const ok = await until(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(A)});return a&&a.state===${jsLiteral(want)}&&!window.__durbarSimUi.pending?.()})()`, 8000); const l = await look(); assert.ok(ok, what + '; saw ' + JSON.stringify(l)); return l; };
    /* 1 */
    await emit('working'); await settle('working', '1: working');
    await emit('error', 'a failure'); await settle('error', '1: error');
    await emit('idle');
    /* B, a second agent, ends a normal turn: its unread mark appearing proves the page has redrawn since A's idle, so A's missing mark is a fact and not a mark still to come */
    const B = ids[1];
    assert.ok(B, 'a second simulated live agent at rest');
    const emitB = (status) => js(`window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: B, timestamp: Date.now(), status })});0`);
    await emitB('working'); await emitB('idle');
    assert.ok(await until(`!!document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(B)})+'"] .unread-mark')`, 8000), "1: the marker agent's unread mark showed");
    let l = await look();
    assert.strictEqual(l.state, 'error', '1: a turn that failed and went idle is in Error, not Done; saw ' + JSON.stringify(l));
    assert.ok(!/Finished/.test(l.task), '1: its text is not "Finished."; saw ' + JSON.stringify(l));
    assert.strictEqual(l.mark, false, '1: a failed turn has no "New" unread mark; saw ' + JSON.stringify(l));
    /* 2 */
    await emit('working'); l = await settle('working', '2: the next turn leaves Error');
    /* 3 */
    await emit('idle'); l = await settle('done', '3: a turn that ends normally is Done');
    assert.ok(await until(`!!document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(A)})+'"] .unread-mark')`, 8000), '3: and it has its unread mark; saw ' + JSON.stringify(await look()));
    /* 4 */
    await emit('working'); await settle('working', '4: working');
    await emit('error', 'a failure that was not the end'); await settle('error', '4: error');
    await emit('working'); await settle('working', '4: went on');
    await emit('idle'); l = await settle('done', '4: a turn that went on after an error ends Done');
    console.log('[005-failed-state] ok: a failed turn stays in Error; a normal end and a turn that went on are Done');
  } finally {
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
};
