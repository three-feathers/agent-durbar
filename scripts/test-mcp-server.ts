/**
 * Spec 041 T017: McpServerHost over a real temp socket (a named pipe on Windows) with a fake client.
 * No Electron, no real agents, no AI credits. Everything lives in a temp userData that is removed at the end.
 */
import * as assert from 'assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createBridgeHandshake, nodeMcpFs, readKeyFile } from '../src/main/mcp/auth';
import { LineFramer } from '../src/main/mcp/jsonrpc';
import { mcpPaths } from '../src/main/mcp/paths';
import { LATEST_PROTOCOL_VERSION } from '../src/main/mcp/protocol';
import { createReadToolHandlers } from '../src/main/mcp/readtools';
import type { ReadToolsDeps } from '../src/main/mcp/readtools';
import { McpServerHost } from '../src/main/mcp/server';
import type { McpHostOptions } from '../src/main/mcp/server';
import { AgentStateTracker } from '../src/main/mcp/agentstate';
import { MCP_LIMITS } from '../src/shared/mcpserver';
import { FakeMcpClient } from './fakes/mcp-client';

const win = process.platform === 'win32';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const roots: string[] = [];
const hosts: McpServerHost[] = [];
const socks: net.Socket[] = [];

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-'));
  roots.push(d);
  return d;
}
function mkHost(userData: string, over: Partial<McpHostOptions> = {}): McpServerHost {
  const h = new McpServerHost({ userData, xdgRuntimeDir: undefined, version: '0.0.0-test', handlers: createReadToolHandlers(deps), ...over });
  hosts.push(h);
  return h;
}
const pathsOf = (userData: string, pipeId?: string) => mcpPaths({ platform: process.platform, userData, xdgRuntimeDir: undefined, uid: win ? null : process.getuid!(), tmpdir: os.tmpdir(), pipeId });
const keyFileOf = (userData: string) => pathsOf(userData).keyFile as string;
const keyOf = (userData: string): Buffer => {
  const p = pathsOf(userData);
  const r = readKeyFile({ fs: nodeMcpFs(), mcpDir: p.mcpDir as string, keyFile: p.keyFile as string, uid: win ? null : process.getuid!(), platform: process.platform });
  assert.ok(r.ok, 'key file readable');
  return (r as any).material.key;
};

/** Raw connection with no handshake (an unauthenticated peer). */
function dialRaw(sock: string): Promise<net.Socket & { gone: boolean; goneAt: number }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock) as net.Socket & { gone: boolean; goneAt: number };
    s.gone = false;
    s.goneAt = 0;
    s.on('close', () => { s.gone = true; s.goneAt = Date.now(); });
    s.on('error', () => undefined);
    s.resume(); // read and drop whatever arrives, so the peer's close is seen
    s.once('connect', () => resolve(s));
    s.once('error', reject);
    socks.push(s);
  });
}

/** A bridge: connects, does the handshake with `key`, then talks through the fake client. */
async function dial(sock: string, key: Buffer): Promise<{ client: FakeMcpClient; s: net.Socket & { gone: boolean }; ok: Promise<boolean> }> {
  const s = await dialRaw(sock);
  const rx = new LineFramer();
  let client!: FakeMcpClient;
  let finished!: (v: boolean) => void;
  const ok = new Promise<boolean>((r) => (finished = r));
  client = new FakeMcpClient((chunk) => s.write(chunk));
  const hs = createBridgeHandshake({
    key,
    send: (m) => { s.write(m + '\n'); },
    timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) },
    onDone: (r) => finished(r.ok),
  });
  hs.start();
  s.on('close', () => finished(false));
  s.on('data', (chunk: Buffer) => {
    if (!hs.done) {
      for (const ev of rx.push(chunk)) if (ev.type === 'line') { if (!hs.done) hs.receive(ev.line); else client.onData(Buffer.from(ev.line + '\n')); }
    } else client.onData(chunk);
  });
  return { client, s, ok };
}

