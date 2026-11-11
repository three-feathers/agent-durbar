/* Spec 102 T285/T286, FR-035, FR-085, FR-170, FR-269 (b) and (g): the reproducible packer (scripts/world-pack.js), the reader for 097 T156..T159's
   ticks, and the availability gates, one fixture per failure. Then each gate is broken on purpose (a mutant copy of world-pack.js) and the fixture
   of that gate must fail, by name. `npm run test:world-pack`. Plain Node, no Electron, no network, no credits.
   Needs dist-scripts (the npm script runs tsc first). WORLD_PACK_MODULE points at a mutant copy (set by this test only). */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODULE = process.env.WORLD_PACK_MODULE || path.join(__dirname, 'world-pack.js');
const { packWorld, readTicks, availabilityGate, REQUIRED_TICKS } = require(MODULE);
const gen = require(path.join(ROOT, 'dist-scripts', 'scripts', 'fixtures', 'worlds', 'gen.js'));
const theme = require(path.join(ROOT, 'src', 'renderer', 'theme.js'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** Source text with \r\n as \n, so text matched in it is found on a CRLF checkout (Windows CI) too. */
const lf = (s) => s.replace(/\r\n/g, '\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-pack-'));
const failed = [];
function it(name, fn) { try { fn(); } catch (e) { failed.push(name); console.error(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } }
const write = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const [n, d] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), d); };
/* Can this machine make symlinks? Windows without the right cannot: the link cases are then skipped, said out loud, never a silent pass. */
const canLink = (() => {
  try { fs.writeFileSync(path.join(tmp, 'link-target'), 'x'); fs.symlinkSync(path.join(tmp, 'link-target'), path.join(tmp, 'link-probe')); return true; } catch { return false; }
})();
if (!canLink) console.log('symlink test skipped: no symlinks here');
/* Runs fn while fs.readdirSync lists `extra` names as well (names this OS cannot hold, such as con.txt on Windows or A.md beside a.md on a
   case-folding disk); the name check runs before any file is opened, so the names need not exist. */
function listing(extra, fn) {
  const real = fs.readdirSync;
  fs.readdirSync = (...a) => [...new Set([...real(...a), ...extra])];
  try { return fn(); } finally { fs.readdirSync = real; }
}

/* A complete, valid world folder (the synthetic pack of scripts/fixtures/worlds/gen.ts, no art) with ASSETS.md and card.json. */
let n = 0;
function makeWorld(over = {}, only) {
  const dir = path.join(tmp, `w${++n}`, 'test-world');
  const files = gen.goodPack({}, only);
  const pics = Object.keys(files).filter((f) => f.endsWith('.webp'));
  write(dir, files);
  write(dir, { 'ASSETS.md': `# Assets\n\n${pics.map((p) => `| ${p} | synthetic |`).join('\n')}\n`, 'card.json': JSON.stringify({ id: 'test-world' }) });
  return { dir, pics, ...over };
}
const TICKED = REQUIRED_TICKS.map((t) => `- [x] ${t} done`).join('\n') + '\n';
const tasksFile = (text) => { const p = path.join(tmp, `tasks${++n}.md`); fs.writeFileSync(p, text); return p; };
const validateOpts = { clean: theme._tokens(), knownSets: ['office', 'retro'], requireHashes: false };
const registry = { worlds: { 'test-world': { shippable: true } } };
const ctxOf = (over = {}) => ({ tasksPath: tasksFile(TICKED), registry, validateOpts, ...over });
const asked = (w, over = {}) => ({ id: 'test-world', dir: w.dir, status: 'available', sha256: packWorld(w.dir).zipSha256, ...over });
const gates = (r) => r.problems.map((p) => p.gate).sort();

