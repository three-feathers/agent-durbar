/** Room door summary tests: `npm run test:rooms`. See specs/017. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { summarizeRoom } = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'roomsummary.js')) as { summarizeRoom: (m: { state: string; helpers?: string[] }[]) => { text: string; tone: string; attention: boolean } };

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
