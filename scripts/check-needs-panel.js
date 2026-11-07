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
 * The page is loaded with `door=1` (the flag). Mutation checks (listed in the PR): focus the first heading on an automatic open (step 1),
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
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const view of ['flat', 'real']) {
      const at = `${w}x${h} ${view}`;
      const tag = `${w}x${h}-${view}`;
      // a page that watches every panel that is added, and every answer that reaches the bridge
      const load = async (door) => {
        await H.load({ w, h, query: Object.assign(view === 'real' ? { officeview: 'real' } : {}, door ? { door: '1' } : {}), ready: READY[view], settle: false, focus: true });
        await js(`(()=>{window.__adds=0;window.__perm=[];window.__done=[];new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){const d=n.nodeType===1&&(n.matches('.ib-done')?n:n.querySelector('.ib-done'));if(d)window.__done.push(d.textContent);}}).observe(document.body,{childList:true,subtree:true});new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.id==='needsPanel')window.__adds++;}).observe(document.body,{childList:true});
          const b=window.__durbarSimUi.bridge();if(!b.__w2){const p=b.resolvePermission;b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};b.__w2=1;}
          if(!b.__w3){window.__lim=[];window.__qa=[];b.resolveLimit=function(id,rid,c){window.__lim.push(JSON.stringify(c));return Promise.resolve({ok:true})};
            b.answerQuestion=function(id,rid,ans){window.__qa.push(rid+':'+JSON.stringify(ans));return Promise.resolve(window.__nosettle?{ok:false,error:'not now'}:{ok:true})}; /* the simulator's main side does not know a question the page was only told about, so the bridge says yes: only the page's use of it is under test */
            b.__w3=1;}})()`);
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
      await door2(at, tag, w, view, load);
    }
  }
  console.log('check-needs-panel passed');
};
