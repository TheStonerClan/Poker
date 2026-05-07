import { describe, expect, it } from "vitest";
import { computeExchange, type Denomination } from "./index.js";

const standardRemaining: Denomination[] = [
  { color: "blue", value: 10 },
  { color: "green", value: 25 },
  { color: "black", value: 100 },
];

describe("computeExchange — Travis's worked example", () => {
  it("rounds up: $23 with [10,25,100] → $25 (+2, player owes $2)", () => {
    const r = computeExchange({
      submittedTotal: 23,
      removingDenominations: [1, 5],
      remainingDenominations: standardRemaining,
      roundingMode: "up",
    });
    expect(r.newTotal).toBe(25);
    expect(r.exchangeFor).toEqual([{ value: 25, count: 1 }]);
    expect(r.netChange).toBe(2);
  });

  it("rounds down: $23 with [10,25,100] → $20 (−3, host owes player $3)", () => {
    const r = computeExchange({
      submittedTotal: 23,
      removingDenominations: [1, 5],
      remainingDenominations: standardRemaining,
      roundingMode: "down",
    });
    expect(r.newTotal).toBe(20);
    expect(r.exchangeFor).toEqual([{ value: 10, count: 2 }]);
    expect(r.netChange).toBe(-3);
  });
});

describe("computeExchange — exact totals & no-op cases", () => {
  it("$100 submitted is exact in either mode", () => {
    for (const roundingMode of ["up", "down"] as const) {
      const r = computeExchange({
        submittedTotal: 100,
        removingDenominations: [1, 5],
        remainingDenominations: standardRemaining,
        roundingMode,
      });
      expect(r.newTotal).toBe(100);
      expect(r.exchangeFor).toEqual([{ value: 100, count: 1 }]);
      expect(r.netChange).toBe(0);
    }
  });

  it("zero submittedTotal yields empty result", () => {
    const r = computeExchange({
      submittedTotal: 0,
      removingDenominations: [1, 5],
      remainingDenominations: standardRemaining,
      roundingMode: "up",
    });
    expect(r.newTotal).toBe(0);
    expect(r.exchangeFor).toEqual([]);
    expect(r.netChange).toBe(0);
  });
});

describe("computeExchange — second color-up break ([10,25] removed)", () => {
  const lateRemaining: Denomination[] = [
    { color: "green", value: 25 },
    { color: "black", value: 100 },
  ];

  it("$147 with [25,100] rounded down → $125 = 1×100 + 1×25 (−22)", () => {
    const r = computeExchange({
      submittedTotal: 147,
      removingDenominations: [1, 5, 10],
      remainingDenominations: lateRemaining,
      roundingMode: "down",
    });
    expect(r.newTotal).toBe(125);
    expect(r.exchangeFor).toEqual([
      { value: 100, count: 1 },
      { value: 25, count: 1 },
    ]);
    expect(r.netChange).toBe(-22);
  });

  it("$147 with [25,100] rounded up → $150 = 1×100 + 2×25 (+3)", () => {
    const r = computeExchange({
      submittedTotal: 147,
      removingDenominations: [1, 5, 10],
      remainingDenominations: lateRemaining,
      roundingMode: "up",
    });
    expect(r.newTotal).toBe(150);
    expect(r.exchangeFor).toEqual([
      { value: 100, count: 1 },
      { value: 25, count: 2 },
    ]);
    expect(r.netChange).toBe(3);
  });
});

describe("computeExchange — chip ordering & granularity", () => {
  it("returns chip counts sorted largest denom first", () => {
    const r = computeExchange({
      submittedTotal: 235,
      removingDenominations: [1, 5],
      remainingDenominations: standardRemaining,
      roundingMode: "down",
    });
    expect(r.newTotal).toBe(235);
    expect(r.exchangeFor).toEqual([
      { value: 100, count: 2 },
      { value: 25, count: 1 },
      { value: 10, count: 1 },
    ]);
    expect(r.netChange).toBe(0);
  });

  it("'up' picks the smallest reachable value, not just ceiling-to-smallest-denom", () => {
    // submittedTotal=21 with [10,25,100]: ceil to multiple-of-10 would give 30,
    // but the smallest *reachable* value ≥ 21 is 25.
    const r = computeExchange({
      submittedTotal: 21,
      removingDenominations: [1, 5],
      remainingDenominations: standardRemaining,
      roundingMode: "up",
    });
    expect(r.newTotal).toBe(25);
    expect(r.exchangeFor).toEqual([{ value: 25, count: 1 }]);
    expect(r.netChange).toBe(4);
  });

  it("'down' picks the largest reachable value", () => {
    const r = computeExchange({
      submittedTotal: 49,
      removingDenominations: [1, 5, 10],
      remainingDenominations: [
        { color: "green", value: 25 },
        { color: "black", value: 100 },
      ],
      roundingMode: "down",
    });
    expect(r.newTotal).toBe(25);
    expect(r.exchangeFor).toEqual([{ value: 25, count: 1 }]);
    expect(r.netChange).toBe(-24);
  });
});

describe("computeExchange — input validation", () => {
  it("throws when remainingDenominations is empty and submittedTotal > 0", () => {
    expect(() =>
      computeExchange({
        submittedTotal: 10,
        removingDenominations: [1, 5],
        remainingDenominations: [],
        roundingMode: "down",
      }),
    ).toThrow();
  });

  it("throws on negative submittedTotal", () => {
    expect(() =>
      computeExchange({
        submittedTotal: -1,
        removingDenominations: [1, 5],
        remainingDenominations: standardRemaining,
        roundingMode: "down",
      }),
    ).toThrow();
  });

  it("throws on non-integer submittedTotal", () => {
    expect(() =>
      computeExchange({
        submittedTotal: 23.5,
        removingDenominations: [1, 5],
        remainingDenominations: standardRemaining,
        roundingMode: "up",
      }),
    ).toThrow();
  });
});
