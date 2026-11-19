/*
 * Spec 005 FR-244 (issue #1908): an agent that enters the error state while its chat is not shown is said once through #srAnnounce, "<name> has an error."
 * Simulator only, no credits. A MutationObserver on #srAnnounce records every value. Cases (flat office, 1440x900, each a status event through the normal path):
 *   1. agent B goes working, then error, its chat closed: "<B> has an error." is said, once;
 *   2. B stays in error (a second error event): nothing more is said for B (a later error of agent C, the marker, is said, and B's line is still one);
 *   3. B's own chat is open and B fails: nothing is said for B (the chat shows it; a marker again proves the observer was alive).
 * Not driven: a hidden folder or floor (FR-174's rule), the simulator's start-up replay, Windows and Linux, a real screen reader.
 *
 *   npm run check:ui -- --only check-005-announce-error
 * ANNOUNCE_ERR_MUTANT (test only), each must fail at its own label: silent = the line is never said ("B said ..."); again = said on every error event, not only on entering it ("B is said once");
 * shown = said while B's chat is open ("nothing is said for B while its chat is open"). Each runs a patched copy of the built app (dist), so the real build is never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUT = process.env.ANNOUNCE_ERR_MUTANT || '';
const PATCH = {
  silent: ["announce(a.name+' has an error.')", '0'],
  again: ["if(state==='error'&&wasState!=='error')noteFailed(a)", "if(state==='error')noteFailed(a)"],
  shown: ['  if(chatShownNow(a.id))return;\n  const rm=roomOf(a)', '  const rm=roomOf(a)'],
};
if (MUT && !PATCH[MUT]) throw new Error('ANNOUNCE_ERR_MUTANT must be silent, again or shown');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  let index;
  let copy;
  if (MUT) {
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-announce-err-'));
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
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live).map(a=>({id:a.id,name:a.name}))`);
    assert.ok(ids.length >= 3, 'three simulated agents: ' + JSON.stringify(ids));
    const [B, C, D] = ids;
    await js(`(()=>{window.__seq=[];const el=document.getElementById('srAnnounce');window.__last=0;window.__mark=0;new MutationObserver(()=>{window.__last=performance.now();if(el.textContent)window.__seq.push(el.textContent);}).observe(el,{childList:true,characterData:true,subtree:true});})();0`);
    const emit = (id, status, intent) => js(`window.__mark=performance.now();window.__durbarSimUi.emit(${jsLiteral({ type: 'status', sessionId: id, timestamp: Date.now(), status, intent })});0`);
    const said = (name) => js(`window.__seq.filter(x=>x===${jsLiteral(name + ' has an error.')}).length`);
    const waitSaid = async (name, n, what) => { const ok = await until(`window.__seq.filter(x=>x===${jsLiteral(name + ' has an error.')}).length>=${n}`, 8000); assert.ok(ok, `${what}; #srAnnounce took ${JSON.stringify(await js('window.__seq'))}`); };
    /* announce() sets its text 60 ms after the call and a later call replaces an earlier one that has not landed: a case waits until nothing has changed in #srAnnounce for 150 ms after its last event (a condition, as check-005-announce-request's `settled`) */
    const idle = async (what) => assert.ok(await until('performance.now()-Math.max(window.__last,window.__mark)>150', 8000), 'the announcement settled after ' + what);
    /* 1 */
    await emit(B.id, 'working');
    await emit(B.id, 'error', 'a failure');
    await idle('the first failure');
    await waitSaid(B.name, 1, `1: ${B.name} said "has an error." when it entered the error state`);
    /* 2: a later error of C is the marker: B's line is still one after it */
    await emit(B.id, 'error', 'a failure again');
    await idle('the second error event');
    assert.strictEqual(await said(B.name), 1, `2: ${B.name} is said once, not on every error event`);
    await emit(C.id, 'working');
    await emit(C.id, 'error', 'another failure');
    await waitSaid(C.name, 1, `2: the marker ${C.name} said`);
    assert.strictEqual(await said(B.name), 1, `2: ${B.name} is said once, not on every error event`);
    /* 3: B's chat is open and B fails again */
    const opened = await H.openSimAgent(`a=>a.id===${jsLiteral(B.id)}`, '#msgInput');
    assert.ok(opened.ok, '3: opened the chat of ' + B.name + ' ' + jsLiteral(opened.seen));
    await emit(B.id, 'working');
    await emit(B.id, 'error', 'a failure with the chat open');
    await idle('the failure with the chat open');
    assert.strictEqual(await said(B.name), 1, `3: nothing is said for ${B.name} while its chat is open`);
    await emit(D.id, 'working');
    await emit(D.id, 'error', 'a third failure');
    await waitSaid(D.name, 1, `3: the marker ${D.name} said`);
    assert.strictEqual(await said(B.name), 1, `3: nothing is said for ${B.name} while its chat is open`);
    console.log('[005-announce-error] ok: said once on entering the error state, not again, not with the chat open');
  } finally {
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
};
