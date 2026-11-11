/** A parent keeps its newest finished helpers (spec 005 FR-240, issue #1418): src/renderer/subretire.js on plain objects, and its wiring in
 * app.js, index.html and the build. `npm run test:subretire`. No credits spent, no Electron.
 * Mutant (must fail): drop the running guard in plan() (`if(!s||s.status==='running')continue;` -> `if(!s)continue;`). */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SR = require(path.join(R, 'subretire.js')) as any;

type Sub = { id: string; status: string; t1?: number };
const mk = (n: number, status: string, t0 = 1000, prefix = status[0]): Sub[] => Array.from({ length: n }, (_, i) => ({ id: prefix + i, status, t1: status === 'running' ? undefined : t0 + i }));

// ---- the constant and the words ----
assert.deepStrictEqual({ ...SR.SUB_KEEP }, { done: 50, failed: 20 }, 'FR-240: 50 done and 20 failed helpers are kept');
assert.ok(Object.isFrozen(SR.SUB_KEEP), 'the limits are a constant');
assert.strictEqual(SR.GONE_MAX, 500, 'the tombstone ring holds the last 500 ids');
assert.strictEqual(SR.noteText(12), '12 earlier helpers are not kept in this view');
assert.strictEqual(SR.noteText(1234), '1,234 earlier helpers are not kept in this view');
assert.strictEqual(SR.noteText(1), '1 earlier helper is not kept in this view');
assert.ok(!/lost|deleted|gone forever/i.test(SR.noteText(5)), 'the line never says the agent app lost them');

// ---- under the limit: nothing ----
assert.deepStrictEqual(SR.plan({ subs: mk(50, 'done') }), [], 'at the done limit nothing goes');
assert.deepStrictEqual(SR.plan({ subs: [...mk(50, 'done'), ...mk(20, 'failed')] }), [], 'at both limits nothing goes');
assert.deepStrictEqual(SR.plan({ subs: [] }), []);
assert.deepStrictEqual(SR.plan(null), [], 'no input: nothing');
assert.deepStrictEqual(SR.plan({}), []);

// ---- over: the oldest by end time go, each status its own limit ----
assert.deepStrictEqual(SR.plan({ subs: mk(51, 'done') }), ['d0'], 'one over: the oldest done goes');
assert.deepStrictEqual(SR.plan({ subs: mk(23, 'failed') }), ['f0', 'f1', 'f2'], 'failed: 20 kept');
assert.deepStrictEqual(SR.plan({ subs: [...mk(52, 'done'), ...mk(21, 'failed')] }), ['d0', 'd1', 'f0'], 'both statuses, each its own limit');
assert.deepStrictEqual(SR.plan({ subs: [...mk(10, 'done'), ...mk(30, 'failed')] }), Array.from({ length: 10 }, (_, i) => 'f' + i), 'many failed and few done: only failed go');
{ // the order is by end time, not by arrival: a helper started early but ended late is newer
  const subs = mk(52, 'done');
  subs[0].t1 = 99999; // the first one to start ended last
  assert.deepStrictEqual(SR.plan({ subs }), ['d1', 'd2'], 'by the time they ended');
}
{ // equal end times: the order they came in (stable), whatever the sort does
  const subs = Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, status: 'done', t1: 5000 }));
  assert.deepStrictEqual(SR.plan({ subs }), Array.from({ length: 10 }, (_, i) => 'e' + i), 'equal times: the earlier ones go first');
  const again = SR.plan({ subs: subs.slice() });
  assert.deepStrictEqual(again, SR.plan({ subs }), 'the same input gives the same plan');
}
{ // a missing or bad end time counts as the oldest
  const subs: Sub[] = [...mk(50, 'done'), { id: 'x', status: 'done', t1: NaN }, { id: 'y', status: 'done' }];
  assert.deepStrictEqual(SR.plan({ subs }), ['x', 'y'], 'no end time: oldest');
}
{ // a Map's values (as app.js passes a.subs.values())
  const m = new Map(mk(53, 'done').map((s) => [s.id, s]));
  assert.deepStrictEqual(SR.plan({ subs: m.values() }), ['d0', 'd1', 'd2'], 'an iterator works');
}

