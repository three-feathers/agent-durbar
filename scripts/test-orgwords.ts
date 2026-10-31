/** Spec 076 FR-208 (issue 602): the words of Settings > Organization. `npm run test:orgwords`. Fixtures only, no policy file, no credits. */
import * as assert from 'assert';
import * as path from 'path';
interface Row { app: string; state: string; status: string; note: string; paths: string[]; problems: string[]; modes: { mode: string; why: string; refused: boolean }[]; counts: string[]; noMode: string }
interface Sec { failed: boolean; failText: string; rows: (Row & { id: string })[] }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'orgwords.js')) as { rowOf(v: unknown): Row; sectionOf(v: unknown, failed?: boolean): Sec };

const none = W.rowOf({ app: 'Codex', found: false, unreadable: false, paths: [], problems: [], modes: {}, counts: {} });
assert.strictEqual(none.state, 'none');
assert.match(none.status, /No policy file found/);
assert.match(none.note, /does not read those/); // the limit is said next to "no policy"

const applies = W.rowOf({ app: 'Claude Code', found: true, unreadable: false, paths: ['/etc/claude-code/managed-settings.json'], problems: [],
  modes: { allow: { why: "Blocked by your organization's Claude Code policy", refuse: true } }, counts: { modelAllow: null, modelDeny: 1, mcpAllow: 2, mcpDeny: 0, toolDeny: 3 } });
assert.strictEqual(applies.state, 'applies');
assert.deepStrictEqual(applies.modes, [{ mode: 'Allow all', why: "Blocked by your organization's Claude Code policy", refused: true }]);
assert.deepStrictEqual(applies.counts, ['Models: 1 blocked', 'MCP servers: only 2 allowed', 'MCP tools: 3 blocked']);
assert.strictEqual(applies.noMode, '');
assert.match(W.rowOf({ app: 'X', found: true, unreadable: false, modes: {} }).noMode, /blocks none/);

// unreadable is unknown, whether or not a file was found; never "no policy"
for (const found of [true, false]) {
  const r = W.rowOf({ app: 'Copilot', found, unreadable: true, paths: [], problems: ['/etc/x.json: the system refused the read'], modes: {}, counts: {} });
  assert.strictEqual(r.state, 'unknown');
  assert.doesNotMatch(r.status, /No policy/);
  assert.match(r.status, /unknown/);
  assert.deepStrictEqual(r.problems, ['/etc/x.json: the system refused the read']);
  assert.strictEqual(r.noMode, ''); // "blocks none" is never claimed for a partial read
  assert.strictEqual(r.note, '');
}

// a failed view is unknown, with no row that could read as clear
const failed = W.sectionOf(undefined, true);
assert.ok(failed.failed && failed.rows.length === 0 && /unknown/.test(failed.failText) && !/No policy/.test(failed.failText));
assert.strictEqual(W.sectionOf({}, false).rows.length, 0);
assert.deepStrictEqual(W.sectionOf({ claude: { app: 'Claude Code', found: false } }, false).rows.map((r) => r.id), ['claude']);

// hostile shapes: no throw, no non-string leaks
const odd = W.rowOf({ app: 5, found: 'yes', paths: [1, 'a'], problems: [{}, 'p'], modes: { allow: { why: 3 } }, counts: { modelDeny: 'x' } });
assert.strictEqual(odd.app, 'This agent app');
assert.deepStrictEqual(odd.paths, ['a']);
assert.deepStrictEqual(odd.problems, ['p']);
assert.strictEqual(odd.modes.length, 0);
assert.doesNotThrow(() => W.rowOf(null));
console.log('[076] orgwords: PASS');
