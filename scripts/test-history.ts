/** Unit tests for previous Copilot sessions per folder and history replay (synthetic events): `npm run test:history`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { cleanSessionTitle, cleanTitle, eventsToHistory, normDir, previousSessionsFor, sameDir } from '../src/adapters/history';

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
