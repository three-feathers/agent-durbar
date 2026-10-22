/** Spec 068: the coffee break core (resume rules with a fake clock, words) and the adapters' usage-limit mapping (fixtures). No credits. */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import { ClaudeMapper, claudeUsageLimit } from '../src/adapters/claudeMap';
import { CodexMapper, codexRateLimit } from '../src/adapters/codexMap';
import { EventMapper, copilotUsageLimit } from '../src/adapters/map';
import type { EventBody } from '../src/adapters/map';
import { copilotQuotaReset, resetMs } from '../src/adapters/usagelimit';
import { eventProblems as validateEvent } from '../src/adapters/eventguard';
import { AgentStateTracker } from '../src/main/mcp/agentstate';
import type { AgentEvent } from '../src/adapters/types';

interface Break { id: string; kind: string; phase: string; resetsAt?: number; estimated: boolean; paid: boolean; source: string; noAuto: boolean }
interface Breaks {
  start(id: string, info: Record<string, unknown>, policy: string): Break | null;
  get(id: string): Break | null; has(id: string): boolean; autoResumes(id: string): boolean;
  end(id: string): boolean; resumed(id: string): boolean; stay(id: string): boolean;
  tick(): { type: string; id: string }[]; size(): number;
}
const C = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'coffeebreak.js')) as {
  RESUME_TEXT: string;
  createBreaks(o: Record<string, unknown>): Breaks;
  whenText(ts: number, now: number, o?: Record<string, unknown>): string;
  untilText(b: Break | null, auto: boolean, now: number, o?: Record<string, unknown>): string;
};

let clock = Date.UTC(2026, 9, 21, 12, 0, 0);
const now = (): number => clock;
const MIN = 60000;
const mk = (o: Record<string, unknown> = {}): Breaks => C.createBreaks({ now, ...o });

