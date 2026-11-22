/** Settings section list (spec 052 FR-226, T219): the entries are built from the rendered headings, the current one follows the scroll,
 *  the keys step through the list. `npm run test:settingsnav`. Pure module; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
type Head = { id?: string; text: string };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const N = require(path.join(ROOT, 'src', 'renderer', 'settingsnav.js')) as {
  build: (h: Head[]) => { id: string; label: string; at: number }[];
  current: (tops: number[], edge: number, atEnd?: boolean) => number;
  step: (key: string, i: number, n: number, row?: boolean) => number;
  MAX_LABEL: number;
};

// build: one entry per heading, in order, from the headings given (nothing kept here)
assert.deepStrictEqual(N.build([{ id: 'a', text: 'Display' }, { id: 'b', text: 'Motion' }]).map((e) => [e.id, e.label]), [['a', 'Display'], ['b', 'Motion']]);
assert.deepStrictEqual(N.build([{ id: 'b', text: 'Motion' }]).map((e) => e.label), ['Motion'], 'a section that is gone leaves the list, no edit');
assert.deepStrictEqual(N.build([{ id: 'x', text: 'Theme' }, { id: 'a', text: 'Display' }]).map((e) => e.label), ['Theme', 'Display'], 'page order, not alphabetical');
assert.strictEqual(N.build([{ id: 'a', text: '  Spending \n  limit ' }])[0].label, 'Spending limit', 'white space is collapsed');
assert.deepStrictEqual(N.build([{ id: 'a', text: '' }, { id: 'b', text: '   ' }, { id: 'c', text: 'Keyboard' }]).map((e) => e.id), ['c'], 'an empty heading is left out');
assert.deepStrictEqual(N.build([{ id: 'a', text: 'One' }, { id: 'a', text: 'Two' }]).map((e) => e.label), ['One'], 'a repeated id is left out');
assert.deepStrictEqual(N.build([{ text: 'No id' }, { id: 'k', text: 'K' }]).map((e) => [e.id, e.at]), [['sn-0', 0], ['k', 1]], 'a heading without an id gets one from its position');
const long = N.build([{ id: 'a', text: 'x'.repeat(100) }])[0].label;
assert.strictEqual(long.length, N.MAX_LABEL, 'a long heading is cut');
assert.ok(long.endsWith('…'));
assert.deepStrictEqual(N.build(null as unknown as Head[]), [], 'no headings, no list');

// current: the last heading that reached the edge; the first before any; the last at the end of the page
assert.strictEqual(N.current([100, 400, 900], 40), 0, 'before the first heading reaches the edge, the first is current');
assert.strictEqual(N.current([-300, 20, 600], 40), 1);
assert.strictEqual(N.current([-900, -300, 40], 40), 2, 'a heading exactly at the edge is current');
assert.strictEqual(N.current([-900, -300, 41], 40), 1, 'one pixel below the edge is not');
assert.strictEqual(N.current([-900, 10, 300], 40, true), 2, 'at the end of the page the last one is current, however short it is');
assert.strictEqual(N.current([], 40), -1, 'no sections, no current');

// step: arrows step without wrapping, Home and End jump, other keys do nothing
assert.strictEqual(N.step('ArrowDown', 0, 3), 1);
assert.strictEqual(N.step('ArrowDown', 2, 3), 2, 'no wrap at the end');
assert.strictEqual(N.step('ArrowUp', 0, 3), 0, 'no wrap at the start');
assert.strictEqual(N.step('ArrowUp', 2, 3), 1);
assert.strictEqual(N.step('Home', 2, 3), 0);
assert.strictEqual(N.step('End', 0, 3), 2);
assert.strictEqual(N.step('ArrowRight', 0, 3), -1, 'in the column, ArrowRight is not ours');
assert.strictEqual(N.step('ArrowLeft', 1, 3), -1, 'in the column, ArrowLeft is not ours');
assert.strictEqual(N.step('ArrowRight', 0, 3, true), 1, 'in the row, ArrowRight steps on');
assert.strictEqual(N.step('ArrowRight', 2, 3, true), 2, 'in the row, no wrap at the end');
assert.strictEqual(N.step('ArrowLeft', 2, 3, true), 1, 'in the row, ArrowLeft steps back');
assert.strictEqual(N.step('ArrowLeft', 0, 3, true), 0, 'in the row, no wrap at the start');
assert.strictEqual(N.step('Tab', 0, 3), -1);
assert.strictEqual(N.step('ArrowDown', 0, 0), -1);

// the page loads the module before screens.js and screens.js builds the list from the rendered headings
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('settingsnav.js') > 0 && html.indexOf('settingsnav.js') < html.indexOf('screens.js'), 'settingsnav.js loads before screens.js');
const scr = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8');
assert.ok(/SN=window\.DurbarSettingsNav/.test(scr) && /SN\.build\(heads\)/.test(scr), 'screens.js builds the list with DurbarSettingsNav.build from the headings it finds');
assert.ok(/SN_HEADS='[^']*h3/.test(scr) && /querySelectorAll\(SN_HEADS\)/.test(scr), 'the headings are read from the rendered page');
assert.ok(!/\bconst SETTINGS_SECTIONS\b/.test(scr), 'no hard-coded list of sections');
console.log('settings section list tests passed');
