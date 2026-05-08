// TODO(track-F): replace with real `@/lib/recurrence` once that package is merged.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type NthWeekday = 1 | 2 | 3 | 4 | -1;

export type RecurrenceRule =
  | { kind: "nthWeekdayOfMonth"; nth: NthWeekday; weekday: Weekday }
  | { kind: "everyNDays"; n: number }
  | { kind: "specificDates"; dates: string[] };

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function ordinal(n: number): string {
  const v = Math.abs(n) % 100;
  const suffix =
    v >= 11 && v <= 13
      ? "th"
      : ["th", "st", "nd", "rd", "th"][Math.min(Math.abs(n) % 10, 4)];
  return `${n}${suffix}`;
}

export function describe(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case "nthWeekdayOfMonth": {
      const day = WEEKDAY_NAMES[rule.weekday];
      if (rule.nth === -1) return `Last ${day} of each month`;
      return `${ordinal(rule.nth)} ${day} of each month`;
    }
    case "everyNDays":
      return rule.n === 1 ? "Every day" : `Every ${rule.n} days`;
    case "specificDates":
      return `On specific dates: ${rule.dates.join(", ")}`;
  }
}

function nthWeekdayInMonth(
  year: number,
  monthIdx: number,
  nth: NthWeekday,
  weekday: Weekday,
): Date {
  if (nth === -1) {
    const last = new Date(year, monthIdx + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, monthIdx, last.getDate() - offset);
  }
  const first = new Date(year, monthIdx, 1);
  const offsetToWeekday = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIdx, 1 + offsetToWeekday + (nth - 1) * 7);
}

/**
 * Plausible mock for admin UI development. Returns the next occurrence of the
 * rule strictly after `after`. Real lib (Track F) handles holidays + edge
 * cases more carefully — replace this when the real lib merges.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date {
  switch (rule.kind) {
    case "nthWeekdayOfMonth": {
      const candidate = nthWeekdayInMonth(
        after.getFullYear(),
        after.getMonth(),
        rule.nth,
        rule.weekday,
      );
      if (candidate > after) return candidate;
      const next = new Date(after.getFullYear(), after.getMonth() + 1, 1);
      return nthWeekdayInMonth(
        next.getFullYear(),
        next.getMonth(),
        rule.nth,
        rule.weekday,
      );
    }
    case "everyNDays": {
      const out = new Date(after);
      out.setDate(out.getDate() + Math.max(1, rule.n));
      return out;
    }
    case "specificDates": {
      const sorted = rule.dates
        .map((s) => new Date(`${s}T00:00:00`))
        .sort((a, b) => a.getTime() - b.getTime());
      const next = sorted.find((d) => d > after);
      if (!next) throw new Error("No future dates remain in specificDates");
      return next;
    }
  }
}
