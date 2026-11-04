/** Credit cap helpers and settings store (spec 011), no credits: `npm run test:credits`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_CAP, MIN_CAP, MIN_USD_CAP, fmtAiu, parseAmount, parseCap, parseCapIn, parseSettings, parseUsdCap, startCap } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import { MCP_SIGNIN_REFRESH_DEFAULT } from '../src/main/mcpsigninrefresh';

assert.strictEqual(MIN_CAP, 30, 'the runtime refuses caps below 30 AI credits');
// spec 012 FR-150: dollar caps (Claude's estimate) and the start rule
assert.strictEqual(MIN_USD_CAP, 0.01);
assert.strictEqual(parseUsdCap(0.5), 0.5);
assert.strictEqual(parseUsdCap('0.126'), 0.13);
assert.strictEqual(parseUsdCap(0.001), undefined, 'below a cent');
assert.strictEqual(parseUsdCap(10_001), undefined, 'above $10,000 is a typo');
assert.strictEqual(parseCapIn('usd', 0.5), 0.5);
assert.strictEqual(parseCapIn('aiu', 0.5), undefined, 'an AIU cap below 30 is refused');
assert.strictEqual(parseCapIn(undefined, 45), 45, 'no unit means AIU');
assert.strictEqual(startCap('aiu', undefined, 40, 80), 40, 'AIU: the folder cap first');
assert.strictEqual(startCap('aiu', undefined, undefined, 80), 80, 'AIU: then the settings default');
assert.strictEqual(startCap('aiu', 5, 40, 80), 40, 'AIU: an invalid explicit cap falls back as before');
assert.strictEqual(startCap('aiu', null, 40, 80), undefined, 'null = no cap');
assert.strictEqual(startCap('usd', undefined, 40, 80), undefined, 'dollars: the AIU folder cap and default are never used');
assert.strictEqual(startCap('usd', 0.25, 40, 80), 0.25, 'dollars: only an explicit cap');
assert.strictEqual(startCap('usd', 0.001, 40, 80), undefined);
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
  assert.strictEqual(st.setDefaultMaxAiCredits('75').value, 75);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, 75, 'survives a restart');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, defaultMaxAiCredits: 75 }, 'numbers only on disk');
  assert.strictEqual(st.setDefaultMaxAiCredits('').value, undefined);
  assert.strictEqual(new SettingsStore(file).load().defaultMaxAiCredits, undefined, 'cleared');
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(file, '{{{');
  assert.deepStrictEqual(new SettingsStore(file).load(), {}, 'corrupt file');
  new SettingsStore(path.join(file, 'x', 'y.json')).setDefaultMaxAiCredits(50).value; // unwritable: no throw

  // spec 093 FR-006: the parent of the last created folder (an absolute path; anything else is dropped on read and refused on write)
  {
    const f3 = path.join(dir, 'nf', 'durbar-settings.json');
    const ns = new SettingsStore(f3);
    ns.load();
    assert.strictEqual(ns.newFolderParent, undefined);
    ns.setNewFolderParent('/home/u/code');
    assert.strictEqual(new SettingsStore(f3).load().newFolderParent, '/home/u/code', 'survives a restart');
    for (const bad of ['relative', '', '/a\nb', 42, null]) ns.setNewFolderParent(bad);
    assert.strictEqual(new SettingsStore(f3).load().newFolderParent, '/home/u/code', 'an invalid value is never stored');
    ns.setNewFolderParent('C:\\Users\\u\\code');
    assert.strictEqual(new SettingsStore(f3).load().newFolderParent, 'C:\\Users\\u\\code');
    for (const bad of ['"rel/x"', '"~/x"', '42', '"/' + 'x'.repeat(4096) + '"', '"/a\\u0000b"', '{"a":1}']) assert.strictEqual(parseSettings(`{"newFolderParent":${bad}}`).newFolderParent, undefined, `dropped on read: ${bad.slice(0, 20)}`);
    assert.deepStrictEqual(parseSettings('{"newFolderParent":"/x/y"}'), { newFolderParent: '/x/y' });
  }

  // spec 024 FR-007: the place mapping lives in the same file and survives cap changes (and the other way round)
  const f2 = path.join(dir, 'places', 'durbar-settings.json');
  const ps = new SettingsStore(f2);
  assert.deepStrictEqual({ ...ps.placeMap }, {}, 'no mapping yet');
  assert.deepStrictEqual(ps.setPlace('acme-tools', 'library'), { ok: true, placeMap: { 'acme-tools': 'library' } });
  assert.strictEqual(ps.setDefaultMaxAiCredits(90).value, 90);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'changing the cap keeps the mapping');
  assert.strictEqual(ps.setDefaultMaxAiCredits('').value, undefined);
  assert.deepStrictEqual({ ...ps.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.ok(ps.setPlace('github', 'desk').ok);
  assert.strictEqual(ps.setDefaultMaxAiCredits(40).value, 40);
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
  assert.strictEqual(ss.setSeriousMode(true).value, true); assert.strictEqual(ss.seriousMode, true);
  assert.ok(ss.setPlace('acme-tools', 'library').ok); assert.strictEqual(ss.setDefaultMaxAiCredits(60).value, 60);
  const sb = new SettingsStore(f3); sb.load();
  assert.strictEqual(sb.seriousMode, true, 'kept after a restart, a cap change and a mapping change');
  assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }); assert.strictEqual(sb.defaultMaxAiCredits, 60);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f3, 'utf8')), { version: 1, defaultMaxAiCredits: 60, placeMap: { 'acme-tools': 'library' }, seriousMode: true });
  for (const junk of ['yes', 1, 0, null, undefined, {}, []]) assert.strictEqual(sb.setSeriousMode(junk).value, true, 'only a boolean changes it: ' + String(junk));
  assert.strictEqual(sb.setSeriousMode(false).value, false); assert.strictEqual(sb.seriousMode, false);
  assert.ok(!('seriousMode' in JSON.parse(fs.readFileSync(f3, 'utf8'))), 'off is not written');
  assert.strictEqual(sb.setDefaultMaxAiCredits('').value, undefined); assert.deepStrictEqual({ ...sb.placeMap }, { 'acme-tools': 'library' }, 'clearing the cap keeps the mapping');
  assert.strictEqual(sb.setSeriousMode(true).value, true); assert.strictEqual(sb.setDefaultMaxAiCredits(70).value, 70); assert.strictEqual(sb.seriousMode, true, 'a cap change keeps Serious mode');
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
    assert.ok(cs.setDefaultMaxAiCredits(45).value === 45);
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
    assert.deepStrictEqual(parseSettings(JSON.stringify({ customPlaces: [place(1, 'A'), place(1, 'B'), place(2, 'a'), place(3, 'Terminal'), place(4, 'C')] })).customPlaces?.map((p) => p.id + p.name), ['c-000001A', 'c-000002a (2)', 'c-000003Terminal (2)'], 'a duplicate id is dropped (first kept); a repeated or reserved name is kept and renamed (review on PR 511), so the 4th is over the cap');
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
    assert.ok(ghost.setDefaultMaxAiCredits(80).value === 80);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fb, 'utf8')).placeMap, { srv: 'c-aaaaaa' }, 'and is not written back');
  }
  // issue #1023: every setter checks the save. On a path that cannot be written, nothing is stored in memory, the call says so,
  // and the value in force is the old one (a file as the parent folder fails on every OS, with or without root).
  {
    const blocker = path.join(dir, 'a-file');
    fs.writeFileSync(blocker, 'x');
    const mk = (): SettingsStore => { const x = new SettingsStore(path.join(blocker, 'durbar-settings.json'), () => 'c-bbbbbb'); x.load(); return x; };
    const s1 = mk();
    assert.strictEqual(s1.setDefaultMaxAiCredits(75).value, 75, 'cap: a first cap is the safe direction, in force for this run');
    assert.strictEqual(s1.isUnsaved('defaultMaxAiCredits'), true);
    assert.deepStrictEqual(s1.unsavedKeys, ['defaultMaxAiCredits'], 'only the cap is for this run only');
    assert.strictEqual(s1.setSeriousMode(true).value, false);
    assert.strictEqual(s1.seriousMode, false, 'serious mode rolled back');
    assert.strictEqual(s1.setChatLinksNewTab(true), false);
    assert.strictEqual(s1.setChatLinksIn('system').value, 'session');
    assert.strictEqual(s1.setNotifyNeedsMe(false).value, true);
    assert.strictEqual(s1.setBreakResume('ask').value, 'auto');
    assert.strictEqual(s1.setCheckUpdatesAtStart(false).value, true);
    assert.strictEqual(s1.setSandboxAlwaysContinue('claude', true), false);
    assert.strictEqual(s1.sandboxAlwaysContinue('claude'), false);
    // convenience and bookkeeping values stay in memory for the run (the rule in spec 011 FR-012): the browser must open, an update is announced once, + Folder remembers
    assert.strictEqual(s1.setAnnouncedVersion('codex', '0.164.0'), true, 'announced: in force');
    assert.deepStrictEqual(s1.announcedVersions, { codex: '0.164.0' }, 'announced once per run, not at every check');
    assert.strictEqual(s1.acceptBrowserNote(), true);
    assert.strictEqual(s1.browserNoteAccepted, true, 'the session browser opens for the run on an unwritable profile');
    s1.setNewFolderParent('/home/u/code');
    assert.strictEqual(s1.newFolderParent, '/home/u/code', 'new-folder parent remembered for the run');
    // the theme is shown by the window already, so main keeps it for the run and says it was not saved
    assert.strictEqual(s1.setTheme('dark').ok, false, 'theme: not saved');
    assert.strictEqual(s1.theme, 'dark', 'but the one in force is the one the window shows');
    assert.strictEqual(s1.setTheme('cheeky-crew').ok, false, 'the old Cheeky Crew id migrates and saves in one step: not saved');
    assert.strictEqual(s1.characters, 'cheeky', 'and the migration is in force for the run');
    assert.strictEqual(s1.setTheme(null).ok, false);
    assert.strictEqual(s1.theme, undefined);
    assert.strictEqual(s1.setTheme('corporate').ok, false, 'a removed built-in theme resolves to Clean Office: not saved');
    assert.deepStrictEqual([...s1.unsavedKeys].sort(), ['announcedVersions', 'browserNoteAccepted', 'defaultMaxAiCredits', 'newFolderParent', 'theme']);
    assert.strictEqual(s1.setMcpWarnLevels({ warn: 20, strong: 40 }).ok, false, 'MCP warning levels: not ok when the save fails');
    assert.notStrictEqual(s1.mcpWarnLevels.warn, 20, 'and not kept');
    assert.strictEqual(s1.setCharacters('minimalist').ok, false, 'characters: shown with the saved value: rolled back');
    assert.strictEqual(s1.characters, 'cheeky', 'to what was in force');
    assert.deepStrictEqual(s1.setPlace('srv', 'desk'), { ok: false, placeMap: {} }, 'place: not ok, map unchanged');
    assert.strictEqual(s1.addPlace('Lab', 'star').ok, false);
    assert.deepStrictEqual(s1.customPlaces, []);
    // the safe direction (review of #1036): turning the OS-sandbox choice off, or a tighter default cap, is in force for this run even when the file cannot be written; the opposite is rolled back
    {
      const root = path.join(dir, 'later-blocked');
      const f = path.join(root, 'durbar-settings.json');
      const sb = new SettingsStore(f); sb.load();
      assert.strictEqual(sb.setSandboxAlwaysContinue('claude', true), true);
      assert.strictEqual(sb.setDefaultMaxAiCredits(100).value, 100);
      assert.strictEqual(sb.isUnsaved('defaultMaxAiCredits'), false, 'saved');
      fs.rmSync(root, { recursive: true, force: true });
      fs.writeFileSync(root, 'x'); // the folder is now a file: every save fails
      assert.strictEqual(sb.setSandboxAlwaysContinue('claude', false), false, 'off takes effect');
      assert.strictEqual(sb.sandboxAlwaysContinue('claude'), false, 'and stays off in memory');
      assert.strictEqual(sb.isUnsaved('sandboxAlwaysContinue'), true, 'and says it was not saved');
      // the flag belongs to its setting: the same cap saved again (not tighter, rolled back) is not "this run only" because the sandbox choice is
      assert.strictEqual(sb.setDefaultMaxAiCredits(100).value, 100);
      assert.strictEqual(sb.isUnsaved('defaultMaxAiCredits'), false, 'an unrelated unsaved change is not this one');
      assert.strictEqual(sb.setSandboxAlwaysContinue('codex', true), false, 'turning it on is rolled back');
      assert.strictEqual(sb.sandboxAlwaysContinue('codex'), false);
      assert.strictEqual(sb.setDefaultMaxAiCredits(60).value, 60, 'a lower cap is in force for this run');
      assert.strictEqual(sb.setDefaultMaxAiCredits(200).value, 60, 'a higher cap is rolled back');
      assert.strictEqual(sb.setDefaultMaxAiCredits('').value, 60, 'no cap is rolled back');
      assert.strictEqual(sb.defaultMaxAiCredits, 60);
      assert.deepStrictEqual([...sb.unsavedKeys].sort(), ['defaultMaxAiCredits', 'sandboxAlwaysContinue']);
      // a later save that works writes all of memory, so nothing is "this run only" any more
      fs.rmSync(root, { force: true });
      assert.strictEqual(sb.setSeriousMode(true).value, true, 'the folder can be written again');
      assert.deepStrictEqual(sb.unsavedKeys, [], 'a successful save clears the flags');
      assert.strictEqual(new SettingsStore(f).load().defaultMaxAiCredits, 60, 'and the kept cap was written');
      const nb = new SettingsStore(path.join(dir, 'later-blocked2', 'x', 'durbar-settings.json')); nb.load();
      fs.mkdirSync(path.join(dir, 'later-blocked2'), { recursive: true }); fs.rmSync(path.join(dir, 'later-blocked2'), { recursive: true, force: true }); fs.writeFileSync(path.join(dir, 'later-blocked2'), 'x');
      assert.strictEqual(nb.setDefaultMaxAiCredits(60).value, 60, 'none -> a cap is tighter, in force');
      assert.strictEqual(nb.isUnsaved('defaultMaxAiCredits'), true);
    }
    // and a writable one still stores and reports each of them
    const f9 = path.join(dir, 'ok9', 'durbar-settings.json');
    const s2 = new SettingsStore(f9); s2.load();
    assert.strictEqual(s2.setSeriousMode(true).value, true);
    assert.strictEqual(s2.setBreakResume('ask').value, 'ask');
    assert.strictEqual(s2.setAnnouncedVersion('codex', '0.164.0'), true);
    assert.strictEqual(s2.acceptBrowserNote(), true);
    assert.deepStrictEqual(s2.setPlace('srv', 'desk'), { ok: true, placeMap: { srv: 'desk' } });
    const again = new SettingsStore(f9).load();
    assert.ok(again.seriousMode && again.breakResume === 'ask' && again.browserNoteAccepted, 'all of them are on disk');
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// issue #1094: every setter answers `ok` from its own write. A failed write of the value already in force rolls back to that same value: ok false.
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-setok-'));
  try {
    const blocker = path.join(d2, 'a-file');
    fs.writeFileSync(blocker, 'x');
    const st = new SettingsStore(path.join(blocker, 'durbar-settings.json')); st.load();
    const none = (r: { ok: boolean }, what: string): void => assert.strictEqual(r.ok, false, `${what}: an unchanged value that could not be written is not ok`);
    none(st.setSeriousMode(false), 'serious mode');
    none(st.setNotifyNeedsMe(true), 'notifications');
    none(st.setCheckUpdatesAtStart(true), 'update check');
    none(st.setMcpSignInRefresh(st.mcpSignInRefresh), 'sign-in refresh');
    none(st.setBreakResume('auto'), 'break resume');
    none(st.setChatLinksIn('session'), 'chat links');
    none(st.setDefaultMaxAiCredits(''), 'default cap');
    assert.deepStrictEqual(st.unsavedKeys, [], 'nothing is kept for the run by these');
    // a write that works is ok, also for an unchanged value
    const ok = new SettingsStore(path.join(d2, 'good', 'durbar-settings.json')); ok.load();
    assert.strictEqual(ok.setSeriousMode(false).ok, true);
    assert.strictEqual(ok.setBreakResume('auto').ok, true);
    assert.strictEqual(ok.setDefaultMaxAiCredits(75).ok, true);
    // a refused value is not ok either
    assert.strictEqual(ok.setSeriousMode('yes').ok, false);
    assert.strictEqual(ok.setChatLinksIn('bogus').ok, false);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
}

// issue #1047: a failed write or rename leaves no `.tmp` file next to the settings file (fs failures injected; the setter still says ok false)
{
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-settmp-'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rfs = require('fs') as { writeFileSync: typeof fs.writeFileSync; renameSync: typeof fs.renameSync }; // the real module object (the `import *` namespace is read-only)
  const realWrite = rfs.writeFileSync, realRename = rfs.renameSync;
  const tmps = (): string[] => fs.readdirSync(d3).filter((n) => n.endsWith('.tmp'));
  try {
    const st = new SettingsStore(path.join(d3, 'durbar-settings.json')); st.load();
    // a partial write: the file is created, then the write throws (disk full)
    rfs.writeFileSync = ((f: fs.PathOrFileDescriptor, _data: unknown, o?: unknown) => { realWrite(f, 'par', o as fs.WriteFileOptions); throw new Error('ENOSPC'); }) as typeof fs.writeFileSync;
    try { assert.strictEqual(st.setSeriousMode(true).ok, false, 'a failed write is not ok'); } finally { rfs.writeFileSync = realWrite; }
    assert.deepStrictEqual(tmps(), [], 'no .tmp after a failed write');
    // a failed rename: the temp file was written whole
    rfs.renameSync = (() => { throw new Error('EBUSY'); }) as typeof fs.renameSync;
    try { assert.strictEqual(st.setSeriousMode(true).ok, false, 'a failed rename is not ok'); } finally { rfs.renameSync = realRename; }
    assert.deepStrictEqual(tmps(), [], 'no .tmp after a failed rename');
    assert.strictEqual(fs.existsSync(path.join(d3, 'durbar-settings.json')), false, 'nothing was half-written to the real file');
    // and a save that works leaves none either, and writes the file
    assert.strictEqual(st.setSeriousMode(true).ok, true);
    assert.deepStrictEqual(tmps(), []);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d3, 'durbar-settings.json'), 'utf8')).seriousMode, true);
  } finally {
    rfs.writeFileSync = realWrite; rfs.renameSync = realRename;
    fs.rmSync(d3, { recursive: true, force: true });
  }
}

// issue #1023: the IPC replies with `ok` only when the value asked for is the one in force (main's own handler, a stand-in electron)
async function ipcChecks(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
  const saved = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-setipc-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/settings') as typeof import('../src/main/ipc/settings');
    const frame = { url: require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = async (ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(win, ...a)) as Record<string, unknown>;
    const run = async (store: SettingsStore | undefined, want: boolean): Promise<void> => {
      handlers.clear();
      register({ getSettingsStore: () => store, getRunTheme: () => undefined, clearRunTheme: () => undefined });
      assert.strictEqual((await call('settings:setSeriousMode', true)).ok, want, 'serious mode');
      assert.strictEqual((await call('settings:setNotifyNeedsMe', false)).ok, want, 'notifications');
      assert.strictEqual((await call('settings:setCheckUpdatesAtStart', false)).ok, want, 'update check');
      assert.strictEqual((await call('settings:setBreakResume', 'ask')).ok, want, 'break resume');
      assert.strictEqual((await call('settings:setChatLinksIn', 'system')).ok, want, 'chat links');
      assert.strictEqual((await call('settings:setDefaultCap', 75)).ok, want, 'default cap');
    };
    const good = new SettingsStore(path.join(d, 'g', 'durbar-settings.json')); good.load();
    await run(good, true);
    // clearing the cap is ok when it is saved (the expected value is what the setter parses, not the raw input)
    assert.deepStrictEqual(await call('settings:setDefaultCap', null), { ok: true, defaultMaxAiCredits: undefined }, 'clearing the cap through IPC is ok');
    assert.deepStrictEqual(await call('settings:setDefaultCap', ''), { ok: true, defaultMaxAiCredits: undefined });
    fs.writeFileSync(path.join(d, 'blocker'), 'x');
    const bad = new SettingsStore(path.join(d, 'blocker', 'durbar-settings.json')); bad.load();
    await run(bad, false);
    assert.deepStrictEqual(await call('settings:setSeriousMode', true), { ok: false, seriousMode: false }, 'a failed save reports the value in force');
    assert.deepStrictEqual(await call('settings:setDefaultCap', 75), { ok: false, unsaved: true, defaultMaxAiCredits: 75 });
    // issue #1094: a value already in force, asked for again while the disk refuses, is not "Saved" (the rollback restores the same value)
    {
      const same = new SettingsStore(path.join(d, 'blocker', 'durbar-settings.json')); same.load();
      handlers.clear();
      register({ getSettingsStore: () => same, getRunTheme: () => undefined, clearRunTheme: () => undefined });
      assert.deepStrictEqual(await call('settings:setSeriousMode', false), { ok: false, seriousMode: false }, 'serious mode');
      assert.deepStrictEqual(await call('settings:setNotifyNeedsMe', true), { ok: false, notifyNeedsMe: true }, 'notifications');
      assert.deepStrictEqual(await call('settings:setCheckUpdatesAtStart', true), { ok: false, checkUpdatesAtStart: true }, 'update check');
      assert.deepStrictEqual(await call('settings:setMcpSignInRefresh', MCP_SIGNIN_REFRESH_DEFAULT), { ok: false, mcpSignInRefresh: MCP_SIGNIN_REFRESH_DEFAULT }, 'sign-in refresh');
      assert.deepStrictEqual(await call('settings:setBreakResume', 'auto'), { ok: false, breakResume: 'auto' }, 'break resume');
      assert.deepStrictEqual(await call('settings:setChatLinksIn', 'session'), { ok: false, chatLinksIn: 'session' }, 'chat links');
      assert.deepStrictEqual(await call('settings:setDefaultCap', ''), { ok: false, defaultMaxAiCredits: undefined }, 'no cap asked while none is set');
    }
    await run(undefined, false);
    // a tighter cap that could not be saved is in force and the reply says so (the window shows "this run only")
    handlers.clear();
    const fresh = new SettingsStore(path.join(d, 'blocker', 'durbar-settings.json')); fresh.load();
    register({ getSettingsStore: () => fresh, getRunTheme: () => undefined, clearRunTheme: () => undefined });
    assert.deepStrictEqual(await call('settings:setDefaultCap', 60), { ok: false, unsaved: true, defaultMaxAiCredits: 60 });
    assert.deepStrictEqual(await call('settings:setDefaultCap', 500), { ok: false, defaultMaxAiCredits: 60 }, 'a looser one is not kept');
    // the "this run only" flag belongs to its setting: another setting kept for the run does not turn the cap reply into one
    {
      const root = path.join(d, 'late');
      const late = new SettingsStore(path.join(root, 'durbar-settings.json')); late.load();
      assert.strictEqual(late.setDefaultMaxAiCredits(100).value, 100);
      fs.rmSync(root, { recursive: true, force: true }); fs.writeFileSync(root, 'x');
      late.setSandboxAlwaysContinue('claude', false); // kept for the run
      handlers.clear();
      register({ getSettingsStore: () => late, getRunTheme: () => undefined, clearRunTheme: () => undefined });
      assert.deepStrictEqual(await call('settings:setDefaultCap', 100), { ok: false, defaultMaxAiCredits: 100 }, 'the same cap asked again while the disk refuses is not saved (issue #1094), and carries no flag from the sandbox choice');
      assert.deepStrictEqual((await call('settings:get')).unsaved, ['sandboxAlwaysContinue'], 'settings:get lists what is for this run only');
    }
  } finally {
    if (saved) require.cache[electronPath] = saved;
    else delete require.cache[electronPath];
    fs.rmSync(d, { recursive: true, force: true });
  }
}
process.exitCode = 1; // 0 only after the last check: an async step that never settles must fail the run
ipcChecks().then(() => { console.log('credits: all checks passed'); process.exitCode = 0; }, (e) => { console.error(e); process.exit(1); });
