/** All-time tool usage document (spec 020 FR-004..FR-006): `npm run test:toolusage`. */
import * as assert from 'assert';
import * as path from 'path';
import { HIDDEN_SERVER, HIDDEN_TOOL, MAX_AGENTS, MAX_TOOLS, agentLabel, emptyDoc, nameCacheStats, recordEvent, sanitizeDoc, toolKey } from '../src/shared/toolusage';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'toolstats.js')) as { toolKey: (e: unknown) => unknown };

const start = (tool: string, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', phase: 'start', tool, callId: 'c1', sessionId: 's1', ...extra });
const mcp = (server: string, t: string, ph = 'start') => ({ type: 'toolCall', phase: ph, tool: `${server}-${t}`, mcpServer: server, mcpTool: t });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const REDACT = require(path.join(__dirname, '..', 'src', 'shared', 'redact')) as { maskNoteText: (t: string) => { changed: boolean } };

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
assert.deepStrictEqual({ ...d.servers }, { github: { calls: 1, failed: 1 } });
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
assert.deepStrictEqual(Object.keys(s.tools).sort(), ['builtin:bash', 'mcp:a/b'], 'M12: a stored tool under a prototype key is dropped on load');
assert.strictEqual(s.tools['builtin:bash'].failed, 0);
assert.strictEqual(s.tools['mcp:a/b'].calls, 2);
assert.deepStrictEqual(Object.keys(s.servers), ['a'], 'M12: a stored server under a prototype key is dropped on load');
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

// spec 020 FR-033 (issue #1291): a name that looks like a secret is never stored; it is counted under one fixed placeholder
{
  const TK = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4', AW = 'AKIA' + 'Z7Q2W9X4C6V8B1N3', SK = 'sk-' + 'proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const split = (t: string, mid: string) => t.slice(0, 12) + mid + t.slice(12);
  const PARTS = /ghp_|A1b2C3d4|E5f6G7h8|f6G7h8|K1l2M3n4|sk-proj|AKIAZ7|Z7Q2W9|X4C6V8|[\u0000-\u001f‪-‮]/;
  const shapes: Record<string, string> = {
    plain: TK, aws: AW, sk: SK, ansi: split(TK, '\u001b[0m'), osc: split(TK, '\u001b]0;t\u0007'), bidi: split(TK, '‮'), zwsp: split(TK, '​'),
    md: split(TK, '`'), intro: 'gh' + '\u001b[' + TK.slice(2), awsAnsi: split(AW, '\u001b[31m'), skBidi: split(SK, '‮'), padded: 'x'.repeat(130) + ' ' + TK,
  };
  const doc = emptyDoc();
  for (const [what, tok] of Object.entries(shapes)) {
    assert.ok(recordEvent(doc, 'Ada · app', start(tok)), what + ': counted');
    assert.ok(recordEvent(doc, 'Ada · app', start(tok, { phase: 'failed' })), what + ': failed counted');
    assert.ok(recordEvent(doc, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'x', mcpServer: 'srv', mcpTool: tok }), what + ': MCP counted');
    assert.ok(recordEvent(doc, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'x', mcpServer: tok, mcpTool: 'list' }), what + ': a secret-shaped server name');
    assert.strictEqual(toolKey(start(tok)).key, 'builtin:' + HIDDEN_TOOL, what + ': one stable key');
    assert.strictEqual(toolKey({ tool: 'x', mcpServer: 'srv', mcpTool: tok }).key, 'mcp:srv/' + HIDDEN_TOOL, what + ': one stable MCP key');
  }
  const text = JSON.stringify(doc);
  assert.ok(!PARTS.test(text), 'the document holds no part of any name: ' + (text.match(PARTS) || [''])[0]);
  const n = Object.keys(shapes).length;
  assert.deepStrictEqual(doc.tools['builtin:' + HIDDEN_TOOL], { source: 'builtin', server: '', name: HIDDEN_TOOL, calls: n, failed: n }, 'counts add up under the placeholder');
  assert.strictEqual(doc.tools['mcp:srv/' + HIDDEN_TOOL].calls, n, 'MCP counts add up');
  assert.strictEqual(doc.servers[HIDDEN_SERVER].calls, n, 'server counts add up under the placeholder');
  assert.strictEqual(doc.agents['Ada · app'].tools['builtin:' + HIDDEN_TOOL].calls, n, 'the agent counts too');
  assert.deepStrictEqual(Object.keys(doc.tools).sort(), ['builtin:' + HIDDEN_TOOL, 'mcp:' + HIDDEN_SERVER + '/list', 'mcp:srv/' + HIDDEN_TOOL].sort(), 'a bounded set of keys, however many secret-shaped names');
  // clean names are kept as before
  for (const ok of ['bash', 'read_file', 'mcp__github__create_issue', 'search-issues', 'Ünïcode tool', 'git commit']) assert.strictEqual(toolKey(start(ok)).name, ok, 'a clean name stays: ' + ok);
  assert.strictEqual(toolKey(start('bash\u001b[0m')).name, 'bash [0m', 'control codes are still spaces (as before)');
  assert.strictEqual(toolKey(start(HIDDEN_TOOL)).name, HIDDEN_TOOL, 'the placeholder is itself clean: stored once, not changed again');

  // an existing file: stored names that look like secrets are replaced on load; counts and the agents' counts move to the placeholder, none is lost
  const old = {
    version: 1, since: '2026-10-01T00:00:00.000Z',
    tools: {
      ['builtin:' + TK]: { source: 'builtin', server: '', name: TK, calls: 3, failed: 1 },
      ['builtin:' + split(TK, '‮')]: { source: 'builtin', server: '', name: split(TK, '‮'), calls: 2, failed: 0 },
      'builtin:bash': { source: 'builtin', server: '', name: 'bash', calls: 5, failed: 0 },
      ['mcp:srv/' + AW]: { source: 'mcp', server: 'srv', name: AW, calls: 4, failed: 2 },
      ['mcp:' + SK + '/t']: { source: 'mcp', server: SK, name: 't', calls: 1, failed: 0 },
    },
    servers: { srv: { calls: 4, failed: 2 }, [SK]: { calls: 1, failed: 0 } },
    agents: { 'Ada · app': { calls: 15, failed: 3, tools: { ['builtin:' + TK]: { calls: 3, failed: 1 }, ['builtin:' + split(TK, '‮')]: { calls: 2, failed: 0 }, 'builtin:bash': { calls: 5, failed: 0 }, ['mcp:srv/' + AW]: { calls: 4, failed: 2 } } } },
  };
  const rep = { masked: 0 };
  const m = sanitizeDoc(JSON.parse(JSON.stringify(old)), new Date(), rep);
  assert.ok(!PARTS.test(JSON.stringify(m)), 'a migrated document holds no part of a name: ' + (JSON.stringify(m).match(PARTS) || [''])[0]);
  assert.ok(rep.masked >= 5, 'the report counts what was replaced: ' + rep.masked);
  assert.deepStrictEqual(m.tools['builtin:' + HIDDEN_TOOL], { source: 'builtin', server: '', name: HIDDEN_TOOL, calls: 5, failed: 1 }, 'two stored names merge, counts added');
  assert.strictEqual(m.tools['builtin:bash'].calls, 5, 'a clean name is untouched');
  assert.strictEqual(m.tools['mcp:srv/' + HIDDEN_TOOL].calls, 4);
  assert.strictEqual(m.tools['mcp:' + HIDDEN_SERVER + '/t'].calls, 1);
  assert.strictEqual(m.servers[HIDDEN_SERVER].calls, 1);
  assert.deepStrictEqual(m.agents['Ada · app'].tools['builtin:' + HIDDEN_TOOL], { calls: 5, failed: 1 }, 'the agent counts follow their tool');
  assert.strictEqual(m.agents['Ada · app'].tools['mcp:srv/' + HIDDEN_TOOL].calls, 4);
  const again = { masked: 0 };
  assert.deepStrictEqual(sanitizeDoc(JSON.parse(JSON.stringify(m)), new Date(), again).tools, m.tools, 'sanitising twice changes nothing');
  assert.strictEqual(again.masked, 0, 'a clean file is not reported');
  // a clean document: report stays 0
  const clean = { masked: 0 };
  sanitizeDoc(JSON.parse(JSON.stringify(d)), new Date(), clean);
  assert.strictEqual(clean.masked, 0, 'no replacement in a clean file');
}

