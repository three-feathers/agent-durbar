/** Spec 006 FR-038..FR-040 (issue #606): the running marker and the choice of interrupted sessions. `npm run test:crashmarker`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CrashMarker, REFRESH_MS, UPTIME_MARGIN_S, MAX_BUSY, MAX_SCAN, pidAlive, MAX_MARKER_BYTES, cleanBusy, installCrashMarker, interruptedFrom, markerName, parseMarker, readMarkerFile, serializeMarker } from '../src/main/crashmarker';

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
const deps = { pid: PID, alive: dead, uptime: () => 5000, now: () => 1000, setTimer: (fn: () => void) => { timers.push(fn); return timers.length as never; }, clearTimer: () => { cleared++; } };
const m1 = new CrashMarker(sub, deps);
assert.strictEqual(m1.file, file, 'the file is named after this process');
let r = m1.begin();
assert.deepStrictEqual(r, { unclean: false, marker: null }, 'no file: first run, nothing interrupted');
assert.ok(fs.existsSync(file), 'the marker exists while running');
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'mode 0600');
assert.deepStrictEqual(fs.readdirSync(sub), [markerName(PID)], 'no temp file is left behind');
assert.deepStrictEqual(parseMarker(fs.readFileSync(file, 'utf8')), { version: 1, startedAt: 1000, pid: PID, up: 5000, busy: [] });

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

// ---- pidAlive (review of PR 720, round 2): success and EPERM (another user's process) are alive, ESRCH is gone
const err = (code: string) => () => { throw Object.assign(new Error(code), { code }); };
assert.strictEqual(pidAlive(5, () => true), true, 'a signal that goes through: alive');
assert.strictEqual(pidAlive(5, err('EPERM')), true, 'EPERM: it runs, as someone else');
assert.strictEqual(pidAlive(5, err('ESRCH')), false, 'ESRCH: no such process');
assert.strictEqual(pidAlive(process.pid), true, 'this process, for real');

// ---- a power loss: pids start again (round 2, item 1), told apart by uptime, never by the wall clock (round 3, item 2)
const UP = 300; // this boot is 5 minutes old
const mk = (pid: number, up: number | undefined, startedAt = 1): void => fs.writeFileSync(path.join(sub, markerName(pid)), serializeMarker({ version: 1, startedAt, pid, ...(up !== undefined ? { up } : {}), busy: [{ id: A, adapterId: 'copilot' }] }));
mk(77, UP + UPTIME_MARGIN_S + 1);
const afterReboot = new CrashMarker(sub, { ...deps, pid: 500, alive: () => true, uptime: () => UP });
assert.deepStrictEqual(afterReboot.begin().marker?.busy, [{ id: A, adapterId: 'copilot' }], 'it recorded more uptime than this boot has: an earlier boot, a crash, although pid 77 now runs (some other program)');
assert.ok(!fs.existsSync(path.join(sub, markerName(77))), 'and its file is removed');
afterReboot.clear();
// a running Durbar is never offered or removed, whatever the wall clock says: its startedAt is days back (clock set forward), its uptime fits this boot
for (const [up, why] of [[UP - 200, 'started earlier in this boot'], [UP + UPTIME_MARGIN_S, 'inside the margin'], [undefined, 'a marker without uptime']] as const) {
  mk(78, up, 1);
  const other = new CrashMarker(sub, { ...deps, pid: 500, alive: (p) => p === 78, uptime: () => UP, now: () => 9e12 });
  assert.deepStrictEqual(other.begin(), { unclean: false, marker: null }, `a live pid, ${why}: another Durbar, not offered`);
  assert.ok(fs.existsSync(path.join(sub, markerName(78))), `${why}: and its marker is left alone`);
  other.clear();
}
fs.rmSync(path.join(sub, markerName(78)));
// a dead pid is a crash whatever its uptime says
mk(79, 1);
const deadOne = new CrashMarker(sub, { ...deps, pid: 500, alive: () => false, uptime: () => UP });
assert.strictEqual(deadOne.begin().unclean, true, 'a dead pid of this boot: a crash');
deadOne.clear();
assert.strictEqual(parseMarker('{"up":-1}')?.up, undefined, 'a negative uptime is dropped');
assert.strictEqual(parseMarker('{"up":"9"}')?.up, undefined, 'so is a string');

// ---- only our own names (round 2, item 3): other files are never read or removed
const strangers = ['durbar-running.abc.json', 'durbar-running.0.json', 'durbar-running.012.json', 'xdurbar-running.12.json', 'durbar-running.12.json.bak', 'durbar-running.12345678901.json', 'durbar-running..json'];
for (const n of strangers) fs.writeFileSync(path.join(sub, n), serializeMarker({ version: 1, startedAt: 1, busy: [{ id: C, adapterId: 'codex' }] }));
const picky = new CrashMarker(sub, deps);
assert.deepStrictEqual(picky.begin(), { unclean: false, marker: null }, 'no stranger is read as a marker');
picky.clear();
assert.deepStrictEqual(fs.readdirSync(sub).sort(), [...strangers].sort(), 'and every stranger is left on disk');
for (const n of strangers) fs.rmSync(path.join(sub, n));

// ---- temp files a crash inside write() left behind (round 2, item 4)
let alive2 = true;
fs.writeFileSync(path.join(sub, markerName(31) + '.tmp'), '{"version":1');
fs.writeFileSync(path.join(sub, markerName(32) + '.tmp'), '{"version":1');
fs.writeFileSync(path.join(sub, markerName(33) + '.tmp'), '{"version":1');
fs.writeFileSync(path.join(sub, markerName(PID) + '.tmp'), '{"version":1');
const sweeper = new CrashMarker(sub, { ...deps, alive: (p) => p === 32 || p === 33 });
const rs = sweeper.begin();
assert.strictEqual(rs.unclean, false, 'a temp file alone is not a crash marker');
assert.deepStrictEqual(fs.readdirSync(sub).sort(), [markerName(32) + '.tmp', markerName(33) + '.tmp', markerName(PID)].sort(), 'a dead process\'s temp file and our own pid\'s old one are removed; a live one\'s write in progress stays');
sweeper.clear();
const later = new CrashMarker(sub, { ...deps, alive: (p) => p === 32 || p === 33, now: () => 9e12 });
later.begin();
later.clear();
assert.deepStrictEqual(fs.readdirSync(sub).sort(), [markerName(32) + '.tmp', markerName(33) + '.tmp'], 'a live pid\'s temp file stays whatever the clock says (round 3: removing a running Durbar\'s write is worse than a small stray file)');
alive2 = false;
const after2 = new CrashMarker(sub, { ...deps, alive: () => alive2 });
after2.begin();
after2.clear();
assert.deepStrictEqual(fs.readdirSync(sub), [], 'once those processes are gone, their temp files go');
// only our own temp names (round 3, item 1): near misses are never removed, even with every pid dead
const tmpStrangers = ['xdurbar-running.12.json.tmp', 'durbar-running.12.json.tmp.bak', 'durbar-running.012.json.tmp', 'durbar-running.0.json.tmp', 'durbar-running.abc.json.tmp', 'durbar-running.12345678901.json.tmp', 'durbar-running..json.tmp', 'durbar-running.12.tmp', 'durbar-running.12.json.tmpx'];
for (const n of tmpStrangers) fs.writeFileSync(path.join(sub, n), 'x');
const tmpPicky = new CrashMarker(sub, deps);
assert.strictEqual(tmpPicky.begin().unclean, false);
tmpPicky.clear();
assert.deepStrictEqual(fs.readdirSync(sub).sort(), [...tmpStrangers].sort(), 'every near-miss temp name is left on disk');
for (const n of tmpStrangers) fs.rmSync(path.join(sub, n));
// bounded: at most MAX_SCAN of our files are looked at in one start
for (let i = 1; i <= MAX_SCAN + 10; i++) fs.writeFileSync(path.join(sub, markerName(1000 + i) + '.tmp'), '');
const bounded = new CrashMarker(sub, deps);
bounded.begin();
bounded.clear();
assert.strictEqual(fs.readdirSync(sub).length, 10, `at most ${MAX_SCAN} files per start`);
for (const n of fs.readdirSync(sub)) fs.rmSync(path.join(sub, n));

// ---- last-seen uptime (round 4): written at every write, refreshed while sessions are busy, so a run that started soon after
// a boot and crashed hours later is still told apart from the next boot
{
  let upv = 60; // Durbar opened a minute after login
  const refreshes: Array<{ fn: () => void; ms: number }> = [];
  const q: Array<() => void> = [];
  const OLD = 4100;
  const run = new CrashMarker(sub, { ...deps, pid: OLD, uptime: () => upv, setTimer: (fn: () => void) => { q.push(fn); return q.length as never; }, setRefresh: (fn, ms) => { refreshes.push({ fn, ms }); return refreshes.length as never; } });
  run.begin();
  const f = path.join(sub, markerName(OLD));
  const upIn = (): number | undefined => parseMarker(fs.readFileSync(f, 'utf8'))?.up;
  assert.strictEqual(upIn(), 60, 'the uptime at start');
  assert.strictEqual(refreshes.length, 0, 'no refresh while nothing is busy');
  upv = 65;
  run.setBusy([{ id: A, adapterId: 'copilot' }]);
  q.shift()!();
  assert.strictEqual(upIn(), 65, 'a busy change writes the uptime now');
  assert.strictEqual(refreshes.length, 1, 'one refresh is armed while a session is busy');
  assert.strictEqual(refreshes[0]!.ms, REFRESH_MS);
  const mt = fs.statSync(f).mtimeMs;
  upv = 70;
  run.setBusy([{ id: A, adapterId: 'copilot' }]);
  q.shift()!();
  assert.strictEqual(upIn(), 65, 'the same busy set is not rewritten for a new uptime alone');
  assert.strictEqual(fs.statSync(f).mtimeMs, mt);
  assert.strictEqual(refreshes.length, 1, 'and no second refresh timer');
  // a long turn with no status change: the refresh keeps the last-seen uptime fresh
  for (let k = 1; k <= 30; k++) { upv = 65 + k * (REFRESH_MS / 1000); refreshes.shift()!.fn(); }
  assert.strictEqual(upIn(), 65 + 30 * (REFRESH_MS / 1000), 'the refresh rewrote the uptime');
  assert.strictEqual(refreshes.length, 1, 'and re-armed itself once');
  // power loss now (no clear), reboot; the next Durbar opens 90 s into the new boot and the old pid belongs to another program
  const next = new CrashMarker(sub, { ...deps, pid: 4200, alive: (pp) => pp === OLD, uptime: () => 90 });
  const got = next.begin();
  assert.deepStrictEqual(got.marker?.busy, [{ id: A, adapterId: 'copilot' }], 'a long run, a crash, a reboot, an early start, the old pid alive: the card shows');
  assert.ok(!fs.existsSync(f), 'and the old marker is removed');
  next.clear();
  // the same, while it is the same boot (the old Durbar still runs): its last-seen uptime is never above the uptime now
  upv = 200;
  const a1 = new CrashMarker(sub, { ...deps, pid: OLD, uptime: () => upv, setRefresh: (fn) => { refreshes.push({ fn, ms: 0 }); return 0 as never; } });
  a1.begin();
  a1.setBusy([{ id: A, adapterId: 'copilot' }]);
  a1.flush();
  upv = 5000;
  refreshes.pop()!.fn();
  const b1 = new CrashMarker(sub, { ...deps, pid: 4300, alive: (pp) => pp === OLD, uptime: () => upv });
  assert.deepStrictEqual(b1.begin(), { unclean: false, marker: null }, 'a running Durbar\'s refreshed marker is never judged rebooted');
  b1.clear();
  // all idle: no refresh is armed again
  refreshes.length = 0;
  a1.setBusy([]);
  a1.flush();
  assert.strictEqual(refreshes.length, 0, 'an idle Durbar is not refreshed');
  a1.clear();
  assert.ok(!fs.existsSync(f));
}

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

// ---- after clear() a refresh never brings the marker back (round 5): the guard in the callback and the cancel in clear(), each alone
const rdir = path.join(dir, 'refresh');
const rfile = path.join(rdir, markerName(PID));
// (a) the guard alone: a fake timer handle, so clear()'s cancel does nothing; the kept callback is fired after clear()
{
  let kept: (() => void) | undefined;
  const m = new CrashMarker(rdir, { ...deps, setRefresh: (fn) => { kept = fn; return 'fake' as never; } });
  m.begin();
  m.setBusy([{ id: A, adapterId: 'copilot' }]);
  m.flush();
  assert.ok(kept && fs.existsSync(rfile), 'a refresh is armed while a session is busy');
  m.clear();
  kept!();
  assert.ok(!fs.existsSync(rfile), 'a refresh that fires after clear() writes nothing (the active guard)');
}
// (c) the default timer is unref'd: a pending refresh never keeps the process alive
{
  const m = new CrashMarker(rdir, { ...deps, setRefresh: undefined });
  m.begin();
  m.setBusy([{ id: A, adapterId: 'copilot' }]);
  m.flush();
  const t = (m as unknown as { refresh?: NodeJS.Timeout }).refresh;
  assert.ok(t && typeof t.hasRef === 'function', 'the default refresh is a real timer');
  assert.strictEqual(t!.hasRef(), false, 'and it is unref\'d');
  m.clear();
}
// (b) the cancel alone: a real short timer; after clear() its callback never runs (the guard cannot hide a missing cancel here)
let ran = 0;
const mb = new CrashMarker(rdir, { ...deps, setRefresh: (fn) => setTimeout(() => { ran++; fn(); }, 5) });
mb.begin();
mb.setBusy([{ id: A, adapterId: 'copilot' }]);
mb.flush();
mb.clear();
setTimeout(() => {
  assert.strictEqual(ran, 0, 'clear() cancels the pending refresh');
  assert.ok(!fs.existsSync(rfile), 'and there is no marker');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('crashmarker: ok');
}, 60);
