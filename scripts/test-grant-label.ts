/** Short grant labels (spec 052 FR-141): a tool-name prefix that repeats the server name is dropped. `npm run test:grantlabel`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const G = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'grantlabel.js')) as { shortGrantLabel: (l: unknown) => string };
const s = G.shortGrantLabel;
const B = (G as unknown as { grantsBusyFor: (b: string, a: string) => string }).grantsBusyFor;
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
assert.strictEqual(B('a1', 'a1'), 'a1', 'a Revoke all under way for this agent stays');
assert.strictEqual(B('a1', 'b2'), '', 'another agent is drawn: it is dropped');
assert.strictEqual(B('', 'a1'), '', 'none under way');
// FR-108 (FR-013): the line that says how far "for this session" reaches
const H = (G as unknown as { scopeHint: (p: unknown) => string }).scopeHint;
assert.strictEqual(H({ kind: 'write', scopeKey: 'write:/w/src', scopeLabel: 'write in src/' }), 'Allow for this session covers every file in src/, not only this one.');
assert.strictEqual(H({ kind: 'write', scopeKey: 'write-folders:a\nb', scopeLabel: 'write in a/, b/' }), 'Allow for this session covers every file in these folders (a/, b/), not only these.');
assert.strictEqual(H({ kind: 'write', scopeKey: 'write:', scopeLabel: 'write' }), 'Allow for this session covers every file in that folder, not only this one.');
assert.strictEqual(H({ kind: 'shell', scopeKey: 'shell-exact:git status', scopeLabel: 'run git status', broadScopeKey: 'shell:git', broadScopeLabel: 'run git (any arguments)' }), 'Any arguments allows every simple \u201cgit\u201d command, not only this one, also \u201cgit push\u201d.');
assert.strictEqual(H({ kind: 'shell', scopeKey: 'shell-exact:ls', scopeLabel: 'run ls', broadScopeKey: 'shell:ls', broadScopeLabel: 'run ls (any arguments)' }), 'Any arguments allows every simple \u201cls\u201d command, not only this one.');
assert.strictEqual(H({ kind: 'shell', scopeKey: 'shell-exact:python x.py', scopeLabel: 'run python x.py' }), '', 'an exact-command grant needs no line');
assert.strictEqual(H({ kind: 'read', scopeKey: 'read:/x', scopeLabel: 'read in x/' }), '', 'other kinds: none');
{
  const long = 'd'.repeat(200), t = H({ kind: 'write', scopeKey: 'write:/x', scopeLabel: 'write in ' + long + '/' });
  assert.ok(t.includes('\u2026') && !t.includes('d'.repeat(120)) && t.includes('d'.repeat(100)), 'a 200-character folder is cut with a visible ellipsis: ' + t);
  assert.ok(!H({ kind: 'write', scopeKey: 'write:/x', scopeLabel: 'write in ' + 'd'.repeat(100) + '/' }).includes('\u2026'), 'a short folder is not cut');
}
assert.strictEqual(H(null), '');
console.log('[grantlabel] all checks passed');
