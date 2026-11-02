/*
 * Check for spec 052 FR-214: the text of a Needs you card never runs words together ("search_companies)Allow for this session").
 * Simulator only (no AI credits).   npm run check:ui -- --only check-inbox-text
 *
 * The inbox row, the answer bar and the announcements read requestText() (app.js). For every pending card in the simulator's chats the
 * text must hold no letter-or-bracket stuck to a capital that starts the next block, and no label of the card's own buttons.
 */
const assert = require('assert');
const { helpers } = require('./driver-helpers');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  await H.load({ w: 1440, h: 900, focus: true });
  // a pending request with a session scope and a sandbox note: the blocks that sat run together
  await js(`window.__durbarSimUi.emit({type:'status',sessionId:'sim-2',timestamp:Date.now(),status:'needs-permission',intent:'Run a tool',permission:{requestId:'t-'+Date.now(),kind:'shell',summary:'Run mcp tool (search_companies)',scopeKey:'mcp:search_companies',scopeLabel:'search_companies',state:'pending',sandboxNote:'If you approve, Codex may run this outside its sandbox.'}})`);
  const opened = await H.openSimAgent("a=>a.id==='sim-2'", '#chat .note.perm');
  assert.ok(opened.ok, 'an agent has a permission card in its chat: ' + JSON.stringify({ id: opened.id, ...opened.seen }));
  await settle();
  const r = [];
  await js(`document.getElementById('inboxBtn').click()`);
  assert.ok(await until(`[...document.querySelectorAll('#inboxDlg .ib-t')].some(p=>/search_companies/.test(p.textContent))`, 8000), 'the inbox row shows the request');
  r.push(...(await js(`[...document.querySelectorAll('#inboxDlg .ib-t')].map(p=>({text:p.textContent}))`)));
  assert.ok(r.length > 0, 'there is a card to read');
  for (const c of r) {
    assert.ok(!/[a-z0-9)\]][A-Z][a-z]/.test(c.text.replace(/\b[a-z]+[A-Z][a-z]+\b/g, '')), 'no run-together words in: ' + c.text);
    assert.ok(!/Allow once|\bDeny\b/.test(c.text), 'no button label in: ' + c.text);
  }
  console.log('check-inbox-text: all checks passed', JSON.stringify(r.map((c) => c.text.slice(0, 120))));
};
