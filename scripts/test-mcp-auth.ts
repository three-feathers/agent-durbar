/** Spec 041 T011: key file (fake fs) and the mutual HMAC handshake (fake timers, no sockets). */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fsReal from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nodeMcpFs } from '../src/main/mcp/auth';
import {
  createBridgeHandshake, createKeyFile, createServerHandshake, deleteKeyFile, readKeyFile, rotateKeyFile,
} from '../src/main/mcp/auth';
import type { AuthStat, HandshakeResult, KeyFileDeps, McpFs } from '../src/main/mcp/auth';

// ---- fake fs --------------------------------------------------------------------------------
interface Node { kind: 'file' | 'dir' | 'link' | 'fifo'; mode: number; uid: number; data: string }
function makeFs(uid = 501) {
  const nodes = new Map<string, Node>();
  const fail: { writeAfter?: number; rename?: boolean } = {};
  const fds = new Map<number, Node>(); let nextFd = 3;
  /** Runs right after an lstat of `path` returned (to swap the file in a race). */
  const hook: { afterLstat?: (p: string) => void } = {};
  const err = (code: string) => Object.assign(new Error(code), { code });
  const stat = (n: Node): AuthStat & { size: number } => ({
    uid: n.uid, mode: n.mode,
    isSymbolicLink: () => n.kind === 'link', isFile: () => n.kind === 'file', isDirectory: () => n.kind === 'dir',
    size: n.data.length,
  });
  const fs: McpFs = {
    mkdirp(d, mode) { if (!nodes.has(d)) nodes.set(d, { kind: 'dir', mode, uid, data: '' }); },
    chmod(p, mode) { const n = nodes.get(p); if (!n) throw err('ENOENT'); n.mode = mode; },
    writeNew(f, data, mode) {
      if (nodes.has(f)) throw err('EEXIST');
      if (fail.writeAfter !== undefined) { nodes.set(f, { kind: 'file', mode, uid, data: data.slice(0, fail.writeAfter) }); throw err('ENOSPC'); }
      nodes.set(f, { kind: 'file', mode, uid, data });
    },
    rename(a, b) { if (fail.rename) throw err('EXDEV'); const n = nodes.get(a); if (!n) throw err('ENOENT'); nodes.delete(a); nodes.set(b, n); },
    open(f) {
      const n = nodes.get(f); if (!n) throw err('ENOENT');
      if (n.kind === 'link') throw err('ELOOP'); // O_NOFOLLOW
      const fd = nextFd++; fds.set(fd, n); return fd; // a FIFO opens without blocking (O_NONBLOCK) and is refused by fstat
    },
    fstat(fd) { const n = fds.get(fd); if (!n) throw err('EBADF'); return stat(n); },
    readFd(fd, max) { const n = fds.get(fd); if (!n) throw err('EBADF'); return n.data.slice(0, max); },
    close(fd) { fds.delete(fd); },
    lstat(p) { const n = nodes.get(p); if (!n) throw err('ENOENT'); const st = stat(n); hook.afterLstat?.(p); return st; },
    unlink(p) { if (!nodes.delete(p)) throw err('ENOENT'); },
  };
  return { fs, nodes, fail, fds, hook };
}
const DIR = '/u/agent-durbar/mcp';
const FILE = DIR + '/connection.json';
function deps(f: ReturnType<typeof makeFs>, over: Partial<KeyFileDeps> = {}): KeyFileDeps {
  return { fs: f.fs, mcpDir: DIR, keyFile: FILE, uid: 501, platform: 'darwin', ...over };
}

// ---- key file -------------------------------------------------------------------------------
{
  const f = makeFs();
  const m = createKeyFile(deps(f));
  assert.strictEqual(m.key.length, 32, '256-bit key');
  assert.ok(/^[A-Za-z0-9]{8,128}$/.test(m.pipeId), 'pipe id fits the pipe-name rule');
  assert.strictEqual(f.nodes.get(FILE)!.mode, 0o600);
  assert.strictEqual(f.nodes.get(DIR)!.mode, 0o700);
  assert.deepStrictEqual([...f.nodes.keys()].sort(), [DIR, FILE], 'no temp file left behind');
  const r = readKeyFile(deps(f));
  assert.ok(r.ok && r.material.key.equals(m.key) && r.material.pipeId === m.pipeId, 'round trip');

  // an existing folder with a loose mode is tightened on create
  const f2 = makeFs(); f2.nodes.set(DIR, { kind: 'dir', mode: 0o755, uid: 501, data: '' });
  createKeyFile(deps(f2));
  assert.strictEqual(f2.nodes.get(DIR)!.mode, 0o700);

  // rotate: new key and pipe id, old key no longer verifies
  const old = m.key;
  const m2 = rotateKeyFile(deps(f));
  assert.ok(!m2.key.equals(old) && m2.pipeId !== m.pipeId, 'rotation makes a new key and pipe id');
  const r2 = readKeyFile(deps(f));
  assert.ok(r2.ok && r2.material.key.equals(m2.key) && !r2.material.key.equals(old));

  // delete: gone; deleting again is fine; read says missing
  deleteKeyFile(deps(f)); deleteKeyFile(deps(f));
  const gone = readKeyFile(deps(f));
  assert.ok(!gone.ok && gone.reason === 'missing');
  const none = readKeyFile(deps(makeFs()));
  assert.ok(!none.ok && none.reason === 'missing', 'no folder is also missing');
}

