/** Unit test for the MCP framing and protocol subset (spec 041 T012): `npm run test:runtime`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { LineFramer, parseMessage } from '../src/main/mcp/jsonrpc';
import { MCP_LIMITS } from '../src/shared/mcpserver';
import { LATEST_PROTOCOL_VERSION, McpSession, SUPPORTED_PROTOCOL_VERSIONS, McpError } from '../src/main/mcp/protocol';
import { CLOSE_AFTER_DROPPED, RATE_PER_SECOND } from '../src/main/mcp/connection';
import { FakeMcpClient, loopback } from './fakes/mcp-client';

const MAX_MESSAGE_BYTES = MCP_LIMITS.maxMessageBytes;

const mk = (): McpSession => new McpSession({ serverInfo: { name: 'agent-durbar', version: '9.9.9' } });
const INIT = { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0], clientInfo: { name: 'c', version: '1' } };
const ready = (c: FakeMcpClient): FakeMcpClient => {
  c.request('initialize', INIT);
  return c;
};
const lines = (f: LineFramer, ...chunks: (string | Buffer)[]): string[] => {
  const out: string[] = [];
  for (const c of chunks) for (const ev of f.push(c)) out.push(ev.type === 'line' ? ev.line : '<oversize>');
  return out;
};

// 1. framing: lines, split chunks, CRLF, blank lines
{
  assert.deepStrictEqual(lines(new LineFramer(), '{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}'], 'two lines in one chunk');
  assert.deepStrictEqual(lines(new LineFramer(), '{"a"', ':1}', '\n'), ['{"a":1}'], 'one line over three chunks');
  assert.deepStrictEqual(lines(new LineFramer(), '{"a":1}\r\n{"b":2}\r\n'), ['{"a":1}', '{"b":2}'], 'CRLF accepted, CR stripped');
  assert.deepStrictEqual(lines(new LineFramer(), '{"a":1}\r', '\n'), ['{"a":1}'], 'CR and LF in different chunks');
  assert.deepStrictEqual(lines(new LineFramer(), '\n\r\n{"a":1}\n\n'), ['{"a":1}'], 'blank lines ignored');
  assert.deepStrictEqual(lines(new LineFramer(), '{"a":1}'), [], 'no line without a newline');
}

// 2. UTF-8 split across chunks, one byte at a time
{
  const text = '{"t":"café 中文 😀"}';
  const bytes = Buffer.from(text + '\n', 'utf8');
  const f = new LineFramer();
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(...lines(f, bytes.subarray(i, i + 1)));
  assert.deepStrictEqual(out, [text], 'multibyte characters survive a split at every byte');
  assert.ok(!out[0].includes('�'), 'no replacement character');
}

// 3. the 64 KB cap
{
  const edge = '{"p":"' + 'x'.repeat(MAX_MESSAGE_BYTES - 8) + '"}'; // exactly the cap
  assert.strictEqual(Buffer.byteLength(edge), MAX_MESSAGE_BYTES);
  assert.deepStrictEqual(lines(new LineFramer(), edge + '\n'), [edge], 'a message of exactly the cap is accepted');
  assert.deepStrictEqual(lines(new LineFramer(), edge + '\r\n'), [edge], 'exactly the cap with CRLF is accepted');
  assert.deepStrictEqual(lines(new LineFramer(), edge + '\r', '\n'), [edge], 'exactly the cap, CR and LF in different chunks');
  assert.deepStrictEqual(lines(new LineFramer(), edge + '\r', '', '\n'), [edge], 'same with an empty chunk between');
  assert.deepStrictEqual(lines(new LineFramer(), edge + 'y\r', '\n{"ok":1}\n'), ['<oversize>', '{"ok":1}'], 'one over with split CRLF: rejected, in sync');
  const over = edge + 'y';
  assert.deepStrictEqual(lines(new LineFramer(), over + '\n{"ok":1}\n'), ['<oversize>', '{"ok":1}'], 'one byte over: rejected, next line fine');
  // oversize arriving in many chunks, then a good line in the same stream
  const f = new LineFramer();
  const big = 'z'.repeat(300 * 1024);
  const out = lines(f, big.slice(0, 100000), big.slice(100000, 200000), big.slice(200000), '\n{"ok":2}\n');
  assert.deepStrictEqual(out, ['<oversize>', '{"ok":2}'], 'huge line over chunks: one rejection, stream still in sync');
  // multibyte: cap counts bytes, not characters
  const mb = 'é'.repeat(MAX_MESSAGE_BYTES / 2 + 1); // 2 bytes each, one char over
  assert.deepStrictEqual(lines(new LineFramer(), mb + '\n'), ['<oversize>'], 'cap counts bytes');
  // oversize without ever seeing a newline must not buffer forever
  const g = new LineFramer();
  g.push('q'.repeat(MAX_MESSAGE_BYTES * 3));
  assert.deepStrictEqual(lines(g, '\n{"ok":3}\n'), ['{"ok":3}'], 'after an unterminated oversize line the next newline resyncs');
}

// 4. parseMessage shapes
{
  assert.strictEqual(parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}').kind, 'request');
  assert.strictEqual(parseMessage('{"jsonrpc":"2.0","method":"x"}').kind, 'notification');
  assert.strictEqual(parseMessage('{"jsonrpc":"2.0","id":1,"result":{}}').kind, 'response');
  const bad = parseMessage('{"jsonrpc":"1.0","id":4,"method":"ping"}');
  assert.ok(bad.kind === 'invalid' && bad.reply.error.code === -32600 && bad.reply.id === 4, 'wrong jsonrpc version: -32600 with the id');
  const arr = parseMessage('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
  assert.ok(arr.kind === 'invalid' && arr.reply.error.code === -32600, 'batches are refused');
  const objId = parseMessage('{"jsonrpc":"2.0","id":{},"method":"ping"}');
  assert.ok(objId.kind === 'invalid' && objId.reply.id === null, 'object id refused');
}

// 5. malformed JSON: -32700 and the stream continues
{
  const s = mk();
  const c = loopback(s);
  c.sendRaw('{not json\n');
  assert.strictEqual(c.replies[0].error.code, -32700, 'parse error code');
  assert.strictEqual(c.replies[0].id, null, 'parse error id is null');
  assert.deepStrictEqual(c.request('ping'), { jsonrpc: '2.0', id: 1, result: {} }, 'next message still answered');
  c.sendRaw('"just a string"\n');
  assert.strictEqual(c.replies[c.replies.length - 1].error.code, -32600, 'non-object: -32600');
}

// 6. oversize through the session: rejected, then in sync
{
  const s = mk();
  const c = loopback(s, 4096);
  c.sendRaw('{"jsonrpc":"2.0","id":9,"method":"ping","params":"' + 'x'.repeat(MAX_MESSAGE_BYTES) + '"}\n');
  assert.strictEqual(c.replies.length, 1, 'one reply for the oversize line');
  assert.strictEqual(c.replies[0].error.code, -32600, 'oversize: invalid request');
  assert.strictEqual(c.replies[0].id, null);
  assert.ok(!JSON.stringify(c.replies[0]).includes('xxxx'), 'the reply never echoes the payload');
  assert.deepStrictEqual(c.request('ping').result, {}, 'stream stays in sync');
}

// 7. initialize: negotiation from the one list
{
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.length >= 2 && SUPPORTED_PROTOCOL_VERSIONS[0] === LATEST_PROTOCOL_VERSION);
  for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
    const c = loopback(mk());
    const r = c.request('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'c', version: '1' } });
    assert.strictEqual(r.result.protocolVersion, v, `supported ${v} echoed back`);
    assert.deepStrictEqual(r.result.serverInfo, { name: 'agent-durbar', version: '9.9.9' });
    assert.deepStrictEqual(r.result.capabilities, { tools: { listChanged: false } });
  }
  for (const v of ['1999-01-01', '2099-12-31', '', 'latest']) {
    const c = loopback(mk());
    const r = c.request('initialize', { protocolVersion: v, clientInfo: { name: 'c', version: '1' } });
    assert.strictEqual(r.result.protocolVersion, LATEST_PROTOCOL_VERSION, `unsupported "${v}" gets the server's version`);
  }
  const c = loopback(mk());
  assert.strictEqual(c.request('initialize', {}).error.code, -32602, 'missing protocolVersion: -32602');
  assert.strictEqual(c.request('initialize').error.code, -32602, 'missing params: -32602');
  assert.strictEqual(c.request('initialize', { protocolVersion: 5 }).error.code, -32602, 'non-string protocolVersion: -32602');
}

// 8. session state, clientInfo is cleaned, second initialize refused
{
  const s = mk();
  const c = loopback(s);
  assert.strictEqual(s.initialized, false);
  c.request('initialize', { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[1], clientInfo: { name: 'evil\u0000\n' + 'n'.repeat(200), version: 7 } });
  assert.strictEqual(s.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[1]);
  assert.strictEqual(s.clientInfo!.name.length, 64, 'clientInfo.name capped at 64');
  assert.ok(!/[\u0000-\u001f]/.test(s.clientInfo!.name), 'control characters stripped');
  assert.strictEqual(s.clientInfo!.version, '', 'non-string version dropped');
  assert.strictEqual(s.initialized, false, 'not initialized until the notification');
  const n = c.replies.length;
  c.notify('notifications/initialized');
  assert.strictEqual(c.replies.length, n, 'a notification gets no reply');
  assert.strictEqual(s.initialized, true);
  assert.strictEqual(c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION }).error.code, -32600, 'second initialize refused');
  assert.strictEqual(c.request('initialize').error.code, -32600, 'second initialize without params: -32600, not -32602');
}

// 8b. clientInfo: format characters, surrogates, code-point cap
{
  const s = mk();
  const c = loopback(s);
  c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'a\u202Eb\u200Bc\ud800d', version: '1' } });
  assert.strictEqual(s.clientInfo!.name, 'abcd', 'U+202E, U+200B and a lone surrogate stripped');
  const t = mk();
  const emoji = '\ud83d\ude00';
  loopback(t).request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'n'.repeat(63) + emoji + 'tail', version: '1' } });
  assert.strictEqual(Array.from(t.clientInfo!.name).length, 64, '64 code points');
  assert.strictEqual(t.clientInfo!.name, 'n'.repeat(63) + emoji, 'the emoji at the boundary is kept whole');
  const u = mk();
  loopback(u).request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'n'.repeat(64) + emoji, version: '1' } });
  assert.strictEqual(u.clientInfo!.name, 'n'.repeat(64), 'a pair past the cap is dropped, never cut in half');
}

// 9. ping (before and after), unknown methods, unknown notifications, client replies, ids
{
  const c = loopback(mk());
  assert.deepStrictEqual(c.request('ping'), { jsonrpc: '2.0', id: 1, result: {} }, 'ping before initialize');
  assert.strictEqual(c.request('no/such').error.code, -32002, 'unknown method before initialize: the init gate answers first');
  ready(c);
  const r = c.request('no/such');
  assert.strictEqual(r.error.code, -32601, 'unknown method: -32601');
  c.send({ jsonrpc: '2.0', id: 'abc', method: 'ping' });
  assert.strictEqual(c.replies[c.replies.length - 1].id, 'abc', 'string ids are echoed');
  const n = c.replies.length;
  c.notify('no/such/notification');
  c.send({ jsonrpc: '2.0', id: 77, result: {} });
  assert.strictEqual(c.replies.length, n, 'unknown notification and client replies get nothing');
}

// 10. the T013 hook: tools/* are -32601 until registered; a registered handler works; errors map
{
  const c = ready(loopback(mk()));
  assert.strictEqual(c.request('tools/list').error.code, -32601, 'tools/list is -32601 for now');
  assert.strictEqual(c.request('tools/call', { name: 'x' }).error.code, -32601, 'tools/call is -32601 for now');
  const s = new McpSession({
    serverInfo: { name: 'a', version: '1' },
    methods: {
      'tools/list': () => ({ tools: [] }),
      boom: () => { throw new Error('secret path /home/me'); },
      bad: () => { throw new McpError(-32602, 'nope'); },
    },
  });
  const d = ready(loopback(s));
  assert.deepStrictEqual(d.request('tools/list').result, { tools: [] });
  const b = d.request('boom');
  assert.strictEqual(b.error.code, -32603);
  assert.ok(!JSON.stringify(b).includes('secret'), 'internal errors do not leak the message');
  assert.strictEqual(d.request('bad').error.code, -32602);
  const w = new McpSession({ serverInfo: { name: 'a', version: '1' }, methods: { nothing: () => undefined } });
  assert.deepStrictEqual(ready(loopback(w)).request('nothing').result, {}, 'a handler returning undefined still gives a valid result');
  assert.strictEqual(d.request('toString').error.code, -32601, 'inherited object keys are not methods');
}

// 11. synthetic handshake fixtures for the four target clients
{
  const dir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'mcp');
  const files = ['claude-code', 'copilot-cli', 'vscode', 'claude-desktop'].map((n) => `handshake-${n}.json`);
  for (const f of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.strictEqual(fx.provenance, 'synthetic', `${f} is marked synthetic`);
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(fx.expectProtocolVersion), `${f}: its version is in the supported list`);
    const s = mk();
    const c: FakeMcpClient = loopback(s, 7);
    c.send(fx.initialize);
    assert.strictEqual(c.replies[0].id, fx.initialize.id);
    assert.strictEqual(c.replies[0].result.protocolVersion, fx.expectProtocolVersion, `${f}: negotiated version`);
    c.send(fx.initialized);
    assert.ok(s.initialized, `${f}: initialized`);
    assert.strictEqual(s.clientInfo!.name, fx.initialize.params.clientInfo.name);
  }
}



// 12. initialized only counts after a successful initialize
{
  const s = mk();
  const c = loopback(s);
  c.notify('notifications/initialized');
  assert.strictEqual(s.initialized, false, 'initialized before initialize is ignored');
  c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION });
  c.notify('notifications/initialized');
  assert.strictEqual(s.initialized, true);
  const t = mk();
  const d = loopback(t);
  d.request('initialize', {}); // fails: -32602
  d.notify('notifications/initialized');
  assert.strictEqual(t.initialized, false, 'a failed initialize does not unlock it');
}

async function main(): Promise<void> {
  // 13. async handlers: resolve, reject, sync throw; replies in request order
  const gate: { release?: () => void } = {};
  const s = new McpSession({
    serverInfo: { name: 'a', version: '1' },
    methods: {
      ok: async () => ({ v: 1 }),
      slow: () => new Promise((res) => { gate.release = () => res({ slow: true }); }),
      rej: () => Promise.reject(new Error('secret /home/me/token')),
      rejTyped: () => Promise.reject(new McpError(-32602, 'bad arg')),
      thrown: () => { throw new Error('secret sync'); },
    },
  });
  const c = ready(loopback(s));
  assert.deepStrictEqual((await c.requestAsync('ok')).result, { v: 1 }, 'async resolve');
  const r = await c.requestAsync('rej');
  assert.strictEqual(r.error.code, -32603, 'async reject: -32603');
  assert.strictEqual(r.error.message, 'Internal error');
  assert.ok(!JSON.stringify(r).includes('secret'), 'async reject does not leak the message');
  assert.strictEqual((await c.requestAsync('rejTyped')).error.code, -32602, 'McpError from a rejection keeps its code');
  const th = c.request('thrown');
  assert.strictEqual(th.error.code, -32603, 'sync throw: -32603');
  assert.ok(!JSON.stringify(th).includes('secret'));
  // order: a slow request, then a fast ping; the ping's reply waits
  const n = c.replies.length;
  c.send({ jsonrpc: '2.0', id: 'A', method: 'slow' });
  c.send({ jsonrpc: '2.0', id: 'B', method: 'ping' });
  assert.strictEqual(c.replies.length, n, 'nothing written while the first request is pending');
  gate.release!();
  await new Promise((res) => setImmediate(res));
  assert.deepStrictEqual(c.replies.slice(n).map((x) => x.id), ['A', 'B'], 'replies leave in request order');
  // no unhandled rejection anywhere above
  let unhandled = 0;
  const h = (): void => { unhandled++; };
  process.on('unhandledRejection', h);
  await c.requestAsync('rej');
  await new Promise((res) => setTimeout(res, 20));
  process.off('unhandledRejection', h);
  assert.strictEqual(unhandled, 0, 'no unhandled rejection');

  // 14. rate limit: every line counts (invalid and oversize too), before parsing, no reply when over
  {
    let t = 1000;
    let closed = 0;
    const s2 = mk();
    const c2 = loopback(s2, 0, { now: () => t, onClose: () => { closed++; } });
    for (let i = 0; i < RATE_PER_SECOND + 5; i++) c2.sendRaw('garbage\n');
    assert.strictEqual(c2.replies.length, RATE_PER_SECOND, 'invalid lines use tokens; over the limit nothing is answered');
    t += 1000;
    assert.deepStrictEqual(c2.request('ping').result, {}, 'tokens come back with time');
    // oversize lines count too
    const c3 = loopback(mk(), 0, { now: () => t });
    for (let i = 0; i < RATE_PER_SECOND + 3; i++) c3.sendRaw('y'.repeat(70000) + '\n');
    assert.strictEqual(c3.replies.length, RATE_PER_SECOND, 'oversize lines use tokens too');
    assert.strictEqual(closed, 0);
  }

  // 15. Paco's case: 200,000 tiny lines in one 400 KB chunk
  {
    let closed = 0;
    const c4 = loopback(mk(), 0, { onClose: () => { closed++; } });
    const flood = Buffer.from('x\n'.repeat(200000));
    assert.strictEqual(flood.length, 400000);
    // CPU time, not wall time, so a loaded machine cannot fail it (spec 041 T068); it still counts every line the parser touches.
    // CPU time does not see a blocking wait, so wall time has a loose backstop of 10x the limit (review of PR #527).
    const w0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    c4.conn.onData(flood);
    const cpu = process.cpuUsage(c0);
    const ms = (cpu.user + cpu.system) / 1000;
    const wall = Number(process.hrtime.bigint() - w0) / 1e6;
    assert.ok(ms < 1000, `flood handled quickly (${ms} ms CPU)`);
    assert.ok(wall < 10000, `flood wall-time backstop: ${wall.toFixed(1)} ms wall for ${ms} ms CPU, limit 10000 ms (a blocking wait?)`);
    assert.ok(c4.replies.length <= RATE_PER_SECOND, `at most a handful of replies (${c4.replies.length})`);
    assert.strictEqual(closed, 1, 'close signalled once');
    assert.ok(c4.conn.closed);
    c4.conn.onData('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.ok(c4.replies.length <= RATE_PER_SECOND, 'a closed connection answers nothing');
    // sustained drops over 3 s also close, with fewer than 100 lines
    let t = 0;
    let closed2 = 0;
    const c5 = loopback(mk(), 0, { now: () => t, onClose: () => { closed2++; } });
    for (let i = 0; i < RATE_PER_SECOND + 1; i++) c5.sendRaw('x\n'); // 10 answered, 1 dropped
    for (let i = 0; i < 4; i++) { t += 900; c5.sendRaw('x\n'.repeat(RATE_PER_SECOND + 2)); } // keeps overflowing
    assert.strictEqual(closed2, 1, 'drops continuing for 3 s close the connection');
    assert.ok(CLOSE_AFTER_DROPPED > 20);
  }

  // 16. backpressure: a full writer stops replies until drain; lines meanwhile are dropped
  {
    const out: string[] = [];
    let full = true;
    const s6 = mk();
    const c6 = loopback(s6, 0, { write: (d) => { out.push(d); return !full; } });
    c6.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    c6.send({ jsonrpc: '2.0', id: 2, method: 'ping' }); // blocked: dropped, not answered
    assert.strictEqual(out.length, 1, 'one write, then the writer is full and nothing more is written');
    full = false;
    c6.conn.drain();
    assert.strictEqual(out.length, 1, 'the dropped request is gone, nothing else was queued');
    c6.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.strictEqual(out.length, 2, 'after drain replies flow again');
    assert.strictEqual(JSON.parse(out[1]).id, 3);
  }

  console.log('mcp protocol: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
