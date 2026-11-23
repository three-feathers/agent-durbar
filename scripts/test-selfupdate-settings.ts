/**
 * Spec 118 T010, part 1 (FR-021): the `updates` settings keys of Durbar's own update check, validated on read (`parseUpdatesSettings`,
 * through `parseSettings`) and written through the existing `SettingsStore`. `npm run test:selfupdate-settings`. No Electron, no network.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore } from '../src/main/settings';
import { parseSettings } from '../src/shared/credits';
import { parseUpdatesSettings } from '../src/shared/selfupdate';
import type { SelfUpdateSettings } from '../src/shared/selfupdate';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-selfupdate-settings-'));
const T0 = 1_800_000_000_000;
const p = parseUpdatesSettings;

try {
  // validated on read, key by key
  assert.strictEqual(p({ selfCheck: 'false' }), undefined, 'FR-021 selfCheck: a string is absent (only a boolean counts)');
  assert.strictEqual(p({ selfCheck: 0 }), undefined, 'FR-021 selfCheck: a number is absent');
  assert.deepStrictEqual(p({ selfCheck: false }), { selfCheck: false }, 'FR-021 selfCheck: a boolean is kept');
  assert.strictEqual(p({ source: 'github:a/b' }), undefined, 'FR-021 source: only the parsed slug form, not another accepted spelling');
  assert.strictEqual(p({ source: 'https://evil.example/a/b' }), undefined, 'FR-021 source: another host is absent');
  assert.strictEqual(p({ source: 'a/b/c' }), undefined, 'FR-021 source: a path is absent');
  assert.deepStrictEqual(p({ source: 'ravi/durbar' }), { source: 'ravi/durbar' }, 'FR-021 source: a slug is kept');
  assert.strictEqual(p({ skip: '0.1.29-alpha.1' }), undefined, 'FR-021 skip: a pre-release is absent (strict MAJOR.MINOR.PATCH)');
  assert.strictEqual(p({ skip: 'v0.1.29' }), undefined, 'FR-021 skip: the tag form is absent');
  assert.strictEqual(p({ skip: '01.1.29' }), undefined, 'FR-021 skip: a leading zero is absent');
  assert.deepStrictEqual(p({ skip: '0.1.29' }), { skip: '0.1.29' }, 'FR-021 skip: a version is kept');
  for (const [bad, what] of [['0.1.29-alpha.1', 'a pre-release'], ['../x', 'a path'], ['v0.1.29', 'the tag form'], ['01.1.29', 'a leading zero'], ['0.1', 'two parts'], [129, 'a number'], [{}, 'an object']] as [unknown, string][]) {
    assert.strictEqual(p({ snooze: { version: bad, until: T0 } }), undefined, `FR-021 snooze.version: ${what} is absent`);
  }
  for (const [bad, what] of [[NaN, 'NaN'], [Infinity, 'Infinity'], [-1, 'a negative time'], [1e20, 'a time past the safe integers']] as [number, string][]) {
    assert.strictEqual(p({ snooze: { version: '0.1.29', until: bad } }), undefined, `FR-021 snooze.until: ${what} is absent`);
  }
  assert.strictEqual(p({ snooze: { version: '0.1.29', until: '9' } }), undefined, 'FR-021 snooze: a string time is absent');
  assert.strictEqual(p({ snooze: { version: '0.1.29', until: 1.5 } }), undefined, 'FR-021 snooze: a fractional time is absent');
  assert.deepStrictEqual(p({ snooze: { version: '0.1.29', until: T0, x: 1 } }), { snooze: { version: '0.1.29', until: T0 } }, 'FR-021 snooze: kept, extra keys dropped');
  assert.strictEqual(p({ lastCheck: { at: -1, latest: '0.1.29' } }), undefined, 'FR-021 lastCheck: a negative time is absent');
  assert.deepStrictEqual(p({ lastCheck: { at: 5, latest: 'x' } }), { lastCheck: { at: 5 } }, 'FR-021 lastCheck: a bad latest is dropped, the time kept');
  assert.strictEqual(p(['selfCheck']), undefined, 'FR-021: an array is not the updates object');
  assert.strictEqual(p('selfCheck'), undefined, 'FR-021: a string is not the updates object');

  // hostile shapes: a getter never runs, __proto__ and inherited values are never read
  let gets = 0;
  const g = Object.defineProperty({}, 'selfCheck', { enumerable: true, get: () => { gets++; return true; } });
  const n = Object.defineProperty({ version: '0.1.29' }, 'until', { enumerable: true, get: () => { gets++; return T0; } });
  assert.strictEqual(p(g), undefined, 'FR-021: a getter value is absent');
  assert.strictEqual(p({ snooze: n }), undefined, 'FR-021: a getter inside snooze is absent');
  assert.strictEqual(gets, 0, 'FR-021: a getter is never run');
  assert.strictEqual(p(JSON.parse('{"__proto__":{"selfCheck":false},"evil":1}') as unknown), undefined, 'FR-021: a "__proto__" key and unknown keys give nothing');
  assert.strictEqual(p(Object.create({ selfCheck: false }) as unknown), undefined, 'FR-021: an inherited value is never read');

  // the whole settings file: a hostile updates object never stops the rest from loading
  const s = parseSettings(JSON.stringify({ seriousMode: true, updates: { selfCheck: 'no', source: 'https://evil.example/a/b', snooze: [1], skip: { x: 1 }, lastCheck: 'x', extra: 'y' } }));
  assert.deepStrictEqual(s, { seriousMode: true }, 'FR-021: a hostile updates object is dropped as a whole, the other settings load');
  assert.deepStrictEqual(parseSettings('{"updates": {"selfCheck": false, "skip": "0.1.28"}}'), { updates: { selfCheck: false, skip: '0.1.28' } }, 'FR-021: valid keys load');

  // the store: the patch is validated first; one bad field refuses it all and changes nothing (review of PR 2064, item 1)
  const file = path.join(tmp, 'durbar-settings.json');
  fs.writeFileSync(file, JSON.stringify({ seriousMode: true, updates: 'off' }));
  const st = new SettingsStore(file);
  st.load();
  assert.deepStrictEqual(st.updates, {}, 'FR-021: a string updates value is absent, the store loads');
  const full = { selfCheck: false, source: 'ravi/durbar', snooze: { version: '0.1.29', until: T0 }, skip: '0.1.28', lastCheck: { at: T0, latest: '0.1.29' } };
  assert.ok(st.setUpdates(full), 'FR-021: a valid patch is written');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { updates?: unknown; seriousMode?: unknown };
  assert.deepStrictEqual([saved.updates, saved.seriousMode], [full, true], 'FR-021: setUpdates writes through the settings store, the other settings kept');
  const bytes = fs.readFileSync(file);
  const bad: [unknown, string][] = [
    [{ selfCheck: 'yes' }, 'selfCheck as a string'], [{ selfCheck: 1 }, 'selfCheck as a number'], [{ source: 'https://github.com/ravi/durbar' }, 'source as a URL'],
    [{ skip: '../x' }, 'skip as a path'], [{ snooze: { version: '0.1.30-rc.1', until: T0 } }, 'a pre-release snooze'], [{ snooze: { version: '0.1.30', until: T0, x: 1 } }, 'a snooze with an extra key'],
    [{ lastCheck: { at: T0, latest: 'x' } }, 'a lastCheck with a bad latest'], [{ skip: '0.1.30', selfCheck: 'on' }, 'a good field with a bad one'], [{ evil: 1 }, 'an unknown key'],
    [JSON.parse('{"__proto__":{"selfCheck":true}}'), 'a __proto__ key'], [Object.defineProperty({}, 'skip', { enumerable: true, get: () => '0.1.30' }), 'a getter'], [['selfCheck'], 'an array'], [null, 'null'],
  ];
  for (const [patch, what] of bad) {
    assert.strictEqual(st.setUpdates(patch as never), false, `FR-021: ${what} refuses the whole patch`);
    assert.deepStrictEqual(st.updates, full, `FR-021: ${what} changes nothing in memory`);
    assert.ok(fs.readFileSync(file).equals(bytes), `FR-021: ${what} changes nothing on disk (byte for byte)`);
  }
  assert.ok(st.setUpdates({ skip: '0.1.30', lastCheck: undefined }), 'FR-021: a valid patch with a removal is written');
  assert.deepStrictEqual(st.updates, { selfCheck: false, source: 'ravi/durbar', snooze: { version: '0.1.29', until: T0 }, skip: '0.1.30' }, 'FR-021: only the named fields change, undefined removes one');

  // the getter is a deep copy: no change to it, at any level, reaches the store (item 3)
  const copy = st.updates;
  copy.selfCheck = true;
  (copy.snooze as { until: number }).until = 9;
  (copy.snooze as { version: string }).version = '../x';
  copy.skip = 'x';
  assert.deepStrictEqual(st.updates, { selfCheck: false, source: 'ravi/durbar', snooze: { version: '0.1.29', until: T0 }, skip: '0.1.30' }, 'FR-021: the getter gives a deep copy');
  st.setUpdates({ lastCheck: { at: T0 } });
  const read = (x: SettingsStore): SelfUpdateSettings => x.updates; // not narrowed by the deepStrictEqual above
  const lc = read(st);
  (lc.lastCheck as { at: number }).at = -5;
  assert.strictEqual(read(st).lastCheck?.at, T0, 'FR-021: a nested lastCheck change does not reach the store');

  // a failed write restores the exact previous value for every field; only on -> off stays in force (item 2)
  const failing = (start: object): SettingsStore => {
    const f = path.join(tmp, `fail-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, JSON.stringify({ updates: start }));
    const s2 = new SettingsStore(f);
    s2.load();
    (s2 as unknown as { save(): boolean }).save = () => false; // an injected failing write
    return s2;
  };
  const start = { selfCheck: false, source: 'ravi/durbar', snooze: { version: '0.1.29', until: T0 }, skip: '0.1.28', lastCheck: { at: T0, latest: '0.1.29' } };
  const patches: [object, string][] = [
    [{ selfCheck: true }, 'selfCheck on'], [{ selfCheck: undefined }, 'selfCheck removed (the default, on)'], [{ source: 'other/repo' }, 'source'], [{ source: undefined }, 'source removed'],
    [{ snooze: { version: '0.1.30', until: T0 + 1 } }, 'snooze'], [{ skip: '0.1.30' }, 'skip'], [{ lastCheck: { at: T0 + 1 } }, 'lastCheck'], [{ snooze: undefined, skip: undefined, lastCheck: undefined }, 'every bookkeeping field removed'],
  ];
  for (const [patch, what] of patches) {
    const s2 = failing(start);
    assert.strictEqual(s2.setUpdates(patch), false, `FR-021: ${what}: the write fails`);
    assert.deepStrictEqual(s2.updates, start, `FR-021: ${what}: a failed write restores the exact previous value`);
  }
  const on = failing({ skip: '0.1.28' });
  assert.strictEqual(on.setUpdates({ selfCheck: false, skip: '0.1.30' }), false, 'FR-021: switching off: the write fails');
  assert.ok(on.updates.selfCheck === false && on.updates.skip === '0.1.28' && on.isUnsaved('updates'), 'FR-021: switching off stays in force for this run when it cannot be saved, the rest is restored');
  const failed = failing({ selfCheck: false });
  failed.setUpdates({ selfCheck: false });
  assert.strictEqual(failed.isUnsaved('updates'), false, 'FR-021: an unchanged off is not marked unsaved');
  console.log('selfupdate-settings: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
