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
  }
  console.log('[announce-request] PASS');
};