// 1. A plan window with a reset time and the default setting resumes by itself, at the reset plus the 60 s margin, never before.
{
  const b = mk();
  b.start('ada', { kind: 'provider', app: 'claude', resetsAt: clock + 10 * MIN, source: 'Claude 5-hour window' }, 'auto');
  assert.ok(b.autoResumes('ada'));
  clock += 10 * MIN; assert.deepStrictEqual(b.tick(), [], 'not at the reset itself');
  clock += 59_000; assert.deepStrictEqual(b.tick(), [], 'not before the margin');
  clock += 1000; assert.deepStrictEqual(b.tick(), [{ type: 'resume', id: 'ada' }]);
  assert.deepStrictEqual(b.tick(), [], 'each action once');
  assert.strictEqual(b.get('ada')!.phase, 'resuming');
  b.resumed('ada'); assert.strictEqual(b.has('ada'), false);
}
// 2. Ask me (the setting), a paid quota (Q1), and Durbar's own cap (Q2): never by themselves.
{
  const b = mk();
  b.start('a', { kind: 'provider', app: 'x', resetsAt: clock + MIN }, 'ask');
  b.start('p', { kind: 'provider', app: 'copilot', resetsAt: clock + MIN, paid: true }, 'auto');
  b.start('c', { kind: 'cap', app: 'copilot' }, 'auto');
  assert.ok(!b.autoResumes('a') && !b.autoResumes('p') && !b.autoResumes('c'));
  clock += 2 * MIN;
  assert.deepStrictEqual(b.tick(), [{ type: 'ask', id: 'a' }, { type: 'ask', id: 'p' }], 'they ask at the reset; the cap waits for the user');
  clock += 2 * 3600_000; assert.deepStrictEqual(b.tick(), [], 'no reminder for a cap, nothing twice');
}
// 3. No reset time (Q4): no resume, one reminder after an hour.
{
  const b = mk();
  b.start('r', { kind: 'provider', app: 'copilot', source: 'Copilot rate limit' }, 'auto');
  assert.ok(!b.autoResumes('r'));
  clock += 59 * MIN; assert.deepStrictEqual(b.tick(), []);
  clock += MIN; assert.deepStrictEqual(b.tick(), [{ type: 'remind', id: 'r' }]);
  clock += 5 * 3600_000; assert.deepStrictEqual(b.tick(), [], 'one reminder only');
  // a reset time read later (Copilot getQuota) joins the same break
  const t0 = b.get('r')!;
  b.start('r', { kind: 'provider', app: 'copilot', resetsAt: clock + MIN, estimated: true }, 'auto');
  assert.strictEqual(b.get('r'), t0); assert.strictEqual(t0.estimated, true);
}
// 4. Same app: one at a time, 20 s apart; a re-hit within 2 min stops automatic resumes for it and the app's others.
{
  const b = mk();
  const r = clock + MIN;
  for (const id of ['a1', 'a2', 'a3']) b.start(id, { kind: 'provider', app: 'claude', resetsAt: r }, 'auto');
  b.start('x1', { kind: 'provider', app: 'codex', resetsAt: r }, 'auto');
  clock = r + 60_000;
  assert.deepStrictEqual(b.tick(), [{ type: 'resume', id: 'a1' }, { type: 'resume', id: 'x1' }], 'one per app');
  b.resumed('a1'); b.resumed('x1');
  clock += 10_000; assert.deepStrictEqual(b.tick(), [], 'the gap');
  clock += 10_000; assert.deepStrictEqual(b.tick(), [{ type: 'resume', id: 'a2' }]);
  b.resumed('a2');
  clock += 5000;
  b.start('a2', { kind: 'provider', app: 'claude', resetsAt: clock + 3600_000 }, 'auto'); // hit again
  assert.ok(!b.autoResumes('a2') && !b.autoResumes('a3'), 're-hit: the app stops resuming by itself');
  clock += 30_000; assert.deepStrictEqual(b.tick(), [{ type: 'ask', id: 'a3' }], 'the waiting one asks instead');
  clock += 3 * MIN;
  b.start('a1', { kind: 'provider', app: 'claude', resetsAt: clock + MIN }, 'auto'); // long after its resume: a new break
  assert.ok(b.autoResumes('a1'));
}
// 5. Late (the computer slept through the reset) asks; Stay on break asks; end forgets.
{
  const b = mk();
  b.start('s', { kind: 'provider', app: 'claude', resetsAt: clock + MIN }, 'auto');
  b.start('t', { kind: 'provider', app: 'codex', resetsAt: clock + MIN }, 'auto');
  b.stay('t');
  clock += MIN + 60_000 + 6 * MIN;
  assert.deepStrictEqual(b.tick(), [{ type: 'ask', id: 's' }, { type: 'ask', id: 't' }]);
  b.end('s'); assert.strictEqual(b.has('s'), false);
}
// 6. Words.
{
  const o = { locale: 'en-GB', timeZone: 'UTC' };
  const n = Date.UTC(2026, 9, 21, 9, 0);
  assert.strictEqual(C.whenText(Date.UTC(2026, 9, 21, 14, 30), n, o), '14:30');
  assert.strictEqual(C.whenText(Date.UTC(2026, 9, 23, 9, 0), n, o), 'Fri 9:00');
  assert.strictEqual(C.whenText(Date.UTC(2026, 10, 1, 0, 0), n, o), '1 Nov');
  const b = { id: 'a', kind: 'provider', phase: 'on', resetsAt: Date.UTC(2026, 9, 21, 14, 30), estimated: false, paid: false, source: '', noAuto: false };
  assert.strictEqual(C.untilText(b, true, n, o), 'resumes at 14:30');
  assert.strictEqual(C.untilText(b, false, n, o), 'the limit resets at 14:30');
  assert.strictEqual(C.untilText({ ...b, estimated: true }, true, n, o), 'resumes at 14:30 (estimate)');
  assert.strictEqual(C.untilText({ ...b, resetsAt: undefined }, false, n, o), 'the limit resets later');
  assert.strictEqual(C.untilText({ ...b, kind: 'cap' }, false, n, o), 'until you raise the limit');
  assert.strictEqual(C.untilText({ ...b, phase: 'back' }, false, n, o), 'the limit has reset. Resume?');
  assert.ok(/^The usage limit has reset\./.test(C.RESUME_TEXT));
}