/* ---- the packer ---- */
it('pack: two packs of one folder are byte-identical', () => {
  const w = makeWorld();
  const a = packWorld(w.dir), b = packWorld(w.dir);
  assert.ok(a.zip.equals(b.zip));
  assert.strictEqual(a.zipSha256, sha(a.zip));
  assert.deepStrictEqual(a.manifest, b.manifest);
});
it('pack: the same files written in another order and with other times pack the same', () => {
  const w = makeWorld();
  const dir2 = path.join(tmp, 'again', 'test-world');
  for (const f of fs.readdirSync(w.dir).reverse()) write(dir2, { [f]: fs.readFileSync(path.join(w.dir, f)) });
  const old = new Date('2001-02-03T04:05:06Z');
  for (const f of fs.readdirSync(dir2)) fs.utimesSync(path.join(dir2, f), old, old);
  assert.ok(packWorld(w.dir).zip.equals(packWorld(dir2).zip));
});
it('pack: the order the file system lists the files in does not matter', () => {
  const w = makeWorld();
  const want = packWorld(w.dir).zipSha256, real = fs.readdirSync;
  try {
    fs.readdirSync = (...a) => real(...a).reverse();
    assert.strictEqual(packWorld(w.dir).zipSha256, want);
  } finally { fs.readdirSync = real; }
});
it('pack: entries are sorted, stamps are fixed, no card.json, no OS leftovers', () => {
  const w = makeWorld();
  write(w.dir, { '.DS_Store': 'x', 'Thumbs.db': 'x', 'desktop.ini': 'x', '._world.json': 'x' });
  const p = packWorld(w.dir);
  const names = p.manifest.files.map((f) => f.name);
  assert.deepStrictEqual(names, [...names].sort());
  assert.ok(!names.includes('card.json') && !names.some((x) => /ds_store|thumbs|desktop|^\._/i.test(x)));
  const dosTime = p.zip.readUInt16LE(10), dosDate = p.zip.readUInt16LE(12);
  assert.strictEqual(dosTime, 0); assert.strictEqual(dosDate, 0x0021);
});
it('pack: a CRLF checkout of the same text files gives the same pack', () => {
  const w = makeWorld();
  const crlf = path.join(tmp, 'crlf', 'test-world');
  for (const f of fs.readdirSync(w.dir)) {
    let d = fs.readFileSync(path.join(w.dir, f));
    if (/\.(md|json)$/.test(f)) d = Buffer.from(d.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
    write(crlf, { [f]: d });
  }
  assert.notStrictEqual(sha(fs.readFileSync(path.join(crlf, 'ASSETS.md'))), sha(fs.readFileSync(path.join(w.dir, 'ASSETS.md'))), 'the fixture really has CRLF');
  assert.strictEqual(packWorld(crlf).zipSha256, packWorld(w.dir).zipSha256);
});
it('pack: a changed byte changes the hash; pictures are not normalised', () => {
  const w = makeWorld();
  const before = packWorld(w.dir).zipSha256;
  const pic = path.join(w.dir, w.pics[0]);
  const d = fs.readFileSync(pic); d[d.length - 1] ^= 1; fs.writeFileSync(pic, d);
  assert.notStrictEqual(packWorld(w.dir).zipSha256, before);
});
it('pack: names sort by code unit, not by locale', () => {
  const dir = path.join(tmp, 'order');
  write(dir, { 'ab.md': 'x\n', 'a.md': 'x\n', '_x.json': '{}\n', 'B.md': 'x\n', 'a-b.md': 'x\n' });
  const names = packWorld(dir).manifest.files.map((f) => f.name);
  assert.deepStrictEqual(names, ['B.md', '_x.json', 'a-b.md', 'a.md', 'ab.md']);
  assert.notDeepStrictEqual([...names].sort((a, b) => a.localeCompare(b)), names, 'the fixture really tells the two orders apart');
});
it('pack: a lone CR in a text file stays; only a CR before an LF goes', () => {
  const dir = path.join(tmp, 'lonecr');
  write(dir, { 'note.md': 'a\rb\r\nc\r' });
  const f = packWorld(dir).files[0];
  assert.strictEqual(f.data.toString('latin1'), 'a\rb\nc\r');
});
/* The cross-OS guarantee (FR-085): this hand-written folder (CRLF, a lone CR, names whose locale and code-unit orders differ, a picture with
   CRLF bytes that must stay) packs to exactly these bytes. Produced on macOS and pinned; the Windows and Linux CI jobs check the same pins. */
const GOLDEN_FILES = {
  'B.md': '# B\r\nline two\r\n',
  '_x.json': '{\r\n  "x": 1\r\n}\r\n',
  'a-b.md': 'lone\rcr\n',
  'a.md': 'a\n',
  'ab.md': 'ab\r\n',
  'p.webp': Buffer.from([0x52, 0x49, 0x46, 0x46, 0x0d, 0x0a, 0x00, 0xff]),
};
const GOLDEN_ZIP_SHA256 = 'd2f23c054907de49d678988f046041bd3ca12e206d33ea67987874910b606fbe';
const GOLDEN_MANIFEST_SHA256 = 'dc8c33dc21e44a09ce72264a5eeb6b9e366bb6e466f9d0e1ebde5d7fb4856239';
it('pack: a pinned folder packs to the pinned bytes (golden zip and manifest)', () => {
  const dir = path.join(tmp, 'golden');
  write(dir, GOLDEN_FILES);
  const p = packWorld(dir);
  if (process.env.WORLD_PACK_PRINT_GOLDEN) console.log(`golden zip ${p.zipSha256} manifest ${sha(JSON.stringify(p.manifest))}`);
  assert.strictEqual(p.zipSha256, GOLDEN_ZIP_SHA256, 'zip bytes');
  assert.strictEqual(sha(JSON.stringify(p.manifest)), GOLDEN_MANIFEST_SHA256, 'manifest');
});
it('pack: a folder or a link inside is refused, not followed', () => {
  const w = makeWorld();
  fs.mkdirSync(path.join(w.dir, 'sub'));
  assert.throws(() => packWorld(w.dir), /"sub" is not a plain file/);
  fs.rmdirSync(path.join(w.dir, 'sub'));
  if (!canLink) return; // said once at the top: symlink test skipped
  fs.symlinkSync(path.join(w.dir, 'ASSETS.md'), path.join(w.dir, 'link.md'));
  assert.throws(() => packWorld(w.dir), /"link\.md" is a link/);
});
it('pack: a link to a file outside the folder is refused, not followed', () => {
  if (!canLink) return;
  const w = makeWorld();
  const outside = path.join(tmp, 'outside.md');
  fs.writeFileSync(outside, 'not part of the world\n');
  fs.symlinkSync(outside, path.join(w.dir, 'out.md'));
  assert.throws(() => packWorld(w.dir), /"out\.md" is a link/);
});
it('pack: a file swapped for a link between lstat and the read is refused', () => {
  if (!canLink) return;
  const w = makeWorld();
  const outside = path.join(tmp, 'outside-race.md');
  fs.writeFileSync(outside, 'swapped in\n');
  const real = fs.openSync;
  fs.openSync = (p, ...a) => {
    if (path.basename(String(p)) === 'ASSETS.md') { fs.unlinkSync(p); fs.symlinkSync(outside, p); }
    return real(p, ...a);
  };
  try { assert.throws(() => packWorld(w.dir), /"ASSETS\.md" changed while it was read/); } finally { fs.openSync = real; }
});
it('pack: a file over the entry limit is refused by name before it is opened', () => {
  const w = makeWorld();
  const max = require(path.join(ROOT, 'dist-scripts', 'src', 'shared', 'worldzip.js')).MAX_ENTRY_BYTES;
  fs.writeFileSync(path.join(w.dir, 'big.webp'), ''); fs.truncateSync(path.join(w.dir, 'big.webp'), max + 1);
  const real = fs.openSync, opened = [];
  fs.openSync = (p, ...a) => { opened.push(path.basename(String(p))); return real(p, ...a); };
  try { assert.throws(() => packWorld(w.dir), /"big\.webp" is too big/); } finally { fs.openSync = real; }
  assert.ok(!opened.includes('big.webp'), 'the big file was opened');
});
it('pack: a Windows device name, a name that differs only by case and a non-ASCII name are refused, by name', () => {
  const w = makeWorld();
  assert.throws(() => listing(['con.txt'], () => packWorld(w.dir)), (e) => /"con\.txt": .*reserved Windows device name/.test(e.message));
  write(w.dir, { 'A.md': 'x\n' });
  assert.throws(() => listing(['a.md'], () => packWorld(w.dir)), (e) => /"A\.md" and "a\.md" differ only by case|"a\.md" and "A\.md" differ only by case/.test(e.message));
  fs.unlinkSync(path.join(w.dir, 'A.md'));
  write(w.dir, { 'caf\u00e9.md': 'x\n' });
  assert.throws(() => packWorld(w.dir), (e) => /"caf.+\.md": .*not allowed/.test(e.message) && !e.message.includes(os.homedir()) && !e.message.includes(tmp));
});

/* ---- the tick reader ---- */
it('ticks: only T159 ticked is reported as it is (the state of main)', () => {
  const real = readTicks(path.join(ROOT, 'specs', '097-real-office', 'tasks.md'));
  assert.strictEqual(real.ticks.T159, true, 'T159 is ticked on main');
  assert.ok(Object.keys(real.ticks).join() === REQUIRED_TICKS.join());
});
it('ticks: CRLF text is read', () => {
  assert.deepStrictEqual(readTicks(tasksFile(TICKED.replace(/\n/g, '\r\n'))).missing, []);
});
it('ticks: a missing task, an unticked task and a missing file are not met', () => {
  assert.deepStrictEqual(readTicks(tasksFile('- [x] T156 a\n- [x] T157 b\n- [x] T159 d\n')).missing, ['T158']);
  assert.deepStrictEqual(readTicks(tasksFile('- [x] T156 a\n- [ ] T157 b\n- [x] T158 c\n- [x] T159 d\n')).missing, ['T157']);
  assert.deepStrictEqual(readTicks(path.join(tmp, 'nope.md')).missing, REQUIRED_TICKS);
  assert.deepStrictEqual(readTicks(tasksFile('- [x] T1560 a\n- [x] T157 b\n- [x] T158 c\n- [x] T159 d\n')).missing, ['T156'], 'T1560 is not T156');
  assert.deepStrictEqual(readTicks(tasksFile(TICKED + '- [ ] T158 again\n')).missing, ['T158'], 'two lines, one unticked');
});

/* ---- the gates: one fixture per failure ---- */
it('gate: a good world passes', () => {
  const w = makeWorld();
  const r = availabilityGate(asked(w), ctxOf());
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
});
it('gate: a world that is only coming is not judged', () => {
  const w = makeWorld();
  assert.strictEqual(availabilityGate(asked(w, { status: 'coming' }), ctxOf({ tasksPath: path.join(tmp, 'nope.md') })).ok, true);
});
it('gate ticks: a missing tick refuses available', () => {
  const w = makeWorld();
  const r = availabilityGate(asked(w), ctxOf({ tasksPath: tasksFile('- [x] T159 only\n') }));
  assert.deepStrictEqual(gates(r), ['ticks']);
  assert.ok(/T156, T157, T158/.test(r.problems[0].message));
});
it('gate ticks: an unticked task refuses available', () => {
  const w = makeWorld();
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf({ tasksPath: tasksFile(TICKED.replace('[x] T158', '[ ] T158')) }))), ['ticks']);
});
it('gate ticks: a missing tasks file refuses available', () => {
  const w = makeWorld();
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf({ tasksPath: path.join(tmp, 'gone.md') }))), ['ticks']);
});
it('gate registry: a row that is not shippable, or absent, refuses available', () => {
  const w = makeWorld();
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf({ registry: { worlds: { 'test-world': { shippable: false } } } }))), ['registry']);
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf({ registry: { worlds: {} } }))), ['registry']);
  assert.deepStrictEqual(gates(availabilityGate(asked(w, { id: 'toString' }), ctxOf())), ['card', 'registry'], 'an inherited name is no row');
});
it('gate card: a missing card refuses available', () => {
  const w = makeWorld();
  fs.unlinkSync(path.join(w.dir, 'card.json'));
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf())), ['card']);
});
it('gate provenance: no ASSETS.md, or a picture it does not list, refuses available', () => {
  const w = makeWorld();
  const text = fs.readFileSync(path.join(w.dir, 'ASSETS.md'), 'utf8');
  fs.writeFileSync(path.join(w.dir, 'ASSETS.md'), text.split('\n').filter((l) => !l.includes(w.pics[0])).join('\n'));
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf())), ['provenance']);
  fs.unlinkSync(path.join(w.dir, 'ASSETS.md'));
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf())), ['provenance']);
});
it('gate pack-valid: a missing picture refuses available', () => {
  const w = makeWorld();
  const gone = w.pics.find((p) => p.startsWith('fx-coffee'));
  fs.unlinkSync(path.join(w.dir, gone));
  const r = availabilityGate(asked(w), ctxOf());
  assert.ok(gates(r).includes('pack-valid'), gates(r).join());
});
it('gate pack-valid: a pack with parts left out of both its folder and world.json (unfinished) refuses available', () => {
  const w = makeWorld({}, ['desk.webp']);
  const r = availabilityGate(asked(w), ctxOf());
  assert.deepStrictEqual(gates(r), ['pack-valid']);
  assert.ok(/a picture is missing/.test(r.problems[0].message));
});
it('gate pack-valid: a pack the validator refuses (a file not on its list) refuses available', () => {
  const w = makeWorld();
  write(w.dir, { 'extra.exe': 'MZ' });
  assert.ok(gates(availabilityGate(asked(w), ctxOf())).includes('pack-valid'));
});
it('gate reproducible: a pack that differs between two runs refuses available', () => {
  const w = makeWorld();
  let i = 0;
  const flaky = (dir) => { const p = packWorld(dir); return { ...p, zip: Buffer.concat([p.zip, Buffer.from([i++])]) }; };
  assert.deepStrictEqual(gates(availabilityGate(asked(w), ctxOf({ pack: flaky }))), ['reproducible']);
});
it('gate hash: a wrong or absent catalogue hash refuses available', () => {
  const w = makeWorld();
  assert.deepStrictEqual(gates(availabilityGate(asked(w, { sha256: '0'.repeat(64) }), ctxOf())), ['hash']);
  assert.deepStrictEqual(gates(availabilityGate(asked(w, { sha256: undefined }), ctxOf())), ['hash']);
});
it('gate ctx: no context, or not an object, refuses available and names the problem', () => {
  const w = makeWorld();
  for (const bad of [undefined, null, 'ctx']) {
    const r = availabilityGate(asked(w), bad);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(gates(r), ['ctx']);
    assert.ok(/without its context/.test(r.problems[0].message), r.problems[0].message);
  }
});
it('gate: every failing gate is listed, not only the first', () => {
  const w = makeWorld();
  fs.unlinkSync(path.join(w.dir, 'card.json'));
  const r = availabilityGate(asked(w), ctxOf({ tasksPath: tasksFile(''), registry: { worlds: {} } }));
  assert.deepStrictEqual(gates(r), ['card', 'registry', 'ticks']);
});

