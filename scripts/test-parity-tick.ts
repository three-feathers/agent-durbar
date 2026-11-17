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
// 13 the desired state from an issue's live REST object: closed as completed by or for a trusted account ticks; open unticks;
// not planned, duplicate, no reason, a pull request, an outsider closing their own issue: leave the line as it is
{
  const T = (l: unknown) => l === 'vikramgorla' || l === 'fjcabello';
  const ds = (o: unknown) => PT.desiredState(o, T);
  const me = { login: 'vikramgorla' };
  const out = { login: 'outsider' };
  assert.strictEqual(ds({ state: 'closed', state_reason: 'completed', user: me, closed_by: me }), 'tick', 'state: completed ticks');
  assert.strictEqual(ds({ state: 'open', state_reason: 'reopened', user: me }), 'untick', 'state: open unticks');
  assert.strictEqual(ds({ state: 'open', state_reason: null, user: out }), 'untick', 'state: an open outsider issue unticks (the truth)');
  for (const r of ['not_planned', 'duplicate', null, 'reopened']) {
    assert.strictEqual(ds({ state: 'closed', state_reason: r, user: me, closed_by: me }), null, `state: closed as ${r} stays as is`);
  }
  assert.strictEqual(ds({ state: 'closed', state_reason: 'completed', user: out, closed_by: out }), null, 'state: an outsider closing their own issue ticks nothing');
  assert.strictEqual(ds({ state: 'closed', state_reason: 'completed', user: out, closed_by: { login: 'fjcabello' } }), 'tick', 'state: closed by a trusted account ticks');
  assert.strictEqual(ds({ state: 'closed', state_reason: 'completed', user: me, closed_by: null }), 'tick', 'state: a trusted author with no closer ticks');
  assert.strictEqual(ds({ state: 'closed', state_reason: 'completed', user: me, pull_request: {} }), null, 'state: a pull request is no item');
  assert.strictEqual(ds(null), null, 'state: nothing read');
  assert.deepStrictEqual(PT.itemNumbers('- [ ] #5 a (PR #9)\n- [x] #6 b\n```\n- [ ] #7 code\n```\n- [ ] #5 again\n- [ ] #0 zero\nUpdated: #8'), ['5', '6'], 'items: first #M of checkbox lines outside fences, once each');
}
// 13b main(): reconciles every line of every tracker with the live states, through a fake gh (no network, no shell);
// the real trusted-authors.txt and trackers file
{
  type Call = { args: string[]; input?: string };
  type Iss = { state: string; state_reason?: string | null; user?: { login: string }; closed_by?: { login: string } | null; pull_request?: object; body?: string | null } | 'fail';
  const me = { login: 'vikramgorla' };
  const run = (issues: Record<string, Iss>, env: Record<string, string> = {}) => {
    const calls: Call[] = [];
    const fake = (args: string[], input?: string) => {
      calls.push({ args, input });
      if (args.includes('PATCH')) { const t = /issues\/([0-9]+)$/.exec(args[3]); const i = t && issues[t[1]]; if (i && i !== 'fail') i.body = JSON.parse(input || '{}').body; return '{}'; }
      const m = /issues\/([0-9]+)$/.exec(args[1]);
      const i = m && issues[m[1]];
      if (!i || i === 'fail') throw new Error('HTTP 404');
      return JSON.stringify(i);
    };
    const log = console.log; console.log = () => {};
    let code: number;
    try { code = PT.main({ GITHUB_REPOSITORY: 'three-feathers/agent-durbar', ...env }, ROOT, fake); } finally { console.log = log; }
    const reads = calls.filter((c) => !c.args.includes('PATCH'));
    return { code, reads, patches: calls.filter((c) => c.args.includes('PATCH')), readCount: (n: string) => reads.filter((c) => c.args[1].endsWith('/issues/' + n)).length };
  };
  const done = (u = me) => ({ state: 'closed', state_reason: 'completed', user: u, closed_by: me });
  const open = () => ({ state: 'open', state_reason: null, user: me });
  const world = (): Record<string, Iss> => ({
    1147: { state: 'open', user: me, body: '- [ ] #1152 drag\n- [ ] #1154 crews\n- [ ] #1171 text (PR #1321)\n- [x] #1146 reading\n- [ ] #1200 dropped\n\nUpdated by the coordinator: #1152' },
    1404: { state: 'open', user: me, body: '- [ ] #1154 crews\n- [ ] #1500 arcade' },
    1152: done(), 1154: done(), 1171: done(), 1146: open(), 1200: { state: 'closed', state_reason: 'not_planned', user: me, closed_by: me }, 1500: open(), 1321: done(),
  });
  // three closes land within seconds; GitHub cancels the middle pending run: the one run left reconciles all three
  let w = world();
  let r = run(w);
  assert.strictEqual(r.code, 0, 'main: exit 0');
  assert.strictEqual((w[1147] as { body: string }).body, '- [x] #1152 drag\n- [x] #1154 crews\n- [x] #1171 text (PR #1321)\n- [ ] #1146 reading\n- [ ] #1200 dropped\n\nUpdated by the coordinator: #1152', 'main: three closes ticked, reopened unticked, not planned and the note line as they were');
  assert.strictEqual((w[1404] as { body: string }).body, '- [x] #1154 crews\n- [ ] #1500 arcade', 'main: the second tracker reconciled too');
  assert.strictEqual(r.patches.length, 2, 'main: one edit per changed tracker');
  assert.deepStrictEqual(r.patches[0].args, ['api', '-X', 'PATCH', 'repos/three-feathers/agent-durbar/issues/1147', '--input', '-'], 'main: PATCH with the body on stdin');
  assert.strictEqual(r.readCount('1154'), 1, 'main: an issue on both trackers is looked up once');
  assert.strictEqual(r.readCount('1321'), 0, 'main: a later #N on a line is not looked up');
  // a second run (or the run after a cancelled one) finds nothing to do and writes nothing
  r = run(w);
  assert.strictEqual(r.patches.length, 0, 'main: idempotent, no edit when the trackers match');
  // a cancelled run: its close is still done by a run started for another reason (by hand, the daily backstop)
  w = world(); (w[1152] as { state: string }).state = 'open';
  run(w); (w[1152] as { state: string; state_reason: string }).state = 'closed'; (w[1152] as { state_reason: string }).state_reason = 'completed';
  run(w);
  assert.match((w[1147] as { body: string }).body, /^- \[x\] #1152 drag/m, 'main: a close whose run was cancelled is ticked by the next run');
  // an outsider closing their own listed issue ticks nothing; an untrusted tracker is never edited
  w = world(); w[1171] = { state: 'closed', state_reason: 'completed', user: { login: 'outsider' }, closed_by: { login: 'outsider' } };
  w[1404] = { state: 'open', user: { login: 'outsider' }, body: '- [ ] #1154 crews' };
  r = run(w);
  assert.match((w[1147] as { body: string }).body, /^- \[ \] #1171 /m, 'main: an outsider closing their own issue ticks nothing');
  assert.strictEqual((w[1404] as { body: string }).body, '- [ ] #1154 crews', 'main: a tracker not opened by a trusted account is never edited');
  assert.strictEqual(r.patches.length, 1, 'main: only the trusted tracker is edited');
  // a failed lookup leaves that line, does the rest, and turns the run red
  w = world(); w[1154] = 'fail';
  r = run(w);
  assert.strictEqual(r.code, 1, 'main: a failed lookup makes the run red');
  assert.match((w[1147] as { body: string }).body, /^- \[ \] #1154 crews\n- \[x\] #1171/m, 'main: a failed lookup leaves its line and does the others');
  w = world(); w[1147] = 'fail';
  r = run(w);
  assert.strictEqual(r.code, 1, 'main: a tracker that cannot be read makes the run red');
  assert.strictEqual((w[1404] as { body: string }).body, '- [x] #1154 crews\n- [ ] #1500 arcade', 'main: the next tracker is still reconciled');
  // fail closed (F3): a missing, comment-only or empty trusted list means nobody is trusted: no call at all, exit 0 with a notice
  {
    const os = require('os');
    for (const [label, text] of [['missing', null], ['empty', ''], ['comments only', '# vikramgorla\n  # fjcabello\n'], ['bad shapes only', 'vikram gorla\n<script>\n']] as [string, string | null][]) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pt-'));
      fs.mkdirSync(path.join(tmp, 'scripts')); fs.mkdirSync(path.join(tmp, '.github'));
      fs.copyFileSync(path.join(ROOT, 'scripts', 'trusted-authors.js'), path.join(tmp, 'scripts', 'trusted-authors.js'));
      fs.copyFileSync(path.join(ROOT, '.github', 'parity-trackers.json'), path.join(tmp, '.github', 'parity-trackers.json'));
      if (text !== null) fs.writeFileSync(path.join(tmp, 'scripts', 'trusted-authors.txt'), text);
      const calls: string[][] = [];
      const log = console.log; const said: string[] = []; console.log = (m: string) => { said.push(m); };
      let code = -1;
      try { assert.doesNotThrow(() => { code = PT.main({ GITHUB_REPOSITORY: 'three-feathers/agent-durbar' }, tmp, (a: string[]) => { calls.push(a); return JSON.stringify({ state: 'open', user: me, body: '- [x] #1 a' }); }); }, `fail closed: ${label} trusted list does not throw`); } finally { console.log = log; }
      assert.strictEqual(calls.length, 0, `fail closed: ${label} trusted list makes no call`);
      assert.strictEqual(code, 0, `fail closed: ${label} trusted list exits 0`);
      assert.ok(said.some((m) => /no trusted accounts/.test(m)), `fail closed: ${label} trusted list says why`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    const TA = require(path.join(ROOT, 'scripts', 'trusted-authors.js'));
    assert.deepStrictEqual(TA.parseTrusted('# c\r\nvikramgorla\r\n  # x\n github-actions[bot]\nfoo bar\ngithub-actions[bot]x\nrubenlupi\n'), ['vikramgorla', 'rubenlupi'], 'parser: as trusted-lib.sh (comments, CR, exact shapes)');
  }
  // a bad repository name does nothing
  r = run(world(), { GITHUB_REPOSITORY: 'a/b/../c' });
  assert.strictEqual(r.reads.length, 0, 'main: a bad repository name does nothing');
  assert.strictEqual(r.code, 1, 'main: a bad repository name is red');
}
// 14 the workflow's shape: issues closed/reopened, by hand and daily; minimal permissions; pinned checkout without credentials;
// no PR code; event values only in the job `if:` (outsider self-close skip), none in env or `run:`; the trackers file holds only numbers
{
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'parity-tick.yml'), 'utf8').replace(/\r\n/g, '\n');
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /^on:\n  issues:\n    types: \[closed, reopened\]\n  workflow_dispatch:\n  schedule:\n    - cron: '[0-9]+ [0-9]+ \* \* \*'\n\n/m, 'workflow: issues closed/reopened, by hand, daily');
  assert.doesNotMatch(code, /workflow_dispatch:\n    inputs:/, 'workflow: no dispatch inputs');
  assert.doesNotMatch(code, /pull_request_target|workflow_run|pull_request:/, 'workflow: no PR trigger');
  assert.match(code, /^permissions:\n  issues: write\n  contents: read\n\n/m, 'workflow: issues write, contents read, nothing else');
  assert.strictEqual((code.match(/permissions:/g) || []).length, 1, 'workflow: no job-level permissions');
  assert.match(code, /concurrency:\n  group: parity-tick\n  cancel-in-progress: false/, 'workflow: serialised');
  assert.match(code, /uses: actions\/checkout@[0-9a-f]{40} #/, 'workflow: checkout pinned by sha');
  assert.match(code, /persist-credentials: false/, 'workflow: no credentials left in the checkout');
  assert.doesNotMatch(code, /^\s+ref:/m, 'workflow: checks out the default branch only');
  const uses = code.match(/uses: [^\s]+/g) || [];
  assert.deepStrictEqual(uses.map((u) => u.split('@')[0]), ['uses: actions/checkout'], 'workflow: no other action');
  const runs = code.match(/run: [^\n]*/g) || [];
  assert.deepStrictEqual(runs, ['run: node scripts/parity-tick.js'], 'workflow: one run line, no expression in it');
  const IF = "    if: github.event_name != 'issues' || contains(fromJSON('[\"OWNER\",\"MEMBER\",\"COLLABORATOR\"]'), github.event.issue.author_association) || github.event.sender.login != github.event.issue.user.login";
  assert.ok(code.split('\n').includes(IF), 'workflow: job if skips only an outsider closing or reopening their own issue; schedule and dispatch always run');
  assert.doesNotMatch(code.split('\n').filter((l) => l !== IF).join('\n'), /github\.event/, 'workflow: no value of the event outside the job if');
  const env = (code.match(/        env:\n((?:          [A-Z_]+: [^\n]*\n)+)/) || [])[1] || '';
  assert.deepStrictEqual(env.trim().split('\n').map((l) => l.trim().split(':')[0]), ['GH_TOKEN', 'GITHUB_REPOSITORY'], 'workflow: env holds only the token and the repository');
  assert.doesNotMatch(code, /secrets\./, 'workflow: no secret');
  const trackers = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'parity-trackers.json'), 'utf8'));
  assert.ok(Array.isArray(trackers.trackers) && trackers.trackers.length > 0, 'trackers: a list');
  for (const t of trackers.trackers) assert.ok(Number.isInteger(t) && t > 0, `trackers: ${t} is an issue number`);
  assert.deepStrictEqual(trackers.trackers, [1147, 1404], 'trackers: #1147 Real office gaps and #1404 Retro arcade checklist');
}

console.log('test-parity-tick: ok');
