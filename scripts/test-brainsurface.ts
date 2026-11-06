/** Brain view surfaces (spec 106 T004, FR-021, FR-080, FR-085, FR-086, FR-121, SC-002): `npm run test:brainsurface`. No credits. */
import * as assert from 'assert';
import * as path from 'path';
import * as R from '../src/shared/redact';
import { BrainMask, BrainState, BrainStep, brainState, currentStep, initBrain } from '../src/shared/brainstate';
import {
  STOP_SHARING_TO_ANSWER, SHARE_COST, costDetail, SHARE_PLACEHOLDER, SurfaceCtx, Surface, cardLines, costText, exportText, formatStep, loopLine, midCut, officeLine, officeTag, orbName,
  relPath, sentenceFor, shareLine, transcriptText, turnMapLine, durationText,
} from '../src/shared/brainsurface';

const USAGE = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'usagetotals.js'));
const COST = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'costtable.js'));
const mask: BrainMask = { ...R, units: { validNano: USAGE.validNano, AIU_USD: COST.AIU_USD, money: COST.money, creditsWord: 'AIU', estimateWord: 'Claude (est.)' } };
const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const SK = 'sk-live-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
const SESS = 'SESS_' + 'q9W8e7R6t5Y4u3I2o1P0aSdFg';
const SURFACES: Surface[] = ['office', 'card', 'front', 'transcript', 'turnmap', 'export', 'share'];

/** FR-086's inputs: [label, tool, args]. */
const INPUTS: [string, string, unknown][] = [
  ['token flag', 'bash', { command: `npm run deploy -- --token=${GH}` }],
  ['bearer and key', 'bash', { command: `curl -H "Authorization: Bearer ${SK}" https://api.example.com/v1/users?key=XYZ` }],
  ['url password', 'bash', { command: 'psql postgres://admin:hunter2@db.internal/prod' }],
  ['home path unix', 'view', { path: '/home/ana/work/x/registry.ts' }],
  ['home path windows', 'view', { path: 'C:\\Users\\ana\\work\\x\\registry.ts' }],
  ['git push', 'bash', { command: `git push https://ana:${GH}@github.com/acme/app.git` }],
  ['cookie', 'bash', { command: `teams-mcp list_channels --cookie=${SESS}` }],
  ['web url', 'web_fetch', { url: `https://ana:hunter2@api.example.com/v1/users?key=XYZ&token=${GH}` }],
  ['array command', 'shell', { command: ['bash', '-lc', `deploy --token=${GH}`] }],
  ['home path in a command', 'bash', { command: 'cat /home/ana/work/x/registry.ts C:\\Users\\ana\\work\\x\\registry.ts' }],
];

