import type {
  PrizeConfig,
  Pool,
  PayoutResult,
  Payout,
  PrizeRule,
  FixedRule,
} from './types';

export * from './types';

const CENTS_EPSILON = 1e-9;

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Floor `value` (dollars) down to a multiple of `increment` dollars. */
function floorToIncrement(value: number, increment: 0 | 1 | 5 | 10 | 20): number {
  if (value <= 0) return 0;
  if (increment === 0) {
    return Math.floor(value * 100 + CENTS_EPSILON) / 100;
  }
  return Math.floor(value / increment + CENTS_EPSILON) * increment;
}

/** Compute the realized pool from entry counts. Never negative. */
export function computeRawPool(pool: Pool): number {
  const entries = pool.buyIns + pool.buybacks;
  if (entries <= 0) return 0;
  const gross = entries * pool.buyInPrice;
  const rake = entries * (pool.rakePerEntry ?? 0);
  return Math.max(0, gross - rake);
}

function isFixed(rule: PrizeRule): rule is FixedRule {
  return rule.kind === 'fixed';
}

export function computePayouts(config: PrizeConfig, pool: Pool): PayoutResult {
  const rawPool = computeRawPool(pool);
  const guarantee = config.guarantee ?? 0;
  const overlayEnabled = config.overlay ?? false;

  let effectivePool = rawPool;
  let overlayAmount = 0;
  if (overlayEnabled && guarantee > rawPool) {
    effectivePool = guarantee;
    overlayAmount = guarantee - rawPool;
  }

  const rules = [...config.rules].sort((a, b) => a.position - b.position);

  // Pay fixed rules in position order; cap each to the remaining pool so a misconfigured
  // fixed rule (e.g. $20 fixed when pool is $5) doesn't push the remainder negative.
  let runningPool = effectivePool;
  const fixedAmounts = new Map<number, number>();
  for (const rule of rules) {
    if (isFixed(rule)) {
      const amount = Math.max(0, Math.min(rule.value, runningPool));
      fixedAmounts.set(rule.position, amount);
      runningPool -= amount;
    }
  }
  const remainderForPercent = runningPool;
  const inc = config.rounding.increment;

  const payouts: Payout[] = rules.map((rule) => {
    let amount = 0;
    if (rule.kind === 'fixed') {
      amount = fixedAmounts.get(rule.position) ?? 0;
    } else if (rule.kind === 'percentRemainder') {
      amount = floorToIncrement((remainderForPercent * rule.value) / 100, inc);
    } else {
      amount = floorToIncrement((effectivePool * rule.value) / 100, inc);
    }
    return { position: rule.position, amount };
  });

  // Compute leftover in integer cents to avoid float drift.
  const sumCents = payouts.reduce((s, p) => s + toCents(p.amount), 0);
  let leftoverCents = toCents(effectivePool) - sumCents;
  if (leftoverCents < 0) leftoverCents = 0;

  if (leftoverCents > 0 && config.rounding.surplusToFirst) {
    const first = payouts.find((p) => p.position === 1);
    if (first) {
      first.amount = fromCents(toCents(first.amount) + leftoverCents);
      leftoverCents = 0;
    }
  }

  // Snap final amounts to cents to clean up any float dust.
  for (const p of payouts) {
    p.amount = fromCents(toCents(p.amount));
  }

  return {
    payouts,
    effectivePool: fromCents(toCents(effectivePool)),
    remainder: fromCents(leftoverCents),
    overlay: fromCents(toCents(overlayAmount)),
  };
}
