/** Unit tests for previous Copilot sessions per folder and history replay (synthetic events): `npm run test:history`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SEARCH_HISTORY_LIMITS, cleanSessionTitle, cleanTitle, eventsToHistory, isReplayedRecord, normDir, previousSessionsFor, sameDir } from '../src/adapters/history';
import { MAX_FILE_BYTES, claudeHistoryFromText, claudeProjectSlug } from '../src/adapters/claudeHistory';
import { readClaudeHistoryStream } from '../src/adapters/claudeStream';
import { codexHistory } from '../src/adapters/codexHistory';

// --- folder matching
assert.strictEqual(normDir('/a/b/', 'linux'), '/a/b');
assert.strictEqual(normDir('/', 'linux'), '/');
assert.strictEqual(normDir('C:\\Users\\A\\Proj\\', 'win32'), 'c:\\users\\a\\proj');
assert.ok(sameDir('C:/Users/A/proj', 'c:\\users\\a\\PROJ\\', 'win32'));
assert.ok(sameDir('/Users/a/Proj', '/users/a/proj', 'darwin'));
assert.ok(!sameDir('/home/a/Proj', '/home/a/proj', 'linux'), 'case matters on linux');
assert.ok(!sameDir('/a/b', '/a/bc', 'linux'));
assert.ok(!sameDir('', '/a', 'linux'));
assert.ok(sameDir('/tmp/link', '/private/tmp/real', 'linux', (p) => (p === '/tmp/link' ? '/private/tmp/real' : p)), 'symlinks resolve through realpath');
assert.ok(!sameDir('/x', '/y', 'linux', () => { throw new Error('gone'); }), 'realpath failure is a non-match');

// --- listing
const meta = (id: string, wd: string | undefined, mod: string, extra: Record<string, unknown> = {}) => ({
  sessionId: id, startTime: new Date('2026-10-01T10:00:00Z'), modifiedTime: new Date(mod), summary: `DURBAR fixture ${id}`, isRemote: false, context: wd === undefined ? undefined : { workingDirectory: wd, branch: 'main' }, ...extra,
});
const list = previousSessionsFor(
  [
    meta('old', '/p/app', '2026-10-01T11:00:00Z'),
    meta('new', '/p/app/', '2026-10-03T11:00:00Z'),
    meta('other', '/p/other', '2026-10-04T11:00:00Z'),
    meta('open', '/p/app', '2026-10-05T11:00:00Z'),
    meta('cloud', '/p/app', '2026-10-05T11:00:00Z', { isRemote: true }),
    meta('nocwd', undefined, '2026-10-05T11:00:00Z'),
    meta('multi', '/p/app', '2026-10-02T11:00:00Z', { summary: '  two\nlines \t here  ' }),
    { sessionId: 7 } as never,
    null as never,
    { sessionId: 'bad-dates', summary: 5, context: { workingDirectory: '/p/app' } },
  ],
  '/p/app',
  new Set(['open']),
  'linux',
);
assert.deepStrictEqual(list.map((s) => s.id), ['new', 'multi', 'old', 'bad-dates'], 'newest first; other folders, open, remote, malformed entries left out');
assert.strictEqual(list[1].title, 'two lines here');
assert.strictEqual(list[0].branch, 'main');
assert.strictEqual(list[3].title, 'Untitled session');
assert.strictEqual(list[3].modifiedTime, 0);
assert.strictEqual(cleanTitle('x'.repeat(300)).length, 120);
assert.deepStrictEqual(previousSessionsFor([], '/p', undefined, 'linux'), []);

// --- history replay
const ev = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type, data, id: Math.random().toString(36), timestamp: '2026-10-03T10:00:00.000Z', ...extra });
const events = [
  ev('session.start', { sessionId: 'x' }),
  ev('user.message', { content: 'DURBAR fixture: fix the bug', transformedContent: '<current_datetime>…</current_datetime>\n\nfix the bug', attachments: [{ type: 'file', path: '/p/app/notes.txt', displayName: 'notes.txt' }, { type: 'blob', displayName: 'shot.png', mimeType: 'image/png', assetId: 'sha256:1' }] }),
  ev('assistant.turn_start', {}),
  ev('assistant.message', { content: '', toolRequests: [{ toolCallId: 'c1' }] }),
  ev('tool.execution_start', { toolCallId: 'c1', toolName: 'view', arguments: { path: '/p/app/index.js' } }),
  ev('permission.requested', {}),
  ev('tool.execution_complete', { toolCallId: 'c1', success: true, result: { content: 'x'.repeat(5000), detailedContent: 'ignored' } }),
  ev('tool.execution_start', { toolCallId: 'c2', toolName: 'apply_patch', arguments: '*** Begin Patch\n*** Update File: index.js\n' }),
  ev('tool.execution_complete', { toolCallId: 'c2', success: false, error: { message: 'denied: read-only' } }),
  ev('tool.execution_start', { toolCallId: 'c3', toolName: 'bash', arguments: { command: 'ls' } }, { agentId: 'sub-1' }),
  ev('tool.execution_complete', { toolCallId: 'c3', success: true, result: { content: 'hidden' } }, { agentId: 'sub-1' }),
  ev('tool.execution_start', { toolCallId: 'c4', toolName: 'grep', arguments: { pattern: 'x' }, parentToolCallId: 'task1' }),
  ev('assistant.message', { content: 'I could not edit it (read-only).' }),
  ev('assistant.message', { content: 'sub-agent text', parentToolCallId: 'task1' }),
  ev('assistant.message_delta', { deltaContent: 'ephemeral' }, { ephemeral: true }),
  ev('user.message', { content: 'injected', source: 'system' }),
  ev('user.message', { content: '   ' }),
  ev('session.shutdown', {}),
  ev('user.message', { content: 'second question' }),
  { type: 'user.message' }, // no data
  'garbage',
  null,
  ev('tool.execution_complete', { toolCallId: 'unknown', success: true }),
];
const h = eventsToHistory(events);
assert.deepStrictEqual(h.items.map((i) => i.type), ['user', 'tool', 'tool', 'output', 'user']);
assert.strictEqual(h.total, 5);
assert.ok(!h.truncated);
const u = h.items[0];
assert.ok(u.type === 'user' && u.text === 'DURBAR fixture: fix the bug' && !u.text.includes('current_datetime'), 'the typed text, not the transformed prompt');
assert.ok(u.type === 'user' && JSON.stringify(u.attachments) === JSON.stringify([{ name: 'notes.txt', kind: 'file' }, { name: 'shot.png', kind: 'image' }]));
const t1 = h.items[1];
assert.ok(t1.type === 'tool' && t1.tool === 'view' && t1.label === '/p/app/index.js' && t1.failed === false && t1.output!.length === 2001, 'tool output is capped');
const t2 = h.items[2];
assert.ok(t2.type === 'tool' && t2.failed === true && t2.output === 'denied: read-only' && t2.label.startsWith('*** Begin Patch'));
assert.ok(typeof h.items[0].ts === 'number');

// caps
const capped = eventsToHistory(Array.from({ length: 50 }, (_, i) => ev('user.message', { content: 'm' + i })), { maxItems: 10 });
assert.strictEqual(capped.items.length, 10);
assert.ok(capped.truncated && capped.total === 50);
assert.ok(capped.items[0].type === 'user' && capped.items[0].text === 'm40', 'the most recent items are kept');
const long = eventsToHistory([ev('assistant.message', { content: 'y'.repeat(50_000) })]);
assert.ok(long.items[0].type === 'output' && long.items[0].text.length === 20_001);
assert.deepStrictEqual(eventsToHistory([]).items, []);

// spec 058 FR-242: SDK 1.0.32 journal records of a replay checkpoint (`checkpoint: true`) repeat the history; replay, previous sessions and
// search (all through eventsToHistory) show each message once. SYNTHETIC: the field as SDK 1.0.32 session-events.d.ts declares it.
{
  const own = [ev('user.message', { content: 'fix it' }), ev('tool.execution_start', { toolCallId: 'k1', toolName: 'bash', arguments: { command: 'ls' } }), ev('tool.execution_complete', { toolCallId: 'k1', success: true, result: { content: 'a' } }), ev('assistant.message', { content: 'done' })];
  const replay = own.map((e) => ({ ...(e as object), checkpoint: true }));
  const r = eventsToHistory([...replay, ...own, ev('user.message', { content: 'next' }, { checkpoint: false })]);
  assert.deepStrictEqual(r.items.map((i) => (i.type === 'tool' ? 'tool:' + i.tool : i.type + ':' + (i as { text: string }).text)), ['user:fix it', 'tool:bash', 'output:done', 'user:next'], 'FR-242 replayed records skipped: each message once');
  assert.strictEqual(eventsToHistory(replay, SEARCH_HISTORY_LIMITS).items.length, 0, 'FR-242: the search reads no replayed record');
  assert.ok(isReplayedRecord({ type: 'x', checkpoint: true }) && !isReplayedRecord({ type: 'x', checkpoint: 'true' }) && !isReplayedRecord({ type: 'x' }) && !isReplayedRecord(null), 'FR-242: only checkpoint === true');
}

// Issue #126: session titles (spec 002 delta 2026-10-18)
assert.strictEqual(cleanSessionTitle(undefined), undefined);
assert.strictEqual(cleanSessionTitle(' \u200B\u2060 '), undefined, 'nothing left = no title');
assert.strictEqual(cleanSessionTitle('a\u202Eb\u0007c\u2066d'), 'abcd', 'bidi overrides, isolates and control characters removed');
assert.strictEqual(cleanSessionTitle('Team 👩\u200D💻'), 'Team 👩\u200D💻', 'ZWJ kept');
assert.strictEqual(cleanSessionTitle('کار\u200Cها'), 'کار\u200Cها', 'ZWNJ kept');
assert.strictEqual(cleanTitle('a\u0007b'), 'ab', 'the previous-sessions title is cleaned the same way');
const named = previousSessionsFor(
  [
    { sessionId: 'n1', summary: 'first prompt text', name: 'Release notes', startTime: 1, modifiedTime: 2, context: { workingDirectory: '/p' } },
    { sessionId: 'n2', summary: 'only a summary', startTime: 1, modifiedTime: 1, context: { workingDirectory: '/p' } },
    { sessionId: 'n3', summary: 'summary wins', name: '  ', startTime: 1, modifiedTime: 0, context: { workingDirectory: '/p' } },
  ],
  '/p', undefined, 'linux',
);
assert.deepStrictEqual(named.map((s) => s.title), ['Release notes', 'only a summary', 'summary wins'], 'a saved name wins over the summary; an empty name does not');
// spec 006 T023 / 013 T005: a REAL getEvents() stream (redacted) of a session continued after a restart replays to exactly its two turns
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'events', 'real-getevents-restart.json'), 'utf8')) as { provenance: string; events: Parameters<typeof eventsToHistory>[0] };
  assert.strictEqual(fx.provenance, 'real-redacted');
  assert.ok(!/\/tmp\/|\/home\/|@[a-z0-9-]+\.[a-z]/i.test(JSON.stringify(fx.events)), 'no real paths or e-mail addresses');
  const real = eventsToHistory(fx.events);
  assert.deepStrictEqual(real.items.map((it) => [it.type, it.type === 'tool' ? it.tool : it.text]), [
    ['user', 'Remember the code word: marmalade. Reply with just OK.'],
    ['output', 'OK'],
    ['user', 'What was the code word I asked you to remember? Reply with the word only.'],
    ['output', 'marmalade'],
  ], 'session events, the system prompt and usage are not shown; both turns are');
  assert.strictEqual(real.truncated, false);
}

console.log('history tests passed');

// Spec 095 T012 (FR-024, D2): the search's text-only read. The replay (default limits) is unchanged; `textOnly` drops tool items before
// they are stored; the 300-item cap is lifted; the streamed Claude read gives exactly what claudeHistoryFromText gives on the same text.
process.exitCode = 1; // set to 0 only after the last async check (a promise that never settles must not pass)
const kinds = (h: { items: { type: string }[] }) => h.items.map((i) => i.type).join(',');
{
  const ev = (type: string, data: Record<string, unknown>) => ({ type, data, timestamp: '2026-10-19T10:00:00.000Z' });
  const evs = [
    ev('user.message', { content: 'run the tests' }),
    ev('tool.execution_start', { toolCallId: 't1', toolName: 'bash', arguments: { command: 'npm test' } }),
    ev('tool.execution_complete', { toolCallId: 't1', success: true, result: { content: 'TOOLONLY 3 passing' } }),
    ev('assistant.message', { content: 'All green.' }),
  ];
  assert.strictEqual(kinds(eventsToHistory(evs)), 'user,tool,output', 'the replay keeps tool items');
  assert.strictEqual(kinds(eventsToHistory(evs, SEARCH_HISTORY_LIMITS)), 'user,output', 'textOnly drops them');
  assert.ok(!JSON.stringify(eventsToHistory(evs, SEARCH_HISTORY_LIMITS)).includes('TOOLONLY'), 'no tool output anywhere in the result');
  const many = Array.from({ length: 450 }, (_, i) => ev('user.message', { content: `m${i}` }));
  assert.strictEqual(eventsToHistory(many).items.length, 300, 'the replay keeps its 300 cap');
  const all = eventsToHistory(many, SEARCH_HISTORY_LIMITS);
  assert.deepStrictEqual([all.items.length, all.truncated, (all.items[0] as { text: string }).text], [450, false, 'm0'], 'the search sees the oldest message too');
  assert.strictEqual((eventsToHistory([ev('user.message', { content: 'x'.repeat(25_000) })], SEARCH_HISTORY_LIMITS).items[0] as { text: string }).text.length, 20_001, '20 000 characters per message (plus the cut mark)');
}
{
  const thread = { turns: [{ items: [
    { type: 'userMessage', content: [{ type: 'text', text: 'fix it' }] },
    { type: 'commandExecution', id: 'c1', command: 'ls', aggregatedOutput: 'TOOLONLY a b', status: 'completed' },
    { type: 'fileChange', id: 'f1', changes: [{ path: '/p/a.ts' }], status: 'completed' },
    { type: 'agentMessage', text: 'Fixed.' },
  ] }] };
  assert.strictEqual(kinds(codexHistory(thread)), 'user,tool,tool,output', 'the Codex replay keeps commands and file changes');
  assert.strictEqual(kinds(codexHistory(thread, SEARCH_HISTORY_LIMITS)), 'user,output');
  assert.ok(!JSON.stringify(codexHistory(thread, SEARCH_HISTORY_LIMITS)).includes('TOOLONLY'));
  const big = { turns: [{ items: Array.from({ length: 400 }, (_, i) => ({ type: 'agentMessage', text: `a${i}` })) }] };
  assert.strictEqual(codexHistory(big).items.length, 300, 'the Codex replay keeps its cap');
  assert.strictEqual(codexHistory(big, SEARCH_HISTORY_LIMITS).items.length, 400, 'no cap for the search');
}

const J = (o: unknown): string => JSON.stringify(o);
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-095-stream-'));
const WS = path.join(CFG, 'ws folder');
const ID = '95959595-9595-4595-8595-959595959595';
const fileOf = (id: string) => path.join(CFG, 'projects', claudeProjectSlug(WS), `${id}.jsonl`);
fs.mkdirSync(path.dirname(fileOf(ID)), { recursive: true });
const cuser = (content: unknown, extra: Record<string, unknown> = {}) => J({ type: 'user', cwd: WS, timestamp: '2026-10-19T10:00:00.000Z', message: { role: 'user', content }, ...extra });
const casst = (content: unknown[], extra: Record<string, unknown> = {}) => J({ type: 'assistant', cwd: WS, timestamp: '2026-10-19T10:00:05.000Z', message: { role: 'assistant', content }, ...extra });
const claudeText = [
  cuser('Fix the invoice export'),
  casst([{ type: 'text', text: 'Looking. Ñandú 😀' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/p/x.ts' } }]),
  cuser([{ type: 'tool_result', tool_use_id: 'tu1', content: 'TOOLONLY export function x() {}' }]),
  casst([{ type: 'text', text: 'SIDECHAIN helper text' }], { isSidechain: true }),
  cuser('SIDECHAIN prompt', { isSidechain: true }),
  'not json',
  ...Array.from({ length: 350 }, (_, i) => casst([{ type: 'text', text: `reply ${i} ` + 'é'.repeat(i % 7) }])),
  casst([{ type: 'text', text: 'last' }]),
].join('\n') + '\n';

async function streamed(): Promise<void> {
  fs.writeFileSync(fileOf(ID), claudeText);
  // the scan path makes no synchronous fs call: every *Sync function of the real fs module throws while the stream reads
  const realFs = require('fs') as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const k of Object.keys(realFs)) if (/Sync$/.test(k) && typeof realFs[k] === 'function') { saved.set(k, realFs[k]); realFs[k] = () => { throw new Error(`${k} on the scan path`); }; }
  let r: Awaited<ReturnType<typeof readClaudeHistoryStream>>;
  let crlf: Awaited<ReturnType<typeof readClaudeHistoryStream>>;
  try {
    r = await readClaudeHistoryStream(ID, WS, SEARCH_HISTORY_LIMITS, CFG);
  } finally {
    for (const [k, v] of saved) realFs[k] = v;
  }
  assert.ok(r.ok, 'read');
  assert.deepStrictEqual(r.history, claudeHistoryFromText(claudeText, SEARCH_HISTORY_LIMITS), 'the streamed read equals claudeHistoryFromText on the same text');
  assert.strictEqual(r.history.items.length, 353, 'no 300 cap');
  assert.ok(!kinds(r.history).includes('tool'), 'no tool item');
  const flat = JSON.stringify(r.history);
  assert.ok(!flat.includes('TOOLONLY') && !flat.includes('SIDECHAIN'), 'no tool output, no side-chain line');
  const d = await readClaudeHistoryStream(ID, WS, {}, CFG);
  assert.ok(d.ok);
  assert.deepStrictEqual(d.history, claudeHistoryFromText(claudeText), 'with the replay limits too');
  // CRLF line ends (a file copied on Windows) and a missing last newline
  const ID2 = '95959595-9595-4595-8595-000000000002';
  fs.writeFileSync(fileOf(ID2), claudeText.trimEnd().split('\n').join('\r\n'));
  crlf = await readClaudeHistoryStream(ID2, WS, SEARCH_HISTORY_LIMITS, CFG);
  assert.ok(crlf.ok);
  assert.deepStrictEqual(crlf.history, claudeHistoryFromText(claudeText, SEARCH_HISTORY_LIMITS), 'CRLF reads the same');
  // over the cap: skipped, never read (the real cap is the reader's 50 MB)
  assert.strictEqual(MAX_FILE_BYTES, 50 * 1024 * 1024);
  assert.deepStrictEqual(await readClaudeHistoryStream(ID, WS, SEARCH_HISTORY_LIMITS, CFG, { maxBytes: 100 }), { ok: false, reason: 'too-large' }, 'too large, skipped');
  // missing file, bad id, a folder in place of the file, an empty file
  assert.deepStrictEqual(await readClaudeHistoryStream('95959595-0000-4000-8000-000000000000', WS, {}, CFG), { ok: false, reason: 'missing' });
  assert.deepStrictEqual(await readClaudeHistoryStream('../etc/passwd', WS, {}, CFG), { ok: false, reason: 'missing' }, 'the id passes the reader\'s allow-list');
  const ID3 = '95959595-9595-4595-8595-000000000003';
  fs.mkdirSync(fileOf(ID3));
  assert.deepStrictEqual(await readClaudeHistoryStream(ID3, WS, {}, CFG), { ok: false, reason: 'unreadable' });
  const ID4 = '95959595-9595-4595-8595-000000000004';
  fs.writeFileSync(fileOf(ID4), '');
  assert.deepStrictEqual(await readClaudeHistoryStream(ID4, WS, {}, CFG), { ok: true, history: { items: [], total: 0, truncated: false } });
  // a cancelled scan stops reading between lines
  let n = 0;
  const part = await readClaudeHistoryStream(ID, WS, SEARCH_HISTORY_LIMITS, CFG, { stop: () => ++n > 3 });
  assert.ok(part.ok && part.history.items.length <= 3, 'stopped early');
  // Windows-style folder: the slug is the reader's own (no new path code)
  assert.strictEqual(claudeProjectSlug('C:\\Users\\a b\\x.y'), 'C--Users-a-b-x-y');
}
streamed().then(() => {
  fs.rmSync(CFG, { recursive: true, force: true });
  console.log('history text-only and streamed Claude read tests passed');
  process.exitCode = 0;
}, (e) => {
  fs.rmSync(CFG, { recursive: true, force: true });
  console.error(e);
  process.exitCode = 1;
});
