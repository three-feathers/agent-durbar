/** Spec 058 FR-001 / FR-006 (T113): the word, icon and hint of an MCP server's state. `npm run test:mcpwords`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';

interface Words {
  stateOf: (s: unknown) => { word: string; icon: string; cls: string };
  iconSvg: (n: string) => string;
  hintFor: (o: { status?: string; errorClass?: string; error?: string; app?: string }) => string;
  plain: (t: unknown, n: number) => string;
  ICON_NAMES: string[];
  aggregate: (sessions: unknown[], configured?: unknown) => Agg;
  RANK: string[];
}
interface AggChat { id: string; name: string; folder: string; entry: { name: string; status?: string; error?: string }; state: { key: string; word: string } }
interface AggRow { name: string; chats: AggChat[]; parts: { key: string; word: string; n: number }[]; summary: string; icon: string; cls: string; attention: boolean }
interface Agg { servers: AggRow[]; attention: number; chats: number }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'mcpwords.js')) as Words;

// FR-001: every state has its word, and an icon shape (not colour alone)
const words: Record<string, string> = {
  connected: 'Running', pending: 'Starting', failed: 'Failed', 'needs-auth': 'Needs sign-in', disabled: 'Off for this session',
  stopped: 'Stopped', not_configured: 'Not set up for this session',
};
for (const [k, w] of Object.entries(words)) {
  const s = W.stateOf(k);
  assert.strictEqual(s.word, w, k);
  assert.ok(W.ICON_NAMES.includes(s.icon), `${k} has an icon shape`);
  assert.ok(s.cls.length > 0);
}
assert.strictEqual(new Set(['connected', 'pending', 'failed', 'needs-auth', 'disabled', 'stopped'].map((k) => W.stateOf(k).icon)).size, 6, 'the main states have different icons');
for (const none of [undefined, null, '']) assert.strictEqual(W.stateOf(none).word, 'Not started yet');
assert.strictEqual(W.stateOf('weird').word, 'Unknown state: weird', 'an unknown token is named');
assert.strictEqual(W.stateOf('weird').cls, 'unknown');
assert.strictEqual(W.stateOf('toString').word, 'Unknown state: toString', 'a prototype name is not a state');
assert.strictEqual(W.stateOf('__proto__').word, 'Unknown state: __proto__');
assert.strictEqual(W.stateOf({}).word, 'Unknown state: ?', 'a non-string is unknown');
assert.strictEqual(W.stateOf('a\nb\u0000c').word, 'Unknown state: a b c', 'control characters are flattened');
assert.ok(W.stateOf('x'.repeat(500)).word.length <= 'Unknown state: '.length + 40, 'a long token is cut');
// the token is returned as plain text: escaping is the caller's job, and the icon markup never contains it
assert.ok(!W.iconSvg('<img onerror=1>').includes('<img'), 'an unknown icon name falls back to a fixed shape');
for (const n of W.ICON_NAMES) assert.ok(/^<svg [^>]*aria-hidden="true"/.test(W.iconSvg(n)), n);

// the tooltip text (FR-168: at most 120): cut, flattened, never longer than n
assert.strictEqual(W.plain('x'.repeat(500), 120).length, 120);
assert.strictEqual(W.plain('a\nb', 120), 'a b');
assert.strictEqual(W.plain(undefined, 120), '');
assert.strictEqual(W.plain('short', 120), 'short');

// FR-006 / FR-069: the hints
const h = W.hintFor;
assert.strictEqual(h({ status: 'needs-auth', app: 'Copilot' }), 'This server needs you to sign in. Copilot keeps the sign-in; Agent Durbar never sees it.');
// the adapters' real display names read as a sentence (GitHub Copilot, Claude Code, OpenAI Codex)
for (const app of ['GitHub Copilot', 'Claude Code', 'OpenAI Codex']) assert.strictEqual(h({ status: 'needs-auth', app }), `This server needs you to sign in. ${app} keeps the sign-in; Agent Durbar never sees it.`);
assert.match(h({ status: 'needs-auth' }), /^This server needs you to sign in\. Your agent app keeps the sign-in/);
assert.match(h({ status: 'failed', errorClass: 'auth', app: 'Codex' }), /Codex keeps the sign-in/, 'a failed server the adapter classed as auth');
assert.match(h({ status: 'failed', errorClass: 'not-found' }), /command was not found/);
assert.match(h({ status: 'failed', errorClass: 'timeout' }), /too long/);
assert.match(h({ status: 'failed', errorClass: 'exited' }), /stopped on its own/);
assert.match(h({ status: 'failed', errorClass: 'config' }), /settings look wrong/);
assert.match(h({ status: 'failed', error: 'spawn npx ENOENT' }), /command was not found/);
assert.match(h({ status: 'failed', error: 'sh: foo: command not found' }), /command was not found/);
assert.match(h({ status: 'failed', error: "'x' is not recognized as an internal or external command" }), /command was not found/);
assert.match(h({ status: 'failed', error: 'spawn /bin/x EACCES' }), /Permission was denied/);
assert.match(h({ status: 'failed', error: 'request timed out after 30s' }), /too long/);
assert.match(h({ status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:9' }), /could not be reached/);
assert.match(h({ status: 'failed', error: 'getaddrinfo ENOTFOUND mcp.example.test' }), /could not be reached/);
assert.match(h({ status: 'failed', error: 'process exited with code 1' }), /stopped on its own/);
assert.strictEqual(h({ status: 'failed', error: 'something odd' }), '', 'no guess: no hint');
assert.strictEqual(h({ status: 'failed' }), '');
assert.strictEqual(h({ status: 'connected', error: 'ENOENT' }), '', 'only failed and needs-auth rows get a hint');
assert.strictEqual(h({ status: 'pending', errorClass: 'auth' }), '');
assert.strictEqual(h({ status: 'failed', errorClass: 'toString' }), '', 'a prototype name is not a class');
assert.strictEqual(h({ status: 'failed', errorClass: 'not-found', error: 'x' }), h({ status: 'failed', errorClass: 'not-found' }), 'the class wins over the text');
// a long hostile text is cheap
const t0 = Date.now();
h({ status: 'failed', error: 'a '.repeat(200000) + ';'.repeat(100000) });
assert.ok(Date.now() - t0 < 500, 'a long text is read in linear time');

// ---- Spec 058 FR-081 (T121): the live state of each server over the running chats, for Settings ----
{
  const reply = (servers: unknown[], live = true) => ({ ok: true, live, servers });
  const srv = (name: string, status?: string, more: Record<string, unknown> = {}) => ({ name, origin: 'cli', defaultOn: true, off: false, ...(status === undefined ? {} : { status }), ...more });
  const chat = (id: string, servers: unknown[], live = true) => ({ id, name: 'Agent ' + id, folder: 'folder-' + id, reply: reply(servers, live) });
  const by = (a: Agg, n: string) => { const r = a.servers.find((x) => x.name === n); assert.ok(r, 'row for ' + n); return r as AggRow; };
  const a = W.aggregate([
    chat('a', [srv('github', 'connected'), srv('notes', 'failed', { error: 'spawn x ENOENT' }), srv('web', undefined)]),
    chat('b', [srv('github', 'connected'), srv('notes', 'needs-auth'), srv('docs', 'pending')]),
    chat('c', [srv('github', 'connected'), srv('notes', 'connected'), srv('off-here', undefined, { off: true }), srv('off-settings', undefined, { defaultOn: false })]),
    chat('d', [srv('github', 'failed')], false), // not running: never counted
  ], ['github', 'idle-one', 'off-here']);
  assert.strictEqual(by(a, 'github').summary, 'Running in 3 chats', 'counts and plural');
  assert.deepStrictEqual(by(a, 'github').chats.map((c) => c.id), ['a', 'b', 'c'], 'a chat that is not running is left out');
  assert.strictEqual(by(a, 'notes').summary, 'Failed in 1 chat · Needs sign-in in 1 chat · Running in 1 chat', 'most urgent first, singular');
  assert.strictEqual(by(a, 'notes').cls, 'failed', 'the row takes the most urgent state');
  assert.strictEqual(by(a, 'notes').icon, W.stateOf('failed').icon);
  assert.ok(by(a, 'notes').attention, 'failed or needs sign-in needs attention');
  assert.ok(!by(a, 'github').attention);
  assert.strictEqual(by(a, 'web').summary, 'Not started yet in 1 chat', 'on, no state reported yet: not started in that chat');
  assert.strictEqual(by(a, 'docs').summary, 'Starting in 1 chat');
  assert.strictEqual(by(a, 'idle-one').summary, 'Not started yet', 'configured, no chat uses it');
  assert.strictEqual(by(a, 'idle-one').chats.length, 0);
  assert.strictEqual(by(a, 'off-here').chats.length, 0, 'off in that chat with no state: that chat does not use it');
  assert.ok(!a.servers.some((x) => x.name === 'off-settings'), 'off in Settings, not configured here, no state: not listed');
  assert.strictEqual(a.attention, 1, 'one server needs attention');
  assert.strictEqual(a.chats, 3, 'three running chats');
  assert.strictEqual(a.servers[0].name, 'notes', 'rows that need attention come first');
  assert.deepStrictEqual(a.servers.slice(1).map((x) => x.name), ['docs', 'github', 'web', 'idle-one', 'off-here'], 'then the servers a chat uses, then the rest, each by name');
  // a chat whose switch is off but the app still reports a state counts (it is what the session really does)
  const b = W.aggregate([chat('x', [srv('s', 'disabled', { off: true })])]);
  assert.strictEqual(by(b, 's').summary, 'Off for this session in 1 chat');
  // the urgency order (FR-081)
  assert.deepStrictEqual(W.RANK, ['failed', 'needs-auth', 'pending', 'unknown', 'none', 'connected', 'not_configured', 'stopped', 'disabled']);
  const all = W.aggregate([['connected', 'disabled', 'stopped', 'not_configured', undefined, 'weird', 'pending', 'needs-auth', 'failed'].map((st, i) => chat('k' + i, [srv('one', st)]))].flat());
  assert.strictEqual(by(all, 'one').summary, 'Failed in 1 chat · Needs sign-in in 1 chat · Starting in 1 chat · Unknown state: weird in 1 chat · Not started yet in 1 chat · Running in 1 chat · Not set up for this session in 1 chat · Stopped in 1 chat · Off for this session in 1 chat');
  // two different unknown tokens are two parts, each named
  const u = W.aggregate([chat('p', [srv('z', 'odd')]), chat('q', [srv('z', 'odder')]), chat('r', [srv('z', 'odd')])]);
  assert.strictEqual(by(u, 'z').summary, 'Unknown state: odd in 2 chats · Unknown state: odder in 1 chat');
  // the entry is passed through as main sent it (masked there): Details shows exactly that text
  assert.strictEqual(by(a, 'notes').chats[0].entry.error, 'spawn x ENOENT');
  assert.strictEqual(by(a, 'notes').chats[0].folder, 'folder-a');
  // bad input never throws, and names are exact
  const bad = W.aggregate([null, {}, { id: 'n', reply: null }, { id: 'm', reply: { ok: false, live: true, servers: [srv('q', 'connected')] } }, chat('o', [null, { name: '' }, { name: 5 }, srv('Q', 'connected'), srv('q', 'failed')])] as unknown[], 'nope');
  assert.deepStrictEqual(bad.servers.map((x) => x.name).sort(), ['Q', 'q'], 'only real names; case is kept apart');
  assert.strictEqual(W.aggregate(undefined as unknown as unknown[]).servers.length, 0);
  // a chat that lists one server twice is counted once
  const dup = W.aggregate([chat('d1', [srv('w', 'connected'), srv('w', 'failed')])]);
  assert.strictEqual(by(dup, 'w').summary, 'Running in 1 chat');
  // caps: 50 chats, 200 servers
  const many = W.aggregate(Array.from({ length: 80 }, (_, i) => chat('c' + i, Array.from({ length: 5 }, (_, j) => srv('s' + (i * 5 + j), 'connected')))));
  assert.strictEqual(many.chats, 50, 'at most 50 chats are read');
  assert.strictEqual(many.servers.length, 200, 'at most 200 servers are listed');
  const wide = W.aggregate([chat('one', [srv('zzz', 'connected')])], Array.from({ length: 300 }, (_, i) => 'cfg' + i));
  assert.strictEqual(wide.servers.length, 200);
  assert.ok(wide.servers.some((x) => x.name === 'zzz'), 'a server a chat uses is kept before configured-only ones');
}
console.log('[058] mcpwords: PASS');
