/** Spec 041 T014 (FR-011, D-c): the office's state word and sub-label from normalized events, one table row per renderer rule. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateTracker, applySetPaused } from '../src/main/mcp/agentstate';
import type { AgentEvent } from '../src/adapters/types';

const ID = 'a1';
const T = 1;
type Spec = Record<string, unknown>;
const ev = (o: Spec): AgentEvent => ({ sessionId: ID, timestamp: T, ...o }) as unknown as AgentEvent;
const status = (s: string, extra: Spec = {}): AgentEvent => ev({ type: 'status', status: s, ...extra });
const working = status('working');
const think = ev({ type: 'thinking', delta: 'x' });
const out = ev({ type: 'output', text: 'hi' });
const toolStart = (tool = 'view', extra: Spec = {}): AgentEvent => ev({ type: 'toolCall', phase: 'start', callId: 'c1', tool, ...extra });
const toolDone = ev({ type: 'toolCall', phase: 'complete', callId: 'c1', tool: 'view' });
const perm = status('needs-permission', { permission: { requestId: 'p1', kind: 'write', summary: 's', state: 'pending' } });
const limitHit = ev({ type: 'limit', phase: 'exhausted', requestId: 'l1', maxAiCredits: 5 });
const send = (t: AgentStateTracker): void => t.noteSend(ID);
const sendFailed = (t: AgentStateTracker): void => t.noteSendFailed(ID);
const asked = ev({ type: 'question', phase: 'asked', requestId: 'q1', questions: [] });

type Step = AgentEvent | ((t: AgentStateTracker) => void);
interface Row { rule: string; lazy?: boolean; events: Step[]; word: string; sub: string | null; paused?: boolean; renderer: string[] }
/** `renderer`: fragments of src/renderer/app.js this row copies; the drift guard below checks each is still there. */
const ROWS: Row[] = [
  { rule: 'new agent: Idle', events: [], word: 'Idle', sub: null, renderer: ["state:'idle',label:info.lazy?'Not started':null"] },
  { rule: 'restored folder, no session yet: Idle, Not started', lazy: true, events: [], word: 'Idle', sub: 'Not started', renderer: [] },
  { rule: 'status working: Working', events: [working], word: 'Working', sub: null, renderer: ["if(a.state!=='working'&&a.state!=='thinking')setState(a,'working',null,"] },
  { rule: 'status working keeps Thinking', events: [think, working], word: 'Thinking', sub: null, renderer: [] },
  { rule: 'status working while Waiting: Working (not already working)', events: [perm, working], word: 'Working', sub: null, renderer: [] },
  { rule: 'output: Working', events: [out], word: 'Working', sub: null, renderer: ["case 'output':{", "setState(a,'working',null);return;}"] },
  { rule: 'thinking: Thinking', events: [think], word: 'Thinking', sub: null, renderer: ["case 'thinking':{", "setState(a,'thinking',null);return;}"] },
  { rule: 'toolCall start while Thinking: Working', events: [think, toolStart()], word: 'Working', sub: null, renderer: ["setState(a,a.state==='thinking'?'working':a.state,null,"] },
  { rule: 'toolCall start while Working: stays Working', events: [out, toolStart()], word: 'Working', sub: null, renderer: [] },
  { rule: 'toolCall start while Waiting: stays Waiting (permission)', events: [perm, toolStart()], word: 'Waiting', sub: null, renderer: [] },
  { rule: 'toolCall start while Waiting at the limit: still Waiting, sub-label cleared (setState passes null)', events: [limitHit, toolStart()], word: 'Waiting', sub: null, renderer: [] },
  { rule: 'toolCall start while Idle: stays Idle (label cleared)', events: [toolStart()], word: 'Idle', sub: null, renderer: [] },
  { rule: 'toolCall start while Done: stays Done (label cleared)', events: [working, status('idle'), toolStart()], word: 'Done', sub: null, renderer: [] },
  { rule: 'toolCall update/complete change nothing', events: [think, toolDone], word: 'Thinking', sub: null, renderer: ["e.phase==='start'&&!isTaskTool(e.tool)"] },
  { rule: 'task tool start is the sub-agent card, not the main state', events: [think, toolStart('task'), toolStart('agent')], word: 'Thinking', sub: null, renderer: ["const isTaskTool=t=>t==='task'||t==='agent';"] },
  { rule: 'needs-permission: Waiting', events: [perm], word: 'Waiting', sub: null, renderer: ["setState(a,'waiting',null,e.intent||'Waiting for permission')"] },
  { rule: 'idle after work: Done, Done', events: [working, status('idle')], word: 'Done', sub: 'Done', renderer: ["setState(a,'done','Done',"] },
  { rule: 'idle with no work: Idle', events: [status('idle')], word: 'Idle', sub: null, renderer: ["else setState(a,'idle',null,a.task)"] },
  { rule: 'idle twice: second one finds no work, Idle', events: [working, status('idle'), status('idle')], word: 'Idle', sub: null, renderer: [] },
  { rule: 'idle with intent Aborted: Idle (not Done)', events: [working, status('idle', { intent: 'Aborted' })], word: 'Idle', sub: null, renderer: ["e.status==='idle'&&e.intent==='Aborted'", "setState(a,'idle',null,'Stopped. Ready for your next message.')"] },
  { rule: 'idle after an Aborted turn is Idle (worked cleared)', events: [working, status('idle', { intent: 'Aborted' }), status('idle')], word: 'Idle', sub: null, renderer: [] },
  { rule: 'status error: Error', events: [status('error', { intent: 'boom' })], word: 'Error', sub: null, renderer: ["setState(a,'error',null,SHORT(e.intent||'Error',140))"] },
  { rule: 'status stopped: Idle, Ended', events: [working, status('stopped')], word: 'Idle', sub: 'Ended', renderer: ["setState(a,'idle','Ended',"] },
  { rule: 'limit exhausted: Waiting, Limit reached', events: [working, limitHit], word: 'Waiting', sub: 'Limit reached', renderer: ["setState(a,'waiting','Limit reached',"] },
  { rule: 'limit exhausted again with the same request: unchanged', events: [limitHit, toolStart(), limitHit], word: 'Waiting', sub: null, renderer: ["if(a.limit&&a.limit.requestId===e.requestId)return;showLimit"] },
  { rule: 'limit resolved (add): Working', events: [limitHit, ev({ type: 'limit', phase: 'resolved', requestId: 'l1', action: 'add' })], word: 'Working', sub: null, renderer: ["else setState(a,'working',null,'Continuing after '+what)"] },
  { rule: 'limit resolved (cancel): Idle', events: [working, limitHit, ev({ type: 'limit', phase: 'resolved', requestId: 'l1', action: 'cancel' })], word: 'Idle', sub: null, renderer: ["setState(a,'idle',null,'Stopped at '+what+'."] },
  { rule: 'limit resolved for another request: ignored', events: [limitHit, ev({ type: 'limit', phase: 'resolved', requestId: 'zzz', action: 'add' })], word: 'Waiting', sub: 'Limit reached', renderer: ["settleLimit(a,e.action||'add')"] },
  { rule: 'limit changed: no state change', events: [out, ev({ type: 'limit', phase: 'changed', maxAiCredits: 9 })], word: 'Working', sub: null, renderer: [] },
  { rule: 'question asked: Waiting', events: [working, asked], word: 'Waiting', sub: null, renderer: ["setState(a,'waiting',null,'The agent asks you a question')"] },
  { rule: 'question answered: Working', events: [asked, ev({ type: 'question', phase: 'answered', requestId: 'q1', answers: {} })], word: 'Working', sub: null, renderer: ["if(a.state==='waiting')setState(a,'working',null,"] },
  { rule: 'question cancelled: Working', events: [asked, ev({ type: 'question', phase: 'cancelled', requestId: 'q1' })], word: 'Working', sub: null, renderer: [] },
  { rule: 'question answered after a Stop set it Idle: stays Idle (only when waiting)', events: [asked, status('idle', { intent: 'Aborted' }), ev({ type: 'question', phase: 'answered', requestId: 'q1', answers: {} })], word: 'Idle', sub: null, renderer: [] },
  { rule: 'helper status/output/thinking/tool events are ignored', events: [out, ev({ type: 'status', status: 'error', agentId: 'sub1' }), ev({ type: 'thinking', agentId: 'sub1' }), ev({ type: 'toolCall', phase: 'start', tool: 'x', callId: 'z', agentId: 'sub1' }), ev({ type: 'status', status: 'idle', agentId: 'sub1' })], word: 'Working', sub: null, renderer: ["if(e.agentId&&e.type!=='permission'&&e.type!=='grants'&&e.type!=='limit')return onSubEvent(a,e);"] },
  { rule: 'subagent, usage, context, model, title, mcp events change nothing', events: [out, ev({ type: 'subagent', phase: 'started', subagentId: 's' }), ev({ type: 'usage' }), ev({ type: 'context', tokens: 1, limit: 2 }), ev({ type: 'model', model: 'm', cause: 'user' }), ev({ type: 'title', title: 't' }), ev({ type: 'mcp', servers: [] }), ev({ type: 'permission', permission: {} }), ev({ type: 'grants', grants: [] })], word: 'Working', sub: null, renderer: [] },
  { rule: 'paused hides the state: Paused, no sub-label', events: [out], word: 'Paused', sub: null, paused: true, renderer: ["const vis = a => a.paused ? 'idle' : a.state;", "a.paused ? 'Paused' : (a.label || LABELS[a.state])"] },
  { rule: 'user send while Idle: Thinking, sub-label cleared', events: [send], word: 'Thinking', sub: null, renderer: ["a.worked=true; a.intent=''; closeTurn(a); ensureTurn(a); setState(a,'thinking',null,'Thinking');"] },
  { rule: 'user send on a not-started folder: Thinking', lazy: true, events: [send], word: 'Thinking', sub: null, renderer: [] },
  { rule: 'user send, then status working: Thinking stays (already thinking)', events: [send, working], word: 'Thinking', sub: null, renderer: [] },
  { rule: 'user send, then output: Working', events: [send, out], word: 'Working', sub: null, renderer: [] },
  { rule: 'user send, then a tool starts: Working', events: [send, toolStart()], word: 'Working', sub: null, renderer: [] },
  { rule: 'user send while Waiting: Thinking (sendLive sets it from any state)', events: [perm, send], word: 'Thinking', sub: null, renderer: [] },
  { rule: 'user send while at the limit: Thinking, sub-label cleared', events: [limitHit, send], word: 'Thinking', sub: null, renderer: [] },
  { rule: 'user send then idle: Done (the send counts as work)', events: [send, status('idle')], word: 'Done', sub: 'Done', renderer: [] },
  { rule: 'send failed: Error', events: [send, sendFailed], word: 'Error', sub: null, renderer: ["setState(a,'error',null,'Send failed: '+SHORT(r.error,100))"] },
  { rule: 'stopped during a pending limit clears the work flag: a later idle is Idle, not Done', events: [working, limitHit, status('stopped'), status('idle')], word: 'Idle', sub: null, renderer: ["if(a.limit)settleLimit(a,'cancel');"] },
  { rule: 'stopped with no limit pending keeps the work flag: a later idle is Done', events: [working, status('stopped'), status('idle')], word: 'Done', sub: 'Done', renderer: [] },
  { rule: 'limit exhausted without a request id, resolved without one: settles to Working', events: [ev({ type: 'limit', phase: 'exhausted' }), ev({ type: 'limit', phase: 'resolved', action: 'add' })], word: 'Working', sub: null, renderer: [] },
  { rule: 'limit exhausted twice without a request id: de-duplicated (second one does not reset the sub-label)', events: [ev({ type: 'limit', phase: 'exhausted' }), toolStart(), ev({ type: 'limit', phase: 'exhausted' })], word: 'Waiting', sub: null, renderer: [] },
  { rule: 'words', events: [], word: 'Idle', sub: null, renderer: ["const LABELS={working:'Working',thinking:'Thinking',waiting:'Waiting',idle:'Idle',error:'Error',done:'Done'};"] },
];

