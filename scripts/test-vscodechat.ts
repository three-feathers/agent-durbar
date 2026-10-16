/** Unit tests for the read-only VS Code chat history reader with synthetic fixtures: `npm run test:vscodechat`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileUriToPath, findChatStores, listChats, plainLinks, readChat, replayLog, toTranscript, vscodeUserDirs } from '../src/adapters/vscodeChat';
import { buildVscodeFixture } from './fixtures/vscode-fixture';

// --- where VS Code keeps its data
assert.deepStrictEqual(vscodeUserDirs('darwin', {}, '/Users/a')[0], { product: 'Code', dir: '/Users/a/Library/Application Support/Code/User' });
assert.strictEqual(vscodeUserDirs('linux', {}, '/home/a')[1].dir, '/home/a/.config/Code - Insiders/User');
assert.strictEqual(vscodeUserDirs('linux', { XDG_CONFIG_HOME: '/x' }, '/home/a')[0].dir, '/x/Code/User');
assert.strictEqual(vscodeUserDirs('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a')[0].dir, 'C:\\Users\\a\\AppData\\Roaming\\Code\\User');
assert.strictEqual(vscodeUserDirs('win32', {}, 'C:\\Users\\a')[2].dir, 'C:\\Users\\a\\AppData\\Roaming\\VSCodium\\User');

// --- file URIs
assert.strictEqual(fileUriToPath('file:///home/a/my%20proj', 'linux'), '/home/a/my proj');
assert.strictEqual(fileUriToPath('file:///c%3A/Users/a/proj', 'win32'), 'c:\\Users\\a\\proj');
assert.strictEqual(fileUriToPath('file://server/share/p', 'win32'), '\\\\server\\share\\p');
assert.strictEqual(fileUriToPath('vscode-remote://ssh-remote+h/home/a', 'linux'), undefined, 'remote folders are not matched');
assert.strictEqual(fileUriToPath('file:///%E0%A4%A', 'linux'), undefined, 'bad escapes do not throw');
assert.strictEqual(fileUriToPath(42 as unknown as string, 'linux'), undefined);

// --- markdown link cleanup
assert.strictEqual(plainLinks('Read [](file:///a/b%20c.ts), lines 1 to 2 and [docs](https://x.y/z)'), 'Read b c.ts, lines 1 to 2 and docs');

// --- append log replay
{
  const r = replayLog('{"kind":0,"v":{"requests":[{"a":1}],"customTitle":"t"}}\n{"kind":2,"k":["requests"],"v":[{"a":2},{"a":3}]}\n{"kind":1,"k":["requests",0,"a"],"v":9}\n{"kind":2,"k":["requests"],"i":2}\n{"kind":3,"k":["customTitle"]}\n{"kind":1,"k":["requests",5,"x","y"],"v":1}\n{"kind":2,"k":["requests"],"v":[{"a":4}],"i":1}\nnot json\n');
  assert.deepStrictEqual(r.state.requests, [{ a: 9 }, { a: 4 }]);
  assert.strictEqual(r.state.customTitle, undefined);
  assert.strictEqual(r.badLines, 1);
  assert.throws(() => replayLog('{"kind":1,"k":["x"],"v":1}\n'), /snapshot/);
  assert.throws(() => replayLog(''), /snapshot/);
  const p = replayLog('{"kind":0,"v":{}}\n{"kind":1,"k":["__proto__","polluted"],"v":1}\n{"kind":1,"k":["constructor","prototype","polluted"],"v":1}\n');
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined, 'no prototype pollution');
  assert.strictEqual(p.badLines, 2);
}

// --- fixture on disk
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-vsfix-'));
try {
  const folder = path.join(tmp, 'my project');
  fs.mkdirSync(folder);
  const wsFile = path.join(tmp, 'fixture.code-workspace');
  const fx = buildVscodeFixture(tmp, folder, wsFile);
  const ud = { product: 'Code', dir: fx.userDir };

  const stores = findChatStores(ud, { folders: [folder] });
  assert.strictEqual(stores.length, 1, 'only the storage whose workspace.json points at the folder (the one without chatSessions, the broken and the foreign ones are skipped)');
  assert.strictEqual(stores[0].hash, fx.hashes.match);
  assert.strictEqual(findChatStores(ud, { folders: [folder + path.sep] }).length, 1, 'trailing separator');
  assert.strictEqual(findChatStores(ud, { folders: [path.join(tmp, 'nothing')] }).length, 0);
  assert.strictEqual(findChatStores({ product: 'Code', dir: path.join(tmp, 'nope') }, { folders: [folder] }).length, 0, 'VS Code not installed');
  const wsStores = findChatStores(ud, { folders: [path.join(tmp, 'x')], workspaceFile: wsFile });
  assert.deepStrictEqual(wsStores.map((s) => s.hash), [fx.hashes.workspace], 'a .code-workspace matches its own storage');

  const listing = listChats([ud], { folders: [folder] });
  assert.strictEqual(listing.storesFound, 1);
  const titles = listing.sessions.map((s) => s.summary.title);
  assert.deepStrictEqual(titles, ['Notes app: add and persist notes', 'DURBAR fixture: newer log copy', 'DURBAR fixture: proto', 'DURBAR fixture: older flat-JSON chat']);
  assert.strictEqual(listing.unreadable, 1, 'the corrupt file is counted, not fatal');
  assert.ok(!titles.some((t) => t.includes('stale')), '.jsonl wins over .json for the same id');
  assert.ok(!listing.sessions.some((s) => s.summary.key.endsWith('/s-empty')), 'empty chats are hidden');
  const top = listing.sessions[0];
  assert.strictEqual(top.summary.requests, 2);
  assert.strictEqual(top.summary.format, 'jsonl');
  assert.ok(top.summary.updated! > top.summary.created!);
  assert.strictEqual(top.summary.key, `${fx.hashes.match}/s-log`);

  const r = readChat(top);
  assert.ok(r.ok);
  if (r.ok) {
    const t = r.transcript;
    assert.strictEqual(t.title, 'Notes app: add and persist notes');
    assert.strictEqual(t.totalRequests, 2);
    const kinds = t.blocks.map((b) => b.type);
    assert.deepStrictEqual(kinds, ['user', 'assistant', 'tool', 'tool', 'tool', 'assistant', 'user', 'assistant', 'note']);
    const user = t.blocks[0];
    assert.ok(user.type === 'user' && user.attachments?.[0] === 'index.js');
    const a1 = t.blocks[1];
    assert.ok(a1.type === 'assistant' && a1.text === 'You can push a new item onto the array, see `index.js`.', 'markdown chunks and inline references are joined');
    assert.deepStrictEqual(t.blocks.filter((b) => b.type === 'tool').map((b) => (b as { label: string }).label), ['Read index.js, lines 1 to 40', 'Running tests: npm test', 'Edited index.js']);
    const json = JSON.stringify(t);
    assert.ok(!json.includes('private reasoning'), 'reasoning is not shown');
    assert.ok(!json.includes('private draft'), 'input state is not read');
    assert.ok(t.blocks[8].type === 'note' && (t.blocks[8] as { text: string }).text.includes('rate limit'));
    assert.ok(t.notes.some((n) => /unreadable line/.test(n)), 'partial last line is reported');
    assert.ok(t.notes.some((n) => /futureThing2027/.test(n)), 'unknown part kinds are reported, not silently dropped');
  }
  const flat = listing.sessions.find((s) => s.summary.key.endsWith('/s-flat'))!;
  const fr = readChat(flat);
  assert.ok(fr.ok && fr.transcript.blocks[1].type === 'assistant' && (fr.transcript.blocks[1] as { text: string }).text.startsWith('Plain string'), 'old flat JSON with string responses');

  // a file that disappears or breaks after listing is a clean error
  fs.writeFileSync(top.file, 'garbage');
  const bad = readChat(top);
  assert.ok(!bad.ok && /could not be read/.test(bad.error));
  fs.rmSync(top.file);
  assert.ok(!readChat(top).ok);

  // unknown format version is flagged
  const v9 = toTranscript({ state: { version: 9, requests: [{ message: { text: 'x' }, response: [] }] }, badLines: 0 });
  assert.ok(v9.notes.some((n) => /version 9/.test(n)));
  const nov = toTranscript({ state: { requests: [] }, badLines: 0 });
  assert.ok(nov.notes.some((n) => /no format version/.test(n)));
  // huge chats are capped
  const many = toTranscript({ state: { version: 3, requests: Array.from({ length: 450 }, (_, i) => ({ message: { text: 'm' + i }, response: [] })) }, badLines: 0 });
  assert.strictEqual(many.shownRequests, 300);
  assert.ok(many.notes.some((n) => /last 300 of 450/.test(n)));
  // hostile shapes never throw
  const weird = toTranscript({ state: { version: 3, requests: [null, 5, { message: 7, response: [null, 3, { kind: 5 }, { kind: 'toolInvocationSerialized' }, { kind: 'textEditGroup', uri: null }, { kind: 'inlineReference' }] }] }, badLines: 0 });
  assert.ok(Array.isArray(weird.blocks));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('vscodechat tests passed');
