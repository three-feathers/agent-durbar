/**
 * scripts/claim.sh (AGENTS.md "Claim, label, branch"; spec 021 FR-063, T043): `npm run test:claim`. `gh` is a fake on PATH that keeps one
 * issue's assignees, labels, timeline and comments in a JSON file; no network. The fake answers the exact `gh api` calls claim.sh makes
 * (it does not evaluate --jq: it prints what the expression would), and logs every call so the test can assert what was never done.
 * Needs bash: skipped on Windows runners without it (Git Bash has it).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'claim.sh');
if (process.platform === 'win32') { console.log('claim tests: skipped on Windows (fake gh is a bash shim)'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const FAKE = `
const fs = require('fs');
const args = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(st));
st.log.push(args.join(' ')); st.tick = (st.tick || 0) + 1;
const ts = (k) => '2026-10-29T10:00:' + String(k).padStart(2, '0') + 'Z';
const rest = args.filter((a) => a !== '--paginate');
const call = rest.join(' ');
const field = (k) => { const i = rest.indexOf('-f'); return i >= 0 && rest[i + 1].startsWith(k + '=') ? rest[i + 1].slice(k.length + 1) : null; };
const add = (login, t) => { if (!st.assignees.includes(login)) st.assignees.push(login); st.events.push({ t, id: ++st.id, login }); };
let out = '';
if (st.fail && call.includes(st.fail)) { save(); console.error('HTTP 403: API rate limit exceeded'); process.exit(1); }
if (call === 'api user --jq .login') out = st.me;
else if (/^api repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/\\d+ --jq/.test(call)) out = (st.kind) + '\\n' + st.assignees.join(' ') + '\\n' + (st.author || 'someoneelse');
else if (/\\/timeline --jq/.test(call)) out = st.events.map((e) => e.t + ' ' + e.id + ' ' + e.login).join('\\n');
else if (/^api -X POST .*\\/assignees /.test(call)) {
  const mine = ts(st.tick);
  if (st.race && st.race.when === 'before') add(st.race.login, ts(st.tick - 1));
  add(field('assignees[]'), mine);
  if (st.race && st.race.when === 'after') add(st.race.login, ts(st.tick + 1));
} else if (/^api -X DELETE .*\\/assignees /.test(call)) st.assignees = st.assignees.filter((a) => a !== field('assignees[]'));
else if (/^api -X POST .*\\/labels /.test(call)) { if (!st.labels.includes(field('labels[]'))) st.labels.push(field('labels[]')); }
else if (/^api -X DELETE .*\\/labels\\/status%3Aclaimed/.test(call)) st.labels = st.labels.filter((l) => l !== 'status:claimed');
else if (/^api -X POST .*\\/comments /.test(call)) st.comments.push(field('body'));
else { save(); console.error('fake gh: unexpected call: ' + call); process.exit(99); }
save();
if (out) console.log(out);
`;
fs.writeFileSync(path.join(tmp, 'fake-gh.js'), FAKE);
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash\nexec node "${path.join(tmp, 'fake-gh.js')}" "$@"\n`, { mode: 0o755 });

interface State { me: string; kind: string; author?: string; assignees: string[]; labels: string[]; events: { t: string; id: number; login: string }[]; comments: string[]; log: string[]; id: number; tick: number; race?: { login: string; when: string }; fail?: string }
let k = 0;
function run(over: Partial<State>, ...argv: string[]): { r: ReturnType<typeof spawnSync>; st: State } {
  const f = path.join(tmp, `state${k++}.json`);
  const st: State = { me: 'vikramgorla', kind: 'issue', assignees: [], labels: [], events: [], comments: [], log: [], id: 100, tick: 0, ...over };
  fs.writeFileSync(f, JSON.stringify(st));
  const r = spawnSync('bash', [SCRIPT, ...argv], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_STATE: f } });
  return { r, st: JSON.parse(fs.readFileSync(f, 'utf8')) };
}
const deletes = (st: State): string[] => st.log.filter((l) => l.includes('DELETE'));

// free issue: assigned, labelled, exit 0
{
  const { r, st } = run({}, '7');
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.deepStrictEqual(st.assignees, ['vikramgorla']);
  assert.deepStrictEqual(st.labels, ['status:claimed']);
}
// free PR: assigned (first assignee reviews), no label
{
  const { r, st } = run({ kind: 'pr' }, '7');
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.deepStrictEqual(st.assignees, ['vikramgorla']);
  assert.deepStrictEqual(st.labels, []);
}
// already mine: no change, exit 0
{
  const { r, st } = run({ assignees: ['vikramgorla'] }, '7');
  assert.strictEqual(r.status, 0);
  assert.ok(!st.log.some((l) => l.includes('POST')), 'no write when already mine');
}
// taken by someone else: refused, nothing written
{
  const { r, st } = run({ assignees: ['fjcabello'] }, '7');
  assert.strictEqual(r.status, 1);
  assert.match(String(r.stderr), /already claimed by fjcabello/);
  assert.deepStrictEqual(st.assignees, ['fjcabello']);
  assert.ok(!st.log.some((l) => l.includes('POST') || l.includes('DELETE')), 'a refused claim writes nothing');
}
// race, the other one was assigned first: I back off and remove only myself, no label from me
{
  const { r, st } = run({ race: { login: 'rubenlupi', when: 'before' } }, '7');
  assert.strictEqual(r.status, 1, String(r.stderr));
  assert.match(String(r.stderr), /went to rubenlupi first/);
  assert.deepStrictEqual(st.assignees, ['rubenlupi']);
  assert.deepStrictEqual(st.labels, [], 'the loser adds no label');
  assert.deepStrictEqual(deletes(st).length, 1);
  assert.ok(deletes(st)[0].includes('assignees[]=vikramgorla'), 'only my own assignment is removed');
}
// race, the other one came after me: I keep the claim, nobody else is touched
{
  const { r, st } = run({ race: { login: 'rubenlupi', when: 'after' } }, '7');
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.ok(st.assignees.includes('vikramgorla') && st.assignees.includes('rubenlupi'), 'the later claimant is left for its own script to back off');
  assert.deepStrictEqual(deletes(st), [], 'the winner removes nothing');
  assert.deepStrictEqual(st.labels, ['status:claimed']);
}
// PR whose author assigned themselves: a reviewer's claim succeeds and the author's assignment is left alone
{
  const { r, st } = run({ kind: 'pr', author: 'fjcabello', assignees: ['fjcabello'] }, '7');
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.deepStrictEqual(st.assignees, ['fjcabello', 'vikramgorla']);
  assert.deepStrictEqual(deletes(st), []);
}
// the author claiming the review of their own PR: refused with a clear message, nothing written
{
  const { r, st } = run({ kind: 'pr', author: 'vikramgorla' }, '7');
  assert.strictEqual(r.status, 1);
  assert.match(String(r.stderr), /you authored #7/);
  assert.ok(!st.log.some((l) => l.includes('POST')));
}
// an issue author's self-assignment IS a claim (the author rule is for PRs only)
assert.strictEqual(run({ author: 'fjcabello', assignees: ['fjcabello'] }, '7').r.status, 1);
// not a number: usage, no gh call at all
for (const bad of ['abc', '7; rm -rf x', '', '-1', '7x', '--release']) {
  const { r, st } = run({}, ...(bad === '' ? [] : [bad]));
  assert.strictEqual(r.status, 2, `refused: ${JSON.stringify(bad)}`);
  assert.strictEqual(st.log.length, 0, 'no gh call on bad input');
}
assert.strictEqual(run({}, '--release', 'x').r.status, 2);
assert.strictEqual(run({}, '7', 'extra').r.status, 2, 'extra arguments are refused');
// gh failure (rate limit): exit 2, no half claim on the first read
{
  const { r, st } = run({ fail: 'issues/7 --jq' }, '7');
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(st.assignees, []);
}
// gh failure on the assignment: exit 2
assert.strictEqual(run({ fail: '/assignees' }, '7').r.status, 2);
// release: mine alone -> unassigned, label removed, comment with the reason
{
  const { r, st } = run({ assignees: ['vikramgorla'], labels: ['status:claimed', 'task'] }, '--release', '7', 'blocked on a decision');
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.deepStrictEqual(st.assignees, []);
  assert.deepStrictEqual(st.labels, ['task']);
  assert.match(st.comments[0], /Released my claim \(vikramgorla\): blocked on a decision/);
}
// release when someone else holds it: refused, nothing removed
{
  const { r, st } = run({ assignees: ['fjcabello'], labels: ['status:claimed'] }, '--release', '7');
  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(st.assignees, ['fjcabello']);
  assert.deepStrictEqual(st.labels, ['status:claimed']);
  assert.ok(!st.log.some((l) => l.includes('DELETE') || l.includes('POST')));
}
// release while a co-assignee remains: the label stays
{
  const { r, st } = run({ assignees: ['vikramgorla', 'fjcabello'], labels: ['status:claimed'] }, '--release', '7');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(st.assignees, ['fjcabello']);
  assert.deepStrictEqual(st.labels, ['status:claimed']);
}
console.log('claim tests passed');
