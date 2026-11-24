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
 * FORGET-REPLACE, END-KEEPS). PR 1 of 2: no window code calls the channel yet (INERT; T504 flips it).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createToolArgsMasker, maskMcpEvent } from '../src/main/mcpmask';
import { TOOL_COPY_CALLS_MAX, TOOL_COPY_MAX_CHARS, TOOL_COPY_TOTAL_MAX, createToolArgCopies, toolArgKey } from '../src/main/toolargcopy';
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
  assert.strictEqual(store.size().calls, 3);
  store.forget('s1');
  assert.deepStrictEqual(store.copy('s1', 'a'), { ok: false, reason: 'unknown' }, 'STALE the removed session\'s call is unknown');
  assert.deepStrictEqual(store.copy('s1', 'b'), { ok: false, reason: 'unknown' }, 'STALE');
  assert.deepStrictEqual(store.size(), { calls: 1, chars: 'echo s2a'.length }, 'STALE size drops');
  assert.deepStrictEqual(store.copy('s2', 'a'), { ok: true }, 'another session keeps its values');
  assert.deepStrictEqual(writes, ['echo s2a']);
  store.forget(''); store.forget(5 as unknown as string);
  assert.strictEqual(store.size().calls, 1, 'a malformed id forgets nothing');
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

// ---- PR 1 of 2 (the main side): nothing in the window calls the channel yet, so Copy on a chip still copies the masked text it shows
// (FR-342 as on main). T504 (PR 2, the window side) adds the one caller and the simulator's stand-in, and flips this assert.
ok('INERT no window code calls copyToolArg until T504', () => {
  const callers: string[] = [];
  const walk = (dir: string): void => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, d.name);
      if (d.isDirectory()) walk(f);
      else if (/\.(js|ts|html)$/.test(d.name) && fs.readFileSync(f, 'utf8').includes('copyToolArg')) callers.push(path.relative(ROOT, f));
    }
  };
  walk(path.join(ROOT, 'src', 'renderer'));
  assert.deepStrictEqual(callers, [], 'INERT the window names copyToolArg nowhere (T504 adds the chip\'s Copy and the simulator\'s stand-in)');
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
