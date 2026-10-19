/**
 * Spec 041 T018: the MCP bridge. `BridgeCore` is driven on injected streams, against a real T017 `McpServerHost`
 * on a temp socket (a named pipe on Windows) and against a scripted "rogue" Durbar for what the real one never does.
 * No Electron, no real agents, no AI credits. Everything lives in temp folders that are removed at the end.
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createKeyFile, createServerHandshake, nodeMcpFs, readKeyFile } from '../src/main/mcp/auth';
import { AgentStateTracker } from '../src/main/mcp/agentstate';
import { BRIDGE_TEXT, BridgeCore } from '../src/main/mcp/bridgecore';
import type { BridgeDeps } from '../src/main/mcp/bridgecore';
import { BRIDGE_CRASH_TEXT, locate, netConnect, prepareBridge, realUserDataOf, runMcpBridge, startBridge } from '../src/main/mcp/bridge';
import type { BridgeApp, BridgeLocation, BridgePlatform } from '../src/main/mcp/bridge';
import { LineFramer } from '../src/main/mcp/jsonrpc';
import { mcpPaths } from '../src/main/mcp/paths';
import { LATEST_PROTOCOL_VERSION } from '../src/main/mcp/protocol';
import { createReadToolHandlers } from '../src/main/mcp/readtools';
import type { ReadToolsDeps } from '../src/main/mcp/readtools';
import { McpServerHost } from '../src/main/mcp/server';
import type { McpHostOptions } from '../src/main/mcp/server';
import { READ_TOOLS } from '../src/main/mcp/tools';
import { MCP_BRIDGE_FLAG, MCP_LIMITS } from '../src/shared/mcpserver';

const win = process.platform === 'win32';
const uid = win ? null : process.getuid!();
const plat: BridgePlatform = { platform: process.platform, uid, tmpdir: os.tmpdir() };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const timers = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
const roots: string[] = [];
const hosts: McpServerHost[] = [];
const servers: net.Server[] = [];
const root = path.join(__dirname, '..', '..');
const src = (f: string) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const deps: ReadToolsDeps = {
  folders: () => [],
  agents: () => [],
  tracker: new AgentStateTracker(),
  floors: () => ({ floors: [{ id: 'ground', name: 'Ground floor', on: true }, { id: 'f-aaaaaaaa', name: 'Attic', on: false }], lastFloor: 'ground' }),
  usage: { view: () => ({ version: 1, since: 0, folders: {} } as any), keyFor: (k) => k },
  settings: () => ({}),
  mcpCli: () => ({ cli: [], file: { label: 'x', found: false, skipped: 0 }, secretsPersist: false } as any),
  mcpExtras: () => [],
  windowSim: () => false,
};

function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'db-'));
  roots.push(d);
  return d;
}
function mkHost(userData: string, over: Partial<McpHostOptions> = {}): McpServerHost {
  const h = new McpServerHost({ userData, xdgRuntimeDir: undefined, version: '0.0.0-test', handlers: createReadToolHandlers(deps), ...over });
  hosts.push(h);
  return h;
}
const locOf = (ud: string): BridgeLocation => locate(ud, {}, { DURBAR_USER_DATA: ud }, plat);
const keyHexOf = (ud: string): string => {
  const r = locOf(ud).readKey();
  assert.ok(r.ok, 'key file readable');
  return (r as any).material.key.toString('hex');
};

/** The bridge under test, with captured stdout and its exit. */
interface Rig {
  core: BridgeCore;
  out: string[]; // raw stdout chunks
  exits: number[];
  lines(): any[];
  send(msg: object): void;
  raw(data: string | Buffer): void;
  reply(id: string | number, ms?: number): Promise<any>;
  call(id: number, name: string, args?: object): Promise<any>;
  init(): Promise<any>;
  readKeyCalls: number;
}
function rig(loc: BridgeLocation, over: Partial<BridgeDeps> = {}): Rig {
  const out: string[] = [];
  const exits: number[] = [];
  const r: Rig = {
    out, exits, readKeyCalls: 0,
    core: undefined as any,
    lines: () => out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    send: (m) => r.core.onStdin(JSON.stringify(m) + '\n'),
    raw: (d) => r.core.onStdin(d),
    reply: async (id, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const f = r.lines().find((x) => x.id === id);
        if (f) return f;
        await sleep(5);
      }
      throw new Error('no reply to ' + id);
    },
    call: (id, name, args = {}) => { r.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); return r.reply(id); },
    init: async () => {
      r.send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'test', version: '1' } } });
      const a = await r.reply('init');
      r.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return a;
    },
  };
  r.core = new BridgeCore({
    readKey: () => { r.readKeyCalls++; return loc.readKey(); },
    socketFor: loc.socketFor,
    connect: netConnect,
    stdout: (d) => { out.push(d); },
    exit: (c) => { exits.push(c); },
    marker: false,
    version: '0.0.0-test',
    timers,
    graceMs: 200,
    ...over,
  });
  return r;
}
const textOf = (reply: any): string => reply.result.content[0].text;
async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(10); }
  return cond();
}

