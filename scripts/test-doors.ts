/** Doors you close (spec 017 FR-015..FR-017) and the runs held behind them (spec 044 FR-110, FR-111): `npm run test:doors`. No session, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Doors, loadDoors, parseDoors, saveDoors, MAX_HELD } from '../src/main/doors';
import { harness } from './test-schedules';
import type { Schedule } from '../src/main/schedules';

const MIN = 60_000;

async function main(): Promise<void> {
  // ---- the store: tolerant parse, nothing from the prototype, open doors with nothing held are not kept ----
  assert.deepStrictEqual(Object.keys(parseDoors('nope').doors), []);
  const p = parseDoors(JSON.stringify({ doors: { s1: { closed: true, held: [{ id: 'a', at: 1, prompt: 'hi', scheduleId: 'x' }, { id: '', at: 1, prompt: 'bad' }, { id: 'b', at: 'x', prompt: 'bad' }] }, s2: { closed: false, held: [] }, __proto__: { closed: true, held: [] }, s3: 'x' } }));
  assert.deepStrictEqual(Object.keys(p.doors), ['s1'], 'only well-formed doors are kept');
  assert.deepStrictEqual(p.doors.s1.held.map((r) => r.id), ['a'], 'bad held runs are dropped');
  assert.strictEqual(({} as Record<string, unknown>).closed, undefined, 'the prototype is untouched');

  // ---- persisted across a restart (file mode 0600 on POSIX) ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-doors-'));
  const file = path.join(dir, 'durbar-doors.json');
  let ids = 0;
  const mk = () => new Doors(loadDoors(file), (doc) => saveDoors(file, doc), () => `id${ids++}`);
  const d = mk();
  assert.deepStrictEqual(d.view('sess-1'), { closed: false, held: 0 });
  assert.strictEqual(d.hold('sess-1', { at: 1, prompt: 'p0' }), false, 'nothing is held at an open door');
  assert.deepStrictEqual(d.setClosed('sess-1', true), { closed: true, held: 0 });
  assert.strictEqual(d.setClosed('__proto__', true), undefined, 'a prototype key is refused');
  assert.ok(d.hold('sess-1', { at: 1, prompt: 'first', scheduleId: 'A' }));
  assert.ok(d.hold('sess-1', { at: 2, prompt: 'second' }));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'the file is private');
  const d2 = mk();
  assert.deepStrictEqual(d2.view('sess-1'), { closed: true, held: 2 }, 'a restart keeps the closed door and what it holds');
  assert.deepStrictEqual(d2.held('sess-1').map((r) => r.prompt), ['first', 'second'], 'in order');

  // ---- opening: Send all hands them out one by one, in order; nothing while the door is closed ----
  assert.strictEqual(d2.startRelease('sess-1'), undefined, 'nothing is released while the door is closed');
  assert.deepStrictEqual(d2.setClosed('sess-1', false), { closed: false, held: 2 }, 'opening keeps what is held until the user decides');
  const r1 = d2.startRelease('sess-1');
  assert.strictEqual(r1?.prompt, 'first');
  assert.ok(d2.releasing('sess-1'));
  // a send that fails puts the run back at the front: never lost
  d2.putBack('sess-1', r1 as never);
  assert.ok(!d2.releasing('sess-1'), 'a failed send stops the release');
  assert.deepStrictEqual(d2.held('sess-1').map((r) => r.prompt), ['first', 'second'], 'the failed run is first again');
  assert.strictEqual(d2.startRelease('sess-1')?.prompt, 'first');
  d2.setClosed('sess-1', true);
  assert.strictEqual(d2.next('sess-1'), undefined, 'closing the door again stops Send all');
  assert.deepStrictEqual(d2.held('sess-1').map((r) => r.prompt), ['second'], 'the rest stays held');
  d2.setClosed('sess-1', false);
  assert.strictEqual(d2.startRelease('sess-1')?.prompt, 'second');
  assert.strictEqual(d2.next('sess-1'), undefined, 'nothing left');
  assert.deepStrictEqual(mk().view('sess-1'), { closed: false, held: 0 }, 'an open, empty door is forgotten');

  // ---- Discard ----
  d2.setClosed('s9', true);
  d2.hold('s9', { at: 1, prompt: 'x' });
  assert.strictEqual(d2.discard('s9'), 0, 'not while the door is closed');
  d2.setClosed('s9', false);
  assert.strictEqual(d2.discard('s9'), 1);
  assert.deepStrictEqual(d2.view('s9'), { closed: false, held: 0 });

  // ---- a full queue refuses more (and says so) ----
  d2.setClosed('full', true);
  for (let i = 0; i < MAX_HELD; i++) assert.ok(d2.hold('full', { at: i, prompt: 'p' + i }));
  assert.strictEqual(d2.hold('full', { at: 0, prompt: 'over' }), false, 'the queue has a limit');

  // ---- the scheduler (spec 044 FR-110): a run for an agent behind a closed door is held, not sent and not lost ----
  const doors = new Doors({ doors: {} }, () => undefined, () => `r${ids++}`);
  const doc = { pausedAll: false, schedules: [] as Schedule[] };
  // the agent of a schedule: its target session, else the folder's agent ("folder-agent" in the harness)
  const keyOf = (s: Schedule) => s.target?.session ?? 'folder-agent';
  const h = harness(doc, undefined, { hold: (s, now) => doors.isClosed(keyOf(s)) && doors.hold(keyOf(s), { at: now, prompt: s.prompt, scheduleId: s.id }) });
  doors.setClosed('s1', true);
  doc.schedules.push({ id: 'once-1', folder: '/w', prompt: 'to s1 once', at: h.now + MIN, target: { session: 's1' } } as Schedule);
  doc.schedules.push({ id: 'rec-1', folder: '/w', prompt: 'to s1 every 10', every: 10, next: h.now + MIN, target: { session: 's1' } } as Schedule);
  doc.schedules.push({ id: 'open-1', folder: '/w', prompt: 'to s2', at: h.now + MIN, target: { session: 's2' } } as Schedule);
  h.busy.add('s1'); // a busy agent behind a closed door: still held, never skipped (a held run is never lost)
  await h.sch.tick();
  await h.advance(MIN);
  assert.deepStrictEqual(h.sent, ['/w:to s2'], 'only the open door got its run');
  const byId = (id: string) => doc.schedules.find((s) => s.id === id) as Schedule;
  assert.strictEqual(byId('once-1').last?.outcome, 'held');
  assert.strictEqual(byId('rec-1').last?.outcome, 'held');
  assert.ok(byId('once-1').done, 'a held once-schedule is done (its run waits at the door)');
  assert.ok((byId('rec-1').next as number) > h.now, 'a recurring one moves on');
  assert.deepStrictEqual(doors.held('s1').map((r) => [r.prompt, r.scheduleId]), [['to s1 once', 'once-1'], ['to s1 every 10', 'rec-1']], 'queued in order, with their schedules');
  await h.advance(10 * MIN);
  assert.deepStrictEqual(doors.held('s1').map((r) => r.prompt), ['to s1 once', 'to s1 every 10', 'to s1 every 10'], 'every run while closed is held');
  assert.deepStrictEqual(h.sent, ['/w:to s2'], 'still nothing sent to s1');
  // Pause all and a schedule's limit come first (skipped, not held), as before
  doc.pausedAll = true;
  await h.advance(10 * MIN);
  assert.strictEqual(byId('rec-1').last?.outcome, 'skipped-paused');
  assert.strictEqual(doors.view('s1').held, 3, 'Pause all skips (nothing more held)');
  doc.pausedAll = false;
  // opened: the next run goes out as usual; what was held is still there for Send all / Discard
  doors.setClosed('s1', false);
  h.busy.delete('s1');
  await h.advance(10 * MIN);
  assert.deepStrictEqual(h.sent, ['/w:to s2', '/w:to s1 every 10'], 'an open door gets its run again');
  assert.strictEqual(doors.view('s1').held, 3);
  console.log('doors tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
