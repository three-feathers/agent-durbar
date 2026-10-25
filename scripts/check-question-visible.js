/*
 * Check for spec 052 FR-162/FR-163 (owner, 2026-10-21): a waiting question is always visible without scrolling, and compactions in a row
 * are one line. Simulator only (no AI credits).
 *
 *   npm run check:question-visible
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simquestion=compact` asks one short question, then the runtime compacts six times in a row while it waits. At 1440x900 and 1280x800:
 * the six compactions are one line with a count ("Context compacted 6 times · last …") whose tooltip lists each; at the bottom of the chat
 * and scrolled to the top the question is visible (its card in view, or the answer bar above the composer with the question text);
 * scrolled up, the bar has the options, an "Other answer" box, Skip and "Show question", inside the window; "Show question" scrolls to
 * the card and focuses its first option; text typed in the bar's box survives a change in the chat; Enter in the box answers the card,
 * and (after a reload) an option button in the bar answers it too; the bar then goes away. A miss prints DRIVER FAILED (Electron still
 * exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.OUT || require('os').tmpdir();
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: 'question-visible' });
  const open = async (w, h) => {
    await H.load({ w, h, query: { simquestion: 'compact' }, ready: 'fit' });
    // wait for the simulator's own question, then open that one agent (no sweep over every desk: docs/agent-notes.md)
    const o = await H.openSimAgent(`a=>!a.parent&&a.question`, '#chat .note.question .q-opt');
    assert.ok(o.ok, `${w}: an agent has the question in its chat: ${JSON.stringify({ id: o.id, ...o.seen })}`);
    await settle();
  };
  /* the question can be seen without scrolling: its card is in the chat's view, or the answer bar shows its words inside the window */
  const seen = () => js(`(()=>{const ch=document.getElementById('chat').getBoundingClientRect(),c=document.querySelector('#chat .note.question:not(.settled)');if(!c)return {open:false};
    const r=c.getBoundingClientRect(),vis=Math.min(r.bottom,ch.bottom)-Math.max(r.top,ch.top),card=r.height>0&&vis>=0.6*Math.min(r.height,ch.height);
    const b=document.getElementById('answerBar'),br=b.getBoundingClientRect(),bar=!b.hidden&&br.height>0&&br.top>=0&&br.bottom<=innerHeight&&b.textContent.includes('Which colour should the focus ring use?');
    return {open:true,card,bar,either:card||bar}})()`);
  const scroll = async (where) => { await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=${where === 'top' ? 0 : 'c.scrollHeight'};c.dispatchEvent(new Event('scroll'));})()`); await ctx.sleep(120); await settle(); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await open(w, h);
    // FR-163: six compactions in a row are one line with a count, and its tooltip lists each
    const comp = await js(`[...document.querySelectorAll('#chat .note.cline')].map(n=>({t:n.textContent,title:n.title||''}))`);
    assert.strictEqual(comp.length, 1, `${w}: the compactions are one line: ${JSON.stringify(comp)}`);
    assert.match(comp[0].t, /^Context compacted 6 times · last .+: .+ → .+ tokens\.$/, `${w}: the line says how many and when`);
    assert.strictEqual(comp[0].title.split('\n').length, 6, `${w}: the tooltip lists each compaction: ${comp[0].title}`);
    assert.ok(!comp.some((c) => /Compacting the context/.test(c.t)), `${w}: no "Compacting…" line is left behind`);
    // FR-162: visible at the bottom and scrolled up
    await scroll('bottom');
    const atBottom = await seen();
    assert.ok(atBottom.open && atBottom.either, `${w}: at the bottom the question is visible: ${JSON.stringify(atBottom)}`);
    await scroll('top');
    const atTop = await seen();
    assert.ok(atTop.open && !atTop.card && atTop.bar, `${w}: scrolled up, the answer bar shows the question: ${JSON.stringify(atTop)}`);
    const bar = await js(`(()=>{const b=document.getElementById('answerBar');return {opts:[...b.querySelectorAll('.btn.ab-opt')].map(x=>x.textContent),box:!!b.querySelector('input.ab-other'),label:(b.querySelector('input.ab-other')||{getAttribute(){return ''}}).getAttribute('aria-label'),btns:[...b.querySelectorAll('button')].map(x=>x.textContent),
      focusable:[...b.querySelectorAll('button,input')].every(x=>x.tabIndex>=0&&!x.disabled),inside:[...b.querySelectorAll('button,input')].every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.height>0;})}})()`);
    assert.deepStrictEqual(bar.opts, ['Sage', 'Blue'], `${w}: the bar has the options: ${JSON.stringify(bar)}`);
    assert.ok(bar.box && bar.label === 'Other answer: Which colour should the focus ring use?', `${w}: the bar has a labelled Other answer box: ${JSON.stringify(bar)}`);
    assert.ok(bar.btns.includes('Skip') && bar.btns.includes('Show question'), `${w}: Skip and Show question: ${JSON.stringify(bar.btns)}`);
    assert.ok(bar.focusable && bar.inside, `${w}: every control of the bar is reachable and inside the window: ${JSON.stringify(bar)}`);
    if (w === 1440 || w === 1280) await shot(`052-question-bar-${w}x${h}.png`);
    // Show question: to the card, focus on its first option
    await js(`[...document.querySelectorAll('#answerBar button')].find(b=>b.textContent==='Show question').click()`); await ctx.sleep(150); await settle();
    const shown = await seen();
    assert.ok(shown.card && await js(`document.activeElement&&document.activeElement.classList.contains('q-opt')`), `${w}: Show question scrolls to the card and focuses an option: ${JSON.stringify(shown)}`);
    await until(`document.getElementById('answerBar').hidden`);
    // type in the bar's box; a change in the chat keeps it; Enter answers the card
    await scroll('top'); await until(`!!document.querySelector('#answerBar input.ab-other')`);
    await js(`document.querySelector('#answerBar input.ab-other').focus()`);
    ctx.win.webContents.insertText('Teal, like the links'); await ctx.sleep(80);
    await js(`(()=>{const d=document.createElement('div');const c=document.querySelector('#chat .note.cline');c.parentNode.appendChild(d);d.remove();})()`); await ctx.sleep(120);
    const kept = await js(`(()=>{const i=document.querySelector('#answerBar input.ab-other');return {v:i&&i.value,focus:document.activeElement===i}})()`);
    assert.ok(kept.v === 'Teal, like the links' && kept.focus, `${w}: what you type in the bar survives a change in the chat: ${JSON.stringify(kept)}`);
    // FR-177: a late title or a rename changes the name in the bar in place: the typed text and the focus stay
    const NEW = 'Renamed while you type: a different session name';
    await js(`window.__durbarSimRetitle(${jsLiteral(NEW)},'')`); await ctx.sleep(200);
    const ren = await js(`(()=>{const i=document.querySelector('#answerBar input.ab-other'),n=document.querySelector('#answerBar .ab-n');return {v:i&&i.value,focus:document.activeElement===i,name:n&&n.textContent,title:n&&n.title}})()`);
    assert.ok(ren.name === NEW && ren.title === NEW, `${w}: the bar shows the new name and title: ${JSON.stringify(ren)}`);
    assert.ok(ren.v === 'Teal, like the links' && ren.focus, `${w}: a rename keeps what you typed and the focus: ${JSON.stringify(ren)}`);
    const users0 = await js(`document.querySelectorAll('#chat .msg.user').length`);
    await H.key('Enter', [], { pause: 0 });
    await until(`!!document.querySelector('#chat .note.question.settled')`);
    const st = await js(`document.querySelector('#chat .note.question.settled .pstate').textContent`);
    assert.ok(st.includes('answered: Teal, like the links'), `${w}: Enter in the bar's box answered the card: ${st}`);
    // spec 052 FR-178 (issue 689): a custom answer is the answer, never a skip, and no ordinary user message follows it
    assert.ok(!st.includes('skipped'), `${w}: not skipped: ${st}`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .msg.user').length`), users0, `${w}: the custom answer is not sent as a message too`);
    await until(`document.getElementById('answerBar').hidden`);
    assert.ok(await js(`document.getElementById('answerBar').hidden`), `${w}: answered: the bar goes away`);
    // an option button in the bar answers too
    await open(w, h); await scroll('top'); await until(`!!document.querySelector('#answerBar .btn.ab-opt')`);
    await js(`[...document.querySelectorAll('#answerBar .btn.ab-opt')].find(b=>b.textContent==='Blue').click()`);
    await until(`!!document.querySelector('#chat .note.question.settled')`);
    const st2 = await js(`document.querySelector('#chat .note.question.settled .pstate').textContent`);
    assert.ok(/answered: Blue$/.test(st2.trim()), `${w}: the bar's option answered the card: ${st2}`);
    await until(`document.getElementById('answerBar').hidden`);
    // FR-178: the card's own Other box and Answer button, with a rename while typing: answered with exactly that text, no extra message
    await open(w, h); await scroll('bottom');
    const users1 = await js(`document.querySelectorAll('#chat .msg.user').length`);
    await js(`document.querySelector('#chat .note.question .q-other').focus()`);
    ctx.win.webContents.insertText('Teal  from the card');
    await until(`document.querySelector('#chat .note.question:not(.settled) .q-other').value==='Teal  from the card'`);
    await js(`window.__durbarSimRetitle('Renamed while typing in the card','')`);
    await until(`document.querySelector('#chat .note.question:not(.settled) .q-other').value==='Teal  from the card'&&document.activeElement===document.querySelector('#chat .note.question:not(.settled) .q-other')`);
    await js(`[...document.querySelectorAll('#chat .note.question:not(.settled) .note-actions .btn.primary')].find(b=>b.textContent==='Answer').click()`);
    await until(`!!document.querySelector('#chat .note.question.settled')`);
    const st3 = await js(`document.querySelector('#chat .note.question.settled .pstate').textContent`);
    assert.ok(/ → answered: Teal from the card$/.test(st3), `${w}: the card's Answer sent exactly the custom text: ${st3}`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .msg.user').length`), users1, `${w}: no ordinary user message follows the answer`);
    // FR-178: a skipped question says why in the card's tooltip (a code from the event, never text)
    await open(w, h); await scroll('bottom');
    await js(`[...document.querySelectorAll('#chat .note.question:not(.settled) .note-actions .btn.danger')].find(b=>b.textContent==='Skip').click()`);
    await until(`!!document.querySelector('#chat .note.question.settled')`);
    const sk = await js(`(()=>{const n=document.querySelector('#chat .note.question.settled');return {t:n.querySelector('.pstate').textContent,why:n.dataset.skipWhy,title:n.title}})()`);
    assert.ok(/skipped$/.test(sk.t) && sk.why === 'user' && sk.title === 'Skipped: you pressed Skip.', `${w}: Skip says why: ${JSON.stringify(sk)}`);
    // FR-178: several open questions at once, a cancelled event with a reason, an Aborted idle with two open, and a late cancelled for an answered card.
    // The simulator's bridge is stubbed to accept any answer (the sim only knows its own question), so the window's own handling is what is checked.
    await open(w, h); await scroll('bottom');
    const sid = await js(`window.__durbarSimUi.agents().find(a=>!a.parent&&a.question).id`);
    await js(`[...document.querySelectorAll('#chat .note.question:not(.settled) .note-actions .btn.danger')].find(b=>b.textContent==='Skip').click()`);
    await until(`!!document.querySelector('#chat .note.question.settled')`);
    await js(`window.__durbarSimUi.bridge().answerQuestion=async()=>({ok:true});0`);
    await js(`window.__qc=q=>[...document.querySelectorAll('#chat .note.question')].find(n=>n.querySelector('.q-text')&&n.querySelector('.q-text').textContent.includes(q));0`);
    const emitEv = (e) => js(`window.__durbarSimUi.emit(JSON.parse(${jsLiteral(JSON.stringify({ sessionId: sid, timestamp: Date.now(), ...e }))}))`);
    const ask = (rid, q, opts) => emitEv({ type: 'question', phase: 'asked', requestId: rid, questions: [{ question: q, multiSelect: false, options: opts.map((label) => ({ label })) }] });
    const ev = emitEv;
    const has = (q) => `!!window.__qc(${jsLiteral(q)})`;
    const done = (q) => `window.__qc(${jsLiteral(q)}).classList.contains('settled')`;
    const stateOf = (q) => js(`(()=>{const n=window.__qc(${jsLiteral(q)});return n?{settled:n.classList.contains('settled'),t:n.querySelector('.pstate').textContent,why:n.dataset.skipWhy||'',title:n.title,denied:n.classList.contains('denied')}:null})()`);
    const pick = async (q, label) => { await js(`(()=>{const n=window.__qc(${jsLiteral(q)});[...n.querySelectorAll('.q-opt')].find(b=>b.textContent.includes(${jsLiteral(label)})).click();[...n.querySelectorAll(':scope > .note-actions .btn.primary')].find(b=>b.textContent==='Answer').click();})()`); };
    // one limit end to end: the boxes take their length from MAX_ANSWER, and a combined answer over it is refused on the card, not sent cut
    const cap = await js(`window.exports.MAX_ANSWER`);
    assert.strictEqual(cap, 500, `${w}: the page has the limit`);
    const longOpt = (c) => c.repeat(200);
    await emitEv({ type: 'question', phase: 'asked', requestId: 'mq0', questions: [{ question: 'Pick many?', multiSelect: true, options: ['a', 'b', 'c'].map((c) => ({ label: longOpt(c) })) }] });
    await until(has('Pick many?'));
    assert.strictEqual(await js(`window.__qc('Pick many?').querySelector('.q-other').maxLength`), cap, `${w}: the card's box takes the limit`);
    await js(`(()=>{const n=window.__qc('Pick many?');n.querySelectorAll('.q-opt').forEach(b=>b.click());[...n.querySelectorAll(':scope > .note-actions .btn.primary')].find(b=>b.textContent==='Answer').click();})()`);
    await until(`/too long: 500 characters at most/.test(document.body.textContent)`);
    assert.ok(!(await stateOf('Pick many?')).settled, `${w}: an over-long answer is not sent and the card stays open`);
    await js(`(()=>{const n=window.__qc('Pick many?');n.querySelectorAll('.q-opt')[2].click();n.querySelectorAll('.q-opt')[1].click();[...n.querySelectorAll(':scope > .note-actions .btn.primary')].find(b=>b.textContent==='Answer').click();})()`);
    await until(done('Pick many?'));
    assert.ok(/answered: a{200}$/.test((await stateOf('Pick many?')).t), `${w}: under the limit it is sent whole`);
    // two open at once, answered out of order: each card gets its own answer; the other stays open
    await ask('mq1', 'Pick one?', ['A', 'B']); await ask('mq2', 'Pick two?', ['X', 'Y']);
    await until(has('Pick two?'));
    await pick('Pick two?', 'Y');
    await until(done('Pick two?'));
    const o2 = await stateOf('Pick two?'), o1 = await stateOf('Pick one?');
    assert.ok(/answered: Y$/.test(o2.t) && !o1.settled, `${w}: the answered card is settled, the other stays open: ${JSON.stringify({ o1, o2 })}`);
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(sid)}).state`), 'waiting', `${w}: still Waiting while one question is open`);
    await pick('Pick one?', 'A');
    await until(done('Pick one?'));
    assert.ok(/answered: A$/.test((await stateOf('Pick one?')).t), `${w}: the first card got its own answer`);
    // a cancelled event with a reason: the tooltip says it
    await ask('mq3', 'Cancelled one?', ['A']);
    await until(has('Cancelled one?'));
    await ev({ type: 'question', phase: 'cancelled', requestId: 'mq3', reason: 'reconnect' });
    await until(done('Cancelled one?'));
    const c3 = await stateOf('Cancelled one?');
    assert.ok(/skipped$/.test(c3.t) && c3.why === 'reconnect' && c3.title === 'Skipped: the agent app was reconnected.', `${w}: the reason is in the tooltip: ${JSON.stringify(c3)}`);
    // an Aborted idle with two open settles both, with the window's own reason
    await ask('mq4', 'Abort one?', ['A']); await ask('mq5', 'Abort two?', ['A']);
    await until(has('Abort two?'));
    await ev({ type: 'status', status: 'idle', intent: 'Aborted' });
    await until(done('Abort one?')); await until(done('Abort two?'));
    const a1 = await stateOf('Abort one?'), a2 = await stateOf('Abort two?');
    assert.ok([a1, a2].every((x) => /skipped$/.test(x.t) && x.why === 'aborted' && x.title === 'Skipped: the agent app reported the turn as aborted.'), `${w}: both skipped as aborted: ${JSON.stringify({ a1, a2 })}`);
    // a late cancelled for a card already answered: the card is corrected to skipped, with its reason
    await ask('mq6', 'Late one?', ['A', 'B']);
    await until(has('Late one?'));
    await pick('Late one?', 'B');
    await until(done('Late one?'));
    assert.ok(/answered: B$/.test((await stateOf('Late one?')).t), `${w}: answered first`);
    await ev({ type: 'question', phase: 'cancelled', requestId: 'mq6', reason: 'stop' });
    await until(`/skipped$/.test(window.__qc(${jsLiteral('Late one?')}).querySelector('.pstate').textContent)`);
    const l6 = await stateOf('Late one?');
    assert.ok(l6.denied && l6.why === 'stop' && l6.title === 'Skipped: the turn was stopped.', `${w}: a late cancelled corrects the card: ${JSON.stringify(l6)}`);
    console.log('[question-visible]', w, 'ok');
  }
  console.log('[question-visible] all checks passed');
};