/** A scripted Durbar: does the real server handshake with `key`, then lets `onLine` decide the replies. */
interface Rogue {
  sock: string;
  key: Buffer;
  seen: string[]; // every line received after the handshake
  conns: net.Socket[];
  loc: BridgeLocation;
}
function rogue(onLine: (line: string, write: (s: string) => void, sock: net.Socket) => void): Promise<Rogue> {
  const ud = mkRoot();
  const key = Buffer.from('ab'.repeat(32), 'hex');
  const p0 = mcpPaths({ platform: process.platform, userData: ud, xdgRuntimeDir: undefined, uid, tmpdir: os.tmpdir() });
  const mat = createKeyFile({ fs: nodeMcpFs(), mcpDir: p0.mcpDir as string, keyFile: p0.keyFile as string, uid, platform: process.platform, random: (n) => (n === 32 ? key : Buffer.alloc(n, 7)) });
  const sock = win ? `\\\\.\\pipe\\durbar-bridge-test-${mat.pipeId}` : path.join(ud, 'r.sock');
  const r: Rogue = { sock, key: mat.key, seen: [], conns: [], loc: { ...locOf(ud), socketFor: () => sock } };
  const srv = net.createServer((s) => {
    r.conns.push(s);
    s.on('error', () => undefined);
    const rx = new LineFramer(8 * 1024 * 1024);
    let authed = false;
    const hs = createServerHandshake({ key: mat.key, send: (m) => { s.write(m + '\n'); }, timers, onDone: (x) => { if (x.ok) authed = true; else s.destroy(); } });
    hs.start();
    s.on('data', (c) => {
      for (const ev of rx.push(c)) {
        if (ev.type !== 'line') continue;
        if (!authed) { hs.receive(ev.line); continue; }
        r.seen.push(ev.line);
        onLine(ev.line, (x) => { s.write(x); }, s);
      }
    });
  });
  servers.push(srv);
  return new Promise((resolve) => srv.listen(sock, () => resolve(r)));
}
/** Answers `initialize`, then each request by echoing the length of its line. */
const echoer = (extra?: (m: any, line: string, write: (s: string) => void, sock: net.Socket) => boolean) => (line: string, write: (s: string) => void, sock: net.Socket) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (extra && extra(m, line, write, sock)) return;
  if (m.method === 'initialize') return write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'rogue', version: '0' } } }) + '\n');
  write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { len: Buffer.byteLength(line), method: m.method } }) + '\n');
};