// wrong mode / owner / link / type are refused (POSIX); Windows skips the mode and owner checks only
{
  const mk = () => { const f = makeFs(); createKeyFile(deps(f)); return f; };
  const refused = (f: ReturnType<typeof makeFs>, over: Partial<KeyFileDeps> = {}) => {
    const r = readKeyFile(deps(f, over));
    assert.ok(!r.ok && r.reason === 'unsafe', JSON.stringify(r));
    return r;
  };
  let f = mk(); f.nodes.get(FILE)!.mode = 0o644; refused(f);
  f = mk(); f.nodes.get(FILE)!.mode = 0o620; refused(f);
  f = mk(); f.nodes.get(FILE)!.mode = 0o400; assert.ok(readKeyFile(deps(f)).ok, '0400 is not wider than 0600');
  f = mk(); f.nodes.get(FILE)!.uid = 0; refused(f);
  f = mk(); f.nodes.get(FILE)!.kind = 'link'; refused(f);
  f = mk(); f.nodes.get(FILE)!.kind = 'dir'; refused(f);
  f = mk(); f.nodes.get(DIR)!.mode = 0o755; refused(f);
  f = mk(); f.nodes.get(DIR)!.kind = 'link'; refused(f);
  f = mk(); f.nodes.get(DIR)!.uid = 7; refused(f);
  f = mk(); f.nodes.get(FILE)!.mode = 0o666;
  assert.ok(readKeyFile(deps(f, { platform: 'win32', uid: null })).ok, 'win32: mode bits are not meaningful');
  f = mk(); f.nodes.get(FILE)!.kind = 'link';
  assert.ok(!readKeyFile(deps(f, { platform: 'win32', uid: null })).ok, 'win32: links are still refused');

  // damaged content
  for (const bad of ['', 'nope', '[]', '{"version":2}', JSON.stringify({ version: 1, key: 'ab', pipeId: 'abcdefgh12' }),
    JSON.stringify({ version: 1, key: 'a'.repeat(64), pipeId: 'x' }), 'x'.repeat(5000)]) {
    f = mk(); f.nodes.get(FILE)!.data = bad;
    const r = readKeyFile(deps(f)); assert.ok(!r.ok && r.reason === 'invalid', bad.slice(0, 20));
  }
  // the size cap itself: valid JSON, just padded past the cap, is refused (and the same file unpadded is fine)
  f = mk(); assert.ok(readKeyFile(deps(f)).ok);
  f.nodes.get(FILE)!.data = f.nodes.get(FILE)!.data.trimEnd() + ' '.repeat(5000);
  assert.ok(JSON.parse(f.nodes.get(FILE)!.data).version === 1, 'padded file is still valid JSON');
  { const r = readKeyFile(deps(f)); assert.ok(!r.ok && r.reason === 'invalid', 'size cap'); assert.strictEqual(f.fds.size, 0); }

  // owner check fails closed when the uid is unknown (POSIX)
  f = mk(); refused(f, { uid: null });

  // a file swapped in after the lstat is refused by the descriptor checks (symlink, FIFO, loosened mode), nothing blocks, no fd leaks
  for (const swap of ['link', 'fifo'] as const) {
    f = mk();
    f.hook.afterLstat = (p) => { if (p === FILE) { f.hook.afterLstat = undefined; f.nodes.get(FILE)!.kind = swap; } };
    const r = readKeyFile(deps(f)); assert.ok(!r.ok && r.reason === 'unsafe', 'swap to ' + swap);
    assert.strictEqual(f.fds.size, 0, 'descriptor closed');
  }
  f = mk();
  f.hook.afterLstat = (p) => { if (p === FILE) { f.hook.afterLstat = undefined; f.nodes.get(FILE)!.mode = 0o666; } };
  { const r = readKeyFile(deps(f)); assert.ok(!r.ok && r.reason === 'unsafe', 'mode loosened after lstat'); }
  f = mk();
  f.hook.afterLstat = (p) => { if (p === FILE) { f.hook.afterLstat = undefined; f.nodes.get(FILE)!.uid = 0; } };
  { const r = readKeyFile(deps(f)); assert.ok(!r.ok && r.reason === 'unsafe', 'owner changed after lstat'); }

  // the write path refuses a symlinked or foreign folder
  const w = makeFs(); w.nodes.set(DIR, { kind: 'link', mode: 0o777, uid: 501, data: '' });
  assert.throws(() => createKeyFile(deps(w)), /symbolic link/);
  assert.ok(!w.nodes.has(FILE) && [...w.nodes.keys()].every((k) => !k.endsWith('.tmp')), 'nothing written through the link');
  const w2 = makeFs(); w2.nodes.set(DIR, { kind: 'dir', mode: 0o700, uid: 0, data: '' });
  assert.throws(() => rotateKeyFile(deps(w2)), /another user/);
  assert.ok(!w2.nodes.has(FILE));
  const w3 = makeFs(); w3.nodes.set(DIR, { kind: 'file', mode: 0o700, uid: 501, data: '' });
  assert.throws(() => createKeyFile(deps(w3)), /not a folder/);
  const w4 = makeFs(); assert.throws(() => createKeyFile(deps(w4, { uid: null })), /another user/, 'write also fails closed without a uid');
}

