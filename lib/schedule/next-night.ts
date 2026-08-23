// Canonical "when is the next poker night?" resolver — pure logic.
//
// Combines a template's recurrence_rule with any rows in schedule_overrides
// to return the single next upcoming date. This is the only place that
// reconciles the rule with overrides — admin UI, Signal reminder cron, and
// any future public-facing "next night" widget MUST go through here so a
// move/cancel set by an admin is honored everywhere.
//
// Override semantics:
//   - matching row, overridden_date NOT NULL → use overridden_date
//   - matching row, overridden_date IS NULL  → skip this occurrence entirely
//   - no matching row                        → use the rule date as-is
//
// Cancelled occurrences cascade: if Friday May 15 is cancelled, the resolver
// looks at the rule's *next* date (June 19) and applies overrides to that,
// recursively, up to MAX_LOOKAHEAD steps.
//
// A moved occurrence can outlive its own original date: once "today" passes
// the original date, the rule's own forward walk (nextOccurrence) can never
// land back on it — the *rule* only knows about May 15, June 19, ..., never
// about an ad-hoc moved-to date like May 22. So a move to a date more than
// a few days out needs to stay resolvable even after its original date has
// come and gone but before the moved-to date has. See the "orphaned pending
// move" handling below.
//
// This module is pure — no Supabase, no Next.js, no I/O. The server-side
// wrapper that loads overrides from the database lives in ./server.ts.

import { nextOccurrence, type RecurrenceRule } from "@poker/recurrence";

export const MAX_LOOKAHEAD = 12;

export type NextNight = {
  /** The date the rule alone would produce (before override). */
  originalDate: Date;
  /** The actual upcoming date (== originalDate when no move applies). */
  effectiveDate: Date;
  /** True iff a move-style override is in effect for this occurrence. */
  isMoved: boolean;
  /** The matching schedule_overrides.id, or null if no override row exists. */
  overrideId: string | null;
  /** Optional admin note attached to the override. */
  note: string | null;
};

export type NextNightResolution =
  | { kind: "ok"; next: NextNight }
  | { kind: "no-rule" }
  | { kind: "all-cancelled"; lookedAhead: number };

export type OverrideEntry = {
  id: string;
  /** ISO YYYY-MM-DD or null (null = cancelled). */
  overridden_date: string | null;
  note: string | null;
};

/**
 * Parse the JSON-encoded rule stored on tournament_templates.recurrence_rule.
 * Returns null for empty/invalid input — callers treat that as "no schedule."
 */
export function parseRecurrenceRule(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.kind === "nthWeekdayOfMonth" ||
      parsed?.kind === "everyNDays" ||
      parsed?.kind === "specificDates"
    ) {
      return parsed as RecurrenceRule;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Format a Date as YYYY-MM-DD using local fields (matches PG `date`). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD into a local-midnight Date (matches the recurrence lib). */
export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Walks the rule forward, applying overrides at each step. Pure — no I/O.
 * Use this directly in tests; production callers should use the server-side
 * wrapper in ./server.ts which loads `overrides` from Supabase.
 */
export function resolveNextNightFromOverrides(args: {
  rule: RecurrenceRule;
  now: Date;
  /** Map keyed by original_date as YYYY-MM-DD. */
  overrides: ReadonlyMap<string, OverrideEntry>;
}): NextNightResolution {
  const todayIso = toIsoDate(
    new Date(args.now.getFullYear(), args.now.getMonth(), args.now.getDate()),
  );

  const walked = walkRuleForOverrides(args.rule, args.now, args.overrides);
  const pending = earliestPendingMove(args.overrides, todayIso);

  if (!pending) return walked;
  if (walked.kind !== "ok" || pending.effectiveIso < toIsoDate(walked.next.effectiveDate)) {
    return {
      kind: "ok",
      next: {
        originalDate: fromIsoDate(pending.originalIso),
        effectiveDate: fromIsoDate(pending.effectiveIso),
        isMoved: true,
        overrideId: pending.override.id,
        note: pending.override.note,
      },
    };
  }
  return walked;
}

/**
 * The rule's own natural forward walk, applying an override only where the
 * walk actually lands (i.e. the override's original_date is still >= the
 * walk's cursor). This alone misses a move whose original_date has already
 * passed — resolveNextNightFromOverrides backfills that separately via
 * earliestPendingMove, since the rule's sequence can never revisit a date
 * it's already walked past.
 */
function walkRuleForOverrides(
  rule: RecurrenceRule,
  now: Date,
  overrides: ReadonlyMap<string, OverrideEntry>,
): NextNightResolution {
  // Use yesterday-end as the cursor so a night scheduled for *today* still counts.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cursor.setMilliseconds(cursor.getMilliseconds() - 1);

  let original: Date;
  try {
    original = nextOccurrence(rule, cursor);
  } catch {
    return { kind: "all-cancelled", lookedAhead: 0 };
  }

  for (let i = 0; i < MAX_LOOKAHEAD; i++) {
    const key = toIsoDate(original);
    const override = overrides.get(key);

    if (!override) {
      return {
        kind: "ok",
        next: {
          originalDate: original,
          effectiveDate: original,
          isMoved: false,
          overrideId: null,
          note: null,
        },
      };
    }

    if (override.overridden_date !== null) {
      const moved = fromIsoDate(override.overridden_date);
      return {
        kind: "ok",
        next: {
          originalDate: original,
          effectiveDate: moved,
          isMoved: true,
          overrideId: override.id,
          note: override.note,
        },
      };
    }

    // Cancelled — advance to the next rule date and re-check.
    try {
      original = nextOccurrence(rule, original);
    } catch {
      return { kind: "all-cancelled", lookedAhead: i + 1 };
    }
  }

  return { kind: "all-cancelled", lookedAhead: MAX_LOOKAHEAD };
}

/**
 * The earliest still-upcoming moved-to date among ALL overrides, regardless
 * of whether its original_date is in the past — the one thing
 * walkRuleForOverrides structurally cannot find on its own. Cancellations
 * (overridden_date null) never need this: once a cancelled date is in the
 * past it's simply moot, and a future one is still reachable by the normal
 * walk since the rule hasn't passed it yet.
 */
function earliestPendingMove(
  overrides: ReadonlyMap<string, OverrideEntry>,
  todayIso: string,
): { originalIso: string; effectiveIso: string; override: OverrideEntry } | null {
  let best: { originalIso: string; effectiveIso: string; override: OverrideEntry } | null = null;
  for (const [originalIso, override] of overrides) {
    const effectiveIso = override.overridden_date;
    if (effectiveIso == null || effectiveIso < todayIso) continue;
    if (!best || effectiveIso < best.effectiveIso) {
      best = { originalIso, effectiveIso, override };
    }
  }
  return best;
}
