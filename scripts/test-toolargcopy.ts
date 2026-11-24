/**
 * Unit test (spec 005 FR-411, T503, issue #2060 item 4): Copy on a tool chip copies the real argument text; main writes the clipboard and the
 * window never receives the real value. `npm run test:toolargcopy`. No credits, no Electron (the clipboard is a fake). Every secret-like value
 * below is invented and built from pieces.
 *
 * Checks: the choice of argument equals the window's `toolArg` (read from `src/renderer/app.js`) on a corpus; a masked argument is flagged
 * `argsMasked: true` and an unmasked one `false`, and the window's event never holds the raw value; Copy writes the raw text with its line
 * breaks and answers `{ ok: true }` only (no text); an unknown id, another session's call and malformed ids answer `unknown`; a value over the
 * size answers `too-long` and writes nothing; the store stays within its bounds; a failing clipboard answers `failed` and logs nothing; an
 * adapter's own `argsMasked` never reaches the window; the IPC module checks the owner frame and returns the store's answer. Review round 1:
 * a masked value without `confirmed === true` answers `ask` and writes nothing (ASK-MAIN); `forget` drops a removed session's values (STALE)
 * and is wired where main forgets a removed session (FORGET-WIRE). Review round 2: every path that removes or replaces a session (Remove
 * session, Remove folder, Resume with replace) forgets its values on the real handlers, and End keeps them (FORGET-REMOVE, FORGET-FOLDER,
 * FORGET-REPLACE, END-KEEPS). T504 (the window side) replaced PR 1's NO-CALLER-YET guard with the strong form: the chip's Copy is the
 * one caller (CALLERS). Review of PR 2099: the argument is chosen on the masked copy (PICK-MASKED); ids of the app's shapes when
 * storing and copying (ID-STORE, ID-SHAPE); no read across sessions (KEY-UNAMBIGUOUS, STORED-IDS, CROSS-SESSION, PROTO-IDS); eviction
 * stops on an empty map (GUARD-EMPTY, BUDGET-ONE); a model fuzz with small bounds (FUZZ).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createToolArgsMasker, maskMcpEvent } from '../src/main/mcpmask';
import * as vm from 'vm';
import { TOOL_COPY_CALLS_MAX, TOOL_COPY_MAX_CHARS, TOOL_COPY_TOTAL_MAX, createToolArgCopies, keptFor, toolArgKey, toolCopyKey } from '../src/main/toolargcopy';
import type { Kept } from '../src/main/toolargcopy';
import type { AgentEvent } from '../src/adapters/types';

const ROOT = path.join(__dirname, '..', '..');
let n = 0;
const ok = (name: string, fn: () => void): void => { fn(); n++; console.log(`  ok ${name}`); };

const BEARER = ['Qx7', 'Mw2Rt9', 'Lp4Vz8', 'Nc3Hk'].join('');
const OPTV = ['Pv6', 'Tq1Zm4', 'Wx8Rs'].join('');
const MASKED_CMD = ['cd app &&\n  curl -H "Authorization', ': Bearer ', BEARER, '" \\\n  https://api.example.test/'].join('');
const MASKED_OPT = ['npm run deploy -- --', 'token=', OPTV, ' --env staging'].join('');
const PLAIN_CMD = 'for f in src/*.ts; do\n  wc -l "$f"\ndone';

type Ev = Extract<AgentEvent, { type: 'toolCall' }>;
const ev = (args: unknown, o: Partial<Ev> = {}): Ev => ({ type: 'toolCall', sessionId: 's1', callId: 'c1', tool: 'bash', phase: 'start', timestamp: 1, args, ...o } as Ev);
/** main's own path: `outward` masks (FR-342 main half), then the store sees the raw event and the masked copy */
const masker = createToolArgsMasker();
const outward = (e: AgentEvent): AgentEvent => maskMcpEvent(e, [], masker);
const fake = (): { writes: string[]; store: ReturnType<typeof createToolArgCopies> } => {
  const writes: string[] = [];
  return { writes, store: createToolArgCopies({ write: (t) => { writes.push(t); } }) };
};

// ---- the window's choice of argument: `toolArg` in app.js, read from the source, gives String(args[toolArgKey(args)]) on every shape
ok('PICK the argument main keeps is the one the window\'s toolArg shows', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  const m = /^const toolArg=(args=>[^\n]*);$/m.exec(src);
  assert.ok(m, 'app.js still defines toolArg on one line');
  const toolArg = new Function(`return (${m[1]});`)() as (a: unknown) => string;
  const corpus: unknown[] = [
    undefined, null, 'x', 5, [], ['git', 'status'], [3, 'a'], {}, { command: 'ls' }, { path: 'a', command: 'b' }, { path: '', command: 'b' },
    { pattern: 'x', url: 'u' }, { query: 'q', file_path: 'f' }, { file_path: 'f' }, { description: 'd', prompt: 'p' }, { n: 1, s: 'x' },
    { n: 1 }, { command: 0, url: 'u' }, { path: 7 }, { path: true }, { command: '', other: '' }, { a: { b: 'c' }, d: 'e' }, { url: 'https://example.com/' },
    { old_string: 'a', new_string: 'b' }, { sessionId: 'main', delay: 5 }, { command: ['git', 'status'] },
  ];
  for (const a of corpus) {
    const k = toolArgKey(a);
    const mine = k === undefined ? '' : String((a as Record<string, unknown>)[k]);
    assert.strictEqual(mine, toolArg(a), `PICK ${JSON.stringify(a)}: main keeps "${mine}", the window shows "${toolArg(a)}"`);
  }
});

