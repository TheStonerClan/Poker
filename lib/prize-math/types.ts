/**
 * Public types for the prize-math library.
 *
 * The library is a pure-TS calculator: given a tournament's prize config and the
 * realized pool of entries, return per-position payout amounts.
 */

/** A fixed-dollar payout at the given finishing position. */
export type FixedRule = { kind: 'fixed'; position: number; value: number };

/**
 * A percent payout taken from the *remainder* — the pool after subtracting all
 * `fixed` rules. `value` is a percent in [0, 100].
 */
export type PercentRemainderRule = {
  kind: 'percentRemainder';
  position: number;
  value: number;
};

/**
 * A percent payout taken from the *full* effective pool (ignores fixed rules).
 * `value` is a percent in [0, 100].
 */
export type PercentTotalRule = {
  kind: 'percentTotal';
  position: number;
  value: number;
};

export type PrizeRule = FixedRule | PercentRemainderRule | PercentTotalRule;

/** Rounding policy applied to every percent-derived payout. */
export type PrizeRounding = {
  /**
   * Snap each percent payout *down* to a multiple of `increment` dollars.
   *  - `0`  → no rounding past cents (floor to $0.01)
   *  - `1`  → whole dollars
   *  - `5`, `10`, `20` → useful for cash-only rooms with limited bill denominations
   */
  increment: 0 | 1 | 5 | 10 | 20;
  /**
   * If true, after all per-position amounts are floored, any leftover dollars
   * (the rounding surplus) are added to position 1. Otherwise the leftover is
   * returned as `remainder` and the host keeps it.
   */
  surplusToFirst: boolean;
};

export type PrizeConfig = {
  rules: PrizeRule[];
  rounding: PrizeRounding;
  /** Minimum prize pool the host has advertised. Defaults to 0. */
  guarantee?: number;
  /**
   * If true and the realized pool is below `guarantee`, the host eats the diff:
   * the effective pool used for payout math becomes `guarantee`.
   * If false (default), `guarantee` is informational only.
   */
  overlay?: boolean;
};

/**
 * Realized entries. The total pool is computed as:
 *   pool = (buyIns + buybacks) * buyInPrice - (buyIns + buybacks) * (rakePerEntry ?? 0)
 *
 * `buybacks` is a count of buyback tokens redeemed (regardless of the buyback's
 * mode in the host's rules — every redemption contributes `buyInPrice` to the pool).
 * `rakePerEntry` applies to every contribution (initial buy-in and buyback alike).
 */
export type Pool = {
  buyIns: number;
  buybacks: number;
  buyInPrice: number;
  rakePerEntry?: number;
};

export type Payout = { position: number; amount: number };

export type PayoutResult = {
  /** One entry per rule, sorted by `position` ascending. */
  payouts: Payout[];
  /** The pool used for payout math (post-overlay). */
  effectivePool: number;
  /** Pool dollars not allocated to any position. Always 0 if `surplusToFirst` is true. */
  remainder: number;
  /** Dollars the host had to cover when overlay activated. 0 otherwise. */
  overlay: number;
};
