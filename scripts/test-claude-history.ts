/**
 * Claude previous sessions and history (spec 012 FR-125..FR-127) on SYNTHETIC session files in a temp config folder:
 * `npm run test:claudehistory`. No Claude data is read, no claude is run.
 */
import * as assert from 'assert';
import { SANDBOX_HOST_OK } from './fakes/claude-cli';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter } from '../src/adapters/claude';
import { HEAD_BYTES, claudeHistoryFromText, claudeProjectSlug, listClaudeSessions, parseSessionHead, readClaudeHistory } from '../src/adapters/claudeHistory';

const J = (o: unknown): string => JSON.stringify(o);
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-claude-cfg-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar claude ws-'));
const OTHER = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-claude-other-'));
const dirOf = (cwd: string): string => path.join(CFG, 'projects', claudeProjectSlug(cwd));
const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333';

const user = (text: unknown, extra: Record<string, unknown> = {}): string => J({ type: 'user', cwd: WS, gitBranch: 'main', timestamp: '2026-10-19T10:00:00.000Z', message: { role: 'user', content: text }, ...extra });
const asst = (content: unknown[], extra: Record<string, unknown> = {}): string => J({ type: 'assistant', cwd: WS, timestamp: '2026-10-19T10:00:05.000Z', message: { role: 'assistant', content }, ...extra });
const session = [
  J({ type: 'queue-operation', operation: 'enqueue' }),
  user('<command-name>/clear</command-name>'),
  user('Fix the login bug in auth.ts'),
  asst([{ type: 'text', text: 'Looking at it.' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: path.join(WS, 'auth.ts') } }]),
  user([{ type: 'tool_result', tool_use_id: 'tu1', content: 'export function login() {}' }]),
  asst([{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'npm test' } }]),
  user([{ type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: '1 failing' }], is_error: true }]),
  asst([{ type: 'text', text: 'helper says hi' }], { isSidechain: true }),
  user('[Request interrupted by user]'),
  asst([{ type: 'text', text: 'Done: the login bug is fixed.' }]),
  'not json at all',
  J({ type: 'cost-state', totalCostUSD: 0.01 }),
].join('\n') + '\n';