async function init(c: FakeMcpClient): Promise<any> {
  const r = await c.requestAsync('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, clientInfo: { name: 'test', version: '1' } });
  c.notify('notifications/initialized');
  return r;
}
async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(10); }
  return cond();
}
/** Waits for the reply with this id on a fake client; false when the socket closed or nothing came. */
async function replied(c: FakeMcpClient, id: number, ms = 1500): Promise<boolean> {
  return until(() => c.replies.some((r) => r.id === id), ms);
}
async function connects(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(sock);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

(async () => {
  // 1. Setting off: no socket, no key file, no folder (apply(false) only stops).
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    const st = await h.apply(false);
    assert.strictEqual(st.status, 'off');
    assert.deepStrictEqual(fs.readdirSync(ud), [], 'nothing was created while the setting is off');
    if (!win) assert.ok(!fs.existsSync(pathsOf(ud).socket as string), 'no socket file');
  }

  // 2. Demo/sample mode: never starts, creates nothing.
  {
    const ud = mkRoot();
    const h = mkHost(ud, { demo: () => true });
    const st = await h.apply(true);
    assert.strictEqual(st.status, 'demo');
    assert.ok(/demo/i.test(st.reason ?? ''));
    assert.deepStrictEqual(fs.readdirSync(ud), [], 'no key file and no socket in demo mode');
    assert.strictEqual(h.socket, null);
  }

  // 3. End to end: handshake, initialize, tools/list, tools/call durbar_list_floors; key file is private and never echoed.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    const st = await h.apply(true);
    assert.strictEqual(st.status, 'listening', JSON.stringify(st));
    assert.ok(h.socket);
    const kf = keyFileOf(ud);
    assert.ok(fs.existsSync(kf), 'key file exists while on');
    if (!win) {
      assert.strictEqual(fs.statSync(kf).mode & 0o777, 0o600, 'key file 0600');
      assert.strictEqual(fs.statSync(h.socket as string).mode & 0o077, 0, 'socket not open to others');
    }
    const key = keyOf(ud);
    const { client, ok } = await dial(h.socket as string, key);
    assert.ok(await ok, 'handshake ok');
    const r = await init(client);
    assert.strictEqual(r.result.serverInfo.name, 'agent-durbar');
    assert.strictEqual(r.result.serverInfo.version, '0.0.0-test');
    const l = await client.requestAsync('tools/list');
    assert.ok(l.result.tools.some((t: any) => t.name === 'durbar_list_floors'));
    assert.ok(!l.result.tools.some((t: any) => t.name === 'durbar_set_mode'), 'no change tools');
    const c = await client.requestAsync('tools/call', { name: 'durbar_list_floors', arguments: {} });
    assert.ok(!c.error && !c.result.isError, JSON.stringify(c).slice(0, 200));
    const data = JSON.parse(c.result.content[0].text);
    assert.ok(JSON.stringify(data).includes('Attic'), 'floors answered through the registry');
    assert.ok(!JSON.stringify(client.replies).includes(key.toString('hex')), 'the key never appears in a reply');
    assert.strictEqual(h.state().connections, 1);
    // starting again changes nothing
    assert.strictEqual((await h.apply(true)).status, 'listening');
    await h.stop();
  }

  // 4. A wrong key is refused and gets no reply at all; the server keeps serving.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const bad = await dial(h.socket as string, Buffer.alloc(32, 7));
    assert.strictEqual(await bad.ok, false);
    assert.ok(await until(() => bad.s.gone), 'closed after a bad proof');
    assert.strictEqual(bad.client.replies.length, 0);
    assert.strictEqual(h.state().connections, 0);
    const good = await dial(h.socket as string, keyOf(ud));
    assert.ok(await good.ok);
    await h.stop();
  }

  // 5. Handshake timeout of about 2 s (the default), and the idle peer does not count.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const t0 = Date.now();
    const idle = await dialRaw(h.socket as string);
    assert.ok(await until(() => idle.gone, 4000), 'an idle peer is closed');
    const dt = idle.goneAt - t0;
    assert.ok(dt >= MCP_LIMITS.handshakeTimeoutMs - 200 && dt <= MCP_LIMITS.handshakeTimeoutMs + 1000, `closed after about 2 s, took ${dt} ms`);
    assert.strictEqual(h.state().connections, 0);
    await h.stop();
  }

  // 6. Unauthenticated connections neither count nor block; at most 3 authenticated ones; a freed slot is reusable.
  {
    const ud = mkRoot();
    const h = mkHost(ud, { handshakeTimeoutMs: 60000 }); // idle peers stay open for the whole check
    await h.start();
    const sock = h.socket as string;
    const idle = [] as net.Socket[];
    for (let i = 0; i < 6; i++) idle.push(await dialRaw(sock)); // more than the cap, all unauthenticated
    const key = keyOf(ud);
    const real = [] as Awaited<ReturnType<typeof dial>>[];
    for (let i = 0; i < 3; i++) {
      const d = await dial(sock, key);
      assert.ok(await d.ok, `real connection ${i + 1} not blocked by idle peers`);
      const r = await init(d.client);
      assert.ok(r.result, 'initialize answered');
      real.push(d);
    }
    assert.strictEqual(h.state().connections, 3);
    const fourth = await dial(sock, key);
    await fourth.ok;
    assert.ok(await until(() => fourth.s.gone), 'the 4th authenticated connection is closed');
    assert.strictEqual(fourth.client.replies.filter((r) => r.id !== undefined).length, 0, 'and gets no answer');
    assert.strictEqual(h.state().connections, 3, 'the refused one does not count');
    assert.ok(idle.every((s) => !s.destroyed), 'idle peers were never what blocked');
    real[0].s.destroy();
    assert.ok(await until(() => h.state().connections === 2));
    const again = await dial(sock, key);
    assert.ok(await again.ok);
    assert.ok((await init(again.client)).result, 'a freed slot is reusable');
    await h.stop();
  }

  // 7. Rate limit: 10 calls per second per connection (T012's bucket), the rest dropped, no reply.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const d = await dial(h.socket as string, keyOf(ud));
    assert.ok(await d.ok);
    await init(d.client);
    const before = d.client.replies.length;
    let burst = '';
    for (let i = 0; i < 40; i++) burst += JSON.stringify({ jsonrpc: '2.0', id: 1000 + i, method: 'ping' }) + '\n';
    d.client.sendRaw(burst);
    await sleep(400);
    const got = d.client.replies.length - before;
    assert.ok(got >= 5 && got <= 14, `about one bucket of answers (got ${got} of 40)`);
    assert.ok(!d.s.gone, 'a short burst does not close the connection');
    await h.stop();
  }

  // 8. stop(): connections closed, socket and key file removed, idempotent, restartable.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const sock = h.socket as string;
    const oldKey = keyOf(ud);
    const d = await dial(sock, oldKey);
    assert.ok(await d.ok);
    const kf = keyFileOf(ud);
    assert.ok(fs.existsSync(kf));
    const st = await h.stop();
    assert.strictEqual(st.status, 'off');
    assert.ok(await until(() => d.s.gone), 'connection closed by stop');
    assert.ok(!fs.existsSync(kf), 'key file removed');
    if (!win) assert.ok(!fs.existsSync(sock), 'socket file removed');
    assert.strictEqual(await connects(sock), false, 'nobody listens any more');
    assert.strictEqual((await h.stop()).status, 'off', 'stop twice is fine');
    assert.strictEqual((await h.apply(true)).status, 'listening', 'can start again');
    assert.ok(!keyOf(ud).equals(oldKey), 'a fresh key');
    await h.apply(false);
    assert.ok(!fs.existsSync(kf));
  }

  // 9. A live owner (a second instance): the second one does not serve, and changes nothing of the first one's files.
  {
    const ud = mkRoot();
    const a = mkHost(ud);
    await a.start();
    const kf = keyFileOf(ud);
    const keyBefore = fs.readFileSync(kf, 'utf8');
    const b = mkHost(ud);
    const st = await b.start();
    assert.strictEqual(st.status, 'other-instance', JSON.stringify(st));
    assert.strictEqual(b.socket, null);
    assert.strictEqual(fs.readFileSync(kf, 'utf8'), keyBefore, 'the first instance\'s key is untouched');
    await b.stop(); // must not remove what it does not own
    assert.ok(fs.existsSync(kf), 'stopping the second one leaves the first one\'s key file');
    const d = await dial(a.socket as string, keyOf(ud));
    assert.ok(await d.ok, 'the first instance still serves');
    assert.ok((await init(d.client)).result);
    await a.stop();
    assert.ok(!fs.existsSync(kf));
  }

  // 10. A stale socket (the owner was killed, the file stayed) is removed and replaced. Unix only: pipes have no files.
  if (!win) {
    const ud = mkRoot();
    const sockPath = pathsOf(ud).socket as string;
    fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
    const child = spawn(process.execPath, ['-e', `const n=require('net');n.createServer().listen(${JSON.stringify(sockPath)},()=>console.log('up'));setInterval(()=>{},1e6)`], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      await new Promise<void>((res, rej) => { child.stdout!.once('data', () => res()); child.once('error', rej); child.once('exit', () => rej(new Error('child exited'))); });
      assert.strictEqual(await connects(sockPath), true, 'the child answers (this is a live owner for now)');
      const live = await mkHost(ud).start();
      assert.strictEqual(live.status, 'other-instance', 'a live socket is not taken over');
      const killed = new Promise<void>((res) => child.once('exit', () => res()));
      child.kill('SIGKILL'); // our own child, by handle
      await killed;
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    assert.ok(fs.existsSync(sockPath), 'the dead owner left its socket file behind');
    assert.strictEqual(await connects(sockPath), false, 'and nobody answers on it');
    const h = mkHost(ud);
    const st = await h.start();
    assert.strictEqual(st.status, 'listening', 'stale socket removed and replaced: ' + JSON.stringify(st));
    const d = await dial(h.socket as string, keyOf(ud));
    assert.ok(await d.ok);
    assert.ok((await init(d.client)).result);
    await h.stop();
    // something that is not a socket is never deleted
    const ud2 = mkRoot();
    const p2 = pathsOf(ud2).socket as string;
    fs.mkdirSync(path.dirname(p2), { recursive: true, mode: 0o700 });
    fs.writeFileSync(p2, 'precious');
    const st2 = await mkHost(ud2).start();
    assert.strictEqual(st2.status, 'unavailable');
    assert.strictEqual(fs.readFileSync(p2, 'utf8'), 'precious');
    assert.ok(!fs.existsSync(keyFileOf(ud2)), 'a refused start leaves no key file');
  }

  // 11. No safe place to listen: nothing is left behind, and the reason is a fixed text.
  {
    const st = await mkHost('relative/path').start();
    assert.strictEqual(st.status, 'unavailable');
    assert.ok(st.reason && !/[0-9a-f]{64}/.test(st.reason));
  }

  // 12. stop() while start() is in flight: nothing is left behind and start does not report listening.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    const sp = h.start();
    const tp = h.stop();
    const [st] = await Promise.all([sp, tp]);
    assert.notStrictEqual(st.status, 'listening', 'start did not report listening');
    assert.strictEqual(h.state().status, 'off');
    assert.ok(!fs.existsSync(keyFileOf(ud)), 'no key file');
    if (!win) assert.ok(!fs.existsSync(pathsOf(ud).socket as string), 'no socket');
    assert.strictEqual(h.socket, null);
    // the same, when stop() comes after the key file was written but before listen resolved
    const h2 = mkHost(ud);
    const sp2 = h2.start();
    await sleep(0);
    const tp2 = h2.stop();
    await Promise.all([sp2, tp2]);
    assert.ok(!fs.existsSync(keyFileOf(ud)) && (win || !fs.existsSync(pathsOf(ud).socket as string)));
    assert.strictEqual(h2.state().status, 'off');
  }

  // 12b. stop() lands after the probe, while the key file is being made: the start undoes itself once listen resolves.
  {
    const ud = mkRoot();
    let once = true;
    let h3!: McpServerHost;
    h3 = mkHost(ud, { random: (n) => { if (once) { once = false; void h3.stop(); } return require('crypto').randomBytes(n); } });
    const st = await h3.start();
    await h3.stop();
    assert.notStrictEqual(st.status, 'listening');
    assert.strictEqual(h3.state().status, 'off');
    assert.ok(!fs.existsSync(keyFileOf(ud)), 'no key file left');
    if (!win) assert.ok(!fs.existsSync(pathsOf(ud).socket as string), 'no socket left');
  }

  // 13. A request line split across the handshake boundary is kept: proof + 20 bytes of initialize, the rest 300 ms later.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const s = await dialRaw(h.socket as string);
    const key = keyOf(ud);
    const rx = new LineFramer();
    const replies: any[] = [];
    let proof = '';
    let sent = false;
    const hs = createBridgeHandshake({
      key,
      send: (m) => { proof = m + '\n'; },
      timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (x) => clearTimeout(x as NodeJS.Timeout) },
      onDone: () => undefined,
    });
    hs.start();
    s.on('data', (chunk: Buffer) => {
      for (const ev of rx.push(chunk)) {
        if (ev.type !== 'line') continue;
        if (!hs.done) {
          hs.receive(ev.line);
          if (proof && !sent) {
            sent = true;
            const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION } }) + '\n';
            s.write(Buffer.concat([Buffer.from(proof), Buffer.from(req).subarray(0, 20)])); // one write: proof + a partial request
            setTimeout(() => s.write(Buffer.from(req).subarray(20)), 300);
          }
        } else replies.push(JSON.parse(ev.line));
      }
    });
    assert.ok(await until(() => replies.length > 0, 3000), 'the split request was answered');
    assert.strictEqual(replies[0].id, 1);
    assert.ok(replies[0].result && replies[0].result.serverInfo.name === 'agent-durbar', 'a valid initialize result');
    await h.stop();
  }

  // 14. Requests before the handshake get no answer with data and the socket is closed.
  {
    const ud = mkRoot();
    const h = mkHost(ud);
    await h.start();
    const s = await dialRaw(h.socket as string);
    let got = '';
    s.on('data', (d: Buffer) => { got += d.toString('utf8'); });
    s.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION } }) + '\n');
    s.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'durbar_list_floors', arguments: {} } }) + '\n');
    assert.ok(await until(() => s.gone), 'closed');
    assert.ok(!/"result"|"error"|Attic|floors/.test(got.replace(/"hello":"[^"]*"/, '')), 'only the server hello was sent: ' + got.slice(0, 120));
    assert.strictEqual(h.state().connections, 0);
    await h.stop();
  }

  console.log('mcp server ok');
})().then(
  () => cleanup(0),
  (e) => { console.error(e); cleanup(1); },
);

function cleanup(code: number): void {
  for (const s of socks) s.destroy();
  void Promise.allSettled(hosts.map((h) => h.stop())).then(() => {
    for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* temp */ } }
    process.exit(code);
  });
}
