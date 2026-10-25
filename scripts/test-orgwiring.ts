/**
 * Spec 076 FR-203/FR-202 (issue 602, review on PR 644 item 2): the org-policy wiring of the IPC channels and of main.ts, by behaviour.
 * The channels are registered on a stand-in for the electron module and called as the window would call them; a blocking policy
 * must refuse (`agents:setModel`, `agents:setMcp`) or mark (`models:list`, `agents:mcp`, `agents:mcpTools`). main.ts itself starts
 * Electron and cannot run here: the lines that hand each dependency to its registration are pinned by their text.
 * Fixtures and fakes only (no agent app, no credits). `npm run test:orgwiring`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parseClaudeOrgPolicy } from '../src/adapters/claudeOrgPolicy';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentEvent, McpServerStatus } from '../src/adapters/types';
import { McpStore } from '../src/main/mcpstore';
import { mcpVerdict, modelVerdict, orgBlockedText, toolVerdict } from '../src/shared/orgpolicy';
import type { AgentInfo } from '../src/shared/api';

const C = 'Claude Code';
const claude = (o: unknown) => parseClaudeOrgPolicy(o as Record<string, unknown>, ['/etc/claude-code/managed-settings.json']);

async function main(): Promise<void> {
// (h) review on PR 644 (item 2): the IPC and main wiring, through the registered channels on a stand-in electron (as test-mcp-signin does)
{
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, safeStorage: { isEncryptionAvailable: () => false } };
  const savedElectron = require.cache[electronPath];
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-076-wiring-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register: registerModelIpc } = require('../src/main/ipc/model') as typeof import('../src/main/ipc/model');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
    const frame = { url: indexUrl };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = (ch: string, ...a: unknown[]) => Promise.resolve(handlers.get(ch)!(win, ...a)) as Promise<Record<string, unknown>>;
    const fa2 = new FakeAdapter({ id: 'claude', displayName: C });
    const sid = await fa2.start({ workspace: ws, quiet: true });
    const a2: AgentInfo = { id: sid, name: 'w', cwd: ws, folders: [ws], permMode: 'ask', adapterId: 'claude', model: 'sonnet' } as unknown as AgentInfo;
    const agents2 = new Map<string, AgentInfo>([[sid, a2]]);
    const polC = claude({ deniedModels: ['haiku'], deniedMcpServers: [{ serverName: 'bad' }], permissions: { deny: ['mcp__github__create_issue'] } });
    let listener: (e: AgentEvent) => void = () => undefined;
    let switchedModels = 0;
    (fa2 as unknown as { setModel: unknown }).setModel = async (_s: string, r: { model: string }) => (switchedModels++, { status: 'applied', model: r.model });
    (fa2 as unknown as { listModelOptions: unknown }).listModelOptions = async () => [{ id: 'sonnet', name: 'S', efforts: [] }, { id: 'haiku', name: 'H', efforts: [] }];
    (fa2 as unknown as { listMcpTools: unknown }).listMcpTools = async () => [{ name: 'create_issue' }, { name: 'search' }];
    let mcpSwitched = 0;
    (fa2 as unknown as { setMcpEnabled: unknown }).setMcpEnabled = async () => {
      mcpSwitched++;
    };
    const router = { onEvent: (cb: (e: AgentEvent) => void) => { listener = cb; return () => undefined; }, forAgent: () => fa2, instance: () => fa2 };
    const orgCall = { mcp: 0, mcpNow: 0, tool: 0, model: 0 };

    // registerModelIpc: agents:setModel and models:list ask the org policy (a blocked model is refused before anything is switched or saved)
    const saved2: string[] = [];
    registerModelIpc({
      agents: agents2, router: router as never, registry: { defaultId: 'claude', has: () => true } as never, wsKey: (a) => a.cwd,
      getFolderStore: () => ({ setModelChoice: (_k: string, c: { model: string }) => { saved2.push(c.model); } }) as never,
      orgModel: async (_id, m) => (orgCall.model++, modelVerdict(polC, m)),
    });
    assert.deepStrictEqual(await call('agents:setModel', sid, { model: 'haiku' }), { ok: false, error: `${orgBlockedText(C)}: pick another model.` }, 'h: agents:setModel refuses a blocked model through the channel');
    assert.deepStrictEqual([switchedModels, saved2, a2.model], [0, [], 'sonnet'], 'h: nothing switched, saved or changed');
    assert.strictEqual((await call('agents:setModel', sid, { model: 'sonnet' })).ok, true, 'h: an allowed model still switches');
    const list = (await call('models:list', 'claude')) as unknown as { ok: boolean; models: Array<{ id: string; orgBlocked?: string }> };
    assert.strictEqual(list.models.find((m) => m.id === 'haiku')?.orgBlocked, orgBlockedText(C), 'h: models:list marks the blocked model through the channel');
    assert.strictEqual(list.models.find((m) => m.id === 'sonnet')?.orgBlocked, undefined, 'h: and not the allowed one');

    // registerMcpIpc: agents:setMcp, the agents:mcp rows and agents:mcpTools
    const store = new McpStore(path.join(ws, 'm.json'));
    store.load();
    registerMcpIpc({
      store: () => store, agents: agents2, router: router as never, dev: { DURBAR_COPILOT_DIR: path.join(ws, 'copilot') } as never, appOf: () => 'claude',
      orgMcp: async (_id, s) => (orgCall.mcp++, mcpVerdict(polC, s)),
      orgMcpNow: (_id, s) => (orgCall.mcpNow++, mcpVerdict(polC, s)),
      orgTool: async (_id, s, t) => (orgCall.tool++, toolVerdict(polC, s, t)),
    });
    assert.deepStrictEqual(await call('agents:setMcp', sid, 'bad', true), { ok: false, error: `${orgBlockedText(C)}: it cannot be switched on.` }, 'h: agents:setMcp refuses a blocked server through the channel');
    assert.strictEqual(mcpSwitched, 0, 'h: and does not switch it');
    assert.strictEqual((await call('agents:setMcp', sid, 'good', true)).ok, true, 'h: another server switches on');
    assert.strictEqual((await call('agents:setMcp', sid, 'bad', false)).ok, true, 'h: switching a blocked one off is never refused');
    listener({ type: 'mcp', sessionId: sid, timestamp: 1, servers: [{ name: 'bad', status: 'connected' }, { name: 'good', status: 'connected' }] as McpServerStatus[] } as AgentEvent);
    const rows = ((await call('agents:mcp', sid)) as unknown as { servers: Array<{ name: string; orgBlocked?: string }> }).servers;
    assert.strictEqual(rows.find((x) => x.name === 'bad')?.orgBlocked, orgBlockedText(C), 'h: the agents:mcp row of a blocked server carries the reason');
    assert.strictEqual(rows.find((x) => x.name === 'good')?.orgBlocked, undefined, 'h: and the other row does not');
    const tools = (await call('agents:mcpTools', sid, 'github')) as unknown as { tools: Array<{ name: string; orgBlocked?: string }> };
    assert.deepStrictEqual(tools.tools, [{ name: 'create_issue', orgBlocked: orgBlockedText(C) }, { name: 'search' }], 'h: agents:mcpTools marks the blocked tool through the channel');
    assert.ok(orgCall.model > 0 && orgCall.mcp > 0 && orgCall.mcpNow > 0 && orgCall.tool > 0, 'h: every org dependency was really asked');

    // main.ts hands each dependency to its registration (the real wiring, pinned by its text: main.ts starts Electron and cannot run here)
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r/g, '');
    const call1 = (name: string): string => (mainSrc.match(new RegExp(`${name}\\(\\{[^\\n]*\\}\\);`)) ?? mainSrc.match(new RegExp(`${name}\\(\\{[\\s\\S]*?\\n\\}\\);`)) ?? [''])[0];
    const mcpReg = call1('registerMcpIpc');
    for (const w of ['orgMcp: (id, s) => orgPolicies.mcp(appIdOf(id), s)', 'orgMcpNow: (id, s) => orgPolicies.mcpNow(appIdOf(id), s)', 'orgTool: (id, server, tool) => orgPolicies.tool(appIdOf(id), server, tool)']) assert.ok(mcpReg.includes(w), `h: main.ts: registerMcpIpc gets ${w}`);
    assert.ok(call1('registerModelIpc').includes('orgModel: (adapterId, model) => orgPolicies.model(adapterId, model)'), 'h: main.ts: registerModelIpc gets orgModel');
    assert.ok(/const opsDeps: OpsDeps = \{[^\n]*orgRefusal: \(a, mode\) => orgPolicies\.refusalNow\(appIdOf\(a\.id\), \{ mode \}\)[^\n]*\};/.test(mainSrc), 'h: main.ts: opsDeps carries orgRefusal (the mode switch)');
    assert.ok(/registerAgentsIpc\(\{[^\n]*\bopsDeps\b/.test(mainSrc), 'h: main.ts: registerAgentsIpc gets opsDeps');
    assert.ok(mainSrc.includes('const appIdOf = (id: string): string | undefined => router.adapterIdOf(id) ?? agents.get(id)?.adapterId;'), 'h: main.ts: appIdOf reads the agent\'s own adapter id');
    assert.ok(/registerOrgPolicyIpc\(\{ view: \(\) => orgPolicies\.view\(\) \}\)/.test(mainSrc), 'h: main.ts: the window view is registered');
  } finally {
    if (savedElectron) require.cache[electronPath] = savedElectron;
    else delete require.cache[electronPath];
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

  console.log('test-orgwiring: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
