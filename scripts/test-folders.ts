/** Unit tests for the saved folder list: `npm run test:folders`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FolderStore, parseSavedFloors, parseSavedFolders, restoreMode } from '../src/main/folders';
import { GROUND, GROUND_NAME } from '../src/shared/floors';

const abs = (p: string): string => path.resolve('/', p);
assert.deepStrictEqual(parseSavedFolders('not json'), []);
assert.deepStrictEqual(parseSavedFolders('{"folders":5}'), []);
assert.deepStrictEqual(parseSavedFolders('null'), []);
const parsed = parseSavedFolders(
  JSON.stringify({
    folders: [
      { workspace: abs('a'), permMode: 'ask', hidden: true, model: 'auto', effort: 'high' },
      { workspace: abs('a') }, // duplicate
      { workspace: 'relative/path' }, // not absolute
      { workspace: 5 },
      null,
      'x',
      { workspace: abs('b'), permMode: 'root', effort: 'turbo', model: 7 },
    ],
  }),
);
assert.strictEqual(parsed.length, 2);
assert.deepStrictEqual(parsed[0], { workspace: abs('a'), permMode: 'ask', hidden: true, closed: undefined, model: 'auto', effort: 'high', contextTier: undefined, maxAiCredits: undefined, floor: undefined });
assert.deepStrictEqual(parsed[1], { workspace: abs('b'), permMode: 'read-only', hidden: false, closed: undefined, model: undefined, effort: undefined, contextTier: undefined, maxAiCredits: undefined, floor: undefined }, 'unknown values fall back to safe defaults');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-'));
try {
  const file = path.join(dir, 'sub', 'folders.json');
  const s = new FolderStore(file);
  assert.deepStrictEqual(s.load(), [], 'missing file = empty list');
  s.upsert({ workspace: abs('proj'), permMode: 'allow', model: 'auto' });
  s.upsert({ workspace: abs('other'), permMode: 'read-only' });
  assert.ok(s.setHidden(abs('proj'), true));
  s.upsert({ workspace: abs('proj'), permMode: 'ask' }); // refresh keeps hidden
  assert.ok(!s.setHidden(abs('nope'), true));
  // survives a restart
  const again = new FolderStore(file);
  const l = again.load();
  assert.deepStrictEqual(l.map((f) => [f.workspace, f.permMode, f.hidden]), [[abs('proj'), 'ask', true], [abs('other'), 'read-only', false]]);
  assert.ok(again.remove(abs('proj')));
  assert.ok(!again.remove(abs('proj')));
  assert.deepStrictEqual(new FolderStore(file).load().map((f) => f.workspace), [abs('other')]);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0, 'no temp files left behind');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'file is private');
  // corrupt file
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new FolderStore(file).load(), []);
  // unwritable location: no throw
  const bad = new FolderStore(path.join(dir, 'sub', 'folders.json', 'x', 'y.json'));
  bad.upsert({ workspace: abs('z'), permMode: 'read-only' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders2-'));
  try {
    const f2 = path.join(d2, 'f.json');
    const st = new FolderStore(f2);
    st.upsert({ workspace: abs('r1'), permMode: 'read-only' });
    assert.ok(st.setClosed(abs('r1'), true));
    assert.ok(st.setPermMode(abs('r1'), 'allow'));
    assert.ok(!st.setClosed(abs('nope'), true));
    const again = new FolderStore(f2).load();
    assert.strictEqual(again[0].closed, true, 'closed door survives a restart');
    assert.strictEqual(again[0].permMode, 'allow', 'Allow all is saved as chosen (spec 003 FR-025)');
    st.upsert({ workspace: abs('r1'), permMode: 'allow' });
    st.upsert({ workspace: abs('r2'), permMode: 'ask' });
    st.remove(abs('r2'));
    assert.strictEqual(new FolderStore(f2).load()[0].closed, true, 'closed survives new/removed folders');
    st.setClosed(abs('r1'), false);
    assert.strictEqual(new FolderStore(f2).load()[0].closed, undefined);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
}
{
  // per-folder credit cap (spec 011): a plain number, validated on read and write
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders3-'));
  try {
    const f3 = path.join(d3, 'f.json');
    const st = new FolderStore(f3);
    st.upsert({ workspace: abs('c1'), permMode: 'ask', maxAiCredits: 45 });
    assert.strictEqual(new FolderStore(f3).load()[0].maxAiCredits, 45, 'cap survives a restart');
    assert.ok(st.setMaxAiCredits(abs('c1'), '60.25'));
    assert.strictEqual(new FolderStore(f3).load()[0].maxAiCredits, 60.25);
    assert.ok(st.setMaxAiCredits(abs('c1'), -1), 'invalid clears');
    assert.strictEqual(new FolderStore(f3).load()[0].maxAiCredits, undefined);
    assert.ok(!st.setMaxAiCredits(abs('nope'), 50));
    assert.strictEqual(parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('x'), maxAiCredits: 'lots' }, { workspace: abs('y'), maxAiCredits: 1e9 }] })).map((f) => f.maxAiCredits).join(','), ',');
  } finally {
    fs.rmSync(d3, { recursive: true, force: true });
  }
}
// spec 003 FR-025/026: the saved mode is restored exactly, Allow all included, flagged "restored" only for Allow all
assert.deepStrictEqual(restoreMode('allow'), { mode: 'allow', restored: true }, 'Allow all comes back as Allow all, flagged');
assert.deepStrictEqual(restoreMode('ask'), { mode: 'ask', restored: false });
assert.deepStrictEqual(restoreMode('read-only'), { mode: 'read-only', restored: false });
{
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-mode-'));
  try {
    const f4 = path.join(d4, 'folders.json');
    const st = new FolderStore(f4);
    st.upsert({ workspace: abs('m1'), permMode: 'allow' });
    st.upsert({ workspace: abs('m2'), permMode: 'ask' });
    st.upsert({ workspace: abs('m3'), permMode: 'read-only' });
    const back = new FolderStore(f4).load();
    assert.deepStrictEqual(back.map((f) => f.permMode), ['allow', 'ask', 'read-only'], 'every mode survives a restart exactly');
    assert.ok(st.setPermMode(abs('m2'), 'allow'));
    assert.strictEqual(new FolderStore(f4).load()[1].permMode, 'allow', 'a switch to Allow all is saved as allow');
    st.upsert({ workspace: abs('m1'), permMode: 'read-only' });
    assert.strictEqual(new FolderStore(f4).load()[0].permMode, 'read-only', 'a later choice replaces it (per folder)');
    assert.strictEqual(new FolderStore(f4).load()[2].permMode, 'read-only', 'other folders are untouched');
    // an older file with allow is restored as allow
    fs.writeFileSync(f4, JSON.stringify({ folders: [{ workspace: abs('old'), permMode: 'allow', hidden: false }] }));
    assert.strictEqual(new FolderStore(f4).load()[0].permMode, 'allow');
  } finally {
    fs.rmSync(d4, { recursive: true, force: true });
  }
}
{
  // model choice and context tier (spec 030): saved in our own file only, unknown values dropped
  const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-model-'));
  try {
    const f5 = path.join(d5, 'f.json');
    const st = new FolderStore(f5);
    st.upsert({ workspace: abs('p1'), permMode: 'ask', model: 'auto', effort: 'low', maxAiCredits: 40 });
    assert.ok(st.setModelChoice(abs('p1'), { model: 'sim-deep', effort: 'high', contextTier: 'long' }));
    let back = new FolderStore(f5).load()[0];
    assert.deepStrictEqual([back.model, back.effort, back.contextTier, back.maxAiCredits, back.permMode], ['sim-deep', 'high', 'long', 40, 'ask'], 'only the model choice changes; the cap and mode stay');
    assert.ok(st.setModelChoice(abs('p1'), { model: 'sim-fast' }));
    back = new FolderStore(f5).load()[0];
    assert.deepStrictEqual([back.model, back.effort, back.contextTier], ['sim-fast', 'high', undefined], 'effort kept when not given, tier back to the default');
    assert.ok(st.setModelChoice(abs('p1'), { model: 'sim-deep', effort: null }));
    assert.strictEqual(new FolderStore(f5).load()[0].effort, undefined, 'null clears the effort');
    assert.ok(st.setModelChoice(abs('p1'), { model: 'sim-deep', effort: 'turbo' }));
    assert.strictEqual(new FolderStore(f5).load()[0].effort, undefined, 'an unknown effort is not saved');
    assert.ok(!st.setModelChoice(abs('nope'), { model: 'x' }));
    assert.ok(!st.setModelChoice(abs('p1'), { model: '' }));
    assert.ok(!st.setModelChoice(abs('p1'), { model: 'x'.repeat(101) }));
    // a file with junk or with a tier we do not know
    fs.writeFileSync(f5, JSON.stringify({ folders: [{ workspace: abs('a'), contextTier: 'long' }, { workspace: abs('b'), contextTier: 'huge' }, { workspace: abs('c'), contextTier: 5 }] }));
    assert.deepStrictEqual(new FolderStore(f5).load().map((f) => f.contextTier), ['long', undefined, undefined]);
    // a new session started with the saved folder refreshes the choice (tier included)
    const s2 = new FolderStore(f5);
    s2.load();
    s2.upsert({ workspace: abs('a'), permMode: 'ask', model: 'auto' });
    assert.strictEqual(new FolderStore(f5).load()[0].contextTier, undefined, 'a plain upsert (new session choice) resets the tier');
    // Copilot's own settings are never part of the file
    assert.ok(!fs.readFileSync(f5, 'utf8').match(/repoScope|modelChangeScope|pickerPersistence/));
  } finally {
    fs.rmSync(d5, { recursive: true, force: true });
  }
}
{
  // floors (spec 033): saved in the same file, folders keep everything else, a file from before floors still loads
  const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-floors-'));
  try {
    const f6 = path.join(d6, 'f.json');
    // a file written before this feature: one ground floor, on, every folder on it
    fs.writeFileSync(f6, JSON.stringify({ version: 1, folders: [{ workspace: abs('old1'), permMode: 'ask', hidden: true, closed: true, model: 'auto', effort: 'high', maxAiCredits: 50 }, { workspace: abs('old2') }] }));
    const st = new FolderStore(f6);
    st.load();
    assert.deepStrictEqual(st.floors(), { floors: [{ id: GROUND, name: GROUND_NAME, on: true }], lastFloor: GROUND });
    assert.strictEqual(st.floorOfFolder(abs('old1')), GROUND);
    assert.strictEqual(st.floorOfFolder(abs('unknown')), GROUND);
    const snapshot = (w: string): unknown => {
      const f = new FolderStore(f6).load().find((x) => x.workspace === w);
      return f && [f.permMode, f.hidden, f.closed, f.model, f.effort, f.contextTier, f.maxAiCredits];
    };
    const before = snapshot(abs('old1'));
    // create + move + restart
    const c = st.createFloor('Client A');
    assert.ok(c.ok);
    const ca = c.doc.floors[1].id;
    assert.ok(st.moveFolder(abs('old1'), ca));
    assert.ok(!st.moveFolder(abs('old1'), 'f-zzzzzzzz'), 'unknown floor refused');
    assert.ok(!st.moveFolder(abs('nope'), ca), 'unknown folder refused');
    let again = new FolderStore(f6);
    again.load();
    assert.strictEqual(again.floorOfFolder(abs('old1')), ca, 'folder floor survives a restart');
    assert.deepStrictEqual(again.floors().floors.map((f) => f.name), [GROUND_NAME, 'Client A']);
    assert.deepStrictEqual(snapshot(abs('old1')), before, 'moving changes nothing else about the folder (FR-005)');
    // on/off, Only and order survive a restart
    assert.ok(st.createFloor('Personal').ok);
    assert.ok(st.setFloorOn(ca, false).ok);
    const ids = st.floors().floors.map((f) => f.id);
    assert.ok(st.reorderFloors([ids[2], ids[0], ids[1]]).ok);
    again = new FolderStore(f6);
    again.load();
    assert.deepStrictEqual(again.floors().floors.map((f) => [f.name, f.on]), [['Personal', true], [GROUND_NAME, true], ['Client A', false]]);
    assert.ok(st.onlyFloor(ca).ok);
    again = new FolderStore(f6);
    again.load();
    assert.deepStrictEqual(again.floors().floors.map((f) => f.on), [false, false, true], 'Only survives a restart');
    // a new folder goes to the chosen floor, which becomes the default; unknown -> ground
    st.upsert({ workspace: abs('new1'), permMode: 'read-only', floor: ca });
    assert.strictEqual(st.floorOfFolder(abs('new1')), ca);
    assert.strictEqual(st.floors().lastFloor, ca);
    st.upsert({ workspace: abs('new2'), permMode: 'read-only', floor: 'f-zzzzzzzz' });
    assert.strictEqual(st.floorOfFolder(abs('new2')), GROUND);
    st.upsert({ workspace: abs('new1'), permMode: 'ask' }); // refresh keeps the floor
    assert.strictEqual(st.floorOfFolder(abs('new1')), ca);
    // delete: folders back on the ground floor in the same write, no folder lost, lastFloor reset
    assert.ok(!st.deleteFloor(GROUND).ok);
    assert.ok(st.deleteFloor(ca).ok);
    again = new FolderStore(f6);
    const folders = again.load();
    assert.deepStrictEqual(folders.map((f) => f.workspace), [abs('old1'), abs('old2'), abs('new1'), abs('new2')], 'no folder lost (SC-006)');
    assert.ok(folders.every((f) => f.floor === undefined), 'every folder back on the ground floor');
    assert.strictEqual(again.floors().lastFloor, GROUND);
    assert.deepStrictEqual(snapshot(abs('old1')), before);
    // a folder pointing at a floor that is not in the file is on the ground floor
    fs.writeFileSync(f6, JSON.stringify({ version: 1, floors: [{ id: GROUND, name: 'G', on: false }], folders: [{ workspace: abs('x'), floor: 'f-gonegone' }] }));
    const s3 = new FolderStore(f6);
    s3.load();
    assert.strictEqual(s3.floorOfFolder(abs('x')), GROUND);
    assert.strictEqual(s3.floors().floors[0].on, false, 'a ground floor that is off stays off');
    // damaged floors part: folders still load, floors fall back to the default
    assert.deepStrictEqual(parseSavedFloors('{{{'), { floors: [{ id: GROUND, name: GROUND_NAME, on: true }], lastFloor: GROUND });
    assert.deepStrictEqual(parseSavedFloors(JSON.stringify({ floors: 'x', folders: [] })).floors.length, 1);
    // the file holds only floor ids, names and on/off next to the folder data (FR-015)
    const text = fs.readFileSync(f6, 'utf8');
    assert.ok(!/token|secret|prompt/i.test(text));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f6).mode & 0o077, 0, 'file is private');
  } finally {
    fs.rmSync(d6, { recursive: true, force: true });
  }
}
console.log('folders tests passed');
