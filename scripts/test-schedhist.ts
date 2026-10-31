/** A schedule's run history (spec 044 FR-040..FR-042): the words and icon of every outcome and reason, the folded and empty texts, an item's parts, the Schedules here label. `npm run test:schedhist`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { MAX_PROMPT, waitingForMode } from '../src/main/schedules';

type Run = { at: number; outcome: string; session?: string; reason?: string; manual?: true; n?: number; until?: number };
type Item = { time: string; words: string; fold: string; kind: string; session: string; chat: string; closed: boolean };
const H = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'schedhist.js')) as {
  OUTCOMES: Record<string, { word: string; kind: string }>;
  REASONS: Record<string, string>;
  KINDS: string[];
  lastWord(last: { at: number; outcome: string; reason?: string }): string;
  waitingForMode(s: unknown): boolean;
  outcomeWord(o: string): string;
  kindOf(o: string): string;
  reasonWords(c: unknown): string;
  runWords(r: Run): string;
  foldText(r: Run, clockOf?: (ms: number) => string): string;
  runText(r: Run, clockOf?: (ms: number) => string, nameOf?: (s: string) => string): Item;
  emptyText(last: { at: number; outcome: string } | undefined, clockOf?: (ms: number) => string, since?: number): string;
  hereLabel(n: number): string;
  listName(p: string): string;
  iconSvg(kind: string): string;
};
const ROOT = path.join(__dirname, '..', '..');
const clockOf = (ms: number): string => 'T' + ms; // locale-free

// every outcome main can write has words and an icon (a new Outcome in schedules.ts fails here until it is added)
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'schedules.ts'), 'utf8');
const outcomes = [...(/export type Outcome = ([^;]+);/.exec(mainSrc)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
assert.ok(outcomes.length >= 10, 'read main\'s Outcome list');
for (const o of outcomes) {
  assert.ok(H.OUTCOMES[o] && H.OUTCOMES[o].word.length > 3, `outcome "${o}" has words`);
  assert.ok(H.KINDS.includes(H.OUTCOMES[o].kind), `outcome "${o}" has an icon kind`);
  assert.ok(H.runWords({ at: 1, outcome: o }).length > 3, `run of "${o}" reads in words`);
}
assert.deepStrictEqual(Object.keys(H.OUTCOMES).sort(), [...outcomes].sort(), 'no word for an outcome main does not have');
// every reason main can write (RunReason = no-agent | send-error | LoopEndReason) has fixed words
const endReasons = [...(/export type LoopEndReason = ([^;]+);/.exec(mainSrc)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
const modeReasons = ['no-mode', 'other-agent', 'mode-org', 'mode-lacking', 'mode-live', 'mode-limit', 'mode-autopilot', 'mode-loop-autopilot', 'no-seal']; // spec 044 FR-181..FR-184
for (const r of ['no-agent', 'send-error', ...endReasons, ...modeReasons]) assert.ok(H.reasonWords(r).length > 3, `reason "${r}" has words`);
assert.deepStrictEqual(Object.keys(H.REASONS).sort(), ['no-agent', 'send-error', ...endReasons, ...modeReasons].sort());
// spec 044 FR-181, FR-183: the window's rule is main's, and a refusal says why on the row and in the history
for (const s of [{}, { mode: 'ask' }, { mode: 'autopilot' }, { done: true }, { done: true, last: { at: 1, outcome: 'skipped-mode' } }, { done: true, mode: 'ask', last: { at: 1, outcome: 'skipped-mode' } }, { paused: true }, { loop: { ended: { at: 1 } } }, { loop: {} }]) {
  assert.strictEqual(H.waitingForMode(s), waitingForMode(s as never), `the same rule as main: ${JSON.stringify(s)}`);
}
assert.strictEqual(H.lastWord({ at: 1, outcome: 'mode-refused', reason: 'mode-org' }), "not sent: this mode was refused: your organization's policy refuses it");
assert.strictEqual(H.lastWord({ at: 1, outcome: 'mode-refused', reason: 'mode-autopilot' }), 'not sent: this mode was refused: Autopilot is not available on a schedule yet');
assert.strictEqual(H.lastWord({ at: 1, outcome: 'skipped-mode', reason: 'other-agent' }), 'not sent: waiting for a mode: it would have gone to another agent than the one chosen');
assert.strictEqual(H.lastWord({ at: 1, outcome: 'sent', reason: 'mode-org' }), 'sent', 'only where it explains the outcome');
assert.strictEqual(H.runWords({ at: 1, outcome: 'skipped-mode', reason: 'no-mode' }), 'Not sent: waiting for a mode: no mode was chosen');
assert.strictEqual(H.kindOf('skipped-mode'), 'stop');
assert.strictEqual(H.kindOf('mode-refused'), 'stop');
assert.strictEqual(H.reasonWords('/home/me/.ssh'), '', 'an unknown code gives no words (no text from the file is shown)');
assert.strictEqual(H.reasonWords('__proto__'), '');
assert.strictEqual(H.reasonWords(undefined), '');
assert.strictEqual(H.outcomeWord('constructor'), 'constructor', 'an unknown outcome shows as it is, never an inherited property');
assert.ok(!/[^\x20-\x7e]/.test(Object.values(H.OUTCOMES).map((o) => o.word).join('')), 'plain words, no emoji');

// the words, as the spec lists them
assert.strictEqual(H.runWords({ at: 1, outcome: 'sent' }), 'Sent');
assert.strictEqual(H.runWords({ at: 1, outcome: 'sent', manual: true }), 'Sent (Run now)');
assert.strictEqual(H.runWords({ at: 1, outcome: 'skipped-busy' }), 'Skipped: the agent was busy');
assert.strictEqual(H.runWords({ at: 1, outcome: 'skipped-paused' }), 'Skipped: paused');
assert.strictEqual(H.runWords({ at: 1, outcome: 'skipped-cap' }), 'Not sent: reached its limit');
assert.strictEqual(H.runWords({ at: 1, outcome: 'skipped-ended' }), 'Not sent: the session has ended');
assert.strictEqual(H.runWords({ at: 1, outcome: 'missed' }), 'Missed: the app was closed');
assert.strictEqual(H.runWords({ at: 1, outcome: 'failed' }), 'Could not send');
assert.strictEqual(H.runWords({ at: 1, outcome: 'failed', reason: 'no-agent' }), 'Could not send: no agent in this folder');
assert.strictEqual(H.runWords({ at: 1, outcome: 'failed', reason: 'send-error', manual: true }), 'Could not send (Run now): the agent app refused it');
assert.strictEqual(H.runWords({ at: 1, outcome: 'ended', reason: 'user' }), 'Loop ended: stopped by you');
assert.strictEqual(H.runWords({ at: 1, outcome: 'sent', reason: 'no-agent' }), 'Sent', 'a reason only shows where it explains the outcome');
assert.strictEqual(H.runWords(undefined as unknown as Run), '');
// the row's line uses the same table
assert.strictEqual(H.outcomeWord('held'), 'held: not sent yet (closed door, update or break)');
assert.strictEqual(H.outcomeWord('skipped-door-full'), 'not kept: the closed door already holds as many prompts as it can');
assert.strictEqual(H.outcomeWord('skipped-review'), 'not sent: the prompt is over 10,000 characters, shorten it with Edit'); // spec 044 FR-124
assert.strictEqual(H.kindOf('skipped-review'), 'stop');
assert.ok(H.outcomeWord('skipped-review').includes(MAX_PROMPT.toLocaleString('en-US')), 'the word names main\'s limit (the one figure written in words)');

// folded repeats
assert.strictEqual(H.foldText({ at: 1, outcome: 'skipped-busy', n: 4, until: 9 }, clockOf), '4 times, until T9');
assert.strictEqual(H.foldText({ at: 1, outcome: 'skipped-busy', n: 2 }, clockOf), '2 times');
assert.strictEqual(H.foldText({ at: 1, outcome: 'skipped-busy' }, clockOf), '');
assert.strictEqual(H.foldText({ at: 1, outcome: 'skipped-busy', n: 1, until: 5 }, clockOf), '', 'a count of 1 is not a repeat');

// one item: where it went (FR-041)
const names: Record<string, string> = { a1: 'Ada' };
const nameOf = (s: string): string => names[s] ?? '';
const live = H.runText({ at: 100, outcome: 'sent', session: 'a1' }, clockOf, nameOf);
assert.deepStrictEqual([live.time, live.words, live.fold, live.kind, live.session, live.chat, live.closed], ['T100', 'Sent', '', 'sent', 'a1', 'Ada', false]);
const gone = H.runText({ at: 100, outcome: 'sent', session: 'zz' }, clockOf, nameOf);
assert.deepStrictEqual([gone.closed, gone.chat], [true, ''], 'a session that is gone shows "chat closed" (no button)');
const none = H.runText({ at: 100, outcome: 'missed' }, clockOf, nameOf);
const folded = H.runText({ at: 100, outcome: 'skipped-busy', n: 3, until: 130 }, clockOf, nameOf);

// the empty state
assert.strictEqual(H.emptyText(undefined, clockOf), 'No runs yet.');
assert.strictEqual(H.emptyText({ at: 50, outcome: 'sent' }, clockOf), 'No runs yet. Runs are kept from the update that added this list on; the last one before that: sent, T50.');
assert.strictEqual(H.emptyText({ at: 50, outcome: 'missed' }, clockOf, 10), 'No runs yet. Runs are kept from T10 on; the last one before that: missed: the app was closed, T50.');

// Schedules here (N): no number at 0 (owner Q4)
assert.strictEqual(H.hereLabel(0), 'Schedules here');
assert.strictEqual(H.hereLabel(1), 'Schedules here (1)');
assert.strictEqual(H.hereLabel(50), 'Schedules here (50)');
assert.strictEqual(H.hereLabel(NaN), 'Schedules here');
assert.strictEqual(H.hereLabel(-3), 'Schedules here');

// the list's name and the icons: inline, currentColor, hidden from screen readers, no emoji
assert.strictEqual(H.listName('Summarise the PRs'), 'Runs of Summarise the PRs');
for (const k of [...H.KINDS, 'nope']) {
  const svg = H.iconSvg(k);
  assert.ok(/^<svg /.test(svg) && svg.includes('stroke="currentColor"') && svg.includes('aria-hidden="true"'), `icon ${k}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(svg), 'no colour in the icon');
}
// the module is plain: no DOM, no storage, no clock
const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'schedhist.js'), 'utf8');
assert.ok(!/\b(document|window\.|localStorage|Date\.now|new Date)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'schedhist.js is pure');
console.log('test-schedhist: ok');
