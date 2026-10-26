/** Claude CLI transport (spec 012 FR-110, T090) on a scripted fake child: `npm run test:claudetransport`. No claude, no credits. */
import * as assert from 'assert';
import { MAX_LINE_BYTES, createCliTransport } from '../src/adapters/claudeTransport';
import type { ChildLike, ControlAnswer, IncomingControl, TransportHandlers } from '../src/adapters/claudeTransport';
import { fakeSpawn } from './fakes/claude-cli';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(handlers: Partial<TransportHandlers> = {}, opts: { controlTimeoutMs?: number; closeGraceMs?: number; killGraceMs?: number; killChild?: (c: ChildLike, s: NodeJS.Signals) => void } = {}) {
  const fs = fakeSpawn();
  const msgs: unknown[] = [];
  const exits: Array<{ code: number | null; signal: string | null; stderrTail: string }> = [];
  let n = 0;
  const t = createCliTransport({
    file: '/opt/claude/bin/claude',
    args: ['-p', '--output-format', 'stream-json'],
    cwd: '/work/repo',
    env: { PATH: '/usr/bin' },
    spawn: fs.spawn,
    nextId: () => `req-${++n}`,
    handlers: {
      message: (m) => msgs.push(m),
      control: handlers.control ?? (async () => ({ response: {} })),
      exit: (e) => exits.push(e),
    },
    ...opts,
  });
  return { t, child: fs.children[0], calls: fs.calls, msgs, exits };
}

