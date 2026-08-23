import type { PlayerCounts, TournamentPlayerWithName } from "./types";

export type ChipAccountingInputs = {
  /**
   * Per-player starting stack from the tournament snapshot (seed: 500).
   * Each row contributes one starting stack to the chips-in-play pool.
   */
  startingStack: number;
  /**
   * Chips granted per rebuy (seed: 500). Each rebuy adds this to the pool.
   */
  rebuyChips: number;
  /**
   * Chips granted per add-on (seed: 500). Each add-on adds this to the pool.
   */
  addOnChips: number;
  /**
   * Net chip delta from approved color-up exchanges. When the dealer
   * rounds 23 small chips up to 25 of a higher denom, the player gains
   * 2 chips and so does the table-wide pool. Sum of `net_change` across
   * all approved color_up_requests for this tournament. Defaults to 0
   * when the caller hasn't queried color-ups (older callers, tests).
   */
  colorUpDelta?: number;
};

export function aggregatePlayers(
  rows: TournamentPlayerWithName[],
  chipsCfg?: ChipAccountingInputs,
): PlayerCounts {
  let reEntries = 0;
  let addOns = 0;
  let activePlayers = 0;
  let activeChipsSum = 0;

  for (const r of rows) {
    // Prefer the per-row counters when present (added in 0003 to support
    // configurable rebuy/add-on limits — a player can rebuy AND addon,
    // since the two budgets are independent, or repeat either one if its
    // per-player limit is raised above 1). Fall back to the legacy
    // most-recent-type fields when the counters are zero so historical
    // rows without backfill (or DBs that haven't run 0003 yet) still
    // aggregate correctly.
    const rowRebuys =
      typeof r.rebuys_used === "number" && r.rebuys_used > 0
        ? r.rebuys_used
        : r.buyback_used && r.buyback_used_as === "rebuy"
          ? 1
          : 0;
    const rowAddOns =
      typeof r.addons_used === "number" && r.addons_used > 0
        ? r.addons_used
        : r.buyback_used && r.buyback_used_as === "addon"
          ? 1
          : 0;
    reEntries += rowRebuys;
    addOns += rowAddOns;
    if (r.busted_at_time == null) {
      activePlayers += 1;
      activeChipsSum += r.current_chips ?? 0;
    }
  }

  // `entries` is the number of distinct paying players (one row per player).
  // The downstream `computePool` adds `buybacks * buybackPrice` separately,
  // so don't fold rebuys into entries here — that double-counts and was the
  // source of the "rebuy adds $40 to the pool instead of $20" bug.
  const entries = rows.length;

  // Total chips IN PLAY, derived from the buy-in side. When a player busts
  // their stack doesn't disappear — whoever knocked them out has it — so
  // summing `current_chips` is the wrong model (we'd watch the total decay
  // toward whatever the last recorded chip totals were). Instead: every
  // paid entry contributes one starting stack, every rebuy contributes
  // rebuyChips, every add-on contributes addOnChips. Conservation holds
  // through busts, and the average rises as players fall — which is what
  // anyone reading the TV expects.
  //
  // If `chipsCfg` isn't supplied (older callers, tests), fall back to the
  // active-row sum so the function stays a drop-in replacement.
  const totalChips = chipsCfg
    ? entries * chipsCfg.startingStack +
      reEntries * chipsCfg.rebuyChips +
      addOns * chipsCfg.addOnChips +
      (chipsCfg.colorUpDelta ?? 0)
    : activeChipsSum;

  const averageChips =
    activePlayers > 0 ? Math.round(totalChips / activePlayers) : 0;

  return {
    players: activePlayers,
    entries,
    reEntries,
    addOns,
    totalChips,
    averageChips,
  };
}
