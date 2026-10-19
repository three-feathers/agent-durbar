/**
 * ClaudeAdapter (spec 012 FR-111, FR-112, T091) over the real CLI transport and a scripted fake `claude` child:
 * `npm run test:claudeadapter`. No claude, no account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter, PRE_TOOL_USE_HOOK, budgetText, claudeArgs, handoffArgs, oneShotArgs, parseHandoffOutput, claudeMdPrompt, claudeModelFlag, claudeModelOptions, mcpConfigOf, permissionLikeOf, userContentOf } from '../src/adapters/claude';
import { createCliTransport } from '../src/adapters/claudeTransport';
import type { AgentEvent } from '../src/adapters/types';
import { FakeClaudeChild, fakeSpawn } from './fakes/claude-cli';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick(2);
  }
}

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-claude-ws-'));

/** A fake child that answers initialize, and on each user message runs `turn(child, text)`. */
function scripted(turn: (c: FakeClaudeChild, text: string) => void | Promise<void>) {
  return (c: FakeClaudeChild): void => {
    c.onWrite = (o) => {
      if (o.type === 'control_request' && (o.request as { subtype: string }).subtype === 'initialize') {
        setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
      } else if (o.type === 'control_request' && (o.request as { subtype: string }).subtype === 'interrupt') {
        setTimeout(() => {
          c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } });
          c.send({ type: 'result', subtype: 'error_during_execution', is_error: true }); // what the real CLI sends after an interrupt (no aborted flag)
        }, 0);
      } else if (o.type === 'user') {
        const content = (o.message as { content: unknown }).content;
        const text = typeof content === 'string' ? content : ((content as Array<{ type: string; text?: string }>).find((b) => b.type === 'text')?.text ?? '');
        setTimeout(() => void turn(c, text), 0);
      }
    };
  };
}

const okTurn = (c: FakeClaudeChild): void => {
  c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, model: 'claude-haiku-5-5', permissionMode: 'default', tools: ['Read', 'Write'], mcp_servers: [] });
  c.send({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 2 } } });
  c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 2 } });
};

function make(opts: { turn?: (c: FakeClaudeChild, text: string) => void | Promise<void>; exists?: (id: string) => boolean; claudeMd?: string; claudePath?: string | undefined } = {}) {
  const sp = fakeSpawn();
  sp.next = scripted(opts.turn ?? okTurn);
  const ad = new ClaudeAdapter({
    claudePath: async () => ('claudePath' in opts ? opts.claudePath : '/usr/local/bin/claude'),
    makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }),
    sessionExists: opts.exists ?? (() => false),
    claudeMd: () => opts.claudeMd,
    readImage: () => Buffer.from('img'),
    env: () => ({ PATH: '/usr/bin' }),
  });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  return { ad, sp, events };
}
const statuses = (ev: AgentEvent[], sid: string): string[] => ev.filter((e) => e.sessionId === sid && e.type === 'status').map((e) => (e as { status: string }).status);

