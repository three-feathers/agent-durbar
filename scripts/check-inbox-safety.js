/*
 * Spec 052 FR-206..FR-208 (2026-11-01, issue in the PR): the Needs you inbox cannot answer a request by accident.
 *   FR-206  a row's button answers only the request it was painted for (a card settled elsewhere is not answered again, the next card is not used);
 *   FR-207  a spending-limit row shows the amount it sends, has no letter key, and does not say "Allowed";
 *   FR-208  a held key (e.repeat) answers nothing.
 * Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=$(mktemp -d) DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-inbox-safety.js xvfb-run -a npx electron . --no-sandbox
 *
 * Also in `npm run check:ui` (scripts/ui-suite.js). Mutation checks (see the spec delta): drop the live-card lookup, drop the repeat guard,
 * give limit rows their letter keys back; each fails a different step here.
 */
const real = require('assert');
// INBOX_SOFT=1 lists every failed check instead of stopping at the first (to reproduce all three bugs in one run)
const failed = [];
const soft = (f) => (...a) => { try { return f(...a); } catch (e) { failed.push(String(e.message).split('\n')[0]); console.log('FAILED:', failed[failed.length - 1]); } };
const assert = process.env.INBOX_SOFT ? Object.assign(soft(real.ok), { ok: soft(real.ok), strictEqual: soft(real.strictEqual), deepStrictEqual: soft(real.deepStrictEqual) }) : real;
const { helpers, jsLiteral } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const wc = () => ctx.win.webContents;
  // a real key through the input pipeline; `repeat` marks it as held down (Electron: the 'isAutoRepeat' modifier)
  const nkey = async (keyCode, o = {}) => {
    const modifiers = o.repeat ? ['isAutoRepeat'] : [];
    wc().sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') wc().sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    else if (o.char) wc().sendInputEvent({ type: 'char', keyCode: o.char, modifiers });
    wc().sendInputEvent({ type: 'keyUp', keyCode });
    await ctx.sleep(80);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    let A, B, C;
    const emit = (e) => js(`window.__durbarSimUi.emit(${jsLiteral(Object.assign({ timestamp: 1 }, e))})`);
    const perm = (id, rid, summary) => emit({ type: 'status', sessionId: id, status: 'needs-permission', intent: 'Waiting', permission: { requestId: rid, kind: 'shell', summary, state: 'pending' } });
    // a fresh page for each part (so a failure in one cannot hide another), with every answer that reaches the bridge counted
    const fresh = async () => {
      await H.load({ w, h, focus: true });
      const first = await H.openSimAgent(`a=>!a.parent&&a.live&&a.info&&(a.state==='idle'||a.state==='done')`, '#msgInput');
      assert.ok(first.ok, `${w}: opened an idle agent's chat ${jsLiteral(first.seen)}`);
      const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live&&(a.state==='idle'||a.state==='done')).map(a=>a.id).slice(0,3)`);
      assert.ok(ids.length >= 3, `${w}: three idle agents ${jsLiteral(ids)}`);
      [A, B, C] = ids;
      await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__perm=[];window.__lim=[];if(!b.__w2){const p=b.resolvePermission,l=b.resolveLimit;
        b.resolvePermission=function(id,rid,ok){window.__perm.push(rid+':'+ok);return p.apply(this,arguments)};
        b.resolveLimit=function(id,rid,c){window.__lim.push(JSON.stringify(c));if(window.__hold)return new Promise(r=>window.__rel.push(r));return l.apply(this,arguments)};b.__w2=1;}
        window.__hold=false;window.__rel=[];window.__ann=[];window.__sent=[];window.__done=[];
        if(!b.__w3){const sd=b.send;b.send=function(){window.__sent.push(1);return sd.apply(this,arguments)};b.__w3=1;}
        new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){const d=n.nodeType===1&&(n.matches('.ib-done')?n:n.querySelector('.ib-done'));if(d)window.__done.push(d.textContent);}}).observe(document.body,{childList:true,subtree:true});const sr=document.getElementById('srAnnounce');new MutationObserver(()=>window.__ann.push(sr.textContent)).observe(sr,{childList:true,characterData:true,subtree:true});})()`);
    };
    await fresh();
    const perms = () => js('window.__perm.slice()');
    const lims = () => js('window.__lim.slice()');
    const row = (id) => `#inboxBody .inbox-row[data-id=${jsLiteral(id)}]`;
    const openInbox = async () => { await js(`document.getElementById('inboxBtn').click()`); assert.ok(await until(`!!document.getElementById('inboxDlg')`, 5000), `${w}: the inbox opens`); };
    const closeInbox = async () => { await js(`(document.getElementById('inboxClose')||{click(){}}).click()`); assert.ok(await until(`!document.getElementById('inboxDlg')`, 3000)); };
    const kd = (sel, k, repeat) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(k)},repeat:${jsLiteral(!!repeat)},bubbles:true,cancelable:true}));})()`);
    await closeInbox().catch(() => {});

    // ---- FR-206: a button answers only its own request ----
    await perm(A, 'p1-' + w, 'Run first');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.perm.pending')].length===1`, 8000), `${w}: card 1 is pending in the chat`);
    await js(`document.getElementById('msgInput').blur()`);
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')})`, 5000), `${w}: the row offers Allow`);
    // the row's button is kept; the card is answered in the chat (Deny), then the agent's next card arrives
    await js(`window.__stale=document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')})`);
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
    assert.ok(await until(`!document.querySelector('#chat .note.perm.pending')`, 5000), `${w}: card 1 settled in the chat`);
    await perm(A, 'p2-' + w, 'Run second');
    assert.ok(await until(`document.querySelectorAll('#chat .note.perm.pending').length===1`, 5000), `${w}: card 2 is pending`);
    const before = await perms();
    assert.deepStrictEqual(before, ['p1-' + w + ':false'], `${w}: only the chat's Deny reached the bridge ${jsLiteral(before)}`);
    await js(`window.__stale.click()`);
    assert.ok(await until(`window.__perm.length>1||/Already answered/.test((document.querySelector(${jsLiteral(row(A) + ' .ib-done')})||{}).textContent||'')`, 3000), `${w}: the stale press ends`);
    assert.deepStrictEqual(await perms(), before, `${w}: a stale button sends nothing (card 1 was answered, card 2 is not its request): ${jsLiteral(await perms())}`);
    assert.ok(await until(`window.__done.some(t=>/Already answered/.test(t))`, 3000), `${w}: the stale button says so ${jsLiteral(await js('window.__done'))}`);
    assert.ok(await until(`window.__ann.some(t=>/^Already answered/.test(t))`, 3000), `${w}: and it is announced ${jsLiteral(await js('window.__ann.slice(-4)'))}`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .note.perm.pending').length`), 1, `${w}: card 2 is still waiting`);
    await closeInbox();
    // a fresh row answers card 2, which proves the live path still works
    await openInbox();
    await js(`document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')}).click()`);
    assert.ok(await until(`window.__perm.length===2`, 3000), `${w}: a live row answers its own card`);
    assert.strictEqual((await perms())[1], 'p2-' + w + ':true', `${w}: ... and it is card 2`);
    assert.ok(await until(`!document.querySelector('#chat .note.perm.pending')`, 3000));
    await closeInbox();

    // ---- FR-208: a held key answers nothing ----
    await fresh();
    await perm(B, 'h1-' + w, 'Run held one');
    await perm(C, 'h2-' + w, 'Run held two');
    await until(`!!window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(B)})`, 3000);
    await openInbox();
    const heads = await js(`[...document.querySelectorAll('#inboxBody .inbox-row')].map(r=>r.dataset.id)`);
    assert.ok(heads.includes(B) && heads.includes(C), `${w}: both rows are there ${jsLiteral(heads)}`);
    const n0 = (await perms()).length;
    for (const k of ['a', 's', 'd', 'Enter']) await kd(row(B) + ' .ib-h', k, true);
    await H.settle(800).catch(() => {});
    assert.strictEqual((await perms()).length, n0, `${w}: a held A, S, D or Enter answers nothing`);
    assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(row(B) + '[data-answering]')})`), false, `${w}: the row is not being answered`);
    // a held Space and O do nothing (synthetic); a native held Enter on a focused Deny, a native held A and a native held O (their default actions need the real pipeline)
    await kd(row(B) + ' .ib-h', ' ', true);
    await kd(row(B) + ' .ib-h', 'o', true);
    await js(`document.querySelector(${jsLiteral(row(B) + ' [data-k="deny"]')}).focus()`);
    for (let i = 1; i <= 3; i++) await nkey('Return', { repeat: true });
    await js(`document.querySelector(${jsLiteral(row(B) + ' .ib-h')}).focus()`);
    for (let i = 1; i <= 3; i++) await nkey('A', { repeat: true, char: 'a' });
    for (let i = 1; i <= 3; i++) await nkey('O', { repeat: true, char: 'o' });
    assert.strictEqual((await perms()).length, n0, `${w}: native held Enter, A, O answer nothing ${jsLiteral(await perms())}`);
    assert.strictEqual(await js(`!!document.getElementById('inboxDlg')`), true, `${w}: a held O does not open the chat`);
    await kd(row(B) + ' .ib-h', 'a', false); // the same key, pressed once, still answers (the positive control)
    assert.ok(await until(`window.__perm.length===${jsLiteral(n0 + 1)}`, 3000), `${w}: one press of A answers`);
    assert.ok(await until(`!document.querySelector(${jsLiteral(row(B) + ' [data-k="approve"]')})`, 6000), `${w}: the answered row is repainted without the answer`);
    const n1 = (await perms()).length;
    for (let i = 0; i < 4; i++) await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'a',repeat:true,bubbles:true,cancelable:true}))`);
    await H.settle(800).catch(() => {});
    assert.strictEqual((await perms()).length, n1, `${w}: holding A after an answer does not walk down the queue`);
    await closeInbox();

    await fresh();
    // ---- FR-207: a limit row shows its amount, has no letter key, and does not say Allowed ----
    await emit({ type: 'limit', sessionId: C, phase: 'exhausted', requestId: 'lim-' + w, maxAiCredits: 5, usedAiCredits: 5 });
    await openInbox();
    assert.ok(await until(`/spending limit/.test((document.querySelector(${jsLiteral(row(C) + ' .ib-w')})||{}).textContent||'')`, 5000), `${w}: the row is the limit's`);
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(C) + ' .ib-amt')})`, 1500).catch(() => false), `${w}: the limit row shows the amount field`);
    const lr = await js(`(()=>{const r=document.querySelector(${jsLiteral(row(C))});const amt=r.querySelector('.ib-amt')||{value:'(none)',getAttribute(){return ''},getClientRects(){return []}};
      return {amt:amt.value,label:amt.getAttribute('aria-label'),shown:amt.getClientRects().length>0,btns:[...r.querySelectorAll('.ib-ans button')].map(b=>b.textContent),
        keyed:[...r.querySelectorAll('button')].filter(b=>b.dataset.k!=='open').filter(b=>b.getAttribute('aria-keyshortcuts')||/approve|session|deny/.test(b.dataset.k||'')).length}})()`);
    assert.strictEqual(lr.amt, '5', `${w}: the field shows what would be sent`);
    assert.ok(lr.shown && lr.label, `${w}: the field is visible and named`);
    assert.deepStrictEqual(lr.btns, ['Raise limit', 'Remove limit', 'Stop here'], `${w}: the buttons keep their own words`);
    assert.strictEqual(lr.keyed, 0, `${w}: no button of a limit row carries a letter key`);
    for (const k of ['a', 's', 'd']) await kd(row(C) + ' .ib-h', k, false);
    await H.settle(800).catch(() => {});
    assert.deepStrictEqual(await lims(), [], `${w}: A, S and D do nothing on a limit row (nothing sent: ${jsLiteral(await lims())})`);
    // an empty amount sends nothing; the field takes the focus
    await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value=''`);
    await js(`[...document.querySelectorAll(${jsLiteral(row(C) + ' button')})].find(b=>b.textContent==='Raise limit').click()`);
    assert.ok(await until(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).getAttribute('aria-invalid')==='true'`, 3000), `${w}: the empty amount is flagged (aria-invalid)`);
    assert.deepStrictEqual(await lims(), [], `${w}: an empty amount sends nothing`);
    assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(row(C) + '[data-answering]')})`), false, `${w}: the row is not being answered`);
    // zero and a number that rounds to zero send nothing
    for (const v of ['0', '0.004']) {
      await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value=${jsLiteral(v)}`);
      await js(`[...document.querySelectorAll(${jsLiteral(row(C) + ' button')})].find(b=>b.textContent==='Raise limit').click()`);
      assert.deepStrictEqual(await lims(), [], `${w}: ${v} sends nothing from the row ${jsLiteral(await lims())}`);
      assert.strictEqual(await js(`!!document.querySelector(${jsLiteral(row(C) + '[data-answering], ' + row(C) + ' .ib-done')})`), false, `${w}: ${v}: the row is not answering and says nothing was done`);
    }
    // really typing in the amount is not a command: J moves nowhere, and A, S, D send nothing
    await js(`(()=>{const a=document.querySelector(${jsLiteral(row(C) + ' .ib-amt')});a.value='';a.focus();})()`);
    for (const [kc, ch] of [['J', 'j'], ['K', 'k'], ['A', 'a'], ['S', 's'], ['D', 'd']]) await nkey(kc, { char: ch });
    assert.strictEqual(await js(`document.activeElement.classList.contains('ib-amt')`), true, `${w}: typing j, k, a, s, d in the amount keeps focus there`);
    assert.deepStrictEqual(await lims(), [], `${w}: and sends nothing`);
    // what was typed survives a repaint (closing and opening paints again), and the Open button keeps its O
    await js(`(()=>{const a=document.querySelector(${jsLiteral(row(C) + ' .ib-amt')});a.value='12';a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await closeInbox();
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(C) + ' .ib-amt')})`, 5000));
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value`), '12', `${w}: the typed amount is kept for the same request`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-open')}).getAttribute('aria-keyshortcuts')`), 'O', `${w}: a limit row's Open still names its key`);
    // the number in the row is the number sent
    await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value='7'`);
    await js(`[...document.querySelectorAll(${jsLiteral(row(C) + ' button')})].find(b=>b.textContent==='Raise limit').click()`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).disabled`), true, `${w}: the amount is off while the row is answering`);
    assert.ok(await until(`window.__lim.length===1`, 3000), `${w}: Raise limit sends`);
    assert.strictEqual((await lims())[0], JSON.stringify({ kind: 'add', credits: 7 }), `${w}: it sent the 7 the row showed`);
    const said = await until(`window.__done.some(t=>/Raise limit/.test(t))`, 3000);
    assert.ok(said, `${w}: the row says what was pressed`);
    assert.ok(!(await js(`window.__done.some(t=>/Allowed/.test(t))`)), `${w}: it never says Allowed`);
    await closeInbox();

    // ---- FR-208 in the chat: a held Alt+A (the answer keys of an open chat) answers nothing, one press answers the oldest ----
    await fresh();
    await perm(A, 'k1-' + w, 'Run key one');
    await perm(A, 'k2-' + w, 'Run key two');
    assert.ok(await until(`document.querySelectorAll('#chat .note.perm.pending').length===2`, 8000), `${w}: two cards wait in the chat`);
    const alt = (repeat) => js(`document.getElementById('msgInput').dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',altKey:true,repeat:${jsLiteral(!!repeat)},bubbles:true,cancelable:true}))`);
    for (let i = 0; i < 3; i++) await alt(true);
    await H.settle(800).catch(() => {});
    assert.deepStrictEqual(await perms(), [], `${w}: a held Alt+A answers nothing ${jsLiteral(await perms())}`);
    await alt(false);
    assert.ok(await until(`window.__perm.length===1`, 3000), `${w}: one Alt+A answers the oldest`);
    assert.strictEqual((await perms())[0], 'k1-' + w + ':true', `${w}: ... and it is the first card`);
    // held Alt+S and Alt+D answer nothing; one Alt+D denies the oldest (k2 carries a session grant so Alt+S has a button)
    const altKey = (k, repeat) => js(`document.getElementById('msgInput').dispatchEvent(new KeyboardEvent('keydown',{key:${jsLiteral(k.toLowerCase())},code:${jsLiteral('Key' + k)},altKey:true,repeat:${jsLiteral(!!repeat)},bubbles:true,cancelable:true}))`);
    for (let i = 0; i < 3; i++) { await altKey('S', true); await altKey('D', true); }
    await H.settle(800).catch(() => {});
    assert.strictEqual((await perms()).length, 1, `${w}: a held Alt+S and Alt+D answer nothing ${jsLiteral(await perms())}`);
    await altKey('D', false);
    assert.ok(await until(`window.__perm.length===2`, 3000), `${w}: one Alt+D denies the next`);
    assert.strictEqual((await perms())[1], 'k2-' + w + ':false', `${w}: ... k2`);

    // ---- FR-206: a card whose answer is already on its way (its button disabled) is not answered again from the row ----
    await fresh();
    await emit({ type: 'limit', sessionId: C, phase: 'exhausted', requestId: 'lf-' + w, maxAiCredits: 5, usedAiCredits: 5 });
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(C) + ' .ib-amt')})`, 5000));
    await js(`window.__hold=true`);
    // the card's own Raise limit (in the chat DOM of that agent) goes out and waits
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(C)});const c=a.limit&&a.limit.n;[...c.querySelectorAll('.note-actions button')].find(b=>b.textContent==='Raise limit').click();})()`);
    assert.ok(await until(`window.__lim.length===1`, 3000), `${w}: the card's answer is in flight`);
    await js(`[...document.querySelectorAll(${jsLiteral(row(C) + ' button')})].find(b=>b.textContent==='Raise limit').click()`);
    assert.ok(await until(`window.__done.some(t=>/Already answered/.test(t))`, 3000), `${w}: and the row says so ${jsLiteral(await js('window.__done'))}`);
    assert.strictEqual((await lims()).length, 1, `${w}: the row does not answer it a second time ${jsLiteral(await lims())}`);
    await closeInbox();

    // ---- the row's controls: a real click into the amount stays there (a row click used to open the chat behind the dialog and focus its message box) ----
    await fresh();
    await emit({ type: 'limit', sessionId: C, phase: 'exhausted', requestId: 'lk-' + w, maxAiCredits: 5, usedAiCredits: 5 });
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(C) + ' .ib-amt')})`, 5000));
    const centre = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`);
    const click = async (sel) => { const [x, y] = await centre(sel); wc().sendInputEvent({ type: 'mouseMove', x, y }); wc().sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc().sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await ctx.sleep(150); };
    // empty amount, real click on Raise limit: the focus is in the amount, nothing is sent
    await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value=''`);
    await click(row(C) + ' button.primary');
    const inAmt = await until(`document.activeElement.classList.contains('ib-amt')`, 3000);
    assert.ok(inAmt, w + ': after an empty Raise limit the focus is in the amount (is ' + (await js('document.activeElement.tagName+"."+document.activeElement.className')) + ')');
    assert.deepStrictEqual(await lims(), [], `${w}: nothing is sent`);
    // real click into the field, type 50, Enter: the amount is 50, no message goes to the agent
    await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value=''`);
    await click(row(C) + ' .ib-amt');
    const clicked = await until(`document.activeElement.classList.contains('ib-amt')`, 3000);
    assert.ok(clicked, w + ': a click into the amount focuses it (is ' + (await js('document.activeElement.tagName+"."+document.activeElement.className')) + ')');
    await nkey('5', { char: '5' });
    await nkey('0', { char: '0' });
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(row(C) + ' .ib-amt')}).value`), '50', `${w}: the typed digits are in the amount`);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), '', `${w}: and not in the message box`);
    await nkey('Return');
    assert.ok(await until(`window.__lim.length===1`, 3000), `${w}: Enter in the amount raises the limit`);
    assert.strictEqual((await lims())[0], JSON.stringify({ kind: 'add', credits: 50 }), `${w}: by the 50 typed`);
    assert.deepStrictEqual(await js('window.__sent'), [], `${w}: no message was sent to the agent`);
    await closeInbox();

    // ---- an answered row keeps the focus in the dialog; the next Enter sends no draft; O and Enter during the fold open nothing ----
    await fresh();
    await perm(A, 'f1-' + w, 'Run focus one');
    await js(`(()=>{const m=document.getElementById('msgInput');m.value='my draft';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')})`, 5000));
    await js(`document.querySelector(${jsLiteral(row(A) + ' .ib-h')}).focus()`);
    await nkey('A', { char: 'a' });
    assert.ok(await until(`window.__perm.length===1`, 3000), `${w}: A answers the row`);
    for (const t of [50, 300, 500]) {
      await ctx.sleep(t === 50 ? 50 : 150);
      const inDlg = await js(`!!document.activeElement.closest('#inboxDlg')`);
      assert.ok(inDlg, w + ': focus is still in the dialog after the answer (is ' + (await js('document.activeElement.id+"/"+document.activeElement.tagName')) + ')');
    }
    await nkey('Return');
    assert.deepStrictEqual(await js('window.__sent'), [], `${w}: the next Enter sends no draft`);
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'my draft', `${w}: the draft is still there`);
    // O and Enter on a row that is being answered open nothing
    await fresh();
    await perm(A, 'g1-' + w, 'Run fold one');
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')})`, 5000));
    await js(`document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')}).click()`);
    await kd(row(A) + ' .ib-h', 'o', false);
    await kd(row(A) + ' .ib-h', 'Enter', false);
    assert.strictEqual(await js(`!!document.getElementById('inboxDlg')`), true, `${w}: O and Enter on a row being answered do not open its chat`);
    await closeInbox().catch(() => {});

    // ---- FR-206: a card that rebuilt its buttons (the old ones are gone) is not answered through an old one ----
    await fresh();
    await perm(A, 'rb-' + w, 'Run rebuild');
    await openInbox();
    assert.ok(await until(`!!document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')})`, 5000));
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(A)});const n=document.querySelector('#chat .note.perm.pending');const r=n.querySelector(':scope > .note-actions');r.replaceWith(r.cloneNode(true));})()`);
    await js(`document.querySelector(${jsLiteral(row(A) + ' [data-k="approve"]')}).click()`);
    assert.ok(await until(`window.__done.some(t=>/Already answered/.test(t))`, 3000), `${w}: the row says so ${jsLiteral(await js('window.__done'))}`);
    assert.deepStrictEqual(await perms(), [], `${w}: nothing is sent through the replaced button ${jsLiteral(await perms())}`);
    await closeInbox().catch(() => {});
  }
  if (failed.length) throw new Error(failed.length + ' checks failed (INBOX_SOFT)');
  console.log('[inbox-safety] PASS');
};
