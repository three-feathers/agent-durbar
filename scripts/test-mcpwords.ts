/** Spec 058 FR-001 / FR-006 (T113): the word, icon and hint of an MCP server's state. `npm run test:mcpwords`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';

interface Words {
  stateOf: (s: unknown, ctx?: { off?: boolean; defaultOn?: boolean; origin?: string; app?: string }) => { word: string; icon: string; cls: string };
  offBy: (ctx?: { off?: boolean; defaultOn?: boolean }) => string;
  iconSvg: (n: string) => string;
  hintFor: (o: { by?: string; status?: string; errorClass?: string; error?: string; app?: string }) => string;
  plain: (t: unknown, n: number) => string;
  ICON_NAMES: string[];
}
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
console.log('[058] mcpwords: PASS');
