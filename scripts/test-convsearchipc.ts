/**
 * Spec 095 T020-T025: the conversation search's IPC and main wiring, by behaviour. `search:start` / `search:cancel` are registered on a
 * stand-in for the electron module and called as the window would call them: refused from another page, query bounds (FR-033), a random
 * 128-bit `searchId`, a stale or unknown id ignored, two starts make one scan, nothing from the window names a folder or a path, events
 * only to the window that started the scan and nothing after it goes away, nothing raw in a payload (SC-002). The scope builder
 * (`buildScope`, T021) runs on fake adapters, a fake folder store and fake readers. Source checks: not reachable from the MCP tools,
 * remote control or schedules; no channel open under the simulator; the simulator's copy of the query rule equals main's.
 * `npm run test:convsearchipc`. No Electron, no network, no real store, no credits.
 */
import './safetext-shared'; // the compiled hidden-character module for safetext.js (spec 084 FR-033), as test-convmask and test-convsearch
process.exitCode = 1;
let stage = 'load';
process.on('exit', (code) => { if (code) console.error(`convsearchipc: failed or never settled in: ${stage}`); });
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { EventEmitter } from 'events';
import type { AgentInfo, ConvSearchEvent, ConvSearchStart } from '../src/shared/api';
import type { HistoryLimits, HistoryResult, PreviousSession } from '../src/adapters/history';
import { SEARCH_HISTORY_LIMITS } from '../src/adapters/history';
import type { ChatFileRef } from '../src/adapters/vscodeChat';

