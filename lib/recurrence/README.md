# @poker/recurrence

Pure-TS library for human-friendly recurring tournament schedules. Single
runtime dep ([`date-fns`](https://date-fns.org)); no infra, no DB, no I/O.

## Install

```sh
pnpm install
```

The `.npmrc` here sets `ignore-workspace=true` so this package installs its own
`node_modules` without being captured by the parent Next.js workspace.

## Run tests / typecheck

```sh
pnpm test        # node:test runner, no extra deps
pnpm typecheck   # tsc --noEmit
```

## API

```ts
import {
  describe,
  nextNOccurrences,
  nextOccurrence,
  type RecurrenceRule,
} from './lib/recurrence/index.ts';

type Weekday    = 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 0 = Sunday … 6 = Saturday (matches Date#getDay)
type NthWeekday = 1 | 2 | 3 | 4 | -1;          // -1 = last

type RecurrenceRule =
  | { kind: 'nthWeekdayOfMonth'; nth: NthWeekday; weekday: Weekday }
  | { kind: 'everyNDays'; n: number }
  | { kind: 'specificDates'; dates: string[] };  // ISO YYYY-MM-DD

function nextOccurrence(
  rule: RecurrenceRule,
  after: Date,
  holidaysToSkip?: readonly Date[],
): Date;

function nextNOccurrences(
  rule: RecurrenceRule,
  after: Date,
  n: number,
  holidaysToSkip?: readonly Date[],
): Date[];

function describe(rule: RecurrenceRule): string;
```

### Travis's case

```ts
const rule: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 };
describe(rule);                                       // "3rd Friday of each month"
nextOccurrence(rule, new Date(2026, 4, 7));           // 2026-05-15 (3rd Fri of May)
nextNOccurrences(rule, new Date(2026, 4, 7), 3);      // [2026-05-15, 2026-06-19, 2026-07-17]
```

## Conventions

### `after` is **exclusive**

If `after` already lands on a matching date, the result is the *next*
occurrence — never `after` itself. This makes "give me the one after this one"
the natural read, and lets `nextNOccurrences` walk forward without
deduplication.

```ts
const rule: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 };
nextOccurrence(rule, new Date(2026, 4, 15));          // 2026-06-19, not 2026-05-15
```

### Holiday handling

If the computed date matches any entry in `holidaysToSkip` (compared by
calendar day, ignoring time), the rule advances to its **next natural
occurrence** — not just the next day — and re-checks. Capped at 12 iterations.

```ts
const rule: RecurrenceRule = { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 };
nextOccurrence(rule, new Date(2026, 11, 1), [new Date(2026, 11, 18)]);
// → 2027-01-15  (skips Dec 18, jumps to next month's 3rd Friday)
```

For `everyNDays`, "next occurrence" means another `+n` days. For
`specificDates`, it means the next entry in the list.

### Time zones

All dates are constructed and compared as **local midnight**. Pass
`new Date(year, monthIndex, day)` rather than `new Date('2026-05-15')` to avoid
UTC parsing pulling the day across a TZ boundary. Strings inside
`specificDates` are parsed as `YYYY-MM-DD` in local time.

### Weekday encoding

`weekday` matches `Date.prototype.getDay()`: `0 = Sunday`, `1 = Monday`, …,
`5 = Friday`, `6 = Saturday`.

## Rule reference

| Kind                 | Fields                                                                                | `describe()` example          |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| `nthWeekdayOfMonth`  | `nth: 1\|2\|3\|4\|-1`, `weekday: 0..6`                                                | `"3rd Friday of each month"`  |
| `everyNDays`         | `n: positive integer`                                                                 | `"Every 14 days"`             |
| `specificDates`      | `dates: string[]` (ISO `YYYY-MM-DD`, any order)                                       | `"On specific dates: 2026-…"` |

## Errors

- `everyNDays` with `n <= 0` or non-integer → throws.
- `specificDates` exhausted (no future date matches) → throws.
- More than 12 consecutive holiday hits → throws (signals a misconfigured
  holiday list, not a real schedule).