/* ---- mutants: break each gate, and its own fixture must fail ---- */
if (!process.env.WORLD_PACK_MODULE) {
  const src = lf(fs.readFileSync(path.join(__dirname, 'world-pack.js'), 'utf8')).replace(/__dirname/g, JSON.stringify(__dirname));
  const mutants = [
    ['ticks gate removed', "if (missing.length) fail('ticks'", "if (false) fail('ticks'", ['gate ticks: a missing tick refuses available']],
    ['tick reader counts an unticked box', "const ticked = m[1] !== ' ';", 'const ticked = true;', ['ticks: a missing task, an unticked task and a missing file are not met', 'gate ticks: an unticked task refuses available']],
    ['tick reader: a missing task is met', 'ticks[id] = state[id] === true;', 'ticks[id] = state[id] !== false;', ['ticks: a missing task, an unticked task and a missing file are not met', 'gate ticks: a missing tasks file refuses available']],
    ['registry gate removed', "if (!row || row.shippable !== true) fail(", "if (false) fail(", ['gate registry: a row that is not shippable, or absent, refuses available']],
    ['registry gate loosened to any row', 'row.shippable !== true', 'false', ['gate registry: a row that is not shippable, or absent, refuses available']],
    ['card gate removed', "fail('card', 'card.json is missing or unreadable (FR-014, FR-035 g)')", 'void 0', ['gate card: a missing card refuses available']],
    ['provenance: pictures not listed pass', "!text.includes(f.name)", 'false', ['gate provenance: no ASSETS.md, or a picture it does not list, refuses available']],
    ['provenance: missing ASSETS.md passes', "if (!assets) fail('provenance'", "if (false) fail('provenance'", ['gate provenance: no ASSETS.md, or a picture it does not list, refuses available']],
    ['validator gate removed', 'else if (r.unfinished.length) fail(', 'else if (false) fail(', ['gate pack-valid: a pack with parts left out of both its folder and world.json (unfinished) refuses available']],
    ['validator result ignored', 'if (!r.ok) fail(', 'if (false) fail(', ['gate pack-valid: a pack the validator refuses (a file not on its list) refuses available']],
    ['reproducible gate removed', 'if (!Buffer.from(a.zip).equals(Buffer.from(b.zip))) fail(', 'if (false) fail(', ['gate reproducible: a pack that differs between two runs refuses available']],
    ['hash gate loosened', "typeof world.sha256 !== 'string' || world.sha256 !== sha256(a.zip)", 'false', ['gate hash: a wrong or absent catalogue hash refuses available']],
    ['packer: entries not sorted', 'return files.sort(byName);', 'return files.reverse().sort(() => 0);', ['pack: the order the file system lists the files in does not matter']],
    ['packer: CRLF not normalised', "TEXT_EXT.has(path.extname(name).toLowerCase()) ? normaliseText(raw) : raw", 'raw', ['pack: a CRLF checkout of the same text files gives the same pack']],
    ['packer: CRLF rule turned into a no-op', "replace(/\\r\\n/g, '\\n')", "replace(/\\r\\n/g, '\\r\\n')", ['pack: a CRLF checkout of the same text files gives the same pack']],
    ['packer: card.json packed', "const NOT_IN_PACK = new Set(['card.json'])", 'const NOT_IN_PACK = new Set()', ['pack: entries are sorted, stamps are fixed, no card.json, no OS leftovers']],
    ['packer: OS junk packed', '.filter((name) => !OS_JUNK.test(name) && !NOT_IN_PACK.has(name))', '.filter((name) => !NOT_IN_PACK.has(name))', ['pack: entries are sorted, stamps are fixed, no card.json, no OS leftovers']],
    ['packer: folders followed', "if (!st.isFile()) throw", 'if (false) throw', ['pack: a folder or a link inside is refused, not followed']],
    ['packer: every CR stripped', "replace(/\\r\\n/g, '\\n')", "replace(/\\r/g, '')", ['pack: a lone CR in a text file stays; only a CR before an LF goes', 'pack: a pinned folder packs to the pinned bytes (golden zip and manifest)']],
    ['packer: sorted by localeCompare', 'const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);', 'const byName = (a, b) => a.name.localeCompare(b.name);', ['pack: names sort by code unit, not by locale', 'pack: a pinned folder packs to the pinned bytes (golden zip and manifest)']],
    ['packer: lstat turned into stat', 'const st = fs.lstatSync(full);', 'const st = fs.statSync(full);', ['pack: a folder or a link inside is refused, not followed', 'pack: a link to a file outside the folder is refused, not followed'], 'links'],
    ['packer: a link swapped in before the read is followed', [['(fs.constants.O_NOFOLLOW || 0)', '0'], ['now.ino !== st.ino || now.dev !== st.dev', 'false']], null, ['pack: a file swapped for a link between lstat and the read is refused'], 'links'],
    ['packer: size checked only after the read', 'if (st.size > max) throw', 'if (false) throw', ['pack: a file over the entry limit is refused by name before it is opened']],
    ['packer: names not checked first', 'const why = segmentProblem(name);', "const why = '';", ['pack: a Windows device name, a name that differs only by case and a non-ASCII name are refused, by name']],
    ['packer: case clash not checked', 'if (seen.has(key)) throw', 'if (false) throw', ['pack: a Windows device name, a name that differs only by case and a non-ASCII name are refused, by name']],
    ['gate: ctx not checked', "if (!ctx || typeof ctx !== 'object') {", 'if (false) {', ['gate ctx: no context, or not an object, refuses available and names the problem']],
  ];
  for (const [name, from, to, expect, needs] of mutants) {
    if (needs === 'links' && !canLink) { console.log(`mutant "${name}" skipped: no symlinks here`); continue; }
    const pairs = Array.isArray(from) ? from : [[from, to]];
    const missing = pairs.find(([f]) => !src.includes(f));
    if (missing) { failed.push(`mutant "${name}": text to break not found`); console.error(`FAIL mutant "${name}": text to break not found`); continue; }
    const file = path.join(tmp, `mutant-${++n}.js`);
    fs.writeFileSync(file, pairs.reduce((t, [f, r]) => t.replace(f, r), src));
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, WORLD_PACK_MODULE: file }, encoding: 'utf8' });
    const out = r.stderr + r.stdout;
    for (const f of expect) if (!out.includes(`FAIL ${f}`)) { failed.push(`mutant "${name}" survived: "${f}" did not fail`); console.error(`FAIL mutant "${name}" survived: "${f}" did not fail`); }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failed.length) { console.error(`test-world-pack: ${failed.length} failure(s)`); process.exit(1); }
if (!process.env.WORLD_PACK_MODULE) console.log('test-world-pack OK');
