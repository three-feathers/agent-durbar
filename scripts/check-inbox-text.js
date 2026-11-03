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
  await js(`window.__durbarSimUi.emit({type:'question',phase:'asked',sessionId:${jsLiteral(qid)},timestamp:Date.now(),requestId:'zq-'+Date.now(),questions:[{question:'First zzone question?',multiSelect:false,options:[{label:'a'},{label:'b'}]},{question:'Second zztwo question?',multiSelect:false,options:[{label:'c'},{label:'d'}]}]})`);
  await settle();
  await js(`document.getElementById('inboxBtn').click()`);
  assert.ok(await until(`[...document.querySelectorAll('#inboxDlg .ib-t')].some(p=>/zzdemo/.test(p.textContent))&&[...document.querySelectorAll('#inboxDlg .ib-t')].some(p=>/zzone/.test(p.textContent))`, 8000), 'the inbox rows show both requests');
  const r = await js(`[...document.querySelectorAll('#inboxDlg .ib-t')].map(p=>({text:p.textContent}))`);
  const perm = r.find((c) => /zzdemo/.test(c.text)), q = r.find((c) => /zzone/.test(c.text));
  assert.strictEqual(perm.text, 'Write to /tmp/zzdemo/a.txt If you approve, Codex may run this outside its sandbox. Allow for this session covers every file in /tmp/zzdemo, not only this one.', 'each block of the card is apart from the next');
  assert.strictEqual(q.text, 'First zzone question? Second zztwo question?', 'both questions are in the row, apart');
  for (const c of r) assert.ok(!/Allow once|\bDeny\b/.test(c.text), 'no button label in: ' + c.text);
  console.log('check-inbox-text: all checks passed', JSON.stringify(r.map((c) => c.text.slice(0, 120))));
};
