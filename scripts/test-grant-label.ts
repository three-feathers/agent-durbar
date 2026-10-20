/** Short grant labels (spec 052 FR-141): a tool-name prefix that repeats the server name is dropped. `npm run test:grantlabel`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const G = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'grantlabel.js')) as { shortGrantLabel: (l: unknown) => string };
const s = G.shortGrantLabel;
assert.strictEqual(s('server-x › server-x-GetItem'), 'server-x › GetItem');
assert.strictEqual(s('server-x › server-x_get_item'), 'server-x › get_item');
assert.strictEqual(s('server-x › server-x__GetItem'), 'server-x › GetItem');
assert.strictEqual(s('Server-X › server-x.GetItem'), 'Server-X › GetItem', 'the prefix is compared without case');
assert.strictEqual(s('server-x › GetItem'), 'server-x › GetItem', 'no repeated prefix: unchanged');
assert.strictEqual(s('server-x › server-x'), 'server-x › server-x', 'a tool named like the server keeps its name');
assert.strictEqual(s('server-x › server-x-'), 'server-x › server-x-', 'nothing left after the prefix: unchanged');
assert.strictEqual(s('server › serverless'), 'server › serverless', 'a prefix without a separator is not a prefix');
assert.strictEqual(s('run: npm test'), 'run: npm test', 'a label without a server part is unchanged');
assert.strictEqual(s('write src/a.ts'), 'write src/a.ts');
assert.strictEqual(s(' › x'), ' › x', 'an empty server part is unchanged');
assert.strictEqual(s(''), '');
assert.strictEqual(s(undefined), '');
console.log('[grantlabel] all checks passed');
