/**
 * Local mock of `lib/color-up`. The real package lives at `lib/color-up/`
 * but is excluded from the Next.js root tsconfig (parallel-track sub-package).
 * This file matches the public API so the player view can compute exchanges
 * pre-integration; swap the import for `@poker/color-up` during integration.
 */

export type Denomination = { color: string; value: number };
export type RoundingMode = "up" | "down";

export type ComputeExchangeArgs = {
  submittedTotal: number;
  removingDenominations: number[];
  remainingDenominations: Denomination[];
  roundingMode: RoundingMode;
};

export type ExchangeChip = { value: number; count: number };

export type ComputeExchangeResult = {
  exchangeFor: ExchangeChip[];
  netChange: number;
  newTotal: number;
};

export function computeExchange(
  args: ComputeExchangeArgs,
): ComputeExchangeResult {
  const { submittedTotal, remainingDenominations, roundingMode } = args;

  if (!Number.isInteger(submittedTotal) || submittedTotal < 0) {
    throw new RangeError("submittedTotal must be a non-negative integer");
  }
  if (submittedTotal === 0) {
    return { exchangeFor: [], netChange: 0, newTotal: 0 };
  }
  if (remainingDenominations.length === 0) {
    throw new Error("remainingDenominations must not be empty");
  }

  const denoms = remainingDenominations
    .map((d) => d.value)
    .filter((v) => Number.isInteger(v) && v > 0)
    .sort((a, b) => b - a);

  const newTotal =
    roundingMode === "down"
      ? floorReachable(submittedTotal, denoms)
      : ceilReachable(submittedTotal, denoms);

  const exchangeFor = greedyDecompose(newTotal, denoms);
  return { exchangeFor, newTotal, netChange: newTotal - submittedTotal };
}

function floorReachable(target: number, denoms: number[]): number {
  // Canonical chip systems: greedy reaches every multiple of gcd. Walk down
  // from target to find the highest reachable value.
  for (let v = target; v >= 0; v--) {
    if (canMake(v, denoms)) return v;
  }
  return 0;
}

function ceilReachable(target: number, denoms: number[]): number {
  const ceiling = target + Math.max(...denoms);
  for (let v = target; v <= ceiling; v++) {
    if (canMake(v, denoms)) return v;
  }
  return target;
}

function canMake(target: number, denoms: number[]): boolean {
  if (target === 0) return true;
  if (target < 0) return false;
  let remaining = target;
  for (const d of denoms) {
    if (remaining >= d) remaining %= d;
    if (remaining === 0) return true;
  }
  return remaining === 0;
}

function greedyDecompose(target: number, denoms: number[]): ExchangeChip[] {
  if (target === 0) return [];
  const out: ExchangeChip[] = [];
  let remaining = target;
  for (const d of denoms) {
    const c = Math.floor(remaining / d);
    if (c > 0) {
      out.push({ value: d, count: c });
      remaining -= c * d;
    }
  }
  return out;
}
