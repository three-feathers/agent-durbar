/** Unit tests for the saved folder list: `npm run test:folders`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FolderStore, adapterOf, parseAdapterId, parseDefaultAgent, parseLabel, parseLastSession, parseOpenSessions, parsePrevMarks, MAX_PREV_MARKS, parseSavedFloors, parseSavedFolders, restoreMode, sessionsToRestore, MAX_OPEN_SESSIONS, MAX_SESSION_NAMES, parseSessionNames } from '../src/main/folders';
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
assert.deepStrictEqual(parsed[0], { workspace: abs('a'), permMode: 'ask', hidden: true, closed: undefined, model: 'auto', effort: 'high', contextTier: undefined, maxAiCredits: undefined, floor: undefined, adapterId: undefined });
assert.deepStrictEqual(parsed[1], { workspace: abs('b'), permMode: 'read-only', hidden: false, closed: undefined, model: undefined, effort: undefined, contextTier: undefined, maxAiCredits: undefined, floor: undefined, adapterId: undefined }, 'unknown values fall back to safe defaults');

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
{
  // adapter id per folder (spec 012 T013, FR-042..FR-044)
  assert.strictEqual(parseAdapterId('codex'), 'codex');
  assert.strictEqual(parseAdapterId('future-agent'), 'future-agent', 'a well-formed unknown id is kept');
  const bad: unknown[] = ['copilot', 'Claude', '', '1x', 'a'.repeat(33), 5, null, undefined];
  for (const v of bad) {
    assert.strictEqual(parseAdapterId(v), undefined, `parseAdapterId(${JSON.stringify(v)})`);
    assert.strictEqual(adapterOf({ adapterId: parseAdapterId(v) }), 'copilot', `adapterOf(${JSON.stringify(v)})`);
  }
  assert.strictEqual(parseAdapterId('a'.repeat(32)), 'a'.repeat(32), '32 chars is the limit');
  assert.strictEqual(adapterOf({ adapterId: 'codex' }), 'codex');
  const parsedA = parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('a1'), adapterId: 'codex' }, { workspace: abs('a2'), adapterId: 'copilot' }, { workspace: abs('a3'), adapterId: 'Bad' }] }));
  assert.deepStrictEqual(parsedA.map((f) => f.adapterId), ['codex', undefined, undefined]);

  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-adapter-'));
  try {
    const f7 = path.join(d7, 'f.json');
    const read = (): { folders: Record<string, unknown>[] } => JSON.parse(fs.readFileSync(f7, 'utf8'));
    // (c) an old Copilot-only file: no adapterId is ever written
    const old = { version: 1, floors: [{ id: GROUND, name: GROUND_NAME, on: true }], lastFloor: GROUND, folders: [{ workspace: abs('o1'), permMode: 'ask', hidden: false, model: 'auto', maxAiCredits: 45 }, { workspace: abs('o2'), permMode: 'read-only', hidden: false }] };
    fs.writeFileSync(f7, JSON.stringify(old, null, 2));
    const before = fs.readFileSync(f7, 'utf8');
    const st = new FolderStore(f7);
    st.load();
    assert.ok(st.setHidden(abs('o1'), true));
    const afterText = fs.readFileSync(f7, 'utf8');
    assert.ok(!afterText.includes('adapterId'), 'Copilot-only file never gets adapterId');
    const expected = JSON.parse(before);
    expected.folders[0].hidden = true;
    assert.deepStrictEqual(JSON.parse(afterText), expected, 'only the change made differs');
    // byte-identical after a plain load and save
    fs.writeFileSync(f7, JSON.stringify({ version: 1, floors: old.floors, lastFloor: GROUND, folders: old.folders }, null, 2));
    const b0 = fs.readFileSync(f7, 'utf8');
    const stB = new FolderStore(f7);
    stB.load();
    assert.ok(stB.setHidden(abs('o1'), false)); // no-op value, forces a save
    assert.strictEqual(fs.readFileSync(f7, 'utf8'), b0, 'load + save of a Copilot-only file is byte-identical');

    // (d) an unknown well-formed id survives a load, another write and a reload
    fs.writeFileSync(f7, JSON.stringify({ version: 1, folders: [{ workspace: abs('u1'), permMode: 'ask', hidden: false, adapterId: 'future-agent' }] }));
    const stD = new FolderStore(f7);
    stD.load();
    assert.ok(stD.setPermMode(abs('u1'), 'allow'));
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'future-agent');
    assert.strictEqual(read().folders[0].adapterId, 'future-agent', 'written back unchanged');

    // (e) upsert
    fs.rmSync(f7);
    const stE = new FolderStore(f7);
    stE.upsert({ workspace: abs('e1'), permMode: 'ask', adapterId: 'codex' });
    assert.strictEqual(stE.get(abs('e1'))?.adapterId, 'codex', 'a new entry can start with an adapter');
    stE.upsert({ workspace: abs('e1'), permMode: 'allow' });
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'codex', 'upsert without adapterId keeps it');
    stE.upsert({ workspace: abs('e1'), permMode: 'allow', adapterId: 'claude' });
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'claude', 'upsert with adapterId sets it');
    stE.upsert({ workspace: abs('e1'), permMode: 'allow', adapterId: 'Bad Id' });
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'claude', 'a malformed id given to upsert keeps the existing value');
    stE.upsert({ workspace: abs('e1'), permMode: 'allow', adapterId: undefined });
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'claude', 'an explicit undefined keeps the existing value');
    stE.upsert({ workspace: abs('e1'), permMode: 'allow', adapterId: 'copilot' });
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, undefined, 'copilot clears the id');
    stE.upsert({ workspace: abs('e3'), permMode: 'ask', adapterId: 'Bad Id' });
    assert.strictEqual(stE.get(abs('e3'))?.adapterId, undefined, 'a new entry with a malformed id gets none');
    stE.upsert({ workspace: abs('e2'), permMode: 'ask' });
    assert.strictEqual(stE.get(abs('e2'))?.adapterId, undefined, 'a new entry gets none');
    assert.ok(!('adapterId' in read().folders[1]) || read().folders[1].adapterId === undefined);
    assert.ok(!fs.readFileSync(f7, 'utf8').includes('"adapterId": "copilot"'));

    // (f) setAdapterId
    fs.rmSync(f7);
    const stF = new FolderStore(f7);
    stF.upsert({ workspace: abs('s1'), permMode: 'ask', model: 'auto', effort: 'high', maxAiCredits: 45 });
    stF.createFloor('Two');
    const fl = stF.floors().floors[1].id;
    assert.ok(stF.moveFolder(abs('s1'), fl));
    assert.ok(stF.setHidden(abs('s1'), true));
    assert.ok(stF.setClosed(abs('s1'), true));
    const others = (): unknown => {
      const f = new FolderStore(f7).load()[0];
      return [f.model, f.floor, f.maxAiCredits, f.permMode, f.hidden, f.closed, f.effort, f.workspace];
    };
    const snap = others();
    assert.ok(stF.setAdapterId(abs('s1'), 'codex'));
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, 'codex');
    assert.deepStrictEqual(others(), snap, 'codex: other fields unchanged');
    assert.ok(stF.setAdapterId(abs('s1'), 'copilot'));
    assert.strictEqual(new FolderStore(f7).load()[0].adapterId, undefined);
    assert.ok(!fs.readFileSync(f7, 'utf8').includes('adapterId'), 'copilot removes the field from the file');
    assert.deepStrictEqual(others(), snap, 'copilot: other fields unchanged');
    assert.ok(stF.setAdapterId(abs('s1'), 'codex'));
    const text = fs.readFileSync(f7, 'utf8');
    assert.ok(!stF.setAdapterId(abs('s1'), 'Bad Id'));
    assert.ok(!stF.setAdapterId(abs('s1'), 5));
    assert.ok(!stF.setAdapterId(abs('s1'), undefined));
    assert.ok(!stF.setAdapterId(abs('s1'), ''));
    assert.strictEqual(fs.readFileSync(f7, 'utf8'), text, 'a refused id leaves the file unchanged');
    assert.ok(!stF.setAdapterId(abs('nope'), 'codex'));
    assert.strictEqual(fs.readFileSync(f7, 'utf8'), text, 'an unknown folder leaves the file unchanged');
    assert.deepStrictEqual(others(), snap);

    // (g) private file
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f7).mode & 0o077, 0, 'file stays private');
  } finally {
    fs.rmSync(d7, { recursive: true, force: true });
  }
}
// spec 006 FR-018: the folder display name
{
  assert.strictEqual(parseLabel('  Client   site '), 'Client site');
  assert.strictEqual(parseLabel(''), undefined);
  assert.strictEqual(parseLabel('   '), undefined);
  assert.strictEqual(parseLabel('x'.repeat(40)), 'x'.repeat(40));
  assert.strictEqual(parseLabel('x'.repeat(41)), undefined);
  assert.strictEqual(parseLabel('é'.repeat(40)), 'é'.repeat(40), 'characters, not UTF-16 units');
  assert.strictEqual(parseLabel('a\u0007b'), undefined, 'no control characters');
  assert.strictEqual(parseLabel(42), undefined);
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders3-'));
  try {
    const f3 = path.join(d3, 'f.json');
    const st = new FolderStore(f3);
    st.upsert({ workspace: abs('l1'), permMode: 'read-only' });
    assert.deepStrictEqual(st.setLabel(abs('l1'), ' Website '), { label: 'Website' });
    assert.strictEqual(st.setLabel(abs('nope'), 'x'), false);
    assert.strictEqual(new FolderStore(f3).load()[0].label, 'Website', 'the label survives a restart');
    st.upsert({ workspace: abs('l1'), permMode: 'ask' });
    assert.strictEqual(new FolderStore(f3).load()[0].label, 'Website', 'a new session in the folder keeps the label');
    assert.deepStrictEqual(st.setLabel(abs('l1'), ''), { label: undefined });
    assert.strictEqual(new FolderStore(f3).load()[0].label, undefined, 'empty goes back to the folder name');
    const bad = parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('l2'), permMode: 'ask', label: 'y'.repeat(41) }, { workspace: abs('l3'), permMode: 'ask', label: { x: 1 } }] }));
    assert.deepStrictEqual(bad.map((f) => f.label), [undefined, undefined], 'a bad saved label is ignored, the folder kept');
  } finally {
    fs.rmSync(d3, { recursive: true, force: true });
  }
}
// spec 043 FR-009: the folder's default agent (an id only)
{
  assert.strictEqual(parseDefaultAgent('pirate'), 'pirate');
  assert.strictEqual(parseDefaultAgent('user:reviewer@v2/x.y-z'), 'user:reviewer@v2/x.y-z');
  assert.strictEqual(parseDefaultAgent(''), undefined);
  assert.strictEqual(parseDefaultAgent('a b'), undefined);
  assert.strictEqual(parseDefaultAgent('x'.repeat(101)), undefined);
  assert.strictEqual(parseDefaultAgent(7), undefined);
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-'));
  try {
    const f4 = path.join(d4, 'f.json');
    const st = new FolderStore(f4);
    st.upsert({ workspace: abs('d1'), permMode: 'read-only' });
    assert.deepStrictEqual(st.setDefaultAgent(abs('d1'), 'pirate'), { defaultAgent: 'pirate' });
    assert.strictEqual(st.setDefaultAgent(abs('d1'), 'bad id'), false, 'a bad id changes nothing');
    assert.strictEqual(st.setDefaultAgent(abs('nope'), 'pirate'), false);
    assert.strictEqual(new FolderStore(f4).load()[0].defaultAgent, 'pirate', 'the default survives a restart');
    st.upsert({ workspace: abs('d1'), permMode: 'ask' });
    assert.strictEqual(new FolderStore(f4).load()[0].defaultAgent, 'pirate', 'a new session in the folder keeps the default');
    assert.deepStrictEqual(st.setDefaultAgent(abs('d1'), null), { defaultAgent: undefined });
    assert.ok(!('defaultAgent' in new FolderStore(f4).load()[0]), 'cleared means not written');
    const bad = parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('d2'), permMode: 'ask', defaultAgent: 'a b' }, { workspace: abs('d3'), permMode: 'ask', defaultAgent: ['x'] }] }));
    assert.deepStrictEqual(bad.map((f) => f.defaultAgent), [undefined, undefined], 'a bad saved default is ignored, the folder kept');
  } finally {
    fs.rmSync(d4, { recursive: true, force: true });
  }
}
// spec 006 FR-020: the folder's last session (an id and its harness only)
{
  assert.deepStrictEqual(parseLastSession({ id: '5f0c-1', adapterId: 'claude' }), { id: '5f0c-1', adapterId: 'claude' });
  assert.deepStrictEqual(parseLastSession({ id: 'abc', adapterId: 'copilot' }), { id: 'abc' }, 'copilot is the default, not written');
  assert.strictEqual(parseLastSession({ id: '../x' }), undefined);
  assert.strictEqual(parseLastSession({ id: '' }), undefined);
  assert.strictEqual(parseLastSession({ id: 'a'.repeat(101) }), undefined);
  assert.strictEqual(parseLastSession('abc'), undefined);
  assert.deepStrictEqual(parseLastSession({ id: 'abc', adapterId: 'Bad Id' }), { id: 'abc' }, 'a bad harness id falls back to copilot');
  const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders-'));
  try {
    const f5 = path.join(d5, 'f.json');
    const st = new FolderStore(f5);
    st.upsert({ workspace: abs('s1'), permMode: 'read-only' });
    assert.strictEqual(st.setLastSession(abs('s1'), 'sess-1', 'claude'), true);
    assert.deepStrictEqual(new FolderStore(f5).load()[0].lastSession, { id: 'sess-1', adapterId: 'claude' }, 'survives a restart');
    const t0 = fs.statSync(f5).mtimeMs;
    fs.utimesSync(f5, new Date(0), new Date(0));
    st.setLastSession(abs('s1'), 'sess-1', 'claude');
    assert.strictEqual(fs.statSync(f5).mtimeMs, 0, 'the same session is not written again');
    assert.ok(t0 > 0);
    st.upsert({ workspace: abs('s1'), permMode: 'ask' });
    assert.strictEqual(new FolderStore(f5).load()[0].lastSession?.id, 'sess-1', 'a new session in the folder keeps it until it gets a message');
    st.clearLastSession(abs('s1'), 'other');
    assert.strictEqual(new FolderStore(f5).load()[0].lastSession?.id, 'sess-1', 'removing another session keeps it');
    st.clearLastSession(abs('s1'), 'sess-1');
    assert.ok(!('lastSession' in new FolderStore(f5).load()[0]), 'removing that session forgets it');
    assert.strictEqual(st.setLastSession(abs('nope'), 'x', undefined), false, 'only saved folders');
    assert.strictEqual(st.setLastSession(abs('s1'), 'bad id', undefined), false, 'a bad id is refused');
  } finally {
    fs.rmSync(d5, { recursive: true, force: true });
  }
}
// spec 052 FR-088: every open session of a folder (at most 6) comes back; files with only lastSession still work
{
  assert.strictEqual(MAX_OPEN_SESSIONS, 6);
  assert.strictEqual(parseOpenSessions('x'), undefined);
  assert.strictEqual(parseOpenSessions([]), undefined);
  assert.deepStrictEqual(parseOpenSessions([{ id: 'a' }, { id: 'a' }, { id: '../x' }, 5, { id: 'b', adapterId: 'claude' }]), [{ id: 'a' }, { id: 'b', adapterId: 'claude' }], 'bad and duplicate entries dropped');
  assert.deepStrictEqual(parseOpenSessions(Array.from({ length: 9 }, (_, i) => ({ id: 's' + i })))?.map((x) => x.id), ['s3', 's4', 's5', 's6', 's7', 's8'], 'the newest 6 kept');
  assert.deepStrictEqual(sessionsToRestore({}), [], 'nothing saved: the folder starts fresh');
  assert.deepStrictEqual(sessionsToRestore({ lastSession: { id: 'L' } }), [{ id: 'L' }], 'an older file with only lastSession');
  assert.deepStrictEqual(sessionsToRestore({ lastSession: { id: 'b' }, openSessions: [{ id: 'a' }, { id: 'b' }, { id: 'c', adapterId: 'codex' }] }), [{ id: 'b' }, { id: 'a' }, { id: 'c', adapterId: 'codex' }], 'the last session first, then the others in order');
  // an older file reads back unchanged
  const old = parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('o'), lastSession: { id: 'L1' } }] }));
  assert.ok(!('openSessions' in old[0]));
  assert.deepStrictEqual(sessionsToRestore(old[0]), [{ id: 'L1' }]);
  const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders6-'));
  try {
    const f6 = path.join(d6, 'f.json');
    const st = new FolderStore(f6);
    st.upsert({ workspace: abs('m'), permMode: 'ask' });
    assert.strictEqual(st.addOpenSession(abs('nope'), 'x', undefined), false, 'only saved folders');
    assert.strictEqual(st.addOpenSession(abs('m'), 'bad id', undefined), false, 'a bad id is refused');
    for (const id of ['s1', 's2', 's3']) assert.ok(st.addOpenSession(abs('m'), id, id === 's2' ? 'claude' : undefined));
    st.setLastSession(abs('m'), 's2', 'claude');
    const mtime = fs.statSync(f6).mtimeMs;
    st.addOpenSession(abs('m'), 's1', undefined); // already there: no write
    assert.strictEqual(fs.statSync(f6).mtimeMs, mtime);
    let back = new FolderStore(f6).load()[0];
    assert.deepStrictEqual(back.openSessions, [{ id: 's1' }, { id: 's2', adapterId: 'claude' }, { id: 's3' }], 'survives a restart');
    assert.deepStrictEqual(sessionsToRestore(back).map((x) => x.id), ['s2', 's1', 's3']);
    // past 6, the oldest that is not the last session is dropped
    for (const id of ['s4', 's5', 's6', 's7', 's8']) st.addOpenSession(abs('m'), id, undefined);
    back = new FolderStore(f6).load()[0];
    assert.deepStrictEqual(back.openSessions?.map((x) => x.id), ['s2', 's4', 's5', 's6', 's7', 's8'], 'capped at 6, the last session kept');
    st.removeOpenSession(abs('m'), 's5');
    st.removeOpenSession(abs('m'), 'zz'); // unknown: nothing changes
    back = new FolderStore(f6).load()[0];
    assert.deepStrictEqual(back.openSessions?.map((x) => x.id), ['s2', 's4', 's6', 's7', 's8'], 'a removed session is not restored');
    st.removeOpenSession(abs('m'), 's2');
    back = new FolderStore(f6).load()[0];
    assert.ok(!('lastSession' in back), 'removing the last session forgets it too');
    for (const id of ['s4', 's6', 's7', 's8']) st.removeOpenSession(abs('m'), id);
    assert.ok(!('openSessions' in new FolderStore(f6).load()[0]), 'an empty list is not written');
  } finally {
    fs.rmSync(d6, { recursive: true, force: true });
  }
}
// Spec 006 FR-026: pins and hides of Previous sessions (ids only, strict id shape, cap 200, exclusive, no migration)
{
  const OK = 'a1b2c3d4-0000-4000-8000-000000000001';
  assert.strictEqual(parsePrevMarks('x'), undefined);
  assert.strictEqual(parsePrevMarks([]), undefined);
  assert.deepStrictEqual(
    parsePrevMarks([{ src: 'copilot', id: OK }, { src: 'copilot', id: OK }, { src: 'vscode', id: 'abc123/def-456' }, { src: 'codex', id: 'x' }, null, 5, { src: 'copilot' }, { id: OK }]),
    [{ src: 'copilot', id: OK }, { src: 'vscode', id: 'abc123/def-456' }, { src: 'codex', id: 'x' }],
    'bad shapes dropped, duplicates collapsed',
  );
  // the id allow-list: traversal, drive letters, absolute paths, empty, overlong, control characters, extra fields
  for (const bad of ['../x', '..\\x', 'a/../b', '..', '.hidden', 'C:\\x', 'C:/x', '/etc/passwd', '\\\\host\\share', '', 'a'.repeat(101), 'a\u0000b', 'a\nb', 'a b', 'a/b', 'a.b', 'a:b', '-x', '\u0007'])
    assert.strictEqual(parsePrevMarks([{ src: 'copilot', id: bad }]), undefined, `refused for an agent session: ${JSON.stringify(bad)}`);
  for (const bad of ['abc', 'a/b/c', '../x/y', 'a/..', '../..', '/a/b', 'a\\b/c', 'a/b\u0000', 'C:/a/b', 'a//b'])
    assert.strictEqual(parsePrevMarks([{ src: 'vscode', id: bad }]), undefined, `refused for a VS Code key: ${JSON.stringify(bad)}`);
  assert.strictEqual(parsePrevMarks([{ src: 'Copilot', id: OK }, { src: '../x', id: OK }, { src: '', id: OK }, { src: 'a'.repeat(40), id: OK }]), undefined, 'bad src');
  assert.strictEqual(parsePrevMarks(Array.from({ length: 300 }, (_, i) => ({ src: 'copilot', id: 's' + i })))?.length, MAX_PREV_MARKS);
  assert.strictEqual(parsePrevMarks(Array.from({ length: 300 }, (_, i) => ({ src: 'copilot', id: 's' + i })))?.[0].id, 's100', 'the newest 200 kept');

  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-folders7-'));
  try {
    const f7 = path.join(d7, 'f.json');
    const st = new FolderStore(f7);
    st.upsert({ workspace: abs('m'), permMode: 'ask' });
    const reload = (): SavedFolderLike => new FolderStore(f7).load()[0];
    type SavedFolderLike = ReturnType<FolderStore['list']>[number];
    assert.ok(!('prevPinned' in reload()) && !('prevHidden' in reload()), 'no migration: nothing pinned or hidden');
    assert.strictEqual(st.markPrevious(abs('nope'), 'copilot', OK, 'pin'), false, 'only saved folders');
    assert.strictEqual(st.markPrevious(abs('m'), 'copilot', '../x', 'pin'), false, 'a bad id is refused');
    assert.strictEqual(st.markPrevious(abs('m'), 'copilot', OK, 'delete'), false, 'a bad mark is refused');
    assert.strictEqual(st.markPrevious(abs('m'), 'vscode', OK, 'pin'), false, 'a session id is not a VS Code key');
    assert.strictEqual(fs.existsSync(f7) ? fs.readFileSync(f7, 'utf8').includes('prev') : false, false, 'refusals write nothing');
    assert.ok(st.markPrevious(abs('m'), 'copilot', OK, 'pin'));
    assert.ok(st.markPrevious(abs('m'), 'vscode', 'h1/c1', 'hide'));
    assert.deepStrictEqual(reload().prevPinned, [{ src: 'copilot', id: OK }]);
    assert.deepStrictEqual(reload().prevHidden, [{ src: 'vscode', id: 'h1/c1' }], 'survives a restart');
    const mt = fs.statSync(f7).mtimeMs;
    st.markPrevious(abs('m'), 'copilot', OK, 'pin'); // no change: no write
    st.markPrevious(abs('m'), 'copilot', OK, 'unhide');
    st.markPrevious(abs('m'), 'codex', 'zz', 'unpin');
    assert.strictEqual(fs.statSync(f7).mtimeMs, mt, 'no rewrite when unchanged');
    st.markPrevious(abs('m'), 'copilot', OK, 'hide'); // hiding unpins
    assert.ok(!('prevPinned' in reload()));
    assert.deepStrictEqual(reload().prevHidden?.map((x) => x.id), ['h1/c1', OK]);
    st.markPrevious(abs('m'), 'copilot', OK, 'pin'); // pinning unhides
    assert.deepStrictEqual(reload().prevPinned, [{ src: 'copilot', id: OK }]);
    assert.deepStrictEqual(reload().prevHidden?.map((x) => x.id), ['h1/c1']);
    for (let i = 0; i < 205; i++) st.markPrevious(abs('m'), 'copilot', 'p' + i, 'pin');
    assert.strictEqual(reload().prevPinned?.length, MAX_PREV_MARKS, 'capped at 200');
    assert.strictEqual(reload().prevPinned?.[0].id, 'p5', 'the oldest dropped');
    st.dropPrevious(abs('m'), 'vscode', 'h1/c1');
    assert.ok(!('prevHidden' in reload()), 'dropped with the session; an empty list is not written');
    const mt2 = fs.statSync(f7).mtimeMs;
    st.dropPrevious(abs('m'), 'copilot', 'never-there');
    assert.strictEqual(fs.statSync(f7).mtimeMs, mt2);
    st.remove(abs('m'));
    assert.deepStrictEqual(new FolderStore(f7).load(), [], 'the lists go with the folder');
    assert.ok(!fs.readFileSync(f7, 'utf8').includes('p5'));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f7).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(d7, { recursive: true, force: true });
  }
}

// ---- spec 059 FR-005: the user's session names ----
{
  assert.strictEqual(parseSessionNames(undefined), undefined);
  assert.strictEqual(parseSessionNames([]), undefined);
  assert.deepStrictEqual(
    parseSessionNames([
      { src: 'claude', id: 'a1', name: ' First  name ' },
      null,
      'x',
      { src: 'Bad Src', id: 'a2', name: 'x' }, // adapter id rule
      { src: 'claude', id: 'bad id', name: 'x' }, // id rule
      { src: 'claude', id: 'a3', name: 'x'.repeat(61) }, // name rule
      { src: 'claude', id: 'a4', name: 'bad\u0000' },
      { src: 'claude', id: 'a5', name: '' },
      { src: 'codex', id: 'a1', name: 'Other app, same id', inApp: true },
      { src: 'claude', id: 'a1', name: 'Second', pending: true }, // same (src, id): the last wins, at the end
      { src: 'copilot', id: 'a6', name: 'Both flags', inApp: true, pending: true }, // inApp wins
    ]),
    [
      { src: 'codex', id: 'a1', name: 'Other app, same id', inApp: true },
      { src: 'claude', id: 'a1', name: 'Second', pending: true },
      { src: 'copilot', id: 'a6', name: 'Both flags', inApp: true },
    ],
  );
  const many = Array.from({ length: 250 }, (_, i) => ({ src: 'copilot', id: `s${i}`, name: `n${i}` }));
  const kept = parseSessionNames(many) ?? [];
  assert.strictEqual(kept.length, MAX_SESSION_NAMES);
  assert.strictEqual(kept[0].id, 's50', 'the oldest are dropped');
  // tolerant load: a folder with garbage names loads, and an older file has no field
  const loaded = parseSavedFolders(JSON.stringify({ folders: [{ workspace: abs('a'), sessionNames: 5 }, { workspace: abs('b') }] }));
  assert.ok(!('sessionNames' in loaded[0]) && !('sessionNames' in loaded[1]));

  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-names-'));
  try {
    const f = path.join(d, 'folders.json');
    const st = new FolderStore(f);
    st.upsert({ workspace: abs('m'), permMode: 'ask' });
    assert.strictEqual(st.setSessionName(abs('nope'), 'copilot', 's1', 'x'), false, 'only saved folders');
    assert.strictEqual(st.setSessionName(abs('m'), 'copilot', 'bad id', 'x'), false);
    assert.strictEqual(st.setSessionName(abs('m'), 'copilot', 's1', 'x'.repeat(61)), false);
    assert.ok(st.setSessionName(abs('m'), 'copilot', 's1', 'Billing', { inApp: true }));
    assert.ok(st.setSessionName(abs('m'), 'claude', 's2', 'Other', { pending: true }));
    assert.deepStrictEqual(st.sessionNameOf(abs('m'), 'copilot', 's1'), { src: 'copilot', id: 's1', name: 'Billing', inApp: true });
    assert.strictEqual(st.sessionNameOf(abs('m'), 'codex', 's1'), undefined, 'the adapter is part of the key');
    const mtime = fs.statSync(f).mtimeMs;
    await_sync();
    assert.ok(st.setSessionName(abs('m'), 'claude', 's2', 'Other', { pending: true }));
    assert.strictEqual(fs.statSync(f).mtimeMs, mtime, 'unchanged: no write');
    assert.deepStrictEqual(new FolderStore(f).load()[0].sessionNames?.map((e) => e.id), ['s1', 's2'], 'survives a restart');
    assert.ok(st.setSessionName(abs('m'), 'copilot', 's1', 'Renamed')); // moves to the end, flags reset
    assert.deepStrictEqual(new FolderStore(f).load()[0].sessionNames, [{ src: 'claude', id: 's2', name: 'Other', pending: true }, { src: 'copilot', id: 's1', name: 'Renamed' }]);
    // reset removes; the empty list is not written
    st.setSessionName(abs('m'), 'copilot', 's1', undefined);
    st.dropSessionName(abs('m'), 'claude', 's2');
    assert.ok(!('sessionNames' in new FolderStore(f).load()[0]));
    assert.ok(st.setSessionName(abs('m'), 'copilot', 'zz', undefined), 'removing an unknown name is fine');
    // cap per folder
    for (let i = 0; i < 205; i++) st.setSessionName(abs('m'), 'copilot', `s${i}`, `n${i}`);
    const back = new FolderStore(f).load()[0].sessionNames ?? [];
    assert.strictEqual(back.length, MAX_SESSION_NAMES);
    assert.strictEqual(back[0].id, 's5');
    // gone with the folder
    st.remove(abs('m'));
    assert.strictEqual(st.sessionNameOf(abs('m'), 'copilot', 's204'), undefined);
    assert.ok(!fs.readFileSync(f, 'utf8').includes('s204'));
    // a failed write puts the list back
    st.upsert({ workspace: abs('w'), permMode: 'ask' });
    assert.ok(st.setSessionName(abs('w'), 'copilot', 'k1', 'Keep'));
    fs.rmSync(f);
    fs.mkdirSync(f); // the file path is now a directory: rename onto it fails
    assert.strictEqual(st.setSessionName(abs('w'), 'copilot', 'k2', 'Lost'), false, 'a failed write is reported');
    assert.strictEqual(st.sessionNameOf(abs('w'), 'copilot', 'k2'), undefined, 'and not kept in memory');
    assert.ok(st.sessionNameOf(abs('w'), 'copilot', 'k1'));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}
function await_sync(): void {
  const end = Date.now() + 20;
  while (Date.now() < end) { /* make the next write's mtime differ */ }
}
console.log('folders tests passed');
