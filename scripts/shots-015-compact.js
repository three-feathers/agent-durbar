/*
 * Spec 015 FR-010..FR-014 (issue #601): "Compacting" on the desk while the agent app summarises the conversation. Simulator only (no AI credits). Linux:
 *
 *   npm run build
 *   OUT=/tmp/compact DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-015-compact.js xvfb-run -a npx electron . --no-sandbox
 *
 * With `simcompact=1` Clara (working) is mid-compaction (a Claude-style start: the trigger is not known). At 1440x900 and 1280x800 it checks:
 * the pill says Compacting on the desk, the list row, the chat header and the strip (no attention flag), the desk line and the pill tooltip,
 * the card keeps its size; the chat has the start line and the context ring says Compacting in its name; a `complete` with no new size
 * leaves the ring "waiting for the next message" (no stale figure) and no "nearly full" note, and the next `context` event shows the
 * figure; a failed compaction ends the mark and says the conversation is unchanged; a truncation is its own line and never "compacted";
 * a stop or an error ends the mark; Waiting and Error keep their own word; a helper's event changes nothing; hostile text in an event is shown as text;
 * Serious mode still shows it. Every wait is until() and its result is asserted.
 * Writes 015-compacting-office-*.png and 015-compacting-chat-*.png into OUT.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms), what);
  const deskFn = () => js(`window.__rDesk=n=>[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>(d.querySelector('.name')||{}).textContent===n);0`);
  const pillOf = (name) => `(__rDesk(${jsLiteral(name)})||{querySelector:()=>null}).querySelector('.pill')`;
  const pillIs = (name, word) => `!!${pillOf(name)}&&${pillOf(name)}.innerText.trim()===${jsLiteral(word)}`;
  const info = (name) => js(`(()=>{const d=__rDesk(${jsLiteral(name)});if(!d)return null;const p=d.querySelector('.pill'),b=d.getBoundingClientRect();
    return {id:d.dataset.id,state:d.dataset.state,cls:d.className,pill:p?p.innerText.trim():'',pillCls:p?p.className:'',pillTip:p?p.getAttribute('title')||'':'',text:d.innerText.replace(/\\s+/g,' '),tip:d.getAttribute('title')||'',w:Math.round(b.width),h:Math.round(b.height)}})()`);
  const emit = (e) => js(`window.__durbarSimEmit(${jsLiteral(e)})`);
  const closeChat = async () => { await H.key('Escape'); await ok(`!document.body.classList.contains('panel-open')`, 'the chat closes'); };
  const openChat = async (name) => { await js(`__rDesk(${jsLiteral(name)}).click()`); await H.chatOf(name); assert.ok(await js(`document.body.classList.contains('panel-open')`), `the chat of ${name} is open`); };
  const lines = () => js(`[...document.querySelectorAll('#chat .note.cline')].map(n=>n.textContent)`);
  const ring = () => js(`(()=>{const r=document.getElementById('ctxChip');return r?{label:r.getAttribute('aria-label')||'',title:r.getAttribute('title')||'',cls:r.className}:null})()`);
  const serious = async (on) => {
    await H.click('#settingsBtn');
    await ok(`!!document.getElementById('seriousSw')`, 'Settings shows the Serious mode switch');
    if ((await js(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`)) !== on) await H.click('#seriousSw');
    await ok(`document.getElementById('seriousSw').getAttribute('aria-checked')===${jsLiteral(String(on))}`, `Serious mode ${on ? 'on' : 'off'}`);
    await H.click('#scrClose');
    await ok(`!document.getElementById('seriousSw')||!document.getElementById('seriousSw').getClientRects().length`, 'Settings closes');
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simcompact: '1' } });
    await deskFn();
    await ok(pillIs('Clara', 'Compacting'), 'Clara is Compacting');
    await settle();

    // US-C1: the pill, the line, the tooltip; the card keeps its size
    let c = await info('Clara');
    console.log('[015-compact]', w, JSON.stringify(c));
    assert.strictEqual(c.state, 'working', 'the state stays Working (Compacting is a pill word)');
    assert.ok(/\bst-compacting\b/.test(c.pillCls), 'the pill uses the Compacting class: ' + c.pillCls);
    assert.strictEqual(c.pillTip, 'Compacting the conversation…', 'the pill tooltip');
    assert.ok(c.text.includes('Compacting the conversation…'), 'the desk shows the line: ' + c.text);
    if (c.cls.includes('card')) assert.ok(/\bis-compacting\b/.test(c.cls), 'a card is marked is-compacting');
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`), 'no page overflow');
    for (const other of ['Ada', 'Tomas']) assert.ok(!(await info(other)).pill.includes('Compacting'), other + ' is not compacting');
    await H.shot(path.join(OUT, `015-compacting-office-${w}x${h}.png`), { prep: 'calm', blur: true, settle: true });

    // the list view
    await H.click('#vList');
    await ok(`[...document.querySelectorAll('#list button.lrow')].some(r=>/Clara/.test(r.innerText)&&r.querySelector('.dot.compacting')&&/Compacting/.test(r.innerText))`, 'the list row says Compacting with its dot');
    await H.click('#vOffice');
    await ok(`document.getElementById('vOffice').getAttribute('aria-pressed')==='true'&&!!__rDesk(${jsLiteral('Clara')})&&__rDesk(${jsLiteral('Clara')}).getClientRects().length>0`, 'back to the office');

    // the chat: header, strip (no attention flag), the start line, the ring
    await openChat('Clara');
    await ok(`(document.querySelector('#panelHead [data-f=status]')||{}).textContent==='Compacting'`, 'the chat header says Compacting');
    await ok(`(()=>{const x=document.querySelector('.sitem[data-sw='+CSS.escape(${jsLiteral(c.id)})+']');return !!x&&x.classList.contains('st-compacting')&&!x.classList.contains('attn')&&/Compacting/.test(x.textContent)})()`, 'the strip marks Clara Compacting, without the attention flag');
    assert.deepStrictEqual(await lines(), ['Compacting the context…'], 'the start line (no "(automatic)": the trigger is not known)');
    let r = await ring();
    assert.ok(r && r.label.startsWith('Compacting the conversation…') && r.title.startsWith('Compacting the conversation…') && /\bcompacting\b/.test(r.cls), 'the ring says Compacting: ' + JSON.stringify(r));
    await H.shot(path.join(OUT, `015-compacting-chat-${w}x${h}.png`), { prep: 'calm', blur: true, settle: true });

    // a helper's compaction changes nothing
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'start', trigger: 'unknown', agentId: 'helper-x' });
    await settle();
    assert.deepStrictEqual(await lines(), ['Compacting the context…'], "a helper's event adds no line");

    // the end with no new size (Claude, Codex): the pill goes back, the ring waits, no stale figure, no "nearly full" note
    await emit({ type: 'context', sessionId: c.id, timestamp: Date.now(), tokens: 95000, limit: 100000 });
    await ok(`(document.getElementById('ctxChip')||{}).className&&/\\bhigh\\b/.test(document.getElementById('ctxChip').className)`, 'the ring is red at 95%');
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'complete', trigger: 'auto', tokensBefore: 95000 });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent==='Working'`, 'the header says Working again');
    await ok(`!document.querySelector('#chat .note.cline').textContent.startsWith('Compacting')`, 'the start line became the result line');
    assert.deepStrictEqual(await lines(), ['Context compacted (automatic): it held 95k tokens.'], 'one line, updated in place');
    r = await ring();
    assert.ok(/waiting for the next message after the compaction/.test(r.label) && !/\bhigh\b/.test(r.cls) && !r.label.startsWith('Compacting'), 'the ring waits, not 95%: ' + JSON.stringify(r));
    assert.ok(await js(`!document.querySelector('#chat .note.fresh')`), 'no "nearly full" note on the old figure');
    await closeChat();
    await settle();
    await ok(`${pillIs('Clara', 'Working')}&&!__rDesk(${jsLiteral('Clara')}).innerText.includes('Compacting')`, 'the desk is back to Working without the line');
    await openChat('Clara');
    await emit({ type: 'context', sessionId: c.id, timestamp: Date.now(), tokens: 30000, limit: 100000 });
    await ok(`/30%/.test(document.getElementById('ctxChip').getAttribute('aria-label'))`, 'the next context event shows the figure (30%)');

    // a failed compaction ends the mark and says the conversation is unchanged
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'start', trigger: 'unknown' });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent==='Compacting'`, 'Compacting again');
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'failed', trigger: 'unknown' });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent==='Working'`, 'a failure ends the mark');
    let l = await lines();
    assert.ok(/failed/.test(l[l.length - 1]) && /conversation is unchanged/.test(l[l.length - 1]), 'the failure line: ' + l[l.length - 1]);

    // a truncation is its own line and never "compacted"
    const n0 = (await lines()).length;
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'complete', trigger: 'truncation', tokensRemoved: 30000, limit: 128000 });
    await ok(`document.querySelectorAll('#chat .note.cline').length===${jsLiteral(n0 + 1)}`, 'the truncation adds its own line');
    l = await lines();
    assert.strictEqual(l[l.length - 1], 'Older messages dropped to fit the window: 30k tokens removed.');
    assert.ok(await js(`document.querySelector('#panelHead [data-f=status]').textContent==='Working'`), 'a truncation is not a Compacting state');
    r = await ring();
    assert.ok(/dropped/.test(r.label) && !/compact/i.test(r.label + r.title), 'the ring after a truncation says dropped, never compacted: ' + JSON.stringify(r));
    // a hostile failed + error as the FIRST event of a new run (right after a truncation, which leaves no run): the line is text
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'failed', trigger: 'unknown', error: '<img src=x onerror=window.__pwn=1>' });
    await ok(`[...document.querySelectorAll('#chat .note.cline')].some(n=>n.textContent.includes('<img src=x'))`, 'the hostile error is shown as text');
    assert.ok(await js(`!document.querySelector('#chat img')&&window.__pwn===undefined`), 'no element and nothing ran');

    // hostile text in an event is text
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'start', trigger: '<img src=x onerror=window.__pwn=1>' });
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'failed', trigger: '<img src=x onerror=window.__pwn=1>', error: '<img src=x onerror=window.__pwn=1>' });
    await settle();
    assert.ok(await js(`!document.querySelector('#chat img')&&window.__pwn===undefined`), 'hostile text creates no element and runs nothing');

    // a stop ends the mark (the adapter may send no end)
    await emit({ type: 'compaction', sessionId: c.id, timestamp: Date.now(), phase: 'start', trigger: 'unknown' });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent==='Compacting'`, 'Compacting before the stop');
    await emit({ type: 'status', sessionId: c.id, timestamp: Date.now(), status: 'idle', intent: 'Aborted' });
    await ok(`document.querySelector('#panelHead [data-f=status]').textContent!=='Compacting'`, 'a stop ends the mark');
    await closeChat();
    await ok(`!(${pillIs('Clara', 'Compacting')})`, 'the office agrees');

    // Error keeps its own word; Serious mode still shows Compacting (it is a status)
    const ada = await info('Ada');
    await emit({ type: 'compaction', sessionId: ada.id, timestamp: Date.now(), phase: 'start', trigger: 'unknown' });
    await ok(pillIs('Ada', 'Compacting'), 'Ada compacts');
    await serious(true);
    await ok(pillIs('Ada', 'Compacting'), 'Serious mode: Compacting shows');
    await serious(false);
    await emit({ type: 'status', sessionId: ada.id, timestamp: Date.now(), status: 'error', intent: 'boom' });
    await ok(`(__rDesk(${jsLiteral('Ada')})||{}).dataset&&__rDesk(${jsLiteral('Ada')}).dataset.state==='error'`, 'Ada errors');
    assert.strictEqual((await info('Ada')).pill, 'Error', 'an error keeps its own word');
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`), 'no page overflow at the end');
  }
  console.log('[015-compact] PASS');
};
