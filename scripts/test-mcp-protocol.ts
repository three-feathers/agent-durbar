/** Unit test for the MCP framing and protocol subset (spec 041 T012): `npm run test:runtime`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { LineFramer, MAX_MESSAGE_BYTES, parseMessage } from '../src/main/mcp/jsonrpc';
import { LATEST_PROTOCOL_VERSION, McpSession, SUPPORTED_PROTOCOL_VERSIONS, McpError } from '../src/main/mcp/protocol';
import { FakeMcpClient, loopback } from './fakes/mcp-client';

const mk = (): McpSession => new McpSession({ serverInfo: { name: 'agent-durbar', version: '9.9.9' } });
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
  const c = loopback(mk());
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
  const d = loopback(s);
  assert.deepStrictEqual(d.request('tools/list').result, { tools: [] });
  const b = d.request('boom');
  assert.strictEqual(b.error.code, -32603);
  assert.ok(!JSON.stringify(b).includes('secret'), 'internal errors do not leak the message');
  assert.strictEqual(d.request('bad').error.code, -32602);
  const w = new McpSession({ serverInfo: { name: 'a', version: '1' }, methods: { nothing: () => undefined } });
  assert.deepStrictEqual(loopback(w).request('nothing').result, {}, 'a handler returning undefined still gives a valid result');
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

console.log('mcp protocol: ok');
