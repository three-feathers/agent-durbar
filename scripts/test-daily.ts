/** Spec 052 round 8 (daily use): window placement, the saved app state, "Since you were away" and the quit prompt text. `npm run test:daily`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AWAY_MIN_MS, AppStateStore, DEFAULT_SIZE, buildSinceAway, parseAppState, parseWindowState, placeWindow, quitMessage } from '../src/main/daily';
import type { Schedule } from '../src/main/schedules';

// FR-087: window placement
const wa = { x: 0, y: 0, width: 1920, height: 1040 };
assert.deepStrictEqual(placeWindow(undefined, wa), { bounds: DEFAULT_SIZE, maximized: false, restored: false }, 'unknown: the default size');
assert.deepStrictEqual(placeWindow({ x: 100, y: 50, width: 1200, height: 800, maximized: false }, wa), { bounds: { x: 100, y: 50, width: 1200, height: 800 }, maximized: false, restored: true }, 'visible: kept as saved');
assert.deepStrictEqual(placeWindow({ x: 1800, y: 900, width: 1200, height: 800, maximized: true }, wa), { bounds: { x: 720, y: 240, width: 1200, height: 800 }, maximized: true, restored: true }, 'partly off the edge: pushed inside');
assert.deepStrictEqual(placeWindow({ x: -10, y: -10, width: 3000, height: 2000, maximized: false }, wa).bounds, { x: 0, y: 0, width: 1920, height: 1040 }, 'larger than the display: shrunk to the work area');
assert.deepStrictEqual(placeWindow({ x: 5000, y: 50, width: 1200, height: 800, maximized: false }, wa), { bounds: DEFAULT_SIZE, maximized: false, restored: false }, 'off-screen (a monitor that is gone): the default');
assert.strictEqual(placeWindow({ x: 1850, y: 50, width: 1200, height: 800, maximized: false }, wa).restored, false, 'only a 70 px sliver visible: the default');
assert.deepStrictEqual(placeWindow({ x: 2000, y: 100, width: 1000, height: 700, maximized: false }, { x: 1920, y: 0, width: 2560, height: 1400 }).bounds, { x: 2000, y: 100, width: 1000, height: 700 }, 'a second display to the right');
assert.strictEqual(placeWindow({ x: 0, y: 0, width: 800, height: 600, maximized: false }, { x: 0, y: 0, width: 0, height: 0 }).restored, false, 'an empty work area: the default');

assert.strictEqual(parseWindowState({ x: 1, y: 2, width: 100, height: 600 }), undefined, 'too narrow');
assert.strictEqual(parseWindowState({ x: 1.5, y: 2, width: 800, height: 600 }), undefined, 'not whole pixels');
assert.strictEqual(parseWindowState('x'), undefined);
assert.deepStrictEqual(parseWindowState({ x: -1, y: 2, width: 800, height: 600, maximized: 'yes' }), { x: -1, y: 2, width: 800, height: 600, maximized: false });
assert.deepStrictEqual(parseAppState('{{'), {});
assert.deepStrictEqual(parseAppState('[1]'), {});
assert.deepStrictEqual(parseAppState(JSON.stringify({ window: { x: 0, y: 0, width: 5, height: 5 }, quitAt: -3 })), {}, 'bad values dropped');

// the store: survives a restart, writes privately, tolerates an unwritable place
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-daily-'));
  try {
    const file = path.join(dir, 'sub', 'state.json');
    const st = new AppStateStore(file);
    assert.deepStrictEqual(st.load(), {});
    st.setWindow({ x: 10, y: 20, width: 1300, height: 850, maximized: true });
    st.setWindow({ x: 10, y: 20, width: 20, height: 850 }); // invalid: ignored
    st.setQuitAt(1_700_000_000_000);
    const again = new AppStateStore(file);
    again.load();
    assert.deepStrictEqual(again.window, { x: 10, y: 20, width: 1300, height: 850, maximized: true });
    assert.strictEqual(again.quitAt, 1_700_000_000_000);
    again.setQuitAt(undefined);
    assert.strictEqual(new AppStateStore(file).load().quitAt, undefined, 'cleared on start, so a crash leaves no quit time');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0, 'file is private');
    assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')).length, 0);
    new AppStateStore(path.join(file, 'x', 'y.json')).setQuitAt(5); // no throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// FR-089: Since you were away
{
  const start = 1_800_000_000_000;
  const sch = (o: Partial<Schedule>): Schedule => ({ id: 'id', folder: '/w/app', prompt: 'p', ...o }) as Schedule;
  const list = [
    sch({ id: 'a', prompt: '  Summarise\nyesterday’s   commits ', every: 1440, last: { at: start, outcome: 'missed' } }),
    sch({ id: 'b', folder: '/w/site', prompt: 'x'.repeat(200), at: start - 5 * 3600_000, done: true, last: { at: start + 5, outcome: 'missed' } }),
    sch({ id: 'c', every: 60, last: { at: start - 10, outcome: 'missed' } }), // missed in an earlier run: not this break
    sch({ id: 'd', every: 60, last: { at: start, outcome: 'sent' } }),
    sch({ id: 'e', every: 60 }),
  ];
  const name = (f: string): string => (f === '/w/app' ? 'My app' : path.basename(f));
  assert.strictEqual(buildSinceAway(undefined, start, list, name), undefined, 'unknown quit time (first run or a crash): no card');
  assert.strictEqual(buildSinceAway(start - AWAY_MIN_MS, start, list, name), undefined, '30 minutes or less: no card');
  const s = buildSinceAway(start - 3 * 3600_000, start, list, name);
  assert.ok(s);
  assert.strictEqual(s.awayMs, 3 * 3600_000);
  assert.deepStrictEqual(s.missed.map((m) => m.id), ['a', 'b'], 'only runs marked missed at this start');
  assert.deepStrictEqual(s.missed[0], { id: 'a', folderName: 'My app', prompt: 'Summarise yesterday’s commits', repeats: true });
  assert.strictEqual([...s.missed[1].prompt].length, 80, 'long prompts are cut to 80 characters');
  assert.ok(s.missed[1].prompt.endsWith('…'));
  assert.strictEqual(s.missed[1].repeats, false);
  assert.strictEqual(s.missed[1].folderName, 'site');
  assert.deepStrictEqual(buildSinceAway(start - 2 * AWAY_MIN_MS, start, [], name), { awayMs: 2 * AWAY_MIN_MS, missed: [] }, 'nothing missed: the card still says how long');
}

// FR-090: the quit prompt
assert.strictEqual(quitMessage(1).message, '1 agent is still working. Quit anyway?');
assert.strictEqual(quitMessage(3).message, '3 agents are still working. Quit anyway?');
assert.ok(/picks up where/.test(quitMessage(2).detail));

console.log('daily: ok');
