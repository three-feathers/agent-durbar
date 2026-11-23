/** Brain view state (spec 106 T003, FR-001..FR-008, FR-012, FR-020, FR-022, FR-040..FR-042, FR-123): `npm run test:brainstate`. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as R from '../src/shared/redact';
import { costDetail, exportText, formatStep, officeLine, sentenceFor } from '../src/shared/brainsurface';
import { BrainMask, BrainState, FRAME_MS, GLYPHS, HISTORY_MAX, PAINT_MS, REVEAL_ORDER, STEP_CAP, TRAIL_MAX, baseName, brainState, currentStep, glyphOf, initBrain, loopText, markPainted, brainMaskText, programOf, revealStages, sentenceOf, shouldPaint, trailOf, usedLobes } from '../src/shared/brainstate';

// the app's own usage units (spec 011 `usagetotals.js`, spec 052 `costtable.js`), as the page passes them next to redact's functions
const USAGE = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'usagetotals.js'));
const COST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'costtable.js'));
const mask: BrainMask = { ...R, units: { validNano: USAGE.validNano, AIU_USD: COST.AIU_USD, money: COST.money, creditsWord: 'AIU', estimateWord: 'Claude (est.)' } }; // redact.ts's own functions
const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
let clock = 1_000_000;
let id = 0;
const start = (tool: string, args?: unknown, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', callId: 'c' + ++id, phase: 'start', tool, args, ...extra });
const finish = (st: { callId: string; tool: string }, phase = 'complete', extra: Record<string, unknown> = {}) => ({ type: 'toolCall', callId: st.callId, tool: st.tool, phase, ...extra });
function feed(s: BrainState, evs: unknown[], step = 10): BrainState {
  for (const e of evs) { clock += step; s = brainState(s, e, clock, mask); }
  return s;
}
const fresh = (name = 'Ada') => initBrain(name, mask);
function call(s: BrainState, tool: string, args?: unknown, phase = 'complete', extra: Record<string, unknown> = {}): BrainState {
  const st = start(tool, args, extra);
  return feed(s, [st, finish(st, phase, extra.mcpServer ? { mcpServer: extra.mcpServer } : {})]);
}

// ---- FR-012: the glyph table (every tool name the simulator, the fake adapter and the adapters' fixtures produce)
const EXPECT: Record<string, string> = {
  bash: 'shell', shell: 'shell', Bash: 'shell', powershell: 'shell', read_bash: 'shell', stop_bash: 'shell', list_bash: 'shell',
  view: 'read', grep: 'read', glob: 'read', Glob: 'read', Grep: 'read', read_file: 'read', Read: 'read', ls: 'read', rg: 'read', search: 'read',
  Edit: 'edit', edit: 'edit', Write: 'edit', write: 'edit', edit_file: 'edit', apply_patch: 'edit', create: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  web_fetch: 'web', WebFetch: 'web', webSearch: 'web', web_search: 'web',
  think: 'think', ask_user: 'you',
  task: 'shell', Task: 'shell', Agent: 'shell', spawn_agent: 'shell', read_agent: 'shell', write_agent: 'shell', wait: 'shell', skill: 'shell', sql: 'shell', echo: 'shell', unknown: 'shell',
};
const OTHER = new Set(['task', 'Task', 'Agent', 'spawn_agent', 'read_agent', 'write_agent', 'wait', 'skill', 'sql', 'echo', 'unknown']);
for (const [name, g] of Object.entries(EXPECT)) {
  const r = glyphOf(name);
  assert.strictEqual(r.glyph, g, `glyph of ${name}`);
  assert.strictEqual(r.other, OTHER.has(name), `${name} is "Other tool" only when unknown`);
}
assert.strictEqual(glyphOf('anything', 'github').glyph, 'mcp', 'a call with mcpServer is MCP whatever its name');
assert.strictEqual(glyphOf('read_agent').glyph, 'shell', 'no guessing from a part of a name: read_agent is no file read');
for (const bad of [undefined, null, 5, {}, '', '__proto__', 'constructor', 'toString']) assert.strictEqual(glyphOf(bad).other, true, `junk name ${String(bad)} is Other tool`);
assert.deepStrictEqual(Object.keys(GLYPHS), ['think', 'read', 'edit', 'shell', 'web', 'mcp', 'you'], 'seven glyphs');
// every tool name in the fixtures is decided in EXPECT (a new fixture name forces a decision here)
function sweep(o: unknown, out: Set<string>): void {
  if (Array.isArray(o)) o.forEach((x) => sweep(x, out));
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (r.type === 'tool_use' && typeof r.name === 'string') out.add(r.name);
    if (r.type === 'toolCall' && typeof r.tool === 'string') out.add(r.tool);
    Object.values(r).forEach((x) => sweep(x, out));
  }
}
const names = new Set<string>();
const fixDir = path.join(__dirname, '..', '..', 'scripts', 'fixtures');
for (const d of ['claude', 'codex', 'events']) for (const f of fs.readdirSync(path.join(fixDir, d))) if (f.endsWith('.json')) { try { sweep(JSON.parse(fs.readFileSync(path.join(fixDir, d, f), 'utf8')), names); } catch { /* not an event file */ } }
let swept = 0;
for (const n of names) { if (/^mcp__|\./.test(n)) continue; swept++; assert.ok(n in EXPECT, `fixture tool name "${n}" has no expected glyph in this test`); }
assert.ok(swept >= 6, 'the fixture sweep found the adapters\' tool names');

// ---- FR-001: pure, never throws, ignores junk
let s = fresh();
assert.strictEqual(s.sentence, 'Ada is waiting for the first step', 'no events yet');
const frozen = JSON.stringify(s);
for (const junk of [null, undefined, 5, 'x', [], {}, { type: 5 }, { type: 'nope' }, { type: 'toolCall' }, { type: 'toolCall', phase: 'start', tool: { a: 1 }, args: { command: { x: 1 } } }]) s = brainState(s, junk, clock, mask);
assert.ok(s.stepsTotal === 0, 'junk starts no step');
assert.strictEqual(brainState(s, { type: 'user' }, NaN, mask), s, 'a bad clock changes nothing');
const before = fresh();
const j = JSON.stringify(before);
brainState(before, { type: 'user' }, 5, mask);
assert.strictEqual(JSON.stringify(before), j, 'prev is never mutated');
assert.strictEqual(frozen, JSON.stringify(fresh()), 'initBrain is deterministic');
const throwing = { ...mask, redact: () => { throw new Error('boom'); } };
assert.doesNotThrow(() => brainState(fresh(), { type: 'toolCall', phase: 'start', tool: 'bash', callId: 'x', args: { command: 'ls' } }, 1, throwing as never));
const failClosed = brainState(brainState(fresh(), { type: 'user' }, 1, throwing as never), { type: 'toolCall', phase: 'start', tool: 'bash', callId: 'x', args: { command: 'echo ' + GH } }, 2, throwing as never);
assert.ok(!JSON.stringify(failClosed).includes(GH), 'a failing mask never lets raw text into the state');
const noMask = brainState(fresh(), { type: 'toolCall', phase: 'start', tool: 'bash', callId: 'x', args: { command: 'echo ' + GH } }, 2, {} as never);
assert.ok(!JSON.stringify(noMask).includes(GH), 'a missing mask never lets raw text into the state');

// ---- FR-005: turns
s = fresh();
s = feed(s, [{ type: 'user', text: 'go' }]);
assert.strictEqual(s.turn!.n, 1); assert.strictEqual(s.turn!.endedAt, null);
const t1 = start('view', { path: '/p/a.ts' });
s = feed(s, [t1, finish(t1)]);
assert.strictEqual(s.turn!.steps.length, 1);
s = feed(s, [{ type: 'status', status: 'idle' }]);
assert.strictEqual(s.turn!.result, 'done'); assert.notStrictEqual(s.turn!.endedAt, null);
assert.strictEqual(s.history.length, 1); assert.strictEqual(s.history[0].steps, 1); assert.deepStrictEqual(s.history[0].glyphs, ['read']);
// late events join the ended turn, never start one
const late = start('bash', { command: 'ls' });
s = feed(s, [late, finish(late)]);
assert.strictEqual(s.turnNo, 1, 'a late event starts no turn');
assert.strictEqual(s.turn!.steps.length, 2, 'it joined the ended turn'); assert.strictEqual(s.turn!.late, 2, 'late events are counted on the ended turn');
assert.strictEqual(s.counts.shell, 1, 'and is counted');
assert.strictEqual(s.act.kind, 'rest', 'and does not light the ended brain');
// a user message starts the next turn; a working status after an ended turn does too (scheduled prompt)
s = feed(s, [{ type: 'user', text: 'again' }]);
assert.strictEqual(s.turn!.n, 2); assert.strictEqual(s.turn!.steps.length, 0);
s = feed(s, [{ type: 'status', status: 'error' }]);
assert.strictEqual(s.turn!.result, 'error');
s = feed(s, [{ type: 'status', status: 'working' }]);
assert.strictEqual(s.turn!.n, 3, 'a scheduled turn has no user event');
s = feed(s, [{ type: 'status', status: 'stopped' }]);
assert.strictEqual(s.turn!.result, 'stopped');
s = feed(s, [{ type: 'user' }, { type: 'user' }]);
assert.strictEqual(s.history[s.history.length - 1].result, 'stopped', 'a new message over a running turn closes it as stopped');
// events before any user event: one implicit turn
s = feed(fresh(), [{ type: 'thinking', delta: 'hmm.' }]);
assert.strictEqual(s.turn!.n, 1);

// ---- FR-006: bounded memory
s = feed(fresh(), [{ type: 'user' }]);
for (let i = 0; i < STEP_CAP + 25; i++) s = call(s, 'view', { path: `/p/f${i}.ts` });
assert.strictEqual(s.turn!.steps.length, STEP_CAP, 'at most 400 steps kept');
assert.strictEqual(s.turn!.folded, 25, 'the rest folded into a count ("25 earlier")');
assert.strictEqual(s.turn!.total, STEP_CAP + 25, 'every step counted');
assert.strictEqual(s.stepsTotal, STEP_CAP + 25); assert.strictEqual(s.counts.read, STEP_CAP + 25);
assert.strictEqual(s.turn!.steps[0].n, 26, 'the oldest were the ones folded');
assert.strictEqual(trailOf(s).length, TRAIL_MAX, 'the trail draws the last 24 (FR-040)');
assert.strictEqual(trailOf(s)[TRAIL_MAX - 1].n, STEP_CAP + 25);
for (let i = 0; i < HISTORY_MAX + 5; i++) s = feed(s, [{ type: 'user' }, { type: 'status', status: 'idle' }]);
assert.strictEqual(s.history.length, HISTORY_MAX, 'the last 20 turn summaries');
assert.ok(JSON.stringify(s.history).length < 20 * 300, 'a summary holds counts and glyph words only');

// ---- FR-004: coalescing (50 calls in a second: all counted, few paints)
s = feed(fresh(), [{ type: 'user' }]);
let paints = 0;
let t = 5_000_000;
for (let i = 0; i < 50; i++) {
  const st = start('grep', { pattern: 'x' + i });
  t += 10; s = brainState(s, st, t, mask);
  t += 10; s = brainState(s, finish(st), t, mask);
  if (shouldPaint(s, t)) { paints++; s = markPainted(s, t); }
}
assert.strictEqual(s.counts.read, 50, 'every step joined the counts');
assert.strictEqual(s.turn!.total, 50, 'and the trail');
assert.ok(paints <= 5, `at most 4 visible changes a second (got ${paints} in 1 s)`);
assert.ok(paints >= 3, 'but it still paints');
assert.strictEqual(s.burstStep, s.turn!.steps.find((x) => x.n === s.burstStep)!.n, 'the burst is a real step');
assert.ok(s.burstStep >= 40, 'only the newest step is drawn as the burst');
const painted = markPainted(s, t);
assert.strictEqual(shouldPaint(painted, t + 10 * PAINT_MS), false, 'nothing changed: no repaint (idle is free)');
assert.strictEqual(shouldPaint(painted, t + 1), false);
assert.strictEqual(shouldPaint(brainState(painted, { type: 'thinking', delta: 'x' }, t + 5, mask), t + PAINT_MS - 1), false, 'not before PAINT_MS');
assert.strictEqual(shouldPaint(brainState(painted, { type: 'thinking', delta: 'x' }, t + 5, mask), t + PAINT_MS), true, 'at PAINT_MS');

// ---- FR-003: order burst, card, sentence
assert.deepStrictEqual(REVEAL_ORDER, ['burst', 'card', 'sentence']);
assert.deepStrictEqual(revealStages(100, 100, false), { burst: true, card: false, sentence: false }, 'burst first');
assert.deepStrictEqual(revealStages(100, 100 + FRAME_MS, false), { burst: true, card: true, sentence: false }, 'card the next frame at the earliest');
assert.deepStrictEqual(revealStages(100, 100 + 2 * FRAME_MS, false), { burst: true, card: true, sentence: true }, 'sentence after the card');
assert.deepStrictEqual(revealStages(100, 100, true), { burst: true, card: true, sentence: true }, 'Still: one frame');
s = feed(fresh(), [{ type: 'user' }]);
const c0 = s.changedAt;
s = brainState(s, start('bash', { command: 'npm test' }), c0 + 400, mask);
assert.strictEqual(s.changedAt, c0 + 400, 'changedAt is when the shown step changed');

// ---- the card data: action, preview, why (FR-020)
s = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'Let me look at the registry. Then I will run the tests to prove the move broke nothing.' }]);
assert.strictEqual(s.act.kind, 'think'); assert.strictEqual(s.sentence, 'Ada is thinking');
const sh = start('bash', { command: 'npm run test -- --run' });
s = feed(s, [sh]);
let cur = currentStep(s)!;
assert.strictEqual(cur.glyph, 'shell'); assert.strictEqual(cur.state, 'running'); assert.strictEqual(cur.program, 'npm');
assert.strictEqual(cur.why, 'Then I will run the tests to prove the move broke nothing.', 'the newest stated sentence is the reason');
assert.strictEqual(s.sentence, 'Ada is running tests');
assert.strictEqual(s.buf, '', 'a reason is used once');
s = feed(s, [finish(sh)]);
assert.strictEqual(currentStep(s)!.state, 'done'); assert.ok(currentStep(s)!.endedAt! > currentStep(s)!.startedAt);
const rd = start('view', { path: '/home/ana/work/x/registry.ts' });
s = feed(s, [rd]);
assert.strictEqual(currentStep(s)!.why, '', 'with no reason the line is absent, never invented');
assert.strictEqual(currentStep(s)!.target, '~/work/x/registry.ts', 'home becomes ~ in the state');
assert.strictEqual(s.sentence, 'Ada is reading registry.ts');
s = feed(s, [finish(rd, 'failed')]);
assert.strictEqual(s.sentence, 'Ada could not read registry.ts'); assert.strictEqual(currentStep(s)!.state, 'failed');
const ed = start('apply_patch', undefined, { edit: { files: [{ path: '/home/ana/work/x/a.ts', kind: 'edit', added: 3, removed: 1 }] } });
s = feed(s, [ed, finish(ed)]);
assert.deepStrictEqual(currentStep(s)!.files, [{ path: '~/work/x/a.ts', kind: 'edit', added: 3, removed: 1 }], 'the turn\'s EditInfo is kept, masked');
assert.strictEqual(s.sentence, 'Ada edited a.ts');
const mcp = start('github-search_issues', { query: 'bug' }, { mcpServer: 'github', mcpTool: 'search_issues' });
s = feed(s, [mcp]);
assert.strictEqual(currentStep(s)!.glyph, 'mcp'); assert.strictEqual(currentStep(s)!.program, 'github'); assert.strictEqual(s.sentence, 'Ada is using github');
const other = start('spawn_agent', { x: 1 });
s = feed(s, [other]);
assert.strictEqual(currentStep(s)!.other, 'spawn_agent'); assert.strictEqual(currentStep(s)!.glyph, 'shell'); assert.strictEqual(s.sentence, 'Ada is running a tool');
const web = start('web_fetch', { url: 'https://example.com/a?key=XYZ' });
s = feed(s, [web]);
assert.strictEqual(s.sentence, 'Ada is searching the web');
assert.ok(!currentStep(s)!.target.includes('XYZ'), 'a URL query secret is masked');
assert.strictEqual(programOf('FOO=1 /usr/bin/psql -h x'), 'psql'); assert.strictEqual(programOf('C:\\bin\\git.exe push'), 'git.exe');
assert.strictEqual(baseName('~/work/x/registry.ts'), 'registry.ts'); assert.strictEqual(baseName('C:\\u\\a.txt'), 'a.txt');
// an array command (codex style) goes through maskSecretArgs
s = feed(fresh(), [{ type: 'user' }, start('shell', { command: ['bash', '-lc', 'deploy --token=' + GH] })]);
assert.ok(!JSON.stringify(s).includes(GH), 'array commands are masked');