// atomic write: a failed write or rename leaves the previous file intact (or none) and no temp file
{
  const f = makeFs();
  const first = createKeyFile(deps(f));
  const before = f.nodes.get(FILE)!.data;
  f.fail.writeAfter = 10;
  assert.throws(() => rotateKeyFile(deps(f)), /Could not write/);
  assert.strictEqual(f.nodes.get(FILE)!.data, before, 'old file untouched after a partial write');
  assert.deepStrictEqual([...f.nodes.keys()].sort(), [DIR, FILE], 'partial temp file removed');
  delete f.fail.writeAfter; f.fail.rename = true;
  assert.throws(() => rotateKeyFile(deps(f)), /Could not write/);
  assert.strictEqual(f.nodes.get(FILE)!.data, before);
  assert.deepStrictEqual([...f.nodes.keys()].sort(), [DIR, FILE]);
  const r = readKeyFile(deps(f)); assert.ok(r.ok && r.material.key.equals(first.key));

  // first write failing leaves no key file at all
  const g = makeFs(); g.fail.writeAfter = 5;
  assert.throws(() => createKeyFile(deps(g)));
  assert.ok(!g.nodes.has(FILE) && [...g.nodes.keys()].every((k) => !k.endsWith('.tmp')));
  // the error text never carries key material
  const h = makeFs(); h.fail.rename = true;
  const fixed = Buffer.alloc(32, 0xab);
  try { createKeyFile(deps(h, { random: (n) => Buffer.alloc(n, 0xab) })); assert.fail('should throw'); } catch (e) {
    assert.ok(!String((e as Error).message).includes(fixed.toString('hex')));
  }
}

