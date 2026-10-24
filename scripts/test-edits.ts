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
import { maskEditInfo, maskMcpEvent } from '../src/main/mcpmask';

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
  // review on #463: the kind says what the text is (spec 052 FR-172's rule, the same reader as the permission card), never a guess
  const md = codexEdit([{ path: 'notes.md', kind: { type: 'add' }, diff: '- first item\n- second item\n' }])!.files[0];
  assert.deepStrictEqual([md.kind, md.added, md.removed], ['create', 2, 0], 'a new file whose lines start with "- " is two added lines');
  assert.strictEqual(md.diff, '@@ -0,0 +1,2 @@\n+- first item\n+- second item');
  const ind = codexEdit([{ path: 'a.py', kind: { type: 'add' }, diff: '    x = 1\n    y = 2\n' }])!.files[0];
  assert.deepStrictEqual([ind.added, ind.removed], [2, 0], 'a new file whose lines are all indented is two added lines, not context');
  const gone = codexEdit([{ path: 'b.txt', kind: { type: 'delete' }, diff: '+plus\n@@ at\n' }])!.files[0];
  assert.deepStrictEqual([gone.added, gone.removed], [0, 2], 'a deleted file is all removed lines, whatever they start with');
  const upd = codexEdit([{ path: 'c.ts', kind: { type: 'update', move_path: null }, diff: '--- a/c.ts\n+++ b/c.ts\n@@ -1 +1 @@\n-a\n+b\n' }])!.files[0];
  assert.deepStrictEqual([upd.added, upd.removed, upd.diff], [1, 1, '@@ -1 +1 @@\n-a\n+b'], 'an update is a hunk; a header is dropped');
  assert.deepStrictEqual(codexEdit([{ path: 'e.ts', kind: { type: 'update', move_path: 'f.ts' }, diff: '' }])!.files[0], { path: 'e.ts', kind: 'move', movedTo: 'f.ts' });
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
  // review on #463: Copilot apply_patch as JSON starts once the File: line inside the string is complete
  const js = new ArgStream('apply_patch');
  js.append('{"input":"*** Begin Patch\\n*** Update File: src/');
  assert.strictEqual(js.path(), undefined, 'JSON patch: a half-written path line gives no start');
  js.append('a.js\\n@@');
  assert.strictEqual(js.path(), 'src/a.js', 'JSON patch: an escaped newline ends the path line');
  const jp = new ArgStream('apply_patch');
  jp.append('{"patch":"*** Begin Patch\\n*** Add File: b.js\\');
  assert.strictEqual(jp.path(), undefined, 'a cut escape is no newline yet');
  jp.append('n+x');
  assert.strictEqual(jp.path(), 'b.js', 'the `patch` key works too');
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
  // review on #463: apply_patch whose arguments are JSON ({input: patch}) streamed in small pieces starts early too
  const out6: EventBody[] = [];
  const m6 = new EventMapper((b) => out6.push(b));
  const jpatch = JSON.stringify({ input: '*** Begin Patch\n*** Update File: src/a.js\n@@\n-old\n+new\n*** End Patch' });
  let startedAt = -1;
  for (let i = 0; i < jpatch.length; i += 4) {
    m6.map({ type: 'assistant.tool_call_delta', data: { toolCallId: 'j1', inputDelta: jpatch.slice(i, i + 4), ...(i === 0 ? { toolName: 'apply_patch' } : {}) } });
    if (startedAt < 0 && out6.some((e) => e.type === 'toolCall')) startedAt = i + 4;
  }
  const c6 = out6.filter((e) => e.type === 'toolCall') as Extract<EventBody, { type: 'toolCall' }>[];
  assert.ok(startedAt > 0 && startedAt < jpatch.length, `JSON apply_patch starts before its arguments end (${startedAt}/${jpatch.length})`);
  assert.deepStrictEqual([c6[0].phase, c6[0].args], ['start', { path: 'src/a.js' }]);
  assert.ok(c6.some((e) => e.phase === 'update' && e.edit?.partial && e.edit.files[0].path === 'src/a.js'), 'partial updates stream for the JSON patch');
  m6.map({ type: 'tool.execution_start', data: { toolCallId: 'j1', toolName: 'apply_patch', arguments: JSON.parse(jpatch) } });
  const last6 = out6[out6.length - 1] as Extract<EventBody, { type: 'toolCall' }>;
  assert.deepStrictEqual([last6.phase, last6.edit!.files[0].added, last6.edit!.files[0].removed], ['update', 1, 1], 'execution_start of a started JSON patch is an update');
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