// ---- waits, moods are not here: permission, question, limit
s = feed(fresh(), [{ type: 'user' }, { type: 'permission', permission: { requestId: 'r', state: 'pending', kind: 'shell', summary: 'x' } }]);
assert.strictEqual(s.wait, 'permission'); assert.strictEqual(s.sentence, 'Ada needs your OK');
s = feed(s, [{ type: 'permission', permission: { requestId: 'r', state: 'approved', kind: 'shell', summary: 'x' } }]);
assert.strictEqual(s.wait, null);
s = feed(s, [{ type: 'question', phase: 'asked', requestId: 'q' }]); assert.strictEqual(s.sentence, 'Ada has a question for you');
s = feed(s, [{ type: 'question', phase: 'answered', requestId: 'q' }]); assert.strictEqual(s.wait, null);
s = feed(s, [{ type: 'status', status: 'needs-permission' }]); assert.strictEqual(s.wait, 'permission');
s = feed(s, [{ type: 'status', status: 'idle' }]); assert.strictEqual(s.wait, null, 'the end of the turn clears the wait');
s = feed(s, [{ type: 'limit', phase: 'exhausted' }]); assert.strictEqual(s.wait, 'limit');
s = feed(s, [{ type: 'limit', phase: 'resolved' }]); assert.strictEqual(s.wait, null);

// ---- FR-007: helpers
s = feed(fresh(), [{ type: 'user' }]);
const h = start('grep', { pattern: 'x' }, { agentId: 'task1' });
s = feed(s, [{ type: 'thinking', delta: 'Parent reason.' }, h, finish(h, 'complete', { agentId: 'task1' })]);
assert.strictEqual(s.turn!.steps[0].helper, true, 'a helper\'s call shows in the parent as a helper step');
assert.strictEqual(s.turn!.steps[0].why, '', 'a helper never takes the parent\'s reason');
assert.strictEqual(s.buf, 'Parent reason.', 'and leaves it for the parent');
s = feed(s, [{ type: 'thinking', delta: 'Sub-agent musing.', agentId: 'task1' }]);
assert.strictEqual(s.buf, 'Parent reason.', 'a helper\'s thinking is not the parent\'s reason');

// ---- FR-021: masking in the state: a token split across deltas, in a reason, in a tool name
const half = Math.floor(GH.length / 2);
s = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'I will push with ' + GH.slice(0, half) }, { type: 'thinking', delta: GH.slice(half) + ' now.' }, start('bash', { command: 'git status' })]);
assert.ok(!JSON.stringify(s).includes(GH) && !JSON.stringify(s).includes(GH.slice(0, half + 6)), 'a token split across two deltas is masked');
s = feed(fresh(), [{ type: 'user' }, { type: 'output', delta: 'x', final: true, text: 'Using ' + GH + '.' }, start('view', { path: '/p/a' })]);
assert.ok(!JSON.stringify(s).includes(GH), 'a final reply text is masked');
s = feed(fresh('Ada ' + GH), [{ type: 'user' }]);
assert.ok(!JSON.stringify(s).includes(GH), 'even the agent name');
assert.ok(!JSON.stringify(call(fresh(), 'tool-' + GH, { command: 'ls' })).includes(GH), 'a tool name is masked');
const big = feed(fresh(), [{ type: 'user' }, { type: 'output', delta: 'word '.repeat(5000) }]);
assert.ok(big.buf.length <= 600, 'the reason buffer is bounded');
const outp = start('bash', { command: 'ls' });
s = feed(fresh(), [{ type: 'user' }, outp, { ...finish(outp), output: 'SECRET-OUTPUT-' + GH }]);
assert.ok(!JSON.stringify(s).includes('SECRET-OUTPUT'), 'tool output is never kept (FR-074)');

// ---- F1/F2 (review of PR 1226): a secret that arrives in pieces never leaves any part of itself in the state or on any surface
{
  const SK2 = 'sk-proj-' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ0bC2dE4fG6hI8';
  const TOKENS: Record<string, string> = {
    gh: GH, skproj: SK2, sklive: 'sk-live-' + 'a1B2c3D4e5F6g7H8i9J0k1L2', xoxb: 'xoxb-123456789012-1234567890123-' + 'AbCdEfGhIjKlMnOpQrStUvWx',
    pat: 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abcdefghijKLMNOPQRSTUVWXYZ0123', aws: 'aws_secret_access_key=' + 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };
  /** Every 8-character slice of the secret part of a token. */
  const slices = (tok: string): string[] => { const c = tok.replace(/^aws_secret_access_key=/, ''); const out: string[] = []; for (let i = 0; i + 8 <= c.length; i++) out.push(c.slice(i, i + 8)); return out; };
  const surfaces = ['office', 'card', 'front', 'transcript', 'turnmap', 'export', 'share'] as const;
  const check = (label: string, state: BrainState, tok: string): void => {
    const all = [JSON.stringify(state)];
    const cur = currentStep(state);
    if (cur) for (const sf of surfaces) all.push(formatStep(sf, cur, { mask }));
    all.push(sentenceFor(state, { mask }), exportText(state.turn ? state.turn.steps : [], { mask }));
    for (const x of slices(tok)) for (const text of all) assert.ok(!text.includes(x), `${label}: "${x}" survived in "${text.slice(0, 120)}"`);
  };
  const run = (chunks: string[], kind: 'thinking' | 'output' = 'thinking'): BrainState => feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: kind, delta })), start('bash', { command: 'ls' })], 1);
  for (const [name, tok] of Object.entries(TOKENS)) {
    const text = 'I will use ' + tok + ' for the call. Then go on.';
    for (const n of [1, 3, 5, 13]) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += n) chunks.push(text.slice(i, i + n));
      check(`${name} in ${n}-char deltas`, run(chunks), tok);
      check(`${name} in ${n}-char output deltas`, run(chunks, 'output'), tok);
    }
    // the head already masks, the tail follows in the next delta (the glued-tail case)
    const head = Math.max(12, Math.floor(tok.length * 0.6));
    check(`${name}: a head that already matches, then its tail`, run(['Use ' + tok.slice(0, head), tok.slice(head) + ' ok.']), tok);
    check(`${name}: head, then two tail pieces`, run(['Use ' + tok.slice(0, head), tok.slice(head, head + 4), tok.slice(head + 4)]), tok);
  }
  // F1b: a header or secret name masks to a mark and the value follows after a space: it must mask too, wherever the chunks split
  {
    const V1 = 'Zq9Xw8Er7Ty6Ui5Op4Lk3Jh2', V2 = 'Kj3Hg2Fd1Sa0Lm9Nb8Vc7Xz6', B64 = 'dXNlcjpwYXNzd29yZDEyMzQ1Njc4OQ==';
    const HEADERS: [string, string, string[]][] = [
      ['Bearer', 'Authorization: Bearer ', [V1]], ['Basic', 'Authorization: Basic ', [B64]], ['Proxy-Authorization', 'Proxy-Authorization: Bearer ', [V1]],
      ['X-Api-Key', 'X-Api-Key: ', [V1]], ['Cookie', 'Cookie: sid=', [V1, V2]],
    ];
    for (const [name, head, secrets] of HEADERS) {
      const value = name === 'Cookie' ? V1 + '; theme=' + V2 : secrets[0];
      const text = `Sending ${head}${value}${name === 'Cookie' ? '\n' : ' '}then going on.`;
      const sliceOf = (v: string): string[] => { const o: string[] = []; for (let i = 0; i + 8 <= v.length; i++) o.push(v.slice(i, i + 8)); return o; };
      for (const n of [1, 3, 5, 13]) {
        const variants: string[][] = [];
        const plain: string[] = []; for (let i = 0; i < text.length; i += n) plain.push(text.slice(i, i + n));
        variants.push(plain);
        const cut = text.indexOf(value) - (name === 'Cookie' ? 4 : 0); // a split right between the header and its value
        const split: string[] = []; for (let i = 0; i < cut; i += n) split.push(text.slice(i, Math.min(cut, i + n)));
        for (let i = cut; i < text.length; i += n) split.push(text.slice(i, i + n));
        variants.push(split);
        for (const chunks of variants) {
          const st = run(chunks);
          const j = JSON.stringify(st);
          for (const sec of secrets) for (const x of sliceOf(sec)) assert.ok(!j.includes(x), `${name}, ${n}-char deltas: "${x}" survived in ${st.turn!.steps[0].why}`);
          assert.ok(st.turn!.steps[0].why.includes('going on'), `${name}: the text after the secret is kept: "${st.turn!.steps[0].why}"`);
        }
      }
    }
    // the stream stops right after the value (nothing follows it): the state holds none of it
    for (const [name, head, secrets] of HEADERS) {
      const value = name === 'Cookie' ? V1 + '; theme=' + V2 : secrets[0];
      const text = `Sending ${head}${value}`;
      for (const n of [1, 3, 5, 13]) {
        const chunks: string[] = []; for (let i = 0; i < text.length; i += n) chunks.push(text.slice(i, i + n));
        const j = JSON.stringify(feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: 'thinking', delta }))]));
        for (const sec of secrets) for (let i = 0; i + 8 <= sec.length; i++) assert.ok(!j.includes(sec.slice(i, i + 8)), `${name} at the end of the stream, ${n}-char deltas: "${sec.slice(i, i + 8)}" kept`);
      }
    }
    for (const n of [1, 3, 5, 13]) {
      const text = 'Bearer tokens are explained here. Basic setup of a Cookie: header works. Done.';
      const chunks: string[] = []; for (let i = 0; i < text.length; i += n) chunks.push(text.slice(i, i + n));
      const b = feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: 'thinking', delta }))]).buf;
      assert.ok(b.includes('Bearer tokens are explained here.') && b.includes('Basic setup of a'), `prose after a scheme word survives at ${n} chars: "${b}"`);
    }
  }
  assert.strictEqual(run(['Use ' + GH.slice(0, 30), GH.slice(30) + ' ok. Done.']).turn!.steps[0].why, 'Done.', 'the mask swallows the glued tail and not the sentence after it');
  const dot = run(['Key is ' + GH.slice(0, 30), GH.slice(30) + '.']).turn!.steps[0].why;
  assert.ok(dot.endsWith('[redacted].') && dot.length < 40, `a full stop after a mask stays: "${dot}"`);
  // a private key block over three chunks: nothing of its body is kept until the END marker; text after it is kept
  const body = ['MIIEowIBAAKCAQEAx1y2z3abcdefghijkl', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456789abcdEF', 'QRSTUVWXYZ0123456789qwertyuiopasdfghjkl'];
  const kb = run(['Key: -----BEGIN RSA PRIVATE KEY-----\n' + body[0], '\n' + body[1] + '\n', body[2] + '\n']);
  for (const b of body) for (let i = 0; i + 8 <= b.length; i += 3) assert.ok(!JSON.stringify(kb).includes(b.slice(i, i + 8)), `key body slice "${b.slice(i, i + 8)}" survived`);
  assert.strictEqual(kb.inKeyBlock, true, 'an open key block is remembered');
  const kc = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'Key: -----BEGIN RSA PRIVATE KEY-----\n' + body[0] }, { type: 'thinking', delta: body[1] + '\n' + body[2] + '\n-----END RSA PRIVATE KEY-----\nSafe words. Next I will run it.' }, start('bash', { command: 'ls' })]);
  assert.strictEqual(kc.inKeyBlock, false, 'the END marker closes it');
  assert.strictEqual(kc.turn!.steps[0].why, 'Next I will run it.', 'text after the END marker is kept');
  for (const b of body) assert.ok(!JSON.stringify(kc).includes(b.slice(0, 10)), 'the closed block left nothing');
  assert.strictEqual(feed(kc, [{ type: 'user' }]).inKeyBlock, false, 'a new turn starts outside a block');
}
// F7: a mask returning a non-string yields no text, never a coerced object
assert.strictEqual(brainMaskText({ ...mask, maskTokenShapes: () => ({ toString: () => 'LEAK-' + GH }) as unknown as string } as never, 'x'), '', 'a non-string result fails closed');
assert.strictEqual(brainMaskText({ ...mask, maskTokenShapes: () => 5 as unknown as string } as never, 'x'), '', 'a number result fails closed');
assert.strictEqual(brainMaskText(mask, 'a\u202Eb\u2066c\u2069d'), 'abcd', 'bidi override and isolate characters are dropped');
assert.strictEqual(initBrain('Ada\u202E', mask).name, 'Ada', 'also in a name');

// F3: the program of a command is taken from the MASKED command: a token as the first word never reaches the office cell
{
  const word = GH.slice(0, 20);
  const st = feed(fresh(), [{ type: 'user' }, start('bash', { command: GH + ' --flag' }), start('bash', { command: 'FOO=1 ' + GH + ' x' })]).turn!.steps;
  for (const x of st) {
    assert.ok(!x.program.includes(word.slice(0, 8)) && !x.program.includes(GH.slice(8, 16)), `the program holds no part of a token: "${x.program}"`);
    assert.ok(!officeLine(x, { mask }).includes(GH.slice(4, 12)), 'nor the office cell');
  }
}

// F7: calls without a callId do not share one step; a late event updates the history entry
{
  let q = feed(fresh(), [{ type: 'user' }]);
  q = feed(q, [{ type: 'toolCall', phase: 'start', tool: 'bash', args: { command: 'one' } }, { type: 'toolCall', phase: 'start', tool: 'bash', args: { command: 'two' } }]);
  assert.strictEqual(q.turn!.steps.length, 2, 'two starts of one tool without callId are two steps');
  assert.deepStrictEqual(q.turn!.steps.map((x) => x.target), ['one', 'two']);
  q = feed(q, [{ type: 'toolCall', phase: 'complete', tool: 'bash' }]);
  assert.deepStrictEqual(q.turn!.steps.map((x) => x.state), ['running', 'done'], 'a completion closes the newest running call of that tool');
  q = feed(q, [{ type: 'toolCall', phase: 'failed', tool: 'bash' }]);
  assert.deepStrictEqual(q.turn!.steps.map((x) => x.state), ['failed', 'done']);
  assert.strictEqual(q.turn!.total, 2);
  // late events keep the history summary true
  let h = feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: 0.01 }]);
  h = call(h, 'view', { path: 'a' });
  h = feed(h, [{ type: 'status', status: 'idle' }]);
  assert.deepStrictEqual([h.history[0].steps, h.history[0].glyphs, h.history[0].costUsd], [1, ['read'], 0.01]);
  h = call(h, 'bash', { command: 'ls' });
  h = feed(h, [{ type: 'usage', costUsd: 0.02 }]);
  assert.strictEqual(h.history[0].steps, 2, 'a late step updates the history count');
  assert.deepStrictEqual(h.history[0].glyphs, ['read', 'shell'], 'and its glyphs');
  assert.ok(Math.abs(h.history[0].costUsd! - 0.03) < 1e-9, 'a late usage event updates the history cost');
  assert.strictEqual(h.history.length, 1);
}

// ---- cost (FR-015, FR-042)
s = feed(fresh(), [{ type: 'user' }]);
assert.strictEqual(s.costKnown, false);
s = feed(s, [{ type: 'usage', costUsd: 0.02 }, { type: 'usage', costUsd: 0.03 }, { type: 'usage', inputTokens: 5 }]);
assert.strictEqual(s.costKnown, true); assert.ok(Math.abs(s.turnCost - 0.05) < 1e-9);
s = feed(s, [{ type: 'usage', costUsd: -1 }, { type: 'usage', costUsd: NaN }]);
assert.ok(Math.abs(s.turnCost - 0.05) < 1e-9, 'junk costs are ignored');

// F8 (owner question): the brain's cost is the app's own estimate: Copilot's credits (nanoAiu) at AIU_USD, Claude's and Codex's costUsd, helpers once
{
  let c = feed(fresh(), [{ type: 'user' }, { type: 'usage', nanoAiu: 2e9 }, { type: 'usage', nanoAiu: 3e9 }]);
  assert.ok(c.costKnown && Math.abs(c.turnCost - 0.05) < 1e-9, `a Copilot stream: 5 AIU at 0.01 is $0.05 (got ${c.turnCost})`);
  assert.strictEqual(loopText({ ...c, loop: { a: 'edit', b: 'shell', pairs: 2, firstN: 1, costUsd: c.turnCost, half: 4, costAt: 0 } }, undefined, mask), 'looping? Edit ↔ Shell · 2 times · ≈ $0.05');
  c = feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: 0.04 }, { type: 'usage', costUsd: 0.01 }]);
  assert.ok(c.costKnown && Math.abs(c.turnCost - 0.05) < 1e-9, 'a Claude stream: costUsd as it is');
  c = feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: 0.04 }, { type: 'usage', costUsd: 0.04, agentId: 'helper1' }]);
  assert.ok(Math.abs(c.turnCost - 0.08) < 1e-9, 'a helper\'s usage event is counted once, in its parent\'s turn');
  assert.strictEqual(feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: 0.04, agentId: 'h' }]).turnCost, 0.04, 'once');
  for (const bad of [-1, NaN, Infinity, '5', null, undefined, {}, 2e15]) {
    c = feed(fresh(), [{ type: 'user' }, { type: 'usage', nanoAiu: bad }]);
    assert.strictEqual(c.costKnown, false, `nanoAiu ${String(bad)} is not reported: cost unknown, never 0`);
    assert.strictEqual(c.turnCost, 0);
  }
  c = feed(fresh(), [{ type: 'user' }, { type: 'usage', nanoAiu: 1e9 }, { type: 'usage', nanoAiu: -5 }, { type: 'usage', nanoAiu: 'x' }]);
  assert.ok(c.costKnown && Math.abs(c.turnCost - 0.01) < 1e-12, 'a mixed stream counts what was reported and the invalid ones as unreported');
  c = brainState(brainState(initBrain('Ada', R), { type: 'user' }, 1, R), { type: 'usage', nanoAiu: 1e9 }, 2, R);
  assert.strictEqual(c.costKnown, false, 'without the app\'s units a credit figure is unreported, never guessed');
  const tiny = feed(fresh(), [{ type: 'user' }, { type: 'usage', nanoAiu: 1e6 }]);
  assert.strictEqual(loopText({ ...tiny, loop: { a: 'edit', b: 'shell', pairs: 2, firstN: 1, costUsd: tiny.turnCost, half: 4, costAt: 0 } }, undefined, mask), 'looping? Edit ↔ Shell · 2 times · <$0.01', 'under a cent reads "<$0.01" with no "≈", as the top bar');
}