(async () => {
  // 1. No key file (the server is off): initialize and tools/list work, every call says "off". Nothing is created.
  {
    const ud = mkRoot();
    const r = rig(locOf(ud));
    const init = await r.init();
    assert.strictEqual(init.result.serverInfo.name, 'agent-durbar');
    assert.strictEqual(init.result.protocolVersion, LATEST_PROTOCOL_VERSION);
    r.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tl = await r.reply(1);
    assert.deepStrictEqual(tl.result.tools.map((t: any) => t.name), READ_TOOLS.map((t) => t.name), 'the static list of the read tools');
    const c = await r.call(2, 'durbar_list_floors');
    assert.strictEqual(c.result.isError, true);
    assert.strictEqual(textOf(c), BRIDGE_TEXT.off);
    assert.ok(/MCP server is off/.test(textOf(c)) && /Settings > MCP server/.test(textOf(c)));
    r.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.deepStrictEqual((await r.reply(3)).result, {});
    r.send({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    assert.strictEqual((await r.reply(4)).error.code, -32601);
    assert.deepStrictEqual(fs.readdirSync(ud), [], 'the bridge created nothing in the data folder');
  }

  // 2. Before `initialize`, a call is refused like the server does, and the bridge does not even look for Durbar.
  {
    const ud = mkRoot();
    const r = rig(locOf(ud));
    const c = await (async () => { r.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'durbar_list_floors' } }); return r.reply(1); })();
    assert.strictEqual(c.error.code, -32002);
    assert.strictEqual(r.readKeyCalls, 0, 'no key read before initialize');
  }

  // 3. A key file but nobody listening: "Durbar is not running"; Durbar is never started (no socket appears).
  {
    const ud = mkRoot();
    const p = mcpPaths({ platform: process.platform, userData: ud, xdgRuntimeDir: undefined, uid, tmpdir: os.tmpdir() });
    createKeyFile({ fs: nodeMcpFs(), mcpDir: p.mcpDir as string, keyFile: p.keyFile as string, uid, platform: process.platform });
    const r = rig(locOf(ud));
    await r.init();
    const c = await r.call(1, 'durbar_list_floors');
    assert.strictEqual(c.result.isError, true);
    assert.strictEqual(textOf(c), BRIDGE_TEXT.notRunning);
    assert.ok(/Durbar is not running/.test(textOf(c)));
    const sock = locOf(ud).socketFor((readKeyFile({ fs: nodeMcpFs(), mcpDir: p.mcpDir as string, keyFile: p.keyFile as string, uid, platform: process.platform }) as any).material.pipeId) as string;
    if (!win) assert.ok(!fs.existsSync(sock), 'the bridge did not start a server');
    // an unsafe key file (group-readable) is reported as unusable, not as "not running"
    if (!win) {
      fs.chmodSync(p.keyFile as string, 0o644);
      const c2 = await r.call(2, 'durbar_list_floors');
      assert.strictEqual(textOf(c2), BRIDGE_TEXT.keyUnusable);
    }
    fs.writeFileSync(p.keyFile as string, '{"nope"', { mode: 0o600 });
    const c3 = await r.call(3, 'durbar_list_floors');
    assert.strictEqual(textOf(c3), BRIDGE_TEXT.keyUnusable, 'a damaged key file');
  }

  // 4. Against the real host: the relay works, ids are kept, and the call after Durbar starts needs no restart of the client.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    const r = rig(locOf(ud));
    await r.init();
    assert.strictEqual(textOf(await r.call(1, 'durbar_list_floors')), BRIDGE_TEXT.off, 'off before Durbar serves');
    assert.strictEqual((await h.start()).status, 'listening');
    const c = await r.call(2, 'durbar_list_floors');
    assert.ok(!c.result.isError, JSON.stringify(c));
    assert.ok(/Attic/.test(textOf(c)), 'a real answer from Durbar');
    assert.ok(r.core.connected);
    r.send({ jsonrpc: '2.0', id: 'str-id', method: 'tools/list' });
    const tl = await r.reply('str-id');
    assert.strictEqual(tl.result.tools.length, READ_TOOLS.length, 'tools/list comes from Durbar when it runs');
    assert.strictEqual(h.state().connections, 1);
    // an error from Durbar passes through untouched
    r.send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } });
    assert.strictEqual((await r.reply(9)).error.code, -32602);
    // Durbar goes away: the next call says so (key file deleted when the server is turned off), then it comes back
    await h.stop();
    assert.ok(await until(() => !r.core.connected), 'the bridge notices the closed link');
    assert.strictEqual(textOf(await r.call(3, 'durbar_list_floors')), BRIDGE_TEXT.off);
    assert.strictEqual((await h.start()).status, 'listening');
    const again = await r.call(4, 'durbar_list_floors');
    assert.ok(/Attic/.test(textOf(again)), 'reconnects on the next call, with the client handshake replayed');
    assert.strictEqual(h.state().connections, 1);
    await h.stop();
  }

  // 5. A wrong key: no tools, a clear text, and the key (right or wrong) is nowhere in the output.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const real = locOf(ud);
    const k = real.readKey() as any;
    const wrong = Buffer.from(k.material.key);
    wrong[0] ^= 0xff;
    const r = rig({ ...real, readKey: () => ({ ok: true, material: { key: wrong, pipeId: k.material.pipeId } }) }, { handshakeTimeoutMs: 500 });
    await r.init();
    const c = await r.call(1, 'durbar_list_floors');
    assert.strictEqual(c.result.isError, true);
    assert.strictEqual(textOf(c), BRIDGE_TEXT.authFailed);
    assert.strictEqual(h.state().connections, 0, 'the server never accepted it');
    const everything = r.out.join('');
    assert.ok(!everything.includes(wrong.toString('hex')) && !everything.includes(k.material.key.toString('hex')), 'no key in stdout');
    await h.stop();
  }

  // 6. A bridge that reports it runs inside an agent never connects (FR-034), but still answers initialize.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const r = rig(locOf(ud), { marker: true });
    const init = await r.init();
    assert.ok(init.result.serverInfo, 'initialize still works');
    const c = await r.call(1, 'durbar_list_floors');
    assert.strictEqual(c.result.isError, true);
    assert.strictEqual(textOf(c), BRIDGE_TEXT.agent);
    r.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok((await r.reply(2)).result.tools.length > 0);
    assert.strictEqual(r.readKeyCalls, 0, 'the key file is not even read');
    assert.strictEqual(h.state().connections, 0, 'and nothing connected');
    await h.stop();
  }

  // 7. stdin closes: the bridge exits (once), with nothing owed at once, or after the answer that is owed.
  {
    const ud = mkRoot();
    const r = rig(locOf(ud));
    await r.init();
    r.core.onStdinEnd();
    assert.ok(await until(() => r.exits.length === 1), 'exit on stdin end');
    assert.deepStrictEqual(r.exits, [0]);
    r.core.onStdinEnd();
    r.raw(JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'ping' }) + '\n');
    await sleep(50);
    assert.strictEqual(r.exits.length, 1, 'exit once');
    assert.ok(!r.lines().some((l) => l.id === 77), 'input after the end is ignored');
  }
  {
    // an answer is still owed: wait for it, then go
    const slow = await rogue(echoer((m, _l, write) => {
      if (m.method !== 'tools/call') return false;
      setTimeout(() => write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'late' }] } }) + '\n'), 60);
      return true;
    }));
    const r = rig(slow.loc);
    await r.init();
    r.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } });
    await sleep(20);
    r.core.onStdinEnd();
    assert.strictEqual(r.exits.length, 0, 'not yet: one answer is owed');
    assert.ok(await until(() => r.exits.length === 1), 'then it exits');
    assert.strictEqual(textOf(await r.reply(1)), 'late', 'the owed answer was delivered first');
  }
  {
    // the answer never comes: the grace time ends it
    const dead = await rogue(echoer((m) => m.method === 'tools/call'));
    const r = rig(dead.loc, { graceMs: 80 });
    await r.init();
    r.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } });
    await sleep(20);
    r.core.onStdinEnd();
    assert.strictEqual(r.exits.length, 0);
    assert.ok(await until(() => r.exits.length === 1, 1000), 'exits after the grace time');
  }

  // 8. Malformed input: each bad line gets its own error, nothing reaches Durbar, and the next good message works.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const r = rig(locOf(ud));
    await r.init();
    assert.ok(/Attic/.test(textOf(await r.call(1, 'durbar_list_floors'))));
    const before = r.lines().length;
    r.raw('this is not json\n');
    r.raw('[1,2]\n');
    r.raw('{"jsonrpc":"1.0","id":5,"method":"ping"}\n');
    r.raw('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}\n');
    r.raw('{"jsonrpc":"2.0","id":6}\n');
    r.raw('\n\n');
    r.raw('{"jsonrpc":"2.0","id":7,"result":{}}\n'); // a client reply: ignored
    r.raw('\xff\xfe{\n'); // not UTF-8 JSON
    await sleep(100);
    const got = r.lines().slice(before);
    assert.strictEqual(got.length, 6, 'one error per bad request, none for the ignored reply: ' + JSON.stringify(got));
    assert.deepStrictEqual(got.map((g) => g.error.code), [-32700, -32600, -32600, -32600, -32600, -32700]);
    assert.ok(await r.call(2, 'durbar_list_floors'), 'still works');
    // a chunk split in the middle of a multibyte character and of a line
    const msg = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'durbar_list_floors', arguments: {} } }) + '\n';
    for (const b of Buffer.from(msg)) r.raw(Buffer.from([b]));
    assert.ok(/Attic/.test(textOf(await r.reply(3))), 'byte-by-byte input');
    // two messages in one chunk, answered in order
    r.raw(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' }) + '\n');
    await r.reply(11);
    const ids = r.lines().map((l) => l.id).filter((i) => i === 10 || i === 11);
    assert.deepStrictEqual(ids, [10, 11]);
    await h.stop();
  }

  // 9. Large messages: just under 64 KB goes through whole; over it is refused locally, the stream stays in step.
  {
    const rg = await rogue(echoer());
    const r = rig(rg.loc);
    await r.init();
    const mk = (id: number, n: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'x', pad: 'a'.repeat(n) } });
    const base = Buffer.byteLength(mk(1, 0));
    const okLine = mk(1, MCP_LIMITS.maxMessageBytes - base);
    assert.strictEqual(Buffer.byteLength(okLine), MCP_LIMITS.maxMessageBytes);
    r.raw(okLine + '\n');
    const ok = await r.reply(1);
    assert.strictEqual(ok.result.len, MCP_LIMITS.maxMessageBytes, 'a 64 KB message arrives whole');
    const bigLine = mk(2, MCP_LIMITS.maxMessageBytes + 10);
    r.raw(bigLine.slice(0, 30000));
    r.raw(bigLine.slice(30000) + '\n');
    await until(() => r.lines().some((l) => l.error && l.error.code === -32600));
    const err = r.lines().find((l) => l.error && l.error.code === -32600);
    assert.ok(/too large/i.test(err.error.message));
    assert.strictEqual(err.id, null);
    assert.ok(!rg.seen.some((l) => l.includes('"id":2')), 'the big message was not forwarded');
    r.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x' } });
    assert.ok((await r.reply(3)).result, 'the next message is fine');
  }
  {
    // a long reply from Durbar (3 MB) crosses many chunks and arrives whole
    const big = 'z'.repeat(3 * 1024 * 1024);
    const rg = await rogue(echoer((m, _l, write) => {
      if (m.method !== 'tools/call') return false;
      write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: big }] } }) + '\n');
      return true;
    }));
    const r = rig(rg.loc);
    await r.init();
    r.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } });
    const a = await r.reply(1, 10000);
    assert.strictEqual(textOf(a).length, big.length);
  }

  // 10. Nothing but JSON-RPC reaches stdout, even when Durbar sends junk; the key never does.
  {
    const rg = await rogue(echoer((m, _l, write) => {
      if (m.method !== 'tools/call') return false;
      write('Durbar debug: starting up\n');
      write('{"not":"jsonrpc"}\n');
      write('[1,2,3]\n');
      write('{"jsonrpc":"2.0","id":');
      write('\n');
      write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'fine' }] } }) + '\n');
      return true;
    }));
    const r = rig(rg.loc);
    await r.init();
    r.raw('garbage in\n');
    r.raw('{"jsonrpc":"2.0","id":3,"method":"nope"}\n');
    assert.strictEqual(textOf(await r.call(1, 'x')), 'fine');
    await sleep(50);
    const all = r.out.join('');
    for (const l of all.split('\n').filter(Boolean)) {
      const o = JSON.parse(l); // every line is JSON...
      assert.strictEqual(o.jsonrpc, '2.0', 'with the JSON-RPC marker: ' + l); // ...and JSON-RPC
    }
    assert.ok(!all.includes('Durbar debug') && !all.includes('"not"'), 'junk from Durbar stays out');
    assert.ok(all.endsWith('\n') && !all.includes('\n\n'), 'whole lines only');
    assert.ok(!all.includes(rg.key.toString('hex')), 'the key is not in stdout');
    // and it is not in what the offline answers say either (real host, real key)
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const r2 = rig(locOf(ud));
    await r2.init();
    await r2.call(1, 'durbar_list_floors');
    const realKey = keyHexOf(ud);
    await h.stop();
    assert.ok(!r2.out.join('').includes(realKey), 'the real key is not in stdout either');
  }
  // The source cannot print: no console or direct process stream use in the core, and one stdout in the glue.
  {
    const core = src('main/mcp/bridgecore.ts');
    assert.ok(!/console\.|process\.std|process\.env|process\.argv/.test(core), 'bridgecore.ts neither logs nor touches process streams');
    const glue = src('main/mcp/bridge.ts');
    assert.strictEqual((glue.match(/process\.stdout/g) ?? []).length, 1, 'bridge.ts writes to stdout in one place');
    assert.ok(/console\.log = \(\.\.\.a: unknown\[\]\) => console\.error/.test(glue), 'console.log is sent to stderr');
    assert.ok(!/process\.stdout\.write|console\.log\(/.test(glue.replace(/console\.log = [^\n]*/g, '')), 'no direct stdout write or log call');
  }

  // 11. Durbar drops the link while a call is in flight: the client gets an answer, and the next call reconnects.
  {
    let drop = true;
    const rg = await rogue(echoer((m, _l, _w, s) => {
      if (m.method === 'tools/call' && drop) { drop = false; s.destroy(); return true; }
      return false;
    }));
    const r = rig(rg.loc);
    await r.init();
    const a = await r.call(1, 'x');
    assert.strictEqual(a.result.isError, true);
    assert.strictEqual(textOf(a), BRIDGE_TEXT.lost);
    r.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    r.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const b = await r.reply(3);
    assert.ok(b.result.len !== undefined, 'a new connection, with the replayed handshake: ' + JSON.stringify(b));
    assert.strictEqual(rg.conns.length, 2);
    const replay = rg.seen.filter((l) => JSON.parse(l).method === 'initialize');
    assert.strictEqual(replay.length, 2, 'initialize replayed on the second connection');
    assert.ok(rg.seen.some((l) => JSON.parse(l).method === 'notifications/initialized'));
    assert.strictEqual(JSON.parse(replay[1]).params.clientInfo.name, 'test', 'with the client\'s own parameters');
  }

  // 12. The bridge sends the client's notifications on, but never connects just for one.
  {
    const rg = await rogue(echoer());
    const r = rig(rg.loc);
    r.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION } });
    await r.reply(1);
    r.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    r.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } });
    await sleep(60);
    assert.strictEqual(rg.conns.length, 0, 'no connection for notifications');
    assert.strictEqual(r.readKeyCalls, 0);
    r.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await r.reply(2);
    r.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } });
    await until(() => rg.seen.some((l) => l.includes('notifications/cancelled')));
    assert.ok(rg.seen.some((l) => l.includes('notifications/cancelled')), 'forwarded once connected');
  }

  // 13. Start-up order: the key file path comes from the REAL userData, then userData is redirected (and the GPU turned off).
  {
    const realUd = mkRoot();
    const calls: string[] = [];
    let current = realUd;
    const app: BridgeApp = {
      isPackaged: false, once: () => undefined,
      getPath: (n) => { calls.push('getPath:' + n); return current; },
      setPath: (n, v) => { calls.push('setPath:' + n); current = v; },
      getVersion: () => '1',
      disableHardwareAcceleration: () => { calls.push('disableGpu'); },
      whenReady: () => { calls.push('whenReady'); return new Promise<void>((res) => res()); },
      exit: () => undefined,
      dock: { hide: () => { calls.push('dockHide'); } },
    };
    const redirected = mkRoot();
    const { loc, bridgeDir } = prepareBridge(app, {}, {}, plat, () => redirected);
    assert.deepStrictEqual(calls.slice(0, 3), ['getPath:userData', 'setPath:userData', 'disableGpu'], 'order: read the real folder, redirect, GPU off');
    assert.strictEqual(bridgeDir, redirected);
    assert.notStrictEqual(current, realUd, 'userData was redirected');
    const expectKey = mcpPaths({ platform: process.platform, userData: realUd, xdgRuntimeDir: undefined, uid, tmpdir: os.tmpdir() }).keyFile;
    assert.strictEqual(loc.keyFile, expectKey, 'the key file path is in the real folder');
    assert.ok(!(loc.keyFile as string).startsWith(redirected), 'not in the redirected one');
    await sleep(10);
    assert.ok(calls.includes('dockHide'), 'Dock hidden once ready');
    // and a key file written in the real folder is the one that is read, after the redirect
    const p = mcpPaths({ platform: process.platform, userData: realUd, xdgRuntimeDir: undefined, uid, tmpdir: os.tmpdir() });
    createKeyFile({ fs: nodeMcpFs(), mcpDir: p.mcpDir as string, keyFile: p.keyFile as string, uid, platform: process.platform });
    assert.ok(loc.readKey().ok, 'reads the key file of the real folder');
    // the dev hook wins over Electron's path; a packaged build ignores it without DURBAR_DEV (devEnv gives {})
    assert.strictEqual(realUserDataOf({ getPath: () => '/real' }, { DURBAR_USER_DATA: '/hook' }), '/hook');
    assert.strictEqual(realUserDataOf({ getPath: () => '/real' }, {}), '/real');
    const hooked = mkRoot();
    const viaHook = prepareBridge({ ...app, getPath: () => '/should/not/be/used', setPath: () => undefined }, {}, { DURBAR_USER_DATA: hooked }, plat, () => redirected);
    assert.strictEqual(viaHook.loc.keyFile, mcpPaths({ platform: process.platform, userData: hooked, xdgRuntimeDir: undefined, uid, tmpdir: os.tmpdir() }).keyFile, 'DURBAR_USER_DATA is the real folder');
  }
  // The same order, and the entry, in the source (a unit cannot see which file runs first).
  {
    const b = src('main/mcp/bridge.ts');
    const prep = b.slice(b.indexOf('export function prepareBridge'));
    const iLoc = prep.indexOf('locate(realUserDataOf(');
    const iSet = prep.indexOf("app.setPath('userData'");
    const iGpu = prep.indexOf('app.disableHardwareAcceleration()');
    assert.ok(iLoc > 0 && iLoc < iSet && iSet < iGpu, 'prepareBridge: locate, then setPath, then GPU off');
    const e = src('main/entry.ts');
    const iFlag = e.indexOf('process.argv.includes(MCP_BRIDGE_FLAG)');
    const iMain = e.indexOf("require('./main')");
    assert.ok(iFlag > 0 && iFlag < iMain, 'entry.ts checks the flag before it loads main.ts');
    assert.ok(MCP_BRIDGE_FLAG === '--durbar-mcp-bridge');
    const imports = e.split('\n').filter((l) => /^import /.test(l));
    assert.deepStrictEqual(imports, ["import { app } from 'electron';", "import { MCP_BRIDGE_FLAG } from '../shared/mcpserver';"], 'nothing else is loaded before the check');
    assert.ok(!/from '\.\/main'|import '\.\/main'/.test(e), 'main.ts is not imported statically');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.main, 'dist/main/entry.js', 'the app starts at the entry');
    const m = src('main/main.ts');
    assert.ok(!/mcp\/bridge/.test(m), 'main.ts does not load the bridge');
  }

  // 14. The glue over fake streams: data in, lines out, exit after the end (the last write flushed), EPIPE exits.
  {
    const ud = mkRoot();
    const stdin = new EventEmitter();
    const stdout = Object.assign(new EventEmitter(), { chunks: [] as string[], write(d: string, cb?: () => void) { if (d) this.chunks.push(d); if (cb) setImmediate(cb); return true; } });
    const exits: number[] = [];
    const l = locOf(ud);
    startBridge({ readKey: l.readKey, socketFor: l.socketFor, connect: netConnect, marker: false, version: '1', timers }, { stdin: stdin as any, stdout: stdout as any }, (c) => exits.push(c));
    stdin.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION } }) + '\n'));
    await until(() => stdout.chunks.length > 0);
    assert.strictEqual(JSON.parse(stdout.chunks.join('')).id, 1);
    stdin.emit('end');
    stdin.emit('close');
    assert.ok(await until(() => exits.length === 1), 'exit after stdin end');
    assert.deepStrictEqual(exits, [0]);

    const stdin2 = new EventEmitter();
    const stdout2 = Object.assign(new EventEmitter(), { write: () => true });
    const exits2: number[] = [];
    startBridge({ readKey: l.readKey, socketFor: l.socketFor, connect: netConnect, marker: false, version: '1', timers }, { stdin: stdin2 as any, stdout: stdout2 as any }, (c) => exits2.push(c));
    stdout2.emit('error');
    assert.deepStrictEqual(exits2, [0], 'a closed stdout ends the bridge');
  }

  // 15. Real sockets of the real host: three bridges at once, each with its own session; the cap of the host is its own business.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const rs = [rig(locOf(ud)), rig(locOf(ud))];
    for (const r of rs) await r.init();
    const [a, b] = await Promise.all(rs.map((r, i) => r.call(i + 1, 'durbar_list_floors')));
    assert.ok(/Attic/.test(textOf(a)) && /Attic/.test(textOf(b)));
    assert.strictEqual(h.state().connections, 2);
    for (const r of rs) r.core.onStdinEnd();
    assert.ok(await until(() => h.state().connections === 0), 'closing stdin closes the connection to Durbar');
    await h.stop();
  }

  // 16. Signals end the bridge like stdin end does (folder removed, then app.exit); an unexpected error exits 1 with a fixed line.
  {
    const quitCbs: Array<() => void> = [];
    const mkApp = (exits: number[]): BridgeApp => ({
      once: (_e, cb) => { quitCbs.push(cb); },
      isPackaged: false, getPath: () => mkRoot(), setPath: () => undefined, getVersion: () => '1', disableHardwareAcceleration: () => undefined,
      whenReady: () => new Promise<void>(() => undefined), exit: (c) => { exits.push(c ?? 0); },
    });
    const mkIo = () => ({ stdin: new EventEmitter() as any, stdout: Object.assign(new EventEmitter(), { write: () => true }) as any });
    const mkProc = () => Object.assign(new EventEmitter(), { stderr: { text: '', write(x: string) { this.text += x; } } }) as any;
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      const exits: number[] = [];
      const proc = mkProc();
      const dir = mkRoot();
      fs.writeFileSync(path.join(dir, 'Local State'), 'x');
      fs.mkdirSync(path.join(dir, 'GPUPersistentCache'));
      runMcpBridge(mkApp(exits), {}, proc, mkIo(), () => dir);
      assert.strictEqual(exits.length, 0);
      proc.emit(sig);
      assert.deepStrictEqual(exits, [0], sig + ' exits');
      assert.ok(!fs.existsSync(dir), sig + ' removes the bridge folder');
      proc.emit(sig);
      assert.strictEqual(exits.length, 1, 'once');
    }
    {
      // Electron quits on SIGTERM by itself: will-quit and process exit also remove the folder (and do not exit twice)
      for (const via of ['will-quit', 'exit']) {
        const exits: number[] = [];
        const proc = mkProc();
        const dir = mkRoot();
        fs.writeFileSync(path.join(dir, 'Local State'), 'x');
        quitCbs.length = 0;
        runMcpBridge(mkApp(exits), {}, proc, mkIo(), () => dir);
        if (via === 'will-quit') quitCbs.forEach((f) => f()); else proc.emit('exit');
        assert.ok(!fs.existsSync(dir), via + ' removes the bridge folder');
        assert.deepStrictEqual(exits, [], 'cleanup does not call exit');
      }
    }
    {
      const exits: number[] = [];
      const proc = mkProc();
      const dir = mkRoot();
      runMcpBridge(mkApp(exits), {}, proc, mkIo(), () => dir);
      proc.emit('uncaughtException', new Error('secret-looking ' + 'ab'.repeat(32)));
      assert.deepStrictEqual(exits, [1]);
      assert.ok(!fs.existsSync(dir));
      assert.strictEqual(proc.stderr.text, BRIDGE_CRASH_TEXT, 'one fixed line, the error text is not printed');
    }
    {
      // the folder cannot even be created: the guard is already in place and ends the process
      const exits: number[] = [];
      const proc = mkProc();
      assert.throws(() => runMcpBridge(mkApp(exits), {}, proc, mkIo(), () => { throw new Error('EACCES'); }));
      proc.emit('uncaughtException', new Error('EACCES'));
      assert.deepStrictEqual(exits, [1]);
      assert.strictEqual(proc.stderr.text, BRIDGE_CRASH_TEXT);
    }
  }

  // 17. The replayed initialize gets no answer, or an error: "not answering", not a key problem.
  for (const mode of ['silent', 'error', 'close']) {
    const rg = await rogue(echoer((m, _l, write, s) => {
      if (m.method !== 'initialize') return false;
      if (mode === 'error') write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'x' } }) + '\n');
      if (mode === 'close') s.destroy();
      return true;
    }));
    const r = rig(rg.loc, { initTimeoutMs: 100 });
    await r.init();
    const c = await r.call(1, 'x');
    assert.strictEqual(c.result.isError, true);
    assert.strictEqual(textOf(c), BRIDGE_TEXT.noAnswer, mode);
    assert.ok(/not answering/.test(textOf(c)) && textOf(c) !== BRIDGE_TEXT.authFailed);
  }

  console.log('mcp bridge OK');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    for (const s of servers) { try { s.close(); } catch { /* closed */ } }
    for (const h of hosts) { try { await h.stop(); } catch { /* stopped */ } }
    for (const d of roots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
    setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
  });
