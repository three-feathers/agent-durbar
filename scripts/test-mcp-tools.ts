/** Unit test for the MCP tool registry, dispatch and init gate (spec 041 T013): `npm run test:runtime`. */
import * as assert from 'assert';
import { JsonSchema, CHANGE_TOOLS, CHANGE_TOOLS_ENABLED, READ_TOOLS, ToolDef, ToolHandlers, matches, createToolRegistry } from '../src/main/mcp/tools';
import { LATEST_PROTOCOL_VERSION, McpSession } from '../src/main/mcp/protocol';
import { FakeMcpClient, loopback } from './fakes/mcp-client';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const stubs = (): ToolHandlers => {
  const h: ToolHandlers = {};
  for (const t of [...READ_TOOLS, ...CHANGE_TOOLS]) h[t.name] = (a) => text(`${t.name}:${JSON.stringify(a)}`);
  return h;
};
const client = (changeToolsEnabled: boolean, handlers: ToolHandlers = stubs(), init = true): FakeMcpClient => {
  const reg = createToolRegistry({ handlers, changeToolsEnabled });
  let t = 0; // each call moves the clock 1 s so the 10 calls/s limit of the connection never interferes
  const c = loopback(new McpSession({ serverInfo: { name: 'agent-durbar', version: '1' }, methods: reg.methods() }), 0, { now: () => (t += 1000) });
  if (init) {
    c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'c', version: '1' } });
    c.notify('notifications/initialized');
  }
  return c;
};
const names = (c: FakeMcpClient): string[] => c.request('tools/list').result.tools.map((t: any) => t.name);

// FR-028: nothing that starts sessions, sends prompts, resolves permissions or limits, or resets totals
const FORBIDDEN = /session|prompt|send|start|stop|end_turn|permission|resolve|grant|approve|limit|reset|usage_reset|turn/i;