// H1..H4, H8 (re-review of PR 1226): key blocks across pieces, one tail per stream
{
  const KEYHEAD = 'Key: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1y2z3abcdefghijkl\n';
  const th = (...d: string[]) => feed(fresh(), [{ type: 'user' }, ...d.map((delta) => ({ type: 'thinking', delta }))]);
  // H1: an END marker split across pieces closes the block
  for (const cut of [3, 7, 12, 20, 29]) {
    const end = '-----END RSA PRIVATE KEY-----';
    const k = th(KEYHEAD + 'QRSTUVWXYZ0123456789qwerty\n' + end.slice(0, cut), end.slice(cut) + '\nDone then.');
    assert.strictEqual(k.inKeyBlock, false, `an END split after ${cut} characters closes the block`);
    assert.ok(k.buf.includes('Done then.') && !k.buf.includes('QRSTUVWX'), `text after a split END is kept and the body is not: "${k.buf}"`);
  }
  assert.strictEqual(th(KEYHEAD, '-----', 'END RSA PRIVATE KEY-----\nOk.').inKeyBlock, false, 'five dashes alone, then the rest');
  assert.strictEqual(th(KEYHEAD, 'abc--', '---END RSA PRIVATE KEY-----\nOk.').inKeyBlock, false, 'dashes split in the middle');
  assert.strictEqual(th(KEYHEAD, 'MORE-BASE64+body/xyz', 'AAAA').inKeyBlock, true, 'a body without a marker keeps it open');
  // H2: the end of a turn clears an open block
  const open = th(KEYHEAD);
  assert.strictEqual(open.inKeyBlock, true, 'the block is open');
  const ended = feed(open, [{ type: 'status', status: 'idle' }]);
  assert.strictEqual(ended.inKeyBlock, false, 'the turn end clears an open key block');
  assert.strictEqual(feed(ended, [{ type: 'thinking', delta: 'Late words here.' }]).buf, 'Late words here.', 'and a late text is kept');
  assert.strictEqual(feed(open, [{ type: 'user' }]).inKeyBlock, false, 'a new turn starts outside a block');
  const lateOpen = feed(ended, [{ type: 'thinking', delta: KEYHEAD }]);
  assert.strictEqual(lateOpen.inKeyBlock, true, 'a late text can open a block in the ended turn');
  assert.strictEqual(feed(lateOpen, [{ type: 'user' }]).inKeyBlock, false, 'a turn start clears it too');
  // H3: interleaved streams do not split each other's tokens
  const il = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'use ' + GH.slice(0, 28) }, { type: 'output', delta: ' Hi there' }, { type: 'thinking', delta: GH.slice(28) + ' ok.' }, start('bash', { command: 'ls' })]);
  for (let i = 0; i + 8 <= GH.length; i++) assert.ok(!JSON.stringify(il).includes(GH.slice(i, i + 8)), `interleaved streams: "${GH.slice(i, i + 8)}" kept`);
  const nw = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'First thought.' }, { type: 'output', delta: 'Second reply.' }, start('bash', { command: 'ls' })]);
  assert.strictEqual(nw.turn!.steps[0].why, 'Second reply.', 'Why comes from the newer stream');
  const nw2 = feed(fresh(), [{ type: 'user' }, { type: 'output', delta: 'A reply.' }, { type: 'thinking', delta: 'A newer thought.' }, start('bash', { command: 'ls' })]);
  assert.strictEqual(nw2.turn!.steps[0].why, 'A newer thought.');
  // H4: a nested BEGIN: the inner END does not close the outer block
  const nest = th('A -----BEGIN RSA PRIVATE KEY-----\nAAAA11112222\n-----BEGIN RSA PRIVATE KEY-----\nBBBB33334444\n-----END RSA PRIVATE KEY-----\nLEAKED5555666677\n');
  assert.ok(nest.inKeyBlock && !JSON.stringify(nest).includes('LEAKED') && !JSON.stringify(nest).includes('BBBB3333'), 'content after an inner END is still dropped');
  const nest2 = feed(nest, [{ type: 'thinking', delta: 'MORE7777\n-----END RSA PRIVATE KEY-----\nSafe words.' }]);
  assert.ok(!nest2.inKeyBlock && nest2.buf.includes('Safe words.') && !JSON.stringify(nest2).includes('MORE7777'), 'the outer END closes it');
  const nest3 = th(KEYHEAD, 'BODY\n-----BEGIN RSA PRIVATE KEY-----\nXXXX9999\n-----END RSA PRIVATE KEY-----\nLEAKTWO1234\n');
  assert.ok(nest3.inKeyBlock && !JSON.stringify(nest3).includes('LEAKTWO'), 'a nested BEGIN in a later piece still counts');
  // H6: the host after a URL's credentials stays
  const url = th('go https://ana:hunter2xyz@example.com/path now.');
  assert.ok(url.buf.includes('example.com/path') && !url.buf.includes('hunter2xyz'), `a URL's host stays: "${url.buf}"`);
  assert.strictEqual(R.maskGluedTail('https://[redacted]@example.com/p ok'), 'https://[redacted]@example.com/p ok');
  assert.strictEqual(R.maskGluedTail('[redacted]rest of it'), '[redacted] of it', 'a glued tail is swallowed, the words after a space stay');
  // H8: a failing key-block check fails closed (treated as open)
  const thrower = { ...mask, openKeyBlockStart: () => { throw new Error('boom'); } } as BrainMask;
  const f8 = brainState(brainState(initBrain('Ada', thrower), { type: 'user' }, 1, thrower), { type: 'thinking', delta: 'some words' }, 2, thrower);
  assert.strictEqual(f8.inKeyBlock, true, 'a throwing openKeyBlockStart leaves the block open');
  assert.ok(!f8.buf.includes('some words'), 'and keeps no text');
  assert.strictEqual(f8.buf, '[redacted]', 'a failing check leaves exactly the mark');
}

// J1 (round 3): a secret that arrives in the same piece as a short trailing word that starts a scheme word ("to", "tok", "Bearer"...) never stays raw
{
  const SEC = 'Zq9Xw8Er7Ty6Ui5Op4Lk3Jh2';
  const heads = ['Authorization: Bearer ', 'Authorization: Basic ', 'Authorization: token ', 'Proxy-Authorization: Bearer ', 'X-Api-Key: ', 'api_key=', 'password: ', 'password=', 'token: ', 'Cookie: sid=', 'client_secret=', '-H "Authorization: Bearer ', 'secret ', 'PASSWORD ', '--token ', 'auth: '];
  const tails = ['', ' and', ' to', ' then I will', ' is sent to', ' b', ' a', ' ba', ' de', ' ne', ' tok', ' x.', ' x\n', ' Bearer', ' Authorization: Bearer', ' password', ' token', ' a b c d e f g h i j k l m'];
  let cases = 0;
  for (const h of heads) for (const tl of tails) for (const sz of [1, 3, 7, 1000]) {
    const text = 'I will send ' + h + SEC + tl;
    if (brainMaskText(mask, text).includes(SEC.slice(0, 8))) continue; // redact itself does not mask this shape (#1227's kind of gap): out of scope here
    cases++;
    const chunks: string[] = []; for (let i = 0; i < text.length; i += sz) chunks.push(text.slice(i, i + sz));
    const st = feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: 'thinking', delta })), start('bash', { command: 'ls' })], 1);
    const all = [JSON.stringify(st), ...(['office', 'card', 'front', 'transcript', 'turnmap', 'export', 'share'] as const).map((sf) => formatStep(sf, currentStep(st)!, { mask })), sentenceFor(st, { mask })];
    for (let j = 0; j + 8 <= SEC.length; j += 4) for (const out of all) assert.ok(!out.includes(SEC.slice(j, j + 8)), `"${text}" in ${sz}-char deltas kept "${SEC.slice(j, j + 8)}": ${out.slice(0, 160)}`);
  }
  assert.ok(cases > 800, `the fuzz ran (${cases} cases)`);
}
// K1 (round 4): seeded random cut points over glued and quoted header forms (`Authorization:Bearer`, `"Authorization": "Bearer `), many secrets, tails and prefixes
for (const seed0 of [1, 7, 42]) {
  let seed = seed0;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const SECS = ['Zq9Xw8Er7Ty6Ui5Op4Lk3Jh2', GH, 'dXNlcjpwYXNzd29yZDEyMzQ1Ng==', 'sk-proj-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0', 'xoxb-' + '123456789012-1234567890123-' + 'AbCdEfGhIjKlMnOpQrStUvWx'];
  const heads = ['Authorization: Bearer ', 'Authorization: Basic ', 'Authorization: token ', 'Proxy-Authorization: Bearer ', 'X-Api-Key: ', 'api_key=', 'password: ', 'password=', 'token: ', 'Cookie: sid=', 'client_secret=', '-H "Authorization: Bearer ', '--token ', 'auth: ', 'Authorization:Bearer ', 'Authorization:Basic ', 'curl -H "Authorization:Bearer ', '"Authorization": "Bearer ', 'authorization: bearer ', 'PRIVATE_TOKEN: ', 'x-auth-token: '];
  const tails = ['', ' and', ' to', ' then I will', ' is sent to', ' b', ' a', ' ba', ' de', ' ne', ' tok', ' x.', ' x\n', ' Bearer', ' Authorization: Bearer', ' password', ' token', ' a b c', '" to', '" a', '\nnext a', ' apikey', ' basic', ' digest'];
  const pres = ['', 'I will send ', 'Next: ', 'curl -s ', 'ok.\n', '  '];
  let cases = 0;
  for (let it = 0; it < 400; it++) {
    const sec = pick(SECS), text = pick(pres) + pick(heads) + sec + pick(tails);
    const slices: string[] = []; for (let j = 0; j + 8 <= sec.length; j += 3) slices.push(sec.slice(j, j + 8));
    if (slices.some((x) => brainMaskText(mask, text).includes(x))) continue; // redact itself does not mask this text as a whole (#1227)
    const chunks: string[] = []; for (let i = 0; i < text.length;) { const n = 1 + Math.floor(rnd() * (rnd() < 0.3 ? 60 : 12)); chunks.push(text.slice(i, i + n)); i += n; }
    cases++;
    const kind = rnd() < 0.5 ? 'thinking' : 'output';
    const st = feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: kind, delta })), start('bash', { command: 'ls' })], 1);
    const out = JSON.stringify(st) + formatStep('card', currentStep(st)!, { mask });
    for (const x of slices) assert.ok(!out.includes(x), `seed ${seed0}: "${text}" cut as ${JSON.stringify(chunks)} kept "${x}"`);
  }
  assert.ok(cases > 330, `seed ${seed0} ran ${cases} cases`);
}
// J2: ordinary text costs no header probe: redact runs at most twice per delta (counted, never timed)
{
  let calls = 0;
  const counting: BrainMask = { ...mask, redact: (x: unknown) => { calls++; return R.redact(x); } };
  let s2 = brainState(initBrain('Ada', counting), { type: 'user' }, 1, counting);
  let worst = 0;
  for (const piece of 'I will read the file and then run the tests to see what broke, a b ba de ne to a fix, which is fine. '.repeat(3).split('')) {
    calls = 0; s2 = brainState(s2, { type: 'thinking', delta: piece }, 2, counting); worst = Math.max(worst, calls);
  }
  assert.ok(worst <= 2, `ordinary prose costs at most 2 redact calls per delta (worst ${worst})`);
  let worst2 = 0;
  for (const piece of 'the pair a=b and c:d then e=f g:h i=j so k:l x=y z:w'.split('')) { calls = 0; s2 = brainState(s2, { type: 'thinking', delta: piece }, 2, counting); worst2 = Math.max(worst2, calls); }
  assert.ok(worst2 <= 6, `words with = or : cost at most 1 + 4 probes + 1 (worst ${worst2})`);
  // L1: a last word that starts a scheme word after many `k:v` words: the scheme-in-flight branch also probes only the nearest four
  let worst3 = 0;
  for (const last of [' a', ' to', ' Bea', ' b']) {
    let s3 = brainState(initBrain('Ada', counting), { type: 'user' }, 1, counting);
    s3 = brainState(s3, { type: 'thinking', delta: Array.from({ length: 12 }, (_, i) => `k${i}:v${i}`).join(' ') }, 2, counting);
    calls = 0; s3 = brainState(s3, { type: 'thinking', delta: last }, 3, counting); worst3 = Math.max(worst3, calls);
  }
  assert.ok(worst3 <= 10, `a scheme-looking last word after many k:v words costs at most 1 + 4 + 4 probes (worst ${worst3})`);
  calls = 0; s2 = brainState(s2, { type: 'thinking', delta: ' Authorization: Bear' }, 3, counting);
  assert.ok(calls >= 2, 'a header-looking line does get probed (so the counter counts)');
}
// J3: a tool start ends the reason: the next call never shows one from before the previous call (FR-020)
{
  const r = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'Old reason here.' }, start('bash', { command: 'one' }), { type: 'thinking', delta: ' more words follow' }, start('bash', { command: 'two' })]);
  assert.strictEqual(r.turn!.steps[0].why, 'Old reason here.');
  assert.ok(!r.turn!.steps[1].why.includes('Old reason'), `the next call's Why holds nothing from before the previous call: "${r.turn!.steps[1].why}"`);
  const r2 = feed(fresh(), [{ type: 'user' }, { type: 'output', delta: 'Old reply here.' }, start('bash', { command: 'one' }), { type: 'output', delta: ' fresh words' }, start('bash', { command: 'two' })]);
  assert.ok(!r2.turn!.steps[1].why.includes('Old reply'), 'also for a reply');
}
// N1 (review of #1243, security): a short value after a secret name that ENDS a thought is never kept raw, whatever its length: not in the step's Why, not in the tails, not after a tool start or idle
{
  const pw = ['abc' + '123', 'Win' + '2024', 'ab12 cd' + '34', 'Zx' + '9!', 'ab' + '1.']; // `Zx9!`, `ab1.`: fewer than 4 letters and digits once the punctuation is gone (re-review of #1243 at 5ede1bfde)
  for (const v of pw) for (const lead of ['I will log in with password: ', 'Use password: ', 'the db password: ']) {
    const secret = v.split(' ')[0];
    for (const [label, tail] of [['a tool start', start('bash', { command: 'ls' })], ['idle', { type: 'idle' }]] as Array<[string, unknown]>) {
      const r = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: lead + v }, tail]);
      assert.ok(!JSON.stringify(r).includes(secret), `N1: no raw short value "${secret}" after "${lead}" and ${label}`);
    }
  }
  // the header still holds: a value that has not arrived is not masked early
  assert.ok(feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'status: idle, password: ' }]).think.buf.includes('password:'), 'N1: the header words stay readable');
}
// N2 (review of #1243, security): an unterminated quoted -p value is masked while it streams (one character per delta) and when the line ends there
{
  const pwd = 'S3' + 'cret9x';
  for (const q of ['"', "'", '`']) {
    let r = feed(fresh(), [{ type: 'user' }]);
    for (const ch of 'mysql -u r -p' + q + pwd) {
      r = feed(r, [{ type: 'thinking', delta: ch }]);
      assert.ok(!JSON.stringify(r).includes(pwd.slice(0, 3)), `N2: streaming a -p${q} value one character at a time: no leak of "${pwd.slice(0, 3)}" after "${r.think.buf.slice(-12)}"`);
    }
    r = feed(r, [start('bash', { command: 'ls' })]);
    assert.ok(!JSON.stringify(r).includes(pwd.slice(0, 3)), `N2: an unterminated -p${q} value at the end of a thought is masked`);
  }
}
// B2 (re-review of #1243 at f8af91b1a, security): a piece that ends 4 to 7 characters into a value masks that prefix as a short value; the rest that the next piece brings is masked too (`NAMED_MASKED_REST`), as when the whole value arrives at once
{
  for (const [a, b] of [['password: Pa' + '55', '!word' + '12345'], ['password: ab' + '12', '$Secret' + '999'], ['password: Sup' + '3r', '(S3cret)' + '99']]) {
    const r = feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: a }, { type: 'thinking', delta: b }, start('bash', { command: 'ls' })]);
    assert.ok(!JSON.stringify(r).includes(b.slice(-5)), `B2: the rest of a value after a masked short prefix is masked: ${JSON.stringify(a)} then ${JSON.stringify(b)} gave "${r.turn!.steps[0].why}"`);
  }
  assert.strictEqual(feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: 'password: Pa' + '55' }, { type: 'thinking', delta: '!word' + '12345' }, start('bash', { command: 'ls' })]).turn!.steps[0].why, 'password: [redacted]', 'B2: Pa55 then !word12345 (the reviewer\'s case) is one mask, as on main');
  // a cut at every position (one cut, and two cuts 3 apart) shows no 4 characters of the value that the whole text, masked at once, hides
  const values = ['Pa' + '55!word12345', 'ab12' + '$Secret999', 'Sup3r' + '(S3cret)99', 'Zx9!' + 'Qw7#Er5%', 'S3cr3t' + '.P@ss.w0rd', 'Win2024' + '/Spring!', 'tr0ub4' + 'dor&3x'];
  const leads = ['password: ', 'I will log in with password: ', 'pwd=', 'token: ', 'api_key='];
  let runs = 0; const shown: string[] = [];
  for (const v of values) for (const lead of leads) {
    const full = lead + v + ' and then go on.';
    const whole = R.redact(full);
    const base = JSON.stringify(feed(fresh(), [{ type: 'user' }, { type: 'thinking', delta: lead + '[redacted] and then go on.' }, start('bash', { command: 'ls' })])); // what the state holds anyway (`word` is in its keys)
    const grams = Array.from({ length: v.length - 3 }, (_, k) => v.slice(k, k + 4)).filter((g) => !whole.includes(g) && !base.includes(g));
    for (let i = 1; i < full.length; i++) for (const j of [0, Math.min(full.length - 1, i + 3)]) {
      const cuts = j > i ? [full.slice(0, i), full.slice(i, j), full.slice(j)] : [full.slice(0, i), full.slice(i)];
      const out = JSON.stringify(feed(fresh(), [{ type: 'user' }, ...cuts.map((d) => ({ type: 'thinking', delta: d })), start('bash', { command: 'ls' })]));
      runs++;
      const g = grams.find((x) => out.includes(x));
      if (g) shown.push(`${JSON.stringify(cuts)}: ${g}`);
    }
  }
  assert.ok(runs > 2500, `B2: the cut sweep ran (${runs} runs)`);
  assert.deepStrictEqual(shown.slice(0, 5), [], `B2: cut at every position, no part of a value that the whole text hides is shown (${shown.length} of ${runs})`);
}
// J4: units: costUsd is capped like credits, a NaN rate is "cost unknown", the unit words come from the app (none in src/shared), no "0.00 AIU"
{
  for (const big of [1e7, 1e300]) assert.strictEqual(feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: big }]).costKnown, false, `costUsd ${big} is beyond the cap: not reported`);
  assert.strictEqual(feed(fresh(), [{ type: 'user' }, { type: 'usage', costUsd: 999 }]).costKnown, true, 'a normal costUsd counts');
  const nanRate: BrainMask = { ...mask, units: { ...mask.units!, AIU_USD: NaN } };
  const n = brainState(brainState(initBrain('Ada', nanRate), { type: 'user' }, 1, nanRate), { type: 'usage', nanoAiu: 1e9 }, 2, nanRate);
  assert.strictEqual(n.costKnown, false, 'AIU_USD NaN: cost unknown');
  assert.strictEqual(costDetail({ ...n, costKnown: true, turnCost: NaN, turnAiu: 1, turnUsd: 0 }, { mask }), '', 'a non-finite total says nothing');
  assert.strictEqual(costDetail({ ...n, costKnown: true, turnCost: 1, turnAiu: Infinity, turnUsd: 0 }, { mask }), '');
  const words: BrainMask = { ...mask, units: { ...mask.units!, creditsWord: 'credits', estimateWord: 'est. dollars' } };
  const w = brainState(brainState(brainState(initBrain('Ada', words), { type: 'user' }, 1, words), { type: 'usage', nanoAiu: 4.2e9 }, 2, words), { type: 'usage', costUsd: 0.03 }, 3, words);
  assert.strictEqual(costDetail(w, { mask: words }), '≈ $0.07 = 4.20 credits + $0.03 est. dollars', 'the unit words are the app\'s');
  assert.strictEqual(costDetail(w, { mask: { ...words, units: { ...words.units!, creditsWord: undefined } } }), '≈ $0.07', 'no words passed: the total only');
  const only = brainState(brainState(initBrain('Ada', mask), { type: 'user' }, 1, mask), { type: 'usage', costUsd: 0.03 }, 2, mask);
  assert.strictEqual(costDetail(only, { mask }), '≈ $0.03 Claude (est.)', 'no credits seen: no "0.00 AIU" part');
  for (const f of ['brainstate.ts', 'brainsurface.ts']) {
    const code = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(AIU|Claude|Copilot|Codex)\b/.test(code), `${f} writes no vendor or unit word in code (FR-001)`);
  }
}

