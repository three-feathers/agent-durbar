/** Spec 006 FR-038..FR-040 (issue #606): the running marker and the choice of interrupted sessions. `npm run test:crashmarker`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CrashMarker, MAX_BUSY, cleanBusy, interruptedFrom, parseMarker, serializeMarker } from '../src/main/crashmarker';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-crash-'));
const file = path.join(dir, 'sub', 'durbar-running.json');

// ---- parse: strict, ids only
assert.strictEqual(parseMarker('{{'), null, 'not JSON');
assert.strictEqual(parseMarker('[1]'), null, 'an array is not a marker');
assert.strictEqual(parseMarker('"x"'), null);
assert.strictEqual(parseMarker('x'.repeat(70 * 1024)), null, 'too big');
assert.deepStrictEqual(parseMarker('{}'), { version: 1, startedAt: 0, busy: [] }, 'an empty object is still an unclean run with nothing known');
const evil = [
  { id: '../etc', adapterId: 'copilot' }, { id: 'a/b', adapterId: 'copilot' }, { id: 'a.b', adapterId: 'copilot' }, { id: '', adapterId: 'copilot' },
  { id: A, adapterId: 'Copilot' }, { id: A, adapterId: 'a b' }, { id: A, adapterId: 7 }, { id: 7, adapterId: 'copilot' }, null, 'x', [], { id: 'x'.repeat(101), adapterId: 'copilot' },
  { id: B, adapterId: 'claude', prompt: 'ghp_secret', title: 'secret title' }, { id: B, adapterId: 'claude' },
];
assert.deepStrictEqual(cleanBusy(evil), [{ id: B, adapterId: 'claude' }], 'only well-formed ids survive, once, with no extra field');
assert.deepStrictEqual(cleanBusy('x'), []);
assert.strictEqual(cleanBusy(Array.from({ length: 100 }, (_, i) => ({ id: 's' + i, adapterId: 'copilot' }))).length, MAX_BUSY, 'capped');
assert.ok(!/prompt|title|ghp_/.test(serializeMarker({ version: 1, startedAt: 5, busy: evil as never })), 'nothing but ids is written');
assert.deepStrictEqual(parseMarker(serializeMarker({ version: 1, startedAt: 5.4, busy: [{ id: A, adapterId: 'copilot' }] })), { version: 1, startedAt: 5, busy: [{ id: A, adapterId: 'copilot' }] }, 'round trip');

// ---- the file: first run, busy changes, clean exit, crash
const timers: Array<() => void> = [];
let cleared = 0;
const deps = { now: () => 1000, setTimer: (fn: () => void) => { timers.push(fn); return timers.length as never; }, clearTimer: () => { cleared++; } };
const m1 = new CrashMarker(file, deps);
let r = m1.begin();
assert.deepStrictEqual(r, { unclean: false, marker: null }, 'no file: first run, nothing interrupted');
assert.ok(fs.existsSync(file), 'the marker exists while running');
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'mode 0600');
assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['durbar-running.json'], 'no temp file is left behind');
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8')), { version: 1, startedAt: 1000, busy: [] });

m1.setBusy([{ id: A, adapterId: 'copilot' }]);
m1.setBusy([{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }]);
assert.strictEqual(timers.length, 1, 'changes inside the 250 ms window share one write');
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8'))?.busy, [], 'not yet written');
timers.shift()!();
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8'))?.busy, [{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }], 'written after the window');
const mtimeBefore = fs.statSync(file).mtimeMs;
m1.setBusy([{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }]);
timers.shift()!();
assert.strictEqual(fs.statSync(file).mtimeMs, mtimeBefore, 'the same set is not written again');

// crash: the file stays; the next run reads it
const m2 = new CrashMarker(file, deps);
r = m2.begin();
assert.strictEqual(r.unclean, true, 'a marker left behind is an unclean exit');
assert.deepStrictEqual(r.marker?.busy, [{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }]);
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8'))?.busy, [], 'and the new run starts with an empty marker of its own');

// clean exit
m2.setBusy([{ id: C, adapterId: 'codex' }]);
m2.clear();
assert.ok(!fs.existsSync(file), 'a normal exit removes the marker');
assert.strictEqual(cleared >= 1, true, 'and cancels the pending write');
timers.shift()?.();
assert.ok(!fs.existsSync(file), 'a late timer does not bring the file back');
m2.setBusy([{ id: A, adapterId: 'copilot' }]);
m2.flush();
assert.ok(!fs.existsSync(file), 'nothing is written after clear');
const m3 = new CrashMarker(file, deps);
assert.deepStrictEqual(m3.begin(), { unclean: false, marker: null }, 'after a clean exit the next start is clean');
m3.clear();

// a garbled marker: unclean, nothing known; replaced
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, '{{{');
const m4 = new CrashMarker(file, deps);
r = m4.begin();
assert.deepStrictEqual(r, { unclean: true, marker: null }, 'garbage: unclean, no sessions');
assert.deepStrictEqual(interruptedFrom(r.marker, []).items, []);
m4.clear();

// a read-only place: begin and setBusy do not throw
const blocked = new CrashMarker(path.join(dir, 'sub', 'durbar-running.json', 'x'), deps);
fs.writeFileSync(file, '{}');
assert.doesNotThrow(() => { blocked.begin(); blocked.setBusy([{ id: A, adapterId: 'copilot' }]); blocked.flush(); blocked.clear(); }, 'a profile that cannot be written does not break the app');
fs.rmSync(file, { force: true });

// ---- which sessions count as interrupted (FR-040)
const prev = { version: 1 as const, startedAt: 1, busy: [{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }, { id: C, adapterId: 'codex' }] };
const restored = [
  { id: A, adapterId: 'copilot', resumeLast: true, folderName: 'api' },
  { id: B, adapterId: 'claude', resumeLast: false, folderName: 'web' }, // started fresh: not resumable
  { id: C, adapterId: 'copilot', resumeLast: true, folderName: 'docs' }, // other agent app than at the crash
  { id: 'zzz', adapterId: 'copilot', resumeLast: true, folderName: 'idle one' }, // was not busy
];
const got = interruptedFrom(prev, restored);
assert.deepStrictEqual(got.items, [{ id: A, adapterId: 'copilot', folderName: 'api' }], 'only a busy, restored, resumable session of the same app');
assert.strictEqual(got.missing, 2, 'the others are counted, so the card is honest');
assert.deepStrictEqual(interruptedFrom(null, restored), { items: [], missing: 0 });
assert.deepStrictEqual(interruptedFrom({ ...prev, busy: [] }, restored).items, [], 'a crash while everything was idle shows no card');
assert.deepStrictEqual(interruptedFrom(prev, [restored[0]!, restored[0]!]).items.length, 1, 'a duplicate restored id counts once');

fs.rmSync(dir, { recursive: true, force: true });
console.log('crashmarker: ok');
