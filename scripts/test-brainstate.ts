/** Brain view state (spec 106 T003, FR-001..FR-008, FR-012, FR-020, FR-022, FR-040..FR-042, FR-123): `npm run test:brainstate`. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as R from '../src/shared/redact';
import { exportText, formatStep, officeLine, sentenceFor } from '../src/shared/brainsurface';
import { BrainState, FRAME_MS, GLYPHS, HISTORY_MAX, PAINT_MS, REVEAL_ORDER, STEP_CAP, TRAIL_MAX, baseName, brainState, currentStep, glyphOf, initBrain, loopText, markPainted, maskText, programOf, revealStages, sentenceOf, shouldPaint, trailOf, usedLobes } from '../src/shared/brainstate';

const mask = R; // redact.ts's own functions, as the page passes them
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
assert.strictEqual(maskText({ ...mask, maskTokenShapes: () => ({ toString: () => 'LEAK-' + GH }) as unknown as string } as never, 'x'), '', 'a non-string result fails closed');
assert.strictEqual(maskText({ ...mask, maskTokenShapes: () => 5 as unknown as string } as never, 'x'), '', 'a number result fails closed');
assert.strictEqual(maskText(mask, 'a\u202Eb\u2066c\u2069d'), 'abcd', 'bidi override and isolate characters are dropped');
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
s = feed(s, [{ type: 'usage', costUsd: 0.02 }, { type: 'usage', costUsd: 0.03 }, { type: 'usage', nanoAiu: 5 }]);
assert.strictEqual(s.costKnown, true); assert.ok(Math.abs(s.turnCost - 0.05) < 1e-9);
s = feed(s, [{ type: 'usage', costUsd: -1 }, { type: 'usage', costUsd: NaN }]);
assert.ok(Math.abs(s.turnCost - 0.05) < 1e-9, 'junk costs are ignored');

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

console.log('brainstate: all checks passed');
