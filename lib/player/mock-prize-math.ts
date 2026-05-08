/**
 * Local mock of `lib/prize-math`. The real package lives at `lib/prize-math/`
 * but is excluded from the Next.js root tsconfig (parallel-track sub-package).
 * This file matches the public API so the player view can show
 * "payout if busted now" pre-integration; swap the import during integration.
 */

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

export function computeRawPool(pool: Pool): number {
  const entries = pool.buyIns + pool.buybacks;
  if (entries <= 0) return 0;
  return Math.max(
    0,
    entries * pool.buyInPrice - entries * (pool.rakePerEntry ?? 0),
  );
}

export function computePayouts(
  config: PrizeConfig,
  pool: Pool,
): PayoutResult {
  const rawPool = computeRawPool(pool);
  const guarantee = config.guarantee ?? 0;
  const overlayEnabled = config.overlay ?? false;

  let effectivePool = rawPool;
  let overlay = 0;
  if (overlayEnabled && guarantee > rawPool) {
    effectivePool = guarantee;
    overlay = guarantee - rawPool;
  }

  const rules = [...config.rules].sort((a, b) => a.position - b.position);
  const inc = config.rounding.increment;

  let runningPool = effectivePool;
  const fixedAmounts = new Map<number, number>();
  for (const rule of rules) {
    if (rule.kind === "fixed") {
      const amount = Math.max(0, Math.min(rule.value, runningPool));
      fixedAmounts.set(rule.position, amount);
      runningPool -= amount;
    }
  }
  const percentRemainder = runningPool;

  const payouts: Payout[] = rules.map((rule) => {
    let amount = 0;
    if (rule.kind === "fixed") {
      amount = fixedAmounts.get(rule.position) ?? 0;
    } else if (rule.kind === "percentRemainder") {
      amount = floorTo((percentRemainder * rule.value) / 100, inc);
    } else {
      amount = floorTo((effectivePool * rule.value) / 100, inc);
    }
    return { position: rule.position, amount };
  });

  const sum = payouts.reduce((s, p) => s + p.amount, 0);
  let leftover = round2(effectivePool - sum);
  if (leftover < 0) leftover = 0;
  if (leftover > 0 && config.rounding.surplusToFirst) {
    const first = payouts.find((p) => p.position === 1);
    if (first) {
      first.amount = round2(first.amount + leftover);
      leftover = 0;
    }
  }

  return {
    payouts: payouts.map((p) => ({ ...p, amount: round2(p.amount) })),
    effectivePool: round2(effectivePool),
    remainder: round2(leftover),
    overlay: round2(overlay),
  };
}

function floorTo(value: number, increment: 0 | 1 | 5 | 10 | 20): number {
  if (value <= 0) return 0;
  if (increment === 0) return Math.floor(value * 100) / 100;
  return Math.floor(value / increment) * increment;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
