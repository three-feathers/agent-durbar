/** Room door summary tests: `npm run test:rooms`. See specs/017. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
type SignIn = { state?: string; paused?: boolean; coffee?: boolean; limit?: boolean; ended?: boolean; resting?: boolean; failing?: boolean; helpers?: string[] };
type Sign = { key: string; word: string; short: string; tone: string; door: string; icon: string };
const { summarizeRoom, doorSign, SIGN_KEYS } = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'roomsummary.js')) as {
  summarizeRoom: (m: { state: string; helpers?: string[] }[]) => { text: string; tone: string; attention: boolean };
  doorSign: (x: SignIn) => Sign; SIGN_KEYS: string[];
};

const m = (state: string, helpers: string[] = []) => ({ state, helpers });
const t = (list: ReturnType<typeof m>[]) => summarizeRoom(list).text;

assert.strictEqual(t([m('working'), m('working'), m('thinking')]), 'Busy - 3 working');
assert.strictEqual(t([m('waiting'), m('working'), m('waiting')]), 'Waiting for you - 2');
assert.strictEqual(t([m('idle'), m('idle')]), 'Available');
assert.strictEqual(t([m('idle'), m('done')]), 'Available');
assert.strictEqual(t([m('done'), m('done')]), 'All done');
assert.strictEqual(t([m('working', ['working']), m('idle')]), 'Meeting in progress');
assert.strictEqual(t([m('working', ['done']), m('idle')]), 'Busy - 1 working', 'a finished helper is not a meeting');
assert.strictEqual(t([m('error'), m('waiting'), m('working')]), 'Needs attention - error', 'error wins');
assert.strictEqual(t([m('error'), m('error')]), 'Needs attention - 2 errors');
assert.strictEqual(t([m('waiting', ['working'])]), 'Waiting for you - 1', 'waiting beats meeting');
assert.strictEqual(t([]), 'Available');
assert.strictEqual(t(undefined as never), 'Available');
assert.deepStrictEqual([summarizeRoom([m('waiting')]).tone, summarizeRoom([m('waiting')]).attention], ['waiting', true]);
assert.deepStrictEqual([summarizeRoom([m('error')]).tone, summarizeRoom([m('error')]).attention], ['error', true]);
assert.strictEqual(summarizeRoom([m('working')]).attention, false);
console.log('room summary tests passed');

/* spec 017 FR-003 (2026-10-23): the meeting-room door sign of one session, derived from its shown state */
const sg = (x: SignIn) => doorSign(x);
const row = (x: SignIn) => { const r = sg(x); return [r.key, r.word, r.tone, r.door]; };
assert.deepStrictEqual(row({ state: 'working' }), ['busy', 'Busy', 'working', 'closed']);
assert.deepStrictEqual(row({ state: 'thinking' }), ['busy', 'Busy', 'thinking', 'closed'], 'thinking keeps its own colour');
assert.deepStrictEqual(row({ state: 'working', failing: true }), ['busy', 'Busy', 'failing', 'closed'], 'failing tool calls: Busy in the failing colours');
assert.deepStrictEqual(row({ state: 'working', helpers: ['working'] }), ['meeting', 'In a meeting', 'working', 'closed']);
assert.deepStrictEqual(row({ state: 'thinking', helpers: ['done', 'thinking'] }), ['meeting', 'In a meeting', 'thinking', 'closed']);
assert.deepStrictEqual(row({ state: 'working', helpers: ['done', 'idle'] }), ['busy', 'Busy', 'working', 'closed'], 'finished helpers are no meeting');
assert.deepStrictEqual(row({ state: 'idle', helpers: ['working'] }), ['available', 'Available', 'idle', 'open'], 'a meeting needs the session itself at work');
assert.deepStrictEqual(row({ state: 'waiting' }), ['waiting', 'Waiting for you', 'waiting', 'closed']);
assert.deepStrictEqual(row({ state: 'waiting', limit: true, coffee: true }), ['waiting', 'Waiting for you', 'waiting', 'closed'], 'Q2: the spending limit waits for you, also on its coffee break');
assert.deepStrictEqual(row({ state: 'error' }), ['attention', 'Needs attention', 'error', 'open'], 'Q6: an error keeps the cabin open, so its trouble stays in sight');
assert.deepStrictEqual(row({ state: 'error', paused: true }), ['attention', 'Needs attention', 'error', 'open'], 'an error wins over everything');
assert.deepStrictEqual(row({ state: 'idle', paused: true }), ['dnd', 'Do not disturb', 'idle', 'closed'], 'paused');
assert.deepStrictEqual(row({ state: 'working', coffee: true }), ['dnd', 'Do not disturb', 'idle', 'closed'], 'a coffee break that resumes by itself');
assert.deepStrictEqual(row({ state: 'waiting', paused: true }), ['waiting', 'Waiting for you', 'waiting', 'closed'], 'a question still waits while paused');
assert.deepStrictEqual(row({ state: 'idle', ended: true }), ['away', 'Away', 'idle', 'closed'], 'ended');
assert.deepStrictEqual(row({ state: 'done', resting: true }), ['away', 'Away', 'idle', 'closed'], 'Q4: resting in the lounge');
assert.deepStrictEqual(row({ state: 'idle', paused: true, ended: true }), ['dnd', 'Do not disturb', 'idle', 'closed'], 'paused beats away');
assert.deepStrictEqual(row({ state: 'idle' }), ['available', 'Available', 'idle', 'open']);
assert.deepStrictEqual(row({ state: 'done' }), ['done', 'Done', 'done', 'open'], 'owner 2026-10-23: work done, the door is open with a Done tag');
assert.deepStrictEqual(row({}), ['available', 'Available', 'idle', 'open'], 'missing input');
assert.deepStrictEqual(row(undefined as never), ['available', 'Available', 'idle', 'open'], 'undefined input never throws');
assert.deepStrictEqual(row({ state: 'bogus' }), ['available', 'Available', 'idle', 'open'], 'unknown state');
/* every sign has its own icon and word (colour is never the only cue, FR-005) */
const all = [{ state: 'error' }, { state: 'waiting' }, { state: 'idle', paused: true }, { state: 'idle', ended: true }, { state: 'working', helpers: ['working'] }, { state: 'working' }, { state: 'done' }, { state: 'idle' }].map(sg);
assert.deepStrictEqual(all.map((r) => r.key), SIGN_KEYS, 'SIGN_KEYS lists the signs in priority order');
assert.strictEqual(new Set(all.map((r) => r.icon)).size, all.length, 'one icon per sign');
assert.strictEqual(new Set(all.map((r) => r.word)).size, all.length, 'one word per sign');
assert.strictEqual(new Set(all.map((r) => r.short)).size, all.length, 'one short word per sign');
assert.deepStrictEqual(all.map((r) => r.short), ['Alert', 'Waiting', 'DND', 'Away', 'Meeting', 'Busy', 'Done', 'Available']);
assert.ok(all.every((r) => r.short.length <= 9), 'short words fit the narrowest desks');
assert.deepStrictEqual(all.filter((r) => r.door === 'open').map((r) => r.key), ['attention', 'done', 'available'], 'the cabin is open when done, free or in trouble; closed while busy, waiting, DND or away');
assert.ok(Object.isFrozen(SIGN_KEYS), 'SIGN_KEYS cannot be changed by a caller');
console.log('door sign tests passed');