// 9. FR-027 (real Claude Code stream, T036): a partial edit whose new text has not started shows the file only
{
  const only = (e: ReturnType<typeof editOf>): void => {
    assert.ok(e && e.partial);
    assert.deepStrictEqual(e!.files, [{ path: '/tmp/d/notes.txt', kind: 'edit' }]);
  };
  only(editOf('Edit', { file_path: '/tmp/d/notes.txt', old_string: 'h' }, true));
  only(editOf('Edit', { file_path: '/tmp/d/notes.txt', old_string: 'hello', new_string: null }, true));
  only(editOf('edit', { path: '/tmp/d/notes.txt', old_str: 'hel' }, true));
  only(editOf('str_replace_editor', { command: 'str_replace', path: '/tmp/d/notes.txt', old_str: 'hel' }, true));
  only(editOf('MultiEdit', { file_path: '/tmp/d/notes.txt', edits: [{ old_string: 'hel' }] }, true));
  // an empty new text that has started is a real removal
  const del = editOf('Edit', { file_path: '/tmp/d/notes.txt', old_string: 'done', new_string: '' }, true)!;
  assert.deepStrictEqual([del.files[0].added, del.files[0].removed], [0, 1]);
  // the whole arguments (not partial) keep today's diff, even without new text
  assert.strictEqual(editOf('Edit', { file_path: '/tmp/d/notes.txt', old_string: 'x' })!.files[0].removed, 1);
  // replay of the real fragment sizes (16, 11, 14, 1, 12, ... characters) through EditStreams
  const args = JSON.stringify({ file_path: '/tmp/d/notes.txt', old_string: 'hello', new_string: 'hello world', replace_all: false });
  const st = new EditStreams();
  st.begin('c1', 'Edit');
  const steps: ReturnType<EditStreams['delta']> = [];
  for (let i = 0, k = 0, sizes = [16, 11, 14, 1, 12, 1, 19, 4, 19, 10]; i < args.length; i += sizes[k++ % sizes.length]) steps.push(...st.delta('c1', args.slice(i, i + sizes[k % sizes.length])));
  assert.strictEqual(steps.filter((x) => x.phase === 'start').length, 1);
  for (const u of steps) if (u.phase === 'update') assert.ok(!u.edit.files[0].diff || /\+hello world/.test(u.edit.files[0].diff), 'no diff before the new text');
}