async function main(): Promise<void> {
  // ---- pure helpers ----
  {
    const ro = claudeArgs({ mode: 'read-only', sessionId: 'abc-123', resume: false });
    assert.deepStrictEqual(ro.slice(0, 9), ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--include-partial-messages']);
    const at = (a: string[], f: string) => a[a.indexOf(f) + 1];
    assert.strictEqual(at(ro, '--permission-mode'), 'dontAsk');
    assert.strictEqual(at(ro, '--allowedTools'), 'Read,Glob,Grep,NotebookRead,LS');
    assert.ok(at(ro, '--disallowedTools').includes('Bash') && at(ro, '--disallowedTools').includes('Write'));
    assert.strictEqual(at(ro, '--setting-sources'), '', 'no settings files (Q8)');
    assert.ok(ro.includes('--strict-mcp-config'));
    assert.ok(!ro.includes('--allow-dangerously-skip-permissions'));
    assert.deepStrictEqual(ro.slice(-2), ['--session-id', 'abc-123']);
    const ask = claudeArgs({ mode: 'ask', sessionId: 's', resume: true, model: 'claude-sonnet-5-5', mcpConfig: '{"mcpServers":{}}', appendSystemPrompt: 'P' });
    assert.strictEqual(at(ask, '--permission-mode'), 'default');
    assert.ok(!ask.includes('--allowedTools'), 'Ask first pre-approves no tool: every call reaches can_use_tool');
    assert.strictEqual(at(ask, '--model'), 'claude-sonnet-5-5');
    assert.strictEqual(at(ask, '--mcp-config'), '{"mcpServers":{}}');
    assert.strictEqual(at(ask, '--append-system-prompt'), 'P');
    assert.deepStrictEqual(ask.slice(-2), ['--resume', 's']);
    const all = claudeArgs({ mode: 'allow', sessionId: 's', resume: false, model: 'auto' });
    assert.strictEqual(at(all, '--permission-mode'), 'bypassPermissions');
    assert.ok(all.includes('--allow-dangerously-skip-permissions'));
    assert.ok(!all.includes('--model'), 'a Copilot model id is not passed');
    assert.strictEqual(at(claudeArgs({ mode: 'weird' as never, sessionId: 's', resume: false }), '--permission-mode'), 'dontAsk', 'unknown mode = Read-only');
    // FR-119: Claude ids, aliases and [1m] suffixes; auto/default = no flag; Copilot ids and odd strings dropped; effort only from the known set
    for (const m of ['fable', 'opus', 'sonnet[1m]', 'claude-haiku-5-5', 'claude-opus-5-5[1m]']) assert.strictEqual(at(claudeArgs({ mode: 'ask', sessionId: 's', resume: false, model: m }), '--model'), m, m);
    for (const m of ['auto', 'default', 'gpt-5.1', 'o3', 'gemini-3', 'sim-fast', '-rf', 'a b', 'x;y', 'x'.repeat(81), '']) assert.ok(!claudeModelFlag(m), m);
    assert.strictEqual(at(claudeArgs({ mode: 'ask', sessionId: 's', resume: false, model: 'opus', effort: 'xhigh' }), '--effort'), 'xhigh');
    assert.ok(!claudeArgs({ mode: 'ask', sessionId: 's', resume: false, effort: 'extreme' }).includes('--effort'));
    // FR-118: the initialize reply's models in the picker's shape
    assert.deepStrictEqual(claudeModelOptions([
      { value: 'default', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'high', 'bogus'] },
      { value: 'haiku', displayName: 'Haiku 5.5' },
      { value: 'haiku', displayName: 'dup' },
      { value: 'bad id', displayName: 'x' },
      { displayName: 'no value' },
      null,
      { value: 'fable', displayName: '   ' },
    ]), [
      { id: 'default', name: 'Default (recommended)', efforts: ['low', 'high'], disabled: false },
      { id: 'haiku', name: 'Haiku 5.5', efforts: [], disabled: false },
      { id: 'fable', name: 'fable', efforts: [], disabled: false },
    ]);
    assert.deepStrictEqual(claudeModelOptions(undefined), []);
  }
  {
    assert.deepStrictEqual(permissionLikeOf('Write', { file_path: '/w/a.txt', content: 'x' }, 'tu1'), { kind: 'write', toolName: 'Write', toolCallId: 'tu1', path: '/w/a.txt', fileName: '/w/a.txt' });
    assert.deepStrictEqual(permissionLikeOf('Bash', { command: 'rm -rf /tmp/x' }), { kind: 'shell', toolName: 'Bash', fullCommandText: 'rm -rf /tmp/x' });
    assert.deepStrictEqual(permissionLikeOf('WebFetch', { url: 'https://example.com' }), { kind: 'url', toolName: 'WebFetch', url: 'https://example.com' });
    assert.deepStrictEqual(permissionLikeOf('mcp__github__create_issue', {}), { kind: 'mcp', toolName: 'create_issue', serverName: 'github' });
    assert.strictEqual(permissionLikeOf('TodoWrite', {}).kind, 'custom-tool');
    assert.strictEqual(permissionLikeOf('Read', undefined).path, undefined, 'missing input: no path (the broker treats it as outside)');
  }
  {
    assert.strictEqual(mcpConfigOf(undefined), undefined);
    const cfg = JSON.parse(mcpConfigOf({ fs: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-fs'], env: { K: 'v' } }, web: { type: 'http', url: 'https://x/mcp', headers: { A: 'b' } }, off: { type: 'stdio', command: 'x' }, bad: { type: 'http' } as never }, ['off'])!);
    assert.deepStrictEqual(Object.keys(cfg.mcpServers), ['fs', 'web'], 'disabled and incomplete servers left out');
    assert.deepStrictEqual(cfg.mcpServers.fs, { type: 'stdio', command: 'npx', args: ['-y', 'mcp-fs'], env: { K: 'v' } });
  }
  {
    const files: Record<string, string> = {
      '/r/CLAUDE.md': 'Rules.\nSee @AGENTS.md and @docs/x.md and @../outside.md and @https://e.com and @~/home.md.\n```\n@AGENTS.md in a fence stays\n```\nEmail me@example.com',
      '/r/AGENTS.md': 'Agents file. Again @CLAUDE.md (cycle).',
      '/r/docs/x.md': 'Doc x.',
      '/outside.md': 'SECRET',
    };
    const io = { readFile: (p: string) => files[p], realpath: (p: string) => p };
    const out = claudeMdPrompt('/r', io, path.posix)!;
    assert.match(out, /^The folder's CLAUDE\.md/);
    assert.match(out, /Agents file\./);
    assert.match(out, /Doc x\./);
    assert.ok(!out.includes('SECRET'), 'an import outside the folder is not read');
    assert.ok(out.includes('@../outside.md') && out.includes('@https://e.com') && out.includes('@~/home.md'), 'refused imports stay as text');
    assert.ok(out.includes('@AGENTS.md in a fence stays'), 'code fences are not expanded');
    assert.strictEqual(out.match(/Rules\./g)!.length, 1, 'a cycle is read once');
    assert.strictEqual(claudeMdPrompt('/none', { readFile: () => undefined, realpath: (p) => p }, path.posix), undefined);
    const big = { readFile: (p: string) => (p === '/b/CLAUDE.md' ? 'x'.repeat(200_000) : undefined), realpath: (p: string) => p };
    assert.ok(claudeMdPrompt('/b', big, path.posix)!.length < 70_000, 'bounded');
  }
  {
    assert.strictEqual(userContentOf({ text: 'hi' }), 'hi');
    const c = userContentOf({ text: 'look', attachments: [{ path: '/a/shot.png', kind: 'image' }, { path: '/a/notes.txt', kind: 'file' }, { path: '/a/x.bmp', kind: 'image' }] }, () => Buffer.from('PNG'));
    assert.ok(Array.isArray(c));
    const blocks = c as Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>;
    assert.match(blocks[0].text!, /Attached files:\n- \/a\/notes\.txt/);
    assert.deepStrictEqual(blocks.slice(1).map((b) => b.source!.media_type), ['image/png'], 'unsupported image types are skipped');
    assert.strictEqual(blocks[1].source!.data, Buffer.from('PNG').toString('base64'));
  }

  // ---- lazy start: nothing spawns until the first message; then initialize with the hook, then the prompt ----
  {
    const { ad, sp, events } = make({ claudeMd: 'MD' });
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask' });
    assert.deepStrictEqual(statuses(events, sid), ['idle'], 'Ready');
    assert.strictEqual(sp.calls.length, 0, 'no process before the first message');
    await ad.send(sid, { text: 'hello' });
    await until('idle after the turn', () => statuses(events, sid).slice(-1)[0] === 'idle' && statuses(events, sid).length >= 3);
    const call = sp.calls[0];
    assert.strictEqual(call.file, '/usr/local/bin/claude');
    assert.strictEqual(call.shell, false);
    assert.strictEqual(call.cwd, fs.realpathSync(WS) === WS ? WS : call.cwd);
    assert.strictEqual(call.args[call.args.indexOf('--session-id') + 1], sid, 'a new session under the adapter id');
    assert.strictEqual(call.args[call.args.indexOf('--append-system-prompt') + 1], 'MD');
    const objs = sp.children[0].objects();
    assert.strictEqual(objs[0].type, 'control_request');
    assert.deepStrictEqual((objs[0].request as Record<string, unknown>), { subtype: 'initialize', hooks: { PreToolUse: [{ matcher: '*', hookCallbackIds: [PRE_TOOL_USE_HOOK] }] } });
    assert.strictEqual(objs[1].type, 'user', 'the prompt goes after initialize');
    assert.ok(events.some((e) => e.type === 'output' && (e as { text?: string }).text === 'ok'), 'mapped output (a complete message is final text)');
    assert.ok(events.some((e) => e.type === 'usage'), 'mapped usage');
    // a second message reuses the process
    await ad.send(sid, { text: 'again' });
    await tick(5);
    assert.strictEqual(sp.calls.length, 1);
    await ad.stop(sid);
    assert.strictEqual(statuses(events, sid).slice(-1)[0], 'stopped');
    assert.ok(sp.children[0].ended, 'stdin closed');
    assert.strictEqual(ad.isLive(sid), false);
  }

  // ---- resume: a given id that Claude has on disk resumes; an unknown one is created under that id ----
  {
    const { ad, sp } = make({ exists: (id) => id === 'old-session-1' });
    const a = await ad.start({ workspace: WS, sessionId: 'old-session-1', quiet: true });
    await ad.send(a, { text: 'x' });
    await until('spawn', () => sp.calls[0]);
    assert.deepStrictEqual(sp.calls[0].args.slice(-2), ['--resume', 'old-session-1']);
    const b = await ad.start({ workspace: WS, sessionId: 'new-session-2', quiet: true });
    await ad.send(b, { text: 'x' });
    await until('second spawn', () => sp.calls[1]);
    assert.deepStrictEqual(sp.calls[1].args.slice(-2), ['--session-id', 'new-session-2']);
    const c = await ad.start({ workspace: WS, resumeSessionId: 'picked-3', quiet: true });
    await ad.send(c, { text: 'x' });
    await until('third spawn', () => sp.calls[2]);
    assert.deepStrictEqual(sp.calls[2].args.slice(-2), ['--resume', 'picked-3'], 'an explicit resume always resumes');
    await ad.dispose();
  }

  // ---- Ask first: can_use_tool waits for the user; approve sends allow with the input; deny sends the broker's feedback ----
  {
    let answer: Record<string, unknown> | undefined;
    const { ad, events } = make({
      turn: (c) => {
        c.onWrite = ((prev) => (o: Record<string, unknown>) => {
          prev?.(o);
          if (o.type === 'control_response' && (o.response as { request_id: string }).request_id === 'cli-w') answer = (o.response as { response: Record<string, unknown> }).response;
        })(c.onWrite);
        c.send({ type: 'control_request', request_id: 'cli-w', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: path.join(WS, 'a.txt'), content: 'hi' }, tool_use_id: 'tu-1' } });
      },
    });
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'write it' });
    const pending = await until('pending permission', () => events.find((e) => e.type === 'status' && (e as { status: string }).status === 'needs-permission') as { permission: { requestId: string; kind: string } } | undefined);
    assert.strictEqual(pending.permission.kind, 'write');
    assert.strictEqual(pending.permission.requestId, 'tu-1', 'the request id is the tool_use id');
    assert.strictEqual(answer, undefined, 'nothing answered before the user decides');
    ad.resolvePermission(sid, 'tu-1', true);
    await until('allow answer', () => answer);
    assert.deepStrictEqual(answer, { behavior: 'allow', updatedInput: { file_path: path.join(WS, 'a.txt'), content: 'hi' }, toolUseID: 'tu-1' });
    await ad.stop(sid);
  }
  {
    let answer: Record<string, unknown> | undefined;
    const { ad } = make({
      turn: (c) => {
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') answer = (o.response as { response: Record<string, unknown> }).response;
        };
        c.send({ type: 'control_request', request_id: 'cli-b', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-2' } });
      },
    });
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'run' });
    await tick(20);
    ad.resolvePermission(sid, 'tu-2', false);
    await until('deny answer', () => answer);
    assert.deepStrictEqual(answer, { behavior: 'deny', message: 'Denied by user in Agent Durbar.', toolUseID: 'tu-2' });
    await ad.stop(sid);
  }

  // ---- Read-only: the PreToolUse hook denies a read outside the folder and allows one inside; can_use_tool denies at once ----
  {
    const answers: Record<string, Record<string, unknown>> = {};
    const { ad } = make({
      turn: (c) => {
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') {
            const r = o.response as { request_id: string; response: Record<string, unknown> };
            answers[r.request_id] = r.response;
          }
        };
        c.send({ type: 'control_request', request_id: 'h-in', request: { subtype: 'hook_callback', callback_id: PRE_TOOL_USE_HOOK, input: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(WS, 'README.md') } } } });
        c.send({ type: 'control_request', request_id: 'h-out', request: { subtype: 'hook_callback', callback_id: PRE_TOOL_USE_HOOK, input: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } } } });
        c.send({ type: 'control_request', request_id: 'h-other', request: { subtype: 'hook_callback', callback_id: 'someone_else', input: {} } });
        c.send({ type: 'control_request', request_id: 'c-w', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: path.join(WS, 'x') }, tool_use_id: 'tu-3' } });
        c.send({ type: 'control_request', request_id: 'c-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [] }, tool_use_id: 'tu-4' } });
        c.send({ type: 'control_request', request_id: 'e-1', request: { subtype: 'elicitation', mcp_server_name: 'x' } });
      },
    });
    const sid = await ad.start({ workspace: WS, quiet: true }); // no mode = Read-only
    await ad.send(sid, { text: 'look' });
    await until('six answers', () => Object.keys(answers).length >= 5 ? true : undefined);
    assert.deepStrictEqual(answers['h-in'], {}, 'a read inside: no opinion');
    assert.strictEqual((answers['h-out'].hookSpecificOutput as { permissionDecision: string }).permissionDecision, 'deny', 'a read outside the folder is denied by the hook');
    assert.deepStrictEqual(answers['h-other'], {}, 'unknown hook ids get no decision');
    assert.strictEqual(answers['c-w'].behavior, 'deny');
    assert.match(String(answers['c-w'].message), /read-only/);
    assert.strictEqual(answers['c-q'].behavior, 'deny', 'AskUserQuestion is denied with guidance (T052 gap)');
    await ad.stop(sid);
  }

  // ---- live mode switch (FR-115..FR-117): the hook uses launched + current mode; the next send relaunches with --resume ----
  {
    const answers: Record<string, Record<string, unknown>> = {};
    let cur: FakeClaudeChild | undefined;
    const { ad, sp, events } = make({
      turn: (c) => {
        cur = c;
        if ((c as unknown as { rec?: boolean }).rec) return;
        (c as unknown as { rec?: boolean }).rec = true;
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') {
            const r = o.response as { request_id: string; response: Record<string, unknown> };
            answers[r.request_id] = r.response;
          }
        };
      },
    });
    const hook = (id: string, tool: string, input: Record<string, unknown>, tu?: string): void =>
      cur!.send({ type: 'control_request', request_id: id, request: { subtype: 'hook_callback', callback_id: PRE_TOOL_USE_HOOK, input: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: tu } } });
    const decision = (id: string): string | undefined => (answers[id]?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;
    const endTurn = (): void => cur!.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 });
    const write = { file_path: path.join(WS, 'w.txt'), content: 'x' };

    const sid = await ad.start({ workspace: WS, permissionMode: 'allow', quiet: true });
    assert.strictEqual(ad.capabilities.permModeSwitch, 'live');
    await ad.send(sid, { text: 'go' });
    await until('turn', () => cur);
    assert.ok(sp.calls[0].args.includes('bypassPermissions'), 'launched in Allow all');
    hook('a1', 'Write', write);
    await until('a1', () => answers.a1);
    assert.deepStrictEqual(answers.a1, {}, 'Allow all: no opinion');
    // Allow all -> Read-only during the turn: the hook denies writes and outside reads at once
    assert.deepStrictEqual(ad.setPermMode(sid, 'read-only'), { pending: 0 });
    hook('a2', 'Write', write);
    hook('a3', 'Read', { file_path: '/etc/passwd' });
    hook('a4', 'Read', { file_path: path.join(WS, 'README.md') });
    await until('a2-a4', () => answers.a2 && answers.a3 && answers.a4);
    assert.strictEqual(decision('a2'), 'deny', 'a write is denied at once after switching to Read-only');
    assert.strictEqual(decision('a3'), 'deny');
    assert.deepStrictEqual(answers.a4, {}, 'a read inside is fine');
    // -> Ask first while launched in Allow all (bypassPermissions never calls can_use_tool): the hook asks through the broker
    ad.setPermMode(sid, 'ask');
    hook('a5', 'Write', write, 'tu-a5');
    const p5 = await until('card a5', () => events.find((e) => e.type === 'status' && (e as { status: string }).status === 'needs-permission' && (e as { permission?: { requestId: string } }).permission?.requestId === 'tu-a5'));
    assert.ok(p5);
    assert.strictEqual(answers.a5, undefined, 'the hook waits for the user');
    ad.resolvePermission(sid, 'tu-a5', true);
    await until('a5', () => answers.a5);
    assert.deepStrictEqual(answers.a5, {}, 'approved: the CLI goes on');
    hook('a6', 'Bash', { command: 'rm -rf x' }, 'tu-a6');
    await until('card a6', () => events.find((e) => (e as { permission?: { requestId: string; state?: string } }).permission?.requestId === 'tu-a6'));
    ad.resolvePermission(sid, 'tu-a6', false);
    await until('a6', () => answers.a6);
    assert.strictEqual(decision('a6'), 'deny', 'denied by the user: the hook denies');
    // a message while the turn is open does not relaunch
    await ad.send(sid, { text: 'more' });
    assert.strictEqual(sp.calls.length, 1, 'no relaunch in the middle of a turn');
    endTurn();
    await tick(10);
    // the next message relaunches with the Ask first flags and --resume, same id
    await ad.send(sid, { text: 'next' });
    await until('relaunch', () => sp.calls.length === 2 ? true : undefined);
    assert.ok(sp.children[0].ended || sp.children[0].killed.length, 'the old process was closed');
    const args = sp.calls[1].args;
    assert.ok(args.includes('--resume') && args.includes(sid), 'resumes the same session');
    assert.ok(!args.includes('bypassPermissions') && args.includes('default'), 'launched with the Ask first mode');
    assert.ok(!statuses(events, sid).includes('error'), 'the relaunch is not an error');
    // now launched = current = ask: the hook has no opinion, can_use_tool asks
    await until('new child turn', () => (cur === sp.children[1] ? true : undefined));
    hook('a7', 'Write', write, 'tu-a7');
    await until('a7', () => answers.a7);
    assert.deepStrictEqual(answers.a7, {});
    endTurn();
    await ad.stop(sid);
  }
  {
    // launched Read-only, switched to Allow all mid-turn: still denied (with a "next message" reason) until the relaunch
    const answers: Record<string, Record<string, unknown>> = {};
    let cur: FakeClaudeChild | undefined;
    const { ad, sp } = make({
      turn: (c) => {
        cur = c;
        if ((c as unknown as { rec?: boolean }).rec) return;
        (c as unknown as { rec?: boolean }).rec = true;
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') {
            const r = o.response as { request_id: string; response: Record<string, unknown> };
            answers[r.request_id] = r.response;
          }
        };
      },
    });
    const sid = await ad.start({ workspace: WS, quiet: true });
    await ad.send(sid, { text: 'go' });
    await until('turn', () => cur);
    ad.setPermMode(sid, 'allow');
    cur!.send({ type: 'control_request', request_id: 'r1', request: { subtype: 'hook_callback', callback_id: PRE_TOOL_USE_HOOK, input: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } } } });
    await until('r1', () => answers.r1);
    const out = answers.r1.hookSpecificOutput as { permissionDecision: string; permissionDecisionReason: string };
    assert.strictEqual(out.permissionDecision, 'deny', 'launched Read-only: outside reads stay denied until the relaunch');
    assert.match(out.permissionDecisionReason, /next message/);
    cur!.send({ type: 'result', subtype: 'success', is_error: false });
    await tick(10);
    await ad.send(sid, { text: 'now' });
    await until('relaunch', () => sp.calls.length === 2 ? true : undefined);
    assert.ok(sp.calls[1].args.includes('bypassPermissions'), 'relaunched in Allow all');
    await ad.stop(sid);
  }
  {
    // switching with pending requests: Allow all approves them (approvePending), Read-only denies them
    const answers: Record<string, Record<string, unknown>> = {};
    const { ad } = make({
      turn: (c) => {
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') {
            const r = o.response as { request_id: string; response: Record<string, unknown> };
            answers[r.request_id] = r.response;
          }
        };
        c.send({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: path.join(WS, 'p.txt') }, tool_use_id: 'tu-p1' } });
      },
    });
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'go' });
    await tick(20);
    assert.deepStrictEqual(ad.setPermMode(sid, 'allow', { approvePending: true }), { pending: 0 });
    await until('p1', () => answers.p1);
    assert.strictEqual(answers.p1.behavior, 'allow');
    await ad.stop(sid);
  }
  assert.deepStrictEqual(new ClaudeAdapter({ claudePath: async () => undefined }).setPermMode('nope', 'allow'), { pending: 0 });
  // ---- model list (FR-118): an initialize-only probe, no prompt, closed, cached; a failure is an empty list ----
  {
    const sp = fakeSpawn();
    let probes = 0;
    sp.next = (c) => {
      probes++;
      c.onWrite = (o) => {
        if (o.type === 'control_request' && (o.request as { subtype: string }).subtype === 'initialize')
          setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { models: [{ value: 'sonnet', displayName: 'Sonnet', supportedEffortLevels: ['high'] }], account: { email: 'never@read' } } } }), 0);
      };
    };
    const ad = new ClaudeAdapter({ claudePath: async () => '/usr/bin/claude', makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }), env: () => ({}) });
    const list = await ad.listModelOptions();
    assert.deepStrictEqual(list, [{ id: 'sonnet', name: 'Sonnet', efforts: ['high'], disabled: false }]);
    assert.strictEqual(sp.calls[0].args[sp.calls[0].args.indexOf('--permission-mode') + 1], 'dontAsk', 'the probe runs in Read-only');
    assert.strictEqual(sp.calls[0].cwd, os.tmpdir(), 'in the temp folder, not a user folder');
    assert.ok(!sp.children[0].objects().some((o) => o.type === 'user'), 'no prompt is written: no tokens');
    await until('probe closed', () => (sp.children[0].ended || sp.children[0].killed.length ? true : undefined));
    await ad.listModelOptions();
    assert.strictEqual(probes, 1, 'cached');
    const none = new ClaudeAdapter({ claudePath: async () => undefined });
    assert.deepStrictEqual(await none.listModelOptions(), [], 'no claude: empty list');
    const sp2 = fakeSpawn();
    sp2.next = (c) => { c.onWrite = () => setTimeout(() => c.exit(1, null), 0); };
    const broken = new ClaudeAdapter({ claudePath: async () => '/usr/bin/claude', makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp2.spawn, closeGraceMs: 10, killGraceMs: 10 }), env: () => ({}) });
    assert.deepStrictEqual(await broken.listModelOptions(), [], 'a CLI that exits: empty list, no throw');
    assert.strictEqual(ad.capabilities.models, true);
    assert.strictEqual(ad.capabilities.effort, true);
  }

  // ---- questions (FR-128, FR-129): the hook asks the user and answers with updatedInput.answers; skip = deny; Stop cancels ----
  {
    const { parseQuestions, cleanAnswers } = await import('../src/adapters/questions');
    const qs = parseQuestions({ questions: [{ question: '  Which   colour? ', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: '' }, 'x', { label: 'Blue' }] }, { question: '' }, { question: 'Q2', options: new Array(9).fill({ label: 'o' }), multiSelect: true }, { question: 'Q3' }, { question: 'Q4' }, { question: 'Q5' }] });
    assert.strictEqual(qs.length, 4, 'at most 4 questions, empty ones dropped');
    assert.deepStrictEqual(qs[0], { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] });
    assert.strictEqual(qs[1].options.length, 6, 'at most 6 options');
    assert.deepStrictEqual(cleanAnswers(qs, { 'Which colour?': '  Blue ', unknown: 'x', Q2: 5 }), { 'Which colour?': 'Blue' });
    assert.strictEqual(cleanAnswers(qs, { 'Which colour?': '   ' }), undefined);
    assert.deepStrictEqual(parseQuestions(null), []);

    const answers: Record<string, Record<string, unknown>> = {};
    let cur: FakeClaudeChild | undefined;
    const { ad, events } = make({
      turn: (c) => {
        cur = c;
        if ((c as unknown as { rec?: boolean }).rec) return;
        (c as unknown as { rec?: boolean }).rec = true;
        const prev = c.onWrite;
        c.onWrite = (o) => {
          prev?.(o);
          if (o.type === 'control_response') {
            const r = o.response as { request_id: string; response: Record<string, unknown> };
            answers[r.request_id] = r.response;
          }
        };
      },
    });
    const ask = (rid: string, tu: string): void =>
      cur!.send({ type: 'control_request', request_id: rid, request: { subtype: 'hook_callback', callback_id: PRE_TOOL_USE_HOOK, input: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: tu, tool_input: { questions: [{ question: 'Which  colour?', header: 'C', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] } } } });
    const sid = await ad.start({ workspace: WS, quiet: true }); // Read-only: a question is still allowed
    await ad.send(sid, { text: 'go' });
    await until('turn', () => cur);
    ask('q1', 'tu-q1');
    const asked = await until('asked', () => events.find((e) => e.type === 'question' && (e as { phase: string }).phase === 'asked') as { requestId: string; questions: { question: string }[] } | undefined);
    assert.strictEqual(asked.requestId, 'tu-q1');
    assert.strictEqual(asked.questions[0].question, 'Which colour?', 'cleaned for the UI');
    assert.ok(events.some((e) => e.type === 'status' && (e as { intent?: string }).intent === 'Waiting for your answer'));
    assert.strictEqual(answers.q1, undefined, 'the hook waits for the user');
    ad.answerQuestion(sid, 'tu-q1', { 'Which colour?': 'Blue' });
    await until('q1 answer', () => answers.q1);
    const out = (answers.q1 as Record<string, unknown>).hookSpecificOutput as { permissionDecision: string; updatedInput: { answers: Record<string, string>; questions: unknown[] } };
    assert.strictEqual(out.permissionDecision, 'allow');
    assert.deepStrictEqual(out.updatedInput.answers, { 'Which  colour?': 'Blue' }, "keyed by Claude's own question text");
    assert.ok(Array.isArray(out.updatedInput.questions), 'the rest of the input is kept');
    assert.ok(events.some((e) => e.type === 'question' && (e as { phase: string }).phase === 'answered'));
    // skip
    ask('q2', 'tu-q2');
    await until('asked 2', () => events.find((e) => e.type === 'question' && (e as { requestId?: string }).requestId === 'tu-q2'));
    ad.answerQuestion(sid, 'tu-q2', null);
    await until('q2 answer', () => answers.q2);
    assert.strictEqual((answers.q2.hookSpecificOutput as { permissionDecision: string }).permissionDecision, 'deny');
    // Stop while a question is open: answered deny, cancelled event
    ask('q3', 'tu-q3');
    await until('asked 3', () => events.find((e) => e.type === 'question' && (e as { requestId?: string }).requestId === 'tu-q3'));
    await ad.interrupt(sid);
    await until('q3 answer', () => answers.q3);
    assert.strictEqual((answers.q3.hookSpecificOutput as { permissionDecision: string }).permissionDecision, 'deny');
    assert.ok(events.some((e) => e.type === 'question' && (e as { requestId?: string; phase: string }).requestId === 'tu-q3' && (e as { phase: string }).phase === 'cancelled'));
    // can_use_tool fallback asks too; an input that already has answers is allowed as it is
    cur!.send({ type: 'control_request', request_id: 'c1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }], answers: { 'Q?': 'A' } }, tool_use_id: 'tu-c1' } });
    await until('c1', () => answers.c1);
    assert.strictEqual(answers.c1.behavior, 'allow');
    ad.answerQuestion(sid, 'nope', { x: 'y' }); // unknown ids are ignored
    await ad.stop(sid);
  }

  // ---- MCP toggle (FR-133): mcp_toggle then mcp_status; kept for relaunches; a launch-disabled server comes back with a relaunch ----
  {
    const sp = fakeSpawn();
    const toggles: Record<string, unknown>[] = [];
    let servers = [{ name: 'notes', status: 'connected' }, { name: 'web', status: 'connected' }];
    sp.next = (c) => {
      c.onWrite = (o) => {
        if (o.type !== 'control_request') {
          if (o.type === 'user') setTimeout(() => { c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, tools: [], mcp_servers: servers }); c.send({ type: 'result', subtype: 'success', is_error: false }); }, 0);
          return;
        }
        const r = o.request as { subtype: string; serverName?: string; enabled?: boolean };
        let response: Record<string, unknown> = {};
        if (r.subtype === 'mcp_toggle') {
          toggles.push(r);
          servers = servers.map((s) => (s.name === r.serverName ? { ...s, status: r.enabled ? 'connected' : 'disabled' } : s));
        }
        if (r.subtype === 'mcp_status') response = { mcpServers: servers };
        setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response } }), 0);
      };
    };
    const ad = new ClaudeAdapter({ claudePath: async () => '/usr/bin/claude', makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) });
    const ev: AgentEvent[] = [];
    ad.onEvent((e) => ev.push(e));
    const mcp = { notes: { type: 'stdio', command: 'node', args: ['n.js'] }, web: { type: 'stdio', command: 'node', args: ['w.js'] } } as never;
    const sid = await ad.start({ workspace: WS, quiet: true, mcpServers: mcp });
    assert.strictEqual(ad.capabilities.mcpToggle, true);
    await ad.setMcpEnabled(sid, 'web', false); // not running yet: only recorded
    assert.strictEqual(sp.calls.length, 0, 'no process for a recorded switch');
    await ad.send(sid, { text: 'hi' });
    await until('first launch', () => (sp.calls.length === 1 ? true : undefined));
    const cfg = (args: string[]): string => args[args.indexOf('--mcp-config') + 1];
    assert.ok(cfg(sp.calls[0].args).includes('notes') && !cfg(sp.calls[0].args).includes('w.js'), 'a recorded switch is in the launch config');
    await until('idle', () => ev.some((e) => e.type === 'status' && (e as { status: string }).status === 'idle'));
    await ad.setMcpEnabled(sid, 'notes', false);
    assert.deepStrictEqual(toggles, [{ subtype: 'mcp_toggle', serverName: 'notes', enabled: false }]);
    const last = [...ev].reverse().find((e) => e.type === 'mcp') as { servers: { name: string; status: string }[] };
    assert.deepStrictEqual(last.servers.find((s) => s.name === 'notes')?.status, 'disabled', 'the new list from mcp_status');
    // web was left out at launch: switching it on cannot go through mcp_toggle; the next message relaunches with it
    await ad.setMcpEnabled(sid, 'web', true);
    assert.strictEqual(toggles.length, 1, 'no mcp_toggle for a server the CLI does not know');
    await ad.send(sid, { text: 'again' });
    await until('relaunch', () => (sp.calls.length === 2 ? true : undefined));
    assert.ok(cfg(sp.calls[1].args).includes('w.js') && !cfg(sp.calls[1].args).includes('n.js'), 'relaunched with web on and notes off');
    await ad.stop(sid);
  }

  // ---- custom agents (spec 043 FR-008): chosen before the first message, passed on the first launch; a started session refuses ----
  {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cagent-cfg-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cagent-ws-'));
    fs.mkdirSync(path.join(ws, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.claude', 'agents', 'pirate.md'), '---\nname: pirate\ndescription: Arr\n---\nYou are a pirate.');
    const sp = fakeSpawn();
    sp.next = scripted(okTurn);
    const ad = new ClaudeAdapter({ claudePath: async () => '/usr/bin/claude', configDir: cfg, makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) });
    const sid = await ad.start({ workspace: ws, quiet: true });
    assert.deepStrictEqual((await ad.listAgentProfiles(sid)).map((p) => [p.id, p.source]), [['pirate', 'repo']]);
    assert.strictEqual((await ad.selectAgentProfile(sid, 'pirate'))?.id, 'pirate');
    await ad.send(sid, { text: 'hi' });
    await until('launch', () => (sp.calls.length === 1 ? true : undefined));
    const args = sp.calls[0].args;
    assert.strictEqual(args[args.indexOf('--agent') + 1], 'pirate', 'the first launch starts with the agent');
    assert.strictEqual(JSON.parse(args[args.indexOf('--agents') + 1]).pirate.prompt, 'You are a pirate.');
    await assert.rejects(ad.selectAgentProfile(sid, null), /sets the agent when a session starts/, 'a started session refuses (Claude ignores --agent on --resume)');
    await ad.stop(sid);
    fs.rmSync(cfg, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }

  // ---- interrupt: pending permissions denied, the interrupt request sent, Aborted ----
  {
    const { ad, sp, events } = make({ turn: (c) => c.send({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: {}, tool_use_id: 'tu-9' } }) });
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'go' });
    await until('pending', () => events.find((e) => e.type === 'status' && (e as { status: string }).status === 'needs-permission'));
    await ad.interrupt(sid);
    const objs = sp.children[0].objects();
    assert.ok(objs.some((o) => o.type === 'control_request' && (o.request as { subtype: string }).subtype === 'interrupt'));
    await until('deny for the pending one', () => sp.children[0].objects().find((o) => o.type === 'control_response' && (o.response as { request_id: string }).request_id === 'p1'));
    assert.ok(events.some((e) => e.type === 'status' && (e as { intent?: string }).intent === 'Aborted'));
    await tick(10);
    assert.ok(!statuses(events, sid).includes('error'), 'the closing error_during_execution of an interrupt is not an error (real run, T094)');
    await ad.stop(sid);
  }

  // ---- crash: an unexpected exit is an error for that session only; the next message starts it again with --resume ----
  {
    const { ad, sp, events } = make({ turn: (c) => c.exit(1, null) });
    const sid = await ad.start({ workspace: WS, quiet: true });
    await ad.send(sid, { text: 'boom' });
    await until('error status', () => statuses(events, sid).includes('error'));
    assert.ok(ad.isLive(sid), 'the session stays');
    sp.next = scripted(okTurn);
    await ad.send(sid, { text: 'again' });
    await until('second spawn', () => sp.calls[1]);
    assert.deepStrictEqual(sp.calls[1].args.slice(-2), ['--resume', sid], 'resumes after a crash');
    await ad.stop(sid);
  }

  // ---- FR-150: a dollar cap on Claude's estimate: the CLI budget, the limit notice, the held message ----
  {
    assert.strictEqual(budgetText(0.5), '0.5');
    assert.strictEqual(budgetText(0.123456), '0.1235');
    assert.strictEqual(budgetText(-1), '0.0001', 'nothing left: Claude stops at once');
    assert.strictEqual(budgetText(1e-7), '0.0001', 'never an exponent');
    const at = (a: string[], f: string) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
    assert.strictEqual(at(claudeArgs({ mode: 'read-only', sessionId: 's', resume: false }), '--max-budget-usd'), undefined, 'no cap, no flag');
    const capped = claudeArgs({ mode: 'read-only', sessionId: 's', resume: true, maxBudgetUsd: 0.25 });
    assert.strictEqual(at(capped, '--max-budget-usd'), '0.25');
    assert.deepStrictEqual(capped.slice(-2), ['--resume', 's'], 'the session flag stays last');
    assert.strictEqual(new ClaudeAdapter({ claudePath: async () => undefined }).capabilities.capUnit, 'usd');

    const costOf = (c: FakeClaudeChild): number => (c as unknown as { cost?: number }).cost ?? 0;
    const costTurn = (c: FakeClaudeChild, text: string): void => {
      const cost = costOf(c) + 0.004; // a running total per CLI process, like streaming mode
      (c as unknown as { cost?: number }).cost = cost;
      c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, model: 'claude-haiku-5-5', permissionMode: 'default', tools: [], mcp_servers: [] });
      c.send({ type: 'assistant', message: { id: 'm-' + text, role: 'assistant', content: [{ type: 'text', text: 'ok ' + text }], usage: { input_tokens: 10, output_tokens: 2 } } });
      c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost, usage: { input_tokens: 10, output_tokens: 2 } });
    };
    const { ad, sp, events } = make({ turn: costTurn });
    const limits = (sid: string) => events.filter((e) => e.sessionId === sid && e.type === 'limit') as Array<AgentEvent & { phase: string; requestId?: string; maxAiCredits?: number | null; usedAiCredits?: number; action?: string }>;
    const sid = await ad.start({ workspace: WS, quiet: true, maxAiCredits: 0.01 });
    await ad.send(sid, { text: 'one' });
    await until('first result', () => statuses(events, sid).includes('idle'));
    assert.strictEqual(at(sp.calls[0].args, '--max-budget-usd'), '0.01', 'the whole cap on the first launch');
    assert.strictEqual(limits(sid).length, 0, '$0.004 of $0.01: no limit yet');
    await ad.send(sid, { text: 'two' });
    await until('second result', () => statuses(events, sid).filter((x) => x === 'idle').length >= 2);
    await ad.send(sid, { text: 'three' });
    const ex = await until('limit exhausted', () => limits(sid).find((e) => e.phase === 'exhausted'));
    assert.strictEqual(ex.maxAiCredits, 0.01);
    assert.ok(Math.abs((ex.usedAiCredits ?? 0) - 0.012) < 1e-9, 'used = the estimate so far');
    await ad.send(sid, { text: 'four' });
    await tick(20);
    assert.strictEqual(limits(sid).filter((e) => e.phase === 'exhausted').length, 1, 'one notice per stop, a further message is held too');
    const turnsBefore = events.filter((e) => e.sessionId === sid && e.type === 'output').length;
    await ad.resolveLimit(sid, 'not-the-id', { kind: 'unset' });
    assert.strictEqual(limits(sid).filter((e) => e.phase === 'resolved').length, 0, 'an unknown request id is ignored');
    // add $0.01: $0.01 more than the $0.012 used (rounded up to the cent: $0.03), the held message goes out on a relaunch with what is left
    await ad.resolveLimit(sid, ex.requestId!, { kind: 'add', credits: 0.01 });
    const ch = limits(sid).filter((e) => e.phase === 'changed').pop()!;
    assert.strictEqual(ch.maxAiCredits, 0.03, 'add counts from the spend when it passed the cap');
    assert.strictEqual(limits(sid).find((e) => e.phase === 'resolved')?.action, 'add');
    await until('relaunch', () => sp.calls[1]);
    assert.strictEqual(at(sp.calls[1].args, '--max-budget-usd'), '0.018', 'the relaunch gets the rest of the cap');
    await until('held message answered', () => events.filter((e) => e.sessionId === sid && e.type === 'output').length > turnsBefore);
    // Claude's own budget stop is the limit notice, not an error
    sp.children[1].send({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: costOf(sp.children[1]) });
    const ex2 = await until('second notice', () => limits(sid).filter((e) => e.phase === 'exhausted')[1]);
    assert.ok(!events.some((e) => e.sessionId === sid && e.type === 'status' && (e as { status: string; intent?: string }).status === 'error' && /budget/.test((e as { intent?: string }).intent ?? '')), 'no error card for the budget stop');
    // Stop here: the message is dropped, the cap stays
    await ad.resolveLimit(sid, ex2.requestId!, { kind: 'cancel' });
    assert.strictEqual(limits(sid).filter((e) => e.phase === 'resolved').pop()?.action, 'cancel');
    // a higher cap from the chip releases nothing (no held message) and the next message goes out
    await ad.setCap(sid, 1);
    assert.strictEqual(limits(sid).filter((e) => e.phase === 'changed').pop()?.maxAiCredits, 1);
    await assert.rejects(ad.setCap(sid, 0.001), /Invalid cost cap/);
    await ad.setCap(sid, null);
    assert.strictEqual(limits(sid).filter((e) => e.phase === 'changed').pop()?.maxAiCredits, null);
    const n = sp.calls.length;
    await ad.send(sid, { text: 'five' });
    await until('relaunch without a budget', () => sp.calls[n]);
    assert.strictEqual(at(sp.calls[n].args, '--max-budget-usd'), undefined, 'no cap: no budget flag');
    await ad.stop(sid);
  }

  // ---- spec 030 FR-034: hand-off summary from a forked one-shot (no tools, no MCP, no settings, not saved) ----
  {
    const a = handoffArgs({ sessionId: 'sid-1', model: 'haiku' });
    const at = (f: string) => a[a.indexOf(f) + 1];
    assert.strictEqual(at('--resume'), 'sid-1');
    for (const f of ['--fork-session', '--no-session-persistence', '--strict-mcp-config']) assert.ok(a.includes(f), f);
    assert.strictEqual(at('--tools'), '', 'no tools');
    assert.strictEqual(at('--setting-sources'), '', 'no settings files');
    assert.strictEqual(at('--output-format'), 'json');
    assert.strictEqual(at('--max-budget-usd'), '0.5');
    assert.strictEqual(at('--model'), 'haiku');
    assert.ok(!handoffArgs({ sessionId: 's', model: 'auto' }).includes('--model'));
    assert.match(at('-p'), /hand-off summary/);
    const ok = parseHandoffOutput('noise\n' + JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '```markdown\n## Goal\nX\n```', total_cost_usd: 0.0009 }));
    assert.deepStrictEqual(ok, { summary: '## Goal\nX', costUsd: 0.0009 });
    assert.deepStrictEqual(parseHandoffOutput(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: 'partial', total_cost_usd: 0.5 })), { summary: '', costUsd: 0.5 });
    assert.deepStrictEqual(parseHandoffOutput('not json'), { summary: '' });

    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    let reply = { code: 0 as number | null, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '## Goal\nShip it', total_cost_usd: 0.002 }) };
    const sp = fakeSpawn();
    sp.next = scripted(okTurn);
    const ad = new ClaudeAdapter({
      claudePath: async () => '/usr/local/bin/claude',
      makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }),
      sessionExists: () => false, claudeMd: () => undefined, env: () => ({}),
      runOnce: async (file, args, o) => (calls.push({ file, args, cwd: o.cwd }), reply),
    });
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    assert.strictEqual(ad.capabilities.handoff, true);
    const sid = await ad.start({ workspace: WS, quiet: true, model: 'haiku', maxAiCredits: 1 });
    assert.deepStrictEqual(await ad.handoffSummary(sid), { summary: '' }, 'nothing said yet: no run');
    assert.strictEqual(calls.length, 0);
    await ad.send(sid, { text: 'hi' });
    await until('turn', () => statuses(events, sid).includes('idle'));
    const r = await ad.handoffSummary(sid);
    assert.deepStrictEqual(r, { summary: '## Goal\nShip it', costUsd: 0.002 });
    assert.strictEqual(calls[0].cwd, WS, 'runs in the session folder (where Claude keeps the session)');
    assert.ok(calls[0].args.includes(sid) && calls[0].args.includes('--fork-session'));
    assert.ok(events.some((e) => e.type === 'usage' && (e as { costUsd?: number }).costUsd === 0.002), 'its cost counts as the session\'s usage');
    assert.strictEqual(sp.calls.length, 1, 'the live CLI is not restarted');
    reply = { code: 1, stdout: '' };
    await assert.rejects(ad.handoffSummary(sid), /could not make a summary \(exit 1\)/);
    await ad.stop(sid);
  }

  // ---- spec 040 FR-015: a stand-alone one-shot (AI theme maker): no session, no tools, an empty temp folder removed after ----
  {
    const a = oneShotArgs('make a theme');
    const at = (f: string) => a[a.indexOf(f) + 1];
    assert.strictEqual(at('-p'), 'make a theme');
    for (const f of ['--no-session-persistence', '--strict-mcp-config']) assert.ok(a.includes(f), f);
    assert.ok(!a.includes('--resume') && !a.includes('--session-id'), 'no session at all');
    assert.strictEqual(at('--tools'), '');
    assert.strictEqual(at('--setting-sources'), '');
    assert.strictEqual(at('--max-budget-usd'), '0.25');
    let seenCwd = '';
    const ad = new ClaudeAdapter({ claudePath: async () => '/usr/local/bin/claude', env: () => ({}),
      runOnce: async (_f, _args, o) => { seenCwd = o.cwd; assert.deepStrictEqual(fs.readdirSync(o.cwd), [], 'an empty folder'); return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"name":"x"}', total_cost_usd: 0.003 }) }; } });
    assert.strictEqual(ad.capabilities.oneShot, true);
    assert.deepStrictEqual(await ad.generateText('p'), { text: '{"name":"x"}', costUsd: 0.003 });
    assert.ok(seenCwd && !fs.existsSync(seenCwd), 'the temp folder is removed');
    const bad = new ClaudeAdapter({ claudePath: async () => '/usr/local/bin/claude', env: () => ({}), runOnce: async () => ({ code: 1, stdout: '' }) });
    await assert.rejects(bad.generateText('p'), /no answer \(exit 1\)/);
  }

  // ---- no claude installed: a clear error, no spawn ----
  {
    const { ad, sp, events } = make({ claudePath: undefined });
    const sid = await ad.start({ workspace: WS, quiet: true });
    await ad.send(sid, { text: 'x' });
    assert.strictEqual(sp.calls.length, 0);
    const err = events.find((e) => e.type === 'status' && (e as { status: string }).status === 'error') as { intent: string };
    assert.match(err.intent, /not installed/);
  }

  fs.rmSync(WS, { recursive: true, force: true });
  console.log('claude adapter tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