// ---- a masked argument: flagged, the window's event holds no raw value, Copy writes the real text with its line breaks
ok('MASKED a hidden word: argsMasked true, the window gets no raw value, Copy writes the real multi-line text, the answer holds no text', () => {
  const { writes, store } = fake();
  for (const [cmd, needle] of [[MASKED_CMD, BEARER], [MASKED_OPT, OPTV]] as const) {
    const callId = 'c-' + needle.slice(0, 3);
    const raw = ev({ command: cmd, description: 'Run it' }, { callId });
    const win = store.see(raw, outward(raw)) as Ev;
    assert.strictEqual(win.argsMasked, true, 'FLAG-MASKED main says something was masked');
    assert.ok(!JSON.stringify(win).includes(needle), `EVENT-NO-RAW the window's event holds the hidden value: ${JSON.stringify(win).slice(0, 200)}`);
    const before = writes.length;
    assert.deepStrictEqual(store.copy('s1', callId), { ok: false, reason: 'ask' }, 'ASK-MAIN a masked value is not written without confirmed');
    assert.strictEqual(writes.length, before, 'ASK-MAIN nothing written before the person confirmed');
    const r = store.copy('s1', callId, true);
    assert.deepStrictEqual(r, { ok: true }, 'ANSWER-OK the answer is { ok: true } only');
    assert.ok(!JSON.stringify(r).includes(needle), 'ANSWER-NO-TEXT the answer never holds the text');
    assert.strictEqual(writes[writes.length - 1], cmd, 'COPY-REAL the clipboard gets the real text, line breaks kept');
  }
  assert.ok(writes[0].includes('\n'), 'COPY-LINES the multi-line command keeps its line breaks');
});

ok('PLAIN nothing hidden: argsMasked false, the event is otherwise main\'s masked copy, Copy writes the same text', () => {
  const { writes, store } = fake();
  const raw = ev({ command: PLAIN_CMD });
  const out = outward(raw);
  const win = store.see(raw, out) as Ev;
  assert.strictEqual(win.argsMasked, false, 'FLAG-PLAIN nothing masked');
  assert.deepStrictEqual({ ...win, argsMasked: undefined }, { ...out, argsMasked: undefined }, 'the flag is the only change to the window\'s copy');
  assert.deepStrictEqual(store.copy('s1', 'c1'), { ok: true });
  assert.strictEqual(writes[0], PLAIN_CMD, 'the real text');
});

ok('UPDATE a later event with arguments replaces the kept text and the flag', () => {
  const { writes, store } = fake();
  const a = ev({ command: 'echo start' });
  assert.strictEqual((store.see(a, outward(a)) as Ev).argsMasked, false);
  const b = ev({ command: MASKED_OPT }, { phase: 'update' });
  assert.strictEqual((store.see(b, outward(b)) as Ev).argsMasked, true);
  const c = ev(undefined, { phase: 'complete', output: 'done' });
  assert.strictEqual((store.see(c, outward(c)) as Ev).argsMasked, undefined, 'an event without arguments gets no flag');
  assert.deepStrictEqual(store.copy('s1', 'c1', false), { ok: false, reason: 'ask' }, 'ASK-MAIN the update masked it: the window\'s older hint does not let it out');
  assert.deepStrictEqual(writes, [], 'nothing written on the stale hint');
  store.copy('s1', 'c1', true);
  assert.strictEqual(writes[0], MASKED_OPT, 'Copy after the call completed writes the latest arguments');
});

ok('IDS an unknown id, another session\'s call and malformed ids answer unknown and write nothing', () => {
  const { writes, store } = fake();
  const raw = ev({ command: MASKED_OPT });
  store.see(raw, outward(raw));
  for (const [s, c, what] of [['s1', 'nope', 'unknown call'], ['s2', 'c1', 'another session'], ['', 'c1', 'empty session'], ['s1', '', 'empty call'], [5, 'c1', 'a number'], ['s1', null, 'null'], ['s1', 'c'.repeat(600), 'too long an id'], [{ toString: () => 's1' }, 'c1', 'an object']] as const) {
    assert.deepStrictEqual(store.copy(s, c), { ok: false, reason: 'unknown' }, `UNKNOWN ${what}`);
  }
  assert.deepStrictEqual(writes, [], 'nothing written');
});

