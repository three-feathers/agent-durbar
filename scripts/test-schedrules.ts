/**
 * Calendar rules of scheduled prompts (spec 044 Phase 2, FR-012): `nextRuleRun` in a fixed time zone with daylight saving
 * (Europe/Zurich: 2026-03-29 02:00 -> 03:00, 2026-10-25 03:00 -> 02:00), the renderer's copy agreeing with it, and the
 * scheduler keeping the time of day across a change. `npm run test:schedrules`. No session, no credits.
 */
process.env.TZ = 'Europe/Zurich'; // before anything reads the time zone
import * as assert from 'assert';
import * as path from 'path';
import { localTime, nextRuleRun, parseRule } from '../src/shared/schedrules';
import type { CalendarRule } from '../src/shared/schedrules';
import { harness } from './test-schedules';

const H = 3_600_000;
const L = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const hm = (t: number | undefined): string => (t === undefined ? 'none' : localTime(t));
const ymd = (t: number | undefined): string => (t === undefined ? 'none' : new Date(t).toDateString());

async function main(): Promise<void> {
  assert.strictEqual(new Date(Date.UTC(2026, 6, 1, 12)).getHours(), 14, 'the test runs in Europe/Zurich (CEST = UTC+2)');
  const daily = (time: string): CalendarRule => ({ kind: 'daily', time });

  // every day at: built from the local wall clock, so DST does not shift it (the FR-007 gap is fixed)
  {
    const spring = nextRuleRun(daily('08:30'), L(2026, 3, 28, 8, 30));
    assert.strictEqual(ymd(spring), new Date(2026, 2, 29).toDateString());
    assert.strictEqual(hm(spring), '08:30', 'spring forward: still 08:30');
    assert.strictEqual(spring! - L(2026, 3, 28, 8, 30), 23 * H, 'that day is 23 h long');
    const fall = nextRuleRun(daily('08:30'), L(2026, 10, 24, 8, 30));
    assert.strictEqual(hm(fall), '08:30', 'fall back: still 08:30');
    assert.strictEqual(fall! - L(2026, 10, 24, 8, 30), 25 * H, 'that day is 25 h long');
    // a time inside the skipped hour runs once that day, shifted by the gap; the next day is back at 02:30
    const gap = nextRuleRun(daily('02:30'), L(2026, 3, 29, 0, 0));
    assert.strictEqual(gap, Date.UTC(2026, 2, 29, 1, 30), 'spring: 02:30 does not exist, runs at 03:30 CEST');
    assert.strictEqual(hm(gap), '03:30');
    const after = nextRuleRun(daily('02:30'), gap!);
    assert.strictEqual(ymd(after), new Date(2026, 2, 30).toDateString());
    assert.strictEqual(hm(after), '02:30');
    // a time inside the repeated hour runs once, at its first occurrence
    const twice = nextRuleRun(daily('02:30'), L(2026, 10, 25, 0, 0));
    assert.strictEqual(twice, Date.UTC(2026, 9, 25, 0, 30), 'fall: the first 02:30 (CEST)');
    const next = nextRuleRun(daily('02:30'), twice!);
    assert.strictEqual(ymd(next), new Date(2026, 9, 26).toDateString(), 'not again at the second 02:30');
    assert.strictEqual(nextRuleRun(daily('02:30'), Date.UTC(2026, 9, 25, 0, 45)), L(2026, 10, 26, 2, 30), 'between the two 02:30s: tomorrow');
    // times already passed today, exactly now, later today
    assert.strictEqual(nextRuleRun(daily('09:00'), L(2026, 10, 20, 10, 0)), L(2026, 10, 21, 9, 0), 'passed today: tomorrow');
    assert.strictEqual(nextRuleRun(daily('09:00'), L(2026, 10, 20, 9, 0)), L(2026, 10, 21, 9, 0), 'exactly now: the next one');
    assert.strictEqual(nextRuleRun(daily('18:00'), L(2026, 10, 20, 9, 0)), L(2026, 10, 20, 18, 0), 'later today');
    assert.strictEqual(nextRuleRun(daily('00:00'), L(2026, 12, 31, 23, 59)), L(2027, 1, 1, 0, 0), 'over the year end');
  }
  // weekdays at: Monday to Friday, rolling over the weekend
  {
    const wd: CalendarRule = { kind: 'weekdays', time: '09:00' };
    assert.strictEqual(new Date(L(2026, 10, 23)).getDay(), 5, '2026-10-23 is a Friday');
    assert.strictEqual(nextRuleRun(wd, L(2026, 10, 23, 18, 0)), L(2026, 10, 26, 9, 0), 'Friday evening: Monday');
    assert.strictEqual(nextRuleRun(wd, L(2026, 10, 24, 8, 0)), L(2026, 10, 26, 9, 0), 'Saturday morning: Monday');
    assert.strictEqual(nextRuleRun(wd, L(2026, 10, 20, 8, 0)), L(2026, 10, 20, 9, 0), 'Tuesday before 09:00: today');
    assert.strictEqual(nextRuleRun(wd, L(2026, 10, 20, 10, 0)), L(2026, 10, 21, 9, 0), 'Tuesday after 09:00: Wednesday');
    // over the fall-back weekend: Friday 09:00 -> Monday 09:00 is 72 h + 1 h
    assert.strictEqual(nextRuleRun(wd, L(2026, 10, 23, 9, 0))! - L(2026, 10, 23, 9, 0), 73 * H, 'Monday at 09:00 local after the change');
  }
  // weekly on several days
  {
    const wk: CalendarRule = { kind: 'weekly', time: '17:00', days: [1, 4] }; // Monday and Thursday
    assert.strictEqual(nextRuleRun(wk, L(2026, 10, 20, 12, 0)), L(2026, 10, 22, 17, 0), 'Tuesday: Thursday');
    assert.strictEqual(nextRuleRun(wk, L(2026, 10, 22, 17, 0)), L(2026, 10, 26, 17, 0), 'Thursday at 17:00: Monday');
    assert.strictEqual(nextRuleRun(wk, L(2026, 10, 22, 16, 59)), L(2026, 10, 22, 17, 0), 'Thursday just before: today');
    assert.strictEqual(nextRuleRun(wk, L(2026, 10, 24, 12, 0)), L(2026, 10, 26, 17, 0), 'Saturday: Monday');
    const sun: CalendarRule = { kind: 'weekly', time: '17:00', days: [0] };
    assert.strictEqual(nextRuleRun(sun, L(2026, 10, 25, 18, 0)), L(2026, 11, 1, 17, 0), 'one day a week, passed: seven days on');
    assert.strictEqual(nextRuleRun({ kind: 'weekly', time: '17:00', days: [] }, L(2026, 10, 20)), undefined, 'no day: never');
    assert.strictEqual(nextRuleRun({ kind: 'daily', time: '7:00' }, L(2026, 10, 20)), undefined, 'a bad time: never');
  }
  // parseRule (untrusted input)
  {
    assert.deepStrictEqual(parseRule({ kind: 'weekdays', time: '09:00', days: [1] }), { kind: 'weekdays', time: '09:00' }, 'days only for weekly');
    assert.deepStrictEqual(parseRule({ kind: 'weekly', time: '23:59', days: [6, 0, 6, 7, -1, 2.5, '1'] }), { kind: 'weekly', time: '23:59', days: [0, 6] });
    for (const bad of [null, 'daily', {}, { kind: 'daily' }, { kind: 'daily', time: '24:00' }, { kind: 'daily', time: '08:60' }, { kind: 'hourly', time: '08:00' }, { kind: 'weekly', time: '08:00' }]) assert.strictEqual(parseRule(bad), undefined, JSON.stringify(bad));
  }
  // the renderer's copy (simulator) gives the same next run as main's, on a matrix over both DST changes
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'schedtemplates.js')) as { parseRule: (v: unknown) => unknown; nextRuleRun: (r: CalendarRule, after: number) => number | undefined };
    const rules: CalendarRule[] = [daily('00:00'), daily('02:30'), daily('08:30'), daily('23:59'), { kind: 'weekdays', time: '09:00' }, { kind: 'weekly', time: '02:15', days: [0] }, { kind: 'weekly', time: '17:00', days: [1, 3, 5] }];
    let n = 0;
    for (const start of [L(2026, 3, 20), L(2026, 10, 18), L(2026, 12, 28)]) {
      for (let t = start; t < start + 14 * 24 * H; t += 7 * H + 13 * 60_000) {
        for (const r of rules) {
          assert.strictEqual(T.nextRuleRun(r, t), nextRuleRun(r, t), `${JSON.stringify(r)} after ${new Date(t).toString()}`);
          n++;
        }
      }
    }
    assert.ok(n > 500, `compared ${n} cases`);
    for (const v of [{ kind: 'weekly', time: '23:59', days: [6, 0, 6, 7] }, { kind: 'daily', time: '24:00' }, { kind: 'weekdays', time: '09:00' }]) assert.deepStrictEqual(T.parseRule(v), parseRule(v));
  }
  // the scheduler with a rule: across the fall-back weekend a daily 08:30 stays at 08:30, and weekdays skip the weekend
  {
    const h = harness({ pausedAll: false, schedules: [] }, L(2026, 10, 23, 8, 0)); // Friday 08:00
    h.sch.start();
    const d = h.sch.save({ folder: '/w', prompt: 'daily', rule: { kind: 'daily', time: '08:30' } }, () => true);
    const w = h.sch.save({ folder: '/w', prompt: 'weekdays', rule: { kind: 'weekdays', time: '08:45' } }, () => true);
    assert.ok(d.ok && w.ok);
    assert.strictEqual(d.ok && d.schedule.next, L(2026, 10, 23, 8, 30), 'the first run today at 08:30');
    for (let i = 0; i < 4 * 24 * 4; i++) await h.advance(15 * 60_000); // through Tuesday 08:00 in 15-minute steps
    assert.deepStrictEqual(h.sent.filter((x) => x.endsWith('daily')).length, 4, 'Fri, Sat, Sun, Mon');
    assert.deepStrictEqual(h.sent.filter((x) => x.endsWith('weekdays')).length, 2, 'Fri and Mon only');
    assert.strictEqual(hm(h.sch.doc.schedules[0].next), '08:30', 'still 08:30 after the change (not 07:30)');
    assert.strictEqual(h.sch.doc.schedules[0].next, L(2026, 10, 27, 8, 30));
    assert.strictEqual(h.sch.doc.schedules[1].next, L(2026, 10, 27, 8, 45));
    // a busy skip and a missed start keep the rule's time
    h.busy.add('/w');
    await h.advance(L(2026, 10, 27, 8, 31) - h.now);
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    assert.strictEqual(h.sch.doc.schedules[0].next, L(2026, 10, 28, 8, 30));
    const h2 = harness({ pausedAll: false, schedules: h.sch.doc.schedules.map((x) => ({ ...x })) }, L(2026, 10, 31, 12, 0)); // Saturday noon
    h2.sch.start();
    assert.strictEqual(h2.sch.doc.schedules[0].last?.outcome, 'missed');
    assert.strictEqual(h2.sch.doc.schedules[0].next, L(2026, 11, 1, 8, 30), 'Sunday 08:30');
    assert.strictEqual(h2.sch.doc.schedules[1].next, L(2026, 11, 2, 8, 45), 'weekdays: Monday 08:45');
  }
  console.log('schedule rules tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
