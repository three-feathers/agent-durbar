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
    ctx.win.webContents.insertText('Teal  from the card'); await ctx.sleep(80);
    await js(`window.__durbarSimRetitle('Renamed while typing in the card','')`); await ctx.sleep(150);
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
    console.log('[question-visible]', w, 'ok');
  }
  console.log('[question-visible] all checks passed');
};
