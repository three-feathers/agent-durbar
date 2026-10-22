/**
 * The SDK transport (spec 012 FR-113, T092): `@anthropic-ai/claude-agent-sdk` behind the same `ClaudeTransport` seam as the
 * CLI transport. The package is NOT a dependency of Agent Durbar (Anthropic's Commercial Terms, owner decision Q3): it is
 * loaded with a dynamic `import()` only when it can be resolved at run time, and this module reports "not available"
 * otherwise. Types are structural (no SDK import), from the SDK 0.3.302 declarations: `query({ prompt, options })` returns
 * an async iterable with `interrupt()`, `setPermissionMode()` and `close()`; permissions come through `canUseTool`, the
 * Read-only roots check through a `PreToolUse` hook.
 */
import { claudeOptionsFor } from './claudeModes';
import type { ClaudeMessage } from './claudeMap';
import type { ClaudeTransport, TransportHandlers, UserContent } from './claudeTransport';
import type { TransportInput } from './claude';
import { CLAUDE_EFFORTS, PRE_TOOL_USE_HOOK, claudeModelFlag } from './claude';

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/** The part of the SDK module this transport uses. */
export interface SdkModule {
  query(params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }): SdkQuery;
}
export interface SdkQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  setPermissionMode?(mode: string): Promise<void>;
  close(): void;
}

/** Loads the SDK, or undefined when the package is not installed (the normal case: it is not a dependency). Never throws. */
/**
 * A real ESM `import()`: TypeScript compiles this project to CommonJS and would turn `import(x)` into `require(x)`,
 * which cannot load the ESM-only SDK (spec 012 T044). The specifier is a constant, never user input.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const esmImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>;

export async function loadSdk(importer: (name: string) => Promise<unknown> = esmImport): Promise<SdkModule | undefined> {
  try {
    const m = (await importer(SDK_PACKAGE)) as Partial<SdkModule> | undefined;
    return m && typeof m.query === 'function' ? (m as SdkModule) : undefined;
  } catch {
    return undefined;
  }
}

/** A push queue as the SDK's streaming-input prompt. */
class InputQueue implements AsyncIterable<unknown> {
  private items: unknown[] = [];
  private waiters: Array<(r: IteratorResult<unknown>) => void> = [];
  private ended = false;
  push(v: unknown): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.items.push(v);
  }
  end(): void {
    this.ended = true;
    this.waiters.splice(0).forEach((w) => w({ value: undefined, done: true }));
  }
  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

/** `query()` options for a launch (same rules as the CLI flags: Q8, explicit mode, the user's `claude`). */
export function sdkOptionsOf(o: TransportInput, canUseTool: unknown, hook: unknown): Record<string, unknown> {
  const m = claudeOptionsFor(o.launch.mode, o.launch.folderAllow);
  const opts: Record<string, unknown> = {
    cwd: o.cwd,
    env: o.env,
    pathToClaudeCodeExecutable: o.file,
    permissionMode: m.permissionMode,
    settingSources: m.settingSources,
    strictMcpConfig: m.strictMcpConfig,
    includePartialMessages: true,
    canUseTool,
    hooks: { PreToolUse: [{ matcher: '*', hooks: [hook] }] },
  };
  if (m.allowDangerouslySkipPermissions) opts.allowDangerouslySkipPermissions = true;
  if (m.allowedTools?.length) opts.allowedTools = m.allowedTools;
  const deny = [...(m.disallowedTools ?? []), ...(o.launch.disallowedMcpTools ?? [])]; // spec 069 FR-062
  if (deny.length) opts.disallowedTools = deny;
  if (o.launch.mcpConfig) opts.mcpServers = (JSON.parse(o.launch.mcpConfig) as { mcpServers: unknown }).mcpServers;
  // spec 061 FR-004: the composed folder settings as the CLI flag (the SDK passes extraArgs through; not checked on a real SDK, KNOWN GAP)
  if (o.launch.settingsJson) opts.extraArgs = { ...(opts.extraArgs as Record<string, string | null> | undefined), settings: o.launch.settingsJson };
  if (claudeModelFlag(o.launch.model)) opts.model = o.launch.model;
  if (o.launch.effort && CLAUDE_EFFORTS.has(o.launch.effort)) opts.effort = o.launch.effort;
  if (o.launch.appendSystemPrompt) opts.systemPrompt = { type: 'preset', preset: 'claude_code', append: o.launch.appendSystemPrompt };
  if (o.launch.addDirs?.length) opts.additionalDirectories = o.launch.addDirs;
  if (o.launch.resume) opts.resume = o.launch.sessionId;
  else opts.sessionId = o.launch.sessionId;
  return opts;
}

export function createSdkTransport(sdk: SdkModule, o: TransportInput): ClaudeTransport {
  const h: TransportHandlers = o.handlers;
  const input = new InputQueue();
  let alive = true;
  let n = 0;
  const control = async (subtype: string, request: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const a = await h.control({ requestId: `sdk-${++n}`, subtype, request: { subtype, ...request } });
    if ('error' in a) throw new Error(a.error);
    return a.response;
  };
  const canUseTool = async (toolName: string, toolInput: Record<string, unknown>, opts: { toolUseID?: string } = {}) => {
    const r = await control('can_use_tool', { tool_name: toolName, input: toolInput, tool_use_id: opts.toolUseID });
    return r.behavior === 'allow' ? { behavior: 'allow', updatedInput: (r.updatedInput as Record<string, unknown>) ?? toolInput } : { behavior: 'deny', message: String(r.message ?? 'Denied in Agent Durbar.') };
  };
  const hook = async (hookInput: unknown) => control('hook_callback', { callback_id: PRE_TOOL_USE_HOOK, input: hookInput });
  const q = sdk.query({ prompt: input, options: sdkOptionsOf(o, canUseTool, hook) });

  void (async () => {
    let failed: string | undefined;
    try {
      for await (const m of q) {
        if (m && typeof m === 'object') {
          try {
            h.message(m as ClaudeMessage);
          } catch {
            /* a handler bug must not end the stream */
          }
        }
      }
    } catch (e) {
      failed = e instanceof Error ? e.message.slice(0, 500) : 'SDK stream failed';
    } finally {
      alive = false;
      h.exit({ code: failed ? 1 : 0, signal: null, stderrTail: failed ?? '' });
    }
  })();

  return {
    kind: 'sdk',
    get alive() {
      return alive;
    },
    sendUser(content: UserContent) {
      input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: o.launch.sessionId });
    },
    async request(body) {
      if (!alive) throw new Error('claude is not running');
      switch (body.subtype) {
        case 'initialize':
          return {}; // the SDK initializes itself (hooks are passed as options)
        case 'interrupt':
          await q.interrupt();
          return {};
        case 'set_permission_mode':
          if (!q.setPermissionMode) throw new Error('this SDK cannot change the mode');
          await q.setPermissionMode(String(body.mode));
          return {};
        default:
          throw new Error(`the SDK transport does not send ${String(body.subtype)}`);
      }
    },
    async close() {
      input.end();
      try {
        q.close();
      } catch {
        /* already closed */
      }
    },
  };
}
