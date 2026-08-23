import { strict as assert } from "node:assert";
import { describe as suite, test } from "node:test";

import { nextOccurrence, type RecurrenceRule } from "@poker/recurrence";

import {
  fromIsoDate,
  parseRecurrenceRule,
  resolveNextNightFromOverrides,
  toIsoDate,
  type OverrideEntry,
} from "./next-night.ts";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

const thirdFriday: RecurrenceRule = {
  kind: "nthWeekdayOfMonth",
  nth: 3,
  weekday: 5,
};

function overrideMap(entries: Record<string, OverrideEntry | null>): Map<string, OverrideEntry> {
  const out = new Map<string, OverrideEntry>();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null) out.set(key, value);
  }
  return out;
}

suite("toIsoDate / fromIsoDate roundtrip", () => {
  test("local-midnight Dates roundtrip exactly", () => {
    const original = d(2026, 5, 15);
    assert.equal(toIsoDate(original), "2026-05-15");
    assert.equal(fromIsoDate("2026-05-15").getTime(), original.getTime());
  });
});

suite("parseRecurrenceRule", () => {
  test("accepts a valid nthWeekdayOfMonth rule", () => {
    const parsed = parseRecurrenceRule(JSON.stringify(thirdFriday));
    assert.deepEqual(parsed, thirdFriday);
  });

  test("returns null for empty / null / garbage", () => {
    assert.equal(parseRecurrenceRule(null), null);
    assert.equal(parseRecurrenceRule(""), null);
    assert.equal(parseRecurrenceRule("not json"), null);
    assert.equal(parseRecurrenceRule(JSON.stringify({ kind: "garbage" })), null);
  });
});

suite("resolveNextNightFromOverrides — no overrides", () => {
  test("returns the rule's next date as both original + effective", () => {
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: new Map(),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.originalDate), "2026-05-15");
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-05-15");
    assert.equal(result.next.isMoved, false);
    assert.equal(result.next.overrideId, null);
  });

  test("today counts as 'next' (cursor is exclusive of yesterday-end)", () => {
    // 2026-05-15 IS the 3rd Friday. Asking on the 15th should still return the 15th.
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 15),
      overrides: new Map(),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-05-15");
  });
});

suite("resolveNextNightFromOverrides — moved", () => {
  test("returns the moved date with isMoved=true and original preserved", () => {
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: overrideMap({
        "2026-05-15": {
          id: "abc",
          overridden_date: "2026-05-22",
          note: "Mother's Day weekend conflict",
        },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.originalDate), "2026-05-15");
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-05-22");
    assert.equal(result.next.isMoved, true);
    assert.equal(result.next.overrideId, "abc");
    assert.equal(result.next.note, "Mother's Day weekend conflict");
  });
});

suite("resolveNextNightFromOverrides — moved, original date already passed", () => {
  test("still resolves the moved-to date once today is past the original date but before the moved-to date", () => {
    // 2026-05-15 (3rd Friday of May) was moved out to 2026-05-29 — a
    // 2-week push. Asking on 2026-05-20 (after the 15th, before the 29th)
    // must still surface the moved date: the rule's own forward walk can
    // never land back on 2026-05-15 once it's in the past, so this only
    // works if the resolver checks pending moves independently of the walk.
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 20),
      overrides: overrideMap({
        "2026-05-15": {
          id: "abc",
          overridden_date: "2026-05-29",
          note: "pushed two weeks",
        },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.originalDate), "2026-05-15");
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-05-29");
    assert.equal(result.next.isMoved, true);
    assert.equal(result.next.overrideId, "abc");
  });

  test("stops surfacing the move once its moved-to date has also passed", () => {
    // Same move as above, but asking on 2026-05-30 — the moved-to date
    // (5-29) is now in the past too, so it should no longer be offered;
    // the rule's next natural occurrence (June 19) takes over.
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 30),
      overrides: overrideMap({
        "2026-05-15": {
          id: "abc",
          overridden_date: "2026-05-29",
          note: "pushed two weeks",
        },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-06-19");
    assert.equal(result.next.isMoved, false);
  });

  test("prefers a sooner unmoved occurrence over a farther-out pending move", () => {
    // 2026-05-15 was pushed all the way to 2026-08-14 (way out). Asking on
    // 2026-05-20, the *next* occurrence is still June 19 (no override) —
    // the resolver must not let the pending move (August) preempt it.
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 20),
      overrides: overrideMap({
        "2026-05-15": {
          id: "abc",
          overridden_date: "2026-08-14",
          note: "pushed way out",
        },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-06-19");
    assert.equal(result.next.isMoved, false);
  });
});

suite("resolveNextNightFromOverrides — cancelled", () => {
  test("skips a cancelled occurrence to the next rule date", () => {
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: overrideMap({
        "2026-05-15": { id: "abc", overridden_date: null, note: "out of town" },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    // June 19, 2026 is the next 3rd Friday.
    assert.equal(toIsoDate(result.next.originalDate), "2026-06-19");
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-06-19");
    assert.equal(result.next.isMoved, false);
    assert.equal(result.next.overrideId, null);
  });

  test("cascades through multiple cancellations", () => {
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: overrideMap({
        "2026-05-15": { id: "a", overridden_date: null, note: null },
        "2026-06-19": { id: "b", overridden_date: null, note: null },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    // July 17 = 3rd Friday of July 2026.
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-07-17");
  });

  test("cancel-then-move respects the move on the *next* date", () => {
    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: overrideMap({
        "2026-05-15": { id: "a", overridden_date: null, note: null },
        "2026-06-19": { id: "b", overridden_date: "2026-06-26", note: "shifted" },
      }),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(toIsoDate(result.next.originalDate), "2026-06-19");
    assert.equal(toIsoDate(result.next.effectiveDate), "2026-06-26");
    assert.equal(result.next.note, "shifted");
  });
});

suite("resolveNextNightFromOverrides — bounds", () => {
  test("returns all-cancelled when more than MAX_LOOKAHEAD occurrences are skipped", () => {
    const cancellations: Record<string, OverrideEntry> = {};
    // Pre-cancel the next 13 third-Fridays starting from 2026-05.
    let cursor = d(2026, 5, 1);
    for (let i = 0; i < 13; i++) {
      const next = nextOccurrence(thirdFriday, cursor);
      cancellations[toIsoDate(next)] = { id: `c${i}`, overridden_date: null, note: null };
      cursor = next;
    }

    const result = resolveNextNightFromOverrides({
      rule: thirdFriday,
      now: d(2026, 5, 1),
      overrides: overrideMap(cancellations),
    });
    assert.equal(result.kind, "all-cancelled");
  });
});