// 7. Adapters (FR-002), with the event guard on every usageLimit they make.
const T = Date.UTC(2026, 9, 21, 12, 0);
const valid = (b: EventBody): void => assert.deepStrictEqual(validateEvent({ ...b, sessionId: 's', timestamp: 1 }), [], JSON.stringify(b));
{
  assert.strictEqual(resetMs(1792000000, T), undefined, 'more than 31 days away');
  assert.strictEqual(resetMs(T / 1000 + 3600, T), T + 3600_000, 'seconds');
  assert.strictEqual(resetMs(T + 60_000, T), T + 60_000, 'ms');
  assert.strictEqual(resetMs('2026-11-01T00:00:00Z', T), Date.UTC(2026, 10, 1));
  assert.strictEqual(resetMs('soon', T), undefined);
  assert.strictEqual(resetMs(-5, T), undefined);
  // 2026-10-22: a reset that is not in the future is stale (spec edge case "in the past": unknown), never a resume at once
  assert.strictEqual(resetMs(T - 60_000, T), undefined, 'a minute in the past');
  assert.strictEqual(resetMs(T, T), undefined, 'now');
}
{
  const l = claudeUsageLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: T / 1000 + 7200, rateLimitType: 'five_hour' } }, T)!;
  assert.deepStrictEqual(l, { type: 'usageLimit', scope: 'plan', resetsAt: T + 7200_000, source: 'Claude 5-hour window' }); valid(l);
  assert.strictEqual(claudeUsageLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } }, T), null, 'a warning is not a break');
  const c = claudeUsageLimit({ type: 'rate_limit_event', rate_limit_info: { errorCode: 'credits_required' } }, T)!;
  assert.deepStrictEqual(c, { type: 'usageLimit', scope: 'quota', paid: true, source: 'Claude extra usage' }); valid(c);
  const w = claudeUsageLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: '<b>weird</b>' } }, T)!;
  assert.strictEqual(w.source, 'Claude usage limit', 'unknown window names are never shown');
  // the mapper: one break per turn; the turn's error result ends quietly as idle
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b));
  m.map({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } });
  m.map({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } });
  m.map({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached' });
  assert.deepStrictEqual(out.map((e) => e.type === 'status' ? `${e.status}:${e.intent}` : e.type), ['usageLimit', 'idle:Usage limit reached']);
  out.length = 0;
  m.map({ type: 'result', subtype: 'success', is_error: true, result: 'boom' });
  assert.deepStrictEqual(out.map((e) => e.type === 'status' ? e.status : e.type), ['error'], 'the next turn errors as before');
  // 2026-10-22: rejected, then the turn goes on and succeeds (fallback or overage; unverified that Claude does this): a plain idle
  out.length = 0;
  m.map({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
  m.map({ type: 'result', subtype: 'success', is_error: false, result: 'all done' });
  assert.deepStrictEqual(out.map((e) => e.type === 'status' ? `${e.status}:${e.intent}` : e.type), ['usageLimit', 'idle:undefined'], 'a successful result stays a plain idle');
}
{
  const p = { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: T / 1000 + 600 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: T / 1000 + 86400 } } };
  assert.deepStrictEqual(codexRateLimit(p, T), { resetsAt: T + 600_000, label: '5-hour window' });
  assert.strictEqual(codexRateLimit({ rateLimits: { primary: { usedPercent: 99 } } }, T), undefined);
  assert.strictEqual(codexRateLimit({}, T), undefined);
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  m.map({ method: 'thread/started', params: { thread: { id: 'th', cwd: '/w' } } });
  m.map({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: Math.round(Date.now() / 1000) + 3600 } } } });
  out.length = 0;
  m.map({ method: 'turn/completed', params: { threadId: 'th', turn: { status: 'failed', error: { message: 'You hit your usage limit', codexErrorInfo: 'UsageLimitExceeded' } } } });
  assert.strictEqual(out.length, 2);
  const l = out[0] as EventBody & { type: 'usageLimit' };
  assert.ok(l.type === 'usageLimit' && l.scope === 'plan' && l.source === 'Codex weekly limit' && typeof l.resetsAt === 'number'); valid(l);
  assert.deepStrictEqual(out[1], { type: 'status', status: 'idle', intent: 'Usage limit reached' });
  // 2026-10-22: a window update read long ago whose reset has passed gives no reset time (not a resume at once)
  out.length = 0;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * 3600_000;
    m.map({ method: 'turn/completed', params: { threadId: 'th', turn: { status: 'failed', error: { message: 'You hit your usage limit', codexErrorInfo: 'UsageLimitExceeded' } } } });
  } finally { Date.now = realNow; }
  assert.strictEqual((out[0] as EventBody & { type: 'usageLimit' }).resetsAt, undefined, 'a stale reset is unknown');
}
{
  assert.deepStrictEqual(copilotUsageLimit('rate_limit', 'user_weekly_rate_limited'), { type: 'usageLimit', scope: 'rate', source: 'Copilot weekly limit' });
  assert.deepStrictEqual(copilotUsageLimit('quota', 'quota_exceeded'), { type: 'usageLimit', scope: 'quota', paid: true, source: 'Copilot premium requests' });
  assert.strictEqual(copilotUsageLimit('quota', 'billing_not_configured'), null, 'no wait fixes billing');
  assert.strictEqual(copilotUsageLimit('authentication', undefined), null);
  assert.strictEqual(copilotUsageLimit('rate_limit', '__proto__')!.source, 'Copilot rate limit');
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'session.error', data: { errorType: 'rate_limit', errorCode: 'rate_limited', message: 'Too many requests' } });
  assert.deepStrictEqual(out.map((e) => e.type === 'status' ? `${e.status}:${e.intent}` : e.type), ['usageLimit', 'idle:Usage limit reached']);
  valid(out[0]);
  out.length = 0;
  m.map({ type: 'session.error', data: { errorType: 'quota', errorCode: 'billing_not_configured', message: 'no billing' } });
  assert.deepStrictEqual(out.map((e) => e.type === 'status' ? e.status : e.type), ['error']);
  assert.deepStrictEqual(copilotQuotaReset({ quotaSnapshots: { chat: { remainingPercentage: 100 }, premium_interactions: { resetDate: '2026-11-01T00:00:00Z', resetDateEstimated: true } } }, T), { resetsAt: Date.UTC(2026, 10, 1), estimated: true });
  assert.deepStrictEqual(copilotQuotaReset({ quotaSnapshots: { premium_interactions: { resetDateEpochMs: T + 5000 } } }, T), { resetsAt: T + 5000, estimated: false });
  assert.strictEqual(copilotQuotaReset({ quotaSnapshots: { chat: { remainingPercentage: 50 } } }, T), undefined);
  assert.strictEqual(copilotQuotaReset(null, T), undefined);
}
{
  const bad = (o: Record<string, unknown>): string[] => validateEvent({ type: 'usageLimit', sessionId: 's', timestamp: 1, ...o });
  assert.ok(bad({ scope: 'x', source: 'a' }).length);
  assert.ok(bad({ scope: 'plan', source: '' }).length);
  assert.ok(bad({ scope: 'plan', source: 'x'.repeat(61) }).length);
  assert.ok(bad({ scope: 'plan', source: 'a', resetsAt: -1 }).length);
  assert.ok(bad({ scope: 'plan', source: 'a', paid: 'yes' }).length);
  assert.ok(bad({ scope: 'plan', source: 'a', update: 1 }).length);
  assert.deepStrictEqual(bad({ scope: 'rate', source: 'a', resetsAt: 5, estimated: true, paid: false, update: true }), []);
}

