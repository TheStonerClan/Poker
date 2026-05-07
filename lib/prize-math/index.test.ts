import { describe, expect, it } from 'vitest';
import { computePayouts, computeRawPool } from './index';
import type { PrizeConfig, Pool, PrizeRule } from './types';

const travisRules: PrizeRule[] = [
  { position: 1, kind: 'percentRemainder', value: 70 },
  { position: 2, kind: 'percentRemainder', value: 30 },
  { position: 3, kind: 'fixed', value: 20 },
];

const travisConfig: PrizeConfig = {
  rules: travisRules,
  rounding: { increment: 10, surplusToFirst: true },
  guarantee: 0,
  overlay: true,
};

const travisPool: Pool = { buyIns: 5, buybacks: 0, buyInPrice: 20 };

const sumPayouts = (payouts: Array<{ amount: number }>) =>
  payouts.reduce((s, p) => s + p.amount, 0);

describe("Travis's actual config (Bluff and Baffoons)", () => {
  it('5 entries × $20, 70/30 remainder + $20 fixed, $10 increment, surplusToFirst', () => {
    const result = computePayouts(travisConfig, travisPool);
    expect(result.effectivePool).toBe(100);
    expect(result.overlay).toBe(0);
    expect(result.remainder).toBe(0);
    expect(result.payouts).toEqual([
      { position: 1, amount: 60 }, // 70% of 80 = 56 → floor10 = 50, +10 surplus = 60
      { position: 2, amount: 20 }, // 30% of 80 = 24 → floor10 = 20
      { position: 3, amount: 20 }, // fixed
    ]);
    expect(sumPayouts(result.payouts)).toBe(100);
  });

  it('produces the same shape with buybacks counted into the pool', () => {
    // 4 buy-ins + 2 buybacks = 6 entries × $20 = $120
    const result = computePayouts(travisConfig, {
      buyIns: 4,
      buybacks: 2,
      buyInPrice: 20,
    });
    expect(result.effectivePool).toBe(120);
    // fixed $20 → remainder $100
    // 1st 70% = 70 → floor10 = 70
    // 2nd 30% = 30 → floor10 = 30
    // sum = 120 → no surplus
    expect(result.payouts).toEqual([
      { position: 1, amount: 70 },
      { position: 2, amount: 30 },
      { position: 3, amount: 20 },
    ]);
    expect(sumPayouts(result.payouts)).toBe(120);
  });
});