ok('SIZE a value over the size answers too-long and writes nothing; it is not kept', () => {
  const { writes, store } = fake();
  const big = 'echo ' + 'a'.repeat(TOOL_COPY_MAX_CHARS);
  const raw = ev({ command: big });
  store.see(raw, { ...raw, args: { command: 'echo …' } }); // a masked copy that still shows this key
  assert.deepStrictEqual(store.copy('s1', 'c1'), { ok: false, reason: 'too-long' }, 'TOO-LONG');
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(store.size().chars, 0, 'the text is not kept');
});

ok('BOUNDS at most the calls and characters allowed; the oldest go first', () => {
  const { store } = fake();
  for (let i = 0; i <= TOOL_COPY_CALLS_MAX; i++) { const e = ev({ command: 'echo ' + i }, { callId: 'k' + i }); store.see(e, e); }
  assert.strictEqual(store.size().calls, TOOL_COPY_CALLS_MAX, 'BOUND-CALLS');
  assert.deepStrictEqual(store.copy('s1', 'k0'), { ok: false, reason: 'unknown' }, 'the oldest call was dropped');
  assert.deepStrictEqual(store.copy('s1', 'k' + TOOL_COPY_CALLS_MAX), { ok: true }, 'the newest is kept');
  const { store: s2 } = fake();
  const chunk = 'x'.repeat(TOOL_COPY_MAX_CHARS - 1);
  for (let i = 0; i < 50; i++) { const e = ev({ command: chunk }, { callId: 'b' + i }); s2.see(e, e); }
  assert.ok(s2.size().chars <= TOOL_COPY_TOTAL_MAX, `BOUND-CHARS ${s2.size().chars} characters kept`);
  assert.deepStrictEqual(s2.copy('s1', 'b49'), { ok: true });
});