// ---- never retired: running (the running guard) ----
{
  const run = mk(30, 'running', 0, 'r'); // older than every finished one, no end time
  const subs = [...run, ...mk(55, 'done'), ...mk(5, 'running', 0, 'q')];
  const out = SR.plan({ subs });
  assert.deepStrictEqual(out, ['d0', 'd1', 'd2', 'd3', 'd4'], 'running helpers are never retired and do not count toward the limit');
  assert.ok(!out.some((id: string) => id.startsWith('r') || id.startsWith('q')), 'no running helper in the plan');
  assert.deepStrictEqual(SR.plan({ subs: mk(500, 'running', 0, 'r') }), [], 'only running: nothing goes');
}
{ // another status counts as done (not running), so it is never kept without limit
  const subs = [...mk(50, 'done'), { id: 'odd', status: 'idle', t1: 1 }];
  assert.deepStrictEqual(SR.plan({ subs }), ['odd'], 'an unknown status counts as done');
}

// ---- never retired: held (the open one, the focused one) ----
{
  const subs = mk(53, 'done');
  assert.deepStrictEqual(SR.plan({ subs, held: new Set(['d0']) }), ['d1', 'd2', 'd3'], 'a held one stays; the next oldest go instead');
  assert.deepStrictEqual(SR.plan({ subs, held: ['d1', 'd2'] }), ['d0', 'd3', 'd4'], 'held as an array');
  const all = new Set(subs.map((s) => s.id));
  assert.deepStrictEqual(SR.plan({ subs, held: all }), [], 'all held: nothing goes');
  // held ones count toward the limit: with 3 over and 51 of 53 held, only the 2 unheld go
  const most = new Set(subs.slice(0, 51).map((s) => s.id));
  assert.deepStrictEqual(SR.plan({ subs, held: most }), ['d51', 'd52'], 'held count toward the limit; the unheld go even if newer');
}

// ---- custom limits ----
assert.deepStrictEqual(SR.plan({ subs: mk(3, 'done'), keep: { done: 1, failed: 1 } }), ['d0', 'd1']);
assert.deepStrictEqual(SR.plan({ subs: mk(3, 'done'), keep: { done: -4, failed: 'x' } }), ['d0', 'd1', 'd2'], 'a bad limit is 0');

// ---- the tombstone ring ----
{
  let r = SR.bury(undefined, 'a');
  assert.ok(r instanceof Set && r.has('a') && r.size === 1, 'a new ring');
  for (let i = 0; i < 600; i++) r = SR.bury(r, 'h' + i);
  assert.strictEqual(r.size, 500, 'at most 500 ids');
  assert.ok(!r.has('a') && !r.has('h99') && r.has('h100') && r.has('h599'), 'the oldest are forgotten first');
  r = SR.bury(r, 'h100');
  assert.strictEqual([...r].pop(), 'h100', 'buried again: it becomes the newest');
  assert.strictEqual(SR.bury(new Set(), 'z', 2).size, 1);
  let small = new Set<string>(); for (const id of ['1', '2', '3']) small = SR.bury(small, id, 2);
  assert.deepStrictEqual([...small], ['2', '3'], 'a custom size');
}

// ---- time: 200,000 helpers planned well under a second (the page plans at most ~71 per end) ----
{
  const subs: Sub[] = [];
  for (let i = 0; i < 200000; i++) subs.push({ id: 'p' + i, status: i % 3 === 0 ? 'failed' : i % 7 === 0 ? 'running' : 'done', t1: 1e6 - (i % 1000) });
  const held = new Set(subs.filter((_, i) => i % 11 === 0).map((s) => s.id));
  const t0 = process.hrtime.bigint();
  const out = SR.plan({ subs, held });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const fin = subs.filter((s) => s.status !== 'running');
  assert.ok(out.length > 0 && out.length <= fin.length - 70, 'the plan leaves at least the limits');
  assert.ok(!out.some((id: string) => held.has(id)), 'nothing held is retired');
  assert.ok(ms < 1000, `200,000 helpers planned in ${ms.toFixed(1)} ms (limit 1000)`);
}

