/**
 * Spec 102 T010, T018 (Linux sample), FR-051, FR-085: the strict zip reader and the stored-only writer. Hostile zips come from `fixtures/worlds/gen.ts`
 * (built here, never committed); a seeded fuzz proves the reader only ever answers with a result, in a bounded number of rounds. No wall-clock
 * asserts. `npm run test:worldzip`. Plain Node, no Electron, no network, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { openZip, readZip, writeStoredZip, crc32, segmentProblem, MAX_RAW_ENTRIES, MAX_KEPT_ENTRIES } from '../src/shared/worldzip';
import { validateWorldZip, type PackOptions } from '../src/shared/worldpack';
import { goodPack, toStored, rawZip, rawFrom, hostileSet, webp, le32 } from './fixtures/worlds/gen';

process.exitCode = 1;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string> };
const opts: PackOptions = { clean: T._tokens(), knownSets: ['office'], requireHashes: false };

assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 check value');
assert.strictEqual(crc32(Buffer.alloc(0)), 0);

// ---- accepted shapes ----
const good = goodPack();
const names = Object.keys(good);
{
  const r = readZip(toStored(good));
  assert.ok(r.ok, 'the stored pack');
  if (r.ok) { assert.deepStrictEqual(r.entries.map((e) => e.name), names, 'order and names kept'); assert.ok(r.entries.every((e) => e.data.equals(good[e.name])), 'bytes kept'); assert.strictEqual(r.ignored, 0); }
}
{ // deflate, with and without a data descriptor (the signature is optional), as tools that stream write
  for (const d of [undefined, 'sig', 'nosig'] as const) {
    const es = rawFrom(good).map((e, i) => ({ ...e, method: 8, ...(d && i % 2 === 0 ? { descriptor: d } : {}) }));
    const r = readZip(rawZip(es));
    assert.ok(r.ok, 'deflate with descriptor ' + d + ': ' + (r.ok ? '' : r.reason));
    if (r.ok) assert.ok(r.entries.every((e) => e.data.equals(good[e.name])), 'inflated bytes equal');
  }
}
{ // a single top-level folder (hand-made zip), folder entries and what Finder and Explorer add are ignored and never opened
  const junk = Buffer.alloc(300, 0xff); // not a deflate stream: inflating it would fail the read
  const es = [
    { name: 'my-world/', data: Buffer.alloc(0) },
    ...rawFrom(good).map((e) => ({ ...e, name: 'my-world/' + (e.name as string) })),
    { name: 'my-world/.DS_Store', data: Buffer.from('x'), method: 8, packed: junk },
    { name: 'my-world/Thumbs.db', data: Buffer.from('x'), method: 8, packed: junk },
    { name: '.DS_Store', data: Buffer.from('x'), method: 8, packed: junk },
    { name: '__MACOSX/', data: Buffer.alloc(0) },
    { name: '__MACOSX/my-world/', data: Buffer.alloc(0) },
    { name: '__MACOSX/my-world/._wall.webp', data: Buffer.from('x'), method: 8, packed: junk },
    { name: '__MACOSX/._my-world', data: Buffer.from('x'), method: 8, packed: junk },
  ];
  const z = rawZip(es);
  const r = readZip(z);
  assert.ok(r.ok, 'folder + junk: ' + (r.ok ? '' : r.reason));
  if (r.ok) { assert.deepStrictEqual(r.entries.map((e) => e.name), names, 'folder prefix stripped'); assert.strictEqual(r.ignored, es.length - names.length, 'ignored are counted'); }
  assert.ok(validateWorldZip(z, opts).ok, 'a folder zip is a valid pack');
  // ignored entries count toward the 96
  const many = [...rawFrom(good), ...Array.from({ length: MAX_RAW_ENTRIES - names.length + 1 }, (_, i) => ({ name: i ? '__MACOSX/._f' + i : '.DS_Store', data: Buffer.from('x') }))];
  assert.ok(many.length === MAX_RAW_ENTRIES + 1);
  const rr = readZip(rawZip(many));
  assert.ok(!rr.ok && /too many entries/.test(rr.reason), 'junk counts toward 96');
}
{ // junk that real tools do not write is not "ignored": a bad shape is a refusal
  for (const bad of ['__MACOSX/x', '__MACOSX/._', '__MACOSX/a/b/._c', 'x/.DS_Store/y', '__MACOSX/._../x', '__MACOSX/._con']) assert.ok(!readZip(rawZip([...rawFrom(good), { name: bad, data: Buffer.from('x') }])).ok, 'the reader refuses the junk shape ' + bad);
  for (const bad of ['.ds_store', 'thumbs.db', '__MACOSX/x']) assert.ok(!validateWorldZip(rawZip([...rawFrom(good), { name: bad, data: Buffer.from('x') }]), opts).ok, bad + ' is not a pack file');
}
{ // limits are options, and are checked before work
  const z = toStored(good);
  assert.ok(!readZip(z, { maxZipBytes: z.length - 1 }).ok, 'zip byte cap');
  assert.ok(readZip(z, { maxZipBytes: z.length }).ok, 'exact cap passes');
  assert.ok(!readZip(z, { maxRawEntries: names.length - 1 }).ok, 'entry cap');
  assert.ok(!readZip(z, { maxKeptEntries: names.length - 1 }).ok, 'kept cap');
  assert.ok(!readZip(z, { maxEntryBytes: 10 }).ok, 'entry size cap');
  assert.ok(!readZip(z, { maxTotalBytes: 100 }).ok, 'total size cap');
  assert.strictEqual(MAX_RAW_ENTRIES, 96); assert.strictEqual(MAX_KEPT_ENTRIES, 40);
}
{ // header-only open reads no data: a pack whose first file is garbage still lists its names
  const z = openZip(rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: Buffer.alloc(5000), method: 8, packed: Buffer.alloc(100, 0xff) } : e))));
  assert.ok(z.ok && z.headers.some((h) => h.name === 'wall.webp'), 'openZip lists without inflating');
  if (z.ok) { assert.strictEqual(z.read('wall.webp'), null, 'reading the garbage entry fails closed'); assert.strictEqual(z.read('nope'), null); assert.strictEqual(z.read('__proto__'), null); assert.strictEqual(z.read('constructor'), null); }
}

// ---- names (segmentProblem is the one rule) ----
for (const ok of ['wall.webp', 'fx-library.webp', 'world.json', 'a_b-c.D', 'x']) assert.strictEqual(segmentProblem(ok), '', ok);
for (const bad of ['', '.', '..', 'a.', 'a ', 'con', 'com0', 'lpt0.a', 'con .txt', 'nul .x', 'aux.', 'CON.txt', 'nul.x', 'Com1', 'lpt9.webp', 'a:b', 'a\\b', 'a\0b', 'a\tb', 'é', '‮', 'a/b', 'x'.repeat(65), 'a*b', 'a?b', 'a"b', 'a<b', 'a|b']) assert.notStrictEqual(segmentProblem(bad), '', JSON.stringify(bad) + ' must be refused');
assert.strictEqual(segmentProblem('com10.webp'), '', 'com10 is not a device name'); // COM0..COM9 only
assert.strictEqual(segmentProblem('console.webp'), '', 'a longer word is fine');

// ---- attributes of real tools are accepted (the new checks must not refuse what Explorer, Finder and zip write) ----
{
  const fileA = 0x20, dirA = 0x10; // Windows Explorer: made by host 0 (MS-DOS), archive bit on files, directory bit on folders, no unix mode
  const win = rawZip([{ name: 'my-world/', data: Buffer.alloc(0), made: 20, attr: dirA }, ...rawFrom(good).map((e) => ({ ...e, name: 'my-world/' + (e.name as string), made: 20, attr: fileA }))]);
  assert.ok(validateWorldZip(win, opts).ok, 'Windows-style attributes');
  const mac = rawZip([{ name: 'my-world/', data: Buffer.alloc(0), made: (3 << 8) | 20, attr: ((0o040755 << 16) | dirA) >>> 0 }, ...rawFrom(good).map((e) => ({ ...e, name: 'my-world/' + (e.name as string), attr: (0o100644 << 16) >>> 0 }))]);
  assert.ok(validateWorldZip(mac, opts).ok, 'unix-style attributes');
  const none = rawZip(rawFrom(good).map((e) => ({ ...e, attr: 0 })));
  assert.ok(validateWorldZip(none, opts).ok, 'no attributes at all');
}

// ---- the writer (FR-085): byte-identical on two runs, readable, strict ----
{
  const list = names.map((name) => ({ name, data: good[name] }));
  const a = writeStoredZip(list), b = writeStoredZip(names.map((name) => ({ name, data: Buffer.from(good[name]) })));
  assert.ok(a.equals(b), 'two runs give the same bytes');
  const r = readZip(a);
  assert.ok(r.ok && r.entries.length === names.length, 'the reader accepts the writer');
  assert.ok(validateWorldZip(a, opts).ok, 'a written pack validates');
  assert.ok(writeStoredZip(list.slice().reverse()).equals(writeStoredZip(list.slice().reverse())), 'order is the caller\'s and stable');
  assert.ok(!writeStoredZip(list.slice().reverse()).equals(a), 'a different order is different bytes (the caller fixes the order)');
  assert.strictEqual(a.readUInt16LE(10), 0, 'fixed time'); assert.strictEqual(a.readUInt16LE(12), 0x21, 'fixed date');
  for (const bad of ['../x', 'a/b', 'CON', 'a\0', '', 'é']) assert.throws(() => writeStoredZip([{ name: bad, data: Buffer.alloc(1) }]), /bad entry name/, 'writer refuses ' + JSON.stringify(bad));
  assert.throws(() => writeStoredZip([{ name: 'a', data: Buffer.alloc(1) }, { name: 'A', data: Buffer.alloc(1) }]), /bad entry name/, 'writer refuses case duplicates');
  assert.ok(readZip(writeStoredZip([])).ok === false, 'an empty zip is refused by the reader');
}

// ---- hostile zips: the reader (not only the pack rules) refuses the structural ones ----
const NOT_ZIP_LEVEL = /^(manifest-|not-on-list|svg-|html-|jpeg-|gif-|empty-picture|png-|riff-|webp-|too-tall|too-wide|welcome-|window-|over-byte|lift-shaft|secret-marker|token-|json-|name-blank-)/;
let structural = 0;
for (const h of hostileSet()) {
  if (NOT_ZIP_LEVEL.test(h.id)) continue;
  structural++;
  const r = readZip(h.zip);
  assert.ok(!r.ok, 'the reader itself refuses ' + h.id);
  assert.ok(!openZip(h.zip).ok || /^(crc-wrong|bomb-declared-small|deflate-garbage|deflate-shorter-than-declared|deflate-empty-small|deflate-junk-after-final-block)$/.test(h.id), 'openZip refuses ' + h.id + ' before any inflate (except where only the data is bad)');
}
assert.ok(structural >= 80, 'enough structural cases: ' + structural);

// ---- a bomb stops at the declared size, not at the memory limit ----
{
  // the limit must reach zlib itself: a reader that inflates first and compares after has already spent the memory
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zl = require('zlib') as { inflateRawSync: (b: Buffer, o?: { maxOutputLength?: number }) => Buffer };
  const real = zl.inflateRawSync; const seenMax: Array<number | undefined> = [];
  zl.inflateRawSync = (b, o) => { seenMax.push(o && o.maxOutputLength); return real(b, o); };
  const bomb = zlib.deflateRawSync(Buffer.alloc(8 * 1024 * 1024));
  const z = openZip(rawZip([{ name: 'wall.webp', data: Buffer.alloc(4000), method: 8, packed: bomb, csize: bomb.length }]));
  assert.ok(z.ok, 'declared 4000 bytes, so the ratio rule does not apply; the cap is the declared size');
  if (z.ok) assert.strictEqual(z.read('wall.webp'), null, 'inflating 8 MB into a 4000-byte allowance fails closed (maxOutputLength)');
  zl.inflateRawSync = real;
  assert.deepStrictEqual(seenMax, [4000], 'zlib was told to stop at the declared size');
}

// ---- T018, Linux sample: the system `zip` (real:, only where it exists) ----
{
  let have = true;
  try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch { have = false; }
  if (!have) console.log('skip: no `zip` on this machine (T018 [KNOWN GAP] stays for macOS Archive Utility and Windows Explorer)');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-worldzip-'));
    try {
      const src = path.join(dir, 'my-world');
      fs.mkdirSync(src);
      for (const n of names) fs.writeFileSync(path.join(src, n), good[n]);
      const flat = path.join(dir, 'flat.zip'), folder = path.join(dir, 'folder.zip'), store = path.join(dir, 'store.zip');
      execFileSync('zip', ['-q', '-X', '-j', flat, ...names.map((n) => path.join(src, n))]);
      execFileSync('zip', ['-q', '-X', '-r', folder, 'my-world'], { cwd: dir });
      execFileSync('zip', ['-q', '-X', '-0', '-r', store, 'my-world'], { cwd: dir });
      for (const z of [flat, folder, store]) {
        const buf = fs.readFileSync(z);
        const r = validateWorldZip(buf, opts);
        assert.ok(r.ok, path.basename(z) + ' made by Linux zip is accepted: ' + r.reason);
      }
      // with a macOS-style junk entry added by the same tool
      fs.mkdirSync(path.join(dir, '__MACOSX'));
      fs.writeFileSync(path.join(dir, '__MACOSX', '._wall.webp'), 'x');
      fs.writeFileSync(path.join(src, '.DS_Store'), 'x');
      const junk = path.join(dir, 'junk.zip');
      execFileSync('zip', ['-q', '-X', '-r', junk, 'my-world', '__MACOSX'], { cwd: dir });
      assert.ok(validateWorldZip(fs.readFileSync(junk), opts).ok, 'Linux zip with .DS_Store and __MACOSX/._ junk');
      // a symlink stored by `zip -y` is refused
      fs.symlinkSync('/etc/passwd', path.join(src, 'link'));
      const sym = path.join(dir, 'sym.zip');
      execFileSync('zip', ['-q', '-X', '-y', '-r', sym, 'my-world'], { cwd: dir });
      const rs = validateWorldZip(fs.readFileSync(sym), opts);
      assert.ok(!rs.ok && /link|plain file/.test(rs.reason), 'a symlink entry made by zip -y is refused: ' + rs.reason);
      console.log('real: Linux `zip` samples accepted (flat, folder, stored, with junk); symlink refused');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

// ---- fuzz: a seeded generator, a fixed number of rounds; the reader only ever answers with a result ----
function rng(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ROUNDS = 3000;
const bases = [toStored(good), rawZip(rawFrom(good).map((e) => ({ ...e, method: 8 as const, descriptor: 'sig' as const }))), rawZip([{ name: 'top/', data: Buffer.alloc(0) }, ...rawFrom(good).map((e) => ({ ...e, name: 'top/' + (e.name as string) })), { name: '__MACOSX/top/._wall.webp', data: Buffer.from('x') }]), toStored(goodPack({}, ['wall.webp']))];
const EDGE = [0, 1, 0xff, 0xffff, 0x7fffffff, 0xffffffff, 0x04034b50, 0x02014b50, 0x06054b50, 0x08074b50, 0x07064b50];
let accepted = 0, refused = 0;
const rand = rng(102102);
for (let round = 0; round < ROUNDS; round++) {
  let b = Buffer.from(bases[round % bases.length]);
  const ops = 1 + Math.floor(rand() * 4);
  for (let o = 0; o < ops && b.length > 0; o++) {
    const kind = Math.floor(rand() * 8), at = Math.floor(rand() * b.length);
    if (kind === 0) b[at] ^= 1 << Math.floor(rand() * 8);
    else if (kind === 1) b[at] = Math.floor(rand() * 256);
    else if (kind === 2) b = b.subarray(0, at);
    else if (kind === 3) b = Buffer.concat([b.subarray(0, at), Buffer.from(Array.from({ length: 1 + Math.floor(rand() * 8) }, () => Math.floor(rand() * 256))), b.subarray(at)]);
    else if (kind === 4) b = Buffer.concat([b.subarray(0, at), b.subarray(Math.min(b.length, at + 1 + Math.floor(rand() * 30)))]);
    else if (kind === 5 && at + 4 <= b.length) b.writeUInt32LE(EDGE[Math.floor(rand() * EDGE.length)] >>> 0, at);
    else if (kind === 6 && at + 2 <= b.length) b.writeUInt16LE(EDGE[Math.floor(rand() * EDGE.length)] & 0xffff, at);
    else if (kind === 7) { const end = b.length - 22; if (end >= 0) b.writeUInt32LE(EDGE[Math.floor(rand() * EDGE.length)] >>> 0, end + 12 + 4 * Math.floor(rand() * 2)); }
  }
  let z, v;
  try { z = readZip(b); v = validateWorldZip(b, opts); } catch (e) { assert.fail('round ' + round + ': threw ' + String(e)); }
  assert.ok(typeof z.ok === 'boolean' && typeof v.ok === 'boolean', 'a result');
  if (z.ok) assert.ok(z.entries.length <= MAX_KEPT_ENTRIES && z.entries.every((e) => segmentProblem(e.name) === '' && !e.name.includes('/')), 'kept names are plain single names');
  if (v.ok) { accepted++; assert.ok(z.ok, 'a valid pack came from a readable zip'); assert.ok(v.manifest && v.parts.every((p) => /^[a-z0-9-]+\.webp$/.test(p)), 'only closed-list parts'); } else { refused++; assert.ok(v.reason.length > 0 && v.parts.length === 0); }
}
// random bytes and short prefixes of real zips
for (let i = 0; i < 500; i++) {
  const n = Math.floor(rand() * 200);
  const junk = Buffer.from(Array.from({ length: n }, () => Math.floor(rand() * 256)));
  if (i % 3 === 0 && n >= 22) { junk.writeUInt32LE(0x06054b50, n - 22); junk.fill(0, n - 18, n - 12); }
  assert.strictEqual(typeof validateWorldZip(junk, opts).ok, 'boolean');
}
for (let n = 0; n <= 120; n++) assert.strictEqual(validateWorldZip(bases[0].subarray(0, n), opts).ok, false, 'a short prefix of a zip is refused: ' + n);
assert.ok(accepted > 0 && refused > ROUNDS / 4, 'the fuzz both accepts and refuses: ' + accepted + ' / ' + refused);
void webp; void le32;

console.log('OK: strict zip subset, ' + structural + ' structural hostile cases, writer determinism, fuzz ' + ROUNDS + ' rounds (' + accepted + ' accepted, ' + refused + ' refused)');
process.exitCode = 0;
