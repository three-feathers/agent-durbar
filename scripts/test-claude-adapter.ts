/**
 * ClaudeAdapter (spec 012 FR-111, FR-112, T091) over the real CLI transport and a scripted fake `claude` child:
 * `npm run test:claudeadapter`. No claude, no account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter, PRE_TOOL_USE_HOOK, claudeArgs, claudeMdPrompt, mcpConfigOf, permissionLikeOf, userContentOf } from '../src/adapters/claude';
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
