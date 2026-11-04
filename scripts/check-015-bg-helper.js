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
  console.log('[015-bg-helper] all checks passed');
};
