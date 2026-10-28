/** Doors you close (spec 017 FR-015..FR-017) and the runs held behind them (spec 044 FR-110, FR-111): `npm run test:doors`. No session, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Doors, HELD_FILE_CAP, loadDoors, parseDoors, saveDoors, MAX_HELD, MAX_KEY, MAX_DOORS, MAX_FILE, MAX_PROMPT, MAX_TOTAL_HELD } from '../src/main/doors';
import { MAX_PROMPT as SCHED_MAX_PROMPT } from '../src/main/schedules';
import { createDoorOps, REMOTE_OFF_REASON } from '../src/main/doorops';
import type { ReleaseResult } from '../src/main/doorops';
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
  assert.strictEqual(d2.hold('full', { at: 0, prompt: 'over' }), 'full', 'review on #631: a full queue says so (the run is not kept, never silently)');
  assert.strictEqual(d2.view('full').held, MAX_HELD);

  // ---- review on #631: limits from the schedules, the total across doors, atomic writes, a damaged or huge file kept aside ----
  assert.strictEqual(MAX_PROMPT, SCHED_MAX_PROMPT, 'a held prompt has the limit of a scheduled prompt');
  d2.setClosed('long', true);
  assert.strictEqual(d2.hold('long', { at: 1, prompt: 'x'.repeat(MAX_PROMPT + 1) }), 'full', 'a prompt longer than a schedule can have is not kept');
  assert.strictEqual(parseDoors(JSON.stringify({ doors: { k: { closed: true, held: [{ id: 'a', at: 1, prompt: 'y'.repeat(MAX_PROMPT + 1) }] } } })).doors.k.held.length, 0, 'or loaded');
  const many = new Doors({ doors: {} }, () => undefined, () => `m${ids++}`);
  for (let k = 0; k * MAX_HELD < MAX_TOTAL_HELD; k++) { many.setClosed('k' + k, true); for (let i = 0; i < MAX_HELD; i++) many.hold('k' + k, { at: i, prompt: 'p' }); }
  many.setClosed('extra', true);
  assert.strictEqual(many.hold('extra', { at: 0, prompt: 'p' }), 'full', 'all doors together have a limit');
  // spec 044 FR-126: held prompts of 10,000 characters never take the file past what a load accepts (multi-byte text, many doors, escapes)
  for (const [label, ch, doors] of [['one door of CJK text', '\u6f22', 1], ['5 doors of ASCII', 'a', 5], ['control characters (6 bytes each in JSON)', '\u0001', 2], ['astral text', '\u{1F600}', 1]] as const) {
    let nid = 0;
    const dd = new Doors({ doors: {} }, () => undefined, () => `z${nid++}`);
    let kept = 0, refused = 0;
    for (let k = 0; k < doors; k++) {
      dd.setClosed('big' + k, true);
      for (let i = 0; i < MAX_HELD; i++) { if (dd.hold('big' + k, { at: i, prompt: ch.repeat(k === 0 && label.startsWith('astral') ? MAX_PROMPT / 2 : MAX_PROMPT) }) === 'held') kept++; else refused++; }
    }
    const f = path.join(dir, `big-${doors}-${ch.codePointAt(0)}.json`);
    const snap = { doors: Object.fromEntries(Array.from({ length: doors }, (_, k) => ['big' + k, { closed: true, held: dd.held('big' + k) }])) };
    saveDoors(f, snap);
    const size = fs.statSync(f).size;
    assert.ok(size <= HELD_FILE_CAP && size <= MAX_FILE, `${label}: the file is ${size} bytes, under the cap`);
    assert.ok(refused > 0 && kept > 0, `${label}: some runs are kept, the rest are refused as full (${kept} kept, ${refused} refused)`);
    const back = loadDoors(f);
    assert.strictEqual(Object.values(back.doors).reduce((n, x) => n + x.held.length, 0), kept, `${label}: every kept run loads back (the file is not set aside)`);
    assert.ok(!fs.existsSync(f + '.bad'), `${label}: no .bad file`);
  }
  // review of #845 (2026-10-28): door keys are added without measuring; the room kept for them holds the worst case (MAX_DOORS keys of MAX_KEY characters, each written as 6 bytes)
  {
    let nid = 0;
    const dd = new Doors({ doors: {} }, () => undefined, () => `w${nid++}`);
    const ctl = '\u0001'.repeat(MAX_PROMPT); // 6 bytes a character in JSON
    let kept = 0, sawFull = false;
    const keys: string[] = [];
    for (let k = 0; k < 6 && !sawFull; k++) {
      dd.setClosed('fill' + k, true);
      keys.push('fill' + k);
      for (let i = 0; i < MAX_HELD; i++) { if (dd.hold('fill' + k, { at: i, prompt: ctl }) === 'held') kept++; else { sawFull = true; break; } }
    }
    assert.ok(sawFull && kept > 0, 'the holds fill up to the file cap');
    for (let n = keys.length; n < MAX_DOORS; n++) {
      const key = String.fromCharCode(1 + (n % 31), 1 + (Math.floor(n / 31) % 31)) + '\u0001'.repeat(MAX_KEY - 2);
      assert.strictEqual(key.length, MAX_KEY);
      assert.ok(dd.setClosed(key, true), `door ${n} closes`);
      keys.push(key);
    }
    assert.strictEqual(keys.length, MAX_DOORS);
    const f = path.join(dir, 'worst.json');
    saveDoors(f, { doors: Object.fromEntries(keys.map((k) => [k, { closed: true, held: dd.held(k) }])) });
    const size = fs.statSync(f).size;
    assert.ok(size <= MAX_FILE, `worst case: ${size} bytes, at most ${MAX_FILE}`);
    const back = loadDoors(f);
    assert.ok(!fs.existsSync(f + '.bad'), 'the file is not set aside');
    assert.strictEqual(Object.values(back.doors).reduce((n, x) => n + x.held.length, 0), kept, 'every held run loads back');
    assert.strictEqual(Object.keys(back.doors).length, MAX_DOORS, 'and every door');
  }
  const left = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepStrictEqual(left, [], 'saves leave no temp file (written to a temp file, then renamed)');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{"doors": {"s1": {"closed": true, "held": [');
  assert.deepStrictEqual(Object.keys(loadDoors(bad).doors), [], 'a damaged file opens nothing');
  assert.ok(fs.existsSync(bad + '.bad') && !fs.existsSync(bad), 'and is kept aside, not overwritten');
  const huge = path.join(dir, 'huge.json');
  fs.writeFileSync(huge, JSON.stringify({ doors: { s1: { closed: true, held: [] } }, pad: 'z'.repeat(MAX_FILE) }));
  assert.deepStrictEqual(Object.keys(loadDoors(huge).doors), [], 'a file over the size limit is not parsed');
  assert.ok(fs.existsSync(huge + '.bad'), 'and is kept aside');
  assert.deepStrictEqual(Object.keys(loadDoors(path.join(dir, 'missing.json')).doors), [], 'a missing file is an empty store');
  assert.ok(!fs.existsSync(path.join(dir, 'missing.json.bad')), 'nothing to keep aside');

  // ---- the scheduler (spec 044 FR-110): a run for an agent behind a closed door is held, not sent and not lost ----
  const doors = new Doors({ doors: {} }, () => undefined, () => `r${ids++}`);
  const doc = { pausedAll: false, schedules: [] as Schedule[] };
  // the agent of a schedule: its target session, else the folder's agent ("folder-agent" in the harness)
  const keyOf = (s: Schedule) => s.target?.session ?? 'folder-agent';
  const h = harness(doc, undefined, { hold: (s, now) => { if (!doors.isClosed(keyOf(s))) return false; const r = doors.hold(keyOf(s), { at: now, prompt: s.prompt, scheduleId: s.id }); return r === 'held' ? true : 'full'; } });
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
  // ---- review on #631: a run that cannot be kept at a full door has its own outcome and is not sent ----
  {
    const doc3 = { pausedAll: false, schedules: [] as Schedule[] };
    const h3 = harness(doc3, undefined, { hold: () => 'full' });
    doc3.schedules.push({ id: 'f1', folder: '/w', prompt: 'to s1', at: h3.now + MIN, target: { session: 's1' } } as Schedule);
    await h3.advance(MIN);
    await h3.sch.tick();
    assert.strictEqual((doc3.schedules[0] as Schedule).last?.outcome, 'skipped-door-full', 'a distinct outcome');
    assert.deepStrictEqual(h3.sent, [], 'and not sent');
  }
  // ---- spec 044 FR-111 (review on #631): Send all goes through the scheduler: Pause all, the schedule, its limit, busy; credited, recorded ----
  {
    const doc2 = { pausedAll: false, schedules: [] as Schedule[] };
    const h2 = harness(doc2);
    doc2.schedules.push({ id: 'r1', folder: '/w', prompt: 'p', every: 30, next: h2.now + 99 * MIN, target: { session: 's1' } } as Schedule);
    const by = (id: string) => doc2.schedules.find((x) => x.id === id) as Schedule;
    h2.busy.add('s1');
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'busy', 'a busy agent: not now');
    assert.deepStrictEqual(h2.sent, [], 'nothing sent to a busy agent (the busy gate)');
    h2.busy.delete('s1');
    doc2.pausedAll = true;
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'paused-all');
    doc2.pausedAll = false;
    by('r1').paused = true;
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'paused');
    by('r1').paused = false;
    by('r1').cap = { amount: 1, unit: 'aiu' } as never;
    by('r1').spent = 1;
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'cap', "the schedule's own limit stops it");
    delete by('r1').cap; delete by('r1').spent;
    assert.strictEqual(await h2.sch.releaseDoorRun('gone-id', 'held prompt'), 'gone', 'a deleted schedule');
    assert.deepStrictEqual(h2.sent, [], 'none of those sent anything');
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'sent');
    assert.deepStrictEqual(h2.sent, ['/w:held prompt'], 'sent through the schedule send path');
    assert.strictEqual(by('r1').last?.outcome, 'sent', 'and recorded on the schedule');
    // review on #631 (Ruben): the ended-session check, the credit (FR-024) and the running guard
    h2.sessions.delete('s1');
    assert.strictEqual(await h2.sch.releaseDoorRun('r1', 'held prompt'), 'ended', 'its session ended: not sent');
    h2.sessions.add('s1');
    assert.strictEqual(h2.sent.length, 1, 'nothing sent to an ended session');
    by('r1').cap = { amount: 5, unit: 'aiu' } as never;
    by('r1').spent = 0;
    h2.sch.noteUsage('s1', { nanoAiu: 2e9 });
    assert.strictEqual(by('r1').spent, 2, "the released run's usage is credited to its schedule (attrib)");
    h2.sch.turnEnded('s1');
    h2.sch.noteUsage('s1', { nanoAiu: 1e9 });
    assert.strictEqual(by('r1').spent, 2, 'not after its turn ended');
    // another run in progress (the running guard): a second release waits
    let open: (v: string) => void = () => undefined;
    const doc4 = { pausedAll: false, schedules: [{ id: 'g1', folder: '/w', prompt: 'p', every: 30, next: h2.now + 99 * MIN, target: { session: 's1' } } as Schedule] };
    const sent4: string[] = [];
    const h4 = harness(doc4, undefined, { send: (_f, p) => { sent4.push(p); return new Promise((r) => { open = r; }); } });
    const first = h4.sch.releaseDoorRun('g1', 'one');
    const second = await Promise.race([h4.sch.releaseDoorRun('g1', 'two'), new Promise((r) => setTimeout(() => r('still waiting'), 50))]);
    assert.strictEqual(second, 'busy', 'another run is going out: not now');
    open('s1');
    assert.strictEqual(await first, 'sent');
    assert.deepStrictEqual(sent4, ['one'], 'only the first went');
    // spec 081 FR-013: its agent app is updating
    const h5 = harness({ pausedAll: false, schedules: [{ id: 'u1', folder: '/w', prompt: 'p', every: 30, next: h2.now + 99 * MIN, target: { session: 's1' } } as Schedule] }, undefined, { heldBy: () => 'updating' });
    assert.strictEqual(await h5.sch.releaseDoorRun('u1', 'held prompt'), 'updating');
    assert.deepStrictEqual(h5.sent, [], 'not sent while its agent app updates');
  }

  // ---- doorops (review on #631): remote off on close (and the window told), honest failure, Send all one by one ----
  {
    const dd = new Doors({ doors: {} }, () => undefined, () => `o${ids++}`);
    const events: string[] = [], stops: string[] = [];
    let remoteOn = true, offOk = true, results: ReleaseResult[] = [];
    const released: string[] = [];
    const ops = createDoorOps({
      doors: () => dd,
      keyOf: (id) => (id.startsWith('a') ? 'key-' + id : undefined),
      remote: { has: () => remoteOn, setRemote: async (_id, on) => { if (!on && offOk) remoteOn = false; return offOk ? { ok: true } : { ok: false, error: 'GitHub said no' }; } },
      remoteOff: (id, reason) => events.push(id + ':' + reason),
      release: async (run) => { const r = results.shift() ?? 'sent'; if (r === 'sent') released.push(run.prompt); return r; },
      changed: () => undefined,
      stopped: (id, why) => stops.push(id + ':' + why),
    });
    offOk = false;
    const f = await ops.setDoor('a1', true);
    assert.ok(!f.ok && /stays open: GitHub said no/.test(f.ok ? '' : f.error), 'remote control could not be turned off: the door stays open and says why');
    assert.ok(!dd.isClosed('key-a1') && events.length === 0, 'not closed, no remote-off event');
    offOk = true;
    const c = await ops.setDoor('a1', true);
    assert.deepStrictEqual(c, { ok: true, closed: true, held: 0, remoteOff: true }, 'closed, remote control off');
    assert.deepStrictEqual(events, ['a1:' + REMOTE_OFF_REASON], 'the window is told remote control went off (agents:remoteOff)');
    assert.deepStrictEqual(await ops.setDoor('zz', true), { ok: false, error: 'invalid request' }, 'an unknown agent');
    for (const p of ['one', 'two', 'three', 'four']) dd.hold('key-a1', { at: 1, prompt: p, scheduleId: 's' });
    assert.deepStrictEqual(ops.held('a1').map((x) => x.prompt), ['one', 'two', 'three', 'four']);
    assert.deepStrictEqual(await ops.release('a1', 'send'), { ok: false, error: 'Open the door first.' });
    await ops.setDoor('a1', false);
    results = ['busy'];
    await ops.release('a1', 'send');
    assert.deepStrictEqual([released, dd.view('key-a1').held, dd.releasing('key-a1')], [[], 4, true], 'busy: nothing sent, nothing dropped, still releasing');
    results = ['sent'];
    await ops.pump('a1');
    assert.deepStrictEqual([released, dd.view('key-a1').held], [['one'], 3], 'the agent is free: the first goes out, one at a time');
    results = ['gone', 'sent'];
    await ops.pump('a1');
    assert.deepStrictEqual([released, dd.view('key-a1').held], [['one', 'three'], 1], "a deleted schedule's run is dropped, the next one goes");
    results = ['paused-all'];
    await ops.pump('a1');
    assert.deepStrictEqual([released, dd.view('key-a1').held, dd.releasing('key-a1'), stops], [['one', 'three'], 1, false, ['a1:paused-all']], 'Pause all: Send all stops, the run stays held and the window is told');
    // review on #631 (Ruben, at 84614557): an agent app that is updating stops Send all with that reason (unlike busy, no idle comes to resume it)
    results = ['updating'];
    await ops.release('a1', 'send');
    assert.deepStrictEqual([released, dd.view('key-a1').held, dd.releasing('key-a1'), stops], [['one', 'three'], 1, false, ['a1:paused-all', 'a1:updating']], 'updating: Send all stops, the run stays held and the window is told why');
    assert.deepStrictEqual(await ops.release('a1', 'discard'), { ok: true, discarded: 1 });
  }

  // ---- review on #631 (Ruben): main's wiring, moved into doorops: the scheduler's hold and the pump when a turn ends ----
  {
    const dd = new Doors({ doors: {} }, () => undefined, () => `w${ids++}`);
    const fulls: string[] = [], later: (() => void)[] = [], released: string[] = [];
    let changed = 0;
    const ops = createDoorOps({
      doors: () => dd,
      keyOf: (id) => (id.startsWith('a') ? 'key-' + id : undefined),
      remote: { has: () => false, setRemote: async () => ({ ok: true }) },
      remoteOff: () => undefined,
      release: async (run) => (released.push(run.prompt), 'sent'),
      changed: () => { changed++; },
      full: (id) => fulls.push(id),
      later: (fn) => later.push(fn),
    });
    const run = (prompt: string) => ({ at: 1, prompt, scheduleId: 's' });
    assert.strictEqual(ops.hold('a1', run('x')), false, 'an open door: the run goes as usual');
    assert.strictEqual(ops.hold(undefined, run('x')), false, 'no agent for the run');
    assert.strictEqual(ops.hold('zz', run('x')), false, 'an unknown agent');
    await ops.setDoor('a1', true);
    const c0 = changed;
    assert.strictEqual(ops.hold('a1', run('held-1')), true, 'a closed door holds the run (never sent)');
    assert.ok(changed > c0, 'and the window is told');
    for (let i = 1; i < MAX_HELD; i++) ops.hold('a1', run('h' + i));
    assert.strictEqual(ops.hold('a1', run('over')), 'full', 'a full door: not kept');
    assert.deepStrictEqual(fulls, ['a1'], 'and the window is told (doors:full)');
    await ops.setDoor('a1', false);
    await ops.release('a1', 'send');
    assert.deepStrictEqual(released, ['held-1'], 'Send all sends the first');
    ops.onStatus({ type: 'status', sessionId: 'a1', status: 'working' });
    ops.onStatus({ type: 'status', sessionId: 'a1', agentId: 'sub', status: 'idle' });
    ops.onStatus({ type: 'status', sessionId: 'zz', status: 'idle' });
    ops.onStatus({ type: 'usage', sessionId: 'a1', status: 'idle' });
    assert.strictEqual(later.length, 0, 'only the end of a main session\'s turn moves Send all on');
    ops.onStatus({ type: 'status', sessionId: 'a1', status: 'idle' });
    assert.strictEqual(later.length, 1, 'its turn ended: the next run is due');
    later.shift()?.();
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(released, ['held-1', 'h1'], 'the next held run goes when the agent is free (Send all does not stop after one)');
  }
  console.log('doors tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