function main(): void {
  assert.strictEqual(claudeProjectSlug('/tmp/durbar-t095-jNaX'), '-tmp-durbar-t095-jNaX', 'as observed on Claude Code 2.1.302');
  assert.strictEqual(claudeProjectSlug('C:\\Users\\a b\\x.y'), 'C--Users-a-b-x-y');

  // head: folder, title (commands and the interrupt marker are not prompts), start time, branch; a saved title wins
  const h = parseSessionHead(session);
  assert.deepStrictEqual(h, { cwd: WS, title: 'Fix the login bug in auth.ts', startTime: Date.parse('2026-10-19T10:00:00.000Z'), branch: 'main' });
  assert.strictEqual(parseSessionHead(J({ type: 'custom-title', customTitle: 'Login work' }) + '\n' + session).title, 'Login work');
  assert.strictEqual(parseSessionHead(user('x'.repeat(500))).title?.length, 120);
  assert.strictEqual(parseSessionHead(user('<system-reminder>hi</system-reminder>')).title, undefined);
  assert.deepStrictEqual(parseSessionHead(''), { title: undefined });
  assert.strictEqual(parseSessionHead(user('hi', { gitBranch: 'HEAD' })).branch, undefined, 'HEAD is not a branch name');

  // history: prompts, assistant text, tool calls with label and result (error flag), side-chain and markers skipped
  const hist = claudeHistoryFromText(session);
  assert.deepStrictEqual(hist.items.map((i) => i.type + ':' + (i.type === 'tool' ? `${i.tool}|${i.label}|${i.output}|${i.failed}` : i.text)), [
    'user:Fix the login bug in auth.ts',
    'output:Looking at it.',
    `tool:Read|${path.join(WS, 'auth.ts')}|export function login() {}|false`,
    'tool:Bash|npm test|1 failing|true',
    'output:Done: the login bug is fixed.',
  ]);
  const capped = claudeHistoryFromText(session, { maxItems: 2, maxTextChars: 5, maxToolOutputChars: 3 });
  assert.strictEqual(capped.total, 5);
  assert.ok(capped.truncated && capped.items.length === 2);
  assert.strictEqual(claudeHistoryFromText(user('abcdefghij'), { maxTextChars: 5 }).items[0].type === 'user' && (claudeHistoryFromText(user('abcdefghij'), { maxTextChars: 5 }).items[0] as { text: string }).text, 'abcde…');

  // listing from files: this folder only, newest first, excluded ids and bad names left out, untitled fallback
  fs.mkdirSync(dirOf(WS), { recursive: true });
  fs.writeFileSync(path.join(dirOf(WS), `${ID1}.jsonl`), session);
  fs.writeFileSync(path.join(dirOf(WS), `${ID2}.jsonl`), user('<only a command>') + '\n');
  fs.writeFileSync(path.join(dirOf(WS), `${ID3}.jsonl`), session.replace(new RegExp(JSON.stringify(WS).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), OTHER));
  fs.writeFileSync(path.join(dirOf(WS), 'not-a-session.txt'), 'x');
  fs.writeFileSync(path.join(dirOf(WS), 'bad id!.jsonl'), session);
  fs.writeFileSync(path.join(dirOf(WS), '44444444-4444-4444-8444-444444444444.jsonl'), '');
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(dirOf(WS), `${ID1}.jsonl`), now - 100, now - 100);
  fs.utimesSync(path.join(dirOf(WS), `${ID2}.jsonl`), now, now);
  const list = listClaudeSessions(WS, new Set(), CFG);
  assert.deepStrictEqual(list.map((s) => [s.id, s.title]), [[ID2, 'Untitled session'], [ID1, 'Fix the login bug in auth.ts']], 'newest first; another folder (ID3), bad names and empty files left out');
  assert.strictEqual(list[1].branch, 'main');
  assert.deepStrictEqual(listClaudeSessions(WS, new Set([ID2]), CFG).map((s) => s.id), [ID1], 'open sessions excluded');
  assert.deepStrictEqual(listClaudeSessions(OTHER, new Set(), CFG), [], 'no project folder: empty');
  // a head bigger than the read window: the prompt near the start is still found, the cut line is ignored
  const big = session + user('y'.repeat(HEAD_BYTES)) + '\n';
  fs.writeFileSync(path.join(dirOf(WS), `${ID1}.jsonl`), big);
  assert.strictEqual(listClaudeSessions(WS, new Set(), CFG).find((s) => s.id === ID1)?.title, 'Fix the login bug in auth.ts');

  // history from files: with the folder, and found by id when the folder is unknown
  fs.writeFileSync(path.join(dirOf(WS), `${ID1}.jsonl`), session);
  assert.strictEqual(readClaudeHistory(ID1, WS, CFG).items.length, 5);
  assert.strictEqual(readClaudeHistory(ID1, undefined, CFG).items.length, 5);
  assert.strictEqual(readClaudeHistory('../../etc/passwd', WS, CFG).items.length, 0, 'ids are checked: no path tricks');
  assert.strictEqual(readClaudeHistory('99999999-9999-4999-8999-999999999999', WS, CFG).items.length, 0);

  // the adapter: capability and members agree (FR-027), and it reads from its config folder
  void (async () => {
    const ad = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => undefined, configDir: CFG });
    assert.strictEqual(ad.capabilities.history, true);
    assert.deepStrictEqual((await ad.listPreviousSessions(WS)).map((s) => s.id).sort(), [ID1, ID2]);
    assert.strictEqual((await ad.history(ID1)).items.length, 5);
    for (const d of [CFG, WS, OTHER]) fs.rmSync(d, { recursive: true, force: true });
    console.log('claude history tests passed');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
main();
