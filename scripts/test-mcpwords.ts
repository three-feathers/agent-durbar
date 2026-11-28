/** Spec 058 FR-001 / FR-006 (T113): the word, icon and hint of an MCP server's state. `npm run test:mcpwords`. No credits spent. */
import * as assert from 'assert';
import { assertCutFirst } from './hang-backstop';
import * as path from 'path';
import { maskMcpError } from '../src/main/mcpmask';
import * as fs from 'fs';
import * as shared from '../src/shared/redact';
import { maskHomePathsOutbound, maskSecretUrl, redact } from '../src/shared/redact';

interface Words {
  signInPressNote: (name: unknown, row: unknown, err?: unknown, live?: boolean) => string;
  stateOf: (s: unknown, ctx?: { off?: boolean; defaultOn?: boolean; origin?: string; app?: string; launchedOff?: boolean; switchedHere?: boolean }) => { word: string; icon: string; cls: string };
  offBy: (ctx?: { off?: boolean; defaultOn?: boolean; launchedOff?: boolean; switchedHere?: boolean }) => string;
  iconSvg: (n: string) => string;
  hintFor: (o: { by?: string; status?: string; errorClass?: string; error?: string; app?: string }) => string;
  plain: (t: unknown, n: number) => string;
  ICON_NAMES: string[];
  aggregate: (sessions: unknown[], configured?: unknown) => Agg;
  RANK: string[];
  reasonOf: (x: unknown) => { key: string; word: string } | null;
  whenText: (since: unknown, now?: number) => string;
  diagnostics: (o: unknown, redact: unknown) => string;
  fixFor: (key: unknown, ctx?: { file?: string }) => string;
  fileFindings: (g: unknown) => Finding[];
  chatFinding: (x: unknown, chat: unknown, policy?: boolean) => Finding;
  launchYoung: (t0: unknown, now: unknown) => boolean;
  launchUpdate: (items: unknown, e: unknown, chat: unknown, young: boolean) => boolean;
  restartTargets: (chats: unknown, usable?: (c: { id: string }) => boolean) => { targets: { id: string }[]; failed: unknown[]; skipped: { chat: { id: string }; why: string }[] };
  LAUNCH_MS: number;
}
interface Finding { key: string; kind: string; name: string; where: string; reason: string; rkey: string; fix: string; chatId?: string }
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
// spec 058 FR-229 (issue 1229): a chat's Sign in press that cannot start a sign-in always has text
for (const [row, err] of [[undefined, undefined], [{}, undefined], [{ canSignIn: true }, undefined], [{ canSignIn: true }, 'No session.'], [{ signIn: { host: 'h' } }, undefined], [{ canSignIn: false }, '   '], [undefined, 7]] as Array<[unknown, unknown]>) {
  const t = W.signInPressNote('teams', row, err);
  assert.match(t, /^Could not start the sign-in for teams: \S.{8,}/, `text for ${JSON.stringify(row)} ${String(err)}`);
}
assert.match(W.signInPressNote('teams', undefined), /not in this chat/, 'no row');
assert.match(W.signInPressNote('teams', { canSignIn: false }), /cannot start the sign-in from here/, 'a row without Sign in');
assert.match(W.signInPressNote('teams', undefined, undefined, false), /session is not running/, 'a session that is not running says so, not "not in the list"');
assert.match(W.signInPressNote('teams', { canSignInAgain: true, canSignIn: false }), /Sign in again/, 'a row with Sign in again names it');
assert.match(W.signInPressNote('teams', { signIn: { host: 'h' } }), /already open/, 'an open sign-in');
assert.strictEqual(W.signInPressNote('teams', {}, 'The session did not start.'), 'Could not start the sign-in for teams: The session did not start.', 'the call\'s own masked text wins');
assert.match(W.signInPressNote('', undefined), /for this server:/, 'no name');
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

