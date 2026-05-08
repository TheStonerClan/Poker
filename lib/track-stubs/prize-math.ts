// TODO(track-D): replace with real `@/lib/prize-math` once that package is merged.
// Mirror of the public API in /lib/prize-math/types.ts so admin UI compiles
// against the same shape and a swap is mechanical.

export type FixedRule = { kind: "fixed"; position: number; value: number };
export type PercentRemainderRule = {
  kind: "percentRemainder";
  position: number;
  value: number;
};
export type PercentTotalRule = {
  kind: "percentTotal";
  position: number;
  value: number;
};
export type PrizeRule = FixedRule | PercentRemainderRule | PercentTotalRule;

export type PrizeRounding = {
  increment: 0 | 1 | 5 | 10 | 20;
  surplusToFirst: boolean;
};

export type PrizeConfig = {
  rules: PrizeRule[];
  rounding: PrizeRounding;
  guarantee?: number;
  overlay?: boolean;
};

export type Pool = {
  buyIns: number;
  buybacks: number;
  buyInPrice: number;
  rakePerEntry?: number;
};

export type Payout = { position: number; amount: number };

export type PayoutResult = {
  payouts: Payout[];
  effectivePool: number;
  remainder: number;
  overlay: number;
};

function floorTo(value: number, inc: 0 | 1 | 5 | 10 | 20): number {
  if (value <= 0) return 0;
  if (inc === 0) return Math.floor(value * 100) / 100;
  return Math.floor(value / inc) * inc;
}

/**
 * Plausible-but-unofficial implementation that follows the same algorithm as
 * the real prize-math library. Sufficient for admin UI smoke testing.
 *
 * When Track D merges, drop this file and import { computePayouts } from
 * "@/lib/prize-math" instead.
 */
export function computePayouts(
  config: PrizeConfig,
  pool: Pool,
): PayoutResult {
  const entries = pool.buyIns + pool.buybacks;
  const gross = Math.max(0, entries * pool.buyInPrice);
  const rake = entries * (pool.rakePerEntry ?? 0);
  const rawPool = Math.max(0, gross - rake);

  const guarantee = config.guarantee ?? 0;
  const overlayEnabled = config.overlay ?? false;
  const effectivePool =
    overlayEnabled && guarantee > rawPool ? guarantee : rawPool;
  const overlay =
    overlayEnabled && guarantee > rawPool ? guarantee - rawPool : 0;

  const rules = [...config.rules].sort((a, b) => a.position - b.position);

  let runningPool = effectivePool;
  const fixedAmounts = new Map<number, number>();
  for (const rule of rules) {
    if (rule.kind === "fixed") {
      const amount = Math.max(0, Math.min(rule.value, runningPool));
      fixedAmounts.set(rule.position, amount);
      runningPool -= amount;
    }
  }

  const remainderForPercent = runningPool;
  const inc = config.rounding.increment;

  const payouts: Payout[] = rules.map((rule) => {
    let amount = 0;
    if (rule.kind === "fixed") {
      amount = fixedAmounts.get(rule.position) ?? 0;
    } else if (rule.kind === "percentRemainder") {
      amount = floorTo((remainderForPercent * rule.value) / 100, inc);
    } else {
      amount = floorTo((effectivePool * rule.value) / 100, inc);
    }
    return { position: rule.position, amount };
  });

  const allocated = payouts.reduce((s, p) => s + p.amount, 0);
  let remainder = Math.max(0, effectivePool - allocated);

  if (remainder > 0 && config.rounding.surplusToFirst) {
    const first = payouts.find((p) => p.position === 1);
    if (first) {
      first.amount += remainder;
      remainder = 0;
    }
  }

  return {
    payouts,
    effectivePool,
    remainder,
    overlay,
  };
}
