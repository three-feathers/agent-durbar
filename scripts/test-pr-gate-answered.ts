/*
 * Spec 021 FR-097 (issue #1910): scripts/pr-gate.sh counts an earlier ask by a trusted reviewer R as answered when R's latest review is an
 * APPROVED one submitted later. The rule lives in scripts/pr-gate-answered.awk; this runs it on fixture lines (no network, no clock: the
 * times are fixed text). Mutants of the awk file must die at their own assert message.
 */
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const AWK_FILE = path.join(ROOT, 'scripts', 'pr-gate-answered.awk');
const probe = spawnSync('awk', ['BEGIN{print 1}'], { encoding: 'utf8' });
if (process.platform === 'win32' || probe.status !== 0) {
  console.log('pr-gate answered: no awk here, static checks only');
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prgate-answered-'));
let n = 0;
function run(prog: string, reviews: string[][], asks: string[]): string[] {
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'p.awk'), prog);
  fs.writeFileSync(path.join(dir, 'r.tsv'), reviews.map((r) => r.join('\t')).join('\n') + '\n');
  const out = spawnSync('awk', ['-f', path.join(dir, 'p.awk'), path.join(dir, 'r.tsv'), '-'], { input: asks.join('\n') + '\n', encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  return out.stdout.split('\n').filter(Boolean);
}
const T = (h: number, m = 0) => `2026-11-19T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const cmt = (t: string, who: string) => `${t} comment ${who}: please rename foo`;
const rev = (t: string, st: string, who: string) => `${t} review(${st}) ${who}: needs a fix`;
const line = (t: string, who: string) => `${t} line ${who} src/a.ts: nit`;

function suite(prog: string): void {
  // approved after the comment: answered (all three ask shapes)
  const ok = [['fjcabello', T(9), 'APPROVED']];
  assert.deepStrictEqual(run(prog, ok, [cmt(T(8), 'fjcabello'), line(T(8, 5), 'fjcabello'), rev(T(8, 10), 'CHANGES_REQUESTED', 'fjcabello')]), [], 'approved after: answered');
  // comment after the approval: still unanswered
  const later = [cmt(T(10), 'fjcabello')];
  assert.deepStrictEqual(run(prog, ok, later), later, 'comment after approval: unanswered');
  // changes requested after approval: R's latest state is not APPROVED, so the earlier ask stays too
  const cr = [['fjcabello', T(9), 'APPROVED'], ['fjcabello', T(10), 'CHANGES_REQUESTED']];
  const asks = [cmt(T(8), 'fjcabello')];
  assert.deepStrictEqual(run(prog, cr, asks), asks, 'changes requested after approval: not answered');
  // a dismissed approval-after-nothing: a later DISMISSED is not APPROVED either
  assert.deepStrictEqual(run(prog, [['fjcabello', T(9), 'DISMISSED']], asks), asks, 'dismissed: not answered');
  // another author's later approval does not answer R's comment
  assert.deepStrictEqual(run(prog, [['rubenlupi', T(9), 'APPROVED']], asks), asks, 'another author approval: not answered');
  // an approval is not an answer to an ask posted at the same time or after, by the same time-text compare
  assert.deepStrictEqual(run(prog, ok, [cmt(T(9), 'fjcabello')]), [cmt(T(9), 'fjcabello')], 'same time: unanswered');
  // outsider (no row) and a bot stay listed; a mixed list drops only R's older ask
  const mixed = [cmt(T(8), 'stranger'), cmt(T(8, 1), 'github-actions[bot]'), cmt(T(8, 2), 'rubenlupi'), cmt(T(8, 3), 'fjcabello')];
  assert.deepStrictEqual(run(prog, ok, mixed), mixed.slice(0, 3), "only the approver's own older ask is dropped");
  // no reviews at all
  assert.deepStrictEqual(run(prog, [], asks), asks, 'no reviews: unchanged');
}
const real = fs.readFileSync(AWK_FILE, 'utf8');
suite(real);

// mutants: each must die at its own assert message
const mutants: Array<[string, string, string]> = [
  ['latest state ignored', 'last[who] == "APPROVED" && ', 'changes requested after approval: not answered'],
  ['time compare flipped', '$1 < at[who]', 'approved after: answered'],
  ['time compare dropped', ' && $1 < at[who]', 'comment after approval: unanswered'],
  ['approval credited to the asker', 'last[f[1]] = f[3]; at[f[1]] = f[2];', 'another author approval: not answered'],
  ['author always the approver', 'who = $3;', "only the approver's own older ask is dropped"],
  ['ties count', '$1 < at[who]', 'same time: unanswered'],
];
for (const [name, from, want] of mutants) {
  assert.ok(real.includes(from), `mutant "${name}" applies`);
  const to = name === 'time compare flipped' ? '$1 > at[who]' : name === 'time compare dropped' ? '' : name === 'approval credited to the asker' ? 'last["fjcabello"] = f[3]; at["fjcabello"] = f[2];' : name === 'author always the approver' ? 'who = "fjcabello";' : name === 'ties count' ? '$1 <= at[who]' : '';
  let died = '';
  try { suite(real.replace(from, to)); } catch (e) { died = (e as Error).message; }
  assert.ok(died.includes(want), `mutant "${name}" must die at "${want}", got: ${died || 'survived'}`);
}

// wiring: pr-gate.sh runs the awk on the newer list with the trusted-human reviews
const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'pr-gate.sh'), 'utf8');
assert.ok(gate.includes('pr-gate-answered.awk'), 'pr-gate.sh uses the answered filter');
assert.ok(/newer=\$\(printf '%s\\n' "\$newer" \| awk -f/.test(gate), 'the filter reads the newer list');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('pr-gate answered tests passed');
