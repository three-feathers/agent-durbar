/**
 * Spec 102 T020, T021, FR-060..FR-062, FR-065, FR-083: the world store on disk. A temp folder; plain Node, no Electron, no network, no credits. `npm run test:worldstore`.
 * The network is sealed for the whole run (a thrower on `net`, `http`, `https`, `fetch`). Links are skipped with a note where the OS gives no right to make them (Windows).
 * Each invariant here has a planted mutant that this file catches (listed in the PR).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INSTALLED_NAME, KEY_RE, MAX_STORE_BYTES, SOURCE_ID_RE, WARN_WORLD_COUNT, WORLD_ID_RE, WorldStore, fromValidated } from '../src/main/worlds/store';
import type { FsLike, StoreInput } from '../src/main/worlds/store';
import { MANIFEST_NAME, PART_NAMES, validateWorldZip } from '../src/shared/worldpack';
import { sha256 } from '../src/shared/worldzip';
import { goodPack, hostileSet, rawFrom, rawZip, toStored, webp } from './fixtures/worlds/gen';

process.exitCode = 1;
// ---- the network is sealed: any call is a failure ----
const thrower = (what: string) => (): never => { throw new Error('NETWORK USED: ' + what); };
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http'), https = require('https'), net = require('net'); // the real module objects (an `import *` copy would be sealed)
/* eslint-enable @typescript-eslint/no-require-imports */
for (const [o, k] of [[http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'], [net, 'connect'], [net, 'createConnection']] as Array<[Record<string, unknown>, string]>) o[k] = thrower(k);
(globalThis as unknown as { fetch: unknown }).fetch = thrower('fetch');
{
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { net: { request: thrower('electron.net.request'), fetch: thrower('electron.net.fetch') } } } as unknown as NodeJS.Module;
}
const logged: string[] = [];
for (const k of ['log', 'warn', 'error', 'info', 'debug'] as const) { const real = console[k]; console[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); if (k === 'log') real(...a); }; }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string> };
const opts = { clean: T._tokens(), knownSets: ['office'] };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-worldstore-'));
let fresh = 0;
const win = process.platform === 'win32';
interface Env { dir: string; root: string; outside: string; store: WorldStore }
function env(fsx?: FsLike, ids?: () => string, maxBytes?: number): Env {
  const dir = path.join(base, 't' + fresh++);
  fs.mkdirSync(dir);
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  const root = path.join(dir, 'userData', 'worlds');
  let n = 0;
  return { dir, root, outside, store: new WorldStore(root, fsx ?? fs, ids ?? (() => (++n).toString(16).padStart(16, '0')), undefined, maxBytes) };
}
const tree = (d: string): string[] => fs.readdirSync(d, { recursive: true, encoding: 'utf8' }).map((s) => s.split(path.sep).join('/')).sort();
const linkOk = (target: string, at: string, type?: 'dir'): boolean => { try { fs.symlinkSync(target, at, type); return true; } catch { console.log('test-worldstore: no link rights here, a link case is skipped'); return false; } };

const GOOD = goodPack();
const goodInput = (over: Partial<StoreInput> = {}, version = 1, files = GOOD): StoreInput => ({
  origin: 'project', worldId: 'test-world', name: 'Test world', version, unfinished: false,
  files: Object.keys(files).map((name) => ({ name, data: files[name] })), ...over,
});
/** A pack of the world.json and one picture only: the store keeps what the validator passed, finished or not. */
const tiny = (n = 1): StoreInput => {
  const f = goodPack({}, ['wall.webp']);
  const m = JSON.parse(f['world.json'].toString());
  m.version = n;
  f['world.json'] = Buffer.from(JSON.stringify(m));
  return { origin: 'made', name: 'Mine ' + n, version: n, unfinished: true, files: Object.keys(f).map((name) => ({ name, data: f[name] })) };
};
const saved = (r: ReturnType<WorldStore['save']>): string => { assert.ok(r.ok, 'saved: ' + JSON.stringify(r)); return (r as { key: string }).key; };
/** A flipped byte inside a picture's padding: still a picture, no longer the recorded one. */
const flip = (file: string, at = -1): void => { const b = fs.readFileSync(file); b[at < 0 ? b.length + at : at] ^= 0x55; fs.writeFileSync(file, b); };

