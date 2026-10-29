/**
 * The Claude SDK transport (spec 012 FR-113, T092) on a FAKE SDK module, and the experimental registration (FR-114):
 * `npm run test:claudesdk`. The real SDK is not a dependency; no claude, no credits.
 */
import * as assert from 'assert';
import { SANDBOX_HOST_OK } from './fakes/claude-cli';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter, PRE_TOOL_USE_HOOK, cliTransportFactory } from '../src/adapters/claude';
import type { TransportInput } from '../src/adapters/claude';
import { createSdkTransport, loadSdk, sdkOptionsOf, SDK_PACKAGE } from '../src/adapters/claudeSdk';
import type { SdkModule, SdkQuery } from '../src/adapters/claudeSdk';
import { claudeTransportFor, offeredDescriptors } from '../src/adapters/experimental';
import type { AgentEvent } from '../src/adapters/types';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined | false, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v as T;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick(2);
  }
}

/** A fake SDK: records options, reads the prompt queue, and per user message runs `turn`. */
function fakeSdk(turn: (ctl: { emit: (m: unknown) => void; options: Record<string, unknown> }, text: string) => Promise<void> | void) {
  const rec = { options: [] as Record<string, unknown>[], interrupts: 0, closed: 0, modes: [] as string[] };
  const sdk: SdkModule = {
    query({ prompt, options }) {
      rec.options.push(options);
      const out: unknown[] = [];
      const waiters: Array<() => void> = [];
      let done = false;
      const emit = (m: unknown) => {
        out.push(m);
        waiters.splice(0).forEach((w) => w());
      };
      void (async () => {
        for await (const u of prompt) {
          const c = (u as { message: { content: unknown } }).message.content;
          await turn({ emit, options }, typeof c === 'string' ? c : '');
        }
        done = true;
        waiters.splice(0).forEach((w) => w());
      })();
      const q: SdkQuery = {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (out.length) {
              yield out.shift();
              continue;
            }
            if (done) return;
            await new Promise<void>((r) => waiters.push(r));
          }
        },
        interrupt: async () => {
          rec.interrupts++;
        },
        setPermissionMode: async (m: string) => {
          rec.modes.push(m);
        },
        close: () => {
          rec.closed++;
          done = true;
          waiters.splice(0).forEach((w) => w());
        },
      };
      return q;
    },
  };
  return { sdk, rec };
}

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-claude-sdk-'));