// ---- bloom lobes (FR-051) and the sentence of an ended turn
s = feed(fresh(), [{ type: 'user' }]);
s = call(s, 'bash', { command: 'ls' }); s = call(s, 'view', { path: 'a' }); s = call(s, 'bash', { command: 'ls' });
assert.deepStrictEqual(s.bloom, [], 'no bloom while the turn runs');
s = feed(s, [{ type: 'status', status: 'idle' }]);
assert.deepStrictEqual(s.bloom, ['cerebellum', 'occipital'], 'only the lobes the turn used');
assert.deepStrictEqual(usedLobes(s.turn), s.bloom);
assert.strictEqual(s.sentence, 'Ada finished');
assert.ok(trailOf(s).every((x, i) => x.lobe === GLYPHS[x.glyph].lobe && x.n === i + 1));

// ---- FR-041/FR-042: the loop rule (more cases in test:brainloop)
s = feed(fresh(), [{ type: 'user' }]);
for (let i = 0; i < 3; i++) { s = call(s, 'edit', { path: 'a.ts' }); s = call(s, 'bash', { command: 'npm test' }, i < 2 ? 'complete' : 'failed'); }
assert.ok(s.loop && s.loop.a === 'edit' && s.loop.b === 'shell' && s.loop.pairs === 3, 'looping? Edit and Shell, 3 times');
assert.strictEqual(loopText(s), 'looping? Edit ↔ Shell · 3 times · cost unknown');
assert.strictEqual(s.sentence, 'Ada may be looping between Edit and Shell');
assert.strictEqual(sentenceOf(s), s.sentence);

// Spec 012 FR-170 (issue #1227, review of #1243 F6): a password of several words streamed in pieces is masked whole, word per delta and at random cuts.
{
  const cases: Array<[string, string[]]> = [
    ['password: ab12 cd34 ef56 done', ['ab12', 'cd34', 'ef56']],
    ['pwd=red7 blue8 green9 x', ['red7', 'blue8', 'green9']],
    ['passphrase: hunter2 hunter3 hunter4.', ['hunter2', 'hunter3', 'hunter4']],
  ];
  let seed = 1227;
  const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
  const leaks = (chunks: string[], words: string[]): string[] => {
    const st = feed(fresh(), [{ type: 'user' }, ...chunks.map((delta) => ({ type: 'thinking', delta })), start('bash', { command: 'ls' })], 1);
    const out = JSON.stringify(st);
    return words.filter((w) => out.includes(w));
  };
  for (const [text, words] of cases) {
    const parts = text.split(/(?<= )/); // one word per delta
    assert.deepStrictEqual(leaks(parts, words), [], `word per delta: ${JSON.stringify(parts)}`);
    for (let k = 0; k < 400; k++) {
      const n = 1 + Math.floor(rnd() * 6);
      const cuts = new Set<number>();
      while (cuts.size < n) cuts.add(1 + Math.floor(rnd() * (text.length - 1)));
      const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
      const chunks = pts.slice(1).map((q, i) => text.slice(pts[i], q));
      assert.deepStrictEqual(leaks(chunks, words), [], `random cuts: ${JSON.stringify(chunks)}`);
    }
  }
  assert.deepStrictEqual(leaks(['pwd=red7 ', 'blue8 x'], ['red7', 'blue8']), [], 'the issue pair');
  assert.deepStrictEqual(leaks(['password: ab12 cd34 e', 'f56 done'], ['ab12', 'cd34', 'ef56']), [], 'the issue pair with a cut inside a word');
}

// spec 012 FR-188 (review of PR 1899): a token with a character in an entity or a percent-escape form, streamed in pieces cut inside the forms too: no state
// shows a piece of its body. An entity the next piece extends into another character (`&#82` then `03;`) is held as written until it is complete.
{
  const body = 'Ab3' + 'Cd5' + 'Ef7' + 'Gh9' + 'Jk2' + 'Lm4' + 'Np6' + 'Qr8' + 'St1' + 'Uv3' + 'Wx5' + 'Yz7';
  const pieces = (v: string): string[] => Array.from({ length: v.length - 5 }, (_x, i) => v.slice(i, i + 6));
  const showsAny = (chunks: string[], v: string): boolean => {
    let st = feed(fresh(), [{ type: 'user' }], 1);
    const ps = pieces(v);
    for (const delta of [...chunks.map((d) => ({ type: 'thinking', delta: d })), start('bash', { command: 'ls' })]) {
      st = feed(st, [delta], 1);
      // what the views read: a stream's held copy (round 2) is internal; `shown` is the text read whole (review of PR 1899, round 3)
      const out = JSON.stringify({ ...st, think: st.think.shown ?? st.think.buf, out: st.out.shown ?? st.out.buf });
      if (ps.some((p) => out.includes(p))) return true;
    }
    return false;
  };
  // the review's case: the first piece ends inside an entity of a hidden character whose first digits read as a token character
  assert.ok(!showsAny(['x gh' + 'p_' + body.slice(0, 22) + '&#82', '03;' + body.slice(22) + ' done'], body.slice(12)), '#1320 decoded brain: an entity cut before its last digits is held');
  // review of PR 1899, round 2: an entity whose first digits read as a token character and whose whole number is a hidden one, cut after 4 digits
  for (const [cutAt, rest] of [['&#6527', '9;'], ['&#6158', ';']]) {
    assert.ok(!showsAny(['x gh' + 'p_' + body.slice(0, 22) + cutAt, rest + body.slice(22) + ' done'], body.slice(22)), `#1320 decoded brain: a long entity cut inside is held (${cutAt.length})`);
  }
  // a stream that ends on a form: the views show the whole text read at once, so the form is read
  assert.ok(!showsAny(['x AK' + 'IA' + 'Q3WD8KP2LM5RT7Y' + '&#88'], 'Q3WD8KP2LM5RT7Y'), '#1320 decoded brain: a stream that ends on a form shows the token read whole');
  // a header name or its separator written in such a form, streamed with random cuts: the header is held raw as its plain form is, and the value never shows
  {
    const pw = 'Hx9' + 'Kq2' + 'Lm7' + 'Np4' + 'Rs';
    let hs = 4242;
    const hr = (): number => { hs = (Math.imul(hs, 1103515245) + 12345) >>> 0; return hs / 2 ** 32; };
    const heads = ['Authorizatio' + '%6e: Bearer ', 'Au' + '&#116;horization: Bearer ', 'Authorization' + '&#58; Bearer ', 'Authorization' + '%3A Bearer '];
    let hleak = 0;
    for (const h of heads) {
      const text = 'x ' + h + pw + ' done';
      for (let k = 0; k < 150; k++) {
        const cuts = new Set<number>();
        const n = 1 + Math.floor(hr() * 4);
        while (cuts.size < n) cuts.add(1 + Math.floor(hr() * (text.length - 1)));
        const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
        if (showsAny(pts.slice(1).map((q, i) => text.slice(pts[i], q)), pw)) hleak++;
      }
      assert.ok(!showsAny(['x ' + h.slice(0, h.length - 6), h.slice(h.length - 6) + pw + ' done'], pw), `#1320 decoded brain: a header written in such a form, cut inside its scheme word, hides the value (${heads.indexOf(h)})`);
    }
    assert.strictEqual(hleak, 0, '#1320 decoded brain: random cuts over a header written in such a form never show the value');
    // independent differential of PR 1899: a header name glued after a mark, with a letter in such a form, cut inside the scheme word: read as before FR-188 (as main)
    for (const mark of ['(', '[']) for (const name of ['Au' + '&#116;horization', 'Authorizatio' + '%6e']) {
      assert.ok(!showsAny(['x' + mark + name + ': Bea', 'rer ' + pw + ' done'], pw), `#1320 decoded brain: a header name in such a form glued after a mark hides the value (${mark}${name.length})`);
    }
    // independent differential of PR 1899: a token the decoded reading masks early, then a hidden character, a keyword and a password in a later piece: the views
    // show nothing the reading with the decoded reading off hides
    {
      const t = 'Authorization: Bearer gh' + 'p_' + body.slice(0, 10) + '&#104;' + body.slice(11) + '\u200bmysql -p' + pw;
      for (const at of [40, 50, 60]) assert.ok(!showsAny([t.slice(0, at), t.slice(at)], pw), `#1320 decoded brain: a token masked early keeps a later password hidden (${at})`);
    }
    // round 4: a short value after a header, then a hidden-character entity cut in pieces (a lone `&` at the end of a piece too), then the rest: never shown,
    // after the header written plainly (a gap on main, the same code) and in such a form
    {
      const v = 'O4tb3ay' + 'bVwXpNvbq';
      let qs = 18994;
      const qr = (): number => { qs = (Math.imul(qs, 1103515245) + 12345) >>> 0; return qs / 2 ** 32; };
      let qleak = 0;
      for (const h of ['x Authorization: Bearer Ab3C', 'x Authorization' + '&#x3a;Bearer Ab3C']) for (const ent of ['&#8203;', '&#173;', '&#6158;', '&#65279;', '&#x200b;']) {
        const t = h + ent + v + ' done';
        assert.ok(!showsAny([h + '&', ent.slice(1) + v + ' done'], v), `#1320 decoded brain: a lone & at the end of a piece after a header value is held (${h.length} ${ent.length})`);
        for (let k = 0; k < 20; k++) {
          const cuts = new Set<number>([h.length + 1 + Math.floor(qr() * (ent.length - 1))]);
          // a second cut inside the entity or before it; a cut right after a whole entity before the rest shows on main too ([KNOWN GAP], FR-188, listed on #1320)
          if (qr() < 0.5) cuts.add(1 + Math.floor(qr() * (h.length + ent.length - 1)));
          const pts = [0, ...[...cuts].sort((x, y) => x - y), t.length];
          if (showsAny(pts.slice(1).map((q, i) => t.slice(pts[i], q)), v)) qleak++;
        }
      }
      assert.strictEqual(qleak, 0, '#1320 decoded brain: random cuts inside an entity after a header value never show the rest');
    }
    // round 3: a separator in such a form glued to a partial scheme word
    for (const sepForm of ['&#x3a;', '&#58;', '%3A', '&colon;']) {
      assert.ok(!showsAny(['x Authorization' + sepForm + 'Bea', 'rer ' + pw + ' done'], pw), `#1320 decoded brain: a separator in such a form glued to a partial scheme word hides the value (${sepForm.length})`);
    }
    assert.ok(!showsAny(['x Authorization' + '&#58;B', 'earer ' + pw + ' done'], pw), '#1320 decoded brain: a separator in such a form glued to one letter of the scheme word hides the value');
    // a whole scheme word glued to a separator in such a form, the value in the next piece (the word loop of the held-head check reads the decoded word)
    assert.ok(!showsAny(['x Authorization' + '&#58;Bearer', ' ' + pw + ' done'], pw), '#1320 decoded brain: a scheme word glued to a separator in such a form hides the value');
  }
  // round 3: a held form right after a raw value head the stream holds (a header name and the start of a token): the held form is never folded away
  {
    const v = 'bgEhq5' + 'EEId94' + '3tg4zGF';
    const head = 'token: gl' + 'pat-F';
    for (const chunks of [[head + '&#820', '3;' + v + ' done'], [head + '&#', '820', '3;' + v + ' done'], [head, '&#820', '3;' + v + ' done']]) {
      assert.ok(!showsAny(chunks, v), `#1320 decoded brain: a held form after a held value head keeps the value hidden (${chunks.length} pieces, ${chunks[0].length})`);
    }
    let hs = 1899_3;
    const hr = (): number => { hs = (Math.imul(hs, 1103515245) + 12345) >>> 0; return hs / 2 ** 32; };
    let held = 0;
    for (const text of [head + '&#8203;' + v + ' done', 'password=gl' + 'pat-F&#8203;' + v + ' done', head + '&#x200b;' + v + ' done']) {
      const formAt = text.indexOf('&#');
      for (let k = 0; k < 100; k++) {
        const cuts = new Set<number>([formAt + 1 + Math.floor(hr() * 6)]);
        const n = Math.floor(hr() * 3);
        while (cuts.size < 1 + n) cuts.add(1 + Math.floor(hr() * (text.length - 1)));
        const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
        if (showsAny(pts.slice(1).map((q, i) => text.slice(pts[i], q)), v)) held++;
      }
    }
    assert.strictEqual(held, 0, '#1320 decoded brain: random cuts with a held form after a held value head never show the value');
  }
  // round 5: a tool call clears a stream's reference reading with its text, so plain text after it is shown as written
  {
    let st = feed(fresh(), [{ type: 'user' }], 1);
    for (const ev of [{ type: 'thinking', delta: 'R' + '&D: set Authorization: Bearer' }, start('bash', { command: 'ls' }), { type: 'thinking', delta: 'Verifying results now' }]) st = feed(st, [ev], 1);
    assert.strictEqual(st.buf, 'Verifying results now', '#1320 decoded brain: plain text after a tool call is shown as written (the reference reading is cleared)');
  }
  const forms = ['&#95;', '&#x5f;', '&#95', '&lowbar;', '%5F', '%255F', '&#000095;'];
  const tails = ['&#8203;', '&#8203', '%2D', '&#46;'];
  let seed = 1899;
  const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
  let runs = 0;
  const leaked: string[][] = [];
  for (const form of forms) for (const mid of tails) {
    const text = 'x gh' + 'p' + form + body.slice(0, 20) + mid + body.slice(20, 36) + ' done';
    const formAt = [text.indexOf(form), text.indexOf(mid, 4 + form.length)];
    for (let k = 0; k < 60; k++) {
      const cuts = new Set<number>();
      // one cut inside each form, then random ones
      for (const [at, len] of [[formAt[0], form.length], [formAt[1], mid.length]]) cuts.add(at + 1 + Math.floor(rnd() * (len - 1)));
      const n = Math.floor(rnd() * 3);
      while (cuts.size < 2 + n) cuts.add(1 + Math.floor(rnd() * (text.length - 1)));
      const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
      const chunks = pts.slice(1).map((q, i) => text.slice(pts[i], q));
      runs++;
      if (showsAny(chunks, body)) leaked.push(chunks);
    }
  }
  assert.strictEqual(runs, forms.length * tails.length * 60, '#1320 decoded brain: every random cut was fed');
  // a ratchet, not zero: a state that holds a mask, then a piece, then fewer than 8 letters and digits of the token's rest keeps them readable until the next piece
  // (FR-182's [KNOWN GAP], the same with any piece); a frozen main shows a piece of the token in every one of these runs (1680), and in no state less than this branch
  assert.ok(leaked.length <= 26, `#1320 decoded brain: cuts inside the forms that show a piece of the token may only go down (${leaked.length} > 26): ${JSON.stringify(leaked.slice(0, 2))}`);
}