/** A fs that records every call (name and first path) and can fail the mutating ones from the nth, as a crash would (every later one fails too). */
function spyFs(failFrom = Infinity, dead = true): { fsx: FsLike; calls: Array<{ op: string; arg: string; flag?: unknown; mode?: unknown }>; ops: string[]; count(): number } {
  const calls: Array<{ op: string; arg: string; flag?: unknown; mode?: unknown }> = [];
  const ops: string[] = [];
  let n = 0;
  const mut = new Set(['mkdirSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'rmdirSync']);
  const fsx: Record<string, unknown> = { constants: fs.constants };
  for (const op of ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'closeSync', 'readdirSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'rmdirSync']) {
    fsx[op] = (...a: unknown[]) => {
      const o = a[2] && typeof a[2] === 'object' ? (a[2] as Record<string, unknown>) : {};
      calls.push({ op, arg: typeof a[0] === 'string' ? a[0] : '', flag: op === 'writeFileSync' ? o.flag : undefined, mode: op === 'writeFileSync' ? o.mode : undefined });
      if (mut.has(op)) { n++; ops.push(op); if (n >= failFrom && (dead || n === failFrom)) throw Object.assign(new Error('injected ' + op), { code: 'EIO' }); }
      return (fs as unknown as Record<string, (...x: unknown[]) => unknown>)[op](...a);
    };
  }
  return { fsx: fsx as unknown as FsLike, calls, ops, count: () => n };
}

try {
  // ---- 1. keys and names: a path only from a regex-checked key and a closed name ----
  {
    for (const k of ['p--spain', 'p--a_b-c', 'p--a--b', 's-a1b2--spain', 's-0--x', 'u-0123456789abcdef']) assert.ok(KEY_RE.test(k), 'a key: ' + k);
    const longId = 'a'.repeat(65);
    for (const k of ['', '.', '..', '../x', 'p--..', 'p--a/b', 'p--a\\b', 'p--a\0b', 'p--', 'p-spain', 'P--spain', 'p--Spain', 'com1', 'COM1', 'p--a.b', 'p--a ', ' p--a', 'p--' + longId, 's--x', 's-a-b--x', 's-' + 'a'.repeat(17) + '--x', 'u-xyz', 'u-0123456789ABCDEF', 'u-0123456789abcde', 'u-0123456789abcdef0', 'p--a\n', '.old-p--a', '.tmp-0123456789ab', 'p--a/../b']) assert.ok(!KEY_RE.test(k), 'not a key: ' + JSON.stringify(k));
    const { store, root } = env();
    saved(store.save(goodInput()));
    const s = spyFs();
    const probe = new WorldStore(root, s.fsx);
    const hostileKeys: unknown[] = ['', '..', '../x', 'p--a/b', 'p--a\\b', 'p--a\0b', 'COM1', 'com1', 'p--' + 'a'.repeat(65), '.', 'p--..', undefined, null, 5, {}, [], ['p--test-world'], { toString: () => 'p--test-world' }];
    for (const k of hostileKeys) {
      assert.deepStrictEqual(probe.part(k, 'wall.webp'), { ok: false, reason: 'unknown' }, 'part: hostile key');
      assert.strictEqual(probe.remove(k).ok, false, 'remove: hostile key');
      assert.strictEqual(probe.verify(k), false);
      if (typeof k !== 'string' || !SOURCE_ID_RE.test(k)) assert.strictEqual(probe.save({ ...goodInput(), origin: 'source', sourceId: k as string, worldId: 'test-world' }).ok, false, 'save: hostile source id');
      if (typeof k !== 'string' || !WORLD_ID_RE.test(k)) assert.strictEqual(probe.save({ ...goodInput(), worldId: k as string }).ok, false, 'save: hostile world id');
    }
    assert.strictEqual(s.calls.length, 0, 'a hostile key makes no path: the file system was not asked anything (' + s.calls.map((c) => c.op + ' ' + c.arg).slice(0, 3).join('; ') + ')');
    for (const n of ['', '..', '../wall.webp', 'wall.webp/', 'a/../wall.webp', 'wall.webp\0', 'wall.webp\0.txt', 'COM1', 'NUL', 'world.json', 'installed.json', 'WALL.WEBP', 'wall.webp ', 'x'.repeat(300), undefined, null, 7, {}, ['wall.webp']]) {
      assert.deepStrictEqual(probe.part('p--test-world', n), { ok: false, reason: 'unknown' }, 'part: hostile name ' + JSON.stringify(n));
    }
    // every name the closed list gives is answered; nothing outside it
    assert.strictEqual(s.calls.length, 0, 'a hostile part name makes no path either');
    assert.ok(PART_NAMES.every((n) => !/[\\/\0]/.test(n)));
    // the file system calls of a good read stay inside <root>/<key>
    const good = probe.part('p--test-world', 'wall.webp');
    assert.ok(good.ok && good.mime === 'image/webp');
    assert.ok(s.calls.length > 0 && s.calls.every((c) => c.arg === '' || c.arg === root || c.arg.startsWith(path.join(root, 'p--test-world') + path.sep) || c.arg === path.join(root, 'p--test-world')), 'only the key folder was touched');
  }

  // ---- 2. save, list, part ----
  {
    const s = spyFs();
    const { store, root } = env(s.fsx);
    assert.deepStrictEqual(store.list(), [], 'no root yet: an empty list');
    const key = saved(store.save(goodInput({ packSha256: sha256(Buffer.from('zip')) })));
    assert.strictEqual(key, 'p--test-world');
    for (const c of s.calls.filter((x) => x.op === 'writeFileSync')) { assert.strictEqual(c.flag, 'wx', 'every file is written with wx'); assert.strictEqual(c.mode, 0o600, 'owner-only mode'); }
    assert.deepStrictEqual(tree(root), [key, ...[...Object.keys(GOOD), INSTALLED_NAME].sort().map((n) => key + '/' + n)].sort(), 'the folder holds the pack and installed.json, no temp, no dot folder');
    const doc = JSON.parse(fs.readFileSync(path.join(root, key, INSTALLED_NAME), 'utf8'));
    assert.deepStrictEqual(Object.keys(doc).sort(), ['date', 'files', 'key', 'name', 'origin', 'packSha256', 'size', 'state', 'v', 'version', 'worldId'], 'FR-060: the record has these fields and no others');
    assert.ok(!/description|licence|prompt|synthetic|userData|tmp/i.test(JSON.stringify(doc)), 'no description, prompt or path in the record');
    for (const n of Object.keys(GOOD)) assert.strictEqual(doc.files[n].sha256, sha256(GOOD[n]), 'world.json and every part are hashed: ' + n);
    assert.ok(doc.files[MANIFEST_NAME], 'world.json is stored and hashed');
    if (!win) for (const n of Object.keys(doc.files)) assert.strictEqual(fs.statSync(path.join(root, key, n)).mode & 0o777, 0o600, 'mode 0600 on disk');
    const [e] = store.list();
    assert.deepStrictEqual({ k: e.key, n: e.name, o: e.origin, s: e.state, u: e.unfinished, size: e.size }, { k: key, n: 'Test world', o: 'project', s: 'ok', u: false, size: doc.size });
    assert.ok(!e.parts.includes(MANIFEST_NAME) && e.parts.length === PART_NAMES.length, 'the list names the parts, not world.json');
    const p = store.part(key, 'fx-library.webp');
    assert.ok(p.ok && p.bytes.equals(GOOD['fx-library.webp']), 'the bytes come back');
    assert.deepStrictEqual(store.part(key, 'desk.webp').ok, true);
    assert.ok(store.verify(key), 'the full check passes');
    // a PNG part is served as PNG
    const png = (await_png());
    const f2 = goodPack({}, ['wall.webp']);
    f2['wall.webp'] = png;
    const m2 = JSON.parse(f2['world.json'].toString());
    f2['world.json'] = Buffer.from(JSON.stringify(m2));
    const k2 = saved(store.save({ origin: 'uploaded', name: 'Png', version: 1, unfinished: true, files: Object.keys(f2).map((name) => ({ name, data: f2[name] })) }));
    const pr = store.part(k2, 'wall.webp');
    assert.ok(pr.ok && pr.mime === 'image/png', 'PNG is served as image/png');
    assert.strictEqual(store.list().find((x) => x.key === k2)?.state, 'unfinished', 'unfinished is kept');
    assert.match(k2, /^u-[0-9a-f]{16}$/);
  }

  // ---- 3. hash the bytes written, not the caller's ----
  {
    const clones = Object.fromEntries(Object.keys(GOOD).map((n) => [n, Buffer.from(GOOD[n])]));
    const input = goodInput({}, 1, clones);
    const originals = input.files.map((f) => f.data as Buffer);
    const fsx = { ...(fs as unknown as Record<string, unknown>), constants: fs.constants } as unknown as FsLike;
    const realWrite = fs.writeFileSync;
    let mutated = 0;
    (fsx as unknown as Record<string, unknown>).writeFileSync = (...a: unknown[]) => {
      for (const b of originals) b[b.length - 1] = (b[b.length - 1] + 1) & 0xff; // the caller changes its own buffers while the save is writing
      mutated++;
      return (realWrite as unknown as (...x: unknown[]) => unknown)(...a);
    };
    const { store, root } = env(fsx);
    const key = saved(store.save(input));
    assert.ok(mutated > 10);
    const doc = JSON.parse(fs.readFileSync(path.join(root, key, INSTALLED_NAME), 'utf8'));
    for (const n of Object.keys(GOOD)) assert.strictEqual(sha256(fs.readFileSync(path.join(root, key, n))), doc.files[n].sha256, 'recorded hash = hash of the bytes on disk: ' + n);
    assert.ok(store.verify(key));
  }

  // ---- 4. what is refused before anything is written ----
  {
    const { store, root, dir } = env();
    const bad = (i: StoreInput, what: string): void => { const r = store.save(i); assert.ok(!r.ok && r.code === 'bad', 'refused: ' + what + ' ' + JSON.stringify(r)); };
    const withFile = (name: string, data: Buffer): StoreInput => goodInput({ files: [...goodInput().files, { name, data }] });
    bad(withFile('../x', Buffer.from('x')), 'a ../ name');
    bad(withFile('a/../b', Buffer.from('x')), 'a/../b');
    bad(withFile('..\\x', Buffer.from('x')), 'a backslash');
    bad(withFile('x.js', Buffer.from('x')), 'a name off the list');
    bad(withFile('installed.json', Buffer.from('{}')), 'a forged installed.json');
    bad(withFile('wall.webp', GOOD['wall.webp']), 'a duplicate name');
    bad(goodInput({ files: goodInput().files.filter((f) => f.name !== MANIFEST_NAME) }), 'no world.json');
    bad(goodInput({ files: [{ name: MANIFEST_NAME, data: GOOD[MANIFEST_NAME] }, { name: 'wall.webp', data: Buffer.from('<svg onload=alert(1)>') }] }), 'a part that is not a picture');
    bad(goodInput({ files: [{ name: MANIFEST_NAME, data: GOOD[MANIFEST_NAME] }, { name: 'wall.webp', data: webp(100, 200, 200 * 1024) }] }), 'a part over its cap');
    bad(goodInput({ files: [{ name: MANIFEST_NAME, data: Buffer.alloc(70 * 1024, 32) }] }), 'a world.json over 64 KB');
    bad(goodInput({ files: [{ name: MANIFEST_NAME, data: GOOD[MANIFEST_NAME] }, { name: 'wall.webp', data: Buffer.alloc(0) }] }), 'an empty part');
    bad(goodInput({ origin: 'nowhere' as never }), 'an origin off the list');
    bad(goodInput({ origin: 'imported', worldId: 'x' }), 'a world id for an own world');
    bad(goodInput({ origin: 'source' }), 'a source without its id');
    bad(goodInput({ worldId: undefined }), 'a project without its id');
    bad(goodInput({ version: 1.5 }), 'a float version');
    bad(goodInput({ version: -1 }), 'a negative version');
    bad(goodInput({ name: '' }), 'an empty name');
    bad(goodInput({ name: 'a<b' }), 'markup in a name');
    bad(goodInput({ name: 'x'.repeat(41) }), 'a long name');
    bad(goodInput({ name: 'a\u202eb' }), 'a bidi control in a name');
    bad(goodInput({ packSha256: 'abc' }), 'a bad pack hash');
    bad(goodInput({ unfinished: 'no' as never }), 'a non-boolean flag');
    bad({ ...goodInput(), files: 'x' as never }, 'files not a list');
    bad({ ...goodInput(), files: [{ name: MANIFEST_NAME, data: 'text' as never }] }, 'data not bytes');
    assert.ok(!fs.existsSync(root), 'nothing was written for any of them (not even the root)');
    assert.deepStrictEqual(tree(dir), ['outside', 'outside/keep.txt']);
  }

  // ---- 5. zip slip: closed-list names, in memory ----
  {
    const { store, root, dir } = env();
    const ents = rawFrom(GOOD);
    for (const evil of ['../x', 'a/../b', '..\\x', '/etc/x', 'C:/x', 'wall.webp/../../x']) {
      const z = rawZip([{ name: evil, data: Buffer.from('boo') }, ...ents]);
      const r = validateWorldZip(z, opts);
      assert.strictEqual(fromValidated(z, r, { origin: 'imported' }), null, 'the adapter refuses a zip the validator refused: ' + evil);
      // a forged "ok" result that names the evil entry is refused too
      const forged = { ...validateWorldZip(toStored(GOOD), opts) };
      const f2 = { ...forged, parts: [...forged.parts, evil] };
      assert.strictEqual(fromValidated(toStored(GOOD), f2, { origin: 'imported' }), null, 'a forged result naming ' + evil + ' gives nothing');
    }
    assert.ok(hostileSet().length >= 30);
    for (const h of hostileSet()) {
      const r = validateWorldZip(h.zip, opts);
      const inp = fromValidated(h.zip, r, { origin: 'imported' });
      if (!r.ok) assert.strictEqual(inp, null, 'hostile ' + h.id + ' gives no input');
      else if (inp) assert.ok(inp.files.every((f) => f.name === MANIFEST_NAME || PART_NAMES.includes(f.name)), 'only closed names from ' + h.id);
    }
    // the good one: names from the list only, and the context's world id must be the pack's own
    const zip = toStored(GOOD), res = validateWorldZip(zip, opts);
    assert.ok(res.ok, 'the good pack validates');
    assert.strictEqual(fromValidated(zip, res, { origin: 'project', worldId: 'other-world' }), null, 'a catalogue id that is not the pack id is refused');
    assert.strictEqual(fromValidated(zip, { ...res, ok: false }, { origin: 'imported' }), null);
    assert.strictEqual(fromValidated(zip, { ...res, manifest: undefined }, { origin: 'imported' }), null);
    const inp = fromValidated(zip, res, { origin: 'project', worldId: 'test-world', packSha256: sha256(zip) });
    assert.ok(inp && inp.files.length === Object.keys(GOOD).length && inp.name === 'Test world' && !inp.unfinished === (res.unfinished.length === 0));
    const key = saved(store.save(inp as StoreInput));
    assert.ok(store.verify(key));
    assert.deepStrictEqual(tree(dir).filter((x) => !x.startsWith('userData') && x !== 'userData'), ['outside', 'outside/keep.txt'], 'nothing outside the store');
    assert.ok(tree(root).every((x) => x === key || x.startsWith(key + '/')));
  }

  // ---- 6. links, hard links, non-regular files ----
  {
    // a link in place of the root
    const a = env();
    fs.mkdirSync(path.dirname(a.root), { recursive: true });
    if (linkOk(a.outside, a.root, 'dir')) {
      assert.deepStrictEqual(a.store.list(), [], 'a link at the root is not used');
      assert.ok(!a.store.save(goodInput()).ok, 'a save through a root link is refused');
      assert.deepStrictEqual(fs.readdirSync(a.outside), ['keep.txt'], 'nothing written through the link');
    }
    // a link at a world folder
    const b = env();
    saved(b.store.save(goodInput()));
    const kdir = path.join(b.root, 'p--test-world');
    fs.rmSync(kdir, { recursive: true });
    fs.mkdirSync(path.join(b.outside, 'fake'));
    fs.writeFileSync(path.join(b.outside, 'fake', 'wall.webp'), GOOD['wall.webp']);
    if (linkOk(path.join(b.outside, 'fake'), kdir, 'dir')) {
      const e = b.store.list().find((x) => x.key === 'p--test-world');
      assert.strictEqual(e?.state, 'damaged', 'a link where a world folder should be is damaged');
      assert.deepStrictEqual(b.store.part('p--test-world', 'wall.webp'), { ok: false, reason: 'damaged' });
      assert.ok(!b.store.save(goodInput()).ok, 'a save does not write through the link (no replace)');
      assert.ok(!b.store.save(goodInput(), { replace: true }).ok || fs.readdirSync(path.join(b.outside, 'fake')).join() === 'wall.webp', 'a replace never writes into the link target');
      assert.deepStrictEqual(fs.readdirSync(path.join(b.outside, 'fake')), ['wall.webp'], 'nothing added to the link target');
    }
    // remove on a link removes the link, never the target
    const c = env();
    saved(c.store.save(goodInput()));
    const cdir = path.join(c.root, 'p--test-world');
    fs.rmSync(cdir, { recursive: true });
    if (linkOk(c.outside, cdir, 'dir')) {
      assert.ok(c.store.remove('p--test-world').ok);
      assert.ok(!fs.existsSync(cdir) && fs.readFileSync(path.join(c.outside, 'keep.txt'), 'utf8') === 'keep', 'the link is gone, its target is intact');
    }
    // a link as installed.json, and as a part
    const d = env();
    saved(d.store.save(goodInput()));
    const inst = path.join(d.root, 'p--test-world', INSTALLED_NAME);
    const realInst = fs.readFileSync(inst);
    fs.writeFileSync(path.join(d.outside, 'inst.json'), realInst);
    fs.rmSync(inst);
    if (linkOk(path.join(d.outside, 'inst.json'), inst)) {
      assert.strictEqual(d.store.list()[0].state, 'damaged', 'a linked installed.json is damaged');
      assert.deepStrictEqual(d.store.part('p--test-world', 'wall.webp'), { ok: false, reason: 'damaged' });
      assert.ok(!d.store.verify('p--test-world'));
    }
    const e2 = env();
    saved(e2.store.save(goodInput()));
    const part = path.join(e2.root, 'p--test-world', 'wall.webp');
    fs.writeFileSync(path.join(e2.outside, 'wall.webp'), GOOD['wall.webp']);
    fs.rmSync(part);
    if (linkOk(path.join(e2.outside, 'wall.webp'), part)) {
      assert.deepStrictEqual(e2.store.part('p--test-world', 'wall.webp'), { ok: false, reason: 'damaged' }, 'a linked part, same bytes, is refused');
      assert.strictEqual(e2.store.list()[0].state, 'damaged');
    }
    // a hard link to a part: nlink 2 is refused
    const f = env();
    saved(f.store.save(goodInput()));
    const hp = path.join(f.root, 'p--test-world', 'floor.webp');
    let hard = true;
    try { fs.linkSync(hp, path.join(f.outside, 'floor-twin.webp')); } catch { hard = false; console.log('test-worldstore: no hard links here, skipped'); }
    if (hard) {
      assert.deepStrictEqual(f.store.part('p--test-world', 'floor.webp'), { ok: false, reason: 'damaged' }, 'a hard-linked part is refused (nlink > 1)');
      assert.strictEqual(f.store.list()[0].state, 'damaged');
      assert.ok(!f.store.verify('p--test-world'));
    }
    // a directory where a file should be, a FIFO where a file should be
    const g = env();
    saved(g.store.save(goodInput()));
    const gp = path.join(g.root, 'p--test-world', 'wall.webp');
    fs.rmSync(gp);
    fs.mkdirSync(gp);
    assert.deepStrictEqual(g.store.part('p--test-world', 'wall.webp'), { ok: false, reason: 'damaged' }, 'a folder in place of a part');
    if (!win) {
      const h2 = env();
      saved(h2.store.save(goodInput()));
      const fp = path.join(h2.root, 'p--test-world', 'wall.webp');
      fs.rmSync(fp);
      try { require('child_process').execFileSync('mkfifo', [fp]); assert.deepStrictEqual(h2.store.part('p--test-world', 'wall.webp'), { ok: false, reason: 'damaged' }, 'a FIFO is not waited on'); } catch (err) { if (err instanceof assert.AssertionError) throw err; console.log('test-worldstore: no mkfifo, skipped'); }
    }
  }

  // ---- 7. huge files: stat size cap before a read, and at most cap + 1 bytes read ----
  {
    const s = spyFs();
    const { store, root } = env(s.fsx);
    const key = saved(store.save(goodInput()));
    const wall = path.join(root, key, 'wall.webp');
    fs.truncateSync(wall, 5 * 1024 * 1024 * 1024); // sparse: no disk, a huge size
    s.calls.length = 0;
    assert.deepStrictEqual(store.part(key, 'wall.webp'), { ok: false, reason: 'damaged' }, 'a sparse 5 GB file is refused');
    assert.ok(!s.calls.some((c) => c.op === 'openSync' && c.arg === wall), 'by its size: it was not even opened');
    assert.strictEqual(store.list()[0].state, 'damaged');
    // a file that grew after the stat: the size is lied about, the read is still bounded
    const e2 = (() => {
      const dir = path.join(base, 'lie' + fresh++);
      fs.mkdirSync(dir);
      const root2 = path.join(dir, 'w');
      const reads: number[] = [];
      const fsx = { ...(fs as unknown as Record<string, unknown>), constants: fs.constants } as Record<string, unknown>;
      let lie = '';
      const fdPath = new Map<number, string>();
      const fake = (st: fs.Stats, size: number): fs.Stats => new Proxy(st, { get: (t, k) => (k === 'size' ? size : typeof (t as never)[k] === 'function' ? ((t as never)[k] as () => unknown).bind(t) : (t as never)[k]) });
      fsx.openSync = (p: string, f: number) => { const fd = fs.openSync(p, f); fdPath.set(fd, p); return fd; };
      fsx.lstatSync = (p: string, o?: unknown) => { const st = fs.lstatSync(p, o as never) as fs.Stats; return p === lie ? fake(st, recorded) : st; };
      fsx.fstatSync = (fd: number) => { const st = fs.fstatSync(fd); return lie && fdPath.get(fd) === lie ? fake(st, recorded) : st; };
      fsx.readSync = (fd: number, buf: Buffer, off: number, len: number, pos: number) => { if (lie && fdPath.get(fd) === lie) reads.push(len); return fs.readSync(fd, buf, off, len, pos); };
      let recorded = 0;
      const st2 = new WorldStore(root2, fsx as unknown as FsLike);
      const k2 = saved(st2.save(goodInput()));
      const target = path.join(root2, k2, 'wall.webp');
      recorded = fs.statSync(target).size;
      fs.writeFileSync(target, Buffer.concat([GOOD['wall.webp'], Buffer.alloc(1024 * 1024, 7)]));
      lie = target;
      reads.length = 0;
      assert.deepStrictEqual(st2.part(k2, 'wall.webp'), { ok: false, reason: 'damaged' }, 'a file longer than recorded is refused');
      return { reads, recorded };
    })();
    assert.ok(e2.reads.length > 0 && e2.reads.reduce((a, b) => a + b, 0) <= e2.recorded + 1, 'at most cap + 1 bytes were asked for (' + e2.reads.reduce((a, b) => a + b, 0) + ' vs ' + (e2.recorded + 1) + ')');
    // an installed.json over its cap is not read
    const f = env();
    const k3 = saved(f.store.save(goodInput()));
    fs.writeFileSync(path.join(f.root, k3, INSTALLED_NAME), Buffer.alloc(100 * 1024, 32));
    assert.strictEqual(f.store.list()[0].state, 'damaged', 'an oversize installed.json is damaged');
  }

  // ---- 8. collisions: no overwrite; replace on a fs that refuses rename over a folder ----
  {
    const s = spyFs();
    const { store, root } = env(s.fsx);
    const key = saved(store.save(goodInput({}, 1)));
    const before = fs.readFileSync(path.join(root, key, INSTALLED_NAME));
    const r = store.save(goodInput({}, 2));
    assert.ok(!r.ok && r.code === 'exists', 'a second save of the same key is refused');
    assert.ok(fs.readFileSync(path.join(root, key, INSTALLED_NAME)).equals(before), 'the folder is untouched');
    assert.deepStrictEqual(readdirNoDots(root), [key]);
    assert.deepStrictEqual(fs.readdirSync(root), [key], 'no temp left behind by the refusal');
    // an own id that collides with an existing folder is refused, not overwritten
    const o = env(undefined, () => '00000000000000aa');
    const ok1 = saved(o.store.save(tiny(1)));
    const again = o.store.save(tiny(2));
    assert.ok(!again.ok && again.code === 'exists', 'a colliding own id is refused');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(o.root, ok1, INSTALLED_NAME), 'utf8')).version, 1);
    // replace where rename over an existing folder fails (Windows)
    const fsx = { ...(fs as unknown as Record<string, unknown>), constants: fs.constants } as Record<string, unknown>;
    fsx.renameSync = (a: string, b: string) => { if (fs.existsSync(b)) throw Object.assign(new Error('rename over a folder'), { code: 'EPERM' }); return fs.renameSync(a, b); };
    const w = env(fsx as unknown as FsLike);
    const wk = saved(w.store.save(goodInput({}, 1)));
    const wr = w.store.save(goodInput({}, 2), { replace: true });
    assert.ok(wr.ok, 'replace works where rename over a folder is refused: ' + JSON.stringify(wr));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w.root, wk, INSTALLED_NAME), 'utf8')).version, 2, 'the new version is in place');
    assert.deepStrictEqual(fs.readdirSync(w.root), [wk], 'the old folder and the temp are gone');
    assert.ok(w.store.verify(wk));
    assert.strictEqual(w.store.list()[0].version, 2);
    // a world that was damaged is whole again after a replace
    flip(path.join(w.root, wk, 'floor.webp'));
    assert.strictEqual(w.store.part(wk, 'floor.webp').ok, false);
    assert.strictEqual(w.store.list()[0].state, 'damaged');
    assert.ok(w.store.save(goodInput({}, 3), { replace: true }).ok);
    assert.strictEqual(w.store.list()[0].state, 'ok', 'a good replace clears the damaged mark');
  }

  // ---- 9. crash: a failing fs at each step; start repair keeps the complete one ----
  {
    const dry = (replace: boolean): string[] => {
      const s = spyFs();
      const e = env(s.fsx);
      if (replace) saved(e.store.save(goodInput({}, 1)));
      s.ops.length = 0;
      saved(e.store.save(goodInput({}, 2), { replace }));
      return s.ops.slice();
    };
    const fresh1 = dry(false), repl = dry(true);
    assert.ok(fresh1.length > 25 && repl.length > fresh1.length, 'the steps are counted: ' + fresh1.length + ' and ' + repl.length);
    const renames = repl.map((o, i) => (o === 'renameSync' ? i + 1 : 0)).filter(Boolean);
    assert.strictEqual(renames.length, 2, 'a replace is two renames');
    const seen = new Set<string>();
    for (const replace of [false, true]) {
      const total = (replace ? repl : fresh1).length;
      for (let at = 1; at <= total; at++) {
        const s = spyFs();
        const e = env(s.fsx);
        if (replace) saved(e.store.save(goodInput({}, 1)));
        failingFrom(e.root, at).store.save(goodInput({}, 2), { replace });
        // a new process: a healthy store over the same folder
        const after = new WorldStore(e.root);
        const mid = fs.existsSync(e.root) ? fs.readdirSync(e.root) : [];
        after.repair();
        const names = fs.existsSync(e.root) ? fs.readdirSync(e.root) : [];
        assert.ok(names.every((n) => n === 'p--test-world'), `crash at ${at}/${total} (replace ${replace}): leftovers swept, found ${names.join(',')} (before repair: ${mid.join(',')})`);
        if (names.length) {
          assert.ok(after.verify('p--test-world'), `crash at ${at}/${total}: what is left is complete`);
          const v = after.list()[0].version;
          assert.ok(v === 2 || (replace && v === 1), `crash at ${at}/${total}: version ${v}`);
          seen.add(`${replace}:${v}`);
        } else assert.ok(!replace, `crash at ${at}/${total}: a replace never loses the world`);
        if (replace) assert.ok(names.length === 1, 'a replace keeps one complete world');
      }
    }
    assert.ok(seen.has('true:1') && seen.has('true:2'), 'both outcomes were reached: ' + [...seen].join(' '));
    // the named steps: temp written, old to dot, new in, old deleted
    const e = spyFs();
    const st = env(e.fsx);
    saved(st.store.save(goodInput({}, 1)));
    // crash exactly at the second rename: old in a dot folder, new in the temp one, nothing in place
    const nth2 = (() => { const s = spyFs(); const q = env(s.fsx); saved(q.store.save(goodInput({}, 1))); s.ops.length = 0; saved(q.store.save(goodInput({}, 2), { replace: true })); return s.ops.map((o, i) => (o === 'renameSync' ? i + 1 : 0)).filter(Boolean); })();
    const mid = env();
    saved(mid.store.save(goodInput({}, 1)));
    failingFrom(mid.root, nth2[1]).store.save(goodInput({}, 2), { replace: true });
    assert.ok(fs.readdirSync(mid.root).some((n) => n.startsWith('.old-')) && fs.readdirSync(mid.root).some((n) => n.startsWith('.tmp-')) && !fs.existsSync(path.join(mid.root, 'p--test-world')), 'between the renames: old and new are in dot folders');
    const reopened = new WorldStore(mid.root);
    assert.strictEqual(reopened.list().length, 0, 'before repair the world is not listed');
    reopened.repair();
    assert.strictEqual(reopened.list()[0].version, 1, 'repair brings the complete old one back');
    // crash right after the second rename: new in place, old still beside it
    const after2 = env();
    saved(after2.store.save(goodInput({}, 1)));
    failingFrom(after2.root, nth2[1] + 1).store.save(goodInput({}, 2), { replace: true });
    assert.ok(fs.readdirSync(after2.root).some((n) => n.startsWith('.old-')) && fs.existsSync(path.join(after2.root, 'p--test-world')), 'new in, old not yet deleted');
    const r2 = new WorldStore(after2.root);
    r2.repair();
    assert.deepStrictEqual(fs.readdirSync(after2.root), ['p--test-world']);
    assert.strictEqual(r2.list()[0].version, 2, 'repair keeps the complete new one and deletes the old');
    // a transient failure of the second rename (not a crash): the old world is put back at once
    const soft = env();
    saved(soft.store.save(goodInput({}, 1)));
    const sf = spyFs(nth2[1], false);
    const sw = new WorldStore(soft.root, sf.fsx);
    sf.ops.length = 0;
    assert.ok(!sw.save(goodInput({}, 2), { replace: true }).ok, 'the save fails');
    assert.deepStrictEqual(fs.readdirSync(soft.root), ['p--test-world'], 'old world back, temp removed');
    assert.strictEqual(sw.list()[0].version, 1);
    // neither complete: nothing is deleted on a guess
    const nc = env();
    saved(nc.store.save(goodInput({}, 1)));
    fs.renameSync(path.join(nc.root, 'p--test-world'), path.join(nc.root, '.old-p--test-world'));
    flip(path.join(nc.root, '.old-p--test-world', 'wall.webp'));
    fs.mkdirSync(path.join(nc.root, 'p--test-world'));
    const ncs = new WorldStore(nc.root);
    ncs.repair();
    assert.ok(fs.existsSync(path.join(nc.root, '.old-p--test-world')) && fs.existsSync(path.join(nc.root, 'p--test-world')), 'two broken folders are both left for a person');
    assert.ok(!ncs.save(goodInput({}, 2), { replace: true }).ok, 'and a replace refuses to go on over them');
    assert.ok(ncs.remove('p--test-world').ok && fs.readdirSync(nc.root).length === 0, 'Remove clears both');
  }

  // ---- 10. leftovers swept at start with lstat; links never followed ----
  {
    const { store, root, outside } = env();
    saved(store.save(goodInput()));
    const t1 = path.join(root, '.tmp-aaaaaaaaaaaa');
    fs.mkdirSync(t1);
    fs.writeFileSync(path.join(t1, 'wall.webp'), 'half');
    let ok = true;
    const t2 = path.join(root, '.tmp-bbbbbbbbbbbb');
    fs.mkdirSync(t2);
    ok = linkOk(outside, path.join(t2, 'out'), 'dir') && ok;
    const t3 = path.join(root, '.tmp-cccccccccccc');
    ok = linkOk(outside, t3, 'dir') && ok;
    fs.writeFileSync(path.join(root, '.DS_Store'), 'x');
    fs.mkdirSync(path.join(root, '.tmp-notours'));
    store.repair();
    assert.ok(!fs.existsSync(t1) && !fs.existsSync(t2) && !fs.existsSync(t3), 'temp folders and a temp link are gone');
    assert.strictEqual(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep', 'a link in temp is not followed' + (ok ? '' : ' (skipped)'));
    assert.deepStrictEqual(fs.readdirSync(outside), ['keep.txt']);
    assert.ok(fs.existsSync(path.join(root, '.DS_Store')) && fs.existsSync(path.join(root, '.tmp-notours')), 'names that are not ours are left alone');
    assert.strictEqual(store.list().length, 1);
    // a failed write leaves no temp folder
    const s = spyFs();
    const f = env(s.fsx);
    const failingWrite = { ...(s.fsx as unknown as Record<string, unknown>) } as Record<string, unknown>;
    let n = 0;
    failingWrite.writeFileSync = (...a: unknown[]) => { if (++n === 5) throw new Error('disk full'); return (s.fsx.writeFileSync as unknown as (...x: unknown[]) => unknown)(...a); };
    const fw = new WorldStore(f.root, failingWrite as unknown as FsLike);
    const r = fw.save(goodInput());
    assert.ok(!r.ok && r.code === 'failed' && !/disk full|userData|worlds/.test(r.error), 'a plain sentence, no path: ' + (r.ok ? '' : r.error));
    assert.deepStrictEqual(fs.readdirSync(f.root), [], 'no half-written folder stays');
  }

  // ---- 11. T021: re-check at load, damaged, one byte ----
  {
    const s = spyFs();
    const { store, root } = env(s.fsx);
    const key = saved(store.save(goodInput()));
    const dir = path.join(root, key);
    assert.ok(store.part(key, 'wall.webp').ok);
    for (const n of PART_NAMES) {
      const c = env();
      const k = saved(c.store.save(goodInput()));
      flip(path.join(c.root, k, n));
      assert.deepStrictEqual(c.store.part(k, n), { ok: false, reason: 'damaged' }, 'one byte changed in ' + n + ': Damaged, no bytes');
      assert.strictEqual(c.store.list()[0].state, 'damaged');
      assert.strictEqual(c.store.verify(k), false);
    }
    // the same byte count, different content, in another part: that part is fine, the full check finds it
    flip(path.join(dir, 'desk.webp'));
    assert.ok(store.part(key, 'wall.webp').ok, 'the other parts still serve');
    assert.strictEqual(store.part(key, 'desk.webp').ok, false, 'the flipped part is refused');
    assert.strictEqual(store.list()[0].state, 'damaged', 'one bad part makes the world Damaged');
    assert.ok(!store.verify(key));
    // truncated, extended, deleted, extra file, world.json changed
    const cases: Array<[string, (d: string) => void, (store: WorldStore, k: string) => void]> = [
      ['truncated part', (d) => fs.truncateSync(path.join(d, 'wall.webp'), 40), (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['extended part', (d) => fs.appendFileSync(path.join(d, 'wall.webp'), 'x'), (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['deleted part', (d) => fs.rmSync(path.join(d, 'wall.webp')), (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['extra file', (d) => fs.writeFileSync(path.join(d, 'evil.js'), 'x'), (st, k) => assert.strictEqual(st.verify(k), false)],
      ['world.json changed', (d) => flip(path.join(d, MANIFEST_NAME), 20), (st, k) => assert.strictEqual(st.verify(k), false)],
      ['installed.json not JSON', (d) => fs.writeFileSync(path.join(d, INSTALLED_NAME), '{nope'), (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['installed.json empty', (d) => fs.writeFileSync(path.join(d, INSTALLED_NAME), ''), (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['installed.json with a path', (d) => { const j = JSON.parse(fs.readFileSync(path.join(d, INSTALLED_NAME), 'utf8')); j.files['../../x'] = j.files['wall.webp']; fs.writeFileSync(path.join(d, INSTALLED_NAME), JSON.stringify(j)); }, (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['installed.json with an extra field', (d) => { const j = JSON.parse(fs.readFileSync(path.join(d, INSTALLED_NAME), 'utf8')); j.path = '/etc'; fs.writeFileSync(path.join(d, INSTALLED_NAME), JSON.stringify(j)); }, (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['installed.json with a wrong size total', (d) => { const j = JSON.parse(fs.readFileSync(path.join(d, INSTALLED_NAME), 'utf8')); j.size += 1; fs.writeFileSync(path.join(d, INSTALLED_NAME), JSON.stringify(j)); }, (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
      ['installed.json with __proto__', (d) => { fs.writeFileSync(path.join(d, INSTALLED_NAME), fs.readFileSync(path.join(d, INSTALLED_NAME), 'utf8').replace('"v": 1', '"__proto__": {"x":1}, "v": 1')); }, (st, k) => assert.strictEqual(st.part(k, 'wall.webp').ok, false)],
    ];
    for (const [what, mutate, check] of cases) {
      const c = env();
      const k = saved(c.store.save(goodInput()));
      mutate(path.join(c.root, k));
      check(c.store, k);
      assert.strictEqual(c.store.list()[0].state, 'damaged', what + ': listed as damaged');
      assert.deepStrictEqual(c.store.list()[0].key, k, 'and can be removed');
      assert.ok(c.store.remove(k).ok && !fs.existsSync(path.join(c.root, k)), what + ': removed');
    }
    // another world's installed.json copied in: its key is not this folder's
    const two = env();
    const a = saved(two.store.save(goodInput({ worldId: 'one', name: 'One' }, 1, goodPack({ id: 'one' }))));
    const b = saved(two.store.save(goodInput({ worldId: 'two', name: 'Two' }, 1, goodPack({ id: 'two' }))));
    fs.copyFileSync(path.join(two.root, a, INSTALLED_NAME), path.join(two.root, b, INSTALLED_NAME));
    assert.strictEqual(two.store.part(b, 'wall.webp').ok, false, 'a record that names another key is refused');
  }

  // ---- 12. revocation (FR-083) ----
  {
    const s = spyFs();
    const { store, root } = env(s.fsx);
    const zipHash = sha256(Buffer.from('the zip'));
    const k1 = saved(store.save(goodInput({ packSha256: zipHash })));
    const k2 = saved(store.save(tiny(2)));
    store.setRevoked(['nonsense', 'x'.repeat(64), sha256(Buffer.from('other'))]);
    assert.ok(store.list().every((e) => e.state !== 'revoked'), 'an unrelated hash revokes nothing');
    store.setRevoked([zipHash]);
    assert.strictEqual(store.list().find((e) => e.key === k1)?.state, 'revoked');
    assert.strictEqual(store.list().find((e) => e.key === k2)?.state, 'unfinished');
    s.calls.length = 0;
    assert.deepStrictEqual(store.part(k1, 'wall.webp'), { ok: false, reason: 'revoked' }, 'a revoked world serves nothing');
    assert.ok(!s.calls.some((c) => c.op === 'openSync' && c.arg.endsWith('wall.webp')), 'its pictures are not even opened');
    assert.deepStrictEqual(store.sweepRevoked(), [k1], 'the sweep removes it');
    assert.ok(!fs.existsSync(path.join(root, k1)) && fs.existsSync(path.join(root, k2)));
    assert.ok(store.part(k2, 'wall.webp').ok, 'other worlds stay');
    // a revoked picture hash (a likeness report on one picture) revokes the world that holds it
    store.setRevoked([sha256(tiny(2).files.find((f) => f.name === 'wall.webp')!.data as Buffer)]);
    assert.deepStrictEqual(store.sweepRevoked(), [k2]);
    assert.deepStrictEqual(store.list(), []);
  }

  // ---- 13. caps: size is a hard stop, a count is a warning ----
  {
    const one = tiny(1);
    const size = one.files.reduce((n, f) => n + f.data.length, 0);
    const { store } = env(undefined, undefined, size * 3 + 10);
    let last: ReturnType<WorldStore['save']> | undefined;
    let n = 0;
    while (n < 20) { last = store.save(tiny(++n)); if (!last.ok) break; }
    assert.ok(last && !last.ok && last.code === 'full' && /500 MB/.test(last.error), 'over the byte cap a save is refused with a plain sentence');
    assert.strictEqual(store.list().length, 3, 'three fitted, and nothing of the fourth was written');
    assert.ok(MAX_STORE_BYTES === 500 * 1024 * 1024);
    // a replace counts its own old size out
    const r = env(undefined, undefined, size * 2 + 10);
    const key = saved(r.store.save({ ...tiny(1), origin: 'project', worldId: 'tiny' }));
    assert.ok(r.store.save({ ...tiny(2), origin: 'project', worldId: 'tiny' }, { replace: true }).ok, 'replacing within the cap works');
    assert.ok(key);
    // 64 worlds is a warning, never a refusal
    const c = env();
    let warn: unknown[] = [];
    for (let i = 1; i <= WARN_WORLD_COUNT + 1; i++) { const q = c.store.save(tiny(i)); assert.ok(q.ok, 'world ' + i + ' is saved'); if (q.ok) warn = q.warnings; if (i === WARN_WORLD_COUNT) assert.deepStrictEqual(warn, [], 'no warning at 64'); }
    assert.deepStrictEqual(warn, ['count'], 'the 65th is saved with a warning');
    assert.strictEqual(c.store.list().length, WARN_WORLD_COUNT + 1, 'nothing was refused for a count');
  }

  // ---- 14. pack text and the network stay out ----
  {
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const root = path.join(__dirname, '..', '..');
    for (const f of ['src/main/worlds/store.ts', 'src/main/ipc/worlds.ts']) {
      const src = strip(fs.readFileSync(path.join(root, f), 'utf8'));
      assert.ok(!/\b(?:description|licence|license|prompt)\b/i.test(src), f + ' never touches a description, licence or prompt');
      assert.ok(!/netget|from 'net'|from 'http'|from 'https'|require\('(?:net|http|https|tls|dns|dgram|child_process)'\)|\bfetch\(|\bnet\.request|\bXMLHttpRequest|\bWebSocket\b|from 'child_process'|from 'dns'|from 'tls'|makeDownloadGet/.test(src), f + ' imports no network');
      assert.ok(!/\beval\(|new Function\(|\brequire\(\s*[^'\s)]/.test(src), f + ': no eval, no dynamic require');
      assert.ok(!/console\.\w+\([^)]*(?:name|world)/i.test(src.replace(/\[worlds\] the start repair failed/, '')), f + ' logs no world text');
    }
    assert.ok(!logged.some((l) => /Test world|Mine |userData|durbar-worldstore/.test(l)), 'nothing logged carries a world name or a path');
  }

  process.exitCode = 0;
  console.log('worldstore: OK');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

// ---- helpers used above ----
function readdirNoDots(d: string): string[] { return fs.readdirSync(d).filter((n) => !n.startsWith('.')); }
/** A store over `root` whose mutating calls fail from the nth one (counted from this store's own first call), for good. */
function failingFrom(root: string, nth: number): { store: WorldStore } {
  const s = spyFs(nth);
  return { store: new WorldStore(root, s.fsx, undefined, undefined, undefined) };
}
function await_png(): Buffer {
  // a tiny valid PNG: signature, IHDR 100x50, one IDAT, IEND (the header check reads chunk structure and CRCs, it does not decode)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { png } = require('./fixtures/worlds/gen') as { png(w: number, h: number): Buffer };
  return png(100, 50);
}
