/** The loop rule "looping?" (spec 106 FR-041, FR-042, SC-005): `npm run test:brainloop`. No credits. */
import * as assert from 'assert';
import * as R from '../src/shared/redact';
import { BrainState, brainState, initBrain, loopText } from '../src/shared/brainstate';

let clock = 1_000_000;
let id = 0;
let s: BrainState = initBrain('Sven', R);
const loopOf = (): BrainState['loop'] => s.loop;
const reset = (): void => { s = initBrain('Sven', R); s = ev({ type: 'user' }); };
const ev = (e: unknown): BrainState => { clock += 10; return (s = brainState(s, e, clock, R)); };
/** One completed step of a glyph (by a tool name of that glyph). */
const NAME = { read: 'view', edit: 'edit', shell: 'bash', web: 'web_fetch', mcp: 'srv-x' } as const;
function step(g: keyof typeof NAME, ok = true, extra: Record<string, unknown> = {}): BrainState {
  const c = 'c' + ++id;
  const more = g === 'mcp' ? { mcpServer: 'srv' } : {};
  ev({ type: 'toolCall', callId: c, phase: 'start', tool: NAME[g], args: {}, ...more, ...extra });
  return ev({ type: 'toolCall', callId: c, phase: ok ? 'complete' : 'failed', tool: NAME[g], ...more, ...extra });
}
const seq = (glyphs: (keyof typeof NAME)[], lastOk = true): void => glyphs.forEach((g, i) => step(g, i < glyphs.length - 1 || lastOk));

// (a) the last 4 steps alternate between two glyphs AND the last failed
reset(); seq(['edit', 'shell', 'edit', 'shell'], false);
assert.ok(loopOf(), '(a) E S E S with the last failed');
assert.strictEqual(loopOf()!.pairs, 2);
// (a) needs the failure: the same 4 steps all ok are no loop
reset(); seq(['edit', 'shell', 'edit', 'shell'], true);
assert.strictEqual(loopOf(), null, '(a) without a failed last step: no loop');
// (a) only the LAST must have failed; an earlier failure alone is not enough
reset(); step('edit', false); step('shell'); step('edit'); step('shell');
assert.strictEqual(loopOf(), null, 'an early failure does not count');
// three steps are not enough
reset(); seq(['edit', 'shell', 'edit'], false);
assert.strictEqual(loopOf(), null, '3 steps are no loop');
// A = A is not alternation
reset(); seq(['shell', 'shell', 'shell', 'shell'], false);
assert.strictEqual(loopOf(), null, 'the same glyph four times is not A, B, A, B');
// (b) 6 times (12 steps) whatever the results
reset(); seq(['edit', 'shell', 'edit', 'shell', 'edit', 'shell', 'edit', 'shell', 'edit', 'shell', 'edit']);
assert.strictEqual(loopOf(), null, '(b) 11 steps all ok: not yet');
step('shell');
assert.ok(loopOf(), '(b) 12 steps, all succeeded');
assert.strictEqual(loopOf()!.pairs, 6);
// the first step of the loop is known (for Look, FR-045)
reset(); step('read'); step('read'); seq(['edit', 'shell', 'edit', 'shell'], false);
assert.strictEqual(loopOf()!.firstN, 3, 'the loop starts at the third step of the turn');
assert.strictEqual(loopOf()!.a, 'edit'); assert.strictEqual(loopOf()!.b, 'shell');
// a third tool clears it
reset(); seq(['edit', 'shell', 'edit', 'shell'], false);
assert.ok(loopOf());
step('read');
assert.strictEqual(loopOf(), null, 'a step of a third glyph completes: cleared');
// Think and replies are not steps and do not break a run
reset(); step('edit'); ev({ type: 'thinking', delta: 'hmm.' }); step('shell'); ev({ type: 'output', delta: 'ok.' }); step('edit'); ev({ type: 'thinking', delta: 'again.' }); step('shell', false);
assert.ok(loopOf(), 'thinking and replies between steps do not break the run');
// a running step (no completion yet) is not a step
reset(); seq(['edit', 'shell', 'edit']); ev({ type: 'toolCall', callId: 'z', phase: 'start', tool: 'bash', args: {} });
assert.strictEqual(loopOf(), null, 'only completed or failed calls are steps');
// "Other tool" counts as Shell; MCP and Web are glyphs of their own
reset(); step('edit'); ev({ type: 'toolCall', callId: 'o1', phase: 'start', tool: 'spawn_agent' }); ev({ type: 'toolCall', callId: 'o1', phase: 'complete', tool: 'spawn_agent' });
step('edit'); ev({ type: 'toolCall', callId: 'o2', phase: 'start', tool: 'unknown_thing' }); ev({ type: 'toolCall', callId: 'o2', phase: 'failed', tool: 'unknown_thing' });
assert.ok(loopOf() && loopOf()!.b === 'shell', 'an Other tool counts as Shell');
reset(); seq(['web', 'mcp', 'web', 'mcp'], false);
assert.ok(loopOf() && loopOf()!.a === 'web' && loopOf()!.b === 'mcp');
// a helper's steps never make the parent loop
reset();
for (const [g, ok] of [['edit', true], ['shell', true], ['edit', true], ['shell', false]] as const) step(g, ok, { agentId: 'task1' });
assert.strictEqual(loopOf(), null, 'helper steps do not count toward the parent\'s loop');
// the turn ending or stopping clears it
reset(); seq(['edit', 'shell', 'edit', 'shell'], false); ev({ type: 'status', status: 'idle' });
assert.strictEqual(loopOf(), null, 'the turn ended: cleared');
reset(); seq(['edit', 'shell', 'edit', 'shell'], false); ev({ type: 'status', status: 'stopped' });
assert.strictEqual(loopOf(), null, 'the turn was stopped: cleared');
reset(); seq(['edit', 'shell', 'edit', 'shell'], false); ev({ type: 'user' });
assert.strictEqual(loopOf(), null, 'a new turn starts clean');
// a late step of an ended turn never sets a loop
reset(); seq(['edit', 'shell', 'edit'], true); ev({ type: 'status', status: 'idle' }); step('shell', false);
assert.strictEqual(loopOf(), null, 'late events do not start a loop');
// once set it follows the run: more pairs, then it stays while A and B alternate
reset(); seq(['edit', 'shell', 'edit', 'shell'], false); step('edit'); step('shell');
assert.strictEqual(loopOf()!.pairs, 3, 'N follows the trailing run');
// the wording and the cost (FR-042)
reset(); ev({ type: 'usage', costUsd: 0.5 });
seq(['edit', 'shell']); ev({ type: 'usage', costUsd: 0.03 }); step('edit'); ev({ type: 'usage', costUsd: 0.05 }); step('shell', false);
assert.strictEqual(loopText(s), 'looping? Edit ↔ Shell · 2 times · ≈ $0.08', 'N pairs and the run\'s cost from the usage between its first step and now');
assert.strictEqual(s.sentence, 'Sven may be looping between Edit and Shell');
assert.ok(/^looping\? /.test(loopText(s)) && !/loop(ing)? detected|stuck|broken/i.test(loopText(s) + s.sentence), 'a question, never a verdict');
reset(); seq(['edit', 'shell', 'edit', 'shell'], false);
assert.strictEqual(loopText(s), 'looping? Edit ↔ Shell · 2 times · cost unknown', 'no usage event: cost unknown, never $0');
assert.strictEqual(loopText(s, 'cost hidden while sharing'), 'looping? Edit ↔ Shell · 2 times · cost hidden while sharing');
reset(); assert.strictEqual(loopText(s), '', 'not looping: no text');

console.log('brainloop: all checks passed');