// spec 012 FR-187 (review of PR 1872): a secret name glued to a token's end, streamed in pieces: no cut shows the value, for each separator form
{
  const tok = 'gh' + 'p_' + 'Zq3' + 'x'.repeat(16) + 'K9m' + 'p'.repeat(14);
  const val = 'Vq7' + 'v0T' + 'wQ4';
  const pw = 'pass' + 'word';
  const forms = ['=' + val, ' = ' + val, '="' + val + '"', ': ' + val, ': "' + val + '"', '":"' + val + '"', '=>' + val, ':=' + val, '\\":\\"' + val + '\\"', ':' + val];
  let seed = 1872;
  const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
  // review of PR 1872, round 3: every state after each delta (and after the turn's next step) is checked for any 4-character piece of the value, not only the final text
  const pieces = (v: string): string[] => Array.from({ length: v.length - 3 }, (_x, i) => v.slice(i, i + 4));
  const showsAny = (chunks: string[], v: string): boolean => {
    let st = feed(fresh(), [{ type: 'user' }], 1);
    const ps = pieces(v);
    for (const delta of [...chunks.map((d) => ({ type: 'thinking', delta: d })), start('bash', { command: 'ls' })]) {
      st = feed(st, [delta], 1);
      const out = JSON.stringify(st);
      if (ps.some((p) => out.includes(p))) return true;
    }
    return false;
  };
  const shows = (chunks: string[]): boolean => showsAny(chunks, val);
  let runs = 0;
  const leaked: string[][] = [];
  for (const form of forms) {
    const text = 'x ' + tok + pw + form + ' done';
    assert.ok(!shows([text]), `#1320 brain: the whole text hides the value (${form.replace(val, 'V')})`);
    for (let k = 0; k < 750; k++) {
      const n = 1 + Math.floor(rnd() * 5);
      const cuts = new Set<number>();
      if (k % 2 === 0) cuts.add(2 + tok.length); // half the runs are also cut right after the token (round 3)
      while (cuts.size < n) cuts.add(1 + Math.floor(rnd() * (text.length - 1)));
      const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
      const chunks = pts.slice(1).map((q, i) => text.slice(pts[i], q));
      runs++;
      if (shows(chunks)) leaked.push(chunks.map((c) => c.replace(val, 'V')));
    }
  }
  assert.strictEqual(runs, forms.length * 750, '#1320 brain: every random cut was fed');
  assert.deepStrictEqual(leaked.slice(0, 3), [], `#1320 brain: no random cut inside the token shows the value (${leaked.length} of ${runs} did)`);
  // round 4: the same random cuts, always with a cut right after the token, for values the named rules leave alone when written whole (a dotted value, a value on the
  // next line after a line continuation) and the backtick separator. Some of these show on main too ([KNOWN GAP], FR-187 round 4: a quoted or backtick value that reads
  // as a dotted name, a value after a line continuation), so the check is a ratchet: per form, how many of the cuts show a piece of the value may only go down. The
  // counts are main's (checked against a frozen main in the review); the round-2 fold showed more (46, 20 and 51 where these read 5, 12 and 14).
  const hard = ['cfg.' + val, 'cfg.x\\\n' + val];
  const hardForms = (v: string): Array<[string, string]> => [['=V', '=' + v], ['=`V`', '=`' + v + '`'], [':=V', ':=' + v], ['="V"', '="' + v + '"']];
  const hardCount: Record<string, number> = {};
  seed = 18724; // its own seed, so the counts do not move when the loop above changes
  for (const [hi, v] of hard.entries()) for (const [fk, form] of hardForms(v)) {
    const key = (hi ? 'next line ' : 'dotted ') + fk;
    hardCount[key] = 0;
    const text = 'x ' + tok + pw + form + ' done';
    for (let k = 0; k < 60; k++) {
      const n = 1 + Math.floor(rnd() * 4);
      const cuts = new Set<number>([2 + tok.length]);
      while (cuts.size < n + 1) cuts.add(2 + tok.length + 1 + Math.floor(rnd() * (text.length - tok.length - 3)));
      const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
      if (shows(pts.slice(1).map((q, i) => text.slice(pts[i], q)))) hardCount[key]++;
    }
  }
  const HARD_RATCHET: Record<string, number> = { 'dotted =V': 0, 'dotted =`V`': 5, 'dotted :=V': 0, 'dotted ="V"': 60, 'next line =V': 12, 'next line =`V`': 14, 'next line :=V': 13, 'next line ="V"': 60 };
  assert.deepStrictEqual(Object.keys(hardCount).sort(), Object.keys(HARD_RATCHET).sort(), '#1320 brain round 4: every hard form is counted');
  // round 4: a token glued to a separator at the end of a piece is no header name: its raw head is never held while the value is awaited
  for (const second of ['cfg.' + 'Vq7Ab1Cd2 done', '`cfg', 'Vq7' + 'v0TwQ4 done']) assert.ok(!showsAny(['x ' + tok + '=', second], tok.slice(4)), `#1320 brain round 4: a token before a separator is not held raw (${second.slice(0, 4)})`);
  for (const key of Object.keys(HARD_RATCHET)) assert.ok(hardCount[key] <= HARD_RATCHET[key], `#1320 brain round 4: cuts after the token that show a ${key} value may only go down (${hardCount[key]} > ${HARD_RATCHET[key]})`);
  // round 3: a stream cut right after the token, the name and its separator in the next piece, then a value the named rules leave alone (a dotted name; a quoted
  // one with a line continuation and a long value on the next line): hidden as on main, no piece of it shows
  const dotted = 'cfg.' + 'Vq7' + 'Ab1' + 'Cd2';
  const long = 'Ab1Cd2' + 'Ef3Gh4' + 'Ij5Kl6Mn';
  const regress: Array<[string, string[], string]> = [
    ['a dotted value', ['x ' + tok, pw + '=' + dotted + ' done'], dotted.slice(4)],
    ['a dotted value in a backtick, split', ['x ' + tok, pw + '=`' + dotted.slice(0, 9), dotted.slice(9) + ' done'], dotted.slice(4)],
    ['a backtick value, a line continuation and a long value', ['x ' + tok, pw + '=`cfg.x\\\n' + long], long],
    ['the separator alone, then the value', ['x ' + tok, 'api_' + 'key:=', 'cfg.x\\\n' + long + ' done'], long],
  ];
  for (const [label, chunks, v] of regress) assert.ok(!showsAny(chunks, v), `#1320 brain round 3: a cut right after the token hides the value (${label})`);
}

// spec 012 FR-190 (issue #1320): a value split across a line break after a secret name, streamed in pieces at random cuts. The brain reads it with the shared step,
// so it is checked against the reading without it (`withoutContinuation`, the reading as before) run on the same pieces: no state shows a piece of the value that
// the reference state hides, the whole text hides it, and the runs that show a piece mid-stream only go down. Invented values built from pieces.
{
  const v1 = 'Qz7' + 'Wx4' + 'Lk9' + 'Tb2';
  const v2 = 'Rt3' + 'Mn8' + 'Pb5' + 'Hc6';
  const val = v1 + v2;
  const ps = Array.from({ length: val.length - 3 }, (_x, i) => val.slice(i, i + 4));
  const states = (chunks: string[]): string[] => {
    let st = feed(fresh(), [{ type: 'user' }], 1);
    const out: string[] = [];
    // the reference streams kept beside a stream (`ref`, `cref`: the readings with a step off, as on main) are left out: they are what the state is compared with
    for (const delta of [...chunks.map((d) => ({ type: 'thinking', delta: d })), start('bash', { command: 'ls' })]) { st = feed(st, [delta], 1); out.push(JSON.stringify(st, (k, v) => (k === 'ref' || k === 'cref' ? undefined : v))); }
    return out;
  };
  let seed = 1320;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  let runs = 0, headRuns = 0, refRuns = 0, headLast = 0, refLast = 0;
  const more: string[] = [];
  for (const n of ['API_' + 'KEY=', '--to' + 'ken=', 'GH_' + 'TOKEN=', 'Authorization: ' + 'Bearer ', 'DB_' + 'PASSWORD=', 'X-Api-' + 'Key: ']) {
    for (const [bk, b] of [['form 1', '\\\n'], ['form 2', '\\\r\n'], ['form 3', '^\r\n'], ['form 4', '\n'], ['form 5', '\r\n']]) {
      const text = 'x ' + n + v1 + b + v2 + ' done';
      const whole = states([text]);
      assert.ok(!ps.some((p) => whole[whole.length - 1].includes(p)), `#1320 continuation brain: the whole text hides the value (${bk})`);
      for (let k = 0; k < 30; k++) {
        const cuts = new Set<number>();
        const c = rnd(5);
        while (cuts.size < c) cuts.add(1 + rnd(text.length - 1));
        const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
        const chunks = pts.slice(1).map((q, i) => text.slice(pts[i], q));
        const h = states(chunks);
        const r = R.withoutContinuation(() => states(chunks));
        runs++;
        let hs = false, rs = false;
        for (let i = 0; i < h.length; i++) {
          const sh = ps.filter((p) => h[i].includes(p));
          const sr = ps.filter((p) => r[i].includes(p));
          if (sh.length) hs = true;
          if (sr.length) rs = true;
          if (sh.some((p) => !sr.includes(p))) more.push(`${bk} state ${i}`);
        }
        if (ps.some((p) => h[h.length - 1].includes(p))) headLast++;
        if (ps.some((p) => r[r.length - 1].includes(p))) refLast++;
        if (hs) headRuns++;
        if (rs) refRuns++;
      }
    }
  }
  // review of PR 2001: streams of other shapes, cut at up to 8 places (a reference stream with the step off now runs beside the brain's own once a piece holds a line
  // break), and two streams of the review: no state shows a word the same state with the step off hides
  const U = String.fromCharCode(0x202e);
  // a piece of 5 characters of an invented value (the views pick their lines differently, so a word around a mask is no measure; the value's pieces are)
  const piecesOf = (vals: string[]): string[] => vals.flatMap((v) => Array.from({ length: Math.max(0, v.length - 4) }, (_x, i) => v.slice(i, i + 5)));
  const lockStep = (chunks: string[], label: string, vals: string[]): void => {
    const h = states(chunks);
    const r = R.withoutContinuation(() => states(chunks));
    const vp = piecesOf(vals);
    for (let i = 0; i < h.length; i++) {
      const extra = vp.filter((p) => h[i].includes(p) && !r[i].includes(p));
      assert.deepStrictEqual(extra, [], `#1320 continuation brain: state ${i} shows no piece of a value the reading without the step hides (${label})`);
    }
  };
  lockStep(['> ' + 'To' + 'ken ' + '4du65', 'mcCAwO\\\r\nOsSuKbLNmTbszQ\\\r\nk\\\r\n', 'l3wo8', 'v', 'WMw\r\n2. Second item'], 'review stream 1', ['4du65' + 'mcCAwO', 'OsSuKbLNmTbszQ', 'l3wo8' + 'vWMw']);
  lockStep(['``', '`\n' + 'pass' + 'word', '=R1siWe' + U, '^\nQxlBLv' + U + '^\n', 'H6JaLk1s7d8hk/K3SnLoRwqxs4V', 'Ow='], 'review stream 2', ['R1siWe', 'QxlBLv', 'H6JaLk1s7d8hk', 'K3SnLoRwqxs4VOw']);
  const shapes = ['> ' + 'To' + 'ken ' + v1 + '\\\r\n' + v2 + '\\\r\nk\\\r\n' + v1.toLowerCase() + '\r\n2. Second item', '``\n' + 'pass' + 'word=' + v1 + U + '^\n' + v2 + U + '^\n' + v1 + v2 + '/K3', 'x API_' + 'KEY=' + v1 + '\n' + v2 + '\n' + v1 + '\n- next', 'Bearer ' + v1 + '\r' + v2 + ' done'];
  for (const [si, text] of shapes.entries()) for (let k = 0; k < 40; k++) {
    const cuts = new Set<number>();
    const c = 1 + rnd(8);
    while (cuts.size < c) cuts.add(1 + rnd(text.length - 1));
    const pts = [0, ...[...cuts].sort((x, y) => x - y), text.length];
    lockStep(pts.slice(1).map((q, i) => text.slice(pts[i], q)), `shape ${si}, run ${k}`, [v1, v2, v1.toLowerCase()]);
  }
  assert.strictEqual(runs, 6 * 5 * 30, '#1320 continuation brain: every random cut was fed');
  assert.deepStrictEqual(more.slice(0, 3), [], `#1320 continuation brain: no state shows a piece the reading without the step hides (${more.length})`);
  // a ratchet, not zero: mid-stream a state can still show part of the value for a moment (FR-182's [KNOWN GAP]); the reading as before shows one in more runs
  // after the next step too (a piece the brain kept before the step stays in its history, as on main)
  assert.ok(headLast <= refLast, `#1320 continuation brain: after the next step no more runs show a piece than with the reading as before (${headLast}, before ${refLast})`);
  assert.ok(headRuns < refRuns, `#1320 continuation brain: fewer runs show a piece than with the reading as before (${headRuns} of ${runs}, before ${refRuns})`);
}

