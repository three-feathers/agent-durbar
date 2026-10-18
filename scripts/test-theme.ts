/* test-theme.ts — unit tests for src/renderer/theme.js (spec 035) */

import * as assert from 'node:assert';
import * as path from 'node:path';

const T = require(path.resolve(process.cwd(), 'src', 'renderer', 'theme.js'));

// --- Clean Office defaults ---
assert.strictEqual(T.CLEAN_ID, 'clean-office');
assert.ok(T.token('--bg'), 'Clean Office has --bg token');
assert.strictEqual(T.token('--bg'), '#f6f3ee');
assert.strictEqual(T.token('bg'), '#f6f3ee');
assert.strictEqual(T.token('--made-up'), null);
assert.ok(T.slot('chair-back'), 'chair-back slot exists');
assert.ok(T.slot('desk'), 'desk slot exists');
assert.strictEqual(T.slot('nonexistent'), null);
assert.strictEqual(T.word('room'), 'room');

// --- setTheme / current ---
const id = T.setTheme('clean-office');
assert.strictEqual(id, 'clean-office');
const cur = T.current();
assert.strictEqual(cur.id, 'clean-office');
assert.ok(cur.manifest);

// Unknown theme falls back to Clean Office
const id2 = T.setTheme('nope');
assert.strictEqual(id2, 'clean-office');

// --- Manifest validation ---
const good = T._validateManifest({
  id: 'corporate',
  name: 'Corporate Office',
  author: 'Test',
  version: '0.1',
  extends: 'clean-office',
  tokens: { '--bg': '#eef1f4' },
  art: { 'chair-back': '<rect x="0" y="0" width="10" height="10" fill="#333"/>' },
  words: { room: 'office' },
});
assert.strictEqual(good.id, 'corporate');
assert.strictEqual(good.extends, 'clean-office');
assert.strictEqual(good.tokens['--bg'], '#eef1f4');
assert.ok(good.art['chair-back']);
assert.strictEqual(good.words.room, 'office');

// Invalid extends is normalized to clean-office
assert.strictEqual(T._validateManifest({ extends: 'something-else' }).extends, 'clean-office');

// --- Token fallback ---
T.setTheme(good);
assert.strictEqual(T.token('--bg'), '#eef1f4');
assert.strictEqual(T.token('--surface'), '#fffdf9'); // falls back to Clean Office
T.setTheme('clean-office'); // reset

// --- Slot sanitization ---
assert.ok(T._sanitizeSlot('<rect width="10" height="10" fill="red"/>'), 'basic rect allowed');
assert.strictEqual(T._sanitizeSlot('<script>alert(1)</script>'), null, 'script rejected');
assert.strictEqual(T._sanitizeSlot('<rect onclick="x" width="10"/>'), null, 'event handler rejected');
assert.strictEqual(T._sanitizeSlot('<rect href="http://x" width="10"/>'), null, 'href rejected');
assert.strictEqual(T._sanitizeSlot('<rect style="fill:red" width="10"/>'), null, 'style attr rejected');
assert.strictEqual(T._sanitizeSlot('<foreignObject>bad</foreignObject>'), null, 'foreignObject rejected');
assert.strictEqual(T._sanitizeSlot('not svg'), null, 'garbage rejected');

// Only whitelisted tags allowed
assert.strictEqual(T._sanitizeSlot('<iframe src="x"/>'), null, 'iframe rejected');
assert.ok(T._sanitizeSlot('<g><path d="M0 0h10" fill="#000"/></g>'), 'g + path allowed');

// --- Invalid manifest values ignored ---
const partial = T._validateManifest({
  id: 'partial',
  tokens: 'not-an-object',
  art: { bad: '<script/>', good: '<circle cx="5" cy="5" r="5"/>' },
});
assert.deepStrictEqual(partial.tokens, {});
assert.strictEqual(partial.art.bad, undefined);
assert.ok(partial.art.good);

console.log('theme tests passed');
