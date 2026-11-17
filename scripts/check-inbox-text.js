/*
 * Check for spec 052 FR-214: the text of a Needs you card never runs words together ("search_companies)Allow for this session").
 * Simulator only (no AI credits).   npm run check:ui -- --only check-inbox-text
 *
 * The inbox row, the answer bar, the announcements and the Real office slips all read requestText() (app.js). This driver reads the
 * inbox row (the only surface it queries) of two pending cards in the simulator's chats:
 *  - a write permission with a session scope hint and a sandbox note: its blocks must be separated by a space, checked against exact
 *    expected sentences (no regex that a join of two blocks could hide in);
 *  - a question with two questions: both must be in the row.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = process.env.QPARTS_MUTANT || ''; // inbox | src | bar: the text as main built it, read by that one check (the inbox row, the source of requestRaw, the bar); each is killed at its own label
const glue = (t, who) => (M === who ? t.replace(/(Part one|Part two|Focus ring|Screens): /g, '$1 ').replace(/ \/ /g, ' ') : t);
const { helpers, jsLiteral } = require('./driver-helpers');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  await H.load({ w: 1440, h: 900, focus: true, query: { simquestion: 'compact' }, ready: 'fit' });
  // a write permission with a session scope and a sandbox note: the blocks that sat run together
  await js(`window.__durbarSimUi.emit({type:'status',sessionId:'sim-2',timestamp:Date.now(),status:'needs-permission',intent:'Edit a file',permission:{requestId:'t-'+Date.now(),kind:'write',summary:'Write to /tmp/zzdemo/a.txt',scopeKey:'write:/tmp/zzdemo',scopeLabel:'write in /tmp/zzdemo',state:'pending',sandboxNote:'If you approve, Codex may run this outside its sandbox.'}})`);
  const opened = await H.openSimAgent("a=>a.id==='sim-2'", '#chat .note.perm');
  assert.ok(opened.ok, 'an agent has a permission card in its chat: ' + JSON.stringify({ id: opened.id, ...opened.seen }));
  // the simulator's own question agent: settle its one-question card, then ask two questions at once
  const qid = await js(`window.__durbarSimUi.agents().find(a=>!a.parent&&a.question).id`);
  const opened3 = await H.openSimAgent(`a=>a.id===${jsLiteral(qid)}`, '#chat .note.question');
  assert.ok(opened3.ok, 'the question agent opens: ' + JSON.stringify({ id: opened3.id, ...opened3.seen }));
  await js(`window.__durbarSimUi.bridge().answerQuestion=async()=>({ok:true});[...document.querySelectorAll('#chat .note.question:not(.settled) .note-actions .btn.danger')].find(b=>b.textContent==='Skip').click();0`);
  assert.ok(await until(`!!document.querySelector('#chat .note.question.settled')`), 'its card is skipped');
  await js(`window.__durbarSimUi.emit({type:'question',phase:'asked',sessionId:${jsLiteral(qid)},timestamp:Date.now(),requestId:'zq-'+Date.now(),questions:[{question:'First zzone question?',header:'Part one',multiSelect:false,options:[{label:'a'},{label:'b'}]},{question:'Second zztwo question?',header:'Part two',multiSelect:false,options:[{label:'c'},{label:'d'}]}]})`);
  await settle();
  await js(`document.getElementById('inboxBtn').click()`);
  assert.ok(await until(`[...document.querySelectorAll('#inboxDlg .ib-t')].some(p=>/zzdemo/.test(p.textContent))&&[...document.querySelectorAll('#inboxDlg .ib-t')].some(p=>/zzone/.test(p.textContent))`, 8000), 'the inbox rows show both requests');
  const r = (await js(`[...document.querySelectorAll('#inboxDlg .ib-t')].map(p=>({text:p.textContent}))`)).map((c) => ({ text: glue(c.text, 'inbox') }));
  const perm = r.find((c) => /zzdemo/.test(c.text)), q = r.find((c) => /zzone/.test(c.text));
  assert.strictEqual(perm.text, 'Write to /tmp/zzdemo/a.txt If you approve, Codex may run this outside its sandbox. Allow for this session covers every file in /tmp/zzdemo, not only this one.', 'each block of the card is apart from the next');
  assert.strictEqual(q.text, 'Part one: First zzone question? / Part two: Second zztwo question?', 'both questions are in the row, each with its heading, the parts apart (spec 005 FR-339)');
  for (const c of r) assert.ok(!/Allow once|\bDeny\b/.test(c.text), 'no button label in: ' + c.text);
  // the one builder: requestRaw (behind requestText, which the bar, the inbox and the strip's folded rows read) joins the parts with joinQuestionParts
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n').replace(M === 'src' ? /joinQuestionParts\(qs\.map/g : /$^/g, '(qs.map');
  assert.ok(/function requestRaw\([^\n]*qs\.length\?joinQuestionParts\(qs\.map/.test(appSrc), 'requestRaw builds a question card text with joinQuestionParts (the parts apart)');
  // spec 005 FR-339 (issue #1754): the answer bar of the simulator's own two-part question (headings Focus ring and Screens) keeps the parts apart
  const EXPECT = 'Focus ring: Which colour should the focus ring use? / Screens: Which screens should get it first?';
  // the Retro arcade and the Photo office, at both sizes (OUT=dir also saves the pictures)
  for (const [look, lq] of [['arcade', { officeview: 'real', worldflags: 'retro', world: 'retro' }], ['photo', { officeview: 'real', world: 'photo' }]]) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, focus: true, query: { simquestion: '1', ...lq }, ready: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'` });
    // the question agent's own plate (the drawn office has plates, not desks)
    const nm = await until(`(()=>{const a=window.__durbarSimUi&&window.__durbarSimUi.agents().find(x=>!x.parent&&x.question);return !!a&&[...document.querySelectorAll('#stage .ro-plate')].some(p=>p.textContent.startsWith(a.name))})()`, 20000);
    assert.ok(nm, `${look} ${w}: the question agent has a plate`);
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.question);[...document.querySelectorAll('#stage .ro-plate')].find(p=>p.textContent.startsWith(a.name)).click();0})()`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.question:not(.settled) .q-opt')`, 15000), `${look} ${w}: the two-part question is in the chat`);
    await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=0;c.dispatchEvent(new Event('scroll'));})()`);
    assert.ok(await until(`(()=>{const b=document.getElementById('answerBar');return !b.hidden&&b.textContent.includes('Focus ring')})()`, 8000), `${look} ${w}: the answer bar shows the two-part question`);
    await settle();
    const bar = await js(`(()=>{const q=document.querySelector('#answerBar .ab-q > span'),b=document.querySelector('#answerBar .ab-q'),r=document.getElementById('answerBar').getBoundingClientRect();return {q:q.textContent,fs:parseFloat(getComputedStyle(q).fontSize),inside:r.top>=0&&r.bottom<=innerHeight}})()`);
    assert.strictEqual(glue(bar.q, 'bar'), EXPECT, `${look} ${w}: the answer bar keeps each heading with its question and the two parts apart: ` + bar.q);
    assert.ok(bar.fs >= 10.5, `${look} ${w}: the bar text is 10.5px or more: ` + bar.fs);
    assert.ok(bar.inside, `${look} ${w}: the bar is inside the window`);
    if (process.env.OUT) await H.shot(path.join(process.env.OUT, `052-1754-answer-bar-${look}-${w}x${h}.png`), { prep: 'mouse', tag: 'answer-bar-parts' });
  }
  console.log('check-inbox-text: all checks passed', JSON.stringify(r.map((c) => c.text.slice(0, 120))));
};
