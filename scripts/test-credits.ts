/** Credit cap helpers and settings store (spec 011), no credits: `npm run test:credits`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_CAP, MIN_CAP, fmtAiu, parseAmount, parseCap, parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';

assert.strictEqual(MIN_CAP, 30, 'the runtime refuses caps below 30 AI credits');
assert.strictEqual(parseCap(30), 30);
assert.strictEqual(parseCap('45.5'), 45.5);
assert.strictEqual(parseCap(30.126), 30.13);
assert.strictEqual(parseCap(MAX_CAP), MAX_CAP);
for (const bad of [29.99, 0.5, 0, -1, NaN, Infinity, MAX_CAP + 1, '', '  ', 'abc', null, undefined, {}, [], true, '1e400']) assert.strictEqual(parseCap(bad), undefined, String(bad));
assert.strictEqual(parseAmount('0.5'), 0.5);
assert.strictEqual(parseAmount(100), 100);
for (const bad of [0, -2, 0.001, NaN, '', 'x', MAX_CAP + 1, null]) assert.strictEqual(parseAmount(bad), undefined, String(bad));

assert.deepStrictEqual(parseSettings('{"defaultMaxAiCredits":75}'), { defaultMaxAiCredits: 75 });
for (const bad of ['', 'not json', 'null', '[]', '{"defaultMaxAiCredits":-3}', '{"defaultMaxAiCredits":5}', '{"defaultMaxAiCredits":"x"}']) assert.deepStrictEqual(parseSettings(bad), {}, bad);

assert.strictEqual(fmtAiu(120_000_000), '0.12');
assert.strictEqual(fmtAiu(120_000_000, 3), '0.120');
for (const bad of [undefined, null, NaN, -5, 'x', Infinity]) assert.strictEqual(fmtAiu(bad), '-', 'never NaN: ' + String(bad));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-settings-'));
try {
  const file = path.join(dir, 'sub', 'durbar-settings.json');
  const st = new SettingsStore(file);
  assert.deepStrictEqual(st.load(), {}, 'missing file');
  assert.strictEqual(st.setDefaultMaxAiCredits('75'), 75);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, 75, 'survives a restart');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, defaultMaxAiCredits: 75 }, 'numbers only on disk');
  assert.strictEqual(st.setDefaultMaxAiCredits(''), undefined);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, undefined, 'cleared');
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new SettingsStore(file).load(), {}, 'corrupt file');
  new SettingsStore(path.join(file, 'x', 'y.json')).setDefaultMaxAiCredits(50); // unwritable: no throw

  // spec 024 FR-007: the place mapping lives in the same file and survives cap changes (and the other way round)
  const f2 = path.join(dir, 'places', 'durbar-settings.json');
  const ps = new SettingsStore(f2);
  assert.deepStrictEqual({ ...ps.placeMap }, {}, 'no mapping yet');
  assert.deepStrictEqual(ps.setPlace('acme-tools', 'library'), { ok: true, placeMap: { 'acme-tools': 'library' } });
  assert.strictEqual(ps.setDefaultMaxAiCredits(90), 90);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'changing the cap keeps the mapping');
  assert.strictEqual(ps.setDefaultMaxAiCredits(''), undefined);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.ok(ps.setPlace('github', 'desk').ok);
  assert.strictEqual(ps.setDefaultMaxAiCredits(40), 40);
  const back = new SettingsStore(f2); back.load();
  assert.deepStrictEqual({ ...back.placeMap }, { 'acme-tools': 'library', github: 'desk' }, 'the mapping survives a restart');
  assert.strictEqual(back.defaultMaxAiCredits, 40, 'and the cap too');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { version: 1, defaultMaxAiCredits: 40, placeMap: { 'acme-tools': 'library', github: 'desk' } }, 'server names and place ids only on disk');
  assert.deepStrictEqual(back.setPlace('github', 'moon'), { ok: false, placeMap: { 'acme-tools': 'library', github: 'desk' } }, 'unknown place: refused, unchanged');
  assert.strictEqual(back.setPlace('', 'web').ok, false);
  assert.strictEqual(back.setPlace('__proto__', 'web').ok, false);
  assert.strictEqual(back.setPlace('x'.repeat(201), 'web').ok, false);
  assert.deepStrictEqual(back.setPlace('github', null), { ok: true, placeMap: { 'acme-tools': 'library' } }, 'null clears one entry');
  assert.deepStrictEqual(back.setPlace('acme-tools', null).placeMap, {}, 'last entry cleared');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { version: 1, defaultMaxAiCredits: 40 }, 'an empty mapping is not written');
  const copy = back.placeMap; (copy as Record<string, string>).sneaky = 'web';
  assert.deepStrictEqual({ ...back.placeMap }, {}, 'the getter returns a copy');
  fs.writeFileSync(f2, JSON.stringify({ version: 1, placeMap: { ok: 'web', bad: 'moon', n: 5 }, defaultMaxAiCredits: 'x' }));
  const odd = new SettingsStore(f2); odd.load();
  assert.deepStrictEqual({ ...odd.placeMap }, { ok: 'web' }, 'a hand-edited file keeps only valid entries');
  assert.deepStrictEqual({ ...parseSettings('{"placeMap":{"a":"web"}}').placeMap }, { a: 'web' });
  assert.deepStrictEqual(parseSettings('{"placeMap":"x"}'), {}, 'a mapping that is not an object is ignored');
  assert.deepStrictEqual(parseSettings('{"defaultMaxAiCredits":75,"placeMap":{}}'), { defaultMaxAiCredits: 75 }, 'an empty mapping is omitted');

  // spec 034 FR-004: Serious mode lives in the same file, off by default, and survives cap and mapping changes
  const f3 = path.join(dir, 'serious', 'durbar-settings.json');
  const ss = new SettingsStore(f3); ss.load();
  assert.strictEqual(ss.seriousMode, false, 'off by default (the fun is on)');
  assert.strictEqual(ss.setSeriousMode(true), true); assert.strictEqual(ss.seriousMode, true);
  assert.ok(ss.setPlace('acme-tools', 'library').ok); assert.strictEqual(ss.setDefaultMaxAiCredits(60), 60);
  const sb = new SettingsStore(f3); sb.load();
  assert.strictEqual(sb.seriousMode, true, 'kept after a restart, a cap change and a mapping change');
  assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }); assert.strictEqual(sb.defaultMaxAiCredits, 60);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f3, 'utf8')), { version: 1, defaultMaxAiCredits: 60, placeMap: { 'acme-tools': 'library' }, seriousMode: true });
  for (const junk of ['yes', 1, 0, null, undefined, {}, []]) assert.strictEqual(sb.setSeriousMode(junk), true, 'only a boolean changes it: ' + String(junk));
  assert.strictEqual(sb.setSeriousMode(false), false); assert.strictEqual(sb.seriousMode, false);
  assert.ok(!('seriousMode' in JSON.parse(fs.readFileSync(f3, 'utf8'))), 'off is not written');
  assert.strictEqual(sb.setDefaultMaxAiCredits(''), undefined); assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.strictEqual(sb.setSeriousMode(true), true); assert.strictEqual(sb.setDefaultMaxAiCredits(70), 70); assert.strictEqual(sb.seriousMode, true, 'a cap change keeps Serious mode');
  assert.deepStrictEqual(parseSettings('{"seriousMode":true}'), { seriousMode: true });
  for (const bad of ['"yes"', '1', '0', 'null', '[]', '{}', '"true"', '{"seriousMode":"true"}', '{"seriousMode":1}', '{"seriousMode":false}']) assert.deepStrictEqual(parseSettings(bad.startsWith('{') ? bad : '{"seriousMode":' + bad + '}'), {}, 'only true is kept: ' + bad);

  // ---- spec 024 FR-018..FR-020 (issue #115): custom places ----
  {
    const realFs = require('fs') as typeof fs; // the store reads fs at call time, so patching the real module is seen by it
    let n = 0;
    const gen = (): string => 'c-' + String(++n).padStart(6, '0');
    const f4 = path.join(dir, 'custom', 'durbar-settings.json');
    const cs = new SettingsStore(f4, gen);
    assert.strictEqual(cs.customPlaces.length, 0, 'no places yet');
    const a = cs.addPlace('  Database ', 'database');
    assert.deepStrictEqual(a, { ok: true, place: { id: 'c-000001', name: 'Database', icon: 'database' }, customPlaces: [{ id: 'c-000001', name: 'Database', icon: 'database' }], placeMap: {} });
    const b = cs.addPlace('Ticket desk', 'chat'); assert.ok(b.ok);
    assert.ok(cs.setPlace('pg-tools', 'c-000001').ok, 'a server can be mapped to a custom place');
    assert.ok(cs.setPlace('jira-sync', 'c-000002').ok);
    assert.ok(cs.setPlace('github', 'web').ok);
    assert.deepStrictEqual(cs.setPlace('x', 'c-000009'), { ok: false, placeMap: { 'pg-tools': 'c-000001', 'jira-sync': 'c-000002', github: 'web' } }, 'a place that does not exist is refused');
    assert.ok(cs.setDefaultMaxAiCredits(45) === 45);
    // restart: places, mapping and cap survive; only names, icon ids and place ids on disk
    const back = new SettingsStore(f4, gen); back.load();
    assert.deepStrictEqual(back.customPlaces, cs.customPlaces, 'places survive a restart');
    assert.deepStrictEqual({ ...back.placeMap }, { 'pg-tools': 'c-000001', 'jira-sync': 'c-000002', github: 'web' }, 'so does the mapping to them');
    assert.strictEqual(back.defaultMaxAiCredits, 45);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f4, 'utf8')), {
      version: 1, defaultMaxAiCredits: 45, placeMap: { 'pg-tools': 'c-000001', 'jira-sync': 'c-000002', github: 'web' },
      customPlaces: [{ id: 'c-000001', name: 'Database', icon: 'database' }, { id: 'c-000002', name: 'Ticket desk', icon: 'chat' }],
    }, 'names, icon ids, place ids and server names only on disk');
    assert.strictEqual(fs.readdirSync(path.dirname(f4)).filter((x) => x.endsWith('.tmp')).length, 0, 'no temp file left');
    // the getter returns copies
    const got = back.customPlaces; got[0].name = 'Hacked'; got.push({ id: 'c-zzzzzz', name: 'x', icon: 'pin' });
    assert.deepStrictEqual(back.customPlaces.map((p) => p.name), ['Database', 'Ticket desk'], 'the getter returns a copy');
    // rename keeps the id and the mapping
    const ren = back.updatePlace('c-000001', { name: 'Data warehouse' });
    assert.ok(ren.ok); assert.deepStrictEqual(ren.customPlaces[0], { id: 'c-000001', name: 'Data warehouse', icon: 'database' });
    assert.strictEqual(ren.placeMap['pg-tools'], 'c-000001', 'rename keeps the mapping');
    assert.ok(back.updatePlace('c-000001', { icon: 'cloud' }).ok);
    assert.strictEqual(new SettingsStore(f4).load().customPlaces?.[0].icon, 'cloud', 'the change is saved');
    // refusals: nothing changes, the codes come from the shared rules
    const before = fs.readFileSync(f4, 'utf8');
    const refused: [string, () => { ok: boolean; error?: string }][] = [
      ['name-taken', () => back.addPlace('ticket DESK', 'star')], ['name-taken', () => back.addPlace('terminal', 'star')], ['name-empty', () => back.addPlace('  ', 'star')],
      ['name-long', () => back.addPlace('x'.repeat(25), 'star')], ['name-invalid', () => back.addPlace('a\nb', 'star')], ['name-invalid', () => back.addPlace(5, 'star')],
      ['icon', () => back.addPlace('Ok', 'nope')], ['icon', () => back.addPlace('Ok', undefined)], ['name-taken', () => back.updatePlace('c-000002', { name: 'data warehouse' })],
      ['icon', () => back.updatePlace('c-000002', { icon: 'nope' })], ['unknown', () => back.updatePlace('c-000009', { name: 'Z' })], ['unknown', () => back.updatePlace('library', { name: 'Z' })],
      ['unknown', () => back.updatePlace('c-000002', null)], ['unknown', () => back.updatePlace(undefined, {})], ['unknown', () => back.removePlace('c-000009')],
      ['unknown', () => back.removePlace('library')], ['unknown', () => back.removePlace('desk')], ['unknown', () => back.removePlace('__proto__')], ['unknown', () => back.removePlace(7)],
    ];
    for (const [code, run] of refused) { const r = run(); assert.ok(!r.ok && r.error === code, `expected ${code}, got ${JSON.stringify(r)}`); }
    assert.strictEqual(fs.readFileSync(f4, 'utf8'), before, 'refusals do not touch the file');
    assert.strictEqual(back.addPlace('Third', 'star').ok, true);
    const fourth = back.addPlace('Fourth', 'star');
    assert.ok(!fourth.ok && fourth.error === 'limit' && fourth.customPlaces.length === 3, 'a fourth place is refused with limit');
    // delete clears the entries that pointed to the place, in one save
    let writes = 0; const realRename = realFs.renameSync;
    realFs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => { writes++; return realRename(...args); }) as typeof fs.renameSync;
    let del;
    try { del = back.removePlace('c-000001'); } finally { realFs.renameSync = realRename; }
    assert.strictEqual(writes, 1, 'removing a place is one save (list and map together)');
    assert.ok(del.ok);
    assert.deepStrictEqual(del.customPlaces.map((p) => p.id), ['c-000002', 'c-000003']);
    assert.deepStrictEqual({ ...del.placeMap }, { 'jira-sync': 'c-000002', github: 'web' }, 'the server that pointed to the place is back to its default');
    const afterDel = JSON.parse(fs.readFileSync(f4, 'utf8'));
    assert.deepStrictEqual(afterDel.placeMap, { 'jira-sync': 'c-000002', github: 'web' }, 'also on disk');
    for (const [label, call] of [['add', () => back.addPlace('Fifth', 'star')], ['update', () => back.updatePlace('c-000002', { name: 'Tickets' })]] as const) {
      writes = 0; realFs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => { writes++; return realRename(...args); }) as typeof fs.renameSync;
      try { call(); } finally { realFs.renameSync = realRename; }
      assert.strictEqual(writes, 1, label + ' is one save');
    }
    // removing the last mapping/place leaves no empty keys
    const solo = new SettingsStore(path.join(dir, 'solo', 'durbar-settings.json'), gen);
    const soloId = solo.addPlace('Only', 'pin').place?.id as string; assert.ok(solo.setPlace('srv', soloId).ok);
    assert.ok(solo.removePlace(soloId).ok);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'solo', 'durbar-settings.json'), 'utf8')), { version: 1 }, 'no empty customPlaces or placeMap on disk');
    // failed write: the call is refused and the list and the map in memory stay as they were
    const f5 = path.join(dir, 'failing', 'durbar-settings.json');
    const fl = new SettingsStore(f5, gen);
    assert.ok(fl.addPlace('Keep', 'star').ok);
    const keepId = fl.customPlaces[0].id;
    assert.ok(fl.setPlace('srv', keepId).ok);
    const diskBefore = fs.readFileSync(f5, 'utf8');
    const realWrite = realFs.writeFileSync;
    realFs.writeFileSync = (() => { throw new Error('disk full'); }) as typeof fs.writeFileSync;
    try {
      const rm = fl.removePlace(keepId); assert.ok(!rm.ok, 'remove while the file cannot be written: refused');
      assert.deepStrictEqual(rm.customPlaces.map((p) => p.id), [keepId], 'the list stays'); assert.deepStrictEqual({ ...rm.placeMap }, { srv: keepId }, 'and the map stays');
      assert.ok(!fl.addPlace('New', 'star').ok); assert.ok(!fl.updatePlace(keepId, { name: 'Renamed' }).ok);
      assert.deepStrictEqual(fl.customPlaces.map((p) => p.name), ['Keep'], 'add and update leave memory as it was too');
    } finally { realFs.writeFileSync = realWrite; }
    assert.strictEqual(fs.readFileSync(f5, 'utf8'), diskBefore, 'and the file is unchanged');
    const unwritable = new SettingsStore(path.join(f5, 'x', 'y.json'), gen);
    const ur = unwritable.addPlace('Nope', 'star');
    assert.ok(!ur.ok && ur.customPlaces.length === 0, 'a profile that cannot be written: refused, no throw, nothing kept in memory');
    // default id generator: shape, and no two alike
    const r1 = new SettingsStore(path.join(dir, 'rnd', 'durbar-settings.json'));
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) { const p = r1.addPlace('P' + i, 'star').place; assert.ok(p && /^c-[a-z0-9]{6}$/.test(p.id), 'random id fits the pattern'); ids.add(p.id); }
    assert.strictEqual(ids.size, 3);
    // an injected generator that repeats an id is asked again
    const seqIds = ['c-aaaaaa', 'c-aaaaaa', 'c-bbbbbb']; const rep = new SettingsStore(path.join(dir, 'rep', 'durbar-settings.json'), () => seqIds.shift() as string);
    assert.ok(rep.addPlace('One', 'star').ok); const two = rep.addPlace('Two', 'star');
    assert.ok(two.ok && two.place?.id === 'c-bbbbbb', 'an id that already exists is skipped');
  }

  // parseSettings: customPlaces are read first, then the mapping may only point to places that exist
  {
    const ok = JSON.stringify({ version: 1, customPlaces: [{ id: 'c-aaaaaa', name: 'A', icon: 'star' }], placeMap: { s1: 'c-aaaaaa', s2: 'c-bbbbbb', s3: 'web' } });
    const okp = parseSettings(ok);
    assert.deepStrictEqual(okp.customPlaces, [{ id: 'c-aaaaaa', name: 'A', icon: 'star' }]);
    assert.deepStrictEqual({ ...okp.placeMap }, { s1: 'c-aaaaaa', s3: 'web' }, 'an entry for a missing custom place is dropped');
    assert.deepStrictEqual(parseSettings('{"placeMap":{"s1":"c-aaaaaa"}}'), {}, 'no custom places at all: such an entry is dropped');
    const place = (i: number, name: string, icon = 'star') => ({ id: 'c-00000' + i, name, icon });
    const many = parseSettings(JSON.stringify({ customPlaces: [place(1, 'A'), place(2, 'B'), place(3, 'C'), place(4, 'D')], placeMap: { x: 'c-000004', y: 'c-000003' } }));
    assert.deepStrictEqual(many.customPlaces?.map((p) => p.name), ['A', 'B', 'C'], 'more than 3: the first 3 are kept');
    assert.deepStrictEqual({ ...many.placeMap }, { y: 'c-000003' }, 'and a mapping to the 4th is dropped');
    assert.deepStrictEqual(parseSettings(JSON.stringify({ customPlaces: [place(1, 'A'), place(1, 'B'), place(2, 'a'), place(3, 'Terminal'), place(4, 'C')] })).customPlaces?.map((p) => p.id + p.name), ['c-000001A', 'c-000004C'], 'duplicate ids and names, and reserved names, are dropped (first kept)');
    assert.strictEqual(parseSettings(JSON.stringify({ customPlaces: [place(1, 'A', 'rocket')] })).customPlaces?.[0].icon, 'pin', 'an unknown icon is shown as pin');
    assert.deepStrictEqual(parseSettings(JSON.stringify({ customPlaces: [{ id: 'bad', name: 'A' }, { id: 'c-aaaaaa', name: '' }, { id: 'c-bbbbbb', name: 'x'.repeat(25) }, null, 5, 'x'] })), {}, 'invalid ids and names are dropped');
    for (const bad of ['"x"', '5', 'null', '{}', '[]', 'true', '{"a":1}']) assert.deepStrictEqual(parseSettings('{"customPlaces":' + bad + '}'), {}, 'customPlaces that is not a list: ' + bad);
    assert.deepStrictEqual(parseSettings('{"customPlaces":[]}'), {}, 'an empty list is omitted');
    // __proto__ in the file
    const proto = parseSettings('{"customPlaces":[{"id":"c-aaaaaa","name":"__proto__","icon":"star","__proto__":{"evil":1}}],"placeMap":{"__proto__":"c-aaaaaa","srv":"c-aaaaaa"},"__proto__":{"customPlaces":[]}}');
    assert.deepStrictEqual(proto.customPlaces, [{ id: 'c-aaaaaa', name: '__proto__', icon: 'star' }]);
    assert.deepStrictEqual({ ...proto.placeMap }, { srv: 'c-aaaaaa' }, '__proto__ is never a server name');
    assert.strictEqual(({} as Record<string, unknown>).evil, undefined);
    // broken files: nothing throws, nothing is kept
    for (const bad of ['', '{{{', '{"customPlaces":[{"id":', 'null', '[]', '"x"']) assert.deepStrictEqual(parseSettings(bad), {}, 'broken file: ' + JSON.stringify(bad));
    const fb = path.join(dir, 'broken', 'durbar-settings.json'); fs.mkdirSync(path.dirname(fb), { recursive: true });
    fs.writeFileSync(fb, '{"customPlaces":[{"id":"c-aaaaaa","name":"A","icon":"star"}],"placeMap":');
    const bs = new SettingsStore(fb, () => 'c-cccccc'); assert.deepStrictEqual(bs.load(), {}, 'a truncated file loads as no settings');
    assert.ok(bs.addPlace('Fresh', 'pin').ok, 'and the store still works');
    fs.writeFileSync(fb, JSON.stringify({ customPlaces: [{ id: 'c-aaaaaa', name: 'A', icon: 'star' }], placeMap: { srv: 'c-aaaaaa', ghost: 'c-zzzzzz' } }));
    const ghost = new SettingsStore(fb); ghost.load();
    assert.deepStrictEqual({ ...ghost.placeMap }, { srv: 'c-aaaaaa' }, 'a ghost entry in a hand-edited file is gone');
    assert.ok(ghost.setDefaultMaxAiCredits(80) === 80);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fb, 'utf8')).placeMap, { srv: 'c-aaaaaa' }, 'and is not written back');
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('credits: all checks passed');
