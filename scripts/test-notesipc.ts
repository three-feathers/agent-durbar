/** Spec 083 T013 (FR-009, FR-062, issue 699): the notes calls main answers: validation, the session and app from the agent (never the window), masking values, nothing raw out. `npm run test:notes`. No Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentInfo } from '../src/shared/api';
import { NotesOps, digestOf } from '../src/main/notesops';
import { NotesStore } from '../src/main/notesstore';
import { McpStore } from '../src/main/mcpstore';
import type { SecretCodec } from '../src/main/mcpstore';

const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const FOLDER_SECRET = 'folder-' + 'extra-secret';
const SESSION_SECRET = 'session-' + 'only-secret';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notesipc-'));
const ROOT = path.join(__dirname, '..', '..');
const src = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8');

const agent = (id: string, cwd: string): AgentInfo => ({ id, name: path.basename(cwd), cwd, folders: [cwd], permMode: 'read-only', status: 'ready' } as unknown as AgentInfo);
const agents = new Map<string, AgentInfo>([['a1', agent('a1', '/work/demo')], ['a2', agent('a2', '/work/demo')], ['b1', agent('b1', '/work/other')]]);
const sessions: Record<string, string> = { a1: 'sess-AAA', a2: 'sess-BBB', b1: 'bad session/../id' };
const calls: string[] = [];
const store = new NotesStore(path.join(root, 'notes'));
const ops = new NotesOps({
  agents, store: () => store,
  resumeIdFor: (id) => sessions[id] ?? id,
  adapterIdOf: (id) => (id === 'a2' ? 'claude' : 'copilot'),
  folderValues: () => { calls.push('folder'); return [FOLDER_SECRET]; },
  sessionValues: (id) => { calls.push('session:' + id); return [SESSION_SECRET]; },
  now: () => new Date('2026-10-24T10:00:00.000Z'),
  confirmNative: async () => true, // T034b: Delete all asks natively (refused without it: test-notesexport.ts)
});
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const refused = (r: { ok: boolean; error?: string; code?: string }, why: string): void => { assert.ok(!r.ok && typeof r.error === 'string' && r.error.length > 0 && r.error.length < 90, `${why}: ${JSON.stringify(r)}`); };

async function main(): Promise<void> {
  // AC3: the digest is the first 16 hex characters of SHA-256 of the message with \r\n turned into \n and the ends trimmed (shared test vector with the window helper, T021)
  assert.strictEqual(digestOf('a\r\nb '), '7e18f737311b2dc3');
  assert.strictEqual(digestOf('\n a\nb\r\n'), '7e18f737311b2dc3');
  assert.strictEqual(digestOf(''), 'e3b0c44298fc1c14');

  // AC2: the session id comes from resumeIdFor(agent), the app from the agent's adapter; what the window sends for them is ignored
  const w = must(await ops.save('a1', { role: 'agent', ord: 3, text: `Here is the plan with ${GH}`, session: 'attacker-session', app: 'claude', from: 'agent' }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.deepStrictEqual(w.note!.source, { app: 'copilot', session: 'sess-AAA', role: 'agent', ord: 3, digest: digestOf(`Here is the plan with ${GH}`), at: '2026-10-24T10:00:00.000Z' });
  const w2 = must(await ops.save('a2', { role: 'user', ord: 0, text: 'my question', from: 'user' }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.deepStrictEqual([w2.note!.source!.app, w2.note!.source!.session, w2.note!.from], ['claude', 'sess-BBB', 'user'], 'another agent app, its own session');
  const sel = must(await ops.save('a1', { role: 'agent', ord: 3, text: 'only this part', from: 'selection' }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.strictEqual(sel.note!.from, 'selection');
  const noFrom = must(await ops.save('a1', { role: 'user', ord: 1, text: 'no from given' }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.strictEqual(noFrom.note!.from, 'user', 'from defaults to the role');
  const badSess = must(await ops.save('b1', { role: 'agent', ord: 0, text: 'in a chat with no usable session id' }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.strictEqual(badSess.note!.source, undefined, 'an unusable session id is never stored: the note has no link');
  const dup = must(await ops.save('a1', { role: 'agent', ord: 3, text: `Here is the plan with ${GH}`, from: 'agent' }) as { ok: true; existing?: boolean });
  assert.strictEqual(dup.existing, true, 'the same message again: no second note');

  // masking values: the folder's and the session's for a saved message, the folder's only for a typed note; nothing raw comes back or lands on disk
  calls.length = 0;
  const m = must(await ops.save('a1', { role: 'agent', ord: 9, text: `a ${FOLDER_SECRET} b ${SESSION_SECRET} c ${GH}` }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.ok(!JSON.stringify(m).includes(FOLDER_SECRET) && !JSON.stringify(m).includes(SESSION_SECRET) && !JSON.stringify(m).includes(GH.slice(6, 18)), 'the answer has no secret');
  assert.deepStrictEqual(calls, ['folder', 'session:a1']);
  calls.length = 0;
  const typed = must(await ops.add('a1', { text: `typed ${FOLDER_SECRET} and ${SESSION_SECRET}` }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.ok(!typed.note!.text.includes(FOLDER_SECRET) && typed.note!.text.includes(SESSION_SECRET), 'a typed note uses the folder values, not a session');
  assert.deepStrictEqual(calls, ['folder'], 'no session lookup for a typed note');
  assert.strictEqual(typed.note!.from, 'typed');
  for (const f of fs.readdirSync(path.join(root, 'notes'))) assert.ok(!fs.readFileSync(path.join(root, 'notes', f), 'utf8').includes(FOLDER_SECRET), 'nothing raw on disk');
  const tolerant = new NotesOps({ agents, store: () => store, resumeIdFor: (id) => id, adapterIdOf: () => 'copilot', folderValues: () => { throw new Error('store not ready'); }, sessionValues: () => { throw new Error('nope'); } });
  const t = must(await tolerant.save('a1', { role: 'agent', ord: 77, text: `shape still masked ${GH}` }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.ok(!t.note!.text.includes(GH.slice(6, 18)), 'values unavailable: the shapes are still masked');

  // FR-005: the folder's known values come from the store without decrypting anything (no keychain prompt from a notes save)
  {
    const f = path.join(root, 'mcp.json');
    let decrypts = 0;
    const codec: SecretCodec = { available: () => true, encrypt: (x) => 'ENC1:' + Buffer.from(x.split('').reverse().join('')).toString('base64'), decrypt: (b) => { decrypts++; return Buffer.from(b.slice(5), 'base64').toString().split('').reverse().join(''); } };
    const K = '/work/demo';
    const first = new McpStore(f, codec);
    first.load();
    const vault = 'vault-' + 'secret-one';
    const header = 'header-' + 'secret-two';
    assert.ok(first.upsert(K, { name: 'echo', transport: 'stdio', command: 'node', args: ['e.js'], env: [{ key: 'API_KEY', value: vault }, { key: 'TINY', value: 'abc' }] }).ok);
    assert.ok(first.upsert(K, { name: 'web', transport: 'http', url: 'https://example.org/mcp', headers: [{ key: 'X-Auth', value: header }] }).ok);
    assert.deepStrictEqual(first.forSession(K).mcpServers, {}, 'neither is enabled or trusted');
    assert.deepStrictEqual(first.knownSecretValues(K).sort(), [header, vault].sort(), 'values typed this run, enabled or not, trusted or not, 4+ characters');
    assert.deepStrictEqual(first.knownSecretValues('/work/other'), []);
    assert.deepStrictEqual(first.knownSecretValues(''), []);
    const again = new McpStore(f, codec);
    again.load();
    decrypts = 0;
    assert.deepStrictEqual(again.knownSecretValues(K), [], 'locked: nothing known, and nothing decrypted');
    assert.strictEqual(again.noPrompt(), false, 'a locked vault: reading a session could prompt');
    assert.strictEqual(decrypts, 0, 'no decrypt call, so no keychain prompt');
    assert.ok(again.setEnabled(K, 'echo', true, true).ok);
    again.forSession(K);
    assert.ok(decrypts > 0, 'a session start does unlock');
    assert.strictEqual(again.noPrompt(), true);
    assert.deepStrictEqual(again.knownSecretValues(K).sort(), [header, vault].sort(), 'unlocked: every value of the folder, also the disabled server');
    assert.ok(/^\s*knownSecretValues\(/m.test(fs.readFileSync(path.join(ROOT, 'src/main/mcpstore.ts'), 'utf8')) && !/knownSecretValues[\s\S]{0,400}this\.unlock\(/.test(fs.readFileSync(path.join(ROOT, 'src/main/mcpstore.ts'), 'utf8')), 'knownSecretValues never calls unlock');
    assert.ok(/folderValues: \(key\) => mcpStore\?\.knownSecretValues\(key\)/.test(src('src/main/main.ts')) && /mcpStore\?\.noPrompt\(\) \? mcp\.secretValuesFor\(id\)/.test(src('src/main/main.ts')), 'main uses the no-prompt readers');
  }

  // list, update, delete by agent id; two chats of one folder see the same notes
  const l1 = await ops.list('a1');
  const l2 = await ops.list('a2');
  assert.ok(l1.ok && l2.ok && 'notes' in l1 && 'notes' in l2 && l1.notes.length === l2.notes.length && l1.notes.length > 3, 'both chats of a folder see its notes');
  const other = await ops.list('b1');
  assert.ok(other.ok && 'notes' in other && other.notes.length === 1, 'another folder has its own');
  const note = w.note!;
  const up = must(await ops.update('a1', note.id, note.rev, { title: 'Renamed', done: true }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.deepStrictEqual([up.note!.title, up.note!.done, up.note!.rev], ['Renamed', true, 2]);
  calls.length = 0;
  const upm = must(await ops.update('a1', typed.note!.id, typed.note!.rev, { text: `edited ${SESSION_SECRET} and ${FOLDER_SECRET}` }) as { ok: true; note?: import('../src/shared/notes').Note });
  assert.ok(!upm.note!.text.includes(SESSION_SECRET) && !upm.note!.text.includes(FOLDER_SECRET), 'update masks with the folder and the session values');
  assert.deepStrictEqual(calls, ['folder', 'session:a1'], 'update asks for both');
  const stale = await ops.update('a2', note.id, 1, { title: 'late' });
  assert.ok(!stale.ok && 'code' in stale && stale.code === 'stale');
  must(await ops.remove('a1', note.id, 2));
  must(await ops.removeAll('b1'));
  assert.ok(!(await ops.startOver('b1')).ok, 'start over is refused while the folder\'s file can be read');

  // AC4: bad input is refused with a short reason
  refused(await ops.list('nobody'), 'unknown agent');
  refused(await ops.list({}), 'agent id not a string');
  refused(await ops.list('x'.repeat(500)), 'agent id too long');
  refused(await ops.save('a1', null), 'no input');
  refused(await ops.save('a1', { role: 'agent', ord: 1, text: 42 }), 'non-string text');
  refused(await ops.save('a1', { role: 'agent', ord: 1, text: '   ' }), 'blank text');
  refused(await ops.save('a1', { role: 'agent', ord: 1, text: 'x'.repeat(65_537) }), 'text over 64 KB');
  refused(await ops.save('a1', { role: 'robot', ord: 1, text: 'x' }), 'unknown role');
  refused(await ops.save('a1', { role: 'agent', ord: 1.5, text: 'x' }), 'non-integer ord');
  refused(await ops.save('a1', { role: 'agent', ord: -1, text: 'x' }), 'negative ord');
  refused(await ops.save('a1', { role: 'agent', ord: 2_000_000, text: 'x' }), 'huge ord');
  refused(await ops.save('a1', { role: 'agent', ord: 1, text: 'x', from: 'typed' }), 'a way of saving only the note form may use');
  refused(await ops.save('a1', { role: 'user', ord: 1, text: 'x', from: 'agent' }), 'role and from disagree');
  refused(await ops.add('a1', { text: 7 }), 'add: non-string');
  refused(await ops.add('a1', {}), 'add: nothing');
  refused(await ops.add('a1', { text: 'x'.repeat(65_537) }), 'add: too long');
  refused(await ops.update('a1', 'not-an-id', 1, { done: true }), 'unknown note id');
  refused(await ops.update('a1', typed.note!.id, 1.5, { done: true }), 'non-integer rev');
  refused(await ops.update('a1', typed.note!.id, 0, { done: true }), 'rev below 1');
  refused(await ops.update('a1', typed.note!.id, '1', { done: true }), 'rev as text');
  refused(await ops.update('a1', typed.note!.id, 1, {}), 'nothing to change');
  refused(await ops.update('a1', typed.note!.id, 1, { text: 5 }), 'text not a string');
  refused(await ops.update('a1', typed.note!.id, 1, { title: 'x'.repeat(401) }), 'title too long');
  refused(await ops.update('a1', typed.note!.id, 1, { done: 'yes' }), 'done not a boolean');
  refused(await ops.update('a1', typed.note!.id, 1, 'x'), 'patch not an object');
  refused(await ops.remove('a1', 'n-' + 'z'.repeat(5), 1), 'delete: bad id');
  refused(await ops.remove('a1', typed.note!.id, 'x'), 'delete: bad rev');
  const unknownNote = await ops.remove('a1', 'n-' + 'z'.repeat(12), 1);
  assert.ok(!unknownNote.ok && 'code' in unknownNote && unknownNote.code === 'missing', 'an id that looks right but is not there: missing');
  const noStore = new NotesOps({ agents, store: () => undefined, resumeIdFor: (id) => id, adapterIdOf: () => 'copilot', folderValues: () => [], sessionValues: () => [] });
  refused(await noStore.list('a1'), 'store not ready');

  // AC1, AC5 and "nothing logged": the channels, the sender check, the change event, no logging, no Electron in the testable part
  const ipc = src('src/main/ipc/notes.ts');
  const chans = [...ipc.matchAll(/ipcHandle\('(notes:[A-Za-z]+)'/g)].map((x) => x[1]).sort();
  assert.deepStrictEqual(chans, ['notes:add', 'notes:delete', 'notes:deleteAll', 'notes:export', 'notes:fileCount', 'notes:list', 'notes:save', 'notes:setFile', 'notes:startOver', 'notes:update']);
  for (const c of chans) {
    const line = ipc.split('\n').find((x) => x.includes(`ipcHandle('${c}'`))!;
    assert.ok(/\(!fromApp\(e\) \? NO :/.test(line), `${c} checks fromApp(e) first`);
  }
  const preload = src('src/preload/preload.ts');
  for (const c of chans) assert.ok(preload.includes(`'${c}'`), `the preload calls ${c}`);
  assert.ok(/onNotesChanged: \(cb\) => sub\('notes:changed', cb\)/.test(preload), 'the preload hears notes:changed');
  const mainSrc = src('src/main/main.ts');
  assert.ok(/onChanged: \(fingerprint\) => toRenderer\('notes:changed', \{ fingerprint \}\)/.test(mainSrc), 'main sends notes:changed {fingerprint} after a change');
  for (const f of ['src/shared/notes.ts', 'src/main/notesstore.ts', 'src/main/notesops.ts', 'src/main/ipc/notes.ts']) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\.|debugSink|logActivity/.test(code), `${f} logs nothing`);
    assert.ok(!/child_process|\bexec(?:Sync|File)?\(|\bspawn\(/.test(code), `${f} starts no process`);
    if (f !== 'src/main/ipc/notes.ts') assert.ok(!/from 'electron'/.test(code), `${f} has no Electron import`);
  }
  const l3 = await ops.list('a1');
  assert.ok(l3.ok && 'session' in l3 && l3.session === 'sess-AAA', 'the list answers the chat\'s own session (main\'s resumeIdFor), so the drawer puts This session first');
  const l4 = await ops.list('b1');
  assert.ok(l4.ok && 'session' in l4 && l4.session === '', 'an unusable session id is answered as empty, never passed on');
  const listed = await ops.list('a1');
  assert.ok(listed.ok && Object.keys(listed).sort().join() === 'fingerprint,folderName,max,notes,ok,session', `the list answer has no path field: ${Object.keys(listed).join()}`);
  console.log('notes ipc: session and app from main, digest vector, masking values, bad input refused, fromApp on every channel, nothing raw out');
}

main().then(() => fs.rmSync(root, { recursive: true, force: true }), (e) => { console.error(e); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); });