for (const r of ROWS) {
  const t = new AgentStateTracker();
  t.ensure(ID, r.lazy);
  for (const e of r.events) { if (typeof e === 'function') e(t); else t.onEvent(e); }
  if (r.paused) t.setPaused(ID, true);
  const v = t.get(ID)!;
  assert.strictEqual(v.word, r.word, `${r.rule}: word`);
  assert.strictEqual(v.subLabel, r.sub, `${r.rule}: sub-label`);
}

// Paused is window-only and reversible; the state behind it keeps following events.
{
  const t = new AgentStateTracker();
  t.ensure(ID);
  t.onEvent(out);
  assert.strictEqual(t.setPaused(ID, true), true);
  t.onEvent(think);
  assert.deepStrictEqual(t.get(ID), { word: 'Paused', subLabel: null, state: 'idle', paused: true });
  t.setPaused(ID, false);
  assert.deepStrictEqual(t.get(ID), { word: 'Thinking', subLabel: null, state: 'thinking', paused: false });
  assert.strictEqual(t.setPaused('nope', true), false, 'unknown agent');
}
// clearPaused: a fresh window starts with nobody paused.
{
  const t = new AgentStateTracker();
  t.ensure('x'); t.ensure('y');
  t.setPaused('x', true); t.setPaused('y', true);
  t.clearPaused();
  assert.strictEqual(t.get('x')!.paused, false);
  assert.strictEqual(t.get('y')!.word, 'Idle');
}
// Unknown and removed agents: events are dropped, nothing is created by an event.
{
  const t = new AgentStateTracker();
  t.onEvent(out);
  assert.strictEqual(t.get(ID), undefined);
  t.ensure(ID);
  t.onEvent(out);
  t.remove(ID);
  assert.strictEqual(t.get(ID), undefined);
  t.onEvent(out);
  assert.strictEqual(t.has(ID), false, 'a late event does not bring a removed agent back');
}
// ensure keeps an existing entry.
{
  const t = new AgentStateTracker();
  t.ensure(ID, true);
  t.onEvent(out);
  t.ensure(ID, true);
  assert.strictEqual(t.get(ID)!.word, 'Working');
}

