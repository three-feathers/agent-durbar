/**
 * A fake of the Agent SDK's `query()` for `npm run test:prereview` (spec 103). It spends nothing and opens no network. It records what it
 * was given, plays the PreToolUse hook the way the real SDK would (so a test can try hostile tool calls), and answers from a script.
 */
import type { QueryFn } from '../prereview-run';

export interface FakeScript {
  /** replaces fields of the init message; `null` means no init at all */
  init?: Record<string, unknown> | null;
  /** tool calls the "model" tries; the hook's decision for each is recorded */
  toolCalls?: Array<{ tool_name: string; tool_input: unknown }>;
  /** replaces fields of the final result; or a ready result */
  result?: Record<string, unknown>;
  /** the structured answer */
  answer?: unknown;
  hang?: boolean;
  throws?: boolean;
  /** messages to send before the result */
  before?: any[];
}
export interface FakeRecord { calls: Array<{ prompt: string; options: any }>; decisions: Array<{ tool: string; decision: string }> }

export const goodAnswer = (extra: Record<string, unknown> = {}): unknown => ({ findings: [{ kind: 'reach', path: 'src/a.ts', line: 3, claim: 'misses the list view', evidence: 'src/b.ts:9 calls it', how_to_check: 'open the list view' }], not_checked: 'nothing ran', ...extra });
export const usage = (cost = 0.42, basis: string = 'list') => ({ total_cost_usd: cost, modelUsage: { 'claude-opus-5-5': { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 5000, cacheCreationInputTokens: 3000, costUSD: cost, costBasis: basis } } });

export function fakeQuery(script: FakeScript | ((n: number) => FakeScript), rec: FakeRecord): QueryFn {
  let n = 0;
  return ({ prompt, options: opts }) => {
    const options: any = opts;
    const s = typeof script === 'function' ? script(n++) : script;
    rec.calls.push({ prompt, options });
    return (async function* () {
      if (s.throws) throw new Error('boom ghp_' + 'a'.repeat(36));
      if (s.init !== null) {
        yield { type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY', tools: ['Read', 'Grep', 'Glob'], mcp_servers: [], plugins: [], agents: [], permissionMode: 'dontAsk', cwd: options.cwd, model: options.model, ...(s.init ?? {}) };
      }
      if (s.hang) { await new Promise<void>((res) => { options.abortController.signal.addEventListener('abort', () => res()); }); return; }
      const hook = options.hooks && options.hooks.PreToolUse && options.hooks.PreToolUse[0].hooks[0];
      for (const c of s.toolCalls ?? []) {
        const out = await hook({ hook_event_name: 'PreToolUse', ...c, tool_use_id: 't' }, 't', { signal: options.abortController.signal });
        rec.decisions.push({ tool: c.tool_name, decision: out && out.hookSpecificOutput ? out.hookSpecificOutput.permissionDecision : 'none' });
      }
      for (const m of s.before ?? []) yield m;
      yield { type: 'result', subtype: 'success', is_error: false, num_turns: 4, stop_reason: 'end_turn', result: '', structured_output: s.answer === undefined ? goodAnswer() : s.answer, permission_denials: [], ...usage(), ...(s.result ?? {}) };
    })();
  };
}
