/**
 * The agent rail's List view (spec 005 FR-194, FR-216): the pure rules of `src/renderer/railorder.js`. Folders with someone needing you
 * first (oldest wait first), then the office's room order; inside a folder whoever needs you first (oldest first), then `prio`, then
 * creation order; time never reorders anything. The collapsed folders: a tolerant load (corrupt, oversized, wrong-typed: nothing collapsed)
 * and the stored value (known folders only, removed when empty).
 * `npm run test:railorder`. Pure module; runs on any OS; no Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';

process.exitCode = 1;
const ROOT = path.join(__dirname, '..', '..');
type Item = { id: string; room: string; rank?: number; needs?: boolean; since?: number; prio?: number; i?: number };
type Group = { room: string; ids: string[]; needN: number };
const R = require(path.join(ROOT, 'src', 'renderer', 'railorder.js')) as {
  FOLD_KEY: string; MAX_FOLDS: number; MAX_PATH: number;
  group(items: Item[]): Group[];
  loadFolds(raw: unknown): Set<string>;
  foldsJSON(closed: Set<string>, known: Iterable<string>, listed?: boolean): string | null;
  parentNames(rooms: unknown, maxDepth?: number): Map<string, string>;
  YOUAT_KEY: string; ORDER_KEY: string; IDLE_KEY: string; MAX_YOUAT: number;
  loadYouAt(raw: unknown, now?: number): Record<string, number>;
  stampYouAt(map: Record<string, number>, id: unknown, now: number): Record<string, number>;
  youAtJSON(map: Record<string, number>, ids: string[], listed?: boolean): string | null;
  stampable(res: unknown, opts?: { coffee?: boolean }): boolean;
  loadOrder(raw: unknown): string; loadIdleOpen(raw: unknown): boolean;
  recent(items: RItem[], startedAt?: number, openId?: string): { head: string[]; open: string | null; idle: string[] };
};
type RItem = { id: string; rank?: number; needs?: boolean; since?: number; prio?: number; i?: number; youAt?: number };

// ---- order ----
const it = (id: string, room: string, rank: number, i: number, o: Partial<Item> = {}): Item => ({ id, room, rank, needs: false, prio: 2, i, ...o });
// three folders in the office's room order A, B, C; nobody needs you: the office's order, creation order inside
{
  const g = R.group([it('c1', 'C', 2, 0), it('a1', 'A', 0, 1), it('b1', 'B', 1, 2), it('a2', 'A', 0, 3)]);
  assert.deepStrictEqual(g.map((x) => x.room), ['A', 'B', 'C'], 'no one needs you: folders in the office order');
  assert.deepStrictEqual(g[0].ids, ['a1', 'a2'], 'creation order inside a folder');
  assert.deepStrictEqual(g.map((x) => x.needN), [0, 0, 0]);
}
// a folder with someone needing you leads; two such folders by their oldest wait, not their rank
{
  const g = R.group([
    it('a1', 'A', 0, 0), it('b1', 'B', 1, 1, { needs: true, since: 2000, prio: 0 }),
    it('c1', 'C', 2, 2, { needs: true, since: 1000, prio: 1 }), it('c2', 'C', 2, 3, { needs: true, since: 3000, prio: 0 }),
  ]);
  assert.deepStrictEqual(g.map((x) => x.room), ['C', 'B', 'A'], 'folders needing you first, oldest wait first (C waited since 1000)');
  assert.deepStrictEqual(g[0].ids, ['c1', 'c2'], 'inside: oldest wait first, before prio');
  assert.deepStrictEqual(g.map((x) => x.needN), [2, 1, 0], 'the count of who needs you per folder');
}
// inside a folder: needs first, then prio, then creation order
{
  const g = R.group([
    it('x1', 'A', 0, 0, { prio: 2 }), it('x2', 'A', 0, 1, { prio: 1 }), it('x3', 'A', 0, 2, { needs: true, since: 50, prio: 0 }),
    it('x4', 'A', 0, 3, { prio: 2 }), it('x5', 'A', 0, 4, { needs: true, since: 10, prio: 1 }),
  ]);
  assert.deepStrictEqual(g[0].ids, ['x5', 'x3', 'x2', 'x1', 'x4'], 'needs (oldest first), then prio, then creation order');
}
// the result never depends on the input order (a comparator that only works one way round is caught): every rotation of the input
{
  const rot = <T>(l: T[], k: number): T[] => l.slice(k).concat(l.slice(0, k));
  // a folder that needs you leads even when the office puts it last and the quiet folders are many
  const fs0 = [it('q1', 'A', 0, 0), it('q2', 'B', 1, 1), it('q3', 'C', 2, 2), it('q4', 'E', 4, 3), it('n1', 'D', 3, 4, { needs: true, since: 9, prio: 2 })];
  for (let k = 0; k < fs0.length; k++) assert.deepStrictEqual(R.group(rot(fs0, k)).map((x) => x.room), ['D', 'A', 'B', 'C', 'E'], `folders, rotation ${k}`);
  // inside a folder whoever needs you leads even with the same prio and a later creation (a spending limit needs you at prio 2)
  const rs0 = [it('r1', 'A', 0, 0), it('r2', 'A', 0, 1), it('r3', 'A', 0, 2, { needs: true, since: 7, prio: 2 }), it('r4', 'A', 0, 3)];
  for (let k = 0; k < rs0.length; k++) assert.deepStrictEqual(R.group(rot(rs0, k))[0].ids, ['r3', 'r1', 'r2', 'r4'], `rows, rotation ${k}`);
}
// a tie on the wait keeps prio, then creation order; an unknown wait sorts after a known one
{
  const g = R.group([it('p', 'A', 0, 0, { needs: true, since: 5, prio: 1 }), it('q', 'A', 0, 1, { needs: true, since: 5, prio: 0 }), it('r', 'A', 0, 2, { needs: true })]);
  assert.deepStrictEqual(g[0].ids, ['q', 'p', 'r']);
}
// same rank (two folders the office does not order): first seen first; an unranked folder goes last
{
  const g = R.group([it('z', 'Z', NaN, 0), it('y', 'Y', 0, 1), it('w', 'W', 0, 2)]);
  assert.deepStrictEqual(g.map((x) => x.room), ['Y', 'W', 'Z']);
}
// time never reorders: the rules read no clock, and the same input gives the same output
{
  const was = Date.now;
  (Date as unknown as { now: () => number }).now = () => { throw new Error('the order read the clock'); };
  try {
    const input = [it('a', 'A', 0, 0, { needs: true, since: 100 }), it('b', 'B', 1, 1, { needs: true, since: 50 })];
    assert.deepStrictEqual(R.group(input), R.group(input.map((x) => ({ ...x }))));
  } finally { (Date as unknown as { now: () => number }).now = was; }
}
// hostile input: not an array, missing ids, __proto__ as a folder key
assert.deepStrictEqual(R.group(null as unknown as Item[]), []);
assert.deepStrictEqual(R.group([null as unknown as Item, { room: 'A' } as Item, it('k', '__proto__', 0, 0)]).map((x) => x.room), ['__proto__']);

// ---- collapsed folders ----
assert.strictEqual(R.FOLD_KEY, 'durbar.railFolds');
const ok = JSON.stringify({ v: 1, closed: ['/home/me/a', 'C:\\work\\b'] });
assert.deepStrictEqual([...R.loadFolds(ok)], ['/home/me/a', 'C:\\work\\b'], 'a saved value loads');
assert.deepStrictEqual([...R.loadFolds(JSON.parse(ok))], ['/home/me/a', 'C:\\work\\b'], 'an object loads too');
for (const bad of [null, undefined, '', '{', 'null', '[]', '{"v":2,"closed":["/a"]}', '{"v":1}', '{"v":1,"closed":"/a"}', '{"v":1,"closed":[1]}',
  '{"v":1,"closed":[""]}', JSON.stringify({ v: 1, closed: ['/a', 'x'.repeat(R.MAX_PATH + 1)] }), JSON.stringify({ v: 1, closed: Array.from({ length: R.MAX_FOLDS + 1 }, (_, i) => '/f' + i) }), 42, [] as unknown]) {
  assert.strictEqual(R.loadFolds(bad).size, 0, `nothing collapsed for ${String(bad).slice(0, 40)}`);
}
assert.strictEqual(R.loadFolds(JSON.stringify({ v: 1, closed: Array.from({ length: R.MAX_FOLDS }, (_, i) => '/f' + i) })).size, R.MAX_FOLDS, 'exactly the cap loads');
// the stored value: known folders only, in order; null (remove the key) when nothing is collapsed
assert.strictEqual(R.foldsJSON(new Set(['/a', '/gone', '/b']), ['/a', '/b', '/c']), JSON.stringify({ v: 1, closed: ['/a', '/b'] }));
assert.strictEqual(R.foldsJSON(new Set(), ['/a']), null);
// FR-216 item 4: a toggle before the session list has loaded keeps a saved path whose folder has not appeared yet; once listed it is pruned
assert.strictEqual(R.foldsJSON(new Set(['/later', '/a']), ['/a'], false), JSON.stringify({ v: 1, closed: ['/later', '/a'] }), 'before the list has loaded, an unseen saved folder is kept');
assert.strictEqual(R.foldsJSON(new Set(['/later', '/a']), ['/a'], true), JSON.stringify({ v: 1, closed: ['/a'] }), 'once listed, an unseen folder is pruned');
assert.strictEqual(R.foldsJSON(new Set(['x'.repeat(R.MAX_PATH + 1)]), [], false), null, 'before the list has loaded, an over-long path is still never stored');
assert.strictEqual(R.foldsJSON(new Set(['/gone']), ['/a']), null, 'only gone folders: the key is removed');
assert.strictEqual(R.foldsJSON(new Set(['x'.repeat(R.MAX_PATH + 1)]), ['x'.repeat(R.MAX_PATH + 1)]), null, 'an over-long path is never stored');
{
  const many = Array.from({ length: R.MAX_FOLDS + 5 }, (_, i) => '/f' + i);
  const v = R.foldsJSON(new Set(many), many);
  assert.strictEqual(JSON.parse(v as string).closed.length, R.MAX_FOLDS, 'at most the cap is stored');
  assert.strictEqual(R.loadFolds(v).size, R.MAX_FOLDS, 'and it loads back');
}
// round trip
assert.deepStrictEqual([...R.loadFolds(R.foldsJSON(new Set(['/a']), ['/a']))], ['/a']);

// parentNames (spec 005 FR-340, issue #1905): folders with equal names are told apart by the nearest parent that differs
{
  const L = (rooms: Array<{ id: string; name: string; path: string }>) => [...R.parentNames(rooms)].map(([k, v]) => k + '=' + v).join(';');
  assert.strictEqual(L([{ id: 'a', name: 'iot-portal', path: '~/clients/acme/iot-portal' }, { id: 'b', name: 'iot-portal', path: '~/clients/globex/iot-portal' }, { id: 'c', name: 'blog', path: '~/work/blog' }]), 'a=acme;b=globex', 'one parent, a unique name shows none');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: '~/x/acme/web' }, { id: 'b', name: 'Web', path: '~/y/acme/web' }]), 'a=x/acme;b=y/acme', 'equal parents: the next one up joins, case folded');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: '~/a/x' }, { id: 'b', name: 'web', path: '~/a/y' }]), 'a=x;b=y', 'renamed folders with the same parent: the folder itself');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: 'C:\\Users\\v\\a\\web' }, { id: 'b', name: 'web', path: '~\\b\\web' }]), 'a=a;b=b', 'Windows separators');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: '~/web' }, { id: 'b', name: 'web', path: '/srv/web' }]), 'a=~;b=srv', 'the home folder is a parent too');
  assert.strictEqual(L([{ id: 'a', name: 'x', path: '~/x' }, { id: 'b', name: 'y', path: '~/y' }]), '', 'no equal names, no labels');
  assert.strictEqual(R.parentNames(null).size, 0, 'a non-list is nothing');
  assert.strictEqual(R.parentNames([null, { id: 1 }, { id: 'a', name: null, path: null }]).size, 0, 'bad rows are skipped');
}

// ---- spec 113 P6: Recent (FR-041, FR-042, FR-044, FR-045) ----
{
  const r = (id: string, rank: number, i: number, o: Partial<RItem> = {}): RItem => ({ id, rank, prio: 2, i, ...o });
  const S = 1000; // the app started at 1000
  // needs you first (oldest wait first), then your sends newest first, then the rest by fixed keys
  let o = R.recent([
    r('a', 0, 0), r('b', 0, 1, { youAt: 2000 }), r('c', 1, 2, { youAt: 3000 }), r('d', 1, 3, { needs: true, since: 500 }),
    r('e', 2, 4, { needs: true, since: 100 }), r('f', 2, 5), r('g', 3, 6, { youAt: 500 }),
  ], S);
  assert.deepStrictEqual(o.head, ['e', 'd', 'c', 'b'], 'needs you first (oldest wait first), then youAt descending');
  assert.deepStrictEqual(o.idle, ['g', 'a', 'f'], 'an older send first, then never-sent rows by folder rank, prio, creation order');
  assert.strictEqual(o.open, null);
  // a row that needs you stays in the needs block even though it was never sent to; a needs row with a later youAt does not outrank an older wait
  o = R.recent([r('x', 0, 0, { needs: true, since: 900, youAt: 9000 }), r('y', 1, 1, { needs: true, since: 100 })], S);
  assert.deepStrictEqual(o.head, ['y', 'x'], 'inside the needs block only the wait counts, not youAt');
  // equal youAt: the office order; equal waits: the office order
  o = R.recent([r('p', 2, 0, { youAt: 5000 }), r('q', 1, 1, { youAt: 5000 }), r('s', 1, 2, { youAt: 5000, prio: 1 })], S);
  assert.deepStrictEqual(o.head, ['s', 'q', 'p'], 'ties keep the office order: rank, then prio');
  o = R.recent([r('p', 2, 0, { needs: true, since: 7 }), r('q', 1, 1, { needs: true, since: 7 })], S);
  assert.deepStrictEqual(o.head, ['q', 'p'], 'equal waits: folder rank');
  // the start time: a send before the start is idle (still ahead of never-sent rows), at the start is not
  o = R.recent([r('old', 5, 0, { youAt: 999 }), r('on', 6, 1, { youAt: 1000 }), r('none', 0, 2)], S);
  assert.deepStrictEqual(o.head, ['on'], 'youAt equal to the start counts as this run');
  assert.deepStrictEqual(o.idle, ['old', 'none'], 'earlier than the start: idle, but ahead of never-sent rows');
  // a neighbour's status change never moves an unstamped row: the same fixed keys whatever `needs` of others do
  const base = [r('u1', 0, 0), r('u2', 0, 1), r('u3', 1, 2), r('u4', 1, 3)];
  assert.deepStrictEqual(R.recent(base, S).idle, ['u1', 'u2', 'u3', 'u4'], 'never-sent rows: folder rank, then creation order');
  assert.deepStrictEqual(R.recent([{ ...base[0], needs: true, since: 5 }, ...base.slice(1)], S).idle, ['u2', 'u3', 'u4'], 'one neighbour needing you only leaves the group');
  assert.deepStrictEqual(R.recent([base[0], base[1], { ...base[2], needs: true, since: 5 }, base[3]], S).idle, ['u1', 'u2', 'u4'], 'the others keep their places');
  // agent time never reorders: a row with a later agent event (a field recent() does not know) and the same youAt stays in the office order
  o = R.recent([{ ...r('m', 0, 0, { youAt: 2000 }), lastEventAt: 1 } as RItem, { ...r('n', 1, 1, { youAt: 2000 }), lastEventAt: 99999 } as RItem], S);
  assert.deepStrictEqual(o.head, ['m', 'n'], 'an agent event moves nothing');
  // the open chat's row: in place when stamped this run, in needs when it needs you, otherwise `open` (never in the group)
  const fx = [r('a', 0, 0), r('b', 0, 1, { youAt: 2000 }), r('c', 1, 2)];
  assert.deepStrictEqual(R.recent(fx, S, 'a'), { head: ['b'], open: 'a', idle: ['c'] }, 'unstamped open row: open, not inside the group');
  assert.deepStrictEqual(R.recent(fx, S, 'b'), { head: ['b'], open: null, idle: ['a', 'c'] }, 'a stamped open row stays in its place');
  assert.deepStrictEqual(R.recent([r('a', 0, 0, { needs: true, since: 1 }), r('c', 1, 1)], S, 'a'), { head: ['a'], open: null, idle: ['c'] }, 'an open row that needs you stays in the needs block');
  assert.deepStrictEqual(R.recent(fx, S, 'zzz').idle, ['a', 'c'], 'an id that is not listed changes nothing');
  assert.deepStrictEqual(R.recent(fx, undefined).head, ['b'], 'no start time: only a never-sent row is idle');
  assert.deepStrictEqual(R.recent([r('old', 0, 0, { youAt: 5 })], undefined).head, ['old'], 'no start time: an old send is not idle');
  assert.deepStrictEqual(R.recent(null as unknown as RItem[], S), { head: [], open: null, idle: [] }, 'not a list: nothing');
  assert.deepStrictEqual(R.recent([null, { i: 1 }, r('ok', 0, 0)] as unknown as RItem[], S).idle, ['ok'], 'bad rows are skipped');
  // no row is lost or doubled whatever the mix, for every rotation of the input
  const mix = [r('a', 0, 0, { needs: true, since: 3 }), r('b', 0, 1, { youAt: 1500 }), r('c', 1, 2), r('d', 1, 3, { youAt: 20 }), r('e', 2, 4, { youAt: 2500 })];
  const rot = <T>(l: T[], k: number): T[] => l.slice(k).concat(l.slice(0, k));
  for (let k = 0; k < mix.length; k++) {
    const out = R.recent(rot(mix, k), S, 'c');
    assert.deepStrictEqual(out, { head: ['a', 'e', 'b'], open: 'c', idle: ['d'] }, `rotation ${k}`);
  }
}
// youAt stores
{
  const NOW = 10_000;
  assert.deepStrictEqual(R.loadYouAt('{"a":5,"b":7}', NOW), { a: 5, b: 7 }, 'a stored value loads');
  assert.deepStrictEqual(R.loadYouAt({ a: 50_000 }, NOW), { a: NOW }, 'a time later than now reads as now');
  for (const bad of ['', '{', 'null', '[]', '"x"', '{"a":"1"}', '{"":1}', '{"a":-1}', '{"a":0}', '{"a":null}', '{"a":1,"b":"x"}', 7, null, undefined, [1]]) assert.deepStrictEqual(R.loadYouAt(bad, NOW), {}, `bad value ${JSON.stringify(bad)} loads as empty`);
  assert.deepStrictEqual(R.loadYouAt({ ['x'.repeat(201)]: 5 }, NOW), {}, 'an id over 200 characters is corrupt: empty');
  const big: Record<string, number> = {}; for (let i = 0; i < R.MAX_YOUAT + 1; i++) big['s' + i] = i + 1;
  assert.deepStrictEqual(R.loadYouAt(JSON.stringify(big), NOW), {}, 'more than the cap: empty');
  delete big['s0']; assert.strictEqual(Object.keys(R.loadYouAt(JSON.stringify(big), NOW)).length, R.MAX_YOUAT, 'exactly the cap loads');
  assert.deepStrictEqual(R.loadYouAt('{"a":' + '1'.repeat(200_000) + '}', NOW), {}, 'an oversized string is empty');
  // stamping
  assert.deepStrictEqual(R.stampYouAt({ a: 1 }, 'b', 5), { a: 1, b: 5 }, 'adds');
  assert.deepStrictEqual(R.stampYouAt({ a: 1 }, 'a', 5), { a: 5 }, 'a new send replaces the time');
  const m0 = { a: 1 }; R.stampYouAt(m0, 'b', 5); assert.deepStrictEqual(m0, { a: 1 }, 'the input is not changed');
  for (const id of ['', null, 7, undefined, 'x'.repeat(201)]) assert.deepStrictEqual(R.stampYouAt({ a: 1 }, id, 5), { a: 1 }, `bad id ${String(id).slice(0, 5)} is not stamped`);
  assert.deepStrictEqual(R.stampYouAt({ a: 1 }, 'b', NaN), { a: 1 }, 'a bad time is not stamped');
  let m: Record<string, number> = {}; for (let i = 1; i <= R.MAX_YOUAT; i++) m = R.stampYouAt(m, 's' + i, i);
  assert.strictEqual(Object.keys(m).length, R.MAX_YOUAT);
  m = R.stampYouAt(m, 'fresh', 9999);
  assert.strictEqual(Object.keys(m).length, R.MAX_YOUAT, 'capped at the maximum');
  assert.ok(!('s1' in m) && 'fresh' in m && 's2' in m, 'the oldest is dropped, the new one kept');
  assert.ok(!JSON.stringify(m).match(/[a-z]{6,}\s/), 'only ids and numbers');
  // saving
  assert.strictEqual(R.youAtJSON({}, ['a']), null, 'nothing: the key is removed');
  assert.deepStrictEqual(JSON.parse(R.youAtJSON({ a: 1, gone: 2 }, ['a'], true) || '{}'), { a: 1 }, 'an id that is gone is dropped once the list has loaded');
  assert.deepStrictEqual(JSON.parse(R.youAtJSON({ a: 1, gone: 2 }, [], false) || '{}'), { a: 1, gone: 2 }, 'before the list has loaded nothing is dropped');
  assert.strictEqual(R.youAtJSON({ gone: 2 }, ['a'], true), null, 'all gone: remove the key');
  assert.deepStrictEqual(JSON.parse(R.youAtJSON({ a: 1, b: NaN as number }, ['a', 'b'], true) || '{}'), { a: 1 }, 'a bad time is not written');
  assert.deepStrictEqual(R.loadYouAt(R.youAtJSON({ a: 1, b: 2 }, ['a', 'b']), NOW), { a: 1, b: 2 }, 'round trip');
  // which sends stamp
  assert.strictEqual(R.stampable({ ok: true }), true, 'an accepted send stamps');
  assert.strictEqual(R.stampable({ ok: true, slash: '/x' }), true, 'an accepted send of a slash command text is a send');
  assert.strictEqual(R.stampable({ ok: false, error: 'no' }), false, 'a failed or refused send does not');
  assert.strictEqual(R.stampable({ notSent: true }), false, 'a send that went nowhere does not');
  assert.strictEqual(R.stampable({ ok: true, notSent: true }), false);
  assert.strictEqual(R.stampable({ ok: true }, { coffee: true }), false, 'a coffee-break resume is not a send you typed');
  for (const bad of [null, undefined, {}, 'ok', 1, { ok: 'yes' }]) assert.strictEqual(R.stampable(bad), false, `${JSON.stringify(bad)} does not stamp`);
  // order and fold
  assert.strictEqual(R.loadOrder('recent'), 'recent'); assert.strictEqual(R.loadOrder('folders'), 'folders');
  for (const bad of [null, undefined, '', 'Recent', 'x', 1, {}]) assert.strictEqual(R.loadOrder(bad), 'folders', 'anything else is Folders');
  assert.strictEqual(R.loadIdleOpen('1'), true); for (const bad of [null, '0', '', 'true', 1]) assert.strictEqual(R.loadIdleOpen(bad), false, 'folded by default');
  assert.deepStrictEqual([R.YOUAT_KEY, R.ORDER_KEY, R.IDLE_KEY], ['durbar.railYouAt', 'durbar.railOrder', 'durbar.railIdleOpen']);
}
// parentNames with the Recent depth cap (FR-043): at most three parents, then the folder's own name
{
  const rooms = [{ id: 'a', name: 'web', path: '/1/2/3/p/web' }, { id: 'b', name: 'web', path: '/9/2/3/p/web' }, { id: 'c', name: 'iot-platform-form-2', path: 'C:\\w\\x\\iot-platform-form-2' }];
  assert.deepStrictEqual([...R.parentNames(rooms, 3)], [['a', 'web'], ['b', 'web']], 'capped at three parents: past it, the folder itself');
  assert.deepStrictEqual([...R.parentNames(rooms, 4)], [['a', '1/2/3/p'], ['b', '9/2/3/p']], 'four parents tell them apart');
  assert.deepStrictEqual([...R.parentNames(rooms)].map(([k]) => k), ['a', 'b'], 'no cap: as before');
  const L = (r: Array<{ id: string; name: string; path: string }>) => [...R.parentNames(r, 3)].map(([k, v]) => k + '=' + v).join(';');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: 'C:\\web' }, { id: 'b', name: 'web', path: 'D:\\web' }]), 'a=C:;b=D:', 'a drive root gives the drive');
  assert.strictEqual(L([{ id: 'a', name: 'web', path: '/web' }, { id: 'b', name: 'web', path: '/srv/web' }]), 'a=;b=srv', 'a root has no parent');
  assert.strictEqual(L([{ id: 'a', name: 'flow', path: '~/p/flow.code-workspace' }, { id: 'b', name: 'flow', path: '~/q/flow.code-workspace' }]), 'a=p;b=q', 'a workspace file: its own folder');
}

// source pin (FR-216 item 4): the page prunes saved folds only once the session list has loaded, as pruneNumbers does
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  const fn = (src.match(/function saveFolds\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.ok(fn, 'app.js has saveFolds()');
  assert.ok(/RAIL\.foldsJSON\(railFolds\(\),\s*ROOMS\.map\(r=>r\.path\),\s*agentsListed\|\|demoOn\)/.test(fn), 'saveFolds() passes agentsListed||demoOn to foldsJSON, so nothing is pruned before the session list has loaded');
}

process.exitCode = 0;
console.log('railorder tests passed');
