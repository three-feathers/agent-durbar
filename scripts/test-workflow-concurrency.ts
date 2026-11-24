/**
 * Guard (spec 117 FR-010, T004): every workflow triggered by `pull_request` has a top-level concurrency group keyed on the PR number and
 * cancels a superseded run on pull_request. Read by lines (no YAML dependency); a comment never counts as a trigger.
 * No git, no network, no Electron. Mutants run on copies of ui-platforms.yml and each must fail at its own labelled assert.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

/** The text with comments and blank lines removed (a `#` starts a comment when at line start or after a blank). */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).filter((l) => l.trim() !== '');
}
/** The lines of a top-level block (`name:` at column 0), up to the next column-0 key. */
function topBlock(ls: string[], name: string): string[] | null {
  const i = ls.findIndex((l) => l.startsWith(name + ':'));
  if (i < 0) return null;
  const out = [ls[i]];
  for (let j = i + 1; j < ls.length && /^\s/.test(ls[j]); j++) out.push(ls[j]);
  return out;
}
export function prTriggered(text: string): boolean {
  const on = topBlock(lines(text), 'on');
  return !!on && on.some((l) => /^\s+pull_request\s*:/.test(l) || /^on:\s*\[?.*\bpull_request\b/.test(l));
}
/** What is wrong with a PR-triggered workflow's concurrency, as short labels (empty = fine). */
export function concurrencyProblems(text: string): string[] {
  const c = topBlock(lines(text), 'concurrency');
  if (!c) return ['no top-level concurrency block'];
  const bad: string[] = [];
  const group = c.find((l) => /^\s+group\s*:/.test(l));
  if (!group || !group.includes('github.event.pull_request.number')) bad.push('group is not keyed on github.event.pull_request.number');
  const cancel = c.find((l) => /^\s+cancel-in-progress\s*:/.test(l));
  const v = cancel ? cancel.replace(/^\s+cancel-in-progress\s*:\s*/, '').trim() : '';
  if (!(v === 'true' || (/\$\{\{/.test(v) && v.includes("github.event_name == 'pull_request'")))) bad.push('cancel-in-progress is not true on pull_request');
  return bad;
}

const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const read = (f: string): string => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const prFiles = files.filter((f) => prTriggered(read(f)));
assert.ok(prFiles.length >= 8, `the guard sees the pull_request workflows (found ${prFiles.length})`);
for (const never of ['e2e-real.yml', 'mcp-oauth-real.yml']) assert.ok(!prFiles.includes(never), `${never} says "never on pull_request" in a comment only: not a trigger`);
for (const f of prFiles) assert.deepStrictEqual(concurrencyProblems(read(f)), [], `${f}: PR-triggered workflow needs a PR-number concurrency group that cancels on pull_request`);

// mutants on ui-platforms.yml: each must be seen
const base = read('ui-platforms.yml');
assert.ok(prFiles.includes('ui-platforms.yml'), 'ui-platforms.yml is PR-triggered');
const swap = (from: string, to: string): string => { assert.strictEqual(base.split(from).length - 1, 1, `mutant anchor once: ${from}`); return base.replace(from, () => to); };
// spec 117 FR-014 / O3 (T010, #2039): main pushes share 'ui-main'; the PR part of the group and the cancel are unchanged
const grp = "${{ github.workflow }}-${{ github.event_name == 'push' && 'ui-main' || github.event.pull_request.number || github.run_id }}";
const cancelLine = "cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'push' }}";
const mutants: Record<string, string> = {
  'group without the PR number': swap(`group: ${grp}`, 'group: ${{ github.workflow }}-${{ github.ref }}'),
  'cancel-in-progress false': swap(cancelLine, 'cancel-in-progress: false'),
  'cancel-in-progress not tied to pull_request': swap(cancelLine, "cancel-in-progress: ${{ github.event_name == 'push' }}"),
  'no concurrency block': base.replace(/\nconcurrency:[\s\S]*?\n(?=\S)/, '\n'),
};
assert.notStrictEqual(mutants['no concurrency block'], base, 'the block-removal mutant changed the file');
for (const [name, text] of Object.entries(mutants)) assert.ok(prTriggered(text) && concurrencyProblems(text).length > 0, `mutant is caught: ${name}`);
// the same mutants on a CRLF copy (Windows checkouts): the guard must read it the same way and still catch them
for (const [name, text] of Object.entries(mutants)) assert.ok(concurrencyProblems(text.replace(/\n/g, '\r\n')).length > 0, `CRLF mutant is caught: ${name}`);
assert.deepStrictEqual(concurrencyProblems(base.replace(/\n/g, '\r\n')), [], 'the CRLF copy of ui-platforms.yml passes');
// fast-lane.yml (spec 117 FR-010, PR-number group) is covered by the loop above and must stay in it; its own mutant is caught too
assert.ok(prFiles.includes('fast-lane.yml'), 'fast-lane.yml is PR-triggered and checked');
const fast = read('fast-lane.yml');
assert.ok(concurrencyProblems(fast.replace(/cancel-in-progress:.*\n/, 'cancel-in-progress: false\n')).length > 0, 'mutant is caught: fast-lane.yml cancel-in-progress false');
assert.ok(concurrencyProblems(fast.replace(/group:.*\n/, 'group: ${{ github.workflow }}\n')).length > 0, 'mutant is caught: fast-lane.yml group without the PR number');
// a comment line naming pull_request is not a trigger
assert.ok(!prTriggered('# on pull_request\non:\n  workflow_dispatch:\n'), 'a comment is not a trigger');
assert.ok(prTriggered('on:\n  pull_request:\n    types: [opened]\n'), 'a pull_request key is a trigger');
console.log(`[workflow-concurrency] ok: ${prFiles.length} PR workflows, 4 mutants caught (LF and CRLF), fast-lane covered`);
