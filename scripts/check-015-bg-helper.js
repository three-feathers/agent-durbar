/*
 * Check for spec 015 FR-018/FR-019 (issue #1141): a helper started in the background stays Running until its own end event, though its
 * parent's call returned at once. Simulator only (no AI credits).
 *
 *   node scripts/ui-suite.js --only check-015-bg-helper
 *
 * At 1440x900, 3 agents, `simhelpers=2`, `simbghelper=1` (the first still-working helper is launched in the background: its `task` call
 * completes at once with a launch note):
 *   1. that helper's record, its block in the parent chat and its helper card all say Running, its result is not the launch note;
 *      its own transcript (opened from the card) says Running;
 *   2. its own `subagent` completed event ends it: Done in the record, block, card and transcript;
 *   3. driver-made helpers on another agent: a background one whose call returns stays Running, and the session stopping ends it as
 *      Failed ("Stopped with its session"); a foreground one (no `background`) still ends when its call returns (the existing rule);
 *      a failed launch call ends a background one as Failed.
 *   4. spec 015 FR-021 (issue 1330): a driver-made helper with a hostile name and task (fake token, homes, UNC) shows none of it in the
 *      flat tile (name, tooltip, aria-label), its chat block, the Sub-agent activity panel (title, task line, error line) or anywhere else.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const q = jsLiteral;
const LAUNCH = 'Agent started in the background.';
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign({timestamp:Date.now()},${q(e)}))`);
  /* one read of everything a helper shows: its record, its block in the parent chat, its helper card (model and office) */
  const view = (cardId) => js(`(()=>{const h=window.__durbarSimUi.agents().find(x=>x.id===${q(cardId)}),s=h&&h.sub;
    const el=document.querySelector('#stage .helper[data-id="'+CSS.escape(${q(cardId)})+'"]');
    return {rec:!!s,status:s&&s.status,bg:!!(s&&s.background),result:s?String(s.result||''):'',error:s?String(s.error||''):'',cardState:h&&h.state,
      block:s&&s.block&&s.block.el?['running','done','failed'].filter(c=>s.block.el.classList.contains(c)).join():'',
      blockSt:s&&s.block&&s.block.el?((s.block.el.querySelector('.sub-st')||{}).textContent||''):'',office:el?(el.dataset.state||el.className):'(no card)'}})()`);
  await H.load({ w: 1440, h: 900, query: { sim: '3', simrooms: '1', simhelpers: '2', simbghelper: '1' }, ready: 'fit' });
  const find = `((window.__durbarSimUi.agents().find(a=>a.sub&&a.sub.background))||{}).id||''`;
  assert.ok(await until(`!!${find}`, 15000), 'simbghelper=1: the simulator made a background helper');
  const bg = await js(find);

  /* 1. Running everywhere though the call returned */
  const v1 = await view(bg);
  assert.ok(v1.status === 'running' && v1.cardState !== 'done' && v1.cardState !== 'error', `background helper: the returned call ended it ${JSON.stringify(v1)}`);
  assert.ok(v1.block === 'running' && /Running/.test(v1.blockSt), `background helper: its block in the parent chat is not Running ${JSON.stringify(v1)}`);
  assert.ok(!v1.result.includes(LAUNCH), `background helper: the launch note became its result ${JSON.stringify(v1)}`);
  assert.ok(!/done/.test(v1.office), `background helper: its office card reads done ${JSON.stringify(v1)}`);
  const card = `#stage .helper[data-id="${bg.replace(/"/g, '')}"]`;
  assert.ok(await until(`!!document.querySelector(${q(card)})`, 8000), `background helper: no helper card in the office (${bg})`);
  await js(`document.querySelector(${q(card)}).click()`);
  assert.ok(await until(`!!document.querySelector('.sub-full-head .sub-st')`, 8000), 'background helper: its transcript did not open');
  const t1 = await js(`document.querySelector('.sub-full-head .sub-st').textContent`);
  assert.strictEqual(t1, 'Running', `background helper: its transcript says ${t1}`);

  /* 2. its own end event ends it */
  const [parent, call] = [bg.slice(0, bg.indexOf(':')), bg.slice(bg.indexOf(':') + 1)];
  await emit({ sessionId: parent, type: 'output', agentId: call, delta: '', final: true, text: 'Checked: nothing to change.' });
  await emit({ sessionId: parent, type: 'subagent', subagentId: call, phase: 'completed', durationMs: 4000, totalTokens: 900, totalToolCalls: 2 });
  assert.ok(await until(`(document.querySelector('.sub-full-head .sub-st')||{}).textContent==='Done'`, 6000), 'background helper: its transcript did not say Done after its own end');
  const v2 = await view(bg);
  assert.ok(v2.status === 'done' && v2.cardState === 'done' && v2.block === 'done', `background helper: its own end did not end it ${JSON.stringify(v2)}`);
  await H.key('Escape');
  await until(`!document.body.classList.contains('panel-open')`, 6000);

  /* 3. driver-made helpers on the second agent */
  const P = await js(`(window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[1]||{}).id||''`);
  assert.ok(P, 'a second agent');
  const start = async (id, background) => {
    await emit({ sessionId: P, type: 'toolCall', callId: id, tool: 'task', phase: 'start', args: { description: 'Look around', prompt: 'Look around and report' } });
    await emit({ sessionId: P, type: 'subagent', subagentId: id, phase: 'started', task: 'Look around', ...(background ? { background: true } : {}) });
  };
  await start('bg-stop', true);
  await emit({ sessionId: P, type: 'toolCall', callId: 'bg-stop', tool: 'task', phase: 'complete', output: LAUNCH });
  await emit({ sessionId: P, type: 'status', status: 'idle' }); /* the parent's turn ends; the helper goes on */
  const v3 = await view(P + ':bg-stop');
  assert.ok(v3.status === 'running' && v3.block === 'running' && v3.cardState !== 'done' && !v3.result.includes(LAUNCH), `driver background helper: the returned call or the idle turn ended it ${JSON.stringify(v3)}`);
  await start('fg', false);
  await emit({ sessionId: P, type: 'toolCall', callId: 'fg', tool: 'task', phase: 'complete', output: 'All fine.' });
  const v4 = await view(P + ':fg');
  assert.ok(v4.status === 'done' && v4.result === 'All fine.' && v4.cardState === 'done', `foreground helper: its returned call no longer ends it ${JSON.stringify(v4)}`);
  await start('bg-fail', true);
  await emit({ sessionId: P, type: 'toolCall', callId: 'bg-fail', tool: 'task', phase: 'failed', output: 'Could not start the agent' });
  const v5 = await view(P + ':bg-fail');
  assert.ok(v5.status === 'failed' && v5.cardState === 'error', `background helper: a failed launch did not end it ${JSON.stringify(v5)}`);
  await emit({ sessionId: P, type: 'status', status: 'stopped' });
  const v6 = await view(P + ':bg-stop');
  assert.ok(v6.status === 'failed' && v6.error === 'Stopped with its session' && v6.block === 'failed' && v6.cardState === 'error', `background helper: the session stopped and it still runs ${JSON.stringify(v6)}`);
  const v7 = await view(P + ':fg');
  assert.ok(v7.status === 'done', `the session stop changed a finished helper ${JSON.stringify(v7)}`);
  /* 4. spec 015 FR-021 (issue 1330): a hostile helper name and task (fake token, macOS, Windows and UNC homes) show nowhere: the flat
     tile (name, tooltip, aria-label), the chat block, the Sub-agent activity panel (title, task line, error line) and the chat header */
  const P3 = await js(`(window.__durbarSimUi.agents().filter(a=>!a.parent&&a.live)[2]||{}).id||''`);
  assert.ok(P3, 'a third agent');
  const TOK = 'ghp_' + 'Zq9Xw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe9Dc8';
  const HNAME = 'Scan \\\\fs01\\homes\\zedq\\notes and /Users/zedq/proj';
  const HTASK = 'Use ' + TOK + ' in \\\\fs01\\homes\\zedq\\notes, C:\\Users\\Jürgen Smith\\proj, \\\\fs01\\homes\\Ölçü\\notes, ' + JSON.stringify('C:\\Users\\Jürgen\\proj') + ', C:\\Users\\zedq\\proj and /Users/zoë/a.txt';
  const LEAKS = [TOK.slice(4), 'zedq', 'fs01', 'Jürgen', 'Smith', 'Ölçü', 'zoë'];
  await emit({ sessionId: P3, type: 'toolCall', callId: 'leak', tool: 'task', phase: 'start', args: { description: HTASK, prompt: 'Look around and report' } });
  await emit({ sessionId: P3, type: 'subagent', subagentId: 'leak', phase: 'started', name: HNAME, task: HTASK });
  const hid = P3 + ':leak', tile = `#stage .helper[data-id="${hid}"]`;
  /* every text and attribute of the page and of the helper's chat block (its parent's chat may be off the page) */
  const seen = () => js(`(()=>{const out=[];const walk=r=>{if(!r)return;out.push(r.textContent||'');r.querySelectorAll('*').forEach(el=>{for(const at of el.attributes)out.push(at.value);});};
    walk(document.body);const h=window.__durbarSimUi.agents().find(x=>x.id===${q(hid)}),s=h&&h.sub;walk(s&&s.block&&s.block.el);
    out.push(h?String(h.name)+' '+String(h.task||''):'');return out.join('\\n');})()`);
  const leaks = async (where) => { const t = await seen(); const f = LEAKS.filter((w) => t.includes(w)); assert.deepStrictEqual(f, [], `${where}: a helper's name or task shows unmasked (${f.join(', ')})`); };
  if (!(await until(`!!document.querySelector(${q(tile)})`, 4000))) await js(`(document.querySelector('[data-more="'+CSS.escape(${q(P3)})+'"]')||{click(){}}).click()`);
  assert.ok(await until(`!!document.querySelector(${q(tile)})`, 8000), `hostile helper: no helper card in the office (${hid})`);
  assert.ok(await until(`/\\[redacted\\]/.test(document.querySelector(${q(tile)}).getAttribute('aria-label')||'')`, 6000), 'hostile helper: the tile aria-label does not show the masked task');
  await leaks('office');
  await js(`document.querySelector(${q(tile)}).click()`);
  assert.ok(await until(`/^Use /.test((document.querySelector('.sub-full-task')||{}).textContent||'')`, 8000), 'hostile helper: the Sub-agent activity panel did not open with its task');
  await leaks('Sub-agent activity panel');
  const pv = await js(`({h3:document.querySelector('.sub-full-head h3').textContent,task:document.querySelector('.sub-full-task').textContent})`);
  /* the rest of the words stay (a `~` can go with the desk mask's Markdown pass when a token is there too: no leak) */
  assert.ok(/^Scan .*notes and .*proj$/.test(pv.h3) && /^Use \[redacted\] in .*notes, .*proj and .*a\.txt$/.test(pv.task), `hostile helper: the panel lost the rest of the words ${JSON.stringify(pv)}`);
  await emit({ sessionId: P3, type: 'subagent', subagentId: 'leak', phase: 'failed', task: HTASK }); /* no error text: the task becomes the error line */
  assert.ok(await until(`/Failed: /.test((document.querySelector('.sub-full .sub-err')||{}).textContent||'')`, 6000), 'hostile helper: the panel error line did not show');
  await leaks('Sub-agent activity panel, failed');
  await H.key('Escape');
  await until(`!document.body.classList.contains('panel-open')`, 6000);
  await leaks('office, failed');
  console.log('[015-bg-helper] all checks passed');
};
