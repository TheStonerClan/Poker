import { addDays, addMonths, getDay, isAfter, isSameDay } from 'date-fns';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type NthWeekday = 1 | 2 | 3 | 4 | -1;

export type RecurrenceRule =
  | { kind: 'nthWeekdayOfMonth'; nth: NthWeekday; weekday: Weekday }
  | { kind: 'everyNDays'; n: number }
  | { kind: 'specificDates'; dates: string[] };

const MAX_HOLIDAY_ITERATIONS = 12;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// Parse "YYYY-MM-DD" as local-midnight to avoid TZ off-by-one issues
// when comparing against locally-constructed candidate dates.
function parseIsoLocal(s: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`Invalid ISO date "${s}" — expected YYYY-MM-DD`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(y, m - 1, d);
}

function isHoliday(date: Date, holidays: readonly Date[]): boolean {
  return holidays.some((h) => isSameDay(h, date));
}

function nthWeekdayInMonth(year: number, monthIdx: number, nth: NthWeekday, weekday: Weekday): Date {
  if (nth === -1) {
    // Day 0 of next month == last day of this month, anchored at local midnight.
    const last = new Date(year, monthIdx + 1, 0);
    const offset = (getDay(last) - weekday + 7) % 7;
    return new Date(year, monthIdx, last.getDate() - offset);
  }
  const first = new Date(year, monthIdx, 1);
  const offsetToWeekday = (weekday - getDay(first) + 7) % 7;
  return new Date(year, monthIdx, 1 + offsetToWeekday + (nth - 1) * 7);
}

function nthWeekdayInNextMonth(after: Date, nth: NthWeekday, weekday: Weekday): Date {
  const next = addMonths(new Date(after.getFullYear(), after.getMonth(), 1), 1);
  return nthWeekdayInMonth(next.getFullYear(), next.getMonth(), nth, weekday);
}

/**
 * Returns the next occurrence of `rule` strictly after `after`.
 *
 * Convention: `after` is exclusive — if `after` itself matches the rule, the
 * returned date is the *following* occurrence, not `after`.
 *
 * If the computed date appears in `holidaysToSkip` (compared by calendar day),
 * the rule is advanced to its next occurrence and re-checked. Bounded to
 * 12 iterations to prevent infinite loops on pathological holiday lists.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  after: Date,
  holidaysToSkip: readonly Date[] = [],
): Date {
  switch (rule.kind) {
    case 'nthWeekdayOfMonth': {
      let candidate = nthWeekdayInMonth(
        after.getFullYear(),
        after.getMonth(),
        rule.nth,
        rule.weekday,
      );
      if (!isAfter(candidate, after)) {
        candidate = nthWeekdayInNextMonth(after, rule.nth, rule.weekday);
      }
      for (let i = 0; i < MAX_HOLIDAY_ITERATIONS; i++) {
        if (!isHoliday(candidate, holidaysToSkip)) return candidate;
        candidate = nthWeekdayInNextMonth(candidate, rule.nth, rule.weekday);
      }
      throw new Error(
        `nextOccurrence: exceeded ${MAX_HOLIDAY_ITERATIONS} holiday-skip iterations`,
      );
    }

    case 'everyNDays': {
      if (!Number.isInteger(rule.n) || rule.n <= 0) {
        throw new Error(`everyNDays.n must be a positive integer, got ${rule.n}`);
      }
      let candidate = addDays(after, rule.n);
      for (let i = 0; i < MAX_HOLIDAY_ITERATIONS; i++) {
        if (!isHoliday(candidate, holidaysToSkip)) return candidate;
        candidate = addDays(candidate, rule.n);
      }
      throw new Error(
        `nextOccurrence: exceeded ${MAX_HOLIDAY_ITERATIONS} holiday-skip iterations`,
      );
    }

    case 'specificDates': {
      const sorted = rule.dates
        .map(parseIsoLocal)
        .sort((a, b) => a.getTime() - b.getTime());
      const next = sorted.find(
        (d) => isAfter(d, after) && !isHoliday(d, holidaysToSkip),
      );
      if (!next) {
        throw new Error('nextOccurrence: no future dates remain in specificDates');
      }
      return next;
    }
  }
}

/**
 * Returns the next `n` occurrences of `rule` after `after`, in ascending order.
 */
export function nextNOccurrences(
  rule: RecurrenceRule,
  after: Date,
  n: number,
  holidaysToSkip: readonly Date[] = [],
): Date[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`nextNOccurrences: n must be a non-negative integer, got ${n}`);
  }
  const out: Date[] = [];
  let cursor = after;
  for (let i = 0; i < n; i++) {
    const next = nextOccurrence(rule, cursor, holidaysToSkip);
    out.push(next);
    cursor = next;
  }
  return out;
}

function ordinal(n: number): string {
  const v = Math.abs(n) % 100;
  const suffix =
    v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd', 'th'][Math.min(Math.abs(n) % 10, 4)];
  return `${n}${suffix}`;
}

/**
 * Human-readable description of a recurrence rule, e.g. "3rd Friday of each month".
 */
export function describe(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'nthWeekdayOfMonth': {
      const day = WEEKDAY_NAMES[rule.weekday];
      if (rule.nth === -1) return `Last ${day} of each month`;
      return `${ordinal(rule.nth)} ${day} of each month`;
    }
    case 'everyNDays':
      return rule.n === 1 ? 'Every day' : `Every ${rule.n} days`;
    case 'specificDates':
      return `On specific dates: ${rule.dates.join(', ')}`;
  }
}