// ---- handshake harness ----------------------------------------------------------------------
class FakeTimers {
  private next = 1; private t = new Map<number, { at: number; fn: () => void }>(); now = 0;
  setTimeout = (fn: () => void, ms: number) => { const id = this.next++; this.t.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = (h: unknown) => { this.t.delete(h as number); };
  advance(ms: number) { this.now += ms; for (const [id, x] of [...this.t]) if (x.at <= this.now) { this.t.delete(id); x.fn(); } }
  get pending() { return this.t.size; }
}
const KEY = crypto.randomBytes(32);
const OTHER = crypto.randomBytes(32);

function pair(serverKey: Buffer, bridgeKey: Buffer, opts: { marker?: boolean; parent?: string } = {}) {
  const timers = new FakeTimers();
  const log: string[] = []; // every message on the wire, both ways
  const results: { server?: HandshakeResult; bridge?: HandshakeResult } = {};
  let s2b: string[] = []; let b2s: string[] = [];
  const server = createServerHandshake({ key: serverKey, timers, send: (m) => { log.push(m); s2b.push(m); }, onDone: (r) => { results.server = r; } });
  const bridge = createBridgeHandshake({ key: bridgeKey, timers, send: (m) => { log.push(m); b2s.push(m); }, onDone: (r) => { results.bridge = r; }, peer: { marker: opts.marker ?? false, parent: opts.parent } });
  const pump = () => {
    for (let i = 0; i < 10 && (s2b.length || b2s.length); i++) {
      const a = s2b; const b = b2s; s2b = []; b2s = [];
      a.forEach((m) => bridge.receive(m)); b.forEach((m) => server.receive(m));
    }
  };
  return { server, bridge, timers, log, results, pump, get s2b() { return s2b; }, get b2s() { return b2s; } };
}

// happy path
{
  const p = pair(KEY, KEY, { marker: true, parent: 'claude-code' });
  p.bridge.start(); p.server.start(); p.pump();
  assert.ok(p.results.server?.ok && p.results.bridge?.ok);
  assert.deepStrictEqual(p.results.server!.ok && p.results.server!.peer, { marker: true, parent: 'claude-code' });
  assert.strictEqual(p.log.length, 3, 'hello, answer, final');
  assert.strictEqual(p.timers.pending, 0, 'timers cleared on success');
  assert.ok(p.server.done && p.bridge.done);
}

// wrong key, both directions; and a failed server sends nothing beyond its hello
{
  const p = pair(KEY, OTHER); p.bridge.start(); p.server.start(); p.pump();
  assert.ok(p.results.server && !p.results.server.ok && p.results.server.error.code === 'bad-mac', 'server refuses a bridge with the wrong key');
  assert.strictEqual(p.log.length, 2, 'only hello and the bridge answer: nothing is sent to an unauthenticated peer');
  // an attacker with no key invents the server's final MAC against a real bridge
  const q = pair(KEY, KEY); q.bridge.start(); q.server.start();
  q.bridge.receive(q.s2b[0]);
  q.bridge.receive(JSON.stringify({ ok: true, mac: crypto.randomBytes(32).toString('hex') }));
  assert.ok(q.results.bridge && !q.results.bridge.ok && q.results.bridge.error.code === 'bad-mac', 'bridge refuses a server that does not know the key');
  const s = pair(OTHER, KEY); s.bridge.start(); s.server.start(); s.pump();
  assert.ok(s.results.server && !s.results.server.ok, 'server with another key refuses the bridge');
}

// bridge side: server with the wrong key (it must be the bridge that refuses)
{
  const timers = new FakeTimers();
  let helloMsg = ''; let answer = ''; let bridgeRes: HandshakeResult | undefined;
  const wrong = createServerHandshake({ key: OTHER, timers, send: (m) => { helloMsg = m; }, onDone: () => {} });
  const bridge = createBridgeHandshake({ key: KEY, timers, send: (m) => { answer = m; }, onDone: (r) => { bridgeRes = r; } });
  bridge.start(); wrong.start(); bridge.receive(helloMsg);
  // wrong-key server cannot verify, so it cannot produce the right final; give it the best it can: a MAC under OTHER
  const nonceS = Buffer.from(JSON.parse(helloMsg).nonceS, 'hex'); const nonceB = Buffer.from(JSON.parse(answer).nonceB, 'hex');
  const forged = crypto.createHmac('sha256', OTHER).update('s').update(nonceB).update(nonceS).digest('hex');
  bridge.receive(JSON.stringify({ ok: true, mac: forged }));
  assert.ok(bridgeRes && !bridgeRes.ok && bridgeRes.error.code === 'bad-mac');
}

// reflection: the bridge's own MAC fed back as the server's final, and the server's final fed to the server as a bridge answer
{
  const timers = new FakeTimers();
  const sent: string[] = []; let bres: HandshakeResult | undefined;
  const bridge = createBridgeHandshake({ key: KEY, timers, send: (m) => sent.push(m), onDone: (r) => { bres = r; } });
  bridge.start();
  const nonceS = crypto.randomBytes(32).toString('hex');
  bridge.receive(JSON.stringify({ hello: 'agent-durbar-mcp/1', nonceS }));
  const mine = JSON.parse(sent[0]);
  bridge.receive(JSON.stringify({ ok: true, mac: mine.mac })); // reflect my own 'b' MAC as the server's 's' MAC
  assert.ok(bres && !bres.ok && bres.error.code === 'bad-mac', 'reflected bridge MAC refused by the bridge');

  // server side: use the server's final MAC (label s, order nonceB|nonceS) as the bridge answer, and the swapped nonce order
  const p = pair(KEY, KEY); p.bridge.start(); p.server.start(); p.pump();
  const final = JSON.parse(p.log[2]); const hello = JSON.parse(p.log[0]); const ans = JSON.parse(p.log[1]);
  const t2 = new FakeTimers(); let sres: HandshakeResult | undefined;
  const srv = createServerHandshake({ key: KEY, timers: t2, send: () => {}, onDone: (r) => { sres = r; }, random: () => Buffer.from(hello.nonceS, 'hex') });
  srv.start(); // same nonceS as the recorded run
  srv.receive(JSON.stringify({ nonceB: ans.nonceB, mac: final.mac })); // server's own final MAC used as the bridge answer
  assert.ok(sres && !sres.ok && sres.error.code === 'bad-mac', 'server MAC cannot stand in for the bridge MAC');

  // replay of a recorded valid bridge answer against a fresh server nonce
  const t3 = new FakeTimers(); let rres: HandshakeResult | undefined;
  const srv2 = createServerHandshake({ key: KEY, timers: t3, send: () => {}, onDone: (r) => { rres = r; } });
  srv2.start();
  srv2.receive(JSON.stringify({ nonceB: ans.nonceB, mac: ans.mac }));
  assert.ok(rres && !rres.ok && rres.error.code === 'bad-mac', 'a replayed answer fails against a new nonce');

  // the bridge echoing the server's nonce as its own is refused
  const t4 = new FakeTimers(); let eres: HandshakeResult | undefined; let ns = '';
  const srv3 = createServerHandshake({ key: KEY, timers: t4, send: (m) => { ns = JSON.parse(m).nonceS; }, onDone: (r) => { eres = r; } });
  srv3.start();
  const selfMac = crypto.createHmac('sha256', KEY).update('b').update(Buffer.from(ns, 'hex')).update(Buffer.from(ns, 'hex')).digest('hex');
  srv3.receive(JSON.stringify({ nonceB: ns, mac: selfMac }));
  assert.ok(eres && !eres.ok && eres.error.code === 'bad-mac', 'equal nonces refused');
}

// truncated, garbage and wrong-shape messages: refused, never throw
{
  const garbage: string[] = ['', '{', 'null', '[]', '"x"', '{"nonceB":"zz","mac":"zz"}', '{"nonceB":"ab","mac":"ab"}',
    '{"mac":"' + 'a'.repeat(63) + '"}', '{"mac":"' + 'a'.repeat(62) + '","nonceB":"' + 'a'.repeat(64) + '"}', 'x'.repeat(2000),
    JSON.stringify({ nonceB: 'a'.repeat(64), mac: 'A'.repeat(64) }), JSON.stringify({ nonceB: 'a'.repeat(64), mac: 'a'.repeat(64), marker: 'yes' }),
    JSON.stringify({ nonceB: 'a'.repeat(64), mac: 'a'.repeat(64), parent: 'p'.repeat(65) })];
  for (const g of garbage) {
    const p = pair(KEY, KEY); p.server.start();
    assert.doesNotThrow(() => p.server.receive(g));
    assert.ok(p.results.server && !p.results.server.ok, 'server refuses ' + g.slice(0, 30));
  }
  // truncation of a real answer at every length
  const real = pair(KEY, KEY); real.bridge.start(); real.server.start(); real.pump();
  const full = real.log[1];
  for (let n = 0; n < full.length; n++) {
    const p = pair(KEY, KEY); p.server.start();
    assert.doesNotThrow(() => p.server.receive(full.slice(0, n)));
    assert.ok(p.results.server && !p.results.server.ok, 'truncated at ' + n);
  }
  // bridge side
  for (const g of ['', '{', '[]', '{"hello":"agent-durbar-mcp/1"}', '{"hello":"agent-durbar-mcp/1","nonceS":"abc"}']) {
    const p = pair(KEY, KEY); p.bridge.start();
    assert.doesNotThrow(() => p.bridge.receive(g));
    assert.ok(p.results.bridge && !p.results.bridge.ok, 'bridge refuses ' + g);
  }
  const v = pair(KEY, KEY); v.bridge.start();
  v.bridge.receive(JSON.stringify({ hello: 'agent-durbar-mcp/2', nonceS: 'a'.repeat(64) }));
  assert.ok(v.results.bridge && !v.results.bridge.ok && v.results.bridge.error.code === 'bad-version');
  // final message of the wrong shape
  for (const g of ['{}', '{"ok":false}', '{"ok":true}', '{"ok":true,"mac":"ab"}', '{"ok":true,"mac":"' + 'a'.repeat(65) + '"}']) {
    const p = pair(KEY, KEY); p.bridge.start(); p.server.start();
    p.bridge.receive(p.s2b[0]); p.bridge.receive(g);
    assert.ok(p.results.bridge && !p.results.bridge.ok, 'final ' + g);
  }
  // a message before start, and after finishing, is ignored or refused without throwing
  const e = pair(KEY, KEY); e.server.receive('{}');
  assert.ok(e.results.server && !e.results.server.ok && e.results.server.error.code === 'bad-state');
}

// timeout (2 s), on both sides; the result is reported once; no late success
{
  const p = pair(KEY, KEY); p.server.start(); p.bridge.start();
  p.timers.advance(1999); assert.strictEqual(p.server.done, false, 'not yet at 1999 ms');
  p.timers.advance(1);
  assert.ok(p.results.server && !p.results.server.ok && p.results.server.error.code === 'timeout');
  assert.ok(p.results.bridge && !p.results.bridge.ok && p.results.bridge.error.code === 'timeout');
  const calls: HandshakeResult[] = [];
  const t = new FakeTimers();
  const s = createServerHandshake({ key: KEY, timers: t, send: () => {}, onDone: (r) => calls.push(r) });
  s.start(); t.advance(2000); s.receive('{}'); t.advance(5000);
  assert.strictEqual(calls.length, 1, 'reported once');
  // abort stops the timer silently
  const u = new FakeTimers(); let called = false;
  const a = createServerHandshake({ key: KEY, timers: u, send: () => {}, onDone: () => { called = true; } });
  a.start(); a.abort(); u.advance(10000);
  assert.ok(!called && u.pending === 0);
  // custom timeout is honoured
  const w = new FakeTimers(); let got: HandshakeResult | undefined;
  const c = createBridgeHandshake({ key: KEY, timers: w, send: () => {}, onDone: (r) => { got = r; }, timeoutMs: 50 });
  c.start(); w.advance(50);
  assert.ok(got && !got.ok && got.error.code === 'timeout');
}

// the key never appears in a message or an error (a distinctive key, hex and base64, over success and failures)
{
  const secret = Buffer.from('0123456789abcdef0123456789abcdef');
  const needles = [secret.toString('hex'), secret.toString('base64'), secret.toString('latin1')];
  const texts: string[] = [];
  for (const [a, b] of [[secret, secret], [secret, OTHER], [OTHER, secret]] as [Buffer, Buffer][]) {
    const p = pair(a, b); p.bridge.start(); p.server.start(); p.pump();
    texts.push(...p.log);
    for (const r of [p.results.server, p.results.bridge]) if (r && !r.ok) texts.push(r.error.code, r.error.message);
  }
  const t = new FakeTimers(); let r: HandshakeResult | undefined;
  const s = createServerHandshake({ key: secret, timers: t, send: (m) => texts.push(m), onDone: (x) => { r = x; } });
  s.start(); t.advance(2000); const rr = r as HandshakeResult | undefined; if (rr && !rr.ok) texts.push(rr.error.message);
  assert.throws(() => createServerHandshake({ key: Buffer.alloc(5), timers: t, send: () => {}, onDone: () => {} }), (e: Error) => !needles.some((n) => e.message.includes(n)));
  const f = makeFs();
  const m = createKeyFile(deps(f, { random: (n) => Buffer.from(secret.toString('latin1').repeat(Math.ceil(n / 32)).slice(0, n), 'latin1') }));
  assert.ok(m.key.equals(secret));
  f.nodes.get(FILE)!.mode = 0o644; const bad = readKeyFile(deps(f)); if (!bad.ok) texts.push(bad.message);
  f.nodes.get(FILE)!.mode = 0o600; f.nodes.get(FILE)!.data = f.nodes.get(FILE)!.data.slice(0, 30); const bad2 = readKeyFile(deps(f)); if (!bad2.ok) texts.push(bad2.message);
  assert.ok(texts.length > 8);
  for (const t2 of texts) for (const n of needles) assert.ok(!t2.includes(n), 'key material leaked');
}

// known-answer: the wire format and the transcript encoding are pinned, with an independent encoder in the test
{
  const lp = (x: string) => { const bb = Buffer.from(x, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(bb.length); return Buffer.concat([l, bb]); };
  const T = (role: string, x: Buffer, y: Buffer, marker: boolean, parent?: string) =>
    Buffer.concat([lp(role), lp('agent-durbar-mcp/1'), x, y, Buffer.from([marker ? 1 : 0, parent !== undefined ? 1 : 0]), lp(parent ?? '')]);
  const hm = (t: Buffer) => crypto.createHmac('sha256', KEY).update(t).digest('hex');
  const nS = Buffer.alloc(32, 0x11); const nB = Buffer.alloc(32, 0x22);
  for (const peer of [{ marker: false }, { marker: true, parent: 'claude-code' }, { marker: false, parent: '' }] as { marker: boolean; parent?: string }[]) {
    const timers = new FakeTimers(); const out: string[] = [];
    const srv = createServerHandshake({ key: KEY, timers, send: (m) => out.push(m), onDone: () => {}, random: () => nS });
    const br = createBridgeHandshake({ key: KEY, timers, send: (m) => out.push(m), onDone: () => {}, random: () => nB, peer });
    srv.start(); br.start();
    assert.deepStrictEqual(JSON.parse(out[0]), { hello: 'agent-durbar-mcp/1', nonceS: nS.toString('hex') });
    br.receive(out[0]);
    assert.strictEqual(JSON.parse(out[1]).mac, hm(T('b', nS, nB, peer.marker, peer.parent)), 'bridge MAC over the transcript');
    srv.receive(out[1]);
    assert.strictEqual(JSON.parse(out[2]).mac, hm(T('s', nB, nS, peer.marker, peer.parent)), 'server MAC over the transcript');
    assert.notStrictEqual(hm(T('b', nS, nB, peer.marker, peer.parent)), hm(T('s', nB, nS, peer.marker, peer.parent)));
  }
  // absent parent and empty parent are different transcripts
  assert.notStrictEqual(hm(T('b', nS, nB, false)), hm(T('b', nS, nB, false, '')));
}

// transcript binding: a relayed reply with a changed marker or parent is refused by the server
{
  const nS = Buffer.alloc(32, 0x33); const nB = Buffer.alloc(32, 0x44);
  const attempt = (edit: (o: Record<string, unknown>) => void) => {
    const timers = new FakeTimers(); const out: string[] = []; let res: HandshakeResult | undefined;
    const srv = createServerHandshake({ key: KEY, timers, send: (m) => out.push(m), onDone: (r) => { res = r; }, random: () => nS });
    const br = createBridgeHandshake({ key: KEY, timers, send: (m) => out.push(m), onDone: () => {}, random: () => nB, peer: { marker: true, parent: 'claude-code' } });
    srv.start(); br.start(); br.receive(out[0]);
    const reply = JSON.parse(out[1]); edit(reply);
    srv.receive(JSON.stringify(reply));
    return res!;
  };
  assert.ok(attempt(() => {}).ok, 'unmodified reply is accepted');
  for (const [name, edit] of [
    ['marker true->false', (o: Record<string, unknown>) => { o.marker = false; }],
    ['marker removed', (o: Record<string, unknown>) => { delete o.marker; }],
    ['parent changed', (o: Record<string, unknown>) => { o.parent = 'vscode'; }],
    ['parent removed', (o: Record<string, unknown>) => { delete o.parent; }],
    ['parent added empty', (o: Record<string, unknown>) => { o.parent = ''; }],
  ] as [string, (o: Record<string, unknown>) => void][]) {
    const r = attempt(edit);
    assert.ok(!r.ok && r.error.code === 'bad-mac', name);
  }
}

// send / onDone that throw: receive and start never throw, and a send error fails the handshake as bad-state
{
  const t = new FakeTimers(); let res: HandshakeResult | undefined;
  const s1 = createServerHandshake({ key: KEY, timers: t, send: () => { throw new Error('socket closed'); }, onDone: (r) => { res = r; } });
  assert.doesNotThrow(() => s1.start());
  assert.ok(res && !res.ok && res.error.code === 'bad-state'); assert.strictEqual(t.pending, 0);

  // the final send fails: not reported as success
  const ok = pair(KEY, KEY); ok.bridge.start(); ok.server.start();
  const t2 = new FakeTimers(); let r2: HandshakeResult | undefined; let n = 0; const sent: string[] = [];
  const s2 = createServerHandshake({ key: KEY, timers: t2, send: (m) => { sent.push(m); if (++n === 2) throw new Error('boom'); }, onDone: (r) => { r2 = r; } });
  const b2 = createBridgeHandshake({ key: KEY, timers: t2, send: () => {}, onDone: () => {} });
  void b2; s2.start();
  const bridgeSent: string[] = [];
  const b3 = createBridgeHandshake({ key: KEY, timers: t2, send: (m) => bridgeSent.push(m), onDone: () => {} });
  b3.start(); b3.receive(sent[0]);
  assert.doesNotThrow(() => s2.receive(bridgeSent[0]));
  assert.ok(r2 && !r2.ok && r2.error.code === 'bad-state', 'a failed final send is not a success');

  // bridge answer fails to send
  const t3 = new FakeTimers(); let r3: HandshakeResult | undefined;
  const b4 = createBridgeHandshake({ key: KEY, timers: t3, send: () => { throw new Error('x'); }, onDone: (r) => { r3 = r; } });
  b4.start();
  assert.doesNotThrow(() => b4.receive(JSON.stringify({ hello: 'agent-durbar-mcp/1', nonceS: 'a'.repeat(64) })));
  assert.ok(r3 && !r3.ok && r3.error.code === 'bad-state');

  // a throwing onDone and a throwing random do not escape
  const t4 = new FakeTimers();
  const s4 = createServerHandshake({ key: KEY, timers: t4, send: () => {}, onDone: () => { throw new Error('listener'); } });
  s4.start(); assert.doesNotThrow(() => s4.receive('garbage')); assert.doesNotThrow(() => t4.advance(5000));
  const t5 = new FakeTimers(); let r5: HandshakeResult | undefined;
  const s5 = createServerHandshake({ key: KEY, timers: t5, send: () => {}, onDone: (r) => { r5 = r; }, random: () => { throw new Error('rng'); } });
  assert.doesNotThrow(() => s5.start());
  assert.ok(r5 && !r5.ok && r5.error.code === 'bad-state');
}

// bridge start() is idempotent: no second timer
{
  const t = new FakeTimers(); let res: HandshakeResult | undefined;
  const b = createBridgeHandshake({ key: KEY, timers: t, send: () => {}, onDone: (r) => { res = r; } });
  b.start(); b.start(); b.start();
  assert.strictEqual(t.pending, 1, 'one timer after three starts');
  t.advance(1500); b.start(); t.advance(500);
  assert.ok(res && !res.ok && res.error.code === 'timeout', 'the first timer still fires at 2 s; a later start did not extend it');
  b.start(); assert.strictEqual(t.pending, 0, 'no timer after done');
  const s = createServerHandshake({ key: KEY, timers: new FakeTimers(), send: () => {}, onDone: () => {} });
  s.start(); s.start();
}

// rotation invalidates the old key at the handshake
{
  const f = makeFs();
  const oldM = createKeyFile(deps(f));
  const newM = rotateKeyFile(deps(f));
  const p = pair(newM.key, oldM.key); p.bridge.start(); p.server.start(); p.pump();
  assert.ok(p.results.server && !p.results.server.ok, 'a bridge with the pre-rotation key is refused');
  const q = pair(newM.key, (readKeyFile(deps(f)) as { material: { key: Buffer } }).material.key); q.bridge.start(); q.server.start(); q.pump();
  assert.ok(q.results.server?.ok && q.results.bridge?.ok, 'a bridge that re-reads the file gets in');
}

// MACs are compared with crypto.timingSafeEqual (a wrong-length MAC never reaches it, so it cannot throw)
{
  const cr = require('crypto') as typeof crypto; // the real module object (the import above is an interop copy)
  const orig = cr.timingSafeEqual; let calls = 0;
  cr.timingSafeEqual = (a, b) => { calls++; return orig(a, b); };
  try {
    const p = pair(KEY, KEY); p.bridge.start(); p.server.start(); p.pump();
    assert.ok(p.results.server?.ok && p.results.bridge?.ok);
    assert.strictEqual(calls, 2, 'one comparison per side');
  } finally { cr.timingSafeEqual = orig; }
  const src = fsReal.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'mcp', 'auth.ts'), 'utf8');
  assert.ok(/timingSafeEqual\(/.test(src), 'source uses timingSafeEqual');
}

// real file system (nodeMcpFs) in a fresh temp folder, removed afterwards
{
  const win = process.platform === 'win32';
  const root = fsReal.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-auth-'));
  try {
    const dir = path.join(root, 'mcp');
    const file = path.join(dir, 'connection.json');
    const d: KeyFileDeps = { fs: nodeMcpFs(), mcpDir: dir, keyFile: file, uid: win ? null : (process.getuid ? process.getuid() : null), platform: process.platform };
    const m = createKeyFile(d);
    const r = readKeyFile(d);
    assert.ok(r.ok && r.material.key.equals(m.key) && r.material.pipeId === m.pipeId, 'real fs round trip');
    assert.deepStrictEqual(fsReal.readdirSync(dir), ['connection.json'], 'no temp file left');
    if (win) console.log('SKIP mode bits on win32');
    else {
      assert.strictEqual(fsReal.statSync(file).mode & 0o777, 0o600);
      assert.strictEqual(fsReal.statSync(dir).mode & 0o777, 0o700);
    }
    const m2 = rotateKeyFile(d);
    const r2 = readKeyFile(d);
    assert.ok(r2.ok && r2.material.key.equals(m2.key) && !r2.material.key.equals(m.key), 'rotated key replaces the old one');
    const p = pair(m2.key, m.key); p.bridge.start(); p.server.start(); p.pump();
    assert.ok(p.results.server && !p.results.server.ok, 'old key no longer verifies');
    if (!win) {
      fsReal.chmodSync(file, 0o644);
      const u = readKeyFile(d); assert.ok(!u.ok && u.reason === 'unsafe', 'real 0644 refused');
      fsReal.chmodSync(file, 0o600);
      const target = path.join(root, 'target.json');
      fsReal.renameSync(file, target);
      fsReal.symlinkSync(target, file);
      const l = readKeyFile(d); assert.ok(!l.ok && l.reason === 'unsafe', 'real symlink refused');
      fsReal.unlinkSync(file); fsReal.renameSync(target, file);
      // a symlink swapped in after the lstat is refused by O_NOFOLLOW (readFileSync would follow it)
      const real = nodeMcpFs();
      const racing: KeyFileDeps = { ...d, fs: { ...real, lstat: (p) => {
        const st = real.lstat(p);
        if (p === file) { fsReal.renameSync(file, target); fsReal.symlinkSync(target, file); }
        return st;
      } } };
      const race = readKeyFile(racing); assert.ok(!race.ok && race.reason === 'unsafe', 'real symlink swapped after lstat');
      fsReal.unlinkSync(file); fsReal.renameSync(target, file);
      // padded past the cap on the real fs
      const keep = fsReal.readFileSync(file, 'utf8');
      fsReal.writeFileSync(file, keep.trimEnd() + ' '.repeat(5000), { mode: 0o600 });
      const big = readKeyFile(d); assert.ok(!big.ok && big.reason === 'invalid', 'real oversize file refused');
      fsReal.writeFileSync(file, keep, { mode: 0o600 });
    } else console.log('SKIP chmod and symlink checks on win32');
    deleteKeyFile(d);
    const g = readKeyFile(d); assert.ok(!g.ok && g.reason === 'missing', 'deleted gives missing');
  } finally {
    fsReal.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!fsReal.existsSync(root), 'temp folder removed');
}

console.log('test-mcp-auth: ok');