const ROOT = ((): string => {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'renderer'))) return d;
    if (path.dirname(d) === d) throw new Error('repo root not found');
  }
})();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const tick = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
const settle = async (n = 50): Promise<void> => { for (let i = 0; i < n; i++) await tick(); };
const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const MCP_VALUE = 'mcp-' + 'folder-value-9431';
const HOME = '/Users/' + 'alice';

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined } } } as unknown as NodeJS.Module;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { register, cleanQuery, QUERY, SHORT, NONE } = require('../src/main/ipc/convsearch') as typeof import('../src/main/ipc/convsearch');
  const { CODEX_LIST_GATE_MS, CODEX_LIST_TTL_MS, SCOPE_LIST_MS, buildScope, createCodexListCache } = require('../src/main/convscope') as typeof import('../src/main/convscope');
  type Scope = import('../src/main/convscope').Scope;
  type ScopeDeps = import('../src/main/convscope').ScopeDeps;
  const { DEFAULT_TIMEOUT_MS: CODEX_RPC_TIMEOUT_MS } = require('../src/adapters/codexRpc') as typeof import('../src/adapters/codexRpc');
  const { createReadGate, orderPlan, rendererScript } = require('../src/main/convsearch') as typeof import('../src/main/convsearch');
  const { createMasker } = require('../src/main/convmask') as typeof import('../src/main/convmask');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const MAIN_DIR = path.join(ROOT, 'src', 'main');
  const search = rendererScript<import('../src/main/convsearch').SessionSearchApi>('sessionsearch.js', MAIN_DIR);
  const ST = rendererScript<{ unhide(s: string): string }>('safetext.js', MAIN_DIR);
  const masker = createMasker({ unhide: (s) => ST.unhide(s) });

  // ---- FR-033: the query bounds (pure)

  stage = 'query bounds';
  {
    const ok = (q: unknown) => { const r = cleanQuery(q); assert.ok(r.ok, `${JSON.stringify(q)} is searched`); return r as { ok: true; query: string; cut: boolean }; };
    const short = (q: unknown) => assert.deepStrictEqual(cleanQuery(q), { ok: false, code: 'short' }, `${JSON.stringify(q)} is too short`);
    assert.deepStrictEqual(ok('a bc'), { ok: true, query: 'a bc', cut: false }, '"a bc" has 3 characters: allowed (Q3)');
    short('x y');
    short('  ab  ');
    short('');
    short('   ');
    short('a\u0000b');
    assert.deepStrictEqual(ok('  invoice   export \t').query, 'invoice export', 'trimmed, one space between words');
    assert.strictEqual(ok('\u{1D4B3}\u{1D4B4}\u{1D4B5}').query.length, 6, 'three astral characters are 3 code points: allowed');
    short('\u{1D4B3}\u{1D4B4}');
    assert.strictEqual(ok('ab\u0000c\u001bd\u007fe\u0085f').query, 'ab c d e f', 'control characters out (as spaces, never gluing two words)');
    const nine = ok('one two three four five six seven eight nine');
    assert.deepStrictEqual([nine.query.split(' ').length, nine.cut], [QUERY.maxWords, true], 'at most 8 words, and the cut is said');
    const long = ok('x'.repeat(250));
    assert.deepStrictEqual([[...long.query].length, long.cut], [QUERY.maxChars, true], 'at most 200 characters');
    const astral = ok('\u{1F600}'.repeat(205));
    assert.strictEqual([...astral.query].length, 200, 'cut in code points, never inside a surrogate pair');
    assert.ok(!/[\uD800-\uDBFF]$/.test(astral.query));
    const huge = 'word '.repeat(200_000);
    const t0 = Date.now();
    assert.strictEqual(ok(huge).cut, true);
    assert.ok(Date.now() - t0 < 200, 'a huge query is bounded before it is split');
    // review of phase 2 (R4): the input is cut to 800 characters before it is split, so a word far behind is never reached
    assert.deepStrictEqual(ok('abc' + ' '.repeat(900) + 'def'), { ok: true, query: 'abc', cut: true });
    short('ab' + ' '.repeat(900) + 'cd');
    assert.deepStrictEqual(ok('.* (a|b)+ [x]').query, '.* (a|b)+ [x]', 'the query is plain text, never a pattern');
    for (const v of [undefined, null, 42, ['abc'], { q: 'abc' }]) assert.deepStrictEqual(cleanQuery(v), { ok: false, code: 'invalid' });
    assert.strictEqual(SHORT, 'Type at least 3 characters.');
    // review of the phase 2 code (FR-033): hidden format characters are control characters too: removed (gluing, not spacing), never echoed
    short('\u200b\u200b\u200b');
    short('\u202e\u202e\u202e');
    short('\u2060\u00ad\ufeff');
    assert.strictEqual(ok('a\u200bbc').query, 'abc', 'a zero-width space inside a word does not split or hide it');
    short('a\u200bb'); // "ab": two characters
    assert.strictEqual(ok('inv\u00adoice').query, 'invoice', 'a soft hyphen is removed');
    assert.strictEqual(ok('\u202einvoice\u2060 export').query, 'invoice export', 'no bidi override or word joiner in the echo');
  }

  // ---- T020: the channels, on the stand-in electron

  stage = 'channels';
  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href; // what ipcguard.ts takes as the app's page (next to the compiled main)
  class Sender extends EventEmitter {
    sent: Array<[string, ConvSearchEvent]> = [];
    dead = false;
    send(ch: string, p: ConvSearchEvent): void { this.sent.push([ch, JSON.parse(JSON.stringify(p))]); }
    isDestroyed(): boolean { return this.dead; }
  }
  const windowOf = (s: Sender) => { const frame = { url: indexUrl }; (s as unknown as { mainFrame: unknown }).mainFrame = frame; return { senderFrame: frame, sender: s }; };
  const win1 = new Sender();
  const win2 = new Sender();
  const E1 = windowOf(win1);
  const E2 = windowOf(win2);
  const other = { url: 'https://example.invalid/' };
  const foreign = { senderFrame: other, sender: { mainFrame: other } };

  let sessions = 2;
  const scopeCalls: unknown[][] = [];
  const stops: Array<() => boolean> = [];
  const NOTES0 = { floorOffFolders: 0, mcpValuesLocked: false, lateLists: 0, lateApps: [] as string[] };
  let scopeOf: () => Scope = () => ({ plan: { sessions: [] }, read: async () => ({ ok: true, items: [] }), values: () => [], notes: NOTES0 });
  let hold: Promise<void> | undefined;
  const deferred: Array<() => void> = [];
  const cache = createCodexListCache();
  const ipc = register({
    codexLists: cache,
    hasSessions: () => sessions > 0,
    scope: async (...a: unknown[]) => { scopeCalls.push(a); stops.push(a[0] as () => boolean); if (hold) await hold; return scopeOf(); },
    matcher: () => ({ masker, search }),
    defer: (fn) => { deferred.push(fn); },
    sleep: () => tick(), // the 250 ms between batches, without waiting
  });
  const runDeferred = (): void => { for (const fn of deferred.splice(0)) fn(); };
  assert.deepStrictEqual([...handlers.keys()].sort(), ['search:cancel', 'search:clear', 'search:start'], 'the three channels');
  const start = (e: unknown, ...a: unknown[]) => Promise.resolve().then(() => handlers.get('search:start')!(e, ...a)) as Promise<ConvSearchStart>;
  const cancel = (e: unknown, ...a: unknown[]) => Promise.resolve().then(() => handlers.get('search:cancel')!(e, ...a)) as Promise<{ ok: boolean }>;

  // not from the app's own page: refused before the handler (ipcHandle), so nothing is planned

  await assert.rejects(start(foreign, 'invoice'), /did not come from its own window/);
  await assert.rejects(cancel(foreign, 'f'.repeat(32)), /did not come from its own window/);
  runDeferred();
  assert.strictEqual(scopeCalls.length, 0);

  // bounds enforced in main: a short query gets no scan

  assert.deepStrictEqual(await start(E1, 'x y'), { ok: false, code: 'short', error: SHORT });
  assert.deepStrictEqual((await start(E1, 42)).ok, false);
  sessions = 0;
  assert.deepStrictEqual(await start(E1, 'invoice'), { ok: false, code: 'none', error: NONE }, 'no session open: nothing to search, no scan');
  sessions = 2;
  runDeferred();
  assert.strictEqual(scopeCalls.length, 0, 'no plan for a refused query');

  // a plan with secrets, a home path and an MCP value in its messages; the payload walks clean (SC-002, FR-031)

  const sess = (over: Partial<import('../src/main/convsearch').PlanSession>): import('../src/main/convsearch').PlanSession => ({ adapter: 'claude', app: 'Claude Code', folderKey: HOME + '/work/demo', folderName: 'demo', sessionId: 's1', agentId: 'a1', group: 'office', title: 'Untitled session', time: 0, content: 'read', ...over });
  scopeOf = () => ({
    plan: { sessions: [sess({ sessionId: 'a1' }), sess({ sessionId: 'p1', group: 'earlier', title: `invoice plan ${GH}` }), sess({ sessionId: 'p2', group: 'earlier', adapter: 'copilot', content: 'title', title: 'nothing here' })] },
    read: async (s) => (s.sessionId === 'a1'
      ? { ok: true, items: [{ type: 'user', text: `Look at ${HOME}/work/demo/invoice.ts and the export, token ${GH}, value ${MCP_VALUE}` }, { type: 'tool', callId: 'c', tool: 'grep', label: 'grep invoice export' }, { type: 'output', text: `The invoice export is fixed; key ${MCP_VALUE} unchanged.` }] }
      : { ok: true, items: [{ type: 'output', text: 'the invoice export again' }] }),
    values: () => [MCP_VALUE],
    notes: { floorOffFolders: 2, mcpValuesLocked: true, lateLists: 0, lateApps: [] },
  });
  const r1 = await start(E1, 'invoice export', '/etc', { folder: '/etc' }, 'a1');
  assert.ok(r1.ok && /^[0-9a-f]{32}$/.test(r1.searchId), `a random 128-bit id: ${JSON.stringify(r1)}`);
  if (!r1.ok) throw new Error('unreachable');
  assert.strictEqual(win1.sent.length, 0, 'no event before the answer (the scan is deferred)');
  runDeferred();
  await settle(400);
  assert.strictEqual(scopeCalls.length, 1);
  assert.strictEqual(scopeCalls[0].length, 2, 'the scope gets a stop function and main\'s own cache: nothing the window sent (no folder, path or session)');
  assert.strictEqual(typeof scopeCalls[0][0], 'function');
  assert.strictEqual(scopeCalls[0][1], cache, 'the second is main\'s box-session cache (FR-026)');
  const evs = win1.sent.map(([ch, p]) => [ch, p] as const);
  assert.ok(evs.length >= 2 && evs.every(([ch, p]) => p.searchId === r1.searchId && ch === `search:${p.kind}`), 'every event carries the id, on its own channel');
  const done = evs[evs.length - 1][1];
  assert.ok(done.kind === 'done' && !done.failed && done.notes.queryCut === false && done.notes.titleOnly.count === 1, JSON.stringify(done));
  assert.ok(done.kind === 'done' && done.notes.floorOffFolders === 2 && done.notes.mcpValuesLocked === true, 'owner answers C and D reach the end state');
  const hits = evs.flatMap(([, p]) => (p.kind === 'batch' ? p.hits : []));
  assert.deepStrictEqual(hits.map((h) => h.sessionId).sort(), ['a1', 'p1'], 'the open session by content, the earlier one by its masked title');
  const a1 = hits.find((h) => h.sessionId === 'a1')!;
  assert.deepStrictEqual(Object.keys(a1).sort(), ['adapter', 'agentId', 'app', 'excerpts', 'folderName', 'group', 'more', 'sessionId', 'time', 'title', 'titleMarks'], 'FR-031: only these fields');
  assert.ok(a1.excerpts.length >= 1 && a1.excerpts.every((x) => x.marks.length > 0));
  const all = JSON.stringify(win1.sent);
  for (const bad of [GH, GH.slice(6, 20), MCP_VALUE, HOME, 'alice', 'grep invoice']) assert.ok(!all.includes(bad), `no "${bad}" in any payload`);
  assert.strictEqual(win2.sent.length, 0, 'the other window gets nothing');

  // review of the phase 2 code (FR-031): `toHit` is the only way a hit reaches the window; a hit object that carries more (a folder
  // key with a home path, an excerpt's file) loses it. The scan builds its hits by hand, so the test stands in for it (restored below).
  {
    const scanMod = require('../src/main/convsearch') as { startScan: unknown }; // eslint-disable-line @typescript-eslint/no-require-imports
    const realScan = scanMod.startScan;
    const leaky = { adapter: 'claude', sessionId: 'leak1', agentId: 'a1', group: 'office', app: 'Claude Code', folderName: 'demo', title: 'invoice', titleMarks: [[0, 7]], time: 1, more: 0, folderKey: HOME + '/work/demo', file: HOME + '/.claude/projects/x.jsonl', excerpts: [{ text: 'invoice', marks: [[0, 7]], speaker: 'you', anchor: { n: 1, head: 'invoice', path: HOME + '/x' }, raw: MCP_VALUE }] };
    scanMod.startScan = (_plan: unknown, _q: string, d: { emit(b: unknown): void }) => {
      d.emit({ hits: [leaky], progress: { done: 1, total: 1 }, groups: { office: 1, earlier: 0 } });
      return { cancel: () => undefined, done: Promise.resolve({ cancelled: false, failed: false, notes: {}, progress: { done: 1, total: 1 } }) };
    };
    try {
      win1.sent.length = 0;
      const rl = await start(E1, 'invoice');
      assert.ok(rl.ok);
      runDeferred();
      await settle(100);
      const got = win1.sent.flatMap(([, p]) => (p.kind === 'batch' ? p.hits : []));
      assert.strictEqual(got.length, 1);
      assert.deepStrictEqual(Object.keys(got[0]).sort(), ['adapter', 'agentId', 'app', 'excerpts', 'folderName', 'group', 'more', 'sessionId', 'time', 'title', 'titleMarks']);
      assert.deepStrictEqual(Object.keys(got[0].excerpts[0]).sort(), ['anchor', 'marks', 'speaker', 'text']);
      assert.deepStrictEqual(Object.keys(got[0].excerpts[0].anchor).sort(), ['head', 'n']);
      const wire = JSON.stringify(win1.sent);
      for (const bad of [HOME, MCP_VALUE, 'folderKey', '.jsonl']) assert.ok(!wire.includes(bad), `no "${bad}" in a payload`);
    } finally {
      scanMod.startScan = realScan;
    }
    win1.sent.length = 0;
  }

  // two starts back to back: one scan (the first never builds a plan), the second's events only

  win1.sent.length = 0;
  scopeCalls.length = 0;
  const ra = await start(E1, 'invoice');
  const rb = await start(E1, 'export');
  assert.ok(ra.ok && rb.ok && ra.searchId !== rb.searchId, 'a new id per start');
  if (!ra.ok || !rb.ok) throw new Error('unreachable');
  runDeferred();
  await settle(400);
  assert.strictEqual(scopeCalls.length, 1, 'two starts = one scan');
  assert.ok(win1.sent.length > 0 && win1.sent.every(([, p]) => p.searchId === rb.searchId), 'only the second search speaks');
  assert.strictEqual(ipc.live(), undefined, 'a finished scan is not live');

  // a start while the first is building its plan: the first stops (its stop() says so) and sends nothing

  win1.sent.length = 0;
  stops.length = 0;
  let release!: () => void;
  hold = new Promise<void>((r) => { release = r; });
  const rc = await start(E1, 'invoice');
  runDeferred();
  await settle(5);
  assert.strictEqual(stops.length, 1);
  const rd = await start(E1, 'export');
  assert.strictEqual(stops[0](), true, 'the first scan is told to stop');
  runDeferred();
  hold = undefined;
  release();
  await settle(400);
  assert.ok(rc.ok && rd.ok && win1.sent.every(([, p]) => p.searchId === (rd as { searchId: string }).searchId), 'nothing from the cancelled scan');

  // cancel: a stale, unknown, malformed or other window's id is ignored; the live id stops the scan, and no done follows

  win1.sent.length = 0;
  hold = new Promise<void>((r) => { release = r; });
  const re = await start(E1, 'invoice');
  if (!re.ok) throw new Error('start');
  runDeferred();
  await settle(5);
  assert.deepStrictEqual(await cancel(E1, (rd as { searchId: string }).searchId), { ok: false }, 'a stale id is ignored');
  assert.deepStrictEqual(await cancel(E1, 'f'.repeat(32)), { ok: false }, 'an unknown id is ignored');
  assert.deepStrictEqual(await cancel(E1, re.searchId.toUpperCase()), { ok: false });
  assert.deepStrictEqual(await cancel(E1, { searchId: re.searchId }), { ok: false });
  assert.deepStrictEqual(await cancel(E2, re.searchId), { ok: false }, 'another window cannot stop it');
  assert.strictEqual(ipc.live(), re.searchId, 'still live');
  assert.deepStrictEqual(await cancel(E1, re.searchId), { ok: true });
  assert.strictEqual(ipc.live(), undefined);
  hold = undefined;
  release();
  await settle(200);
  assert.strictEqual(win1.sent.length, 0, 'a cancelled scan sends nothing');
  assert.deepStrictEqual(await cancel(E1, re.searchId), { ok: false }, 'and its id is stale now');

  // FR-023: the window going away (closed, or loading again) ends its scan; cancelAll (window close, quit) too

  for (const how of ['destroyed', 'did-start-loading', 'cancelAll'] as const) {
    win1.sent.length = 0;
    hold = new Promise<void>((r) => { release = r; });
    const rf = await start(E1, 'invoice');
    runDeferred();
    await settle(5);
    if (how === 'cancelAll') ipc.cancelAll();
    else win1.emit(how);
    assert.strictEqual(ipc.live(), undefined, `${how} stops the scan`);
    assert.strictEqual(stops[stops.length - 1](), true);
    hold = undefined;
    release();
    await settle(200);
    assert.ok(rf.ok);
    if (how === 'cancelAll') {
      // review of phase 2 (R2): a stop main starts tells the window once, so a cancelled close or quit does not leave it searching
      assert.deepStrictEqual(win1.sent.map(([ch, p]) => [ch, p.kind, p.searchId === (rf as { searchId: string }).searchId, p.kind === 'done' && p.stopped, p.kind === 'done' && p.failed]), [['search:done', 'done', true, true, false]], 'exactly one done, marked stopped');
    } else assert.strictEqual(win1.sent.length, 0, `${how}: the page that asked is gone, nothing sent`);
  }
  // a running scan (batches already sent) stopped by main: one stopped done with the last progress, nothing after it
  {
    win1.sent.length = 0;
    let gate!: () => void;
    const slowRead = new Promise<void>((r) => { gate = r; });
    scopeOf = () => ({ plan: { sessions: [sess({ sessionId: 'r1', title: 'invoice one' }), sess({ sessionId: 'r2' })] }, read: async () => { await slowRead; return { ok: true, items: [{ type: 'output', text: 'invoice' }] }; }, values: () => [], notes: NOTES0 });
    const rr = await start(E1, 'invoice');
    runDeferred();
    for (let i = 0; i < 400 && !win1.sent.length; i++) await tick();
    assert.ok(rr.ok && win1.sent.length === 1 && win1.sent[0][1].kind === 'batch', 'the title hit was sent');
    ipc.cancelAll();
    gate();
    await settle(200);
    const tail = win1.sent.slice(1);
    assert.strictEqual(tail.length, 1);
    const fin = tail[0][1];
    assert.ok(fin.kind === 'done' && fin.stopped === true && fin.progress.done === 1 && fin.progress.total === 2, JSON.stringify(fin));
    ipc.cancelAll();
    await settle(20);
    assert.strictEqual(win1.sent.length, 2, 'a second cancelAll with nothing live sends nothing');
    win1.dead = true;
    win1.sent.length = 0;
    const rx = await start(E1, 'invoice');
    runDeferred();
    ipc.cancelAll();
    await settle(50);
    assert.ok(rx.ok && win1.sent.length === 0, 'nothing to a window that is gone');
    win1.dead = false;
  }
  assert.ok(win1.listenerCount('destroyed') === 1 && win1.listenerCount('did-start-loading') === 1, 'one listener per window, not one per search');

  // a scope that throws: said with a failed done, never silent

  win1.sent.length = 0;
  scopeOf = () => { throw new Error('store not ready'); };
  const rg = await start(E1, 'invoice');
  runDeferred();
  await settle(50);
  assert.ok(rg.ok);
  assert.deepStrictEqual(win1.sent.map(([ch, p]) => [ch, p.kind, p.kind === 'done' && p.failed]), [['search:done', 'done', true]]);
  // ... but a scan cancelled while its plan was built says nothing, even when that plan then fails
  win1.sent.length = 0;
  hold = new Promise<void>((r) => { release = r; });
  const rh = await start(E1, 'invoice');
  runDeferred();
  await settle(5);
  assert.ok(rh.ok && (await cancel(E1, rh.searchId)).ok);
  hold = undefined;
  release();
  await settle(50);
  assert.strictEqual(win1.sent.length, 0, 'nothing from a cancelled scan, not even its failure');

  // ---- FR-026 (owner answer C): the box session's kept Codex titles live as long as the box session, in main's memory only
  {
    const clear = (e: unknown) => Promise.resolve().then(() => handlers.get('search:clear')!(e)) as Promise<{ ok: boolean }>;
    await assert.rejects(clear(foreign), /did not come from its own window/);
    const fill = (): void => cache.set('/w/x', [], [{ id: 't1', title: 'kept', startTime: 1, modifiedTime: 2 }], Date.now());
    scopeOf = () => ({ plan: { sessions: [] }, read: async () => ({ ok: true, items: [] }), values: () => [], notes: NOTES0 });
    // the box cleared or closed: the window's scan stops without a done, and the kept titles go
    win1.sent.length = 0;
    hold = new Promise<void>((r) => { release = r; });
    const rc0 = await start(E1, 'invoice');
    runDeferred();
    await settle(5);
    fill();
    assert.deepStrictEqual(await clear(E1), { ok: true });
    assert.ok(rc0.ok && ipc.live() === undefined && cache.size() === 0, 'search:clear stops the scan and drops the cache');
    hold = undefined;
    release();
    await settle(100);
    assert.strictEqual(win1.sent.length, 0, 'the window asked: no done');
    // repeated searches keep it; main's stop, the window going away or another window's search drop it
    await start(E1, 'invoice'); // the box session of this window begins; its search fills the cache
    runDeferred();
    await settle(100);
    fill();
    const rk = await start(E1, 'invoice');
    runDeferred();
    await settle(100);
    assert.ok(rk.ok && cache.size() === 1, 'a new search of the same window keeps the kept titles');
    ipc.cancelAll();
    assert.strictEqual(cache.size(), 0, 'main\'s stop (window close or hide, quit) drops them');
    for (const how of ['destroyed', 'did-start-loading'] as const) {
      await start(E1, 'invoice');
      runDeferred();
      await settle(100);
      fill();
      win1.emit(how);
      assert.strictEqual(cache.size(), 0, `${how} drops them`);
    }
    await start(E1, 'invoice');
    runDeferred();
    await settle(100);
    fill();
    await start(E2, 'invoice');
    assert.strictEqual(cache.size(), 0, 'another window\'s search does not reuse this window\'s box session');
    runDeferred();
    await settle(100);
    win1.sent.length = 0;
    win2.sent.length = 0;
    // review of PR 1232 (Q2): another window's clear leaves this box session's titles alone; its own clear drops them
    await start(E1, 'invoice');
    runDeferred();
    await settle(100);
    fill();
    assert.deepStrictEqual(await clear(E2), { ok: true });
    assert.strictEqual(cache.size(), 1, 'window B\'s clear keeps window A\'s kept titles');
    assert.deepStrictEqual(await clear(E1), { ok: true });
    assert.strictEqual(cache.size(), 0, 'window A\'s own clear drops them');
    // review of PR 1232 (R1): another window's clear never stops this window's scan: A still gets its batch and its done
    win1.sent.length = 0;
    scopeOf = () => ({ plan: { sessions: [sess({ sessionId: 'a1', title: 'invoice plan' })] }, read: async () => ({ ok: true, items: [] }), values: () => [], notes: NOTES0 });
    const ra = await start(E1, 'invoice');
    assert.deepStrictEqual(await clear(E2), { ok: true });
    runDeferred();
    await settle(200);
    assert.ok(ra.ok, 'A started');
    assert.deepStrictEqual(win1.sent.map(([ch]) => ch), ['search:batch', 'search:done'], 'A still gets its batch and its done after B\'s clear');
    assert.strictEqual(win2.sent.length, 0);
    win1.sent.length = 0;
  }

  // ---- T022: a hung Codex read cannot hold the gate; the next scan's read still runs

  stage = 'read gate timeout';
  {
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)); // main's default timer is unref'd; here it must keep the test alive
    const gate = createReadGate<string>({ timeoutMs: 20, wait });
    const hung = gate.run('read\0cx1', () => new Promise<string>(() => undefined));
    const next = gate.run('read\0cx2', async () => 'second');
    await assert.rejects(hung, /read timed out/, 'the hung read gives up');
    assert.strictEqual(await Promise.race([next, new Promise((r) => setTimeout(() => r('blocked'), 500))]), 'second', 'the next read ran');
    assert.strictEqual(gate.inFlight(), 0, 'nothing kept');
    const longer = createReadGate<string>({ timeoutMs: 20, wait });
    assert.strictEqual(await longer.run('list\0f', () => new Promise<string>((r) => setTimeout(() => r('slow list'), 60)), 500), 'slow list', 'a call with its own longer limit is not cut at the default');
    const quick = createReadGate<string>({ timeoutMs: 20, wait });
    assert.strictEqual(await quick.run('k', async () => 'fast'), 'fast', 'a read in time is untouched');
  }

  // ---- T021: the scope from main's state (fake adapters, store and readers)

  stage = 'scope builder';
  {
    const ag = (id: string, adapterId: string, cwd: string, over: Partial<AgentInfo> = {}): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', adapterId, ...over } as AgentInfo);
    const agents = new Map<string, AgentInfo>([
      ['c1', ag('c1', 'copilot', '/w/one', { title: 'Copilot one', alias: 'My copilot' })],
      ['c2', ag('c2', 'copilot', '/w/one')],
      ['k1', ag('k1', 'claude', '/w/one', { label: 'Room One' })],
      ['k2', ag('k2', 'claude', '/w/two', { floor: 'f2' })],
      ['x1', ag('x1', 'codex', '/w/three')],
      ['x2', ag('x2', 'codex', '/w/four')],
    ]);
    const lists: string[] = [];
    const histories: Array<[string, Partial<HistoryLimits> | undefined]> = [];
    const prev: Record<string, PreviousSession[]> = {
      'copilot /w/one': [{ id: 'cp1', title: 'copilot earlier', startTime: 1, modifiedTime: 10 }, { id: 'cp2', title: 'hidden one', startTime: 1, modifiedTime: 20 }],
      'claude /w/one': [{ id: 'kp1', title: 'claude earlier', startTime: 1, modifiedTime: 30 }],
      'claude /w/two': [{ id: 'kp2', title: 'on an off floor', startTime: 1, modifiedTime: 40 }],
      'codex /w/four': [{ id: 'xp1', title: 'codex earlier', startTime: 1, modifiedTime: 50 }],
    };
    const live = new Set(['c1', 'c2', 'x2']);
    const adapters = new Map<string, unknown>();
    for (const kind of ['copilot', 'claude', 'codex']) adapters.set(kind, {
      id: kind,
      isLive: (id: string) => live.has(id),
      history: async (id: string, limits?: Partial<HistoryLimits>): Promise<HistoryResult> => { histories.push([id, limits]); return { items: [{ type: 'user', text: `history of ${id}` }, { type: 'tool', callId: 'c', tool: 't', label: 'tool line' }], total: 2, truncated: false }; },
      listPreviousSessions: async (cwd: string, exclude?: ReadonlySet<string>) => {
        lists.push(`${kind} ${cwd}`);
        assert.ok(exclude && ['c1', 'c2', 'k1', 'k2', 'x1', 'x2'].every((i) => exclude.has(i)), 'open sessions are left out (openIdsOf)');
        if (kind === 'codex' && cwd === '/w/three') throw new Error('codex not signed in');
        return prev[`${kind} ${cwd}`] ?? [];
      },
    });
    const router = { forAgent: (id: string) => adapters.get(agents.get(id)!.adapterId) as never, adapterIdOf: (id: string) => agents.get(id)?.adapterId };
    const store = {
      get: (key: string) => (key === '/w/one' ? { workspace: key, prevHidden: [{ src: 'copilot', id: 'cp2' }, { src: 'claude', id: 'cp2' }] } : { workspace: key }) as never,
      sessionNames: (key: string) => (key === '/w/one' ? [{ src: 'claude', id: 'kp1', name: 'Named by me' }, { src: 'copilot', id: 'kp1', name: 'wrong app' }] : []) as never,
      floors: () => ({ floors: [{ id: 'ground', name: 'Ground floor', on: true }, { id: 'f2', name: 'Second', on: false }], lastFloor: 'ground' }),
    };
    const chatLists: string[] = [];
    const remembered: Array<[string, string]> = [];
    const ref = (key: string): ChatFileRef => ({ summary: { key, title: 'vs chat', updated: 60, requests: 1, format: 'json' }, file: '/secret/path/' + key + '.json' });
    const claudeReads: unknown[][] = [];
    const valueCalls: string[] = [];
    const gateKeys: string[] = [];
    const gateTimeouts: Array<number | undefined> = [];
    let gateHold: Promise<void> | undefined;
    let noPrompt = false;
    const scope = await buildScope({
      agents, router, store, wsKey: (a) => a.workspaceFile ?? a.cwd, resumeIdFor: (id) => (id === 'k1' ? 'k1-resume' : id), appName: (id) => ({ copilot: 'GitHub Copilot', claude: 'Claude Code', codex: 'Codex' }[id] ?? id),
      vsUserDirs: () => [{ product: 'Test', dir: '/vs' }],
      rememberChat: (agentId, r) => remembered.push([agentId, r.summary.key]),
      values: { knownSecretValues: (k) => { valueCalls.push('known:' + k); return ['known-value-' + k.length]; }, noPrompt: () => noPrompt, secretValuesFor: (id) => { valueCalls.push('session:' + id); return ['session-value-' + id]; } },
      gate: { run: (key, fn, ms) => { gateKeys.push(key); gateTimeouts.push(ms); return gateHold ? gateHold.then(fn) : fn(); } },
      claudeDir: '/claude-config',
      readClaude: (async (...a: unknown[]) => { claudeReads.push(a); return { ok: true, history: { items: [{ type: 'output', text: 'claude text' }], total: 1, truncated: false } }; }) as never,
      listChats: (async (_dirs: unknown, t: { folders: string[] }) => { chatLists.push(t.folders[0]); return { sessions: t.folders[0] === '/w/one' ? [ref('h/vs1')] : [], storesFound: 1, unreadable: 0, tooLarge: 0 }; }) as never,
      readChat: (async () => ({ ok: true, transcript: { title: 't', blocks: [{ type: 'user', text: 'vs question' }, { type: 'tool', label: 'vs tool' }, { type: 'assistant', text: 'vs answer' }, { type: 'note', text: 'n' }], totalRequests: 1, shownRequests: 1, notes: [] } })) as never,
    });
    const by = (id: string) => scope.plan.sessions.find((s) => s.sessionId === id)!;
    assert.deepStrictEqual(lists.sort(), ['claude /w/one', 'claude /w/two', 'codex /w/four', 'codex /w/three', 'copilot /w/one'], 'listed once per folder and app (two Copilot agents in /w/one: one list)');
    assert.deepStrictEqual(chatLists.sort(), ['/w/four', '/w/one', '/w/three', '/w/two'], 'VS Code chats once per folder');
    assert.deepStrictEqual(remembered, [['c1', 'h/vs1']], 'a listed chat can be opened with vschat:read (View)');
    assert.deepStrictEqual(scope.plan.unavailable, ['Codex'], 'an app whose list fails is named once');
    assert.deepStrictEqual(scope.plan.sessions.filter((s) => s.group === 'office').map((s) => s.sessionId), ['c1', 'c2', 'k1', 'k2', 'x1', 'x2'], 'the open agents, in the office order');
    assert.deepStrictEqual([by('c1').title, by('c2').title, by('k1').folderName, by('k1').content, by('x1').content, by('x2').content], ['My copilot', 'Untitled session', 'Room One', 'read', 'title', 'read'], 'names (spec 059), room names; a Codex agent with no live session is title only (no process started)');
    assert.deepStrictEqual([by('cp1').content, by('xp1').content, by('kp1').content, by('h/vs1').content], ['title', 'title', 'read', 'read'], 'earlier Copilot and Codex: title only (Q4, B); Claude Code and VS Code: content');
    assert.deepStrictEqual([by('kp1').title, by('cp2').hidden, by('cp1').hidden, by('kp1').hidden], ['Named by me', true, false, false], 'the user\'s name for that app only; hide marks per app');
    assert.deepStrictEqual([by('k2').floorOff, by('kp2').floorOff, by('c1').floorOff], [true, true, false], 'a floor that is off (Q9)');
    assert.ok(scope.plan.sessions.filter((s) => s.group === 'earlier').every((s) => s.agentId && agents.has(s.agentId)), 'an earlier session names an open agent of its folder (for Resume / View)');
    assert.ok(!JSON.stringify(scope.plan.sessions.map(({ folderKey: _k, ...s }) => s)).includes('/secret/path'), 'a chat file path never enters the plan');
    const o = orderPlan(scope.plan);
    assert.deepStrictEqual([o.notes.hidden, o.notes.floorsOff, o.notes.notInstalled], [1, 2, ['Codex']], 'hidden and off-floor sessions are skipped and counted');
    // the readers: the search limits, the streamed Claude read, the gate for Codex, VS Code text blocks only
    const stop = () => false;
    const rk = await scope.read(by('k1'), stop);
    assert.deepStrictEqual(claudeReads[0].slice(0, 4), ['k1-resume', '/w/one', SEARCH_HISTORY_LIMITS, '/claude-config'], 'an open Claude session: the streamed read of its resume id, with the search limits');
    assert.strictEqual((claudeReads[0][4] as { stop: unknown }).stop, stop);
    assert.ok(rk.ok && rk.items.length === 1);
    await scope.read(by('kp1'), stop);
    assert.deepStrictEqual(claudeReads[1].slice(0, 3), ['kp1', '/w/one', SEARCH_HISTORY_LIMITS]);
    const rc1 = await scope.read(by('c1'), stop);
    assert.deepStrictEqual(histories[0], ['c1', SEARCH_HISTORY_LIMITS], 'a live Copilot session: the adapter history with the search limits');
    assert.ok(rc1.ok && rc1.items.length === 2, 'the scan drops tool items itself (D2)');
    await scope.read(by('x2'), stop);
    assert.deepStrictEqual(gateKeys, ['list\0/w/three', 'list\0/w/four', 'read\0x2'], 'every Codex call that starts a process goes through the gate');
    // review of phase 2 (R3): a listing holds the gate longer than a probe can take (two 30 s requests and the close); a read keeps the default
    assert.deepStrictEqual(gateTimeouts, [CODEX_LIST_GATE_MS, CODEX_LIST_GATE_MS, undefined]);
    assert.ok(CODEX_LIST_GATE_MS > 2 * CODEX_RPC_TIMEOUT_MS + 3_500, `${CODEX_LIST_GATE_MS} ms is above the probe's worst case`);
    // review of phase 2 (R1): the session ends while its read waits at the gate: no history call (it would start an app-server)
    {
      let open!: () => void;
      gateHold = new Promise<void>((r) => { open = r; });
      const n = histories.length;
      const waiting = scope.read(by('x2'), stop);
      await settle(5);
      live.delete('x2');
      open();
      assert.deepStrictEqual(await waiting, { ok: false, reason: 'missing' }, 'it ended at the gate: skipped');
      assert.strictEqual(histories.length, n, 'history is never called for a session that is no longer live');
      gateHold = undefined;
      live.add('x2');
    }
    live.delete('c2');
    assert.deepStrictEqual(await scope.read(by('c2'), stop), { ok: false, reason: 'missing' }, 'a session that ended meanwhile is skipped');
    const rv = await scope.read(by('h/vs1'), stop);
    assert.deepStrictEqual(rv, { ok: true, items: [{ type: 'user', text: 'vs question' }, { type: 'output', text: 'vs answer' }] }, 'VS Code: user and answer blocks, in order');
    assert.deepStrictEqual(await scope.read(by('cp1'), stop), { ok: false, reason: 'unreadable' }, 'a title-only session has no reader');
    // FR-030: values without a keychain prompt
    valueCalls.length = 0;
    scope.values(by('c1'));
    scope.values(by('cp1'));
    assert.deepStrictEqual(valueCalls, ['known:/w/one', 'known:/w/one'], 'vault locked: the folder\'s known values only');
    noPrompt = true;
    valueCalls.length = 0;
    scope.values(by('c1'));
    scope.values(by('cp1'));
    assert.deepStrictEqual(valueCalls, ['known:/w/one', 'session:c1', 'known:/w/one'], 'the open agent\'s values only when nothing can prompt; an earlier session gets its folder\'s');
    // stop between folders
    lists.length = 0;
    await buildScope({ agents, router, store, wsKey: (a) => a.cwd, resumeIdFor: (id) => id, appName: (id) => id, vsUserDirs: () => [], values: { knownSecretValues: () => [], noPrompt: () => false, secretValuesFor: () => [] }, gate: { run: (_k, fn) => fn() }, listChats: (async () => ({ sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0 })) as never }, () => true);
    assert.strictEqual(lists.length, 0, 'a stopped search lists nothing more');
  }

  // ---- FR-026 (owner answer C): the cache itself, and buildScope with it; owner answer D: locked values said
  {
    const c = createCodexListCache(1000);
    const P = (id: string): PreviousSession => ({ id, title: id, startTime: 1, modifiedTime: 2 });
    c.set('/f', ['x1'], [P('a')], 0);
    assert.deepStrictEqual(c.get('/f', ['x1'], 999)?.map((p) => p.id), ['a'], 'kept within its time');
    assert.deepStrictEqual(c.get('/f', ['x1', 'x9'], 999)?.map((p) => p.id), ['a'], 'a new Codex agent in the folder does not drop it');
    assert.strictEqual(c.get('/f', ['x1'], 1000), undefined, 'older than its time: dropped');
    assert.strictEqual(c.size(), 0);
    c.set('/f', ['x1', 'x2'], [P('a')], 0);
    assert.strictEqual(c.get('/f', ['x2'], 10), undefined, 'an open Codex session left the office: dropped (it is an earlier session now)');
    c.set('/f', [], [P('a')], 50);
    assert.strictEqual(c.get('/f', [], 10), undefined, 'a clock that went back: dropped');
    c.set('/f', [], [P('a')], 0);
    c.get('/f', [], 1)![0].title = 'changed';
    assert.strictEqual(c.get('/f', [], 1)![0].title, 'a', 'a copy is handed out');
    c.clear();
    assert.strictEqual(c.size(), 0);
    assert.strictEqual(CODEX_LIST_TTL_MS, 5 * 60_000);

    const ag = (id: string, adapterId: string, cwd: string, floor?: string): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', adapterId, ...(floor ? { floor } : {}) } as AgentInfo);
    const agents = new Map<string, AgentInfo>([['x1', ag('x1', 'codex', '/c/one')], ['x2', ag('x2', 'codex', '/c/one')], ['x3', ag('x3', 'codex', '/c/off', 'up')]]);
    const listed: string[] = [];
    let fail = false;
    const codex = { id: 'codex', isLive: () => false, listPreviousSessions: async (cwd: string, ex?: ReadonlySet<string>) => { listed.push(cwd); if (fail) throw new Error('no'); return [P('t1'), P('t2'), P('x2')].filter((p) => !ex?.has(p.id)); } };
    let noPrompt = true;
    let clock = 1000;
    const cache2 = createCodexListCache();
    const deps = {
      agents, router: { forAgent: () => codex as never, adapterIdOf: (id: string) => agents.get(id)?.adapterId }, wsKey: (a: AgentInfo) => a.cwd, resumeIdFor: (id: string) => id, appName: () => 'Codex', vsUserDirs: () => [],
      store: { get: () => undefined as never, sessionNames: () => [], floors: () => ({ floors: [{ id: 'ground', name: 'Ground floor', on: true }, { id: 'up', name: 'Up', on: false }], lastFloor: 'ground' }) },
      values: { knownSecretValues: () => [], noPrompt: () => noPrompt, secretValuesFor: () => [] }, gate: { run: (_k: string, fn: () => Promise<unknown>) => fn() },
      listChats: (async () => ({ sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0 })) as never, codexLists: cache2, now: () => clock,
    };
    const titles = (sc: Scope) => sc.plan.sessions.filter((x) => x.group === 'earlier').map((x) => x.sessionId);
    const s1 = await buildScope(deps);
    assert.deepStrictEqual([listed, titles(s1), s1.notes], [['/c/one'], ['t1', 't2'], { floorOffFolders: 1, mcpValuesLocked: false, lateLists: 0, lateApps: [] }], 'a folder on a floor that is off is not listed, but counted');
    const s2 = await buildScope(deps);
    assert.deepStrictEqual([listed.length, titles(s2)], [1, ['t1', 't2']], 'the next search reuses the kept titles: no new thread/list (no app-server)');
    agents.set('t1', ag('t1', 'codex', '/c/one')); // t1 resumed: open now, and a new Codex agent in the folder
    const s3 = await buildScope(deps);
    assert.deepStrictEqual([listed.length, titles(s3)], [1, ['t2']], 'a resumed session is left out of the kept list, which stays (a new agent does not drop it)');
    agents.delete('t1');
    const s4 = await buildScope(deps);
    assert.deepStrictEqual([listed.length, titles(s4)], [1, ['t1', 't2']], 'it left the office again: it is in the kept list, shown again, nothing listed');
    agents.delete('x2'); // open when the folder was listed, so not in the kept list: it left the office, so the folder is listed again
    const s4b = await buildScope(deps);
    assert.deepStrictEqual([listed.length, titles(s4b)], [2, ['t1', 't2', 'x2']], 'a session open at the listing left the office: listed again, and it shows');
    clock += CODEX_LIST_TTL_MS;
    await buildScope(deps);
    assert.strictEqual(listed.length, 3, 'after 5 minutes: listed again');
    cache2.clear();
    fail = true;
    const s5 = await buildScope(deps);
    assert.deepStrictEqual([s5.plan.unavailable, cache2.size()], [['Codex'], 0], 'a listing that fails is not kept');
    fail = false;
    noPrompt = false;
    assert.strictEqual((await buildScope(deps)).notes.mcpValuesLocked, true, 'owner answer D: values locked in the vault are said');
    const thrower = { ...deps, values: { ...deps.values, noPrompt: (): boolean => { throw new Error('vault'); } } };
    assert.strictEqual((await buildScope(thrower)).notes.mcpValuesLocked, true, 'not known: said as locked');
    assert.deepStrictEqual(listed.filter((x) => x === '/c/off'), [], 'never a thread/list for the folder on the off floor');
  }

  // ---- review N-R1 (FR-026): a delete that succeeded in Previous sessions drops the kept Codex titles at once
  stage = 'delete drops kept';
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrevSessions } = require('../src/main/prevsessions') as typeof import('../src/main/prevsessions');
    const a = { id: 'x1', name: 'one', cwd: '/c/one', folders: ['/c/one'], permMode: 'read-only', adapterId: 'codex' } as AgentInfo;
    const removed: string[] = [];
    let threads = ['th1', 'th2'];
    const ad = { capabilities: { deleteSession: true }, isLive: () => false, deleteSession: async (id: string) => { if (id === 'th2') throw new Error('Codex refused'); removed.push(id); threads = threads.filter((t) => t !== id); }, listPreviousSessions: async () => threads.map((id) => ({ id, title: id, startTime: 1, modifiedTime: 2 })) };
    let changed = 0;
    const c = createCodexListCache();
    const prev = new PrevSessions({ agents: new Map([['x1', a]]), router: { forAgent: () => ad as never, adapterIdOf: () => 'codex' }, wsKey: (x) => x.cwd, resumeIdFor: (id) => id, appName: () => 'Codex', changed: () => { changed++; c.clear(); } });
    c.set('/c/one', ['x1'], [{ id: 'th1', title: 'th1', startTime: 1, modifiedTime: 2 }], Date.now());
    assert.deepStrictEqual((await prev.delete('x1', 'th2')).ok, false);
    assert.deepStrictEqual([changed, c.size()], [0, 1], 'a delete that failed changes nothing');
    assert.deepStrictEqual(await prev.delete('x1', 'th1'), { ok: true });
    assert.deepStrictEqual([removed, changed, c.size()], [['th1'], 1, 0], 'a delete that succeeded drops the kept titles');
    const prev2 = new PrevSessions({ agents: new Map([['x1', a]]), router: { forAgent: () => ad as never, adapterIdOf: () => 'codex' }, wsKey: (x) => x.cwd, resumeIdFor: (id) => id, appName: () => 'Codex', changed: () => { throw new Error('listener'); } });
    threads = ['th3'];
    assert.deepStrictEqual(await prev2.delete('x1', 'th3'), { ok: true }, 'a listener that throws never turns a done delete into a failure');
    // the IPC's own drop, and the wiring by text (main.ts names no delete: test-prevsessions' rule)
    cache.set('/w/x', [], [{ id: 't1', title: 'kept', startTime: 1, modifiedTime: 2 }], Date.now());
    ipc.dropKept();
    assert.strictEqual(cache.size(), 0, 'dropKept drops the kept titles');
    assert.ok(/registerPreviousIpc\(\{ browserGone, sessionsChanged: \(\) => convSearch\.dropKept\(\),/.test(read('src/main/main.ts')), 'main.ts points sessionsChanged at the search');
    assert.ok(/changed: \(\) => deps\.sessionsChanged\?\.\(\) \}/.test(read('src/main/ipc/previous.ts')), 'previous.ts hands it to PrevSessions');
  }

  // ---- review N-R2 (FR-022): the plan has a deadline; a hung Codex app-server does not hold it
  stage = 'scope deadline';
  {
    const ag = (id: string, adapterId: string, cwd: string): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', adapterId } as AgentInfo);
    const agents = new Map<string, AgentInfo>([['x1', ag('x1', 'codex', '/d/one')], ['x2', ag('x2', 'codex', '/d/two')], ['k1', ag('k1', 'claude', '/d/three')]]);
    const listings: string[] = [];
    const adapters: Record<string, unknown> = {
      codex: { id: 'codex', isLive: () => false, listPreviousSessions: async (cwd: string) => { listings.push('codex ' + cwd); return []; } },
      claude: { id: 'claude', isLive: () => false, listPreviousSessions: async (cwd: string) => { listings.push('claude ' + cwd); return [{ id: 'kp', title: 'claude earlier', startTime: 1, modifiedTime: 2 }]; } },
    };
    // a fake timer: a wait fires only when the test says, and then moves the fake clock; nothing really waits
    let clock = 0;
    const timers: Array<{ ms: number; fire(): void }> = [];
    const wait = (ms: number): Promise<void> => new Promise<void>((r) => timers.push({ ms, fire: () => { clock = Math.max(clock, ms); r(); } }));
    const fireAll = (): void => { for (const t of timers.splice(0)) t.fire(); };
    let gateCalls = 0;
    let rejectLate: ((e: Error) => void) | undefined;
    const kept = createCodexListCache();
    const deps = {
      agents, router: { forAgent: (id: string) => adapters[agents.get(id)!.adapterId] as never, adapterIdOf: (id: string) => agents.get(id)?.adapterId }, wsKey: (a: AgentInfo) => a.cwd, resumeIdFor: (id: string) => id, appName: (id: string) => ({ codex: 'Codex', claude: 'Claude Code' }[id] ?? id), vsUserDirs: () => [],
      values: { knownSecretValues: () => [], noPrompt: () => true, secretValuesFor: () => [] },
      gate: { run: () => { gateCalls++; return new Promise<unknown>((_r, j) => { rejectLate = j; }); } }, // a hung app-server: the gate never answers
      listChats: (async () => ({ sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0 })) as never,
      codexLists: kept, now: () => clock, wait,
    };
    const t0 = Date.now();
    const pending = buildScope(deps);
    for (let i = 0; i < 200 && !gateCalls; i++) await tick();
    assert.strictEqual(gateCalls, 1, 'the first Codex listing waits at the hung gate');
    assert.ok(timers.some((t) => t.ms === SCOPE_LIST_MS), 'it races the time left: the whole deadline');
    fireAll(); // the deadline passes
    const sc = await pending;
    assert.ok(Date.now() - t0 < 1000, 'the plan is ready without really waiting');
    assert.strictEqual(gateCalls, 1, 'no listing starts after the deadline (the second Codex folder is never listed)');
    assert.deepStrictEqual(listings, [], 'nothing else listed after it');
    assert.deepStrictEqual([sc.notes.lateLists, sc.notes.lateApps.sort()], [5, ['Claude Code', 'Codex', 'VS Code']], 'every folder and app not listed in time is counted: Codex x2, Claude Code, VS Code x2 (the first VS Code list was in time)');
    assert.deepStrictEqual(sc.plan.sessions.map((x) => x.sessionId), ['x1', 'x2', 'k1'], 'the plan holds the open sessions');
    assert.strictEqual(kept.size(), 0, 'a listing given up is not kept');
    rejectLate!(new Error('probe died')); // a listing given up that fails later is not an unhandled rejection
    await settle(5);
    assert.strictEqual(SCOPE_LIST_MS, 30_000);
    // in time: nothing late
    clock = 0;
    const ok = await buildScope({ ...deps, gate: { run: (_k: string, fn: () => Promise<unknown>) => fn() } });
    assert.deepStrictEqual([ok.notes.lateLists, ok.notes.lateApps], [0, []]);
    assert.ok(ok.plan.sessions.some((x) => x.sessionId === 'kp') && listings.length === 3, 'listed in time: in the plan');
    timers.length = 0;
  }

  // review of the phase 2 code (FR-022): quick new starts do not pile up listings of the same folder; the running one is shared
  stage = 'scope shared listings';
  {
    const ag = (id: string, adapterId: string, cwd: string): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', adapterId } as AgentInfo);
    const agents = new Map<string, AgentInfo>([['k1', ag('k1', 'claude', '/s/one')], ['x1', ag('x1', 'codex', '/s/two')]]);
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const adapters: Record<string, unknown> = {
      claude: { id: 'claude', isLive: () => false, listPreviousSessions: async (cwd: string) => { calls.push('claude ' + cwd); await held; return [{ id: 'kp', title: 'earlier', startTime: 1, modifiedTime: 2 }]; } },
      codex: { id: 'codex', isLive: () => false, listPreviousSessions: async () => [] },
    };
    const listings = new Map<string, Promise<unknown>>();
    const mk = (): ScopeDeps => ({
      agents, router: { forAgent: (id: string) => adapters[agents.get(id)!.adapterId] as never, adapterIdOf: (id: string) => agents.get(id)?.adapterId }, wsKey: (a: AgentInfo) => a.cwd, resumeIdFor: (id: string) => id, appName: (id: string) => id, vsUserDirs: () => [],
      values: { knownSecretValues: () => [], noPrompt: () => true, secretValuesFor: () => [] }, gate: { run: (_k: string, fn: () => Promise<unknown>) => fn() }, listings,
      listChats: (async () => { calls.push('chats'); await held; return { sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0 }; }) as never,
    });
    const scans = [0, 1, 2, 3, 4, 5].map(() => buildScope(mk()));
    await settle(20);
    assert.deepStrictEqual(calls, ['chats'], 'six quick starts, the first listing held: one call, not six');
    release();
    const done = await Promise.all(scans);
    assert.deepStrictEqual([...calls].sort(), ['chats', 'chats', 'claude /s/one'], 'one listing per folder and kind in all, not six');
    assert.ok(done.every((sc) => sc.plan.sessions.some((x) => x.sessionId === 'kp')), 'every scan gets the listing');
    assert.strictEqual(listings.size, 0, 'a settled listing is not kept');
    const again = await buildScope(mk());
    assert.ok(again.plan.sessions.some((x) => x.sessionId === 'kp') && calls.filter((c) => c.startsWith('claude')).length === 2, 'the next scan lists again');
  }

  // review of the phase 2 code (FR-026): a Codex listing shared through the gate carries the earlier scan's open ids; this scan filters its own
  stage = 'scope shared Codex listing';
  {
    const ag = (id: string, adapterId: string, cwd: string): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', adapterId } as AgentInfo);
    const agents = new Map<string, AgentInfo>([['x1', ag('x1', 'codex', '/c/one')]]);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let started = 0;
    const adapter = { id: 'codex', isLive: () => false, listPreviousSessions: async (_cwd: string, exclude: ReadonlySet<string>) => { started++; await held; return [{ id: 'th1', title: 'one', startTime: 1, modifiedTime: 2 }, { id: 'th2', title: 'two', startTime: 1, modifiedTime: 3 }].filter((p) => !exclude.has(p.id)); } };
    const gate = createReadGate<unknown>();
    const kept = createCodexListCache();
    const mk = (): ScopeDeps => ({
      agents, router: { forAgent: () => adapter as never, adapterIdOf: () => 'codex' }, wsKey: (a: AgentInfo) => a.cwd, resumeIdFor: (id: string) => id, appName: () => 'Codex', vsUserDirs: () => [],
      values: { knownSecretValues: () => [], noPrompt: () => true, secretValuesFor: () => [] }, gate, codexLists: kept,
      listChats: (async () => ({ sessions: [], storesFound: 0, unreadable: 0, tooLarge: 0 })) as never,
    });
    const first = buildScope(mk());
    await settle(20);
    agents.set('th2', ag('th2', 'codex', '/c/one')); // th2 is resumed while the listing is held: an open card now
    const second = buildScope(mk());
    await settle(20);
    assert.strictEqual(started, 1, 'the second scan shares the running call');
    release();
    const [a, b] = await Promise.all([first, second]);
    const earlier = (sc: Awaited<ReturnType<typeof buildScope>>): string[] => sc.plan.sessions.filter((x) => x.group === 'earlier').map((x) => x.sessionId).sort();
    assert.deepStrictEqual(earlier(a), ['th1', 'th2'], 'the first scan listed before the resume');
    assert.deepStrictEqual(earlier(b), ['th1'], 'the second scan: th2 is open, not earlier');
    assert.ok(b.plan.sessions.some((x) => x.sessionId === 'th2' && x.group === 'office'));
  }

  // ---- source checks (FR-025, FR-032, FR-033)

  stage = 'source checks';
  {
    for (const f of ['src/main/ipc/convsearch.ts', 'src/main/convscope.ts']) {
      const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.ok(!/\bconsole\.|\blog\(|logActivity|debug\(/.test(code), `${f}: logs nothing (no query, no hit)`);
      assert.ok(!/child_process|['"](?:net|http|https|tls|dgram|undici)['"]|\bfetch\(/.test(code), `${f}: no process, no network`);
      assert.ok(!/\bwriteFile|appendFile|createWriteStream|mkdir|\brm(?:Sync)?\(|unlink|rename\(/.test(code), `${f}: writes nothing`);
      assert.ok(!/Sync\(/.test(code), `${f}: no synchronous fs call`);
    }
    const ipcSrc = read('src/main/ipc/convsearch.ts');
    assert.ok(/ipcHandle\('search:start', \(e, query: unknown\): ConvSearchStart =>/.test(ipcSrc), 'search:start takes only the query');
    assert.ok(/ipcHandle\('search:cancel', \(e, searchId: unknown\)/.test(ipcSrc), 'search:cancel takes only the id');
    assert.ok(/randomBytes\(16\)/.test(ipcSrc), 'a 128-bit id');
    // not reachable from the MCP tools, remote control, schedules, loops or the shared ops
    const WORDS = /convsearch|convscope|search:start|search:cancel|search:batch|convSearch|buildScope/;
    const guarded = [...walk('src/main/mcp'), 'src/main/mcpipc.ts', 'src/main/remoteops.ts', 'src/main/ipc/remote.ts', 'src/main/schedules.ts', 'src/main/loopwiring.ts', 'src/main/agentops.ts', 'src/main/ipc/schedules.ts'];
    for (const f of guarded) assert.ok(!WORDS.test(read(f.startsWith(ROOT) ? path.relative(ROOT, f) : f)), `${f} has no path to the conversation search`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CHANGE_TOOLS, READ_TOOLS } = require('../src/main/mcp/tools') as typeof import('../src/main/mcp/tools');
    const names = [...READ_TOOLS, ...CHANGE_TOOLS].map((t) => t.name);
    assert.ok(!names.some((n) => /search|conversation|transcript/i.test(n)), `no MCP tool searches conversations: ${names.join(', ')}`);
    // main.ts hands over main's own state and stops the scan on window close and quit
    const mainSrc = read('src/main/main.ts');
    assert.ok(/registerConvSearchIpc\(\{/.test(mainSrc) && /hasSessions: \(\) => agents\.size > 0/.test(mainSrc), 'main.ts registers the search with its own agents');
    assert.ok(/noPrompt: \(\) => !mcpStore \|\| mcpStore\.noPrompt\(\)/.test(mainSrc) && /knownSecretValues: \(key\) => mcpStore\?\.knownSecretValues\(key\) \?\? \[\]/.test(mainSrc), 'MCP values without a prompt, as NotesOps; no store yet means nothing is locked (review of PR 1232, Q1: as valuesPending, `!!mcpStore && ...`)');
    {
      // Q1: the wiring's own expression, run: no store yet is "nothing locked" (the note says nothing), a store that would prompt is locked
      const body = /values: \{[^}]*noPrompt: \(\) => ([^,]+),/.exec(mainSrc)?.[1] ?? '';
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const np = new Function('mcpStore', `return (${body});`) as (s: unknown) => boolean;
      assert.deepStrictEqual([np(undefined), np({ noPrompt: () => true }), np({ noPrompt: () => false })], [true, true, false], `noPrompt as main wires it: ${body}`);
    }
    assert.ok(/w\.on\('close', \(\) => convSearch\.cancelAll\(\)\)/.test(mainSrc), 'window close stops it');
    assert.ok(/app\.on\('before-quit', \(ev\) => \{\n {2}convSearch\.cancelAll\(\);/.test(mainSrc), 'quit stops it');
    // T024: the preload, the types, and no channel open under the simulator
    const pre = read('src/preload/preload.ts');
    assert.ok(/convSearchStart: \(query\) => ipcRenderer\.invoke\('search:start', query\)/.test(pre) && /convSearchCancel: \(searchId\) => ipcRenderer\.invoke\('search:cancel', searchId\)/.test(pre), 'the bridge sends only the query and the id');
    assert.ok(/sub\('search:batch', cb\), sub\('search:done', cb\)/.test(pre));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SIM_OPEN_CHANNELS } = require('../src/main/simguard') as typeof import('../src/main/simguard');
    assert.ok(!Object.keys(SIM_OPEN_CHANNELS).some((c) => c.startsWith('search:')), 'no search channel is open under DURBAR_SIM');
    // T025: the simulator's query rule is main's (cut out of sim.ts, compiled, compared)
    const ts = require('typescript') as typeof import('typescript'); // eslint-disable-line @typescript-eslint/no-require-imports
    const simSrc = read('src/renderer/sim.ts');
    const block = simSrc.slice(simSrc.indexOf('/* convquery:begin */'), simSrc.indexOf('/* convquery:end */'));
    assert.ok(block.includes('const simCleanQuery'), 'the simulator marks its query rule');
    const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    (globalThis as unknown as { window: unknown }).window = { DurbarSafeText: require('../src/shared/redact') }; // eslint-disable-line @typescript-eslint/no-require-imports
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const simClean = new Function(js + '\nreturn simCleanQuery;')() as typeof cleanQuery;
    const corpus: unknown[] = ['a bc', 'x y', '', '  ab ', 'invoice export', 'a\u0000b\u0000c', 'one two three four five six seven eight nine', 'x'.repeat(250), '\u{1F600}'.repeat(205), 'word '.repeat(300), 'é ü', 'éx', 42, null, '\u200b\u200b\u200b', '\u202e\u202e\u202e', 'a\u200bb', 'a\u200bbc', 'inv\u00adoice', '\u202einvoice\u2060 export'];
    for (const q of corpus) assert.deepStrictEqual(simClean(q), cleanQuery(q), `the simulator answers ${JSON.stringify(q)?.slice(0, 40)} as main does`);
    (globalThis as unknown as { window: unknown }).window = {};
    assert.deepStrictEqual(simClean('invoice'), { ok: false, code: 'invalid' }, 'the simulator without the shared unhide fails closed');
    assert.ok(/convSearchStart: async/.test(simSrc) && /simsearch/.test(simSrc), 'the simulator fakes the bridge, with a slow mode');
    const fake = simSrc.slice(simSrc.indexOf('function simConvSearchApi'), simSrc.indexOf('\n}\n', simSrc.indexOf('function simConvSearchApi')));
    assert.ok(fake.length > 1000 && !/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|bridge\(|agentDurbar/.test(fake), 'the fake does no I/O and calls no real bridge');
  }

  // ---- T025: the simulator's fake, run in node over a canned corpus (the page's own fold and mask)
  stage = 'simulator fake';
  {
    const ts = require('typescript') as typeof import('typescript'); // eslint-disable-line @typescript-eslint/no-require-imports
    const simSrc = read('src/renderer/sim.ts');
    const from = simSrc.indexOf('/* convquery:begin */');
    const fnAt = simSrc.indexOf('function simConvSearchApi');
    const js = ts.transpileModule(simSrc.slice(from, simSrc.indexOf('\n}\n', fnAt) + 3), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (globalThis as unknown as { window: unknown }).window = { DurbarSessionSearch: search, DurbarRedact: require('../src/shared/redact'), DurbarSafeText: require('../src/shared/redact') };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const make = new Function(js + '\nreturn simConvSearchApi;')() as (qs: URLSearchParams, scope: () => unknown[]) => Required<Pick<import('../src/shared/api').DurbarApi, 'convSearchStart' | 'convSearchCancel' | 'convSearchClear' | 'onConvSearch'>>;
    const s0 = { adapter: 'copilot', app: 'GitHub Copilot', folderName: 'demo', agentId: 'sim-1', time: 0, content: 'read' };
    let corpus: unknown[] = [
      { ...s0, sessionId: 'sim-1', group: 'office', title: 'Untitled session', messages: [{ speaker: 'you', text: `Fix the invoice export, token ${GH}` }, { speaker: 'tool', text: 'grep invoice export' }, { speaker: 'agent', text: 'Done.' }] },
      { ...s0, sessionId: 'sim-2', agentId: 'sim-2', group: 'office', title: 'Tool only', messages: [{ speaker: 'tool', text: 'invoice export' }] },
      { ...s0, sessionId: 'prev-1', group: 'earlier', title: 'invoice export plan', content: 'title', time: 5, messages: [] },
      { ...s0, sessionId: 'prev-2', group: 'earlier', title: 'nothing', content: 'title', time: 4, messages: [{ speaker: 'you', text: 'invoice export' }] },
      { ...s0, sessionId: 'prev-3', group: 'earlier', title: 'invoice export hidden', hidden: true, messages: [] },
    ];
    const fake = make(new URLSearchParams(''), () => corpus);
    const got: ConvSearchEvent[] = [];
    fake.onConvSearch((e) => got.push(e));
    assert.deepStrictEqual(await fake.convSearchStart('x y'), { ok: false, code: 'short', error: SHORT });
    const r = await fake.convSearchStart('Invoice  export');
    assert.ok(r.ok && /^[0-9a-f]{32}$/.test(r.searchId) && r.query === 'Invoice export');
    if (!r.ok) throw new Error('sim start');
    assert.strictEqual(got.length, 0, 'no event before the answer');
    for (let i = 0; i < 200 && !got.some((e) => e.kind === 'done'); i++) await new Promise((res) => setTimeout(res, 5));
    const end = got[got.length - 1];
    assert.ok(end.kind === 'done' && end.searchId === r.searchId && end.notes.hidden === 1 && end.notes.titleOnly.count === 2, JSON.stringify(end));
    const simHits = got.flatMap((e) => (e.kind === 'batch' ? e.hits : []));
    assert.deepStrictEqual(simHits.map((h) => h.sessionId), ['sim-1', 'prev-1'], 'content of the open session, the earlier one by title; tool lines and hidden sessions never');
    assert.ok(!JSON.stringify(got).includes(GH.slice(6, 20)), 'masked before it is shown');
    assert.deepStrictEqual(simHits[0].excerpts.map((x) => [x.speaker, x.anchor.n, x.marks.length]), [['you', 0, 2]]);
    assert.deepStrictEqual(await fake.convSearchCancel(r.searchId), { ok: false }, 'a finished search is stale');
    // slow mode: one session per batch, and a cancel stops it
    got.length = 0;
    const slow = make(new URLSearchParams('simsearch=slow'), () => corpus);
    slow.onConvSearch((e) => got.push(e));
    const rs = await slow.convSearchStart('invoice');
    if (!rs.ok) throw new Error('slow start');
    for (let i = 0; i < 200 && !got.length; i++) await new Promise((res) => setTimeout(res, 10));
    assert.ok(got[0].kind === 'batch' && got[0].progress.done === 1 && got[0].progress.total === 4, JSON.stringify(got[0]));
    assert.deepStrictEqual(await slow.convSearchCancel('f'.repeat(32)), { ok: false });
    assert.deepStrictEqual(await slow.convSearchCancel(rs.searchId), { ok: true });
    const n = got.length;
    await new Promise((res) => setTimeout(res, 900));
    assert.strictEqual(got.length, n, 'nothing after a cancel');
    // FR-026: the fake's clear stops a search without a done; simsearch=locked says the values were locked (owner answer D)
    got.length = 0;
    const rcl = await slow.convSearchStart('invoice');
    assert.ok(rcl.ok);
    assert.deepStrictEqual(await slow.convSearchClear(), { ok: true });
    await new Promise((res) => setTimeout(res, 600));
    assert.strictEqual(got.length, 0, 'cleared: nothing more');
    const locked = make(new URLSearchParams('simsearch=locked'), () => corpus);
    const lg: ConvSearchEvent[] = [];
    locked.onConvSearch((e) => lg.push(e));
    await locked.convSearchStart('invoice');
    for (let i = 0; i < 200 && !lg.some((e) => e.kind === 'done'); i++) await new Promise((res) => setTimeout(res, 5));
    const ld = lg[lg.length - 1];
    assert.ok(ld.kind === 'done' && ld.notes.mcpValuesLocked === true && ld.notes.floorOffFolders === 0);
    assert.ok(end.kind === 'done' && end.notes.mcpValuesLocked === false);
    corpus = corpus.filter((c) => (c as { group: string }).group !== 'office');
    assert.deepStrictEqual((await fake.convSearchStart('invoice')).ok, false, 'no open session: nothing to search');
  }

  process.exitCode = 0;
  console.log('convsearchipc: query bounds, fromApp, one live scan, stale ids, window-only events, scope from main, readers, gate timeout, sim parity OK');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
