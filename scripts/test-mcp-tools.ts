/** Unit test for the MCP tool registry, dispatch and init gate (spec 041 T013): `npm run test:runtime`. */
import * as assert from 'assert';
import { JsonSchema, CHANGE_TOOLS, CHANGE_TOOLS_ENABLED, READ_TOOLS, ToolDef, ToolHandlers, matches, createToolRegistry } from '../src/main/mcp/tools';
import { LATEST_PROTOCOL_VERSION, McpSession } from '../src/main/mcp/protocol';
import { FakeMcpClient, loopback } from './fakes/mcp-client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MASK_BUDGET_NOTE, MASK_CHARS, MASK_MAX_ENTRIES, SIM_NOTE, createReadToolHandlers, makePathReducer } from '../src/main/mcp/readtools';
import { MASK_INPUT_MAX } from '../src/shared/redact';
import type { ReadToolsDeps } from '../src/main/mcp/readtools';
import { AgentStateTracker } from '../src/main/mcp/agentstate';
import { UsageTotalsStore } from '../src/main/usagetotalsstore';
import type { AgentInfo, McpAmbientView } from '../src/shared/api';
import type { McpServerView } from '../src/shared/mcp';
import type { SavedFolder } from '../src/main/folders';
import { officeTotals } from '../src/shared/usagedoc';

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

  // 12. T016: the read tools over injected getters, through the registry
  {
    const SECRETS = {
      envValue: 'ENVVALUE-9f8e7d6c5b4a3921',
      headerValue: 'HDRVALUE-1a2b3c4d5e6f7a8b',
      extraValue: 'EXTRAVALUE-0p9o8i7u6y5t4r3e',
      argToken: 'ARGTOKEN-q1w2e3r4t5y6u7i8',
      argEq: 'ARGEQ-z9x8c7v6b5n4m3l2',
      argEq2: 'ARGEQTWO-a1s2d3f4g5h6j7k8',
      argHdr: 'ARGHDR-p0o9i8u7y6t5r4e3',
      urlPass: 'URLPASS-m4n5b6v7c8x9z0l1',
      urlQuery: 'URLQUERY-k3j4h5g6f7d8s9a0',
      prompt: 'PROMPT-TEXT-SHOULD-NEVER-APPEAR',
      outside: '/outside/saved/folders/secret-dir',
      oneArg: 'ONEARG-' + 'b1n2m3v4c5x6z7a8',
      colon: 'COLON-' + 'l9k8j7h6g5f4d3s2',
      slash: 'SLASH-' + 'p1o2i3u4y5t6r7e8',
      cookie: 'COOKIE-' + 'w1q2a3s4z5x6c7d8',
      json: 'JSON-' + 'e4r5t6y7u8i9o0p1',
      conn: 'CONN-' + 'f1g2h3j4k5l6z7x8',
      userinfo: 'USERINFO-' + 'c9v8b7n6m5a4s3d2',
      telegram: 'TELEGRAM-' + 'q9w8e7r6t5y4u3i2',
      slack: 'SLACK-' + 'o1p2a3s4d5f6g7h8',
      amz: 'AMZ-' + 'j9k8l7z6x5c4v3b2',
      cmdTok: 'CMDTOK-' + 'n1m2q3w4e5r6t7y8',
      pathDir: '/home/me/.config',
      extraPart: 'EXTRAPART-' + 'u1i2o3p4a5s6d7f8',
      // T064 (#336): shapes of the follow-ups entry
      shellTok: 'SHELLTOK-' + 'a1s2d3f4g5h6j7k8',
      exportTok: 'EXPORTTOK-' + 'q1w2e3r4t5y6u7i8',
      hdrAfter: 'HDRAFTER-' + 'z1x2c3v4b5n6m7a8',
      cookieSemi: 'COOKIESEMI-' + 'l1k2j3h4g5f6d7s8',
      spaceColon: 'SPACECOLON-' + 'p9o8i7u6y5t4r3e2',
      quotedHdr: 'QUOTEDHDR-' + 'm1n2b3v4c5x6z7l8',
      commaPw: 'COMMAPW-' + 'w9e8r7t6y5u4i3o2',
      nameValue: 'NAMEVALUE-' + 'g1h2j3k4l5z6x7c8',
      wholeQuoted: 'WHOLEQUOTED-' + 'r1t2y3u4i5o6p7a8',
      shellUrl: 'SHELLURL-' + 'd9f8g7h6j5k4l3z2',
      schemeFlag: 'SCHEMEFLAG-' + 'a1b2c3d4e5f6g7h8',
      schemeHdr: 'SCHEMEHDR-' + 'i9j8k7l6m5n4o3p2',
      schemeBare: 'SCHEMEBARE-' + 'q1r2s3t4u5v6w7x8',
      schemeShell: 'SCHEMESH-' + 'y9z8a7b6c5d4e3f2',
      escObj: 'ESCOBJ-' + 'g1h2i3j4k5l6m7n8',
    };
    const folder = (i: number, over: Partial<SavedFolder> = {}): SavedFolder => ({ workspace: path.join(os.tmpdir(), `durbar-t016-f${i}`), permMode: i % 3 === 0 ? 'ask' : 'read-only', hidden: false, ...over });
    const agentOf = (f: SavedFolder, i: number, over: Partial<AgentInfo> = {}): AgentInfo => ({
      id: `ag-${i}`, name: path.basename(f.workspace), title: SECRETS.prompt, cwd: f.workspace, folders: [f.workspace], permMode: f.permMode, model: 'm-1', adapterId: 'copilot', ...over,
    });
    const extra: McpServerView = {
      name: 'gh', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false,
      command: 'npx', args: ['-y', 'srv', '--token', SECRETS.argToken, `--api-key=${SECRETS.argEq}`, '--verbose', 'X_TOKEN=' + SECRETS.argEq2, 'X-Api-Key: ' + SECRETS.argHdr],
      url: `https://u:${SECRETS.urlPass}@example.test/mcp?api_key=${SECRETS.urlQuery}&x=1`,
      workingDirectory: SECRETS.outside,
      // a real McpServerView carries no values; a buggy store that did must still not leak (the planted `value` fields)
      env: [{ key: 'GH_TOKEN', set: true, value: SECRETS.envValue } as any],
      headers: [{ key: 'Authorization', set: true, value: SECRETS.headerValue } as any],
      secretValue: SECRETS.extraValue,
    } as any;
    // T053: every shape of the masking-leaks entry planted in one extra and one CLI entry
    const planted: McpServerView = {
      name: 'planted', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false,
      command: `npx srv --token ${SECRETS.cmdTok} ${SECRETS.pathDir}/bin/srv`,
      args: [`--token ${SECRETS.oneArg}`, `--password:${SECRETS.colon}`, '/token', SECRETS.slash, `--header=Cookie: sid=${SECRETS.cookie}`, '--config', `${SECRETS.pathDir}/x.json`,
        `{"apiKey":"${SECRETS.json}","port":1}`, `CONN=Server=x;Password=${SECRETS.conn};Database=d`, '--url', `https://${SECRETS.userinfo}@h.test/`,
        `--endpoint=https://api.telegram.org/bot12345:${SECRETS.telegram}/sendMessage`, `--hook=https://hooks.slack.com/services/T0/B0/${SECRETS.slack}`,
        `--link=https://h.test/f?X-Amz-Signature=${SECRETS.amz}`, 'prefix-' + SECRETS.extraPart],
      url: `https://${SECRETS.userinfo}@h.test/mcp?X-Amz-Signature=${SECRETS.amz}`,
      env: [], headers: [],
      secretValue: SECRETS.extraPart,
    } as any;
    const mk = (n: number, nf: number, over: Partial<ReadToolsDeps> = {}) => {
      const folders = Array.from({ length: nf }, (_, i) => folder(i, i === 1 ? { hidden: true, closed: true, label: 'Nice room', floor: 'f-aaaaaaaa', maxAiCredits: 120 } : {}));
      const agents = Array.from({ length: n }, (_, i) => agentOf(folders[i % nf], i, i === 0 ? { lazy: true } : i === 1 ? { floor: 'f-aaaaaaaa', maxAiCredits: 120, permMode: 'allow' } : {}));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t016-'));
      const usage = new UsageTotalsStore(path.join(dir, 'u.json'), { delayMs: 1e9, setTimer: () => 0, clearTimer: () => undefined });
      const tracker = new AgentStateTracker();
      const deps: ReadToolsDeps = {
        folders: () => folders,
        agents: () => agents,
        tracker,
        floors: () => ({ floors: [{ id: 'ground', name: 'Ground floor', on: true }, { id: 'f-aaaaaaaa', name: 'Attic', on: false }], lastFloor: 'f-aaaaaaaa' }),
        usage,
        settings: () => ({ defaultMaxAiCredits: 300, seriousMode: true, placeMap: { gh: 'web' }, customPlaces: [{ id: 'c-abc123', name: 'Lab', icon: 'flask' }], theme: 'secret-theme' }),
        mcpCli: () => ({ cli: [{ name: 'cli1', origin: 'copilot-config', transport: 'stdio', args: ['s.js', '--password', SECRETS.argToken, `--token ${SECRETS.oneArg}`], command: `node --api-key=${SECRETS.cmdTok} ${SECRETS.pathDir}/s.js`, enabled: false }, { name: 'github-mcp-server', origin: 'builtin', enabled: true }], file: { label: '~/.copilot/mcp-config.json', found: true, skipped: 1, error: SECRETS.outside }, secretsPersist: false }),
        mcpExtras: (k) => (k === folders[0].workspace ? [extra, planted] : []),
        windowSim: () => false,
        platform: 'linux',
        extraSecretValues: (k) => (k === folders[0].workspace ? [SECRETS.extraValue, SECRETS.extraPart] : []),
        ...over,
      };
      const reg = createToolRegistry({ handlers: createReadToolHandlers(deps) });
      let t = 0;
      const c = loopback(new McpSession({ serverInfo: { name: 'agent-durbar', version: '1' }, methods: reg.methods() }), 0, { now: () => (t += 1000) });
      c.request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'c', version: '1' } });
      c.notify('notifications/initialized');
      const call = async (name: string, args: object = {}): Promise<any> => {
        const r = await c.requestAsync('tools/call', { name, arguments: args });
        assert.ok(!r.error && !r.result.isError, `${name} answered: ${JSON.stringify(r).slice(0, 200)}`);
        assert.strictEqual(r.result.content[0].type, 'text');
        return { raw: r.result.content[0].text as string, data: JSON.parse(r.result.content[0].text) };
      };
      return { call, c, usage, tracker, folders, agents, deps };
    };

    // 12a. all seven tools answer valid JSON through the registry, and invalid arguments get the registry's error
    {
      const { call, c } = mk(15, 40);
      const all: string[] = [];
      for (const t of READ_TOOLS) {
        const args = t.name === 'durbar_request_status' ? { requestId: 'r-1' } : {};
        const r = await call(t.name, args);
        assert.ok(typeof r.data === 'object' && r.data !== null, `${t.name} returns a JSON object`);
        all.push(r.raw);
        const bad = await c.requestAsync('tools/call', { name: t.name, arguments: { surprise: 1 } });
        assert.strictEqual(bad.error.code, -32602, `${t.name} refuses unknown arguments`);
      }
      const noId = await c.requestAsync('tools/call', { name: 'durbar_request_status', arguments: {} });
      assert.strictEqual(noId.error.code, -32602, 'request_status needs requestId');
      const stub = await call('durbar_request_status', { requestId: 'r-1' });
      assert.strictEqual(stub.data.available, false, 'request status is a stub until T031');
      assert.ok(!stub.raw.includes('r-1'), 'the stub does not echo the id');
    }

    // 12b. folders, agents, floors, settings
    {
      const { call, folders } = mk(15, 40);
      const f = (await call('durbar_list_folders')).data.folders;
      assert.strictEqual(f.length, 40);
      assert.deepStrictEqual(Object.keys(f[1]).sort(), ['adapter', 'agents', 'cap', 'door', 'floor', 'floorOn', 'hidden', 'key', 'mode', 'name']);
      assert.strictEqual(f[1].name, 'Nice room');
      assert.strictEqual(f[1].door, 'closed');
      assert.strictEqual(f[1].hidden, true);
      assert.strictEqual(f[1].cap, 120);
      assert.strictEqual(f[1].floorOn, false, 'the attic is off');
      assert.strictEqual(f[0].mode, 'Ask first');
      assert.strictEqual(f[2].mode, 'Read-only');
      assert.strictEqual(f[0].key, folders[0].workspace);
      assert.strictEqual(f[0].agents, 1);
      assert.strictEqual(f[20].agents, 0);

      const a = (await call('durbar_list_agents')).data.agents;
      assert.strictEqual(a.length, 15);
      assert.deepStrictEqual(Object.keys(a[0]).sort(), ['adapter', 'cap', 'floor', 'floorOn', 'folder', 'hidden', 'id', 'lazy', 'mode', 'model', 'name', 'state', 'subLabel']);
      assert.strictEqual(a[0].state, 'Idle');
      assert.strictEqual(a[0].subLabel, 'Not started', 'a lazy agent is Not started');
      assert.strictEqual(a[0].lazy, true);
      assert.strictEqual(a[2].subLabel, null);
      assert.strictEqual(a[2].lazy, false);
      assert.strictEqual(a[1].mode, 'Allow all');
      assert.strictEqual(a[1].cap, 120);
      assert.strictEqual(a[1].floorOn, false);
      assert.strictEqual(a[2].floorOn, true);
      assert.strictEqual(a[2].cap, null);
    }

    // 12c. the state word and sub-label follow the tracker
    {
      const { call, tracker } = mk(3, 3);
      await call('durbar_list_agents'); // ensure() registers the agents
      tracker.onEvent({ type: 'limit', sessionId: 'ag-2', phase: 'exhausted', requestId: 'q' } as any);
      tracker.noteSend('ag-1');
      tracker.setPaused('ag-0', true);
      const a = (await call('durbar_list_agents')).data.agents;
      assert.deepStrictEqual([a[2].state, a[2].subLabel], ['Waiting', 'Limit reached']);
      assert.deepStrictEqual([a[1].state, a[1].subLabel], ['Thinking', null]);
      assert.deepStrictEqual([a[0].state, a[0].subLabel], ['Paused', null]);
    }

    // 12d. floors and settings
    {
      const { call } = mk(2, 2);
      const fl = (await call('durbar_list_floors')).data;
      assert.deepStrictEqual(fl.floors.map((x: any) => [x.id, x.on, x.ground]), [['ground', true, true], ['f-aaaaaaaa', false, false]]);
      assert.strictEqual(fl.lastFloor, 'f-aaaaaaaa');
      const st = (await call('durbar_settings')).data;
      assert.deepStrictEqual(st, { defaultCap: 300, seriousMode: true, placeMap: { gh: 'web' }, customPlaces: [{ id: 'c-abc123', name: 'Lab', icon: 'flask' }] });
      const none = (await call('durbar_settings')).data;
      assert.ok(!('theme' in none));
    }

    // 12e. MCP state: key names only, args and urls masked
    {
      const { call } = mk(2, 2);
      const m = (await call('durbar_mcp_state')).data;
      assert.deepStrictEqual(m.copilotCli.servers.map((s: any) => [s.name, s.enabled]), [['cli1', false], ['github-mcp-server', true]]);
      assert.deepStrictEqual(m.copilotCli.servers[0].args, ['s.js', '--password', '[redacted]', '--token [redacted]']);
      assert.strictEqual(m.copilotCli.servers[0].command, 'node --api-key=[redacted] …/s.js');
      assert.strictEqual(m.copilotCli.file.found, true);
      assert.strictEqual(m.copilotCli.secretsPersist, false);
      assert.strictEqual(m.extras.length, 1);
      const e = m.extras[0].servers[0];
      assert.deepStrictEqual(e.envKeys, [{ key: 'GH_TOKEN', set: true }]);
      assert.deepStrictEqual(e.headerKeys, [{ key: 'Authorization', set: true }]);
      assert.deepStrictEqual(e.args, ['-y', 'srv', '--token', '[redacted]', '--api-key=[redacted]', '--verbose', 'X_TOKEN=[redacted]', 'X-Api-Key: [redacted]']);
      assert.ok(e.url.includes('x=1') && e.url.includes('api_key=[redacted]') && !e.url.includes('u:'), e.url);
      assert.ok(!('workingDirectory' in e));
    }

    // 12f. SC-004: no planted secret anywhere in any result
    {
      const { call } = mk(15, 40);
      const dump: string[] = [];
      for (const t of READ_TOOLS) dump.push((await call(t.name, t.name === 'durbar_request_status' ? { requestId: 'x' } : {})).raw);
      const all = dump.join('\n');
      for (const [k, v] of Object.entries(SECRETS)) assert.ok(!all.includes(v), `planted ${k} never appears in any result`);
      assert.ok(!all.includes('secret-theme'), 'theme is not part of the settings answer');
      assert.ok(all.includes('GH_TOKEN'), 'the key name itself is shown');
      assert.ok(!all.includes('/home/me/.config') && !all.includes('.config'), 'no directory outside the saved folders');
      assert.ok(all.includes('…/srv') && all.includes('…/x.json') && all.includes('…/s.js'), 'outside paths come back as …/ plus the base name');
      assert.ok(all.includes(path.join(os.tmpdir(), 'durbar-t016-f0').replace(/\\/g, '\\\\')), 'a saved folder path is whole');
    }

    // 12f (T064). The follow-up shapes planted in a second extra, a CLI entry and a quoted `command`, in all seven tools
    {
      const S = SECRETS;
      const planted2: McpServerView = {
        name: 'planted2', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false,
        command: `srv -H "X-Api-Key: ${S.quotedHdr}" --token "${S.quotedHdr}x more"`,
        args: ['-c', `npx srv --token ${S.shellTok} --config ${S.pathDir}/x.json`, `export TOKEN=${S.exportTok}; npx srv`, `Cookie: a=1; sid=${S.cookieSemi}`, `Password : ${S.spaceColon}`,
          `user=me,password=${S.commaPw}`, `[{"name":"token","value":"${S.nameValue}"}]`, `"Server=x;Password=${S.wholeQuoted}"`, 'X-Api-Key:', S.hdrAfter, 'Cookie:', S.hdrAfter + 'b',
          `npx srv https://${S.shellUrl}@h.test/x`],
        env: [], headers: [],
      } as any;
      // T066 (R11, R7 on escaped pairs): a scheme word then the secret, and an escaped name/value object in a shell string
      planted2.args!.push('--auth', 'Bearer', S.schemeFlag, '-H', 'Authorization: Bearer', S.schemeHdr, 'Bearer', S.schemeBare, `curl --auth Basic ${S.schemeShell}`,
        `sh -c "{\\"name\\":\\"token\\",\\"value\\":\\"${S.escObj}\\"}"`);
      // T066 review: `curl -H "Authorization: <scheme>" SEC` in an extras `command` and in a CLI entry `command`, every scheme word, both quotes
      const schemeSecs: string[] = [];
      const schemeCmd = (q: string, tag: string): string => ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey'].map((w) => { const sec = `SCH${tag}-${w}-` + 'k3j2h1g0f9d8'; schemeSecs.push(sec); return `curl -H ${q}Authorization: ${w}${q} ${sec}`; }).join(' ; ');
      // round 3: `--header=Name: <scheme>` (no space, space, quoted flag), every scheme word
      const hdrFlagCmd = (form: 'nospace' | 'space' | 'quoted', tag: string): string => ['Bearer', 'Basic', 'Token', 'Digest', 'Negotiate', 'ApiKey'].map((w) => {
        const sec = `SCH${tag}-${w}-` + 'm7n6b5v4c3x2';
        schemeSecs.push(sec);
        return form === 'nospace' ? `curl --header=Authorization:${w} ${sec}` : form === 'space' ? `curl --header=Authorization: ${w} ${sec}` : `curl "--header=Authorization: ${w}" ${sec}`;
      }).join(' ; ');
      // round 6: a quoted header value with spaces (`Authorization: 'a SEC'`), single and double quotes, in extras and CLI `command`
      const quotedSecs: string[] = [];
      const quotedCmd = (tag: string): string => ["'", '"'].map((q) => { const sec = `QH${tag}${q === '"' ? 'D' : 'S'}-` + 'u8i7o6p5a4s3'; quotedSecs.push(sec); return `srv Authorization: ${q}a b${sec}${q} --x`; }).join(' ; ');
      const plantedQ = { ...planted2, name: 'plantedq', command: quotedCmd('E'), args: [], env: [], headers: [] } as any;
      const cliQ = { name: 'cliq', origin: 'copilot-config', transport: 'stdio', command: quotedCmd('C'), args: [], enabled: true };
      // round 7: unclosed quote, a scheme word then a quoted run, quoted scheme words, in extras and CLI `command` (each under the 1024-character extras cap)
      const r7Secs: string[] = [];
      const r7Cmd = (tag: string): string[] => {
        const sec = (k: string): string => { const v = `R7${tag}${k}-` + 'e5r4t3y2u1i0'; r7Secs.push(v); return v; };
        return [`srv Authorization: "a ${sec('a')}`, `srv X-Api-Key: 'a ${sec('b')}`, `srv Proxy-Authorization: Basic "${sec('c')} x" --y`, `srv Authorization: Bearer '${sec('d')} x'`,
          `srv Authorization: "Bearer" ${sec('e')}`, `curl -H Authorization:"Digest" ${sec('f')}`, `curl --header=Authorization: 'Token' ${sec('g')}`, `srv Authorization: Basic "${sec('h')} x`];
      };
      const plantedR7 = r7Cmd('E').map((command, i) => ({ ...planted2, name: 'plantedr7-' + i, command, args: [], env: [], headers: [] } as any));
      const cliR7 = r7Cmd('C').map((command, i) => ({ name: 'clir7-' + i, origin: 'copilot-config', transport: 'stdio', command, args: [], enabled: true }));
      // round 8: the same eight shapes as a shell-string ARG (`['-c', command]`), in extras and CLI args
      const plantedR7A = r7Cmd('A').map((c2, i) => ({ ...planted2, name: 'plantedr7a-' + i, command: 'srv', args: ['-c', c2], env: [], headers: [] } as any));
      const cliR7A = r7Cmd('B').map((c2, i) => ({ name: 'clir7a-' + i, origin: 'copilot-config', transport: 'stdio', command: 'sh', args: ['-c', c2], enabled: true }));
      // T067 (#447): escaped quotes in `sh -c`, `cmd /c` and PowerShell payloads, and a leading unmatched quote, as a `command` and as a
      // shell-string arg (`['-c', command]`), in extras and CLI entries; plus the naive-split arg form of the issue's row 1
      const escSecs: string[] = [];
      const escCmd = (tag: string): string[] => {
        const sec = (k: string): string => { const v = `E7${tag}${k}-` + 'z9x8c7v6b5n4'; escSecs.push(v); return v; };
        return [`sh -c "srv -H \\"X-Api-Key: ${sec('a')}\\""`, `powershell -Command "srv -H \`"X-Api-Key: ${sec('b')}\`""`,
          `powershell -Command "srv {\`"api_key\`":\`"${sec('c')}\`"}"`, `powershell -Command "srv {\`"name\`":\`"api_key\`",\`"value\`":\`"${sec('d')}\`"}"`,
          `powershell -Command "srv {\\\`"token\\\`":\\\`"${sec('e')}\\\`"}"`, `sh -c "srv --env=\\"API_TOKEN=${sec('f')}\\""`,
          `powershell -Command "srv --env=\`"API_TOKEN=${sec('g')}\`""`, `sh -c "srv --opt=\\"token=${sec('h')}\\""`, `powershell -Command "srv --opt=\`"token=${sec('i')}\`""`,
          `cmd /c "srv -H \\"X-Api-Key: ${sec('j')}\\""`, `cmd /c srv -H ^"X-Api-Key: ${sec('k')}^"`, `srv "--token=${sec('l')}`];
      };
      const plantedE = escCmd('E').map((command, i) => ({ ...planted2, name: 'plantede-' + i, command, args: [], env: [], headers: [] } as any));
      const cliE = escCmd('C').map((command, i) => ({ name: 'clie-' + i, origin: 'copilot-config', transport: 'stdio', command, args: [], enabled: true }));
      const plantedEA = escCmd('A').map((c2, i) => ({ ...planted2, name: 'plantedea-' + i, command: 'srv', args: ['-c', c2], env: [], headers: [] } as any));
      const cliEA = escCmd('B').map((c2, i) => ({ name: 'cliea-' + i, origin: 'copilot-config', transport: 'stdio', command: 'bash', args: ['-c', c2], enabled: true }));
      const row1 = ['E7R1E-q1w2e3r4t5y6', 'E7R1C-q1w2e3r4t5y6'];
      escSecs.push(...row1);
      const plantedR1 = { ...planted2, name: 'plantedr1', command: 'srv', args: ['-H', '"X-Api-Key:', row1[0] + '"'], env: [], headers: [] } as any;
      const cliR1 = { name: 'clir1', origin: 'copilot-config', transport: 'stdio', command: 'srv', args: ['-H', '"X-Api-Key:', row1[1] + '"'], enabled: true };
      const forms = ['nospace', 'space', 'quoted'] as const;
      const plantedF = forms.map((f) => ({ ...planted2, name: 'plantedf-' + f, command: hdrFlagCmd(f, 'F' + f[0].toUpperCase()), args: [], env: [], headers: [] } as any));
      const cliF = forms.map((f) => ({ name: 'clif-' + f, origin: 'copilot-config', transport: 'stdio', command: hdrFlagCmd(f, 'G' + f[0].toUpperCase()), args: [], enabled: true }));
      const planted3 = { ...planted2, name: 'planted3', command: schemeCmd('"', 'XD'), args: [], env: [], headers: [] } as any;
      const planted4 = { ...planted2, name: 'planted4', command: schemeCmd("'", 'XS'), args: [], env: [], headers: [] } as any;
      const cliSchemes = [
        { name: 'cli3', origin: 'copilot-config', transport: 'stdio', command: schemeCmd('"', 'CD'), args: [], enabled: true },
        { name: 'cli4', origin: 'copilot-config', transport: 'stdio', command: schemeCmd("'", 'CS'), args: [], enabled: true },
      ];
      const cliEntry = { name: 'cli2', origin: 'copilot-config', transport: 'stdio', command: 'sh', args: ['-c', `npx srv --api-key=${S.shellTok} --config ${S.pathDir}/c.json`], enabled: true };
      const { call } = mk(15, 40, {
        mcpExtras: (k: string) => (k === path.join(os.tmpdir(), 'durbar-t016-f0') ? [planted2, planted3, planted4, ...plantedF, plantedQ, ...plantedR7, ...plantedR7A, ...plantedE, ...plantedEA, plantedR1] : []),
        mcpCli: () => ({ cli: [cliEntry as any, ...(cliSchemes as any[]), ...cliF, cliQ as any, ...(cliR7 as any[]), ...(cliR7A as any[]), ...(cliE as any[]), ...(cliEA as any[]), cliR1 as any], file: { label: 'x', found: true, skipped: 0 }, secretsPersist: false }),
      });
      const all = (await Promise.all(READ_TOOLS.map((t) => call(t.name, t.name === 'durbar_request_status' ? { requestId: 'x' } : {})))).map((r) => r.raw).join('\n');
      for (const k of ['shellTok', 'exportTok', 'hdrAfter', 'cookieSemi', 'spaceColon', 'quotedHdr', 'commaPw', 'nameValue', 'wholeQuoted', 'shellUrl'] as const) assert.ok(!all.includes(S[k]), `12f: T064 ${k} never appears in any result`);
      for (const k of ['schemeFlag', 'schemeHdr', 'schemeBare', 'schemeShell', 'escObj'] as const) assert.ok(!all.includes(S[k]), `12f: T066 ${k} never appears in any result`);
      assert.strictEqual(r7Secs.length, 32, '12f: 32 planted round-7 secrets');
      for (const sec of r7Secs) assert.ok(!all.includes(sec), `12f: round-7 secret ${sec.slice(0, 6)} never appears in any result`);
      assert.strictEqual(quotedSecs.length, 4, '12f: 4 planted quoted-header secrets');
      for (const sec of quotedSecs) assert.ok(!all.includes(sec), `12f: quoted header value ${sec.slice(0, 5)} never appears in any result`);
      assert.strictEqual(schemeSecs.length, 24 + 36, '12f: 60 planted scheme secrets');
      for (const sec of schemeSecs) assert.ok(!all.includes(sec), `12f: T066 command scheme secret ${sec.slice(0, 12)} never appears in any result`);
      assert.strictEqual(escSecs.length, 4 * 12 + 2, '12f: 50 planted T067 escaped-quote secrets');
      for (const sec of escSecs) assert.ok(!all.includes(sec), `12f: T067 escaped-quote secret ${sec.slice(0, 6)} never appears in any result`);
      assert.ok(!all.includes('.config'), '12f: no .config directory in the T064 shapes');
      assert.ok(all.includes('…/x.json') && all.includes('…/c.json'), '12f: the shell-string paths are reduced');
    }

    // 12f1. T053: the `url` field goes through the path reducer too (a file URL outside the saved folders)
    {
      const fileExtra = { name: 'f', transport: 'http', enabled: true, trusted: true, needsSecrets: false, url: 'file:///home/me/.aws/c', env: [], headers: [] } as any;
      const { call } = mk(2, 2, { mcpExtras: (k: string) => (k === path.join(os.tmpdir(), 'durbar-t016-f0') ? [fileExtra] : []) });
      const m = (await call('durbar_mcp_state')).data;
      assert.strictEqual(m.extras[0].servers[0].url, 'file://…/c');
      assert.ok(!m.extras[0].servers[0].url.includes('.aws'));
    }

    // 12f2. T053 (h): the path reducer for all three platforms from any OS
    {
      const saved = ['/home/me/proj', 'C:\\Work\\Proj'];
      const run = (platform: NodeJS.Platform, args: string[]) => args.map(makePathReducer(saved, platform));
      for (const pf of ['linux', 'darwin', 'win32'] as const) {
        assert.deepStrictEqual(run(pf, ['/home/me/.local/bin/srv']), ['…/srv'], `${pf}: command`);
        assert.deepStrictEqual(run(pf, ['--config', '/home/me/.config/x.json']), ['--config', '…/x.json'], `${pf}: flag and next`);
        assert.deepStrictEqual(run(pf, ['--config=/etc/srv/x.json', 'CFG=/opt/a/b.json', '--config /etc/a/c.json']), ['--config=…/x.json', 'CFG=…/b.json', '--config …/c.json'], `${pf}: flag=, NAME=, flag value`);
        assert.deepStrictEqual(run(pf, ['/home/me/proj/tools/run.js', '/home/me/proj', '~/bin/srv']), ['/home/me/proj/tools/run.js', '/home/me/proj', '…/srv'], `${pf}: inside, the folder itself, home`);
        assert.deepStrictEqual(run(pf, ['C:\\Users\\me\\AppData\\srv.exe', '\\\\server\\share\\srv.exe']), ['…/srv.exe', '…/srv.exe'], `${pf}: drive and UNC`);
        assert.deepStrictEqual(run(pf, ['/home/me/projX/a.js', '/home/me/proj/../x/a.js']), ['…/a.js', '…/a.js'], `${pf}: prefix without being inside, and ..`);
        assert.deepStrictEqual(run(pf, ['/a', '/token', 'type=bind,src=/x/y', 'rel/path.js', '$HOME/x/y']), ['/a', '/token', 'type=bind,src=/x/y', 'rel/path.js', '$HOME/x/y'], `${pf}: not reduced`);
      }
      for (const pf of ['linux', 'darwin', 'win32'] as const) {
        assert.deepStrictEqual(run(pf, ['//etc/x', '~other/.ssh/id', 'file:///home/me/.aws/c', 'file:///home/me/proj/ok.js']), ['…/x', '…/id', 'file://…/c', 'file:///home/me/proj/ok.js'], `${pf}: //, ~user, file URL`);
        assert.deepStrictEqual(run(pf, ['C:\\a\\b.exe serve token=x']), ['…/b.exe'], `${pf}: the base name never carries args`);
      }
      assert.deepStrictEqual(run('win32', ['c:\\work\\proj\\x.js', 'C:/Work/Proj/sub']), ['c:\\work\\proj\\x.js', 'C:/Work/Proj/sub'], 'win32: case-insensitive, slashes either way');
      assert.deepStrictEqual(run('linux', ['/Home/me/proj/x.js']), ['…/x.js'], 'linux: exact case');
      assert.deepStrictEqual(run('darwin', ['/Home/me/proj/x.js']), ['/Home/me/proj/x.js'], 'darwin: case-insensitive');
      assert.deepStrictEqual(['/home/me/ws/a.js', '/home/me/other/a.js'].map(makePathReducer(['/home/me/ws/x.code-workspace'], 'linux')), ['/home/me/ws/a.js', '…/a.js'], 'a .code-workspace counts as its directory');
      // T064 (l): quoted paths (R9)
      for (const pf of ['linux', 'darwin', 'win32'] as const) {
        assert.deepStrictEqual(run(pf, ['"/home/me/.config/x.json"', "'/home/me/.config/x.json'", '--config="/etc/srv/x.json"', '"/home/me/proj/a.js"']), ['"…/x.json"', "'…/x.json'", '--config="…/x.json"', '"/home/me/proj/a.js"'], `${pf}: quoted paths`);
        assert.deepStrictEqual(run(pf, ['"C:\\Users\\me\\srv.exe"']), ['"…/srv.exe"'], `${pf}: quoted drive path`);
      }
      assert.deepStrictEqual(run('win32', ['"c:\\work\\proj\\x.js"']), ['"c:\\work\\proj\\x.js"'], 'win32: a quoted saved-folder path is unchanged');
      // T064 (m): paths in shell strings (R10)
      for (const pf of ['linux', 'darwin', 'win32'] as const) {
        assert.deepStrictEqual(run(pf, ['npx srv --config /home/me/.config/x.json']), ['npx srv --config …/x.json'], `${pf}: path in a shell string`);
        assert.deepStrictEqual(run(pf, ['npx srv --config /home/me/proj/x.json']), ['npx srv --config /home/me/proj/x.json'], `${pf}: inside path in a shell string`);
        assert.deepStrictEqual(run(pf, ['C:\\Program Files\\nodejs\\node.exe', '/Users/me/Library/Application Support/x/s.js']), ['…/node.exe', '…/s.js'], `${pf}: an arg that starts with a path keeps the whole-arg rule`);
        assert.deepStrictEqual(run(pf, ['type=bind,src=/x/y']), ['type=bind,src=/x/y'], `${pf}: comma pairs stay (documented gap)`);
      }
      const t0 = Date.now();
      const big = makePathReducer(saved, 'linux');
      for (const x of ['/a/'.repeat(70000), '--x='.repeat(40000), 'A=/'.repeat(70000), '"a '.repeat(66000), 'x /a/b '.repeat(28000)]) big(x);
      const ms = Date.now() - t0;
      console.log(`mcp read tools: path reducer on 200k-character inputs in ${ms} ms`);
      assert.ok(ms < 10000, `path reducer on 200k-character inputs took ${ms} ms`);
    }

    // 12f3. T064 (n): `durbar_mcp_state` with a shell-string CLI entry and a quoted `command`
    {
      const S = SECRETS;
      const cli = [
        { name: 'sh', origin: 'copilot-config', transport: 'stdio', command: 'sh', args: ['-c', 'npx srv --token ' + S.shellTok + ' --config /home/me/.config/x.json'], enabled: true },
        { name: 'q', origin: 'copilot-config', transport: 'stdio', command: 'srv -H "X-Api-Key: ' + S.quotedHdr + '"', enabled: true },
      ];
      const { call } = mk(2, 2, { mcpCli: () => ({ cli: cli as any, file: { label: 'x', found: true, skipped: 0 }, secretsPersist: false }) });
      const r = await call('durbar_mcp_state');
      assert.ok(!r.raw.includes(S.shellTok) && !r.raw.includes(S.quotedHdr), '12f3: no secret in the result');
      assert.ok(!r.raw.includes('.config'), '12f3: no .config in the result');
      assert.deepStrictEqual(r.data.copilotCli.servers[0].args, ['-c', 'npx srv --token [redacted] --config …/x.json']);
      assert.strictEqual(r.data.copilotCli.servers[1].command, 'srv -H "X-Api-Key: [redacted]"');
      // R8: `--auth Bearer <token>` is only masked when `redact()` runs on the raw command before it is split
      const bearer = 'BEARERTOK-' + 'k1l2m3n4o5p6q7r8';
      const r2 = await mk(2, 2, { mcpCli: () => ({ cli: [{ name: 'b', origin: 'copilot-config', transport: 'stdio', command: 'srv --auth Bearer ' + bearer, enabled: true }] as any, file: { label: 'x', found: true, skipped: 0 }, secretsPersist: false }) }).call('durbar_mcp_state');
      assert.ok(!r2.raw.includes(bearer), '12f3: --auth Bearer <token> in a command is masked (R8)');
      assert.strictEqual(r2.data.copilotCli.servers[0].command, 'srv --auth [redacted]');
    }

    // 12g. usage: baseline plus this run for the same events
    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t016u-'));
      const file = path.join(dir, 'u.json');
      const f0 = folder(0), f1 = folder(1);
      const seed = new UsageTotalsStore(file, { delayMs: 1e9, setTimer: () => 0, clearTimer: () => undefined });
      seed.record(f0.workspace, 'f0', { type: 'usage', inputTokens: 100, outputTokens: 50, nanoAiu: 2e9 });
      seed.record('/not/saved/anymore', 'gone', { type: 'usage', inputTokens: 7, outputTokens: 3, nanoAiu: 1e9 });
      seed.flush();
      const usage = new UsageTotalsStore(file, { delayMs: 1e9, setTimer: () => 0, clearTimer: () => undefined });
      usage.load();
      const base = usage.baselineView();
      const events = [
        [f0.workspace, 'f0', { type: 'usage', inputTokens: 10, outputTokens: 5, nanoAiu: 5e8 }],
        [f0.workspace, 'f0', { type: 'usage', inputTokens: 1, outputTokens: 1 }], // no credit figure
        [f1.workspace, 'f1', { type: 'usage', inputTokens: 20, outputTokens: 2, nanoAiu: 3e9 }],
        [f1.workspace, 'f1', { type: 'output', text: SECRETS.prompt }], // not a usage event: ignored
      ] as const;
      for (const [k, n, e] of events) usage.record(k, n, e);
      const { call } = mk(2, 2, { usage, folders: () => [f0, f1], agents: () => [] });
      const u = (await call('durbar_usage_totals')).data;
      assert.strictEqual(u.since, base.since);
      assert.strictEqual(u.office.calls, base.office.calls + 3, 'office: baseline calls + this run');
      assert.strictEqual(u.office.inTokens, base.office.inTokens + 31);
      assert.strictEqual(u.office.outTokens, base.office.outTokens + 8);
      assert.strictEqual(u.office.nano, base.office.nano + 3.5e9, 'office: baseline nano + this run');
      assert.strictEqual(u.office.unreportedCalls, base.office.unreported + 1);
      assert.strictEqual(u.office.aiu, (base.office.nano + 3.5e9) / 1e9);
      assert.strictEqual(u.office.nano, officeTotals(usage.view()).nano, 'equals the store view');
      const byName = (n: string): any => u.folders.find((x: any) => x.name === n);
      assert.strictEqual(byName('f0').calls, base.folderOf(f0.workspace)!.calls + 2);
      assert.strictEqual(byName('f0').path, f0.workspace, 'a saved folder keeps its path');
      assert.strictEqual(byName('f1').calls, 1);
      assert.strictEqual(byName('f1').nano, 3e9);
      assert.strictEqual(byName('gone').path, undefined, 'a folder that is no longer saved shows no path');
      assert.ok(!JSON.stringify(u).includes('/not/saved'));
    }

    // 12h. DURBAR_SIM note
    {
      const on = mk(2, 2, { windowSim: () => true });
      for (const n of ['durbar_list_agents', 'durbar_list_folders']) assert.strictEqual((await on.call(n)).data.note, SIM_NOTE, `${n} carries the sim note`);
      assert.ok(/DURBAR_SIM/.test(SIM_NOTE) && /not visible/.test(SIM_NOTE));
      const off = mk(2, 2);
      for (const n of ['durbar_list_agents', 'durbar_list_folders']) {
        const r = await off.call(n);
        assert.ok(!('note' in r.data) && !r.raw.includes('DURBAR_SIM'), `${n} has no note without the flag`);
      }
    }

    // 12i. FR-013: 15 agents and 40 folders, every tool, under 200 ms
    {
      const { call } = mk(15, 40, {});
      const t0 = process.hrtime.bigint();
      for (const t of READ_TOOLS) await call(t.name, t.name === 'durbar_request_status' ? { requestId: 'x' } : {});
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 200, `all seven read tools took ${ms.toFixed(1)} ms`);
      console.log(`mcp read tools: 15 agents + 40 folders, all seven tools in ${ms.toFixed(1)} ms`);
    }

    // 12k. T054: the per-string cap (4096 chars, token boundary, ` [truncated]`), applied after the masking
    {
      const sec = 'SEC' + 'CAP-' + 'k7m2q9x4w8z1v6b3';
      const exact = '/' + 'a'.repeat(4095);
      const longName = 'S'.repeat(5000);
      const longCmd = 'node ' + 'x '.repeat(5000);
      // the secret starts well before the cut and straddles it
      const straddle = 'node ' + 'y '.repeat(2040) + `--token ${sec} ` + 'z '.repeat(3000);
      const ex = (name: string, over: Partial<McpServerView>): McpServerView => ({ name, transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'npx', ...over } as any);
      const f0 = exact; // the saved folder path itself is 4096 characters
      const { call } = mk(2, 2, {
        mcpExtras: (k) => (k === f0 ? [ex('longcmd', { command: longCmd }), ex(longName, {}), ex('straddle', { command: straddle }), ex('edge', { command: 'a'.repeat(4096) })] : []),
        folders: () => [{ workspace: exact, permMode: 'read-only', hidden: false } as SavedFolder],
      });
      const { data } = await call('durbar_mcp_state');
      const servers = data.extras[0].servers as Array<{ name: string; command: string }>;
      const byName = (n: string) => servers.find((s) => s.name === n || s.name.startsWith(n))!;
      const lc = byName('longcmd').command;
      assert.ok(lc.length <= 4096 + 12 && lc.endsWith(' [truncated]'), `long command cut (${lc.length})`);
      assert.strictEqual(byName('edge').command.length, 4096, 'a string of exactly 4096 comes back whole');
      const sn = servers.find((s) => !['longcmd', 'straddle', 'edge'].includes(s.name))!.name; // one 5000-char token: nothing before the cut is a token boundary
      assert.ok(sn.length <= 4096 + 12 && sn.endsWith(' [truncated]'), 'a 5000-character server name is cut');
      const st = byName('straddle').command;
      assert.ok(st.length <= 4096 + 12, 'straddling command is capped');
      for (let i = 0; i + 8 <= sec.length; i++) assert.ok(!st.includes(sec.slice(i, i + 8)), 'no 8-character piece of the straddling secret');
      const fl = (await call('durbar_list_folders')).data.folders[0].key as string;
      assert.strictEqual(fl, exact, 'a 4096-character folder path comes back whole');
      // token boundary: 6-letter words, 6000+ chars, ends on a whole word
      const words = Array.from({ length: 960 }, () => 'abcdef').join(' ');
      const w = (await mk(1, 1, { mcpExtras: () => [ex('w', { command: words })] , folders: () => [{ workspace: f0, permMode: 'read-only', hidden: false } as SavedFolder] }).call('durbar_mcp_state')).data.extras[0].servers[0].command as string;
      assert.ok(/abcdef \[truncated\]$/.test(w) && w.slice(0, -12).split(' ').every((x) => x === 'abcdef') && w.length <= 4096 + 12, 'cut at a word boundary');
      // masking comes before the cut: a stored value with non-token characters straddling the cut is gone whole
      const stored = 'Qz8#' + 'Lm4!' + 'Rt7$Wx9';
      const sc = 'node ' + 'y '.repeat(2040) + ' opt=' + stored + ' end';
      const m = (await mk(1, 1, { mcpExtras: () => [ex('s', { command: sc })], extraSecretValues: () => [stored], folders: () => [{ workspace: f0, permMode: 'read-only', hidden: false } as SavedFolder] }).call('durbar_mcp_state')).data.extras[0].servers[0].command as string;
      for (const piece of ['Qz8#', 'Lm4!', 'Rt7$', 'Wx9']) assert.ok(!m.includes(piece), `stored value piece ${piece} is gone`);
    }

    // 12l. T065: bounded masking cost (MASK_INPUT_MAX per string, MASK_BUDGET per call, one top-level note)
    {
      const sec = 'SEC' + 'COST-' + 'p3n8d5r1t9y2';
      const cli = (entries: Array<Partial<McpAmbientView>>) => { const built = entries.map((e, i) => ({ name: `s${i}`, origin: 'copilot-config', transport: 'stdio', enabled: true, ...e }) as McpAmbientView); return mk(1, 1, { mcpExtras: () => [], mcpCli: () => ({ cli: built, file: { label: '~/.copilot/mcp-config.json', found: true, skipped: 0 }, secretsPersist: false }) }); };
      const state = async (entries: Array<Partial<McpAmbientView>>) => {
        // the handler is called directly: a result of megabytes is refused by the session, which is not what is timed here
        const h = createReadToolHandlers(cli(entries).deps);
        const t0 = process.hrtime.bigint();
        const res = await h.durbar_mcp_state({});
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const raw = (res.content[0] as { text: string }).text;
        return { raw, data: JSON.parse(raw), ms };
      };
      assert.ok(MASK_INPUT_MAX > 4096 && MASK_INPUT_MAX <= 16384, `MASK_INPUT_MAX ${MASK_INPUT_MAX} is above the display cap and at most 16384`);
      const R = '[redacted]';
      // the handler is called directly where the answer can be bigger than the session's frame
      const direct = async (deps: ReadToolsDeps) => { const res = await createReadToolHandlers(deps).durbar_mcp_state({}); const raw = (res.content[0] as { text: string }).text; return { raw, data: JSON.parse(raw) }; };

      // (a) one string over MASK_INPUT_MAX is hidden whole; one exactly at the limit goes through the rules
      {
        const over = '--password=' + sec + 'x'.repeat(MASK_INPUT_MAX); // longer than the limit
        const atLimit = ('--password=' + sec).padEnd(MASK_INPUT_MAX, 'y');
        assert.ok(over.length > MASK_INPUT_MAX, '12l(a): the long test string is over the limit');
        assert.strictEqual(atLimit.length, MASK_INPUT_MAX, '12l(a): the other test string is exactly at the limit');
        const r = await state([{ command: 'node ' + over, args: [over, atLimit], url: 'https://h.test/?k=' + over }]);
        const sv = r.data.copilotCli.servers[0];
        assert.strictEqual(sv.command, R, '12l(a): a command over the limit is [redacted]');
        assert.strictEqual(sv.args[0], R, '12l(a): an arg over the limit is [redacted]');
        assert.strictEqual(sv.url, R, '12l(a): a url over the limit is [redacted]');
        assert.ok(sv.args[1].startsWith('--password=[redacted]') && sv.args[1] !== R, `12l(a): an arg exactly at the limit is masked by the rules: ${sv.args[1].slice(0, 40)}`);
        assert.ok(!r.raw.includes(sec), '12l(a): no planted secret');
        assert.ok(!('masking' in r.data), '12l(a): a string over the limit alone does not spend the budget note');
      }

      // (b) the budget: first args by the rules, every later command, arg and url [redacted], one note
      {
        const piece = 2000;
        const n = Math.ceil(MASK_CHARS / piece) + 6; // the characters run out first
        const args = Array.from({ length: n }, (_, i) => `plain-${i}-` + 'x'.repeat(piece - 10));
        const r = await state([{ command: 'node', args, url: 'https://h.test/?t=' + sec }, { command: 'node ' + '--token ' + sec, args: ['--token', sec], url: 'https://h.test/?t=' + sec }]);
        assert.strictEqual(r.data.copilotCli.servers.length, 1, '12l(b): the entry after the spent budget is left out');
        const [a] = r.data.copilotCli.servers;
        assert.strictEqual(a.args[0], args[0], '12l(b): the first arg is masked by the rules (unchanged)');
        assert.strictEqual(a.args[a.args.length - 1], R, '12l(b): the last arg is [redacted]');
        const firstHidden = a.args.findIndex((x: string) => x === R);
        assert.ok(firstHidden >= Math.floor(MASK_CHARS / piece) && firstHidden <= Math.ceil(MASK_CHARS / piece) + 1, `12l(b): hidden from arg ${firstHidden}`);
        assert.strictEqual(a.args.length, firstHidden + 1, '12l(b): the hidden tail is one [redacted] element');
        assert.strictEqual(a.command, 'node', '12l(b): the command before the args was masked by the rules');
        assert.strictEqual(a.url, R, '12l(b): a url after the spent budget is [redacted]');
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): one top-level note');
        assert.ok(!r.raw.includes(sec), '12l(b): no planted secret');
        // under the budget: no note, and the same bytes the rules give
        const small = await state([{ command: 'node --api-key=' + sec, args: ['a', '--token', sec], url: 'https://h.test/?t=1' }]);
        assert.ok(!('masking' in small.data) && !small.raw.includes('budget'), '12l(b): under the budget there is no note');
        assert.strictEqual(small.data.copilotCli.servers[0].args[0], 'a');
        assert.deepStrictEqual(small.data.copilotCli.servers[0].args.slice(1), ['--token', R]);
      }

      // (c0) order: a command over the limit is hidden BEFORE the scheme pre-pass (`maskSchemeSecrets`) looks at it. A 1 MB command of
      // `Authorization: Bearer x ` costs about 1-20 ms when it is only measured, and about 90-150 ms when the pre-pass scans it; the best of
      // three runs against a 30 ms limit (150 times the normal cost, a third of the pre-pass cost), plus the answer itself (one `[redacted]`, small), pin the order.
      {
        const hostile = ('Authorization: Bearer ' + sec + ' ').repeat(Math.ceil(1_000_000 / 40)).slice(0, 1_000_000);
        let best = Infinity;
        let last: any;
        for (let i = 0; i < 3; i++) { last = await state([{ command: hostile, args: ['a'] }]); best = Math.min(best, last.ms); }
        console.log(`mcp read tools: 12l (c0) 1 MB hostile command, best of 3: ${best.toFixed(1)} ms`);
        assert.strictEqual(last.data.copilotCli.servers[0].command, R, '12l(c0): the 1 MB command is [redacted]');
        assert.ok(last.raw.length < 5000 && !last.raw.includes(sec), '12l(c0): small answer, no secret');
        assert.ok(best < 30, `12l(c0): the over-limit command cost ${best.toFixed(1)} ms (is the scheme pre-pass before the length check?)`);
      }

      // (c) cost: a 1 MB CLI file built at run time, three shapes, each answered quickly and with no secret
      {
        const MB = 1_000_000;
        const units = ['-c ', '"a ', ', a=', '{"a":"x y ', "a 'b", 'Cookie: ', 'x '];
        const rep = (u: string, n: number): string => u.repeat(Math.ceil(n / u.length)).slice(0, n);
        const cases: Array<[string, Array<Partial<McpAmbientView>>]> = [
          ['(i) one 1 MB arg', [{ command: 'node', args: ['--token ' + sec + ' ' + rep('"a ', MB)] }]],
          ['(ii) 250 args of 4000', [{ command: 'node', args: Array.from({ length: 250 }, (_, i) => (i === 0 ? `--password=${sec} ` : `--token ${sec} `) + 'y'.repeat(3950)) }]],
        ];
        for (const u of units) cases.push([`(iii) 14b/14c shape ${JSON.stringify(u)}: 120 args just under the string limit and one 1 MB command`, [{ command: 'node ' + sec + ' ' + rep(u, MB), args: [`--token ${sec}`, ...Array.from({ length: 120 }, () => rep(u, MASK_INPUT_MAX - 40))] }]]);
        cases.push(['(iv) 1 MB of single-character args (500k args)', [{ command: 'node', args: Array.from({ length: 500_000 }, () => 'a') }]]);
        cases.push(['(v) 250k args "a" in one CLI entry', [{ command: 'node', args: Array.from({ length: 250_000 }, () => 'a') }]]);
        cases.push(['(vi) 25k CLI entries with command "n"', Array.from({ length: 25_000 }, () => ({ command: 'n' }))]);
        for (const [label, entries] of cases) {
          const r = await state(entries);
          console.log(`mcp read tools: 12l ${label}: ${r.ms.toFixed(1)} ms`);
          assert.ok(r.ms < 2000, `12l(c): ${label} took ${r.ms.toFixed(1)} ms`);
          assert.ok(!r.raw.includes(sec), `12l(c): ${label}: no planted secret`);
          if (label.startsWith('(vi)')) assert.ok(r.data.copilotCli.servers.length <= 400, `12l(c): (vi) lists ${r.data.copilotCli.servers.length} of 25000 entries; a command costs about 0.4 ms, so about 260 is the aim`);
        }
      }

      // (c, extras) 50 folders x 100 servers x 64 tiny args (the largest the file and folder limits allow in spirit)
      {
        const sv = (n: number): McpServerView => ({ name: `s${n}`, transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'n', args: Array.from({ length: 64 }, () => 'a') } as any);
        const servers = Array.from({ length: 100 }, (_, n) => sv(n));
        const h = createReadToolHandlers(mk(1, 50, { mcpExtras: () => servers }).deps);
        const t0 = process.hrtime.bigint();
        const res = await h.durbar_mcp_state({});
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const r = { data: JSON.parse((res.content[0] as { text: string }).text) };
        console.log(`mcp read tools: 12l (vii) extras 50 folders x 100 servers x 64 tiny args: ${ms.toFixed(1)} ms`);
        assert.ok(ms < 2000, `12l(c): extras took ${ms.toFixed(1)} ms`);
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(c): the budget note is there');
      }

      // (d) 200 typical servers (command, 4 args of about 40 characters, env keys) over the CLI and the extras come back whole, with no note
      {
        const arg = (n: number, j: number): string => `--option-${j}=/some/value/for/server/number-${n}`.padEnd(40, 'v');
        const typical = (n: number) => ({ name: `srv${n}`, command: `/usr/local/bin/mcp-server-${n}`, args: [0, 1, 2, 3].map((j) => arg(n, j)) });
        const cliList = Array.from({ length: 100 }, (_, n) => typical(n));
        const extraList = (k: number): McpServerView[] => Array.from({ length: 10 }, (_, n) => ({ ...typical(1000 + k * 10 + n), transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, env: [{ key: 'API_KEY', set: true }, { key: 'REGION', set: true }], headers: [] }) as any);
        const mkFolders: string[] = [];
        const h = createReadToolHandlers(mk(1, 10, { folders: () => { if (!mkFolders.length) for (let i = 0; i < 10; i++) mkFolders.push(`/work/folder-${i}`); return mkFolders.map((w) => ({ workspace: w, permMode: 'read-only', hidden: false }) as SavedFolder); }, mcpExtras: (k) => extraList(Math.max(0, mkFolders.indexOf(k))), mcpCli: () => ({ cli: cliList.map((e) => ({ ...e, origin: 'copilot-config', transport: 'stdio', enabled: true }) as McpAmbientView), file: { label: 'f', found: true, skipped: 0 }, secretsPersist: false }) }).deps);
        const t0 = process.hrtime.bigint();
        const res = await h.durbar_mcp_state({}); // called directly: the answer is far bigger than the session's frame limit
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const r = { raw: (res.content[0] as { text: string }).text, data: JSON.parse((res.content[0] as { text: string }).text) };
        const nExtra = (r.data.extras as Array<{ servers: unknown[] }>).reduce((n, e) => n + e.servers.length, 0);
        console.log(`mcp read tools: 12l (viii) 200 typical servers: ${ms.toFixed(1)} ms, ${r.raw.length} bytes`);
        assert.ok(ms < 2000, `12l(d): 200 typical servers took ${ms.toFixed(1)} ms`);
        assert.ok(!('masking' in r.data), '12l(d): 200 typical servers fit with no note');
        assert.strictEqual(r.data.copilotCli.servers.length + nExtra, 200, '12l(d): every server is listed');
        assert.ok(!r.raw.includes(R), '12l(d): nothing is hidden');
      }

      // (c, keys) 10 folders x 100 servers x 128 env key names: key names are charged too (without it this took about 7.5 s)
      {
        const keys = Array.from({ length: 128 }, (_, i) => ({ key: `ENV_KEY_NUMBER_${i}`, set: true }));
        const servers = Array.from({ length: 100 }, (_, n) => ({ name: `s${n}`, transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'n', env: keys, headers: [] }) as any as McpServerView);
        const h = createReadToolHandlers(mk(1, 10, { mcpExtras: () => servers }).deps);
        const t0 = process.hrtime.bigint();
        const res = await h.durbar_mcp_state({});
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const data = JSON.parse((res.content[0] as { text: string }).text);
        const shown = (data.extras as Array<{ servers: Array<{ envKeys: unknown[] }> }>).reduce((n, e) => n + e.servers.reduce((m, v) => m + v.envKeys.length, 0), 0);
        console.log(`mcp read tools: 12l (ix) 10 folders x 100 servers x 128 env key names: ${ms.toFixed(1)} ms, ${shown} key names shown`);
        assert.ok(ms < 2000, `12l(c): key names took ${ms.toFixed(1)} ms`);
        // each key costs MASK_PER_KEY (100) of the 90 000 units, minus what the servers themselves cost: about 880 are shown
        assert.ok(shown >= 800 && shown <= 900, `12l(c): key names are charged to the budget (${shown} shown of 128000, expected 800-900)`);
        assert.strictEqual(data.masking, MASK_BUDGET_NOTE, '12l(c): the note is there when key names were left out');
      }

      // (b, units) many small args fit under MASK_CHARS but not under the unit budget (the fixed cost per arg)
      {
        const n = 20_000; // 20 000 characters, under MASK_CHARS
        assert.ok(n < MASK_CHARS, '12l(b): the characters alone would admit every arg');
        const r = await state([{ command: 'node', args: Array.from({ length: n }, () => 'a') }]);
        const a = r.data.copilotCli.servers[0].args as string[];
        assert.strictEqual(a[a.length - 1], R, '12l(b): the units run out before the characters (a fixed cost per arg)');
        assert.ok(a.length < n, `12l(b): ${a.length} of ${n} args listed`);
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is there');
      }

      // (b, note) the budget is spent exactly by the last server that has anything: folders with no extras after it give no note
      {
        const big = (): McpServerView => ({ name: 'big', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'c'.repeat(12000), args: ['x'.repeat(12000)] } as any);
        const small = await mk(1, 14, { mcpCli: () => ({ cli: [], file: { label: 'f', found: true, skipped: 0 }, secretsPersist: false }), mcpExtras: (k) => (k.endsWith('-f0') || k.endsWith('-f1') ? [big()] : []) }).call('durbar_mcp_state');
        assert.ok(!('masking' in small.data), '12l(b): a spent budget with nothing left to hide gives no note');
      }

      // (b, keys) the budget runs out inside ONE key list: the note is the only sign that names were dropped
      {
        const keys = Array.from({ length: 2000 }, (_, i) => ({ key: `K_${i}`, set: true }));
        const srv = { name: 's', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, env: keys, headers: [] } as any as McpServerView;
        const r = await direct(mk(1, 1, { mcpExtras: () => [srv], mcpCli: () => ({ cli: [], file: { label: 'f', found: true, skipped: 0 }, secretsPersist: false }) }).deps);
        const shown = r.data.extras[0].servers[0].envKeys.length as number;
        assert.ok(shown > 800 && shown < 1000, `12l(b): ${shown} of 2000 key names listed`);
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is there when the key list was cut');
      }

      // (b, keys, characters) long key names: the characters of key names count against MASK_CHARS too
      {
        const keys = Array.from({ length: 200 }, (_, i) => ({ key: `K${i}_`.padEnd(1000, 'k'), set: true }));
        const srv = { name: 's', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, env: keys, headers: [] } as any as McpServerView;
        const r = await direct(mk(1, 1, { mcpExtras: () => [srv], mcpCli: () => ({ cli: [], file: { label: 'f', found: true, skipped: 0 }, secretsPersist: false }) }).deps);
        const shown = r.data.extras[0].servers[0].envKeys.length as number;
        assert.ok(shown >= 45 && shown <= 50, `12l(b): ${shown} long key names listed (48 000 characters)`);
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is there');
      }

      // (b, folder) the budget is spent exactly by the last value (4 x 12 000 characters, nothing hidden); a later folder with extras is left out whole: the note is the only sign
      {
        const big = (): McpServerView => ({ name: 'big', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'c'.repeat(12000), args: ['x'.repeat(12000), 'y'.repeat(12000), 'z'.repeat(12000)] } as any);
        const tiny = (): McpServerView => ({ name: 'tiny', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'n' } as any);
        const r = await direct(mk(1, 3, { mcpCli: () => ({ cli: [], file: { label: 'f', found: true, skipped: 0 }, secretsPersist: false }), mcpExtras: (k) => (k.endsWith('-f0') ? [big()] : [tiny()]) }).deps);
        assert.strictEqual(r.data.extras.length, 1, '12l(b): the later folders with extras are left out');
        assert.ok(r.data.extras[0].servers[0].args.every((x: string) => x !== R), '12l(b): nothing was hidden inside the first folder');
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is the only sign');
      }

      // (b, cli) the same for the CLI list: the second entry is dropped, no value was hidden before it
      {
        const big: Partial<McpAmbientView> = { command: 'c'.repeat(12000), args: ['x'.repeat(12000), 'y'.repeat(12000), 'z'.repeat(12000)] };
        const r = await state([big, { command: 'n' }]);
        assert.strictEqual(r.data.copilotCli.servers.length, 1, '12l(b): the second CLI entry is dropped');
        assert.ok(r.data.copilotCli.servers[0].args.every((x: string) => x !== R), '12l(b): nothing was hidden before it');
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is the only sign');
      }

      // (e) output size: 200 folders x 100 servers with no command at all stay under about 256 kB
      {
        const bare = Array.from({ length: 100 }, (_, n) => ({ name: `s${n}`, transport: 'stdio', enabled: true, trusted: true, needsSecrets: false }) as any as McpServerView);
        const folders = Array.from({ length: 200 }, (_, i) => ({ workspace: `/work/f${i}`, permMode: 'read-only', hidden: false }) as SavedFolder);
        const h = createReadToolHandlers(mk(1, 1, { folders: () => folders, mcpExtras: () => bare }).deps);
        const res = await h.durbar_mcp_state({});
        const raw = (res.content[0] as { text: string }).text;
        const listed = (JSON.parse(raw).extras as Array<{ servers: unknown[] }>).reduce((n, e) => n + e.servers.length, 0);
        console.log(`mcp read tools: 12l (x) 200 folders x 100 bare servers: ${raw.length} bytes, ${listed} listed`);
        assert.ok(raw.length < 262144, `12l(e): the reply is ${raw.length} bytes`);
        assert.ok(listed <= MASK_MAX_ENTRIES, `12l(e): ${listed} entries listed`);
        assert.strictEqual(JSON.parse(raw).masking, MASK_BUDGET_NOTE, '12l(e): the note is there');
      }


      // (f) exactly MASK_MAX_ENTRIES entries are all shown in full with no note; one more is left out and the note says so
      {
        const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ command: `cmd${i}`, args: ['--flag', `v${i}`] }));
        const t = (n: number) => entries(n);
        const full = await direct(cli(t(MASK_MAX_ENTRIES)).deps);
        const fl = full.data.copilotCli.servers as Array<{ command?: string; args?: string[] }>;
        assert.strictEqual(fl.length, MASK_MAX_ENTRIES, '12l(f): exactly the cap: all listed');
        assert.strictEqual(fl[MASK_MAX_ENTRIES - 1].command, `cmd${MASK_MAX_ENTRIES - 1}`, '12l(f): the last allowed entry is shown in full');
        assert.deepStrictEqual(fl[MASK_MAX_ENTRIES - 1].args, ['--flag', `v${MASK_MAX_ENTRIES - 1}`], '12l(f): its args too');
        assert.ok(!('masking' in full.data), '12l(f): exactly the cap gives no note');
        const over = await direct(cli(t(MASK_MAX_ENTRIES + 1)).deps);
        const ol = over.data.copilotCli.servers as Array<{ command?: string }>;
        assert.strictEqual(ol.length, MASK_MAX_ENTRIES, '12l(f): one over the cap: the cap is listed');
        assert.strictEqual(ol[MASK_MAX_ENTRIES - 1].command, `cmd${MASK_MAX_ENTRIES - 1}`, '12l(f): the last listed entry is in full');
        assert.strictEqual(over.data.masking, MASK_BUDGET_NOTE, '12l(f): one over the cap: the note');
      }

      // (g) strings over S cost no characters: four of them first, and the values after them are still masked by the rules, with no note
      {
        const long = 'L'.repeat(MASK_INPUT_MAX + 1);
        const r = await state([{ command: 'node', args: [long, long, long, long, long, '--token', sec, 'plain-after'], url: 'https://h.test/ok' }]);
        const sv = r.data.copilotCli.servers[0];
        assert.deepStrictEqual(sv.args, [R, R, R, R, R, '--token', R, 'plain-after'], '12l(g): values after long strings are masked by the rules (the secret by its flag)');
        assert.strictEqual(sv.url, 'https://h.test/ok', '12l(g): the url after them is shown');
        assert.ok(!('masking' in r.data), '12l(g): no note');
      }

      // (b, shared) one budget for the CLI entries and every folder's extras: the last folders are left out, a fresh budget per folder would list all
      {
        const big = (k: string): McpServerView => ({ name: 'big', transport: 'stdio', enabled: true, trusted: true, needsSecrets: false, command: 'c'.repeat(12000), args: [k] } as any);
        const r = await mk(1, 14, { mcpExtras: (k) => [big(k)] }).call('durbar_mcp_state');
        const ex = r.data.extras as Array<{ servers: Array<{ command: string; args: string[] }> }>;
        assert.ok(ex.length >= 3 && ex.length < 14, `12l(b): later folders are left out by the shared budget (a fresh budget per folder would list all 14): ${ex.length}`);
        assert.ok(ex.every((e) => e.servers[0].command !== R) && ex.slice(0, 2).every((e) => e.servers[0].args[0] !== R), '12l(b): the first folders are masked by the rules, not hidden');
        assert.strictEqual(r.data.masking, MASK_BUDGET_NOTE, '12l(b): the note is there');
      }
    }

    // 12j. a handler is wired for every read tool (a missing one fails at build time, not at the first call)
    {
      const h = createReadToolHandlers(mk(1, 1).deps);
      assert.deepStrictEqual(Object.keys(h).sort(), READ_TOOLS.map((t) => t.name).sort());
    }
  }


  console.log('mcp tools: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
