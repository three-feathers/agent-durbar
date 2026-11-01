/*
 * Spec 052 FR-209..FR-213 (2026-11-01, review of PR 1004): the other ways a stray key or a changed request could answer for the user.
 *   FR-209  a limit answer in flight takes no second answer; a late answer never hides the next limit; a typed amount survives a repaint (inbox, in check-inbox-safety)
 *   FR-210  the answer bar: a repaint never puts focus on an answering button of another card (a native Enter would answer it); a limit has only "Show in chat"
 *   FR-211  a held Enter in the message box sends nothing (an answer moves focus there)
 *   FR-212  a plan card does not take focus from other work (spec 066 FR-064)
 * Native keys (webContents.sendInputEvent with isAutoRepeat) are used where a synthetic event cannot see the default action.
 * Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=$(mktemp -d) DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-answer-safety.js xvfb-run -a npx electron . --no-sandbox
 *
 * Also in `npm run check:ui` (scripts/ui-suite.js).
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = () => ctx.win.webContents;
  // a real key through the page's input pipeline; `repeat` marks it as held down
  const nkey = async (keyCode, o = {}) => {
    const modifiers = o.repeat ? ['isAutoRepeat'] : [];
    wc().sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') wc().sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    else if (o.char) wc().sendInputEvent({ type: 'char', keyCode: o.char, modifiers });
    wc().sendInputEvent({ type: 'keyUp', keyCode });
    await ctx.sleep(80);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    let A;
    const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: 1, sessionId: A }, e))})`);
    const perm = (rid, summary, extra) => emit({ type: 'status', status: 'needs-permission', intent: 'Waiting', permission: Object.assign({ requestId: rid, kind: 'shell', summary, state: 'pending' }, extra || {}) });
    const limit = (rid) => emit({ type: 'limit', phase: 'exhausted', requestId: rid, maxAiCredits: 5, usedAiCredits: 5 });
    const ask = (rid, q, labels) => emit({ type: 'question', phase: 'asked', requestId: rid, questions: [{ question: q, multiSelect: false, options: (labels || ['yes', 'no']).map((label) => ({ label })) }] });
    // a page per part; every answer that reaches the bridge is counted, and a limit answer can be held in flight (window.__hold)
    const fresh = async () => {
      await H.load({ w, h, focus: true });
      const first = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&(a.state==='idle'||a.state==='done')`, '#msgInput');
      assert.ok(first.ok, `${w}: opened an idle agent's chat ${jsLiteral(first.seen)}`);
      A = first.id;
      await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__perm=[];window.__lim=[];window.__ans=[];window.__plan=[];window.__sent=[];window.__hold=false;window.__holdq=false;window.__relq=[];window.__rel=[];
        const p=b.resolvePermission,l=b.resolveLimit,q=b.answerQuestion,pl=b.resolvePlan,s=b.send;
        b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};
        b.resolveLimit=function(id,rid,c){window.__lim.push(JSON.stringify(c));if(window.__hold)return new Promise(r=>window.__rel.push(r));return l.apply(this,arguments)};
        b.answerQuestion=function(id,rid){window.__ans.push(rid);if(window.__holdq)return new Promise(r=>window.__relq.push(r));return q.apply(this,arguments)};
        b.resolvePlan=function(id,rid,a){window.__plan.push(rid+':'+(a&&a.kind));return pl.apply(this,arguments)};
        b.send=function(){window.__sent.push(1);return s.apply(this,arguments)};})()`);
      await setup();
    };
    const got = (n) => js(`window[${jsLiteral('__' + n)}].slice()`);
    const barUp = async () => {
      await js(`(()=>{const c=document.getElementById('chat');if(!document.getElementById('fillerX')){const f=document.createElement('div');f.id='fillerX';f.style.height='4000px';c.prepend(f);}c.scrollTop=0;c.dispatchEvent(new Event('scroll'));})()`);
      assert.ok(await until(`!document.getElementById('answerBar').hidden`, 5000), `${w}: the answer bar shows (the card is out of view)`);
    };
    const setup = () => js(`window.__bb=l=>[...document.querySelectorAll('#answerBar button')].find(b=>b.textContent===l);window.__cb=l=>[...document.querySelectorAll('#chat .note.limit .note-actions button')].find(b=>b.textContent===l);0`);
    const barLabels = () => js(`[...document.querySelectorAll('#answerBar button')].map(b=>b.textContent)`);
    const focusBar = (label) => js(`(()=>{const b=window.__bb(${jsLiteral(label)});b.focus();return document.activeElement===b})()`);
    const activeLabel = () => js(`document.activeElement.textContent`);

    // ---- FR-210 (A): a second request arrives while Deny has focus: Enter must not answer Allow ----
    await fresh();
    await perm('b1-' + w, 'Run first');
    await barUp();
    assert.ok(await focusBar('Deny'), `${w}: focus on the bar's Deny`);
    await perm('b2-' + w, 'Run second');
    assert.ok(await until(`/1 of 2/.test(document.getElementById('answerBar').textContent)`, 5000), `${w}: the bar repainted with the count`);
    assert.strictEqual(await activeLabel(), 'Deny', `${w}: a repaint of the same card keeps focus on Deny (now ${await activeLabel()})`);
    await nkey('Return');
    assert.deepStrictEqual(await got('perm'), ['b1-' + w + ':false'], `${w}: a native Enter denies what the user focused (Deny of b1), it never allows ${jsLiteral(await got('perm'))}`);

    // ---- FR-210 (A): the card the bar shows settles elsewhere and the next one takes its place ----
    await fresh();
    await perm('c1-' + w, 'Run c one');
    await perm('c2-' + w, 'Run c two');
    await barUp();
    assert.ok(await focusBar('Deny'), `${w}: focus on the bar's Deny (c1)`);
    await js(`[...document.querySelector('#chat .note.perm.pending .note-actions').querySelectorAll('button')].find(b=>b.textContent==='Deny').click()`);
    assert.ok(await until(`/Run c two/.test(document.getElementById('answerBar').textContent)`, 5000), `${w}: the bar shows c2`);
    assert.deepStrictEqual(await got('perm'), ['c1-' + w + ':false'], `${w}: c1 was denied in the chat`);
    assert.strictEqual(await activeLabel(), 'Show in chat', `${w}: focus is on "Show in chat", not on c2's Allow (is ${await activeLabel()})`);
    await nkey('Return');
    assert.deepStrictEqual(await got('perm'), ['c1-' + w + ':false'], `${w}: Enter does not answer c2 ${jsLiteral(await got('perm'))}`);

    // the same card, repainted for a count change: focus stays on the same label (nothing is lost for a keyboard user)
    await fresh();
    await perm('d1-' + w, 'Run d one');
    await barUp();
    assert.ok(await focusBar('Deny'), `${w}: focus on Deny (d1)`);
    await perm('d2-' + w, 'Run d two');
    assert.ok(await until(`/1 of 2/.test(document.getElementById('answerBar').textContent)`, 5000));
    assert.strictEqual(await activeLabel(), 'Deny', `${w}: the same card repainted keeps focus on Deny (is ${await activeLabel()})`);

    // ---- FR-210 (A): a short question has the same shape ----
    await fresh();
    await ask('q1-' + w, 'First question?');
    await ask('q2-' + w, 'Second question?');
    await barUp();
    assert.ok(await until(`!!window.__bb('no')`, 5000), `${w}: the bar offers the options of the first question`);
    assert.ok(await focusBar('no'), `${w}: focus on option "no"`);
    await emit({ type: 'question', phase: 'cancelled', requestId: 'q1-' + w, reason: 'stop' });
    assert.ok(await until(`/Second question/.test(document.getElementById('answerBar').textContent)`, 5000), `${w}: the bar shows the second question`);
    assert.ok(await until(`document.activeElement.textContent!=='no'&&document.activeElement.textContent!=='yes'`, 3000), `${w}: focus is not on an option of another question (is ${await activeLabel()})`);
    await nkey('Return');
    assert.deepStrictEqual(await got('ans'), [], `${w}: Enter answers neither question ${jsLiteral(await got('ans'))}`);

    // option labels come from the agent: an option called "Show question" or "Skip" must not catch the focus of another card
    for (const lbl of ['Show question', 'Skip']) {
      await fresh();
      await ask('r1-' + w, 'First?', [lbl, 'other']);
      await ask('r2-' + w, 'Second?', [lbl, 'other']);
      await barUp();
      assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('#answerBar .ab-opt')].find(x=>x.textContent===${jsLiteral(lbl)});if(!b)return false;b.focus();return document.activeElement===b})()`), `${w}: focus on the agent's option "${lbl}"`);
      await emit({ type: 'question', phase: 'cancelled', requestId: 'r1-' + w, reason: 'stop' });
      assert.ok(await until(`/Second\?/.test(document.getElementById('answerBar').textContent)`, 5000), `${w}: the bar shows the second question`);
      assert.ok(await until(`document.activeElement.classList.contains('ghost')`, 3000), `${w}: focus is on the bar's own Show button, not on the option "${lbl}" (is ${await js('document.activeElement.className+"/"+document.activeElement.textContent')})`);
      await nkey('Return');
      assert.deepStrictEqual(await got('ans'), [], `${w}: Enter answers neither (option "${lbl}") ${jsLiteral(await got('ans'))}`);
    }

    // the same card repainted (a count change) while focus is on the bar's own "Skip" / "Show question", and the agent has an option of the same name: focus stays on the real control
    for (const [lbl, cls] of [['Skip', 'danger'], ['Show question', 'ghost']]) {
      await fresh();
      await ask('s1-' + w, 'First?', [lbl, 'other']);
      await barUp();
      assert.ok(await until(`!!document.querySelector('#answerBar .${cls}')`, 5000), `${w}: the bar has its ${cls} button`);
      await js(`document.querySelector('#answerBar .${cls}').focus()`);
      await ask('s2-' + w, 'Second?', ['x', 'y']);
      assert.ok(await until(`/1 of 2/.test(document.getElementById('answerBar').textContent)`, 5000), `${w}: the bar repainted with the count`);
      assert.ok(await js(`document.activeElement.classList.contains('${cls}')&&!document.activeElement.classList.contains('ab-opt')`), `${w}: focus stays on the real "${lbl}" control, not the agent's option of that name (is ${await js('document.activeElement.className+"/"+document.activeElement.textContent')})`);
    }

    // ---- a held Enter in a chat question's "Other" box, with a slow bridge: one answer ----
    await fresh();
    await ask('o1-' + w, 'Pick one?', ['x', 'y']);
    assert.ok(await until(`!!document.querySelector('#chat .note.question .q-other')`, 5000), `${w}: the question card is there`);
    await js(`window.__holdq=true`);
    await js(`(()=>{const o=document.querySelector('#chat .note.question .q-other');o.value='my answer';o.dispatchEvent(new Event('input',{bubbles:true}));o.focus();})()`);
    await nkey('Return');
    for (let i = 0; i < 5; i++) await nkey('Return', { repeat: true });
    assert.strictEqual((await got('ans')).length, 1, `${w}: a held Enter in the Other box answers once ${jsLiteral(await got('ans'))}`);

    // ---- FR-210 (B): a limit card out of view: the bar has no amount to send, only "Show in chat" ----
    await fresh();
    await limit('lb-' + w);
    await js(`(()=>{const c=document.getElementById('chat');if(!document.getElementById('fillerX')){const f=document.createElement('div');f.id='fillerX';f.style.height='4000px';c.prepend(f);}c.scrollTop=0;c.dispatchEvent(new Event('scroll'));})()`);
    assert.ok(await until(`!document.getElementById('answerBar').hidden`, 5000), `${w}: the bar shows for the limit`);
    assert.deepStrictEqual(await barLabels(), ['Show in chat'], `${w}: only "Show in chat" ${jsLiteral(await barLabels())}`);
    assert.strictEqual(await js(`!!document.querySelector('#answerBar input')`), false, `${w}: no field in the bar`);

    // ---- FR-211 (C): a held Enter in the message box sends nothing; one Enter sends the draft ----
    await fresh();
    await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='a draft';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await nkey('Return', { repeat: true });
    await nkey('Return', { repeat: true });
    assert.deepStrictEqual(await got('sent'), [], `${w}: a held Enter in the message box sends nothing ${jsLiteral(await got('sent'))}`);
    // the route: an answer in the bar moves focus here, and the held Enter that pressed it goes on
    await fresh();
    await perm('e1-' + w, 'Run e one');
    await barUp();
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='my draft';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.ok(await focusBar('Allow once'), `${w}: focus on Allow once`);
    await nkey('Return');
    assert.ok(await until(`window.__perm.length===1`, 3000), `${w}: Enter answers (once)`);
    assert.strictEqual(await js(`document.activeElement.id`), 'msgInput', `${w}: focus moved to the message box`);
    await nkey('Return', { repeat: true });
    await nkey('Return', { repeat: true });
    assert.deepStrictEqual(await got('sent'), [], `${w}: the held Enter that answered does not send the draft ${jsLiteral(await got('sent'))}`);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'my draft', `${w}: the draft is still there`);

    // ---- FR-209 (3) in the chat card: one answer in flight; then back on after a failure ----
    await fresh();
    await limit('lc-' + w);
    assert.ok(await until(`!!document.querySelector('#chat .note.limit .note-actions')`, 5000), `${w}: the limit card is in the chat`);
    await js(`window.__hold=true`);
    await js(`window.__cb('Raise limit').click()`);
    assert.ok(await until(`window.__lim.length===1`, 3000), `${w}: Raise limit goes out`);
    assert.strictEqual(await js(`window.__cb('Remove limit').disabled&&window.__cb('Raise limit').disabled&&document.querySelector('#chat .note.limit .limit-amt').disabled`), true, `${w}: the buttons and the field are off while it is on its way`);
    await js(`window.__cb('Remove limit').click()`);
    assert.strictEqual((await got('lim')).length, 1, `${w}: a second answer is not sent ${jsLiteral(await got('lim'))}`);
    // a native held Enter on the focused Raise limit button
    await js(`(()=>{const b=window.__cb('Raise limit');b.disabled=false;b.focus();b.disabled=true;})()`);
    for (let i = 0; i < 4; i++) await nkey('Return', { repeat: i > 0 });
    assert.strictEqual((await got('lim')).length, 1, `${w}: a held Enter does not send again ${jsLiteral(await got('lim'))}`);
    // it fails: the card is usable again
    await js(`window.__rel.shift()({ok:false,error:'no'})`);
    assert.ok(await until(`!window.__cb('Raise limit').disabled&&!window.__cb('Remove limit').disabled&&!document.querySelector('#chat .note.limit .limit-amt').disabled`, 3000), `${w}: after a failure the buttons and field are back on`);

    // ---- FR-209 (item 2) in the card: 0.004 rounds to 0, which is not an amount ----
    await js(`window.__hold=false`);
    const n0 = (await got('lim')).length;
    await js(`(()=>{document.querySelector('#chat .note.limit .limit-amt').value='0.004';})()`);
    await js(`window.__cb('Raise limit').click()`);
    assert.strictEqual((await got('lim')).length, n0, `${w}: 0.004 sends nothing from the card ${jsLiteral(await got('lim'))}`);

    // ---- FR-209 (D): a late answer to the first limit does not settle the second one ----
    await fresh();
    await limit('l1-' + w);
    assert.ok(await until(`!!document.querySelector('#chat .note.limit .note-actions')`, 5000));
    await js(`window.__hold=true`);
    await js(`[...document.querySelectorAll('#chat .note.limit .note-actions button')].find(b=>b.textContent==='Remove limit').click()`);
    assert.ok(await until(`window.__lim.length===1`, 3000), `${w}: the first limit's answer is in flight`);
    await limit('l2-' + w);
    assert.ok(await until(`document.querySelectorAll('#chat .note.limit').length===2`, 5000), `${w}: the second limit card arrived`);
    await js(`window.__rel.shift()({ok:true})`);
    await H.settle(1000).catch(() => {});
    assert.strictEqual(await js(`document.querySelectorAll('#chat .note.limit:not(.settled)').length`), 1, `${w}: the second limit is still waiting`);
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A)}).state`), 'waiting', `${w}: the agent still waits for you`);

    // ---- FR-209: the adapter's `resolved` event comes first; the late reply never rewrites what it said ----
    await fresh();
    await limit('lr-' + w);
    assert.ok(await until(`!!document.querySelector('#chat .note.limit .note-actions')`, 5000));
    await js(`window.__hold=true`);
    await js(`window.__cb('Raise limit').click()`);
    assert.ok(await until(`window.__lim.length===1`, 3000));
    await emit({ type: 'limit', phase: 'resolved', requestId: 'lr-' + w, action: 'cancel' });
    assert.ok(await until(`/stopped here/.test(document.querySelector('#chat .note.limit .pstate').textContent)`, 3000), `${w}: the event settled the card as stopped`);
    await js(`window.__rel.shift()({ok:true})`);
    await H.settle(600).catch(() => {});
    assert.ok(/stopped here/.test(await js(`document.querySelector('#chat .note.limit .pstate').textContent`)), `${w}: the late reply left it "stopped here" (is ${await js(`document.querySelector('#chat .note.limit .pstate').textContent`)})`);

    // ---- FR-212 (E): the plan takes focus on Approve only if no modal is open, the box is empty, and focus is on the page or in the empty box ----
    const plan = (n) => emit({ type: 'plan', phase: 'proposed', requestId: 'pl' + n + '-' + w, text: '1. Do a thing' });
    const onApprove = () => js(`!!document.activeElement&&document.activeElement.textContent==='Approve'`);
    // typing: stays, and Enter does not approve
    await fresh();
    await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='half a sentence';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await plan(1);
    assert.ok(await until(`!!document.querySelector('#chat .plan-card')`, 5000), `${w}: the plan card is there`);
    assert.strictEqual(await js(`document.activeElement.id`), 'msgInput', `${w}: with text in the box, focus stays there`);
    await nkey('Return');
    assert.deepStrictEqual(await got('plan'), [], `${w}: Enter while typing does not approve the plan ${jsLiteral(await got('plan'))}`);
    // focus on the page: Approve (the send-then-approve flow)
    await fresh();
    await js(`document.activeElement&&document.activeElement.blur()`);
    await plan(2);
    assert.ok(await until(`document.activeElement&&document.activeElement.textContent==='Approve'`, 5000), `${w}: with nothing typed and focus on the page, focus goes to Approve`);
    // focus in the empty box: Approve too
    await fresh();
    await js(`document.getElementById('msgInput').focus()`);
    await plan(3);
    assert.ok(await until(`document.activeElement&&document.activeElement.textContent==='Approve'`, 5000), `${w}: with the empty box focused, focus goes to Approve`);
    // a modal is open (the inbox, focus on a heading): focus stays there
    await fresh();
    await js(`document.getElementById('inboxBtn').click()`);
    assert.ok(await until(`!!document.querySelector('#inboxBody .ib-h')`, 5000));
    await js(`document.querySelector('#inboxBody .ib-h').focus()`);
    await plan(4);
    assert.ok(await until(`!!document.querySelector('#chat .plan-card')`, 5000));
    assert.strictEqual(await onApprove(), false, `${w}: with the inbox open, a plan does not take the focus`);
    assert.ok(await js(`document.activeElement.classList.contains('ib-h')`), `${w}: focus is still on the inbox heading`);
    // a modal is open and focus is on the page (nothing focused): the plan still does not take it
    await fresh();
    await js(`document.getElementById('inboxBtn').click()`);
    assert.ok(await until(`!!document.getElementById('inboxDlg')`, 5000));
    await js(`document.activeElement&&document.activeElement.blur()`);
    await plan(6);
    assert.ok(await until(`!!document.querySelector('#chat .plan-card')`, 5000));
    assert.strictEqual(await onApprove(), false, `${w}: with the inbox open and focus on the page, a plan does not take the focus`);
    // focus on a button of another card (a permission card's Deny in the chat): focus stays, a held Enter on it does not approve the plan
    await fresh();
    await perm('pd-' + w, 'Run before the plan');
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .note-actions')`, 5000));
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').focus()`);
    await plan(5);
    assert.ok(await until(`!!document.querySelector('#chat .plan-card')`, 5000));
    assert.strictEqual(await onApprove(), false, `${w}: focus on another card's Deny is not taken by Approve`);
    for (let i = 0; i < 3; i++) await nkey('Return', { repeat: true });
    assert.deepStrictEqual(await got('plan'), [], `${w}: a held Enter does not approve the plan ${jsLiteral(await got('plan'))}`);
    // a held Enter on the plan's own Approve answers nothing
    await js(`[...document.querySelectorAll('#chat .plan-card button')].find(b=>b.textContent==='Approve').focus()`);
    for (let i = 0; i < 3; i++) await nkey('Return', { repeat: true });
    assert.deepStrictEqual(await got('plan'), [], `${w}: a held Enter on Approve answers nothing ${jsLiteral(await got('plan'))}`);
    await nkey('Return');
    assert.ok(await until(`window.__plan.length===1`, 3000), `${w}: one Enter on Approve approves (the control)`);
  }
  console.log('[answer-safety] PASS');
};
