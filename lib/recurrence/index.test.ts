import { strict as assert } from 'node:assert';
import { describe as suite, test } from 'node:test';
import { describe, nextNOccurrences, nextOccurrence, type RecurrenceRule } from './index.ts';

// Local-midnight date constructor — matches what the library produces internally,
// so equality checks are TZ-independent.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

suite('nextOccurrence — nthWeekdayOfMonth', () => {
  const thirdFriday: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 };

  test('3rd Friday from 2026-05-07 → 2026-05-15', () => {
    assert.equal(nextOccurrence(thirdFriday, d(2026, 5, 7)).getTime(), d(2026, 5, 15).getTime());
  });

  test('3rd Friday from 2026-05-15 is exclusive → 2026-06-19', () => {
    assert.equal(nextOccurrence(thirdFriday, d(2026, 5, 15)).getTime(), d(2026, 6, 19).getTime());
  });

  test('Last Saturday from 2026-05-07 → 2026-05-30', () => {
    const lastSat: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: -1, weekday: 6 };
    assert.equal(nextOccurrence(lastSat, d(2026, 5, 7)).getTime(), d(2026, 5, 30).getTime());
  });

  test('Holiday skip: 3rd Fri from 2026-12-01, holidays=[2026-12-18] → 2027-01-15', () => {
    const result = nextOccurrence(thirdFriday, d(2026, 12, 1), [d(2026, 12, 18)]);
    assert.equal(result.getTime(), d(2027, 1, 15).getTime());
  });

  test('1st Sunday across a year boundary', () => {
    const firstSun: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 1, weekday: 0 };
    // Dec 2026: 1st Sunday is Dec 6. After Dec 31 → Jan 3, 2027.
    assert.equal(
      nextOccurrence(firstSun, d(2026, 12, 31)).getTime(),
      d(2027, 1, 3).getTime(),
    );
  });

  test('Last day-of-week falls on the 28th when month starts on that weekday', () => {
    // Feb 2027: Feb 1 is Monday. Last Monday is Feb 22. (Feb 2027 has 28 days.)
    const lastMon: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: -1, weekday: 1 };
    assert.equal(nextOccurrence(lastMon, d(2027, 2, 1)).getTime(), d(2027, 2, 22).getTime());
  });
});

suite('nextOccurrence — everyNDays', () => {
  test('every 7 days from 2026-05-07 → 2026-05-14', () => {
    const rule: RecurrenceRule = { kind: 'everyNDays', n: 7 };
    assert.equal(nextOccurrence(rule, d(2026, 5, 7)).getTime(), d(2026, 5, 14).getTime());
  });

  test('every 7 days with holiday skip', () => {
    const rule: RecurrenceRule = { kind: 'everyNDays', n: 7 };
    // Next would be May 14; skip to May 21.
    assert.equal(
      nextOccurrence(rule, d(2026, 5, 7), [d(2026, 5, 14)]).getTime(),
      d(2026, 5, 21).getTime(),
    );
  });

  test('rejects n <= 0', () => {
    assert.throws(() => nextOccurrence({ kind: 'everyNDays', n: 0 }, d(2026, 5, 7)));
    assert.throws(() => nextOccurrence({ kind: 'everyNDays', n: -1 }, d(2026, 5, 7)));
  });
});

suite('nextOccurrence — specificDates', () => {
  test('returns next date strictly after `after`', () => {
    const rule: RecurrenceRule = {
      kind: 'specificDates',
      dates: ['2026-05-15', '2026-06-01', '2026-07-04'],
    };
    assert.equal(nextOccurrence(rule, d(2026, 5, 15)).getTime(), d(2026, 6, 1).getTime());
  });

  test('skips holiday entries', () => {
    const rule: RecurrenceRule = {
      kind: 'specificDates',
      dates: ['2026-06-01', '2026-07-04'],
    };
    assert.equal(
      nextOccurrence(rule, d(2026, 5, 15), [d(2026, 6, 1)]).getTime(),
      d(2026, 7, 4).getTime(),
    );
  });

  test('throws when list exhausted', () => {
    const rule: RecurrenceRule = { kind: 'specificDates', dates: ['2026-01-01'] };
    assert.throws(() => nextOccurrence(rule, d(2026, 5, 15)));
  });

  test('handles unsorted input', () => {
    const rule: RecurrenceRule = {
      kind: 'specificDates',
      dates: ['2026-07-04', '2026-05-15', '2026-06-01'],
    };
    assert.equal(nextOccurrence(rule, d(2026, 5, 15)).getTime(), d(2026, 6, 1).getTime());
  });
});

suite('nextNOccurrences', () => {
  test('returns 3 consecutive 3rd Fridays from 2026-05-07', () => {
    const rule: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 };
    const results = nextNOccurrences(rule, d(2026, 5, 7), 3);
    assert.deepEqual(
      results.map((r) => r.getTime()),
      [d(2026, 5, 15), d(2026, 6, 19), d(2026, 7, 17)].map((r) => r.getTime()),
    );
  });

  test('n = 0 returns empty array', () => {
    const rule: RecurrenceRule = { kind: 'everyNDays', n: 7 };
    assert.deepEqual(nextNOccurrences(rule, d(2026, 5, 7), 0), []);
  });
});

suite('describe', () => {
  test('nthWeekdayOfMonth — 3rd Friday', () => {
    assert.equal(
      describe({ kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 }),
      '3rd Friday of each month',
    );
  });

  test('nthWeekdayOfMonth — 1st Sunday', () => {
    assert.equal(
      describe({ kind: 'nthWeekdayOfMonth', nth: 1, weekday: 0 }),
      '1st Sunday of each month',
    );
  });

  test('nthWeekdayOfMonth — 2nd Tuesday', () => {
    assert.equal(
      describe({ kind: 'nthWeekdayOfMonth', nth: 2, weekday: 2 }),
      '2nd Tuesday of each month',
    );
  });

  test('nthWeekdayOfMonth — last Saturday', () => {
    assert.equal(
      describe({ kind: 'nthWeekdayOfMonth', nth: -1, weekday: 6 }),
      'Last Saturday of each month',
    );
  });

  test('everyNDays — singular', () => {
    assert.equal(describe({ kind: 'everyNDays', n: 1 }), 'Every day');
  });

  test('everyNDays — plural', () => {
    assert.equal(describe({ kind: 'everyNDays', n: 14 }), 'Every 14 days');
  });

  test('specificDates', () => {
    assert.equal(
      describe({ kind: 'specificDates', dates: ['2026-05-15', '2026-06-19'] }),
      'On specific dates: 2026-05-15, 2026-06-19',
    );
  });
});
