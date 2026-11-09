/**
 * Spec 043 FR-044 (T021): the confirmation of a repository agent trusts the text it showed. `agents:selectProfile` is registered on a
 * stand-in electron module and called as the window would, with a real ClaudeAdapter over a fake `claude` child (no process, no
 * network, no credits), a real AgentTrustStore and real agent files in a scratch folder. `npm run test:agentconfirm`.
 */
// an async test whose promise never settles lets Node exit 0 without the OK line: fail unless the success path is reached
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';
import type { AgentFileRead, AgentProfile } from '../src/adapters/types';
import { FakeClaudeChild, fakeSpawn, SANDBOX_HOST_OK } from './fakes/claude-cli';
import { tmpDir } from './test-tmp';

const sha = (t: string): string => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined): Promise<T> {
  const end = Date.now() + 3000;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick(2);
  }
}

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, shell: {}, dialog: {} };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  /* eslint-disable @typescript-eslint/no-require-imports */
  (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
  const { register } = require('../src/main/ipc/profiles') as typeof import('../src/main/ipc/profiles');
  const { AgentTrustStore, readAgentFile, shownSha } = require('../src/main/agenttrust') as typeof import('../src/main/agenttrust');
  const { ClaudeAdapter, claudeArgs } = require('../src/adapters/claude') as typeof import('../src/adapters/claude');
  const { createCliTransport } = require('../src/adapters/claudeTransport') as typeof import('../src/adapters/claudeTransport');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const root = fs.realpathSync(tmpDir('durbar-043-confirm-'));
  const WS = path.join(root, 'ws');
  const CFG = path.join(root, 'cfg');
  fs.mkdirSync(path.join(WS, '.claude', 'agents'), { recursive: true });
  fs.mkdirSync(CFG);
  const file = path.join(WS, '.claude', 'agents', 'pirate.md');
  const V1 = '---\nname: pirate\ndescription: Arr\ntools: Read\n---\nYou are a pirate. Read only.\n';
  const V2 = '---\nname: pirate\ndescription: Arr\ntools: Read, Bash\n---\nYou are a pirate. Run any command.\n';
  fs.writeFileSync(file, V1);

  // ---- the one-open reader: bytes and hash from the same read; never a link; the Windows branch (no O_NOFOLLOW) checks with lstat ----
  {
    const r = readAgentFile(file);
    assert.ok(r && r.sha256 === sha(V1) && r.bytes.toString('utf8') === V1, 'hash of exactly the bytes returned');
    assert.strictEqual(readAgentFile(path.join(WS, 'missing.md')), undefined);
    const big = path.join(root, 'big.md');
    fs.writeFileSync(big, 'x'.repeat(1024 * 1024 + 1));
    assert.strictEqual(readAgentFile(big), undefined, 'over the 1 MB cap');
    assert.strictEqual(readAgentFile(path.join(WS, '.claude')), undefined, 'a folder');
    if (process.platform !== 'win32') {
      const link = path.join(root, 'link.md');
      fs.symlinkSync(file, link);
      assert.strictEqual(readAgentFile(link), undefined, 'a linked agent file is refused');
      const noFollowless = { io: fs, flags: { O_RDONLY: fs.constants.O_RDONLY }, lstat: (f: string) => fs.lstatSync(f) };
      assert.strictEqual(readAgentFile(link, noFollowless), undefined, 'without O_NOFOLLOW (Windows) the lstat refuses the link');
      assert.ok(readAgentFile(file, noFollowless)?.sha256 === sha(V1), 'without O_NOFOLLOW a plain file is read');
      const hard = path.join(root, 'hard.md');
      fs.linkSync(file, hard);
      assert.strictEqual(readAgentFile(file), undefined, 'a file with a second hard link is refused');
      fs.unlinkSync(hard);
    }
  }

  // ---- the confirmation argument: { sha256 } with 64 lowercase hex digits, nothing else ----
  assert.strictEqual(shownSha({ sha256: sha(V1) }), sha(V1));
  for (const bad of [true, 'yes', 1, {}, { sha256: 'abc' }, { sha256: sha(V1).toUpperCase() }, { sha256: sha(V1) + '0' }, { sha256: 7 }, [sha(V1)]]) assert.strictEqual(shownSha(bad), undefined, JSON.stringify(bad));

  // ---- the IPC handler with a real Claude adapter ----
  const sp = fakeSpawn();
  sp.next = (c: FakeClaudeChild): void => {
    c.onWrite = (o) => {
      if (o.type === 'control_request') setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
      else if (o.type === 'user') setTimeout(() => { c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, model: 'm', permissionMode: 'default', tools: [], mcp_servers: [] }); c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }); }, 0);
    };
  };
  const claude = new ClaudeAdapter({ autopilot: { wired: false }, sandboxFacts: SANDBOX_HOST_OK, configDir: CFG, claudePath: async () => '/usr/bin/claude', makeTransport: (x: Parameters<NonNullable<ConstructorParameters<typeof ClaudeAdapter>[0]["makeTransport"]>>[0]) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) } as never);
  const trustFile = path.join(root, 'trust.json');
  const trust = new AgentTrustStore(trustFile);
  trust.load();
  let ad: unknown = claude;
  const agents = new Map<string, unknown>();
  register({ agents: agents as never, router: { forAgent: () => ad } as never, getAgentTrust: () => trust, wsKey: (a) => a.cwd, ensureLive: async () => undefined, oneShot: () => undefined });
  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
  const frame = { url: indexUrl };
  const win = { senderFrame: frame, sender: { mainFrame: frame } };
  const select = (id: string, confirm?: unknown) => Promise.resolve(handlers.get('agents:selectProfile')!(win, id, 'pirate', confirm)) as Promise<{ ok: boolean; error?: string; needsConfirm?: boolean; sha256?: string; profile?: AgentProfile | null }>;
  const trusted = (): boolean => fs.existsSync(trustFile) && fs.readFileSync(trustFile, 'utf8').includes('pirate');
  const newSession = async (): Promise<string> => {
    const sid = await claude.start({ workspace: WS, quiet: true } as never);
    agents.set(sid, { id: sid, cwd: WS });
    return sid;
  };

  // (c) no confirmation: the dialog's profile and the hash of the text it comes from; a missing or malformed hash is refused
  const s1 = await newSession();
  const ask = await select(s1);
  assert.deepStrictEqual([ask.ok, ask.needsConfirm, ask.sha256, ask.profile?.tools], [false, true, sha(V1), ['Read']], 'needsConfirm carries the shown text\'s hash');
  for (const bad of [true, {}, { sha256: 'abc' }, { sha256: 'Z'.repeat(64) }, { sha256: sha(V1).toUpperCase() }, 'ok', false]) {
    const r = await select(s1, bad);
    assert.deepStrictEqual([r.ok, r.error], [false, 'invalid request'], 'refused: ' + JSON.stringify(bad));
  }
  assert.ok(!trusted(), 'nothing trusted without the shown hash');

  // (b) the file changes after the dialog: not trusted, asked again with the new text and its hash
  fs.writeFileSync(file, V2);
  const again = await select(s1, { sha256: ask.sha256 });
  assert.deepStrictEqual([again.ok, again.needsConfirm, again.sha256, again.profile?.tools], [false, true, sha(V2), ['Read', 'Bash']], 'the new text is shown');
  assert.ok(!trusted(), 'the changed file is not trusted');

  // (a) confirmed with the hash of what is on disk: trusted and selected
  const ok = await select(s1, { sha256: again.sha256 });
  assert.deepStrictEqual([ok.ok, ok.profile?.id, ok.profile?.tools], [true, 'pirate', ['Read', 'Bash']]);
  assert.ok(trust.isTrusted(WS, 'pirate', sha(V2)) && !trust.isTrusted(WS, 'pirate', sha(V1)), 'the confirmed text is the trusted one');

  // (e) the launch uses the confirmed bytes: a change after the confirmation does not reach the session
  fs.writeFileSync(file, V2.replace('Run any command.', 'Something never shown.'));
  await claude.send(s1, { text: 'hi' } as never);
  const args = await until('launch', () => sp.calls[0]?.args);
  const agentsJson = JSON.parse(args[args.indexOf('--agents') + 1]) as Record<string, { prompt: string; tools?: string[] }>;
  assert.deepStrictEqual([agentsJson.pirate.prompt, agentsJson.pirate.tools], ['You are a pirate. Run any command.', ['Read', 'Bash']], 'the session starts with the confirmed text');
  await claude.stop(s1);

  // a trusted hash still selects without a question, with the bytes of this read
  fs.writeFileSync(file, V2);
  const s2 = await newSession();
  const quiet = await select(s2);
  assert.deepStrictEqual([quiet.ok, quiet.needsConfirm], [true, undefined], 'already confirmed: no question');

  // the adapter is handed the bytes main hashed
  {
    let got: AgentFileRead | undefined;
    const p: AgentProfile = { id: 'pirate', name: 'pirate', source: 'repo', path: file };
    ad = { listAgentProfiles: async () => [p], selectAgentProfile: async (_s: string, _id: string, f?: AgentFileRead) => ((got = f), p) };
    agents.set('fake', { id: 'fake', cwd: WS });
    assert.strictEqual((await select('fake')).ok, true);
    assert.ok(got && got.path === file && got.bytes.toString('utf8') === V2, 'selectAgentProfile gets the trusted bytes');
    // (d) an agent file listed through a link (an app that follows links) is refused before any question
    if (process.platform !== 'win32') {
      const link = path.join(WS, '.claude', 'agents', 'linked.md');
      fs.symlinkSync(file, link);
      p.path = link;
      const r = await select('fake');
      assert.deepStrictEqual([r.ok, r.needsConfirm, r.error], [false, undefined, 'The agent file could not be read.'], 'a linked agent file is refused');
    }
  }

  console.log('agent confirmation tests passed');
  process.exitCode = 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
