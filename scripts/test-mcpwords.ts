/** Spec 058 FR-001 / FR-006 (T113): the word, icon and hint of an MCP server's state. `npm run test:mcpwords`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';

interface Words {
  stateOf: (s: unknown) => { word: string; icon: string; cls: string };
  iconSvg: (n: string) => string;
  hintFor: (o: { status?: string; errorClass?: string; error?: string; app?: string }) => string;
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

// FR-006 / FR-069: the hints
const h = W.hintFor;
assert.strictEqual(h({ status: 'needs-auth', app: 'Copilot' }), 'This server needs you to sign in. Copilot keeps the sign-in; Agent Durbar never sees it.');
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
