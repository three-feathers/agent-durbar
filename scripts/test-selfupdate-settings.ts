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

  // the store: validated writes, atomic through the existing commit
  const file = path.join(tmp, 'durbar-settings.json');
  fs.writeFileSync(file, JSON.stringify({ seriousMode: true, updates: 'off' }));
  const st = new SettingsStore(file);
  st.load();
  assert.deepStrictEqual(st.updates, {}, 'FR-021: a string updates value is absent, the store loads');
  assert.ok(st.setUpdates({ skip: '0.1.28' }), 'FR-021: a valid patch is written');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { updates?: unknown; seriousMode?: unknown };
  assert.deepStrictEqual([saved.updates, saved.seriousMode], [{ skip: '0.1.28' }, true], 'FR-021: setUpdates writes through the settings store, the other settings kept');
  st.setUpdates({ skip: '../x' });
  assert.strictEqual((JSON.parse(fs.readFileSync(file, 'utf8')) as { updates?: unknown }).updates, undefined, 'FR-021: a patch that fails validation is not written');
  st.setUpdates({ selfCheck: false, lastCheck: { at: T0, latest: '0.1.29' } });
  st.setUpdates({ lastCheck: undefined });
  assert.deepStrictEqual(st.updates, { selfCheck: false }, 'FR-021: an undefined value removes its key, the others stay');
  const copy = st.updates;
  copy.selfCheck = true;
  assert.strictEqual(st.updates.selfCheck, false, 'FR-021: the getter gives a copy');

  // a failed write: the safe direction stays in force for this run, turning the check on is rolled back
  const ro = new SettingsStore(path.join(tmp, 'missing-dir-file', 'x', 'durbar-settings.json'));
  ro.load();
  fs.writeFileSync(path.join(tmp, 'missing-dir-file'), 'a file where the folder should be');
  assert.strictEqual(ro.setUpdates({ selfCheck: false }), false, 'FR-021: the write fails');
  assert.ok(ro.updates.selfCheck === false && ro.isUnsaved('updates'), 'FR-021: switching off stays in force for this run when it cannot be saved');
  assert.strictEqual(ro.setUpdates({ selfCheck: true }), false, 'FR-021: the write fails again');
  assert.strictEqual(ro.updates.selfCheck, false, 'FR-021: switching on is rolled back when it cannot be saved');
  console.log('selfupdate-settings: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
