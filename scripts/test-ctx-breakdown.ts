/** The context ring's token summary (spec 005 FR-051, FR-052, FR-056; issue #627): what each adapter's `context` event gives the
 *  summary, end to end through the real mappers (fake raw events), `toolstats`' kept shape and `DurbarCtxBreakdown.summary`.
 *  `npm run test:ctxbreakdown`. Pure; runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import { EventMapper } from '../src/adapters/map';
import type { EventBody, RawEvent } from '../src/adapters/map';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import type { ClaudeMessage } from '../src/adapters/claudeMap';
import { CodexMapper } from '../src/adapters/codexMap';
import type { CodexNotification } from '../src/adapters/codexMap';

const ROOT = path.join(__dirname, '..', '..');
type Bar = { key: string; label: string; tokens: number; share: number };
type Sum = { known: boolean; tokens?: number; limit: number; pct: number | null; level: string; bars: Bar[]; note: string; tip: string; name: string };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const B = require(path.join(ROOT, 'src', 'renderer', 'ctxbreakdown.js')) as {
  summary: (ctx: unknown, o?: { limit?: number; app?: string; waiting?: boolean }) => Sum;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(ROOT, 'src', 'renderer', 'toolstats.js')) as { createStats: () => { setContext: (id: string, e: unknown) => void; agent: (id: string) => { ctx: unknown } } };

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
/** the event as the renderer keeps it (toolstats.setContext), as the chip reads it */
const kept = (events: EventBody[]): unknown => {
  const st = S.createStats();
  for (const e of events) if (e.type === 'context') st.setContext('a', e);
  return st.agent('a').ctx;
};
const STARTED = { method: 'thread/started', params: { thread: { id: 't', cwd: '/w' } } } as unknown as CodexNotification;
const keys = (s: Sum) => s.bars.map((b) => b.key + ':' + b.tokens);

t('Copilot: session.usage_info gives System, Tool definitions and Chat bars (real mapper)', () => {
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'session.usage_info', data: { currentTokens: 550000, tokenLimit: 1000000, systemTokens: 5840, conversationTokens: 530000, toolDefinitionsTokens: 7668, messagesLength: 12 } } as RawEvent);
  const s = B.summary(kept(out), { app: 'GitHub Copilot' });
  assert.strictEqual(s.known, true);
  assert.strictEqual(s.pct, 55); assert.strictEqual(s.level, 'ok'); assert.strictEqual(s.limit, 1000000);
  // the rest (550000 - 543508 = 6492) is reported as Other; the messages count is not tokens and never a bar
  assert.deepStrictEqual(keys(s), ['system:5840', 'toolDefinitions:7668', 'conversation:530000', 'other:6492']);
  assert.deepStrictEqual(s.bars.map((b) => b.label), ['System instructions', 'Tool definitions', 'Chat messages', 'Other']);
  assert.strictEqual(s.bars[2].share, 53, 'a share of the window, rounded');
  assert.strictEqual(s.note, '', 'a reported breakdown has no "not reported" note');
  assert.strictEqual(s.tip, 'Context 55% of 1M');
  assert.strictEqual(s.name, 'Context window 55% used: 550k of 1M tokens. Open the token summary');
});

t('Copilot: parts that add up (or exceed the total) give no Other row', () => {
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'session.usage_info', data: { currentTokens: 1000, tokenLimit: 10000, systemTokens: 300, conversationTokens: 500, toolDefinitionsTokens: 200 } } as RawEvent);
  assert.deepStrictEqual(keys(B.summary(kept(out), { app: 'GitHub Copilot' })), ['system:300', 'toolDefinitions:200', 'conversation:500']);
  const out2: EventBody[] = [];
  const m2 = new EventMapper((b) => out2.push(b));
  m2.map({ type: 'session.usage_info', data: { currentTokens: 1000, tokenLimit: 10000, systemTokens: 600, conversationTokens: 600 } } as RawEvent);
  assert.deepStrictEqual(keys(B.summary(kept(out2), { app: 'GitHub Copilot' })), ['system:600', 'conversation:600'], 'a part that is not reported is not shown; a negative rest gives no Other');
});

t('Copilot: a usage_info with no parts says the breakdown is not reported', () => {
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'session.usage_info', data: { currentTokens: 5000, tokenLimit: 100000 } } as RawEvent);
  const s = B.summary(kept(out), { app: 'GitHub Copilot' });
  assert.deepStrictEqual(s.bars, []); assert.strictEqual(s.note, 'Breakdown not reported by GitHub Copilot.');
});

