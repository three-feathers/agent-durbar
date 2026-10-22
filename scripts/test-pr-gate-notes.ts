/*
 * scripts/pr-gate.sh skips exact status notes (AGENTS.md, "Test once, then trust the record"; spec 021 FR-036): a comment that is only
 * `reviewing at <sha>` or `checks run at <sha>: …` on one line. The pattern lives once, in scripts/pr-status-note.re (Oniguruma, as jq uses it).
 * This checks it against fixtures in JS (\A and \z become ^ and $ without the m flag) and, when jq is installed, with jq itself.
 */
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const re = fs.readFileSync(path.join(ROOT, 'scripts', 'pr-status-note.re'), 'utf8').trim();
const js = new RegExp(re.replace(/^\\A/, '^').replace(/\\z$/, '$'));
const notes = ['reviewing at 6d2a841b', 'checks run at 6d2a841b: npm test 86/86', '  reviewing at abcdef1234  ', 'checks run at 0123456789abcdef0123456789abcdef01234567: ok'];
const asks = [
  'Reviewing at a high level: one required change',
  'checks run at the moment fail',
  'checks run at 6d2a841b: ok\nRequired: fix X',
  'reviewing at 6d2a841b\nplease also rename foo',
  'I am reviewing at abc1234 now', 'reviewing at XYZ1234', 'checks run at 6d2a841b',
];
for (const n of notes) assert.ok(js.test(n), `a status note: ${JSON.stringify(n)}`);
for (const a of asks) assert.ok(!js.test(a), `not a status note: ${JSON.stringify(a)}`);
const jq = spawnSync('jq', ['-c', `[.[]|select(test("${re.replace(/\\/g, '\\\\')}"))]`], { input: JSON.stringify([...notes, ...asks]), encoding: 'utf8', shell: false });
if (jq.status === 0) assert.deepStrictEqual(JSON.parse(jq.stdout), notes, 'jq picks exactly the notes');
else console.log('pr-gate notes: jq not installed, JS check only');
// pr-gate.sh reads the pattern from that file, and uses it both for others' comments and for the author's own last answer
const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'pr-gate.sh'), 'utf8');
assert.ok(gate.includes('pr-status-note.re'), 'pr-gate.sh reads the shared pattern');
assert.strictEqual((gate.match(/\(\$NOTE\|not\)/g) || []).length, 2, 'notes are skipped in both places (others\' comments and the author\'s own answers)');
console.log('pr-gate notes tests passed');