// 8. The MCP read state mirrors the window (spec 041): Waiting, Coffee break; the turn's closing idle keeps it; working or a send ends it.
{
  const ev = (o: Record<string, unknown>): AgentEvent => ({ sessionId: 'a', timestamp: 1, ...o }) as unknown as AgentEvent;
  const t = new AgentStateTracker();
  t.ensure('a');
  t.onEvent(ev({ type: 'status', status: 'working' }));
  t.onEvent(ev({ type: 'usageLimit', scope: 'plan', source: 'x' }));
  t.onEvent(ev({ type: 'status', status: 'idle', intent: 'Usage limit reached' }));
  assert.deepStrictEqual([t.get('a')!.word, t.get('a')!.subLabel], ['Waiting', 'Coffee break']);
  t.onEvent(ev({ type: 'status', status: 'idle' }));
  assert.deepStrictEqual([t.get('a')!.word, t.get('a')!.subLabel], ['Waiting', 'Coffee break'], 'one trailing plain idle of the same turn keeps the break');
  t.onEvent(ev({ type: 'status', status: 'error', intent: 'x' }));
  assert.deepStrictEqual([t.get('a')!.word, t.get('a')!.subLabel], ['Error', null], '2026-10-22: a later real error ends the break and shows');
  t.onEvent(ev({ type: 'status', status: 'working' }));
  assert.strictEqual(t.get('a')!.word, 'Working');
  // 2026-10-22: rejected, then the turn goes on and succeeds: the plain idle ends the break, Done
  t.onEvent(ev({ type: 'usageLimit', scope: 'plan', source: 'x' }));
  t.onEvent(ev({ type: 'output', text: 'more' }));
  t.onEvent(ev({ type: 'status', status: 'idle' }));
  assert.deepStrictEqual([t.get('a')!.word, t.get('a')!.subLabel, t.onBreak('a')], ['Done', 'Done', false], 'a successful turn ends the break');
  // a late update (Copilot reset time read afterwards) of a break that already ended is ignored; during the break it joins it
  t.onEvent(ev({ type: 'usageLimit', scope: 'quota', source: 'x', resetsAt: 5, update: true }));
  assert.strictEqual(t.onBreak('a'), false, 'a late update starts no new break');
  t.onEvent(ev({ type: 'usageLimit', scope: 'quota', source: 'x' }));
  t.onEvent(ev({ type: 'usageLimit', scope: 'quota', source: 'x', resetsAt: 5, update: true }));
  assert.strictEqual(t.onBreak('a'), true);
  t.onEvent(ev({ type: 'status', status: 'working' }));
  assert.strictEqual(t.get('a')!.word, 'Working', 'working again ends the break');
  t.onEvent(ev({ type: 'usageLimit', scope: 'plan', source: 'x' }));
  t.noteSend('a');
  t.onEvent(ev({ type: 'status', status: 'idle' }));
  assert.deepStrictEqual([t.get('a')!.word, t.get('a')!.subLabel], ['Done', 'Done'], 'a send ends the break');
  t.onEvent(ev({ type: 'usageLimit', scope: 'plan', source: 'x' }));
  t.onEvent(ev({ type: 'status', status: 'idle', intent: 'Aborted' }));
  assert.strictEqual(t.get('a')!.word, 'Idle', 'Stop ends the break');
  // FR-008: main skips a scheduled run while the agent is on a break (a usage limit or Durbar's cap)
  assert.strictEqual(t.onBreak('a'), false);
  t.onEvent(ev({ type: 'usageLimit', scope: 'rate', source: 'x' }));
  assert.strictEqual(t.onBreak('a'), true);
  t.onEvent(ev({ type: 'status', status: 'working' }));
  t.onEvent(ev({ type: 'limit', phase: 'exhausted', requestId: 'r' }));
  assert.strictEqual(t.onBreak('a'), true, 'the cap is a break too');
  assert.strictEqual(t.onBreak('nobody'), false);
}