t('Claude Code: a total only, no bars, "not reported by Claude Code" (real mapper)', () => {
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b), { quiet: true });
  m.map({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 2, cache_creation_input_tokens: 8302, cache_read_input_tokens: 8858, output_tokens: 7 } } } as ClaudeMessage);
  m.map({ type: 'result', subtype: 'success', modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000, maxOutputTokens: 128000 } } } as ClaudeMessage);
  const s = B.summary(kept(out), { app: 'Claude Code' });
  assert.strictEqual(s.known, true); assert.strictEqual(s.tokens, 17169); assert.strictEqual(s.limit, 1000000); assert.strictEqual(s.pct, 2);
  assert.deepStrictEqual(s.bars, [], 'nothing is invented');
  assert.strictEqual(s.note, 'Breakdown not reported by Claude Code.');
  assert.strictEqual(s.tip, 'Context 2% of 1M');
});

t('Codex: a total only (last input tokens and the window), no bars (real mapper)', () => {
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  m.map(STARTED);
  m.map({ method: 'thread/tokenUsage/updated', params: { tokenUsage: { last: { inputTokens: 200000, outputTokens: 50, cachedInputTokens: 10 }, modelContextWindow: 272000 } } } as unknown as CodexNotification);
  const s = B.summary(kept(out), { app: 'OpenAI Codex' });
  assert.strictEqual(s.tokens, 200000); assert.strictEqual(s.limit, 272000); assert.strictEqual(s.pct, 74); assert.strictEqual(s.level, 'warn');
  assert.deepStrictEqual(s.bars, []); assert.strictEqual(s.note, 'Breakdown not reported by OpenAI Codex.');
  // a null window: the used total is known, the share is not
  const out2: EventBody[] = [];
  const m2 = new CodexMapper((b) => out2.push(b));
  m2.map(STARTED);
  m2.map({ method: 'thread/tokenUsage/updated', params: { tokenUsage: { last: { inputTokens: 600 }, modelContextWindow: null } } } as unknown as CodexNotification);
  const s2 = B.summary(kept(out2), { app: 'OpenAI Codex' });
  assert.strictEqual(s2.known, true); assert.strictEqual(s2.pct, null); assert.strictEqual(s2.level, 'unknown');
  assert.strictEqual(s2.tip, 'Context: 600 tokens used, window size not reported');
});

t('no context event (VS Code chat, other kinds, before the first message): not known yet', () => {
  const s = B.summary(null, { app: 'VS Code' });
  assert.strictEqual(s.known, false); assert.deepStrictEqual(s.bars, []); assert.strictEqual(s.level, 'unknown');
  assert.strictEqual(s.tip, 'Context: not known yet');
  assert.match(s.note, /after the first message/);
  assert.match(s.name, /^Context window: not known yet\. Open the token summary$/);
});

t('the static window is used when the event has none; waiting after a switch hides the old figure', () => {
  const s = B.summary({ tokens: 32000, limit: 0 }, { limit: 128000, app: 'GitHub Copilot' });
  assert.strictEqual(s.pct, 25); assert.strictEqual(s.limit, 128000);
  const w = B.summary({ tokens: 32000, limit: 128000, system: 1 }, { waiting: true, app: 'GitHub Copilot' });
  assert.strictEqual(w.known, false); assert.deepStrictEqual(w.bars, []);
  assert.strictEqual(w.tip, 'Context: waiting for the next message after the model change');
});

t('levels follow toolstats ctxLevel: 69 ok, 70 warn, 90 warn, 91 high', () => {
  const lv = (p: number) => B.summary({ tokens: p * 1000, limit: 100000 }).level;
  assert.deepStrictEqual([lv(69), lv(70), lv(90), lv(91)], ['ok', 'warn', 'warn', 'high']);
});

t('shares of the used total when the window is unknown; junk parts are ignored', () => {
  const s = B.summary({ tokens: 1000, limit: 0, system: 250, conversation: 'x', toolDefinitions: -5 }, { app: 'GitHub Copilot' });
  assert.deepStrictEqual(keys(s), ['system:250', 'other:750']);
  assert.deepStrictEqual(s.bars.map((b) => b.share), [25, 75]);
  const nan = B.summary({ tokens: 1000, limit: 2000, system: NaN, conversation: Infinity });
  assert.deepStrictEqual(nan.bars, []); assert.strictEqual(nan.note, 'Breakdown not reported by this agent app.');
  assert.strictEqual(B.summary({ tokens: -1, limit: 10 }).known, false, 'a negative total is not a figure');
});

console.log(`ctxbreakdown: ${n} checks passed`);
