/** Parity checklists tick themselves (spec 021 FR-088, T075): `npm run test:paritytick`. Offline, no credits. PT_MODULE swaps the module (mutant runs). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const PT = require(process.env.PT_MODULE ? path.resolve(process.env.PT_MODULE) : path.join(ROOT, 'scripts', 'parity-tick.js'));
const tick = (body: string, n: string | number, state = 'tick') => PT.tickBody(body, n, state) as { body: string; changed: number };

const LIST = [
  '## Real office gaps',
  '',
  '- [ ] #1139 helpers (sub-agents) drawn in the room',
  '- [ ] #11 a short number',
  '- [ ] #114 a longer number with the same start',
  '- [x] #1148 model, tokens, cost',
  '  - [ ] #1150 nested item',
  'See #1139 in prose too.',
].join('\n');

// 1 tick: only #1139's checkbox changes, every other byte stays
{
  const r = tick(LIST, '1139');
  assert.strictEqual(r.changed, 1, 'tick: one line changed');
  assert.strictEqual(r.body, LIST.replace('- [ ] #1139', '- [x] #1139'), 'tick: only the #1139 box is ticked');
}
// 2 untick: a reopened item goes back to [ ]; an uppercase [X] (GitHub renders it ticked) is unticked too
{
  const r = tick(LIST, 1148, 'untick');
  assert.strictEqual(r.body, LIST.replace('- [x] #1148', '- [ ] #1148'), 'untick: #1148 is unticked');
  assert.strictEqual(tick('- [X] #7 big x', 7, 'untick').body, '- [ ] #7 big x', 'untick: uppercase X');
  assert.strictEqual(tick(LIST, 1139, 'untick').changed, 0, 'untick: an open line stays open');
}
// 3 no line: an issue on no checklist changes nothing (the same string comes back)
{
  const r = tick(LIST, 999);
  assert.strictEqual(r.changed, 0, 'no line: nothing changed');
  assert.strictEqual(r.body, LIST, 'no line: same body');
  assert.strictEqual(tick('', 5).body, '', 'no line: empty body');
}
// 4 prefix collision: #11 never touches #114 or #1139, #114 never touches #11; #1 touches none
{
  const r11 = tick(LIST, 11);
  assert.strictEqual(r11.changed, 1, 'prefix: #11 changes one line');
  assert.match(r11.body, /^- \[x\] #11 a short/m, 'prefix: #11 ticked');
  assert.match(r11.body, /^- \[ \] #114 /m, 'prefix: #114 untouched by #11');
  assert.match(r11.body, /^- \[ \] #1139 /m, 'prefix: #1139 untouched by #11');
  const r114 = tick(LIST, 114);
  assert.match(r114.body, /^- \[ \] #11 a short/m, 'prefix: #11 untouched by #114');
  assert.match(r114.body, /^- \[x\] #114 /m, 'prefix: #114 ticked');
  assert.strictEqual(tick(LIST, 1).changed, 0, 'prefix: #1 matches nothing');
  assert.strictEqual(tick('- [ ] #11', 11).body, '- [x] #11', 'prefix: number at the end of the line');
  assert.strictEqual(tick('- [ ] #11, #12 pair', 11).body, '- [x] #11, #12 pair', 'prefix: number followed by punctuation');
}
// 5 nested and only list-checkbox lines: an indented item ticks; prose, quotes, other bullets and later mentions do not
{
  assert.match(tick(LIST, 1150).body, /^  - \[x\] #1150 nested/m, 'nested: indented item ticked');
  for (const other of ['See #1139 in prose', '> - [ ] #1139 quoted', '* [ ] #1139 star bullet', '- [ ] see #1139', '- [ ]  #1139 two spaces', '- [ ] #1139x'.replace('x', '0')]) {
    assert.strictEqual(tick(other, 1139).changed, 0, `only checkbox lines: ${other}`);
  }
}
// 5b lines with more references: only the FIRST #N after the box counts; a closing note line without a box is ignored
{
  const t = '- [ ] #1171 text (PR #1321)\n- [ ] #1172 see #1171 and #1398\n- [ ] #1398 last\n\nUpdated by the coordinator on 2026-11-09: added #1171, #1172, #1398.';
  assert.strictEqual(tick(t, 1321).changed, 0, 'first ref: a PR number later in the line is not the item');
  const r = tick(t, 1171);
  assert.strictEqual(r.changed, 1, 'first ref: #1171 only on its own line');
  assert.strictEqual(r.body, t.replace('- [ ] #1171', '- [x] #1171'), 'first ref: #1172 line mentioning #1171 untouched; note line untouched');
  assert.strictEqual(tick(t, 1398).body, t.replace('- [ ] #1398', '- [x] #1398'), 'first ref: note line mentioning #1398 untouched');
}
// 6 CRLF: line ends kept byte for byte
{
  const crlf = LIST.replace(/\n/g, '\r\n');
  const r = tick(crlf, 1139);
  assert.strictEqual(r.body, crlf.replace('- [ ] #1139', '- [x] #1139'), 'crlf: CRLF kept, box ticked');
  assert.strictEqual((r.body.match(/\r\n/g) || []).length, (crlf.match(/\r\n/g) || []).length, 'crlf: same count of CRLF');
  assert.strictEqual(tick('- [ ] #3\r\n', 3).body, '- [x] #3\r\n', 'crlf: single line');
}
// 7 Unicode: text around and after the number survives (emoji, combining marks, RTL, NBSP)
{
  const u = '# Café ✅\n- [ ] #42 dessinée 🧑🏽‍💻 مرحبا x́\n- [ ] #43 日本語';
  const r = tick(u, 42);
  assert.strictEqual(r.body, u.replace('- [ ] #42', '- [x] #42'), 'unicode: rest of the body kept');
}
// 8 huge body: 65,536 characters (GitHub's limit) and far beyond, linear time, one edit
{
  const filler = Array.from({ length: 40000 }, (_, i) => `- [ ] #${100000 + i} item ${i}`).join('\n');
  const big = filler + '\n- [ ] #7 the one\n' + filler;
  const t0 = Date.now();
  const r = tick(big, 7);
  assert.strictEqual(r.changed, 1, 'huge: one line');
  assert.strictEqual(r.body.length, big.length, 'huge: same length');
  assert.ok(Date.now() - t0 < 2000, 'huge: under 2 s');
}
// 9 code blocks: lines inside ``` or ~~~ fences are never touched; a line after the fence is
{
  const code = ['```', '- [ ] #9 example', '```', '~~~~md', '- [ ] #9 tilde example', '```', '- [ ] #9 still inside tilde', '~~~~', '- [ ] #9 real'].join('\n');
  const r = tick(code, 9);
  assert.strictEqual(r.changed, 1, 'fence: one line changed');
  assert.strictEqual(r.body, code.replace('- [ ] #9 real', '- [x] #9 real'), 'fence: lines inside fences untouched');
  const crlfCode = '```\r\n- [ ] #9 in\r\n```\r\n- [ ] #9 out';
  assert.strictEqual(tick(crlfCode, 9).body, '```\r\n- [ ] #9 in\r\n```\r\n- [x] #9 out', 'fence: CRLF closing fence closes');
  const mixed = '~~~\n````\n- [ ] #9 a backtick run does not close a tilde fence\n~~~\n- [ ] #9 out';
  assert.strictEqual(tick(mixed, 9).body, mixed.replace('- [ ] #9 out', '- [x] #9 out'), 'fence: only the same fence character closes');
  const unclosed = '```\n- [ ] #9 in an unclosed fence';
  assert.strictEqual(tick(unclosed, 9).changed, 0, 'fence: an unclosed fence runs to the end');
}
// 10 idempotent: ticking twice equals ticking once; tick then untick gives the original back
{
  const once = tick(LIST, 1139).body;
  const twice = tick(once, 1139);
  assert.strictEqual(twice.changed, 0, 'idempotent: second tick changes nothing');
  assert.strictEqual(twice.body, once, 'idempotent: same body');
  assert.strictEqual(tick(once, 1139, 'untick').body, LIST, 'idempotent: untick restores');
}
// 11 several lines for one issue (listed twice): each line outside fences is ticked
{
  assert.strictEqual(tick('- [ ] #5 a\n- [ ] #5 b', 5).changed, 2, 'twice: both lines');
}
// 12 input validation: the number is digits only (1 to 9, no leading zero, no regex or shell text); the state is fixed
{
  for (const bad of ['', '0', '07', '-1', '1e3', '12a', '1 ', '1\n', '.*', '1|2', '$(id)', '1234567890']) {
    assert.throws(() => tick(LIST, bad), /issue number/, `validate: number ${JSON.stringify(bad)} refused`);
  }
  assert.throws(() => tick(LIST, 1139, 'toggle'), /state/, 'validate: unknown state refused');
  assert.throws(() => PT.tickBody(null, 1, 'tick'), /body/, 'validate: body must be a string');
}
// 13 the event mapping: only closed-as-completed ticks; reopened unticks; not planned, duplicate, unknown do nothing
{
  assert.strictEqual(PT.stateFor('closed', 'completed'), 'tick', 'event: completed ticks');
  assert.strictEqual(PT.stateFor('reopened', ''), 'untick', 'event: reopened unticks');
  for (const [a, r] of [['closed', 'not_planned'], ['closed', 'duplicate'], ['closed', ''], ['edited', 'completed'], ['labeled', '']]) {
    assert.strictEqual(PT.stateFor(a, r), null, `event: ${a}/${r || 'none'} does nothing`);
  }
}
// 13b main(): the trust gates and the GitHub calls, with a fake gh (no network, no shell); the real trusted-authors.txt and trackers file
{
  type Call = { args: string[]; input?: string };
  const run = (env: Record<string, string>, trackers: Record<string, { login: string; body: string | null }>) => {
    const calls: Call[] = [];
    const fake = (args: string[], input?: string) => {
      calls.push({ args, input });
      const t = /issues\/([0-9]+)$/.exec(args[args.length - 1] === '-' ? args[3] : args[1]);
      const tr = t && trackers[t[1]];
      return args.includes('PATCH') ? '{}' : JSON.stringify({ user: { login: tr ? tr.login : 'vikramgorla' }, body: tr ? tr.body : '' });
    };
    const log = console.log; console.log = () => {};
    try { PT.main({ GITHUB_REPOSITORY: 'three-feathers/agent-durbar', EVENT_ACTION: 'closed', STATE_REASON: 'completed', ISSUE_AUTHOR: 'vikramgorla', ACTOR: 'vikramgorla', ...env }, ROOT, fake); } finally { console.log = log; }
    return { reads: calls.filter((c) => !c.args.includes('PATCH')), patches: calls.filter((c) => c.args.includes('PATCH')) };
  };
  const both = { 1147: { login: 'vikramgorla', body: '- [ ] #1139 helpers\n- [ ] #11 x' }, 1404: { login: 'vikramgorla', body: '- [ ] #5 other' } };
  let r = run({ ISSUE_NUMBER: '1139' }, both);
  assert.deepStrictEqual(r.reads.map((c) => c.args[1]), ['repos/three-feathers/agent-durbar/issues/1147', 'repos/three-feathers/agent-durbar/issues/1404'], 'main: reads each tracker');
  assert.strictEqual(r.patches.length, 1, 'main: one edit, only the tracker that lists #1139');
  assert.deepStrictEqual(r.patches[0].args, ['api', '-X', 'PATCH', 'repos/three-feathers/agent-durbar/issues/1147', '--input', '-'], 'main: PATCH of #1147 with the body on stdin');
  assert.deepStrictEqual(JSON.parse(r.patches[0].input || '{}'), { body: '- [x] #1139 helpers\n- [ ] #11 x' }, 'main: the edited body');
  r = run({ ISSUE_NUMBER: '1139', ISSUE_AUTHOR: 'outsider', ACTOR: 'outsider' }, both);
  assert.strictEqual(r.reads.length + r.patches.length, 0, 'main: an outsider closing their own issue does nothing');
  r = run({ ISSUE_NUMBER: '1139', ISSUE_AUTHOR: 'outsider', ACTOR: 'fjcabello' }, both);
  assert.strictEqual(r.patches.length, 1, 'main: a trusted actor closing an outsider-authored listed issue ticks');
  r = run({ ISSUE_NUMBER: '1139', ISSUE_AUTHOR: 'vikramgorla[bot]x', ACTOR: 'a b' }, both);
  assert.strictEqual(r.patches.length, 0, 'main: malformed logins are not trusted');
  r = run({ ISSUE_NUMBER: '1139' }, { 1147: { login: 'outsider', body: '- [ ] #1139 helpers' }, 1404: { login: 'vikramgorla', body: null } });
  assert.strictEqual(r.patches.length, 0, 'main: a tracker not opened by a trusted account is never edited; a null body is no line');
  r = run({ ISSUE_NUMBER: '1139', STATE_REASON: 'not_planned' }, both);
  assert.strictEqual(r.reads.length, 0, 'main: closed as not planned reads nothing');
  assert.doesNotThrow(() => { r = run({ ISSUE_NUMBER: '1139; rm -rf /' }, both); }, 'main: a non-digit number does nothing');
  assert.strictEqual(r.reads.length, 0, 'main: a non-digit number reads nothing');
  r = run({ ISSUE_NUMBER: '1139', GITHUB_REPOSITORY: 'a/b/../c' }, both);
  assert.strictEqual(r.reads.length, 0, 'main: a bad repository name does nothing');
  r = run({ ISSUE_NUMBER: '1139', EVENT_ACTION: 'reopened', STATE_REASON: 'reopened' }, { 1147: { login: 'vikramgorla', body: '- [x] #1139 helpers' }, 1404: { login: 'rubenlupi', body: '' } });
  assert.deepStrictEqual(JSON.parse(r.patches[0].input || '{}'), { body: '- [ ] #1139 helpers' }, 'main: reopened unticks');
}
// 14 the workflow's shape: issues closed/reopened only, minimal permissions, pinned checkout without credentials, no PR code,
// event values only through env (never `${{ }}` inside `run:`), no title/body/label, the trackers file holds only numbers
{
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'parity-tick.yml'), 'utf8').replace(/\r\n/g, '\n');
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /^on:\n  issues:\n    types: \[closed, reopened\]\n\n/m, 'workflow: only issues closed/reopened');
  assert.doesNotMatch(code, /pull_request_target|workflow_run|pull_request:/, 'workflow: no PR trigger');
  assert.match(code, /^permissions:\n  issues: write\n  contents: read\n\n/m, 'workflow: issues write, contents read, nothing else');
  assert.strictEqual((code.match(/permissions:/g) || []).length, 1, 'workflow: no job-level permissions');
  assert.match(code, /concurrency:\n  group: parity-tick\n  cancel-in-progress: false/, 'workflow: serialised');
  assert.match(code, /if: \$\{\{ !github\.event\.issue\.pull_request \}\}/, 'workflow: skips pull requests');
  assert.match(code, /uses: actions\/checkout@[0-9a-f]{40} #/, 'workflow: checkout pinned by sha');
  assert.match(code, /persist-credentials: false/, 'workflow: no credentials left in the checkout');
  assert.doesNotMatch(code, /^\s+ref:/m, 'workflow: checks out the default branch only');
  const uses = code.match(/uses: [^\s]+/g) || [];
  assert.deepStrictEqual(uses.map((u) => u.split('@')[0]), ['uses: actions/checkout'], 'workflow: no other action');
  const runs = code.match(/run: [^\n]*/g) || [];
  assert.deepStrictEqual(runs, ['run: node scripts/parity-tick.js'], 'workflow: one run line, no expression in it');
  assert.doesNotMatch(code, /\.(title|body|labels?)\b/, 'workflow: no title, body or label of the event');
  assert.doesNotMatch(code, /secrets\./, 'workflow: no secret');
  const trackers = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'parity-trackers.json'), 'utf8'));
  assert.ok(Array.isArray(trackers.trackers) && trackers.trackers.length > 0, 'trackers: a list');
  for (const t of trackers.trackers) assert.ok(Number.isInteger(t) && t > 0, `trackers: ${t} is an issue number`);
  assert.deepStrictEqual(trackers.trackers, [1147, 1404], 'trackers: #1147 Real office gaps and #1404 Retro arcade checklist');
}

console.log('test-parity-tick: ok');