// 9. The setting (FR-006): resume by itself by default; only 'ask' is written; junk keeps the value.
{
  assert.deepStrictEqual(parseSettings('{"breakResume":"ask"}'), { breakResume: 'ask' });
  for (const v of ['"auto"', '"ASK"', 'true', '1', 'null']) assert.deepStrictEqual(parseSettings('{"breakResume":' + v + '}'), {}, 'only ask is kept: ' + v);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-coffee-'));
  const f = path.join(dir, 's.json');
  const ss = new SettingsStore(f);
  ss.load();
  assert.strictEqual(ss.breakResume, 'auto');
  for (const junk of ['no', 0, null, undefined, {}, true]) assert.strictEqual(ss.setBreakResume(junk), 'auto', 'junk: ' + String(junk));
  assert.strictEqual(ss.setBreakResume('ask'), 'ask');
  const back = new SettingsStore(f); back.load();
  assert.strictEqual(back.breakResume, 'ask', 'kept after a restart');
  back.setBreakResume('auto');
  assert.ok(!('breakResume' in JSON.parse(fs.readFileSync(f, 'utf8'))), 'the default is not written');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 10. Wiring: the page loads the helper before app.js and the build copies it.
{
  const ROOT = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="coffeebreak.js"') > 0 && html.indexOf('src="coffeebreak.js"') < html.indexOf('src="app.js"'));
  assert.ok(/'coffeebreak\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')));
}

console.log('coffee break tests passed');
