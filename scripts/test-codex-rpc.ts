/** Unit test for the Codex JSON-RPC client on a scripted stdio fake: `npm run test:runtime`. No real process. */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import { createCodexRpc, CodexRpcError, MAX_LINE_BYTES, RequestOutcome, RpcChild, SpawnFn, SpawnOptions } from '../src/adapters/codexRpc';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  signals: (string | number | undefined)[] = [];
  written: string[] = [];
  stdoutE = new EventEmitter();
  stderrE = new EventEmitter();
  ended = false;
  killed = 0;
  stdin = { write: (d: string, cb?: (e?: Error | null) => void) => { this.written.push(d); cb?.(null); return true; }, end: () => { this.ended = true; } };
  get stdout() { return this.stdoutE; }
  get stderr() { return this.stderrE; }
  kill(sig?: string | number) { this.killed++; this.signals.push(sig); return true; }
  out(s: string) { this.stdoutE.emit('data', Buffer.from(s)); }
  sent() { return this.written.map((l) => JSON.parse(l)); }
  die(code: number | null = 0, sig: NodeJS.Signals | null = null) { this.emit('exit', code, sig); }
}

function make(over: { onRequest?: (m: string, p: unknown) => Promise<RequestOutcome>; closeGraceMs?: number; killGraceMs?: number; maxPending?: number; killChild?: (c: RpcChild, s: NodeJS.Signals) => void; pid?: number | undefined; throwSpawn?: boolean } = {}) {
  const fc = new FakeChild();
  if ('pid' in over) fc.pid = over.pid;
  const calls: { file: string; args: string[]; opts: SpawnOptions }[] = [];
  const notes: [string, unknown][] = [];
  const exits: [number | null, string | null][] = [];
  const dbg: string[] = [];
  const spawn: SpawnFn = (file, args, opts) => { calls.push({ file, args, opts }); if (over.throwSpawn) throw new Error('EACCES'); return fc as unknown as RpcChild; };
  const rpc = createCodexRpc({
    spawn, file: '/abs/codex', args: ['app-server'], cwd: '/w', env: { A: 'secret-value' },
    onNotification: (m, p) => notes.push([m, p]),
    onRequest: over.onRequest ?? (async () => ({ result: {} })),
    onExit: (c, s) => exits.push([c, s]),
    debug: (m) => dbg.push(m),
    closeGraceMs: over.closeGraceMs ?? 20,
    killGraceMs: over.killGraceMs ?? 5000,
    maxPendingServerRequests: over.maxPending,
    killChild: over.killChild,
  });
  return { fc, rpc, calls, notes, exits, dbg };
}
const tick = () => new Promise<void>((r) => setImmediate(r));
const rejects = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, (e) => e as CodexRpcError);

