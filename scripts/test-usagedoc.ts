/** Usage totals kept across restarts (spec 011 FR-024..FR-026, FR-030, issue #21): `npm run test:usagedoc`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_FOLDERS, MAX_NAME, cleanName, emptyUsageDoc, normaliseFolderKey, officeTotals, recordUsage, sanitizeUsageDoc, validNano } from '../src/shared/usagedoc';
import { UsageTotalsStore, folderFingerprint } from '../src/main/usagetotalsstore';

const AIU = 1e9;
const K1 = 'a'.repeat(32), K2 = 'b'.repeat(32);
const ev = (inputTokens?: unknown, outputTokens?: unknown, nanoAiu?: unknown) => ({ type: 'usage', inputTokens, outputTokens, nanoAiu });

// recording: sums, names, the unreported count
const d = emptyUsageDoc(new Date('2026-10-17T10:00:00Z'));
assert.strictEqual(d.since, '2026-10-17T10:00:00.000Z');
assert.ok(recordUsage(d, K1, 'app', ev(1000, 100, 0.5 * AIU)));
assert.ok(recordUsage(d, K1, 'app', ev(2000, 200, 0.25 * AIU)));
assert.ok(recordUsage(d, K2, 'docs', ev(500, 50, 1.25 * AIU)));
assert.deepStrictEqual({ ...d.folders[K1] }, { name: 'app', calls: 2, inTokens: 3000, outTokens: 300, nano: 0.75 * AIU, unreported: 0 });
assert.strictEqual(officeTotals(d).nano, 2 * AIU, 'office total = sum of the folders');
assert.strictEqual(officeTotals(d).calls, 3);

// invalid credit figures are "not reported", never NaN or a huge number; the call still counts
const bad = emptyUsageDoc();
for (const x of [undefined, null, '5', NaN, Infinity, -1, 1e16, {}]) recordUsage(bad, K1, 'x', ev(10, 1, x));
assert.deepStrictEqual({ ...bad.folders[K1] }, { name: 'x', calls: 8, inTokens: 80, outTokens: 8, nano: 0, unreported: 8 });
assert.ok(validNano(0) && validNano(1e15) && !validNano(1e15 + 1) && !validNano(-0.001) && !validNano('1'));
const tk = emptyUsageDoc();
recordUsage(tk, K1, 'x', ev(NaN, -5, AIU)); recordUsage(tk, K1, 'x', ev('7', Infinity, AIU));
assert.deepStrictEqual({ ...tk.folders[K1] }, { name: 'x', calls: 2, inTokens: 0, outTokens: 0, nano: 2 * AIU, unreported: 0 }, 'bad token fields count as 0');

// only usage events with a fingerprint key change anything
const noop = emptyUsageDoc();
for (const e of [undefined, null, 'usage', 5, {}, { type: 'toolCall' }, { type: 'output' }]) assert.strictEqual(recordUsage(noop, K1, 'x', e), false, String(JSON.stringify(e)));
for (const k of ['', 'abc', '/Users/me/app', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(33), 'a'.repeat(31)]) assert.strictEqual(recordUsage(noop, k, 'x', ev(1, 1, AIU)), false, 'key refused: ' + k);
assert.deepStrictEqual(Object.keys(noop.folders), []);

// names: cleaned and capped, never empty
assert.strictEqual(cleanName('  my app  '), 'my app');
assert.strictEqual(cleanName('a\nb\u0000c'), 'a b c');
assert.strictEqual(cleanName(''), 'folder'); assert.strictEqual(cleanName(undefined), 'folder'); assert.strictEqual(cleanName(5), 'folder');
assert.ok(cleanName('x'.repeat(500)).length <= MAX_NAME);

// at most 2000 folders; an existing folder still counts at the cap
const many = emptyUsageDoc();
for (let i = 0; i < MAX_FOLDERS + 20; i++) recordUsage(many, i.toString(16).padStart(32, '0'), 'f' + i, ev(1, 1, 1));
assert.strictEqual(Object.keys(many.folders).length, MAX_FOLDERS);
assert.ok(recordUsage(many, '0'.repeat(32), 'f0', ev(1, 1, 1)), 'an existing folder keeps counting at the cap');
assert.strictEqual(many.folders['0'.repeat(32)].calls, 2);

// sanitize: hostile or odd files never throw and never keep what is not valid
for (const raw of [null, undefined, 5, 'x', [], true, {}, { folders: 'x' }, { folders: [] }, { folders: null }]) {
  const s = sanitizeUsageDoc(raw, new Date('2026-01-01T00:00:00Z'));
  assert.deepStrictEqual({ ...s.folders }, {}, String(JSON.stringify(raw)));
  assert.strictEqual(s.version, 1);
}
const s2 = sanitizeUsageDoc({
  version: 99, since: '2026-02-03T04:05:06Z',
  folders: {
    [K1]: { name: 'ok', calls: 3.7, inTokens: 10, outTokens: -4, nano: 5 * AIU, unreported: 1 },
    '/Users/me/secret-project': { name: 'leak', calls: 1, inTokens: 1, outTokens: 1, nano: 1, unreported: 0 },
    [K2]: 'not an object', ['c'.repeat(32)]: [1, 2], ['d'.repeat(32)]: { name: 7, calls: 'x', nano: NaN },
    __proto__: { polluted: true },
  },
}, new Date());
assert.strictEqual(s2.since, '2026-02-03T04:05:06.000Z');
assert.deepStrictEqual(Object.keys(s2.folders).sort(), [K1, 'd'.repeat(32)].sort(), 'only fingerprint keys with object values survive; path keys are dropped');
assert.deepStrictEqual({ ...s2.folders[K1] }, { name: 'ok', calls: 3, inTokens: 10, outTokens: 0, nano: 5 * AIU, unreported: 1 });
assert.deepStrictEqual({ ...s2.folders['d'.repeat(32)] }, { name: 'folder', calls: 0, inTokens: 0, outTokens: 0, nano: 0, unreported: 0 });
assert.strictEqual(({} as Record<string, unknown>).polluted, undefined, 'no prototype pollution');
assert.strictEqual(sanitizeUsageDoc({ since: 'not a date', folders: {} }, new Date('2026-05-05T00:00:00Z')).since, '2026-05-05T00:00:00.000Z', 'a bad date falls back to now');
const huge = sanitizeUsageDoc({ folders: { [K1]: { name: 'x', calls: 1e300, inTokens: 1e300, outTokens: 1e300, nano: 1e300, unreported: 1e300 } } });
assert.ok(Object.values(huge.folders[K1]).every((v) => typeof v === 'string' || (Number.isFinite(v) && v < 1e30)), 'absurd numbers are capped');

// folder keys: separators and case on Windows, trailing separators everywhere
assert.strictEqual(normaliseFolderKey('C:\\Work\\App\\', 'win32'), 'c:/work/app');
assert.strictEqual(normaliseFolderKey('c:/work/app', 'win32'), 'c:/work/app', 'one folder on Windows however it is spelled');
assert.strictEqual(normaliseFolderKey('/Users/Me/App/', 'darwin'), '/Users/Me/App');
assert.strictEqual(normaliseFolderKey('/Users/Me/App', 'linux'), '/Users/Me/App');
assert.notStrictEqual(normaliseFolderKey('/a/App', 'linux'), normaliseFolderKey('/a/app', 'linux'), 'case counts off Windows');
assert.strictEqual(normaliseFolderKey('', 'linux'), '/');
assert.strictEqual(folderFingerprint('C:\\Work\\App', 'win32'), folderFingerprint('c:/work/app/', 'win32'));
assert.notStrictEqual(folderFingerprint('/a/app', 'linux'), folderFingerprint('/b/app', 'linux'), 'same name, different folder: different fingerprint');
assert.ok(/^[0-9a-f]{32}$/.test(folderFingerprint('/any/path', 'linux')));

// the store: debounce, flush, no path on disk, restart, baseline vs run, reset, hostile files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-totals-'));
try {
  const file = path.join(dir, 'sub', 'durbar-usage-totals.json');
  let now = new Date('2026-10-17T10:00:00Z');
  const timers: { fn: () => void; ms: number; id: number }[] = []; let nextId = 1;
  const mk = (f = file) => new UsageTotalsStore(f, { now: () => now, platform: 'linux', setTimer: (fn, ms) => { const t = { fn, ms, id: nextId++ }; timers.push(t); return t.id; }, clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); } });
  const st = mk(); st.load();
  assert.strictEqual(st.baselineView().office.calls, 0, 'missing file: empty');
  assert.strictEqual(st.baselineView().since, '2026-10-17T10:00:00.000Z');

  st.record('/Users/me/secret-project', 'secret-project', ev(1000, 100, 0.5 * AIU));
  st.record('/Users/me/secret-project/', 'secret-project', ev(1000, 100, 0.25 * AIU));
  st.record('/work/app', 'app', { type: 'toolCall' });
  assert.strictEqual(timers.length, 1, 'one debounced write, however many events');
  assert.strictEqual(timers[0].ms, 2000);
  assert.ok(!fs.existsSync(file), 'nothing written before the debounce');
  timers[0].fn();
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!/secret-project\//.test(onDisk) && !onDisk.includes('/Users'), 'no path on disk');
  assert.ok(onDisk.includes('"name":"secret-project"'), 'the display name is kept');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')), [], 'no temp file left');
  const docOnDisk = JSON.parse(onDisk) as { version: number; folders: Record<string, { calls: number; nano: number }> };
  assert.strictEqual(docOnDisk.version, 1);
  assert.deepStrictEqual(Object.keys(docOnDisk.folders), [folderFingerprint('/Users/me/secret-project', 'linux')], 'a trailing slash is the same folder');
  assert.strictEqual(Object.values(docOnDisk.folders)[0].calls, 2);

  // baseline = what was on disk when the file was loaded; this run's events do not change it (the window adds its own figures)
  assert.strictEqual(st.baselineView().office.calls, 0, 'this run is not in the baseline');
  st.record('/work/app', 'app', ev(5, 5, 2 * AIU)); st.flush();
  assert.strictEqual(st.baselineView().folderOf('/work/app'), undefined);

  // restart: the saved document becomes the baseline, since the first run
  now = new Date('2026-10-18T08:00:00Z');
  const again = mk(); again.load();
  const b = again.baselineView();
  assert.strictEqual(b.since, '2026-10-17T10:00:00.000Z', 'since is the first run, not the restart');
  assert.strictEqual(b.office.calls, 3);
  assert.strictEqual(b.office.nano, 2.75 * AIU);
  assert.strictEqual(b.folderOf('/Users/me/secret-project')?.nano, 0.75 * AIU);
  assert.strictEqual(b.folderOf('/Users/me/secret-project')?.name, 'secret-project');
  assert.strictEqual(b.folderOf('/never/seen'), undefined);
  assert.strictEqual(b.office.nano, officeTotals(again.view()).nano, 'folders no longer listed still count in the office figure');
  const copy = again.view(); copy.folders[K1] = { name: 'x', calls: 1, inTokens: 0, outTokens: 0, nano: 1, unreported: 0 };
  assert.strictEqual(again.view().folders[K1], undefined, 'view() returns a copy');

  // reset: empty baseline and file, since = now, and a restart stays empty
  again.record('/work/app', 'app', ev(1, 1, AIU));
  now = new Date('2026-10-19T09:00:00Z');
  again.reset();
  assert.strictEqual(again.baselineView().office.calls, 0);
  assert.strictEqual(again.baselineView().since, '2026-10-19T09:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).folders, {}, 'the file is empty after a reset');
  const third = mk(); third.load();
  assert.strictEqual(third.baselineView().office.calls, 0); assert.strictEqual(third.baselineView().since, '2026-10-19T09:00:00.000Z');
  again.record('/work/app', 'app', ev(1, 1, AIU)); again.flush();
  assert.strictEqual(mk().view().folders[again.keyFor('/work/app')]?.calls, undefined, 'a store that never loaded starts empty: load() is what reads the file');
  const fourth = mk(); fourth.load();
  assert.strictEqual(fourth.baselineView().office.calls, 1, 'events after a reset are saved');

  // hostile and broken files: empty document, no throw
  fs.writeFileSync(file, '{{{'); const c1 = mk(); c1.load(); assert.strictEqual(c1.baselineView().office.calls, 0);
  fs.writeFileSync(file, JSON.stringify({ folders: { '/etc/passwd': { calls: 5 } } })); const c2 = mk(); c2.load(); assert.deepStrictEqual({ ...c2.view().folders }, {});
  fs.writeFileSync(file, 'x'.repeat(3 * 1024 * 1024)); const c3 = mk(); c3.load(); assert.strictEqual(c3.baselineView().office.calls, 0, 'an oversized file is ignored');
  fs.rmSync(file); fs.mkdirSync(file); const c4 = mk(); c4.load(); assert.strictEqual(c4.baselineView().office.calls, 0, 'a directory where the file should be');
  fs.rmSync(file, { recursive: true });

  // a disk that refuses writes: counting continues, the error is reported, nothing throws
  const ro = mk(path.join(file, 'x', 'y.json')); ro.load();
  fs.writeFileSync(file, 'a file where a folder is needed');
  ro.record('/w', 'w', ev(1, 1, AIU)); ro.flush();
  assert.ok(typeof ro.lastError === 'string' && ro.lastError.length > 0, 'lastError is set');
  assert.strictEqual(ro.view().folders[ro.keyFor('/w')].calls, 1, 'counting continues in memory');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('usagedoc tests passed');
