/**
 * Spec 058 (2026-11-14 delta, owner report): a server switched off for one chat stays off when the chat is closed and opened again, when
 * its session is ended and resumed, and after an app restart. The real `registerMcpIpc` (on a stand-in for electron, as
 * test-mcp-signinwiring.ts does) with the real FolderStore file: "restart" = new handlers, a new store reading the saved file, a new agents map.
 * Names only are saved. `npm run test:mcpswitchpersist`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FakeAdapter } from '../src/adapters/fake';

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = {
    ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0', getPath: () => os.tmpdir() },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => assert.fail('never the browser') },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-058-persist-')));
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    const { McpStore } = require('../src/main/mcpstore') as typeof import('../src/main/mcpstore');
    const { savedMcpOff } = require('../src/main/mcpsavedoff') as typeof import('../src/main/mcpsavedoff');
    const { FolderStore, parseSessionMcpOff, MAX_SESSION_MCP_OFF, MAX_MCP_OFF_NAMES } = require('../src/main/folders') as typeof import('../src/main/folders');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = (ch: string, ...a: unknown[]): Promise<unknown> => Promise.resolve(handlers.get(ch)!(win, ...a));

    const ws = path.join(root, 'ws');
    fs.mkdirSync(ws);
    fs.mkdirSync(path.join(root, 'copilot'));
    fs.writeFileSync(path.join(root, 'copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { wiki: { type: 'http', url: 'https://wiki.example/mcp?token=SECRET123' }, tool: { type: 'stdio', command: 'tool-mcp' } } }));
    const file = path.join(root, 'folders.json');
    const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpRestart: true } as never });
    const sid = await ad.start({ workspace: ws, quiet: true });

    // one "run" of the app: a new store reading the saved file, new handlers, a new agents map (the same ids come back, as after a restart)
    // main's own helper (`savedMcpOff`, the key is wsKey + resumeIdFor), with main's wsKey rule; `rid` stands for resumeIdFor (a Codex thread id differs from the agent id)
    const wsKey = (a: { workspaceFile?: string; cwd: string }): string => a.workspaceFile ?? a.cwd;
    let rid = (id: string): string => id;
    const writes = { n: 0 };
    const boot = (readd = true, agentExtra: Record<string, unknown> = {}): { agents: Map<string, never>; fs: InstanceType<typeof FolderStore>; mcp: ReturnType<typeof registerMcpIpc> } => {
      const fstore = new FolderStore(file);
      fstore.load();
      if (readd && !fstore.get(agentExtra.workspaceFile ? String(agentExtra.workspaceFile) : ws)) fstore.upsert({ workspace: agentExtra.workspaceFile ? String(agentExtra.workspaceFile) : ws, permMode: 'read-only' });
      const realSave = (fstore as unknown as { save(): void }).save.bind(fstore);
      (fstore as unknown as { save(): void }).save = () => { writes.n++; realSave(); };
      const agents = new Map([[sid, { id: sid, cwd: ws, name: 'Mia', permMode: 'read-only', ...agentExtra } as never]]);
      const router = { onEvent: () => () => undefined, forAgent: (id: string) => (agents.has(id) ? ad : undefined), adapterIdOf: () => 'fake' };
      const store = new McpStore(path.join(root, 'durbar-mcp.json'));
      store.load();
      const mcp = registerMcpIpc({
        store: () => store,
        agents,
        router: router as never,
        dev: { DURBAR_COPILOT_DIR: path.join(root, 'copilot') } as never,
        appOf: () => 'copilot',
        savedOff: savedMcpOff(() => fstore, wsKey, (id) => rid(id)),
      });
      return { agents, fs: fstore, mcp };
    };
    const offNames = async (): Promise<string[]> => {
      const r = (await call('agents:mcp', sid)) as { servers: Array<{ name: string; off?: boolean }> };
      return r.servers.filter((x) => x.off).map((x) => x.name).sort();
    };

    let run = boot();
    assert.deepStrictEqual(await offNames(), [], 'nothing is off at first');
    assert.deepStrictEqual(await call('agents:setMcp', sid, 'wiki', false), { ok: true });
    assert.deepStrictEqual(await offNames(), ['wiki'], 'the switch shows');
    // close and open the chat: the window asks the dialog again (nothing in main changes)
    assert.deepStrictEqual(await offNames(), ['wiki'], 'closed and opened again: still off');
    // End session and resume (and Restart session): the same id goes through the start options again
    assert.deepStrictEqual(run.mcp.optionsFor(sid).disabledMcpServers.includes('wiki'), true, 'a restarted session starts with it off');
    assert.deepStrictEqual(await offNames(), ['wiki'], 'after the restart of the session: still off');

    // app restart: everything new, only the saved file remains
    run = boot();
    assert.ok(run.mcp.optionsFor(sid).disabledMcpServers.includes('wiki'), 'the restarted app starts the session with it off, before any dialog was opened');
    assert.deepStrictEqual(await offNames(), ['wiki'], 'after an app restart: still off');
    // unchanged list: not written (a message re-saves it on every send)
    const w0 = writes.n;
    for (let i = 0; i < 20; i++) run.mcp.noteSession(sid);
    assert.strictEqual(writes.n, w0, 'twenty messages with an unchanged list write nothing');
    // a session resumed from Previous sessions: its agent is not in the office yet when the start options are built
    const draft = { id: '', cwd: ws, name: 'Mia', permMode: 'read-only' } as never;
    assert.ok(run.mcp.optionsFor('', { agent: draft, sessionId: sid }).disabledMcpServers.includes('wiki'), 'a resumed session starts with its saved switches');
    assert.ok(!run.mcp.optionsFor('', { agent: draft, sessionId: 'another-session' }).disabledMcpServers.includes('wiki'), 'another session does not');

    // turning it back on persists too
    assert.deepStrictEqual(await call('agents:setMcp', sid, 'wiki', true), { ok: true });
    run = boot();
    assert.deepStrictEqual(await offNames(), [], 'switched back on: on after a restart');
    assert.ok(!('sessionMcpOff' in (JSON.parse(fs.readFileSync(file, 'utf8')).folders[0])), 'an empty list is not written');

    // only names are saved: no address, token or command anywhere in the file
    await call('agents:setMcp', sid, 'wiki', false);
    await call('agents:setMcp', sid, 'tool', false);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/SECRET123|wiki\.example|tool-mcp|https?:/.test(text), 'no value saved: ' + text);
    assert.deepStrictEqual(JSON.parse(text).folders[0].sessionMcpOff, [{ id: sid, off: ['wiki', 'tool'] }]);

    // a name that is gone from every list (a removed global server) does not break the dialog; it is just not a row
    run = boot();
    await call('agents:setMcp', sid, 'gone-server', false);
    run = boot();
    assert.deepStrictEqual(await offNames(), ['tool', 'wiki'], 'unknown names are not rows');

    // a corrupt file with the folder NOT re-added: a switch must not write over it (it could hold the person's other folders)
    fs.writeFileSync(file, '{ not json');
    run = boot(false);
    assert.deepStrictEqual(await offNames(), [], 'a corrupt file: nothing off, no crash');
    await call('agents:setMcp', sid, 'wiki', false);
    run.mcp.noteSession(sid);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json', 'an unknown folder never rewrites the file');
    // the folder added again: the next switch saves
    run = boot();
    assert.deepStrictEqual(await offNames(), [], 'a corrupt file: nothing off, no crash');
    assert.deepStrictEqual(await call('agents:setMcp', sid, 'wiki', false), { ok: true });
    assert.deepStrictEqual(await offNames(), ['wiki']);

    // a store that throws never breaks the switch for this run
    const bad = registerMcpIpc({ store: () => ({ load() {} }) as never, agents: run.agents as never, router: { onEvent: () => () => undefined, forAgent: () => ad, adapterIdOf: () => 'fake' } as never, dev: { DURBAR_COPILOT_DIR: path.join(root, 'copilot') } as never, appOf: () => 'copilot', savedOff: { read: () => { throw new Error('x'); }, readFor: () => { throw new Error('x'); }, write: () => { throw new Error('x'); } } });
    void bad;
    assert.deepStrictEqual(await call('agents:setMcp', sid, 'wiki', false), { ok: true }, 'a failing save does not fail the switch');

    // a multi-root workspace whose resume id differs from the agent id (Codex): saved under the workspace file and the resume id
    const wf = path.join(root, 'two.code-workspace');
    fs.writeFileSync(wf, '{}');
    rid = () => 'thread-7';
    run = boot(true, { workspaceFile: wf });
    await call('agents:setMcp', sid, 'tool', false);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')).folders.find((f: { workspace: string }) => f.workspace === wf);
    assert.deepStrictEqual(doc.sessionMcpOff, [{ id: 'thread-7', off: ['tool'] }], 'keyed by the workspace file and the resume id');
    run = boot(true, { workspaceFile: wf });
    assert.deepStrictEqual(await offNames(), ['tool'], 'comes back after a restart under the resume id');
    rid = (id) => id;

    // parse rules: bounds, names, ids
    assert.strictEqual(parseSessionMcpOff('x'), undefined);
    assert.strictEqual(parseSessionMcpOff([{ id: 'a', off: [] }]), undefined, 'an empty list is nothing');
    assert.deepStrictEqual(parseSessionMcpOff([{ id: 'a', off: ['x', 'x', '', 7, '__proto__', 'bad\nname', 'y'.repeat(65), 'ok'] }, { id: '../b', off: ['x'] }]), [{ id: 'a', off: ['x', 'ok'] }]);
    assert.strictEqual(parseSessionMcpOff(Array.from({ length: 60 }, (_, i) => ({ id: 's' + i, off: ['x'] })))?.length, MAX_SESSION_MCP_OFF, 'the newest sessions kept');
    assert.strictEqual(parseSessionMcpOff([{ id: 'a', off: Array.from({ length: 80 }, (_, i) => 'n' + i) }])?.[0].off.length, MAX_MCP_OFF_NAMES, 'names capped');
    const st = new FolderStore(path.join(root, 'f2.json'));
    st.upsert({ workspace: ws, permMode: 'ask' });
    assert.strictEqual(st.setSessionMcpOff(path.join(root, 'nope'), 'a', ['x']), false, 'only saved folders');
    assert.strictEqual(st.setSessionMcpOff(ws, 'bad id', ['x']), false, 'a bad id is refused');
    for (let i = 0; i < 55; i++) st.setSessionMcpOff(ws, 'x' + i, ['n']);
    const back = new FolderStore(path.join(root, 'f2.json')).load()[0];
    assert.strictEqual(back.sessionMcpOff?.length, MAX_SESSION_MCP_OFF, 'stale sessions pruned to the newest 50');
    assert.ok(!back.sessionMcpOff?.some((x) => x.id === 'x0'), 'the oldest dropped');
    process.exitCode = 0;
    console.log('[mcp-switchpersist] PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
