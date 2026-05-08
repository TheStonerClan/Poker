import type { PrizeRule, PrizeRules } from "./types";

export type PrizePoolInputs = {
  buyIn: number;
  buybackPrice: number;
  entries: number;
  buybacks: number;
};

export type PayoutLine = { position: number; amount: number };

export function computePool({
  buyIn,
  buybackPrice,
  entries,
  buybacks,
}: PrizePoolInputs): number {
  return Math.max(0, entries * buyIn + buybacks * buybackPrice);
}

function floorTo(value: number, increment: number): number {
  if (value <= 0) return 0;
  if (increment <= 0) return Math.floor(value * 100) / 100;
  return Math.floor(value / increment) * increment;
}

export function computePayouts(
  rules: PrizeRules,
  rawPool: number,
): { payouts: PayoutLine[]; effectivePool: number } {
  const guarantee = rules.guarantee ?? 0;
  const overlay = rules.overlay ?? false;
  const effectivePool =
    overlay && guarantee > rawPool ? guarantee : rawPool;

  const sorted = [...rules.rules].sort((a, b) => a.position - b.position);

  let runningPool = effectivePool;
  const fixedById = new Map<number, number>();
  for (const rule of sorted) {
    if (rule.kind === "fixed") {
      const amount = Math.max(0, Math.min(rule.value, runningPool));
      fixedById.set(rule.position, amount);
      runningPool -= amount;
    }
  }
  const remainder = runningPool;
  const inc = rules.rounding.increment;

  const payouts: PayoutLine[] = sorted.map((rule: PrizeRule) => {
    let amount = 0;
    if (rule.kind === "fixed") {
      amount = fixedById.get(rule.position) ?? 0;
    } else if (rule.kind === "percentRemainder") {
      amount = floorTo((remainder * rule.value) / 100, inc);
    } else {
      amount = floorTo((effectivePool * rule.value) / 100, inc);
    }
    return { position: rule.position, amount };
  });

  if (rules.rounding.surplusToFirst) {
    const sum = payouts.reduce((s, p) => s + p.amount, 0);
    const leftover = effectivePool - sum;
    if (leftover > 0) {
      const first = payouts.find((p) => p.position === 1);
      if (first) first.amount += leftover;
    }
  }

  return { payouts, effectivePool };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
