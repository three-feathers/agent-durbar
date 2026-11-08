/*
 * Spec 052 FR-191..FR-195, FR-205 (T196, T197): Your door, the Needs you queue as a non-modal panel (behind the `door` flag, off by default).
 * Steps of FR-205 built here: 1 typing, 2 no shift, 3 new, 8 focus, 9a app start (Q-NY-3), the empty panel (Q-NY-13) and, in Real office,
 * the Boss door slips staying visible (Q-NY-15). T198, T199 (second slice) add `door2()`: 5 stale press, 6 rise guard (panel open and a row moved under the pointer),
 * 7 the limit row (no letter key), the long request (480 characters), a failed answer's word, 9b option buttons by request id. The other steps (4, 9, 10, 11) are T200, T201.
 * Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=$(mktemp -d) DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-needs-panel.js xvfb-run -a npx electron . --no-sandbox
 *
 * The page is loaded with `door=1` (the flag). Mutation checks (listed in the PR and the 2026-11-08 delta): focus the first heading on an automatic open (step 1),
 * drop the arming at app start (9a), make the panel modal (aria-modal, step 1), drop the throttle or the dismissal rule (step 3), let Esc close
 * from a text field (step 8), give the panel a layout position (step 2); second slice: answer a stale press, drop the rise guard, drop the moved-under-pointer rule,
 * let a letter key press Raise limit, answer the agent's next card for a stale option, show the word without waiting for the card.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: Date.now() }, e))})`);
  const READY = { flat: 'fit', real: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'` };
  const deskRects = () => js(`JSON.stringify([...document.querySelectorAll('#stage .desk[data-id]')].map(d=>{const r=d.getBoundingClientRect();return [d.dataset.id,Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];}))`);
  const count = () => js(`Number((document.querySelector('#inboxBtn b')||{}).textContent)||0`);
  const panelOpen = () => js(`!!document.getElementById('needsPanel')`);
  // every agent that needs you finishes its turn (as check-auto-follow does), so nothing waits
  const answerAll = async () => {
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&(a.state==='waiting'||a.state==='error')).map(a=>a.id)`);
    await js(`window.__durbarSimUi.agents().forEach(a=>{if(a.limit)a.limit=null;})`); // the spending limit of the simulator's agent: a limit counts as needing you
    for (const id of ids) {
      await emit({ sessionId: id, type: 'status', status: 'working', intent: 'Working' });
      await emit({ sessionId: id, type: 'output', final: true, text: 'Done.' });
      await emit({ sessionId: id, type: 'status', status: 'idle' });
    }
  };
  const key = (k, mods, o) => H.key(k, mods, o);

  // ---- T198, T199: stale and rise guards in rows, option buttons by request id, the limit row, the long request, the real outcome ----
  const door2 = async (at, tag, w, view, load) => {
    await load(true);
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>0`, 15000), `${at}: something waits`);
    // agents that wait for nothing and hold no card now (the simulator's waiting ones keep their cards): the pool the steps take theirs from
    const pool = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&a.info&&a.state!=='waiting'&&a.state!=='error'&&a.state!=='needs-permission'&&!a.limit&&!a.paused).map(a=>a.id)`);
    assert.ok(pool.length >= 9, `${at}: agents to use ${JSON.stringify(pool)}`);
    await answerAll();
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 10000), `${at}: nothing waits`);
    const shut = async () => { if (await panelOpen()) { await js(`document.getElementById('inboxClose').click()`); await until(`!document.getElementById('needsPanel')`, 3000); } };
    const open = async () => { await shut(); await js(`document.getElementById('inboxBtn').click()`); assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000), `${at}: the panel is open`); };
    const ag = (i) => pool[i];
    const perm = (id, rid, summary) => emit({ type: 'status', sessionId: id, status: 'needs-permission', intent: 'Waiting', permission: { requestId: rid, kind: 'shell', summary, state: 'pending' } });
    const ask = (id, rid, q, labels) => emit({ type: 'question', sessionId: id, phase: 'asked', requestId: rid, questions: [{ question: q, multiSelect: false, options: (labels || []).map((label) => ({ label })) }] });
    const row = (id) => `#needsPanel .inbox-row[data-id=${jsLiteral(id)}]`;
    const armed = (id) => until(`(document.querySelector(${jsLiteral(row(id))})||{dataset:{}}).dataset.armed==='1'`, 3000);
    const perms = () => js('window.__perm.slice()');
    const clear = async () => { await answerAll(); assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 10000), `${at}: the sim's agents are done`); await shut(); }; // the simulator's agent keeps waiting after its card is answered: finish its turn
    const stripAnswered = (n) => until(`window.__perm.length>=${n}`, 3000);

    // ---- 6: the rise guard. A press inside RISE_GUARD_MS of the panel opening answers nothing (the row says armed=0); after it, it answers ----
    const A = await ag(0);
    await perm(A, 'rg1-' + tag, 'Run the guarded one');
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000), `${at}: one request waits`);
    await shut();
    const g = await js(`(()=>{document.getElementById('inboxBtn').click();const r=document.querySelector('#needsPanel .inbox-row');const b=r.querySelector('[data-k="approve"]');const armed0=r.dataset.armed;b.click();return {armed0,perm:window.__perm.slice(),answering:!!r.dataset.answering}})()`);
    assert.strictEqual(g.armed0, '0', `${at}: a row of a panel just opened is guarded (data-armed=0) ${JSON.stringify(g)}`);
    assert.deepStrictEqual(g.perm, [], `${at}: a press inside the guard answers nothing ${JSON.stringify(g)}`);
    assert.strictEqual(g.answering, false, `${at}: and the row is not being answered ${JSON.stringify(g)}`);
    assert.ok(await armed(A), `${at}: after the guard the row is armed`);
    await js(`document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')}).click()`);
    assert.ok(await stripAnswered(1), `${at}: after the guard a press answers`);
    assert.deepStrictEqual(await perms(), ['rg1-' + tag + ':true'], `${at}: and it is that request`);
    const doneA = JSON.stringify(await js('window.__done'));
    assert.ok(await until(`window.__done.some(t=>/Allowed/.test(t))`, 3000), `${at}: the word comes after the card settled: Allowed ${doneA}`);
    await H.shot(path.join(OUT, `052-door-${tag}-answered.png`), { prep: 'mouse', settle: false });
    await clear();

    // ---- 6b: a row that moves under the pointer is guarded again ----
    const B = await ag(1), C = await ag(2);
    await perm(B, 'mv1-' + tag, 'Run the first of two');
    await ctx.sleep(120);
    await perm(C, 'mv2-' + tag, 'Run the second of two');
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two requests wait`);
    await open();
    assert.ok(await armed(B) && await armed(C), `${at}: both rows armed`);
    await js(`(()=>{const rs=[...document.querySelectorAll('#needsPanel .inbox-row')];window.__first=rs[0].dataset.id;const r=rs[0].getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointermove',{clientX:Math.round(r.left+r.width/2),clientY:Math.round(r.top+r.height/2),bubbles:true}));
      const second=rs[1].dataset.id;window.__mv=null;
      new MutationObserver(()=>{const n=document.querySelector('#needsPanel .inbox-row[data-id="'+second+'"]');if(!n||window.__mv||n===rs[1])return;const before=window.__perm.slice();n.querySelector('[data-k="approve"]').click();window.__mv={armed:n.dataset.armed,before,after:window.__perm.slice()};}).observe(document.getElementById('inboxBody'),{childList:true});
      window.__second=second;})()`);
    await js(`document.querySelector('#needsPanel .inbox-row[data-id="'+window.__first+'"] [data-k="approve"]').click()`);
    const first = await js('window.__first'); // its turn ends, as an answered agent's would, so its row leaves and the next one moves up
    await emit({ sessionId: first, type: 'status', status: 'working', intent: 'Working' }); await emit({ sessionId: first, type: 'output', final: true, text: 'Done.' }); await emit({ sessionId: first, type: 'status', status: 'idle' });
    assert.ok(await until(`!!window.__mv`, 5000), `${at}: the second row moved up into the first one's place`);
    const mv = await js(`JSON.stringify(window.__mv)`);
    const mvo = JSON.parse(mv);
    assert.strictEqual(mvo.armed, '0', `${at}: a row that moved under the pointer is guarded ${mv}`);
    assert.strictEqual(mvo.after.length, mvo.before.length, `${at}: a press at once answers nothing ${mv}`);
    const S2 = await js('window.__second');
    assert.ok(await armed(S2), `${at}: and is armed after the guard`);
    await js(`document.querySelector(${jsLiteral(row(S2) + ' [data-k="approve"]')}).click()`);
    assert.ok(await stripAnswered(3), `${at}: then it answers`);
    await clear();

    // ---- 5: a stale press answers nothing; the agent's next card is not used in its place ----
    await js(`window.__perm=[]`);
    const D = await ag(3);
    await perm(D, 'st1-' + tag, 'Run the stale one');
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000), `${at}: one request waits`);
    await open();
    assert.ok(await armed(D), `${at}: armed`);
    await js(`window.__stale=document.querySelector(${jsLiteral(row(D) + ' [data-k="approve"]')});window.__oldRq=document.querySelector(${jsLiteral(row(D))}).dataset.rq`);
    assert.strictEqual(await js(`window.__durbarSimUi.settleCard(${jsLiteral(D)})`), true, `${at}: the card is answered elsewhere`);
    await perm(D, 'st2-' + tag, 'Run the next one');
    assert.ok(await until(`(document.querySelector(${jsLiteral(row(D))})||{dataset:{}}).dataset.rq&&document.querySelector(${jsLiteral(row(D))}).dataset.rq!==window.__oldRq`, 6000), `${at}: the row is repainted for the next request`);
    await js(`window.__stale.click()`);
    await ctx.sleep(900);
    assert.deepStrictEqual(await perms(), [], `${at}: a stale press answers nothing, and not the next card: ${JSON.stringify(await perms())}`);
    assert.ok(await armed(D));
    await js(`document.querySelector(${jsLiteral(row(D) + ' [data-k="approve"]')}).click()`);
    assert.ok(await stripAnswered(1), `${at}: a live press answers its own card`);
    assert.deepStrictEqual(await perms(), ['st2-' + tag + ':true'], `${at}: and it is the next card, by its own id`);
    await clear();

    // ---- 9b: option buttons, answered by request id; a typed question keeps Answer in chat ----
    const E = await ag(4), F = await ag(5);
    await ask(E, 'qo1-' + tag, 'Which colour?', ['Green', 'Blue']);
    await ask(F, 'qt1-' + tag, 'What is your name?', []);
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two questions wait`);
    await open();
    assert.ok(await armed(E) && await armed(F), `${at}: armed`);
    const qb = await js(`JSON.stringify({opts:[...document.querySelectorAll(${jsLiteral(row(E) + ' .ib-ans button')})].map(b=>b.textContent),open:!!document.querySelector(${jsLiteral(row(E) + ' [data-k="open"]')}),chat:[...document.querySelectorAll(${jsLiteral(row(E) + ' button')})].some(b=>b.textContent==='Answer in chat'),
      typed:[...document.querySelectorAll(${jsLiteral(row(F) + ' button')})].map(b=>b.textContent),typedOpts:document.querySelectorAll(${jsLiteral(row(F) + ' [data-k="opt"]')}).length})`);
    const qbo = JSON.parse(qb);
    assert.deepStrictEqual(qbo.opts, ['Green', 'Blue'], `${at}: the question's options are buttons in the row ${qb}`);
    assert.ok(qbo.open && !qbo.chat, `${at}: with Open, and no Answer in chat ${qb}`);
    assert.deepStrictEqual(qbo.typed, ['Answer in chat'], `${at}: a typed question keeps Answer in chat ${qb}`);
    assert.strictEqual(qbo.typedOpts, 0, `${at}: and offers no option ${qb}`);
    await H.shot(path.join(OUT, `052-door-${tag}-options.png`), { prep: 'mouse', settle: false });
    await js(`[...document.querySelectorAll(${jsLiteral(row(E) + ' [data-k="opt"]')})].find(b=>b.textContent==='Blue').click()`);
    assert.ok(await until(`window.__qa.length===1`, 3000), `${at}: the option answers`);
    assert.deepStrictEqual(await js('window.__qa.slice()'), ['qo1-' + tag + ':{"Which colour?":"Blue"}'], `${at}: by its own request id, with its own label`);
    const doneB = JSON.stringify(await js('window.__done'));
    assert.ok(await until(`window.__done.some(t=>/Blue/.test(t))`, 3000), `${at}: the row says what was answered ${doneB}`);
    await clear();
    // stale: the question is answered elsewhere, the agent asks the next one; the old button answers nothing
    await js(`window.__qa=[]`);
    await ask(E, 'qs1-' + tag, 'Which size?', ['Small', 'Large']);
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000)); await open();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(E) + ' [data-k="opt"]')})`, 6000), `${at}: the new question's options appear`);
    assert.ok(await armed(E));
    await js(`window.__stale=document.querySelector(${jsLiteral(row(E) + ' [data-k="opt"]')});window.__oldRq=document.querySelector(${jsLiteral(row(E))}).dataset.rq`);
    await js(`window.__durbarSimUi.settleCard(${jsLiteral(E)})`);
    await ask(E, 'qs2-' + tag, 'Which shape?', ['Round', 'Square']);
    assert.ok(await until(`(document.querySelector(${jsLiteral(row(E))})||{dataset:{}}).dataset.rq&&document.querySelector(${jsLiteral(row(E))}).dataset.rq!==window.__oldRq`, 6000), `${at}: the row is repainted for the next question`);
    await js(`window.__stale.click()`);
    await ctx.sleep(900);
    const seen1 = JSON.stringify(await js('window.__qa.slice()'));
    assert.deepStrictEqual(await js('window.__qa.slice()'), [], `${at}: a stale option press answers nothing, not the next question: ${seen1}`);
    // own button: the card still lives but its options were replaced (a rebuilt card); the old option copied into the row answers nothing
    await js(`window.__qa=[]`);
    await open();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(E) + ' [data-k="opt"]')})`, 6000), `${at}: the options of the next question appear`);
    assert.ok(await armed(E));
    const optsSwapped = await js(`window.__durbarSimUi.swapCardOptions(${jsLiteral(E)})`);
    assert.ok(optsSwapped >= 2, `${at}: the live card's options were replaced (${optsSwapped})`);
    await js(`document.querySelector(${jsLiteral(row(E) + ' [data-k="opt"]')}).click()`);
    await ctx.sleep(900);
    const seenOwn = JSON.stringify(await js('window.__qa.slice()'));
    assert.deepStrictEqual(await js('window.__qa.slice()'), [], `${at}: an option press checks its own button: the card lives but no longer holds it, nothing is answered: ${seenOwn}`);
    await js(`window.__durbarSimUi.settleCard(${jsLiteral(E)})`); await clear();

    // ---- 7: a spending limit in a row: amount, three buttons, no letter key; and the long request ----
    await answerAll(); await js(`window.__perm=[];window.__lim=[];window.__done=[]`);
    const L = await ag(6), M = await ag(7);
    await emit({ type: 'limit', sessionId: L, phase: 'exhausted', requestId: 'lim-' + tag, maxAiCredits: 5, usedAiCredits: 5 });
    await perm(M, 'lg1-' + tag, 'Please run this very long request '.repeat(20));
    assert.ok(await until(`!!document.querySelector('#inboxBtn b')&&Number(document.querySelector('#inboxBtn b').textContent)>=2`, 6000), `${at}: both wait`);
    await shut(); await open();
    assert.ok(await armed(L) && await armed(M), `${at}: armed`);
    const lr = await js(`JSON.stringify({amt:!!document.querySelector(${jsLiteral(row(L) + ' .ib-amt')}),btns:[...document.querySelectorAll(${jsLiteral(row(L) + ' .ib-ans button')})].map(b=>b.textContent),keyed:document.querySelectorAll(${jsLiteral(row(L) + ' [aria-keyshortcuts]:not([data-k="open"])')}).length,
      open:!!document.querySelector(${jsLiteral(row(L) + ' [data-k="open"]')}),w:document.querySelector(${jsLiteral(row(L) + ' .ib-w')}).textContent})`);
    const lro = JSON.parse(lr);
    assert.ok(lro.amt, `${at}: the limit row shows the amount field ${lr}`);
    assert.deepStrictEqual(lro.btns, ['Raise limit', 'Remove limit', 'Stop here'], `${at}: and the card's three buttons under their own words ${lr}`);
    assert.strictEqual(lro.keyed, 0, `${at}: none of them names a letter key ${lr}`);
    assert.ok(lro.open && /spending limit/.test(lro.w), `${at}: Open, and the row says the limit ${lr}`);
    // no letter key spends money: A, S and D (and a held one) with focus on the row
    await js(`document.querySelector(${jsLiteral(row(L) + ' .ib-h')}).focus()`);
    for (const k of ['a', 's', 'd']) await key(k, [], { char: 'always' });
    await ctx.sleep(500);
    const seen2 = JSON.stringify(await js('window.__lim.slice()'));
    assert.deepStrictEqual(await js('window.__lim.slice()'), [], `${at}: no letter key spends money: ${seen2}`);
    await H.shot(path.join(OUT, `052-door-${tag}-limit-long.png`), { prep: 'mouse', settle: false });
    // the long request: Open only
    const lg = await js(`JSON.stringify({btns:[...document.querySelectorAll(${jsLiteral(row(M) + ' button')})].map(b=>b.dataset.k),note:(document.querySelector(${jsLiteral(row(M) + ' .ib-note')})||{}).textContent,tLen:document.querySelector(${jsLiteral(row(M) + ' .ib-t')}).textContent.length})`);
    const lgo = JSON.parse(lg);
    assert.deepStrictEqual(lgo.btns, ['open'], `${at}: a long request offers Open only ${lg}`);
    assert.strictEqual(lgo.note, 'Too long to answer here. Read it in the chat.', `${at}: and says why ${lg}`);
    assert.ok(lgo.tLen <= 200, `${at}: the row reads only its start ${lg}`);
    await js(`document.querySelector(${jsLiteral(row(M) + ' .ib-h')}).focus()`);
    for (const k of ['a', 's', 'd']) await key(k, [], { char: 'always' });
    await ctx.sleep(300);
    assert.deepStrictEqual(await perms(), [], `${at}: no letter key answers a long request`);
    // Raise limit, pressed, sends its amount and says its own word
    await js(`[...document.querySelectorAll(${jsLiteral(row(L) + ' button')})].find(b=>b.textContent==='Raise limit').click()`);
    assert.ok(await until(`window.__lim.length===1`, 3000), `${at}: Raise limit, pressed, sends`);
    const seen3 = JSON.stringify(await js('window.__done'));
    assert.ok(await until(`window.__done.some(t=>/Raise limit/.test(t))`, 3000), `${at}: the word is the button's own ${seen3}`);
    assert.ok(!(await js('window.__done')).some((t) => /Allowed/.test(t)), `${at}: and never Allowed`);
    await shut();

    // ---- 6c: the word is the card's real outcome: a question the bridge refused stays unsettled, so the row says "Could not answer", with Open ----
    await answerAll();
    const N = await ag(0);
    await ask(N, 'ns1-' + tag, 'Which one fails?', ['One', 'Two']);
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>=1`, 6000));
    await open();
    assert.ok(await armed(N), `${at}: armed`);
    await js(`window.__nosettle=true;window.__done=[]`);
    await js(`document.querySelector(${jsLiteral(row(N) + ' [data-k="opt"]')}).click()`);
    await ctx.sleep(1000);
    assert.ok(!(await js('window.__done')).some((t) => /One/.test(t)), `${at}: while the card has not settled the row does not say what was answered`);
    const seen4 = JSON.stringify(await js('window.__done'));
    assert.ok(await until(`window.__done.includes('Could not answer')`, 5000), `${at}: it says Could not answer ${seen4}`);
    assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(row(N) + ' [data-k="open"]')})`), true, `${at}: with Open`);
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(N) + ' [data-k="opt"]')})`, 6000), `${at}: and then offers its options again`);
    await js(`window.__nosettle=false`);
    await clear();

    // ---- 6d (FR-033): the retry repaint after "Could not answer" must not leave the answer keys live on a row nobody read ----
    const N2 = await ag(0), M2 = await ag(1);
    await ask(N2, 'nr1-' + tag, 'Which one fails again?', ['One', 'Two']);
    await ctx.sleep(150);
    await perm(M2, 'nr2-' + tag, 'Run the one behind');
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two wait`);
    await open();
    assert.ok(await armed(N2), `${at}: armed`);
    await js(`window.__nosettle=true;window.__done=[];window.__perm=[]`);
    await js(`document.querySelector(${jsLiteral(row(N2) + ' [data-k="opt"]')}).click()`);
    assert.ok(await until(`window.__done.includes('Could not answer')`, 5000), `${at}: it says Could not answer`);
    await js(`window.__nosettle=false`);
    await emit({ sessionId: N2, type: 'status', status: 'working', intent: 'Working' }); await emit({ sessionId: N2, type: 'output', final: true, text: 'Done.' }); await emit({ sessionId: N2, type: 'status', status: 'idle' }); // its question goes away while the row shows the words
    assert.ok(await until(`!document.querySelector(${jsLiteral(row(N2))})`, 8000), `${at}: the failed row left`);
    const ae6 = await js(`(()=>{const a=document.activeElement,r=a&&a.closest&&a.closest('.inbox-row');return {tag:a?a.tagName:'',head:!!a&&a.classList.contains('ib-h'),row:r?r.dataset.id:''}})()`);
    assert.ok(ae6.tag !== 'BUTTON', `${at}: focus is never on a button after the retry repaint ${JSON.stringify(ae6)}`);
    if (ae6.row) {
      assert.strictEqual(ae6.row, M2, `${at}: on the next row's heading`);
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true}))`);
      await ctx.sleep(400);
      assert.deepStrictEqual(await perms(), [], `${at}: A right after the retry repaint answers nothing (nobody read that request)`);
      // 6e: the hold survives the next repaint (the carry-over rule): a new request arrives, the panel repaints again, the person has still not moved
      const P2 = await ag(2);
      await perm(P2, 'nr3-' + tag, 'Run the newest');
      assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2`, 6000), `${at}: a third row, a second repaint`);
      assert.strictEqual((await js(`(()=>{const a=document.activeElement,r=a&&a.closest&&a.closest('.inbox-row');return a&&a.tagName!=='BUTTON'&&r?r.dataset.id:''})()`)), M2, `${at}: focus is still on the same heading, not a button`);
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true}))`);
      await ctx.sleep(400);
      assert.deepStrictEqual(await perms(), [], `${at}: A after the retry repaint and then another repaint answers nothing (6e)`);
      // a deliberate move clears the hold: the person moves (J, K) and A answers the row they are on
      await js(`(()=>{const r=document.querySelector(${jsLiteral(row(M2))});r.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true}));})()`);
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'k',bubbles:true,cancelable:true}))`);
      assert.ok(await until(`(document.activeElement.closest('.inbox-row')||{dataset:{}}).dataset.id===${jsLiteral(M2)}`, 2000), `${at}: back on the row after J, K`);
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true}))`);
      assert.ok(await until(`window.__perm.length===1`, 3000), `${at}: after a deliberate move A answers the row the person is on`);
    }
    await clear();

    // ---- 6f (FR-033): focus on the second option of a question row; another row leaves: focus stays on that same option, not the first ----
    const Q3 = await ag(3), Y3 = await ag(4);
    await ask(Q3, 'op1-' + tag, 'Which of three?', ['One', 'Two', 'Three']);
    await ctx.sleep(150);
    await perm(Y3, 'op2-' + tag, 'Run the other');
    assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two wait`);
    await open();
    assert.ok(await armed(Q3), `${at}: armed`);
    await js(`(()=>{const o=[...document.querySelectorAll(${jsLiteral(row(Q3) + ' [data-k="opt"]')})].find(x=>x.textContent==='Two');o.focus();})()`);
    await emit({ sessionId: Y3, type: 'status', status: 'working', intent: 'Working' }); await emit({ sessionId: Y3, type: 'output', final: true, text: 'Done.' }); await emit({ sessionId: Y3, type: 'status', status: 'idle' });
    assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1`, 8000), `${at}: the other row left`);
    assert.strictEqual(await js(`(document.activeElement||{}).textContent`), 'Two', `${at}: focus is still on the option the person was on (6f)`);
    await clear();
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const view of ['flat', 'real']) {
      const at = `${w}x${h} ${view}`;
      const tag = `${w}x${h}-${view}`;
      // a page that watches every panel that is added, and every answer that reaches the bridge
      const load = async (door) => {
        await H.load({ w, h, query: Object.assign(view === 'real' ? { officeview: 'real' } : {}, door ? { door: '1' } : {}), ready: READY[view], settle: false, focus: true });
        await js(`(()=>{window.__adds=0;window.__perm=[];window.__ann=[];window.__done=[];new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){const d=n.nodeType===1&&(n.matches('.ib-done')?n:n.querySelector('.ib-done'));if(d)window.__done.push(d.textContent);}}).observe(document.body,{childList:true,subtree:true});new MutationObserver(ms=>{for(const m of ms){for(const n of m.addedNodes)if(n.id==='needsPanel'){window.__adds++;window.__addAt=Date.now();}for(const n of m.removedNodes)if(n.id==='needsPanel')window.__rmAt=Date.now();}}).observe(document.body,{childList:true});
          const b=window.__durbarSimUi.bridge();if(!b.__w2){const p=b.resolvePermission;b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};b.__w2=1;}
          if(!b.__w3){window.__lim=[];window.__qa=[];b.resolveLimit=function(id,rid,c){window.__lim.push(JSON.stringify(c));return Promise.resolve({ok:true})};
            b.answerQuestion=function(id,rid,ans){window.__qa.push(rid+':'+JSON.stringify(ans));return Promise.resolve(window.__nosettle?{ok:false,error:'not now'}:{ok:true})}; /* the simulator's main side does not know a question the page was only told about, so the bridge says yes: only the page's use of it is under test */
            b.__w3=1;}
          const sr=document.getElementById('srAnnounce');if(sr&&!window.__annObs){window.__annObs=1;new MutationObserver(()=>window.__ann.push(sr.textContent)).observe(sr,{childList:true,characterData:true,subtree:true});}})()`);
      };

      // ---- the flag is off: the modal inbox, no panel, whatever waits ----
      if (w === 1440) {
        await load(false);
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>0`, 15000), `${at}: something waits in the simulator`);
        await ctx.sleep(3600); // past the arming (3 s after the agent list)
        assert.strictEqual(await panelOpen(), false, `${at}: with the flag off nothing opens by itself`);
        await js(`document.getElementById('inboxBtn').click()`);
        assert.ok(await until(`!!document.getElementById('inboxDlg')`, 4000), `${at}: with the flag off the amber button still opens the modal inbox`);
        assert.strictEqual(await panelOpen(), false, `${at}: and no panel`);
        await js(`document.getElementById('inboxClose').click()`);
      }

      // ---- 9a: app start (Q-NY-3) ----
      await load(true);
      const quietIds = JSON.parse(await js(`JSON.stringify(window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&a.state!=='waiting'&&a.state!=='error'&&a.state!=='needs-permission'&&!a.limit).map(a=>a.id))`)); // agents with no request of their own, for the steps at the end
      assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)>0`, 15000), `${at}: something waits in the simulator`);
      await js(`window.__ae0=document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 12000), `${at}: with requests waiting at arming the panel opens with the list`);
      const t0 = Date.now(); // the gate's throttle runs from this opening
      assert.ok(await until(`!document.getElementById('needsPanel').getAnimations().length`, 3000), `${at}: the slide ends`);
      const n0 = await count();
      const st = await js(`(()=>{const p=document.getElementById('needsPanel'),r=p.getBoundingClientRect(),cs=getComputedStyle(p);return {role:p.getAttribute('role'),name:p.getAttribute('aria-labelledby'),h:(document.getElementById(p.getAttribute('aria-labelledby'))||{}).textContent,modal:!!document.querySelector('[aria-modal="true"]'),
        rows:p.querySelectorAll('.inbox-row').length,later:!document.getElementById('doorLater').hidden,line:(document.getElementById('doorLine')||{}).textContent,faces:p.querySelectorAll('.door-face').length,
        pos:cs.position,backdrop:!!document.querySelector('.dlg-ov'),ae:document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName,inPanel:p.contains(document.activeElement),
        r:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)],iw:innerWidth,ih:innerHeight,scrollY:document.scrollingElement.scrollTop,docH:document.documentElement.scrollHeight}})()`);
      assert.strictEqual(st.role, 'region', `${at}: a region ${JSON.stringify(st)}`);
      assert.strictEqual(st.h, 'Needs you', `${at}: labelled by its heading "Needs you" ${JSON.stringify(st)}`);
      assert.strictEqual(st.modal, false, `${at}: not modal: no aria-modal anywhere ${JSON.stringify(st)}`);
      assert.strictEqual(st.backdrop, false, `${at}: no backdrop ${JSON.stringify(st)}`);
      assert.strictEqual(st.pos, 'fixed', `${at}: it lies over the room and takes no layout space ${JSON.stringify(st)}`);
      assert.strictEqual(st.rows, n0, `${at}: one row per agent that needs you (the amber count ${n0}) ${JSON.stringify(st)}`);
      assert.ok(st.later, `${at}: the app-start opening has a Later button ${JSON.stringify(st)}`);
      assert.strictEqual(st.line, `${n0} outside your door, oldest first`, `${at}: the line under the heading ${JSON.stringify(st)}`);
      assert.ok(st.faces >= 1 && st.faces <= 8, `${at}: a line of faces ${JSON.stringify(st)}`);
      assert.strictEqual(st.inPanel, false, `${at}: opening by itself leaves focus out of the panel (FR-192) ${JSON.stringify(st)}`);
      assert.strictEqual(st.ae, await js('window.__ae0'), `${at}: focus did not move ${JSON.stringify(st)}`);
      assert.ok(st.r[2] <= st.iw && st.r[3] <= st.ih && st.r[0] >= 0 && st.r[1] > 0, `${at}: inside the window, below the top bar ${JSON.stringify(st)}`);
      assert.ok(st.docH <= st.ih + 1 && st.scrollY === 0, `${at}: no page scroll ${JSON.stringify(st)}`);
      const size = await js(`(()=>{const p=document.getElementById('needsPanel');let min=99;for(const e of p.querySelectorAll('*')){if(!e.childNodes.length)continue;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own||!e.getClientRects().length)continue;min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));}return min;})()`);
      assert.ok(size >= 10.5, `${at}: text at least 10.5 px, smallest ${size}`);
      const clipped = await js(`(()=>{const p=document.getElementById('needsPanel'),pr=p.getBoundingClientRect();return [...p.querySelectorAll('.inbox-row .btn,.door-head .btn')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&(r.left<pr.left-1||r.right>pr.right+1)}).length;})()`);
      assert.strictEqual(clipped, 0, `${at}: no button sticks out of the panel`);
      // Q-NY-15: in Real office the slips at the Boss door stay visible while the panel is open
      if (view === 'real') {
        const slips = await js(`[...document.querySelectorAll('#stage .ro-slip')].filter(s=>{const r=s.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(s).visibility!=='hidden'&&getComputedStyle(s).display!=='none'}).length`);
        assert.ok(slips >= 1, `${at}: the Boss door slips are still visible with the panel open (Q-NY-15): ${slips}`);
      }
      await H.shot(path.join(OUT, `052-door-${tag}-startup.png`), { prep: 'mouse', settle: false });
      // Later closes it, moves no focus, and the asks stay on the amber count
      await js(`document.getElementById('doorLater').click()`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: Later closes the panel`);
      assert.strictEqual(await count(), n0, `${at}: the amber count keeps the asks`);
      assert.strictEqual(await js(`document.activeElement===document.body?'body':document.activeElement.id||document.activeElement.tagName`), await js('window.__ae0'), `${at}: Later moved no focus`);

      // ---- 2: no shift ----
      const closed = await deskRects();
      await js(`document.getElementById('inboxBtn').click()`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000), `${at}: the amber button opens the panel`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').getAttribute('aria-expanded')`), 'true', `${at}: the amber button says it is expanded`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').getAttribute('aria-controls')`), 'needsPanel', `${at}: and what it controls`);
      await ctx.sleep(300);
      assert.strictEqual(await deskRects(), closed, `${at}: no desk moved with the panel open`);
      assert.strictEqual(await js(`document.getElementById('inboxBtn').click(),0`), 0);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: the amber button is a toggle`);
      assert.strictEqual(await deskRects(), closed, `${at}: no desk moved with the panel closed again`);

      if (view === 'real') { await door2(at, tag, w, view, load); continue; } // the rest runs in Flat; Real office has the same code, its slips and faces were checked above

      // ---- 8: focus ----
      await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
      await key('i', [], { char: 'always' });
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000), `${at}: I opens the panel`);
      assert.ok(await until(`document.activeElement&&document.activeElement.classList.contains('ib-h')&&document.getElementById('needsPanel').contains(document.activeElement)`, 3000), `${at}: I puts focus on a row's heading, never a button`);
      await key('Escape', [], { char: 'never' });
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: Esc with focus inside closes it`);
      assert.ok(await until(`document.activeElement===document.getElementById('inboxBtn')`, 3000), `${at}: focus goes back (to the amber button when nothing had it)`);
      await js(`(()=>{const i=document.createElement('input');i.id='drvTxt';i.style.cssText='position:fixed;left:12px;bottom:12px;z-index:50;width:200px';document.body.appendChild(i);i.value='hello';i.focus();i.setSelectionRange(1,3);})()`);
      await key('A', ['control', 'shift'], { char: 'never' });
      assert.ok(await until(`!!document.getElementById('needsPanel')&&document.activeElement.classList.contains('ib-h')`, 3000), `${at}: Ctrl+Shift+A opens it from a text field, focus on a heading`);
      await key('Escape', [], { char: 'never' });
      assert.ok(await until(`!document.getElementById('needsPanel')&&document.activeElement===document.getElementById('drvTxt')`, 3000), `${at}: Esc returns focus to the text field it came from`);
      // Esc from a text field never closes the panel
      await js(`document.getElementById('inboxBtn').click()`);
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 3000));
      await js(`document.getElementById('drvTxt').focus()`);
      await key('Escape', [], { char: 'never' });
      await ctx.sleep(200);
      assert.strictEqual(await panelOpen(), true, `${at}: Esc in a text field closes nothing`);
      await js(`document.getElementById('inboxBtn').click()`);
      await until(`!document.getElementById('needsPanel')`, 3000);

      // ---- 3, 1: new, and typing (nothing waits; then one request arrives) ----
      await answerAll();
      assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 8000), `${at}: nothing waits now`);
      // repaints, a resize and a drag of the window do not open it
      await H.js(`window.dispatchEvent(new Event('resize'))`);
      ctx.win.setContentSize(w - 20, h); await ctx.sleep(300); ctx.win.setContentSize(w, h); await ctx.sleep(300);
      assert.strictEqual(await panelOpen(), false, `${at}: a resize opens nothing`);
      const quiet = Math.max(0, 10800 - (Date.now() - t0)); // past the throttle of the app-start opening
      await ctx.sleep(quiet);
      await js(`(()=>{const i=document.getElementById('drvTxt');i.focus();i.setSelectionRange(1,3);window.__perm=[];window.__adds=0;})()`);
      const A = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[3].id`);
      const B = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[4].id`);
      await emit({ type: 'status', sessionId: A, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np1-' + w, kind: 'shell', summary: 'Run the first', state: 'pending' } });
      assert.ok(await until(`!!document.getElementById('needsPanel')`, 6000), `${at}: a new request opens the panel`);
      assert.strictEqual(await js(`document.getElementById('doorLater').hidden`), true, `${at}: Later is only for the app-start opening`);
      // keys typed after the opening go where they were going, and answer nothing
      if (!(await js(`document.hasFocus()`))) await H.focusPage({ ms: 1500 }); // only when it is lost: key delivery needs the window's focus
      assert.ok(await until(`document.hasFocus()&&document.activeElement===document.getElementById('drvTxt')&&document.getElementById('drvTxt').selectionStart===1&&document.getElementById('drvTxt').selectionEnd===3`, 4000), `${at}: the text field has focus and its selection before the keys`);
      for (const c of ['a', 's', 'd', 'o']) await key(c, [], { char: 'always' });
      const typed = await js(`(()=>{const i=document.getElementById('drvTxt');return {v:i.value,a:i.selectionStart,b:i.selectionEnd,ae:document.activeElement===i,perm:window.__perm.slice(),panelAe:document.getElementById('needsPanel').contains(document.activeElement)}})()`);
      assert.strictEqual(typed.ae, true, `${at}: focus stayed in the text field ${JSON.stringify(typed)}`);
      assert.deepStrictEqual(typed.perm, [], `${at}: no letter answered anything ${JSON.stringify(typed)}`);
      assert.strictEqual(typed.v, 'hasdolo', `${at}: the four letters replaced the selection in the field and went nowhere else ${JSON.stringify(typed)}`);
      // a burst joins the open list: one panel, no second slide
      await emit({ type: 'status', sessionId: B, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np2-' + w, kind: 'shell', summary: 'Run the second', state: 'pending' } });
      assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2`, 6000), `${at}: the second request joins the open list`);
      assert.strictEqual(await js('window.__adds'), 1, `${at}: one opening for both`);
      await H.shot(path.join(OUT, `052-door-${tag}-two-waiting.png`), { prep: 'mouse', settle: false });
      // dismissed: the ones already seen never reopen it; a new one does, once
      await js(`document.getElementById('inboxClose').click()`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 3000));
      ctx.win.setContentSize(w - 20, h); await ctx.sleep(300); ctx.win.setContentSize(w, h);
      await js(`window.dispatchEvent(new Event('focus'))`);
      await ctx.sleep(800);
      assert.strictEqual(await panelOpen(), false, `${at}: after dismissal the requests already seen never reopen it`);
      await ctx.sleep(Math.max(0, 10800 - 1500));
      const C = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[5].id`);
      await emit({ type: 'status', sessionId: C, status: 'needs-permission', intent: 'Waiting', permission: { requestId: 'np3-' + w, kind: 'shell', summary: 'Run the third', state: 'pending' } });
      assert.ok(await until(`!!document.getElementById('needsPanel')&&document.querySelectorAll('#needsPanel .inbox-row').length===3`, 6000), `${at}: a new request reopens it with all three`);
      // opened by itself and emptied (Q-NY-13): All clear, then it goes, focus untouched
      await js(`document.getElementById('drvTxt').focus()`);
      await answerAll();
      assert.ok(await until(`/All clear/.test((document.getElementById('needsPanel')||{textContent:''}).textContent)`, 6000), `${at}: emptied, it says All clear`);
      assert.ok(await until(`!document.getElementById('needsPanel')`, 5000), `${at}: and slides away by itself`);
      assert.strictEqual(await js(`document.activeElement===document.getElementById('drvTxt')`), true, `${at}: an automatic close leaves focus alone`);
      await js(`document.getElementById('drvTxt').remove()`);

      // ---- the new steps below open the panel on purpose (the amber button); the gate is not involved except in the last two ----
      const ensureOpen = async () => { if (!(await panelOpen())) await js(`document.getElementById('inboxBtn').click()`); assert.ok(await until(`!!document.getElementById('needsPanel')`, 4000), `${at}: the panel is open`); };
      // the gate's own state, seen from the page: the last time a panel was added (its throttle runs from an automatic opening) and removed (COALESCE_MS runs from a dismissal)
      const gateRests = async () => { await ctx.sleep(await js(`Math.max(0,10800-(Date.now()-(window.__addAt||0)))`)); await ctx.sleep(await js(`Math.max(0,2200-(Date.now()-(window.__rmAt||0)))`)); };
      const pend = [[A, 'np1-' + w], [B, 'np2-' + w], [C, 'np3-' + w]]; // cards the steps above left in their chats
      const perm = (id, rid, summary) => (pend.push([id, rid]), emit({ type: 'status', sessionId: id, status: 'needs-permission', intent: 'Waiting', permission: { requestId: rid, kind: 'shell', summary, state: 'pending' } }));
      assert.ok(quietIds.length >= 3, `${at}: three agents with no request of their own ${JSON.stringify(quietIds)}`);
      const live = async (i) => quietIds[i];
      const idle = async (id) => { await emit({ sessionId: id, type: 'status', status: 'working', intent: 'Working' }); await emit({ sessionId: id, type: 'output', final: true, text: 'Done.' }); await emit({ sessionId: id, type: 'status', status: 'idle' }); };
      const aeInfo = () => js(`(()=>{const a=document.activeElement,r=a&&a.closest&&a.closest('.inbox-row');return {tag:a?a.tagName:'',head:!!a&&a.classList.contains('ib-h'),row:r?r.dataset.id:'',k:a&&a.dataset?a.dataset.k||'':''}})()`);
      const clean = async () => { await answerAll(); while (pend.length) { const [id, rid] = pend.pop(); await emit({ type: 'permission', sessionId: id, permission: { requestId: rid, state: 'denied', via: 'stopped' } }); } assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===0`, 8000), `${at}: nothing waits again`); await js(`(document.getElementById('inboxClose')||{click(){}}).click()`); await until(`!document.getElementById('needsPanel')`, 4000); await js(`window.__perm=[];window.__ann=[]`); };
      await clean();

      // ---- FR-033: a repaint never leaves focus on another agent's button, and A answers nothing nobody read (review of #1273, finding 1) ----
      {
        const [X, Y, Z] = [await live(0), await live(1), await live(2)];
        await perm(X, 'fa1-' + w, 'Run the first'); await ctx.sleep(120); await perm(Y, 'fa2-' + w, 'Run the second'); await ctx.sleep(120); await perm(Z, 'fa3-' + w, 'Run the third');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===3`, 6000), `${at}: three wait`);
        await ensureOpen();
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===3`, 4000), `${at}: three rows`);
        await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        assert.strictEqual((await aeInfo()).k, 'approve', `${at}: focus is on the first agent's Allow button`);
        await idle(X); // its request goes away by itself
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2&&!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]')`, 6000), `${at}: the first row left`);
        const f = await aeInfo();
        assert.ok(f.head && f.tag !== 'BUTTON', `${at}: after the row left, focus is on a heading, never a button (FR-033) ${JSON.stringify(f)}`);
        assert.strictEqual(f.row, Y, `${at}: on the next row's heading ${JSON.stringify(f)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A right after a repaint answers nothing (nobody read that request)`);
        await key('j', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')&&document.activeElement.closest('.inbox-row').dataset.id!==${jsLiteral(Y)}`, 3000), `${at}: J moved to the next row ${JSON.stringify(await aeInfo())}`);
        await key('k', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')&&document.activeElement.closest('.inbox-row').dataset.id===${jsLiteral(Y)}`, 3000), `${at}: the person moved (J, K) and is back on the row ${JSON.stringify(await aeInfo())}`);
        await key('a', [], { char: 'always' });
        assert.ok(await until(`window.__perm.length===1`, 3000), `${at}: after the person moves, A answers the row they are on`);
        assert.deepStrictEqual(await js('window.__perm.slice()'), ['fa2-' + w + ':true'], `${at}: and it is that row's own request`);
        await ctx.sleep(300);
        assert.strictEqual(await js(`!document.body.classList.contains('panel-open')&&!!document.getElementById('needsPanel')`), true, `${at}: answering in the panel opens no chat and the panel stays (a row's buttons are not a click on its desk)`);
        await clean();
      }

            // ---- FR-033, repainted twice in a row: the answer keys keep waiting until the person moves (review of #1273, round 2, finding 1) ----
      {
        const [X, Y, Z] = [await live(0), await live(1), await live(2)];
        await perm(X, 'tr1-' + w, 'Run the first'); await ctx.sleep(120); await perm(Y, 'tr2-' + w, 'Run the second'); await ctx.sleep(120); await perm(Z, 'tr3-' + w, 'Run the third');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===3`, 6000), `${at}: three wait`);
        await ensureOpen();
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===3`, 4000), `${at}: three rows`);
        await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        await idle(X);
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2&&document.activeElement.classList.contains('ib-h')`, 6000), `${at}: first repaint: focus on a heading`);
        await idle(Z); // a second repaint, the person has not moved
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1`, 6000), `${at}: the third row left`);
        const g = await aeInfo();
        assert.ok(g.head && g.row === Y, `${at}: after the second repaint focus is still on the remaining row's heading ${JSON.stringify(g)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A after two repaints in a row still answers nothing (the person never moved)`);
        await clean();
      }

      // ---- FR-033: the next card of the same agent rises into the same row while focus is on its Allow ----
      {
        const X = await live(0);
        await perm(X, 'rs1-' + w, 'Run the first'); await ctx.sleep(120); await perm(X, 'rs2-' + w, 'Run the second');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000), `${at}: one agent waits`);
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]')`, 4000));
        await js(`window.__perm=[];window.__rq1=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]').dataset.rq;document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
        // answered elsewhere: the very same call that delivers the event reads the row, so only a look made by the settle itself can have changed it (no later render is waited for)
        const sync = await js(`(()=>{window.__durbarSimUi.emit(${jsLiteral({ timestamp: Date.now(), type: 'permission', sessionId: X, permission: { requestId: 'rs1-' + w, state: 'denied', via: 'user' } })});return document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]').dataset.rq!==window.__rq1;})()`);
        assert.strictEqual(sync, true, `${at}: a request settled elsewhere makes the panel look again at once (the row holds the agent's next request before any other render)`);
        assert.ok(await until(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}]').dataset.rq!==window.__rq1`, 1200), `${at}: a request settled elsewhere with no other change in the office: the row looks again within 1.2 s and holds the agent's next request`);
        const f = await aeInfo();
        assert.ok(f.head && f.tag !== 'BUTTON', `${at}: a request replaced in the same row puts focus on the heading, not on its Allow (FR-033) ${JSON.stringify(f)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A answers nothing for a request that rose under the person's focus`);
        await clean();
      }

      // ---- FR-033: a deliberate move of the person ends the wait: I back to the panel, a click, coming back from the office (review of #1273, round 3) ----
      {
        const X = await live(0), Y = await live(1);
        let n = 0;
        const arm = async () => { // X and Y wait; focus on X's Allow; X goes idle: a repaint puts focus on Y's heading and the answer keys wait
          n++;
          await perm(X, `dm${n}x-` + w, 'Run the first'); await ctx.sleep(120); await perm(Y, `dm${n}y-` + w, 'Run the second');
          assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: two wait (${n})`);
          await ensureOpen();
          assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===2`, 4000), `${at}: two rows (${n})`);
          await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="approve"]').focus()`);
          await idle(X);
          assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1&&document.activeElement.classList.contains('ib-h')`, 6000), `${at}: the repaint put focus on a heading (${n}) ${JSON.stringify(await aeInfo())}`);
          await key('a', [], { char: 'always' }); await ctx.sleep(300);
          assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: the answer keys wait after the repaint (${n})`);
        };
        const answered = async (what) => {
          await key('a', [], { char: 'always' });
          const got = await until(`window.__perm.length===1`, 3000);
          const seen = JSON.stringify(await js('window.__perm.slice()'));
          assert.ok(got, at + ': ' + what + ' ' + seen);
          assert.deepStrictEqual(await js('window.__perm.slice()'), [`dm${n}y-` + w + ':true'], `${at}: and it is that row's own request (${n})`);
          await ctx.sleep(1000);
        };
        // I from the office: focus left the panel to nowhere, I brings it back to the same heading
        await arm();
        await js(`document.activeElement.blur()`);
        await key('i', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-h')`, 3000), `${at}: I puts focus on a heading ${JSON.stringify(await aeInfo())}`);
        await answered('after I, A answers the row the person asked for');
        await clean();
        // coming back from a desk: focus moved to the office and back to the same heading
        await arm();
        await js(`window.__hd=document.activeElement;document.querySelector('#stage .desk[data-id]').focus()`);
        await js(`window.__hd.focus()`);
        await answered('after leaving to a desk and coming back, A answers');
        await clean();
        // a click on the heading that already has focus
        await arm();
        await js(`document.activeElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
        await answered('after a click on the heading, A answers');
        await clean();
      }

      // ---- FR-206 and FR-208 in the panel (review finding 2) ----
      {
        const W = await live(0);
        await perm(W, 'st1-' + w, 'Run the stale one');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000));
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] [data-k="approve"]')`, 4000), `${at}: the row offers Allow`);
        await js(`window.__perm=[];window.__ann=[];window.__rq1=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}]').dataset.rq;window.__stale=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] [data-k="approve"]')`);
        assert.ok(await until(`(document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}]')||{dataset:{}}).dataset.armed==='1'`, 3000), `${at}: the row is past its rise guard (FR-198), so the press below is a stale one and not a guarded one`);
        await emit({ type: 'permission', sessionId: W, permission: { requestId: 'st1-' + w, state: 'denied', via: 'user' } }); // answered elsewhere
        await perm(W, 'st2-' + w, 'Run the second one');
        assert.ok(await until(`(document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}]')||{dataset:{}}).dataset.rq!==window.__rq1`, 6000), `${at}: the row now holds the second request`);
        await js(`window.__stale.click()`);
        assert.ok(await until(`window.__ann.some(t=>/^Already answered/.test(t))||window.__perm.length>0`, 3000), `${at}: the stale press ends`);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: a stale button in the panel sends nothing (its request was answered, the card now holds another)`);
        assert.ok(await js(`window.__ann.some(t=>/^Already answered/.test(t))`), `${at}: and it is announced`);
        // a held key answers nothing
        await js(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(W)}] .ib-h').focus()`);
        for (const k of ['a', 's', 'd', 'Enter']) await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(k)},repeat:true,bubbles:true,cancelable:true}))`);
        await ctx.sleep(300);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: a held A, S, D or Enter in the panel answers nothing`);
        await clean();
      }

      // ---- FR-199: Open steps the panel aside, Back to the office returns it (review finding 6) ----
      {
        const X = await live(0);
        await perm(X, 'sa1-' + w, 'Run it');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===1`, 6000));
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="open"]')`, 4000));
        await js(`document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(X)}] [data-k="open"]').click()`);
        assert.ok(await until(`document.body.classList.contains('panel-open')&&!document.getElementById('needsPanel')`, 4000), `${at}: Open shows the chat and the panel steps aside`);
        assert.deepStrictEqual(await js(`[document.getElementById('inboxBtn').getAttribute('aria-controls'),document.getElementById('inboxBtn').getAttribute('aria-expanded')]`), [null, 'false'], `${at}: with no panel on screen the amber button controls nothing (no aria-controls to a missing element)`);
        await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
        await key('Escape', [], { char: 'never' });
        assert.ok(await until(`!document.body.classList.contains('panel-open')&&!!document.getElementById('needsPanel')`, 4000), `${at}: Back to the office returns the panel`);
        assert.deepStrictEqual(await js(`(()=>{document.getElementById('inboxClose').click();const b=document.getElementById('inboxBtn');return [b.getAttribute('aria-controls'),b.getAttribute('aria-expanded')]})()`), [null, 'false'], `${at}: the moment the panel closes the amber button controls nothing (aria-controls is removed with the panel)`); // dismissed: the next trip to a chat does not bring it back
        assert.ok(await until(`!document.getElementById('needsPanel')`, 3000));
        await clean();
      }

      // ---- FR-202, FR-203: it never opens over the key the person is on (review finding 4) ----
      {
        await gateRests(); // past the throttle of the last opening and COALESCE_MS of the last close, as the page saw them
        await js(`(()=>{const i=document.createElement('input');i.id='drvUnder';i.style.cssText='position:fixed;right:24px;top:140px;width:160px;z-index:50';document.body.appendChild(i);i.focus();})()`);
        const E1 = await live(0);
        await perm(E1, 'ov1-' + w, 'Run under the panel');
        await ctx.sleep(1800);
        assert.strictEqual(await panelOpen(), false, `${at}: with focus under where the panel goes, a new request does not open it (FR-203)`);
        await js(`document.getElementById('drvUnder').remove()`);
        await idle(await live(1)); // any later change in the office gives the held opening its next look
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 8000), `${at}: once focus is elsewhere the held opening happens`);
        await clean();

        // ---- the gate's dismissal rule, wired (review finding 3): a request within COALESCE_MS of Close does not snap the panel back ----
        await gateRests();
        const D1 = await live(1), D2 = await live(2);
        await ensureOpen();
        await js(`document.getElementById('inboxClose').click()`); // dismissed by the person
        await perm(D1, 'di1-' + w, 'Run right after Close');
        await ctx.sleep(1200);
        assert.strictEqual(await panelOpen(), false, `${at}: a new request within COALESCE_MS of a dismissal does not snap it back`);
        await gateRests(); await ctx.sleep(1500); // past COALESCE_MS and THROTTLE_MS, no new request: the one dropped at the dismissal does not come back
        await idle(await live(2)); await ctx.sleep(900); // any later change in the office is a look: a kept ask would open it now
        assert.strictEqual(await panelOpen(), false, `${at}: a request dropped within COALESCE_MS of a dismissal does not reopen the panel later, past both windows`);
        await ctx.sleep(1500); // past COALESCE_MS
        await perm(D2, 'di2-' + w, 'Run a while after Close');
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 6000), `${at}: after the coalescing window a new request reopens it`);
        await clean();
      }

      // ---- FR-194, FR-202: a throttled opening is kept and opens by itself when the throttle ends; if its ask was answered elsewhere it opens nothing (round 6) ----
      {
        const R1 = await live(0), R2 = await live(1);
        const openAndClose = async (tag) => { // an automatic opening starts the throttle; Close ends it; then COALESCE_MS passes
          await gateRests();
          await perm(R1, `th${tag}a-` + w, 'Run to open it');
          assert.ok(await until(`!!document.getElementById('needsPanel')`, 6000), `${at}: a new ask opens it (${tag})`);
          await js(`document.getElementById('inboxClose').click()`);
          assert.ok(await until(`!document.getElementById('needsPanel')`, 3000), `${at}: closed (${tag})`);
          await ctx.sleep(2400);
        };
        const untilThrottleEnds = async () => ctx.sleep(await js(`Math.max(0,10800-(Date.now()-(window.__addAt||0)))`) + 1500);
        await openAndClose('A');
        await perm(R2, 'thAb-' + w, 'Run, then answered elsewhere');
        await ctx.sleep(800);
        assert.strictEqual(await panelOpen(), false, `${at}: a second ask inside the throttle does not open it yet`);
        await idle(R2); // answered elsewhere before the throttle ends
        await untilThrottleEnds();
        assert.strictEqual(await panelOpen(), false, `${at}: the throttled ask was answered elsewhere: the end of the throttle opens no empty panel`);
        await clean();
        await openAndClose('B');
        await perm(R2, 'thBb-' + w, 'Run, kept for later');
        await ctx.sleep(800);
        assert.strictEqual(await panelOpen(), false, `${at}: a second ask inside the throttle does not open it yet (B)`);
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 11000), `${at}: nothing else changed: the kept ask opens the panel by itself when the throttle ends`);
        await clean();
        // a card-less ask that gains its card while the opening is kept is the same ask: it still opens when the throttle ends
        await openAndClose('C');
        await emit({ type: 'status', sessionId: R2, status: 'needs-permission', intent: 'Waiting' }); // waiting, no card yet
        await ctx.sleep(500);
        await perm(R2, 'thCb-' + w, 'Run, its card arrives after the wait'); // the card arrives: the same ask
        await ctx.sleep(500);
        assert.strictEqual(await panelOpen(), false, `${at}: a second ask inside the throttle does not open it yet (C)`);
        assert.ok(await until(`!!document.getElementById('needsPanel')`, 11000), `${at}: an ask that gained its card while kept still opens the panel when the throttle ends`);
        await clean();
      }

      // ---- FR-033: focus in a limit row's amount field, the row leaves (round 4, finding 2) ----
      {
        const L = await live(0), P = await live(1);
        await emit({ type: 'limit', sessionId: L, phase: 'exhausted', requestId: 'lm-' + w, maxAiCredits: 5, usedAiCredits: 5 });
        await ctx.sleep(120); await perm(P, 'lp-' + w, 'Run beside the limit');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: the limit and the request wait`);
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(L)}] .ib-amt')`, 4000), `${at}: the limit row shows its amount field`);
        await js(`window.__perm=[];document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(L)}] .ib-amt').focus()`);
        await js(`window.__durbarSimUi.agents().forEach(a=>{if(a.id===${jsLiteral(L)})a.limit=null;})`);
        await idle(L); // the limit row leaves
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1`, 6000), `${at}: the limit row left`);
        const f = await aeInfo();
        assert.ok(f.head && f.row === P, `${at}: with focus in an amount field, the row leaving puts focus on a heading, not on the page ${JSON.stringify(f)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(500);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A answers nothing after the amount field's row left`);
        await clean();
      }

      // ---- FR-033: the amount field keeps what was typed and the focus when another row leaves (round 5) ----
      {
        const L2 = await live(2), P2 = await live(1);
        await emit({ type: 'limit', sessionId: L2, phase: 'exhausted', requestId: 'lm2-' + w, maxAiCredits: 5, usedAiCredits: 5 });
        await ctx.sleep(120); await perm(P2, 'lq-' + w, 'Run beside the second limit');
        assert.ok(await until(`Number((document.querySelector('#inboxBtn b')||{}).textContent)===2`, 6000), `${at}: the limit and the request wait`);
        await ensureOpen();
        assert.ok(await until(`!!document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(L2)}] .ib-amt')`, 4000), `${at}: the limit row shows its amount field`);
        await js(`window.__perm=[];(()=>{const i=document.querySelector('#needsPanel .inbox-row[data-id=${jsLiteral(L2)}] .ib-amt');i.focus();i.select();})()`);
        await key('7', [], { char: 'always' });
        assert.ok(await until(`document.activeElement.classList.contains('ib-amt')&&document.activeElement.value==='7'`, 3000), `${at}: 7 is typed in the amount field`);
        await idle(P2); // the other row leaves: a repaint
        assert.ok(await until(`document.querySelectorAll('#needsPanel .inbox-row').length===1`, 6000), `${at}: the other row left`);
        const st = await js(`(()=>{const a=document.activeElement;return {amt:a.classList.contains('ib-amt'),v:a.value,tag:a.tagName}})()`);
        assert.ok(st.amt && st.v === '7', `${at}: the amount field is still focused and still says 7 ${JSON.stringify(st)}`);
        await key('a', [], { char: 'always' }); await ctx.sleep(400);
        assert.deepStrictEqual(await js('window.__perm.slice()'), [], `${at}: A in the amount field answers nothing`);
        await clean();
      }
      await door2(at, tag, w, view, load);
    }
  }
  console.log('check-needs-panel passed');
};
