/*
 * Spec 034 FR-018..FR-021 (issue #600): "Retrying" while the agent app retries the model API. Simulator only (no AI credits). Linux:
 *
 *   npm run build
 *   OUT=/tmp/retry DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-034-retry.js xvfb-run -a npx electron . --no-sandbox
 *
 * With `simretry=1` Clara (working) is retrying (attempt 3 of 10, servers busy, HTTP 529) and Tomas (error) gave up after 2 retries.
 * At 1440x900 and 1280x800 it checks: Clara's pill says Retrying (desk, chat header, list), her task line and the pill's tooltip carry the
 * line, her desk keeps its size when the mark ends; one chat note per run, updated in place by a 4th retry, then "went through" after an
 * answer (pill back to Working, the task line restored); Tomas's task line and his note say he gave up; an error after a retry with no
 * gave-up event from the adapter is a gave-up too; Serious mode still shows Retrying; a Stop turns the note into "Stopped while retrying". Every wait is until() and its result is asserted.
 * Writes retry-office-*.png, retry-chat-*.png and retry-gaveup-*.png into OUT.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

const LINE3 = 'Retrying (attempt 3 of 10) – servers busy (HTTP 529)';
const LINE4 = 'Retrying (attempt 4 of 10) – servers busy (HTTP 529)';
const GAVE = 'Gave up after 2 retries – rate limit (HTTP 429)';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms), what);
  /* the desk of an agent by name, defined once in the page (so page code only splices jsLiteral values) */
  const deskFn = () => js(`window.__rDesk=n=>[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>(d.querySelector('.name')||{}).textContent===n);0`);
  const info = (name) => js(`(()=>{const d=__rDesk(${jsLiteral(name)});if(!d)return null;const p=d.querySelector('.pill'),t=d.querySelector('.task'),b=d.getBoundingClientRect();
    return {id:d.dataset.id,state:d.dataset.state,cls:d.className,pill:p?p.innerText.trim():'',pillCls:p?p.className:'',pillTip:p?p.getAttribute('title')||'':'',task:t?t.textContent.trim():'',text:d.innerText.replace(/\\s+/g,' '),tip:d.getAttribute('title')||'',w:Math.round(b.width),h:Math.round(b.height)}})()`);
  const emit = (e) => js(`window.__durbarSimEmit(${jsLiteral(e)})`);
  const closeChat = async () => { await H.key('Escape'); await ok(`!document.body.classList.contains('panel-open')`, 'the chat closes'); };
  const openChat = async (name) => { await js(`__rDesk(${jsLiteral(name)}).click()`); await H.chatOf(name); assert.ok(await js(`document.body.classList.contains('panel-open')`), `the chat of ${name} is open`); };
  const notes = () => js(`[...document.querySelectorAll('#chat .note.retry')].map(n=>({text:n.textContent,err:n.classList.contains('err')}))`);
  const serious = async (on) => {
    await H.click('#settingsBtn');
    await ok(`!!document.getElementById('seriousSw')`, 'Settings shows the Serious mode switch');
    if ((await js(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`)) !== on) await H.click('#seriousSw');
    await ok(`document.getElementById('seriousSw').getAttribute('aria-checked')===${jsLiteral(String(on))}`, `Serious mode ${on ? 'on' : 'off'}`);
    await H.click('#scrClose');
    await ok(`!document.getElementById('seriousSw')||!document.getElementById('seriousSw').getClientRects().length`, 'Settings closes');
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simretry: '1' } });
    await deskFn();
    await ok(`(__rDesk(${jsLiteral('Clara')})||{}).dataset&&__rDesk(${jsLiteral('Clara')}).querySelector('.pill').innerText.trim()==='Retrying'`, 'Clara is Retrying');
    await ok(`(__rDesk(${jsLiteral('Tomas')})||{}).dataset&&__rDesk(${jsLiteral('Tomas')}).dataset.state==='error'`, 'Tomas is in Error');
    await settle();

    // US 1: the pill, the line, the tooltip; the card keeps its size
    let c = await info('Clara');
    console.log('[034-retry]', w, JSON.stringify(c));
    assert.strictEqual(c.state, 'working', 'the state stays Working (Retrying is a pill word)');
    assert.ok(/\bst-retrying\b/.test(c.pillCls), 'the pill uses the Retrying class: ' + c.pillCls);
    assert.strictEqual(c.pillTip, LINE3, 'the pill tooltip has the whole line');
    assert.ok(c.text.includes(LINE3) || c.tip.includes(LINE3), 'the desk shows the line: ' + c.text);
    if (c.cls.includes('card')) assert.ok(/\bis-retrying\b/.test(c.cls), 'a card is marked is-retrying');
    const t = await info('Tomas');
    assert.strictEqual(t.pill, 'Error', 'Tomas: the pill still says Error');
    assert.ok(t.text.includes(GAVE) || t.tip.includes(GAVE), 'Tomas: the gave-up line: ' + t.text);
    const fit = await js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`);
    assert.ok(fit, 'no page overflow');
    await H.shot(path.join(OUT, `retry-office-${w}x${h}.png`), { prep: 'calm', blur: true, settle: true });

    // the list view: the status pill and the dot
    await H.click('#vList');
    await ok(`[...document.querySelectorAll('#list button.lrow')].some(r=>/Clara/.test(r.innerText)&&r.querySelector('.dot.retrying')&&/Retrying/.test(r.innerText))`, 'the list row says Retrying with its dot');
    await H.click('#vOffice');
    await ok(`document.getElementById('vOffice').getAttribute('aria-pressed')==='true'&&![...document.querySelectorAll('#list button.lrow')].some(r=>r.getClientRects().length)&&!!(__rDesk(${jsLiteral('Clara')}))&&__rDesk(${jsLiteral('Clara')}).getClientRects().length>0`, 'back to the office');

    // US 1-3 in the chat: one note, updated in place, then "went through"
    await openChat('Clara');
    let n = await notes();
    assert.deepStrictEqual(n, [{ text: LINE3 + '. The agent app tries again by itself.', err: false }], 'one note for the run of retries: ' + JSON.stringify(n));
    await ok(`(document.querySelector('#panelHead [data-f=status]')||{}).textContent==='Retrying'`, 'the chat header says Retrying');
    await ok(`(()=>{const x=document.querySelector('.sitem[data-sw='+CSS.escape(${jsLiteral(c.id)})+']');return !!x&&x.classList.contains('st-retrying')&&x.classList.contains('attn')&&/Retrying/.test(x.textContent)})()`, 'the chat strip marks Clara Retrying, with attention');
    await H.shot(path.join(OUT, `retry-chat-${w}x${h}.png`), { prep: 'calm', blur: true, settle: true });
    await emit({ type: 'retry', sessionId: c.id, timestamp: Date.now(), phase: 'retrying', attempt: 4, maxAttempts: 10, reason: 'overloaded', httpStatus: 529 });
    await ok(`[...document.querySelectorAll('#chat .note.retry')].length===1&&document.querySelector('#chat .note.retry').textContent.startsWith(${jsLiteral(LINE4)})`, 'the 4th retry updates the same note');
    await ok(`document.querySelector('#panelHead [data-f=status]').title===${jsLiteral(LINE4)}`, 'the chat header tooltip follows');
    const before = c;
    await emit({ type: 'output', sessionId: c.id, timestamp: Date.now(), delta: 'Back on track.' });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent==='Working'`, 'an answer: the chat header says Working again');
    n = await notes();
    assert.deepStrictEqual(n, [{ text: 'The request went through after 4 retries.', err: false }], 'the note says it went through');
    await closeChat();
    await ok(`__rDesk(${jsLiteral('Clara')}).getClientRects().length>0&&__rDesk(${jsLiteral('Clara')}).querySelector('.pill').innerText.trim()==='Working'`, 'the office shows Clara Working');
    c = await info('Clara');
    assert.ok(!c.text.includes('Retrying') && !c.pillTip, 'no Retrying line left on the desk: ' + c.text);
    assert.deepStrictEqual([c.w, c.h], [before.w, before.h], 'the desk keeps its size when Retrying ends (no layout jump)');

    // US 4: Tomas gave up; his note says so
    await openChat('Tomas');
    n = await notes();
    assert.deepStrictEqual(n, [{ text: GAVE + '.', err: true }], 'the gave-up note');
    await H.shot(path.join(OUT, `retry-gaveup-${w}x${h}.png`), { prep: 'calm', blur: true, settle: true });
    await closeChat();

    // an adapter that sends no gave-up: the error after a retry is one (Ada is working)
    const ada = await info('Ada');
    assert.ok(ada && ada.state === 'working', 'Ada is working');
    await emit({ type: 'retry', sessionId: ada.id, timestamp: Date.now(), phase: 'retrying', attempt: 1, reason: 'network' });
    await ok(`__rDesk(${jsLiteral('Ada')}).querySelector('.pill').innerText.trim()==='Retrying'`, 'Ada retries');
    await emit({ type: 'status', sessionId: ada.id, timestamp: Date.now(), status: 'error', intent: 'stream disconnected' });
    await ok(`__rDesk(${jsLiteral('Ada')}).dataset.state==='error'`, 'Ada errors');
    const a2 = await info('Ada');
    assert.ok(a2.text.includes('Gave up after 1 retry – connection problem') || a2.tip.includes('Gave up after 1 retry – connection problem'), 'the error after a retry gave up: ' + a2.text);

    // a helper's retry is ignored; Serious mode still shows Retrying (it is a status)
    await emit({ type: 'retry', sessionId: c.id, timestamp: Date.now(), phase: 'retrying', attempt: 1, reason: 'server', agentId: 'helper-x' });
    await settle();
    assert.strictEqual((await info('Clara')).pill, 'Working', "a helper's retry changes nothing");
    await serious(true);
    await emit({ type: 'retry', sessionId: c.id, timestamp: Date.now(), phase: 'retrying', attempt: 1, reason: 'rate-limit', httpStatus: 429 });
    await ok(`__rDesk(${jsLiteral('Clara')}).querySelector('.pill').innerText.trim()==='Retrying'`, 'Serious mode: Retrying shows');
    await serious(false);

    // review on PR 645 (4): a Stop while retrying finalizes the note (no "tries again by itself" left behind)
    await emit({ type: 'status', sessionId: c.id, timestamp: Date.now(), status: 'idle', intent: 'Aborted' });
    await ok(`__rDesk(${jsLiteral('Clara')}).querySelector('.pill').innerText.trim()!=='Retrying'`, 'a Stop ends Retrying');
    await openChat('Clara');
    n = await notes();
    assert.strictEqual(n.length, 2, 'the went-through note and this run\'s note: ' + JSON.stringify(n));
    assert.deepStrictEqual(n[1], { text: 'Stopped while retrying (after 1 retry).', err: false }, 'the note says the retries were stopped');
    assert.ok(!n.some((x) => /tries again by itself/.test(x.text)), 'no stale "tries again" note');
    await closeChat();
  }
  console.log('[034-retry] PASS');
};