async function main(): Promise<void> {
  // the shipped build flag is off until T038
  assert.strictEqual(CHANGE_TOOLS_ENABLED, false, 'change tools are off in this build (FR-064)');

  // 1. tools/list shape, flag off
  {
    const c = client(false);
    const r = c.request('tools/list');
    assert.ok(Array.isArray(r.result.tools));
    for (const t of r.result.tools) {
      assert.deepStrictEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name'], 'only MCP fields on the wire');
      assert.ok(/^durbar_[a-z_]+$/.test(t.name) && t.description.length > 10 && t.inputSchema.type === 'object');
    }
    assert.deepStrictEqual(names(c), [
      'durbar_list_folders', 'durbar_list_agents', 'durbar_list_floors', 'durbar_usage_totals', 'durbar_settings', 'durbar_mcp_state', 'durbar_request_status',
    ], 'the seven read tools of FR-010, nothing else');
    assert.ok(!JSON.stringify(r).includes('"kind"'), 'internal kind is not sent');
  }

  // 2. change tools: absent with the flag off, present with it on, with the confirmation wording
  {
    const off = names(client(false));
    for (const t of CHANGE_TOOLS) assert.ok(!off.includes(t.name), `${t.name} not listed while the flag is off`);
    const on = client(true);
    const listed = on.request('tools/list').result.tools;
    for (const t of CHANGE_TOOLS) {
      const l = listed.find((x: any) => x.name === t.name);
      assert.ok(l, `${t.name} listed with the flag on`);
      assert.ok(/confirmation in Durbar/.test(l.description), `${t.name} says it needs confirmation in Durbar`);
    }
    for (const t of READ_TOOLS) assert.ok(!/confirmation/.test(listed.find((x: any) => x.name === t.name).description), 'read tools need no confirmation');
    // dispatch follows the same switch
    const offCall = client(false).request('tools/call', { name: 'durbar_remove_folder', arguments: { folder: '/x' } });
    assert.strictEqual(offCall.error.code, -32602);
    assert.strictEqual(offCall.error.message, 'Unknown tool', 'a change tool with the flag off answers as unknown');
    const unk = client(false).request('tools/call', { name: 'nope', arguments: {} });
    assert.deepStrictEqual(offCall.error, unk.error, 'indistinguishable from a name that never existed');
    const onCall = await on.requestAsync('tools/call', { name: 'durbar_remove_folder', arguments: { folder: '/x' } });
    assert.ok(onCall.result.content[0].text.startsWith('durbar_remove_folder'), 'dispatched with the flag on');
  }

  // 3. FR-028: no such tool in any build (names, and the registry as a whole)
  {
    for (const flag of [false, true]) {
      for (const n of names(client(flag))) {
        assert.ok(!FORBIDDEN.test(n.replace(/^durbar_/, '')), `FR-028: ${n} must not exist`);
      }
    }
    const all = [...READ_TOOLS, ...CHANGE_TOOLS].map((t) => t.name);
    assert.strictEqual(new Set(all).size, all.length, 'tool names are unique');
    for (const n of ['durbar_start_session', 'durbar_send_prompt', 'durbar_stop', 'durbar_resolve_permission', 'durbar_resolve_limit', 'durbar_reset_usage']) {
      assert.ok(!all.includes(n));
      const r = await client(true).requestAsync('tools/call', { name: n, arguments: {} });
      assert.strictEqual(r.error.code, -32602, `${n} is unknown even with the flag on`);
    }
  }

  // 4. tools/call: success, bad args (-32602, nothing echoed), unknown tool
  {
    const c = client(true);
    assert.strictEqual((await c.requestAsync('tools/call', { name: 'durbar_list_folders' })).result.content[0].text, 'durbar_list_folders:{}', 'missing arguments mean {}');
    assert.ok((await c.requestAsync('tools/call', { name: 'durbar_list_folders', arguments: {} })).result);
    const secret = 'SECRET-VALUE-123';
    const bad: unknown[] = [
      { name: 'durbar_list_folders', arguments: { extra: secret } }, // additional property
      { name: 'durbar_request_status', arguments: {} }, // required missing
      { name: 'durbar_request_status', arguments: { requestId: 5 } }, // wrong type
      { name: 'durbar_request_status', arguments: { requestId: 'x'.repeat(65) + secret } }, // too long
      { name: 'durbar_request_status', arguments: [secret] }, // not an object
      { name: 'durbar_request_status', arguments: secret },
      { name: 'durbar_set_mode', arguments: { target: 'a', mode: 'allow' } }, // enum
      { name: 'durbar_set_cap', arguments: { target: 'a', cap: -1 } },
      { name: 'durbar_set_cap', arguments: { target: 'a', cap: secret } },
      { name: 'durbar_set_cap', arguments: { target: 'a' } }, // cap is required (null removes it)
      { name: 7 },
      {},
      null,
      'str',
    ];
    for (const p of bad) {
      const r = await c.requestAsync('tools/call', p);
      assert.strictEqual(r.error.code, -32602, `bad params ${JSON.stringify(p)}`);
      assert.ok(!JSON.stringify(r).includes(secret), 'the reply never echoes the arguments');
    }
    assert.ok((await c.requestAsync('tools/call', { name: 'durbar_set_cap', arguments: { target: 'a', cap: null } })).result, 'null removes a cap');
    assert.ok((await c.requestAsync('tools/call', { name: 'durbar_set_cap', arguments: { target: 'a', cap: 2.5 } })).result);
    // names that are Object.prototype keys are not tools
    assert.strictEqual((await c.requestAsync('tools/call', { name: 'toString', arguments: {} })).error.message, 'Unknown tool');
    assert.strictEqual((await c.requestAsync('tools/call', { name: '__proto__', arguments: {} })).error.message, 'Unknown tool');
  }

  // 5. async handler result and rejection
  {
    const h = stubs();
    h.durbar_list_floors = async () => text('async ok');
    h.durbar_settings = () => Promise.reject(new Error('secret /home/me/.copilot/token'));
    h.durbar_usage_totals = () => { throw new Error('secret sync'); };
    h.durbar_list_agents = () => ({ content: [{ type: 'text', text: 'boom' }], isError: true });
    const c = client(false, h);
    assert.strictEqual((await c.requestAsync('tools/call', { name: 'durbar_list_floors', arguments: {} })).result.content[0].text, 'async ok');
    const rej = await c.requestAsync('tools/call', { name: 'durbar_settings', arguments: {} });
    assert.strictEqual(rej.error.code, -32603, 'rejection: -32603');
    assert.strictEqual(rej.error.message, 'Internal error');
    assert.ok(!JSON.stringify(rej).includes('secret'), 'no leak');
    const thr = await c.requestAsync('tools/call', { name: 'durbar_usage_totals', arguments: {} });
    assert.strictEqual(thr.error.code, -32603);
    assert.ok(!JSON.stringify(thr).includes('secret'));
    assert.strictEqual((await c.requestAsync('tools/call', { name: 'durbar_list_agents', arguments: {} })).result.isError, true, 'a handler can report a tool-level error');
    // a listed tool with no handler wired is an internal error, not a crash
    const bare = client(false, {});
    assert.strictEqual((await bare.requestAsync('tools/call', { name: 'durbar_list_folders', arguments: {} })).error.code, -32603);
    assert.strictEqual(names(bare).length, READ_TOOLS.length, 'listing is static: it needs no handlers');
  }

  // 6. init gate
  {
    const c = client(true, stubs(), false);
    assert.strictEqual(c.request('ping').result !== undefined, true, 'ping allowed before initialize');
    for (const [m, p] of [['tools/list', undefined], ['tools/call', { name: 'durbar_list_folders', arguments: {} }], ['no/such', undefined]] as const) {
      const r = c.request(m, p);
      assert.strictEqual(r.error.code, -32002, `${m} before initialize is refused`);
      assert.strictEqual(r.error.message, 'Server not initialized');
    }
    assert.strictEqual(c.request('initialize', {}).error.code, -32602, 'a failed initialize does not open the gate');
    assert.strictEqual(c.request('tools/list').error.code, -32002, 'still closed after a failed initialize');
    assert.ok(c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION }).result);
    assert.ok(Array.isArray(c.request('tools/list').result.tools), 'open after a successful initialize');
  }

  // 7. hardening: fail-closed schemas, frozen registry, name and argument tricks
  {
    const walk = (n: JsonSchema, where: string): void => {
      assert.ok(n.type !== undefined || n.anyOf !== undefined, `${where}: schema node needs a type or anyOf`);
      for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, `${where}.${k}`);
      (n.anyOf ?? []).forEach((v, i) => walk(v, `${where}[${i}]`));
    };
    for (const t of [...READ_TOOLS, ...CHANGE_TOOLS]) walk(t.inputSchema, t.name);
    assert.strictEqual(matches({} as JsonSchema, 'x'), false, 'an empty schema node accepts nothing');
    assert.strictEqual(matches({ type: 'object', properties: { a: {} }, additionalProperties: false }, { a: 1 }), false, 'a typeless property accepts nothing');

    assert.ok(Object.isFrozen(READ_TOOLS) && Object.isFrozen(CHANGE_TOOLS), 'lists frozen');
    for (const t of [...READ_TOOLS, ...CHANGE_TOOLS]) {
      assert.ok(Object.isFrozen(t) && Object.isFrozen(t.inputSchema) && Object.isFrozen(t.inputSchema.properties), `${t.name} frozen`);
      if (t.inputSchema.required) assert.ok(Object.isFrozen(t.inputSchema.required), `${t.name} required frozen`);
    }
    assert.throws(() => (READ_TOOLS as ToolDef[]).push(CHANGE_TOOLS[0]), TypeError, 'cannot push a change tool into the read list');

    const c = client(true);
    for (const n of ['DURBAR_LIST_FOLDERS', ' durbar_list_folders', 'durbar_list_folders ', 'durbar_list_folders\u0000', 'durbar_list_folders\n', '']) {
      const r = await c.requestAsync('tools/call', { name: n, arguments: {} });
      assert.strictEqual(r.error.message, 'Unknown tool', `name variant ${JSON.stringify(n)}`);
    }
    c.sendRaw('{"jsonrpc":"2.0","id":9001,"method":"tools/call","params":{"name":"durbar_set_cap","arguments":{"__proto__":{"polluted":1},"target":"a","cap":null}}}\n');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(c.replies.find((x) => x.id === 9001).error.code, -32602, '__proto__ argument refused');
    assert.strictEqual(({} as any).polluted, undefined, 'no prototype pollution');
    c.sendRaw('{"jsonrpc":"2.0","id":9002,"method":"tools/call","params":{"name":"durbar_set_cap","arguments":{"target":"a","cap":1e400}}}\n');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(c.replies.find((x) => x.id === 9002).error.code, -32602, '1e400 (Infinity) refused');

    let ran = 0;
    const h = stubs();
    h.durbar_list_folders = () => { ran++; return text('x'); };
    const n = client(false, h);
    const before = n.replies.length;
    n.notify('tools/call', { name: 'durbar_list_folders', arguments: {} });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(ran, 0, 'a tools/call notification runs no handler');
    assert.strictEqual(n.replies.length, before, 'and gets no reply');
  }

  console.log('mcp tools: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