// spec 012 FR-190 (review of PR 2001, round 2): a step target (command, URL, query) is masked twice (the shared mask, then the brain's own pass). With the step on, the
// first mask already hides a value's middle line, so the second pass no longer read mask, middle and a short last line as one value, and the last line showed where
// the reading as before hid it. The target is masked once more with the step off and shows nothing that reading hides (the brain's own `contBoth`), cut as the
// view cuts it. Invented values, built from pieces.
{
  const targetOf = (tool: string, args: unknown): string => {
    const st = feed(fresh(), [{ type: 'user' }, start(tool, args)], 1);
    return currentStep(st)?.target ?? '';
  };
  const kinds: Array<[string, string, string]> = [['bash', 'command', 'command'], ['web_fetch', 'url', 'URL'], ['grep', 'pattern', 'query']];
  let refHides = 0;
  for (const n of ['PGPASS' + 'WORD=', 'API_' + 'KEY=', 'pass' + 'word: ']) for (const [bk, b] of [['form 1', '\r'], ['form 2', '\n'], ['form 3', '\r\n']]) {
    for (const last of ['U6H' + '=', 'U6Hb' + '2k=', 'U6Hb' + '2kQ', 'zz' + '9']) {
      const t = n + 'q9F8' + 'eDK6' + b + 'aV8za' + 'A5TaQ' + 'aGVR+4' + 'IO/Uu' + b + last;
      const w = last.replace(/=$/, '');
      for (const [tool, key, kn] of kinds) {
        const ref = R.withoutContinuation(() => targetOf(tool, { [key]: t }));
        const out = targetOf(tool, { [key]: t });
        assert.ok(out !== '', `#1320 continuation brain target: the ${kn} target is not empty (${bk})`);
        if (ref.includes(w)) continue;
        refHides++;
        assert.ok(!out.includes(w), `#1320 continuation brain target: the ${kn} target shows no short last line the reading without the step hides (${bk}, ${w.length}): ${JSON.stringify(out)}`);
      }
    }
  }
  assert.ok(refHides >= 24, `#1320 continuation brain target: the reading without the step hides the last line in the review's combinations (${refHides})`);
  // review of PR 2001, round 3: the step's program word is read from the whole target kept the same way (the cut target is pinned above). With redact's masks no text
  // was found where the program word differs (about 8,000 composed texts), so it is pinned with a mask whose reading with the step on shows a continued value's piece
  // as the first word and whose reading without it hides it (the brain takes any mask; `BrainMask`)
  {
    const piece = 'Qz7' + 'Wx4' + 'Lk9';
    let off = false;
    const pm: BrainMask = {
      ...mask,
      withoutContinuation: <T,>(fn: () => T): T => { const was = off; off = true; try { return fn(); } finally { off = was; } },
      maskSecretCommand: () => (off ? '[redacted] make' : piece + ' make'),
    };
    let st = brainState(initBrain('Ada', pm), { type: 'user' }, ++clock, pm);
    st = brainState(st, start('bash', { command: 'API_' + 'KEY=' + piece.slice(0, 5) + '\n' + piece.slice(5) + ' make' }), ++clock, pm);
    const step = currentStep(st);
    assert.ok(step && step.target !== '', '#1320 continuation brain target: the stub command has a target');
    assert.ok(!step!.program.includes(piece.slice(0, 6)), `#1320 continuation brain target: the program word shows no piece the reading without the step hides: ${JSON.stringify(step!.program)}`);
    assert.ok(!step!.target.includes(piece.slice(0, 6)), `#1320 continuation brain target: the stub target shows no piece the reading without the step hides: ${JSON.stringify(step!.target)}`);
  }
  // the URL target takes the same union: redact's URL mask reads no value across the break before the brain's pass (no text of the review regresses there), so it is
  // pinned with a mask whose URL mask reads the text as the command mask does (the brain takes any mask; `BrainMask`)
  {
    const um: BrainMask = { ...mask, maskSecretUrl: (u: unknown) => R.maskSecretCommand(u) };
    const urlTarget = (u: string): string => {
      let st = brainState(initBrain('Ada', um), { type: 'user' }, ++clock, um);
      st = brainState(st, start('web_fetch', { url: u }), ++clock, um);
      return currentStep(st)?.target ?? '';
    };
    for (const [bk, b] of [['form 1', '\r'], ['form 2', '\n'], ['form 3', '\r\n']]) {
      const t = 'PGPASS' + 'WORD=' + 'q9F8' + 'eDK6' + b + 'aV8za' + 'A5TaQ' + 'aGVR+4' + 'IO/Uu' + b + 'U6Hb' + '2kQ';
      const ref = R.withoutContinuation(() => urlTarget(t));
      assert.ok(!ref.includes('U6Hb'), `#1320 continuation brain target: the reading without the step hides the URL's last line (${bk})`);
      assert.ok(!urlTarget(t).includes('U6Hb'), `#1320 continuation brain target: the URL target shows no short last line the reading without the step hides (${bk}): ${JSON.stringify(urlTarget(t))}`);
    }
  }
  // composed texts of the review on the command target (invented values, built from pieces): no listed piece shows; the one that hides more reaches further into a
  // long command, so the cut target shows nothing the reading without the step leaves out of its own cut either
  const rows: Array<[string, string]> = [
    [['Run: T', 'oken g', '\u202e\\\u000d\u000av5', 'fMbDMi', 'Ns\u202e\\\u000d\u000a', '++xxB8', '1Og3D/', 'oMIAlX', 'vMj0mg', '" expo', 'rt e\u200b\\', '\u000d\u000ayJy3', 'dd7dI6', 'gwoSjU', '\u200b\\\u000d\u000aB4', 'JYv0.e', 'yJWjUh', 'q9Kf6A', 'pUHVwP', 'vOPVkA', 'HeLmM7', '1h.-Yy', 'gxnCEl', '\u200b\\\u000d\u000aa4', '6U_vw7', 'gFQWKU', 'HgJ5BW', 'p" && ', 'xoxb-0', '\u200b`\u000a134', '904208', '\u200b`\u000a96-', 'IZvUUV', 'p\u200b`\u000amv', 'jvilSh', 'B4WFxh', 'F2e\u000d\u000a2', '. Seco', 'nd ite', 'm Run:', ' s\u000a\u2060- ', 'k-proj', '-UR4Hn', 'GyAHVQ', 'xRrNnh', 'zntTbY', 'QCN\u000a\u2060-', ' c\u000a\u2060- ', 'cL2xdK', 'CRfbc5', 't \\\u000a  ', '--watc', 'h'].join(''), 'vjvi jvil vilS ilSh lShB ShB4 hB4W B4WF 4WFx WFxh FxhF xhF2 hF2e proj UR4H R4Hn 4HnG HnGy nGyA GyAH yAHV AHVQ HVQx VQxR QxRr xRrN RrNn rNnh'],
    [['x eyJP', '2B^\u000d\u000a\u00ad', '> itfB', 'hGDa^\u000d', '\u000a\u00ad> KU', 'poK25e', 'B.eyJL', 'hvxfPP', 'vY4jUn', 'X5L9Q5', 'fUcXJ6', 'WTkow.', 't0LSYx', 'rSoSeN', 'p2QAm3', 'smsyf9', 'HDU_^\u000d', '\u000a\u00ad> CG', ' \\\u000a  -', '-watch', '\u000acurl ', '-H "?a', 'ccess_', 'token=', 'KMSXDV', 'OVROJG', 'MXXQWW', '\\\u000d  XE', 'IC\u000amys', 'ql -u ', 'root -', 'p21\u202e`\u000a', '338492', '53\u202e`\u000a8', '73170\u000a', '``` \\\u000a', '--toke', 'n _36b', '\u202e\u2029> 82', 'VJNeKu', '\u202e\u2029> u7', '1\u202e\u2029> 1', ' \\\u000a  -', '-watch'].join(''), '3170 82VJ 2VJN VJNe JNeK NeKu'],
    [['1. git', 'hub_pa', 't_Lwne', '^\u000d\u000aedg', 'XBqPbq', 'TPsSha', 'dme_X5', '58yqYZ', '3sC94M', 'WYzVKx', 'SV86Kc', 'Jcl9xu', '5vxE1K', 'mC6Uee', '0aNXON', 'ao8moh', 'IAR &&', ' -p035', 'a035\\\u000d', '> b3e6', 'f51301', '79b4e4', 'c90ffe', 'a8fd89', '935\\\u000d>', ' f9bf5', 'b3\u000a\u000aok', ' expor', 't clie', 'nt_sec', 'ret=73', '41519d', 'c9588\\', '\u000d> 74f', '471ee4', '91\\\u000d> ', '0" \\\u000a-', '-token', '=62f\u00ad^', '\u000d\u000a- 98', 'b15c04', '3\u00ad^\u000d\u000a-', ' 0d\u00ad^\u000d', '\u000a- 3ee', 'eb33f8', 'eab6b1', 'f05273', ' done'].join(''), '1f05 f052 0527 5273'],
    [['curl -', 'H "mys', 'ql -u ', 'root -', 'p711\u2060^', '\u000d\u000a\u200d   ', ' 65e8a', 'f8922c', '19a6c\u2060', '^\u000d\u000a\u200d  ', '  c225', '77b\u2060^\u000d', '\u000a\u200d    ', '966e44', '872fc1', 'e1ca\u000a`', '``\u000d\u000ax ', '$env:G', 'H_TOKE', 'N="DOF', '\u00ad\u000aXAOH', 'KXUGNX', 'BWYK\u00ad\u000a', 'OBVC\u000an', 'ext st', 'ep \\\u000ac', 'url -H', ' "$env', ':GH_TO', 'KEN="8', '4\ufeff`\u000a> ', '45\ufeff`\u000a>', ' 8\ufeff`\u000a>', ' 93921', '97'].join(''), '9392 3921 9219 2197'],
    [['> ey\u200b\\', '\u000d\u000aJf85', 'yjBRfE', 'VYaaDs', '2\u200b\\\u000d\u000ao', '\u200b\\\u000d\u000aBK', 'r.eyJL', '9xJLnP', 'RmSbaZ', 'hF1fiB', 'DuUDHw', 'whyIW.', '_etMK7', 'ts68AH', 'bASa4h', 'Oge8hX', 'Zt250Q', ' \\\u000a  -', '-watch', '\u000a1. se', 't GH_T', 'OKEN=8', 'ac\u00ad\u000d\u000d\u000a', '  0\u00ad\u000d\u000d', '\u000a  9db', '2d94b2', 'a372c\u00ad', '\u000d\u000d\u000a  4', '1aa266', '1a21d8', '1898e7', '356 x ', 'AKIAHU', 'DLUKV\u200d', '\u000a\u000a\u202eUGG', 'ZZJE5W'].join(''), 'GZZJ ZZJE ZJE5 JE5W'],
    [['Token ', '205bd1', '`\u000a> ad', '`\u000a> 84', 'f714e5', '2e428e', 'cce04d', '`\u000a> 1f', '61d8f6', ' done;', ' expor', 't --to', 'ken=ql', 'dwh\u200d\u2028-', ' ohwmn', '\u200d\u2028- df', 'a\u200d\u2028- a', '\u000d\u000a2. S', 'econd ', 'item\u000a\u000a', 'echo p', 'asswor', 'd: nf4', 'eZIq69', 'Nt4BqM', 'zPbU`\u000d', '\u000a\u0009IUcR', 'T7oPwy', '8Z6jU`', '\u000d\u000a\u0009=\u000an', 'ext st', 'ep\u000d\u000a- ', 'token:', ' pyyi4', 'cs3i\\\u000a', '\u200d  3kd', 'u542xy', '\\\u000a\u200d  h', 'kbgfg0', '5\u000anext', ' step'].join(''), 'hkbg kbgf'],
    [['ghp_Ki', 'kZ61NK', 'og5LAL', 'nFhNtJ', '5xFrYO', '4X2gXK', '^\u000a- HP', 'Q8 don', 'e\u000a\u000aech', 'o secr', 'et=DSQ', 'ZKPQTZ', 'WEEF\u000d\u200d', '\u0009FKDQE', 'H\u000a\u000aok\u000a', '\u000aexpor', 't eyJV', '87BLQ6', 'cjQP9y', 'G2Hjxj', 'u.ey\u2060^', '\u000d\u000a> J6', 'SVwldd', 'SbeFVZ', '0iPDDR', 'NFEMaK', 'M3J9t.', '7jmFmn', 'Qx4XJ4', 'tAr\u2060^\u000d', '\u000a> GDu', 'T\u2060^\u000d\u000a>', ' H0tcm', '9IkRaM', '\u000a\u000aok\u000a\u000a', '```\u000ae\u202e', '^\u000d\u000a- y', 'JDz2Wp', 'DwNxXL', 'QIdmLe', 'v9z.ey', 'JVuza2', 'Wz8a4B', '2VbNjJ', 'frxlAG', 'rglVpn', 'v.kzFW', 'sXXmA9', '8EcvOd', '86rdc\u202e', '^\u000d\u000a- q', 'sw3LwC', 'Ko'].join(''), 'qsw3 sw3L w3Lw 3LwC LwCK wCKo'],
    [['x "api', '_key":', ' "5474', '1\u200b`\u000d\u000a>', ' 26307', '25\u200b`\u000d\u000a', '> 0948', '\u000anext ', 'step &', '& echo', ' PGPAS', 'SWORD=', 'YNGMR\u202e', '\u2028XXYGE', 'SDXEW ', '\\\u000a  --', 'watch\u000a', 'echo e', 'yJ4geC', 'vw5\ufeff\\\u000d', '\u000aNZO5P', 'v87keI', 'sk.eyJ', 'wgkEHV', '\ufeff\\\u000d\u000aoH', 'KUEAOB', 'eqZ3qA', 'XFOvtJ', 'ej2Z.P', 'c61Ptd', 'gAB_Dt', 'yLZjdu', 'gueTSZ', 'RosyR ', 'done\u000d\u000a', 'Run: g', '\u0085- lpa', 't-99SC', 'MP2u1Y', 'rPUErx', 'F-zf"'].join(''), 'lpat 99SC 9SCM SCMP CMP2 MP2u P2u1 2u1Y u1Yr 1YrP YrPU rPUE PUEr UErx ErxF'],
    [['```\u000amy', 'sql -u', ' root ', '-pBW\ufeff\u2028', '> HMK\ufeff', '\u2028> MD\ufeff', '\u2028> LWC', 'IIMQPH', '"; - a', 'ws_sec', 'ret_ac', 'cess_k', 'ey = 4', 'f28b4b', 'a\u00ad\\\u000d\u200b9', 'a92ab8', 'b94334', '1744d0', 'b8693b', '60a89f', 'acd202', 'c7\u000anex', 't step', ' && - ', 'github', '_pat_Z', 'jYxfL2', '7C\u200b\u000d\u200b ', '   G8q', 'IEw60N', 'T0rk_U', 'q\u200b\u000d\u200b  ', '  Cc3Y', 'CvXG0z', '\u200b\u000d\u200b   ', ' dil73', 'gT8bBc', 'IplD3g', 'WVTBP0', 'd1FHGi', 'ugvE93', 'WW6ztI', '3fhlbf'].join(''), '8bBc bBcI BcIp cIpl IplD plD3 lD3g D3gW 3gWV gWVT WVTB VTBP TBP0 BP0d P0d1 0d1F d1FH 1FHG FHGi HGiu Giug iugv ugvE gvE9 vE93 E93W 93WW 3WW6 WW6z W6zt'],
    [['echo G', 'H_TOKE', 'N=099^', '\u000a66524', '03^\u000a51', '8\u000a\u000aok\u000d', '\u000aexpor', 't gith', 'ub_pat', '_pEhqm', 'M5ylkU', 'KnbY\\\u000a', '  mo6w', 'QnP_91', '3cAIEW', 'ohMdOd', 'EFiMTK', 'lODyrc', 'yjsdp0', 'J3wNte', 'ynITyW', 'xTXUYU', 'oZDQkp', '\\\u000a  GG', '4 \\\u000a  ', '--watc', 'h\u000atoke', 'n: 67f', 'fc\u200b\u000a\u202e-', ' 757a\u200b', '\u000a\u202e- 3a', 'ac884e', '\u200b\u000a\u202e- 2', 'c1b" &', '& Toke', 'n 07\u202e\\', '\u000a1105\u202e', '\\\u000a01\u202e\\', '\u000a36013', '536859', '59 \\\u000a ', ' --wat', 'ch'].join(''), '3601 6013 0135 1353 3536 5368 3685 6859 8595 5959'],
    [['export', ' secre', 't=GB\ufeff\\', '\u000at\ufeff\\\u000aa', 'ShvrsJ', '9pB1kx', '9gwfMH', 'sPZmmc', '\ufeff\\\u000aR5o', 'jg8_Ay', 'q27 \\\u000a', '  --wa', 'tch\u000d\u000a>', ' --tok', 'en=Mr4', 'VbW\u200d`\u000a', '> 22Tb', 'rnAWCj', 'ujpn\u200d`', '\u000a> odK', '\u200d`\u000a> v', '7\u000a\u000aok\u000a', '> --pa', 'ssword', ' f3511', 'c\u200d\u000d\u000a3c', '56fe5f', '63e14 ', 'done c', 'url -H', ' "xo\ufeff\u2029', '\u0009xb-76', '655674', '9986-y', 'dpbxcu', 'vjUJZj', 'j4Q1An', 'SZhlP\u000a', '\u000aok'].join(''), '7665 6655 6556 5567 5674 6749 7499 4998 9986 ydpb dpbx pbxc bxcu'],
    [['1. API', '_KEY=Y', 'WQAL\\\u000a', '> DPLO', 'DGCDJB', 'QWBW \\', '\u000a  --w', 'atch x', ' ghp_b', 'bm\u000d   ', ' DrGjq', 'yt7Wqg', 'vWaC2y', 'jgK1f\u000d', '    IR', 'efqSXz', 'BIc"\u000d\u000a', 'sk-pro', 'j-vdy\\', '\u000a\u202e> JZ', 'qobi8k', 'fHfCDE', 'edxVGS', 'W2j9di', 'B60Wrk', 'FOuY9\u000a', '\u000aok\u000a1.', ' g\u202e\\\u000d\u000a', '\u0009ithub', '_pat_D', 'SeGk0g', 'vO7unU', 'FcA1uR', 'IV6_HI', 'e7kzlE', 'VhoVNc', '0T2jYa', 'NNDKuo', '6zX2w\u202e', '\\\u000d\u000a\u00099Y', 'eWk19C', 'TsLYoY', '8B8PV9', '0hBtkf', 'O6 \\\u000a ', ' --wat', 'ch'].join(''), '9YeW YeWk eWk1 Wk19 k19C 19CT 9CTs CTsL TsLY sLYo LYoY YoY8 oY8B Y8B8 8B8P B8PV 8PV9 PV90 V90h 90hB 0hBt hBtk Btkf tkfO kfO6'],
    [['Run: A', 'PI_KEY', '=CzPVk', '\u200d^\u000a  n', 'LO9\u200d^\u000a', '  s895', '8u-DUs', 's8\u000ax s', 'et GH_', 'TOKEN=', '5XS\ufeff\\\u000d', 'iPqdn0', 'VHrTU9', 'x5mj5S', '6rYiKx', 'Vp49Ek', 'Rj"\u000d\u000a-', ' AKIAS', 'XAR\\\u000a>', ' K2UJB', '\\\u000a> CO', 'UU2K5"', '\u000a- git', 'hub_pa', 't_o9EJ', 'KF0qhA', 't2POdQ', '25mlpk', '_xzQvx', 'mir\\\u000d\u000a', '\u00ad> q9A', 'cTVtOO', 'I8RlsQ', 'XIGWiL', 'pYbuD8', 'eyIb\\\u000d', '\u000a\u00ad> eN', 'n90hxP', 'C3S2Ui', 'GAuYK1', '"'].join(''), 'hxPC xPC3 PC3S C3S2 3S2U S2Ui 2UiG UiGA iGAu GAuY AuYK uYK1'],
    [['export', ' API_K', 'EY=uXd', 'J7o\\\u000d\u000a', '- J/Rz', 'Mm8UR4', 'HnGy\\\u000d', '\u000a- AH=', ' \\\u000aRun', ': ghp_', '4ijamB', 'kf\u00ad`\u000d\u000a', 'hw\u00ad`\u000d\u000a', 'Q19V6h', 'jhDFi7', 'rK0V\u00ad`', '\u000d\u000ay5Ib', 'ZIeEBb', ' Run: ', 'x\u200b\u2029oxb', '-67447', '\u200b\u20295259', '968-W\u200b', '\u2029xuFV2', '4OjRJJ', 'WiiB2l', 'RJCXGZ', ' \\\u000a  -', '-watch', ' \\\u000ax x', 'oxb-68', '87\ufeff\u000a\u000a1', '973309', '8-DuXY', 'r1stm1', 'YjMllM', 'lWmLCE', 't4\u000anex', 't step'].join(''), '1YjM YjMl jMll MllM llMl lMlW MlWm'],
    [['1. AKI', 'AEM\u200b^\u000d', '\u000a> BDL', 'Y7ACMJ', 'KTEM6 ', 'done\u000d\u000a', '```\u000aPG', 'PASSWO', 'RD=n52', 'qug003', 'efg5y1', 'o2hix4', '7sr\\\u000a-', ' o0"\u000ax', ' expor', 't OPEN', 'AI_API', '_KEY=6', '\u2060^\u000a\u0009A9', '0\u2060^\u000a\u0009E', 'zf3UU\u2060', '^\u000a\u0009gqz', 'b\u000a```\u000d', '\u000aeyJm6', 'ivGxVV', 'OjT7Sp', 'U6oKqq', '.eyJUC', 'QhhgVm', '2Ygcly', 'i9xmgj', 'H2PpHy', '\u2060\\\u000d\u000a  ', 'lqFl.e', 'UH5PXS', 'KDZVXU', 'FLtfIy', 'YANEjT', 'C-czR\u000d', '\u000a2. Se', 'cond i', 'tem'].join(''), 'VXUF XUFL UFLt FLtf LtfI tfIy fIyY IyYA yYAN YANE ANEj NEjT EjTC'],
    [['```\u000aey', 'JQjDKr', 'QSP\u202e^\u000a', '\u2060  8o7', '6AvBuv', 'y\u202e^\u000a\u2060 ', ' V3.ey', 'JQSkxL', '7hqipX', 'OX9fbA', 'qRM1Kd', '19PofM', 'i.CDSE', '6xu5ND', 'DXn1d7', '0CHAf\u202e', '^\u000a\u2060  n', 'PDVg_h', 'Co" &&', ' > glp', 'at-\u200d\\\u000a', 'HJY2Ic', 'zX\u200d\\\u000aM', 'uG0tqM', '\u200d\\\u000aaI9', 'DV\u000anex', 't step', '; expo', 'rt OPE', 'NAI_AP', 'I_KEY=', 'ca0\u200b\u000d\u000d', '\u000a64468', 'c\u200b\u000d\u000d\u000a5', '97e950', '7e6f3e', '\u000a\u000aok'].join(''), '597e 97e9 7e95 e950 9507 507e 07e6 7e6f e6f3 6f3e'],
    [['github', '_pat_x', 'Fa\u200b`\u000a>', ' E4nDP', '1\u200b`\u000a> ', 'ocq7cj', 'lR0Psp', 'R_vuOR', 'ZXvr9m', 'G4uk3h', 'PdzNIT', 'STOpqj', '3GzWzI', 'TAVVQD', 'Mulec3', 'oqpXmP', 'E\u200b`\u000a> ', '1zKMWp', '\u000a``` &', '& echo', ' sk\u202e^\u000a', '-proj-', 'UgNUFG', '9__\u202e^\u000a', 'lEZOaO', 'f-AGNa', '1ZfvTz', 'RJ3Aez', '8r\u202e^\u000aD', '7_h8\u000an', 'ext st', 'ep exp', 'ort "a', 'pi_key', '": "mV', 'Uy\u200b\u2028  ', '  DV0i', 'EoPDI6', 'igp2oG', 'EJf\u200b\u2028 ', '   7 d', 'one\u000a\u000aR', 'un: X-', 'Api-Ke', 'y: C\u000d\u000d', '\u000a\u0009AOK\u000d', '\u000d\u000a\u0009UCO', 'Y\u000d\u000d\u000a\u0009M', 'JXXGF\u000a', '```'].join(''), 'mVUy'],
    [['echo A', 'PI_KEY', '=Ly`\u000a-', ' CCdk7', 'CIhbCY', '`\u000a- CO', '9Zm4 \\', '\u000a- "ap', 'i_key"', ': "y2p', 'ZbGon8', 'AuUiAm', 'eYi-\u200b\\', '\u000d\u000a\u200b_rB', 'gzn654', 'Y5 \\\u000a ', ' --wat', 'ch && ', 'x --pa', 'ssword', ' 9rwfy', '\u200b\u000dfiID', 'D5A\u200b\u000d6', 'P\u200b\u000duRL', 'Inb do', 'ne && ', 'sk-\u202e\u000d\u000a', '\ufeff  pro', 'j-Mnvn', 'qLsmF5', '9O6eer', 'llKJi\u202e', '\u000d\u000a\ufeff  8', '-zMN22', 'AF\u202e\u000d\u000a\ufeff', '  teaQ', 'g22ZLL', ' \\\u000a  -', '-watch'].join(''), 'aQg2 Qg22'],
    [['Run: a', 'ws_sec', 'ret_ac', 'cess_k', 'ey = 7', '722215', '31\u202e^\u000d\u000a', '025129', '75706\u000d', '\u000a2. Se', 'cond i', 'tem; g', 'lpat\u2060\u000a', '\u000a    -', 'kQ5Qqo', 'HM_\u2060\u000a\u000a', '    b5', 'B9VL7B', 'C\u2060\u000a\u000a  ', '  4F c', 'url -H', ' "gith', 'ub_pat', '_5C0da', 'a6XcNS', '2\u202e^\u000a- ', 'zlcYQC', 'Vt6k_S', 'iDWKsI', 'FlHHyV', 'CyX7H8', 'C9oKeq', 'I4MyQM', 'En\u202e^\u000a-', ' vn0hj', 'EpKwfh', 'K0mf8a', 'Y8UX\u202e^', '\u000a- MiB', '14\u000a\u000aok'].join(''), 'MiB1 iB14'],
    [['PGPASS', 'WORD=U', 'rMMV6l', '\ufeff\u2028    ', '7ul92b', '5u4" c', 'url -H', ' "--pa', 'ssword', ' DRk-\ufeff', '\u000aXk6Um', 'pRqtqH', 'qo06\u000a`', '``; ec', 'ho gi^', '\u000d\u000a\u200b  t', 'hub_pa', 't_csci', '2aQup3', 'GNQAow', 'yxuuF3', '_uKhX8', '^\u000d\u000a\u200b  ', 'fXrY54', '1nEQfR', 'vn8snf', 'V3Qj^\u000d', '\u000a\u200b  fr', 'JM4moT', 'YH9eEa', 'BVEzZJ', '3l1Hjd', 'TPewI3', '" gith', 'ub_pat', '_Bb9nE', '5FSQje', 'nwZnwg', 'aT1Kr_', 'WcBAKG', 'kP2SMd', 'woFlE1', 'Zj0GEX', 'ALt0gS', '75Nps\u200d', '\u2029- yIt', '0RtLIJ', 'gvtzmO', 'RlnDtL', 'YgA"'].join(''), 'It0R t0Rt 0RtL RtLI tLIJ LIJg IJgv Jgvt gvtz vtzm tzmO zmOR mORl ORln RlnD lnDt nDtL DtLY tLYg LYgA'],
    [['echo A', 'PI_KEY', '=3QmSz', '+z534t', 'a`\u000d\u000a/L', 'xiGDb9', 'JrHW`\u000d', '\u000aE don', 'e; x g', 'ithub_', 'pat_Gt', 'a\u00ad^\u000ajH', 'YXAZSx', '2JRyRE', 'A300F_', 'aybBc5', 'EfF6uk', 'LT3fkI', 'ZjoTTr', 'F8g50p', '0dNhrE', '\u00ad^\u000a14M', 'AdssUD', 'iT1ZTh', 'vB3xwY', 'xg\u000a\u000aok', ' && ex', 'port s', 'k\u000a\u000a\u2060-p', 'roj-d0', '27iyyN', 'Ur\u000a\u000a\u2060y', '4RLyIy', '-tJWwg', 'GXMGM\u000a', '\u000a\u2060S_dn', 'j0fimZ', 'JL"'].join(''), 'dnj0 nj0f j0fi 0fim fimZ imZJ mZJL'],
    [['1. xox', 'b-6305', '132901', '97-gO\u202e', '\\\u000ddXvl', 'FdsyMw', '6DlXZ7', 'R6\u202e\\\u000dL', '4Py"\u000ax', ' ghp_X', '4JWGxy', 'iZ\\\u000d  ', 'gop365', 'kVHEOA', 'N3pFOg', 'Zpi\\\u000d ', ' T1d\\\u000d', '  veu\u000a', '\u000ax $en', 'v:GH_T', 'OKEN="', '5M4Ud8', 'fh35l\u000d', '\u000aDTv \\', '\u000a- git', 'hub_pa', 't_V\u202e^\u000d', '\u000a> 2a3', 'haCbKy', 'w74JsI', 'ppU2YY', '_JHOum', '4T0Aes', 'l7vzgZ', 'a0rlt6', 'CzYqiY', '6si2OY', 'GvXLsv', 'vov6QH', 'NCAU5E', 'Eksava', ' \\\u000a  -', '-watch'].join(''), 'XLsv Lsvv svvo'],
    [['> eyJE', 'ttlMsN', 'NLhzxS', '8oGAtn', '\u202e\\\u000d\u000a\u2060N', '.eyJNL', 'xs5KVO', 'V8RPGB', 'mFURk1', 'tinea5', 'iwZQ.w', 'Z16pw5', 'ziYMzp', 'vZ2IPN', '6LVT5A', 'cZwxC ', '\\\u000a  --', 'watch ', '\\\u000a1. A', 'KIA4SJ', 'GRF`\u000d\u000a', '\u200d33P7N', 'V`\u000d\u000a\u200dT', 'M2`\u000d\u000a\u200d', '7 done', ' 1. se', 'cret=0', 'hQIQTi', 'hwe/\u2060`', '\u000ahQOA0', 'rvEG+\u2060', '`\u000aM\u2060`\u000a', '= \\\u000a  ', '--watc', 'h\u000a\u000a--p', 'asswor', 'd 1089', '686\u200d^\u000d', '\u000a> 084', '42\u200d^\u000d\u000a', '> 620\u200d', '^\u000d\u000a> 5', '158"'].join(''), '5158'],
    [['> eyJ\u00ad', '\\\u000dG0gr', 'HYwc4B', 'gGqAbn', 'zhOT.e', 'yJEqJp', '1OSJAA', 'OI4U8q', 'GsujRl', 'ylTWjG', 'kV.\u00ad\\\u000d', '58u-DU', 'ssIwDk', '0L_Czi', 'riwxVf', 'Y0HWXn', '\u000a```\u000a-', ' eyJ5G', 'EvCYe7', '5t6PwU', '7z3Yq0', '.eyJ6r', 'xtCpEW', 'ctIVwm', 'ezhQIW', 'AQEd9h', 'dJac.2', 'csA_qn', 'U5mJUC', '9ON\u202e\u000a\u000a', '0b0Lss', '1aFbOF', 'dW"\u000ax ', 'ghp_vV', 'YMqIlb', 's6xq4S', 'kt\ufeff`\u000aB', 'a9kHWK', 'SiJqz1', 'xQ73PS', 'h \\\u000aX-', 'Api-Ke', 'y: 74\u200d', '\u000d\u000d\u000a- 8', '\u200d\u000d\u000d\u000a- ', '22092\u200d', '\u000d\u000d\u000a- 6', '19809\u000a', 'next s', 'tep'].join(''), '2209 2092 6198 1980 9809'],
    [['export', ' token', ': Uckp', '5x12Uo', 'REBv1e', 'bwdR/Y', 'EpJTnx', '\u000aVMC2+', 'wRFhrP', 'nap6rE', '=\u000anext', ' step ', '\\\u000acurl', ' -H ""', 'api_ke', 'y": "x', 'QKRMY1', 'uQ5VaJ', 'QZTC4s', 'TJP5Wo', 'vtar1z', 'Zg85Q\u000d', '\u000a\u0009Rip7', 'LB\u000aRun', ': API_', 'KEY=hd', '157\u202e^\u000d', '\u000avt60t', 'ipxx13', 'upzc6t', 'lwq1 \\', '\u000a  --w', 'atch\u000d\u000a', 'echo g', 'ithub_', 'p\u00ad^\u000a  ', '  at_i', 'Ya3hqM', 'GiZAU2', 'efjJN2', 'Ty0_H5', 'tI4tMQ', 'sYGgmG', 'UkwBvr', 'GP10V4', 'CpFgcC', 'fems2s', 'LcShRa', 'Lc14ez', 'lbs8jw', 'HLs\u000a``', '`'].join(''), 'I4tM 4tMQ tMQs MQsY QsYG sYGg YGgm GgmG gmGU mGUk GUkw UkwB kwBv wBvr BvrG vrGP rGP1 GP10 P10V'],
    [['curl -', 'H "xox', 'b-6636', '8427\u200b\u000a', '\u000a  400', '9-60jv', 'QtPRqA', 'YbMlXy', 'IO5FPp', 'cY \\\u000a ', ' --wat', 'ch && ', 'Run: g', 'hp_\u200d\\\u000a', '\u2060xdo8B', 'xNLZ7c', 'y0qk\u200d\\', '\u000a\u2060DXLj', 'bTSnIp', 'uN4X5\u200d', '\\\u000a\u2060wvU', 'Fsj do', 'ne\u000a\u000aex', 'port -', '-token', ' ZUTCL', 'DOUSL\u0085', '- NTPU', 'OFVWV\u0085', '- FD\u0085-', ' FG Ru', 'n: "ap', 'i_key"', ': "pAa', 'Y38vLp', 'x\ufeff\u000d\u000d\u000a-', ' tF7r\ufeff', '\u000d\u000d\u000a- x', 'y0'].join(''), 'tF7r'],
    [['export', ' expor', 't OPEN', 'AI_API', '_KEY=8', '737\u000a- ', '405886', '66\u000d\u000a2.', ' Secon', 'd item', ' && --', 'passwo', 'rd yRw', 'whNAi\u000a', 'iXYgQc', '03IIP\u000a', 'zmH\u000amf', 'GE1JDs', '476rrC', 'H==\u000d\u000ax', ' eyJoa', 'FtZmtW', '0hfZyI', 'ecbjDE', '.eyJr0', '82ZEJe', 'Q0H92K', '\\\u000a\u0009Cus', 'QV\\\u000a\u0009D', 'pjtgKs', 'aUEl.-', 'rId6NI', 'mRSBYv', '4_QA5O', 'pvS5Bq', '_\\\u000a\u0009Ny', 'a7 \\\u000a ', ' --wat', 'ch\u000d\u000acu', 'rl -H ', '"sk-pr', 'oj-loy', '^\u000a\ufeff74-', 'IK9VeR', '-LeMI6', '^\u000a\ufeff12n', '_PMn1X', 'KT66s4', 'okuicB', 'L'].join(''), 'Nya7'],
    [['```\u000a?a', 'ccess_', 'token=', 'P0zt\u2060\\', '\u000d\u000a\u200b> D', 'gf3w2R', 'giS1ll', 'Q5CELH', 'zMgM0J', 'rzAHIq', 'URSb==', ' \\\u000a  -', '-watch', ' \\\u000aexp', 'ort -p', 'v92mmo', 'ogn\u202e\\\u000d', '\u000a\ufeff\u0009unk', 't250i5', '\u202e\\\u000d\u000a\ufeff\u0009', 'etsns3', 'cgh2h\u202e', '\\\u000d\u000a\ufeff\u00093', '\u000d\u000a2. S', 'econd ', 'item\u000a\u000a', '```\u000a--', 'token=', 'dykuwv', 'loq`\u000d\u000a', '\u2060    z', 'yagkn`', '\u000d\u000a\u2060   ', ' dsrq\u000a', 'export', ' AKIA\u2060', '\u000a\ufeffNIZI', 'QK6W2M', 'IKXJC7', '\u000d\u000a2. S', 'econd ', 'item'].join(''), 'NIZI IZIQ ZIQK'],
    [['echo p', 'asswor', 'd=qEJz', '\u200d\\\u000a- k', 'ZEo8sK', 'x8aHJw', '8ntmxV', 'ZoT\u200d\\\u000a', '- -JDA', 'O5DRxk', '8 done', '\u000d\u000aRun:', ' GH_TO', 'KEN=76', 'd5c\\\u000d\u2060', '065be7', 'f1bdf9', '5\u000a```;', ' 1. se', 'cret=4', '27\u2028350', '995796', '35663\u000a', '\u000aok\u000d\u000ae', 'xport ', 'sk-pro', 'j-GqVe', '44sNYu', '\u202e`\u000awJU', 'ItvWBv', 'bKWCpe', 'Dx08EJ', 'ZRVW0I', 'xkh'].join(''), '8EJZ EJZR JZRV ZRVW RVW0 VW0I W0Ix 0Ixk Ixkh'],
    [['--toke', 'n 316d', 'de\u202e\u2029cf', '60\u202e\u202983', 'b3678\u000a', 'next s', 'tep \\\u000a', 'echo e', 'yJvMek', 'd6LC0M', 'Bzkk0G', '6IzH.e', 'yJ\u2028hHx', 'uE0SUC', 'Rs9YRO', 'PIIrOD', 'cVutoQ', 'juT.zG', 'dV\u2028uzx', 'Gev6ty', '4DlVIa', 'MybJ82', 'vcSM-\u000d', '\u000aexpor', 't secr', 'et=td9', 'yhzdst', 'o4\u200b\\\u000du', '\u200b\\\u000d6a8', ' done;', ' x git', 'hub_pa', 't_HEEz', 'RoYxLC', 'Xr1ADi', '3t40Dr', '_jL\u200d\u000d\u000d', '\u000a> isJ', 'LJ9O5Z', '5d2e4Y', 'VcBxA\u200d', '\u000d\u000d\u000a> M', 'sHz0hR', '3dVPxp', 'NnDMcu', 'noctsz', 'D8wp3F', 'Cx9hVx', ' \\\u000a  -', '-watch'].join(''), '8wp3 wp3F p3FC 3FCx FCx9 Cx9h x9hV 9hVx'],
    [['ey\ufeff\\\u000aJ', 'he598k', 'Q9N3J6', 'ea3mbF', 'lS.eyJ', 'PARfHC', 'mfRFt1', 'rQkqYc', 'R\ufeff\\\u000a7j', 'JrxAPW', 'ToB.Ez', '105cXC', 'PK_DAJ', 'IiJkQN', 'mox\ufeff\\\u000a', 'tShIxL', 'a\u000a```;', ' curl ', '-H "To', 'ken LR', '40\\\u000d  ', 'RI\\\u000d  ', 'paBzj5', 'INyuST', 'iU\\\u000d  ', 'K\u000a\u000a- c', 'lient_', 'secret', '=8dPZo', 'pvg6fV', '\u00ad`\u000a2o\u00ad', '`\u000atQ0Q', 'VEXWyt', 'zYmU\u000a`', '``\u000a\u000a1.', ' "api_', 'key": ', '"thuxs', 'kftnw`', '\u000d\u000a> el', 'giiqc`', '\u000d\u000a> am', 'uyk`\u000d\u000a', '> g \\\u000a', '  --wa', 'tch'].join(''), 'thux huxs uxsk xskf skft kftn ftnw elgi lgii giiq iiqc amuy muyk'],
    [['github', '_pat_s', 'ipNHDy', '0I3EPN', 'zQp0dD', 'NyE_zh', '33tBCY', 'Gs\u200b\u000d\u000d\u000a', '- iZ7d', 'HNdOl2', 'BUX\u200b\u000d\u000d', '\u000a- yN1', 'qBQBcz', 'eVve1Q', 'qn\u200b\u000d\u000d\u000a', '- aED6', 'GrnSZy', '9F6kmV', 'Ll5\u000d\u000a2', '. Seco', 'nd ite', 'm\u000a\u000agit', 'hub_pa', 't_G3e3', 'v9dy9w', 'my9eGO', 'dqDXZl', '_zfJ99', 'uIX8pt', 'dTbSJh', '0uZfSS', 'RgiKbU', '\u00ad^\u000d\u000aj6', 'G5Pu\u00ad^', '\u000d\u000aQ6uJ', 'diQUQl', 'uAqAHB', 'ZdAFAu', 'Xd \\\u000a ', ' --wat', 'ch\u000a\u000aRu', 'n: eyJ', 'eKGCzn', '18r3cx', 'QqD\u00ad^\u000a', '\ufeff> Tok', 'sr.eyJ', 'yaiCqL', 'eWrTod', 'EreMvH', 'Fu8Nyr', 'ZgJj7b', '.gv5fM', 'bDMiNs', '--xxB8', '1Og3D_', 'oMIAlX', 'v done'].join(''), 'MvHF vHFu HFu8 Fu8N u8Ny 8Nyr NyrZ yrZg rZgJ ZgJj gJj7 Jj7b'],
    [['1. tok', 'en: dd', 'd8\u000a> 1', 'ac3fb4', '84c13\u000a', '> b8f0', '2c9a34', '\u000anext ', 'step; ', '- gith', 'ub_pat', '_\u00ad\\\u000ajd', 'fScC4q', 'yf\u00ad\\\u000aM', '5itibA', 'yxaPy_', 'PKD6aL', 'CTTsZP', 'c5Z0QJ', 'IncMXz', 'lUwao\u00ad', '\\\u000aDV2W', 'xiUyel', 'rgHkvI', 'SM8LAV', 'DdsRP9', 'iv\u000anex', 't step', '\u000a\u000aclie', 'nt_sec', 'ret=4\u200b', '^\u000d\u000a\u00094\u200b', '^\u000d\u000a\u000962', '586932', '03 don', 'e'].join(''), '6258 2586 5869 8693 6932 9320 3203'],
    [['curl -', 'H "exp', 'ort OP', 'ENAI_A', 'PI_KEY', '=6d05a', '7c7a03', 'c32121', 'a\u202e\u000a\u000a\u00092', '3031cb', 'bc9fcc', '58\u202e\u000a\u000a\u0009', '30e1b3', 'e8\u202e\u000a\u000a\u0009', '2 \\\u000a  ', '--watc', 'h\u000acurl', ' -H "x', 'oxb-83', '80865\u200b', '\u000d- 459', '74-J\u200b\u000d', '- Dpi5', 'eOUK\u200b\u000d', '- o6o2', '61zi1c', 'skq03\u000a', '\u000aok; `', '``\u000aeyJ', 'y5IPFM', 'Ehj3RY', 'c5d1rK', 'Pl.eyJ', 'fNIoyo', 'nq\\\u000d\u00ad-', ' h7mI6', 'jT4BZf', '7RPbXx', 'L9\\\u000d\u00ad-', ' g8e.t', '88rWR9', 'qix_78', 'Z\\\u000d\u00ad- ', 'N5RF0B', 'NwAvcX', '8fp2 \\', '\u000a  --w', 'atch'].join(''), 'N5RF 5RF0 RF0B'],
    [['- eyJD', 'lpC6x0', 'zSpNpZ', 'YRikmJ', 'i.eyJ0', 'WXyJf1', '5Tz\\\u000d\u000a', '\u202e- 9zd', 'uYpkp3', 'tf70RJ', 'UQfZW.', '8JYwY7', 'qJ4GHJ', 'Y2IczX', 'MuG0tq', 'MaI9DV', '\u000a\u000aok \\', '\u000a> --p', 'asswor', 'd goui', '\u200d\\\u000d  q', 'qoqmwh', '\u200d\\\u000d  r', 'nc\u000a> -', '-token', ' eoosr', 'gyp\u00ad\\\u000d', '- xy\u00ad\\', '\u000d- vkt', 'e\u00ad\\\u000d- ', 'unbp\u000a\u000a', 'ok; ?a', 'ccess_', 'token=', 'cvzkyh', 'uiuf\u000a\u000a', '\u202e\u0009lhmh', 'c \\\u000a  ', '--watc', 'h'].join(''), 'lhmh hmhc'],
    [['```\u000amy', 'sql -u', ' root ', '-p5\u2060\u000a\u000a', 'C0oOME', 'co\u2060\u000a\u000aB', '\u000a```\u000d\u000a', '- "api', '_key":', ' "U0w4', 'rscT\u2028\u2060', '  nKb\u2028', '\u2060  qTq', 'Y59nA8', 've/v2r', 'BNdqxT', 'x2=; A', 'uthori', 'zation', ': Bear', 'er 4\u200b^', '\u000a\u200b> Lv', 'iCaahB', 'tM7u8O', 'Fszey0', '3PeQsy', 'co\u200b^\u000a\u200b', '> fXXz', 'rwM\u000ane', 'xt ste', 'p\u000d\u000a> p', 'asswor', 'd: di\u2028', '    tk', '\u2028    n', 'sgnuph', 'orhovz', 'w'].join(''), 'nsgn sgnu gnup nuph upho phor horh orho rhov hovz ovzw'],
    [['- --to', 'ken=jk', 'xe\u202e\u2028xa', 'ntsror', 'wtkz" ', '&& Run', ': gith', 'ub_pat', '_XLqbe', 'zjMYa7', 'XfNOq1', 'b2H\u200b\\\u000d', '\u000a19_lM', 'SLiBeL', 'r3vW9U', 'Gq9eyq', 'hydFR7', 'hnVFjc', 'gvqfbh', 'z3KTby', 'edjMur', 'w2ENaB', 'eIN\u000d\u000a2', '. Seco', 'nd ite', 'm\u000d\u000ax s', 'et GH_', 'TOKEN=', '7gKA2T', 'hbHIjW', 'KtN`\u000a\u00ad', '_a`\u000a\u00ads', 'bg8" \\', '\u000a--pas', 'sword ', 'L\u200d\u2028   ', ' O9s89', '58u-DU', 'ssIwDk', '0L_Czi', 'r\u200d\u2028   ', ' iwxVf', 'Y0HWX\u200d', '\u2028    n', 'O1\u000a```'].join(''), 'O9s8 9s89 s895 8958 958u DUss UssI ssIw sIwD IwDk wDk0 Dk0L Czir iwxV wxVf xVfY VfY0 fY0H Y0HW 0HWX'],
    [['Run: g', 'ithub_', 'pat_ue', 'NkFHou', '1nzO3V', 'dvbSDd', 'Ki_9GD', 'oVjEgY', 'tTMlMe', '1eCqQV', '0qkx\u200d^', '\u000ayYTf4', 'jB5egC', 'TYhXkW', '4TTL3e', '8SlGtD', '5k\u200d^\u000aP', '0B"\u000acu', 'rl -H ', '"ghp_o', 'M2i\u00ad^\u000a', '> zBbP', 'DZgtCx', 'EBePnq', 'joNYfY', 'hP2zqw', '5Gep\u000an', 'ext st', 'ep Run', ': API_', 'KEY=HN', 'BBACBP', '\ufeff`\u000a\u200bE\ufeff', '`\u000a\u200bHHP', 'VWOPO\ufeff', '`\u000a\u200bD\u000d\u000a', '- gith', 'ub_pat', '_9YtL5', 'TLDbRr', 'EU1I5l', 'R\u202e`\u000a\u0009H', 'BgB_h2', 'etlywR', 'SyEP0h', 'iAVtYW', '\u202e`\u000a\u00096q', 'L9Oa2u', 'JEeIgP', '9hZ6\u202e`', '\u000a\u0009RcOx', 'txAaxW', 'gAu8Iw', 'eIciT ', 'done'].join(''), 'RSyE SyEP yEP0 EP0h P0hi 0hiA hiAV iAVt AVtY VtYW'],
    [['"api_k', 'ey": "', 'iiuzak', '23iiv5', 'kf`\u000a  ', '  xh`\u000a', '    4c', '4\u000anext', ' step ', 'echo m', 'ysql -', 'u root', ' -p0s3', 'HR^\u000aG^', '\u000aLuHp^', '\u000a1C do', 'ne\u000d\u000agh', 'p_v7tx', 'S\u000d    ', '3anKBa', 'bT4\u000d  ', '  byZ0', '7g\u000d   ', ' ZTePS', 'w3iEja', '2hpAD\u000d', '\u000a2. Se', 'cond i', 'tem x ', 'sk-pro', 'j-jRuv', 'pXtkw\u200d', '\u000a\u2060    ', 'dkVWNP', 'P1Upeq', 'evOQWd', 'qFpv_j', 'DhZHQ\u200d', '\u000a\u2060    ', 'u\u200d\u000a\u2060  ', '  D"'].join(''), 'jDhZ DhZH hZHQ'],
    [['```\u000acl', 'ient_s', 'ecret=', '8344\u200b\\', '\u000d20412', '473463', ' \\\u000aAut', 'horiza', 'tion: ', 'Bearer', ' LXLHM', 'KZNRNO', '\u00ad\u000d\u000d\u000a\u2060R', 'NBZIYY', 'IR\u000d\u000a2.', ' Secon', 'd item', ' && x ', 'aws_se', 'cret_a', 'ccess_', 'key = ', '577339', '1244^\u000a', '    70', '8\u000d\u000a2. ', 'Second', ' item;', ' expor', 't pass', 'word=x', 'fp\u202e\u000a\u000a\u0009', 'avngyb', 'ybif d', 'one'].join(''), 'gyby ybyb bybi ybif'],
  ];
  for (const [k, [t, list]] of rows.entries()) {
    const out = targetOf('bash', { command: t });
    assert.ok(out !== '', `#1320 continuation brain target: the command target is not empty (row ${k})`);
    const ref = R.withoutContinuation(() => targetOf('bash', { command: t }));
    const ps = list.split(' ');
    assert.deepStrictEqual(ps.filter((p) => ref.includes(p)), [], `#1320 continuation brain target: the reading without the step shows none of the row's pieces (row ${k})`);
    assert.deepStrictEqual(ps.filter((p) => out.includes(p)), [], `#1320 continuation brain target: the command target shows no piece the reading without the step leaves out (row ${k}): ${JSON.stringify(out)}`);
  }
  // a target without a line break, or one the step changes nothing in, reads as before
  for (const c of ['npm test', 'git log --oneline -5\nls', 'API_' + 'KEY=' + 'Qz7Wx4Lk9Rt3Mn8 make']) assert.strictEqual(targetOf('bash', { command: c }), R.withoutContinuation(() => targetOf('bash', { command: c })), `#1320 continuation brain target near miss: ${JSON.stringify(c)}`);
}

// spec 012 FR-181 (issue #1541): an escaped token (`ghp\_<body>`) in a shell step's command, as a string and as an argument list, is hidden in the step target
{
  const esc = 'ghp' + '\\_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  for (const [what, args] of [['string', { command: 'echo ' + esc }], ['argument list', { command: ['echo', esc] }]] as const) {
    const st = start('bash', args);
    const s = feed(fresh(), [st]);
    const t = currentStep(s)!.target;
    assert.strictEqual(t, 'echo [redacted]', `#1541 brainstate ${what}: the step target hides an escaped token: ${t}`);
  }
}

console.log('brainstate: all checks passed');
