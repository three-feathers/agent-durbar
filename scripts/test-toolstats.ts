/** Tool usage counts, models and context window helpers (spec 019): `npm run test:toolstats`. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'toolstats.js')) as {
  createStats: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  toolKey: (e: unknown) => { key: string; source: string; server: string; name: string };
  ctxLevel: (u?: number, l?: number) => { pct: number | null; level: string };
  fmtTokens: (n?: number) => string;
  docView: (doc: unknown, scope: string | null) => { rows: any[]; groups: any[]; totals: { total: number; failed: number; mcp: number; agents: number } }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const start = (tool: string, extra: Record<string, unknown> = {}) => ({ type: 'toolCall', phase: 'start', tool, callId: 'c', ...extra });
const mcp = (server: string, t: string) => start(`${server}-${t}`, { mcpServer: server, mcpTool: t });

// keys: built-in vs MCP by server
assert.deepStrictEqual(S.toolKey(start('bash')), { key: 'builtin:bash', source: 'builtin', server: '', name: 'bash' });
assert.deepStrictEqual(S.toolKey(mcp('echo', 'echo')), { key: 'mcp:echo/echo', source: 'mcp', server: 'echo', name: 'echo' });

const s = S.createStats();
for (let i = 0; i < 3; i++) s.recordTool('a1', start('bash'));
s.recordTool('a1', start('view'));
s.recordTool('a1', mcp('github', 'search_issues'));
s.recordTool('a2', start('bash'));
s.recordTool('a2', mcp('github', 'search_issues'));
s.recordTool('a2', mcp('github', 'search_issues'));
s.recordTool('a2', mcp('echo', 'echo'));
s.recordTool('a2', { type: 'toolCall', phase: 'failed', tool: 'x-y', mcpServer: 'echo', mcpTool: 'echo' });
s.recordTool('a2', { type: 'toolCall', phase: 'complete', tool: 'bash' }); // complete/update are not counted
s.recordTool('a2', { type: 'toolCall', phase: 'update', tool: 'bash' });
s.recordTool('a2', { type: 'status' }); // not a tool event

// global rows sorted by calls, agents sorted by their share
const rows = s.rows(null);
assert.deepStrictEqual(rows.map((r: { key: string; count: number }) => [r.key, r.count]), [['builtin:bash', 4], ['mcp:github/search_issues', 3], ['mcp:echo/echo', 1], ['builtin:view', 1]]);
assert.deepStrictEqual(rows[1].agents, [{ id: 'a2', count: 2 }, { id: 'a1', count: 1 }]);
assert.strictEqual(rows.find((r: { key: string }) => r.key === 'mcp:echo/echo').failed, 1);
// per agent scope
assert.deepStrictEqual(s.rows('a1').map((r: { key: string; count: number }) => [r.key, r.count]), [['builtin:bash', 3], ['mcp:github/search_issues', 1], ['builtin:view', 1]]);
assert.deepStrictEqual(s.rows('nobody'), []);
// groups: built-in first, MCP servers by total
const g = s.groups(null);
assert.deepStrictEqual(g.map((x: { title: string; total: number }) => [x.title, x.total]), [['Built-in', 5], ['MCP: github', 3], ['MCP: echo', 1]]);
assert.deepStrictEqual(s.totals(null), { total: 9, failed: 1, mcp: 4 });
assert.deepStrictEqual(s.totals('a1'), { total: 5, failed: 0, mcp: 1 });
assert.strictEqual(s.agent('a2').total, 4);
assert.deepStrictEqual(s.agent('ghost'), { total: 0, failed: 0, models: [], ctx: null });

// models and context
s.recordModel('a1', 'gpt-6-luna');
s.recordModel('a1', 'gpt-6-luna');
s.recordModel('a1', 'other');
s.recordModel('a1', undefined);
assert.deepStrictEqual(s.agent('a1').models, [{ name: 'gpt-6-luna', calls: 2 }, { name: 'other', calls: 1 }]);
s.setContext('a1', { tokens: 13602, limit: 272000, system: 5840 });
assert.strictEqual(s.agent('a1').ctx.tokens, 13602);
s.setContext('a1', { tokens: -1 });
assert.strictEqual(s.agent('a1').ctx.tokens, 13602, 'garbage is ignored');
s.setContext('a2', { tokens: 100, limit: 0 });
assert.strictEqual(s.agent('a2').ctx.limit, 0, 'unknown limit stays 0');

// forget
s.forget('a1');
assert.strictEqual(s.totals(null).total, 4);

// bounded
const big = S.createStats();
for (let i = 0; i < 1000; i++) big.recordTool('z', start('t' + i));
assert.ok(big.rows('z').length <= 400);

// context levels and formatting
assert.deepStrictEqual(S.ctxLevel(13602, 272000), { pct: 5, level: 'ok' });
assert.deepStrictEqual(S.ctxLevel(70, 100), { pct: 70, level: 'warn' });
assert.deepStrictEqual(S.ctxLevel(90, 100), { pct: 90, level: 'warn' });
assert.deepStrictEqual(S.ctxLevel(91, 100), { pct: 91, level: 'high' });
assert.deepStrictEqual(S.ctxLevel(500, 100), { pct: 100, level: 'high' });
assert.deepStrictEqual(S.ctxLevel(50, 0), { pct: null, level: 'unknown' });
assert.deepStrictEqual(S.ctxLevel(undefined, 100), { pct: null, level: 'unknown' });
assert.strictEqual(S.fmtTokens(272000), '272k');
assert.strictEqual(S.fmtTokens(13602), '13.6k');
assert.strictEqual(S.fmtTokens(950), '950');
assert.strictEqual(S.fmtTokens(1_000_000), '1M');
assert.strictEqual(S.fmtTokens(undefined), '?');

console.log('toolstats tests passed');

// All-time document view (spec 020): same shape as the per-run rows
{
  const doc = {
    version: 1, since: '2026-10-01T00:00:00.000Z',
    tools: { 'builtin:bash': { source: 'builtin', server: '', name: 'bash', calls: 7, failed: 1 }, 'mcp:github/search': { source: 'mcp', server: 'github', name: 'search', calls: 3, failed: 0 }, 'builtin:view': { source: 'builtin', server: '', name: 'view', calls: 0, failed: 0 } },
    servers: { github: { calls: 3, failed: 0 } },
    agents: {
      'Ada · app': { calls: 6, failed: 1, tools: { 'builtin:bash': { calls: 5, failed: 1 }, 'mcp:github/search': { calls: 1, failed: 0 } } },
      'Mira · app': { calls: 4, failed: 0, tools: { 'builtin:bash': { calls: 2, failed: 0 }, 'mcp:github/search': { calls: 2, failed: 0 } } },
      'Idle · app': { calls: 0, failed: 0, tools: {} },
    },
  };
  const all = S.docView(doc, null);
  assert.deepStrictEqual(all.rows.map((r: { name: string }) => r.name), ['bash', 'search'], 'zero rows are dropped, sorted by calls');
  assert.deepStrictEqual(all.totals, { total: 10, failed: 1, mcp: 3, agents: 2 });
  assert.deepStrictEqual(all.rows[0].agents, [{ label: 'Ada · app', count: 5 }, { label: 'Mira · app', count: 2 }]);
  assert.deepStrictEqual(all.groups.map((g: { title: string }) => g.title), ['Built-in', 'MCP: github']);
  const ada = S.docView(doc, 'Ada · app');
  assert.deepStrictEqual(ada.totals, { total: 6, failed: 1, mcp: 1, agents: 1 });
  assert.strictEqual(S.docView(doc, 'Nobody').rows.length, 0);
  assert.strictEqual(S.docView(null, null).rows.length, 0);
}
