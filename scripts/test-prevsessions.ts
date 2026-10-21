/**
 * Previous sessions: list, pin/hide and delete (spec 006 FR-024..FR-032, issue #368): `npm run test:runtime`. Fake adapter, fake
 * Copilot client and in-memory deps only: nothing is deleted, no session is started, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import { FolderStore } from '../src/main/folders';
import { ALREADY_DELETING, BEING_OPENED, IN_OFFICE, NOT_AVAILABLE, NO_DELETE, PrevSessions, listPreviousOp, markOp, openIdsOf } from '../src/main/prevsessions';
import type { PrevDeps } from '../src/main/prevsessions';
import { sessionIdOk } from '../src/shared/sessionid';
import type { AgentInfo } from '../src/shared/api';
import type { PreviousSession } from '../src/adapters/history';
import { CHANGE_TOOLS, READ_TOOLS } from '../src/main/mcp/tools';
import { FakeClient, TestAdapter } from './fakes/copilot-sdk';

const ROOT = path.resolve(__dirname, '..', '..');
const UUID = (n: number): string => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const abs = (p: string): string => path.resolve('/', p);
const prev = (n: number, days: number): PreviousSession => ({ id: UUID(n), title: `Secret prompt text ${n}`, startTime: Date.UTC(2026, 9, 20 - days), modifiedTime: Date.UTC(2026, 9, 20 - days, 12), branch: 'main' });
const agent = (id: string, cwd = abs('proj')): AgentInfo => ({ id, name: 'proj', cwd, folders: [cwd], permMode: 'read-only', adapterId: 'fake' }) as unknown as AgentInfo;

interface Rig {
  d: PrevDeps;
  ad: FakeAdapter;
  store: FolderStore;
  logged: Array<[string, string]>;
  agents: Map<string, AgentInfo>;
  resume: Map<string, string>;
  sessions: PrevSessions;
  dir: string;
}
function rig(opts: { deleteSession?: boolean; list?: PreviousSession[] } = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-prev-'));
  const store = new FolderStore(path.join(dir, 'folders.json'));
  store.upsert({ workspace: abs('proj'), permMode: 'read-only' });
  const ad = new FakeAdapter({ capabilities: { deleteSession: opts.deleteSession !== false }, previous: opts.list ?? [prev(1, 2), prev(2, 5), prev(3, 9)] });
  const agents = new Map<string, AgentInfo>([['card-1', agent('card-1')]]);
  const resume = new Map<string, string>();
  const logged: Array<[string, string]> = [];
  const d: PrevDeps = {
    agents,
    router: { forAgent: () => ad, adapterIdOf: () => 'fake' },
    store,
    wsKey: (a) => a.cwd,
    resumeIdFor: (id) => resume.get(id) ?? id,
    appName: () => 'Fake agent',
    log: (_a, dec, action) => logged.push([dec, action]),
  };
  return { d, ad, store, logged, agents, resume, sessions: new PrevSessions(d), dir };
}
const cleanup = (r: Rig): void => fs.rmSync(r.dir, { recursive: true, force: true });

async function main(): Promise<void> {
  // ---- the strict id allow-list (also in the folder store and the adapters)
  {
    for (const ok of [UUID(1), 'thr_0', 'abc-DEF_123', 'a']) assert.ok(sessionIdOk('copilot', ok), ok);
    const bad = ['../x', '..\\x', '..', 'a/../b', 'C:\\x', 'C:/x', 'c:x', '/etc/passwd', '\\\\host\\share', '', 'a'.repeat(101), 'a\u0000b', 'a\nb', 'a\tb', '.x', 'a.b', 'a b', '-x', '%2e%2e', 5, null, undefined, {}];
    for (const id of bad) for (const ad of ['copilot', 'claude', 'codex', 'fake', undefined]) assert.ok(!sessionIdOk(ad, id), `${String(ad)} refuses ${JSON.stringify(id)}`);
  }

  // ---- delete: refused ids never reach the adapter
  {
    // the bad ids are IN the runtime's list, so only the allow-list (not the list re-check) can stop them
    const evil = ['../x', '..\\x', 'C:\\x', '/abs/path', 'a'.repeat(101), 'a\u0000b', 'a\nb'];
    const r = rig({ list: evil.map((id, i) => ({ ...prev(i + 1, 1), id })) });
    for (const id of [...evil, '', 5, null]) {
      const res = await r.sessions.delete('card-1', id);
      assert.strictEqual(res.ok, false, JSON.stringify(id));
    }
    assert.deepStrictEqual(r.ad.deleteCalls, [], 'the adapter was never called for a bad id');
    assert.deepStrictEqual(r.logged, []);
    cleanup(r);
  }

  // ---- delete: no capability, unknown agent
  {
    const r = rig({ deleteSession: false });
    assert.strictEqual(r.ad.deleteSession, undefined, 'no member without the flag');
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: false, error: NO_DELETE });
    assert.deepStrictEqual(await r.sessions.delete('nope', UUID(1)), { ok: false, error: 'unknown agent' });
    assert.deepStrictEqual(await r.sessions.delete(7, UUID(1)), { ok: false, error: 'unknown agent' });
    assert.deepStrictEqual(r.ad.deleteCalls, []);
    cleanup(r);
  }

  // ---- delete: a card that appears while the list is being re-read (e.g. a lazy restore) still stops the delete (review of PR #379)
  {
    const r = rig();
    const orig = r.ad.listPreviousSessions!.bind(r.ad);
    r.ad.listPreviousSessions = async (cwd, exclude) => {
      const list = await orig(cwd, exclude);
      r.agents.set('late-card', agent('late-card'));
      r.resume.set('late-card', UUID(1));
      return list;
    };
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: false, code: 'in-office', agentId: 'late-card', error: IN_OFFICE });
    assert.deepStrictEqual(r.ad.deleteCalls, [], 'the adapter was never asked');
    assert.deepStrictEqual(r.logged, []);
    cleanup(r);
  }

  // ---- delete: refused for a session that still has a card, by every route (Clarifications Q1)
  {
    const r = rig();
    // a card whose Durbar id is the session id
    r.agents.set(UUID(1), agent(UUID(1)));
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: false, code: 'in-office', agentId: UUID(1), error: IN_OFFICE });
    // a card whose resume id is the session id (Codex: the thread id), lazy or ended: it is just a card in the map
    r.agents.set('durbar-x', agent('durbar-x'));
    r.resume.set('durbar-x', UUID(2));
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(2)), { ok: false, code: 'in-office', agentId: 'durbar-x', error: IN_OFFICE });
    // live in the adapter with no card at all
    const sid = await r.ad.start({ workspace: abs('proj'), permissionMode: 'read-only', sessionId: UUID(3) });
    assert.strictEqual(sid, UUID(3));
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(3)), { ok: false, code: 'in-office', error: IN_OFFICE });
    assert.deepStrictEqual(r.ad.deleteCalls, [], 'the adapter was never asked');
    assert.deepStrictEqual(r.logged, [], 'a refusal writes no activity row');
    assert.strictEqual((r.ad as unknown as { previous: unknown[] }).previous.length, 3, 'nothing was deleted');
    // after the card is removed it can go
    r.agents.delete(UUID(1));
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: true });
    cleanup(r);
  }

  // ---- delete: not in this folder's list; adapter error; success drops marks and logs once, with no title
  {
    const r = rig();
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(9)), { ok: false, error: NOT_AVAILABLE });
    assert.deepStrictEqual(r.ad.deleteCalls, [], 'not in the list: not asked');
    // adapter error (the runtime lost it): passed on, nothing else changes
    const orig = r.ad.deleteSession!;
    r.ad.deleteSession = async () => {
      throw new Error('session gone\nfrom disk');
    };
    r.store.markPrevious(abs('proj'), 'fake', UUID(1), 'pin');
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: false, error: 'session gone from disk' });
    assert.deepStrictEqual(r.store.get(abs('proj'))?.prevPinned, [{ src: 'fake', id: UUID(1) }], 'the pin stays');
    assert.deepStrictEqual(r.logged, [], 'no row on an error');
    r.ad.deleteSession = orig;
    r.store.addOpenSession(abs('proj'), UUID(1), undefined);
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: true });
    assert.deepStrictEqual(r.ad.deleteCalls, [UUID(1)]);
    assert.ok(!r.store.get(abs('proj'))?.prevPinned, 'the pin went with the session');
    assert.ok(!r.store.get(abs('proj'))?.openSessions, 'and any saved open session');
    assert.deepStrictEqual(r.logged, [['session-deleted', 'Session deleted · Fake agent · a1b2c3d4 · last used 2026-10-18']], 'one row: short id and date, no title');
    assert.ok(!JSON.stringify(r.logged).includes('Secret prompt'), 'the title is never logged');
    assert.deepStrictEqual((await listPreviousOp(r.d, 'card-1')).sessions.map((s) => s.id), [UUID(2), UUID(3)], 'gone from the list');
    cleanup(r);
  }

  // ---- delete: in flight (delete twice, resume and delete)
  {
    const r = rig();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => (release = res));
    const orig = r.ad.deleteSession!;
    r.ad.deleteSession = async (id) => {
      await gate;
      return orig(id);
    };
    const first = r.sessions.delete('card-1', UUID(1));
    await new Promise((res) => setTimeout(res, 5));
    assert.ok(r.sessions.isDeleting(UUID(1)));
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(1)), { ok: false, error: ALREADY_DELETING });
    assert.strictEqual(r.sessions.beginResume(UUID(1)), false, 'resume of an id being deleted is refused');
    assert.strictEqual(r.sessions.beginResume(UUID(2)), true);
    assert.deepStrictEqual(await r.sessions.delete('card-1', UUID(2)), { ok: false, error: BEING_OPENED }, 'delete of an id being resumed is refused');
    r.sessions.endResume(UUID(2));
    release();
    assert.deepStrictEqual(await first, { ok: true });
    assert.strictEqual(r.logged.length, 1, 'one row for one delete');
    assert.ok(!r.sessions.isDeleting(UUID(1)), 'the guard is released');
    cleanup(r);
  }

  // ---- list: open sessions are left out by Durbar id AND resume id (FR-032); marks filtered to present ids
  {
    const r = rig();
    r.agents.set('durbar-x', agent('durbar-x'));
    r.resume.set('durbar-x', UUID(2));
    assert.deepStrictEqual([...openIdsOf(r.d)].sort(), ['card-1', 'durbar-x', UUID(2)].sort());
    r.store.markPrevious(abs('proj'), 'fake', UUID(1), 'pin');
    r.store.markPrevious(abs('proj'), 'fake', UUID(3), 'hide');
    r.store.markPrevious(abs('proj'), 'fake', UUID(8), 'hide'); // not in the list: inert
    r.store.markPrevious(abs('proj'), 'copilot', UUID(1), 'pin'); // another source: not ours
    const l = await listPreviousOp(r.d, 'card-1');
    assert.deepStrictEqual(l.sessions.map((s) => s.id), [UUID(1), UUID(3)], 'the card by resume id is not listed');
    assert.deepStrictEqual([l.pinned, l.hidden], [[UUID(1)], [UUID(3)]]);
    assert.deepStrictEqual(await listPreviousOp(r.d, 'nope'), { ok: false, error: 'unknown agent', sessions: [], pinned: [], hidden: [] });
    cleanup(r);
  }

  // ---- mark
  {
    const r = rig();
    assert.deepStrictEqual(markOp(r.d, 'card-1', 'fake', UUID(1), 'pin'), { ok: true });
    assert.deepStrictEqual(markOp(r.d, 'card-1', 'vscode', 'h1/c1', 'hide'), { ok: true });
    assert.deepStrictEqual(r.store.get(abs('proj'))?.prevPinned, [{ src: 'fake', id: UUID(1) }]);
    assert.strictEqual(markOp(r.d, 'nope', 'fake', UUID(1), 'pin').ok, false, 'unknown agent');
    assert.strictEqual(markOp(r.d, 'card-1', 'codex', UUID(1), 'pin').ok, false, "another agent app's source");
    assert.strictEqual(markOp(r.d, 'card-1', '../x', UUID(1), 'pin').ok, false);
    assert.strictEqual(markOp(r.d, 'card-1', 'fake', UUID(1), 'delete').ok, false, 'unknown action');
    for (const bad of ['../x', '..\\x', 'C:\\x', '/abs', '', 'a'.repeat(101), 'a\u0000b', 'h/c']) assert.strictEqual(markOp(r.d, 'card-1', 'fake', bad, 'pin').ok, false, JSON.stringify(bad));
    for (const bad of ['../x/y', 'a/../b', 'h1', 'h1/c1/c2', '/h/c', 'C:/h/c']) assert.strictEqual(markOp(r.d, 'card-1', 'vscode', bad, 'pin').ok, false, JSON.stringify(bad));
    assert.strictEqual(r.store.get(abs('proj'))?.prevPinned?.length, 1, 'refusals wrote nothing');
    cleanup(r);
  }

  // ---- Copilot: client.deleteSession on a fake client; a live id and a bad id never reach it
  {
    const fake = new FakeClient();
    const ad = new TestAdapter(fake);
    assert.strictEqual(ad.capabilities.deleteSession, true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-prev-cop-'));
    try {
      const sid = await ad.start({ workspace: dir, permissionMode: 'read-only', sessionId: UUID(5) });
      fake.onDisk.add(UUID(6));
      await assert.rejects(() => ad.deleteSession!(sid), /open/, 'a live id is refused');
      for (const bad of ['../x', '..\\x', 'C:\\x', '/abs', '', 'a'.repeat(101), 'a\u0000b']) await assert.rejects(() => ad.deleteSession!(bad), /not a session id/, JSON.stringify(bad));
      assert.deepStrictEqual(fake.deleted, [], 'the client was never asked');
      await ad.deleteSession!(UUID(6));
      assert.deepStrictEqual(fake.deleted, [UUID(6)]);
      await assert.rejects(() => ad.deleteSession!(UUID(6)), /not found/, 'the runtime error is passed on');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- reachability (Vikram's review of #373): only the window's IPC can delete
  {
    const names = [...READ_TOOLS, ...CHANGE_TOOLS].map((t) => t.name);
    assert.ok(!names.some((n) => /delete|prev|history|session/i.test(n)), `no MCP tool deletes or touches previous sessions: ${names.join(', ')}`);
    const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); // Windows checkouts have CRLF: the line rules below use ^ and $
    const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const DELETE_WORDS = /sessions:delete|deletePrevious|PrevSessions|prevsessions|\.deleteSession\b|deleteSessionOf/;
    // main-process files that other features run through: the MCP server and tools, remote control and channels, schedules, the shared ops
    const guarded = [...walk('src/main/mcp'), 'src/main/mcpipc.ts', 'src/main/mcpstore.ts', 'src/main/mcpfiles.ts', 'src/main/remoteops.ts', 'src/main/schedules.ts', 'src/main/agentops.ts', 'src/main/daily.ts', ...walk('src/shared').filter((f) => !/shared[\\/]api\.ts$/.test(f))]; // api.ts only types the bridge
    for (const f of guarded) assert.ok(!DELETE_WORDS.test(read(f)), `${f} has no path to delete a session`);
    // in src/main only src/main/ipc/previous.ts (the window's IPC, spec 045 FR-060) and prevsessions.ts name it; main.ts only passes the dependencies to it
    for (const f of walk('src/main')) if (!/src\/main\/(ipc\/previous|prevsessions)\.ts$/.test(f.replace(/\\/g, '/'))) assert.ok(!DELETE_WORDS.test(read(f)), `${f} does not reach the delete`);
    // adapters: only the delete members themselves and the router helper
    for (const f of walk('src/adapters')) if (!/\/(copilot|codex|fake|router|types|capabilities)\.ts$/.test(f.replace(/\\/g, '/'))) assert.ok(!/\bdeleteSession\b/.test(read(f)), `${f} does not delete sessions`);
    const main = read('src/main/ipc/previous.ts');
    assert.strictEqual((main.match(/'sessions:delete'/g) ?? []).length, 1, 'one registration');
    assert.ok(/ipcHandle\('sessions:delete'/.test(main), 'registered through ipcHandle (the sender check)');
    assert.strictEqual((main.match(/prevSessions\.delete\(/g) ?? []).length, 1, 'called from that one handler only');
    assert.ok(!/ipcMain\.(handle|on)\('sessions:/.test(main));
    // nothing else in ipc/previous.ts names the delete: every line that does is the single registration (`ipcHandle('sessions:delete', ... prevSessions.delete(`)
    const namers = main.split(/\r?\n/).filter((l) => /deleteSessionOf|\.deleteSession\(|'sessions:delete'|prevSessions\.delete\(/.test(l.replace(/^\s*\/\/.*$/, '')));
    assert.strictEqual(namers.length, 1, `one line in ipc/previous.ts reaches the delete: ${namers.join(' | ')}`);
    assert.ok(/^\s*ipcHandle\('sessions:delete', \(_e, id: unknown, sessionId: unknown\) => prevSessions\.delete\(id, sessionId\)\);$/.test(namers[0]));
    // Known limit (spec 006 R2): this reads source text, so an obfuscated call (a computed property name, a string built at run time) would not be seen.
    // Clarifications Q1: Delete… is offered only on a row of Previous sessions, never on an office card, List-view row, card menu or chat header
    const app = read('src/renderer/app.js');
    const from = app.indexOf('function openPrevMenu(');
    const to = app.indexOf('\nasync function deletePrev(');
    assert.ok(from > 0 && to > from);
    const outside = app.slice(0, from) + app.slice(to);
    const inMenu = app.slice(from, to);
    assert.ok(inMenu.includes('Delete…'));
    assert.ok(!/Delete…|data-pact="delete"/.test(outside.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no other menu or header offers Delete…');
    assert.strictEqual((app.match(/bridge\.deletePrevious\(/g) ?? []).length, 1, 'one caller of the bridge delete');
    // the renderer sends ids only: the bridge has no path argument for delete
    assert.ok(/deletePrevious: \(id, sessionId\) => ipcRenderer\.invoke\('sessions:delete', id, sessionId\)/.test(read('src/preload/preload.ts')));
  }

  console.log('prevsessions: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
