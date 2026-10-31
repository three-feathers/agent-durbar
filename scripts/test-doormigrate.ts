/**
 * Held prompts from before the update (spec 017 FR-031..FR-034, spec 044 FR-127, FR-128): `npm run test:doormigrate`. No session, no credits.
 * The safety property is one counter: sends stay 0 until the person chooses Send, and nothing held is lost until they choose Discard.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GONE_SCHEDULE, GONE_SESSION, HeldBeforeUpdate, loadHeld, MAX_FILE, MAX_HELD, MAX_KEY, MAX_KEYS, parseHeld, saveHeld } from '../src/main/doormigrate';
import type { HeldRun, MigrateDeps, ReleaseResult } from '../src/main/doormigrate';
import { MAX_PROMPT } from '../src/main/schedules';
import { harness } from './test-schedules';
import type { Schedule } from '../src/main/schedules';

const MIN = 60_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-doormig-'));
const OLD = (doors: unknown) => JSON.stringify({ doors });
const run = (id: string, prompt = 'p' + id, scheduleId: string | undefined = 'sch-' + id): HeldRun => ({ id, at: 1, prompt, ...(scheduleId ? { scheduleId } : {}) });

/** A migration with a counting scheduler: `sends` is the number of prompts that really went out. */
function make(file: string, opts: { sessions?: string[]; schedules?: string[]; results?: ReleaseResult[] } = {}) {
  const loaded = loadHeld(file);
  const sends: string[] = [], stops: string[] = [], later: (() => void)[] = [];
  let changed = 0, results = opts.results ?? [];
  const deps: MigrateDeps = {
    sessionOf: (key) => ((opts.sessions ?? ['k1', 'k2']).includes(key) ? 'agent-' + key : undefined),
    scheduleExists: (id) => !!id && (opts.schedules ?? ['sch-a', 'sch-b', 'sch-c', 'sch-d']).includes(id),
    release: async (r) => { const x = results.shift() ?? 'sent'; if (x === 'sent') sends.push(r.prompt); return x; },
    persist: (doc) => saveHeld(file, doc),
    changed: () => { changed++; },
    stopped: (id, why) => stops.push(`${id}:${why}`),
    later: (fn) => later.push(fn),
  };
  const m = new HeldBeforeUpdate(loaded, deps);
  return { m, loaded, sends, stops, later, set results(r: ReleaseResult[]) { results = r; }, get changed() { return changed; } };
}
const fileHeld = (file: string): string[] => (fs.existsSync(file) ? Object.values(parseHeld(fs.readFileSync(file, 'utf8')).held).flat().map((r) => r.prompt) : []);

