/**
 * Spec 005 FR-018..FR-025: the edit payload of file-changing tool calls. Shared helpers (diffs, patches, partial JSON, masking,
 * caps) and the adapter normalizers of Claude Code, Copilot and Codex, from SDK typings and synthetic fixtures. No credits:
 * `npm run test:edits`.
 */
import * as assert from 'assert';
import { countDiff, editFile, finishEdit, partialJson, patchFiles, EDIT_FILES_MAX } from '../src/shared/edits';
import { DIFF_MAX } from '../src/shared/diff';
import { ArgStream, EditStreams, codexEdit, editOf, editPath, isEditTool, ARG_STREAM_MAX } from '../src/adapters/edits';
import { EventMapper } from '../src/adapters/map';
import type { EventBody } from '../src/adapters/map';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import { eventProblems } from '../src/adapters/eventguard';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

// 1. partialJson: complete JSON, open strings, dangling keys, cut escapes, nested arrays, garbage
{
  assert.deepStrictEqual(partialJson('{"a":"x"}'), { a: 'x' });
  assert.deepStrictEqual(partialJson('{"file_path":"/w/a.ts","old_string":"line 1\\nli'), { file_path: '/w/a.ts', old_string: 'line 1\nli' });
  assert.deepStrictEqual(partialJson('{"file_path":"/w/a.ts","old_'), { file_path: '/w/a.ts', old_: null });
  assert.deepStrictEqual(partialJson('{"file_path":"/w/a.ts",'), { file_path: '/w/a.ts' });
  assert.deepStrictEqual(partialJson('{"file_path":"/w/a.ts":'), undefined, 'malformed stays undefined');
  assert.deepStrictEqual(partialJson('{"a":"x","b":'), { a: 'x', b: null });
  assert.deepStrictEqual(partialJson('{"a":"tab\\'), { a: 'tab' }, 'a cut escape is dropped');
  assert.deepStrictEqual(partialJson('{"a":"\\u00'), { a: '' }, 'a cut unicode escape is dropped');
  assert.deepStrictEqual(partialJson('{"a":12'), { a: null }, 'a number that may still grow is not shown');
  assert.deepStrictEqual(partialJson('{"a":12,'), { a: 12 });
  assert.deepStrictEqual(partialJson('{"a":tr'), { a: null });
  assert.deepStrictEqual(partialJson('{"edits":[{"old_string":"a","new_string":"b"},{"old_string":"c'), { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c' }] });
  assert.deepStrictEqual(partialJson('[1, 2,'), [1, 2]);
  assert.strictEqual(partialJson('*** Begin Patch'), undefined, 'raw text is not JSON');
  assert.strictEqual(partialJson(''), undefined);
  // every prefix of a real argument object parses to something or undefined, never throws
  const full = JSON.stringify({ file_path: 'C:\\work\\a "b".ts', edits: [{ old_string: 'x\ny', new_string: 'é \u2028 "q"' }], n: -1.5e3, t: true, z: null });
  for (let i = 0; i <= full.length; i++) {
    const v = partialJson(full.slice(0, i));
    assert.ok(v === undefined || typeof v === 'object');
  }
  assert.deepStrictEqual(partialJson(full), JSON.parse(full));
  // linear time on a large value
  const big = '{"file_path":"/w/a","content":"' + 'abc\\n'.repeat(250_000);
  const t0 = Date.now();
  partialJson(big);
  assert.ok(Date.now() - t0 < 1500, 'a 1 MB prefix parses quickly');
}

// 2. diffs and counts
{
  const f = editFile('/w/a.ts', 'edit', 'a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.strictEqual(f.diff, '@@ -1,3 +1,4 @@\n a\n-b\n-c\n+B\n+c\n+d');
  assert.deepStrictEqual([f.added, f.removed], [3, 2]);
  const w = editFile('/w/n.ts', 'write', undefined, 'x\ny');
  assert.strictEqual(w.diff, '@@ -0,0 +1,2 @@\n+x\n+y');
  assert.deepStrictEqual(countDiff('--- a/x\n+++ b/x\n@@\n+a\n-b\n--- c'), { added: 1, removed: 2 }, 'a header is not counted, a removed "-- c" inside a hunk is');
  assert.strictEqual(editFile('/w/a', 'edit', 'same', 'same').diff, undefined, 'no change, no diff');
}

// 3. patches: the *** Begin Patch format and plain unified diffs
{
  const p = ['*** Begin Patch', '*** Update File: src/a.ts', '@@ function x', '-old', '+new', ' ctx', '*** Add File: src/b.ts', '+one', '+two', '*** Delete File: src/c.ts', '*** Update File: src/d.ts', '*** Move to: src/e.ts', '*** End Patch'].join('\n');
  const fs = patchFiles(p);
  assert.deepStrictEqual(fs.map((f) => [f.path, f.kind, f.added ?? 0, f.removed ?? 0, f.movedTo]), [['src/a.ts', 'edit', 1, 1, undefined], ['src/b.ts', 'create', 2, 0, undefined], ['src/c.ts', 'delete', 0, 0, undefined], ['src/d.ts', 'move', 0, 0, 'src/e.ts']]);
  assert.strictEqual(fs[1].diff, '@@\n+one\n+two', 'a body without @@ gets one');
  const u = patchFiles('diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n--- /dev/null\n+++ b/y.js\n@@ -0,0 +1 @@\n+y\n');
  assert.deepStrictEqual(u.map((f) => [f.path, f.kind, f.added, f.removed]), [['x.js', 'edit', 1, 1], ['y.js', 'create', 1, 0]]);
  assert.deepStrictEqual(patchFiles('*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y').map((f) => f.path), ['src/a.ts'], 'an unfinished patch gives the files so far');
  assert.deepStrictEqual(patchFiles('\r\n*** Begin Patch\r\n*** Add File: w.txt\r\n+a\r\n').map((f) => [f.path, f.diff]), [['w.txt', '@@\n+a']], 'CRLF patches');
}

// 4. finishEdit: masking, caps, bad input
{
  const e = finishEdit([{ path: `/w/${TOKEN}/a.ts`, kind: 'edit', diff: `@@\n+const k = "${TOKEN}";\n+Authorization: Bearer abcdefghijkl`, added: 2, removed: 0 }])!;
  assert.ok(!JSON.stringify(e).includes(TOKEN), 'paths and diffs are masked');
  assert.ok(!JSON.stringify(e).includes('abcdefghijkl'), 'a bearer header is masked');
  assert.ok(e.files[0].diff!.includes('[redacted]'));
  const many = finishEdit(Array.from({ length: 25 }, (_, i) => ({ path: `f${i}`, kind: 'edit' as const })))!;
  assert.strictEqual(many.files.length, EDIT_FILES_MAX);
  assert.strictEqual(many.more, 5);
  const huge = finishEdit([editFile('big.txt', 'write', undefined, 'line\n'.repeat(20_000))])!;
  assert.ok(huge.files[0].diff!.length <= DIFF_MAX + 60, 'a huge diff is cut');
  assert.ok(/more lines not shown$/.test(huge.files[0].diff!));
  assert.strictEqual(huge.files[0].added, 20_000, 'the counts are of the whole change');
  assert.strictEqual(finishEdit([]), undefined);
  assert.strictEqual(finishEdit([{ path: '  ', kind: 'edit' }]), undefined);
  assert.strictEqual(finishEdit([{ path: 'a\nb', kind: 'bogus' as never }])!.files[0].kind, 'edit');
  assert.strictEqual(finishEdit([{ path: 'a\nb', kind: 'edit' }])!.files[0].path, 'a b', 'no line breaks in a path');
  assert.strictEqual(finishEdit([{ path: 'a', kind: 'edit' }], true)!.partial, true);
}

// 5. Tool shapes per agent app
{
  assert.ok(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'edit', 'create', 'apply_patch', 'str_replace_editor'].every(isEditTool));
  assert.ok(!['Read', 'Bash', 'view', 'grep', 'github-create_issue', undefined].some(isEditTool));
  const claude = editOf('Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })!;
  assert.deepStrictEqual([claude.files[0].path, claude.files[0].kind, claude.files[0].added, claude.files[0].removed], ['/w/a.ts', 'edit', 1, 1]);
  const multi = editOf('MultiEdit', { file_path: '/w/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd\ne' }] })!;
  assert.deepStrictEqual([multi.files.length, multi.files[0].added, multi.files[0].removed], [1, 3, 2]);
  assert.strictEqual(editOf('Write', { file_path: '/w/n.md', content: '# T\n' })!.files[0].kind, 'write');
  assert.strictEqual(editOf('NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: 'x=1', edit_mode: 'insert' })!.files[0].added, 1);
  assert.strictEqual(editOf('create', { path: '/w/c.ts', file_text: 'a\nb' })!.files[0].kind, 'create');
  assert.strictEqual(editOf('edit', { path: '/w/e.ts', old_str: 'x', new_str: 'y' })!.files[0].removed, 1);
  assert.strictEqual(editOf('str_replace_editor', { command: 'view', path: '/w/v.ts' }), undefined, 'a view is no edit');
  assert.strictEqual(editOf('str_replace_editor', { command: 'create', path: '/w/v.ts', file_text: 'q' })!.files[0].kind, 'create');
  const patch = editOf('apply_patch', '*** Begin Patch\n*** Update File: a.py\n@@\n-x\n+y\n*** End Patch')!;
  assert.deepStrictEqual([patch.files[0].path, patch.files[0].added], ['a.py', 1], 'Copilot apply_patch: the argument is the patch string');
  assert.strictEqual(editOf('apply_patch', { input: '*** Begin Patch\n*** Add File: b.py\n+z\n*** End Patch' })!.files[0].kind, 'create');
  assert.strictEqual(editOf('Read', { file_path: '/w/a' }), undefined);
  assert.strictEqual(editOf('Edit', null), undefined);
  assert.strictEqual(editPath('Edit', { file_path: '/w/a.ts' }), '/w/a.ts');
  // Codex changes: kinds as objects (generated types) or strings (older notes); add as content
  const cx = codexEdit([{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' }, { path: 'n.ts', kind: { type: 'add' }, diff: 'one\ntwo\n' }, { path: 'o.ts', kind: { type: 'update', move_path: 'p.ts' }, diff: '' }, { path: 'd.ts', kind: 'delete', diff: 'gone\n' }])!;
  assert.deepStrictEqual(cx.files.map((f) => [f.path, f.kind, f.added ?? 0, f.removed ?? 0, f.movedTo]), [['a.ts', 'edit', 1, 1, undefined], ['n.ts', 'create', 2, 0, undefined], ['o.ts', 'move', 0, 0, 'p.ts'], ['d.ts', 'delete', 0, 1, undefined]]);
  assert.strictEqual(codexEdit('nope'), undefined);
}

// 6. ArgStream and EditStreams: path only when complete, parse on growth, caps
{
  const s = new ArgStream('Edit');
  s.append('{"file_path":"/w/sr');
  assert.strictEqual(s.path(), undefined, 'a half-written path is never shown');
  s.append('c/a.ts","old');
  assert.strictEqual(s.path(), '/w/src/a.ts');
  const raw = new ArgStream('apply_patch');
  raw.append('*** Begin Patch\n*** Update File: src/x.p');
  assert.strictEqual(raw.path(), undefined);
  raw.append('y\n@@');
  assert.strictEqual(raw.path(), 'src/x.py');
  const capped = new ArgStream('Write');
  capped.append('x'.repeat(ARG_STREAM_MAX + 10));
  assert.strictEqual(capped.length, ARG_STREAM_MAX, 'the stream is capped');
  assert.strictEqual(capped.append('more'), false);

  const es = new EditStreams();
  assert.deepStrictEqual(es.delta('b1', '{"command":"ls"}', 'bash'), [], 'other tools are not kept');
  assert.strictEqual(es.size, 0);
  const steps: string[] = [];
  const args = JSON.stringify({ file_path: '/w/a.ts', old_string: 'a\n'.repeat(400), new_string: 'b\n'.repeat(400) });
  for (let i = 0; i < args.length; i += 9) es.delta('c1', args.slice(i, i + 9), i === 0 ? 'Edit' : undefined).forEach((x) => steps.push(x.phase));
  assert.strictEqual(steps[0], 'start');
  assert.strictEqual(steps.filter((x) => x === 'start').length, 1);
  const updates = steps.filter((x) => x === 'update').length;
  assert.ok(updates >= 3 && updates < 40, `partial updates are throttled by growth (${updates})`);
  assert.strictEqual(es.takeStarted('c1'), true);
  assert.strictEqual(es.takeStarted('c1'), false);
  // a name that only arrives later (Copilot "when known")
  const late = new EditStreams();
  assert.deepStrictEqual(late.delta('k', '{"path":"/w/q.ts",'), []);
  const st = late.delta('k', '"old_str":"a","new_str":"b"}', 'edit');
  assert.deepStrictEqual(st.map((x) => x.phase), ['start', 'update']);
  const drop = new EditStreams();
  drop.delta('k', '{"command":"ls -la"', undefined);
  assert.deepStrictEqual(drop.delta('k', '}', 'bash'), []);
  assert.strictEqual(drop.size, 0, 'a call named by another tool is dropped');
  // bounded
  const many = new EditStreams();
  for (let i = 0; i < 500; i++) many.delta('id' + i, '{"file_path":"/w/' + i + '"', 'Write');
  assert.ok(many.size <= 32 * 5, `tables stay bounded (${many.size})`);
}

// 7. Copilot mapper: assistant.tool_call_delta starts the row early, tool.execution_start becomes an update
{
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  const json = JSON.stringify({ path: '/w/app.js', old_str: 'let a = 1;', new_str: `let a = 2;\nconst t = "${TOKEN}";` });
  for (let i = 0; i < json.length; i += 6) m.map({ type: 'assistant.tool_call_delta', data: { toolCallId: 'tc1', inputDelta: json.slice(i, i + 6), ...(i === 0 ? { toolName: 'edit' } : {}) } });
  m.map({ type: 'tool.execution_start', data: { toolCallId: 'tc1', toolName: 'edit', arguments: JSON.parse(json) } });
  m.map({ type: 'tool.execution_complete', data: { toolCallId: 'tc1', success: true, result: { content: 'ok' } } });
  const calls = out.filter((e) => e.type === 'toolCall') as Extract<EventBody, { type: 'toolCall' }>[];
  assert.deepStrictEqual(calls.map((e) => e.phase).filter((p, i, a) => p !== 'update' || a[i - 1] !== 'update'), ['start', 'update', 'complete'], 'one start, updates, one complete');
  assert.deepStrictEqual(calls[0].args, { path: '/w/app.js' });
  assert.ok(calls.some((e) => e.edit?.partial), 'partial updates while streaming');
  const fin = calls.filter((e) => e.phase === 'update').pop()!;
  assert.ok(fin.edit && !fin.edit.partial && fin.edit.files[0].added === 2, 'the whole call gives the final edit');
  assert.ok(!JSON.stringify(calls.map((c) => c.edit)).includes(TOKEN), 'diffs are masked');
  for (const e of calls) assert.deepStrictEqual(eventProblems({ ...e, sessionId: 's', timestamp: 1 }), [], 'event guard accepts the edit');
  // apply_patch as raw custom input, name in the first delta
  const out2: EventBody[] = [];
  const m2 = new EventMapper((b) => out2.push(b));
  const patch = '*** Begin Patch\n*** Update File: src/server.ts\n@@\n-a\n+b\n*** Add File: src/new.ts\n+x\n*** End Patch';
  for (let i = 0; i < patch.length; i += 5) m2.map({ type: 'assistant.tool_call_delta', data: { toolCallId: 'p1', toolName: 'apply_patch', inputDelta: patch.slice(i, i + 5) } });
  m2.map({ type: 'tool.execution_start', data: { toolCallId: 'p1', toolName: 'apply_patch', arguments: patch } });
  const c2 = out2.filter((e) => e.type === 'toolCall') as Extract<EventBody, { type: 'toolCall' }>[];
  assert.strictEqual(c2[0].phase, 'start');
  assert.deepStrictEqual(c2[0].args, { path: 'src/server.ts' });
  assert.deepStrictEqual(c2[c2.length - 1].edit!.files.map((f) => f.path), ['src/server.ts', 'src/new.ts']);
  // a call with no stream keeps the old shape and gets its edit at the start
  const out3: EventBody[] = [];
  const m3 = new EventMapper((b) => out3.push(b));
  m3.map({ type: 'tool.execution_start', data: { toolCallId: 'x', toolName: 'create', arguments: { path: '/w/c.md', file_text: 'hi' } } });
  m3.map({ type: 'tool.execution_start', data: { toolCallId: 'y', toolName: 'view', arguments: { path: '/w/c.md' } } });
  assert.deepStrictEqual(out3.map((e) => [e.type === 'toolCall' && e.phase, e.type === 'toolCall' && !!e.edit]), [['start', true], ['start', false]]);
  // MCP tool named like an edit tool: no edit
  const out4: EventBody[] = [];
  new EventMapper((b) => out4.push(b)).map({ type: 'tool.execution_start', data: { toolCallId: 'z', toolName: 'edit', mcpServerName: 'srv', arguments: { path: 'a', old_str: 'a', new_str: 'b' } } });
  assert.strictEqual((out4[0] as { edit?: unknown }).edit, undefined);
  // non-edit deltas emit nothing
  const out5: EventBody[] = [];
  const m5 = new EventMapper((b) => out5.push(b));
  m5.map({ type: 'assistant.tool_call_delta', data: { toolCallId: 'b', toolName: 'bash', inputDelta: '{"command":"ls"}' } });
  m5.map({ type: 'assistant.tool_call_delta', data: { toolCallId: 'b', inputDelta: 5 } });
  assert.deepStrictEqual(out5, []);
}

// 8. Claude mapper: a sub-agent's streamed Write keeps its agentId; a non-edit tool_use is not streamed
{
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b));
  const se = (event: unknown, parent: string | null = 'toolu_task') => ({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: 's' }) as never;
  m.map(se({ type: 'message_start', message: { id: 'm1' } }));
  m.map(se({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'w1', name: 'Write', input: {} } }));
  m.map(se({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'r1', name: 'Bash', input: {} } }));
  m.map(se({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } }));
  m.map(se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/w/n.md","content":"# Title\\n' } }));
  const tc = out.filter((e) => e.type === 'toolCall') as Extract<EventBody, { type: 'toolCall' }>[];
  assert.deepStrictEqual(tc.map((e) => [e.callId, e.phase, e.agentId]), [['w1', 'start', 'toolu_task'], ['w1', 'update', 'toolu_task']]);
  assert.strictEqual(tc[1].edit!.files[0].kind, 'write');
  assert.strictEqual(tc[0].tool, 'Write');
}

console.log('edits: ok');