async function main(): Promise<void> {
  // spawn: absolute file, argv array, no shell, the session folder as cwd
  {
    const { calls } = setup();
    assert.deepStrictEqual(calls[0], { file: '/opt/claude/bin/claude', args: ['-p', '--output-format', 'stream-json'], cwd: '/work/repo', shell: false });
  }

  // framing: lines split across chunks, several per chunk, blank lines, malformed JSON and non-objects are dropped
  {
    const { child, msgs } = setup();
    child.out('{"type":"system","subtype":"init","session_id":"s1"}\n{"type":"assis');
    child.out('tant","message":{"content":[]}}\n\n not json\n[1,2]\n42\n');
    child.out('{"type":"result","subtype":"success"}');
    assert.strictEqual(msgs.length, 2, 'a line without its newline waits');
    child.out('\n');
    assert.deepStrictEqual(msgs.map((m) => (m as { type: string }).type), ['system', 'assistant', 'result']);
  }

  // an oversized line is dropped up to its newline; the stream goes on
  {
    const { child, msgs } = setup();
    child.out('{"type":"x","pad":"' + 'a'.repeat(MAX_LINE_BYTES + 10));
    child.out('still the same huge line"}\n{"type":"after"}\n');
    assert.deepStrictEqual(msgs.map((m) => (m as { type: string }).type), ['after']);
  }

  // user message shape
  {
    const { t, child } = setup();
    t.sendUser('hello');
    t.sendUser([{ type: 'text', text: 'see image' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
    const objs = child.objects();
    assert.deepStrictEqual(objs[0], { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null });
    assert.strictEqual((objs[1].message as { content: unknown[] }).content.length, 2);
  }

  // host -> CLI control request: id, success response, error response, timeout, unknown id ignored
  {
    const { t, child } = setup({}, { controlTimeoutMs: 30 });
    const p1 = t.request({ subtype: 'initialize', hooks: {} });
    const sent = child.objects()[0];
    assert.deepStrictEqual(sent, { type: 'control_request', request_id: 'req-1', request: { subtype: 'initialize', hooks: {} } });
    child.send({ type: 'control_response', response: { subtype: 'success', request_id: 'nope', response: {} } });
    child.send({ type: 'control_response', response: { subtype: 'success', request_id: 'req-1', response: { commands: [] } } });
    assert.deepStrictEqual(await p1, { commands: [] });
    const p2 = t.request({ subtype: 'interrupt' });
    child.send({ type: 'control_response', response: { subtype: 'error', request_id: 'req-2', error: 'no turn' } });
    await assert.rejects(p2, /no turn/);
    await assert.rejects(t.request({ subtype: 'set_permission_mode', mode: 'default' }), /timed out/);
  }

  // CLI -> host control request: answered once with the handler's answer; a duplicate delivery is ignored; a throw is an error answer
  {
    const seen: IncomingControl[] = [];
    let release!: (a: ControlAnswer) => void;
    const { child } = setup({
      control: (req) => {
        seen.push(req);
        if (req.subtype === 'boom') throw new Error('handler broke');
        return new Promise<ControlAnswer>((r) => (release = r));
      },
    });
    const ask = { type: 'control_request', request_id: 'cli-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt' }, tool_use_id: 'tu1' } };
    child.send(ask);
    child.send(ask); // duplicate delivery
    await tick();
    assert.strictEqual(seen.length, 1, 'handled once');
    assert.deepStrictEqual(seen[0], { requestId: 'cli-1', subtype: 'can_use_tool', request: ask.request });
    release({ response: { behavior: 'deny', message: 'no', toolUseID: 'tu1' } });
    await tick();
    const replies = child.objects().filter((o) => o.type === 'control_response');
    assert.deepStrictEqual(replies, [{ type: 'control_response', response: { subtype: 'success', request_id: 'cli-1', response: { behavior: 'deny', message: 'no', toolUseID: 'tu1' } } }]);
    child.send({ type: 'control_request', request_id: 'cli-2', request: { subtype: 'boom' } });
    await tick(5);
    const err = child.objects().filter((o) => o.type === 'control_response').slice(-1)[0];
    assert.deepStrictEqual(err, { type: 'control_response', response: { subtype: 'error', request_id: 'cli-2', error: 'handler broke' } });
    child.send({ type: 'control_request', request: { subtype: 'can_use_tool' } }); // no id: ignored
    child.send({ type: 'control_request', request_id: 'cli-3' }); // no request: ignored
    child.send({ type: 'keep_alive' });
    child.send({ type: 'control_cancel_request', request_id: 'cli-1' });
    await tick();
    assert.strictEqual(seen.length, 2);
  }

  // exit: pending host requests reject, the stderr tail is kept short, alive goes false, writes after exit are dropped
  {
    const { t, child, exits } = setup();
    const p = t.request({ subtype: 'interrupt' });
    child.err('warning: something\n'.repeat(80));
    child.exit(1, null);
    await assert.rejects(p, /exited/);
    assert.strictEqual(t.alive, false);
    assert.strictEqual(exits.length, 1);
    assert.strictEqual(exits[0].code, 1);
    assert.ok(exits[0].stderrTail.split('\n').length <= 30, 'stderr tail is bounded');
    const before = child.written.length;
    t.sendUser('late');
    assert.strictEqual(child.written.length, before, 'nothing is written after exit');
    await assert.rejects(t.request({ subtype: 'interrupt' }), /not running/);
  }

  // spawn error (binary vanished) is an exit
  {
    const { t, child, exits } = setup();
    child.fail('ENOENT');
    assert.strictEqual(t.alive, false);
    assert.match(exits[0].stderrTail, /spawn error: ENOENT/);
  }

  // close: ends stdin; a child that ignores it is terminated, then killed
  {
    const { t, child, exits } = setup({}, { closeGraceMs: 10, killGraceMs: 10 });
    await t.close();
    assert.ok(child.ended);
    assert.deepStrictEqual(child.killed, [], 'a well-behaved child exits on stdin end');
    assert.strictEqual(exits.length, 1);
    const s2 = setup({}, { closeGraceMs: 10, killGraceMs: 10 });
    s2.child.exitOnEnd = false;
    s2.child.exitOnTerm = false;
    await s2.t.close();
    assert.deepStrictEqual(s2.child.killed, ['SIGTERM', 'SIGKILL'], 'escalates');
    assert.strictEqual(s2.t.alive, false);
    await s2.t.close(); // idempotent
  }
  // the kill steps go through the injected tree killer, in order (FR-079 delta 2026-10-26)
  {
    const steps: string[] = [];
    const s3 = setup({}, { closeGraceMs: 10, killGraceMs: 10, killChild: (_c, sig) => { steps.push(sig); } });
    s3.child.exitOnEnd = false;
    s3.child.exitOnTerm = false;
    await s3.t.close();
    assert.deepStrictEqual(steps, ['SIGTERM', 'SIGKILL']);
    assert.deepStrictEqual(s3.child.killed, [], 'child.kill is not used when a killer is injected');
  }

  console.log('claude transport tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