// FR-078: a `disabled` server says who turned it off, and the word agrees with the switch
assert.strictEqual(W.stateOf('disabled', { off: true, defaultOn: true, app: 'GitHub Copilot' }).word, 'Off for this session', 'switched off here');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: false, origin: 'cli', app: 'GitHub Copilot' }).word, 'Off in Settings');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: false, origin: 'folder' }).word, 'Off in folder extras');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true, app: 'GitHub Copilot' }).word, 'Off in GitHub Copilot', 'turned off by the agent app');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true }).word, 'Turned off by the agent app', 'no app name: the fallback');
assert.ok(W.stateOf('disabled', { off: false, defaultOn: true, app: 'x'.repeat(500) }).word.length <= 'Off in '.length + 40, 'a long app name is cut');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true, app: 'A\nB' }).word, 'Off in A B', 'control characters flattened');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true, app: 'X' }).icon, 'off');
assert.strictEqual(W.stateOf('connected', { off: true, defaultOn: true }).word, 'Running', 'only `disabled` is reworded');
assert.deepStrictEqual([{ off: true, defaultOn: true }, { off: false, defaultOn: false }, { off: false, defaultOn: true }].map((c) => W.offBy(c)), ['here', 'settings', 'app']);
// FR-078: a server Durbar itself passed as off at the session start is never blamed on the agent app
assert.strictEqual(W.offBy({ off: false, defaultOn: true, launchedOff: true }), 'start');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true, launchedOff: true, app: 'GitHub Copilot' }).word, 'Off until the session restarts');
assert.strictEqual(W.offBy({ off: false, defaultOn: true, switchedHere: true }), 'pending');
assert.strictEqual(W.stateOf('disabled', { off: false, defaultOn: true, switchedHere: true }).word, 'Starting', 'no flicker: switched on here, the old `disabled` reads Starting');
assert.strictEqual(W.offBy({ off: true, defaultOn: true, launchedOff: true }), 'here', 'the switch wins');
assert.strictEqual(W.offBy({ off: false, defaultOn: false, launchedOff: true }), 'settings');
assert.match(W.hintFor({ status: 'disabled', by: 'start' }), /Restart session with these servers/);
assert.match(W.hintFor({ status: 'disabled', by: 'app', app: 'GitHub Copilot' }), /^Turn it on in GitHub Copilot\u2019s own MCP settings, then restart the session\./);
assert.match(W.hintFor({ status: 'disabled', by: 'app' }), /^Turn it on in the agent app\u2019s own MCP settings/, 'no app name: the fallback');
assert.strictEqual(W.hintFor({ status: 'disabled', by: 'here', app: 'X' }), '', 'a server switched off here needs no hint');
assert.strictEqual(W.hintFor({ status: 'disabled' }), '', 'no hint without the origin');

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
assert.match(h({ status: 'failed', errorClass: 'not-found' }), /^Install the command, or put its full path/);
assert.match(h({ status: 'failed', errorClass: 'timeout' }), /times out again/);
// review on #1073 item 4: one wording per failure kind: the row's hint is the strip's fix (FR-201)
for (const [cls, key] of [['not-found', 'not-found'], ['timeout', 'timeout'], ['exited', 'crashed'], ['permission', 'permission'], ['refused', 'refused'], ['disconnected', 'disconnected']]) assert.strictEqual(h({ status: 'failed', errorClass: cls }), W.fixFor(key), cls);
assert.match(h({ status: 'failed', errorClass: 'exited' }), /^Open Details for the server.s own error/);
assert.match(h({ status: 'failed', errorClass: 'config' }), /settings look wrong/);
assert.match(h({ status: 'failed', error: 'spawn npx ENOENT' }), /^Install the command, or put its full path/);
assert.match(h({ status: 'failed', error: 'sh: foo: command not found' }), /^Install the command, or put its full path/);
assert.match(h({ status: 'failed', error: "'x' is not recognized as an internal or external command" }), /^Install the command, or put its full path/);
assert.match(h({ status: 'failed', error: 'spawn /bin/x EACCES' }), /^Allow the command to run/);
assert.match(h({ status: 'failed', error: 'request timed out after 30s' }), /times out again/);
assert.match(h({ status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:9' }), /address or port/);
assert.match(h({ status: 'failed', error: 'getaddrinfo ENOTFOUND mcp.example.test' }), /address or port/);
assert.match(h({ status: 'failed', error: 'process exited with code 1' }), /^Open Details for the server.s own error/);
assert.strictEqual(h({ status: 'failed', error: 'something odd' }), '', 'no guess: no hint');
assert.strictEqual(h({ status: 'failed' }), '');
assert.strictEqual(h({ status: 'connected', error: 'ENOENT' }), '', 'only failed and needs-auth rows get a hint');
assert.strictEqual(h({ status: 'pending', errorClass: 'auth' }), '');
assert.strictEqual(h({ status: 'failed', errorClass: 'toString' }), '', 'a prototype name is not a class');
assert.strictEqual(h({ status: 'failed', errorClass: 'not-found', error: 'x' }), h({ status: 'failed', errorClass: 'not-found' }), 'the class wins over the text');
// a long hostile text is cheap
assertCutFirst('hintFor reads only the first 2000 characters of the error text', 2000, () => { h({ status: 'failed', error: 'a '.repeat(200000) + ';'.repeat(100000) }); });

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
  // a disabled server reads as the chat dialog says it (FR-078): off in Settings, off in the agent app
  const off2 = W.aggregate([{ id: 'o1', name: 'A', folder: 'f', reply: { ok: true, live: true, app: 'Copilot', servers: [srv('t', 'disabled', { defaultOn: false })] } }, chat('o2', [srv('t', 'disabled')])]);
  assert.strictEqual(by(off2, 't').summary, 'Off in Settings in 1 chat · Turned off by the agent app in 1 chat', 'each off reason is its own part, in the chat dialog\'s words');
  // review on #609 (fjcabello): a server whose only state is needs sign-in needs attention on its own
  const na = W.aggregate([chat('n1', [srv('auth-only', 'needs-auth')]), chat('n2', [srv('fine', 'connected')])]);
  assert.strictEqual(by(na, 'auth-only').summary, 'Needs sign-in in 1 chat');
  assert.strictEqual(by(na, 'auth-only').cls, 'needs-auth');
  assert.strictEqual(by(na, 'auth-only').icon, W.stateOf('needs-auth').icon);
  assert.ok(by(na, 'auth-only').attention, 'needs sign-in alone needs attention');
  assert.strictEqual(na.attention, 1, 'and is counted');
  assert.strictEqual(na.servers[0].name, 'auth-only', 'and comes first');
  // the urgency order (FR-081)
  assert.deepStrictEqual(W.RANK, ['failed', 'needs-auth', 'pending', 'unknown', 'none', 'connected', 'not_configured', 'stopped', 'disabled']);
  const all = W.aggregate([['connected', 'disabled', 'stopped', 'not_configured', undefined, 'weird', 'pending', 'needs-auth', 'failed'].map((st, i) => chat('k' + i, [srv('one', st)]))].flat());
  assert.strictEqual(by(all, 'one').summary, 'Failed in 1 chat · Needs sign-in in 1 chat · Starting in 1 chat · Unknown state: weird in 1 chat · Not started yet in 1 chat · Running in 1 chat · Not set up for this session in 1 chat · Stopped in 1 chat · Turned off by the agent app in 1 chat');
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

// ---- Spec 058 FR-090 (issue #603, T141): one plain reason per failed server; never guessed ----
{
  const r = (x: Record<string, unknown>) => { const v = W.reasonOf(x); return v ? v.word : null; };
  const k = (x: Record<string, unknown>) => { const v = W.reasonOf(x); return v ? v.key : null; };
  assert.strictEqual(r({ status: 'needs-auth' }), 'Refused: needs sign-in');
  assert.strictEqual(r({ status: 'failed', errorClass: 'auth', error: 'spawn x ENOENT' }), 'Refused: needs sign-in', 'auth wins');
  assert.strictEqual(r({ status: 'failed', errorClass: 'not-found' }), 'Not installed (command not found)');
  assert.strictEqual(r({ status: 'failed', errorClass: 'exited' }), 'Crashed on start');
  assert.strictEqual(r({ status: 'failed', errorClass: 'exited', afterRunning: true }), 'Disconnected later', 'it ran first');
  assert.strictEqual(r({ status: 'failed', errorClass: 'disconnected' }), 'Disconnected later');
  assert.strictEqual(r({ status: 'failed', errorClass: 'timeout' }), 'Timed out');
  assert.strictEqual(r({ status: 'failed', errorClass: 'refused' }), 'Refused the connection');
  assert.strictEqual(r({ status: 'failed', errorClass: 'permission' }), 'Permission denied');
  assert.strictEqual(r({ status: 'failed', errorClass: 'config' }), 'Settings look wrong');
  assert.strictEqual(r({ status: 'failed', errorClass: 'timeout', error: 'spawn x ENOENT' }), 'Timed out', 'the class wins over the text');
  // the text rules are the hint's (one classifier): the reason and the hint never disagree
  const texts: [string, string][] = [
    ['spawn markitdown-mcp ENOENT', 'not-found'], ['sh: playwright: command not found', 'not-found'], ["'x' is not recognized as an internal or external command", 'not-found'],
    ['spawn /bin/x EACCES', 'permission'], ['request timed out after 30s', 'timeout'], ['connect ECONNREFUSED 127.0.0.1:9', 'refused'],
    ['getaddrinfo ENOTFOUND mcp.example.test', 'refused'], ['process exited with code 1', 'crashed'], ['invalid configuration: url', 'config'],
  ];
  for (const [t, want] of texts) {
    assert.strictEqual(k({ status: 'failed', error: t }), want, t);
    assert.ok(W.hintFor({ status: 'failed', error: t }).length > 0, 'a reason from the text has a hint too: ' + t);
  }
  assert.strictEqual(r({ status: 'failed', error: 'process exited with code 1', afterRunning: true }), 'Disconnected later');
  // nothing said: "Disconnected later" only when it was seen Running first; otherwise "reason unknown"
  assert.strictEqual(r({ status: 'failed', afterRunning: true }), 'Disconnected later');
  assert.strictEqual(r({ status: 'failed', error: 'something odd' }), 'Failed (reason unknown)');
  assert.strictEqual(r({ status: 'failed' }), 'Failed (reason unknown)');
  assert.strictEqual(r({ status: 'failed', errorClass: 'toString' }), 'Failed (reason unknown)', 'a prototype name is not a class');
  assert.strictEqual(r({ status: 'failed', errorClass: 'made-up' }), 'Failed (reason unknown)', 'an unknown class is not guessed');
  for (const st of ['connected', 'pending', 'disabled', 'stopped', '', undefined]) assert.strictEqual(W.reasonOf({ status: st, error: 'ENOENT', errorClass: 'not-found' }), null, 'no reason for ' + st);
  assert.strictEqual(W.reasonOf(null), null);
  // hints for the new classes
  assert.match(W.hintFor({ status: 'failed', errorClass: 'refused' }), /address or port/);
  assert.match(W.hintFor({ status: 'failed', errorClass: 'permission' }), /^Allow the command to run/);
  assert.match(W.hintFor({ status: 'failed', errorClass: 'disconnected' }), /still runs or can be reached/);
}
// ---- FR-092: when (local time; the date when not today) ----
{
  const at = new Date(2026, 9, 23, 14, 2, 31).getTime();
  assert.strictEqual(W.whenText(at, new Date(2026, 9, 23, 18, 0, 0).getTime()), 'at 14:02');
  assert.strictEqual(W.whenText(at, new Date(2026, 9, 24, 9, 0, 0).getTime()), 'on 2026-10-23 at 14:02');
  assert.strictEqual(W.whenText(new Date(2026, 0, 5, 7, 9).getTime(), new Date(2026, 0, 5, 8, 0).getTime()), 'at 07:09', 'padded');
  for (const bad of [undefined, null, 'x', NaN, -1, 0, Infinity, 1e20]) assert.strictEqual(W.whenText(bad, at), '', String(bad));
}
// ---- FR-093: Copy diagnostics: only what the reply has, masked in main and by redact() again; fail closed ----
{
  const TOKEN = 'ghp_' + 'Q7m2Kx9Lp4Rt8Vw1Yz6Bn3Cd5Fg0Hj2Mk4Ns';
  const SESSION = 'session-only-s3cr3t-value';
  const raw = `spawn markitdown-mcp ENOENT (cmd: markitdown-mcp --api-key ${SESSION} ${TOKEN}) https://user:pw@mcp.example.test/x?token=${TOKEN}`;
  const since = new Date(2026, 9, 23, 14, 2, 31).getTime();
  const entry = { name: 'markitdown-mcp', status: 'failed', errorClass: 'not-found', error: maskMcpError(raw, [SESSION]), since, transport: 'stdio' };
  assert.ok(!String(entry.error).includes(TOKEN) && !String(entry.error).includes(SESSION), 'main masked it first');
  const text = W.diagnostics({ server: 'markitdown-mcp', entry, app: 'GitHub Copilot', appVersion: '1.0.101', now: since + 60_000 }, redact);
  for (const want of ['Server: markitdown-mcp', 'State: Failed', 'Reason: Not installed (command not found)', 'Transport: stdio', 'Agent app: GitHub Copilot 1.0.101', `When (UTC): ${new Date(since).toISOString()}`, 'Error (masked):'])
    assert.ok(text.includes(want), 'has ' + want + '\n' + text);
  assert.ok(!text.includes(TOKEN) && !text.includes(TOKEN.slice(4, 20)) && !text.includes(SESSION) && !text.includes('pw@'), 'no secret, no piece of the token');
  assert.ok(!/folder|\/home\/|C:\\\\/i.test(text), 'no folder or path');
  // a token in a field main does not mask (a server name) is caught by redact() in the page
  const t2 = W.diagnostics({ server: 'srv-' + TOKEN, entry: { status: 'failed' }, app: 'Claude Code' }, redact);
  assert.ok(!t2.includes(TOKEN), 'redact() runs over the whole text');
  assert.match(t2, /Reason: Failed \(reason unknown\)/);
  assert.match(t2, /Transport: not reported/);
  assert.match(t2, /Agent app: Claude Code \(version not known\)/);
  assert.match(t2, /Error \(masked\): none reported/);
  assert.match(t2, /When \(UTC\): not known/);
  assert.ok(!/local/i.test(text), 'UTC only: no local time next to it (it would give away the time zone)');
  // fail closed: no redact, a throwing one, or a non-string result copies nothing
  assert.strictEqual(W.diagnostics({ server: 's', entry }, undefined), '');
  assert.strictEqual(W.diagnostics({ server: 's', entry }, () => { throw new Error('x'); }), '');
  assert.strictEqual(W.diagnostics({ server: 's', entry }, () => 5), '');
  // control characters are flattened, long fields are cut (the error keeps main's 300)
  const t3 = W.diagnostics({ server: 'a\nb', entry: { status: 'failed', error: 'line1\nline2', transport: 'x'.repeat(500) }, app: 'A\u0000B' }, (s: string) => s);
  assert.match(t3, /Server: a b/);
  assert.match(t3, /Agent app: A B/);
  assert.ok(t3.split('\n').every((l) => l.length <= 420), 'no endless line');
}
// ---- Review on PR #630: home paths, OAuth values, any-case bearer, mask before cut, bidi marks, 401 is not a crash ----
{
  const TOKEN = 'ghp_' + 'Q7m2Kx9Lp4Rt8Vw1Yz6Bn3Cd5Fg0Hj2Mk4Ns';
  const pageMask = (t: string) => maskHomePathsOutbound(maskSecretUrl(t)); // what screens.js passes (DurbarRedact; spec 012 FR-435: the outbound home mask)
  // item 9: an error that was NOT masked in main (the simulator's path): diagnostics still mask it, field by field
  const raw = W.diagnostics({ server: 's', entry: { status: 'failed', error: `boom ${TOKEN} end` } }, redact);
  assert.ok(raw && !raw.includes(TOKEN) && !raw.includes(TOKEN.slice(4, 16)), 'an unmasked token in the error is masked by the copy itself');
  assert.match(raw, /Error \(masked\): boom \[redacted\] end/);
  // item 2: home folders, both path styles, through main's masking and through the page's
  const home = maskMcpError('spawn /home/vikram/.local/bin/markitdown-mcp ENOENT; C:\\Users\\vikram\\AppData\\npx.cmd is not recognized; /Users/vikram/x');
  assert.ok(home && !/vikram/.test(home), 'main replaces home folders: ' + home);
  assert.match(String(home), /spawn ~\/\.local\/bin\/markitdown-mcp ENOENT; ~\\AppData\\npx\.cmd is not recognized; ~\/x/);
  const d2 = W.diagnostics({ server: 'm', entry: { status: 'failed', error: 'spawn /home/alice/bin/x ENOENT', transport: 'C:\\Users\\Bob Smith\\t' } }, pageMask);
  assert.ok(!/alice|Bob|Smith/.test(d2), 'the page mask replaces them too: ' + d2);
  // spec 012 FR-435 (issue #2060 item 2): the diagnostics text leaves the machine (an issue report), so it keeps the share path masking the screen dropped.
  // `copyDiagnostics`'s own mask line from screens.js, run with the compiled shared mask: a UNC server, share and next folder are not in the copy
  // The source is read with either line end (a Windows checkout has CRLF): every cut below runs on an LF and a CRLF copy (brief rule 18)
  const SCREENS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'screens.js'), 'utf8').replace(/\r\n/g, '\n');
  const SCREENS_COPIES: [string, string][] = [['LF', SCREENS_SRC], ['CRLF', SCREENS_SRC.replace(/\n/g, '\r\n')]];
  /** `copyDiagnostics`'s mask line, cut out of a copy of screens.js (either line end). */
  const diagMaskLine = (scr: string): string => (scr.slice(scr.indexOf('async function copyDiagnostics(')).match(/^[ \t]*const mask=[^\r\n]*/m) || [''])[0];
  /** `copyErrorText`, cut out of a copy of screens.js (either line end): from its head to the first line that is its closing brace. */
  const cutCopyErrorText = (scr: string): string => {
    const at = scr.indexOf('function copyErrorText(');
    const end = /\r?\n {2}\}\r?\n/.exec(scr.slice(at));
    return at < 0 || !end ? '' : scr.slice(at, at + end.index + end[0].length);
  };
  for (const [le, scr] of SCREENS_COPIES) {
    const line = diagMaskLine(scr);
    assert.ok(line.includes('maskSecretUrl') && !line.includes('\r'), `FR-435 copyDiagnostics has its mask line (${le} copy): ` + line.trim().slice(0, 80));
    const m = new Function('R', line + '\nreturn mask;')(shared) as ((t: string) => string) | null;
    assert.ok(typeof m === 'function', `FR-435 copyDiagnostics builds a mask from the shared module (${le} copy)`);
    const src = cutCopyErrorText(scr);
    let whole = false;
    try { whole = typeof new Function('window', 'X', 'copyText', src + '\nreturn copyErrorText;')({}, {}, () => undefined) === 'function'; } catch { /* not cut out whole */ }
    assert.ok(whole, `FR-435 copyErrorText is cut out whole (${le} copy)`);
  }
  {
    const line = diagMaskLine(SCREENS_SRC);
    const mask = new Function('R', line + '\nreturn mask;')(shared) as ((t: string) => string) | null;
    const B = '\\';
    for (const p of [B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'mcp.log', '//fs01/homes/zedq/mcp.log']) {
      const d = W.diagnostics({ server: 's', entry: { status: 'failed', error: 'spawn ' + p + ' ENOENT' } }, mask);
      assert.ok(d && !/fs01|homes|zedq/.test(d) && d.includes('mcp.log ENOENT'), 'FR-435 the diagnostics copy hides a share path\'s host, share and next folder: ' + d.split('\n').pop());
    }
    assert.strictEqual(shared.maskHomePaths(B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'mcp.log'), B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'mcp.log', 'FR-435 (control) the screen mask shows it whole');
    // review of PR 2112, finding 1: main masks an MCP error with the screen mask and then cuts it at 300 characters, so the cut can end inside a share path.
    // Every cut position (the share starting 0 to 300 characters before the cut), several share shapes: no server and no user name in the diagnostics copy.
    const SH: [string, RegExp][] = [
      [B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'mcp.log', /fs01|zedq/], [B.repeat(4) + 'fs01' + B + B + 'homes' + B + B + 'zedq' + B + B + 'mcp.log', /fs01|zedq/],
      [B + B + 'fs01.corp.example' + B + 'homes' + B + 'zedq' + B + 'x.log', /fs01|corp|zedq/], [B + B + '10.0.0.5' + B + 'homes' + B + 'zedq' + B + 'x.log', /10\.0\.0|zedq/],
      [B + B + 'fs01' + B + 'c$' + B + 'zedq' + B + 'app.log', /fs01|zedq/], ['//fs01/homes/zedq/mcp.log', /fs01|zedq/],
    ];
    let positions = 0;
    const leaks: string[] = [];
    for (const [p, bad] of SH) for (let o = 0; o <= 300; o++) {
      const err = ('w '.repeat(160)).slice(0, o).replace(/w$/, ' ') + p + ' end' + ' z'.repeat(200); // the share starts after a blank
      const mainSide = maskMcpError(err) as string; // what main hands the window (screen mask, then the cut)
      const d = W.diagnostics({ server: 's', entry: { status: 'failed', error: mainSide } }, mask);
      positions++;
      if (!d || bad.test(d)) leaks.push(o + ': ' + d.split('\n').pop());
    }
    assert.deepStrictEqual(leaks.slice(0, 3), [], `FR-435 the diagnostics copy after main's cut shows no server or user name at any cut position (${positions} positions, ${leaks.length} leak)`);
    assert.ok(maskMcpError(('w '.repeat(160)).slice(0, 290) + SH[0][0] + ' end' + ' z'.repeat(200))!.includes(B + B + 'fs01'), 'FR-435 (control) main\'s cut can end inside a share path, after its server');
  }
  // review of PR 2112, finding 2: both Copy error text buttons copy through `copyErrorText` (screens.js), which keeps the outbound mask; it is run from the page's
  // source with the compiled shared mask, and fails closed (nothing copied) without it
  for (const [le, scr] of SCREENS_COPIES) {
    const src = cutCopyErrorText(scr);
    const run = (R: unknown, t: string): { copied: string[]; toasts: string[] } => {
      const copied: string[] = [], toasts: string[] = [];
      const X = { toast: (m: string) => { toasts.push(m); return { classList: { add() {} } }; } };
      new Function('window', 'X', 'copyText', src + '\nreturn copyErrorText;')({ DurbarRedact: R }, X, (x: string) => { copied.push(x); return Promise.resolve(); })(t);
      return { copied, toasts };
    };
    const B = '\\';
    const e1 = 'spawn ' + B + B + 'fs01' + B + 'homes' + B + 'zedq' + B + 'bin' + B + 'mcp.exe ENOENT';
    const r1 = run(shared, e1);
    assert.strictEqual(r1.copied.length, 1, `FR-435 copyErrorText copies once (${le} copy)`);
    assert.ok(!/fs01|homes|zedq/.test(r1.copied[0]) && r1.copied[0] === 'spawn ~' + B + 'bin' + B + 'mcp.exe ENOENT', `FR-435 Copy error text keeps the outbound mask (no server, share or user name on the clipboard; ${le} copy): ` + r1.copied[0]);
    assert.strictEqual(run(shared, 'connection refused').copied[0], 'connection refused', `FR-435 Copy error text copies a plain error as it is (${le} copy)`);
    const r2 = run({ redact: shared.redact }, e1);
    assert.ok(r2.copied.length === 0 && /nothing was copied/.test(r2.toasts[0] || ''), `FR-435 Copy error text copies nothing without the outbound mask (${le} copy)`);
    const r3 = run({ maskHomePathsOutbound: () => '[redaction failed]' }, e1);
    assert.ok(r3.copied.length === 0, `FR-435 Copy error text copies nothing when the mask failed (${le} copy)`);
    // both buttons call it, and no copy of an error goes around it
    assert.ok(/data-lvcopy\]'\)\)\{void copyErrorText\(c\.entry\.error\|\|''\)/.test(scr), `FR-435 the live rows' Copy error text calls copyErrorText (${le} copy)`);
    assert.ok(/data-copy\]'\);\s*if\(cb\)\{const sv=[^}]*void copyErrorText\(sv&&sv\.error\|\|''\)/.test(scr), `FR-435 the MCP dialog's Copy error text calls copyErrorText (${le} copy)`);
    assert.ok(!/copyText\([^)]*\.error\b/.test(scr), `FR-435 no copyText of an error text outside copyErrorText (${le} copy)`);
  }
  // item 3: OAuth code/state/id_token/refresh_token and a lowercase bearer
  const oauth = maskMcpError('callback https://x.test/cb?code=AbC123xyz&state=st4te99&ok=1#id_token=abc.def&refresh_token=r3fr3sh timeout; bearer abcdefgh12345678');
  for (const v of ['AbC123xyz', 'st4te99', 'abc.def', 'r3fr3sh', 'abcdefgh12345678']) assert.ok(oauth && !oauth.includes(v), 'masked: ' + v + ' in ' + oauth);
  assert.ok(String(oauth).includes('ok=1'), 'other query values stay');
  // item 5: a value is masked before it is cut: a 185-character name followed by a token leaves no piece of it
  const longName = 'n'.repeat(184) + '-' + TOKEN;
  const d3 = W.diagnostics({ server: longName, entry: { status: 'failed' } }, redact);
  assert.ok(d3 && !/ghp_|Q7m2Kx9L/.test(d3), 'no head of the token after the cut: ' + d3.split('\n')[1]);
  // item 6: bidi and format marks never reach the copy (or a title)
  const BIDI = '\u202e\u2066\u2069\u200f\ufeff';
  const d4 = W.diagnostics({ server: 'a' + BIDI + 'b', entry: { status: 'failed', error: 'x' + BIDI + 'y' } }, redact);
  assert.ok(d4 && !/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(d4), 'no bidi or format mark in the copy');
  assert.strictEqual(W.plain('a\u202eb', 20), 'a b');
  // item 8: an auth refusal is "Refused: needs sign-in", never a crash, even when the text also says terminated or closed
  for (const t of ['SSE stream terminated: 401', 'HTTP 403 Forbidden, process exited', 'Unauthorized: connection closed']) {
    assert.strictEqual(W.reasonOf({ status: 'failed', error: t })?.word, 'Refused: needs sign-in', t);
    assert.match(W.hintFor({ status: 'failed', error: t, app: 'X' }), /needs you to sign in/, t);
  }
}
// spec 058 FR-201 (T169): a fix per reason key, fixed text; unknown and prototype keys get the "unknown" fix; config names the file
{
  for (const k of ['auth', 'not-found', 'policy', 'refused', 'crashed', 'timeout', 'permission', 'disconnected', 'unknown']) assert.ok(W.fixFor(k).length > 20, k);
  assert.match(W.fixFor('policy'), /organization/);
  assert.match(W.fixFor('not-found'), /full path/);
  for (const k of ['__proto__', 'constructor', 'toString', 'nope', undefined]) assert.strictEqual(W.fixFor(k), W.fixFor('unknown'), String(k));
  assert.match(W.fixFor('config', { file: '~/.codex/config.toml' }), /Fix the entry in ~\/\.codex\/config\.toml\./);
  assert.ok(!/‮/.test(W.fixFor('config', { file: 'a‮b' })), 'the file label is flattened');
}
// FR-199 part 1 (T169): file findings: an unreadable list, a missing command once per name over the lists, switched-off servers skipped
{
  const g = { ok: true, apps: [
    { app: 'copilot', label: 'Copilot CLI', file: '~/.copilot/mcp-config.json', servers: [{ name: 'pw', missing: true }, { name: 'off-one', missing: true }], off: ['off-one'] },
    { app: 'claude', label: 'Claude Code', file: '~/.claude.json', servers: [{ name: 'pw', missing: true }, { name: 'ok' }, { name: '', missing: true }], off: [] },
    { app: 'codex', label: 'Codex', file: '~/.codex/config.toml', error: 'The file could not be read.', servers: [{ name: 'hidden', missing: true }], off: [] },
  ] };
  const f = W.fileFindings(g);
  assert.deepStrictEqual(f.map((x: { key: string }) => x.key), ['list:codex', 'cmd:pw']);
  assert.strictEqual(f[1].where, 'Copilot CLI, Claude Code lists');
  assert.strictEqual(f[1].reason, 'Not installed (command not found)');
  assert.strictEqual(f[0].rkey, 'config');
  assert.ok(!JSON.stringify(f).includes('could not be read.'), 'the list\'s own error text is not shown, only the fixed words');
  for (const bad of [null, {}, { ok: false, apps: [] }, { ok: true, apps: 'x' }, { ok: true, apps: [null, 3] }]) assert.deepStrictEqual(W.fileFindings(bad), []);
}
// FR-199 part 2 (T169): chat findings: failed / needs-sign-in with FR-090's reason, the policy word, nothing for a running server; no error text
{
  const chat = { id: 'a1', name: 'Ada', app: 'Claude Code' };
  const t = W.chatFinding({ name: 'linear', status: 'needs-auth', error: 'token ghp_secret expired' }, chat);
  assert.strictEqual(t.rkey, 'auth');
  assert.strictEqual(t.where, 'Ada (Claude Code)');
  assert.ok(!JSON.stringify(t).includes('ghp_'), 'never the error text');
  assert.strictEqual(W.chatFinding({ name: 'b', status: 'failed', errorClass: 'not-found' }, chat).rkey, 'not-found');
  assert.strictEqual(W.chatFinding({ name: 'b', status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:3000' }, chat).rkey, 'refused');
  assert.strictEqual(W.chatFinding({ name: 'b', status: 'connected' }, chat), null);
  assert.strictEqual(W.chatFinding({ name: 'b' }, chat, true).rkey, 'policy');
  assert.strictEqual(W.chatFinding({ name: '', status: 'failed' }, chat), null);
  assert.strictEqual(W.chatFinding({ name: 'b', status: 'failed' }, null), null);
}
// review on #1073 item 7: the 10-minute window, monotonic clock injected
{
  assert.strictEqual(W.LAUNCH_MS, 600000);
  assert.strictEqual(W.launchYoung(1000, 1000), true);
  assert.strictEqual(W.launchYoung(1000, 1000 + 600000), true, 'the edge is inside');
  assert.strictEqual(W.launchYoung(1000, 1001 + 600000), false, 'past 10 minutes');
  assert.strictEqual(W.launchYoung(1000, 999), false, 'a clock that went back adds nothing');
  for (const [a, b] of [[NaN, 1], [1, Infinity], ['1', 2], [undefined, 2]]) assert.strictEqual(W.launchYoung(a, b), false, String([a, b]));
}
// review on #1073 item 8: status and policy findings have their own keys; reports never touch a policy finding; a successful call drops it
{
  const chat = { id: 'B', name: 'Bo', app: 'Claude Code' };
  const m = new Map<string, Finding>();
  const pol = { type: 'toolCall', phase: 'failed', mcpCall: 'policy', mcpServer: 'teams' };
  assert.strictEqual(W.launchUpdate(m, pol, chat, true), true);
  const pk = 'policy:' + JSON.stringify(['B', 'teams']);
  assert.ok(m.has(pk), 'the policy finding');
  for (const st of ['pending', 'starting', 'disabled', 'connected']) {
    W.launchUpdate(m, { type: 'mcp', servers: [{ name: 'teams', status: st }] }, chat, true);
    assert.ok(m.has(pk), 'a ' + st + ' report keeps the policy finding');
  }
  W.launchUpdate(m, { type: 'mcp', servers: [{ name: 'teams', status: 'failed', errorClass: 'timeout' }] }, chat, true);
  assert.strictEqual(m.get(pk)!.rkey, 'policy', 'a failed report does not overwrite it');
  const sk = 'chat:' + JSON.stringify(['B', 'teams']);
  assert.strictEqual(m.get(sk)!.rkey, 'timeout', 'the failed report is its own finding');
  W.launchUpdate(m, { type: 'mcp', servers: [{ name: 'teams', status: 'connected' }] }, chat, true);
  assert.ok(!m.has(sk) && m.has(pk), 'running again drops the status finding only');
  assert.strictEqual(W.launchUpdate(m, { type: 'toolCall', phase: 'complete', mcpServer: 'other' }, chat, true), false, 'another server\'s call changes nothing');
  assert.strictEqual(W.launchUpdate(m, { type: 'toolCall', phase: 'complete', mcpServer: 'teams' }, chat, true), true);
  assert.ok(!m.has(pk), 'a successful call of that server drops the policy finding');
  // outside the window: nothing new, but a fixed server still leaves
  const old = new Map<string, Finding>();
  assert.strictEqual(W.launchUpdate(old, { type: 'mcp', servers: [{ name: 'x', status: 'failed' }] }, chat, false), false, 'nothing new after 10 minutes');
  W.launchUpdate(old, { type: 'mcp', servers: [{ name: 'x', status: 'failed' }] }, chat, true);
  assert.strictEqual(W.launchUpdate(old, { type: 'mcp', servers: [{ name: 'x', status: 'connected' }] }, chat, false), true, 'a fixed server leaves after 10 minutes too');
  assert.strictEqual(W.launchUpdate(null, pol, chat, true), false);
}
// review on #1073 item 10: Restart where it failed leaves out sign-in failures and apps without a per-server restart
{
  const row = (id: string, entry: Record<string, unknown>) => ({ id, entry });
  const r = W.restartTargets([
    row('a', { status: 'failed', errorClass: 'not-found', canRestart: true }),
    row('b', { status: 'failed', error: 'ECONNREFUSED', canRestart: true }),
    row('c', { status: 'failed', errorClass: 'not-found' }),
    row('d', { status: 'failed', errorClass: 'auth', canRestart: true }),
    row('e', { status: 'failed', error: 'SSE stream terminated: 401', canRestart: true }),
    row('f', { status: 'connected', canRestart: true }),
    row('g', { status: 'needs-auth', canRestart: true }),
  ]);
  assert.deepStrictEqual(r.targets.map((c) => c.id), ['a', 'b']);
  assert.strictEqual(r.failed.length, 5, 'every failed row is counted');
  assert.deepStrictEqual(r.skipped.map((k) => k.chat.id + ':' + k.why), ['c:session', 'd:auth', 'e:auth']);
  assert.deepStrictEqual(W.restartTargets([row('a', { status: 'failed', canRestart: true })], () => false).targets, [], 'a chat the window cannot reach');
  assert.deepStrictEqual(W.restartTargets(null).targets, []);
}
console.log('[058] mcpwords: PASS');
