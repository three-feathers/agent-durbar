/*
 * Spec 005 FR-237 (amended 2026-11-11, issue #1488): the first permission request after a chat opens is what #srAnnounce ends on, not "Working…".
 * Simulator only, no credits. The chat of an idle agent is open, the agent asks first (permission mode 'ask'), a message is sent, and a
 * MutationObserver on #srAnnounce records every value with its time. The permission request, the question and the MCP/elicitation request are
 * said at request priority, so the "Working…" that the turn start says in the same 60 ms window never replaces them.
 *
 *   npm run check:ui -- --only check-005-announce-request
 *   ANNOUNCE_TRACE=1           prints every value #srAnnounce took, with its time
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ fastVisits: true, w, h, focus: true });
    const first = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(first.ok, `${w}: opened an idle agent's chat ${jsLiteral(first.seen)}`);
    const A = first.id;
    const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: 1, sessionId: A }, e))})`);
    await js(`(()=>{window.__seq=[];window.__t0=performance.now();const el=document.getElementById('srAnnounce');
      new MutationObserver(()=>{window.__seq.push([Math.round(performance.now()-window.__t0),el.textContent]);}).observe(el,{childList:true,characterData:true,subtree:true});})();0`);
    const seq = () => js(`window.__seq.filter(x=>x[1]).slice()`);
    const trace = async (tag) => { if (process.env.ANNOUNCE_TRACE === '1') console.log(`[announce ${w}] ${tag}: ` + JSON.stringify(await js(`window.__seq.slice()`))); };
    // settled: something was said and the last change is older than 150 ms (a condition, not a fixed wait)
    const settled = (src) => until(`(()=>{const q=window.__seq,re=new RegExp(${jsLiteral(src)});return q.some(x=>re.test(x[1]))&&performance.now()-window.__t0-q[q.length-1][0]>150;})()`, 8000);
    const end = () => js(`document.getElementById('srAnnounce').textContent`);

    // ---- 1. a permission request: ask first, send a message (the turn starts: "Working…"), the request arrives in the same window ----
    assert.strictEqual(await js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(A)},'ask',{}).then(r=>r.ok)`), true, `${w}: the agent asks first`);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'status', status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'r1-' + w, kind: 'shell', summary: 'Run the first request', state: 'pending' } });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending')`, 8000), `${w}: the permission card is in the chat`);
    assert.ok(await settled('needs your OK'), `${w}: the request is announced and #srAnnounce settles`);
    await trace('permission');
    assert.ok((await seq()).some((x) => /needs your OK/.test(x[1])), `${w}: the request is announced ${jsLiteral(await seq())}`);
    assert.ok(/needs your OK: Run the first request/.test(await end()), `${w}: #srAnnounce ends on the request, not on a status (ends on ${jsLiteral(await end())}; history ${jsLiteral(await seq())})`);

    // ---- 2. the same turn start in one tick with a question ----
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'status', status: 'idle' });
    assert.ok(await until(`document.getElementById('srAnnounce').textContent!==${jsLiteral(await end())}`, 8000), `${w}: the idle status is said`);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'question', phase: 'asked', requestId: 'q1-' + w, questions: [{ question: 'Which colour?', multiSelect: false, options: [{ label: 'red' }, { label: 'blue' }].map((o) => ({ label: o.label })) }] });
    assert.ok(await until(`!!document.querySelector('#chat .question')`, 8000), `${w}: the question card is in the chat`);
    assert.ok(await settled('asks: Which colour'), `${w}: the question is announced and #srAnnounce settles`);
    await trace('question');
    assert.ok(/asks: Which colour\?/.test(await end()), `${w}: #srAnnounce ends on the question (ends on ${jsLiteral(await end())}; history ${jsLiteral(await seq())})`);

    // ---- 3. the same turn start in one tick with an MCP elicitation (the card the request text is in) ----
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'status', status: 'idle' });
    await until(`document.getElementById('srAnnounce').textContent!==${jsLiteral(await end())}||window.__seq.length>0`, 8000);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'question', phase: 'asked', requestId: 'e1-' + w, questions: [{ question: 'Where should this deploy go?', header: 'deploy-mcp', multiSelect: false, options: [] }],
      elicitation: { message: 'Where should this deploy go?', source: 'deploy-mcp', fields: [{ name: 'environment', title: 'Which environment?', type: 'enum', required: true, enumValues: ['staging', 'production'] }] } });
    assert.ok(await until(`!!document.querySelector('#chat .note.elicit')`, 8000), `${w}: the elicitation card is in the chat`);
    assert.ok(await settled('Where should this deploy go'), `${w}: the elicitation is announced and #srAnnounce settles`);
    await trace('elicitation');
    assert.ok(/Where should this deploy go\?/.test(await end()), `${w}: #srAnnounce ends on the elicitation (ends on ${jsLiteral(await end())}; history ${jsLiteral(await seq())})`);

    // ---- 4. FR-237 (issue #1582): a spending-limit card and a plan card that arrive in the open chat are said, once each ----
    const said = (re) => js(`window.__seq.filter(x=>new RegExp(${jsLiteral(re)},'i').test(x[1])).length`);
    const quiet = async () => { await js(`window.__seq.length=0;0`); await emit({ type: 'status', status: 'idle' }); await until(`document.getElementById('srAnnounce').textContent===''||window.__seq.length>0`, 8000); await js(`window.__seq.length=0;0`); };
    // After a repeated event: one card, one line. A status-priority sentinel is dropped while a request line waits in the 60 ms window and written
    // when none does, so the wait ends on the sentinel (nothing was waiting) or on a second request line (the repeat said it again): no fixed delay.
    const repeatSaysNothing = async (re, card, what) => {
      await js(`window.__durbarSimUi.announce('sentinel-after-repeat')`);
      assert.ok(await until(`window.__seq.some(x=>x[1]==='sentinel-after-repeat')||window.__seq.filter(x=>new RegExp(${jsLiteral(re)},'i').test(x[1])).length>1`, 8000), `${w}: after the repeated ${what} event #srAnnounce took the sentinel or a second line`);
      assert.strictEqual(await js(`document.querySelectorAll(${jsLiteral(card)}).length`), 1, `${w}: a repeated ${what} event builds no second card`);
      assert.strictEqual(await said(re), 1, `${w}: a repeated ${what} event says nothing again (history ${jsLiteral(await seq())})`);
    };
    await quiet();
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'limit', phase: 'exhausted', requestId: 'l1-' + w, maxAiCredits: 50, usedAiCredits: 50 });
    assert.ok(await until(`!!document.querySelector('#chat .note.limit')`, 8000), `${w}: the limit card is in the chat`);
    assert.ok(await settled('spending limit'), `${w}: the limit is announced and #srAnnounce settles`);
    assert.ok(/reached its spending limit: .*Choose in its card/.test(await end()), `${w}: limit card in the open chat: #srAnnounce ends on the limit line (ends on ${jsLiteral(await end())}; history ${jsLiteral(await seq())})`);
    assert.strictEqual(await said('spending limit'), 1, `${w}: limit card in the open chat is said once (history ${jsLiteral(await seq())})`);
    await emit({ type: 'limit', phase: 'exhausted', requestId: 'l1-' + w, maxAiCredits: 50, usedAiCredits: 50 }); // the same request again: nothing new
    await repeatSaysNothing('spending limit', '#chat .note.limit', 'limit');
    await emit({ type: 'limit', phase: 'resolved', requestId: 'l1-' + w, action: 'unset' });

    await quiet();
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await emit({ type: 'plan', phase: 'proposed', requestId: 'p1-' + w, text: 'Step one: read the files.' });
    assert.ok(await until(`!!document.querySelector('#chat .plan-card')`, 8000), `${w}: the plan card is in the chat`);
    assert.ok(await settled('proposes a plan'), `${w}: the plan is announced and #srAnnounce settles`);
    assert.ok(/proposes a plan\. Approve, revise or reject it in its card/.test(await end()), `${w}: plan card in the open chat: #srAnnounce ends on the plan line (ends on ${jsLiteral(await end())}; history ${jsLiteral(await seq())})`);
    assert.strictEqual(await said('proposes a plan'), 1, `${w}: plan card in the open chat is said once (history ${jsLiteral(await seq())})`);
    await emit({ type: 'plan', phase: 'proposed', requestId: 'p1-' + w, text: 'Step one: read the files.' }); // repeated: no second card, nothing said
    await repeatSaysNothing('proposes a plan', '#chat .plan-card', 'plan');
    await emit({ type: 'plan', phase: 'resolved', requestId: 'p1-' + w, action: 'reject' });
  }
  // ---- 5. no second line: a limit that arrives with the chat closed says nothing then, and the open-chat line says it once when the chat opens.
  // A fresh page, so no older request is waiting (the open-chat line says the oldest one). ----
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ fastVisits: true, w, h, focus: true, query: { simnotes: 'some' } });
    const first = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(first.ok, `${w}: opened an idle agent's chat ${jsLiteral(first.seen)}`);
    const A = first.id;
    const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: 1, sessionId: A }, e))})`);
    await js(`(()=>{window.__seq=[];window.__t0=performance.now();const el=document.getElementById('srAnnounce');
      new MutationObserver(()=>{window.__seq.push([Math.round(performance.now()-window.__t0),el.textContent]);}).observe(el,{childList:true,characterData:true,subtree:true});})();0`);
    const seq = () => js(`window.__seq.filter(x=>x[1]).slice()`);
    const settled = (src) => until(`(()=>{const q=window.__seq,re=new RegExp(${jsLiteral(src)});return q.some(x=>re.test(x[1]))&&performance.now()-window.__t0-q[q.length-1][0]>150;})()`, 8000);
    const said = (re) => js(`window.__seq.filter(x=>new RegExp(${jsLiteral(re)},'i').test(x[1])).length`);
    const end = () => js(`document.getElementById('srAnnounce').textContent`);
    await H.key('Escape');
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 8000), `${w}: the chat closes`);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'limit', phase: 'exhausted', requestId: 'l2-' + w, maxAiCredits: 50, usedAiCredits: 50 });
    // the limit card's break line is a status said right after the card is built (startCoffee): once it is in, a request line said on arrival would be in too
    assert.ok(await until(`window.__seq.some(x=>x[1])`, 8000), `${w}: the arrival said its break line`);
    assert.strictEqual(await said('spending limit'), 0, `${w}: limit card with the chat closed says nothing on arrival (history ${jsLiteral(await seq())})`);
    const re = await H.openSimAgent(`a=>a.id===${jsLiteral(A)}`, '#msgInput');
    assert.ok(re.ok, `${w}: the chat opens again ${jsLiteral(re.seen)}`);
    assert.ok(await settled('[Ss]pending limit'), `${w}: opening the chat says the limit and #srAnnounce settles (history ${jsLiteral(await seq())})`);
    assert.strictEqual(await said('spending limit'), 1, `${w}: limit card said once in all (arrival and open) (history ${jsLiteral(await seq())})`);
    // ---- 5a. the card's own chat is open but the card is hidden (the Browser tab, the Notes drawer): the line sends you to the chat, never "in its card" ----
    const hiddenCase = async (what, open, close, id, plan) => {
      const [ev, re, hear, word] = plan
        ? [{ type: 'plan', phase: 'proposed', requestId: id + '-' + w, text: 'Step one.' }, /proposes a plan\. Open its chat to review it\.$/, 'proposes a plan', 'plan']
        : [{ type: 'limit', phase: 'exhausted', requestId: id + '-' + w, maxAiCredits: 50, usedAiCredits: 50 }, /reached its spending limit\. Open its chat to choose\.$/, 'spending limit', 'limit'];
      await open();
      await js(`window.__seq.length=0;0`);
      await emit(ev);
      assert.ok(await settled(plan ? 'proposes a plan' : 'reached its spending limit'), `${w}: ${what}: the ${word} is announced and #srAnnounce settles (history ${jsLiteral(await seq())})`);
      assert.ok(re.test(await end()) && !/in its card/.test(await end()), `${w}: ${what}: the ${word} card is hidden, so the line never says "in its card" (ends on ${jsLiteral(await end())})`);
      assert.strictEqual(await said(hear), 1, `${w}: ${what}: the ${word} is said once (history ${jsLiteral(await seq())})`);
      await emit(plan ? { type: 'plan', phase: 'resolved', requestId: id + '-' + w, action: 'reject' } : { type: 'limit', phase: 'resolved', requestId: id + '-' + w, action: 'unset' });
      await close();
    };
    const browserTab = [async () => {
      await js(`document.getElementById('tabBrowser').click()`);
      assert.ok(await until(`document.getElementById('tabBrowser').getAttribute('aria-selected')==='true'`, 8000), `${w}: the Browser tab is selected`);
    }, async () => {
      await js(`document.getElementById('tabChat').click()`);
      assert.ok(await until(`document.getElementById('tabChat').getAttribute('aria-selected')==='true'`, 8000), `${w}: the Chat tab is selected again`);
    }];
    await hiddenCase('the Browser tab is showing', ...browserTab, 'l5');
    await hiddenCase('the Browser tab is showing', ...browserTab, 'p5', true);
    await hiddenCase('the Notes drawer is open', async () => {
      await js(`document.getElementById('moreBtn').click()`);
      assert.ok(await until(`!!document.getElementById('notesHdrBtn')&&!document.getElementById('moreMenu').hidden`, 8000), `${w}: More has Notes`);
      await js(`document.getElementById('notesHdrBtn').click()`);
      assert.ok(await until(`!!document.getElementById('notesDrawer')&&!document.getElementById('notesDrawer').hidden`, 8000), `${w}: the Notes drawer is open`);
    }, async () => {
      await H.key('Escape');
      assert.ok(await until(`document.getElementById('notesDrawer').hidden`, 8000), `${w}: the Notes drawer closes`);
    }, 'l6');
    // ---- 5b. ANOTHER agent's chat is open (Auto-follow off): the card is named, not "in its card", said once ----
    await emit({ type: 'limit', phase: 'resolved', requestId: 'l2-' + w, action: 'unset' });
    const B = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&a.id!==${jsLiteral(A)}&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(B.ok, `${w}: another idle agent's chat opens ${jsLiteral(B.seen)}`);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'limit', phase: 'exhausted', requestId: 'l3-' + w, maxAiCredits: 50, usedAiCredits: 50 });
    assert.ok(await settled('reached its spending limit'), `${w}: another chat open: the limit is announced and #srAnnounce settles (history ${jsLiteral(await seq())})`);
    assert.ok(/reached its spending limit\. Open its chat to choose\.$/.test(await end()) && !/in its card/.test(await end()), `${w}: another chat open: the limit line sends you to its chat, never "in its card" (ends on ${jsLiteral(await end())})`);
    assert.strictEqual(await said('spending limit'), 1, `${w}: another chat open: the limit is said once (history ${jsLiteral(await seq())})`);
    await js(`window.__seq.length=0;0`);
    await emit({ type: 'plan', phase: 'proposed', requestId: 'p3-' + w, text: 'Step one: read the files.' });
    assert.ok(await settled('proposes a plan'), `${w}: another chat open: the plan is announced and #srAnnounce settles (history ${jsLiteral(await seq())})`);
    assert.ok(/proposes a plan\. Open its chat to review it\.$/.test(await end()) && !/in its card/.test(await end()), `${w}: another chat open: the plan line sends you to its chat, never "in its card" (ends on ${jsLiteral(await end())})`);
    assert.strictEqual(await said('proposes a plan'), 1, `${w}: another chat open: the plan is said once (history ${jsLiteral(await seq())})`);
  }
  // Auto-follow on with another chat open is driven in check-auto-follow (the notice says it, the arrival adds no line).
  console.log('[announce-request] PASS');
};
