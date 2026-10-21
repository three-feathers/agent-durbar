/** "Needs you" outside the window and the inbox order (spec 052 FR-059, FR-061): `npm run test:attention`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseBadgeCount, shouldFlash } from '../src/main/badge';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import * as os from 'os';

type Item = { key: string; id: string; name: string; text: string };
type Notifier = {
  observe: (items: Item[], f: { armed?: boolean; enabled?: boolean; focused?: boolean }) => void;
  dueAt: () => number | null;
  take: () => { title: string; body: string; id: string } | null;
};
const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require(path.join(ROOT, 'src', 'renderer', 'attention.js')) as {
  COALESCE_MS: number; THROTTLE_MS: number; BODY_MAX: number;
  titleFor: (n: unknown) => string;
  clip: (t: unknown, max?: number) => string;
  waitLabel: (ms: unknown) => string;
  sortOldestFirst: <T>(items: T[], sinceOf: (x: T) => unknown) => T[];
  createNotifier: (o?: { now?: () => number; coalesceMs?: number; throttleMs?: number }) => Notifier;
};

// the window title
assert.strictEqual(A.titleFor(0), 'Agent Durbar');
assert.strictEqual(A.titleFor(3), '(3) Agent Durbar');
assert.strictEqual(A.titleFor(1), '(1) Agent Durbar');
for (const bad of [-1, NaN, undefined, null, 'x']) assert.strictEqual(A.titleFor(bad), 'Agent Durbar', 'no count: ' + String(bad));

// the body is one line of at most 80 characters
assert.strictEqual(A.clip('Edit  src/a.ts\n(rename)'), 'Edit src/a.ts (rename)');
const long = A.clip('x'.repeat(200));
assert.strictEqual(long.length, 80); assert.ok(long.endsWith('…'));
assert.strictEqual(A.clip(null), '');

// wait labels: minutes only
assert.strictEqual(A.waitLabel(5000), 'waiting less than a minute');
assert.strictEqual(A.waitLabel(4 * 60000 + 30000), 'waiting 4 min');
assert.strictEqual(A.waitLabel(60 * 60000), 'waiting 1 h');
assert.strictEqual(A.waitLabel(75 * 60000), 'waiting 1 h 15 min');
assert.strictEqual(A.waitLabel(-1), ''); assert.strictEqual(A.waitLabel('x'), '');

// oldest first; a tie or a missing time keeps the given (office) order
const rows = [{ id: 'a', t: 300 }, { id: 'b', t: 100 }, { id: 'c', t: 300 }, { id: 'd', t: undefined }, { id: 'e', t: 200 }];
assert.deepStrictEqual(A.sortOldestFirst(rows, (r) => r.t).map((r) => r.id), ['b', 'e', 'a', 'c', 'd']);
assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e'], 'the input is not changed');

// the notifier
let t = 1000;
const now = (): number => t;
const it = (id: string, name: string, text = 'Edit src/x.ts', key = id + '|p|1'): Item => ({ key, id, name, text });
{
  const N = A.createNotifier({ now });
  // startup: what is already there is only remembered
  N.observe([it('j', 'Jonas')], { armed: false, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'nothing that existed at startup');
  N.observe([it('j', 'Jonas')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'still nothing after arming');
  // a new one while in the background: due after the coalescing window
  N.observe([it('j', 'Jonas'), it('k', 'Kenji', 'Run python evals/baseline.py --compare')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), 1000 + A.COALESCE_MS);
  assert.strictEqual(N.take(), null, 'not before the window ends');
  t += A.COALESCE_MS;
  assert.deepStrictEqual(N.take(), { title: 'Kenji needs you', body: 'Run python evals/baseline.py --compare', id: 'k' });
  assert.strictEqual(N.take(), null, 'shown once');
  // two more within 2 s: one notification; and the 10 s throttle
  t += 1000;
  N.observe([it('j', 'Jonas'), it('k', 'Kenji'), it('l', 'Lena')], { armed: true, enabled: true, focused: false });
  t += 500;
  N.observe([it('j', 'Jonas'), it('k', 'Kenji'), it('l', 'Lena'), it('m', 'Maya')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), 3000 + A.THROTTLE_MS, 'throttled: at most one every 10 s');
  t = 3000 + A.THROTTLE_MS;
  assert.deepStrictEqual(N.take(), { title: '2 agents need you', body: 'Lena, Maya', id: 'l' });
}
{
  const N = A.createNotifier({ now });
  N.observe([], { armed: true, enabled: true, focused: false });
  N.observe([it('a', 'Ana')], { armed: true, enabled: true, focused: false });
  N.observe([], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'answered before it was shown: dropped');
  N.observe([it('b', 'Ben')], { armed: true, enabled: true, focused: false });
  N.observe([it('b', 'Ben')], { armed: true, enabled: true, focused: true });
  assert.strictEqual(N.dueAt(), null, 'you came back: dropped');
  N.observe([it('b', 'Ben'), it('c', 'Cy')], { armed: true, enabled: true, focused: true });
  assert.strictEqual(N.dueAt(), null, 'nothing while the window is focused');
  N.observe([it('b', 'Ben'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: false, focused: false });
  assert.strictEqual(N.dueAt(), null, 'nothing while turned off');
  // a new request from the same agent (another key) is new
  N.observe([it('b', 'Ben', 'Run npm test', 'b|p|2'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: true, focused: false });
  t += A.THROTTLE_MS;
  const n = N.take();
  assert.ok(n && n.title === 'Ben needs you' && n.body === 'Run npm test', JSON.stringify(n));
  // the same agent twice in one batch counts once
  N.observe([it('b', 'Ben', 'Run npm test', 'b|p|2'), it('b', 'Ben', 'x', 'b|q|3'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: true, focused: false });
  t += A.THROTTLE_MS;
  const n2 = N.take();
  assert.ok(n2 && n2.title === 'Ben needs you', JSON.stringify(n2));
}

// the badge count from the renderer is not trusted
assert.strictEqual(parseBadgeCount(0), 0); assert.strictEqual(parseBadgeCount(3), 3); assert.strictEqual(parseBadgeCount(999), 999);
for (const bad of [-1, 1000, 1.5, NaN, Infinity, '3', null, undefined, {}, []]) assert.strictEqual(parseBadgeCount(bad), null, 'refused: ' + String(bad));
assert.ok(shouldFlash(1, 2, false, 'win32'));
assert.ok(!shouldFlash(1, 2, true, 'win32'), 'not while focused');
assert.ok(!shouldFlash(2, 1, false, 'win32'), 'not when it shrinks');
assert.ok(!shouldFlash(1, 2, false, 'darwin') && !shouldFlash(1, 2, false, 'linux'), 'a badge count there');

// the setting: on by default, only false is written
assert.deepStrictEqual(parseSettings('{"notifyNeedsMe":false}'), { notifyNeedsMe: false });
for (const v of ['true', '"false"', '0', 'null']) assert.deepStrictEqual(parseSettings('{"notifyNeedsMe":' + v + '}'), {}, 'only false is kept: ' + v);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-attention-'));
  const f = path.join(dir, 's.json');
  const ss = new SettingsStore(f);
  ss.load();
  assert.strictEqual(ss.notifyNeedsMe, true, 'on by default');
  for (const junk of ['no', 0, null, undefined, {}]) assert.strictEqual(ss.setNotifyNeedsMe(junk), true, 'only a boolean changes it: ' + String(junk));
  assert.strictEqual(ss.setNotifyNeedsMe(false), false);
  const back = new SettingsStore(f); back.load();
  assert.strictEqual(back.notifyNeedsMe, false, 'kept after a restart');
  assert.strictEqual(back.setNotifyNeedsMe(true), true);
  assert.ok(!('notifyNeedsMe' in JSON.parse(fs.readFileSync(f, 'utf8'))), 'on is not written');
  fs.rmSync(dir, { recursive: true, force: true });
}

// wiring: the page loads the helper and the build copies it
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('src="attention.js"') > 0 && html.indexOf('src="attention.js"') < html.indexOf('src="app.js"'), 'index.html loads attention.js before app.js');
assert.ok(/'attention\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies attention.js');

console.log('attention tests passed');