// 10. FR-024: linear time on hostile streamed arguments (review on #463: quadratic regexes took up to 61 s in the main process).
// Each case took seconds with the old regexes (`/\s+$/` per open bracket, `(.+?)\s*$`, `/\n+$/`); linear code takes milliseconds.
// CPU time, not wall time, so a loaded parallel run does not flake; the bound is still far below the old cost.
{
  const BOUND_MS = 1500;
  const timed = (name: string, fn: () => unknown): void => {
    const w0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    fn();
    const c = process.cpuUsage(c0);
    const ms = (c.user + c.system) / 1000;
    const wall = Number(process.hrtime.bigint() - w0) / 1e6;
    assert.ok(ms < BOUND_MS, `${name} took ${ms} ms CPU (bound ${BOUND_MS} ms)`);
    assert.ok(wall < 20 * BOUND_MS, `${name}: ${wall} ms wall for ${ms} ms CPU (a blocking wait in the timed code?)`);
  };
  const N = 100_000;
  // a whitespace run inside an open value, then more structure: partialJson trims once
  timed('partialJson whitespace run', () => partialJson('{"a":[[[' + ' '.repeat(N) + '1,' + '[{"b":' + ' '.repeat(N)));
  timed('partialJson whitespace then many open brackets', () => partialJson('{"a":' + '['.repeat(2000) + ' '.repeat(N) + ',1 x'));
  // deep nesting: one closing suffix, not a rewrite of the whole text per bracket
  timed('partialJson deep nesting', () => partialJson('['.repeat(N)));
  timed('partialJson deep objects', () => partialJson('{"a":'.repeat(N / 2)));
  // a streamed Write whose content is a long run of spaces, through the whole stream path
  timed('EditStreams Write of spaces', () => {
    const st = new EditStreams();
    st.begin('w', 'Write');
    const args = '{"file_path":"/tmp/d/a.txt","content":"' + ' '.repeat(N) + 'x' + ' '.repeat(N);
    for (let i = 0; i < args.length; i += 4096) st.delta('w', args.slice(i, i + 4096));
  });
  // a Codex/plain diff whose `--- ` line ends in a long run of spaces followed by text (the lazy capture retried every position)
  timed('patchFiles long --- line', () => patchFiles('--- a/x.ts' + ' '.repeat(N) + 'y\n+++ b/x.ts\n@@\n+1\n'));
  timed('patchFiles long +++ line', () => patchFiles('--- a/x.ts\n+++ b/x.ts' + ' '.repeat(N) + 'y\n@@\n+1\n'));
  // many blank lines inside a diff body (the trailing-newline regex retried at each one)
  timed('codexEdit many blank lines', () => codexEdit([{ path: 'a.ts', kind: { type: 'update' }, diff: '@@\n+a' + '\n'.repeat(N) + '+b' }]));
  // the cut at REDACT_MAX_CHARS (1 MB) keeps a long run of blanks before the last word (the trailing-blank regex retried each one)
  timed('finishEdit blanks before the cut', () => finishEdit([{ path: 'a.ts', kind: 'write', diff: '@@\n+' + ' '.repeat(600_000) + 'x' + ' '.repeat(600_000) }]));
  // results stay right
  assert.deepStrictEqual(partialJson('{"a": [1, 2,   '), { a: [1, 2] });
  assert.deepStrictEqual(partialJson('{"a":   '), { a: null });
  assert.deepStrictEqual(partialJson('{"a":1,   '), { a: 1 });
  assert.deepStrictEqual(partialJson('[[1,[2,'), [[1, [2]]]);
  assert.deepStrictEqual(patchFiles('--- a/x.ts   \n+++ b/x.ts \t\n@@\n+1\n').map((f) => f.path), ['x.ts']);
  assert.strictEqual(codexEdit([{ path: 'a.ts', kind: { type: 'update' }, diff: '@@\n+a\n\n\n' }])!.files[0].diff, '@@\n+a');
}

