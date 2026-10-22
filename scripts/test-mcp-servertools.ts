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
import { mcpToolBlockList, PermissionBroker } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';
import { copilotExcludedTools } from '../src/adapters/copilot';
import { claudeArgs, claudeDisallowedMcp } from '../src/adapters/claude';
import { codexMcpConfig } from '../src/adapters/codexMcp';
import { McpStore } from '../src/main/mcpstore';

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

  // ---- part 4: single tools off (FR-060..FR-064) ----
  {
    const off = { 'mail srv': ['send_email'], notes: ['delete_note', 'archive'] };
    // the app filters
    assert.deepStrictEqual(copilotExcludedTools(off), ['mcp:mail srv-send_email', 'mcp:notes-delete_note', 'mcp:notes-archive']);
    assert.deepStrictEqual(claudeDisallowedMcp(off), ['mcp__mail_srv__send_email', 'mcp__notes__delete_note', 'mcp__notes__archive']);
    assert.deepStrictEqual(claudeDisallowedMcp({ s: ['bad,name', 'ok'] }), ['mcp__s__ok'], 'a name that would break the flag list is left to the broker');
    const args = claudeArgs({ mode: 'read-only', sessionId: 'x', resume: false, disallowedMcpTools: ['mcp__notes__archive'] });
    const deny = args[args.indexOf('--disallowedTools') + 1].split(',');
    assert.ok(deny.includes('mcp__notes__archive') && deny.length > 1, 'added to the mode\'s own list: ' + deny.join());
    assert.strictEqual(claudeArgs({ mode: 'allow', sessionId: 'x', resume: false, disallowedMcpTools: ['mcp__a__b'] }).filter((x) => x === '--disallowedTools').length, 1, 'one flag');
    const cfg = codexMcpConfig({ notes: { type: 'stdio', command: 'n' } }, ['gone'], { notes: ['archive'], usersrv: ['send'] });
    assert.deepStrictEqual(cfg?.mcp_servers, { notes: { command: 'n', disabled_tools: ['archive'] }, gone: { enabled: false }, usersrv: { disabled_tools: ['send'] } });
    // the broker refuses a turned-off tool in every mode, and only that one
    for (const mode of ['allow', 'ask', 'read-only'] as const) {
      const ev: BrokerEvent[] = [];
      const b = new PermissionBroker({ mode, emit: (e) => ev.push(e), blockedTools: () => mcpToolBlockList(off) });
      const d = await b.request({ kind: 'mcp', serverName: 'notes', toolName: 'archive', toolCallId: 't1' });
      assert.deepStrictEqual(d, { kind: 'reject', feedback: 'This tool is turned off in Agent Durbar (notes › archive). Do not retry it.' }, mode);
      assert.strictEqual(ev[0]?.type, 'denied-policy', 'a denied card in the chat');
      const c = await b.request({ kind: 'mcp', toolName: 'mcp__mail_srv__send_email', toolCallId: 't2' });
      assert.strictEqual(c.kind, 'reject', 'Claude\'s full tool name');
      if (mode === 'allow') assert.strictEqual((await b.request({ kind: 'mcp', serverName: 'notes', toolName: 'search', toolCallId: 't3' })).kind, 'approve-once', 'another tool still runs');
      if (mode === 'allow') assert.strictEqual((await b.request({ kind: 'shell', fullCommandText: 'archive', toolCallId: 't4' })).kind, 'approve-once', 'not for other kinds');
    }
    // the Copilot session config carries excludedTools on create and resume; its broker refuses
    const client = new FakeClient();
    const ad = new FakeCopilot(client);
    assert.strictEqual(ad.capabilities.mcpToolFilter, true);
    const sid = await ad.start({ workspace: ws, quiet: true, disabledMcpTools: off });
    assert.deepStrictEqual(client.created.pop()?.excludedTools, ['mcp:mail srv-send_email', 'mcp:notes-delete_note', 'mcp:notes-archive']);
    await ad.stop(sid);
    await ad.start({ workspace: ws, quiet: true, resumeSessionId: sid, disabledMcpTools: off });
    assert.deepStrictEqual(client.resumed.pop()?.config.excludedTools, ['mcp:mail srv-send_email', 'mcp:notes-delete_note', 'mcp:notes-archive'], 'and on resume (Restart session)');
    const plain = await ad.start({ workspace: ws, quiet: true });
    assert.ok(!('excludedTools' in (client.created.pop() ?? {})), 'nothing when no tool is off');
    await ad.stop(plain);
    // the fake adapter's broker
    const fa = new FakeAdapter();
    assert.strictEqual(fa.capabilities.mcpToolFilter, true);
    // store: per folder, persisted, names only, limits
    const file = path.join(ws, 'store.json');
    const st = new McpStore(file);
    assert.deepStrictEqual(st.setToolsOff('/f', 'notes', ['archive', 'archive', '', 7, 'x'.repeat(129)]), { ok: true });
    assert.deepStrictEqual(st.toolsOffFor('/f'), { notes: ['archive'] });
    assert.deepStrictEqual(st.toolsOffFor('/other'), {}, 'another folder is not touched');
    assert.ok(!st.setToolsOff('/f', '__proto__', ['a']).ok && !st.setToolsOff('/f', '', ['a']).ok);
    // FR-063 (change 2026-10-22): a name the apps' filters cannot carry is refused (Claude Code in Allow all never asks the broker)
    for (const odd of ['send email', 'a,b', 'list:issues', 'ünï']) {
      const r = st.setToolsOff('/f', 'notes', ['archive', odd]);
      assert.ok(!r.ok && /cannot be turned off/.test(r.error ?? ''), `refused: ${odd}`);
    }
    assert.deepStrictEqual(st.toolsOffFor('/f'), { notes: ['archive'] }, 'a refused change leaves the list as it was');
    assert.deepStrictEqual(claudeDisallowedMcp({ notes: ['archive', 'send email'] }), ['mcp__notes__archive']);
    const again = new McpStore(file);
    again.load();
    assert.deepStrictEqual(again.toolsOffFor('/f'), { notes: ['archive'] }, 'kept across restarts');
    again.setToolsOff('/f', 'notes', []);
    const third = new McpStore(file);
    third.load();
    assert.deepStrictEqual(third.toolsOffFor('/f'), {}, 'all on again removes the entry');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('toolsOff'), 'nothing left in the file');
    // the dialog reply
    const ad2 = new FakeAdapter();
    const s2 = await ad2.start({ workspace: ws, quiet: true });
    const rep = agentMcpReply({ a: info(s2), ad: ad2, live: [], off: new Set(), secrets: [], cli: [{ name: 'notes', enabled: true }], extras: [], ambientDisabled: new Set(), toolsOff: { notes: ['archive'] } });
    assert.deepStrictEqual([rep.toolFilter, rep.servers[0].toolsOff], [true, ['archive']]);
    const noFilter = agentMcpReply({ a: info(s2), ad: new FakeAdapter({ capabilities: { mcpToolFilter: false } }), live: [], off: new Set(), secrets: [], cli: [], extras: [], ambientDisabled: new Set() });
    assert.strictEqual(noFilter.toolFilter, undefined, 'no capability: the checkboxes are disabled');
  }

  done = true;
  console.log('[069] mcp server tools: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