ok('FAIL a failing clipboard answers failed and nothing is logged', () => {
  const store = createToolArgCopies({ write: () => { throw new Error('clipboard busy ' + OPTV); } });
  const raw = ev({ command: MASKED_OPT });
  store.see(raw, outward(raw));
  const said: unknown[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { said.push(a); };
  let r;
  try { r = store.copy('s1', 'c1', true); } finally { Object.assign(console, keep); }
  assert.deepStrictEqual(r, { ok: false, reason: 'failed' }, 'FAILED');
  assert.deepStrictEqual(said, [], 'nothing is logged');
});

ok('ASK-MAIN only confirmed === true lets a masked value out; a plain value needs no confirm', () => {
  const { writes, store } = fake();
  const m = ev({ command: MASKED_OPT }, { callId: 'm' });
  store.see(m, outward(m));
  const p = ev({ command: PLAIN_CMD }, { callId: 'p' });
  store.see(p, outward(p));
  for (const c of [undefined, false, 'true', 1, {}, [true]]) assert.deepStrictEqual(store.copy('s1', 'm', c), { ok: false, reason: 'ask' }, `ASK-MAIN confirmed ${JSON.stringify(c)}`);
  assert.deepStrictEqual(writes, [], 'ASK-MAIN nothing written');
  assert.deepStrictEqual(store.copy('s1', 'p'), { ok: true }, 'PLAIN-NO-ASK');
  assert.deepStrictEqual(store.copy('s1', 'm', true), { ok: true });
  assert.deepStrictEqual(writes, [PLAIN_CMD, MASKED_OPT]);
});

ok('STALE a removed session\'s values are dropped; other sessions keep theirs', () => {
  const { writes, store } = fake();
  for (const [sid, cid] of [['s1', 'a'], ['s1', 'b'], ['s2', 'a']]) { const e = ev({ command: 'echo ' + sid + cid }, { sessionId: sid, callId: cid }); store.see(e, outward(e)); }
  assert.strictEqual(store.size().calls, 3, 'KEYS-APART the same call id in two sessions is kept twice');
  store.forget('s1');
  assert.deepStrictEqual(store.copy('s1', 'a'), { ok: false, reason: 'unknown' }, 'STALE the removed session\'s call is unknown');
  assert.deepStrictEqual(store.copy('s1', 'b'), { ok: false, reason: 'unknown' }, 'STALE');
  assert.deepStrictEqual(store.size(), { calls: 1, chars: 'echo s2a'.length }, 'STALE size drops');
  assert.deepStrictEqual(store.copy('s2', 'a'), { ok: true }, 'another session keeps its values');
  assert.deepStrictEqual(writes, ['echo s2a']);
  store.forget(''); store.forget(5 as unknown as string);
  assert.strictEqual(store.size().calls, 1, 'a malformed id forgets nothing');
});

// ---- review of PR 2099, item 1: the argument is chosen on the window's masked copy, not on the raw arguments
ok('PICK-MASKED the kept text is the one the chip shows, chosen on the masked copy', () => {
  const { writes, store } = fake();
  const raw = ev({ path: 'p/'.repeat(10_000), command: 'ls' });
  const out = outward(raw) as Ev;
  assert.strictEqual((out.args as Record<string, unknown>).path, '', 'main\'s mask sends the over-long path empty (the chip shows the command)');
  store.see(raw, out);
  assert.deepStrictEqual(store.copy('s1', 'c1', true), { ok: true });
  assert.deepStrictEqual(writes, ['ls'], 'PICK-MASKED Copy writes what the chip shows (ls), not the raw arguments\' first value');
});

// ---- review of PR 2099, items 2 and 4: ids of the app's shapes, checked when storing and when copying
const idEv = (sessionId: string, callId: string, command = 'echo hi'): Ev => ev({ command }, { sessionId, callId });
ok('ID-STORE an id over its length is never kept; the longest allowed ids are', () => {
  const { store } = fake();
  for (const [sid, cid, what] of [['s'.repeat(600), 'c1', '600-character session'], ['s1', 'c'.repeat(600), '600-character call'], ['s'.repeat(129), 'c1', '129-character session'], ['s1', 'c'.repeat(257), '257-character call']]) {
    const e = idEv(sid, cid);
    store.see(e, outward(e));
    assert.deepStrictEqual(store.size(), { calls: 0, chars: 0 }, `ID-STORE ${what}: nothing kept`);
  }
  const ok1 = idEv('s'.repeat(128), 'c'.repeat(256));
  store.see(ok1, outward(ok1));
  assert.strictEqual(store.size().calls, 1, 'ID-STORE a 128-character session id and a 256-character call id are kept');
  assert.deepStrictEqual(store.copy('s'.repeat(128), 'c'.repeat(256)), { ok: true });
});
ok('ID-SHAPE ids holding a NUL, a newline or other characters outside the shape are neither kept nor looked up', () => {
  const { writes, store } = fake();
  const bad = ['a\u0000b', 'a\nb', 'a b', 'a/b', 'é', '‮', 'a"b', '[1]'];
  for (const b of bad) {
    for (const [sid, cid] of [[b, 'c1'], ['s1', b]]) { const e = idEv(sid, cid); store.see(e, outward(e)); }
  }
  assert.deepStrictEqual(store.size(), { calls: 0, chars: 0 }, 'ID-SHAPE nothing kept for an id of the wrong shape');
  const good = idEv('s1', 'c1');
  store.see(good, outward(good));
  for (const b of bad) {
    assert.deepStrictEqual(store.copy(b, 'c1'), { ok: false, reason: 'unknown' }, `ID-SHAPE session ${JSON.stringify(b)}`);
    assert.deepStrictEqual(store.copy('s1', b), { ok: false, reason: 'unknown' }, `ID-SHAPE call ${JSON.stringify(b)}`);
  }
  for (const v of [1, 1n, true, null, undefined, {}, [], ['s1'], { toString: () => 's1' }, new String('s1')]) {
    assert.deepStrictEqual(store.copy(v, 'c1'), { ok: false, reason: 'unknown' }, `ID-SHAPE a ${typeof v} session id`);
    assert.deepStrictEqual(store.copy('s1', v), { ok: false, reason: 'unknown' }, `ID-SHAPE a ${typeof v} call id`);
  }
  assert.deepStrictEqual(writes, [], 'ID-SHAPE nothing written');
});
ok('KEY-UNAMBIGUOUS two different pairs of ids never share a key, whatever they hold', () => {
  // the characters the id shapes refuse (NUL, comma, quote, backslash) and, review of PR 2099 round 2, the ones they allow and a naive join
  // would use as a separator (':', '.', '-', '_'): 'a:b' + 'c' against 'a' + 'b:c', and the same for each
  const pairs: [string, string][] = [['A\u0000x', 'y'], ['A', 'x\u0000y'], ['A', 'xy'], ['Ax', 'y'], ['A,', 'x'], ['A', ',x'], ['A"', 'x'], ['A', '"x'], ['A\\', 'x'], ['A', '\\x']];
  for (const sep of [':', '.', '-', '_']) pairs.push([`a${sep}b`, 'c'], ['a', `b${sep}c`], [`a${sep}b${sep}`, 'c'], ['a', `${sep}b${sep}c`], [`a${sep}`, `b${sep}c`]);
  const keys = new Map<string, string>();
  for (const [a, b] of pairs) {
    const k = toolCopyKey(a, b);
    assert.ok(!keys.has(k), `KEY-UNAMBIGUOUS ${JSON.stringify([a, b])} and ${keys.get(k)} share a key`);
    keys.set(k, JSON.stringify([a, b]));
  }
});
ok('STORE-BOTH two pairs a naive join would merge are kept apart: each Copy writes its own value, in both orders', () => {
  for (const sep of [':', '.', '-', '_']) {
    const one: [string, string] = [`a${sep}b`, 'c'], two: [string, string] = ['a', `b${sep}c`];
    for (const order of [[one, two], [two, one]]) {
      const { writes, store } = fake();
      for (const [sid, cid] of order) { const e = idEv(sid, cid, `value of ${sid}|${cid}`); store.see(e, outward(e)); }
      assert.strictEqual(store.size().calls, 2, `STORE-BOTH '${sep}': both pairs are kept (${JSON.stringify(order)})`);
      for (const [sid, cid] of order) assert.deepStrictEqual(store.copy(sid, cid, true), { ok: true }, `STORE-BOTH '${sep}': ${sid} / ${cid} still held`);
      assert.deepStrictEqual(writes, order.map(([sid, cid]) => `value of ${sid}|${cid}`), `STORE-BOTH '${sep}': each Copy writes its own value`);
    }
  }
});
ok('SIM-KEY the simulator\'s stand-in builds its keys exactly like main, and every lookup there goes through that one helper', () => {
  const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
  const m = /^\s*const simToolCopyKey = \(sessionId: string, callId: string\): string => ([^\n]*);$/m.exec(sim);
  assert.ok(m, 'SIM-KEY sim.ts defines simToolCopyKey on one line');
  const simKey = new Function('sessionId', 'callId', `return (${m[1]});`) as (a: string, b: string) => string;
  const pairs: [string, string][] = [['A\u0000x', 'y'], ['A', 'x\u0000y'], ['s1', 'c1'], ['a:b', 'c'], ['a', 'b:c'], ['sim-2', 'cc-m'], ['__proto__', 'constructor']];
  for (const [a, b] of pairs) assert.strictEqual(simKey(a, b), toolCopyKey(a, b), `SIM-KEY the stand-in and main agree on ${JSON.stringify([a, b])}`);
  assert.notStrictEqual(simKey('A\u0000x', 'y'), simKey('A', 'x\u0000y'), 'SIM-KEY a pair a NUL-join would confuse stays apart in the stand-in');
  const uses = sim.match(/simToolCopies\.(?:get|set|delete)\(([^,)]*(?:\([^)]*\))?)/g) || [];
  assert.ok(uses.length >= 4, `SIM-KEY the stand-in's lookups found (${uses.length})`);
  for (const u of uses) assert.ok(/simToolCopies\.(?:get|set|delete)\((?:simToolCopyKey\(|id\b)/.test(u), `SIM-KEY every lookup uses simToolCopyKey: ${u}`);
  assert.ok(/const id = simToolCopyKey\(e\.sessionId, e\.callId\);/.test(sim), 'SIM-KEY the emitted event\'s key comes from simToolCopyKey');
  assert.ok(!/simToolCop[^\n]*'\\u0000'/.test(sim), 'SIM-KEY no NUL-joined key is left in the stand-in');
});
ok('STORED-IDS a lookup answers only the value stored for exactly these ids', () => {
  const v = (sid: string, callId: string): Kept => ({ sid, callId, text: 'x', masked: false });
  const m = new Map<string, Kept>([[toolCopyKey('A', 'x'), v('B', 'x')], [toolCopyKey('C', 'y'), v('C', 'z')], [toolCopyKey('D', 'w'), v('D', 'w')]]);
  assert.strictEqual(keptFor(m, 'A', 'x'), undefined, 'STORED-IDS an entry of another session under this key is not answered');
  assert.strictEqual(keptFor(m, 'C', 'y'), undefined, 'STORED-IDS an entry of another call under this key is not answered');
  assert.strictEqual(keptFor(m, 'D', 'w')?.text, 'x', 'the exact entry is');
});
ok('CROSS-SESSION ids built to reach another session\'s value answer unknown (the reviewer\'s probe and its variants)', () => {
  const { writes, store } = fake();
  for (const [sid, cid] of [['A', 'x'], ['A', 'x\u0000y'], ['Ax', 'y'], ['s1', 'c']]) { const e = idEv(sid, cid, `value of ${sid}/${cid}`.replace(/\u0000/g, '0')); store.see(e, outward(e)); }
  for (const [sid, cid, what] of [['A\u0000x', 'y', 'session holding the old separator'], ['A', 'x\u0000y', 'call holding the old separator'], ['A', 'x\u0000', 'call with a trailing NUL'], ['A', 'xy', 'a call joined from two'], ['s', '1c', 'a prefix of the session'], ['s1', 'c1', 'a longer call id'], ['s1', '', 'an empty call id']]) {
    assert.deepStrictEqual(store.copy(sid, cid, true), { ok: false, reason: 'unknown' }, `CROSS-SESSION ${what}`);
  }
  assert.deepStrictEqual(store.copy('Ax', 'y', true), { ok: true });
  assert.deepStrictEqual(writes, ['value of Ax/y'], 'CROSS-SESSION only the exact pair is written');
});
ok('PROTO-IDS __proto__, constructor and toString as ids reach only their own value; nothing is polluted', () => {
  const { writes, store } = fake();
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  for (const a of names) for (const b of names) { const e = idEv(a, b, `${a}.${b}`); store.see(e, outward(e)); }
  for (const a of names) for (const b of names) assert.deepStrictEqual(store.copy(a, b), { ok: true }, `PROTO-IDS ${a}/${b}`);
  assert.deepStrictEqual(writes, names.flatMap((a) => names.map((b) => `${a}.${b}`)), 'PROTO-IDS each pair writes its own value');
  assert.deepStrictEqual(store.copy('__proto__', 'x'), { ok: false, reason: 'unknown' });
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf({}), Object.prototype, 'PROTO-IDS the object prototype is untouched');
});

// ---- review of PR 2099, item 5: eviction stops on an empty map
ok('BUDGET-ONE a value larger than the whole budget (small test bounds) is dropped at once; no loop, no throw', () => {
  const writes: string[] = [];
  const store = createToolArgCopies({ write: (t) => { writes.push(t); }, limits: { calls: 5, total: 10, maxChars: 40 } });
  const e = idEv('s1', 'c1', 'x'.repeat(30));
  store.see(e, e);
  assert.deepStrictEqual(store.size(), { calls: 0, chars: 0 }, 'BUDGET-ONE nothing kept, the count back to 0');
  assert.deepStrictEqual(store.copy('s1', 'c1'), { ok: false, reason: 'unknown' });
});
ok('GUARD-EMPTY with the count wrong and nothing left to drop, eviction stops (run under a time limit)', () => {
  const { store } = fake();
  store.testSkew(TOOL_COPY_TOTAL_MAX + 1);
  const e = idEv('s1', 'c1');
  let err: unknown;
  try { vm.runInNewContext('run()', { run: () => store.see(e, outward(e)) }, { timeout: 2000 }); } catch (x) { err = x; }
  assert.ok(!err, `GUARD-EMPTY eviction stops on an empty map (${String(err)})`);
  assert.strictEqual(store.size().calls, 0, 'the only value went, and the loop ended');
});
ok('FUZZ a model of the store with small bounds agrees at every step (answers, writes, counts)', () => {
  const L = { calls: 5, total: 100, maxChars: 40 };
  const writes: string[] = [];
  const store = createToolArgCopies({ write: (t) => { writes.push(t); }, limits: L });
  type M = { sid: string; cid: string; text: string | null; masked: boolean };
  let model: M[] = [];
  const mchars = (): number => model.reduce((n, m) => n + (m.text?.length ?? 0), 0);
  const okS = (v: string): boolean => /^[A-Za-z0-9._:-]{1,128}$/.test(v), okC = (v: string): boolean => /^[A-Za-z0-9._:-]{1,256}$/.test(v);
  const SIDS = ['s1', 's2', '__proto__', 's\u00001', '', 'x'.repeat(129)], CIDS = ['a', 'b', 'c', 'a\u0000b', '\n', 'constructor'];
  let seed = 20261124;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const mwrites: string[] = [];
  for (let step = 0; step < 20_000; step++) {
    const op = rnd(10), sid = SIDS[rnd(SIDS.length)], cid = CIDS[rnd(CIDS.length)];
    if (op < 7) {
      const text = 'v'.repeat(rnd(60)) + step, masked = rnd(2) === 1;
      const raw = idEv(sid, cid, text), out = masked ? idEv(sid, cid, '[masked]') : raw;
      store.see(raw, out);
      if (okS(sid) && okC(cid)) {
        model = model.filter((m) => !(m.sid === sid && m.cid === cid));
        model.push({ sid, cid, text: text.length > L.maxChars ? null : text, masked });
        while (model.length > 0 && (model.length > L.calls || mchars() > L.total)) model.shift();
      }
    } else if (op < 9) {
      const confirmed = [true, false, undefined, 'true'][rnd(4)];
      const got = store.copy(sid, cid, confirmed);
      const m = okS(sid) && okC(cid) ? model.find((x) => x.sid === sid && x.cid === cid) : undefined;
      const want = !m ? { ok: false, reason: 'unknown' } : m.text === null ? { ok: false, reason: 'too-long' } : m.masked && confirmed !== true ? { ok: false, reason: 'ask' } : { ok: true };
      if (want.ok) mwrites.push(m!.text as string);
      assert.deepStrictEqual(got, want, `FUZZ step ${step}: copy(${JSON.stringify(sid)}, ${JSON.stringify(cid)}, ${String(confirmed)})`);
    } else {
      store.forget(sid);
      if (okS(sid)) model = model.filter((m) => m.sid !== sid);
    }
    assert.deepStrictEqual(store.size(), { calls: model.length, chars: mchars() }, `FUZZ step ${step}: the counts`);
  }
  assert.deepStrictEqual(writes, mwrites, 'FUZZ the same writes');
});

ok('ADAPTER an adapter\'s own argsMasked never reaches the window; other events pass unchanged', () => {
  const { store } = fake();
  const forged = ev(undefined, { phase: 'complete', output: 'ok', argsMasked: false } as Partial<Ev>);
  assert.ok(!('argsMasked' in store.see(forged, forged)), 'dropped on an event without arguments');
  const withArgs = { ...ev({ command: MASKED_OPT }), argsMasked: false } as Ev;
  assert.strictEqual((store.see(withArgs, outward(withArgs)) as Ev).argsMasked, true, 'main\'s word replaces it');
  const other = { type: 'status', sessionId: 's1', status: 'idle', timestamp: 1 } as AgentEvent;
  assert.strictEqual(store.see(other, other), other, 'not a tool call: the same object');
  const nothing = ev({ n: 1 });
  assert.strictEqual((store.see(nothing, outward(nothing)) as Ev).argsMasked, true, 'nothing a chip can copy: ask first (fail safe)');
  assert.deepStrictEqual(store.copy('s1', 'c1'), { ok: false, reason: 'unknown' });
});

ok('IPC the channel checks the owner frame and answers the store\'s result, never the text', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'toolcopy.ts'), 'utf8');
  assert.ok(/ipcHandle\('agents:copyToolArg', \(e, sessionId: unknown, callId: unknown, confirmed: unknown\): ToolCopyResult => \{\s*if \(!fromApp\(e\)\) return \{ ok: false, reason: 'unknown' \};\s*return deps\.copies\.copy\(sessionId, callId, confirmed === true\);/.test(src), 'IPC-BODY the handler is the owner check and the store\'s answer');
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
  assert.ok(/createToolArgCopies\(\{ write: \(t\) => clipboard\.writeText\(t\) \}\)/.test(main), 'IPC-WRITE main writes with Electron\'s clipboard');
  assert.ok(/toRenderer\('agent:event', toolArgCopies\.see\(e, toWindowEvent\(e, outward\)\)\)/.test(main), 'IPC-WIRE the flag goes on the window\'s masked copy');
  assert.strictEqual((main.match(/forgetSandboxNote: \(id\) => sandboxOps\.forget\(id\), forgetToolCopies: \(id\) => toolArgCopies\.forget\(id\)/g) || []).length, 2, 'FORGET-WIRE main passes forget to the agents and folders IPC');
  assert.ok(/registerPreviousIpc\(\{ browserGone, [^\n]*, maskHistory, forgetToolCopies: \(id\) => toolArgCopies\.forget\(id\) \}\);/.test(main), 'FORGET-WIRE main passes forget to the previous-sessions IPC (Resume with replace)');
  // agents.ts, folders.ts and previous.ts are checked by running their handlers (REMOVE, FOLDER, REPLACE below), not by their text
  const keep = /log|warn|console/.exec(fs.readFileSync(path.join(ROOT, 'src', 'main', 'toolargcopy.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
  assert.ok(!keep, 'NO-LOG the store has no log call');
});

// ---- T504 (PR 2, the window side) replaced PR 1's NO-CALLER-YET guard with the strong form: the window calls the channel in exactly one
// place, the chip's Copy (`copyChipArg` in app.js), and the simulator's stand-in in sim.ts answers for main; no other window file names it.
// Still not a security boundary (main enforces the owner frame, the ids and the ask rule): it pins the one intended caller.
ok('CALLERS the window calls copyToolArg only from the chip\'s Copy; the simulator\'s stand-in answers for main', () => {
  const callers: string[] = [];
  const walk = (dir: string): void => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, d.name);
      if (d.isDirectory()) walk(f);
      else if (/\.(js|ts|html)$/.test(d.name) && fs.readFileSync(f, 'utf8').includes('copyToolArg')) callers.push(path.relative(ROOT, f).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'src', 'renderer'));
  assert.deepStrictEqual(callers.sort(), ['src/renderer/app.js', 'src/renderer/sim.ts'], 'CALLERS only app.js and the simulator name copyToolArg');
  const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  assert.deepStrictEqual(app.match(/bridge\.copyToolArg\(/g), ['bridge.copyToolArg('], 'CALLERS app.js sends the request in one place (copyChipArg)');
  assert.ok(/bridge\.copyToolArg\(cp\.sid,cp\.callId,ok\)/.test(app), 'CALLERS the request carries the session id, the call id and the confirm only');
});

// ---- every path that removes or replaces a session forgets its values; End keeps them (the chat and its chips stay on screen). The real
// handlers of `src/main/ipc/{agents,folders,previous}.ts` on a stand-in electron, each with a real store (merge of main, review round 2)
async function removalPaths(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, dialog: {}, shell: {}, app: { getVersion: () => '0.0.0-test' }, BrowserWindow: class {} } } as unknown as NodeJS.Module;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const agentsIpc = require('../src/main/ipc/agents') as typeof import('../src/main/ipc/agents');
    const foldersIpc = require('../src/main/ipc/folders') as typeof import('../src/main/ipc/folders');
    const previousIpc = require('../src/main/ipc/previous') as typeof import('../src/main/ipc/previous');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const { pathToFileURL } = require('url') as typeof import('url'); // eslint-disable-line @typescript-eslint/no-require-imports
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href }; // the window ipcguard knows (next to the compiled main code)
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = async (ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => {
      const h = handlers.get(ch);
      assert.ok(h, `${ch} is registered`);
      return (await h(win, ...a)) as Record<string, unknown>;
    };
    /** Two sessions of one folder (s1, s2) and one of another (t1), each with a kept masked value; a router whose adapter stops nothing. */
    const office = () => {
      handlers.clear();
      const { store } = fake();
      const agents = new Map<string, Record<string, unknown>>();
      for (const [id, cwd] of [['s1', '/w/a'], ['s2', '/w/a'], ['t1', '/w/b']]) {
        agents.set(id, { id, name: id, cwd, folders: [cwd], permMode: 'read-only', status: 'ready', adapterId: 'fake' });
        const e = ev({ command: MASKED_OPT }, { sessionId: id, callId: 'c' });
        store.see(e, outward(e));
      }
      const ad = {
        stop: async () => undefined,
        isLive: () => true,
        capabilities: {},
        listPreviousSessions: async () => [{ id: 'old-1', title: 'Untitled session' }],
      };
      const router = { forAgent: (id: string) => (agents.has(id) || id === 'r1' ? ad : undefined), unbind: () => undefined, bind: () => undefined, adapterIdOf: () => 'fake' };
      const agentState = { remove: () => undefined, ensure: () => undefined };
      const forgetToolCopies = (id: string): void => store.forget(id);
      const common = { agents, router, agentState, getScheduler: () => undefined, vsChatRefs: new Map(), wsKey: (a: { cwd: string }) => a.cwd, forgetToolCopies };
      agentsIpc.register({ ...common, autopilot: { stopSeen: () => undefined, forget: () => undefined, setAutopilot: async () => ({ ok: true }) }, opsDeps: {}, remoteOps: { release: async () => undefined }, mcpSecrets: () => [], getCheckpointStore: () => undefined, continued: new Map(), asEffort: () => undefined, addMany: async () => ({ ok: true, agents: [] }), addWorkspace: async () => ({}), sendOp: async () => ({ ok: true }), ensureLive: async () => undefined, readyAdapterIds: async () => new Set(), forgetOpenSession: () => undefined, maskHistory: (_i: unknown, h: unknown) => h } as never);
      foldersIpc.register({ ...common, getFolderStore: () => undefined } as never);
      previousIpc.register({ ...common, renameSessionOpFor: () => () => undefined, dev: {}, registry: { get: () => undefined }, getFolderStore: () => undefined, resumeIdFor: (id: string) => id, forgetOpenSession: () => undefined, logActivity: () => undefined, maskHistory: (_i: unknown, h: unknown) => h, addWorkspace: async () => { const r1 = { id: 'r1', name: 'r1', cwd: '/w/a', folders: ['/w/a'], permMode: 'read-only', status: 'ready', adapterId: 'fake' }; agents.set('r1', r1); return r1; } } as never);
      const held = (id: string): boolean => store.copy(id, 'c', true).ok === true;
      return { store, agents, held };
    };
    {
      const o = office();
      await call('agents:end', 's1');
      assert.ok(o.held('s1'), 'END-KEEPS an ended session that is still listed keeps its values (its chips stay on screen)');
      assert.strictEqual((await call('agents:remove', 's1')).ok, true);
      assert.ok(!o.held('s1'), 'FORGET-REMOVE Remove session forgets the session\'s values');
      assert.ok(o.held('s2') && o.held('t1'), 'FORGET-REMOVE the other sessions keep theirs');
      n++; console.log('  ok REMOVE Remove session forgets; End keeps');
    }
    {
      const o = office();
      const r = await call('folders:remove', 's1');
      assert.strictEqual(r.ok, true, 'folders:remove ran');
      assert.ok(!o.held('s1') && !o.held('s2'), 'FORGET-FOLDER Remove folder forgets every session of the folder');
      assert.ok(o.held('t1'), 'FORGET-FOLDER another folder\'s session keeps its values');
      n++; console.log('  ok FOLDER Remove folder forgets each of its sessions');
    }
    {
      const o = office();
      const r = await call('sessions:resume', 's1', 'old-1', true);
      assert.strictEqual(r.ok, true, `sessions:resume with replace ran: ${String(r.error)}`);
      assert.strictEqual(r.removedId, 's1', 'it replaced s1');
      assert.ok(!o.held('s1'), 'FORGET-REPLACE Resume with replace forgets the replaced session\'s values');
      assert.ok(o.held('s2') && o.held('t1'), 'FORGET-REPLACE the other sessions keep theirs');
      const k = office();
      const r2 = await call('sessions:resume', 's1', 'old-1', false);
      assert.strictEqual(r2.ok, true, 'sessions:resume without replace ran');
      assert.ok(k.held('s1'), 'FORGET-REPLACE without replace the opener stays and keeps its values');
      n++; console.log('  ok REPLACE Resume with replace forgets the replaced session; without replace nothing is forgotten');
    }
  } finally {
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
  }
}

void removalPaths().then(
  () => console.log(`test:toolargcopy: ${n} checks passed`),
  (err) => { console.error(err); process.exit(1); },
);
