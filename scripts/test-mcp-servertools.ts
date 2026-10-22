/**
 * Spec 069 part 3 (FR-031..FR-033): a server's tools. The normalizer, `agents:mcpTools` in main (limits, first line, masking, timeout,
 * not running), the Copilot adapter on the fake SDK, the Codex adapter on the fake app-server, `agentMcpReply`'s per-app lists and
 * sources. Claude Code's `mcp_status` tools are in `test-claude-adapter`. `npm run test:mcpservertools`. No account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import { MAX_MCP_TOOLS, normMcpTools } from '../src/adapters/mcptools';
import type { AgentAdapter } from '../src/adapters/types';
import type { AgentInfo } from '../src/shared/api';
import { MCP_TOOL_DESC_MAX, MCP_TOOL_NAME_MAX, mcpToolsOp } from '../src/main/mcptoolsop';
import { agentMcpReply } from '../src/main/mcpsession';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';

const info = (id: string): AgentInfo => ({ id, name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' }) as AgentInfo;
const routerOf = (ad: AgentAdapter | undefined) => ({ forAgent: () => ad });
let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) {
    console.error('[069] mcp server tools: FAIL (exited before the last check)');
    process.exitCode = 1;
  }
});

async function main(): Promise<void> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-069-tools-'));
  // ---- normMcpTools: array, map by name, title fallback, junk, cap ----
  assert.deepStrictEqual(normMcpTools([{ name: 'a', description: 'A' }, { name: 'b', title: 'Bee' }, { name: '' }, 7, null, { description: 'no name' }]), [{ name: 'a', description: 'A' }, { name: 'b', description: 'Bee' }]);
  assert.deepStrictEqual(normMcpTools({ x: { name: 'x', description: 'X', inputSchema: {} }, y: {} }), [{ name: 'x', description: 'X' }, { name: 'y' }]);
  assert.deepStrictEqual(normMcpTools(undefined), []);
  assert.strictEqual(normMcpTools(Array.from({ length: 900 }, (_x, i) => ({ name: 't' + i }))).length, MAX_MCP_TOOLS);

  // ---- mcpToolsOp (FR-032) ----
  {
    const ad = new FakeAdapter();
    const sid = await ad.start({ workspace: ws, quiet: true });
    const agents = new Map([[sid, info(sid)]]);
    const SECRET = 'planted-session-secret-0123';
    const deps = { agents, router: routerOf(ad), secrets: () => [SECRET] };
    ad.toolsByServer = {
      notes: [
        { name: 'search', description: '\n  Search notes. Uses ' + SECRET + ' and ghp_' + 'A'.repeat(36) + '\nSecond line never shown' },
        { name: 'x'.repeat(300), description: 'd'.repeat(500) },
        { name: 'bare' },
      ],
      empty: [],
    };
    const r = await mcpToolsOp(deps, sid, 'notes');
    assert.ok(r.ok && r.tools, JSON.stringify(r));
    assert.strictEqual(r.total, 3);
    assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('ghp_AAAA'), 'masked: ' + JSON.stringify(r.tools?.[0]));
    assert.ok(r.tools?.[0].description?.startsWith('Search notes.') && !r.tools?.[0].description?.includes('Second line'), 'first non-empty line only');
    assert.ok((r.tools?.[1].name.length ?? 0) <= MCP_TOOL_NAME_MAX && (r.tools?.[1].description?.length ?? 0) <= MCP_TOOL_DESC_MAX, 'cut');
    assert.deepStrictEqual(r.tools?.[2], { name: 'bare' });
    assert.deepStrictEqual(await mcpToolsOp(deps, sid, 'empty'), { ok: true, tools: [], total: 0 });
    const missing = await mcpToolsOp(deps, sid, 'nope');
    assert.ok(!missing.ok && /not running in this session/.test(missing.error ?? ''));
    ad.failTools = 'failed with ' + SECRET;
    const failed = await mcpToolsOp(deps, sid, 'notes');
    assert.ok(!failed.ok && !(failed.error ?? '').includes(SECRET), 'errors masked');
    ad.failTools = undefined;
    for (const [id, name] of [[42, 'notes'], ['nope', 'notes'], [sid, ''], [sid, 'n'.repeat(65)], [sid, 7]] as const)
      assert.deepStrictEqual(await mcpToolsOp(deps, id, name), { ok: false, error: 'Unknown agent or server.' });
    const slow = new FakeAdapter();
    const s2 = await slow.start({ workspace: ws, quiet: true });
    slow.listMcpTools = () => new Promise(() => undefined);
    const t = await mcpToolsOp({ agents: new Map([[s2, info(s2)]]), router: routerOf(slow), secrets: () => [], timeoutMs: 50 }, s2, 'notes');
    assert.ok(!t.ok && /in time/.test(t.error ?? ''), 'timeout');
    const none = new FakeAdapter({ omit: ['listMcpTools'] });
    const s3 = await none.start({ workspace: ws, quiet: true });
    assert.ok(/cannot list/.test((await mcpToolsOp({ agents: new Map([[s3, info(s3)]]), router: routerOf(none), secrets: () => [] }, s3, 'notes')).error ?? ''));
    await ad.stop(sid);
    const off = await mcpToolsOp(deps, sid, 'notes');
    assert.deepStrictEqual(off, { ok: false, notRunning: true, error: 'Start the session to see its tools.' }, 'nothing is asked when the session is not running');
  }

  // ---- agentMcpReply: canListTools, per-app lists and sources (FR-009, FR-011) ----
  {
    const ad = new FakeAdapter();
    const sid = await ad.start({ workspace: ws, quiet: true });
    const base = { a: info(sid), ad, live: [], off: new Set<string>(), secrets: [], cli: [{ name: 'gh', enabled: true }, { name: 'github-mcp-server', enabled: true }], extras: [{ name: 'ext', enabled: true, trusted: true }], ambientDisabled: new Set<string>(), global: { copilot: ['gh'], claude: ['gh', 'cl'], codex: [] }, builtin: new Set(['github-mcp-server']) };
    const cop = agentMcpReply({ ...base, app: 'copilot' });
    assert.strictEqual(cop.canListTools, true);
    assert.deepStrictEqual(cop.servers.map((x) => [x.name, (x.sources ?? []).join('+')]), [['gh', 'copilot+claude'], ['github-mcp-server', 'builtin'], ['ext', 'folder']]);
    const cla = agentMcpReply({ ...base, app: 'claude', claudeList: [{ name: 'gh', enabled: true }, { name: 'cl', enabled: false }] });
    assert.deepStrictEqual(cla.servers.map((x) => [x.name, x.defaultOn]), [['gh', true], ['cl', false], ['ext', true]], 'a Claude agent lists Claude Code\'s list, not the Copilot CLI list');
    const cod = agentMcpReply({ ...base, app: 'codex' });
    assert.deepStrictEqual(cod.servers.map((x) => x.name), ['ext'], 'Codex reports its own list as runtime rows');
    const noTools = agentMcpReply({ ...base, ad: new FakeAdapter({ omit: ['listMcpTools'] }) });
    assert.strictEqual(noTools.canListTools, undefined);
  }

  // ---- Copilot adapter on the fake SDK (FR-031) ----
  {
    const client = new FakeClient();
    const ad = new FakeCopilot(client);
    assert.strictEqual(ad.capabilities.mcpTools, true);
    const sid = await ad.start({ workspace: ws, quiet: true });
    const s = client.last;
    assert.deepStrictEqual(await ad.listMcpTools(sid, 'notes'), [{ name: 'search', description: 'Search the notes' }, { name: 'read' }]);
    assert.deepStrictEqual(s.calls.filter((c) => c.name === 'mcp.listTools').map((c) => c.args[0]), [{ serverName: 'notes' }], 'one live tools/list for that server');
    s.toolsFail = 'MCP server notes is not connected';
    await assert.rejects(ad.listMcpTools(sid, 'notes'), /not connected/);
    await assert.rejects(ad.listMcpTools('nope', 'notes'), /not running/);
    delete (s.rpc.mcp as Record<string, unknown>).listTools;
    await assert.rejects(ad.listMcpTools(sid, 'notes'), /cannot list/, 'an older SDK without the method');
    await ad.stop(sid);
  }

  done = true;
  console.log('[069] mcp server tools: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