// Drift guard: the renderer is a DOM script that cannot be loaded here, so each fragment this table copies must still be in its source.
// If one fails, the renderer changed a rule: change agentstate.ts and its row, then this fragment (see the header of agentstate.ts).
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const frags = ROWS.flatMap((r) => r.renderer.map((f) => [r.rule, f] as const));
  assert.ok(frags.length >= 20, 'the guard covers the rules');
  for (const [rule, f] of frags) assert.ok(src.includes(f), `renderer drift: "${f}" (row: ${rule}) is no longer in src/renderer/app.js`);
  const pauseWire = "if(a.live&&bridge.setPaused)bridge.setPaused(a.id,a.paused)";
  assert.ok(src.includes(pauseWire), 'the pause button reports to main');
}

// Wiring guard: main.ts must feed the tracker (a pure unit cannot see these calls).
{
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
  for (const f of ['agentState.noteSend(id)', 'agentState.noteSendFailed(id)', "'did-finish-load', () => agentState.clearPaused()", "ipcMain.on('agents:setPaused'", 'agentState.onEvent(e)']) assert.ok(main.includes(f), `main.ts no longer has: ${f}`);
  // The scheduled send (spec 044) must note the send and its failure like the interactive one.
  const i = main.indexOf('send: async (folder, prompt, s)');
  const sched = main.slice(i, main.indexOf('setTimer:', i));
  assert.ok(i > 0 && sched.includes('agentState.noteSend(a.id)') && sched.includes('agentState.noteSendFailed(a.id)'), 'the scheduled send path notes the send and its failure');
  assert.ok(main.includes('applySetPaused(agentState'), 'agents:setPaused goes through applySetPaused');
  const count = (s: string, f: string): number => s.split(f).length - 1;
  assert.ok(count(main, 'agentState.remove(') >= count(main, 'agents.delete('), 'every agents.delete( in main.ts has an agentState.remove( next to it');
}

// applySetPaused: only a real boolean on a known id changes anything.
{
  const t = new AgentStateTracker();
  const lookup = (k: string) => (k === ID ? { id: ID, lazy: false } : undefined);
  for (const bad of [1, 'true', null, undefined, {}]) {
    applySetPaused(t, lookup, ID, bad);
    assert.strictEqual(t.get(ID)?.paused ?? false, false, `non-boolean ${String(bad)} must not pause`);
  }
  assert.strictEqual(applySetPaused(t, lookup, 'nope', true), false);
  assert.strictEqual(t.has('nope'), false, 'unknown id is not tracked');
  assert.strictEqual(applySetPaused(t, lookup, 7, true), false);
  assert.strictEqual(applySetPaused(t, lookup, ID, true), true);
  assert.strictEqual(t.get(ID)?.word, 'Paused');
  for (const bad of [0, 'false', null]) { applySetPaused(t, lookup, ID, bad); assert.strictEqual(t.get(ID)?.paused, true, `non-boolean ${String(bad)} must not unpause`); }
  applySetPaused(t, lookup, ID, false);
  assert.strictEqual(t.get(ID)?.paused, false);
}

console.log(`mcp agentstate: ${ROWS.length} rule rows + pause, removal and drift guard OK`);
