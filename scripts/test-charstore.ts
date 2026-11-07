/**
 * My characters on disk (spec 096 FR-030, US4, SC-003, T034): `npm run test:charstore`. A temp userData; no Electron, no credits. Frames are copies of the shipped art,
 * which passes the same checks. Links are skipped with a note where the OS gives no right to make them (Windows).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CharacterStore, nameSlug } from '../src/main/charstore';
import type { NewCharacter } from '../src/main/charstore';
import { CHARACTER_ID_RE, MAX_CHARACTERS } from '../src/shared/charrules';

const ROOT = path.join(__dirname, '..', '..');
const artDir = path.join(ROOT, 'src', 'renderer', 'crew', 'art');
const art = fs.readdirSync(artDir).filter((f) => f.endsWith('.webp')).slice(0, 4).map((f) => new Uint8Array(fs.readFileSync(path.join(artDir, f))));
const FACE = { working: [176, 150] as [number, number], waiting: [176, 150] as [number, number], resting: [120, 140] as [number, number] };
const NEW: NewCharacter = { frames: { working: art[0], waiting: art[1], resting: art[2], blink: art[3] }, face: FACE, style: 'realistic-office-v1' };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-charstore-'));
let fresh = 0;
function setup(warn?: (m: string) => void): { root: string; store: CharacterStore; outside: string } {
  const dir = path.join(base, `t${fresh++}`);
  fs.mkdirSync(dir);
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  const root = path.join(dir, 'userData', 'characters');
  return { root, store: new CharacterStore(root, warn), outside };
}
function linkOk(target: string, at: string): boolean {
  try { fs.symlinkSync(target, at); return true; } catch { console.log('test-charstore: no link rights here, a link case is skipped'); return false; }
}
const saved = (r: ReturnType<CharacterStore['save']>): { id: string; name: string } => { assert.ok(r.ok, 'saved: ' + JSON.stringify(r)); return r as { ok: true; id: string; name: string }; };
const tree = (d: string): string[] => fs.readdirSync(d, { recursive: true, encoding: 'utf8' }).sort();

try {
  // --- save, list: ids, files, temp then rename ---
  {
    const { root, store } = setup();
    assert.deepStrictEqual(store.list(), [], 'no root yet: an empty list');
    const a = saved(store.save(NEW, 'Greta'));
    assert.ok(CHARACTER_ID_RE.test(a.id) && /^my-[0-9a-f]{12}$/.test(a.id), 'the id: ' + a.id);
    assert.deepStrictEqual(tree(root), [a.id, `${a.id}/blink.webp`.replace('/', path.sep), `${a.id}/character.json`.replace('/', path.sep), `${a.id}/resting.webp`.replace('/', path.sep), `${a.id}/waiting.webp`.replace('/', path.sep), `${a.id}/working.webp`.replace('/', path.sep)], 'exactly these files, no temp left');
    const doc = JSON.parse(fs.readFileSync(path.join(root, a.id, 'character.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(doc).sort(), ['blink', 'created', 'face', 'id', 'madeBy', 'name', 'style', 'v'], 'FR-030: the record has these fields and no others (no description, no prompt)');
    assert.strictEqual(doc.v, 1);
    const [e] = store.list();
    assert.deepStrictEqual({ id: e.id, name: e.name, style: e.style, blink: e.blink, face: e.face }, { id: a.id, name: 'Greta', style: 'realistic-office-v1', blink: true, face: FACE });
    assert.ok(Number.isFinite(Date.parse(e.created)));
    assert.ok(store.has(a.id) && !store.has('my-000000000000'));
    const got = store.frames(a.id);
    assert.ok(got.ok && Buffer.compare(Buffer.from(got.frames.working), Buffer.from(art[0])) === 0 && got.frames.blink, 'the bytes come back');
    // no blink frame
    const b = saved(store.save({ ...NEW, frames: { working: art[0], waiting: art[1], resting: art[2] } }, 'No blink'));
    const nb = store.frames(b.id);
    assert.ok(nb.ok && !nb.frames.blink, 'a character without a blink');
    assert.ok(!fs.existsSync(path.join(root, b.id, 'blink.webp')));
    assert.strictEqual(store.list().find((x) => x.id === b.id)?.blink, false);
    // an empty name gets "My character N", never one already taken
    assert.strictEqual(saved(store.save(NEW, '')).name, 'My character 3');
    store.rename(b.id, 'My character 4');
    assert.strictEqual(saved(store.save(NEW, '')).name, 'My character 5', 'a taken default is skipped');
  }
  // --- the frames are checked at the door ---
  {
    const { root, store } = setup();
    assert.ok(!store.save({ ...NEW, frames: { working: new Uint8Array(100), waiting: art[1], resting: art[2] } }, 'x').ok, 'not a WebP');
    assert.ok(!store.save({ ...NEW, frames: { working: Buffer.concat([art[0], Buffer.alloc(41 * 1024)]), waiting: art[1], resting: art[2] } }, 'x').ok, 'oversize');
    assert.ok(!store.save({ ...NEW, face: { ...FACE, working: [0, 0] } }, 'x').ok, 'a point off the bounds');
    assert.ok(!store.save({ ...NEW, style: '../x' }, 'x').ok, 'a style that is not an id');
    assert.ok(!store.save(NEW, 'bad\u0007name').ok, 'a control character');
    assert.ok(!fs.existsSync(root) || tree(root).length === 0, 'nothing was written');
  }
  // --- the cap (Q5) ---
  {
    const { store } = setup();
    for (let i = 0; i < MAX_CHARACTERS; i++) saved(store.save(NEW, `C${i}`));
    assert.strictEqual(store.list().length, 24);
    const r = store.save(NEW, 'one more');
    assert.ok(!r.ok && /24/.test(r.error), 'the 25th is refused');
    assert.strictEqual(store.list().length, 24);
  }
  // --- a write that fails leaves nothing (Edge cases: disk full) ---
  {
    const { root, store } = setup();
    saved(store.save(NEW, 'first'));
    const before = tree(root);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realFs = require('fs') as typeof fs;
    const write = realFs.writeFileSync;
    realFs.writeFileSync = ((f: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(f).endsWith('character.json')) { const e = new Error('ENOSPC') as NodeJS.ErrnoException; e.code = 'ENOSPC'; throw e; }
      return (write as (...a: unknown[]) => void)(f, ...rest);
    }) as typeof fs.writeFileSync;
    let r;
    try { r = store.save(NEW, 'second'); } finally { realFs.writeFileSync = write; }
    assert.ok(!r.ok, 'refused');
    assert.ok(!/ENOSPC|[\\/]/.test(r.ok ? '' : r.error.replace('and the profile', '')), 'a plain sentence, no path: ' + (r.ok ? '' : r.error));
    assert.deepStrictEqual(tree(root), before, 'nothing half-written stays');
    // a temp folder a crash left is removed by the next save, and a real character beside it is not
    fs.mkdirSync(path.join(root, '.tmp-abc'));
    fs.writeFileSync(path.join(root, '.tmp-abc', 'working.webp'), 'x');
    const c = saved(store.save(NEW, 'third'));
    assert.ok(!fs.existsSync(path.join(root, '.tmp-abc')) && store.has(c.id));
    assert.strictEqual(store.list().length, 2);
  }
  // --- list skips bad folders and links, with a warning that names no path (FR-030) ---
  {
    const warns: string[] = [];
    const { root, store, outside } = setup((m) => warns.push(m));
    const good = saved(store.save(NEW, 'good'));
    const copyOf = (id: string, edit: (dir: string, doc: Record<string, unknown>) => void): string => {
      const dir = path.join(root, id);
      fs.cpSync(path.join(root, good.id), dir, { recursive: true });
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
      doc.id = id;
      edit(dir, doc);
      if (fs.existsSync(path.join(dir, 'character.json'))) fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(doc));
      return id;
    };
    const n = (i: number): string => `my-00000000000${i.toString(16)}`;
    const bads = [
      copyOf(n(1), (_d, doc) => { doc.id = n(2); }), // the record names another folder
      copyOf(n(2), (_d, doc) => { doc.v = 2; }),
      copyOf(n(3), (_d, doc) => { doc.name = 'bad\u0007name'; }),
      copyOf(n(4), (_d, doc) => { doc.face = { working: [0, 0], waiting: [176, 150], resting: [176, 150] }; }),
      copyOf(n(5), (d) => { fs.rmSync(path.join(d, 'working.webp')); }),
      copyOf(n(6), (d) => { fs.writeFileSync(path.join(d, 'working.webp'), Buffer.alloc(41 * 1024)); }),
      copyOf(n(7), (d) => { fs.rmSync(path.join(d, 'blink.webp')); }), // says blink, has none
      copyOf(n(8), (_d, doc) => { doc.blink = false; }), // says none, has one
      copyOf(n(9), (d) => { fs.rmSync(path.join(d, 'character.json')); }),
      copyOf(n(10), (d) => { fs.writeFileSync(path.join(d, 'character.json'), '{not json'); fs.renameSync(path.join(d, 'blink.webp'), path.join(d, 'x')); }),
      copyOf(n(11), (_d, doc) => { doc.style = '../../x'; }),
      copyOf(n(12), (_d, doc) => { doc.madeBy = 'someone'; }),
    ];
    // not named like an id: ignored without a word
    fs.mkdirSync(path.join(root, 'not-an-id'));
    fs.mkdirSync(path.join(root, 'MY-00000000ffff'));
    fs.writeFileSync(path.join(root, 'my-00000000000f'), 'a file named like an id');
    warns.length = 0;
    const list = store.list().map((e) => e.id);
    assert.deepStrictEqual(list, [good.id], 'only the good one');
    assert.strictEqual(warns.length, bads.length + 1, 'one warning per bad folder and the file: ' + warns.length);
    assert.ok(warns.every((w) => !/[\\/]|my-/.test(w)), 'no path or id in a warning: ' + warns[0]);
    for (const b of bads) assert.ok(!store.frames(b).ok && !store.has(b), `${b}: not served`);
    // links
    const linkId = 'my-0000000000aa';
    if (linkOk(outside, path.join(root, linkId))) {
      assert.ok(!store.has(linkId), 'a link named like an id is not a character');
      assert.ok(!store.delete(linkId).ok, 'and cannot be deleted through');
      assert.ok(!store.rename(linkId, 'x').ok);
      assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'what it points at is untouched');
      fs.rmSync(path.join(root, linkId));
    }
    const fileLink = copyOf('my-0000000000ab', (d) => { fs.rmSync(path.join(d, 'working.webp')); });
    if (linkOk(path.join(root, good.id, 'working.webp'), path.join(root, fileLink, 'working.webp'))) assert.ok(!store.has(fileLink) && !store.frames(fileLink).ok, 'a frame that is a link is refused');
    fs.rmSync(path.join(root, fileLink), { recursive: true, force: true });
    // the record the link points at is right in every field, so only the link itself can be what refuses it
    const jsonLink = copyOf('my-0000000000ac', (d) => { fs.rmSync(path.join(d, 'character.json')); });
    const rightRecord = path.join(outside, 'record.json');
    fs.writeFileSync(rightRecord, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, good.id, 'character.json'), 'utf8')), id: jsonLink }));
    if (linkOk(rightRecord, path.join(root, jsonLink, 'character.json'))) assert.ok(!store.has(jsonLink), 'a record that is a link is refused');
    // a good record over a broken picture is refused at the read, not handed to the window
    const broken = copyOf('my-0000000000ad', (d) => { fs.writeFileSync(path.join(d, 'waiting.webp'), 'not a picture'); });
    assert.ok(store.has(broken) && !store.frames(broken).ok, 'the bytes are checked again');
  }
  // --- a root that is a link is not used ---
  {
    const { root, store, outside } = setup();
    fs.mkdirSync(path.dirname(root), { recursive: true });
    if (linkOk(outside, root)) {
      assert.deepStrictEqual(store.list(), []);
      assert.ok(!store.save(NEW, 'x').ok, 'no save through a linked root');
      assert.deepStrictEqual(tree(outside), ['keep.txt']);
    }
  }
  // --- rename and delete; hostile ids change nothing ---
  {
    const { root, store, outside } = setup();
    const a = saved(store.save(NEW, 'Greta'));
    const r = store.rename(a.id, 'Greta <B>');
    assert.deepStrictEqual(r, { ok: true, id: a.id, name: 'Greta B' }, 'the id stays');
    assert.strictEqual(store.list()[0].name, 'Greta B');
    assert.deepStrictEqual(tree(path.join(root, a.id)).filter((f) => /tmp/.test(f)), [], 'no temp left');
    const before = tree(root);
    for (const n of ['', ' ', '<>', 'a\nb', 'x'.repeat(41), null, 7]) assert.ok(!store.rename(a.id, n).ok, 'a bad name: ' + JSON.stringify(n));
    assert.strictEqual(store.list()[0].name, 'Greta B', 'a refused rename changes nothing');
    const hostile: unknown[] = ['..', '../outside', '../../outside', path.join('..', 'outside'), outside, '/etc', 'C:\\Windows', 'my-', 'my-xyz', 'my-00000000000', 'my-0000000000000', 'MY-000000000000', `${a.id}/..`, `${a.id}\n`, `..\\${a.id}`, '', null, undefined, 7, {}, [a.id], '__proto__'];
    for (const id of hostile) {
      assert.ok(!store.has(id), 'has: ' + JSON.stringify(id));
      assert.ok(!store.frames(id).ok, 'frames: ' + JSON.stringify(id));
      assert.ok(!store.rename(id, 'x').ok, 'rename: ' + JSON.stringify(id));
      assert.ok(!store.delete(id).ok, 'delete: ' + JSON.stringify(id));
      assert.ok(!store.export(id, outside).ok, 'export: ' + JSON.stringify(id));
    }
    assert.ok(!store.delete('my-000000000000').ok, 'an id main did not issue');
    // a whole valid character outside the root, whose record names the hostile id: only the id's own check can refuse it
    const evil = path.join(path.dirname(path.dirname(root)), 'evil');
    fs.cpSync(path.join(root, a.id), evil, { recursive: true });
    const evilId = path.join('..', '..', 'evil');
    fs.writeFileSync(path.join(evil, 'character.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, a.id, 'character.json'), 'utf8')), id: evilId }));
    assert.ok(!store.has(evilId) && !store.frames(evilId).ok && !store.rename(evilId, 'x').ok && !store.delete(evilId).ok, 'a path is not an id, even with a good record behind it');
    assert.ok(fs.existsSync(path.join(evil, 'working.webp')), 'nothing outside was removed');
    assert.deepStrictEqual(tree(root), before, 'nothing changed');
    assert.deepStrictEqual(tree(outside), ['keep.txt'], 'nothing outside');
    assert.deepStrictEqual(store.delete(a.id), { ok: true });
    assert.deepStrictEqual(tree(root), [], 'the folder is gone');
    assert.ok(!store.delete(a.id).ok, 'once');
  }
  // --- export (US4 scenario 3) ---
  {
    const { store, outside } = setup();
    const a = saved(store.save(NEW, 'Greta B'));
    const r = store.export(a.id, outside);
    assert.ok(r.ok);
    const to = (r as { to: string }).to;
    assert.strictEqual(to, path.join(outside, 'greta-b'));
    assert.deepStrictEqual(tree(to), ['blink.webp', 'character.json', 'resting.webp', 'waiting.webp', 'working.webp']);
    const doc = fs.readFileSync(path.join(to, 'character.json'), 'utf8');
    assert.deepStrictEqual(Object.keys(JSON.parse(doc)).sort(), ['blink', 'created', 'face', 'madeWith', 'name', 'style', 'v'], 'the JSON: name, points, style, date, made with');
    assert.strictEqual(JSON.parse(doc).madeWith, 'Codex');
    assert.ok(!/description|prompt/i.test(doc), 'no description or prompt');
    // an existing export is not overwritten
    fs.writeFileSync(path.join(to, 'working.webp'), 'mine');
    const r2 = store.export(a.id, outside);
    assert.strictEqual((r2 as { to: string }).to, path.join(outside, 'greta-b (2)'), 'a suffix');
    assert.strictEqual(fs.readFileSync(path.join(to, 'working.webp'), 'utf8'), 'mine', 'the old file is untouched');
    assert.strictEqual((store.export(a.id, outside) as { to: string }).to, path.join(outside, 'greta-b (3)'));
    // a link in the way is not followed
    const inside = path.join(outside, 'elsewhere');
    fs.mkdirSync(inside);
    const b = saved(store.save(NEW, 'Linked'));
    if (linkOk(inside, path.join(outside, 'linked'))) {
      assert.strictEqual((store.export(b.id, outside) as { to: string }).to, path.join(outside, 'linked (2)'), 'a link at the name is passed over');
      assert.deepStrictEqual(tree(inside), [], 'and nothing went through it');
    }
    if (linkOk(path.join(outside, 'no-such-thing'), path.join(outside, 'dangling'))) {
      const c = saved(store.save(NEW, 'Dangling'));
      assert.strictEqual((store.export(c.id, outside) as { to: string }).to, path.join(outside, 'dangling (2)'), 'a dangling link too');
      assert.ok(!fs.existsSync(path.join(outside, 'no-such-thing')), 'nothing was made through it');
    }
    // a target that is a link, a file, relative or missing
    if (linkOk(inside, path.join(outside, 'target-link'))) assert.ok(!store.export(a.id, path.join(outside, 'target-link')).ok, 'a linked target is refused');
    assert.deepStrictEqual(tree(inside), []);
    assert.ok(!store.export(a.id, path.join(outside, 'keep.txt')).ok, 'a file');
    assert.ok(!store.export(a.id, path.join(outside, 'missing')).ok, 'missing');
    assert.ok(!store.export(a.id, 'relative').ok, 'relative');
    // a failed write removes the new folder
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realFs = require('fs') as typeof fs;
    const write = realFs.writeFileSync;
    const n = saved(store.save(NEW, 'Half'));
    realFs.writeFileSync = ((f: fs.PathOrFileDescriptor, ...rest: unknown[]) => { if (String(f).endsWith('character.json')) throw new Error('ENOSPC'); return (write as (...a: unknown[]) => void)(f, ...rest); }) as typeof fs.writeFileSync;
    let fail;
    try { fail = store.export(n.id, outside); } finally { realFs.writeFileSync = write; }
    assert.ok(!fail.ok && !fs.existsSync(path.join(outside, 'half')), 'nothing half-written');
  }
  // --- the slug ---
  for (const [name, want] of [['Greta B', 'greta-b'], ['  ..//..\\etc ', 'etc'], ['../../x', 'x'], ['Café Noir', 'cafe-noir'], ['日本語', 'character'], ['<>', 'character'], ['con', 'character-con'], ['NUL', 'character-nul'], ['com1', 'character-com1'], ['a'.repeat(39) + '-b-c', 'a'.repeat(39)]] as const) {
    assert.strictEqual(nameSlug(name), want, 'slug of ' + name);
  }
  // --- the source (SC-003, T034) ---
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'charstore.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(!/from 'electron'|require\('electron'\)/.test(src), 'no Electron import');
    assert.ok(!/nativeImage/.test(src), 'no decoder (SC-003)');
    assert.ok(!/\b(writeFile|copyFile|cp|appendFile|symlink|link|chmod|chown)(Sync)?\(/.test(src.replace(/fs\.writeFileSync\(/g, 'W(')), 'only writeFileSync writes');
    // every path a write or remove takes starts from the root, an id's folder, or the new export folder: a static list of the first arguments
    const firstArgs = [...src.matchAll(/fs\.(writeFileSync|mkdirSync|renameSync|rmSync)\(([^,)]+(?:\([^)]*\))?[^,)]*)/g)].map((m) => m[2].trim());
    const allowed = /^(this\.root|tmp|dir|dest|candidate|path\.join\((tmp|dest|this\.root))$/;
    assert.ok(firstArgs.length >= 10, 'the scan sees the writes: ' + firstArgs.length);
    for (const a of firstArgs) assert.ok(allowed.test(a), `a write from an unexpected path: ${a}`);
    assert.ok(/const candidate = path\.join\(target, /.test(src), 'the export folder is made inside the picked folder');
    assert.ok(/const tmp = path\.join\(this\.root, TMP_PREFIX/.test(src) && /const tmp = path\.join\(dir, /.test(src), 'temp names are under the root');
    assert.ok(/CHARACTER_ID_RE\.test\(id\) \? path\.join\(this\.root, id\) : null/.test(src), 'an id is checked before it becomes a path');
    assert.ok((src.match(/recursive: true, force: true/g) ?? []).length <= 4, 'few recursive removes');
  }
  console.log('test-charstore: ok');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