async function main(): Promise<void> {
  // loadSdk: undefined without the package, undefined for a module without query(), the module otherwise; never throws
  assert.strictEqual(await loadSdk(async () => { throw new Error('Cannot find package'); }), undefined);
  assert.strictEqual(await loadSdk(async () => ({ default: {} })), undefined);
  const named: string[] = [];
  const mod = { query: () => ({}) };
  assert.strictEqual(await loadSdk(async (n) => (named.push(n), mod)), mod);
  assert.deepStrictEqual(named, [SDK_PACKAGE]);
  assert.ok(!fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8').includes(SDK_PACKAGE), 'the SDK is not a dependency (Q3)');

  // options: the same rules as the CLI flags (explicit mode, no settings, strict MCP, the user's claude, partial messages)
  {
    const base: TransportInput = { file: '/usr/bin/claude', cwd: WS, env: { A: '1' }, handlers: { message: () => undefined, control: async () => ({ response: {} }), exit: () => undefined }, launch: { mode: 'read-only', sessionId: 'sid-1', resume: false, appendSystemPrompt: 'MD', mcpConfig: '{"mcpServers":{"fs":{"type":"stdio","command":"x","args":[]}}}', model: 'auto' } };
    const o = sdkOptionsOf(base, 'CAN', 'HOOK');
    assert.strictEqual(o.pathToClaudeCodeExecutable, '/usr/bin/claude');
    assert.strictEqual(o.permissionMode, 'dontAsk');
    assert.deepStrictEqual(o.settingSources, []);
    assert.strictEqual(o.strictMcpConfig, true);
    assert.strictEqual(o.includePartialMessages, true);
    assert.strictEqual(o.canUseTool, 'CAN');
    assert.deepStrictEqual(o.hooks, { PreToolUse: [{ matcher: '*', hooks: ['HOOK'] }] });
    assert.deepStrictEqual(o.mcpServers, { fs: { type: 'stdio', command: 'x', args: [] } });
    assert.deepStrictEqual(o.systemPrompt, { type: 'preset', preset: 'claude_code', append: 'MD' });
    assert.strictEqual(o.sessionId, 'sid-1');
    assert.strictEqual(o.resume, undefined);
    assert.strictEqual(o.model, undefined, 'a Copilot model id is not passed');
    assert.ok(!('allowDangerouslySkipPermissions' in o));
    assert.ok(!('forwardSubagentText' in o), 'spec 015 FR-016: off unless the launch asks');
    assert.strictEqual(sdkOptionsOf({ ...base, launch: { ...base.launch, forwardSubagentText: true } }, 0, 0).forwardSubagentText, true);
    const all = sdkOptionsOf({ ...base, launch: { ...base.launch, mode: 'allow', resume: true, model: 'claude-haiku-5-5' } }, 0, 0);
    assert.strictEqual(all.permissionMode, 'bypassPermissions');
    assert.strictEqual(all.allowDangerouslySkipPermissions, true);
    assert.strictEqual(all.resume, 'sid-1');
    assert.strictEqual(all.model, 'claude-haiku-5-5');
  }

  // the adapter over the SDK transport: a turn maps, can_use_tool goes through the broker (Ask first waits for the user), the hook answers
  {
    let decided: unknown;
    let hookOut: unknown;
    const { sdk, rec } = fakeSdk(async (ctl, text) => {
      ctl.emit({ type: 'system', subtype: 'init', session_id: 'x', cwd: WS, tools: [], mcp_servers: [] });
      if (text === 'write') {
        const can = ctl.options.canUseTool as (n: string, i: Record<string, unknown>, o: { toolUseID?: string }) => Promise<unknown>;
        decided = await can('Write', { file_path: path.join(WS, 'a.txt') }, { toolUseID: 'tu-s' });
        const hook = ((ctl.options.hooks as { PreToolUse: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }> }).PreToolUse[0].hooks[0]);
        hookOut = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } });
      }
      ctl.emit({ type: 'assistant', message: { id: 'm-' + text, content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 3, output_tokens: 1 } } });
      ctl.emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0002 });
    });
    const ad = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => '/usr/bin/claude', makeTransport: (o) => createSdkTransport(sdk, o), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) });
    const ev: AgentEvent[] = [];
    ad.onEvent((e) => ev.push(e));
    const sid = await ad.start({ workspace: WS, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'hello' });
    await until('idle', () => ev.some((e) => e.type === 'status' && e.status === 'idle'));
    assert.ok(ev.some((e) => e.type === 'output' && (e as { text?: string }).text === 'hi'));
    assert.strictEqual(rec.options.length, 1);
    await ad.send(sid, { text: 'write' });
    const p = await until('pending', () => ev.find((e) => e.type === 'status' && e.status === 'needs-permission') as { permission: { requestId: string } } | undefined);
    assert.strictEqual(p.permission.requestId, 'tu-s');
    ad.resolvePermission(sid, 'tu-s', false);
    await until('decision', () => decided);
    assert.deepStrictEqual(decided, { behavior: 'deny', message: 'Denied by user in Agent Durbar.' });
    await until('hook', () => hookOut);
    assert.deepStrictEqual(hookOut, {}, 'Ask first: the hook has no opinion (the broker asks instead)');
    await ad.interrupt(sid);
    assert.strictEqual(rec.interrupts, 1);
    await ad.stop(sid);
    assert.strictEqual(rec.closed, 1);
  }

  // a failing SDK stream is an error for the session, which stays
  {
    const sdk: SdkModule = {
      query: () => ({
        async *[Symbol.asyncIterator]() {
          throw new Error('auth failed');
        },
        interrupt: async () => undefined,
        close: () => undefined,
      }),
    };
    const ad = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => '/usr/bin/claude', makeTransport: (o) => createSdkTransport(sdk, o), sessionExists: () => false, claudeMd: () => undefined, env: () => ({}) });
    const ev: AgentEvent[] = [];
    ad.onEvent((e) => ev.push(e));
    const sid = await ad.start({ workspace: WS, quiet: true });
    await ad.send(sid, { text: 'x' });
    await until('error', () => ev.some((e) => e.type === 'status' && e.status === 'error'));
    assert.ok(ad.isLive(sid));
    await ad.stop(sid);
  }

  // selection and registration (FR-114, FR-135: always registered, no hook)
  {
    assert.deepStrictEqual(offeredDescriptors({ DURBAR_CLAUDE: '0' }).map((d) => d.id), ['claude', 'codex'], 'the old hook no longer hides it; Codex is offered too (FR-145)');
    const reg = offeredDescriptors({});
    assert.deepStrictEqual(reg.map((d) => d.id), ['claude', 'codex']);
    assert.strictEqual(reg[0].displayName, 'Claude Code');
    assert.strictEqual(claudeTransportFor({}), cliTransportFactory, 'CLI by default');
    let loads = 0;
    const f = claudeTransportFor({ DURBAR_CLAUDE_TRANSPORT: 'sdk' }, async () => (loads++, undefined));
    const input: TransportInput = { file: '/nonexistent/claude', cwd: WS, env: {}, launch: { mode: 'read-only', sessionId: 's', resume: false }, handlers: { message: () => undefined, control: async () => ({ response: {} }), exit: () => undefined } };
    const t1 = await f(input);
    assert.strictEqual(t1.kind, 'cli', 'no SDK package: the CLI');
    await t1.close();
    const t2 = await f(input);
    await t2.close();
    assert.strictEqual(loads, 1, 'the SDK is looked for once');
    const { sdk } = fakeSdk(() => undefined);
    const g = claudeTransportFor({ DURBAR_CLAUDE_TRANSPORT: 'sdk' }, async () => sdk);
    const t3 = await g(input);
    assert.strictEqual(t3.kind, 'sdk');
    await t3.close();
  }

  // the hook id the SDK transport sends is the adapter's
  assert.strictEqual(PRE_TOOL_USE_HOOK, 'durbar_pre_tool_use');
  fs.rmSync(WS, { recursive: true, force: true });
  console.log('claude sdk tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
