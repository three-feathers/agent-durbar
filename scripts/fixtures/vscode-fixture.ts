/**
 * Synthetic VS Code `User` folder for tests and screenshots. Everything here is invented text ("DURBAR fixture"):
 * no real chats are copied. Usage from code: buildVscodeFixture(dir, folder). From a shell (after `npm run test`
 * compiled the scripts): node dist-scripts/scripts/fixtures/vscode-fixture.js <outDir> <folder>
 * then run the app with DURBAR_VSCODE_USER_DIR=<outDir>/User.
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const md = (value: string) => ({ value, isTrusted: false, supportThemeIcons: false, uris: {} });
const line = (o: unknown): string => JSON.stringify(o) + '\n';

export interface FixtureInfo {
  userDir: string;
  /** Storage hash folders: matching the folder, another folder, a workspace file, and a broken workspace.json. */
  hashes: { match: string; other: string; workspace: string; broken: string };
  matchCount: number;
}

/** `folder` is an absolute path of the folder the "VS Code" chats belong to. */
export function buildVscodeFixture(outDir: string, folder: string, workspaceFile?: string): FixtureInfo {
  const userDir = path.join(outDir, 'User');
  const ws = path.join(userDir, 'workspaceStorage');
  const hashes = { match: 'a1b2c3d4e5f60718', other: 'b2c3d4e5f6071829', workspace: 'c3d4e5f607182930', broken: 'd4e5f60718293041' };
  const t0 = Date.parse('2026-09-30T09:00:00Z');

  // 1) the folder: an append log with later mutations, a partial last line, a flat .json, a duplicate id, junk
  write(path.join(ws, hashes.match, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folder).href }));
  const chats = path.join(ws, hashes.match, 'chatSessions');
  const req1 = {
    requestId: 'request_1',
    timestamp: t0,
    message: { text: 'DURBAR fixture: how do I add a note to the list?', parts: [] },
    variableData: { variables: [{ id: 'file', name: 'index.js', kind: 'file' }] },
    response: [
      { kind: 'thinking', value: 'private reasoning that must not be shown' },
      md('You can push a new item '),
      md('onto the array, see '),
      { kind: 'inlineReference', name: 'index.js', inlineReference: { path: '/fixture/index.js' } },
      md('.\n'),
      { kind: 'toolInvocationSerialized', toolId: 'copilot_readFile', invocationMessage: md('Reading [](file:///fixture/index.js), lines 1 to 40'), pastTenseMessage: md('Read [](file:///fixture/index.js), lines 1 to 40'), isComplete: true, toolCallId: 't1' },
      { kind: 'toolInvocationSerialized', toolId: 'run_in_terminal', invocationMessage: 'Running tests', toolSpecificData: { kind: 'terminal', commandLine: { original: 'npm test' } }, isComplete: true, toolCallId: 't2' },
      { kind: 'textEditGroup', uri: { scheme: 'file', path: '/fixture/index.js' }, edits: [[{ text: '// DURBAR fixture edit', range: {} }]], done: true },
      { kind: 'codeblockUri', uri: { scheme: 'file', path: '/fixture/index.js' } },
      md('Done: I added the note.'),
      { kind: 'futureThing2027', payload: 1 },
    ],
    result: { timings: { totalElapsed: 1200 } },
  };
  const req2 = { requestId: 'request_2', timestamp: t0 + 60_000, message: { text: 'Now make it persistent.' }, response: [md('Not yet.')], result: { errorDetails: { message: 'DURBAR fixture rate limit' } } };
  write(
    path.join(chats, 's-log.jsonl'),
    line({ kind: 0, v: { version: 3, creationDate: t0, sessionId: 's-log', requests: [req1], inputState: { inputText: 'private draft' } } }) +
      line({ kind: 2, k: ['requests'], v: [req2] }) +
      line({ kind: 1, k: ['customTitle'], v: 'Notes app: add and persist notes' }) +
      '{"kind":2,"k":["requests",1,"resp', // partial write at the end
  );
  write(
    path.join(chats, 's-flat.json'),
    JSON.stringify({ version: 3, creationDate: t0 - 86_400_000, sessionId: 's-flat', requests: [{ timestamp: t0 - 86_400_000, message: { text: 'DURBAR fixture: older flat-JSON chat' }, response: ['Plain string answer from an old VS Code.'] }] }),
  );
  // same id as an existing chat in both formats: the .jsonl must win
  write(path.join(chats, 's-dup.json'), JSON.stringify({ version: 3, creationDate: t0, requests: [{ timestamp: t0, message: { text: 'DURBAR fixture: stale flat copy' }, response: [] }] }));
  write(path.join(chats, 's-dup.jsonl'), line({ kind: 0, v: { version: 3, creationDate: t0 - 5000, requests: [{ timestamp: t0 - 5000, message: { text: 'DURBAR fixture: newer log copy' }, response: [md('ok')] }] } }));
  write(path.join(chats, 's-empty.jsonl'), line({ kind: 0, v: { version: 3, creationDate: t0, requests: [] } }));
  write(path.join(chats, 's-corrupt.jsonl'), 'this is not json at all\n{{{\n');
  write(path.join(chats, 's-zero.json'), '');
  write(path.join(chats, 'notes.txt'), 'ignored');
  write(path.join(chats, 'bad name.json'), '{}');
  // hostile paths in a log must not pollute prototypes
  write(path.join(chats, 's-proto.jsonl'), line({ kind: 0, v: { version: 3, creationDate: t0 - 10_000, requests: [{ timestamp: t0 - 10_000, message: { text: 'DURBAR fixture: proto' }, response: [] }] } }) + line({ kind: 1, k: ['__proto__', 'polluted'], v: 1 }));

  // 2) another folder (must not show up)
  write(path.join(ws, hashes.other, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(path.join(outDir, 'some-other-folder')).href }));
  write(path.join(ws, hashes.other, 'chatSessions', 'o1.json'), JSON.stringify({ version: 3, requests: [{ message: { text: 'DURBAR fixture: other folder' }, response: [] }] }));

  // 3) a multi-root workspace file
  const wsFile = workspaceFile ?? path.join(outDir, 'fixture.code-workspace');
  write(path.join(ws, hashes.workspace, 'workspace.json'), JSON.stringify({ workspace: pathToFileURL(wsFile).href }));
  write(path.join(ws, hashes.workspace, 'chatSessions', 'w1.json'), JSON.stringify({ version: 3, creationDate: t0, requests: [{ timestamp: t0, message: { text: 'DURBAR fixture: chat of the multi-root workspace' }, response: ['ok'] }] }));

  // 4) broken workspace.json and one with no chatSessions
  write(path.join(ws, hashes.broken, 'workspace.json'), '{ not json');
  write(path.join(ws, 'e5f6071829304152', 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folder).href }));
  return { userDir, hashes, matchCount: 1 };
}

if (require.main === module) {
  const [out, folder] = process.argv.slice(2);
  if (!out || !folder) {
    console.error('usage: vscode-fixture.js <outDir> <folder>');
    process.exit(2);
  }
  const info = buildVscodeFixture(path.resolve(out), path.resolve(folder));
  console.log(`DURBAR_VSCODE_USER_DIR=${info.userDir}`);
}