// ---- the wiring: app.js, index.html, the build ----
// a Windows checkout may have CRLF line ends; the regexes and indexOf('\n}') below expect LF
const lf = (t: string) => t.replace(/\r\n/g, '\n');
assert.strictEqual(lf('a\r\nb\r\n}'), 'a\nb\n}', 'lf() turns CRLF into LF');
{
  const app = lf(fs.readFileSync(path.join(R, 'app.js'), 'utf8'));
  const html = lf(fs.readFileSync(path.join(R, 'index.html'), 'utf8'));
  const copy = lf(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8'));
  assert.ok(/<script src="subretire\.js"><\/script>/.test(html), 'index.html loads subretire.js');
  assert.ok(html.indexOf('<script src="subretire.js">') < html.indexOf('<script src="app.js">'), 'before app.js');
  assert.ok(copy.includes("'subretire.js'"), 'copy-assets copies subretire.js');
  assert.ok(/const SR=window\.DurbarSubRetire;/.test(app), 'app.js reads window.DurbarSubRetire');
  const bodyOf = (src: string, name: string) => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' exists'); return src.slice(i, src.indexOf('\n}', i)); };
  assert.strictEqual(bodyOf(lf(app.replace(/\n/g, '\r\n')), 'subRetire'), bodyOf(app, 'subRetire'), 'a CRLF checkout reads the same function bodies');
  const body = (name: string) => { const i = app.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' exists'); return app.slice(i, app.indexOf('\n}', i)); };
  assert.ok(body('onSubagent').includes("if(e.phase!=='started')subRetireCheck(a)"), 'onSubagent checks at its end phases');
  assert.ok(body('onTaskTool').includes('subRetireCheck(a)'), 'onTaskTool checks at its end phases');
  assert.ok(!body('onTaskTool').split("else if(e.phase==='update')return;")[0].includes('subRetireCheck'), 'not at a start');
  for (const f of ['onSubEvent', 'onSubagent', 'onTaskTool']) assert.ok(/^function \w+\(a,e\)\{\n\s*if\(subIsGone\(a,e\.\w+\)\)/.test(body(f)), f + ' ignores a retired helper first');
  assert.ok(app.includes('(a.subs&&a.subs.has(e.callId))||subIsGone(a,e.callId))onTaskTool(a,e)'), 'FR-095 route: a retired call goes to onTaskTool, which ignores it');
  assert.ok(/function removeLiveAgent\(id\)\{[\s\S]*?forgetCardState\(agents\[i\]\.id\)/.test(app), 'removeLiveAgent uses the shared per-id cleanup');
  assert.ok(body('subRetire').includes('forgetCardState(card.id)'), 'subRetire uses the same cleanup');
  const fcs = body('forgetCardState');
  for (const k of ['DRAFTS.delete', 'UNREAD.forget', 'UNREAD_AT.delete', 'UNREAD_SAID.delete', 'HL_AT.delete', 'delete chats[id]', 'delete prev[id]']) assert.ok(fcs.includes(k), 'forgetCardState: ' + k);
  const rt = body('subRetire');
  assert.ok(rt.includes("s.status==='running')return false"), 'subRetire refuses a running helper');
  for (const k of ['a.subs.delete(id)', 'subViews.delete(v)', 's.views=[]', 's.log=[]', 's.block=null', 'SR.bury(a.subGone,id)', 'subGoneNote(a)']) assert.ok(rt.includes(k), 'subRetire: ' + k);
  assert.strictEqual((body('onSubEvent').match(/addParentUsage\(a,e\)/g) || []).length, 2, 'a helper\'s usage, kept or retired, goes through one helper');
  assert.ok(!/p\.calls\+\+/.test(body('onSubEvent')), 'onSubEvent does not copy the parent usage update');
  const stub = body('subStub');
  assert.ok(!/sub-in|sub-open|<button/.test(stub), 'the stub has no body, no Open and no button');
  assert.ok(/old\.replaceWith\(el\)/.test(stub), 'the stub replaces the block (its listeners and body go with it)');
}

console.log('test-subretire: ok');