async function main(): Promise<void> {
  // ---- parse: tolerant; `closed` and `releasing` ignored; nothing from the prototype; a key with nothing held is dropped ----
  assert.deepStrictEqual(Object.keys(parseHeld('nope').held), []);
  const p = parseHeld(OLD({ s1: { closed: true, releasing: true, held: [{ id: 'a', at: 1, prompt: 'hi', scheduleId: 'x' }, { id: '', at: 1, prompt: 'bad' }, { id: 'b', at: 'x', prompt: 'bad' }] }, s2: { closed: true, held: [] }, s3: { closed: false, held: [] }, __proto__: { held: [run('z')] }, s4: 'x' }));
  assert.deepStrictEqual(Object.keys(p.held), ['s1'], 'only a key that holds a well-formed run is kept (a closed door with nothing held is not)');
  assert.deepStrictEqual(p.held.s1.map((r) => r.id), ['a'], 'bad runs are dropped');
  assert.strictEqual(JSON.stringify(p.held).includes('closed'), false, '`closed` is not carried');
  assert.strictEqual(({} as Record<string, unknown>).held, undefined, 'the prototype is untouched');
  assert.strictEqual(Object.keys(parseHeld(OLD({ ['k'.repeat(MAX_KEY + 1)]: { held: [run('a')] } })).held).length, 0, 'a key over the limit is dropped');
  assert.strictEqual(parseHeld(OLD({ s: { held: [run('a', 'x'.repeat(MAX_PROMPT + 1))] } })).held.s, undefined, 'a prompt over the limit is dropped');
  assert.strictEqual(parseHeld(OLD({ s: { held: Array.from({ length: MAX_HELD + 50 }, (_, i) => run('r' + i)) } })).held.s.length, MAX_HELD, 'at most MAX_HELD per key');
  const many = Object.fromEntries(Array.from({ length: MAX_KEYS + 20 }, (_, i) => ['k' + i, { held: [run('a')] }]));
  assert.strictEqual(Object.keys(parseHeld(OLD(many)).held).length, MAX_KEYS, 'at most MAX_KEYS keys');

  // ---- MIGRATION CASE 1: a closed door holding prompts: loaded, listed, nothing sent, nothing dropped, the file stays ----
  const f1 = path.join(dir, 'a.json');
  fs.writeFileSync(f1, OLD({ k1: { closed: true, held: [run('a', 'one'), run('b', 'two')] }, k2: { closed: false, held: [run('c', 'three')] } }));
  {
    const t = make(f1);
    const l = t.m.list();
    assert.deepStrictEqual(l.items.map((i) => [i.prompt, i.session, i.canSend]), [['one', 'agent-k1', true], ['two', 'agent-k1', true], ['three', 'agent-k2', true]], 'listed per session, in order');
    assert.strictEqual(l.notice, true, 'the notice is due');
    assert.deepStrictEqual(t.sends, [], 'SEND COUNTER: 0 across the update (nothing goes out on start)');
    assert.deepStrictEqual(fileHeld(f1), ['one', 'two', 'three'], 'the queue is still on disk (nothing dropped on start)');
    t.m.noticed();
    assert.deepStrictEqual(t.sends, [], 'showing the notice sends nothing');
    // MIGRATION CASE 2: a repeat start shows no second notice but the queue is still there
    const again = make(f1);
    assert.strictEqual(again.m.list().notice, false, 'a repeat start: no second notice');
    assert.strictEqual(again.m.list().items.length, 3, 'but the three are still held (a row in Settings)');
    assert.deepStrictEqual(again.sends, [], 'still 0 sends');
    // Decide later / Escape = no call at all: still held after more starts
    assert.strictEqual(make(f1).m.count(), 3);
  }

  // ---- MIGRATION CASE 3: Send goes one by one through the release path, only after the person chose it ----
  {
    const t = make(f1, { results: ['busy'] });
    const r = await t.m.send(['a', 'b']);
    assert.deepStrictEqual([r.started, r.skipped], [2, 0]);
    assert.deepStrictEqual(t.sends, [], 'the scheduler said busy: nothing went, nothing dropped');
    assert.deepStrictEqual(fileHeld(f1), ['one', 'two', 'three']);
    assert.strictEqual(t.m.isReleasing('k1'), true, 'the Send waits for the next idle of that session');
    t.results = ['sent'];
    t.m.onStatus({ type: 'status', sessionId: 'agent-k1', status: 'working' }, (id) => id.replace('agent-', ''));
    t.m.onStatus({ type: 'status', sessionId: 'agent-k1', agentId: 'sub', status: 'idle' }, (id) => id.replace('agent-', ''));
    t.m.onStatus({ type: 'status', sessionId: 'agent-k2', status: 'idle' }, (id) => id.replace('agent-', ''));
    assert.strictEqual(t.later.length, 0, 'only the end of a chosen session\'s main turn moves a Send on');
    t.m.onStatus({ type: 'status', sessionId: 'agent-k1', status: 'idle' }, (id) => id.replace('agent-', ''));
    t.later.shift()?.();
    await new Promise((r2) => setImmediate(r2));
    assert.deepStrictEqual(t.sends, ['one'], 'the first goes when the agent is free');
    assert.deepStrictEqual(fileHeld(f1), ['two', 'three'], 'and leaves the queue only now');
    t.m.onStatus({ type: 'status', sessionId: 'agent-k1', status: 'idle' }, (id) => id.replace('agent-', ''));
    t.later.shift()?.();
    await new Promise((r2) => setImmediate(r2));
    assert.deepStrictEqual(t.sends, ['one', 'two'], 'one at a time, in order');
    assert.deepStrictEqual(fileHeld(f1), ['three'], 'the run of the other session was not chosen: still held');
    // a restart: a half-done Send stops, nothing further goes out by itself
    const r2 = make(f1);
    assert.strictEqual(r2.m.isReleasing('k2'), false);
    r2.m.onStatus({ type: 'status', sessionId: 'agent-k2', status: 'idle' }, (id) => id.replace('agent-', ''));
    assert.strictEqual(r2.later.length, 0, 'after a restart no idle moves anything');
    assert.deepStrictEqual(r2.sends, []);
  }
  // each refusal of the scheduler stops the Send, keeps the run held and tells the window
  for (const why of ['paused-all', 'paused', 'cap', 'ended', 'updating', 'gone', 'failed'] as ReleaseResult[]) {
    const f = path.join(dir, `stop-${why}.json`);
    fs.writeFileSync(f, OLD({ k1: { closed: true, held: [run('a', 'one'), run('b', 'two')] } }));
    const t = make(f, { results: [why] });
    await t.m.send();
    assert.deepStrictEqual(t.sends, [], `${why}: nothing sent`);
    assert.deepStrictEqual(fileHeld(f), ['one', 'two'], `${why}: both still held (never lost)`);
    assert.deepStrictEqual(t.stops, ['agent-k1:' + why], `${why}: the window is told`);
    assert.strictEqual(t.m.isReleasing('k1'), false, `${why}: the Send is over; nothing further goes by itself`);
    t.m.onStatus({ type: 'status', sessionId: 'agent-k1', status: 'idle' }, (id) => id.replace('agent-', ''));
    assert.strictEqual(t.later.length, 0, `${why}: an idle does not restart it`);
  }

  // ---- MIGRATION CASE 4: a gone session or schedule can only be discarded, and says why ----
  {
    const f = path.join(dir, 'gone.json');
    fs.writeFileSync(f, OLD({ k1: { held: [run('a', 'one')] }, kx: { held: [run('b', 'two')] }, k2: { held: [run('c', 'three', 'sch-gone')] } }));
    const t = make(f);
    const items = Object.fromEntries(t.m.list().items.map((i) => [i.prompt, i]));
    assert.deepStrictEqual([items.one.canSend, items.two.canSend, items.three.canSend], [true, false, false]);
    assert.strictEqual(items.two.why, GONE_SESSION);
    assert.strictEqual(items.three.why, GONE_SCHEDULE);
    const r = await t.m.send();
    assert.deepStrictEqual([r.started, r.skipped], [1, 2]);
    assert.deepStrictEqual(t.sends, ['one'], 'only the one that could go');
    assert.deepStrictEqual(fileHeld(f), ['two', 'three'], 'the others stay held, not dropped, not sent');
    assert.strictEqual(t.m.discard(['b']), 1, 'Discard works for a gone one');
    assert.deepStrictEqual(fileHeld(f), ['three']);
  }

  // ---- MIGRATION CASE 5: Discard removes only what was chosen; an empty queue removes the file ----
  {
    const f = path.join(dir, 'disc.json');
    fs.writeFileSync(f, OLD({ k1: { held: [run('a', 'one'), run('b', 'two')] } }));
    const t = make(f);
    assert.strictEqual(t.m.discard(['a']), 1);
    assert.deepStrictEqual(fileHeld(f), ['two']);
    assert.strictEqual(t.m.discard(['nope']), 0, 'an unknown id removes nothing');
    assert.strictEqual(t.m.discard(), 1);
    assert.strictEqual(fs.existsSync(f), false, 'the file is removed when its queue is empty');
    assert.deepStrictEqual(t.sends, [], 'discarding never sends');
    assert.strictEqual(t.m.list().items.length, 0);
  }

  // ---- MIGRATION CASE 6: only `closed` flags (nothing held): no notice, the file is removed ----
  {
    const f = path.join(dir, 'only-closed.json');
    fs.writeFileSync(f, OLD({ k1: { closed: true, held: [] }, k2: { closed: true, held: [] } }));
    const t = make(f);
    assert.deepStrictEqual([t.m.list().items.length, t.m.list().notice], [0, false], 'a closed door with nothing held: nothing to say');
    assert.strictEqual(fs.existsSync(f), false, 'the old file is removed');
  }

  // ---- MIGRATION CASE 7: a damaged or oversized file is kept aside and says so; a missing file is an empty store ----
  {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{"doors": {"s1": {"held": [');
    const t = make(bad);
    assert.deepStrictEqual(t.m.list().items, []);
    assert.deepStrictEqual([t.m.list().damaged, t.m.list().notice], [true, true], 'it says so (the notice is due)');
    assert.ok(fs.existsSync(bad + '.bad') && !fs.existsSync(bad), 'kept aside, not overwritten');
    t.m.noticed();
    assert.strictEqual(t.m.list().notice, false, 'said once');
    const huge = path.join(dir, 'huge.json');
    fs.writeFileSync(huge, JSON.stringify({ doors: { s1: { held: [run('a')] } }, pad: 'z'.repeat(MAX_FILE) }));
    const h = loadHeld(huge);
    assert.deepStrictEqual([Object.keys(h.doc.held).length, h.damaged, fs.existsSync(huge + '.bad')], [0, true, true], 'over the size limit: not parsed, kept aside');
    const miss = loadHeld(path.join(dir, 'missing.json'));
    assert.deepStrictEqual([Object.keys(miss.doc.held).length, miss.damaged, fs.existsSync(path.join(dir, 'missing.json.bad'))], [0, false, false], 'a missing file: an empty store');
    assert.strictEqual(make(path.join(dir, 'missing.json')).m.list().notice, false, 'no notice');
  }

  // ---- the file is written atomically (temp file, then rename) and stays readable by `parseHeld` ----
  assert.deepStrictEqual(fs.readdirSync(dir).filter((x) => x.endsWith('.tmp')), [], 'no temp file left behind');

  // ---- old schedule logs (spec 044 FR-127) ----
  {
    // a schedule for a session that had a closed door runs as normal: see test-schedules (FR-032)
    // an old log with the retired outcome still loads and is never written again
    const { loadSchedules } = await import('../src/main/schedules');
    const sf = path.join(dir, 'schedules.json');
    fs.writeFileSync(sf, JSON.stringify({ schedules: [{ id: 'x', folder: '/w', prompt: 'p', every: 30, next: Date.now() + 1e6, last: { at: Date.now() - 1000, outcome: 'skipped-door-full' } }] }));
    const ld = loadSchedules(sf, Date.now());
    assert.strictEqual(ld.schedules[0]?.last?.outcome, 'skipped-door-full', 'an old log with skipped-door-full loads');
  }

  // ---- spec 044 FR-111 (review on #631): a prompt the person chose to send goes through the scheduler: Pause all, the schedule, its limit, busy; credited, recorded ----
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


  console.log('doormigrate tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