describe('edge cases', () => {
  it('0 entries → all payouts 0 (no overlay)', () => {
    const result = computePayouts(
      { ...travisConfig, overlay: false, guarantee: 0 },
      { buyIns: 0, buybacks: 0, buyInPrice: 20 },
    );
    expect(result.effectivePool).toBe(0);
    expect(result.overlay).toBe(0);
    expect(result.payouts).toEqual([
      { position: 1, amount: 0 },
      { position: 2, amount: 0 },
      { position: 3, amount: 0 },
    ]);
  });

  it('large field of 50 players × $20 = $1000', () => {
    const result = computePayouts(travisConfig, {
      buyIns: 50,
      buybacks: 0,
      buyInPrice: 20,
    });
    // pool 1000, fixed 20 → remainder 980
    // 1st 70% of 980 = 686 → floor10 = 680
    // 2nd 30% of 980 = 294 → floor10 = 290
    // sum = 990 → surplus 10 → 1st = 690
    expect(result.payouts).toEqual([
      { position: 1, amount: 690 },
      { position: 2, amount: 290 },
      { position: 3, amount: 20 },
    ]);
    expect(sumPayouts(result.payouts)).toBe(1000);
  });

  it('no rebuys (zero buybacks) is identical to passing buybacks=0', () => {
    const a = computePayouts(travisConfig, { buyIns: 7, buybacks: 0, buyInPrice: 20 });
    const b = computePayouts(travisConfig, travisPool);
    expect(a.payouts.find((p) => p.position === 3)?.amount).toBe(20);
    expect(b.payouts.find((p) => p.position === 3)?.amount).toBe(20);
  });

  it('overlay activates when pool < guarantee', () => {
    // 1 entry × $20 = $20 pool, guarantee $100 with overlay → effectivePool $100
    const result = computePayouts(
      { ...travisConfig, guarantee: 100, overlay: true },
      { buyIns: 1, buybacks: 0, buyInPrice: 20 },
    );
    expect(result.effectivePool).toBe(100);
    expect(result.overlay).toBe(80);
    expect(result.payouts).toEqual([
      { position: 1, amount: 60 },
      { position: 2, amount: 20 },
      { position: 3, amount: 20 },
    ]);
  });

  it('guarantee with overlay=false is informational only (does not bump pool)', () => {
    const result = computePayouts(
      { ...travisConfig, guarantee: 1000, overlay: false },
      { buyIns: 1, buybacks: 0, buyInPrice: 20 },
    );
    expect(result.effectivePool).toBe(20);
    expect(result.overlay).toBe(0);
  });

  it('rake reduces the pool', () => {
    // 5 × $20 gross = $100, rake $1/entry → $95 pool
    const result = computePayouts(travisConfig, {
      buyIns: 5,
      buybacks: 0,
      buyInPrice: 20,
      rakePerEntry: 1,
    });
    expect(result.effectivePool).toBe(95);
    // fixed 20 → remainder 75
    // 1st 70% = 52.5 → floor10 = 50
    // 2nd 30% = 22.5 → floor10 = 20
    // sum = 90 → surplus 5 → 1st = 55
    expect(result.payouts).toEqual([
      { position: 1, amount: 55 },
      { position: 2, amount: 20 },
      { position: 3, amount: 20 },
    ]);
    expect(sumPayouts(result.payouts)).toBe(95);
  });

  it('fixed rule that exceeds the pool is capped, not negative', () => {
    // pool $5, fixed rule of $20 to 3rd → 3rd gets $5, others get 0
    const result = computePayouts(travisConfig, {
      buyIns: 1,
      buybacks: 0,
      buyInPrice: 5,
    });
    expect(result.effectivePool).toBe(5);
    const third = result.payouts.find((p) => p.position === 3);
    expect(third?.amount).toBe(5);
    // 1st & 2nd would split a $0 remainder, then surplus (none) → both 0
    expect(result.payouts.find((p) => p.position === 1)?.amount).toBe(0);
    expect(result.payouts.find((p) => p.position === 2)?.amount).toBe(0);
  });

  it('surplusToFirst=false leaves remainder unallocated', () => {
    const result = computePayouts(
      { ...travisConfig, rounding: { increment: 10, surplusToFirst: false } },
      travisPool,
    );
    expect(result.payouts).toEqual([
      { position: 1, amount: 50 },
      { position: 2, amount: 20 },
      { position: 3, amount: 20 },
    ]);
    expect(result.remainder).toBe(10);
    expect(sumPayouts(result.payouts) + result.remainder).toBe(100);
  });
});

describe('rounding increments', () => {
  const fiftyFifty: PrizeRule[] = [
    { position: 1, kind: 'percentRemainder', value: 50 },
    { position: 2, kind: 'percentRemainder', value: 50 },
  ];

  it('increment 0 → cents (floor to $0.01)', () => {
    // 3-way split of $100 pool: 33.33% each, last position picks up surplus.
    const result = computePayouts(
      {
        rules: [
          { position: 1, kind: 'percentRemainder', value: 33.33 },
          { position: 2, kind: 'percentRemainder', value: 33.33 },
          { position: 3, kind: 'percentRemainder', value: 33.34 },
        ],
        rounding: { increment: 0, surplusToFirst: true },
      },
      { buyIns: 1, buybacks: 0, buyInPrice: 100 },
    );
    // 33.33% of 100 = 33.33; 33.34% of 100 = 33.34. floor cents → 33.33, 33.33, 33.34. sum = 100.
    expect(result.payouts).toEqual([
      { position: 1, amount: 33.33 },
      { position: 2, amount: 33.33 },
      { position: 3, amount: 33.34 },
    ]);
    expect(sumPayouts(result.payouts)).toBeCloseTo(100, 2);
  });

  it('increment 1 → whole dollars', () => {
    const result = computePayouts(
      { rules: fiftyFifty, rounding: { increment: 1, surplusToFirst: true } },
      { buyIns: 7, buybacks: 0, buyInPrice: 20 }, // $140
    );
    // 50% of 140 = 70 (whole) → 70/70, no surplus
    expect(result.payouts).toEqual([
      { position: 1, amount: 70 },
      { position: 2, amount: 70 },
    ]);
    expect(result.remainder).toBe(0);
  });

  it('increment 1 with odd pool produces a $1 surplus', () => {
    const result = computePayouts(
      { rules: fiftyFifty, rounding: { increment: 1, surplusToFirst: true } },
      { buyIns: 1, buybacks: 0, buyInPrice: 99 }, // $99
    );
    // 50% of 99 = 49.5 → floor1 = 49 each. sum 98 → surplus 1 → 1st = 50
    expect(result.payouts).toEqual([
      { position: 1, amount: 50 },
      { position: 2, amount: 49 },
    ]);
  });

  it('increment 5', () => {
    const result = computePayouts(
      { rules: fiftyFifty, rounding: { increment: 5, surplusToFirst: true } },
      { buyIns: 1, buybacks: 0, buyInPrice: 99 }, // $99
    );
    // 49.5 → floor5 = 45 each. sum 90 → surplus 9 → 1st = 54
    expect(result.payouts).toEqual([
      { position: 1, amount: 54 },
      { position: 2, amount: 45 },
    ]);
  });

  it('increment 20 with $100 pool', () => {
    const result = computePayouts(
      { rules: fiftyFifty, rounding: { increment: 20, surplusToFirst: true } },
      { buyIns: 5, buybacks: 0, buyInPrice: 20 }, // $100
    );
    // 50% of 100 = 50 → floor20 = 40 each. sum 80 → surplus 20 → 1st = 60
    expect(result.payouts).toEqual([
      { position: 1, amount: 60 },
      { position: 2, amount: 40 },
    ]);
  });
});

