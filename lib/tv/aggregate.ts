import type { PlayerCounts, TournamentPlayerWithName } from "./types";

export function aggregatePlayers(
  rows: TournamentPlayerWithName[],
): PlayerCounts {
  let reEntries = 0;
  let addOns = 0;
  let activeChips = 0;
  let activePlayers = 0;

  for (const r of rows) {
    // Prefer the per-row counters when present (added in 0003 to support
    // configurable rebuy limits — a player can rebuy AND addon, or rebuy
    // multiple times if tokensPerPlayer > 1). Fall back to the legacy
    // most-recent-type fields when the counters are zero so historical
    // rows without backfill still aggregate correctly.
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
      activeChips += r.current_chips ?? 0;
    }
  }

  // `entries` is the number of distinct paying players (one row per player).
  // The downstream `computePool` adds `buybacks * buybackPrice` separately,
  // so don't fold rebuys into entries here — that double-counts and was the
  // source of the "rebuy adds $40 to the pool instead of $20" bug.
  const entries = rows.length;

  const averageChips =
    activePlayers > 0 ? Math.round(activeChips / activePlayers) : 0;

  return {
    players: activePlayers,
    entries,
    reEntries,
    addOns,
    totalChips: activeChips,
    averageChips,
  };
}
