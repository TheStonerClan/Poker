// TODO(track-E): replace with real `@/lib/color-up` once that package is merged.

export type Denomination = { color: string; value: number };

export type ColorUpResult = {
  exchangeFor: Array<{ value: number; count: number }>;
  netChange: number;
  newTotal: number;
};

/**
 * Plausible mock that mirrors the algorithm from the real lib so admin UI
 * can render exchange recommendations during development. Replace with the
 * real import when Track E merges.
 */
export function computeExchange(args: {
  submittedTotal: number;
  removingDenominations: number[];
  remainingDenominations: Denomination[];
  roundingMode: "up" | "down";
}): ColorUpResult {
  const { submittedTotal, remainingDenominations, roundingMode } = args;
  const sorted = [...remainingDenominations].sort((a, b) => b.value - a.value);
  const smallest = sorted.length ? sorted[sorted.length - 1].value : 1;

  if (submittedTotal <= 0 || smallest <= 0) {
    return { exchangeFor: [], netChange: 0, newTotal: 0 };
  }

  const target =
    roundingMode === "up"
      ? Math.ceil(submittedTotal / smallest) * smallest
      : Math.floor(submittedTotal / smallest) * smallest;

  let remaining = target;
  const exchangeFor: ColorUpResult["exchangeFor"] = [];
  for (const denom of sorted) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      exchangeFor.push({ value: denom.value, count });
      remaining -= count * denom.value;
    }
  }

  const newTotal = exchangeFor.reduce((s, e) => s + e.value * e.count, 0);
  return {
    exchangeFor,
    newTotal,
    netChange: newTotal - submittedTotal,
  };
}
