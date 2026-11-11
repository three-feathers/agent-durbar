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
  const { register, linkedInProject } = require('../src/main/ipc/profiles') as typeof import('../src/main/ipc/profiles');
  const { listClaudeAgents } = require('../src/adapters/claudeAgents') as typeof import('../src/adapters/claudeAgents');
  const { AgentTrustStore, nodeAgentFileFs, readAgentFile, shownSha } = require('../src/main/agenttrust') as typeof import('../src/main/agenttrust');
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
      const noFollowless = { ...nodeAgentFileFs, flags: { O_RDONLY: fs.constants.O_RDONLY } }; // the real wrappers: the bigint option must reach node (issue #1491)
      assert.strictEqual(readAgentFile(link, noFollowless), undefined, 'without O_NOFOLLOW (Windows) the lstat refuses the link');
      assert.ok(readAgentFile(file, noFollowless)?.sha256 === sha(V1), 'without O_NOFOLLOW a plain file is read');
      // without O_NOFOLLOW: a file replaced between the lstat and the open (another dev/ino on the descriptor) is refused
      const otherIno = { ...noFollowless, lstat: (f: string, o: { bigint: true }) => { const st = fs.lstatSync(f, o); return { isSymbolicLink: () => st.isSymbolicLink(), dev: st.dev, ino: st.ino + 1n }; } };
      assert.strictEqual(readAgentFile(file, otherIno), undefined, 'a file other than the one the lstat saw is refused');
      // the link check on its own: an lstat that reports a link with the real file's dev and ino is still refused
      const linkSameIno = { ...noFollowless, lstat: (f: string, o: { bigint: true }) => { const st = fs.lstatSync(f, o); return { isSymbolicLink: () => true, dev: st.dev, ino: st.ino }; } };
      assert.strictEqual(readAgentFile(file, linkSameIno), undefined, 'a link is refused even when dev and ino match');
      const otherDev = { ...noFollowless, lstat: (f: string, o: { bigint: true }) => { const st = fs.lstatSync(f, o); return { isSymbolicLink: () => false, dev: st.dev + 1n, ino: st.ino }; } };
      assert.strictEqual(readAgentFile(file, otherDev), undefined, 'another device is refused');
      // issue #1491: NTFS file IDs above 2^53 that differ only in bit 0 are two files. The stubs answer like node: a bigint only for
      // { bigint: true }, else the rounded number, so a read that drops the option (or compares as numbers) fails these cases.
      const A = 12947848929002476n;
      const B = A + 1n;
      assert.strictEqual(Number(A), Number(B), 'precondition: as plain numbers the two ids are equal');
      const ids = (lIno: bigint, fIno: bigint, lDev = 7n, fDev = 7n) => {
        const as = (v: bigint, o?: { bigint?: boolean }): never => (o?.bigint ? v : Number(v)) as never;
        return {
          io: fs, flags: { O_RDONLY: fs.constants.O_RDONLY },
          lstat: (f: string, o?: { bigint?: boolean }) => { const st = fs.lstatSync(f); return { isSymbolicLink: () => st.isSymbolicLink(), dev: as(lDev, o), ino: as(lIno, o) }; },
          fstat: (_fd: number, o?: { bigint?: boolean }) => ({ dev: as(fDev, o), ino: as(fIno, o) }),
        } as never;
      };
      assert.ok(readAgentFile(file, ids(A, A, A, A))?.sha256 === sha(V1), 'issue 1491: the same ids above 2^53 on both sides are read');
      assert.strictEqual(readAgentFile(file, ids(A, B)), undefined, 'issue 1491 agenttrust ino: a descriptor whose inode differs only in bit 0 above 2^53 is refused');
      assert.strictEqual(readAgentFile(file, ids(A, A, A, B)), undefined, 'issue 1491 agenttrust dev: a descriptor whose device differs only in bit 0 above 2^53 is refused');
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
  type Sel = { ok: boolean; error?: string; needsConfirm?: boolean; sha256?: string; profile?: AgentProfile | null };
  const selectId = (id: string, profileId: string, confirm?: unknown) => Promise.resolve(handlers.get('agents:selectProfile')!(win, id, profileId, confirm)) as Promise<Sel>;
  const select = (id: string, confirm?: unknown) => selectId(id, 'pirate', confirm);
  const launched = async (from: number, name: string): Promise<{ prompt: string; tools?: string[] }> => {
    const a = await until('launch', () => sp.calls[from]?.args);
    return (JSON.parse(a[a.indexOf('--agents') + 1]) as Record<string, { prompt: string; tools?: string[] }>)[name];
  };
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

  // the shown profile and the launch come from main's one read, not from the disk later: the adapter's calls run after the file
  // changed again (the stand-in writes S3 just before each one), and still show and launch S2
  {
    const scout = path.join(WS, '.claude', 'agents', 'scout.md');
    const S2 = '---\nname: scout\ntools: Read, Grep\n---\nScout two.\n';
    const S3 = '---\nname: scout\ntools: Bash\n---\nScout three, never shown.\n';
    ad = {
      listAgentProfiles: (sid: string) => claude.listAgentProfiles(sid),
      agentProfileOfFile: (sid: string, id: string, f: AgentFileRead) => (fs.writeFileSync(scout, S3), claude.agentProfileOfFile(sid, id, f)),
      selectAgentProfile: (sid: string, id: string | null, f?: AgentFileRead) => (fs.writeFileSync(scout, S3), claude.selectAgentProfile(sid, id, f)),
    };
    const s3 = await newSession();
    fs.writeFileSync(scout, S2);
    const q = await selectId(s3, 'scout');
    assert.deepStrictEqual([q.needsConfirm, q.sha256, q.profile?.tools], [true, sha(S2), ['Read', 'Grep']], 'the dialog shows the profile of the bytes that were hashed');
    fs.writeFileSync(scout, S2);
    const done = await selectId(s3, 'scout', { sha256: q.sha256 });
    assert.deepStrictEqual([done.ok, done.profile?.tools], [true, ['Read', 'Grep']]);
    const from = sp.calls.length;
    await claude.send(s3, { text: 'hi' } as never);
    assert.deepStrictEqual(await launched(from, 'scout'), { description: 'scout', prompt: 'Scout two.', tools: ['Read', 'Grep'] }, 'the launch holds the confirmed S2, not the S3 on disk');
    await claude.stop(s3);
    ad = claude;
  }

  // a user agent whose name a folder file takes over after the list: the session starts with the user file main read, and an adapter
  // call without main's bytes never picks the folder's file
  {
    const userFile = path.join(CFG, 'agents', 'reviewer.md');
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, '---\nname: reviewer\n---\nThe user reviewer.\n');
    const folderFile = path.join(WS, '.claude', 'agents', 'x.md');
    fs.writeFileSync(folderFile, '---\nname: reviewer\n---\n'); // no prompt: not an agent when the list is read
    ad = {
      listAgentProfiles: async (sid: string) => { const l = await claude.listAgentProfiles(sid); fs.writeFileSync(folderFile, '---\nname: reviewer\n---\nFolder text nobody confirmed.\n'); return l; },
      agentProfileOfFile: (sid: string, id: string, f: AgentFileRead) => claude.agentProfileOfFile(sid, id, f),
      selectAgentProfile: (sid: string, id: string | null, f?: AgentFileRead) => claude.selectAgentProfile(sid, id, f),
    };
    const s4 = await newSession();
    const r = await selectId(s4, 'reviewer');
    assert.deepStrictEqual([r.ok, r.needsConfirm, r.profile?.source, r.profile?.path], [true, undefined, 'user', userFile], 'the listed user agent is selected');
    const from = sp.calls.length;
    await claude.send(s4, { text: 'hi' } as never);
    assert.strictEqual((await launched(from, 'reviewer')).prompt, 'The user reviewer.', 'the launch holds the user file, not the folder file');
    await claude.stop(s4);
    const s5 = await newSession();
    await assert.rejects(claude.selectAgentProfile(s5, 'reviewer'), /not available/, 'without main\'s bytes a folder agent is refused');
    assert.strictEqual(await claude.selectAgentProfile(s5, 'reviewer', { path: folderFile, bytes: Buffer.from('---\nname: other\n---\nx') }).catch(() => 'refused'), 'refused', 'bytes that define another agent are refused');
    assert.strictEqual(await claude.selectAgentProfile(s5, 'reviewer', { path: path.join(root, 'reviewer.md'), bytes: fs.readFileSync(userFile) }).catch(() => 'refused'), 'refused', 'a file outside the agent folders is refused');
    await claude.stop(s5);
    fs.unlinkSync(folderFile);
    ad = claude;
  }

  // a project whose .claude/agents or .claude is a link to a folder elsewhere: nothing listed, nothing read through it
  if (process.platform !== 'win32') {
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'agents', 'far.md'), '---\nname: far\n---\nFrom outside the project.\n');
    const W2 = path.join(root, 'w2');
    fs.mkdirSync(path.join(W2, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'agents'), path.join(W2, '.claude', 'agents'));
    const W3 = path.join(root, 'w3');
    fs.mkdirSync(W3);
    fs.symlinkSync(elsewhere, path.join(W3, '.claude'));
    for (const [w, what] of [[W2, '.claude/agents'], [W3, '.claude']]) {
      assert.deepStrictEqual(listClaudeAgents([w], CFG).filter((d) => d.profile.source === 'repo'), [], `a linked ${what} lists nothing`);
      const far = path.join(w, '.claude', 'agents', 'far.md');
      assert.strictEqual(linkedInProject([w], far), true, `a linked ${what} is found`);
      const sw = await claude.start({ workspace: w, quiet: true } as never);
      assert.ok(!(await claude.listAgentProfiles(sw)).some((x) => x.id === 'far'), `the session lists nothing through a linked ${what}`);
      await assert.rejects(claude.selectAgentProfile(sw, 'far', { path: far, bytes: fs.readFileSync(far) }), /not available/, `bytes from a linked ${what} are refused`);
      await claude.stop(sw);
      const fp: AgentProfile = { id: 'far', name: 'far', source: 'repo', path: far };
      ad = { listAgentProfiles: async () => [fp], selectAgentProfile: async () => fp };
      agents.set('linked', { id: 'linked', cwd: w });
      assert.deepStrictEqual(await selectId('linked', 'far'), { ok: false, error: 'The agent file could not be read.' }, `main refuses a file under a linked ${what}`);
    }
    assert.strictEqual(linkedInProject([WS], file), false, 'a plain project folder is fine');
    assert.strictEqual(linkedInProject([root, WS], file), false, 'the nearest session folder is the project');
    assert.strictEqual(linkedInProject([path.join(root, 'other')], file), false, 'a file in no session folder: nothing to check');
    // two session folders, the inner one reached through a link in the outer one: the inner (nearest) folder is the project
    const real = path.join(root, 'real-inner');
    fs.mkdirSync(path.join(real, '.claude', 'agents'), { recursive: true });
    const outer = path.join(root, 'outer');
    fs.mkdirSync(outer);
    const inner = path.join(outer, 'inner');
    fs.symlinkSync(real, inner);
    const innerFile = path.join(inner, '.claude', 'agents', 'a.md');
    assert.strictEqual(linkedInProject([outer, inner], innerFile), false, 'a link between the outer and the inner session folder does not count');
    assert.strictEqual(linkedInProject([inner, outer], innerFile), false, 'whatever the order of the folders');
    // a longer session folder that does not hold the file is not the project
    const longer = path.join(root, 'ws-and-more-letters');
    fs.mkdirSync(longer);
    assert.strictEqual(linkedInProject([WS, longer], file), false, 'a longer folder that does not hold the file is not used');
    const { linkedBelow } = require('../src/shared/linkedfolders') as typeof import('../src/shared/linkedfolders'); // eslint-disable-line @typescript-eslint/no-require-imports
    assert.strictEqual(linkedBelow(longer, path.dirname(file)), true, 'a folder outside root counts as linked');
    assert.strictEqual(linkedBelow(WS, path.dirname(file)), false);
    ad = claude;
  }

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
