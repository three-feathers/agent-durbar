/*
 * Spec 005 FR-246 (issue #1920; FR-245 amended): after an `error` status the turn is over in the chat: Send, not Stop and the spinner; the agent stays in Error; an `idle` after it changes nothing;
 * a `working` after that resumes the turn (Stop and the spinner come back). Simulator only, no credits. The chat of a simulated live agent is open; status events go through the normal path.
 *   1. working: Stop and the spinner are shown, Send is not (the running turn is unchanged);
 *   2. error: Stop and the spinner are gone, Send is back, the agent is in Error;
 *   3. idle: still Error, still no Stop;
 *   4. working: the turn resumed: Stop and the spinner are back.
 * Not driven: the sign-in error (it already cleared the turn), a real session's order of events, Windows, Linux.
 *
 *   npm run check:ui -- --only check-005-error-ends-turn
 * ERROR_TURN_MUTANT (test only), each must fail at its own label: busy = the general error does not clear the turn (today's behaviour; fails at "2: ..."),
 * idle = an idle after an error sets the agent Idle (fails at "3: ..."). Each runs a patched copy of the built app (dist).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUT = process.env.ERROR_TURN_MUTANT || '';
const PATCH = {
  busy: ["closeTurn(a);a.worked=false;a.failedTurn=true; /* spec 005 FR-246", "closeTurn(a);a.failedTurn=true; /* spec 005 FR-246"],
  idle: ["if(a.state==='error'&&a.failedTurn){/* spec 005 FR-245", "if(false){/* spec 005 FR-245"],
};
if (MUT && !PATCH[MUT]) throw new Error('ERROR_TURN_MUTANT must be busy or idle');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  let index;
  let copy;
  if (MUT) {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-error-turn-'));
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
    const emit = (status, intent) => js(`window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: A, timestamp: Date.now(), status, intent })});0`);
    const look = () => js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(A)});const sh=id=>{const e=document.getElementById(id);return !!e&&!e.hidden};return {state:a.state,stop:sh('stopBtn'),spin:sh('runSpin'),send:sh('sendBtn')}})()`);
    const want = async (cond, what) => { const ok = await until(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(A)});const sh=id=>{const e=document.getElementById(id);return !!e&&!e.hidden};const s={state:a.state,stop:sh('stopBtn'),spin:sh('runSpin'),send:sh('sendBtn')};return (${cond.toString()})(s)})()`, 6000); assert.ok(ok, what + '; saw ' + JSON.stringify(await look())); };
    await emit('working');
    await want((s) => s.stop && s.spin && !s.send, '1: a running turn shows Stop and the spinner, not Send');
    await emit('error', 'a failure');
    await want((s) => s.state === 'error' && !s.stop && !s.spin && s.send, '2: after an error the turn is over: Send, not Stop and the spinner, the agent in Error');
    await emit('idle');
    await want((s) => s.state === 'error' && !s.stop && !s.spin, '3: an idle after an error changes nothing: still Error, still no Stop');
    await emit('working');
    await want((s) => s.state === 'working' && s.stop && s.spin, '4: a working status resumes the turn: Stop and the spinner are back');
    console.log('[005-error-ends-turn] ok: an error ends the turn, an idle keeps Error, working resumes');
  } finally {
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
};
