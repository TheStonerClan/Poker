export type Denomination = { color: string; value: number };

export type RoundingMode = "up" | "down";

export interface ComputeExchangeArgs {
  submittedTotal: number;
  removingDenominations: number[];
  remainingDenominations: Denomination[];
  roundingMode: RoundingMode;
}

export interface ExchangeChip {
  value: number;
  count: number;
}

export interface ComputeExchangeResult {
  exchangeFor: ExchangeChip[];
  netChange: number;
  newTotal: number;
}

export function computeExchange(
  args: ComputeExchangeArgs,
): ComputeExchangeResult {
  const { submittedTotal, remainingDenominations, roundingMode } = args;

  if (!Number.isFinite(submittedTotal) || submittedTotal < 0) {
    throw new RangeError("submittedTotal must be a non-negative finite number");
  }
  if (!Number.isInteger(submittedTotal)) {
    throw new RangeError("submittedTotal must be an integer (whole chips)");
  }
  if (submittedTotal === 0) {
    return { exchangeFor: [], netChange: 0, newTotal: 0 };
  }
  if (remainingDenominations.length === 0) {
    throw new Error("remainingDenominations must not be empty");
  }

  const denomValues = remainingDenominations.map((d) => d.value);
  for (const v of denomValues) {
    if (!Number.isInteger(v) || v <= 0) {
      throw new RangeError(
        `remainingDenominations contains invalid value: ${v}`,
      );
    }
  }

  const newTotal =
    roundingMode === "down"
      ? maxReachableAtMost(submittedTotal, denomValues)
      : minReachableAtLeast(submittedTotal, denomValues);

  const exchangeFor = decomposeMinChips(newTotal, denomValues);
  const netChange = newTotal - submittedTotal;

  return { exchangeFor, netChange, newTotal };
}

function maxReachableAtMost(target: number, denoms: number[]): number {
  const reachable = new Uint8Array(target + 1);
  reachable[0] = 1;
  for (let v = 1; v <= target; v++) {
    for (const d of denoms) {
      if (v - d >= 0 && reachable[v - d] === 1) {
        reachable[v] = 1;
        break;
      }
    }
  }
  for (let v = target; v >= 0; v--) {
    if (reachable[v] === 1) return v;
  }
  return 0;
}

function minReachableAtLeast(target: number, denoms: number[]): number {
  const maxDenom = Math.max(...denoms);
  const upper = target + maxDenom;
  const reachable = new Uint8Array(upper + 1);
  reachable[0] = 1;
  for (let v = 1; v <= upper; v++) {
    for (const d of denoms) {
      if (v - d >= 0 && reachable[v - d] === 1) {
        reachable[v] = 1;
        break;
      }
    }
  }
  for (let v = target; v <= upper; v++) {
    if (reachable[v] === 1) return v;
  }
  // unreachable in practice: any positive target ≤ upper that uses any denom is reachable
  return target;
}

function decomposeMinChips(target: number, denoms: number[]): ExchangeChip[] {
  if (target === 0) return [];

  const sortedDesc = [...denoms].sort((a, b) => b - a);

  // Try greedy first (correct for canonical poker chip systems and minimizes chip count there).
  const greedyCounts = new Map<number, number>();
  let remaining = target;
  for (const d of sortedDesc) {
    const c = Math.floor(remaining / d);
    if (c > 0) {
      greedyCounts.set(d, c);
      remaining -= c * d;
    }
  }
  if (remaining === 0) {
    return [...greedyCounts.entries()].map(([value, count]) => ({
      value,
      count,
    }));
  }

  // Greedy didn't reach target exactly; fall back to DP for non-canonical denom sets.
  const INF = Number.POSITIVE_INFINITY;
  const minChips = new Array<number>(target + 1).fill(INF);
  const parent = new Array<number>(target + 1).fill(-1);
  minChips[0] = 0;
  for (let v = 1; v <= target; v++) {
    for (const d of denoms) {
      if (v - d >= 0 && minChips[v - d] + 1 < minChips[v]) {
        minChips[v] = minChips[v - d] + 1;
        parent[v] = d;
      }
    }
  }
  if (minChips[target] === INF) {
    throw new Error(
      `Cannot decompose ${target} from denoms [${denoms.join(", ")}]`,
    );
  }

  const counts = new Map<number, number>();
  let v = target;
  while (v > 0) {
    const d = parent[v];
    counts.set(d, (counts.get(d) ?? 0) + 1);
    v -= d;
  }
  return [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([value, count]) => ({ value, count }));
}