// review of #1294 (security): cache bound, whitespace splits, prototype keys, merge of servers, the 4096 cap, a throwing mask
{
  const TK = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4', SK = 'sk-' + 'proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4', SK2 = 'sk-' + 'proj-Z9y8X7w6V5u4T3s2R1q0P9o8N7m6';
  const PARTS = /ghp_|A1b2C3d4|E5f6G7h8|K1l2M3n4|Z9y8X7w6|sk-proj/;
  const split = (t: string, mid: string) => t.slice(0, 12) + mid + t.slice(12);

  // 2: a token split by a tab, CR, LF, another control code or a space is a token
  for (const [what, mid] of [['tab', '\t'], ['cr', '\r'], ['lf', '\n'], ['space', ' '], ['mixed', ' \t\r\n '], ['vt', '\u000b']] as const) {
    const dd = emptyDoc();
    assert.ok(recordEvent(dd, 'Ada · app', start(split(TK, mid))), 'whitespace ' + what + ': counted');
    assert.ok(recordEvent(dd, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'x', mcpServer: split(SK, mid), mcpTool: split(TK, mid) }));
    assert.ok(!PARTS.test(JSON.stringify(dd)), 'whitespace ' + what + ': no part of the token is stored');
    assert.strictEqual(toolKey(start(split(TK, mid))).key, 'builtin:' + HIDDEN_TOOL, 'whitespace ' + what + ': hidden');
  }

  // 3: prototype keys do no harm, as a tool or a server, when counting and on load
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    const dd = emptyDoc();
    recordEvent(dd, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'x', mcpServer: bad, mcpTool: 't' });
    recordEvent(dd, 'Ada · app', start(bad));
    recordEvent(dd, bad, start('bash'));
    assert.ok(!Object.prototype.hasOwnProperty.call(Object.prototype, 'calls'), 'proto: Object.prototype has no calls (' + bad + ')');
    assert.strictEqual(({} as Record<string, unknown>).calls, undefined, 'proto: a new object has no calls (' + bad + ')');
    assert.strictEqual(typeof (Object as unknown as Record<string, unknown>).calls, 'undefined', 'proto: Object has no calls (' + bad + ')');
    assert.deepStrictEqual(Object.keys(dd.servers), [], 'proto: a server named ' + bad + ' is not counted');
    assert.ok(!recordEvent(dd, 'Ada · app', { type: 'toolCall', phase: 'start', tool: 'x', mcpServer: bad, mcpTool: 't' }), 'proto: refused as a server (' + bad + ')');
    assert.strictEqual(dd.tools['builtin:' + bad].calls, 1, 'proto: a tool with that name is an ordinary tool');
    const stored = JSON.parse(`{"tools":{"${bad}":{"name":"x","calls":3},"builtin:ok":{"name":"ok","calls":1}},"servers":{"${bad}":{"calls":4}},"agents":{"${bad}":{"calls":1,"tools":{}},"Ada":{"calls":1,"tools":{"${bad}":{"calls":1}}}}}`);
    const m = sanitizeDoc(stored);
    assert.deepStrictEqual(Object.keys(m.servers), [], 'proto load: a stored server ' + bad + ' is dropped');
    assert.deepStrictEqual(Object.keys(m.tools), ['builtin:ok'], 'proto load: a stored tool key ' + bad + ' is dropped');
    assert.deepStrictEqual(Object.keys(m.agents), ['Ada'], 'proto load: an agent named ' + bad + ' is dropped, a per-agent tool key too');
    assert.deepStrictEqual(Object.keys(m.agents.Ada.tools), [], 'proto load: per-agent tool key dropped (' + bad + ')');
    assert.ok(!Object.prototype.hasOwnProperty.call(Object.prototype, 'calls'), 'proto load: no pollution (' + bad + ')');
  }
  assert.strictEqual(Object.getPrototypeOf(emptyDoc().servers), null, 'the maps have no prototype');

  // 4 (M6): two stored secret-shaped servers merge by adding, not by overwriting
  const two = sanitizeDoc({ servers: { [SK]: { calls: 1, failed: 0 }, [SK2]: { calls: 2, failed: 1 }, [split(SK, '\t')]: { calls: 4, failed: 2 }, srv: { calls: 1 } } });
  assert.deepStrictEqual({ ...two.servers[HIDDEN_SERVER] }, { calls: 7, failed: 3 }, 'M6: stored secret-shaped servers are summed on load');
  assert.deepStrictEqual(Object.keys(two.servers).sort(), [HIDDEN_SERVER, 'srv'].sort(), 'M6: and share one key');

  // 4 (M9): only the first 4096 characters are judged; a long name is cheap and a token past the cap is not in the 120 stored
  {
    const long = 'x'.repeat(1_000_000) + ' ' + TK;
    const t0 = Date.now();
    const k = toolKey(start(long));
    assert.ok(Date.now() - t0 < 5000, 'M9: a 1M-character name is judged quickly');
    assert.strictEqual(k.name, 'x'.repeat(120), 'M9: past the 4096 cap nothing is judged, and only 120 x are stored');
    assert.strictEqual(toolKey(start('y'.repeat(4000) + ' ' + TK)).name, HIDDEN_TOOL, 'M9: a token inside the first 4096 characters hides the name');
    assert.strictEqual(toolKey(start('z'.repeat(4096) + ' ' + TK)).name, 'z'.repeat(120), 'M9: the cap is exactly 4096');
  }

  // 1: the verdict cache is keyed by the judged slice, is bounded, and holds no raw name or secret
  {
    const calls = { n: 0 };
    const orig = REDACT.maskNoteText;
    REDACT.maskNoteText = (t: string) => { calls.n++; return orig(t); };
    try {
      const base = 'c'.repeat(4096);
      toolKey(start(base + 'A'));
      const n1 = calls.n;
      assert.ok(n1 > 0, 'cache: the mask ran');
      toolKey(start(base + 'B'.repeat(200000)));
      toolKey(start(base + 'A'));
      assert.strictEqual(calls.n, n1, 'cache: names equal in the judged slice share one verdict (key is the slice)');
      toolKey(start('plain-cache-name-1'));
      const n2 = calls.n;
      toolKey(start('plain-cache-name-1'));
      assert.strictEqual(calls.n, n2, 'cache: a clean verdict is cached');
      toolKey(start(TK + '1'));
      const n3 = calls.n;
      toolKey(start(TK + '1'));
      assert.strictEqual(calls.n, n3, 'cache: a repeated secret-shaped name is judged once');
      const st0 = nameCacheStats();
      assert.ok(st0.maxKeyLength === 64, 'cache: keys are SHA-256 hex, not name text, got length ' + st0.maxKeyLength);
      assert.ok(st0.allHashes, 'cache: no key holds name text (every key is 64 hex characters)');
      assert.strictEqual(toolKey(start(TK + '1')).name, HIDDEN_TOOL, 'cache: the cached secret verdict still hides the name');
      for (let i = 0; i < 700; i++) toolKey(start(`n${i}-` + 'q'.repeat(20000)));
      const st = nameCacheStats();
      assert.ok(st.size <= 500, 'cache: bounded at 500 entries, got ' + st.size);
      assert.ok(st.allHashes && st.maxKeyLength <= 64, 'cache: every key is a 64-character hash, got ' + st.maxKeyLength);
    } finally { REDACT.maskNoteText = orig; }
  }

  // 4 (M14): a mask that throws hides the name, and the verdict is not cached
  {
    const orig = REDACT.maskNoteText;
    REDACT.maskNoteText = () => { throw new Error('boom'); };
    try {
      assert.strictEqual(toolKey(start('throwing-tool-name')).name, HIDDEN_TOOL, 'M14: a throwing mask hides a tool name');
      assert.strictEqual(toolKey({ tool: 'x', mcpServer: 'throwing-server', mcpTool: 't' }).server, HIDDEN_SERVER, 'M14: and a server name');
      assert.strictEqual(sanitizeDoc({ tools: { 'builtin:t': { name: 'throwing-tool-name', calls: 1 } } }).tools['builtin:' + HIDDEN_TOOL].calls, 1, 'M14: and a stored name on load');
    } finally { REDACT.maskNoteText = orig; }
    assert.strictEqual(toolKey(start('throwing-tool-name')).name, 'throwing-tool-name', 'M14: a throw is not cached: the name is clean once the mask works');
  }
}

console.log('toolusage: all checks passed');
