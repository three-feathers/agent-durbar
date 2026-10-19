/** Codex previous sessions, history replay and model list mappers (spec 012 FR-141, FR-142): `npm run test:codexhistory`. Shapes as Codex 0.163 sends them. */
import * as assert from 'assert';
import { codexHistory, codexModelOptions, codexPreviousSessions, MAX_ITEMS } from '../src/adapters/codexHistory';
import { codexModelFlag } from '../src/adapters/codex';

const t = (o: Record<string, unknown>): Record<string, unknown> => ({ id: 'thr_1', cwd: '/w/app', preview: 'Fix the parser', createdAt: 1792403230, updatedAt: 1792403238, gitInfo: { branch: 'main' }, ephemeral: false, parentThreadId: null, ...o });

// previous sessions: same folder only, newest first, seconds -> ms, name wins over preview, open ones and sub-agent threads left out
{
  const list = codexPreviousSessions([t({}), t({ id: 'thr_2', updatedAt: 1792403300, name: 'Release notes' }), t({ id: 'thr_3', cwd: '/w/other' }), t({ id: 'thr_4', parentThreadId: 'thr_1' }), t({ id: 'thr_5', ephemeral: true }), t({ id: 'open' }), t({ id: '../x' }), null, 'x'], '/w/app', new Set(['open']), 'linux');
  assert.deepStrictEqual(list.map((p) => p.id), ['thr_2', 'thr_1']);
  assert.strictEqual(list[0].title, 'Release notes');
  assert.strictEqual(list[1].title, 'Fix the parser');
  assert.strictEqual(list[1].modifiedTime, 1792403238000, 'seconds become ms');
  assert.strictEqual(list[1].branch, 'main');
  assert.strictEqual(codexPreviousSessions([t({ gitInfo: { branch: 'HEAD' } })], '/w/app', new Set(), 'linux')[0].branch, undefined);
  assert.deepStrictEqual(codexPreviousSessions(undefined, '/w/app'), []);
}
// history: prompts, answers, commands, file changes; unknown items skipped; capped
{
  const thread = { turns: [{ items: [
    { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Read note.txt' }] },
    { type: 'reasoning', id: 'r1', summary: [] },
    { type: 'commandExecution', id: 'c1', command: "sed -n '1p' note.txt", aggregatedOutput: 'pelican\n', status: 'completed' },
    { type: 'commandExecution', id: 'c2', command: 'rm x', status: 'declined' },
    { type: 'fileChange', id: 'f1', changes: [{ path: 'a.txt' }, { path: 'b.txt' }], status: 'completed' },
    { type: 'agentMessage', id: 'm1', text: 'pelican' },
    { type: 'agentMessage', id: 'm2', text: '   ' },
  ] }] };
  const h = codexHistory(thread);
  assert.deepStrictEqual(h.items.map((i) => [i.type, i.type === 'tool' ? `${i.tool} ${i.label}${i.failed ? ' failed' : ''}` : i.text]), [
    ['user', 'Read note.txt'], ['tool', "shell sed -n '1p' note.txt"], ['tool', 'shell rm x failed'], ['tool', 'edit a.txt, b.txt'], ['output', 'pelican'],
  ]);
  const many = codexHistory({ turns: [{ items: Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ type: 'agentMessage', text: 'm' + i })) }] });
  assert.strictEqual(many.items.length, MAX_ITEMS); assert.strictEqual(many.total, MAX_ITEMS + 5); assert.ok(many.truncated);
  const last = many.items[MAX_ITEMS - 1];
  assert.strictEqual(last.type === 'output' ? last.text : '', 'm' + (MAX_ITEMS + 4), 'the newest are kept');
  assert.deepStrictEqual(codexHistory(null).items, []);
}
// models: visible only, efforts and default from the list, Codex's default first
{
  const eff = (...e: string[]) => e.map((x) => ({ reasoningEffort: x, description: '' }));
  const ms = codexModelOptions([
    { id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', supportedReasoningEfforts: eff('low', 'medium'), defaultReasoningEffort: 'medium', isDefault: false, hidden: false },
    { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', supportedReasoningEfforts: eff('low', 'high', 'BAD EFFORT'), defaultReasoningEffort: 'low', isDefault: true, hidden: false },
    { id: 'secret', model: 'secret', displayName: 'Hidden', hidden: true },
    { model: 'bad id!' },
  ]);
  assert.deepStrictEqual(ms.map((m) => [m.id, m.name, m.efforts.join('/'), m.defaultEffort]), [['gpt-6.1-sol', 'GPT-6.1-Sol', 'low/high', 'low'], ['gpt-6-luna', 'GPT-6-Luna', 'low/medium', 'medium']]);
}
// only a Codex model id is sent with a turn
for (const ok of ['gpt-6.1-sol', 'gpt-5.6-luna', 'o4-mini', 'codex-mini']) assert.ok(codexModelFlag(ok), ok);
for (const no of [undefined, '', 'auto', 'default', 'haiku', 'claude-sonnet-5', 'gpt bad']) assert.ok(!codexModelFlag(no), String(no));
console.log('codex history tests passed');