describe('percentTotal rules', () => {
  it('percentTotal ignores fixed rules and uses the full pool', () => {
    const result = computePayouts(
      {
        rules: [
          { position: 1, kind: 'percentTotal', value: 50 },
          { position: 2, kind: 'percentTotal', value: 30 },
          { position: 3, kind: 'fixed', value: 20 },
        ],
        rounding: { increment: 1, surplusToFirst: true },
      },
      { buyIns: 5, buybacks: 0, buyInPrice: 20 }, // $100
    );
    // 1st 50% of 100 = 50. 2nd 30% of 100 = 30. 3rd fixed 20.
    // sum = 100, no surplus
    expect(result.payouts).toEqual([
      { position: 1, amount: 50 },
      { position: 2, amount: 30 },
      { position: 3, amount: 20 },
    ]);
  });
});

describe('property: total payouts == effective pool when overlay/guarantee covers and surplusToFirst=true', () => {
  // Fixed seed values to keep the test deterministic and self-contained.
  const cases: Array<{ entries: number; price: number; rake?: number }> = [
    { entries: 1, price: 20 },
    { entries: 2, price: 20 },
    { entries: 3, price: 20 },
    { entries: 4, price: 20 },
    { entries: 5, price: 20 },
    { entries: 6, price: 20 },
    { entries: 7, price: 20 },
    { entries: 12, price: 20 },
    { entries: 23, price: 20 },
    { entries: 50, price: 20 },
    { entries: 100, price: 25 },
    { entries: 5, price: 20, rake: 2 },
    { entries: 9, price: 33, rake: 3 },
  ];

  const ruleSets: Array<{ name: string; rules: PrizeRule[] }> = [
    {
      name: "Travis 70/30 + $20 fixed",
      rules: travisRules,
    },
    {
      name: 'flat 50/50 remainder',
      rules: [
        { position: 1, kind: 'percentRemainder', value: 50 },
        { position: 2, kind: 'percentRemainder', value: 50 },
      ],
    },
    {
      name: 'percentTotal 60/40',
      rules: [
        { position: 1, kind: 'percentTotal', value: 60 },
        { position: 2, kind: 'percentTotal', value: 40 },
      ],
    },
  ];

  const increments = [0, 1, 5, 10, 20] as const;

  for (const ruleSet of ruleSets) {
    for (const c of cases) {
      for (const inc of increments) {
        it(`${ruleSet.name} | ${c.entries} entries × $${c.price}${
          c.rake ? ` (rake $${c.rake})` : ''
        } | inc=${inc} → sum == pool`, () => {
          const config: PrizeConfig = {
            rules: ruleSet.rules,
            rounding: { increment: inc, surplusToFirst: true },
            guarantee: 1, // any positive guarantee with overlay forces overlay path on 0 entries
            overlay: true,
          };
          const result = computePayouts(config, {
            buyIns: c.entries,
            buybacks: 0,
            buyInPrice: c.price,
            rakePerEntry: c.rake,
          });
          const total = sumPayouts(result.payouts);
          // Use cents math to dodge float dust on the inc=0 cases.
          expect(Math.round(total * 100)).toBe(Math.round(result.effectivePool * 100));
          expect(result.remainder).toBe(0);
        });
      }
    }
  }
});

describe('computeRawPool', () => {
  it('combines buyIns + buybacks at the buyInPrice and subtracts rake', () => {
    expect(computeRawPool({ buyIns: 5, buybacks: 2, buyInPrice: 20 })).toBe(140);
    expect(
      computeRawPool({ buyIns: 5, buybacks: 0, buyInPrice: 20, rakePerEntry: 1 }),
    ).toBe(95);
    expect(computeRawPool({ buyIns: 0, buybacks: 0, buyInPrice: 20 })).toBe(0);
  });
});
