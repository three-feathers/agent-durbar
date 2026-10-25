/** Spec 006 FR-038..FR-040 (issue #606): the running marker and the choice of interrupted sessions. `npm run test:crashmarker`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CrashMarker, MAX_BUSY, MAX_MARKER_BYTES, cleanBusy, installCrashMarker, interruptedFrom, markerName, parseMarker, readMarkerFile, serializeMarker } from '../src/main/crashmarker';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-crash-'));
const sub = path.join(dir, 'sub');
const PID = 4242;
const file = path.join(sub, markerName(PID));
const dead = (): boolean => false;

// ---- parse: strict, ids only
assert.strictEqual(parseMarker('{{'), null, 'not JSON');
assert.strictEqual(parseMarker('[1]'), null, 'an array is not a marker');
assert.strictEqual(parseMarker('"x"'), null);
const bigValid = JSON.stringify({ version: 1, startedAt: 1, busy: [{ id: A, adapterId: 'copilot' }], pad: 'x'.repeat(MAX_MARKER_BYTES) });
assert.ok(JSON.parse(bigValid) && bigValid.length > MAX_MARKER_BYTES, 'the fixture is valid JSON over the cap');
assert.strictEqual(parseMarker(bigValid), null, 'too big, although it is valid JSON');
assert.deepStrictEqual(parseMarker(bigValid.replace(/x{1024,}/, 'x'))?.busy, [{ id: A, adapterId: 'copilot' }], 'the same marker under the cap is read');
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
const deps = { pid: PID, alive: dead, now: () => 1000, setTimer: (fn: () => void) => { timers.push(fn); return timers.length as never; }, clearTimer: () => { cleared++; } };
const m1 = new CrashMarker(sub, deps);
assert.strictEqual(m1.file, file, 'the file is named after this process');
let r = m1.begin();
assert.deepStrictEqual(r, { unclean: false, marker: null }, 'no file: first run, nothing interrupted');
assert.ok(fs.existsSync(file), 'the marker exists while running');
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'mode 0600');
assert.deepStrictEqual(fs.readdirSync(sub), [markerName(PID)], 'no temp file is left behind');
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8')), { version: 1, startedAt: 1000, pid: PID, busy: [] });

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
// (the next run gets another pid; the old file's process is gone)
const deps2 = { ...deps, pid: PID + 1 };
const file2 = path.join(sub, markerName(PID + 1));
const m2 = new CrashMarker(sub, deps2);
r = m2.begin();
assert.ok(!fs.existsSync(file), 'the crashed run\'s marker is removed once read');
assert.strictEqual(r.unclean, true, 'a marker left behind is an unclean exit');
assert.deepStrictEqual(r.marker?.busy, [{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }]);
assert.deepStrictEqual(parseMarker(fs.readFileSync(file2, 'utf8'))?.busy, [], 'and the new run starts with an empty marker of its own');

// clean exit
m2.setBusy([{ id: C, adapterId: 'codex' }]);
m2.clear();
assert.ok(!fs.existsSync(file2), 'a normal exit removes the marker');
assert.strictEqual(cleared >= 1, true, 'and cancels the pending write');
timers.shift()?.();
assert.ok(!fs.existsSync(file2), 'a late timer does not bring the file back');
m2.setBusy([{ id: A, adapterId: 'copilot' }]);
m2.flush();
assert.ok(!fs.existsSync(file2), 'nothing is written after clear');
const m3 = new CrashMarker(sub, deps);
assert.deepStrictEqual(m3.begin(), { unclean: false, marker: null }, 'after a clean exit the next start is clean');
m3.clear();

// a garbled marker: unclean, nothing known; replaced
fs.mkdirSync(sub, { recursive: true });
fs.writeFileSync(file, '{{{');
const m4 = new CrashMarker(sub, deps2);
r = m4.begin();
assert.deepStrictEqual(r, { unclean: true, marker: { version: 1, startedAt: 0, busy: [] } }, 'garbage: unclean, no sessions');
assert.deepStrictEqual(interruptedFrom(r.marker, []).items, []);
m4.clear();

// a read-only place: begin and setBusy do not throw
fs.writeFileSync(path.join(sub, 'blocker'), '{}');
const blocked = new CrashMarker(path.join(sub, 'blocker', 'x'), deps);
assert.doesNotThrow(() => { blocked.begin(); blocked.setBusy([{ id: A, adapterId: 'copilot' }]); blocked.flush(); blocked.clear(); }, 'a profile that cannot be written does not break the app');
fs.rmSync(path.join(sub, 'blocker'), { force: true });

// ---- the size is checked before reading (review of #720 item 6): a huge file is never read into memory
fs.writeFileSync(file, bigValid);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realFs = require('fs') as Record<string, unknown>; // the module object itself, which crashmarker.ts's import reads through
const readSync0 = fs.readSync;
let readBytes = 0;
realFs.readSync = (...a: Parameters<typeof fs.readSync>) => { const n = (readSync0 as (...x: unknown[]) => number)(...a); readBytes += n; return n; };
const origRead = fs.readFileSync;
let wholeRead = 0;
realFs.readFileSync = (...a: Parameters<typeof fs.readFileSync>) => { if (String(a[0]).includes('durbar-running')) wholeRead++; return (origRead as (...x: unknown[]) => unknown)(...a); };
assert.strictEqual(readMarkerFile(file), null, 'an oversized marker is not a marker');
assert.strictEqual(readBytes, 0, 'and none of it was read');
fs.writeFileSync(file, serializeMarker({ version: 1, startedAt: 3, busy: [{ id: A, adapterId: 'copilot' }] }));
assert.deepStrictEqual(readMarkerFile(file)?.busy, [{ id: A, adapterId: 'copilot' }], 'a normal one is read');
assert.ok(readBytes > 0 && wholeRead === 0, 'through the bounded read, not a whole-file read');
realFs.readSync = readSync0;
realFs.readFileSync = origRead;
assert.strictEqual(readMarkerFile(path.join(sub, 'none.json')), undefined, 'no file');
fs.rmSync(file, { force: true });

// ---- two Durbar processes on one profile (review of #720 item 7)
const live = new Set<number>();
const isLive = (p: number): boolean => live.has(p);
const procA = new CrashMarker(sub, { ...deps, pid: 100, alive: isLive });
live.add(100);
assert.strictEqual(procA.begin().unclean, false, 'A starts clean');
procA.setBusy([{ id: A, adapterId: 'copilot' }]);
procA.flush();
const procB = new CrashMarker(sub, { ...deps, pid: 200, alive: isLive });
live.add(200);
assert.deepStrictEqual(procB.begin(), { unclean: false, marker: null }, 'B does not read A\'s live marker as a crash, so it offers none of A\'s sessions');
assert.ok(fs.existsSync(path.join(sub, markerName(100))), 'and leaves A\'s marker alone');
procB.setBusy([{ id: B, adapterId: 'claude' }]);
procB.flush();
procA.clear();
live.delete(100);
assert.ok(fs.existsSync(path.join(sub, markerName(200))), 'A\'s clean quit does not remove B\'s marker');
assert.deepStrictEqual(parseMarker(fs.readFileSync(path.join(sub, markerName(200)), 'utf8'))?.busy, [{ id: B, adapterId: 'claude' }]);
fs.rmSync(path.join(sub, markerName(200)));
procB.setBusy([{ id: B, adapterId: 'claude' }]);
procB.flush();
assert.ok(fs.existsSync(path.join(sub, markerName(200))), 'a marker someone removed is written again, although the set did not change');
live.delete(200); // B crashes
const procC = new CrashMarker(sub, { ...deps, pid: 300, alive: isLive });
live.add(300);
const rc = procC.begin();
assert.strictEqual(rc.unclean, true, 'B\'s marker, its process gone, is a crash');
assert.deepStrictEqual(rc.marker?.busy, [{ id: B, adapterId: 'claude' }]);
procC.clear();
// a dead process's marker that has this process's pid (pid reused after a reboot) is still the last run's
fs.writeFileSync(path.join(sub, markerName(300)), serializeMarker({ version: 1, startedAt: 1, pid: 300, busy: [{ id: C, adapterId: 'codex' }] }));
const procC2 = new CrashMarker(sub, { ...deps, pid: 300, alive: () => true });
assert.deepStrictEqual(procC2.begin().marker?.busy, [{ id: C, adapterId: 'codex' }], 'our own pid on an old file: it is a previous run');
procC2.clear();
// two crashed runs: merged, in order, once
fs.writeFileSync(path.join(sub, markerName(11)), serializeMarker({ version: 1, startedAt: 1, busy: [{ id: A, adapterId: 'copilot' }, { id: B, adapterId: 'claude' }] }));
fs.writeFileSync(path.join(sub, markerName(12)), serializeMarker({ version: 1, startedAt: 2, busy: [{ id: B, adapterId: 'claude' }, { id: C, adapterId: 'codex' }] }));
fs.writeFileSync(path.join(sub, 'durbar-running.json'), '{}'); // not a per-process name: ignored
const procD = new CrashMarker(sub, deps);
assert.deepStrictEqual(procD.begin().marker?.busy.map((x) => x.id), [A, B, C], 'merged without duplicates');
procD.clear();
assert.deepStrictEqual(fs.readdirSync(sub).sort(), ['durbar-running.json'], 'the crashed runs\' files are gone');
fs.rmSync(path.join(sub, 'durbar-running.json'));

// ---- main.ts wiring (review of #720 item 1): installCrashMarker, and main.ts calls it with the simulator flag and both exit hooks
const hooks: Record<string, Array<() => void>> = { willQuit: [], exit: [] };
assert.strictEqual(installCrashMarker({ simulator: true, dir: sub, onWillQuit: (f) => hooks.willQuit!.push(f), onExit: (f) => hooks.exit!.push(f), deps }), undefined, 'no marker under the simulator');
assert.ok(!fs.existsSync(file) && hooks.willQuit!.length + hooks.exit!.length === 0, 'and no file, no hook');
for (const which of ['willQuit', 'exit'] as const) {
  hooks.willQuit = []; hooks.exit = [];
  const inst = installCrashMarker({ simulator: false, dir: sub, onWillQuit: (f) => hooks.willQuit!.push(f), onExit: (f) => hooks.exit!.push(f), deps });
  assert.ok(inst && fs.existsSync(file), 'a marker while running');
  assert.strictEqual(hooks.willQuit!.length, 1, 'a will-quit hook');
  assert.strictEqual(hooks.exit!.length, 1, 'an exit hook (app.exit skips will-quit)');
  hooks[which]![0]!();
  assert.ok(!fs.existsSync(file), `the ${which} hook alone removes the marker`);
}
const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\s+/g, ' ');
assert.ok(mainSrc.includes("installCrashMarker({ simulator: SIMULATOR, dir: app.getPath('userData'), onWillQuit: (fn) => app.on('will-quit', fn), onExit: (fn) => process.once('exit', fn) })"), 'main.ts installs the marker with the simulator flag and both exit hooks');
assert.ok(!/new CrashMarker\(/.test(mainSrc), 'and nowhere else');

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
