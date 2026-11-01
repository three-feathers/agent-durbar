/**
 * Auto-follow work and the attention queue (spec 052 FR-182..FR-190, issue 686). The pure parts of `src/renderer/autofollow.js` (queue order,
 * the held place, Previous/Next, the guard decision, arrivals), the setting in main (off by default, only a boolean, a real `ok`), and source
 * checks that keep the page wired to it: off by default, no click on an answer, focus on the title, the guards read before a switch.
 * `npm run test:autofollow`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore } from '../src/main/settings';
import { parseSettings } from '../src/shared/credits';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type Tracker = { follow(id: string): void; has(id: string): boolean; ids(): string[]; size: number; drop(id: string): void; clear(): void; manualOpen(id: string): void; lastDesk(): string | null; setLast(id: string): void; arrive(id: string, kind: string, key?: unknown): boolean; retract(id: string, kinds?: string[]): void; pendingList(): { id: string; kind: string }[]; due(reason: string, can?: (id: string) => boolean): { id: string; kind: string } | null; acted(): void; isQuiet: boolean };
const AF = require(path.join(R, 'autofollow.js')) as {
  queue(n: unknown, u: unknown): string[]; withHeld(ids: string[], h: unknown): string[]; position(ids: string[], id: unknown): { index: number; count: number };
  positionText(p: unknown): string; step(ids: string[], cur: unknown, dir: number): string | null; holdReason(s: Record<string, unknown>, o?: Record<string, unknown>): string;
  createTracker(): Tracker; statusText(s: Record<string, unknown>): string;
};
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };

// 1. the queue: needs-you first, unchanged; unread after, oldest first, ties in given order; each agent once; junk ignored
eq(AF.queue(['b', 'a'], [{ id: 'c', at: 5 }, { id: 'd', at: 2 }, { id: 'a', at: 1 }, { id: 'e' }, { id: 'f', at: 2 }]), ['b', 'a', 'd', 'f', 'c', 'e'], 'queue order');
eq(AF.queue([], []), [], 'empty'); eq(AF.queue(null, undefined), [], 'junk'); eq(AF.queue([1, '', 'x', 'x'], [null, {}, { id: 3 }]), ['x'], 'junk entries');
// 2. the held place
eq(AF.withHeld(['a', 'b', 'c'], { id: 'z', at: 1 }), ['a', 'z', 'b', 'c'], 'held goes back at its index');
eq(AF.withHeld(['a'], { id: 'z', at: 9 }), ['a', 'z'], 'held past the end'); eq(AF.withHeld(['a', 'z'], { id: 'z', at: 0 }), ['a', 'z'], 'held already there');
eq(AF.withHeld(['a'], null), ['a'], 'no held');
// 3. position words and Previous/Next
eq(AF.positionText({ index: 1, count: 3 }), '2 of 3', 'position'); eq(AF.positionText({ index: -1, count: 3 }), '3 need you', 'outside'); eq(AF.positionText({ index: -1, count: 1 }), '1 needs you', 'outside one');
eq(AF.positionText({ index: -1, count: 0 }), 'Nothing needs you', 'empty');
const ids = ['a', 'b', 'c'];
eq([AF.step(ids, 'a', 1), AF.step(ids, 'c', 1), AF.step(ids, 'a', -1), AF.step(ids, 'b', -1)], ['b', 'a', 'c', 'a'], 'wraps both ways');
eq([AF.step(ids, null, 1), AF.step(ids, 'zz', -1)], ['a', 'c'], 'from outside: first / last'); eq(AF.step([], 'a', 1), null, 'empty queue');
// 4. guards: each one alone holds, with its own words; none holds when the page is calm
eq(AF.holdReason({}), '', 'calm');
for (const [k, w] of [['hidden', 'hidden'], ['blurred', 'background'], ['dialog', 'dialog'], ['menu', 'menu'], ['screen', 'Settings'], ['readingOther', 'reading'], ['editable', 'typing']] as const) {
  ok(new RegExp(w).test(AF.holdReason({ [k]: true })), 'holds: ' + k);
}
ok(/typing/.test(AF.holdReason({ typedAgo: 500 })), 'a key typed 0.5 s ago'); eq(AF.holdReason({ typedAgo: 2500 }), '', 'typed long ago'); eq(AF.holdReason({ typedAgo: null }), '', 'never typed');
eq(AF.holdReason({ editable: true }, { office: true }), '', 'the empty box that just sent is not typing'); ok(AF.holdReason({ editable: true, editableText: true }, { office: true }), 'text in the box is');
ok(AF.holdReason({ dialog: true }, { office: true }), 'a dialog holds the return to the office too');
// 5. tracker: arrivals, one switch, quiet until the person acts, manual navigation
{
  const t = AF.createTracker();
  eq(t.arrive('a', 'done', 1), false, 'not followed: no arrival');
  t.follow('a'); t.follow('b');
  eq(t.arrive('a', 'done', 1), true, 'arrival'); eq(t.arrive('a', 'done', 1), false, 'same key twice'); eq(t.arrive('a', 'weird', 1), false, 'unknown kind');
  eq(t.arrive('b', 'ask', 7), true, 'second agent');
  eq(t.due('you are typing'), null, 'held by a guard'); eq(t.pendingList().length, 2, 'held arrivals stay');
  eq(t.due('', (id: string) => id !== 'a'), { id: 'b', kind: 'ask' }, 'an agent that cannot be opened is skipped');
  eq(t.has('b'), false, 'delivered: no longer followed'); ok(t.isQuiet, 'quiet after a switch');
  eq(t.due(''), null, 'no second automatic switch'); t.acted(); eq(t.due(''), { id: 'a', kind: 'done' }, 'after the person acts');
  eq(t.arrive('a', 'done', 1), false, 'a delivered arrival is not repeated (and a is not followed now)');
  t.follow('a'); eq(t.arrive('a', 'done', 1), false, 'delivered key never repeats'); eq(t.arrive('a', 'done', 2), true, 'a new completion is a new arrival');
  t.follow('c'); t.manualOpen('c'); eq(t.ids(), ['c'], 'opening c by hand ends the following of the others'); eq(t.lastDesk(), 'c', 'last desk');
  t.follow('d'); t.arrive('d', 'ask', 1); t.arrive('d', 'error', 2); eq(t.pendingList().filter((p) => p.id === 'd').length, 1, 'a newer arrival replaces the older one');
  t.retract('d', ['ask']); eq(t.pendingList().filter((p) => p.id === 'd').length, 1, 'retract by kind keeps others'); t.retract('d'); eq(t.pendingList().length, 0, 'retract');
  t.clear(); eq(t.size, 0, 'clear');
}
// 6. the strip's words: Durbar's own voice, no promise
eq(AF.statusText({ paused: true }), 'Auto-follow is paused. Nothing moves by itself.', 'paused');
eq(AF.statusText({ followed: 1, name: 'Priya' }), 'Auto-follow on. Priya is working. Back to the office.', 'one');
eq(AF.statusText({ followed: 3 }), 'Auto-follow on. 3 followed agents are working.', 'several');
eq(AF.statusText({ followed: 1, name: 'Priya', hiddenName: 'Priya' }), 'Auto-follow on. Priya is working in a hidden folder.', 'hidden folder');
ok(/^Held: you are typing\. 2 are waiting to open\.$/.test(AF.statusText({ held: 'you are typing', heldCount: 2 })), 'held');
ok(!/done|finished|sure|complete/i.test(AF.statusText({ followed: 1, name: 'Priya' })), 'no promise of completion');
eq(AF.statusText({}), 'Auto-follow on. It follows an agent after you send it a message.', 'idle');

// 7. the setting in main: off by default, only true written, only a boolean accepted, a real ok
eq(parseSettings('{"autoFollowWork":true}'), { autoFollowWork: true }, 'parse true');
for (const v of ['false', '"true"', '1', 'null', '[]']) eq(parseSettings('{"autoFollowWork":' + v + '}'), {}, 'only true is kept: ' + v);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-autofollow-'));
  const f = path.join(dir, 's.json');
  const ss = new SettingsStore(f); ss.load();
  eq(ss.autoFollowWork, false, 'off by default');
  for (const junk of ['yes', 1, 0, null, undefined, {}, []]) {
    const r = ss.autoFollowReply(junk);
    eq([r.ok, r.autoFollowWork, typeof r.error], [false, false, 'string'], 'refused with ok:false: ' + String(junk));
  }
  ok(!fs.existsSync(f), 'a refused value saves nothing');
  eq(ss.autoFollowReply(true), { ok: true, autoFollowWork: true }, 'on');
  const back = new SettingsStore(f); back.load(); eq(back.autoFollowWork, true, 'kept after a restart');
  eq(back.autoFollowReply('no').autoFollowWork, true, 'a refused value keeps the value in force');
  eq(back.autoFollowReply(false), { ok: true, autoFollowWork: false }, 'off'); ok(!('autoFollowWork' in JSON.parse(fs.readFileSync(f, 'utf8'))), 'off is not written');
  fs.rmSync(dir, { recursive: true, force: true });
}
// 8. source checks: the page is wired the way the spec says
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const afBlock = app.slice(app.indexOf('/* ---- spec 052 FR-182..FR-190'), app.indexOf('/* ---- spec 052 FR-042 / FR-043'));
ok(afBlock.length > 3000, 'the Auto-follow block is found');
ok(/let AF_ON=false/.test(afBlock), 'off by default in the page');
ok(/openPanel\(d\.id,'title'\)/.test(afBlock) && /openPanel\(id,'title'\)/.test(afBlock), 'chats open with focus on the title');
ok(!/\.click\(\)|bridge\.(answer|resolve|allow|deny|setPermMode|respond)|settlePerm|settleQuestion|answerBar/.test(afBlock), 'the block never clicks, answers or resolves');
ok(!/openPanel\([^)]*,(true|false)\)/.test(afBlock), 'never focuses the message box or an answer button');
ok(/AF\.holdReason\(afSnapshot\(\)/.test(afBlock) && /AFT\.due\(reason,afCanOpen\)/.test(afBlock), 'a delivery reads the guards and the hidden-folder rule first');
ok(!/transition|animation|animate|motion\(/.test(afBlock) && !/is-followed[^}]*(animation|transition)/.test(fs.readFileSync(path.join(R, 'styles.css'), 'utf8').split('spec 052 FR-182..FR-190 (issue 686)')[1] || ''), 'no animation or transition');
ok(/if\(r\.ok\)afOnAccepted\(a\)/.test(app), 'following starts from an accepted send only');
ok(/if\(!AF_ON\|\|AF_PAUSED\|\|!a0\|\|a0\.parent\)return/.test(afBlock), 'off, paused and helpers follow nothing');
ok(!/UNREAD\.read|markRead|syncSeen/.test(afBlock), 'following never clears an unread marker itself');
ok(/needsMeOrder\(\)\.map/.test(afBlock) && !/vis\(a\)==='waiting'/.test(afBlock), 'the queue reuses needsMeOrder, no second attention model');

console.log('test-autofollow: OK (' + n + ' checks)');
