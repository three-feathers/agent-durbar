/** All-time tool usage document (spec 020 FR-004..FR-006): `npm run test:toolusage`. */
import * as assert from 'assert';
import * as path from 'path';
import { MAX_AGENTS, MAX_TOOLS, agentLabel, emptyDoc, recordEvent, sanitizeDoc, toolKey } from '../src/shared/toolusage';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'toolstats.js')) as { toolKey: (e: unknown) => unknown };

const start = (tool: string, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', phase: 'start', tool, callId: 'c1', sessionId: 's1', ...extra });
const mcp = (server: string, t: string, ph = 'start') => ({ type: 'toolCall', phase: ph, tool: `${server}-${t}`, mcpServer: server, mcpTool: t });

// the key rule matches the renderer's per-session module
for (const e of [start('bash'), mcp('github', 'search_issues'), { tool: undefined }, { tool: 'x', mcpServer: 'srv' }]) assert.deepStrictEqual(toolKey(e as never), S.toolKey(e));

const d = emptyDoc(new Date('2026-10-16T10:00:00Z'));
assert.strictEqual(d.since, '2026-10-16T10:00:00.000Z');
assert.ok(recordEvent(d, 'Ada · app', start('bash')));
assert.ok(recordEvent(d, 'Ada · app', start('bash')));
assert.ok(recordEvent(d, 'Mira · app', start('bash')));
assert.ok(recordEvent(d, 'Mira · app', mcp('github', 'search_issues')));
assert.ok(recordEvent(d, 'Mira · app', mcp('github', 'search_issues', 'failed')));
assert.ok(!recordEvent(d, 'Ada · app', { type: 'toolCall', phase: 'complete', tool: 'bash' }), 'complete is not counted');
assert.ok(!recordEvent(d, 'Ada · app', { type: 'toolCall', phase: 'update', tool: 'bash' }));
assert.ok(!recordEvent(d, 'Ada · app', { type: 'status' }));
assert.ok(!recordEvent(d, 'Ada · app', null));
assert.ok(!recordEvent(d, '__proto__', start('bash')), 'forbidden agent label');
assert.deepStrictEqual(d.tools['builtin:bash'], { source: 'builtin', server: '', name: 'bash', calls: 3, failed: 0 });
assert.deepStrictEqual(d.tools['mcp:github/search_issues'], { source: 'mcp', server: 'github', name: 'search_issues', calls: 1, failed: 1 });
assert.deepStrictEqual(d.servers, { github: { calls: 1, failed: 1 } });
assert.strictEqual(d.agents['Ada · app'].calls, 2);
assert.strictEqual(d.agents['Mira · app'].tools['builtin:bash'].calls, 1);
assert.strictEqual(d.agents['Mira · app'].failed, 1);

// privacy: arguments, output, call/session ids and secrets never reach the document
const p = emptyDoc();
recordEvent(p, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'bash', callId: 'SECRET-CALL', sessionId: 'SECRET-SESSION', args: { command: 'curl -H "Authorization: Bearer ghp_SECRET" https://x' }, output: 'TOKEN=abc' });
const text = JSON.stringify(p);
for (const bad of ['SECRET', 'ghp_', 'TOKEN', 'curl', 'Authorization', 'abc']) assert.ok(!text.includes(bad), `document must not contain ${bad}`);
assert.deepStrictEqual(Object.keys(p).sort(), ['agents', 'servers', 'since', 'tools', 'version']);

// sanitising: wrong shapes, bad counts, prototype keys, orphans, duplicates, huge numbers
assert.deepStrictEqual(Object.keys(sanitizeDoc(null).tools), []);
assert.deepStrictEqual(Object.keys(sanitizeDoc('x').agents), []);
const s = sanitizeDoc(JSON.parse(`{"version":9,"since":"nope","tools":{"builtin:bash":{"source":"builtin","name":"bash","calls":5,"failed":"x"},"__proto__":{"name":"p","calls":1},
  "mcp:a/b":{"source":"mcp","server":"a","name":"b","calls":2.9,"failed":-3},"mcp:x/y":{"source":"mcp","name":"y","calls":4},"z":{"name":"","calls":1},"e":{"name":"e","calls":0}},
  "servers":{"a":{"calls":2},"__proto__":{"calls":9},"b":{"calls":0}},
  "agents":{"Ada · app":{"calls":5,"tools":{"builtin:bash":{"calls":5},"mcp:ghost/t":{"calls":1}}},"constructor":{"calls":1},"empty":{}}}`), new Date('2026-01-01T00:00:00Z'));
assert.strictEqual(s.since, '2026-01-01T00:00:00.000Z', 'bad since -> now');
assert.deepStrictEqual(Object.keys(s.tools).sort(), ['builtin:bash', 'mcp:a/b']);
assert.strictEqual(s.tools['builtin:bash'].failed, 0);
assert.strictEqual(s.tools['mcp:a/b'].calls, 2);
assert.deepStrictEqual(Object.keys(s.servers), ['a']);
assert.deepStrictEqual(Object.keys(s.agents), ['Ada · app']);
assert.deepStrictEqual(Object.keys(s.agents['Ada · app'].tools), ['builtin:bash'], 'a per-agent tool without a total is dropped');
assert.strictEqual(sanitizeDoc({ tools: { 'builtin:x': { name: 'x', calls: 1e30 } } }).tools['builtin:x'].calls, 1e12, 'counts are clamped');
assert.deepStrictEqual(sanitizeDoc(JSON.parse(JSON.stringify(d))), d, 'a saved document loads back identical');

// caps
const big = emptyDoc();
for (let i = 0; i < MAX_TOOLS + 50; i++) recordEvent(big, `a${i % 10}`, start(`tool${i}`));
assert.strictEqual(Object.keys(big.tools).length, MAX_TOOLS);
assert.ok(!recordEvent(big, 'a1', start('one-more')), 'no new tool past the cap');
assert.ok(recordEvent(big, 'a0', start('tool0')), 'existing tools still count at the cap');
const one = emptyDoc();
for (let i = 0; i < 450; i++) recordEvent(one, 'solo', start(`t${i}`));
assert.strictEqual(Object.keys(one.agents.solo.tools).length, 400, 'per-agent tool cap');
assert.strictEqual(Object.keys(one.tools).length, 400, 'a tool refused for an agent is not half counted');
const many = emptyDoc();
for (let i = 0; i < MAX_AGENTS + 20; i++) recordEvent(many, `agent${i}`, start('bash'));
assert.strictEqual(Object.keys(many.agents).length, MAX_AGENTS);
assert.strictEqual(many.tools['builtin:bash'].calls, MAX_AGENTS, 'a refused agent is not half counted');

// labels
assert.strictEqual(agentLabel('Ada', '/home/v/work/command-center'), 'Ada · command-center');
assert.strictEqual(agentLabel('Ada', 'C:\\Users\\v\\proj\\'), 'Ada · proj');
assert.strictEqual(agentLabel('Ada', ''), 'Ada');
assert.ok(!agentLabel('Ada', '/home/v/secret-dir/app').includes('secret-dir'), 'no path, only the base name');

console.log('toolusage: all checks passed');