async function main(): Promise<void> {
  // spawn plan: argv array, absolute file, no shell
  {
    const { calls } = make();
    assert.strictEqual(calls.length, 1, 'spawn called once');
    assert.strictEqual(calls[0].file, '/abs/codex');
    assert.deepStrictEqual(calls[0].args, ['app-server']);
    assert.strictEqual(calls[0].opts.shell, false, 'spawn must use shell:false');
    assert.strictEqual(calls[0].opts.windowsHide, true);
    assert.deepStrictEqual(calls[0].opts.stdio, ['pipe', 'pipe', 'pipe']);
  }

  // framing across chunks, CRLF, partial line, id matching out of order
  {
    const { fc, rpc } = make();
    const a = rpc.request('a');
    const b = rpc.request('b', { x: 1 });
    await tick();
    assert.deepStrictEqual(fc.sent().map((m) => [m.id, m.method]), [[1, 'a'], [2, 'b']]);
    assert.deepStrictEqual(fc.sent()[1].params, { x: 1 });
    fc.out('{"id":2,"res');
    fc.out('ult":"B"}\r\n{"id":1,"result":');
    let settled = false;
    a.then(() => { settled = true; });
    await tick();
    assert.strictEqual(settled, false, 'partial line must not be parsed early');
    assert.strictEqual(await b, 'B');
    fc.out('"A"}\r\n');
    assert.strictEqual(await a, 'A');
  }

  // a complete JSON value without its newline is still a partial line
  {
    const { fc, notes } = make();
    fc.out('{"method":"early"}');
    assert.strictEqual(notes.length, 0, 'partial line must not be parsed early (no newline yet)');
    fc.out('\n');
    assert.deepStrictEqual(notes, [['early', undefined]]);
  }

  // rpc error rejects typed
  {
    const { fc, rpc } = make();
    const p = rpc.request('m');
    fc.out('{"id":1,"error":{"code":-32601,"message":"nope","data":{"k":1}}}\n');
    const e = await rejects(p);
    assert.ok(e instanceof CodexRpcError && e.kind === 'rpc' && e.code === -32601 && e.message === 'nope');
    assert.deepStrictEqual(e.data, { k: 1 });
  }

  // notifications, with and without jsonrpc field
  {
    const { fc, notes } = make();
    fc.out('{"jsonrpc":"2.0","method":"turn/started","params":{"t":1}}\n{"method":"x"}\n');
    assert.deepStrictEqual(notes, [['turn/started', { t: 1 }], ['x', undefined]]);
  }

  // server request answered by onRequest; throwing handler sends an error response
  {
    const { fc } = make({ onRequest: async (m) => { if (m === 'bad') throw new Error('boom'); return { result: { decision: 'accept' } }; } });
    fc.out('{"id":"s1","method":"item/commandExecution/requestApproval","params":{}}\n{"id":7,"method":"bad"}\n');
    await tick(); await tick();
    const sent = fc.sent();
    assert.strictEqual(sent.length, 2, 'onRequest errors must be sent back');
    assert.deepStrictEqual(sent[0], { id: 's1', result: { decision: 'accept' } });
    assert.strictEqual(sent[1].id, 7);
    assert.strictEqual(sent[1].error.message, 'boom', 'onRequest errors must be sent back');
    assert.strictEqual(sent[1].error.code, -32603);
  }
  {
    const { fc } = make({ onRequest: async () => ({ error: { code: -32000, message: 'denied' } }) });
    fc.out('{"id":3,"method":"m"}\n');
    await tick(); await tick();
    assert.deepStrictEqual(fc.sent()[0], { id: 3, error: { code: -32000, message: 'denied' } });
  }

  // malformed, non-JSON, non-object, oversize, unknown id: dropped, never thrown, later lines still work
  {
    const { fc, rpc, dbg, notes } = make();
    const p = rpc.request('m');
    fc.out('not json\n[1,2]\n42\n{"id":99,"result":1}\n{"foo":1}\n\n');
    fc.out('{"x":"' + 'a'.repeat(MAX_LINE_BYTES + 10) + '"}\n');
    fc.out('{"method":"after"}\n');
    fc.out('{"x":"' + 'b'.repeat(MAX_LINE_BYTES + 10)); // oversize without newline yet
    fc.out('more\n{"id":1,"result":"ok"}\n');
    assert.strictEqual(await p, 'ok');
    assert.deepStrictEqual(notes, [['after', undefined]]);
    assert.ok(dbg.includes('non-JSON line dropped') && dbg.includes('oversize line dropped') && dbg.includes('response for unknown id ignored'));
  }

  // timeout drops the pending entry (a late response is ignored)
  {
    const { fc, rpc, dbg } = make();
    const p = rpc.request('slow', {}, { timeoutMs: 10 });
    const e = await rejects(p);
    assert.strictEqual(e.kind, 'timeout');
    fc.out('{"id":1,"result":1}\n');
    assert.ok(dbg.includes('response for unknown id ignored'));
  }

  // child exit rejects every pending request, then onExit; writes after exit reject
  {
    const { fc, rpc, exits } = make();
    const a = rpc.request('a'); const b = rpc.request('b');
    fc.die(3, null);
    const [ea, eb] = [await rejects(a), await rejects(b)];
    assert.ok(ea.kind === 'exit' && eb.kind === 'exit', 'pending requests must reject on exit');
    assert.deepStrictEqual(exits, [[3, null]]);
    assert.strictEqual(rpc.exited, true);
    assert.strictEqual((await rejects(rpc.request('c'))).kind, 'exit');
    assert.strictEqual((await rejects(rpc.notify('n'))).kind, 'exit');
    fc.die(3, null);
    assert.strictEqual(exits.length, 1, 'onExit once');
  }
  // spawn error (no pid) behaves as exit
  {
    const { fc, rpc, exits } = make({ pid: undefined });
    const a = rpc.request('a');
    fc.emit('error', new Error('ENOENT'));
    assert.strictEqual((await rejects(a)).kind, 'exit');
    assert.deepStrictEqual(exits, [[null, null]]);
  }

  // notify
  {
    const { fc, rpc } = make();
    await rpc.notify('initialized');
    assert.deepStrictEqual(fc.sent()[0], { method: 'initialized' });
  }

  // close: ends stdin, kills after grace, idempotent; exit before grace cancels the kill
  {
    const { fc, rpc } = make({ closeGraceMs: 15 });
    const p = rpc.request('a');
    rpc.close(); rpc.close();
    assert.strictEqual(fc.ended, true);
    assert.strictEqual((await rejects(p)).kind, 'closed');
    assert.strictEqual((await rejects(rpc.request('b'))).kind, 'closed');
    await new Promise((r) => setTimeout(r, 40));
    assert.deepStrictEqual(fc.signals, ['SIGTERM'], 'SIGTERM exactly once after grace');
    rpc.close();
    assert.strictEqual(fc.killed, 1);
  }
  {
    const { fc, rpc } = make({ closeGraceMs: 15 });
    rpc.close();
    fc.die(0);
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(fc.killed, 0, 'no kill when the child exited in time');
  }

  // kill escalation: SIGTERM, then SIGKILL, each once; an exit after SIGTERM cancels the SIGKILL
  {
    const { fc, rpc } = make({ closeGraceMs: 10, killGraceMs: 10 });
    rpc.close();
    await new Promise((r) => setTimeout(r, 60));
    assert.deepStrictEqual(fc.signals, ['SIGTERM', 'SIGKILL']);
    rpc.close();
    assert.strictEqual(fc.killed, 2);
  }
  {
    const { fc, rpc } = make({ closeGraceMs: 10, killGraceMs: 30 });
    rpc.close();
    await new Promise((r) => setTimeout(r, 20));
    fc.die(null, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 60));
    assert.deepStrictEqual(fc.signals, ['SIGTERM'], 'no SIGKILL after the child exited');
  }

  // the kill steps go through the injected tree killer (FR-079 delta 2026-10-26), in order, with the child; never child.kill directly
  {
    const steps: string[] = [];
    const { fc, rpc } = make({ closeGraceMs: 10, killGraceMs: 10, killChild: (c, sig) => { steps.push(`${(c as unknown as FakeChild).pid}:${sig}`); } });
    rpc.close();
    await new Promise((r) => setTimeout(r, 60));
    assert.deepStrictEqual(steps, ['4242:SIGTERM', '4242:SIGKILL']);
    assert.strictEqual(fc.killed, 0, 'the direct child.kill is not used when a killer is injected');
  }

  // UTF-8 split across chunks (stdout and stderr)
  {
    const { fc, notes, rpc } = make();
    const line = Buffer.from('{"method":"u","params":"é漢"}\n');
    const cut1 = line.indexOf(0xc3) + 1; // inside é
    const cut2 = line.indexOf(0xe6) + 2; // inside 漢
    fc.stdoutE.emit('data', line.subarray(0, cut1));
    fc.stdoutE.emit('data', line.subarray(cut1, cut2));
    fc.stdoutE.emit('data', line.subarray(cut2));
    assert.deepStrictEqual(notes, [['u', 'é漢']]);
    const err = Buffer.from('é漢\n');
    fc.stderrE.emit('data', err.subarray(0, 1));
    fc.stderrE.emit('data', err.subarray(1, 4));
    fc.stderrE.emit('data', err.subarray(4));
    assert.deepStrictEqual(rpc.stderrTail(), ['é漢']);
  }

  // 'error' after a successful spawn is not an exit; without a pid it is
  {
    const { fc, rpc, exits, dbg } = make();
    const p = rpc.request('a');
    fc.emit('error', new Error('kill failed'));
    assert.strictEqual(rpc.exited, false, 'error with a pid must not end the client');
    assert.strictEqual(exits.length, 0);
    assert.ok(dbg.includes('child error: kill failed'));
    fc.out('{"id":1,"result":1}\n');
    assert.strictEqual(await p, 1);
    rpc.close();
    await new Promise((r) => setTimeout(r, 40));
    assert.deepStrictEqual(fc.signals, ['SIGTERM'], 'still killable');
  }
  {
    const { fc, rpc, exits } = make({ pid: undefined });
    const p = rpc.request('a');
    fc.emit('error', new Error('ENOENT'));
    assert.strictEqual((await rejects(p)).kind, 'exit');
    assert.deepStrictEqual(exits, [[null, null]]);
  }

  // spawn throwing synchronously: onExit once, nothing thrown, later calls reject
  {
    const { rpc, exits } = make({ throwSpawn: true });
    assert.deepStrictEqual(exits, [[null, null]]);
    assert.strictEqual(rpc.exited, true);
    assert.strictEqual((await rejects(rpc.request('a'))).kind, 'exit');
    rpc.close();
  }

  // oversize tail must not leak: the rest of an oversize line is skipped even when it is valid JSON
  {
    const { fc, notes } = make();
    fc.out('{"x":"' + 'b'.repeat(MAX_LINE_BYTES + 10));
    fc.out('{"method":"smuggled"}\n');
    fc.out('{"method":"next"}\n');
    assert.deepStrictEqual(notes, [['next', undefined]], 'smuggled tail of an oversize line must be dropped');
  }

  // a server request that resolves after exit or close sends nothing
  {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = make({ onRequest: async () => { await gate; return { result: 1 }; } });
    a.fc.out('{"id":1,"method":"m"}\n');
    a.fc.die(0);
    release(); await tick(); await tick();
    assert.deepStrictEqual(a.fc.written, [], 'no write after exit');
    const b = make({ onRequest: async () => { await gate; return { result: 1 }; } });
    b.fc.out('{"id":1,"method":"m"}\n');
    b.rpc.close();
    await tick(); await tick();
    assert.deepStrictEqual(b.fc.written, [], 'no write after close');
  }

  // cap on in-flight server requests: under the cap all handled, over it errors without calling onRequest, capacity frees up
  {
    const gates: (() => void)[] = [];
    let calls = 0;
    const { fc } = make({ maxPending: 2, onRequest: async () => { calls++; await new Promise<void>((r) => gates.push(r)); return { result: 'ok' }; } });
    fc.out('{"id":1,"method":"m"}\n{"id":2,"method":"m"}\n');
    await tick();
    assert.strictEqual(calls, 2, 'under the cap all requests are handled');
    fc.out('{"id":3,"method":"m"}\n{"id":4,"method":"m"}\n');
    await tick(); await tick();
    assert.strictEqual(calls, 2, 'onRequest must not be called over the cap');
    assert.deepStrictEqual(fc.sent().map((m) => [m.id, m.error?.code, m.error?.message]), [[3, -32000, 'too many pending requests'], [4, -32000, 'too many pending requests']]);
    gates[0]();
    await tick(); await tick();
    assert.strictEqual(fc.sent().length, 3, 'first request answered');
    fc.out('{"id":5,"method":"m"}\n');
    await tick();
    assert.strictEqual(calls, 3, 'capacity frees up as requests resolve');
    gates.slice(1).forEach((g) => g());
    await tick(); await tick();
    assert.deepStrictEqual(fc.sent().filter((m) => m.result === 'ok').map((m) => m.id).sort(), [1, 2, 5]);
  }

  // a duplicated server request id is answered twice (the server's fault; we do not dedupe)
  {
    const { fc } = make();
    fc.out('{"id":5,"method":"m"}\n{"id":5,"method":"m"}\n');
    await tick(); await tick();
    assert.deepStrictEqual(fc.sent().map((m) => m.id), [5, 5]);
  }

  // stderr tail is capped and exposed only through stderrTail
  {
    const { fc, rpc, dbg } = make();
    for (let i = 0; i < 80; i++) fc.stderrE.emit('data', `line ${i}\n`);
    const t = rpc.stderrTail();
    assert.strictEqual(t.length, 50);
    assert.strictEqual(t[49], 'line 79');
    assert.ok(!dbg.some((d) => d.includes('line ') || d.includes('secret-value')));
  }
  console.log('codex rpc: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