/** The leak checks of FR-086: no cell holds a token-like value, a home path, a password or an option's value. */
function leaks(cell: string): string[] {
  const bad: [string, RegExp][] = [
    ['ghp_ token', /ghp_[A-Za-z0-9]{6,}/], ['sk- token', /sk-[A-Za-z0-9-]{8,}/], ['Bearer value', /Bearer\s+(?!\[redacted|••••)\S/],
    ['password in URL', /:\/\/[^/\s@]*:[^/\s@]+@/], ['hunter2', /hunter2/], ['--token= value', /--token=(?!\[|•)\S/], ['--cookie= value', /--cookie=(?!\[|•)\S/],
    ['SESS_ value', /SESS_[A-Za-z0-9]/], ['?key= value', /[?&]key=(?!\[|•)[^&\s]/i], ['home path', /\/home\/ana|\/Users\/ana|C:\\Users\\ana|C:\/Users\/ana/i],
  ];
  return bad.filter(([, re]) => re.test(cell)).map(([n]) => n);
}

let clock = 1_000_000;
function stepFrom(tool: string, args: unknown, m: BrainMask = mask, extra: Record<string, unknown> = {}): { state: BrainState; step: BrainStep } {
  let s = initBrain('Ada', m);
  const ev = (e: unknown): void => { clock += 10; s = brainState(s, e, clock, m); };
  ev({ type: 'user' });
  ev({ type: 'thinking', delta: `I will try this. My key is ${GH}, then run it.` });
  ev({ type: 'toolCall', callId: 'c1', phase: 'start', tool, args, ...extra });
  return { state: s, step: currentStep(s)! };
}
const ctx = (extra: Partial<SurfaceCtx> = {}): SurfaceCtx => ({ mask, folder: '/home/ana/work/x', now: clock + 1500, ...extra });

// ---- every input on every surface, from the state (FR-086)
for (const [label, tool, args] of INPUTS) {
  const { state, step } = stepFrom(tool, args);
  assert.ok(step, label);
  assert.deepStrictEqual(leaks(JSON.stringify(state)), [], `${label}: the state holds no secret`);
  for (const surface of SURFACES) {
    const cell = formatStep(surface, step, ctx());
    assert.deepStrictEqual(leaks(cell), [], `${label} on ${surface}: "${cell}"`);
    if (surface === 'office') assert.ok(!/[\\/]/.test(cell), `${label}: office cell has no / or \\: "${cell}"`);
    if (surface === 'share') assert.ok(/^[A-Za-z]+ · [a-z]+$/.test(cell), `${label}: share cell is Tool · state: "${cell}"`);
  }
  // the sentence, the tag, the orb, the card's three lines, the transcript, the loop line and the export file
  assert.deepStrictEqual(leaks(sentenceFor(state, ctx())), [], `${label}: sentence`);
  assert.deepStrictEqual(leaks(officeTag('Ada', step, ctx())), [], `${label}: tag`);
  assert.ok(!/[\\/]/.test(officeTag('Ada', step, ctx())), `${label}: tag has no path`);
  const c = cardLines(step, ctx());
  for (const part of [c.head, c.preview, c.why]) assert.deepStrictEqual(leaks(part), [], `${label}: card part "${part}"`);
  assert.deepStrictEqual(leaks(exportText([step, step], ctx())), [], `${label}: export`);
  // screen share: every surface says the tool word and state only, whatever the step holds
  for (const surface of SURFACES) assert.ok(/^[A-Za-z]+ · [a-z]+$/.test(formatStep(surface, step, ctx({ sharing: true }))), `${label}: ${surface} while sharing`);
  assert.ok(/^(Think|Read|Edit|Shell|Web|MCP|You) · [a-z]+$/.test(sentenceFor(state, ctx({ sharing: true }))), `${label}: sentence while sharing`);
  const sc = cardLines(step, ctx({ sharing: true }));
  assert.ok(sc.preview === '' && sc.why === '' && /^[A-Za-z]+ · [a-z]+$/.test(sc.head), `${label}: card while sharing`);
}

// ---- the same inputs fed to each formatter UNMASKED (a surface stays safe on its own: FR-086 "each surface's formatter")
for (const [label, tool, args] of INPUTS) {
  const identity: BrainMask = { redact: (t) => String(t ?? ''), maskSecretCommand: (c) => String(c ?? ''), maskSecretArgs: (a) => [...a], maskSecretUrl: (u) => String(u ?? ''), maskHomePaths: (t) => String(t ?? ''), maskTokenShapes: (t) => t, maskGluedTail: (t) => t, openKeyBlockStart: () => -1, schemePrefix: () => false, schemeWord: () => false };
  const { step: dirty } = stepFrom(tool, args, identity); // the state built by a mask that masks nothing
  const raw = JSON.stringify(dirty);
  assert.ok(leaks(raw).length > 0, `${label}: the unmasked fixture really holds a secret (else this test proves nothing)`);
  for (const surface of ['card', 'front', 'transcript', 'turnmap', 'export'] as Surface[]) {
    const cell = formatStep(surface, dirty, ctx());
    assert.deepStrictEqual(leaks(cell), [], `${label} on ${surface} from an unmasked step: "${cell}"`);
  }
  for (const surface of ['office', 'share'] as Surface[]) {
    const cell = formatStep(surface, dirty, ctx());
    assert.deepStrictEqual(leaks(cell), [], `${label} on ${surface} from an unmasked step`);
    if (surface === 'office') assert.ok(!/[\\/]/.test(cell), `${label}: office has no path from an unmasked step`);
  }
  assert.deepStrictEqual(leaks(officeTag('Ada ' + GH + '/x', dirty, ctx())), [], `${label}: a token in the agent name`);
  assert.ok(!/[\\/]/.test(officeTag('Ada/Bob\\C', dirty, ctx())), 'no slash in the office tag even from the name');
  assert.deepStrictEqual(leaks(orbName('Ada ' + GH, ctx())), [], 'orb name');
}

// ---- F4: a step whose tool, server or "Other tool" name holds a token, handed to every surface UNMASKED: the outer clean() of each line must catch it
{
  const { step } = stepFrom('bash', { command: 'ls' });
  const SECRET8 = [GH.slice(0, 8), GH.slice(8, 16), GH.slice(16, 24)];
  const holds = (cell: string): boolean => SECRET8.some((x) => cell.includes(x)) || cell.includes(GH);
  for (const dirty of [
    { ...step, glyph: 'mcp' as const, word: 'MCP', server: 'srv-' + GH, tool: 'tool-' + GH, other: '' },
    { ...step, other: GH, tool: GH },
    { ...step, glyph: 'mcp' as const, word: 'MCP', server: '', tool: GH, other: '' },
  ]) for (const surface of ['card', 'front', 'transcript', 'turnmap', 'export'] as Surface[]) assert.ok(!holds(formatStep(surface, dirty, ctx())), `a token in the tool or server name on ${surface}: "${formatStep(surface, dirty, ctx())}"`);
  assert.ok(!holds(turnMapLine({ ...step, glyph: 'mcp', server: 'srv', tool: GH, other: '' }, ctx())), 'turnMapLine masks its whole line');
}

// ---- F5: a query and an "Other tool" target go through the command mask too; F7: bidi characters never reach a line
{
  for (const [tool, args] of [['grep', { pattern: 'password=hunter2xyz' }], ['web_search', { query: 'login password=hunter2xyz now' }], ['spawn_agent', { query: 'x --password=hunter2xyz' }], ['grep', { pattern: 'run --password hunter2xyz' }], ['web_search', { query: 'curl --token hunter2xyz' }], ['spawn_agent', { query: 'tool --api-key hunter2xyz' }]] as [string, unknown][]) {
    const { state, step } = stepFrom(tool, args);
    assert.ok(!JSON.stringify(state).includes('hunter2xyz'), `${tool}: the state holds no password`);
    for (const surface of SURFACES) assert.ok(!formatStep(surface, step, ctx()).includes('hunter2xyz'), `${tool} on ${surface}`);
    const raw = { ...step, targetKind: 'query' as const, target: 'run --password hunter2xyz' };
    for (const surface of ['card', 'transcript', 'turnmap', 'export'] as Surface[]) assert.ok(!formatStep(surface, raw, ctx()).includes('hunter2xyz'), `${tool} on ${surface} from an unmasked query step`);
  }
  const { step } = stepFrom('bash', { command: 'ls' });
  const bidi = { ...step, why: 'a\u202Eb\u2066c\u2069d', target: 'ls\u202Ex' };
  for (const surface of ['card', 'transcript', 'turnmap'] as Surface[]) assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(formatStep(surface, bidi, ctx())), `no bidi override on ${surface}`);
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(orbName('Ada\u202Ex', ctx())) && !/[\u202A-\u202E\u2066-\u2069]/.test(officeTag('Ada\u2067x', step, ctx())), 'nor in a name');
}

// ---- the checker catches a planted mutation: a surface that skips masking would fail leaks()
{
  const { step } = stepFrom('bash', INPUTS[0][2], { ...mask, maskTokenShapes: (t) => t, redact: (t) => String(t ?? ''), maskSecretCommand: (c) => String(c ?? '') });
  assert.ok(leaks(JSON.stringify(step)).includes('ghp_ token'), 'planted: a state that skips masking is caught by the token check');
  const { step: s2 } = stepFrom('view', INPUTS[3][2], { ...mask, maskHomePaths: (t) => String(t ?? '') });
  assert.ok(leaks(JSON.stringify(s2)).includes('home path'), 'planted: a state that skips home masking is caught by the home check');
  assert.ok(leaks('Authorization: Bearer abc123').includes('Bearer value'), 'the Bearer check works');
  assert.ok(leaks('postgres://admin:hunter2@db').includes('password in URL'), 'the URL password check works');
  assert.ok(leaks('x --cookie=abc').includes('--cookie= value'), 'the cookie check works');
  assert.ok(leaks('/api?key=XYZ').includes('?key= value'), 'the query key check works');
}

// ---- FR-085's table, cell by cell
const sh = stepFrom('bash', { command: 'npm run test -- --run' }).step;
assert.strictEqual(officeLine(sh, ctx()), 'Shell · npm · running', 'office: word, program, state');
assert.strictEqual(officeTag('Ada', sh, ctx()), 'Ada · Shell · npm · running');
assert.strictEqual(officeTag('Ada', undefined, ctx()), 'Ada');
assert.strictEqual(orbName('Ada', ctx()), 'Ada');
assert.ok(!officeLine(sh, ctx()).includes('test'), 'the office never shows arguments');
const rd = stepFrom('view', { path: '/home/ana/work/x/src/registry.ts' }).step;
assert.strictEqual(officeLine(rd, ctx()), 'Read · running', 'a read has no program: word and state');
const mcp = stepFrom('srv-q', {}, mask, { mcpServer: 'teams-mcp', mcpTool: 'list_channels' }).step;
assert.strictEqual(officeLine(mcp, ctx()), 'MCP · teams-mcp · running', 'an MCP call shows the server name');
assert.deepStrictEqual(cardLines(sh, ctx({ now: sh.startedAt + 1500 })), { head: 'Shell · running · 1.5 s', preview: 'npm run test -- --run', why: 'Why: My key is [redacted], then run it.' }, 'card: head, masked command, the agent\'s own reason');
assert.deepStrictEqual(cardLines(rd, ctx()).preview, 'registry.ts', 'card: the file\'s base name, no folder');
assert.strictEqual(transcriptText(rd, ctx()), 'src/registry.ts', 'transcript: folder-relative path');
assert.strictEqual(transcriptText(rd, ctx({ folder: undefined })), '~/work/x/src/registry.ts', 'transcript: home as ~');
assert.strictEqual(transcriptText(sh, ctx()), 'npm run test -- --run', 'transcript: the full masked command');
assert.strictEqual(turnMapLine(rd, ctx()), '1 Read · src/registry.ts · running', 'turn map: relative path');
assert.strictEqual(turnMapLine(rd, ctx({ folder: undefined })), '1 Read · registry.ts · running', 'no folder known: the file name, never an absolute path');
assert.strictEqual(turnMapLine(rd, ctx({ folder: '/elsewhere' })), '1 Read · registry.ts · running', 'a path outside the folder: the file name');
assert.strictEqual(shareLine(sh), 'Shell · running');
assert.strictEqual(cardLines(sh, ctx({ sharing: true })).head, 'Shell · running');
assert.strictEqual(relPath('/home/ana/work/x/a/b.ts', '/home/ana/work/x', ctx()), 'a/b.ts');
assert.strictEqual(relPath('/home/ana/work/xy/b.ts', '/home/ana/work/x', ctx()), 'b.ts', 'a sibling folder with the same prefix is not inside');
assert.strictEqual(relPath('C:\\Users\\ana\\work\\x\\a\\b.ts', 'C:\\Users\\ana\\work\\x', ctx()), 'a/b.ts', 'Windows paths');
assert.strictEqual(turnMapLine(stepFrom('bash', { command: 'cat /home/ana/work/x/a.ts' }).step, ctx()), '1 Shell · cat a.ts · running', 'the folder is taken out of a command');
// a step handed in with a program or server name that is not clean (a path, a token, a slash): the office row keeps only its safe characters
{
  const odd = { ...sh, program: '/usr/local/bin/psql', server: 'a/b\\c' };
  assert.strictEqual(officeLine(odd, ctx()), 'Shell · psql · running', 'a path in the program name is cut to the program');
  assert.ok(!/[\\/]/.test(officeLine({ ...sh, program: 'a/b\\c', server: '' }, ctx())), 'no slash survives in the office row');
  assert.ok(!/[\\/]/.test(officeLine({ ...sh, program: '', server: 'x/y' }, ctx())), 'nor in an MCP server name');
}
// failed, helper, other tool, long names, duration
const fail = { ...sh, state: 'failed' as const, endedAt: sh.startedAt + 420 };
assert.strictEqual(cardLines(fail, ctx()).head, '✗ Shell · failed · 420 ms', 'a failed step has a mark and the word');
assert.strictEqual(cardLines({ ...sh, helper: true }, ctx({ now: sh.startedAt + 1500 })).head, 'Shell (helper) · running · 1.5 s');
assert.strictEqual(cardLines(stepFrom('spawn_agent', {}).step, ctx()).preview, 'Other tool: spawn_agent');
assert.strictEqual(durationText({ ...sh, endedAt: null, startedAt: 0 }, 180_000), '3 min', 'a tool that never completes ages to "3 min"');
assert.strictEqual(durationText({ ...sh, endedAt: null }, undefined), '');
assert.ok(midCut('a-very-long-file-name-indeed.component.tsx', 20).endsWith('.tsx') && Array.from(midCut('a-very-long-file-name-indeed.component.tsx', 20)).length <= 20, 'long names cut in the middle and keep the extension');
assert.strictEqual(midCut('short.ts', 20), 'short.ts');
// cost (FR-015, FR-080)
assert.strictEqual(costText(0.04, ctx()), '≈ $0.04'); assert.strictEqual(costText(null, ctx()), 'cost unknown'); assert.strictEqual(costText(NaN, ctx()), 'cost unknown');
assert.strictEqual(costText(0.04, ctx({ sharing: true })), SHARE_COST, 'cost is hidden while sharing'); assert.strictEqual(SHARE_COST, 'cost hidden while sharing');
assert.strictEqual(STOP_SHARING_TO_ANSWER, 'Stop sharing to answer'); assert.strictEqual(SHARE_PLACEHOLDER, '[hidden while sharing]');
// F8: the cost detail names the parts like the header's tooltip: credits at AIU_USD, plus Claude's estimate; unknown says nothing
{
  let c = initBrain('Ada', mask);
  const ev = (e: unknown): void => { clock += 10; c = brainState(c, e, clock, mask); };
  ev({ type: 'user' });
  assert.strictEqual(costDetail(c, ctx()), '', 'no usage: nothing to say, the cost says "cost unknown"');
  ev({ type: 'usage', nanoAiu: 4.2e9 });
  assert.strictEqual(costDetail(c, ctx()), '≈ $0.04 = 4.20 AIU', 'Copilot: credits and their dollars');
  ev({ type: 'usage', costUsd: 0.03 });
  assert.strictEqual(costDetail(c, ctx()), '≈ $0.07 = 4.20 AIU + $0.03 Claude (est.)', 'Claude\'s estimate is added and named');
  assert.strictEqual(costDetail(c, ctx({ sharing: true })), SHARE_COST, 'hidden while sharing');
  assert.strictEqual(costText(c.turnCost, ctx()), '≈ $0.07');
  assert.strictEqual(costText(0.001, ctx()), '<$0.01', 'under a cent: no "≈", as the top bar');
}
// the loop line and the sentence while sharing
{
  let s = initBrain('Sven', mask);
  const ev = (e: unknown): void => { clock += 10; s = brainState(s, e, clock, mask); };
  ev({ type: 'user' }); ev({ type: 'usage', costUsd: 0.1 });
  for (let i = 0; i < 2; i++) for (const t of ['edit', 'bash']) { ev({ type: 'toolCall', callId: t + i, phase: 'start', tool: t, args: {} }); ev({ type: 'toolCall', callId: t + i, phase: i === 1 && t === 'bash' ? 'failed' : 'complete', tool: t }); }
  assert.strictEqual(loopLine(s, ctx()), 'looping? Edit ↔ Shell · 2 times · ≈ $0.00');
  assert.strictEqual(loopLine(s, ctx({ sharing: true })), 'looping? Edit ↔ Shell · 2 times · cost hidden while sharing', 'the loop line hides its cost while sharing');
  assert.strictEqual(sentenceFor(s, ctx()), 'Sven may be looping between Edit and Shell');
  assert.strictEqual(sentenceFor(s, ctx({ sharing: true })), 'Shell · failed', 'sharing: tool word and state, no name, no loop words');
  ev({ type: 'permission', permission: { requestId: 'r', state: 'pending', kind: 'shell', summary: 'x' } });
  assert.strictEqual(sentenceFor(s, ctx({ sharing: true })), 'You · waiting');
  assert.strictEqual(sentenceFor(initBrain('Sven', mask), ctx({ sharing: true })), 'Rest · idle');
}
// a canary in the sentence: the file name goes through the sentence (it is the state's), and sharing replaces it
{
  const { state } = stepFrom('view', { path: '/home/ana/work/x/CANARY-registry.ts' });
  assert.ok(sentenceFor(state, ctx()).includes('CANARY-registry.ts'), 'the sentence names the file');
  for (const surface of SURFACES) assert.ok(!formatStep(surface, currentStep(state)!, ctx({ sharing: true })).includes('CANARY'), `sharing hides the file on ${surface}`);
  assert.ok(!sentenceFor(state, ctx({ sharing: true })).includes('CANARY') && !sentenceFor(state, ctx({ sharing: true })).includes('Ada'), 'sharing: the sentence holds no file name');
}

console.log('brainsurface: all checks passed');