// 11. The event guard rejects malformed edits (review on #463: it was only tested with good ones)
{
  const ev = (edit: unknown): string[] => eventProblems({ type: 'toolCall', sessionId: 's', timestamp: 1, callId: 'c', tool: 'Edit', phase: 'start', edit });
  const good = { files: [{ path: 'a.ts', kind: 'edit', diff: '@@\n+a', added: 1, removed: 0 }], more: 2 };
  assert.deepStrictEqual(ev(good), []);
  const bad = (edit: unknown, re: RegExp): void => {
    const p = ev(edit);
    assert.ok(p.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(p)}`);
  };
  bad({ files: [{ path: 'a.ts', kind: 'rename' }] }, /files\[0\]\.kind rename/);
  bad({ files: [{ kind: 'edit' }] }, /files\[0\]\.path missing/);
  bad({ files: [{ path: '', kind: 'edit' }] }, /files\[0\]\.path missing/);
  bad({ files: [{ path: 'a.ts', kind: 'edit', diff: 42 }] }, /files\[0\] malformed/);
  bad({ files: [{ path: 'a.ts', kind: 'edit', added: '1' }] }, /files\[0\] malformed/);
  bad({ files: [{ path: 'a.ts', kind: 'edit' }], more: '3' }, /more is not a number/);
  bad({ files: [] }, /has no files/);
  bad({}, /has no files/);
  bad({ files: [{ path: 'a.ts', kind: 'edit' }], partial: 'yes' }, /partial is not a boolean/);
}

// 12. review on #463: the early `start` (path only) is masked and kept on one line like the edit's own paths
{
  const st = new EditStreams();
  st.begin('m', 'Write');
  const steps = st.delta('m', JSON.stringify({ file_path: `/tmp/${TOKEN}/a\nb.txt`, content: 'x' }));
  const start = steps.find((x) => x.phase === 'start');
  assert.ok(start && start.phase === 'start');
  assert.ok(!start.args.path.includes(TOKEN) && /\[redacted/.test(start.args.path) && !start.args.path.includes('\n'), start.args.path);
}

// 13. review on #463 (vs #465 FR-030): main's `outward` masks an edit's paths and diffs with the session's MCP secret values too
{
  const HDR = 'hdr-Value"with\\quote-1234';
  const ev = { type: 'toolCall' as const, sessionId: 's', timestamp: 1, callId: 'c', tool: 'Write', phase: 'update' as const,
    edit: { files: [{ path: `/w/${HDR}.env`, kind: 'move' as const, movedTo: `/w/${HDR}.bak`, diff: `@@\n+X_API_KEY=${HDR}\n+t=${TOKEN}`, added: 2, removed: 0 }], partial: true } };
  const out = maskMcpEvent(ev, [HDR]);
  const f = out.edit!.files[0];
  for (const x of [f.path, f.movedTo!, f.diff!]) assert.ok(!x.includes(HDR) && x.includes('[redacted]'), x);
  assert.ok(!f.diff!.includes(TOKEN), 'redact() runs again');
  assert.deepStrictEqual([f.added, f.removed, f.kind, out.edit!.partial], [2, 0, 'move', true], 'the rest is kept');
  assert.ok(ev.edit.files[0].path.includes(HDR), 'the event itself is not changed');
  for (const p of ['start', 'complete', 'failed'] as const) assert.ok(!JSON.stringify(maskMcpEvent({ ...ev, phase: p }, [HDR])).includes(HDR), `phase ${p}`);
  assert.strictEqual(maskMcpEvent(ev, []), ev, 'no session values: the same object');
  assert.strictEqual(maskEditInfo(ev.edit, ['abc']), ev.edit, 'values under 4 characters are skipped');
  // cost: 20 files of 20,000 characters, the most one update carries, with several values: linear steps only.
  // Linearity against a baseline from the same run (20 files of 5,000 characters, a quarter of the input; the diff length is what a quadratic step would punish) in CPU time, with a generous floor; never a bare wall-clock bound.
  const vals = [HDR, 'another-secret-value', 'third-value-xyz'];
  const mkBig = (chars: number) => ({ files: Array.from({ length: 20 }, (_, i) => ({ path: `/w/${i}.ts`, kind: 'edit' as const, diff: '@@\n' + ('+a=1&b=2?c=3 ' + HDR + '\n').repeat(700).slice(0, chars) })) });
  const cpuMs = (f: () => void): number => { const c = process.cpuUsage(); f(); const d = process.cpuUsage(c); return (d.user + d.system) / 1000; };
  const small = mkBig(5000), big = mkBig(20000);
  maskEditInfo(small, vals); // warm the regexes
  const a = cpuMs(() => { for (let i = 0; i < 3; i++) maskEditInfo(small, vals); }) / 3;
  const b = cpuMs(() => { for (let i = 0; i < 3; i++) maskEditInfo(big, vals); }) / 3;
  assert.ok(b < Math.max(250, a * 10), `maskEditInfo is linear (100,000 -> 400,000 characters, 4x per diff: ${a} -> ${b} ms CPU)`); // 4x input; quadratic would be 16x and far above the floor
}

console.log('edits: ok');
