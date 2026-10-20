/**
 * Calendar rules of scheduled prompts (spec 044 Phase 2, FR-012): "every day at", "weekdays at" and "weekly on <days> at" a
 * local time of day. Pure: no I/O, no timers. The next run is built from the local calendar date and wall-clock time
 * (`new Date(y, m, d, h, min)`), never by adding 24 hours, so a run keeps its time of day across a daylight-saving change.
 *
 * Daylight saving (the platform's local time zone, as `Date` sees it):
 * - spring forward: a time inside the skipped hour (for example 02:30 in Europe/Zurich on the last Sunday of March) does not
 *   exist; `Date` moves it forward by the gap (03:30), so the run happens once that day, an hour later than written;
 * - fall back: a time inside the repeated hour happens twice; the first one is used, and the run happens once.
 *
 * The renderer carries a copy for the simulator (`schedtemplates.js` `nextRuleRun`); `test:schedules` checks both agree.
 */

export type RuleKind = 'daily' | 'weekdays' | 'weekly';
export interface CalendarRule {
  kind: RuleKind;
  /** Local time of day, "HH:MM" (24 h). */
  time: string;
  /** Weekly only: days of the week, 0 = Sunday .. 6 = Saturday; sorted, unique, at least one. */
  days?: number[];
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KINDS: RuleKind[] = ['daily', 'weekdays', 'weekly'];
export const WEEKDAYS = [1, 2, 3, 4, 5];

/** "HH:MM" as [hours, minutes], or undefined. */
export function parseTime(v: unknown): [number, number] | undefined {
  const m = typeof v === 'string' ? TIME_RE.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** A rule from untrusted input (the saved file or the renderer); undefined when it is not valid. */
export function parseRule(v: unknown): CalendarRule | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (!KINDS.includes(r.kind as RuleKind) || !parseTime(r.time)) return undefined;
  const rule: CalendarRule = { kind: r.kind as RuleKind, time: r.time as string };
  if (rule.kind === 'weekly') {
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    if (!days.length) return undefined;
    rule.days = days;
  }
  return rule;
}

/** The days of the week a rule runs on (0 = Sunday). */
export const ruleDays = (rule: CalendarRule): number[] => (rule.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : rule.kind === 'weekdays' ? WEEKDAYS : rule.days ?? []);

/**
 * The first time after `after` (epoch ms, strictly later) that the rule runs, as epoch ms; undefined for a rule that never runs.
 * Looks at most 8 local calendar days ahead (a weekly rule always has a day within 7).
 */
export function nextRuleRun(rule: CalendarRule, after: number): number | undefined {
  const t = parseTime(rule.time);
  const days = ruleDays(rule);
  if (!t || !days.length) return undefined;
  const base = new Date(after);
  for (let i = 0; i <= 8; i++) {
    // the local calendar day `i` days after `after`'s day, at the wall-clock time (built from Y/M/D, so DST changes do not shift it)
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (!days.includes(day.getDay())) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t[0], t[1], 0, 0).getTime();
    if (at > after) return at;
  }
  return undefined;
}

/** "HH:MM" of an epoch time in local time (used when an old "every day at" schedule is migrated to a rule). */
export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
